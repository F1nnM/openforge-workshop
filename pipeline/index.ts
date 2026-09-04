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
 *
 * Row B1 added `./role`, which is the first derivation here whose output is a
 * **tag** rather than a field: the `role|<x>` and `form|<x>` axes a template
 * slot predicates on, interned alongside everything the scan produced. It is
 * exported because `pipeline/families.ts` will generate the family table from
 * the same two enums, and a second copy of a closed enum is how the two halves
 * of a key silently stop agreeing.
 *
 * Row B3 added `./size`, which is the third axis of that key's *complement*: the
 * grid cell a slot predicates on, resolved per record and **emitted nowhere**.
 * Keyed on `(role, form, build)` the corpus needs 52 families; with size in the
 * key it needs 217 to 277, which is the whole reason size is a slot parameter.
 * `src/template/size.ts` carries the predicate and the encoding decision.
 *
 * Row B4 added `./families`, which is what those three were for: 51 one-slot
 * families generated from the key, with the size domain as a control on the
 * placed instance. They ride into the browser through the *same* generated
 * module as the 40 — `./templates` merges the two sources and emits one file —
 * so the index still gains 0 B and the tag table is still 930 strings.
 */
export { MIN_DETECTION_RECALL, assertAggregation, measureAggregation } from './aggregate'
export type { AggregateViolation, AggregationReport, DetectionScore } from './aggregate'
export { buildCatalog } from './build'
export type { BuildOptions, BuildResult, BuildStats } from './build'
export { buildDesignIndex, designId, designKey } from './design'
export {
  ANY_SIZE,
  BARE_BASE_KEY,
  BUILD_TAGS,
  FAMILY_TABLE_BYTES,
  SKIPPED_ROLES,
  deriveFamilies,
  familyLayout,
  familySlug,
} from './families'
export type { FamilySizePosition, GeneratedFamily } from './families'
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
export { FORMS, ROLES, fileTokens, inferForm, inferRole, roleTags } from './role'
export type { Confidence, Form, Inferred, Role, RoleInput, Signal } from './role'
export { cellExtentUnits, resolveGridSize, sizeRefusalOf } from './size'
export type { SizeRefusal } from './size'
export {
  buildTagTable,
  hasTagPrefix,
  hasTagSegment,
  namespaceRoots,
  numericTagValue,
  tagValue,
} from './tags'
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
