/**
 * The archive as a stream of bytes, plus the guard that it is a *whole*
 * archive.
 *
 * ## Nothing is buffered, and that is not an optimisation
 *
 * A Worker isolate has **128 MB of memory**, shared between the invocations
 * running in it. The worst case this row exists for is a **1.6435 GB** archive —
 * **12.8× the whole isolate.** There is no version of "collect the chunks and
 * return them" that works: not a `Blob`, not an array of `Uint8Array`, not
 * `await new Response(zip).arrayBuffer()`. A Worker that buffers the archive
 * dies on the first request, and it dies at whatever moment the allocator gives
 * up rather than with an error anybody can act on.
 *
 * So peak memory here is one chunk plus one prefetched body. `client-zip` pulls
 * the next entry only once the previous one is written out, and this module
 * reads the zip with a reader and re-enqueues each chunk, so the eyeball's read
 * rate is what throttles the bucket fetches — backpressure all the way from the
 * phone to R2, with no queue anywhere in the middle. `limits.ts` has the
 * figures.
 *
 * ## Why there is a length guard — and why truncation must be loud
 *
 * A ZIP written in streaming mode records each entry's real size *after* the
 * data, in a trailing descriptor. That makes the format resilient, and it makes
 * a truncated archive look structurally valid: it opens cleanly, and one of the
 * meshes inside it is a corrupt STL.
 *
 * v1 rejected `native-file-system-adapter` for exactly this property — its
 * service-worker fallback truncates *downstream of any byte counter*, in the
 * browser's download manager where nothing can observe it. Putting that property
 * back on the server side would be worse, because the server is the path that
 * exists *for* the cases the browser cannot handle. Four things stop it:
 *
 *   1. **`Content-Length` is the exact predicted length.** Nothing is
 *      compressed, so `predictZipLength` is exact to the byte. A body that ends
 *      early is then a malformed HTTP response, not a shorter file: the runtime
 *      resets the stream and the browser's download manager reports a failed
 *      download. This is the layer that works even if every check below is
 *      wrong.
 *   2. **Every model body is length-verified against the catalog index**, in
 *      both directions, from bytes counted off the body — `bucket.ts`.
 *   3. **The archive's own bytes are counted here** and the stream is failed if
 *      the total is not exactly what the plan promised. The long direction fails
 *      the moment it is crossed rather than at the end.
 *   4. **A failed fetch rejects inside the entry generator**, which `client-zip`
 *      propagates as a stream error, which aborts the response. A bucket 403 is
 *      an aborted download, never a short archive — and because
 *      {@link ArchiveStream.prime} opens the first body *before* the response
 *      headers are written, the common case of a misconfigured bucket is a clean
 *      HTTP error instead.
 *
 * ## Why this is hand-rolled rather than a `TransformStream`
 *
 * `src/download/stream.ts` records the reason and it applies here unchanged: an
 * error raised inside a transform travels back through the internal `pipeTo` and
 * leaves one of the intermediate write promises unhandled, so a correctly-failed
 * download also prints an unhandled rejection. Reading with a reader and
 * counting in `pull` keeps every rejection on one path.
 *
 * This module is the Worker's twin of `src/download/stream.ts`, which it would
 * import if it could — that module's type imports reach `@/assembly` → `@/store`
 * and so need DOM globals. The duplication is reported as a seam in the PR.
 */
import type { ZipEntry } from '../../src/download/clientZip'
import { makeZipStream } from '../../src/download/clientZip'
import type { ArchiveModelEntry, ArchivePlan } from './archive'
import type { ModelSource } from './bucket'
import { PREFETCH_DEPTH } from './limits'

export interface ArchiveProgress {
  /** Bytes of the finished archive emitted so far. */
  bytesWritten: number
  /** {@link ArchivePlan.predictedLength}. Exact, so the ratio is honest. */
  predictedLength: number
  /** Entries begun, licensing files included. */
  entriesStarted: number
  /** Total entries, licensing files included. */
  entries: number
}

export interface ArchiveStreamOptions {
  /** Where model bytes come from. Injectable, and the reason no test needs the bucket. */
  source: ModelSource
  /** Bodies opened ahead of the one being written. Defaults to {@link PREFETCH_DEPTH}. */
  prefetch?: number
  /** Cancels between entries and inside a fetch. */
  signal?: AbortSignal
  /** Called on every archive chunk. `index.ts` throttles its own logging. */
  onProgress?: (progress: ArchiveProgress) => void
}

/**
 * The archive did not come out the size the plan promised.
 *
 * The short case is the dangerous one — a valid-looking ZIP holding a truncated
 * mesh — and it is the case this error exists to make loud. Named identically to
 * `src/download/stream.ts`'s error because it is the same failure on the other
 * path, and a reader should not have to learn two words for it.
 */
export class ArchiveLengthMismatchError extends Error {
  readonly expected: number
  readonly actual: number

  constructor(expected: number, actual: number, where: string) {
    const direction = actual < expected ? 'short' : 'long'
    super(
      `the archive came out ${direction}: expected exactly ${String(expected)} bytes, ${where} ${String(actual)}. ` +
        'The response has been failed rather than finished, because a streamed ZIP records its sizes at the end ' +
        'and a truncated one still opens.',
    )
    this.name = 'ArchiveLengthMismatchError'
    this.expected = expected
    this.actual = actual
  }
}

/**
 * An archive, opened in two steps.
 *
 * The split is the whole reason a bucket failure is an HTTP error rather than a
 * broken download: {@link prime} does the first fetch, so the handler can still
 * choose a status code, and only then is {@link body} handed to a `Response`.
 */
export interface ArchiveStream {
  /**
   * Open the first model body.
   *
   * Rejects with whatever `bucket.ts` refused it — a 403, a redirect off the
   * models path, a `content-length` that disagrees with the index. Call it
   * before constructing the `Response`.
   */
  prime(): Promise<void>
  /** The archive's bytes. Reading it drives every remaining fetch. */
  body(): ReadableStream<Uint8Array>
  /** Cancel any body opened and not yet consumed. Safe to call twice. */
  dispose(): void
}

export function openArchiveStream(plan: ArchivePlan, options: ArchiveStreamOptions): ArchiveStream {
  const queue = bodyQueue(plan.models, options, options.prefetch ?? PREFETCH_DEPTH)
  const counter = { started: 0 }

  return {
    prime: () => queue.prime(),
    dispose: () => {
      queue.dispose()
    },
    body: () => countedArchive(plan, options, queue, counter),
  }
}

/* ------------------------------------------------------------ the byte count */

function countedArchive(
  plan: ArchivePlan,
  options: ArchiveStreamOptions,
  queue: BodyQueue,
  counter: { started: number },
): ReadableStream<Uint8Array> {
  const reader = makeZipStream(cancellable(zipEntries(plan, options, queue, counter))).getReader()
  let written = 0

  /** Stop the writer before failing, so `client-zip` releases the entry it holds. */
  const fail = async (error: Error): Promise<never> => {
    queue.dispose()
    await reader.cancel(error).catch(() => undefined)
    throw error
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await reader.read()

      if (done) {
        if (written !== plan.predictedLength) {
          await fail(new ArchiveLengthMismatchError(plan.predictedLength, written, 'wrote'))
        }
        controller.close()
        return
      }

      written += value.byteLength
      if (written > plan.predictedLength) {
        // Fail mid-stream rather than at the end, so a runaway response is cut
        // off instead of transferred in full and then discarded.
        await fail(new ArchiveLengthMismatchError(plan.predictedLength, written, 'had already written'))
      }

      options.onProgress?.({
        bytesWritten: written,
        predictedLength: plan.predictedLength,
        entriesStarted: counter.started,
        entries: plan.entries.length,
      })
      controller.enqueue(value)
    },

    cancel(reason: unknown) {
      queue.dispose()
      return reader.cancel(reason)
    },
  })
}

/**
 * The entries, in plan order, with model bodies opened one at a time.
 *
 * `plan.entries` is the single ordered list the predicted length was computed
 * from, so iterating it here is what keeps the prediction and the bytes in step.
 */
async function* zipEntries(
  plan: ArchivePlan,
  options: ArchiveStreamOptions,
  queue: BodyQueue,
  counter: { started: number },
): AsyncGenerator<ZipEntry> {
  let model = 0

  for (const entry of plan.entries) {
    options.signal?.throwIfAborted()
    counter.started += 1

    if (entry.kind === 'text') {
      yield { name: entry.name, input: entry.text, lastModified: plan.generatedAt }
      continue
    }

    const input = await queue.take(model)
    model += 1
    yield { name: entry.name, input, size: entry.bytes, lastModified: plan.generatedAt }
  }
}

/* ----------------------------------------------------------- the prefetcher */

interface BodyQueue {
  prime(): Promise<void>
  take(index: number): Promise<ReadableStream<Uint8Array>>
  dispose(): void
}

/**
 * One body open ahead of the one being written.
 *
 * Depth 1 rather than 8, and `limits.ts` has the measurement behind that: the
 * bucket's aggregate throughput at concurrency 8 (7.2–11.0 MB/s) sits inside its
 * single-stream range (3.4–11.4 MB/s), so opening more connections moves no more
 * bytes. What depth 1 does buy is the next object's time-to-first-byte, hidden
 * behind the current object's transfer — and it keeps at most two of
 * Cloudflare's six simultaneous connections in use.
 *
 * `dispose` matters more than it looks: a cancelled download (a dismissed
 * dialog, a closed tab) leaves a prefetched body nobody will read, and an
 * un-awaited promise for it. Cancelling it releases the connection, and
 * attaching handlers to it keeps an ordinary cancellation from printing an
 * unhandled rejection beside a correct result.
 */
function bodyQueue(
  models: readonly ArchiveModelEntry[],
  options: ArchiveStreamOptions,
  depth: number,
): BodyQueue {
  const pending = new Map<number, Promise<ReadableStream<Uint8Array>>>()

  const start = (index: number): void => {
    const entry = models[index]
    if (entry === undefined || pending.has(index)) return
    pending.set(
      index,
      options.signal === undefined ? options.source.open(entry) : options.source.open(entry, options.signal),
    )
  }

  return {
    prime: async () => {
      if (models.length === 0) return
      start(0)
      await pending.get(0)
    },

    take: async (index: number) => {
      start(index)
      const opened = pending.get(index)
      pending.delete(index)
      if (opened === undefined) {
        // Unreachable: `zipEntries` walks `plan.models` in order, and `start`
        // sets an entry for every in-range index.
        throw new Error(`no body was opened for model ${String(index)}`)
      }
      for (let ahead = 1; ahead <= depth; ahead += 1) start(index + ahead)
      return await opened
    },

    dispose: () => {
      for (const opened of pending.values()) {
        void opened.then(
          (body) => body.cancel().catch(() => undefined),
          () => undefined,
        )
      }
      pending.clear()
    },
  }
}

/**
 * Adapt a generator so that cancelling it cannot produce an unhandled rejection.
 *
 * `src/download/stream.ts` has the full explanation and it is unchanged here:
 * `client-zip` cancels its source by calling `throw()` on the iterator and **not
 * awaiting** the promise that comes back, so on a plain async generator an
 * entirely ordinary cancellation prints an unhandled rejection beside a correct
 * result. Translating the cancellation into `return()` settles cleanly, still
 * runs the generator's teardown, and leaves real failures — which travel the
 * other way, out of `next()` — untouched.
 */
function cancellable<T>(inner: AsyncGenerator<T>): AsyncIterableIterator<T> {
  return {
    next: () => inner.next(),
    throw: async () => {
      await inner.return(undefined)
      return { done: true, value: undefined }
    },
    [Symbol.asyncIterator]() {
      return this
    },
  }
}
