/**
 * The other end of row R1's contract: **who calls `ensureAggregateMeshes`.**
 *
 * `library.ts` shipped the policy and said the wiring *"belongs to another row"*,
 * and stated plainly what happens until it lands — *"nothing breaks and nothing
 * draws"*. That was measured, not feared: with `/lod/` still on blocker **B7**
 * and no conversion ever triggered, `ensureAggregateMeshes` had **zero call
 * sites**, so the 3D builder drew a footprint plate for every tile in every room.
 * This module is the call site.
 *
 * ## A reconciliation, not an event — and the difference is three bugs
 *
 * Row V1 made `addToLibrary` return whether it inserted and offered two
 * attachment points: the call site (five of them) or a store subscription
 * diffing `library`. Neither is quite what the queue wants, because *"warm the
 * item that was just added"* answers only one of the three moments a mesh can be
 * missing:
 *
 *   1. **An item is added.** Both designs handle it.
 *   2. **The app loads with a library already in it.** No insertion happens, so
 *      an insert hook fires never. The cache is IndexedDB and survives a reload,
 *      so this is *usually* free — but not always, and the exceptions are real:
 *      `MESH_CACHE_BUDGET_BYTES` evicts, a private window starts empty, and
 *      `transfer.ts` restores a backup written on another machine.
 *   3. **The lock preference changes.** R1's tiering is *per lock* — 1,419 of
 *      3,822 items (37.1%) resolve to a different file under a different
 *      preference — and, since this row, so is the **base**: 84 distinct base
 *      blobs under openlock against 111 under dragonlock. An insert hook fires
 *      never here either, and the room would draw last preference's meshes.
 *
 * So this subscribes to `(library, lock)` and warms **the whole set** whenever
 * either changes. That is affordable only because the queue is idempotent —
 * `MeshQueue.request` collapses a blob it already holds, in flight or `ready`,
 * and promotes a background blob asked for as eager rather than duplicating it —
 * so a reconcile over an unchanged library is a walk over an in-memory `Map` and
 * costs no bytes at all. The first reconcile of a warm session is the same walk
 * plus one `have()` per blob, which reads keys and never geometry.
 *
 * A listener registry in the store was considered and V1 declined to build one
 * as *"speculative machinery for a consumer that does not exist"*. It still is:
 * this consumer needs no registry, because Zustand's own `subscribe` already
 * hands it the previous state and one `===` on a slice is the whole diff.
 *
 * ## The base is warmed too, and that is this row's correction to R1
 *
 * `planAggregateMeshes` plans an aggregate's **own** lock-reachable variants.
 * Under openlock 1,878 of 3,822 items also require an auto-inserted base, which
 * is a different design with a different blob, so R1's plan alone leaves the one
 * part row **R3** was asked to make visible permanently absent. The base is
 * requested `eager` beside the topper, and it is cheap: median **0.91 MB**
 * against the median tile's 10.77 MB, 3,826 triangles, and only **84 distinct
 * blobs across the whole corpus** under openlock, so a room of twenty designs
 * shares two or three of them. The queue sorts eager requests ascending by bytes,
 * so the base — being the smaller half of the assembly — arrives first without
 * anything here asking it to.
 *
 * ## Armed once, in `src/App.tsx`, behind a dynamic import
 *
 * There is exactly one place in this app that is mounted for every screen and
 * owns no feature, and that is `App`. The import is dynamic for the reason
 * `Builder3DPanel` gives for its own: a static import here would put `@/mesh`,
 * `@/assembly` and the aggregate builder in the **entry** chunk, where they
 * block first paint on the landing screen and the catalog — and warming is by
 * definition deferrable, since nothing in the first frame waits on it. Nothing
 * eager imports this module, and the A/B in this row's PR shows the entry chunk
 * unchanged to the byte.
 *
 * {@link meshContext} is resolved **only when there is something to warm**, so a
 * first-time visitor with an empty library never triggers the derivation and
 * never pays the catalog fetch on a screen that did not want one.
 */
import type { BlobId, CatalogAssets, DesignId } from '@/catalog'
import type { LockSystem, WorkshopState } from '@/store'
import { libraryDesigns, useWorkshopStore } from '@/store'

import type { MeshContext } from './context'
import { autoInsertedBase, meshContext } from './context'
import { ensureDesignMeshes, meshQueue } from './library'
import type { MeshQueue, MeshRequest } from './queue'

/**
 * Warm one set of saved items, and the bases rule 1 puts under them.
 *
 * Resolves when every **eager** mesh in the set has reached a terminal state —
 * the topper of each item and, where there is one, its base. The background tier
 * keeps running past it. Total: an item this catalog build no longer holds
 * queues nothing rather than throwing, which is `ensureDesignMeshes`'s own
 * documented behaviour and a state `transfer.ts` can produce.
 */
export async function warmDesigns(
  queue: MeshQueue,
  context: MeshContext,
  designs: readonly DesignId[],
  lock: LockSystem | undefined,
): Promise<void> {
  const bases: MeshRequest[] = []
  const seen = new Set<BlobId>()
  for (const design of designs) {
    const base = autoInsertedBase(design, context.assembly, lock)
    if (base === undefined || seen.has(base.record.blob)) continue
    seen.add(base.record.blob)
    // `eager`, not `background`: an item drawn without its base is a topper
    // hovering over a plate, which is the picture this row exists to remove. It
    // is the cheaper half of the assembly anyway.
    bases.push({ blob: base.record.blob, bytes: base.record.bytes, tier: 'eager' })
  }

  await Promise.all([
    ...(bases.length === 0 ? [] : [queue.request(bases)]),
    ...designs.map((design) => ensureDesignMeshes(queue, context.aggregates.byDesign, design, { lock })),
  ])
}

/**
 * How many distinct base blobs a set of saved items would pull in.
 *
 * Exported because it is the honest way to state this row's added download in a
 * UI or a test — the *distinct* count, not one per item. Under openlock the whole
 * corpus reaches 84 of them, so any real library reaches a handful.
 */
export function baseBlobsFor(
  context: MeshContext,
  designs: readonly DesignId[],
  lock: LockSystem | undefined,
): readonly BlobId[] {
  const blobs = new Set<BlobId>()
  for (const design of designs) {
    const base = autoInsertedBase(design, context.assembly, lock)
    if (base !== undefined) blobs.add(base.record.blob)
  }
  return [...blobs]
}

/**
 * Subscribe the mesh queue to the library. Returns the unsubscribe.
 *
 * Idempotent to arm twice — a second call is a second subscription over the same
 * idempotent queue — which is what makes it safe under `StrictMode`, where an
 * effect is mounted, torn down and mounted again on purpose.
 *
 * Failures are warned once per reconcile and never thrown: this runs detached
 * from any render, so an unhandled rejection here would surface as a console
 * error with no stack the user could act on, and the app is entirely usable with
 * cold meshes — every tile is still real, still placeable and still in the bill.
 */
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

export function startLibraryWarming(options: WarmingOptions = {}): () => void {
  const queueFor = options.queueFor ?? meshQueue
  let live = true

  const reconcile = (state: WorkshopState): void => {
    const designs = libraryDesigns(state.library)
    // Nothing saved: do not resolve the context, and therefore do not fetch the
    // 5.6 MB index on a screen that had no reason to want it.
    if (designs.length === 0) return
    const lock = state.lock
    void meshContext()
      .then(async (context) => {
        if (!live) return
        await warmDesigns(queueFor(context.file.assets), context, designs, lock)
      })
      .catch((cause: unknown) => {
        console.warn('[openforge-workshop] saved items could not be converted for the 3D view', cause)
      })
  }

  reconcile(useWorkshopStore.getState())

  const unsubscribe = useWorkshopStore.subscribe((now, before) => {
    // Every store write reaches this listener — placing a tile is one — and a
    // reconcile per placement would walk the whole library on every pointer
    // press. Both slices are replaced by identity when they change, which is the
    // property `workshopStore.ts`'s re-render note is built on, so one `===`
    // each is the exact diff.
    if (now.library === before.library && now.lock === before.lock) return
    reconcile(now)
  })

  return () => {
    live = false
    unsubscribe()
  }
}
