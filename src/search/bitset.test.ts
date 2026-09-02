import { describe, expect, it } from 'vitest'

import {
  andInto,
  collectBits,
  createBitset,
  fullBitset,
  getBit,
  orInto,
  popcount,
  popcountAnd,
  setBit,
  wordCount,
} from './bitset'

describe('bitset geometry', () => {
  it('sizes to whole words', () => {
    expect(wordCount(0)).toBe(0)
    expect(wordCount(1)).toBe(1)
    expect(wordCount(32)).toBe(1)
    expect(wordCount(33)).toBe(2)
    // Both live populations, and neither is a whole number of words: the 3,822
    // aggregates the engine indexes (119 × 32 + 14) and the 8,702 files behind
    // them (271 × 32 + 30).
    expect(wordCount(3822)).toBe(120)
    expect(wordCount(8702)).toBe(272)
  })

  it('masks the tail so a full set counts exactly its population', () => {
    // The bug this guards: an unmasked tail reads correctly for every size that
    // is a multiple of 32 and over-counts for every size that is not — and
    // neither 3,822 nor 8,702 is, so the whole catalog would report 3,840 items
    // over 8,704 files.
    for (const size of [0, 1, 30, 31, 32, 33, 3822, 8702]) {
      expect(popcount(fullBitset(size))).toBe(size)
    }
  })
})

describe('bitset operations', () => {
  it('sets and reads individual members across word boundaries', () => {
    const bits = createBitset(100)
    for (const index of [0, 31, 32, 63, 64, 99]) setBit(bits, index)
    for (const index of [0, 31, 32, 63, 64, 99]) expect(getBit(bits, index)).toBe(true)
    for (const index of [1, 30, 33, 62, 65, 98]) expect(getBit(bits, index)).toBe(false)
    expect(popcount(bits)).toBe(6)
  })

  it('counts a high word correctly', () => {
    // popcountWord's final multiply overflows 2^31; using `*` instead of
    // Math.imul silently returns the wrong count for words like this one.
    const bits = createBitset(32)
    for (let i = 0; i < 32; i++) setBit(bits, i)
    expect(popcount(bits)).toBe(32)
  })

  it('intersects, unions, and counts an intersection without materialising it', () => {
    const evens = createBitset(200)
    const thirds = createBitset(200)
    for (let i = 0; i < 200; i += 2) setBit(evens, i)
    for (let i = 0; i < 200; i += 3) setBit(thirds, i)

    expect(popcountAnd(evens, thirds)).toBe(34) // multiples of 6 below 200

    const both = createBitset(200)
    both.set(evens)
    andInto(both, thirds)
    expect(popcount(both)).toBe(34)

    const either = createBitset(200)
    either.set(evens)
    orInto(either, thirds)
    expect(popcount(either)).toBe(100 + 67 - 34)
  })

  it('collects members in ascending order', () => {
    // Ascending order is what makes the unfiltered query sort-free and the
    // ranking deterministic; a word-at-a-time collector that walked bits from
    // the high end would be correct as a set and wrong as a result list.
    const bits = createBitset(300)
    const members = [299, 0, 64, 33, 32, 128, 1]
    for (const index of members) setBit(bits, index)
    expect(collectBits(bits, [])).toEqual([...members].sort((a, b) => a - b))
  })

  it('appends to the array it is given', () => {
    const bits = createBitset(8)
    setBit(bits, 3)
    expect(collectBits(bits, [-1])).toEqual([-1, 3])
  })
})
