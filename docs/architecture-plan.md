# OpenForge Workshop — Architecture Plan

**Status:** proposed, v1. Written 2026-08-29 from a measured recon of the real catalog
(8,702 live tiles), an adversarial critique of that recon, and SOTA research on every
component. Numbers in this document are measured unless marked as an estimate.

Companion documents:
- [`design-contract.md`](design-contract.md) — the approved visual design and its contract
- [`base-generator-integration.md`](base-generator-integration.md) — the OpenSCAD track in full
- [`texture-materials.draft.ts`](texture-materials.draft.ts) — the finished material registry

---

## 1. What this is

A static, zero-backend web app over the existing OpenForge asset bucket. Four screens:
a landing page, a faceted catalog, a saved library, and a room builder that produces a
bill of tiles and a download pack. Plus a parametric base generator wired into the builder.

**Two things it reuses, and nothing else.** STL files and previews come from the existing
public Cloudflare R2 bucket. Tile metadata is imported from the catalog repo's JSON
fixtures at build time. There is no shared database, no shared API, and no shared code.

**The shape that falls out of the data:** the entire catalog — all 8,702 tiles, with tags
and composition configs — compresses to roughly **250–320 KB**. That single fact removes
the need for a query backend entirely. Search, faceting, and constraint resolution all run
in the browser against an in-memory array.

---

## 2. The five findings that shaped this plan

Each of these overturned an assumption the design mock was built on.

**1. Units are settled, and the size tags are not footprints.** Every STL is authored in
millimetres at exactly **25.4 mm per catalog unit** — confirmed bit-exact across 1,042
measured extents, with zero values below 2.0 mm ruling out the inches hypothesis. But the
`size|width` / `size|depth` tags are *design-family labels*, not measurements. They agree
exactly for 81% of plain rectangles and diverge wildly for curves, where the tag names the
curve family while the mesh is a fragment of it (median error 96 mm, max 163 mm). Wall
thickness measures **12.7 mm**. Both constants are hard-coded in the importer.

**2. The catalog is a parts list, not an object list.** 50.1% of entries carry no joinery
at all, because OpenForge factors connectors into a separately-printed base; 22.6% *are*
bases. A placement is therefore an **assembly** — a base plus a topper — not a single STL.
Lock system (openlock / dragonlock / magnetic) is one global user preference, not a
per-placement constraint: parity across the three is 93.4–93.5%, so the choice costs
0.1 percentage points of catalog access.

**3. Three footprint primitives reach 77% of the catalog; one reaches 34%.** A naive
`{w, d}` rectangle covers 33.8%. Adding a wall segment (length + the measured 12.7 mm
thickness) reaches **63.0%**. Adding an arc (radius + angle) reaches **77.1%**. The
genuinely unplaceable remainder is **241 files, 2.8%** — parts, interfaces and scatter with
no footprint of their own, which belong in the bill of materials attached to a host, never
in the placement palette.

**4. Compositions are an accessory layer, not a prerequisite layer.** 89.9% of live models
declare no required companion part. 81% of configs declare exactly one slot, 69% of slots
are optional, and the auto-generated `base` slot is `optional: True` in every single case.
The median slot has 14 candidates and 62% have fewer than 50 — small enough to render as an
inline sprite grid rather than a modal search.

**5. Everything is CC BY-NC-SA 4.0.** The OpenForge project's own rule is that anything
distributed via the Dropbox is non-commercial *regardless* of its Thingiverse licence, and
this corpus is scanned from the Dropbox. See §10 — this is a launch gate, not a detail.

---

## 3. System architecture

```
                    ┌──────────────────────────────┐
   Browser ───────► │ workshop.openforge.tools     │  Cloudflare Worker + Static Assets
                    │  static SPA + catalog JSON   │  (SPA fallback routing)
                    └──────────────┬───────────────┘
                                   │
        ┌──────────────────────────┼───────────────────────────┐
        ▼                          ▼                           ▼
┌───────────────┐        ┌──────────────────┐        ┌────────────────────┐
│ objects.      │        │ zip Worker       │        │ scad.openforge.    │
│ openforge.    │        │ (fallback only:  │        │ tools              │
│ tools  (R2)   │        │  iOS, >1 GB)     │        │ SEPARATE ORIGIN    │
│               │        └──────────────────┘        │ OpenSCAD WASM      │
│ /models/      │                                    │ (GPL isolated)     │
│ /sprites/     │                                    └────────────────────┘
│ /thumbs/  NEW │
└───────────────┘
```

Four deliberate boundaries:

- **The SPA holds no server state.** Catalog, search, facets and constraint resolution are
  all client-side over a static JSON asset.
- **R2 is read-only and served on its own custom domain**, never proxied through the Worker.
  Egress is free; proxying would burn Worker CPU for nothing.
- **The zip Worker is a fallback**, not the default path. Client-side zipping is primary.
- **The OpenSCAD generator lives on a separate origin.** This one boundary solves two
  unrelated problems at once: it quarantines GPL copyleft away from the Workshop bundle,
  and it lets that app set its own COOP/COEP headers without imposing a CORP requirement
  on every catalog asset.

---

## 4. The stack

All versions verified current as of 2026-08-29 with maintenance status checked.

| Layer | Choice | Why this one |
| --- | --- | --- |
| Host | **Cloudflare Workers + Static Assets**, Wrangler 4.127.1 | Cloudflare steers new projects away from Pages; static asset requests are free and unmetered |
| Build | **Vite 8.2.2** (Rolldown) + `@cloudflare/vite-plugin` 1.54.2 | Pin exact — Vite 8 swapped bundlers mid-major |
| UI | **React 19.2.8**, pinned `~19.2` | r3f 9.7.0 peers `>=19 <19.3`; a React minor is an r3f-coordinated upgrade |
| Routing | **TanStack Router 1.170.x** | `validateSearch` gives typed, shareable filter state in the URL |
| State | **Zustand 5.0.15** + `persist` | Set `version`/`migrate` from the first commit, not retrofitted |
| Styling | **Tailwind 4.3.3**, `@theme inline` tokens | One token set feeds both CSS and three.js materials |
| Primitives | **Base UI 1.7.0** | Drawer, Dialog, Tabs, Tooltip, ToggleGroup |
| Virtualisation | **react-virtuoso 4.18.12** (`VirtuosoGrid`) | Lock cards to a fixed aspect ratio — it assumes uniform item size |
| Facets | **Uint32Array bitset**, ~40 lines ours | 10 ms build, 3.7 µs/query. Measured to beat ItemsJS, and it is the same engine the composition constraints need |
| Text search | **MiniSearch 7.2.0** | 6.0 KB gz, typo tolerance + prefix. Vendored |
| 3D | **three.js 0.185.1** + **r3f 9.7.0** + **drei 10.7.8** | Do not exceed 0.185.x — `postprocessing` 6.39.4 peers `<0.186.0` |
| Materials | **TSL** `MeshStandardNodeMaterial` via `WebGLNodesHandler` | Object-space 3D noise: no UVs, no triplanar, ~20 shared programs for 8,700 files |
| AO | **N8AO 2.0.1** | The single thing stopping models dissolving into the parchment ground |
| Zip | **client-zip 2.5.0** + `native-file-system-adapter` 3.0.1 | Both vendored — see §11 |
| Validation | **Zod 4.x** | Persisted-state schemas and generator parameters |

**Two libraries get vendored into the repo**, not just pinned: `client-zip` (last release
2025-03, scope explicitly frozen, 6.4 KB of dependency-free standards-only code) and the
bitset facet engine's escape hatch. Both are small, both are load-bearing, and vendoring
makes an unpublish a non-event.

---

## 5. The data pipeline

A build-time importer, run in CI, that turns the catalog fixtures into one static asset.

```
openforge-catalog fixtures (pinned commit)
        │
        ▼
  import + normalise
        │   • resolve footprint primitive per tile (RECT / WALL_SEG / ARC / NONE)
        │   • classify layer: base / topper / integral / insert
        │   • normalise connection vocabulary (fold topless, unsupported, flex)
        │   • synthesise display name from tags
        │   • assign family = dirname(full_name)
        │   • intern tags to integer ids
        │   • precompute composition slot candidates + arc-consistency
        ▼
  catalog.json (~250–320 KB brotli)  ──► shipped as a static asset
```

### Identity — two keys, not one

The mock used one id. The data needs two, because **171 md5 values are shared by 520 rows**
(the same physical STL filed under two catalog paths, which is correct data modelling).

- **`id` = `full_name`** — catalog identity. React keys, placements, share links.
- **`blob` = md5** — content address. Deduping the bill of tiles and the download pack.

Using md5 as the React key would collapse 349 cards and mis-key placements.

### Footprint resolution

```ts
type Footprint =
  | { kind: 'rect';  w: number; d: number }        // 3,595 models
  | { kind: 'wall';  length: number }              // 2,825 models — depth is the 12.7 mm constant
  | { kind: 'arc';   radius: number; angle: number } // 1,034 models
  | { kind: 'none' }                                // 241 models — never in the palette
```

Rotation step is **per-tile**, derived from `size|angle`, defaulting to 90°. A hex corner
rotated in 90° steps will never tile; 893 entries carry a non-90° angle.

### Heights

There is no height data in the catalog — not one bounding box in 8,721 entries. Heights come
from a **lookup table keyed on the qualitative tag vocabulary**, with one exemplar
measurement pinning each value. Measured: riser low/mid/medium/high = 1.000 / 1.250 / 1.500 /
2.000 in exactly; openforge full wall ≈ 44 mm; openlock full wall ≈ 50 mm.

We do **not** need the 106 GB full-catalog bounding-box pass for v1. If real per-mesh
dimensions are wanted later (the honest fix for curved footprints), a strided range-read of
24 blocks × 400 triangles gets sub-0.03 mm accuracy for ~13 GB instead of 106 GB.

> **Operational note for whoever runs any bulk R2 job:** Cloudflare returns HTTP 403
> (error 1010) for the default `Python-urllib` User-Agent. Set a custom UA or every
> request fails in a way that looks like the bucket is broken.

---

## 6. Search and filtering

Everything runs in the browser over the in-memory catalog.

- **Facets** are a `Uint32Array` bitset index: 10 ms to build, 3.7 µs per query, with
  correct disjunctive counts across all dimensions. The same engine serves the composition
  constraint matcher, which is why it beats pulling in a facet library that would still
  need the bitset for `constrain`.
- **Text** goes through MiniSearch with prefix and fuzzy matching.
- **Tokenisation is mandatory.** Under the mock's substring matcher *every* multi-word query
  returns zero hits — "dungeon stone", "arrow slit", "cave wall", "2x2 floor" — because no
  filename contains a space and only five tag values corpus-wide do. Normalise `[|_+,%#.-]`
  to spaces and match on word boundaries (which also kills the trap where "cave" matches
  658 *con*cave pieces).
- **Synthesise a size token** at import (`"4x4"`, `"4 x 4"`, `"2r90"`). The literal string
  `4x4` appears in zero tags. Delete the mock's `x` → `×` rewrite: `×` occurs zero times in
  the corpus, and applying it takes "4x4" from 347 hits to 0.

### The facets the data actually supports

| Facet | Widget | Note |
| --- | --- | --- |
| Kind | multi-select | `kinds: string[]`, not one value — 19.6% of tiles land in 2+ buckets, 11.6% in none. `shape\|door` has **zero** occurrences; a door is a component mounted on a wall |
| Texture | grouped, prefix-matching | 38 roots, not 6 chips. Top ~12 plus "more" |
| Build system | single-select + "unspecified" | 34.2% carry no build tag |
| Connection | multi-select | 35.5% carry 2–3 systems simultaneously |

The mock fused build system and connection into one `sys` field. They are orthogonal, and
collapsing them makes 40% of the catalog unreachable — including the OpenForge connector,
the project's own flagship system.

---

## 7. The Builder

**Place designs, not files.** Mean redundancy is 2.27 files per design; the user picks a
texture and a lock system once, places ~3,724 *designs*, and the concrete STL resolves at
download time. This is the single largest simplification available and it makes the palette
comprehensible.

**Placements are assemblies.** Each placement resolves to a base plus a topper. Match them
on shape + `size|openlock` code (A→2, BA→1.5, IA→1, D→3, Q→4) — **never** on the `build|`
tag, because zero bases carry `build|wall on tile` yet 1,133 pieces in that system need one.

**Compatibility informs, it does not enforce.** One hard check: every `connection|openforge`
piece needs a base line item, auto-inserted. Everything else is a warning in the bill of
tiles plus palette sorting. Enforcement would need trustworthy per-edge connector data that
does not exist.

**Snap to 0.5 units, offer 1.0 as coarse. Drop 0.25** — every dimension in the entire
catalog is a multiple of 0.5, so a quarter-unit grid can only ever produce unbuildable
placements.

### 3D or 2.5D?

The recon critic proposed dropping 3D for a top-down footprint planner, on the grounds that
heights don't exist and LOD is expensive. **The evidence resolved this in favour of keeping
3D:** footprints turned out to be derivable for 77% of the catalog, and heights come from a
measured lookup table. The cost that justified going flat has gone away.

But the builder does **not** render print geometry. See §8.

---

## 8. 3D and the asset pipeline

Raw STL in the browser is viable for exactly one model in a detail viewer and nothing more.
The corpus totals **2.12 billion triangles**; twenty tiles at median size is ~198 MB and
4.1 M triangles. The builder needs decimated proxies.

| Surface | Geometry | Notes |
| --- | --- | --- |
| Catalog grid | **WebP thumbnail** (new derivative) | See below |
| Detail viewer, first paint | Sprite sheet | Already in the bucket, 99.99% coverage |
| Detail viewer, "View in 3D" | Raw STL, gated at ~20–25 MB | Above the gate, stay on sprites — the 104 MB tail will OOM mobile Safari |
| Builder | **Decimated GLB LOD** | 5–20 K triangles; `InstancedMesh` per repeated design |

**The conversion pipeline** is glTF Transform 4.4.2 driving meshoptimizer 1.2.0, emitting
EXT_meshopt_compression GLBs to a new `/lod/{md5[:6]}/{md5}.glb` prefix, keyed on the
existing md5 content addressing so it stays incremental. Draco is rejected: no release
since January 2024, and a 100 KB decoder against meshopt's 7 KB.

> **The trap to guard:** if facet normals survive into `weld()`, welding and therefore
> simplification silently no-op and you ship GLBs barely smaller than the STLs, with no
> error anywhere. Assert that post-weld vertex count dropped materially and fail the job
> if it didn't.

**Decimated meshes are preview-only.** The download path must always serve the original
untouched STL. Shipping a decimated mesh to someone's printer would be a serious trust
failure in a 3D-printing audience.

### Two asset problems that must be fixed

**Thumbnails.** Sprite sheets average 529 KB, and a 60-card screen decodes to ~629 MB of
bitmap. Crop frame 0 of each sheet to a 256 px q80 WebP at `/thumbs/{md5[:6]}/{md5}.webp` —
a 48× byte reduction for about **$0.04 one-time** and 125 MB of storage. Keep the sprite
sheets; the thumbnails are an addition, not a replacement.

**The sprite sheets are blue.** Not greyscale — `stl-thumb` renders in a default blue Phong
material (ambient `#002142`, diffuse peaking `#3375c8`), confirmed against seven real sheets
and the tool's own source. 99.8% of opaque pixels are non-neutral. This kills the cheap idea
of CSS-tinting the existing PNGs to match the 3D material colours, and it means the catalog
grid and the live 3D views will not agree on colour until the thumbnails are re-rendered.
**Decision: accept the split for v1** (thumbnails stay as-is, live 3D is tinted), and fold
coloured thumbnail re-rendering into the LOD pipeline when it runs, since that pipeline
already has the geometry in hand.

---

## 9. Material tinting

Colourless STLs are tinted by their `texture|` tag through a hardcoded registry. The
finished implementation is in [`texture-materials.draft.ts`](texture-materials.draft.ts).

**16 material families covering all 38 texture roots at 100%.** Hue is anchored in measured
dielectric albedo and the Geological Rock-Color Chart; lightness and chroma are *not*
physical, because real stone albedos sit 1.5–9 ΔE00 apart — below the just-noticeable
difference for a 25 px mark, so physical correctness would render cut stone, dungeon stone,
rough stone and cave identically and defeat the entire feature. Instead they were solved by
constrained simulated annealing maximising the minimum CIEDE2000 distance across all 120
pairs, evaluated simultaneously under normal vision and Machado-2009 protanopia,
deuteranopia and tritanopia.

Measured result: **minimum pairwise ΔE00 of 9.05 across normal vision and all three
dichromacies**, every family ≥12.3 ΔE00 from the parchment grounds and ≥12.2 from the UI
accents. The map it replaces had a minimum ΔE00 of 5.42 with all six entries inside a 15°
hue band that the parchment ground itself occupies.

Two rules that fell out of measurement:

- **Silhouette is carried by a contour, not the fill.** Meeting WCAG 1.4.11's 3:1 against the
  parchment well with fills alone would force every material below L\* 50, destroying
  plaster, sandstone and ice. A dedicated contour at `oklch(min(0.36, L×0.72), C×0.70, H)`
  frees the fill band; measured contour contrast is 7.14:1 minimum.
- **Wear changes roughness, never colour.** Applying a lightness/chroma modifier for
  `ruined` / `eroded` / `broken_*` was implemented and measured: at any delta large enough
  to see, a worn tile reads as a *different family* (worn cut stone lands 4.06 ΔE00 from base
  plain). Wear moves roughness and grain amplitude only. 1,538 blueprints (17.7%) are worn.

Shading is TSL object-space 3D noise on `MeshStandardNodeMaterial` — **no UVs and no
triplanar mapping needed**, because 3D noise doesn't need texture coordinates. About 20
shared shader programs cover all 8,700 files. The expensive Worley mortar-seam pass runs in
the detail viewer only; the builder drops to 2 noise octaves with mortar off.

---

## 10. Licensing — a launch gate

**The whole corpus is CC BY-NC-SA 4.0.** The project's own licence statement is explicit:
*"All designs in the OpenForge Dropbox are released under the CC BY-NC-SA even if the same
design is released under a different license on Thingiverse."* This catalog is scanned from
the Dropbox, so the per-series BY-SA carve-outs (dungeon stone, cut stone, rough stone,
tudor — 4,638 entries, 53%) **do not apply to the files we hold**. Treat it as one constant;
do not build per-series licence logic.

Consequences, all of which need a human decision before launch:

1. **The Workshop must be non-commercial, permanently** — no ads, no paid tier, no
   sponsorship, and no gating downloads behind Patreon (that last is separately barred by
   the licence's no-additional-restrictions clause). Or Devon grants written permission.
2. **Attribution must ride inside the download.** The page footer does not travel with a
   zip. Ship `LICENSE.txt` and a per-file `ATTRIBUTION.csv` in every generated archive.
3. **Decimated preview meshes are Adapted Material** — label them "preview, not for
   printing", licence the derivatives BY-NC-SA, and keep them out of the download path.
4. **GPL is quarantined by the separate origin.** The `.scad` geometry source
   (`openforge-bases`) is Apache-2.0 and safe to bundle. The OpenSCAD WASM binary is GPL-2
   and `openforge-openscad` is GPL-3 — do not copy from the latter, and keep the former on
   `scad.openforge.tools`.

---

## 11. Download

**Primary path, in the browser:** `client-zip` 2.5.0 generating a `ReadableStream`, landed
on disk via `native-file-system-adapter`'s `showSaveFilePicker` (native File System Access →
same-origin service worker → Blob). Feed `predictLength` from the fixture `size` field,
never from HEAD requests.

**Fallback, a Cloudflare Worker:** the same library streaming R2 objects, for iOS Safari and
multi-GB rooms.

Three things to get right:

- **Dedupe by md5.** 171 md5s are shared across 520 rows; without deduping, the bill of
  tiles double-counts and the pack downloads the same file twice.
- **Disambiguate colliding filenames.** 89 filenames map to 2–3 genuinely different meshes
  (`tudor#door+narrow.stl` is three distinct md5s). Naming zip entries by filename silently
  overwrites. Prefix with a directory from `full_name`.
- **Size is a warning surface, not a footnote.** A 50-placement room at p95 file sizes is
  1.66 GB. Warn above a threshold and offer a URL list as the degradation path.

`client-zip` cannot compress, ever — and 870 of the STLs are ASCII, which deflates 5–10×.
That is a real product trade: an exact streaming progress bar (client-zip) versus a much
smaller download (`@zip.js/zip.js` with an estimated bar). **v1 takes client-zip**; revisit
if download size complaints appear.

---

## 12. Base generator

Full detail in [`base-generator-integration.md`](base-generator-integration.md).

- **Source of truth is `MasterworkTools/openforge-bases` (Apache-2.0)**, not the GPL-3
  `openforge-openscad`, which is a dormant fork of a third-party web GUI whose only real
  value is ~300 lines of wrapper code.
- **Don't write a customizer parser.** OpenSCAD's own WASM build emits the parameter schema
  as JSON via `--export-format=param` — verified end-to-end against the real `bases.scad`
  (18 parameters, ~350 ms). The form generates itself and stays correct when Devon edits the
  `.scad`.
- **Cross-origin isolation is not required.** Every shipped openscad-wasm build is
  single-threaded with unshared linear memory — verified from the binary's memory flags. Do
  not set COOP/COEP.
- **Catalog first, generate second.** The 1,962 catalogued bases *are* generator output —
  `bases.py` ran the same `.scad` with `-D` flags, and the fixture filenames literally encode
  the parameter tuples. So hash the parameter set, look it up against the catalog (instant,
  already in R2, has a sprite), and fall through to WASM only on a miss. The user never
  chooses between "catalog base" and "generated base".
- **Persist the recipe, never the mesh.** Content-address the recipe, so share links stay
  tiny and a build regenerates on open.
- **v1 excludes textured primary walls** — they need 90 MB of blank STLs materialised before
  the render and take 30–180 s. Ordinary bases render in 110–265 ms warm, fast enough to
  skip a "Generate" button entirely.

---

## 13. Persistence and sharing

Local state (library + build) via Zustand `persist` over `localStorage`, validated with Zod
on rehydrate, with `version`/`migrate` set from the first commit.

Share links: columnar JSON → native `CompressionStream('deflate-raw')` → base64url in the
URL fragment. Roughly 2,400 placements fit a 2,000-character link for room-shaped builds,
~215 for scattered high-diversity ones — so **cut over to a short link by measured encoded
length, never by placement count**.

Two risks worth designing against now:

- **Manifest index drift.** Share links encode integer indices into the build-time tile
  manifest. If an import reorders them, every existing link silently decodes to a *different
  room* with no error. Enforce append-only index assignment with a build assertion, and
  embed the manifest version in every payload.
- **Safari evicts localStorage after 7 days.** For an app opened between game sessions that
  is the normal case. Treat local state as a cache: every saved build gets a URL, and
  JSON export/import ships from day one.

---

## 14. Scope

**v1 — the catalog is the product.**
Landing, catalog with real facets and search, library, tile detail with sprite viewer and a
gated 3D view. Builder with RECT and WALL_SEG footprints (63% coverage), assemblies, bill of
tiles, client-side zip. Material tinting in the 3D views. Thumbnail derivative pipeline and
the Cloudflare cache configuration.

**v1.1 — the builder gets real.**
ARC footprints (→77%), the LOD pipeline and instanced builder geometry, composition accessory
slots as inline sprite grids, dead-end greying.

**v2 — generation and assemblies.**
Base generator on its own origin. The 40 `type=blueprint` recipes as guided assemblies. Real
per-mesh dimensions via strided range-reads, if curved footprints prove to matter.

---

## 15. Decisions needed from a human

| # | Decision | Recommended default |
| --- | --- | --- |
| 1 | **Non-commercial forever, or get Devon's written permission?** | Accept NC permanently — it costs nothing for a community tool and removes the gate |
| 2 | Cloudflare zone admin to add the Cache Rule, CORP/content-type Transform Rule, and disable `r2.dev` | Needed before any 3D ships; ~1 hour of dashboard work |
| 3 | Is the Workshop willing to ship under GPL if the generator ever merges into the main bundle? | No — keep the separate origin, which makes the question moot |
| 4 | Ask Devon to put an explicit licence on `openforge-bases`' `.scad` files | Apache-2.0 is already declared at repo level; a per-file header removes all doubt |
| 5 | Run the 106 GB bbox pass? | **Not for v1.** Nothing needs it; strided range-reads cover it later for ~13 GB |

Items 2 and 5 are the only ones that touch the existing OpenForge infrastructure.

---

## 16. Known risks

1. **Import drift.** The catalog fixtures are a pinned snapshot; three separate artefacts
   (search payload, LOD store, share-link manifest) derive from it and none currently carries
   a shared version stamp. Add one, and regenerate them in the same CI step.
2. **md5 churn is the creator's normal workflow**, not an edge case — a re-exported mesh
   invalidates a LOD, orphans a share link and moves a manifest index, all silently.
3. **Tag drift.** `texture|towne|stone-stucco` and `texture|towne|stucco-stone` are the same
   material tagged twice with the words reversed, and both also exist as four-segment
   variants. One material, four tags. A normalisation layer sits between fixtures and UI.
4. **`postprocessing` pins three.js `<0.186.0`.** Upgrading three is a coordinated,
   deliberate event across three packages.
5. **Bus factor of one upstream.** `openforge-openscad` has 13 commits, all Devon's, dormant
   10 months; its own upstream is dormant since 2024. Adopting any of it means owning it.
