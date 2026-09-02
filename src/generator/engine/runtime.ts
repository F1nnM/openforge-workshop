/**
 * The engine itself: compile once, instantiate per render.
 *
 * ## Why "long-lived" cannot mean "one instance"
 *
 * S2 measured a **281 ms startup floor** on WASM against 28 ms native, and
 * observed that this is *"65–80% of a small render"* — so a per-render process
 * spends most of its life getting ready. Its conclusion was that *"a worker
 * holding a compiled `WebAssembly.Module` pays it once"*, and that is what this
 * module does.
 *
 * The obvious next step — keep one Emscripten instance and call `main` again —
 * does not work, and it fails in the worst available way. Measured on the
 * vendored release, with and without `noExitRuntime`:
 *
 * | | first `callMain` | second `callMain` |
 * | --- | --- | --- |
 * | `noExitRuntime: false` | 109 ms, returns `0` | **0.1 ms, throws `program has already aborted!`** |
 * | `noExitRuntime: true` | 111 ms, returns `0` | **0.3 ms, throws `1839784`** |
 *
 * OpenSCAD's `main` is not re-entrant under Emscripten: the runtime has exited,
 * or the C++ statics are spent, and either way the second call is refused. The
 * trap is what remains on the filesystem afterwards: **`out.stl` from the first
 * render is still there**, so a driver that reads the output path without
 * checking whether the run happened returns the *previous* mesh, at the right
 * byte length, with no error. A parameter change would appear to have no effect.
 *
 * Two consequences, both enforced below. Every run gets a fresh instance — which
 * costs **5–8 ms** on a quiet machine and 9–11 ms with twelve test workers
 * competing, against **28–38 ms** for a boot that has to compile its own module.
 * And {@link EngineRuntime.run} unlinks every output path *before* running, so a
 * stale read is not merely unlikely but impossible.
 *
 * **S2's 281 ms is a *process* floor, not a compile, and conflating the two cost
 * two rows.** `WebAssembly.compile` of this 10.5 MB module is only **16.5–18.5 ms**
 * of it on V8; the rest is the process, the instantiation and OpenSCAD's own
 * start-up. An earlier version of this docblock read "281 ms for a fresh
 * compile", and `render.test.ts` asserted `bootMs < compileMs` on the strength of
 * it — believing it had an order of magnitude of margin when it had 2.5×, which
 * made it a race that failed 1 of 4 whole-suite runs. The corrected numbers are
 * above and the assertion is now against a boot that actually compiles.
 *
 * ## What is shared, and what a shared thing has to be
 *
 * One `WebAssembly.Module`, compiled from bytes whose SHA-256 was checked first.
 * A compiled module is immutable and structured-cloneable; the linear memory
 * belongs to the *instance*, not the module, so instances share no state. That
 * is why this is safe where reusing an instance is not.
 *
 * ## Cross-origin isolation is not required, and that is asserted
 *
 * The plan says *"Every shipped openscad-wasm build is single-threaded with
 * unshared linear memory… Do not set COOP/COEP on the Workshop."* Verified on
 * the vendored binary three ways: the module declares **one memory, in-module,
 * `flags=0x01`** — `has_max` set, **shared bit clear**, none imported; the glue
 * contains **zero** occurrences of `SharedArrayBuffer`, `pthread`, `Atomics`,
 * `ENVIRONMENT_IS_PTHREAD` or `new WebAssembly.Memory`; and `--info` reports
 * `Emscripten 4.0.10 #1 wasm32 1 CPU`. {@link assertUnsharedMemory} re-checks
 * the live instance, because a claim about a binary is worth more when the code
 * that depends on it will not run against a binary that breaks it.
 */
import OpenSCAD from '../../../vendor/openscad-wasm/openscad.js'
import type { OpenScadModule } from '../../../vendor/openscad-wasm/openscad.js'

import { assertManifoldBackend } from './args'
import { assertNoticePresent } from './licence'
import { assertEngineIntegrity } from './verify'
import type { EngineVersion } from './version'
import { parseVersion } from './version'
import { SCAD_SOURCES } from './vfs'

/** Where the sources and the output live inside the engine's filesystem. */
const WORK_DIR = '/work'

export interface RunResult {
  /**
   * What `callMain` returned. **Not an exit status to branch on** — see
   * `version.ts` for the measured table. Carried for diagnostics only.
   */
  readonly status: number | undefined
  /** The message, if `callMain` threw. Emscripten's `ExitStatus` arrives here. */
  readonly threw: string | null
  /** stdout and stderr, interleaved in print order. */
  readonly output: readonly string[]
  /** The requested output files that existed after the run. */
  readonly outputs: ReadonlyMap<string, Uint8Array>
  /** Wall clock inside `callMain`, in ms. Excludes instantiation. */
  readonly runMs: number
  /** Wall clock for the fresh instance, in ms. The per-render fixed cost. */
  readonly bootMs: number
}

export interface EngineRuntime {
  /**
   * How long `WebAssembly.compile` took. Paid once, for the worker's lifetime.
   *
   * **16.5–18.5 ms** for this module on V8 — a small part of S2's 281 ms process
   * floor rather than the whole of it. Diagnostic only: it is not a budget for
   * what reuse saves, and reading it as one is the mistake the docblock above
   * records.
   */
  readonly compileMs: number
  /** How many renders this runtime has served. The reuse claim, as a number. */
  readonly runs: number
  /** Read from the engine, not from a constant. */
  version(): Promise<EngineVersion>
  /**
   * Run one argv. Throws `EngineArgsError` before booting anything if the argv
   * does not select Manifold.
   *
   * @param outputs Paths inside {@link WORK_DIR}, relative. Unlinked before the
   *   run and read after it.
   */
  run(argv: readonly string[], outputs: readonly string[]): Promise<RunResult>
}

export interface RuntimeOptions {
  /**
   * Supplies the `.wasm` bytes. Injected rather than fetched here so this module
   * is drivable from a test with no network and no bundler URL: the worker
   * fetches the build asset, a test reads the vendored file.
   */
  readonly loadEngine: () => Promise<Uint8Array>
  /** Overridable clock, so timings are assertable. */
  readonly now?: () => number
}

export class EngineRuntimeError extends Error {
  override readonly name = 'EngineRuntimeError'
}

/**
 * Compile the engine and return a runtime that reuses it.
 *
 * Everything that can be checked once is checked here, before any render: the
 * binary's SHA-256, the licence notice, and — after the first instance exists —
 * that its memory is unshared.
 */
export async function createRuntime(options: RuntimeOptions): Promise<EngineRuntime> {
  const now = options.now ?? (() => performance.now())

  assertNoticePresent()

  const bytes = await options.loadEngine()
  await assertEngineIntegrity(bytes)

  const compileStarted = now()
  const compiled = await WebAssembly.compile(bytes as unknown as BufferSource)
  const compileMs = now() - compileStarted

  let runs = 0
  let memoryChecked = false

  const instantiate = async (): Promise<{ module: OpenScadModule; output: string[] }> => {
    const output: string[] = []
    // Held rather than thrown from inside the callback: a throw there would
    // reject a promise Emscripten does not observe, `ready` would never be
    // called, and the factory below would hang for ever instead of failing.
    //
    // An array rather than a `let`, because TypeScript does not track
    // assignments made inside a callback: a nullable local would narrow to
    // `null` at the `throw` below and be rejected as throwing a non-error.
    const refusal: Error[] = []
    const module = await OpenSCAD({
      noInitialRun: true,
      print: (line) => output.push(line),
      printErr: (line) => output.push(line),
      // The whole point. Emscripten would otherwise re-decode and re-compile the
      // 10.5 MB binary for every instance.
      instantiateWasm: (imports, ready) => {
        void WebAssembly.instantiate(compiled, imports).then((instance) => {
          // Checked here rather than after boot, because this is the only place
          // the `WebAssembly.Instance` is visible: Emscripten keeps the memory
          // in a module-local and publishes nothing.
          try {
            if (!memoryChecked) {
              assertUnsharedMemory(compiled, instance)
              memoryChecked = true
            }
          } catch (error) {
            // Only `assertUnsharedMemory` throws in here, and it throws an
            // `EngineRuntimeError`; the fallback keeps the type honest anyway.
            refusal.push(error instanceof Error ? error : new EngineRuntimeError(String(error)))
          }
          ready(instance, compiled)
        })
        return {}
      },
    })
    const refused = refusal[0]
    if (refused !== undefined) throw refused
    return { module, output }
  }

  return {
    compileMs,
    get runs() {
      return runs
    },

    async version(): Promise<EngineVersion> {
      // `--info` rather than `--version`: it reports the source commit as well,
      // and both are equally untrustworthy on status, so there is no reason to
      // prefer the one that says less.
      const { module, output } = await instantiate()
      try {
        module.callMain(['--info'])
      } catch {
        // Expected. `--info` returns 1 and `--version` throws; the text is
        // already in `output` either way, which is the only signal that counts.
      }
      return parseVersion(output)
    },

    async run(argv, outputs): Promise<RunResult> {
      assertManifoldBackend(argv)

      const bootStarted = now()
      const { module, output } = await instantiate()
      const bootMs = now() - bootStarted

      module.FS.mkdir(WORK_DIR)
      module.FS.chdir(WORK_DIR)
      for (const [name, source] of SCAD_SOURCES) module.FS.writeFile(name, source)

      // A fresh instance has a fresh filesystem, so this cannot currently find
      // anything — and it stays because the failure it prevents is invisible. If
      // an instance is ever reused, or a caller passes an output path that is
      // also a source name, reading a leftover file would return the wrong mesh
      // at a plausible length with no error at all.
      for (const name of outputs) {
        if (module.FS.analyzePath(`${WORK_DIR}/${name}`).exists) module.FS.unlink(`${WORK_DIR}/${name}`)
      }

      const runStarted = now()
      let status: number | undefined
      let threw: string | null = null
      try {
        status = module.callMain(argv)
      } catch (error) {
        threw = error instanceof Error ? error.message : String(error)
      }
      const runMs = now() - runStarted

      const produced = new Map<string, Uint8Array>()
      for (const name of outputs) {
        const path = `${WORK_DIR}/${name}`
        if (module.FS.analyzePath(path).exists) produced.set(name, module.FS.readFile(path))
      }

      runs += 1
      return { status, threw, output, outputs: produced, runMs, bootMs }
    },
  }
}

/**
 * Refuse an engine whose memory is shared.
 *
 * A `SharedArrayBuffer` is the only thing that would make this app need COOP and
 * COEP, and cross-origin isolation would break the catalog outright: the plan's
 * B6 exists because without `Cross-Origin-Resource-Policy: cross-origin` on the
 * bucket, *"the whole catalog is blocked on day one if anything ever forces
 * cross-origin isolation"*. So an engine with shared memory is not a
 * configuration to accommodate — it is one to reject at boot, before any header
 * decision has been made on its behalf.
 *
 * The check reads the WebAssembly objects rather than anything Emscripten
 * exposes, because Emscripten exposes nothing useful here: `wasmMemory` is a
 * module-local `var` in the glue and is *not* published on the module object.
 * A check written against `Module.wasmMemory` reads `undefined` and either
 * throws on every boot or — worse, if it treats absence as fine — passes
 * vacuously for ever.
 *
 * Two facts, both from the binary as instantiated:
 *
 * 1. **No memory is imported.** 153 imports, none of kind `memory`, so there is
 *    no seam through which a host could hand this module a shared heap.
 * 2. **The exported memory's buffer is a plain `ArrayBuffer`.** The module
 *    defines and exports one memory (under the minified name `Tb`), and a shared
 *    memory's `buffer` is a `SharedArrayBuffer` — so this distinguishes them
 *    directly rather than by reading a flag byte.
 */
export function assertUnsharedMemory(module: WebAssembly.Module, instance: WebAssembly.Instance): void {
  const imported = WebAssembly.Module.imports(module).filter((entry) => entry.kind === 'memory')
  if (imported.length > 0) {
    throw new EngineRuntimeError(
      `the engine imports its memory (${imported.map((entry) => `${entry.module}.${entry.name}`).join(', ')}), ` +
        'so the host decides whether it is shared. This app must be able to guarantee it is not.',
    )
  }

  const memories = Object.values(instance.exports).filter(
    (value): value is WebAssembly.Memory => value instanceof WebAssembly.Memory,
  )
  if (memories.length === 0) {
    throw new EngineRuntimeError('the engine exports no memory, so it cannot be checked for sharing')
  }
  for (const memory of memories) {
    if (typeof SharedArrayBuffer !== 'undefined' && memory.buffer instanceof SharedArrayBuffer) {
      throw new EngineRuntimeError(
        'the engine has shared linear memory, which needs COOP/COEP. This app must not set them: ' +
          'cross-origin isolation blocks the catalog bucket. Vendor a single-threaded build.',
      )
    }
  }
}
