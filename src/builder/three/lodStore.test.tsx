// @vitest-environment jsdom
/**
 * The mesh store's one new behaviour, and the reason it is not a vacuous guard.
 *
 * Row R2 added an `epoch` to `useLodStore` and the third test below is why. The
 * hook reads the converted cache **once per blob** and reports a miss as
 * `absent`; it does not subscribe, and while the 3D view sat behind a press that
 * was right — the user placed tiles first and pressed afterwards, so a
 * conversion begun at add-to-library had normally finished, and the press
 * remounted the hook anyway.
 *
 * R2 opens the surface with the screen, so a conversion can now complete after
 * the hook has already recorded the blob as absent. The effect's other
 * dependencies are the sorted blob list and the asset base, and neither changes
 * when a worker finishes — and `wanted` is a **set**, so placing a second copy
 * of an already-armed tile changes nothing either. Without a nudge the mesh
 * never appears.
 *
 * The three tests are the absence, the arrival, and **the arrival withheld when
 * the epoch does not move**. That last one is what makes this a guard capable of
 * failing: it fails the day someone drops `epoch` from the dependency array, and
 * it also fails if the hook is ever made to re-read on its own, at which point
 * the epoch has become dead weight and should go. The same A/B was run in a real
 * Chrome against the built app — `useLodStore`'s own docblock carries the two
 * readouts.
 */
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { BlobId } from '@/catalog'
import type { MeshCache, MeshRecord } from '@/mesh'
import { MESH_CACHE_VERSION } from '@/mesh'

import { useLodStore } from './useLodStore'

const BLOB = '8180da93549154744c37f8370a82738f' as BlobId
const ASSETS = { lod: 'https://objects.openforge.tools/lod' }

/** `/lod/` is empty — blocker B2 — so every object 404s, as it does in the app. */
const notFound: typeof fetch = () => Promise.resolve(new Response(null, { status: 404 }))

/** A record shaped the way `src/mesh/convert.ts` writes one. */
function record(blob: BlobId, triangles = 8): MeshRecord {
  const vertices = triangles + 2
  const positions = new Float32Array(vertices * 3)
  for (let vertex = 0; vertex < vertices; vertex += 1) {
    positions[vertex * 3] = (vertex / (vertices - 1)) * 25.4
    positions[vertex * 3 + 1] = (vertex % 2) * 12.7
    positions[vertex * 3 + 2] = (vertex % 3) * 2
  }
  const indices = new Uint16Array(triangles * 3)
  for (let triangle = 0; triangle < triangles; triangle += 1) {
    indices[triangle * 3] = triangle
    indices[triangle * 3 + 1] = triangle + 1
    indices[triangle * 3 + 2] = triangle + 2
  }
  return {
    blob,
    version: MESH_CACHE_VERSION,
    positions,
    indices,
    triangles,
    vertices,
    sourceTriangles: triangles * 40,
    sourceBytes: 5_984,
    weldRatio: 0.1667,
    passThrough: false,
    areaError: 0.005,
    extentError: 0.01,
    convertMs: 130,
    storedAt: 1_000,
    usedAt: 1_000,
  }
}

/**
 * A cache whose contents change under the hook — which is the whole situation
 * being tested.
 */
function mutableCache(): { cache: Promise<MeshCache>; add: (one: MeshRecord) => void } {
  const rows = new Map<string, MeshRecord>()
  const cache: MeshCache = {
    get: (blob) => Promise.resolve(rows.get(blob)),
    have: (blobs) => Promise.resolve(new Set(blobs.filter((blob) => rows.has(blob)))),
    put: () => Promise.resolve(),
    stats: () => Promise.resolve({ count: rows.size, bytes: 0, budget: 0 }),
    clear: () => Promise.resolve(),
    close: () => undefined,
  }
  return {
    cache: Promise.resolve(cache),
    add: (one) => {
      rows.set(one.blob, one)
    },
  }
}

describe('the converted cache, read while it is still filling', () => {
  it('reports a blob neither store has as absent', async () => {
    const { cache } = mutableCache()
    const { result } = renderHook(() =>
      useLodStore({ blobs: [BLOB], assets: ASSETS, enabled: true, fetchImpl: notFound, cache }),
    )
    await waitFor(() => {
      expect(result.current.settled).toBe(true)
    })
    expect(result.current.absent.has(BLOB)).toBe(true)
    expect(result.current.geometries.size).toBe(0)
    // An absence, not a failure: one is blocker B2 and a library the user has
    // not added to, the other is worth a retry.
    expect(result.current.failed.size).toBe(0)
  })

  it('picks the mesh up when the epoch says a conversion landed', async () => {
    const { cache, add } = mutableCache()
    const { result, rerender } = renderHook(
      ({ epoch }: { epoch: number }) =>
        useLodStore({ blobs: [BLOB], assets: ASSETS, enabled: true, fetchImpl: notFound, cache, epoch }),
      { initialProps: { epoch: 0 } },
    )
    await waitFor(() => {
      expect(result.current.absent.has(BLOB)).toBe(true)
    })

    // The worker finishes and writes the record — which is exactly the moment
    // `useMeshQueue`'s `ready` count goes up in `BuilderRoom`.
    add(record(BLOB))
    rerender({ epoch: 1 })

    await waitFor(() => {
      expect(result.current.geometries.size).toBe(1)
    })
    const lod = result.current.geometries.get(BLOB)
    expect(lod?.source).toBe('converted')
    // Millimetres, in the store's Z-up axes — R1's contract, taken as given by
    // this row beyond checking that it is what arrives.
    expect(lod?.bounds.max.x).toBeCloseTo(25.4, 6)
    expect(result.current.absent.size).toBe(0)
  })

  it('does not pick it up while the epoch stands still', async () => {
    // The assertion that makes the epoch a real dependency rather than a
    // decoration. Same cache, same write, no bump — and a re-render on its own
    // is not enough, because the effect's other dependencies have not moved.
    const { cache, add } = mutableCache()
    const { result, rerender } = renderHook(
      ({ epoch }: { epoch: number }) =>
        useLodStore({ blobs: [BLOB], assets: ASSETS, enabled: true, fetchImpl: notFound, cache, epoch }),
      { initialProps: { epoch: 0 } },
    )
    await waitFor(() => {
      expect(result.current.absent.has(BLOB)).toBe(true)
    })

    add(record(BLOB))
    rerender({ epoch: 0 })
    rerender({ epoch: 0 })
    await waitFor(() => {
      expect(result.current.settled).toBe(true)
    })
    expect(result.current.geometries.size).toBe(0)
    expect(result.current.absent.has(BLOB)).toBe(true)

    // And it is genuinely the epoch that frees it, not time passing.
    rerender({ epoch: 1 })
    await waitFor(() => {
      expect(result.current.geometries.size).toBe(1)
    })
  })
})
