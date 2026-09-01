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

/** −90° about X: the archive's Z-up into three.js's Y-up. */
const Z_UP_TO_Y_UP: [number, number, number] = [-Math.PI / 2, 0, 0]

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
