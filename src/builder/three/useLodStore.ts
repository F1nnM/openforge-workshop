/**
 * The loads: a set of content addresses in, a map of geometries out, with the
 * absences counted rather than thrown.
 *
 * Everything expensive is here rather than inside the `<Canvas>` subtree, for
 * `useStlModel.ts`'s reason and it is a good one: a thrown promise inside a
 * canvas suspends the renderer rather than the panel, and the progress readout
 * belongs in the DOM above the canvas anyway.
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
 * **No retry loop.** An absence is not a failure and must not be retried — B2 is
 * a blocker, not a flake, and 150 objects retried on a timer against a prefix
 * that does not exist yet is a self-inflicted load test. A real failure is
 * retried by the user, through the panel.
 *
 * **No conversion.** This hook reads; it does not fetch a 10.77 MB STL and
 * decimate it. Row R1 converts on **add-to-library** — a deliberate action with
 * somewhere to put a progress bar — and this hook sees only the result, through
 * `loadMeshGeometry`. Converting here instead would put a 64 MB download behind
 * the moment the 3D view opens, which is the design the owner replaced: a stall
 * with no explanation, paid again by every viewer of a shared link.
 *
 * ## Two stores, one map
 *
 * {@link LodStoreState.geometries} is keyed by content address and says nothing
 * about provenance, because its consumers must not care: `instances.ts` groups
 * by md5 and `place.ts` stands up whatever it is handed. `/lod/` is preferred
 * when it answers — 21 kB against 10.77 MB — and the IndexedDB cache answers
 * when it does not. {@link LodStoreState.converted} counts the second kind for
 * the readout only.
 *
 * `absent` therefore means **neither store has it**, which for a blob is now a
 * real statement about the user's library rather than a restatement of B2: a
 * design nobody added was never converted. `BuilderRoom` already renders that
 * count as "not in the store" and the sentence stays true.
 *
 * ## Concurrency
 *
 * {@link LOD_FETCH_CONCURRENCY} at a time. The objects are ~21 kB on average
 * (176.1 MB over 8,353) so the whole of a large room is a couple of megabytes,
 * and the reason to bound it at all is the browser's own per-host connection
 * limit: firing 150 requests at one hostname queues 144 of them anyway and
 * makes an abort mid-load slower, not faster.
 */
import { useEffect, useMemo, useState } from 'react'

import type { BlobId, CatalogAssets } from '@/catalog'
import type { MeshCache } from '@/mesh'
import { sharedMeshCache } from '@/mesh'

import type { LodGeometry } from './loadLod'
import { LodAbsentError, loadMeshGeometry } from './loadLod'

/** In-flight requests to one hostname. Six is Chrome's per-host HTTP/1.1 limit. */
export const LOD_FETCH_CONCURRENCY = 6

export interface LodStoreState {
  /** Loaded objects by content address. Grows as they arrive. */
  readonly geometries: ReadonlyMap<string, LodGeometry>
  /**
   * Addresses **neither** store could supply.
   *
   * `/lod/` answered 404/403 — expected today, blocker B2 — and the converted
   * cache had no record either, which means the design was never added to the
   * library and so nothing ever converted it.
   */
  readonly absent: ReadonlySet<string>
  /** How many of {@link geometries} came from the R1 conversion cache. */
  readonly converted: number
  /** Addresses that failed for another reason, with the reason. */
  readonly failed: ReadonlyMap<string, string>
  /** Still in flight. */
  readonly pending: number
  /** Total addresses asked for. */
  readonly requested: number
  /** True once nothing is in flight. */
  readonly settled: boolean
}

const EMPTY: LodStoreState = {
  geometries: new Map(),
  converted: 0,
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
  /**
   * The R1 converted-mesh cache, consulted when `/lod/` answers 404.
   *
   * Omit it and the hook uses `sharedMeshCache()`, the origin's one handle —
   * which is what makes this row work without `BuilderRoom.tsx` changing a
   * line, and keeps row R2's rebase of the renderer clean. Pass `null` for
   * `/lod/`-only, which is what a test asserting the store's own behaviour
   * wants, and what a browser with no IndexedDB gets anyway.
   */
  readonly cache?: Promise<MeshCache | null> | null | undefined
}

/**
 * Load a room's objects.
 *
 * Keyed on the *sorted, joined* address list rather than on the array's
 * identity — `useStlModel.ts` learned that the hard way: a caller computing its
 * blob list inline hands a new array every render, and an effect keyed on it
 * re-fetches the whole room on every keystroke.
 */
export function useLodStore({ blobs, assets, enabled, fetchImpl, cache }: UseLodStoreOptions): LodStoreState {
  const wanted = useMemo(() => [...new Set(blobs)].sort(), [blobs.join('\u0000')])
  // `undefined` means "use the origin's cache"; `null` means "there is none".
  // Resolved here rather than in the effect so the effect's dependency is a
  // stable promise identity and not a fresh one per render.
  const store = cache === undefined ? sharedMeshCache() : cache
  const key = wanted.join('\u0000')
  const base = assets.lod

  const [state, setState] = useState<LodStoreState>(EMPTY)

  useEffect(() => {
    if (!enabled || wanted.length === 0) {
      setState(EMPTY)
      return
    }

    const controller = new AbortController()
    const geometries = new Map<string, LodGeometry>()
    const absent = new Set<string>()
    const failed = new Map<string, string>()
    // The effect's own closure owns these three, and the cleanup below disposes
    // exactly what this run loaded. Reading them out of React state instead
    // would see the value from the render the effect was created in.
    let alive = true
    let cursor = 0
    let pending = wanted.length

    const publish = () => {
      if (!alive) return
      let converted = 0
      for (const lod of geometries.values()) if (lod.source === 'converted') converted += 1
      setState({
        geometries: new Map(geometries),
        converted,
        absent: new Set(absent),
        failed: new Map(failed),
        pending,
        requested: wanted.length,
        settled: pending === 0,
      })
    }

    setState({
      geometries: new Map(),
      converted: 0,
      absent: new Set(),
      failed: new Map(),
      pending: wanted.length,
      requested: wanted.length,
      settled: false,
    })

    const worker = async (): Promise<void> => {
      for (;;) {
        const index = cursor
        cursor += 1
        const blob = wanted[index]
        if (blob === undefined) return

        try {
          const lod = await loadMeshGeometry(blob, {
            assets: { lod: base },
            signal: controller.signal,
            ...(fetchImpl === undefined ? {} : { fetchImpl }),
            ...(store === null ? {} : { cache: store }),
          })
          if (!alive) {
            lod.dispose()
            return
          }
          geometries.set(blob, lod)
        } catch (cause) {
          if (cause instanceof DOMException && cause.name === 'AbortError') return
          if (cause instanceof LodAbsentError) absent.add(blob)
          else failed.set(blob, cause instanceof Error ? cause.message : 'the object could not be loaded')
        }
        pending -= 1
        publish()
      }
    }

    void Promise.all(
      Array.from({ length: Math.min(LOD_FETCH_CONCURRENCY, wanted.length) }, () => worker()),
    )

    return () => {
      alive = false
      controller.abort()
      for (const lod of geometries.values()) lod.dispose()
      geometries.clear()
    }
  }, [key, base, enabled, fetchImpl, store])

  return state
}
