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
 * <Palette onSelect={tools.setSelectedTemplate} selected={tools.selectedTemplate} />
 * <Toolbar tools={tools} onClear={clearPlacements} />
 * <Builder3DPanel catalog={catalog} scene={scene} tools={tools} />
 * ```
 */
import { useCallback, useMemo, useState } from 'react'

import type { TemplateId } from '@/store'

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
   * A **template family**, since row A1, and the retype is forced rather than
   * cosmetic. §2.5: *"templates are the only placement unit"*, `placeTemplate` is
   * the only placement action the store offers, and a `TemplateInstance` names a
   * {@link TemplateId} — so a `DesignId` in this slot names nothing this app can
   * put on the grid. §3.1's palette lists 52 template families, and
   * `src/store/workshopStore.ts` states the same thing from the other end: *"the
   * palette no longer lists the items a user kept — it lists 52 generated
   * template families"*.
   *
   * Renamed as well as retyped, which is contract **C-h**'s reasoning applied to
   * a field rather than to a deletion: `selectedDesign: TemplateId` would compile
   * at every reader while saying the wrong word, and both id spaces are opaque
   * strings that `src/store/schema.ts` measures as **not** lexically disjoint —
   * so nothing would catch a reader that kept meaning a design.
   *
   * This state is renderer-agnostic and always was: nothing here touches the
   * DOM, so the rename is invisible to whichever surface draws the plan.
   */
  readonly selectedTemplate: TemplateId | null
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
   * The step is the armed *thing's own*, so the caller passes it —
   * `rotationStepFor(record)` for a single file, `pieceRotationStep(piece)` for a
   * placed instance, whose parts may disagree and whose common step is their
   * least common multiple. A default of 90 here would be wrong for the 893 tiles
   * whose `size|angle` is not a multiple of 90.
   */
  rotate: (step: number, direction?: 1 | -1) => void
  setRotation: (rotation: number) => void
  /** Arm a template family. Resets the pending rotation; see below. */
  setSelectedTemplate: (template: TemplateId | null) => void
}

export interface PlanToolDefaults {
  readonly tool?: PlanTool
  readonly snap?: SnapMode
  readonly selectedTemplate?: TemplateId | null
}

export function usePlanTools(defaults: PlanToolDefaults = {}): PlanTools {
  const [tool, setTool] = useState<PlanTool>(defaults.tool ?? 'place')
  const [snap, setSnap] = useState<SnapMode>(defaults.snap ?? 'fine')
  const [rotation, setRotation] = useState(0)
  const [selectedTemplate, setSelected] = useState<TemplateId | null>(defaults.selectedTemplate ?? null)

  const setSelectedTemplate = useCallback((template: TemplateId | null) => {
    setSelected(template)
    // A pending angle is only meaningful against the armed thing's own step:
    // carrying 45° over to a family that turns in 90° increments would arm an
    // angle it can never reach again, and the user would have no way back to 0
    // except by cycling through eight steps. Since row A1 a family's step is the
    // least common multiple of its parts' (`scene.ts#pieceRotationStep`), which
    // makes the reset *more* necessary rather than less: two families can differ
    // in step even when every file in them is shared.
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
      selectedTemplate,
      setTool,
      toggleTool,
      setSnap,
      toggleSnap,
      rotate,
      setRotation,
      setSelectedTemplate,
    }),
    [tool, snap, rotation, selectedTemplate, toggleTool, toggleSnap, rotate, setSelectedTemplate],
  )
}
