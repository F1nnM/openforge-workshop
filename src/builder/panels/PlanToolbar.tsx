/**
 * The floating toolbar — design-contract.md §2.4's centred plate at the top of
 * the canvas.
 *
 * `↶ Undo`, `↷ Redo`, `⟳ Rotate`, `Clear`, and a mono `snap {value}` readout.
 *
 * ## There is no mode toggle, and undo is what replaced it
 *
 * §2.4 specified a `Place` / `Erase` toggle and a `Move` mode was added beside
 * it. All three are **deleted**. They were the only control here that changed
 * what the primary button meant, and what the primary button means is now a
 * function of what is armed or selected — `usePlanTools.ts` carries the whole
 * argument, and `selection.ts#pressMeaning` is the function.
 *
 * Undo and redo take their place, and the substitution is not arbitrary.
 * `Erase` was a mode on a *destructive* verb, which is the one case the mode
 * literature says not to mode-switch, because a slip destroys work. Removing a
 * piece is now `Delete` on a deliberately chosen selection, and what makes that
 * safe rather than merely different is that it can be taken back. The toolbar
 * gained the control the mode was standing in for.
 *
 * The readout below still reports `status.moving`, and now for a better reason
 * than it had: a piece in the air is ephemeral component state that no store
 * write has happened for yet, so it is the one editing state nothing else on
 * this bar can see.
 *
 * ## Snap offers 0.5 and 1.0, and there is no 0.25
 *
 * The mock offered a quarter-unit grid; architecture-plan.md §7 removed it,
 * because every dimension in the catalog is a multiple of 0.5 units and a
 * quarter-unit grid can therefore only produce placements that cannot physically
 * assemble. `SNAP_STEP` in the canvas package is the only place the two values
 * are written down and this component reads them from `tools.step` — it does not
 * spell them out.
 *
 * ## The rotate step is supplied, not derived
 *
 * It was `rotationStepFor(record)` over the armed **tile**: never 90, because 893
 * tiles carry a `size|angle` that is not a multiple of it (45, 22.5, 11.25, 60,
 * 120, 240, 300) and would never tile on a 90° step. Since row A1 what is armed
 * is a template **family**, which is up to five files and has no single record —
 * so the step is a prop, and row A4b already decided what a caller must pass:
 * `ARMED_TURN_STEP_DEG`, the corpus default, because a family's step is the least
 * common multiple of its parts' own and row C2 has not chosen the parts yet.
 * `three/edits.ts#planTurn` turns an armed family by the same constant, so the
 * toolbar and the surface cannot disagree.
 *
 * With nothing armed there is nothing to turn and the button is disabled — a
 * rotation applied to no piece is state the user cannot see. That is unchanged,
 * and it is now the caller's `undefined` rather than an absent record.
 *
 * ## `role="group"`, not `role="toolbar"`
 *
 * A `toolbar` promises arrow-key movement between its controls with one tab
 * stop. The `ToggleGroup` that made nesting two composites the problem is gone,
 * but the answer is unchanged and for a simpler reason: these are four ordinary
 * buttons, a labelled group is the honest markup for them, and the canvas's own
 * key map (`R`, `G`, `Ctrl`+`Z`, `Delete`) is the fast path for anyone who wants
 * one. Promising arrow keys here would also collide with the arrow keys the
 * surface uses to nudge a selection.
 */
import type { PlanTools } from '@/builder/canvas'
import { formatUnits } from '@/builder/canvas'
import type { UndoControls } from '@/builder/canvas/useHistory'
import { VisuallyHidden } from '@/ui/primitives'

import './panels.css'

export interface PlanToolbarProps {
  readonly tools: PlanTools
  /**
   * Undo and redo, handed in rather than taken with `useHistory()`.
   *
   * The hook keeps its ring in a ref and subscribes to the store, so a second
   * caller would build a second ring: the toolbar's buttons and the canvas's
   * `Ctrl`+`Z` would then walk two independent histories of the same room. One
   * caller, one ring, passed to everything that offers the verb.
   */
  readonly history: UndoControls
  readonly placed: number
  readonly onClear: () => void
}

/**
 * The platform's own modifier, for the chips that name a shortcut.
 *
 * **`⌘` was wrong on two of the three platforms this ships to**, and the defect
 * was only visible in a browser: the key handler in `RoomSurface` accepts
 * `ctrlKey` *or* `metaKey` precisely so that undo works everywhere, and a chip
 * that showed `⌘Z` to a Linux or Windows user advertised a key they do not have
 * while the one they do have went unmentioned.
 *
 * `userAgentData.platform` first because `navigator.platform` is deprecated, and
 * both are guarded: this module renders under jsdom in the panel tests, where
 * neither is guaranteed. The fallback is `Ctrl`, which is the majority platform
 * and the safer thing to be wrong about — a Mac user who sees `Ctrl` still finds
 * the key, where a Linux user who sees `⌘` has nothing to press.
 *
 * Computed once at module scope: the platform cannot change while the tab is
 * open, and a chip is rendered on every toolbar paint.
 */
const MOD_KEY: string = (() => {
  if (typeof navigator === 'undefined') return 'Ctrl'
  const data: unknown = Reflect.get(navigator, 'userAgentData')
  const modern: unknown = typeof data === 'object' && data !== null ? Reflect.get(data, 'platform') : undefined
  const name = typeof modern === 'string' && modern !== '' ? modern : navigator.platform
  return /mac|iphone|ipad|ipod/i.test(name) ? '⌘' : 'Ctrl'
})()

/** "half a unit" / "one unit" — the two snap steps, said rather than shown. */
function stepLabel(step: number): string {
  return step === 1 ? 'one unit' : 'half a unit'
}

export function PlanToolbar({ tools, placed, history, onClear }: PlanToolbarProps) {

  return (
    <>
      {/*
        Undo starts the rail's second group — the verbs that change the scene —
        so it carries the top margin that separates it from the generator above.
        The group boundaries do not line up with the component boundaries, and
        marking the *first item of a group* rather than wrapping each group in a
        div is what lets them not have to: the rail is one column of siblings
        from three owners, and a wrapper per owner would reintroduce exactly the
        grouping container this rail exists without.
      */}
      <button
        type="button"
        className="of-stage-tool"
        data-rail-group="start"
        disabled={!history.canUndo}
        onClick={history.undo}
      >
        <span aria-hidden="true">↶</span>
        <span className="of-stage-tool-label">Undo</span>{' '}
        <VisuallyHidden>
          {history.canUndo ? 'the last change' : '— nothing to undo'}
        </VisuallyHidden>
        <kbd className="of-stage-tool-key" aria-hidden="true">
          {MOD_KEY}Z
        </kbd>
      </button>

      <button
        type="button"
        className="of-stage-tool"
        disabled={!history.canRedo}
        onClick={history.redo}
      >
        <span aria-hidden="true">↷</span>
        <span className="of-stage-tool-label">Redo</span>{' '}
        <VisuallyHidden>
          {history.canRedo ? 'the change just undone' : '— nothing to redo'}
        </VisuallyHidden>
        <kbd className="of-stage-tool-key" aria-hidden="true">
          ⇧{MOD_KEY}Z
        </kbd>
      </button>

      <button type="button" className="of-stage-tool" disabled={placed === 0} onClick={onClear}>
        <span aria-hidden="true">⌧</span>
        <span className="of-stage-tool-label">Clear</span>{' '}
        <VisuallyHidden>
          {placed === 0 ? '— nothing is placed' : `all ${String(placed)} placed tiles`}
        </VisuallyHidden>
      </button>

      {/*
        Snap starts the third group: the settings. It is a *state* rather than an
        action, so it reads as the two toggles below it do — a name on the left
        and the current value on the right — and not as the verbs above it.
      */}
      <button
        type="button"
        className="of-stage-tool"
        data-rail-group="start"
        onClick={tools.toggleSnap}
      >
        <span className="of-stage-tool-key-label" aria-hidden="true">
          snap
        </span>
        <span className="of-stage-tool-value" aria-hidden="true">
          {formatUnits(tools.step)}
        </span>
        <VisuallyHidden>{`Snap: ${stepLabel(tools.step)} — switch to ${stepLabel(tools.step === 1 ? 0.5 : 1)}`}</VisuallyHidden>
      </button>
    </>
  )
}
