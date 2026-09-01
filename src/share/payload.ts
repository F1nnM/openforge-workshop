/**
 * The columnar wire format: a header, then one column per field.
 *
 * This module is deliberately ignorant of the catalog, the manifest and the
 * store. It maps a {@link WirePayload} — small numbers — to bytes and back,
 * synchronously. Everything that needs to know what a number *means* lives in
 * `link.ts`, which is also where the compression and the base64 live. Keeping the
 * split means the format can be exercised exhaustively in a plain node test with
 * no streams involved.
 *
 * ## Why columnar
 *
 * Placements share structure: a room is one floor tile repeated ninety times, one
 * wall tile repeated forty, and two rotations. Row-major layout interleaves those
 * repetitions with the coordinates, which are the only part that actually varies,
 * so deflate's back-references have to straddle changing bytes. Column-major puts
 * all ninety copies of the floor ordinal next to each other and all ninety
 * coordinates next to each other, and the match lengths go from ~4 bytes to
 * hundreds.
 *
 * Measured by `capacity.test.ts`, which prints this table on every run —
 * placements that fit inside a 2,000-character URL:
 *
 * | layout                      | room-shaped build | scattered build |
 * | --------------------------- | ----------------: | --------------: |
 * | naive JSON array of objects |               554 |             159 |
 * | columnar JSON               |            17,128 |             204 |
 * | row-major varint            |               760 |             235 |
 * | **columnar varint (this)**  |        **29,713** |         **243** |
 *
 * The two middle rows are there to separate the two effects, because they are not
 * the same size. **Layout** is what carries the room build: columnar JSON reaches
 * 17,128 against naive JSON's 554, a 31× gain from nothing but reordering the same
 * characters. **Representation** is what carries the scattered build: it is
 * essentially incompressible — `deflate-raw` returns *more* bytes than it was
 * given below about a hundred placements — so no layout helps, and the varint
 * packing lifts it from 159 to 235. Columnar varint takes both, and is the only
 * one of the four that is not last on either shape.
 *
 * Delta-coding the columns was measured during design and **rejected**: it gains
 * on the room build, which is already 15× past any URL length that matters, and
 * costs about 11% on the scattered build, which is the one that is actually tight.
 * The delta between two unrelated ordinals is usually wider than either ordinal.
 *
 * ## Layout
 *
 * ```text
 *   u8      format version          SHARE_FORMAT_VERSION
 *   u8      flags                   bit 0 x exact, bit 1 z exact, bit 2 rotation exact
 *   uvar    manifest version        CatalogFile.version.manifest
 *   u8      lock index              index into LOCK_ORDER
 *   uvar    count                   number of placements
 *   u8[4]   digest                  see manifest.ts, big-endian
 *   ordinal column                  count × uvar
 *   x column                        count × zigzag(x · 2)   or   count × f64
 *   z column                        count × zigzag(z · 2)   or   count × f64
 *   rotation column                 count × uvar(rot · 4)   or   count × f64
 * ```
 *
 * ## Quantisation, and why there is an exact escape hatch
 *
 * Positions are stored in **half grid units** and rotations in **quarter
 * degrees**, which covers every value the app can currently produce: §7 snaps the
 * builder to 0.5 units, and the finest rotation in the corpus is 11.25° (45
 * quarter-degrees) on the tiles that carry `size|angle|11.25`.
 *
 * But `Placement` validates a coordinate as any finite number, on purpose — its
 * docblock says a schema that enforced the snap would reject a legitimate finer
 * mode the day one ships. A codec that quantised unconditionally would therefore
 * be **lossy on schema-valid input**, and it would be lossy the way this whole PR
 * is written to avoid: silently, by moving a tile a quarter of a unit. So a column
 * that cannot be represented exactly falls back to float64 for the whole column,
 * flagged in the header. Per column rather than per value because the alternative
 * is an exception list with its own indices — more format, more to get wrong, and
 * it would only ever run on data that does not exist yet.
 */
import type { LockSystem } from '@/store'

import { ByteReader, ByteWriter, MalformedPayloadError } from './bytes'

/* ---------------------------------------------------------------- constants */

/**
 * Version of *this layout*.
 *
 * Bump it in the same commit that changes a field's position or meaning, so an
 * older link is refused with a clear message instead of read as though the fields
 * were where this build expects them. It is separate from the manifest version:
 * this one says "these bytes are laid out differently", that one says "these
 * integers mean different tiles".
 */
export const SHARE_FORMAT_VERSION = 1

/**
 * Ceiling on the declared placement count.
 *
 * Not a product limit — the URL budget bites long before it (29,713 placements in
 * a 2,000-character link for a room build, and a person will not build 100,000
 * tiles). It is an allocation guard: a hand-edited payload can claim any count,
 * and a reader that trusted it would size an array from a stranger's number. The
 * cheaper check below — count against bytes remaining — catches almost every case
 * first; this catches the rest.
 */
export const MAX_SHARE_PLACEMENTS = 100_000

/**
 * Position quantum: values are stored as `x · 2`, i.e. in half grid units.
 *
 * §7 and `src/catalog/schema.ts#WALL_THICKNESS_UNITS`: every dimension in the
 * catalog is a multiple of 0.5 units, which is why the builder's 0.25 snap was
 * dropped, so a half-unit grid is the whole space of buildable positions.
 */
const COORD_SCALE = 2

/**
 * Rotation quantum: values are stored as `deg · 4`, i.e. in quarter degrees.
 *
 * Chosen from the data rather than for tidiness. The observed `size|angle` values
 * are 90, 45, 22.5, 60, 270, 11.25, 120, 240 and 300; the finest is 11.25°, which
 * is exactly 45 quarter-degrees. A whole-degree quantum would silently round the
 * 893 tiles that carry a non-multiple-of-90 angle.
 */
const ROT_SCALE = 4

const FLAG_X_EXACT = 1
const FLAG_Z_EXACT = 2
const FLAG_ROT_EXACT = 4
const KNOWN_FLAGS = FLAG_X_EXACT | FLAG_Z_EXACT | FLAG_ROT_EXACT

/**
 * Lock systems in wire order. **Append-only, for the same reason ordinals are.**
 *
 * The payload stores an index, so reordering this array would change which lock
 * system every link already in the wild resolves with — and §2 makes lock
 * preference the thing that picks the concrete STL, so the symptom is a download
 * pack full of the wrong joinery rather than an error. A new system goes on the
 * end; `payload.test.ts` asserts this covers `LockSystem` exactly, so adding one
 * to the enum fails a test rather than shipping a payload that cannot say it.
 */
export const LOCK_ORDER: readonly LockSystem[] = ['openlock', 'dragonlock', 'magnetic']

/* -------------------------------------------------------------------- types */

/** One placement as the wire sees it: an ordinal and three numbers. */
export interface WirePlacement {
  readonly ordinal: number
  readonly x: number
  readonly z: number
  readonly rotation: number
}

/**
 * A whole payload, before compression and before any catalog knowledge.
 *
 * `lockIndex` rather than a `LockSystem` because decoding must be able to *report*
 * an index this build does not know — a link written by a future version that
 * added a fourth system — instead of failing to construct the value.
 */
export interface WirePayload {
  readonly manifestVersion: number
  readonly lockIndex: number
  readonly digest: number
  readonly placements: readonly WirePlacement[]
}

/* ------------------------------------------------------------------ columns */

/**
 * Whether every value survives `v · scale` as an exact integer.
 *
 * The second half of the test is the one that matters: `0.1 · 2` is `0.2`, not an
 * integer, so it is caught by `Number.isSafeInteger`; but a value like `1e17`
 * passes that and comes back changed, so the round trip is checked directly
 * rather than assumed from the type.
 */
function quantisable(values: readonly number[], scale: number): boolean {
  return values.every((value) => {
    const scaled = value * scale
    return Number.isSafeInteger(scaled) && scaled / scale === value
  })
}

function writeColumn(writer: ByteWriter, values: readonly number[], scale: number, signed: boolean, exact: boolean) {
  for (const value of values) {
    if (exact) {
      writer.f64(value)
    } else if (signed) {
      writer.zigzag(Math.round(value * scale))
    } else {
      writer.uvar(Math.round(value * scale))
    }
  }
}

function readColumn(reader: ByteReader, count: number, scale: number, signed: boolean, exact: boolean): number[] {
  const values: number[] = []
  for (let i = 0; i < count; i += 1) {
    if (exact) {
      values.push(reader.f64())
    } else if (signed) {
      values.push(reader.zigzag() / scale)
    } else {
      values.push(reader.uvar() / scale)
    }
  }
  return values
}

/* ------------------------------------------------------------------ encoding */

/**
 * Serialise a payload. Synchronous — the compression is the caller's.
 *
 * Throws {@link MalformedPayloadError} only on input this app cannot produce (a
 * negative count, a lock index off the end, an ordinal that is not a
 * non-negative safe integer). Callers construct the input from validated values,
 * so a throw here is a bug in the caller rather than bad user data.
 */
export function encodePayload(payload: WirePayload): Uint8Array {
  if (payload.placements.length > MAX_SHARE_PLACEMENTS) {
    throw new MalformedPayloadError(
      `${String(payload.placements.length)} placements exceeds the ${String(MAX_SHARE_PLACEMENTS)} the format carries`,
    )
  }
  if (!Number.isInteger(payload.lockIndex) || payload.lockIndex < 0 || payload.lockIndex > 0xff) {
    throw new MalformedPayloadError(`lock index ${String(payload.lockIndex)} does not fit one byte`)
  }

  const xs = payload.placements.map((placement) => placement.x)
  const zs = payload.placements.map((placement) => placement.z)
  const rotations = payload.placements.map((placement) => placement.rotation)

  const xExact = !quantisable(xs, COORD_SCALE)
  const zExact = !quantisable(zs, COORD_SCALE)
  const rotExact = !quantisable(rotations, ROT_SCALE)

  const writer = new ByteWriter()
  writer.u8(SHARE_FORMAT_VERSION)
  writer.u8((xExact ? FLAG_X_EXACT : 0) | (zExact ? FLAG_Z_EXACT : 0) | (rotExact ? FLAG_ROT_EXACT : 0))
  writer.uvar(payload.manifestVersion)
  writer.u8(payload.lockIndex)
  writer.uvar(payload.placements.length)
  writer.u8((payload.digest >>> 24) & 0xff)
  writer.u8((payload.digest >>> 16) & 0xff)
  writer.u8((payload.digest >>> 8) & 0xff)
  writer.u8(payload.digest & 0xff)

  for (const placement of payload.placements) writer.uvar(placement.ordinal)
  writeColumn(writer, xs, COORD_SCALE, true, xExact)
  writeColumn(writer, zs, COORD_SCALE, true, zExact)
  writeColumn(writer, rotations, ROT_SCALE, false, rotExact)

  return writer.bytes()
}

/* ------------------------------------------------------------------ decoding */

/** The format version a payload declares, or `undefined` if it is empty. */
export function payloadFormatVersion(bytes: Uint8Array): number | undefined {
  return bytes[0]
}

/**
 * Read a payload back.
 *
 * Throws `TruncatedPayloadError` or {@link MalformedPayloadError}; `link.ts` turns
 * both into typed failures. It does **not** validate meanings — an ordinal no
 * catalog holds, a lock index no build knows and a rotation of 900° all come back
 * as written, because whether each of those is recoverable depends on the manifest
 * and that is not this module's business.
 *
 * The format version is checked first and hardest. Everything after byte 0 is
 * positional, so reading a v2 payload with v1's field offsets would not fail — it
 * would succeed, and produce a different room.
 */
export function decodePayload(bytes: Uint8Array): WirePayload {
  const reader = new ByteReader(bytes)

  const format = reader.u8()
  if (format !== SHARE_FORMAT_VERSION) {
    throw new MalformedPayloadError(
      `payload format ${String(format)} is not ${String(SHARE_FORMAT_VERSION)}; ` +
        'the fields would be read from the wrong offsets',
    )
  }

  const flags = reader.u8()
  if ((flags & ~KNOWN_FLAGS) !== 0) {
    throw new MalformedPayloadError(`payload sets unknown flag bits (0x${flags.toString(16)})`)
  }

  const manifestVersion = reader.uvar()
  const lockIndex = reader.u8()
  const count = reader.uvar()

  if (count > MAX_SHARE_PLACEMENTS) {
    throw new MalformedPayloadError(
      `payload claims ${String(count)} placements, above the ${String(MAX_SHARE_PLACEMENTS)} limit`,
    )
  }
  // Four columns, at least one byte per value in the cheapest encoding, and four
  // digest bytes still to read. A count that cannot fit is a corrupt header, and
  // saying so beats allocating for it and failing later with "truncated".
  if (count * 4 > reader.remaining + 4) {
    throw new MalformedPayloadError(
      `payload claims ${String(count)} placements but holds ${String(reader.remaining)} more bytes`,
    )
  }

  const digest = ((reader.u8() << 24) | (reader.u8() << 16) | (reader.u8() << 8) | reader.u8()) >>> 0

  const ordinals: number[] = []
  for (let i = 0; i < count; i += 1) ordinals.push(reader.uvar())
  const xs = readColumn(reader, count, COORD_SCALE, true, (flags & FLAG_X_EXACT) !== 0)
  const zs = readColumn(reader, count, COORD_SCALE, true, (flags & FLAG_Z_EXACT) !== 0)
  const rotations = readColumn(reader, count, ROT_SCALE, false, (flags & FLAG_ROT_EXACT) !== 0)

  if (!reader.atEnd) {
    throw new MalformedPayloadError('payload has trailing bytes after the last column')
  }

  const placements: WirePlacement[] = []
  for (let i = 0; i < count; i += 1) {
    placements.push({
      ordinal: ordinals[i] ?? 0,
      x: xs[i] ?? 0,
      z: zs[i] ?? 0,
      rotation: rotations[i] ?? 0,
    })
  }

  return { manifestVersion, lockIndex, digest, placements }
}
