/**
 * The axis-aligned bounding box, and the honest error of measuring it from a
 * subsample.
 *
 * ## Why the stride question needs an experiment rather than an assumption
 *
 * `architecture-plan.md` §14 costs this row as "strided range-reads (~13 GB,
 * sub-0.03 mm)". The transfer arithmetic is sound — a binary STL is `84 + 50n`
 * bytes exactly, so any facet subset is expressible as HTTP ranges — but the
 * accuracy claim is not something arithmetic can supply. A bounding box is
 * decided by six extreme vertices out of millions, STL triangle order is not
 * required to be spatially coherent, and a stride that skips the facet holding
 * an extreme reports a box that is *smaller* than the mesh with no signal that
 * anything was missed.
 *
 * So {@link strideError} exists: it takes the exact box from every facet and the
 * box from every `k`-th facet and returns the worst per-axis disagreement, in
 * millimetres. `calibrate.ts` runs it across a size-spanning sample and the CLI
 * prints the table. The stride is chosen from that table or not at all.
 *
 * ## The box is always taken from every vertex of every sampled facet
 *
 * Not from a decimated vertex list: sampling *facets* is what a range read can
 * actually do, and all three corners of a fetched facet arrive together for
 * free, so ignoring two of them would report a worse error than striding
 * actually has.
 */
import { GRID_UNIT_MM } from '../../src/catalog'
import type { ParsedStl } from '../../src/three/stl/parse'

/** Millimetres per catalog unit — 25.4, exactly, confirmed across 1,042 extents. */
export const MM_PER_UNIT = GRID_UNIT_MM

/** A three-component vector, in whatever unit the field name says. */
export type Vec3 = readonly [number, number, number]

/** An axis-aligned box in the mesh's own coordinates, which are millimetres. */
export interface BoundingBox {
  minMm: Vec3
  maxMm: Vec3
  /** `max - min`, per axis. */
  sizeMm: Vec3
  /** `sizeMm / 25.4`. The catalog's unit. */
  sizeUnits: Vec3
  /** Facets the box was taken from. Equal to the mesh's triangle count on a full read. */
  facets: number
}

/**
 * The box over every `stride`-th facet, starting at facet 0.
 *
 * `stride === 1` is the exact box. Returns `undefined` for a mesh with no
 * facets: the corpus's smallest file is an 84-byte binary header declaring zero
 * of them, which is a valid STL and not an error, but it has no extent and the
 * sidecar must say "not measurable" rather than invent an origin-sized box.
 */
export function boundingBox(
  positions: Float32Array,
  triangles: number,
  stride = 1,
): BoundingBox | undefined {
  if (stride < 1 || !Number.isInteger(stride)) throw new RangeError('stride must be a positive integer')
  if (triangles <= 0) return undefined

  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  let facets = 0

  for (let facet = 0; facet < triangles; facet += stride) {
    facets += 1
    const base = facet * 9
    for (let corner = 0; corner < 3; corner += 1) {
      const at = base + corner * 3
      const x = positions[at] as number
      const y = positions[at + 1] as number
      const z = positions[at + 2] as number
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (z < minZ) minZ = z
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
      if (z > maxZ) maxZ = z
    }
  }

  if (!Number.isFinite(minX)) return undefined
  return box([minX, minY, minZ], [maxX, maxY, maxZ], facets)
}

function box(minMm: Vec3, maxMm: Vec3, facets: number): BoundingBox {
  const sizeMm: Vec3 = [maxMm[0] - minMm[0], maxMm[1] - minMm[1], maxMm[2] - minMm[2]]
  return {
    minMm,
    maxMm,
    sizeMm,
    sizeUnits: [sizeMm[0] / MM_PER_UNIT, sizeMm[1] / MM_PER_UNIT, sizeMm[2] / MM_PER_UNIT],
    facets,
  }
}

/** The exact box of a parsed mesh. */
export function extentOf(parsed: ParsedStl): BoundingBox | undefined {
  return boundingBox(parsed.positions, parsed.triangles)
}

/** What a stride got wrong, per axis and overall, in millimetres. */
export interface StrideError {
  stride: number
  /** Facets the strided box was taken from. */
  facets: number
  /** Worst disagreement on any of the six box faces, mm. Always ≥ 0. */
  maxFaceErrorMm: number
  /** Worst disagreement on any of the three extents, mm. Always ≥ 0. */
  maxSizeErrorMm: number
  /** Per-axis extent error, mm. Never negative: a subsample can only shrink the box. */
  sizeErrorMm: Vec3
}

/**
 * Compare the box from every `stride`-th facet with the exact box.
 *
 * A subsample can only ever produce a box contained in the true one, so every
 * error here is a *shrinkage*. `maxFaceErrorMm` is the number a footprint cares
 * about — a face that moved is a wall in the wrong place — and
 * `maxSizeErrorMm` is the one a size tag cares about.
 */
export function strideError(
  positions: Float32Array,
  triangles: number,
  stride: number,
): StrideError | undefined {
  const exact = boundingBox(positions, triangles, 1)
  const sampled = boundingBox(positions, triangles, stride)
  if (exact === undefined || sampled === undefined) return undefined

  let maxFace = 0
  for (let axis = 0; axis < 3; axis += 1) {
    maxFace = Math.max(
      maxFace,
      Math.abs((sampled.minMm[axis] as number) - (exact.minMm[axis] as number)),
      Math.abs((sampled.maxMm[axis] as number) - (exact.maxMm[axis] as number)),
    )
  }
  const sizeErrorMm: Vec3 = [
    Math.abs(exact.sizeMm[0] - sampled.sizeMm[0]),
    Math.abs(exact.sizeMm[1] - sampled.sizeMm[1]),
    Math.abs(exact.sizeMm[2] - sampled.sizeMm[2]),
  ]

  return {
    stride,
    facets: sampled.facets,
    maxFaceErrorMm: maxFace,
    maxSizeErrorMm: Math.max(...sizeErrorMm),
    sizeErrorMm,
  }
}

/** Round to `places` decimals. Keeps the sidecar readable and diffable. */
export function round(value: number, places = 4): number {
  const scale = 10 ** places
  return Math.round(value * scale) / scale
}

/** {@link round} over a vector. */
export function roundVec(value: Vec3, places = 4): Vec3 {
  return [round(value[0], places), round(value[1], places), round(value[2], places)]
}
