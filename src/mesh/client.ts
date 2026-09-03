/**
 * Driving the conversion worker from the main thread.
 *
 * One worker, reused across meshes, spawned on the first conversion and
 * terminated when the queue goes idle. Not a pool, and the reason is measured
 * rather than assumed: at the throughput measured against this bucket (5.82 MB/s
 * cold, 7.65–9.22 MB/s warm, inside W1's 3.4–11.4 MB/s single-stream range) the
 * corpus's median mesh takes **1.2–1.9 s to arrive and 134 ms to convert**. Over
 * the whole starter set that is 8.4 s of download against 1.08 s of conversion,
 * so the CPU is idle 87% of the time this queue is running and a second core
 * would shorten the add by well under a second while doubling the resident wasm
 * heap. The network is the constraint; `queue.ts` parallelises *that*.
 *
 * The buffer goes in by transfer and both arrays come out by transfer, so a
 * 24 MB mesh crosses the thread boundary without either side allocating a second
 * copy. The price is real and is the same one `src/three/stl/client.ts` pays:
 * after {@link MeshConverter.convert} the caller's `ArrayBuffer` is detached —
 * `byteLength` reads 0 — so this takes ownership of what it is given.
 *
 * ## One request in flight, and why that is enforced here
 *
 * A worker has one `onmessage`, so two overlapping requests would race for the
 * same reply and the second caller could resolve with the first mesh. The
 * viewer's client avoids this by construction — it shows one mesh at a time.
 * This one is called from a queue with concurrency, so it serialises: each
 * `convert` chains onto the previous one's settlement. The reply carries the
 * blob it answers, and a mismatched reply rejects rather than resolving with the
 * wrong geometry, which is the assertion that makes the serialisation
 * falsifiable rather than merely intended.
 */
import type { ConvertResponse, ConvertedResponse } from './protocol'
import { convertRequest } from './protocol'
import type { WorkerFactory } from './spawn'

/** A conversion the worker refused, with the reason categorised. */
export class MeshConvertError extends Error {
  override readonly name = 'MeshConvertError'
  /** The originating error's `name` — `WeldNoOpError`, `StlParseError`, … */
  readonly kind: string
  readonly blob: string

  constructor(blob: string, kind: string, message: string) {
    super(message)
    this.kind = kind
    this.blob = blob
  }
}

export interface MeshConverter {
  /** Convert one STL. Takes ownership: the argument is detached on return. */
  convert(blob: string, bytes: ArrayBuffer, signal?: AbortSignal): Promise<ConvertedResponse>
  /** Terminate the worker. Idempotent. */
  terminate(): void
}

export function createMeshConverter(factory: WorkerFactory): MeshConverter {
  let worker: Worker | null = null
  // The tail of the serialisation chain. Settled, never rejected — a failed
  // conversion must not poison the queue behind it.
  let tail: Promise<void> = Promise.resolve()

  const ensure = (): Worker => {
    worker ??= factory()
    return worker
  }

  const terminate = () => {
    worker?.terminate()
    worker = null
  }

  const run = (blob: string, bytes: ArrayBuffer, signal?: AbortSignal): Promise<ConvertedResponse> =>
    new Promise<ConvertedResponse>((resolve, reject) => {
      if (signal?.aborted === true) {
        reject(new MeshConvertError(blob, 'aborted', 'the conversion was cancelled before it started'))
        return
      }

      const active = ensure()

      const settle = () => {
        active.removeEventListener('message', onMessage)
        active.removeEventListener('error', onError)
        signal?.removeEventListener('abort', onAbort)
      }

      const onMessage = (event: MessageEvent<ConvertResponse>) => {
        const response = event.data
        // A reply for a different blob means the serialisation is broken. Reject
        // rather than resolve: handing back somebody else's geometry under this
        // md5 would put the wrong mesh in the cache under a content address,
        // which is the one thing a content-addressed cache may never do.
        if (response.blob !== blob) {
          settle()
          terminate()
          reject(
            new MeshConvertError(
              blob,
              'protocol',
              `the worker replied about ${response.blob} while ${blob} was in flight`,
            ),
          )
          return
        }
        settle()
        if (response.type === 'convert-failed') {
          reject(new MeshConvertError(blob, response.kind, response.message))
          return
        }
        resolve(response)
      }

      // A worker that dies mid-conversion — an OOM inside the weld, most likely
      // — reports here and nowhere else. Without this the promise would hang.
      const onError = (event: ErrorEvent) => {
        settle()
        terminate()
        reject(new MeshConvertError(blob, 'worker-error', event.message || 'the conversion worker failed'))
      }

      // Terminate rather than ignore: a cancelled conversion of a 24 MB mesh is
      // still holding its welded copy and still burning a core.
      const onAbort = () => {
        settle()
        terminate()
        reject(new MeshConvertError(blob, 'aborted', 'the conversion was cancelled'))
      }

      active.addEventListener('message', onMessage)
      active.addEventListener('error', onError)
      signal?.addEventListener('abort', onAbort, { once: true })

      const { message, transfer } = convertRequest(blob, bytes)
      active.postMessage(message, transfer as Transferable[])
    })

  return {
    terminate,

    convert: (blob, bytes, signal) => {
      const started = tail.then(() => run(blob, bytes, signal))
      tail = started.then(
        () => undefined,
        () => undefined,
      )
      return started
    },
  }
}
