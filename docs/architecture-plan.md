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

### Footprints — 91.7%, and coverage going *down* is the system working

**This section has been wrong twice, and the retired "target" column is gone. Both corrections
stay recorded, because the second one refuted a fix the plan had already scheduled on the
strength of the first.**

| Primitive | Tiles | Share |
| --- | ---: | ---: |
| `rect` | 3,449 | 39.6% |
| `wall` | 3,079 | 35.4% |
| `arc` | 1,199 | 13.8% |
| `diag` | 121 | 1.4% |
| `column` | 119 | 1.4% |
| `tri` | 9 | 0.1% |
| `none` | 726 | 8.3% |
| **Coverage** | **8,003 → 7,976** | **91.7%** |

Run [`verify-catalog-facts.py`](verify-catalog-facts.py) for these; they are what the tests
assert against.

**Coverage is deliberately not monotone, and that is the point.** It went 86.9 → 91.5 → 92.0 →
91.7 as rows W3, W4 and W5 landed. **104 tiles have lost a footprint** across W4 and W5, because
measurement showed the footprint they had was wrong — a `QxG` tagged 4 units that is 3.000, a
floor tagged 2 that is 1.700 and would overlap its neighbour, a `7x7` fragment that is 5 × 2. A
number that only ever rises is a number nobody is checking.

The old "research classifier" column promised 95.1% with `RECT` at 42.9%. It is deleted rather
than kept for comparison: it was never measured, it was quoted once as though it had been, and
two rows have now been scheduled against figures derived from it.

**Correction 1.** An earlier draft quoted the research column alone and presented it as measured.
It was not; our own classifier said 86.9%.

**Correction 2, which matters more.** The plan then blamed the gap on one line: `hasCurveMarker`
was a **substring scan**, and 742 of the 1,144 `none` tiles carried a curve marker but no
`size|radius`, so making the scan segment-exact was "where the bulk of 86.9% → 95.1% comes from".

**That is false, and row W3 measured it.** Every one of the five markers occurs in the corpus only
as a whole `|`-segment. The substring scan hits 2,133 tiles and a segment-exact scan hits 2,077 —
**the difference is exactly the 56 `hex` tiles and nothing else.** Segment-exactness reclassifies
**zero** tiles on its own.

The real signal was stated separately in the data all along: **`size|segment|<letter>`, on 319
tiles** — "this file is one lettered piece of a design whose size token names the whole design".
About fifty measured bounding boxes settle it. A curve with no segment letter measures its tagged
pair exactly (`cut-stone#floor+curved.4x4` → 4.000 × 4.000). A segment measures something else,
**and not by any derivable rule**: `8x8+b` is 4.000 × 4.000 in one design and 2.079 × 1.931 in
another. So the pair is trustworthy exactly when there is no segment letter, and that test
replaced the veto.

That moved **403** tiles, not 742, and coverage to **91.5%**, not 95%. The other 339 cannot move
on tags alone: 283 are fragments whose real extent only measurement supplies, and 56 are hex
corners carrying no size tag at all. They are still `NONE`, but now for a true reason.

**Then W4 and W5 moved it again, in both directions.** W4 added `COLUMN` (119), `DIAGONAL` (121)
and a right triangle (9), de-arced the 84 `xG` walls, and found the rule that closed the
angle-less arcs for good: **a radius is an outline only when no tag reassigns it to a feature** —
the `xG` interface, the `inverted` cut and the `lintel` arch, summing to exactly the 165 tiles
that carried a radius and no sweep. `DEFAULT_ARC_SWEEP_DEG` is deleted, not defaulted.

W5 then reshaped `arc` into an annular sector and sent a further **27** curved-interface floors to
`NONE` rather than fabricate a band for shapes measured not to have one. Two of the five bands —
`convex` and `s2w_radial` — have **no accepted measurement at all** (43 attempted and refused, and
10 never attempted), so they carry a written fallback that the schema refuses to let anyone stamp
as measured.

**What remains in `NONE` (726) is a four-part partition**, printed by the oracle and asserted
disjoint and exhaustive: **319** `size|segment` fragments · **42** whose tessellation code was
refused (28 `U`, ambiguous; 14 `col+T`, unmeasured) · **27** curved-interface floors · **338**
with none of the three. W3's earlier three-part partition of 741 is superseded.

Three primitives are genuinely new, and one of them turned out to be two. **`COLUMN`** is
0.5 × 0.5 — one wall-thickness square — placed on **119** tiles, not the ~133 the tag population
suggests, because `col+T` is the one letter nobody measured and W4 refuses it. **`DIAGONAL`**
split into two union cases: **`tri`** (**9** tiles, a filled right triangle for `O`/`OA`) and
**`diag`** (**121**, a 45° wall run of `2√2 × 0.5` for the `P` family). They are separate cases
because a filled triangle and a half-unit strip need different collision geometry, and counting
them as one family undercounts it by the 9.

**Curved tiles are placeable, and the primitive is an annular sector, not an arc segment.**
Centre sits at a bounding-box corner, with `bboxX = rOut − rIn·cos θ` and `bboxY = rOut·sin θ`
— verified to ±0.002 units. Four of the five bands come from a modifier: `radial` → `[R−2, R]`,
`convex` → `[R−0.5, R]`, `concave` → `[R, R+0.5]`, `s2w` radial → `[R−1.5, R]`.

**The fifth band, `disc` (`[0, R]`), is spelled by no modifier at all** — and that is the whole
reason the code lookup exists. `V` and `VxE` carry *identical* tags and are a quarter disc and an
annular band respectively, so nothing but the `size|openlock` letter separates them.

**The rule did not cover a fifth of the tiles it would be applied to, and that is why measurement
went first.** Of the 1,391 arcs then in the bucket, 292 (21.0%) carried no band modifier at all.

**Settled.** Of the **1,199** arcs now, **136** carry no modifier. 27 of those were de-arced
entirely, leaving **109**: **54** resolve from a `size|openlock` curve code (`X` 18, `XA` 18,
`F` 6, `V` 6, `VxE` 6 — every one a mesh W1 measured), and **55** take the written `radial`
default, stamped `fallback` even though the rule itself is measured, because *the assignment* is a
default. The `shape|option|curved_interface` tiles are no longer among them: they do not reach
the arc bucket at all.

**The fabricated sweep is gone.** `DEFAULT_ARC_SWEEP_DEG = 90` invented one for 84 `xG` walls
plus 81 others; W4 deleted the constant rather than re-defaulting it, and the verifier asserts no
arc lacks a `size|angle`. See §16 item 9.

> **A correction to an earlier draft of this plan.** It claimed *"radius 3 and angles
> 60/120/240/270/300 place 84 tiles as bogus arcs."* Measured, that is wrong twice.
> `footprintKind` enters the arc path **only** on `size|radius`, and those tiles have none — the
> 48 tiles at angle 60 all classify as `wall`, and the 82 at 120/240/270/300 all as `none`. Zero
> are routed through the arc path. The 84 mis-shaped tiles are the `xG` codes, by a different
> mechanism. Sixteen radius × angle combinations exist, not eleven — and the five *without* an
> angle are the fabricated-sweep bug.

### The OpenLOCK tessellation codes are footprints, not sizes

Full detail in [`openlock-tessellation.md`](openlock-tessellation.md).

38 codes appear in `size|openlock`, on 4,030 tiles (46.3%). This plan previously treated them
as a width lookup (A→2, BA→1.5, IA→1, D→3, Q→4). **That is not what they are.** Printable
Scenery's own developer documentation is explicit: *"Footprint Code: this refers to the
tessellation footprint for each tile… any A-Tile will have the same footprint as any other
A-tile."*

They are a **shape taxonomy with per-family size ladders**, plus a second colliding namespace
for columns. Six families: straight wall runs (IA/BA/A/D/Q = 1/1.5/2/3/4), rect floors, 1×1
cells distinguished by port topology, 45° diagonal walls, curves, and columns.

**`I` does not mean "inch" or "interior"** — it denotes the **1×1 cell**, and the second
letter is junction topology on the plumbing-fitting convention: `O` none, `I` two opposite,
`L` corner, `T` three, `X` four. `IA` is the exception and belongs to the wall ladder.
`xG` is a modifier meaning "cut to mate with a G curve". The trailing A/B/C is a family
ladder that is **inconsistent** — sometimes a larger footprint, sometimes only an alternate
port layout — so it must not be implemented as a rule.

Two constants this plan was missing, both measured and independently cited: **wall thickness
is 0.5 units (12.70 mm)**, so a wall's footprint is `length × 0.5` rather than a line; and
**a column is 0.5 × 0.5**.

**`size|openlock` is not a footprint key.** Code `O` carries both 2×2 and 4×4 tiles (43 of
them). It also merges `U` with `Y`/`YA`/`Z`/`ZA`. The assembly resolver matches bases to
toppers on this code — see §16 for why that is currently latent rather than live.

Nine codes (≥100 tiles) account for 83.7% of coded tiles; the five wall-run codes alone are
2,822 tiles, 32% of the whole corpus. Thirteen codes are a sub-20-tile tail.

**The official cheat sheet carries no dimensions at all.** It is purely pictorial — read at 3×
across four quadrants, its 59 labels give shape identity and port positions only. No complete
official code-to-dimension table exists; Printable Scenery was asked on its own forum and
never answered, and `openforge-tutorials` defers to them. Every dimension in our table is
therefore either measured from a mesh or explicitly marked an inference.

### Tiles aggregate into one catalog item per design

Full detail in [`tile-aggregation.md`](tile-aggregation.md).

A design's base-integrated and base-less variants become **one catalog item**. The builder
resolves a variant from the build's lock system at download time, falling back to the base
auto-insertion the assembly resolver already performs.

**Integrated bases are detectable at 100% precision / 99.9% recall** via `layer === 'topper'`
(equivalently, `connection|openforge`), validated against the filename's connection token — an
independently authored signal no candidate rule reads. Four false negatives, all corpus
defects.

The intuitive rule is a trap: **`shape|base` plus another kind is 0% precise on 1,277 tiles.**
`shape|base|wall` means *a base shaped to receive a wall*, not a wall carrying a base. Polarity
exactly inverted.

**The existing `design` key already groups them** — 931 of 3,822 aggregates (24.4%) hold both a
topper and an integrated variant. **The collapse is lossless:** zero aggregates hold two
distinct values of `texture`, `build`, `kinds`, `sizeCode`, `rotStep`, `foot` or `name`, so
there is no new title logic and no facet re-derivation.

Coverage with aggregation plus base fallback — *can the builder hand you a printable
assembly?*

| Lock | Integrated outright | **With base fallback** |
| --- | ---: | ---: |
| openlock | 1,497 (39.2%) | **3,375 (88.3%)** |
| dragonlock | 359 (9.4%) | **3,118 (81.6%)** |
| magnetic | 255 (6.7%) | **3,008 (78.7%)** |

**Spread 9.6 points, against §2's 40.2.** The two measure different questions — §2 counts a
lock-less design as reachable — but aggregation turns the lock choice from a 40-point cliff
into a ten-point one. **446 designs are buildable under no system at all**, and that is an
exact partition: 94 insert-only, 93 with untagged joinery, 259 topper-only with no matching
base. 2,988 build under all three.

**This table has moved three times and the movement is the interesting part.** The research
measured 3,199 / 2,928 / 2,818 (83.7 / 76.6 / 73.7); row A1 measured 3,352 / 3,087 / 2,977;
row A7 measures the figures above. The fixtures never changed — it is the same pinned commit
throughout. **The pipeline changed underneath it:** W3 and W4 gave 403 and then 249 more tiles
a footprint, so more toppers resolve a congruent base, and every one of those gains lands
here. A7 confirmed the figure is definition-independent — three different readings of
"buildable" return 3,375 / 3,118 / 3,008 exactly.

**The two readings rank the systems identically** — openlock, then dragonlock, then magnetic,
both times — but the spread collapses, and dragonlock sits 6.7 points behind openlock on
buildability against 25.2 on tags. Nothing in the picker assumes the orders agree; a test
proves a corpus where they diverged would reorder the options.

**The tier-1 column runs the other way, and that is the real cost of choosing magnetic.**
1,497 openlock designs print as one part against magnetic's 255 — so a magnetic build is two
printed pieces almost every time, which is not a percentage of the catalog and would be
invisible in a single bar.

**Nothing is deployed, so no share link, saved library or stored scene exists to preserve.**
That removes the migration constraint the aggregation research worked around: ordinals can be
renumbered freely, the store's version ladder can be collapsed to a single current version, and
the aggregation key can be chosen on merit rather than on compatibility. The research's
conclusion survives that relaxation — `design` was chosen because the collapse is lossless and
produces exactly the 931 wanted merges, not because it preserved anything.

**The append-only ordinal rule still applies from launch onward**, and getting the scheme right
before the first published link is the whole point of writing it down now. **Aggregate ordinals
must never enter the manifest**: an aggregate is a hash of a tag set and can therefore *split*,
and a splittable grouping has no stable append-only index. An aggregate's URL address is the
lowest ordinal in its group — stable under append, **not** under retirement (44.6% exposed),
which is acceptable only because it is a canonical URL and never a share link.

**What aggregation must not claim.** The corpus carries no print time, filament or support data
at any resolution, and `bytes` is mesh complexity rather than material. The assumed trade is
also false: the integrated/topper byte ratio has a median of **1.027**, 27.4% of integrated
variants are *smaller* than their topper, and summed over 873 resolvable pairs topper+base is
**0.96×** the integrated route. **Integrated saves part count, not filament**, and the card
should claim only that. 42.2% of multi-file aggregates spread more than 1.25× in bytes, so a
single figure per card hides real variation — the variants table ships in the same PR, never
behind a closed accordion.

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
| Carries 2+ distinct connection systems | 2,493 | 28.6% |
| Carries a *position* segment, e.g. `connection\|side\|openlock` | 2,079 | 23.9% |
| Is a base (`shape|base`) | 1,963 | 22.6% |

> **Reading `connection|` tags correctly matters.** The second segment is not always the
> system: `connection|side|openlock` names a *position* (2,079 tiles, 23.9%). Taking segment
> one blindly invents a "side" system and, worse, hides openlock from every tile that mounts
> it on the side. The first version of the verify script had exactly that bug, and it moved
> the lock reachability figures by up to 8 percentage points.
>
> `bottom` (6 tags), `left` (1) and `right` (1) are the same bug at a 260th of the scale, and
> were missing from the position vocabulary until they minted phantom systems on 8 records —
> which is why "2+ distinct connection systems" reads 2,493 rather than the 2,499 earlier
> drafts quoted. **Position is now carried rather than flattened**, because 0 of the 4,363
> toppers carry a lock on their own underside: the 1,283 that name one name it on the side.
> `connections_by_position()` in the verify script and `connectionsByPosition()` in
> `pipeline/facets.ts` are the two implementations, cross-checked per layer.

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
                    ┌──────────────────────────────────────────────┐
   Browser ───────► │ workshop.openforge.tools                     │  Worker + Static Assets
                    │  static SPA + catalog index                  │  (SPA fallback routing)
                    │                                              │
                    │  ┌────────────────────────────────────────┐  │
                    │  │ base generator — PART OF THIS APP      │  │  lazy chunk,
                    │  │ vendored .scad (Apache-2.0)            │  │  no second origin
                    │  │ + OpenSCAD WASM (GPL-2, own chunk)     │  │
                    │  └────────────────────────────────────────┘  │
                    └──────────────┬───────────────────────────────┘
                                   │
        ┌──────────────────────────┴──────────┐
        ▼                                     ▼
┌───────────────┐                    ┌──────────────────┐
│ objects.      │                    │ zip Worker       │
│ openforge.    │                    │ (fallback only:  │
│ tools  (R2)   │                    │  iOS, >1 GB)     │
│ /models/      │                    └──────────────────┘
│ /sprites/     │
│ /thumbs/  NEW │
│ /lod/     NEW │
└───────────────┘
```

Three deliberate boundaries: the SPA holds no server state; R2 is read-only on its own custom
domain and never proxied through the Worker (egress is free, proxying would burn CPU for
nothing); and the zip Worker is a fallback, not the default.

**The generator is part of this app**, not a separate service. The original catalog embedded
someone else's generator behind an iframe; this one is ours — the Apache-2.0 `.scad` geometry is
copied in and maintained here, and OpenSCAD's own WASM engine sits in a lazily-loaded chunk with
no static import path into app code. §10 records the licensing consequence honestly rather than
arguing it away.

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
**Its exact semantics are now pinned down — row C1 ported them from the catalog's own
`config-processing.ts` with all 69 of its tests rather than deriving them from the spec.**
Under one reading the median slot has thousands of candidates; under another, twelve.
**Closed by row C1, and the plan had the wrong worry.** The 9.4 MB was a *raw* figure: the
fattest encoding measured is 15.1 MB raw but **37,542 B brotli**, which the remaining budget
absorbs three times over. Measured, per reading:

| Reading | Sets | Median candidates | Brotli |
| --- | ---: | ---: | ---: |
| wide — `constrain` deferred | 110 | 1,868 | 513 B |
| ported — per tile-slot, ordinals | 3,695 | 14 | 3,606 B |
| ported — ids as strings | 3,695 | 14 | 37,542 B |
| every sibling-selection state | 99,931 | — | 5,767 B |
| **shipped: nothing** | — | — | **0 B** |

**Payload was never the binding constraint. Correctness is.** `constrain` reads *sibling
selections*, which are runtime state, so every precomputed row above is stale after one click
— and 535 tiles carry two or more slots. So C1 emits **0 bytes** and derives at selection time,
for 1,438 B brotli of JavaScript and a 339,756 B in-memory index.

The plan's "thousands versus twelve" reproduces exactly — wide median **1,868**, ported median
**14**, a 133.4× narrowing — because `parent` defaults to true, so a slot is narrowed *before
any interaction*. 76.9% of slots then have under 50 candidates.

The corpus settles the semantics independently: **all 91 `require` refs exist as exact tags and
none of the 4 `constrain` roots does** — `shape`, `size|depth`, `size|width` and `texture` are
namespace prefixes that are not tags. One matching rule for both could not produce that split.

This was the largest single unknown in the plan. It turned out to be a research task whose
answer was already written down in the catalog repo, and porting it — rather than re-deriving
it — is what made the corpus cross-check above possible. The existing catalog frontend
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
and the tool's source; 99.9% of opaque pixels are non-neutral, mean rgb (54,117,192).

**The thumbnail derivative is therefore desaturated, and this replaces the earlier "accept
the split" position.** That position was taken before the pipeline existed; measuring it
overturned it on three independent grounds:

- **14.7% smaller** — 29.6 MB against 34.7 MB corpus-wide.
- **It halves the grid/builder disagreement even untinted.** Against the 16 material family
  tints the plan view fills with, sprite blue sits at a mean **31.6 ΔE00**; a neutral grey at
  **17.7**. The nearest family to sprite blue is `water` at 15.0 — so with blue thumbnails
  *every stone tile in the grid reads closer to water than to its own material.*
- **It is the only variant that can be tinted later.** A luma-preserving greyscale with alpha
  can be tinted per material through `feColorMatrix`, keeping both alpha and shading. Blue
  cannot. So this is the enabling step for the grid ever agreeing with the builder, and it
  needs no re-render when the LOD pipeline lands.

Blue remains available (`--tone blue`) for anyone who wants the raw render.

Two things measurement weakened rather than confirmed: frame 0 wastes ~85% of its area on
transparency, but so does **every** frame (10.8–15.1% opaque), so that is the renderer's
fixed camera margin and not a bad choice of frame; and a trim-to-content crop is the real
win but breaks the uniform square the grid needs, so it belongs with the v1.1 LOD
re-render.

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

**GPL, stated correctly, and the boundary has moved.** Licences verified against the registry:
the `.scad` geometry (`openforge-bases`) is **Apache-2.0** — and pushed more recently than the
fork — so it is safe to copy in and modify; the OpenSCAD WASM engine is **GPL-2.0**; the
`openforge-openscad` web GUI is **GPL-3.0**, and we copy nothing from it.

An earlier draft put the engine on a separate origin, justified by **conveyance**: GPL
obligations attach when you distribute the covered work, and a separately served, separately
built artifact is a separate conveyance carrying its own source offer. That reasoning was sound.

**The generator is now in-app by decision**, which removes that boundary. The question becomes
whether this app is a derivative work of a dynamically-loaded GPL-2 WASM engine — a legal
question, not a technical one. What actually mitigates it: the engine lives in its own chunk with
no static import path into app code, nothing is copied from the GPL-3 fork, and the licence text
plus a written source offer ship with the app. What does *not* mitigate it is confident reasoning
about linking. **This is the one item where a lawyer's read is genuinely worth buying**, and it
gates the generator rows rather than the whole series.

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
- **The generator is part of this app.** No second origin, no third-party service, no
  `postMessage` bridge — the owner's stated preference, and the design follows it. The earlier
  plan proposed reusing `openscad.openforge.tools` behind a bridge; that is superseded.
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

### Render latency — measured, and the cost model was wrong three ways

Row **S2** installed both builds (`2026.01.02.wasm30347` WASM, `.ai30348` native — same day's CI
builds, so the comparison is controlled) and timed 51 configurations at 21 renders each.

**Verdict: auto-preview, debounced. No Generate button.** A 4×4 base is **437 ms median /
481 ms p95** against the ~3 s threshold — 7× under. Nothing came within 2.5× of 3 s; the slowest
shippable configuration is a 4×4 high dragonlock riser at 933 ms / 1.16 s p95. Debounced rather
than live because 15 of 46 configurations exceed a 250 ms live-interaction budget on geometry
alone.

**One hard condition: `--backend=manifold` is mandatory.** WASM CGAL is **7.8 s at 2×2 and
16.0 s at 4×4** — 5× *over* the threshold. Dropping that one flag reverses the verdict. (Current
builds default to Manifold; the note elsewhere that the CLI help reads `'CGAL' (old/slow)
[default]` is stale for 2026.01.02, though a pinned older build still defaults to CGAL.)

**`$fn` is not a lever at all.** The plan flagged 89 `$fn=200` as the likely cost driver.
`-D '$fn=50'`, `200` and `400` produce **byte-identical output**, because every `$fn` in the
vendored set is a *call-site argument* rather than a top-level assignment. It cannot be tuned
from outside without editing the vendored files, so "reduce tessellation to go faster" does not
exist.

**What actually dominates:** backend 19–35×, entry point up to 7×, lock ~1.4×, magnets 1.3–2.6×,
and **size is nearly flat** — 1×1 to 8×8 is a *53× triangle range for 6× the time*, with
per-1,000-triangle cost falling from 45 ms to 5 ms. The cost is the fixed CSG tree, not the
output.

That refutes §3.4's watchdog advice, which offers "drop magnets, or step the size down one" as
the two levers that move render time. Stepping down barely helps. And **for dragonlock, dropping
magnets is backwards**: magnets *off* yields more triangles (12,304 vs 10,976) and a slower
render.

**The triangle extrapolation was half right.** The formula `(bytes − 84)/50` is exact on 48 of 48
meshes, but every estimate overstates triangles by a consistent **3.46–3.68×**, and the
triangles-to-seconds mapping was one to two orders out — 8×8 grid+dragonlock was estimated at
12–40 s and measures **705 ms**. The consistent 3.6× suggests the catalogued STLs those byte
counts came from were generated by an older CGAL-era OpenSCAD.

**The startup floor is the real split**: 281 ms on WASM against 28 ms native, which is 65–80% of a
small render. A worker holding a compiled `WebAssembly.Module` pays it once, so the engine must be
long-lived.

**Two cautions for the panel.** Native and WASM do **not** produce identical meshes (45/48 match; a
curved 4×4 differs by +26 triangles), so a generated base is not byte-identical to the catalogued
STL of the same parameters and the UI must not claim it is. And `connectors.scad` at the pinned
commit emits `Ignoring unknown variable "DUAL"` on **48 of 48** configurations — an ignored
variable is a branch not taken, so that is part of what the default geometry is.

**Still unmeasured:** a real browser. Everything above is V8 in Node, so the worker boundary and
**iOS Safari's much lower WASM heap cap** are untested. iOS is the risk — heap growth returns
`false` rather than throwing.

Textured primary walls are excluded, permanently rather than for v1: `bases-wall-primary.scad`
needs ~90 MB of blank texture STLs materialised before `import()`, upstream ships 36 of them at
82.9 MiB, and a customizer enum cannot disable individual values — so shipping it with nine of ten
options broken would be worse than not shipping it. Sculpted-texture bases have no OpenSCAD path
at all. **Textured and sculpted bases come from the catalog's pre-generated files or not at all,
and the UI must not imply every base is parametric.**

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

**v1 — shipped.** Landing; catalog with real facets, tokenised search and a virtualised grid;
library; tile detail with the sprite viewer and a size-gated 3D view; top-down plan-view builder
with RECT and WALL_SEG footprints, assemblies, bill of tiles, client-side zip; material tinting;
the thumbnail pipeline; the deployment surface. 34 PRs, 1,276 tests.

**v2 — the target, and the end of the plan.** One series, no further deferral. Detailed in
[`v2-pr-series.md`](v2-pr-series.md). Nine workstreams:

1. **Tessellation-aware footprints** — six primitives, curves as annular sectors. Coverage is
   **91.7% after rows W3, W4 and W5**, not the 95.1% this plan once promised; §2 records why. The 165
   angle-less tiles are not merely mis-swept — row W1 refused all 165 as non-sectors, so the
   primitive is wrong for every one of them.
2. **Tile aggregation** — one item per design, lock resolved per build, variants disclosed.
   Includes the topless tie-break defect and the positional `conn` correction.
3. **Greyscale-then-tint previews** — luminance computed in the browser from the blue sprites,
   tinted per material family. Works before the `/thumbs/` backfill, and makes the grid agree
   with the builder for the first time.
4. **The LOD pipeline** — decimated GLB per tile, so the builder can render real geometry.
5. **3D builder** — instanced rendering over the same placement model the plan view uses.
6. **Compositions** — `constrain` semantics resolved, accessory slots as inline sprite grids,
   dead-end greying. 3,036 tiles carry a config and none of it is built.
7. **Guided assemblies** — the 40 recipe templates as first-class objects.
8. **The base generator, inside this app** — the Apache-2.0 `.scad` geometry copied in and
   maintained here, OpenSCAD's own WASM engine in a lazily-loaded chunk, parameters from
   `--export-format=param`, catalog-first resolution. No second origin and no third-party
   service: the original catalog embedded someone else's generator behind an iframe; this one is
   ours. The licensing consequence is real and is recorded as a blocker — bundling a GPL-2 engine
   in-app moves the copyleft question from *"is this separately conveyed"* to *"is our app a
   derivative work"*, which needs a legal read rather than a technical argument.
9. **True mesh dimensions** — strided range-reads where the size tags diverge, which on curves
   is a median 96 mm.

**No v1.1.** Curved tiles matter, so the work that was deferred behind them comes forward.

---

## 15. Decisions needed from a human

| # | Decision | Recommended default |
| --- | --- | --- |
| 1 | Publisher declaration: the Workshop is a free, non-monetised community tool | Adopt it — it satisfies NC without the over-broad "never commercial" commitment |
| 2 | Cloudflare zone admin for the cache/CORS runbook | **CORS first, cache second** — enabling edge caching before `access-control-allow-origin` is unconditional arms a cache-poisoning bug |
| 3 | Lawyer's read on bundling GPL-2 OpenSCAD WASM in-app | **Waived by the project owner.** The mechanical obligations are satisfied by construction instead: engine vendored verbatim in `vendor/`, complete unmodified licence text, a written source offer naming the exact release, its own dynamically-imported chunk, nothing relicensed |
| 4 | Ask Devon for a per-file licence header on `openforge-bases` | Apache-2.0 is declared at repo level; a header removes doubt |
| 5 | Run the bbox pass? | **Run, and done.** v2 needs it: row W1 measured 1,163 meshes exactly, 11.05 GB read in 33 minutes. Not 106 GB, because only the tiles the tags cannot describe were read. R2 charges no egress, so it cost wall-clock rather than money |

Items 2 and 5 are the only ones touching existing OpenForge infrastructure. Item 5 is done
(11.05 GB of free-egress reads, ~2,400 Class B operations, no load on the Lambda or the
database), so item 2 is the only remaining operational ask.

---

## 16. Known risks

1. **Import drift.** Three artefacts derive from the pinned fixture snapshot — index, LOD
   store, share-link manifest — and none currently carries a shared version stamp. Add one,
   regenerate them in the same CI step. *Not urgent while nothing is deployed; it must be in
   place before the first published share link.*
2. **md5 churn is the creator's normal workflow.** A re-exported mesh invalidates a LOD,
   orphans a share link and moves a manifest ordinal, all silently. *Same timing: this is a
   launch gate, not a present hazard.*
3. **`constrain` semantics are unspecified** and the precomputed candidate sets vary by two
   orders of magnitude depending on the answer. §5.
4. **Three.js is pinned by `postprocessing` to `<0.186.0`.** Upgrading is a coordinated event
   across three packages, and `resolve.dedupe: ['three']` is mandatory.
5. **Tag drift — and this entry's premise was wrong.** It claimed
   `texture|towne|stone-stucco` (72) and `texture|towne|stucco-stone` (72) are one material
   tagged twice with the words reversed. **They are not.** Row D3 measured a perfect 1:1 mirror
   over 72 shape keys: the two files sit in the same directory with different md5s and
   different byte sizes. They are 158 separately printable models with the two wall courses
   swapped, and the same holds for the four-segment pair over 7 shape keys. Collapsing those
   tags would have erased a real distinction.
   The defect was real but elsewhere: all four spellings mapped to *two* material families, and
   a renderer with one colour per tile cannot draw course order, so a per-spelling family
   encoded a distinction it cannot express and was wrong half the time. Fixed in the mapping.
   The only genuine drift was `foundation` (51) / `foundations` (2), collapsed on the way in —
   roots 38 → 37 across all tags, 37 → 36 in first position, and the registry deliberately
   still maps 38 as the raw-fixture fallback.
6. **Bus factor of one upstream.** `openforge-openscad` has 13 commits, all Devon's, dormant
   10 months; its own upstream is dormant since 2024.
7. **Closed by row D1: topless auto-inserts under openlock went 79.1% → 0.** Ranking now keys on
   suitability, with the print option graded and outranked only by the lock, so a topless base can
   win only where every plainer candidate lacks the lock — 3 cases corpus-wide, all magnetic, all
   disclosed in the note. One sub-claim below was wrong: reachable bases do *not* simply rise.
   The raw count under openlock **falls 110 → 109**, because two candidate sets converged on a
   base a third already reached; what widens is the product range, full bases 18 → 109. Original
   entry follows.
   **The base auto-insert picks topless bases.** `assemblyIndex.byCost` sorts candidates
   bytes-ascending, so the smallest wins every tie — and under openlock **79.1% of
   auto-inserted bases are `topless`** (magnetic 43.0%, dragonlock 0.1%). A topless base has no
   top surface: it is a different *product*, not a cheaper print, and it is currently chosen
   silently and never disclosed. Only 110 of 1,963 bases are ever handed out, and the chosen
   base changes for 86.3% of toppers between openlock and dragonlock. **This is a live defect**
   and the tie-break must be fixed before aggregation ships on top of it.
8. **`size|openlock` is not a footprint key, and the resolver matches on it.** Code `O` carries
   both 2×2 and 4×4 tiles. Measured today: 5 `O` toppers, **0 `O` bases**, so the
   footprint-congruence fallback catches them and the mismatch is **latent, not live**. It
   becomes live the moment a base with code `O` is added. Guard it with a test rather than a
   comment.
9. **Closed. 165 arc tiles had no angle, and row W1 found the primitive was wrong for every one.**
   All 165 were refused by the annular-sector fitter, so `DEFAULT_ARC_SWEEP_DEG = 90` did not
   merely invent the wrong *number*: none of those tiles was a sector at all.
   The measured split is **84 `xG` straight walls + 60 `inverted` + 21 `lintel` = 165**. An
   earlier version of this entry wrote 40 inverted, 6 lintel and 20 inverted risers, which sums
   to 150, not 165 — it was drafted from an estimate rather than from the measurement.
   An `inverted` tile is a square plate with a curved *cut* — the complement of a sector — and its
   tagged pair matches its box exactly, which is why 24 of them became `rect`. A lintel's radius
   is the *arch it drops into*, not the lintel: 1.31 × 0.48 against a sector box of 2 to 4 units.
   W4 closed the whole set with one rule — **a radius is an outline only when no tag reassigns it
   to a feature** — and deleted the constant rather than re-defaulting it. After W5 that rule
   covers **192** tiles: the 165, plus the 27 curved-interface floors, which carry a sweep and
   were refused a sector fit anyway.
10. **Closed by row D2.** Position is preserved as a parallel projection, with the flat reading
   derived from it so the two cannot drift; the vocabulary went 10 systems → 7, and the verifier
   now fails if any system is ever named after a position. Original entry follows.
   **`record.conn` flattens connection position away.** **0 of 4,363 toppers carry a bottom
   lock** — the 1,283 that carry one carry it on the *side*. An aggregate built on `conn` would
   advertise bottom joinery 1,283 records do not have. Also `connection|bottom`, `|left` and
   `|right` are missing from `CONNECTION_POSITIONS`, giving 8 records phantom systems.
11. **Confirmed and closed by row W1, across all 84 tiles rather than one sample.** `QxG`'s
   `size|width` says 4 and it measures **3.000 × 0.500** — wrong by a full unit, and 3.000 is an
   exact 76.20 mm multiple rather than a texture artefact. `AxG` measures 1.991 × 0.500 and
   `BAxG` 1.547 × 0.500, both plausibly real interface cuts. **Zero annular sectors among the
   84**, so de-arcing them is measured rather than assumed.
12. **Already closed in code, confirmed by row W1.** `detectStlFormat` and the rest of the STL
   parser were already exported and already size-based, so the edit this risk implied was
   unnecessary. Original entry follows.
   **Blender exports defeat header sniffing.** Several bucket files carry the ASCII string
   `"Exported from Blender-4.0.1"` in an 80-byte header with a *binary* body. Detect format by
   `size == 84 + 50·n`, never by sniffing for `solid`.
13. **Closed, and the diagnosis was wrong.** The plan's footprint percentages did disagree with
   the shipped classifier, but the gap was **not** the substring curve-marker scan: a
   segment-exact scan reclassifies **zero** tiles, and the 742 figure was the whole
   marker-vetoed population rather than a movable one. The real discriminator was
   `size|segment|<letter>`, and it moved **403** tiles to 91.5% coverage. See §2.
14. **Closed, and the code comment it quoted was false.** `pipeline/footprint.ts` claimed making
   `hasCurveMarker` segment-exact *"would move the NONE bucket and break the plan's numbers"*.
   Measured: the substring scan hits 2,133 tiles and a segment-exact scan 2,077, and **the
   difference is exactly the 56 `hex` tiles**. Every marker occurs in the corpus only as a whole
   segment. The comment discouraged a change that costs nothing, and the plan believed it.
   `hasCurveMarker` is now segment-exact with no production caller, kept as the flag saying a
   `rect` is an axis-aligned over-approximation of a sector.
15. **Closed — see item 5, which corrects the premise both entries shared.** The wrong colour on
   144 tiles was real and is fixed, but not by collapsing the tags: the two spellings name
   *different meshes*. Roots went 38 → 37 across all tags and 37 → 36 in first position, and the
   registry still maps 38 on purpose.
16. **The bucket's ETag is not the md5 for most of the corpus.** Above R2's 8 MiB part size it
   is the S3 *multipart* digest, which no arithmetic converts to an md5 — and **4,884 of 8,353
   blobs (58.5%)** are above it. Rows G1 and W1 measured this independently. So integrity checks
   hash **content**, never the header, and exposing `Access-Control-Expose-Headers: ETag` would
   let the browser verify only the small objects. Still worth setting; it is not the check this
   plan assumed.
17. **Strided range-reads do not save anything on this corpus.** A binary STL facet is 50 bytes,
   so any stride below about 1,310 coalesces back into a whole-object read at 64 KiB granularity —
   98.6% of the transfer. The one stride that does save bytes is out by **141.55 mm**. The plan's
   "~13 GB, sub-0.03 mm" was not jointly achievable, and row W1 read whole objects instead: 11.05
   GB, exact, 33 minutes, no egress charge.
18. **Measured bucket throughput is 3.4–11.4 MB/s single-stream**, 7.2–11.0 MB/s aggregate at
   concurrency 8 — not the 1.2 MB/s an early single-object probe suggested, which had the TLS
   handshake folded in.
