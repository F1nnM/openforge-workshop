/**
 * Which accessory slots a drawing has left open.
 *
 * The bill of tiles answers *what do I print for the pieces I placed*. It cannot
 * answer *what do those pieces hold*, because a composition slot is not a
 * placement: `buildBillOfTiles` walks `Object.values(placements)` and a torch in
 * a wall's `torch` slot was never placed on the grid. So this module is the
 * plan-side view of row C2's resolution, and it is a **pure function of the
 * placements and the index** — no store writes, no assembly, no routing.
 *
 * ## What the corpus says a plan will actually run into
 *
 * Measured over all 8,702 files:
 *
 *   - **1,005 (11.5%) carry at least one accessory slot.** 2,031 carry only a
 *     `base` slot, which is A6's base match and not an accessory, and 5,666
 *     carry no config at all.
 *   - Accessory slots per file: **1 on 767 files, 2 on 237, 3 on one**. Nothing
 *     in the archive opens a fourth, which is why this panel needs no
 *     virtualisation and no "show more".
 *   - **1,047 of the 1,244 accessory declarations are required** — `optional` is
 *     absent, and absence means required. Only 197 are optional. So an unfilled
 *     accessory slot is usually a *hole in the print*, not a decoration
 *     declined, and {@link PlanSlotInventory.required} is the number this panel
 *     leads with.
 *
 * ## Dead ends reach the plan, and 9 slots cannot be filled at all
 *
 * The same two failures the drawer's picker shows arrive here per placement:
 * **9 of the 1,244 accessory declarations have no candidate whatsoever** in
 * their initial state (5 `fracture slope`, 4 `top`), and a pick can empty a
 * sibling — 416 of 4,330 item picks corpus-wide, every one of them emptying the
 * `base` slot. {@link PlanSlotInventory.unfillable} counts the first; the
 * greying is the picker's and is shared rather than reimplemented, from
 * `@/screens/detail/slots`.
 */
import type { CatalogFile, TileId } from '@/catalog'
import type { SlotState } from '@/screens/detail/slots'
import { compositionIndexFor, slotStates } from '@/screens/detail/slots'
import type { Placement } from '@/store'

/** One placed piece that opens at least one accessory slot. */
export interface PlanSlotHolder {
  /** The placement's key in `WorkshopState.placements`. */
  readonly id: string
  readonly placement: Placement
  /** The placed file. The picker resolves against this and not against its item. */
  readonly parent: TileId
  /** The item's display name, or the raw id for a placement the index has retired. */
  readonly name: string
  /** Its accessory slots, resolved with nothing picked. Never empty. */
  readonly slots: readonly SlotState[]
}

/** What a drawing's compositions add up to. */
export interface PlanSlotInventory {
  /** Placed pieces that open an accessory slot, in plan reading order. */
  readonly holders: readonly PlanSlotHolder[]
  /** Accessory slots the plan opens, across every holder. */
  readonly slots: number
  /**
   * Of those, the ones the fixture does **not** mark optional.
   *
   * The headline: 1,047 of the corpus's 1,244 accessory declarations are
   * required, so this is usually the same as {@link slots} and it is the number
   * that means "this print is incomplete".
   */
  readonly required: number
  /**
   * Slots no file in the archive can fill, before anything is picked.
   *
   * 9 corpus-wide. Counted separately from `required` because it is an archive
   * gap and not a task: nothing the user can do in this panel will close one.
   */
  readonly unfillable: number
  /** Slot names the plan opens, with how many of each. Descending count, then name. */
  readonly byName: readonly { readonly name: string; readonly count: number }[]
  /** Placements the index no longer holds a record for. The bill's orphan case. */
  readonly orphans: readonly string[]
}

/**
 * The plan's open accessory slots.
 *
 * One pass over the placements, and one composition resolution per placed file
 * that declares a slot. The resolution is the expensive-sounding half and is not:
 * a full slot resolution measures **0.09 ms mean, 2.3 ms worst** over the real
 * corpus, and only 11.5% of files reach it at all.
 *
 * Ordered by depth then across — the same plan reading order `billInventory`
 * uses, so a row in this panel and a row in the bill refer to the drawing the
 * same way.
 */
export function planSlots(
  file: CatalogFile,
  placements: Readonly<Record<string, Placement>>,
): PlanSlotInventory {
  const index = compositionIndexFor(file)
  const holders: PlanSlotHolder[] = []
  const orphans: string[] = []
  const names = new Map<string, number>()
  let slots = 0
  let required = 0
  let unfillable = 0

  const ordered = Object.entries(placements).sort(
    ([, a], [, b]) => a.z - b.z || a.x - b.x,
  )

  for (const [id, placement] of ordered) {
    const variant = index.aggregates.byTile.get(placement.tileId)
    if (variant === undefined) {
      orphans.push(id)
      continue
    }
    const states = slotStates(index, placement.tileId)
    if (states.length === 0) continue

    const aggregate = index.aggregates.byDesign.get(variant.design)
    holders.push({
      id,
      placement,
      parent: placement.tileId,
      name: aggregate?.name ?? placement.tileId,
      slots: states,
    })
    for (const state of states) {
      slots += 1
      if (!state.optional) required += 1
      if (state.deadEnd) unfillable += 1
      names.set(state.name, (names.get(state.name) ?? 0) + 1)
    }
  }

  return {
    holders,
    slots,
    required,
    unfillable,
    byName: [...names.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    orphans,
  }
}
