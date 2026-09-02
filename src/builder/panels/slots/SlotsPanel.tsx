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
 * ## What it can honestly do with a pick
 *
 * It adds the chosen file to the **library**, and says so in the panel. That is
 * the whole of the available channel: `WorkshopState` holds a library and
 * placements, the bill is built from placements, and row **G5** owns the
 * selection channel. So a slot fill cannot yet appear as a bill line, and this
 * panel does not pretend otherwise — it states the count of required slots the
 * plan has open, and the library is where the files land. `addToLibrary` is an
 * existing store action; nothing here writes a new field.
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
import type { CatalogFile } from '@/catalog'
import { SlotFills } from '@/screens/detail/slots'
import type { Placement } from '@/store'
import { addToLibrary } from '@/store'
import { Eyebrow } from '@/ui/primitives'

import { planSlots } from './planSlots'

import './slots.css'

export interface SlotsPanelProps {
  readonly catalog: CatalogFile
  /** `WorkshopState.placements`, passed straight through from the screen. */
  readonly placements: Readonly<Record<string, Placement>>
}

export function SlotsPanel({ catalog, placements }: SlotsPanelProps) {
  // One resolution per placed file that declares a slot, and the panel re-renders
  // on every store change — 0.09 ms each is cheap and 50 of them on every
  // library toggle is not, so it is memoised on the placements it read.
  const inventory = useMemo(() => planSlots(catalog, placements), [catalog, placements])

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
            Picking one adds its file to your library. The bill above counts placed tiles, so a
            slot fill is not a line in it.
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
                    // Cleared picks are left in the library: removing a file the
                    // user may have added deliberately, because they changed one
                    // slot, would be the panel undoing a decision it did not make.
                    if (tile !== undefined) addToLibrary(tile)
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
          } a file this index no longer holds, so what it can hold is unknown.`}
        </p>
      )}
    </section>
  )
}
