/**
 * The room-wide design picker: no design, or one of the designs this archive
 * can actually build a room out of.
 *
 * ## Two things it must not do
 *
 * **Offer a design that changes nothing.** 8 of the 36 reachable `texture`
 * roots reach no part of any placeable template, so choosing one would fill
 * every slot exactly as before — a control that appears to work and does not.
 * `reach.ts` drops them, and this component never re-adds a name it was not
 * given.
 *
 * **Present the offers as equivalent.** They are not: `dungeon_stone` reaches
 * 120 of 139 parts and `catacombs` reaches 1. That is `LockPicker`'s own lesson
 * — *"the one thing this component must not do: present three equivalent-looking
 * options"* — and it is sharper here, because the spread is 120 to 1 rather
 * than 88.3 to 78.7. So every row carries its reach as a number **and** as a
 * bar on one shared track, and the rows are in reach order.
 *
 * ## One bar, where the lock picker has two
 *
 * The lock picker stacks buildability over reachability because the two figures
 * cross and the crossing is the story. There is one figure here and inventing a
 * second encoding for it would be decoration. What rides beside the bar instead
 * is the **item count**, which answers a different question — `shingles` reaches
 * 2 parts out of 82 items, `tudor` reaches none out of 5 — and is printed as a
 * number rather than drawn, because it is not on the same scale as the reach.
 *
 * ## `undefined` is an option, not the absence of one
 *
 * *No design* is the shipped default and the state a user comes back to, so it
 * is the **first radio** and not a clear button beside the list. A clear button
 * would make the default unreachable by the arrow keys that move through every
 * other choice, and would make "no design" look like an undo rather than like a
 * decision — which it is: `store/schema.ts#defaultWorkshopState` sets out why
 * the app ships with no design rather than with the largest family.
 *
 * ## Native radios in a `<fieldset>`
 *
 * `LockPicker`'s reasoning, unchanged and stronger at this length: the grouping,
 * the roving arrow keys and the single tab stop come free, and 29 options make
 * the single tab stop matter far more than it does at 3. `@/ui/primitives`'
 * `ToggleGroup` is a segmented control and could not hold 29 rows with a figure
 * on each.
 *
 * Each radio carries an explicit `aria-label` so a row announces as one sentence
 * rather than as a name, a bar and two numbers in sequence.
 */
import type { CSSProperties } from 'react'

import type { DesignReach, DesignReachEntry } from './reach'
import { countLabel, shareLabel } from './reach'

import './design-picker.css'

export interface DesignPickerProps {
  /** The measured comparison, or `null` while the indexes are unknown. */
  reach: DesignReach | null
  /** The design in effect, or `undefined` for no design. */
  value: string | undefined
  /**
   * Called with the design the user picked — `undefined` for *no design*, and
   * **including the value already in effect**.
   *
   * `LockPicker`'s reason: a controlled radio fires no `change` event when it is
   * already checked, and a user who opened the picker to compare and concluded
   * the current answer is right has still made a decision. Re-picking the
   * current design is a no-op write the store collapses, so the cost of
   * reporting it is nothing and the cost of swallowing it is a dead press.
   */
  onChange: (design: string | undefined) => void
  /**
   * `name` for the radio group.
   *
   * Overridable for `LockPicker`'s reason: two pickers on one document sharing a
   * name behave as one group and the second steals the first's selection.
   */
  name?: string
}

/** The accessible name of one row: what it is, and what it would reach. */
function announce(entry: DesignReachEntry, total: number): string {
  return (
    `${entry.label}. Reaches ${countLabel(entry.parts)} of ${countLabel(total)} parts ` +
    `(${shareLabel(entry.share)}), ${countLabel(entry.items)} ${entry.items === 1 ? 'item' : 'items'} in the archive.`
  )
}

function DesignOption({
  entry,
  best,
  total,
  selected,
  name,
  onChange,
}: {
  entry: DesignReachEntry
  best: number
  total: number
  selected: boolean
  name: string
  onChange: (design: string) => void
}) {
  const inputId = `${name}-${entry.family}`
  /* Percentages, so the CSS is a plain `width` with no `calc()` — `LockPicker`'s
     pattern and the same cast for a custom property in a `style` object. The
     track is scaled to the **best** design rather than to 139 parts, because at
     139 the tail's bars would all be one pixel and the comparison a reader
     actually makes is against the best available design. `--of-design-share` is
     the honest denominator and is what the number beside the bar prints. */
  const style = {
    '--of-design-bar': `${((best === 0 ? 0 : entry.parts / best) * 100).toFixed(2)}%`,
  } as CSSProperties

  return (
    <label className="of-design-option" data-selected={selected ? '' : undefined} style={style}>
      <input
        type="radio"
        id={inputId}
        name={name}
        className="of-design-radio"
        checked={selected}
        aria-label={announce(entry, total)}
        onChange={() => {
          onChange(entry.family)
        }}
        onClick={() => {
          onChange(entry.family)
        }}
      />
      <span className="of-design-name">{entry.label}</span>
      <span className="of-design-track" aria-hidden="true">
        <span className="of-design-fill" />
      </span>
      <span className="of-design-parts">{countLabel(entry.parts)}</span>
      <span className="of-design-items">{countLabel(entry.items)}</span>
    </label>
  )
}

/**
 * The *no design* row.
 *
 * Its own component rather than a synthetic {@link DesignReachEntry}, because a
 * fake entry would need a `family` and there is no string that means "none" —
 * `''` fails `WorkshopState.design`'s own `min(1)`, and any tag-shaped sentinel
 * is a tag some future rescan could introduce. The option is the absence of a
 * value, so it is the absence of an entry.
 */
function NoDesignOption({
  selected,
  name,
  onChange,
}: {
  selected: boolean
  name: string
  onChange: () => void
}) {
  return (
    <label className="of-design-option" data-none="" data-selected={selected ? '' : undefined}>
      <input
        type="radio"
        id={`${name}-none`}
        name={name}
        className="of-design-radio"
        checked={selected}
        aria-label="No room design. Each part is filled by the catalog's own order, which can mix designs within one piece."
        onChange={onChange}
        onClick={onChange}
      />
      <span className="of-design-name">No room design</span>
      <span className="of-design-none-note">parts are filled in catalog order, and can mix</span>
    </label>
  )
}

export function DesignPicker({ reach, value, onChange, name = 'of-room-design' }: DesignPickerProps) {
  const entries = reach?.entries ?? []
  const best = entries[0]?.parts ?? 0

  return (
    <div className="of-design-picker">
      <fieldset className="of-design-options">
        {/* The group's own name. A `<legend>` rather than a heading, because the
            `<fieldset>` is what the radios belong to and a screen reader reads a
            legend as the group's label rather than as a document landmark. */}
        <legend className="of-design-legend">Room design</legend>

        <NoDesignOption
          selected={value === undefined}
          name={name}
          onChange={() => {
            onChange(undefined)
          }}
        />

        {entries.length === 0 ? (
          /* Not a hidden state: the indexes have not been built yet, or the
             catalog could not be read. The *choice* still works — `no design` is
             above and it needs no catalog — and saying so is better than an
             empty box. `LockPicker` renders its own `build === null` the same
             way and for the same reason. */
          <p className="of-design-empty">
            The designs this build can offer come from the catalog, which has not been read yet.
          </p>
        ) : (
          entries.map((entry) => (
            <DesignOption
              key={entry.family}
              entry={entry}
              best={best}
              total={reach?.totalParts ?? 0}
              selected={value === entry.family}
              name={name}
              onChange={onChange}
            />
          ))
        )}
      </fieldset>

      {reach === null ? null : <ReachFooter reach={reach} />}
    </div>
  )
}

/**
 * What the two columns are, and the two things the reach figure does not cover.
 *
 * Once, in the footer, rather than per row — `LockPicker`'s rule for a fact that
 * is true of every option, and the alternative here is 29 copies of it.
 *
 * The base sentence is the one this row was asked to state plainly rather than
 * bury: a base slot almost never has a design to prefer, so a room design does
 * not reach it and row A3's ladder keeps deciding it. Written from
 * `basesInDesign` rather than as a claim about `plain`, so a rescan that gave
 * the archive textured bases changes the sentence instead of leaving it wrong.
 */
function ReachFooter({ reach }: { reach: DesignReach }) {
  return (
    <div className="of-design-facts">
      <p className="of-design-fact">
        <strong>Parts</strong> is how many of the{' '}
        <span className="of-design-mono">{countLabel(reach.totalParts)}</span> parts this build can place have
        anything in that design to offer, and <strong>items</strong> is how many designs the whole archive holds.
        A design is a <em>preference</em> and never a filter: a part with nothing in your design is still filled,
        from the same catalog order it would have used anyway.
      </p>
      <p className="of-design-fact">
        {reach.basesInDesign === 0 ? (
          <>
            <strong>Bases are not in the count.</strong> Not one of the{' '}
            <span className="of-design-mono">{countLabel(reach.baseSlots)}</span> base slots has a candidate in any
            design
          </>
        ) : (
          <>
            <strong>Bases are not in the count.</strong>{' '}
            <span className="of-design-mono">
              {countLabel(reach.basesInDesign)} of {countLabel(reach.baseSlots)}
            </span>{' '}
            base slots have a candidate in any design at all
          </>
        )}
        {' '}— a base is a plain plate under the piece — so a base is chosen by how well it fits the piece above it
        rather than by this setting.
      </p>
      {reach.unreached === 0 ? null : (
        <p className="of-design-fact">
          <span className="of-design-mono">{countLabel(reach.unreached)}</span> more designs exist in the archive and
          are not offered: they reach no part of anything this build can place, so choosing one would change nothing.
        </p>
      )}
    </div>
  )
}
