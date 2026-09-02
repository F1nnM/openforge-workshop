/**
 * The build-time catalog pipeline.
 *
 * Import from `pipeline`, not from its modules, so the internal split can change
 * without touching the CLI or the tests. Nothing here runs in the browser: this
 * whole directory exists to turn the `openforge-catalog` fixtures into one
 * static `catalog.json`, at build time, once.
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
  fixturesDir,
  liveRows,
  loadFixtureRows,
  resolveFixturesRef,
} from './fixtures'
export type { FixtureConfig, FixtureRow } from './fixtures'
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
