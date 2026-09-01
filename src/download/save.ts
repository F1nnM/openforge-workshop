/**
 * Landing the archive on disk.
 *
 * ## Why not `native-file-system-adapter`
 *
 * §11 nominates it, and it is the obvious pick: one `showSaveFilePicker` call
 * that falls back through a same-origin service worker to a `Blob`. It was
 * rejected here, for three reasons that all point the same way.
 *
 *   1. **Its service-worker fallback is the one failure mode this package cannot
 *      detect from the outside.** Firefox will terminate a service worker that
 *      idles mid-transfer, and the browser then finishes the download from a
 *      dead stream: the file lands, looks complete, and is short. That is
 *      precisely the silent truncation `stream.ts` exists to prevent — except
 *      that the truncation happens *downstream* of our byte counter, in the
 *      browser's download manager, where no guard we can write will see it. A
 *      streaming path we cannot verify is worse than an honest refusal.
 *   2. **It would be a second vendored dependency** (see `clientZip.ts` on why
 *      these are vendored) to cover browsers where the remaining benefit over a
 *      plain `Blob` is the archives too big to buffer — and for those, §11
 *      already has a better answer than a service worker: the Cloudflare Worker
 *      fallback, plus the URL-list degradation path in `urlList.ts`.
 *   3. **A service worker is not free.** It intercepts every request on the
 *      origin for the lifetime of the registration, on a static site that has no
 *      other use for one.
 *
 * ## So: two paths, and a refusal
 *
 * | Browser | Path | Ceiling |
 * | --- | --- | --- |
 * | Chrome, Edge, Opera (desktop) | `showSaveFilePicker` → `createWritable` → `pipeTo` | none — true streaming, memory is one chunk |
 * | Firefox, Safari (desktop and iOS) | buffer to a `Blob`, `<a download>` | {@link BLOB_FALLBACK_LIMIT_BYTES} |
 * | anything, above the ceiling | {@link ArchiveTooLargeToBufferError} | — |
 *
 * **iOS Safari has no `showSaveFilePicker` and will not get one** — Apple has
 * not shipped the File System Access API's picker and there is no signal that it
 * will. So iOS always takes the `Blob` path: `new Response(stream).blob()`
 * materialises the archive in memory and an `<a download>` hands it to the Files
 * app. That works, and it caps out: iOS kills a tab that allocates too much, so
 * the limit below is a refusal rather than a crash. Above it, the honest answer
 * is §11's Worker fallback or the URL list — and the refusal carries the size and
 * the limit so the UI can say which.
 *
 * The refusal is a real product limit, not a bug: a 1.6 GB room cannot be
 * downloaded in one file on an iPhone by any means available to a static site.
 */
import type { ArchivePlan } from './plan'

/**
 * The most an archive may be before the buffering fallback refuses it.
 *
 * 512 MB, the same number as `DOWNLOAD_LARGE_BYTES` — fifty placements at the
 * 10.36 MB corpus median — and deliberately so: the point at which the bill
 * starts warning "this will take a while" is the point at which a browser
 * without a streaming save should stop pretending it can. Not imported from
 * `@/assembly`, because the two are the same number for different reasons and
 * tying them together would mean a change to the *warning* threshold silently
 * moved the *refusal* threshold.
 */
export const BLOB_FALLBACK_LIMIT_BYTES = 512_000_000

/** Which of the two paths a save took. Reported so the UI can explain the limit it hit. */
export type SaveVia = 'file-system-access' | 'blob'

export type SaveResult =
  | { outcome: 'saved'; via: SaveVia; bytes: number; filename: string }
  /** The user dismissed the picker, or an `AbortSignal` fired. Not an error. */
  | { outcome: 'cancelled' }

/* ------------------------------------------ the File System Access API, minimally */

/**
 * Only the parts of the File System Access API this module uses.
 *
 * Declared structurally rather than pulled from `@types/wicg-file-system-access`:
 * TypeScript's own `lib.dom` carries `FileSystemFileHandle` and
 * `FileSystemWritableFileStream` but *not* `showSaveFilePicker`, and a
 * `@types` package for two method signatures is not worth an install. The real
 * handle satisfies this shape, so no cast is needed at the boundary.
 */
export interface SaveFilePickerOptions {
  suggestedName?: string
  types?: readonly { description: string; accept: Record<string, readonly string[]> }[]
}

export interface SaveFileHandle {
  createWritable: (options?: { keepExistingData?: boolean }) => Promise<WritableStream<Uint8Array>>
}

export type ShowSaveFilePicker = (options: SaveFilePickerOptions) => Promise<SaveFileHandle>

/* ---------------------------------------------------------------- environment */

/**
 * Everything about saving that depends on the host, behind one object.
 *
 * The seam exists so the tests cover the *decision* — which path, and where it
 * refuses — without a browser. Nothing in here reaches the network.
 */
export interface SaveEnvironment {
  /** Present on Chromium desktop; absent on Firefox and on all of Safari. */
  showSaveFilePicker?: ShowSaveFilePicker
  /** Hand a finished `Blob` to the browser's download manager. */
  saveBlob?: (blob: Blob, filename: string) => void
  /** Override {@link BLOB_FALLBACK_LIMIT_BYTES}. Tests use it; production does not. */
  blobLimitBytes?: number
}

/** The archive is too big to buffer, and this browser cannot stream to disk. */
export class ArchiveTooLargeToBufferError extends Error {
  readonly bytes: number
  readonly limit: number

  constructor(bytes: number, limit: number) {
    super(
      `this browser has no streaming save, and ${String(bytes)} bytes exceeds the ${String(limit)}-byte buffering ` +
        'limit. Download the room in parts, or use the URL list.',
    )
    this.name = 'ArchiveTooLargeToBufferError'
    this.bytes = bytes
    this.limit = limit
  }
}

/** Neither save path is available — a headless or hardened host. */
export class NoSaveTargetError extends Error {
  constructor() {
    super('this environment offers no way to save a file: no showSaveFilePicker and no blob download')
    this.name = 'NoSaveTargetError'
  }
}

/**
 * The browser's own capabilities.
 *
 * Both members are probed rather than assumed, so this returns a usable
 * environment under jsdom, in a worker, and in Node — with the paths that are
 * genuinely missing simply absent.
 */
export function browserSaveEnvironment(): SaveEnvironment {
  const host = globalThis as { showSaveFilePicker?: ShowSaveFilePicker }
  const environment: SaveEnvironment = {}

  if (typeof host.showSaveFilePicker === 'function') {
    environment.showSaveFilePicker = host.showSaveFilePicker.bind(globalThis)
  }
  if (typeof document !== 'undefined' && typeof URL.createObjectURL === 'function') {
    environment.saveBlob = anchorDownload
  }
  return environment
}

/**
 * Hand a `Blob` to the download manager.
 *
 * The object URL is revoked on the next task rather than immediately: revoking
 * it in the same tick as the click cancels the download in Safari.
 */
function anchorDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 0)
}

/* --------------------------------------------------------------------- saving */

/**
 * Save an archive stream, choosing the best path this browser offers.
 *
 * Errors from the stream itself — a failed fetch, a length mismatch — propagate
 * unchanged; this function adds nothing to them and swallows nothing. A
 * cancellation is *not* an error: a dismissed picker and an aborted signal both
 * come back as `{ outcome: 'cancelled' }`, because a user changing their mind is
 * a normal outcome and rendering it as a failure is a bug users report.
 */
export async function saveArchive(
  plan: ArchivePlan,
  stream: ReadableStream<Uint8Array>,
  environment: SaveEnvironment = browserSaveEnvironment(),
): Promise<SaveResult> {
  const { showSaveFilePicker, saveBlob } = environment

  if (showSaveFilePicker !== undefined) {
    let handle: SaveFileHandle
    try {
      handle = await showSaveFilePicker({
        suggestedName: plan.filename,
        types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }],
      })
    } catch (error) {
      if (isAbort(error)) {
        await stream.cancel().catch(() => undefined)
        return { outcome: 'cancelled' }
      }
      throw error
    }

    const writable = await handle.createWritable()
    try {
      // `pipeTo` aborts the writable on a source error, which discards the
      // handle's swap file rather than committing a partial one — so a failed
      // fetch leaves no truncated archive behind.
      await stream.pipeTo(writable)
    } catch (error) {
      if (isAbort(error)) return { outcome: 'cancelled' }
      throw error
    }
    return { outcome: 'saved', via: 'file-system-access', bytes: plan.predictedLength, filename: plan.filename }
  }

  if (saveBlob === undefined) throw new NoSaveTargetError()

  const limit = environment.blobLimitBytes ?? BLOB_FALLBACK_LIMIT_BYTES
  if (plan.predictedLength > limit) {
    await stream.cancel().catch(() => undefined)
    throw new ArchiveTooLargeToBufferError(plan.predictedLength, limit)
  }

  let blob: Blob
  try {
    blob = await new Response(stream).blob()
  } catch (error) {
    if (isAbort(error)) return { outcome: 'cancelled' }
    throw error
  }
  saveBlob(blob, plan.filename)
  return { outcome: 'saved', via: 'blob', bytes: blob.size, filename: plan.filename }
}

/**
 * Was this a cancellation rather than a failure?
 *
 * Duck-typed on `name` rather than `instanceof DOMException`: the picker throws a
 * `DOMException` named `AbortError`, an `AbortSignal`'s default reason is another
 * one, and a `TransformStream` can surface either across a realm boundary where
 * `instanceof` stops holding. Only `AbortError` counts — every other
 * `DOMException` the picker can raise (`NotAllowedError`, `SecurityError`) is a
 * real failure the user needs told about.
 */
function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}
