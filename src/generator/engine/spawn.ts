/**
 * The one line that names the worker file, and the one that names the binary.
 *
 * Both are **build instructions**, not runtime expressions. Vite rewrites
 * `new Worker(new URL('./worker.ts', import.meta.url))` into a reference to a
 * separately-emitted worker chunk, and `?url` on the binary into a hashed asset
 * path. Neither can be computed, so neither can be a variable.
 *
 * Separate from `client.ts` for the reason `src/three/stl/spawn.ts` gives: that
 * module stays importable from a Node test which supplies its own fake worker.
 * A test has no business evaluating a chunk reference.
 *
 * ## The asset URL is why this row costs the eager bundle nothing
 *
 * `?url` yields a string. The 10.5 MB binary becomes a build asset — emitted,
 * content-hashed, and **never imported by any chunk** — so nothing in the module
 * graph carries its bytes. It is fetched, once, by the worker, at the moment
 * somebody opens the generator panel. That is the same discipline that keeps
 * three.js at a 1.5 kB eager cost, applied to something 17× larger.
 */
import engineUrl from '../../../vendor/openscad-wasm/openscad.wasm?url'

export type EngineWorkerFactory = () => Worker

export const spawnEngineWorker: EngineWorkerFactory = () =>
  new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'openscad' })

/**
 * Where the engine binary is served from.
 *
 * Deployment note for row X6, which owns the headers: this asset **must** be
 * served as `Content-Type: application/wasm`, and the page needs
 * `'wasm-unsafe-eval'` in its CSP `script-src`. X6's row text already calls
 * those *"the single most common way a working WASM build dies on deploy"*. It
 * does **not** need COOP or COEP — see `runtime.ts`.
 */
export const ENGINE_URL: string = engineUrl

/**
 * Fetch the binary.
 *
 * No `cache: 'force-cache'` or similar: the URL is content-hashed by the build,
 * so the default HTTP cache is already exactly right and immutable. Its bytes
 * are hashed against `ENGINE_SHA256` before they reach `WebAssembly.compile`, so
 * a stale or corrupted response is refused rather than run.
 */
export async function fetchEngine(url: string = ENGINE_URL): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`the OpenSCAD engine could not be fetched: ${String(response.status)} ${response.statusText}`)
  }
  return new Uint8Array(await response.arrayBuffer())
}
