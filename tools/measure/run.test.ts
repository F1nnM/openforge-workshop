/**
 * The run, end to end, with `fetch` injected and nothing touching the network.
 *
 * The resume test is the one that earns its keep: the real run is 11.05 GB at a
 * few MB/s, so "an interrupted run does not re-read gigabytes" is a correctness
 * property of this row, not a nicety. It is asserted by counting requests.
 */
import { createHash } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { blobOf, testCatalog } from './fixtures/catalog'
import { annularSectorMesh, asciiStl, binaryStl, boxMesh, wallMesh } from './fixtures/mesh'
import { declaredFacets, measureTarget, runMeasure, shouldFit } from './run'
import type { MeasureTarget } from './catalog'
import { readLog } from './sidecar'
import { BINARY_HEADER_BYTES } from '../../src/three/stl/parse'

const MM = 25.4

function temp(): string {
  return mkdtempSync(join(tmpdir(), 'openforge-measure-run-'))
}

function md5(bytes: Uint8Array): string {
  return createHash('md5').update(bytes).digest('hex')
}

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

/**
 * A response carrying the object's bytes and its md5 as a plain ETag.
 *
 * The body is a detached `ArrayBuffer` rather than the view, because this project
 * compiles the tools without the DOM lib and `BlobPart` is not in scope.
 */
function served(bytes: Uint8Array, etag: string): Response {
  const body = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(body).set(bytes)
  return new Response(body, { status: 200, headers: { etag: `"${etag}"` } })
}

/** A bucket that serves exactly the objects it was given, keyed by md5. */
function bucket(objects: ReadonlyMap<string, Uint8Array>): typeof fetch {
  return (input) => {
    const blob = /\/([0-9a-f]{32})\.stl$/.exec(urlOf(input))?.[1]
    const bytes = blob === undefined ? undefined : objects.get(blob)
    if (bytes === undefined) return Promise.resolve(new Response('', { status: 404, statusText: 'no' }))
    return Promise.resolve(served(bytes, blob ?? ''))
  }
}

function target(blob: string, over: Partial<MeasureTarget> = {}): MeasureTarget {
  return {
    blob: blob as MeasureTarget['blob'],
    ord: 0,
    bytes: 1000,
    sets: ['arcNoBand'],
    ids: ['tiles/a.stl'],
    shape: 'arc',
    tags: ['shape|curved', 'size|radius|2'],
    ...over,
  }
}

function catalogFor(blobs: readonly string[]) {
  return testCatalog(
    blobs.map((blob, index) => ({
      id: `tiles/t${String(index)}.stl`,
      ord: index,
      blob,
      foot: {
        shape: 'arc' as const,
        rIn: 0,
        rOut: 2,
        sweep: 90,
        band: 'radial' as const,
        bandBasis: 'measured' as const,
      },
      tags: ['shape|curved', 'size|radius|2'],
    })),
  )
}

describe('measureTarget', () => {
  it('measures a binary sector: exact extent, exact confidence, fitted sector', () => {
    const bytes = binaryStl(annularSectorMesh({ innerRadiusMm: 2 * MM, outerRadiusMm: 2.5 * MM, sweepDeg: 90 }))
    const blob = md5(bytes)
    const catalog = catalogFor([blob])

    return measureTarget(target(blob), {
      catalog,
      fetch: { fetchImpl: bucket(new Map([[blob, bytes]])), sleep: () => Promise.resolve() },
    }).then((entry) => {
      expect(entry.status).toBe('measured')
      if (entry.status !== 'measured') return
      expect(entry.format).toBe('binary')
      expect(entry.provenance).toMatchObject({
        read: 'full',
        confidence: 'exact',
        boundMm: 0,
        verification: 'content-md5',
        etagIsMd5: true,
      })
      expect(entry.extent?.sizeUnits[2]).toBeCloseTo(0.5, 3)
      expect(entry.arc?.fit).toBe('sector')
      if (entry.arc === null || entry.arc.fit === 'rejected') return
      expect(entry.arc.innerRadiusUnits).toBeCloseTo(2, 3)
      expect(entry.arc.outerRadiusUnits).toBeCloseTo(2.5, 3)
      expect(entry.arc.sweepDeg).toBeCloseTo(90, 2)
    })
  })

  it('measures an ASCII mesh too — 11.6% of the corpus is the slow encoding', async () => {
    const bytes = asciiStl(boxMesh([0, 0, 0], [4 * MM, 2 * MM, 12.7]))
    const blob = md5(bytes)
    const entry = await measureTarget(target(blob, { shape: 'none', tags: ['shape|hex'] }), {
      catalog: catalogFor([blob]),
      fetch: { fetchImpl: bucket(new Map([[blob, bytes]])), sleep: () => Promise.resolve() },
    })
    expect(entry.status).toBe('measured')
    if (entry.status !== 'measured') return
    expect(entry.format).toBe('ascii')
    expect(entry.extent?.sizeUnits[0]).toBeCloseTo(4, 3)
    expect(entry.extent?.sizeUnits[1]).toBeCloseTo(2, 3)
  })

  it('records a rejected fit rather than a fitted wall', async () => {
    const bytes = binaryStl(wallMesh(3 * MM, 0.5 * MM, 30))
    const blob = md5(bytes)
    const entry = await measureTarget(target(blob, { sets: ['xg'], sizeCode: 'QxG' }), {
      catalog: catalogFor([blob]),
      fetch: { fetchImpl: bucket(new Map([[blob, bytes]])), sleep: () => Promise.resolve() },
    })
    expect(entry.status).toBe('measured')
    if (entry.status !== 'measured') return
    expect(entry.arc?.fit).toBe('rejected')
    // The extent is the answer for this family: 3.000 × 0.500.
    expect(entry.extent?.sizeUnits[0]).toBeCloseTo(3, 3)
    expect(entry.extent?.sizeUnits[1]).toBeCloseTo(0.5, 3)
  })

  it('turns an ETag mismatch into a failed entry, not a measurement', async () => {
    // Cannot be a thrown error: one bad object must not lose the other 1,100.
    // Cannot be a measurement either: it would be the wrong mesh's dimensions.
    const bytes = binaryStl(boxMesh([0, 0, 0], [1, 1, 1]))
    const claimed = blobOf('deadbeef')
    const impl: typeof fetch = () => Promise.resolve(served(bytes, md5(bytes)))

    const entry = await measureTarget(target(claimed), {
      catalog: catalogFor([claimed]),
      fetch: { fetchImpl: impl, sleep: () => Promise.resolve(), retries: 1 },
    })
    expect(entry.status).toBe('failed')
    if (entry.status !== 'failed') return
    expect(entry.kind).toBe('etag')
    expect(entry.reason).toMatch(/hash/)
  })

  it('turns a 404 into a failed entry naming the status', async () => {
    const blob = blobOf('ffff')
    const entry = await measureTarget(target(blob), {
      catalog: catalogFor([blob]),
      fetch: { fetchImpl: bucket(new Map()), sleep: () => Promise.resolve(), retries: 1 },
    })
    expect(entry.status).toBe('failed')
    if (entry.status !== 'failed') return
    expect(entry.kind).toBe('http')
    expect(entry.reason).toMatch(/404/)
  })

  it('records a facet-less mesh as measured with no extent', async () => {
    const bytes = binaryStl([])
    const blob = md5(bytes)
    const entry = await measureTarget(target(blob), {
      catalog: catalogFor([blob]),
      fetch: { fetchImpl: bucket(new Map([[blob, bytes]])), sleep: () => Promise.resolve() },
    })
    expect(entry.status).toBe('measured')
    if (entry.status !== 'measured') return
    expect(entry.triangles).toBe(0)
    expect(entry.extent).toBeNull()
    expect(entry.arc).toBeNull()
  })
})

describe('shouldFit', () => {
  it('fits an arc, and a none tile carrying a curve marker', () => {
    // The second case is the 742 tiles row W3 moves out of `none`.
    expect(shouldFit(target(blobOf('a')))).toBe(true)
    expect(shouldFit(target(blobOf('a'), { shape: 'none', tags: ['shape|curved|concave'] }))).toBe(true)
    expect(shouldFit(target(blobOf('a'), { shape: 'none', tags: ['shape|hex'] }))).toBe(true)
  })

  it('skips a none tile with no curve marker at all', () => {
    expect(shouldFit(target(blobOf('a'), { shape: 'none', tags: ['shape|stairs'] }))).toBe(false)
  })
})

describe('runMeasure — resume', () => {
  it('re-reads nothing that is already in the log', async () => {
    const objects = new Map<string, Uint8Array>()
    const targets: MeasureTarget[] = []
    for (let index = 0; index < 3; index += 1) {
      const bytes = binaryStl(boxMesh([0, 0, 0], [index + 1, 1, 1]))
      const blob = md5(bytes)
      objects.set(blob, bytes)
      targets.push(target(blob, { ord: index, shape: 'none', tags: ['shape|stairs'] }))
    }
    const catalog = catalogFor([...objects.keys()])
    const logPath = join(temp(), 'measurements.jsonl')

    let requests = 0
    const counting: typeof fetch = (input, init) => {
      requests += 1
      return bucket(objects)(input, init)
    }

    const first = await runMeasure({
      catalog,
      targets,
      logPath,
      concurrency: 2,
      minIntervalMs: 0,
      fetch: { fetchImpl: counting, sleep: () => Promise.resolve() },
    })
    expect(first.measured).toBe(3)
    expect(first.skipped).toBe(0)
    expect(requests).toBe(3)

    const second = await runMeasure({
      catalog,
      targets,
      logPath,
      concurrency: 2,
      minIntervalMs: 0,
      fetch: { fetchImpl: counting, sleep: () => Promise.resolve() },
    })
    expect(second.skipped).toBe(3)
    expect(second.measured).toBe(0)
    // The whole point: no further bytes left the bucket.
    expect(requests).toBe(3)
    expect(second.bytesRead).toBe(0)
    expect(readLog(logPath).size).toBe(3)
  })

  it('resumes a run interrupted part-way and covers the remainder', async () => {
    const objects = new Map<string, Uint8Array>()
    const targets: MeasureTarget[] = []
    for (let index = 0; index < 4; index += 1) {
      const bytes = binaryStl(boxMesh([0, 0, 0], [index + 1, 2, 3]))
      const blob = md5(bytes)
      objects.set(blob, bytes)
      targets.push(target(blob, { ord: index, shape: 'none', tags: ['shape|stairs'] }))
    }
    const catalog = catalogFor([...objects.keys()])
    const logPath = join(temp(), 'measurements.jsonl')
    const options = {
      catalog,
      logPath,
      concurrency: 1,
      minIntervalMs: 0,
      fetch: { fetchImpl: bucket(objects), sleep: () => Promise.resolve() },
    }

    await runMeasure({ ...options, targets: targets.slice(0, 2) })
    const resumed = await runMeasure({ ...options, targets })
    expect(resumed.skipped).toBe(2)
    expect(resumed.measured).toBe(2)
    expect(readLog(logPath).size).toBe(4)
  })

  it('refreshes set membership on resume rather than trusting the log', async () => {
    // A mesh's geometry cannot change without its md5 changing, but *which
    // question it answers* can — W3 merged mid-row and moved 403 tiles between
    // footprint buckets. The measurement is reused; the label is re-derived.
    const bytes = binaryStl(boxMesh([0, 0, 0], [1, 1, 1]))
    const blob = md5(bytes)
    const objects = new Map([[blob, bytes]])
    const catalog = catalogFor([blob])
    const logPath = join(temp(), 'measurements.jsonl')
    const options = {
      catalog,
      logPath,
      concurrency: 1,
      minIntervalMs: 0,
      fetch: { fetchImpl: bucket(objects), sleep: () => Promise.resolve() },
    }

    await runMeasure({ ...options, targets: [target(blob, { sets: ['noneNoCode'], shape: 'none', tags: ['shape|stairs'] })] })
    expect(readLog(logPath).get(blob)?.sets).toEqual(['noneNoCode'])

    const resumed = await runMeasure({
      ...options,
      targets: [target(blob, { sets: ['rectCurved'], shape: 'rect', tags: ['shape|floor|curved'] })],
    })
    expect(resumed.skipped).toBe(1)
    expect(resumed.entries.get(blob)?.sets).toEqual(['rectCurved'])
  })

  it('keeps a failure in the log and only retries it when asked', async () => {
    const good = binaryStl(boxMesh([0, 0, 0], [1, 1, 1]))
    const goodBlob = md5(good)
    const missing = blobOf('cafe')
    const targets = [
      target(goodBlob, { ord: 0, shape: 'none', tags: ['shape|stairs'] }),
      target(missing, { ord: 1, shape: 'none', tags: ['shape|stairs'] }),
    ]
    const catalog = catalogFor([goodBlob, missing])
    const logPath = join(temp(), 'measurements.jsonl')

    let requests = 0
    const objects = new Map([[goodBlob, good]])
    const counting: typeof fetch = (input, init) => {
      requests += 1
      return bucket(objects)(input, init)
    }
    const options = {
      catalog,
      targets,
      logPath,
      concurrency: 1,
      minIntervalMs: 0,
      fetch: { fetchImpl: counting, sleep: () => Promise.resolve(), retries: 1 },
    }

    const first = await runMeasure(options)
    expect(first.measured).toBe(1)
    expect(first.failed).toBe(1)
    expect(first.failures[0]?.blob).toBe(missing)
    const after = requests

    // A 404 is a finding about the corpus, not noise to re-hammer every run.
    const second = await runMeasure(options)
    expect(second.skipped).toBe(2)
    expect(requests).toBe(after)

    const retried = await runMeasure({ ...options, retryFailed: true })
    expect(retried.failed).toBe(1)
    expect(requests).toBeGreaterThan(after)
  })

  it('refuses a strided run that does not state its calibrated bound', async () => {
    // A "bounded" confidence with no bound is a fabricated dimension wearing a
    // provenance field.
    await expect(
      runMeasure({
        catalog: catalogFor([blobOf('a')]),
        targets: [],
        logPath: join(temp(), 'log.jsonl'),
        stride: 8,
      }),
    ).rejects.toThrow(/calibrated error bound/)
  })
})

describe('declaredFacets', () => {
  it('reads the uint32 at offset 80', () => {
    const bytes = binaryStl(boxMesh([0, 0, 0], [1, 1, 1]))
    expect(declaredFacets(bytes.subarray(0, BINARY_HEADER_BYTES))).toBe(12)
  })

  it('is undefined for a preamble shorter than the header', () => {
    expect(declaredFacets(new Uint8Array(40))).toBeUndefined()
  })
})
