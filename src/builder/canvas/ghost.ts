/**
 * The ghost: what the armed tile will look like where the cursor is, before the
 * user commits to it.
 *
 * Pure, so the preview and the placement cannot disagree — the same function
 * produces the rectangle the user sees and the anchor that goes into the store.
 * A canvas that computed the preview in the renderer and the placement in the
 * click handler is how a ghost ends up half a unit from where the tile lands.
 *
 * It reports five things beyond the geometry, and each of them is a thing the
 * user should know *before* clicking:
 *
 *   - **`refusal`** — a `none` footprint, the one case of seven with nothing to
 *     draw. The ghost becomes a hatched one-unit marker with a cross rather than
 *     disappearing: a palette selection that produces no ghost and no message is
 *     indistinguishable from a broken canvas.
 *   - **`caveat`** — the piece *can* be drawn but its outline rests on a band
 *     rule with no mesh fit behind it (462 of the 1,199 curves). Shown and
 *     placeable; `geometry.ts`'s `placementCaveat` sets out why disclosing beats
 *     refusing.
 *   - **`conflict`** — the placement would land on another piece in the same
 *     band. Shown, not blocked; see `overlap.ts`.
 *   - **`duplicate`** — the identical placement is already there. This one *is*
 *     blocked, and it is the only place the canvas refuses a physically valid
 *     act: two identical tiles at the same coordinates are invisible on the plan
 *     and would silently double a line in the bill of tiles, so the user would
 *     print two floors and only ever see one. It is also what makes drag-paint
 *     safe, since a drag crosses the same cell many times.
 *   - **`covers`** — the piece already under the cursor, for the readout.
 */
import type { CatalogRecord } from '@/catalog'

import type { Extent, PlanBox, PlanCaveat, PlanPart, PlanPoint, PlanShape, Refusal } from './geometry'
import {
  anchorForShape,
  footprintShape,
  placementCaveat,
  placementRefusal,
  planGeometry,
  snapTo,
} from './geometry'
import type { OverlapSubject, PlanBand } from './overlap'
import { planBand, subjectsConflict } from './overlap'
import type { PlanPiece, PlanScene } from './scene'

/**
 * The shape of the refusal marker: one cell, so it reads as a tile.
 *
 * A `PlanShape` rather than a bare extent, because the marker then goes through
 * exactly the same `planGeometry` call the real pieces do and the branch below
 * has no second geometry path to drift from.
 */
const REFUSAL_SHAPE: PlanShape = {
  shape: 'none',
  extent: { w: 1, d: 1 },
  angle: 0,
  parts: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
  ],
  cover: 'exact',
  slack: 0,
  outline: 'M 0 0 H 1 V 1 H 0 Z',
}

export interface PlanGhost {
  readonly record: CatalogRecord
  /** The tile's resolved shape, or the marker's when refused. */
  readonly shape: PlanShape
  /** The tile's own extent, or the marker's extent when refused. */
  readonly extent: Extent
  readonly rotation: number
  /** `rotation + shape.angle` — the angle drawn. Differs only for `diag`. */
  readonly angle: number
  /** Minimum corner, snapped. This is what `placeTile` receives. */
  readonly anchor: PlanPoint
  readonly box: PlanBox
  readonly parts: readonly PlanPart[]
  /** Whether the drawn box is the shape. Read by the corner-junction exemption. */
  readonly axisAligned: boolean
  readonly band: PlanBand
  readonly refusal: Refusal | null
  /** Set when the outline rests on an unmeasured band rule. Does not block placement. */
  readonly caveat: PlanCaveat | null
  readonly conflict: boolean
  readonly duplicate: boolean
  /** Whether committing this ghost would change the scene. */
  readonly placeable: boolean
}

/** Tolerance for "the same coordinate", in grid units — a tenth of the finest snap. */
const SAME_PLACE_EPS = 0.05

function isDuplicate(scene: PlanScene, record: CatalogRecord, anchor: PlanPoint, rotation: number): boolean {
  return scene.pieces.some(
    (piece) =>
      // The **item**, since row V4 — and `record` is a variant of the armed
      // item, so `record.design` is that item. Comparing files would have gone
      // wrong in exactly one direction the day a placement stopped naming one:
      // two placements of one design under one preference resolve to the same
      // file anyway, so the test is unchanged in behaviour and now says what it
      // means.
      piece.placement.design === record.design &&
      piece.placement.rotation === rotation &&
      Math.abs(piece.placement.x - anchor[0]) < SAME_PLACE_EPS &&
      Math.abs(piece.placement.z - anchor[1]) < SAME_PLACE_EPS,
  )
}

/**
 * The ghost as an overlap subject, so the prediction runs through exactly the
 * predicate the scene's conflict pass runs through — corner exemption included.
 */
function subjectOf(ghost: Pick<PlanGhost, 'band' | 'box' | 'parts' | 'axisAligned'>): OverlapSubject {
  return { band: ghost.band, box: ghost.box, parts: ghost.parts, axisAligned: ghost.axisAligned }
}

/**
 * The ghost for `record` at world point `cursor`, snapped to `step`.
 *
 * `cursor` is the point the piece is *centred on*, which is what makes the ghost
 * feel attached to the pointer; the corner it snaps to is derived. See
 * `geometry.ts` for why the corner is the anchor and not the centre.
 */
export function computeGhost(
  record: CatalogRecord,
  rotation: number,
  cursor: PlanPoint,
  step: number,
  scene: PlanScene,
): PlanGhost {
  const refusal = placementRefusal(record) ?? null
  const resolved = footprintShape(record.foot)

  if (refusal !== null || resolved === undefined) {
    // No real extent, so the marker is placed on the lattice directly rather
    // than through `anchorForShape` — there is no piece to centre on the cursor.
    const anchor: PlanPoint = [snapTo(cursor[0] - 0.5, step), snapTo(cursor[1] - 0.5, step)]
    const geometry = planGeometry(REFUSAL_SHAPE, 0, anchor[0], anchor[1])
    return {
      record,
      shape: REFUSAL_SHAPE,
      extent: REFUSAL_SHAPE.extent,
      rotation: 0,
      angle: 0,
      anchor,
      box: geometry.box,
      parts: geometry.parts,
      axisAligned: true,
      band: 'area',
      refusal,
      caveat: null,
      conflict: false,
      duplicate: false,
      placeable: false,
    }
  }

  const anchor = anchorForShape(resolved, rotation, cursor[0], cursor[1], step)
  const geometry = planGeometry(resolved, rotation, anchor[0], anchor[1])
  const band = planBand(record)
  const duplicate = isDuplicate(scene, record, anchor, rotation)
  const subject: OverlapSubject = {
    band,
    box: geometry.box,
    parts: geometry.parts,
    axisAligned: geometry.axisAligned,
  }

  return {
    record,
    shape: resolved,
    extent: resolved.extent,
    rotation,
    angle: geometry.angle,
    anchor,
    box: geometry.box,
    parts: geometry.parts,
    axisAligned: geometry.axisAligned,
    band,
    refusal: null,
    caveat: placementCaveat(record) ?? null,
    conflict: scene.pieces.some((piece) => subjectsConflict(piece, subject)),
    duplicate,
    placeable: !duplicate,
  }
}

/** The pieces the ghost is in conflict with. For the readout. */
export function ghostOverlaps(scene: PlanScene, ghost: PlanGhost): readonly PlanPiece[] {
  return scene.pieces.filter((piece) => subjectsConflict(piece, subjectOf(ghost)))
}
