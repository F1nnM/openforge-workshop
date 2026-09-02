/**
 * The work list and the object keys.
 *
 * Two things matter here and both are silent failures if wrong: the md5 dedupe
 * (349 catalog rows share a mesh with another row, and keying on `id` would fetch
 * and decimate those twice) and the derived `/lod/` base, which is derived rather
 * than hardcoded precisely so the key and the public URL cannot drift apart.
 */
import { describe, expect, it } from 'vitest'

import { STL_GATE_BYTES, aboveGate, lodBase, lodKey, lodPath, lodPrefix, lodUrl, meshTargets, modelUrl } from './catalog'
import { asBlob, testCatalog } from './fixtures/catalog'

const A = asBlob('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
const B = asBlob('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
const C = asBlob('cccccccccccccccccccccccccccccccc')

describe('meshTargets', () => {
  it('collapses rows that share a mesh, keeping every id and design', () => {
    const file = testCatalog({
      records: [
        { id: 'tiles/one/a.stl', ord: 5, blob: A, design: 'd1' },
        { id: 'tiles/two/a.stl', ord: 2, blob: A, design: 'd2' },
        { id: 'tiles/three/b.stl', ord: 9, blob: B, design: 'd1' },
      ],
    })
    const { targets, records, deduped, designs } = meshTargets(file)

    expect(records).toBe(3)
    expect(targets).toHaveLength(2)
    expect(deduped).toBe(1)
    expect(designs).toBe(2)

    const first = targets[0]
    // Lowest ordinal wins the target's identity, and the list is in display order.
    expect(first?.ord).toBe(2)
    expect(first?.ids).toEqual(['tiles/two/a.stl', 'tiles/one/a.stl'])
    expect(first?.designs).toEqual(['d2', 'd1'])
  })

  it('flags targets the STL gate refuses', () => {
    const file = testCatalog({
      records: [
        { id: 'tiles/small.stl', ord: 0, blob: A, bytes: 1_000_000 },
        { id: 'tiles/huge.stl', ord: 1, blob: B, bytes: STL_GATE_BYTES + 1 },
        { id: 'tiles/edge.stl', ord: 2, blob: C, bytes: STL_GATE_BYTES },
      ],
    })
    const { targets } = meshTargets(file)
    expect(targets.map((target) => target.aboveGate)).toEqual([false, true, false])
  })
})

describe('aboveGate', () => {
  it('counts tiles with no 3D path, and their share', () => {
    const file = testCatalog({
      records: [
        { id: 'tiles/a.stl', ord: 0, blob: A, bytes: 1 },
        { id: 'tiles/b.stl', ord: 1, blob: B, bytes: STL_GATE_BYTES + 1 },
        { id: 'tiles/b2.stl', ord: 2, blob: B, bytes: STL_GATE_BYTES + 1 },
        { id: 'tiles/c.stl', ord: 3, blob: C, bytes: STL_GATE_BYTES * 2 },
      ],
    })
    const gate = aboveGate(file)
    expect(gate.tiles).toBe(3)
    // Two of those three tiles are the same mesh: the store needs two objects.
    expect(gate.blobs).toBe(2)
    expect(gate.share).toBeCloseTo(0.75, 6)
  })

  it('mirrors src/three/gate.ts at 24 MiB', () => {
    expect(STL_GATE_BYTES).toBe(25_165_824)
  })
})

describe('paths', () => {
  const file = testCatalog({ records: [{ id: 'tiles/a.stl', ord: 0, blob: A }] })

  it('derives the LOD base by swapping the models segment', () => {
    expect(lodBase(file)).toBe('https://objects.example.test/lod')
    expect(lodPrefix(file)).toBe('lod')
  })

  it('shards the key and the URL the same way the bucket does', () => {
    expect(modelUrl(file, A)).toBe(`https://objects.example.test/models/aaaaaa/${A}.stl`)
    expect(lodUrl(file, A)).toBe(`https://objects.example.test/lod/aaaaaa/${A}.glb`)
    expect(lodKey(file, A)).toBe(`lod/aaaaaa/${A}.glb`)
    expect(lodPath(file, A, '/tmp/out')).toBe(`/tmp/out/lod/aaaaaa/${A}.glb`)
  })

  it('keeps a nested prefix, so a bucket layout change does not silently flatten', () => {
    // `lodBase` reads `assets.lod` now that the schema carries it, rather than
    // inferring it by swapping the last segment of `assets.models`. A declared
    // field beats a derived one — but the fixture has to declare both, because
    // the invariant below is what the inference used to give for free.
    const nested = testCatalog({
      records: [{ id: 'tiles/a.stl', ord: 0, blob: A }],
      models: 'https://objects.example.test/assets/v2/models',
      lod: 'https://objects.example.test/assets/v2/lod',
    })
    expect(lodBase(nested)).toBe('https://objects.example.test/assets/v2/lod')
    expect(lodPrefix(nested)).toBe('assets/v2/lod')
    expect(lodKey(nested, A)).toBe(`assets/v2/lod/aaaaaa/${A}.glb`)
  })

  it('refuses a store that is not beside the meshes, which a declared field can be', () => {
    // The failure this catches is quiet and expensive: every mesh URL points at a
    // host nobody uploaded to, and the symptom is 8,353 absences reported as
    // "the store has not been built yet".
    expect(() =>
      lodBase(
        testCatalog({
          records: [{ id: 'tiles/a.stl', ord: 0, blob: A }],
          models: 'https://objects.example.test/assets/v2/models',
          lod: 'https://cdn.other.test/assets/v2/lod',
        }),
      ),
    ).toThrow(/must share the origin/)

    expect(() =>
      lodBase(
        testCatalog({
          records: [{ id: 'tiles/a.stl', ord: 0, blob: A }],
          models: 'https://objects.example.test/assets/v2/models',
          lod: 'https://objects.example.test/elsewhere/lod',
        }),
      ),
    ).toThrow(/must share the origin/)
  })

  it('refuses a base with no path segment at all', () => {
    const rootless = testCatalog({
      records: [{ id: 'tiles/a.stl', ord: 0, blob: A }],
      models: 'https://objects.example.test/',
      lod: 'https://objects.example.test/',
    })
    expect(() => lodBase(rootless)).toThrow(/no path segment/)
  })
})
