/**
 * One mesh, parsed and measured off the main thread.
 *
 * ## Why a thread at all
 *
 * `analyseHost` voxel-columns the mesh at 0.5 mm and casts through it; the
 * corpus's median object is 10 MB and its largest is 109 MB, so a single parse
 * plus analysis is hundreds of milliseconds to seconds of pure computation with
 * no `await` in it. On the main thread that stalls the fetch loop — the socket
 * sits idle while a `Float32Array` is being scanned — and the run degrades to
 * strictly serial download-then-compute. Threads let the next objects be in
 * flight while this one is measured, which is the whole reason the run is
 * bounded by the link rather than by the CPU.
 *
 * ## The bytes arrive transferred, not copied
 *
 * `run.ts` posts the `ArrayBuffer` in the transfer list, so this thread takes
 * ownership of the buffer the fetch produced and no second copy of a 109 MB mesh
 * is ever made. That is also why the parent must not touch the buffer
 * afterwards; it is detached there.
 *
 * ## It never throws at the parent
 *
 * A malformed mesh is a finding about the corpus, not a reason to lose the
 * thread and the seven other jobs its pool would have run. Every failure comes
 * back as `{ id, error }` and becomes a `failed` line in the log.
 *
 * Spawned as `new Worker(new URL('./worker.ts', import.meta.url), { execArgv:
 * ['--import', 'tsx'] })` from a parent already running under `tsx`. Verified on
 * the pinned Node (v22.23.2): that flag form loads this file and its
 * extensionless `src/` imports, so tsx's alternative recipes are not needed.
 */
import { parentPort } from 'node:worker_threads'

import type { Footprint } from '../../src/catalog'
import { parseStl } from '../../src/three/stl/parse'

import type { HostMeasurement, HostSlot, InsertMeasurement } from './classify'
import { analyseHost, analyseInsert } from './classify'

/** One job. `id` correlates the answer; `bytes` is the transferred STL. */
export interface MeasureRequest {
  readonly id: number
  readonly kind: 'host' | 'insert'
  readonly bytes: ArrayBuffer
  readonly foot: Footprint
  readonly slots: readonly HostSlot[]
  /** A host that is also an insert: measure the anchor from the same parse. */
  readonly alsoInsert: boolean
}

/** The answer to one job. Exactly one of `error` / the measurements is set. */
export interface MeasureResponse {
  readonly id: number
  readonly triangles?: number
  readonly host?: HostMeasurement
  readonly insert?: InsertMeasurement
  readonly error?: string
}

/** Parse and measure. Pure; the handler below is the only caller. */
function measure(request: MeasureRequest): MeasureResponse {
  const { positions, triangles } = parseStl(new Uint8Array(request.bytes))
  const host =
    request.kind === 'host'
      ? analyseHost({ foot: request.foot, slots: request.slots }, positions, triangles)
      : undefined
  const insert =
    request.kind === 'insert' || request.alsoInsert ? analyseInsert(positions, triangles) : undefined
  return {
    id: request.id,
    triangles,
    ...(host === undefined ? {} : { host }),
    ...(insert === undefined ? {} : { insert }),
  }
}

parentPort?.on('message', (request: MeasureRequest) => {
  try {
    parentPort?.postMessage(measure(request))
  } catch (error) {
    const response: MeasureResponse = {
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
    }
    parentPort?.postMessage(response)
  }
})
