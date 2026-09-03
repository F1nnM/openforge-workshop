/**
 * The stream cap, and the fetch seam — with no network anywhere.
 *
 * `BlobSource` is supplied by the test, which is the same thing PR 11's own tests
 * do and the reason it exists: the interface takes a content address, so a fake
 * is three lines and R2 is never touched.
 */
import { describe, expect, it, vi } from 'vitest'

import type { BlobId } from '@/catalog'
import type { BlobSource } from '@/download'

import { StlTooLargeError, loadModel, readCapped } from './loadModel'
import type { StlParser } from './stl/client'
import { TILE_FACETS, binaryStl } from './stl/fixtures'
import { parseStl } from './stl/parse'

const BLOB = 'a'.repeat(32) as BlobId

/**
 * A body that yields the given chunks, and remembers whether it was cancelled.
 *
 * Pull-based on purpose: a source that enqueues everything in `start` is already
 * closed by the second read, and `cancel()` on a drained closed stream never
 * reaches the underlying source — so an eagerly-filled fake would make the
 * cancellation assertions below silently vacuous.
 */
function bodyOf(chunks: readonly Uint8Array[]) {
  const state = { cancelled: false }
  let next = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[next]
      if (chunk === undefined) {
        controller.close()
        return
      }
      controller.enqueue(chunk)
      next += 1
    },
    cancel() {
      state.cancelled = true
    },
  })
  return { stream, state }
}

function chunk(size: number, fill: number): Uint8Array {
  return new Uint8Array(size).fill(fill)
}

describe('readCapped', () => {
  it('assembles the chunks into one buffer of the exact length', async () => {
    const { stream } = bodyOf([chunk(400, 1), chunk(600, 2)])
    const buffer = await readCapped(stream, { limit: 10_000, expected: 1000 })

    expect(buffer.byteLength).toBe(1000)
    expect(new Uint8Array(buffer)[0]).toBe(1)
    expect(new Uint8Array(buffer)[999]).toBe(2)
  })

  it('reports determinate progress against the index’s own byte count', async () => {
    const { stream } = bodyOf([chunk(500, 1), chunk(500, 1)])
    const seen: { loaded: number; total: number }[] = []

    await readCapped(stream, { limit: 10_000, expected: 1000, onProgress: (p) => seen.push(p) })

    expect(seen).toEqual([
      { loaded: 500, total: 1000 },
      { loaded: 1000, total: 1000 },
    ])
  })

  it('refuses and cancels the moment the cap is passed', async () => {
    const { stream, state } = bodyOf([chunk(600, 1), chunk(600, 1)])

    await expect(
      readCapped(stream, { limit: 1000, expected: 600 }),
    ).rejects.toThrow(StlTooLargeError)
    expect(state.cancelled).toBe(true)
  })

  it('is the half of the gate that a stale index cannot get past', async () => {
    // The index says 1 KB; the bucket serves 2 KB. The gate passed on `bytes`;
    // this is what stops the tab paying for the difference.
    const { stream } = bodyOf([chunk(2048, 7)])
    await expect(readCapped(stream, { limit: 1500, expected: 1024 })).rejects.toThrow(
      /larger than the/,
    )
  })

  it('grows when the body overshoots the expected size but stays under the cap', async () => {
    const { stream } = bodyOf([chunk(1000, 1), chunk(1000, 2)])
    const buffer = await readCapped(stream, { limit: 10_000, expected: 1000 })
    expect(buffer.byteLength).toBe(2000)
  })

  it('trims when the body undershoots', async () => {
    const { stream } = bodyOf([chunk(300, 9)])
    const buffer = await readCapped(stream, { limit: 10_000, expected: 5000 })

    expect(buffer.byteLength).toBe(300)
    expect(new Uint8Array(buffer).every((byte) => byte === 9)).toBe(true)
  })

  it('handles an empty body — the 84-byte file’s neighbour case', async () => {
    const { stream } = bodyOf([])
    const buffer = await readCapped(stream, { limit: 10_000, expected: 0 })
    expect(buffer.byteLength).toBe(0)
  })

  it('stops on an abort and cancels the body', async () => {
    const { stream, state } = bodyOf([chunk(100, 1), chunk(100, 1)])
    const controller = new AbortController()
    controller.abort()

    await expect(
      readCapped(stream, { limit: 10_000, expected: 200, signal: controller.signal }),
    ).rejects.toThrow(/abort/i)
    expect(state.cancelled).toBe(true)
  })
})

/* ---------------------------------------------------------------- loadModel */

function fakeSource(bytes: Uint8Array): BlobSource & { opened: BlobId[] } {
  const opened: BlobId[] = []
  return {
    opened,
    urlFor: (blob) => `stub://${blob}`,
    open: (blob) => {
      opened.push(blob)
      return Promise.resolve(bodyOf([bytes]).stream)
    },
  }
}

function fakeParser(): StlParser & { given: number[] } {
  const given: number[] = []
  return {
    given,
    parse: (buffer) => {
      given.push(buffer.byteLength)
      return Promise.resolve({ ...parseStl(new Uint8Array(buffer)), parseMs: 3 })
    },
    terminate: () => undefined,
  }
}

describe('loadModel', () => {
  it('fetches by content address and parses in the worker', async () => {
    const bytes = binaryStl(TILE_FACETS)
    const source = fakeSource(bytes)
    const parser = fakeParser()

    const loaded = await loadModel(BLOB, {
      source,
      parser,
      limit: 10_000,
      expected: bytes.byteLength,
    })

    expect(source.opened).toEqual([BLOB])
    expect(parser.given).toEqual([bytes.byteLength])
    expect(loaded.triangles).toBe(12)
    expect(loaded.format).toBe('binary')
    expect(loaded.parseMs).toBe(3)
    expect(loaded.fetchMs).toBeGreaterThanOrEqual(0)
  })

  it('never has a URL to be pointed at', () => {
    // Structural, not behavioural: `open` takes a BlobId. There is no argument
    // here that could name /thumbs/, /sprites/ or a future /lod/ store, which is
    // §10 obligation 3 enforced by the type rather than by review.
    const parser = fakeParser()
    const source = fakeSource(binaryStl(TILE_FACETS))
    const open = vi.spyOn(source, 'open')

    void loadModel(BLOB, { source, parser, limit: 10_000, expected: 684 })

    expect(open.mock.calls[0]?.[0]).toBe(BLOB)
    expect(open.mock.calls[0]).toHaveLength(2)
  })

  it('surfaces the cap as StlTooLargeError, not as a parse failure', async () => {
    const bytes = binaryStl(TILE_FACETS)
    await expect(
      loadModel(BLOB, {
        source: fakeSource(bytes),
        parser: fakeParser(),
        limit: 100,
        expected: bytes.byteLength,
      }),
    ).rejects.toThrow(StlTooLargeError)
  })

  it('carries the 84-byte file through as a successful load of nothing', async () => {
    const bytes = binaryStl([])
    const loaded = await loadModel(BLOB, {
      source: fakeSource(bytes),
      parser: fakeParser(),
      limit: 10_000,
      expected: 84,
    })

    expect(loaded.triangles).toBe(0)
    expect(loaded.sourceBytes).toBe(84)
  })
})
