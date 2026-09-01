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

export type { ArchiveEntry, ArchiveFileEntry, ArchivePlan, ArchivePlanOptions, ArchiveTextEntry } from './plan'
export { EmptyArchiveError, buildArchivePlan } from './plan'

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
