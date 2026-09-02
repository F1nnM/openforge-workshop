/**
 * The variants table — every way to print the open item, all of them visible.
 *
 * Row A5's requirement is a negative one and it shapes this whole file: **never
 * behind a closed accordion.** There is no `<details>`, no "show 17 more", no
 * collapsed group and no virtualisation here. The largest aggregate in the corpus
 * holds **20** variants and the drawer already scrolls, so the cost of showing
 * all of them is scroll extent the user controls — against the cost of hiding
 * them, which A1 measured: **654** aggregates hold a variant declaring
 * composition slots beside one declaring none, so a collapsed table is a table
 * where picking the wrong print silently drops the item's composition.
 *
 * ## A single-variant item is not a one-row table
 *
 * **2,117 of 3,822 aggregates (55.4%) have exactly one variant**, so the common
 * case is an item with nothing to choose between — and a four-header table with
 * one row under it, in a 442px drawer, reads as a broken table rather than as a
 * settled question. {@link VariantsTable} therefore has two presentations over
 * one set of rows: the table when there is a choice, and a sentence stating the
 * same facts when there is not. Both are always rendered; neither is behind a
 * control.
 *
 * ## Three columns, because the drawer is 442px
 *
 * `Print` carries the part count and the file, `This print` the connection
 * systems and the print options, `Download` the bytes. The file is in the table
 * rather than in a tooltip because it is the row's **identity**: on 171
 * aggregates two variants agree on every fact this table shows, worst case 18, so
 * a table without it would render identical rows. What is rendered is
 * `VariantRow.label`, the shortest path suffix unique within the aggregate —
 * the bare filename on 97.6% of items, because on the other 2.4% two variants
 * share a basename in different folders. `variants.ts` has both measurements.
 *
 * ## The accessible name of a row's button carries the whole row
 *
 * Up to 20 buttons in one table, and a screen-reader user tabbing through them
 * hears the accessible name alone. So each one gets an `aria-label` naming the
 * part count, the file and the size, rather than a `VisuallyHidden` span — which
 * is also how this file stays clear of D6's hazard: `VisuallyHidden` is
 * `position: fixed` with pinned offsets, and a table cell is the last place to
 * find out what that does to a clipped span.
 */
import { useRouter } from '@tanstack/react-router'

import type { TileAggregate, TileVariant } from '@/catalog'
import { showTileInDrawer } from '@/routes'
import type { LockSystem } from '@/store'
import { Chip, Eyebrow } from '@/ui/primitives'

import type { SlotRow, VariantJoin, VariantRow } from './variants'
import { optionNote, slotRows, systemLabel, variantRows } from './variants'

/**
 * How the drawer arrived at the variant it is showing.
 *
 * A4's `canonical` flag is the input: a link to `variants[0]` cannot be told
 * apart from a link to the item, so the build's lock preference may be applied
 * there and must not be applied anywhere else. Which of those happened is a fact
 * the user needs, because under an `openlock` preference the pick differs from
 * `variants[0]` on **1,612 aggregates (42.2%)** — so on four items in ten,
 * "showing" and "the file your link named" are different rows.
 */
export type VariantChoice =
  /** `canonical: false` — the URL named this exact file, and it wins. */
  | { readonly by: 'url' }
  /** `canonical: true` — the link named the item, so the build's lock chose. */
  | {
      readonly by: 'preference'
      readonly lock: LockSystem
      /**
       * `true` when the user actually picked this lock, `false` when it is the
       * store's default.
       *
       * The note must not say "chosen for your OpenLOCK build" to somebody who
       * has never opened the lock picker. `DEFAULT_LOCK_SYSTEM` is `openlock`,
       * so without this flag the drawer would attribute a preference to every
       * first-time visitor — and `TileDrawer` does not pass `bottom` at all in
       * that case, so it would also be describing a rank it did not run.
       */
      readonly chosen: boolean
      /**
       * A1's {@link VariantSelection.optionTie} — two candidates tied on every
       * stated criterion with **different** print options, so `bytes` decided.
       * Disclosed rather than swallowed: A1 is explicit that an undisclosed
       * choice between two different products is the failure to avoid.
       */
      readonly optionTie: boolean
    }

export interface VariantsTableProps {
  readonly aggregate: TileAggregate
  /** The variant the drawer is showing — always one of `aggregate.variants`. */
  readonly shown: TileVariant
  readonly choice: VariantChoice
}

/* ----------------------------------------------------------------- the table */

export function VariantsTable({ aggregate, shown, choice }: VariantsTableProps) {
  const rows = variantRows(aggregate)
  const slots = slotRows(aggregate)
  const only = rows.length === 1 ? rows[0] : undefined

  return (
    <>
      <Eyebrow as="h3" className="of-detail-section">
        {only === undefined ? `How to print this — ${String(rows.length)} files` : 'How to print this'}
      </Eyebrow>

      {only === undefined ? (
        <VariantChoiceNote choice={choice} rows={rows} shown={shown} />
      ) : null}

      {only === undefined ? (
        <table className="of-detail-vartable">
          <caption>
            Every file that prints this item. Sizes are downloads — mesh complexity, not filament:
            the catalog records no print time and no material volume.
          </caption>
          <thead>
            <tr>
              <th scope="col">Print</th>
              <th scope="col">This print</th>
              <th scope="col">Download</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <VariantTableRow key={row.variant.id} row={row} current={row.variant.id === shown.id} />
            ))}
          </tbody>
        </table>
      ) : (
        <OnlyVariant row={only} />
      )}

      {slots.length === 0 ? null : <SlotList aggregate={aggregate} rows={rows} slots={slots} />}
    </>
  )
}

/* ------------------------------------------------------------------- the rows */

function VariantTableRow({ row, current }: { row: VariantRow; current: boolean }) {
  const router = useRouter()
  const verb = current ? 'Showing' : 'Show'
  const label = `${verb} the ${row.partsLabel} print, ${row.label}, ${row.download}`

  return (
    <tr aria-current={current ? 'true' : undefined}>
      <th scope="row">
        <button
          type="button"
          className="of-detail-varpick"
          aria-label={label}
          onClick={() => {
            // Replaces, so browsing every print of an item stays one history
            // entry and one Back press still closes the drawer.
            void showTileInDrawer(router, row.variant)
          }}
        >
          <span className="of-detail-varparts">{row.partsLabel}</span>
          <span className="of-detail-varfile">{row.label}</span>
        </button>
      </th>
      <td>
        <JoinList joins={row.joins} />
        <OptionChips options={row.options} />
      </td>
      <td className="of-detail-varsize">{row.download}</td>
    </tr>
  )
}

/**
 * The 55.4% case: one variant, so there is nothing to choose and no table.
 *
 * States the same four facts the table's row would — part count, what that
 * means, the systems and the download — as prose plus the shared chip and join
 * lists, so the two presentations cannot drift apart in what they claim.
 */
function OnlyVariant({ row }: { row: VariantRow }) {
  return (
    <div className="of-detail-onlyvar">
      <p className="of-detail-onlyvar-head">
        <strong>{row.partsLabel}.</strong> {row.partsNote}
      </p>
      <p className="of-detail-onlyvar-note">
        One file, so there is nothing to choose. {row.download} to download — mesh complexity, not
        filament.
      </p>
      <JoinList joins={row.joins} />
      <OptionChips options={row.options} />
      <code className="of-detail-varfile">{row.label}</code>
    </div>
  )
}

/* ---------------------------------------------------------------- the details */

/** A variant's connection systems, or an explicit statement that it declares none. */
function JoinList({ joins }: { joins: readonly VariantJoin[] }) {
  if (joins.length === 0) {
    return <span className="of-detail-varnone">No connection system declared</span>
  }
  return (
    <span className="of-detail-varjoins">
      {joins.map((join) => (
        <span className="of-detail-varjoin" key={`${join.face}-${join.system}`} data-face={join.face}>
          {join.label} <span className="of-detail-varface">{join.face === 'underside' ? 'underneath' : 'sides'}</span>
        </span>
      ))}
    </span>
  )
}

/** The print options, each with what the corpus means by it. */
function OptionChips({ options }: { options: readonly string[] }) {
  if (options.length === 0) return null
  return (
    <span className="of-detail-varopts">
      {options.map((option) => (
        <Chip tone="tag" key={option}>
          <span title={optionNote(option)}>{option}</span>
        </Chip>
      ))}
    </span>
  )
}

/* ------------------------------------------------------------------ the note */

/**
 * Why the drawer is showing the row it is showing.
 *
 * Rendered only where there is a choice to explain. When the build's preference
 * picked the row, it says so and names the lock — otherwise a user whose link
 * said `?tile=4` and who is looking at the dragonlock file has no way to find out
 * why.
 */
function VariantChoiceNote({
  choice,
  rows,
  shown,
}: {
  choice: VariantChoice
  rows: readonly VariantRow[]
  shown: TileVariant
}) {
  if (choice.by === 'url') {
    return (
      <p className="of-detail-varnote">
        Showing the file this link named. Your build&rsquo;s lock preference was not applied, because
        the link asked for this print and not for the item.
      </p>
    )
  }

  const address = rows[0]
  const moved = address !== undefined && address.variant.id !== shown.id

  return (
    <p className="of-detail-varnote">
      {moved
        ? choice.chosen
          ? `Chosen for your ${systemLabel(choice.lock)} build — the link named the item, not this file.`
          : 'Chosen as the best match for the item, which is what the link named. No lock preference is set.'
        : choice.chosen
          ? `The link named the item, and your ${systemLabel(choice.lock)} preference agrees with the first file.`
          : 'The link named the item, and the first of its files is the one shown.'}
      {choice.optionTie
        ? ' Two files tied on every stated criterion with different print options, so the smaller download broke the tie — a file-size tie-break, and not a judgement about either print.'
        : ''}
    </p>
  )
}

/* ------------------------------------------------------------------ the slots */

/**
 * The accessory slots, and which prints carry them.
 *
 * A1's provenance, rendered as the three questions it was built to answer: *is
 * this slot on every way of printing the item* (`universal`), *which file must I
 * print to get it* (`onlyOn`, by the same label the table's rows carry), and *is
 * it required* (`optional`).
 * The **12** aggregates whose slot union exceeds every single variant's own set
 * are exactly the ones where no row of the table carries every slot, and they
 * read correctly here: each slot names its own prints.
 *
 * The `base` slot is not in this list — `variants.ts` has the measurement and the
 * argument. It is 1,560 of the corpus's 2,112 slots, it restates `needsBase`, and
 * the table's part count discloses it per row.
 */
function SlotList({
  aggregate,
  rows,
  slots,
}: {
  aggregate: TileAggregate
  rows: readonly VariantRow[]
  slots: readonly SlotRow[]
}) {
  return (
    <>
      <Eyebrow as="h3" className="of-detail-section">
        Accessory slots
      </Eyebrow>
      <dl className="of-detail-slots">
        {slots.map((slot) => (
          <div className="of-detail-slot" key={`${String(slot.at)}-${slot.name}`}>
            <dt>
              <code>{slot.name}</code>
              {slot.optional ? <span className="of-detail-slotopt">optional</span> : null}
            </dt>
            <dd>
              {slot.universal ? (
                // A one-file item's slots are universal by definition, and
                // "on every one of the 1 prints" is not a sentence.
                rows.length === 1 ? (
                  'On the only print of this item.'
                ) : (
                  `On every one of the ${String(rows.length)} prints.`
                )
              ) : (
                <>
                  {`Only on ${String(slot.onlyOn.length)} of ${String(rows.length)} prints: `}
                  {slot.onlyOn.map((file, at) => (
                    <span key={file}>
                      {at === 0 ? '' : ', '}
                      <code>{file}</code>
                    </span>
                  ))}
                  {'.'}
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <p className="of-detail-varnote">
        {rows.length === 1
          ? ''
          : aggregate.configVaries
            ? 'This item declares different slots on different prints, so which file you print decides what it can hold. '
            : 'Every print of this item declares the same slots. '}
        Choosing what fills a slot is not built yet.
      </p>
    </>
  )
}
