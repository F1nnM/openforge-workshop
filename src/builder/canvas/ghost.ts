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
import { sceneSubjects } from './scene'

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
  /** Whether {@link band} was measured from the footprint. See `overlap.ts#BandVerdict`. */
  readonly bandMeasured: boolean
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

/**
 * Whether this exact file is already drawn at this exact corner and angle.
 *
 * **Compared against parts, not against placements, and that is row A1's whole
 * effect on this rule.** The question the refusal exists for has not changed —
 * two identical outlines in the same place are invisible on the plan and double
 * a line in the bill — but the thing that can *be* in a place is now a part of a
 * template rather than a placement of a tile, so the comparison has to be one
 * level down. A ghost of `Cut stone wall 2` dropped exactly where a template's
 * `right wall` already puts that same file is the same invisible double it always
 * was, and comparing placements would have missed every one of them.
 *
 * The identity is the **file** and not the item, because a part's fill names a
 * file (decision **D1**) and there is no aggregate left to hoist it to. Under V4
 * the two agreed anyway — two placements of one design under one preference
 * resolved to the same file — so this is not a change of behaviour, only of what
 * there is to compare.
 *
 * The angle compared is the part's **drawn** angle, which is what the ghost's own
 * `angle` is: it folds in the footprint's intrinsic 45° on a `diag` and the
 * recipe's own yaw on a slot, and comparing against the *instance's* rotation
 * would call a wall turned by its slot rule a twin of one that is not.
 */
function isDuplicate(scene: PlanScene, record: CatalogRecord, anchor: PlanPoint, angle: number): boolean {
  return scene.pieces.some((piece) =>
    piece.parts.some(
      (part) =>
        part.record.id === record.id &&
        part.angle === angle &&
        Math.abs(part.box.x - anchor[0]) < SAME_PLACE_EPS &&
        Math.abs(part.box.z - anchor[1]) < SAME_PLACE_EPS,
    ),
  )
}

/**
 * The ghost as an overlap subject, so the prediction runs through exactly the
 * predicate the scene's conflict pass runs through — corner exemption included.
 */
/**
 * The ghost as the collision test sees it.
 *
 * **`level: null`, and that is the honest answer rather than a gap.** A level is
 * `SlotLayout.elevationMm` for the slot a part fills, and a ghost fills no slot:
 * `usePlanTools` arms a `TileId`, this module takes a bare `CatalogRecord`, and
 * the family a placement of one would belong to is the gap rows A8 and B4 left
 * open on purpose (`BuilderScreen.tsx` sets out why there is nothing honest to
 * pass as the template). So there is no rule to ask for a lift. `overlap.ts`
 * reads `null` as *every* level, which keeps the prediction on the
 * over-reporting side of the error — a ghost that hatched where the scene then
 * did not would be the worse failure.
 */
function subjectOf(
  ghost: Pick<PlanGhost, 'band' | 'bandMeasured' | 'box' | 'parts' | 'axisAligned' | 'shape'>,
): OverlapSubject {
  return {
    band: ghost.band,
    bandMeasured: ghost.bandMeasured,
    level: null,
    box: ghost.box,
    parts: ghost.parts,
    axisAligned: ghost.axisAligned,
    cover: ghost.shape.cover,
  }
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
      // A refused ghost has no footprint to measure a band from, so the `area`
      // above is the module's conservative default rather than a fact. Saying so
      // keeps anything downstream from refusing a placement on the strength of
      // a marker that stands for a piece with no outline.
      bandMeasured: false,
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
  const duplicate = isDuplicate(scene, record, anchor, geometry.angle)
  // See `subjectOf` for the `null` level: a ghost fills no slot, so no layout
  // rule can lift it and it is tested against every level.
  const subject: OverlapSubject = {
    band: band.band,
    bandMeasured: band.measured,
    level: null,
    box: geometry.box,
    parts: geometry.parts,
    axisAligned: geometry.axisAligned,
    cover: resolved.cover,
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
    band: band.band,
    bandMeasured: band.measured,
    refusal: null,
    caveat: placementCaveat(record) ?? null,
    conflict: sceneSubjects(scene).some((candidate) => subjectsConflict(candidate, subject) !== null),
    duplicate,
    placeable: !duplicate,
  }
}

/**
 * The pieces the ghost is in conflict with. For the readout.
 *
 * Resolved through {@link sceneSubjects} and back, rather than by testing pieces:
 * a piece has N parts and no single band or outline, so the test runs per part
 * and the answer is de-duplicated to the *pieces* they belong to — which is what
 * a readout counts, because "overlapping 3 pieces" is what the user can see and
 * "overlapping 7 parts" is not.
 *
 * The generated population is deliberately absent, as it was before row A1: this
 * returns {@link PlanPiece}, the readout it feeds names catalog pieces, and
 * `move.ts` is the surface that speaks about both.
 */
export function ghostOverlaps(scene: PlanScene, ghost: PlanGhost): readonly PlanPiece[] {
  const subject = subjectOf(ghost)
  const hit = new Set(
    sceneSubjects(scene)
      .filter((candidate) => subjectsConflict(candidate, subject) !== null)
      .map((candidate) => candidate.id),
  )
  return scene.pieces.filter((piece) => hit.has(piece.id))
}
