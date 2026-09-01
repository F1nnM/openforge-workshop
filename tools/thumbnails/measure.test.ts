/**
 * The arithmetic behind the claims in the PR description.
 *
 * These are the numbers a reader is asked to believe, so the statistics that
 * produce them are pinned: a median that silently became a mean, or a reduction
 * factor computed the wrong way up, would turn a real 150× improvement into a
 * fabricated one.
 */
import { describe, expect, it } from 'vitest'

import { MEASURED_SPRITE_SHEET } from '../../src/catalog'

import { PR13, formatBytes, measure, percentile, spread } from './measure'
import type { ThumbStat } from './measure'
import { sheetExtent } from './geometry'

const stat = (thumbBytes: number, sheetBytes: number, reason: ThumbStat['reason'] = 'texture'): ThumbStat => ({
  blob: 'x',
  reason,
  thumbBytes,
  sheetBytes,
})

describe('spread', () => {
  it('reports the whole distribution, not just a mean', () => {
    const result = spread([1, 2, 3, 4, 100])
    expect(result.count).toBe(5)
    expect(result.total).toBe(110)
    expect(result.mean).toBe(22)
    expect(result.median).toBe(3)
    expect(result.min).toBe(1)
    expect(result.max).toBe(100)
    expect(result.stdev).toBeGreaterThan(38)
  })

  it('refuses an empty sample', () => {
    expect(() => spread([])).toThrow(/empty sample/)
  })
})

describe('percentile', () => {
  it('interpolates', () => {
    expect(percentile([0, 10], 50)).toBe(5)
    expect(percentile([0, 1, 2, 3, 4], 95)).toBeCloseTo(3.8, 6)
  })

  it('is the single value for a one-element sample', () => {
    expect(percentile([7], 95)).toBe(7)
  })
})

describe('measure', () => {
  const options = {
    corpus: { ...PR13, tiles: 8701, sheets: 8701 },
    sheetExtent: sheetExtent(MEASURED_SPRITE_SHEET),
    thumbSize: 256,
    elapsedMs: 1234,
  }

  it('divides sheets by thumbnails, not the other way round', () => {
    const result = measure([stat(1000, 100_000), stat(1000, 100_000)], options)
    expect(result.reductionOverall).toBeCloseTo(100, 6)
    expect(result.reductionMedian).toBeCloseTo(100, 6)
  })

  it('measures the screenful from the screenful stratum alone', () => {
    const result = measure(
      [stat(1000, 700_000, 'screenful'), stat(1000, 700_000, 'screenful'), stat(9000, 100_000, 'heaviest')],
      options,
    )
    expect(result.screenful.cards).toBe(2)
    expect(result.screenful.sheetBytes).toBe(1_400_000)
    expect(result.screenful.thumbBytes).toBe(2000)
    expect(result.screenful.complete).toBe(false)
  })

  it('flags a complete viewport once the stratum reaches PR 13’s 12 cards', () => {
    const stats = Array.from({ length: 12 }, () => stat(1000, 700_000, 'screenful'))
    expect(measure(stats, options).screenful.complete).toBe(true)
  })

  it('projects the 60-card run against PR 13’s measured 42.06 MB', () => {
    const result = measure([stat(5000, 700_000)], options)
    expect(result.cardRun.cards).toBe(60)
    // Decimal MB, not MiB: 42.06e6 / 60 reproduces PR 13's own 685 KiB per-card
    // mean, where a MiB reading would give 735 KiB and contradict it.
    expect(result.cardRun.sheetBytes).toBe(42_060_000)
    expect(result.cardRun.sheetBytes / 60 / 1024).toBeCloseTo(684.6, 1)
    expect(result.cardRun.projectedThumbBytes).toBe(60 * 5000)
  })

  it('derives the decode cost from pixels, since compression does not affect it', () => {
    const result = measure([stat(5000, 700_000)], options)
    expect(result.decode.sheetBytes).toBe(2560 * 1024 * 4)
    expect(result.decode.thumbBytes).toBe(256 * 256 * 4)
    expect(result.decode.factor).toBe(40)
    expect(result.decode.screenfulSheetBytes).toBe(2560 * 1024 * 4 * 12)
  })

  it('refuses to report on nothing', () => {
    expect(() => measure([], options)).toThrow(/no thumbnail was produced/)
  })
})

describe('formatBytes', () => {
  it('is 1024-based, matching pipeline/emit.ts', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1024 * 1024)).toBe('1.00 MB')
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.00 GB')
  })
})
