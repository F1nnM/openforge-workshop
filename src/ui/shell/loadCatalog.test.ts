// @vitest-environment jsdom
/**
 * The shared index fetch.
 *
 * Three properties are worth asserting, and all three are design claims made in
 * `loadCatalog.ts` rather than incidental behaviour:
 *
 *   1. **One fetch.** The index is 5.6 MB and two consumers want it. If the
 *      memoisation broke, nothing would look wrong — the app would just download
 *      and parse the catalog twice.
 *   2. **The parse is memoised too**, not only the fetch, because validating
 *      8,702 records costs a measured 45-90 ms.
 *   3. **It validates.** A document that is shaped like an index but whose
 *      records are not `CatalogRecord`s is refused rather than handed to the
 *      facet engine or to a three.js material.
 *
 * **The fourth property this file used to assert is gone with the header's
 * archive stat.** `loadCatalogStats` read `records.length` and `assets.models`
 * *without* validating, so a schema drift in one record could not blank the tile
 * count in the chrome; the sidebar row deleted the stat, and an unvalidated read
 * with no reader is a second way to load the index that nothing needs. Its
 * fixture stays below, because "shaped right, records wrong" is exactly the
 * document property 3 is about.
 *
 * `fetch` is stubbed rather than served, so these tests do not depend on
 * `public/catalog/catalog.json` having been built.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FIXTURE_CATALOG } from '@/screens/catalog/fixture'

import { loadCatalogIndex, resetCatalogIndexCache } from './loadCatalog'

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

describe('loadCatalogIndex', () => {
  it('requests the index the build emits', async () => {
    const fetchSpy = stubFetch(FIXTURE_CATALOG)

    await loadCatalogIndex()

    const [requested] = fetchSpy.mock.calls[0] ?? []
    expect(String(requested)).toBe(`${window.location.origin}/catalog/catalog.json`)
  })

  it('fetches once however many consumers ask', async () => {
    const fetchSpy = stubFetch(FIXTURE_CATALOG)

    await Promise.all([loadCatalogIndex(), loadCatalogIndex(), loadCatalogIndex()])
    await loadCatalogIndex()

    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('hands every caller the same parsed document, not a re-parse of it', async () => {
    stubFetch(FIXTURE_CATALOG)

    const [first, second] = await Promise.all([loadCatalogIndex(), loadCatalogIndex()])

    // Identity, because a second parse would produce an equal object and this is
    // the only way to tell the two apart from outside.
    expect(first).toBe(second)
  })

  it('validates, so a drifted record cannot reach a consumer', async () => {
    stubFetch(MALFORMED_RECORDS)

    await expect(loadCatalogIndex()).rejects.toThrow()
  })

  it('reports a failed request instead of resolving to nothing', async () => {
    stubFetch(null, { ok: false, status: 404 })

    await expect(loadCatalogIndex()).rejects.toThrow('404')
  })
})
