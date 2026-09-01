# v2 — PR series

Execution plan for [`architecture-plan.md`](architecture-plan.md) §14. **This series ends at a
complete v2**; nothing is deferred behind it.

Same model as [`v1-pr-series.md`](v1-pr-series.md): one long-lived epic branch, `epic/v1`, every
row a small PR into it, flat and never stacked, one final PR to `main`.

**Nothing is deployed.** No share link, saved library or stored scene exists, so there are no
migrations and no compatibility constraints. Ordinals can be renumbered; the store's version
ladder can be collapsed. The append-only ordinal rule applies from launch onward, not now.

---

## What the refutation changed

A first draft of this table was reviewed adversarially. It survived almost nothing, and the
corrections are the most valuable content here.

**The coverage figure was not ours.** The draft promised "six primitives, 95.1%". Our own
classifier says **86.9%**, and **742 of the 1,144 unplaceable tiles carry a curve marker but no
radius** — classified unplaceable by a *substring match*, not by lacking a footprint. Most of the
improvement is that one scan, and it was unscheduled. It is now **W3**.

**The annular-sector rule does not cover what it was aimed at.** It rests on 21 measurements, and
**292 of 1,391 arc tiles (21.0%) carry no band modifier at all**. So measurement (**W1**) moves
*before* the reshape rather than beside it.

**The reshape is 40 files, not 12.** And one of the nine the draft listed —
`src/screens/landing/plan.ts` — does not import `Footprint` at all. Meanwhile
`src/builder/canvas/PlanPieces.tsx`, the file that must actually *draw* the new primitive, was in
no row. Splitting into three (**W4/W5/W6**) is what makes it reviewable.

**Three "independent" rows were not.** The tint row edited a file inside the catalog row's glob;
the base tie-break re-ranks maps the reshape rekeys; and the reshape needed the fact verifier the
guard row owns. All now carry edges.

**Four root files had no owner** — `package.json`, the tsconfigs, `vitest.config.ts`,
`eslint.config.js`. v1 gave those to row 1 precisely because three rows wanted them. **W0** takes
them.

**Fifteen rows nobody wrote** are now rows. Two draft items that did not reproduce are deleted.

---

## Non-PR blockers

| id | Blocker | Gates | Owner |
| --- | --- | --- | --- |
| **B1** | Cloudflare zone admin — CORS **unconditional first**, then the cache rule. The other order caches responses without CORS headers, and the app then fails on cached 200s that look fine in `curl`. | X1, X3, X6 | project owner |
| **B2** | R2 write credentials for `/thumbs/` and `/lod/` | X1, G1 | project owner |
| **B3** | Publisher declaration — free, non-monetised community tool | public launch | project owner |
| **B4** | Legal read on bundling a **GPL-2** OpenSCAD WASM engine *inside this app* rather than conveying it separately. The separate-origin design answered this cleanly; in-app integration is the owner's stated preference and does not. | S2, S3, S4 | project owner |
| **B5** | `Access-Control-Expose-Headers: ETag` on `objects.openforge.tools`. **ETag equals the md5**, which is how a fetched STL is verified to be the file a recipe named — without the header that check is impossible. | S3, X6 | project owner (zone admin) |
| **B6** | `Cross-Origin-Resource-Policy: cross-origin` on the bucket. Costs nothing now; without it the whole catalog is blocked on day one if anything ever forces cross-origin isolation. | X6 | project owner (zone admin) |

Rows gated by a blocker can be **written, reviewed and merged**; they cannot be **run against
production**. Build them, hold the execution.

---

## W — Foundations: measurement, then footprints

Strictly sequential. This is the critical path and the schedule risk of the series.

| # | Title | Goal | Owns | Depends on | Neutral? |
| --- | --- | --- | --- | --- | --- |
| **W0** | Toolchain ownership | Take the root files three later rows all need: dependency additions, and `tools/` plus `apps/` reachable from the tsconfigs and the test include. Purely enabling. | `package.json`, `package-lock.json`, `tsconfig.app.json`, `tsconfig.node.json`, `vitest.config.ts`, `eslint.config.js` | — | **yes** |
| **W1** | Measure the geometry | Strided range-reads (~13 GB, sub-0.03 mm) over: the **292 arc tiles with no band modifier**, the **165 with no angle**, the **`AxG`/`BAxG`/`QxG` trio** whose tagged widths disagree in opposite directions, and the **921 `none` tiles carrying no tessellation code**. Emits a derived-metadata sidecar. **The only row that can settle any of these.** | `tools/measure/**` · *edits* `src/three/stl/parse.ts` (export `detectStlFormat` — it already closes §16 risk 12; a second copy is the alternative) | W0 | **yes (build-time)** |
| **W2** | Tessellation table | The 38 codes as typed data: shape class, dimensions, port topology, **and a per-row confidence** — 35 measured, 2 unmeasured, 1 inferred. Ships the wall-thickness and column constants. | `pipeline/tessellation.ts` · *edits* `docs/openlock-tessellation.json` | W0 | **yes (inert)** |
| **W3** | Reconcile the classifier | Make `hasCurveMarker` segment-exact. **742 tiles leave `none`** — this is where 86.9% becomes ~95%. `pipeline/footprint.ts:18-21` says doing so *"would break the plan's numbers"*, so the oracle and the corpus test land **in the same diff**. | `pipeline/footprint.ts` · *edits* `docs/verify-catalog-facts.py`, `pipeline/catalog.test.ts` | W2 | **no** |
| **W4** | Footprints, additive | Add **`COLUMN`** (0.5 × 0.5, ~133 tiles leave `none`) and **`DIAGONAL`** (right triangle for `O`/`OA`; a `2√2 × 0.5` wall run for `P`, 121 tiles). De-arc the 84 `xG`. Correct `QxG` **only if W1 settled the trio**. Resolve footprints from the tessellation code where size tags are absent — **223 of the 1,144 `none` tiles carry a code**. `arc` keeps `{radius, angle}`. | `src/catalog/schema.ts`, `pipeline/build.ts` · *edits* `pipeline/footprint.ts`, `docs/verify-catalog-facts.py`, `pipeline/catalog.test.ts` | W1, W3 | **no** |
| **W5** | Footprints, atomic reshape | `arc` becomes an annular sector. **40 compile-breaking files**, 27 production and 13 test — a discriminated-union reshape cannot land inert. Every band either measured by W1 or carrying a written, tested fallback. | `src/catalog/schema.ts` · *edits* all 40, enumerated in the PR body | W4, D1 | **no** |
| **W6** | Draw the new primitives | The row the draft forgot. `PlanPieces.tsx` renders three `<rect>`s per piece; `planQuad` returns 4 points and an annular sector is not a quad; `overlap.ts` is **SAT over convex quads** and a sector is non-convex — so this is a new collision algorithm, not a mechanical touch. Also the arc-refusal paths in `ghost.ts` and `scene.ts`. | `src/builder/canvas/**` | W5, D7 | **no** |
| **W7** | Guard the facts | Move every figure this series rests on into the verifier: footprint counts, the topless rate, the `O`-code ambiguity, per-lock coverage, aggregate class counts, band-modifier coverage. | *edits* `docs/verify-catalog-facts.py`, `pipeline/catalog.test.ts` | W4, D1, D2, A1 | **yes** |

---

## D — Defects. Independent of W, land immediately

| # | Title | Goal | Owns | Depends on | Neutral? |
| --- | --- | --- | --- | --- | --- |
| **D1** | Base tie-break | `byCost` sorts bytes-ascending, so **79.1% of auto-inserted bases under openlock are `topless`** — a base with no top surface, chosen silently. Rank on suitability and disclose the choice. Only **110 of 1,963** bases are ever handed out. **Must precede W5**, which rekeys the maps this re-ranks. | `src/assembly/assemblyIndex.ts`, `src/assembly/resolve.ts`, `src/assembly/notes.ts`, `src/assembly/assembly.test.ts` | — | **no** |
| **D2** | Connection positions | Add `bottom`, `left`, `right` to `CONNECTION_POSITIONS` (8 records get phantom systems today) and preserve position rather than flattening it — **0 of 4,363 toppers carry a bottom lock**. Fixes `pipeline/catalog.test.ts:148`, which hardcodes `connection|side|`. | `pipeline/facets.ts` · *edits* `docs/verify-catalog-facts.py`, `pipeline/catalog.test.ts` | — | **no** |
| **D3** | Tag-drift normalisation | §16 risk 15, now load-bearing: `towne|stone-stucco` (72) and `towne|stucco-stone` (72) are one material and map to **two different families**, so tinting shows a wrong colour on 144 tiles. Collapsing `foundation`/`foundations` takes the roots 38 to 37, which the material registry asserts. | `pipeline/normalise.ts` · *edits* `src/materials/mapping.ts`, `src/materials/corpus.test.ts` | D2 | **no** |
| **D4** | Join-key guard | `resolve.ts` still prefers `sizeCode` and "never both". Code `O` carries 2×2 **and** 4×4. Key on the **resolved primitive** instead, and guard it with a test rather than a comment. | *edits* `src/assembly/resolve.ts`, `src/assembly/sizeCode.ts` | D1, W4 | **no** |
| **D5** | The missing-base gap | **594 of 4,363 toppers (13.6%)** get no base line item: 129 a base the corpus should have, 21 unsupportable thin strips, 444 with nothing to match on. Surface all three distinctly and file the corpus gap upstream. | *edits* `src/assembly/notes.ts`, `src/builder/panels/billView.ts` | D1 | **no** |
| **D6** | Layout containment | PR #33: `VisuallyHidden` is `position: absolute` with no positioned ancestor, so **any** clipped span can escape an `overflow` clip and add page scroll. It cost 2,809px in the builder. Fix the primitive, not each site. | *edits* `src/ui/primitives/*.tsx`, `src/ui/primitives/primitives.css` | — | **no** |
| **D7** | Delete the harnesses | Three dev `preview.*` pairs. **Moves first**, not last: `detail/preview.tsx` is a compile-break site for W5, `three/preview.tsx` for G2, `lock-picker/preview.tsx` for the debt sweep. Keeping them means four rows pay to maintain files we then delete. | *deletes* `src/screens/detail/preview.*`, `src/three/preview.*`, `src/ui/lock-picker/preview.*` | — | **yes** |

---

## A — Aggregation

| # | Title | Goal | Owns | Depends on | Neutral? |
| --- | --- | --- | --- | --- | --- |
| **A1** | Aggregate substrate | One item per `design`. Detection is `layer === 'topper'` at **100% precision / 99.9% recall**. Addresses are the group's lowest ordinal and **never enter the manifest** — an aggregate can split, so brand it `AggregateAddress`. **`config` is the one field the collapse is not lossless on** — it varies within **828 aggregates (21.7%)**, so slots must be the *union with provenance*, not a pick. | `src/catalog/aggregate.ts`, `pipeline/aggregate.ts` · *edits* `src/catalog/schema.ts`, `pipeline/build.ts`, `pipeline/version.ts` | W4, D2 | **inert until A2** |
| **A2** | Search over aggregates | The row the draft missed entirely. `src/search/facets.ts` requires records in **manifest-ordinal document order**, and aggregate addresses are not ordinals. Facet counts, the bitset index and the brute-force oracle all move. | `src/search/**` | A1 | **no** |
| **A3** | Catalog and library | Both screens list aggregates, with availability chips — topper-only, OpenLOCK, DragonLock, magnetic. | `src/screens/catalog/**`, `src/screens/library/**` | A2 | **no** |
| **A4** | Drawer addressing | `tileDrawer.ts` and `searchSchema.ts` type `?tile=` as a `ManifestOrdinal`. Resolution becomes ordinal to file to `design` to aggregate, with that variant selected. | `src/routes/**` · *edits* `src/search/searchSchema.ts` | A1, A2 | **no** |
| **A5** | Variants table | Every variant disclosed, **never behind a closed accordion**. Claims **part count, not filament**: the byte ratio median is 1.027 and 27.4% of integrated variants are *smaller*. | `src/screens/detail/**` | A1, A4 | **no** |
| **A6** | Variant resolution in the builder | Lock resolves an aggregate to a file, falling back to base auto-insertion. The bill names the resolved variant and every inserted base. | `src/builder/panels/**` · *edits* `src/assembly/resolve.ts` | A1, D1, D4 | **no** |
| **A7** | Lock picker, post-aggregation | The picker states 99.9 / 74.7 / 59.7 over designs. The numbers users actually experience are **83.7 / 76.6 / 73.7** — buildability, not reachability. Both belong there, distinguished. | `src/ui/lock-picker/**` · *edits* `src/screens/settings/SettingsScreen.tsx` | A1 | **no** |

---

## P — Previews

| # | Title | Goal | Owns | Depends on | Neutral? |
| --- | --- | --- | --- | --- | --- |
| **P0** | Thumb seam | Extract `TileThumb` out of `TileCard.tsx` so the four modules that render it — library card, library screen, bill panel, palette — and the tint filters have one owner. Three rows wanted this file; v1's lesson is to cut the seam first. | `src/ui/thumb/**` · *edits* the four call sites, `src/screens/catalog/TileCard.tsx` | A3 | **yes** |
| **P1** | Greyscale-then-tint | Compute luminance in-browser from the blue sprites, then tint per material family via `feColorMatrix`. **Works before the backfill.** The `<defs>` must be mounted in every subtree rendering a thumb, which is why P0 exists. Sprite blue sits 31.6 ΔE00 from the palette against neutral's 17.7, and reads closer to `water` than to its own material. | `src/materials/tint.ts`, `src/ui/thumb/TintFilters.tsx` | P0, D3 | **no** |
| **P2** | Re-run the annealing | The palette's deuteranopia minimum is **8.864 against a 9.0 target** — 0.136 short, recorded but never closed. P1's entire case is a ΔE00 argument resting on this palette, so close it before leaning on it. | *edits* `src/materials/palette.ts`, `src/materials/palette.test.ts` | — | **no** |
| **P3** | Thumb source switch | The index has **no "thumbnail exists" flag**, so `/thumbs/` 404s during backfill — and the two sources need *different* CSS geometry (256px square versus a 2×5 sheet) **and different filter chains** (the thumb is already Rec.709 luma; the sprite is blue). An `onError` swap alone renders the sprite through the thumb's matrix, which is the muddy wash the code already warns about. Add a `thumb` flag to the index. | *edits* `src/catalog/schema.ts`, `pipeline/build.ts`, `src/ui/thumb/**`, `src/screens/catalog/catalog.css` | P1, A1 | **no** |

---

## G — Real geometry

| # | Title | Goal | Owns | Depends on | Neutral? |
| --- | --- | --- | --- | --- | --- |
| **G1** | LOD pipeline | glTF Transform plus meshoptimizer to `/lod/{md5[:6]}/{md5}.glb` at 5–20K triangles. **Assert post-weld vertex count dropped** — if facet normals survive `weld()`, simplification silently no-ops and ships GLBs barely smaller than the STLs, with no error. Must also cover the **978 tiles (11.2%) above the STL gate**, which have no 3D path at all today. | `tools/lod/**` | W0 | **yes (build-time)** |
| **G2** | Instanced 3D builder | Same placement model as the plan view, `InstancedMesh` per design. **Contract dependency on G1's output format** — shares no files, so `Owns` will not reveal it. Verify the three.js pin: `GLTFLoader` and `MeshoptDecoder` come from `three/examples/jsm`, the semver-excluded tree, and `postprocessing` pins `three < 0.186.0`. | `src/builder/three/**` · *edits* `src/screens/builder/BuilderScreen.tsx` | G1 (contract), W6, D7 | **no** |
| **G3** | Shared canvas | Browsers cap live WebGL contexts and drop the oldest, so any grid of live previews needs **one** shared canvas. Prerequisite for G2 at scale and for 3D in the grid. | *edits* `src/three/**` | G2 | **yes** |
| **G4** | Builder move operation | PR #29: *"No move. It will annoy people."* Repositioning is erase-then-place, which costs two actions and has no keyboard path. Needs a drag state the canvas does not publish. | *edits* `src/builder/canvas/**`, `src/builder/panels/**` | W6 | **no** |
| **G5** | Selection channel | PR #23: *"Use in builder cannot truly pre-select — the store has no selection concept."* One call site once the channel exists. | *edits* `src/store/**`, `src/screens/detail/**`, `src/builder/panels/**` | A6 | **no** |

---

## C — Compositions

| # | Title | Goal | Owns | Depends on | Neutral? |
| --- | --- | --- | --- | --- | --- |
| **C1** | `constrain` semantics | The plan's largest open question. Port `config-processing.ts` and its 69 tests from the catalog repo rather than deriving new semantics from the 332-line spec. Candidate sets vary **29 KB to 9.4 MB** by reading, so this decides the payload — and the budget is already at **71.1%**. | `src/composition/**` · *edits* `pipeline/build.ts`, `pipeline/version.ts` | A1 | **inert until C2** |
| **C2** | Accessory slots | 3,036 tiles carry a config and none of it is built. Inline sprite grids — 62% of slots have under 50 candidates. **Dead-end greying**: 385 of 1,608 wall picks lead to an unbuildable configuration, a capability the current server-backed catalog structurally cannot deliver. | `src/screens/detail/slots/**`, `src/builder/panels/slots/**` | C1, A5, A6 | **no** |
| **C3** | Guided assemblies | The 40 recipe templates as first-class objects, with progressive narrowing. | `src/screens/assemblies/**` | C2 | **no** |

---

## S — Base generator, part of this app

The original catalog embedded someone else's generator behind an iframe. This one is ours: no
second origin, no third-party service, no `postMessage` bridge.

**Licences verified against the registry:** `openforge-bases` (the `.scad` geometry) is
**Apache-2.0** and pushed more recently than the fork — copy it in. `openforge-openscad` is
**GPL-3.0** — copy nothing; its only value was a wrapper. `openscad-wasm` is **GPL-2.0** — vendor
it in its own chunk with the licence and a written source offer.

**Stay in the OpenSCAD format.** A port to `manifold-3d` or JSCAD removes the GPL question but is
not straightforward: 20 files, 62 `hull()` calls, 89 `$fn=200`, and the customizer annotations
*are* the parameter UI. That is a project, not a refactor, and it forks us from upstream's
geometry permanently.

| # | Title | Goal | Owns | Depends on | Neutral? |
| --- | --- | --- | --- | --- | --- |
| **S1** | Vendor the geometry | Copy the `.scad` sources in with their Apache-2.0 licence, a `PROVENANCE.md` pinning the upstream commit, and a refresh script. All 39 include statements resolve to siblings, so a 20-file virtual filesystem (201 KB, 20.7 KB gzipped) resolves everything. | `src/generator/scad/**`, `src/generator/PROVENANCE.md`, `scripts/refresh-scad.ts` | W0 | **yes (inert)** |
| **S2** | Latency spike | Plan §12: *"A v0 spike must measure it before the UX commits to auto-preview."* **No machine in this project has had OpenSCAD installed**, so every latency figure is an estimate from triangle counts. If a 4×4 base exceeds ~3 s, S4 needs an explicit Generate button. | `tools/scad-bench/**` | S1, B4 | **yes** |
| **S3** | Engine and schema | Vendor the WASM in a dynamically-imported chunk — the discipline that keeps three.js at a 1.5 kB eager cost. Schema from OpenSCAD's own `--export-format=param`, **not a parser**. No COOP/COEP: every shipped build is single-threaded with unshared memory. Verify the STL against its ETag-md5 (**B5**). | `src/generator/engine/**`, `vendor/openscad-wasm/**` · *edits* `vite.config.ts` | S1, S2, B4, B5 | **inert until S4** |
| **S4** | Generator in the builder | A **panel**, not a route. **Catalog-first**: hash the parameters and resolve against the 1,962 catalogued bases, which *are* generator output from the same `.scad` via `bases.py`, so fixture filenames encode the parameter tuples. The resolver map is ~12 KB brotli and rides in the index. Persist the recipe, never the mesh. CI must fail on a `.scad` default change or an unparseable base filename. | `src/generator/panel/**` · *edits* `src/screens/builder/BuilderScreen.tsx`, `pipeline/build.ts`, `.github/workflows/ci.yml` | S3, A6 | **no** |
| **S5** | Generated tiles as placeables | A generated base is a first-class placement: footprint from its parameters (*easier* than the catalog's), material, bill line, and bytes in the download pack. `client-zip` already takes a mix of `Response` and `Blob`. | `src/generator/placement/**` · *edits* `src/assembly/resolve.ts`, `src/download/plan.ts` | S4, D1 | **no** |

**Excluded, deliberately:** textured primary walls. `bases-wall-primary.scad` needs 90 MB of blank
texture STLs materialised before `import()` and takes 30–180 s. Sculpted-texture bases have no
OpenSCAD path at all, so the UI must not imply every base is parametric.

---

## X — Closing out

| # | Title | Goal | Owns | Depends on | Neutral? |
| --- | --- | --- | --- | --- | --- |
| **X1** | Thumbnail backfill | Run it for real: 8,352 objects, ~4.5 GB egress, ~35 MB out, ~$0.04. | *edits* `tools/thumbnails/cli.ts` | B1, B2, P3 | **no — production** |
| **X2** | v1 loose ends | `<Tile3DPanel>` into the drawer; the `<Button>` migration across five sites, deleting two CSS aliases; the SEO block in `index.html` with `og:image` deliberately omitted; and the design contract's **tag chips on the card**, left out in v1 and never rescheduled. | *edits* `src/screens/detail/TileDrawer.tsx`, `src/screens/landing/Landing.tsx`, `src/screens/library/*.tsx`, `index.html`, `src/ui/thumb/**` | A5, P0, G2 | **no** |
| **X3** | iOS zip Worker | Plan §3 and §11 both require it and `wrangler.jsonc` records it as *"deliberately not here yet"*. iOS Safari has no `showSaveFilePicker` and refuses above 512 MB, so a 1.6 GB room has no path today. | `workers/zip/**` · *edits* `wrangler.jsonc` | B1 | **no — new Worker** |
| **X4** | Version stamp | One stamp across **five** artefacts — index, LOD store, thumbnail set, share manifest **and W1's sidecar** — regenerated in one CI step. A launch gate: md5 churn is the creator's normal workflow and silently invalidates all five. | *edits* `pipeline/version.ts`, `tools/**`, `.github/workflows/ci.yml` | G1, X1, W1, C1 | **yes** |
| **X5** | Debt sweep | `SurfacePattern` duplicated between `HeroPlan` and `builder/canvas/surfaces.tsx`; `SearchField` unexported so the palette reimplements 30 lines; `TileId` accepts any non-empty string; `pipeline/facets.ts`'s stale "38 roots" docstring; the library's narrow-viewport departure from the design contract. | *edits* various, one seam each | A3, G2, D2 | **yes** |
| **X6** | Deploy and verify | Cache rules verified by `cf-cache-status: HIT`, not assumed. Disable the `r2.dev` URL, which bypasses every cache rule and WAF. `content-type` on STL objects. Verify the generator's headers too — `'wasm-unsafe-eval'` and `Content-Type: application/wasm` are *"the single most common way a working WASM build dies on deploy"*. | *edits* `wrangler.jsonc`, `.github/workflows/deploy.yml` | B1, B2, B3, B5, B6, S4 | **no — production** |

**Two draft items deleted, because they did not reproduce.** `fileSizeLabel` and `humaniseSegment`
are **not** duplicated — one definition each, and `labels.ts` carries a docstring saying it is
*"deliberately not imported"*. And the lock picker's hand-rolled radios are a **documented
decision** (*"Why hand-rolled radios rather than ToggleGroup"*), not debt; a second hand-rolled
group in `FacetSidebar.tsx` that the draft missed makes a `Radio` primitive a real but separate
call.

---

## Contract dependencies — the ones `Owns` cannot reveal

| Producer | Consumer | The contract |
| --- | --- | --- |
| **W1** sidecar | **W4, W5, G2, X4** | Derived per-mesh dimensions. W5's bands and W4's `QxG` correction are only honest if W1 supplied them. |
| **G1** LOD | **G2** | GLB format, LOD levels, `/lod/` path scheme. G2 renders nothing if the shape differs. |
| **A1** aggregate | **A2–A7** | Aggregate identity, variant list, and the `config` union. Six readers, no writers. |
| **C1** candidates | **X4** budget | 29 KB to 9.4 MB against a budget already 71.1% used. C1 can trip a gate X4 owns. |
| **S4** resolver map | **the index** | ~12 KB brotli riding in `catalog.json`, plus a CI gate on `.scad` defaults. |
| **P3** `thumb` flag | **X1** | The backfill window needs the flag to exist before it is meaningful. |

---

## Parallel width

From the graph, not a number. **W0 and D1/D2/D6/D7 start immediately.** W1 is long-running and
gates the footprint chain, so start it first. After W4:

- **Aggregation** — A1, then A2, then A3/A4, then A5/A6/A7
- **Geometry** — G1, then G2, then G3/G4/G5
- **Previews** — P0, then P1, then P3; P2 independent
- **Compositions** — C1, then C2, then C3
- **Generator** — S1, S2, S3, S4, S5

## Running it

- Branch `pr/<id>-slug` from `epic/v1`. Flat, never stacked.
- **No agent worktrees.** This repo is nested inside `openforge-catalog`, a different git repo, so
  worktree isolation provisions a worktree of the *outer* repo and refuses every git command
  beneath it. Agents write files; branch, commit and merge happen from the main checkout.
- One agent per row, on disjoint `Owns` sets.
- A PR is ready only when the agent has finished, CI is green, and review comments are addressed.
  Treat a green board as a claim — ask what actually ran.
