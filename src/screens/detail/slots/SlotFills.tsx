/**
 * The composition picker — an inline item grid per accessory slot, with the
 * picks that lead nowhere greyed *before* they are made.
 *
 * `slotPicker.ts` carries the corpus measurements and the semantics. This file is
 * the control, and three decisions in it are worth stating.
 *
 * ## The grid is not virtualised, and does not need to be
 *
 * Hazard: a sprite sheet is 2,560×1,024 and decodes to roughly **10.5 MB**, so a
 * grid of fifty candidates would be a 525 MB screen. The plan row budgeted for
 * that regime. It does not exist: measured over all **1,244 accessory slot
 * declarations**, the item grid has a **median of 1 card, a mean of 1.8 and a
 * maximum of 8** — so the worst accessory grid in the archive is **~84 MB** of
 * bitmap and the typical one is one card. `slots.test.ts` asserts the 8 against
 * the real corpus, which is what keeps this a measurement rather than a hope.
 *
 * Two things are still done about it, because 84 MB is not nothing and because
 * **no thumbnail derivative is uploaded yet** (blocker B2): `TileThumb` is used
 * rather than a second copy of the sprite arithmetic, so the day P3 switches it
 * to the 256px thumbnail this grid follows without an edit; and every slot past
 * the first renders its grid only once opened, so a three-slot parent decodes one
 * grid and not three. That last part is why {@link SlotFills} tracks an open
 * slot at all.
 *
 * ## A dead end is `aria-disabled`, never `disabled`
 *
 * A greyed card is the whole point of the row, so the reason it is greyed has to
 * be reachable. `disabled` removes the button from the tab order and takes its
 * accessible name with it, which would leave a screen-reader user with a grid
 * that silently has fewer members. So a dead end stays focusable, carries
 * `aria-disabled="true"`, and its `aria-label` states the consequence — *leaves
 * no base this piece can be printed on* — while the click handler declines.
 *
 * The reason rides in the `aria-label` rather than in a `VisuallyHidden` span,
 * following A5's rule in `VariantsTable.tsx` and for the same reason: D6's
 * `VisuallyHidden` is `position: fixed` with pinned offsets, and a grid cell is
 * the last place to discover what that does to a clipped span.
 *
 * ## The choice is state, and it is deliberately not persisted
 *
 * `@/store`'s docblock is explicit that everything in `WorkshopState` is
 * persisted and that ephemeral UI state belongs in a component. A slot fill is
 * held here, keyed by {@link slotChoiceKey} — the parent **file** plus the slot
 * name, which is unique within a record over all 8,702 of them. There is no
 * channel to persist it through yet: the bill of tiles is built from placements
 * and row G5 owns the selection channel, so what this picker can honestly do
 * with a pick is put the file in the library, which is what the builder's panel
 * does. Here it narrows the remaining slots and nothing else, which is the
 * capability the row is about.
 */
import { useMemo, useState } from 'react'

import type { CatalogFile, CatalogRecord, TileId } from '@/catalog'
import { resolveTags } from '@/catalog'
import type { MaterialId } from '@/materials'
import { DEFAULT_THUMB_MATERIAL, resolveMaterial } from '@/materials'
import { Eyebrow } from '@/ui/primitives'
import { TileThumb } from '@/ui/thumb'

import type { SlotOption, SlotSelection, SlotState } from './slotPicker'
import { compositionIndexFor, deadEndReason, emptySlotReason, slotStates } from './slotPicker'

import './slots.css'

export interface SlotFillsProps {
  /**
   * The parsed index. `assets` and `sprite` come off it for the thumbnails.
   *
   * Typed as possibly absent, and that is defensive rather than optional: the
   * two call sites both have a file and both pass it, and their props types
   * *require* it, so a call site that stops passing one is a compile error. What
   * this admits is the runtime case — a test or a screen transpiled without a
   * type check — where the alternative is a `TypeError` inside
   * `buildAggregateIndex` that takes the whole drawer down with it. A picker
   * that renders nothing is a missing picker; a picker that throws is a missing
   * drawer.
   */
  readonly catalog: CatalogFile | undefined
  /**
   * The parent **file**, not the item.
   *
   * C1's rule: `config` varies within 828 aggregates and the tags a `constrain`
   * entry inherits are this variant's, so resolving against an aggregate would
   * answer for a print the user is not looking at.
   */
  readonly parent: TileId
  /**
   * Told when a slot's fill changes, with `undefined` for "cleared".
   *
   * Optional, and the two consumers use it differently on purpose. The tile
   * drawer passes nothing: a pick there narrows the remaining slots and touches
   * no persisted state, because the drawer already has an explicit "Add to
   * library" for the file it is showing and a second, silent one would be a
   * surprise. The builder's slots panel passes a handler that adds the chosen
   * file to the library, because that panel's whole subject is what else the
   * drawing needs printed — and it says so in its own copy.
   *
   * There is no third option today: `WorkshopState` holds a library and
   * placements, the bill of tiles is built from placements, and row G5 owns the
   * selection channel. A slot fill is not persistable yet.
   */
  readonly onPick?: (slot: string, tile: TileId | undefined) => void
}

/**
 * Every accessory slot of one file, each with its grid.
 *
 * Renders nothing at all when the file declares no accessory slot — 5,666 files
 * declare no config and a further 2,451 declare only a `base` slot, so the
 * common case for this component is to render nothing.
 */
export function SlotFills({ catalog, parent, onPick }: SlotFillsProps) {
  const index = useMemo(() => (catalog === undefined ? undefined : compositionIndexFor(catalog)), [catalog])
  const materialOf = useMemo(() => (catalog === undefined ? null : tileMaterials(catalog)), [catalog])
  const [selection, setSelection] = useState<SlotSelection>({})
  const [open, setOpen] = useState<string | null>(null)

  // Recomputed on every pick, because that is the row: `constrain` reads sibling
  // selections, so a candidate set is correct only until the next click. The
  // whole pass measures 0.09 ms mean and 2.3 ms worst over the real corpus.
  const states = useMemo(
    () => (index === undefined ? [] : slotStates(index, parent, selection)),
    [index, parent, selection],
  )
  // `materialOf` is null exactly when `catalog` is undefined, so this narrows
  // both at once rather than leaving a fallback resolver that cannot be reached.
  if (catalog === undefined || materialOf === null || states.length === 0) return null

  const first = states[0]?.name ?? null
  const shown = open ?? first

  return (
    <div className="of-slotfills">
      {states.map((state) => (
        <SlotFill
          catalog={catalog}
          key={state.key}
          materialOf={materialOf}
          onOpen={() => {
            setOpen(state.name)
          }}
          onPick={(tile) => {
            // A second press on the chosen card clears it, which is what makes
            // an optional slot reachable again without a separate control.
            const next = tile === undefined || selection[state.name] === tile ? undefined : tile
            setSelection((prev) => {
              const merged = { ...prev }
              if (next === undefined) delete merged[state.name]
              else merged[state.name] = next
              return merged
            })
            onPick?.(state.name, next)
          }}
          open={shown === state.name}
          state={state}
        />
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------- material */

/**
 * A candidate's material family, by catalog id.
 *
 * ## Why this picker tints at all, which was a judgement call
 *
 * Row P3 wired five `@/ui/thumb` callers and this is the only one that does not
 * render a tile the user chose — these are *candidates* for an accessory slot,
 * and one could argue the choice is about shape and fit rather than substance.
 * It tints for two reasons that outweigh that:
 *
 *   - **A torch bracket's material is part of the fit.** Composition is the one
 *     place a user is putting two meshes together, and "does this go with the
 *     wall" is exactly the question the tint answers.
 *   - **One mesh must not be two colours.** The same file is a tinted card in
 *     the catalog grid; a grey copy of it here would read as a different tile
 *     rather than as less information.
 *
 * The honest caveat, which this row does **not** fix: `../SpriteRotator.tsx`
 * renders the *parent* tile above this grid and is still untinted blue, because
 * P1 left it out (its geometry is its own and it rotates through all ten frames,
 * so it has no thumbnail source to switch). So the drawer is now internally
 * inconsistent, and the fix is one `url(#of-tint-sprite-…)` in that file plus a
 * material for it. No row owns it.
 *
 * ## Why the map is built here and lazily
 *
 * A {@link TileVariant} carries no tags — it is the aggregate layer's summary
 * of a record — and `resolveMaterial` needs the full de-interned list, because
 * the `texture` shortcut is wrong on 691 of 8,702 records. So this joins back to
 * `catalog.records`. It is **not** `CatalogIndex.materialOf`: this component
 * takes a `CatalogFile`, and the drawer above it has no index.
 *
 * Lazy, because `SlotFills` renders nothing for most files — 5,666 declare no
 * config and 2,451 declare only a `base` slot — and building an 8,702-entry
 * map on every drawer open to then return `null` would be the expensive way to
 * do nothing. The closure builds it on the first lookup and memoises per id.
 */
function tileMaterials(catalog: CatalogFile): (id: TileId) => MaterialId {
  let byId: Map<string, CatalogRecord> | undefined
  const resolved = new Map<string, MaterialId>()

  return (id) => {
    const held = resolved.get(id)
    if (held !== undefined) return held
    byId ??= new Map(catalog.records.map((record) => [record.id as string, record]))
    const record = byId.get(id)
    // Every option's variant comes from this index, so a miss is not reachable
    // today. `unknown` rather than a throw if it ever is: a picker that renders
    // one card as "no claim" is better than a drawer that does not open.
    const material =
      record === undefined
        ? DEFAULT_THUMB_MATERIAL
        : resolveMaterial(resolveTags(catalog, record), record.file).material
    resolved.set(id, material)
    return material
  }
}

/* -------------------------------------------------------------------- one slot */

function SlotFill({
  catalog,
  materialOf,
  onOpen,
  onPick,
  open,
  state,
}: {
  catalog: CatalogFile
  materialOf: (id: TileId) => MaterialId
  onOpen: () => void
  onPick: (tile: TileId | undefined) => void
  open: boolean
  state: SlotState
}) {
  const chosen = state.options.find((option) => option.variant.id === state.chosen)
  const dead = state.options.filter((option) => option.deadEnd).length

  const label = `Fill the ${state.name} slot`

  return (
    /*
      `role="group"` and not a `<section>`: a named `<section>` is a landmark,
      and a three-slot parent would put three regions in the drawer's rotor
      beside the dialog itself. `group` is the role for a set of related
      controls, which is what a slot's grid is — and the label is on the
      container rather than on an `<h4>` because `Eyebrow` models the heading
      levels the design uses (`h2`, `h3`) and widening a shared primitive is not
      this row's to do.
    */
    <div aria-label={label} className="of-slotfill" data-open={open ? '' : undefined} role="group">
      <Eyebrow as="p" className="of-slotfill-head">
        {label}
      </Eyebrow>

      <p className="of-slotfill-note">
        {state.deadEnd ? (
          emptySlotReason(state)
        ) : (
          <>
            {`${String(state.options.length)} ${state.options.length === 1 ? 'item fits' : 'items fit'}, over `}
            {`${String(state.candidates)} ${state.candidates === 1 ? 'file' : 'files'}.`}
            {dead === 0
              ? ''
              : ` ${String(dead)} of them would close another slot on this piece and ${
                  dead === 1 ? 'is' : 'are'
                } greyed.`}
          </>
        )}
        {state.pairedWith.length === 0
          ? ''
          : ` Paired with ${state.pairedWith.join(' and ')} — the fixture marks them one part.`}
      </p>

      {state.deadEnd ? null : open ? (
        <>
          <ul className="of-slotfill-grid">
            {state.options.map((option) => (
              <li key={String(option.address)}>
                <OptionCard
                  catalog={catalog}
                  material={materialOf(option.variant.id)}
                  chosen={option.variant.id === state.chosen}
                  onPick={() => {
                    onPick(option.variant.id)
                  }}
                  option={option}
                />
              </li>
            ))}
          </ul>
          {state.chosen === undefined ? null : (
            <button
              className="of-slotfill-clear"
              onClick={() => {
                onPick(undefined)
              }}
              type="button"
            >
              {state.optional ? 'Leave this slot empty' : 'Clear this slot'}
            </button>
          )}
        </>
      ) : (
        <button className="of-slotfill-open" onClick={onOpen} type="button">
          {chosen === undefined
            ? `Choose — ${String(state.options.length)} to pick from`
            : `Filled with ${chosen.aggregate.name} — change`}
        </button>
      )}
    </div>
  )
}

/* --------------------------------------------------------------------- one card */

/**
 * One item card.
 *
 * The accessible name carries the item, the file it would contribute and — when
 * the card is a dead end — what picking it would close. That is the whole of what
 * a card means, and it is in one attribute for the reason A5 gives: up to eight
 * buttons in a grid, and a screen-reader user moving between them hears the name
 * alone.
 */
function OptionCard({
  catalog,
  material,
  chosen,
  onPick,
  option,
}: {
  catalog: CatalogFile
  material: MaterialId
  chosen: boolean
  onPick: () => void
  option: SlotOption
}) {
  const reason = deadEndReason(option)

  return (
    <button
      aria-disabled={option.deadEnd ? true : undefined}
      aria-label={cardLabel(option, reason)}
      aria-pressed={option.deadEnd ? undefined : chosen}
      className="of-slotfill-card"
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
      <span className="of-slotfill-cardname">{option.aggregate.name}</span>
      {option.deadEnd ? <span className="of-slotfill-why">{reason}</span> : null}
      {option.rescues.length === 0 ? null : (
        <span className="of-slotfill-why" data-tone="open">
          {`Opens the ${option.rescues.join(' and ')} slot.`}
        </span>
      )}
    </button>
  )
}

/** The accessible name of a card: what it is, which file, and what it costs. */
function cardLabel(option: SlotOption, reason: string): string {
  const parts = [option.aggregate.name, option.variant.file]
  if (option.deadEnd) parts.push(`unavailable — ${reason}`)
  else if (option.rescues.length > 0) parts.push(`opens the ${option.rescues.join(' and ')} slot`)
  return parts.join(' — ')
}
