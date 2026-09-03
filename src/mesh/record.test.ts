/**
 * The eviction policy, and the arithmetic that says it will hardly ever run.
 */
import { describe, expect, it } from 'vitest'

import { MESH_CACHE_BUDGET_BYTES, evictionPlan, meshRecordBytes } from './record'

function entry(blob: string, bytes: number, usedAt: number) {
  return { blob, bytes, usedAt }
}

describe('evictionPlan', () => {
  it('drops nothing when the cache is inside its budget', () => {
    expect(evictionPlan([entry('a', 10, 1), entry('b', 10, 2)], 100)).toEqual([])
    // The boundary, exactly at the budget, is inside it.
    expect(evictionPlan([entry('a', 50, 1), entry('b', 50, 2)], 100)).toEqual([])
  })

  it('drops least-recently-used first, and only as many as it needs to', () => {
    const plan = evictionPlan(
      [entry('newest', 40, 300), entry('oldest', 40, 100), entry('middle', 40, 200)],
      100,
    )
    // 120 held against 100: one 40-byte entry is enough, and it is the oldest.
    expect(plan).toEqual(['oldest'])
  })

  it('keeps going when one eviction is not enough', () => {
    const plan = evictionPlan(
      [entry('a', 40, 100), entry('b', 40, 200), entry('c', 40, 300), entry('d', 40, 400)],
      50,
    )
    expect(plan).toEqual(['a', 'b', 'c'])
  })

  it('is a pure function of its input, ties included', () => {
    // Two entries with the same `usedAt` — which happens, because `Date.now()`
    // has millisecond resolution and a batch of conversions settles inside one.
    const same = [entry('b', 40, 100), entry('a', 40, 100), entry('c', 40, 500)]
    expect(evictionPlan(same, 50)).toEqual(evictionPlan([...same].reverse(), 50))
    expect(evictionPlan(same, 50)).toEqual(['a', 'b'])
  })

  it('does not mutate what it was given', () => {
    const entries = [entry('c', 40, 300), entry('a', 40, 100)]
    evictionPlan(entries, 10)
    expect(entries.map((one) => one.blob)).toEqual(['c', 'a'])
  })
})

describe('what the budget buys', () => {
  it('counts only the typed arrays, because that is what the browser stores', () => {
    const record = {
      positions: new Float32Array(2_325 * 3),
      indices: new Uint16Array(5_000 * 3),
    }
    // The measured shape of a floor-of-the-band mesh: 2,325 vertices and 5,000
    // triangles is 27.9 kB of positions and 30 kB of 16-bit indices.
    expect(meshRecordBytes(record)).toBe(2_325 * 3 * 4 + 5_000 * 3 * 2)
    expect(meshRecordBytes(record)).toBeLessThan(60_000)
  })

  it('holds about seven hundred designs, which is why it will not evict', () => {
    // 58 kB per mesh measured on the starter set, 1.54 lock-reachable meshes per
    // design measured over the whole corpus. This is the number the eviction
    // story rests on, so it is stated as an assertion rather than as prose.
    const perMesh = 2_325 * 3 * 4 + 5_000 * 3 * 2
    const meshes = Math.floor(MESH_CACHE_BUDGET_BYTES / perMesh)
    expect(meshes).toBeGreaterThan(1_000)
    expect(Math.floor(meshes / 1.54)).toBeGreaterThan(600)
    // And the whole 3,822-design corpus does not fit, which is why the policy
    // exists at all rather than being replaced by "keep everything".
    expect(Math.floor(meshes / 1.54)).toBeLessThan(3_822)
  })
})
