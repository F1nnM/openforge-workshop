/**
 * What the files on the plan themselves hold — the accessory inventory the bill
 * cannot.
 *
 * A bill counts *placements* and the files they resolve to. An accessory is a
 * slot of a **file**, one level below the recipe's own slots, so nothing in
 * `buildBillOfTiles` counts one and nothing in it can. This section is that one
 * question, and since the sidebar was cut back to the bill it is the only thing
 * in the right-hand column that is not the parts list, the download, or the
 * backup line under it.
 *
 * ## It renders nothing far more often than it renders anything
 *
 * **1,005 of the archive's 8,702 files (11.5%) carry an accessory slot** and no
 * file carries more than **3**. So the common plan opens none — and this section
 * used to answer that with a four-line paragraph quoting the 11.5% at every user
 * who had not placed a torch wall. In a fixed-height column beside a parts list,
 * an explanation of why there is nothing to show costs the parts list four lines
 * on nearly every visit, which is the wrong trade in the one direction that
 * matters. It returns `null` instead. There is also nothing to virtualise when it
 * does render: the worst placed piece opens three slots.
 *
 * ## A pick here is kept, and the room and the parts list read the same hold
 *
 * This section used to say *"previews only"*, and the reason was structural
 * rather than unfinished: `TemplateInstance.fills` was `Record<SlotName,
 * SlotFill>` with `SlotFill` being `{ tile, pinned }` — one level, with no key
 * for a fill of a fill — so a pick written under its bare name would have landed
 * beside the recipe's own slots, where `resolve.ts#readFills` walks
 * `template.parts` and would not bill it while `canvas/catalog.ts#parts` walks
 * every key of `fills` and would draw it.
 *
 * **`SlotFill.holds` is that key, so the argument is gone.** A press here calls
 * `pinHold` on the fill the picker is mounted under and a second press on the
 * same card calls `clearHold`; `resolveInstance` walks the same map to bill the
 * accessory and `canvas/scene.ts` walks it to place one per measured mount. So
 * the builder's invariant — *"the room and the parts list cannot disagree"* —
 * holds here by construction rather than by abstinence: **both surfaces read one
 * hold, and this section is the only thing that writes it.**
 *
 * The picker itself stays headless. `@/screens/detail/slots` must not import
 * `@/store`, so it is handed the selection to display and reports a press; the
 * write is this file's.
 *
 * ## A holder is a filled slot, not a placement
 *
 * Following `planSlots.ts`: a template instance holds up to five files and each
 * declares its own composition slots, so one placed corner can appear in this
 * list two or three times — once per file that opens something.
 */
import { useMemo } from 'react'

import { describeCell } from '@/builder/canvas'
import type { CatalogFile } from '@/catalog'
import type { SlotSelection } from '@/screens/detail/slots'
import { SlotFills } from '@/screens/detail/slots'
import type { TemplateInstance } from '@/store'
import { HoldName, clearHold, pinHold } from '@/store'
import { Eyebrow } from '@/ui/primitives'

import type { PlanSlotHolder, PlanSlotInventory } from './planSlots'
import { holdSelection, planSlots } from './planSlots'

import './slots.css'

export interface AccessorySectionProps {
  readonly catalog: CatalogFile
  /** `WorkshopState.placements`, passed straight through from the screen. */
  readonly placements: Readonly<Record<string, TemplateInstance>>
}

export function AccessorySection({ catalog, placements }: AccessorySectionProps) {
  // One resolution per filled file that declares a slot, and the bill re-renders
  // on every store change — 0.09 ms each is cheap and 50 of them on every store
  // write is not, so it is memoised on the placements it read.
  //
  // No `lock` in the dependency list: `planSlots` takes none, because a fill
  // names an exact file, so which slots are open does not move when the
  // preference does.
  const inventory = useMemo(() => planSlots(catalog, placements), [catalog, placements])

  // One selection per holder, built here rather than inside the map below:
  // `SlotFills` memoises its resolution on the object it is handed, and a fresh
  // literal per render would re-resolve every grid on every store write.
  const selections = useMemo(
    () => new Map(inventory.holders.map((holder) => [holder.id, holdSelection(holder.holds)])),
    [inventory],
  )

  // The empty state is the normal state, so it is nothing at all. See the
  // docblock: 88.5% of files declare no slot, and the orphan line below is the
  // one thing worth saying about a plan that opens none.
  if (inventory.holders.length === 0 && inventory.orphans.length === 0) return null

  return (
    /*
      `aria-label` rather than `aria-labelledby` on the `<h3>`: `Eyebrow` takes
      no `id`, and widening a shared primitive for one landmark's benefit is not
      this section's to do. The heading is still a real `h3`, so this and the
      drawer-side sections carry the same level.
    */
    <section aria-label="Accessory slots" className="of-planslots">
      <Eyebrow as="h3" className="of-planslots-head">
        Accessory slots
      </Eyebrow>

      {inventory.holders.length === 0 ? null : (
        <>
          <p className="of-planslots-note">
            {`${String(inventory.slots)} ${inventory.slots === 1 ? 'slot' : 'slots'} on `}
            {`${String(inventory.holders.length)} ${
              inventory.holders.length === 1 ? 'piece' : 'pieces'
            }, ${outstanding(inventory)} `}
            {/* One line, and it now says what a press does rather than what it
                cannot do: the pick is kept on the piece, and the parts list
                charges for it once per mount measured on the host. */}
            A pick here is kept &mdash; pinned to that piece and counted once per measured mount.
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
                    {/* The slot as well as the cell: two holders of one instance
                        sit at the same coordinate, so the cell alone does not
                        tell them apart. */}
                    {holder.slot} · {describeCell(holder.instance.x, holder.instance.z)}
                  </span>
                </p>

                <MountLine holder={holder} />

                <SlotFills
                  catalog={catalog}
                  onPick={(hold, tile) => {
                    const name = HoldName.parse(hold)
                    // The picker's own toggle: `undefined` is a second press on
                    // the card already in the slot, which is *take it out*.
                    if (tile === undefined) clearHold(holder.placement, holder.slot, name)
                    else pinHold(holder.placement, holder.slot, name, tile)
                  }}
                  parent={holder.parent}
                  selection={selections.get(holder.id) ?? NOTHING_HELD}
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

/* --------------------------------------------------------------- the summary */

/**
 * What of the plan's accessory slots is still outstanding.
 *
 * **The count that moves, rather than the count that cannot.** This line used to
 * end *"K of them required"*, which is a property of the archive — 1,047 of the
 * corpus's 1,244 declarations omit `optional` — and stayed on screen unchanged
 * after the user had filled every one of them, reporting a finished piece as an
 * outstanding task. What a user of this panel is doing is closing holes, so the
 * number is the holes.
 *
 * Three endings and the third is not pedantry: *all filled* is a claim about
 * every slot, and a plan whose optional sockets are empty by choice has not
 * filled them. Saying so would be wrong about the one state the panel is
 * deliberately relaxed about.
 */
function outstanding(inventory: PlanSlotInventory): string {
  if (inventory.holes > 0) {
    return `${String(inventory.holes)} required and still empty.`
  }
  return inventory.filled === inventory.slots ? 'all filled.' : 'nothing required is still empty.'
}

/* ---------------------------------------------------------------- the mounts */

/**
 * The empty selection, and it exists to narrow `Map.get`.
 *
 * `selections` is built from the same holders this maps over, so the lookup
 * cannot miss — but it returns `SlotSelection | undefined` and a literal `{}` in
 * the fallback would be a new object per render, which is the one thing the memo
 * above exists to avoid.
 */
const NOTHING_HELD: SlotSelection = {}

/**
 * What a holder's slots cost, wherever that is not the obvious one copy.
 *
 * Two facts, and both are about a number the user meets later in the parts list.
 * A host is billed **at least one copy per measured mount** — a wall with four
 * torch sockets is four torches for one press, and a `wide` doorway's single
 * opening is two leaves — so a slot with more than one mount says so before the
 * press rather than after it. And a slot with **no** measured mount is
 * billed once and drawn nowhere, which is the state of the whole archive until
 * `npm run mounts` has walked it and is not something the user can repair.
 *
 * A slot with exactly one mount says nothing: one press, one copy, in the place
 * the drawing puts it, is what a row already reads as.
 */
function MountLine({ holder }: { holder: PlanSlotHolder }) {
  const notes = holder.slots.flatMap((state) => {
    const mounts = holder.mounts[state.name] ?? 0
    if (mounts === 0) return [`${state.name}: no measured mount — counted once, not drawn`]
    return mounts === 1 ? [] : [`${state.name} × ${String(mounts)} mounts`]
  })
  return notes.length === 0 ? null : <p className="of-planslots-mounts">{notes.join(' · ')}</p>
}
