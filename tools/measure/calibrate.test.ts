/**
 * The stride experiment's sampling and its transfer arithmetic.
 *
 * The arithmetic test is the load-bearing one. It is the reason this row reads in
 * full: a binary facet is 50 bytes, so with any sane coalescing threshold a
 * stride below ~1,310 transfers the whole object anyway — and the strides that do
 * transfer less were measured losing millimetres. Stating that as a test means a
 * later row cannot reintroduce "strided range-reads, ~13 GB" without the test
 * telling it what the trade actually is.
 */
import { describe, expect, it } from 'vitest'

import { CANDIDATE_STRIDES, DEFAULT_SAMPLE, PLAN_CLAIM_MM, stratifiedSample, strideTransfer } from './calibrate'
import type { MeasureTarget } from './catalog'
import { BINARY_FACET_BYTES, BINARY_HEADER_BYTES } from '../../src/three/stl/parse'

function target(ord: number, bytes: number): MeasureTarget {
  return {
    blob: String(ord).padStart(32, '0') as MeasureTarget['blob'],
    ord,
    bytes,
    sets: ['noneNoCode'],
    ids: [`tiles/t${String(ord)}.stl`],
    shape: 'none',
    tags: ['shape|hex'],
  }
}

describe('stratifiedSample', () => {
  it('spans the size range rather than clustering at one end', () => {
    // Facet count scales with bytes and a stride's error is a function of how
    // much of the mesh it skips, so size is the axis that has to be covered.
    const targets = Array.from({ length: 1000 }, (_, index) => target(index, (index + 1) * 1000))
    const sample = stratifiedSample(targets, 20)
    expect(sample).toHaveLength(20)
    const bytes = sample.map((item) => item.bytes)
    expect(bytes[0]).toBeLessThan(60_000)
    expect(bytes[bytes.length - 1]).toBeGreaterThan(940_000)
    // Monotonic: one member per equal-count band, in size order.
    expect([...bytes].sort((a, b) => a - b)).toEqual(bytes)
  })

  it('is deterministic, so a changed table means a changed corpus', () => {
    const targets = Array.from({ length: 500 }, (_, index) => target(index, (index * 7919) % 100_003))
    expect(stratifiedSample(targets, 12).map((item) => item.blob)).toEqual(
      stratifiedSample(targets, 12).map((item) => item.blob),
    )
  })

  it('returns everything when the corpus is smaller than the sample', () => {
    const targets = [target(0, 10), target(1, 20)]
    expect(stratifiedSample(targets, 36)).toHaveLength(2)
  })

  it('never returns the same target twice', () => {
    const targets = Array.from({ length: 40 }, (_, index) => target(index, 1000))
    const sample = stratifiedSample(targets, 36)
    expect(new Set(sample.map((item) => item.blob)).size).toBe(sample.length)
  })
})

describe('strideTransfer — why the strided plan does not pay', () => {
  it('transfers the whole object for every stride under ~1,310', () => {
    // 50 × stride must exceed the 64 KiB coalescing threshold before a window
    // boundary appears at all. 65536 / 50 = 1310.7.
    const facets = 200_000
    const objectBytes = BINARY_HEADER_BYTES + facets * BINARY_FACET_BYTES

    for (const stride of [2, 8, 64, 512, 1024]) {
      const transfer = strideTransfer(facets, objectBytes, stride)
      expect(transfer.fraction).toBeGreaterThan(0.98)
      // And it costs at least one request more than a single whole-object GET.
      expect(transfer.requests).toBeGreaterThanOrEqual(2)
    }

    const wide = strideTransfer(facets, objectBytes, 4096)
    expect(wide.fraction).toBeLessThan(0.05)
    expect(wide.requests).toBeGreaterThan(40)
  })

  it('counts the preamble probe, because a stride cannot be planned without it', () => {
    // The facet count lives at offset 80, so the byte windows are not computable
    // until the first 84 bytes have been read.
    const transfer = strideTransfer(10_000, BINARY_HEADER_BYTES + 10_000 * BINARY_FACET_BYTES, 4096)
    expect(transfer.requests).toBe(3 + 1)
  })

  it('never claims to transfer more than the object holds', () => {
    const facets = 10
    const objectBytes = BINARY_HEADER_BYTES + facets * BINARY_FACET_BYTES
    const transfer = strideTransfer(facets, objectBytes, 1)
    expect(transfer.bytes).toBeLessThanOrEqual(objectBytes)
    expect(transfer.fraction).toBeLessThanOrEqual(1)
  })

  it('is a no-op for a facet-less object', () => {
    expect(strideTransfer(0, BINARY_HEADER_BYTES, 8)).toMatchObject({ requests: 1, bytes: 0 })
  })
})

describe('the constants the run is planned from', () => {
  it('ladders the strides and names the plan’s unmeasured claim', () => {
    expect([...CANDIDATE_STRIDES]).toContain(2)
    expect([...CANDIDATE_STRIDES]).toContain(4096)
    expect(PLAN_CLAIM_MM).toBe(0.03)
    // The row's own floor for the sample size.
    expect(DEFAULT_SAMPLE).toBeGreaterThanOrEqual(30)
  })
})
