/**
 * The download pack's public surface.
 *
 * Import from `@/download`, never from the modules beneath it, and never from
 * `vendor/` — `clientZip.ts` is the only module allowed to do that.
 *
 * The whole flow is four calls, and each of them can be exercised without a
 * network:
 *
 * ```ts
 * const bill = buildBillOfTiles(placements, assemblyIndex, { lock })   // PR 9
 * const plan = buildArchivePlan(bill, { assets: catalog.assets })
 * //  plan.predictedLength is the exact final size, to the byte
 * const zip  = openArchiveStream(plan, { source: r2BlobSource(catalog.assets), onProgress })
 * const done = await saveArchive(plan, zip)
 * ```
 *
 * What the shape of that flow is protecting:
 *
 *   - **The bill's md5 dedupe is consumed, not re-derived.** 171 md5s are shared
 *     by 520 catalog rows, so an id-keyed archive downloads the same file twice.
 *   - **Entry names are unique by construction.** 89 filenames carry two or
 *     three genuinely different meshes; naming entries by filename produces a
 *     wrong print, not a confusing archive. See `entries.ts`.
 *   - **The licence and the attribution table ride inside the archive**, always,
 *     with no flag to suppress them. §10, obligation 2.
 *   - **Only original STLs are ever fetched.** {@link BlobSource} takes a
 *     content address, not a URL, so there is no argument that could point the
 *     download path at a decimated preview. §10, obligation 3.
 *   - **A stream, never a `Blob`**, on the path that can stream — and an exact
 *     byte count that turns a truncated download into an error.
 *
 * ## Row S5's generated meshes, re-exported here
 *
 * `plan.ts` grew a fifth kind of thing an archive can hold: a mesh generated in
 * the browser, which was never on R2 and has no URL. The five names it added are
 * re-exported below so a caller still writes one import — and the shape of them
 * is the point rather than the names:
 *
 *   - A generated entry is **structurally a file entry**, so `stream.ts` needs no
 *     branch: it asks the injected {@link BlobSource} for everything non-text by
 *     content address, and the caller composes a source that answers for these
 *     digests out of memory. The exact-length guard, the ZIP64 accounting and
 *     §10's no-URL-argument refusal therefore all cover them unchanged.
 *   - {@link GeneratedDigestCollisionError} and the notice requirement are
 *     **refusals**, checked before a byte is fetched, because each of the
 *     failures they prevent produces an archive that opens cleanly and holds the
 *     wrong bytes.
 *   - Generated entries are deliberately **not** in `plan.files`, which is what
 *     `urlList.ts` maps over. A URL list that carried a line for a mesh that was
 *     never published would be a 404 that looks like every other line.
 *     `urlListShortfall` in `@/generator/placement/pack` is the sentence a caller
 *     offering that path has to render.
 *
 * The bytes and the notice text belong to `@/generator/placement/pack`, which
 * knows what the geometry is and where it is pinned. This module only enforces
 * that they are there.
 */
export type { AttributionRow, LicenceContext } from './attribution'
export { ATTRIBUTION_COLUMNS, CORPUS_ATTRIBUTION, CORPUS_LICENCE, TOOL_HOME, TOOL_NAME, attributionCsv, licenceText } from './attribution'

export type { ZipEntry, ZipEntryMeta } from './clientZip'
export { ZIP32_LIMIT, framingLength, needsZip64, predictZipLength, utf8Length } from './clientZip'

export {
  ATTRIBUTION_ENTRY_NAME,
  ArchiveNamingError,
  CATALOG_ROOT_PREFIX,
  LICENSE_ENTRY_NAME,
  MODELS_PREFIX,
  RESERVED_ENTRY_NAMES,
  archiveEntryNames,
  sanitizePath,
} from './entries'

export type {
  ArchiveEntry,
  ArchiveFileEntry,
  ArchiveGeneratedEntry,
  ArchivePlan,
  ArchivePlanOptions,
  ArchiveTextEntry,
  GeneratedArchiveMesh,
  GeneratedArchiveSection,
} from './plan'
export { EmptyArchiveError, GENERATED_PREFIX, GeneratedDigestCollisionError, buildArchivePlan } from './plan'

export type { SaveEnvironment, SaveFileHandle, SaveFilePickerOptions, SaveResult, SaveVia, ShowSaveFilePicker } from './save'
export {
  ArchiveTooLargeToBufferError,
  BLOB_FALLBACK_LIMIT_BYTES,
  NoSaveTargetError,
  browserSaveEnvironment,
  saveArchive,
} from './save'

export type { BlobSource } from './source'
export {
  BlobFetchError,
  DERIVATIVE_PATH_SEGMENTS,
  ORIGINAL_STL_URL,
  PreviewMeshRefusedError,
  originalStlUrl,
  r2BlobSource,
} from './source'

export type { ArchiveProgress, ArchiveStreamOptions } from './stream'
export { ArchiveLengthMismatchError, PROGRESS_INTERVAL_BYTES, openArchiveStream } from './stream'

export { urlListFilename, urlListText } from './urlList'
