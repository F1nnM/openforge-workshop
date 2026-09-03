/**
 * The engine worker. Long-lived, one runtime, requests served in order.
 *
 * Vite emits this as its own chunk from the `new Worker(new URL(...))` in
 * `spawn.ts`, so everything it imports — the Emscripten glue, the 35 `.scad`
 * sources, the GPL-2 notice, MD5 — lands there and nowhere near the entry
 * bundle. The 10.5 MB binary is not imported at all: it is fetched from the
 * hashed asset URL the moment the first request arrives.
 *
 * ## Why the runtime is created lazily and then kept
 *
 * Kept, because S2's **281 ms startup floor** is paid by `WebAssembly.compile`
 * and must be paid once. Lazily, because spawning the worker and compiling the
 * engine are different decisions: `client.ts` spawns on first use, and this
 * module compiles on first *request*, so a worker that is spawned speculatively
 * and never asked for anything costs a thread and no fetch.
 *
 * ## Why requests are serialised
 *
 * A render is a synchronous `callMain` that pins this thread for its whole
 * duration, so nothing overlaps in practice — but instantiation is `async`, and
 * two requests arriving together would otherwise interleave two module
 * instances, each with its own multi-hundred-megabyte linear memory, for no
 * gain. A promise chain keeps it to one. Ordering is the caller's arrival order;
 * abandonment is the client's business, and the client simply ignores a reply it
 * no longer wants — the alternative, terminating the worker, would throw away
 * the compiled module and re-pay the 281 ms.
 */
import { OUTPUT_PATH, SCHEMA_PATH, renderArgs, schemaArgs } from './args'
import { classifyOutput } from './diagnostics'
import type { EngineRequest, EngineResponse, Posted, RenderRequest, SchemaRequest, VersionRequest } from './protocol'
import { failedResponse, failureKind, renderedResponse } from './protocol'
import type { EngineRuntime } from './runtime'
import { createRuntime } from './runtime'
import { parseParameterExport } from './schema'
import { fetchEngine } from './spawn'
import { verifyGeneratedMesh } from './verify'

/**
 * The worker's own global, typed.
 *
 * `tsconfig.app.json` gives `src/` the DOM lib, so bare `self` is a `Window` and
 * its `postMessage` takes a `targetOrigin`. Adding `WebWorker` to `lib` would
 * conflict with DOM across the whole project, so this narrows locally — the same
 * arrangement `src/three/stl/worker.ts` uses, for the same reason.
 */
interface WorkerScope {
  addEventListener(type: 'message', listener: (event: MessageEvent<EngineRequest>) => void): void
  postMessage(message: unknown, transfer: Transferable[]): void
}

const scope = self as unknown as WorkerScope

/** Resolved once. A rejection is not cached: a failed fetch should be retryable. */
let pending: Promise<EngineRuntime> | null = null

async function runtime(): Promise<EngineRuntime> {
  pending ??= createRuntime({ loadEngine: () => fetchEngine() }).catch((error: unknown) => {
    pending = null
    throw error
  })
  return pending
}

/** The serialisation point. Every handler joins the tail of this chain. */
let queue: Promise<unknown> = Promise.resolve()

function enqueue(work: () => Promise<Posted<EngineResponse>>): void {
  queue = queue.then(work).then(
    ({ message, transfer }) => {
      scope.postMessage(message, transfer as Transferable[])
    },
    // Unreachable: every handler already converts its own failures into a
    // `failed` reply. Kept because a throw escaping here would break the chain
    // and silently stall every subsequent request.
    (error: unknown) => {
      scope.postMessage(failedResponse(-1, 'internal', error).message, [])
    },
  )
}

scope.addEventListener('message', (event) => {
  const request = event.data
  switch (request.type) {
    case 'version':
      enqueue(() => handleVersion(request))
      return
    case 'schema':
      enqueue(() => handleSchema(request))
      return
    case 'render':
      enqueue(() => handleRender(request))
      return
  }
})

async function handleVersion(request: VersionRequest): Promise<Posted<EngineResponse>> {
  try {
    const engine = await runtime()
    return {
      message: { type: 'version', id: request.id, version: await engine.version(), compileMs: engine.compileMs },
      transfer: [],
    }
  } catch (error) {
    return failedResponse(request.id, failureKind(error), error)
  }
}

async function handleSchema(request: SchemaRequest): Promise<Posted<EngineResponse>> {
  try {
    const engine = await runtime()
    const result = await engine.run(schemaArgs(request.entry), [SCHEMA_PATH])
    const diagnostics = classifyOutput(result.output)
    const exported = result.outputs.get(SCHEMA_PATH)
    if (exported === undefined) {
      return failedResponse(
        request.id,
        'geometry',
        new Error(
          `${request.entry}: OpenSCAD wrote no parameter export. ` +
            (result.threw ?? `callMain returned ${String(result.status)}`),
        ),
        diagnostics,
      )
    }
    const schema = parseParameterExport(new TextDecoder().decode(exported), request.entry)
    return { message: { type: 'schema', id: request.id, schema, diagnostics, renderMs: result.runMs }, transfer: [] }
  } catch (error) {
    return failedResponse(request.id, failureKind(error), error)
  }
}

async function handleRender(request: RenderRequest): Promise<Posted<EngineResponse>> {
  try {
    const engine = await runtime()
    const argv = renderArgs(
      request.format === undefined
        ? { entry: request.entry, parameters: request.parameters }
        : { entry: request.entry, parameters: request.parameters, format: request.format },
    )
    const result = await engine.run(argv, [OUTPUT_PATH])
    const diagnostics = classifyOutput(result.output)
    const mesh = result.outputs.get(OUTPUT_PATH)

    // No mesh is the documented refusal path, not an exception. S1 recorded that
    // `bases-*.scad` echo an `ERROR:` and emit nothing when `dragonlock` or
    // `infinitylock` meets a non-inch `SQUARE_BASIS`, and OpenSCAD still exits
    // zero. The diagnostics ride along so the reason reaches the panel.
    if (mesh === undefined || mesh.length === 0) {
      const reason = diagnostics.notable.find((entry) => entry.kind === 'error')?.text
      return failedResponse(
        request.id,
        'geometry',
        new Error(
          reason ??
            `${request.entry}: OpenSCAD produced no geometry. ` +
              (result.threw ?? `callMain returned ${String(result.status)}`),
        ),
        diagnostics,
      )
    }

    const verification = verifyGeneratedMesh(mesh, request.expectedMd5)
    return renderedResponse(request.id, mesh, {
      md5: verification.md5,
      verification,
      diagnostics,
      renderMs: result.runMs,
      bootMs: result.bootMs,
      runs: engine.runs,
    })
  } catch (error) {
    return failedResponse(request.id, failureKind(error), error)
  }
}
