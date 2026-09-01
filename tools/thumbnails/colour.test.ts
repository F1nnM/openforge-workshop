/**
 * The chroma measure that decides the tone question.
 *
 * Deliberately crude and deliberately explicit: chroma is
 * `max(r,g,b) − min(r,g,b)`, the thresholds are arguments, and both are asserted
 * here so the 99.8% figure cannot be reached by quietly moving a threshold.
 */
import { describe, expect, it } from 'vitest'

import { neutrality, poolNeutrality } from './colour'

/** `n` pixels of one RGBA value. */
function pixels(n: number, r: number, g: number, b: number, a = 255): Buffer {
  const buffer = Buffer.alloc(n * 4)
  for (let i = 0; i < n; i += 1) {
    buffer[i * 4] = r
    buffer[i * 4 + 1] = g
    buffer[i * 4 + 2] = b
    buffer[i * 4 + 3] = a
  }
  return buffer
}

describe('neutrality', () => {
  it('calls grey neutral', () => {
    const result = neutrality(pixels(10, 128, 128, 128))
    expect(result.opaque).toBe(10)
    expect(result.nonNeutral).toBe(0)
    expect(result.share).toBe(0)
    expect(result.meanChroma).toBe(0)
  })

  it('calls the renderer’s blue non-neutral', () => {
    // stl-thumb's diffuse peak, architecture-plan.md §8.
    const result = neutrality(pixels(10, 0x33, 0x75, 0xc8))
    expect(result.share).toBe(1)
    expect(result.meanChroma).toBe(0xc8 - 0x33)
    expect(result.mean.b).toBeGreaterThan(result.mean.r)
  })

  it('ignores transparent pixels, which are most of a sprite frame', () => {
    const result = neutrality(Buffer.concat([pixels(4, 0, 0, 255, 0), pixels(2, 128, 128, 128)]))
    expect(result.opaque).toBe(2)
    expect(result.share).toBe(0)
  })

  it('returns zeroes rather than NaN for a fully transparent frame', () => {
    const result = neutrality(pixels(8, 0, 0, 255, 0))
    expect(result).toEqual({ opaque: 0, nonNeutral: 0, share: 0, meanChroma: 0, mean: { r: 0, g: 0, b: 0 } })
  })

  it('takes the thresholds as arguments', () => {
    const nearlyGrey = pixels(10, 130, 128, 124)
    expect(neutrality(nearlyGrey).share).toBe(0)
    expect(neutrality(nearlyGrey, { chromaThreshold: 2 }).share).toBe(1)
    expect(neutrality(pixels(10, 0, 0, 255, 100)).opaque).toBe(0)
    expect(neutrality(pixels(10, 0, 0, 255, 100), { alphaThreshold: 50 }).opaque).toBe(10)
  })

  it('refuses a buffer that is not whole RGBA pixels', () => {
    expect(() => neutrality(Buffer.alloc(7))).toThrow(/not a whole number of RGBA pixels/)
  })
})

describe('poolNeutrality', () => {
  it('weights by opaque pixel count, not by sheet', () => {
    const grey = neutrality(pixels(90, 128, 128, 128))
    const blue = neutrality(pixels(10, 0x33, 0x75, 0xc8))
    const pooled = poolNeutrality([grey, blue])
    expect(pooled.opaque).toBe(100)
    expect(pooled.nonNeutral).toBe(10)
    expect(pooled.share).toBeCloseTo(0.1, 6)
  })

  it('handles an empty pool', () => {
    expect(poolNeutrality([]).opaque).toBe(0)
  })
})
