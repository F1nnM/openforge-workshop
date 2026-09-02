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
 *
 * `useTintFilters` and `TINT_FILTER_SHEET_ID` are exported for completeness, not
 * because a caller should reach for them: `TileThumb` already calls the hook, so
 * a thumbnail is tinted by rendering it and nothing else. The only reason to
 * touch them directly is a subtree that draws sprite pixels *without* this
 * component — `screens/detail/SpriteRotator.tsx` is the one that exists — and
 * even then the filters are already in the document, so what such a caller
 * wants is the `url(#…)` from `tintFilterId`, not this hook.
 */
export type { TileThumbProps } from './TileThumb'
export { TileThumb, sheetFrameStyle } from './TileThumb'

export { TINT_FILTER_SHEET_ID, useTintFilters } from './TintFilters'
