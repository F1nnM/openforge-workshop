/**
 * The catalog contract's public surface.
 *
 * Import from `@/catalog`, not from `@/catalog/schema`, so the module can be
 * split later without touching five other workstreams. Everything here is a Zod
 * schema, a type inferred from one, a measured constant, or a helper over them —
 * no data and no I/O.
 */
export {
  BlobId,
  CatalogAssets,
  CatalogFile,
  CatalogRecord,
  CompositionConfig,
  ConstrainRef,
  DEFAULT_ROTATION_STEP_DEG,
  DesignId,
  Footprint,
  GRID_UNIT_MM,
  Layer,
  MEASURED_SPRITE_SHEET,
  ManifestOrdinal,
  PartSlot,
  SCHEMA_VERSION,
  SpriteSheet,
  TagId,
  TagRef,
  TileId,
  VersionStamp,
  WALL_THICKNESS_MM,
  WALL_THICKNESS_UNITS,
  resolveTags,
  shardedPath,
} from './schema'
