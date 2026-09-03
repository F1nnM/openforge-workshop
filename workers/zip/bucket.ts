/**
 * Reading model bytes out of `objects.openforge.tools`, and the four ways that
 * read is refused rather than half-believed.
 *
 * ## The User-Agent is not optional
 *
 * `objects.openforge.tools` sits behind Cloudflare and returns **HTTP 403 with
 * Cloudflare error 1010** to a client that presents no agent or a generic one.
 * `tools/thumbnails/fetch.ts` learned this the hard way against the same bucket
 * and its docblock says so in as many words; a Worker fetching the same
 * hostname has exactly the same problem. So every request here carries a
 * self-identifying agent, and a 403 says *in the error message* that the agent
 * is the likely cause — because the alternative is a download that fails with
 * "403" and a person who has to rediscover this.
 *
 * ## Why the ETag is not checked
 *
 * The obvious integrity check is `ETag == md5`, and it does not work on this
 * bucket. Row W1 measured it: **4,884 of 8,353 blobs (58.5%) carry a multipart
 * ETag** — the objects are above R2's 8 MiB part size, so the header is a digest
 * of digests, and no arithmetic turns it back into an md5. Checking it would
 * pass for 41.5% of the corpus and fail for the rest, which is worse than not
 * checking: it would look like verification.
 *
 * What is checked instead is the **length of the body as counted from the body**
 * — see {@link lengthVerified}. That is content-derived, not header-derived, and
 * it is exactly the guarantee the browser path has, which matters: the two paths
 * must produce the same archive under the same conditions, and a Worker that
 * enforced more would sometimes refuse a build the browser had happily
 * delivered. The `content-length` header is consulted too, but only to fail
 * *early*, before a byte is transferred.
 *
 * ## Why there is no mid-body retry
 *
 * A ZIP entry is written as it is read. Once bytes of an entry are in the
 * output there is nothing to retry *into*: restarting the fetch would duplicate
 * data the writer has already framed. So a failed body fails the archive, and
 * the subrequest accounting is exactly one request per file — which is what
 * makes {@link SubrequestBudget} a countable thing rather than an estimate.
 */
import type { ArchiveModelEntry } from './archive'
import { LOG_INTERVAL_BYTES, MAX_ARCHIVE_FILES, SUBREQUEST_LIMIT, SUBREQUEST_RESERVE } from './limits'
import { ModelUrlError, isModelStlUrl } from './url'

/**
 * Identifies this Worker to the bucket's edge. Never send a request without it.
 *
 * Same form as `tools/thumbnails/fetch.ts`: the tool, its version, the
 * repository and what it is doing, so that whoever reads the bucket's logs can
 * tell what this traffic is and who to talk to about it.
 */
export const BUCKET_USER_AGENT =
  'openforge-workshop-zip/1.0 (+https://github.com/MasterworkTools/openforge-workshop; server-side archive streaming for iOS and multi-gigabyte rooms)'

/**
 * Content types a model response may legitimately carry.
 *
 * Mirrors the list `src/download/source.ts` keeps privately for the browser
 * path. R2 serves STLs as one of these; `image/*` means the bucket, not the
 * code, is wrong, and that must not reach somebody's printer.
 */
export const MODEL_CONTENT_TYPES: readonly string[] = [
  'application/octet-stream',
  'application/sla',
  'application/vnd.ms-pki.stl',
  'model/stl',
  'model/x.stl-binary',
  'model/x.stl-ascii',
  'text/plain',
]

/** A model could not be fetched. Carries enough to say which one and why. */
export class BucketFetchError extends Error {
  readonly md5: string
  readonly url: string
  readonly status: number | undefined

  constructor(md5: string, url: string, reason: string, status?: number, options?: ErrorOptions) {
    super(`could not fetch ${md5} from ${url}: ${reason}`, options)
    this.name = 'BucketFetchError'
    this.md5 = md5
    this.url = url
    this.status = status
  }
}

/**
 * A model body was not the length the catalog index recorded.
 *
 * **This is the error that stops a truncated archive from being downloaded.** A
 * streamed ZIP records each entry's real size in a trailing descriptor, so an
 * entry whose body was cut short behind an HTTP 200 produces an archive that
 * opens cleanly with a corrupt mesh inside it, and nobody finds out until the
 * print fails.
 *
 * A discrepancy in the *long* direction is an error too: the URL is
 * content-addressed, so bytes that disagree with the recorded size mean the
 * object under that md5 is not the object the index measured. That is an
 * integrity problem, not a rounding one.
 */
export class ModelLengthError extends Error {
  readonly md5: string
  readonly expected: number
  readonly actual: number

  constructor(md5: string, url: string, expected: number, actual: number) {
    const direction = actual < expected ? 'short' : 'long'
    super(
      `${md5} came out ${direction}: the catalog index records ${String(expected)} bytes, ${url} served ${String(actual)}. ` +
        'The archive has been failed rather than finished, because a streamed ZIP records its sizes at the end and a truncated one still opens.',
    )
    this.name = 'ModelLengthError'
    this.md5 = md5
    this.expected = expected
    this.actual = actual
  }
}

/** The invocation ran out of its subrequest allowance. */
export class SubrequestBudgetError extends Error {
  readonly spent: number
  readonly limit: number

  constructor(spent: number, limit: number) {
    super(
      `this invocation has spent its ${String(limit)} bucket requests (Cloudflare allows ${String(SUBREQUEST_LIMIT)} subrequests per invocation, ` +
        `of which ${String(SUBREQUEST_RESERVE)} are held back for redirects). Spent: ${String(spent)}.`,
    )
    this.name = 'SubrequestBudgetError'
    this.spent = spent
    this.limit = limit
  }
}

/**
 * The subrequest allowance, counted rather than assumed.
 *
 * `request.ts` already refuses an archive of more than {@link MAX_ARCHIVE_FILES}
 * files, so in a correct build this counter never trips — which is the point of
 * having it. It is the difference between "we believe one fetch per file" and
 * "one fetch per file, and if that stops being true the archive fails instead of
 * the platform cutting the response off mid-entry".
 */
export interface SubrequestBudget {
  spend(): void
  readonly spent: number
  readonly limit: number
}

export function subrequestBudget(limit: number = MAX_ARCHIVE_FILES): SubrequestBudget {
  let spent = 0
  return {
    spend() {
      if (spent >= limit) throw new SubrequestBudgetError(spent, limit)
      spent += 1
    },
    get spent() {
      return spent
    },
    get limit() {
      return limit
    },
  }
}

/**
 * Where model bytes come from.
 *
 * Takes an entry, not a URL: the URL on the entry was composed by
 * {@link modelStlUrl} from the Worker's own bucket base, never from wire input.
 * Injectable, and the reason no test in this package touches the network.
 */
export interface ModelSource {
  open(entry: ArchiveModelEntry, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>>
}

export interface BucketSourceOptions {
  /** Counted per fetch. Shared across one invocation. */
  budget: SubrequestBudget
  /** Injected in tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch
}

/**
 * The real source: the bucket over `fetch`, with the guards.
 *
 * The returned stream is already length-verified, so a caller cannot forget to
 * check — the check is a property of the body it was handed, not a step it has
 * to remember.
 */
export function bucketModelSource(options: BucketSourceOptions): ModelSource {
  const fetchImpl = options.fetchImpl ?? fetch

  return {
    open: async (entry, signal) => {
      options.budget.spend()

      let response: Response
      try {
        response = await fetchImpl(entry.url, {
          headers: { 'user-agent': BUCKET_USER_AGENT, accept: 'application/octet-stream,model/stl,*/*' },
          ...(signal === undefined ? {} : { signal }),
        })
      } catch (cause) {
        throw new BucketFetchError(entry.md5, entry.url, 'the request failed', undefined, { cause })
      }

      if (!response.ok) {
        const hint =
          response.status === 403
            ? ' — Cloudflare is refusing this client, which is error 1010 if the User-Agent was rejected'
            : ''
        throw new BucketFetchError(
          entry.md5,
          entry.url,
          `HTTP ${String(response.status)} ${response.statusText}${hint}`,
          response.status,
        )
      }

      // A redirect that left the models bucket would otherwise be invisible.
      if (response.redirected && !isModelStlUrl(response.url)) {
        throw new ModelUrlError(response.url, 'the request was redirected off the original-model path')
      }

      const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
      if (contentType !== undefined && contentType !== '' && !MODEL_CONTENT_TYPES.includes(contentType)) {
        throw new ModelUrlError(entry.url, `served as ${contentType}, which is not a mesh`)
      }

      // Cheap early failure. The authoritative check is over the body itself,
      // below — this only avoids transferring 33 MB to learn what a header
      // already said.
      const declared = response.headers.get('content-length')
      if (declared !== null && declared !== '' && Number(declared) !== entry.bytes) {
        throw new ModelLengthError(entry.md5, entry.url, entry.bytes, Number(declared))
      }

      if (response.body === null) {
        throw new BucketFetchError(entry.md5, entry.url, 'the response carried no body', response.status)
      }

      // `Response.body` is `ReadableStream<any>` in the Workers typings; the
      // chunk type is named here so the counting below is not `any` arithmetic.
      return lengthVerified(response.body as ReadableStream<Uint8Array>, entry)
    },
  }
}

/**
 * Wrap a body so that it errors if it is not exactly the length the index
 * recorded.
 *
 * Errors in both directions, and errors the *long* case as soon as the
 * threshold is crossed rather than at the end, so a runaway response is cut off
 * instead of transferred in full and then discarded.
 *
 * Throwing from `pull` errors this stream, which rejects the read `client-zip`
 * is waiting on, which errors the archive stream, which aborts the HTTP
 * response. Nothing partial is ever handed to the browser as a complete file.
 */
export function lengthVerified(body: ReadableStream<Uint8Array>, entry: ArchiveModelEntry): ReadableStream<Uint8Array> {
  const reader = body.getReader()
  let seen = 0

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await reader.read()

      if (done) {
        if (seen !== entry.bytes) throw new ModelLengthError(entry.md5, entry.url, entry.bytes, seen)
        controller.close()
        return
      }

      seen += value.byteLength
      if (seen > entry.bytes) {
        await reader.cancel().catch(() => undefined)
        throw new ModelLengthError(entry.md5, entry.url, entry.bytes, seen)
      }
      controller.enqueue(value)
    },

    cancel(reason: unknown) {
      return reader.cancel(reason)
    },
  })
}

/** Whether this many bytes crosses a logging boundary. Keeps the log at ~26 lines per 1.6 GB. */
export function crossedLogBoundary(previous: number, current: number): boolean {
  return Math.floor(current / LOG_INTERVAL_BYTES) > Math.floor(previous / LOG_INTERVAL_BYTES)
}
