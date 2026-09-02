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

import type { LodGeometry } from './loadLod'
import { LodAbsentError, loadLodGeometry } from './loadLod'

/** In-flight requests to one hostname. Six is Chrome's per-host HTTP/1.1 limit. */
export const LOD_FETCH_CONCURRENCY = 6

export interface LodStoreState {
  /** Loaded objects by content address. Grows as they arrive. */
  readonly geometries: ReadonlyMap<string, LodGeometry>
  /** Addresses the store answered 404/403 for. Expected today — blocker B2. */
  readonly absent: ReadonlySet<string>
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

/**
 * Load a room's objects.
 *
 * Keyed on the *sorted, joined* address list rather than on the array's
 * identity — `useStlModel.ts` learned that the hard way: a caller computing its
 * blob list inline hands a new array every render, and an effect keyed on it
 * re-fetches the whole room on every keystroke.
 */
export function useLodStore({ blobs, assets, enabled, fetchImpl }: UseLodStoreOptions): LodStoreState {
  const wanted = useMemo(() => [...new Set(blobs)].sort(), [blobs.join('\u0000')])
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
      setState({
        geometries: new Map(geometries),
        absent: new Set(absent),
        failed: new Map(failed),
        pending,
        requested: wanted.length,
        settled: pending === 0,
      })
    }

    setState({
      geometries: new Map(),
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
          const lod = await loadLodGeometry(blob, {
            assets: { lod: base },
            signal: controller.signal,
            ...(fetchImpl === undefined ? {} : { fetchImpl }),
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
  }, [key, base, enabled, fetchImpl])

  return state
}
