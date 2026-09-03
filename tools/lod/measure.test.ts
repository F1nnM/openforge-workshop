/**
 * The run's arithmetic.
 *
 * The only part worth a test beyond the obvious is the corpus projection. The
 * sample is stratified, not uniform — the `gate` stratum is a third of a default
 * sample and 11.5% of the corpus — so a flat mean over it would overstate the
 * store's size badly, and "the LOD store is N GB" is a number somebody will act
 * on.
 */
import { describe, expect, it } from 'vitest'

import { formatBytes, formatCount, project, spread, summarise } from './measure'
import type { JournalEntry } from './run'

function written(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    blob: 'a'.repeat(32),
    key: 'lod/aaaaaa/x.glb',
    ord: 0,
    tiles: 1,
    designs: 1,
    aboveGate: false,
    outcome: 'written',
    format: 'binary',
    sourceBytes: 10_000_000,
    sourceTriangles: 200_000,
    droppedTriangles: 0,
    bytes: 18_700,
    triangles: 5_000,
    vertices: 2_600,
    weld: { before: 600_000, after: 100_000, ratio: 1 / 6 },
    fidelity: { areaError: 0.001, volumeError: 0.002, bboxDelta: 0.0, acceptable: true },
    passThrough: false,
    escalated: false,
    attempts: 1,
    compression: 'EXT_meshopt_compression',
    extents: [100, 12.7, 4.5],
    fetchMs: 1_200,
    decimateMs: 150,
    ...overrides,
  }
}

describe('summarise', () => {
  it('reduces totals both ways and reports the weld ratio', () => {
    const stats = summarise([written(), written({ sourceTriangles: 400_000, triangles: 10_000, bytes: 37_400 })])
    expect(stats.triangleReduction).toBeCloseTo(600_000 / 15_000, 6)
    expect(stats.byteReduction).toBeCloseTo(20_000_000 / 56_100, 6)
    expect(stats.weldRatio.mean).toBeCloseTo(1 / 6, 6)
  })

  it('excludes pass-through meshes from the area-error figure', () => {
    const stats = summarise([
      written({ passThrough: true, fidelity: { areaError: 0, volumeError: 0, bboxDelta: 0, acceptable: true } }),
      written({ fidelity: { areaError: 0.04, volumeError: 0.01, bboxDelta: 0.1, acceptable: true } }),
    ])
    expect(stats.areaError.count).toBe(1)
    expect(stats.areaError.mean).toBeCloseTo(0.04, 6)
    expect(stats.passThrough).toBe(1)
  })

  it('ignores an empty mesh, which produced no object', () => {
    const stats = summarise([written(), written({ outcome: 'empty', bytes: 0, triangles: 0, weld: null })])
    expect(stats.lodBytes.count).toBe(1)
  })

  it('counts escalations and fidelity misses', () => {
    const stats = summarise([
      written({ escalated: true }),
      written({ fidelity: { areaError: 0.09, volumeError: 0.03, bboxDelta: 0.2, acceptable: false } }),
    ])
    expect(stats.escalated).toBe(1)
    expect(stats.unfaithful).toBe(1)
  })
})

describe('project', () => {
  it('projects per stratum, not from a pooled mean', () => {
    // A sample shaped like the default: a third above the gate, and those objects
    // are much larger than the rest.
    const entries = [
      ...Array.from({ length: 12 }, () => written({ aboveGate: true, bytes: 60_000 })),
      ...Array.from({ length: 24 }, () => written({ aboveGate: false, bytes: 18_000 })),
    ]
    const projection = project(entries, { blobs: 8_353, aboveGate: 957, sourceBytes: 106_130_000_000 })

    expect(projection.meanAboveGate).toBe(60_000)
    expect(projection.meanBelowGate).toBe(18_000)
    expect(projection.belowGate).toBe(7_396)
    expect(projection.bytes).toBe(957 * 60_000 + 7_396 * 18_000)

    // A pooled mean over the sample would be 32,000 B and would overstate the
    // store by more than 20%.
    const pooled = 8_353 * ((12 * 60_000 + 24 * 18_000) / 36)
    expect(pooled).toBeGreaterThan(projection.bytes * 1.2)
  })

  it('reports zero rather than NaN when a stratum was not sampled', () => {
    const projection = project([written({ aboveGate: false })], { blobs: 100, aboveGate: 10, sourceBytes: 1 })
    expect(projection.meanAboveGate).toBe(0)
    expect(Number.isFinite(projection.bytes)).toBe(true)
  })
})

describe('spread', () => {
  it('is all zeroes for no values, rather than NaN', () => {
    expect(spread([])).toEqual({ count: 0, total: 0, mean: 0, median: 0, p95: 0, min: 0, max: 0 })
  })

  it('reports the quantiles a reviewer reads', () => {
    const stats = spread([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(stats.median).toBe(5)
    expect(stats.p95).toBe(9)
    expect(stats.min).toBe(1)
    expect(stats.max).toBe(10)
    expect(stats.mean).toBeCloseTo(5.5, 6)
  })
})

describe('formatting', () => {
  it('uses decimal units, as the rest of the tooling does', () => {
    expect(formatBytes(84)).toBe('84 B')
    expect(formatBytes(43_000)).toBe('43.0 KB')
    expect(formatBytes(10_765_784)).toBe('10.8 MB')
    expect(formatBytes(106_130_000_000)).toBe('106.13 GB')
  })

  it('separates thousands, because six-digit triangle counts are unreadable', () => {
    expect(formatCount(2_178_242)).toBe('2,178,242')
  })
})
