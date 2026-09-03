/**
 * The one line that names the worker file.
 *
 * Separate from `client.ts` so that module stays importable from a Node test:
 * `new Worker(new URL('./worker.ts', import.meta.url))` is a *build* instruction
 * — Vite rewrites it into a chunk reference — and a test that only ever supplies
 * its own fake worker has no business evaluating it. Only the lazily-imported
 * viewer chunk reaches this file.
 */
export type WorkerFactory = () => Worker

export const spawnStlWorker: WorkerFactory = () =>
  new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'stl-parse' })
