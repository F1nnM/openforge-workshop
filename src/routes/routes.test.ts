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
 * **Four routes have since been deleted, and only one case was relocated.**
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
 *   - **The sidebar row deleted `/` and `/assemblies` in one edit**, and the
 *     two are opposite cases. The landing page went because the front door was a
 *     page about the archive standing in front of the archive; nothing was
 *     relocated, because a hero, three step cards and a credit line have nowhere
 *     to go. `/assemblies` went because the guided walk it was the entrance to is
 *     driven from the builder's slot editor, where a part is actually filled —
 *     the same move `/settings` made. The walk's own suite went with the walk, to
 *     `src/assembly/recipeWalk.test.ts` and `src/assembly/corpus.test.ts`.
 *
 * What is left is **two** routes, and the catalog is now the one at `/`. That is
 * the point of the row: a visitor lands in the archive rather than in front of
 * it. What this file must not lose is the property X10 established, so
 * `renders %s inside the app frame` still asserts a marker no other screen and
 * no nav label can produce — and with two tabs left there are only two labels
 * that could collide.
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
import { builderRoute, catalogRoute } from './routeTree'
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
    ['/builder', '/builder'],
  ])('routes %s to the %s screen', async (path, expected) => {
    const router = routerAt(path)
    await router.load()
    expect(leafRouteId(router)).toBe(expected)
  })

  /**
   * The tree has no schemaless route left, and measuring what that changed
   * corrected a claim this file used to make.
   *
   * `/settings`, `/library` and `/assemblies` declared no `validateSearch`, and
   * this file recorded that such a route echoes a hand-typed unknown param
   * straight back into `match.search` *"where a route with a schema drops it"*.
   * **The second half was wrong.** Re-measured on `/builder`, whose
   * `facetSearchSchema` is a plain `z.object` and does strip unknown keys from
   * its own output: `?recipe=wall` is still in `match.search` after the load, so
   * an unknown param survives on the URL it was typed into whatever the
   * destination declares. What the deleted routes were relying on is the *other*
   * property, and it is the one that makes both harmless — `search:
   * { strict: true }` means a navigation carries only what it passes, so nothing
   * rides along out of the URL it arrived in.
   */
  it('carries nothing a navigation did not pass, in either direction', async () => {
    const filtered = routerAt('/?kinds=wall&q=cave')
    await filtered.load()
    await filtered.navigate({ to: '/builder' })
    // Nothing rides along. `strict: true` means a navigation carries only what
    // it passes, and the nav tabs pass nothing — so the Builder tab is always an
    // unfiltered palette, and a filtered catalog cannot leak its facets into a
    // link somebody then copies. The case below this block is the other half:
    // handing the facets over explicitly *does* carry them, which is what
    // §2.4's palette search needs.
    expect(href(filtered)).toBe('/builder')

    // A hand-typed unknown param survives into `match.search` — the schema
    // strips it from its own output and the router puts it back — and is then
    // left behind by the next navigation, which is the half that matters.
    const junk = routerAt('/builder?recipe=wall')
    await junk.load()
    expect(leafRouteId(junk)).toBe('/builder')
    expect(junk.state.matches.at(-1)?.search).toMatchObject({ recipe: 'wall' })
    await junk.navigate({ to: '/' })
    expect(href(junk)).toBe('/')
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
   * page. Rows L1, A0 and this one have since deleted three of the four and that
   * gave **no bytes back** — a lazy screen was never in the eager bundle — so
   * the figure still describes what `/builder` holds in place on its own. The
   * catalog is eager because a lazy route paints **nothing** until its chunk
   * lands — no rail, no nav — and defers the `catalog.json` request behind it,
   * which on the screen every visitor now cold-loads costs more than the bytes
   * it saves.
   */
  /**
   * The screen import below is deferred, and that is a finding rather than a
   * style.
   *
   * `@/screens/detail` imports `@/routes` — for `openTileDrawer` and
   * `resolveTileTarget`, reasonably — which closes a cycle back onto
   * `routeTree.tsx` through the catalog screen's drawer. Whichever side is
   * entered first wins: the app enters `routeTree.tsx` first and is fine, but a
   * **static** `import { CatalogScreen } from '@/screens/catalog'` at the top of
   * this file is entered first, and then the tree is built while that module is
   * still initialising and the eager route gets `component: undefined`.
   *
   * Measured, by writing it that way first: `catalogRoute.options.component`
   * came back `undefined` and the catalog mounted the frame and nothing else.
   * `/builder` is immune — its import is deferred by construction — so the
   * catalog is the whole remaining exposure, and it is silent everywhere except
   * in the mounting block below, whose markers come from the screens instead of
   * from the nav.
   */
  it('mounts the cold-loaded screen eagerly', async () => {
    const { CatalogScreen } = await import('@/screens/catalog')
    expect(catalogRoute.options.component).toBe(CatalogScreen)
  })

  it('mounts the press-reached screen lazily', async () => {
    const lazy = [[builderRoute, (await import('@/screens/builder')).BuilderScreen]] as const
    // Four until row L1 deleted `/settings`, row A0 `/library` and this row
    // `/assemblies`. The length assertion is what stops a route quietly leaving
    // this list instead of leaving the tree.
    expect(lazy).toHaveLength(1)
    for (const [route, screen] of lazy) {
      expect(typeof route.options.component).toBe('function')
      expect(route.options.component).not.toBe(screen)
    }
  })
})

describe('search state on the catalog at /', () => {
  let router: WorkshopRouter

  beforeEach(() => {
    router = routerAt('/')
  })

  it('fills every default when the URL carries nothing', async () => {
    await router.load()
    expect(router.state.matches.at(-1)?.search).toEqual(defaultCatalogSearch())
  })

  it('navigates to a URL that spells out only what was chosen', async () => {
    await router.load()
    await router.navigate({
      to: '/',
      search: { kinds: ['wall', 'floor'], tex: ['dungeon_stone'], q: 'arrow slit' },
    })
    expect(href(router)).toBe('/?kinds=floor~wall&q=arrow%20slit&tex=dungeon_stone')
  })

  it('strips defaults out of the URL entirely', async () => {
    await router.load()
    await router.navigate({ to: '/', search: defaultCatalogSearch() })
    expect(href(router)).toBe('/')
    await router.navigate({ to: '/', search: { build: BUILD_ANY } })
    expect(href(router)).toBe('/')
  })

  it('keeps "unspecified" in the URL, because it is a filter and not a default', async () => {
    await router.load()
    await router.navigate({ to: '/', search: { build: BUILD_UNSPECIFIED } })
    expect(href(router)).toBe('/?build=!none')
    await router.navigate({ to: '/', search: { build: buildSystemFilter('s2w') } })
    expect(href(router)).toBe('/?build=s2w')
  })

  it('parses a real URL back into typed state', async () => {
    const loaded = routerAt('/?build=separate%20wall&conn=openlock&kinds=floor~wall&q=arrow%20slit&tile=4821')
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
    const rotted = routerAt('/?tile=nonsense&build=!bogus&conn=&q=' + 'x'.repeat(5_000))
    await expect(rotted.load()).resolves.not.toThrow()
    expect(rotted.state.matches.at(-1)?.search).toEqual(defaultCatalogSearch())
    expect(rotted.state.matches.at(-1)?.error).toBeUndefined()
    expect(leafRouteId(rotted)).toBe('/')
  })

  it('treats a JSON-looking facet value as the opaque string it is', async () => {
    // The codec deliberately does not JSON-parse, so `%5B%22a%22%5D` is the
    // four-character string `["a"]` and not an array. It matches no kind and
    // shows an empty catalog, which is the honest reading of that URL.
    const router = routerAt('/?kinds=%5B%22a%22%5D')
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
    const router = routerAt('/?q=cave&kinds=wall')
    await router.load()
    expect(router.history.canGoBack()).toBe(false)

    await openTileDrawer(router, ordinal(4821))

    expect(href(router)).toBe('/?kinds=wall&q=cave&tile=4821')
    expect(router.history.canGoBack()).toBe(true)
  })

  it('closes on Back, and re-opens on Forward', async () => {
    const router = routerAt('/?q=cave')
    await router.load()
    await openTileDrawer(router, ordinal(4821))

    router.history.back()
    expect(href(router)).toBe('/?q=cave')

    router.history.forward()
    expect(href(router)).toBe('/?q=cave&tile=4821')
  })

  it('closing the drawer consumes the entry it added instead of adding another', async () => {
    // The bug this guards: if closing pushed, Back would re-open the drawer the
    // user just dismissed, and every open/close cycle would grow the stack by
    // two.
    // Opened from another screen, so Back has somewhere to land that is not the
    // drawer's own entry. `/library` was that screen until row A0 deleted it and
    // `/assemblies` until the sidebar row did; `/builder` is the last one left,
    // which is the whole tree's other member.
    const router = routerAt('/builder')
    await router.load()
    await router.navigate({ to: '/', search: { q: 'cave' } })
    await openTileDrawer(router, ordinal(4821))
    const depth = router.history.length

    await closeTileDrawer(router)

    expect(href(router)).toBe('/?q=cave')
    expect(router.history.length).toBe(depth)

    router.history.back()
    expect(href(router)).toBe('/builder')
  })

  it('swapping to a family variant replaces, so one Back still leaves the drawer', async () => {
    const router = routerAt('/?q=cave')
    await router.load()
    await openTileDrawer(router, ordinal(4821))
    const depth = router.history.length

    await showTileInDrawer(router, ordinal(4822))
    await showTileInDrawer(router, ordinal(4823))

    expect(href(router)).toBe('/?q=cave&tile=4823')
    expect(router.history.length).toBe(depth)

    await closeTileDrawer(router)
    expect(href(router)).toBe('/?q=cave')
  })

  it('takes a whole aggregate as the subject and links it by its lowest ordinal', async () => {
    // Row A4: the catalog lists items, so a card holds a `TileAggregate` and not
    // an ordinal. `tileOrdinal` reads the number off `variants[0]`, which is the
    // group minimum — never off the `AggregateAddress`, which has no way out to a
    // number at all.
    const index = buildAggregateIndex(catalogOf(OVERLAP))
    const item = index.aggregates[0]
    if (item === undefined) throw new Error('the fixture has no aggregates')
    const router = routerAt('/?q=cave')
    await router.load()

    await openTileDrawer(router, item)
    expect(href(router)).toBe('/?q=cave&tile=4')

    const second = item.variants[1]
    if (second === undefined) throw new Error('the fixture aggregate has one variant')
    await showTileInDrawer(router, second)
    expect(href(router)).toBe('/?q=cave&tile=9')
  })

  it('closes a cold-loaded shared link without inventing history', async () => {
    const router = routerAt('/?q=cave&tile=4821')
    await router.load()
    expect(router.state.matches.at(-1)?.search).toMatchObject({ tile: 4821 })
    expect(router.history.canGoBack()).toBe(false)
    const depth = router.history.length

    await closeTileDrawer(router)

    expect(href(router)).toBe('/?q=cave')
    expect(router.history.length).toBe(depth)
    expect(router.history.canGoBack()).toBe(false)
  })

  it('opens the drawer from a URL whose tile is garbage as a plain catalog view', async () => {
    const router = routerAt('/?q=cave&tile=%3Cscript%3E')
    await router.load()
    expect(router.state.matches.at(-1)?.search).toMatchObject({ tile: null, q: 'cave' })
    expect(leafRouteId(router)).toBe('/')
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
   * `Catalog` and `Builder` are the rail's two nav labels, so the frame renders
   * both of them on every route — measured, by dumping `container.textContent`
   * for each path. Markers in this block used to be exactly those words, which
   * means the cases that mattered most passed against a route rendering nothing
   * at all. The replacements are a search field's label and the builder's own
   * index-failure copy. (There were five labels and five markers until row L1
   * deleted `/settings` — its marker was the screen's own `<h2>` — row A0
   * deleted `/library`, whose marker was its empty-state sentence, and the
   * sidebar row deleted the landing page, whose marker was its headline, and
   * `/assemblies`, whose marker was C3's.)
   *
   * The builder's is a pattern rather than a string on purpose: jsdom's `fetch`
   * of `/catalog/catalog.json` fails, so a mounted builder shows either its
   * loading or its error branch depending on when the rejection flushes. Both
   * sentences are `BuilderScreen`'s and neither is the frame's, which is all
   * this block asks of them.
   */
  it.each([
    ['/', 'Search the catalog'],
    ['/builder', /Loading the archive index|The catalog index could not be loaded\./],
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
   * The four paths that were routes and are not.
   *
   * Each had a nav tab for at least one release, so each is a path somebody
   * plausibly has in their history — and `/catalog?tile=…` is stronger than
   * that, because every shared facet link and every shared tile link ever copied
   * out of this app spelled it. **Nothing redirects, deliberately:** the catalog
   * moved to `/`, and a redirect from its old path would be the only piece of
   * URL compatibility in an app that has none, kept alive by a route declaration
   * that has to stay forever to be worth anything.
   *
   * What is asserted is the deletion in the two ways that are observable: the
   * tree no longer matches the path, and the visitor gets the boundary with the
   * rail still on it rather than a blank document.
   *
   * **These can fail, and the failure they are for is a re-add.** Restoring any
   * of the four — the one-line convenience the `lazy or eager` block above
   * exists to catch the other half of — makes the leaf id that path again and
   * turns its case red. Removing the boundary instead turns all four red the
   * other way.
   */
  it.each(['/settings', '/library', '/assemblies', '/catalog'])(
    'answers a bookmarked %s with the boundary, not a blank page',
    async (path) => {
      const router = routerAt(path)
      const { text, unmount } = await mount(router)
      expect(leafRouteId(router)).not.toBe(path)
      expect(text).toContain('Not found')
      expect(text).toContain('OPENFORGE')
      unmount()
    },
  )

  it('hands the screen its validated search params', async () => {
    const router = routerAt('/?kinds=wall~floor&tile=4821')
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
    const router = routerAt('/')
    await router.load()
    await router.navigate({
      to: '/',
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
      '/?build=separate%20wall&conn=dragonlock~magnetic~openlock' +
        '&kinds=floor~stairs~wall&q=arrow%20slit&tex=cave~cut_stone~dungeon_stone~towne&tile=4821',
    )
    expect(href(router).length).toBeLessThan(2_000)
    expect(href(router).length).toBeLessThan(300)
  })
})
