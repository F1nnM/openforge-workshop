/**
 * Getting a source mesh, politely, and proving it is the right one.
 *
 * ## The User-Agent is not optional
 *
 * `objects.openforge.tools` sits behind Cloudflare and returns **HTTP 403 with
 * Cloudflare error 1010** to a default client agent. An absent or generic agent
 * is also the fastest way for a build tool to get an IP blocked from somebody
 * else's production bucket. So every request carries a self-identifying agent
 * naming *this* tool and the repository, and a run that starts getting 403s says
 * so in the failure reason rather than reporting a missing mesh.
 *
 * (`tools/thumbnails/fetch.ts` carries the same rule and its own agent string.
 * The two are deliberately different strings — the point of the header is to say
 * which tool is knocking — but the retry/backoff/concurrency shape below is
 * copied from it on purpose. See the seam note in `run.ts`.)
 *
 * ## Content verification: the md5, not the ETag
 *
 * The blocker table says "**ETag equals the md5**, verified live". That is true
 * for objects uploaded in one part and **false for the large ones**, which are
 * exactly the ones this tool exists for. Measured against the live bucket:
 *
 * | object | bytes | ETag |
 * | --- | --- | --- |
 * | `8180da93…` | 5,984 | `"8180da93549154744c37f8370a82738f"` |
 * | `5234f9d5…` | 10,364,884 | `"ec7c20ffdac62e5c81719e6d4f70955a-2"` |
 * | `2d32f890…` | 108,912,184 | `"7d025d6a2cc7844f8db768a3a44b5665-13"` |
 *
 * The `-N` suffix is S3's multipart form: a hash *of the part hashes*, with N
 * parts. It cannot be compared to the object's md5 by construction. So this tool
 * **always hashes the body** and compares that to the blob it asked for, and
 * treats the ETag as a cheap corroborating check only when it is single-part.
 * Hashing 108 MB costs about 0.2 s against a 12 s download, and it is the only
 * check that cannot be fooled — decimating the wrong mesh would produce a
 * plausible GLB filed under the right key, which is the worst available failure.
 *
 * This is worth carrying back to blocker **B5**: exposing `ETag` to the browser
 * lets the *app* verify a single-part object and no more. A recipe check on a
 * large mesh needs the body hashed, or needs the uploader to stop using
 * multipart.
 *
 * ## Politeness
 *
 * Concurrency **8** (the stated cap), a minimum interval between request starts
 * per worker, and bounded retries with exponential backoff on 429/5xx and on
 * network errors. A 404 is **not** retried: the index said the mesh exists, so a
 * 404 is a real finding. A 403 is not retried either — it is a policy answer,
 * and hammering it is how a build tool gets an IP banned.
 *
 * Measured single-stream throughput on this bucket, one object per row, cold
 * (`cf-cache-status: DYNAMIC`): **3.4 MB/s at 3.6 MB, 8.7 MB/s at 10.4 MB,
 * 9.3 MB/s at 26.4 MB, 11.4 MB/s at 108.9 MB** — the small-object figures are
 * dominated by connection setup. That is well above the 1.2 MB/s the plan
 * recorded, so the timeout below is generous rather than tight.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Identifies this tool to the bucket's edge. Never send a request without it. */
export const USER_AGENT =
  'openforge-workshop-lod/1.0 (+https://github.com/MasterworkTools/openforge-workshop; build-time LOD derivation)'

/**
 * Requests in flight at once.
 *
 * 8 is the cap, not a starting point: this is someone else's production bucket
 * and no cache rule exists on it yet (blocker B1), so every byte of a full pass
 * is an origin read.
 */
export const DEFAULT_CONCURRENCY = 8

/** Minimum milliseconds between request starts, per worker. */
export const DEFAULT_MIN_INTERVAL_MS = 50

/**
 * Per-request timeout.
 *
 * The largest object in the corpus is 108.9 MB and arrived in 9.6 s. Three
 * minutes covers that at an eighth of the measured rate, which is the margin a
 * congested link needs before a timeout is more likely to be spurious than real.
 */
export const DEFAULT_TIMEOUT_MS = 180_000

/** Attempts per object, including the first. */
export const DEFAULT_RETRIES = 3

export interface FetchOptions {
  /** On-disk cache. Off unless given — a full pass is 108.0 GB. */
  cacheDir?: string
  timeoutMs?: number
  retries?: number
  minIntervalMs?: number
  /** Injected in tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch
  /** Injected in tests so backoff does not cost real seconds. */
  sleep?: (ms: number) => Promise<void>
}

export interface ModelBytes {
  bytes: Buffer
  fromCache: boolean
  /** The response ETag, when the bytes came from the bucket. */
  etag?: string
  /** `true` when the ETag was single-part and therefore comparable to the md5. */
  etagVerified: boolean
}

/** A mesh this tool is expected to be able to fetch, that it could not. */
export class ModelFetchError extends Error {
  override readonly name = 'ModelFetchError'
  readonly url: string
  readonly status?: number
  constructor(url: string, message: string, status?: number) {
    super(message)
    this.url = url
    if (status !== undefined) this.status = status
  }
}

/**
 * The bytes that arrived are not the mesh that was asked for.
 *
 * Never retried and never decimated: a mismatch is a wrong object or a corrupt
 * transfer, and both would produce a valid-looking GLB of the wrong tile.
 */
export class BlobMismatchError extends Error {
  override readonly name = 'BlobMismatchError'
  readonly url: string
  readonly expected: string
  readonly actual: string
  readonly etag?: string
  constructor(url: string, expected: string, actual: string, etag?: string) {
    super(
      `${url}: asked for md5 ${expected}, body hashes to ${actual}` +
        (etag === undefined ? '' : ` (ETag ${etag})`),
    )
    this.url = url
    this.expected = expected
    this.actual = actual
    if (etag !== undefined) this.etag = etag
  }
}

/** Where a mesh is cached: `{cacheDir}/{md5[0:6]}/{md5}.stl`. */
export function cachePath(cacheDir: string, blob: string): string {
  return join(cacheDir, blob.slice(0, 6), `${blob}.stl`)
}

/**
 * An ETag's md5, when it is one.
 *
 * `"<hex32>"` is a single-part upload and the hex *is* the object's md5.
 * `"<hex32>-13"` is a multipart ETag — a hash of part hashes — and there is no
 * md5 in it at all, so this returns `null` rather than something to compare.
 */
export function etagMd5(etag: string | null | undefined): string | null {
  if (etag === undefined || etag === null) return null
  const bare = etag.trim().replace(/^W\//, '').replace(/^"|"$/g, '')
  return /^[0-9a-f]{32}$/i.test(bare) ? bare.toLowerCase() : null
}

/** md5 of a buffer, hex — the content address the whole store is keyed on. */
export function md5Hex(bytes: Uint8Array): string {
  return createHash('md5').update(bytes).digest('hex')
}

/**
 * The mesh's bytes, from the cache when present and from the bucket otherwise,
 * verified against `blob` either way.
 *
 * A cached file is re-hashed too. The cache is content-addressed, so a cached
 * file that hashes wrong means the cache is corrupt, and finding that out here
 * is much cheaper than finding it out as a wrong-looking tile in the builder.
 *
 * @throws {ModelFetchError} when every attempt fails, carrying the last status.
 * @throws {BlobMismatchError} when the bytes are not the mesh that was asked for.
 */
export async function fetchModel(
  url: string,
  blob: string,
  options: FetchOptions = {},
): Promise<ModelBytes> {
  const cacheDir = options.cacheDir
  if (cacheDir !== undefined) {
    const path = cachePath(cacheDir, blob)
    if (existsSync(path)) {
      const bytes = readFileSync(path)
      const actual = md5Hex(bytes)
      if (actual !== blob) throw new BlobMismatchError(path, blob, actual)
      return { bytes, fromCache: true, etagVerified: false }
    }
  }

  const fetched = await fetchWithRetry(url, options)
  const etagClaim = etagMd5(fetched.etag)
  const actual = md5Hex(fetched.bytes)
  if (actual !== blob || (etagClaim !== null && etagClaim !== blob)) {
    throw new BlobMismatchError(url, blob, actual, fetched.etag ?? undefined)
  }

  if (cacheDir !== undefined) {
    const path = cachePath(cacheDir, blob)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, fetched.bytes)
  }
  return {
    bytes: fetched.bytes,
    fromCache: false,
    ...(fetched.etag === null ? {} : { etag: fetched.etag }),
    etagVerified: etagClaim !== null,
  }
}

interface Fetched {
  bytes: Buffer
  etag: string | null
}

async function fetchWithRetry(url: string, options: FetchOptions): Promise<Fetched> {
  const attempts = options.retries ?? DEFAULT_RETRIES
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const impl = options.fetchImpl ?? fetch
  const sleep = options.sleep ?? defaultSleep

  let last: ModelFetchError | undefined
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await impl(url, {
        headers: { 'user-agent': USER_AGENT, accept: 'model/stl,application/octet-stream,*/*' },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'follow',
      })
      if (response.ok) {
        return { bytes: Buffer.from(await response.arrayBuffer()), etag: response.headers.get('etag') }
      }

      const message =
        response.status === 403
          ? '403 — Cloudflare is refusing this client (error 1010 if the User-Agent is rejected)'
          : `HTTP ${String(response.status)} ${response.statusText}`
      last = new ModelFetchError(url, message, response.status)
      if (!retryable(response.status)) break
    } catch (error) {
      last = new ModelFetchError(url, error instanceof Error ? error.message : String(error))
    }
    if (attempt < attempts) await sleep(backoffMs(attempt))
  }
  throw last ?? new ModelFetchError(url, 'no attempt was made')
}

/** 429 and 5xx are transient. A 404 or a 403 is a finding, and retrying it is rude. */
function retryable(status: number): boolean {
  return status === 429 || status >= 500
}

/** 250 ms, 500 ms, 1 s, … capped at 4 s. */
export function backoffMs(attempt: number): number {
  return Math.min(250 * 2 ** (attempt - 1), 4000)
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Run `worker` over `items` with bounded concurrency and a floor on how often a
 * worker may start a request. Results come back in input order.
 *
 * Written out rather than pulled from `p-limit`: it is fifteen lines, and this
 * tool's whole point is that it adds no runtime weight to the app.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  options: { minIntervalMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<R[]> {
  const results = new Array<R>(items.length)
  const minInterval = options.minIntervalMs ?? 0
  const sleep = options.sleep ?? defaultSleep
  let next = 0

  const run = async (): Promise<void> => {
    for (;;) {
      const index = next
      next += 1
      if (index >= items.length) return
      const item = items[index] as T
      const startedAt = Date.now()
      results[index] = await worker(item, index)
      const spent = Date.now() - startedAt
      if (minInterval > spent) await sleep(minInterval - spent)
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, run))
  return results
}
