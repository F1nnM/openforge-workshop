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
 *     `move.ts`'s, re-worded and never re-decided, and an overlap still **informs
 *     and commits** because `overlap.ts` is emphatic about that.
 *   - **Placing has almost nothing left to refuse**, and that is not a
 *     simplification — it is the honest consequence of what an armed template
 *     *is*. Every refusal `computeGhost` produced was a fact about a footprint:
 *     `none` has nothing to draw, an identical file at an identical corner and
 *     angle is an invisible double, an outline overlaps, a band rule is
 *     unmeasured. **None of those four is answerable about a family** from the
 *     cursor and the pending angle alone, and inventing an answer — say by
 *     picking the first file the palette happens to hold — would refuse
 *     placements the app will accept and permit ones it will not.
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
  MoveDrag,
  MovePreview,
  PlanBox,
  PlanPart,
  PlanPoint,
  PlanScene,
  PlanTool,
  ScenePiece,
  SnapMode,
} from '@/builder/canvas'
import {
  beginMove,
  describeCancel,
  describeCell,
  describeDrop,
  describeGrab,
  describeMoveHint,
  describeTemplate,
  formatUnits,
  nextRotation,
  pieceAt,
  pieceName,
  pieceRotationStep,
  planBox,
  planQuad,
  previewMove,
  scenePaintOrder,
  snapTo,
} from '@/builder/canvas'
import { DEFAULT_ROTATION_STEP_DEG } from '@/catalog'
import type { PlacementId, TemplateId, TemplateInstance } from '@/store'

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
 * decision rather than an omission. The footprint is the union of the parts'
 * own boxes *placed by B2's rule*, and that rule is not wired to the canvas:
 * `BuilderScreen` builds its `PlanCatalog` with `originSlotLayout`, so every
 * part of a placed instance is drawn at the instance's origin today. A marker
 * that claimed a union the renderer does not yet draw would be wrong in the one
 * direction that matters — it would promise a shape. Wiring
 * `catalog.ts#SlotLayoutRule` needs its signature widened to the instance's whole
 * fill map (`builder/canvas/fixture.ts#FIXTURE_CELL` measures why), which is a
 * row of its own. See {@link templateGhost}.
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
 * *as B2's rule places them*, and that rule does not reach the canvas yet; see
 * {@link MARKER_EXTENT}. Not turned by `rotation` either, and that is deliberate rather
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
): SurfaceEdit {
  if (template === null) {
    return { kind: 'none', message: 'No template is armed. Choose one in the palette first.' }
  }
  const ghost = templateGhost(template, rotation, at, step)
  const placed = `Placed ${ghost.name} at ${describeCell(ghost.anchor[0], ghost.anchor[1])}`
  return {
    kind: 'place',
    template,
    anchor: ghost.anchor,
    rotation: ghost.rotation,
    fills: fill?.fills ?? {},
    message:
      fill === undefined
        ? `${placed} with no parts chosen yet. Fill its slots to give it something to draw.`
        : `${placed}: ${describePlacementFill(fill)}`,
  }
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
