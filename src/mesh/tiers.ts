/**
 * What to convert for a **scene**, and in which tier — the conversion tier
 * policy, and the one function the warmer calls.
 *
 * Was `library.ts`, and the rename is not cosmetic. This module never held the
 * user library: it held the *tier policy*, and one reader has already taken the
 * filename to mean it held the library's state. Row A0 deleted the library and
 * row A1 deleted its field; the policy survives both, because the question
 * *"which of a design's meshes are worth converting"* is a question about the
 * corpus and not about where a placement came from.
 *
 * ## What A1 changed, and what it did not
 *
 * A fill names a **file** (`SlotFill.tile`, a `TileId`), not a design. So the
 * eager tier is no longer a *choice*: `selectVariant` used to pick one variant
 * out of an aggregate under the lock preference, and now the scene has already
 * picked. The eager tier is a lookup — `AggregateIndex.byTile` — and the plan is
 * **lock-free** as a result. That is the single largest simplification A1 buys
 * this directory, and it is asserted rather than asserted-in-a-comment: there is
 * no lock parameter on {@link planSceneMeshes}.
 *
 * What did *not* change is the reason a background tier exists, and the corpus
 * had to be re-measured to establish that rather than assumed. The premise was
 * *"changing the lock is instant rather than another download"*, and after A1 a
 * lock change is a **re-solve**: `workshopStore.ts#setLockSystem` writes the
 * preference and C2 walks every instance's slots calling `fillSlot`.
 * `composition/candidates.ts` says what that walk lands on — *"a slot's
 * candidates are usually several printable variants of a handful of designs …
 * the tile is chosen from the item afterwards by `selectVariant`"* — so the
 * candidate **items** do not move with the lock and the chosen **file** does.
 * The files a lock change can land a filled slot on are therefore exactly the
 * lock-reachable variants of that fill's own design, which is what
 * {@link lockReachable} returns and what this module prefetches.
 *
 * Measured over all 8,702 records, taking each in turn as an explicit fill:
 *
 * | | value |
 * | --- | ---: |
 * | fills whose own file is itself lock-reachable for its design | **69.0%** |
 * | fills whose background set is **empty** — the file is the only lock-reachable variant | 28.8% |
 * | background variants per fill | median **1**, p95 3, max 4, mean 1.44 |
 * | background bytes per fill | median **5.33 MB**, p95 56.11 MB, max 155.87 MB |
 *
 * So the tier does not collapse: **71.2%** of fills have somewhere for a lock
 * change to go, and it is cheap per fill. It is the *scene* that makes it
 * expensive, which is the one thing about this policy the new trigger really
 * does change.
 *
 * ## The budget is per **scene reconcile** now, not per add
 *
 * {@link MESH_BACKGROUND_BUDGET_BYTES} is unchanged at 32 MB and its
 * justification is unchanged — it caps background traffic at about four seconds'
 * worth, the point at which a background download stops being invisible. What
 * changed is the *unit it applies to*, and it had to: the old trigger was one
 * add-to-library at a time, so one budget was one item. The new trigger is the
 * whole scene, so a per-fill budget would be 62 budgets for one room.
 *
 * Measured, rooms built by solving each shipped template's parts with the real
 * `resolvePart`/`selectVariant` under openlock and deduplicating scene-wide:
 *
 * | instances | fills | eager blobs / MB | background candidates / MB | prefetched at 32 MB | deferred |
 * | ---: | ---: | ---: | ---: | ---: | ---: |
 * | 1 | 5 | 5 / 23.90 | 4 / 16.27 | 4 / **16.27 MB** | 0 |
 * | 5 | 23 | 14 / 91.36 | 13 / 82.13 | 8 / 23.79 MB | 5 |
 * | 10 | 37 | 18 / 104.70 | 19 / 112.49 | 12 / 25.17 MB | 7 |
 * | 20 | 62 | 23 / 203.40 | 26 / 221.99 | 12 / 25.17 MB | 14 |
 * | 40 | 112 | 36 / 308.92 | 44 / 433.24 | 16 / **29.21 MB** | 28 |
 *
 * A single instance still gets its whole background set — **36 of the 40**
 * shipped templates do, at 32 MB — which is the case the old per-item budget was
 * tuned for, so nothing is lost where the old policy was right. And a
 * 40-instance room spends **29.21 MB** speculatively instead of **433.24 MB**: a
 * **14.8×** reduction against a per-fill budget, on traffic for a lock the user
 * may never choose.
 *
 * The **eager** tier is never bounded, at any scene size. It is what the builder
 * draws, so a budget on it is a room that cannot be drawn — and the reuse is the
 * reason it is affordable to leave unbounded: 62 fills reach 23 distinct blobs,
 * because a room shares its floors and its bases.
 *
 * The **deferred** tier keeps its promise verbatim: a variant the budget refused
 * is not converted, not queued and not forgotten. It is converted when something
 * actually resolves to it — which, after A1, is the moment the lock re-solve
 * rewrites that fill and the next scene reconcile puts the blob in `eager`.
 *
 * ## Converting every variant is still wrong, and the corpus still says so
 *
 * Kept from the row that shipped this policy, because it is what bounds
 * {@link lockReachable} to at most four entries. Measured over all 3,822
 * aggregates with the real `selectVariant`, per aggregate:
 *
 * | what gets converted | distinct meshes | median | p95 | max |
 * | --- | ---: | ---: | ---: | ---: |
 * | the lock-resolved variant | 1 | 11.3 MB | 37.3 MB | 108.9 MB |
 * | every variant any lock can resolve to | mean 1.54, max **4** | 14.8 MB | 61.4 MB | 175.7 MB |
 * | every variant | mean 2.23, max **16** | 16.6 MB | 92.5 MB | **420.7 MB** |
 *
 * The third row is 1.35× the bytes of the second for nothing a user can ever
 * see: a design with 16 variants has at most 4 that any lock preference will
 * resolve to, because the other 12 differ only in print options the resolver
 * ranks below the lock.
 *
 * That also fixes the shape of the tail. Variant count does not predict download
 * cost and is nearly anti-correlated with it: the 420.7 MB aggregate
 * (`d687ded3e16e7`, *Cut Stone Concave Curved Wall 4r90*) has **8** meshes, and
 * every one of the four 16-mesh aggregates is a *Plain Wall Base* totalling
 * 1.0–3.2 MB. So the gate here is **bytes**, not variants.
 *
 * ## The wiring
 *
 * One call, from `warm.ts`, which is armed once in `src/App.tsx`:
 *
 * ```ts
 * await ensureSceneMeshes(meshQueue(assets), sceneTiles(state.placements), context.aggregates)
 * ```
 *
 * There is deliberately **no render-time conversion**. That design was replaced
 * because it puts a 64 MB download behind the moment the 3D view opens, with
 * nowhere to show progress and no way to tell a slow room from a broken one.
 */
import { useMemo, useSyncExternalStore } from 'react'

import type { AggregateIndex, BlobId, CatalogAssets, TileAggregate, TileId } from '@/catalog'
import { selectVariant } from '@/catalog'
import { PRINT_OPTIONS } from '@/assembly'
import { LockSystem } from '@/store/schema'

import type { MeshQueue, MeshQueueState, MeshRequest } from './queue'
import { createMeshQueue } from './queue'

/**
 * Background bytes **one scene reconcile** may spend. 32 MB.
 *
 * See the module note for the measurement, and for why the number is unchanged
 * while the unit it applies to moved from one add-to-library to the whole scene.
 * It bounds the *background* tier only: the eager tier is converted however
 * large it is, because the alternative is a room the builder cannot draw.
 */
export const MESH_BACKGROUND_BUDGET_BYTES = 32 * 1024 * 1024

/** The three lock systems, from the store's own enum so they cannot drift. */
export const LOCK_SYSTEMS: readonly string[] = LockSystem.options

/** What one scene's fills would convert, split by tier. */
export interface MeshPlan {
  /**
   * The file every filled slot names, deduplicated by blob. **Not a choice** —
   * A1's fills already made it. Never bounded by the budget.
   */
  readonly eager: readonly MeshRequest[]
  /** Files a lock re-solve could land a filled slot on, inside the scene budget. */
  readonly background: readonly MeshRequest[]
  /** Those the scene budget refused. Converted on demand instead; see the module note. */
  readonly deferred: readonly MeshRequest[]
  /**
   * Fills naming a file **this catalog build does not hold**.
   *
   * A real state rather than a corruption: a share link or a restored backup can
   * carry an instance filled against an older index, and `transfer.ts` produces
   * exactly that. Reported rather than thrown — contract **C-a** — so a room
   * with one retired fill still warms the other 61. It replaces the old plan's
   * `unreachable` field, which named variants no lock resolves to and had no
   * reader: after A1 the eager tier is a lookup rather than a ranking, so
   * "unreachable" is no longer a category this plan can observe, while "the
   * catalog does not have this file" is one it must.
   */
  readonly unresolved: readonly TileId[]
}

export interface MeshPlanOptions {
  /** Background bytes for the whole scene. Defaults to {@link MESH_BACKGROUND_BUDGET_BYTES}. */
  readonly budget?: number
}

/**
 * Every file any lock preference resolves this design to, with its bytes.
 *
 * At most **four** entries and mean 1.54 over the corpus — the three systems
 * plus the no-preference answer, which is what a user who has never opened the
 * lock picker sees. This is the whole of the background tier's candidate set,
 * and the bound on it is why prefetching is affordable at all.
 *
 * It calls `selectVariant` from `src/catalog/aggregate.ts` and **does not
 * reimplement it** — the ranking that decides which variant a lock resolves to
 * belongs to that module, and a second copy of the rule here would be the exact
 * divergence the aggregate layer exists to prevent.
 */
export function lockReachable(aggregate: TileAggregate): ReadonlyMap<BlobId, number> {
  const reachable = new Map<BlobId, number>()
  for (const lock of [...LOCK_SYSTEMS, undefined]) {
    const variant = selectVariant(aggregate, {
      options: PRINT_OPTIONS,
      ...(lock === undefined ? {} : { bottom: lock }),
    }).variant
    reachable.set(variant.blob, variant.bytes)
  }
  return reachable
}

/**
 * Which meshes a scene's fills need, and in which tier.
 *
 * Pure, so the policy can be argued with in a test rather than observed in a
 * network tab. Takes the **files** the scene names — `warm.ts#sceneTiles` — and
 * not the placements, because nothing about the tiering depends on where a file
 * is standing or which template asked for it, and taking the store's shape here
 * would put `@/store`'s placement type in the policy's signature for no gain.
 *
 * Order-independent and idempotent: the eager tier is keyed on blob, so two
 * fills naming two files with the same md5 — 171 md5s are shared by 520 records
 * — are one request. `queue.request` would collapse them anyway; doing it here
 * is what keeps the budget arithmetic honest.
 */
export function planSceneMeshes(
  tiles: readonly TileId[],
  aggregates: AggregateIndex,
  options: MeshPlanOptions = {},
): MeshPlan {
  const budget = options.budget ?? MESH_BACKGROUND_BUDGET_BYTES

  const eager = new Map<BlobId, number>()
  const unresolved: TileId[] = []
  const designs = new Set<TileAggregate>()
  for (const tile of tiles) {
    const variant = aggregates.byTile.get(tile)
    if (variant === undefined) {
      unresolved.push(tile)
      continue
    }
    eager.set(variant.blob, variant.bytes)
    const aggregate = aggregates.byDesign.get(variant.design)
    if (aggregate !== undefined) designs.add(aggregate)
  }

  // Deduplicated across the whole scene before the budget is spent, not per
  // fill: a room shares its bases and its floors, so the same candidate is
  // reached by many fills and paying for it once is the difference the module
  // note measures.
  const candidates = new Map<BlobId, number>()
  for (const aggregate of designs) {
    for (const [blob, bytes] of lockReachable(aggregate)) {
      if (!eager.has(blob)) candidates.set(blob, bytes)
    }
  }

  // Smallest first, so a tight budget buys the most states. Ties broken on the
  // md5 so the plan is deterministic and a test can assert it.
  const ordered = [...candidates].sort((a, b) => (a[1] !== b[1] ? a[1] - b[1] : a[0] < b[0] ? -1 : 1))
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

  return {
    eager: [...eager].map(([blob, bytes]) => ({ blob, bytes, tier: 'eager' })),
    background,
    deferred,
    unresolved,
  }
}

/**
 * Convert what this scene needs. **The interface `warm.ts` calls.**
 *
 * Resolves when every eager mesh has reached a terminal state and the 3D view
 * can draw the room; the background tier keeps running past it. Safe to call
 * again with an overlapping scene — the queue collapses blobs it already holds,
 * in flight or `ready`, and promotes a background blob asked for as eager rather
 * than duplicating it — so a reconcile after one placement costs only the meshes
 * that placement added.
 *
 * An empty `tiles` asks for nothing and resolves, which is the state an instance
 * placed with no fills at all produces (contract **C-a**: `placeTemplate`
 * accepts an incomplete `fills` map by design).
 */
export function ensureSceneMeshes(
  queue: MeshQueue,
  tiles: readonly TileId[],
  aggregates: AggregateIndex,
  options: MeshPlanOptions = {},
): Promise<void> {
  const plan = planSceneMeshes(tiles, aggregates, options)
  if (plan.eager.length === 0 && plan.background.length === 0) return Promise.resolve()
  return queue.request([...plan.eager, ...plan.background])
}

/* -------------------------------------------------------------- the singleton */

let shared: { queue: MeshQueue; models: string } | null = null

/**
 * The app's one queue, created on first use.
 *
 * A module singleton rather than a React context, for the reason
 * `src/store/meshes.ts` gives for its own store: the warmer is a store
 * subscription with no component to hang a context on, and it has to hand the
 * *same* object to `BuilderRoom`'s progress readout or the room's "converting
 * *n* meshes…" plate describes a queue nobody is filling. Keyed on
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
 * is written to from a store subscription outside React and a torn read here
 * would render a progress bar that disagrees with itself. The queue's snapshot is
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
