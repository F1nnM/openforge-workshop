/**
 * The composition picker, as one import: `import { SlotFills } from './slots'`.
 *
 * Row C2. Two things live behind this barrel and the split is by *kind*:
 * `slotPicker.ts` is pure and headless — it resolves a file's accessory slots
 * against a selection and works out which candidate items lead to a
 * configuration nothing can finish — and `SlotFills.tsx` is the control that
 * renders it.
 *
 * The pure half is exported too, because the builder's slot editor
 * (`@/builder/panels/slots`) needs the same resolution over a placed piece's
 * fills and must not reimplement dead-end detection to get it.
 *
 * ## What this row does not own
 *
 *   - **`@/composition`** is C1's, imported and never modified. `constrain`
 *     semantics, the inverted index and the 0-byte argument are all there.
 *   - **The `base` slot** is D1's and A6's. It is *read* here, because it is the
 *     entire dead-end signal in this corpus, and never rendered as a choice.
 *     `slotPicker.ts` has the measurement and the reasoning.
 *   - **Persisting a pick.** Not this row's, and deliberately not reachable from
 *     it: nothing here imports `@/store`, so the picker reports a press and the
 *     surface that has somewhere to put it writes it —
 *     `builder/panels/slots/SlotEditor.tsx` pins the hold onto the placed fill,
 *     under the recipe slot that holds the host file, and hands the current
 *     holds back as the selection to display. In the drawer there is still
 *     nowhere to put a pick, and there it narrows the remaining slots and
 *     nothing else.
 */
export type { SlotFillsProps } from './SlotFills'
export { SlotFills, tileMaterials } from './SlotFills'

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
