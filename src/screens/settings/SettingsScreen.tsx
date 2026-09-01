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
 * It was rejected because the choice needs about 300 words and three bar charts
 * to make honestly — the spread between the best and worst option is 40.2
 * percentage points of catalog access — and a toolbar popover is the wrong place
 * for 300 words. What the builder gets instead is `LockNotice`, which states the
 * consequence in one sentence and links here.
 *
 * ## What this screen owes the reader
 *
 * Three things, and each one is a claim the app must not overstate:
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
 *
 * ## It renders a `<section>`, not a `<main>`
 *
 * `AppFrame` owns the document's one `<main>`. The `<h1>` here is visible.
 */
import { setLockSystem, useLockChosen, useLockSystem, usePlacementCount } from '@/store'
import { LockPicker, countLabel, lockLabel, reachOf, useLockReach } from '@/ui/lock-picker'
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
function BaseFacts() {
  const reach = useLockReach()
  if (reach === null || reach.totalBases === 0) return null

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

/** The reach of what is currently selected, as one mono line under the picker. */
function CurrentSummary() {
  const lock = useLockSystem()
  const chosen = useLockChosen()
  const reach = useLockReach()
  const entry = reach === null ? undefined : reachOf(reach, lock)

  return (
    <p className="of-set-current">
      <Eyebrow>in effect</Eyebrow>{' '}
      <span className="of-set-mono">
        {lockLabel(lock)}
        {entry === undefined
          ? ''
          : ` · ${countLabel(entry.designs)} of ${countLabel(reach?.totalDesigns ?? 0)} designs reachable`}
      </span>
      {chosen ? null : <span className="of-set-current-default"> — the default; you have not changed it</span>}
    </p>
  )
}

export function SettingsScreen() {
  const lock = useLockSystem()
  const reach = useLockReach()

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
          single build — and a consequential one: it decides which of the archive&rsquo;s designs you can print at all.
        </p>

        <CurrentSummary />

        <LockPicker
          reach={reach}
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
          <BaseFacts />
          <ChangeConsequences />
        </div>
      </section>
    </section>
  )
}
