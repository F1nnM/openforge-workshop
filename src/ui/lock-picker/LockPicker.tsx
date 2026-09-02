/**
 * The lock system picker.
 *
 * ## The one thing this component must not do
 *
 * Present three equivalent-looking options — or present one number as if it were
 * the whole answer. Both were live failures here.
 *
 * The first draft of the plan put the cost of this choice at 0.1 percentage
 * points and was wrong by two orders of magnitude. This component's first version
 * fixed that by showing **reachability**: 99.9 / 74.7 / 59.7, a 40.2-point
 * spread. That is a true measurement of the archive's tags and it is *not* what a
 * user experiences, because a topper plus an auto-inserted base is a build the
 * app can complete in a system the tile itself never mentions. Measured over the
 * same designs, **buildability** is 88.3 / 81.6 / 78.7 — openlock lower,
 * magnetic 19 points higher, and a spread of 9.6 rather than 40.2.
 *
 * So both figures are here and each row carries two readings:
 *
 *   - a **thick bar and the headline percentage**: buildability, the number that
 *     decides anything, split at the point where a design needs a separate base;
 *   - a **hairline bar under it**: reachability, what the archive's own tags say.
 *
 * The hairline sticks out past OpenLOCK's bar and falls short of Magnetic's, and
 * that crossing is the whole story of the row. It is stated in words once, in the
 * footer, and never three times.
 *
 * The figures come from {@link LockBuild}, derived from the emitted index by
 * `build.ts` and `reach.ts`. **None of them is a constant here.** Those files'
 * docblocks explain why that matters more than usual on this screen — and note
 * that the buildability figures moved twice while this row was being written.
 *
 * ## Three bars, not three chips
 *
 * A per-system chip trio was the obvious alternative for the secondary facts and
 * it cannot be built honestly: **magnetic is never a side connector**, on 0 of
 * 3,822 aggregates, so a symmetrical "joins to neighbours" chip would be
 * permanently dead on one of the three rows. `sideJoinery` is therefore a fact
 * the *screen* states once for all three systems, not a badge each row wears.
 * What every row does carry is `onePart`, which is non-zero for all three and
 * runs the other way from buildability — openlock 1,497 against magnetic's 255.
 *
 * ## Why hand-rolled radios rather than `ToggleGroup`
 *
 * `@/ui/primitives`' `ToggleGroup` is a segmented control — a row of small
 * uppercase buttons of equal weight. That is the exact shape this screen must
 * avoid, and it has nowhere to put two bars, four counts and a cost. Native
 * `<input type="radio">` inside a `<fieldset>` gives the grouping, the roving
 * arrow-key movement and the single tab stop for free, with no wrapper and no
 * new dependency; the styling is entirely ours.
 *
 * Each radio carries an explicit `aria-label`, so it announces as one sentence
 * rather than reading out two bars, a chip and a note in sequence. The note is
 * wired through `aria-describedby`, which is where a screen reader expects
 * supporting prose.
 *
 * ## No figures is a rendered state
 *
 * `build === null` means the index has not loaded, or failed to. The options
 * still render and still work — the store does not need the catalog to record a
 * preference — and the figures show a dash with a line saying the catalog could
 * not be read. Hiding the picker until the index lands would make a network blip
 * cost the user the setting.
 */
import type { CSSProperties } from 'react'

import type { LockSystem } from '@/store'
import { DEFAULT_LOCK_SYSTEM } from '@/store'
import { Chip, Eyebrow } from '@/ui/primitives'

import type { LockBuild, LockBuildEntry } from './build'
import { ALL_LOCK_SYSTEMS, countLabel, lockLabel, lockNote, pointsLabel, shareLabel } from './reach'

import './lock-picker.css'

export interface LockPickerProps {
  /** The measured comparison — both readings — or `null` while the index is unknown. */
  build: LockBuild | null
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
 * The options, most buildable first.
 *
 * Order is the derivation's, not this component's, so a rescan that changed which
 * system builds furthest would reorder the list rather than leave a stale
 * "recommended" at the top. It is ordered on **buildability** and not on
 * reachability because buildability is the headline; the two happen to agree on
 * the current corpus and nothing here assumes they will. With no figures there is
 * nothing to sort by, so the declaration order stands.
 */
function optionOrder(build: LockBuild | null): readonly LockSystem[] {
  return build === null ? ALL_LOCK_SYSTEMS : build.entries.map((entry) => entry.system)
}

/**
 * The cost line, or `null` when there is none to state.
 *
 * Three cases, and the middle one is the reason this is a function rather than an
 * expression inline:
 *
 *   - **Nothing unbuildable.** No line. "0 out of reach" is noise, and a cost
 *     line that is always present stops being read.
 *   - **The best option, which still leaves something out.** openlock cannot
 *     build 447 designs on the real corpus, so the line has to exist — but
 *     quoting it as "0.0 pp behind OpenLOCK" would be gibberish. It states the
 *     count and says it is the smallest of the three, which is the honest
 *     reading.
 *   - **Anything else.** Count, and how far behind the best option it is. The
 *     percentage-point figure is what makes two options comparable; the count is
 *     what makes it concrete.
 */
function costLabel(entry: LockBuildEntry | undefined, best: LockBuildEntry | undefined): string | null {
  if (entry === undefined || entry.unbuildable === 0) return null
  if (best === undefined || best.system === entry.system) {
    return `${countLabel(entry.unbuildable)} out of reach · the fewest of the three`
  }
  return `${countLabel(entry.unbuildable)} out of reach · ${pointsLabel((best.share - entry.share) * 100)} behind ${lockLabel(best.system)}`
}

/**
 * A one-sentence accessible name carrying both readings, so the row does not
 * announce as a word salad of two bars and four counts.
 */
function announce(system: LockSystem, entry: LockBuildEntry | undefined, total: number): string {
  const name = lockLabel(system)
  if (entry === undefined) return `${name}. Figures unknown — the catalog could not be read.`
  const built = `${countLabel(entry.buildable)} of ${countLabel(total)} designs can be built with it, ${shareLabel(entry.share)}`
  const parts =
    entry.onePart === 0
      ? 'every one of them needing a separate base'
      : `${countLabel(entry.onePart)} of those needing no separate base`
  const named = `${countLabel(entry.reach.designs)} designs name it in the archive, ${shareLabel(entry.reach.share)}`
  return `${name}. ${built} — ${parts}. ${named}.`
}

interface LockOptionProps {
  system: LockSystem
  entry: LockBuildEntry | undefined
  /**
   * The most buildable option, which is the dotted reference line's position and
   * the baseline every cost is quoted against.
   *
   * Read from the derivation rather than assumed to be
   * {@link DEFAULT_LOCK_SYSTEM}: the default is openlock *because* it builds
   * furthest today, and if a rescan ever changed that, the copy would otherwise
   * be quoting a shortfall against the wrong system.
   */
  best: LockBuildEntry | undefined
  total: number
  selected: boolean
  name: string
  onChange: (system: LockSystem) => void
}

function LockOption({ system, entry, best, total, selected, name, onChange }: LockOptionProps) {
  const inputId = `${name}-${system}`
  const noteId = `${inputId}-note`
  const cost = costLabel(entry, best)

  // Percentages rather than raw ratios, so the CSS is a plain `width` with no
  // `calc()` and no unit juggling. The cast is the standard one for custom
  // properties in a `style` object; see `TileThumb` for the same pattern.
  const pct = (share: number) => `${(share * 100).toFixed(2)}%`
  const style = {
    '--of-lock-one': pct(entry === undefined || total === 0 ? 0 : entry.onePart / total),
    '--of-lock-build': pct(entry?.share ?? 0),
    '--of-lock-best': pct(best?.share ?? 0),
    '--of-lock-named': pct(entry?.reach.share ?? 0),
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

      {/* Decorative: every figure both bars draw is also in the mono lines below
          and in the radio's own accessible name. */}
      <span className="of-lock-tracks" aria-hidden="true">
        <span className="of-lock-track">
          <span className="of-lock-fill-one" />
          <span className="of-lock-fill-base" />
          <span className="of-lock-gap" />
          <span className="of-lock-mark" />
        </span>
        <span className="of-lock-subtrack">
          <span className="of-lock-named" />
        </span>
      </span>

      <span className="of-lock-figures" aria-hidden="true">
        <span className="of-lock-line">
          <span className="of-lock-key">buildable</span>
          <span className="of-lock-count">
            {entry === undefined ? '—' : `${countLabel(entry.buildable)} of ${countLabel(total)}`}
          </span>
          {entry === undefined ? null : (
            <span className="of-lock-count">{`${countLabel(entry.onePart)} need no base`}</span>
          )}
          {cost === null ? null : <span className="of-lock-cost">{cost}</span>}
        </span>
        <span className="of-lock-line" data-tone="quiet">
          <span className="of-lock-key">in the archive</span>
          <span className="of-lock-count">
            {entry === undefined
              ? '—'
              : `${countLabel(entry.reach.designs)} of ${countLabel(total)} · ${shareLabel(entry.reach.share)}`}
          </span>
        </span>
      </span>

      <span className="of-lock-note" id={noteId}>
        {lockNote(system)}
      </span>
    </label>
  )
}

/**
 * What the two readings are, and why they disagree.
 *
 * The only place on the screen that defines them, and it is deliberately one
 * paragraph rather than a clause repeated on each of the three rows. The
 * comparison that matters is named in words — the cost of the second-best option
 * against what the archive's tags imply — because that difference is the entire
 * argument for aggregating the catalog, and a reader who takes nothing else from
 * this screen should take that.
 */
function Spread({ build }: { build: LockBuild }) {
  // The same pair in both dimensions, which is what makes the comparison
  // apples-to-apples: how far the second-best option is behind the best one on
  // what you can build, against how far behind it looks on tags alone. Reading
  // the tag figure off `reach.entries[0]` instead would silently compare two
  // different systems on the day buildability and reachability stop agreeing
  // about which one leads.
  const best = build.entries[0]
  const second = build.entries[1]

  return (
    <>
      <p className="of-lock-spread">
        <Eyebrow>spread</Eyebrow>{' '}
        <span className="of-lock-spread-value">{pointsLabel(build.spreadPoints)}</span>{' '}
        <span className="of-lock-spread-note">
          between the best and worst option, over {countLabel(build.totalDesigns)} designs — against{' '}
          <span className="of-lock-spread-value">{pointsLabel(build.reach.spreadPoints)}</span> if you go by the
          archive&rsquo;s tags alone.
          {best === undefined || second === undefined ? null : (
            <>
              {' '}
              Choosing {lockLabel(second.system)} costs{' '}
              <span className="of-lock-spread-value">{pointsLabel((best.share - second.share) * 100)}</span> of what you
              can build, not the {pointsLabel((best.reach.share - second.reach.share) * 100)} its tag coverage
              suggests.
            </>
          )}
        </span>
      </p>

      <p className="of-lock-legend">
        <span className="of-lock-legend-line">
          <span className="of-lock-key">buildable</span> a design the app can resolve into a complete printable
          assembly: a tile carrying the lock itself, or a topper plus a base the archive actually has. The solid part of
          each bar is the designs that need no separate base; the hatched part is what that option cannot build, and the
          dotted line marks how far {lockLabel(best?.system ?? DEFAULT_LOCK_SYSTEM)} gets.
        </span>
        <span className="of-lock-legend-line">
          <span className="of-lock-key">in the archive</span> a design whose tags name the lock, or name no lock at all.
          The hairline bar. It is what the archive says rather than what you can print, so it can run past one
          option&rsquo;s bar and fall short of another&rsquo;s — a base printed separately supplies joinery the tile
          itself never mentions.
        </span>
      </p>
    </>
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
export function LockPicker({ build, value, onChange, name = 'of-lock-system' }: LockPickerProps) {
  // `entries` is sorted most buildable first by the derivation, so this is a read
  // rather than a second sort with its own tie-breaking rules.
  const best = build?.entries[0]

  return (
    <div className="of-lock-picker">
      <fieldset className="of-lock-options">
        <legend className="of-sr-only">Lock system</legend>
        {optionOrder(build).map((system) => (
          <LockOption
            key={system}
            system={system}
            entry={build?.entries.find((entry) => entry.system === system)}
            best={best}
            total={build?.totalDesigns ?? 0}
            selected={system === value}
            name={name}
            onChange={onChange}
          />
        ))}
      </fieldset>

      {build === null ? (
        <p className="of-lock-spread">
          <span className="of-lock-spread-unknown">
            The catalog index could not be read, so the buildable-design counts are unavailable. The choice above still
            applies to your builds.
          </span>
        </p>
      ) : (
        <Spread build={build} />
      )}
    </div>
  )
}
