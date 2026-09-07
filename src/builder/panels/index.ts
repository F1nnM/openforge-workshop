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
 * Row **A0** adds a fourth: `BackupPanel`, the JSON export/import that was the
 * deleted library screen's and is the app's only backup path. It is a panel for
 * the reason its own docblock gives — what the envelope carries is the room, and
 * this column is already everything about the room that is not the 3D surface.
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

export { BackupPanel } from './BackupPanel'

export { GeneratedBillSection } from './GeneratedBillSection'
export type { GeneratedBillSectionProps } from './GeneratedBillSection'

export { DownloadAction } from './DownloadAction'
export type { DownloadActionProps } from './DownloadAction'

export { IncompleteSceneError, useArchiveDownload } from './useArchiveDownload'
export type {
  ArchiveDownload,
  ArchiveDownloadOptions,
  DownloadFailure,
  DownloadFailureKind,
  DownloadState,
  GeneratedDownload,
} from './useArchiveDownload'

export {
  ALL_FACETS,
  MAX_RECENT,
  SECTION_LABEL,
  candidateCount,
  createCounter,
  filterFamilies,
  forgetRecentFamilies,
  groupFamilies,
  matchesQuery,
  paletteSections,
  queryTokens,
  rankFamilies,
  reachableFacets,
  recentArms,
  rememberArm,
  rowScore,
} from './palette'
export type {
  CandidateCounter,
  PaletteFacets,
  PaletteGroup,
  PaletteSection,
  RecentArm,
  SectionKey,
} from './palette'

/* Row C1's family model, with row D2's two kinds. `PLACEABLE_TEMPLATES` is the
   list a recipe table must be built from now that the palette arms all 87 — see
   its own docblock, and C1's report, for what happens to a placement whose id is
   not in it; it still holds all 87, because splitting the *palette* into two
   sections splits nothing the resolver looks up. `GROUP_ORDER` is the eight
   single-tile groups: an assembly has no role and therefore no group. */
export {
  ANY_SIZE_LABEL,
  GROUP_LABEL,
  GROUP_ORDER,
  INSERT_DESIGNS,
  NO_BUILD,
  PLACEABLE_TEMPLATES,
  TEMPLATE_FAMILIES,
  axisLabel,
  familyById,
  positionOf,
  sizeLabelOf,
} from './families'
export type { FamilyKind, GroupKey, SizePosition, TemplateFamily } from './families'

/* The drawer's question, without the template table — `familyKey.ts` carries the
   A/B build that says why those are two modules. */
export { AXIS_LABEL, BASE_FAMILY, armForTags, armNameForTags, armRefusalFor, familyName, familySlug, sizeTagsOf } from './familyKey'
export type { ArmRefusal, FamilyArm } from './familyKey'

export { billInventory, noteCopy, thresholdLabel, verdictCopy } from './billView'
export type { BillInventory, BillPlacement, BillRow, NoteCopy, VerdictCopy } from './billView'
