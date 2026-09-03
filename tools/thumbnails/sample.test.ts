/**
 * The sample, which has to be the same sample twice or the cache is pointless
 * and two machines' numbers are incomparable.
 */
import { describe, expect, it } from 'vitest'

import { BlobId } from '../../src/catalog'

import type { SheetTarget } from './catalog'
import { blobOf } from './fixtures/catalog'
import { DEFAULT_SAMPLE_SIZE, selectAll, selectSample, selectScreenful, strataCounts } from './sample'

/** 40 targets over four textures, with size rising as the ordinal falls. */
const targets: SheetTarget[] = Array.from({ length: 40 }, (_, i) => ({
  blob: BlobId.parse(blobOf(`${String(i).padStart(2, '0')}aaaaaaaabbbbbbbbccccccccdddd`)),
  ord: i,
  ids: [`tiles/t${String(i % 4)}/tile-${String(i)}.stl`],
  texture: `texture-${String(i % 4)}`,
  bytes: 1_000_000 * (40 - i),
}))

describe('selectSample', () => {
  it('is deterministic', () => {
    const once = selectSample(targets, { limit: 12 })
    const twice = selectSample(targets, { limit: 12 })
    expect(once.map((pick) => pick.target.blob)).toEqual(twice.map((pick) => pick.target.blob))
  })

  it('leads with the screenful in display order, because that is what PR 13 measured', () => {
    const picks = selectSample(targets, { limit: 20, cards: 12 })
    expect(picks.slice(0, 12).map((pick) => pick.target.ord)).toEqual([...Array(12).keys()])
    expect(strataCounts(picks).screenful).toBe(12)
  })

  it('covers every texture root once the limit allows it', () => {
    const picks = selectSample(targets, { limit: 20, cards: 2 })
    const textures = new Set(picks.map((pick) => pick.target.texture))
    expect(textures).toEqual(new Set(['texture-0', 'texture-1', 'texture-2', 'texture-3']))
  })

  it('fills the rest with the heaviest meshes', () => {
    // Two from the screenful (ordinals 0 and 1, textures 0 and 1), two more to
    // finish the texture coverage (ordinals 2 and 3), then the heaviest.
    const picks = selectSample(targets, { limit: 8, cards: 2 })
    expect(strataCounts(picks)).toEqual({ screenful: 2, texture: 2, heaviest: 4, all: 0 })
    const heaviest = picks.filter((pick) => pick.reason === 'heaviest')
    expect(heaviest.map((pick) => pick.target.ord)).toEqual([4, 5, 6, 7])
  })

  it('never selects a sheet twice', () => {
    const picks = selectSample(targets, { limit: 40 })
    expect(new Set(picks.map((pick) => pick.target.blob)).size).toBe(picks.length)
  })

  it('honours the limit exactly, and stops short when the corpus is smaller', () => {
    expect(selectSample(targets, { limit: 5 })).toHaveLength(5)
    expect(selectSample(targets.slice(0, 3), { limit: 30 })).toHaveLength(3)
  })

  it('refuses an empty sample rather than reporting zeroes as a success', () => {
    expect(() => selectSample(targets, { limit: 0 })).toThrow(/must be positive/)
  })

  it('defaults wide enough to cover the 37 texture roots and a screenful', () => {
    // 37 since D3 collapsed `texture|foundations`; the bound is deliberately the
    // old 38 plus the screenful, so a re-split does not silently undersample.
    expect(DEFAULT_SAMPLE_SIZE).toBeGreaterThanOrEqual(38 + 12)
  })
})

describe('selectScreenful and selectAll', () => {
  it('takes the first n in display order', () => {
    expect(selectScreenful(targets, 3).map((pick) => pick.target.ord)).toEqual([0, 1, 2])
  })

  it('takes everything, in display order', () => {
    const picks = selectAll(targets)
    expect(picks).toHaveLength(targets.length)
    expect(picks.map((pick) => pick.target.ord)).toEqual([...Array(40).keys()])
  })
})
