/**
 * What a gesture on the 3D surface *means* — resolved as a value, before
 * anything is written.
 *
 * `PlanCanvas.tsx` computes the same four verdicts inside four `useCallback`s
 * and writes to the store from inside them, which is why nothing in this project
 * has ever been able to test "clicking there places that": the decision and the
 * side effect are the same statement. This module separates them. Every function
 * here is pure — a scene in, a {@link SurfaceEdit} out — and the component's job
 * shrinks to reading the verdict, making one store call, and saying the
 * `message`.
 *
 * That matters more here than it did in 2D, because jsdom has no WebGL context:
 * **no test in this repo can mount the 3D surface.** The verdicts can still be
 * proven exactly, and they are the substance of the row.
 *
 * ## Nothing here constructs a `Placement`
 *
 * Row **V4** is changing what a placement *is* — from a `TileId` to a design
 * resolved per lock — and its files include `src/store/schema.ts`,
 * `canvas/{scene,move,ghost}.ts` and the share codec. So a `place` edit carries
 * the **record, the anchor and the angle**, not a placement object, and the one
 * line that turns those into a store write lives in `RoomSurface.tsx`. Nothing
 * in this row reads `placement.tileId`, `placement.x` or `placement.z` off a
 * store record: coordinates come from `ScenePiece.placement` through the pure
 * API `move.ts` already exposes, and identity comes from `CatalogRecord.id`.
 * V4's change is therefore invisible to this file.
 *
 * ## The refusals are the plan view's, unchanged
 *
 * Every one of them comes out of `ghost.ts` or `move.ts` and is re-worded, never
 * re-decided: a `none` footprint cannot be placed, an identical tile at
 * identical coordinates and an identical angle is refused (it would be invisible
 * on the plan and would double a line in the bill), and an overlap **informs and
 * commits** — `overlap.ts` is emphatic about that, and the reason applies twice
 * over in 3D, where a sector's convex parts are an outward bound and can report
 * a contact the meshes do not have.
 */
import type { MoveDrag, MovePreview, PlanGhost, PlanPoint, PlanScene, PlanTool, ScenePiece, SnapMode } from '@/builder/canvas'
import {
  beginMove,
  computeGhost,
  describeCancel,
  describeCell,
  describeDrop,
  describeGrab,
  describeMoveHint,
  formatUnits,
  nextRotation,
  pieceAt,
  pieceName,
  pieceRotationStep,
  previewMove,
  rotationStepFor,
  scenePaintOrder,
} from '@/builder/canvas'
import type { CatalogRecord } from '@/catalog'
import type { PlacementId } from '@/store'

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
      /** The armed tile. The caller turns this into the store's placement shape. */
      readonly record: CatalogRecord
      /** Minimum corner, snapped. The ghost's own anchor, not a second derivation. */
      readonly anchor: PlanPoint
      readonly rotation: number
      /** Whether the placement lands on a piece already there. Committed anyway. */
      readonly conflict: boolean
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
 * What a click at `at` would place, or why it would not.
 *
 * The ghost is computed here rather than taken as an argument, and that is the
 * same guarantee `ghost.ts` was built for: the outline the user saw and the
 * anchor that reaches the store come out of **one** call to `computeGhost`, so
 * they cannot be half a unit apart. The component draws its ghost from the same
 * function on the same cursor, so the two agree by construction rather than by
 * both being careful.
 */
export function planPlacement(
  scene: PlanScene,
  record: CatalogRecord | undefined,
  rotation: number,
  at: PlanPoint,
  step: number,
): SurfaceEdit {
  if (record === undefined) {
    return { kind: 'none', message: 'No tile is armed. Choose one in the palette first.' }
  }
  const ghost = computeGhost(record, rotation, at, step, scene)
  if (ghost.refusal !== null) return { kind: 'none', message: ghost.refusal.message }
  if (ghost.duplicate) {
    return {
      kind: 'none',
      message: `${record.name} is already placed at ${describeCell(ghost.anchor[0], ghost.anchor[1])}.`,
    }
  }
  const conflict = ghost.conflict ? ', overlapping a piece already there' : ''
  // The caveat is announced on the act and not only carried on the piece: 462 of
  // the 1,199 curves rest on a band rule with no accepted mesh fit behind it, and
  // in 3D there is no hatch pattern to carry that — a fill is all there is. So the
  // sentence is the only disclosure, which makes it load-bearing rather than
  // polite.
  const caveat = ghost.caveat === null ? '' : ` ${ghost.caveat.message}`
  return {
    kind: 'place',
    record,
    anchor: ghost.anchor,
    rotation: ghost.rotation,
    conflict: ghost.conflict,
    message: `Placed ${record.name} at ${describeCell(ghost.anchor[0], ghost.anchor[1])}${conflict}.${caveat}`,
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
 * The precedence is `PlanCanvas`'s and each step of it is a behaviour somebody
 * would otherwise lose. A piece being carried outranks the cursor because `R`
 * mid-move must turn what is held. The sticky target outranks the cursor because
 * turning a 2 × 0.5 wall by 60° moves it out from under the point that was
 * clicked, and the second press would otherwise silently start turning the
 * *ghost* instead.
 *
 * The step is the tile's own — `pieceRotationStep` for a placed piece,
 * `rotationStepFor` for the armed one. 893 tiles carry an angle that is not a
 * multiple of 90, and on all 1,199 curves the step *equals the sweep*, which is
 * what makes one press land a curve beside its predecessor.
 */
export function planTurn(
  scene: PlanScene,
  sticky: PlacementId | null,
  under: ScenePiece | undefined,
  armed: CatalogRecord | undefined,
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
  if (armed === undefined) {
    return { kind: 'none', message: 'Nothing to turn. Arm a tile or put the pointer on a placed one.' }
  }
  const step = rotationStepFor(armed)
  return {
    kind: 'arm',
    step,
    direction,
    message: `${armed.name} will be placed at ${formatUnits(nextRotation(armedRotation, step, direction))} degrees.`,
  }
}

/* --------------------------------------------------------------------- readout */

/**
 * What the surface knows that its surroundings show.
 *
 * Structurally `PlanStatus`, deliberately and by field-for-field intent, so
 * `PlanToolbar` and `BuilderScreen`'s two corner plates take it with no change
 * at all: the toolbar's `Rotate` step, its conflict count and its `moving` tail
 * are the same four facts whichever renderer produced them. It is declared here
 * rather than imported because `PlanStatus` lives in `PlanCanvas.tsx`, which row
 * **R4** deletes — so the type that outlives that deletion has to be on this
 * side of the line.
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
  readonly armed: CatalogRecord | undefined
  readonly ghost: PlanGhost | null
  readonly under: ScenePiece | undefined
  readonly moving: MovePreview | undefined
  /** `false` while the pointer is off the plan — orbited past the horizon, or outside. */
  readonly onPlan: boolean
  /** Pieces placed whose mesh has not arrived. Named because it changes what is drawn. */
  readonly waiting: number
}

/**
 * The contextual line, §2.4's bottom-left, in the 3D surface's own vocabulary.
 *
 * The precedence is `PlanCanvas`'s `buildHint` and the wording is not: this
 * surface's primary gesture is **click**, its drag is the orbit, and it has no
 * drag-paint to describe. The one thing that is genuinely new is `waiting` — a
 * placed tile whose mesh has not arrived is drawn as a marker rather than as
 * itself, and a user looking at a plate where a tile should be needs the surface
 * to say which of the two it is looking at.
 */
export function describeSurfaceHint(input: SurfaceHintInput): string {
  const { tool, armed, ghost, under, moving, onPlan, waiting } = input

  // A piece in the air outranks everything, including a refusal about the armed
  // tile: nothing else on screen is what the user is doing.
  if (moving !== undefined) return describeMoveHint(moving)
  if (!onPlan) return 'Drag to orbit. Point at the plan to place or remove a tile.'

  if (tool === 'move') {
    return under === undefined
      ? 'Move: drag a tile to reposition it. Drag anywhere else to orbit.'
      : `Move: drag ${pieceName(under)} to reposition it.`
  }
  if (tool === 'erase') {
    return under === undefined ? 'Erase: click a tile to remove it.' : `Erase: click to remove ${pieceName(under)}.`
  }
  if (armed === undefined) return 'Choose a tile in the palette, then click the plan to place it.'
  if (ghost !== null && ghost.refusal !== null) return ghost.refusal.message
  if (ghost?.duplicate === true) return `${armed.name} is already here — move the pointer to place another.`
  if (ghost?.conflict === true) {
    return `Overlaps a piece already placed. R turns by ${formatUnits(rotationStepFor(armed))}°.`
  }
  if (ghost?.caveat != null) {
    return `${ghost.caveat.message} R turns by ${formatUnits(rotationStepFor(armed))}°.`
  }
  // Below every problem, and above the plain case: a marker where a tile should
  // be is not an error, and it must not be silent either.
  if (waiting > 0) {
    return (
      `${String(waiting)} placed ${waiting === 1 ? 'tile has' : 'tiles have'} no mesh yet and ` +
      `${waiting === 1 ? 'is' : 'are'} drawn as a marked outline. Click to place ${armed.name}.`
    )
  }
  return `Click to place ${armed.name}. R turns by ${formatUnits(rotationStepFor(armed))}°.`
}

/** The `<canvas>`'s accessible label — a summary, not an inventory. */
export function describeSurface(scene: PlanScene, waiting: number): string {
  const placed = scene.pieces.length + scene.generated.length
  if (placed === 0) {
    return 'An empty plan in 3D. Drag to orbit; click to place the armed tile.'
  }
  const conflict = scene.conflicts.size === 0 ? '' : `, ${String(scene.conflicts.size)} overlapping`
  const pending = waiting === 0 ? '' : `, ${String(waiting)} awaiting a mesh`
  return `${String(placed)} placed ${placed === 1 ? 'tile' : 'tiles'} in 3D${conflict}${pending}. Drag to orbit; click to place or remove.`
}
