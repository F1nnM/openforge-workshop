/**
 * The app shell, as one import.
 *
 * `AppFrame` is wired into the root route in `src/routes/routeTree.tsx`, and that
 * is the only place it is mounted. `Rail` is deliberately not exported: a second
 * one inside a screen would be a second navigation landmark, which is the kind of
 * thing that is invisible on screen and confusing to a screen reader. The rest of
 * this surface exists for the screens:
 *
 *   - `RailSlot` — render this screen's own sidebar into the frame's rail. The
 *     catalog's filter groups and the builder's palette both arrive that way;
 *     `railSlot.tsx` carries why it is a portal and not four other things.
 *   - `loadCatalogIndex()` — the shared, memoised fetch of `catalog.json`. The
 *     catalog screen and `@/mesh` both need every record; call this rather than
 *     fetching it again. See the note in `loadCatalog.ts` about where this
 *     function should eventually live.
 *
 * **`useCatalogStats()` / `CatalogStatsProvider` are gone.** They served the old
 * header's `{n} tiles · objects.openforge.tools`, which the sidebar row deleted
 * along with the header; `loadCatalog.ts` records what that leaves.
 */
export { AppFrame } from './AppFrame'
export { loadCatalogIndex, resetCatalogIndexCache } from './loadCatalog'
export { RailSlot } from './railSlot'
export type { RailSlotProps } from './railSlot'
