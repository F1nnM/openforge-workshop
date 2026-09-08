# The builder's interaction model

**Date:** 2026-09-08
**Status:** approved design, pending implementation
**Supersedes:** `docs/design-contract.md` §2.4 (centre canvas) and the Place / Erase /
Rotate / Orbit rows of §3's interaction inventory.

## Why

The builder resolves every gesture against **the piece under the pointer**. There is no
persistent selection, no undo, and the three verbs live on a modal toolbar
(`place | erase | move`, keys `P` / `E` / `M`). Research into the established patterns for
this class of tool — tile editors (Unity Tilemap, Tiled, Godot GridMap), building games
(Sims 4 build mode, TaleSpire, Dungeon Alchemist) and the 2D editor lineage
(Figma, Miro) — puts this arrangement on the wrong side of the oldest convention in
graphical UI: **object–action**, or *select then act*. Selecting the operand first, and
keeping it selected, is what gives a verb somewhere to live, a properties surface
somewhere to attach, and a keyboard path that is not a bespoke cursor abstraction.

Four consequences of having no selection, all of them visible in the code today:

1. `R` needs a `sticky.current` ref to remember which piece it turned last, because the
   pointer may have moved off it.
2. The slot editor had to be hung on a **right click**, which contends with camera pan and
   needed a 5 px release test to disambiguate (`RoomSurface.tsx`, "The right click, and why
   it is a `pointerup`").
3. Erase is a *mode* on a destructive verb — the one case the mode literature says not to
   mode-switch, because a mode slip destroys work.
4. There is nothing to undo with. `move.ts:27`: *"There is no undo stack in the app yet."*

## What this is not

Out of scope, deliberately: drag-to-paint a run, box fill, flood fill, multi-selection,
copy/paste/duplicate, and the eyedropper. Each is an established pattern this builder will
eventually want; none is needed to fix the model, and each one is cheaper to add *onto* a
selection than beside its absence. The modifier budget below is kept clear for them.

## The model

### Two exclusive states

Both ephemeral, both in `usePlanTools` — never in `WorkshopState`, whose docblock is
explicit that everything in it is persisted and that restoring a stale tool state is
*"a hazard rather than a convenience"*. A restored selection is the same hazard.

| State | Condition | Ghost | What LMB means |
| --- | --- | --- | --- |
| **Armed** | `armed !== null` | visible, snapped, follows pointer | place the armed family |
| **Selected** | `selected !== null` | hidden | move the selected piece |
| **Idle** | both `null` | hidden | select what's under the pointer |

**Invariant: `armed` and `selected` are never both non-null.** Arming from the palette
clears the selection; selecting a piece disarms the palette. They are mutually exclusive
because both would claim LMB, `R`, and `Delete`, and exclusivity removes all three
ambiguities with one rule rather than three tie-breaks. This is also what Sims 4 does —
picking from the catalogue drops your selection — and it means the floating action bar
appears exactly when `selected !== null` and never has to reason about a ghost.

The apparent cost is a flow that isn't real: *"I placed a tile and want to turn it."*
`R` while armed turns the **ghost**, so the next placement lands already turned. That is
what every tile editor and building game does, and it is what a builder actually wants.
Correcting an already-placed piece costs `Esc` then a click.

### Gestures

Presses are classified on **release**, against the existing 5 px `DRAG_THRESHOLD_PX` —
the threshold the mockup established and the code already uses to separate a click from an
orbit. A press is *claimed* (and `stopPropagation`'d away from `OrbitControls`) only when
it lands on a piece the gesture will act on; every unclaimed press orbits as before.

**Idle / Selected:**

| Gesture | Meaning |
| --- | --- |
| click a piece | select it |
| click bare ground | deselect |
| drag from a piece | select it on press, then move it (the editor "tweak") |
| drag from bare ground | orbit — the press is not claimed |
| `Delete` / `Backspace` | remove the selection |
| `R` / `Shift`+`R` | turn the selection by its own `pieceRotationStep` |
| arrows, with a selection | nudge the selection by the snap step (`Shift` = `FAST_STEPS`) |
| arrows, with none | move the plan cursor; `Enter` then selects the piece under it |
| `Enter` / `Space`, with a selection | open the selection's slot section |
| `Esc` | deselect |
| `[` / `]` | step the selection to the previous / next piece |

`[` / `]` is the **primary keyboard route to a selection** — it needs no cursor and no
pointer, and it is why the arrow-key plan cursor survives only as the secondary path. Both
ring the piece they land on, so a keyboard user gets the same cue as a pointer user.

Two invariants the selection must hold, both of them about a selection outliving its
subject: **removing the selected piece clears the selection**, and a `selected` id that
no longer resolves in the scene — after a Clear, an undo, or a rehydration — reads as no
selection rather than as a dangling one. `selection.ts` resolves the id against the scene
on every read rather than trusting it, which makes both invariants one rule.

**Armed:**

| Gesture | Meaning |
| --- | --- |
| click the plan | place the armed family at the ghost |
| click an existing piece | also places — the ghost is at the snapped cursor whatever is under it, and a piece is never selected while armed |
| drag from anywhere | orbit — placing is a click, never a drag (no paint in scope) |
| `R` / `Shift`+`R` | turn the pending angle |
| arrows | move the plan cursor; `Enter` / `Space` places at it |
| `Esc` | disarm |

**Camera, always, regardless of state:**

| Gesture | Meaning |
| --- | --- |
| MMB drag | orbit |
| RMB drag | pan |
| wheel | zoom |
| LMB drag from bare ground | orbit |

MMB-orbit is new and it is the one addition the research made non-negotiable. The
recurring complaint about TaleSpire's build mode is that *mouse input is overloaded and
relied on too heavily*; with LMB-drag-on-a-piece now meaning "move", a room that fills the
viewport would otherwise leave no reachable ground to orbit from. MMB costs nothing — it
is unbound today — and gives every camera verb a button that never contends with content.

### What is deleted

`PlanTool`, `tool`, `setTool`, `toggleTool`, the `P` / `E` / `M` keys, the toolbar's
three-way mode toggle, and the `Shift`+primary move quasimode (which existed only to
escape the mode, and has nothing left to escape). `Shift`-click is thereby left free for
its conventional meaning — extend selection — when multi-select arrives, and `Alt`-drag
free for duplicate.

Right-click loses the slot editor and becomes pan and nothing else, so
`RoomSurface`'s secondary-press bookkeeping and its `contextmenu` suppression both go.

### Selection chrome

The hover cue is D7's screen-space silhouette, traced by the outline pass in
`src/three/Stage.tsx`. The obvious move — a second, heavier outline for the selection — is
**rejected on cost**: `OutlineRequest` carries one `colour` and one `edgeStrength` for the
whole request, so two weights means a second `OutlineEffect`, a second mask render target
and a second fullscreen quad. `Stage.tsx` is deliberate that the pass costs *"one more
fullscreen quad, and only while something is outlined"*, and doubling that for a cue is a
bad trade.

Instead the two cues use two **different drawings**, which is also the more legible answer:

- **The outline pass carries whichever is live.** With a selection, it outlines the
  selection, in the selection colour; with none, it outlines the hover, in the hover
  colour. Only one is ever in the request, so one colour per request stays true and the
  pass is untouched.
- **The selection additionally gets a ground-plane marker** — a highlighted contour on its
  footprint plate, drawn by `markers.ts`, which already builds plates and contours from the
  same convex parts the collision sweep uses. That is what stays visible while the pointer
  hovers a *different* piece, so both states remain legible without a second pass.

This is D3's rejected drawing, used correctly. D3 built the *hover* cue as a flat footprint
loop lifted to a part's top height, and the owner's diagnosis was right: as a silhouette
substitute it was the plan view floating in the air above the mesh, and occludable. As a
**selection marker on the plan** it is none of those things — it is on the ground, where
the piece's footprint actually is, which is exactly what `markers.ts` exists to draw.

### The floating action bar

A DOM panel anchored above the selected piece, in the manner of a 2D editor's contextual
toolbar (Figma, Miro) and of the app bar that Microsoft's mixed-reality guidance pairs with
affordance-based manipulation. It carries **both** the verbs and the slot choices, so the
right-hand column stays the bill of tiles permanently and nothing competes for it.

```
        ┌──────────────────────┐
        │  ⟳     ▤ slots    ⌦  │   verbs; each button's tooltip names its key
        ├──────────────────────┤
        │  floor ▾   wall ▾    │   the slot editor, expanded on demand
        └──────────┬───────────┘
              ╭────┴─────╮
              │ selected │           silhouette at selection weight
              ╰──────────╯
```

Mechanism: drei's `<Html>` (already a dependency at `10.7.8`), anchored at the piece's
centre in X/Z and its tallest part's top in Y, `center`, no `distanceFactor` so it holds a
constant pixel size, and **not** `occlude` — the bar must never hide behind geometry. Under
`Stage`'s `frameloop="demand"` it re-projects only on frames that are already being drawn,
which is exactly when the anchor goes stale, so it adds no render pressure.

Two mechanical requirements:

1. **`RoomSurface.tsx:1012` must gain a target check.** That listener is attached to
   `canvas.parentElement` in the capture phase with no test of `event.target`, and it is
   the same node `<Html>` portals into. Unfixed, no button on the bar — or on any future
   overlay inside the host — is clickable, because the press is captured and
   `stopPropagation`'d before it arrives. The fix is one guard at the top of `onDown`:
   claim only presses whose target is the canvas itself. This is the bug *class*, not the
   instance; moving one portal elsewhere would leave the trap armed for the next overlay.
2. **The anchor clamps to the viewport.** `<Html>` will happily position a panel off-screen
   for a piece near the edge. `calculatePosition` is overridden with a pure clamp so the
   bar stays reachable.

### Undo

A capped, in-memory ring of `placements` snapshots, fed by a **store subscription** rather
than by discipline at call sites: subscribe to `state.placements`, and on every change push
the previous value. Undo pops, applies through a new `restorePlacements` store action, and
pushes onto the redo stack; a re-entrancy flag keeps an applied undo from recording itself.

This is chosen over an inverse-command log over `SurfaceEdit` — which is tempting, since
`SurfaceEdit` is already a six-kind discriminated union and would yield semantic labels for
free — because an inverse log needs an inverse *per verb, forever*, and would not cover the
slot-fill edits the new action bar is about to make. That is a seventh inverse on day one
and a silent hole in undo the first time someone forgets an eighth. A snapshot covers every
present and future mutation of the placement map by construction. `schema.ts:69-79` already
notes that placements are held in a keyed map partly because that suits an undo stack, so a
snapshot is a shallow copy of a map, not a deep clone of a scene.

- Depth: 50 entries, oldest dropped.
- Not persisted: the ring lives beside the store, not in `WorkshopState`.
- Keys: `Ctrl`/`Cmd`+`Z` undo, `Ctrl`/`Cmd`+`Shift`+`Z` and `Ctrl`+`Y` redo.
- Toolbar gains Undo and Redo buttons, disabled when their stack is empty.
- The status line says what happened, derived by diffing the two maps
  (`describeChange`) — automatic, so it cannot drift from the verbs.

Undo is also what licenses removing Erase mode: a mis-delete is now one keystroke to
recover, which is the standard argument for preferring undo to a confirmation dialog.

### Ghost validity

The ghost currently claims almost nothing, because since row A4b the armed thing is a
**template family** and a family has no single footprint. Rows C5 and C6 removed both
blockers — the fill solver exists and is memoised on `(family, size)`, and
`templateSlotLayout` places the parts — leaving only wiring: `RoomSurface` takes a `scene`
and is not given a `PlanCatalog`, so it cannot project the armed piece on hover.

This design threads the `PlanCatalog` in and projects the hovered placement through
`reanchorPiece`, which is the call `RoomSurface`'s own docblock already nominates. The
ghost then draws the real parts and can answer the question it could not answer before:
**does this land on top of something?**

### Overlap is prohibited — where the detector is exact

`overlap.ts` currently *flags and commits*, under a documented principle
(*"compatibility informs; it never refuses a placement"*). **That changes: an overlapping
placement is refused.** The owner's call, and it makes a room printable by construction.

It cannot become an unconditional gate, though, and the module says why in its own words:
its error is **deliberately one-directional**. *"Every part is a superset of the geometry it
stands for, so this module can report a conflict that is not quite there and can never miss
one that is."* Three named sources of over-report:

| Source | Why it over-reports |
| --- | --- |
| Curved footprints | an `arc` is decomposed into convex parts that strictly *contain* the sector, by up to 0.246 mm |
| Unknown elevation | `level: null` reads as *every* level, so a piece of unknown height conflicts with everything in its band |
| Band assignment | `planBand` reads `kinds` tags, and *"the tag data drifts"* |

So the gate is **exact conflicts only**; an inexact conflict keeps today's warn-and-commit.
The module already carries the flag this needs: `PlanShape.cover` is `'exact' | 'outward'`
with `slack` in grid units, and its docblock says it is *"carried rather than inferred from
`shape` so a consumer that reports on its own accuracy does not have to know which cases are
curved."* This is that consumer.

A conflict is **refusable** when all three hold, and a warning otherwise:

1. **Geometry is exact** — every part of both subjects comes from a shape with
   `cover: 'exact'` (equivalently `slack === 0`). The five straight cases qualify; `arc`
   does not.
2. **Both levels are known** — neither subject has `level: null`, so the vertical
   disjointness test ran on real numbers rather than on the every-level guess. A generated
   base qualifies: a recipe computes a real interval.
3. **Both bands are measured** — the band came from the footprint's own wall thickness
   (`isWallThickness`), not from the `kinds` heuristic.

Two thirds of that improves *because of* the rest of this design rather than in spite of it:
threading the `PlanCatalog` into `RoomSurface` gives the ghost a projected template with
real `SlotLayout.elevationMm` per part, so condition 2 goes from "never true for a ghost"
to "normally true". The ghost stops being the module's worst-calibrated caller.

Mechanically this means:

- `OverlapSubject` gains `cover: PlanCover`, set where subjects are built.
- `planBand` returns `{ band, measured }` rather than a bare `PlanBand`, so provenance
  travels with the value instead of being re-derived. Callers are updated; nothing keeps a
  compatibility shim.
- `subjectsConflict` returns a verdict — `null`, `{ kind: 'exact' }` or `{ kind: 'inexact' }`
  — rather than a boolean.
- `planPlacement` and `previewMove` refuse on `exact` and note on `inexact`. A refusal names
  the piece and cell it hit, because *"a heuristic that blocks and is occasionally wrong
  costs them a tile they cannot place and no way to find out why"* is the failure this must
  not reproduce.
- The scene keeps drawing a hatch for both kinds; `PlanScene.conflicts` becomes
  `ReadonlyMap<PlacementId, ConflictKind>` so the drawing can distinguish them.

The ghost therefore has three states, and colour is never the sole carrier of any of them:
clear, **blocked** (refusable — hatched, and the click does nothing but explain), and
**warned** (inexact — hatched more lightly, and the click places).

Cost, stated honestly: hover now pays the solve the click already pays — 1 to 19 queries,
up to 3.3 ms cold, memoised on `(family, size)` thereafter, against a pointer path whose
current per-move cost is 0.221 ms. The solve is paid once per armed family and size, not
per move.

## Decomposition

Every unit below is pure or DOM-only, because **no test in this repo can mount the 3D
surface** — jsdom has no WebGL context. The decomposition is chosen so that the substance
is testable and only the anchoring wrapper is not.

**New:**

| Unit | Purpose | Depends on |
| --- | --- | --- |
| `src/builder/canvas/selection.ts` | what a press means, given state + pick; and selection stepping | `move.ts`, `geometry.ts` |
| `src/builder/canvas/history.ts` | the capped ring, and `describeChange` over two placement maps | `store/schema.ts` types |
| `src/builder/canvas/useHistory.ts` | subscribes the ring to the store; exposes `undo`/`redo`/`canUndo`/`canRedo` | `history.ts`, `workshopStore.ts` |
| `src/builder/three/PieceActionsBar.tsx` | the bar's markup and behaviour, as plain DOM | `SlotEditor` |
| `src/builder/three/SelectionAnchor.tsx` | the `<Html>` wrapper and the `anchorPosition` clamp | drei, `PieceActionsBar` |

**Modified:**

| Unit | Change |
| --- | --- |
| `usePlanTools.ts` | drop the tool; add `selected` / `select` / `arm` with the exclusivity invariant |
| `overlap.ts` | `planBand` returns provenance; `OverlapSubject` gains `cover`; `subjectsConflict` returns an exact/inexact verdict |
| `move.ts` | an exact conflict becomes a refusal rather than a note |
| `scene.ts` | `conflicts` becomes a map of id → conflict kind; `pieceSubjects` sets `cover` |
| `edits.ts` | verdicts keyed to the selection rather than to a cursor pick; placement refuses on an exact conflict |
| `RoomSurface.tsx` | the new gesture model; the `event.target` guard; MMB orbit; the `PlanCatalog` for the ghost |
| `PlanToolbar.tsx` | drop the mode toggle; add Undo / Redo |
| `workshopStore.ts` | add `restorePlacements` |
| `Stage.tsx` / `outline.ts` | a second outline weight for the selection |
| `slots/SlotsPanel.tsx` | the editing route moves to the action bar |
| `docs/design-contract.md` | §2.4 and §3 rewritten to describe what ships |

`RoomSurface.tsx` is 1,673 lines before this change and its docblock is a third of that.
The gesture model moving to `selection.ts` should take a meaningful part of both with it;
if the file does not get materially shorter, the extraction was not real and the split
should be revisited rather than declared done.

## Testing

- **`selection.ts`** — a table of (state, pick, gesture) → meaning, including the two that
  are easy to get wrong: a drag from an unselected piece selects *and* moves, and a press
  on bare ground is never claimed.
- **`history.ts`** — depth capping, redo invalidated by a fresh edit, `describeChange` over
  add / remove / move / slot-fill diffs.
- **`useHistory.ts`** — a store mutation records; an applied undo does not re-record.
- **`PieceActionsBar.tsx`** — testing-library: the three verbs fire, tooltips name the keys,
  the slots section expands, and pointer events do not escape the panel.
- **`anchorPosition`** — the clamp, at all four edges.
- **`usePlanTools.ts`** — the exclusivity invariant, from both directions.
- **`edits.ts`** — the existing verdict suite, re-pointed at a selection.
- Regression: the full suite. Baseline for this branch is 170 files / 3,941 tests green.

## Risks

1. **Orbit reachability.** LMB-drag-on-a-piece now moves, so a viewport full of room leaves
   no LMB orbit. Mitigated by MMB-orbit, but it is the change most likely to need a second
   look with a real room on screen.
2. **`RoomSurface`'s pointer plumbing is delicate.** The capture-phase fight with
   `OrbitControls` is deterministic today and the docblock explains why. Changing which
   presses are claimed touches exactly that reasoning, and the docblock must be rewritten to
   match rather than left describing the old model.
3. **The ghost solve on hover.** Memoised, but the first hover of each armed family and
   size pays up to 3.3 ms. Acceptable; worth measuring rather than assuming.
5. **Prohibition against a deliberately over-reporting detector.** The exact/inexact split
   is what keeps a false positive from becoming a dead end, but the split is itself a
   judgement about which of `overlap.ts`'s three error sources are live in a given pair.
   If it is drawn wrongly the symptom is a placement the user believes is fine being
   refused with a confident explanation — worse than today's spurious hatch. The three
   conditions are therefore tested individually and in combination, and a room that
   *already* holds overlaps (persisted before this change) must still load, draw and
   download: prohibition applies to new edits, never retroactively.
6. **Two behaviours to predict.** A user who is refused once and warned once will ask why.
   The refusal and the warning must read as different things — the refusal names the
   blocking piece and says the placement did not happen; the warning says it did.
4. **The bar over a small piece.** A 1×1 tile at a shallow camera angle is smaller than its
   own action bar. The clamp keeps the bar on screen; it does not keep it from covering
   neighbours. Accepted for now.
