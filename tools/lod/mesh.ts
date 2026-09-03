/**
 * How big a LOD should be, and how to tell whether it still looks like the tile.
 *
 * No glTF and no wasm in this module — it is arithmetic over triangle soups, so
 * the policy that decides what ships can be tested without a decoder.
 *
 * ## One level, sized per mesh
 *
 * Row G1 asks for 5–20 K triangles. That is **one level**, with the target chosen
 * per mesh inside the band, and the reason is what G2 does with the output:
 * *one `InstancedMesh` per design*. An `InstancedMesh` shares a single
 * `BufferGeometry` across every instance, so a distance-switched LOD ladder is
 * not expressible through it — `THREE.LOD` swaps whole objects, and selecting a
 * level per instance would mean one `InstancedMesh` per (design, level), which is
 * precisely the draw-call multiplication instancing exists to avoid. A second
 * level would therefore be dead weight until G2 stops instancing.
 *
 * The measurement agrees. Meshopt-compressed GLB size is very nearly linear in
 * triangle count — **6.7 KB at 1.5 K, 18.7 KB at 5 K, 43.0 KB at 12 K, 70.1 KB
 * at 20 K** — so a coarse companion level would save on the order of 12 KB per
 * design. And at 1.5 K triangles the corpus's heaviest mesh
 * (`2d32f890…`, 2,178,242 triangles) loses **4.34 mm of bounding box** and
 * **27.9% of its surface area**, so the coarse level is unusable for exactly the
 * tiles that would most benefit from one.
 *
 * What replaces the ladder is that the *band itself* is adaptive: the target
 * scales with source complexity and is clamped into the band, so a simple wall
 * gets the cheap version and a boss door gets the expensive one. That is an LOD
 * ladder indexed by mesh instead of by camera distance, which is the only axis
 * instancing leaves available.
 *
 * ## Where the numbers come from
 *
 * Measured on four real catalog meshes spanning the corpus, decimating from the
 * welded original and comparing surface area, enclosed volume and bounding box:
 *
 * | source tris | 5 K area err | 12 K area err | 20 K area err |
 * | --- | --- | --- | --- |
 * | 71,292 | 0.05% | 0.07% | 0.08% |
 * | 207,296 | 0.12% | 0.01% | 0.02% |
 * | 527,488 | 2.26% | 0.33% | 0.03% |
 * | 2,178,242 | **14.92%** | 7.18% | 3.24% |
 *
 * So the band's floor is right for most of the corpus and its ceiling is what
 * the heaviest meshes need. {@link KEEP_FRACTION} of 1% lands each of those four
 * at 5 K, 5 K, 5,275 and 20 K respectively — which is the column each of them
 * wants — and {@link MAX_AREA_ERROR} catches anything the fraction misjudges.
 */

/** Floor of the band. Below this a mesh is not worth a separate object. */
export const MIN_TRIANGLES = 5_000

/** Ceiling of the band, and the escalation target. */
export const MAX_TRIANGLES = 20_000

/**
 * Fraction of source triangles to aim for, before clamping into the band.
 *
 * 1%. Chosen so the corpus's heaviest mesh lands on the ceiling and the median
 * (207,296 triangles) lands on the floor — see the table above. Everything
 * between 500 K and 2 M triangles gets a proportional share of the band, which
 * is the 11.2% of the corpus the STL gate refuses.
 */
export const KEEP_FRACTION = 0.01

/**
 * Simplifier error budget, as a fraction of mesh radius.
 *
 * meshoptimizer stops early if the collapse error would exceed this, and glTF
 * Transform's default is **0.0001** (0.01%) — far too tight to reach a 1% ratio,
 * so with the default the reduction silently stops short. 5% of mesh radius is
 * loose enough that the *ratio* is the binding constraint, which is what makes
 * the output land in the band predictably.
 */
export const SIMPLIFY_ERROR = 0.05

/** Surface-area loss above which the target is escalated to the ceiling. */
export const MAX_AREA_ERROR = 0.05

/**
 * Bounding-box shrink, in the mesh's own units (mm), above which the target is
 * escalated.
 *
 * A silhouette that has moved is the one decimation artefact a viewer reads as
 * "wrong tile" rather than "less detail", and 0.5 mm is a fifth of the thinnest
 * wall in the corpus. At the chosen targets the measured worst case is 0.36 mm;
 * at 1.5 K triangles it is 4.34 mm.
 */
export const MAX_BBOX_DELTA = 0.5

/**
 * The band, as the CLI's `--min`/`--max` may narrow it.
 *
 * Passed explicitly rather than read from the constants, because a target policy
 * that quietly ignores its own band is the kind of bug whose tests pass for the
 * wrong reason: the simplifier's overshoot retry will eventually get under a
 * narrower ceiling anyway, so the *result* looks right while the first target was
 * computed against the wrong number.
 */
export interface Band {
  min: number
  max: number
}

/** The measured default — see the module docblock. */
export const DEFAULT_BAND: Band = { min: MIN_TRIANGLES, max: MAX_TRIANGLES }

/**
 * How many triangles this mesh's LOD should aim for.
 *
 * A mesh already at or below the ceiling is **passed through untouched** — there
 * is nothing to gain from decimating a 118-triangle column, and simplifying
 * toward a floor above its own count would be inflation, not LOD.
 */
export function targetTriangles(sourceTriangles: number, band: Band = DEFAULT_BAND): number {
  if (isPassThrough(sourceTriangles, band)) return sourceTriangles
  const scaled = Math.ceil(sourceTriangles * KEEP_FRACTION)
  return Math.min(band.max, Math.max(band.min, scaled))
}

/** `true` when {@link targetTriangles} left the mesh alone. */
export function isPassThrough(sourceTriangles: number, band: Band = DEFAULT_BAND): boolean {
  return sourceTriangles <= band.max
}

/** Shape summary of a triangle soup, in the mesh's own units. */
export interface MeshMetrics {
  triangles: number
  /** Total surface area — the sensitive measure of lost detail. */
  area: number
  /** Enclosed volume, unsigned. A proxy for silhouette rather than for detail. */
  volume: number
  /** Axis-aligned extents, `[x, y, z]`. */
  extents: [number, number, number]
}

/**
 * Area, volume and extents in one pass.
 *
 * `indices` may be `null` for a non-indexed soup (which is what an STL parses
 * to). Volume is the standard signed-tetrahedron sum taken absolute: it is only
 * meaningful for a closed surface, and the corpus is printable geometry, so it
 * is meaningful here. Extents are computed over the vertices actually *used*,
 * because a simplifier that drops vertices without compacting the array would
 * otherwise report the source's bounding box forever.
 */
export function meshMetrics(positions: ArrayLike<number>, indices: ArrayLike<number> | null): MeshMetrics {
  const count = indices === null ? positions.length / 3 : indices.length
  let area = 0
  let volume = 0
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]

  for (let corner = 0; corner < count; corner += 3) {
    const a = (indices === null ? corner : (indices[corner] ?? 0)) * 3
    const b = (indices === null ? corner + 1 : (indices[corner + 1] ?? 0)) * 3
    const c = (indices === null ? corner + 2 : (indices[corner + 2] ?? 0)) * 3

    const ax = positions[a] ?? 0
    const ay = positions[a + 1] ?? 0
    const az = positions[a + 2] ?? 0
    const bx = positions[b] ?? 0
    const by = positions[b + 1] ?? 0
    const bz = positions[b + 2] ?? 0
    const cx = positions[c] ?? 0
    const cy = positions[c + 1] ?? 0
    const cz = positions[c + 2] ?? 0

    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6

    const ux = bx - ax
    const uy = by - ay
    const uz = bz - az
    const vx = cx - ax
    const vy = cy - ay
    const vz = cz - az
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    area += Math.hypot(nx, ny, nz) / 2

    for (const [x, y, z] of [
      [ax, ay, az],
      [bx, by, bz],
      [cx, cy, cz],
    ] as const) {
      if (x < min[0]) min[0] = x
      if (y < min[1]) min[1] = y
      if (z < min[2]) min[2] = z
      if (x > max[0]) max[0] = x
      if (y > max[1]) max[1] = y
      if (z > max[2]) max[2] = z
    }
  }

  const extents: [number, number, number] =
    count === 0 ? [0, 0, 0] : [max[0] - min[0], max[1] - min[1], max[2] - min[2]]

  return { triangles: count / 3, area, volume, extents }
}

/** How far a decimated mesh has drifted from its source. */
export interface Fidelity {
  /** `|Δarea| / area`, as a fraction. */
  areaError: number
  /** `|Δvolume| / volume`, as a fraction. */
  volumeError: number
  /** Largest per-axis bounding-box change, in the mesh's own units. */
  bboxDelta: number
  /** `true` when both {@link MAX_AREA_ERROR} and {@link MAX_BBOX_DELTA} hold. */
  acceptable: boolean
}

/** Compare a decimated mesh to its source. A zero-area source reports no error. */
export function fidelity(source: MeshMetrics, lod: MeshMetrics): Fidelity {
  const areaError = source.area === 0 ? 0 : Math.abs(lod.area - source.area) / source.area
  const volumeError = source.volume === 0 ? 0 : Math.abs(lod.volume - source.volume) / source.volume
  let bboxDelta = 0
  for (let axis = 0; axis < 3; axis += 1) {
    const delta = Math.abs((lod.extents[axis] ?? 0) - (source.extents[axis] ?? 0))
    if (delta > bboxDelta) bboxDelta = delta
  }
  return {
    areaError,
    volumeError,
    bboxDelta,
    acceptable: areaError <= MAX_AREA_ERROR && bboxDelta <= MAX_BBOX_DELTA,
  }
}
