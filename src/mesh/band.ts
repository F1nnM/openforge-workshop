/**
 * How big a converted mesh should be. Four numbers, borrowed and not invented.
 *
 * They are `tools/lod/mesh.ts`'s, measured *there* against surface-area and
 * bounding-box error on four real catalog meshes spanning the corpus, and they
 * are what the `/lod/` store would have been built with had B7 run. Matching
 * them is what makes this row's output a substitute for that store rather than a
 * second, differently-sized thing:
 *
 * | source tris | 5 K area err | 12 K area err | 20 K area err |
 * | --- | --- | --- | --- |
 * | 71,292 | 0.05% | 0.07% | 0.08% |
 * | 207,296 | 0.12% | 0.01% | 0.02% |
 * | 527,488 | 2.26% | 0.33% | 0.03% |
 * | 2,178,242 | **14.92%** | 7.18% | 3.24% |
 *
 * They are **duplicated rather than imported**, and the reason is mechanical:
 * `tools/` is outside the app's TypeScript program and a composite project
 * rejects the import (TS6307 — the wall rows C1, W7, X4 and X10 each hit from
 * one side or the other). `src/builder/three/lod.ts` already carries the same
 * two numbers for the same reason. `band.test.ts` reads the tool's source and
 * asserts every one of them agrees, so a change on either side fails a run
 * rather than drifting.
 *
 * This file holds no wasm and no parser, which is the other half of its job:
 * `index.ts` can re-export the policy without putting `meshoptimizer` in the
 * chunk that imports it.
 */

/**
 * Band floor. `tools/lod/mesh.ts`'s `MIN_TRIANGLES`.
 *
 * Below this a mesh is not worth simplifying: the corpus's own smallest
 * geometry is 118 facets, and simplifying *toward* a floor above a mesh's own
 * count would be inflation rather than LOD.
 */
export const MIN_TRIANGLES = 5_000

/** Band ceiling. `tools/lod/mesh.ts`'s `MAX_TRIANGLES`, and G1's stated 20 K. */
export const MAX_TRIANGLES = 20_000

/** Fraction of source triangles aimed for before clamping into the band. 1%. */
export const KEEP_FRACTION = 0.01

/**
 * Simplifier error budget, as a fraction of mesh radius. 5%.
 *
 * Loose on purpose, and the pipeline's reasoning applies unchanged: glTF
 * Transform's 0.0001 default is far too tight to reach a 1% ratio, so with it
 * the reduction silently stops short. At 5% the *ratio* is the binding
 * constraint, which is what makes the output land in the band predictably.
 */
export const SIMPLIFY_ERROR = 0.05

/** Attempts at getting under the ceiling before giving up. */
export const MAX_SIMPLIFY_ATTEMPTS = 3

/** How many triangles this mesh's LOD should aim for. `tools/lod/mesh.ts`'s rule. */
export function targetTriangles(sourceTriangles: number): number {
  if (sourceTriangles <= MAX_TRIANGLES) return sourceTriangles
  return Math.min(MAX_TRIANGLES, Math.max(MIN_TRIANGLES, Math.ceil(sourceTriangles * KEEP_FRACTION)))
}

/** `true` when {@link targetTriangles} would leave the mesh alone. */
export function isPassThrough(sourceTriangles: number): boolean {
  return sourceTriangles <= MAX_TRIANGLES
}
