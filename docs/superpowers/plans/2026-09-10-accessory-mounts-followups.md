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
  insert blobs, 1,301 mounts, 0 failures; 1,183 / 1,230 slot declarations resolved.
- Catalog schema 5 (`mounts`, `anchor`); store `holds` + `STORE_VERSION` 9 (first rung);
  share format 6 (holds + "emptied" bit); bill/download count copies drawn; `PlanPiece.
  accessories`; `buildRoom3D` draws one instance per mount; default holds via
  `writeSilently`; picker writes holds (currently in the sidebar's Accessory-slots section).
- Whole-branch review fixes: pose of openings/holes/surfaces from bbox extents; one
  `copiesOf` for renderer and bill; plate tried before peg; spec/docs corrected.
- Corpus facts in `docs/verify-catalog-facts.py`; corpus test `tools/mounts/corpus.test.ts`.

## Owner's manual check (2026-09-10) — findings and status

| # | Finding | Root cause | Fix | Status |
| --- | --- | --- | --- | --- |
| F1 | Torch rendered inverted (flange at the wall, tip out) | Peg anchored at its **wider** end; the real torch hangs tip-down with the LED legs leaving the tip into the socket, flange + flame on top | Pegs anchored at the **narrower** end (the end that enters); plate rule rejects an end-cap of a peg-shaped box so `torch.stl` is a peg again; inserts re-measured (3 of 139 anchors changed); tests pin tip-at-entrance | **done** — `34fe85b` |
| F2 | "Leaves no base this piece can be printed on" on the Cut Stone door wall; doors all greyed, nothing filled by default | The accessory picker's dead-end check (`slotStates → consequences`) walks the host file's own `base` part; a door pick feeds its tags into the base's `constrain` and empties it. The room's base is the template's slot — a door cannot change it | `consequences`/`siblingsOf` ignore `base` for accessory slots; `deadEndReason`'s base branch retired | open (batch A) |
| F3 | Lintel seated too high | Measured `head` of an open-topped doorway is the wall top (the opening runs up through the 33 mm notch) | On an `openTop` opening a `lintel`'s **top** sits at `head` (it fills the notch flush with the wall); closed openings keep bottom-at-head | open (batch A) |
| F4 | Lintel upside down (curve on top) | `door_lintel.*.stl` is authored print-side down: flat top on the bed, decorative underside at +z | `InsertAnchor` gains `bed` (the flat z-face when exactly one is flat); lintels render bed-face up; inserts re-measured | open (batch A) |
| F5 | Only one lintel offered | `door_lintel.1/2/3` are one catalog design (three sculpts); the picker shows one card per design | Picker renders one card per file when an item's files differ only by sculpt (no lock differences); a hold names a file anyway | open (batch B) |
| F6 | "Cut Stone Small Brazier Floor 2x2" gets a second brazier | Fixture declares a `brazier` slot on a floor that already contains the brazier (33 mm tall) | A `surface`-class slot on a floor-footprint host taller than 15 mm is `modelled-in`; the join carries `modelledIn` slots onto the record; consumers treat them as satisfied by the host (no hold, no fault, no draw; picker says "built into this piece"); affected hosts re-measured; importer lint lists the data error | open (batch A) |
| F7 | Accessory choosing belongs in the slot editor, not the sidebar | Design decision (supersedes spec ruling 5 "accessories have one home" in the sidebar) | Slot editor shows each recipe slot's file's accessory slots with the picker; sidebar Accessory-slots section removed; bill hole rows get their Slots button back; refusal copy points at the editor | open (batch B) |

## Batches

- **Batch 0 — torch pose** — done, `34fe85b` (pushed). No renderer change was needed: a socket already aligns the anchor axis with −`mount.axis` and lands `anchor.at` on the entrance.
- **Batch A — data/geometry** (F2, F3, F4, F6): `src/screens/detail/slots/slotPicker.ts`, `src/builder/three/place.ts`, `tools/mounts/classify.ts`, `src/catalog/schema.ts`, `pipeline/mounts.ts`/`build.ts`, `src/assembly/resolve.ts`, `src/builder/canvas/scene.ts`, `src/builder/three/holds.ts`, targeted re-measures (inserts; brazier floors).
- **Batch B — UI** (F5, F7): `src/builder/panels/slots/*`, `src/screens/detail/slots/SlotFills.tsx`, `src/builder/panels/BillPanel.tsx`, `useArchiveDownload.ts`, spec §6.

Each batch: implement → review → push to the PR branch → update this file.

## Still open after the batches (known, disclosed in the PR)

- A door leaf's front/back is unknowable from geometry (a relief door may face into the room).
- 10 round `%block` pillars and 2 cut-stone 2×2 pillars get no torch socket; 14 arc walls are refused; floor archways, loculus slabs mount on the top surface.
- `catacombs…loculus,arch` plate is anchored off-centre if it ever fills an `arch` slot; `brazier+small.stl` is anchored at its top (inert on surface mounts).
- Corpus-backed tests skip in CI (no `public/catalog/catalog.json` there), like every other corpus block.
- No visual pass in the browser beyond the owner's spot checks above; the PR description asks for one before merge.

## Upstream fixture errors found by the measurement

- `dungeon_stone%eroded#wall,door+rectangular+narrow.A.openforge,side.stl` — declares `door` + `lintel`, door modelled in.
- `cut-stone#floor,brazier+small.2x2.openforge.stl` and `dungeon_stone%eroded#floor,brazier+small.2x2.openforge.stl` — declare `brazier`, brazier modelled in.
