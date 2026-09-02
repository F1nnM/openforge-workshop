/**
 * The bucket probe.
 *
 * Every case here injects `fetchImpl`, so nothing reaches the network — the
 * real run against the live bucket is recorded in `pipeline/thumbs.test.ts`
 * against the committed artefact it produced (8,352 probed, 0 present, 419.9 s).
 * What is asserted here is the classification, which is the part that can be
 * wrong in a way nobody would notice:
 *
 *   - **200 is present, 404 is absent, everything else is a failure.** Folding a
 *     503 into "absent" is the bug this row is most exposed to: it would take a
 *     thumbnail that exists out of the index and look exactly like the
 *     8,352-strong majority that genuinely does not have one.
 *   - **A 404 is never retried.** It is the answer, for every object, until the
 *     backfill runs. Retrying it three times would triple a 25,056-request run.
 */
import { describe, expect, it, vi } from 'vitest'

import type { BlobId, CatalogFile } from '../../src/catalog'

import { probeThumbs, thumbCandidates } from './inventory'
import { testCatalog } from './fixtures/catalog'

const BLOBS = ['a'.repeat(32), 'b'.repeat(32), 'c'.repeat(32)] as BlobId[]

function index(): CatalogFile {
  return testCatalog({
    records: [
      { id: 'tiles/x/one.stl', ord: 0, blob: BLOBS[0] as string },
      { id: 'tiles/x/two.stl', ord: 1, blob: BLOBS[1] as string },
      { id: 'tiles/x/none.stl', ord: 2, blob: BLOBS[2] as string, sprite: false },
    ],
  })
}

/** A `fetch` that answers per URL, and counts how often each was asked. */
function responder(status: (url: string) => number): {
  impl: typeof fetch
  calls: Map<string, number>
} {
  const calls = new Map<string, number>()
  const impl = vi.fn((input: string | URL | Request) => {
    // `probeThumbs` always passes a string; `Request` is in the signature only
    // because that is what `typeof fetch` says.
    const url = input instanceof Request ? input.url : String(input)
    calls.set(url, (calls.get(url) ?? 0) + 1)
    return Promise.resolve(new Response(null, { status: status(url) }))
  }) as unknown as typeof fetch
  return { impl, calls }
}

const settings = { minIntervalMs: 0, sleep: () => Promise.resolve(), probedAt: '2026-01-01T00:00:00.000Z' }

describe('thumbCandidates', () => {
  it('asks only about blobs the index says have a sheet', () => {
    // The derivative is cropped from frame 0 of the sheet, so a spriteless tile
    // cannot have one. Probing it would return a 404 indistinguishable from the
    // "not backfilled yet" 404s and put a meaningless key in the work list.
    expect(thumbCandidates(index())).toEqual([BLOBS[0], BLOBS[1]].sort())
  })

  it('dedupes, because 171 md5s are shared by 520 catalog rows', () => {
    const shared = testCatalog({
      records: [
        { id: 'tiles/x/one.stl', ord: 0, blob: BLOBS[0] as string },
        { id: 'tiles/x/again.stl', ord: 1, blob: BLOBS[0] as string },
      ],
    })
    expect(thumbCandidates(shared)).toEqual([BLOBS[0]])
  })
})

describe('probeThumbs', () => {
  it('classifies 200 as present and 404 as absent', async () => {
    const { impl } = responder((url) => (url.includes('a'.repeat(32)) ? 200 : 404))
    const report = await probeThumbs({ catalog: index(), blobs: BLOBS.slice(0, 2), fetchImpl: impl, ...settings })

    expect(report.inventory.counted).toEqual({ probed: 2, present: 1, absent: 1, failed: 0 })
    expect(report.inventory.present).toEqual([BLOBS[0]])
    expect(report.failures).toEqual([])
  })

  it("uses HEAD, so a full probe costs no egress from someone else's bucket", async () => {
    const seen: string[] = []
    const impl = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      seen.push(init?.method ?? 'GET')
      return Promise.resolve(new Response(null, { status: 404 }))
    }) as unknown as typeof fetch

    await probeThumbs({ catalog: index(), blobs: [BLOBS[0] as BlobId], fetchImpl: impl, ...settings })

    expect(seen).toEqual(['HEAD'])
  })

  it('identifies itself, because Cloudflare answers a default agent with 403', async () => {
    let agent: string | undefined
    const impl = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      agent = (init?.headers as Record<string, string> | undefined)?.['user-agent']
      return Promise.resolve(new Response(null, { status: 404 }))
    }) as unknown as typeof fetch

    await probeThumbs({ catalog: index(), blobs: [BLOBS[0] as BlobId], fetchImpl: impl, ...settings })

    expect(agent).toMatch(/openforge-workshop-thumbnails/)
  })

  it('records a 5xx as a failure and never as an absence', async () => {
    // The whole reason `failed` is a separate count: "the bucket said no" and
    // "we could not ask" are different facts and only one is safe to ship.
    const { impl } = responder(() => 503)
    const report = await probeThumbs({
      catalog: index(),
      blobs: [BLOBS[0] as BlobId],
      fetchImpl: impl,
      retries: 2,
      ...settings,
    })

    expect(report.inventory.counted).toEqual({ probed: 1, present: 0, absent: 0, failed: 1 })
    expect(report.failures[0]?.reason).toMatch(/503/)
  })

  it('names a 403 as the client being refused, not as a missing object', async () => {
    const { impl } = responder(() => 403)
    const report = await probeThumbs({
      catalog: index(),
      blobs: [BLOBS[0] as BlobId],
      fetchImpl: impl,
      ...settings,
    })

    expect(report.inventory.counted.failed).toBe(1)
    expect(report.failures[0]?.reason).toMatch(/Cloudflare/)
  })

  it('retries a 5xx and never a 404', async () => {
    const { impl, calls } = responder((url) => (url.includes('a'.repeat(32)) ? 503 : 404))
    await probeThumbs({
      catalog: index(),
      blobs: BLOBS.slice(0, 2),
      fetchImpl: impl,
      retries: 3,
      ...settings,
    })

    const [transient, missing] = [...calls.entries()].sort(([a], [b]) => (a < b ? -1 : 1))
    expect(transient?.[1]).toBe(3)
    expect(missing?.[1]).toBe(1)
  })

  it('records a network error as a failure', async () => {
    const impl = vi.fn(() => Promise.reject(new Error('ECONNRESET'))) as unknown as typeof fetch
    const report = await probeThumbs({
      catalog: index(),
      blobs: [BLOBS[0] as BlobId],
      fetchImpl: impl,
      retries: 1,
      ...settings,
    })

    expect(report.failures[0]?.reason).toBe('ECONNRESET')
  })

  it('writes the base, the extension and a sorted payload the pipeline can read', async () => {
    const { impl } = responder(() => 200)
    const report = await probeThumbs({
      catalog: index(),
      blobs: [BLOBS[1], BLOBS[0]] as BlobId[],
      fetchImpl: impl,
      ...settings,
    })

    expect(report.inventory.base).toBe(index().assets.thumbs)
    expect(report.inventory.extension).toBe('.webp')
    // Sorted, so two probes of an unchanged bucket produce byte-identical files
    // and a diff shows only what actually landed.
    expect(report.inventory.present).toEqual([...BLOBS.slice(0, 2)].sort())
    expect(report.inventory.probed).toBe('2026-01-01T00:00:00.000Z')
  })

  it('asks about the same URL the app will fetch', async () => {
    const { impl, calls: seen } = responder(() => 404)
    await probeThumbs({ catalog: index(), blobs: [BLOBS[0] as BlobId], fetchImpl: impl, ...settings })

    // Sharded two levels on the md5, `.webp`, under `assets.thumbs`. A probe of
    // a different path shape would report the whole bucket empty for ever.
    expect([...seen.keys()][0]).toBe(
      `${index().assets.thumbs}/${'a'.repeat(6)}/${'a'.repeat(32)}.webp`,
    )
  })
})
