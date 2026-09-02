/**
 * Routing, as one import.
 *
 * Screens should reach for `getRouteApi('/catalog')` or the exported route
 * objects rather than re-declaring search shapes; the search contract itself
 * lives in `@/search/searchSchema` and is re-exported from there, not copied.
 *
 * Row A4 added `./tileAddress`: what the `?tile=` param addresses now that the
 * catalog lists items rather than files, and the only place a number for a URL is
 * taken off an aggregate.
 */
export { createWorkshopRouter } from './router'
export type { WorkshopRouter, WorkshopRouterOptions } from './router'
export { builderRoute, catalogRoute, landingRoute, libraryRoute, rootRoute, routeTree } from './routeTree'
export type { TileSubject, TileTarget } from './tileAddress'
export { resolveTileTarget, tileOrdinal } from './tileAddress'
export { closeTileDrawer, openTileDrawer, showTileInDrawer } from './tileDrawer'
