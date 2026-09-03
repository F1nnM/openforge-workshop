/**
 * Reading STLs out of somebody else's production bucket, and proving each one
 * is the file the index named.
 *
 * ## Reused, not reinvented
 *
 * `tools/thumbnails/fetch.ts` already solved the three things that are easy to
 * get wrong here — the User-Agent, bounded retry with backoff, and bounded
 * concurrency with results in input order — so {@link mapLimit} and
 * {@link backoffMs} are **imported** from it rather than copied. The
 * measure-specific parts are what is written here: an identifying agent naming
 * *this* tool, ETag verification, and byte ranges.
 *
 * ## The User-Agent is not optional
 *
 * `objects.openforge.tools` sits behind Cloudflare and returns **403 with
 * Cloudflare error 1010** to a default `Python-urllib` agent
 * (`openlock-tessellation.md` §6 hit this; `tools/thumbnails/fetch.ts` documents
 * it). Measured from this machine, a default `curl` agent is currently served —
 * but an absent or generic agent is the fastest way for a build tool to get an
 * IP blocked from a bucket it does not own, so every request identifies the tool
 * and the repository, and a run that starts collecting 403s says so in the
 * failure reason instead of reporting a missing mesh.
 *
 * ## The ETag is the md5 — for 42% of the corpus. Measured here, and it matters.
 *
 * `v2-pr-series.md` blocker **B5** rests on "**ETag equals the md5**, which is
 * how a fetched STL is verified to be the file a recipe named". Measured against
 * the live bucket, that is true only for objects at or under **8 MiB**:
 *
 * ```
 * b1c9d9…a31.stl    28,284 B  →  etag: "b1c9d9619c9e66fd7d9baf27faff8a31"
 * cbac8c…b64.stl 8,733,884 B  →  etag: "d94dd36030aa0e1d6b88628e95cc2aba-2"
 * 9ffd08…ed1.stl 72,507,984 B →  etag: "a4fd178fb9810a74c392204968a9fc1f-9"
 * ```
 *
 * The `-N` form is S3/R2's **multipart** ETag: the md5 of the concatenated
 * part md5s, then a dash and the part count. It is *not* the object's md5 and no
 * arithmetic recovers one from the other. The part size is 8 MiB, and **4,884 of
 * the corpus's 8,353 distinct blobs (58.5%) are above it** — so B5's premise
 * covers a minority of the corpus, and a browser-side integrity check built on
 * it would silently pass nothing for the large files.
 *
 * This tool therefore verifies **content**, not headers, whenever it has the
 * whole object: the md5 of the received bytes must equal the md5 the index
 * named. That is strictly stronger than the ETag check and independent of how
 * the object was uploaded. On a *range* read the content md5 is unavailable, so
 * the ETag is used when it is a plain md5 and the read is **refused** when it is
 * a multipart ETag — an unverifiable strided read of a 70 MB mesh is exactly the
 * measurement of the wrong mesh that four later rows would place a footprint
 * from. Every entry records which check ran.
 *
 * ## Nothing is cached
 *
 * Unlike the sprite sheets, these objects are 11.05 GB and each one is read once
 * to produce a few dozen bytes of derived numbers. Caching the meshes would cost
 * a thousand times what it saves; the *results* are cached instead, incrementally
 * (`sidecar.ts`), which is what makes an interrupted run resumable without
 * re-reading gigabytes.
 *
 * ## Politeness
 *
 * Concurrency is capped at {@link MAX_CONCURRENCY} = 8 and the cap is enforced
 * here, not left to the caller. Measured from this machine the link saturates
 * around 4–5.5 MB/s aggregate whatever the concurrency, so a higher number would
 * buy nothing and cost the bucket owner goodwill. `cf-cache-status: DYNAMIC` on
 * every response — no cache rule is configured yet (blocker **B1**) — so every
 * read is an R2 origin read and should happen once.
 */
import { createHash } from 'node:crypto'

import type { BlobId } from '../../src/catalog'
import { BINARY_FACET_BYTES, BINARY_HEADER_BYTES } from '../../src/three/stl/parse'
// Generic, dependency-free and already tested next door. Row X1 edits
// `tools/thumbnails/cli.ts`; nothing edits `fetch.ts`, so this import is stable.
import { backoffMs, mapLimit } from '../thumbnails/fetch'

export { backoffMs, mapLimit }

/** Identifies this tool to the bucket's edge. Never send a request without it. */
export const USER_AGENT =
  'openforge-workshop-measure/1.0 (+https://github.com/MasterworkTools/openforge-workshop; build-time geometry measurement)'

/**
 * Hard ceiling on requests in flight. **Do not raise it.**
 *
 * Eight is the number `v2-pr-series.md` row W1 sets, and measurement agrees it
 * is already past the useful point: one stream reached 5.47 MB/s and six
 * parallel streams reached 4.31 MB/s aggregate, so the constraint is this end of
 * the wire, not R2.
 */
export const MAX_CONCURRENCY = 8

/**
 * Default requests in flight.
 *
 * Below the cap on purpose: the largest mesh in the work list is 72.5 MB, which
 * parses to a 52 MB position array and is then projected and angle-sorted for the
 * sector fit, so a worker peaks around 200 MB. Four of those is a bounded
 * footprint, and throughput saturates before the cap anyway.
 */
export const DEFAULT_CONCURRENCY = 4

/** Minimum milliseconds between request starts, per worker. */
export const DEFAULT_MIN_INTERVAL_MS = 25

/**
 * Per-request timeout. The largest object in the work list is 72.5 MB and the
 * measured floor is ~1.2 MB/s, so ten minutes is the generous-but-finite figure.
 */
export const DEFAULT_TIMEOUT_MS = 600_000

/** Attempts per object, including the first. */
export const DEFAULT_RETRIES = 3

/** Why a read failed. The kinds are distinct because the response differs. */
export type StlFetchErrorKind = 'http' | 'network' | 'etag' | 'range'

/** An object this tool was told exists, that it could not read or could not trust. */
export class StlFetchError extends Error {
  override readonly name = 'StlFetchError'
  readonly kind: StlFetchErrorKind
  readonly url: string
  readonly status?: number

  constructor(kind: StlFetchErrorKind, url: string, message: string, status?: number) {
    super(message)
    this.kind = kind
    this.url = url
    if (status !== undefined) this.status = status
  }
}

export interface FetchOptions {
  timeoutMs?: number
  retries?: number
  /** Injected in tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch
  /** Injected in tests so backoff does not cost real seconds. */
  sleep?: (ms: number) => Promise<void>
}

/** One byte range, inclusive at both ends, as HTTP states them. */
export interface ByteRange {
  from: number
  /** Inclusive. */
  to: number
}

/** Which integrity check actually ran on a response. */
export type Verification = 'content-md5' | 'etag'

export interface ObjectBytes {
  bytes: Uint8Array
  /** The ETag, quotes and any weak prefix stripped. A plain md5, or `md5-parts`. */
  etag: string
  /** Whether the ETag is itself the object's md5 — false for a multipart upload. */
  etagIsMd5: boolean
  /** How the bytes were proved to be the file the index named. */
  verification: Verification
  /** Total object size, from `Content-Range` on a partial read and `Content-Length` otherwise. */
  totalBytes: number
  /** Bytes actually transferred. Below `totalBytes` for a range read. */
  readBytes: number
  /** Whether the response was a 206. */
  partial: boolean
}

/**
 * Read an object, or one range of it, verifying the ETag against `blob`.
 *
 * @throws {StlFetchError} on a non-2xx after retries, on a network failure, on
 *   an ETag that is not the md5 the index named, or on a range request the
 *   bucket answered with a 200 (which would silently return the whole object and
 *   make a "strided" measurement a full one).
 */
export async function fetchObject(
  url: string,
  blob: BlobId | string,
  range?: ByteRange,
  options: FetchOptions = {},
): Promise<ObjectBytes> {
  const attempts = options.retries ?? DEFAULT_RETRIES
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const impl = options.fetchImpl ?? fetch
  const sleep = options.sleep ?? defaultSleep

  let last: StlFetchError | undefined
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const headers: Record<string, string> = {
        'user-agent': USER_AGENT,
        accept: 'application/octet-stream,model/stl,*/*',
      }
      if (range !== undefined) headers.range = `bytes=${String(range.from)}-${String(range.to)}`

      const response = await impl(url, {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'follow',
      })

      if (!response.ok) {
        const message =
          response.status === 403
            ? '403 — Cloudflare is refusing this client (error 1010 if the User-Agent is rejected)'
            : `HTTP ${String(response.status)} ${response.statusText}`
        last = new StlFetchError('http', url, message, response.status)
        if (!retryable(response.status)) break
      } else {
        return readBody(url, blob, range, response)
      }
    } catch (error) {
      if (error instanceof StlFetchError) throw error
      last = new StlFetchError('network', url, error instanceof Error ? error.message : String(error))
    }
    if (attempt < attempts) await sleep(backoffMs(attempt))
  }
  throw last ?? new StlFetchError('network', url, 'no attempt was made')
}

/**
 * Body plus the two things that make it trustworthy: it hashes to the md5 the
 * index named, and a range request actually got a range.
 *
 * Neither check is retried. A content mismatch is not a hiccup — it means the
 * index and the bucket disagree about what lives at that key, and hammering it
 * would neither fix that nor discover anything new.
 */
async function readBody(
  url: string,
  blob: BlobId | string,
  range: ByteRange | undefined,
  response: Response,
): Promise<ObjectBytes> {
  const etag = normaliseEtag(response.headers.get('etag')) ?? ''
  const etagIsMd5 = /^[0-9a-f]{32}$/.test(etag)
  const partial = response.status === 206
  if (range !== undefined && !partial) {
    throw new StlFetchError(
      'range',
      url,
      `asked for bytes ${String(range.from)}-${String(range.to)} and got HTTP ${String(response.status)}; ` +
        'the bucket ignored the Range header, so this read is not the strided one it claims to be',
    )
  }

  const bytes = new Uint8Array(await response.arrayBuffer())
  const total = totalBytes(response, bytes.byteLength)
  const verification = verify(url, blob, bytes, etag, etagIsMd5, partial)
  return { bytes, etag, etagIsMd5, verification, totalBytes: total, readBytes: bytes.byteLength, partial }
}

/**
 * Prove the bytes are the file the index named, or throw.
 *
 * A whole-object read is hashed — definitive, and unaffected by multipart
 * ETags. A partial read cannot be hashed, so it falls back to the ETag and
 * refuses outright when the ETag is the multipart form, because an unverifiable
 * measurement is worse than a missing one.
 */
function verify(
  url: string,
  blob: BlobId | string,
  bytes: Uint8Array,
  etag: string,
  etagIsMd5: boolean,
  partial: boolean,
): Verification {
  if (!partial) {
    const digest = createHash('md5').update(bytes).digest('hex')
    if (digest !== blob) {
      throw new StlFetchError(
        'etag',
        url,
        `the bytes hash to ${digest}, not to the md5 the index named (${String(blob)}) — ` +
          'refusing to measure them',
      )
    }
    return 'content-md5'
  }

  if (etag === '') {
    throw new StlFetchError('etag', url, 'no ETag header on a partial read — the md5 cannot be verified')
  }
  if (!etagIsMd5) {
    throw new StlFetchError(
      'etag',
      url,
      `ETag ${etag} is a multipart ETag, not an md5, so a partial read of this object ` +
        'cannot be verified — read it whole instead',
    )
  }
  if (etag !== blob) {
    throw new StlFetchError(
      'etag',
      url,
      `ETag ${etag} is not the md5 the index named (${String(blob)}) — refusing to measure it`,
    )
  }
  return 'etag'
}

/** `"abc"` and `W/"abc"` both mean `abc`. R2 sends the bare quoted form. */
export function normaliseEtag(raw: string | null): string | undefined {
  if (raw === null) return undefined
  const trimmed = raw.trim().replace(/^W\//, '')
  const unquoted = trimmed.replace(/^"|"$/g, '')
  return unquoted === '' ? undefined : unquoted
}

/** `Content-Range: bytes 0-83/28284` → 28284; otherwise the body's own length. */
function totalBytes(response: Response, fallback: number): number {
  const header = response.headers.get('content-range')
  const match = header === null ? null : /\/\s*(\d+)\s*$/.exec(header)
  if (match?.[1] !== undefined) return Number(match[1])
  const length = response.headers.get('content-length')
  if (length !== null && /^\d+$/.test(length.trim())) return Number(length.trim())
  return fallback
}

/** 429 and 5xx are transient. A 404 or a 403 is a finding, and retrying it is rude. */
function retryable(status: number): boolean {
  return status === 429 || status >= 500
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/* ------------------------------------------------------------------- striding */

/**
 * The byte windows a facet stride needs, coalesced into as few ranges as HTTP
 * can express them.
 *
 * A binary STL is `84 + 50n` bytes exactly, so facet `i` occupies
 * `[84 + 50i, 84 + 50i + 49]`. Taking every `stride`-th facet therefore means
 * `ceil(n / stride)` windows of 50 bytes each — and one HTTP request per window
 * would be tens of thousands of requests for a large mesh, which costs *more* R2
 * Class B operations than a single whole-object GET and is far slower on
 * round-trips. So consecutive requested facets are coalesced whenever the gap
 * between them is under `coalesceBytes`: below that threshold, transferring the
 * skipped bytes is cheaper than paying another round trip for them.
 *
 * With the default 64 KiB threshold a stride only becomes a genuinely smaller
 * transfer once `50 × stride` exceeds it, i.e. `stride > 1310`. Below that a
 * "strided" read is a whole-object read wearing a Range header. That arithmetic
 * is a large part of why this tool reads in full — see `docs/` in the PR body.
 */
export function facetRanges(
  triangles: number,
  stride: number,
  coalesceBytes = 64 * 1024,
): ByteRange[] {
  if (stride < 1 || !Number.isInteger(stride)) throw new RangeError('stride must be a positive integer')
  if (triangles <= 0) return []

  const ranges: ByteRange[] = []
  let open: ByteRange | undefined
  for (let facet = 0; facet < triangles; facet += stride) {
    const from = BINARY_HEADER_BYTES + facet * BINARY_FACET_BYTES
    const to = from + BINARY_FACET_BYTES - 1
    if (open !== undefined && from - open.to - 1 <= coalesceBytes) {
      open.to = to
      continue
    }
    open = { from, to }
    ranges.push(open)
  }
  return ranges
}

/** Bytes a range list transfers. */
export function rangeBytes(ranges: readonly ByteRange[]): number {
  return ranges.reduce((total, range) => total + (range.to - range.from + 1), 0)
}
