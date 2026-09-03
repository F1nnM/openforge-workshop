# v3 — aggregates everywhere, the lock in the builder, and a 3D-only work surface

Three owner requests, and the first is **not a new design**: §7 of `architecture-plan.md`
already says *"Place designs, not files. The user places a design; the concrete STL resolves
at download time from their lock preference."* The catalog honours it. The library, the
palette and the placement record never did. So row group **V** finishes a rule the plan
already made, rather than inventing one.

Same epic branch, `epic/v1`. Same rules: flat PRs, one owner per file set, merge on green.

**Nothing is deployed, so no row owes backwards compatibility.** Persisted state this build
cannot read is discarded rather than migrated - the owner's rule, and it applies to the
library (V1), the placement shape (V4) and R1's mesh cache alike. The one exception is a
**share link**, which lives in someone's chat log and outlives the build that wrote it; that
is why V4 still versions the codec. **This licence expires the day the app ships, and the
rows that use it must say so in the code.**

## What was measured before writing this

| finding | number |
| --- | ---: |
| aggregates in the corpus | **3,822** |
| aggregates mixing an `integral` **and** a `topper` variant - where the surfaces can disagree | **931** (24.4%) |
| of those, aggregates whose `preview` is already the topper | **925** |
| aggregates with a topper that still preview as `integral` - **a real bug** | **6** |
| aggregates with no topper at all (`base` 340, `integral` 320, `insert` 94) | 754 |

So the catalog looks right because the preview rule - *first sprite-carrying variant in
variant order* - lands on the topper by luck of ordering in 925 of 931 cases. **V5 makes it
a rule instead of a coincidence.**

### The mesh question, settled with arithmetic

`/lod/` returns **404**: the LOD store has never been uploaded, and the backfill is gated on
**B2**. `/models/` serves the source STLs fine. Per *distinct* mesh (placements reuse
meshes, so distinct count is what matters), and using the exact `84 + 50n` STL identity for
triangles:

| distinct meshes in a room | source download | triangles | GPU buffers, unindexed |
| ---: | ---: | ---: | ---: |
| 6 (the starter set) | **65 MB** | 1.3 M | 93 MB |
| 20 (a real room) | **215 MB** | 4.3 M | 310 MB |
| 30 | **323 MB** | 6.5 M | 465 MB |
| **20, as LODs** | **4.8 MB** | **0.4 M** | **29 MB** |

Median distinct mesh: **10.77 MB**, **215,314 triangles**. Whole archive: 106.13 GB over
8,353 meshes; the LOD store is a projected **176.1 MB**.

**Download is the hard half, rendering is survivable.** 4.3 M static triangles is fine on a
desktop GPU and 310 MB of VRAM is heavy but not fatal; on a phone it is fatal. At W1's
measured throughput (3.4-11.4 MB/s single-stream, 7.2-11.0 MB/s at concurrency 8) a 215 MB
room is 20 s to a minute before it draws, and every viewer of a shared link pays it again.

**So convert once, per aggregate, when the user adds it.** Measured per aggregate over all
its variants: **16.7 MB median (1.9 s at 9 MB/s)**, p95 92.8 MB, max 420.7 MB over 16
meshes - and **distinct meshes per design is median 1.0**, mean 2.23, so half of all designs
are a single file and the mean is a thin tail. A six-aggregate starter library is 100 MB
once, and **3.2 MB cached as converted geometry against 100 MB cached as source: 31x less to
keep**, with the scene then LOD-grade at 29 MB of GPU buffers rather than 310 MB. That is
what makes a phone viable at all.

`loadLod.ts` already fetches a GLB by md5 and already handles the 404 deliberately, so
`/lod/` stays the preferred source and **B7 becomes an optimisation that skips the per-user
download** rather than a requirement. Nothing waits on a credential.

**Primitive stand-ins were considered and rejected by the owner.** The `design/forge3d.js`
mockup built boxes and extrusions per tile kind, but the requirement is real geometry.

---

## Non-PR blockers

| id | Blocker | Gates | Owner |
| --- | --- | --- | --- |
| **B2** | R2 write credentials (already open in the v2 table) | X1, B7 | project owner |
| **B7** | **Run the LOD backfill** - `npm run lod -- --all`, 8,353 objects, ~108 GB of egress in, **176.1 MB** out. Turns the 3D builder from desktop-only into fast and mobile-viable. **Not a gate on any row here**: R1 makes the builder work without it, by converting per aggregate in the browser. What this buys is skipping that per-user download - every viewer of a shared link would otherwise convert the same meshes again. | shared-link latency, cold-start cost | project owner |

---

## V - Aggregates everywhere

| # | Title | Goal | Owns | Depends on | Neutral? |
| --- | --- | --- | --- | --- | --- |
| **V1** | Library holds designs | `library: z.record(TileId, true)` becomes a map keyed by **design**, because the user saves an item and not a way of printing it. **Nothing is deployed, so there is no migration**: the owner's rule is that discarding an old library is fine if it makes the new code better, so the version bump only has to *discard* state this build cannot read. That makes the key choice matter more, not less - there is no rung to paper over a bad one. The row also decides whether the rung machinery in `migrations.ts` still earns its place, and **its docblock must say at what moment discarding stops being allowed**, because that licence expires silently on the day this ships. Every reader of `library` is a contract dependency, and `selection.ts`'s one-shot mailbox carries a `TileId` today. | `src/store/**` | - | **no** |
| **V2** | The library screen shows the item | `grouping.ts` says its preview is *"deliberately not `TileAggregate.preview`… this card is showing what the user actually has"*. That argument dies with V1: there is no saved variant to be honest about. An entry becomes an aggregate, the card renders `aggregate.preview`, and the per-variant disclosure becomes *"what this will resolve to"* under the current lock rather than *"what you saved"*. | `src/screens/library/**` | V1 | **no** |
| **V3** | The palette arms an item | `PalettePanel` renders `row.record` - the concrete file, which for the 931 mixed aggregates is the `integral` one, and that is the bug the owner sees. A row becomes an aggregate, the thumb `aggregate.preview`, and placeability a question about the aggregate under the current lock. A6's `selectVariant`/`variantsByPreference` already exist; this row must not reimplement them. | `src/builder/panels/palette.ts`, `PalettePanel.tsx` | V1 | **no** |
| **V4** | A placement addresses a design | The deep one. `Placement.tileId` holds a file, and its docblock defends that on the grounds that resolution happens downstream - but once the palette arms an aggregate there is no file to store without **freezing** the choice the docblock warns about freezing. So a placement carries a design and resolves per lock at render, bill and download. Blast radius is real: `SHARE_FORMAT_VERSION` 2 -> 3, `billView.ts`, `assembly/**`, `generated/placement/**`'s disjointness proof, G4's placement key, and both canvases. | `src/store/schema.ts` (placement), `src/share/**`, `src/builder/panels/billView.ts`, *edits* `src/assembly/resolve.ts` | V1 | **no** |
| **V5** | Prefer the topper, by rule | `preview: (variants.find((v) => v.sprite) ?? head).id` gets the topper by ordering luck. **6 aggregates have a topper and preview an `integral` `dragonlock` file anyway.** Make the preference explicit - a sprite-carrying **topper** first, then any sprite-carrying variant - and assert the 6 by name so the rule is measured, not hoped for. | *edits* `src/catalog/aggregate.ts` | - | **no** |

---

## L - The lock system, in the builder

| # | Title | Goal | Owns | Depends on | Neutral? |
| --- | --- | --- | --- | --- | --- |
| **L1** | Lock toggle in the work area | Delete the `/settings` screen and its route; put the choice in the builder work area as a toggle with an **(i)** disclosure. **This overrules a documented decision and the row must say so:** `SettingsScreen`'s docblock rejects exactly this, because the choice *"needs about 300 words and two stacked bar charts per option to make honestly"* - buildability is **88.3 / 81.6 / 78.7** while reachability is **99.9 / 74.7 / 59.7**, and they disagree in direction as well as magnitude. The tooltip therefore has to carry **what each choice costs**, not the three names. `FacetSidebar` also renders the picker and keeps working. `LockNotice` links to a screen that will not exist. | *deletes* `src/screens/settings/**`, *edits* `src/routes/**`, `src/ui/lock-picker/**`, `src/ui/shell/Header.tsx`, the builder toolbar | - | **no** |

---

## R - The 3D work surface

| # | Title | Goal | Owns | Depends on | Neutral? |
| --- | --- | --- | --- | --- | --- |
| **R1** | Convert on add-to-library | **The owner's design, and it beats the render-time fallback I first briefed.** On add-to-library, fetch the aggregate's source STLs from `/models/`, decimate them in-browser to G1's 20,000-triangle ceiling, and cache **the converted geometry** by md5. The builder renders only from that cache. Position-only welding is the whole trick (facet normals make `weld()` a silent no-op: 0.921x against **0.167x**). `/lod/` stays the preferred source when B7 has run. | `src/builder/three/loadLod.ts`, `useLodStore.ts`, a conversion module | - | **yes** |
| **R2** | Place, erase, move and rotate in 3D | The mockup's model, which is the owner's reference: orbit camera, raycast a ground plane, a translucent **snapped ghost** that follows the pointer, a 5 px drag threshold separating an orbit from a click, erase by picking the hit's owning group, 90° rotate, snap toggle, stacking elevation. **Reuse the plan-view maths and do not reimplement it** - `geometry.ts`, `overlap.ts`, `sector.ts` (W6's annular sectors), `move.ts` and `ghost.ts` are all pure and stay correct, because placement is still a 2D lattice with an elevation. | `src/builder/three/**` (new interaction modules) | R1, V4 | **no** |
| **R3** | The base is visible | The owner's explicit requirement: *"only in the actual builder 3d view, they will see the base, based on their lock style selection."* The 3D room renders placed tiles only; the auto-inserted base is a bill line that never becomes geometry. Render it under each topper, resolved per lock - and X10's `base-already-on-plan` note stays the disclosure for a hand-placed duplicate. | *edits* `src/builder/three/instances.ts`, `place.ts`, `BuilderRoom.tsx` | R2, V4 | **no** |
| **R4** | Delete the plan view | ~1,600 lines of SVG renderer go: `PlanCanvas.tsx` (1,217), `PlanPieces.tsx`, `surfaces.tsx`, plus the toolbar wiring and `chrome={false}`. **The pure geometry stays** - it is what R2 runs on. `BuilderScreen` loses a decision rather than gaining one, and the 3D view stops being a panel behind a gate. | *deletes* `src/builder/canvas/{PlanCanvas,PlanPieces,surfaces}.tsx`, *edits* `src/builder/canvas/index.ts`, `src/screens/builder/BuilderScreen.tsx`, `src/builder/panels/**` | R2, R3 | **no** |

---

## Contract dependencies - the ones `Owns` cannot reveal

| Producer | Consumer | The contract |
| --- | --- | --- |
| **V1** library key | **V2, V3, R1**, `src/store/transfer.ts`, `src/share/scene.ts` | A design id where a `TileId` was. A JSON backup written before V1 must migrate, not fail. |
| **V4** placement shape | **R2, R3**, the bill, the pack, the share codec | What a placement *is*. Every reader resolves a variant instead of reading one. |
| **V4** share format | a link already in a chat log | `SHARE_FORMAT_VERSION` 2 -> 3, and **free twice over**: X10 verified nothing outside `src/share` imports the codec, and nothing is deployed. **It stops being free the day the app ships** - a link in a chat log outlives the build that wrote it, which is the one piece of state no version bump can discard. |
| **R1** mesh source | **R2, R3** | A `BufferGeometry` per md5, whatever it came from. R2 must not know which. |
| **B7** LOD store | mobile, shared links | Not a gate. It changes 215 MB into 4.8 MB. |

## Parallel width

**V1, V5, L1 and R1 start immediately.** Then V2 and V3 in parallel behind V1; V4 behind V1;
R2 behind R1 and V4; R3 behind R2; **R4 last**, because deleting the plan view before the 3D
surface can place a tile leaves no builder at all.
