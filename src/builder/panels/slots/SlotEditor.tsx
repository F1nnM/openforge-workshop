/**
 * The slot editor — §3.3, and the control the owner asked for.
 *
 * *"The menu to customize the slots of a template should come up with a right
 * click. It should be filterable by design, and then allow me to choose from all
 * potential matches based on the slot to fill and size and design."*
 *
 * `slotEditor.ts` is the model and carries every measurement. This file is the
 * control, and five decisions in it are worth stating.
 *
 * ## It is a modal dialog and not an anchored popover
 *
 * §3.3 says *"a popover on the placed instance"*. What it has to hold is a slot
 * list, a design filter and a **48-card page** of sprites — the widest shipped
 * part offers 428 items and the p90 (part, family) bucket is 36 — so an anchored
 * popover would either clip that grid or cover the drawing it is anchored to.
 * `Dialog` is taken instead for the reason that decides it: the gesture that
 * opens this is a **right click**, and a right click has no keyboard equivalent
 * that every platform agrees on, so the surface it opens has to be reachable and
 * dismissible without a pointer or it is not reachable at all. Base UI's dialog
 * brings the focus trap, the `Escape` close, the backdrop press and the
 * `aria-labelledby` wiring; an anchored popover would have needed all four
 * rebuilt to be equivalent. `SlotsPanel.tsx` gives every piece a real
 * `<button>` as well, so the whole editor is reachable by `Tab` and `Enter`.
 *
 * ## The design filter is a filter and it is stated in items
 *
 * §1.6's measurement is the argument for having one at all: **394 (part, family)
 * buckets, median 8 items, p90 36, max 160**, against **428 unfiltered** — so
 * 55.8% of buckets fit the 8-card accessory grid and 98.7% fit one 48-card page.
 * Each chip therefore says how many cards it leaves, because that is the number
 * the filter exists to move. `Any design` is first and is the default: a filter
 * that started applied would hide cards the user never asked to hide.
 *
 * ## A pick is `pinFill`, never `fillSlot`, and never every slot
 *
 * Contract **C-k**: *"if C3 writes every fill `pinned`, the lock toggle silently
 * stops working and nothing fails."* So exactly one thing in this row writes
 * `pinned: true` — a press on a card, which is a user choosing a file — and
 * everything else the row does goes through `fillSlot`, which refuses a pinned
 * slot and returns `kept-pinned`. `BuilderScreen`'s lock re-solve is the other
 * side of the same contract.
 *
 * ## The refusal is a refusal
 *
 * A card whose pick would put a **sibling's existing fill** outside its own slot
 * is pressed, refused, and the reason is put on screen — not greyed, because the
 * reason is about a slot the user cannot see from this card, and not repaired,
 * because both repairs are wrong (see `slotEditor.ts#invalidatedBy`). A card
 * whose pick would empty a still-**open** sibling *is* greyed, before it is
 * pressed, by the same walk the guided-assembly screen greys with.
 *
 * ## Every reason rides in an `aria-label`
 *
 * Following A5, C2 and the assemblies screen: a grid of up to 48 buttons, and a
 * screen-reader user moving between them hears the accessible name alone, so the
 * name has to carry the item, the file and what the card costs. `aria-disabled`
 * and never `disabled`, so a greyed card keeps its place in the tab order and
 * its reason stays reachable.
 */
import { useMemo, useState } from 'react'

import type { AssemblyIndex } from '@/assembly'
import type { CatalogFile, TileId } from '@/catalog'
import type { MaterialId } from '@/materials'
import type { AssemblyOption, RecipeIndex, RecipeTemplate } from '@/screens/assemblies'
import {
  STEP_PAGE,
  createRecipeIndex,
  deadEndSentence,
  emptyStepSentence,
  narrowingSentence,
  stepCountSentence,
} from '@/screens/assemblies'
import { compositionIndexFor, tileMaterials } from '@/screens/detail/slots'
import type { TemplateInstance } from '@/store'
import { pinFill } from '@/store'
import type { BaseGap } from '@/assembly'
import { slotDoubtSentence } from '@/template'
import { Button, Chip, Dialog, Eyebrow } from '@/ui/primitives'
import { TileThumb } from '@/ui/thumb'

import type { EditorSlot } from './slotEditor'
import { filterByDesign, invalidatedBy, refusalSentence, slotEditorModel } from './slotEditor'

import './slots.css'

export interface SlotEditorProps {
  readonly catalog: CatalogFile
  readonly index: AssemblyIndex
  /** The instance being edited, read live from the store by the caller. */
  readonly instance: TemplateInstance
  /** The recipe the instance names. The caller holds the table; see `SlotsPanel`. */
  readonly template: RecipeTemplate
  readonly onClose: () => void
}

export function SlotEditor({ catalog, index, instance, template, onClose }: SlotEditorProps) {
  /* The shared indexes, not second copies: `compositionIndexFor` is a `WeakMap`
     on the parsed file, so the drawer's picker, the bill and this editor are
     readers of one 409,432-byte inverted index. */
  const recipes = useMemo<RecipeIndex>(
    () => createRecipeIndex(catalog, compositionIndexFor(catalog)),
    [catalog],
  )
  const materialOf = useMemo(() => tileMaterials(catalog), [catalog])

  // Recomputed on every store write to this instance, because that is the row:
  // a pick narrows its siblings, so a candidate set is correct only until the
  // next press. `assemblyState` measures 4.1 ms median over the 40 recipes.
  const model = useMemo(
    () => slotEditorModel(catalog, index, instance, template, recipes),
    [catalog, index, instance, template, recipes],
  )

  const [openSlot, setOpenSlot] = useState<string | null>(null)
  const [design, setDesign] = useState<string | undefined | null>(null)
  const [refused, setRefused] = useState<string | null>(null)

  // The first slot needing a choice, so the editor opens on the question rather
  // than on the first row — the same rule the guided-assembly screen uses.
  const shown =
    model.slots.find((slot) => slot.name === openSlot) ??
    model.slots.find((slot) => slot.fill === undefined) ??
    model.slots[0]

  return (
    <Dialog
      className="of-sloted"
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={template.name}
      description={
        <Eyebrow tone="accent">
          {`${String(model.slots.length)} ${model.slots.length === 1 ? 'slot' : 'slots'} · x ${String(instance.x)}, z ${String(instance.z)}`}
        </Eyebrow>
      }
      closeLabel="Close the slot editor"
    >
      {model.needsChoice.length === 0 ? null : (
        <p className="of-sloted-gap" role="status">
          {`${String(model.needsChoice.length)} of these ${
            model.needsChoice.length === 1 ? 'slot needs' : 'slots need'
          } a choice: ${model.needsChoice.join(', ')}. `}
          This piece is on the plan and will print incomplete until they are filled.
        </p>
      )}

      {model.doubts.map((doubt) => (
        <p className="of-sloted-gap" key={`${doubt.part}/${doubt.code}`}>
          {slotDoubtSentence(doubt)}
        </p>
      ))}

      <ul className="of-sloted-slots">
        {model.slots.map((slot) => (
          <li key={slot.name}>
            <SlotRow
              chosen={slot.name === shown?.name}
              onOpen={() => {
                setOpenSlot(slot.name)
                setDesign(null)
                setRefused(null)
              }}
              slot={slot}
            />
          </li>
        ))}
      </ul>

      {shown === undefined ? (
        <p className="of-sloted-note">
          This build ships no parts for {template.name}, so there is nothing to fill.
        </p>
      ) : (
        <SlotGrid
          catalog={catalog}
          design={design}
          key={shown.name}
          materialOf={materialOf}
          onDesign={(next) => {
            setDesign(next)
            setRefused(null)
          }}
          onPick={(tile, name) => {
            const invalid = invalidatedBy(recipes, template, instance, shown.name, tile)
            const refusal = refusalSentence(shown.name, name, invalid)
            if (refusal !== undefined) {
              setRefused(refusal)
              return
            }
            setRefused(null)
            // `pinFill` and not `fillSlot`: a press here *is* the user choosing.
            // See the module note on contract C-k.
            pinFill(instance.id, shown.name, tile)
          }}
          refused={refused}
          slot={shown}
        />
      )}
    </Dialog>
  )
}

/* --------------------------------------------------------------- the slot list */

/** One slot: what is in it, and whether it is the one being filled. */
function SlotRow({
  chosen,
  onOpen,
  slot,
}: {
  chosen: boolean
  onOpen: () => void
  slot: EditorSlot
}) {
  const label = slot.fill === undefined ? 'needs a choice' : (slot.fillName ?? slot.fill.tile)
  const empty = slot.fill === undefined

  return (
    <button
      aria-current={chosen ? 'true' : undefined}
      aria-label={`${slot.name} — ${label}${slot.fill?.pinned === true ? ', your choice' : ''}`}
      className="of-sloted-slot"
      data-open={chosen ? '' : undefined}
      onClick={onOpen}
      type="button"
    >
      <span className="of-sloted-slotname">{slot.name}</span>
      <span className="of-sloted-slotfill" data-empty={empty ? '' : undefined}>
        {label}
      </span>
      {/* The `pinned` bit, said out loud. §3.4's seventh cost is *"a plausible
          room nobody chose"*, and the only defence against it is that a surface
          which shows a fill also shows whether anybody chose it. */}
      {slot.fill === undefined ? null : (
        <Chip>{slot.fill.pinned ? 'your choice' : 'auto'}</Chip>
      )}
    </button>
  )
}

/* ---------------------------------------------------------------- one slot's grid */

function SlotGrid({
  catalog,
  design,
  materialOf,
  onDesign,
  onPick,
  refused,
  slot,
}: {
  catalog: CatalogFile
  design: string | undefined | null
  materialOf: (id: TileId) => MaterialId
  onDesign: (family: string | undefined | null) => void
  onPick: (tile: TileId, name: string) => void
  refused: string | null
  slot: EditorSlot
}) {
  const [pages, setPages] = useState(1)
  const cards = filterByDesign(slot.step.options, design)
  const shown = cards.slice(0, pages * STEP_PAGE)
  const dead = cards.filter((option) => option.deadEnd).length

  return (
    /* `role="group"` and not a `<section>`, for C2's reason: a named section is
       a landmark, and a five-slot recipe cycling through this would put regions
       in the dialog's own rotor. */
    <div aria-label={`Fill the ${slot.name} slot`} className="of-sloted-grid" role="group">
      <Eyebrow as="p" className="of-sloted-head">
        {`Fill the ${slot.name} slot`}
      </Eyebrow>

      {/*
        The counts and the narrowing come from `assembly.ts`'s own wording rather
        than from a second phrasing of the same numbers: that module owns the
        *"27 items fit, over 27 files. Narrowed from 88 by what you have already
        chosen."* sentence and the empty-versus-dangling-ref distinction, and two
        surfaces saying it differently about one slot would be two answers.

        The design filter's own count is a **second** sentence for that reason —
        `stepCountSentence` speaks about the whole pool, so folding a filtered
        number into it would make its file count a lie.
      */}
      <p className="of-sloted-note">
        {slot.step.deadEnd ? emptyStepSentence(slot.step) : stepCountSentence(slot.step)}
        {slot.size === undefined ? '' : ` This slot takes ${slot.size}.`}
        {design === null || slot.step.deadEnd
          ? ''
          : ` ${String(cards.length)} of them ${cards.length === 1 ? 'is' : 'are'} in the design you chose.`}
        {dead === 0
          ? ''
          : ` ${String(dead)} of them would leave another slot with nothing to fill it and ${dead === 1 ? 'is' : 'are'} greyed.`}
      </p>

      {slot.step.coveredBy === undefined ? null : (
        <p className="of-sloted-note">
          {`Covered by the ${slot.step.coveredBy} you chose — it stands in for this part, so there is nothing to pick.`}
        </p>
      )}

      {/* Two facts about the pool rather than about any card, which is why they
          are here and not in the bill — see `slotEditor.ts`. */}
      {slot.joineryless === 0 ? null : (
        <p className="of-sloted-note">
          {`${String(slot.joineryless)} of these name no connection system at all, so how ${slot.joineryless === 1 ? 'it joins' : 'they join'} is untagged rather than known.`}
        </p>
      )}
      {slot.baseGaps === 0 ? null : (
        <p className="of-sloted-note">
          {`${String(slot.baseGaps)} of these have no base in the archive to sit on.`}
        </p>
      )}
      {slot.fillGap === undefined ? null : (
        <p className="of-sloted-gap">{baseGapSentence(slot.fillGap)}</p>
      )}

      {slot.designs.length <= 1 ? null : (
        <ul className="of-sloted-designs">
          {[{ family: null, label: 'Any design', items: slot.step.options.length }, ...slot.designs].map(
            (bucket) => (
              <li key={bucket.label}>
                <button
                  aria-pressed={sameDesign(design, bucket.family)}
                  className="of-sloted-design"
                  onClick={() => {
                    onDesign(bucket.family)
                    setPages(1)
                  }}
                  type="button"
                >
                  {bucket.label}
                  <span className="of-sloted-designcount">{String(bucket.items)}</span>
                </button>
              </li>
            ),
          )}
        </ul>
      )}

      {refused === null ? null : (
        <p className="of-sloted-refusal" role="alert">
          {refused}
        </p>
      )}

      {cards.length === 0 ? (
        <p className="of-sloted-note">
          {slot.step.deadEnd
            ? 'That is a gap in the archive, not a step to take.'
            : 'No item in that design fits this slot. Pick another design.'}
        </p>
      ) : (
        <>
          <ul className="of-sloted-cards">
            {shown.map((option) => (
              <li key={String(option.address)}>
                <OptionCard
                  catalog={catalog}
                  chosen={option.variant.id === slot.step.chosen}
                  material={materialOf(option.variant.id)}
                  onPick={() => {
                    onPick(option.variant.id, option.aggregate.name)
                  }}
                  option={option}
                />
              </li>
            ))}
          </ul>
          {shown.length < cards.length ? (
            <Button
              onClick={() => {
                setPages((value) => value + 1)
              }}
              size="sm"
              tone="secondary"
            >
              {`Show ${String(Math.min(STEP_PAGE, cards.length - shown.length))} more of ${String(cards.length)}`}
            </Button>
          ) : null}
        </>
      )}
    </div>
  )
}

/** Whether a bucket is the one currently filtering. `undefined` is a real value here. */
function sameDesign(design: string | undefined | null, family: string | undefined | null): boolean {
  return design === family
}

/* ------------------------------------------------------------------- one card */

function OptionCard({
  catalog,
  chosen,
  material,
  onPick,
  option,
}: {
  catalog: CatalogFile
  chosen: boolean
  material: MaterialId
  onPick: () => void
  option: AssemblyOption
}) {
  const reason = deadEndSentence(option)
  const narrowing = narrowingSentence(option)

  return (
    <button
      aria-disabled={option.deadEnd ? true : undefined}
      aria-label={cardLabel(option, reason, narrowing)}
      aria-pressed={option.deadEnd ? undefined : chosen}
      className="of-sloted-card"
      data-dead={option.deadEnd ? '' : undefined}
      onClick={() => {
        // Declined rather than prevented: see the module note on `aria-disabled`.
        if (!option.deadEnd) onPick()
      }}
      type="button"
    >
      <TileThumb
        assets={catalog.assets}
        blob={option.variant.blob}
        material={material}
        sheet={catalog.sprite}
        sprite={option.variant.sprite}
        thumb={option.variant.thumb}
      />
      <span className="of-sloted-cardname">{option.aggregate.name}</span>
      {option.deadEnd ? <span className="of-sloted-why">{reason}</span> : null}
      {narrowing === '' ? null : (
        <span className="of-sloted-why" data-tone="narrow">
          {narrowing}
        </span>
      )}
    </button>
  )
}

/** The accessible name of a card: what it is, which file, and what it would do. */
function cardLabel(option: AssemblyOption, reason: string, narrowing: string): string {
  const parts = [option.aggregate.name, option.variant.file]
  if (option.deadEnd) parts.push(`unavailable — ${reason}`)
  else if (narrowing !== '') parts.push(narrowing)
  return parts.join(' — ')
}

/**
 * One of `baseMatch.ts`'s three gaps as a sentence.
 *
 * Three sentences and not one, for the reason `baseGap` gives: the remedies
 * differ, and collapsing them would show 377 identical warnings while hiding
 * which of the three anybody can act on.
 */
function baseGapSentence(gap: BaseGap): string {
  switch (gap) {
    case 'no-matching-base':
      return 'The file in this slot publishes a size code no base in the archive carries, so nothing can be matched under it.'
    case 'no-congruent-base':
      return 'No base in the archive is congruent to the file in this slot — geometry, not an omission.'
    case 'base-unmatchable':
      return 'The file in this slot has neither a size code nor a derivable footprint, so there is nothing to match a base on.'
  }
}
