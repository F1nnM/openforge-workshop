/**
 * OpenForge Workshop — the route tree.
 *
 * Six routes: landing, catalog, library and builder — architecture-plan.md
 * §14's v1 scope and design-contract.md §2's screen inventory — plus `/settings`,
 * which the contract does not list because the lock preference had no home in it
 * (§2's 40.2-point lock spread gave it one), and `/assemblies`, which row C3
 * built and could not mount because this file was not its to edit.
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
 * What `?tile=` *means* moved once, in row A4: the catalog now lists 3,822 items
 * over 8,702 files, so the param still names a file by ordinal and
 * `src/routes/tileAddress.ts` resolves that to the item plus the variant it
 * named. The route declaration is unchanged by it — the schema, the middleware
 * and the close semantics all still describe a single optional number.
 *
 * ## Why `/library` and `/` carry no search params
 *
 * The library is grouped by kind and shows everything the user saved
 * (design-contract.md §2.3); it has no facets to filter and no state worth
 * linking. Declaring the facet schema there would put filters in the URL that
 * nothing reads.
 */
import { createRootRoute, createRoute, lazyRouteComponent, stripSearchParams } from '@tanstack/react-router'

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

/**
 * `/assemblies` — row C3's guided walk through the 40 recipe templates.
 *
 * **No search params, and the selected recipe is deliberately not one.** C3's own
 * reasoning, checked against `searchSchema.test.ts` and against how `/settings`
 * shipped: this route's argument that a link must not freeze a preference applies
 * exactly, and a half-finished pick set is a preference of the worst kind. The
 * choice C3's screen holds is a `Record<stepKey, TileId>` mid-walk — putting it in
 * a URL would mean a shared link that drops the recipient into somebody else's
 * unfinished decisions, and `search: { strict: true }` on the router means it
 * would then ride along into the next link they copied.
 *
 * There is also nothing to *link*. `/library` has no params for the same reason —
 * "there is nothing on this screen worth linking to but the screen itself" — and
 * the one durable thing a finished walk produces already has a home: it puts its
 * files in the library, which is persisted.
 *
 * ## It is the tree's first lazy route, and that was measured rather than chosen
 *
 * Mounted the way the other five are — a static `import` of the screen and
 * `component: AssembliesScreen` — this route puts C3's whole screen, its
 * `assembly.ts`, its `measure.ts` and its 40-template data table into the
 * **eager chunk**, because every screen in this tree is a static import and the
 * app therefore emits one eager bundle holding all of them. Row C3 expected its
 * templates to arrive in a chunk of their own; nothing in this file would have
 * given them one.
 *
 * Three A/B builds of the same tree at a fixed `SOURCE_DATE_EPOCH`, summing the
 * three chunks `index.html` actually preloads (`index`, `catalog`, `vanilla`):
 *
 * | tree | eager raw | eager gz | eager br |
 * | --- | ---: | ---: | ---: |
 * | route not mounted | 737,133 | 232,590 | 200,057 |
 * | mounted with a static import | **785,105** | 238,423 | 203,834 |
 * | mounted with `lazyRouteComponent` | 738,157 | 232,992 | 200,530 |
 *
 * A static mount costs **+47,972 B raw / +5,833 B gzipped** in the bundle every
 * visitor to every page downloads, for a screen reached from one nav tab. The
 * lazy mount costs **+1,024 B raw / +402 B gzipped** — this declaration and the
 * `import()` — and puts the screen in a 48,269 B chunk (4,982 B brotli) that
 * arrives on the press. That is the same trade `Builder3DPanel` and
 * `GeneratorPanel` already make one level down, applied at the route for the
 * first time.
 *
 * `routes.test.ts`'s mounting block still proves the screen renders: TanStack
 * resolves a lazy component during `router.load()`, so the assertion is
 * unchanged and it is still the assertion that would fail if this route resolved
 * and rendered nothing — which is the failure row C3 was actually in, having
 * verified that `dist/` contained none of its files.
 *
 * **The other five routes would benefit the same way** and are not changed here:
 * that is a five-route edit plus this file's whole test, and it should be one
 * row's deliberate work rather than a side effect of mounting a sixth. The
 * figures above are the argument for it.
 */
export const assembliesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/assemblies',
  component: lazyRouteComponent(() => import('@/screens/assemblies'), 'AssembliesScreen'),
})

export const routeTree = rootRoute.addChildren([
  landingRoute,
  catalogRoute,
  libraryRoute,
  builderRoute,
  assembliesRoute,
  settingsRoute,
])
