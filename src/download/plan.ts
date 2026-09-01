/**
 * The archive plan — everything about the download that is decided before a
 * single byte is fetched.
 *
 * A plan is a pure function of a bill of tiles and the catalog's asset bases. It
 * fixes the entry order, the entry names, the licensing files, the exact final
 * byte length and whether the archive will be ZIP64. Nothing here touches the
 * network, so the UI can show the user precisely what they are about to download
 * — size included, to the byte — and `stream.ts` can later check the bytes it
 * actually wrote against the number promised here.
 *
 * Two structural decisions worth naming:
 *
 *   - **One ordered list, two derivations.** `client-zip`'s length prediction
 *     depends on each entry's *offset*, so metadata and data must be in the same
 *     order; if they diverge the predicted length is wrong and, past 4 GB, so is
 *     the ZIP64 framing. Rather than build two lists and hope, this module builds
 *     {@link ArchivePlan.entries} once and both the prediction and the stream
 *     read from it.
 *   - **The licensing entries are not optional.** §10 obligation 2 is a launch
 *     gate, so `LICENSE.txt` and `ATTRIBUTION.csv` are the first two entries of
 *     every plan, with no flag to suppress them. They come first so that an
 *     interrupted download still carries the licence for whatever arrived.
 *
 * The bill's own md5 dedupe is consumed, never re-derived: `buildBillOfTiles`
 * emits one line per distinct md5 (171 md5s are shared by 520 catalog rows), so
 * an archive built from `bill.lines` cannot download the same file twice.
 */
import type { BillOfTiles, DownloadSize } from '@/assembly'
import type { BlobId, CatalogAssets, TileId } from '@/catalog'

import type { AttributionRow } from './attribution'
import { attributionCsv, licenceText } from './attribution'
import { needsZip64, predictZipLength, utf8Length } from './clientZip'
import { ATTRIBUTION_ENTRY_NAME, LICENSE_ENTRY_NAME, archiveEntryNames } from './entries'
import { originalStlUrl } from './source'

/** A licensing entry: text held inline, because both files are a few kilobytes. */
export interface ArchiveTextEntry {
  kind: 'text'
  name: string
  text: string
  /** UTF-8 byte length of {@link text}. Not `text.length`. */
  bytes: number
}

/** A model entry: fetched from R2 at stream time, one per distinct md5. */
export interface ArchiveFileEntry {
  kind: 'file'
  /** The disambiguated entry path. Unique across the archive; see `entries.ts`. */
  name: string
  /** Content address — what {@link ArchiveStreamOptions.source} is asked for. */
  blob: BlobId
  /** The original-STL URL, validated by `source.ts`. Never a preview derivative. */
  url: string
  /** Size from the index's `bytes` field — the reason no HEAD request is made. */
  bytes: number
  /** `basename`. Not unique across the corpus; that is why {@link name} exists. */
  filename: string
  /** Every catalog path in this bill that resolved to this blob. Usually one. */
  tileIds: readonly TileId[]
  /** Copies to print. The archive holds the file once whatever this says. */
  quantity: number
}

export type ArchiveEntry = ArchiveTextEntry | ArchiveFileEntry

export interface ArchivePlan {
  /** Suggested filename for the archive itself. */
  filename: string

  /** Every entry, **in the order the ZIP will hold them**. Licensing first. */
  entries: readonly ArchiveEntry[]

  /** The model subset of {@link entries}, same objects, for the UI. */
  files: readonly ArchiveFileEntry[]

  /**
   * The exact size of the finished archive, in bytes.
   *
   * Exact rather than estimated because nothing is compressed — see
   * `clientZip.ts`. This is what feeds a progress bar, a `Content-Length`, and
   * the truncation check in `stream.ts`.
   */
  predictedLength: number

  /**
   * Whether the archive will need ZIP64 framing.
   *
   * Reachable in ordinary use: 50 placements at the corpus p95 of 32.87 MB is
   * 1.64 GB, and while that is still under the 4 GB threshold, a large room with
   * the auto-inserted bases is not. Surfaced because a ZIP64 archive declares
   * "version 4.5 required to unzip" and a few elderly utilities refuse those.
   */
  zip64: boolean

  /**
   * The bill's download verdict — **model bytes only**, carried through
   * unchanged from `buildBillOfTiles`.
   *
   * Deliberately not recomputed from {@link predictedLength}: the thresholds are
   * calibrated against corpus file sizes (512 MB is fifty median tiles), and
   * folding in a few kilobytes of ZIP framing would make the boundary depend on
   * how long the entry names happen to be.
   */
  download: DownloadSize

  /** Timestamp on every entry, and in `LICENSE.txt`. */
  generatedAt: Date
}

/**
 * A download was requested for a scene with nothing in it.
 *
 * `buildBillOfTiles` returns an empty bill rather than throwing, which is right —
 * the builder renders the panel before anything is placed. A *download* is
 * different: an archive holding a licence and no models is not a degraded
 * result, it is a bug in whatever offered the button, and emitting it would look
 * to the user like the download had worked.
 */
export class EmptyArchiveError extends Error {
  constructor() {
    super('nothing to download: the bill of tiles holds no files')
    this.name = 'EmptyArchiveError'
  }
}

export interface ArchivePlanOptions {
  /** Where models live. Only `models` is read; `sprites` and `thumbs` are never fetched. */
  assets: Pick<CatalogAssets, 'models'>
  /** Archive filename. Defaults to `openforge-room-{date}.zip`. */
  filename?: string
  /** Fixed for tests; defaults to now. Stamped on every entry and in `LICENSE.txt`. */
  generatedAt?: Date
}

/**
 * Turn a bill of tiles into an archive plan.
 *
 * Linear in the number of bill lines and independent of catalog size. Building a
 * plan twice for the same bill gives byte-identical output apart from
 * {@link ArchivePlanOptions.generatedAt}, because `bill.lines` is already ordered
 * by catalog path rather than by placement order.
 */
export function buildArchivePlan(bill: BillOfTiles, options: ArchivePlanOptions): ArchivePlan {
  if (bill.lines.length === 0) throw new EmptyArchiveError()

  const generatedAt = options.generatedAt ?? new Date()
  const names = archiveEntryNames(bill.lines)

  const files: ArchiveFileEntry[] = bill.lines.map((line) => {
    const name = names.get(line.blob)
    if (name === undefined) {
      // Unreachable: `archiveEntryNames` keys on exactly these blobs.
      throw new Error(`no entry name was produced for ${line.blob}`)
    }
    return {
      kind: 'file',
      name,
      blob: line.blob,
      url: originalStlUrl(options.assets, line.blob),
      bytes: line.bytes,
      filename: line.filename,
      tileIds: line.tileIds,
      quantity: line.quantity,
    }
  })

  const rows: AttributionRow[] = files.map((file) => ({
    entry: file.name,
    md5: file.blob,
    catalogPaths: file.tileIds,
    sourceUrl: file.url,
    bytes: file.bytes,
    copies: file.quantity,
  }))

  const licence = textEntry(
    LICENSE_ENTRY_NAME,
    licenceText({ files: files.length, bytes: bill.download.bytes, generatedAt }),
  )
  const attribution = textEntry(ATTRIBUTION_ENTRY_NAME, attributionCsv(rows))

  const entries: ArchiveEntry[] = [licence, attribution, ...files]
  const metadata = entries.map((entry) => ({ name: entry.name, size: entry.bytes }))

  return {
    filename: options.filename ?? defaultFilename(generatedAt),
    entries,
    files,
    predictedLength: predictZipLength(metadata),
    zip64: needsZip64(metadata),
    download: bill.download,
    generatedAt,
  }
}

function textEntry(name: string, text: string): ArchiveTextEntry {
  return { kind: 'text', name, text, bytes: utf8Length(text) }
}

function defaultFilename(generatedAt: Date): string {
  const date = generatedAt.toISOString().slice(0, 10)
  return `openforge-room-${date}.zip`
}
