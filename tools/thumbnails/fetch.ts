/**
 * Getting a sprite sheet, politely, and only once.
 *
 * ## The User-Agent is not optional
 *
 * `objects.openforge.tools` sits behind Cloudflare and returns **HTTP 403 with
 * Cloudflare error 1010** to a default `Python-urllib` agent. An absent or
 * generic agent is also the fastest way for a build tool to get an IP blocked
 * from somebody else's production bucket. So every request carries a
 * self-identifying agent naming the tool and the repository, and a run that
 * starts getting 403s says so in the failure reason rather than reporting a
 * missing sheet.
 *
 * ## Cache first
 *
 * Sheets are content-addressed by md5, so a cached sheet is *the* sheet — it can
 * never be stale for a given blob, and a new mesh is a new md5 under a new path.
 * That makes the cache safe without any validation, and it is what keeps a
 * second run of the tool from re-fetching gigabytes to produce output it already
 * has. The cache lives under `tools/thumbnails/.cache/sheets/` in the same
 * two-level sharded layout as the bucket.
 *
 * ## Politeness
 *
 * Small fixed concurrency (2 by default), a minimum interval between request
 * starts, and bounded retries with exponential backoff on 429/5xx and on
 * network errors. A 404 is **not** retried: the index said the sheet exists, so
 * a 404 is a real finding to report, not a transient one to hammer.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Identifies this tool to the bucket's edge. Never send a request without it. */
export const USER_AGENT =
  'openforge-workshop-thumbnails/1.0 (+https://github.com/MasterworkTools/openforge-workshop; build-time thumbnail derivation)'

/** Requests in flight at once. Deliberately small — this is someone else's bucket. */
export const DEFAULT_CONCURRENCY = 2

/** Minimum milliseconds between request starts, per worker. */
export const DEFAULT_MIN_INTERVAL_MS = 50

/** Per-request timeout. A sheet is under a megabyte; 30 s is already generous. */
export const DEFAULT_TIMEOUT_MS = 30_000

/** Attempts per object, including the first. */
export const DEFAULT_RETRIES = 3

export interface FetchOptions {
  cacheDir?: string
  timeoutMs?: number
  retries?: number
  minIntervalMs?: number
  /** Injected in tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch
  /** Injected in tests so backoff does not cost real seconds. */
  sleep?: (ms: number) => Promise<void>
}

export interface SheetBytes {
  bytes: Buffer
  fromCache: boolean
}

/** A sheet this tool is expected to be able to fetch, that it could not. */
export class SheetFetchError extends Error {
  readonly url: string
  readonly status?: number
  constructor(url: string, message: string, status?: number) {
    super(message)
    this.name = 'SheetFetchError'
    this.url = url
    if (status !== undefined) this.status = status
  }
}

/** Where a blob's sheet is cached: `{cacheDir}/{md5[0:6]}/{md5}.png`. */
export function cachePath(cacheDir: string, blob: string): string {
  return join(cacheDir, blob.slice(0, 6), `${blob}.png`)
}

/**
 * The sheet's bytes, from the cache when present and from the bucket otherwise.
 *
 * @throws {SheetFetchError} when every attempt fails, carrying the last status.
 */
export async function fetchSheet(
  url: string,
  blob: string,
  options: FetchOptions = {},
): Promise<SheetBytes> {
  const cacheDir = options.cacheDir
  if (cacheDir !== undefined) {
    const path = cachePath(cacheDir, blob)
    if (existsSync(path)) return { bytes: readFileSync(path), fromCache: true }
  }

  const bytes = await fetchWithRetry(url, options)
  if (cacheDir !== undefined) {
    const path = cachePath(cacheDir, blob)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, bytes)
  }
  return { bytes, fromCache: false }
}

async function fetchWithRetry(url: string, options: FetchOptions): Promise<Buffer> {
  const attempts = options.retries ?? DEFAULT_RETRIES
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const impl = options.fetchImpl ?? fetch
  const sleep = options.sleep ?? defaultSleep

  let last: SheetFetchError | undefined
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await impl(url, {
        headers: { 'user-agent': USER_AGENT, accept: 'image/png,image/*' },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'follow',
      })
      if (response.ok) return Buffer.from(await response.arrayBuffer())

      const message =
        response.status === 403
          ? `403 — Cloudflare is refusing this client (error 1010 if the User-Agent is rejected)`
          : `HTTP ${String(response.status)} ${response.statusText}`
      last = new SheetFetchError(url, message, response.status)
      if (!retryable(response.status)) break
    } catch (error) {
      last = new SheetFetchError(url, error instanceof Error ? error.message : String(error))
    }
    if (attempt < attempts) await sleep(backoffMs(attempt))
  }
  throw last ?? new SheetFetchError(url, 'no attempt was made')
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
