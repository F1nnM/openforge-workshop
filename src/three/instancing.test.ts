/**
 * The one thing about instanced rendering this project can prove without a GPU.
 *
 * `src/builder/three/room.test.tsx` lists what no test in that row checks — *"that
 * the flat-shaded shader compiles, that `computeBoundingSphere` saves the room
 * from being culled, that an instanced draw is one call, or that the AO lands in
 * the creases"* — and says every one of them needs a GPU. Three of those four do.
 * **The bounding sphere does not**, and it is the one whose failure mode is
 * silent: a canvas that draws nothing while every count, every matrix and every
 * material is correct.
 *
 * Frustum culling is linear algebra. `WebGLRenderer.projectObject` builds a
 * frustum from the camera and calls `frustum.intersectsObject(object)`;
 * `visibleInFrustum` in `instancing.ts` is those two lines, so this file
 * reproduces the renderer's own decision in a Node environment with no canvas of
 * any kind.
 *
 * ## What these tests prove
 *
 *   - The geometry's bounding sphere describes **one tile at the room's origin**,
 *     and a camera looking at a room ten units away does not see it. That is the
 *     shape of the bug, established rather than asserted.
 *   - `Frustum.intersectsObject` computes an `InstancedMesh`'s missing sphere
 *     **once** and then keeps it, so a frustum test that happens before the
 *     matrices are written poisons the mesh permanently. This is the actual
 *     failure, and it is a *timing* failure — which is why "it worked when I
 *     tried it" is not evidence.
 *   - `syncInstances` fixes it in both directions: a room moved into view appears,
 *     and a room moved out of view disappears.
 *
 * ## What they cannot prove
 *
 * That a pixel changed. `visibleInFrustum` answers the question the renderer asks
 * — whether the object is submitted to a draw call — which is upstream of
 * shader compilation, of the AO pass and of anything a driver then does. It also
 * says nothing about how many draw calls an `InstancedMesh` costs; that is a
 * property of the GPU command stream, and it needs a GPU.
 */
import { describe, expect, it } from 'vitest'
import {
  BoxGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Vector3,
} from 'three'

import { CAMERA_FAR, CAMERA_FOV, CAMERA_NEAR, CAMERA_POSITION } from './frame'
import { syncInstances, visibleInFrustum } from './instancing'

/** Where the room sits: three 1×1×1 tiles in a row, centred ten units out. */
const ROOM_CENTRE = new Vector3(11, 0, 0)

function roomMatrices(centre: Vector3 = ROOM_CENTRE): Matrix4[] {
  return [-1, 0, 1].map((offset) =>
    new Matrix4().makeTranslation(centre.x + offset, centre.y, centre.z),
  )
}

/**
 * `Stage`'s camera, aimed at a target — the same field of view, near and far
 * planes and three-quarter offset the real one uses.
 */
function cameraLookingAt(target: Vector3): PerspectiveCamera {
  const camera = new PerspectiveCamera(CAMERA_FOV, 1, CAMERA_NEAR, CAMERA_FAR)
  camera.position.set(
    target.x + CAMERA_POSITION[0],
    target.y + CAMERA_POSITION[1],
    target.z + CAMERA_POSITION[2],
  )
  camera.lookAt(target)
  camera.updateMatrixWorld()
  camera.updateProjectionMatrix()
  return camera
}

function instancedRoom(count = 3): InstancedMesh {
  const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial(), count)
  mesh.updateMatrixWorld()
  return mesh
}

describe('the shape of the bug', () => {
  it('has a geometry sphere that describes one tile at the origin', () => {
    const geometry = new BoxGeometry(1, 1, 1)
    geometry.computeBoundingSphere()

    // Half the box's diagonal, centred on the origin: one tile, at the room's
    // origin rather than at the room.
    expect(geometry.boundingSphere?.radius).toBeCloseTo(Math.sqrt(3) / 2, 12)
    expect(geometry.boundingSphere?.center.length()).toBe(0)
  })

  it('does not include the origin in the camera looking at the room', () => {
    // The premise of every assertion below. If this were false — if the camera
    // happened to see the origin as well as the room — nothing in this file
    // would distinguish a correct sphere from a stale one.
    const camera = cameraLookingAt(ROOM_CENTRE)
    const atOrigin = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial())
    atOrigin.updateMatrixWorld()

    expect(visibleInFrustum(camera, atOrigin)).toBe(false)
  })

  it('sees a plain mesh that is actually in the room', () => {
    const camera = cameraLookingAt(ROOM_CENTRE)
    const inRoom = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial())
    inRoom.position.copy(ROOM_CENTRE)
    inRoom.updateMatrixWorld()

    expect(visibleInFrustum(camera, inRoom)).toBe(true)
  })
})

describe('an InstancedMesh with no computed sphere', () => {
  it('starts with none at all, and every instance at the identity', () => {
    const mesh = instancedRoom()
    expect(mesh.boundingSphere).toBe(null)

    const matrix = new Matrix4()
    mesh.getMatrixAt(0, matrix)
    expect(matrix.equals(new Matrix4())).toBe(true)
  })

  it('is computed on the first frustum test — so writing matrices first appears to work', () => {
    // Stated because it is the trap: the naive code path passes if the first
    // frustum test happens after the matrices are written. Nothing guarantees
    // that ordering, which is what the next test is about.
    const mesh = instancedRoom()
    for (const [index, matrix] of roomMatrices().entries()) mesh.setMatrixAt(index, matrix)
    mesh.instanceMatrix.needsUpdate = true

    const camera = cameraLookingAt(ROOM_CENTRE)
    expect(visibleInFrustum(camera, mesh)).toBe(true)
    expect(mesh.boundingSphere?.center.x).toBeCloseTo(ROOM_CENTRE.x, 6)
  })

  it('keeps the sphere it computed first, so an early test culls the room forever', () => {
    const mesh = instancedRoom()
    const camera = cameraLookingAt(ROOM_CENTRE)

    // One frustum test before the matrices arrive. In the app that is a single
    // render between the mesh being constructed and the effect that writes the
    // matrices — and under `frameloop="demand"` nothing forbids it.
    expect(visibleInFrustum(camera, mesh)).toBe(false)

    for (const [index, matrix] of roomMatrices().entries()) mesh.setMatrixAt(index, matrix)
    mesh.instanceMatrix.needsUpdate = true

    // Every count, every matrix and every material is now correct. The mesh is
    // still culled, and there is no warning of any kind.
    expect(visibleInFrustum(camera, mesh)).toBe(false)
    expect(mesh.boundingSphere?.center.length()).toBe(0)

    // The one line that recovers it.
    mesh.computeBoundingSphere()
    expect(visibleInFrustum(camera, mesh)).toBe(true)
  })
})

describe('syncInstances', () => {
  it('leaves the mesh visible even after an early frustum test poisoned it', () => {
    const mesh = instancedRoom()
    const camera = cameraLookingAt(ROOM_CENTRE)
    expect(visibleInFrustum(camera, mesh)).toBe(false)

    syncInstances(mesh, roomMatrices())
    expect(visibleInFrustum(camera, mesh)).toBe(true)
  })

  it('unions the instances rather than describing one of them', () => {
    const mesh = instancedRoom()
    syncInstances(mesh, roomMatrices())

    const sphere = mesh.boundingSphere
    expect(sphere?.center.x).toBeCloseTo(ROOM_CENTRE.x, 12)
    // Two units of room, plus the tile's own half-diagonal on each end.
    expect(sphere?.radius).toBeCloseTo(1 + Math.sqrt(3) / 2, 6)
  })

  it('flags the attribute for upload, which is the other half of the write', () => {
    // Asserted on `version`, because `needsUpdate` is a **write-only setter** on
    // `BufferAttribute` — `set needsUpdate(value) { if (value === true)
    // this.version++ }`, with no getter. Reading it back gives `undefined`, so a
    // test that asserted `needsUpdate === true` would be asserting nothing.
    const mesh = instancedRoom()
    const before = mesh.instanceMatrix.version
    syncInstances(mesh, roomMatrices())
    expect(mesh.instanceMatrix.version).toBeGreaterThan(before)
  })

  it('follows the room out of view as well as into it', () => {
    // The mirror image, and the reason recomputing is not a one-off at mount: a
    // stale sphere keeps a room drawn after it has moved away, which costs a
    // full draw of geometry that contributes nothing.
    const mesh = instancedRoom()
    const camera = cameraLookingAt(ROOM_CENTRE)

    syncInstances(mesh, roomMatrices())
    expect(visibleInFrustum(camera, mesh)).toBe(true)

    const moved = roomMatrices(new Vector3(-40, 0, 0))
    for (const [index, matrix] of moved.entries()) mesh.setMatrixAt(index, matrix)
    // Without a recomputation the mesh is still "visible" on the old sphere.
    expect(visibleInFrustum(camera, mesh)).toBe(true)

    syncInstances(mesh, moved)
    expect(visibleInFrustum(camera, mesh)).toBe(false)
  })

  it('writes no more matrices than the mesh was constructed for', () => {
    const mesh = instancedRoom(2)
    expect(syncInstances(mesh, roomMatrices())).toBe(2)

    // And the sphere describes what will actually be drawn, not the third
    // matrix that was dropped.
    expect(mesh.boundingSphere?.center.x).toBeCloseTo(ROOM_CENTRE.x - 0.5, 6)
  })
})

describe('visibleInFrustum', () => {
  it('respects an object that has opted out of culling', () => {
    const camera = cameraLookingAt(ROOM_CENTRE)
    const atOrigin = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial())
    atOrigin.updateMatrixWorld()
    expect(visibleInFrustum(camera, atOrigin)).toBe(false)

    atOrigin.frustumCulled = false
    expect(visibleInFrustum(camera, atOrigin)).toBe(true)
  })
})
