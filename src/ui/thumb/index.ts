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
 * whole one. `builder/panels/panels.css` still `@import`s the catalog's, for
 * `.of-search-input`; `screens/library/library.css` did too, for `.of-empty-*`,
 * until row A0 deleted the screen, and `screens/detail/slots/slots.css` needed
 * nothing else and no longer does.
 *
 * `useTintFilters` and `TINT_FILTER_SHEET_ID` are exported because a caller that
 * draws sprite pixels *without* this component needs both: the `url(#…)` from
 * `tintFilterId`, **and** the hook. `screens/detail/SpriteRotator.tsx` is the one
 * such caller that exists, and row X10 wired it.
 *
 * This note used to say the hook was for completeness, because "the filters are
 * already in the document" by then. **They are not, reliably.** The document gets
 * them from `TileThumb`'s layout effect, so what that sentence assumed was that
 * some *other* subtree had mounted a thumbnail — the catalog grid behind the tile
 * drawer, normally. The drawer's own subtree reaches a `TileThumb` only through
 * `screens/detail/slots/SlotFills.tsx`, which renders nothing at all for a file
 * with no accessory slot: 5,666 files declare no config and a further 2,451
 * declare only a `base` slot. And a dangling `url(#id)` renders the element
 * **unfiltered** rather than erroring (Filter Effects 1 §7.1) — raw blue, which
 * looks like the bug rather than like a missing dependency.
 *
 * So the rule is the one P1 set for `TileThumb` and it applies to every caller
 * equally: **the module that references a filter mounts the filters.** The hook is
 * idempotent by id, so a subtree that also contains a thumbnail pays nothing.
 */
export type { TileThumbProps } from './TileThumb'
export { TileThumb, sheetFrameStyle } from './TileThumb'

export { TINT_FILTER_SHEET_ID, useTintFilters } from './TintFilters'
