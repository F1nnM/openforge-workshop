/**
 * Which meshes a default run pulls.
 *
 * The stratum that has to be right is `gate`: the whole coverage claim of this
 * row is that the tiles the STL gate refuses get an object, and a sample that
 * happened to miss them would report a healthy run having tested nothing hard.
 */
import { describe, expect, it } from 'vitest'

import type { MeshTarget } from './catalog'
import { STL_GATE_BYTES } from './catalog'
import { DEFAULT_SAMPLE_SIZE, selectAboveGate, selectAll, selectSample, spread, strataCounts } from './sample'
import { asBlob } from './fixtures/catalog'

/**
 * The real corpus's size distribution, in twentieths.
 *
 * Measured over the **8,353 distinct md5s** in `catalog.json` (not the 8,702
 * records — 349 of those share a mesh with another row): min 84 B, median
 * 10.77 MB, max 108.91 MB, and **957 blobs (11.46%) above the 24 MiB gate**.
 * A synthetic power-law corpus cannot reproduce both the median and the gate
 * share at once, and getting either wrong makes the stratification assertions
 * below test nothing, so the shape is taken from the data.
 */
const CORPUS_VIGINTILES = [
  84, 257_781, 680_262, 1_375_676, 2_518_484, 3_871_184, 5_637_684, 6_867_884, 7_979_784,
  9_267_584, 10_765_784, 11_922_484, 13_207_084, 14_661_984, 16_268_484, 18_312_784, 20_302_684,
  22_699_384, 26_601_384, 33_077_384, 108_912_184,
] as const

/** The measured median over distinct meshes. */
const CORPUS_MEDIAN = 10_765_784

/** `count` targets whose sizes follow {@link CORPUS_VIGINTILES}, interpolated. */
function corpus(count: number): MeshTarget[] {
  return Array.from({ length: count }, (_, index) => {
    const position = (index / (count - 1)) * (CORPUS_VIGINTILES.length - 1)
    const lower = Math.floor(position)
    const upper = Math.min(CORPUS_VIGINTILES.length - 1, lower + 1)
    const blend = position - lower
    const bytes = Math.round(
      (CORPUS_VIGINTILES[lower] ?? 0) * (1 - blend) + (CORPUS_VIGINTILES[upper] ?? 0) * blend,
    )
    return {
      blob: asBlob(index.toString(16).padStart(32, '0')),
      ord: index,
      ids: [`tiles/t${String(index)}.stl`],
      designs: [`d${String(index % 7)}`],
      bytes,
      aboveGate: bytes > STL_GATE_BYTES,
    }
  })
}

describe('selectSample', () => {
  const targets = corpus(400)

  it('is deterministic', () => {
    const first = selectSample(targets).map((pick) => pick.target.blob)
    const second = selectSample(targets).map((pick) => pick.target.blob)
    expect(first).toEqual(second)
  })

  it('respects the limit and defaults to a runnable size', () => {
    expect(selectSample(targets)).toHaveLength(DEFAULT_SAMPLE_SIZE)
    expect(selectSample(targets, { limit: 12 })).toHaveLength(12)
  })

  it('draws at least a third from above the gate', () => {
    const picks = selectSample(targets, { limit: 36 })
    const gated = picks.filter((pick) => pick.target.aboveGate)
    expect(gated.length).toBeGreaterThanOrEqual(12)
  })

  it('spans the size range rather than clustering at one end', () => {
    const picks = selectSample(targets, { limit: 36 })
    const sizes = picks.map((pick) => pick.target.bytes)
    expect(Math.min(...sizes)).toBeLessThan(1_000)
    expect(Math.max(...sizes)).toBeGreaterThan(100_000_000)
    // At least a quarter of the sample sits below the corpus median, so the
    // report is not an account of the heavy tail alone.
    expect(sizes.filter((size) => size < CORPUS_MEDIAN).length).toBeGreaterThanOrEqual(9)
  })

  it('includes the degenerate smallest mesh, which must be reported not crashed on', () => {
    const picks = selectSample(targets, { limit: 36 })
    expect(picks.some((pick) => pick.target.bytes === 84)).toBe(true)
  })

  it('comes back in display order, so a partial run is a prefix', () => {
    const ords = selectSample(targets, { limit: 20 }).map((pick) => pick.target.ord)
    expect([...ords].sort((a, b) => a - b)).toEqual(ords)
  })

  it('never picks the same mesh twice', () => {
    const picks = selectSample(targets, { limit: DEFAULT_SAMPLE_SIZE })
    expect(new Set(picks.map((pick) => pick.target.blob)).size).toBe(picks.length)
  })

  it('refuses an empty sample, which would read as a successful run of nothing', () => {
    expect(() => selectSample(targets, { limit: 0 })).toThrow(/positive/)
  })

  it('labels every pick with the stratum that chose it', () => {
    const counts = strataCounts(selectSample(targets, { limit: 36 }))
    expect(counts.gate).toBeGreaterThan(0)
    expect(counts.gate + counts.decile + counts.smallest + counts.spread).toBe(36)
  })
})

describe('the presets', () => {
  const targets = corpus(50)

  it('--all takes everything in display order', () => {
    const picks = selectAll(targets)
    expect(picks).toHaveLength(50)
    expect(picks[0]?.target.ord).toBe(0)
  })

  it('--above-gate takes exactly the meshes with no 3D path', () => {
    const picks = selectAboveGate(targets)
    expect(picks.length).toBe(targets.filter((target) => target.aboveGate).length)
    expect(picks.every((pick) => pick.target.aboveGate)).toBe(true)
  })
})

describe('spread', () => {
  it('includes both endpoints', () => {
    expect(spread([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 3)).toEqual([0, 5, 9])
  })

  it('degrades to the whole list when asked for more than it holds', () => {
    expect(spread([1, 2], 5)).toEqual([1, 2])
    expect(spread([], 5)).toEqual([])
    expect(spread([1, 2, 3], 0)).toEqual([])
  })
})
