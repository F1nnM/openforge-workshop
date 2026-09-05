/**
 * The plan's pieces and their slots, as one import.
 *
 * Rows C2, C3 and C8. `planSlots` is the pure accessory inventory over a
 * drawing's placements and `planPieces` is the per-instance summary the slot
 * editor opens from; `slotEditor.ts` is the editor's own model, `SlotEditor` its
 * dialog, and `SlotsPanel` renders both halves — reusing the drawer's picker whole from
 * `@/screens/detail/slots` and the guided-assembly walk from
 * `@/screens/assemblies` rather than restating dead-end greying twice.
 *
 * Mounted by `src/screens/builder/BuilderScreen.tsx` in the bill column, after
 * the bill of tiles — see `slots.css` for why the order matters to that column's
 * grid.
 *
 * **Which piece's editor is open is the screen's state and not this panel's**,
 * since row C8 put the owner's right click on the 3D drawing as well: two
 * surfaces open one dialog, so neither can hold the other's state.
 * {@link SlotEditTarget} is the shape they agree on.
 */
export type { SlotEditTarget, SlotsPanelProps } from './SlotsPanel'
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
