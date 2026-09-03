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
 *
 * Row X10 made four of the six routes lazy and had to lean on that block, which
 * is when **three of its five markers turned out not to be able to fail**:
 * `Catalog`, `Library` and `Builder` are also the header's own nav labels, so
 * those three cases passed against exactly the blank screen the block exists to
 * catch. Every marker is now a string only the screen can produce. The
 * `lazy or eager` block below is the other half: mounting proves a lazy route
 * resolves, and that block proves the two that are lazy still are, because
 * re-inflating the eager bundle by 42 kB gzipped is one convenient `import` away
 * and nothing else in the repo would notice.
 *
 * **Two routes have since been deleted, and neither case was relocated.**
 *
 *   - **Row L1 deleted `/settings`**, which X10 had just covered for the first
 *     time. The coverage it stood for did not evaporate with it: the screen's
 *     subject — the lock preference and its two measured figures — is now a
 *     control in the builder, and the whole of that screen's test suite moved to
 *     `src/ui/lock-picker/lockToggle.test.tsx`, fixture and all.
 *   - **Row A0 deleted `/library`.** Its subject was the library itself, which
 *     A0 also deleted, so there is nothing for the case to be relocated *to* —
 *     unlike `/settings`, whose subject survived the screen. The one surface on
 *     it that was not about the library, the JSON export/import, moved to
 *     `@/builder/panels/BackupPanel.tsx` with its tests.
 *
 * What this file loses is two routes; what it must not lose is the property X10
 * established, so `renders %s inside the app frame` still asserts a marker no
 * other screen and no nav label can produce, and the header is now three labels.
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
import { assembliesRoute, builderRoute, catalogRoute, landingRoute } from './routeTree'
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
    ['/builder', '/builder'],
    ['/assemblies', '/assemblies'],
  ])('routes %s to the %s screen', async (path, expected) => {
    const router = routerAt(path)
    await router.load()
    expect(leafRouteId(router)).toBe(expected)
  })

  it('gives /assemblies no search params, so a link cannot freeze a half-made pick set', async () => {
    // Row C3's argument, and the deleted `/library`'s before it.
    // `search: { strict: true }`
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
    // Measured on this tree: `/library` and `/assemblies` both echoed an unknown
    // param back, so this is the schemaless class's behaviour and not something
    // mounting C3's screen introduced. (`/settings` was the third. Row L1 deleted
    // it and row A0 deleted `/library`; the class is unchanged, and `/assemblies`
    // is now the only member left in the tree.) It is harmless for the reason
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

describe('lazy or eager, as row X10 measured it', () => {
  /**
   * The one thing about laziness that is observable from a test.
   *
   * A statically mounted route's `component` **is** the screen's own function; a
   * lazily mounted one is TanStack's wrapper around an `import()`, and the
   * screen function is not reachable from the route at all. Asserting that
   * identity in both directions is what holds row X10's measurement in place,
   * and it needs holding: a static `import` of one screen is a one-line
   * convenience that re-inflates the eager bundle and that **nothing else in
   * this repository would notice**, because the only other evidence is a
   * `vite build` nobody runs in CI.
   *
   * `lazyRouteComponent`'s own `.preload` is deliberately not what is asserted:
   * it clears itself to `undefined` on the first successful load, and the block
   * above this one loads every route, so an assertion on it would pass or fail
   * on test order. Identity does not move.
   *
   * The numbers, from `routeTree.tsx`'s module note: X10's four lazy routes were
   * worth -155,509 B raw / -42,058 B gz / -33,113 B br of eager payload on every
   * page. Row L1 deleted one of the four and that gave **no bytes back** — a
   * lazy screen was never in the eager bundle — so the figure still describes
   * what the remaining three hold in place. `/` and `/catalog` are eager because a lazy route paints **nothing**
   * until its chunk lands — no header, no nav — and defers the header's
   * `catalog.json` request behind it, which on the two screens people cold-load
   * costs more than the bytes it saves.
   */
  /**
   * Both screen imports below are deferred, and that is a finding rather than a
   * style.
   *
   * `@/screens/detail` imports `@/routes` — for `openTileDrawer` and
   * `resolveTileTarget`, reasonably — which closes a cycle back onto
   * `routeTree.tsx` through the catalog screen's drawer. Whichever side is
   * entered first wins: the app enters `routeTree.tsx` first and is fine, but a
   * **static** `import { CatalogScreen } from '@/screens/catalog'` at the top of
   * this file is entered first, and then the tree is built while that module is
   * still initialising and both eager routes get `component: undefined`.
   *
   * Measured, by writing it that way first: `catalogRoute.options.component`
   * came back `undefined` and `/catalog` mounted the frame and nothing else. The
   * four lazy routes are immune — their import is deferred by construction — so
   * `/` and `/catalog` are the whole remaining exposure, and it is silent
   * everywhere except in the mounting block above, whose markers now come from
   * the screens instead of from the nav.
   */
  it('mounts the two cold-loaded screens eagerly', async () => {
    const { Landing } = await import('@/screens/landing')
    const { CatalogScreen } = await import('@/screens/catalog')
    expect(landingRoute.options.component).toBe(Landing)
    expect(catalogRoute.options.component).toBe(CatalogScreen)
  })

  it('mounts the two press-reached screens lazily', async () => {
    const lazy = [
      [builderRoute, (await import('@/screens/builder')).BuilderScreen],
      [assembliesRoute, (await import('@/screens/assemblies')).AssembliesScreen],
    ] as const
    // Four until row L1 deleted `/settings` and row A0 deleted `/library`. The
    // length assertion is what stops a route quietly leaving this list instead
    // of leaving the tree.
    expect(lazy).toHaveLength(2)
    for (const [route, screen] of lazy) {
      expect(typeof route.options.component).toBe('function')
      expect(route.options.component).not.toBe(screen)
    }
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
    // Opened from another screen, so Back has somewhere to land that is not the
    // drawer's own entry. `/library` was that screen until row A0 deleted it.
    const router = routerAt('/assemblies')
    await router.load()
    await router.navigate({ to: '/catalog', search: { q: 'cave' } })
    await openTileDrawer(router, ordinal(4821))
    const depth = router.history.length

    await closeTileDrawer(router)

    expect(href(router)).toBe('/catalog?q=cave')
    expect(router.history.length).toBe(depth)

    router.history.back()
    expect(href(router)).toBe('/assemblies')
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

  /**
   * Every marker here is a string **only that screen can produce**, and that is
   * a correction rather than a style.
   *
   * `Catalog`, `Builder` and `Assemblies` are the header's three nav labels, so
   * the frame renders all three of them on every route — measured, by dumping
   * `container.textContent` for each path. Three of this block's markers used to
   * be exactly those words, which means the three cases that mattered most
   * passed against a route rendering nothing at all. The replacements are a
   * search field's label, the builder's own index-failure copy and C3's
   * headline. (There were five labels and five markers until row L1 deleted
   * `/settings` — its marker was the screen's own `<h2>` — and row A0 deleted
   * `/library`, whose marker was its empty-state sentence.)
   *
   * The builder's is a pattern rather than a string on purpose: jsdom's `fetch`
   * of `/catalog/catalog.json` fails, so a mounted builder shows either its
   * loading or its error branch depending on when the rejection flushes. Both
   * sentences are `BuilderScreen`'s and neither is the frame's, which is all
   * this block asks of them.
   */
  it.each([
    // The real landing screen (PR 16) replaced `LandingPlaceholder`, so the
    // marker is a phrase from its headline rather than the placeholder's title.
    ['/', 'Every tile in the archive'],
    ['/catalog', 'Search the catalog'],
    ['/builder', /Loading the archive index|The catalog index could not be loaded\./],
    // Row C3's screen. This case is the whole point of mounting it: C3 verified
    // that `dist/` contained none of its files, because an unmounted route means
    // an unreachable component and an unbundled one. A route entry that resolved
    // but rendered nothing would pass the `routes to` case above and fail here.
    ['/assemblies', 'Guided assemblies'],
  ])('renders %s inside the app frame', async (path, marker) => {
    const { text, unmount } = await mount(routerAt(path))
    expect(text).toContain('OPENFORGE')
    expect(text).toMatch(marker)
    unmount()
  })

  it('renders the not-found boundary instead of a blank page', async () => {
    const { text, unmount } = await mount(routerAt('/tiles/does-not-exist'))
    expect(text).toContain('Not found')
    unmount()
  })

  /**
   * A bookmarked `/settings` after row L1 deleted it.
   *
   * The route was in this tree for the whole of v1 and v2 and had a nav tab, so
   * it is the one deleted path somebody plausibly has in their history. This
   * asserts the deletion in the only two ways that are observable: the tree no
   * longer matches the path, and what the visitor gets is the boundary with the
   * header still on it rather than a blank document.
   *
   * **It can fail, and the failure it is for is a re-add.** Restoring
   * `settingsRoute` — the one-line convenience the `lazy or eager` block above
   * exists to catch the other half of — makes the leaf id `/settings` again and
   * turns this red. Removing the boundary instead turns it red the other way.
   */
  it('answers a bookmarked /settings with the boundary, not a blank page', async () => {
    const router = routerAt('/settings')
    const { text, unmount } = await mount(router)
    expect(leafRouteId(router)).not.toBe('/settings')
    expect(text).toContain('Not found')
    expect(text).toContain('OPENFORGE')
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
