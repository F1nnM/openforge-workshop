/**
 * Overlap detection — and the reason a naive box test is wrong here.
 *
 * ## The problem with AABB overlap on a plan
 *
 * Two floors in the same square is a mistake the user should see. A wall lying
 * along the edge of a floor tile is **not** a mistake — it is how OpenForge is
 * built. 3,351 tiles carry `build|separate wall` (the wall stands beside the
 * tile) and 863 carry `build|wall on tile` (the wall stands *on* it), so in plan
 * a wall band and a floor square legitimately share the same square metre of
 * paper while occupying different heights. `y` is exactly the axis v1 does not
 * model, which is why the plan view cannot see the difference and has to be told
 * about it.
 *
 * A tile-versus-tile AABB test over a real room therefore reports a conflict on
 * every wall in it. Measured on the landing hero's chamber (`src/screens/landing/
 * plan.ts`, 12 floors, 8 walls, 6 fixtures): the walls abut the floors there, so
 * the naive test is quiet — but move any wall half a unit inwards, which the 0.5
 * snap invites and `build|wall on tile` requires, and it fires on all eight.
 *
 * ## What this module does instead
 *
 * Every placement is assigned a **band**, and overlap is only ever tested within
 * a band:
 *
 *   - `edge` — a wall. Occupies the boundary between squares and stands above the
 *     floor. Two walls in the same band position genuinely collide.
 *   - `area` — everything else: floors, bases, stairs, columns, thick walls that
 *     really do fill their square. Two of these in the same square collide.
 *
 * Cross-band pairs are never reported. That is the whole of the false-positive
 * fix, and it is a *model* of the height axis rather than a fudge: v1.1's 3D
 * renderer replaces the two bands with a real `y`, and this module goes away.
 *
 * ## Flag, not prevent
 *
 * A conflict is drawn and counted; the placement still happens. Three reasons:
 *
 *   1. §7 sets the precedent for the whole builder — "compatibility informs; it
 *      never refuses a placement" — and refusal is only used in this PR for
 *      something categorically different: a footprint with nothing to draw.
 *   2. The band assignment is a **heuristic over tag data**, and the tag data
 *      drifts (§16). A heuristic that warns and is occasionally wrong costs the
 *      user a glance; a heuristic that blocks and is occasionally wrong costs
 *      them a tile they cannot place and no way to find out why.
 *   3. Overlapping while arranging is normal. Users push a piece through its
 *      neighbours on the way to where it belongs.
 *
 * ## Two walls meeting at a corner are not a conflict either
 *
 * Perpendicular walls share the 0.5 × 0.5 square at the corner they meet in —
 * that is what a corner *is*, in plan, at a wall thickness of half a unit. The
 * landing hero's own chamber (`src/screens/landing/plan.ts`) has three such
 * junctions, so a rule without this exemption would light up the drawing the app
 * puts on its front door. The exemption is deliberately narrow: both pieces
 * axis-aligned, both long axes perpendicular, and the shared box no larger than
 * the wall thickness on either side. Two *parallel* walls overlapping by the
 * same half unit are still flagged, because that is a collinear overlap and there
 * is no corner piece that resolves it.
 *
 * ## Exact, not conservative
 *
 * The test is a box reject followed by a separating-axis test on the two turned
 * quadrilaterals. The box reject makes the common case one comparison; the SAT
 * pass means the 893 tiles with a non-90° rotation step are tested as the shapes
 * they are. A 45° 2 × 2 tile's bounding box is 41% larger than the tile, so a
 * box-only test would report a collision with a neighbour it visibly misses.
 */
import type { CatalogRecord } from '@/catalog'
import { WALL_THICKNESS_UNITS } from '@/catalog'
import type { PlacementId } from '@/store'

import type { PlanBox, PlanPoint } from './geometry'

/**
 * Which height band a piece occupies. See the module docblock — this is v1's
 * stand-in for the `y` axis, not a category of tile.
 */
export type PlanBand = 'area' | 'edge'

/** Kind buckets that mean "this piece fills its square", not "it lines an edge". */
const AREA_KINDS: readonly string[] = ['floor', 'base', 'stairs', 'riser']

/**
 * The band a tile occupies.
 *
 * Footprint first, kinds second, and in that order for a reason: the `wall`
 * footprint *is* the 0.5-unit thickness constant, so a tile that has one is by
 * construction an edge piece. The kind check then catches the thick-wall
 * variants — 591 tiles carry `build|thick wall` and many of those publish both a
 * `size|width` and a `size|depth`, so they arrive as `rect` and would otherwise
 * be filed as floors.
 *
 * `kinds` is an array and **11.9% of tiles are in no bucket at all**
 * (`src/catalog/schema.ts`), so the fallback has to be a real answer rather than
 * a failure: an unbucketed piece is treated as filling its square, which is the
 * conservative choice — it will be flagged against other fills rather than
 * silently permitted to stack.
 */
export function planBand(record: Pick<CatalogRecord, 'foot' | 'kinds'>): PlanBand {
  if (record.foot.shape === 'wall') return 'edge'
  const wall = record.kinds.includes('wall')
  const fills = record.kinds.some((kind) => AREA_KINDS.includes(kind))
  return wall && !fills ? 'edge' : 'area'
}

/**
 * Tolerance, in grid units, below which an intersection is treated as touching.
 *
 * 1e-6 units is 2.5e-5 mm. Anything smaller than that is floating-point residue
 * from the trigonometry in `rotatedExtent`, and two tiles that share a face —
 * the normal case for a tiled floor — must not be a conflict.
 */
const TOUCH_EPS = 1e-6

/** A placement's geometry, reduced to what overlap detection needs. */
export interface OverlapSubject {
  readonly band: PlanBand
  readonly box: PlanBox
  readonly quad: readonly PlanPoint[]
  /**
   * Whether the piece's rotation is a whole number of quarter turns, so that its
   * box *is* its shape. Only the corner-junction exemption reads it, and only to
   * refuse to apply itself to a piece whose box is not its shape.
   */
  readonly axisAligned: boolean
}

/** One placement, identified. */
export interface OverlapCandidate extends OverlapSubject {
  readonly id: PlacementId
}

function boxesIntersect(a: PlanBox, b: PlanBox): boolean {
  return (
    a.x + a.w - b.x > TOUCH_EPS &&
    b.x + b.w - a.x > TOUCH_EPS &&
    a.z + a.d - b.z > TOUCH_EPS &&
    b.z + b.d - a.z > TOUCH_EPS
  )
}

/** Project a polygon onto an axis and return its span. */
function project(quad: readonly PlanPoint[], ax: number, az: number): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity
  for (const [x, z] of quad) {
    const value = x * ax + z * az
    if (value < min) min = value
    if (value > max) max = value
  }
  return { min, max }
}

/** Whether any edge normal of `quad` separates it from `other`. */
function separatedByEdgesOf(quad: readonly PlanPoint[], other: readonly PlanPoint[]): boolean {
  for (let i = 0; i < quad.length; i += 1) {
    const [ax, az] = quad[i] as PlanPoint
    const [bx, bz] = quad[(i + 1) % quad.length] as PlanPoint
    // Outward normal of this edge; length is irrelevant to the sign of the gap,
    // but it does scale it, so normalise to keep TOUCH_EPS in grid units.
    const nx = bz - az
    const nz = -(bx - ax)
    const length = Math.hypot(nx, nz)
    if (length < TOUCH_EPS) continue
    const a = project(quad, nx / length, nz / length)
    const b = project(other, nx / length, nz / length)
    if (a.max - b.min <= TOUCH_EPS || b.max - a.min <= TOUCH_EPS) return true
  }
  return false
}

/** Which axis a box is longer on, or `null` when it is square. */
function longAxis(box: PlanBox): 'x' | 'z' | null {
  if (box.w - box.d > TOUCH_EPS) return 'x'
  if (box.d - box.w > TOUCH_EPS) return 'z'
  return null
}

/**
 * Whether two edge pieces are simply meeting at a corner.
 *
 * See the module docblock. Every clause is doing work: the band check keeps
 * floors out of it, the axis-aligned check keeps it away from pieces whose box is
 * not their shape, the size check keeps it to a single corner square, and the
 * perpendicular check is what separates a corner from a collinear overlap.
 */
function isCornerJunction(a: OverlapSubject, b: OverlapSubject): boolean {
  if (a.band !== 'edge' || b.band !== 'edge') return false
  if (!a.axisAligned || !b.axisAligned) return false
  const sharedX = Math.min(a.box.x + a.box.w, b.box.x + b.box.w) - Math.max(a.box.x, b.box.x)
  const sharedZ = Math.min(a.box.z + a.box.d, b.box.z + b.box.d) - Math.max(a.box.z, b.box.z)
  if (sharedX > WALL_THICKNESS_UNITS + TOUCH_EPS || sharedZ > WALL_THICKNESS_UNITS + TOUCH_EPS) return false
  const axisA = longAxis(a.box)
  const axisB = longAxis(b.box)
  return axisA !== null && axisB !== null && axisA !== axisB
}

/**
 * Whether two pieces are in conflict — the single predicate, used by both the
 * scene's conflict pass and the ghost's prediction.
 *
 * One function rather than two, because a ghost that predicted a conflict the
 * scene then did not report would be worse than either answer on its own.
 */
export function subjectsConflict(a: OverlapSubject, b: OverlapSubject): boolean {
  if (a.band !== b.band) return false
  if (!boxesIntersect(a.box, b.box)) return false
  if (!quadsOverlap(a.quad, b.quad)) return false
  return !isCornerJunction(a, b)
}

/** Whether two turned rectangles share interior area. Touching faces do not count. */
export function quadsOverlap(a: readonly PlanPoint[], b: readonly PlanPoint[]): boolean {
  return !separatedByEdgesOf(a, b) && !separatedByEdgesOf(b, a)
}

/**
 * Every placement that shares interior area with another in its own band.
 *
 * Swept on `x` rather than compared pairwise: the candidates are sorted by their
 * left edge and each one is compared only against those still open at its left
 * edge, so a room laid out along a corridor costs about `n` comparisons instead
 * of `n²/2`. At the 200 placements this PR was measured against the difference
 * is a fraction of a millisecond either way; it matters at the 2,000 a large
 * dungeon reaches, where the pairwise version is two million tests on every
 * store write.
 */
export function findConflicts(candidates: readonly OverlapCandidate[]): ReadonlySet<PlacementId> {
  const conflicts = new Set<PlacementId>()
  const ordered = [...candidates].sort((a, b) => a.box.x - b.box.x)
  const open: OverlapCandidate[] = []

  for (const candidate of ordered) {
    // Drop everything whose right edge is left of this candidate's left edge —
    // it cannot intersect this one or anything further right.
    for (let i = open.length - 1; i >= 0; i -= 1) {
      const other = open[i] as OverlapCandidate
      if (other.box.x + other.box.w - candidate.box.x <= TOUCH_EPS) open.splice(i, 1)
    }
    for (const other of open) {
      if (!subjectsConflict(other, candidate)) continue
      conflicts.add(candidate.id)
      conflicts.add(other.id)
    }
    open.push(candidate)
  }

  return conflicts
}
