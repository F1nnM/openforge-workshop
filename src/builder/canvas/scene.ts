/**
 * The scene: the store's placements plus the catalog, turned into things to draw.
 *
 * **The store is the single source of truth.** This module holds no state; it is
 * a pure projection of `WorkshopState.placements`, recomputed when that map
 * changes. Nothing here caches a placement, and there is no parallel scene graph
 * to fall out of step — which is what makes "reload the page and the room is
 * still there" true by construction rather than by a synchronisation routine.
 *
 * Three failure modes are first-class outputs rather than exceptions, because
 * all three are reachable from a *valid* persisted scene:
 *
 *   - **`unknown`** — the placement names a tile this catalog build does not
 *     hold. `src/catalog/schema.ts` rule 3 retires the ordinal of a tile that
 *     leaves the corpus, so a scene saved last month or a share link can name
 *     one. `src/assembly/resolve.ts` treats this the same way: a note and an
 *     empty part list, never a throw. One dead tile must not take a room down.
 *   - **`undrawable`** — the tile is in the catalog but its footprint is `none`,
 *     the one case of seven with nothing to draw. Unreachable through this
 *     canvas, which refuses it, and reachable through a share link written by a
 *     build whose classifier resolved a footprint this one does not: 742 tiles
 *     left `none` in row W3 and 249 more became placeable in W4, so the
 *     population is a moving target by design. It is listed rather than dropped
 *     so the count can be surfaced instead of the room silently losing pieces.
 *   - **`conflicts`** — see `overlap.ts`.
 *
 * ## Paint order
 *
 * Areas first, then edges, then insertion order within each band. That is the
 * order the landing hero paints in (floors, then walls, then what stands on
 * them) and the order the physical build happens in, and it means a wall drawn
 * over a floor tile reads as standing on it rather than as a hole in it.
 *
 * ## Two populations, one scene — row X9
 *
 * A generated base is not a catalog file and has no `CatalogRecord`, so it
 * cannot be a {@link PlanPiece}: that type *requires* one, and row X5 tightened
 * `TileId` precisely so a string that is not a `tiles/…` path cannot enter the
 * store. So the store keeps two maps and this module produces two lists —
 * {@link PlanScene.pieces} and {@link PlanScene.generated} — with
 * {@link GeneratedPlanPiece} reusing `PlanPiece`'s field names so the branch that
 * draws it is a **second `map`, not a second pipeline**. Row S5's `geometry.ts`
 * does all the resolving; this module places its output beside the catalog's.
 *
 * Three things are shared rather than duplicated, and each of them would be a
 * defect if it were not:
 *
 *   - **One conflict set.** Both populations enter `findConflicts` in the *same
 *     array*, so a generated base overlapping a catalogued floor is a conflict
 *     on both pieces. Two sweeps would report neither.
 *   - **One bounds box.** `fitBoxes` and the viewport read it, so a room whose
 *     only content is generated still has somewhere to look.
 *   - **One `PlacementId` space**, which is the store's decision and S5's proof:
 *     `gen:` fails `TileId`'s pattern, so the two id spaces are disjoint and a
 *     single id can name a piece in either list without ambiguity. That is what
 *     lets {@link pieceAt} and `move.ts` take the union.
 */
import type { CatalogRecord, TileId } from '@/catalog'
import { DEFAULT_ROTATION_STEP_DEG } from '@/catalog'
import type { GeneratedPiece } from '@/generator/placement/geometry'
import { generatedPiece } from '@/generator/placement/geometry'
import { GENERATED_SHAPES } from '@/generator/placement/scene'
import type { Placement, PlacementId, WorkshopState } from '@/store'

import type { PlanCatalog, PlanStyle } from './catalog'
import type { Extent, PlanBox, PlanCaveat, PlanPart, PlanPoint, PlanShape } from './geometry'
import {
  boxCentre,
  describeCell,
  describeFootprint,
  footprintShape,
  partsContain,
  placementCaveat,
  planGeometry,
} from './geometry'
import type { OverlapCandidate, PlanBand } from './overlap'
import { findConflicts, planBand } from './overlap'

/** One drawable placement. */
export interface PlanPiece {
  /**
   * Which of the two populations this is — see the module note.
   *
   * A discriminant rather than a `record === undefined` check, so
   * {@link ScenePiece} narrows in a `switch` and the exhaustiveness is the
   * compiler's rather than a reader's.
   */
  readonly kind: 'catalog'
  readonly id: PlacementId
  readonly placement: Placement
  readonly record: CatalogRecord
  /** The footprint resolved: extent, intrinsic angle, convex parts and the outline path. */
  readonly shape: PlanShape
  /** The un-rotated footprint extent — what the piece *is*, before it was turned. */
  readonly extent: Extent
  /** The axis-aligned box it occupies, anchored at `placement.x`/`placement.z`. */
  readonly box: PlanBox
  /**
   * The angle actually drawn: `placement.rotation + shape.angle`. Differs from
   * the placement's rotation on the 121 `diag` tiles and nowhere else.
   */
  readonly angle: number
  /** The piece as convex polygons. Equal to the box's corners for an axis-aligned rect. */
  readonly parts: readonly PlanPart[]
  readonly band: PlanBand
  /** Whether the drawn box is the shape. Read by the corner-junction exemption. */
  readonly axisAligned: boolean
  readonly style: PlanStyle
  readonly conflict: boolean
  /** Set when the outline rests on an unmeasured band rule. See `placementCaveat`. */
  readonly caveat: PlanCaveat | null
  /** The accessible name — material, name, size, angle, position, and any caveat. */
  readonly label: string
}

/**
 * One drawable generated base.
 *
 * Row S5's {@link GeneratedPiece} plus the two fields a *scene* adds to a piece
 * — the conflict flag and the `caveat` slot the renderer branches on. Nothing
 * else is added and nothing is renamed: the field names are `PlanPiece`'s
 * deliberately, so `PlanPieces.tsx` draws both from one component.
 *
 * `caveat` is `null` and it is the type rather than a value that says so. A
 * caveat is *"the outline rests on an unmeasured band rule"*, which applies to
 * the 462 corpus arcs whose band came from a rule with no accepted mesh fit
 * behind it. A generated base's outline is `x × y` squares of arithmetic over
 * the parameters the user set — there is no measurement to be missing — so the
 * unmeasured hatch must never appear on one, and a `null` literal is how that
 * is stated once instead of trusted at three call sites.
 */
export interface GeneratedPlanPiece {
  readonly kind: 'generated'
  readonly id: PlacementId
  readonly placement: GeneratedPiece['placement']
  /** The footprint in both units, plus height and basis in millimetres. */
  readonly foot: GeneratedPiece['foot']
  readonly shape: PlanShape
  readonly extent: Extent
  readonly box: PlanBox
  readonly angle: number
  readonly parts: readonly PlanPart[]
  readonly band: PlanBand
  readonly axisAligned: boolean
  readonly style: PlanStyle
  readonly conflict: boolean
  /** Always `null`. See the interface note. */
  readonly caveat: null
  /** False when `SQUARE_BASIS` is not the grid's, so the piece will not tile. */
  readonly tiles: boolean
  /**
   * `Generated square base` — the short name, in the panel's own words.
   *
   * The counterpart of `record.name`, and computed the way row S5's bill row
   * computes its own `name` so a piece on the plan and its line in the bill are
   * called the same thing. `label` is the long accessible name; this is what a
   * live region says on a grab or a removal, where the long one would be a
   * paragraph.
   */
  readonly name: string
  readonly label: string
}

/**
 * Either population, for the code that does not care which.
 *
 * Hit-testing, the move operation, the cursor's live region and the erase
 * gesture are all about *a piece on the plan*, and none of them reads a
 * `CatalogRecord`. The things that do — the 3D room's `record.blob`, the bill's
 * `record.name`, `rotationStepFor(record)` — take {@link PlanScene.pieces} and
 * are unaffected by this union existing.
 */
export type ScenePiece = PlanPiece | GeneratedPlanPiece

/** A placement that could not be drawn, and why. */
export interface PlanOmission {
  readonly id: PlacementId
  readonly tileId: TileId
  readonly reason: string
}

export interface PlanScene {
  /** In paint order: areas, then edges, insertion order within each. */
  readonly pieces: readonly PlanPiece[]
  /**
   * The generated bases, in the same paint order, as their own list.
   *
   * Separate from {@link pieces} because a `PlanPiece` carries a
   * `CatalogRecord` and a generated base has none — see the module note. Empty
   * for every caller that passes no generated map, which is every caller
   * outside the builder.
   */
  readonly generated: readonly GeneratedPlanPiece[]
  /** Over **both** lists: a generated base and a catalogued tile can conflict. */
  readonly conflicts: ReadonlySet<PlacementId>
  readonly unknown: readonly PlanOmission[]
  readonly undrawable: readonly PlanOmission[]
  /** The bounding box of everything drawn, generated bases included, or `null`. */
  readonly bounds: PlanBox | null
}

/**
 * The accessible name of one piece. Read out when the cursor lands on it.
 *
 * The shape is described per footprint case rather than as its bounding box, and
 * an unmeasured band is *named* here rather than left to the drawing: a hatch
 * over a curve is invisible to a screen reader, and the whole point of carrying
 * `bandBasis` through to the builder is that the user can tell a measured
 * outline from a defaulted one.
 */
function describePiece(
  record: CatalogRecord,
  extent: Extent,
  placement: Placement,
  style: PlanStyle,
  caveat: PlanCaveat | null,
): string {
  const angle = placement.rotation === 0 ? '' : `, turned ${String(Math.round(placement.rotation * 100) / 100)} degrees`
  const shape = describeFootprint(record.foot, extent)
  const note = caveat === null ? '' : ', unmeasured outline'
  return `${record.name}, ${style.label}, ${shape}${angle}, at ${describeCell(placement.x, placement.z)}${note}`
}

const BAND_ORDER: Readonly<Record<PlanBand, number>> = { area: 0, edge: 1 }

/**
 * Build the scene.
 *
 * `style` is passed in rather than resolved here so the memoised resolver
 * outlives a single projection — see `createStyleResolver`.
 *
 * `generated` is optional and defaults to empty, which keeps every caller
 * outside the builder — the landing hero, row G2's 3D room, the fixtures —
 * unchanged: none of them has a generated map to pass and none of them would
 * know what to do with the second list.
 *
 * A generated base needs no style resolver of its own. Row S5's `generatedStyle`
 * asks `src/materials` for `texture|plain`, which is the tag all 1,235 archived
 * plain bases carry, so a generated base and an archived plain one come out the
 * same family — measured in S5's `corpus.test.ts` rather than assumed. Passing
 * this scene's memoised resolver would not help: it is keyed on a
 * `CatalogRecord`, and there isn't one.
 */
export function buildPlanScene(
  placements: WorkshopState['placements'],
  catalog: PlanCatalog,
  style: (record: CatalogRecord) => PlanStyle,
  generated: WorkshopState['generated'] = {},
): PlanScene {
  const drawable: PlanPiece[] = []
  const unknown: PlanOmission[] = []
  const undrawable: PlanOmission[] = []

  for (const [key, placement] of Object.entries(placements)) {
    const id = key as PlacementId
    const record = catalog.record(placement.tileId)
    if (record === undefined) {
      unknown.push({
        id,
        tileId: placement.tileId,
        reason: `${placement.tileId} is not in this catalog build; it may have been retired.`,
      })
      continue
    }
    const shape = footprintShape(record.foot)
    if (shape === undefined) {
      undrawable.push({
        id,
        tileId: placement.tileId,
        reason: `${record.name} has a ${record.foot.shape} footprint, which the plan view cannot draw.`,
      })
      continue
    }
    const resolved = style(record)
    const caveat = placementCaveat(record) ?? null
    const geometry = planGeometry(shape, placement.rotation, placement.x, placement.z)
    drawable.push({
      kind: 'catalog',
      id,
      placement,
      record,
      shape,
      extent: shape.extent,
      box: geometry.box,
      angle: geometry.angle,
      parts: geometry.parts,
      band: planBand(record),
      axisAligned: geometry.axisAligned,
      style: resolved,
      conflict: false,
      caveat,
      label: describePiece(record, shape.extent, placement, resolved, caveat),
    })
  }

  const drawableGenerated: GeneratedPlanPiece[] = []
  for (const [key, placement] of Object.entries(generated)) {
    const id = key as PlacementId
    const resolved = generatedPiece(id, placement)
    drawableGenerated.push({
      ...resolved,
      kind: 'generated',
      conflict: false,
      caveat: null,
      name: `Generated ${GENERATED_SHAPES[placement.recipe.entry].label.toLowerCase()} base`,
    })
  }

  // **One sweep over one array.** Row S5 built `generatedOverlapCandidate` for
  // exactly this, and both types satisfy `OverlapCandidate` structurally, so the
  // separating-axis pass tests a generated base against a catalogued tile with no
  // conversion and no second implementation. Two sweeps would find neither of the
  // cross-population conflicts, which are the ones a user actually hits: a base is
  // the thing you put *under* something.
  const candidates: OverlapCandidate[] = [...drawable, ...drawableGenerated]
  const conflicts = findConflicts(candidates)

  const pieces = drawable
    .map((piece) => (conflicts.has(piece.id) ? { ...piece, conflict: true } : piece))
    .sort((a, b) => BAND_ORDER[a.band] - BAND_ORDER[b.band])
  const generatedPieces = drawableGenerated
    .map((piece) => (conflicts.has(piece.id) ? { ...piece, conflict: true } : piece))
    .sort((a, b) => BAND_ORDER[a.band] - BAND_ORDER[b.band])

  return {
    pieces,
    generated: generatedPieces,
    conflicts,
    unknown,
    undrawable,
    bounds: sceneBounds([...pieces, ...generatedPieces]),
  }
}

function sceneBounds(pieces: readonly ScenePiece[]): PlanBox | null {
  if (pieces.length === 0) return null
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const { box } of pieces) {
    left = Math.min(left, box.x)
    top = Math.min(top, box.z)
    right = Math.max(right, box.x + box.w)
    bottom = Math.max(bottom, box.z + box.d)
  }
  return { x: left, z: top, w: right - left, d: bottom - top }
}

/**
 * The short name of any piece — `record.name`, or S5's bill wording.
 *
 * One function so the erase gesture, the move readouts and the cursor's live
 * region say the same thing about a generated base as the bill panel does. The
 * catalog arm is a field read; the generated arm is the `name` the projection
 * already computed, so nothing is derived twice.
 */
export function pieceName(piece: ScenePiece): string {
  return piece.kind === 'catalog' ? piece.record.name : piece.name
}

/**
 * The rotation step for any piece.
 *
 * For a catalogued tile it is `rotStep`, defaulting to 90 — 893 tiles carry an
 * angle that is not a multiple of it. For a generated base it is
 * {@link DEFAULT_ROTATION_STEP_DEG}, which is what row S5's
 * `GENERATED_ROTATION_STEP_DEG` is *defined* as, and the reason it is spelled
 * out here rather than imported is measured: that constant lives in
 * `placement.ts`, which value-imports `panel/recipe.ts` and its 25 KB of pinned
 * parameter JSON, so importing a number from it would put the schemas in the
 * canvas's chunk — the same regression S4's and S5's boundary tests both exist
 * to prevent. `generatedScene.test.ts` asserts the two constants are equal, so
 * the restatement cannot drift.
 *
 * The step is 90 for every shape this panel offers because all five footprints
 * are rects on the inch grid; the corpus tiles that need a finer step are arcs,
 * hexes and diagonals, none of which the generator produces.
 */
export function pieceRotationStep(piece: ScenePiece): number {
  return piece.kind === 'catalog' ? (piece.record.rotStep ?? DEFAULT_ROTATION_STEP_DEG) : DEFAULT_ROTATION_STEP_DEG
}

/**
 * Everything drawn, in the order it is drawn, both populations.
 *
 * Generated bases first, so they sit **under** the catalog's pieces. That is not
 * a tie-break, it is what a base is: the thing you put under a topper. All five
 * shapes the panel offers land in the `area` band (S5 measured that off the
 * archive's own records rather than choosing it), so without this they would
 * interleave with floors by insertion order and a base placed after a floor
 * would be drawn over the floor standing on it.
 *
 * `PlanPieces.tsx` renders the two lists as two `<g>`s in this order, so the
 * DOM's paint order and this function's are the same statement — which is what
 * makes {@link pieceAt}'s "last wins" agree with what the user can see.
 */
export function scenePaintOrder(scene: PlanScene): readonly ScenePiece[] {
  return scene.generated.length === 0 ? scene.pieces : [...scene.generated, ...scene.pieces]
}

/**
 * The topmost piece under a point, or `undefined`.
 *
 * Last in paint order wins, which is the piece drawn on top — so clicking where
 * a wall crosses a floor erases the wall, which is the one the user can see, and
 * clicking where a floor covers a generated base takes the floor.
 */
export function pieceAt(scene: PlanScene, point: PlanPoint): ScenePiece | undefined {
  const order = scenePaintOrder(scene)
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const piece = order[i] as ScenePiece
    if (partsContain(piece.parts, point)) return piece
  }
  return undefined
}

/**
 * Scene order for cursor navigation: reading order down the plan, then across.
 *
 * Not paint order, and not insertion order. A keyboard user stepping through the
 * room with `[` and `]` needs a spatial sequence — the tile *next to* this one —
 * and insertion order is the order things happened to be placed in, which after
 * ten minutes of editing is no order at all.
 */
export function navigationOrder(scene: PlanScene): readonly ScenePiece[] {
  return [...scenePaintOrder(scene)].sort((a, b) => {
    const ac = boxCentre(a.box)
    const bc = boxCentre(b.box)
    return ac.z - bc.z || ac.x - bc.x
  })
}
