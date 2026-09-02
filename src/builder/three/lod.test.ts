/// <reference types="node" />
/**
 * The store's URL shape, its memory budget, and the corpus it exists for.
 *
 * ## What these tests prove
 *
 *   - The LOD URL builder and the *download* URL builder each refuse the other's
 *     output. That is §10 obligation 3 — a preview mesh must never reach
 *     somebody's printer — held up structurally rather than by convention, and
 *     it is checked in both directions because only one of them was there before
 *     this row.
 *   - The object budget is arithmetic over `src/three/gate.ts`'s own measured
 *     ceiling, not a number somebody liked. **150** distinct meshes.
 *   - The corpus figures the row's case rests on, re-derived from the emitted
 *     index: the 978 tiles the STL gate refuses, which are exactly the ones this
 *     store gives a 3D path to, and the 8,353 distinct md5s the store will hold.
 *   - `assets.lod` is really in the index, so this row does not have to
 *     reconstruct it by swapping a path segment the way `tools/lod/catalog.ts`
 *     still does.
 *
 * ## What they cannot prove
 *
 * Nothing here touches the network or a renderer, and the corpus block reads the
 * *emitted* index — so it is skipped, not failed, on a checkout where
 * `npm run import:catalog` has not been run. `src/three/gate.test.ts` makes the
 * same trade for the same reason.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { BlobId, CatalogFile } from '@/catalog'
import { CatalogFile as CatalogFileSchema } from '@/catalog'
import { PreviewMeshRefusedError, originalStlUrl } from '@/download'
import { STL_GATE_BYTES, estimateGeometryBytes } from '@/three/gate'

import {
  LOD_ABSENT_IS_EXPECTED,
  LOD_GLB_URL,
  LOD_LEVELS,
  LOD_MAX_TRIANGLES,
  LOD_MIN_TRIANGLES,
  LOD_PROJECTED_BYTES,
  LOD_PROJECTED_OBJECTS,
  LOD_ROOM_BUDGET_BYTES,
  LOD_VERTICES_PER_TRIANGLE,
  LodUrlError,
  lodBudgetRefusal,
  lodGeometryBytes,
  lodGlbUrl,
  lodObjectBudget,
} from './lod'

const BLOB = '8180da93549154744c37f8370a82738f' as BlobId
const LOD_BASE = 'https://objects.openforge.tools/lod'
const MODELS_BASE = 'https://objects.openforge.tools/models'

const CATALOG_PATH = join(process.cwd(), 'public', 'catalog', 'catalog.json')

function emittedCatalog(): CatalogFile | null {
  if (!existsSync(CATALOG_PATH)) return null
  return CatalogFileSchema.parse(JSON.parse(readFileSync(CATALOG_PATH, 'utf8')))
}

/* ------------------------------------------------------------------- the URL */

describe('lodGlbUrl', () => {
  it('shards on the first six hex characters, as G1’s key does', () => {
    expect(lodGlbUrl({ lod: LOD_BASE }, BLOB)).toBe(
      'https://objects.openforge.tools/lod/8180da/8180da93549154744c37f8370a82738f.glb',
    )
  })

  it('tolerates a trailing slash on the base, which the fixture index has', () => {
    expect(lodGlbUrl({ lod: `${LOD_BASE}/` }, BLOB)).toBe(lodGlbUrl({ lod: LOD_BASE }, BLOB))
  })

  it('refuses a base pointing at the models bucket', () => {
    // The failure this prevents: a misconfigured base streaming 108 GB of
    // printable STL into a preview, one 25 MB tile at a time.
    expect(() => lodGlbUrl({ lod: MODELS_BASE }, BLOB)).toThrow(LodUrlError)
    expect(() => lodGlbUrl({ lod: 'https://objects.openforge.tools/sprites' }, BLOB)).toThrow(LodUrlError)
    expect(() => lodGlbUrl({ lod: 'http://objects.openforge.tools/lod' }, BLOB)).toThrow(/URL shape/)
  })

  it('allows an intermediate prefix, so the bucket can move', () => {
    expect(lodGlbUrl({ lod: 'https://cdn.example/openforge/lod' }, BLOB)).toContain('/openforge/lod/8180da/')
  })

  it('rejects a blob that is not a full md5', () => {
    expect(() => lodGlbUrl({ lod: LOD_BASE }, '8180da93' as BlobId)).toThrow(LodUrlError)
    expect(() => lodGlbUrl({ lod: LOD_BASE }, 'NOTHEX93549154744c37f8370a82738f' as BlobId)).toThrow(LodUrlError)
  })
})

describe('the two URL builders each refuse the other’s store', () => {
  it('the download path refuses the LOD base', () => {
    // `DERIVATIVE_PATH_SEGMENTS` in src/download/source.ts already named `lod`
    // before this row existed. This is the assertion that it still bites.
    expect(() => originalStlUrl({ models: LOD_BASE }, BLOB)).toThrow(PreviewMeshRefusedError)
  })

  it('this row refuses the models base', () => {
    expect(() => lodGlbUrl({ lod: MODELS_BASE }, BLOB)).toThrow(LodUrlError)
  })

  it('and neither regex accepts the other’s path', () => {
    const stl = originalStlUrl({ models: MODELS_BASE }, BLOB)
    const glb = lodGlbUrl({ lod: LOD_BASE }, BLOB)
    expect(LOD_GLB_URL.test(stl)).toBe(false)
    expect(LOD_GLB_URL.test(glb)).toBe(true)
    expect(glb.endsWith('.glb')).toBe(true)
    expect(stl.endsWith('.stl')).toBe(true)
  })
})

/* ---------------------------------------------------------------- the budget */

describe('the memory budget', () => {
  it('sizes a ceiling object at 240 kB, positions and index only', () => {
    // 20,000 triangles over 10,000 vertices: 10,000 × 3 × float32 for POSITION
    // and 60,000 × uint16 for the index. No NORMAL, which is 120 kB the store
    // does not spend.
    expect(LOD_VERTICES_PER_TRIANGLE).toBe(0.5)
    expect(lodGeometryBytes(LOD_MAX_TRIANGLES)).toBe(240_000)
    expect(lodGeometryBytes(LOD_MIN_TRIANGLES)).toBe(60_000)
  })

  it('borrows its ceiling from the STL gate rather than inventing one', () => {
    // gate.ts already decided how much typed array one 3D view of this archive
    // may hold: a 24 MiB STL, which is 36.24 MB of positions and normals.
    expect(LOD_ROOM_BUDGET_BYTES).toBe(estimateGeometryBytes(STL_GATE_BYTES))
    expect(LOD_ROOM_BUDGET_BYTES).toBe(36_238_608)
  })

  it('allows 150 distinct meshes in one room', () => {
    expect(lodObjectBudget()).toBe(150)
    // Instancing is what makes "distinct meshes" the right axis: a further
    // *placement* of a mesh already loaded costs one 4×4 matrix and no bytes.
    expect(lodObjectBudget() * lodGeometryBytes()).toBeLessThanOrEqual(LOD_ROOM_BUDGET_BYTES)
    expect((lodObjectBudget() + 1) * lodGeometryBytes()).toBeGreaterThan(LOD_ROOM_BUDGET_BYTES)
  })

  it('never returns zero, however small the budget is made', () => {
    expect(lodObjectBudget(1)).toBe(1)
  })

  it('explains a refusal with both numbers in it', () => {
    const refusal = lodBudgetRefusal(400)
    expect(refusal).toContain('400')
    expect(refusal).toContain('150')
    expect(refusal).toContain('plan view')
  })
})

describe('the format constants', () => {
  it('holds one level, because an InstancedMesh shares one geometry', () => {
    expect(LOD_LEVELS).toBe(1)
  })

  it('says an absence is expected, because nothing is uploaded', () => {
    // Blocker B2. Flip this when the backfill lands; until then the panel's copy
    // reads off it.
    expect(LOD_ABSENT_IS_EXPECTED).toBe(true)
  })

  it('projects G1’s totals: 8,353 objects and 176.1 MB', () => {
    expect(LOD_PROJECTED_OBJECTS).toBe(8_353)
    // ~21.1 kB an object, which is why a whole room is a couple of megabytes.
    expect(LOD_PROJECTED_BYTES / LOD_PROJECTED_OBJECTS).toBeCloseTo(21_082, 0)
  })
})

/* ---------------------------------------------------------------- the corpus */

describe('the corpus this store exists for', () => {
  const file = emittedCatalog()

  it.runIf(file !== null)('states the LOD base in the index, so nothing has to derive it', () => {
    // tools/lod/catalog.ts reconstructs this base by swapping the last path
    // segment of `assets.models`, with a docblock asking for the field. The
    // field is here — that derivation is now a redundant inference.
    expect(file?.assets.lod).toBe('https://objects.openforge.tools/lod')
    expect(LOD_GLB_URL.test(lodGlbUrl({ lod: file?.assets.lod ?? '' }, BLOB))).toBe(true)
  })

  it.runIf(file !== null)('will hold one object per distinct md5 — 8,353 of them', () => {
    const records = file?.records ?? []
    expect(records).toHaveLength(8_702)
    expect(new Set(records.map((record) => record.blob)).size).toBe(LOD_PROJECTED_OBJECTS)
  })

  it.runIf(file !== null)('gives 978 tiles their first 3D path, over 957 md5s', () => {
    // The tiles src/three/gate.ts refuses: 11.24% of the archive, with no 3D
    // path at all today. There is no size gate on this side because a LOD object
    // is 5,000–20,000 triangles whatever its source was.
    const refused = (file?.records ?? []).filter(
      (record) => !Number.isFinite(record.bytes) || record.bytes <= 0 || record.bytes > STL_GATE_BYTES,
    )
    expect(refused).toHaveLength(978)
    expect(refused.length / (file?.records.length ?? 1)).toBeCloseTo(0.1124, 4)
    expect(new Set(refused.map((record) => record.blob)).size).toBe(957)
  })

  it.runIf(file !== null)('holds every one of them inside the ceiling once decimated', () => {
    // The claim the gate cannot make: after G1, the largest object in the store
    // is 20,000 triangles, so the biggest source mesh in the archive costs the
    // same 240 kB as the median one.
    expect(lodGeometryBytes(LOD_MAX_TRIANGLES)).toBeLessThan(estimateGeometryBytes(STL_GATE_BYTES) / 100)
  })
})
