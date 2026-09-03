/**
 * Fetch → convert → cache, one queue, with every state the user can see named.
 *
 * ## The order of the queue is a measurement, not a preference
 *
 * Fetched against the real bucket (`objects.openforge.tools`), the six meshes of
 * the palette's starter set, 64.1 MB, ascending by size:
 *
 * | | total | throughput | first mesh ready |
 * | --- | ---: | ---: | ---: |
 * | one at a time | 8.38 s | 7.65 MB/s | **0.84 s** |
 * | **two at a time** | 7.97 s | 8.03 MB/s | **0.60 s** |
 * | three at a time | **6.95 s** | 9.22 MB/s | 0.82 s |
 * | six at a time | 9.24 s | 6.93 MB/s | 3.27 s |
 *
 * Six at once is *worse on both axes* — the bucket does not go faster and the
 * first mesh arrives five times later, because six large bodies share the pipe
 * and none of them finishes. That is the whole argument for
 * {@link MESH_FETCH_CONCURRENCY} being **2** rather than the six
 * `useLodStore.ts` uses for `/lod/` objects: those average 21 kB and this
 * corpus's meshes average 12.7 MB, so the connection limit that shapes one is
 * irrelevant to the other.
 *
 * And **smallest first**, which is the other half: the queue is sorted
 * ascending by source bytes so the room draws something in 0.6 s instead of
 * waiting 3 s for a 24 MB wall. Eager items always sort ahead of background
 * ones regardless of size — see `library.ts` for what puts an item in which
 * tier.
 *
 * ## The states, all seven of them
 *
 * A conversion is not "loading" then "done". Adding an item to the library can
 * end in **four** different places and the UI is entitled to tell them apart,
 * because the user's next action differs in each:
 *
 * | state | what happened | what the user should do |
 * | --- | --- | --- |
 * | `queued` | waiting behind another fetch | nothing |
 * | `fetching` | bytes arriving, `loaded`/`total` move | nothing |
 * | `converting` | in the worker, 28–462 ms | nothing |
 * | `ready` | in the cache; the 3D view will draw it | nothing |
 * | `missing` | the source STL 404s — the archive and the index disagree | report the tile; nothing will fix it locally |
 * | `uncached` | converted, but the browser refused to store it | free space, or accept a re-download per reload |
 * | `failed` | the mesh could not be converted, with a reason | retry; a `WeldNoOpError` will not fix itself |
 *
 * `uncached` is the one that would otherwise be reported as success, and it is
 * the most expensive to get wrong: the geometry is fine, the 3D view draws, and
 * every reload silently re-downloads tens of megabytes.
 *
 * ## Nothing here imports three.js
 *
 * By construction: the queue is triggered from the library, which must not pull
 * 411 kB of renderer. What it produces is typed arrays in IndexedDB, and
 * `src/builder/three/loadLod.ts` turns those into a `BufferGeometry` inside the
 * lazily-loaded 3D chunk. `boundary.test.ts` next door asserts it.
 */
import type { BlobId, CatalogAssets } from '@/catalog'
import type { BlobSource } from '@/download/source'
import { r2BlobSource } from '@/download/source'

import type { MeshConverter } from './client'
import { createMeshConverter } from './client'
import type { MeshCache } from './cache'
import { MeshCacheQuotaError, sharedMeshCache } from './cache'
import type { MeshRecord } from './record'
import { MESH_CACHE_VERSION } from './record'
import { spawnConvertWorker } from './spawn'

/** Simultaneous `/models/` fetches. Two — see the table in the module docblock. */
export const MESH_FETCH_CONCURRENCY = 2

/** Which tier a request belongs to. `eager` items are fetched first, always. */
export type MeshTier = 'eager' | 'background'

/** Where one mesh has got to. See the table in the module docblock. */
export type MeshTaskState = 'queued' | 'fetching' | 'converting' | 'ready' | 'missing' | 'uncached' | 'failed'

/** One mesh's progress. */
export interface MeshTask {
  readonly blob: BlobId
  readonly tier: MeshTier
  readonly state: MeshTaskState
  /** `CatalogRecord.bytes` — the expected download, so a bar is honest from the first chunk. */
  readonly total: number
  readonly loaded: number
  /** Set for `missing`, `uncached` and `failed`. */
  readonly error?: string
  /** The originating error's `name`, for a UI that branches. */
  readonly kind?: string
  /** Triangles in the converted mesh, once `ready`. */
  readonly triangles?: number
}

/** The queue, as one immutable snapshot. */
export interface MeshQueueState {
  readonly tasks: ReadonlyMap<string, MeshTask>
  /** Eager tasks not yet in a terminal state. Zero means "the item is usable". */
  readonly eagerPending: number
  /** Background tasks not yet in a terminal state. */
  readonly backgroundPending: number
  /** Bytes still to download across every unfinished task. */
  readonly remainingBytes: number
  /** Blobs in a terminal failure state — `missing` or `failed`. */
  readonly failed: readonly BlobId[]
  /** `true` once at least one conversion could not be stored. Sticky. */
  readonly uncached: boolean
}

const EMPTY: MeshQueueState = {
  tasks: new Map(),
  eagerPending: 0,
  backgroundPending: 0,
  remainingBytes: 0,
  failed: [],
  uncached: false,
}

/** One mesh to convert. */
export interface MeshRequest {
  readonly blob: BlobId
  /** `CatalogRecord.bytes`. Used for ordering, for the progress bar and for the read cap. */
  readonly bytes: number
  readonly tier: MeshTier
}

export interface MeshQueueOptions {
  readonly assets: Pick<CatalogAssets, 'models'>
  /** Defaults to `r2BlobSource(assets)`. Injectable so a test needs no network. */
  readonly source?: BlobSource
  /** Defaults to a real worker over `spawn.ts`. */
  readonly converter?: MeshConverter
  /**
   * Defaults to `sharedMeshCache()`.
   *
   * A `Promise` rather than a value because opening IndexedDB is asynchronous
   * and the queue must be constructible synchronously — the alternative is an
   * `async` factory every caller awaits before it can subscribe to progress. It
   * resolves to `null` where there is no usable IndexedDB, which surfaces as
   * `uncached` rather than as a failure.
   */
  readonly cache?: Promise<MeshCache | null>
  readonly concurrency?: number
}

export interface MeshQueue {
  /**
   * Enqueue meshes. Resolves when every **eager** request in this call has
   * reached a terminal state; background requests keep running after it.
   *
   * Idempotent per blob: a blob already queued, in flight or `ready` is not
   * re-fetched, and asking for it as `eager` while it is queued as `background`
   * promotes it rather than duplicating it.
   */
  request(requests: readonly MeshRequest[]): Promise<void>
  /** The current snapshot. Stable identity until something changes. */
  state(): MeshQueueState
  /** Subscribe to snapshots. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void
  /** Abort everything in flight and drop the queue. Terminal states are kept. */
  cancel(): void
  /** Abort, and release the worker and the cache handle. */
  dispose(): void
}

/**
 * The cache is consulted before anything is fetched, and that is where the
 * second visit becomes free: `have()` reads keys and never geometry, so
 * checking sixteen variants costs no bytes.
 */
export function createMeshQueue(options: MeshQueueOptions): MeshQueue {
  const source = options.source ?? r2BlobSource(options.assets)
  const converter = options.converter ?? createMeshConverter(spawnConvertWorker)
  const cachePromise = options.cache ?? sharedMeshCache()
  const concurrency = options.concurrency ?? MESH_FETCH_CONCURRENCY

  // A cache that will not open is a state, not a fault: the conversion still
  // runs and the geometry is still usable this session. It surfaces as
  // `uncached`, once, rather than as a failure per mesh.
  let cache: MeshCache | null = null
  let cacheOpened = false
  const withCache = async (): Promise<MeshCache | null> => {
    if (cacheOpened) return cache
    cacheOpened = true
    try {
      cache = await cachePromise
    } catch {
      cache = null
    }
    if (cache === null) setUncached()
    return cache
  }

  const tasks = new Map<string, MeshTask>()
  const listeners = new Set<() => void>()
  let snapshot: MeshQueueState = EMPTY
  let uncached = false
  let controller = new AbortController()
  /** Blobs waiting to start, kept sorted: eager before background, then ascending bytes. */
  let waiting: MeshRequest[] = []
  let running = 0
  /** Resolvers for `request()` calls, each waiting on its own eager blob set. */
  const waiters: { blobs: Set<string>; resolve: () => void }[] = []

  const terminal = (state: MeshTaskState): boolean =>
    state === 'ready' || state === 'missing' || state === 'uncached' || state === 'failed'

  const publish = () => {
    let eagerPending = 0
    let backgroundPending = 0
    let remainingBytes = 0
    const failed: BlobId[] = []
    for (const task of tasks.values()) {
      if (terminal(task.state)) {
        if (task.state === 'missing' || task.state === 'failed') failed.push(task.blob)
        continue
      }
      if (task.tier === 'eager') eagerPending += 1
      else backgroundPending += 1
      remainingBytes += Math.max(0, task.total - task.loaded)
    }
    snapshot = { tasks: new Map(tasks), eagerPending, backgroundPending, remainingBytes, failed, uncached }
    for (const listener of listeners) listener()
  }

  const setUncached = () => {
    if (uncached) return
    uncached = true
  }

  const set = (blob: BlobId, patch: Partial<MeshTask>) => {
    const current = tasks.get(blob)
    if (current === undefined) return
    tasks.set(blob, { ...current, ...patch })
    if (patch.state !== undefined && terminal(patch.state)) settleWaiters(blob)
    publish()
  }

  const settleWaiters = (blob: string) => {
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index]
      if (waiter === undefined) continue
      waiter.blobs.delete(blob)
      if (waiter.blobs.size === 0) {
        waiters.splice(index, 1)
        waiter.resolve()
      }
    }
  }

  const order = (a: MeshRequest, b: MeshRequest): number => {
    if (a.tier !== b.tier) return a.tier === 'eager' ? -1 : 1
    if (a.bytes !== b.bytes) return a.bytes - b.bytes
    return a.blob < b.blob ? -1 : 1
  }

  /** Drain the response body into one buffer, reporting progress as it arrives. */
  const drain = async (blob: BlobId, stream: ReadableStream<Uint8Array>, expected: number): Promise<ArrayBuffer> => {
    const reader = stream.getReader()
    const chunks: Uint8Array[] = []
    let loaded = 0
    try {
      for (;;) {
        if (controller.signal.aborted) throw new DOMException('aborted', 'AbortError')
        const { done, value } = await reader.read()
        if (done) break
        if (value === undefined) continue
        chunks.push(value)
        loaded += value.byteLength
        set(blob, { loaded, total: Math.max(expected, loaded) })
      }
    } finally {
      // An abandoned body holds the connection and the bytes until GC notices.
      await reader.cancel().catch(() => undefined)
    }

    // One allocation, then one copy per chunk. Not `readCapped`'s single sized
    // allocation, because there is no cap to enforce here: the download gate
    // `src/three/gate.ts` applies exists to protect a *single-mesh viewer* from
    // holding 36 MB of positions, and this path holds ~59 kB per mesh after
    // conversion. The source buffer is transferred into the worker and detached
    // immediately, so its peak is one mesh, not a room's worth.
    const bytes = new Uint8Array(loaded)
    let at = 0
    for (const chunk of chunks) {
      bytes.set(chunk, at)
      at += chunk.byteLength
    }
    return bytes.buffer
  }

  const convertOne = async (item: MeshRequest): Promise<void> => {
    const store = await withCache()

    if (store !== null) {
      const held = await store.have([item.blob])
      if (held.has(item.blob)) {
        set(item.blob, { state: 'ready', loaded: item.bytes, total: item.bytes })
        return
      }
    }

    set(item.blob, { state: 'fetching' })
    let buffer: ArrayBuffer
    try {
      const stream = await source.open(item.blob, controller.signal)
      buffer = await drain(item.blob, stream, item.bytes)
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      const message = cause instanceof Error ? cause.message : 'the source mesh could not be fetched'
      // A 404 from `/models/` is categorically different from a 404 from
      // `/lod/`: the LOD store is empty by design, whereas a missing *source*
      // STL means the index and the archive disagree. Nothing the user does
      // fixes it, so it is `missing` and never retried.
      const missing = /HTTP 40[34]/.test(message)
      set(item.blob, {
        state: missing ? 'missing' : 'failed',
        error: message,
        kind: cause instanceof Error ? cause.name : 'unknown',
      })
      return
    }

    set(item.blob, { state: 'converting', loaded: item.bytes, total: item.bytes })
    let converted
    try {
      converted = await converter.convert(item.blob, buffer, controller.signal)
    } catch (cause) {
      if (cause instanceof Error && cause.message.includes('cancelled')) return
      set(item.blob, {
        state: 'failed',
        error: cause instanceof Error ? cause.message : 'the mesh could not be converted',
        kind: cause instanceof Error && 'kind' in cause ? String(cause.kind) : 'unknown',
      })
      return
    }

    const record: MeshRecord = {
      blob: item.blob,
      version: MESH_CACHE_VERSION,
      positions: converted.positions,
      indices: converted.indices,
      triangles: converted.triangles,
      vertices: converted.vertices,
      sourceTriangles: converted.sourceTriangles,
      sourceBytes: converted.sourceBytes,
      weldRatio: converted.weld.ratio,
      passThrough: converted.passThrough,
      areaError: converted.areaError,
      extentError: converted.extentError,
      convertMs: converted.totalMs,
      storedAt: Date.now(),
      usedAt: Date.now(),
    }

    if (store === null) {
      // No cache at all. The geometry exists and cannot be kept, which is
      // exactly `uncached` — reported rather than presented as success.
      setUncached()
      set(item.blob, { state: 'uncached', error: 'this browser has no usable mesh cache', triangles: record.triangles })
      return
    }

    try {
      await store.put(record)
    } catch (cause) {
      setUncached()
      set(item.blob, {
        state: 'uncached',
        error:
          cause instanceof MeshCacheQuotaError
            ? cause.message
            : cause instanceof Error
              ? cause.message
              : 'the converted mesh could not be stored',
        kind: cause instanceof Error ? cause.name : 'unknown',
        triangles: record.triangles,
      })
      return
    }

    set(item.blob, { state: 'ready', triangles: record.triangles })
  }

  const pump = () => {
    while (running < concurrency) {
      const next = waiting.shift()
      if (next === undefined) return
      running += 1
      void convertOne(next)
        .catch((cause: unknown) => {
          set(next.blob, {
            state: 'failed',
            error: cause instanceof Error ? cause.message : 'the conversion failed',
            kind: cause instanceof Error ? cause.name : 'unknown',
          })
        })
        .finally(() => {
          running -= 1
          pump()
        })
    }
  }

  return {
    state: () => snapshot,

    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    request: (requests) => {
      const eager = new Set<string>()

      for (const item of requests) {
        if (item.tier === 'eager') eager.add(item.blob)
        const existing = tasks.get(item.blob)

        if (existing === undefined) {
          tasks.set(item.blob, { blob: item.blob, tier: item.tier, state: 'queued', total: item.bytes, loaded: 0 })
          waiting.push(item)
          continue
        }
        if (terminal(existing.state)) {
          // A `ready` blob is done. A failed one is not retried by a second
          // add — the retry is the user's, through the UI, and `cancel()` plus
          // a fresh `request` is how it happens.
          if (existing.state === 'ready') eager.delete(item.blob)
          continue
        }
        // Promote a queued background item to eager rather than queuing it twice.
        if (item.tier === 'eager' && existing.tier === 'background') {
          tasks.set(item.blob, { ...existing, tier: 'eager' })
          const queued = waiting.find((candidate) => candidate.blob === item.blob)
          if (queued !== undefined) waiting[waiting.indexOf(queued)] = item
        }
      }

      waiting = waiting.sort(order)

      // Drop blobs that were already terminal, then settle immediately if
      // nothing eager is outstanding — a second add of an item already in the
      // cache must not leave a caller awaiting forever.
      for (const blob of [...eager]) {
        const task = tasks.get(blob)
        if (task !== undefined && terminal(task.state)) eager.delete(blob)
      }

      const settled =
        eager.size === 0
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              waiters.push({ blobs: eager, resolve })
            })

      publish()
      pump()
      return settled
    },

    cancel: () => {
      controller.abort()
      controller = new AbortController()
      waiting = []
      for (const [blob, task] of tasks) {
        if (!terminal(task.state)) tasks.delete(blob)
      }
      for (const waiter of waiters.splice(0)) waiter.resolve()
      publish()
    },

    dispose: () => {
      controller.abort()
      waiting = []
      listeners.clear()
      for (const waiter of waiters.splice(0)) waiter.resolve()
      converter.terminate()
      if (cache !== null) cache.close()
    },
  }
}
