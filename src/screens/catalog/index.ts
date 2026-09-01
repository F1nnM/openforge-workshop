/**
 * The catalog screen, as one import.
 *
 * `CatalogScreen` is wired into `/catalog` in `src/routes/routeTree.tsx` and that
 * is the only place it is mounted. Everything else on this surface exists for the
 * two rows that come next:
 *
 *   - **Row 14 (library)** renders "a lighter variant of the catalog card"
 *     (design-contract.md §2.3). `TileThumb` is the sprite-sheet maths — the frame
 *     offsets, the explicit dimensions, the lazy loading, the missing-sheet
 *     fallback — and re-deriving it would mean re-deriving the one part of this
 *     screen that has a measured performance problem. `LibraryToggle` is the same
 *     button in reverse. The `format` helpers are what keep a size chip and a file
 *     size reading identically on both screens.
 *   - **Row 18 (builder palette)** searches the whole catalog, so it wants
 *     `loadCatalogSearchIndex()` rather than a second engine over the same file.
 *
 * `useCatalogIndex` and `resetCatalogSearchIndex` are exported together on
 * purpose: a component test for either screen has to stub `fetch` and clear both
 * this module's memo and the shell's (`resetCatalogIndexCache`).
 */
export { CatalogScreen } from './CatalogScreen'

export type { CatalogIndex, CatalogIndexState } from './catalogIndex'
export { loadCatalogSearchIndex, resetCatalogSearchIndex, useCatalogIndex } from './catalogIndex'

export type { TileCardProps, TileThumbProps } from './TileCard'
export { LibraryToggle, TileCard, TileThumb } from './TileCard'

export {
  buildLabel,
  connLabel,
  countLabel,
  fileSizeLabel,
  humaniseSegment,
  kindLabel,
  sizeLabel,
} from './format'
