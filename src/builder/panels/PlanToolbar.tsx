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
import type { SurfaceStatus } from '@/builder/three'
import { Button, VisuallyHidden } from '@/ui/primitives'

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
  /**
   * The work surface's readout. `null` until it has reported once.
   *
   * It was `PlanStatus`, which lived in `PlanCanvas.tsx`. Row **R4** deleted that
   * renderer, and `SurfaceStatus` — declared in `builder/three/edits.ts`, field
   * for field identical to `PlanStatus` and deliberately so, precisely to survive
   * this deletion — is the type now. `import type`, so it is erased at build time
   * and no value edge to `@/builder/three` exists in the bundle; the panels'
   * `boundary.test.ts` walks value imports only, for the same reason.
   */
  readonly status: SurfaceStatus | null
  /**
   * The rotation step of whatever is armed, in degrees, or `undefined` for
   * nothing armed.
   *
   * The caller's, because the caller is the one that knows what is armed: see
   * the module note, and `three/edits.ts#ARMED_TURN_STEP_DEG` for the value a
   * template family takes.
   */
  readonly armedStep: number | undefined
  readonly placed: number
  readonly onClear: () => void
}

/** "half a unit" / "one unit" — the two snap steps, said rather than shown. */
function stepLabel(step: number): string {
  return step === 1 ? 'one unit' : 'half a unit'
}

export function PlanToolbar({ tools, status, armedStep, placed, history, onClear }: PlanToolbarProps) {
  const step = armedStep
  const conflicts = status?.conflicts ?? 0

  return (
    <div className="of-build-toolbar" role="group" aria-label="Builder tools">
      {/*
        The `Place` / `Erase` / `Move` toggle is **gone**, not moved. It was the
        one control on this toolbar that changed what the primary button meant,
        and all three of its modes are now readings of what is armed or selected
        rather than settings beside them — see `usePlanTools.ts`. What replaced
        it in this bar is undo and redo, which is the control the modes were
        standing in for: `Erase` existed so a click could destroy, and the reason
        that is safe now is that it can be taken back.
      */}
      <Button
        size="sm"
        disabled={!history.canUndo}
        onClick={() => {
          history.undo()
        }}
      >
        <span aria-hidden="true">↶</span>
        <span>Undo</span>{' '}
        <VisuallyHidden>{history.canUndo ? 'the last change, shortcut Control Z' : '— nothing to undo'}</VisuallyHidden>
      </Button>

      <Button
        size="sm"
        disabled={!history.canRedo}
        onClick={() => {
          history.redo()
        }}
      >
        <span aria-hidden="true">↷</span>
        <span>Redo</span>{' '}
        <VisuallyHidden>
          {history.canRedo ? 'the change just undone, shortcut Control Shift Z' : '— nothing to redo'}
        </VisuallyHidden>
      </Button>

      <Button
        size="sm"
        disabled={step === undefined}
        onClick={() => {
          if (step !== undefined) tools.rotate(step)
        }}
      >
        <span aria-hidden="true">⟳</span>
        <span>Rotate</span>{' '}
        {/*
          Every clipped span in this file is preceded by a real space:
          `dom-accessibility-api` trims each text node before joining, so a
          leading space inside the string does not separate the words and the
          button would announce as "Rotatethe armed tile".
        */}
        <VisuallyHidden>
          {step === undefined
            ? '— nothing is armed yet'
            : `the armed recipe by ${formatUnits(step)} degrees, shortcut R`}
        </VisuallyHidden>
        <kbd className="of-build-key" aria-hidden="true">
          R
        </kbd>
      </Button>

      <Button size="sm" disabled={placed === 0} onClick={onClear}>
        Clear{' '}
        <VisuallyHidden>
          {placed === 0 ? '— nothing is placed' : `all ${String(placed)} placed tiles`}
        </VisuallyHidden>
      </Button>

      <Button size="sm" className="of-build-snap" onClick={tools.toggleSnap}>
        snap {formatUnits(tools.step)}{' '}
        <VisuallyHidden>{`— switch to ${stepLabel(tools.step === 1 ? 0.5 : 1)}`}</VisuallyHidden>
      </Button>

      {/*
        The mono status tail. Only ever shows what is true: the piece currently in
        the air, a pending rotation the user has to be able to see (it applies to
        the *next* placement, so nothing in the room carries it yet) and the
        overlap count, which is the surface's own conflict marking counted up.
      */}
      <p className="of-build-readout">
        {status?.moving == null ? null : (
          <span>
            <span aria-hidden="true">✥ </span>
            moving {status.moving}
          </span>
        )}
        {tools.rotation === 0 ? null : (
          <span>
            <span aria-hidden="true">⟳ </span>
            {formatUnits(tools.rotation)}° <VisuallyHidden>pending rotation</VisuallyHidden>
          </span>
        )}
        {conflicts === 0 ? null : (
          <span className="of-build-conflicts">
            {String(conflicts)} overlapping
          </span>
        )}
      </p>
    </div>
  )
}
