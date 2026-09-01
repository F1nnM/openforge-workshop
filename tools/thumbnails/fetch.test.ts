/**
 * Politeness, the cache, and the User-Agent that is not optional.
 *
 * No test here touches the network: `fetchImpl` is injected. What is asserted is
 * everything that decides how this tool behaves against somebody else's
 * production bucket — that it identifies itself, that it does not retry a
 * finding, that it does retry a hiccup, and that a warm cache means no request
 * at all.
 */
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { SheetFetchError, USER_AGENT, backoffMs, cachePath, fetchSheet, mapLimit } from './fetch'

const BLOB = 'abcdef0123456789abcdef0123456789'
const URL_ = `https://objects.example.test/sprites/abcdef/${BLOB}.png`

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'openforge-thumbs-'))
}

const ok = (body: string): Response => new Response(body, { status: 200 })
const fail = (status: number): Response => new Response('', { status, statusText: 'nope' })

/** No real sleeping: backoff must not cost the suite seconds. */
const nap = (): Promise<void> => Promise.resolve()

describe('fetchSheet', () => {
  it('sends an identifying User-Agent', async () => {
    const seen: string[] = []
    await fetchSheet(URL_, BLOB, {
      sleep: nap,
      fetchImpl: (_url, init) => {
        seen.push(new Headers(init?.headers).get('user-agent') ?? '')
        return Promise.resolve(ok('sheet'))
      },
    })
    expect(seen).toEqual([USER_AGENT])
    expect(USER_AGENT).toMatch(/openforge-workshop-thumbnails/)
    expect(USER_AGENT).not.toMatch(/urllib|node-fetch|undici/i)
  })

  it('writes the sheet into the sharded cache and reads it back without a request', async () => {
    const cacheDir = tempDir()
    let calls = 0
    const impl: typeof fetch = () => {
      calls += 1
      return Promise.resolve(ok('sheet'))
    }

    const first = await fetchSheet(URL_, BLOB, { cacheDir, fetchImpl: impl, sleep: nap })
    expect(first.fromCache).toBe(false)
    expect(readFileSync(cachePath(cacheDir, BLOB), 'utf8')).toBe('sheet')

    const second = await fetchSheet(URL_, BLOB, { cacheDir, fetchImpl: impl, sleep: nap })
    expect(second.fromCache).toBe(true)
    expect(second.bytes.toString('utf8')).toBe('sheet')
    expect(calls).toBe(1)
  })

  it('prefers a cache hit even when the bucket would answer', async () => {
    const cacheDir = tempDir()
    const path = cachePath(cacheDir, BLOB)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, 'cached')
    const result = await fetchSheet(URL_, BLOB, {
      cacheDir,
      sleep: nap,
      fetchImpl: () => Promise.reject(new Error('should not be called')),
    })
    expect(result.bytes.toString('utf8')).toBe('cached')
  })

  it('does not retry a 404 — the index said it exists, so that is a finding', async () => {
    let calls = 0
    await expect(
      fetchSheet(URL_, BLOB, {
        sleep: nap,
        fetchImpl: () => {
          calls += 1
          return Promise.resolve(fail(404))
        },
      }),
    ).rejects.toThrow(/HTTP 404/)
    expect(calls).toBe(1)
  })

  it('names Cloudflare error 1010 on a 403, because that is what a bad agent looks like', async () => {
    await expect(
      fetchSheet(URL_, BLOB, { sleep: nap, fetchImpl: () => Promise.resolve(fail(403)) }),
    ).rejects.toThrow(/error 1010/)
  })

  it('retries a 503 and succeeds', async () => {
    let calls = 0
    const result = await fetchSheet(URL_, BLOB, {
      sleep: nap,
      fetchImpl: () => {
        calls += 1
        return Promise.resolve(calls < 3 ? fail(503) : ok('sheet'))
      },
    })
    expect(calls).toBe(3)
    expect(result.bytes.toString('utf8')).toBe('sheet')
  })

  it('gives up after the retry budget and reports the last status', async () => {
    const error = await fetchSheet(URL_, BLOB, {
      retries: 2,
      sleep: nap,
      fetchImpl: () => Promise.resolve(fail(429)),
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SheetFetchError)
    expect((error as SheetFetchError).status).toBe(429)
    expect((error as SheetFetchError).url).toBe(URL_)
  })

  it('retries a network error too', async () => {
    let calls = 0
    const result = await fetchSheet(URL_, BLOB, {
      sleep: nap,
      fetchImpl: () => {
        calls += 1
        return calls === 1 ? Promise.reject(new Error('ECONNRESET')) : Promise.resolve(ok('sheet'))
      },
    })
    expect(calls).toBe(2)
    expect(result.fromCache).toBe(false)
  })
})

describe('backoffMs', () => {
  it('doubles and then caps', () => {
    expect([1, 2, 3, 4, 5, 6].map(backoffMs)).toEqual([250, 500, 1000, 2000, 4000, 4000])
  })
})

describe('mapLimit', () => {
  it('returns results in input order regardless of completion order', async () => {
    const delays = [30, 1, 20, 2, 10]
    const results = await mapLimit(delays, 3, async (ms, index) => {
      await new Promise((resolve) => setTimeout(resolve, ms))
      return index
    })
    expect(results).toEqual([0, 1, 2, 3, 4])
  })

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0
    let peak = 0
    await mapLimit(Array.from({ length: 12 }, (_, i) => i), 2, async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await Promise.resolve()
      inFlight -= 1
    })
    expect(peak).toBeLessThanOrEqual(2)
  })

  it('spaces requests by the minimum interval', async () => {
    const naps: number[] = []
    await mapLimit(
      [1, 2, 3],
      1,
      () => Promise.resolve(0),
      {
        minIntervalMs: 40,
        sleep: (ms) => {
          naps.push(ms)
          return Promise.resolve()
        },
      },
    )
    expect(naps).toHaveLength(3)
    for (const ms of naps) expect(ms).toBeGreaterThan(0)
  })

  it('handles an empty list', async () => {
    expect(await mapLimit([], 4, () => Promise.resolve(1))).toEqual([])
  })
})
