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
 * cell   →  (0, 0)
 * edge   →  (0, −(cellF.d − part.d) / 2)                       flush to −z, centred across it
 * corner →  (−(cellF.w − part.w) / 2, −(cellF.d − part.d) / 2) flush to −x and −z
 * ```
 *
 * and the result is turned back by `side` quarter-turns. At `side: 0` the
 * `corner` line is `(−(W − 0.5) / 2, −(D − 0.5) / 2)` for every real fill,
 * because `{shape:'column'}` is the only footprint any of the 8 `corner` slots
 * admits and a column is exactly {@link WALL_THICKNESS_UNITS} square —
 * `offsets.test.ts` asserts that equivalence rather than hard-coding the 0.5.
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
import type { Extent, PlanPoint } from '@/builder/canvas'
import { footprintExtent } from '@/builder/canvas'

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
 */
export function slotOffset(rule: SlotRule, cell: Extent, part: Extent): PlanPoint {
  if (rule.anchor === 'cell') return [0, 0]
  const inFrame = quarterTurnExtent(cell, rule.side)
  const dz = -(inFrame.d - part.d) / 2
  const dx = rule.anchor === 'corner' ? -(inFrame.w - part.w) / 2 : 0
  return quarterTurn([dx, dz], rule.side)
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

/** Why one slot cannot be laid out, or does not fit. */
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
 * One slot the rule could not place, or could not fit.
 *
 * `want` and `got` are present only on `over-run`, and they are the **cell
 * edge** and **what the fills sum to** — never the difference and never a
 * corrected run. The 8 single-piece corner mitres report `want: 2, got: 2.5`,
 * which says two 2-unit walls and a 0.5 column cannot share two 2-unit edges,
 * and stops there. The number that would make them fit is not in the corpus and
 * is not invented here.
 */
export interface SlotDoubt {
  readonly part: SlotName
  readonly code: SlotDoubtCode
  /** The cell edge the fills have to sum to, in grid units. `over-run` only. */
  readonly want?: number
  /** What they do sum to, in grid units. `over-run` only. */
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
}

/** A layout resolved against one set of fills. */
export interface PlacedTemplate {
  /** In {@link TemplateLayout.slots} order, minus any slot that earned a doubt. */
  readonly slots: readonly SlotPlacement[]
  /** Empty when the template is fully placed. */
  readonly doubts: readonly SlotDoubt[]
  readonly verdict: SlotVerdict
  /** The cell extent every offset was measured against, when there was one. */
  readonly cell: Extent | undefined
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
 */
export function placeTemplateSlots(
  layout: TemplateLayout,
  feet: ReadonlyMap<SlotName, Footprint>,
): PlacedTemplate {
  const slots: SlotPlacement[] = []
  const doubts: SlotDoubt[] = []

  const cell = cellExtentOf(layout, feet, doubts)
  const taken = cell === undefined ? 0 : cornerSpan(layout, feet)

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
    /* The closure check comes *before* the placement, so a slot the rule cannot
       fit earns a doubt and no coordinate. Placing a `diag` fill from its
       bounding box would anchor it flush along an axis it does not lie on, and
       placing an over-running wall would draw two walls through each other —
       both are pictures of something nobody can build, which is the "plausible
       room nobody chose" failure the plan names as this model's new risk. */
    if (rule.anchor === 'edge') {
      const run = edgeRun(foot)
      if (run === null) {
        doubts.push({ part: rule.part, code: 'no-run' })
        continue
      }
      const span = rule.side % 2 === 0 ? cell.w : cell.d
      if (Math.abs(run + taken - span) > CLOSURE_EPS) {
        doubts.push({ part: rule.part, code: 'over-run', want: span, got: run + taken })
        continue
      }
    }
    slots.push({
      part: rule.part,
      anchor: rule.anchor,
      side: rule.side,
      offset: slotOffset(rule, cell, part),
      yaw: slotYaw(rule),
      restsOn: rule.restsOn,
    })
  }

  return { slots, doubts, verdict: verdictOf(layout, doubts), cell }
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
 * How much of an anchored face a `corner`-anchored sibling takes.
 *
 * {@link WALL_THICKNESS_UNITS} on all 8 real corner slots, because
 * `{shape:'column'}` is the only footprint any of them admits — but read off the
 * fill rather than written as 0.5, so a future corner fill of another size is
 * subtracted correctly instead of silently ignored. A column is square, so which
 * axis is read does not matter and no side needs threading through.
 */
function cornerSpan(layout: TemplateLayout, feet: ReadonlyMap<SlotName, Footprint>): number {
  let total = 0
  for (const rule of layout.slots) {
    if (rule.anchor !== 'corner') continue
    const foot = feet.get(rule.part)
    const extent = foot === undefined ? undefined : footprintExtent(foot)
    total += extent?.w ?? WALL_THICKNESS_UNITS
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
 */
function verdictOf(layout: TemplateLayout, doubts: readonly SlotDoubt[]): SlotVerdict {
  if (doubts.some((doubt) => doubt.code !== 'over-run')) return 'undecidable'
  if (doubts.length > 0) return 'fails'
  return layout.slots.some((rule) => rule.anchor === 'edge') ? 'closes' : 'undecidable'
}
