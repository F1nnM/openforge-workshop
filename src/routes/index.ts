/**
 * Routing, as one import.
 *
 * Screens should reach for `getRouteApi('/')` or the exported route
 * objects rather than re-declaring search shapes; the search contract itself
 * lives in `@/search/searchSchema` and is re-exported from there, not copied.
 *
 * Row A4 added `./tileAddress`: what the `?tile=` param addresses now that the
 * catalog lists items rather than files, and the only place a number for a URL is
 * taken off an aggregate.
 *
 * Row A0 removed `libraryRoute`, and the sidebar row `landingRoute` and
 * `assembliesRoute`. `routeTree.tsx` carries why each is gone and where the
 * surfaces that were not about the deleted screen went.
 */
export { createWorkshopRouter } from './router'
export type { WorkshopRouter, WorkshopRouterOptions } from './router'
export { builderRoute, catalogRoute, rootRoute, routeTree } from './routeTree'
export type { TileSubject, TileTarget } from './tileAddress'
export { resolveTileTarget, tileOrdinal } from './tileAddress'
export { closeTileDrawer, openTileDrawer, showTileInDrawer } from './tileDrawer'
