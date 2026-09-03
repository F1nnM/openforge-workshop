/**
 * The build-time catalog pipeline.
 *
 * Import from `pipeline`, not from its modules, so the internal split can change
 * without touching the CLI or the tests. Nothing here runs in the browser: this
 * whole directory exists to turn the `openforge-catalog` fixtures into one
 * static `catalog.json`, at build time, once.
 *
 * Two artefacts now, not one. `./templates` reads the 20 `*.yaml` fixtures the
 * JSON loader deliberately skips and emits the 40 recipe templates as a
 * generated module; they are not records, carry no `file_metadata` and are not
 * in `catalog.json` — `./templates` carries the measurement behind that.
 */
export { MIN_DETECTION_RECALL, assertAggregation, measureAggregation } from './aggregate'
export type { AggregateViolation, AggregationReport, DetectionScore } from './aggregate'
export { buildCatalog } from './build'
export type { BuildOptions, BuildResult, BuildStats } from './build'
export { buildDesignIndex, designId, designKey } from './design'
export {
  assertWithinBudget,
  compressCatalog,
  formatBytes,
  measureCatalog,
  serialiseCatalog,
} from './emit'
export type { SizeReport } from './emit'
export {
  CONNECTION_POSITIONS,
  LOCK_SYSTEMS,
  buildSystem,
  classifyLayer,
  connectionSystems,
  connectionsByPosition,
  isLockSystem,
  kindBuckets,
  openlockSizeCode,
  rotationStep,
  textureRoot,
} from './facets'
export type { ConnectionPosition, ConnectionsByPosition } from './facets'
export {
  DEFAULT_FIXTURES_DIR,
  FixtureRow,
  fixtureFingerprint,
  fixturesDir,
  liveRows,
  loadFixtureRows,
  resolveFixturesRef,
} from './fixtures'
export type { FixtureConfig } from './fixtures'
export {
  COLUMN_SHAPE_TAG,
  CURVED_INTERFACE_TAG,
  DEFAULT_ARC_BAND,
  DIAGONAL_TAG,
  arcBandOf,
  footprintKind,
  hasCurveMarker,
  isDesignFragment,
  isLetteredCurvePart,
  radiusIsFeature,
  resolveFootprint,
  sizeToken,
} from './footprint'
export { displayName, fallbackName } from './naming'
export { NOT_COLLAPSED, TAG_ALIASES, normaliseTag, normaliseTags } from './normalise'
export {
  MANIFEST_PATH,
  OrdinalManifest,
  assertAppendOnly,
  assignOrdinals,
  emptyManifest,
  loadManifest,
  serialiseManifest,
  writeManifest,
} from './ordinals'
export type { OrdinalAssignment } from './ordinals'
export { buildTagTable, hasTagPrefix, namespaceRoots, numericTagValue, tagValue } from './tags'
export {
  TEMPLATES_MODULE_PATH,
  loadTemplateFixtures,
  printFixture,
  printTemplateModule,
  readTemplateFile,
  templateFixturesDir,
  templateSlug,
} from './templates'
export type { TemplateFixture } from './templates'
export {
  THUMB_INVENTORY_PATH,
  THUMB_INVENTORY_VERSION,
  ThumbInventory,
  readThumbInventory,
  serialiseThumbInventory,
  thumbBlobs,
} from './thumbs'
export {
  ASSET_BASES,
  PAYLOAD_EPOCH,
  PAYLOAD_TIMESTAMP,
  PIPELINE_VERSION,
  SIZE_BUDGET_BYTES,
  atPayloadEpoch,
  buildTimestamp,
} from './version'
