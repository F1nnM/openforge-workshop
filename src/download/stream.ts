/**
 * The archive, as a stream of bytes — plus the guard that it is a *whole* archive.
 *
 * **Never a `Blob`.** A 50-placement room at the corpus p95 is 1.64 GB, and
 * buffering that into a `Blob` before handing it to the browser is an
 * out-of-memory crash on mobile Safari and a multi-second stall everywhere else.
 * Peak memory here is one file's chunk: `client-zip` pulls the next entry only
 * once the previous one is written out, so a slow disk throttles the fetches
 * rather than queueing hundreds of them.
 *
 * ## Why there is a length guard
 *
 * A ZIP written in streaming mode records each entry's real size *after* the
 * data, in a trailing descriptor. That makes the format resilient — and it makes
 * a truncated download look structurally valid. If a fetch returns HTTP 200 with
 * a short body, the archive that lands on disk opens cleanly and one of the
 * meshes inside it is a corrupt STL. Nobody finds out until the print fails.
 *
 * Because nothing is compressed, `plan.predictedLength` is exact to the byte
 * (see `clientZip.ts`), which turns that into something checkable: this module
 * counts the bytes it passes through and fails the stream if the total is not
 * exactly what the plan promised. So both ways an archive can go wrong surface:
 *
 *   - **a failed fetch** rejects inside the entry generator, which `client-zip`
 *     propagates as a stream error — the read errors and no complete file is
 *     produced;
 *   - **a short or long body behind a 200** trips the byte count.
 *
 * A discrepancy in the *long* direction is an error too. The URL is
 * content-addressed — `{md5[0:6]}/{md5}.stl` — so bytes that disagree with the
 * index's recorded size mean the object under that md5 is not the object the
 * index measured, and that is an integrity problem, not a rounding one.
 *
 * ## Why this is hand-rolled rather than a `TransformStream`
 *
 * The obvious spelling is `zip.pipeThrough(counter)`. It was tried and rejected:
 * an error raised inside a transform travels back through the internal `pipeTo`,
 * and Node leaves one of the intermediate write promises unhandled — so a
 * correctly-failed download also printed an unhandled rejection, which is
 * exactly the kind of noise that hides the next real bug. Reading the ZIP with a
 * reader and counting in `pull` keeps every rejection on one path: the caller's.
 */
import type { BlobId } from '@/catalog'

import type { ZipEntry } from './clientZip'
import { makeZipStream } from './clientZip'
import type { ArchiveEntry, ArchivePlan } from './plan'
import type { BlobSource } from './source'

/**
 * How often {@link ArchiveStreamOptions.onProgress} fires, in bytes.
 *
 * R2 hands back roughly 64 KB chunks, so reporting every chunk would be ~25,000
 * calls for a 1.6 GB archive and would re-render a progress bar far faster than
 * a display refreshes. One report per megabyte is ~1,600 calls over the same
 * archive, and the final byte is always reported.
 */
export const PROGRESS_INTERVAL_BYTES = 1_000_000

export interface ArchiveProgress {
  /** Bytes of the finished archive emitted so far. */
  bytesWritten: number
  /** {@link ArchivePlan.predictedLength}. Exact, so `bytesWritten / predictedLength` is honest. */
  predictedLength: number
  /** Entries begun, licensing files included. */
  entriesStarted: number
  /** Total entries, licensing files included. */
  entries: number
  /** The entry currently being written, or `undefined` before the first one. */
  entry: ArchiveEntry | undefined
}

export interface ArchiveStreamOptions {
  /** Where model bytes come from. Injectable, and the reason no test needs R2. */
  source: BlobSource
  /** Cancels between entries and inside a fetch. */
  signal?: AbortSignal
  /** Called at most once per {@link PROGRESS_INTERVAL_BYTES}, plus once at the end. */
  onProgress?: (progress: ArchiveProgress) => void
}

/**
 * The archive did not come out the size the plan promised.
 *
 * The short case is the dangerous one — a valid-looking ZIP holding a truncated
 * mesh — and it is the case this error exists to make loud.
 */
export class ArchiveLengthMismatchError extends Error {
  readonly expected: number
  readonly actual: number

  constructor(expected: number, actual: number, where: string) {
    const direction = actual < expected ? 'short' : 'long'
    super(
      `the archive came out ${direction}: expected exactly ${String(expected)} bytes, ${where} ${String(actual)}. ` +
        'The download has been failed rather than saved, because a streamed ZIP records its sizes at the end ' +
        'and a truncated one still opens.',
    )
    this.name = 'ArchiveLengthMismatchError'
    this.expected = expected
    this.actual = actual
  }
}

/**
 * Open the archive described by a plan.
 *
 * Nothing is fetched until the returned stream is read, so a caller may build a
 * plan, show the exact size, and open the stream only once the user has chosen
 * where to put it.
 */
export function openArchiveStream(plan: ArchivePlan, options: ArchiveStreamOptions): ReadableStream<Uint8Array> {
  const progress: StreamProgress = { started: 0, entry: undefined }
  const reader = makeZipStream(cancellable(zipEntries(plan, options, progress))).getReader()

  let written = 0
  let reported = 0

  const report = (): void => {
    options.onProgress?.({
      bytesWritten: written,
      predictedLength: plan.predictedLength,
      entriesStarted: progress.started,
      entries: plan.entries.length,
      entry: progress.entry,
    })
  }

  /** Stop the writer before failing, so `client-zip` releases the entry it holds. */
  const fail = async (error: Error): Promise<never> => {
    await reader.cancel(error).catch(() => undefined)
    throw error
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await reader.read()

      if (done) {
        if (written !== plan.predictedLength) {
          throw new ArchiveLengthMismatchError(plan.predictedLength, written, 'wrote')
        }
        report()
        controller.close()
        return
      }

      written += value.byteLength
      if (written > plan.predictedLength) {
        // Fail mid-stream rather than at the end, so a runaway response is cut
        // off instead of downloaded in full and then discarded.
        await fail(new ArchiveLengthMismatchError(plan.predictedLength, written, 'had already written'))
      }
      if (written - reported >= PROGRESS_INTERVAL_BYTES) {
        reported = written
        report()
      }
      controller.enqueue(value)
    },

    cancel(reason: unknown) {
      return reader.cancel(reason)
    },
  })
}

interface StreamProgress {
  started: number
  entry: ArchiveEntry | undefined
}

/**
 * Adapt a generator so that cancelling it cannot produce an unhandled rejection.
 *
 * `client-zip` cancels its source by calling `throw()` on the iterator and **not
 * awaiting** the promise that comes back. On a plain async generator that
 * promise rejects — with the injected reason if the generator is suspended at a
 * `yield`, and with the bare reason if it has not started yet — so an entirely
 * ordinary cancellation (a dismissed save dialog) printed an unhandled rejection
 * beside a correct result. Translating the cancellation into `return()` settles
 * cleanly, still runs the generator's teardown, and leaves real failures — which
 * travel the other way, out of `next()` — untouched.
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

/**
 * The entries, in plan order, with model bodies opened one at a time.
 *
 * `plan.entries` is the single ordered list the predicted length was computed
 * from, so iterating it here is what keeps the prediction and the bytes in step.
 */
async function* zipEntries(
  plan: ArchivePlan,
  options: ArchiveStreamOptions,
  progress: StreamProgress,
): AsyncGenerator<ZipEntry> {
  for (const entry of plan.entries) {
    options.signal?.throwIfAborted()
    progress.started += 1
    progress.entry = entry

    const value: ZipEntry =
      entry.kind === 'text'
        ? { name: entry.name, input: entry.text, lastModified: plan.generatedAt }
        : {
            name: entry.name,
            input: await open(options.source, entry.blob, options.signal),
            size: entry.bytes,
            lastModified: plan.generatedAt,
          }

    yield value
  }
}

function open(source: BlobSource, blob: BlobId, signal: AbortSignal | undefined): Promise<ReadableStream<Uint8Array>> {
  return signal === undefined ? source.open(blob) : source.open(blob, signal)
}
