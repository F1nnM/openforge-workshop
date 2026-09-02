/**
 * The tile detail drawer, as one import.
 *
 * `TileDrawer` is mounted once, by the catalog screen, and reads `?tile=` from
 * the URL — it has no `open` prop and no trigger, because the thing that opens it
 * is a `<Link>` on a card that has already been clicked. Passing the index it has
 * already loaded is optional and preferred:
 *
 * ```tsx
 * <TileDrawer catalog={index} />
 * ```
 *
 * Passing the aggregate index too is optional and preferred where the caller has
 * one — `<TileDrawer catalog={index} aggregates={engine.aggregates} />`. A1's
 * derivation measures 86.8ms over the real corpus and it is a pure function of
 * the file, so a screen holding a `SearchEngine` should hand over the copy it
 * already built rather than let the drawer make a second one.
 *
 * The label helpers are exported for the two rows that show the same facts in a
 * smaller space — the library's card (row 14) and the builder's bill of tiles
 * (row 18). They matter here rather than as inline strings because two of the
 * four spec fields are *refusals* over most of the corpus: `Height` has no
 * numeric basis anywhere in the catalog and falls back for 79.0% of tiles, and
 * only 39.7% of footprints are a printable `W × D`. Anything re-deriving those
 * from a record by hand will end up printing a blank or a guess. Row A5 narrowed
 * each one's parameter to the fields it actually reads, so an aggregate or a
 * variant can be passed where a whole `CatalogRecord` used to be required — a
 * `CatalogRecord` still satisfies every one of them.
 *
 * ## What row C2 gets from here
 *
 * `slotRows` is the slot contract: A1's union-with-provenance, with the `base`
 * slot removed (it restates `needsBase` and is rows D1/A6's) and each remaining
 * slot carrying whether it is universal and, when it is not, **which files**
 * declare it. That leaves 552 slots over 445 aggregates as the accessory surface.
 * `AggregateSlot` still has no stable key, so `SlotRow.at` is a per-build array
 * position and must not be persisted — C1 already asked A1 for one.
 */
export type { TileDrawerProps } from './TileDrawer'
export { TileDrawer } from './TileDrawer'

export type { VariantChoice, VariantsTableProps } from './VariantsTable'
export { VariantsTable } from './VariantsTable'

export type { SpriteRotatorProps } from './SpriteRotator'
export { PREVIEW_PX, SpriteRotator } from './SpriteRotator'

export type {
  BlobFacts,
  BuildFacts,
  FamilyFacts,
  FileFacts,
  FootprintBasis,
  FootprintFacts,
  HeightBasis,
  KindFacts,
  SpecValue,
  TextureFacts,
} from './labels'
export {
  HEIGHT_WORDS,
  NO_FOOTPRINT,
  NO_HEIGHT,
  SHAPE_WORDS,
  buildLabel,
  componentLabel,
  familyTrail,
  fileLabel,
  footprintLabel,
  formatFileSize,
  formatUnits,
  heightLabel,
  storageAddress,
  textureSetLabel,
} from './labels'

export type { JoinFace, MinParts, SlotRow, VariantJoin, VariantRow } from './variants'
export { joinsOf, optionNote, slotRows, systemLabel, variantRows } from './variants'

export type { SpriteAngle } from './spriteFrames'
export {
  AZIMUTH_STEP_DEG,
  BOTTOM_FRAME,
  DRAG_STEP_PX,
  POLE_DRAG_PX,
  RING_FRAMES,
  SPRITE_ANGLES,
  TOP_FRAME,
  frameBackground,
  frameCell,
  frameCode,
  frameName,
  isPole,
  spriteSheetUrl,
  stepRing,
} from './spriteFrames'
