/**
 * The composition layer's public surface.
 *
 * Import from `@/composition`, never from `@/composition/candidates`, so the
 * postings representation can change without touching row C2's slot pickers.
 *
 * **No longer inert — C2 and X2 landed.** Two screens read this module now, both
 * through one entry point:
 *
 *   - `screens/detail/slots/slotPicker.ts` calls `createCompositionIndex`, and
 *     `SlotFills` renders what it returns. That reaches the user twice:
 *     `screens/detail/VariantsTable.tsx` inside the tile drawer, and
 *     `builder/panels/slots/SlotEditor.tsx` in the builder's slot editor, under
 *     the recipe slot whose file opens the accessory slot.
 *   - `tools/hygiene/project.test.ts` calls `measureComposition` and
 *     `assertComposition`, because `pipeline/build.ts` deliberately does not
 *     import from here and the corpus checks have to run somewhere.
 *
 * The drawer half of that only became reachable in row X2: until `CatalogScreen`
 * actually mounted `TileDrawer`, the whole `screens/detail` subtree — slot fills
 * included — was tree-shaken out of `dist/` and this module shipped no bytes at
 * all.
 *
 * **What is still true is the emitted-artefact claim, and it is a different
 * claim.** Nothing in `pipeline/` imports anything here, so the built
 * `catalog.json` is byte-identical with and without this directory; the candidate
 * sets are derived in the browser from tags the artefact already carries.
 * `measure.ts` carries that measurement, and `corpus.test.ts` asserts it.
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
