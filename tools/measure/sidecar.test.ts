/**
 * The sidecar's contract: resumability, the version stamp, and the refusal.
 *
 * The refusal tests are the important ones. Rows W4 and W5 place footprints from
 * this file, and the property that makes that safe is that a dimension which was
 * not measured is *unreachable* through the accessors — not merely absent from a
 * field a caller might forget to check.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { blobOf, testCatalog } from './fixtures/catalog'
import {
  MEASURE_SIDECAR_VERSION,
  appendEntry,
  buildSidecar,
  measuredExtent,
  measuredSector,
  readLog,
  readSidecar,
  serialiseSidecar,
  writeSidecar,
} from './sidecar'
import type { MeasuredEntry, MeasurementEntry } from './sidecar'

function temp(): string {
  return mkdtempSync(join(tmpdir(), 'openforge-measure-'))
}

const CATALOG = testCatalog([
  {
    id: 'tiles/a.stl',
    ord: 0,
    blob: blobOf('a'),
    foot: { shape: 'arc', radius: 2, angle: 90 },
    tags: ['shape|curved', 'size|radius|2'],
  },
])

function measured(blob: string, overrides: Partial<MeasuredEntry> = {}): MeasuredEntry {
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
      maxMm: [50.8, 50.8, 12.7],
      sizeMm: [50.8, 50.8, 12.7],
      sizeUnits: [2, 2, 0.5],
    },
    arc: null,
    ...overrides,
  }
}

describe('the log', () => {
  it('is append-only and reloads what a previous run finished', () => {
    const path = join(temp(), 'nested', 'measurements.jsonl')
    appendEntry(path, measured(blobOf('a')))
    appendEntry(path, measured(blobOf('b')))

    const reloaded = readLog(path)
    expect([...reloaded.keys()]).toEqual([blobOf('a'), blobOf('b')])
    expect(reloaded.get(blobOf('a'))?.status).toBe('measured')
  })

  it('lets a later line supersede an earlier one for the same md5', () => {
    // A retried failure must be replaced by its success, not shadowed by it.
    const path = join(temp(), 'log.jsonl')
    appendEntry(path, {
      status: 'failed',
      blob: blobOf('a'),
      sets: ['xg'],
      bytes: 10,
      kind: 'http',
      reason: '404',
    })
    appendEntry(path, measured(blobOf('a')))
    expect(readLog(path).get(blobOf('a'))?.status).toBe('measured')
  })

  it('drops a truncated final line rather than throwing', () => {
    // What an interrupted process leaves behind. Re-reading one mesh is the
    // cheapest correct response; refusing to start is not.
    const path = join(temp(), 'log.jsonl')
    appendEntry(path, measured(blobOf('a')))
    writeFileSync(path, `${readFileSync(path, 'utf8')}{"blob":"trunc`, 'utf8')
    expect([...readLog(path).keys()]).toEqual([blobOf('a')])
  })

  it('is an empty map when there is no log at all', () => {
    expect(readLog(join(temp(), 'absent.jsonl')).size).toBe(0)
  })
})

describe('buildSidecar', () => {
  it('stamps the version and the index it was derived from', () => {
    // Row X4 stamps five artefacts in one step and joins them on this.
    const sidecar = buildSidecar({
      catalog: CATALOG,
      entries: new Map<string, MeasurementEntry>([[blobOf('a'), measured(blobOf('a'))]]),
      coverage: { blobs: 3, sets: { arcNoBand: 2, arcNoAngle: 1, xg: 0, noneNoCode: 0, rectCurved: 0 } },
      method: { mmPerUnit: 25.4 },
      now: () => 0,
    })
    expect(sidecar.tool).toBe('openforge-workshop-measure')
    expect(sidecar.version).toBe(MEASURE_SIDECAR_VERSION)
    expect(sidecar.catalog).toEqual(CATALOG.version)
    expect(sidecar.units.mmPerUnit).toBe(25.4)
  })

  it('states pending coverage rather than implying completeness', () => {
    const sidecar = buildSidecar({
      catalog: CATALOG,
      entries: new Map<string, MeasurementEntry>([
        [blobOf('a'), measured(blobOf('a'))],
        [
          blobOf('b'),
          { status: 'failed', blob: blobOf('b'), sets: ['xg'], bytes: 5, kind: 'http', reason: '404' },
        ],
      ]),
      coverage: { blobs: 10, sets: { arcNoBand: 4, arcNoAngle: 2, xg: 3, noneNoCode: 1, rectCurved: 0 } },
      method: {},
      now: () => 0,
    })
    expect(sidecar.coverage).toMatchObject({ blobs: 10, measured: 1, failed: 1, pending: 8 })
    expect(sidecar.coverage.sets.arcNoBand).toEqual({ blobs: 4, measured: 1 })
    expect(sidecar.coverage.sets.xg).toEqual({ blobs: 3, measured: 0 })
    expect(sidecar.coverage.bytesRead).toBe(1000)
    // B5 assumes the ETag is always the md5. It is not, above 8 MiB, so the
    // sidecar counts which check actually ran.
    expect(sidecar.coverage.verification).toEqual({ contentMd5: 1, etag: 0, etagIsNotMd5: 0 })
  })

  it('is keyed by md5, sorted, so a diff is readable', () => {
    const sidecar = buildSidecar({
      catalog: CATALOG,
      entries: new Map<string, MeasurementEntry>([
        [blobOf('f'), measured(blobOf('f'))],
        [blobOf('a'), measured(blobOf('a'))],
      ]),
      coverage: { blobs: 2, sets: { arcNoBand: 2, arcNoAngle: 0, xg: 0, noneNoCode: 0, rectCurved: 0 } },
      method: {},
      now: () => 0,
    })
    expect(Object.keys(sidecar.measurements)).toEqual([blobOf('a'), blobOf('f')])

    // One line per measurement: the artefact is ~840 kB and a re-exported tile
    // must show up as one changed line, not forty and not a whole-file rewrite.
    const text = serialiseSidecar(sidecar)
    expect(text.endsWith('\n')).toBe(true)
    expect(JSON.parse(text)).toEqual(sidecar)
    const lines = text.split('\n').filter((line) => /^ {2}"[0-9a-f]{32}": \{/.test(line))
    expect(lines).toHaveLength(2)
    expect(lines[0]?.startsWith(`  "${blobOf('a')}": {`)).toBe(true)
  })

  it('drops entries the current work list no longer asks for', () => {
    // The log is append-only and outlives a reclassification. W3 moved 403 tiles
    // between footprint buckets mid-row; a measurement keyed on md5 stays true,
    // but a sidecar that kept describing meshes nobody asks about, under labels
    // that no longer apply, would overstate its own coverage.
    const sidecar = buildSidecar({
      catalog: CATALOG,
      entries: new Map<string, MeasurementEntry>([
        [blobOf('a'), measured(blobOf('a'))],
        [blobOf('b'), measured(blobOf('b'))],
      ]),
      wanted: new Set([blobOf('a')]),
      coverage: { blobs: 1, sets: { arcNoBand: 1, arcNoAngle: 0, xg: 0, noneNoCode: 0, rectCurved: 0 } },
      method: {},
      now: () => 0,
    })
    expect(Object.keys(sidecar.measurements)).toEqual([blobOf('a')])
    expect(sidecar.coverage.measured).toBe(1)
    expect(sidecar.coverage.pending).toBe(0)
  })

  it('round-trips a sidecar with no measurements at all', () => {
    const empty = buildSidecar({
      catalog: CATALOG,
      entries: new Map<string, MeasurementEntry>(),
      coverage: { blobs: 0, sets: { arcNoBand: 0, arcNoAngle: 0, xg: 0, noneNoCode: 0, rectCurved: 0 } },
      method: {},
      now: () => 0,
    })
    expect(JSON.parse(serialiseSidecar(empty))).toEqual(empty)
  })
})

describe('readSidecar', () => {
  it('round-trips through the filesystem', () => {
    const path = join(temp(), 'measurements.json')
    const sidecar = buildSidecar({
      catalog: CATALOG,
      entries: new Map<string, MeasurementEntry>([[blobOf('a'), measured(blobOf('a'))]]),
      coverage: { blobs: 1, sets: { arcNoBand: 1, arcNoAngle: 0, xg: 0, noneNoCode: 0, rectCurved: 0 } },
      method: {},
      now: () => 0,
    })
    writeSidecar(path, sidecar)
    expect(readSidecar(path)).toEqual(sidecar)
  })

  it('refuses a version it does not understand', () => {
    // Reading a future version positionally is how a renamed unit becomes a
    // footprint in the wrong place.
    const path = join(temp(), 'future.json')
    writeFileSync(
      path,
      JSON.stringify({ tool: 'openforge-workshop-measure', version: 99, measurements: {} }),
      'utf8',
    )
    expect(() => readSidecar(path)).toThrow(/version 99/)
  })

  it('refuses a file that is not a measure sidecar', () => {
    const path = join(temp(), 'other.json')
    writeFileSync(path, JSON.stringify({ tool: 'something-else', version: 1 }), 'utf8')
    expect(() => readSidecar(path)).toThrow(/not a measure sidecar/)
  })
})

describe('the refusal — what makes W4 and W5 honest', () => {
  const sidecar = buildSidecar({
    catalog: CATALOG,
    entries: new Map<string, MeasurementEntry>([
      [blobOf('a'), measured(blobOf('a'))],
      [
        blobOf('b'),
        { status: 'failed', blob: blobOf('b'), sets: ['xg'], bytes: 5, kind: 'etag', reason: 'mismatch' },
      ],
      [blobOf('c'), measured(blobOf('c'), { extent: null, triangles: 0 })],
      [
        blobOf('d'),
        measured(blobOf('d'), {
          provenance: {
            read: 'stride',
            stride: 8,
            bytesRead: 500,
            facets: 12,
            verification: 'etag',
            etagIsMd5: true,
            boundMm: 1.6448,
            confidence: 'bounded',
          },
        }),
      ],
      [
        blobOf('e'),
        measured(blobOf('e'), {
          arc: {
            fit: 'rejected',
            reason: 'box-mismatch',
            plane: 'xy',
            centreMm: [0, 0],
            centreOffsetMm: 0,
            onArcFraction: 0.2,
            radialRmsMm: 0.1,
            bboxResidualMm: 47.5,
            angularGapDeg: 0,
            vertices: 36,
            radiusToleranceMm: 0.5,
            innerRadiusUnits: 0.2,
            outerRadiusUnits: 3.1,
            sweepDeg: 180,
          },
        }),
      ],
      [
        blobOf('f'),
        measured(blobOf('f'), {
          arc: {
            fit: 'sector',
            plane: 'xy',
            centreMm: [0, 0],
            centreOffsetMm: 0,
            onArcFraction: 1,
            radialRmsMm: 0,
            bboxResidualMm: 0,
            angularGapDeg: 0,
            vertices: 100,
            radiusToleranceMm: 0.01,
            innerRadiusUnits: 2,
            outerRadiusUnits: 2.5,
            bandUnits: 0.5,
            startDeg: 0,
            sweepDeg: 90,
          },
        }),
      ],
    ]),
    coverage: { blobs: 7, sets: { arcNoBand: 6, arcNoAngle: 0, xg: 1, noneNoCode: 0, rectCurved: 0 } },
    method: {},
    now: () => 0,
  })

  it('gives an extent for a measured mesh', () => {
    expect(measuredExtent(sidecar, blobOf('a'))?.sizeUnits).toEqual([2, 2, 0.5])
  })

  it('gives nothing for an unknown md5 — md5 churn must not carry a stale dimension', () => {
    expect(measuredExtent(sidecar, blobOf('9'))).toBeUndefined()
  })

  it('gives nothing for a failed read', () => {
    expect(measuredExtent(sidecar, blobOf('b'))).toBeUndefined()
  })

  it('gives nothing for a facet-less mesh — "not measurable", not "zero size"', () => {
    expect(measuredExtent(sidecar, blobOf('c'))).toBeUndefined()
  })

  it('gives nothing for a bounded read when the caller demands an exact one', () => {
    expect(measuredExtent(sidecar, blobOf('d'))).toBeDefined()
    expect(measuredExtent(sidecar, blobOf('d'), 'exact')).toBeUndefined()
    expect(measuredExtent(sidecar, blobOf('a'), 'exact')).toBeDefined()
  })

  it('gives no sector for a rejected fit, however plausible its numbers look', () => {
    // The rejected entry carries innerRadiusUnits 0.2 and outerRadiusUnits 3.1.
    // They are diagnostics. A consumer must never reach them as a footprint.
    expect(sidecar.measurements[blobOf('e')]).toBeDefined()
    expect(measuredSector(sidecar, blobOf('e'))).toBeUndefined()
  })

  it('gives a sector for an accepted fit', () => {
    const sector = measuredSector(sidecar, blobOf('f'))
    expect(sector?.innerRadiusUnits).toBe(2)
    expect(sector?.outerRadiusUnits).toBe(2.5)
    expect(sector?.sweepDeg).toBe(90)
  })

  it('gives no sector when none was attempted', () => {
    expect(measuredSector(sidecar, blobOf('a'))).toBeUndefined()
  })
})
