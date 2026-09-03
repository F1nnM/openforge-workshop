/**
 * The catalog screen, as one import.
 *
 * `CatalogScreen` is wired into `/catalog` in `src/routes/routeTree.tsx` and that
 * is the only place it is mounted. Everything else on this surface exists for the
 * two rows that come next:
 *
 *   - **Row 18 (builder palette)** searches the whole catalog, so it wants
 *     `loadCatalogSearchIndex()` rather than a second engine over the same file.
 *     It renders the same `format` helpers, so a size chip and a file size read
 *     identically in the palette, the bill and the grid.
 *
 * Row 14's library screen was the other consumer and row **A0** deleted it, with
 * `LibraryToggle` — the card's "+ Add to library" — deleted alongside. Two things
 * it owned survive here rather than with it, because neither was presentation:
 * `groupKindOf`/`KIND_PRECEDENCE`, which is the rule {@link kindLabel} labels the
 * answer of, and `totalBytesLabel`, which the builder's bill now reads for the
 * room's whole download.
 *
 * `useCatalogIndex` and `resetCatalogSearchIndex` are exported together on
 * purpose: a component test for either screen has to stub `fetch` and clear both
 * this module's memo and the shell's (`resetCatalogIndexCache`).
 *
 * Row A3 adds `availability.ts` to that surface — one derivation of "does this
 * need a base", so no second screen can arrive at a second answer.
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
export { AvailabilityStrip, TileCard } from './TileCard'

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

export type { CardTagChip } from './format'
export {
  KIND_PRECEDENCE,
  TAG_CHIP_BUDGET,
  buildLabel,
  bytesRangeLabel,
  cardTagChips,
  connLabel,
  countLabel,
  fileSizeLabel,
  fileTokenLabel,
  groupKindOf,
  humaniseSegment,
  kindLabel,
  sizeLabel,
  tagChipRowWidth,
  totalBytesLabel,
  variantTokenLabel,
} from './format'
