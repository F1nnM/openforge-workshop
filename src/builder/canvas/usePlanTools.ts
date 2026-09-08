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
 * it and none of them owns the others: row 18's palette writes the selection
 * **and, since row C5, the armed size** — the two halves of *what is armed*, and
 * the surface has to read both to place a filled instance;
 * row 18's toolbar writes the mode and the snap and triggers a rotation, and the
 * canvas reads all five and writes the rotation and the mode back from its
 * keyboard shortcuts. So row 18's screen calls this once and passes it down.
 *
 * ```tsx
 * const tools = usePlanTools()
 * <Palette tools={tools} />   // writes selectedTemplate and armedSize
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
  /**
   * The armed row's **control position**: every axis's tags, concatenated.
   *
   * `['size|width|2', 'size|depth|2']` for *2 wide by 2 deep*, and `[]` for the
   * palette's `any size` — which is a real position and not an absence: with no
   * tags the `constrain` collects nothing and the family admits every size.
   *
   * **It was `armedSize` and carried only size.** The recipe fold gave an
   * assembly three axes — component, height and size — because 32 of the 40
   * fixtures differed by one `component|` require on one slot. All three arrive
   * here as one flat list, which is the right shape for exactly one reason: the
   * list becomes `parentTags`, and it is each **slot's own `constrain` block**
   * that decides which roots reach it. So a `component|door|arched` narrows a
   * merged wall slot and leaves the floor and base beside it untouched, with no
   * per-axis routing anywhere on this path.
   *
   * The axes are kept apart in the hook's state and joined on read, so choosing
   * a component does not clear a size — see {@link PlanTools.setArmedPosition}.
   *
   * **Here rather than in the palette, because the click is what consumes it.**
   * Row C1 built the size control and held the position in `PalettePanel`'s own
   * state, which was the only place it could live while nothing read it; the
   * consequence C1 wrote down was that a user who picked *2 wide by 2 deep* got
   * the solver's default, because `three/edits.ts` placed with `fills: {}` and
   * the surface never saw the position. Row **C5** solves the fills on the click,
   * so the position has to travel the same route the family does — and this hook
   * is that route: the palette writes it, the surface reads it, and neither holds
   * a copy of the other's.
   *
   * The spelling is the tables' own — `size|width|<n>` / `size|depth|<n>` from
   * `GENERATED_FAMILY_SIZES` and `ASSEMBLY_CONTROLS`, and `component|…` /
   * `shape|wall…` from the latter — because it is handed straight to
   * `FillContext.position` and the paths must not drift into two vocabularies.
   *
   * Ephemeral like everything else here: it is a property of what is *armed*,
   * not of the room, so it is not in the store and a reload arms nothing.
   */
  readonly armedPosition: readonly string[]
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
  /** Arm a template family. Resets the pending rotation and every axis; see below. */
  setSelectedTemplate: (template: TemplateId | null) => void
  /**
   * Choose one axis of the armed row's control position.
   *
   * Separate from {@link setSelectedTemplate} because the two gestures are
   * separate: §3.1's controls sit *inside* the armed row, so a user sizes a
   * family they have already armed, and the palette also arms a family *at* a
   * size from the RECENT strip. That second case is the two calls in order, which
   * is why arming resets rather than preserves.
   *
   * **Per axis rather than one list**, since the recipe fold gave an assembly
   * three of them. Choosing a component must not clear the size a user set two
   * clicks earlier, and a single setter taking the whole position would make
   * every control responsible for re-sending the other two.
   */
  setArmedPosition: (axis: PositionAxis, tags: readonly string[]) => void
}

/**
 * The axes a row's controls can offer.
 *
 * `size` is the only one a generated family has; an assembly may have all three.
 * Named as a closed union rather than a `string` so a panel cannot invent a
 * fourth axis that nothing collects — the tags of each are gathered into one
 * `parentTags` list and it is the slots' own `constrain` blocks that decide what
 * applies, so an unknown axis would silently narrow nothing.
 */
export type PositionAxis = 'component' | 'height' | 'size'

const NO_POSITION: Readonly<Record<PositionAxis, readonly string[]>> = {
  component: [],
  height: [],
  size: [],
}

export interface PlanToolDefaults {
  readonly tool?: PlanTool
  readonly snap?: SnapMode
  readonly selectedTemplate?: TemplateId | null
  /** A whole position, taken as the `size` axis — the only one a caller ever pre-arms. */
  readonly armedPosition?: readonly string[]
}

export function usePlanTools(defaults: PlanToolDefaults = {}): PlanTools {
  const [tool, setTool] = useState<PlanTool>(defaults.tool ?? 'place')
  const [snap, setSnap] = useState<SnapMode>(defaults.snap ?? 'fine')
  const [rotation, setRotation] = useState(0)
  const [selectedTemplate, setSelected] = useState<TemplateId | null>(defaults.selectedTemplate ?? null)
  const [armed, setArmed] = useState<Readonly<Record<PositionAxis, readonly string[]>>>(
    defaults.armedPosition === undefined ? NO_POSITION : { ...NO_POSITION, size: defaults.armedPosition },
  )
  /* Joined on read, in a fixed axis order so two identical choices produce one
     string — `three/fills.ts#memoKey` sorts the tags anyway, and a stable order
     here keeps the array reference stable for the `useMemo` below. */
  const armedPosition = useMemo(
    () => [...armed.component, ...armed.height, ...armed.size],
    [armed],
  )

  const setSelectedTemplate = useCallback((template: TemplateId | null) => {
    setSelected(template)
    /* Every axis goes with the family, for the same reason the angle does and
       more sharply: the domains differ per row — `GENERATED_FAMILY_SIZES` is 303
       positions over 47 families, 7 with no expressible domain at all, and
       `ASSEMBLY_CONTROLS` adds a component axis that only the two wall assemblies
       have. Carrying `2 x 2` over to a family whose candidates carry no
       `size|width|2` would leave the solver a slot nothing matches, classified
       `no-candidate` (C2's note: *nothing in the archive is this size*), for a
       size the user chose for a different row — and carrying an *arched door*
       onto a corner would do it for a component that row cannot express. */
    setArmed(NO_POSITION)
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

  const setArmedPosition = useCallback((axis: PositionAxis, tags: readonly string[]) => {
    setArmed((current) => ({ ...current, [axis]: tags }))
  }, [])

  return useMemo(
    () => ({
      tool,
      snap,
      step: SNAP_STEP[snap],
      rotation,
      selectedTemplate,
      armedPosition,
      setTool,
      toggleTool,
      setSnap,
      toggleSnap,
      rotate,
      setRotation,
      setSelectedTemplate,
      setArmedPosition,
    }),
    [
      tool,
      snap,
      rotation,
      selectedTemplate,
      armedPosition,
      toggleTool,
      toggleSnap,
      rotate,
      setSelectedTemplate,
      setArmedPosition,
    ],
  )
}
