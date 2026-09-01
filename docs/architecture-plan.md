# OpenForge Workshop — Architecture Plan

**Status:** proposed, v2. Written 2026-08-29, revised after an adversarial review that found
nine irreproducible figures in v1.

**Every number in this document is machine-verified.** Run
[`verify-catalog-facts.py`](verify-catalog-facts.py) to re-derive them from the fixtures; it
prints the table and fails on a broken invariant. CI runs it. Where a figure is *not*
verifiable — a render timing nobody has measured, an estimate — it is labelled as such
inline. v1 of this plan quoted inherited numbers as measurements and several were wrong by
an order of magnitude; the script exists so that cannot happen silently again.

Companion documents:
- [`v1-pr-series.md`](v1-pr-series.md) — how v1 is cut into reviewable PRs, and what blocks them
- [`design-contract.md`](design-contract.md) — the approved visual design and its contract
- [`base-generator-integration.md`](base-generator-integration.md) — the OpenSCAD track
- [`texture-materials.draft.ts`](texture-materials.draft.ts) — the material registry

---

## 1. What this is

A static, zero-backend web app over the existing OpenForge asset bucket: a landing page, a
faceted catalog, a saved library, and a room builder producing a bill of tiles and a
download pack, plus a parametric base generator.

It reuses exactly two things. STL files and previews come from the existing public
Cloudflare R2 bucket. Tile metadata is imported from the catalog repo's JSON fixtures at
build time. No shared database, no shared API, no shared code.

**The fact that sets the architecture:** the full index over all 8,702 live tiles — carrying
tags *and* composition configs — measures **355.7 KB brotli** (5.42 MB raw, 465.7 KB gzip),
emitted and measured by the importer. At that size there is no reason for a query backend.
Search, faceting and constraint resolution run in the browser.

---

## 2. What the data actually says

Verified figures, with the definition each depends on. Definitions matter: v1 of this plan
quoted percentages whose definitions were never written down, and they did not reproduce.

### Footprints — three primitives, 86.9% coverage

| Primitive | Definition | Live tiles | Share |
| --- | --- | ---: | ---: |
| `RECT` | numeric `size|width` **and** `size|depth`, no curve/hex/concave marker | 3,051 | 35.1% |
| `WALL_SEG` | numeric `size|width` only; depth is the measured 12.7 mm constant | 3,116 | 35.8% |
| `ARC` | carries `size|radius` | 1,391 | 16.0% |
| `NONE` | no derivable footprint | 1,144 | 13.1% |

Cumulative: RECT alone **35.1%**, plus WALL_SEG **70.9%**, plus ARC **86.9%**.

The `NONE` bucket is larger than v1 of this plan claimed (it said 2.8%) because this
definition is deliberately strict: a tile marked hex, concave or convex without a radius has
no primitive that describes it, and placing it as a rectangle would be wrong rather than
approximate. Those tiles appear in the catalog and in the bill of materials, never in the
placement palette.

### Units and constants — measured from the meshes

Every STL is authored in millimetres at exactly **25.4 mm per catalog unit**, confirmed
bit-exact across 1,042 measured extents, with zero values below 2.0 mm ruling out inches.
Wall thickness measures **12.7 mm**. Both are hard-coded in the importer.

**The size tags are design-family labels, not measurements.** They agree exactly for 81% of
plain rectangles and diverge badly for curves, where the tag names the curve family while
the mesh is a fragment of it (median error 96 mm, max 163 mm). This is why `ARC` is
parameterised on radius and angle rather than on the tagged width and depth.

### Joinery — the catalog is a parts list

| Fact | Count | Share |
| --- | ---: | ---: |
| Carries `connection|openforge` — joinery delegated to a separate base | 4,363 | 50.1% |
| Carries a lock system (openlock / dragonlock / magnetic) | 5,271 | 60.6% |
| Carries **no** `connection|` tag at all | 349 | 4.0% |
| Carries 2+ distinct connection systems | 2,499 | 28.7% |
| Carries a *position* segment, e.g. `connection\|side\|openlock` | 2,079 | 23.9% |
| Is a base (`shape|base`) | 1,963 | 22.6% |

> **Reading `connection|` tags correctly matters.** The second segment is not always the
> system: `connection|side|openlock` names a *position* (2,079 tiles, 23.9%). Taking segment
> one blindly invents a "side" system and, worse, hides openlock from every tile that mounts
> it on the side. The first version of the verify script had exactly that bug, and it moved
> the lock reachability figures by up to 8 percentage points.

So a placement is an **assembly** — a base plus a topper — because half the corpus expects
its connector to live on a separately printed base.

### Lock system is a real, expensive choice

v1 of this plan claimed picking a lock system costs 0.1 percentage points of catalog access.
**That was wrong by two orders of magnitude.** Measured reachability, where a design is
reachable if it offers that lock or carries no lock at all:

| Lock system | Designs reachable | Share |
| --- | ---: | ---: |
| **openlock** | 3,817 / 3,822 | **99.9%** |
| dragonlock | 2,854 / 3,822 | 74.7% |
| magnetic | 2,282 / 3,822 | 59.7% |

**Spread: 40.2 percentage points.** Lock system is still a single global preference — you
cannot physically mix them in one build — but it is a consequential one. Consequences for
the UI in §7.

### Compositions are an accessory layer

| Fact | Value |
| --- | --- |
| Tiles declaring a config | 3,036 (34.9%) |
| Configs with exactly one slot | 2,501 (82.4% of configs) |
| Slots that are optional | 2,645 of 3,695 (71.6%) |
| `base` slots optional | 2,448 of 2,451 — **not all three exceptions** |
| Tiles with at least one **required** slot | 879 (10.1%) |
| **Self-sufficient tiles** | **7,823 (89.9%)** |

Nine tiles in ten stand alone. The three non-optional `base` slots are the infinite-hallway
pieces, which genuinely require a `shape|base|hallway`.

### Identity, and the two keys it needs

**171 md5 values are shared by 520 rows** — the same physical STL filed under two catalog
paths, which is correct data modelling and fatal to md5-as-primary-key. And **89 filenames
map to two or three genuinely different meshes**.

- **`id` = `full_name`** — catalog identity. React keys, placements, share links.
- **`blob` = md5** — content address. Deduping the bill of tiles and the download pack.

### Corpus scale

108.0 GB total, median file 10.36 MB, p95 32.89 MB, largest 108.9 MB. 38 distinct texture
roots; 89 tiles (1.0%) carry no texture tag. 2,978 tiles (34.2%) carry no `build|` tag, so
that facet needs a first-class "unspecified". **Zero bases carry `build|wall on tile`** while
857 toppers use that system — so bases must never be joined to toppers on the build tag.
(863 is the corpus-wide count: 857 toppers, 6 integral, **0 bases**.)

---

## 3. System architecture

```
                    ┌──────────────────────────────┐
   Browser ───────► │ workshop.openforge.tools     │  Cloudflare Worker + Static Assets
                    │  static SPA + catalog index  │  (SPA fallback routing)
                    └──────────────┬───────────────┘
                                   │
        ┌──────────────────────────┼───────────────────────────┐
        ▼                          ▼                           ▼
┌───────────────┐        ┌──────────────────┐        ┌────────────────────┐
│ objects.      │        │ zip Worker       │        │ scad.openforge.    │
│ openforge.    │        │ (fallback only:  │        │ tools              │
│ tools  (R2)   │        │  iOS, >1 GB)     │        │ SEPARATE ORIGIN    │
│ /models/      │        └──────────────────┘        │ OpenSCAD WASM      │
│ /sprites/     │                                    │ (GPL isolated)     │
│ /thumbs/  NEW │                                    └────────────────────┘
│ /lod/     NEW │
└───────────────┘
```

Four deliberate boundaries: the SPA holds no server state; R2 is read-only on its own custom
domain and never proxied through the Worker (egress is free, proxying would burn CPU for
nothing); the zip Worker is a fallback, not the default; and the OpenSCAD generator lives on
a **separate origin** so GPL obligations attach to a separately-conveyed artifact rather than
to the Workshop bundle.

---

## 4. The stack

All versions installed together and verified: **154 packages, zero peer conflicts.**

| Layer | Choice | Note |
| --- | --- | --- |
| Host | **Cloudflare Workers + Static Assets**, Wrangler 4.127.1 | Matches `@cloudflare/vite-plugin`'s peer floor exactly |
| Build | **Vite 8.2.2** + `@cloudflare/vite-plugin` 1.54.2 | Requires Node `^20.19 \|\| >=22.12`; pin `.nvmrc` to 22 |
| UI | **React 19.2.8**, pinned `~19.2` | r3f 9.7.0 peers `>=19 <19.3` — a React minor is an r3f-coordinated upgrade |
| Routing | **@tanstack/react-router 1.170.32** | `validateSearch` for typed, shareable filter state |
| State | **Zustand 5.0.15** + `persist` | `version`/`migrate` from the first commit |
| Styling | **Tailwind 4.3.3**, `@theme inline` | One token set feeds CSS and three.js alike |
| Primitives | **`@base-ui/react` 1.7.0** | Note the package name — `@base-ui-components/react` is the old scope and no longer resolves |
| Virtualisation | **react-virtuoso 4.18.12** | `VirtuosoGrid` assumes uniform item size — lock the card aspect ratio |
| Facets | **Uint32Array bitset**, ~40 lines ours | Also serves the composition constraint matcher |
| Text search | **ours** — a CSR inverted index, ~200 lines | No MiniSearch: fuzzy matching conflates `2x2` with `2x1`, so a size query silently returns the wrong size |
| 3D | **three 0.185.1** + **r3f 9.7.0** + **drei 10.7.8** | Do not exceed 0.185.x — `postprocessing` 6.39.4 peers `<0.186.0` |
| Materials | **`MeshStandardMaterial`**, flat per family | **Not TSL** — see below |
| AO | **N8AO 2.0.1** | What stops models dissolving into the parchment ground |
| Zip | **client-zip 2.5.0**, vendored | No `native-file-system-adapter` — its service-worker fallback truncates downstream of any byte counter we can write |
| Pipeline | **@gltf-transform/core 4.4.2** + **meshoptimizer 1.2.0** | Build-time only |
| Validation | **Zod 4.5.4** | |

Two required build settings: `resolve.dedupe: ['three']` (drei pulls a nested `three@0.170`
via `stats-gl`, the classic multiple-instances footgun), and vendoring `client-zip` and
`minisearch` into the repo, since both are small, load-bearing and quiet upstream.

### Why not TSL

v1 of this plan specified TSL node materials with object-space procedural noise. That is
withdrawn. `WebGLNodesHandler` lives in `examples/jsm/`, which three.js excludes from semver,
first appeared only in 0.184.0, and its own header documents the blocker: *"instanced mesh
geometry cannot be shared"* and *"node materials cannot be used with the compile function"*.
Instanced shared geometry is precisely the builder's rendering strategy. It also imports from
`three/webgpu`, so choosing the classic renderer does not avoid shipping the WebGPU
bundle — **425 KB gz against 129 KB**, more JavaScript than the entire catalog payload.

Flat per-family colour on `MeshStandardMaterial` with tuned roughness is the v1 material.
For hard-surface tiles whose detail is *modelled geometry* rather than texture, the
silhouette and normals already carry most of the information, and N8AO supplies the crease
definition. Procedural noise returns in v1.1 for the **detail viewer only**, where there is
one mesh, no instancing, and the documented limitations do not bite.

---

## 5. The data pipeline

A build-time importer, run in CI, producing one static index.

```
openforge-catalog fixtures (pinned commit + recorded SHA)
        │
        ▼   resolve footprint primitive (RECT / WALL_SEG / ARC / NONE)
        │   classify layer (base / topper / integral / insert)
        │   normalise connection vocabulary (fold topless, unsupported, flex)
        │   synthesise display name from tags; keep filename as metadata
        │   family = dirname(full_name)
        │   intern tags to integer ids
        │   assign append-only manifest ordinals
        ▼
   catalog index (static asset)  +  facts.json (the verify script's output)
```

**Measured: 355.7 KB brotli**, 71% of the 500 KB budget, asserted at import time.

The contingency this plan originally named — moving tags and configs to a lazily-fetched
second asset — turned out to be the wrong lever, and it was worth measuring rather than
assuming. Dropping every config saves 5.4 KB brotli; every tag array, 19.7 KB; both, 24.8 KB
(7%). They are enormous raw and nearly free compressed because there are only 916 distinct
tags and 104 distinct config refs. **The payload is the 8,702 catalog paths themselves.** At
41.8 bytes per record the budget is reached at roughly 12,200 records — 40% corpus growth —
and the fix at that point is shortening ids, not shedding fields.

### Open specification: composition constraint semantics

The fixture grammar is `require` / `deny` / `constrain{tag}` / `constrain{filter}`, and
`constrain` means "inherit this from the parent or a named sibling" — a *join*, not a filter.
**Its exact semantics are not yet pinned down, and every downstream number depends on it.**
Under one reading the median slot has thousands of candidates; under another, twelve.
Precomputed candidate sets range from 29 KB to 9.4 MB accordingly.

This is the largest single unknown in the plan and it is a research task, not a coding task.
It is scheduled explicitly in §14 and blocks nothing in v1. The existing catalog frontend
already implements it in `src/utils/config-processing.ts` (~140 lines with 69 Jest tests) —
port it and its tests rather than deriving new semantics from the 332-line spec.

---

## 6. Search and filtering

All client-side over the in-memory index.

- **Facets**: a `Uint32Array` bitset index with correct disjunctive counts — each facet's own
  counts computed with its own filter excluded, or selecting one texture makes every other
  read zero and the UI dead-ends. The same engine serves the composition matcher, which is
  why it beats adding a facet library that would still need a bitset for `constrain`.
- **Text**: a hand-rolled CSR inverted index over display name, filename and tags, with
  prefix matching and **no fuzzy matching**. Fuzzy was rejected on measurement, not taste:
  at edit distance 1 it makes `2x2`/`2x1` and `4x4`/`4x6` neighbours, so a size search
  silently returns the wrong size. Prefix matching is ~9 lines over a sorted token array.
- **Tokenisation is mandatory.** Under the mock's substring matcher, *every* multi-word query
  returns zero hits — "dungeon stone", "arrow slit", "cave wall" — because no filename
  contains a space and only five tag values corpus-wide do. Normalise `[|_+,%#.-]` to spaces
  and match on word boundaries, which also kills the trap where "cave" matches 658
  *con*cave pieces.
- **Synthesise a size token** at import (`"4x4"`, `"2r90"`). The literal string `4x4` appears
  in zero tags. Delete the mock's `x` → `×` rewrite: `×` occurs zero times in the corpus and
  applying it takes "4x4" from 347 hits to 0.

**Measured over the real 8,702-record corpus:** index build **32–40 ms warm, 73 ms cold**;
per query **45–375 µs**. The floor is the disjunctive pass itself (62 facet values × 272
words of fused `popcountAnd`); the ceiling is `wall` at 5,706 results to score and sort.
Build was optimised down from 92 ms with flat CSR buffers instead of ~900k `Array.push`
calls; the remaining ~60% is unavoidable tokenisation of 123,184 tokens. It runs alongside a
5.4 MB `JSON.parse` that costs more, so perceived load is unaffected, and every query is a
small fraction of a 16 ms frame.

Note that `tex` matches the texture *tag namespace*, not `record.texture` — that field holds
only the first root, so a vocabulary read off it has 37 values against a 38-root table.
Indexing the tags at every segment depth keeps all 38 usable and makes two-root tiles
findable under both names. Prefixes match on segment boundaries, so `cave` does not match
`cavern`.

| Facet | Widget | Why |
| --- | --- | --- |
| Kind | multi-select | `kinds: string[]` — 19.6% of tiles land in 2+ buckets, 11.6% in none. `shape\|door` has **zero** occurrences; a door is a component mounted on a wall |
| Texture | grouped, prefix-matching | 38 roots, not 6 chips |
| Build system | single-select + "unspecified" | 2,978 tiles (34.2%) carry no build tag |
| Connection | multi-select | 3,091 tiles (35.5%) carry 2–3 systems |

The mock fused build system and connection into one field. They are orthogonal; collapsing
them makes the OpenForge connector — the project's own flagship system — unreachable.

---

## 7. The Builder

### v1 is a plan view, not a 3D scene

A room layout **is** a plan. v1 renders the builder top-down from footprints and family
colours: no meshes, no LOD pipeline, no VRAM budget, no geometry dependency at all. It ships
a working builder immediately and removes the circular dependency that made v1 unshippable
in the previous draft (a 3D builder scoped into v1 while its geometry pipeline sat in v1.1).

v1.1 upgrades the same scene graph to 3D once the LOD pipeline exists. The placement data
model is identical in both, so this is a renderer swap, not a rewrite.

### Placement rules

**Place designs, not files.** There are **3,822 distinct designs** collapsing connection
variants, at 2.28 files per design. The user places a design; the concrete STL resolves at
download time from their lock preference.

> **Open risk.** Collapsing texture as well gives 2,428 designs at 3.58 files each, and the
> resolution step can then fail when a chosen texture+lock pair has no file. The importer
> must precompute, per design, which (texture, lock) pairs actually resolve, and the palette
> must grey out the rest. This is specified but not yet measured — it is a v1 task.

**Lock system is chosen once, and the cost is shown.** openlock is the default because it
reaches 100% of designs. Choosing magnetic removes about 40% of the catalog and
dragonlock about 25%, so the picker states the reachable-design count next to each option
rather than presenting them as equivalent.

**Assemblies.** Each placement resolves to a base plus a topper, matched on shape and
`size|openlock` code (A→2, BA→1.5, IA→1, D→3, Q→4) — **never** on the `build|` tag, since
zero bases carry `build|wall on tile` while 857 toppers need one.

**The code alone is not enough.** 2,364 of 4,363 openforge toppers (54.2%) publish no
`size|openlock` code at all, so a code-only join cannot satisfy the rule for the majority.
Footprint congruence is a second key and recovers 1,899 of them (80.3%); without it the
unmatched gap is 2,493 toppers rather than 594. Texture is a weighted preference only —
bases cover 15 texture roots against the toppers' 23 — and family is worthless as a join
key, since exactly **0** coded toppers have a same-family same-code base.

Of the 594 that still get no base: 129 are a base the corpus should have and does not,
21 are thin strips nothing supports, and 444 carry neither a code nor a footprint.

**Compatibility informs; it never refuses a placement.** One hard rule: every
`connection|openforge` piece needs a base line item, auto-inserted. Everything else is a
warning in the bill of tiles plus palette ordering.

**Snap to 0.5 units, with 1.0 as a coarse mode. Drop 0.25** — every dimension in the catalog
is a multiple of 0.5, so a quarter-unit grid can only produce unbuildable placements.
Rotation step is per-tile from `size|angle`, defaulting to 90°; **893 tiles carry an angle
that is not a multiple of 90** and would never tile on a 90° step.

---

## 8. 3D and the asset pipeline

Raw STL in the browser works for exactly one model in a detail viewer. The corpus is 2.12
billion triangles; twenty tiles at median size is ~198 MB.

| Surface | Geometry | Ships in |
| --- | --- | --- |
| Catalog grid | WebP thumbnail (new derivative) | v1 |
| Detail viewer, first paint | Existing sprite sheet | v1 |
| Detail viewer, "View in 3D" | Raw STL, gated at ~20–25 MB | v1 |
| Builder | Top-down plan view, no geometry | v1 |
| Builder | Decimated GLB LOD, `InstancedMesh` per design | v1.1 |

The LOD pipeline is glTF Transform 4.4.2 driving meshoptimizer 1.2.0, emitting
EXT_meshopt_compression GLBs to `/lod/{md5[:6]}/{md5}.glb`, keyed on the existing md5
addressing so it stays incremental. Draco is rejected: no release since January 2024, and a
100 KB decoder against meshopt's 7 KB.

> **The trap:** if facet normals survive into `weld()`, welding and therefore simplification
> silently no-op and you ship GLBs barely smaller than the STLs, with no error anywhere.
> Assert post-weld vertex count dropped materially and fail the job if it did not.

**Decimated meshes are preview-only.** The download path always serves the original STL.
Shipping a decimated mesh to someone's printer would be a serious trust failure.

### Two asset problems

**Thumbnails.** Sprite sheets average 529 KB and a 60-card screen decodes to hundreds of MB
of bitmap. Crop frame 0 to a 256 px q80 WebP at `/thumbs/{md5[:6]}/{md5}.webp` — roughly a
48× byte reduction for about **$0.04 one-time** and 125 MB of storage. Sprite sheets stay for
the detail view's multi-angle interaction.

**The sprite sheets are blue, not grey.** `stl-thumb` renders in a default blue Phong
material (ambient `#002142`, diffuse peaking `#3375c8`), verified against seven real sheets
and the tool's source; 99.8% of opaque pixels are non-neutral. This kills any plan to
CSS-tint the existing PNGs to match the material palette. **v1 accepts the split** — grid
thumbnails stay blue, the 3D views are tinted — and coloured re-rendering folds into the LOD
pipeline in v1.1, which has the geometry in hand anyway. This is a visible inconsistency and
should be a deliberate, stated decision rather than a surprise.

---

## 9. Material tinting

Colourless STLs are tinted from their `texture|` tag via a hardcoded registry:
[`texture-materials.draft.ts`](texture-materials.draft.ts).

**16 families covering all 38 texture roots.** Hue is anchored in measured dielectric albedo;
lightness and chroma deliberately are **not** physical, because real stone albedos sit 1.5–9
ΔE00 apart — below the just-noticeable difference at thumbnail scale — so physical accuracy
would render cut stone, dungeon stone, rough stone and cave identically and defeat the
feature. They were solved by constrained simulated annealing maximising the minimum CIEDE2000
distance across all 120 pairs, evaluated simultaneously under normal vision and Machado-2009
protanopia, deuteranopia and tritanopia.

Verified, per condition, re-derived from the shipped hex literals rather than restated:
normal **9.211**, protanopia **9.041**, tritanopia **9.043**, deuteranopia **8.864**.

The research pass claimed a single figure of 9.05 across all four. That does not reproduce —
**deuteranopia is 0.136 short of the 9.0 target**, and the port did not drift (every other
scalar reproduces to the digit, and the CIEDE2000 implementation passes all 34
Sharma–Wu–Dalal reference vectors). The shortfall is recorded in the invariants with the
target held separately, and each minimum is pinned to ±0.02 with its limiting pair, which
detects drift far more tightly than a `≥ 9.0` assertion would. Closing it means re-running
the annealing.

Also verified:
every family ≥12.3 ΔE00 from the parchment grounds and ≥12.2 from the UI accents. The map it
replaces had a minimum of 5.42 with all six entries inside a 15° hue band that the parchment
ground itself occupies.

Two rules that came out of measurement:

- **Silhouette is carried by a contour, not the fill.** Meeting WCAG 1.4.11's 3:1 against the
  parchment well with fills alone would force every material below L\* 50, destroying
  plaster, sandstone and ice. A contour at `oklch(min(0.36, L×0.72), C×0.70, H)` frees the
  fill band; measured contour contrast is 7.14:1 minimum.
- **Wear changes roughness, never colour.** A lightness/chroma modifier for `ruined` /
  `eroded` was implemented and measured: at any visible delta a worn tile reads as a
  *different family* (worn cut stone lands 4.06 ΔE00 from base plain). **1,562 tiles carry a
  wear tag; 1,538 resolve worn** — both are right and measure different things, the 24-tile
  gap being the pool set where the inset root wins and water has no grain to roughen
  are worn; wear moves roughness and grain only.

The registry drives both the plan-view fills in v1 and the 3D materials in v1.1.

---

## 10. Licensing — a launch gate

The corpus is **CC BY-NC-SA 4.0**. The OpenForge project's own statement is that everything
distributed via the Dropbox is non-commercial *even where the same design is BY-SA on
Thingiverse*, and this catalog is scanned from the Dropbox. Treat it as one constant.

**What NonCommercial actually prohibits** is use "primarily intended for or directed toward
commercial advantage or monetary compensation". A free tool that gives away the creator's own
models, funded by the creator's own Patreon, is comfortably inside that — including on a paid
Cloudflare plan, since paying a hosting bill is not commercial advantage. v1 of this plan
called for a blanket "non-commercial forever" commitment; that is **more conservative than
the licence requires**. The real obligations are narrower:

1. **No monetisation of the tool itself** — no ads, no paid tier, no sponsorship placement,
   and no gating downloads behind Patreon (that last is separately barred by the
   no-additional-restrictions clause).
2. **Attribution must ride inside the download.** A page footer does not travel with a zip.
   Ship `LICENSE.txt` and a per-file `ATTRIBUTION.csv` in every archive.
3. **Decimated preview meshes are Adapted Material** — label them "preview, not for
   printing", licence derivatives BY-NC-SA, keep them out of the download path.
4. **The index is a database of someone else's metadata.** Give it an explicit licence too;
   the plan previously covered only the STLs.

**GPL, stated correctly.** v1 of this plan justified the separate origin by claiming origin
separation prevents derivation. That reasoning is wrong. The correct reasoning is
**conveyance**: GPL obligations attach when you distribute the covered work, and a separately
served, separately built artifact is a separate conveyance carrying its own source offer.
The `.scad` geometry (`openforge-bases`) is Apache-2.0 and safe to bundle anywhere; the
OpenSCAD WASM binary is GPL-2 and `openforge-openscad` is GPL-3. Keep both on
`scad.openforge.tools` with a published source offer. **This is the one item where a lawyer's
read is genuinely worth buying** before launch.

---

## 11. Download

**Primary, in-browser:** `client-zip` generating a `ReadableStream`, landed via
the platform's own `showSaveFilePicker` where it exists, buffering to a Blob below 512 MB
where it does not. Feed `predictLength` from the index's `bytes` field, never HEAD — a HEAD
per file is hundreds of requests before the download starts.

**`native-file-system-adapter` was evaluated and rejected.** Its middle fallback is a
same-origin service worker, and a worker killed mid-transfer truncates the file *downstream
of any byte counter we can write* — in the browser's download manager, where we cannot see
it. An unverifiable streaming path is worse than an honest refusal, so the chosen path uses
no service worker at all and that failure mode does not exist. iOS Safari has no
`showSaveFilePicker`, so it always buffers and refuses above 512 MB; a gigabyte-scale room
cannot be downloaded as one file on an iPhone from a static site, and the Worker fallback
and URL list are the answers there.

Because STORE makes the predicted length exact, the stream counts its own bytes and fails if
they differ in either direction. That catches a short body behind an HTTP 200 — the classic
silent truncation, which is invisible in a streamed ZIP because entry sizes are written
last.

**Fallback, a Cloudflare Worker:** the same library streaming R2 objects, for iOS Safari and
multi-GB rooms.

- **Dedupe by md5** — 171 md5s are shared across 520 rows.
- **Disambiguate colliding filenames** — 89 filenames map to 2–3 different meshes; naming zip
  entries by filename silently overwrites. Prefix from `full_name`.
- **Size is a warning surface.** A 50-placement room at p95 is well over a gigabyte. Warn
  above a threshold and offer a URL list as the degradation path.

`client-zip` cannot compress, and 870 STLs are ASCII (which deflate 5–10×). That is a real
trade: an exact progress bar versus a much smaller download. **v1 takes client-zip**;
revisit on complaints.

---

## 12. Base generator

Full detail in [`base-generator-integration.md`](base-generator-integration.md).

- **Source of truth is `MasterworkTools/openforge-bases` (Apache-2.0)**, not the GPL-3
  `openforge-openscad`, which is a dormant fork of a third-party web GUI.
- **A working generator already exists in production** at `openscad.openforge.tools`. The
  cheapest credible v1 is to reuse it behind a `postMessage` bridge and only then decide
  whether to own the render path.
- **Don't write a customizer parser.** OpenSCAD's WASM build emits the parameter schema via
  `--export-format=param` — verified against the real `bases.scad`, 18 parameters.
- **Cross-origin isolation is not required.** Every shipped openscad-wasm build is
  single-threaded with unshared linear memory, verified from the binary's memory flags. Do
  not set COOP/COEP on the Workshop.
- **Catalog first, generate second.** The 1,962 catalogued bases *are* generator output —
  `bases.py` ran the same `.scad` with `-D` flags, and the fixture filenames encode the
  parameter tuples. Hash the parameters, look the result up in the catalog, fall through to
  WASM only on a miss.
- **Persist the recipe, never the mesh**, so share links stay small.

> **Render latency is unmeasured.** OpenSCAD was not installed on any machine used for this
> research, so no render was timed. The companion document's own §3.5 says so explicitly. A
> v0 spike must measure it before the UX commits to auto-preview; if a 4×4 base exceeds ~3 s,
> the design needs an explicit Generate button.

v1 excludes textured primary walls — they need 90 MB of blank STLs materialised before the
render.

---

## 13. Persistence and sharing

Zustand `persist` over `localStorage`, Zod-validated on rehydrate, `version`/`migrate` from
the first commit. Share links: a columnar **varint** payload → native
`CompressionStream('deflate-raw')` → base64url in the URL fragment.

**Measured capacity** in a 2,000-character URL, printed by the test suite on every run:

| Encoding | Room-shaped build | Scattered build |
| --- | ---: | ---: |
| naive array of objects | 554 | 159 |
| columnar JSON | 17,128 | 204 |
| **columnar varint (shipped)** | **29,713** | **243** |

A 50-tile room is a 116-character URL. Layout carries the room case; representation carries
the scattered case, which is genuinely incompressible — below about a hundred placements
`deflate-raw` returns more bytes than it is given. Delta-coding was measured and rejected at
~11% worse on the tight case.

**Cut over to a short link on measured encoded length, never on a placement count** — the
spread between the two shapes is 122×, so any count threshold is wrong by two orders of
magnitude at one end.

- **Manifest index drift is the worst silent failure in the system.** Share links encode
  integer ordinals into the build-time manifest; if an import reorders them, every existing
  link decodes to a *different room* with no error. Ordinals are append-only by
  representation (the manifest is an id array whose index *is* the ordinal), and drift is
  caught twice: the manifest version travels in every payload, and a 32-bit checksum over
  the `(ordinal, tileId)` pairs a link references catches renumbering nobody version-bumped.
  Scoping the checksum to referenced pairs means appending tiles leaves existing links
  valid. A link naming a *retired* ordinal cannot have its checksum recomputed, so that
  placement is dropped and reported — deliberately not flagged as drift, since a false alarm
  on a legal import would be worse.
- **Safari evicts localStorage after 7 days**, which for an app opened between game sessions
  is the normal case. Treat local state as a cache: every saved build gets a URL, and JSON
  export/import ships from day one.

---

## 14. Scope

**v1 — the catalog is the product.**
Landing; catalog with real facets, tokenised search and virtualised grid; library; tile
detail with the sprite viewer and a size-gated 3D view; **top-down plan-view builder** with
RECT and WALL_SEG footprints (70.9% coverage), assemblies, bill of tiles, client-side zip;
material tinting in plan view and the detail viewer; the thumbnail derivative pipeline; the
Cloudflare cache and CORS runbook; the design→(texture, lock) resolution table.

**v1.1 — the builder becomes 3D.**
The LOD pipeline; instanced 3D builder rendering; ARC footprints (→86.9%); procedural noise
in the detail viewer; composition accessory slots as inline sprite grids.

**v2 — generation and assemblies.**
Base generator on its own origin. Guided assemblies over the 40 recipe templates. Real
per-mesh dimensions via strided range-reads if curved footprints prove to matter.

**Research task, unscheduled and blocking nothing:** pin down `constrain` semantics (§5).

---

## 15. Decisions needed from a human

| # | Decision | Recommended default |
| --- | --- | --- |
| 1 | Publisher declaration: the Workshop is a free, non-monetised community tool | Adopt it — it satisfies NC without the over-broad "never commercial" commitment |
| 2 | Cloudflare zone admin for the cache/CORS runbook | **CORS first, cache second** — enabling edge caching before `access-control-allow-origin` is unconditional arms a cache-poisoning bug |
| 3 | Lawyer's read on conveying OpenSCAD WASM from `scad.openforge.tools` | Worth buying; it is the one genuine legal question here |
| 4 | Ask Devon for a per-file licence header on `openforge-bases` | Apache-2.0 is declared at repo level; a header removes doubt |
| 5 | Run the 106 GB bbox pass? | **No.** Nothing in v1 or v1.1 needs it |

Items 2 and 5 are the only ones touching existing OpenForge infrastructure. Item 5 is
declined, so item 2 is the only operational ask.

---

## 16. Known risks

1. **Import drift.** Three artefacts derive from the pinned fixture snapshot — index, LOD
   store, share-link manifest — and none currently carries a shared version stamp. Add one,
   regenerate them in the same CI step.
2. **md5 churn is the creator's normal workflow.** A re-exported mesh invalidates a LOD,
   orphans a share link and moves a manifest ordinal, all silently.
3. **`constrain` semantics are unspecified** and the precomputed candidate sets vary by two
   orders of magnitude depending on the answer. §5.
4. **Three.js is pinned by `postprocessing` to `<0.186.0`.** Upgrading is a coordinated event
   across three packages, and `resolve.dedupe: ['three']` is mandatory.
5. **Tag drift.** `texture|towne|stone-stucco` and `texture|towne|stucco-stone` are one
   material tagged twice with the words reversed, and both also exist as four-segment
   variants. A normalisation layer sits between fixtures and UI.
6. **Bus factor of one upstream.** `openforge-openscad` has 13 commits, all Devon's, dormant
   10 months; its own upstream is dormant since 2024.
