/**
 * The archive plan — everything decided before a byte is fetched, and the half
 * of this Worker that must produce the same bytes as the browser.
 *
 * ## What is shared code and what is not
 *
 * Three things decide the bytes of the archive, and all three are **imported
 * from the client path rather than restated**:
 *
 *   - **The writer.** `src/download/clientZip.ts` — the vendored `client-zip`
 *     2.5.0, STORE only, ZIP64 where needed — so the local headers, the
 *     streaming data descriptors, the central directory and the ZIP64 records
 *     are literally the same code. `predictZipLength` and `needsZip64` come from
 *     there too, so the Worker's `Content-Length` and the browser's progress bar
 *     are the same arithmetic.
 *   - **The licence text.** `licenceText` from `src/download/attribution.ts`.
 *   - **The attribution table.** `attributionCsv` from the same module, with the
 *     same RFC 4180 quoting on every field — which is not belt-and-braces,
 *     because catalog filenames contain commas.
 *
 * Both imports are **relative, not `@/`-aliased**, deliberately: the Worker
 * bundle is built by wrangler's esbuild and not by vite, so it must not depend
 * on a path alias resolving. `clientZip.ts` reaches into `vendor/` the same way
 * and for the same reason.
 *
 * What is *not* shared is the fifteen lines of assembly below —
 * `buildArchivePlan` in `src/download/plan.ts` does the same thing and cannot be
 * imported, because its type imports reach `@/assembly` → `@/store`, which
 * needs DOM globals a Worker does not have. That is a real seam and it is
 * reported as one in the PR rather than papered over here. `archive.test.ts`
 * pins the consequence: the ordered entry list, the two licensing entries in
 * front, the exact `licenceText` and `attributionCsv` arguments, and the
 * predicted length.
 *
 * ## The order is the contract
 *
 * `client-zip`'s length prediction depends on each entry's *offset*, so the
 * metadata and the data must be in one order or the prediction is wrong and,
 * past 4 GB, so is the ZIP64 framing. As in `plan.ts`, there is one ordered
 * array and both the prediction and the stream read from it.
 *
 * And the licensing entries come **first**, with no flag to suppress them —
 * §10, obligation 2 — so that an interrupted download still carries the licence
 * and the attribution for whatever models did arrive.
 */
import { attributionCsv, licenceText } from '../../src/download/attribution'
import type { AttributionRow } from '../../src/download/attribution'
import type { ZipEntryMeta } from '../../src/download/clientZip'
import { needsZip64, predictZipLength, utf8Length } from '../../src/download/clientZip'
import type { ArchiveRequest } from './request'
import { modelStlUrl } from './url'

/** The licence text, at the archive root. Mirrors `LICENSE_ENTRY_NAME`. */
export const LICENSE_ENTRY_NAME = 'LICENSE.txt'

/** The per-file attribution table, at the archive root. Mirrors `ATTRIBUTION_ENTRY_NAME`. */
export const ATTRIBUTION_ENTRY_NAME = 'ATTRIBUTION.csv'

/** A licensing entry: text held inline, because both files are a few kilobytes. */
export interface ArchiveTextEntry {
  readonly kind: 'text'
  readonly name: string
  readonly text: string
  /** UTF-8 byte length of {@link text}. Not `text.length`. */
  readonly bytes: number
}

/** A model entry: fetched from the bucket at stream time, one per distinct md5. */
export interface ArchiveModelEntry {
  readonly kind: 'model'
  /** The disambiguated entry path, as the client derived it. */
  readonly name: string
  /** Content address. */
  readonly md5: string
  /** Composed by {@link modelStlUrl} from the Worker's own bucket base. */
  readonly url: string
  /** Size from the catalog index. The stream fails if the body disagrees. */
  readonly bytes: number
}

export type ArchiveEntry = ArchiveTextEntry | ArchiveModelEntry

export interface ArchivePlan {
  /** Suggested filename for the archive itself. */
  readonly filename: string
  /** Stamped on every entry and printed in `LICENSE.txt`. */
  readonly generatedAt: Date
  /** Every entry, **in the order the ZIP holds them**. Licensing first. */
  readonly entries: readonly ArchiveEntry[]
  /** The model subset of {@link entries}, same objects, in the same order. */
  readonly models: readonly ArchiveModelEntry[]
  /**
   * The exact size of the finished archive, in bytes.
   *
   * Exact rather than estimated because nothing is compressed. This is the
   * `Content-Length` the Worker sets and the number `stream.ts` fails the
   * response against.
   */
  readonly predictedLength: number
  /** Whether the archive needs ZIP64 framing. Logged, and asserted in tests. */
  readonly zip64: boolean
  /** Model bytes only — the number `LICENSE.txt` prints. */
  readonly modelBytes: number
}

/**
 * Turn a validated request into a plan.
 *
 * Pure, and independent of the network: a caller may build a plan, set a
 * `Content-Length` from it, and only then open the first body.
 */
export function buildArchivePlan(request: ArchiveRequest, modelsBase: string): ArchivePlan {
  // One pass over the rows, filling both lists. Two passes joined by index would
  // work and is how it read first; a single loop means the URL in
  // `ATTRIBUTION.csv` is *the* URL the entry streams from rather than a lookup
  // that has to be believed — and there is no index-out-of-range fallback to
  // pick a wrong value silently.
  const models: ArchiveModelEntry[] = []
  const rows: AttributionRow[] = []
  for (const file of request.files) {
    const url = modelStlUrl(modelsBase, file.md5)
    models.push({ kind: 'model', name: file.name, md5: file.md5, url, bytes: file.bytes })
    rows.push({
      entry: file.name,
      md5: file.md5,
      catalogPaths: file.paths,
      sourceUrl: url,
      bytes: file.bytes,
      copies: file.copies,
    })
  }

  const licence = textEntry(
    LICENSE_ENTRY_NAME,
    licenceText({ files: models.length, bytes: request.modelBytes, generatedAt: request.generatedAt }),
  )
  const attribution = textEntry(ATTRIBUTION_ENTRY_NAME, attributionCsv(rows))

  const entries: ArchiveEntry[] = [licence, attribution, ...models]

  return {
    filename: request.filename,
    generatedAt: request.generatedAt,
    entries,
    models,
    predictedLength: predictZipLength(entryMetadata(entries)),
    zip64: needsZip64(entryMetadata(entries)),
    modelBytes: request.modelBytes,
  }
}

/**
 * The `(name, size)` pairs the prediction is computed from.
 *
 * Exported so `archive.test.ts` can assert that the length the Worker publishes
 * is `predictZipLength` of exactly this list, in exactly this order, rather than
 * of some list the test rebuilds and hopes matches.
 */
export function entryMetadata(entries: readonly ArchiveEntry[]): ZipEntryMeta[] {
  return entries.map((entry) => ({ name: entry.name, size: entry.bytes }))
}

function textEntry(name: string, text: string): ArchiveTextEntry {
  return { kind: 'text', name, text, bytes: utf8Length(text) }
}
