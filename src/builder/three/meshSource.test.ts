/// <reference types="node" />
/**
 * The seam: one `BufferGeometry` per md5, from whichever store has it.
 *
 * This is the contract rows R2 and R3 are handed, so it is asserted as a
 * contract rather than as a pair of code paths. The three things that have to be
 * true:
 *
 *   1. **`/lod/` wins when it answers.** One 21 kB GLB against a 10.77 MB STL,
 *      so the day the B7 backfill runs the fallback stops firing on its own,
 *      with no line changed.
 *   2. **A 404 falls through to the converted cache.** That is what makes the
 *      3D builder draw anything at all today.
 *   3. **A real fault does not.** A corrupt store object is worth a retry and a
 *      report, and quietly converting 10.77 MB of STL to paper over it would
 *      hide the one failure the panel offers a retry for.
 *
 * The GLB half is a real one: `fixtures/wall-8180da93.glb` is a real archive
 * mesh through G1's real pipeline, with `PROVENANCE.md` beside it.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { BlobId } from '@/catalog'
import type { MeshCache, MeshRecord } from '@/mesh'
import { MESH_CACHE_VERSION } from '@/mesh'

import { LodAbsentError, LodLoadError, geometryFromRecord, loadMeshGeometry } from './loadLod'

const BLOB = '8180da93549154744c37f8370a82738f' as BlobId
const OTHER = 'f'.repeat(32) as BlobId
const ASSETS = { lod: 'https://objects.openforge.tools/lod' }

/**
 * The real fixture GLB, as a `Blob`.
 *
 * A `Blob` rather than the `Uint8Array`, because `BodyInit` does not admit a
 * typed array over `ArrayBufferLike` — which is what `readFileSync` returns —
 * and a `Blob` copies the bytes into one it owns.
 */
function glb(): Blob {
  return new Blob([readFileSync(join(import.meta.dirname, 'fixtures', 'wall-8180da93.glb'))])
}

/** A record shaped the way `src/mesh/convert.ts` writes one. */
function record(blob: string, triangles = 118): MeshRecord {
  const vertices = triangles + 2
  const positions = new Float32Array(vertices * 3)
  // A recognisable 25.4 mm extent, so the millimetre claim is checkable.
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

/** A cache over a `Map`. Only `get` is reached from this module. */
function cacheOf(records: readonly MeshRecord[]): MeshCache {
  const rows = new Map(records.map((one) => [one.blob, one]))
  return {
    get: (blob) => Promise.resolve(rows.get(blob)),
    have: (blobs) => Promise.resolve(new Set(blobs.filter((blob) => rows.has(blob)))),
    put: () => Promise.resolve(),
    stats: () => Promise.resolve({ count: rows.size, bytes: 0, budget: 0 }),
    clear: () => Promise.resolve(),
    close: () => undefined,
  }
}

function respond(status: number, body?: BodyInit, contentType = 'model/gltf-binary'): typeof fetch {
  return () =>
    Promise.resolve(
      new Response(status === 200 ? (body ?? null) : null, {
        status,
        headers: status === 200 ? { 'content-type': contentType } : {},
      }),
    )
}

describe('geometryFromRecord', () => {
  it('builds an indexed, normal-free geometry in millimetres', () => {
    const built = geometryFromRecord(record(BLOB))

    expect(built.source).toBe('converted')
    expect(built.blob).toBe(BLOB)
    expect(built.triangles).toBe(118)
    expect(built.geometry.getAttribute('position').count).toBe(120)
    expect(built.geometry.getIndex()?.count).toBe(118 * 3)
    // No NORMAL, for `bakeWorldMatrix`'s three reasons — and 12 bytes a vertex.
    expect(built.geometry.getAttribute('normal')).toBeUndefined()
    // No node transform to undo: the conversion emits millimetres directly,
    // which is the one structural difference from the `/lod/` path.
    expect(built.nodeScale).toBe(1)
    expect(built.bounds.max.x - built.bounds.min.x).toBeCloseTo(25.4, 1)
    built.dispose()
  })

  it('keeps the 16-bit index the conversion narrowed', () => {
    // `lod.ts`'s memory budget is computed against a two-byte index. Widening
    // it here would double the GPU cost of every in-band mesh, silently.
    const built = geometryFromRecord(record(BLOB))
    expect(built.geometry.getIndex()?.array).toBeInstanceOf(Uint16Array)
    expect(built.decodedBytes).toBe(120 * 3 * 4 + 118 * 3 * 2)
    built.dispose()
  })

  it('copies the arrays out of the record rather than adopting them', () => {
    const source = record(BLOB)
    const built = geometryFromRecord(source)
    built.dispose()
    // A `dispose()` that detached the record's own buffer would make a caller
    // holding the record for its readout fields read zeroes — a black mesh two
    // interactions later, with no error.
    expect(source.positions.byteLength).toBeGreaterThan(0)
    expect(source.indices.byteLength).toBeGreaterThan(0)
  })

  it('reports the source STL bytes, not zero, so a readout can say what was saved', () => {
    const built = geometryFromRecord(record(BLOB))
    expect(built.bytes).toBe(5_984)
    built.dispose()
  })
})

describe('loadMeshGeometry', () => {
  it('prefers /lod/ when the store answers', async () => {
    const loaded = await loadMeshGeometry(BLOB, {
      assets: ASSETS,
      fetchImpl: respond(200, glb()),
      cache: Promise.resolve(cacheOf([record(BLOB)])),
    })

    // Both stores had it; the GLB won. This is what makes the B7 backfill an
    // optimisation the app picks up for free.
    expect(loaded.source).toBe('lod')
    expect(loaded.nodeScale).toBeCloseTo(12.7, 1)
    loaded.dispose()
  })

  it('falls back to the converted cache on a 404', async () => {
    const loaded = await loadMeshGeometry(BLOB, {
      assets: ASSETS,
      fetchImpl: respond(404),
      cache: Promise.resolve(cacheOf([record(BLOB)])),
    })

    expect(loaded.source).toBe('converted')
    expect(loaded.triangles).toBe(118)
    loaded.dispose()
  })

  it('falls back on a 403 too, which is what an unconfigured bucket answers', async () => {
    const loaded = await loadMeshGeometry(BLOB, {
      assets: ASSETS,
      fetchImpl: respond(403),
      cache: Promise.resolve(cacheOf([record(BLOB)])),
    })
    expect(loaded.source).toBe('converted')
    loaded.dispose()
  })

  it('reports the absence when neither store has it', async () => {
    // Today's normal case for a design nobody added to the library: `/lod/` is
    // empty and nothing converted it.
    await expect(
      loadMeshGeometry(OTHER, {
        assets: ASSETS,
        fetchImpl: respond(404),
        cache: Promise.resolve(cacheOf([record(BLOB)])),
      }),
    ).rejects.toThrow(LodAbsentError)
  })

  it('reports the absence when there is no cache at all', async () => {
    await expect(
      loadMeshGeometry(BLOB, { assets: ASSETS, fetchImpl: respond(404), cache: Promise.resolve(null) }),
    ).rejects.toThrow(LodAbsentError)
    await expect(
      loadMeshGeometry(BLOB, { assets: ASSETS, fetchImpl: respond(404) }),
    ).rejects.toThrow(LodAbsentError)
  })

  it('reports the absence when the cache itself cannot be read', async () => {
    const broken: MeshCache = {
      ...cacheOf([]),
      get: () => Promise.reject(new Error('the database is closing')),
    }
    // A cache that cannot be read has the same outcome as an empty one: there
    // is no geometry. Reported as the absence it is, because a retry would fail
    // the same way.
    await expect(
      loadMeshGeometry(BLOB, {
        assets: ASSETS,
        fetchImpl: respond(404),
        cache: Promise.resolve(broken),
      }),
    ).rejects.toThrow(LodAbsentError)
  })

  it('does not convert around a real store fault', async () => {
    // A CDN error page served with a 200. The fallback must not fire: a corrupt
    // store object is worth a retry and a report, and papering over it with a
    // 10.77 MB download would hide the one failure the panel retries.
    await expect(
      loadMeshGeometry(BLOB, {
        assets: ASSETS,
        fetchImpl: respond(200, '<html>nope</html>', 'model/gltf-binary'),
        cache: Promise.resolve(cacheOf([record(BLOB)])),
      }),
    ).rejects.toThrow(LodLoadError)

    await expect(
      loadMeshGeometry(BLOB, {
        assets: ASSETS,
        fetchImpl: respond(500),
        cache: Promise.resolve(cacheOf([record(BLOB)])),
      }),
    ).rejects.toThrow(LodLoadError)
  })

  it('treats a record from an older conversion as an absence', async () => {
    const stale = { ...record(BLOB), version: MESH_CACHE_VERSION - 1 }
    // `cache.get` already filters these; this is the second gate, so a cache
    // implementation that did not would still not put mismatched geometry in a
    // scene.
    await expect(
      loadMeshGeometry(BLOB, {
        assets: ASSETS,
        fetchImpl: respond(404),
        cache: Promise.resolve(cacheOf([stale])),
      }),
    ).rejects.toThrow(LodAbsentError)
  })

  it('hands both sources the same shape, so R2 cannot tell them apart', async () => {
    const fromStore = await loadMeshGeometry(BLOB, {
      assets: ASSETS,
      fetchImpl: respond(200, glb()),
      cache: Promise.resolve(cacheOf([record(BLOB)])),
    })
    const fromCache = await loadMeshGeometry(BLOB, {
      assets: ASSETS,
      fetchImpl: respond(404),
      cache: Promise.resolve(cacheOf([record(BLOB)])),
    })

    // The contract, enumerated: same keys, same types, positions in millimetres,
    // indexed, no normals. `source` is the only field that differs in kind, and
    // it exists for the readout.
    expect(Object.keys(fromCache).sort()).toEqual(Object.keys(fromStore).sort())
    for (const loaded of [fromStore, fromCache]) {
      expect(loaded.geometry.getIndex()).not.toBeNull()
      expect(loaded.geometry.getAttribute('normal')).toBeUndefined()
      expect(loaded.bounds.max.x - loaded.bounds.min.x).toBeGreaterThan(10)
      expect(loaded.triangles).toBeGreaterThan(0)
      expect(typeof loaded.footprintDelta({ w: 1, d: 1 }).worst).toBe('number')
      loaded.dispose()
    }
  })
})
