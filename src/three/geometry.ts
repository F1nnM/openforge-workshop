/**
 * `ParsedStl` → `BufferGeometry`, and the two decisions that live in that step.
 *
 * ## 1. Normals are recomputed, and the geometry stays non-indexed
 *
 * A binary STL declares a normal per facet, and the corpus's are not
 * trustworthy: they are whatever the exporter wrote, they are frequently zero or
 * unnormalised, and §8 records the related trap on the LOD side (facet normals
 * surviving into `weld()` silently defeat simplification). So the stored normals
 * are skipped at parse time and `computeVertexNormals()` runs here instead.
 *
 * On a **non-indexed** geometry that is not a smoothing pass: each triangle owns
 * its three vertices, so every one of them receives that triangle's own face
 * normal and the result is exact flat shading. That is the correct look for
 * sculpted stone — the detail in these meshes *is* geometry, and smoothing it
 * across facets would soften the very creases the viewer exists to show. It is
 * also why welding is not attempted: welding would be a 3× memory saving and a
 * visual regression.
 *
 * The cost is stated plainly: normals double the typed-array footprint, which is
 * the second column of `gate.ts`'s table and half the reason the gate is where
 * it is.
 *
 * ## 2. The mesh is normalised to a unit radius
 *
 * Every model is centred on its bounding box and scaled to
 * {@link VIEW_RADIUS} = 1. Two things need it: the camera frames any tile
 * without a per-model dolly, and — the real reason — **N8AO's occlusion radius
 * is in world units**. A 25 mm floor tile and a 300 mm boss door under one AO
 * radius would give one of them mud and the other nothing, and AO is what
 * carries the crease definition that the material registry's contour carries in
 * 2D (§9). Normalising makes one tuned radius correct for the whole corpus.
 *
 * The pre-scale extents are returned rather than discarded, so a readout can
 * still state the real size.
 *
 * ## The 84-byte file
 *
 * One live file is a valid binary header declaring zero facets. It parses, so it
 * arrives here, and an empty geometry is where three.js turns quiet: an empty
 * `computeBoundingBox()` leaves the box at ±Infinity, `getCenter()` then yields
 * `NaN`, and a NaN bounding sphere disables culling and raycasting **without a
 * warning**. So the empty case never reaches that arithmetic — it gets a real
 * zero-radius sphere and an `empty` flag, and the viewer says so on screen
 * instead of showing an empty frame that looks like a failed load.
 */
import { BufferAttribute, BufferGeometry, Box3, Sphere, Vector3 } from 'three'

import { GRID_UNIT_MM } from '@/catalog'

import type { ParsedStl } from './stl/parse'

/** Bounding-sphere radius every model is scaled to. The AO radius is tuned against it. */
export const VIEW_RADIUS = 1

export interface ModelGeometry {
  readonly geometry: BufferGeometry
  readonly triangles: number
  /** Bounding-box extents in the file's own units, before normalisation. */
  readonly extents: readonly [number, number, number]
  /** Bounding-sphere radius in the file's own units, before normalisation. */
  readonly radius: number
  /** Factor applied to reach {@link VIEW_RADIUS}. */
  readonly scale: number
  /** True for a file with no drawable triangles. Not an error. */
  readonly empty: boolean
}

export function buildModelGeometry(parsed: ParsedStl): ModelGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(parsed.positions, 3))

  if (parsed.triangles === 0) {
    // Set both explicitly. Leaving them unset means the first render computes
    // them, which is the NaN path described in the docblock.
    geometry.boundingBox = new Box3(new Vector3(), new Vector3())
    geometry.boundingSphere = new Sphere(new Vector3(), 0)
    return { geometry, triangles: 0, extents: [0, 0, 0], radius: 0, scale: 1, empty: true }
  }

  geometry.computeBoundingBox()
  const box = geometry.boundingBox ?? new Box3()
  const size = box.getSize(new Vector3())
  const centre = box.getCenter(new Vector3())

  geometry.translate(-centre.x, -centre.y, -centre.z)
  geometry.computeBoundingSphere()
  const radius = geometry.boundingSphere?.radius ?? 0

  // A single-point mesh — every vertex coincident — has radius 0 and no scale
  // that helps. It is drawable (as nothing) and must not divide by zero.
  const scale = radius > 0 ? VIEW_RADIUS / radius : 1
  if (scale !== 1) geometry.scale(scale, scale, scale)

  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()

  return {
    geometry,
    triangles: parsed.triangles,
    extents: [size.x, size.y, size.z],
    radius,
    scale,
    empty: false,
  }
}

/**
 * Grid units for a model-space extent.
 *
 * The corpus is authored in millimetres against §2's measured 25.4 mm grid unit.
 * Measured on real archive files during this PR, which is the only reason the
 * conversion is stated as fact: the median-sized tile
 * (`cut-stone+ruined#floor+s2w+wall.4x1.openforge.stl`, 10.36 MB) has extents
 * **101.60 × 12.70 × 4.50**, and 101.60 is 4 × 25.4 to the hundredth while 12.70
 * is exactly §2's `WALL_THICKNESS_MM`; the p95 tile measures 25.40 across its
 * single-unit axis. Millimetres, on the 25.4 grid, with no scale factor hiding
 * in the exporter.
 */
export function gridUnits(extent: number): number {
  return extent / GRID_UNIT_MM
}

/**
 * Release a geometry's GPU buffers.
 *
 * r3f disposes geometries and materials it created from JSX; this one is created
 * imperatively from a worker payload, so it is ours to release. Calling it twice
 * is harmless — `dispose()` on an already-disposed geometry only re-emits the
 * event.
 */
export function disposeGeometry(geometry: BufferGeometry | null | undefined): void {
  geometry?.dispose()
}
