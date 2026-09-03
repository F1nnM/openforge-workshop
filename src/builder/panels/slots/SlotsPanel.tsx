/**
 * The plan's accessory slots — what the placed pieces hold, and what is missing.
 *
 * §2.4 gives the right-hand column to the bill of tiles, and the bill is an
 * inventory of *placements*. A composition slot is not a placement: a torch in a
 * wall's `torch` slot is reached through the wall, never dropped on the grid, so
 * `buildBillOfTiles` neither counts it nor can. This panel is that missing half,
 * and it sits under the bill because it is the same question one step further in
 * — *and what goes in the holes*.
 *
 * ## A pick currently goes nowhere, and that is row C3's
 *
 * It used to save the chosen file's **item** to the library and say so in the
 * panel. That was the whole of the available channel: `WorkshopState` held a
 * library and placements, the bill is built from placements, and row **G5** owns
 * the selection channel — so a slot fill could not appear as a bill line, and the
 * library was where the picks landed.
 *
 * Row **A0** deleted the library, and this pick therefore has **no destination
 * at all** in the meantime. **Row C3 is what gives it one** — the right-click slot
 * editor, where a pick becomes a `SlotFill` on a placed template instance and is
 * the whole point of the templates plan. The `onPick` callback is kept and left
 * inert rather than removed, because C3 rewires exactly this seam; contract
 * dependency **C-e** in `docs/templates-plan.md` §8 records the pair. The panel
 * says so on screen rather than accepting a press that quietly does nothing.
 *
 * The `TileId` to `DesignId` hop went with the write. `SlotFills` resolves a
 * concrete `TileId` — dead-end greying is the whole point of reusing it, and that
 * is a per-file question — and {@link designIndex} carried it to the item that
 * file is one print of. It is kept, because C3 needs the same hop for the same
 * reason and the map is built once per catalog rather than per pick: `TileDrawer`
 * answers the same question with `catalog.records.find(…)`, which is a linear
 * scan over 8,702 records and is fine for one lookup on a drawer open, but this
 * callback fires per pick on a panel that re-renders on every store write.
 *
 * ## Why the whole picker is reused rather than reimplemented
 *
 * Dead-end greying is the row's point and it is the part that would rot if there
 * were two of it. `SlotFills` comes across from `@/screens/detail/slots` whole —
 * the same resolution, the same `aria-disabled` cards, the same reasons — the
 * way `PalettePanel` and `BillPanel` take `TileThumb` from the catalog screen
 * rather than restating the sprite arithmetic. The panel supplies the plan-side
 * framing and nothing else.
 *
 * ## The corpus decides the layout, again
 *
 * **1,005 of 8,702 files (11.5%) carry an accessory slot** and no file carries
 * more than **3**, so the common plan opens none and the worst placed piece opens
 * three. There is nothing to virtualise, and the empty state is the normal state
 * — which is why it states the 11.5% rather than just saying "nothing here".
 */
import { useMemo } from 'react'

import { describeCell } from '@/builder/canvas'
import type { CatalogFile, DesignId, TileId } from '@/catalog'
import { SlotFills } from '@/screens/detail/slots'
import type { LockSystem, Placement } from '@/store'
import { Eyebrow } from '@/ui/primitives'

import { planSlots } from './planSlots'

import './slots.css'

export interface SlotsPanelProps {
  readonly catalog: CatalogFile
  /** `WorkshopState.placements`, passed straight through from the screen. */
  readonly placements: Readonly<Record<string, Placement>>
  /**
   * The build's lock preference, passed through for the same reason
   * `placements` is: this panel is a projection of the store and the screen
   * already holds both.
   *
   * Row V4 needs it because a placement names an item and a slot is a property
   * of a *file* — `config` is one of the fields that differ between an item's
   * variants — so which slots are open is a question the preference helps
   * answer. See `planSlots.ts#PlanSlotHolder.parent`.
   */
  readonly lock?: LockSystem
}

/**
 * Every file's design, in one pass over the index.
 *
 * A plain function rather than a hook so the memo below owns the lifetime, and a
 * `Map` rather than a `find` per call for the reason the module docblock gives.
 */
function designIndex(catalog: CatalogFile): ReadonlyMap<TileId, DesignId> {
  const out = new Map<TileId, DesignId>()
  for (const record of catalog.records) out.set(record.id, record.design)
  return out
}

export function SlotsPanel({ catalog, placements, lock }: SlotsPanelProps) {
  const designOf = useMemo(() => designIndex(catalog), [catalog])
  // One resolution per placed file that declares a slot, and the panel re-renders
  // on every store change — 0.09 ms each is cheap and 50 of them on every store
  // write is not, so it is memoised on the placements it read.
  const inventory = useMemo(() => planSlots(catalog, placements, lock), [catalog, placements, lock])

  return (
    /*
      `aria-label` rather than `aria-labelledby` on an `<h3>`: `Eyebrow` takes no
      `id`, and widening a shared primitive for one landmark's benefit is not
      this row's to do. The heading is still a real `h3`, so the drawer-side and
      panel-side sections carry the same level.
    */
    <section aria-label="Accessory slots" className="of-planslots">
      <Eyebrow as="h3" className="of-planslots-head">
        Accessory slots
      </Eyebrow>

      {inventory.holders.length === 0 ? (
        <p className="of-planslots-note">
          Nothing in this plan holds an accessory. 1,005 of the archive&rsquo;s 8,702 files declare
          a slot — a torch bracket, a door, a portcullis — and none of the pieces placed so far is
          one of them.
        </p>
      ) : (
        <>
          <p className="of-planslots-note">
            {`${String(inventory.slots)} ${inventory.slots === 1 ? 'slot' : 'slots'} open on `}
            {`${String(inventory.holders.length)} ${
              inventory.holders.length === 1 ? 'piece' : 'pieces'
            }, ${String(inventory.required)} of them required. `}
            Choosing a fill is not yet something this build can keep: the bill above counts placed
            tiles, and a slot fill is not one. The picker below shows what each slot will take.
          </p>

          {inventory.unfillable === 0 ? null : (
            <p className="of-planslots-gap">
              {`${String(inventory.unfillable)} of them can be filled by nothing in the archive. `}
              That is a gap in the archive, not a step to take.
            </p>
          )}

          <ul className="of-planslots-list">
            {inventory.holders.map((holder) => (
              <li className="of-planslots-holder" key={holder.id}>
                <p className="of-planslots-piece">
                  {holder.name}
                  <span className="of-planslots-at">
                    {describeCell(holder.placement.x, holder.placement.z)}
                  </span>
                </p>
                <SlotFills
                  catalog={catalog}
                  onPick={(_slot, tile) => {
                    // **Row C3's seam, deliberately inert.** It wrote the chosen
                    // file's item to the library; row A0 deleted the library, and
                    // C3 replaces the destination rather than the pick — a fill
                    // becomes a `SlotFill` on a placed template instance. The
                    // `TileId` to `DesignId` hop stays because C3 needs it: a
                    // pick is a file and a template slot is filled by one, but
                    // the greying walk and the bill both group by design.
                    if (tile === undefined) return
                    void designOf.get(tile)
                  }}
                  parent={holder.parent}
                />
              </li>
            ))}
          </ul>
        </>
      )}

      {inventory.orphans.length === 0 ? null : (
        <p className="of-planslots-gap">
          {`${String(inventory.orphans.length)} ${
            inventory.orphans.length === 1 ? 'placement names' : 'placements name'
          } an item this index no longer holds, so what it can hold is unknown.`}
        </p>
      )}
    </section>
  )
}
