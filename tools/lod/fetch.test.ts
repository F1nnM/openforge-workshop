/**
 * Politeness, the cache, and proving the bytes are the right bytes.
 *
 * No test here touches the network: `fetchImpl` is injected. What is asserted is
 * everything that decides how this tool behaves against somebody else's
 * production bucket — that it identifies itself, that it does not retry a
 * finding, that it does retry a hiccup — plus the check the blockers table gets
 * wrong: **the ETag is only the md5 for single-part uploads**, so verification is
 * done on the body's hash.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  BlobMismatchError,
  ModelFetchError,
  USER_AGENT,
  backoffMs,
  cachePath,
  etagMd5,
  fetchModel,
  mapLimit,
  md5Hex,
} from './fetch'
import { fixtureStl } from './fixtures/wall'
import { FIXTURE_BLOB } from './fixtures/wall'

const BODY = fixtureStl()
const URL_ = `https://objects.example.test/models/8180da/${FIXTURE_BLOB}.stl`

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'openforge-lod-'))
}

/**
 * A 200 carrying the fixture, with whatever ETag the bucket would have sent.
 *
 * The body goes through a `Blob` because this project's tool tsconfig has no DOM
 * lib, so `BodyInit` is not a global name here.
 */
function ok(body: Uint8Array = BODY, etag?: string): Response {
  return new Response(new Blob([Uint8Array.from(body)]), {
    status: 200,
    headers: etag === undefined ? {} : { etag },
  })
}
const fail = (status: number): Response => new Response('', { status, statusText: 'nope' })

/** No real sleeping: backoff must not cost the suite seconds. */
const nap = (): Promise<void> => Promise.resolve()

describe('etagMd5', () => {
  it('reads a single-part ETag as an md5', () => {
    expect(etagMd5(`"${FIXTURE_BLOB}"`)).toBe(FIXTURE_BLOB)
    expect(etagMd5(FIXTURE_BLOB)).toBe(FIXTURE_BLOB)
    expect(etagMd5(`W/"${FIXTURE_BLOB}"`)).toBe(FIXTURE_BLOB)
  })

  it('refuses a multipart ETag, which carries no md5 at all', () => {
    // Real values from the bucket: a 10.4 MB object and a 108.9 MB object.
    expect(etagMd5('"ec7c20ffdac62e5c81719e6d4f70955a-2"')).toBeNull()
    expect(etagMd5('"7d025d6a2cc7844f8db768a3a44b5665-13"')).toBeNull()
    expect(etagMd5(null)).toBeNull()
    expect(etagMd5('"not-a-hash"')).toBeNull()
  })
})

describe('fetchModel', () => {
  it('sends an identifying User-Agent', async () => {
    const seen: string[] = []
    await fetchModel(URL_, FIXTURE_BLOB, {
      sleep: nap,
      fetchImpl: (_url, init) => {
        seen.push(new Headers(init?.headers).get('user-agent') ?? '')
        return Promise.resolve(ok())
      },
    })
    expect(seen).toEqual([USER_AGENT])
    expect(USER_AGENT).toMatch(/openforge-workshop-lod/)
    expect(USER_AGENT).not.toMatch(/urllib|node-fetch|undici/i)
  })

  it('accepts a body that hashes to the md5 asked for', async () => {
    const result = await fetchModel(URL_, FIXTURE_BLOB, {
      sleep: nap,
      fetchImpl: () => Promise.resolve(ok(BODY, `"${FIXTURE_BLOB}"`)),
    })
    expect(md5Hex(result.bytes)).toBe(FIXTURE_BLOB)
    expect(result.etagVerified).toBe(true)
  })

  it('rejects a single-part ETag that disagrees with the md5', async () => {
    await expect(
      fetchModel(URL_, FIXTURE_BLOB, {
        sleep: nap,
        // Right body, wrong ETag: the object was replaced under the key, or the
        // edge served a different one.
        fetchImpl: () => Promise.resolve(ok(BODY, '"ffffffffffffffffffffffffffffffff"')),
      }),
    ).rejects.toThrow(BlobMismatchError)
  })

  it('rejects a body that hashes to something else, multipart ETag or not', async () => {
    const wrong = new Uint8Array(BODY)
    wrong[200] = (wrong[200] ?? 0) ^ 0xff

    await expect(
      fetchModel(URL_, FIXTURE_BLOB, {
        sleep: nap,
        fetchImpl: () => Promise.resolve(ok(wrong, '"ec7c20ffdac62e5c81719e6d4f70955a-2"')),
      }),
    ).rejects.toThrow(BlobMismatchError)
  })

  it('accepts a multipart ETag when the body is right — it cannot be compared', async () => {
    const result = await fetchModel(URL_, FIXTURE_BLOB, {
      sleep: nap,
      fetchImpl: () => Promise.resolve(ok(BODY, '"ec7c20ffdac62e5c81719e6d4f70955a-2"')),
    })
    expect(result.etagVerified).toBe(false)
    expect(result.bytes.byteLength).toBe(BODY.byteLength)
  })

  it('names the blob and the hash in the mismatch, so it is diagnosable', async () => {
    const error = await fetchModel(URL_, FIXTURE_BLOB, {
      sleep: nap,
      fetchImpl: () => Promise.resolve(ok(new Uint8Array(84))),
    }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(BlobMismatchError)
    expect((error as BlobMismatchError).expected).toBe(FIXTURE_BLOB)
    expect((error as BlobMismatchError).message).toContain(FIXTURE_BLOB)
  })

  it('writes into the sharded cache and reads it back without a request', async () => {
    const cacheDir = tempDir()
    let calls = 0
    const impl: typeof fetch = () => {
      calls += 1
      return Promise.resolve(ok())
    }

    const first = await fetchModel(URL_, FIXTURE_BLOB, { cacheDir, fetchImpl: impl, sleep: nap })
    expect(first.fromCache).toBe(false)
    expect(readFileSync(cachePath(cacheDir, FIXTURE_BLOB)).byteLength).toBe(BODY.byteLength)

    const second = await fetchModel(URL_, FIXTURE_BLOB, { cacheDir, fetchImpl: impl, sleep: nap })
    expect(second.fromCache).toBe(true)
    expect(calls).toBe(1)
  })

  it('detects a corrupt cache rather than decimating it', async () => {
    const cacheDir = tempDir()
    const path = cachePath(cacheDir, FIXTURE_BLOB)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, 'not an stl')
    await expect(
      fetchModel(URL_, FIXTURE_BLOB, {
        cacheDir,
        sleep: nap,
        fetchImpl: () => Promise.reject(new Error('should not be called')),
      }),
    ).rejects.toThrow(BlobMismatchError)
  })

  it('does not retry a 404 — the index said it exists, so that is a finding', async () => {
    let calls = 0
    await expect(
      fetchModel(URL_, FIXTURE_BLOB, {
        sleep: nap,
        fetchImpl: () => {
          calls += 1
          return Promise.resolve(fail(404))
        },
      }),
    ).rejects.toThrow(ModelFetchError)
    expect(calls).toBe(1)
  })

  it('does not retry a 403, and says what it means', async () => {
    let calls = 0
    const error = await fetchModel(URL_, FIXTURE_BLOB, {
      sleep: nap,
      fetchImpl: () => {
        calls += 1
        return Promise.resolve(fail(403))
      },
    }).catch((caught: unknown) => caught)
    expect(calls).toBe(1)
    expect((error as ModelFetchError).message).toContain('1010')
  })

  it('retries a 429 and succeeds', async () => {
    let calls = 0
    const result = await fetchModel(URL_, FIXTURE_BLOB, {
      sleep: nap,
      fetchImpl: () => {
        calls += 1
        return Promise.resolve(calls < 3 ? fail(429) : ok())
      },
    })
    expect(calls).toBe(3)
    expect(result.bytes.byteLength).toBe(BODY.byteLength)
  })

  it('retries a network error and gives up after the budget', async () => {
    let calls = 0
    await expect(
      fetchModel(URL_, FIXTURE_BLOB, {
        sleep: nap,
        retries: 2,
        fetchImpl: () => {
          calls += 1
          return Promise.reject(new Error('ECONNRESET'))
        },
      }),
    ).rejects.toThrow(/ECONNRESET/)
    expect(calls).toBe(2)
  })
})

describe('backoffMs', () => {
  it('doubles and caps at four seconds', () => {
    expect([1, 2, 3, 4, 5, 6].map(backoffMs)).toEqual([250, 500, 1000, 2000, 4000, 4000])
  })
})

describe('mapLimit', () => {
  it('never exceeds the concurrency it is given', async () => {
    let live = 0
    let peak = 0
    const results = await mapLimit(
      Array.from({ length: 40 }, (_, index) => index),
      8,
      async (item) => {
        live += 1
        peak = Math.max(peak, live)
        await Promise.resolve()
        live -= 1
        return item * 2
      },
    )
    expect(peak).toBeLessThanOrEqual(8)
    expect(results[39]).toBe(78)
  })

  it('returns results in input order regardless of completion order', async () => {
    const results = await mapLimit([3, 1, 2], 3, async (item) => {
      await new Promise((resolve) => setTimeout(resolve, item))
      return item
    })
    expect(results).toEqual([3, 1, 2])
  })
})
