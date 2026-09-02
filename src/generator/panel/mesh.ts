/**
 * Binary-STL header arithmetic, in a module that imports nothing.
 *
 * This is {@link triangleCount}, moved out of `usePreview.ts` — row S5's third
 * request to S4, and the one this row could not route around. The function is
 * four lines of `DataView` arithmetic and it lived beside a React hook that
 * value-imports `../engine`, whose dynamic imports emit the 298 kB OpenSCAD
 * worker chunk. So *any* eager caller that wanted a triangle count paid for the
 * engine seam, and there are now three such callers:
 *
 *   - `usePreview.ts` itself, which refuses a preview at zero triangles because
 *     the vendored geometry has not one `assert()` in it and emits empty
 *     geometry with exit status 0;
 *   - `src/store/meshes.ts`, which has to turn a held mesh into S5's
 *     `GeneratedMeshFacts` — `{ md5, bytes, triangles }` — for a bill row, in
 *     the builder's eager chunk;
 *   - `src/generator/placement/pack.ts`, which today derives the count from the
 *     length identity `detectStlFormat` proves rather than importing this, and
 *     says why in its own docblock.
 *
 * The second of those is why this file exists rather than being reported: the
 * bill panel is eager, and it needs the number.
 *
 * `usePreview.ts` re-exports this name, so S4's published seam and every caller
 * that already reads it — including S5's `pack.test.ts`, which asserts the two
 * arithmetics agree on real fixtures — are untouched. What changed is that a
 * caller may now reach the arithmetic *without* the hook.
 *
 * **This module has no imports at all**, which is the property that makes it
 * free. `src/builder/panels/boundary.test.ts` asserts both halves of that: an
 * empty file closure here, and that `src/store/meshes.ts` reaches this module
 * and not `usePreview.ts`.
 */

/** A binary STL's fixed preamble: an 80-byte header plus a `uint32` facet count. */
export const BINARY_STL_HEADER_BYTES = 84

/** Bytes per binary facet: normal (12) + three vertices (36) + attribute (2). */
export const BINARY_STL_FACET_BYTES = 50

/**
 * Triangle count read out of a binary STL header. Zero means the geometry
 * refused.
 *
 * Reads the header field rather than deriving it from the byte length, which is
 * the distinction S5's `verifyGeneratedMesh` rests on: that function has already
 * established `84 + 50n === byteLength` through `detectStlFormat`, so its
 * division and this read are provably equal *for a whole binary STL* and only
 * then. For anything else — a clipped mesh, an ASCII STL, an empty buffer — the
 * header read is the honest answer and the division is not, which is why both
 * exist and neither is a copy of the other.
 *
 * Total: a buffer too short to hold a header is 0 triangles, not a throw.
 */
export function triangleCount(mesh: Uint8Array): number {
  if (mesh.byteLength < BINARY_STL_HEADER_BYTES) return 0
  return new DataView(mesh.buffer, mesh.byteOffset, mesh.byteLength).getUint32(80, true)
}
