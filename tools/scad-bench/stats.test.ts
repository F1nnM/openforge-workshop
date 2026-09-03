/**
 * Aggregation, including the two honesty properties.
 *
 * A p95 over seven samples is the maximum. That is not a bug, but a report that
 * prints it without saying so is misleading, so `p95IsMax` is asserted here
 * rather than left as a comment.
 */
import { describe, expect, it } from 'vitest'

import { P95_MIN_SAMPLES, decompose, distribution, ms, ratio, split } from './stats'

describe('distribution', () => {
  it('is undefined for an empty sample, not a zero that reads as a measurement', () => {
    expect(distribution([])).toBeUndefined()
  })

  it('reports min, median, max and mean', () => {
    const result = distribution([10, 20, 30, 40, 50])
    expect(result).toMatchObject({ count: 5, min: 10, median: 30, max: 50, mean: 30 })
  })

  it('takes the median by nearest rank on an even sample rather than interpolating', () => {
    expect(distribution([10, 20, 30, 40])?.median).toBe(20)
  })

  it('does not care about input order', () => {
    expect(distribution([50, 10, 30, 20, 40])?.median).toBe(30)
  })

  it('flags p95 as degenerate below the sample floor', () => {
    const small = distribution([1, 2, 3, 4, 5, 6, 7])
    expect(small?.p95IsMax).toBe(true)
    expect(small?.p95).toBe(small?.max)
  })

  it('stops flagging it at the floor, where p95 is a real quantile', () => {
    const values = Array.from({ length: P95_MIN_SAMPLES }, (_, index) => index + 1)
    const large = distribution(values)
    expect(large?.p95IsMax).toBe(false)
    expect(large?.p95).toBe(19)
    expect(large?.max).toBe(20)
  })

  it('is resilient to a single outlier in the median but not the p95', () => {
    const result = distribution([10, 10, 10, 10, 10_000])
    expect(result?.median).toBe(10)
    expect(result?.p95).toBe(10_000)
  })

  it('handles a one-sample distribution without dividing by zero', () => {
    expect(distribution([42])).toMatchObject({ count: 1, min: 42, median: 42, p95: 42, max: 42, mean: 42 })
  })
})

describe('split', () => {
  it('keeps cold out of the warm distribution', () => {
    const result = split({ cold: 900, warm: [100, 110, 105] })
    expect(result.cold).toBe(900)
    expect(result.warm?.count).toBe(3)
    expect(result.warm?.median).toBe(105)
  })

  it('leaves warm undefined when there was only a cold run', () => {
    expect(split({ cold: 900, warm: [] }).warm).toBeUndefined()
  })
})

describe('decompose', () => {
  it('separates fixed cost from geometry', () => {
    expect(decompose(400, 300)).toEqual({ floor: 300, geometry: 100, floorShare: 0.75 })
  })

  it('clamps a sub-floor run at zero rather than reporting a negative cost', () => {
    expect(decompose(280, 300).geometry).toBe(0)
  })

  it('caps the floor share at 1 so a noisy floor cannot read as 120% overhead', () => {
    expect(decompose(280, 300).floorShare).toBe(1)
  })

  it('reports a zero share for a zero total rather than NaN', () => {
    expect(decompose(0, 300).floorShare).toBe(0)
  })
})

describe('ratio', () => {
  it('divides', () => {
    expect(ratio(3220, 70)).toBeCloseTo(46, 0)
  })

  it('is undefined rather than Infinity when the divisor is zero', () => {
    expect(ratio(100, 0)).toBeUndefined()
  })
})

describe('ms', () => {
  it('keeps a decimal under 10 ms, where rounding would hide the value', () => {
    expect(ms(4.27)).toBe('4.3 ms')
  })

  it('drops it in the millisecond range', () => {
    expect(ms(61.4)).toBe('61 ms')
  })

  it('switches to seconds past a second, which is the scale of the decision', () => {
    expect(ms(3220)).toBe('3.22 s')
  })
})
