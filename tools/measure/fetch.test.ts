/**
 * Integrity, politeness, and the multipart ETag that B5 did not account for.
 *
 * No test here touches the network — `fetchImpl` is injected. What is asserted is
 * everything that decides whether a number in the sidecar describes the mesh the
 * index named: that the bytes are hashed and a mismatch is refused rather than
 * measured, that a multipart ETag cannot be used to bless a partial read, that a
 * range request answered with a 200 is refused instead of silently becoming a
 * full read, and that a finding is not retried.
 */
import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  MAX_CONCURRENCY,
  StlFetchError,
  USER_AGENT,
  facetRanges,
  fetchObject,
  normaliseEtag,
  rangeBytes,
} from './fetch'
import { BINARY_FACET_BYTES, BINARY_HEADER_BYTES } from '../../src/three/stl/parse'

const BODY = 'not really an stl, but it hashes'
const MD5 = createHash('md5').update(BODY).digest('hex')
const URL_ = `https://objects.example.test/models/${MD5.slice(0, 6)}/${MD5}.stl`

/** No real sleeping: backoff must not cost the suite seconds. */
const nap = (): Promise<void> => Promise.resolve()

function ok(body: string, etag: string, extra: Record<string, string> = {}): Response {
  return new Response(body, { status: 200, headers: { etag: `"${etag}"`, ...extra } })
}

function partial(body: string, etag: string, range: string, total: number): Response {
  return new Response(body, {
    status: 206,
    headers: { etag: `"${etag}"`, 'content-range': `bytes ${range}/${String(total)}` },
  })
}

describe('fetchObject', () => {
  it('sends an identifying User-Agent naming this tool', async () => {
    const seen: string[] = []
    await fetchObject(URL_, MD5, undefined, {
      sleep: nap,
      fetchImpl: (_url, init) => {
        seen.push(new Headers(init?.headers).get('user-agent') ?? '')
        return Promise.resolve(ok(BODY, MD5))
      },
    })
    expect(seen).toEqual([USER_AGENT])
    expect(USER_AGENT).toMatch(/openforge-workshop-measure/)
    expect(USER_AGENT).not.toMatch(/urllib|node-fetch|undici/i)
  })

  it('verifies a whole object by hashing it, not by trusting the ETag', async () => {
    // A multipart ETag is not the md5 — 58.5% of the corpus is above the 8 MiB
    // part size — so the content hash is what makes a full read trustworthy.
    const object = await fetchObject(URL_, MD5, undefined, {
      sleep: nap,
      fetchImpl: () => Promise.resolve(ok(BODY, `${'0'.repeat(32)}-9`)),
    })
    expect(object.verification).toBe('content-md5')
    expect(object.etagIsMd5).toBe(false)
    expect(object.readBytes).toBe(BODY.length)
  })

  it('refuses bytes that do not hash to the md5 the index named', async () => {
    await expect(
      fetchObject(URL_, MD5, undefined, {
        sleep: nap,
        fetchImpl: () => Promise.resolve(ok('a different mesh entirely', MD5)),
      }),
    ).rejects.toMatchObject({ name: 'StlFetchError', kind: 'etag' })
  })

  it('does not retry a hash mismatch — it is a finding, not a hiccup', async () => {
    let calls = 0
    await expect(
      fetchObject(URL_, MD5, undefined, {
        sleep: nap,
        retries: 3,
        fetchImpl: () => {
          calls += 1
          return Promise.resolve(ok('wrong', MD5))
        },
      }),
    ).rejects.toBeInstanceOf(StlFetchError)
    expect(calls).toBe(1)
  })

  it('accepts a partial read against a plain-md5 ETag', async () => {
    const object = await fetchObject(URL_, MD5, { from: 0, to: 3 }, {
      sleep: nap,
      fetchImpl: () => Promise.resolve(partial('abcd', MD5, '0-3', 4096)),
    })
    expect(object.verification).toBe('etag')
    expect(object.totalBytes).toBe(4096)
    expect(object.partial).toBe(true)
  })

  it('refuses a partial read of a multipart-uploaded object', async () => {
    // The ETag cannot verify it and the content hash is unavailable, so the read
    // is refused rather than producing an unverifiable dimension.
    await expect(
      fetchObject(URL_, MD5, { from: 0, to: 3 }, {
        sleep: nap,
        fetchImpl: () => Promise.resolve(partial('abcd', `${'1'.repeat(32)}-2`, '0-3', 4096)),
      }),
    ).rejects.toMatchObject({ kind: 'etag' })
  })

  it('refuses a range request the bucket answered with a 200', async () => {
    // Otherwise a "strided" measurement is silently a full one, and its recorded
    // confidence would understate what it actually knows — or, worse, a later
    // change would leave it overstating.
    await expect(
      fetchObject(URL_, MD5, { from: 0, to: 3 }, {
        sleep: nap,
        fetchImpl: () => Promise.resolve(ok(BODY, MD5)),
      }),
    ).rejects.toMatchObject({ kind: 'range' })
  })

  it('sends the Range header in HTTP’s inclusive form', async () => {
    const seen: string[] = []
    await fetchObject(URL_, MD5, { from: 84, to: 133 }, {
      sleep: nap,
      fetchImpl: (_url, init) => {
        seen.push(new Headers(init?.headers).get('range') ?? '')
        return Promise.resolve(partial('x'.repeat(50), MD5, '84-133', 1000))
      },
    })
    expect(seen).toEqual(['bytes=84-133'])
  })

  it('retries a 429 and a 5xx, and does not retry a 404', async () => {
    let calls = 0
    const object = await fetchObject(URL_, MD5, undefined, {
      sleep: nap,
      retries: 3,
      fetchImpl: () => {
        calls += 1
        if (calls < 3) return Promise.resolve(new Response('', { status: 503, statusText: 'busy' }))
        return Promise.resolve(ok(BODY, MD5))
      },
    })
    expect(object.verification).toBe('content-md5')
    expect(calls).toBe(3)

    let notFound = 0
    await expect(
      fetchObject(URL_, MD5, undefined, {
        sleep: nap,
        retries: 3,
        fetchImpl: () => {
          notFound += 1
          return Promise.resolve(new Response('', { status: 404, statusText: 'gone' }))
        },
      }),
    ).rejects.toMatchObject({ kind: 'http', status: 404 })
    expect(notFound).toBe(1)
  })

  it('names Cloudflare in a 403, because that is what a rejected agent looks like', async () => {
    await expect(
      fetchObject(URL_, MD5, undefined, {
        sleep: nap,
        retries: 1,
        fetchImpl: () => Promise.resolve(new Response('', { status: 403, statusText: 'no' })),
      }),
    ).rejects.toThrow(/1010/)
  })

  it('refuses a response with no ETag on a partial read', async () => {
    await expect(
      fetchObject(URL_, MD5, { from: 0, to: 3 }, {
        sleep: nap,
        fetchImpl: () =>
          Promise.resolve(
            new Response('abcd', { status: 206, headers: { 'content-range': 'bytes 0-3/9' } }),
          ),
      }),
    ).rejects.toMatchObject({ kind: 'etag' })
  })
})

describe('normaliseEtag', () => {
  it('strips quotes and the weak prefix, and keeps the multipart suffix', () => {
    expect(normaliseEtag('"abc"')).toBe('abc')
    expect(normaliseEtag('W/"abc"')).toBe('abc')
    expect(normaliseEtag('"abc-9"')).toBe('abc-9')
    expect(normaliseEtag(null)).toBeUndefined()
    expect(normaliseEtag('""')).toBeUndefined()
  })
})

describe('facetRanges', () => {
  it('addresses facet i at 84 + 50i, inclusive of its last byte', () => {
    // Stride 2 over 5 facets, with coalescing off: facets 0, 2 and 4 as separate
    // windows. Stride 1 would be three *adjacent* windows, which coalesce into
    // one whatever the threshold — correctly, since they are contiguous bytes.
    expect(facetRanges(5, 2, 0)).toEqual([
      { from: BINARY_HEADER_BYTES, to: BINARY_HEADER_BYTES + BINARY_FACET_BYTES - 1 },
      { from: BINARY_HEADER_BYTES + 100, to: BINARY_HEADER_BYTES + 149 },
      { from: BINARY_HEADER_BYTES + 200, to: BINARY_HEADER_BYTES + 249 },
    ])
    expect(facetRanges(3, 1, 0)).toEqual([
      { from: BINARY_HEADER_BYTES, to: BINARY_HEADER_BYTES + 3 * BINARY_FACET_BYTES - 1 },
    ])
  })

  it('coalesces windows whose gap is under the threshold', () => {
    // This is the arithmetic that sinks the strided plan: 50-byte records mean a
    // stride only transfers less than the whole object once 50 × stride exceeds
    // the coalescing threshold.
    const coalesced = facetRanges(1000, 8, 64 * 1024)
    expect(coalesced).toHaveLength(1)
    expect(rangeBytes(coalesced)).toBeGreaterThan(1000 * BINARY_FACET_BYTES * 0.98)

    const separated = facetRanges(1000, 8, 0)
    expect(separated).toHaveLength(125)
    expect(rangeBytes(separated)).toBe(125 * BINARY_FACET_BYTES)
  })

  it('is empty for a facet-less object and rejects a bad stride', () => {
    expect(facetRanges(0, 4)).toEqual([])
    expect(() => facetRanges(10, 0)).toThrow(RangeError)
    expect(() => facetRanges(10, 2.5)).toThrow(RangeError)
  })
})

describe('politeness', () => {
  it('caps concurrency at 8 — this is somebody else’s production bucket', () => {
    expect(MAX_CONCURRENCY).toBe(8)
  })
})
