/**
 * The main-thread side of the worker, driven by a scripted worker.
 *
 * The worker here is a test double and says so: it is an `EventTarget` that
 * replies with whatever the test told it to. What it is standing in for is the
 * browser's `Worker`, not this row's code — `convert.ts` is exercised for real
 * in `convert.test.ts` and through a real conversion in `queue.test.ts`. What
 * *is* under test is the four things this client does that a real worker cannot
 * be made to do on demand: serialise overlapping requests, reject a reply that
 * answers the wrong blob, survive an `error` event, and honour an abort.
 *
 * The blob-mismatch case is the one that would otherwise be a silent
 * catastrophe. A worker has one `onmessage`; two overlapping requests race for
 * it, and a client that resolved with whatever arrived would put mesh A's
 * geometry in the cache under mesh B's content address. That is the one thing a
 * content-addressed cache may never do, so it rejects, and the rejection is
 * asserted here by deliberately replying about the wrong blob.
 */
import { describe, expect, it, vi } from 'vitest'

import { MeshConvertError, createMeshConverter } from './client'
import type { ConvertResponse } from './protocol'

/** A `Worker`-shaped double whose replies the test writes. */
class ScriptedWorker extends EventTarget {
  readonly posted: { blob: string; bytes: number }[] = []
  terminated = 0
  /** Called with each request; return the reply to post, or `null` to stay silent. */
  reply: (blob: string) => ConvertResponse | null = (blob) => ok(blob)

  postMessage(message: { blob: string; bytes: ArrayBuffer }, transfer: Transferable[]): void {
    this.posted.push({ blob: message.blob, bytes: message.bytes.byteLength })
    // A real `postMessage` detaches the transfer list; the client documents that
    // it takes ownership, so the double has to behave the same way or the test
    // would not catch a caller that reused the buffer.
    structuredClone({}, { transfer })
    const response = this.reply(message.blob)
    if (response === null) return
    queueMicrotask(() => {
      this.dispatchEvent(new MessageEvent('message', { data: response }))
    })
  }

  terminate(): void {
    this.terminated += 1
  }
}

function ok(blob: string): ConvertResponse {
  return {
    type: 'converted',
    blob,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint16Array([0, 1, 2]),
    triangles: 1,
    vertices: 3,
    sourceTriangles: 1,
    sourceBytes: 134,
    format: 'binary',
    droppedTriangles: 0,
    weld: { before: 3, after: 3, ratio: 1 },
    target: 1,
    passThrough: true,
    attempts: 0,
    areaError: 0,
    extentError: 0,
    parseMs: 1,
    weldMs: 1,
    simplifyMs: 0,
    totalMs: 2,
  }
}

function converterOver(worker: ScriptedWorker) {
  return createMeshConverter(() => worker as unknown as Worker)
}

describe('createMeshConverter', () => {
  it('spawns one worker and reuses it', async () => {
    const worker = new ScriptedWorker()
    const spawn = vi.fn(() => worker as unknown as Worker)
    const converter = createMeshConverter(spawn)

    await converter.convert('aaa', new ArrayBuffer(16))
    await converter.convert('bbb', new ArrayBuffer(16))

    expect(spawn).toHaveBeenCalledTimes(1)
    expect(worker.posted.map((one) => one.blob)).toEqual(['aaa', 'bbb'])
  })

  it('serialises overlapping requests instead of racing for one onmessage', async () => {
    const worker = new ScriptedWorker()
    const converter = converterOver(worker)

    const both = await Promise.all([
      converter.convert('aaa', new ArrayBuffer(16)),
      converter.convert('bbb', new ArrayBuffer(16)),
    ])

    expect(both.map((one) => one.blob)).toEqual(['aaa', 'bbb'])
    // The second request is not posted until the first has settled, which is
    // the mechanism: one request in flight, always.
    expect(worker.posted.map((one) => one.blob)).toEqual(['aaa', 'bbb'])
  })

  it('does not let a failed conversion poison the queue behind it', async () => {
    const worker = new ScriptedWorker()
    worker.reply = (blob) =>
      blob === 'bad'
        ? { type: 'convert-failed', blob, kind: 'WeldNoOpError', message: 'nothing merged' }
        : ok(blob)
    const converter = converterOver(worker)

    const failing = converter.convert('bad', new ArrayBuffer(16))
    const following = converter.convert('good', new ArrayBuffer(16))

    await expect(failing).rejects.toThrow(MeshConvertError)
    await expect(following).resolves.toMatchObject({ blob: 'good' })
  })

  it('rejects a reply that answers the wrong blob, rather than caching it', async () => {
    const worker = new ScriptedWorker()
    worker.reply = () => ok('somebody-else')
    const converter = converterOver(worker)

    await expect(converter.convert('mine', new ArrayBuffer(16))).rejects.toThrow(
      /replied about somebody-else while mine was in flight/,
    )
    // And the worker is terminated: a client whose serialisation has broken
    // cannot be trusted to answer the next request either.
    expect(worker.terminated).toBe(1)
  })

  it('reports a worker that dies mid-conversion instead of hanging', async () => {
    const worker = new ScriptedWorker()
    worker.reply = () => null
    const converter = converterOver(worker)

    const pending = converter.convert('aaa', new ArrayBuffer(16))
    // `convert` chains onto the serialisation tail, so the request is posted a
    // microtask later; the listener does not exist before then.
    await Promise.resolve()
    // An OOM inside the weld surfaces as an `error` event and nowhere else.
    // Node has no `ErrorEvent`, so the shape the client reads is built directly.
    worker.dispatchEvent(Object.assign(new Event('error'), { message: 'out of memory' }))

    await expect(pending).rejects.toThrow(/out of memory/)
    expect(worker.terminated).toBe(1)
  })

  it('terminates on abort, because a cancelled conversion is still burning a core', async () => {
    const worker = new ScriptedWorker()
    worker.reply = () => null
    const converter = converterOver(worker)
    const controller = new AbortController()

    const pending = converter.convert('aaa', new ArrayBuffer(16), controller.signal)
    // After the request is actually in flight. Aborting before it is posted
    // takes the other branch, which the next case covers.
    await Promise.resolve()
    controller.abort()

    await expect(pending).rejects.toThrow(/the conversion was cancelled/)
    expect(worker.terminated).toBe(1)
  })

  it('refuses a request whose signal is already aborted, without spawning', async () => {
    const spawn = vi.fn(() => new ScriptedWorker() as unknown as Worker)
    const converter = createMeshConverter(spawn)
    const controller = new AbortController()
    controller.abort()

    await expect(converter.convert('aaa', new ArrayBuffer(16), controller.signal)).rejects.toThrow(
      /before it started/,
    )
    expect(spawn).not.toHaveBeenCalled()
  })

  it('takes ownership of the buffer it is given', async () => {
    const worker = new ScriptedWorker()
    const converter = converterOver(worker)
    const bytes = new ArrayBuffer(1_024)

    await converter.convert('aaa', bytes)
    // Detached. Documented, and asserted, because a caller that reused this
    // buffer would silently convert an empty mesh.
    expect(bytes.byteLength).toBe(0)
  })

  it('is idempotent about terminate', () => {
    const worker = new ScriptedWorker()
    const converter = converterOver(worker)
    converter.terminate()
    converter.terminate()
    expect(worker.terminated).toBe(0)
  })
})
