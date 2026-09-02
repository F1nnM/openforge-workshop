/**
 * The iOS and multi-gigabyte download fallback — plan §3 and §11's *"Fallback, a
 * Cloudflare Worker: the same library streaming R2 objects"*.
 *
 * ## Why this Worker exists at all
 *
 * The browser path is the primary one and it is better in every way it can be:
 * `client-zip` builds the archive in the tab, `showSaveFilePicker` lands it on
 * disk a chunk at a time, the size is exact to the byte before the first request
 * goes out, and no server pays for the egress. **iOS Safari has none of that.**
 * It has no `showSaveFilePicker`, so the archive has to be buffered into a
 * `Blob`, and it refuses a `Blob` download above 512 MB. A 1.6 GB room —
 * 50 placements at the corpus p95 — therefore has *no path at all* on an iPhone:
 * not a slow one, not a degraded one, none.
 *
 * This Worker is that path. The browser sends the bill it already computed, the
 * Worker streams the same archive from the bucket, and Safari sees a plain
 * download it hands to its own download manager. Nothing in the tab touches the
 * bytes, so nothing in the tab can run out of memory.
 *
 * ## Routing: why this is one Worker with the static assets, not a second origin
 *
 * `assets.run_worker_first` in `wrangler.jsonc` is scoped to {@link ZIP_PATH},
 * so every other request is served by Cloudflare's asset worker exactly as it is
 * today — free, unmetered, and with no billed CPU hop in front of it. That is
 * the arrangement the config comment asked for, and it is why this row could add
 * a Worker without changing what a page load costs.
 *
 * Being same-origin with the app also means the app's own requests need no CORS
 * at all. Blocker **B1** is about `objects.openforge.tools`, not about this
 * endpoint — and note that the Worker's own reads of the bucket are
 * server-to-server, so they are not subject to CORS either. The CORS headers
 * below are emitted **unconditionally, on every response including errors**, for
 * B1's stated reason: a cache rule that is turned on before unconditional CORS
 * caches responses without the headers, and the app then fails on cached 200s
 * that look perfectly fine in `curl`. `cache-control: no-store` keeps these
 * responses out of that cache regardless — an archive is per-request and must
 * never be served to a second person.
 *
 * ## Deployment is blocked; authorship is not
 *
 * B1 gates the deploy, and row **X6** does it. Nothing here has been deployed,
 * and `wrangler.jsonc`'s `run_worker_first` scoping is written so that the
 * deploy is a no-op for every existing route.
 */
import { buildArchivePlan } from './archive'
import { BucketFetchError, SubrequestBudgetError, bucketModelSource, crossedLogBoundary, subrequestBudget } from './bucket'
import { MAX_ARCHIVE_BYTES, MAX_ARCHIVE_FILES } from './limits'
import { ZipRequestError, readArchiveRequest } from './request'
import { openArchiveStream } from './stream'
import { DEFAULT_MODELS_BASE, ModelUrlError } from './url'

/** The one path this Worker serves. Kept in step with `wrangler.jsonc`. */
export const ZIP_PATH = '/zip'

export interface Env {
  /**
   * The models bucket base, bound in `wrangler.jsonc`.
   *
   * A binding rather than wire input, and `url.ts` explains why at length: a
   * Worker that fetches a caller-supplied URL is an open proxy, and a download
   * path that accepts a URL is a download path that can be pointed at a
   * decimated preview.
   */
  MODELS_BASE?: string
}

/**
 * CORS, unconditional.
 *
 * `*` with no credentials and no `Access-Control-Allow-Credentials`: the
 * endpoint reads nothing about the caller, and a room a caller can describe is a
 * room they could have built by hand. `Content-Length` is exposed because it is
 * how a caller drives a progress readout.
 */
const CORS_HEADERS: Readonly<Record<string, string>> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-expose-headers': 'content-length, content-disposition',
  'access-control-max-age': '86400',
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (pathname !== ZIP_PATH) return problem(404, 'not_found', `nothing is served at ${pathname}`)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...CORS_HEADERS, 'cache-control': 'no-store' } })
    }
    if (request.method !== 'POST') {
      return problem(
        405,
        'method_not_allowed',
        `${request.method} is not allowed here. POST a build (JSON, or a form field named "build" so a navigation can carry it — which is how iOS Safari reaches this endpoint).`,
        { allow: 'POST, OPTIONS' },
      )
    }

    return await serveArchive(request, env)
  },
} satisfies ExportedHandler<Env>

/**
 * Parse, plan, open the first body, then answer.
 *
 * The order is the point. Everything that can fail with a status code fails
 * *before* the `Response` is constructed — including the first bucket read, so a
 * 403 from `objects.openforge.tools` is an HTTP 502 with a message rather than a
 * download that dies after two entries.
 */
async function serveArchive(request: Request, env: Env): Promise<Response> {
  let archive
  try {
    archive = await readArchiveRequest(request)
  } catch (error) {
    if (error instanceof ZipRequestError) return problem(error.status, error.code, error.message)
    throw error
  }

  const modelsBase = env.MODELS_BASE ?? DEFAULT_MODELS_BASE

  let plan
  try {
    plan = buildArchivePlan(archive, modelsBase)
  } catch (error) {
    if (error instanceof ModelUrlError) {
      // The bucket base is a binding, so this is a misconfigured Worker rather
      // than a bad request, and 500 is the honest status.
      return problem(500, 'misconfigured_bucket', error.message)
    }
    throw error
  }

  const budget = subrequestBudget(MAX_ARCHIVE_FILES)
  const stream = openArchiveStream(plan, {
    source: bucketModelSource({ budget }),
    signal: request.signal,
    onProgress: logProgress(plan.filename),
  })

  try {
    await stream.prime()
  } catch (error) {
    stream.dispose()
    return upstreamProblem(error)
  }

  console.log(
    `zip ${plan.filename}: ${String(plan.models.length)} files, ${String(plan.modelBytes)} model bytes, ${String(plan.predictedLength)} archive bytes${plan.zip64 ? ', zip64' : ''}`,
  )

  return new Response(stream.body(), {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'content-type': 'application/zip',
      // Exact, because nothing is compressed. This is what turns a short body
      // into a failed download instead of a shorter file — see `stream.ts`.
      'content-length': String(plan.predictedLength),
      'content-disposition': `attachment; filename="${plan.filename}"`,
      // An archive is built for one request and must never be served to a second
      // person. It also has to stay out of the cache rule B1 will add.
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}

/** Map a failure from the first bucket read onto a status a caller can act on. */
function upstreamProblem(error: unknown): Response {
  if (error instanceof BucketFetchError) {
    return problem(502, 'bucket_unavailable', error.message, error.status === undefined ? {} : { 'x-upstream-status': String(error.status) })
  }
  if (error instanceof ModelUrlError) return problem(502, 'bucket_served_wrong_thing', error.message)
  if (error instanceof SubrequestBudgetError) return problem(500, 'subrequest_budget', error.message)
  if (error instanceof Error) return problem(502, 'bucket_unavailable', error.message)
  throw error
}

/**
 * An error, as JSON, with the CORS headers every response carries.
 *
 * `code` is machine-readable so the client can tell the one case that is not a
 * retry — 413, "too big for a Worker" — from the ones that are, and offer §11's
 * URL list instead of a spinner.
 */
function problem(status: number, code: string, message: string, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: { code, message } }) + '\n', {
    status,
    headers: {
      ...CORS_HEADERS,
      ...extra,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

/**
 * Progress logging, throttled to one line per 64 MB.
 *
 * ~26 lines for a 1.6 GB archive. Untruncated per-chunk logging would be tens of
 * thousands of lines and would cost more CPU than the CRC-32.
 */
function logProgress(filename: string): (progress: { bytesWritten: number; predictedLength: number; entriesStarted: number; entries: number }) => void {
  let logged = 0
  return (progress) => {
    if (!crossedLogBoundary(logged, progress.bytesWritten)) return
    logged = progress.bytesWritten
    console.log(
      `zip ${filename}: ${String(progress.bytesWritten)}/${String(progress.predictedLength)} bytes, entry ${String(progress.entriesStarted)}/${String(progress.entries)}`,
    )
  }
}

/** Re-exported so a caller building the request has the limits without a second source. */
export { MAX_ARCHIVE_BYTES, MAX_ARCHIVE_FILES }
