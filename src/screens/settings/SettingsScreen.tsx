/**
 * `/settings` — where the lock system is chosen, and the only screen whose whole
 * subject is a single preference.
 *
 * ## Why there is a screen at all
 *
 * The lock system is one global choice for the whole app, because you cannot
 * physically mix OpenLOCK, DragonLock and magnetic joinery in one build. That
 * makes it exactly the kind of setting that has nowhere natural to live: it is
 * not a property of a tile, not a property of a placement, and not a facet.
 *
 * The alternative considered was a control in the builder toolbar and no screen.
 * It was rejected because the choice needs about 300 words and two stacked bar
 * charts per option to make honestly — the question has two correct answers that
 * disagree, and a toolbar popover is the wrong place for 300 words. What the
 * builder gets instead is `LockNotice`, which states the consequence in one
 * sentence and links here.
 *
 * ## The two figures, and why both are on this screen
 *
 * **Buildability** is what the app can actually resolve into a printable
 * assembly: measured 88.3 / 81.6 / 78.7 across the three systems. **Reachability**
 * is what the archive's tags say: 99.9 / 74.7 / 59.7. They disagree in magnitude
 * *and* direction — openlock is lower than its tags suggest because buildability
 * refuses to count a design it cannot resolve, magnetic is 19 points higher
 * because an auto-inserted base supplies joinery the tile has none of — and the
 * spread that decides how much this choice costs collapses from 40.2 points to
 * 9.6.
 *
 * Showing only buildability would hide that a magnetic build is almost always two
 * printed parts. Showing only reachability would tell a DragonLock owner they
 * were giving up a quarter of the archive, which is false. `@/ui/lock-picker`
 * carries both; this screen carries the corpus facts that bound them.
 *
 * ## What this screen owes the reader
 *
 * Four things, and each one is a claim the app must not overstate:
 *
 *   1. **The cost of each option, measured.** `@/ui/lock-picker` does that, from
 *      the emitted index, never from a constant.
 *   2. **What changing it later actually does.** It does not delete a scene, and
 *      it is not a filter. It changes which base gets matched to a topper and
 *      which file the download resolves to, and it can leave warnings on
 *      placements that no longer line up. Saying "you can change this any time"
 *      and stopping there would be the dishonest version.
 *   3. **That the preference always discriminates.** Every base in the corpus
 *      carries a lock system and none carries none — derived and rendered below —
 *      so there is no neutral fallback and the choice is never inert.
 *   4. **The floor none of the three clears.** A shared set of designs is beyond
 *      every option, so the three shortfalls are mostly one shortfall. Leaving
 *      that out would make the per-system differences look larger than they are.
 *
 * ## It renders a `<section>`, not a `<main>`
 *
 * `AppFrame` owns the document's one `<main>`. The `<h1>` here is visible.
 */
import { setLockSystem, useLockChosen, useLockSystem, usePlacementCount } from '@/store'
import type { LockBuild } from '@/ui/lock-picker'
import { LockPicker, buildOf, countLabel, lockLabel, useLockBuild } from '@/ui/lock-picker'
import { Eyebrow } from '@/ui/primitives'

import './settings.css'

/**
 * What every base in the catalog commits to.
 *
 * Rendered because it is the fact that makes the preference consequential rather
 * than decorative: **zero** bases carry no lock system, so every auto-inserted
 * base is a base that took a side. Derived, including the zero — if a future
 * import added a lock-agnostic base, this line should say so rather than keep
 * asserting a number that used to be true.
 */
function BaseFacts({ build }: { build: LockBuild }) {
  const reach = build.reach
  if (reach.totalBases === 0) return null

  const byBases = [...reach.entries].sort((a, b) => b.bases - a.bases)

  return (
    <p className="of-set-fact">
      Half the archive delegates its joinery to a separately printed base, and{' '}
      {reach.basesWithoutLock === 0 ? (
        <>
          <strong>every one</strong> of the {countLabel(reach.totalBases)} bases in this catalog carries a lock system
        </>
      ) : (
        <>
          {countLabel(reach.totalBases - reach.basesWithoutLock)} of the {countLabel(reach.totalBases)} bases in this
          catalog carry a lock system, {countLabel(reach.basesWithoutLock)} carry none
        </>
      )}{' '}
      <span className="of-set-mono">
        (
        {byBases.map((entry, index) => (
          <span key={entry.system}>
            {index === 0 ? '' : ' · '}
            {`${lockLabel(entry.system)} ${countLabel(entry.bases)}`}
          </span>
        ))}
        )
      </span>
      . So this preference always changes which base you are told to print — there is no neutral base to fall back on.
    </p>
  )
}

/**
 * Which systems join a tile to its *neighbour*, and the asymmetry that stops
 * this being a chip on each option.
 *
 * **Magnetic is a side connector on 0 of 3,822 designs.** A symmetrical
 * "joins to neighbours" badge on the three picker rows would therefore be
 * permanently dead on one of them, which is the sort of empty cell a reader reads
 * as a bug in the app rather than a fact about the archive. Stated once, in
 * prose, all three systems in one sentence, the zero is information instead: in
 * this corpus magnets hold a tile down onto its base and nothing holds one
 * magnetic tile to the next.
 *
 * The trailing consequence is written for *whichever* systems come back at zero
 * rather than for magnetic by name, because the copy has to survive the day a
 * rescan moves one — and a sentence about magnets would then be printed beside a
 * list that no longer includes them.
 *
 * Derived, including the zero, for the reason {@link BaseFacts} gives. If a
 * rescan ever produced a magnetic side connector this sentence changes shape
 * rather than going quietly stale.
 */
function SideJoineryFact({ build }: { build: LockBuild }) {
  const without = build.entries.filter((entry) => entry.sideJoinery === 0)
  if (without.length === build.entries.length) return null

  return (
    <p className="of-set-fact">
      Some tiles also clip to the tile <em>beside</em> them rather than only down onto a base, and the archive does not
      offer that in every system{' '}
      <span className="of-set-mono">
        (
        {build.entries.map((entry, index) => (
          <span key={entry.system}>
            {index === 0 ? '' : ' · '}
            {`${lockLabel(entry.system)} ${countLabel(entry.sideJoinery)}`}
          </span>
        ))}
        )
      </span>
      .{' '}
      {without.length === 0 ? null : (
        <>
          <strong>
            Not one design carries edge-to-edge joinery in{' '}
            {without.map((entry) => lockLabel(entry.system)).join(' or ')}.
          </strong>{' '}
          A piece in one of those systems clips downward only, so the base underneath it is the sole thing
          holding it in line with the piece next to it.
        </>
      )}
    </p>
  )
}

/**
 * The designs no option reaches — the floor under all three bars.
 *
 * Three reasons, separated because only one of them is anybody's fault and a
 * single lumped number would invite a reader to think the app was hiding a
 * tenth of the archive from them. The inserts are not grid tiles at all; the
 * untagged ones are a fixture-metadata gap; only the toppers with no base are a
 * hole in the archive somebody could fill.
 */
function FloorFact({ build }: { build: LockBuild }) {
  const beyond = build.unbuildable
  if (beyond.total === 0) return null

  return (
    <p className="of-set-fact">
      <span className="of-set-mono">{countLabel(beyond.total)}</span> of{' '}
      <span className="of-set-mono">{countLabel(build.totalDesigns)}</span> designs cannot be completed under{' '}
      <em>any</em> of the three, so most of what each option is missing is the same set rather than a penalty for the
      choice: <span className="of-set-mono">{countLabel(beyond.inserts)}</span> are inserts fitted into another piece
      and never placed on the grid, <span className="of-set-mono">{countLabel(beyond.untagged)}</span> carry no joinery
      tag at all, and <span className="of-set-mono">{countLabel(beyond.noBase)}</span> come only as a topper the
      archive has no matching base for. Only the last group is a gap that could be closed.
    </p>
  )
}

/**
 * What happens to a build in progress when the preference changes.
 *
 * The placement count is read from the store so the warning is concrete when it
 * matters and absent when it does not. A user with an empty grid does not need to
 * be told about `base-lock-mismatch`.
 */
function ChangeConsequences() {
  const placed = usePlacementCount()

  if (placed === 0) {
    return (
      <p className="of-set-note">
        Nothing is placed yet, so changing this now costs nothing beyond the reach shown above. Once tiles are on the
        grid, switching keeps every one of them but can change which base you have to print with them.
      </p>
    )
  }

  return (
    <div className="of-set-note" data-tone="warn">
      <p className="of-set-note-lead">
        You have <span className="of-set-mono">{countLabel(placed)}</span> {placed === 1 ? 'tile' : 'tiles'} placed.
        Changing the lock system keeps every one of them — and may change what you have to print for them.
      </p>
      <ul className="of-set-list">
        <li>
          Each placed topper is re-matched to a base. Where no base offering the new system carries the size code that
          topper needs, the closest base is still used and the bill of tiles is flagged{' '}
          <span className="of-set-mono">base-lock-mismatch</span> — those two pieces will not clip together as printed.
        </li>
        <li>
          A tile that offers only the system you left is flagged{' '}
          <span className="of-set-mono">lock-unavailable</span>. It stays on the grid; it is the joinery, not the tile,
          that is now wrong.
        </li>
        <li>Anything already printed is unaffected, and unaffected by anything on this page.</li>
      </ul>
    </div>
  )
}

/**
 * What is selected, and what it can build — one mono line above the picker.
 *
 * Buildable first because it is the number the picker leads with, and the archive
 * figure after it, so a reader who scans only this line still leaves with both
 * and cannot mistake one for the other.
 */
function CurrentSummary({ build }: { build: LockBuild | null }) {
  const lock = useLockSystem()
  const chosen = useLockChosen()
  const entry = build === null ? undefined : buildOf(build, lock)

  return (
    <p className="of-set-current">
      <Eyebrow>in effect</Eyebrow>{' '}
      <span className="of-set-mono">
        {lockLabel(lock)}
        {entry === undefined
          ? ''
          : ` · ${countLabel(entry.buildable)} of ${countLabel(build?.totalDesigns ?? 0)} designs buildable · ${countLabel(entry.reach.designs)} named in the archive`}
      </span>
      {chosen ? null : <span className="of-set-current-default"> — the default; you have not changed it</span>}
    </p>
  )
}

export function SettingsScreen() {
  const lock = useLockSystem()
  const build = useLockBuild()

  return (
    <section className="of-settings" aria-labelledby="of-settings-title">
      <header className="of-set-head">
        <h1 className="of-set-title" id="of-settings-title">
          Settings
        </h1>
        <p className="of-set-sub">
          Stored in this browser, not on a server. The lock system travels with an exported scene file and with a share
          link, so a build you send someone arrives with the joinery it was designed for.
        </p>
      </header>

      <section className="of-set-section" aria-labelledby="of-settings-lock">
        {/* The id lives on the heading element, not on `Eyebrow`: the primitive
            takes tone, `as` and className only, and reaching past it to add a
            prop would be the start of a variant system. */}
        <h2 className="of-set-rule" id="of-settings-lock">
          <Eyebrow>Lock system</Eyebrow>
        </h2>

        <p className="of-set-lead">
          How your tiles physically join. One choice for the whole app, because you cannot mix joinery systems in a
          single build — and a consequential one: it decides which designs the app can hand you as a complete, printable
          set of parts.
        </p>

        <CurrentSummary build={build} />

        <LockPicker
          build={build}
          value={lock}
          onChange={(system) => {
            setLockSystem(system)
          }}
        />

        <div className="of-set-honesty">
          <Eyebrow as="h3">What this does and does not do</Eyebrow>
          <p className="of-set-fact">
            It is a <strong>preference, not a filter</strong>. The catalog goes on showing every design and every tile
            stays placeable. What the preference decides is which STL file a download resolves to, which base gets
            auto-inserted under a topper, and how the bill of tiles is ordered and warned about.
          </p>
          {build === null ? null : (
            <>
              <BaseFacts build={build} />
              <SideJoineryFact build={build} />
              <FloorFact build={build} />
            </>
          )}
          <ChangeConsequences />
        </div>
      </section>
    </section>
  )
}
