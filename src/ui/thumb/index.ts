/**
 * The tile thumbnail, as one import: `import { TileThumb } from '@/ui/thumb'`.
 *
 * It lives under `ui/` rather than in either screen because both screens and both
 * builder panels render it, and it knew nothing about a card even when it was
 * declared inside one. Row P0 cut it out for the two rows that followed: P1
 * mounted the tint filters every thumb-rendering subtree has to reach, and P3
 * added the second image source. `TileThumb.tsx` carries both contracts.
 *
 * **Styling now lives here too**, in `thumb.css`, which `TileThumb.tsx` imports
 * itself — so the rules arrive with the component in all five subtrees. P3
 * moved them out of `screens/catalog/catalog.css` because it gave the well a
 * second geometry and half a stylesheet each would have been worse than either
 * whole one. `screens/library/library.css` and `builder/panels/panels.css` still
 * `@import` the catalog's, for `.of-empty-*` and `.of-search-input` respectively;
 * `screens/detail/slots/slots.css` needed nothing else and no longer does.
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
