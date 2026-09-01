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
 * <Palette onSelect={tools.setSelectedTileId} selected={tools.selectedTileId} />
 * <Toolbar tools={tools} onClear={clearPlacements} />
 * <PlanCanvas catalog={catalog} tools={tools} />
 * ```
 */
import { useCallback, useMemo, useState } from 'react'

import type { TileId } from '@/catalog'

import type { SnapMode } from './geometry'
import { SNAP_STEP, nextRotation } from './geometry'

/** The two modes of design-contract.md §2.4's toolbar toggle. */
export type PlanTool = 'place' | 'erase'

export interface PlanTools {
  readonly tool: PlanTool
  readonly snap: SnapMode
  /** `SNAP_STEP[snap]` — 0.5 or 1. Never 0.25; see `geometry.ts`. */
  readonly step: number
  /** The angle the next placement will be made at, in degrees, `[0, 360)`. */
  readonly rotation: number
  /** The palette's current selection, or `null` when nothing is armed. */
  readonly selectedTileId: TileId | null
  setTool: (tool: PlanTool) => void
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
  /** Arm a tile. Resets the pending rotation; see below. */
  setSelectedTileId: (id: TileId | null) => void
}

export interface PlanToolDefaults {
  readonly tool?: PlanTool
  readonly snap?: SnapMode
  readonly selectedTileId?: TileId | null
}

export function usePlanTools(defaults: PlanToolDefaults = {}): PlanTools {
  const [tool, setTool] = useState<PlanTool>(defaults.tool ?? 'place')
  const [snap, setSnap] = useState<SnapMode>(defaults.snap ?? 'fine')
  const [rotation, setRotation] = useState(0)
  const [selectedTileId, setSelected] = useState<TileId | null>(defaults.selectedTileId ?? null)

  const setSelectedTileId = useCallback((id: TileId | null) => {
    setSelected(id)
    // A pending angle is only meaningful against a tile's own step: carrying 45°
    // over to a tile that turns in 90° increments would arm an angle that tile
    // can never reach again, and the user would have no way to get back to 0
    // except by cycling through eight steps.
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
      selectedTileId,
      setTool,
      toggleTool,
      setSnap,
      toggleSnap,
      rotate,
      setRotation,
      setSelectedTileId,
    }),
    [tool, snap, rotation, selectedTileId, toggleTool, toggleSnap, rotate, setSelectedTileId],
  )
}
