/**
 * The builder's tool state: mode, snap, the pending rotation, and the selection.
 *
 * **Not in the store, on purpose.** `src/store/schema.ts` is explicit that
 * anything added to `WorkshopState` is persisted, and that ephemeral UI state
 * belongs in component state. Which tool is armed and which palette row is
 * highlighted are ephemeral: restoring "erase" from last week's session, on a
 * room the user has forgotten the shape of, is a hazard rather than a
 * convenience. The lock preference is the one preference that persists, and it
 * already lives in the store.
 *
 * It is a hook rather than canvas-internal state because three components share
 * it and none of them owns the others: row 18's palette writes the selection,
 * row 18's toolbar writes the mode and the snap and triggers a rotation, and the
 * canvas reads all four and writes the rotation and the mode back from its
 * keyboard shortcuts. So row 18's screen calls this once and passes it down.
 *
 * ```tsx
 * const tools = usePlanTools()
 * <Palette onSelect={tools.setSelectedDesign} selected={tools.selectedDesign} />
 * <Toolbar tools={tools} onClear={clearPlacements} />
 * <PlanCanvas catalog={catalog} tools={tools} />
 * ```
 */
import { useCallback, useMemo, useState } from 'react'

import type { DesignId } from '@/catalog'

import type { SnapMode } from './geometry'
import { SNAP_STEP, nextRotation } from './geometry'

/**
 * The modes of design-contract.md §2.4's toolbar toggle.
 *
 * The contract names two, `place` and `erase`. `move` is the third and it is
 * additive rather than a reinterpretation: PR #29 refused a move because
 * *"a drag-to-move gesture is ambiguous against drag-to-paint on the one mouse
 * button the contract's two-mode toolbar leaves free"*, and a mode is the answer
 * that removes the ambiguity instead of arbitrating it. The canvas also accepts
 * `Shift` with the primary button as a move in *any* mode, so the mode is the
 * discoverable path and not the only one — the same shape `Alt` + primary
 * already has for panning, which likewise has no mode of its own.
 */
export type PlanTool = 'place' | 'erase' | 'move'

export interface PlanTools {
  readonly tool: PlanTool
  readonly snap: SnapMode
  /** `SNAP_STEP[snap]` — 0.5 or 1. Never 0.25; see `geometry.ts`. */
  readonly step: number
  /** The angle the next placement will be made at, in degrees, `[0, 360)`. */
  readonly rotation: number
  /**
   * The palette's current selection, or `null` when nothing is armed.
   *
   * An **item**, since row V4 — the same thing `Placement.design` holds, so the
   * canvas can place what the palette armed without resolving anything. It was a
   * `TileId` only because a placement was, and row V3 had to insert a
   * resolve-to-arm hop (`palette.ts#armFile`) to bridge the two; V4 deleted the
   * hop rather than moving it, so the palette now writes `item.design` straight
   * in and the pressed row is `selected === item.design`.
   *
   * This state is renderer-agnostic and always was: nothing here touches the
   * DOM, so the rename is invisible to whichever surface draws the plan.
   */
  readonly selectedDesign: DesignId | null
  setTool: (tool: PlanTool) => void
  /**
   * Swap between `place` and `erase`, the two modes that are each other's
   * opposite. From `move` it returns to `place`, because `move` is not the
   * negation of anything — it is reached by name, from the toolbar or from `M`.
   */
  toggleTool: () => void
  setSnap: (snap: SnapMode) => void
  toggleSnap: () => void
  /**
   * Turn the pending placement by one step.
   *
   * The step is the *tile's own*, so the caller passes it —
   * `rotationStepFor(record)`. A default of 90 here would be wrong for the 893
   * tiles whose `size|angle` is not a multiple of 90.
   */
  rotate: (step: number, direction?: 1 | -1) => void
  setRotation: (rotation: number) => void
  /** Arm an item. Resets the pending rotation; see below. */
  setSelectedDesign: (design: DesignId | null) => void
}

export interface PlanToolDefaults {
  readonly tool?: PlanTool
  readonly snap?: SnapMode
  readonly selectedDesign?: DesignId | null
}

export function usePlanTools(defaults: PlanToolDefaults = {}): PlanTools {
  const [tool, setTool] = useState<PlanTool>(defaults.tool ?? 'place')
  const [snap, setSnap] = useState<SnapMode>(defaults.snap ?? 'fine')
  const [rotation, setRotation] = useState(0)
  const [selectedDesign, setSelected] = useState<DesignId | null>(defaults.selectedDesign ?? null)

  const setSelectedDesign = useCallback((design: DesignId | null) => {
    setSelected(design)
    // A pending angle is only meaningful against a tile's own step: carrying 45°
    // over to a tile that turns in 90° increments would arm an angle that tile
    // can never reach again, and the user would have no way to get back to 0
    // except by cycling through eight steps. `rotStep` is a hoisted facet, so
    // the step is a property of the *item* and this reset is well posed on one.
    setRotation(0)
  }, [])

  const rotate = useCallback((step: number, direction: 1 | -1 = 1) => {
    setRotation((current) => nextRotation(current, step, direction))
  }, [])

  const toggleTool = useCallback(() => {
    setTool((current) => (current === 'place' ? 'erase' : 'place'))
  }, [])

  const toggleSnap = useCallback(() => {
    setSnap((current) => (current === 'fine' ? 'coarse' : 'fine'))
  }, [])

  return useMemo(
    () => ({
      tool,
      snap,
      step: SNAP_STEP[snap],
      rotation,
      selectedDesign,
      setTool,
      toggleTool,
      setSnap,
      toggleSnap,
      rotate,
      setRotation,
      setSelectedDesign,
    }),
    [tool, snap, rotation, selectedDesign, toggleTool, toggleSnap, rotate, setSelectedDesign],
  )
}
