/**
 * A ZIP reader, for tests only.
 *
 * The Worker writes archives; nothing in production reads one. This exists so
 * the tests can assert what an *extractor* sees rather than what the writer
 * believes it wrote — which is the only way to check the two download paths
 * produce the same structure, and the only way to catch a truncation that a
 * streamed ZIP would otherwise hide.
 *
 * It reads the **central directory**, the way a real extractor does, rather than
 * walking local headers forwards. That matters here: `client-zip` writes each
 * entry's real CRC and size in a trailing data descriptor, so the local header
 * of a streamed entry carries zeroes and a forward walk would report every
 * entry as empty — exactly the blind spot that makes a truncated archive open
 * cleanly. ZIP64 is handled, because a 1.6 GB room needs it.
 */

const LOCAL_HEADER = 0x0403_4b50
const CENTRAL_HEADER = 0x0201_4b50
const EOCD = 0x0605_4b50
const ZIP64_EOCD = 0x0606_4b50
const ZIP64_LOCATOR = 0x0706_4b50
const ZIP64_EXTRA_FIELD = 0x0001
const UINT32_MAX = 0xffff_ffff

/** STORE. Every entry this project writes is stored; nothing is deflated. */
export const METHOD_STORE = 0

/** One entry, as an extractor would see it. */
export interface ZipEntryRecord {
  name: string
  /** 0 for STORE, 8 for DEFLATE. Asserted to be 0 throughout. */
  method: number
  /** From the central directory, which is where the real values live. */
  compressedSize: number
  uncompressedSize: number
  crc32: number
  /** Whether the entry's name is flagged UTF-8 (EFS, general-purpose bit 11). */
  utf8: boolean
  /** The entry's bytes, sliced out of the archive at its local header's offset. */
  data: Uint8Array
}

export interface ZipArchive {
  entries: ZipEntryRecord[]
  /** Whether the archive carries a ZIP64 end-of-central-directory record. */
  zip64: boolean
  /** Total archive length, so a test can compare it against the prediction. */
  bytes: number
}

/**
 * Parse an archive.
 *
 * Throws on anything structurally wrong — a missing end-of-central-directory,
 * an entry count that disagrees with the directory, a CRC that does not match
 * the bytes. A test that gets a `ZipArchive` back has already been told the
 * archive is internally consistent.
 */
export function readZip(bytes: Uint8Array): ZipArchive {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  const eocd = findEocd(view)
  let count = view.getUint16(eocd + 10, true)
  let directoryAt = view.getUint32(eocd + 16, true)
  let zip64 = false

  if (count === 0xffff || directoryAt === UINT32_MAX) {
    const locator = eocd - 20
    if (locator < 0 || view.getUint32(locator, true) !== ZIP64_LOCATOR) {
      throw new Error('the archive needs ZIP64 but carries no ZIP64 locator')
    }
    const zip64At = Number(view.getBigUint64(locator + 8, true))
    if (view.getUint32(zip64At, true) !== ZIP64_EOCD) throw new Error('the ZIP64 locator does not point at a ZIP64 EOCD')
    count = Number(view.getBigUint64(zip64At + 32, true))
    directoryAt = Number(view.getBigUint64(zip64At + 48, true))
    zip64 = true
  } else if (eocd >= 20 && view.getUint32(eocd - 20, true) === ZIP64_LOCATOR) {
    zip64 = true
  }

  const entries: ZipEntryRecord[] = []
  let at = directoryAt
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(at, true) !== CENTRAL_HEADER) {
      throw new Error(`central directory entry ${String(i)} has no header signature`)
    }
    const parsed = readCentralEntry(bytes, view, at)
    entries.push(parsed.entry)
    at = parsed.next
  }

  if (view.getUint32(at, true) === CENTRAL_HEADER) {
    throw new Error('the central directory holds more entries than the EOCD declares')
  }

  return { entries, zip64, bytes: bytes.byteLength }
}

function readCentralEntry(
  bytes: Uint8Array,
  view: DataView,
  at: number,
): { entry: ZipEntryRecord; next: number } {
  const flags = view.getUint16(at + 8, true)
  const method = view.getUint16(at + 10, true)
  const crc = view.getUint32(at + 16, true)
  let compressedSize: number = view.getUint32(at + 20, true)
  let uncompressedSize: number = view.getUint32(at + 24, true)
  const nameLength = view.getUint16(at + 28, true)
  const extraLength = view.getUint16(at + 30, true)
  const commentLength = view.getUint16(at + 32, true)
  let localAt: number = view.getUint32(at + 42, true)

  const nameAt = at + 46
  const name = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes.subarray(nameAt, nameAt + nameLength))

  // ZIP64 extra field: the 32-bit fields above are 0xffffffff placeholders, and
  // the real values arrive here in a fixed order, each present only if its
  // 32-bit field was saturated.
  const extra = readZip64Extra(view, nameAt + nameLength, extraLength, {
    uncompressedSize: uncompressedSize === UINT32_MAX,
    compressedSize: compressedSize === UINT32_MAX,
    localAt: localAt === UINT32_MAX,
  })
  if (extra.uncompressedSize !== undefined) uncompressedSize = extra.uncompressedSize
  if (extra.compressedSize !== undefined) compressedSize = extra.compressedSize
  if (extra.localAt !== undefined) localAt = extra.localAt

  if (view.getUint32(localAt, true) !== LOCAL_HEADER) {
    throw new Error(`entry "${name}" points at ${String(localAt)}, which is not a local file header`)
  }
  const localNameLength = view.getUint16(localAt + 26, true)
  const localExtraLength = view.getUint16(localAt + 28, true)
  const dataAt = localAt + 30 + localNameLength + localExtraLength

  if (dataAt + compressedSize > bytes.byteLength) {
    throw new Error(`entry "${name}" claims ${String(compressedSize)} bytes at ${String(dataAt)}, past the end of the archive`)
  }
  const data = bytes.subarray(dataAt, dataAt + compressedSize)

  if (method === METHOD_STORE && crc32(data) !== crc) {
    throw new Error(`entry "${name}" has a CRC of ${String(crc)} that does not match its ${String(data.byteLength)} bytes`)
  }

  return {
    entry: { name, method, compressedSize, uncompressedSize, crc32: crc, utf8: (flags & 0x0800) !== 0, data },
    next: at + 46 + nameLength + extraLength + commentLength,
  }
}

function readZip64Extra(
  view: DataView,
  at: number,
  length: number,
  wanted: { uncompressedSize: boolean; compressedSize: boolean; localAt: boolean },
): { uncompressedSize?: number; compressedSize?: number; localAt?: number } {
  const found: { uncompressedSize?: number; compressedSize?: number; localAt?: number } = {}
  let cursor = at
  const end = at + length

  while (cursor + 4 <= end) {
    const id = view.getUint16(cursor, true)
    const size = view.getUint16(cursor + 2, true)
    if (id === ZIP64_EXTRA_FIELD) {
      let field = cursor + 4
      if (wanted.uncompressedSize) {
        found.uncompressedSize = Number(view.getBigUint64(field, true))
        field += 8
      }
      if (wanted.compressedSize) {
        found.compressedSize = Number(view.getBigUint64(field, true))
        field += 8
      }
      if (wanted.localAt) found.localAt = Number(view.getBigUint64(field, true))
      return found
    }
    cursor += 4 + size
  }
  return found
}

/** Scan backwards for the end-of-central-directory record. */
function findEocd(view: DataView): number {
  for (let at = view.byteLength - 22; at >= 0; at -= 1) {
    if (view.getUint32(at, true) === EOCD) return at
  }
  throw new Error('no end-of-central-directory record: this is not a ZIP archive, or it is truncated')
}

/* ------------------------------------------------------------------- CRC-32 */

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = (c & 1) === 1 ? 0xedb8_8320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

/** Independent of the writer's implementation, which is the point of having it. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffff_ffff
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8)
  return (c ^ 0xffff_ffff) >>> 0
}
