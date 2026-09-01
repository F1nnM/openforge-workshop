/**
 * The ZIP writer — a narrow, typed seam over the **vendored** `client-zip`.
 *
 * This is the only module in the app permitted to import from `vendor/`.
 * Everything above it sees the four names below and never the library.
 *
 * ## Why the library is vendored rather than declared as a dependency
 *
 * `client-zip` is not in `package.json`; `vendor/client-zip/` holds the
 * published 2.5.0 tarball byte-for-byte, with its MIT licence and a
 * `PROVENANCE.md` carrying the version, the upstream commit and a SHA-256 per
 * file. The reasoning, including what it costs:
 *
 *   - **The scope is finished, not abandoned.** The last release is 2025-03 and
 *     npm flags maintenance inactive, which reads like a risk until you read the
 *     roadmap: upstream closes ZIP64 as "Done" and *rejects* compression on the
 *     explicit grounds that it is incompatible with content-length prediction.
 *     Length prediction is the feature this download path is built on (§11:
 *     "Feed `predictLength` from the fixture `size` field, never HEAD"), so the
 *     one thing a future release might add is the one thing we would not take.
 *     The repository is not archived; there is simply no pending work to miss.
 *   - **6.4 KB, zero dependencies, standards only** — `ReadableStream`,
 *     `TextEncoder`, `DataView`, `BigInt`. Nothing here goes stale, and there is
 *     no transitive tree to audit or to resolve at install time.
 *   - **An unpublish becomes a non-event.** A `dependencies` entry on an
 *     inactive single-maintainer package is a build that can one day stop
 *     resolving. A checked-in file is not.
 *   - **The bytes are reviewable.** 6.4 KB of minified but unobfuscated ES2020
 *     that writes ZIP headers. This archive goes to somebody's printer; being
 *     able to read the exact code that frames it is worth more than a caret
 *     range.
 *
 * The cost, accepted knowingly: advisories and fixes do not arrive
 * automatically. The library takes no untrusted input beyond entry names, parses
 * nothing, and makes no network or filesystem calls of its own, so the exposure
 * is small and the refresh procedure is four commands in `PROVENANCE.md`.
 *
 * ## STORE only — there is no compression here, by design
 *
 * `client-zip` cannot deflate, and that is the trade §11 takes deliberately:
 * 870 corpus STLs are ASCII and would deflate 5–10×, but compressed sizes are
 * not knowable in advance, so a compressing writer cannot publish an exact
 * `Content-Length` and cannot drive an honest progress bar. Every entry is
 * stored, and {@link predictZipLength} is therefore exact to the byte — which
 * `stream.ts` turns into a truncation guard rather than only a progress readout.
 *
 * ## ZIP64
 *
 * Handled by the library, and needed here: 50 placements at the corpus p95 of
 * 32.87 MB is 1.64 GB, and a single corpus file reaches 108.9 MB. The vendored
 * writer emits ZIP64 local descriptors, central-directory extra fields and the
 * ZIP64 end-of-central-directory record whenever an entry or an offset passes
 * 0xffffffff; {@link needsZip64} mirrors that predicate so the UI can say so
 * before the download starts. `download.test.ts` pins the exact predicted
 * lengths either side of the boundary.
 */
import { makeZip, predictLength } from '../../vendor/client-zip/index.js'

/**
 * The 32-bit ceiling every ZIP field has, past which ZIP64 is required.
 *
 * Exported because it is the number the whole zip64 story turns on and a caller
 * asserting against it should not restate it.
 */
export const ZIP32_LIMIT = 0xffff_ffff

/**
 * Bytes of ZIP framing per stored entry, excluding the entry name and the data.
 *
 * 30 (local file header) + 16 (streaming data descriptor) for the local
 * section, and 46 (central directory header) for the directory. Both come to 46,
 * which is a coincidence of the format and not a shared constant — they are
 * written separately below so that reading either arithmetic is possible.
 */
const LOCAL_FRAMING_BYTES = 46
const CENTRAL_FRAMING_BYTES = 46

/** End of central directory record. */
const EOCD_BYTES = 22

/** ZIP64 end-of-central-directory record (56) plus its locator (20). */
const ZIP64_EOCD_BYTES = 76

/** ZIP64 local data descriptor: 8-byte sizes instead of 4-byte. */
const ZIP64_DESCRIPTOR_EXTRA_BYTES = 8

/** What one entry contributes, for prediction: a name and a byte count. */
export interface ZipEntryMeta {
  /** The entry's path inside the archive. UTF-8; the writer sets the EFS flag. */
  readonly name: string
  /** Uncompressed size in bytes. Stored, so this is also the compressed size. */
  readonly size: number
}

/** One entry, with its content. Text is passed inline; file bodies stream. */
export type ZipEntry =
  | { readonly name: string; readonly input: string; readonly lastModified: Date }
  | {
      readonly name: string
      readonly input: ReadableStream<Uint8Array>
      readonly size: number
      readonly lastModified: Date
    }

/**
 * The exact byte length of the archive these entries would produce.
 *
 * Exact, not an estimate, because nothing is compressed. Returned as a `number`
 * rather than the library's `bigint`: the corpus totals 108.0 GB, so even an
 * archive of every file is eleven orders of magnitude below `Number`'s
 * 2^53 exact-integer ceiling, and a `bigint` on this boundary would infect every
 * progress calculation above it with mixed-type arithmetic. Throws if the total
 * somehow exceeds that ceiling rather than silently losing precision.
 *
 * **Order matters.** ZIP64 accounting depends on each entry's *offset*, so the
 * metadata must be in the same order as the data. `plan.ts` builds one ordered
 * array and derives both from it, which is what makes the two impossible to
 * diverge.
 */
export function predictZipLength(entries: Iterable<ZipEntryMeta>): number {
  const predicted = predictLength([...entries])
  if (predicted > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`predicted archive length ${predicted.toString()} exceeds Number.MAX_SAFE_INTEGER`)
  }
  return Number(predicted)
}

/**
 * Whether these entries force a ZIP64 archive.
 *
 * Mirrors the vendored writer's predicate exactly — any entry at or past
 * `ZIP32_LIMIT`, or a local section that reaches it — so that a UI warning and
 * the emitted bytes cannot disagree. It is a separate arithmetic rather than a
 * flag read back out of {@link predictZipLength} because the library does not
 * expose one, and inferring it from a length difference would mean re-deriving
 * this same sum anyway.
 *
 * It matters to the user: upstream notes that a ZIP64 archive always declares
 * "version 4.5 required", and a few elderly unzip utilities refuse those.
 */
export function needsZip64(entries: Iterable<ZipEntryMeta>): boolean {
  let localSection = 0
  for (const entry of entries) {
    if (entry.size >= ZIP32_LIMIT) return true
    localSection += LOCAL_FRAMING_BYTES + utf8Length(entry.name) + entry.size
  }
  return localSection >= ZIP32_LIMIT
}

/**
 * The archive, as a stream.
 *
 * A `ReadableStream`, never a `Blob`: a 1.6 GB `Blob` is an out-of-memory crash
 * on mobile Safari, and the point of a streaming writer is that peak memory is
 * one file's chunk rather than the whole archive.
 *
 * Backpressure is the library's: it pulls the next entry only once the previous
 * one has been written out, so a slow disk throttles the fetches instead of
 * queueing 8,702 of them. An exception thrown by the source iterable errors the
 * output stream — which is what lets `stream.ts` surface a failed fetch instead
 * of finishing a short archive.
 */
export function makeZipStream(entries: AsyncIterable<ZipEntry>): ReadableStream<Uint8Array> {
  return makeZip(entries)
}

/** UTF-8 byte length. `°` and `%` occur in 1,249 corpus paths, so this is not `.length`. */
export function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length
}

/**
 * The framing arithmetic, re-derived, for the test that pins it.
 *
 * Not used in production — {@link predictZipLength} defers to the library so
 * there is one source of truth. It exists so `download.test.ts` can assert that
 * the library's prediction equals an independently written formula, including the
 * ZIP64 terms, without the test simply restating whatever the library returned.
 */
export function framingLength(entries: readonly ZipEntryMeta[]): number {
  let local = 0
  let central = EOCD_BYTES
  let anyZip64 = false
  for (const entry of entries) {
    const nameBytes = utf8Length(entry.name)
    const sizeNeedsZip64 = entry.size >= ZIP32_LIMIT
    const offsetNeedsZip64 = local >= ZIP32_LIMIT
    local += LOCAL_FRAMING_BYTES + nameBytes + entry.size + (sizeNeedsZip64 ? ZIP64_DESCRIPTOR_EXTRA_BYTES : 0)
    const extraField = sizeNeedsZip64 ? 28 : offsetNeedsZip64 ? 12 : 0
    central += CENTRAL_FRAMING_BYTES + nameBytes + extraField
    anyZip64 ||= sizeNeedsZip64
  }
  if (anyZip64 || local >= ZIP32_LIMIT) central += ZIP64_EOCD_BYTES
  return local + central
}
