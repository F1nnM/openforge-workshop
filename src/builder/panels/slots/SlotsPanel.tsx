/**
 * The plan's pieces and their slots — the second surface the slot editor opens
 * from, and the accessory inventory the bill cannot hold.
 *
 * §2.4 gives the right-hand column to the bill of tiles, and the bill is an
 * inventory of *placements*. This panel is the two halves of that column's
 * remainder: **what each placed recipe has in its slots**, which is row C3's
 * subject, and **what the files in those slots themselves hold**, which is the
 * question one step further in.
 *
 * ## The editor opens from the drawing **and** from here, and both are load-bearing
 *
 * §3.3 asks for *"a popover on the placed instance"*, and the placed instance is
 * drawn by `builder/three/RoomSurface.tsx`. Row C3 hung that on a **right
 * click**, through a `pointerup` so the 5 px discriminator that separates a
 * click from a camera pan could be reused where it lives.
 *
 * **The selection model replaced that gesture entirely.** The right click was
 * carrying the editor because there was nothing else to carry it: with no
 * persistent selection the only operand available was whatever the pointer
 * resolved to. The editor now opens from the `Slots` button on the action bar
 * floating over the **selected** piece — an operand the user chose — and the
 * secondary button went back to being the camera's. What survives from C8 is the
 * *state* lift, and it survives for exactly the reason C8 gave: two surfaces
 * open one dialog, so neither can hold the other's open state, and
 * `BuilderScreen` holds it.
 *
 * **The panel route stays, and deleting it would still be a regression twice
 * over.** The first reason has changed shape and not gone away: the drawing's
 * route is now keyboard-reachable (`Enter` on the selection), but it is
 * reachable only *through the canvas*, which is a `role="application"` with its
 * own key map — so a user navigating the page by tab still needs a real
 * `<button>` per piece, and every row here is one.
 *
 * The second reason is unchanged and is worth writing down, because it is
 * invisible from the drawing: **a gesture on the plan can only reach what is
 * drawn.** `PlanScene.unfilled` is *"one per instance with no filled slots at
 * all"*, and neither `RoomSurface`'s plates nor its instanced meshes walk it —
 * both walk `scene.pieces` and `scene.generated` — so an instance holding
 * nothing occupies no pixels, cannot be clicked, and therefore cannot be
 * selected. {@link planPieces} walks the **placements map**, so those pieces are
 * rows in this list, and this list is the only way to fill them. Row C5's solve
 * makes that the uncommon case rather than the normal one, not an impossible
 * one.
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
import { useMemo } from 'react'

import type { AssemblyIndex } from '@/assembly'
import { describeCell } from '@/builder/canvas'
import type { CatalogFile } from '@/catalog'
import type { RecipeTemplate } from '@/assembly'
import { SlotFills } from '@/screens/detail/slots'
import type { PlacementId, SlotName, TemplateId, TemplateInstance } from '@/store'
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
  /**
   * Which piece's editor is open, and on which slot — `null` for none.
   *
   * **Lifted out of this component by row C8**, and the lift is what the row
   * needed rather than a tidy-up: the same editor also opens from the action bar
   * over the selected piece, and two components cannot each own the one dialog's
   * open state. `BuilderScreen` holds it because it is the only thing that
   * renders both surfaces.
   */
  readonly editing: SlotEditTarget | null
  /** Open an editor, or close the open one with `null`. */
  readonly onEdit: (target: SlotEditTarget | null) => void
}

/**
 * One open slot editor: whose slots, and which row it opens on.
 *
 * The panel's own type and deliberately not `@/builder/three`'s
 * `SlotEditGesture`, which is the same two fields plus a sentence to announce.
 * `builder/panels/boundary.test.ts` is the line between them and a `import type`
 * across it would be free in bytes and wrong in meaning — the panel would then
 * read as depending on the 3D surface's vocabulary, when in fact the drawing is
 * one of *two* callers and the panel row is the other. `BuilderScreen` converts
 * the surface's two primitives into this on the way past.
 */
export interface SlotEditTarget {
  readonly placement: PlacementId
  /**
   * The slot to open on, or `undefined` to let the editor choose.
   *
   * `undefined` is what the panel row passes, because a row names a piece and
   * not a point — and the editor's own rule is the better answer there: it opens
   * on the first slot still needing a choice. A right click on the drawing has a
   * point, so it names the slot whose part was under it.
   */
  readonly slot?: SlotName | undefined
}

export function SlotsPanel({ catalog, assembly, templates, placements, editing, onEdit }: SlotsPanelProps) {
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

  const open = pieces.find((piece) => piece.placement === editing?.placement)

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
          one&rsquo;s slots can be changed by right-clicking it on the plan or by pressing its row
          here.
        </p>
      ) : (
        <>
          <p className="of-planslots-note">
            {`${String(pieces.length)} ${pieces.length === 1 ? 'piece' : 'pieces'} placed. `}
            Select a piece on the plan and press <strong>Slots</strong> on it, or press a row below
            for all of its slots.
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
                    onEdit({ placement: piece.placement })
                  }}
                  onContextMenu={(event) => {
                    // The gesture §3.3 asks for, on the row. `preventDefault` so
                    // the browser's own menu does not cover the editor it opens;
                    // the event is not stopped from propagating, because nothing
                    // above this panel listens for one.
                    //
                    // No slot named, and that is the row's honest answer rather
                    // than a missing feature: a row is a piece and a piece has
                    // every slot in it. The editor's own rule — open on the
                    // first slot still needing a choice — is a better guess than
                    // any this list could make. The drawing's right click is the
                    // gesture that *has* a point, and row C8 gives it the slot.
                    event.preventDefault()
                    onEdit({ placement: piece.placement })
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
          /*
            The slot in the key as well as the placement, since row C8. The
            editor holds its own *shown row* in state, so a second right click on
            a different part of the **same** piece would otherwise change
            `initialSlot` and change nothing on screen — the state initialised on
            the first open would still be the one deciding. Remounting is the
            right answer rather than a `useEffect` that pushes the prop into
            state: the user pointed somewhere new, which is a new question, and
            the design filter and the refusal notice should start clean too.
          */
          key={`${open.placement}:${editing?.slot ?? ''}`}
          onClose={() => {
            onEdit(null)
          }}
          {...(editing?.slot === undefined ? {} : { initialSlot: editing.slot })}
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
