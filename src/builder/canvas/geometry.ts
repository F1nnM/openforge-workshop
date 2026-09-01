/**
 * Plan-view geometry — snapping, oriented extents, rotation steps, and the
 * refusal rule. Pure functions over `Footprint`; no React, no DOM, no store.
 *
 * ## What a placement means geometrically
 *
 * A `Placement` carries `x`, `z` and `rotation` and nothing else — the footprint
 * lives on the `CatalogRecord` (`src/store/schema.ts` is explicit that copying it
 * into the placement would desynchronise on the next import). So every function
 * here takes the footprint separately, and the pair (placement, footprint) is
 * what has a box.
 *
 * **`x`/`z` are the box's minimum corner, not its centre**, and the choice is
 * forced by two independent constraints:
 *
 *   1. **The 0.5 lattice.** §7 snaps to 0.5 units because every dimension in the
 *      catalog is a multiple of 0.5. A wall's short axis is
 *      {@link WALL_THICKNESS_UNITS} = 0.5, so a wall's *centre* sits a quarter
 *      unit off the cell edge — 0.25 is unreachable on a 0.5 snap, and a
 *      centre-anchored wall could therefore never be flush with a floor tile.
 *      Anchoring the corner puts every face of every piece on the lattice for
 *      any extent, which is exactly the condition for two tiles to abut.
 *   2. **The share codec's quantum.** `src/share/payload.ts` stores coordinates
 *      as `x · 2` — half grid units — and falls back to eight bytes per
 *      coordinate the moment a value is not representable. Corner anchoring
 *      keeps every coordinate a multiple of 0.5 and so keeps the compact
 *      encoding; centre anchoring would spend f64s on quarter units.
 *
 * The same argument settles rotation. Rotating about the box centre and
 * re-deriving the corner shifts it by `(w − d) / 2`, which for a 2-unit wall is
 * 0.75 — a multiple of 0.25, not of 0.5. So **rotation preserves the anchor
 * corner** and the extents swap around it: a 2 × 0.5 wall lying along the north
 * edge of a cell becomes a 0.5 × 2 wall lying along its west edge. That is both
 * lattice-safe and what a plan editor reads as "turn this piece".
 *
 * ## Only two footprints are placeable, and refusal is visible
 *
 * `rect` (3,051 tiles, 35.1%) and `wall` (3,116, 35.8%) — **70.9%** of the 8,702
 * live tiles. `arc` (16.0%) is v1.1 and `none` (13.1%) is never placeable, and
 * both must be *refused with a reason* rather than approximated: `src/catalog/
 * schema.ts` records that the size tags diverge from the mesh on curves by a
 * median 96 mm, so drawing an arc as its bounding rectangle would be wrong by
 * nearly four grid units rather than slightly wrong.
 */
import type { CatalogRecord, Footprint } from '@/catalog'
import { DEFAULT_ROTATION_STEP_DEG, GRID_UNIT_MM, WALL_THICKNESS_UNITS } from '@/catalog'
import { normalizeRotation } from '@/store'

/* ---------------------------------------------------------------- snap modes */

/**
 * The two snap steps, and **there is deliberately no 0.25**.
 *
 * §7: every dimension in the catalog is a multiple of 0.5 units, so a
 * quarter-unit grid can only ever produce placements that cannot physically
 * assemble. The mock offered it; the plan removed it. This map is the only place
 * a step is written down, so a third mode cannot be added by accident in one
 * component.
 */
export const SNAP_STEP = Object.freeze({ fine: 0.5, coarse: 1 })

/** Which snap step is in force. `fine` is the default; `coarse` is the alignment aid. */
export type SnapMode = keyof typeof SNAP_STEP

/** In display order, for the toolbar's toggle. */
export const SNAP_MODES: readonly SnapMode[] = ['fine', 'coarse']

/**
 * Round to the nearest multiple of `step`.
 *
 * Both steps are binary-exact (0.5, 1) so the arithmetic is exact and no epsilon
 * is needed. `+ 0` normalises `-0`, which `Math.round(-0.2) * 0.5` really does
 * produce: `-0` survives in memory but not through `JSON.stringify`, so a scene
 * holding one would not compare equal to itself after an export and re-import.
 * The store's coordinate schema does the same thing for the same reason.
 */
export function snapTo(value: number, step: number): number {
  return Math.round(value / step) * step + 0
}

/** Millimetres for a length in grid units — for the readouts, not the maths. */
export function unitsToMm(units: number): number {
  return units * GRID_UNIT_MM
}

/* -------------------------------------------------------------------- extent */

/** An axis-aligned size in grid units. */
export interface Extent {
  readonly w: number
  readonly d: number
}

/** A box in grid units, `x`/`z` being its minimum corner. */
export interface PlanBox {
  readonly x: number
  readonly z: number
  readonly w: number
  readonly d: number
}

/**
 * The un-rotated extent of a footprint, or `undefined` when there is none to
 * draw.
 *
 * `wall` has no depth field on purpose — `src/catalog/schema.ts` notes that the
 * depth is not in the data for any of those 3,116 tiles, it *is* the measured
 * 12.7 mm — so the constant is read here rather than guessed by an importer.
 */
export function footprintExtent(foot: Footprint): Extent | undefined {
  switch (foot.shape) {
    case 'rect':
      return { w: foot.w, d: foot.d }
    case 'wall':
      return { w: foot.length, d: WALL_THICKNESS_UNITS }
    case 'arc':
    case 'none':
      return undefined
  }
}

/** Whether an angle is an odd quarter turn — the case where w and d swap. */
export function isQuarterTurn(rotation: number): boolean {
  const folded = ((rotation % 180) + 180) % 180
  return Math.abs(folded - 90) < 1e-9
}

/** Whether an angle is a whole number of quarter turns, exactly. */
export function isAxisAligned(rotation: number): boolean {
  const folded = ((rotation % 90) + 90) % 90
  return folded < 1e-9 || Math.abs(folded - 90) < 1e-9
}

/**
 * The axis-aligned extent a piece occupies once turned.
 *
 * Quarter turns are computed by swapping rather than by trigonometry, so a 90°
 * rotation of a 2 × 0.5 wall is exactly 0.5 × 2 and stays on the lattice —
 * `Math.cos(Math.PI / 2)` is 6.1e-17, and a 6.1e-17 offset is precisely the kind
 * of value that makes two tiles look flush and fail an equality test.
 *
 * The 893 tiles whose `size|angle` is not a multiple of 90 fall through to the
 * bounding box of the turned rectangle, which is honest: the *piece* is drawn
 * turned (see {@link planQuad}), and this box is what the view has to reserve
 * for it.
 */
export function rotatedExtent(extent: Extent, rotation: number): Extent {
  if (isAxisAligned(rotation)) {
    return isQuarterTurn(rotation) ? { w: extent.d, d: extent.w } : { w: extent.w, d: extent.d }
  }
  const radians = (rotation * Math.PI) / 180
  const cos = Math.abs(Math.cos(radians))
  const sin = Math.abs(Math.sin(radians))
  return { w: extent.w * cos + extent.d * sin, d: extent.w * sin + extent.d * cos }
}

/** The box a piece occupies, anchored at its minimum corner. */
export function planBox(extent: Extent, rotation: number, x: number, z: number): PlanBox {
  const turned = rotatedExtent(extent, rotation)
  return { x, z, w: turned.w, d: turned.d }
}

/** A box's centre. */
export function boxCentre(box: PlanBox): { readonly x: number; readonly z: number } {
  return { x: box.x + box.w / 2, z: box.z + box.d / 2 }
}

/** A point in grid units. */
export type PlanPoint = readonly [x: number, z: number]

/**
 * The four corners of the piece itself — the turned rectangle, not its bounding
 * box.
 *
 * Used for hit testing and for overlap: a 45° tile's bounding box is 41% larger
 * than the tile, and treating that box as the tile would report an overlap with
 * a neighbour the piece does not touch.
 */
export function planQuad(extent: Extent, rotation: number, x: number, z: number): readonly PlanPoint[] {
  const box = planBox(extent, rotation, x, z)
  const centre = boxCentre(box)
  const radians = (rotation * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const halfW = extent.w / 2
  const halfD = extent.d / 2
  const corners: readonly PlanPoint[] = [
    [-halfW, -halfD],
    [halfW, -halfD],
    [halfW, halfD],
    [-halfW, halfD],
  ]
  return corners.map(([cx, cz]): PlanPoint => [centre.x + cx * cos - cz * sin, centre.z + cx * sin + cz * cos])
}

/** Whether a point is inside a convex polygon, boundary included. */
export function quadContains(quad: readonly PlanPoint[], point: PlanPoint): boolean {
  let sign = 0
  for (let i = 0; i < quad.length; i += 1) {
    const [ax, az] = quad[i] as PlanPoint
    const [bx, bz] = quad[(i + 1) % quad.length] as PlanPoint
    const cross = (bx - ax) * (point[1] - az) - (bz - az) * (point[0] - ax)
    if (Math.abs(cross) < 1e-9) continue
    const next = cross > 0 ? 1 : -1
    if (sign === 0) sign = next
    else if (sign !== next) return false
  }
  return true
}

/* ------------------------------------------------------------------ anchoring */

/**
 * The snapped anchor for a piece the user is pointing the *centre* of at
 * (`x`, `z`).
 *
 * Pointing at the centre is what makes the ghost feel attached to the cursor;
 * snapping the resulting *corner* is what keeps the piece on the lattice. Doing
 * it the other way round — snapping the cursor and then subtracting half the
 * extent — puts a 1 × 1 tile's faces on the half-unit lattice but a 2 × 0.5
 * wall's faces a quarter unit off it.
 */
export function anchorFor(extent: Extent, rotation: number, x: number, z: number, step: number): PlanPoint {
  const turned = rotatedExtent(extent, rotation)
  return [snapTo(x - turned.w / 2, step), snapTo(z - turned.d / 2, step)]
}

/* ------------------------------------------------------------------ rotation */

/**
 * This tile's rotation step, in degrees.
 *
 * `rotStep` is present on 1,548 tiles and **893 of them carry a value that is
 * not a multiple of 90** (45, 22.5, 11.25, 60, 120, 240, 300). Those tiles would
 * never tile on a 90° step, which is why the step is per-tile and why a global
 * constant here would be a bug rather than a simplification.
 */
export function rotationStepFor(record: Pick<CatalogRecord, 'rotStep'>): number {
  return record.rotStep ?? DEFAULT_ROTATION_STEP_DEG
}

/** The next angle, folded into `[0, 360)` by the store's own normaliser. */
export function nextRotation(rotation: number, step: number, direction: 1 | -1 = 1): number {
  return normalizeRotation(rotation + step * direction)
}

/* ------------------------------------------------------------------- refusal */

/** Why a tile cannot be placed. Both cases are permanent for v1. */
export type RefusalCode = 'arc' | 'no-footprint'

export interface Refusal {
  readonly code: RefusalCode
  /** Shown to the user, and read out by the canvas's live region. */
  readonly message: string
}

/**
 * Whether this tile can be drawn in plan, and why not when it cannot.
 *
 * The canvas draws a refused tile as a hatched marker with a cross rather than
 * silently doing nothing, because a palette selection that produces no ghost and
 * no error is indistinguishable from a broken canvas.
 *
 * Note the deliberate difference from `src/assembly/resolve.ts`, which never
 * refuses a placement: that module is about *compatibility*, where §7's rule is
 * that compatibility informs and never refuses. This is about *drawability*, and
 * there is nothing to draw.
 */
export function placementRefusal(record: Pick<CatalogRecord, 'foot' | 'name'>): Refusal | undefined {
  switch (record.foot.shape) {
    case 'rect':
    case 'wall':
      return undefined
    case 'arc':
      return {
        code: 'arc',
        message: `${record.name} is a curved piece; arc footprints arrive in v1.1 and cannot be placed yet.`,
      }
    case 'none':
      return {
        code: 'no-footprint',
        message: `${record.name} has no derivable footprint, so it cannot be drawn in plan view.`,
      }
  }
}

/** Whether the palette should offer this tile for placement. */
export function isPlaceable(record: Pick<CatalogRecord, 'foot'>): boolean {
  return record.foot.shape === 'rect' || record.foot.shape === 'wall'
}

/* ------------------------------------------------------------------ readouts */

/** A coordinate as the readouts and announcements spell it: at most two decimals, no trailing zeros. */
export function formatUnits(value: number): string {
  return String(Math.round(value * 100) / 100)
}

/** "x 3.5, z 2" — the grid position, for the mono readout and the live region. */
export function describeCell(x: number, z: number): string {
  return `x ${formatUnits(x)}, z ${formatUnits(z)}`
}

/** "2 × 0.5 units" — an extent, for a placement's accessible name. */
export function describeExtent(extent: Extent): string {
  return `${formatUnits(extent.w)} × ${formatUnits(extent.d)} units`
}
