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
 *     `useStore((s) => s.addToLibrary)` is a subscription; an imported function
 *     is not, so a component that only *writes* never re-renders.
 *   - **Non-React callers work unchanged.** The share codec and the download
 *     builder read this store from plain modules.
 *
 * **Re-render granularity** (the reason the selectors below are shaped as they
 * are): every exported selector returns either a primitive or a state slice that
 * is replaced only when that slice changes. Zustand compares with `Object.is`,
 * so a selector that builds a new array or object on each call re-renders its
 * component on *every* store write — placing a tile would then re-render the
 * catalog grid. Concretely: a catalog card subscribes through
 * {@link useIsInLibrary}, whose value is a boolean derived from `library`, so
 * the two hundred writes of a drag across the grid touch `placements` only and
 * the card never re-renders.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { TileId } from '@/catalog'
import type { GeneratedBaseId, GeneratedPlacement } from '@/generator/placement/scene'
import { GeneratedPlacement as GeneratedPlacementSchema } from '@/generator/placement/scene'

import { clearGeneratedMeshes, retainGeneratedMeshes } from './meshes'
import type { RecoveredState } from './migrations'
import { STORE_VERSION, migrateWorkshopState, salvageWorkshopState } from './migrations'
import type { LockSystem, Placement, PlacementId, WorkshopState } from './schema'
import { Placement as PlacementSchema, PlacementId as PlacementIdSchema, defaultWorkshopState, normalizeRotation } from './schema'
import { STORAGE_KEY, clearPersistedWorkshopState, workshopStorage } from './storage'

/**
 * Say out loud what recovery discarded.
 *
 * Silent salvage is the failure mode this whole module exists to avoid: a user
 * whose room quietly comes back one tile short has no way to tell that from
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
 * and the migration has to guess at its shape.
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
 * the one most likely to occur. The two do not double-report: `migrate` returns
 * an already-valid state, so the `merge` that follows it salvages nothing.
 */
export const useWorkshopStore = create<WorkshopState>()(
  persist(() => defaultWorkshopState(), {
    name: STORAGE_KEY,
    version: STORE_VERSION,
    storage: workshopStorage,
    migrate: (persisted, version) => reportRecovery(migrateWorkshopState(persisted, version), 'migration'),
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

/* ------------------------------------------------------------------- library */

/**
 * Add a tile to the library. Idempotent, and a no-op returns the identical state
 * object so subscribers are not woken for a click that changed nothing.
 */
export function addToLibrary(id: TileId): void {
  useWorkshopStore.setState((state) =>
    state.library[id] === true ? state : { library: { ...state.library, [id]: true } },
  )
}

/** Remove a tile from the library. No-op if it was never there. */
export function removeFromLibrary(id: TileId): void {
  useWorkshopStore.setState((state) => {
    if (state.library[id] === undefined) return state
    const library = { ...state.library }
    delete library[id]
    return { library }
  })
}

/** Add or remove, whichever the tile is not. */
export function toggleLibrary(id: TileId): void {
  useWorkshopStore.setState((state) => {
    if (state.library[id] === undefined) return { library: { ...state.library, [id]: true } }
    const library = { ...state.library }
    delete library[id]
    return { library }
  })
}

/** Empty the library. Placements are untouched — they are a separate decision. */
export function clearLibrary(): void {
  useWorkshopStore.setState({ library: {} })
}

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
 * Put a tile on the grid and return its key.
 *
 * Parsed on the way in, which is not redundant with the rehydrate check: this
 * catches a bad value at the call that produced it, where the stack still names
 * the culprit, instead of at a hydration months later where it looks like
 * storage corruption.
 */
export function placeTile(placement: Placement): PlacementId {
  const id = newPlacementId()
  const validated = PlacementSchema.parse({ ...placement, rotation: normalizeRotation(placement.rotation) })
  useWorkshopStore.setState((state) => ({ placements: { ...state.placements, [id]: validated } }))
  return id
}

/** Move a placed tile. No-op if the key is unknown, which a stale drag can be. */
export function movePlacement(id: PlacementId, x: number, z: number): void {
  useWorkshopStore.setState((state) => {
    const current = state.placements[id]
    if (current === undefined) return state
    const moved = PlacementSchema.parse({ ...current, x, z })
    return { placements: { ...state.placements, [id]: moved } }
  })
}

/** Rotate a placed tile. The angle is folded into `[0, 360)`; see the schema. */
export function rotatePlacement(id: PlacementId, rotation: number): void {
  useWorkshopStore.setState((state) => {
    const current = state.placements[id]
    if (current === undefined) return state
    const rotated = { ...current, rotation: normalizeRotation(rotation) }
    return { placements: { ...state.placements, [id]: rotated } }
  })
}

/** Take a tile off the grid. */
export function removePlacement(id: PlacementId): void {
  useWorkshopStore.setState((state) => {
    if (state.placements[id] === undefined) return state
    const placements = { ...state.placements }
    delete placements[id]
    return { placements }
  })
}

/** Clear the builder scene, keeping the library and the lock preference. */
export function clearPlacements(): void {
  useWorkshopStore.setState({ placements: {}, generated: {} })
  // Every hold is now orphaned. `retainGeneratedMeshes(new Set())` would say the
  // same thing; this is the one call site where "keep nothing" is the whole
  // answer, so it says so directly.
  clearGeneratedMeshes()
}

/* ----------------------------------------------------------- generated bases */

/**
 * Put a generated base on the grid and return its key.
 *
 * The mirror of {@link placeTile}, and deliberately a *separate* action over a
 * separate map rather than a widened one: `Placement.tileId` is a `TileId` and
 * row S5's whole identity argument rests on a generated base not being able to
 * produce a string in that space. The `PlacementId` space *is* shared, which is
 * what lets one id name a piece on the plan whichever map holds it.
 *
 * Parsed on the way in for {@link placeTile}'s reason — a bad value fails at the
 * call that produced it, where the stack still names the culprit, rather than at
 * a hydration months later where it looks like storage corruption. The schema
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
 * Placements are untouched. Changing the lock system does not invalidate a
 * scene: `@/assembly` treats lock as a weighted preference over base matching
 * (`MATCH_WEIGHTS.lock`), not a filter, so switching re-resolves the bill of
 * tiles and may add `base-lock-mismatch` or `lock-unavailable` warnings to
 * placements that no longer line up. Nothing is removed from the grid.
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
 * Wipe everything — state and the persisted copy both.
 *
 * `replace: true` rather than a merge, so a field removed in a future version
 * cannot survive a reset.
 */
export function resetWorkshop(): void {
  useWorkshopStore.setState(defaultWorkshopState(), true)
  clearGeneratedMeshes()
}

/* ----------------------------------------------------------------- selectors */

/** The library as a keyed set. Stable identity until the library changes. */
export const selectLibrary = (state: WorkshopState): WorkshopState['library'] => state.library

/** How many tiles are in the library. A number, so equal counts do not re-render. */
export const selectLibraryCount = (state: WorkshopState): number => Object.keys(state.library).length

/**
 * Membership for one tile.
 *
 * Curried so the tile id is bound once: the resulting selector returns a
 * boolean, which is what keeps eight thousand catalog cards out of the
 * re-render path when an unrelated tile is added.
 */
export const selectIsInLibrary =
  (id: TileId) =>
  (state: WorkshopState): boolean =>
    state.library[id] === true

/** The whole scene. Changes on every placement — subscribe from the canvas only. */
export const selectPlacements = (state: WorkshopState): WorkshopState['placements'] => state.placements

/** One placement, for a component that renders exactly one tile. */
export const selectPlacement =
  (id: PlacementId) =>
  (state: WorkshopState): Placement | undefined =>
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
 * How many tiles are on the grid.
 *
 * Catalog placements only, and deliberately: this is the header's `{n} tiles
 * placed` chip and the toolbar's count, both of which are about tiles from the
 * archive. A generated base is counted in the generated bill's own line, which
 * says what it is.
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

/** @see selectLibrary */
export function useLibrary(): WorkshopState['library'] {
  return useWorkshopStore(selectLibrary)
}

/** @see selectLibraryCount */
export function useLibraryCount(): number {
  return useWorkshopStore(selectLibraryCount)
}

/** @see selectIsInLibrary */
export function useIsInLibrary(id: TileId): boolean {
  return useWorkshopStore((state) => state.library[id] === true)
}

/** @see selectPlacements */
export function usePlacements(): WorkshopState['placements'] {
  return useWorkshopStore(selectPlacements)
}

/** @see selectPlacement */
export function usePlacement(id: PlacementId): Placement | undefined {
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
