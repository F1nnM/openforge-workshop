/**
 * The HTTP surface: the headers a download depends on, and the statuses a
 * caller has to be able to act on.
 *
 * Two of these are load-bearing rather than cosmetic:
 *
 *   - **`Content-Length` is the exact predicted length.** It is what makes a
 *     browser's download manager report a failed download rather than saving a
 *     short file, and it is only possible because nothing is compressed.
 *   - **The CORS headers are on every response, including errors.** Blocker B1
 *     is ordered CORS-first for a reason: a cache rule turned on before
 *     unconditional CORS caches responses without the headers, and the app then
 *     fails on cached 200s that look perfectly fine in `curl`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildArchivePlan } from './archive'
import worker, { ZIP_PATH } from './index'
import { MAX_ARCHIVE_FILES } from './limits'
import { validateArchiveRequest } from './request'
import type { FakeObject } from './testing/fixtures'
import { MODELS_BASE, collect, fakeFetch, modelBytes, requestBody, requestFile } from './testing/fixtures'
import { readZip } from './testing/readZip'

const env = { MODELS_BASE }

const FILES = [requestFile(0, { name: 'models/cave/wall-0.stl', bytes: 4_096 }), requestFile(1, { name: 'models/cave/wall-1.stl', bytes: 8_192 })]

function stubBucket(overrides: (index: number) => Partial<FakeObject> = () => ({})): ReturnType<typeof fakeFetch> {
  const built = buildArchivePlan(validateArchiveRequest(requestBody(FILES)), MODELS_BASE)
  const objects = new Map<string, FakeObject>()
  built.models.forEach((model, index) => {
    objects.set(model.url, { bytes: modelBytes(index, model.bytes), chunks: 3, ...overrides(index) })
  })
  const fetcher = fakeFetch(objects)
  vi.stubGlobal('fetch', fetcher.impl)
  return fetcher
}

function post(body: unknown, init: RequestInit = {}): Request {
  return new Request(`https://workshop.openforge.tools${ZIP_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...init,
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a successful download', () => {
  it('streams a zip with the headers a download manager needs', async () => {
    stubBucket()
    const response = await worker.fetch(post(requestBody(FILES)), env)

    const built = buildArchivePlan(validateArchiveRequest(requestBody(FILES)), MODELS_BASE)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/zip')
    expect(response.headers.get('content-length')).toBe(String(built.predictedLength))
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="openforge-room-2026-09-02.zip"')
    // An archive is built for one request. It must never be served to a second
    // person, and it must stay out of the cache rule B1 will add.
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('access-control-expose-headers')).toContain('content-length')

    const bytes = await collect(response.body as ReadableStream<Uint8Array>)
    expect(bytes.byteLength).toBe(built.predictedLength)
    expect(readZip(bytes).entries.map((entry) => entry.name)).toEqual([
      'LICENSE.txt',
      'ATTRIBUTION.csv',
      'models/cave/wall-0.stl',
      'models/cave/wall-1.stl',
    ])
  })

  it('accepts a form navigation, which is the only shape iOS Safari can use', async () => {
    stubBucket()
    const request = new Request(`https://workshop.openforge.tools${ZIP_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ build: JSON.stringify(requestBody(FILES)) }).toString(),
    })
    const response = await worker.fetch(request, env)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toContain('attachment')
  })

  it('falls back to the default bucket when no binding is set', async () => {
    stubBucket()
    const response = await worker.fetch(post(requestBody(FILES)), {})
    expect(response.status).toBe(200)
    await response.body?.cancel()
  })
})

describe('failures a caller has to be able to act on', () => {
  it('answers a bucket 403 with a 502 and the reason, not a broken download', async () => {
    const fetcher = stubBucket((index) => (index === 0 ? { status: 403 } : {}))
    const response = await worker.fetch(post(requestBody(FILES)), env)

    expect(response.status).toBe(502)
    const body = await response.json<{ error: { code: string; message: string } }>()
    expect(body.error.code).toBe('bucket_unavailable')
    expect(body.error.message).toContain('1010')
    expect(response.headers.get('x-upstream-status')).toBe('403')
    // Refused after one attempt, before any archive bytes were promised.
    expect(fetcher.requested).toHaveLength(1)
  })

  it('answers too-large with 413 and the URL-list offer, which is not a retry', async () => {
    stubBucket()
    const files = Array.from({ length: MAX_ARCHIVE_FILES + 1 }, (_unused, index) =>
      requestFile(index, { name: `models/wall-${String(index)}.stl` }),
    )
    const response = await worker.fetch(post(requestBody(files)), env)

    expect(response.status).toBe(413)
    const body = await response.json<{ error: { code: string; message: string } }>()
    expect(body.error.code).toBe('too_many_files')
    expect(body.error.message).toContain('URL list')
  })

  it('answers a duplicate md5 with 400 rather than downloading it twice', async () => {
    stubBucket()
    const response = await worker.fetch(post(requestBody([requestFile(0), requestFile(0, { name: 'models/other.stl' })])), env)
    expect(response.status).toBe(400)
    expect((await response.json<{ error: { code: string } }>()).error.code).toBe('duplicate_blob')
  })

  it('answers a misconfigured bucket binding with 500, because that is not the caller fault', async () => {
    stubBucket()
    const response = await worker.fetch(post(requestBody(FILES)), { MODELS_BASE: 'https://objects.openforge.tools/thumbs' })
    expect(response.status).toBe(500)
    expect((await response.json<{ error: { code: string } }>()).error.code).toBe('misconfigured_bucket')
  })

  it('carries the CORS headers on an error too, which is what B1 is ordered for', async () => {
    stubBucket()
    const response = await worker.fetch(post({ v: 99 }), env)
    expect(response.status).toBe(400)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})

describe('routing', () => {
  it('answers a preflight without touching the bucket', async () => {
    const fetcher = stubBucket()
    const response = await worker.fetch(new Request(`https://workshop.openforge.tools${ZIP_PATH}`, { method: 'OPTIONS' }), env)
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-methods')).toContain('POST')
    expect(fetcher.requested).toEqual([])
  })

  it('refuses GET, and says how iOS reaches the endpoint', async () => {
    stubBucket()
    const response = await worker.fetch(new Request(`https://workshop.openforge.tools${ZIP_PATH}`), env)
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST, OPTIONS')
    expect((await response.json<{ error: { message: string } }>()).error.message).toContain('build')
  })

  it('serves nothing but its own path, so run_worker_first can be scoped to it', async () => {
    stubBucket()
    const response = await worker.fetch(new Request('https://workshop.openforge.tools/index.html'), env)
    expect(response.status).toBe(404)
  })
})
