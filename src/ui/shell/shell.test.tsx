// @vitest-environment jsdom
/**
 * Frame tests.
 *
 * Rendered through a real router over `createMemoryHistory()` rather than with
 * the header in isolation: the active-tab marking *is* a router behaviour, and a
 * test that stubbed the router would only assert that this file's assumption
 * about `data-status` agrees with itself.
 *
 * The store is real too, driven through its exported actions. It persists to
 * `localStorage`, so every test clears it. The alternative — mocking
 * `useLibraryCount` — would prove the header renders a number and nothing about
 * where the number comes from.
 *
 * The archive stats come through `CatalogStatsProvider`, which is the reason that
 * provider exists: without it the header fetches `catalog.json`, and a component
 * test has no business making a request.
 */
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router'
import { act, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { TileId } from '@/catalog'
import { createWorkshopRouter } from '@/routes'
import { addToLibrary, clearPersistedWorkshopState, placeTile, resetWorkshop } from '@/store'

import type { CatalogStats } from './catalogStats'
import { CatalogStatsProvider } from './catalogStats'

const STATS: CatalogStats = { tileCount: 8702, archiveHost: 'objects.openforge.tools' }

const TILE_A = TileId.parse(
  'tiles/dungeon_stone/floor/2x2/openlock/dungeon_stone%2x2.openlock.stl',
)
const TILE_B = TileId.parse('tiles/cave/thick_wall/wall/corner/openlock/cave%corner.openlock.stl')

async function renderApp(path = '/', stats: CatalogStats | null = STATS) {
  // The router resets scroll after a navigation. jsdom 30 defines `scrollTo` as a
  // method that throws "Not implemented", so the shared setup's absence check
  // does not catch it and every render otherwise prints over the assertions.
  window.scrollTo = () => undefined

  const router = createWorkshopRouter({ history: createMemoryHistory({ initialEntries: [path] }) })
  const result = render(
    <CatalogStatsProvider value={stats}>
      <RouterProvider router={router} />
    </CatalogStatsProvider>,
  )
  // The router resolves its first match in a microtask; without this the first
  // assertion races the screen's initial render.
  await act(async () => {
    await router.load()
  })
  return result
}

const sectionNav = () => screen.getByRole('navigation', { name: 'Sections' })

// Matched loosely because an accessible name is assembled from several nodes and
// the whitespace between them is the name-computation algorithm's business, not
// this test's. What matters is that the unit is in the name and the bare digit is
// not the whole of it.
const LIBRARY = (n: number) => new RegExp(`^Library\\s*,\\s*${String(n)} tiles? saved$`)
const BUILDER = (n: number) => new RegExp(`^Builder\\s*,\\s*${String(n)} tiles? placed$`)

beforeEach(() => {
  resetWorkshop()
  clearPersistedWorkshopState()
})

afterEach(() => {
  resetWorkshop()
  clearPersistedWorkshopState()
})

describe('AppFrame', () => {
  it('renders the wordmark, the nav landmark and the archive stat', async () => {
    await renderApp('/catalog')

    expect(screen.getByRole('link', { name: /OpenForge Catalog & Workshop/ })).toHaveAttribute(
      'href',
      '/',
    )
    expect(within(sectionNav()).getAllByRole('link')).toHaveLength(3)

    // The count is the index's, and the archive is named by host — the
    // contract's "s3 archive" is not what the catalog points at.
    expect(screen.getByText('8,702')).toBeInTheDocument()
    expect(screen.getByText('objects.openforge.tools')).toBeInTheDocument()
  })

  it('gives the document one main landmark, with the screen inside it', async () => {
    await renderApp('/library')

    const main = screen.getByRole('main')
    expect(within(main).getByRole('heading', { name: 'Library' })).toBeInTheDocument()
    expect(within(main).queryByRole('main')).toBeNull()
  })

  it('keeps the frame around a route that does not exist', async () => {
    await renderApp('/nonsense')

    expect(sectionNav()).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Not found' })).toBeInTheDocument()
  })
})

describe('nav', () => {
  it.each([
    ['/catalog', 'Catalog'],
    ['/library', 'Library'],
    ['/builder', 'Builder'],
  ])('marks %s as the current page, and only that one', async (path, label) => {
    await renderApp(path)

    const current = within(sectionNav())
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page')

    expect(current).toHaveLength(1)
    expect(current[0]?.textContent).toContain(label)
    // The visual marker and the programmatic one come from the same router
    // match, so neither can be present without the other.
    expect(current[0]).toHaveAttribute('data-status', 'active')
  })

  it('marks nothing as current on the landing route', async () => {
    await renderApp('/')

    for (const link of within(sectionNav()).getAllByRole('link')) {
      expect(link).not.toHaveAttribute('aria-current')
    }
  })

  it('names the counts rather than showing bare numbers', async () => {
    addToLibrary(TILE_A)
    addToLibrary(TILE_B)
    placeTile({ tileId: TILE_A, x: 0, z: 0, rotation: 0 })

    await renderApp('/catalog')

    // The digits are aria-hidden; the accessible name carries the unit.
    expect(screen.getByRole('link', { name: LIBRARY(2) })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: BUILDER(1) })).toBeInTheDocument()
  })

  it('tracks the store as it changes', async () => {
    await renderApp('/catalog')

    expect(screen.getByRole('link', { name: LIBRARY(0) })).toBeInTheDocument()

    act(() => {
      addToLibrary(TILE_A)
    })

    expect(screen.getByRole('link', { name: LIBRARY(1) })).toBeInTheDocument()
    // And the chip itself, which is the visual half of the same count.
    expect(screen.getByText('1')).toBeInTheDocument()
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
    const { container } = await renderApp('/catalog')

    const shell = container.querySelector('.of-shell')
    expect(shell).not.toBeNull()

    // The frame's own five controls, in order, and *first* — everything after
    // them belongs to whichever screen is mounted (the catalog contributes a
    // search field and ~35 facet controls). Asserting the prefix rather than the
    // whole list is what keeps this a test of the frame's tab order instead of a
    // test that no screen has any controls.
    expect(tabStops(shell as HTMLElement).slice(0, 5)).toEqual([
      screen.getByRole('link', { name: 'Skip to content' }),
      screen.getByRole('link', { name: 'OpenForge Catalog & Workshop — home' }),
      screen.getByRole('link', { name: 'Catalog' }),
      screen.getByRole('link', { name: LIBRARY(0) }),
      screen.getByRole('link', { name: BUILDER(0) }),
    ])
  })

  it('points the skip link at a focusable main landmark', async () => {
    await renderApp('/catalog')

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
})

describe('archive stat', () => {
  it('shows the mock placeholder while the count is unknown', async () => {
    await renderApp('/catalog', null)

    expect(screen.getByText('…')).toBeInTheDocument()
    expect(screen.queryByText('8,702')).toBeNull()
  })
})
