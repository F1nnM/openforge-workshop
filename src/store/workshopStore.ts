/**
 * OpenForge Workshop — the store.
 *
 * One store, three slices of state, and no actions inside it. Actions are
 * module-level functions that call `setState`, which buys three things:
 *
 *   - **The store's state and its persisted state are the same object.** With
 *     actions in the state you need a `partialize` to strip them back out, and
 *     then the migration functions operate on a projection that has to be kept
 *     in step with the type the app reads. Here there is one shape, so a
 *     migration is written against exactly what `schema.ts` describes.
 *   - **Components never subscribe to an action.** An action reached through
 *     `useStore((s) => s.placeTemplate)` is a subscription; an imported function
 *     is not, so a component that only *writes* never re-renders.
 *   - **Non-React callers work unchanged.** The share codec and the download
 *     builder read this store from plain modules.
 *
 * **Re-render granularity** (the reason the selectors below are shaped as they
 * are): every exported selector returns either a primitive or a state slice that
 * is replaced only when that slice changes. Zustand compares with `Object.is`,
 * so a selector that builds a new array or object on each call re-renders its
 * component on *every* store write. Concretely: {@link usePlacement} returns one
 * instance, so filling a slot on one piece re-renders that piece and not the
 * other forty.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { TileId } from '@/catalog'
import type { GeneratedBaseId, GeneratedPlacement } from '@/generator/placement/scene'
import { GeneratedPlacement as GeneratedPlacementSchema } from '@/generator/placement/scene'

import { clearGeneratedMeshes, retainGeneratedMeshes } from './meshes'
import type { RecoveredState } from './migrations'
import { STORE_VERSION, readPersistedState, salvageWorkshopState } from './migrations'
import type { LockSystem, PlacementId, SlotFill, SlotName, TemplateInstance, WorkshopState } from './schema'
import {
  PlacementId as PlacementIdSchema,
  TemplateInstance as TemplateInstanceSchema,
  defaultWorkshopState,
  normalizeRotation,
} from './schema'
import { clearPendingArm } from './selection'
import { STORAGE_KEY, clearPersistedWorkshopState, workshopStorage } from './storage'

/**
 * Say out loud what recovery discarded.
 *
 * Silent salvage is the failure mode this whole module exists to avoid: a user
 * whose room quietly comes back one piece short has no way to tell that from
 * having mis-remembered placing it. Warned once per hydration, not per dropped
 * entry, so a thoroughly corrupt blob produces one message rather than four
 * hundred.
 */
function reportRecovery(recovered: RecoveredState, phase: string): WorkshopState {
  if (recovered.dropped.length > 0) {
    console.warn(
      `[openforge-workshop] recovered saved state during ${phase}; discarded:\n  ${recovered.dropped.join('\n  ')}`,
    )
  }
  return recovered.state
}

/**
 * The store.
 *
 * `version`/`migrate` are set from the first commit rather than added when first
 * needed, because by then every user's browser already holds an unstamped blob
 * and the reader has to guess at its shape.
 *
 * `migrate` is `persist`'s name for the hook, not a claim about what happens
 * there: row V1 deleted the migration ladder, so the hook is
 * {@link readPersistedState}, a version gate that discards anything not stamped
 * {@link STORE_VERSION}. `migrations.ts` states why, and states the moment that
 * licence expires.
 *
 * Validation is wired into **both** hydration paths, which is not the same as
 * wiring it into one:
 *
 *   - `migrate` runs only when the stored version differs from
 *     {@link STORE_VERSION}.
 *   - `merge` runs on every rehydrate, including the far more common case of a
 *     correctly stamped current-version blob that is corrupt anyway — a tab
 *     killed mid-write, or a hand edit.
 *
 * Validating only in `migrate` would leave that second case unchecked, which is
 * the one most likely to occur — and it is the case the version gate can say
 * nothing about, since the stamp matches. The two do not double-report:
 * `migrate` returns an already-valid state, so the `merge` that follows it
 * salvages nothing.
 */
export const useWorkshopStore = create<WorkshopState>()(
  persist(() => defaultWorkshopState(), {
    name: STORAGE_KEY,
    version: STORE_VERSION,
    storage: workshopStorage,
    migrate: (persisted, version) => reportRecovery(readPersistedState(persisted, version), 'version check'),
    merge: (persisted, current) =>
      persisted === undefined ? current : reportRecovery(salvageWorkshopState(persisted), 'rehydration'),
    onRehydrateStorage: () => (state, error) => {
      if (error === undefined && state !== undefined) return
      // Reached when the stored value is not even JSON, so `set` was never
      // called and the store still holds its defaults — nothing to reset, only
      // poison to remove so the next load starts clean instead of reproducing
      // this every time. Deliberately does not touch `useWorkshopStore`: with
      // synchronous storage this callback runs inside `create(...)`, before the
      // binding above exists.
      console.warn('[openforge-workshop] saved state could not be read; starting fresh', error)
      clearPersistedWorkshopState()
    },
  }),
)

/* ---------------------------------------------------------------- placements */

/**
 * A fresh placement key.
 *
 * `crypto.randomUUID` needs a secure context, which a LAN dev server over plain
 * http is not, so the fallbacks are real code paths rather than defensive
 * decoration. All three produce an opaque, collision-free-in-practice string;
 * this keys a local scene, so entropy beyond that buys nothing.
 */
function newPlacementId(): PlacementId {
  const webCrypto: Crypto | undefined = globalThis.crypto
  if (typeof webCrypto?.randomUUID === 'function') return PlacementIdSchema.parse(webCrypto.randomUUID())
  if (typeof webCrypto?.getRandomValues === 'function') {
    const bytes = webCrypto.getRandomValues(new Uint8Array(16))
    return PlacementIdSchema.parse(Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(''))
  }
  return PlacementIdSchema.parse(`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`)
}

/**
 * What a caller hands {@link placeTemplate}: an instance without its identity.
 *
 * `id` is minted here rather than passed, which is what makes the map key and
 * the `id` field agree by construction — the disagreement `schema.ts` describes
 * and `migrations.ts` resolves is expressible only in a blob out of storage, and
 * nothing in the app can produce one. `Omit` rather than a second hand-written
 * interface, so a field added to {@link TemplateInstance} arrives here without an
 * edit.
 */
export type NewTemplateInstance = Omit<TemplateInstance, 'id'>

/**
 * Put a **template instance** on the grid and return its key.
 *
 * ## Incomplete fills are accepted, and that is contract C-g
 *
 * `fills` may name every slot, some of them, or **none**. §3.2 is explicit that a
 * template with no candidate for a part *"places anyway"*, marked *needs a
 * choice*, so a store that demanded a complete map would make that state
 * unreachable from the bottom of the stack upward — C2's solver could not report
 * a slot it failed to fill, and C3's editor would have nothing to open on. There
 * is deliberately no `completeness` argument, no second action for the partial
 * case and no warning: an unfilled slot is an ordinary state of an instance, not
 * a degraded one, and `migrations.ts#salvageFills` treats it the same way on the
 * way back in.
 *
 * The store also does not check that the named slots **belong** to the template.
 * It cannot — that needs the family table, which must not enter the store's file
 * closure (`schema.ts#TemplateId`) — and it should not: whoever holds the
 * template is the only party that can say, and they are the party that built the
 * map.
 *
 * Parsed on the way in, which is not redundant with the rehydrate check: this
 * catches a bad value at the call that produced it, where the stack still names
 * the culprit, instead of at a hydration months later where it looks like
 * storage corruption.
 */
export function placeTemplate(instance: NewTemplateInstance): PlacementId {
  const id = newPlacementId()
  const validated = TemplateInstanceSchema.parse({
    ...instance,
    id,
    rotation: normalizeRotation(instance.rotation),
  })
  useWorkshopStore.setState((state) => ({ placements: { ...state.placements, [id]: validated } }))
  return id
}

/** Move a placed instance. No-op if the key is unknown, which a stale drag can be. */
export function movePlacement(id: PlacementId, x: number, z: number): void {
  useWorkshopStore.setState((state) => {
    const current = state.placements[id]
    if (current === undefined) return state
    const moved = TemplateInstanceSchema.parse({ ...current, x, z })
    return { placements: { ...state.placements, [id]: moved } }
  })
}

/**
 * Rotate a placed instance.
 *
 * One angle for the whole instance, because a template is placed and rotated as
 * one unit (§1). The slot offsets follow from it arithmetically at fill time
 * (§2.2), so there is nothing per-slot to rotate and nothing to keep in step.
 * The angle is folded into `[0, 360)`; see the schema.
 */
export function rotatePlacement(id: PlacementId, rotation: number): void {
  useWorkshopStore.setState((state) => {
    const current = state.placements[id]
    if (current === undefined) return state
    const rotated = { ...current, rotation: normalizeRotation(rotation) }
    return { placements: { ...state.placements, [id]: rotated } }
  })
}

/** Take an instance off the grid. */
export function removePlacement(id: PlacementId): void {
  useWorkshopStore.setState((state) => {
    if (state.placements[id] === undefined) return state
    const placements = { ...state.placements }
    delete placements[id]
    return { placements }
  })
}

/** Clear the builder scene, keeping the lock preference. */
export function clearPlacements(): void {
  useWorkshopStore.setState({ placements: {}, generated: {} })
  // Every hold is now orphaned. `retainGeneratedMeshes(new Set())` would say the
  // same thing; this is the one call site where "keep nothing" is the whole
  // answer, so it says so directly.
  clearGeneratedMeshes()
}

/* --------------------------------------------------------------------- fills */

/**
 * What a fill attempt did.
 *
 * **Four states rather than a boolean, and contract C-k is the reason.** The
 * obvious signature is `boolean` — row V1's `addToLibrary` returned one, and row
 * R1 attached to it — but here `false` would mean three different things, and
 * two of them are things a caller has to tell apart:
 *
 *   - `'kept-pinned'` is *"the user chose this slot and I left it alone"*. After
 *     a lock change, the count of these is the number of deliberate choices the
 *     re-solve honoured, which is exactly what §3.3 has to disclose. C-k warns
 *     that the lock toggle can stop working with **nothing failing**; a solver
 *     that cannot see this state cannot report it either.
 *   - `'unchanged'` is *"I would have written the fill that is already there"*.
 *     A re-solve that produces the same file is the common case and is not news.
 *   - `'unknown-placement'` is a stale drag or a race, and it is a bug in the
 *     caller rather than an outcome of the room.
 *
 * Collapsing the first two is the specific mistake that would make a lock
 * change look like it had done nothing when it had in fact honoured forty pins,
 * or look like it had honoured them when the candidate set had simply not moved.
 */
export type FillOutcome = 'filled' | 'unchanged' | 'kept-pinned' | 'unknown-placement'

/**
 * Write one slot's fill, or leave it alone.
 *
 * The shared half of {@link fillSlot} and {@link pinFill}. `guardPinned` is the
 * only difference between them and it is the whole of contract **C-k**: the
 * solver must not overwrite a pinned fill and the user must always be able to.
 */
function writeFill(id: PlacementId, slot: SlotName, fill: SlotFill, guardPinned: boolean): FillOutcome {
  let outcome: FillOutcome = 'unknown-placement'
  useWorkshopStore.setState((state) => {
    const current = state.placements[id]
    if (current === undefined) return state
    const existing = current.fills[slot]
    if (guardPinned && existing?.pinned === true) {
      outcome = 'kept-pinned'
      return state
    }
    if (existing !== undefined && existing.tile === fill.tile && existing.pinned === fill.pinned) {
      outcome = 'unchanged'
      return state
    }
    outcome = 'filled'
    const updated: TemplateInstance = { ...current, fills: { ...current.fills, [slot]: fill } }
    return { placements: { ...state.placements, [id]: updated } }
  })
  return outcome
}

/**
 * Fill a slot **automatically** — the default solver's write.
 *
 * Writes `pinned: false`, and **refuses a slot the user has pinned**, returning
 * `'kept-pinned'`. That refusal is where §2.1's rule lives: *"a lock change
 * re-solves every `auto` fill and never touches a `pinned` one."* Putting it
 * here rather than in the solver is the difference between an invariant and a
 * convention — C2 re-walks every slot of an instance after a lock change, and a
 * solver that simply forgot to skip pinned slots would silently discard every
 * deliberate choice in the room, with no test failing and nothing on screen to
 * say so. See {@link FillOutcome} for why the refusal is *named* rather than
 * being a `false` among two other falses.
 *
 * There is deliberately **no `pinned` parameter** on either this or
 * {@link pinFill}. Contract **C-k** warns that if C3's editor writes every fill
 * `pinned` the lock toggle stops working and nothing fails; a boolean argument
 * is exactly how that happens, because the two call sites are then one function
 * apart and a copy-paste carries the wrong literal. Two names cannot be
 * confused, and the names say which is which.
 *
 * A no-op returns the identical state object, so a re-solve that changes nothing
 * wakes no subscriber.
 */
export function fillSlot(id: PlacementId, slot: SlotName, tile: TileId): FillOutcome {
  return writeFill(id, slot, { tile, pinned: false }, true)
}

/**
 * Fill a slot **because the user said so** — the editor's write.
 *
 * Writes `pinned: true` and never refuses, so it never returns `'kept-pinned'`:
 * a user's pick overrides a previous pick as readily as it overrides a solved
 * one. §3.3's remaining rules are C3's,
 * not this function's — re-running the greying walk over still-open siblings, and
 * refusing a pick that would invalidate a sibling's existing fill *with its
 * reason*. Neither is expressible here, because both need the candidate sets and
 * therefore the catalog.
 *
 * **There is no `unpinFill`, and its absence is a known gap rather than a
 * decision.** Nothing in §3.3 offers a user a way to hand a slot back to the
 * lock preference, so no caller exists to write one for; if C3 wants "reset this
 * slot", it is one more action here and not a change of shape.
 */
export function pinFill(id: PlacementId, slot: SlotName, tile: TileId): FillOutcome {
  return writeFill(id, slot, { tile, pinned: true }, false)
}

/* ----------------------------------------------------------- generated bases */

/**
 * Put a generated base on the grid and return its key.
 *
 * The mirror of {@link placeTemplate}, and deliberately a *separate* action over
 * a separate map rather than a widened one: row S5's whole identity argument
 * rests on a generated base being neither a catalog file nor a catalog *item*,
 * and row A1 sharpened it — an instance is a family with up to five slots, each
 * holding a file, and a `GeneratedPlacement` has no slot for any of that. The
 * `PlacementId` space *is* shared, which is what lets one id name a piece on the
 * plan whichever map holds it.
 *
 * Parsed on the way in for {@link placeTemplate}'s reason — a bad value fails at
 * the call that produced it, where the stack still names the culprit, rather than
 * at a hydration months later where it looks like storage corruption. The schema
 * also folds `-0` on both coordinates and constrains the entry point to the five
 * the panel offers.
 *
 * The **mesh is not passed here**, and cannot be: `meshes.ts` holds it, keyed by
 * the recipe rather than by the placement, and this store persists everything it
 * is given. The caller places and holds in the same press — see
 * `GeneratorDrawer`'s `onPlace`.
 */
export function placeGeneratedBase(placement: GeneratedPlacement): PlacementId {
  const id = newPlacementId()
  const validated = GeneratedPlacementSchema.parse({
    ...placement,
    rotation: normalizeRotation(placement.rotation),
  })
  useWorkshopStore.setState((state) => ({ generated: { ...state.generated, [id]: validated } }))
  return id
}

/** Move a generated base. No-op if the key is unknown, which a stale drag can be. */
export function moveGeneratedPlacement(id: PlacementId, x: number, z: number): void {
  useWorkshopStore.setState((state) => {
    const current = state.generated[id]
    if (current === undefined) return state
    const moved = GeneratedPlacementSchema.parse({ ...current, x, z })
    return { generated: { ...state.generated, [id]: moved } }
  })
}

/**
 * Rotate a generated base.
 *
 * The step is not this function's business — it is `GENERATED_ROTATION_STEP_DEG`,
 * 90, because every footprint the panel can produce is a rect on the inch grid —
 * but the *angle* is folded into `[0, 360)` here exactly as
 * {@link rotatePlacement} does, so two bases at the same visual angle compare
 * equal and `generatedPlacementKey` stays a set key.
 */
export function rotateGeneratedPlacement(id: PlacementId, rotation: number): void {
  useWorkshopStore.setState((state) => {
    const current = state.generated[id]
    if (current === undefined) return state
    const rotated = { ...current, rotation: normalizeRotation(rotation) }
    return { generated: { ...state.generated, [id]: rotated } }
  })
}

/**
 * Take a generated base off the grid, releasing its mesh if nothing else wants
 * it.
 *
 * The release is the reason this is not simply `delete`. A hold is 0.5–2.4 MB of
 * STL keyed by *recipe*, so two copies of one base share it and removing one
 * copy must not drop the bytes the other still needs — the retain set is
 * computed from the scene that remains, which is the only formulation that
 * cannot get that wrong. See `meshes.ts`.
 */
export function removeGeneratedPlacement(id: PlacementId): void {
  useWorkshopStore.setState((state) => {
    if (state.generated[id] === undefined) return state
    const generated = { ...state.generated }
    delete generated[id]
    return { generated }
  })
  retainGeneratedMeshes(placedGeneratedBases(useWorkshopStore.getState()))
}

/** Every base id the scene still names. The retain set, and the bill's grouping key. */
function placedGeneratedBases(state: WorkshopState): Set<GeneratedBaseId> {
  return new Set(Object.values(state.generated).map((placement) => placement.base))
}

/* --------------------------------------------------------------------- locks */

/**
 * Choose the joinery system for the whole build. See `DEFAULT_LOCK_SYSTEM`.
 *
 * Also marks the preference as **chosen**, including when the value picked is
 * the one already in effect. That coupling is deliberate rather than incidental:
 * the flag's only job is to decide whether the app still needs to tell the user
 * this choice exists, and someone who has opened the picker and clicked
 * "OpenLOCK" has been told. Leaving the two writes separate would produce the
 * obvious bug — a toolbar control that changes the lock and leaves the
 * first-run notice on screen — and nothing would catch it.
 *
 * **Placements are untouched, and since row A1 that is a much stronger claim
 * than it used to be.** A fill names an exact file, so switching the lock does
 * not merely re-weight a preference at bill time — it means the room is now
 * showing files chosen under the *old* system, for the 1,419 of 3,822 items
 * (37.1%) where the three disagree. What repairs that is a **re-solve**, not a
 * write from here: C2 walks every instance's slots and calls {@link fillSlot},
 * which rewrites the `auto` fills and refuses the `pinned` ones. Doing it here
 * instead would put the fill solver — and therefore the catalog — inside the
 * store, which is the dependency `schema.ts` spends its `TemplateId` docblock
 * refusing.
 *
 * So this action is the *trigger* and not the repair, and nothing is removed
 * from the grid either way.
 */
export function setLockSystem(lock: LockSystem): void {
  useWorkshopStore.setState({ lock, lockChosen: true })
}

/**
 * Record that the user has seen the lock choice and is keeping what is set.
 *
 * The dismiss action on the first-run notice, and the only way to set the flag
 * without touching `lock`. Kept separate from {@link setLockSystem} so that
 * "keep the default" does not have to be spelled
 * `setLockSystem(DEFAULT_LOCK_SYSTEM)` — which reads as a change and would be
 * wrong the day the default moves.
 */
export function acknowledgeLockSystem(): void {
  useWorkshopStore.setState({ lockChosen: true })
}

/* --------------------------------------------------------------------- reset */

/**
 * Wipe everything — state, the persisted copy, the held meshes and the
 * selection channel.
 *
 * `replace: true` rather than a merge, so a field removed in a future version
 * cannot survive a reset.
 *
 * ## Why it now reaches into the selection store — contract C-f
 *
 * `selection.ts` used to argue the opposite, and the argument was sound while it
 * lasted: *"the reader already refuses to arm a file the palette holds no
 * placeable row for, so a reset that emptied the library disarms the handoff by
 * making it unclaimable, and coupling the persisted store to this one to restate
 * that would be a dependency bought for nothing."*
 *
 * **Its premise was the library, and row A0 deleted the library.** The palette
 * no longer lists the items a user kept — it lists the 91 templates this build
 * ships (§3.1, row C1), which are a function of the bundle and not of anything a
 * reset clears. So a pending handoff now survives a reset *and stays claimable*,
 * and the first render of the builder after "clear everything" would arm a piece
 * the user has just thrown away. That is not a dependency bought for nothing; it
 * is one line closing a hole the deletion opened.
 *
 * The coupling is one-directional and stays that way: this store imports
 * `clearPendingArm` and the selection store imports nothing from here.
 */
export function resetWorkshop(): void {
  useWorkshopStore.setState(defaultWorkshopState(), true)
  clearGeneratedMeshes()
  clearPendingArm()
}

/* ----------------------------------------------------------------- selectors */

/** The whole scene. Changes on every placement — subscribe from the canvas only. */
export const selectPlacements = (state: WorkshopState): WorkshopState['placements'] => state.placements

/**
 * One instance, for a component that renders exactly one piece.
 *
 * The granularity that matters most since row A1: an instance is up to five
 * parts and a slot edit rewrites one entry of one `fills` map, so a component
 * subscribed through this re-renders for an edit to *its* piece and for no other.
 */
export const selectPlacement =
  (id: PlacementId) =>
  (state: WorkshopState): TemplateInstance | undefined =>
    state.placements[id]

/**
 * The generated half of the scene. Changes on every generated placement.
 *
 * Kept separate from {@link selectPlacements} rather than concatenated, because
 * a subscriber that wanted only the catalog pieces would otherwise re-render on
 * every generated write and vice versa — and the two populations have different
 * readers: `buildBillOfTiles` takes the first and only the first, and
 * `buildGeneratedBill` takes the second and only the second.
 */
export const selectGeneratedPlacements = (state: WorkshopState): WorkshopState['generated'] => state.generated

/**
 * How many instances are on the grid.
 *
 * Instances, **not parts**, and the distinction is new: one instance is up to
 * five printed pieces. This is the header's `{n} placed` chip and the toolbar's
 * count, both of which are about what the user put down. Row C4 owns the count
 * of *parts*, which is a question for the bill and needs the templates to answer.
 *
 * Catalog placements only; a generated base is counted in the generated bill's
 * own line, which says what it is.
 */
export const selectPlacementCount = (state: WorkshopState): number => Object.keys(state.placements).length

/** The global lock preference. */
export const selectLockSystem = (state: WorkshopState): LockSystem => state.lock

/**
 * Whether the user has ever decided the lock preference.
 *
 * A boolean, so the component that renders the first-run notice re-renders when
 * the answer changes and on no other store write.
 */
export const selectLockChosen = (state: WorkshopState): boolean => state.lockChosen

/* --------------------------------------------------------------------- hooks */

/** @see selectPlacements */
export function usePlacements(): WorkshopState['placements'] {
  return useWorkshopStore(selectPlacements)
}

/** @see selectPlacement */
export function usePlacement(id: PlacementId): TemplateInstance | undefined {
  return useWorkshopStore((state) => state.placements[id])
}

/** @see selectGeneratedPlacements */
export function useGeneratedPlacements(): WorkshopState['generated'] {
  return useWorkshopStore(selectGeneratedPlacements)
}

/** @see selectPlacementCount */
export function usePlacementCount(): number {
  return useWorkshopStore(selectPlacementCount)
}

/** @see selectLockSystem */
export function useLockSystem(): LockSystem {
  return useWorkshopStore(selectLockSystem)
}

/** @see selectLockChosen */
export function useLockChosen(): boolean {
  return useWorkshopStore(selectLockChosen)
}
