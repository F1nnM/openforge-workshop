/**
 * The builder's three panels, as one import.
 *
 * `src/screens/builder/BuilderScreen.tsx` is the only consumer; everything here
 * is a component or a pure helper over data the screen already holds, and none of
 * it fetches, routes or persists. The split from the screen is a split by
 * *concern*, not a package boundary — the screen owns the layout, the URL and the
 * three memoised indexes, and each panel owns what goes inside its column.
 *
 * The plan-view canvas is **not** here: it is `@/builder/canvas` (row 17), which
 * this directory imports and never modifies.
 */
export { PalettePanel } from './PalettePanel'
export type { PalettePanelProps } from './PalettePanel'
export { COMMIT_DELAY_MS } from './PalettePanel'

export { PlanToolbar } from './PlanToolbar'
export type { PlanToolbarProps } from './PlanToolbar'

export { BillPanel } from './BillPanel'
export type { BillPanelProps } from './BillPanel'

export { DownloadAction } from './DownloadAction'
export type { DownloadActionProps } from './DownloadAction'

export { useArchiveDownload } from './useArchiveDownload'
export type {
  ArchiveDownload,
  ArchiveDownloadOptions,
  DownloadFailure,
  DownloadFailureKind,
  DownloadState,
} from './useArchiveDownload'

export { MAX_SEARCH_ROWS, paletteRows, searchRows, starterSet } from './palette'
export type { PaletteRow } from './palette'

export { billInventory, noteCopy, thresholdLabel, verdictCopy } from './billView'
export type { BillInventory, BillPlacement, BillRow, NoteCopy, VerdictCopy } from './billView'
