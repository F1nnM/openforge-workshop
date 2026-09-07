/**
 * The room-wide design, as a control in the builder's work area.
 *
 * ## The defect it closes
 *
 * Row C2's fill solver has preferred *"the room's design family"* first since it
 * shipped — `FillContext.family` — and **nothing set it**. Row C1 argued for the
 * setting in `builder/panels/palette.ts` and deliberately built nothing, because
 * at the time nothing would have read it. Solved against the live archive, the
 * five-slot corner therefore came out of **three stone types and a plain
 * plate** — every part complete, so nothing failed and nothing could:
 *
 * ```
 * S2W: Wall on Tile: Corner (Any, Single Piece)     complete: true, unfilled: 0
 *   column       aztlan#column+corner.col+L.openforge,side.stl
 *   right wall   cut-stone#corner+right,arrow_slit.2x.openforge,side.stl
 *   left wall    cut-stone#corner+left,arrow_slit.2x.openforge,side.stl
 *   floor        aztlan#floor+s2w+corner.2x2.openforge.stl
 *   base         plain#base+square.E.openlock.stl
 * ```
 *
 * With a design set it comes out of one: four `dungeon_stone` parts and the same
 * `plain` base, which is what 38 of the 40 base slots have to offer.
 * `corpus.test.ts` re-solves that exact recipe both ways.
 *
 * The owner's requirement is *"Room-Wide Design as the default, manual
 * deviations are always allowed"*, and this is the first half. The second half is
 * `SlotFill.pinned`, which this control cannot touch: a design change re-solves
 * every `auto` fill through `@/template`'s `reSolveScene` and `fillSlot` refuses
 * every `pinned` one, exactly as a lock change does.
 *
 * ## The shape is `LockToggle`'s, deliberately, and the owner already approved it
 *
 * *"The lock system setting should not be a dedicated screen, but a toggle in the
 * builder workarea, with an on-hover (i) or similar to get a tooltip with the
 * most important information."* That decision was made about a room-wide
 * preference with measured per-option costs, which is precisely what this is, so
 * this control is the same trigger-plus-disclosure at the same size in the same
 * band — and it inherits every argument `LockToggle.tsx` sets out, including the
 * two it overrules: `Dialog` rather than `Popover` (an A/B build measured the
 * popover at +3,829 B of *eager* bundle, because reaching a base-ui component
 * the eager graph does not already hold re-splits `@/ui/primitives` out of the
 * index chunk), and an overlay rather than the literal tooltip, because
 * `Tooltip.tsx` forbids holding the only copy of something a user needs.
 *
 * **What is different is one prop, and it is not a style choice.** `LockToggle`
 * takes none: its figures come from the emitted index through a session-memoised
 * `deriveLockBuild`, which builds its own indexes. This control's figures are a
 * function of the **templates this build can place** as well as of the catalog,
 * and computing them needs an `AssemblyIndex` over 8,702 records and a
 * 409,432-byte `CompositionIndex` — the two objects `BuilderScreen` has already
 * built and memoised for the bill, the lock re-solve and the click's filler. So
 * they are passed in, for row C5's stated reason at the same seam (*"the same
 * three objects the bill and the lock re-solve above are built from rather than
 * second copies"*), and the hazard `LockToggle` avoids by taking no props does
 * not arrive with them: the *preference* is still read from the store here, so
 * there is no way for a caller to hand this control a value that disagrees with
 * what it controls.
 *
 * ## Where it mounts
 *
 * The builder stage's top band, in `.of-builder-toolbar-slot`, beside
 * `<LockToggle>` — **not** in `PlanToolbar` (every control in that strip writes
 * `PlanTools`, and a design is not a plan tool) and **not** in the palette,
 * which is where row C1 argued for it. C1's argument was about legibility and it
 * is still right, but `src/builder/panels/**` is another row's, and the band is
 * where the app already keeps its one room-wide preference. Two room-wide
 * preferences side by side is the better answer anyway: they are the two
 * settings that rewrite a placed scene, and a user who finds one finds the other.
 */
import { setRoomDesign, useRoomDesign } from '@/store'
import { Dialog } from '@/ui/primitives'

import { DesignPicker } from './DesignPicker'
import type { DesignAuthorities } from './useDesignReach'
import { useDesignReach } from './useDesignReach'
import type { DesignReach } from './reach'
import { countLabel, designOf } from './reach'

import './design-picker.css'

/**
 * The id the trigger carries, so another surface can send a reader to the
 * control.
 *
 * A module constant rather than a `useId`, for `LOCK_TOGGLE_ID`'s reason: the
 * point is that something else can find it without either of them holding
 * shared state, and there is exactly one design control on the builder.
 */
export const DESIGN_TOGGLE_ID = 'of-design-toggle-trigger'

/**
 * The accessible name, carrying the figure the eye reads off the trigger.
 *
 * The visible text is three fragments — `design`, a name, a count and an `(i)` —
 * which a screen reader would otherwise join into something that is neither a
 * sentence nor a number.
 */
function triggerLabel(design: string | undefined, reach: DesignReach | null): string {
  const entry = designOf(reach, design)
  if (design === undefined) {
    return (
      'Room design: none. Parts are filled in the catalog’s own order and one piece can mix designs. ' +
      'Choose a design for the whole room.'
    )
  }
  if (entry === undefined || reach === null) {
    return `Room design: ${design}. Choose a design for the whole room.`
  }
  return (
    `Room design: ${entry.label}, reaching ${countLabel(entry.parts)} of ${countLabel(reach.totalParts)} ` +
    'placeable parts. Choose a design for the whole room.'
  )
}

/**
 * What the setting does to a room that is already on the grid.
 *
 * `LockToggle`'s `ChangeConsequences`, and the sentence is the opposite one,
 * which is why it cannot be shared: a lock change leaves every placed file
 * exactly where it is, and a design change **rewrites** them — measured at 108
 * of the 128 slots of the 40 shipped recipes for `dungeon_stone`. So the thing a
 * user needs told is not *nothing moves* but *everything you did not choose by
 * hand moves*, and the count of what will not move is the honest reassurance.
 *
 * The placed count comes from the store, so the paragraph is concrete when it
 * matters and absent when it does not — a user with an empty grid does not need
 * to be told what a re-solve preserves.
 */
function ChangeConsequences({ placed }: { placed: number }) {
  if (placed === 0) {
    return (
      <p className="of-design-note">
        Nothing is placed yet, so this only decides what the next piece is filled with. It is a preference and not a
        filter: the catalog goes on showing every design, and a part with nothing in yours is still filled.
      </p>
    )
  }

  return (
    <div className="of-design-note" data-tone="warn">
      <p className="of-design-note-lead">
        You have <span className="of-design-mono">{countLabel(placed)}</span> {placed === 1 ? 'piece' : 'pieces'}{' '}
        placed. Changing this re-fills every part you have <em>not</em> chosen by hand.
      </p>
      <p className="of-design-note-body">
        A part you picked yourself is pinned and is kept exactly as it is — the same rule the lock system follows.
        Everything else is solved again against the new design, so a piece already on the grid can change which file
        it asks you to print. Anything already printed is unaffected.
      </p>
    </div>
  )
}

/** The picker, the consequence, and nothing else. */
function DesignDisclosure({ reach, placed }: { reach: DesignReach | null; placed: number }) {
  const design = useRoomDesign()

  return (
    <div className="of-design-pop-body">
      <DesignPicker
        reach={reach}
        value={design}
        name="of-design-toggle-family"
        onChange={(next) => {
          setRoomDesign(next)
        }}
      />
      <ChangeConsequences placed={placed} />
    </div>
  )
}

export interface DesignToggleProps {
  /**
   * The two indexes and the template list the reach figures are derived from.
   *
   * Required rather than optional, for row C5's reason at the same seam: an
   * optional authority means a caller that forgot to wire it still compiles and
   * renders a control with no figures, which is the failure mode where a
   * *measured* comparison quietly becomes a list of names.
   */
  readonly authorities: DesignAuthorities
  /**
   * Pieces on the grid, for the consequence paragraph.
   *
   * A number rather than a `usePlacementCount()` inside the component, because
   * the count is the *scene's* and this control is in `@/ui` — `LockToggle`
   * reads it from the store directly and can, being about a preference the store
   * also holds; this one already takes the screen's indexes, and a second store
   * subscription to a count that changes on every placement would wake the
   * closed dialog on every click.
   */
  readonly placed: number
  readonly className?: string
}

/**
 * The control: what is in effect, how far it reaches, and the picker behind it.
 *
 * `reach === null` is a rendered state and not a hidden one, exactly as it is in
 * `LockPicker`: the indexes are not in hand, the trigger shows a dash, and the
 * choice still works because the store does not need the catalog to record a
 * preference.
 */
export function DesignToggle({ authorities, placed, className }: DesignToggleProps) {
  const design = useRoomDesign()
  const reach = useDesignReach(authorities)
  const entry = designOf(reach, design)

  return (
    <Dialog
      title="Room design"
      description="One design for the whole room. Every part prefers it, and a part you choose by hand is always kept."
      className="of-design-dialog"
      closeLabel="Close the room design picker"
      trigger={
        <button
          type="button"
          id={DESIGN_TOGGLE_ID}
          className={['of-design-toggle', className].filter(Boolean).join(' ')}
          aria-label={triggerLabel(design, reach)}
        >
          <span className="of-design-toggle-key" aria-hidden="true">
            design
          </span>
          <span className="of-design-toggle-name" aria-hidden="true">
            {design === undefined ? 'none' : (entry?.label ?? design)}
          </span>
          <span className="of-design-toggle-parts" aria-hidden="true">
            {design === undefined || entry === undefined || reach === null
              ? '—'
              : `${countLabel(entry.parts)}/${countLabel(reach.totalParts)}`}
          </span>
          {/* The `(i)`. Decorative: it says "there is more behind this press",
              which the trigger's accessible name says in words. */}
          <span className="of-design-toggle-info" aria-hidden="true">
            i
          </span>
        </button>
      }
    >
      <DesignDisclosure reach={reach} placed={placed} />
    </Dialog>
  )
}
