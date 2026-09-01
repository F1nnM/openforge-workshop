# v2 — PR series

Execution plan for [`architecture-plan.md`](architecture-plan.md) §14. **This series ends at a
complete v2**; nothing is deferred behind it.

Same model as [`v1-pr-series.md`](v1-pr-series.md): one long-lived epic branch, `epic/v1`, every
row a small PR into it, flat and never stacked, one final PR to `main`.

**Nothing is deployed.** No share link, saved library or stored scene exists, so there are no
migrations and no compatibility constraints. Ordinals can be renumbered, the store's version
ladder can be collapsed. The append-only ordinal rule applies from launch onward, not now.

---

## What the grep changed

`Owns` below was derived by grepping for real readers, and it contradicted the plan twice:

**`Footprint` is read by 18 files** across `pipeline/`, `src/assembly/`, `src/builder/canvas/`,
`src/catalog/`, `src/screens/catalog/`, `src/screens/detail/` and `src/screens/landing/`. The
tessellation work **reshapes** it — `arc` changes from `{radius, angle}` to an annular sector,
and `column` is new — so it is substrate that *cannot* be inert. It splits into two sequenced
substrate rows: an additive table (V1) and an atomic cross-layer reshape (V2).

**`design` is read by only 4 files**, all lock-picker and settings. Aggregation is therefore far
more additive than expected, and its consumers can be cut by screen.

---

## Non-PR blockers

| id | Blocker | Gates | Owner |
| --- | --- | --- | --- |
| **B1** | Cloudflare zone admin — CORS **unconditional first**, then the cache rule. The other order caches responses without CORS headers and the app fails on cached 200s that look fine in `curl`. | V11 upload, V26 verify | project owner |
| **B2** | R2 write credentials for `/thumbs/` and `/lod/` | V11, V12 | project owner |
| **B3** | Publisher declaration — free, non-monetised community tool | public launch | project owner |
| **B4** | Legal read on bundling a GPL-2 OpenSCAD WASM engine **inside this app** rather than conveying it separately. The separate-origin design answered this cleanly; in-app integration does not, and it is the owner's stated preference. | V19, V20, V21 | project owner |

Rows gated by a blocker can be **written, reviewed and merged**; they cannot be **run against
production**. Build them, hold the execution.

---

## Substrate — sequenced, nothing else starts on footprints until both land

| # | Title | Goal | Owns | Depends on | Neutral? |
| --- | --- | --- | --- | --- | --- |
| **V1** | Tessellation table | The 38 codes as data: shape class, dimensions in units, port topology, confidence per row. Ships `openlock-tessellation.json` as a typed module and the wall-thickness and column constants. | `pipeline/tessellation.ts`, `pipeline/tessellation.test.ts` · *edits* `docs/openlock-tessellation.json` | — | **yes (inert)** |
| **V2** | Footprint reshape | `arc` becomes an annular sector `(centre, rIn, rOut, startAngle, sweep)`; `column` added at 0.5 × 0.5; the 84 non-curve `xG` pieces stop being arcs; `QxG`'s tagged width corrected against its measured 3.000. **Atomic across 12 files** — a discriminated-union reshape cannot land inert. | `src/catalog/schema.ts`, `pipeline/footprint.ts`, `pipeline/build.ts` · *edits* `src/assembly/footprint.ts`, `src/builder/canvas/geometry.ts`, `src/builder/canvas/overlap.ts`, `src/screens/catalog/format.ts`, `src/screens/detail/labels.ts`, `src/screens/landing/plan.ts` | V1 | **no** |

**V2 is the schedule risk of the series.** Every later footprint consumer rebases on it.

---

## Defect fixes — independent, small, land early

These are live or latent defects found during research. They are cut first because later rows
build on the code they touch.

| # | Title | Goal | Owns | Depends on | Neutral? |
| --- | --- | --- | --- | --- | --- |
| **V3** | Base tie-break | `byCost` sorts bytes-ascending, so **79.1% of auto-inserted bases under openlock are `topless`** — a base with no top surface, chosen silently. Rank on suitability, disclose the choice, and stop 1,853 of 1,963 bases being unreachable. | `src/assembly/assemblyIndex.ts`, `src/assembly/resolve.ts`, `src/assembly/notes.ts` | — | **no** |
| **V4** | Connection positions | Add `bottom`, `left`, `right` to `CONNECTION_POSITIONS` (8 records currently get phantom systems), and preserve position rather than flattening it — **0 of 4,363 toppers carry a bottom lock**, so a `conn`-derived aggregate would advertise joinery 1,283 records lack. | `pipeline/facets.ts` · *edits* `docs/verify-catalog-facts.py` | — | **no** |
| **V5** | Guard the corpus facts | Move the aggregation and tessellation figures into the fact verifier so they cannot drift silently: the topless rate, the `O`-code ambiguity, per-lock coverage, aggregate class counts. | *edits* `docs/verify-catalog-facts.py`, `pipeline/catalog.test.ts` | V3, V4 | **yes** |

---

## Aggregation

| # | Title | Goal | Owns | Depends on | Neutral? |
| --- | --- | --- | --- | --- | --- |
| **V6** | Aggregate substrate | One item per `design`: the aggregate type, its variant list, availability tags, and the build-time grouping. Detection is `layer === 'topper'` at 100% precision. Aggregate addresses are the group's lowest ordinal and **never enter the manifest** — an aggregate can split. | `src/catalog/aggregate.ts`, `pipeline/aggregate.ts` · *edits* `src/catalog/schema.ts` | V2, V4 | **inert until V7** |
| **V7** | Catalog and library over aggregates | Both screens list aggregates rather than files, with availability chips (topper-only / OpenLOCK / DragonLock / magnetic). Facet counts re-derived over aggregates. | `src/screens/catalog/**`, `src/screens/library/**` | V6 | **no** |
| **V8** | Variant resolution in the builder | Lock chosen per build resolves an aggregate to a file, falling back to base auto-insertion. The bill names the resolved variant and every auto-inserted base. | `src/builder/panels/**` · *edits* `src/assembly/resolve.ts` | V6, V3 | **no** |
| **V9** | Variants table in the drawer | Every variant disclosed — **never behind a closed accordion**. Claims part count, not filament: the integrated/topper byte ratio median is 1.027 and 27.4% of integrated variants are *smaller*. | `src/screens/detail/**` | V6 | **no** |

---

## Previews

| # | Title | Goal | Owns | Depends on | Neutral? |
| --- | --- | --- | --- | --- | --- |
| **V10** | Greyscale-then-tint | Compute luminance in the browser from the blue sprites, then tint per material family via `feColorMatrix`. **Works before the `/thumbs/` backfill**, and makes the grid agree with the builder for the first time — sprite blue sits 31.6 ΔE00 from the palette against neutral's 17.7, and reads closer to `water` than to its own material. | `src/materials/tint.ts`, `src/ui/primitives/TintFilters.tsx` · *edits* `src/screens/catalog/TileCard.tsx` | — | **no** |
| **V11** | Thumbnail backfill | Run the pipeline for real: 8,352 objects, ~4.5 GB egress, ~35 MB output, ~$0.04. Adds the `onError` sprite fallback for the backfill window. | *edits* `tools/thumbnails/cli.ts`, `src/screens/catalog/TileCard.tsx` | B1, B2, V10 | **no — writes to production** |

---

## Real geometry

| # | Title | Goal | Owns | Depends on | Neutral? |
| --- | --- | --- | --- | --- | --- |
| **V12** | LOD pipeline | glTF Transform 4.4.2 + meshoptimizer, EXT_meshopt_compression, to `/lod/{md5[:6]}/{md5}.glb` at 5–20K triangles. **Assert post-weld vertex count dropped** — if facet normals survive `weld()`, simplification silently no-ops and ships GLBs barely smaller than the STLs, with no error. | `tools/lod/**` | — | **yes (build-time)** |
| **V13** | Instanced 3D builder | Same placement model as the plan view, `InstancedMesh` per design. **Contract dependency on V12's output format** — shares no files with it, so `Owns` will not reveal it. | `src/builder/three/**` · *edits* `src/screens/builder/BuilderScreen.tsx` | V12 (contract), V2 | **no** |
| **V14** | True mesh dimensions | Strided range-reads (24 blocks × 400 triangles, ~13 GB, sub-0.03 mm) where the size tags diverge — on curves that is a median 96 mm. Emits a derived-metadata sidecar. | `tools/measure/**` | V1 | **yes (build-time)** |

---

## Compositions and assemblies

| # | Title | Goal | Owns | Depends on | Neutral? |
| --- | --- | --- | --- | --- | --- |
| **V15** | `constrain` semantics | Resolve the plan's largest open question. Port `config-processing.ts` and its 69 tests from the catalog repo rather than deriving new semantics from the 332-line spec. Precomputed candidate sets vary **29 KB to 9.4 MB** by reading, so this decides the payload. | `src/composition/**` · *edits* `pipeline/build.ts` | V6 | **inert until V16** |
| **V16** | Accessory slots | 3,036 tiles carry a config and none of it is built. Inline sprite grids — 62% of slots have under 50 candidates. Dead-end greying: **385 of 1,608 wall picks lead to an unbuildable configuration**, a capability the current server-backed catalog structurally cannot deliver. | `src/screens/detail/slots/**`, `src/builder/panels/slots/**` | V15 | **no** |
| **V17** | Guided assemblies | The 40 recipe templates as first-class objects, with progressive narrowing. | `src/screens/assemblies/**` | V15, V16 | **no** |

---

## Base generator — part of this app, not a separate service

The original catalog embedded someone else's generator behind an iframe. This one is ours: no
second origin, no third-party service, no `postMessage` bridge. The `.scad` sources are copied
in and maintained here.

**The licences, verified:**

| Component | Licence | What we do |
| --- | --- | --- |
| `MasterworkTools/openforge-bases` — the `.scad` geometry | **Apache-2.0** | **Copy it in.** Permissive, and pushed more recently (2026-01-05) than the GPL fork. Retain the licence and notices; vendor with a pinned commit and a documented refresh. |
| `MasterworkTools/openforge-openscad` — the web GUI fork | GPL-3.0 | **Copy nothing.** Its only real value was ~300 lines of wrapper, and taking it would pull GPL-3 into our bundle for no geometry. |
| `openscad-wasm` — the engine | **GPL-2.0** | Vendor the binary in its own dynamically-imported chunk. Ship the licence text and a written source offer. |

**Stay in the OpenSCAD format.** A port to `manifold-3d` (Apache-2.0) or JSCAD (MIT) would
remove the GPL question entirely, but it is not straightforward: 20 files, 201 KB, 62 `hull()`
calls, 89 `$fn=200`, and the customizer annotations *are* the parameter UI. Rewriting that is a
project, not a refactor, and it would fork us from upstream's geometry permanently.

> **The licensing consequence, stated plainly.** Putting the engine inside our own app is what
> was asked for and it is what these rows do — but it moves the copyleft question from *"is this
> a separately conveyed artifact"* (which a separate origin answered cleanly) to *"is our app a
> derivative work of a dynamically-loaded GPL-2 WASM engine"*. That is a genuine legal question,
> not a technical one, and **B4 gates it.** The mitigations that actually help are: keep the
> engine in its own chunk with no static import path into app code, copy nothing from the GPL-3
> fork, and ship the licence plus source offer. The mitigation that does *not* help is wishful
> reasoning about linking.

| # | Title | Goal | Owns | Depends on | Neutral? |
| --- | --- | --- | --- | --- | --- |
| **V18** | Vendor the geometry | Copy `openforge-bases`' `.scad` sources in under `src/generator/scad/`, with its Apache-2.0 licence, a `PROVENANCE.md` pinning the upstream commit, and a refresh script. All 39 include statements resolve to siblings, so a bundled virtual filesystem of 20 files (201 KB, 20.7 KB gzipped) resolves everything — no `OPENSCADPATH`, no library fetch. | `src/generator/scad/**`, `src/generator/PROVENANCE.md`, `scripts/refresh-scad.ts` | — | **yes (inert)** |
| **V19** | Engine and parameter schema | Vendor `openscad-wasm` in a dynamically-imported chunk — same discipline that keeps three.js at a 1.5 kB eager cost. Parameter schema from OpenSCAD's own `--export-format=param`, **not a hand-written parser**: verified against the real `bases.scad` at 18 parameters, ~350 ms. No COOP/COEP — every shipped build is single-threaded with unshared linear memory, verified from the binary's memory flags. | `src/generator/engine/**`, `vendor/openscad-wasm/**` · *edits* `vite.config.ts` | V18, B4 | **inert until V20** |
| **V20** | Generator in the builder | A panel in the builder, not a route: pick a base, tune parameters, place the result. **Catalog-first** — hash the parameters and resolve against the 1,962 catalogued bases, which *are* generator output from the same `.scad` run through `bases.py`, so the fixture filenames encode the parameter tuples. Fall through to WASM only on a miss. Persist the recipe, never the mesh. | `src/generator/panel/**` · *edits* `src/screens/builder/BuilderScreen.tsx`, `src/builder/panels/index.ts` | V19, V8 | **no** |
| **V21** | Generated tiles as placeables | A generated base is a first-class placement: its own footprint (known from the parameters, which is *easier* than the catalog's), its material, its bill line, and its bytes in the download pack alongside fetched files. `client-zip` already accepts a heterogeneous mix of `Response` and `Blob`. | `src/generator/placement/**` · *edits* `src/assembly/resolve.ts`, `src/download/plan.ts` | V20, V3 | **no** |

**Excluded from scope, deliberately:** textured primary walls. `bases-wall-primary.scad` needs
90 MB of blank texture STLs materialised in the WASM filesystem before `import()` runs, and
renders take 30–180 s. Those stay catalog-only, and the UI must not imply every base is
parametric — sculpted-texture bases (brick foundations, stairs, aztlan, timber, wood, s-system)
have no OpenSCAD path at all.

**Render latency is unmeasured.** No machine in this project has had OpenSCAD installed, so the
companion document's own figures are estimates anchored on triangle counts. **V19 must measure
it before V20 commits to auto-preview**; if a 4×4 base exceeds ~3 s, the design needs an explicit
Generate button rather than a live one.

## Closing out

| # | Title | Goal | Owns | Depends on | Neutral? |
| --- | --- | --- | --- | --- | --- |
| **V22** | v1 loose ends | `<Tile3DPanel>` into the drawer; `<Button>` call-site migration across 5 sites, deleting 2 CSS aliases; the SEO block in `index.html` with `og:image` deliberately omitted; delete the three dev preview harnesses. | *edits* `src/screens/detail/TileDrawer.tsx`, `src/screens/landing/Landing.tsx`, `src/screens/library/*.tsx`, `index.html` · *deletes* 3 `preview.*` pairs | V9 | **no** |
| **V23** | Shared 3D canvas | Browsers cap live WebGL contexts and drop the oldest, so a grid of live previews needs **one** shared canvas, not one per card. Prerequisite for any future 3D grid. | *edits* `src/three/**` | V13 | **yes** |
| **V24** | Debt sweep | `SurfacePattern` duplicated between `HeroPlan` and `builder/canvas/surfaces.tsx`; `fileSizeLabel`/`humaniseSegment` duplicated in `screens/detail/labels.ts`; `SearchField` unexported so the palette reimplements 30 lines; `TileId` accepts any non-empty string; the `Radio` primitive the lock picker hand-rolled; `pipeline/facets.ts`'s stale "38 roots reachable" docstring (37 reach `record.texture`). | *edits* various, one seam each | V7, V13 | **yes** |
| **V25** | Version stamp | One stamp shared by index, LOD store, thumbnail set and share manifest, regenerated in a single CI step — **a launch gate**, since md5 churn is the creator's normal workflow and silently invalidates all four. | *edits* `pipeline/version.ts`, `tools/**`, `.github/workflows/ci.yml` | V12, V11 | **yes** |
| **V26** | Deploy and verify | Cache rules verified by `cf-cache-status: HIT` rather than assumed. Disable the `r2.dev` public URL, which bypasses every cache rule and WAF. Set `content-type` on STL objects. | *edits* `wrangler.jsonc`, `.github/workflows/deploy.yml` | B1, B2, B3 | **no — production** |

---

## Contract dependencies — the ones `Owns` cannot reveal

The skill's warning applies to three pairs here. Each shares **no files**, so only a deliberate
pass finds them:

| Producer | Consumer | The contract |
| --- | --- | --- |
| **V12** LOD pipeline | **V13** 3D builder | The GLB format, its LOD levels and the `/lod/` path scheme. V13 renders nothing if V12's output shape differs from what it expects. |
| **V6** aggregate substrate | **V7, V8, V9** | Aggregate identity and the variant list. All three read a shape V6 defines and none of them writes. |
| **V14** measurement sidecar | **V2** footprints, **V13** 3D | Derived per-mesh dimensions. V2 can ship without it, but if V14 lands *after*, the footprint resolver must already tolerate a sidecar that may be absent. |

---

## Parallel width

Take it from the graph, not a fixed number. After V1 and V2 land, three lanes run
independently:

- **Aggregation** — V6 → V7, V8, V9
- **Geometry** — V12 → V13; V14 alongside
- **Compositions** — V15 → V16 → V17

V3, V4, V10, V12 and V14 have no dependency on V2 and can start immediately.

## Running it

- Branch `pr/vNN-slug` from `epic/v1`. Flat, never stacked.
- **No agent worktrees** — this repo is nested inside `openforge-catalog`, a different git repo,
  so worktree isolation provisions a worktree of the *outer* repo and refuses every git command
  beneath it. Agents write files; branch, commit and merge happen from the main checkout.
- One agent per row, on disjoint `Owns` sets.
- A PR is ready only when the agent has finished, CI is green, and review comments are
  addressed. Treat a green board as a claim — ask what actually ran.
