/**
 * The catalog screen, as one import.
 *
 * `CatalogScreen` is wired into `/catalog` in `src/routes/routeTree.tsx` and that
 * is the only place it is mounted. Everything else on this surface exists for the
 * two rows that come next:
 *
 *   - **Row 14 (library)** renders "a lighter variant of the catalog card"
 *     (design-contract.md §2.3). The thumbnail well it shares is **no longer here**
 *     — row P0 moved it to `@/ui/thumb`, because the builder's bill and palette
 *     render it too and a component four subtrees mount is not a catalog export.
 *     `LibraryToggle` is the same button in reverse. The `format` helpers are what
 *     keep a size chip and a file size reading identically on both screens.
 *   - **Row 18 (builder palette)** searches the whole catalog, so it wants
 *     `loadCatalogSearchIndex()` rather than a second engine over the same file.
 *
 * `useCatalogIndex` and `resetCatalogSearchIndex` are exported together on
 * purpose: a component test for either screen has to stub `fetch` and clear both
 * this module's memo and the shell's (`resetCatalogIndexCache`).
 *
 * Row A3 adds `availability.ts` to that surface. The library screen renders the
 * same chips, and the two screens agreeing about what an item offers is the whole
 * point of deriving it once — a second implementation would be a second answer to
 * "does this need a base", on the two screens most likely to be compared
 * side by side.
 *
 * Row X5 adds `useDraftQuery`. The builder's palette search box and this screen's
 * are not the same control — 272px with a conditional count against 520px with a
 * live one — but the draft-and-commit state machine behind them is the same thirty
 * lines, and the naive version of it silently rewinds a fast typist mid-word. One
 * implementation, two markups; `useDraftQuery.ts` carries the argument.
 */
export { CatalogScreen } from './CatalogScreen'

export type { CatalogIndex, CatalogIndexState } from './catalogIndex'
export { loadCatalogSearchIndex, resetCatalogSearchIndex, useCatalogIndex } from './catalogIndex'

export type { DraftQuery } from './useDraftQuery'
export { COMMIT_DELAY_MS, useDraftQuery } from './useDraftQuery'

export type { TileCardProps } from './TileCard'
export { AvailabilityStrip, LibraryToggle, TileCard } from './TileCard'

export type { Availability, AvailabilityChip, JoineryNote, LockChip, LockReach } from './availability'
export {
  CHIP_BUDGET,
  LOCK_CHIP_ORDER,
  availabilityChips,
  availabilityOf,
  baseRequirementHint,
  baseRequirementLabel,
  chipStripWidth,
  joineryNoteHint,
  joineryNoteLabel,
  lockChipHint,
  lockChipLabel,
} from './availability'

export {
  buildLabel,
  bytesRangeLabel,
  connLabel,
  countLabel,
  fileSizeLabel,
  fileTokenLabel,
  humaniseSegment,
  kindLabel,
  sizeLabel,
  variantTokenLabel,
} from './format'
