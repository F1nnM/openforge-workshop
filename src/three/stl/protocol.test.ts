/**
 * The transfer, asserted — because a copy works and is merely slow.
 *
 * `structuredClone(value, { transfer })` is the same algorithm `postMessage` uses,
 * so cloning through it here reproduces exactly what crossing a thread boundary
 * would do to these buffers: a transferred one is **detached** afterwards and
 * reads `byteLength === 0`, a cloned one is untouched. That is the only
 * observable difference between the two, and it is the whole test.
 */
import { describe, expect, it } from 'vitest'

import { parseStl } from './parse'
import { TILE_FACETS, binaryStl } from './fixtures'
import { failedResponse, fromResponse, parsedResponse, parseRequest } from './protocol'

describe('parseRequest', () => {
  it('puts the source buffer in the transfer list', () => {
    const bytes = binaryStl(TILE_FACETS).buffer
    const posted = parseRequest(bytes)

    expect(posted.message.type).toBe('parse')
    expect(posted.transfer).toEqual([bytes])
  })

  it('detaches the sender’s buffer when posted', () => {
    const bytes = binaryStl(TILE_FACETS).buffer
    const before = bytes.byteLength
    const { message, transfer } = parseRequest(bytes)

    structuredClone(message, { transfer: [...transfer] })

    expect(before).toBeGreaterThan(0)
    expect(bytes.byteLength).toBe(0)
  })
})

describe('parsedResponse', () => {
  it('transfers the positions buffer rather than copying it', () => {
    const parsed = parseStl(binaryStl(TILE_FACETS))
    const { message, transfer } = parsedResponse(parsed, 1.5)

    expect(transfer).toEqual([parsed.positions.buffer])

    const received = structuredClone(message, { transfer: [...transfer] })

    // The worker's copy is gone …
    expect(parsed.positions.byteLength).toBe(0)
    // … and the receiver has the same 12 facets, without a second allocation.
    expect(received.triangles).toBe(12)
    expect(received.positions).toHaveLength(12 * 9)
    expect(received.parseMs).toBe(1.5)
  })

  it('round-trips back into a ParsedStl', () => {
    const parsed = parseStl(binaryStl(TILE_FACETS))
    const expected = [...parsed.positions]
    const { message, transfer } = parsedResponse(parsed, 0)

    const rebuilt = fromResponse(structuredClone(message, { transfer: [...transfer] }))

    expect(rebuilt.format).toBe('binary')
    expect(rebuilt.triangles).toBe(12)
    expect([...rebuilt.positions]).toEqual(expected)
  })
})

describe('failedResponse', () => {
  it('carries the parse error’s kind through', () => {
    const { message, transfer } = failedResponse(
      Object.assign(new Error('short'), { kind: 'truncated' }),
    )
    expect(message).toEqual({ type: 'failed', kind: 'truncated', message: 'short' })
    expect(transfer).toEqual([])
  })

  it('falls back to unknown for a non-Error', () => {
    expect(failedResponse('exploded').message).toEqual({
      type: 'failed',
      kind: 'unknown',
      message: 'exploded',
    })
  })
})
