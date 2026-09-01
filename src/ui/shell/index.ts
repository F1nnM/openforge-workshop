/**
 * The app shell, as one import.
 *
 * `AppFrame` is wired into the root route in `src/routes/routeTree.tsx`, and that
 * is the only place it is mounted. `Header` is deliberately not exported: a
 * second one inside a screen would be a second navigation landmark, which is the
 * kind of thing that is invisible on screen and confusing to a screen reader.
 * The rest of this surface exists for the screens:
 *
 *   - `loadCatalogIndex()` — the shared, memoised fetch of `catalog.json`. Rows
 *     13 and 16 both need every record; call this rather than fetching it again.
 *     See the note in `catalogStats.tsx` about where this function should
 *     eventually live.
 *   - `useCatalogStats()` / `CatalogStatsProvider` — the header's tile count and
 *     archive host, and the way to supply them from a test or from a screen that
 *     has already loaded the index.
 */
export { AppFrame } from './AppFrame'
export {
  CatalogStatsProvider,
  loadCatalogIndex,
  loadCatalogStats,
  resetCatalogIndexCache,
  useCatalogStats,
} from './catalogStats'
export type { CatalogStats, CatalogStatsProviderProps } from './catalogStats'
