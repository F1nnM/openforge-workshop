/**
 * The protocol, and the one thing about it that is invisible when wrong.
 *
 * A `postMessage` without a transfer list works. It structured-clones the
 * buffer, the app functions, and the only symptom is a stutter — for the
 * corpus's median mesh, 12.9 MB allocated and memcpy'd on the receiving thread
 * at the exact moment it is about to build a geometry. So the transfer is
 * asserted by checking the buffer is **detached** afterwards, which is the only
 * observable difference between a transfer and a copy.
 */
import { describe, expect, it } from 'vitest'

import { convertRequest, convertedResponse, convertFailedResponse, narrowIndices } from './protocol'
import { WeldNoOpError } from './weld'

/** Post a message the way a real `postMessage` would, to detach the transfer list. */
function post(transfer: readonly Transferable[]): void {
  // `structuredClone` with a transfer list detaches exactly what a
  // `postMessage` would, without needing a second realm.
  structuredClone({}, { transfer: transfer as Transferable[] })
}

describe('convertRequest', () => {
  it('puts the source buffer in the transfer list', () => {
    const bytes = new Uint8Array(1_024).buffer
    const { message, transfer } = convertRequest('abc', bytes)

    expect(message.type).toBe('convert')
    expect(message.blob).toBe('abc')
    expect(transfer).toEqual([bytes])

    expect(bytes.byteLength).toBe(1_024)
    post(transfer)
    // Detached. If `transfer` were empty this would still read 1,024 and the
    // only difference would be a 1 kB copy — 10.77 MB in production.
    expect(bytes.byteLength).toBe(0)
  })
})

describe('convertedResponse', () => {
  const mesh = () => ({
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint16Array([0, 1, 2]),
    triangles: 1,
    vertices: 3,
    sourceTriangles: 1,
    sourceBytes: 134,
    format: 'binary' as const,
    droppedTriangles: 0,
    weld: { before: 3, after: 3, ratio: 1 },
    target: 1,
    passThrough: true,
    attempts: 0,
    areaError: 0,
    extentError: 0,
    timing: { parseMs: 1, weldMs: 1, simplifyMs: 0 },
  })

  it('transfers both arrays out of the worker', () => {
    const source = mesh()
    const { message, transfer } = convertedResponse('abc', source, 12)

    expect(message.type).toBe('converted')
    expect(message.blob).toBe('abc')
    expect(message.totalMs).toBe(12)
    expect(transfer).toHaveLength(2)

    post(transfer)
    expect(source.positions.buffer.byteLength).toBe(0)
    expect(source.indices.buffer.byteLength).toBe(0)
  })

  it('flattens the timing so the message stays a plain record', () => {
    const { message } = convertedResponse('abc', mesh(), 12)
    expect(message.parseMs).toBe(1)
    expect(message.weldMs).toBe(1)
    expect(message.simplifyMs).toBe(0)
  })
})

describe('convertFailedResponse', () => {
  it('carries the error name, so a caller can branch without matching text', () => {
    const { message, transfer } = convertFailedResponse('abc', new WeldNoOpError(354, 326, 0.5))
    expect(message.type).toBe('convert-failed')
    expect(message.kind).toBe('WeldNoOpError')
    expect(message.message).toContain('0.9209×')
    expect(transfer).toEqual([])
  })

  it('survives something that is not an Error', () => {
    const { message } = convertFailedResponse('abc', 'the worker exploded')
    expect(message.kind).toBe('unknown')
    expect(message.message).toBe('the worker exploded')
  })
})

describe('narrowIndices', () => {
  it('halves the index for every mesh in the band', () => {
    // The ceiling is 20,000 triangles over ~10,000 welded vertices, so every
    // in-band LOD fits in 16 bits. `lod.ts`'s memory budget assumes exactly
    // this, which is why it is done here and not left to the GPU driver.
    const narrowed = narrowIndices(new Uint32Array([0, 1, 2, 9_999]), 10_000)
    expect(narrowed).toBeInstanceOf(Uint16Array)
    expect([...narrowed]).toEqual([0, 1, 2, 9_999])
  })

  it('keeps 32 bits when a mesh genuinely needs them', () => {
    // The pass-through path: a 65,537-vertex mesh under the triangle ceiling is
    // possible for an open surface, and narrowing it would wrap silently.
    const kept = narrowIndices(new Uint32Array([0, 70_000]), 70_001)
    expect(kept).toBeInstanceOf(Uint32Array)
    expect([...kept]).toEqual([0, 70_000])
  })

  it('draws the line where 16 bits actually run out', () => {
    expect(narrowIndices(new Uint32Array([0]), 65_536)).toBeInstanceOf(Uint16Array)
    expect(narrowIndices(new Uint32Array([0]), 65_537)).toBeInstanceOf(Uint32Array)
  })
})
