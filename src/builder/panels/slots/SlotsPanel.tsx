/**
 * The plan's pieces and their slots — the surface the right-click editor opens
 * from, and the accessory inventory the bill cannot hold.
 *
 * §2.4 gives the right-hand column to the bill of tiles, and the bill is an
 * inventory of *placements*. This panel is the two halves of that column's
 * remainder: **what each placed recipe has in its slots**, which is row C3's
 * subject, and **what the files in those slots themselves hold**, which is the
 * question one step further in.
 *
 * ## The right click is here, and not on the 3D surface — say why
 *
 * §3.3 asks for *"a popover on the placed instance"*, and the placed instance is
 * drawn by `builder/three/RoomSurface.tsx`. That file is row **A4b**'s and this
 * row does not own it, and the seam it would need is genuinely one line: `onDown`
 * begins `if (event.button !== 0) return`, so a secondary press is not seen at
 * all today, and the 5 px discriminator that separates a click from a camera
 * drag — `surface.ts#isClickGesture`, `DRAG_THRESHOLD_PX` — is inside a module
 * that imports three.js and is exported from `@/builder/three` **type-only**, by
 * a boundary test that exists to keep the renderer out of the entry chunk. So
 * there is no way to reuse the discriminator outside `src/builder/three/**`, and
 * re-declaring five pixels here would be a second copy of the number the owner's
 * reference was felt with.
 *
 * What this row does instead is put the gesture where it can be complete: every
 * piece on the plan is a real `<button>` in this panel, `onContextMenu` opens
 * its editor, and so do `Enter` and `Space` — so the editor is reachable by
 * right click *and* by keyboard, which §3.3's second requirement asks for and
 * which a context menu on a canvas would still have needed a keyboard route
 * for. The report names the `RoomSurface` prop that would add the same gesture
 * on the drawing itself.
 *
 * ## A pick writes a `SlotFill`, and only a template slot can hold one
 *
 * This is where row A0's stub is finally wired, and it is wired for the
 * template's **declared** slots only. The accessory picker below stays a preview,
 * because the destination contract **C-e** assumed does not exist for it:
 *
 *   - `TemplateInstance.fills` is `Record<SlotName, SlotFill>` and a `SlotFill`
 *     is `{ tile, pinned }` — **one level**. An accessory slot is a slot of a
 *     *file*, one level below the template's own, and there is no key for it.
 *   - Writing it under its bare name anyway would put it in `fills` beside the
 *     template's slots, where the two readers disagree: `resolve.ts#readFills`
 *     walks `template.parts`, so the **bill would not count it**, and
 *     `canvas/catalog.ts#parts` walks every key of `fills`, so the **drawing
 *     would draw it**. The builder's own invariant is that *"the room and the
 *     parts list cannot disagree"*; a fill nothing prints is exactly that
 *     disagreement.
 *
 * So the copy states what an accessory pick is — a preview of what the slot will
 * take — rather than accepting a press that persists something no bill can see.
 * Closing it needs `resolve.ts` and `bill.ts` (row A3's) to walk non-declared
 * fills, or a nested fill in A1's schema; both are named in the report.
 *
 * ## A holder is a filled slot, not a placement
 *
 * Row **A8**, following `planSlots.ts`: a template instance holds up to five
 * files and each declares its own composition slots, so one placed corner can
 * appear in the accessory list two or three times — once per file that opens
 * something.
 *
 * ## The corpus decides the layout, again
 *
 * **1,005 of 8,702 files (11.5%) carry an accessory slot** and no file carries
 * more than **3**, so the common plan opens none and the worst placed piece opens
 * three. There is nothing to virtualise, and the empty state is the normal state
 * — which is why it states the 11.5% rather than just saying "nothing here".
 */
import { useMemo, useState } from 'react'

import type { AssemblyIndex } from '@/assembly'
import { describeCell } from '@/builder/canvas'
import type { CatalogFile } from '@/catalog'
import type { RecipeTemplate } from '@/screens/assemblies'
import { SlotFills } from '@/screens/detail/slots'
import type { PlacementId, TemplateId, TemplateInstance } from '@/store'
import { Chip, Eyebrow } from '@/ui/primitives'

import type { PlanPiece } from './planSlots'
import { planPieces, planSlots } from './planSlots'
import { SlotEditor } from './SlotEditor'

import './slots.css'

export interface SlotsPanelProps {
  readonly catalog: CatalogFile
  /**
   * `@/assembly`'s index over the same catalog.
   *
   * A parameter and never built here: `buildAssemblyIndex` is a pure function of
   * the file and the builder screen has already memoised one for the bill, so a
   * second copy would scan 8,702 records to answer the same questions.
   */
  readonly assembly: AssemblyIndex
  /**
   * The family table this build ships — `resolveInstance`'s `TemplateLookup`.
   *
   * The panel cannot hold it: `src/builder/**` must not reach into a screen, and
   * the 40 recipes plus B4's generated families live in
   * `screens/assemblies/templates.ts` because that list renders before the index
   * lands. So the screen that holds the table passes it, exactly as it passes it
   * to `buildBillOfTiles`.
   */
  readonly templates: (id: TemplateId) => RecipeTemplate | undefined
  /** `WorkshopState.placements`, passed straight through from the screen. */
  readonly placements: Readonly<Record<string, TemplateInstance>>
}

export function SlotsPanel({ catalog, assembly, templates, placements }: SlotsPanelProps) {
  const pieces = useMemo(
    () => planPieces(catalog, placements, templates),
    [catalog, placements, templates],
  )
  // One resolution per filled file that declares a slot, and the panel re-renders
  // on every store change — 0.09 ms each is cheap and 50 of them on every store
  // write is not, so it is memoised on the placements it read.
  //
  // No `lock` in the dependency list since row A8, because `planSlots` takes
  // none: a fill names an exact file, so which slots are open does not move when
  // the preference does.
  const inventory = useMemo(() => planSlots(catalog, placements), [catalog, placements])

  /** Which piece's editor is open, by placement key. */
  const [editing, setEditing] = useState<PlacementId | null>(null)
  const open = pieces.find((piece) => piece.placement === editing)

  const unknown = pieces.filter((piece) => piece.template === undefined)
  const gaps = pieces.reduce((total, piece) => total + piece.needsChoice.length, 0)

  return (
    /*
      `aria-label` rather than `aria-labelledby` on an `<h3>`: `Eyebrow` takes no
      `id`, and widening a shared primitive for one landmark's benefit is not
      this row's to do. The headings are still real `h3`s, so the drawer-side and
      panel-side sections carry the same level.
    */
    <section aria-label="Pieces and slots" className="of-planslots">
      <Eyebrow as="h3" className="of-planslots-head">
        Pieces on the plan
      </Eyebrow>

      {pieces.length === 0 ? (
        <p className="of-planslots-note">
          Nothing is placed yet. Every piece on the plan is a recipe with named slots, and each
          one&rsquo;s slots can be changed here or with a right click.
        </p>
      ) : (
        <>
          <p className="of-planslots-note">
            {`${String(pieces.length)} ${pieces.length === 1 ? 'piece' : 'pieces'} placed. `}
            Right-click a piece — or press it — to choose what goes in its slots.
            {gaps === 0 ? '' : ` ${String(gaps)} ${gaps === 1 ? 'slot needs' : 'slots need'} a choice.`}
          </p>

          <ul className="of-planslots-pieces">
            {pieces.map((piece) => (
              <li key={piece.placement}>
                <button
                  aria-label={pieceLabel(piece)}
                  className="of-planslots-piecebtn"
                  data-gap={piece.needsChoice.length === 0 ? undefined : ''}
                  disabled={piece.template === undefined}
                  onClick={() => {
                    setEditing(piece.placement)
                  }}
                  onContextMenu={(event) => {
                    // The gesture §3.3 asks for. `preventDefault` so the
                    // browser's own menu does not cover the editor it opens; the
                    // event is not stopped from propagating, because nothing
                    // above this panel listens for one.
                    event.preventDefault()
                    setEditing(piece.placement)
                  }}
                  type="button"
                >
                  <span className="of-planslots-piecename">{piece.name}</span>
                  <span className="of-planslots-at">
                    {describeCell(piece.instance.x, piece.instance.z)}
                  </span>
                  <span className="of-planslots-pieceslots">
                    {piece.template === undefined
                      ? 'recipe not in this build'
                      : `${String(piece.filled)} of ${String(piece.slots)} slots filled`}
                  </span>
                  {piece.pinned === 0 ? null : <Chip>{`${String(piece.pinned)} chosen`}</Chip>}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {unknown.length === 0 ? null : (
        <p className="of-planslots-gap">
          {`${String(unknown.length)} ${
            unknown.length === 1 ? 'piece names a recipe' : 'pieces name recipes'
          } this build no longer ships, so ${
            unknown.length === 1 ? 'its' : 'their'
          } slots cannot be listed.`}
        </p>
      )}

      {open === undefined || open.template === undefined ? null : (
        <SlotEditor
          catalog={catalog}
          index={assembly}
          instance={open.instance}
          key={open.placement}
          onClose={() => {
            setEditing(null)
          }}
          template={open.template}
        />
      )}

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
            An accessory is a slot of a <em>file</em>, one level below the recipe&rsquo;s own slots,
            and a fill can only name a slot of the recipe — so the picker below shows what each one
            will take rather than keeping a choice the bill could not count.
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
                    {/* The slot as well as the cell, since row A8: two holders of
                        one instance sit at the same coordinate, so the cell alone
                        no longer tells them apart. */}
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

/**
 * A piece's accessible name: what it is, where it is, and what it still needs.
 *
 * One attribute rather than a `VisuallyHidden` span, following A5 and C2 — a
 * screen-reader user moving between the rows of this list hears the name alone,
 * and the thing they need from it is which piece has a hole in it.
 */
function pieceLabel(piece: PlanPiece): string {
  const where = describeCell(piece.instance.x, piece.instance.z)
  if (piece.template === undefined) {
    return `${piece.name} at ${where} — this build ships no such recipe`
  }
  const parts = [
    `${piece.name} at ${where}`,
    `${String(piece.filled)} of ${String(piece.slots)} slots filled`,
  ]
  if (piece.needsChoice.length > 0) parts.push(`needs a choice: ${piece.needsChoice.join(', ')}`)
  return `${parts.join(' — ')}. Customise its slots.`
}
