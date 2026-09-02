/**
 * The public seam, and the reason the engine costs the app nothing until it is
 * wanted.
 *
 * **Every import in this file is a type import or a dynamic `import()`.** That is
 * not a style preference, it is the entire size story of this row. The engine is
 * 10.5 MB of WebAssembly plus 99 KB of Emscripten glue plus 197 KB of `.scad`
 * sources plus an 18 KB licence; a single value import from `./client` here
 * would drag the whole of it into the entry bundle and there would be no
 * observable error, just a first paint that waits on ten megabytes.
 *
 * The layering that makes it hold, with the sizes a real `vite build` emitted:
 *
 * | Layer | Bytes | When it is paid |
 * | --- | --- | --- |
 * | this module | **0** in the entry bundle | never — see below |
 * | `client.ts`, `protocol.ts` | 1,662 | `loadGeneratorEngine()` |
 * | `spawn.ts` — the worker URL and the asset URL | 404 | same |
 * | `worker.ts` + glue + 35 `.scad` + notice | 298,062 | the first request |
 * | `licence.ts` — GPL-2 text and source offer | 25,727 | displaying the notice |
 * | `openscad.wasm` | 10,531,863 (3,258,940 gzipped) | fetched once by the worker |
 *
 * **Zero, measured rather than asserted.** Building the app with this directory
 * and `vendor/openscad-wasm/` present, and again with both moved aside, produced
 * the identical entry bundle down to the content hash — `index-2dMoR84-.js`,
 * 591,300 bytes, 512 modules, either way. Nothing in the app imports this module
 * yet (row S4's panel will), so today the whole tree is emitted only when
 * something reaches it; the discipline above is what keeps that true afterwards.
 *
 * `vendor.test.ts` asserts the discipline against the source rather than
 * trusting it, because the failure is silent: everything works, and the bundle
 * is twenty times larger.
 *
 * ## For row S4
 *
 * `loadGeneratorEngine()` returns an engine whose worker is spawned on first use
 * and then kept — the panel should hold one for its lifetime and `terminate()`
 * it on unmount. Do not create one per render: S2's 281 ms compile is paid per
 * worker, and 65–80% of a small render is exactly what a fresh worker adds.
 *
 * `loadEngineLicence()` returns the GPL-2 text and the written source offer.
 * **The panel must surface them.** The engine refuses to run if the notice did
 * not ship (`licence.ts`), so this is not optional decoration — it is the
 * mechanism by which a browser that receives the binary also receives the
 * licence, which is what GPL-2 §1 and §3 ask for.
 */
import type { GeneratorEngine } from './client'
import type { EngineLicence } from './licence'
import type { Verification } from './verify'

export type { ExportFormat, ParameterAssignment, RenderArgsRequest } from './args'
export type { Diagnostic, Diagnostics } from './diagnostics'
export type { EngineFailure } from './protocol'
export type {
  ParameterDescriptor,
  ParameterGroup,
  ParameterKind,
  ParameterOption,
  ParameterRange,
  ParameterSchema,
  ParameterValue,
} from './schema'
export type { EngineVersion } from './version'
export type { Verification } from './verify'
export type { GeneratedMesh, GeneratorEngine, RenderOptions } from './client'
export type { EngineLicence, EngineSource } from './licence'

/**
 * Load the engine and return a client for it.
 *
 * Nothing is fetched or compiled by this call: it pulls the lazy chunk, and the
 * worker spawns on the first request made of the returned engine. Awaiting it
 * when the panel mounts is therefore cheap and gets the chunk warm.
 */
export async function loadGeneratorEngine(): Promise<GeneratorEngine> {
  const [{ createEngine }, { spawnEngineWorker }] = await Promise.all([import('./client'), import('./spawn')])
  return createEngine(spawnEngineWorker)
}

/**
 * Load the engine's licence and written source offer.
 *
 * Separate from {@link loadGeneratorEngine} so a panel can display the notice
 * without spawning anything, and so the 18 KB of licence text lives in the lazy
 * chunk rather than the entry bundle.
 */
export async function loadEngineLicence(): Promise<EngineLicence> {
  const { ENGINE_LICENCE } = await import('./licence')
  return ENGINE_LICENCE
}

/**
 * One line saying what a mesh's digest established.
 *
 * Re-exported through a dynamic import because the honest wording is the
 * substance of the claim, and S4 should render it rather than compose its own.
 */
export async function loadVerificationDescriber(): Promise<(verification: Verification) => string> {
  const { describeVerification } = await import('./verify')
  return describeVerification
}
