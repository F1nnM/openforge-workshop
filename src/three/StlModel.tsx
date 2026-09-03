/**
 * The mesh, and the two coordinate facts about this corpus.
 *
 * **The archive is Z-up.** Measured, not assumed: the median-sized tile
 * (a 4×1 floor strip) has extents 101.60 × 12.70 × 4.50 and the p95 tile (a
 * three-unit arched window) 76.59 × 25.40 × 45.01 — in both, the tall axis is Z,
 * which is the 3D-printing convention every slicer expects and the opposite of
 * three.js's Y-up. So the mesh is rotated −90° about X. Doing it here rather
 * than baking it into the geometry keeps `ModelGeometry.extents` reported in the
 * file's own axes, which is what a spec readout wants.
 *
 * **`dispose={null}`.** r3f disposes what it constructs from JSX; this geometry
 * arrives from a worker and this material is refcounted and shared across
 * mounts, so letting the reconciler dispose either on unmount would either
 * double-dispose or pull a material out from under another holder. Ownership
 * sits with `useStlModel`, and this says so to the reconciler explicitly rather
 * than relying on which of the two behaviours the current version defaults to.
 */
import type { BufferGeometry, MeshStandardMaterial } from 'three'

export interface StlModelProps {
  geometry: BufferGeometry
  material: MeshStandardMaterial
}

/**
 * The rotation, in radians: **−90°**.
 *
 * Exported as a scalar as well as a triple because `src/builder/three/place.ts`
 * needs the angle rather than an Euler triple — it composes
 * `Matrix4.makeRotationX(…)` into an instance matrix — and had duplicated this
 * value with a note asking for it, since it was private to this module and row
 * **G3** owns this file. One definition now, in the module that measured it.
 */
export const Z_UP_TO_Y_UP_RADIANS = -Math.PI / 2

/**
 * −90° about X: the archive's Z-up into three.js's Y-up, as a `<mesh rotation>`.
 *
 * The same fact in the shape JSX wants. It matters to more than this component:
 * G1's GLBs carry the source STL's axes unchanged, so the *container* says Y-up
 * (glTF's convention) while the bytes are Z-up, and a consumer that trusts the
 * container lays every tile on its back.
 */
export const Z_UP_TO_Y_UP: [number, number, number] = [Z_UP_TO_Y_UP_RADIANS, 0, 0]

export function StlModel({ geometry, material }: StlModelProps) {
  return (
    <mesh
      geometry={geometry}
      material={material}
      rotation={Z_UP_TO_Y_UP}
      dispose={null}
    />
  )
}
