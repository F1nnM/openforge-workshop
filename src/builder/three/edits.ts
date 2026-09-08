/**
 * What a gesture on the 3D surface *means* — resolved as a value, before
 * anything is written.
 *
 * `PlanCanvas.tsx` computed the same four verdicts inside four `useCallback`s
 * and wrote to the store from inside them, which is why nothing in this project
 * was ever able to test "clicking there places that": the decision and the side
 * effect were the same statement. This module separates them. Every function here
 * is pure — a scene in, a {@link SurfaceEdit} out — and the component's job
 * shrinks to reading the verdict, making one store call, and saying the
 * `message`. Row **R4** deleted that component, so the entangled version is gone
 * and this is the only implementation; the argument is kept because it is why
 * this module is shaped the way it is.
 *
 * That matters more here than it did in 2D, because jsdom has no WebGL context:
 * **no test in this repo can mount the 3D surface.** The verdicts can still be
 * proven exactly, and they are the substance of the row.
 *
 * ## Nothing here constructs a `TemplateInstance`
 *
 * A `place` edit carries the **family, the anchor and the angle**, not a store
 * object, and the one line that turns those into a `placeTemplate` call lives in
 * `RoomSurface.tsx`. Nothing in this row reads a field off a store record:
 * coordinates come from `ScenePiece.placement` through the pure API `move.ts`
 * already exposes, and identity is a `PlacementId` or a `TemplateId`.
 *
 * ## Row A4b: the armed thing is a **template family**, and that shrinks placing
 *
 * Row **A1** made templates the only placement unit (§2.5) and retyped the
 * palette's selection to a `TemplateId`; `placeTemplate` is the only placement
 * action the store offers. So the four gestures split cleanly in two:
 *
 *   - **Erasing, moving and turning are unaffected.** All three act on a piece
 *     that is *already* in the scene, and A4a's projection hands them one with a
 *     box, an outline, a name and a rotation step — `pieceRotationStep` being the
 *     least common multiple of its parts'. Every refusal they carry is still
 *     `move.ts`'s, re-worded and never re-decided.
 *   - **Placing had almost nothing left to refuse**, and that was the honest
 *     consequence of what an armed template *is*. Every refusal `computeGhost`
 *     produced was a fact about a footprint: `none` has nothing to draw, an
 *     identical file at an identical corner and angle is an invisible double, an
 *     outline overlaps, a band rule is unmeasured. **None of those four is
 *     answerable about a family** from the cursor and the pending angle alone,
 *     and inventing an answer — say by picking the first file the palette happens
 *     to hold — would refuse placements the app will accept and permit ones it
 *     will not.
 *
 * ## The overlap refusal, and the argument it did not win by
 *
 * An overlapping placement is now **refused**, which reverses the sentence this
 * module used to carry — *"an overlap still informs and commits"*. It did not win
 * by overruling `overlap.ts`; it won by that module learning to say how sure it
 * is. `subjectsConflict` returns a {@link ConflictKind}, only `exact` refuses,
 * and every doubt the old sentence rested on — a decomposed sector, an unknown
 * level, an unbucketed band — still commits exactly as before.
 *
 * It also answers the paragraph above. The reason placing could refuse nothing
 * was that a **family** has no footprint to reason about; the reason it can now
 * is that {@link projectPlacement} resolves the family into the pieces the scene
 * would draw, through `buildPlanScene` itself, so there is a real footprint to
 * test. The refusal is therefore not a new opinion about geometry — it is the
 * scene's own projection, asked one gesture early.
 *
 * ## Row C5: the click carries a **fill**, and that is the whole of the row
 *
 * A4b wrote *"turning a family into files is row C2's fill solver and it does not
 * exist"*, and it did not. It does now, and until this row it was wired to a lock
 * change and to nothing else — so `planPlacement` wrote `fills: {}` and, since
 * nothing draws for an unfilled instance, **placing a template drew nothing**.
 * The three surfaces below that said so were correct when they were written and
 * are re-worded here, because a sentence that describes a defect after the defect
 * is fixed is just a wrong sentence.
 *
 * What changed is one parameter. {@link planPlacement} takes a
 * {@link PlacementFill} — `fills.ts` composes C2's solver, C1's armed size and
 * B2's closure check into it — and this module stays pure: it decides *what the
 * click means* and never solves anything itself. The verdict carries the store's
 * own fill map, so `RoomSurface` still writes what the verdict says.
 *
 * Contract **C-g** did not stop mattering; it stopped being the *usual* case.
 * `fills` may still name no slots, §3.2 still places a template with no candidate
 * for a part *"anyway"*, `PlanScene.unfilled` is still where such an instance
 * appears, and `workshopStore.ts` still states it from the store's end — *"an
 * unfilled slot is an ordinary state of an instance, not a degraded one"*. The
 * one thing the surface owes the user is to **say** what it did: how many parts
 * were chosen for them, which slots still need a choice, and any doubt B2 has
 * about the ones that were chosen.
 *
 * {@link templateGhost} is the marker that goes with it, and `ghost.ts`'s
 * `computeGhost` is deliberately not called: it takes one `CatalogRecord` and
 * there is none to give it. See that function for what the marker claims and
 * what it does not.
 */
import type {
  ConflictKind,
  MoveDrag,
  MovePreview,
  PlanBox,
  PlanCatalog,
  PlanPart,
  PlanPoint,
  PlanScene,
  PlanStyle,
  PlanTool,
  ScenePiece,
  SnapMode,
} from '@/builder/canvas'
import {
  beginMove,
  buildPlanScene,
  describeCancel,
  describeCell,
  describeDrop,
  describeGrab,
  describeMoveHint,
  describeTemplate,
  formatUnits,
  nextRotation,
  partAt,
  pieceAt,
  pieceName,
  pieceRotationStep,
  pieceSubjects,
  planBox,
  planQuad,
  previewMove,
  scenePaintOrder,
  sceneSubjects,
  snapTo,
  subjectsConflict,
} from '@/builder/canvas'
import type { CatalogRecord } from '@/catalog'
import { DEFAULT_ROTATION_STEP_DEG } from '@/catalog'
import type { PlacementId, SlotName, TemplateId, TemplateInstance } from '@/store'

import type { PlacementFill } from './fills'
import { describePlacementFill } from './fills'

/**
 * A gesture's outcome: at most one store write, and the sentence to say.
 *
 * `refuse` is not an error state — it is the third of three ordinary answers a
 * click can have, alongside "this happened" and "nothing was there". Every arm
 * carries a `message`, because a surface that silently declines is
 * indistinguishable from one that is broken.
 */
export type SurfaceEdit =
  | {
      readonly kind: 'place'
      /**
       * The armed **family**. The caller turns this into a `placeTemplate` call.
       *
       * A `TemplateId` and not a record since row A4b: §2.5 makes templates the
       * only placement unit, and both id spaces are opaque strings that
       * `src/store/schema.ts` measures as *not* lexically disjoint — so the type
       * is the only thing that can catch a caller still meaning a file.
       */
      readonly template: TemplateId
      /** Minimum corner, snapped. The marker's own anchor, not a second derivation. */
      readonly anchor: PlanPoint
      readonly rotation: number
      /**
       * The slots this instance is placed with, every one `pinned: false`.
       *
       * C2's solve, carried through unchanged. A4b carried the field before
       * there was anything to put in it *"so the day C2's solver produces a fill
       * map this arm needs no new shape"* — row C5 is that day, and the arm
       * needed no new shape. It may still name **no** slots: contract **C-g**,
       * and `PlanScene.unfilled` reports the instance when it does.
       */
      readonly fills: TemplateInstance['fills']
      readonly message: string
    }
  | {
      readonly kind: 'remove'
      readonly id: PlacementId
      /** Which store map holds it — `removeGeneratedPlacement` also frees a mesh. */
      readonly generated: boolean
      readonly message: string
    }
  | {
      readonly kind: 'move'
      readonly id: PlacementId
      readonly generated: boolean
      readonly x: number
      readonly z: number
      readonly message: string
    }
  | {
      readonly kind: 'turn'
      readonly id: PlacementId
      readonly generated: boolean
      readonly rotation: number
      readonly message: string
    }
  | {
      readonly kind: 'arm'
      /** The armed tile's own step, in degrees. Never assumed to be 90. */
      readonly step: number
      readonly direction: 1 | -1
      readonly message: string
    }
  | { readonly kind: 'none'; readonly message: string }

/** Whether an edit writes to the store. `none` is the only arm that does not. */
export function writes(edit: SurfaceEdit): boolean {
  return edit.kind !== 'none'
}

/* -------------------------------------------------------------------- placing */

/**
 * The extent of the armed marker: **one cell**.
 *
 * Not a claim about the family's size, and it must not be read as one — the
 * `s2w` corner families are 2 × 2 and the corridors are longer still. It is the
 * *cursor's* own cell.
 *
 * **Row C5 solves the fills on the click and still draws one cell**, which is a
 * decision rather than an omission — and row **C6 replaced the reason for it
 * without changing the answer.**
 *
 * The footprint is the union of the parts' own boxes *placed by B2's rule*. C5
 * wrote that the rule was not wired at all: `BuilderScreen` built its
 * `PlanCatalog` with `originSlotLayout`, so every part of a placed instance drew
 * at the instance's origin, and a marker claiming a union the renderer did not
 * draw would have been wrong in the one direction that matters — it would have
 * promised a shape. **C6 wired it.** It widened `catalog.ts#SlotLayoutRule` to
 * the instance's whole fill map, which is exactly what
 * `builder/canvas/fixture.ts#FIXTURE_CELL` measured it needed, and the screen
 * composes `templateSlotLayout` over the family table. The renderer draws the
 * union now.
 *
 * What still stops *this* marker claiming it is not the rule but **the fills**.
 * The union is a function of them — the `cell` every part is inset within is the
 * `floor` fill's own footprint — and {@link templateGhost} is handed a family,
 * an angle, a cursor and a snap step, and nothing else. {@link planPlacement}
 * takes C5's `PlacementFill` as an *optional* parameter precisely so this module
 * stays clear of the 8,702-record assembly index the solver needs, and its
 * absent case is a real caller: the landing hero arms a family over six records
 * and can honestly say nothing about its parts. So a marker claiming the union
 * would have to run the solver on every pointer move and would *still* have
 * nothing to draw for that caller. It remains a row of its own; it is now a
 * different one.
 */
const MARKER_EXTENT = { w: 1, d: 1 } as const

/**
 * Where the armed family would land, and the marker drawn over it.
 *
 * **The one derivation of the anchor**, which is the guarantee `ghost.ts` was
 * built for restated at a smaller size: the marker the user saw and the anchor
 * that reaches `placeTemplate` come out of one call, so they cannot be half a
 * unit apart. `RoomSurface` draws from this function on the same cursor that
 * {@link planPlacement} resolves, so the two agree by construction rather than by
 * both being careful.
 *
 * ## What the marker claims, and what it does not
 *
 * It is a **1 × 1 cell outline at the snapped anchor** and nothing more. Not the
 * instance's footprint — a family's footprint is the union of its parts' boxes
 * *as B2's rule places them*, and since row C6 the scene really is drawn that
 * way; what this function has not got is the fills the union is a function of.
 * {@link MARKER_EXTENT} carries the whole argument. Not turned by `rotation`
 * either, and that is deliberate rather
 * than unfinished: the anchor is the *minimum corner* the store receives, which
 * `slotAnchor` keeps invariant under rotation for a real instance, and a square
 * marker is already its own bounding box — so turning it could only move it away
 * from the point the placement lands on. The angle is still carried through to the
 * store, where it means what §1 says it means: the instance is placed and
 * rotated as one unit.
 *
 * The cursor is the point the marker is *centred* on, which is what makes it feel
 * attached to the pointer, so the corner is derived by backing off half a cell
 * before snapping — the same arithmetic `computeGhost` uses for the footprint it
 * cannot draw.
 */
export interface TemplateGhost {
  readonly template: TemplateId
  /** Minimum corner, snapped. What reaches `placeTemplate`. */
  readonly anchor: PlanPoint
  /** The pending angle, carried to the store. The marker itself does not turn. */
  readonly rotation: number
  readonly box: PlanBox
  /** The marker's outline, in world units — one axis-aligned cell. */
  readonly polygons: readonly PlanPart[]
  /** The family, as a readout says it. `describeTemplate`'s wording. */
  readonly name: string
}

export function templateGhost(
  template: TemplateId,
  rotation: number,
  cursor: PlanPoint,
  step: number,
): TemplateGhost {
  const anchor: PlanPoint = [snapTo(cursor[0] - 0.5, step), snapTo(cursor[1] - 0.5, step)]
  return {
    template,
    anchor,
    rotation,
    box: planBox(MARKER_EXTENT, 0, anchor[0], anchor[1]),
    polygons: [planQuad(MARKER_EXTENT, 0, anchor[0], anchor[1])],
    name: describeTemplate(template),
  }
}

/**
 * The id the projected candidate is built under.
 *
 * Any string would do and that is worth stating rather than leaving to be
 * rediscovered: the candidate is **not in the scene**, so it cannot collide with
 * itself and no same-id exemption has to hold for it. The value is chosen to be
 * obvious in a debugger and to fail `TileId`'s pattern, so it can never be
 * mistaken for a real placement if one ever leaked.
 */
const CANDIDATE_ID = 'candidate:not-placed' as PlacementId

/**
 * A placement that has not happened yet, resolved the way a placed one is.
 *
 * ## Why this projects through `buildPlanScene` rather than computing geometry
 *
 * The property that matters is **agreement**: the piece the user is shown before
 * the click and the piece the scene draws after it must be the same shape, at the
 * same elevations, in the same bands. Anything that recomputed part layout here
 * would be a second implementation of `slotGeometry`, `templateSlotLayout` and
 * the band assignment, and the failure mode of a second implementation is a ghost
 * that says *clear* where the scene then says *conflict* — which, now that a
 * conflict refuses, would be a placement the user watched succeed and then did
 * not get.
 *
 * So the candidate is built as a **one-instance scene** and its piece is read
 * back out. That is one `buildPlanScene` call over a single placement: the same
 * resolver, the same layout rule, the same `pieceSubjects`. It cannot disagree
 * with the room because it *is* the room's own projection, run on one instance.
 *
 * ## What it costs
 *
 * One projection of one instance per call. The expensive part of a hover is not
 * this — it is the fill solve, which `fills.ts` memoises on `(family, size)` and
 * which the click already paid before this function existed. The `style` resolver
 * is passed in rather than created, for `createStyleResolver`'s own stated reason:
 * it memoises on the record, and one created here would be thrown away on every
 * call.
 *
 * `piece` is `undefined` when the instance draws nothing — every fill unknown,
 * undrawable, or no fills at all, which contract **C-g** makes an ordinary state.
 * A candidate with nothing to draw conflicts with nothing, which is the honest
 * answer: there is no geometry to collide.
 */
export interface PlacementProjection {
  /** The candidate as the scene would draw it, or `undefined` if it draws nothing. */
  readonly piece: ScenePiece | undefined
  /** Every scene piece the candidate lands on, exact or not. For the drawing. */
  readonly overlaps: readonly ScenePiece[]
  /** The subset of {@link overlaps} that **refuses** the placement. */
  readonly blocking: readonly ScenePiece[]
}

export function projectPlacement(
  catalog: PlanCatalog,
  style: (record: CatalogRecord) => PlanStyle,
  scene: PlanScene,
  template: TemplateId,
  anchor: PlanPoint,
  rotation: number,
  fills: TemplateInstance['fills'],
): PlacementProjection {
  const candidate: TemplateInstance = {
    id: CANDIDATE_ID,
    template,
    x: anchor[0],
    z: anchor[1],
    rotation,
    fills,
  }
  const projected = buildPlanScene({ [CANDIDATE_ID]: candidate }, catalog, style)
  const piece = projected.pieces[0]
  if (piece === undefined) return { piece: undefined, overlaps: [], blocking: [] }

  const subjects = pieceSubjects(piece)
  const hit = new Map<PlacementId, ConflictKind>()
  for (const other of sceneSubjects(scene)) {
    for (const subject of subjects) {
      const verdict = subjectsConflict(other, subject)
      if (verdict === null) continue
      if (verdict.kind === 'exact' || !hit.has(other.id)) hit.set(other.id, verdict.kind)
    }
  }
  const order = scenePaintOrder(scene)
  return {
    piece,
    overlaps: order.filter((one) => hit.has(one.id)),
    blocking: order.filter((one) => hit.get(one.id) === 'exact'),
  }
}

/**
 * What a click at `at` would place, with the fills it would place it with.
 *
 * Two outcomes rather than the old five, and the module note sets out why: with
 * an armed *family* there is no footprint to refuse, duplicate, overlap or
 * disclose a band rule about. So this refuses exactly one thing — an empty
 * palette — and otherwise places.
 *
 * `fill` is `fills.ts`'s answer for the armed family at the armed size, and it
 * is a **parameter** rather than a call, which is what keeps this module pure and
 * testable: the solver needs an 8,702-record assembly index and a 409,432-byte
 * inverted index, and no test in this repo could mount a surface that built them
 * itself. `RoomSurface` holds the memoised filler and hands over one answer.
 *
 * **It is optional, and the absent case is a real one rather than a fallback**:
 * a caller with no catalog — the landing hero, a component test — arms a family
 * over six records and can honestly say nothing about its parts. That placement
 * *does* draw nothing, and the sentence says so, which is A4b's wording kept
 * exactly where it is still true.
 */
export function planPlacement(
  template: TemplateId | null,
  rotation: number,
  at: PlanPoint,
  step: number,
  fill?: PlacementFill,
  projection?: PlacementProjection,
): SurfaceEdit {
  if (template === null) {
    return { kind: 'none', message: 'No template is armed. Choose one in the palette first.' }
  }
  const ghost = templateGhost(template, rotation, at, step)
  const blocker = projection?.blocking[0]
  if (blocker !== undefined) {
    return { kind: 'none', message: blockedMessage(ghost.name, projection?.blocking ?? []) }
  }
  const placed = `Placed ${ghost.name} at ${describeCell(ghost.anchor[0], ghost.anchor[1])}`
  const overlapping = (projection?.overlaps ?? []).length
  // An inexact overlap places and says so, which is exactly what an overlap did
  // before the split. Counted rather than named, `move.ts#overlapTail`'s reason:
  // a tiled floor can be touched on four sides and four tile names is not a
  // readout. A refusal is the one message that names, because it is the one
  // message that stops the user.
  const tail =
    overlapping > 0
      ? `, overlapping ${String(overlapping)} ${overlapping === 1 ? 'piece' : 'pieces'} already there`
      : ''
  return {
    kind: 'place',
    template,
    anchor: ghost.anchor,
    rotation: ghost.rotation,
    fills: fill?.fills ?? {},
    message:
      fill === undefined
        ? `${placed}${tail} with no parts chosen yet. Fill its slots to give it something to draw.`
        : `${placed}${tail}: ${describePlacementFill(fill)}`,
  }
}

/**
 * What a refused placement says.
 *
 * **Names the blocker.** `overlap.ts` warns that *"a heuristic that blocks and is
 * occasionally wrong costs them a tile they cannot place and no way to find out
 * why"*, and this is the sentence that has to answer it: the user pressed, got
 * nothing, and the only acceptable reply names the piece and the cell so they can
 * see what to move.
 *
 * The first blocker is named even when there are several, and the rest are
 * counted. Moving off any one of them is progress, and reading four tile names is
 * the paragraph the count exists to avoid.
 */
function blockedMessage(name: string, blocking: readonly ScenePiece[]): string {
  const first = blocking[0]
  if (first === undefined) return `${name} was not placed.`
  const where = describeCell(first.placement.x, first.placement.z)
  const more = blocking.length > 1 ? ` and ${String(blocking.length - 1)} more` : ''
  return `${name} was not placed: ${pieceName(first)} at ${where}${more} is in the way.`
}

/* -------------------------------------------------------------------- erasing */

/**
 * What a click at `at` would remove.
 *
 * `pieceAt` and not a mesh raycast — see `surface.ts` for why, and note what it
 * buys here: the piece this returns is the piece the conflict sweep would have
 * found at the same point, so "erase what is blocking me" cannot pick a
 * different piece from the one that reported the block.
 */
export function planRemoval(scene: PlanScene, at: PlanPoint): SurfaceEdit {
  const piece = pieceAt(scene, at)
  if (piece === undefined) {
    return { kind: 'none', message: `Nothing to remove at ${describeCell(at[0], at[1])}.` }
  }
  return removalOf(piece)
}

/** The removal of a named piece. Shared with the held-piece `Delete`. */
export function removalOf(piece: ScenePiece): SurfaceEdit {
  return {
    kind: 'remove',
    id: piece.id,
    generated: piece.kind === 'generated',
    message: `Removed ${pieceName(piece)} from ${describeCell(piece.placement.x, piece.placement.z)}.`,
  }
}

/* ---------------------------------------------------------------- customising */

/** What a right click on the drawing asks the slot editor to open. */
export interface SlotEditGesture {
  /**
   * The instance, by its key in `WorkshopState.placements` — or `null` when the
   * click opens nothing.
   *
   * Flat rather than a nested target object, so there is exactly **one** name
   * for this shape in the repository. The state the editor opens from is
   * `builder/panels/slots`'s `SlotEditTarget`, on the far side of a boundary
   * this module must not be imported across, and two identically-named types
   * either side of that line would read as one type that had been shared.
   */
  readonly placement: PlacementId | null
  /**
   * The slot whose **part** the click landed in, for the editor to open on.
   *
   * `undefined` means *open on the instance and let it choose the row* — which
   * is exactly what the panel-row route asks for, since a row names a placement
   * and no point. From a pick it is effectively always present, because a
   * catalog piece the pick resolved to always resolves to one of its parts:
   * `PlanPiece.polygons` **is** `parts.flatMap((part) => part.polygons)`, so the
   * union `pieceAt` tests is the same polygons `partAt` walks. It stays optional
   * because that identity is `scene.ts`'s to keep and not this module's to
   * assume, and because the fallback is a real behaviour rather than a guard.
   */
  readonly slot: SlotName | undefined
  /** What to announce. Never empty — see below. */
  readonly message: string
}

/**
 * What a right click at `at` customises — the instance, and the slot it hit.
 *
 * The owner asked for the editor to *"come up with a right click"* and row C3
 * put the gesture on the panel row instead, because a secondary press never
 * reached the surface. This is the other half, and it resolves through the same
 * `pieceAt` erase and move resolve through — so the piece a right click opens is
 * the piece a left click in Erase mode would remove, and the two gestures cannot
 * disagree about which of two stacked instances the pointer is on. **Last in
 * paint order wins**, which for two overlapping instances is the one placed most
 * recently; `scenePaintOrder` is the single statement of that and this adds no
 * second one.
 *
 * Where the two gestures *do* differ is one level down: erase takes a whole
 * `PlacementId`, and this takes {@link partAt} as well, because the request was
 * *"customize the slots"* and a user who has just pointed at a wall has already
 * said which slot they mean.
 *
 * A `message` on every arm, for {@link SurfaceEdit}'s own reason: the two arms
 * that open nothing — bare ground, and a generated base, which names no recipe
 * and therefore has no slots — would otherwise be indistinguishable from a
 * surface that had not heard the click. There is no store write on any arm,
 * which is why this does not return a `SurfaceEdit`: opening a dialog is the
 * caller's, and the caller is the only thing here that knows a dialog exists.
 */
export function planSlotEdit(scene: PlanScene, at: PlanPoint): SlotEditGesture {
  const piece = pieceAt(scene, at)
  if (piece === undefined) {
    return { placement: null, slot: undefined, message: `Nothing to customise at ${describeCell(at[0], at[1])}.` }
  }
  if (piece.kind === 'generated') {
    // A generated base is `x` by `y` of arithmetic over parameters the user set
    // in the generator drawer. It is a placement and it can be moved and
    // removed, but it names no recipe, so `TemplateInstance.fills` has no key
    // for it and there is nothing for the editor to list.
    return {
      placement: null,
      slot: undefined,
      message: `${pieceName(piece)} was generated from parameters, so it has no recipe slots to change.`,
    }
  }
  const part = partAt(piece, at)
  const where = describeCell(piece.placement.x, piece.placement.z)
  return {
    placement: piece.id,
    slot: part?.slot,
    message:
      part === undefined
        ? `Slots for ${pieceName(piece)} at ${where}.`
        : `The ${part.slot} slot of ${pieceName(piece)} at ${where}.`,
  }
}

/* ---------------------------------------------------------------------- moving */

/**
 * What dropping the held piece would do.
 *
 * Three outcomes and `move.ts` owns all three: a refusal (the duplicate, put
 * back), a no-op (dropped where it started), and the write. The messages are
 * `move.ts`'s own so a move announces the same thing here as it does on the plan.
 */
export function planDrop(drag: MoveDrag, scene: PlanScene): SurfaceEdit {
  const preview = previewMove(drag, scene)
  // The piece can vanish mid-drag — the bill panel can remove it — and
  // `previewMove` returns `undefined` rather than throwing for exactly that race.
  if (preview === undefined) return { kind: 'none', message: 'The piece being moved is no longer there.' }
  if (preview.refusal !== null) return { kind: 'none', message: preview.refusal.message }
  if (!preview.committable) return { kind: 'none', message: describeDrop(preview) }
  return {
    kind: 'move',
    id: drag.id,
    generated: preview.piece.kind === 'generated',
    x: drag.anchor[0],
    z: drag.anchor[1],
    message: describeDrop(preview),
  }
}

/** What a grab at `at` picks up, as a drag plus the sentence to say. */
export function planGrab(
  scene: PlanScene,
  at: PlanPoint,
  grab: PlanPoint | null,
): { readonly drag: MoveDrag | null; readonly message: string } {
  const piece = pieceAt(scene, at)
  if (piece === undefined) {
    return { drag: null, message: `Nothing to move at ${describeCell(at[0], at[1])}.` }
  }
  const drag = beginMove(piece, grab)
  const preview = previewMove(drag, scene)
  if (preview === undefined) return { drag: null, message: `Nothing to move at ${describeCell(at[0], at[1])}.` }
  return { drag, message: describeGrab(preview) }
}

/** What abandoning a move says. Nothing was written, so there is nothing to undo. */
export function describeAbandon(drag: MoveDrag, scene: PlanScene): string {
  const preview = previewMove(drag, scene)
  return preview === undefined ? 'Move cancelled.' : describeCancel(preview)
}

/* -------------------------------------------------------------------- turning */

/**
 * What `R` turns: the piece in the air, else the sticky target, else the piece
 * under the cursor, else the armed tile.
 *
 * The precedence was `PlanCanvas`'s and each step of it is a behaviour somebody
 * would otherwise lose. A piece being carried outranks the cursor because `R`
 * mid-move must turn what is held. The sticky target outranks the cursor because
 * turning a 2 × 0.5 wall by 60° moves it out from under the point that was
 * clicked, and the second press would otherwise silently start turning the
 * *ghost* instead.
 *
 * ## The step of a **placed** piece is measured; the armed family's cannot be
 *
 * For a piece in the scene it is `pieceRotationStep(piece)` — the least common
 * multiple of its parts' own steps, which is the coarsest angle *every* part can
 * still mate at. 893 tiles carry an angle that is not a multiple of 90, and on
 * all 1,199 curves the step *equals the sweep*, which is what makes one press
 * land a curve beside its predecessor. That is unchanged and it is why `R` on a
 * placed template is exact.
 *
 * For an armed **family** it is {@link ARMED_TURN_STEP_DEG}, because a family's
 * step is a fact about its parts' files and `R` is pressed *before* the click
 * that solves them. Row **C5** makes a finer answer reachable — the filler is
 * memoised, so `pieceRotationStep` over a solved fill would cost nothing on the
 * second press — and declines to take it, because changing what a key press
 * means is a decision about the gesture rather than a consequence of wiring the
 * click. It is `DEFAULT_ROTATION_STEP_DEG` by name rather than a literal 90, so
 * the one place the corpus's default is written down is still the only place, and
 * one constant is still what changes.
 */
export function planTurn(
  scene: PlanScene,
  sticky: PlacementId | null,
  under: ScenePiece | undefined,
  armed: TemplateId | null,
  armedRotation: number,
  direction: 1 | -1 = 1,
): SurfaceEdit {
  const target = sticky === null ? undefined : scenePaintOrder(scene).find((piece) => piece.id === sticky)
  const piece = target ?? under
  if (piece !== undefined) {
    const rotation = nextRotation(piece.placement.rotation, pieceRotationStep(piece), direction)
    return {
      kind: 'turn',
      id: piece.id,
      generated: piece.kind === 'generated',
      rotation,
      message: `Turned ${pieceName(piece)} to ${formatUnits(rotation)} degrees.`,
    }
  }
  if (armed === null) {
    return { kind: 'none', message: 'Nothing to turn. Arm a template or put the pointer on a placed one.' }
  }
  const step = ARMED_TURN_STEP_DEG
  return {
    kind: 'arm',
    step,
    direction,
    message:
      `${describeTemplate(armed)} will be placed at ` +
      `${formatUnits(nextRotation(armedRotation, step, direction))} degrees.`,
  }
}

/**
 * The step `R` turns an armed **family** by: the corpus's own default, 90°.
 *
 * Not a guess and not a hardcoded literal — `DEFAULT_ROTATION_STEP_DEG` is where
 * `@/catalog` writes the corpus default down, and this names it so that the one
 * place is still the only place. It is the right answer for a family precisely
 * because nothing finer is *known*: a step is a property of the files in the
 * parts, `pieceRotationStep` computes it as their least common multiple once
 * they exist, and proposing a finer angle for a family whose parts cannot mate at
 * it would be worse than proposing the default.
 */
export const ARMED_TURN_STEP_DEG = DEFAULT_ROTATION_STEP_DEG

/* --------------------------------------------------------------------- readout */

/**
 * What the surface knows that its surroundings show.
 *
 * **The one type in this row that was written to outlive a deletion, and it
 * did.** It was declared here as a field-for-field copy of `PlanStatus` rather
 * than imported, because `PlanStatus` lived in `PlanCanvas.tsx` and row **R4**
 * was going to delete it. R4 has: the plan view is gone, `PlanToolbar.status` and
 * `BuilderScreen`'s two corner plates take this type, and there is one readout
 * shape with one implementation instead of two identical ones. The duplication
 * cost one row of two structurally equal interfaces and bought a deletion with no
 * type surgery in it.
 */
export interface SurfaceStatus {
  readonly cursor: PlanPoint
  readonly snap: SnapMode
  readonly step: number
  readonly tool: PlanTool
  readonly hint: string
  readonly selectedName: string | null
  readonly refusal: string | null
  readonly moving: string | null
  readonly placements: number
  readonly conflicts: number
}

export interface SurfaceHintInput {
  readonly tool: PlanTool
  /** The armed family, or `null` when the palette has nothing selected. */
  readonly armed: TemplateId | null
  readonly under: ScenePiece | undefined
  readonly moving: MovePreview | undefined
  /** `false` while the pointer is off the plan — orbited past the horizon, or outside. */
  readonly onPlan: boolean
  /**
   * Drawn **parts** whose mesh has not arrived, each one a plate on screen.
   *
   * Parts and not placements since row A4b, because a plate is drawn per part:
   * a three-part template with one converted file is two plates and one mesh,
   * and a count of *placements* would say "1 outlined" about two outlines.
   */
  readonly waiting: number
  /**
   * Instances with no filled slot at all — `PlanScene.unfilled.length`.
   *
   * **No longer the state a fresh placement lands in.** Until row C5 it was: the
   * click wrote `fills: {}` and every placement landed here, which is why A4b
   * made it the line's highest-priority sentence. The click now carries C2's
   * solve, so an instance reaches this list only when the solver could fill
   * *nothing* — a size the archive has no tag for, or a family this build has no
   * recipe for — or when it was restored from a room saved before its parts were
   * chosen. That makes it rarer and **more** worth naming, because it is now a
   * fact about the archive rather than a stage every placement passes through.
   * Contract **C-g** makes it legitimate; this makes it legible.
   */
  readonly unfilled: number
}

/**
 * The contextual line, §2.4's bottom-left, in the 3D surface's own vocabulary.
 *
 * The precedence was `PlanCanvas`'s `buildHint` and the wording was not: this
 * surface's primary gesture is **click**, its drag is the orbit, and it has no
 * drag-paint to describe.
 *
 * Two of the lines are about the gap between what is in the store and what is on
 * screen, and both are ordered *below* every gesture and *above* the plain case,
 * because neither is an error and neither may be silent: `unfilled` is an
 * instance whose slots nobody has chosen files for, and `waiting` is a part whose
 * chosen file has no mesh yet. `unfilled` leads, because it is the one the user
 * can act on — fill the slots — where a conversion only needs waiting for.
 *
 * The four ghost lines row R2 wrote here are **gone with the record-shaped
 * ghost**, not merely unreachable: a refusal, a duplicate, an overlap and an
 * unmeasured band are all facts about a footprint, and an armed family has none
 * until C2 resolves it. Restating them against a marker would be the surface
 * asserting something it does not know.
 */
export function describeSurfaceHint(input: SurfaceHintInput): string {
  const { tool, armed, under, moving, onPlan, waiting, unfilled } = input

  // A piece in the air outranks everything: nothing else on screen is what the
  // user is doing.
  if (moving !== undefined) return describeMoveHint(moving)
  if (!onPlan) return 'Drag to orbit. Point at the plan to place or remove a template.'

  if (tool === 'move') {
    return under === undefined
      ? 'Move: drag a template to reposition it. Drag anywhere else to orbit.'
      : `Move: drag ${pieceName(under)} to reposition it.`
  }
  if (tool === 'erase') {
    return under === undefined
      ? 'Erase: click a template to remove it.'
      : `Erase: click to remove ${pieceName(under)}.`
  }
  if (armed === null) return 'Choose a template in the palette, then click the plan to place it.'

  const name = describeTemplate(armed)
  if (unfilled > 0) {
    return (
      `${unfilled === 1 ? 'One placed template has' : `${String(unfilled)} placed templates have`} no parts the ` +
      `archive could fill, so ${unfilled === 1 ? 'it draws' : 'they draw'} nothing. Choose ` +
      `${unfilled === 1 ? 'its' : 'their'} parts, or click to place ${name}.`
    )
  }
  if (waiting > 0) {
    return (
      `${String(waiting)} placed ${waiting === 1 ? 'part has' : 'parts have'} no mesh yet and ` +
      `${waiting === 1 ? 'is' : 'are'} drawn as a marked outline. Click to place ${name}.`
    )
  }
  return `Click to place ${name}. R turns by ${formatUnits(ARMED_TURN_STEP_DEG)}°.`
}

/**
 * The `<canvas>`'s accessible label — a summary, not an inventory.
 *
 * Counts **placements** in both populations, which is what a user means by "how
 * much is in this room"; `waiting` is parts, and it is named as parts so the two
 * numbers cannot be read as the same unit. The instances with nothing chosen are
 * counted separately for {@link describeSurfaceHint}'s reason: a room of five
 * templates and no fills is not an empty room, and it is not a full one either.
 */
export function describeSurface(scene: PlanScene, waiting: number): string {
  const placed = scene.pieces.length + scene.generated.length + scene.unfilled.length
  if (placed === 0) {
    return 'An empty plan in 3D. Drag to orbit; click to place the armed template.'
  }
  const conflict = scene.conflicts.size === 0 ? '' : `, ${String(scene.conflicts.size)} overlapping`
  const pending = waiting === 0 ? '' : `, ${String(waiting)} ${waiting === 1 ? 'part' : 'parts'} awaiting a mesh`
  const empty =
    scene.unfilled.length === 0 ? '' : `, ${String(scene.unfilled.length)} with no parts chosen`
  return (
    `${String(placed)} placed ${placed === 1 ? 'template' : 'templates'} in 3D${conflict}${empty}${pending}. ` +
    'Drag to orbit; click to place or remove.'
  )
}
