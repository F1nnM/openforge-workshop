/// <reference types="node" />
/**
 * The tier policy, measured over the real corpus rather than argued.
 *
 * Every number in `tiers.ts`'s docblock that can be derived from the catalog
 * alone is re-derived here from `public/catalog/catalog.json` — 8,702 records,
 * 8,353 distinct meshes, 3,822 aggregates — so the policy's justification fails
 * a run if the corpus moves under it. That is the point: "the background tier
 * does not collapse when a fill names a file" is a claim about this archive, and
 * the archive is a file in this repo.
 *
 * ## The one table this suite cannot re-derive, and why
 *
 * `tiers.ts` carries a table of rooms built by solving each shipped template's
 * parts with the real `resolvePart`/`selectVariant`. Re-deriving it here would
 * make this directory's test suite import `@/composition` and
 * `@/screens/assemblies` — C2's solver and a *screen's* data table — to test a
 * byte budget. So the table was measured out of band and what this suite asserts
 * instead is the **property** the table exists to justify: one budget for the
 * whole scene rather than one per fill. The corpus-shaped room below is the
 * independent witness, with its own numbers.
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { PRINT_OPTIONS } from '@/assembly'
import type { AggregateIndex, BlobId, DesignId, TileAggregate, TileId } from '@/catalog'
import { CatalogFile, buildAggregateIndex, selectVariant } from '@/catalog'

import type { MeshQueue, MeshRequest } from './queue'
import {
  LOCK_SYSTEMS,
  MESH_BACKGROUND_BUDGET_BYTES,
  ensureSceneMeshes,
  lockReachable,
  planSceneMeshes,
} from './tiers'

let cached: AggregateIndex | undefined

function index(): AggregateIndex {
  cached ??= buildAggregateIndex(CatalogFile.parse(JSON.parse(readFileSync('public/catalog/catalog.json', 'utf8'))))
  return cached
}

function percentile(values: readonly number[], at: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(at * (sorted.length - 1))] ?? 0
}

function distinctBytes(aggregate: TileAggregate): number {
  const blobs = new Map<string, number>()
  for (const variant of aggregate.variants) blobs.set(variant.blob, variant.bytes)
  return [...blobs.values()].reduce((total, bytes) => total + bytes, 0)
}

const reachCache = new Map<DesignId, ReadonlyMap<BlobId, number>>()

/** Memoised, because the per-record sweeps below would otherwise re-rank 3,822 groups each. */
function reachOf(design: DesignId): ReadonlyMap<BlobId, number> {
  let reach = reachCache.get(design)
  if (reach === undefined) {
    reach = lockReachable(index().byDesign.get(design)!)
    reachCache.set(design, reach)
  }
  return reach
}

/** Every record in turn, as if it were the file one slot's fill names. */
function everyFill(): readonly { tile: TileId; blob: BlobId; background: ReadonlyMap<BlobId, number> }[] {
  return [...index().byTile.values()].map((variant) => {
    const background = new Map(reachOf(variant.design))
    background.delete(variant.blob)
    return { tile: variant.id, blob: variant.blob, background }
  })
}

/**
 * A room-shaped fill set out of the corpus alone: the preview file of the first
 * `n` designs.
 *
 * Not a solved room — see the suite note — but it is a *scene*, which is all the
 * budget arithmetic needs: `n` fills naming `n` files across `n` designs.
 */
function room(n: number): readonly TileId[] {
  return index().aggregates.slice(0, n).map((aggregate) => aggregate.preview)
}

/** A queue that records what it was asked for and nothing else. */
function recordingQueue(): MeshQueue & { readonly asked: MeshRequest[] } {
  const asked: MeshRequest[] = []
  return {
    asked,
    request: (requests) => {
      asked.push(...requests)
      return Promise.resolve()
    },
    state: () => ({
      tasks: new Map(),
      eagerPending: 0,
      backgroundPending: 0,
      remainingBytes: 0,
      failed: [],
      uncached: false,
    }),
    subscribe: () => () => undefined,
    cancel: () => undefined,
    dispose: () => undefined,
  }
}

function totalBytes(requests: readonly MeshRequest[]): number {
  return requests.reduce((total, one) => total + one.bytes, 0)
}

describe('a fill names a file, and the background tier survives it', () => {
  it('finds 69.0% of files are themselves lock-reachable for their design, so 31.0% are not', () => {
    // The measurement that says the eager tier had to stop being a *choice*: for
    // nearly a third of the corpus, the file a slot is filled with is not the one
    // any lock preference would have picked out of its design. Ranking here
    // instead of reading the fill would have drawn a different mesh from the one
    // the room is priced and printed against.
    const fills = everyFill()
    const reachable = fills.filter((fill) => reachOf(index().byTile.get(fill.tile)!.design).has(fill.blob))
    expect(fills).toHaveLength(8702)
    expect(reachable.length / fills.length).toBeCloseTo(0.69, 2)
  })

  it('finds the background tier empty for only 28.8% of files, so it does not collapse', () => {
    // "Measure before you delete a tier." A file-valued fill *could* have left
    // nothing for a lock change to move to; for 71.2% of the corpus it does not.
    const fills = everyFill()
    const empty = fills.filter((fill) => fill.background.size === 0)
    expect(empty.length / fills.length).toBeCloseTo(0.288, 2)
  })

  it('finds the background set per fill is a median of one variant and 5.33 MB', () => {
    const fills = everyFill()
    const counts = fills.map((fill) => fill.background.size)
    const bytes = fills.map((fill) => [...fill.background.values()].reduce((a, b) => a + b, 0))

    expect(percentile(counts, 0.5)).toBe(1)
    expect(percentile(counts, 0.95)).toBe(3)
    expect(Math.max(...counts)).toBe(4)
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length
    expect(mean).toBeCloseTo(1.44, 2)

    expect(Math.round(percentile(bytes, 0.5) / 1e4) / 100).toBeCloseTo(5.33, 1)
    expect(Math.round(percentile(bytes, 0.95) / 1e4) / 100).toBeCloseTo(56.11, 1)
  })
})

describe('lockReachable', () => {
  it('finds every design resolving to at most four distinct meshes across all lock choices', () => {
    // The bound that makes prefetching affordable at all: the 12 variants a
    // 16-variant design carries beyond these four are unreachable by any lock
    // preference, so converting them populates cache entries nothing will read.
    const counts = index().aggregates.map((aggregate) => lockReachable(aggregate).size)

    expect(Math.max(...counts)).toBe(4)
    expect(percentile(counts, 0.5)).toBe(1)
    const mean = counts.reduce((total, count) => total + count, 0) / counts.length
    expect(mean).toBeGreaterThan(1.5)
    expect(mean).toBeLessThan(1.6)
  })

  it('is `selectVariant`’s answer and not a second ranking', () => {
    // The whole reason this function is four calls and no logic: the rule that
    // decides which variant a lock resolves to belongs to `@/catalog`, and a
    // second copy here is the divergence the aggregate layer exists to prevent.
    for (const aggregate of index().aggregates.slice(0, 300)) {
      const reach = lockReachable(aggregate)
      for (const lock of [...LOCK_SYSTEMS, undefined]) {
        const chosen = selectVariant(aggregate, {
          options: PRINT_OPTIONS,
          ...(lock === undefined ? {} : { bottom: lock }),
        }).variant
        expect(reach.get(chosen.blob)).toBe(chosen.bytes)
      }
    }
  })

  it('finds designs with the most variants are the cheapest, not the most expensive', () => {
    // The correction that reshaped this policy, and the reason the gate is bytes
    // rather than variants. Mesh count does not predict download cost and is very
    // nearly anti-correlated with it.
    const rows = index().aggregates.map((aggregate) => ({
      design: aggregate.design,
      meshes: new Set(aggregate.variants.map((variant) => variant.blob)).size,
      bytes: distinctBytes(aggregate),
    }))

    const mostMeshes = Math.max(...rows.map((row) => row.meshes))
    expect(mostMeshes).toBe(16)
    // Every 16-mesh aggregate is a Plain Wall Base, and all four are tiny.
    for (const row of rows.filter((one) => one.meshes === mostMeshes)) {
      expect(row.bytes).toBeLessThan(4_000_000)
    }

    // The heaviest aggregate in the corpus, and it has eight meshes.
    const heaviest = rows.reduce((worst, row) => (row.bytes > worst.bytes ? row : worst))
    expect(heaviest.design).toBe('d687ded3e16e7')
    expect(Math.round(heaviest.bytes / 1e5) / 10).toBe(420.7)
    expect(heaviest.meshes).toBe(8)

    const many = rows.filter((row) => row.meshes >= 10)
    expect(many).toHaveLength(31)
    expect(percentile(many.map((row) => row.bytes), 0.5)).toBeLessThan(5_000_000)
  })
})

describe('planSceneMeshes', () => {
  it('puts the file each fill names in the eager tier, and nothing else', () => {
    const tiles = room(60)
    const plan = planSceneMeshes(tiles, index())
    const wanted = new Map(tiles.map((tile) => [index().byTile.get(tile)!.blob, index().byTile.get(tile)!.bytes]))

    expect(plan.eager).toHaveLength(wanted.size)
    for (const request of plan.eager) {
      expect(request.tier).toBe('eager')
      expect(wanted.get(request.blob)).toBe(request.bytes)
    }
  })

  it('is lock-free, because the fill has already chosen', () => {
    // The largest simplification A1 buys this directory, asserted rather than
    // asserted-in-a-comment: there is no lock parameter, and there is nothing the
    // preference could change about a plan whose eager tier is a lookup — every
    // lock-reachable variant of every design the scene touches is already
    // somewhere across the three tiers.
    const plan = planSceneMeshes(room(80), index())
    const planned = new Set([...plan.eager, ...plan.background, ...plan.deferred].map((one) => one.blob))
    for (const aggregate of index().aggregates.slice(0, 80)) {
      for (const blob of lockReachable(aggregate).keys()) expect(planned.has(blob)).toBe(true)
    }
  })

  it('never queues the same mesh twice across the tiers', () => {
    const plan = planSceneMeshes(room(200), index(), { budget: Infinity })
    const all = [...plan.eager, ...plan.background, ...plan.deferred].map((one) => one.blob)
    expect(new Set(all).size).toBe(all.length)
  })

  it('deduplicates two fills naming two files with the same mesh', () => {
    // 171 md5s are shared by 520 records, and the largest group holds 9. The
    // queue would collapse them anyway; doing it in the plan is what keeps the
    // budget arithmetic honest.
    const groups = new Map<BlobId, TileId[]>()
    for (const variant of index().byTile.values()) {
      groups.set(variant.blob, [...(groups.get(variant.blob) ?? []), variant.id])
    }
    const shared = [...groups.values()].find((tiles) => tiles.length > 1)
    expect(shared).toBeDefined()

    const plan = planSceneMeshes(shared!, index())
    expect(plan.eager).toHaveLength(1)
  })

  it('orders the background tier smallest first, so a tight budget buys the most states', () => {
    const plan = planSceneMeshes(room(40), index(), { budget: Infinity })
    const bytes = plan.background.map((one) => one.bytes)
    expect(bytes.length).toBeGreaterThan(2)
    expect([...bytes].sort((a, b) => a - b)).toEqual(bytes)
  })

  it('defers what the budget refuses instead of dropping it', () => {
    const tiles = room(40)
    const tight = planSceneMeshes(tiles, index(), { budget: 1 })
    expect(tight.background).toEqual([])
    expect(tight.deferred.length).toBeGreaterThan(0)

    const loose = planSceneMeshes(tiles, index(), { budget: Infinity })
    expect(loose.deferred).toEqual([])
    expect(tight.deferred.map((one) => one.blob).sort()).toEqual(loose.background.map((one) => one.blob).sort())
  })

  it('reports a fill this catalog build no longer holds instead of throwing — contract C-a', () => {
    // A share link or a restored backup can name a file an older index carried.
    const plan = planSceneMeshes(['tiles/gone/forever.stl' as TileId, ...room(3)], index())

    expect(plan.unresolved).toEqual(['tiles/gone/forever.stl'])
    expect(plan.eager).toHaveLength(3)
  })

  it('plans nothing at all for a scene with no fills', () => {
    const plan = planSceneMeshes([], index())
    expect(plan).toEqual({ eager: [], background: [], deferred: [], unresolved: [] })
  })
})

describe('the budget is one per scene, not one per fill', () => {
  it('caps the background tier at 32 MB however large the room', () => {
    // The shape change the new trigger forces. The old trigger was one
    // add-to-library at a time, so one budget was one item; the new one is the
    // whole scene, and a per-fill budget would be 40 budgets for the room below.
    expect(MESH_BACKGROUND_BUDGET_BYTES).toBe(32 * 1024 * 1024)

    for (const size of [1, 5, 10, 20, 40]) {
      const plan = planSceneMeshes(room(size), index())
      expect(totalBytes(plan.background)).toBeLessThanOrEqual(MESH_BACKGROUND_BUDGET_BYTES)
    }
  })

  it('finds the cap really binds on a 40-fill room, and by a wide margin', () => {
    // Measured here rather than asserted as a ratio in a comment: the candidate
    // set is what a per-fill budget would have let through, since every one of
    // these designs is individually well inside 32 MB.
    const plan = planSceneMeshes(room(40), index(), { budget: MESH_BACKGROUND_BUDGET_BYTES })
    const loose = planSceneMeshes(room(40), index(), { budget: Infinity })

    expect(Math.round(totalBytes(loose.background) / 1e4) / 100).toBeCloseTo(203.65, 1)
    expect(Math.round(totalBytes(plan.background) / 1e4) / 100).toBeCloseTo(33.03, 1)
    expect(plan.deferred).toHaveLength(12)
  })

  it('never bounds the eager tier, because a bounded room cannot be drawn', () => {
    // 40 fills reach 345.78 MB of geometry the room is going to draw. Refusing
    // any of it is a hole in the scene, which is the picture this directory
    // exists to remove.
    const plan = planSceneMeshes(room(40), index(), { budget: 0 })
    expect(plan.eager).toHaveLength(40)
    expect(Math.round(totalBytes(plan.eager) / 1e4) / 100).toBeCloseTo(345.78, 1)
    expect(plan.background).toEqual([])
  })

  it('leaves a single instance its whole background set, where the old per-item budget was right', () => {
    // Nothing is lost where the old policy was correct: one placement's fills sit
    // inside the scene budget as comfortably as they sat inside a per-item one.
    const plan = planSceneMeshes(room(1), index())
    expect(plan.deferred).toEqual([])
    expect(plan.background.length).toBeGreaterThan(0)
  })
})

describe('ensureSceneMeshes', () => {
  it('asks the queue for the eager and background tiers, and not the deferred one', async () => {
    const queue = recordingQueue()
    const tiles = room(40)

    await ensureSceneMeshes(queue, tiles, index())

    const plan = planSceneMeshes(tiles, index())
    expect(queue.asked).toEqual([...plan.eager, ...plan.background])
    expect(plan.deferred.length).toBeGreaterThan(0)
    for (const one of plan.deferred) {
      expect(queue.asked.map((asked) => asked.blob)).not.toContain(one.blob)
    }
  })

  it('promotes a deferred mesh when a fill actually resolves to it', async () => {
    // The deferred tier's promise, which the move to the scene keeps verbatim: a
    // refused variant is not forgotten, it is converted when something resolves
    // to it — which after A1 is the moment the lock re-solve rewrites that fill
    // and the next reconcile puts the blob in `eager`.
    const tiles = room(40)
    const deferred = planSceneMeshes(tiles, index()).deferred[0]
    expect(deferred).toBeDefined()

    const resolved = [...index().byTile.values()].find((variant) => variant.blob === deferred!.blob)
    expect(resolved).toBeDefined()

    const queue = recordingQueue()
    await ensureSceneMeshes(queue, [...tiles, resolved!.id], index())

    const promoted = queue.asked.filter((one) => one.blob === deferred!.blob)
    expect(promoted).toHaveLength(1)
    expect(promoted[0]?.tier).toBe('eager')
  })

  it('asks for nothing when the scene names no file', async () => {
    const queue = recordingQueue()
    await ensureSceneMeshes(queue, [], index())
    expect(queue.asked).toEqual([])
  })

  it('asks for nothing when every fill names a file this build no longer holds', async () => {
    const queue = recordingQueue()
    await ensureSceneMeshes(queue, ['tiles/gone/forever.stl' as TileId], index())
    expect(queue.asked).toEqual([])
  })
})
