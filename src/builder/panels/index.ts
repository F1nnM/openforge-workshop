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
 *
 * Row S5's generated bases reach two of these. `BillPanel` takes an optional
 * `generated` prop and renders `GeneratedBillSection` inside its scroll area;
 * `useArchiveDownload` takes an optional `generated` option and composes the
 * pack. Both are optional so a caller that has no generated map — every one but
 * the builder — is unchanged, and neither puts row S5's `pack.ts` in the entry
 * chunk: the hook reaches it through a dynamic `import()` on the press.
 */
export { PalettePanel } from './PalettePanel'
export type { PalettePanelProps } from './PalettePanel'
export { COMMIT_DELAY_MS } from './PalettePanel'

export { PlanToolbar } from './PlanToolbar'
export type { PlanToolbarProps } from './PlanToolbar'

export { BillPanel } from './BillPanel'
export type { BillPanelProps } from './BillPanel'

export { GeneratedBillSection } from './GeneratedBillSection'
export type { GeneratedBillSectionProps } from './GeneratedBillSection'

export { DownloadAction } from './DownloadAction'
export type { DownloadActionProps } from './DownloadAction'

export { useArchiveDownload } from './useArchiveDownload'
export type {
  ArchiveDownload,
  ArchiveDownloadOptions,
  DownloadFailure,
  DownloadFailureKind,
  DownloadState,
  GeneratedDownload,
} from './useArchiveDownload'

export { MAX_SEARCH_ROWS, armFile, armedItem, paletteRows, searchRows, starterSet } from './palette'
export type { PaletteLookup, PaletteRow, PaletteSource } from './palette'

export { billInventory, noteCopy, resolutionSummary, rowResolutionCopy, thresholdLabel, verdictCopy } from './billView'
export type {
  BillInventory,
  BillPlacement,
  BillRow,
  NoteCopy,
  ResolutionSummary,
  RowResolution,
  RowResolutionCopy,
  VerdictCopy,
} from './billView'
