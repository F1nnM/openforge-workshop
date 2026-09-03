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
 * ## Two of the three refusals are `buildPlanScene`'s, unchanged
 *
 * `unknown` (a retired tile id) and `undrawable` (footprint `none`) come
 * straight out of `buildPlanScene` and are passed through, not re-derived. A
 * third is this row's own: **`absent`**, an object the `/lod/` store does not
 * hold. Since blocker **B2** is open and nothing is uploaded, that is currently
 * every object — see `lod.ts`.
 *
 * ## Row R3: half the room was never in the scene
 *
 * A `PlanScene` holds what the user *placed*, and for **1,878 of 3,822 items
 * under openlock** that is one of the two parts they will print: rule 1
 * auto-inserts a base, and the base is a different design with a different blob.
 * It was a bill line and never geometry, which is what the owner asked this row
 * to fix — *"only in the actual builder 3d view, they will see the base, based on
 * their lock style selection"*.
 *
 * So this function now takes {@link BuildRoomOptions.bases} beside the scene and
 * emits {@link Room3D.baseGroups} beside the groups. Two facts make that nearly
 * free, and both are measured in `bases.ts`: the corpus reaches only **84**
 * distinct base blobs under openlock, so instancing collapses a whole room's
 * bases into two or three draws; and the median base is **0.91 MB and 3,826
 * triangles** against the median tile's 10.77 MB and 215,314.
 *
 * The one thing it is not free of is **position**: a base 6.00 mm tall under a
 * 4.50 mm floor tile means the tile can no longer rest on `y = 0`, which is why
 * `place.ts` gained {@link liftMatrix}. Nothing about a `Placement` changed —
 * `bases.ts` sets out why an auto-base's elevation is a derivation and not a
 * field.
 */
import type { Matrix4 } from 'three';
import { Box3 } from 'three'

import type { PlanPiece, PlanScene } from '@/builder/canvas'
import type { BlobId, CatalogRecord } from '@/catalog'
import type { Resolution } from '@/materials'
import type { PlacementId } from '@/store'

import type { PieceBase } from './bases'
import { baseElevationMm } from './bases'
import type { LodGeometry } from './loadLod'
import { lodBudgetRefusal, lodObjectBudget } from './lod'
import type { RoomFit } from './place'
import { fitRoom, liftMatrix, placedBounds, roomBounds, tileMatrix } from './place'

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
  /**
   * The placement each matrix belongs to.
   *
   * In a {@link Room3D.baseGroups} group these are the **toppers** the base sits
   * under, not placements of the base: an auto-inserted base has no
   * `PlacementId` of its own and cannot be erased, moved or rotated. That is the
   * reason the bases are a second list rather than more entries in
   * {@link Room3D.groups}.
   */
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
  /**
   * The auto-inserted bases, as their own instance groups — row **R3**.
   *
   * A second list rather than more entries in {@link groups}, and the reasoning
   * is `scene.ts`'s for `PlanScene.generated`: *"a second `map`, not a second
   * pipeline"*. Two things make the split the honest one here:
   *
   *   - `LodInstanceGroup.placements` names *"one per placement"*, and a base has
   *     no placement of its own — the ids in a base group are the **toppers** it
   *     sits under. Merging the lists would make one field mean two things.
   *   - a base blob can also be a *hand-placed* base's blob, and merging would
   *     put both in one group whose id list no reader could split again.
   *
   * They are painted first, which is not a tie-break: a base is the thing you
   * put under a topper. Instancing still collapses them hard — the whole corpus
   * reaches **84** distinct base blobs under openlock — so a forty-tile room adds
   * two or three draw calls, not forty.
   */
  readonly baseGroups: readonly LodInstanceGroup[]
  /**
   * Toppers whose base the bill lists and neither store holds a mesh for.
   *
   * Drawn as a footprint plate, exactly as a mesh-less tile is. `placements`
   * names the toppers standing on the missing base.
   */
  readonly absentBases: readonly LodGap[]
  /**
   * Toppers whose auto-base was suppressed because one is already on the plan.
   *
   * X10's `base-already-on-plan`, in its visual form — see `bases.ts`. The bill
   * still lists the second base; the room rings it instead of drawing a solid
   * that would look like the base already there.
   */
  readonly duplicateBases: readonly PlacementId[]
  /** Union of every group's bounds, in millimetres. Empty for an empty room. */
  readonly bounds: Box3
  /** The normalisation that puts the room in `Stage`'s frame. */
  readonly fit: RoomFit
  /** Placements the store has no object for. Expected today — blocker B2. */
  readonly absent: readonly LodGap[]
  /** Distinct objects the room needs, loaded or not. What the budget counts. */
  readonly objects: number
  /**
   * Set when `objects` is over {@link lodObjectBudget}.
   *
   * Row R4 deleted the plan view, so this no longer means "the room stays in
   * plan view" — there is nothing underneath to stay in. A refusal now renders
   * the notice and no room at all, which is why `lodBudgetRefusal` names
   * distinct *designs* to take off the plan rather than tiles: the axis is
   * distinct meshes, and "remove some tiles" would send a user to delete the
   * wrong ones.
   */
  readonly refusal: string | null
  /** Tiles whose mesh and tagged footprint disagree by more than `reportDeltaOver`. */
  readonly disagreements: readonly FootprintDisagreement[]
  /**
   * Placed **tiles** actually drawn, across {@link groups}.
   *
   * Tiles only, and it stayed that way through row R3 on purpose: the readout
   * puts this against the count of pieces drawn as a plate, and folding the
   * bases in would produce a line saying *"2 drawn, 2 outlined"* about a room
   * holding two outlined tiles standing on two drawn bases. That sentence was
   * written, seen in a browser and removed. {@link baseInstances} is the other
   * population, on its own line.
   */
  readonly instances: number
  /** Auto-inserted bases actually drawn, across {@link baseGroups}. Row R3. */
  readonly baseInstances: number
  /**
   * Triangles actually drawn — the sum over instances, not over geometries.
   *
   * **Both** populations, unlike {@link instances}, and the asymmetry is the
   * point: this is what the frame costs and the GPU does not care which half of
   * an assembly a triangle belongs to. The bases are cheap in it — a median base
   * is 3,826 source triangles against a median tile's 215,314.
   */
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
  /**
   * The auto-inserted base under each piece — `bases.ts`'s `sceneBases`.
   *
   * Optional, and absence means *"this caller has not resolved the bases"* rather
   * than *"there are none"*: the room's own tests, the fixtures and any future
   * caller with no assembly index in hand pass nothing and get exactly the
   * pre-R3 room back, with every topper on `y = 0`. `BuilderRoom` passes one.
   */
  readonly bases?: ReadonlyMap<PlacementId, PieceBase>
  /** `VIEW_RADIUS` from `src/three/geometry.ts`. Injected so this stays three-free of Stage. */
  readonly viewRadius: number
  /** Grid units of mesh-versus-footprint disagreement worth reporting. Default 0.25. */
  readonly reportDeltaOver?: number
  readonly budget?: number
}

/**
 * Grid units of footprint disagreement worth surfacing. Half a wall thickness.
 *
 * `WALL_THICKNESS_UNITS` is 0.5, and the surface already discloses a
 * *radial* error of up to 0.5 units on the 462 fallback-band curves
 * (`placementCaveat`). So half of that is the point below which a disagreement
 * says nothing the surface has not already said, and above which the mesh and
 * the tags are telling the user two different things about the same tile.
 */
export const REPORT_DELTA_OVER_UNITS = 0.25

/**
 * Group a plan scene's pieces into instanced draws.
 *
 * Pure: no React, no store, no fetch. It takes the `PlanScene` the surface
 * draws — `plan` being the plan of the room rather than the deleted 2D view — and
 * a map of whatever geometry has arrived, and it is total — a room with nothing
 * loaded returns zero groups and a full `absent` list rather than throwing.
 */
export function buildRoom3D(scene: PlanScene, options: BuildRoomOptions): Room3D {
  const budget = options.budget ?? lodObjectBudget()
  const threshold = options.reportDeltaOver ?? REPORT_DELTA_OVER_UNITS

  const bases = options.bases ?? EMPTY_BASES

  // Bases count against the object budget too, because they are objects in the
  // room: the budget bounds *distinct meshes* and a base is one. It is a cheap
  // addition — the whole corpus reaches 84 distinct base blobs under openlock, so
  // a room adds two or three rather than one per tile.
  const wanted = new Set<string>()
  for (const piece of scene.pieces) {
    wanted.add(piece.record.blob)
    // Counted even for a `duplicate`, which is not drawn: its **height** is
    // still what lifts the topper standing on it, and a height is a
    // measurement of a mesh. Suppressing the load as well would leave the topper
    // on `ABSENT_BASE_ELEVATION_MM` and sunk into the hand-placed base beside it.
    const base = bases.get(piece.id)
    if (base !== undefined) wanted.add(base.record.blob)
  }

  if (wanted.size > budget) {
    return {
      groups: [],
      baseGroups: [],
      absentBases: [],
      duplicateBases: [],
      bounds: new Box3(),
      fit: fitRoom(new Box3(), options.viewRadius),
      absent: [],
      objects: wanted.size,
      refusal: lodBudgetRefusal(wanted.size, budget),
      disagreements: [],
      instances: 0,
      baseInstances: 0,
      triangles: 0,
      decodedBytes: 0,
    }
  }

  const groups = new Map<string, MutableGroup>()
  const baseGroups = new Map<string, MutableGroup>()
  const gaps = new Map<string, { placements: PlacementId[]; name: string }>()
  const baseGaps = new Map<string, { placements: PlacementId[]; name: string }>()
  const duplicateBases: PlacementId[] = []
  const disagreements: FootprintDisagreement[] = []

  for (const piece of scene.pieces) {
    const geometry = planGeometryOf(piece)
    const base = bases.get(piece.id)
    // One elevation per piece, from one function, used for the base's own matrix
    // (zero — it stands on the plan), for the topper's, and by `RoomSurface` for
    // the plate, the pick and the ghost. See `bases.ts`.
    const elevationMm = baseElevationMm(base, options.geometries)

    if (base !== undefined) {
      if (base.duplicate) duplicateBases.push(piece.id)
      else {
        const baseLod = options.geometries.get(base.record.blob)
        if (baseLod === undefined) push(baseGaps, base.record.blob, piece.id, base.record.name)
        else {
          // The **topper's** geometry, not the base's own: rule 3 joins on the
          // congruent footprint, so this is the same box, and one box means the
          // two cannot land a fraction of a unit apart.
          addInstance(baseGroups, base.record, baseLod, options.resolve(base.record), geometry, piece.id, 0)
        }
      }
    }

    const lod = options.geometries.get(piece.record.blob)
    if (lod === undefined) {
      push(gaps, piece.record.blob, piece.id, piece.record.name)
      continue
    }

    const fresh = addInstance(
      groups,
      piece.record,
      lod,
      options.resolve(piece.record),
      geometry,
      piece.id,
      elevationMm,
    )
    if (fresh) recordDisagreement(disagreements, piece, lod, threshold)
  }

  const built = finish(groups)
  const builtBases = finish(baseGroups)
  const bounds = roomBounds([...builtBases, ...built].map((group) => group.bounds))
  // By **blob**, which is one entry per resident geometry: `useLodStore` holds
  // one `LodGeometry` per content address, so a blob reached by two groups — a
  // base under one topper and hand-placed beside it — holds its arrays once. The
  // pre-R3 sum was per group, which was the same number while there was one list.
  const resident = new Map<string, LodGeometry>()
  for (const group of [...built, ...builtBases]) resident.set(group.blob, group.lod)

  return {
    groups: built,
    baseGroups: builtBases,
    absentBases: asGaps(baseGaps),
    duplicateBases,
    bounds,
    fit: fitRoom(bounds, options.viewRadius),
    absent: asGaps(gaps),
    objects: wanted.size,
    refusal: null,
    disagreements: disagreements.sort((a, b) => b.worst - a.worst),
    instances: total(built),
    baseInstances: total(builtBases),
    triangles:
      built.reduce((sum, group) => sum + group.count * group.lod.triangles, 0) +
      builtBases.reduce((sum, group) => sum + group.count * group.lod.triangles, 0),
    decodedBytes: [...resident.values()].reduce((sum, lod) => sum + lod.decodedBytes, 0),
  }
}

const EMPTY_BASES: ReadonlyMap<PlacementId, PieceBase> = new Map()

/**
 * Add one instance to its group, creating the group on first sight.
 *
 * Returns whether the group was created, which is what the footprint-disagreement
 * report keys on — it is a fact about a *mesh against its tags* and must be
 * recorded once per geometry rather than once per placement.
 */
function addInstance(
  into: Map<string, MutableGroup>,
  record: CatalogRecord,
  lod: LodGeometry,
  resolution: Resolution,
  geometry: ReturnType<typeof planGeometryOf>,
  id: PlacementId,
  elevationMm: number,
): boolean {
  const key = instanceKey(record.blob, resolution.variantKey)
  let group = into.get(key)
  const fresh = group === undefined
  if (group === undefined) {
    group = { key, blob: record.blob, lod, resolution, matrices: [], placements: [], bounds: new Box3() }
    into.set(key, group)
  }
  const matrix = liftMatrix(tileMatrix(lod.bounds, geometry), elevationMm)
  group.matrices.push(matrix)
  group.placements.push(id)
  group.bounds.union(placedBounds(lod.bounds, matrix))
  return fresh
}

function finish(groups: Map<string, MutableGroup>): LodInstanceGroup[] {
  return [...groups.values()].map((group) => ({
    key: group.key,
    blob: group.blob,
    lod: group.lod,
    resolution: group.resolution,
    matrices: group.matrices,
    placements: group.placements,
    count: group.matrices.length,
    bounds: group.bounds,
  }))
}

function total(groups: readonly LodInstanceGroup[]): number {
  return groups.reduce((sum, group) => sum + group.count, 0)
}

function push(
  gaps: Map<string, { placements: PlacementId[]; name: string }>,
  blob: string,
  id: PlacementId,
  name: string,
): void {
  const gap = gaps.get(blob)
  if (gap === undefined) gaps.set(blob, { placements: [id], name })
  else gap.placements.push(id)
}

function asGaps(gaps: Map<string, { placements: PlacementId[]; name: string }>): LodGap[] {
  return [...gaps.entries()].map(([blob, gap]) => ({
    blob: blob as BlobId,
    placements: gap.placements,
    name: gap.name,
  }))
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
