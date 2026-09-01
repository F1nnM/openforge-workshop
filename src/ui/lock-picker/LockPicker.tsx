/**
 * The lock system picker.
 *
 * ## The one thing this component must not do
 *
 * Present three equivalent-looking options. Choosing magnetic removes about 40%
 * of the catalog and DragonLock about 25%, against openlock's 0.1% — a spread of
 * 40.2 percentage points — and a radio group with three neutral rows would
 * communicate none of that. So every option carries its measured reach as a
 * count *and* a share, in mono because they are measured facts, and the shortfall
 * is drawn: one shared track per option, filled to that system's reach, with the
 * gap up to the best system hatched and a dotted line marking where the best
 * system reaches. At a glance the three bars are full, three-quarters and
 * three-fifths, which is the whole point.
 *
 * The figures come from {@link LockReach}, derived from the emitted index by
 * `reach.ts`. **None of them is a constant here.** See that file's docblock for
 * why that matters more than usual on this screen.
 *
 * ## Why hand-rolled radios rather than `ToggleGroup`
 *
 * `@/ui/primitives`' `ToggleGroup` is a segmented control — a row of small
 * uppercase buttons of equal weight. That is the exact shape this screen must
 * avoid, and it has nowhere to put a bar, a count and a cost. Native
 * `<input type="radio">` inside a `<fieldset>` gives the grouping, the roving
 * arrow-key movement and the single tab stop for free, with no wrapper and no
 * new dependency; the styling is entirely ours.
 *
 * Each radio carries an explicit `aria-label`, so it announces as one sentence
 * ("DragonLock, reaches 2,854 of 3,822 designs, 74.7 percent, 968 out of reach")
 * rather than reading out the bar, the chip and the note in sequence. The note is
 * wired through `aria-describedby`, which is where a screen reader expects
 * supporting prose.
 *
 * ## No figures is a rendered state
 *
 * `reach === null` means the index has not loaded, or failed to. The options
 * still render and still work — the store does not need the catalog to record a
 * preference — and the figures show `…` with a line saying the catalog could not
 * be read. Hiding the picker until the index lands would make a network blip
 * cost the user the setting.
 */
import type { CSSProperties } from 'react'

import type { LockSystem } from '@/store'
import { DEFAULT_LOCK_SYSTEM } from '@/store'
import { Chip, Eyebrow } from '@/ui/primitives'

import type { LockReach, LockReachEntry } from './reach'
import { ALL_LOCK_SYSTEMS, countLabel, lockLabel, lockNote, pointsLabel, shareLabel } from './reach'

import './lock-picker.css'

export interface LockPickerProps {
  /** The measured comparison, or `null` while the index is unknown. */
  reach: LockReach | null
  /** The system currently in effect. */
  value: LockSystem
  /**
   * Called with the system the user picked — **including the one already in
   * effect**.
   *
   * That is not an accident of the DOM, it is the behaviour this screen needs. A
   * user who followed the notice here to compare the three and concluded that
   * the default is right has made a decision, and clicking it must record that.
   * A controlled radio fires no `change` event when it is already checked, so
   * the component listens for the click as well; see `LockOption`.
   */
  onChange: (system: LockSystem) => void
  /**
   * `name` for the radio group.
   *
   * Overridable because two pickers on one document (a page and an open dialog)
   * sharing a name would behave as one group, and the second would steal the
   * first's selection.
   */
  name?: string
}

/**
 * The options, best reach first.
 *
 * Order is the derivation's, not this component's, so a rescan that changed which
 * system reaches furthest would reorder the list rather than leave a stale
 * "recommended" at the top. With no figures there is nothing to sort by, so the
 * declaration order stands.
 */
function optionOrder(reach: LockReach | null): readonly LockSystem[] {
  return reach === null ? ALL_LOCK_SYSTEMS : reach.entries.map((entry) => entry.system)
}

/**
 * The cost line, or `null` when there is none to state.
 *
 * Three cases, and the middle one is the reason this is a function rather than an
 * expression inline:
 *
 *   - **Nothing hidden.** No line. "hides 0" is noise, and a cost line that is
 *     always present stops being read.
 *   - **The best option, which still hides something.** openlock hides five
 *     designs on the real corpus, so the line has to exist — but quoting it as
 *     "0.0 pp behind OpenLOCK" would be gibberish. It states the count and says
 *     it is the smallest of the three, which is the honest reading.
 *   - **Anything else.** Count, and how far behind the best option it is. The
 *     percentage-point figure is what makes two options comparable; the count is
 *     what makes it concrete.
 */
function costLabel(entry: LockReachEntry | undefined, best: LockReachEntry | undefined): string | null {
  if (entry === undefined || entry.hidden === 0) return null
  if (best === undefined || best.system === entry.system) {
    return `hides ${countLabel(entry.hidden)} · the fewest of the three`
  }
  return `hides ${countLabel(entry.hidden)} · ${pointsLabel((best.share - entry.share) * 100)} behind ${lockLabel(best.system)}`
}

/** A one-sentence accessible name, so the row does not announce as a word salad. */
function announce(system: LockSystem, entry: LockReachEntry | undefined, total: number): string {
  const name = lockLabel(system)
  if (entry === undefined) return `${name}. Reachable designs unknown — the catalog could not be read.`
  const reach = `reaches ${countLabel(entry.designs)} of ${countLabel(total)} designs, ${shareLabel(entry.share)}`
  const cost = entry.hidden === 0 ? 'nothing out of reach' : `${countLabel(entry.hidden)} designs out of reach`
  return `${name}, ${reach}, ${cost}.`
}

interface LockOptionProps {
  system: LockSystem
  entry: LockReachEntry | undefined
  /**
   * The furthest-reaching option, which is the dotted reference line's position
   * and the baseline every cost is quoted against.
   *
   * Read from the derivation rather than assumed to be
   * {@link DEFAULT_LOCK_SYSTEM}: the default is openlock *because* it reaches
   * furthest today, and if a rescan ever changed that, the copy would otherwise
   * be quoting a shortfall against the wrong system.
   */
  best: LockReachEntry | undefined
  total: number
  selected: boolean
  name: string
  onChange: (system: LockSystem) => void
}

function LockOption({ system, entry, best, total, selected, name, onChange }: LockOptionProps) {
  const inputId = `${name}-${system}`
  const noteId = `${inputId}-note`
  const share = entry?.share ?? 0
  const bestShare = best?.share ?? 0
  const cost = costLabel(entry, best)

  // Percentages rather than raw ratios, so the CSS is a plain `width` with no
  // `calc()` and no unit juggling. The cast is the standard one for custom
  // properties in a `style` object; see `TileThumb` for the same pattern.
  const style = {
    '--of-lock-reach': `${(share * 100).toFixed(2)}%`,
    '--of-lock-best': `${(bestShare * 100).toFixed(2)}%`,
  } as CSSProperties

  return (
    <label
      className="of-lock-option"
      data-selected={selected ? '' : undefined}
      data-default={system === DEFAULT_LOCK_SYSTEM ? '' : undefined}
      data-best={best?.system === system ? '' : undefined}
      style={style}
    >
      <input
        id={inputId}
        className="of-lock-radio"
        type="radio"
        name={name}
        value={system}
        checked={selected}
        aria-label={announce(system, entry, total)}
        aria-describedby={noteId}
        onChange={() => {
          onChange(system)
        }}
        // A controlled radio that is already checked fires no `change` event, so
        // without this, clicking the option already in effect would do nothing —
        // and "I compared the three and the default is right" is a real answer
        // that has to be recordable. Only fired for the checked option, so an
        // ordinary pick still goes through `onChange` exactly once.
        onClick={
          selected
            ? () => {
                onChange(system)
              }
            : undefined
        }
      />

      <span className="of-lock-head">
        <span className="of-lock-name">{lockLabel(system)}</span>
        {system === DEFAULT_LOCK_SYSTEM ? <Chip tone="tag">default</Chip> : null}
        <span className="of-lock-share" aria-hidden="true">
          {entry === undefined ? '—' : shareLabel(entry.share)}
        </span>
      </span>

      {/* Decorative: every figure it draws is also in the mono line below and in
          the radio's own accessible name. */}
      <span className="of-lock-track" aria-hidden="true">
        <span className="of-lock-fill" />
        <span className="of-lock-gap" />
        <span className="of-lock-mark" />
      </span>

      <span className="of-lock-figures" aria-hidden="true">
        <span className="of-lock-count">
          {entry === undefined ? '… designs' : `${countLabel(entry.designs)} / ${countLabel(total)} designs`}
        </span>
        {cost === null ? null : <span className="of-lock-cost">{cost}</span>}
      </span>

      <span className="of-lock-note" id={noteId}>
        {lockNote(system)}
      </span>
    </label>
  )
}

/**
 * The three options, with their cost.
 *
 * Renders a `<fieldset>` and no heading: the surface around it owns the heading,
 * because a picker inside a dialog and a picker inside a settings section want
 * different heading levels and a component that picked one would be wrong in the
 * other.
 */
export function LockPicker({ reach, value, onChange, name = 'of-lock-system' }: LockPickerProps) {
  // `entries` is sorted best reach first by the derivation, so this is a read
  // rather than a second sort with its own tie-breaking rules.
  const best = reach?.entries[0]

  return (
    <div className="of-lock-picker">
      <fieldset className="of-lock-options">
        <legend className="of-sr-only">Lock system</legend>
        {optionOrder(reach).map((system) => (
          <LockOption
            key={system}
            system={system}
            entry={reach?.entries.find((entry) => entry.system === system)}
            best={best}
            total={reach?.totalDesigns ?? 0}
            selected={system === value}
            name={name}
            onChange={onChange}
          />
        ))}
      </fieldset>

      <p className="of-lock-spread">
        {reach === null ? (
          <span className="of-lock-spread-unknown">
            The catalog index could not be read, so the reachable-design counts are unavailable. The choice below still
            applies to your builds.
          </span>
        ) : (
          <>
            <Eyebrow>spread</Eyebrow>{' '}
            <span className="of-lock-spread-value">{pointsLabel(reach.spreadPoints)}</span>{' '}
            <span className="of-lock-spread-note">
              between the best and worst option, measured over {countLabel(reach.totalDesigns)} designs in this catalog.
              The dotted line marks {lockLabel(best?.system ?? DEFAULT_LOCK_SYSTEM)}&rsquo;s reach; the hatched part of
              each bar is what that option cannot print.
            </span>
          </>
        )}
      </p>
    </div>
  )
}
