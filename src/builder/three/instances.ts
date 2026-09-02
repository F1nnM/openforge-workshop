/**
 * `PlanScene` → one `InstancedMesh` per shared geometry. The row's namesake.
 *
 * ## "One mesh per design" is the intent; the key is the **blob**
 *
 * `v2-pr-series.md` says `InstancedMesh` per design, and `tools/lod/catalog.ts`
 * carries a `designs` list per object for exactly that reason. Measured against
 * the emitted index, a design is *not* one geometry:
 *
 * | | |
 * | --- | --- |
 * | live records | 8,702 |
 * | distinct md5s | 8,353 |
 * | distinct designs | 3,822 |
 * | designs resolving to **one** md5 | 2,142 (56.04%) |
 * | designs resolving to more | 1,680, up to **16** |
 * | md5s shared across designs | 102, up to 4 designs each |
 *
 * A design is a family of connection variants — the openlock, dragonlock and
 * magnetic cuts of one tile are different meshes — so keying on `design` would
 * put up to sixteen different geometries in one `InstancedMesh`, which shares
 * exactly one. Keying on **`blob`**, the content address that is also the store
 * key, is the same idea done correctly: it is never coarser than per-design
 * (every placement of one variant instances together) and on those 102 shared
 * md5s it is *finer* in the useful direction — two designs that are the same
 * bytes draw in one call.
 *
 * The material is part of the key too, at `resolution.variantKey`, because an
 * `InstancedMesh` has one material as well as one geometry. In practice that
 * splits nothing: a blob is one file, so its tags and therefore its family are
 * fixed. It is in the key so that the 102 cross-design md5s cannot silently
 * inherit whichever family happened to be resolved first.
 *
 * ## What 50 placements across 20 designs costs
 *
 * At worst 20 geometries — one per design, since a placement names a file and a
 * file is one blob — so **20 `InstancedMesh`es, 20 GLB fetches and 50 instance
 * matrices**. Draw calls go 50 → 20; the 30 repeat placements cost one 4×4
 * matrix each and no bytes at all.
 *
 * `instances.test.ts` runs that projection over the first twenty designs of the
 * emitted index rather than asserting the arithmetic, and the material count is
 * the part worth having measured: those twenty land on **one** family, so the
 * twenty meshes share a single refcounted `MeshStandardMaterial`. The registry
 * collapses the whole 8,702-record archive to 16 families, so 16 is the ceiling
 * for any room however large.
 *
 * ## The refusals are the plan view's, unchanged
 *
 * `unknown` (a retired tile id) and `undrawable` (footprint `none`) come
 * straight out of `buildPlanScene` and are passed through, not re-derived. A
 * third is this row's own: **`absent`**, an object the `/lod/` store does not
 * hold. Since blocker **B2** is open and nothing is uploaded, that is currently
 * every object — see `lod.ts`.
 */
import type { Matrix4 } from 'three';
import { Box3 } from 'three'

import type { PlanPiece, PlanScene } from '@/builder/canvas'
import type { BlobId, CatalogRecord } from '@/catalog'
import type { Resolution } from '@/materials'
import type { PlacementId } from '@/store'

import type { LodGeometry } from './loadLod'
import { lodBudgetRefusal, lodObjectBudget } from './lod'
import type { RoomFit } from './place'
import { fitRoom, placedBounds, roomBounds, tileMatrix } from './place'

/**
 * The instancing key: content address, then material variant.
 *
 * `\u0000` as the delimiter, written as an escape. It cannot occur in an md5 or
 * in a variant key, which is what makes it the right delimiter — and
 * `tools/hygiene/source.test.ts` fails the build on the literal byte, so the
 * escape is not a style preference.
 */
export function instanceKey(blob: BlobId, variantKey: string): string {
  return `${blob}\u0000${variantKey}`
}

/** One `InstancedMesh`: a shared geometry, a shared material, and N matrices. */
export interface LodInstanceGroup {
  readonly key: string
  readonly blob: BlobId
  /** The loaded object. Its geometry already has `node.matrixWorld` baked in. */
  readonly lod: LodGeometry
  readonly resolution: Resolution
  /** One per placement, in the plan's own paint order. `count === matrices.length`. */
  readonly matrices: readonly Matrix4[]
  readonly placements: readonly PlacementId[]
  readonly count: number
  /** Union of every instance's world bounds, in millimetres. */
  readonly bounds: Box3
}

/** A placement whose store object is not there. */
export interface LodGap {
  readonly blob: BlobId
  readonly placements: readonly PlacementId[]
  readonly name: string
}

/** How far a group's real mesh disagrees with its tagged footprint, worst first. */
export interface FootprintDisagreement {
  readonly blob: BlobId
  readonly name: string
  /** Grid units, the larger of the two axis differences. */
  readonly worst: number
}

export interface Room3D {
  readonly groups: readonly LodInstanceGroup[]
  /** Union of every group's bounds, in millimetres. Empty for an empty room. */
  readonly bounds: Box3
  /** The normalisation that puts the room in `Stage`'s frame. */
  readonly fit: RoomFit
  /** Placements the store has no object for. Expected today — blocker B2. */
  readonly absent: readonly LodGap[]
  /** Distinct objects the room needs, loaded or not. What the budget counts. */
  readonly objects: number
  /** Set when `objects` is over {@link lodObjectBudget}; the room stays in plan view. */
  readonly refusal: string | null
  /** Tiles whose mesh and tagged footprint disagree by more than `reportDeltaOver`. */
  readonly disagreements: readonly FootprintDisagreement[]
  /** Instances actually drawn, across every group. */
  readonly instances: number
  /** Triangles actually drawn — the sum over instances, not over geometries. */
  readonly triangles: number
  /**
   * Decoded typed-array bytes the loaded geometries hold.
   *
   * Summed over *geometries* and not over instances, which is the whole point of
   * instancing: a second placement of a tile costs a 4×4 matrix and no vertex
   * data. This is what `LOD_ROOM_BUDGET_BYTES` bounds.
   */
  readonly decodedBytes: number
}

export interface BuildRoomOptions {
  /** Loaded objects by content address. A blob absent from the map is a gap. */
  readonly geometries: ReadonlyMap<string, LodGeometry>
  /** Memoised by the caller — the whole archive collapses to 16 families. */
  readonly resolve: (record: CatalogRecord) => Resolution
  /** `VIEW_RADIUS` from `src/three/geometry.ts`. Injected so this stays three-free of Stage. */
  readonly viewRadius: number
  /** Grid units of mesh-versus-footprint disagreement worth reporting. Default 0.25. */
  readonly reportDeltaOver?: number
  readonly budget?: number
}

/**
 * Grid units of footprint disagreement worth surfacing. Half a wall thickness.
 *
 * `WALL_THICKNESS_UNITS` is 0.5, and the plan view already discloses a
 * *radial* error of up to 0.5 units on the 462 fallback-band curves
 * (`placementCaveat`). So half of that is the point below which a disagreement
 * says nothing the plan view has not already said, and above which the mesh and
 * the tags are telling the user two different things about the same tile.
 */
export const REPORT_DELTA_OVER_UNITS = 0.25

/**
 * Group a plan scene's pieces into instanced draws.
 *
 * Pure: no React, no store, no fetch. It takes the scene the plan view drew and
 * a map of whatever geometry has arrived, and it is total — a room with nothing
 * loaded returns zero groups and a full `absent` list rather than throwing.
 */
export function buildRoom3D(scene: PlanScene, options: BuildRoomOptions): Room3D {
  const budget = options.budget ?? lodObjectBudget()
  const threshold = options.reportDeltaOver ?? REPORT_DELTA_OVER_UNITS

  const wanted = new Set<string>()
  for (const piece of scene.pieces) wanted.add(piece.record.blob)

  if (wanted.size > budget) {
    return {
      groups: [],
      bounds: new Box3(),
      fit: fitRoom(new Box3(), options.viewRadius),
      absent: [],
      objects: wanted.size,
      refusal: lodBudgetRefusal(wanted.size, budget),
      disagreements: [],
      instances: 0,
      triangles: 0,
      decodedBytes: 0,
    }
  }

  const groups = new Map<string, MutableGroup>()
  const gaps = new Map<string, { placements: PlacementId[]; name: string }>()
  const disagreements: FootprintDisagreement[] = []

  for (const piece of scene.pieces) {
    const lod = options.geometries.get(piece.record.blob)
    if (lod === undefined) {
      const gap = gaps.get(piece.record.blob)
      if (gap === undefined) gaps.set(piece.record.blob, { placements: [piece.id], name: piece.record.name })
      else gap.placements.push(piece.id)
      continue
    }

    const resolution = options.resolve(piece.record)
    const key = instanceKey(piece.record.blob, resolution.variantKey)
    let group = groups.get(key)
    if (group === undefined) {
      group = { key, blob: piece.record.blob, lod, resolution, matrices: [], placements: [], bounds: new Box3() }
      groups.set(key, group)
      recordDisagreement(disagreements, piece, lod, threshold)
    }

    const matrix = tileMatrix(lod.bounds, planGeometryOf(piece))
    group.matrices.push(matrix)
    group.placements.push(piece.id)
    group.bounds.union(placedBounds(lod.bounds, matrix))
  }

  const built: LodInstanceGroup[] = [...groups.values()].map((group) => ({
    key: group.key,
    blob: group.blob,
    lod: group.lod,
    resolution: group.resolution,
    matrices: group.matrices,
    placements: group.placements,
    count: group.matrices.length,
    bounds: group.bounds,
  }))

  const bounds = roomBounds(built.map((group) => group.bounds))

  return {
    groups: built,
    bounds,
    fit: fitRoom(bounds, options.viewRadius),
    absent: [...gaps.entries()].map(([blob, gap]) => ({
      blob: blob as BlobId,
      placements: gap.placements,
      name: gap.name,
    })),
    objects: wanted.size,
    refusal: null,
    disagreements: disagreements.sort((a, b) => b.worst - a.worst),
    instances: built.reduce((total, group) => total + group.count, 0),
    triangles: built.reduce((total, group) => total + group.count * group.lod.triangles, 0),
    decodedBytes: built.reduce((total, group) => total + group.lod.decodedBytes, 0),
  }
}

interface MutableGroup {
  key: string
  blob: BlobId
  lod: LodGeometry
  resolution: Resolution
  matrices: Matrix4[]
  placements: PlacementId[]
  bounds: Box3
}

/**
 * A `PlanPiece` read back as the `PlanGeometry` it was built from.
 *
 * `buildPlanScene` spreads `planGeometry`'s fields onto the piece rather than
 * nesting the object, so this reassembles the four `tileMatrix` reads from the
 * piece's own fields. It computes nothing: `box` and `angle` are the plan's, and
 * `axisAligned` and `parts` come along unchanged.
 */
function planGeometryOf(piece: PlanPiece) {
  return {
    shape: piece.shape,
    rotation: piece.placement.rotation,
    angle: piece.angle,
    box: piece.box,
    parts: piece.parts,
    axisAligned: piece.axisAligned,
  }
}

function recordDisagreement(
  into: FootprintDisagreement[],
  piece: PlanPiece,
  lod: LodGeometry,
  threshold: number,
): void {
  const delta = lod.footprintDelta(piece.shape.extent)
  if (delta.worst <= threshold) return
  into.push({ blob: piece.record.blob, name: piece.record.name, worst: delta.worst })
}
