/**
 * The thumbnail pipeline's public surface.
 *
 * Mirrors `pipeline/index.ts`: the CLI and the tests import from here, so a
 * module can be split without touching either. Build-time only — nothing in
 * `src/**` imports this, and nothing here reaches the browser bundle.
 */
export {
  CATALOG_PATH,
  DEFAULT_CACHE_DIR,
  DEFAULT_OUT_DIR,
  REPO_ROOT,
  loadCatalog,
  spriteTargets,
  spriteUrl,
  thumbKey,
  thumbPath,
  thumbPrefix,
  thumbUrl,
} from './catalog'
export type { SheetTarget, TargetList } from './catalog'
export { neutrality, poolNeutrality } from './colour'
export type { Neutrality, NeutralityOptions } from './colour'
export {
  DEFAULT_CONCURRENCY,
  DEFAULT_MIN_INTERVAL_MS,
  DEFAULT_RETRIES,
  DEFAULT_TIMEOUT_MS,
  SheetFetchError,
  USER_AGENT,
  backoffMs,
  cachePath,
  fetchSheet,
  mapLimit,
} from './fetch'
export type { FetchOptions, SheetBytes } from './fetch'
export { assertSheetExtent, frameRect, sheetExtent } from './geometry'
export type { FrameRect } from './geometry'
export {
  DEFAULT_PROBE_CONCURRENCY,
  DEFAULT_PROBE_INTERVAL_MS,
  DEFAULT_PROBE_RETRIES,
  THUMB_EXTENSION,
  probeThumbs,
  thumbCandidates,
} from './inventory'
export type { ProbeEvent, ProbeOptions, ProbeOutcome, ProbeReport } from './inventory'
export {
  MANIFEST_VERSION,
  THUMB_CACHE_CONTROL,
  buildUploadManifest,
  encoderVersions,
  serialiseUploadManifest,
  uploadCommands,
} from './manifest'
export type { ManifestEntry, ManifestInputs, UploadManifest } from './manifest'
export { PR13, PR13_UNIT_NOTE, formatBytes, measure, percentile, spread } from './measure'
export type { CorpusInputs, Measurement, MeasureOptions, Spread, ThumbStat } from './measure'
export { THUMB_QUALITY, THUMB_SIZE, cropFrame, renderThumbnail } from './render'
export type { RenderOptions, Tone } from './render'
export { runThumbnails } from './run'
export type { ProgressEvent, RunFailure, RunOptions, RunReport, StagedFile } from './run'
export {
  DEFAULT_SAMPLE_SIZE,
  MEASURED_CARD_RUN,
  SCREENFUL_CARDS,
  selectAll,
  selectSample,
  selectScreenful,
  strataCounts,
} from './sample'
export type { SampleOptions, SamplePick, SampleReason } from './sample'
