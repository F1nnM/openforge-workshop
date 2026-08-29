/**
 * OpenForge Workshop — the route tree.
 *
 * Four routes, matching architecture-plan.md §14's v1 scope and
 * design-contract.md §2's screen inventory: landing, catalog, library, builder.
 * The mock made all four client-side *state*, which is why nothing in it was
 * linkable — no filtered view, no open tile, no shared build. This module is the
 * fix, and the point of it is that the URL is the app's state.
 *
 * ## Why the tree is code-based, not file-based
 *
 * File-based routing needs `@tanstack/router-plugin` registered in
 * `vite.config.ts` and a generated `routeTree.gen.ts` in the repo. That file
 * belongs to PR 1, `package.json` is being edited by PR 4 right now, and the
 * plugin is a dependency this PR was told to stop and ask for. Against that: the
 * tree is four routes and forty lines, and every route's search contract is
 * visible in one screen. Code-based is not the compromise here — a generated
 * file for four routes would be the compromise.
 *
 * ## Why the tile detail drawer is search state, not a nested route
 *
 * design-contract.md §2.5 puts tile detail in a 442px drawer over the catalog,
 * so `/catalog/tile/$ord` and `?tile=` are both available. Back and forward
 * behave identically under either — a push is a push. Three things decide it:
 *
 *   1. **Garbage tolerance.** `?tile=nonsense` degrades to `null`, which is a
 *      closed catalog. `/catalog/tile/nonsense` is a path parse failure, and
 *      without a hand-written not-found boundary that is a blank page. Every
 *      other param in this app degrades to a default; the drawer should not be
 *      the one that throws.
 *   2. **One state, three consumers.** The facets are read by the catalog
 *      screen, the builder palette and the share-link codec (see
 *      `src/search/searchSchema.ts`). A nested route would split "what is the
 *      catalog showing" across `params` and `search`, so the share codec would
 *      have to serialise a pathname as well as a search object.
 *   3. **A path segment claims to be a page.** `/catalog/tile/4821` is a URL a
 *      crawler indexes and a user lands on cold, with no filters behind it.
 *      `?tile=4821` degrades to the catalog with a drawer open, which is what
 *      the drawer *is*.
 *
 * The one thing search state has to get right is the close action: a plain
 * navigate to `tile: null` would push a third entry and make Back re-open the
 * drawer. `src/routes/tileDrawer.ts` owns that, and the test file proves it.
 *
 * ## Why `/library` and `/` carry no search params
 *
 * The library is grouped by kind and shows everything the user saved
 * (design-contract.md §2.3); it has no facets to filter and no state worth
 * linking. Declaring the facet schema there would put filters in the URL that
 * nothing reads.
 */
import { createRootRoute, createRoute, stripSearchParams } from '@tanstack/react-router'

import {
  defaultCatalogSearch,
  defaultFacetSearch,
  validateCatalogSearch,
  validateFacetSearch,
} from '@/search/searchSchema'

import {
  AppFramePlaceholder,
  BuilderPlaceholder,
  CatalogPlaceholder,
  ErrorPlaceholder,
  LandingPlaceholder,
  LibraryPlaceholder,
  NotFoundPlaceholder,
} from './placeholders'

/**
 * The frame every screen renders inside.
 *
 * `notFoundComponent` and `errorComponent` are set here rather than left to the
 * router's defaults so that a bad path and a thrown screen both render
 * something. PR 12 replaces the component; it should keep both boundaries.
 */
export const rootRoute = createRootRoute({
  component: AppFramePlaceholder,
  notFoundComponent: NotFoundPlaceholder,
  errorComponent: ErrorPlaceholder,
})

export const landingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: LandingPlaceholder,
})

/**
 * The catalog: facets, free text, and the tile whose drawer is open.
 *
 * `stripSearchParams(defaultCatalogSearch())` is what keeps the URL honest.
 * TanStack runs `validateSearch` first, so the middleware sees a fully populated
 * search object and deletes every key still equal to its default. Unfiltered is
 * therefore `/catalog`, not `/catalog?q=&kinds=&tex=&build=&conn=&tile=null`,
 * and a link only ever spells out what the user actually chose.
 */
export const catalogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/catalog',
  validateSearch: validateCatalogSearch,
  search: { middlewares: [stripSearchParams(defaultCatalogSearch())] },
  component: CatalogPlaceholder,
})

export const libraryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/library',
  component: LibraryPlaceholder,
})

/**
 * The builder. Carries the facets because design-contract.md §2.4 gives the
 * palette a search box over the whole catalog, and that search deserves to be
 * linkable for the same reason the catalog's does.
 *
 * The share-link payload rides in the URL *fragment* (§13: columnar JSON →
 * `CompressionStream('deflate-raw')` → base64url), not in a search param, so it
 * is deliberately absent from this schema. PR 10 owns the codec and reads
 * `location.hash`; a compressed room in a query param would be validated,
 * re-encoded and canonicalised by this layer for no benefit.
 */
export const builderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/builder',
  validateSearch: validateFacetSearch,
  search: { middlewares: [stripSearchParams(defaultFacetSearch())] },
  component: BuilderPlaceholder,
})

export const routeTree = rootRoute.addChildren([landingRoute, catalogRoute, libraryRoute, builderRoute])
