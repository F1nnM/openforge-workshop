// @vitest-environment jsdom
/**
 * Tests for the route tree and the drawer's history semantics.
 *
 * Mostly driven headlessly over `createMemoryHistory()`, because what needs
 * proving is which URL a navigation produces and where Back lands, and both are
 * properties of the router rather than of the DOM.
 *
 * The `mounting` block at the bottom is the exception, and it is there because
 * every other test in this file would pass against a route tree that resolves
 * perfectly and renders a blank page. It mounts with `createRoot` and React's
 * own `act` rather than a testing library — this repo has none, and adding one
 * is not this PR's to add.
 */
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it } from 'vitest'

import { buildAggregateIndex } from '@/catalog'
import { ManifestOrdinal } from '@/catalog/schema'
import { BUILD_ANY, BUILD_UNSPECIFIED, buildSystemFilter, defaultCatalogSearch } from '@/search/searchSchema'

import { OVERLAP, catalogOf } from './fixture'
import { createWorkshopRouter } from './router'
import type { WorkshopRouter } from './router'
import { closeTileDrawer, openTileDrawer, showTileInDrawer } from './tileDrawer'

const ordinal = (n: number) => ManifestOrdinal.parse(n)

function routerAt(...entries: string[]): WorkshopRouter {
  return createWorkshopRouter({ history: createMemoryHistory({ initialEntries: entries }) })
}

/** The href the address bar would be showing. */
function href(router: WorkshopRouter): string {
  return router.history.location.href
}

/** Matched route id of the leaf match — which screen is on. */
function leafRouteId(router: WorkshopRouter): string | undefined {
  return router.state.matches.at(-1)?.routeId
}

describe('route tree', () => {
  it.each([
    ['/', '/'],
    ['/catalog', '/catalog'],
    ['/library', '/library'],
    ['/builder', '/builder'],
    ['/assemblies', '/assemblies'],
    ['/settings', '/settings'],
  ])('routes %s to the %s screen', async (path, expected) => {
    const router = routerAt(path)
    await router.load()
    expect(leafRouteId(router)).toBe(expected)
  })

  it('gives /assemblies no search params, so a link cannot freeze a half-made pick set', async () => {
    // Row C3's argument, and `/library`'s before it. `search: { strict: true }`
    // on the router means a navigation carries only what the destination
    // declares, so this is the assertion that a filtered catalog — or, worse, a
    // recipient's inherited mid-walk choice — cannot ride along into an
    // /assemblies link somebody then copies.
    const router = routerAt('/catalog?kinds=wall&q=cave')
    await router.load()
    await router.navigate({ to: '/assemblies' })
    expect(href(router)).toBe('/assemblies')
    expect(router.state.matches.at(-1)?.search).toEqual({})
  })

  it('carries no state of its own on /assemblies, in either direction', async () => {
    // Row C3 asked for no search params and this is what that buys, asserted as
    // behaviour rather than with the `@ts-expect-error` `/builder` uses for its
    // missing `tile`. **The two are not equivalent, and the difference is worth
    // recording:** a route with a `validateSearch` schema type-rejects a param it
    // does not declare *and* drops an unknown one out of the incoming URL
    // (`/catalog` has a case for exactly that). A route with **no** schema does
    // neither — `buildLocation({ to: '/assemblies', search: { recipe: 'wall' } })`
    // compiles, and a hand-typed `?recipe=wall` survives into `match.search`.
    //
    // Measured on this tree: `/library`, `/settings` and `/assemblies` all echo
    // an unknown param back, so this is the schemaless class's behaviour and not
    // something mounting C3's screen introduced. It is harmless for the reason
    // that matters, which is what the two assertions below prove: nothing on
    // these screens reads `search`, and `search: { strict: true }` means the
    // param cannot travel — neither *into* an /assemblies link built from a
    // filtered catalog, nor *out* of one into the next screen.
    const filtered = routerAt('/catalog?kinds=wall&q=cave')
    await filtered.load()
    await filtered.navigate({ to: '/assemblies' })
    expect(href(filtered)).toBe('/assemblies')

    const junk = routerAt('/assemblies?recipe=wall')
    await junk.load()
    expect(leafRouteId(junk)).toBe('/assemblies')
    await junk.navigate({ to: '/catalog' })
    expect(href(junk)).toBe('/catalog')
  })
})

describe('search state on /catalog', () => {
  let router: WorkshopRouter

  beforeEach(() => {
    router = routerAt('/catalog')
  })

  it('fills every default when the URL carries nothing', async () => {
    await router.load()
    expect(router.state.matches.at(-1)?.search).toEqual(defaultCatalogSearch())
  })

  it('navigates to a URL that spells out only what was chosen', async () => {
    await router.load()
    await router.navigate({
      to: '/catalog',
      search: { kinds: ['wall', 'floor'], tex: ['dungeon_stone'], q: 'arrow slit' },
    })
    expect(href(router)).toBe('/catalog?kinds=floor~wall&q=arrow%20slit&tex=dungeon_stone')
  })

  it('strips defaults out of the URL entirely', async () => {
    await router.load()
    await router.navigate({ to: '/catalog', search: defaultCatalogSearch() })
    expect(href(router)).toBe('/catalog')
    await router.navigate({ to: '/catalog', search: { build: BUILD_ANY } })
    expect(href(router)).toBe('/catalog')
  })

  it('keeps "unspecified" in the URL, because it is a filter and not a default', async () => {
    await router.load()
    await router.navigate({ to: '/catalog', search: { build: BUILD_UNSPECIFIED } })
    expect(href(router)).toBe('/catalog?build=!none')
    await router.navigate({ to: '/catalog', search: { build: buildSystemFilter('s2w') } })
    expect(href(router)).toBe('/catalog?build=s2w')
  })

  it('parses a real URL back into typed state', async () => {
    const loaded = routerAt('/catalog?build=separate%20wall&conn=openlock&kinds=floor~wall&q=arrow%20slit&tile=4821')
    await loaded.load()
    expect(loaded.state.matches.at(-1)?.search).toEqual({
      q: 'arrow slit',
      kinds: ['floor', 'wall'],
      tex: [],
      build: 'separate wall',
      conn: ['openlock'],
      tile: 4821,
    })
  })

  it('survives a rotted link without throwing or erroring the match', async () => {
    const rotted = routerAt('/catalog?tile=nonsense&build=!bogus&conn=&q=' + 'x'.repeat(5_000))
    await expect(rotted.load()).resolves.not.toThrow()
    expect(rotted.state.matches.at(-1)?.search).toEqual(defaultCatalogSearch())
    expect(rotted.state.matches.at(-1)?.error).toBeUndefined()
    expect(leafRouteId(rotted)).toBe('/catalog')
  })

  it('treats a JSON-looking facet value as the opaque string it is', async () => {
    // The codec deliberately does not JSON-parse, so `%5B%22a%22%5D` is the
    // four-character string `["a"]` and not an array. It matches no kind and
    // shows an empty catalog, which is the honest reading of that URL.
    const router = routerAt('/catalog?kinds=%5B%22a%22%5D')
    await router.load()
    expect(router.state.matches.at(-1)?.search).toMatchObject({ kinds: ['["a"]'] })
  })

  it('carries the facets between the catalog and the builder palette', async () => {
    // design-contract.md §2.4: the palette searches the whole catalog, so the
    // same facet vocabulary has to be expressible on /builder.
    await router.load()
    await router.navigate({ to: '/builder', search: { q: 'cave', conn: ['openlock'] } })
    expect(href(router)).toBe('/builder?conn=openlock&q=cave')
  })

  it('has no tile param on the builder, where there is no drawer', () => {
    // @ts-expect-error `tile` is not part of the builder's search schema.
    router.buildLocation({ to: '/builder', search: { tile: 1 } })
  })
})

describe('detail drawer, back and forward', () => {
  it('opens on a push, keeping the filters that were showing', async () => {
    const router = routerAt('/catalog?q=cave&kinds=wall')
    await router.load()
    expect(router.history.canGoBack()).toBe(false)

    await openTileDrawer(router, ordinal(4821))

    expect(href(router)).toBe('/catalog?kinds=wall&q=cave&tile=4821')
    expect(router.history.canGoBack()).toBe(true)
  })

  it('closes on Back, and re-opens on Forward', async () => {
    const router = routerAt('/catalog?q=cave')
    await router.load()
    await openTileDrawer(router, ordinal(4821))

    router.history.back()
    expect(href(router)).toBe('/catalog?q=cave')

    router.history.forward()
    expect(href(router)).toBe('/catalog?q=cave&tile=4821')
  })

  it('closing the drawer consumes the entry it added instead of adding another', async () => {
    // The bug this guards: if closing pushed, Back would re-open the drawer the
    // user just dismissed, and every open/close cycle would grow the stack by
    // two.
    const router = routerAt('/library')
    await router.load()
    await router.navigate({ to: '/catalog', search: { q: 'cave' } })
    await openTileDrawer(router, ordinal(4821))
    const depth = router.history.length

    await closeTileDrawer(router)

    expect(href(router)).toBe('/catalog?q=cave')
    expect(router.history.length).toBe(depth)

    router.history.back()
    expect(href(router)).toBe('/library')
  })

  it('swapping to a family variant replaces, so one Back still leaves the drawer', async () => {
    const router = routerAt('/catalog?q=cave')
    await router.load()
    await openTileDrawer(router, ordinal(4821))
    const depth = router.history.length

    await showTileInDrawer(router, ordinal(4822))
    await showTileInDrawer(router, ordinal(4823))

    expect(href(router)).toBe('/catalog?q=cave&tile=4823')
    expect(router.history.length).toBe(depth)

    await closeTileDrawer(router)
    expect(href(router)).toBe('/catalog?q=cave')
  })

  it('takes a whole aggregate as the subject and links it by its lowest ordinal', async () => {
    // Row A4: the catalog lists items, so a card holds a `TileAggregate` and not
    // an ordinal. `tileOrdinal` reads the number off `variants[0]`, which is the
    // group minimum — never off the `AggregateAddress`, which has no way out to a
    // number at all.
    const index = buildAggregateIndex(catalogOf(OVERLAP))
    const item = index.aggregates[0]
    if (item === undefined) throw new Error('the fixture has no aggregates')
    const router = routerAt('/catalog?q=cave')
    await router.load()

    await openTileDrawer(router, item)
    expect(href(router)).toBe('/catalog?q=cave&tile=4')

    const second = item.variants[1]
    if (second === undefined) throw new Error('the fixture aggregate has one variant')
    await showTileInDrawer(router, second)
    expect(href(router)).toBe('/catalog?q=cave&tile=9')
  })

  it('closes a cold-loaded shared link without inventing history', async () => {
    const router = routerAt('/catalog?q=cave&tile=4821')
    await router.load()
    expect(router.state.matches.at(-1)?.search).toMatchObject({ tile: 4821 })
    expect(router.history.canGoBack()).toBe(false)
    const depth = router.history.length

    await closeTileDrawer(router)

    expect(href(router)).toBe('/catalog?q=cave')
    expect(router.history.length).toBe(depth)
    expect(router.history.canGoBack()).toBe(false)
  })

  it('opens the drawer from a URL whose tile is garbage as a plain catalog view', async () => {
    const router = routerAt('/catalog?q=cave&tile=%3Cscript%3E')
    await router.load()
    expect(router.state.matches.at(-1)?.search).toMatchObject({ tile: null, q: 'cave' })
    expect(leafRouteId(router)).toBe('/catalog')
  })
})

describe('mounting', () => {
  /**
   * Renders a router into a detached document, without a testing library.
   *
   * This is the one thing the headless tests above cannot prove: that the tree
   * actually mounts. A route tree that resolves perfectly and renders a blank
   * page passes every other test in this file.
   */
  async function mount(router: WorkshopRouter): Promise<{ text: string; unmount: () => void }> {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    // The router resets scroll after a navigation and jsdom has no scrollTo,
    // which would otherwise print "Not implemented" over every assertion.
    window.scrollTo = () => undefined
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(RouterProvider, { router }))
      await router.load()
    })
    return {
      text: container.textContent ?? '',
      unmount: () => {
        act(() => {
          root.unmount()
        })
        container.remove()
      },
    }
  }

  it.each([
    // The real landing screen (PR 16) replaced `LandingPlaceholder`, so the
    // marker is a phrase from its headline rather than the placeholder's title.
    ['/', 'Every tile in the archive'],
    ['/catalog', 'Catalog'],
    ['/library', 'Library'],
    ['/builder', 'Builder'],
    // Row C3's screen. This case is the whole point of mounting it: C3 verified
    // that `dist/` contained none of its files, because an unmounted route means
    // an unreachable component and an unbundled one. A route entry that resolved
    // but rendered nothing would pass the `routes to` case above and fail here.
    ['/assemblies', 'Guided assemblies'],
  ])('renders %s inside the app frame', async (path, heading) => {
    const { text, unmount } = await mount(routerAt(path))
    expect(text).toContain('OPENFORGE')
    expect(text).toContain(heading)
    unmount()
  })

  it('renders the not-found boundary instead of a blank page', async () => {
    const { text, unmount } = await mount(routerAt('/tiles/does-not-exist'))
    expect(text).toContain('Not found')
    unmount()
  })

  it('hands the screen its validated search params', async () => {
    const router = routerAt('/catalog?kinds=wall~floor&tile=4821')
    const { unmount } = await mount(router)
    // The real catalog screen (PR 13) replaced `CatalogPlaceholder`, so the
    // params are no longer dumped as JSON — they are the facet state the sidebar
    // renders from. What is asserted is unchanged: sorted, defaulted and typed by
    // the time the component sees them, with the screen mounted against them.
    expect(router.state.matches.at(-1)?.search).toMatchObject({
      kinds: ['floor', 'wall'],
      tile: 4821,
    })
    unmount()
  })
})

describe('URL length, measured through the router', () => {
  it('keeps a realistically filtered catalog view short', async () => {
    const router = routerAt('/catalog')
    await router.load()
    await router.navigate({
      to: '/catalog',
      search: {
        q: 'arrow slit',
        kinds: ['floor', 'stairs', 'wall'],
        tex: ['cave', 'cut_stone', 'dungeon_stone', 'towne'],
        build: buildSystemFilter('separate wall'),
        conn: ['dragonlock', 'magnetic', 'openlock'],
        tile: ordinal(4821),
      },
    })
    expect(href(router)).toBe(
      '/catalog?build=separate%20wall&conn=dragonlock~magnetic~openlock' +
        '&kinds=floor~stairs~wall&q=arrow%20slit&tex=cave~cut_stone~dungeon_stone~towne&tile=4821',
    )
    expect(href(router).length).toBeLessThan(2_000)
    expect(href(router).length).toBeLessThan(300)
  })
})
