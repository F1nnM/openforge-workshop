/**
 * What a share link carries: the builder scene, and nothing else.
 *
 * ## An ordered list, not the store's keyed map
 *
 * `WorkshopState.placements` is a map keyed by `PlacementId`, and PR 5's docblock
 * explains why — a map makes "move the tile being dragged" a single-key write and
 * leaves the door open to collaborative editing. Those keys are UUIDs. Putting
 * them on the wire would cost 16 bytes per placement against the ~6 the placement
 * itself costs, cutting capacity by roughly three quarters to transmit identities
 * that mean nothing outside the browser that generated them.
 *
 * So a shared scene is an **ordered list**, and the receiving app mints fresh ids:
 *
 * ```ts
 * const decoded = await decodeShareFragment(location.hash, manifest)
 * if (decoded.ok) {
 *   clearPlacements()
 *   setLockSystem(decoded.scene.lock)
 *   for (const placement of decoded.scene.placements) placeTile(placement)
 * }
 * ```
 *
 * That is PR 18's three lines, deliberately not wrapped in a function here: the
 * store's write path is synchronous and PR 5 keeps it that way on purpose, so the
 * `await` belongs at the call site where the caller can see it, not hidden behind
 * an `applyScene()` that looks synchronous and is not.
 *
 * ## The library is not in the link
 *
 * `WorkshopState` also holds the library — the tiles a user kept. A share link is
 * "here is the room I built", not "here is my bookmark list", and the library is
 * the one part of the state that is personal rather than about the artefact. It
 * also costs a full `TileId` per entry, since a library tile has no placement to
 * amortise an ordinal against. JSON export (`src/store/transfer.ts`) is the path
 * that carries everything.
 *
 * The facet state is likewise absent. `src/search/searchSchema.ts` already encodes
 * that into the **query string**, and this module owns the **fragment**; a link
 * built by the builder therefore carries both, each in its own half of the URL,
 * with one owner apiece.
 */
import type { LockSystem, Placement, WorkshopState } from '@/store'
import { DEFAULT_LOCK_SYSTEM } from '@/store'

/** A builder scene as a link carries it. */
export interface SharedScene {
  /**
   * The lock preference, travelling with the link.
   *
   * Not optional and not defaulted at the receiving end, because §2 makes this the
   * choice that decides which concrete STL each placed design resolves to: the
   * same scene under `openlock` and under `magnetic` is a different download pack,
   * and 40.2 percentage points of the catalog are reachable under one and not the
   * other. A link that dropped it would open as a different build for a recipient
   * whose own preference differs.
   */
  readonly lock: LockSystem
  /** Placements in a stable order. Ids are minted by the receiver — see the module docblock. */
  readonly placements: readonly Placement[]
}

/**
 * Project the persisted state onto a shareable scene.
 *
 * Takes the state as an argument rather than reading the store, so the codec stays
 * headless and testable in a node environment. `Object.values` preserves the map's
 * insertion order, which is placement order, so two shares of one scene produce
 * the same link.
 */
export function sharedSceneFromState(state: WorkshopState): SharedScene {
  return { lock: state.lock, placements: Object.values(state.placements) }
}

/** An empty scene at the default lock — what a link with no placements decodes to. */
export function emptySharedScene(): SharedScene {
  return { lock: DEFAULT_LOCK_SYSTEM, placements: [] }
}
