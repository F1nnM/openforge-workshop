/**
 * The append-only ordinal invariant.
 *
 * These run without the catalog fixtures on purpose. The invariant they guard —
 * §13's "manifest index drift", where a reordered import makes every existing
 * share link decode to a different room — is the one thing in this pipeline that
 * must be checked on every machine and every CI run, not only where the corpus
 * happens to be mounted. `catalog.test.ts` repeats the same scenario against the
 * real 8,702-tile corpus where it is available.
 */
import { describe, expect, it } from 'vitest'

import {
  assertAppendOnly,
  assignOrdinals,
  emptyManifest,
  serialiseManifest,
} from './ordinals'
import { OrdinalManifest } from './ordinals'

const A = 'tiles/a/one.stl'
const B = 'tiles/a/two.stl'
const C = 'tiles/a/three.stl'
const D = 'tiles/b/four.stl'
const E = 'tiles/b/five.stl'

describe('assignOrdinals', () => {
  it('numbers a first import from zero, in sorted order', () => {
    const { manifest, ordinalOf, added, retired } = assignOrdinals(emptyManifest(), [C, A, B])

    expect(manifest.ids).toEqual([A, C, B].sort())
    expect(added).toEqual([A, C, B].sort())
    expect(retired).toEqual([])
    expect(new Set(ordinalOf.values())).toEqual(new Set([0, 1, 2]))
  })

  it('does not depend on the order ids arrive in', () => {
    const forwards = assignOrdinals(emptyManifest(), [A, B, C, D, E])
    const backwards = assignOrdinals(emptyManifest(), [E, D, C, B, A])
    expect(backwards.manifest).toEqual(forwards.manifest)
  })

  /**
   * The scenario the whole design exists for: an import where the corpus has
   * both lost and gained tiles. Every id that already had a number keeps it, the
   * gone tile's number is not handed to anyone, and the new tiles go on the end.
   */
  it('keeps existing ordinals across a removal and additions', () => {
    const first = assignOrdinals(emptyManifest(), [A, B, C])
    const before = new Map(first.ordinalOf)

    const second = assignOrdinals(first.manifest, [A, C, D, E])

    expect(second.ordinalOf.get(A)).toBe(before.get(A))
    expect(second.ordinalOf.get(C)).toBe(before.get(C))
    expect(second.retired).toEqual([B])

    const retiredOrdinal = before.get(B)
    expect(retiredOrdinal).toBeDefined()
    expect([...second.ordinalOf.values()]).not.toContain(retiredOrdinal)

    const highestBefore = Math.max(...before.values())
    expect(second.ordinalOf.get(D)).toBeGreaterThan(highestBefore)
    expect(second.ordinalOf.get(E)).toBeGreaterThan(highestBefore)
  })

  it('gives a returning tile its original ordinal back', () => {
    const first = assignOrdinals(emptyManifest(), [A, B, C])
    const without = assignOrdinals(first.manifest, [A, C])
    const back = assignOrdinals(without.manifest, [A, B, C, D])

    expect(back.ordinalOf.get(B)).toBe(first.ordinalOf.get(B))
    expect(back.added).toEqual([D])
  })

  it('leaves ordinals sparse rather than compacting them', () => {
    // Removing the id that holds the *middle* ordinal, so a compacting
    // implementation would have to renumber and this test would see it.
    const first = assignOrdinals(emptyManifest(), [A, B, C])
    const middle = [...first.ordinalOf.entries()].find(([, ordinal]) => ordinal === 1)?.[0]
    expect(middle).toBeDefined()

    const survivors = [A, B, C].filter((id) => id !== middle)
    const second = assignOrdinals(first.manifest, survivors)

    expect(second.manifest.ids).toHaveLength(3)
    expect([...second.ordinalOf.values()].sort((x, y) => x - y)).toEqual([0, 2])
  })

  it('rejects a corpus containing the same id twice', () => {
    expect(() => assignOrdinals(emptyManifest(), [A, A])).toThrow(/duplicate tile id/)
  })
})

describe('assertAppendOnly', () => {
  const previous: OrdinalManifest = { manifest: 1, ids: [A, B, C] }

  it('accepts an extension', () => {
    expect(() => {
      assertAppendOnly(previous, { manifest: 1, ids: [A, B, C, D] })
    }).not.toThrow()
  })

  it('rejects a reordering, naming the ordinal that moved', () => {
    expect(() => {
      assertAppendOnly(previous, { manifest: 1, ids: [A, C, B] })
    }).toThrow(/ordinal 1 changed/)
  })

  it('rejects a manifest that dropped a retired slot', () => {
    expect(() => {
      assertAppendOnly(previous, { manifest: 1, ids: [A, B] })
    }).toThrow(/shrank/)
  })

  it('rejects an insertion in the middle, which shifts everything after it', () => {
    expect(() => {
      assertAppendOnly(previous, { manifest: 1, ids: [A, D, B, C] })
    }).toThrow(/ordinal 1 changed/)
  })
})

describe('serialiseManifest', () => {
  it('round-trips', () => {
    const manifest: OrdinalManifest = { manifest: 3, ids: [A, B, C] }
    expect(OrdinalManifest.parse(JSON.parse(serialiseManifest(manifest)))).toEqual(manifest)
  })

  it('writes one id per line, so an append shows up as an appended diff', () => {
    const before = serialiseManifest({ manifest: 1, ids: [A, B] })
    const after = serialiseManifest({ manifest: 1, ids: [A, B, C] })
    expect(after.startsWith(before.slice(0, before.indexOf(JSON.stringify(B))))).toBe(true)
    expect(after.split('\n').length).toBe(before.split('\n').length + 1)
  })

  it('handles an empty manifest', () => {
    expect(OrdinalManifest.parse(JSON.parse(serialiseManifest(emptyManifest())))).toEqual(emptyManifest())
  })
})
