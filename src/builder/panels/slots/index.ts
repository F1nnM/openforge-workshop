/**
 * The plan's accessory slots, as one import.
 *
 * Row C2's builder half. `planSlots` is the pure inventory over a drawing's
 * placements; `SlotsPanel` renders it and reuses the drawer's picker whole from
 * `@/screens/detail/slots` rather than restating dead-end greying.
 *
 * Mounted by `src/screens/builder/BuilderScreen.tsx` in the bill column, after
 * the bill of tiles — see `slots.css` for why the order matters to that column's
 * grid.
 */
export type { SlotsPanelProps } from './SlotsPanel'
export { SlotsPanel } from './SlotsPanel'

export type { PlanSlotHolder, PlanSlotInventory } from './planSlots'
export { planSlots } from './planSlots'
