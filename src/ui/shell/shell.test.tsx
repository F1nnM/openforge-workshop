// @vitest-environment jsdom
/**
 * Frame tests.
 *
 * Rendered through a real router over `createMemoryHistory()` rather than with
 * the rail in isolation: the active-tab marking *is* a router behaviour, and a
 * test that stubbed the router would only assert that this file's assumption
 * about `data-status` agrees with itself.
 *
 * The store is real too, driven through its exported actions. It persists to
 * `localStorage`, so every test clears it. The alternative — mocking
 * `usePlacementCount` — would prove the rail renders a number and nothing
 * about where the number comes from.
 *
 * `fetch` is stubbed with the catalog fixture rather than left to fail, because
 * the catalog is the screen at `/` now and half of this file is about what the
 * *screen* puts in the rail. The cases that want a screen with nothing to
 * contribute ask for a path that does not exist, and the ones about the builder
 * let the index fail, which is what leaves that screen in its wait branch
 * instead of mounting a three.js canvas jsdom has no WebGL for.
 *
 * **The archive stat's tests are gone, with the stat.** The old header ended in
 * `{n} tiles · objects.openforge.tools`, read live off the index and provided
 * through a context so this file could supply a fixed count and no network.
 * `CatalogStatsProvider` was the reason that context existed; the rail has no
 * stat, so the provider, the hook and the context are deleted and
 * `loadCatalog.ts` is what is left of that module. What replaces those cases is
 * one assertion that the frame renders no stat at all.
 */
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createWorkshopRouter } from '@/routes'
import { FIXTURE_CATALOG } from '@/screens/catalog/fixture'
import { aTemplateInstance } from '@/store/fixture'
import { clearPersistedWorkshopState, placeTemplate, resetWorkshop } from '@/store'

import { resetCatalogIndexCache } from './loadCatalog'

/**
 * Two placements. Since row A1 a placement is a **template instance** — a recipe,
 * an angle and a fill per slot — so the two differ by cell rather than by
 * identity, which is all this file's subject (a count in the rail) needs them
 * to differ by. The store's own parse is exercised in `src/store/**`.
 */
const place = (x: number) => placeTemplate(aTemplateInstance({ x, z: 0 }))

/** Serve the fixture index, or fail the request the way a cold jsdom does. */
function stubFetch(index: 'fixture' | 'unavailable'): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      index === 'fixture'
        ? Promise.resolve({
            ok: true,
            status: 200,
            statusText: 'OK',
            json: () => Promise.resolve(FIXTURE_CATALOG),
          })
        : Promise.reject(new Error('no index in this test')),
    ),
  )
}

async function renderApp(path = '/', index: 'fixture' | 'unavailable' = 'fixture') {
  // The router resets scroll after a navigation. jsdom 30 defines `scrollTo` as a
  // method that throws "Not implemented", so the shared setup's absence check
  // does not catch it and every render otherwise prints over the assertions.
  window.scrollTo = () => undefined
  stubFetch(index)

  const router = createWorkshopRouter({ history: createMemoryHistory({ initialEntries: [path] }) })
  const result = render(<RouterProvider router={router} />)
  // The router resolves its first match in a microtask; without this the first
  // assertion races the screen's initial render.
  await act(async () => {
    await router.load()
  })
  return result
}

const sectionNav = () => screen.getByRole('navigation', { name: 'Sections' })

const rail = (container: HTMLElement): HTMLElement => {
  const found = container.querySelector<HTMLElement>('.of-rail')
  if (found === null) throw new Error('the frame rendered no rail')
  return found
}

// Matched loosely because an accessible name is assembled from several nodes and
// the whitespace between them is the name-computation algorithm's business, not
// this test's. What matters is that the unit is in the name and the bare digit is
// not the whole of it.
const BUILDER = (n: number) => new RegExp(`^Builder\\s*,\\s*${String(n)} tiles? placed$`)

beforeEach(() => {
  resetWorkshop()
  clearPersistedWorkshopState()
  resetCatalogIndexCache()
})

afterEach(() => {
  resetWorkshop()
  clearPersistedWorkshopState()
  resetCatalogIndexCache()
  vi.unstubAllGlobals()
})

describe('AppFrame', () => {
  it('renders the wordmark and the nav landmark in the rail', async () => {
    const { container } = await renderApp('/')

    const wordmark = screen.getByRole('link', { name: /OpenForge Catalog & Workshop/ })
    expect(wordmark).toHaveAttribute('href', '/')
    // Both in the rail, not in the document flow above the screen — which is
    // the whole of what the sidebar row changed about the frame.
    expect(rail(container)).toContainElement(wordmark)
    expect(rail(container)).toContainElement(sectionNav())

    // Catalog, Builder — in that order. Asserted by name rather than by count,
    // so adding or removing a tab is a deliberate edit here instead of a bare
    // number to bump. Row X9 added Assemblies and the sidebar row removed it
    // along with its route; row L1 removed Settings and row A0 Library, each
    // because it deleted the route the tab existed to reach. `toEqual` on the
    // whole list is what makes a removal assertable in both directions: a
    // re-added tab fails here as loudly as a missing one.
    expect(within(sectionNav()).getAllByRole('link').map((link) => link.textContent)).toEqual([
      expect.stringContaining('Catalog'),
      expect.stringContaining('Builder'),
    ])
  })

  it('renders no archive stat, on any route', async () => {
    const { container } = await renderApp('/')

    // The old header's `{n} tiles · objects.openforge.tools`. The fixture index
    // this test serves names that host, so a stat reading it live would be here.
    expect(container.querySelector('.of-stat')).toBeNull()
    expect(screen.queryByText('objects.openforge.tools')).toBeNull()
  })

  it('gives the document one main landmark, with the screen inside it', async () => {
    await renderApp('/')

    const main = screen.getByRole('main')
    expect(within(main).getByRole('heading', { name: 'Catalog' })).toBeInTheDocument()
    expect(within(main).queryByRole('main')).toBeNull()
  })

  it('keeps the frame around a route that does not exist', async () => {
    const { container } = await renderApp('/nonsense')

    expect(sectionNav()).toBeInTheDocument()
    expect(rail(container)).toContainElement(sectionNav())
    expect(screen.getByRole('heading', { name: 'Not found' })).toBeInTheDocument()
  })
})

describe('the rail slot', () => {
  /**
   * The one thing the slot has to get right.
   *
   * The mockup this row was drawn from puts the wordmark, the nav and the
   * catalog's filter groups in **one** column with dividers between them, so the
   * screen's own sidebar has to render inside the frame's rail rather than beside
   * it. `RailSlot` portals it there, which means the same component tree that
   * reads the route's search params renders into a DOM node the frame owns —
   * and that is worth asserting from both ends, because a portal that silently
   * rendered nothing would leave a catalog with no filters and no error.
   */
  it('renders the screen’s own sidebar inside the rail, not inside main', async () => {
    const { container } = await renderApp('/')

    await waitFor(() => {
      expect(screen.getByRole('group', { name: 'Component' })).toBeInTheDocument()
    })

    const filters = screen.getByRole('complementary', { name: 'Filters' })
    expect(rail(container)).toContainElement(filters)
    expect(within(screen.getByRole('main')).queryByRole('complementary', { name: 'Filters' })).toBeNull()
  })

  it('puts it after the nav, so the rail reads and tabs in one order', async () => {
    const { container } = await renderApp('/')

    await waitFor(() => {
      expect(screen.getByRole('group', { name: 'Component' })).toBeInTheDocument()
    })

    const order = [
      ...rail(container).querySelectorAll(
        '.of-wordmark, .of-rail-divider, .of-nav, .of-rail-slot',
      ),
    ]
    expect(order.map((element) => element.className.split(' ')[0])).toEqual([
      'of-wordmark',
      'of-rail-divider',
      'of-nav',
      'of-rail-slot',
    ])
    // The divider is decoration, so it must not reach the accessibility tree:
    // the link and the nav it sits between are already distinct landmarks.
    expect(rail(container).querySelector('.of-rail-divider')).toHaveAttribute(
      'aria-hidden',
      'true',
    )
    expect(rail(container).querySelector('.of-rail-slot')).toContainElement(
      screen.getByRole('complementary', { name: 'Filters' }),
    )
  })

  it('leaves the slot empty on a screen with nothing to put in it', async () => {
    const { container } = await renderApp('/nonsense')

    const slot = rail(container).querySelector('.of-rail-slot')
    expect(slot).not.toBeNull()
    expect(slot?.childElementCount).toBe(0)
  })
})

describe('nav', () => {
  const currentTabs = () =>
    within(sectionNav())
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page')

  it.each([
    ['/', 'Catalog', 'fixture'],
    ['/builder', 'Builder', 'unavailable'],
  ] as const)('marks %s as the current page, and only that one', async (path, label, index) => {
    await renderApp(path, index)

    const current = currentTabs()

    expect(current).toHaveLength(1)
    expect(current[0]?.textContent).toContain(label)
    // The visual marker and the programmatic one come from the same router
    // match, so neither can be present without the other.
    expect(current[0]).toHaveAttribute('data-status', 'active')
  })

  /**
   * Two traps the catalog's move to `/` set, and both are `Link` defaults.
   *
   * A `Link to="/"` is active on **every** path under the default
   * `activeOptions.exact: false`, because the match is a prefix match and every
   * pathname begins with `/` — so the Catalog tab would light up on the builder
   * as well. And `includeSearch` defaults to **true**, so a tab whose link
   * carries no search params stops matching the moment the user types in the
   * search field or picks a facet, which would un-light the tab on the screen
   * the user is actually looking at.
   *
   * Neither was reachable while the catalog lived at `/catalog`: a prefix match
   * on that path is only ever the catalog, and nothing else in the tree was a
   * prefix of it.
   */
  it('keeps the catalog tab current when the URL carries filters', async () => {
    await renderApp('/?q=cave&kinds=wall')

    const current = currentTabs()
    expect(current).toHaveLength(1)
    expect(current[0]?.textContent).toContain('Catalog')
  })

  it('does not mark the catalog tab current on another screen', async () => {
    await renderApp('/builder', 'unavailable')

    expect(screen.getByRole('link', { name: 'Catalog' })).not.toHaveAttribute('aria-current')
  })

  it('marks nothing as current on a route that does not exist', async () => {
    await renderApp('/nonsense')

    for (const link of within(sectionNav()).getAllByRole('link')) {
      expect(link).not.toHaveAttribute('aria-current')
    }
  })

  it('names the count rather than showing a bare number', async () => {
    place(0)
    place(2)

    await renderApp('/')

    // The digits are aria-hidden; the accessible name carries the unit.
    expect(screen.getByRole('link', { name: BUILDER(2) })).toBeInTheDocument()
  })

  it('tracks the store as it changes', async () => {
    await renderApp('/')

    expect(screen.getByRole('link', { name: BUILDER(0) })).toBeInTheDocument()

    act(() => {
      place(0)
    })

    expect(screen.getByRole('link', { name: BUILDER(1) })).toBeInTheDocument()
    // And the chip itself, which is the visual half of the same count. Scoped
    // to the nav: the catalog's facet counts are in the same column now, and
    // three of the fixture's buckets hold exactly one tile.
    expect(within(sectionNav()).getByText('1')).toBeInTheDocument()
  })
})

describe('keyboard', () => {
  /**
   * jsdom implements no sequential focus navigation at all — `Tab` moves nothing
   * — so tab order is asserted structurally: every natively focusable element in
   * the frame, in document order, with nothing pulled out of the order by a
   * negative `tabindex`. That is exactly the property a `Tab`-driven test would
   * be checking, and it does not depend on a keyboard jsdom does not have.
   */
  function tabStops(root: HTMLElement): HTMLElement[] {
    const focusable = root.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea')
    return [...focusable].filter((element) => element.getAttribute('tabindex') !== '-1')
  }

  it('reaches the skip link, the wordmark and every nav tab, in that order', async () => {
    const { container } = await renderApp('/')

    const shell = container.querySelector('.of-shell')
    expect(shell).not.toBeNull()

    // The frame's own four controls, in order, and *first* — everything after
    // them belongs to whichever screen is mounted (the catalog contributes ~35
    // facet controls through the rail slot, then a search field in `<main>`).
    // Asserting the prefix rather than the whole list is what keeps this a test
    // of the frame's tab order instead of a test that no screen has any
    // controls.
    expect(tabStops(shell as HTMLElement).slice(0, 4)).toEqual([
      screen.getByRole('link', { name: 'Skip to content' }),
      screen.getByRole('link', { name: 'OpenForge Catalog & Workshop — home' }),
      screen.getByRole('link', { name: 'Catalog' }),
      screen.getByRole('link', { name: BUILDER(0) }),
    ])
  })

  it('points the skip link at a focusable main landmark', async () => {
    await renderApp('/')

    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute(
      'href',
      '#of-main',
    )

    // jsdom does not implement fragment navigation, so what is asserted is the
    // property that makes it work in a browser: the target can take focus.
    const main = screen.getByRole('main')
    expect(main).toHaveAttribute('id', 'of-main')
    expect(main).toHaveAttribute('tabindex', '-1')

    main.focus()
    expect(document.activeElement).toBe(main)
  })

  /**
   * The skip link's whole job, restated for a sidebar.
   *
   * In a top-bar frame it skipped a wordmark and three tabs. In this one it also
   * skips whatever the screen put in the rail — on the catalog that is roughly
   * 35 filter controls, which is the difference between the link being a
   * courtesy and being the only reasonable way to reach a tile with a keyboard.
   */
  it('skips the rail’s filter controls as well as the nav', async () => {
    const { container } = await renderApp('/')

    await waitFor(() => {
      expect(screen.getByRole('group', { name: 'Component' })).toBeInTheDocument()
    })

    const filters = screen.getByRole('complementary', { name: 'Filters' })
    expect(tabStops(filters).length).toBeGreaterThan(10)
    expect(rail(container)).toContainElement(filters)
    // And the target of the skip link is outside all of it.
    expect(screen.getByRole('main')).not.toContainElement(filters)
  })
})
