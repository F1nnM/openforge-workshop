/**
 * Facet state lives in the URL. This is the only thing that writes it.
 *
 * There is deliberately **no component state shadowing a facet**. The sidebar
 * renders from `useSearch()` and every click is a navigation, which is what makes
 * a filtered view shareable, restorable and Back-able for free. A local `useState`
 * mirror would be a second source of truth that drifts on the first Back press.
 *
 * ## Push or replace — the one decision this file exists to make
 *
 * TanStack pushes by default, and defaults are wrong in both directions here:
 *
 *   - **A facet click pushes.** Selecting `cave` is a decision, and Back undoing
 *     one decision is what the button means. Four clicks, four entries, four
 *     Backs to the unfiltered catalog.
 *   - **A keystroke replaces.** `q` changes once per character. Pushing would
 *     make Back walk the word backwards a letter at a time and bury whatever the
 *     user was doing before under twelve entries of `?q=dungeon_ston`.
 *   - **Except the first keystroke, which pushes.** So the transition
 *     "unfiltered → searching" is one history entry and one Back press returns to
 *     the unfiltered catalog. Without this exception, typing is invisible to
 *     history and Back from a search leaves the page the user came from.
 *
 * `resetScroll` follows the same split: a new filter means a new result set and
 * the grid belongs at the top, while a keystroke mid-scroll should not yank the
 * viewport.
 *
 * ## Why `search: (prev) => …` and never a literal
 *
 * `tile` (the detail drawer, PR 15) rides in the same search object. A literal
 * would drop it, so changing a facet would close the drawer. Spreading `prev`
 * also means a param a later PR adds survives every facet click without this
 * file learning about it.
 */
import { getRouteApi } from '@tanstack/react-router'
import { useMemo } from 'react'

import type { CatalogSearch } from '@/search'
import { defaultFacetSearch, isDefaultFacetSearch } from '@/search'

/**
 * Reached by route id rather than by importing `catalogRoute`, which would make
 * this module and the route tree import each other. The id is checked against the
 * registered tree, so a renamed route is a compile error here.
 */
const catalogApi = getRouteApi('/catalog')

/** The multi-select facets. `build` is single-select and has its own action. */
export type MultiFacetKey = 'kinds' | 'tex' | 'conn'

/**
 * Every write the sidebar and the search field can make.
 *
 * Declared as function-typed **properties**, not as methods: a method signature
 * carries an implicit `this`, so passing `actions.clearAll` straight to an
 * `onClick` is a lint error and would need a wrapper arrow at every call site.
 * These never touch `this`, and saying so in the type is what lets them be used
 * as plain callbacks.
 */
export interface FacetActions {
  /** Add or remove one value of a multi-select facet. */
  readonly toggleValue: (key: MultiFacetKey, value: string) => void
  /** Drop every value of one multi-select facet — the "All components" row. */
  readonly clearValues: (key: MultiFacetKey) => void
  /**
   * Select a build system, the "unspecified" sentinel, or the empty "any".
   *
   * The encoded string, not a `BuildFilter`: the sidebar renders buckets whose
   * `value` is already the URL spelling, so decoding it here only to re-encode
   * it would add a place for the `!!`-escape to be forgotten.
   */
  readonly setBuild: (encoded: string) => void
  /** Free text. Called per keystroke; see the push/replace note above. */
  readonly setQuery: (text: string) => void
  /** Back to the unfiltered catalog, keeping the drawer open if it is. */
  readonly clearAll: () => void
}

/**
 * The facet writers for the current catalog URL.
 *
 * Reads `useSearch()` itself rather than taking the search as an argument, so a
 * caller cannot hand it a stale object and produce a navigation that resurrects
 * a filter the user just cleared.
 */
export function useFacetActions(): FacetActions {
  const navigate = catalogApi.useNavigate()
  const query = catalogApi.useSearch({ select: (search: CatalogSearch) => search.q })

  return useMemo<FacetActions>(
    () => ({
      toggleValue(key, value) {
        void navigate({
          search: (prev) => {
            const current = prev[key]
            const next = current.includes(value)
              ? current.filter((item) => item !== value)
              : [...current, value]
            // Sorted, so click order does not change the URL and two users who
            // picked the same three textures produce the same share link. The
            // schema normalises this too; doing it here as well keeps the URL
            // canonical without a round-trip through validation.
            return { ...prev, [key]: [...next].sort() }
          },
        })
      },

      clearValues(key) {
        void navigate({ search: (prev) => ({ ...prev, [key]: [] }) })
      },

      setBuild(encoded) {
        void navigate({ search: (prev) => ({ ...prev, build: encoded }) })
      },

      setQuery(text) {
        // The first character of a new search is the only keystroke worth a
        // history entry; every later one replaces it.
        const push = query === '' && text !== ''
        void navigate({
          search: (prev) => ({ ...prev, q: text }),
          replace: !push,
          resetScroll: push,
        })
      },

      clearAll() {
        void navigate({ search: (prev) => ({ ...prev, ...defaultFacetSearch() }) })
      },
    }),
    [navigate, query],
  )
}

/**
 * True when the "✕ Clear filters" affordance should be shown.
 *
 * Delegates to the schema's own predicate rather than re-listing the five
 * fields: a facet added later would otherwise be filtered but not clearable, and
 * nothing would fail.
 */
export function hasActiveFilter(search: CatalogSearch): boolean {
  return !isDefaultFacetSearch(search)
}
