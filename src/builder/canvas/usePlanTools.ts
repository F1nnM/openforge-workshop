/**
 * The builder's tool state: what is armed, what is selected, the snap and the
 * pending rotation.
 *
 * ## There is no mode any more
 *
 * §2.4's `place` / `erase` toggle and the `move` mode beside it are **deleted**,
 * along with `PlanTool`, `setTool`, `toggleTool` and the `P` / `E` / `M` keys.
 * What replaced them is not a fourth mode but the absence of one: the primary
 * button's meaning is a function of *what is armed or selected*, resolved by
 * `selection.ts#pressMeaning`, and {@link PlanActivity} is a reading of that
 * state rather than a setting beside it.
 *
 * Three things the modes were doing, and where each went:
 *
 *   - **`erase`** was a mode on a destructive verb, which is the one case the
 *     mode literature says not to mode-switch: a slip destroys work. Removing a
 *     piece is now `Delete` on the selection, and `history.ts`'s undo is what
 *     makes a mis-delete cost a keystroke instead of a rebuild.
 *   - **`move`** existed because PR #29 found *"a drag-to-move gesture is
 *     ambiguous against drag-to-paint on the one mouse button the contract's
 *     two-mode toolbar leaves free"*. With a selection the ambiguity is gone
 *     without arbitration: a drag from a piece moves it, a drag from bare ground
 *     orbits, and nothing paints.
 *   - **`Shift` + primary as a move in any mode** was the escape hatch from the
 *     mode. There is no mode to escape, so it goes too — which leaves
 *     `Shift`-click free for its conventional meaning, extending a selection,
 *     when multi-select arrives.
 *
 * ## Not in the store, on purpose
 *
 * `src/store/schema.ts` is explicit that anything added to `WorkshopState` is
 * persisted, and that ephemeral UI state belongs in component state. What is
 * armed and what is selected are both ephemeral: restoring either from last
 * week's session, on a room the user has forgotten the shape of, is a hazard
 * rather than a convenience. The lock preference is the one preference that
 * persists, and it already lives in the store.
 *
 * It is a hook rather than canvas-internal state because three components share
 * it and none of them owns the others: the palette arms a family **and every
 * axis of its control position**, the toolbar writes the snap and triggers a
 * rotation, and the surface reads all of it and writes the selection and the
 * rotation back from its pointer and keyboard. So the screen calls this once and
 * passes it down.
 *
 * ```tsx
 * const tools = usePlanTools()
 * <Palette tools={tools} />   // calls arm(template) and setArmedPosition(axis, tags)
 * <Toolbar tools={tools} onClear={clearPlacements} />
 * <Builder3DPanel catalog={catalog} scene={scene} tools={tools} />
 * ```
 */
import { useCallback, useMemo, useState } from 'react'

import type { PlacementId, TemplateId } from '@/store'

import type { SnapMode } from './geometry'
import { SNAP_STEP, nextRotation } from './geometry'

/**
 * What the builder is doing, derived from what is armed or selected.
 *
 * **Not a mode the user sets.** §2.4's `place` / `erase` toolbar toggle and the
 * `move` mode added beside it are gone, and this replaces all three as a
 * *reading* of the two pieces of state below rather than a fourth piece of state
 * that can disagree with them. So there is no such thing as being in `place`
 * with nothing armed, or in `move` with nothing selected — both were reachable
 * before, and both were states in which the primary button did nothing while the
 * toolbar insisted otherwise.
 *
 * `armed` and `selected` are **mutually exclusive** — see {@link PlanTools.arm}
 * — which is what makes this a total function of three values rather than four.
 */
export type PlanActivity = 'armed' | 'selected' | 'idle'

export interface PlanTools {
  /** What the builder is doing. Derived; see {@link PlanActivity}. */
  readonly activity: PlanActivity
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
  /**
   * The placement the verbs act on, or `null`.
   *
   * **The operand, made persistent.** Before this, every verb resolved against
   * *the piece under the pointer*: `R` needed a `sticky` ref to remember which
   * piece it turned last, the slot editor had to be hung on a right click because
   * there was nothing else to hang it on, and erasing was a mode on a destructive
   * verb. A selection is the object–action pattern those three were working
   * around, and it is one field.
   *
   * A `PlacementId` and not a piece, for the reason the store gives for keying
   * placements by id: the scene is a **pure projection** and is rebuilt on every
   * store write, so a held piece would be a stale copy within one edit.
   * `selection.ts#resolveSelection` looks the id up against the current scene on
   * every read, which is what makes *"removing the selected piece clears the
   * selection"* and *"a stale id after a Clear or an undo reads as no
   * selection"* one rule rather than two invariants to maintain.
   *
   * Ephemeral, and deliberately: `src/store/schema.ts` is explicit that anything
   * added to `WorkshopState` is persisted, and restoring last week's selection on
   * a room the user has forgotten the shape of is the same hazard restoring
   * `erase` was.
   */
  readonly selected: PlacementId | null
  /**
   * Select a placement, or clear the selection with `null`.
   *
   * **Disarms the palette.** See {@link arm} for why the exclusivity is a
   * property of one state object rather than an agreement between two setters.
   */
  select: (id: PlacementId | null) => void
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
  /**
   * Arm a template family, or disarm with `null`. Resets the pending rotation
   * and **every axis** of the armed position, and **clears the selection**.
   *
   * ## Why the exclusivity is structural
   *
   * Arming and selecting both claim the primary button, `R` and `Delete`. Rather
   * than three tie-breaks, they are made impossible to hold at once: this and
   * {@link select} write **one** state object, so `armed !== null` and
   * `selected !== null` cannot both be true and no reader has to ask what it
   * would mean. Two independent setters agreeing by convention is the version of
   * this that breaks the first time someone adds a third caller.
   *
   * It is also what every tile editor and building game does — picking from the
   * catalogue drops your selection — and it is what lets the floating action bar
   * appear exactly when there is a selection and never reason about a ghost.
   *
   * The flow this appears to cost is not real. `R` while armed turns the
   * **ghost**, so the next placement lands already turned, which is what a
   * builder wants; correcting an already-placed piece is `Escape` and a click.
   *
   * `position` is taken as the **`size`** axis, which is the only one a caller
   * ever pre-arms: the RECENT strip remembers a family at a size, and neither the
   * pending-arm channel nor a test default carries a component or a height.
   */
  arm: (template: TemplateId | null, position?: readonly string[]) => void
  /**
   * Choose one axis of the armed row's control position.
   *
   * Separate from {@link arm} because the two gestures are separate: §3.1's
   * controls sit *inside* the armed row, so a user sizes a family they have
   * already armed, and the palette also arms a family *at* a size from the
   * RECENT strip. That second case is `arm(template, position)` in one call,
   * which is why arming resets rather than preserves.
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

/** Every axis's tags, kept apart. See {@link PlanTools.armedPosition}. */
type Positions = Readonly<Record<PositionAxis, readonly string[]>>

const NO_POSITION: Positions = {
  component: [],
  height: [],
  size: [],
}

export interface PlanToolDefaults {
  readonly snap?: SnapMode
  readonly selectedTemplate?: TemplateId | null
  /** A whole position, taken as the `size` axis — the only one a caller ever pre-arms. */
  readonly armedPosition?: readonly string[]
  readonly selected?: PlacementId | null
}

/**
 * What is armed and what is selected, as **one** value.
 *
 * The invariant `PlanTools.arm` promises — at most one of the two is set — is a
 * property of this object rather than of the code that writes it. Two `useState`
 * calls could hold both, and the reader that then asked "armed *and* selected?"
 * would be asking a real question about a real state. One object cannot.
 *
 * The position is **three lists and not one**, for {@link PlanTools.setArmedPosition}'s
 * reason: choosing a component must not clear a size. They are joined on read.
 */
interface Armament {
  readonly template: TemplateId | null
  readonly position: Positions
  readonly selected: PlacementId | null
}

export function usePlanTools(defaults: PlanToolDefaults = {}): PlanTools {
  const [snap, setSnap] = useState<SnapMode>(defaults.snap ?? 'fine')
  const [rotation, setRotation] = useState(0)
  const [armament, setArmament] = useState<Armament>(() => {
    const position = positionOf(defaults.armedPosition)
    // A default naming both is a caller error rather than a state to resolve, so
    // arming wins and the selection is dropped — the same precedence `arm` has.
    return defaults.selectedTemplate != null
      ? { template: defaults.selectedTemplate, position, selected: null }
      : { template: null, position, selected: defaults.selected ?? null }
  })
  /* Joined on read, in a fixed axis order so two identical choices produce one
     string — `three/fills.ts#memoKey` sorts the tags anyway, and a stable order
     here keeps the array reference stable for the `useMemo` below. */
  const armedPosition = useMemo(
    () => [...armament.position.component, ...armament.position.height, ...armament.position.size],
    [armament],
  )

  const arm = useCallback((template: TemplateId | null, position: readonly string[] = []) => {
    /* Every axis goes with the family, for the same reason the angle does and
       more sharply: the domains differ per row — `GENERATED_FAMILY_SIZES` is 303
       positions over 47 families, 7 with no expressible domain at all, and
       `ASSEMBLY_CONTROLS` adds a component axis that only the two wall assemblies
       have. Carrying `2 x 2` over to a family whose candidates carry no
       `size|width|2` would leave the solver a slot nothing matches, classified
       `no-candidate` (C2's note: *nothing in the archive is this size*), for a
       size the user chose for a different row — and carrying an *arched door*
       onto a corner would do it for a component that row cannot express. So the
       axes are replaced rather than merged, and `position` seeds the size. */
    setArmament({ template, position: positionOf(position), selected: null })
    // A pending angle is only meaningful against the armed thing's own step:
    // carrying 45° over to a family that turns in 90° increments would arm an
    // angle it can never reach again, and the user would have no way back to 0
    // except by cycling through eight steps. Since row A1 a family's step is the
    // least common multiple of its parts' (`scene.ts#pieceRotationStep`), which
    // makes the reset *more* necessary rather than less: two families can differ
    // in step even when every file in them is shared.
    setRotation(0)
  }, [])

  const select = useCallback((id: PlacementId | null) => {
    // The rotation is deliberately left alone. It is the *pending* angle for a
    // placement, and a selection turns by its own step through `planTurn`, so
    // there is nothing here for a reset to protect — and `arm` resets on the way
    // back in, which is where the reset is actually load bearing.
    setArmament({ template: null, position: NO_POSITION, selected: id })
  }, [])

  const setArmedPosition = useCallback((axis: PositionAxis, tags: readonly string[]) => {
    setArmament((current) => ({ ...current, position: { ...current.position, [axis]: tags } }))
  }, [])

  const rotate = useCallback((step: number, direction: 1 | -1 = 1) => {
    setRotation((current) => nextRotation(current, step, direction))
  }, [])

  const toggleSnap = useCallback(() => {
    setSnap((current) => (current === 'fine' ? 'coarse' : 'fine'))
  }, [])

  return useMemo(() => {
    const activity: PlanActivity =
      armament.template !== null ? 'armed' : armament.selected !== null ? 'selected' : 'idle'
    return {
      activity,
      snap,
      step: SNAP_STEP[snap],
      rotation,
      selectedTemplate: armament.template,
      armedPosition,
      selected: armament.selected,
      arm,
      select,
      setSnap,
      toggleSnap,
      rotate,
      setRotation,
      setArmedPosition,
    }
  }, [snap, rotation, armament, armedPosition, arm, select, toggleSnap, rotate, setArmedPosition])
}

/**
 * A pre-armed position as the three axes, which is the `size` one and nothing
 * else.
 *
 * The two callers that pre-arm — the RECENT strip through `arm(template, tags)`
 * and a test default — both carry a *size* position, because that is what a
 * `PendingArm` can express and what the strip remembers. A component or a height
 * would have to be resolved against the row's own domain, which is the palette's
 * job and not this hook's.
 */
function positionOf(position: readonly string[] | undefined): Positions {
  return position === undefined || position.length === 0
    ? NO_POSITION
    : { ...NO_POSITION, size: position }
}
