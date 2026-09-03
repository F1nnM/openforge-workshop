/// <reference types="node" />
/**
 * The wiring row R1 left open, and the three moments it has to cover.
 *
 * `library.ts` shipped a policy with **zero call sites** and said so; this suite
 * is the evidence that there is now one, and that it fires at each of the three
 * moments a saved item's mesh can be missing — the save itself, an app load with
 * a library already in it, and a change of lock preference. Every one of those
 * is asserted by driving the **real store** and reading what a recording queue
 * was asked for, so nothing here can pass against a mocked subscription.
 *
 * The base half is asserted the same way and is this row's correction to R1:
 * `planAggregateMeshes` covers an aggregate's own variants, so the auto-inserted
 * base — a different design, a different blob, and the part carrying the joinery
 * — was never queued at all.
 *
 * ## What it cannot prove
 *
 * The queue is a recorder. Nothing here fetches an STL, runs the simplifier,
 * writes IndexedDB or draws a triangle, so *"the mesh appears"* is not a claim
 * this file makes — `queue.test.ts` covers the fetch-convert-cache path and only
 * a browser can show the pixels. What is proved is exactly the seam: which blobs
 * this row asks for, in which tier, on which store event.
 */
import { readFileSync } from 'node:fs'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AssemblyIndex } from '@/assembly'
import { buildAssemblyIndex } from '@/assembly'
import type { BlobId, CatalogFile as CatalogFileType, DesignId } from '@/catalog'
import { CatalogFile, buildAggregateIndex } from '@/catalog'
import {
  addToLibrary,
  clearLibrary,
  clearPlacements,
  placeTile,
  setLockSystem,
  useWorkshopStore,
} from '@/store'

import type { MeshContext } from './context'
import { autoInsertedBase, resetMeshContext, setCatalogLoader } from './context'
import { planAggregateMeshes } from './library'
import type { MeshQueue, MeshRequest } from './queue'
import { baseBlobsFor, startLibraryWarming, warmDesigns } from './warm'

let cachedFile: CatalogFileType | undefined
let cachedContext: MeshContext | undefined

function catalogFile(): CatalogFileType {
  cachedFile ??= CatalogFile.parse(JSON.parse(readFileSync('public/catalog/catalog.json', 'utf8')))
  return cachedFile
}

/** The real derivations over the emitted index, built once for the suite. */
function context(): MeshContext {
  const file = catalogFile()
  cachedContext ??= { file, aggregates: buildAggregateIndex(file), assembly: buildAssemblyIndex(file) }
  return cachedContext
}

function assembly(): AssemblyIndex {
  return context().assembly
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

/** An item that rule 1 puts a base under, under openlock. 1,878 of 3,822 qualify. */
function basedDesign(): DesignId {
  const found = context().aggregates.aggregates.find(
    (aggregate) => autoInsertedBase(aggregate.design, assembly(), 'openlock') !== undefined,
  )
  expect(found).toBeDefined()
  return found!.design
}

/** An item rule 1 puts no base under — `self-sufficient`, `insert` or `no-base`. */
function baselessDesign(): DesignId {
  const found = context().aggregates.aggregates.find(
    (aggregate) => autoInsertedBase(aggregate.design, assembly(), 'openlock') === undefined,
  )
  expect(found).toBeDefined()
  return found!.design
}

afterEach(() => {
  clearLibrary()
  clearPlacements()
  setLockSystem('openlock')
  resetMeshContext()
  vi.restoreAllMocks()
})

describe('warmDesigns', () => {
  it('asks for the base beside the item, eagerly, because the item cannot be drawn without it', async () => {
    const design = basedDesign()
    const base = autoInsertedBase(design, assembly(), 'openlock')
    const queue = recordingQueue()

    await warmDesigns(queue, context(), [design], 'openlock')

    const asked = queue.asked.filter((one) => one.blob === base!.record.blob)
    expect(asked).toHaveLength(1)
    expect(asked[0]?.tier).toBe('eager')
    expect(asked[0]?.bytes).toBe(base!.record.bytes)
  })

  it('is what R1 alone would not have asked for', () => {
    // The whole reason this row touches `@/mesh` at all: the plan for the
    // aggregate cannot name the base, because the base is a different design.
    const design = basedDesign()
    const aggregate = context().aggregates.byDesign.get(design)!
    const plan = planAggregateMeshes(aggregate, { lock: 'openlock' })
    const base = autoInsertedBase(design, assembly(), 'openlock')!

    const planned = [...plan.eager, ...plan.background, ...plan.deferred].map((one) => one.blob)
    expect(planned).not.toContain(base.record.blob)
  })

  it('asks for the item alone when rule 1 inserts no base', async () => {
    const design = baselessDesign()
    const aggregate = context().aggregates.byDesign.get(design)!
    const queue = recordingQueue()

    await warmDesigns(queue, context(), [design], 'openlock')

    const plan = planAggregateMeshes(aggregate, { lock: 'openlock' })
    expect(queue.asked.map((one) => one.blob).sort()).toEqual(
      [...plan.eager, ...plan.background].map((one) => one.blob).sort(),
    )
  })

  it('asks for one base however many saved items share it', async () => {
    // Instancing's argument, applied to the download: the whole corpus reaches
    // 84 distinct base blobs under openlock, so a library of based items shares
    // them heavily and asking per item would be asking for the same megabyte
    // many times over.
    const shared = context()
      .aggregates.aggregates.map((aggregate) => ({
        design: aggregate.design,
        base: autoInsertedBase(aggregate.design, assembly(), 'openlock')?.record.blob,
      }))
      .filter((entry): entry is { design: DesignId; base: BlobId } => entry.base !== undefined)
    const first = shared[0]!
    const siblings = shared.filter((entry) => entry.base === first.base).slice(0, 5)
    expect(siblings.length).toBeGreaterThan(1)

    const queue = recordingQueue()
    await warmDesigns(queue, context(), siblings.map((entry) => entry.design), 'openlock')

    expect(queue.asked.filter((one) => one.blob === first.base)).toHaveLength(1)
  })

  it('queues nothing for an item this catalog build no longer holds', async () => {
    const queue = recordingQueue()
    await warmDesigns(queue, context(), ['not-a-design' as DesignId], 'openlock')
    expect(queue.asked).toEqual([])
  })
})

describe('baseBlobsFor', () => {
  it('counts the distinct bases a library pulls in, not one per item', () => {
    const designs = context()
      .aggregates.aggregates.slice(0, 200)
      .map((aggregate) => aggregate.design)
    const blobs = baseBlobsFor(context(), designs, 'openlock')
    const based = designs.filter((design) => autoInsertedBase(design, assembly(), 'openlock') !== undefined)

    expect(based.length).toBeGreaterThan(blobs.length)
    expect(new Set(blobs).size).toBe(blobs.length)
  })

  it('answers differently under a different preference, which is why a lock change re-warms', () => {
    const designs = context()
      .aggregates.aggregates.slice(0, 400)
      .map((aggregate) => aggregate.design)
    const openlock = new Set(baseBlobsFor(context(), designs, 'openlock'))
    const dragonlock = new Set(baseBlobsFor(context(), designs, 'dragonlock'))

    expect([...dragonlock].some((blob) => !openlock.has(blob))).toBe(true)
  })
})

describe('startLibraryWarming', () => {
  it('warms a library that was already saved when the app loaded', async () => {
    // Moment 2, and the one an insert hook fires never for: nothing is added
    // during this session, the entries came back from `localStorage`.
    const design = basedDesign()
    addToLibrary(design)
    const queue = recordingQueue()
    setCatalogLoader(() => Promise.resolve(catalogFile()))

    const stop = startLibraryWarming({ queueFor: () => queue })
    await vi.waitFor(() => {
      expect(queue.asked.length).toBeGreaterThan(0)
    })
    stop()

    const base = autoInsertedBase(design, assembly(), 'openlock')!
    expect(queue.asked.map((one) => one.blob)).toContain(base.record.blob)
  })

  it('warms an item the moment it is saved', async () => {
    const queue = recordingQueue()
    setCatalogLoader(() => Promise.resolve(catalogFile()))
    const stop = startLibraryWarming({ queueFor: () => queue })
    expect(queue.asked).toEqual([])

    const design = basedDesign()
    expect(addToLibrary(design)).toBe(true)
    await vi.waitFor(() => {
      expect(queue.asked.length).toBeGreaterThan(0)
    })
    stop()
  })

  it('re-warms when the lock preference changes, because the base changes with it', async () => {
    // Moment 3. The item is chosen for having a *different base* under the two
    // preferences, so the second reconcile asking for a blob the first did not
    // is the whole assertion.
    const changed = context().aggregates.aggregates.find((aggregate) => {
      const openlock = autoInsertedBase(aggregate.design, assembly(), 'openlock')?.record.blob
      const dragonlock = autoInsertedBase(aggregate.design, assembly(), 'dragonlock')?.record.blob
      return openlock !== undefined && dragonlock !== undefined && openlock !== dragonlock
    })
    expect(changed).toBeDefined()

    addToLibrary(changed!.design)
    const queue = recordingQueue()
    setCatalogLoader(() => Promise.resolve(catalogFile()))
    const stop = startLibraryWarming({ queueFor: () => queue })
    await vi.waitFor(() => {
      expect(queue.asked.length).toBeGreaterThan(0)
    })
    const first = new Set(queue.asked.map((one) => one.blob))

    setLockSystem('dragonlock')
    await vi.waitFor(() => {
      expect(queue.asked.map((one) => one.blob).some((blob) => !first.has(blob))).toBe(true)
    })
    stop()

    const dragonBase = autoInsertedBase(changed!.design, assembly(), 'dragonlock')!
    expect(queue.asked.map((one) => one.blob)).toContain(dragonBase.record.blob)
  })

  it('does not reconcile on a store write that is neither the library nor the lock', async () => {
    // A placement is a store write, and a room is hundreds of them. Without the
    // two-slice diff this listener would walk the whole library on every press
    // — which is the difference between a `===` and a scan of a candidate list
    // per saved item.
    const design = basedDesign()
    addToLibrary(design)
    const queue = recordingQueue()
    setCatalogLoader(() => Promise.resolve(catalogFile()))
    const stop = startLibraryWarming({ queueFor: () => queue })
    await vi.waitFor(() => {
      expect(queue.asked.length).toBeGreaterThan(0)
    })
    const settled = queue.asked.length

    placeTile({ design, x: 0, z: 0, rotation: 0 })
    placeTile({ design, x: 1, z: 0, rotation: 0 })
    await Promise.resolve()
    await Promise.resolve()
    stop()

    expect(queue.asked.length).toBe(settled)
  })

  it('resolves no catalog at all for an empty library', async () => {
    // The reason a first-time visitor to the landing screen pays nothing for
    // this: an empty library is answered without touching the 5.6 MB index.
    const loader = vi.fn(() => Promise.resolve(catalogFile()))
    setCatalogLoader(loader)
    expect(useWorkshopStore.getState().library).toEqual({})

    const stop = startLibraryWarming({ queueFor: () => recordingQueue() })
    await Promise.resolve()
    await Promise.resolve()
    stop()

    expect(loader).not.toHaveBeenCalled()
  })

  it('asks for nothing after it is stopped', async () => {
    // The teardown is not decoration: `StrictMode` mounts, unmounts and mounts
    // the effect, and the catalog resolves between the two.
    const design = basedDesign()
    addToLibrary(design)
    const queue = recordingQueue()
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    setCatalogLoader(() => gate.then(() => catalogFile()))

    const stop = startLibraryWarming({ queueFor: () => queue })
    stop()
    release?.()
    await gate
    await Promise.resolve()
    await Promise.resolve()

    expect(queue.asked).toEqual([])
  })
})
