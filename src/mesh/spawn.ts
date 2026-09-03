/**
 * The one line that names the worker file.
 *
 * Separate from `client.ts` for `src/three/stl/spawn.ts`'s reason:
 * `new Worker(new URL('./worker.ts', import.meta.url))` is a *build* instruction
 * — Vite rewrites it into a chunk reference — and a test that supplies its own
 * worker has no business evaluating it.
 */
export type WorkerFactory = () => Worker

export const spawnConvertWorker: WorkerFactory = () =>
  new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'mesh-convert' })
