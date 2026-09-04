/**
 * Slot geometry for the recipe templates, as one import:
 * `import { placeTemplateSlots } from '@/template'`.
 *
 * Row **B2** — **the slot-anchor model**. A template recipe says *what* parts,
 * never *where*. This directory is the *where*, and its central result is
 * negative: **the where cannot be stored as numbers.** Over the 128 parts of the
 * 40 shipped recipes the `base` slot admits 25 distinct footprints, `wall` 14
 * and `floor` 8, and only 28 of 128 parts have candidates that all share one
 * footprint — so a stored `(dx, dz, dy, yaw)` is correct for one fill of a slot
 * and wrong for most of the others. What is authored is a **rule**; the numbers
 * are arithmetic over the fill's own footprint at fill time.
 *
 * Two files, split by whether they hold a number:
 *
 *   - `rules.ts` — the types, and the **three authored conventions**, keyed on
 *     the part-name set. No numbers, and no imports: `pipeline/templates.ts`
 *     reads it across the composite-project boundary, so its import list has to
 *     stay empty.
 *   - `offsets.ts` — the arithmetic, the closure verdict and the doubts. This is
 *     the only place a coordinate is produced.
 *
 * ## What this row deliberately does not do
 *
 *   - **It does not fabricate the mitre.** The rule closes on 1,006 of 1,215
 *     resolved combinations (82.8%), fails on 33 (2.7%) and is undecidable on
 *     176 (14.5%). The 8 corner failures are the `single_piece` recipes, whose
 *     two `size|width|2` walls plus a 0.5 column cannot share two 2-unit edges;
 *     the physical mitre is in no tag and in no measured mesh — 0 of the 266
 *     `shape|corner|left`/`right` records have a measured bounding box. The
 *     plan's §9: *"Do not silently write 1.5."* They surface as
 *     {@link SlotDoubt} `over-run`, which reports the edge and the sum and
 *     invents nothing.
 *   - **It does not touch collision.** `overlap.ts#partsOverlap` already takes
 *     a `readonly PlanPart[]` on both sides, so the SAT layer needs no change
 *     for a multi-part template — verified in `corpus.test.ts` over a real
 *     five-slot corner rather than assumed. What is *not* ready is the
 *     resolution layer above it: `subjectsConflict` gates on a single
 *     `PlanBand`, which a template of a `wall`-band slot and a `rect`-band slot
 *     does not have, and `isCornerJunction` exempts exactly the perpendicular
 *     wall pair that lives *inside* a corner template. Row **A7** owns that.
 *   - **It does not store an elevation.** {@link slotElevationMm} composes
 *     measured mesh heights supplied by its caller, because 18.4% of measured
 *     `openforge` toppers are authored pre-lifted by one base thickness and
 *     77.5% are not.
 *   - **It reads nothing persisted and imports nothing from a sibling row's
 *     directory except `@/builder/canvas`'s footprint primitives.**
 *     {@link SlotName} is a plain `string` alias, so row A1's branded `SlotName`
 *     is assignable to it and this directory imports no store type; and the
 *     elevation comes in as a parameter rather than as an import from row A4b's
 *     `bases.ts`, which row A2 reports may be deleted outright.
 *
 * Nothing in the app reads this directory yet: row **C2** (the fill solver) and
 * row **A4b** (rendering an instance's parts) are its first consumers. The tests
 * are therefore the whole of the row's evidence, which is why `corpus.test.ts`
 * recomputes every figure in these docblocks against the live archive instead of
 * restating it.
 */
export type {
  SlotAnchor,
  SlotConvention,
  SlotName,
  SlotRule,
  SlotSide,
  TemplateLayout,
} from './rules'
export {
  EXTERNAL_CORNER,
  INTERNAL_CORNER,
  SLOT_CONVENTIONS,
  WALL_ON_TILE,
  conventionFor,
  layoutFor,
  partNameKey,
  ruleFor,
} from './rules'

export type { PlacedTemplate, SlotDoubt, SlotDoubtCode, SlotPlacement, SlotVerdict } from './offsets'
export {
  edgeRun,
  placeTemplateSlots,
  quarterTurn,
  slotDoubtSentence,
  slotElevationMm,
  slotOffset,
  slotYaw,
} from './offsets'
