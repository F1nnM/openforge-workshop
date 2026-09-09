/**
 * Curved hosts are unrolled about their arc centre so the flat detector reads
 * them. Every arc host in the sample is authored with that centre at the mesh
 * origin — 49–58 % of mid-height vertices sit on one of the two nominal radii
 * from (0, 0), against 0 % for an algebraic circle fit, which is dragged into
 * the slab — so the fit *starts* at the origin and refines with Gauss–Newton
 * steps toward whichever nominal radius each point is nearer.
 */

import type { Vec3 } from './sockets'

/** Below this fraction of mid-height vertices on a nominal radius, the fit is not an arc. */
export const ARC_FIT_MIN_ON_RADIUS = 0.4

export interface ArcFit {
  readonly centre: readonly [number, number]
  readonly onRadius: number
}

/** How far off its nominal radius a vertex may sit and still steer the fit, mm. */
const RESIDUAL_LIMIT_MM = 3

/** How far off a nominal radius a vertex may sit and still count as on it, mm. */
const ON_RADIUS_MM = 1

/** Half-thickness of the mid-height slice the fit reads, mm. */
const SLICE_MM = 4

/** Gauss–Newton stops here, or when a step moves the centre less than a micron. */
const MAX_STEPS = 8,
  STEP_SETTLED_MM = 1e-3

/** Fewer usable vertices than this and a step is noise, not a correction. */
const MIN_FIT_POINTS = 50

/** At most this many points reach the fit; a 200k-triangle wall would cost seconds. */
const MAX_FIT_POINTS = 20000

/** The (x, y) of every vertex within `SLICE_MM` of the median height, decimated. */
function midSlice(positions: ArrayLike<number>, triangles: number): [number, number][] {
  const heights: number[] = []
  for (let o = 2; o < triangles * 9; o += 3) heights.push(positions[o] as number)
  // A corpus STL may declare zero facets — the smallest live file is 84 bytes
  // doing exactly that — and an empty mesh has no median height to slice at.
  if (heights.length === 0) return []
  heights.sort((a, b) => a - b)
  const zMid = heights[Math.floor(heights.length / 2)] as number

  const points: [number, number][] = []
  for (let o = 0; o < triangles * 9; o += 3) {
    if (Math.abs((positions[o + 2] as number) - zMid) < SLICE_MM)
      points.push([positions[o] as number, positions[o + 1] as number])
  }
  const stride = Math.max(1, Math.floor(points.length / MAX_FIT_POINTS))
  return points.filter((_, i) => i % stride === 0)
}

/**
 * The centre the host's two nominal radii are struck from, starting at the mesh
 * origin. `onRadius` says how much of the slice the answer actually explains —
 * a straight wall scores near zero, and the caller treats it as flat.
 */
export function fitArcCentre(
  positions: ArrayLike<number>,
  triangles: number,
  rInMm: number,
  rOutMm: number,
): ArcFit {
  const slice = midSlice(positions, triangles)
  let cx = 0,
    cy = 0
  for (let step = 0; step < MAX_STEPS; step += 1) {
    let a11 = 0,
      a12 = 0,
      a22 = 0,
      b1 = 0,
      b2 = 0,
      n = 0
    for (const [x, y] of slice) {
      const dx = x - cx,
        dy = y - cy,
        r = Math.hypot(dx, dy)
      if (r < 1e-9) continue
      const target = Math.abs(r - rInMm) < Math.abs(r - rOutMm) ? rInMm : rOutMm
      const residual = r - target
      if (Math.abs(residual) > RESIDUAL_LIMIT_MM) continue
      // d(residual)/d(centre): moving the centre toward a point shortens its radius.
      const jx = -dx / r,
        jy = -dy / r
      a11 += jx * jx
      a12 += jx * jy
      a22 += jy * jy
      b1 -= jx * residual
      b2 -= jy * residual
      n += 1
    }
    if (n < MIN_FIT_POINTS) break
    const det = a11 * a22 - a12 * a12
    if (Math.abs(det) < 1e-12) break
    const sx = (a22 * b1 - a12 * b2) / det,
      sy = (a11 * b2 - a12 * b1) / det
    cx += sx
    cy += sy
    if (Math.hypot(sx, sy) < STEP_SETTLED_MM) break
  }

  let on = 0
  for (const [x, y] of slice) {
    const r = Math.hypot(x - cx, y - cy)
    if (Math.min(Math.abs(r - rInMm), Math.abs(r - rOutMm)) < ON_RADIUS_MM) on += 1
  }
  return { centre: [cx, cy], onRadius: slice.length === 0 ? 0 : on / slice.length }
}

/**
 * (x, y, z) → (u = arc length at `rMid`, w = r − `rMid`, z).
 *
 * Each triangle's three angles are put on one branch of `atan2`, so a triangle
 * straddling the cut is unrolled whole instead of being stretched across 2π·rMid.
 */
export function unroll(
  positions: ArrayLike<number>,
  centre: readonly [number, number],
  rMid: number,
): Float64Array {
  const out = new Float64Array(positions.length)
  for (let o = 0; o < positions.length; o += 9) {
    let first = 0
    for (let k = 0; k < 3; k += 1) {
      const at = o + k * 3
      const dx = (positions[at] as number) - centre[0],
        dy = (positions[at + 1] as number) - centre[1]
      const raw = Math.atan2(dy, dx)
      let theta = raw
      if (k === 0) first = raw
      else theta = first + Math.atan2(Math.sin(raw - first), Math.cos(raw - first))
      out[at] = rMid * theta
      out[at + 1] = Math.hypot(dx, dy) - rMid
      out[at + 2] = positions[at + 2] as number
    }
  }
  return out
}

/** An unrolled point back onto the arc. */
export function reroll(p: Vec3, centre: readonly [number, number], rMid: number): Vec3 {
  const theta = p[0] / rMid,
    r = rMid + p[1]
  return [centre[0] + r * Math.cos(theta), centre[1] + r * Math.sin(theta), p[2]]
}

/**
 * A direction measured at unrolled point `p`, back onto the arc.
 *
 * A rotation and no translation, so `centre` goes unused — it is taken anyway so
 * a caller re-rolling a pose passes the same two arguments to both functions.
 */
export function rerollVector(
  p: Vec3,
  v: Vec3,
  centre: readonly [number, number],
  rMid: number,
): Vec3 {
  const theta = p[0] / rMid
  // u runs along the tangent (−sin, cos) and w along the radius (cos, sin).
  const sin = Math.sin(theta),
    cos = Math.cos(theta)
  return [v[0] * -sin + v[1] * cos, v[0] * cos + v[1] * sin, v[2]]
}
