/**
 * STL bytes → LOD-grade indexed geometry, in the browser. The pass row R1 exists
 * to run.
 *
 * ## What this is a substitute for, and what it is not
 *
 * `tools/lod/decimate.ts` does this job offline and writes a meshopt-compressed
 * GLB to `/lod/`. That store is **empty** — blocker B2 holds the write
 * credentials and B7 is the backfill run — so `/lod/` answers 404 and the 3D
 * builder has no geometry at all. This module reaches the *same geometry* from
 * the source STL the user is entitled to anyway, on their own CPU, and the
 * cache it feeds (`cache.ts`) holds the result. When B7 runs, `/lod/` starts
 * answering, `loadLod.ts` prefers it, and this path goes quiet without anything
 * being deleted.
 *
 * It is **not** the same file. There is no GLB container, no `EXT_meshopt`
 * compression and no quantisation here, and that is deliberate on all three
 * counts: the output is going into IndexedDB as typed arrays and straight into a
 * `BufferGeometry`, so a container would be encoded and immediately decoded, and
 * the quantisation that buys the store its last 1.47× is what forces
 * `loadLod.ts`'s whole `node.matrixWorld` bake. Positions come out of here in
 * millimetres already, which is what the store's consumer has to work to
 * achieve.
 *
 * The triangle *band* is the same, and that is the part that matters: 5,000 to
 * 20,000 triangles, target 1% of source, `SIMPLIFY_ERROR` 0.05. Those four
 * numbers live in `band.ts` — separately, so `index.ts` can re-export the
 * policy without dragging `meshoptimizer` into the chunk that reads it — and
 * `band.test.ts` asserts each one against `tools/lod/mesh.ts`'s own source.
 *
 * ## Why no fidelity escalation
 *
 * The pipeline measures surface area and bounding-box drift after simplifying
 * and escalates the target to the ceiling when either moves too far. It can
 * afford to: it runs once, offline, over 8,353 objects, and a second pass costs
 * a build-machine second. Here the second pass costs a *user* the same second on
 * the mesh they are waiting for, and the escalation's only possible outcome is
 * the ceiling — 20,000 triangles — which is where `targetTriangles` already
 * sends every mesh whose fidelity the pipeline found wanting. Measured over the
 * corpus's byte-derived triangle counts, 1% of source exceeds the ceiling for
 * **the top 11.2%** of meshes, which are exactly the ones that escalate. So this
 * module aims at `min(20000, max(5000, 1% of source))` in one shot and reports
 * the drift it measured rather than acting on it: {@link ConvertedMesh.areaError}
 * is carried to the UI, and a mesh whose silhouette moved is a disclosure, not a
 * retry.
 *
 * ## No three.js, on purpose
 *
 * Nothing here imports a renderer, so this module and the worker around it live
 * on the light side of `src/builder/three`'s lazy boundary. That is what lets
 * the conversion be triggered from the library — a screen that must not download
 * 411 kB of three.js — while the `BufferGeometry` is built later, inside the 3D
 * chunk, from the cached arrays.
 */
import { MeshoptSimplifier } from 'meshoptimizer/simplifier'

import { parseStl } from '@/three/stl/parse'
import type { StlFormat } from '@/three/stl/parse'

import {
  MAX_SIMPLIFY_ATTEMPTS,
  MAX_TRIANGLES,
  SIMPLIFY_ERROR,
  isPassThrough,
  targetTriangles,
} from './band'
import type { Indices, Positions, WeldReport, WeldedMesh } from './weld'
import { weldPositions } from './weld'

/** The source STL is valid and declares no facets. */
export class EmptyMeshError extends Error {
  override readonly name = 'EmptyMeshError'
  readonly sourceBytes: number
  constructor(sourceBytes: number) {
    super(`${String(sourceBytes)} bytes of valid STL declaring zero facets — there is no mesh to convert`)
    this.sourceBytes = sourceBytes
  }
}

/** Simplification could not get under the ceiling. Never cached quietly. */
export class TargetMissedError extends Error {
  override readonly name = 'TargetMissedError'
  readonly triangles: number
  readonly limit: number
  readonly attempts: number
  constructor(triangles: number, limit: number, attempts: number) {
    super(
      `after ${String(attempts)} attempts the mesh still holds ${String(triangles)} triangles, ` +
        `over the ${String(limit)} ceiling`,
    )
    this.triangles = triangles
    this.limit = limit
    this.attempts = attempts
  }
}

/** The simplifier's wasm is unavailable in this environment. */
export class SimplifierUnavailableError extends Error {
  override readonly name = 'SimplifierUnavailableError'
  constructor() {
    super('the meshoptimizer simplifier is not supported here, so an STL cannot be converted to LOD grade')
  }
}

/** Everything one conversion produced. */
export interface ConvertedMesh {
  readonly positions: Positions
  readonly indices: Indices
  readonly triangles: number
  readonly vertices: number
  readonly sourceTriangles: number
  readonly sourceBytes: number
  readonly format: StlFormat
  /** Triangles the parser dropped for a non-finite coordinate. Normally 0. */
  readonly droppedTriangles: number
  readonly weld: WeldReport
  /** Triangle count aimed for. Equals `sourceTriangles` for a pass-through. */
  readonly target: number
  /** `true` when the source was already inside the band and was left alone. */
  readonly passThrough: boolean
  readonly attempts: number
  /**
   * Surface area lost to simplification, as a fraction. 0 for a pass-through.
   *
   * Reported rather than acted on — see the module note. `tools/lod/mesh.ts`
   * treats 5% as the line above which a LOD stops looking like the tile, and
   * the UI is entitled to say so.
   */
  readonly areaError: number
  /** Largest axis-extent shrink, in millimetres. `tools/lod/mesh.ts` allows 0.5. */
  readonly extentError: number
  /** Wall-clock milliseconds, split so a slow phase is identifiable. */
  readonly timing: { readonly parseMs: number; readonly weldMs: number; readonly simplifyMs: number }
}

/** Initialise the simplifier's wasm. Idempotent; awaited by {@link convertStl}. */
export function ready(): Promise<void> {
  return MeshoptSimplifier.ready
}

/** Whether {@link convertStl} can run here at all. */
export function simplifierSupported(): boolean {
  return MeshoptSimplifier.supported === true
}

/**
 * Convert one STL into cacheable LOD-grade geometry.
 *
 * @throws {EmptyMeshError} when the file is valid and holds no facets.
 * @throws {WeldNoOpError} when welding did not materially reduce the vertex count.
 * @throws {TargetMissedError} when simplification could not reach the ceiling.
 * @throws {StlParseError} when the bytes are not STL.
 */
export async function convertStl(bytes: Uint8Array): Promise<ConvertedMesh> {
  if (!simplifierSupported()) throw new SimplifierUnavailableError()
  await ready()

  const parseStarted = performance.now()
  const parsed = parseStl(bytes)
  const parseMs = performance.now() - parseStarted
  if (parsed.triangles === 0) throw new EmptyMeshError(parsed.sourceBytes)

  const weldStarted = performance.now()
  const welded = weldPositions(parsed.positions)
  const weldMs = performance.now() - weldStarted

  const source = surfaceOf(welded.positions, welded.indices)
  const simplifyStarted = performance.now()
  const simplified = reachBand(welded)
  const simplifyMs = performance.now() - simplifyStarted
  const lod = simplified.passThrough ? source : surfaceOf(simplified.positions, simplified.indices)

  return {
    positions: simplified.positions,
    indices: simplified.indices,
    triangles: simplified.indices.length / 3,
    vertices: simplified.positions.length / 3,
    sourceTriangles: parsed.triangles,
    sourceBytes: parsed.sourceBytes,
    format: parsed.format,
    droppedTriangles: parsed.dropped,
    weld: welded.report,
    target: simplified.target,
    passThrough: simplified.passThrough,
    attempts: simplified.attempts,
    areaError: source.area === 0 ? 0 : Math.abs(source.area - lod.area) / source.area,
    extentError: Math.max(
      source.extents[0] - lod.extents[0],
      source.extents[1] - lod.extents[1],
      source.extents[2] - lod.extents[2],
    ),
    timing: { parseMs, weldMs, simplifyMs },
  }
}

interface BandResult {
  positions: Positions
  indices: Indices
  target: number
  passThrough: boolean
  attempts: number
}

/**
 * Simplify under the ceiling, retrying on overshoot.
 *
 * meshoptimizer aims at a target *index* count and can land above it on awkward
 * topology — the pipeline measured target 1,500 → 1,738 triangles on the boss
 * door — so a result over the ceiling is aimed lower by the overshoot with 10%
 * of headroom and tried again, bounded by {@link MAX_SIMPLIFY_ATTEMPTS}. Three
 * attempts on a mesh that is already welded is cheap; shipping something over
 * the budget `lod.ts` computed is not.
 */
function reachBand(welded: WeldedMesh): BandResult {
  if (isPassThrough(welded.triangles)) {
    return {
      positions: welded.positions,
      indices: welded.indices,
      target: welded.triangles,
      passThrough: true,
      attempts: 0,
    }
  }

  let target = targetTriangles(welded.triangles)
  let best: BandResult | undefined

  for (let attempt = 1; attempt <= MAX_SIMPLIFY_ATTEMPTS; attempt += 1) {
    const [indices] = MeshoptSimplifier.simplify(
      welded.indices,
      welded.positions,
      3,
      target * 3,
      SIMPLIFY_ERROR,
      // `Prune` drops components the collapse disconnected. Without it a
      // simplified mesh keeps isolated triangles that cost index space and draw
      // nothing recognisable; glTF Transform's `simplify` passes it too.
      ['Prune'],
    )
    const compacted = compact(indices, welded.positions)
    const triangles = compacted.indices.length / 3
    best = { ...compacted, target, passThrough: false, attempts: attempt }

    if (triangles <= MAX_TRIANGLES) return best
    if (attempt === MAX_SIMPLIFY_ATTEMPTS) throw new TargetMissedError(triangles, MAX_TRIANGLES, attempt)
    target = Math.max(1, Math.floor((target * MAX_TRIANGLES) / triangles / 1.1))
  }

  /* c8 ignore next -- the loop either returns or throws; this satisfies the checker */
  throw new TargetMissedError(welded.triangles, MAX_TRIANGLES, MAX_SIMPLIFY_ATTEMPTS)
}

/**
 * Drop the vertices simplification stopped using.
 *
 * `MeshoptSimplifier.simplify` returns indices into the **original** vertex
 * array, so a mesh simplified from 1.1 M vertices to 10 K still carries 1.1 M
 * positions — 13 MB of them — unless they are compacted out. `compactMesh`
 * rewrites the index array in place and hands back the vertex remap, which is
 * what makes the cached record small; skipping it would leave the cache holding
 * the source's vertex buffer with an LOD index on top, which is the *opposite*
 * of the point of this row.
 */
function compact(indices: Uint32Array, positions: Positions): { positions: Positions; indices: Indices } {
  // `simplify` returns a fresh array, so `compactMesh` rewriting it in place is
  // safe and is what it does.
  const [remap, unique] = MeshoptSimplifier.compactMesh(indices)

  const packed = new Float32Array(unique * 3)
  const vertices = positions.length / 3
  for (let vertex = 0; vertex < vertices; vertex += 1) {
    const to = remap[vertex] ?? 0xffff_ffff
    // `0xffffffff` is meshoptimizer's "unused" marker.
    if (to === 0xffff_ffff) continue
    packed[to * 3] = positions[vertex * 3] ?? 0
    packed[to * 3 + 1] = positions[vertex * 3 + 1] ?? 0
    packed[to * 3 + 2] = positions[vertex * 3 + 2] ?? 0
  }

  // The index is copied into an array that owns a plain `ArrayBuffer`, because
  // meshoptimizer's declared return type admits a `SharedArrayBuffer` and a
  // `SharedArrayBuffer` cannot be transferred to the main thread. At most 240 kB
  // once per mesh, against 18–305 ms of simplification.
  return { positions: packed, indices: new Uint32Array(indices) }
}

/** Surface area and axis extents, in one pass. `tools/lod/mesh.ts`'s measure, halved. */
interface Surface {
  readonly area: number
  readonly extents: readonly [number, number, number]
}

function surfaceOf(positions: Positions, indices: Indices): Surface {
  let area = 0
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]

  for (let corner = 0; corner < indices.length; corner += 3) {
    const a = (indices[corner] ?? 0) * 3
    const b = (indices[corner + 1] ?? 0) * 3
    const c = (indices[corner + 2] ?? 0) * 3
    const ax = positions[a] ?? 0
    const ay = positions[a + 1] ?? 0
    const az = positions[a + 2] ?? 0
    const bx = positions[b] ?? 0
    const by = positions[b + 1] ?? 0
    const bz = positions[b + 2] ?? 0
    const cx = positions[c] ?? 0
    const cy = positions[c + 1] ?? 0
    const cz = positions[c + 2] ?? 0

    const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay)
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az)
    const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
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

  if (indices.length === 0) return { area: 0, extents: [0, 0, 0] }
  return { area, extents: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] }
}
