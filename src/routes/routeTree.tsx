/**
 * OpenForge Workshop — the route tree.
 *
 * Five routes: landing, catalog, library and builder — architecture-plan.md
 * §14's v1 scope and design-contract.md §2's screen inventory — plus `/settings`,
 * which the contract does not list because the lock preference had no home in it.
 * §2's 40.2-point lock spread gave it one.
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
import { BuilderScreen } from '@/screens/builder'
import { CatalogScreen } from '@/screens/catalog'
import { Landing } from '@/screens/landing'
import { LibraryScreen } from '@/screens/library'
import { SettingsScreen } from '@/screens/settings'
import { AppFrame } from '@/ui/shell'

import { ErrorPlaceholder, NotFoundPlaceholder } from './placeholders'

/**
 * The frame every screen renders inside.
 *
 * `notFoundComponent` and `errorComponent` are set here rather than left to the
 * router's defaults so that a bad path and a thrown screen both render
 * something. Both render *inside* `AppFrame` — they are children of this route —
 * so a 404 keeps the header and the user keeps a way out.
 */
export const rootRoute = createRootRoute({
  component: AppFrame,
  notFoundComponent: NotFoundPlaceholder,
  errorComponent: ErrorPlaceholder,
})

export const landingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Landing,
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
  component: CatalogScreen,
})

export const libraryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/library',
  component: LibraryScreen,
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
  component: BuilderScreen,
})

/**
 * `/settings` — the lock system, and nothing else yet.
 *
 * No search params, for the same reason `/library` has none: there is nothing on
 * this screen worth linking to but the screen itself. The one piece of state it
 * edits is the global lock preference, which is persisted in the store rather
 * than in the URL — putting it in a search param would make a shared link
 * silently change the recipient's build settings.
 *
 * Not in the header's nav. The header (`src/ui/shell/Header.tsx`) belongs to
 * PR 12 and lists the three screens a visitor moves between; a fourth tab for a
 * one-line setting would spend a permanent slot in the primary navigation on
 * something almost nobody needs to change. The route is reached from
 * `LockNotice`, which the builder mounts. That leaves a real gap while the
 * notice is dismissed and unmounted, and it is called out in this PR's report:
 * one line in `Header.tsx` or in row 16's footer closes it, and neither file is
 * this PR's to edit.
 */
export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsScreen,
})

export const routeTree = rootRoute.addChildren([
  landingRoute,
  catalogRoute,
  libraryRoute,
  builderRoute,
  settingsRoute,
])
