/**
 * The run loop, with `fetch` injected and nothing touching the network.
 *
 * The resume tests are the ones that earn their keep: the real run is 16.34 GB
 * at a few MB/s, so "an interrupted run does not re-read gigabytes" is a
 * correctness property of this tool rather than a nicety, and it is asserted by
 * counting requests — not by inspecting a flag that claims a request was
 * skipped.
 *
 * The bucket serves a real binary STL whose md5 is computed here, so
 * `fetchObject`'s content verification runs for real: a fake that served
 * mismatched bytes would exercise the failure path while looking like the
 * success one.
 *
 * The pool test spawns an actual worker thread, because the thing worth
 * asserting about it cannot be faked — that `new Worker(new URL('./worker.ts',
 * …), { execArgv: ['--import', 'tsx'] })` loads a TypeScript module importing
 * `src/`, answers, and lets the process exit afterwards. The mesh is a single
 * 1 × 0.5 × 1 unit wall with one `top` slot, which resolves as a surface mount
 * and costs no cast at all; a socket or opening slot would put a 0.5 mm voxel
 * sweep inside a unit test for no extra coverage of *this* file.
 */
import { createHash } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { BlobId, CatalogFile } from '../../src/catalog'
import { BlobId as BlobIdSchema, TileId } from '../../src/catalog'
import { testCatalog } from '../measure/fixtures/catalog'

import type { MountTarget } from './catalog'
import { MeasurePool, runMounts } from './run'
import { appendEntry, readLog } from './sidecar'
import { syntheticStl } from './synthetic'

const MM = 25.4

function temp(): string {
  return mkdtempSync(join(tmpdir(), 'openforge-mounts-run-'))
}

function md5(bytes: Uint8Array): BlobId {
  return BlobIdSchema.parse(createHash('md5').update(bytes).digest('hex'))
}

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

/**
 * A response carrying the object's bytes and its md5 as a plain ETag.
 *
 * The body is a detached `ArrayBuffer` rather than the view, because this
 * project compiles the tools without the DOM lib and `BlobPart` is not in scope.
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
    if (blob === undefined || bytes === undefined) {
      return Promise.resolve(new Response('', { status: 404, statusText: 'Not Found' }))
    }
    return Promise.resolve(served(bytes, blob))
  }
}

/** A wall `wide` units long with one `top` slot. Distinct sizes give distinct md5s. */
function wall(wide: number): Uint8Array {
  return syntheticStl([{ min: [0, 0, 0], max: [wide * MM, MM / 2, MM] }])
}

function target(blob: BlobId, bytes: number, ord: number): MountTarget {
  return {
    kind: 'host',
    blob,
    ord,
    bytes,
    ids: [TileId.parse(`tiles/walls/w${String(ord)}.stl`)],
    family: 'tiles/walls',
    foot: { shape: 'wall', length: 1 },
    slots: [{ name: 'top', require: ['component|beam'] }],
  }
}

/** The catalog is only read for `assets.models`, so one row is enough. */
function catalogFor(blobs: readonly BlobId[]): CatalogFile {
  return testCatalog(blobs.map((blob, index) => ({ id: `tiles/w${String(index)}.stl`, ord: index, blob })))
}

interface Corpus {
  readonly targets: readonly MountTarget[]
  readonly catalog: CatalogFile
  readonly objects: ReadonlyMap<string, Uint8Array>
}

function corpus(count: number): Corpus {
  const objects = new Map<string, Uint8Array>()
  const targets: MountTarget[] = []
  for (let index = 0; index < count; index += 1) {
    const bytes = wall(index + 1)
    const blob = md5(bytes)
    objects.set(blob, bytes)
    targets.push(target(blob, bytes.byteLength, index))
  }
  return { targets, catalog: catalogFor([...objects.keys()].map((blob) => BlobIdSchema.parse(blob))), objects }
}

/** Every run in this file: no network, no backoff sleeps, no request spacing. */
function options(from: Corpus, logPath: string, count: (url: string) => void) {
  return {
    catalog: from.catalog,
    logPath,
    concurrency: 2,
    minIntervalMs: 0,
    fetch: {
      retries: 1,
      sleep: () => Promise.resolve(),
      fetchImpl: ((input, init) => {
        count(urlOf(input))
        return bucket(from.objects)(input, init)
      }) as typeof fetch,
    },
  }
}

describe('runMounts — resume', () => {
  it('re-reads nothing that is already in the log', async () => {
    const from = corpus(3)
    const logPath = join(temp(), 'mounts.jsonl')
    let requests = 0
    const shared = options(from, logPath, () => {
      requests += 1
    })

    const first = await runMounts({ ...shared, targets: from.targets })
    expect({ measured: first.measured, skipped: first.skipped, failed: first.failed }).toEqual({
      measured: 3,
      skipped: 0,
      failed: 0,
    })
    expect(requests).toBe(3)
    expect(first.mounts).toBe(3)

    const second = await runMounts({ ...shared, targets: from.targets })
    expect({ measured: second.measured, skipped: second.skipped }).toEqual({ measured: 0, skipped: 3 })
    // The whole point: no further bytes left the bucket.
    expect(requests).toBe(3)
    expect(second.bytesRead).toBe(0)
    expect(readLog(logPath).size).toBe(3)
  })

  it('re-reads only the failed blobs under --retry-failed', async () => {
    const from = corpus(2)
    const logPath = join(temp(), 'mounts.jsonl')
    const [good, bad] = from.targets
    if (good === undefined || bad === undefined) throw new Error('fixture')
    const asked: string[] = []
    const shared = options(from, logPath, (url) => {
      asked.push(url)
    })

    await runMounts({ ...shared, targets: [good] })
    appendEntry(logPath, { blob: bad.blob, kind: 'host', status: 'failed', reason: 'HTTP 503' })
    asked.length = 0

    const retried = await runMounts({ ...shared, targets: from.targets, retryFailed: true })
    expect({ measured: retried.measured, skipped: retried.skipped }).toEqual({ measured: 1, skipped: 1 })
    expect(asked.filter((url) => url.includes(bad.blob))).toHaveLength(1)
    expect(asked.filter((url) => url.includes(good.blob))).toHaveLength(0)
  })

  it('re-reads everything under --force, log or no log', async () => {
    const from = corpus(2)
    const logPath = join(temp(), 'mounts.jsonl')
    let requests = 0
    const shared = options(from, logPath, () => {
      requests += 1
    })

    await runMounts({ ...shared, targets: from.targets })
    const forced = await runMounts({ ...shared, targets: from.targets, force: true })

    expect({ measured: forced.measured, skipped: forced.skipped }).toEqual({ measured: 2, skipped: 0 })
    expect(requests).toBe(4)
  })
})

describe('runMounts — failure', () => {
  it('turns an unreadable object into one failed line and finishes the rest', async () => {
    const from = corpus(2)
    const logPath = join(temp(), 'mounts.jsonl')
    const [good] = from.targets
    if (good === undefined) throw new Error('fixture')
    // A blob the bucket has never heard of: the 404 is a finding about the
    // corpus, not a reason to lose the object beside it.
    const missing = target(BlobIdSchema.parse('f'.repeat(32)), 1000, 9)
    const events: string[] = []

    const outcome = await runMounts({
      ...options(from, logPath, () => undefined),
      targets: [good, missing],
      onProgress: (event) => {
        events.push(`${event.blob.slice(0, 4)}:${event.outcome}`)
      },
    })

    expect({ measured: outcome.measured, failed: outcome.failed }).toEqual({ measured: 1, failed: 1 })
    expect(outcome.failures.map((failure) => failure.blob)).toEqual([missing.blob])
    expect(outcome.failures[0]?.reason).toContain('404')
    expect(events).toContain('ffff:failed')

    const logged = readLog(logPath).get(missing.blob)
    expect(logged?.status).toBe('failed')
    // Recorded, so the next run does not re-read it without being asked to.
    expect(readLog(logPath).size).toBe(2)
  })
})

describe('MeasurePool', () => {
  it('measures a mesh in a real worker thread and closes so the process can exit', async () => {
    const bytes = wall(1)
    const pool = new MeasurePool(1)
    try {
      const answer = await pool.measure({
        kind: 'host',
        bytes: bytes.slice().buffer,
        foot: { shape: 'wall', length: 1 },
        slots: [{ name: 'top', require: ['component|beam'] }],
        alsoInsert: false,
      })

      expect(answer.error).toBeUndefined()
      expect(answer.triangles).toBe(12)
      const mount = answer.host?.mounts[0]
      expect(answer.host?.mounts).toHaveLength(1)
      expect(mount).toMatchObject({ slot: 'top', kind: 'surface', face: '+z' })
      // The mesh's vertices are `float32`, so the top of a 25.4 mm wall comes
      // back as 25.399999618530273 — compared with a tolerance rather than
      // rounded, because rounding here would hide a real millimetre error.
      expect(mount?.at[2]).toBeCloseTo(MM, 4)
    } finally {
      await pool.close()
    }
    // A live `Worker` keeps the event loop alive, so a pool that did not
    // terminate its threads would hang the CLI after the last measurement.
    // Closing twice is the run's `finally` path and must not throw.
    await pool.close()
  })

  it('refuses work once closed rather than hanging on a dead pool', async () => {
    const pool = new MeasurePool(1)
    await pool.close()
    await expect(
      pool.measure({
        kind: 'insert',
        bytes: wall(1).slice().buffer,
        foot: { shape: 'none' },
        slots: [],
        alsoInsert: false,
      }),
    ).rejects.toThrow(/closed/)
  })
})
