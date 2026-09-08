/**
 * The numbers — computed at fill time, from the fill's own footprint, and never
 * stored.
 *
 * `rules.ts` carries *which* face a slot is anchored to. This file is the only
 * place a coordinate is produced, and it produces one from three inputs that do
 * not all exist until the user has picked: the rule, the cell's resolved
 * footprint, and the slot fill's own resolved footprint.
 *
 * ## The arithmetic
 *
 * Everything is derived in a frame `F` where the anchored face is `-z`. In `F`
 * the cell extent is the cell's own extent with `w` and `d` swapped on an odd
 * quarter turn — exact, never trigonometric, and asserted equal to
 * `geometry.ts#rotatedExtent` for every multiple of 90 — and the part is already
 * aligned, because the part is yawed by exactly `side * 90`. So:
 *
 * ```
 * cell     →  (0, 0)
 * edge     →  (reserved / 2, −(cellF.d − part.d) / 2)             flush to −z, centred on what the corner leaves
 * corner   →  (−(cellF.w − part.w) / 2, −(cellF.d − part.d) / 2)  flush to −x and −z
 * residual →  ((minX − maxX) / 2, (minZ − maxZ) / 2)              what the edges leave, in the cell's own frame
 * ```
 *
 * and the result is turned back by `side` quarter-turns — except the `residual`
 * line, which is stated against all four faces at once and so has no side to turn
 * by. It is the one anchor whose **extent** the rule supplies as well as its
 * position; see {@link residualBox} for why the fill's own footprint is not it.
 *
 * The `z` term is always
 * an **inset** while the part is no deeper than the face it lies on, so nothing
 * overhangs the cell and a template's union *is* its cell — which is how row A10
 * settled a 2 x 2 corner's footprint at 4.00 units²; `offsets.test.ts` measures
 * both that and what a part deeper than its own cell does instead. At `side: 0`
 * the `corner` line is `(−(W − 0.5) / 2, −(D − 0.5) / 2)` for every real fill,
 * because `{shape:'column'}` is the only footprint any of the 8 `corner` slots
 * admits and a column is exactly {@link WALL_THICKNESS_UNITS} square —
 * `offsets.test.ts` asserts that equivalence rather than hard-coding the 0.5.
 *
 * ### `reserved` — the edge abuts its corner sibling, and row D9 measured why
 *
 * `reserved` is the signed span a `corner`-anchored sibling takes out of *this*
 * face, from {@link cornerReservation}: `+span` when the corner sits at the face
 * frame's `−x` end, `−span` when it sits at `+x`, and **0 when no corner touches
 * this face at all**, which is every one of the 40 `wall-on-tile` edges. So the
 * wall is centred on the span the corner leaves rather than on the whole face,
 * and `reserved / 2` is that recentring.
 *
 * This is the second of the two edits row **D8** named as mutually exclusive and
 * declined to pick between, and it is now the measured one: a corner wall tagged
 * `size|width|2` **runs 1.5** (`footprint.ts#cornerWallRun`, 157 meshes), so
 * `1.5 + 0.5 = 2` and the wall meets the column exactly. Centring across the
 * whole face put that 1.5 run at `x ∈ [0.25, 1.75]` — a quarter unit over the
 * column at one end and a quarter-unit gap at the other, which D8 measured and
 * reported. Abutting puts it at `x ∈ [0.5, 2.0]` against a column at
 * `[0, 0.5]`, and the two corner recipes draw the identical L.
 *
 * Written as `reserved / 2` rather than `+(cellF.w − part.w) / 2` on purpose:
 * the two agree exactly whenever the face closes, and only the former is 0 when
 * the corner reserves nothing — an unfilled corner slot must not shove the wall
 * to one end of a face nothing is standing on. It also makes this line and
 * {@link cornerReservation}'s subtraction in the closure check **one**
 * convention instead of two, which is what D8 asked for.
 *
 * ## Two arithmetic hazards, both measured
 *
 * **1. Slot offsets are off the snap lattice, deliberately.** Every catalog
 * dimension is a multiple of 0.5, so every half-difference above is a multiple
 * of **0.25**, and `SNAP_STEP.fine` is 0.5 with *"deliberately no 0.25"*.
 * Measured over the 1,006 closing combinations, the `edge` inset takes exactly
 * four distinct values — `-1.25`, `-0.75`, `-0.25`, `0` — and **three of the
 * four are off the 0.5 lattice**. So the template *origin* is the snapped
 * quantity and a slot offset must **never** be snapped: `snapTo(-0.75, 0.5)` is
 * `-0.5`, and a quarter unit is the difference between a wall flush against a
 * floor and a wall a quarter unit inside it. `offsets.test.ts` asserts the gap
 * in both directions, so a snap introduced here fails the suite.
 *
 * **2. Elevation is normalised and never read from the file.** Measured over the
 * 583 `openforge` toppers in `tools/measure/measurements.json`: **452 (77.5%)
 * are authored resting on z = 0, 107 (18.4%) are authored pre-lifted by exactly
 * one base thickness** (n=107, min 5.910, median 6.0000, max 6.096), 18 are
 * elsewhere and 6 are negative. One design shows both halves at once —
 * `dungeon_stone#curved+interface,wall.BAxG.openforge.stl` sits at 5.997 mm
 * while the `openlock` variant of the same wall sits at −0.0001. So
 * {@link slotElevationMm} composes a chain of *measured mesh heights* supplied
 * by its caller and holds no millimetre of its own; `place.ts` normalising to
 * `-upright.min.y` before applying the lift is what makes that sound.
 *
 * ## Why the height is an argument and not an import
 *
 * There is exactly one elevation source in this project —
 * `src/builder/three/bases.ts#baseElevationMm`, which reads the resting mesh's
 * own upright height and falls back to `ABSENT_BASE_ELEVATION_MM` when the mesh
 * has not landed. This module must not become a second one, and it must also not
 * *import* the first. Three reasons, and the first alone settles it:
 *
 *   1. Row **A4b** owns `src/builder/three/**` and row **A2** reports the file
 *      may be deleted outright. A hard import from here would make this row's
 *      tests fail on a sibling's refactor of a file it does not own.
 *   2. `builder/three` is the *consumer* of this directory, so an import in this
 *      direction closes a cycle across two barrels.
 *   3. `bases.ts` reaches `@/store`, which this row must not touch.
 *
 * Taking the reader as a parameter satisfies all three and keeps the single
 * source single: the *number* comes from A4b's function, the *composition* comes
 * from here, and neither is duplicated. `offsets.test.ts` pins the contract that
 * function has to satisfy — the upright z extent, and a fallback for an absent
 * mesh — so a change to it that broke this composition would still be caught.
 */
import type { Footprint } from '@/catalog'
import { WALL_THICKNESS_UNITS } from '@/catalog'
import type { Extent, PlanPoint } from '@/builder/canvas/geometry'
import { footprintExtent } from '@/builder/canvas/geometry'

import type { SlotAnchor, SlotName, SlotRule, SlotSide, TemplateLayout } from './rules'
import { ruleFor } from './rules'

/** Degrees per side step. Named so `side * 90` is written once. */
const DEGREES_PER_SIDE = 90

/**
 * Tolerance for the closure comparison, in grid units.
 *
 * The dimensions being compared are catalog values — multiples of 0.5, plus the
 * four measured `diag` runs and the measured `1.547` curved-interface wall
 * length — so the arithmetic is not exact in general and an epsilon is needed.
 * `1e-6` is four orders of magnitude below the smallest real difference
 * ({@link WALL_THICKNESS_UNITS}, 0.5) and well above f64 noise on values of this
 * size.
 */
const CLOSURE_EPS = 1e-6

/**
 * A quarter turn of a plan point, by exact coordinate swap.
 *
 * The direction matches `geometry.ts#place` — which rotates by
 * `[dx·cos − dz·sin, dx·sin + dz·cos]`, so `+90°` sends `(x, z)` to `(−z, x)` —
 * and so `side` counts the same way a placement's rotation does.
 *
 * Swapped rather than computed, for `rotatedExtent`'s stated reason:
 * `Math.cos(Math.PI / 2)` is 6.1e-17, *"and a 6.1e-17 offset is precisely the
 * kind of value that makes two tiles look flush and fail an equality test."*
 * `+ 0` normalises `-0`, which survives in memory but not through
 * `JSON.stringify`, exactly as `snapTo` does it.
 */
export function quarterTurn(point: PlanPoint, side: SlotSide): PlanPoint {
  const [x, z] = point
  switch (side) {
    case 0:
      return [x + 0, z + 0]
    case 1:
      return [-z + 0, x + 0]
    case 2:
      return [-x + 0, -z + 0]
    case 3:
      return [z + 0, -x + 0]
  }
}

/**
 * A cell extent seen from the frame in which face `side` is `-z`.
 *
 * A w/d swap on an odd quarter turn, and the same answer
 * `geometry.ts#rotatedExtent` gives for a multiple of 90 —
 * `offsets.test.ts` asserts that equivalence over every extent and side, so the
 * two cannot silently diverge.
 *
 * Written here rather than called there for one reason: `rotatedExtent` also has
 * a trigonometric branch for the 893 tiles whose angle is not a multiple of 90,
 * and this module never needs it. A slot's `side` is one of four values by
 * construction. Depending on the general function would make this row's
 * arithmetic sensitive to a change in rotation semantics it does not use —
 * and row **A4a** is rewriting `src/builder/canvas/**`. So the *behavioural*
 * dependency is dropped and the *equivalence* is kept as an assertion.
 * `footprintExtent` stays a real import: it is the single footprint-to-extent
 * reader and a second copy of its seven-case switch would be a second source of
 * truth, which is worth a dependency where a w/d swap is not.
 */
function quarterTurnExtent(extent: Extent, side: SlotSide): Extent {
  return side % 2 === 0 ? { w: extent.w, d: extent.d } : { w: extent.d, d: extent.w }
}

/**
 * The slot's offset from the template's centre, in grid units, in the
 * template's own frame — before the placement's own rotation.
 *
 * `cell` is the resolved extent of the slot {@link TemplateLayout.cell} names;
 * `part` is the resolved extent of *this* slot's fill. Both come from
 * `footprintExtent`, so both are the piece's own-frame box and neither is a
 * guess.
 *
 * ## The frame the canvas wants, and why nothing converts yet
 *
 * This is a **centre-to-centre** offset: the cell is centred on the template
 * origin, and every anchor is an inset from it. `geometry.ts#SlotLayout` states
 * the same position as `dx`/`dz` to the part's **minimum corner** measured from
 * the cell's minimum corner, because a corner is what the 0.5 lattice and the
 * share codec's quantum both need. The conversion is exact and is one line —
 *
 * ```
 * dx = offset.x − drawn.w / 2 + cell.w / 2      drawn = rotatedExtent(extent, yaw + angle)
 * ```
 *
 * — and `offsets.test.ts` places all three conventions through the canvas's real
 * `slotGeometry` with it, measuring a closing template's union as exactly its own
 * cell on all four quarter turns.
 *
 * **Row C6 wired it, and the seam it needed is the one A10 named.**
 * `catalog.ts#SlotLayoutRule` was `(template, slot, record) => SlotLayout` and
 * handed over only the record of the slot being laid out, so a rule could not
 * resolve the *cell* slot's fill for any other slot. It is now
 * `(template, slot, fills) => SlotLayout` over the instance's whole fill map, and
 * `catalog.ts#templateSlotLayout` is the rule that composes this module with the
 * canvas — one line of it is the conversion above.
 *
 * ## The one edit row C6 made to this file, and why it had to
 *
 * The two imports below read `@/builder/canvas/geometry` rather than the
 * `@/builder/canvas` barrel. That is not tidying: `templateSlotLayout` lives in
 * `builder/canvas/catalog.ts`, which the barrel re-exports, so a barrel import
 * here would close `canvas/index.ts` → `catalog.ts` → `template/offsets.ts` →
 * `canvas/index.ts` — the barrel-mediated cycle row A7 flagged, and a TDZ trap
 * on `footprintExtent`, which is the one *value* this module takes from there.
 * `geometry.ts` imports only `@/catalog` and `@/store` and imports nothing from
 * this directory, so naming the leaf breaks the cycle at its only edge and costs
 * nothing: `footprintExtent` is defined there, not merely re-exported.
 *
 * ## The last two arguments default, and both defaults are traps
 *
 * `reserved` and `insets` are *context*: quantities {@link placeTemplateSlots}
 * resolves from the layout and the whole fill map, which this function cannot
 * see from one rule. Each defaults to nothing taken, and each default is the
 * pre-existing wrong answer for the anchor it belongs to — a corner's edge
 * centred across the whole face, a residual centred on the whole cell.
 *
 * They default anyway because most of the four anchors read neither, and a
 * caller holding one rule and two extents is the common case in tests. What
 * makes that safe is that the *only* production caller is
 * {@link placeTemplateSlots}, in this file, which supplies both; and
 * `corpus.test.ts` re-derives every offset of every walked combination through
 * this function with both supplied, so a default silently taken in production
 * would have to survive that comparison, and it cannot.
 */
export function slotOffset(
  rule: SlotRule,
  cell: Extent,
  part: Extent,
  reserved: number = 0,
  insets: EdgeInsets = NO_INSETS,
): PlanPoint {
  if (rule.anchor === 'cell') return [0, 0]
  if (rule.anchor === 'residual') return residualBox(cell, insets).offset
  const inFrame = quarterTurnExtent(cell, rule.side)
  const dz = -(inFrame.d - part.d) / 2
  const dx = rule.anchor === 'corner' ? -(inFrame.w - part.w) / 2 : reserved / 2
  return quarterTurn([dx, dz], rule.side)
}

/* ------------------------------------------------------------- the residual */

/**
 * How deep each of the cell's four faces is built on, in grid units.
 *
 * Named by the **face**, not by the axis, because that is what an `edge` rule
 * carries and because two faces of one axis are eaten independently:
 * `minZ` is face 0 (`−z`), `maxX` is face 1, `maxZ` is face 2 and `minX` is
 * face 3, which is {@link SlotSide}'s own `−z → +x → +z → −x` order read as four
 * names.
 */
export interface EdgeInsets {
  readonly minX: number
  readonly maxX: number
  readonly minZ: number
  readonly maxZ: number
}

/** Nothing built on any face — the answer for a layout with no `edge` slot. */
export const NO_INSETS: EdgeInsets = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }

/**
 * What the layout's `edge` slots take off each face of the cell.
 *
 * One pass over the rules, reading each `edge` fill's own footprint. The depth a
 * wall takes off its face is its own frame's `d` — **not** a quarter-turned
 * quantity — because {@link slotYaw} turns the part by `side * 90`, so its own
 * `d` always lies across the face it is anchored to. That is the same reading
 * {@link slotOffset}'s `dz` term makes, which is what keeps the residual and the
 * walls from being two conventions.
 *
 * A slot with no fill, or a fill with no extent, contributes **0** rather than a
 * guess. That is the honest answer and it is also the useful one: an unfilled
 * wall slot leaves the floor the whole cell, which is exactly what the room
 * shows while the user has not chosen a wall yet, and the slot's own `unfilled`
 * doubt is what says the template is incomplete.
 *
 * A fill with no *run* along the face — `diag`, `tri`, `arc`, the 104 of 1,215
 * combinations {@link SlotDoubtCode}'s `no-run` refuses a coordinate — is
 * likewise 0. Its bounding box says nothing about how much of the cell's axis it
 * takes, which is the same correction row E3 made to the walkability check for
 * the same reason: a part the rule declined to place must not silently move
 * another part.
 */
export function edgeInsets(layout: TemplateLayout, feet: ReadonlyMap<SlotName, Footprint>): EdgeInsets {
  const insets = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }
  for (const rule of layout.slots) {
    if (rule.anchor !== 'edge') continue
    const foot = feet.get(rule.part)
    if (foot === undefined || edgeRun(foot) === null) continue
    const extent = footprintExtent(foot)
    if (extent === undefined) continue
    switch (rule.side) {
      case 0:
        insets.minZ += extent.d
        break
      case 1:
        insets.maxX += extent.d
        break
      case 2:
        insets.maxZ += extent.d
        break
      case 3:
        insets.minX += extent.d
        break
    }
  }
  return insets
}

/**
 * The box the cell's `edge` slots leave, as a centre offset and an extent.
 *
 * The whole of the `residual` anchor. In the cell's own corner frame the
 * remainder runs `x ∈ [minX, cell.w − maxX]` and `z ∈ [minZ, cell.d − maxZ]`, so
 * its extent is the cell less both insets on each axis and its centre sits
 * `(minX − maxX) / 2` from the cell's — an exact half-difference, on the same
 * 0.25 lattice as every other offset this module produces and for the same
 * reason, and **never snapped** (§2.2).
 *
 * The extent is returned alongside the offset because the fill's own footprint
 * is **not** it, and that is the point of the anchor rather than an
 * inconvenience: an `s2w` floor is tagged with the size of its *tile* and
 * measures 0.5 less on each walled axis, so a caller that drew it at its tagged
 * extent would put a quarter unit of it under each wall. {@link SlotPlacement}
 * carries this extent as `residual` and `builder/canvas/catalog.ts` draws it
 * instead of the tagged one.
 *
 * On a layout with no `edge` slot the insets are all 0 and this is exactly the
 * cell at offset `[0, 0]` — the `cell` anchor's answer, reached by arithmetic
 * rather than by a special case, which is why `rules.ts#INTERNAL_CORNER` can carry
 * the same anchor as the other two.
 */
export function residualBox(cell: Extent, insets: EdgeInsets): { offset: PlanPoint; extent: Extent } {
  return {
    offset: [(insets.minX - insets.maxX) / 2 + 0, (insets.minZ - insets.maxZ) / 2 + 0],
    extent: { w: cell.w - insets.minX - insets.maxX, d: cell.d - insets.minZ - insets.maxZ },
  }
}

/**
 * The slot's yaw within the template, in degrees.
 *
 * `side * 90` and nothing else, which is why {@link SlotRule} carries no `yaw`
 * field: a stored yaw could disagree with the stored side. A placed template's
 * slot is drawn at `normalizeRotation(instance.rotation + slotYaw(rule))` — the
 * fold is the caller's, because `normalizeRotation` lives in `@/store` and this
 * row does not reach into row A1's directory.
 *
 * At a placement rotation in `{0, 90, 180, 270}` every slot yaw stays a multiple
 * of 90, so `rotatedExtent`'s exact-swap branch is taken for every slot of every
 * template and no slot picks up 6.1e-17.
 */
export function slotYaw(rule: SlotRule): number {
  return rule.side * DEGREES_PER_SIDE
}

/**
 * How far above the plan a slot rests, in millimetres, by walking
 * {@link SlotRule.restsOn} to the ground.
 *
 * `heightMm` is the measured upright height of one resting part — in the app
 * that is `bases.ts#baseElevationMm` — and it is called once per ancestor, never
 * for the slot itself. Throws on a cycle rather than looping: the three shipped
 * conventions are acyclic by construction and `rules.test.ts` asserts it, so a
 * cycle here means a fourth convention was authored wrongly and silence would
 * hang the renderer.
 */
export function slotElevationMm(
  layout: TemplateLayout,
  part: SlotName,
  heightMm: (resting: SlotName) => number,
): number {
  const seen = new Set<SlotName>([part])
  let total = 0
  let at = ruleFor(layout, part)?.restsOn ?? null
  while (at !== null) {
    if (seen.has(at)) throw new Error(`slot elevation cycle through ${at}`)
    seen.add(at)
    total += heightMm(at)
    at = ruleFor(layout, at)?.restsOn ?? null
  }
  return total
}

/* ------------------------------------------------------------------- closure */

/**
 * How far a fill runs along the face it is anchored to, or `null` when the
 * question does not apply to its footprint.
 *
 * Four of the seven `Footprint` cases have a run along an axis-aligned face and
 * three do not, and the three are refusals rather than approximations:
 *
 *   - `arc` — a sector's outline meets a face at a tangent, not along it.
 *   - `tri` — the hypotenuse is the interesting edge and it is diagonal. 2 of
 *     the 1,215 walked combinations.
 *   - `diag` — a 45° wall run has no cell face to lie along at all. 102 of
 *     1,215, over four measured runs (3.334 × 37, 2.835 × 29, 2.828 × 18,
 *     3.536 × 18).
 *
 * `none` never reaches here: it has no extent, so it is refused one step
 * earlier.
 */
export function edgeRun(foot: Footprint): number | null {
  switch (foot.shape) {
    case 'wall':
      return foot.length
    case 'rect':
      return foot.w
    case 'column':
      return WALL_THICKNESS_UNITS
    case 'arc':
    case 'tri':
    case 'diag':
    case 'none':
      return null
  }
}

/**
 * Whether the rule's arithmetic closes on one set of fills.
 *
 *   - `closes` — every anchored face is exactly filled. **1,006 of 1,215
 *     (82.8%)** walked combinations.
 *   - `fails` — a face is over- or under-filled, by a measurable amount.
 *     **33 (2.7%)**.
 *   - `undecidable` — some fill has no run to compare, or the layout has no
 *     anchored face to compare against. **176 (14.5%)**.
 *
 * Three outcomes rather than a boolean, because the plan is explicit that the
 * failures must not be repaired by a fabricated number: *"the mitre is in no tag
 * and no measurement. Do not silently write 1.5."* A `fails` verdict is
 * information the consumer surfaces as *needs a choice*; it is not a licence to
 * pick one.
 */
export type SlotVerdict = 'closes' | 'fails' | 'undecidable'

/**
 * Why one slot cannot be laid out, or does not fit.
 *
 * The six split two ways, and row **D8** made the split load-bearing:
 * `over-run` and row E3's `no-walk` still yield a {@link SlotPlacement}. The
 * other four mean *no position exists*; those two mean *the runs do not tile the
 * face* and *the faces leave nothing between them*, which are different sentences
 * and neither deprives a part of the face it is anchored to.
 */
export type SlotDoubtCode =
  /** No fill for the slot. C2 places incomplete instances by design. */
  | 'unfilled'
  /** The cell slot's fill is not a rectangle, so it has no faces to anchor to. */
  | 'no-cell'
  /** The fill's footprint is `{shape:'none'}` — 32 of 1,215, and refused by design. */
  | 'no-footprint'
  /** The fill has no run along a face: `diag`, `tri` or `arc`. 104 of 1,215. */
  | 'no-run'
  /** The fills along one face do not sum to it. 33 of 1,215. */
  | 'over-run'
  /**
   * The `edge` slots consume the cell's whole extent on one axis, so the
   * `residual` has no area and nothing is left to walk on. Row **E3**, widened.
   *
   * The one doubt that is not about a position. Every other code says *this part
   * cannot be placed* or *these runs do not tile this face*; this one says the
   * arithmetic is flawless and the result is a solid block of stone — zero
   * overlapping pairs, a union exactly equal to the cell, an area exact to A10's
   * invariant, and a wall where a floor was asked for.
   *
   * E3 wrote it for its corridor and compared an **opposed pair** of edges, on
   * which 0 of the 1,215 combinations of the 40 could reach it. It now compares
   * the residual itself, so an axis eaten from one end is checked too, and
   * **1 of the 1,215 reaches it**: a 1 x 1 cell whose `wall` slot resolves to
   * `rough_stone#column+low.I.openforge.stl`, a `rect 1x1` rather than a
   * {@link WALL_THICKNESS_UNITS}-deep run. See {@link walkability}.
   */
  | 'no-walk'

/**
 * One slot the rule could not place, or could not fit.
 *
 * `want` and `got` are present only on `over-run`, and they are the **cell
 * edge** and **what the fills sum to** — never the difference and never a
 * corrected run. The 8 single-piece corner mitres report `want: 2, got: 2.5`,
 * which says two 2-unit walls and a 0.5 column do not tile two 2-unit edges
 * end to end, and stops there. The number that would make them tile is not in
 * the corpus and is not invented here.
 *
 * **What row D8 measured about that sentence, and could not settle.** The 0.5 it
 * is short by is {@link cornerSpan}'s — the column's own span, subtracted from
 * the face on the assumption that the column and the wall lie end to end rather
 * than overlapping. Whether they do is exactly what the corpus does not say. The
 * 245 `shape|corner|left`/`right` records are **0 measured**, and worse, they do
 * not agree with each other: 224 carry `size|openlock|A` with a width and no
 * depth and resolve to `{shape:'wall', length:2}` — a 2 x 0.5 run — while 21
 * (`…grate+widened.2x2…`) carry `size|width|2` *and* `size|depth|2` and resolve
 * to `{shape:'rect', w:2, d:2}`, which is the **cell**, not a run. One tag class,
 * both readings, and every one of the 245 tagged `size|width|2`. So neither
 * "`size|width|2` names the run" nor "it names the cell" is the corpus's answer,
 * and the doubt stays a doubt.
 */
export interface SlotDoubt {
  readonly part: SlotName
  readonly code: SlotDoubtCode
  /**
   * The cell edge the fills have to sum to, in grid units.
   *
   * `over-run` and `no-walk`. On `no-walk` it is the cell's extent along the axis
   * the `edge` slots eat, and {@link got} is what they take of it — so
   * `want - got` is the residual on that axis, and the doubt fires when it is
   * zero or less.
   */
  readonly want?: number
  /** What they do sum to, in grid units. `over-run` and `no-walk` only. */
  readonly got?: number
}

/** One slot resolved: where it sits inside the template, and on what. */
export interface SlotPlacement {
  readonly part: SlotName
  readonly anchor: SlotAnchor
  readonly side: SlotSide
  /** Grid units from the template's centre, template-local, unrotated and unsnapped. */
  readonly offset: PlanPoint
  /** Degrees, template-local. Add the placement's own rotation. */
  readonly yaw: number
  readonly restsOn: SlotName | null
  /**
   * The extent the rule narrows this slot to, present on `residual` and on
   * nothing else.
   *
   * A caller draws the slot at **this** extent rather than at its fill's own
   * footprint. The two differ because an `s2w` floor's tags name the size of its
   * *tile* — `size|width|2 + size|depth|2` on a slab that measures 1.5 × 1.5 —
   * and the tile is the right answer for where the piece sits on the grid and the
   * wrong one for where the slab sits inside it. {@link residualBox} carries the
   * measurements.
   *
   * Optional rather than always-present, and rather than a second field on every
   * anchor, because for the other three the fill's own footprint really is the
   * box and a duplicate of it here would be a second source for the same
   * quantity — with the rotation question answered in two places. `residual` is
   * the cell slot and `cellExtentOf` admits only a `rect`, so this extent is
   * always axis-aligned at yaw 0 and needs no `rotatedExtent` to read; a `diag`'s
   * intrinsic 45° cannot reach it. `builder/canvas/catalog.ts` prefers it where
   * present and falls back to the rotated footprint otherwise.
   */
  readonly residual?: Extent
}

/** A layout resolved against one set of fills. */
export interface PlacedTemplate {
  /**
   * In {@link TemplateLayout.slots} order, minus any slot for which no position
   * exists.
   *
   * **Not "minus any slot that earned a doubt"** — row D8. An `over-run` slot
   * appears in *both* this list and {@link doubts}, because the two answer
   * different questions: where the part goes, and whether the runs tile the
   * face. `no-walk` is the same shape and names the cell slot, which is placed.
   * The other four {@link SlotDoubtCode}s appear only in `doubts`.
   */
  readonly slots: readonly SlotPlacement[]
  /**
   * Empty when the template is fully placed, every face tiles **and** the
   * residual the `edge` slots leave has area on both axes.
   */
  readonly doubts: readonly SlotDoubt[]
  readonly verdict: SlotVerdict
  /** The cell extent every offset was measured against, when there was one. */
  readonly cell: Extent | undefined
}

/**
 * The anchor a rule takes for **this** fill.
 *
 * `cell` and `residual` differ only by what the `edge` slots take off the cell,
 * so a slot whose fill is authored to the residual is already described by the
 * anchor beside it — see `rules.ts#isInsetFill` for the meshes that say which
 * fills those are.
 *
 * Only a `cell` rule can move. An `edge` or `corner` rule is anchored to a
 * *face*, and a fill being inset says nothing about which face it gave up; an
 * s2w base gives up the faces its own template's walls stand on, which is
 * exactly what the residual already computes and an edge anchor does not.
 */
function effectiveAnchor(rule: SlotRule, insetParts: ReadonlySet<SlotName>): SlotAnchor {
  return rule.anchor === 'cell' && insetParts.has(rule.part) ? 'residual' : rule.anchor
}

/**
 * The fill-time entry point: a layout plus the resolved footprint of each fill,
 * to a placement per slot plus whatever the rule could not answer.
 *
 * Partial by design. A slot with no fill, no footprint or no run yields a doubt
 * and no placement, and the rest of the template still places — which is the
 * contract the plan needs (*"No candidate leaves the slot empty, marked needs a
 * choice, and places anyway"*) and contract **C-g**'s *"`placeTemplate` must
 * accept incomplete fills"*.
 *
 * A slot whose face does not tile is a *different* case and gets both a doubt
 * and its position; see the `over-run` note in the loop below.
 *
 * ## `insetParts`, and why it is slot names rather than records
 *
 * The parts whose **fill** is authored short of the cell its tag names, so its
 * box is the residual. `rules.ts#isInsetFill` decides which those are and its
 * docblock carries the meshes; the population is the 95 s2w bases and the defect
 * is 18 of the 40 recipes drawing one a quarter unit out.
 *
 * It arrives as a `Set<SlotName>` and not as the fills themselves because this
 * module takes **footprints only** and has no `CatalogRecord` in its closure —
 * and cannot get one usefully, since the discriminator is a tag and a footprint
 * cannot carry it: a 2 x 2 s2w base and a 2 x 2 plain base have byte-identical
 * `foot`. So the record-to-boolean step stays with the three callers that
 * already hold fills, and what crosses the boundary is the answer.
 *
 * Defaulting to empty is what keeps every existing caller and all 20
 * `(Single Piece)` recipes on the anchor they had.
 */
export function placeTemplateSlots(
  layout: TemplateLayout,
  feet: ReadonlyMap<SlotName, Footprint>,
  insetParts: ReadonlySet<SlotName> = new Set(),
): PlacedTemplate {
  const slots: SlotPlacement[] = []
  const doubts: SlotDoubt[] = []

  const cell = cellExtentOf(layout, feet, doubts)
  /* What the walls take off each face, resolved once before the loop because the
     `residual` slot needs *every* edge slot's answer and the declared order puts
     the floor before the walls — a `restsOn` order, which is the right one for
     elevation and says nothing about who is resolvable first. */
  const insets = edgeInsets(layout, feet)
  const residual = cell === undefined ? undefined : residualBox(cell, insets)

  for (const rule of layout.slots) {
    const foot = feet.get(rule.part)
    if (foot === undefined) {
      doubts.push({ part: rule.part, code: 'unfilled' })
      continue
    }
    const part = footprintExtent(foot)
    if (part === undefined) {
      doubts.push({ part: rule.part, code: 'no-footprint' })
      continue
    }
    if (cell === undefined) continue
    /* Two checks that look alike and are not, and row **D8** separated them
       because conflating them shipped the worst available drawing.

       `no-run` is a **refusal**. A `diag`, `tri` or `arc` fill has no straight
       run to lie along, so anchoring it flush from its bounding box would set it
       against an axis it does not lie on. There is no position to give.

       `over-run` is a **warning**, and the slot is placed anyway. That the sum
       misses says the fills' *runs* do not tile the face under
       {@link cornerReservation}'s disjointness assumption; it does not say the
       part has nowhere to go. Its position is the face it is anchored to, and
       every part still lands inside its own cell whenever it is no longer than
       the span the corner leaves it — so the union is still the cell and A10's
       rigid body is intact. `offsets.test.ts` measures that union.

       **Row D9 emptied this case of the 8 single-piece corner mitres.** They
       were the 8 that reported `want: 2, got: 2.5`, on the strength of a
       `{shape:'wall', length:2}` footprint the meshes do not have: the run is
       1.5, so `1.5 + 0.5 = 2` and they close. What remains here is the 25
       combinations that fill a `wall` slot with a 0.5 column on a 2-unit face,
       where there is no run to match and the corpus really does admit the
       mismatch. The branch is still written to invent nothing — a doubt names
       the face and the sum and stops — because the *reason* it was written
       stands: a number that closes a face must be measured, never assumed.

       Refusing the coordinate collapsed both walls *and* the column to
       `dx = dz = 0` unrotated, which drew the two walls through each other along
       one face and left the other face bare. The project owner reported exactly
       that — *"the individual things filling the slots were overlapping and not
       in the right position"* — and it is strictly worse than either an honest
       overhang or nothing at all. A warning the user can act on plus the
       anchored position beats a pile, and it also beats inventing the half unit
       that would close the sum, which this branch still does not do. */
    const reserved = cornerReservation(layout, feet, rule.side)
    if (rule.anchor === 'edge') {
      const run = edgeRun(foot)
      if (run === null) {
        doubts.push({ part: rule.part, code: 'no-run' })
        continue
      }
      const span = rule.side % 2 === 0 ? cell.w : cell.d
      const taken = Math.abs(reserved)
      if (Math.abs(run + taken - span) > CLOSURE_EPS) {
        doubts.push({ part: rule.part, code: 'over-run', want: span, got: run + taken })
      }
    }
    /* Resolved here and not before the loop: `edgeInsets` above reads
       `rule.anchor` deliberately, because the residual is defined *by* the edge
       slots — an inset base feeding back into the insets would shrink the very
       box it is being fitted to. */
    const anchor = effectiveAnchor(rule, insetParts)
    slots.push({
      part: rule.part,
      anchor,
      side: rule.side,
      offset: slotOffset({ ...rule, anchor }, cell, part, reserved, insets),
      yaw: slotYaw(rule),
      restsOn: rule.restsOn,
      ...(anchor === 'residual' && residual !== undefined ? { residual: residual.extent } : {}),
    })
  }

  if (cell !== undefined) doubts.push(...walkability(layout.cell, cell, insets))

  return { slots, doubts, verdict: verdictOf(layout, doubts), cell }
}

/**
 * Whether the residual leaves anything to walk on.
 *
 * **Row E3 wrote this check for the corridor and it outlived the corridor**, in a
 * simpler form and over a wider population. E3's version compared each axis's
 * extent against the sum of the *opposed* pair of `edge` depths, because the
 * corridor was the first layout in which two slots ate the same axis. With the
 * `residual` anchor the subtraction has already been done, on all four faces at
 * once, so the question is just whether the box that came out has any area:
 * **the residual's extent must be positive on both axes.**
 *
 * That is strictly more than E3 could ask. Its pairing meant an axis eaten from
 * one end only was never checked at all — a 0.5-deep cell under a 0.5-deep wall
 * came out `closes`, with the floor a slab of zero extent — and a residual has no
 * end to be exempt.
 *
 * The signature takes the cell and the insets rather than the residual extent
 * itself, so the doubt can name the two numbers a reader needs; see the comment
 * in the body.
 *
 * ## Three things it deliberately does not do, all three unchanged from E3
 *
 *   - **It does not touch {@link cornerReservation}.** That function is wrong for
 *     a face flanked by two corners — D10 §3.4 measured the verdict inverting,
 *     `fails` on the run that tiles and `closes` on the run that overlaps — and
 *     repairing it is a different decision with its own measurement. It is not
 *     needed here: a corner reservation is a span *along* a face and this check is
 *     across one.
 *   - **An unfilled or runless wall is silent, not doubtful.** {@link edgeInsets}
 *     contributes 0 for it, so the residual is the whole cell and has area; the
 *     slot's own `unfilled` or `no-run` doubt is the honest report. A single wall
 *     on a 1 x 1 cell leaves 0.5 of walkable depth and is a perfectly ordinary
 *     wall tile — 980 of the 1,143 `wall-on-tile` combinations close on exactly
 *     that arrangement.
 *   - **It does not refuse the placement.** Like `over-run`, the parts have
 *     positions and the union really is the cell; what is wrong is the result, not
 *     the arithmetic. So the slots are placed and the doubt is raised, which is
 *     the shape row D8 settled for the same reason.
 *
 * **1 of the 1,215 walked combinations of the 40 reaches it, and E3's version
 * reached none.** The one is
 * `S2W: Wall on Tile: Wall (Any, Single Piece)` on a 1 x 1 cell whose `wall`
 * slot resolves to `rough_stone#column+low.I.openforge.stl` — a `rect 1x1`, not
 * a {@link WALL_THICKNESS_UNITS}-deep run — so the wall eats the cell's whole
 * depth and the floor is a slab of zero extent. Under E3's pairing that
 * combination had **no doubts at all** and came out `closes`: one edge is never
 * half of an opposed pair, so the axis was never checked. `corpus.test.ts` names
 * the combination rather than only counting it.
 *
 * Its run *does* tile the face — `edgeRun` of a `rect 1x1` is 1 on a 1-unit
 * span — so `over-run` was never going to catch it either. That is the point of
 * having both: one asks whether the pieces tile the face, this one asks whether
 * anything is left over.
 */
function walkability(part: SlotName, cell: Extent, insets: EdgeInsets): readonly SlotDoubt[] {
  const axes = [
    { span: cell.w, eaten: insets.minX + insets.maxX },
    { span: cell.d, eaten: insets.minZ + insets.maxZ },
  ]
  /* `want` and `got` are the **cell edge** and **what the walls take of it**, not
     the residual and zero, because those are the two numbers
     {@link slotDoubtSentence} has to be able to name and they are the two the
     user can act on. `want - got` is the residual, so the doubt fires on exactly
     the condition the docblock states.

     Named on the **cell** slot and not on any wall. No wall is wrong — each is
     flush to its own face and inside the cell — and the part that has nothing
     left is the floor, which is the cell slot on all three conventions. */
  return axes
    .filter((axis) => axis.span - axis.eaten <= CLOSURE_EPS)
    .map((axis) => ({ part, code: 'no-walk' as const, want: axis.span, got: axis.eaten }))
}

/**
 * A doubt as one sentence, for the surface that has to say *needs a choice*.
 *
 * Here rather than in the panel because the wording is a property of the rule:
 * an over-run is not something the user can be asked to work around silently,
 * and the sentence has to be able to name both numbers. The panel that mounts it
 * is row C3's.
 */
export function slotDoubtSentence(doubt: SlotDoubt): string {
  switch (doubt.code) {
    case 'unfilled':
      return `The ${doubt.part} part needs a choice.`
    case 'no-cell':
      return `The ${doubt.part} part is not a rectangular cell, so nothing can be anchored to its faces.`
    case 'no-footprint':
      return `The ${doubt.part} part has no placeable footprint, so this recipe needs a different one.`
    case 'no-run':
      return `The ${doubt.part} part has no straight run, so it does not lie along an edge of this cell.`
    case 'over-run':
      return (
        `The ${doubt.part} part needs a choice: this edge is ${format(doubt.want)} units and the ` +
        `pieces on it come to ${format(doubt.got)}.`
      )
    case 'no-walk':
      return (
        `The ${doubt.part} part needs a choice: it is ${format(doubt.want)} units across and the ` +
        `walls on either side take ${format(doubt.got)}, so nothing is left to walk on.`
      )
  }
}

/* ------------------------------------------------------------------- helpers */

function format(value: number | undefined): string {
  return value === undefined ? '?' : String(value)
}

/**
 * The template's cell, from the slot {@link TemplateLayout.cell} names.
 *
 * `rect` only, and that is not a narrowing in practice: over all 40 templates
 * the `floor` slot's candidates are rect on **2,996 of 2,996** files. It is a
 * narrowing in principle, and refusing rather than reading a `wall` run's box as
 * a cell is what keeps the 5 `wall`-footprint entries among the `base` slot's 25
 * footprints from being mistaken for one.
 */
function cellExtentOf(
  layout: TemplateLayout,
  feet: ReadonlyMap<SlotName, Footprint>,
  doubts: SlotDoubt[],
): Extent | undefined {
  const foot = feet.get(layout.cell)
  if (foot === undefined) {
    doubts.push({ part: layout.cell, code: 'unfilled' })
    return undefined
  }
  if (foot.shape !== 'rect') {
    doubts.push({ part: layout.cell, code: 'no-cell' })
    return undefined
  }
  return { w: foot.w, d: foot.d }
}

/**
 * Which end of face `face` a `corner`-anchored slot at side `corner` occupies,
 * as a sign in that face's own frame — `+1` at `−x`, `−1` at `+x`, `0` when the
 * corner does not touch the face.
 *
 * A `corner` rule is flush to `−x` **and** `−z` in `F(corner)`, so the square it
 * takes belongs to two faces and no others: face `corner`, where it is at the
 * `−x` end, and face `corner − 1`, where the same square lands at `+x`. That is
 * `rules.ts`'s own statement — *"`side: 0` and `side: 3` are adjacent, and the
 * corner they share is exactly the one `corner`, `side: 0` names"* — read as
 * arithmetic instead of as prose, and `offsets.test.ts` derives the `+x` half
 * from `quarterTurn` rather than trusting this comment.
 *
 * The `0` case is not decoration. Nothing in the corpus reaches it — the only
 * `corner` slots are the 8 columns of the external and internal corners, and no
 * template pairs a corner with an edge it does not touch — but without it a
 * fourth convention that put a column opposite its wall would have that column's
 * span silently subtracted from a face it is nowhere near.
 */
function cornerSign(corner: SlotSide, face: SlotSide): -1 | 0 | 1 {
  if (corner === face) return 1
  if ((corner + 3) % 4 === face) return -1
  return 0
}

/**
 * The signed span the `corner`-anchored siblings take out of one face:
 * **positive at the face's `−x` end, negative at `+x`, 0 when none touches it.**
 *
 * The magnitude is {@link WALL_THICKNESS_UNITS} on all 8 real corner slots,
 * because `{shape:'column'}` is the only footprint any of them admits — but read
 * off the fill rather than written as 0.5, so a future corner fill of another
 * size is reserved correctly instead of silently ignored. A column is square, so
 * which axis is read does not matter.
 *
 * ## The decision row D8 found, and which measurement settled
 *
 * D8 recorded that this subtraction and {@link slotOffset}'s `edge` line were
 * **two conventions of which at most one could be right**: this reserved the
 * corner's span at one end of the face, while `slotOffset` centred the wall
 * across the whole face and reserved nothing. Measured on a 2 x 2 external
 * corner at rotation 0, drawn through the canvas's own `slotGeometry`, the
 * verdicts came out backwards with respect to the picture — the `fails` recipe
 * drew a flawless L and the `closes` recipe drew each wall a quarter unit over
 * the column with a quarter-unit gap at the far end.
 *
 * D8 named the two available edits and declined to pick, because picking meant
 * deciding whether a corner wall's tagged 2 units include the mitre, *"a
 * decision for whoever can measure a mitre"*. Row **D9 measured the mitre**: 157
 * corner-wall meshes read whole from R2, and the run is **1.500** on all 245
 * records tagged `size|width|2` (`footprint.ts#cornerWallRun`). That picks D8's
 * option 2 and rules out option 1:
 *
 * | | run | face | 1.5 + 0.5 | drawn (cell-min coords) |
 * | --- | ---: | ---: | ---: | --- |
 * | column (`corner`, side 0) | 0.5 | — | — | `x ∈ [0, 0.5]`, `z ∈ [0, 0.5]` |
 * | right wall (`edge`, side 0) | 1.5 | 2 | **2 — closes** | `x ∈ [0.5, 2.0]`, `z ∈ [0, 0.5]` |
 * | left wall (`edge`, side 3) | 1.5 | 2 | **2 — closes** | `x ∈ [0, 0.5]`, `z ∈ [0.5, 2.0]` |
 *
 * Three parts, no overlap, no gap, everything inside `[0, 2]²`, and **both**
 * corner recipes now draw that — the single-piece and the modular are the same
 * geometry differing only in print count. Dropping the subtraction (option 1)
 * would instead have needed a 2-unit run, which is the number the meshes refute.
 *
 * The 0.5 fallback for an unfilled or extentless corner is kept from D8's
 * version: it is what a `no-cell`/`unfilled` combination's closure check is
 * measured against, and changing it would move the split for a reason that has
 * nothing to do with a mitre.
 */
export function cornerReservation(
  layout: TemplateLayout,
  feet: ReadonlyMap<SlotName, Footprint>,
  face: SlotSide,
): number {
  let total = 0
  for (const rule of layout.slots) {
    if (rule.anchor !== 'corner') continue
    const sign = cornerSign(rule.side, face)
    if (sign === 0) continue
    const foot = feet.get(rule.part)
    const extent = foot === undefined ? undefined : footprintExtent(foot)
    total += sign * (extent?.w ?? WALL_THICKNESS_UNITS)
  }
  return total
}

/**
 * `undecidable` beats `fails` beats `closes`, and a layout with no anchored face
 * is `undecidable` however well its cell slots resolved.
 *
 * The precedence matters because it is what the 1,006 / 33 / 176 split counts: a
 * combination whose wall fill is a `diag` *and* whose column over-runs is one
 * undecidable, not one of each. The four internal-corner recipes have no `edge`
 * slot at all, which is why all **38** of their walked combinations land here
 * rather than counting as fits.
 *
 * **`no-walk` is a `fails` and not an `undecidable`, which is row E3's one
 * judgement here.** `undecidable` means *the rule has no answer for this fill* —
 * no cell, no footprint, no run to compare. A `no-walk` has all three and a
 * definite, measurable answer: the cell is `want` units across and the walls take
 * `got` of them. That is the same kind of statement `over-run` makes, so it is
 * surfaced the same way — as *needs a choice*, with both numbers named.
 */
function verdictOf(layout: TemplateLayout, doubts: readonly SlotDoubt[]): SlotVerdict {
  if (doubts.some((doubt) => doubt.code !== 'over-run' && doubt.code !== 'no-walk')) return 'undecidable'
  if (doubts.length > 0) return 'fails'
  return layout.slots.some((rule) => rule.anchor === 'edge') ? 'closes' : 'undecidable'
}
