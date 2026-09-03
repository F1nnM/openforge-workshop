/// <reference types="node" />
/**
 * The tier policy, measured over the real corpus rather than argued.
 *
 * Every number in `library.ts`'s docblock is re-derived here from
 * `public/catalog/catalog.json` — 8,702 records, 8,353 distinct meshes, 3,822
 * aggregates — so the policy's justification fails a run if the corpus moves
 * under it. That is the point: "converting every variant is wrong" is a claim
 * about this archive, and the archive is a file in this repo.
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { PRINT_OPTIONS } from '@/assembly'
import type { AggregateIndex, DesignId, TileAggregate } from '@/catalog'
import { CatalogFile, buildAggregateIndex, selectVariant } from '@/catalog'

import {
  LOCK_SYSTEMS,
  MESH_BACKGROUND_BUDGET_BYTES,
  ensureAggregateMeshes,
  planAggregateMeshes,
} from './library'
import type { MeshQueue, MeshRequest } from './queue'

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

describe('the shape of the tail, measured', () => {
  it('finds every aggregate resolving to at most four distinct meshes across all lock choices', () => {
    // This is the whole argument for not converting every variant: the 12
    // variants a 16-variant design carries beyond these four are unreachable by
    // any lock preference, so converting them populates cache entries nothing
    // will ever read.
    const reachable = index().aggregates.map((aggregate) => {
      const plan = planAggregateMeshes(aggregate, { lock: 'openlock', budget: Infinity })
      return plan.eager.length + plan.background.length + plan.deferred.length
    })

    expect(Math.max(...reachable)).toBe(4)
    expect(percentile(reachable, 0.5)).toBe(1)
    const mean = reachable.reduce((total, count) => total + count, 0) / reachable.length
    expect(mean).toBeGreaterThan(1.5)
    expect(mean).toBeLessThan(1.6)
  })

  it('finds designs with the most variants are the cheapest, not the most expensive', () => {
    // The correction that reshaped this policy. Mesh count does not predict
    // download cost and is very nearly anti-correlated with it.
    const rows = index().aggregates.map((aggregate) => {
      const blobs = new Set(aggregate.variants.map((variant) => variant.blob))
      return { design: aggregate.design, meshes: blobs.size, bytes: distinctBytes(aggregate) }
    })

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

    // And in aggregate: ten or more meshes means a *small* download.
    const many = rows.filter((row) => row.meshes >= 10)
    expect(many).toHaveLength(31)
    expect(percentile(many.map((row) => row.bytes), 0.5)).toBeLessThan(5_000_000)
  })

  it('finds the eager tier is one mesh, median 11.3 MB', () => {
    const eager = index().aggregates.map((aggregate) => {
      const plan = planAggregateMeshes(aggregate, { lock: 'openlock' })
      expect(plan.eager).toHaveLength(1)
      return plan.eager[0]?.bytes ?? 0
    })

    expect(Math.round(percentile(eager, 0.5) / 1e5) / 10).toBeCloseTo(11.3, 1)
    expect(Math.round(percentile(eager, 0.95) / 1e5) / 10).toBeCloseTo(37.3, 1)
    expect(Math.round(Math.max(...eager) / 1e5) / 10).toBeCloseTo(108.9, 1)
  })

  it('finds the 32 MB background budget covers 94.1% of aggregates in full', () => {
    // 16 MB covers 83.9% and 64 MB covers 99.4%; the chosen figure is where a
    // background download stops being invisible.
    const full = index().aggregates.filter(
      (aggregate) => planAggregateMeshes(aggregate, { lock: 'openlock' }).deferred.length === 0,
    ).length

    expect(MESH_BACKGROUND_BUDGET_BYTES).toBe(32 * 1024 * 1024)
    expect(full / index().aggregates.length).toBeCloseTo(0.941, 2)
    // And it does defer some, so the budget is not a decoration.
    expect(index().aggregates.length - full).toBeGreaterThan(100)
  })
})

describe('planAggregateMeshes', () => {
  it('puts the variant the lock resolves to in the eager tier, and nothing else', () => {
    // Not this module's ranking: `selectVariant` decides, and the assertion is
    // that the plan agrees with it rather than reimplementing it.
    for (const aggregate of index().aggregates.slice(0, 200)) {
      for (const lock of LOCK_SYSTEMS) {
        const plan = planAggregateMeshes(aggregate, { lock })
        const chosen = selectVariant(aggregate, { bottom: lock, options: PRINT_OPTIONS }).variant
        expect(plan.eager).toEqual([{ blob: chosen.blob, bytes: chosen.bytes, tier: 'eager' }])
      }
    }
  })

  it('never queues the same mesh twice across the tiers', () => {
    for (const aggregate of index().aggregates.slice(0, 500)) {
      const plan = planAggregateMeshes(aggregate, { lock: 'openlock', budget: Infinity })
      const all = [...plan.eager, ...plan.background, ...plan.deferred].map((one) => one.blob)
      expect(new Set(all).size).toBe(all.length)
      // And a variant is either reachable or unreachable, never both.
      for (const blob of plan.unreachable) expect(all).not.toContain(blob)
    }
  })

  it('orders the background tier smallest first, so a tight budget buys the most states', () => {
    const multi = index().aggregates.find(
      (aggregate) => planAggregateMeshes(aggregate, { lock: 'openlock', budget: Infinity }).background.length >= 2,
    )
    expect(multi).toBeDefined()
    const plan = planAggregateMeshes(multi!, { lock: 'openlock', budget: Infinity })
    const bytes = plan.background.map((one) => one.bytes)
    expect([...bytes].sort((a, b) => a - b)).toEqual(bytes)
  })

  it('defers what the budget refuses instead of dropping it', () => {
    const heavy = index().byDesign.get('d687ded3e16e7' as DesignId)
    expect(heavy).toBeDefined()

    const tight = planAggregateMeshes(heavy!, { lock: 'openlock', budget: 1 })
    // Nothing but the eager mesh fits, and nothing was lost: the deferred list
    // is what a later lock change converts on demand.
    expect(tight.background).toEqual([])
    expect(tight.deferred.length).toBeGreaterThan(0)

    const loose = planAggregateMeshes(heavy!, { lock: 'openlock', budget: Infinity })
    expect(loose.deferred).toEqual([])
    expect(tight.deferred.map((one) => one.blob).sort()).toEqual(
      loose.background.map((one) => one.blob).sort(),
    )
  })

  it('still resolves a variant with no lock preference at all', () => {
    // A user who has never opened the lock picker. `selectVariant` prefers a
    // one-part print, which is the merge's whole purpose.
    const plan = planAggregateMeshes(index().aggregates[0]!, {})
    expect(plan.eager).toHaveLength(1)
  })
})

describe('ensureAggregateMeshes', () => {
  it('asks the queue for the eager and background tiers, and not the deferred one', async () => {
    const queue = recordingQueue()
    const heavy = index().byDesign.get('d687ded3e16e7' as DesignId)!

    await ensureAggregateMeshes(queue, heavy, { lock: 'openlock' })

    const plan = planAggregateMeshes(heavy, { lock: 'openlock' })
    expect(queue.asked).toEqual([...plan.eager, ...plan.background])
    expect(plan.deferred.length).toBeGreaterThan(0)
    for (const one of plan.deferred) {
      expect(queue.asked.map((asked) => asked.blob)).not.toContain(one.blob)
    }
  })

  it('promotes a deferred variant when the lock changes to one that reaches it', async () => {
    // The tail policy's other half: a deferred mesh is not forgotten, it is
    // converted when something actually resolves to it.
    const changed = index().aggregates.find((aggregate) => {
      const openlock = planAggregateMeshes(aggregate, { lock: 'openlock' }).eager[0]?.blob
      const dragonlock = planAggregateMeshes(aggregate, { lock: 'dragonlock' }).eager[0]?.blob
      return openlock !== dragonlock
    })
    expect(changed).toBeDefined()

    const queue = recordingQueue()
    await ensureAggregateMeshes(queue, changed!, { lock: 'openlock' })
    const first = queue.asked.filter((one) => one.tier === 'eager').map((one) => one.blob)
    queue.asked.length = 0
    await ensureAggregateMeshes(queue, changed!, { lock: 'dragonlock' })
    const second = queue.asked.filter((one) => one.tier === 'eager').map((one) => one.blob)

    expect(second).not.toEqual(first)
    expect(second).toHaveLength(1)
  })
})
