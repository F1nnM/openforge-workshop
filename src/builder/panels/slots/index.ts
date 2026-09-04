/**
 * The plan's pieces and their slots, as one import.
 *
 * Rows C2 and C3. `planSlots` is the pure accessory inventory over a drawing's
 * placements and `planPieces` is the per-instance summary the slot editor opens
 * from; `slotEditor.ts` is the editor's own model, `SlotEditor` its dialog, and
 * `SlotsPanel` renders both halves — reusing the drawer's picker whole from
 * `@/screens/detail/slots` and the guided-assembly walk from
 * `@/screens/assemblies` rather than restating dead-end greying twice.
 *
 * Mounted by `src/screens/builder/BuilderScreen.tsx` in the bill column, after
 * the bill of tiles — see `slots.css` for why the order matters to that column's
 * grid.
 */
export type { SlotsPanelProps } from './SlotsPanel'
export { SlotsPanel } from './SlotsPanel'

export type { SlotEditorProps } from './SlotEditor'
export { SlotEditor } from './SlotEditor'

export type { PlanPiece, PlanSlotHolder, PlanSlotInventory } from './planSlots'
export { planPieces, planSlots } from './planSlots'

export type { DesignBucket, EditorSlot, Invalidation, SlotEditorModel } from './slotEditor'
export {
  choiceOf,
  designBuckets,
  filterByDesign,
  invalidatedBy,
  refusalSentence,
  slotEditorModel,
} from './slotEditor'
