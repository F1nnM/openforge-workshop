/**
 * A placed piece's slots, as one import.
 *
 * `slotEditor.ts` is the editor's own model and `SlotEditor` its dialog;
 * `slotAccessories.ts` is the pure derivation of what the file in one filled
 * slot holds, which the dialog renders under that slot with the drawer's own
 * picker from `@/screens/detail/slots` and the guided-assembly walk from
 * `@/screens/assemblies` — rather than restating dead-end greying twice.
 *
 * **There is no sidebar section here any more.** `AccessorySection` listed every
 * placed piece that opened an accessory slot, at the foot of the bill column, and
 * was the app's one surface for choosing an accessory. The owner's ruling moved
 * that choice into this dialog (F7): the file whose socket a torch goes into is
 * the file in a row of the editor's own slot list, so the grid for it belongs
 * under that row and not a column away. The plan-wide inventory the section read
 * went with it; what the dialog needs is one fill's worth of it.
 *
 * **There is no panel here either.** `SlotsPanel` rendered a second list of
 * every piece on the plan, in the same fixed-height column as the bill of
 * tiles — and the bill already expands each file row into
 * the placements behind it. The two things that list alone could do are a `Slots`
 * press on those rows now: it is tab-reachable where the plan's route is only
 * reachable through a `role="application"` canvas, and it reaches a piece that
 * resolved to no parts and is therefore drawn nowhere to select. So the list went
 * and the parts list got its height back; `BillPanel.tsx` carries that argument
 * in full. `planPieces` — the per-instance summary that list's rows were written
 * from, with each piece's filled and pinned counts and the slots still needing a
 * choice — went with it: the dialog needs one instance and one recipe, and both
 * are a map read away.
 *
 * **Which piece's editor is open is the screen's state**, because two surfaces
 * open one dialog — the action bar over the selected piece and a `Slots` press on
 * a bill row — so neither can hold the other's. {@link SlotEditTarget} is the
 * shape they agree on, and it lives with the dialog they both open.
 */
export type { SlotEditTarget, SlotEditorProps } from './SlotEditor'
export { SlotEditor } from './SlotEditor'

export type { FillAccessories } from './slotAccessories'
export { fillAccessories } from './slotAccessories'

export type { DesignBucket, EditorSlot, Invalidation, SlotEditorModel } from './slotEditor'
export {
  choiceOf,
  designBuckets,
  filterByDesign,
  invalidatedBy,
  refusalSentence,
  slotEditorModel,
} from './slotEditor'
