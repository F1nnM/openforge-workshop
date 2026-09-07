/**
 * Plan-view geometry — snapping, oriented shapes, rotation steps, and the
 * refusal rule. Pure functions over `Footprint`; no React, no DOM, no store.
 *
 * ## What a placement means geometrically
 *
 * A `TemplateInstance` carries `x`, `z`, `rotation` and a fill per named slot —
 * the footprint lives on each fill's `CatalogRecord` (`src/store/schema.ts` is
 * explicit that copying it into the placement would desynchronise on the next
 * import, and that a *slot offset* would be wrong for most fills of the same slot
 * because the `base` slot admits 25 distinct footprints). So every function here
 * takes the footprint separately, and the triple (instance origin, slot layout,
 * footprint) is what has a box — see {@link SlotLayout} and
 * {@link slotGeometry}.
 *
 * **`x`/`z` are the box's minimum corner, not its centre**, and the choice is
 * forced by two independent constraints:
 *
 *   1. **The 0.5 lattice.** §7 snaps to 0.5 units because every dimension in the
 *      catalog is a multiple of 0.5. A wall's short axis is
 *      {@link WALL_THICKNESS_UNITS} = 0.5, so a wall's *centre* sits a quarter
 *      unit off the cell edge — 0.25 is unreachable on a 0.5 snap, and a
 *      centre-anchored wall could therefore never be flush with a floor tile.
 *      Anchoring the corner puts every face of every piece on the lattice for
 *      any extent, which is exactly the condition for two tiles to abut.
 *   2. **The share codec's quantum.** `src/share/payload.ts` stores coordinates
 *      as `x · 2` — half grid units — and falls back to eight bytes per
 *      coordinate the moment a value is not representable. Corner anchoring
 *      keeps every coordinate a multiple of 0.5 and so keeps the compact
 *      encoding; centre anchoring would spend f64s on quarter units.
 *
 * The same argument settles rotation. Rotating about the box centre and
 * re-deriving the corner shifts it by `(w − d) / 2`, which for a 2-unit wall is
 * 0.75 — a multiple of 0.25, not of 0.5. So **rotation preserves the anchor
 * corner** and the extents swap around it: a 2 × 0.5 wall lying along the north
 * edge of a cell becomes a 0.5 × 2 wall lying along its west edge. That is both
 * lattice-safe and what a plan editor reads as "turn this piece".
 *
 * A *template* of N parts turns the same way, and {@link slotAnchor} is where the
 * two-line generalisation lives: each part's **box** turns about the instance
 * origin — a box, not its corner, which is the whole of row A10 — and the turned
 * assembly is re-anchored by the cell's own turned corner, so the union's minimum
 * corner is still `x`/`z` and its area is unchanged.
 *
 * ## Six of the seven footprints are placeable
 *
 * `src/catalog/schema.ts` carries seven cases; `docs/verify-catalog-facts.py`
 * re-derives their shares from the fixtures, and these are its numbers:
 *
 * | case     | live tiles    | in plan                                        |
 * | -------- | ------------- | ---------------------------------------------- |
 * | `rect`   | 3,449 (39.6%) | the box itself                                 |
 * | `wall`   | 3,079 (35.4%) | length × {@link WALL_THICKNESS_UNITS}          |
 * | `arc`    | 1,199 (13.8%) | an annular sector — see `sector.ts`            |
 * | `diag`   | 121 (1.4%)    | a wall run carried at an intrinsic 45°         |
 * | `column` | 119 (1.4%)    | one wall-thickness square                      |
 * | `tri`    | 9 (0.1%)      | a right isosceles triangle, legs on the axes   |
 * | `none`   | 726 (8.3%)    | **refused, with a reason**                     |
 *
 * `rect` + `wall` is 75.0% and all six drawable cases reach **91.7%**. Only
 * `none` is refused, and it is refused rather than approximated because
 * `src/catalog/schema.ts` records what those 726 tiles are: 319 `size|segment`
 * fragments whose width/depth pair names the whole design rather than the piece,
 * 338 with no numeric size tag at all, 42 carrying a tessellation code this
 * build will not place, and 27 curved-interface floors whose tagged width
 * over-states the mesh by up to 1.513 units. Drawing any of them as a rectangle
 * would be *wrong*, not approximate.
 *
 * ## Two things a footprint carries beyond its box
 *
 *   - **An intrinsic angle.** A `diag` is a straight `run × 0.5` wall that lies
 *     along a cell diagonal, so its own axes are turned 45° inside its bounding
 *     box before the placement's rotation is applied at all. Modelling that as
 *     part of the *shape* rather than as a special case in the renderer is what
 *     lets `rotatedExtent`, `planBox` and `anchorFor` stay one implementation
 *     for all six cases.
 *   - **Convex parts.** Overlap is SAT, which is a theorem about convex sets, and
 *     a sector is not one. So a shape publishes a list of convex parts instead
 *     of a single quadrilateral, and `sector.ts` proves that the sector's parts
 *     contain the sector — which fixes the error direction at *false positive*.
 *     For the five straight cases there is exactly one part and it is the shape.
 */
import type { CatalogRecord, Footprint } from '@/catalog'
import { DEFAULT_ROTATION_STEP_DEG, GRID_UNIT_MM, WALL_THICKNESS_UNITS } from '@/catalog'
import { normalizeRotation } from '@/store'

import { arcSectorExtent, sectorParts, sectorPath, sectorSlack } from './sector'

/* ---------------------------------------------------------------- snap modes */

/**
 * The two snap steps, and **there is deliberately no 0.25**.
 *
 * §7: every dimension in the catalog is a multiple of 0.5 units, so a
 * quarter-unit grid can only ever produce placements that cannot physically
 * assemble. The mock offered it; the plan removed it. This map is the only place
 * a step is written down, so a third mode cannot be added by accident in one
 * component.
 */
export const SNAP_STEP = Object.freeze({ fine: 0.5, coarse: 1 })

/** Which snap step is in force. `fine` is the default; `coarse` is the alignment aid. */
export type SnapMode = keyof typeof SNAP_STEP

/** In display order, for the toolbar's toggle. */
export const SNAP_MODES: readonly SnapMode[] = ['fine', 'coarse']

/**
 * Round to the nearest multiple of `step`.
 *
 * Both steps are binary-exact (0.5, 1) so the arithmetic is exact and no epsilon
 * is needed. `+ 0` normalises `-0`, which `Math.round(-0.2) * 0.5` really does
 * produce: `-0` survives in memory but not through `JSON.stringify`, so a scene
 * holding one would not compare equal to itself after an export and re-import.
 * The store's coordinate schema does the same thing for the same reason.
 */
export function snapTo(value: number, step: number): number {
  return Math.round(value / step) * step + 0
}

/** Millimetres for a length in grid units — for the readouts, not the maths. */
export function unitsToMm(units: number): number {
  return units * GRID_UNIT_MM
}

/* -------------------------------------------------------------------- extent */

/** An axis-aligned size in grid units. */
export interface Extent {
  readonly w: number
  readonly d: number
}

/** A box in grid units, `x`/`z` being its minimum corner. */
export interface PlanBox {
  readonly x: number
  readonly z: number
  readonly w: number
  readonly d: number
}

/** A point in grid units. */
export type PlanPoint = readonly [x: number, z: number]

/** A convex polygon in grid units, wound consistently. */
export type PlanPart = readonly PlanPoint[]

/**
 * Whether a shape's convex parts *are* its outline, or merely contain it.
 *
 * `exact` for the five straight cases, where the single part is the polygon
 * itself. `outward` for `arc`, where the parts are a convex decomposition that
 * strictly contains the sector — see `sector.ts` for the proof and the bound.
 * Carried rather than inferred from `shape` so a consumer that reports on its
 * own accuracy does not have to know which cases are curved.
 */
export type PlanCover = 'exact' | 'outward'

/**
 * Everything the plan needs from a footprint, resolved once.
 *
 * One object rather than four functions over the same `switch`, because the four
 * answers have to agree: an extent without its intrinsic angle puts a `diag` in
 * the wrong box, and parts without the matching extent put them outside it. The
 * gap this row closed was two independent switches over the same union
 * disagreeing about which cases exist, so there is now one.
 */
export interface PlanShape {
  readonly shape: Footprint['shape']
  /** The bounding box of the outline in the shape's own frame, before rotation. */
  readonly extent: Extent
  /**
   * The shape's own axes relative to its bounding box, in degrees.
   *
   * 45 for `diag` and 0 for everything else. Added to the placement's rotation
   * everywhere, so a `diag` at rotation 0 lies along a diagonal — which is what
   * the piece is — and its `rotStep` of 45 (all 121 carry it) steps it between
   * the two diagonals through the two off-lattice axis-aligned positions.
   */
  readonly angle: number
  /** Convex parts covering the outline, in the local frame `[0, w] × [0, d]`. */
  readonly parts: readonly PlanPart[]
  readonly cover: PlanCover
  /** How far, in grid units, `parts` may reach past the outline. 0 when `exact`. */
  readonly slack: number
  /** The outline as an SVG path `d`, in the local frame. Exact for every case. */
  readonly outline: string
}

/**
 * A union member this module has not been taught about.
 *
 * The reason it exists: `placementRefusal` used to be a `switch` with no
 * `default` returning `Refusal | undefined`, so when `src/catalog/schema.ts`
 * grew `column`, `tri` and `diag`, it silently returned `undefined` for all 249
 * of them while `isPlaceable` returned `false` — 249 tiles greyed out in the
 * palette with no explanation string at all, and it compiled. Routing every
 * switch over `Footprint` through this makes the next such addition a type
 * error at the call site instead of an empty string in the UI.
 */
function unhandled(value: never): never {
  throw new Error(`unhandled footprint case: ${JSON.stringify(value)}`)
}

/** The corners of a local `[0, w] × [0, d]` box, wound consistently. */
function boxPart(extent: Extent): PlanPart {
  return [
    [0, 0],
    [extent.w, 0],
    [extent.w, extent.d],
    [0, extent.d],
  ]
}

/** The `d` for a local `[0, w] × [0, d]` box. */
function boxPath(extent: Extent): string {
  return `M 0 0 H ${String(extent.w)} V ${String(extent.d)} H 0 Z`
}

/**
 * The intrinsic turn a `diag` carries inside its own bounding box.
 *
 * Exactly 45: `src/catalog/schema.ts` calls a `diag` "a wall run at 45°", and all
 * 121 carry `rotStep` 45, so the placement's own step steps it between the two
 * diagonals.
 */
export const DIAGONAL_ANGLE_DEG = 45

/** A straight footprint: one convex part, exactly the outline, no intrinsic turn. */
function straight(shape: Footprint['shape'], extent: Extent, angle = 0): PlanShape {
  return {
    shape,
    extent,
    angle,
    parts: [boxPart(extent)],
    cover: 'exact',
    slack: 0,
    outline: boxPath(extent),
  }
}

/**
 * The shape of a box the *rule* produced rather than a footprint — the one thing
 * {@link SlotLayout.residual} needs and {@link footprintShape} cannot give it.
 *
 * A residual is not a `Footprint`: no tag names it and no record carries it. It
 * is the part of a cell an `s2w` recipe's separately printed walls do not stand
 * on, computed in `template/offsets.ts#residualBox` from the walls' own
 * footprints, and it is always an axis-aligned rectangle at angle 0 because the
 * slot it narrows is the cell slot and `cellExtentOf` admits nothing else.
 *
 * Exported so `scene.ts` can draw that box without a second copy of
 * {@link straight}, which stays private because every other shape in this module
 * comes from a footprint.
 */
export function boxShape(extent: Extent): PlanShape {
  return straight('rect', extent)
}

/**
 * The plan geometry of a footprint, or `undefined` when there is none to draw.
 *
 * The one `switch` over `Footprint` in this module, and the only place a case's
 * geometry is written down.
 *
 *   - `wall`, `column` and `diag` have **no depth field in the data** and none is
 *     guessed here: all three are the measured {@link WALL_THICKNESS_UNITS}
 *     constant. `src/catalog/schema.ts` gives the evidence — 12.7 mm on the
 *     3,079 walls, and 12.70 × 12.70 mm measured on `col+I`, `col+O`, `col+L`
 *     and `col+X` with Printable Scenery stating the same ("all columns are
 *     based on .5″ × .5″ pillars").
 *   - `tri`'s right angle is put at the local origin with the legs on the axes.
 *     The tags do not say which of the four corners it is — `shape|angled|right`
 *     with an equal width/depth pair is all there is — so this is a *canonical*
 *     orientation and the tile's own `rotStep` of 45 (all 9 carry it) is what
 *     reaches the others. Inventing an orientation from the filename would be a
 *     guess; making rotation reach every orientation is not.
 *   - `diag` is the same argument one dimension down: the run is a measured
 *     constant per code (`P` 3.536, `PA` 2.828, `PB` 2.835, `PC` 3.334) against a
 *     tagged `size|width|2` on all 121, and which diagonal it lies along is the
 *     user's to choose.
 */
export function footprintShape(foot: Footprint): PlanShape | undefined {
  switch (foot.shape) {
    case 'rect':
      return straight('rect', { w: foot.w, d: foot.d })
    case 'wall':
      return straight('wall', { w: foot.length, d: WALL_THICKNESS_UNITS })
    case 'column':
      return straight('column', { w: WALL_THICKNESS_UNITS, d: WALL_THICKNESS_UNITS })
    case 'diag':
      return straight('diag', { w: foot.run, d: WALL_THICKNESS_UNITS }, DIAGONAL_ANGLE_DEG)
    case 'tri': {
      const extent: Extent = { w: foot.leg, d: foot.leg }
      return {
        shape: 'tri',
        extent,
        angle: 0,
        parts: [
          [
            [0, 0],
            [foot.leg, 0],
            [0, foot.leg],
          ],
        ],
        cover: 'exact',
        slack: 0,
        outline: `M 0 0 H ${String(foot.leg)} L 0 ${String(foot.leg)} Z`,
      }
    }
    case 'arc':
      return {
        shape: 'arc',
        extent: arcSectorExtent(foot.rIn, foot.rOut, foot.sweep),
        angle: 0,
        parts: sectorParts(foot),
        cover: 'outward',
        slack: sectorSlack(foot.rOut, foot.sweep),
        outline: sectorPath(foot),
      }
    case 'none':
      return undefined
    default:
      return unhandled(foot)
  }
}

/**
 * The un-rotated extent of a footprint, or `undefined` when there is none to
 * draw.
 *
 * A thin reading of {@link footprintShape}, kept because most callers want only
 * the size — but note that for a `diag` this is the extent of the piece along
 * *its own* axes, so the box it occupies on the grid is
 * `rotatedExtent(extent, rotation + shape.angle)` and not this. Use
 * {@link planGeometry} rather than pairing this with a rotation by hand.
 */
export function footprintExtent(foot: Footprint): Extent | undefined {
  return footprintShape(foot)?.extent
}

/** Whether an angle is an odd quarter turn — the case where w and d swap. */
export function isQuarterTurn(rotation: number): boolean {
  const folded = ((rotation % 180) + 180) % 180
  return Math.abs(folded - 90) < 1e-9
}

/** Whether an angle is a whole number of quarter turns, exactly. */
export function isAxisAligned(rotation: number): boolean {
  const folded = ((rotation % 90) + 90) % 90
  return folded < 1e-9 || Math.abs(folded - 90) < 1e-9
}

/**
 * The axis-aligned extent a piece occupies once turned.
 *
 * Quarter turns are computed by swapping rather than by trigonometry, so a 90°
 * rotation of a 2 × 0.5 wall is exactly 0.5 × 2 and stays on the lattice —
 * `Math.cos(Math.PI / 2)` is 6.1e-17, and a 6.1e-17 offset is precisely the kind
 * of value that makes two tiles look flush and fail an equality test.
 *
 * The 893 tiles whose `size|angle` is not a multiple of 90 fall through to the
 * bounding box of the turned rectangle, which is honest: the *piece* is drawn
 * turned (see {@link planParts}), and this box is what the view has to reserve
 * for it. 823 of those 893 are now placeable — every `arc` under 90° (645), every
 * `diag` (121), every `tri` (9) and the 48 hex `wall` runs at 60° — against 48
 * before this row, which is why the trigonometric branch stopped being an edge
 * case.
 */
export function rotatedExtent(extent: Extent, rotation: number): Extent {
  if (isAxisAligned(rotation)) {
    return isQuarterTurn(rotation) ? { w: extent.d, d: extent.w } : { w: extent.w, d: extent.d }
  }
  const radians = (rotation * Math.PI) / 180
  const cos = Math.abs(Math.cos(radians))
  const sin = Math.abs(Math.sin(radians))
  return { w: extent.w * cos + extent.d * sin, d: extent.w * sin + extent.d * cos }
}

/** The box a piece occupies, anchored at its minimum corner. */
export function planBox(extent: Extent, rotation: number, x: number, z: number): PlanBox {
  const turned = rotatedExtent(extent, rotation)
  return { x, z, w: turned.w, d: turned.d }
}

/** A box's centre. */
export function boxCentre(box: PlanBox): { readonly x: number; readonly z: number } {
  return { x: box.x + box.w / 2, z: box.z + box.d / 2 }
}

/* ------------------------------------------------------------- placed shapes */

/**
 * A footprint placed: the shape, where it sits, and the geometry both the
 * renderer and the overlap test read.
 *
 * **One resolver, called by both `scene.ts` and `ghost.ts`.** A ghost that
 * predicted a conflict the scene then did not report would be worse than either
 * answer alone, and the same goes for a ghost drawn a quarter unit from where the
 * piece lands. Neither module computes any of this itself.
 */
export interface PlanGeometry {
  readonly shape: PlanShape
  /** The placement's own rotation, as stored. */
  readonly rotation: number
  /** `rotation + shape.angle`, folded into `[0, 360)` — the angle actually drawn. */
  readonly angle: number
  /** The axis-aligned box, anchored at the placement's `x`/`z`. */
  readonly box: PlanBox
  /** The convex parts in world units. What `overlap.ts` tests. */
  readonly parts: readonly PlanPart[]
  /**
   * Whether the drawn angle is a whole number of quarter turns, so the box *is*
   * the shape's bounding box on the grid.
   *
   * Taken from {@link angle} and not from `rotation`: a `diag` at rotation 0 is
   * drawn at 45°, and reading the placement's rotation here would tell the
   * corner-junction exemption that a diagonal wall's box is its shape.
   */
  readonly axisAligned: boolean
}

/** Rotate a local-frame point into world units about the box centre. */
function place(point: PlanPoint, extent: Extent, box: PlanBox, cos: number, sin: number): PlanPoint {
  const centre = boxCentre(box)
  const dx = point[0] - extent.w / 2
  const dz = point[1] - extent.d / 2
  return [centre.x + dx * cos - dz * sin, centre.z + dx * sin + dz * cos]
}

/** The parts of a shape placed at `x`/`z` and turned, in world units. */
export function planParts(shape: PlanShape, rotation: number, x: number, z: number): readonly PlanPart[] {
  const angle = normalizeRotation(rotation + shape.angle)
  const box = planBox(shape.extent, angle, x, z)
  const radians = (angle * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return shape.parts.map((part) => part.map((point) => place(point, shape.extent, box, cos, sin)))
}

/** Resolve a placed footprint once. See {@link PlanGeometry}. */
export function planGeometry(shape: PlanShape, rotation: number, x: number, z: number): PlanGeometry {
  const angle = normalizeRotation(rotation + shape.angle)
  return {
    shape,
    rotation,
    angle,
    box: planBox(shape.extent, angle, x, z),
    parts: planParts(shape, rotation, x, z),
    axisAligned: isAxisAligned(angle),
  }
}

/* ---------------------------------------------------------- slot geometry */

/**
 * Where one part sits inside its template, and how high it stands.
 *
 * Row **A1** made a placement a template instance with a fill per named slot, so
 * a piece is no longer one primitive at one anchor: it is N primitives at N
 * offsets from one origin. This is that offset, and it is the only new geometric
 * quantity the change introduces.
 *
 * **This type is the shape row A4a expects and row B2 fills in.** B2 owns
 * `src/template/**` and the `SlotRule` model, whose offsets are *computed at fill
 * time from the fill's own footprint* — §1.4 measured the `base` slot admitting
 * 25 distinct footprints and `wall` 14, so a stored quadruple would be wrong for
 * most fills of the same slot. Nothing here evaluates a rule; the rule is passed
 * in (`catalog.ts`'s `SlotLayoutRule`) and this is the answer it returns.
 *
 * ## Four facts the fields are shaped by
 *
 *   - **`dx`/`dz` locate the part's *minimum corner*, in the template's own
 *     unrotated frame.** Not its centre, for the module note's two reasons
 *     applied one level down: a wall's short axis is
 *     {@link WALL_THICKNESS_UNITS} = 0.5, so a centred wall's faces would sit a
 *     quarter unit off the lattice, and the corner is what abuts. Row **B2**'s
 *     `slotOffset` states its answer from the cell's *centre* instead, so the
 *     rule that fills this in converts — see {@link SlotLayout.cell}.
 *   - **`dx`/`dz` land on multiples of 0.25 and deliberately do not snap.** §2.2:
 *     the *origin* of an instance snaps to the 0.5 lattice (§7) and a slot offset
 *     never does. So these are plain finite numbers and no lattice is enforced —
 *     {@link snapTo} is for the origin and must not be applied here.
 *   - **`rotation` is relative to the instance's own.** A template is *"placed
 *     and rotated as one unit"* (§1), so there is exactly one stored angle;
 *     `src/store/schema.ts#Rotation` says so outright. A part's yaw inside the
 *     recipe — the right wall turned 90° from the left one — is a property of the
 *     recipe, not of the placement, so it belongs here and is *added* to the
 *     instance's rotation by {@link slotGeometry}.
 *   - **`elevationMm` is normalised and is never read from the file.** §2.2, §9:
 *     18.4% of measured `openforge` toppers are authored pre-lifted by exactly
 *     6.0 mm and 77.5% are not, so a height taken off the mesh encodes that
 *     inconsistency. The rule states the lift; the mesh does not get a vote. In
 *     **millimetres**, and the unit is in the name because `dx`/`dz` are grid
 *     units and the two must never be added.
 */
export interface SlotLayout {
  /** Offset along `x` from the instance origin to the part's minimum corner, in grid units. */
  readonly dx: number
  /** Offset along `z` from the instance origin to the part's minimum corner, in grid units. */
  readonly dz: number
  /** The part's own yaw inside the recipe, in degrees. Added to the instance's. */
  readonly rotation: number
  /** How high the part stands above the plan, in millimetres. Normalised, never measured. */
  readonly elevationMm: number
  /**
   * The template's own footprint — the box the instance turns **within**, in
   * grid units, unrotated. Absent when the part is its own cell.
   *
   * **The field that makes a template a rigid body**, and it is here rather than
   * derived because the derivation is not local: §1 places and rotates a
   * template *as one unit*, so a quarter turn may swap the instance's width for
   * its depth and must not change its area — and re-anchoring the turned
   * assembly needs the box the whole thing occupies, which no single part knows.
   * Row **B2** resolves it once per instance (`TemplateLayout.cell` names the
   * slot whose fill *is* the cell, `rect` on 2,996 of 2,996 files) and every
   * part of that instance carries the same value.
   *
   * Absent means **the part is its own cell**, which is not a fallback but the
   * single-piece convention this module already states: rotation preserves the
   * anchor corner and the extents swap around it. It is exact for every rule
   * that puts its parts at the origin — {@link ORIGIN_LAYOUT}, and so the whole
   * shipped corpus until B2's rule is wired — because N boxes sharing one corner
   * union to `(max w) x (max d)`, whose area a quarter turn also preserves. A
   * *non-zero* `dx`/`dz` with no cell is the one combination that is not rigid,
   * and `geometry.test.ts` measures it at three times its own ground so the
   * field cannot be quietly dropped.
   */
  readonly cell?: Extent | undefined
  /**
   * The box this part is **drawn at**, when the rule narrows it below its fill's
   * own footprint. Absent on every other part, which is almost all of them.
   *
   * A statement about the *shape* on an interface that is otherwise about
   * position, and it is here because the rule is the only thing that can make
   * it. `template/rules.ts`'s `residual` anchor gives the floor of an `s2w`
   * recipe the part of the cell its separately printed walls do not stand on, and
   * the size of that part follows from the walls — which no single slot knows and
   * no tag records. The floor's own tags name the size of its **tile**
   * (`size|width|2 + size|depth|2` on a slab that measures 1.5 × 1.5), so a
   * renderer that drew it at its tagged extent would put a quarter unit of it
   * under each wall; `template/offsets.ts#residualBox` carries the meshes that
   * measure the difference.
   *
   * `scene.ts` derives the part's `PlanShape` from this rather than from the
   * record's footprint when it is present, so the narrowing reaches the box, the
   * polygons, the overlap check, `place.ts#tileMatrix`'s centring **and**
   * `reanchorPiece`'s re-projection through one value. `dx`/`dz` are the minimum
   * corner of *this* box, not of the tagged one.
   *
   * Always a `rect` at rotation 0: a narrowed slot is the cell slot, and
   * `offsets.ts#cellExtentOf` admits nothing but a `rect` as a cell.
   */
  readonly residual?: Extent | undefined
}

/**
 * Every part at the origin, unturned and unlifted.
 *
 * **The layout in force until row B2's `SlotRule` lands**, and a real answer
 * rather than a placeholder: it is exactly right for the slots that *are* at the
 * origin, and those are the majority of the shipped corpus. Measured over
 * `src/screens/assemblies/templates.ts` — 40 templates, 128 parts, 6 distinct
 * part names:
 *
 * | slot                       | templates carrying it |
 * | -------------------------- | --------------------: |
 * | `floor`                    |             **40/40** |
 * | `base`                     |             **40/40** |
 * | `column`/`left`/`right`/`wall` |     the remaining 48 parts |
 *
 * 36 of the 40 templates have exactly **three** parts and 4 have five, so
 * `floor` + `base` is 80 of the 128 parts — **62.5%** placed correctly by this
 * rule, and the rest stacked at the same anchor. What it cannot do is separate
 * the two walls of a corner.
 *
 * It is frozen because it is handed out by reference to every part of every
 * instance in the scene.
 */
export const ORIGIN_LAYOUT: SlotLayout = Object.freeze({ dx: 0, dz: 0, rotation: 0, elevationMm: 0 })

/**
 * Turn an offset about the origin, exactly on the quarter turns.
 *
 * The quarter turns are computed by swapping and negating rather than by
 * trigonometry, for {@link rotatedExtent}'s reason applied to a *position*
 * instead of a size: `Math.cos(Math.PI / 2)` is 6.1e-17, so a 0.5-unit offset
 * turned 90° by trig lands 3e-17 off the lattice — and a 3e-17 offset is
 * precisely the value that makes two parts look flush and fail an equality test.
 * Slot offsets are multiples of 0.25 (§2.2), so on a quarter turn the exact
 * branch keeps them there.
 *
 * `+ 0` folds `-0`, which the negating branches really do produce from a zero
 * offset — and `-0` survives in memory but not through `JSON.stringify`.
 *
 * **This is the orbit of a point.** A *box* does not orbit by its corner —
 * {@link slotAnchor} is the one that turns a part, and `turnedCorner` is why.
 */
export function turnOffset(dx: number, dz: number, rotation: number): PlanPoint {
  if (isAxisAligned(rotation)) {
    switch (Math.round(normalizeRotation(rotation) / 90) % 4) {
      case 1:
        return [-dz + 0, dx + 0]
      case 2:
        return [-dx + 0, -dz + 0]
      case 3:
        return [dz + 0, -dx + 0]
      default:
        return [dx + 0, dz + 0]
    }
  }
  const radians = (rotation * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return [dx * cos - dz * sin, dx * sin + dz * cos]
}

/**
 * The minimum corner of a box at `dx`/`dz` with extent `extent`, once the box is
 * turned about the instance origin.
 *
 * **Not `turnOffset` of the corner**, and the difference is the whole of row
 * A10. Orbiting a *point* is right for a point; a box's minimum corner is not
 * preserved by the orbit, because the box then still extends towards +x/+z from
 * wherever the corner landed instead of in the direction the turn sent it. The
 * image of `[x0, x1] x [z0, z1]` under `+90°` — which sends `(x, z)` to
 * `(-z, x)` — is `[-z1, -z0] x [x0, x1]`, so the new minimum corner is
 * `(-(dz + d), dx)` and the depth is the term the orbit drops.
 *
 * Written out per quarter rather than as centre-orbit-then-recentre for
 * {@link turnOffset}'s reason: every branch here is additions of the caller's own
 * values, so a 0.25-unit offset on a 0.5-unit extent stays exactly where it is,
 * where `(dx + w / 2) - w / 2` is only exact when `w / 2` is binary-exact. Off
 * the quarters there is no lattice left to keep and the centre form is used.
 */
function turnedCorner(dx: number, dz: number, extent: Extent, rotation: number): PlanPoint {
  if (isAxisAligned(rotation)) {
    switch (Math.round(normalizeRotation(rotation) / 90) % 4) {
      case 1:
        return [-(dz + extent.d) + 0, dx + 0]
      case 2:
        return [-(dx + extent.w) + 0, -(dz + extent.d) + 0]
      case 3:
        return [dz + 0, -(dx + extent.w) + 0]
      default:
        return [dx + 0, dz + 0]
    }
  }
  const [cx, cz] = turnOffset(dx + extent.w / 2, dz + extent.d / 2, rotation)
  const turned = rotatedExtent(extent, rotation)
  return [cx - turned.w / 2, cz - turned.d / 2]
}

/**
 * The world anchor corner of one part: where its box lands once the whole
 * template has turned.
 *
 * **The composition rule, stated once, and row A10 restated it.** A4a's rule was
 * *"the part turns about its own anchor corner, and that corner orbits the
 * instance origin"*, which row A4b then measured: on the five-part fixture corner
 * the union footprint went 4.00 → 7.00 → **12.25** → 7.00 units² across the four
 * quarters, so a half-turned 2 x 2 corner covered three times its own ground and
 * `fitRoom` framed a box three times too large. Orbiting the minimum corner and
 * then extending towards +x/+z from it are two effects that do not compose; see
 * {@link turnedCorner}.
 *
 * The rule that does compose, and the one this function implements:
 *
 *   1. **The part's box turns about the instance origin** — box, not corner, so
 *      the assembly is a rigid body and the area is preserved exactly.
 *   2. **The turned assembly is re-anchored to the origin**, by subtracting where
 *      the *cell* box landed. That is what keeps `x`/`z` the minimum corner of
 *      what the instance occupies at every angle, which is the convention the
 *      module note derives from the 0.5 lattice and the share codec's quantum,
 *      and it is why the fix is not simply "orbit the centre": rotating about the
 *      origin alone would swing a 2 x 2 corner out of its own cell.
 *
 * With no {@link SlotLayout.cell} the part is its own cell and step 2 cancels
 * step 1's re-anchoring for that part alone, which reproduces the single-piece
 * convention exactly — `ORIGIN_LAYOUT` places every part at the origin and every
 * part stays there, extents swapping, as it did before this row.
 */
export function slotAnchor(
  shape: PlanShape,
  layout: SlotLayout,
  origin: PlanPoint,
  rotation: number,
): PlanPoint {
  const local = rotatedExtent(shape.extent, normalizeRotation(layout.rotation + shape.angle))
  const [px, pz] = turnedCorner(layout.dx, layout.dz, local, rotation)
  const [cx, cz] = turnedCorner(0, 0, layout.cell ?? local, rotation)
  return [origin[0] + px - cx, origin[1] + pz - cz]
}

/**
 * One part's plan geometry: its footprint, at its slot's offset, turned with its
 * instance.
 *
 * The per-part counterpart of {@link planGeometry} and the only place the two
 * rotations are added. `rotation` is the *instance's* stored angle; the part's
 * own yaw comes off `layout` and the footprint's intrinsic angle off `shape`, so
 * a `diag` in a slot turned 90° in a template turned 45° is drawn at 180° and
 * nothing has to know that but this line.
 */
export function slotGeometry(
  shape: PlanShape,
  layout: SlotLayout,
  origin: PlanPoint,
  rotation: number,
): PlanGeometry {
  const anchor = slotAnchor(shape, layout, origin, rotation)
  return planGeometry(shape, normalizeRotation(rotation + layout.rotation), anchor[0], anchor[1])
}

/**
 * The axis-aligned box containing every one of these, or `undefined` for none.
 *
 * What an *instance* occupies, as against what one part does: a template has N
 * boxes and the scene, the viewport and the move readouts all want one. Returns
 * `undefined` rather than a degenerate box for the empty case, because an
 * instance with nothing drawable is a thing the scene reports rather than draws
 * — see `scene.ts`'s `unfilled` list.
 */
export function unionBox(boxes: readonly PlanBox[]): PlanBox | undefined {
  if (boxes.length === 0) return undefined
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const box of boxes) {
    left = Math.min(left, box.x)
    top = Math.min(top, box.z)
    right = Math.max(right, box.x + box.w)
    bottom = Math.max(bottom, box.z + box.d)
  }
  return { x: left, z: top, w: right - left, d: bottom - top }
}

/**
 * The four corners of a turned rectangle — the piece itself, not its bounding
 * box.
 *
 * The straight-case shorthand, and what the tests for the anchoring rule are
 * written against. A 45° tile's bounding box is 41% larger than the tile, so
 * treating the box as the tile would report an overlap with a neighbour the
 * piece does not touch.
 */
export function planQuad(extent: Extent, rotation: number, x: number, z: number): PlanPart {
  const box = planBox(extent, rotation, x, z)
  const radians = (rotation * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return boxPart(extent).map((point) => place(point, extent, box, cos, sin))
}

/** Whether a point is inside a convex polygon, boundary included. */
export function quadContains(quad: PlanPart, point: PlanPoint): boolean {
  let sign = 0
  for (let i = 0; i < quad.length; i += 1) {
    const [ax, az] = quad[i] as PlanPoint
    const [bx, bz] = quad[(i + 1) % quad.length] as PlanPoint
    const cross = (bx - ax) * (point[1] - az) - (bz - az) * (point[0] - ax)
    if (Math.abs(cross) < 1e-9) continue
    const next = cross > 0 ? 1 : -1
    if (sign === 0) sign = next
    else if (sign !== next) return false
  }
  return true
}

/**
 * Whether a point is inside any of a shape's convex parts.
 *
 * For a sector this is generous by at most the shape's `slack` — 0.009677 units
 * at worst, which is 0.42 px at the default zoom (`DEFAULT_SCALE` 44) and 3.1 px
 * at `MAX_SCALE` 320. Generous is the right direction for a hit test: it means a
 * click a hair outside a curve's edge erases the curve rather than nothing, and
 * even the 3 px is inside a pointer's own target.
 */
export function partsContain(parts: readonly PlanPart[], point: PlanPoint): boolean {
  return parts.some((part) => quadContains(part, point))
}

/* ------------------------------------------------------------------ anchoring */

/**
 * The snapped anchor for a piece the user is pointing the *centre* of at
 * (`x`, `z`).
 *
 * Pointing at the centre is what makes the ghost feel attached to the cursor;
 * snapping the resulting *corner* is what keeps the piece on the lattice. Doing
 * it the other way round — snapping the cursor and then subtracting half the
 * extent — puts a 1 × 1 tile's faces on the half-unit lattice but a 2 × 0.5
 * wall's faces a quarter unit off it.
 *
 * `rotation` is the **drawn** angle, so a caller with a `PlanShape` passes
 * `rotation + shape.angle`. {@link anchorForShape} does that for it.
 */
export function anchorFor(extent: Extent, rotation: number, x: number, z: number, step: number): PlanPoint {
  const turned = rotatedExtent(extent, rotation)
  return [snapTo(x - turned.w / 2, step), snapTo(z - turned.d / 2, step)]
}

/** {@link anchorFor} for a resolved shape, with its intrinsic angle folded in. */
export function anchorForShape(shape: PlanShape, rotation: number, x: number, z: number, step: number): PlanPoint {
  return anchorFor(shape.extent, normalizeRotation(rotation + shape.angle), x, z, step)
}

/* ------------------------------------------------------------------ rotation */

/**
 * This tile's rotation step, in degrees.
 *
 * `rotStep` is present on 1,548 tiles and **893 of them carry a value that is
 * not a multiple of 90** (45, 22.5, 11.25, 60, 120, 240, 300). Those tiles would
 * never tile on a 90° step, which is why the step is per-tile and why a global
 * constant here would be a bug rather than a simplification.
 *
 * The `arc` cases make the point sharpest: **the step equals the sweep on all
 * 1,199 of them** — 20 at 11.25°, 186 at 22.5°, 439 at 45°, 554 at 90° — so one
 * press of ⟳ lands a curve exactly beside its predecessor and a run of four 22.5°
 * pieces closes a 90° bend. A 90° step would make 645 of those tiles impossible
 * to assemble in the builder while looking as though they had been placed.
 */
export function rotationStepFor(record: Pick<CatalogRecord, 'rotStep'>): number {
  return record.rotStep ?? DEFAULT_ROTATION_STEP_DEG
}

/** The next angle, folded into `[0, 360)` by the store's own normaliser. */
export function nextRotation(rotation: number, step: number, direction: 1 | -1 = 1): number {
  return normalizeRotation(rotation + step * direction)
}

/* ------------------------------------------------------------------- refusal */

/** Why a tile cannot be drawn on the plan. One case, and it is permanent. */
export type RefusalCode = 'no-footprint'

export interface Refusal {
  readonly code: RefusalCode
  /** Shown to the user, and read out by the canvas's live region. */
  readonly message: string
}

/**
 * The refusal code for a footprint, or `undefined` when it can be drawn.
 *
 * **The single gate.** {@link placementRefusal} adds the tile's name to it and
 * {@link isPlaceable} reads it, so the message the palette shows and the
 * decision the palette greys on cannot come apart — which is exactly how 249
 * tiles came to be greyed out with an empty explanation.
 *
 * Note the deliberate difference from `src/assembly/resolve.ts`, which never
 * refuses a placement: that module is about *compatibility*, where §7's rule is
 * that compatibility informs and never refuses. This is about *drawability*, and
 * for `none` there is nothing to draw.
 */
export function footprintRefusal(foot: Footprint): RefusalCode | undefined {
  return footprintShape(foot) === undefined ? 'no-footprint' : undefined
}

/**
 * Whether this tile can be drawn on the plan, and why not when it cannot.
 *
 * The renderer draws a refused tile as a marker rather than silently doing
 * nothing, because a palette selection that produces no ghost and no error is
 * indistinguishable from a broken builder. That was a hatched cross in the plan
 * view; row **R4** deleted it and `three/markers.ts` carries the 3D equivalent,
 * which is the same argument in a different medium.
 *
 * The message says "on the plan" and not "in plan view", which R4 changed
 * throughout: the plan is the lattice a room is built on and is still there; the
 * *view* was the SVG renderer and is not. See `canvas/index.ts` on what "plan"
 * now means.
 */
export function placementRefusal(record: Pick<CatalogRecord, 'foot' | 'name'>): Refusal | undefined {
  if (footprintRefusal(record.foot) === undefined) return undefined
  return {
    code: 'no-footprint',
    message: `${record.name} has no derivable footprint, so it cannot be placed on the plan.`,
  }
}

/** Whether the palette should offer this tile for placement. */
export function isPlaceable(record: Pick<CatalogRecord, 'foot'>): boolean {
  return footprintRefusal(record.foot) === undefined
}

/* ------------------------------------------------------------------- caveats */

/** A placement that is allowed but whose geometry is not fully evidenced. */
export type CaveatCode = 'unmeasured-band'

export interface PlanCaveat {
  readonly code: CaveatCode
  /** Shown beside the piece and read out with it. */
  readonly message: string
}

/**
 * Whether this tile's outline rests on a measurement, and what is missing when
 * it does not.
 *
 * **Disclosure, not a veto, and the schema says why.** 462 of the 1,199 `arc`
 * tiles carry `bandBasis: 'fallback'`: 397 `convex`, whose 0.5-unit band *width*
 * W1 confirms 36 times over on `concave` meshes but whose *side* of the tagged
 * radius rests on W2's four research measurements after W1 attempted 43 convex
 * meshes and refused all 43; 55 that named no band at all and took the written
 * `radial` default; and 10 `s2w_radial`, which no W1 target set ever reached.
 *
 * The error a fallback band can carry is therefore **radial position, bounded by
 * 0.5 units** — one wall thickness, the width of the band itself. It is never an
 * error in the sweep (every arc tile carries a `size|angle`; 0 fabricate one) and
 * never in the band width. Refusing 38.5% of the curves over a half-unit
 * side-of-the-radius question would withdraw more of the corpus than this row
 * adds, so the sector is drawn as the project's best statement of it, marked
 * where the user can see the mark, and named in the accessible label. That is
 * the same call `src/catalog/schema.ts` makes when it puts the bit in the union
 * "so the decision belongs to the consumer instead of to the importer".
 */
export function placementCaveat(record: Pick<CatalogRecord, 'foot' | 'name'>): PlanCaveat | undefined {
  if (record.foot.shape !== 'arc' || record.foot.bandBasis !== 'fallback') return undefined
  return {
    code: 'unmeasured-band',
    message:
      `${record.name} is drawn from the ${record.foot.band} band rule, which has no accepted mesh fit behind ` +
      `it — the sweep and the band width are evidenced, its position across the tagged radius is not, ` +
      `so the outline may sit up to half a unit in or out.`,
  }
}

/* ------------------------------------------------------------------ readouts */

/** A coordinate as the readouts and announcements spell it: at most two decimals, no trailing zeros. */
export function formatUnits(value: number): string {
  return String(Math.round(value * 100) / 100)
}

/** "x 3.5, z 2" — the grid position, for the mono readout and the live region. */
export function describeCell(x: number, z: number): string {
  return `x ${formatUnits(x)}, z ${formatUnits(z)}`
}

/** "2 × 0.5 units" — an extent, for a placement's accessible name. */
export function describeExtent(extent: Extent): string {
  return `${formatUnits(extent.w)} × ${formatUnits(extent.d)} units`
}

/**
 * A footprint in words, for the accessible name.
 *
 * Per case rather than always the bounding box, because a box is a lie about a
 * curve: a 22.5° sector at `rIn = 4, rOut = 4.5` fills 11.4% of the 1.7 × 1.7
 * box `describeExtent` would read out, and a screen-reader user given "1.72 ×
 * 1.72 units" would have been told the size of a small floor tile. The straight
 * cases keep the extent, which for them is the truth.
 */
export function describeFootprint(foot: Footprint, extent: Extent): string {
  switch (foot.shape) {
    case 'rect':
    case 'wall':
    case 'column':
      return describeExtent(extent)
    case 'tri':
      return `${formatUnits(foot.leg)} × ${formatUnits(foot.leg)} unit right triangle`
    case 'diag':
      return `${formatUnits(foot.run)} unit diagonal wall run`
    case 'arc':
      return `curve, radius ${formatUnits(foot.rIn)} to ${formatUnits(foot.rOut)} units, ${formatUnits(foot.sweep)}° sweep`
    case 'none':
      return 'no plan shape'
    default:
      return unhandled(foot)
  }
}
