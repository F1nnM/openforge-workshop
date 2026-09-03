/**
 * What to convert when an item joins the library — the tier policy, and the one
 * function the library action calls.
 *
 * ## Converting every variant is wrong, and the corpus says so loudly
 *
 * The obvious rule is "the user added a design, convert the design". Measured
 * over all 3,822 aggregates with the real `selectVariant`, per aggregate:
 *
 * | what gets converted | distinct meshes | median | p95 | max |
 * | --- | ---: | ---: | ---: | ---: |
 * | the lock-resolved variant | 1 | **11.3 MB** | 37.3 MB | 108.9 MB |
 * | every variant any lock can resolve to | mean 1.54, max **4** | 14.8 MB | 61.4 MB | 175.7 MB |
 * | every variant | mean 2.23, max **16** | 16.6 MB | 92.5 MB | **420.7 MB** |
 *
 * The third row is 1.35× the bytes of the second for **nothing a user can ever
 * see**: a design with 16 variants has at most 4 that any lock preference will
 * resolve to, because the other 12 differ only in print options the resolver
 * ranks below the lock. Converting them is 27 GB of egress corpus-wide to
 * populate cache entries nothing will read.
 *
 * That also corrects the shape of the tail. Variant count does not predict
 * download cost and is nearly anti-correlated with it: the 420.7 MB aggregate
 * (`d687ded3e16e7`, *Cut Stone Concave Curved Wall 4r90*) has **8** meshes, and
 * every one of the four 16-mesh aggregates is a *Plain Wall Base* totalling
 * **1.0–3.2 MB**. Aggregates with ten or more meshes have a median of 4.1 MB.
 * So the gate here is **bytes**, not variants.
 *
 * ## The three tiers
 *
 *   - **Eager** — the one variant `selectVariant` resolves under the current
 *     lock. This is the mesh the builder will draw, so it is what the add-to-
 *     library progress is waiting on: median 11.3 MB, about **1.4 s** at the
 *     7.65–9.22 MB/s measured against this bucket, plus 28–462 ms of conversion.
 *   - **Background** — the *other* lock-reachable variants, at most three more,
 *     so that changing the lock is instant rather than another download. Bounded
 *     by {@link MESH_BACKGROUND_BUDGET_BYTES}.
 *   - **Deferred** — everything the budget refused. Not converted, not queued,
 *     and not forgotten: it is converted if something actually resolves to it,
 *     which is what {@link ensureAggregateMeshes} does when the lock changes.
 *
 * At a 32 MB background budget, **94.1%** of aggregates get their whole
 * lock-reachable set prefetched and 224 defer some of it; 16 MB covers 83.9%,
 * 64 MB covers 99.4%. 32 MB was chosen because it caps the traffic one add can
 * generate in the background at about four seconds' worth, which is the point at
 * which a background download stops being invisible.
 *
 * ## The wiring, which belongs to another row
 *
 * Row **V1** owns `src/store/**` and is re-keying `library` from `TileId` to
 * `DesignId` as this row lands, so this module does not touch the store and does
 * not subscribe to it. The contract is one call:
 *
 * ```ts
 * import { ensureAggregateMeshes, meshQueue } from '@/mesh'
 *
 * // in the add-to-library action, after the state write:
 * void ensureAggregateMeshes(meshQueue(assets), aggregate, { lock })
 * ```
 *
 * `assets` is `catalogFile.assets` — `index.file.assets` at every existing call
 * site — and `lock` is `useLockSystem()`. The call returns a promise that
 * settles when the eager mesh is usable; a caller that only wants the state
 * writes can ignore it and read {@link useMeshQueue} instead.
 *
 * **What happens until it is wired, stated plainly:** nothing breaks and nothing
 * draws. `loadMeshGeometry` asks `/lod/`, gets a 404, asks the cache, finds
 * nothing, and reports the mesh as absent — which is `BuilderRoom`'s existing
 * "*n* of *m* not in the store" state, unchanged from before this row. There is
 * deliberately **no render-time conversion**: the owner replaced that design
 * because it puts a 64 MB download behind the moment the 3D view opens, with
 * nowhere to show progress and no way to tell a slow room from a broken one.
 */
import { useMemo, useSyncExternalStore } from 'react'

import type { BlobId, CatalogAssets, DesignId, TileAggregate } from '@/catalog'
import { selectVariant, variantsByPreference } from '@/catalog'
import { PRINT_OPTIONS } from '@/assembly'
import { LockSystem } from '@/store/schema'

import type { MeshQueue, MeshQueueState, MeshRequest } from './queue'
import { createMeshQueue } from './queue'

/**
 * Background bytes one add may spend per aggregate. 32 MB.
 *
 * See the module note for what each threshold covers. It bounds the *background*
 * tier only: the eager mesh is always converted however large it is, because the
 * alternative is an item in the library the builder cannot draw.
 */
export const MESH_BACKGROUND_BUDGET_BYTES = 32 * 1024 * 1024

/** The three lock systems, from the store's own enum so they cannot drift. */
export const LOCK_SYSTEMS: readonly string[] = LockSystem.options

/** What one aggregate's add-to-library would convert, split by tier. */
export interface MeshPlan {
  /** The lock-resolved variant. Exactly one, always. */
  readonly eager: readonly MeshRequest[]
  /** Other lock-reachable variants, inside the budget. */
  readonly background: readonly MeshRequest[]
  /** Lock-reachable variants the budget refused. Converted on demand instead. */
  readonly deferred: readonly MeshRequest[]
  /** Variants no lock preference resolves to. Never converted by this row. */
  readonly unreachable: readonly BlobId[]
}

export interface MeshPlanOptions {
  /** The build's lock preference — `useLockSystem()`. */
  readonly lock?: string | undefined
  readonly budget?: number
}

/**
 * Which of an aggregate's meshes to convert, and in which tier.
 *
 * Pure, so the policy can be argued with in a test rather than observed in a
 * network tab. It calls `selectVariant`/`variantsByPreference` from
 * `src/catalog/aggregate.ts` and **does not reimplement them** — the ranking
 * that decides which variant a lock resolves to is A6's, row V5 is editing that
 * file, and a second copy of the rule here would be the exact divergence the
 * aggregate row exists to prevent.
 */
export function planAggregateMeshes(aggregate: TileAggregate, options: MeshPlanOptions = {}): MeshPlan {
  const budget = options.budget ?? MESH_BACKGROUND_BUDGET_BYTES
  const preference = { options: PRINT_OPTIONS, ...(options.lock === undefined ? {} : { bottom: options.lock }) }

  const chosen = selectVariant(aggregate, preference).variant
  const eager: MeshRequest[] = [{ blob: chosen.blob, bytes: chosen.bytes, tier: 'eager' }]

  // Every variant any lock choice could land on, plus the no-preference answer
  // — which is what a user who has never opened the lock picker sees.
  const reachable = new Map<BlobId, number>()
  for (const lock of [...LOCK_SYSTEMS, undefined]) {
    const variant = selectVariant(aggregate, {
      options: PRINT_OPTIONS,
      ...(lock === undefined ? {} : { bottom: lock }),
    }).variant
    reachable.set(variant.blob, variant.bytes)
  }
  reachable.delete(chosen.blob)

  // Smallest first, so a tight budget buys the most states.
  const ordered = [...reachable].sort((a, b) => (a[1] !== b[1] ? a[1] - b[1] : a[0] < b[0] ? -1 : 1))
  const background: MeshRequest[] = []
  const deferred: MeshRequest[] = []
  let spent = 0
  for (const [blob, bytes] of ordered) {
    if (spent + bytes <= budget) {
      background.push({ blob, bytes, tier: 'background' })
      spent += bytes
    } else {
      deferred.push({ blob, bytes, tier: 'background' })
    }
  }

  const unreachable = variantsByPreference(aggregate, preference)
    .map((variant) => variant.blob)
    .filter((blob) => blob !== chosen.blob && !reachable.has(blob))

  return { eager, background, deferred, unreachable: [...new Set(unreachable)] }
}

/**
 * Convert what this aggregate needs. **The interface the library action calls.**
 *
 * Resolves when the eager mesh is in the cache and the 3D view can draw the
 * item; the background tier keeps running past it. Safe to call again with a
 * different lock — the queue collapses blobs it already holds, so a lock change
 * costs only the meshes the new lock reaches that the old one did not, and a
 * previously deferred variant is promoted to eager at that point.
 */
export function ensureAggregateMeshes(
  queue: MeshQueue,
  aggregate: TileAggregate,
  options: MeshPlanOptions = {},
): Promise<void> {
  const plan = planAggregateMeshes(aggregate, options)
  return queue.request([...plan.eager, ...plan.background])
}

/**
 * The same, addressed by design id — which is the key row V1 is moving the
 * library to, so this is the overload V1 and V2 will actually reach for.
 *
 * `byDesign` is `AggregateIndex.byDesign`. An unknown design resolves without
 * queueing anything rather than throwing: a library entry for a design the
 * current catalog no longer carries is a real state (`transfer.ts` restores a
 * backup written against an older index) and it must not break the add path.
 */
export function ensureDesignMeshes(
  queue: MeshQueue,
  byDesign: ReadonlyMap<DesignId, TileAggregate>,
  design: DesignId,
  options: MeshPlanOptions = {},
): Promise<void> {
  const aggregate = byDesign.get(design)
  if (aggregate === undefined) return Promise.resolve()
  return ensureAggregateMeshes(queue, aggregate, options)
}

/* -------------------------------------------------------------- the singleton */

let shared: { queue: MeshQueue; models: string } | null = null

/**
 * The app's one queue, created on first use.
 *
 * A module singleton rather than a React context, for the reason
 * `src/store/meshes.ts` gives for its own store: the add-to-library actions are
 * plain imported functions called from event handlers in five different screens,
 * and a context would force every one of them to become a hook. Keyed on
 * `assets.models` so a test — or a future second catalog — gets its own queue
 * instead of silently reusing one pointed at another bucket.
 */
export function meshQueue(assets: Pick<CatalogAssets, 'models'>): MeshQueue {
  if (shared !== null && shared.models === assets.models) return shared.queue
  shared?.queue.dispose()
  shared = { queue: createMeshQueue({ assets }), models: assets.models }
  return shared.queue
}

/** Drop the shared queue. For tests, and for a "clear cached meshes" action. */
export function resetMeshQueue(): void {
  shared?.queue.dispose()
  shared = null
}

/* -------------------------------------------------------------------- the hook */

/**
 * Subscribe a component to conversion progress.
 *
 * `useSyncExternalStore` rather than `useState` in an effect, because the queue
 * is written to from event handlers outside React and a torn read here would
 * render a progress bar that disagrees with itself. The queue's snapshot is
 * immutable and its identity is stable until something changes, which is exactly
 * what this hook requires.
 */
export function useMeshQueue(queue: MeshQueue): MeshQueueState {
  // Bound through `useMemo` rather than passed as method references: the lint
  // rule against unbound methods is right in general, and `useSyncExternalStore`
  // resubscribes whenever `subscribe`'s identity changes — so a fresh arrow per
  // render would tear the subscription down and rebuild it on every state
  // change, which is the bug the rule's fix would otherwise introduce here.
  const subscribe = useMemo(() => (listener: () => void) => queue.subscribe(listener), [queue])
  const snapshot = useMemo(() => () => queue.state(), [queue])
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
