/**
 * Converted meshes: the source STL a user is entitled to, turned into the
 * geometry `/lod/` would have served if it had ever been uploaded.
 *
 * ```ts
 * import { ensureSceneMeshes, meshQueue, useMeshQueue } from '@/mesh'
 *
 * // the scene warmer, once the fills are known:
 * void ensureSceneMeshes(meshQueue(assets), tiles, aggregates)
 * ```
 *
 * ## Why the row exists
 *
 * `https://objects.openforge.tools/lod/…` answers **404** and always has: the
 * store is written by `tools/lod/cli.ts` and that run is blocker **B7**, gated
 * on **B2**'s R2 write credentials. `/models/` serves the source STLs fine. So a
 * 3D-only builder — which is what rows R2 and R4 make it — draws nothing at all
 * in production today, and no amount of renderer work changes that.
 *
 * Reproduced against this corpus, per *distinct* mesh (placements reuse meshes,
 * so distinct count is what matters), triangles exact from the binary-STL
 * `84 + 50n` identity:
 *
 * | | download | triangles | cached |
 * | --- | ---: | ---: | ---: |
 * | median mesh | 10.77 MB | 215,314 | **58.6 kB** |
 * | the 6-tile starter set | **64.1 MB** | 1,281,234 | **351 kB** |
 * | the 6 starter *designs*, every variant | 502.8 MB | — | 2.16 MB |
 * | whole archive | 106.13 GB | — | — |
 *
 * Measured end to end on those six real meshes: **8.4 s** to download at the
 * bucket's throughput and **1.08 s** to convert all six. The download is 89% of
 * it, which is the number that decides everything else in this directory — the
 * conversion is nearly free, so it always runs, and the *fetch* is what gets
 * ordered, bounded and cached.
 *
 * ## Shape
 *
 * | module | job |
 * | --- | --- |
 * | `weld.ts` | triangle soup → indexed mesh, **on position alone**. The trick. |
 * | `convert.ts` | STL bytes → 5,000–20,000 triangles, reusing `@/three/stl/parse` |
 * | `protocol.ts`, `worker.ts`, `spawn.ts`, `client.ts` | the conversion off the main thread |
 * | `record.ts` | what is stored, what it costs, what gets evicted |
 * | `cache.ts` | IndexedDB |
 * | `queue.ts` | fetch → convert → cache, with all seven states named |
 * | `tiers.ts` | the conversion tier policy and the call the scene warmer makes |
 *
 * **Nothing here imports three.js.** That is load-bearing rather than tidy: the
 * conversion is triggered from `src/App.tsx`, which is mounted for every screen
 * including the landing one and must not pull the 411 kB renderer chunk, and the
 * `BufferGeometry` is built later by
 * `src/builder/three/loadLod.ts` inside the lazily-loaded 3D chunk from the
 * cached arrays. `boundary.test.ts` asserts it by walking this barrel's static
 * import graph with `tools/boundary/closure.ts`.
 *
 * ## When B7 runs, this goes quiet
 *
 * `loadLod.ts` prefers `/lod/` and falls back to the cache. A backfilled store
 * makes every mesh here a 21 kB GLB fetch instead of a 10.77 MB STL plus a
 * conversion, and this directory stops being reached without a line changing.
 * Nothing is thrown away and nothing waits on a credential.
 */
export type { MeshConverter } from './client'
export { MeshConvertError, createMeshConverter } from './client'

export type { MeshCache } from './cache'
export {
  MeshCacheQuotaError,
  MeshCacheUnavailableError,
  openMeshCache,
  resetSharedMeshCache,
  sharedMeshCache,
} from './cache'

export {
  KEEP_FRACTION,
  MAX_SIMPLIFY_ATTEMPTS,
  MAX_TRIANGLES,
  MIN_TRIANGLES,
  SIMPLIFY_ERROR,
  isPassThrough,
  targetTriangles,
} from './band'

/**
 * `convert.ts` itself is **deliberately not re-exported here** — only its type.
 *
 * It imports `meshoptimizer/simplifier`, 55 kB of wasm-bearing JS, and a value
 * export from this barrel would put it in the entry chunk of every module that
 * writes `from '@/mesh'`. The only importer of `convert.ts` is `worker.ts`, which Vite
 * emits as its own chunk. `boundary.test.ts` asserts it, and it does so with a
 * test that failed on the first draft of this file, when `convertStl` was
 * exported from here.
 */
export type { ConvertedMesh } from './convert'

export type { MeshPlan, MeshPlanOptions } from './tiers'
export {
  LOCK_SYSTEMS,
  MESH_BACKGROUND_BUDGET_BYTES,
  ensureSceneMeshes,
  lockReachable,
  meshQueue,
  planSceneMeshes,
  resetMeshQueue,
  useMeshQueue,
} from './tiers'

export type { ConvertRequest, ConvertResponse, ConvertedResponse } from './protocol'
export { convertRequest, convertedResponse, narrowIndices } from './protocol'

export type { MeshCacheEntry, MeshCacheStats, MeshRecord } from './record'
export {
  MESH_CACHE_BUDGET_BYTES,
  MESH_CACHE_DB,
  MESH_CACHE_STORE,
  MESH_CACHE_VERSION,
  evictionPlan,
  meshRecordBytes,
} from './record'

export type { MeshQueue, MeshQueueOptions, MeshQueueState, MeshRequest, MeshTask, MeshTaskState, MeshTier } from './queue'
export { MESH_FETCH_CONCURRENCY, createMeshQueue } from './queue'

export type { WorkerFactory } from './spawn'
export { spawnConvertWorker } from './spawn'

export type { Indices, Positions, WeldReport, WeldedMesh } from './weld'
export { WELD_ASSERT_MIN_TRIANGLES, WELD_MAX_RATIO, WeldNoOpError, assertWeldDropped, weldPositions } from './weld'
