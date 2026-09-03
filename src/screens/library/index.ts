/**
 * The library screen, as one import.
 *
 * `src/routes/routeTree.tsx` swaps `LibraryPlaceholder` for `LibraryScreen` on
 * the `/library` route; that one `component:` reference is the only change this
 * PR makes outside this directory.
 *
 * `collectLibrary` and the grouping rule are exported because row 18's builder
 * palette shows "the library itself as a selectable list"
 * (design-contract.md §2.4) and should group and count it the same way this
 * screen does rather than arriving at a second precedence order. Nothing outside
 * this directory imports them today.
 */
export { LibraryScreen } from './LibraryScreen'

export type {
  CollectLibraryOptions,
  LibraryContents,
  LibraryGroup,
  LibraryItem,
} from './grouping'
export { KIND_PRECEDENCE, collectLibrary, groupKindOf, roundBytesLabel, totalBytesLabel } from './grouping'
