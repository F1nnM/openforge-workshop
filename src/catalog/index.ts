/**
 * The catalog contract's public surface.
 *
 * Import from `@/catalog`, not from `@/catalog/schema`, so the module can be
 * split later without touching five other workstreams. Everything here is a Zod
 * schema, a type inferred from one, a measured constant, or a helper over them —
 * no data and no I/O.
 *
 * Row A1 added the second module behind this barrel: `./aggregate` derives one
 * catalog item per `design` from a parsed `CatalogFile`. It is still no data and
 * no I/O — a pure function of the artefact, memoisable on its version stamp, the
 * same contract `buildAssemblyIndex` offers.
 */
export type {
  AggregateClass,
  AggregateIndex,
  AggregateSlot,
  AggregateStats,
  BaseRequirement,
  TileAggregate,
  TileVariant,
  VariantPreference,
  VariantSelection,
  VariantVerdict,
} from './aggregate'
export { aggregateAddress, buildAggregateIndex, selectVariant, variantsByPreference } from './aggregate'
export { copiesOf, faceVector, isModelledIn, mountsFor } from './mounts'
export type { ArcBandEvidence, ArcFootprint } from './schema'
export {
  ARC_BAND_EVIDENCE,
  AggregateAddress,
  ArcBand,
  ArcBandBasis,
  BlobId,
  CatalogAssets,
  CatalogFile,
  CatalogRecord,
  CompositionConfig,
  ConstrainRef,
  DEFAULT_ROTATION_STEP_DEG,
  DesignId,
  Face,
  Footprint,
  GRID_UNIT_MM,
  HoleMount,
  InsertAnchor,
  Layer,
  MAX_SECTOR_SWEEP_DEG,
  MEASURED_SPRITE_SHEET,
  MEASURED_THUMB,
  ManifestOrdinal,
  Mount,
  OpeningMount,
  PartSlot,
  SCHEMA_VERSION,
  SocketMount,
  SpriteSheet,
  SurfaceMount,
  TagId,
  TagRef,
  TileId,
  Vec3,
  VersionStamp,
  WALL_THICKNESS_MM,
  WALL_THICKNESS_UNITS,
  arcBandIsMeasured,
  arcInterfaceRadius,
  resolveTags,
  shardedPath,
} from './schema'
