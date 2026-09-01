/**
 * The ghost: what the armed tile will look like where the cursor is, before the
 * user commits to it.
 *
 * Pure, so the preview and the placement cannot disagree — the same function
 * produces the rectangle the user sees and the anchor that goes into the store.
 * A canvas that computed the preview in the renderer and the placement in the
 * click handler is how a ghost ends up half a unit from where the tile lands.
 *
 * It reports four things beyond the geometry, and each of them is a thing the
 * user should know *before* clicking:
 *
 *   - **`refusal`** — an `arc` or `none` footprint. There is nothing to draw, so
 *     the ghost becomes a hatched one-unit marker with a cross rather than
 *     disappearing: a palette selection that produces no ghost and no message is
 *     indistinguishable from a broken canvas.
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

import type { Extent, PlanBox, PlanPoint, Refusal } from './geometry'
import { anchorFor, footprintExtent, isAxisAligned, placementRefusal, planBox, planQuad, snapTo } from './geometry'
import type { OverlapSubject, PlanBand } from './overlap'
import { planBand, subjectsConflict } from './overlap'
import type { PlanPiece, PlanScene } from './scene'

/** The footprint of the refusal marker, in grid units. One cell, so it reads as a tile. */
const REFUSAL_EXTENT: Extent = { w: 1, d: 1 }

export interface PlanGhost {
  readonly record: CatalogRecord
  /** The tile's own extent, or the marker's extent when refused. */
  readonly extent: Extent
  readonly rotation: number
  /** Minimum corner, snapped. This is what `placeTile` receives. */
  readonly anchor: PlanPoint
  readonly box: PlanBox
  readonly quad: readonly PlanPoint[]
  readonly band: PlanBand
  readonly refusal: Refusal | null
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
      piece.placement.tileId === record.id &&
      piece.placement.rotation === rotation &&
      Math.abs(piece.placement.x - anchor[0]) < SAME_PLACE_EPS &&
      Math.abs(piece.placement.z - anchor[1]) < SAME_PLACE_EPS,
  )
}

/**
 * The ghost as an overlap subject, so the prediction runs through exactly the
 * predicate the scene's conflict pass runs through — corner exemption included.
 */
function subjectOf(ghost: Pick<PlanGhost, 'band' | 'box' | 'quad' | 'rotation'>): OverlapSubject {
  return { band: ghost.band, box: ghost.box, quad: ghost.quad, axisAligned: isAxisAligned(ghost.rotation) }
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
  const extent = footprintExtent(record.foot) ?? REFUSAL_EXTENT

  if (refusal !== null) {
    // No real extent, so the marker is placed on the lattice directly rather
    // than through `anchorFor` — there is no piece to centre on the cursor.
    const anchor: PlanPoint = [snapTo(cursor[0] - 0.5, step), snapTo(cursor[1] - 0.5, step)]
    const box = planBox(extent, 0, anchor[0], anchor[1])
    return {
      record,
      extent,
      rotation: 0,
      anchor,
      box,
      quad: planQuad(extent, 0, anchor[0], anchor[1]),
      band: 'area',
      refusal,
      conflict: false,
      duplicate: false,
      placeable: false,
    }
  }

  const anchor = anchorFor(extent, rotation, cursor[0], cursor[1], step)
  const box = planBox(extent, rotation, anchor[0], anchor[1])
  const quad = planQuad(extent, rotation, anchor[0], anchor[1])
  const band = planBand(record)
  const duplicate = isDuplicate(scene, record, anchor, rotation)

  return {
    record,
    extent,
    rotation,
    anchor,
    box,
    quad,
    band,
    refusal: null,
    conflict: scene.pieces.some((piece) => subjectsConflict(piece, subjectOf({ band, box, quad, rotation }))),
    duplicate,
    placeable: !duplicate,
  }
}

/** The pieces the ghost is in conflict with. For the readout. */
export function ghostOverlaps(scene: PlanScene, ghost: PlanGhost): readonly PlanPiece[] {
  return scene.pieces.filter((piece) => subjectsConflict(piece, subjectOf(ghost)))
}
