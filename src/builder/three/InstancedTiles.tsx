/**
 * One `<instancedMesh>` per group, and the two things three.js will not do for
 * you.
 *
 * ## 1. The bounding sphere must be recomputed, or the room disappears
 *
 * `Mesh` culls against `geometry.boundingSphere` carried through its own
 * `matrixWorld`. An `InstancedMesh`'s instances are *inside* the geometry's
 * frame — every one of them offset by its own matrix — so that sphere describes
 * a single tile sitting at the room's origin, and a room whose pieces are two
 * metres from the origin is frustum-culled away wholesale the moment the camera
 * looks at it. `InstancedMesh.computeBoundingSphere()` unions the per-instance
 * spheres instead, and it has to be called *after* the matrices are written.
 * The failure mode is a canvas that renders nothing while every count, every
 * matrix and every material is correct, which is why it is the first thing in
 * this docblock.
 *
 * ## 2. Neither the geometry nor the material is r3f's to dispose
 *
 * `dispose={null}`, for `StlModel.tsx`'s reason: the geometry belongs to
 * `useLodStore`, which releases it when the view closes, and the material is
 * refcounted in `src/three/material.ts` and shared with the detail viewer. Left
 * to the reconciler, closing the builder's 3D view would dispose a material the
 * drawer is still holding — a black mesh, with no error.
 *
 * ## The material is acquired in an effect, not in a memo
 *
 * `acquireMaterial` increments a refcount. A `useMemo` may be discarded and
 * re-run without its cleanup ever happening, so the count would drift upward and
 * the material would never be released. `useStlModel.ts` established the
 * effect-plus-state shape for exactly this; it is copied rather than reinvented.
 */
import { useThree } from '@react-three/fiber'
import { useEffect, useState } from 'react'
import type { InstancedMesh, MeshStandardMaterial } from 'three'

import { acquireMaterial, releaseMaterial } from '@/three/material'

import type { LodInstanceGroup } from './instances'

export interface InstancedTilesProps {
  readonly group: LodInstanceGroup
}

/** One group's instances. */
export function InstancedTiles({ group }: InstancedTilesProps) {
  const invalidate = useThree((state) => state.invalidate)
  const [material, setMaterial] = useState<MeshStandardMaterial | null>(null)
  const [mesh, setMesh] = useState<InstancedMesh | null>(null)

  const variantKey = group.resolution.variantKey
  useEffect(() => {
    setMaterial(acquireMaterial(group.resolution))
    return () => {
      setMaterial(null)
      releaseMaterial(group.resolution)
    }
    // Keyed on the cache key the registry itself nominates, not on the
    // `Resolution` object's identity: a caller that re-resolves per render hands
    // a new object each time and would re-acquire on every render.
  }, [variantKey])

  useEffect(() => {
    if (mesh === null) return
    for (const [index, matrix] of group.matrices.entries()) mesh.setMatrixAt(index, matrix)
    mesh.instanceMatrix.needsUpdate = true
    // See the docblock. Without this the whole group is culled.
    mesh.computeBoundingSphere()
    // `frameloop="demand"`: nothing redraws unless something asks.
    invalidate()
  }, [mesh, group, invalidate])

  if (material === null) return null

  return (
    <instancedMesh
      ref={setMesh}
      // `count` is the maximum; a group is rebuilt when it changes, so r3f
      // constructs a new object rather than growing this one.
      args={[group.lod.geometry, material, group.count]}
      dispose={null}
    />
  )
}
