/**
 * A generated base as a shape on the plan — and the one conversion S4's
 * footprint leaves to this row.
 *
 * S4 computes the footprint from the parameters, in **squares**, which is the
 * catalog's own unit: a 2×2 square base is `{shape:'rect', w:2, d:2}`, exactly
 * what `plain#base+square.2x2` carries. That is what lets a generated base and a
 * catalogued one share one placement path, and it is *arithmetic*, so the
 * outline is truthful in the frame the parameter changed — before the engine has
 * been asked anything, or without ever starting it.
 *
 * ## Squares of *whose* grid — the conversion, and why it is not a refusal
 *
 * `SQUARE_BASIS` chooses the millimetres in a square: 25, 25.4, 31.75 or 38.1.
 * The builder's grid is `GRID_UNIT_MM`, 25.4. So a `wyloch` 2×2 base is 63.5 mm
 * across, which is **2.5 grid squares, not 2**, and drawing it at 2 would
 * understate a real object by 25% — an outline that lies about where the piece
 * ends, in the module whose whole job is refusing overlaps.
 *
 * §9.8 puts mixed-basis builds in the builder rather than the generator, and
 * S4's `tiles: false` is that decision surfacing. This row reads it as *"say so
 * and draw it honestly"* rather than *"refuse it"*: {@link generatedFootprint}
 * converts to grid units so the box, the parts and the collision test are all
 * about the real object, and {@link generatedPiece} carries `tiles` through so
 * the caller can say the piece will not snap to the lattice. Refusing would be
 * defensible too, but it would leave the user with a 2.4 MB mesh they can
 * download and no way to see how big it is.
 *
 * The conversion is `w × basisMm / GRID_UNIT_MM`, **rounded to 1e-6 grid
 * units** (2.5e-5 mm). The rounding is not cosmetic: `3 × 25.4 / 25.4` is
 * `2.9999999999999996` in doubles, and an inch-basis base has to come back at
 * exactly its own integers or every one of them lands a quarter-nanometre off
 * the lattice. 1e-6 units is `overlap.ts`'s own `TOUCH_EPS`, so nothing this
 * removes was ever distinguishable there. `placement.test.ts` asserts the
 * identity for all four bases at every `x` the schema offers.
 *
 * ## How this reaches the plan view's collision
 *
 * It does not reimplement any of it. `footprintShape` and `planGeometry` from
 * row W6 turn a `Footprint` into convex parts and an exact box, `planBand`
 * decides the height band, and {@link generatedOverlapCandidate} assembles the
 * `OverlapCandidate` those two produce — so a generated base goes into
 * `findConflicts` in the same array as the catalog's pieces and is tested by the
 * same separating-axis pass, with W6's proved outward-only error direction
 * intact. It is a `rect`, so it takes the exact-quad path and no sector
 * decomposition is involved at all.
 *
 * What this cannot do is *draw* it. `PlanPiece` requires a `CatalogRecord` and a
 * `Placement`, and `src/builder/canvas/**` is not this row's to edit — see the
 * report for the one branch `scene.ts` needs. Collision, box, label and material
 * are all here and correct; the `<rect>` is one call away.
 *
 * ## Material
 *
 * Not chosen here. All 1,235 plain bases in the archive carry `texture|plain`
 * and the registry maps that root to the `plain` family — *"no surface sculpt",
 * not a material*, in `mapping.ts`'s own words — so this module hands
 * `resolveMaterial` that one tag and lets the registry answer. A hardcoded
 * material id would be a second opinion about a question `src/materials` owns,
 * and `corpus.test.ts` asserts that a generated base and an archived plain base
 * resolve to the same family.
 */
import type { Footprint } from '@/catalog'
import { GRID_UNIT_MM } from '@/catalog'
import type { PlanStyle } from '@/builder/canvas/catalog'
import type { Extent, PlanBox, PlanPart, PlanShape } from '@/builder/canvas/geometry'
import { describeCell, describeFootprint, footprintShape, planGeometry } from '@/builder/canvas/geometry'
import type { OverlapCandidate, PlanBand } from '@/builder/canvas/overlap'
import { planBand } from '@/builder/canvas/overlap'
import { resolveMaterial } from '@/materials'
import type { PlacementId } from '@/store'

import type { BaseFootprint } from '../panel/footprint'
import { baseFootprint } from '../panel/footprint'

import type { GeneratedPlacement } from './scene'
import { GENERATED_SHAPES } from './scene'

/**
 * The tag every plain base in the archive carries, and the whole of what the
 * material registry is told about a generated one.
 */
export const GENERATED_TEXTURE_TAG = 'texture|plain'

/** Round to 1e-6 grid units — `overlap.ts`'s `TOUCH_EPS`. See the module note. */
function toGridUnits(squares: number, basisMm: number): number {
  return Math.round(((squares * basisMm) / GRID_UNIT_MM) * 1_000_000) / 1_000_000
}

export interface GeneratedFootprint extends BaseFootprint {
  /**
   * The footprint in **builder-grid squares** — what the plan view draws and
   * collides. Identical to {@link BaseFootprint.footprint} on the inch basis,
   * which is every base in the archive.
   */
  readonly gridFootprint: Footprint
}

/**
 * A generated base's footprint, in both units.
 *
 * `NOTCH` is ignored for the bounding footprint, which is S4's decision and the
 * catalog's: a notched 4×4 is still 4×4 of grid with one corner missing, and
 * `plain#base+square.4x4+notch` carries `{rect, w:4, d:4}`. A placement that
 * claimed the notch would refuse a legal neighbour.
 */
export function generatedFootprint(placement: GeneratedPlacement): GeneratedFootprint {
  const base = baseFootprint(placement.recipe.entry, placement.recipe.parameters)
  const { footprint } = base
  const gridFootprint: Footprint =
    footprint.shape === 'rect' && !base.tiles
      ? { shape: 'rect', w: toGridUnits(footprint.w, base.basisMm), d: toGridUnits(footprint.d, base.basisMm) }
      : footprint
  return { ...base, gridFootprint }
}

/**
 * How a generated base is drawn — asked of the material registry, not decided
 * here.
 *
 * The whole of what the registry is told is {@link GENERATED_TEXTURE_TAG}, which
 * is the tag all 1,235 archived plain bases carry. `mapping.ts` maps that root
 * to the `plain` family and calls it *"no surface sculpt", not a material*, so a
 * generated base and an archived plain base come out identical — asserted in
 * `corpus.test.ts` against the real index rather than assumed. The entry
 * filename is passed as the second argument only because `resolveMaterial`
 * records it on the resolution for diagnosis; with a texture tag present, no
 * filename hint is consulted.
 */
export function generatedStyle(placement: GeneratedPlacement): PlanStyle {
  const family = resolveMaterial([GENERATED_TEXTURE_TAG], placement.recipe.entry).family
  return {
    material: family.id,
    tint: family.tint,
    edge: family.edge,
    contour: family.contour,
    label: family.label,
  }
}

/**
 * One generated base, resolved into everything the plan needs except the SVG.
 *
 * The field names are `PlanPiece`'s, so the canvas branch that draws these is a
 * second `map` over the same shape rather than a second geometry pipeline.
 */
export interface GeneratedPiece {
  readonly id: PlacementId
  readonly placement: GeneratedPlacement
  /** The footprint, in both units, plus the height and basis in millimetres. */
  readonly foot: GeneratedFootprint
  readonly shape: PlanShape
  readonly extent: Extent
  readonly box: PlanBox
  readonly angle: number
  readonly parts: readonly PlanPart[]
  readonly band: PlanBand
  readonly axisAligned: boolean
  readonly style: PlanStyle
  /** False when `SQUARE_BASIS` is not the grid's, so the piece will not tile. */
  readonly tiles: boolean
  /** Material, shape, angle, cell — and the basis warning when there is one. */
  readonly label: string
}

export class GeneratedGeometryError extends Error {
  override readonly name = 'GeneratedGeometryError'
}

/**
 * Resolve a generated placement into a drawable, collidable piece.
 *
 * Throws only if `footprintShape` refuses the footprint, which on a `rect` from
 * this panel is unreachable — it is a throw rather than an `undefined` return
 * because the `undrawable` outcome `scene.ts` models exists for a *persisted
 * catalog* placement whose classifier has moved, and a recipe carries its own
 * footprint rule. There is nothing here that can go stale.
 */
export function generatedPiece(id: PlacementId, placement: GeneratedPlacement): GeneratedPiece {
  const foot = generatedFootprint(placement)
  const shape = footprintShape(foot.gridFootprint)
  if (shape === undefined) {
    throw new GeneratedGeometryError(
      `a ${foot.gridFootprint.shape} footprint has no plan-view outline; every shape this panel offers is a rect`,
    )
  }

  const geometry = planGeometry(shape, placement.rotation, placement.x, placement.z)
  const kinds = GENERATED_SHAPES[placement.recipe.entry].kinds
  const style = generatedStyle(placement)

  return {
    id,
    placement,
    foot,
    shape,
    extent: shape.extent,
    box: geometry.box,
    angle: geometry.angle,
    parts: geometry.parts,
    band: planBand({ foot: foot.gridFootprint, kinds: [...kinds] }),
    axisAligned: geometry.axisAligned,
    style,
    tiles: foot.tiles,
    label: describeGeneratedPiece(placement, foot, shape.extent, style),
  }
}

/**
 * The candidate `findConflicts` takes.
 *
 * Separate from {@link generatedPiece} so a ghost — the outline under the cursor,
 * before anything is committed — can be tested without resolving a style or a
 * label. `computeGhost` in `ghost.ts` does the same for a catalog record.
 */
export function generatedOverlapCandidate(id: PlacementId, placement: GeneratedPlacement): OverlapCandidate {
  const piece = generatedPiece(id, placement)
  return { id, band: piece.band, box: piece.box, parts: piece.parts, axisAligned: piece.axisAligned }
}

/**
 * The accessible name of one generated piece.
 *
 * Reuses `describeFootprint` so a generated 2×2 and a catalogued 2×2 read
 * identically, and appends the basis only when it is not the grid's — an
 * inch-basis base has nothing to disclose, and a sentence that always mentioned
 * the basis would train the reader to skip the one case that matters.
 */
export function describeGeneratedPiece(
  placement: GeneratedPlacement,
  foot: GeneratedFootprint,
  extent: Extent,
  style: PlanStyle,
): string {
  const label = GENERATED_SHAPES[placement.recipe.entry].label
  const angle = placement.rotation === 0 ? '' : `, turned ${String(Math.round(placement.rotation * 100) / 100)} degrees`
  const basis = foot.tiles ? '' : `, ${String(foot.basisMm)} mm to the square so it will not tile`
  return (
    `Generated ${label.toLowerCase()} base, ${style.label}, ${describeFootprint(foot.gridFootprint, extent)}` +
    `${angle}, at ${describeCell(placement.x, placement.z)}${basis}`
  )
}
