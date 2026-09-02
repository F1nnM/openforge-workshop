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
 *
 * ## Row S5: meshes that were never on R2
 *
 * A generated base is a first-class placement, so its bytes are a first-class
 * entry — {@link ArchiveGeneratedEntry}, under `generated/`, alongside a notice
 * that carries the geometry's Apache-2.0 licence. It is deliberately the *same
 * shape* as a model entry: `stream.ts` asks the injected {@link BlobSource} for
 * everything that is not text, by content address, so a caller that composes a
 * source serving these digests from memory needs no new branch in the streaming
 * path — and the exact-length guard, the ZIP64 accounting and §10's
 * no-URL-argument refusal all apply to them unchanged.
 *
 * Three things this module enforces about that composition, all before a byte is
 * fetched: the notice is present ({@link GeneratedArchiveSection}), no digest is
 * claimed by both a catalogued file and a generated mesh
 * ({@link GeneratedDigestCollisionError}), and no entry name is used twice
 * across the finished list. They are refusals rather than resolutions because
 * each of the three failures they prevent produces an archive that opens cleanly
 * and holds the wrong bytes.
 */
import type { BillOfTiles, DownloadSize } from '@/assembly'
import type { BlobId, CatalogAssets, TileId } from '@/catalog'

import type { AttributionRow } from './attribution'
import { attributionCsv, licenceText } from './attribution'
import { needsZip64, predictZipLength, utf8Length } from './clientZip'
import { ArchiveNamingError, ATTRIBUTION_ENTRY_NAME, LICENSE_ENTRY_NAME, archiveEntryNames, sanitizePath } from './entries'
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

/**
 * A mesh generated in the browser, entering the pack as an ordinary entry.
 *
 * **Structurally a file entry, and that is the whole design.** `stream.ts`
 * branches on `kind === 'text'` and asks {@link ArchiveStreamOptions.source} for
 * everything else by content address, so a generated mesh needs no new branch
 * anywhere in the streaming path: the caller composes a {@link BlobSource} that
 * serves these digests out of memory and falls through to R2 for the rest. Three
 * things follow, and each of them is a guarantee this row would otherwise have
 * had to rebuild:
 *
 *   - **The exact-length guard covers it.** {@link ArchivePlan.predictedLength}
 *     is computed from these `bytes` alongside every other entry, and
 *     `stream.ts` fails the stream when the total is off by one byte in either
 *     direction. A generated mesh cannot make a short archive that still opens.
 *   - **§10's structural refusal survives.** `open` takes a {@link BlobId} and
 *     nothing else, so there is still no argument anywhere in the download path
 *     that could point it at a decimated preview.
 *   - **ZIP64 accounting is unchanged**, because the entry sits in the one
 *     ordered list the prediction is derived from.
 *
 * What is *not* claimed: the digest is the mesh's own, computed over bytes this
 * browser produced, so it identifies them rather than vouching for them. These
 * entries are therefore **not** rows of `ATTRIBUTION.csv`, which is the table for
 * the archive's published CC BY-NC-SA files; the notice named in
 * {@link GeneratedArchiveSection} is their table, and it carries the Apache-2.0
 * geometry's licence.
 */
export interface ArchiveGeneratedEntry {
  kind: 'generated'
  /** The disambiguated entry path, under `generated/`. Unique across the archive. */
  name: string
  /** The mesh's own md5 — a content address it gave itself. */
  blob: BlobId
  /** Exact byte length of the held mesh. Not an estimate; the bytes are in memory. */
  bytes: number
  /** S4's 8-character recipe handles that produced these exact bytes, sorted. */
  recipes: readonly string[]
  /** Copies to print. The archive holds the mesh once whatever this says. */
  quantity: number
}

export type ArchiveEntry = ArchiveTextEntry | ArchiveFileEntry | ArchiveGeneratedEntry

/**
 * One generated mesh a caller is handing to the pack.
 *
 * `stem` is a readable filename *without* the `generated/` prefix and without a
 * disambiguator; this module sanitises it, prefixes it, and appends `~{md5}` if
 * two stems collapse onto one name — the same discipline `entries.ts` applies to
 * catalog paths, for the same reason: a ZIP writer given one name twice writes
 * both and every extractor keeps the last, which is a wrong print rather than a
 * confusing archive.
 */
export interface GeneratedArchiveMesh {
  readonly blob: BlobId
  readonly bytes: number
  readonly stem: string
  readonly recipes: readonly string[]
  readonly quantity: number
}

/**
 * The generated half of a pack: the meshes, and the notice that must ride with
 * them.
 *
 * The notice is **not optional and not defaulted**, for the reason the licensing
 * entries are not optional: `LICENSE.txt` speaks for the archive's published
 * files and says every file under `models/` is an unmodified original, which
 * these are not. A generated STL is a derivative of Apache-2.0 `.scad` sources,
 * and §4(a) of that licence asks that a recipient of a derivative work be handed
 * a copy of the licence. So a section with meshes and an empty notice is a
 * {@link ArchiveNamingError}, thrown before a byte is fetched — the composition
 * is refused rather than shipped without its licence.
 *
 * The text itself belongs to `src/generator/placement/pack.ts`, which knows what
 * the geometry is and where it is pinned. This module only enforces that it is
 * there.
 */
export interface GeneratedArchiveSection {
  readonly meshes: readonly GeneratedArchiveMesh[]
  readonly notice: { readonly name: string; readonly text: string }
}

/** Every generated entry lives under this, so a catalog path cannot shadow one. */
export const GENERATED_PREFIX = 'generated/'

/**
 * A generated mesh's digest equals a catalogued file's.
 *
 * Astronomically unlikely and refused rather than resolved. Equal md5 is not
 * equal bytes, so the pack would hold one entry claiming two provenances — a
 * published CC BY-NC-SA file and a browser render of Apache-2.0 geometry — and
 * one of the two readers would get the wrong mesh with no error. Changing any
 * parameter clears it.
 */
export class GeneratedDigestCollisionError extends Error {
  readonly blob: BlobId

  constructor(blob: BlobId, entry: string) {
    super(
      `the generated mesh ${blob} has the same digest as the catalogued file in ${entry}. ` +
        'The pack cannot hold one entry with two provenances, so the download has been refused.',
    )
    this.name = 'GeneratedDigestCollisionError'
    this.blob = blob
  }
}

export interface ArchivePlan {
  /** Suggested filename for the archive itself. */
  filename: string

  /** Every entry, **in the order the ZIP will hold them**. Licensing first. */
  entries: readonly ArchiveEntry[]

  /** The model subset of {@link entries}, same objects, for the UI. */
  files: readonly ArchiveFileEntry[]

  /**
   * The generated subset of {@link entries}, same objects.
   *
   * **Kept out of {@link files} on purpose.** `urlList.ts` maps `files` to
   * `file.url`, and a generated mesh has no URL — it was never on R2. Putting one
   * in that array would hand somebody's download manager a 404 that looks like
   * every other line, which is the degradation path failing quietly. So the two
   * lists are separate, and a caller offering the URL list has to say how many
   * generated meshes it cannot represent. `urlListText` is unchanged and still
   * honest about what it does list.
   */
  generated: readonly ArchiveGeneratedEntry[]

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
   *
   * Generated meshes are outside it for a second reason: the verdict is about
   * *fetch* cost, and those bytes are already in memory. What they do change is
   * the size of the finished archive, which is {@link predictedLength}, exactly.
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
    super('nothing to download: the bill of tiles holds no files and no mesh was generated')
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
  /**
   * Meshes generated in this browser, and the notice that rides with them.
   *
   * Omit for a pack of catalog files only, which is every pack before row S5's
   * panel is wired up. See {@link GeneratedArchiveSection}.
   */
  generated?: GeneratedArchiveSection
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
  const section = options.generated
  const generatedMeshes = section?.meshes ?? []
  // Empty means empty of *models*, generated ones included. A room built
  // entirely out of generated bases is a real room, and refusing it would be
  // this function reporting "nothing to download" about something.
  if (bill.lines.length === 0 && generatedMeshes.length === 0) throw new EmptyArchiveError()

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

  const generated = generatedEntries(generatedMeshes)
  assertNoDigestCollision(files, generated)

  // Licensing first, then the generated notice, then the models and the meshes.
  // The order is the one `attribution.ts` argues for: an interrupted download
  // still carries the licence and the attribution for whatever arrived — and for
  // a pack holding generated meshes, "the licence" is two documents, because
  // `LICENSE.txt` speaks only for the archive's published files.
  const preamble: ArchiveEntry[] = [licence, attribution]
  if (generated.length > 0) {
    const notice = section?.notice
    if (notice === undefined || notice.text.trim() === '') {
      throw new ArchiveNamingError(
        'refusing to pack a generated mesh with no provenance-and-licence notice: a generated STL is a ' +
          'derivative of Apache-2.0 geometry and section 4(a) asks that a recipient be handed the licence',
      )
    }
    preamble.push(textEntry(notice.name, notice.text))
  }

  const entries: ArchiveEntry[] = [...preamble, ...files, ...generated]
  assertUniqueNames(entries)
  const metadata = entries.map((entry) => ({ name: entry.name, size: entry.bytes }))

  return {
    filename: options.filename ?? defaultFilename(generatedAt),
    entries,
    files,
    generated,
    predictedLength: predictZipLength(metadata),
    zip64: needsZip64(metadata),
    download: bill.download,
    generatedAt,
  }
}

/**
 * Name the generated entries, and disambiguate a collision rather than lose one.
 *
 * Deduped by the caller on the mesh digest — one entry per distinct md5, the same
 * identity `buildBillOfTiles` uses — so `~{md5}` is unique by construction and the
 * uniqueness assertion below is unreachable rather than merely unlikely. Two
 * different recipes can perfectly well produce the same readable stem (`Square
 * base 2x2` at two different lock settings), so the collision path is the normal
 * case here, not an edge one.
 */
function generatedEntries(meshes: readonly GeneratedArchiveMesh[]): ArchiveGeneratedEntry[] {
  const preferred = meshes.map((mesh) => ({ mesh, name: GENERATED_PREFIX + sanitizePath(mesh.stem) }))
  const counts = new Map<string, number>()
  for (const { name } of preferred) counts.set(name, (counts.get(name) ?? 0) + 1)

  return preferred.map(({ mesh, name }) => ({
    kind: 'generated' as const,
    name: (counts.get(name) ?? 0) > 1 ? suffixWithBlob(name, mesh.blob) : name,
    blob: mesh.blob,
    bytes: mesh.bytes,
    recipes: [...mesh.recipes].sort(),
    quantity: mesh.quantity,
  }))
}

/** `wall.stl` → `wall~{md5}.stl`. `entries.ts`'s rule, applied to the other namespace. */
function suffixWithBlob(name: string, blob: BlobId): string {
  const dot = name.lastIndexOf('.')
  const slash = name.lastIndexOf('/')
  if (dot <= slash + 1) return `${name}~${blob}`
  return `${name.slice(0, dot)}~${blob}${name.slice(dot)}`
}

/**
 * No digest is claimed by both a catalogued file and a generated mesh.
 *
 * The composed {@link BlobSource} that serves this pack answers on the digest, so
 * a shared one would have two answers and would silently pick whichever the
 * caller's composition ordered first. See {@link GeneratedDigestCollisionError}.
 */
function assertNoDigestCollision(
  files: readonly ArchiveFileEntry[],
  generated: readonly ArchiveGeneratedEntry[],
): void {
  if (generated.length === 0) return
  const catalogued = new Map(files.map((file) => [file.blob, file.name]))
  for (const entry of generated) {
    const clash = catalogued.get(entry.blob)
    if (clash !== undefined) throw new GeneratedDigestCollisionError(entry.blob, clash)
  }
}

/**
 * Every entry name in the archive is distinct.
 *
 * `entries.ts` already proves it across the models, over their own namespace.
 * What it cannot see is the licensing entries, the generated notice and the
 * `generated/` subtree, and the whole point of an assertion here is that it is
 * over the finished list — the one the ZIP is actually written from — rather than
 * over any one contributor's slice of it.
 */
function assertUniqueNames(entries: readonly ArchiveEntry[]): void {
  const seen = new Set<string>()
  for (const entry of entries) {
    if (seen.has(entry.name)) {
      throw new ArchiveNamingError(`entry name "${entry.name}" is used twice in one archive`)
    }
    seen.add(entry.name)
  }
}

function textEntry(name: string, text: string): ArchiveTextEntry {
  return { kind: 'text', name, text, bytes: utf8Length(text) }
}

function defaultFilename(generatedAt: Date): string {
  const date = generatedAt.toISOString().slice(0, 10)
  return `openforge-room-${date}.zip`
}
