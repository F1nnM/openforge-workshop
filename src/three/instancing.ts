/**
 * The two lines that decide whether a room of instances is drawn at all, and the
 * predicate that makes them testable without a GPU.
 *
 * ## The bounding sphere is the silent one
 *
 * `WebGLRenderer.projectObject` culls every object against a frustum built from
 * the camera, and for an `InstancedMesh` the sphere it culls against is the
 * *mesh's* `boundingSphere` — a field three sets to `null` in the constructor and
 * documents as *"not automatically computed by the engine; this method must be
 * called by your app"*. The consequence is worth spelling out, because it is not
 * the one the documentation suggests:
 *
 *  1. An `InstancedMesh` starts with every instance matrix set to the identity,
 *     so its true bounds at that moment are one tile at the origin.
 *  2. `Frustum.intersectsObject` finds `boundingSphere === null` and **computes
 *     it once, from whatever the matrices hold at that instant**.
 *  3. It never recomputes. So if any frustum test happens before the matrices are
 *     written — and with `frameloop="demand"` nothing guarantees it does not —
 *     the mesh keeps a sphere describing a tile at the origin for the rest of its
 *     life, and a room two metres from the origin is culled away wholesale.
 *
 * The failure mode is **a canvas that draws nothing while every count, every
 * matrix and every material is correct**, with no warning anywhere. That is why
 * this is a named function with a test rather than a comment next to a call:
 * `instancing.test.ts` reproduces all three steps above against the renderer's
 * own predicate, and it is the one thing in this area that can be proved in CI.
 *
 * ## What is *not* here
 *
 * No disposal, and no ownership. A geometry that arrived from a loader and a
 * material that is refcounted in `material.ts` both belong to whoever acquired
 * them; this module writes matrices and computes a sphere.
 */
import type { Camera, InstancedMesh, Matrix4, Object3D } from 'three'
import { Frustum, Matrix4 as Matrix4Impl } from 'three'

/**
 * Write instance matrices and leave the mesh cullable.
 *
 * The order is the whole content of the function and it is not interchangeable:
 * the matrices go in, the attribute is flagged for upload, and **then** the
 * bounding sphere is computed — from the matrices that are now there. Computing
 * it first, or omitting it, is the failure in the module docblock.
 *
 * Writes at most `mesh.count` matrices. A caller with more matrices than the
 * mesh was constructed for has rebuilt something wrongly; the extra ones are
 * dropped rather than written past the end of the attribute, and the mesh still
 * ends up with a sphere that matches what it will draw.
 */
export function syncInstances(mesh: InstancedMesh, matrices: readonly Matrix4[]): number {
  let written = 0
  for (const matrix of matrices) {
    if (written >= mesh.count) break
    mesh.setMatrixAt(written, matrix)
    written += 1
  }

  mesh.instanceMatrix.needsUpdate = true
  // See the docblock. Without this the whole group can be culled, permanently.
  mesh.computeBoundingSphere()
  return written
}

/**
 * The renderer's own culling decision, as a function that can be called from a
 * test.
 *
 * `WebGLRenderer.projectObject` does exactly this: multiply the camera's
 * projection by its inverse world matrix, build a frustum from the product, and
 * ask `frustum.intersectsObject(object)` unless the object opts out with
 * `frustumCulled = false`. Extracted here because that is the *only* way this
 * project can assert a culling claim in CI — jsdom has no WebGL context, so the
 * renderer that normally makes this call cannot be constructed, while the
 * arithmetic it uses to make it is plain linear algebra and needs nothing.
 *
 * Two honest limits. It reads the matrices as they stand, so a caller must have
 * updated the camera's world matrix first, exactly as the renderer does at the
 * top of `render()`. And it answers the question the *renderer* asks — whether
 * the object is submitted — which is upstream of everything a GPU then does with
 * it. A `true` here is not a promise that a pixel changed.
 */
export function visibleInFrustum(camera: Camera, object: Object3D): boolean {
  if (!object.frustumCulled) return true

  const frustum = new Frustum().setFromProjectionMatrix(
    new Matrix4Impl().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  )
  return frustum.intersectsObject(object)
}
