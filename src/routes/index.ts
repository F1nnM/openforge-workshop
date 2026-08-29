/**
 * Routing, as one import.
 *
 * Screens should reach for `getRouteApi('/catalog')` or the exported route
 * objects rather than re-declaring search shapes; the search contract itself
 * lives in `@/search/searchSchema` and is re-exported from there, not copied.
 */
export { createWorkshopRouter } from './router'
export type { WorkshopRouter, WorkshopRouterOptions } from './router'
export { builderRoute, catalogRoute, landingRoute, libraryRoute, rootRoute, routeTree } from './routeTree'
export { closeTileDrawer, openTileDrawer, showTileInDrawer } from './tileDrawer'
