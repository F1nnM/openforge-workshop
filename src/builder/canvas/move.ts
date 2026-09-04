/**
 * Moving a placed piece — the drag state the canvas did not publish.
 *
 * PR #29: *"No move. It will annoy people."* Repositioning was erase-then-place,
 * which costs two actions, loses the piece's rotation unless the user re-arms it
 * at the same angle, and had **no keyboard path at all**. This module is the
 * pure half of the fix; `three/RoomSurface.tsx` holds the React state and the
 * gestures. It was `PlanCanvas.tsx` until row **R4** deleted that renderer, and
 * this module did not change a line for it — which is the whole point of the
 * split.
 *
 * ## Pure, for the same reason `ghost.ts` is pure
 *
 * The preview the user drags and the coordinates that reach `movePlacement` come
 * out of one function, so they cannot disagree. A move computed in the renderer
 * and again in the pointer-up handler is how a piece lands half a unit from where
 * it was shown.
 *
 * ## The store sees exactly one write
 *
 * A {@link MoveDrag} is **ephemeral component state**, which is what
 * `src/store/schema.ts` says a drag-in-progress must be: *"anything added here is
 * persisted; ephemeral UI state (hover, drag-in-progress, panel open) belongs in
 * component state"*. So a forty-event pointer drag writes nothing, the drop
 * writes once through `movePlacement`, and a cancel writes nothing at all.
 *
 * That is also the undo answer. There is no undo stack in the app yet — nothing
 * in `src/store/**` records history — so the cost erase-then-place actually
 * charged was **two store writes**, two re-projections of the scene and two
 * rebuilds of the bill of tiles. A move is one write, so when a history stack
 * does land it has one entry to record, and `Escape` has none.
 *
 * ## Rotation is preserved, at every step size
 *
 * `movePlacement(id, x, z)` does not touch `rotation`, and `geometry.ts`'s
 * anchoring rule is that **rotation preserves the anchor corner** — so a moved
 * piece keeps its angle exactly, including on the 893 tiles whose `rotStep` is
 * not a multiple of 90 and the 1,199 arcs where the step *equals the sweep*. The
 * preview is recomputed from the piece as the scene currently holds it rather
 * than from a copy taken at grab time, which is what lets `R` turn a piece while
 * it is in the air and have the outline follow.
 *
 * ## The 3D view sees the result and cannot start one
 *
 * Row G2's `src/builder/three/BuilderRoom.tsx` projects the same `placements`
 * map through the same `buildPlanScene`, so a move made here appears there the
 * moment it commits — there is no second scene graph to synchronise. What it
 * cannot do is *originate* a move: that panel has no picking at all (no
 * raycaster, no `onClick` on an instance, and `InstancedMesh` picking needs an
 * instance id resolved off the intersection), so there is nothing to grab. That
 * is G2's file and this row does not touch it. A move in 3D is a raycast against
 * the instanced meshes plus a drag plane, and it belongs with whichever row next
 * owns `src/builder/three/**`.
 *
 * ## What a move deliberately does not do: concentric snapping
 *
 * The obvious mating aid for a curve — "snap this sector concentric with that
 * one" — cannot be honest on this lattice. `sector.ts`'s `sectorCentre` records
 * why: a sector's centre of curvature sits `rIn·cos θ` *outside* its bounding
 * box, so two concentric sectors need anchors differing by that offset, and it is
 * irrational at the corpus's sub-90° sweeps. Computed over
 * `public/catalog/catalog.json` (8,702 records, 1,199 of them `arc`):
 *
 * | centre of curvature            | arcs  | sweeps                         |
 * | ------------------------------ | ----: | ------------------------------ |
 * | at the box corner, offset 0    |   554 | all 554 at 90°                 |
 * | off the 0.5 lattice            |   645 | 439 at 45°, 186 at 22.5°, 20 at 11.25° |
 *
 * **Not one arc in the corpus has a non-zero centre offset that lands on the
 * lattice**, so a concentric snap would either be a no-op for the 554 that
 * already mate or a lie for the 645 that cannot. So the move snaps on exactly the
 * 0.5 / 1.0 lattice a placement does, and {@link concentricNote} *discloses* the
 * limitation on the pieces it applies to instead — the same call `geometry.ts`'s
 * `placementCaveat` makes about an unmeasured band: say it, do not pretend.
 * {@link isConcentricOnLattice} is nevertheless written as the arithmetic rather
 * than as `sweep === 90`, because it is the arithmetic that is true.
 *
 * ## Blocked moves: flagged, not refused — with one exception
 *
 * `overlap.ts` is emphatic that a conflict informs and never prevents, and gives
 * the reason a *move* needs most: *"overlapping while arranging is normal. Users
 * push a piece through its neighbours on the way to where it belongs."* The
 * error direction seals it — a sector's convex parts are an outward bound, so the
 * test can report a contact that is not there. Refusing a drop on that would take
 * a piece the user can see is clear and refuse to put it down.
 *
 * So an overlapping drop **commits**, previews in the accent, and announces the
 * count; the piece then carries W6's conflict hatch like any other.
 *
 * The one refusal is the one `ghost.ts` already makes for a placement, for the
 * same reason and by the same rule: an **identical** tile at identical
 * coordinates and an identical angle is invisible on the plan and would silently
 * double a line in the bill of tiles. A drop onto one is refused and the piece
 * goes back where it came from, said out loud.
 */
import type { Footprint } from '@/catalog'
import type { PlacementId } from '@/store'
import { filledSlots } from '@/store'

import type { PlanBox, PlanPoint } from './geometry'
import { describeCell, formatUnits, snapTo } from './geometry'
import { subjectsConflict } from './overlap'
import type { PlanScene, ScenePiece } from './scene'
import { pieceName, pieceSubjects, reanchorPiece, sceneSubjects, scenePaintOrder } from './scene'
import { sectorCentre } from './sector'

/* ----------------------------------------------------------------- the drag */

/**
 * A move in progress.
 *
 * Four fields, and `origin` is not redundant with the piece's stored anchor: the
 * store still holds the piece where it was, but `R` can be pressed mid-move and
 * the *scene* is therefore not a stable record of where the drag started. Keeping
 * the grab-time anchor here is what makes a cancel exact.
 */
export interface MoveDrag {
  readonly id: PlacementId
  /** The anchor the piece had when it was picked up. Where a cancel returns it. */
  readonly origin: PlanPoint
  /** The proposed anchor. On the lattice — see {@link nudgeMove}. */
  readonly anchor: PlanPoint
  /**
   * The world point a pointer grabbed at, or `null` for a keyboard grab.
   *
   * Held so the piece travels *with* the pointer rather than jumping its centre
   * under it. Grabbing the far corner of a 4 × 4 floor and having it leap two
   * units is the specific annoyance a drag-to-move has to avoid, and it is also
   * what would make a drag disagree with the click that started it.
   */
  readonly grab: PlanPoint | null
}

/** Pick a piece up. Either population — see `scene.ts`'s {@link ScenePiece}. */
export function beginMove(piece: ScenePiece, grab: PlanPoint | null): MoveDrag {
  const origin: PlanPoint = [piece.placement.x, piece.placement.z]
  return { id: piece.id, origin, anchor: origin, grab }
}

/**
 * Where a pointer drag has taken the piece.
 *
 * The delta is measured from the grab point and added to the grab-time anchor,
 * then snapped — not "snap the pointer and subtract half the extent", which is
 * the mistake `geometry.ts`'s `anchorFor` docblock describes: it puts a 1 × 1
 * tile's faces on the lattice and a 2 × 0.5 wall's faces a quarter unit off it.
 *
 * A keyboard drag has no grab point and is unchanged by this.
 */
export function dragMoveTo(drag: MoveDrag, world: PlanPoint, step: number): MoveDrag {
  if (drag.grab === null) return drag
  const anchor = shift(drag.origin, world[0] - drag.grab[0], world[1] - drag.grab[1], step)
  return same(drag.anchor, anchor) ? drag : { ...drag, anchor }
}

/**
 * Step the piece by a keyboard delta.
 *
 * Applied to the *current* proposal rather than to the origin, so twenty presses
 * travel twenty steps. `snapTo` on the way is what keeps keyboard travel on the
 * lattice however the piece got there — a placement imported through a share
 * link can carry an off-lattice coordinate, because `src/share/payload.ts` falls
 * back to eight bytes when a value is not a multiple of 0.5. The first nudge of
 * such a piece therefore also regularises it, which is the only way the builder
 * has to get an imported room back onto the grid.
 */
export function nudgeMove(drag: MoveDrag, dx: number, dz: number, step: number): MoveDrag {
  const anchor = shift(drag.anchor, dx, dz, step)
  return same(drag.anchor, anchor) ? drag : { ...drag, anchor }
}

function shift(from: PlanPoint, dx: number, dz: number, step: number): PlanPoint {
  return [snapTo(from[0] + dx, step), snapTo(from[1] + dz, step)]
}

/** Tolerance for "the same coordinate", in grid units. A tenth of the finest snap. */
const SAME_PLACE_EPS = 0.05

function same(a: PlanPoint, b: PlanPoint): boolean {
  return Math.abs(a[0] - b[0]) < SAME_PLACE_EPS && Math.abs(a[1] - b[1]) < SAME_PLACE_EPS
}

/* -------------------------------------------------------------- the verdict */

/** Why a drop cannot be committed. One case, and it is `ghost.ts`'s. */
export type MoveRefusalCode = 'duplicate'

export interface MoveRefusal {
  readonly code: MoveRefusalCode
  /** Shown in the hint and read out by the canvas's live region. */
  readonly message: string
}

/** Something true about a drop that is allowed anyway. */
export type MoveNoteCode = 'off-lattice-centre'

export interface MoveNote {
  readonly code: MoveNoteCode
  readonly message: string
}

/**
 * A proposed move, resolved once: the geometry to draw, the verdict, and the
 * pieces it lands on.
 */
export interface MovePreview {
  readonly id: PlacementId
  /**
   * The piece as the scene currently holds it — so a mid-move `R` is included.
   *
   * Either population. Row X9 widened this from `PlanPiece`, and the widening is
   * what makes a generated base movable *by the same code* rather than by a
   * second gesture: nothing in this module reads a `CatalogRecord` except the
   * name in a readout and the footprints the concentric note is about, and both
   * of those have an answer for either population.
   */
  readonly piece: ScenePiece
  /**
   * The piece as it would be if dropped here — **the same shape**, re-projected.
   *
   * Row **A1** is why this replaced the flat `box` / `parts` / `angle` /
   * `axisAligned` quartet. A template instance has N parts at N offsets, so
   * "where the piece would be" is no longer four numbers; it is a whole piece's
   * worth of geometry, and those four fields could only ever have described one
   * part of it. Publishing a re-projected {@link ScenePiece} means a renderer
   * draws the preview with the code it already draws the scene with — box,
   * polygons, per-part records, angles and elevations included — and there is no
   * second shape to keep in step.
   *
   * `conflict` on it is this preview's verdict, so a renderer may read it
   * directly. Built by `scene.ts#reanchorPiece`, which is pure geometry: no
   * catalog lookup and no style resolution, which is what lets this run on every
   * pointer event.
   */
  readonly moved: ScenePiece
  /** Where it was picked up from. */
  readonly from: PlanPoint
  /** The box it occupied there, for the leader line. */
  readonly fromBox: PlanBox
  /** The proposed anchor. What reaches `movePlacement`. */
  readonly anchor: PlanPoint
  /** The pieces the drop would overlap, in either population. */
  readonly overlaps: readonly ScenePiece[]
  readonly conflict: boolean
  /** Whether the proposal is where the piece already is. */
  readonly unchanged: boolean
  readonly refusal: MoveRefusal | null
  /** The concentric-snap disclosure, on the 645 arcs it applies to. */
  readonly note: MoveNote | null
  /** Whether dropping here writes to the store. */
  readonly committable: boolean
}

/**
 * Resolve a drag against the scene, or `undefined` when the piece has gone.
 *
 * A piece *can* go mid-drag — `Delete` is still live, and so is the bill panel —
 * and a preview that threw on it would take the canvas down over a race. The
 * canvas treats `undefined` as "the move is over".
 */
export function previewMove(drag: MoveDrag, scene: PlanScene): MovePreview | undefined {
  // Both lists, because the id space is one: row S5 proved a `GeneratedBaseId`
  // can never be a `TileId`, so a `PlacementId` names at most one piece across
  // the two maps and searching the union cannot find the wrong one.
  const order = scenePaintOrder(scene)
  const piece = order.find((candidate) => candidate.id === drag.id)
  if (piece === undefined) return undefined

  // The whole piece re-projected, not one primitive. `pieceSubjects` then hands
  // the collision test one subject per part, and `sceneSubjects` is the same
  // flattening `buildPlanScene`'s own conflict sweep uses — so a move and the
  // scene cannot disagree about a drop, which is the property `ghost.ts` shares
  // the predicate for.
  const moved = reanchorPiece(piece, drag.anchor)
  const subjects = pieceSubjects(moved)
  // Every candidate but this piece's own parts: a piece cannot collide with, or
  // duplicate, itself.
  const hit = new Set(
    sceneSubjects(scene)
      .filter((candidate) => candidate.id !== drag.id)
      .filter((candidate) => subjects.some((subject) => subjectsConflict(candidate, subject)))
      .map((candidate) => candidate.id),
  )
  const overlaps = order.filter((candidate) => hit.has(candidate.id))
  const unchanged = same(drag.origin, drag.anchor)
  const others = order.filter((candidate) => candidate.id !== drag.id)
  const refusal = duplicateRefusal(piece, others, drag.anchor)

  return {
    id: drag.id,
    piece,
    moved: { ...moved, conflict: overlaps.length > 0 },
    from: drag.origin,
    fromBox: reanchorPiece(piece, drag.origin).box,
    anchor: drag.anchor,
    overlaps,
    conflict: overlaps.length > 0,
    unchanged,
    refusal,
    note: firstConcentricNote(piece),
    committable: !unchanged && refusal === null,
  }
}

/**
 * The concentric-snap disclosure for a piece, or `null`.
 *
 * Asked of every footprint the piece holds — a template's parts, or the one grid
 * footprint of a generated base — and the first note wins.
 *
 * **One note rather than N**, because the thing being disclosed is a fact about
 * *the instance's anchor*: §2.2's slot offsets are fixed by the recipe, so if one
 * curve in a template cannot be made concentric with a curve in the next
 * template, no arrangement of the anchor fixes it and saying so five times helps
 * nobody.
 *
 * The generated arm is provably `null` rather than branched away: its grid
 * footprint is a `rect` and {@link concentricNote} returns `null` for every shape
 * that is not an `arc`, so asking is one expression with one answer and it stays
 * correct on the day the generator learns to make a curve.
 */
function firstConcentricNote(piece: ScenePiece): MoveNote | null {
  const feet: readonly Footprint[] =
    piece.kind === 'catalog' ? piece.parts.map((part) => part.record.foot) : [piece.foot.gridFootprint]
  for (const foot of feet) {
    const note = concentricNote(foot)
    if (note !== null) return note
  }
  return null
}

/**
 * The one refusal: an identical **instance**, at an identical angle, already
 * there.
 *
 * `ghost.ts` refuses the same thing on a placement and states the cost — two
 * identical pieces at the same coordinates are invisible on the plan and would
 * silently double every line in the bill of tiles, so the user prints two floors
 * and only ever sees one. A move can produce that just as easily as a second
 * click can, and the answer has to match or the two paths disagree about what a
 * legal scene is.
 *
 * Since row **A1** "identical" is a question about a fill map rather than about
 * one design — see {@link identityOf}. It got *stronger*, not weaker: a template
 * instance with five fills doubles five bill lines, so the rule earns five times
 * what it used to.
 *
 * Note what the move leaves alone: `movePlacement` does not touch the identity,
 * and a `PlacementId` survives a move. Erase-then-place did neither — it retired
 * the id and minted a new one — so a move is strictly *safer* for anything keyed
 * on a placement, and nothing that resolves a fill can be disturbed by it at
 * all, since a fill names an exact file and knows nothing of coordinates.
 */
function duplicateRefusal(piece: ScenePiece, others: readonly ScenePiece[], anchor: PlanPoint): MoveRefusal | null {
  const identity = identityOf(piece)
  const twin = others.find(
    (candidate) =>
      identityOf(candidate) === identity &&
      candidate.placement.rotation === piece.placement.rotation &&
      same([candidate.placement.x, candidate.placement.z], anchor),
  )
  if (twin === undefined) return null
  return {
    code: 'duplicate',
    message:
      `${pieceName(piece)} is already placed at ${describeCell(anchor[0], anchor[1])} at the same angle, ` +
      `so this move would hide one piece under the other and double its lines in the bill. Put back.`,
  }
}

/**
 * What makes two pieces the same *thing* — a filled template, or a base recipe.
 *
 * **Qualified by population**, and rows V4 and X9 are why. S5 compared the two id
 * spaces as bare strings and proved that safe lexically: a `GeneratedBaseId`
 * starts `gen:` and therefore fails `TileId`'s `^tiles/…` pattern, and without
 * the proof a missing kind check would be a false twin with no visible cause.
 * A1's `TemplateId` and `DesignId` are **not** lexically disjoint —
 * `src/store/schema.ts` says so outright, a `DesignId` is `d` plus twelve hex and
 * matches the slug pattern — so the lexical proof is gone for good. Prefixing the
 * `kind` restores the theorem more cheaply than any schema could: `'catalog'` and
 * `'generated'` come from a closed union and neither string is a prefix of the
 * other, so two qualified ids are equal only if both the population and the
 * identity are, and no measurement is load bearing.
 *
 * ## The catalog arm is the family **plus its fills**
 *
 * The family alone would be wrong in the direction that costs the user money:
 * two instances of one template filled with different walls are different
 * objects, print differently, and must both stay on the plan. The fills alone
 * would be wrong the other way — two families can be filled identically and are
 * still two recipes.
 *
 * `pinned` is deliberately **not** in the identity. It records *who chose* a
 * file, which is provenance rather than substance: two instances holding the same
 * five files print the same five files whether the solver or the user picked
 * them, so an identical pair differing only in `pinned` is exactly the invisible
 * doubled bill this rule exists to refuse.
 *
 * Sorted by slot, because `fills` is a map and its key order is whatever the
 * writes happened in. Two instances filled in different orders are the same
 * instance, and an unsorted join would call them different.
 *
 * Read off `placement.fills` and **not** off `piece.parts`, which is the same
 * distinction `scene.ts` draws between a fill and a drawable part: a fill naming
 * a retired file is in the map and not in the parts, so an identity taken from
 * the parts would call an instance carrying one identical to an instance that
 * never had it — and then refuse a move the user has every right to make.
 */
function identityOf(piece: ScenePiece): string {
  if (piece.kind === 'generated') return `generated:${piece.placement.base}`
  const { fills } = piece.placement
  const joined = filledSlots(fills)
    .map((slot) => `${slot}=${fills[slot]?.tile ?? ''}`)
    .sort((a, b) => a.localeCompare(b))
  return JSON.stringify(['catalog', piece.placement.template, joined])
}

/* ------------------------------------------------------ the concentric limit */

/**
 * How far a sector's centre of curvature sits outside its own bounding box, in
 * grid units, or `0` for every footprint that has no such offset.
 *
 * `sectorCentre` returns the centre in the sector's box-anchored frame with a
 * negative `x`; this is its magnitude, which is the anchor difference two
 * concentric sectors would need.
 */
export function concentricOffset(foot: Footprint): number {
  if (foot.shape !== 'arc') return 0
  return Math.abs(sectorCentre(foot)[0])
}

/** Tolerance for "this offset is a multiple of half a unit". */
const LATTICE_EPS = 1e-9

/**
 * Whether two of these pieces could be snapped concentric on the 0.5 lattice.
 *
 * True for every footprint with no centre offset — which is every straight case
 * and the 554 arcs at a 90° sweep, where `cos 90°` is exactly 0 — and true for
 * an offset that happens to be a multiple of half a unit. The corpus holds none
 * of the latter, and this is written as the arithmetic anyway: `sweep === 90`
 * would be a coincidence of the current data standing in for the reason.
 */
export function isConcentricOnLattice(foot: Footprint): boolean {
  const offset = concentricOffset(foot)
  if (offset === 0) return true
  return Math.abs(offset * 2 - Math.round(offset * 2)) < LATTICE_EPS
}

/**
 * The disclosure for a piece the snap cannot mate concentrically, or `null`.
 *
 * Said at the grab, not at the drop, because it is a fact about what the *rest*
 * of the drag can achieve: a user pushing a 45° curve towards another one needs
 * to know before they spend the drag that the two centres cannot be made to
 * agree on this lattice, and that free positioning is the only thing that would.
 */
export function concentricNote(foot: Footprint): MoveNote | null {
  if (foot.shape !== 'arc' || isConcentricOnLattice(foot)) return null
  const offset = concentricOffset(foot)
  return {
    code: 'off-lattice-centre',
    message:
      `This curve's centre sits ${formatUnits(offset)} units outside its own box, which is not a multiple of ` +
      `half a unit, so the snap cannot line it up concentrically with another curve of the same sweep. ` +
      `It will still draw and collide exactly where it is put.`,
  }
}

/* ------------------------------------------------------------------ readouts */

/** What the live region says when a piece is picked up. */
export function describeGrab(preview: MovePreview): string {
  const note = preview.note === null ? '' : ` ${preview.note.message}`
  return (
    `Picked up ${pieceName(preview.piece)} from ${describeCell(preview.from[0], preview.from[1])}. ` +
    `Arrow keys move it, Enter drops it, Escape puts it back.${note}`
  )
}

/** What the live region says on each keyboard step. Deliberately short. */
export function describeNudge(preview: MovePreview): string {
  if (preview.unchanged) {
    return `${pieceName(preview.piece)} back at ${describeCell(preview.anchor[0], preview.anchor[1])}, where it started.`
  }
  return `${pieceName(preview.piece)} to ${describeCell(preview.anchor[0], preview.anchor[1])}${overlapTail(preview)}.`
}

/**
 * What the live region says on a drop.
 *
 * The refusal case is the caller's to announce — it has its own message and the
 * piece goes back — so this covers the two committable outcomes and the no-op.
 */
export function describeDrop(preview: MovePreview): string {
  if (preview.unchanged) {
    return `${pieceName(preview.piece)} left at ${describeCell(preview.from[0], preview.from[1])}. Nothing moved.`
  }
  return (
    `Moved ${pieceName(preview.piece)} from ${describeCell(preview.from[0], preview.from[1])} ` +
    `to ${describeCell(preview.anchor[0], preview.anchor[1])}${overlapTail(preview)}.`
  )
}

/** What the live region says when a move is abandoned. */
export function describeCancel(preview: MovePreview): string {
  return `Put ${pieceName(preview.piece)} back at ${describeCell(preview.from[0], preview.from[1])}.`
}

/** The hint plate's line while a move is in the air, §2.4's bottom-left. */
export function describeMoveHint(preview: MovePreview): string {
  if (preview.refusal !== null) return preview.refusal.message
  if (preview.unchanged) {
    return `Moving ${pieceName(preview.piece)}. Drag or use the arrow keys; Escape puts it back.`
  }
  return (
    `Moving ${pieceName(preview.piece)} to ${describeCell(preview.anchor[0], preview.anchor[1])}` +
    `${overlapTail(preview)}. Drop to commit, Escape puts it back.`
  )
}

/**
 * ", overlapping N pieces" — or nothing.
 *
 * Counted rather than named: a drop into a tiled floor can touch four
 * neighbours, and reading four tile names is not a readout.
 */
function overlapTail(preview: MovePreview): string {
  const count = preview.overlaps.length
  if (count === 0) return ''
  return `, overlapping ${String(count)} ${count === 1 ? 'piece' : 'pieces'} already there`
}
