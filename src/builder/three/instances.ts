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
 * Since row **A1** the point is sharper still, because a fill names an exact file
 * (decision **D1**) rather than an item: `part.record` **is** one blob, and the
 * grouping is a fact about the store's own key rather than a resolution.
 *
 * The material is part of the key too, at `resolution.variantKey`, because an
 * `InstancedMesh` has one material as well as one geometry. In practice that
 * splits nothing: a blob is one file, so its tags and therefore its family are
 * fixed. It is in the key so that the 102 cross-design md5s cannot silently
 * inherit whichever family happened to be resolved first.
 *
 * ## Row A4b: the unit of a draw is a **part**, not a placement
 *
 * This is the whole of A1's arity change arriving here. A placement used to be
 * one file on one cell and therefore one instance matrix; it is now a
 * {@link TemplateInstance} with a fill per named slot, and row **A4a** projects
 * it as a {@link PlanPiece} holding a {@link PlanPiecePart} per filled slot. So
 * this module walks **two** loops and everything it counts is per part:
 *
 *   - the group a part joins is its **own** `part.record.blob` — five slots of
 *     one instance are five files and in general five geometries;
 *   - the matrix is `tileMatrix` over the part's own box and drawn angle, lifted
 *     by `part.layout.elevationMm`; and
 *   - `LodInstanceGroup.placements` names the **instance** each matrix belongs
 *     to, so an id repeats when two slots of one template are filled with the
 *     same file. That is what keeps a pick, an erase and a move addressed to a
 *     placement while the draw is addressed to a part.
 *
 * ## Rule 1 and the base groups are **deleted**, not repointed — row A3
 *
 * Row R3 added a second population here: `bases`, `baseGroups`, `absentBases`,
 * `duplicateBases` and `baseInstances`, all of them downstream of *inferring*
 * which base a topper needs. That inference is rule 1, row **A3** deletes it, and
 * a template now **declares** its base as an explicit slot — so a base is simply
 * one more part with an elevation, drawn by the loop above, instanced in the same
 * map, counted in the same total and gapped in the same list. `bases.ts` is
 * deleted rather than pointed at the new shape: there is nothing left for it to
 * decide.
 *
 * The elevation it used to derive from a mesh measurement arrives instead as
 * {@link SlotLayout.elevationMm}, which is **normalised and never read from the
 * file** — `geometry.ts` measures why: 18.4% of `openforge` toppers are authored
 * pre-lifted by exactly 6.0 mm and 77.5% are not, so a height taken off the mesh
 * encodes that inconsistency. R3's median-6.00 mm table was a measurement of the
 * archive's bases and is superseded by a rule that states the lift. There is
 * therefore exactly **one** elevation source, and `liftMatrix` is still where it
 * is applied.
 *
 * ## What 50 instances across 20 files costs
 *
 * At worst 20 geometries — a fill names a file and a file is one blob — so
 * **20 `InstancedMesh`es, 20 GLB fetches and 50 instance matrices**. Draw calls
 * go 50 → 20; the 30 repeat parts cost one 4×4 matrix each and no bytes at all.
 * Templates make that ratio *better* rather than worse: 40 of the 40 shipped
 * families carry a `floor` and a `base`, so 80 of their 128 parts are two slots
 * drawing out of the same handful of files.
 *
 * `instances.test.ts` runs that projection over the first twenty files of the
 * emitted index rather than asserting the arithmetic, and the material count is
 * the part worth having measured: those twenty land on **one** family, so the
 * twenty meshes share a single refcounted `MeshStandardMaterial`. The registry
 * collapses the whole 8,702-record archive to 16 families, so 16 is the ceiling
 * for any room however large.
 *
 * ## Three of the four refusals are `buildPlanScene`'s, unchanged
 *
 * `unknown` (a retired file id), `undrawable` (footprint `none`) and `unfilled`
 * (an instance with no filled slot at all — contract **C-g**) come straight out
 * of `buildPlanScene` and are passed through the caller, not re-derived here. A
 * fourth is this row's own: **`absent`**, an object the `/lod/` store does not
 * hold. Since blocker **B2** is open and nothing is uploaded, that is currently
 * every object — see `lod.ts`.
 *
 * ## Contract C-d: the object set, and how it relates to A2's warming set
 *
 * {@link roomBlobs} states the derivation once. A2 warms
 * `{ blob(tile) | tile in filledSlots of every instance }`; this asks for the
 * parts' blobs **and the accessories' anchored ones**, and the two differ by
 * exactly the parts `buildPlanScene` put in `PlanScene.undrawable` — a filled
 * slot whose file has a `none` footprint has a blob and nothing to draw it on.
 * So **this set is a subset of A2's**, which is the safe direction and the one
 * that matters: every object this room asks for is an object A2 has warmed, so no
 * blob can strand as *"not in the store"* through a disagreement between the two
 * derivations. The reverse difference costs a conversion nobody looks at.
 * `state.generated` is in neither set: a generated base has no catalog record and
 * no blob, and `RoomSurface` plates it.
 *
 * ## An accessory is a third population, and it is drawn like the other two
 *
 * A {@link PlanPiece} carries an accessory per *(hold, measured mount)*: a torch
 * in a wall, a leaf in a doorway. They join the **same** groups
 * as the parts — an insert is a blob and a material like anything else, and two
 * torches in one room are one draw — and they are addressed to the same
 * placement, so a click on a torch reaches the piece it hangs off. What differs
 * is only the matrix, which comes from `place.ts#accessoryMatrix` rather than
 * from `tileMatrix`: an accessory has no footprint and no cell, it has a host's
 * face and a measured pose on it.
 */
import type { Matrix4 } from 'three';
import { Box3 } from 'three'

import type { PlanAccessory, PlanGeometry, PlanPiece, PlanPiecePart, PlanScene } from '@/builder/canvas'
import type { BlobId, CatalogRecord, InsertAnchor, Mount } from '@/catalog'
import type { Resolution } from '@/materials'
import type { PlacementId } from '@/store'

import type { LodGeometry } from './loadLod'
import { lodBudgetRefusal, lodObjectBudget } from './lod'
import type { RoomFit } from './place'
import { accessoryMatrix, fitRoom, isLeafPair, liftMatrix, placedBounds, roomBounds, tileMatrix } from './place'

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
  /** One per drawn **part**, in the scene's own order. `count === matrices.length`. */
  readonly matrices: readonly Matrix4[]
  /**
   * The **instance** each matrix belongs to, one per matrix.
   *
   * An id repeats when two slots of one template are filled with the same file —
   * which is ordinary, not a defect: a corridor with two identical walls is one
   * placement and two draws. Every gesture is addressed to a placement, so this
   * is the field a pick, an erase and a move resolve through; `partAt` in
   * `@/builder/canvas` is what narrows a placement to the slot inside it.
   */
  readonly placements: readonly PlacementId[]
  readonly count: number
  /** Union of every instance's world bounds, in millimetres. */
  readonly bounds: Box3
}

/** A part whose store object is not there. */
export interface LodGap {
  readonly blob: BlobId
  /** The instances with a part on this object, each named once. */
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
  /** Parts the store has no object for. Expected today — blocker B2. */
  readonly absent: readonly LodGap[]
  /**
   * Accessories with nowhere to go — `PlanScene.unplaced`, counted.
   *
   * A **count of the scene's own list and not a second opinion**: the hold is
   * real, `assembly/resolve.ts` puts it in the zip, and nothing has measured
   * where it attaches — so there are no coordinates to draw one at and not even
   * a marker to put on the plan. The surface says so in a sentence because the
   * alternative is silence about a tile the bill charges for.
   */
  readonly unplaced: number
  /** Distinct objects the room needs, loaded or not. What the budget counts. */
  readonly objects: number
  /**
   * Set when `objects` is over {@link lodObjectBudget}.
   *
   * Row R4 deleted the plan view, so this no longer means "the room stays in
   * plan view" — there is nothing underneath to stay in. A refusal now renders
   * the notice and no room at all, which is why `lodBudgetRefusal` names
   * distinct meshes to take off the plan rather than tiles: the axis is
   * distinct meshes, and "remove some tiles" would send a user to delete the
   * wrong ones.
   */
  readonly refusal: string | null
  /** Parts whose mesh and tagged footprint disagree by more than `reportDeltaOver`. */
  readonly disagreements: readonly FootprintDisagreement[]
  /**
   * Drawn **parts**, across {@link groups}.
   *
   * Parts and not placements, and that is row A4b's arity change stated in a
   * counter: the readout puts this against `groups.length` to make the
   * instancing claim, and both halves of that sentence have to be about the same
   * unit. A room of ten three-part templates is thirty instances in as few as
   * three draws, and *"10 drawn in 3 instanced meshes"* would understate the
   * work by a factor of three.
   *
   * The bases are in it. R3 kept them on a line of their own because they were
   * a second population reached by inference; a declared `base` slot is an
   * ordinary part and there is nothing left to separate.
   *
   * **The accessories are in it too**, one per measured mount and two per
   * two-leaf doorway, for the reason the counter exists at all: the readout puts
   * this against `groups.length` to make the instancing claim, and a torch in a
   * wall is a draw the frame pays for whether or not it fills a slot of the
   * template.
   */
  readonly instances: number
  /**
   * Triangles actually drawn — the sum over instances, not over geometries.
   *
   * What the frame costs. A base is cheap in it — a median base is 3,826 source
   * triangles against a median tile's 215,314 — which is now visible as the
   * spread within one figure rather than as two.
   */
  readonly triangles: number
  /**
   * Decoded typed-array bytes the loaded geometries hold.
   *
   * Summed over *geometries* and not over instances, which is the whole point of
   * instancing: a second part on the same file costs a 4×4 matrix and no vertex
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
 * `WALL_THICKNESS_UNITS` is 0.5, and the surface already discloses a
 * *radial* error of up to 0.5 units on the 462 fallback-band curves
 * (`placementCaveat`). So half of that is the point below which a disagreement
 * says nothing the surface has not already said, and above which the mesh and
 * the tags are telling the user two different things about the same tile.
 */
export const REPORT_DELTA_OVER_UNITS = 0.25

/**
 * Every object the room needs, deduplicated — contract **C-d**, stated once.
 *
 * One function rather than a loop inside `buildRoom3D`, because `BuilderRoom`
 * needs the same answer to decide what to *load* and the two must not be able to
 * disagree: a room that drew from one derivation and fetched from another would
 * report *"not in the store"* for a blob it had never asked for, which is a
 * message the app already shows legitimately and so an invisible failure.
 *
 * See the module note for how this relates to A2's warming set.
 */
export function roomBlobs(scene: PlanScene): ReadonlySet<BlobId> {
  const blobs = new Set<BlobId>()
  for (const piece of scene.pieces) {
    for (const part of piece.parts) blobs.add(part.record.blob)
    // The accessories too, and **only the ones that can be drawn**: an insert
    // with no measured `anchor` has nowhere on its own mesh to be plugged in by,
    // so it is neither drawn nor asked for and the fetch set stays the draw set.
    for (const accessory of piece.accessories) {
      if (accessory.record.anchor !== undefined) blobs.add(accessory.record.blob)
    }
  }
  return blobs
}

/**
 * Group a plan scene's parts into instanced draws.
 *
 * Pure: no React, no store, no fetch. It takes the `PlanScene` the surface
 * draws — `plan` being the plan of the room rather than the deleted 2D view — and
 * a map of whatever geometry has arrived, and it is total: a room with nothing
 * loaded returns zero groups and a full `absent` list rather than throwing.
 */
export function buildRoom3D(scene: PlanScene, options: BuildRoomOptions): Room3D {
  const budget = options.budget ?? lodObjectBudget()
  const threshold = options.reportDeltaOver ?? REPORT_DELTA_OVER_UNITS

  const wanted = roomBlobs(scene)

  if (wanted.size > budget) {
    return {
      groups: [],
      bounds: new Box3(),
      fit: fitRoom(new Box3(), options.viewRadius),
      absent: [],
      unplaced: scene.unplaced.length,
      objects: wanted.size,
      refusal: lodBudgetRefusal(wanted.size, budget),
      disagreements: [],
      instances: 0,
      triangles: 0,
      decodedBytes: 0,
    }
  }

  const groups = new Map<string, MutableGroup>()
  const gaps = new Map<string, MutableGap>()
  const disagreements: FootprintDisagreement[] = []

  for (const piece of scene.pieces) {
    for (const part of piece.parts) {
      const lod = options.geometries.get(part.record.blob)
      if (lod === undefined) {
        push(gaps, part.record.blob, piece.id, part.record.name)
        continue
      }
      const matrix = liftMatrix(tileMatrix(lod.bounds, partGeometry(piece, part)), part.layout.elevationMm)
      const fresh = addInstance(groups, part.record, lod, options.resolve(part.record), matrix, piece.id)
      if (fresh) recordDisagreement(disagreements, part, lod, threshold)
    }
    for (const accessory of piece.accessories) {
      addAccessory(groups, gaps, piece, accessory, options)
    }
  }

  const built = finish(groups)
  const bounds = roomBounds(built.map((group) => group.bounds))
  // By **blob**, which is one entry per resident geometry: `useLodStore` holds
  // one `LodGeometry` per content address, so a blob reached by two groups — one
  // material variant of it in two rooms' worth of tags — holds its arrays once.
  const resident = new Map<string, LodGeometry>()
  for (const group of built) resident.set(group.blob, group.lod)

  return {
    groups: built,
    bounds,
    fit: fitRoom(bounds, options.viewRadius),
    absent: asGaps(gaps),
    unplaced: scene.unplaced.length,
    objects: wanted.size,
    refusal: null,
    disagreements: disagreements.sort((a, b) => b.worst - a.worst),
    instances: built.reduce((sum, group) => sum + group.count, 0),
    triangles: built.reduce((sum, group) => sum + group.count * group.lod.triangles, 0),
    decodedBytes: [...resident.values()].reduce((sum, lod) => sum + lod.decodedBytes, 0),
  }
}

/**
 * One part read back as the {@link PlanGeometry} `tileMatrix` takes.
 *
 * It computes nothing: `box`, `angle`, `axisAligned` and the polygons are all
 * A4a's own, resolved by `slotGeometry` against the instance's origin and
 * rotation, and `box.x`/`box.z` on a part **is** its world anchor. `rotation` is
 * the *instance's* stored angle, which is the one field that is not the part's —
 * `PlanGeometry` carries both because `angle` already folds in the slot's yaw and
 * the footprint's intrinsic turn, and a caller that wanted the stored one would
 * otherwise have to reach back up to the piece.
 */
function partGeometry(piece: PlanPiece, part: PlanPiecePart): PlanGeometry {
  return {
    shape: part.shape,
    rotation: piece.placement.rotation,
    angle: part.angle,
    box: part.box,
    parts: part.polygons,
    axisAligned: part.axisAligned,
  }
}

/**
 * Add one instance to its group, creating the group on first sight.
 *
 * **The matrix arrives built**, because the two populations that reach here
 * compose theirs differently: a part is `tileMatrix` lifted by its slot
 * elevation, and an accessory is `accessoryMatrix` over its host's frame and its
 * own anchor. Deriving either one *inside* this function would need it to know
 * which it was looking at, and the grouping is the same fact about a blob and a
 * material either way.
 *
 * Returns whether the group was created, which is what the footprint-disagreement
 * report keys on — it is a fact about a *mesh against its tags* and must be
 * recorded once per geometry rather than once per part.
 */
function addInstance(
  into: Map<string, MutableGroup>,
  record: CatalogRecord,
  lod: LodGeometry,
  resolution: Resolution,
  matrix: Matrix4,
  id: PlacementId,
): boolean {
  const key = instanceKey(record.blob, resolution.variantKey)
  let group = into.get(key)
  const fresh = group === undefined
  if (group === undefined) {
    group = { key, blob: record.blob, lod, resolution, matrices: [], placements: [], bounds: new Box3() }
    into.set(key, group)
  }
  group.matrices.push(matrix)
  group.placements.push(id)
  group.bounds.union(placedBounds(lod.bounds, matrix))
  return fresh
}

/**
 * Draw one accessory: an instance per leaf, at the mount its host was measured
 * at.
 *
 * Three things it does **not** do, each because something else already does:
 *
 *   - **No footprint disagreement.** An insert's footprint is `none` — it
 *     occupies no square on the plan — so there is no tagged extent for its mesh
 *     to disagree with. `recordDisagreement` is a part's report and stays one.
 *   - **No second opinion about the mount.** `PlanAccessory` is already one per
 *     *(hold, mount)*, which is also what `assembly/bill.ts` prices, so the
 *     count of torches drawn and the count charged for agree by construction.
 *   - **Nothing for an unmeasured insert.** `record.anchor` is absent on every
 *     insert nobody has measured, and there is no way to seat one without it.
 *     {@link roomBlobs} leaves those out of the fetch for the same reason, so
 *     this is a skip and not a gap.
 *
 * The gap it *does* record is the ordinary one: an insert whose object the store
 * does not hold is absent exactly as a part's is, named once per placement.
 */
function addAccessory(
  groups: Map<string, MutableGroup>,
  gaps: Map<string, MutableGap>,
  piece: PlanPiece,
  accessory: PlanAccessory,
  options: BuildRoomOptions,
): void {
  const anchor = accessory.record.anchor
  if (anchor === undefined) return

  const lod = options.geometries.get(accessory.record.blob)
  if (lod === undefined) {
    push(gaps, accessory.record.blob, piece.id, accessory.record.name)
    return
  }

  const host = {
    geometry: partGeometry(piece, accessory.host),
    elevationMm: accessory.host.layout.elevationMm,
  }
  const insert = { bounds: lod.bounds, anchor }
  const resolution = options.resolve(accessory.record)
  for (const leaf of accessoryLeaves(accessory.mount, anchor)) {
    const matrix = accessoryMatrix(host, accessory.mount, insert, accessory.hold, leaf)
    addInstance(groups, accessory.record, lod, resolution, matrix, piece.id)
  }
}

/**
 * How many copies of one insert this mount takes: **two leaves, or one of
 * anything else.**
 *
 * The rule itself is `place.ts#isLeafPair` and is deliberately not restated
 * here: it decides the offset and the half turn as well as the count, and a
 * second copy that drifted would draw the second leaf on top of the first.
 */
function accessoryLeaves(mount: Mount, anchor: InsertAnchor): readonly (0 | 1)[] {
  return isLeafPair(mount, anchor) ? [0, 1] : [0]
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

interface MutableGap {
  placements: PlacementId[]
  seen: Set<PlacementId>
  name: string
}

/**
 * Record one instance against one absent blob, at most once.
 *
 * Deduplicated on the id, which row A4b made necessary: two slots of one
 * template can be filled with the same file, and a gap list that named the
 * instance twice would make `absent.placements.length` — which `BuilderRoom`
 * counts pieces with — report two outlined tiles where the user sees one.
 */
function push(gaps: Map<string, MutableGap>, blob: string, id: PlacementId, name: string): void {
  const gap = gaps.get(blob)
  if (gap === undefined) {
    gaps.set(blob, { placements: [id], seen: new Set([id]), name })
    return
  }
  if (gap.seen.has(id)) return
  gap.seen.add(id)
  gap.placements.push(id)
}

function asGaps(gaps: Map<string, MutableGap>): LodGap[] {
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

function recordDisagreement(
  into: FootprintDisagreement[],
  part: PlanPiecePart,
  lod: LodGeometry,
  threshold: number,
): void {
  const delta = lod.footprintDelta(part.shape.extent)
  if (delta.worst <= threshold) return
  into.push({ blob: part.record.blob, name: part.record.name, worst: delta.worst })
}
