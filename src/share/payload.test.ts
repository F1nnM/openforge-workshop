/**
 * The wire format, in isolation from compression and from the catalog.
 *
 * Node environment: nothing here needs a stream, and keeping the format's own
 * tests synchronous means a failure points at a byte offset rather than at a
 * promise. The async half lives in `link.test.ts`.
 *
 * What is asserted, and why each one is here rather than left to the integration
 * test above it:
 *
 *   - **Exactness.** Every value the app can produce, plus the ones it cannot yet,
 *     survives a round trip bit for bit. A codec that is lossy by a quarter unit
 *     is the failure mode this PR exists to prevent, and it is invisible at the
 *     level of "the link opened".
 *   - **Totality under corruption.** Truncation at every prefix length, and bytes
 *     that are structurally impossible. The reader must fail, and must fail with a
 *     typed error rather than an out-of-bounds read that yields a number.
 *   - **The lock wire order.** The one constant here that cannot be re-derived
 *     from anything, and whose silent breakage would change the joinery of every
 *     link already shared.
 */
import { describe, expect, it } from 'vitest'

import { LockSystem } from '@/store'

import { ByteReader, ByteWriter, MalformedPayloadError, TruncatedPayloadError } from './bytes'
import type { WirePayload, WirePlacement } from './payload'
import { LOCK_ORDER, MAX_SHARE_PLACEMENTS, SHARE_FORMAT_VERSION, decodePayload, encodePayload } from './payload'

function payload(placements: readonly WirePlacement[], overrides: Partial<WirePayload> = {}): WirePayload {
  return { manifestVersion: 1, lockIndex: 0, digest: 0xdeadbeef, placements, ...overrides }
}

const ROOM: readonly WirePlacement[] = [
  { ordinal: 0, x: 0, z: 0, rotation: 0 },
  { ordinal: 8701, x: -12.5, z: 40.5, rotation: 270 },
  { ordinal: 4321, x: 3.5, z: -0.5, rotation: 11.25 },
  { ordinal: 4321, x: 3.5, z: -0.5, rotation: 348.75 },
]

describe('byte primitives', () => {
  it('round-trips varints across the byte-length boundaries', () => {
    const values = [0, 1, 127, 128, 129, 16_383, 16_384, 2 ** 21, 2 ** 28, Number.MAX_SAFE_INTEGER]
    const writer = new ByteWriter()
    for (const value of values) writer.uvar(value)
    const reader = new ByteReader(writer.bytes())
    expect(values.map(() => reader.uvar())).toEqual(values)
    expect(reader.atEnd).toBe(true)
  })

  it('round-trips zigzag integers on both sides of zero', () => {
    const values = [0, -1, 1, -63, 64, -8192, 8192, -(2 ** 30), 2 ** 30]
    const writer = new ByteWriter()
    for (const value of values) writer.zigzag(value)
    const reader = new ByteReader(writer.bytes())
    expect(values.map(() => reader.zigzag())).toEqual(values)
  })

  it('round-trips float64 exactly, including the awkward values', () => {
    const values = [0.1, -0.1, 1 / 3, Number.MIN_VALUE, Number.MAX_VALUE, Infinity, -Infinity]
    const writer = new ByteWriter()
    for (const value of values) writer.f64(value)
    const reader = new ByteReader(writer.bytes())
    expect(values.map(() => reader.f64())).toEqual(values)
  })

  it('throws rather than reading past the end', () => {
    const reader = new ByteReader(new Uint8Array([0x80]))
    expect(() => reader.uvar()).toThrow(TruncatedPayloadError)
  })

  it('refuses a varint that never terminates', () => {
    const reader = new ByteReader(new Uint8Array(Array.from({ length: 12 }, () => 0x80)))
    expect(() => reader.uvar()).toThrow(MalformedPayloadError)
  })
})

describe('lock wire order', () => {
  it('covers every lock system exactly once', () => {
    expect([...LOCK_ORDER].sort()).toEqual([...LockSystem.options].sort())
    expect(LOCK_ORDER.length).toBe(new Set(LOCK_ORDER).size)
  })

  it('is the frozen order every existing link was written against', () => {
    // Append only. Reordering this array changes the lock system every link
    // already in the wild resolves with, which changes the joinery of the STLs it
    // downloads — with no error anywhere. A new system goes on the end.
    expect(LOCK_ORDER).toEqual(['openlock', 'dragonlock', 'magnetic'])
  })
})

describe('payload round trip', () => {
  it('is exact for a realistic scene', () => {
    const decoded = decodePayload(encodePayload(payload(ROOM)))
    expect(decoded).toEqual(payload(ROOM))
  })

  it('is exact for an empty scene', () => {
    const decoded = decodePayload(encodePayload(payload([])))
    expect(decoded).toEqual(payload([]))
    expect(encodePayload(payload([])).length).toBe(9)
  })

  it('carries the manifest version and the lock index verbatim', () => {
    for (const manifestVersion of [0, 1, 7, 4096]) {
      for (let lockIndex = 0; lockIndex < LOCK_ORDER.length; lockIndex += 1) {
        const source = payload(ROOM, { manifestVersion, lockIndex })
        expect(decodePayload(encodePayload(source))).toEqual(source)
      }
    }
  })

  it('carries a 32-bit digest without truncating the high bit', () => {
    for (const digest of [0, 1, 0x7fffffff, 0x80000000, 0xffffffff]) {
      const source = payload(ROOM, { digest })
      expect(decodePayload(encodePayload(source)).digest).toBe(digest)
    }
  })

  it('preserves every rotation the corpus can produce', () => {
    // The observed `size|angle` values, and every multiple of the finest of them.
    const steps = [90, 45, 22.5, 11.25, 60, 120, 240, 300, 270]
    const rotations = new Set<number>([0])
    for (const step of steps) {
      for (let turn = 0; turn * step < 360; turn += 1) rotations.add(turn * step)
    }
    const placements = [...rotations].map((rotation, index) => ({ ordinal: index, x: 0, z: 0, rotation }))
    expect(decodePayload(encodePayload(payload(placements))).placements).toEqual(placements)
  })

  it('preserves half-unit positions over a large plan', () => {
    const placements: WirePlacement[] = []
    for (let step = -200; step <= 200; step += 1) {
      // `+ 0` because `-0 / 2` is `-0`, and the codec canonicalises that to `+0`
      // exactly as `Placement`'s own coordinate transform does — see the `-0` test
      // below. A fixture holding `-0` would be asserting the opposite.
      placements.push({ ordinal: 1, x: step / 2 + 0, z: -step / 2 + 0, rotation: 0 })
    }
    expect(decodePayload(encodePayload(payload(placements))).placements).toEqual(placements)
  })

  it('falls back to exact float64 for a position off the half-unit grid', () => {
    // `Placement` validates any finite coordinate, so a finer snap mode is legal
    // input the day it ships. Quantising it would move the tile silently.
    const placements = [{ ordinal: 5, x: 0.25, z: 1 / 3, rotation: 0 }]
    const bytes = encodePayload(payload(placements))
    expect(decodePayload(bytes).placements).toEqual(placements)
    // Both position columns escape; the rotation column stays quantised.
    expect(bytes[1]).toBe(0b011)
  })

  it('falls back to exact float64 for a rotation off the quarter-degree grid', () => {
    const placements = [{ ordinal: 5, x: 1, z: 2, rotation: 33.7 }]
    const bytes = encodePayload(payload(placements))
    expect(decodePayload(bytes).placements).toEqual(placements)
    expect(bytes[1]).toBe(0b100)
  })

  it('keeps the columns independent when only one of them escapes', () => {
    const placements = [{ ordinal: 5, x: 0.25, z: 2, rotation: 90 }]
    const bytes = encodePayload(payload(placements))
    expect(bytes[1]).toBe(0b001)
    expect(decodePayload(bytes).placements).toEqual(placements)
  })

  it('normalises -0 to 0 so a round trip compares equal', () => {
    const decoded = decodePayload(encodePayload(payload([{ ordinal: 1, x: -0, z: -0, rotation: 0 }])))
    expect(Object.is(decoded.placements[0]?.x, 0)).toBe(true)
    expect(Object.is(decoded.placements[0]?.z, 0)).toBe(true)
  })

  it('stamps the current format version', () => {
    expect(encodePayload(payload(ROOM))[0]).toBe(SHARE_FORMAT_VERSION)
  })
})

describe('payload refuses input it cannot represent', () => {
  it('rejects a lock index that does not fit one byte', () => {
    expect(() => encodePayload(payload(ROOM, { lockIndex: 300 }))).toThrow(MalformedPayloadError)
    expect(() => encodePayload(payload(ROOM, { lockIndex: -1 }))).toThrow(MalformedPayloadError)
  })

  it('rejects a negative ordinal', () => {
    expect(() => encodePayload(payload([{ ordinal: -1, x: 0, z: 0, rotation: 0 }]))).toThrow(MalformedPayloadError)
  })
})

describe('payload decode is total under corruption', () => {
  const good = encodePayload(payload(ROOM))

  it('fails, without hanging or reading out of bounds, at every truncation', () => {
    for (let length = 0; length < good.length; length += 1) {
      const cut = good.subarray(0, length)
      let thrown: unknown
      try {
        decodePayload(cut)
      } catch (error) {
        thrown = error
      }
      expect(
        thrown instanceof TruncatedPayloadError || thrown instanceof MalformedPayloadError,
        `truncation to ${String(length)} bytes should be reported, got ${String(thrown)}`,
      ).toBe(true)
    }
  })

  it('rejects a format version it does not read rather than reading the fields anyway', () => {
    const wrong = Uint8Array.from(good)
    wrong[0] = SHARE_FORMAT_VERSION + 1
    expect(() => decodePayload(wrong)).toThrow(MalformedPayloadError)
  })

  it('rejects unknown flag bits', () => {
    const wrong = Uint8Array.from(good)
    wrong[1] = 0b1000
    expect(() => decodePayload(wrong)).toThrow(MalformedPayloadError)
  })

  it('rejects a count larger than the bytes that follow it', () => {
    const wrong = Uint8Array.from(good)
    wrong[4] = 0x7f
    expect(() => decodePayload(wrong)).toThrow(MalformedPayloadError)
  })

  it('rejects an absurd count without allocating for it', () => {
    const writer = new ByteWriter()
    writer.u8(SHARE_FORMAT_VERSION)
    writer.u8(0)
    writer.uvar(1)
    writer.u8(0)
    writer.uvar(MAX_SHARE_PLACEMENTS + 1)
    for (let i = 0; i < 4; i += 1) writer.u8(0)
    expect(() => decodePayload(writer.bytes())).toThrow(MalformedPayloadError)
  })

  it('rejects trailing bytes rather than ignoring them', () => {
    const longer = new Uint8Array(good.length + 1)
    longer.set(good)
    expect(() => decodePayload(longer)).toThrow(MalformedPayloadError)
  })

  it('never throws anything but its own two errors, for arbitrary garbage', () => {
    let seed = 7
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed
    }
    for (let attempt = 0; attempt < 2000; attempt += 1) {
      const bytes = new Uint8Array(random() % 64)
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = random() % 256
      try {
        decodePayload(bytes)
      } catch (error) {
        expect(error instanceof TruncatedPayloadError || error instanceof MalformedPayloadError).toBe(true)
      }
    }
  })
})
