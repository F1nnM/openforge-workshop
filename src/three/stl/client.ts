/**
 * Driving the parse worker from the main thread.
 *
 * One worker per viewer instance, reused across models and terminated on
 * unmount — spawning a module worker costs a few milliseconds and a parse is the
 * only thing it does, so a pool would be complexity for a viewer that shows one
 * mesh at a time.
 *
 * The buffer goes *in* by transfer and the positions come *out* by transfer, so
 * a 25 MB mesh crosses the thread boundary twice without either side allocating
 * a second copy. The price of that is real and worth stating: after
 * {@link StlParser.parse} the caller's `ArrayBuffer` is detached — `byteLength`
 * reads 0 — so this function takes ownership of what it is given. That is why
 * `loadModel.ts` reads the response body into a buffer it does not keep.
 */
import type { ParsedStl } from './parse'
import type { ParseResponse } from './protocol'
import { fromResponse, parseRequest } from './protocol'
import type { WorkerFactory } from './spawn'

export interface ParsedInWorker extends ParsedStl {
  /** Parse time measured inside the worker, in ms. */
  readonly parseMs: number
}

export class StlWorkerError extends Error {
  override readonly name = 'StlWorkerError'
  readonly kind: string

  constructor(kind: string, message: string) {
    super(message)
    this.kind = kind
  }
}

export interface StlParser {
  /** Parse one buffer. Takes ownership: the argument is detached on return. */
  parse(bytes: ArrayBuffer, signal?: AbortSignal): Promise<ParsedInWorker>
  /** Terminate the worker. Idempotent. */
  terminate(): void
}

export function createStlParser(factory: WorkerFactory): StlParser {
  let worker: Worker | null = null

  const ensure = (): Worker => {
    worker ??= factory()
    return worker
  }

  const terminate = () => {
    worker?.terminate()
    worker = null
  }

  return {
    terminate,

    parse: (bytes, signal) =>
      new Promise<ParsedInWorker>((resolve, reject) => {
        if (signal?.aborted === true) {
          reject(new StlWorkerError('aborted', 'the parse was cancelled before it started'))
          return
        }

        const active = ensure()

        const settle = () => {
          active.removeEventListener('message', onMessage)
          active.removeEventListener('error', onError)
          signal?.removeEventListener('abort', onAbort)
        }

        const onMessage = (event: MessageEvent<ParseResponse>) => {
          settle()
          const response = event.data
          if (response.type === 'failed') {
            reject(new StlWorkerError(response.kind, response.message))
            return
          }
          resolve({ ...fromResponse(response), parseMs: response.parseMs })
        }

        // A worker that dies mid-parse — an OOM inside the parse, most likely —
        // reports here and nowhere else. Without this the promise would hang and
        // the viewer would show a spinner for ever.
        const onError = (event: ErrorEvent) => {
          settle()
          terminate()
          reject(new StlWorkerError('worker-error', event.message || 'the parse worker failed'))
        }

        // Terminate rather than ignore: a cancelled parse of a 25 MB mesh is
        // still holding 18 MB and still burning a core.
        const onAbort = () => {
          settle()
          terminate()
          reject(new StlWorkerError('aborted', 'the parse was cancelled'))
        }

        active.addEventListener('message', onMessage)
        active.addEventListener('error', onError)
        signal?.addEventListener('abort', onAbort, { once: true })

        const { message, transfer } = parseRequest(bytes)
        active.postMessage(message, transfer as Transferable[])
      }),
  }
}
