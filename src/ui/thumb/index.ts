/**
 * The tile thumbnail, as one import: `import { TileThumb } from '@/ui/thumb'`.
 *
 * It lives under `ui/` rather than in either screen because both screens and both
 * builder panels render it, and it knew nothing about a card even when it was
 * declared inside one. Row P0 cut it out for the two rows that follow: P1 mounts
 * tint filters that every thumb-rendering subtree has to reach, and P3 switches
 * the image source. `TileThumb.tsx` carries the contract each of them reads.
 *
 * Styling still lives in `screens/catalog/catalog.css`, which the library's and
 * the panels' stylesheets already `@import` for those four rules. `TileThumb.tsx`
 * says why the rules did not move with the component, and which row moves them.
 */
export type { TileThumbProps } from './TileThumb'
export { TileThumb, sheetFrameStyle } from './TileThumb'
