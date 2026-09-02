/**
 * The one-time lock notice — a dismissible banner, deliberately not a modal.
 *
 * ## Banner, not modal, and the reasoning is the product decision
 *
 * A modal on first load would be a hostile front door, and worse, it would make
 * the choice *less* informed rather than more:
 *
 *   1. **The default is right for almost everyone.** openlock builds further
 *      than either alternative, and the whole spread between best and worst is
 *      9.6 percentage points. Blocking the app to prevent that inverts the cost
 *      of the interruption and the cost of the mistake.
 *   2. **The people for whom it is wrong already know.** Nobody needs DragonLock
 *      or magnetic terrain in the abstract; they need it because they already own
 *      a box of it. That user arrives looking for the setting and does not have
 *      to be ambushed with it.
 *   3. **A first-load modal is dismissed by reflex,** before the visitor has seen
 *      a single tile and can attach any meaning to three proper nouns. It
 *      converts an informed decision into a coin toss — and while a coin toss is
 *      cheaper than the plan first thought, it is still a wrong answer arrived at
 *      by the app's own doing rather than a right one arrived at by the user's.
 *   4. **Deferring is cheap.** Changing the preference later does not delete a
 *      scene (see the copy below and `@/screens/settings`), so there is nothing
 *      the app needs to extract from the user before they are ready.
 *
 * So: default silently to openlock, say so where it matters, and make the
 * comparison one click away. The notice states what the current preference can
 * build, names what the alternatives build, and offers two ways out — compare
 * them, or keep what is set. Both dismiss it for good, because both are answers.
 *
 * ## Buildability, not reachability, and the same figure the picker leads with
 *
 * The first version of this banner quoted reachability — "reaches 3,817 of 3,822
 * designs (99.9%)". It was true and it set the reader up to be confused, because
 * the picker one click away leads with **88.3%** for the same system: what the
 * app can actually resolve into a printable assembly. A notice whose number drops
 * by eleven points the moment you follow its own link is worse than a notice with
 * no number. So both quote buildability, and the picker is where the second
 * reading and the definitions live.
 *
 * The cost is that this banner now waits on `deriveLockBuild` rather than
 * `deriveLockReach` — see `useLockBuild.ts` for the measurement and why it is
 * memoised. The banner renders its no-figures copy until then, which it already
 * had to do.
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

import type { LockBuild } from './build'
import { buildOf } from './build'
import { countLabel, lockLabel, shareLabel } from './reach'
import { useLockBuild } from './useLockBuild'

import './lock-picker.css'

/**
 * What the notice says about the current preference and the alternatives.
 *
 * Two branches, because the honest sentence differs: when the current system
 * builds furthest there is no shortfall to admit and the point is what the
 * *other* options would cost; when it is not, the shortfall is the headline and
 * burying it would be the exact dishonesty this whole screen exists to avoid.
 *
 * With no figures (the index has not loaded, or failed) the notice still says
 * something true and useful, and says nothing it cannot support.
 */
function noticeCopy(build: LockBuild | null, current: LockSystem): string {
  const currentLabel = lockLabel(current)
  if (build === null) {
    return `Builds use ${currentLabel}. It is a single global choice — you cannot mix joinery systems in one build — and it decides which of the archive’s designs you can print.`
  }

  const entry = buildOf(build, current)
  const otherCosts = build.entries
    .filter((option) => option.system !== current)
    .map((option) => `${lockLabel(option.system)} ${shareLabel(option.share)}`)
    .join(', ')

  if (entry === undefined) return `Builds use ${currentLabel}.`

  if (entry.system === build.entries[0]?.system) {
    return (
      `Builds use ${currentLabel}, which can build ${countLabel(entry.buildable)} of ` +
      `${countLabel(build.totalDesigns)} designs (${shareLabel(entry.share)}) — more than either alternative. ` +
      `Switch only if you already print another system: ${otherCosts}.`
    )
  }

  return (
    `Builds use ${currentLabel}, which can build ${countLabel(entry.buildable)} of ` +
    `${countLabel(build.totalDesigns)} designs (${shareLabel(entry.share)}) — ` +
    `${countLabel(entry.unbuildable)} are out of reach. ${otherCosts}.`
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
  const build = useLockBuild()

  if (chosen) return null

  return (
    <aside className={['of-lock-notice', className].filter(Boolean).join(' ')} aria-label="Lock system">
      <Eyebrow>lock system</Eyebrow>
      <p className="of-lock-notice-body">{noticeCopy(build, lock)}</p>
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
