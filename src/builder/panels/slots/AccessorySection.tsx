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
 * ## A pick here keeps nothing, and the one line says so
 *
 * The picker is `@/screens/detail/slots`' whole, reused rather than restated, and
 * its selection is local to it. That is not a stub left for later — it is what
 * the destination schema admits:
 *
 *   - `TemplateInstance.fills` is `Record<SlotName, SlotFill>` and a `SlotFill`
 *     is `{ tile, pinned }` — **one level**. There is no key for a slot of a
 *     file.
 *   - Writing it under its bare name anyway would put it in `fills` beside the
 *     recipe's own slots, where the two readers disagree: `resolve.ts#readFills`
 *     walks `template.parts`, so the **bill would not count it**, and
 *     `canvas/catalog.ts#parts` walks every key of `fills`, so the **drawing
 *     would draw it**. The builder's own invariant is that *"the room and the
 *     parts list cannot disagree"*; a fill nothing prints is exactly that
 *     disagreement.
 *
 * Closing that needs `resolve.ts` and `bill.ts` to walk non-declared fills, or a
 * nested fill in the store's schema. Until then the copy states what a pick is
 * in one line rather than accepting a press that persists something no bill can
 * see — a picker that silently kept nothing is the one thing worse than saying
 * so.
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
import { SlotFills } from '@/screens/detail/slots'
import type { TemplateInstance } from '@/store'
import { Eyebrow } from '@/ui/primitives'

import { planSlots } from './planSlots'

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
            {`${String(inventory.slots)} ${inventory.slots === 1 ? 'slot' : 'slots'} open on `}
            {`${String(inventory.holders.length)} ${
              inventory.holders.length === 1 ? 'piece' : 'pieces'
            }, ${String(inventory.required)} of them required. `}
            {/* One line, and it is the honest half of the four it replaced: what
                a press here does. The structural reason it cannot persist is in
                this file's docblock, where a reader who wants it will look. */}
            Previews only — a fill can name a recipe&rsquo;s slot, not a file&rsquo;s.
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
                <SlotFills catalog={catalog} parent={holder.parent} />
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
