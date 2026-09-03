/**
 * Resume, per-object failure, and the journal.
 *
 * No network: `fetchImpl` serves the checked-in catalog mesh. The property under
 * test is the one that decides whether a 108 GB pass is survivable — that a
 * second run does nothing, costs no request, and still emits a **complete**
 * manifest, weld ratios and fidelity figures included.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { lodPath } from './catalog'
import { readGlb } from './decimate'
import { asBlob, testCatalog } from './fixtures/catalog'
import { EMPTY_BLOB, FIXTURE_BLOB, FIXTURE_WELD, emptyStl, fixtureStl } from './fixtures/wall'
import { binaryStl, disconnectedSoup } from './fixtures/stl'
import { md5Hex } from './fetch'
import { JOURNAL_NAME, readJournal, runLod } from './run'
import type { SamplePick } from './sample'
import { selectAll } from './sample'
import { meshTargets } from './catalog'

const BROKEN_BLOB = asBlob('00000000000000000000000000000000')

const CATALOG = testCatalog({
  records: [
    { id: 'tiles/wall.stl', ord: 0, blob: FIXTURE_BLOB, bytes: 5_984 },
    { id: 'tiles/wall-again.stl', ord: 1, blob: FIXTURE_BLOB, bytes: 5_984 },
    { id: 'tiles/empty.stl', ord: 2, blob: EMPTY_BLOB, bytes: 84 },
  ],
})

function bodies(): Map<string, Uint8Array> {
  const map = new Map<string, Uint8Array>()
  map.set(FIXTURE_BLOB, fixtureStl())
  map.set(EMPTY_BLOB, emptyStl())
  return map
}

interface Harness {
  outDir: string
  picks: SamplePick[]
  calls: string[]
  fetchImpl: typeof fetch
}

function harness(overrides: { bodies?: Map<string, Uint8Array> } = {}): Harness {
  const outDir = mkdtempSync(join(tmpdir(), 'openforge-lod-run-'))
  const table = overrides.bodies ?? bodies()
  const calls: string[] = []
  const fetchImpl: typeof fetch = (input) => {
    const url = requestUrl(input)
    const blob = url.slice(url.lastIndexOf('/') + 1).replace('.stl', '')
    calls.push(blob)
    const body = table.get(blob)
    if (body === undefined) return Promise.resolve(new Response('', { status: 404, statusText: 'not found' }))
    // md5 verification happens in fetch.ts; serve a real ETag so it passes.
    return Promise.resolve(
      new Response(new Blob([Uint8Array.from(body)]), { status: 200, headers: { etag: `"${blob}"` } }),
    )
  }
  return { outDir, picks: selectAll(meshTargets(CATALOG).targets), calls, fetchImpl }
}

const nap = (): Promise<void> => Promise.resolve()

/** The URL a `fetch` was called with, whichever of the three forms it took. */
function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

describe('runLod', () => {
  it('writes one object per distinct mesh and journals what it did', async () => {
    const { outDir, picks, calls, fetchImpl } = harness()
    const report = await runLod({
      catalog: CATALOG,
      picks,
      outDir,
      concurrency: 2,
      minIntervalMs: 0,
      fetch: { fetchImpl, sleep: nap },
    })

    // Two catalog rows share the wall mesh: one object, one fetch.
    expect(picks).toHaveLength(2)
    expect(report.written).toBe(1)
    expect(report.empty).toBe(1)
    expect(report.failed).toEqual([])
    expect(calls).toEqual([FIXTURE_BLOB, EMPTY_BLOB])

    const path = lodPath(CATALOG, asBlob(FIXTURE_BLOB), outDir)
    expect(existsSync(path)).toBe(true)

    const journal = readJournal(join(outDir, JOURNAL_NAME))
    expect(journal.size).toBe(2)
    const wall = journal.get(FIXTURE_BLOB)
    expect(wall?.outcome).toBe('written')
    expect(wall?.tiles).toBe(2)
    expect(wall?.weld?.before).toBe(FIXTURE_WELD.before)
    expect(wall?.weld?.after).toBe(FIXTURE_WELD.after)
    expect(wall?.weld?.ratio).toBeCloseTo(FIXTURE_WELD.after / FIXTURE_WELD.before, 6)
    expect(journal.get(EMPTY_BLOB)?.outcome).toBe('empty')

    rmSync(outDir, { recursive: true, force: true })
  })

  it('skips completed work on a second run, with no request at all', async () => {
    const first = harness()
    await runLod({
      catalog: CATALOG,
      picks: first.picks,
      outDir: first.outDir,
      minIntervalMs: 0,
      fetch: { fetchImpl: first.fetchImpl, sleep: nap },
    })

    const calls: string[] = []
    const report = await runLod({
      catalog: CATALOG,
      picks: first.picks,
      outDir: first.outDir,
      minIntervalMs: 0,
      fetch: {
        fetchImpl: (input) => {
          calls.push(requestUrl(input))
          return Promise.reject(new Error('should not be called'))
        },
        sleep: nap,
      },
    })

    expect(calls).toEqual([])
    expect(report.written).toBe(0)
    expect(report.skipped).toBe(1)
    expect(report.empty).toBe(1)
    expect(report.fetched).toBe(0)

    // And the manifest is still complete: the journal carried the weld figures
    // through a run that derived nothing.
    const wall = report.entries.find((entry) => entry.blob === FIXTURE_BLOB)
    expect(wall?.weld?.after).toBe(FIXTURE_WELD.after)
    expect(report.contents.get(wall?.key ?? '')?.byteLength).toBeGreaterThan(0)

    rmSync(first.outDir, { recursive: true, force: true })
  })

  it('re-derives under --force', async () => {
    const { outDir, picks, fetchImpl } = harness()
    const options = { catalog: CATALOG, picks, outDir, minIntervalMs: 0, fetch: { fetchImpl, sleep: nap } }
    await runLod(options)
    const report = await runLod({ ...options, force: true })
    expect(report.written).toBe(1)
    expect(report.skipped).toBe(0)
    rmSync(outDir, { recursive: true, force: true })
  })

  it('recovers an object whose journal line was lost, by reading the GLB back', async () => {
    const { outDir, picks, fetchImpl } = harness()
    await runLod({ catalog: CATALOG, picks, outDir, minIntervalMs: 0, fetch: { fetchImpl, sleep: nap } })

    // The shape of a killed run, or a deleted journal.
    rmSync(join(outDir, JOURNAL_NAME))

    const report = await runLod({
      catalog: CATALOG,
      picks,
      outDir,
      minIntervalMs: 0,
      fetch: {
        fetchImpl: (input) => {
          // The empty mesh has no object, so it is legitimately re-fetched.
          if (requestUrl(input).includes(EMPTY_BLOB)) return fetchImpl(input)
          return Promise.reject(new Error('the wall mesh should not be re-fetched'))
        },
        sleep: nap,
      },
    })

    expect(report.skipped).toBe(1)
    const wall = report.entries.find((entry) => entry.blob === FIXTURE_BLOB)
    // Honest about what it cannot recover: the derivation figures are gone.
    expect(wall?.weld).toBeNull()
    expect(wall?.triangles).toBeGreaterThan(0)
    const summary = await readGlb(readFileSync(lodPath(CATALOG, asBlob(FIXTURE_BLOB), outDir)))
    expect(wall?.triangles).toBe(summary.triangles)

    rmSync(outDir, { recursive: true, force: true })
  })

  it('records a 404 against its mesh and keeps going', async () => {
    const catalog = testCatalog({
      records: [
        { id: 'tiles/missing.stl', ord: 0, blob: BROKEN_BLOB, bytes: 1_000 },
        { id: 'tiles/wall.stl', ord: 1, blob: FIXTURE_BLOB, bytes: 5_984 },
      ],
    })
    const { outDir, fetchImpl } = harness()
    const report = await runLod({
      catalog,
      picks: selectAll(meshTargets(catalog).targets),
      outDir,
      minIntervalMs: 0,
      fetch: { fetchImpl, sleep: nap },
    })

    expect(report.written).toBe(1)
    expect(report.failed).toHaveLength(1)
    expect(report.failed[0]?.blob).toBe(BROKEN_BLOB)
    expect(report.failed[0]?.kind).toBe('ModelFetchError')
    // A failure is not journalled, so the next run retries it.
    expect(readJournal(join(outDir, JOURNAL_NAME)).has(BROKEN_BLOB)).toBe(false)

    rmSync(outDir, { recursive: true, force: true })
  })

  it('records a weld no-op as a named failure rather than shipping the object', async () => {
    const soup = binaryStl(disconnectedSoup(40))
    const blob = md5Hex(soup)
    const catalog = testCatalog({
      records: [{ id: 'tiles/soup.stl', ord: 0, blob, bytes: soup.byteLength }],
    })
    const { outDir } = harness()
    const report = await runLod({
      catalog,
      picks: selectAll(meshTargets(catalog).targets),
      outDir,
      minIntervalMs: 0,
      fetch: {
        fetchImpl: () =>
          Promise.resolve(new Response(new Blob([Uint8Array.from(soup)]), { status: 200, headers: { etag: `"${blob}"` } })),
        sleep: nap,
      },
    })

    expect(report.written).toBe(0)
    expect(report.failed).toHaveLength(1)
    expect(report.failed[0]?.kind).toBe('WeldNoOpError')
    expect(report.failed[0]?.reason).toContain('facet normals')
    // Nothing is staged, and nothing is journalled, so a fix re-runs it.
    expect(existsSync(lodPath(catalog, asBlob(blob), outDir))).toBe(false)
    expect(readJournal(join(outDir, JOURNAL_NAME)).size).toBe(0)
    rmSync(outDir, { recursive: true, force: true })
  })
})

describe('readJournal', () => {
  it('drops a truncated final line instead of throwing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'openforge-lod-journal-'))
    const path = join(dir, JOURNAL_NAME)
    writeFileSync(path, `{"blob":"${FIXTURE_BLOB}","outcome":"written"}\n{"blob":"trunc`)
    const journal = readJournal(path)
    expect(journal.size).toBe(1)
    expect(journal.has(FIXTURE_BLOB)).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('is empty for a directory that has never been run', () => {
    expect(readJournal(join(tmpdir(), 'openforge-lod-nope', JOURNAL_NAME)).size).toBe(0)
  })
})
