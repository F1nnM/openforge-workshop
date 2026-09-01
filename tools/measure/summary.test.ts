/**
 * The readout, so the figures in the PR body are computed from the committed
 * sidecar rather than transcribed from a run's scrollback.
 */
import { describe, expect, it } from 'vitest'

import { blobOf, testCatalog } from './fixtures/catalog'
import type { MeasureTarget } from './catalog'
import type { MeasuredEntry, MeasurementEntry } from './sidecar'
import { buildSidecar } from './sidecar'
import { quantiles, summariseCodes, summariseExtents, summariseSectors } from './summary'

const CATALOG = testCatalog([
  {
    id: 'tiles/a.stl',
    ord: 0,
    blob: blobOf('a'),
    foot: { shape: 'arc', radius: 2, angle: 90 },
    tags: ['shape|curved', 'size|radius|2'],
  },
])

function entry(blob: string, over: Partial<MeasuredEntry> = {}): MeasuredEntry {
  return {
    status: 'measured',
    blob,
    sets: ['arcNoBand'],
    bytes: 1000,
    format: 'binary',
    triangles: 100,
    dropped: 0,
    provenance: {
      read: 'full',
      bytesRead: 1000,
      facets: 100,
      verification: 'content-md5',
      etagIsMd5: true,
      boundMm: 0,
      confidence: 'exact',
    },
    extent: {
      minMm: [0, 0, 0],
      maxMm: [76.2, 12.7, 30],
      sizeMm: [76.2, 12.7, 30],
      sizeUnits: [3, 0.5, 1.1811],
    },
    arc: null,
    ...over,
  }
}

function sector(inner: number, outer: number, sweep: number) {
  return {
    fit: 'sector' as const,
    plane: 'xy' as const,
    centreMm: [0, 0] as readonly [number, number],
    centreOffsetMm: 0,
    onArcFraction: 1,
    radialRmsMm: 0,
    bboxResidualMm: 0.001,
    angularGapDeg: 0,
    vertices: 100,
    radiusToleranceMm: 0.01,
    innerRadiusUnits: inner,
    outerRadiusUnits: outer,
    bandUnits: outer - inner,
    startDeg: 0,
    sweepDeg: sweep,
  }
}

function sidecarOf(entries: readonly MeasurementEntry[]) {
  return buildSidecar({
    catalog: CATALOG,
    entries: new Map(entries.map((item) => [item.blob, item])),
    coverage: {
      blobs: entries.length,
      sets: { arcNoBand: entries.length, arcNoAngle: 0, xg: 0, noneNoCode: 0, rectCurved: 0 },
    },
    method: {},
    now: () => 0,
  })
}

describe('quantiles', () => {
  it('is min / median / max with a count, and undefined when empty', () => {
    expect(quantiles([3, 1, 2])).toEqual({ min: 1, median: 2, max: 3, count: 3 })
    expect(quantiles([])).toBeUndefined()
  })
})

describe('summariseSectors', () => {
  it('counts fits, refusals and never-attempted separately', () => {
    const sidecar = sidecarOf([
      entry(blobOf('a'), { arc: sector(2, 2.5, 90) }),
      entry(blobOf('b'), { arc: sector(2, 2.5, 90) }),
      entry(blobOf('c'), { arc: sector(0, 2, 45) }),
      entry(blobOf('d'), {
        arc: {
          fit: 'rejected',
          reason: 'box-mismatch',
          plane: 'xy',
          centreMm: [0, 0],
          centreOffsetMm: 0,
          onArcFraction: 0.1,
          radialRmsMm: 0.2,
          bboxResidualMm: 40,
          angularGapDeg: 0,
          vertices: 36,
          radiusToleranceMm: 0.5,
          innerRadiusUnits: 1,
          outerRadiusUnits: 2,
          sweepDeg: 180,
        },
      }),
      entry(blobOf('e')),
    ])

    const summary = summariseSectors(sidecar, 'arcNoBand')
    expect(summary.measured).toBe(5)
    expect(summary.fitted).toBe(3)
    expect(summary.notAttempted).toBe(1)
    expect(summary.rejected['box-mismatch']).toBe(1)
    expect(summary.bands[0]).toEqual({ value: '[2.00, 2.50]', count: 2 })
    expect(summary.bandWidths[0]).toEqual({ value: '0.50', count: 2 })
    expect(summary.sweeps[0]).toEqual({ value: '90.0', count: 2 })
    expect(summary.bboxResidualMm?.max).toBeCloseTo(0.001, 5)
  })

  it('excludes a rejected fit\'s radii from the band histogram entirely', () => {
    const sidecar = sidecarOf([
      entry(blobOf('d'), {
        arc: {
          fit: 'rejected',
          reason: 'few-arc-vertices',
          plane: 'xy',
          centreMm: [0, 0],
          centreOffsetMm: 0,
          onArcFraction: 0.01,
          radialRmsMm: 0.2,
          bboxResidualMm: 40,
          angularGapDeg: 0,
          vertices: 36,
          radiusToleranceMm: 0.5,
          innerRadiusUnits: 1,
          outerRadiusUnits: 2,
          sweepDeg: 180,
        },
      }),
    ])
    const summary = summariseSectors(sidecar, 'arcNoBand')
    expect(summary.bands).toEqual([])
    expect(summary.rejected['few-arc-vertices']).toBe(1)
  })
})

describe('summariseCodes', () => {
  it('groups extents by tessellation code, sorting the horizontal axes', () => {
    const targets: MeasureTarget[] = [
      {
        blob: blobOf('a') as MeasureTarget['blob'],
        ord: 0,
        bytes: 1000,
        sets: ['xg'],
        ids: ['tiles/a.stl'],
        sizeCode: 'QxG',
        shape: 'arc',
        tags: ['size|openlock|QxG'],
      },
    ]
    const sidecar = sidecarOf([entry(blobOf('a'), { sets: ['xg'] })])
    const [code] = summariseCodes(sidecar, targets, ['QxG'])
    expect(code?.blobs).toBe(1)
    expect(code?.longUnits?.median).toBe(3)
    expect(code?.shortUnits?.median).toBe(0.5)
    expect(code?.fittedSectors).toBe(0)
  })
})

describe('summariseExtents', () => {
  it('reports the commonest boxes on a quarter-unit grid', () => {
    const sidecar = sidecarOf([
      entry(blobOf('a'), { sets: ['noneNoCode'] }),
      entry(blobOf('b'), { sets: ['noneNoCode'] }),
      entry(blobOf('c'), { sets: ['noneNoCode'], extent: null }),
    ])
    const summary = summariseExtents(sidecar, 'noneNoCode')
    expect(summary.measured).toBe(3)
    expect(summary.withoutExtent).toBe(1)
    expect(summary.footprints[0]).toEqual({ value: '3.00×0.50', count: 2 })
  })
})
