/**
 * The composition layer's public surface.
 *
 * Import from `@/composition`, never from `@/composition/candidates`, so the
 * postings representation can change without touching row C2's slot pickers.
 *
 * **This row is inert until C2.** Nothing here renders, nothing here is wired
 * into a screen, and the emitted artefact is byte-identical with and without it:
 * `measure.ts` carries the measurement behind that decision.
 *
 * Three modules, in dependency order:
 *
 *   - `config.ts` — the port of the catalog frontend's `config-processing.ts`
 *     with all 69 of its tests. This is the row: it decides what `constrain`
 *     *means*, and the plan's instruction was to port that rather than derive it.
 *   - `candidates.ts` — the derived candidate sets, browser-side, 0 emitted bytes.
 *   - `measure.ts` — both readings measured against the live corpus, the priced
 *     alternatives, and the assertions that keep the port narrowing.
 */
export type {
  ConstrainEntry,
  ProcessedTags,
  ResolvedSlot,
  SiblingSelection,
  SlotTags,
} from './config'
export { createDeepLink, nestedSlots, processConfigValues, resolveSlotTags } from './config'

export type { CompositionIndex, SlotCandidates, TagPostings } from './candidates'
export { createCompositionIndex } from './candidates'

export type { CandidateSpread, CompositionReport, UnsatisfiableSlot } from './measure'
export {
  MAX_DEAD_END_RATE,
  MAX_UNSATISFIABLE_SLOTS,
  MIN_NARROWING_RATIO,
  assertComposition,
  measureComposition,
} from './measure'
