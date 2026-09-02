// @vitest-environment jsdom
/**
 * The shared index fetch.
 *
 * Two properties are worth asserting, and both are design claims made in
 * `catalogStats.tsx` rather than incidental behaviour:
 *
 *   1. **One fetch.** The index is 5.6 MB and three consumers want it. If the
 *      memoisation broke, nothing would look wrong — the app would just download
 *      and parse the catalog three times.
 *   2. **The stats read does not validate.** The header's tile count must survive
 *      a record the schema has drifted away from, because a schema mismatch
 *      somewhere in 8,702 records should not blank the chrome.
 *
 * `fetch` is stubbed rather than served, so these tests do not depend on
 * `public/catalog/catalog.json` having been built.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { loadCatalogIndex, loadCatalogStats, resetCatalogIndexCache } from './catalogStats'

/** An index whose top level is right and whose records are not. */
const MALFORMED_RECORDS = {
  version: { schema: 1, pipeline: 1, fixtures: 'abc', manifest: 1, built: '2026-01-01T00:00:00Z' },
  assets: {
    models: 'https://objects.openforge.tools/models',
    sprites: 'https://objects.openforge.tools/sprites',
    thumbs: 'https://objects.openforge.tools/thumbs',
    lod: 'https://objects.openforge.tools/lod',
  },
  sprite: { rows: 2, cols: 5, tile: 512, frames: 10, defaultFrame: 0 },
  tags: ['texture|cave'],
  records: [{ this: 'is not a CatalogRecord' }, { nor: 'is this' }],
}

function stubFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  // Typed as `URL` rather than `RequestInfo | URL`: the loader resolves the path
  // against `location.href` before calling, and the narrower type is what lets
  // the assertion below stringify the recorded argument.
  const fetchSpy = vi.fn((_input: URL) =>
    Promise.resolve({
      ok: init.ok ?? true,
      status: init.status ?? 200,
      statusText: 'OK',
      json: () => Promise.resolve(body),
    } as Response),
  )
  vi.stubGlobal('fetch', fetchSpy)
  return fetchSpy
}

beforeEach(() => {
  resetCatalogIndexCache()
})

afterEach(() => {
  resetCatalogIndexCache()
  vi.unstubAllGlobals()
})

describe('loadCatalogStats', () => {
  it('reads the tile count and the archive host off the index', async () => {
    stubFetch(MALFORMED_RECORDS)

    // Two records, and the host of `assets.models` — not a hard-coded 8,702 and
    // not the contract's "s3".
    await expect(loadCatalogStats()).resolves.toEqual({
      tileCount: 2,
      archiveHost: 'objects.openforge.tools',
    })
  })

  it('requests the index the build emits', async () => {
    const fetchSpy = stubFetch(MALFORMED_RECORDS)

    await loadCatalogStats()

    const [requested] = fetchSpy.mock.calls[0] ?? []
    expect(String(requested)).toBe(`${window.location.origin}/catalog/catalog.json`)
  })

  it('fetches once however many consumers ask', async () => {
    const fetchSpy = stubFetch(MALFORMED_RECORDS)

    await Promise.all([loadCatalogStats(), loadCatalogStats(), loadCatalogStats()])
    await loadCatalogStats()

    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('rejects rather than guessing when the shape is not an index at all', async () => {
    stubFetch({ nope: true })
    await expect(loadCatalogStats()).rejects.toThrow('no records array')

    resetCatalogIndexCache()
    stubFetch({ records: [], assets: {} })
    await expect(loadCatalogStats()).rejects.toThrow('no assets.models URL')
  })

  it('reports a failed request instead of resolving to nothing', async () => {
    stubFetch(null, { ok: false, status: 404 })
    await expect(loadCatalogStats()).rejects.toThrow('404')
  })
})

describe('loadCatalogIndex', () => {
  it('validates, where the stats read deliberately does not', async () => {
    stubFetch(MALFORMED_RECORDS)

    // Same document, same single fetch: the full parse refuses it and the header
    // still gets its count. That split is the point of having two functions.
    await expect(loadCatalogIndex()).rejects.toThrow()
    await expect(loadCatalogStats()).resolves.toMatchObject({ tileCount: 2 })
  })
})
