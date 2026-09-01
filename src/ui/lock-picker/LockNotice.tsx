/**
 * The one-time lock notice — a dismissible banner, deliberately not a modal.
 *
 * ## Banner, not modal, and the reasoning is the product decision
 *
 * A modal on first load would be a hostile front door, and worse, it would make
 * the choice *less* informed rather than more:
 *
 *   1. **The default is right for almost everyone.** openlock reaches 99.9% of
 *      designs. Blocking the app to prevent a 0.1-point loss inverts the cost of
 *      the interruption and the cost of the mistake.
 *   2. **The people for whom it is wrong already know.** Nobody needs DragonLock
 *      or magnetic terrain in the abstract; they need it because they already own
 *      a box of it. That user arrives looking for the setting and does not have
 *      to be ambushed with it.
 *   3. **A first-load modal is dismissed by reflex,** before the visitor has seen
 *      a single tile and can attach any meaning to three proper nouns. It
 *      converts an informed decision into a coin toss — and a coin toss over
 *      three options has a two-in-three chance of hiding 25–40% of the catalog.
 *      That is strictly worse than the default it replaced.
 *   4. **Deferring is cheap.** Changing the preference later does not delete a
 *      scene (see the copy below and `@/screens/settings`), so there is nothing
 *      the app needs to extract from the user before they are ready.
 *
 * So: default silently to openlock, say so where it matters, and make the
 * comparison one click away. The notice states the reach of what is currently in
 * effect, names the cost of the alternatives, and offers two ways out — compare
 * them, or keep what is set. Both dismiss it for good, because both are answers.
 *
 * ## Where it belongs
 *
 * Mount it where the preference changes what the user gets — the builder and the
 * download path — not on the landing page, where it is noise before the visitor
 * has decided to stay. It is exported from `@/ui/lock-picker` for exactly that:
 * one import and no props.
 *
 * It renders `null` once the choice is made, so a host can mount it
 * unconditionally and never think about it again.
 */
import { Link } from '@tanstack/react-router'

import type { LockSystem } from '@/store'
import { acknowledgeLockSystem, useLockChosen, useLockSystem } from '@/store'
import { Eyebrow } from '@/ui/primitives'

import type { LockReach } from './reach'
import { countLabel, lockLabel, reachOf, shareLabel } from './reach'
import { useLockReach } from './useLockReach'

import './lock-picker.css'

/**
 * What the notice says about the current preference and the alternatives.
 *
 * Two branches, because the honest sentence differs: when the current system is
 * the furthest-reaching one there is no shortfall to admit and the point is what
 * the *other* options would cost; when it is not, the shortfall is the headline
 * and burying it would be the exact dishonesty this whole screen exists to
 * avoid.
 *
 * With no figures (the index has not loaded, or failed) the notice still says
 * something true and useful, and says nothing it cannot support.
 */
function noticeCopy(reach: LockReach | null, current: LockSystem): string {
  const currentLabel = lockLabel(current)
  if (reach === null) {
    return `Builds use ${currentLabel}. It is a single global choice — you cannot mix joinery systems in one build — and it decides which of the archive's designs you can print.`
  }

  const entry = reachOf(reach, current)
  const others = reach.entries.filter((option) => option.system !== current)
  const otherCosts = others
    .map((option) => `${lockLabel(option.system)} ${shareLabel(option.share)}`)
    .join(', ')

  if (entry === undefined) return `Builds use ${currentLabel}.`

  if (entry.system === reach.entries[0]?.system) {
    return (
      `Builds use ${currentLabel}, which reaches ${countLabel(entry.designs)} of ` +
      `${countLabel(reach.totalDesigns)} designs (${shareLabel(entry.share)}). ` +
      `Switch only if you already print another system: ${otherCosts}.`
    )
  }

  return (
    `Builds use ${currentLabel}, which reaches ${countLabel(entry.designs)} of ` +
    `${countLabel(reach.totalDesigns)} designs (${shareLabel(entry.share)}) — ` +
    `${countLabel(entry.hidden)} are out of reach. ${otherCosts}.`
  )
}

/**
 * The notice, or nothing.
 *
 * Not an `aria-live` region: it is present on first render rather than arriving
 * in response to something the user did, so announcing it would interrupt
 * whatever they were reading. It is a labelled `<aside>`, which a screen reader
 * lists as a complementary landmark and the user reaches when they choose to.
 */
export function LockNotice({ className }: { className?: string }) {
  const chosen = useLockChosen()
  const lock = useLockSystem()
  const reach = useLockReach()

  if (chosen) return null

  return (
    <aside className={['of-lock-notice', className].filter(Boolean).join(' ')} aria-label="Lock system">
      <Eyebrow>lock system</Eyebrow>
      <p className="of-lock-notice-body">{noticeCopy(reach, lock)}</p>
      <p className="of-lock-notice-actions">
        <Link to="/settings" className="of-lock-notice-link">
          Compare the three &rarr;
        </Link>
        <button
          type="button"
          className="of-lock-notice-dismiss"
          onClick={() => {
            acknowledgeLockSystem()
          }}
        >
          {`Keep ${lockLabel(lock)}`}
        </button>
      </p>
    </aside>
  )
}
