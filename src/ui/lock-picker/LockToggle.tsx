/**
 * The lock system, as a control in the builder's work area.
 *
 * ## This overrules a documented decision, and here is the decision
 *
 * `src/screens/settings/SettingsScreen.tsx` — deleted by this row — argued the
 * opposite in its own docblock, and the argument was not weak:
 *
 * > The alternative considered was a control in the builder toolbar and no
 * > screen. It was rejected because the choice needs about 300 words and two
 * > stacked bar charts per option to make honestly — the question has two
 * > correct answers that disagree, and a toolbar popover is the wrong place for
 * > 300 words.
 *
 * The owner has decided the other way: *"The lock system setting should not be a
 * dedicated screen, but a toggle in the builder workarea, with an on-hover (i)
 * or similar to get a tooltip with the most important information."* So the
 * screen is gone. What the screen was **right** about does not go with it, and
 * this file is where that debt is paid rather than quietly written off.
 *
 * The two figures still disagree, in magnitude and in direction:
 *
 * | | openlock | dragonlock | magnetic |
 * | --- | ---: | ---: | ---: |
 * | **buildability** — what the app can resolve into a printable assembly | 88.3 | 81.6 | 78.7 |
 * | **reachability** — what the archive's tags name | 99.9 | 74.7 | 59.7 |
 *
 * openlock is *lower* than its tags suggest, because buildability refuses to
 * count a design it cannot resolve. magnetic is *19 points higher*, because an
 * auto-inserted base supplies joinery the tile itself has none of. The spread
 * that decides how much this choice costs is 9.6 points, not 40.2.
 *
 * ## Which figure the control shows, and why it is the unflattering one
 *
 * **Buildability**, on the trigger, permanently visible. Three reasons, and the
 * first is the only one that would have settled it on its own:
 *
 *   1. **It is what the user experiences.** Reachability is a property of the
 *      archive's tags; buildability is whether the app can hand you a complete
 *      set of printable parts. The second is the question a person asks.
 *   2. **`LockNotice` already made this call and paid for it.** Its first version
 *      quoted reachability — *"reaches 3,817 of 3,822 designs (99.9%)"* — and its
 *      docblock records why that was withdrawn: *"A notice whose number drops by
 *      eleven points the moment you follow its own link is worse than a notice
 *      with no number."* Two surfaces quoting two readings of one preference is
 *      the failure this project has already had once.
 *   3. **It is not the flattering choice for the default.** openlock reads 88.3
 *      here where its tag coverage would read 99.9. A control that showed the
 *      bigger number for the option it ships with would be the wrong kind of
 *      simplification, and this is the opposite of that.
 *
 * **What buildability hides, and what therefore rides beside it.** Buildability
 * *flatters magnetic* by 19 points, and it does so for a concrete reason: those
 * builds are two printed parts, a topper and a base the archive supplies. So the
 * trigger's number is never alone — {@link LockDisclosure} carries `onePart`
 * (openlock 1,497 against magnetic's 255, running the *other* way from
 * buildability) and the reachability reading, both per option. A reader who
 * opens the disclosure cannot mistake 78.7% for "78.7% of magnetic terrain".
 *
 * ## Three options, or a default and an escape hatch
 *
 * **A default and an escape hatch**, and the reasoning is `LockPicker`'s own:
 *
 * > The one thing this component must not do: present three equivalent-looking
 * > options — or present one number as if it were the whole answer. Both were
 * > live failures here.
 *
 * A three-way segmented control in the toolbar is *precisely* three
 * equivalent-looking options — three pills of equal weight, no room for a figure
 * on any of them. `ToggleGroup`'s docblock is quoted against exactly that shape
 * (*"That is the exact shape this screen must avoid"*). A control that *cycled*
 * the preference on press would be worse again: it would change which base you
 * are told to print, with no disclosure at the moment of the change, and
 * `src/store/schema.ts` records what that costs — openlock reaches 3,817 of
 * 3,822 designs, so *"switching to anything but openlock silently hides a
 * quarter to two-fifths of the catalog"*.
 *
 * So the trigger states what is in effect and what it can build, and the three
 * options with their measured costs are one press behind it. The default is
 * presented; the alternatives are reachable; no two options are ever shown
 * side by side without their numbers attached.
 *
 * ## Why a dialog and not the tooltip the owner asked for
 *
 * The owner said *"an on-hover (i) or similar"*, and `or similar` is doing real
 * work, because `src/ui/primitives/Tooltip.tsx` forbids the literal reading in
 * its own docblock:
 *
 * > **The hint must be redundant.** Anything a user *needs* is inline text or a
 * > popover, never a tooltip. A tooltip repeats and elaborates; it does not hold
 * > the only copy of something.
 *
 * Base UI declines to give a tooltip popup `role="tooltip"` or to wire the
 * trigger's `aria-describedby` at it, because a tooltip is unreachable by touch
 * and unreliably announced. The cost of each lock option is not a hint. So the
 * disclosure is an overlay: reachable on a touch screen, in the accessibility
 * tree, dismissed by `Escape`.
 *
 * **It is `@/ui/primitives`' `Dialog` and not a `Popover`, and that was decided
 * by a measurement rather than by taste.** An anchored non-modal
 * `@base-ui/react/popover` was written first and is the better shape on paper.
 * A/B `vite build`s of the tree this row ships, differing in nothing but the
 * overlay primitive, at `SOURCE_DATE_EPOCH=1700000000`, summing every file
 * `dist/index.html` preloads:
 *
 * | overlay | preloaded files | eager raw | gz | br |
 * | --- | ---: | ---: | ---: | ---: |
 * | `Dialog` — **shipped** | **4** | **661,098** | **204,122** | **177,876** |
 * | `Popover` | 7 | 664,927 | 207,035 | 181,513 |
 *
 * The popover costs **+3,829 B raw / +2,913 B gz / +3,637 B br of eager bundle
 * on every page in the app**, and almost none of that is the popover's own code.
 * Adding a base-ui component the eager graph did not already reach re-splits
 * `@/ui/primitives` out of the `index` chunk into a shared one — the preload set
 * goes from 4 files to 7 — and that split costs more compression context than
 * the component weighs. **This is the exact effect row X10 measured from the
 * other direction**, in `routes/routeTree.tsx`: making `/settings` lazy on its
 * own "*moves 8,002 B and pays for it in brotli (+1,547 B), because splitting
 * `@/ui/primitives` out of `index` to share it costs more compression context
 * than the settings screen weighs*".
 *
 * `Dialog` is already in the eager graph — `Overlay.tsx` is imported by the
 * header — so it adds nothing, and `Overlay.tsx`'s own reason for existing
 * applies directly: *"there is one focus model in the app, not two."* Focus
 * trapping, backdrop dismissal, `Escape`, page inertness and focus return to the
 * trigger all come from a surface that already has tests.
 *
 * **It is modal, which is a real cost and a smaller one than it looks.** Row
 * S4's generator drawer is deliberately non-modal because *"it is a working tool
 * and the plan behind it has to stay legible while a base is tuned"* — you
 * change a parameter and watch the plan. This disclosure has no such
 * relationship to the drawing: you read the comparison, pick, and close.
 * `LockNotice`'s long argument against a modal is specifically against a
 * **first-load** one — *"a hostile front door"*, *"dismissed by reflex"* — and
 * its own reasoning is that the user who wants this *"arrives looking for the
 * setting"*. A modal they opened by pressing a control is that case, not the one
 * the notice rejected.
 *
 * The `(i)` affordance survives as the glyph on the trigger — it is what tells a
 * reader there is more here than a system name. **Hover-to-open was considered
 * and dropped** on top of all that: Base UI's `Popover` has no `openOnHover`,
 * hand-wiring one means owning the open state and the dismiss race it already
 * solves, and a panel that opens while the pointer sweeps across the toolbar on
 * its way to a tile is a hostile thing to put over a drawing. The headline the
 * owner wanted on hover is on the trigger instead, where it needs no gesture at
 * all.
 *
 * ## Where it mounts, and the layout hazard it had to be safe from
 *
 * The builder stage's top band, beside `PlanToolbar` in
 * `.of-builder-toolbar-slot` — **not inside `PlanToolbar`**, which is the plan
 * view's tool strip: every control in it writes `PlanTools`, and row R4 deletes
 * the plan view. The lock preference is neither a plan tool nor a thing R4
 * removes, so it is a sibling in the slot and survives that row untouched.
 *
 * That band had a measured, unreported defect before this control arrived — see
 * `src/screens/builder/builder.css`, which now reserves a gutter so no control
 * in the band can be painted over by a corner plate. This component is only safe
 * there because that fix landed with it.
 */
import type { LockSystem } from '@/store'
import { setLockSystem, useLockSystem, usePlacementCount } from '@/store'
import { Dialog } from '@/ui/primitives'

import type { LockBuild } from './build'
import { buildOf } from './build'
import { LockPicker } from './LockPicker'
import { countLabel, lockLabel, shareLabel } from './reach'
import { useLockBuild } from './useLockBuild'

import './lock-picker.css'

/**
 * The id the trigger carries, so `LockNotice` can send a reader to the control
 * rather than to a route that no longer exists.
 *
 * A module constant rather than a `useId`, because the whole point is that
 * another component can find it without either of them holding shared state, and
 * there is exactly one lock control on the builder.
 */
export const LOCK_TOGGLE_ID = 'of-lock-toggle-trigger'

/**
 * The accessible name, which has to carry the figure the eye reads off the
 * trigger.
 *
 * The trigger's visible text is three fragments — `lock`, a system name, a
 * percentage and an `(i)` — which a screen reader would otherwise join into
 * something that is neither a sentence nor a number anyone can act on.
 */
function triggerLabel(system: LockSystem, entry: LockBuild['entries'][number] | undefined, total: number): string {
  const name = lockLabel(system)
  if (entry === undefined) {
    return `Lock system: ${name}. Figures unknown — the catalog could not be read. Compare the three options.`
  }
  return (
    `Lock system: ${name}, ${countLabel(entry.buildable)} of ${countLabel(total)} designs buildable ` +
    `(${shareLabel(entry.share)}). Compare the three options.`
  )
}

/**
 * What the two readings mean, what neither of them reaches, and what changing the
 * preference does to a build already on the grid.
 *
 * ## What this dropped relative to the 300-word screen, stated rather than lost
 *
 * `LockPicker` is mounted whole, so **everything the deleted screen put on
 * screen through the picker survives**: two bars and two figures per option, the
 * `onePart` count, the per-option cost in percentage points behind the best
 * option, the spread in both dimensions, and the paragraph defining the two
 * readings. Three of the screen's four prose facts survive here in one sentence
 * each. **One was dropped:**
 *
 *   - **`BaseFacts`** — the per-system tally of how many catalogued bases carry
 *     each lock system, and the observation that *zero* bases carry none, so
 *     *"there is no neutral base to fall back on"*. It is dropped because the
 *     conclusion it was drawing is now drawn by the picker itself: three options
 *     with three different measured numbers is the demonstration that the
 *     preference always discriminates, and a reader who needs the underlying
 *     base counts to believe it is not a reader this disclosure can serve. The
 *     corpus tally itself has no other home in the app; **it is gone, and that
 *     is a real loss of one fact rather than a relocation.**
 *
 * Also dropped, and smaller: the screen's `CurrentSummary` line, which said what
 * was in effect and what it could build — the trigger says both, permanently,
 * which is strictly better than a line you had to navigate to; and its
 * sub-heading about the preference being stored in this browser and travelling
 * with an exported scene and a share link. That last is true and useful and is
 * **not** about the cost of the choice, which is what this disclosure is for.
 */
function LockDisclosure({ build }: { build: LockBuild | null }) {
  const lock = useLockSystem()
  const placed = usePlacementCount()

  return (
    <div className="of-lock-pop-body">
      <LockPicker
        build={build}
        value={lock}
        name="of-lock-toggle-system"
        onChange={(system) => {
          setLockSystem(system)
        }}
      />

      {build === null ? null : (
        <div className="of-lock-pop-facts">
          <FloorFact build={build} />
          <SideJoineryFact build={build} />
        </div>
      )}

      <ChangeConsequences placed={placed} />
    </div>
  )
}

/**
 * The designs no option reaches — the floor under all three bars.
 *
 * Kept, and compressed from the screen's paragraph to one sentence, because
 * without it the per-option differences look larger than they are: most of what
 * each option is missing is the *same* set rather than a penalty for that
 * choice. The three-way split survives because only one of the three is anybody's
 * fault, and a single lumped number would read as the app hiding a tenth of the
 * archive.
 *
 * Derived, including the zero: with nothing beyond every option there is no floor
 * to state and this renders nothing.
 */
function FloorFact({ build }: { build: LockBuild }) {
  const beyond = build.unbuildable
  if (beyond.total === 0) return null

  return (
    <p className="of-lock-pop-fact">
      <span className="of-lock-pop-mono">{countLabel(beyond.total)}</span> of{' '}
      <span className="of-lock-pop-mono">{countLabel(build.totalDesigns)}</span> designs cannot be completed under{' '}
      <em>any</em> of the three — {countLabel(beyond.inserts)} are inserts that never sit on the grid,{' '}
      {countLabel(beyond.untagged)} carry no joinery tag, and {countLabel(beyond.noBase)} are toppers the archive has
      no matching base for. Only the last is a gap somebody could close.
    </p>
  )
}

/**
 * Which systems join a tile to its *neighbour*.
 *
 * Kept, because it is the deepest fact the deleted screen carried and the one a
 * magnetic build most needs: **magnetic is a side connector on 0 of 3,822
 * designs**, so a magnetic piece clips downward only and the base under it is the
 * sole thing holding it in line with the piece beside it. That is a consequence
 * of the choice, which is this disclosure's whole subject.
 *
 * Written for *whichever* systems come back at zero rather than for magnetic by
 * name, so a rescan that moved one changes the sentence rather than leaving a
 * claim about magnets beside a list that no longer includes them. It is also why
 * this is prose and not a chip on each option: a symmetrical badge would be
 * permanently dead on one of the three rows, which reads as a bug in the app
 * rather than a fact about the archive.
 */
function SideJoineryFact({ build }: { build: LockBuild }) {
  const without = build.entries.filter((entry) => entry.sideJoinery === 0)
  if (without.length === 0 || without.length === build.entries.length) return null

  return (
    <p className="of-lock-pop-fact">
      Some tiles clip to the tile <em>beside</em> them rather than only down onto a base, and{' '}
      <strong>not one design does that in {without.map((entry) => lockLabel(entry.system)).join(' or ')}</strong>{' '}
      <span className="of-lock-pop-mono">
        (
        {build.entries.map((entry, index) => (
          <span key={entry.system}>
            {index === 0 ? '' : ' · '}
            {`${lockLabel(entry.system)} ${countLabel(entry.sideJoinery)}`}
          </span>
        ))}
        )
      </span>
      . A piece in one of those clips downward only, so the base underneath it is the sole thing holding it in line.
    </p>
  )
}

/**
 * What changing the preference does to a build in progress.
 *
 * Kept — and it matters *more* here than it did on the settings screen, because
 * this control is in the builder, where the tiles are. The placed count is read
 * from the store so the warning is concrete when it matters and absent when it
 * does not: a user with an empty grid does not need to be told about
 * `base-lock-mismatch`.
 *
 * The empty-grid branch also carries the screen's "a preference, not a filter"
 * point in one clause, which is the one sentence of `SettingsScreen`'s honesty
 * block that had nowhere else to go: a reader who thinks this is a filter thinks
 * switching will hide tiles, which is the opposite of what it does.
 */
function ChangeConsequences({ placed }: { placed: number }) {
  if (placed === 0) {
    return (
      <p className="of-lock-pop-note">
        A preference, not a filter: the catalog goes on showing every design and every tile stays placeable. Nothing is
        placed yet, so changing this now costs nothing beyond the reach above.
      </p>
    )
  }

  return (
    <div className="of-lock-pop-note" data-tone="warn">
      <p className="of-lock-pop-note-lead">
        You have <span className="of-lock-pop-mono">{countLabel(placed)}</span> {placed === 1 ? 'tile' : 'tiles'}{' '}
        placed. Switching keeps every one of them — and may change what you have to print for them.
      </p>
      <p className="of-lock-pop-note-body">
        Each placed topper is re-matched to a base. Where no base in the new system carries the size code that topper
        needs, the closest one is still used and the bill is flagged{' '}
        <span className="of-lock-pop-mono">base-lock-mismatch</span> — those two pieces will not clip together as
        printed. A tile offering only the system you left is flagged{' '}
        <span className="of-lock-pop-mono">lock-unavailable</span>: it stays on the grid, and it is the joinery rather
        than the tile that is now wrong. Anything already printed is unaffected.
      </p>
    </div>
  )
}

/**
 * The control: what is in effect, what it can build, and the disclosure behind
 * it.
 *
 * No props. The preference is global, the comparison comes from the emitted
 * index through {@link useLockBuild}, and a caller who could pass either of them
 * in could pass in a figure that disagreed with the store — which is the class
 * of bug the settings screen's tests were written to catch.
 *
 * `build === null` is a rendered state, not a hidden one, exactly as it is in
 * `LockPicker`: the index has not loaded or could not be read, the share shows a
 * dash, and the choice still works because the store does not need the catalog
 * to record a preference.
 */
export function LockToggle({ className }: { className?: string }) {
  const lock = useLockSystem()
  const build = useLockBuild()
  const entry = build === null ? undefined : buildOf(build, lock)
  const total = build?.totalDesigns ?? 0

  return (
    <Dialog
      title="Lock system"
      description="How your tiles physically join. One choice for the whole app, because you cannot mix joinery systems in a single build."
      className="of-lock-dialog"
      closeLabel="Close the lock comparison"
      trigger={
        <button
          type="button"
          id={LOCK_TOGGLE_ID}
          className={['of-lock-toggle', className].filter(Boolean).join(' ')}
          aria-label={triggerLabel(lock, entry, total)}
        >
          <span className="of-lock-toggle-key" aria-hidden="true">
            lock
          </span>
          <span className="of-lock-toggle-name" aria-hidden="true">
            {lockLabel(lock)}
          </span>
          <span className="of-lock-toggle-share" aria-hidden="true">
            {entry === undefined ? '—' : shareLabel(entry.share)}
          </span>
          {/* The `(i)`. Decorative: it says "there is more behind this press",
              which the trigger's accessible name says in words. */}
          <span className="of-lock-toggle-info" aria-hidden="true">
            i
          </span>
        </button>
      }
    >
      <LockDisclosure build={build} />
    </Dialog>
  )
}
