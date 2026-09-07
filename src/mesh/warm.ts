/**
 * The other end of the tier policy's contract: **who calls
 * `ensureSceneMeshes`.**
 *
 * `tiers.ts` ships the policy and this module is its one call site. That the
 * call site exists at all is load bearing rather than tidy: with `/lod/` still
 * on blocker **B7** and no conversion triggered, `ensureSceneMeshes` has **zero
 * call sites** and the 3D builder draws a footprint plate for every tile in
 * every room. That was the documented pre-wiring state, and it is the state this
 * module exists to keep the app out of.
 *
 * ## The trigger is the **scene**, and it used to be the library
 *
 * The previous version of this module reconciled on `(library, lock)`: the user
 * kept items, and keeping an item is what asked for its mesh. Row A0 deleted the
 * library screen and row A1 deleted the field, so that trigger has no input
 * left. The replacement is `(placements, lock)`, and it is a *better* trigger
 * rather than a forced one — because "what does the room need drawn" was always
 * the real question and library membership was a proxy for it.
 *
 * **It fixes a live defect as a side effect, and this is that confirmation.**
 * `PalettePanel.tsx#arm` sets `tools.setSelectedDesign(item.design)` and
 * `tools.setTool('place')` and *never adds to the library* — verified by reading
 * it. So on the old trigger, arming a palette row and placing it warmed nothing:
 * the placement's mesh was requested only if that design happened to already be
 * in the library, and the room reported the tile as "not in the store"
 * indefinitely. Placements being the trigger closes it, because the placement
 * itself is now the request.
 *
 * ## Four moments, and the fourth is new
 *
 *   1. **A template is placed.** Both a placement hook and this reconciliation
 *      handle it.
 *   2. **The app loads with a saved room.** No placement happens, so a placement
 *      hook fires never. The cache is IndexedDB and survives a reload, so this
 *      is *usually* free — but the exceptions are real:
 *      `MESH_CACHE_BUDGET_BYTES` evicts, a private window starts empty, and
 *      `transfer.ts` restores a backup written on another machine.
 *   3. **The lock preference changes.** After A1 that is a *re-solve* rather
 *      than a re-ranking: `setLockSystem` writes the preference and C2 walks
 *      every instance's slots calling `fillSlot`, which rewrites the `auto`
 *      fills and refuses the `pinned` ones. So the blob set moves **through
 *      `placements`**, and the `lock` half of the diff is a hedge rather than
 *      the mechanism — see the note on the subscription below.
 *   4. **A share link lands placements that were never converted locally.** The
 *      old trigger could not see this at all: a share link writes `placements`
 *      and never touched `library`, so a room opened from a link drew nothing
 *      until the user happened to save one of its items. This is the moment the
 *      move to the scene adds, and it is the common case for a link.
 *
 * ## Derive the set and compare it — a drag must not re-walk the room
 *
 * Every store write reaches a Zustand listener and a drag is hundreds of them,
 * so the old module diffed its two slices with one `===` each and warned that
 * reconciling on every write would walk the whole library per pointer press.
 * That warning was right and it does **not** transfer, because `placements` is
 * now written by every move, rotate and fill: an identity check on the slice is
 * no longer a proxy for "the set of meshes changed".
 *
 * So the diff is on the derived set. {@link sceneTiles} is the derivation and it
 * is deliberately over **files, not blobs**: the file set is a function of the
 * store alone, so a drag is answered synchronously and the 5.6 MB catalog index
 * is never resolved to answer it, whereas a blob set needs
 * `AggregateIndex.byTile` and therefore the index. The two are equivalent as a
 * change detector — the catalog is a version-stamped build artefact that cannot
 * change under a running session, so the same files always map to the same blobs
 * — and the file set is the conservative side of the equivalence: it can only
 * over-report, and an over-report costs a walk over an in-memory `Map` because
 * `queue.request` is idempotent.
 *
 * Measured over the 40 shipped templates, solved with the real
 * `resolvePart`/`selectVariant`: a 20-instance room is **62 fills reaching 23
 * distinct blobs**. So the comparison is over about sixty short strings, and a
 * drag of one instance changes none of them.
 *
 * ## Armed once, in `src/App.tsx`, behind a dynamic import
 *
 * There is exactly one place in this app that is mounted for every screen and
 * owns no feature, and that is `App`. The import is dynamic for the reason
 * `Builder3DPanel` gives for its own: a static import there would put `@/mesh`,
 * `@/assembly` and the aggregate builder in the **entry** chunk, where they
 * block first paint on the landing screen and the catalog — and warming is by
 * definition deferrable, since nothing in the first frame waits on it. Nothing
 * eager imports this module, and `boundary.test.ts` asserts both halves.
 *
 * {@link meshContext} is resolved **only when the scene names a file**, so a
 * first-time visitor with an empty room never triggers the derivation and never
 * pays the catalog fetch on a screen that did not want one.
 */
import type { CatalogAssets, TileId } from '@/catalog'
import type { WorkshopState } from '@/store'
import { filledSlots, useWorkshopStore } from '@/store'

import { meshContext } from './context'
import type { MeshQueue } from './queue'
import { ensureSceneMeshes, meshQueue } from './tiers'

/**
 * Every catalog file the scene's filled slots name, deduplicated.
 *
 * **This is contract C-d**, and it is stated here as the derivation
 * `BuilderRoom`'s own blob set has to match. Mapped through
 * `AggregateIndex.byTile`, the result is exactly the room's set of placed
 * geometry, minus the *armed* ghost — which is not a placement and so is not in
 * the store at all, and which the room must therefore add for itself. A
 * disagreement between the two renders as the room's "*n* of *m* not in the
 * store" plate, a message it also shows legitimately for the `/lod/` backfill
 * blocker, so a divergence here is invisible rather than loud.
 *
 * Three states are skipped rather than reported, and every one of them is a
 * design state rather than a defect:
 *
 *   - **An unfilled slot.** `placeTemplate` accepts an incomplete `fills` map by
 *     design — §3.2's "places anyway", contract **C-g** — so an absent key is an
 *     ordinary state of an instance. `filledSlots` yields present keys only, and
 *     the `undefined` guard covers the `noUncheckedIndexedAccess` read that
 *     follows it.
 *   - **An instance with no fills at all.** It contributes nothing, and if the
 *     whole scene is like that the caller resolves no catalog.
 *   - **A generated base.** `state.generated` is a second map in the same id
 *     space and its pieces are *not in the catalog*: no design, no aggregate, no
 *     blob. Its mesh is generated and held un-persisted in `store/meshes.ts`, so
 *     there is nothing here for this queue to fetch. Walking it would be looking
 *     up ids that cannot resolve.
 *
 * Reading the map through {@link filledSlots} rather than `Object.values` is
 * `schema.ts`'s rule, not a flourish: a Zod brand is dropped in key position, so
 * the array is the safe crossing and the map is not.
 */
export function sceneTiles(placements: WorkshopState['placements']): readonly TileId[] {
  const tiles = new Set<TileId>()
  for (const instance of Object.values(placements)) {
    for (const slot of filledSlots(instance.fills)) {
      const fill = instance.fills[slot]
      if (fill === undefined) continue
      tiles.add(fill.tile)
    }
  }
  return [...tiles]
}

/** Two file sets name the same meshes. The short-circuit's whole test. */
function sameTiles(a: readonly TileId[], b: readonly TileId[] | null): boolean {
  if (b === null || a.length !== b.length) return false
  const held = new Set(b)
  return a.every((tile) => held.has(tile))
}

export interface WarmingOptions {
  /**
   * How the queue is obtained. Injected by tests so no request leaves the
   * process — the same seam `BuilderRoom`'s `fetchImpl` is.
   *
   * The default is `@/mesh`'s own singleton per `models` base, which is the very
   * same object `BuilderRoom` subscribes to for its progress readout. That
   * sharing is the point: a conversion started here is what makes the room's
   * "converting *n* meshes…" plate true.
   */
  readonly queueFor?: (assets: Pick<CatalogAssets, 'models'>) => MeshQueue
}

/**
 * Subscribe the mesh queue to the builder scene. Returns the unsubscribe.
 *
 * Idempotent to arm twice — a second call is a second subscription over the same
 * idempotent queue — which is what makes it safe under `StrictMode`, where an
 * effect is mounted, torn down and mounted again on purpose.
 *
 * Failures are warned once per reconcile and never thrown: this runs detached
 * from any render, so an unhandled rejection here would surface as a console
 * error with no stack the user could act on, and the app is entirely usable with
 * cold meshes — every tile is still real, still placeable and still in the bill.
 * Contract **C-a** lands inside that catch: a fill naming a file this catalog
 * build no longer holds is reported by `planSceneMeshes` as `unresolved` and
 * skipped, so it can never be the thing that throws.
 */
export function startSceneWarming(options: WarmingOptions = {}): () => void {
  const queueFor = options.queueFor ?? meshQueue
  let live = true
  /** The file set last committed to a reconcile. `null` until the first one. */
  let warmed: readonly TileId[] | null = null
  /** The lock the last reconcile ran under; see the subscription note. */
  let warmedLock: WorkshopState['lock'] | null = null

  const reconcile = (state: WorkshopState): void => {
    const tiles = sceneTiles(state.placements)
    // Nothing filled: do not resolve the context, and therefore do not fetch the
    // 5.6 MB index on a screen that had no reason to want one. An empty room and
    // a room of wholly unfilled instances are the same answer here.
    if (tiles.length === 0) return
    if (state.lock === warmedLock && sameTiles(tiles, warmed)) return

    // Committed *before* the await, so the writes a single drag emits while the
    // catalog is still resolving collapse onto this one reconcile instead of
    // queueing one derivation each.
    warmed = tiles
    warmedLock = state.lock
    void meshContext()
      .then(async (context) => {
        if (!live) return
        await ensureSceneMeshes(queueFor(context.file.assets), tiles, context.aggregates)
      })
      .catch((cause: unknown) => {
        // Released, so the next store write retries rather than the session
        // being stuck cold behind one failed index fetch.
        if (warmed === tiles) {
          warmed = null
          warmedLock = null
        }
        console.warn('[openforge-workshop] the room could not be converted for the 3D view', cause)
      })
  }

  reconcile(useWorkshopStore.getState())

  const unsubscribe = useWorkshopStore.subscribe((now, before) => {
    // `placements` is written by every move, rotate and fill, so unlike the
    // library slice it was replaced for, an identity check on it is *not* a
    // proxy for "the meshes changed" — which is why the real diff is the derived
    // file set inside `reconcile` and this is only a cheap pre-filter.
    //
    // `lock` is in the filter although `planSceneMeshes` is lock-free: a fill
    // names an exact file, so the plan does not consult the preference and a
    // lock-only write is a reconcile the file-set short-circuit collapses to
    // nothing. It is kept because a lock change is a *two-step* — the preference
    // is written, then C2's walk rewrites the fills — and the cost of covering
    // the intermediate state is one `===` and one comparison of sixty strings.
    if (now.placements === before.placements && now.lock === before.lock) return
    reconcile(now)
  })

  return () => {
    live = false
    unsubscribe()
  }
}
