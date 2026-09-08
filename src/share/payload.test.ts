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
 *   - **The variable-arity half row A1 introduced.** An instance's fill count is
 *     the first field in this format whose value decides how many *other* fields
 *     follow, so the guards around it are the ones with a new failure mode behind
 *     them: a claimed count that nothing bounds, and a bitset whose last byte has
 *     bits nobody wrote.
 */
import { describe, expect, it } from 'vitest'

import { LockSystem } from '@/store'

import { ByteReader, ByteWriter, MalformedPayloadError, TruncatedPayloadError } from './bytes'
import type { WireInstance, WirePayload } from './payload'
import {
  LOCK_ORDER,
  MAX_SHARE_FILLS,
  MAX_SHARE_PLACEMENTS,
  MAX_SHARE_TABLE,
  SHARE_FORMAT_VERSION,
  decodePayload,
  encodePayload,
} from './payload'

/**
 * Two real template ids and the six real slot names.
 *
 * Taken from `src/screens/assemblies/templates.ts` rather than invented, because
 * the two things the tables cost are the *length* of a template id (mean 41.0
 * characters over the 40 shipped, 51 at the widest) and the fact that two of the
 * six slot names contain a space. A fixture of `'t1'` and `'a'` would measure
 * neither. Not imported: this module is deliberately ignorant of the catalog, and
 * the template table lives beside a screen.
 */
const TEMPLATES: readonly string[] = [
  's2w-wall-on-tile-corner-low-single-piece',
  's2w-wall-on-tile-internal-corner-low-modular',
]
const SLOTS: readonly string[] = ['base', 'column', 'floor', 'left wall', 'right wall', 'wall']

/**
 * Two filter sets and the empty one, `NUL`-joined as the wire carries them.
 *
 * Entry 0 is *any on every axis* and is the ordinary case; the other two are a
 * real component position of the folded wall assembly, one of them with its size
 * as well, so the table holds one short entry and one long one.
 */
const FILTERS: readonly string[] = [
  '',
  'component|door|arched',
  ['component|door|arched', 'size|width|2', 'size|depth|2'].join('\u0000'),
]

function payload(instances: readonly WireInstance[], overrides: Partial<WirePayload> = {}): WirePayload {
  return {
    manifestVersion: 1,
    lockIndex: 0,
    digest: 0xdeadbeef,
    templates: TEMPLATES,
    slots: SLOTS,
    filters: FILTERS,
    instances,
    recipes: [],
    generated: [],
    ...overrides,
  }
}

/** An instance at `x`/`z` with `arity` fills, ordinals ascending from `ordinal`. */
function instance(arity: number, ordinal: number, x: number, z: number, rotation: number): WireInstance {
  return {
    template: arity === 5 ? 1 : 0,
    // Cycled over the three entries, so the filter column is neither constant
    // nor one-to-one with the template column.
    filters: ordinal % 3,
    x,
    z,
    rotation,
    fills: Array.from({ length: arity }, (_unused, index) => ({
      slot: index,
      ordinal: ordinal + index,
      // Every third fill pinned, so the bitset is neither all zeros nor all ones
      // and the byte boundary falls inside an instance at arity 3 and 5 both.
      pinned: (ordinal + index) % 3 === 0,
    })),
  }
}

/**
 * A realistic scene: the corpus's two arities, both edges of the ordinal range,
 * the finest rotation the corpus carries, and two instances of one template.
 */
const ROOM: readonly WireInstance[] = [
  instance(3, 0, 0, 0, 0),
  instance(5, 8697, -12.5, 40.5, 270),
  instance(3, 4321, 3.5, -0.5, 11.25),
  instance(3, 4321, 3.5, -0.5, 348.75),
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
    const empty = payload([], { templates: [], slots: [], filters: [] })
    expect(decodePayload(encodePayload(empty))).toEqual(empty)
    // Nine bytes of header, then the five zero counts that open the three string
    // tables, the recipe table and the generated column.
    expect(encodePayload(empty).length).toBe(14)
  })

  it('carries a table entry no instance names', () => {
    // An encoder does not produce one, but the format permits it and a decoder
    // must not quietly renumber the table it was given.
    const source = payload([instance(3, 10, 1, 1, 0)], { templates: [...TEMPLATES, 'unused-family'] })
    expect(decodePayload(encodePayload(source))).toEqual(source)
  })

  it('carries an instance with no filled slots at all', () => {
    // Contract C-g: a template with no candidate for a part places anyway. A
    // template with no candidate for *any* part is the same statement, and the
    // format has to be able to say it — the fill count column reads zero and the
    // bitset is empty.
    const source = payload([{ template: 0, filters: 0, x: 2, z: 3, rotation: 90, fills: [] }])
    expect(decodePayload(encodePayload(source))).toEqual(source)
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

  it('keeps each instance’s fills with that instance, at mixed arity', () => {
    // The flat columns are the hazard row A1 introduced: three columns of fills
    // are re-split by the fill count column, so an off-by-one there would hand
    // one instance's floor to the next one — a plausible wrong room, with no
    // error. Mixed arities in one payload are what make that visible.
    const source = payload([instance(5, 100, 0, 0, 0), instance(3, 200, 1, 0, 0), instance(5, 300, 2, 0, 0)])
    const decoded = decodePayload(encodePayload(source))
    expect(decoded.instances.map((entry) => entry.fills.length)).toEqual([5, 3, 5])
    expect(decoded.instances.map((entry) => entry.fills.map((fill) => fill.ordinal))).toEqual([
      [100, 101, 102, 103, 104],
      [200, 201, 202],
      [300, 301, 302, 303, 304],
    ])
    expect(decoded).toEqual(source)
  })

  it('carries the pinned bit across every byte boundary', () => {
    // One instance per length from 1 to 20 fills, so the bitset's last byte is
    // partial at every possible width, and the pattern is not periodic in 8.
    for (let arity = 1; arity <= 20; arity += 1) {
      const fills = Array.from({ length: arity }, (_unused, index) => ({
        slot: index % SLOTS.length,
        ordinal: index,
        pinned: index % 5 === 1 || index % 7 === 3,
      }))
      const source = payload([{ template: 0, filters: 0, x: 0, z: 0, rotation: 0, fills }])
      expect(decodePayload(encodePayload(source)).instances[0]?.fills).toEqual(fills)
    }
  })

  it('preserves every rotation the corpus can produce', () => {
    // The observed `size|angle` values, and every multiple of the finest of them.
    const steps = [90, 45, 22.5, 11.25, 60, 120, 240, 300, 270]
    const rotations = new Set<number>([0])
    for (const step of steps) {
      for (let turn = 0; turn * step < 360; turn += 1) rotations.add(turn * step)
    }
    const instances = [...rotations].map((rotation, index) => instance(3, index, 0, 0, rotation))
    expect(decodePayload(encodePayload(payload(instances))).instances).toEqual(instances)
  })

  it('preserves half-unit positions over a large plan', () => {
    const instances: WireInstance[] = []
    for (let step = -200; step <= 200; step += 1) {
      // `+ 0` because `-0 / 2` is `-0`, and the codec canonicalises that to `+0`
      // exactly as `TemplateInstance`'s own coordinate transform does — see the
      // `-0` test below. A fixture holding `-0` would be asserting the opposite.
      instances.push(instance(3, 1, step / 2 + 0, -step / 2 + 0, 0))
    }
    expect(decodePayload(encodePayload(payload(instances))).instances).toEqual(instances)
  })

  it('falls back to exact float64 for a position off the half-unit grid', () => {
    // `TemplateInstance` validates any finite coordinate, so a finer snap mode is
    // legal input the day it ships. Quantising it would move the instance
    // silently.
    const instances = [instance(3, 5, 0.25, 1 / 3, 0)]
    const bytes = encodePayload(payload(instances))
    expect(decodePayload(bytes).instances).toEqual(instances)
    // Both position columns escape; the rotation column stays quantised.
    expect(bytes[1]).toBe(0b011)
  })

  it('falls back to exact float64 for a rotation off the quarter-degree grid', () => {
    const instances = [instance(3, 5, 1, 2, 33.7)]
    const bytes = encodePayload(payload(instances))
    expect(decodePayload(bytes).instances).toEqual(instances)
    expect(bytes[1]).toBe(0b100)
  })

  it('keeps the columns independent when only one of them escapes', () => {
    const instances = [instance(3, 5, 0.25, 2, 90)]
    const bytes = encodePayload(payload(instances))
    expect(bytes[1]).toBe(0b001)
    expect(decodePayload(bytes).instances).toEqual(instances)
  })

  it('normalises -0 to 0 so a round trip compares equal', () => {
    const decoded = decodePayload(encodePayload(payload([instance(3, 1, -0, -0, 0)])))
    expect(Object.is(decoded.instances[0]?.x, 0)).toBe(true)
    expect(Object.is(decoded.instances[0]?.z, 0)).toBe(true)
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
    const fills = [{ slot: 0, ordinal: -1, pinned: false }]
    expect(() => encodePayload(payload([{ template: 0, filters: 0, x: 0, z: 0, rotation: 0, fills }]))).toThrow(
      MalformedPayloadError,
    )
  })

  it('rejects an index off the end of the table it names', () => {
    // Both directions of the same mistake, and they are the reason the encoder
    // checks at all: the tables are built by `link.ts` from the same scene, so a
    // stale index here is a bug in the caller and not user data.
    const bad = { template: TEMPLATES.length, filters: 0, x: 0, z: 0, rotation: 0, fills: [] }
    expect(() => encodePayload(payload([bad]))).toThrow(MalformedPayloadError)
    const fills = [{ slot: SLOTS.length, ordinal: 1, pinned: false }]
    expect(() => encodePayload(payload([{ template: 0, filters: 0, x: 0, z: 0, rotation: 0, fills }]))).toThrow(
      MalformedPayloadError,
    )
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
    // Bit 6, the lowest bit no flag claims. Bits 0-2 are the instance columns'
    // exact escape hatch and bits 3-5 the generated columns', so this assertion
    // has to move up as the byte fills - and it must be a *reserved* bit, because
    // a known one is a legal payload rather than a rejected one. That is not
    // hypothetical: format 2 took bit 3, and this test caught the stale 0b1000.
    const wrong = Uint8Array.from(good)
    wrong[1] = 0b100_0000
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

  it('rejects a fill count column that claims more fills than the format carries', () => {
    // The guard row A1 made necessary: the instance count no longer bounds the
    // number of ordinals in the payload, so a header inside every other limit can
    // still claim half a billion fills. Two instances are enough to overflow the
    // total without either one exceeding what a `uvar` says innocently.
    const writer = new ByteWriter()
    writer.u8(SHARE_FORMAT_VERSION)
    writer.u8(0)
    writer.uvar(1)
    writer.u8(0)
    writer.uvar(2)
    for (let i = 0; i < 4; i += 1) writer.u8(0)
    writer.uvar(1)
    writer.utf8('family')
    writer.uvar(1)
    writer.utf8('floor')
    // The filter table: one entry, the empty set, which is what both instances
    // below index.
    writer.uvar(1)
    writer.utf8('')
    writer.uvar(0)
    writer.uvar(0)
    writer.uvar(0)
    writer.uvar(0)
    writer.zigzag(0)
    writer.zigzag(0)
    writer.zigzag(0)
    writer.zigzag(0)
    writer.uvar(0)
    writer.uvar(0)
    writer.uvar(MAX_SHARE_FILLS)
    writer.uvar(MAX_SHARE_FILLS)
    expect(() => decodePayload(writer.bytes())).toThrow(MalformedPayloadError)
  })

  it('rejects a string table larger than the format carries', () => {
    // The tables are the one place a payload claims a count of *strings*, so a
    // claimed count is a claim about far more than a byte each. Both tables go
    // through one reader, so one test covers both limits.
    const writer = new ByteWriter()
    writer.u8(SHARE_FORMAT_VERSION)
    writer.u8(0)
    writer.uvar(1)
    writer.u8(0)
    writer.uvar(0)
    for (let i = 0; i < 4; i += 1) writer.u8(0)
    writer.uvar(MAX_SHARE_TABLE + 1)
    expect(() => decodePayload(writer.bytes())).toThrow(MalformedPayloadError)
  })

  it('rejects a table count larger than the bytes that follow it', () => {
    // The cheaper of the two checks, and the one that catches almost every
    // corrupt header: a table entry costs at least its own length prefix.
    const writer = new ByteWriter()
    writer.u8(SHARE_FORMAT_VERSION)
    writer.u8(0)
    writer.uvar(1)
    writer.u8(0)
    writer.uvar(0)
    for (let i = 0; i < 4; i += 1) writer.u8(0)
    writer.uvar(64)
    writer.utf8('family')
    expect(() => decodePayload(writer.bytes())).toThrow(MalformedPayloadError)
  })

  it('rejects padding bits above the last pinned flag', () => {
    // Three fills, so five bits of the pinned byte are padding. Setting one of
    // them is a payload with two encodings, and the format has exactly one.
    const source = payload([instance(3, 1, 0, 0, 0)])
    const bytes = encodePayload(source)
    expect(decodePayload(bytes)).toEqual(source)

    // The bitset is the byte before the two zero counts that open the generated
    // half, which a three-fill scene reaches with no recipes.
    const pinnedAt = bytes.length - 3
    const wrong = Uint8Array.from(bytes)
    wrong[pinnedAt] = (wrong[pinnedAt] ?? 0) | 0b1000_0000
    expect(() => decodePayload(wrong)).toThrow(MalformedPayloadError)
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
