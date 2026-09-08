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
  filledSlots,
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
 *
 * **`filters` is optional here and required there**, which is the one departure
 * and it is the schema's own: the field carries a `.default([])`, so an absent
 * one is not a missing value but a stated choice — *any* on every axis. Writing
 * it as `Partial` says that in the type rather than making forty call sites
 * repeat `filters: []` to mean nothing. Every other field stays required,
 * because none of them has a defensible default.
 */
export type NewTemplateInstance = Omit<TemplateInstance, 'id' | 'filters'> &
  Partial<Pick<TemplateInstance, 'filters'>>

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

/**
 * Put the placement map back to a value it previously held. Undo's one write.
 *
 * **A whole-map write, and that is what makes it the only action undo needs.**
 * Every other action here is a verb — place one, move one, turn one, fill a slot
 * — and an undo built out of verbs needs an inverse for each of them, forever,
 * with a silent hole in the history the first time someone adds a verb and
 * forgets its inverse. `history.ts` holds snapshots instead, so the whole of
 * undo is *this map, again*, whatever produced it.
 *
 * It does **not** touch `generated`. A generated base owns a mesh hold
 * (`retainGeneratedMeshes`), so restoring that map means reconciling the holds
 * too, and a restore that dropped one would leak or free a mesh under a piece
 * still on the plan. Undo therefore covers the catalog placements — which is
 * every gesture this row added — and the generated map is a row of its own.
 * `useHistory` subscribes to `placements` alone for the same reason.
 */
export function restorePlacements(placements: WorkshopState['placements']): void {
  useWorkshopStore.setState({ placements })
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
 * **{@link unpinFill} closes the gap this docblock used to name.** The sentence
 * here was *"there is no `unpinFill`, and its absence is a known gap rather than
 * a decision"*, and it was right that the fix was one more action and not a
 * change of shape: C3's editor exists now, so the caller exists, and the action
 * below is a sibling of this one rather than a parameter on it. {@link clearFill}
 * is the second half — a user who wants the slot *empty* rather than back under
 * the preference. C3's sibling-invalidation refusal, named above, is unchanged
 * and is now a **policy** rather than a missing capability: `clearFill` could
 * repair such a pick and must not, because doing so would throw away a file the
 * user chose in order to let an unrelated press succeed.
 */
export function pinFill(id: PlacementId, slot: SlotName, tile: TileId): FillOutcome {
  return writeFill(id, slot, { tile, pinned: true }, false)
}

/* ------------------------------------------------------ giving a slot back */

/**
 * What a clear attempt did.
 *
 * **Three states, and the missing fourth is the point.** {@link FillOutcome} has
 * four because `fillSlot` can *refuse* — a pinned slot is left alone and
 * `'kept-pinned'` is how a re-solve counts the deliberate choices it honoured.
 * {@link clearFill} refuses nothing (see its docblock on why it has no guarded
 * twin), so there is no such state to name, and inventing one would be a token no
 * branch can produce.
 *
 * `'unchanged'` is the same word A1 used for the same fact — *"the state I would
 * have produced is already there"* — spelled once for the whole store rather
 * than once per action, because a slot that is already empty and a fill that is
 * already what would be written are one condition seen from two actions.
 * `'unknown-placement'` is a stale gesture or a race, which is a bug in the
 * caller rather than an outcome of the room.
 */
export type ClearOutcome = 'cleared' | 'unchanged' | 'unknown-placement'

/**
 * **Empty a slot** — take the fill out and leave the instance on the grid.
 *
 * Contract **C-g** is what makes this legal rather than destructive:
 * `placeTemplate` deliberately accepts an incomplete `fills` map and §3.2 is
 * explicit that a template with no candidate for a part *"places anyway"*,
 * marked *needs a choice*. So an absent key is an ordinary state of an instance
 * and this action produces exactly it — the piece stays in the room, the drawing
 * loses one part, and row C4's `billView.ts#slotFaults` reports the slot as
 * `empty`, which **refuses the download** (`blocksDownload`, and §7's line: an
 * unprintable pack is refused where a wrong build is merely disclosed).
 *
 * ## Why there is one of these and not a guarded pair
 *
 * `fillSlot` and `pinFill` are two actions because there are two callers with
 * opposite rights: the solver must not overwrite a pinned fill and the user must
 * always be able to. **Clearing has one caller.** The user says "empty this",
 * and no solver clears anything — C2's `reSolveScene` walks a slot it can no
 * longer fill and *reports* it as `UnfilledReport.stale` rather than removing
 * the stale answer, deliberately, because a driver that silently deleted a
 * user's pin on a candidate-set change would be C-k's failure with a delete key.
 * So a `clearAutoFill` guarded twin would have no call site, which is the state
 * `reSolveScene` itself spent two rows in and the thing this row exists to stop.
 * If a solver-side clear is ever wanted it is a second *named* action here, not
 * a boolean on this one.
 *
 * The same reasoning is why this **does not refuse a pinned fill**: emptying a
 * slot you chose is the strongest form of "I no longer want my choice", and it
 * is strictly a superset of {@link unpinFill} in intent but not in effect — that
 * one keeps a printable file and hands the choice back, this one leaves a hole
 * that stops the pack.
 *
 * ## `delete`, and never `fills[slot] = undefined`
 *
 * Under `noUncheckedIndexedAccess` the two read identically at every `fills[slot]`
 * site, so nothing in the type system separates them — and three readers walk
 * the map's **keys** rather than reading a slot they already name:
 * `canvas/catalog.ts#parts` draws one part per key, `share/link.ts` encodes one
 * wire fill per key, and `migrations.ts#salvageFills` parses one entry per key on
 * the way back in. A key holding `undefined` survives all three as a fill that
 * is not there: nothing to draw, a `pinned` bit encoded for no file, and an entry
 * that fails the schema on the next hydration. `filledSlots` is `Object.keys`,
 * which is the one line that decides it.
 *
 * ## A cleared slot is not permanent, and that is the lock's rule not an oversight
 *
 * An empty slot carries no `pinned` bit, so the next lock re-solve **fills it** —
 * `fillSlot` on an absent key writes. That is §2.1 read literally: the lock owns
 * every slot the user has not pinned, and a slot the user emptied is not pinned.
 * Until then the slot reads *needs a choice* and the download refuses, which is
 * the honest state for "I have taken this out and not yet said what goes in".
 * A caller wanting a hole the lock will not fill is asking for a fourth
 * persisted state and would have to say so in `schema.ts`.
 */
export function clearFill(id: PlacementId, slot: SlotName): ClearOutcome {
  let outcome: ClearOutcome = 'unknown-placement'
  useWorkshopStore.setState((state) => {
    const current = state.placements[id]
    if (current === undefined) return state
    if (current.fills[slot] === undefined) {
      outcome = 'unchanged'
      return state
    }
    outcome = 'cleared'
    const fills = { ...current.fills }
    // See the docblock: `= undefined` would leave a key three readers walk.
    delete fills[slot]
    return { placements: { ...state.placements, [id]: { ...current, fills } } }
  })
  return outcome
}

/**
 * What an unpin attempt did.
 *
 * Three states for {@link ClearOutcome}'s reason — nothing refuses, so nothing
 * is kept — and `'unchanged'` deliberately covers **both** of the two ways a
 * slot can already be the lock's: a fill the solver put there, and no fill at
 * all. That is not the collapse A1 warned about. A1 split `false` because three
 * *different* facts wore it and a caller had to tell them apart; these two are
 * one fact — *the lock decides this slot on its next pass* — reached from either
 * side, and `fillSlot` writes to both alike. Naming them apart would be two
 * spellings of one state, and the caller that read them apart would have nothing
 * different to do.
 */
export type UnpinOutcome = 'unpinned' | 'unchanged' | 'unknown-placement'

/**
 * **Hand a slot back to the lock preference** — drop the `pinned` bit and keep
 * the file.
 *
 * This is the action rows **A1**, **C2** and **C3** each asked for and each
 * declined to add: A1's `pinFill` records *"there is no `unpinFill`, and its
 * absence is a known gap rather than a decision"*, C2's `relock.ts` calls it the
 * first of its three gaps around the `pinned` bit, and C3 called it *"the
 * highest-value missing action"*. Without it `pinFill` is a one-way door:
 * nothing in the app writes `false` over a `true`, so **the first pin makes that
 * slot permanently deaf to the lock toggle** — and the lock is a live preference
 * worth 1,419 of 3,822 items (37.1%), not a one-time setting.
 *
 * It is also what makes C2's {@link import('@/template').PinLockWarning}
 * actionable. That warning already names the sibling variant of the same design
 * that *would* print under the current preference; before this action a user
 * could read it and had no way to say "then use that one" short of finding the
 * file by hand.
 *
 * ## It keeps the tile, and that is the whole difference from {@link clearFill}
 *
 * Two actions rather than one with a mode, for contract **C-k**'s reason applied
 * to a second axis: they leave the room in states that differ in whether the
 * pack can be built. Unpinning leaves a **printable** file in the slot and moves
 * only the authority over it; clearing leaves a hole and refuses the download.
 * A single `releaseSlot(id, slot, keepTile)` would put those one boolean apart,
 * which is exactly the shape A1 refused for `pinned` itself.
 *
 * ## It does not re-solve, and it cannot — so the caller must
 *
 * Dropping the bit does not change the file, so on its own this action leaves
 * the slot showing whatever was pinned until something re-solves it. The store
 * cannot do that re-solve: it needs the candidate sets and therefore the
 * catalog and the template table, which is the dependency `schema.ts` spends its
 * `TemplateId` docblock refusing to let into the store's file closure.
 *
 * So the write is the store's and the repair is the caller's, and the caller
 * must actually do it — `slotEditor.ts#handSlotToLock` is the one that does,
 * with the argument for why an unpin that only waited for the next lock change
 * would be worse than no unpin at all. Row A2's finding is what makes the
 * caller's re-solve sufficient rather than only necessary: `planSceneMeshes` is
 * lock-free and reconciles on the **placements**, so the fill this action's
 * caller writes is the whole route to the drawing, the bill and mesh conversion.
 * This action alone changes no file the scene names, so it warms no mesh — by
 * design, not by omission.
 */
export function unpinFill(id: PlacementId, slot: SlotName): UnpinOutcome {
  let outcome: UnpinOutcome = 'unknown-placement'
  useWorkshopStore.setState((state) => {
    const current = state.placements[id]
    if (current === undefined) return state
    const existing = current.fills[slot]
    if (existing === undefined || !existing.pinned) {
      outcome = 'unchanged'
      return state
    }
    outcome = 'unpinned'
    const updated: TemplateInstance = {
      ...current,
      fills: { ...current.fills, [slot]: { tile: existing.tile, pinned: false } },
    }
    return { placements: { ...state.placements, [id]: updated } }
  })
  return outcome
}

/* ------------------------------------------------------------------- filters */

/** What a filter change did. `'unchanged'` when neither the filters nor a fill moved. */
export type FiltersOutcome = 'set' | 'unchanged' | 'unknown-placement'

/**
 * **Re-arm one placed instance** — write its palette filters and the fills that
 * follow from them, in one transaction.
 *
 * ## Why the fills come with the filters rather than after them
 *
 * A filter change moves the candidate *set*, so every slot's answer can change
 * at once — that is the whole difference from the lock, whose candidate set is
 * lock-free (`template/relock.ts`). Writing the filters and then the fills would
 * put a room on screen for one render in which the instance claims to be an
 * arched door and holds a rectangular one. And writing them slot by slot through
 * {@link fillSlot} could not work at all: that action **refuses a pinned slot**
 * by design, and a filter change is the one gesture that may replace a pin.
 *
 * So this is `relock.ts`' *"one transaction"* — the first of the three options
 * its docblock prices — for the case that needs it: one `setState`, one persist,
 * whatever the instance's slot count.
 *
 * ## Why it may overwrite a pin, when nothing else here may
 *
 * Contract **C-k** is about a *silent* discard on a change made for an unrelated
 * reason. This is not that: `template/relock.ts#reSolveInstance` is the only
 * caller's only source of `fills`, it decides which pins the new filters still
 * admit, and it **reports every one it drops** so the surface can say so. The
 * argument in full is on that function; what matters here is that the store's
 * guard is deliberately not in the way, and that this action therefore takes a
 * whole `fills` map rather than a tile — a caller cannot reach a pin through it
 * one slot at a time.
 *
 * The map replaces `fills` wholesale, because a filter change can **empty** a
 * slot — a slot with no entry is a slot needing a choice (contract C-g), and a
 * merge could not express that.
 *
 * Like every other write here it changes no mesh and re-solves nothing: row A2's
 * `planSceneMeshes` is lock-free and reconciles on the placements, so the fills
 * this action writes are the whole route to the drawing, the bill and the pack.
 *
 * ## One transaction is also one undo
 *
 * `canvas/useHistory.ts` subscribes to `placements` and records on a changed
 * *identity*, so this action needs nothing at the call site to be undoable — and
 * because the filters and the fills go in a single `setState`, one `Ctrl+Z`
 * restores both. Two writes would have been two steps, and the intermediate one
 * is the state this action exists to make unreachable: an instance claiming to be
 * an arched door while holding a rectangular one.
 *
 * The `'unchanged'` case returns the identical state object, so pressing the chip
 * an instance is already on records no step either.
 */
export function setPlacementFilters(
  id: PlacementId,
  filters: readonly string[],
  fills: TemplateInstance['fills'],
): FiltersOutcome {
  let outcome: FiltersOutcome = 'unknown-placement'
  useWorkshopStore.setState((state) => {
    const current = state.placements[id]
    if (current === undefined) return state
    /* Parsed on the way in for {@link placeTemplate}'s reason: a caller that
       handed over a malformed tag or slot name should fail at the call that
       produced it, where the stack still names the culprit, rather than at a
       hydration months later where it reads as storage corruption. */
    const updated: TemplateInstance = TemplateInstanceSchema.parse({ ...current, filters, fills })
    if (sameInstance(current, updated)) {
      outcome = 'unchanged'
      return state
    }
    outcome = 'set'
    return { placements: { ...state.placements, [id]: updated } }
  })
  return outcome
}

/**
 * Whether two instances carry the same filters and the same fills.
 *
 * So that a filter change that lands on the position the instance was already at
 * returns the identical state object and wakes no subscriber — the same courtesy
 * {@link fillSlot}'s `'unchanged'` extends, and it matters more here because this
 * action writes the whole map on every press.
 */
function sameInstance(a: TemplateInstance, b: TemplateInstance): boolean {
  if (a.filters.length !== b.filters.length) return false
  if (a.filters.some((tag, at) => b.filters[at] !== tag)) return false
  const keys = filledSlots(a.fills)
  if (keys.length !== filledSlots(b.fills).length) return false
  return keys.every((slot) => {
    const one = a.fills[slot]
    const other = b.fills[slot]
    return one !== undefined && other !== undefined && one.tile === other.tile && one.pinned === other.pinned
  })
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

/* --------------------------------------------------------------- room design */

/**
 * Choose the room-wide design, or clear it with `undefined`.
 *
 * The owner's requirement is *"Room-Wide Design as the default, manual
 * deviations are always allowed"*, and the two halves land in two different
 * places: this action is the default, and the deviation is
 * {@link SlotFill.pinned} — which this action cannot touch, because it writes
 * one scalar and no fill.
 *
 * **The trigger, not the repair**, exactly as {@link setLockSystem} is. A design
 * change has to rewrite every `auto` fill in the scene or it changes nothing at
 * all: a fill names an exact file (decision D1), and row A2 proved
 * `planSceneMeshes` is lock-free, so the new design reaches the drawing, the
 * bill and mesh conversion through the placements and through nothing else.
 * Measured on the live archive over the 40 shipped recipes, setting
 * `dungeon_stone` moves **108 of 128** slot fills — so a design change that did
 * not re-solve would be contract **C-k**'s failure with a second control: the
 * picker moves, and nothing on the grid does.
 *
 * The re-solve is `@/template`'s `reSolveScene` and its caller is
 * `BuilderScreen`, for the reason that row wrote down for the lock: the driver
 * needs the assembly index, the composition index, the template table and every
 * placement, and the screen is the only party holding all four. Doing it here
 * would put the fill solver — and therefore the catalog — inside the store,
 * which is the dependency `schema.ts` spends its `TemplateId` docblock refusing.
 *
 * ## No `designChosen` flag beside it, and that is not an oversight
 *
 * `lockChosen` exists because `lock === 'openlock'` cannot be told from *never
 * opened the picker*, and the app has to know whether it still owes the user a
 * notice about a preference worth up to 40.2 percentage points of catalog reach.
 * `design` has no such ambiguity: the shipped default is **absent**, so the
 * field answers "has the user chosen?" by itself, and there is no notice to
 * suppress — a room with no design still fills every slot, which is C2's
 * fallback contract rather than a degraded state.
 *
 * A single action rather than a set/clear pair for the same reason: *no design*
 * is one of the picker's options and not the absence of a press, so it is one
 * value of one parameter. `undefined` is spelled rather than defaulted so a
 * caller cannot clear the room's design by forgetting an argument.
 */
export function setRoomDesign(design: string | undefined): void {
  /* `set` merges, so `{ design: undefined }` writes the key as `undefined` —
     which is what a reader sees as "no design", and what `JSON.stringify` then
     drops on the way to `localStorage`, so the rehydrated state and the live one
     agree. `migrations.ts#salvageDesign` reads an absent key the same way. */
  useWorkshopStore.setState({ design })
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

/**
 * The room-wide design, or `undefined` for no preference.
 *
 * A scalar, so every subscriber to it wakes only when the design itself moves —
 * the reason the store is read through selectors rather than whole.
 */
export const selectRoomDesign = (state: WorkshopState): string | undefined => state.design

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

/** The room-wide design as render state. `undefined` for no preference. */
export function useRoomDesign(): string | undefined {
  return useWorkshopStore(selectRoomDesign)
}
