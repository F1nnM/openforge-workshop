/**
 * The router instance, and the type registration that makes navigation typed.
 *
 * A factory rather than a module-scope singleton: tests need a router over
 * `createMemoryHistory()`, and a module that builds a browser-history router on
 * import cannot be imported by a headless test. The app makes exactly one, in
 * `src/App.tsx`.
 */
import { createRouter } from '@tanstack/react-router'
import type { RouterHistory } from '@tanstack/react-router'

import { parseCompactSearch, stringifyCompactSearch } from '@/search/searchSchema'

import { NotFoundPlaceholder } from './placeholders'
import { routeTree } from './routeTree'

export interface WorkshopRouterOptions {
  /** Defaults to browser history. Tests pass `createMemoryHistory()`. */
  history?: RouterHistory
}

/**
 * Build a router over the v1 route tree.
 *
 * The two search options are the whole reason this app's URLs are readable.
 * TanStack's defaults JSON-encode values and then percent-encode the JSON, so a
 * four-texture filter reaches `tex=%5B%22dungeon_stone%22%2C…%5D`. The compact
 * codec in `src/search/searchSchema.ts` emits `tex=dungeon_stone~cave~towne` and
 * parses it back. Setting them at the router — not per route — is what keeps one
 * encoding across every route, including any a later PR adds.
 *
 * Scroll restoration is left off on purpose: the catalog grid is virtualised
 * with react-virtuoso (PR 13), which owns its own scroll container, and the
 * router's window-level restoration would fight it.
 */
export function createWorkshopRouter(options: WorkshopRouterOptions = {}) {
  return createRouter({
    routeTree,
    parseSearch: parseCompactSearch,
    stringifySearch: stringifyCompactSearch,
    // Strict search means a navigation carries only params the destination
    // route declares. Without it a rotted `?nonsense=` picked up from a shared
    // link rides along through every subsequent click and ends up in the next
    // link the user copies.
    search: { strict: true },
    defaultNotFoundComponent: NotFoundPlaceholder,
    ...options,
  })
}

/** The concrete router type, for the registration below and for helpers. */
export type WorkshopRouter = ReturnType<typeof createWorkshopRouter>

/**
 * Registering the router type is what turns TanStack Router from "a router with
 * types" into the reason it was chosen. With it, `<Link to="/catalog">` checks
 * the path against the tree, `search` is typed as `Partial<CatalogSearch>`, and
 * `useSearch()` returns the validated shape — a misspelled facet or a `to` that
 * does not exist is a compile error rather than a silently empty page.
 */
declare module '@tanstack/react-router' {
  interface Register {
    router: WorkshopRouter
  }
}
