/**
 * Driving the engine worker from the main thread.
 *
 * One worker for the app's lifetime, not one per render. That is the whole point
 * of the row: S2 measured a **281 ms startup floor** and observed it is *"65–80%
 * of a small render"*, so a worker that is torn down between renders turns a
 * ~100 ms operation into a ~380 ms one and does it every time.
 *
 * ## Abandonment does not terminate the worker
 *
 * A render already inside `callMain` cannot be interrupted: it is synchronous
 * WebAssembly, and the only way to stop it is to kill the thread. So
 * {@link GeneratorEngine.render}'s `signal` **abandons** rather than cancels —
 * the promise rejects immediately, the worker finishes the render, and the reply
 * is dropped on arrival because no handler is registered for its id.
 *
 * That is the right trade for these numbers. A 4×4 render measured through this
 * path is ~100 ms; letting one finish unwatched wastes 100 ms of one background
 * thread. Terminating the worker would instead discard the compiled
 * `WebAssembly.Module` and charge the *next* render the full compile. Auto-preview
 * types quickly, so the abandoning case is the common one.
 *
 * {@link GeneratorEngine.terminate} exists for the case that actually wants it —
 * the panel unmounting — and is idempotent.
 */
import type { ExportFormat, ParameterAssignment } from './args'
import type { Diagnostics } from './diagnostics'
import type {
  EngineFailure,
  EngineRequest,
  EngineResponse,
  RenderedResponse,
  RequestId,
  SchemaResponse,
  VersionResponse,
} from './protocol'
import type { ParameterSchema } from './schema'
import type { EngineWorkerFactory } from './spawn'
import type { Verification } from './verify'
import type { EngineVersion } from './version'

export class EngineError extends Error {
  override readonly name = 'EngineError'
  readonly kind: EngineFailure
  /** What the engine printed, when it got far enough to print anything. */
  readonly diagnostics: Diagnostics | null

  constructor(kind: EngineFailure, message: string, diagnostics: Diagnostics | null = null) {
    super(message)
    this.kind = kind
    this.diagnostics = diagnostics
  }
}

/** One rendered mesh, plus what is known about it. */
export interface GeneratedMesh {
  /** Binary STL, unless another `format` was asked for. */
  readonly bytes: Uint8Array
  readonly md5: string
  readonly verification: Verification
  readonly diagnostics: Diagnostics
  /** Time inside OpenSCAD's `main`, ms. */
  readonly renderMs: number
  /** Time to instantiate a fresh module from the cached compile, ms. */
  readonly bootMs: number
  /**
   * Renders this worker has served. **`> 1` is the evidence that the compiled
   * module is being reused** — the second render never re-pays the compile — so
   * it is surfaced rather than kept internal.
   */
  readonly runs: number
}

export interface RenderOptions {
  readonly entry: string
  readonly parameters: Readonly<Record<string, ParameterAssignment>>
  readonly format?: ExportFormat
  /** The catalogued MD5 to check against, when S4's resolver found one. */
  readonly expectedMd5?: string
  /** Abandons the render. See the note above: it does not stop the engine. */
  readonly signal?: AbortSignal
}

export interface GeneratorEngine {
  /** The engine's own version and source commit, read from the binary. */
  version(): Promise<{ version: EngineVersion; compileMs: number }>
  /** One entry point's parameter schema, from `--export-format=param`. */
  schema(entry: string, signal?: AbortSignal): Promise<{ schema: ParameterSchema; renderMs: number }>
  render(options: RenderOptions): Promise<GeneratedMesh>
  /** Terminate the worker. Idempotent. Discards the compiled module. */
  terminate(): void
}

export function createEngine(factory: EngineWorkerFactory): GeneratorEngine {
  let worker: Worker | null = null
  let nextId: RequestId = 1

  /** Handlers by request id. A reply with no handler was abandoned; drop it. */
  const waiting = new Map<RequestId, (response: EngineResponse) => void>()

  const onMessage = (event: MessageEvent<EngineResponse>) => {
    waiting.get(event.data.id)?.(event.data)
  }

  /**
   * A worker that dies mid-request reports here and nowhere else. Without this
   * every in-flight promise would hang, and the panel would spin for ever.
   */
  const onError = (event: ErrorEvent) => {
    const failure: EngineResponse = {
      type: 'failed',
      id: -1,
      kind: 'internal',
      message: event.message || 'the OpenSCAD worker failed',
    }
    for (const settle of [...waiting.values()]) settle(failure)
    waiting.clear()
    terminate()
  }

  const ensure = (): Worker => {
    if (worker === null) {
      worker = factory()
      worker.addEventListener('message', onMessage)
      worker.addEventListener('error', onError)
    }
    return worker
  }

  function terminate(): void {
    worker?.terminate()
    worker = null
  }

  function send<T extends EngineResponse>(
    build: (id: RequestId) => EngineRequest,
    signal: AbortSignal | undefined,
    accept: T['type'],
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted === true) {
        reject(new EngineError('aborted', 'the request was abandoned before it was sent'))
        return
      }

      const id = nextId
      nextId += 1

      const done = () => {
        waiting.delete(id)
        signal?.removeEventListener('abort', onAbort)
      }

      const onAbort = () => {
        done()
        reject(new EngineError('aborted', 'the request was abandoned'))
      }

      waiting.set(id, (response) => {
        done()
        if (response.type === 'failed') {
          reject(new EngineError(response.kind, response.message, response.diagnostics ?? null))
          return
        }
        if (response.type !== accept) {
          reject(new EngineError('internal', `expected a ${accept} reply, got ${response.type}`))
          return
        }
        resolve(response as T)
      })

      signal?.addEventListener('abort', onAbort, { once: true })
      ensure().postMessage(build(id))
    })
  }

  return {
    terminate,

    async version() {
      const reply = await send<VersionResponse>((id) => ({ type: 'version', id }), undefined, 'version')
      return { version: reply.version, compileMs: reply.compileMs }
    },

    async schema(entry, signal) {
      const reply = await send<SchemaResponse>((id) => ({ type: 'schema', id, entry }), signal, 'schema')
      return { schema: reply.schema, renderMs: reply.renderMs }
    },

    async render(options) {
      const reply = await send<RenderedResponse>(
        (id) => ({
          type: 'render',
          id,
          entry: options.entry,
          parameters: options.parameters,
          ...(options.format === undefined ? {} : { format: options.format }),
          ...(options.expectedMd5 === undefined ? {} : { expectedMd5: options.expectedMd5 }),
        }),
        options.signal,
        'rendered',
      )
      return {
        bytes: new Uint8Array(reply.mesh),
        md5: reply.md5,
        verification: reply.verification,
        diagnostics: reply.diagnostics,
        renderMs: reply.renderMs,
        bootMs: reply.bootMs,
        runs: reply.runs,
      }
    },
  }
}
