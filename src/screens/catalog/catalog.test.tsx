// @vitest-environment jsdom
/**
 * Catalog screen tests.
 *
 * Rendered through the **real router** over `createMemoryHistory()`, the **real
 * facet engine** over a six-record fixture, and the **real store**. Nothing here
 * is mocked except the network: the whole point of this screen is that the URL
 * drives the engine and the engine drives the sidebar, so a test that stubbed
 * either end would only prove this file agrees with itself.
 *
 * Two pieces of scaffolding are unavoidable and both are narrow:
 *
 *   - **`fetch`** returns {@link FIXTURE_CATALOG}. The index is a 5.6 MB build
 *     artefact; a component test has no business fetching it, and the fixture
 *     still travels the real path through `CatalogFile.parse`.
 *   - **`VirtuosoGridMockContext`** gives `VirtuosoGrid` a viewport and an item
 *     size. jsdom reports every element as 0×0 and does not implement
 *     `ResizeObserver`, so without it the virtualiser correctly concludes that
 *     zero items fit in a zero-wide row and renders none. This is
 *     react-virtuoso's own documented test seam, not a stub of our code — the
 *     grid still runs its real range and per-row logic against these numbers.
 */
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { VirtuosoGridMockContext } from 'react-virtuoso'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createWorkshopRouter } from '@/routes'
import type { CatalogSearch } from '@/search'
import { TileId } from '@/catalog'
import { clearPersistedWorkshopState, resetWorkshop, useWorkshopStore } from '@/store'
import { CatalogStatsProvider } from '@/ui/shell'
import { resetCatalogIndexCache } from '@/ui/shell'

import { resetCatalogSearchIndex } from './catalogIndex'
import { FIXTURE_CATALOG, FIXTURE_NAMES } from './fixture'

/**
 * A viewport four cards wide and tall enough for all six fixture cards.
 *
 * `itemWidth` matters as much as the height: the grid divides the viewport width
 * by it to get the row length, and a zero there means zero items per row.
 */
const VIEWPORT = { viewportHeight: 1200, viewportWidth: 960, itemHeight: 260, itemWidth: 232 }

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve(FIXTURE_CATALOG),
      }),
    ),
  )
}

async function renderCatalog(path = '/catalog') {
  window.scrollTo = () => undefined

  const router = createWorkshopRouter({ history: createMemoryHistory({ initialEntries: [path] }) })
  const result = render(
    <CatalogStatsProvider value={null}>
      <VirtuosoGridMockContext.Provider value={VIEWPORT}>
        <RouterProvider router={router} />
      </VirtuosoGridMockContext.Provider>
    </CatalogStatsProvider>,
  )

  await act(async () => {
    await router.load()
  })
  // The index resolves in a microtask after mount; the first assertion would
  // otherwise race the skeleton.
  await waitFor(() => {
    expect(screen.getByRole('group', { name: 'Component' })).toBeInTheDocument()
  })

  return { ...result, router }
}

/**
 * The current catalog search, **as validated**.
 *
 * Read off the matched route rather than off `location.search`, which holds the
 * raw parse: a one-value facet arrives there as the string `'wall'` rather than
 * as `['wall']`, because `parseCompactSearch` only splits on a separator that is
 * present. `validateSearch` is what turns it into the declared shape, and that
 * shape is what the screen sees.
 */
function currentSearch(router: ReturnType<typeof createWorkshopRouter>): CatalogSearch {
  return router.state.matches.at(-1)?.search as CatalogSearch
}

const cardTitles = () =>
  screen.queryAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)

const group = (name: string) => screen.getByRole('group', { name })

/** One facet control, found by its visible label inside its group. */
function facet(groupName: string, label: string): HTMLInputElement {
  // The accessible name is the label plus the live count — "Walls 3" — because
  // the count chip is part of the control. Anchored, so `Bases` does not also
  // match a longer label that starts with it.
  return within(group(groupName)).getByRole<HTMLInputElement>(
    groupName === 'Build system' ? 'radio' : 'checkbox',
    { name: new RegExp(`^${label} [\\d,]+$`) },
  )
}

/**
 * The branded `TileId` of a fixture record, for a store assertion.
 *
 * Parsed rather than cast: the store keys on a branded id, and a cast would let a
 * typo in the fixture pass here and fail as a silent lookup miss.
 */
function fixtureId(ordinal: number): TileId {
  return TileId.parse(FIXTURE_CATALOG.records[ordinal]?.id)
}

/** The live count rendered beside a facet's label. */
function facetCount(groupName: string, label: string): number {
  const input = facet(groupName, label)
  const text = input.closest('label')?.textContent ?? ''
  return Number(text.replace(label, '').replace(/[^\d]/g, ''))
}

beforeEach(() => {
  stubFetch()
  resetCatalogIndexCache()
  resetCatalogSearchIndex()
  clearPersistedWorkshopState()
  resetWorkshop()
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetCatalogIndexCache()
  resetCatalogSearchIndex()
  clearPersistedWorkshopState()
  resetWorkshop()
})

/* --------------------------------------------------------------- URL → engine */

describe('facet state comes from the URL', () => {
  it('renders every tile when nothing is filtered', async () => {
    await renderCatalog()

    expect(cardTitles()).toHaveLength(FIXTURE_NAMES.length)
    expect(screen.getByRole('status')).toHaveTextContent('6 tiles')
  })

  it('applies a multi-select kind filter from the URL', async () => {
    await renderCatalog('/catalog?kinds=wall')

    // Three tiles are in the `wall` bucket, one of them in `floor` as well.
    expect(cardTitles()).toEqual([FIXTURE_NAMES[1], FIXTURE_NAMES[2], FIXTURE_NAMES[3]])
    expect(screen.getByRole('status')).toHaveTextContent('3 tiles match')
    expect(facet('Component', 'Walls')).toBeChecked()
    expect(facet('Component', 'Floors')).not.toBeChecked()
  })

  it('ORs two values of one facet rather than intersecting them', async () => {
    await renderCatalog('/catalog?kinds=base~floor')

    expect(cardTitles()).toEqual([FIXTURE_NAMES[0], FIXTURE_NAMES[3], FIXTURE_NAMES[5]])
    expect(facet('Component', 'Bases')).toBeChecked()
    expect(facet('Component', 'Floors')).toBeChecked()
  })

  it('matches a texture root by prefix, including its deeper paths', async () => {
    await renderCatalog('/catalog?tex=dungeon_stone')

    // Record 1 carries only `texture|dungeon_stone|eroded`, never the bare root.
    expect(cardTitles()).toContain(FIXTURE_NAMES[1])
    expect(cardTitles()).toHaveLength(3)
  })

  it('treats an absent build tag as a filter value', async () => {
    await renderCatalog('/catalog?build=%21none')

    expect(cardTitles()).toEqual([FIXTURE_NAMES[2], FIXTURE_NAMES[4]])
    expect(facet('Build system', 'Unspecified')).toBeChecked()
    expect(facet('Build system', 'Any')).not.toBeChecked()
  })

  it('surfaces the tiles in no kind bucket under "Other"', async () => {
    await renderCatalog('/catalog?kinds=%21other')

    expect(cardTitles()).toEqual([FIXTURE_NAMES[4]])
  })

  it('degrades a rotted filter to an empty result with a control that clears it', async () => {
    await renderCatalog('/catalog?kinds=nonsense')

    expect(cardTitles()).toHaveLength(0)
    // The unknown value still gets a bucket, so the filter narrowing the results
    // has something on screen attached to it.
    expect(facet('Component', 'Nonsense')).toBeChecked()
    expect(facetCount('Component', 'Nonsense')).toBe(0)
  })
})

/* ----------------------------------------------------------- engine → sidebar */

describe('facet counts are live and disjunctive', () => {
  it('does not zero a facet’s siblings when one of its values is selected', async () => {
    await renderCatalog('/catalog?tex=dungeon_stone')

    // The texture facet's own counts are computed with the texture filter
    // excluded, so its siblings still say what selecting them would yield.
    expect(facetCount('Texture set', 'Dungeon stone')).toBe(3)
    expect(facetCount('Texture set', 'Cave')).toBe(1)
    expect(facetCount('Texture set', 'Wood')).toBe(1)
  })

  it('narrows the other facets’ counts, which is the half that must not be disjunctive', async () => {
    await renderCatalog('/catalog?tex=cave')

    // Only the cave corner wall survives, so `wall` is the only live kind.
    expect(facetCount('Component', 'Walls')).toBe(1)
    expect(facetCount('Component', 'Floors')).toBe(0)
    expect(facet('Component', 'Floors')).toBeDisabled()
  })

  it('counts the corpus, not the result set, on the clear-facet row', async () => {
    await renderCatalog('/catalog?kinds=wall')

    const all = within(group('Component')).getByRole('button', { name: /All components/ })
    expect(all).toHaveTextContent('6')
    expect(all).toHaveAttribute('aria-pressed', 'false')
  })
})

/* --------------------------------------------------------------- sidebar → URL */

describe('the sidebar writes the URL', () => {
  it('adds a facet value and keeps the filter shareable', async () => {
    const { router } = await renderCatalog()

    fireEvent.click(facet('Component', 'Walls'))

    await waitFor(() => {
      expect(currentSearch(router).kinds).toEqual(['wall'])
    })
    expect(router.state.location.searchStr).toBe('?kinds=wall')
    expect(cardTitles()).toHaveLength(3)
  })

  it('goes back to the previous filter on Back', async () => {
    const { router } = await renderCatalog()

    fireEvent.click(facet('Component', 'Walls'))
    await waitFor(() => {
      expect(currentSearch(router).kinds).toEqual(['wall'])
    })

    fireEvent.click(facet('Texture set', 'Dungeon stone'))
    await waitFor(() => {
      expect(currentSearch(router).tex).toEqual(['dungeon_stone'])
    })

    // Each facet click is one history entry, so one Back undoes one decision.
    await act(async () => {
      router.history.back()
      await router.load()
    })
    await waitFor(() => {
      expect(currentSearch(router).tex).toEqual([])
    })
    expect(currentSearch(router).kinds).toEqual(['wall'])

    await act(async () => {
      router.history.back()
      await router.load()
    })
    await waitFor(() => {
      expect(router.state.location.searchStr).toBe('')
    })
    expect(cardTitles()).toHaveLength(6)
  })

  it('clears everything from the "Clear filters" button', async () => {
    const { router } = await renderCatalog('/catalog?kinds=wall&tex=cave')

    fireEvent.click(screen.getByRole('button', { name: /Clear filters/ }))

    await waitFor(() => {
      expect(router.state.location.searchStr).toBe('')
    })
    expect(cardTitles()).toHaveLength(6)
  })

  it('offers no "Clear filters" control when nothing is filtered', async () => {
    await renderCatalog()

    expect(screen.queryByRole('button', { name: /Clear filters/ })).not.toBeInTheDocument()
  })

  it('replaces the build system rather than accumulating values', async () => {
    const { router } = await renderCatalog()

    fireEvent.click(facet('Build system', 'Separate wall'))
    await waitFor(() => {
      expect(currentSearch(router).build).toBe('separate wall')
    })

    fireEvent.click(facet('Build system', 'Wall on tile'))
    await waitFor(() => {
      expect(currentSearch(router).build).toBe('wall on tile')
    })
    expect(cardTitles()).toEqual([FIXTURE_NAMES[3]])
  })
})

/* ---------------------------------------------------------------- search field */

describe('the search field', () => {
  it('commits the query to the URL and reports the count', async () => {
    const { router } = await renderCatalog()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search the catalog' }), {
      target: { value: 'cave' },
    })

    await waitFor(() => {
      expect(currentSearch(router).q).toBe('cave')
    })
    expect(cardTitles()).toEqual([FIXTURE_NAMES[2]])
    expect(screen.getByRole('status')).toHaveTextContent('1 tile match')
  })

  it('follows the URL when the query changes from outside the field', async () => {
    const { router } = await renderCatalog('/catalog?q=cave')

    const input = screen.getByRole('searchbox', { name: 'Search the catalog' })
    expect(input).toHaveValue('cave')

    fireEvent.click(screen.getByRole('button', { name: /Clear filters/ }))

    await waitFor(() => {
      expect(input).toHaveValue('')
    })
    expect(router.state.location.searchStr).toBe('')
  })

  it('renders the contract’s empty state when nothing matches', async () => {
    await renderCatalog('/catalog?q=nothinglikethis')

    expect(screen.getByText('Nothing in the organized archive matches.')).toBeInTheDocument()
    expect(
      screen.getByText(/Untagged tiles exist in storage but are not yet reachable/),
    ).toBeInTheDocument()
    expect(cardTitles()).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------------ cards */

describe('the card', () => {
  it('titles a tile with the synthesised display name, never the filename', async () => {
    await renderCatalog()

    for (const name of FIXTURE_NAMES) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument()
    }
    // Every fixture filename carries `#`, `%`, `+` or `,`; none of them is on screen.
    for (const record of FIXTURE_CATALOG.records) {
      expect(screen.queryByText(record.file)).not.toBeInTheDocument()
    }
  })

  it('shows frame 0 of the sprite sheet with explicit dimensions and lazy loading', async () => {
    await renderCatalog('/catalog?kinds=base')

    const sheet = document.querySelector<HTMLImageElement>('.of-thumb-sheet')
    expect(sheet).not.toBeNull()
    expect(sheet?.getAttribute('src')).toBe(
      'https://objects.openforge.tools/sprites/000000/0000000000000000000000000000aaa6.png',
    )
    // The sheet's real pixel size, so the aspect ratio is reserved before it lands.
    expect(sheet?.getAttribute('width')).toBe('2560')
    expect(sheet?.getAttribute('height')).toBe('1024')
    expect(sheet?.getAttribute('loading')).toBe('lazy')
    expect(sheet?.getAttribute('decoding')).toBe('async')

    const frame = document.querySelector<HTMLElement>('.of-thumb-frame')
    expect(frame?.style.getPropertyValue('--of-sheet-x')).toBe('0%')
    expect(frame?.style.getPropertyValue('--of-sheet-y')).toBe('0%')
    expect(frame?.style.getPropertyValue('--of-sheet-cols')).toBe('5')
  })

  it('renders the one tile with no sprite sheet without a broken image', async () => {
    await renderCatalog('/catalog?kinds=%21other')

    expect(screen.getByRole('heading', { level: 2, name: FIXTURE_NAMES[4] })).toBeInTheDocument()
    expect(screen.getByText('no render')).toBeInTheDocument()
    expect(document.querySelectorAll('.of-thumb-sheet')).toHaveLength(0)
    // The well is still there, so the card is the same height as its neighbours.
    expect(document.querySelectorAll('.of-thumb')).toHaveLength(1)
  })

  it('shows the size chip and file size as measured facts', async () => {
    await renderCatalog('/catalog?kinds=base')

    expect(screen.getByText('1×3')).toBeInTheDocument()
    expect(screen.getByText('838 KB')).toBeInTheDocument()
  })

  it('falls back to the openlock size code when there is no footprint', async () => {
    await renderCatalog('/catalog?tex=cave')

    expect(screen.getByText('IL')).toBeInTheDocument()
  })

  it('links to the tile’s detail drawer by manifest ordinal', async () => {
    await renderCatalog('/catalog?kinds=base')

    const link = screen.getByRole('link', { name: FIXTURE_NAMES[5] })
    expect(link).toHaveAttribute('href', '/catalog?kinds=base&tile=5')
  })
})

/* -------------------------------------------------------------- library toggle */

describe('the library toggle', () => {
  it('writes the tile to the store and names it', async () => {
    await renderCatalog('/catalog?kinds=base')

    const toggle = screen.getByRole('button', { name: `Add to library ${FIXTURE_NAMES[5]}` })
    fireEvent.click(toggle)

    const id = fixtureId(5)
    await waitFor(() => {
      expect(useWorkshopStore.getState().library[id]).toBe(true)
    })
    expect(
      screen.getByRole('button', { name: `In library ${FIXTURE_NAMES[5]}` }),
    ).toBeInTheDocument()
  })

  it('removes the tile on a second press', async () => {
    await renderCatalog('/catalog?kinds=base')

    const id = fixtureId(5)
    fireEvent.click(screen.getByRole('button', { name: `Add to library ${FIXTURE_NAMES[5]}` }))
    await waitFor(() => {
      expect(useWorkshopStore.getState().library[id]).toBe(true)
    })

    fireEvent.click(screen.getByRole('button', { name: `In library ${FIXTURE_NAMES[5]}` }))
    await waitFor(() => {
      expect(useWorkshopStore.getState().library[id]).toBeUndefined()
    })
  })
})

/* ------------------------------------------------------- loading and failure */

describe('the screen without an index', () => {
  it('shows a shimmer skeleton before the index lands', async () => {
    window.scrollTo = () => undefined
    let release: (() => void) | undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        held.then(() => ({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve(FIXTURE_CATALOG),
        })),
      ),
    )

    const router = createWorkshopRouter({
      history: createMemoryHistory({ initialEntries: ['/catalog'] }),
    })
    render(
      <CatalogStatsProvider value={null}>
        <VirtuosoGridMockContext.Provider value={VIEWPORT}>
          <RouterProvider router={router} />
        </VirtuosoGridMockContext.Provider>
      </CatalogStatsProvider>,
    )
    await act(async () => {
      await router.load()
    })

    expect(document.querySelectorAll('.of-shimmer').length).toBeGreaterThan(0)
    expect(cardTitles()).toHaveLength(0)

    await act(async () => {
      release?.()
      await held
    })
    await waitFor(() => {
      expect(cardTitles()).toHaveLength(6)
    })
  })

  it('offers a working retry when the index cannot be loaded', async () => {
    window.scrollTo = () => undefined
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Service Unavailable' })
      .mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve(FIXTURE_CATALOG),
      })
    vi.stubGlobal('fetch', fetchMock)

    const router = createWorkshopRouter({
      history: createMemoryHistory({ initialEntries: ['/catalog'] }),
    })
    render(
      <CatalogStatsProvider value={null}>
        <VirtuosoGridMockContext.Provider value={VIEWPORT}>
          <RouterProvider router={router} />
        </VirtuosoGridMockContext.Provider>
      </CatalogStatsProvider>,
    )
    await act(async () => {
      await router.load()
    })

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('The catalog index could not be loaded.')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() => {
      expect(cardTitles()).toHaveLength(6)
    })
  })
})
