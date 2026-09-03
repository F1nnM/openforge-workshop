/**
 * Bytes → `ParsedStl`, with the cap that the index's `bytes` field cannot give.
 *
 * ## The fetch is PR 11's, deliberately
 *
 * This module does not build a URL. It takes a {@link BlobSource} — the
 * download pack's fetching seam, whose `open()` accepts a **content address and
 * nothing else** — so there is no argument here that could point the viewer at
 * `/thumbs/`, `/sprites/` or a future `/lod/` store, and the redirect and
 * `Content-Type` guards that PR 11 wrote apply unchanged. One validated URL
 * shape in the app, not two.
 *
 * The obligation runs the other way too, and it is the one that matters (§10,
 * obligation 3: a decimated mesh reaching someone's printer). This viewer cannot
 * become a download path because nothing in it holds printable bytes for longer
 * than one `await`: the response body is read into a buffer that is immediately
 * **transferred** to the parse worker — detached, `byteLength === 0` — and what
 * comes back is a `Float32Array` of positions with the facet normals and the
 * 80-byte header already gone. There is no code path from a mounted viewer to a
 * file the archive would recognise.
 *
 * ## The cap is the half of the gate that cannot be stale
 *
 * `gate.ts` decides from `CatalogRecord.bytes`, which is a build-time snapshot
 * of the bucket. If a file were re-exported larger without a re-import, the gate
 * would wave through a mesh that OOMs the tab. So the stream is counted as it
 * arrives and **cancelled** the moment it passes the same limit, before the
 * bytes are ever assembled. Cheap, and it turns a stale index into a legible
 * refusal instead of a killed tab.
 */
import type { BlobId } from '@/catalog'
import type { BlobSource } from '@/download'

import type { StlParser } from './stl/client'
import type { ParsedInWorker } from './stl/client'
import { formatMegabytes } from './gate'

/** The stream carried more bytes than the gate allows. */
export class StlTooLargeError extends Error {
  override readonly name = 'StlTooLargeError'
  readonly limit: number

  constructor(limit: number) {
    super(
      `the mesh is larger than the ${formatMegabytes(limit)} limit for in-browser 3D; ` +
        'the download was stopped',
    )
    this.limit = limit
  }
}

export interface ReadProgress {
  readonly loaded: number
  /** Expected total from the index, so the bar is honest from the first chunk. */
  readonly total: number
}

export interface ReadCappedOptions {
  /** Hard cap. The stream is cancelled the moment it is passed. */
  readonly limit: number
  /** `CatalogRecord.bytes` — the allocation is sized from it, not grown into it. */
  readonly expected: number
  readonly onProgress?: (progress: ReadProgress) => void
  readonly signal?: AbortSignal
}

/**
 * Drain a body into one `ArrayBuffer`, refusing to exceed `limit`.
 *
 * Sized from `expected` up front, so the common case — the index agrees with the
 * bucket — is a single allocation and no concatenation pass. A stream that
 * overshoots doubles; a stream that undershoots pays one `slice`, because the
 * buffer that leaves here is about to be transferred and a transfer moves whole
 * buffers, not views.
 */
export async function readCapped(
  stream: ReadableStream<Uint8Array>,
  { limit, expected, onProgress, signal }: ReadCappedOptions,
): Promise<ArrayBuffer> {
  const reader = stream.getReader()
  let buffer = new Uint8Array(Math.min(Math.max(expected, 1024), limit + 1))
  let loaded = 0

  try {
    for (;;) {
      if (signal?.aborted === true) throw new DOMException('aborted', 'AbortError')

      const { done, value } = await reader.read()
      if (done) break
      if (value === undefined) continue

      if (loaded + value.byteLength > limit) throw new StlTooLargeError(limit)

      if (loaded + value.byteLength > buffer.byteLength) {
        const grown = new Uint8Array(
          Math.min(Math.max(buffer.byteLength * 2, loaded + value.byteLength), limit + 1),
        )
        grown.set(buffer.subarray(0, loaded))
        buffer = grown
      }

      buffer.set(value, loaded)
      loaded += value.byteLength
      onProgress?.({ loaded, total: Math.max(expected, loaded) })
    }
  } finally {
    // Releasing the lock is not enough — an abandoned body keeps the connection
    // and the bytes alive until GC notices.
    await reader.cancel().catch(() => undefined)
  }

  return loaded === buffer.byteLength ? buffer.buffer : buffer.buffer.slice(0, loaded)
}

export interface LoadModelOptions {
  readonly source: BlobSource
  readonly parser: StlParser
  readonly limit: number
  /** `CatalogRecord.bytes`. */
  readonly expected: number
  readonly onProgress?: (progress: ReadProgress) => void
  readonly signal?: AbortSignal
}

export interface LoadedModel extends ParsedInWorker {
  /** Time from `open()` to the last byte, in ms. */
  readonly fetchMs: number
}

/** Fetch one original STL and parse it in the worker. */
export async function loadModel(blob: BlobId, options: LoadModelOptions): Promise<LoadedModel> {
  const { source, parser, limit, expected, onProgress, signal } = options

  const started = performance.now()
  const stream = await source.open(blob, signal)
  const bytes = await readCapped(stream, {
    limit,
    expected,
    // `exactOptionalPropertyTypes` — an explicit `undefined` is not the same as
    // an absent key here, and the absent key is what is meant.
    ...(onProgress === undefined ? {} : { onProgress }),
    ...(signal === undefined ? {} : { signal }),
  })
  const fetchMs = performance.now() - started

  const parsed = await parser.parse(bytes, signal)
  return { ...parsed, fetchMs }
}
