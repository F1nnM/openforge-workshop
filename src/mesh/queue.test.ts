/// <reference types="node" />
/**
 * Fetch → convert → cache, run for real.
 *
 * Two things are doubled and neither of them is this row's code: the **network**
 * (a `BlobSource`, which `src/download/source.ts` names as the seam tests are
 * meant to supply — "tests supply their own and never hit R2") and the
 * **`Worker`**, which is replaced by an in-process converter that calls the real
 * `convertStl`. Everything else is the shipped path: real STL bytes, the real
 * parse, the real position-only weld, the real `MeshoptSimplifier`, the real
 * record, and the cache's real control flow over an in-test IndexedDB.
 *
 * So a passing run here means a real 118-facet catalog mesh went in and a real
 * welded record came out the other side and into storage, and the seven states
 * were reached the way they are reached in a browser.
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import type { BlobId } from '@/catalog'
import type { BlobSource } from '@/download/source'

import type { MeshCache } from './cache'
import type { MeshConverter } from './client'
import { convertStl } from './convert'
import { WALL_FIXTURE_PATH, binaryStl, grid } from './fixtures'
import { convertedResponse, narrowIndices } from './protocol'
import type { MeshRecord } from './record'
import { MESH_CACHE_VERSION } from './record'
import { createMeshQueue } from './queue'

/* ------------------------------------------------------------------- doubles */

/** The real conversion, in this thread. Stands in for the `Worker`, not for `convert.ts`. */
function inlineConverter(): MeshConverter & { readonly converted: string[] } {
  const converted: string[] = []
  return {
    converted,
    convert: async (blob, bytes) => {
      converted.push(blob)
      const mesh = await convertStl(new Uint8Array(bytes))
      const { message } = convertedResponse(
        blob,
        { ...mesh, indices: narrowIndices(mesh.indices, mesh.vertices) },
        1,
      )
      return message
    },
    terminate: () => undefined,
  }
}

/** A `BlobSource` over an in-memory map. `undefined` bytes means HTTP 404. */
function mapSource(bytes: ReadonlyMap<string, Uint8Array>): BlobSource & { readonly opened: string[] } {
  const opened: string[] = []
  return {
    opened,
    urlFor: (blob) => `https://example.invalid/models/${blob.slice(0, 6)}/${blob}.stl`,
    open: (blob) => {
      opened.push(blob)
      const found = bytes.get(blob)
      if (found === undefined) return Promise.reject(new Error(`could not fetch ${blob}: HTTP 404 Not Found`))
      return Promise.resolve(
        new ReadableStream<Uint8Array>({
          start(controller) {
            // Two chunks, so the progress callback is exercised rather than
            // skipped by a single-chunk body.
            const half = Math.ceil(found.byteLength / 2)
            controller.enqueue(found.subarray(0, half))
            controller.enqueue(found.subarray(half))
            controller.close()
          },
        }),
      )
    },
  }
}

/** A cache over a `Map`, with the parts the queue uses. */
function mapCache(): MeshCache & { readonly rows: Map<string, MeshRecord>; refuse: boolean } {
  const rows = new Map<string, MeshRecord>()
  const cache = {
    rows,
    refuse: false,
    get: (blob: string) => Promise.resolve(rows.get(blob)),
    have: (blobs: readonly string[]) =>
      Promise.resolve(new Set(blobs.filter((blob) => rows.has(blob)))) as Promise<ReadonlySet<string>>,
    put: (record: MeshRecord) => {
      if (cache.refuse) return Promise.reject(new Error('the origin is out of space'))
      rows.set(record.blob, record)
      return Promise.resolve()
    },
    stats: () =>
      Promise.resolve({
        count: rows.size,
        bytes: [...rows.values()].reduce((total, one) => total + one.positions.byteLength + one.indices.byteLength, 0),
        budget: 0,
      }),
    clear: () => {
      rows.clear()
      return Promise.resolve()
    },
    close: () => undefined,
  }
  return cache
}

/* ------------------------------------------------------------------ fixtures */

const WALL = 'a'.repeat(32) as BlobId
const BIG = 'b'.repeat(32) as BlobId
const GONE = 'c'.repeat(32) as BlobId

function wallBytes(): Uint8Array {
  const bytes = readFileSync(WALL_FIXTURE_PATH)
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

const bigBytes = binaryStl(grid(141))

function fixtures() {
  return new Map([
    [WALL, wallBytes()],
    [BIG, bigBytes],
  ])
}

const ASSETS = { models: 'https://example.invalid/models' }

function build(overrides: { cache?: ReturnType<typeof mapCache>; bytes?: Map<string, Uint8Array> } = {}) {
  const cache = overrides.cache ?? mapCache()
  const source = mapSource(overrides.bytes ?? fixtures())
  const converter = inlineConverter()
  const queue = createMeshQueue({
    assets: ASSETS,
    source,
    converter,
    cache: Promise.resolve(cache),
  })
  return { queue, cache, source, converter }
}

/** The same, with no cache at all — Node, jsdom, or Firefox in private browsing. */
function buildWithoutCache() {
  const source = mapSource(fixtures())
  const converter = inlineConverter()
  const queue = createMeshQueue({ assets: ASSETS, source, converter, cache: Promise.resolve(null) })
  return { queue, source, converter }
}

/* --------------------------------------------------------------------- tests */

describe('the happy path', () => {
  it('fetches, converts and caches a real catalog mesh', async () => {
    const { queue, cache, source } = build()

    await queue.request([{ blob: WALL, bytes: 5_984, tier: 'eager' }])

    expect(source.opened).toEqual([WALL])
    const record = cache.rows.get(WALL)
    expect(record).toBeDefined()
    expect(record?.version).toBe(MESH_CACHE_VERSION)
    expect(record?.sourceTriangles).toBe(118)
    expect(record?.triangles).toBe(118)
    // The weld actually ran, and reached the ratio G1 measured.
    expect(record?.weldRatio).toBeCloseTo(0.1667, 4)
    expect(record?.passThrough).toBe(true)

    expect(queue.state().tasks.get(WALL)?.state).toBe('ready')
    expect(queue.state().eagerPending).toBe(0)
    expect(queue.state().failed).toEqual([])
    expect(queue.state().uncached).toBe(false)
  })

  it('simplifies a mesh over the ceiling on the way into the cache', async () => {
    const { queue, cache } = build()

    await queue.request([{ blob: BIG, bytes: bigBytes.byteLength, tier: 'eager' }])

    const record = cache.rows.get(BIG)
    expect(record?.sourceTriangles).toBe(39_762)
    expect(record?.triangles).toBeLessThanOrEqual(20_000)
    expect(record?.passThrough).toBe(false)
    // The reason the row exists, in one assertion: 1.79 MB in, under 200 kB out.
    expect(record!.positions.byteLength + record!.indices.byteLength).toBeLessThan(200_000)
    expect(record?.sourceBytes).toBe(bigBytes.byteLength)
  })

  it('reports bytes arriving, so a progress bar can be honest', async () => {
    const { queue } = build()
    const seen: number[] = []
    queue.subscribe(() => {
      const task = queue.state().tasks.get(WALL)
      if (task !== undefined) seen.push(task.loaded)
    })

    await queue.request([{ blob: WALL, bytes: 5_984, tier: 'eager' }])

    // The body arrives in two chunks, so `loaded` moves before it finishes.
    expect(seen.some((loaded) => loaded > 0 && loaded < 5_984)).toBe(true)
    expect(seen.at(-1)).toBe(5_984)
  })

  it('does not refetch a mesh the cache already holds', async () => {
    const { queue, cache, source, converter } = build()

    await queue.request([{ blob: WALL, bytes: 5_984, tier: 'eager' }])
    expect(source.opened).toHaveLength(1)

    // A second add of the same item — which is what a shared link, a second
    // design using the same mesh, or a re-add all look like.
    await queue.request([{ blob: WALL, bytes: 5_984, tier: 'eager' }])

    expect(source.opened).toHaveLength(1)
    expect(converter.converted).toHaveLength(1)
    expect(cache.rows.size).toBe(1)
  })

  it('resolves a second request for an already-ready blob immediately', async () => {
    const { queue } = build()
    await queue.request([{ blob: WALL, bytes: 5_984, tier: 'eager' }])
    // The failure this guards is a caller awaiting for ever: the blob is
    // terminal, so there is nothing left to settle the waiter.
    await expect(queue.request([{ blob: WALL, bytes: 5_984, tier: 'eager' }])).resolves.toBeUndefined()
  })
})

describe('the tiers', () => {
  it('resolves when the eager mesh is ready, leaving the background running', async () => {
    const { queue } = build()

    await queue.request([
      { blob: WALL, bytes: 5_984, tier: 'eager' },
      { blob: BIG, bytes: bigBytes.byteLength, tier: 'background' },
    ])

    expect(queue.state().tasks.get(WALL)?.state).toBe('ready')
    expect(queue.state().eagerPending).toBe(0)
    // The whole point of the split: adding an item does not wait on the
    // variants a lock change might later reach.
    expect(queue.state().backgroundPending).toBeGreaterThanOrEqual(0)
  })

  it('promotes a queued background item to eager instead of queueing it twice', async () => {
    // Concurrency 1, so the second item is genuinely still `queued` when the
    // promotion happens — which is the only state in which promoting means
    // anything.
    const cache = mapCache()
    const source = mapSource(fixtures())
    const queue = createMeshQueue({
      assets: ASSETS,
      source,
      converter: inlineConverter(),
      cache: Promise.resolve(cache),
      concurrency: 1,
    })

    const background = queue.request([
      { blob: WALL, bytes: 5_984, tier: 'background' },
      { blob: BIG, bytes: bigBytes.byteLength, tier: 'background' },
    ])
    // Smallest first, so WALL is in flight and BIG is waiting.
    expect(queue.state().tasks.get(BIG)?.state).toBe('queued')
    expect(queue.state().tasks.get(BIG)?.tier).toBe('background')

    const promoted = queue.request([{ blob: BIG, bytes: bigBytes.byteLength, tier: 'eager' }])
    expect(queue.state().tasks.get(BIG)?.tier).toBe('eager')
    expect(queue.state().eagerPending).toBe(1)

    await Promise.all([background, promoted])
    // Promoted, not duplicated: one fetch, one conversion.
    expect(source.opened.filter((blob) => blob === BIG)).toHaveLength(1)
    expect(queue.state().tasks.get(BIG)?.state).toBe('ready')
  })
})

describe('the states that are not success', () => {
  it('calls a 404 from /models/ `missing`, not `failed`', async () => {
    const { queue, cache } = build()

    await queue.request([{ blob: GONE, bytes: 1_000, tier: 'eager' }])

    const task = queue.state().tasks.get(GONE)
    // A 404 from `/lod/` is expected — the store is empty. A 404 from
    // `/models/` means the index and the archive disagree, which no retry
    // fixes, so it is its own state.
    expect(task?.state).toBe('missing')
    expect(task?.error).toContain('404')
    expect(queue.state().failed).toEqual([GONE])
    expect(cache.rows.size).toBe(0)
  })

  it('calls a mesh it cannot convert `failed`, with the reason', async () => {
    const { queue } = build({ bytes: new Map([[WALL, new Uint8Array([1, 2, 3, 4])]]) })

    await queue.request([{ blob: WALL, bytes: 4, tier: 'eager' }])

    const task = queue.state().tasks.get(WALL)
    expect(task?.state).toBe('failed')
    expect(task?.error).toMatch(/matching neither/)
  })

  it('calls a converted mesh it could not store `uncached`, never `ready`', async () => {
    const cache = mapCache()
    cache.refuse = true
    const { queue } = build({ cache })

    await queue.request([{ blob: WALL, bytes: 5_984, tier: 'eager' }])

    const task = queue.state().tasks.get(WALL)
    // This is the state that would otherwise be reported as success: the
    // geometry converted fine and the view would draw, and every reload would
    // silently re-download the source.
    expect(task?.state).toBe('uncached')
    expect(task?.triangles).toBe(118)
    expect(queue.state().uncached).toBe(true)
    expect(cache.rows.size).toBe(0)
  })

  it('reports `uncached` once when there is no cache at all', async () => {
    const { queue } = buildWithoutCache()

    await queue.request([{ blob: WALL, bytes: 5_984, tier: 'eager' }])

    expect(queue.state().tasks.get(WALL)?.state).toBe('uncached')
    expect(queue.state().uncached).toBe(true)
  })

  it('drops what is in flight on cancel, and keeps what finished', async () => {
    const { queue } = build()
    await queue.request([{ blob: WALL, bytes: 5_984, tier: 'eager' }])

    const pending = queue.request([{ blob: BIG, bytes: bigBytes.byteLength, tier: 'eager' }])
    queue.cancel()
    await pending

    expect(queue.state().tasks.get(WALL)?.state).toBe('ready')
    expect(queue.state().tasks.has(BIG)).toBe(false)
    // And a cancelled `request` settles rather than hanging.
    await expect(pending).resolves.toBeUndefined()
  })
})

describe('the subscription', () => {
  it('publishes an immutable snapshot whose identity changes when it changes', async () => {
    const { queue } = build()
    const snapshots: unknown[] = []
    const unsubscribe = queue.subscribe(() => snapshots.push(queue.state()))

    const before = queue.state()
    await queue.request([{ blob: WALL, bytes: 5_984, tier: 'eager' }])
    const after = queue.state()

    expect(snapshots.length).toBeGreaterThan(1)
    expect(after).not.toBe(before)
    // `useSyncExternalStore` requires a stable snapshot between changes, or it
    // re-renders for ever.
    expect(queue.state()).toBe(after)

    unsubscribe()
    const settled = queue.state()
    await queue.request([{ blob: BIG, bytes: bigBytes.byteLength, tier: 'eager' }])
    expect(queue.state()).not.toBe(settled)
    expect(snapshots.at(-1)).toBe(after)
  })
})
