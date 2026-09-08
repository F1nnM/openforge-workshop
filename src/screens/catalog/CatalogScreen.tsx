/**
 * `/` — the catalog, design-contract.md §2.2.
 *
 * A responsive card grid at `repeat(auto-fill, minmax(215px, 1fr))` with a 16px
 * gap, and a search input capped at 520px with a live result count beside it.
 *
 * **The facet sidebar is not in this layout any more, and it is still this
 * screen's.** §2.2 put a 238px sidebar in a second column; the sidebar row moved
 * it into the frame's rail, under the wordmark and the nav, because the mockup
 * draws one column of chrome rather than two. It renders through `<RailSlot>` —
 * a portal, so this component still owns it, still re-renders it when the URL's
 * facets change, and does not hand `FacetSidebar` to `AppFrame`. Everything
 * about the sidebar except *where its DOM lands* is unchanged, including the
 * skeleton.
 *
 * The screen is at `/` because the landing page that was there is deleted;
 * `src/routes/routeTree.tsx` carries that argument and the four deleted paths.
 *
 * ## What this component owns, and what it delegates
 *
 * It owns the layout, the four render states (loading, error, empty, results) and
 * exactly one derivation: `engine.search(search)`. Everything else is somebody
 * else's already-landed module and is called rather than reimplemented —
 * filtering and facet counting by `@/search`, the URL contract by
 * `@/search/searchSchema` through `facetState.ts`, library membership by
 * `@/store`, materials by `@/materials`, the one fetch of `catalog.json` by
 * `@/ui/shell`.
 *
 * **There is no filtering code in this screen.** The single `search()` call
 * returns the matching items *and* the live facet counts, and the counts already
 * exclude their own facet's filter — which is the property that keeps the sidebar
 * from becoming a dead end after the first click. Re-deriving either here would
 * be a second implementation of the thing the tests in `src/search/` prove.
 *
 * ## A result is an item — 3,822 of them over 8,702 files
 *
 * Row A2 made `search()` return {@link TileAggregate}s and kept `ids` as one
 * preview tile id per item in the same order, so this screen hands the grid both
 * and derives exactly one further number: the files behind the matching items,
 * for the count line. That sum is a walk over at most 3,822 items and is
 * memoised with the search, which is the only reason it is computed here rather
 * than being asked of the engine — the engine's `files` is the *corpus* total
 * and does not narrow with a filter.
 *
 * ## The drawer is mounted here, and until row X2 it was mounted nowhere
 *
 * `src/screens/detail/index.ts` has said since row 13 that *"`TileDrawer` is
 * mounted once, by the catalog screen"*. It was not. Every card links to
 * `?tile={ordinal}` and the drawer reads that param, so the link worked, the URL
 * changed, and nothing opened — and because nothing imported the component,
 * `detail.css`, the sprite rotator, the variants table and `Tile3DPanel` were all
 * tree-shaken out of `dist/` entirely. It is one line, and it is the line that
 * makes row 21's 3D panel and row A5's variants table reachable at all.
 *
 * Both optional props are passed, which is the documented preferred form: the
 * screen has already fetched and parsed the 5.6 MB index and already holds the
 * engine, and `buildAggregateIndex` measures 86.8 ms over the real corpus, so
 * letting the drawer derive a second copy would pay that on the first open for
 * nothing.
 *
 * It is mounted **outside** `.of-catalog-results` and unconditionally, rather
 * than beside the grid or behind the `ready` state. Unconditionally because the
 * drawer's own `unknown` state is the honest answer to a rotted `?tile=` link and
 * it can only render that if it is mounted; outside the results column because
 * it is an overlay on the scrim and has no place in the grid's flow.
 *
 * ## It renders a `<section>`, not a `<main>`
 *
 * `AppFrame` owns the document's one `<main>`. The `<h1>` is clipped rather than
 * absent: the rail names the app, the nav marks the active tab, and the page
 * still needs a top-level heading for a screen-reader rotor — but the contract's
 * catalog opens on the search field, not on a title, and adding a visible one
 * would push the grid down by a line the design does not have.
 */
import { getRouteApi } from '@tanstack/react-router'
import { useMemo } from 'react'

import { TileDrawer } from '@/screens/detail'
import { RailSlot } from '@/ui/shell'

import { useCatalogIndex } from './catalogIndex'
import { FacetSidebar } from './FacetSidebar'
import { hasActiveFilter, useFacetActions } from './facetState'
import { SearchField } from './SearchField'
import { TileGrid, TileGridEmpty, TileGridSkeleton } from './TileGrid'

import './catalog.css'

const catalogApi = getRouteApi('/')

export function CatalogScreen() {
  const search = catalogApi.useSearch()
  const state = useCatalogIndex()
  const actions = useFacetActions()
  const filtered = hasActiveFilter(search)

  // `useSearch()` is structurally shared by the router, so this recomputes when
  // a facet or the query actually changes and not on every unrelated re-render.
  // The engine answers an unfiltered query in ~2.6 ms, so there is nothing to
  // defer to a worker or a transition.
  const result = useMemo(
    () => (state.status === 'ready' ? state.index.engine.search(search) : null),
    [state, search],
  )

  // Files behind the matching items. Memoised on the result rather than computed
  // in the render body, so a store change that re-renders the screen does not
  // re-walk the whole match set.
  const files = useMemo(
    () => result?.items.reduce((total, item) => total + item.variants.length, 0) ?? 0,
    [result],
  )

  if (state.status === 'error') {
    return (
      <section className="of-catalog" aria-label="Catalog">
        <h1 className="of-sr-only">Catalog</h1>
        <CatalogError message={state.error.message} onRetry={state.retry} />
      </section>
    )
  }

  return (
    <section className="of-catalog" aria-label="Catalog">
      <h1 className="of-sr-only">Catalog</h1>

      {/* Into the frame's rail, under the nav. The two branches are the ones
          this screen has always had — the error state above returns before
          either, because a rail full of facet groups over an index that failed
          to load would offer filters for nothing. */}
      <RailSlot>
        {state.status === 'loading' ? <FacetSidebarSkeleton /> : null}

        {state.status === 'ready' && result !== null ? (
          <FacetSidebar
            facets={result.facets}
            total={state.index.engine.size}
            actions={actions}
            filtered={filtered}
          />
        ) : null}
      </RailSlot>

      <div className="of-catalog-results">
        <SearchField
          query={search.q}
          total={result?.total ?? 0}
          files={files}
          filtered={filtered}
          onQueryChange={actions.setQuery}
        />

        {state.status === 'loading' ? <TileGridSkeleton /> : null}

        {state.status === 'ready' && result !== null ? (
          result.total === 0 ? (
            <TileGridEmpty onClear={actions.clearAll} />
          ) : (
            <>
              <AvailabilityLegend />
              <TileGrid index={state.index} items={result.items} ids={result.ids} />
            </>
          )
        ) : null}
      </div>

      {/*
        §2.5's drawer, reading `?tile=` off the URL. See the docblock: it is
        unconditional, and both props are the index and the aggregate layer this
        screen already holds.
      */}
      <TileDrawer
        {...(state.status === 'ready'
          ? { catalog: state.index.file, aggregates: state.index.engine.aggregates }
          : {})}
      />
    </section>
  )
}

/* ------------------------------------------------------------------- legend */

/**
 * What a filled availability chip means, versus an outlined one.
 *
 * The strip on each card distinguishes "locks on its own underside" from "joins
 * its neighbours only" by **fill**, and every chip carries the claim in full as
 * clipped text — which serves a reader who cannot see the fill, and does nothing
 * for the one who can. This line is the key for them, stated once above the grid
 * rather than repeated on 3,822 cards.
 *
 * It renders real `.of-avail` chips rather than describing them, so the sample
 * cannot drift from the thing it explains. `aria-hidden`, because the sentence it
 * spells out is already on every chip it is explaining — a screen reader that
 * read this too would hear the legend and then the same words again on the first
 * card.
 *
 * Only above a non-empty grid: it is a key to something on screen, and above the
 * empty state it would be a key to nothing.
 */
function AvailabilityLegend() {
  return (
    <p className="of-avail-legend" aria-hidden="true">
      <span className="of-avail" data-kind="lock" data-state="underside">
        filled
      </span>
      locks underneath ·{' '}
      <span className="of-avail" data-kind="lock" data-state="sides">
        outlined
      </span>
      joins at the sides only
    </p>
  )
}

/* -------------------------------------------------------------- error state */

/**
 * The index failed to load.
 *
 * Rendered inside the screen rather than thrown to the route's `errorComponent`,
 * because the failure is a 364 KB request over somebody's network and the useful
 * response to it is "try again", not a replaced page. The retry is real: a
 * rejected load clears both memo caches (`catalogIndex.ts`), so pressing it
 * re-fetches rather than re-reading the same rejection.
 */
function CatalogError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="of-catalog-error" role="alert">
      <p className="of-empty-title">The catalog index could not be loaded.</p>
      <p className="of-empty-note">{message}</p>
      <button type="button" className="of-facet-clear" onClick={onRetry}>
        Try again
      </button>
    </div>
  )
}

/* ----------------------------------------------------------- sidebar skeleton */

/**
 * A sidebar-shaped shimmer, so the grid does not slide 264px left when the index
 * lands. Four groups, matching the four the real sidebar renders.
 */
function FacetSidebarSkeleton() {
  return (
    <div className="of-facets" aria-hidden="true">
      {[4, 6, 4, 5].map((rows, group) => (
        <div className="of-facet-group" key={group}>
          <div className="of-pending-line of-pending-short of-shimmer" />
          {Array.from({ length: rows }, (_, row) => (
            <div className="of-pending-line of-shimmer" key={row} />
          ))}
        </div>
      ))}
    </div>
  )
}
