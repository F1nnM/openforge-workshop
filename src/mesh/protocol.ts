/**
 * The conversion worker's protocol, as data — and the transfer list as a return
 * value.
 *
 * Modelled on `src/three/stl/protocol.ts`, for its reason: **the typed arrays
 * must be transferred, not copied.** `postMessage(message)` without a transfer
 * list structured-clones every buffer, which for the corpus's median mesh is an
 * extra 12.9 MB allocated and memcpy'd on the *receiving* thread — invisible,
 * because the app works and merely stutters. So it is asserted rather than
 * assumed: `protocol.test.ts` checks the source buffer is detached afterwards,
 * which is the only observable difference between a transfer and a copy.
 *
 * ## Why this is a second protocol and not an extension of the viewer's
 *
 * `src/three/stl/` already runs an STL parse in a worker, and `parse.ts` — the
 * part with the corpus knowledge in it, both encodings, the `84 + 50n`
 * detection, the non-finite compaction — **is reused verbatim** by `convert.ts`.
 * What is not reused is the message layer, for two reasons that are about cost
 * rather than taste:
 *
 *   1. **The replies are different values.** The viewer's worker returns a
 *      non-indexed `Float32Array` of positions, deliberately: `src/three/geometry.ts`
 *      wants flat shading off a triangle soup. This one returns a welded,
 *      indexed, decimated mesh with a weld report and a fidelity measurement
 *      attached. A single response type would be a union whose every consumer
 *      narrows it.
 *   2. **The worker chunks carry different code.** This worker imports
 *      `meshoptimizer/simplifier` — 55 kB of wasm-bearing JS. Folding the
 *      conversion into the viewer's worker would put the simplifier in the chunk
 *      the detail viewer spawns to look at one mesh, which never simplifies
 *      anything.
 *
 * So: one parser, two workers. That is the trade, stated where it can be
 * argued with.
 */
import type { StlFormat } from '@/three/stl/parse'

import type { WeldReport } from './weld'

/** Main thread → worker. The buffer is transferred in, so the caller loses it. */
export interface ConvertRequest {
  readonly type: 'convert'
  /** The content address, echoed back so a reply can be matched to a request. */
  readonly blob: string
  /** The STL bytes. Transferred, so this is the last reference the sender has. */
  readonly bytes: ArrayBuffer
}

/** Worker → main thread, on success. */
export interface ConvertedResponse {
  readonly type: 'converted'
  readonly blob: string
  readonly positions: Float32Array<ArrayBuffer>
  /**
   * Triangle indices, **narrowed to 16 bits when the mesh fits**.
   *
   * Every in-band LOD does fit: the ceiling is 20,000 triangles over ~10,000
   * welded vertices, and `src/builder/three/lod.ts`'s budget is computed against
   * a two-byte index for exactly that reason. Narrowing here rather than at the
   * cache halves the index in the message, in IndexedDB and in the GPU buffer —
   * measured on the starter set, 87.9 kB per mesh becomes 57.9 kB.
   */
  readonly indices: Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>
  readonly triangles: number
  readonly vertices: number
  readonly sourceTriangles: number
  readonly sourceBytes: number
  readonly format: StlFormat
  readonly droppedTriangles: number
  readonly weld: WeldReport
  readonly target: number
  readonly passThrough: boolean
  readonly attempts: number
  readonly areaError: number
  readonly extentError: number
  readonly parseMs: number
  readonly weldMs: number
  readonly simplifyMs: number
  /** Wall clock inside the worker, end to end. */
  readonly totalMs: number
}

/** Worker → main thread, on bytes it could not convert. */
export interface ConvertFailedResponse {
  readonly type: 'convert-failed'
  readonly blob: string
  /**
   * The error's own `name`, so the caller can tell the four apart without
   * matching on a message: `StlParseError`, `WeldNoOpError`, `EmptyMeshError`,
   * `TargetMissedError`, `SimplifierUnavailableError`.
   */
  readonly kind: string
  readonly message: string
}

export type ConvertResponse = ConvertedResponse | ConvertFailedResponse

/** A message plus the transfer list it must be posted with. */
export interface Posted<T> {
  readonly message: T
  readonly transfer: readonly Transferable[]
}

/** Build the request. The buffer rides in the transfer list, so nothing is copied. */
export function convertRequest(blob: string, bytes: ArrayBuffer): Posted<ConvertRequest> {
  return { message: { type: 'convert', blob, bytes }, transfer: [bytes] }
}

/** Narrow an index array to 16 bits when the vertex count allows it. */
export function narrowIndices(
  indices: Uint32Array<ArrayBuffer>,
  vertices: number,
): Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer> {
  if (vertices > 0x1_0000) return indices
  return new Uint16Array(indices)
}

/** Build the success reply, transferring both arrays out of the worker. */
export function convertedResponse(
  blob: string,
  mesh: {
    readonly positions: Float32Array<ArrayBuffer>
    readonly indices: Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>
    readonly triangles: number
    readonly vertices: number
    readonly sourceTriangles: number
    readonly sourceBytes: number
    readonly format: StlFormat
    readonly droppedTriangles: number
    readonly weld: WeldReport
    readonly target: number
    readonly passThrough: boolean
    readonly attempts: number
    readonly areaError: number
    readonly extentError: number
    readonly timing: { readonly parseMs: number; readonly weldMs: number; readonly simplifyMs: number }
  },
  totalMs: number,
): Posted<ConvertedResponse> {
  return {
    message: {
      type: 'converted',
      blob,
      positions: mesh.positions,
      indices: mesh.indices,
      triangles: mesh.triangles,
      vertices: mesh.vertices,
      sourceTriangles: mesh.sourceTriangles,
      sourceBytes: mesh.sourceBytes,
      format: mesh.format,
      droppedTriangles: mesh.droppedTriangles,
      weld: mesh.weld,
      target: mesh.target,
      passThrough: mesh.passThrough,
      attempts: mesh.attempts,
      areaError: mesh.areaError,
      extentError: mesh.extentError,
      parseMs: mesh.timing.parseMs,
      weldMs: mesh.timing.weldMs,
      simplifyMs: mesh.timing.simplifyMs,
      totalMs,
    },
    transfer: [mesh.positions.buffer, mesh.indices.buffer],
  }
}

/** Build the failure reply. Nothing to transfer. */
export function convertFailedResponse(blob: string, error: unknown): Posted<ConvertFailedResponse> {
  const kind = error instanceof Error ? error.name : 'unknown'
  const message = error instanceof Error ? error.message : String(error)
  return { message: { type: 'convert-failed', blob, kind, message }, transfer: [] }
}
