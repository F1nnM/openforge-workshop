/**
 * The composition picker, as one import: `import { SlotFills } from './slots'`.
 *
 * Row C2. Two things live behind this barrel and the split is by *kind*:
 * `slotPicker.ts` is pure and headless — it resolves a file's accessory slots
 * against a selection and works out which candidate items lead to a
 * configuration nothing can finish — and `SlotFills.tsx` is the control that
 * renders it.
 *
 * The pure half is exported too, because the builder's slots panel
 * (`@/builder/panels/slots`) needs the same resolution over a plan's placements
 * and must not reimplement dead-end detection to get it.
 *
 * ## What this row does not own
 *
 *   - **`@/composition`** is C1's, imported and never modified. `constrain`
 *     semantics, the inverted index and the 0-byte argument are all there.
 *   - **The `base` slot** is D1's and A6's. It is *read* here, because it is the
 *     entire dead-end signal in this corpus, and never rendered as a choice.
 *     `slotPicker.ts` has the measurement and the reasoning.
 *   - **Persisting a pick.** There is no channel: `WorkshopState` holds a library
 *     and placements, row G5 owns the selection channel, and the bill of tiles
 *     is built from placements. A pick narrows the remaining slots and, in the
 *     builder, adds the file to the library.
 */
export type { SlotFillsProps } from './SlotFills'
export { SlotFills } from './SlotFills'

export type { SlotOption, SlotSelection, SlotState } from './slotPicker'
export {
  BASE_SLOT,
  MAX_GRID_ITEMS,
  compositionIndexFor,
  deadEndReason,
  emptySlotReason,
  pickerSlots,
  slotChoiceKey,
  slotStates,
} from './slotPicker'
