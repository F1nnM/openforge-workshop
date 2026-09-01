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
 * The label helpers are exported for the two rows that show the same facts in a
 * smaller space — the library's card (row 14) and the builder's bill of tiles
 * (row 18). They matter here rather than as inline strings because two of the
 * four spec fields are *refusals* over most of the corpus: `Height` has no
 * numeric basis anywhere in the catalog and falls back for 79.0% of tiles, and
 * only 39.7% of footprints are a printable `W × D`. Anything re-deriving those
 * from a record by hand will end up printing a blank or a guess.
 */
export type { TileDrawerProps } from './TileDrawer'
export { TileDrawer } from './TileDrawer'

export type { SpriteRotatorProps } from './SpriteRotator'
export { PREVIEW_PX, SpriteRotator } from './SpriteRotator'

export type { FootprintBasis, HeightBasis, SpecValue } from './labels'
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

export type { FamilyVariant } from './variants'
export { familyVariants } from './variants'

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
