/**
 * The worker client, against a fake worker that honours transfer semantics.
 *
 * The fake runs the real parser and posts back through the real protocol, so what
 * is faked is the thread boundary and nothing else. Its `postMessage` clones
 * through `structuredClone(…, { transfer })` — the same algorithm the platform
 * uses — which means a test asserting the caller's buffer was detached is
 * asserting the true behaviour rather than a stub's.
 */
import { describe, expect, it, vi } from 'vitest'

import { StlWorkerError, createStlParser } from './client'
import { parseStl } from './parse'
import { EMPTY_BINARY_STL, TILE_FACETS, asciiStl, binaryStl, box } from './fixtures'
import type { ParseRequest } from './protocol'
import { failedResponse, parsedResponse } from './protocol'

/** A worker-shaped object that parses on the same thread, one tick later. */
function fakeWorker(): Worker & { terminated: boolean } {
  const listeners = new Map<string, Set<(event: unknown) => void>>()
  const worker = {
    terminated: false,

    addEventListener: (type: string, handler: (event: unknown) => void) => {
      const set = listeners.get(type) ?? new Set()
      set.add(handler)
      listeners.set(type, set)
    },
    removeEventListener: (type: string, handler: (event: unknown) => void) => {
      listeners.get(type)?.delete(handler)
    },
    terminate: () => {
      worker.terminated = true
    },

    postMessage: (message: unknown, transfer?: Transferable[]) => {
      // The real boundary: transfer detaches, so the caller loses the buffer.
      const received = structuredClone(message, { transfer: transfer ?? [] }) as ParseRequest

      setTimeout(() => {
        if (worker.terminated) return
        let reply: { message: unknown; transfer: readonly Transferable[] }
        try {
          reply = parsedResponse(parseStl(new Uint8Array(received.bytes)), 4.2)
        } catch (error) {
          reply = failedResponse(error)
        }
        const event = {
          data: structuredClone(reply.message, { transfer: [...reply.transfer] }),
        }
        for (const handler of listeners.get('message') ?? []) handler(event)
      }, 0)
    },
  }

  return worker as unknown as Worker & { terminated: boolean }
}

describe('createStlParser', () => {
  it('parses a binary buffer and reports the worker’s own parse time', async () => {
    const worker = fakeWorker()
    const parser = createStlParser(() => worker)

    const parsed = await parser.parse(binaryStl(TILE_FACETS).buffer)

    expect(parsed.triangles).toBe(12)
    expect(parsed.format).toBe('binary')
    expect(parsed.parseMs).toBe(4.2)
    parser.terminate()
  })

  it('parses an ASCII buffer through the same path', async () => {
    const parser = createStlParser(fakeWorker)
    const parsed = await parser.parse(asciiStl(box(2, 3, 4)).buffer)

    expect(parsed.format).toBe('ascii')
    expect(parsed.triangles).toBe(12)
    parser.terminate()
  })

  it('takes ownership: the caller’s buffer is detached, not copied', async () => {
    const parser = createStlParser(fakeWorker)
    const bytes = binaryStl(TILE_FACETS).buffer
    const before = bytes.byteLength

    await parser.parse(bytes)

    expect(before).toBe(84 + 12 * 50)
    expect(bytes.byteLength).toBe(0)
    parser.terminate()
  })

  it('returns the zero-triangle file as a successful parse', async () => {
    const parser = createStlParser(fakeWorker)
    const parsed = await parser.parse(EMPTY_BINARY_STL.slice().buffer)

    expect(parsed.triangles).toBe(0)
    parser.terminate()
  })

  it('rejects with the parse error’s kind', async () => {
    const parser = createStlParser(fakeWorker)

    await expect(parser.parse(new TextEncoder().encode('not a mesh at all').buffer)).rejects.toThrow(
      StlWorkerError,
    )
    parser.terminate()
  })

  it('reuses one worker across parses', async () => {
    const factory = vi.fn(fakeWorker)
    const parser = createStlParser(factory)

    await parser.parse(binaryStl(box(1, 1, 1)).buffer)
    await parser.parse(binaryStl(box(2, 2, 2)).buffer)

    expect(factory).toHaveBeenCalledTimes(1)
    parser.terminate()
  })

  it('terminates the worker when the parse is aborted', async () => {
    const worker = fakeWorker()
    const parser = createStlParser(() => worker)
    const controller = new AbortController()

    const pending = parser.parse(binaryStl(TILE_FACETS).buffer, controller.signal)
    controller.abort()

    await expect(pending).rejects.toThrow(/cancelled/)
    expect(worker.terminated).toBe(true)
  })

  it('refuses an already-aborted signal without spawning a worker', async () => {
    const factory = vi.fn(fakeWorker)
    const parser = createStlParser(factory)

    await expect(
      parser.parse(binaryStl(box(1, 1, 1)).buffer, AbortSignal.abort()),
    ).rejects.toThrow(StlWorkerError)
    expect(factory).not.toHaveBeenCalled()
  })
})
