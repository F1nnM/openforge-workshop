/**
 * The floating toolbar — design-contract.md §2.4's centred plate at the top of
 * the canvas.
 *
 * `Place` / `Erase` / `Move`, `⟳ Rotate`, `Clear`, and a mono `snap {value}`
 * readout.
 *
 * ## The third mode
 *
 * §2.4's toggle names two modes. `Move` is the third, and it is here because
 * PR #29's objection to a move was a *gesture* objection — on the plan view the
 * primary button was already drag-paint — which a mode answers without
 * arbitrating anything. The surface also takes `Shift` with the primary button as
 * a move in any mode, so this control is the discoverable path rather than the
 * only one; `M` is its shortcut, beside the existing `P` and `E`. (Row **R4**
 * deleted the drag-paint renderer that raised the objection. The mode is the
 * better answer either way, and the 3D surface has no drag-paint at all — its
 * drag is the orbit, which `three/surface.ts` sets out.)
 *
 * A `Shift`-drag move leaves this toggle showing `Place`, which is why the
 * readout below reports `status.moving`: a piece in the air with no mode to show
 * it would be the one editing state the toolbar could not see.
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
 * ## The rotate step is the tile's own
 *
 * Never 90. 893 tiles carry a `size|angle` that is not a multiple of it (45,
 * 22.5, 11.25, 60, 120, 240, 300) and would never tile on a 90° step, so the step
 * comes from `rotationStepFor(record)` for whichever tile is armed. With nothing
 * armed there is nothing to turn and the button is disabled — a rotation applied
 * to no tile is state the user cannot see.
 *
 * ## `role="group"`, not `role="toolbar"`
 *
 * A `toolbar` promises arrow-key movement between its controls with one tab stop.
 * Implementing that around a Base UI `ToggleGroup` — which already owns arrow
 * keys inside itself — would mean two composites fighting over the same keys, and
 * the WAI pattern's own guidance is not to nest them. Four tab stops with a
 * labelled group is the honest markup, and the canvas's own key map (`R`, `P`,
 * `E`, `G`) is the fast path for anyone who wants one.
 */
import type { CatalogRecord } from '@/catalog'
import type { PlanTools } from '@/builder/canvas'
import { formatUnits, rotationStepFor } from '@/builder/canvas'
import type { SurfaceStatus } from '@/builder/three'
import { Button, ToggleGroup, ToggleItem, VisuallyHidden } from '@/ui/primitives'

import './panels.css'

export interface PlanToolbarProps {
  readonly tools: PlanTools
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
  /** The armed tile, for its rotation step. */
  readonly armed: CatalogRecord | undefined
  readonly placed: number
  readonly onClear: () => void
}

/** "half a unit" / "one unit" — the two snap steps, said rather than shown. */
function stepLabel(step: number): string {
  return step === 1 ? 'one unit' : 'half a unit'
}

export function PlanToolbar({ tools, status, armed, placed, onClear }: PlanToolbarProps) {
  const step = armed === undefined ? undefined : rotationStepFor(armed)
  const conflicts = status?.conflicts ?? 0

  return (
    <div className="of-build-toolbar" role="group" aria-label="Builder tools">
      <ToggleGroup
        label="Tool"
        value={tools.tool}
        onValueChange={(next) => {
          // Always one mode: Base UI reports `null` when the pressed item is
          // pressed again, and a builder with neither tool up would swallow every
          // click on the canvas.
          if (next !== null) tools.setTool(next)
        }}
      >
        <ToggleItem value="place">Place</ToggleItem>
        <ToggleItem value="erase">Erase</ToggleItem>
        <ToggleItem value="move">Move</ToggleItem>
      </ToggleGroup>

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
            ? '— no tile is armed yet'
            : `the armed tile by ${formatUnits(step)} degrees, shortcut R`}
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
