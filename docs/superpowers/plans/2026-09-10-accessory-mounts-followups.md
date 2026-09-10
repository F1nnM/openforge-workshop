# Accessory mounts — follow-up log (PR #161)

**Branch:** `worktree-accessory-mounts` → `main` · **PR:** https://github.com/F1nnM/openforge-workshop/pull/161
**Spec:** `docs/superpowers/specs/2026-09-09-accessory-mounts-design.md` · **Plan:** `docs/superpowers/plans/2026-09-09-accessory-mounts.md`

This file is the running record of what the PR contains, what the owner's manual check
found, what is being changed in response, and what is still open. It is updated with every
batch that lands on the branch.

## Done (on the branch as of 2026-09-10)

- `tools/mounts/` — `npm run mounts`: depth-map measurement of every host STL; openings,
  tilted Dupont torch sockets, treasure pockets, floor holes, top-surface fallback; arcs
  unrolled about the mesh origin; insert anchors (`peg`/`leaf`/`plate`/`block`).
- `pipeline/mounts/inventory.json` — the measurement: 1,130 objects, 995 host blobs, 139
  insert blobs, **1,298 mounts**, 0 failures; **1,180 / 1,230** slot declarations resolved
  (batch A re-measured the three brazier floors and every insert).
- Catalog schema 5 (`mounts`, `anchor`, and batch A's `anchor.bed` + `modelledIn`, all
  optional so the version does not move again); store `holds` + `STORE_VERSION` 9 (first rung);
  share format 6 (holds + "emptied" bit); bill/download count copies drawn; `PlanPiece.
  accessories`; `buildRoom3D` draws one instance per mount; default holds via
  `writeSilently`; the picker writes holds (in the slot editor since batch B, under the
  recipe slot whose file opens them).
- Whole-branch review fixes: pose of openings/holes/surfaces from bbox extents; one
  `copiesOf` for renderer and bill; plate tried before peg; spec/docs corrected.
- Corpus facts in `docs/verify-catalog-facts.py`; corpus test `tools/mounts/corpus.test.ts`.

## Owner's manual check (2026-09-10) — findings and status

| # | Finding | Root cause | Fix | Status |
| --- | --- | --- | --- | --- |
| F1 | Torch rendered inverted (flange at the wall, tip out) | Peg anchored at its **wider** end; the real torch hangs tip-down with the LED legs leaving the tip into the socket, flange + flame on top | Pegs anchored at the **narrower** end (the end that enters); plate rule rejects an end-cap of a peg-shaped box so `torch.stl` is a peg again; inserts re-measured (3 of 139 anchors changed); tests pin tip-at-entrance | **done** — `34fe85b` |
| F2 | "Leaves no base this piece can be printed on" on the Cut Stone door wall; doors all greyed, nothing filled by default | **Verified**: the picker's dead-end check (`slotStates → consequences`) walked the host file's own `base` part, whose `constrain` carries `texture`; the wall's base has 6 candidates and a door's `texture|metal`/`texture|wood` alone takes it to 0, so all five door items and the one lintel item greyed and `solveHolds` filled neither required slot. (The Towne curved wall is unaffected because *no curved base exists*: its base slot is already empty, so `consequences` sees no change. Corpus-wide, all 416 of the 4,330 dead-end item picks are the base and nothing else) | `consequences`/`siblingsOf` walk `pickerSlots`, so `base` is neither resolved nor read as a sibling; `deadEndReason`'s base branch retired with its test; fixture gained the accessory-to-accessory dead end and rescue | **done** — `7bfeeb1` |
| F3 | Lintel seated too high | Measured `head` of an open-topped doorway is the wall top (the opening runs up through the 33 mm notch — corpus: `head` within 0.5 mm of the host bbox top on every `openTop` opening) | On an `openTop` opening a `lintel`'s **top** sits at `head` (it fills the notch flush with the wall); closed openings keep bottom-at-head | **done** — `6583ee2` |
| F4 | Lintel upside down (curve on top) | `door_lintel.*.stl` is authored print-side down — measured on the real blob: **97.6 % of its `-z` face covered against 12.2 % of its `+z`** | `InsertAnchor` gains `bed` (the flat z-face when one is ≥ 90 % and the other < 50 %); lintels render bed-face up; inserts re-measured — 19 of 139 carry a `bed`, all `-z` | **done** — `6583ee2` |
| F5 | Only one lintel offered | `door_lintel.1/2/3` are one catalog design (three sculpts); the picker shows one card per design | The picker expands an item into **one card per print** when its files make the same connection claim, labelled with the part of the filename that differs (`1`, `2`, `3`) or of the path where two prints share a filename; an item whose files differ by lock still collapses to the preferred variant. Per **blob**, so one print filed under several paths stays one card — the wall's `lintel` is **6 cards over 12 files**, not 3 and not 12. Corpus: 2,194 cards → **4,491**, widest 8 → **10**, and **0** accessory items whose files differ by connection, so the collapse branch is the fixture's | **done** — `6c3973b` |
| F6 | "Cut Stone Small Brazier Floor 2x2" gets a second brazier | Fixture declares a `brazier` slot on a floor that already contains the brazier (33.2 mm tall, against 4.5–5.5 mm for the `brazier+large` floors whose brazier really is separate) | A `surface`-class slot on a host the fixture calls a **floor** that stands ≥ 15 mm is `modelled-in`. **The declared kind and not the footprint**, because the literal footprint rule would also have silenced 39 legitimate surface mounts — 12 secret-door `top`s, 16 mine `brace`/`beam`s, 5 cave `fracture slope`s, 4 loculus slabs and 2 plinth `statue`s, one of them a 2×2 `rect` 44.8 mm tall. The join carries `modelledIn` onto the record; `isModelledIn` is the one test and every consumer treats the slot as satisfied by the host (no declaration, no hole, no bill line, no hold, no draw; panel says "built into this piece"); a hold saved in one is `hold-modelled-in`, info, zero copies. The three floors and every insert re-measured; the importer lint lists all 15 `modelled-in` slots | **done** — `4cfaaf9` |
| F7 | Accessory choosing belongs in the slot editor, not the sidebar | Design decision (supersedes spec ruling 5 "accessories have one home" in the sidebar) | The editor renders each filled recipe slot's accessory slots under that slot's row — `SlotFills` controlled by the fill's `holds`, writing `pinHold` / `clearHold` — with the mount count, the *no measured mount* line, *built into this piece* (and no grid, via `SlotFills`' new `omit`), and *needs a choice* in the weight an empty recipe slot gets. `AccessorySection` and the plan-wide `planSlots` inventory deleted; `slotAccessories.ts#fillAccessories` is the per-(instance, slot) derivation the editor calls; bill `hole` rows carry their `Slots` button again and the copy points at the editor | **done** — `8d3e5ba` |

## Batches

- **Batch 0 — torch pose** — done, `34fe85b` (pushed). No renderer change was needed: a socket already aligns the anchor axis with −`mount.axis` and lands `anchor.at` on the entrance.
- **Batch A — data/geometry** (F2, F3, F4, F6) — **done**, `7bfeeb1` · `6583ee2` (F3 and
  F4 are one pose in one function, so they share a commit) · `4cfaaf9`. Touched
  `src/screens/detail/slots/{slotPicker,fixture}.ts`, `src/builder/three/place.ts`,
  `tools/mounts/{classify,catalog,run,worker}.ts`, `src/catalog/{schema,mounts,index}.ts`,
  `pipeline/{mounts,build,version}.ts`, `src/assembly/{resolve,bill,notes}.ts`,
  `src/builder/canvas/{scene,fixture}.ts`, `src/builder/three/holds.ts`,
  `src/builder/panels/{billView.ts,slots/planSlots.ts,slots/AccessorySection.tsx}`, and the
  re-measure: 142 blobs re-read (3 brazier floors, 135 inserts, 4 filed both ways), 0
  failed, `pipeline/mounts/inventory.json` rewritten (1,298 mounts, 75 surface, 15
  modelled-in, 19 beds) and the index re-imported (969 records with `mounts`, 285 with
  `anchor`, 10 with `modelledIn`, 33 with a `bed`).
- **Batch B — UI** (F7, F5) — **done**, `8d3e5ba` · `6c3973b`. Touched
  `src/builder/panels/slots/{SlotEditor.tsx,slotAccessories.ts,index.ts,slots.css,slots.test.tsx}`
  (`planSlots.ts` and `AccessorySection.tsx` deleted),
  `src/screens/detail/slots/{SlotFills.tsx,slotPicker.ts,fixture.ts,slots.css,index.ts}` and their
  tests, `src/builder/panels/{BillPanel.tsx,billView.ts,useArchiveDownload.ts,index.ts}`,
  `src/screens/builder/BuilderScreen.tsx`, spec §6, and the stale `planSlots` /
  `AccessorySection` cross-references in `assembly/`, `catalog/`, `composition/` and
  `builder/three/holds.ts`. Whole suite green: 188 files, 4,417 tests.

Each batch: implement → review → push to the PR branch → update this file.

## Still open after the batches (known, disclosed in the PR)

- A door leaf's front/back is unknowable from geometry (a relief door may face into the room).
- 10 round `%block` pillars and 2 cut-stone 2×2 pillars get no torch socket; 14 arc walls are refused; floor archways, loculus slabs mount on the top surface.
- `catacombs…loculus,arch` plate is anchored off-centre if it ever fills an `arch` slot.
- Corpus-backed tests skip in CI (no `public/catalog/catalog.json` there), like every other corpus block.
- No visual pass in the browser beyond the owner's spot checks above; the PR description asks for one before merge.

## Upstream fixture errors found by the measurement

All of them reported as `modelled-in` by `npm run mounts`, printed by the importer's lint,
and carried onto the record as `CatalogRecord.modelledIn` — **15 slots over 10 records**:

- Five door walls declaring `door` + `lintel` with the door modelled in:
  `dungeon_stone%eroded#wall,door+rectangular+narrow.A.openforge,side.stl`, its
  `+dragonlock` sibling, both `%block` spellings of the same pair, and
  `cut-stone#wall,door+rectangular.BA.openforge,side+dragonlock.stl`.
- Three floors declaring `brazier` with the brazier sculpted on:
  `cut-stone#floor,brazier+small.2x2.openforge.stl` and the `dungeon_stone` `%block` and
  `%eroded` floors beside it (31.6–33.2 mm tall, where a floor is 4–6 mm of plate).
- `catacombs#wall,loculus.S.openforge+split,bottom.stl` — declares `arch`, modelled in.
- `rough_stone+ruined#archway+floor.2x2.openforge.stl` — declares `archway`, modelled in.
