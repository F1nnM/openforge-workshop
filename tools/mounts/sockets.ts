/**
 * The tilt sweep. A Dupont socket enters the face at 62–65° from the normal
 * (measured on 38 sockets across every torch family), so a straight depth map
 * sees only 3–4 mm of it. Rotate the mesh about the run axis by θ, depth-map
 * the face, and the pocket reads at its full ≈17–19 mm when θ matches the axis.
 * Every qualifying pocket at every θ is a candidate; candidates are clustered by
 * entrance and the deepest-mean per cluster kept, so a 4-unit S-system wall
 * returns both of its sockets and a wall-end sliver cannot outscore either.
 *
 * Depth is measured against a **local median baseline**, not a fitted plane:
 * on a full pillar the capital's underside is a second surface, on an S-system
 * wall the floor plate is, and a global plane through both put the socket below
 * threshold on 4 of 68 sample hosts. The local median makes each its own zero.
 */

import { CELL_MM, columns, label, localBaseline, rotateAbout } from './geometry'
import type { Axis, Columns } from './geometry'

export type Vec3 = readonly [number, number, number]

/** Below this a dip in the surface is texture, not the mouth of anything. */
export const POCKET_MIN_DEPTH_MM = 3.5

const AXIS_NAME = ['x', 'y', 'z'] as const

export interface Pocket {
  /** `'-y' | '+y' | '-x' | '+x'` — which face of the host the pocket opens on. */
  readonly face: string
  /** Mouth centre, mesh mm. */
  readonly entrance: Vec3
  /** Centre of the deepest columns, mesh mm. */
  readonly bottom: Vec3
  /** Unit `entrance → bottom`, so it points into the host. */
  readonly axis: Vec3
  /** Degrees between `axis` and the inward face normal. */
  readonly angleFromNormal: number
  /** `|bottom − entrance|`, mm. */
  readonly depth: number
  /** Mouth bounding box in the swept frame's (u, v), mm. */
  readonly entranceSize: readonly [number, number]
  readonly area: number
  /** Deepest single column, mm behind the local baseline. */
  readonly depthMax: number
  /** The sweep angle, degrees about the run axis, that read this pocket. */
  readonly theta: number
}

export interface SweepOptions {
  readonly angles?: readonly number[]
  readonly maxSizeMm?: number
  readonly minDepthMm?: number
  readonly minAreaMm2?: number
  readonly minDimMm?: number
}

/** A `Pocket` plus the mean depth that ranks it against the rest of its cluster. */
interface Candidate extends Pocket {
  readonly score: number
}

/** Every option resolved — what the sweep actually runs with. */
type Options = Required<SweepOptions>

const DEFAULTS: Options = {
  angles: Array.from({ length: 31 }, (_, k) => -75 + 5 * k),
  maxSizeMm: 12,
  minDepthMm: 6,
  minAreaMm2: 8,
  minDimMm: 2.5,
}

/** Fewer measured columns than this and the cast missed the host, not a face of it. */
const MIN_MEASURED_COLUMNS = 50

/** Two candidate mouths closer than this are one socket, read at two sweep angles. */
const CLUSTER_MM = 4

/**
 * The depth percentile a column must reach to vote on where the bottom is, so
 * the deepest 40 % of a pocket's columns set it and a shoulder cannot.
 */
const BOTTOM_PERCENTILE = 0.6

/** The face depth map of one swept frame, and the columns deep enough to be a mouth. */
interface Field {
  /** First (or last, for a `+` face) hit per column, along the cast. */
  readonly surface: Float64Array
  /** The local median of `surface` — each part of the host is its own zero. */
  readonly base: Float64Array
  /** How far behind `base` the surface sits, positive into the host. `NaN` where unmeasured. */
  readonly depth: Float64Array
  readonly mask: Uint8Array
  readonly measured: number
}

function depthField(col: Columns, sign: -1 | 1): Field {
  const surface = sign < 0 ? col.tmin : col.tmax
  const base = localBaseline(surface, col.nu, col.nv)
  const depth = new Float64Array(col.nu * col.nv).fill(NaN)
  const mask = new Uint8Array(col.nu * col.nv)
  let measured = 0
  for (let k = 0; k < depth.length; k += 1) {
    const at = surface[k] as number,
      zero = base[k] as number
    if (!Number.isFinite(at) || !Number.isFinite(zero)) continue
    measured += 1
    const below = (at - zero) * (sign < 0 ? 1 : -1)
    depth[k] = below
    if (below > POCKET_MIN_DEPTH_MM) mask[k] = 1
  }
  return { surface, base, depth, mask, measured }
}

/** The cells of each labelled component, in index order. */
function componentCells(labels: Int32Array, count: number): number[][] {
  const cells: number[][] = Array.from({ length: count }, () => [])
  for (let k = 0; k < labels.length; k += 1) {
    const component = labels[k] as number
    if (component > 0) (cells[component - 1] as number[]).push(k)
  }
  return cells
}

/** A point of the swept frame, from its (u, v) cell centre and its position along the cast. */
function swept(col: Columns, faceAxis: Axis, u: number, v: number, w: number): Vec3 {
  const p: [number, number, number] = [0, 0, 0]
  p[col.u] = u
  p[col.v] = v
  p[faceAxis] = w
  return p
}

/** Undo the sweep on a single point — `rotateAbout` takes one 3-vector as happily as a mesh. */
function unrotate(p: Vec3, axis: Axis, degrees: number): Vec3 {
  const out = rotateAbout(p, axis, -degrees)
  return [out[0] as number, out[1] as number, out[2] as number]
}

function mean(points: readonly Vec3[]): Vec3 {
  let x = 0,
    y = 0,
    z = 0
  for (const p of points) {
    x += p[0]
    y += p[1]
    z += p[2]
  }
  return [x / points.length, y / points.length, z / points.length]
}

/** Cell bounds of a component. Accumulated, not spread into `Math.min` — a
 * component of a textured 4-unit host runs to thousands of cells. */
function boundsOf(
  cells: readonly number[],
  nv: number,
): { readonly iMin: number; readonly iMax: number; readonly jMin: number; readonly jMax: number } {
  let iMin = Infinity,
    iMax = -Infinity,
    jMin = Infinity,
    jMax = -Infinity
  for (const k of cells) {
    const i = Math.floor(k / nv),
      j = k % nv
    if (i < iMin) iMin = i
    if (i > iMax) iMax = i
    if (j < jMin) jMin = j
    if (j > jMax) jMax = j
  }
  return { iMin, iMax, jMin, jMax }
}

/** The mesh-frame mouth and bottom of one component, averaged over its columns. */
function poseOf(
  cells: readonly number[],
  depths: readonly number[],
  context: { readonly col: Columns; readonly field: Field; readonly faceAxis: Axis },
  sweep: { readonly runAxis: Axis; readonly theta: number },
): { readonly entrance: Vec3; readonly bottom: Vec3 } {
  const { col, field, faceAxis } = context
  const floor = [...depths].sort((a, b) => a - b)[
    Math.floor(depths.length * BOTTOM_PERCENTILE)
  ] as number

  const mouth: Vec3[] = [],
    bottoms: Vec3[] = []
  cells.forEach((k, n) => {
    const u = col.ou + (Math.floor(k / col.nv) + 0.5) * CELL_MM,
      v = col.ov + ((k % col.nv) + 0.5) * CELL_MM
    const place = (w: number) => unrotate(swept(col, faceAxis, u, v, w), sweep.runAxis, sweep.theta)
    mouth.push(place(field.base[k] as number))
    if ((depths[n] as number) >= floor) bottoms.push(place(field.surface[k] as number))
  })
  return { entrance: mean(mouth), bottom: mean(bottoms) }
}

/**
 * One component of the mask as a candidate, or `undefined` where it is a wall
 * end, a texture speck, or too small or too shallow to be a socket.
 */
function candidateOf(
  cells: readonly number[],
  context: { readonly col: Columns; readonly field: Field; readonly faceAxis: Axis },
  sweep: { readonly runAxis: Axis; readonly sign: -1 | 1; readonly theta: number },
  opt: Options,
): Candidate | undefined {
  const { col, field, faceAxis } = context
  const area = cells.length * CELL_MM * CELL_MM
  if (area < opt.minAreaMm2) return undefined

  const { iMin, iMax, jMin, jMax } = boundsOf(cells, col.nv)
  // A component against the grid border is the host running out, not a mouth.
  if (iMin === 0 || jMin === 0 || iMax === col.nu - 1 || jMax === col.nv - 1) return undefined

  const su = (iMax - iMin + 1) * CELL_MM,
    sv = (jMax - jMin + 1) * CELL_MM
  if (Math.max(su, sv) > opt.maxSizeMm || Math.min(su, sv) < opt.minDimMm) return undefined

  const depths = cells.map((k) => field.depth[k] as number)
  let depthMax = -Infinity,
    depthSum = 0
  for (const at of depths) {
    if (at > depthMax) depthMax = at
    depthSum += at
  }
  if (depthMax < opt.minDepthMm) return undefined

  const { entrance, bottom } = poseOf(cells, depths, context, sweep)
  const length = Math.hypot(
    bottom[0] - entrance[0],
    bottom[1] - entrance[1],
    bottom[2] - entrance[2],
  )
  // No separation, no axis. `entrance` averages the baseline over every column
  // and `bottom` only the deepest 40 %, so the two are not held apart by the
  // depth threshold: a mask whose baseline runs deeper than its own floor can
  // put them on top of each other, and a normalise by zero is a NaN pose that
  // travels all the way to the emitted mount.
  if (length < 1e-9) return undefined
  const axis: Vec3 = [
    (bottom[0] - entrance[0]) / length,
    (bottom[1] - entrance[1]) / length,
    (bottom[2] - entrance[2]) / length,
  ]
  // The inward normal has only the face-axis component, so the dot product is it.
  const dot = axis[faceAxis] * (sweep.sign < 0 ? 1 : -1)
  return {
    face: `${sweep.sign < 0 ? '-' : '+'}${AXIS_NAME[faceAxis]}`,
    entrance,
    bottom,
    axis,
    angleFromNormal: (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI,
    depth: length,
    entranceSize: [su, sv],
    area,
    depthMax,
    theta: sweep.theta,
    score: depthSum / depths.length,
  }
}

/** A candidate without the ranking that got it here. */
function pocketOf({ score: _score, ...pocket }: Candidate): Pocket {
  return pocket
}

/** The deepest candidate of each cluster of mouths, deepest cluster first. */
function pickPerCluster(candidates: readonly Candidate[]): Pocket[] {
  const out: Pocket[] = []
  for (const pocket of [...candidates].sort((a, b) => b.score - a.score).map(pocketOf)) {
    const apart = out.every(
      (kept) =>
        Math.hypot(
          pocket.entrance[0] - kept.entrance[0],
          pocket.entrance[1] - kept.entrance[1],
          pocket.entrance[2] - kept.entrance[2],
        ) > CLUSTER_MM,
    )
    if (apart) out.push(pocket)
  }
  return out
}

/**
 * Every pocket on the `sign` side of `faceAxis`, one per socket, found by
 * sweeping the mesh about `runAxis` and depth-mapping the face at each angle.
 */
export function socketPoses(
  positions: ArrayLike<number>,
  triangles: number,
  faceAxis: Axis,
  runAxis: Axis,
  sign: -1 | 1,
  options: SweepOptions = {},
): Pocket[] {
  const opt: Options = { ...DEFAULTS, ...options }
  const candidates: Candidate[] = []
  for (const theta of opt.angles) {
    const turned = theta === 0 ? positions : rotateAbout(positions, runAxis, theta)
    const col = columns(turned, triangles, faceAxis)
    const field = depthField(col, sign)
    if (field.measured < MIN_MEASURED_COLUMNS) continue
    const { labels, count } = label(field.mask, col.nu, col.nv)
    for (const cells of componentCells(labels, count)) {
      const found = candidateOf(cells, { col, field, faceAxis }, { runAxis, sign, theta }, opt)
      if (found) candidates.push(found)
    }
  }
  return pickPerCluster(candidates)
}
