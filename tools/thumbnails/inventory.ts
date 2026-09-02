/**
 * Asking the bucket which thumbnails exist, one HEAD at a time.
 *
 * ## Why a probe rather than the upload manifest
 *
 * `manifest.ts` writes an inventory of *intent*: every object this tool staged
 * on the machine it ran on, with its sha256, for a human holding credentials to
 * sync. Deriving `CatalogRecord.thumb` from that would flip 56 records to `true`
 * after a `--sample` run that uploaded nothing — 56 cards pointing at 404s, and
 * `TileThumb`'s fallback is the only thing that would have saved them. This
 * module answers the other question, which is the one the index needs: what is
 * *in the bucket*, right now.
 *
 * ## Why HEAD, and why not a bucket listing
 *
 * A listing is nine paginated calls instead of 8,352 requests, and it would be
 * the obvious tool — but `ListObjectsV2` needs R2 credentials, and read
 * credentials are as absent as the write ones (`v1-pr-series.md`, non-PR
 * blockers). The public hostname does not list. So the only credential-free
 * channel is to ask about each key, and HEAD is how you ask without paying for
 * the body: measured against the live bucket, **17.3 requests/s at concurrency
 * 6**, so all 8,352 take about eight minutes. That is a once-per-backfill cost.
 *
 * A 200 means present, a 404 means absent, and **anything else means the probe
 * failed** — recorded separately and never folded into "absent", because
 * `thumb: false` on a record whose object exists is a permanent regression in
 * the grid, and a 503 is not evidence of absence. {@link probeThumbs} reports
 * failures and `pipeline/thumbs.ts` refuses to read an inventory that has any.
 *
 * ## Politeness
 *
 * The same rules as `fetch.ts`, and for the same reason — this is somebody
 * else's production bucket behind Cloudflare, which answers a default agent with
 * a 403. So: the tool's own {@link USER_AGENT}, a small fixed concurrency, a
 * floor on request starts per worker, and bounded retries on 429/5xx only. A 404
 * is never retried; it is the answer.
 */
import type { BlobId, CatalogFile } from '../../src/catalog'
import { MEASURED_THUMB } from '../../src/catalog'
import type { ThumbInventory } from '../../pipeline'
import { THUMB_INVENTORY_VERSION } from '../../pipeline'

import { thumbUrl } from './catalog'
import { DEFAULT_TIMEOUT_MS, USER_AGENT, backoffMs, mapLimit } from './fetch'

/**
 * Requests in flight. Six rather than `fetch.ts`'s two: a HEAD transfers no
 * body, so the constraint is the edge's request rate rather than egress, and at
 * two the probe takes 25 minutes.
 */
export const DEFAULT_PROBE_CONCURRENCY = 6

/** Minimum milliseconds between request starts, per worker. */
export const DEFAULT_PROBE_INTERVAL_MS = 25

/** Attempts per object, including the first. Only 429/5xx and network errors retry. */
export const DEFAULT_PROBE_RETRIES = 3

/** What one URL answered. */
export type ProbeOutcome =
  | { kind: 'present'; blob: BlobId }
  | { kind: 'absent'; blob: BlobId }
  | { kind: 'failed'; blob: BlobId; url: string; reason: string }

export interface ProbeEvent {
  index: number
  total: number
  blob: BlobId
  outcome: ProbeOutcome['kind']
}

export interface ProbeOptions {
  catalog: CatalogFile
  /** Distinct md5s to ask about, in any order. */
  blobs: readonly BlobId[]
  concurrency?: number
  minIntervalMs?: number
  retries?: number
  timeoutMs?: number
  /** Injected in tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch
  /** Injected in tests so backoff does not cost real seconds. */
  sleep?: (ms: number) => Promise<void>
  onProgress?: (event: ProbeEvent) => void
  /** Overridable so an inventory can be byte-reproducible in a test. */
  probedAt?: string
}

export interface ProbeReport {
  inventory: ThumbInventory
  failures: { blob: BlobId; url: string; reason: string }[]
  elapsedMs: number
}

/**
 * The extension the objects carry. Taken from {@link thumbUrl} rather than
 * spelled again, so a change to the derivative's format cannot leave the probe
 * asking about the old one.
 */
export const THUMB_EXTENSION = MEASURED_THUMB.extension

/**
 * HEAD every candidate URL and return the inventory the pipeline reads.
 *
 * The inventory is returned even when there are failures — the caller decides
 * whether to write it, and `tools/thumbnails/cli.ts` does not — so that a
 * partially-failed probe can still be *reported* in full rather than collapsing
 * to an exception with no counts in it.
 */
export async function probeThumbs(options: ProbeOptions): Promise<ProbeReport> {
  const startedAt = Date.now()
  const blobs = [...options.blobs].sort()
  const total = blobs.length

  const outcomes = await mapLimit(
    blobs,
    options.concurrency ?? DEFAULT_PROBE_CONCURRENCY,
    async (blob, index) => {
      const outcome = await probeOne(blob, options)
      options.onProgress?.({ index, total, blob, outcome: outcome.kind })
      return outcome
    },
    {
      minIntervalMs: options.minIntervalMs ?? DEFAULT_PROBE_INTERVAL_MS,
      ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
    },
  )

  const present: string[] = []
  const failures: { blob: BlobId; url: string; reason: string }[] = []
  let absent = 0
  for (const outcome of outcomes) {
    if (outcome.kind === 'present') present.push(outcome.blob)
    else if (outcome.kind === 'absent') absent += 1
    else failures.push({ blob: outcome.blob, url: outcome.url, reason: outcome.reason })
  }

  return {
    inventory: {
      note:
        'Row P3. Which blobs have a /thumbs/ object, measured by HEAD against the public hostname. ' +
        'Re-probe with `npm run thumbs -- --inventory`, then rebuild the index with ' +
        '`npm run import:catalog`. See pipeline/thumbs.ts.',
      version: THUMB_INVENTORY_VERSION,
      probed: options.probedAt ?? new Date().toISOString(),
      base: options.catalog.assets.thumbs,
      extension: THUMB_EXTENSION,
      counted: { probed: total, present: present.length, absent, failed: failures.length },
      present: present.sort(),
    },
    failures,
    elapsedMs: Date.now() - startedAt,
  }
}

async function probeOne(blob: BlobId, options: ProbeOptions): Promise<ProbeOutcome> {
  const url = thumbUrl(options.catalog, blob)
  const attempts = options.retries ?? DEFAULT_PROBE_RETRIES
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const impl = options.fetchImpl ?? fetch
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  let reason = 'no attempt was made'
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await impl(url, {
        method: 'HEAD',
        headers: { 'user-agent': USER_AGENT, accept: 'image/webp,image/*' },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'follow',
      })
      if (response.status === 200) return { kind: 'present', blob }
      // 404 is the answer, not a transient failure. It is what every one of the
      // 8,352 objects says until the backfill runs.
      if (response.status === 404) return { kind: 'absent', blob }
      reason =
        response.status === 403
          ? '403 — Cloudflare is refusing this client (error 1010 if the User-Agent is rejected)'
          : `HTTP ${String(response.status)} ${response.statusText}`
      if (response.status !== 429 && response.status < 500) break
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error)
    }
    if (attempt < attempts) await sleep(backoffMs(attempt))
  }
  return { kind: 'failed', blob, url, reason }
}

/**
 * Every distinct md5 worth asking about: the ones the index says have a sprite
 * sheet, because the derivative is cropped from one.
 *
 * The spriteless tile is excluded rather than probed. It has no sheet, so no
 * thumbnail can exist for it, and a 404 there would be indistinguishable from
 * the 8,351 that mean "not backfilled yet".
 */
export function thumbCandidates(file: CatalogFile): BlobId[] {
  const blobs = new Set<BlobId>()
  for (const record of file.records) {
    if (record.sprite) blobs.add(record.blob)
  }
  return [...blobs].sort()
}
