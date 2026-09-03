/**
 * Types for `openscad.js`, written here rather than shipped by upstream.
 *
 * **This file is ours, not upstream's.** It is not in `MANIFEST.sha256` and it is
 * not part of the GPL-2 program — it describes the subset of Emscripten's module
 * surface that `src/generator/engine/` actually touches, so that surface is
 * type-checked instead of cast through `any`. Same arrangement as
 * `vendor/client-zip/index.d.ts`, except that client-zip's declarations came from
 * its npm tarball and these did not.
 *
 * Deliberately narrow. Emscripten's real module object has hundreds of members;
 * describing all of them would be a maintenance liability with no reader. If the
 * engine starts using another one, add it here.
 */

/** A file the module's in-memory filesystem can hold. */
export interface OpenScadFs {
  mkdir(path: string): void
  chdir(path: string): void
  writeFile(path: string, data: Uint8Array | string): void
  readFile(path: string): Uint8Array
  unlink(path: string): void
  analyzePath(path: string): { exists: boolean }
}

/** What the factory accepts. Every field is optional to Emscripten. */
export interface OpenScadModuleArg {
  /**
   * Emscripten calls `main` inside the factory unless this is set. The engine
   * always sets it: the argv is not known at boot, and a module that has already
   * run `main` has already exited its runtime.
   */
  noInitialRun: boolean
  /**
   * The `.wasm` bytes, supplied directly. Set instead of leaving the glue to
   * `fetch` them, so the caller controls the transport and can hash the bytes
   * before they reach `WebAssembly`.
   */
  wasmBinary: Uint8Array | ArrayBuffer
  /**
   * Hook that hands Emscripten an already-instantiated module. The engine uses it
   * to instantiate from one compiled `WebAssembly.Module` many times, which is the
   * whole reason the worker is long-lived. Returning `{}` is the documented way to
   * say "the exports will arrive through the callback".
   */
  instantiateWasm(
    imports: WebAssembly.Imports,
    ready: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
  ): Record<string, never>
  /** stdout, line at a time. */
  print(line: string): void
  /** stderr, line at a time. OpenSCAD puts warnings, echoes *and* `--version` here. */
  printErr(line: string): void
  /** Resolves a sibling asset by name. Unused when `wasmBinary` is supplied. */
  locateFile(path: string, prefix: string): string
  /** Keeps the runtime alive past `main`'s return. */
  noExitRuntime: boolean
}

export interface OpenScadModule {
  /**
   * Run OpenSCAD's `main` with this argv (argv[0] is prepended by the glue).
   *
   * The return value is not an exit status you can trust. Measured on this
   * release: a successful render returns `0`, `--info` returns `1` because it
   * cannot create an offscreen GL context, and `--version` returns `undefined`
   * *and throws* because OpenSCAD exits 7 and Emscripten turns that into an
   * `ExitStatus`. Read the captured output, not this.
   */
  callMain(args: readonly string[]): number | undefined
  readonly FS: OpenScadFs
}

/*
 * Deliberately absent: `wasmMemory`.
 *
 * The glue holds the linear memory in a module-local `var wasmMemory` and never
 * assigns it to the module object — checked against the 99 KB of glue, which
 * publishes only `calledRun`, `callMain`, `ENV`, `ERRNO_CODES`, `FS`, `_main`,
 * `PATH`, `postRun`, `preInit` and `preRun`. Declaring it optional here would
 * type-check a runtime check that always reads `undefined`, which is how a
 * cross-origin-isolation assertion ends up passing vacuously. The engine reads
 * the memory off the `WebAssembly.Instance` instead — see
 * `assertUnsharedMemory` in `src/generator/engine/runtime.ts`.
 */

declare const OpenSCAD: (moduleArg?: Partial<OpenScadModuleArg>) => Promise<OpenScadModule>
export default OpenSCAD
