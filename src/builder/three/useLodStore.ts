/**
 * The loads: a set of content addresses in, a map of geometries out, with the
 * absences counted rather than thrown.
 *
 * Everything expensive is here rather than inside the `<Canvas>` subtree, for
 * `useStlModel.ts`'s reason and it is a good one: a thrown promise inside a
 * canvas suspends the renderer rather than the panel, and the progress readout
 * belongs in the DOM above the canvas anyway.
 *
 * ## The set changes on every edit, so the loads are **incremental**
 *
 * This is the whole shape of the hook and it was worth a rewrite. The room's
 * address set is derived from the scene, so placing a tile adds an address and
 * deleting the last copy of one removes it. An effect keyed on that set — which
 * is what this was — tears down and re-runs on **every** such edit, and a
 * teardown disposed every geometry the room had and republished an empty map.
 * The user saw it exactly as it was: *place one tile and every other tile in the
 * room flashes away*, for as long as the re-fetch took.
 *
 * So the loaded objects live in a ref rather than in the effect's closure, and
 * the effect **reconciles** rather than restarts:
 *
 *   - an address that is already loaded stays loaded, and keeps its
 *     `BufferGeometry` identity, so `InstancedTiles` is not even reconstructed;
 *   - an address that is new is appended to the queue;
 *   - an address that has dropped out of the set is disposed, once, there;
 *   - a request in flight is left alone — it lands into the same registry.
 *
 * The only thing that still discards everything is a change of **source** (the
 * `/lod/` base or the injected `fetch`) and unmount, because both mean the
 * objects in hand came from somewhere that is no longer being asked.
 *
 * `lodStore.test.tsx` guards the retention directly: it records every state the
 * hook publishes across a set change and fails if any of them drops an address
 * that was already loaded. That is the assertion the old shape failed.
 *
 * ## What it does not do
 *
 * **No cache across mounts.** `src/three/material.ts` refcounts materials
 * because a material is a few bytes of uniforms shared by dozens of meshes; a
 * geometry is up to 240 kB (`lod.ts`) and a room is up to 150 of them, so
 * keeping them alive after the view closes would hold tens of megabytes for a
 * view nobody is looking at. Closing the 3D view disposes every geometry it
 * loaded. Re-opening re-fetches, and the objects are `immutable`-cached for a
 * year at the edge (G1's `LOD_CACHE_CONTROL`), so the second open is a memory
 * cache hit rather than a network one.
 *
 * **No retry loop.** An absence is not a failure and must not be retried: the
 * store answering 404 for a blob is a fact about the store, and 150 objects
 * retried on a timer against a prefix that does not hold them is a self-inflicted
 * load test. A real failure is retried by the user, through the panel.
 *
 * **No conversion, and now no second store to read.** The `/lod/` prefix used to
 * be empty, so this hook read a fallback: an in-browser decimation of the source
 * STL, cached in IndexedDB by `src/mesh/`. The backfill has run — every one of
 * the archive's 8,353 distinct meshes has an object — so the fallback can no
 * longer fire, and it is deleted rather than left dormant along with the `epoch`
 * nudge that existed only to re-read a cache that was still filling. `absent`
 * therefore means what it says: `/lod/` has no object for this address.
 *
 * ## Concurrency
 *
 * {@link LOD_FETCH_CONCURRENCY} at a time. The objects are ~21 kB on average
 * (176.1 MB over 8,353) so the whole of a large room is a couple of megabytes,
 * and the reason to bound it at all is the browser's own per-host connection
 * limit: firing 150 requests at one hostname queues 144 of them anyway and
 * makes an abort mid-load slower, not faster. The bound is over the *registry*
 * rather than over one effect run, so an edit mid-load adds to the same queue
 * instead of opening a second set of six.
 */
import { useEffect, useMemo, useRef, useState } from 'react'

import type { BlobId, CatalogAssets } from '@/catalog'

import type { LodGeometry } from './loadLod'
import { LodAbsentError, loadLodGeometry } from './loadLod'

/** In-flight requests to one hostname. Six is Chrome's per-host HTTP/1.1 limit. */
export const LOD_FETCH_CONCURRENCY = 6

export interface LodStoreState {
  /** Loaded objects by content address. Grows as they arrive. */
  readonly geometries: ReadonlyMap<string, LodGeometry>
  /**
   * Addresses `/lod/` has no object for — a 404, or the 403 a bucket with no
   * public read answers with.
   */
  readonly absent: ReadonlySet<string>
  /** Addresses that failed for another reason, with the reason. */
  readonly failed: ReadonlyMap<string, string>
  /** Still queued or in flight. */
  readonly pending: number
  /** Total addresses asked for. */
  readonly requested: number
  /** True once nothing is in flight. */
  readonly settled: boolean
}

const EMPTY: LodStoreState = {
  geometries: new Map(),
  absent: new Set(),
  failed: new Map(),
  pending: 0,
  requested: 0,
  settled: true,
}

export interface UseLodStoreOptions {
  /** Content addresses to load. Order is irrelevant; duplicates are collapsed. */
  readonly blobs: readonly BlobId[]
  readonly assets: Pick<CatalogAssets, 'lod'>
  /** `false` parks the hook: nothing is fetched and everything loaded is released. */
  readonly enabled: boolean
  readonly fetchImpl?: typeof fetch
}

/** The source a registry's contents came from. A change to it invalidates them all. */
interface LodSource {
  readonly base: string
  readonly fetchImpl: typeof fetch | undefined
}

/**
 * The loads in hand, outliving any one effect run.
 *
 * Mutable and held in a ref on purpose: this is the state an effect keyed on the
 * address set would destroy, and the reason the room no longer flashes.
 */
interface LodRegistry {
  readonly geometries: Map<string, LodGeometry>
  readonly absent: Set<string>
  readonly failed: Map<string, string>
  /** Addresses a worker is currently awaiting. */
  readonly inflight: Set<string>
  /** Addresses waiting for a worker. */
  queue: string[]
  /** Workers running. Never above {@link LOD_FETCH_CONCURRENCY}. */
  workers: number
  /** The set the room currently wants. A load that lands outside it is discarded. */
  wanted: Set<string>
  /** `wanted.size`, read by {@link publish} so a worker cannot report a stale total. */
  requested: number
  /** Bumped by {@link release}. A load carrying an older one is discarded. */
  generation: number
  controller: AbortController
  source: LodSource | null
}

function createRegistry(): LodRegistry {
  return {
    geometries: new Map(),
    absent: new Set(),
    failed: new Map(),
    inflight: new Set(),
    queue: [],
    workers: 0,
    wanted: new Set(),
    requested: 0,
    generation: 0,
    controller: new AbortController(),
    source: null,
  }
}

/**
 * Load a room's objects, keeping what is already loaded.
 *
 * The wanted set is memoised on the *sorted, joined* address list rather than on
 * the array's identity — `useStlModel.ts` learned that the hard way: a caller
 * computing its blob list inline hands a new array every render, and an effect
 * keyed on it re-runs on every keystroke.
 */
export function useLodStore({ blobs, assets, enabled, fetchImpl }: UseLodStoreOptions): LodStoreState {
  const wanted = useMemo(() => [...new Set(blobs)].sort(), [blobs.join('\u0000')])
  const key = wanted.join('\u0000')
  const base = assets.lod

  const [state, setState] = useState<LodStoreState>(EMPTY)

  const held = useRef<LodRegistry | null>(null)
  held.current ??= createRegistry()
  const registry = held.current

  // Unmount is the one teardown that is unconditional. Separate from the
  // reconciling effect below precisely so that effect's dependencies — which
  // include the address set — cannot trigger it.
  useEffect(
    () => () => {
      release(registry)
    },
    [registry],
  )

  useEffect(() => {
    if (!enabled) {
      release(registry)
      setState(EMPTY)
      return
    }

    if (!sameSource(registry.source, base, fetchImpl)) {
      release(registry)
      registry.source = { base, fetchImpl }
    }

    registry.wanted = new Set(wanted)
    registry.requested = wanted.length
    prune(registry)
    enqueue(registry)
    pump(registry, setState)
    publish(registry, setState)
    // `key` stands in for `wanted`, whose identity is the memo above; `blobs`
    // itself is a fresh array on every render of every caller.
  }, [registry, key, base, enabled, fetchImpl])

  return state
}

function sameSource(source: LodSource | null, base: string, fetchImpl: typeof fetch | undefined): boolean {
  return source !== null && source.base === base && source.fetchImpl === fetchImpl
}

/** Drop everything: the objects came from a source nothing is asking any more. */
function release(registry: LodRegistry): void {
  registry.generation += 1
  registry.controller.abort()
  registry.controller = new AbortController()
  for (const lod of registry.geometries.values()) lod.dispose()
  registry.geometries.clear()
  registry.absent.clear()
  registry.failed.clear()
  registry.inflight.clear()
  registry.queue = []
  registry.workers = 0
  registry.wanted = new Set()
  registry.requested = 0
  registry.source = null
}

/**
 * Forget the addresses the room no longer holds.
 *
 * The disposal is here and only here: an address leaves the set when its last
 * placement is deleted, and its geometry is the room's largest single object.
 * Requests already in flight are not cancelled — one fetch is cheaper than the
 * bookkeeping to abort exactly one of six — but their results are discarded by
 * {@link worker} against the same `wanted` set.
 */
function prune(registry: LodRegistry): void {
  for (const [blob, lod] of registry.geometries) {
    if (registry.wanted.has(blob)) continue
    lod.dispose()
    registry.geometries.delete(blob)
  }
  for (const blob of registry.absent) if (!registry.wanted.has(blob)) registry.absent.delete(blob)
  for (const blob of registry.failed.keys()) if (!registry.wanted.has(blob)) registry.failed.delete(blob)
  registry.queue = registry.queue.filter((blob) => registry.wanted.has(blob))
}

/**
 * Queue the addresses nothing has answered for yet.
 *
 * An absence and a failure are both terminal — see the module note on why
 * neither is retried — so an address in either is not re-queued, and one already
 * queued or in flight is not queued twice.
 */
function enqueue(registry: LodRegistry): void {
  const queued = new Set(registry.queue)
  for (const blob of registry.wanted) {
    if (registry.geometries.has(blob)) continue
    if (registry.absent.has(blob) || registry.failed.has(blob)) continue
    if (registry.inflight.has(blob) || queued.has(blob)) continue
    registry.queue.push(blob)
    queued.add(blob)
  }
}

type Publish = (next: LodStoreState) => void

function publish(registry: LodRegistry, setState: Publish): void {
  const pending = registry.queue.length + registry.inflight.size
  setState({
    geometries: new Map(registry.geometries),
    absent: new Set(registry.absent),
    failed: new Map(registry.failed),
    pending,
    requested: registry.requested,
    settled: pending === 0,
  })
}

/** Top the workers up to the bound. Called on every reconcile; idempotent. */
function pump(registry: LodRegistry, setState: Publish): void {
  while (registry.workers < LOD_FETCH_CONCURRENCY && registry.queue.length > 0) {
    registry.workers += 1
    void worker(registry, setState)
  }
}

async function worker(registry: LodRegistry, setState: Publish): Promise<void> {
  const generation = registry.generation
  const source = registry.source
  const controller = registry.controller

  try {
    if (source === null) return
    for (;;) {
      const blob = registry.queue.shift()
      if (blob === undefined) return
      registry.inflight.add(blob)

      let loaded: LodGeometry | null = null
      let absent = false
      let failure: string | null = null
      try {
        loaded = await loadLodGeometry(blob as BlobId, {
          assets: { lod: source.base },
          signal: controller.signal,
          ...(source.fetchImpl === undefined ? {} : { fetchImpl: source.fetchImpl }),
        })
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') {
          registry.inflight.delete(blob)
          return
        }
        if (cause instanceof LodAbsentError) absent = true
        else failure = cause instanceof Error ? cause.message : 'the object could not be loaded'
      }
      registry.inflight.delete(blob)

      // Released under us, or the address left the room while this was in
      // flight. Either way the result is not the registry's to keep.
      if (registry.generation !== generation) {
        loaded?.dispose()
        return
      }
      if (!registry.wanted.has(blob)) {
        loaded?.dispose()
        continue
      }

      if (loaded !== null) registry.geometries.set(blob, loaded)
      else if (absent) registry.absent.add(blob)
      else if (failure !== null) registry.failed.set(blob, failure)
      publish(registry, setState)
    }
  } finally {
    registry.workers -= 1
  }
}
