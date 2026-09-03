/**
 * The base under each topper: which one, where it sits, and how high it lifts
 * the thing standing on it.
 *
 * The owner's requirement for this row is one sentence — *"only in the actual
 * builder 3d view, they will see the base, based on their lock style
 * selection"* — and until now the auto-inserted base was a **bill line that
 * never became geometry**. `buildRoom3D` walked `scene.pieces` and nothing else,
 * so half the corpus drew as a topper resting on the grid with the part that
 * carries its joinery nowhere on screen.
 *
 * ## Rule 1 is asked, never re-derived
 *
 * Which base a topper needs is decided in exactly one function in this project —
 * `@/assembly`'s `resolvePlacement`, whose own docblock says *"a base enters a
 * bill through this module and nowhere else"* — and this module calls it through
 * {@link autoInsertedBase}. That is not tidiness. Row **D1** exists because a
 * ranking that fell through to file size handed out a **print variant** for
 * 79.1% of openlock toppers: 584 of the 1,963 bases (29.7%) are a topless or
 * unsupported print rather than the base itself, and a topless base **has no top
 * surface** — it is a different product, and a topper drawn standing on one would
 * be a picture of something the user cannot build. Re-deriving the choice here
 * would be a second ranking able to disagree with the bill silently.
 *
 * Measured through `resolvePlacement` over all 3,822 items: under openlock
 * **1,878** get a base and **1,878 of 1,878 are `plain`**. Under magnetic 2,765
 * get one and **2** are `topless` — disclosed by `notes.ts#base-option-chosen`,
 * which is the bill's job and not this module's.
 *
 * ## The base takes the topper's footprint, not its own
 *
 * Rule 3 joins a base to a topper on {@link footprintKey}, so *every* matched
 * base is congruent to the piece standing on it — `assembly.test.ts` asserts it
 * over the corpus. So the base is placed with the **topper's** `PlanGeometry`:
 * the same box, the same drawn angle, the same convex parts. Two consequences,
 * and both are the point:
 *
 *   - the base cannot land a fraction of a unit off the tile it belongs to,
 *     because there is only one box and one `tileMatrix` call shape for both; and
 *   - a base whose mesh is *larger* than the topper's — the common case, since a
 *     `plain` base fills the cell while a concave floor does not — is centred on
 *     the cell rather than on the topper's own smaller silhouette. Measured on
 *     one real pair: the 2 × 2 base `9ce4cb74…` is 50.800 × 50.800 mm, exactly
 *     two grid units, where the concave floor standing on it is 45.284 mm.
 *
 * ## The elevation, and why no `Placement` gained a `y`
 *
 * Row R2 left this row a hand-off: it computes `SurfacePick.elevationMm` and
 * deliberately does not apply it, because *"an elevated ghost would sit where the
 * tile will not land"*, and it named R3 as *"the row that can make stacking
 * real"*.
 *
 * Stacking is now real for exactly one case, and that case needs **no stored
 * `y`**: an auto-inserted base is not a placement and never was. It has no
 * `PlacementId`, it cannot be erased, moved or rotated on its own, and its
 * height is a *derivation* of `(design, lock)` — which is why `Placement`,
 * `SHARE_FORMAT_VERSION`, the store schema and `pieceAt` are all untouched by
 * this row. Two people opening one share link under one preference derive the
 * same elevation; under different preferences they *should* differ, because the
 * base differs. A stored `y` would freeze the wrong one, which is the same
 * mistake row V4's docblock catalogues about freezing a file at click time.
 *
 * User-directed stacking — a wall put on top of a floor — still needs a real `y`
 * in the store, and this row does not introduce one. `overlap.ts` already names
 * that seam: *"a later row that gives the instanced 3D builder a real `y`
 * replaces the two bands"*. That row changes the collision model; this one does
 * not.
 *
 * **How high.** The mesh's own upright height, measured, never assumed. Over 193
 * of the 299 distinct bases the three lock preferences can auto-insert
 * (118.8 MB fetched from `/models/` in 27.1 s — the other 106 are 522 MB and were
 * sampled out, not excluded on principle):
 *
 * | | mm |
 * | --- | ---: |
 * | minimum | 5.998 |
 * | median | **6.002** |
 * | p95 | 12.700 |
 * | maximum | 12.700 |
 *
 * 173 of 193 are within 0.05 mm of **6.000**; twelve are 12.700 (a half-inch
 * double base) and eight are 6.400 (a quarter inch). Every one of them rests on
 * `z = 0` in its own file, to within 0.023 mm.
 *
 * That table is the whole argument for lifting the topper. **The median base is
 * 6.00 mm and the median floor tile is 4.50 mm**, so a base and a topper both
 * resting on `y = 0` do not merely touch — the tile is *entirely inside* the base
 * it is supposed to be standing on, and the room would show one object where the
 * bill lists two. 90 of the 193 are ASCII STLs, incidentally, which is fine:
 * `@/three/stl/parse` detects the encoding from the facet-count arithmetic rather
 * than by sniffing for `solid`, and R1's converter reuses it.
 *
 * ## A base with no mesh is a plate, exactly as a tile with no mesh is
 *
 * R2 established the answer and this row reuses it rather than inventing a
 * second absent-geometry state: the footprint the catalog tagged, drawn flat at
 * `PLATE_HEIGHT_MM`. The topper above it is then lifted by
 * {@link ABSENT_BASE_ELEVATION_MM} rather than by a measurement nobody has, so
 * the plate stays visible under it and the two surfaces are not coplanar — the
 * same reason `SURFACE_GRID_DROP_MM` exists.
 */
import type { AssemblyIndex, AssemblyPart } from '@/assembly'
import type { PlanPiece, PlanScene, ScenePiece } from '@/builder/canvas'
import { partsOverlap } from '@/builder/canvas'
import type { CatalogRecord, DesignId } from '@/catalog'
import { autoInsertedBase } from '@/mesh/context'
import type { LockSystem, PlacementId } from '@/store'

import type { LodGeometry } from './loadLod'
import { PLATE_HEIGHT_MM } from './markers'
import { meshHeightMm } from './surface'

export { autoInsertedBase }

/**
 * How high a topper stands when its base has no mesh yet: **1.2 mm**.
 *
 * Twice {@link PLATE_HEIGHT_MM}, which is the plate the absent base is drawn as.
 * One plate thickness would put the topper's underside exactly in the plate's own
 * plane, and two coplanar faces at one depth flicker per fragment as the camera
 * moves — the failure `SURFACE_GRID_DROP_MM` was introduced to avoid one plane
 * lower down. The remaining 0.6 mm of air is a fifth of the smallest real base
 * (5.998 mm) and invisible at every zoom the orbit allows.
 */
export const ABSENT_BASE_ELEVATION_MM = PLATE_HEIGHT_MM * 2

/** The base one piece stands on, resolved. */
export interface PieceBase {
  /** The **topper's** placement. A base has no id of its own; see the module note. */
  readonly id: PlacementId
  /**
   * The file the bill lists, straight off `AssemblyPart.record`.
   *
   * The whole of what this row needs, and `BaseMatch` is deliberately **not**
   * carried beside it. The match's one field a reader could act on is `option` —
   * whether this is the plain, unsupported or topless print — and that is already
   * disclosed by name, in the bill, by `notes.ts#base-option-chosen`. A second
   * copy of the same sentence on the canvas would be a second thing to keep
   * true, for a population of **2 items in 3,822** under magnetic and **0** under
   * openlock, dragonlock or no preference.
   */
  readonly record: CatalogRecord
  /**
   * A base is already on the plan under this piece — X10's `base-already-on-plan`.
   *
   * Row X10 measured that suppressing the auto-insert would be worse than
   * disclosing it, so the bill still lists the second base; row V4 firmed the
   * identity up, since `shape|base` is part of the design key and **0 of 3,822**
   * items mix base and non-base variants, so "is this piece a base" is a
   * question with an unambiguous answer. What this flag exists to prevent is the
   * *visual* form of the same problem: two bases drawn in one cell at one height
   * read as a single object, and the user would have no way to see that the
   * download contains two. So a duplicated base is **ringed rather than
   * rendered** — see `RoomSurface.tsx` — and counted in the readout.
   */
  readonly duplicate: boolean
}

/**
 * Every placed piece's base, by the piece's own placement id.
 *
 * Pure: no React, no store, no fetch. A piece that needs no base — 1,497 items
 * are `self-sufficient` under openlock, and 259 are `no-base` because the archive
 * holds nothing congruent — is simply absent from the map, which is what lets the
 * caller treat "no base" and "a base with no mesh" as the different states they
 * are.
 */
export function sceneBases(
  scene: PlanScene,
  assembly: AssemblyIndex,
  lock: LockSystem | undefined,
): ReadonlyMap<PlacementId, PieceBase> {
  const bases = new Map<PlacementId, PieceBase>()
  const onPlan = scene.pieces.filter(isBasePiece)
  // Memoised per design within the pass: a room of forty floor tiles is forty
  // placements of a handful of items, and rule 1's answer is a function of the
  // item and the preference alone. `resolvePlacement` also ranks a candidate
  // list, so this is the difference between one scan per item and one per tile.
  const byDesign = new Map<DesignId, AssemblyPart | undefined>()
  for (const piece of scene.pieces) {
    const design = piece.placement.design
    if (!byDesign.has(design)) byDesign.set(design, autoInsertedBase(design, assembly, lock))
    const part = byDesign.get(design)
    if (part === undefined) continue
    bases.set(piece.id, {
      id: piece.id,
      record: part.record,
      duplicate: standsOnABase(piece, onPlan, scene.generated),
    })
  }
  return bases
}

/**
 * The base the armed item would get, with no placement to hang it on.
 *
 * The ghost's half of the same question. It returns the part rather than a
 * {@link PieceBase} because `duplicate` is a fact about a cell and the ghost is
 * not in a cell yet — `computeGhost` already decides what the ghost's own
 * conflict state is, and a second opinion here would be able to disagree with it.
 */
export function designBase(
  design: DesignId,
  assembly: AssemblyIndex,
  lock: LockSystem | undefined,
): AssemblyPart | undefined {
  return autoInsertedBase(design, assembly, lock)
}

/**
 * How far above the plan the piece standing on this base rests, in millimetres.
 *
 * One function, called by `instances.ts` for the instance matrix and by
 * `RoomSurface.tsx` for the plate, the pick and the ghost. Two copies of this
 * rule is how a tile comes to be drawn at one height and picked at another,
 * which is the class of bug `surface.ts`'s multi-plane pick exists to remove.
 *
 * `0` for a piece with no base at all — the majority of the plan view's history
 * and still 1,497 of 3,822 items under openlock.
 */
export function baseElevationMm(
  base: PieceBase | AssemblyPart | undefined,
  geometries: ReadonlyMap<string, LodGeometry>,
): number {
  if (base === undefined) return 0
  const lod = geometries.get(base.record.blob)
  return lod === undefined ? ABSENT_BASE_ELEVATION_MM : meshHeightMm(lod.bounds)
}

/* -------------------------------------------------------------------- helpers */

/** Whether a placed catalog piece is itself a base. `layer` is the aggregate's. */
function isBasePiece(piece: PlanPiece): boolean {
  return piece.record.layer === 'base'
}

/**
 * Whether some base already on the plan covers this piece's ground.
 *
 * Both populations, because both are bases a user put there: a catalogued one is
 * a `PlanPiece` with `layer: 'base'`, and every `GeneratedPlanPiece` is a base by
 * construction — that is the only thing row S5's generator makes. Tested with
 * `overlap.ts`'s own `partsOverlap`, so "covers this ground" means exactly what
 * the conflict sweep means by it and not something adjacent to it.
 */
function standsOnABase(
  piece: PlanPiece,
  onPlan: readonly PlanPiece[],
  generated: readonly ScenePiece[],
): boolean {
  for (const other of onPlan) {
    if (other.id !== piece.id && partsOverlap(other.parts, piece.parts)) return true
  }
  for (const other of generated) {
    if (partsOverlap(other.parts, piece.parts)) return true
  }
  return false
}
