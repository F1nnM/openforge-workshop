// @vitest-environment jsdom
/**
 * Catalog screen tests.
 *
 * Rendered through the **real router** over `createMemoryHistory()`, the **real
 * facet engine** over a seven-file / six-item fixture, and the **real store**.
 * Nothing here is mocked except the network: the whole point of this screen is
 * that the URL drives the engine and the engine drives the sidebar, so a test
 * that stubbed either end would only prove this file agrees with itself.
 *
 * The fixture's ord 1 and ord 6 share a design, so every card assertion below is
 * about an **item** rather than a file — six cards over seven records, the same
 * 2.28× collapse the live index makes at 3,822 over 8,702.
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

import { selectVariantForLock } from '@/assembly'
import { CatalogFile as CatalogFileSchema, buildAggregateIndex } from '@/catalog'
import { createWorkshopRouter } from '@/routes'
import type { CatalogSearch } from '@/search'
import { clearPersistedWorkshopState, resetWorkshop, setLockSystem } from '@/store'
import { CatalogStatsProvider } from '@/ui/shell'
import { resetCatalogIndexCache } from '@/ui/shell'

import { resetCatalogSearchIndex } from './catalogIndex'
import { FIXTURE_CATALOG, FIXTURE_NAMES } from './fixture'

/**
 * A viewport four cards wide and tall enough for all six fixture cards.
 *
 * `itemWidth` matters as much as the height: the grid divides the viewport width
 * by it to get the row length, and a zero there means zero items per row.
 *
 * `itemHeight` is 332 rather than 260 because two rows have added fixed boxes to
 * the card: A3's availability strip is 49px of it (a 41px two-line box plus the
 * card's 8px gap) and row X2's tag row a further 23 (a 15px line plus the same
 * gap). It is a number the virtualiser is told rather than one it measures, so it
 * has to move with the card.
 */
const VIEWPORT = { viewportHeight: 1200, viewportWidth: 960, itemHeight: 332, itemWidth: 232 }

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

/**
 * The availability chips on the one rendered card, in order.
 *
 * Read off the DOM rather than off `availabilityOf`, so these assertions fail if
 * the strip stops rendering rather than only if the derivation changes —
 * `availability.test.ts` and `corpus.test.ts` cover the derivation.
 */
const chipLabels = () =>
  [...document.querySelectorAll('.of-card .of-avail')].map((chip) =>
    // The clipped hint rides in the accessible name after the visible label; the
    // visible text is everything before the em dash it is introduced with.
    (chip.textContent ?? '').split('—')[0]?.trim(),
  )

const chipStates = () =>
  [...document.querySelectorAll('.of-card .of-avail')].map(
    (chip) => `${chip.getAttribute('data-kind') ?? ''}:${chip.getAttribute('data-state') ?? ''}`,
  )

/**
 * The tag chips on the one rendered card, in order.
 *
 * Read off the DOM for the same reason `chipLabels` is: these assertions fail if
 * the row stops rendering, not only if `cardTagChips` changes its answer.
 * `format.test.ts` covers the three rules and `corpus.test.ts` the corpus.
 */
const tagLabels = () =>
  [...document.querySelectorAll('.of-card .of-card-tags .of-chip')].map((chip) =>
    (chip.textContent ?? '').split('—')[0]?.trim(),
  )

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

  /**
   * **The preview is not the print, asserted on a rendered card.** Row C7.
   *
   * The guard exists because of a shipped defect rows V3 and V5 both fixed: a
   * card showed one file and the placement contained another.
   * `builder/panels/palette.corpus.test.ts` measures the disagreement headlessly
   * over the whole corpus — 931 two-sided items, all three locks — but nothing
   * has rendered `item.preview` and compared it to the print since the library's
   * item rows were deleted, and row C1 named this screen as the only surface
   * left that renders it.
   *
   * The fixture's merged pair is the one item that can show it: ord 1 is the
   * `openlock` topper and ord 6 the `dragonlock` base-integrated print of the
   * same design, so under a `dragonlock` preference the two answers differ. The
   * print is **derived** here rather than written down, so this stays true if
   * `selectVariantForLock`'s ranking moves.
   *
   * Two halves, because a card can show the right file and still hand the wrong
   * one on: the thumbnail's sheet, and the ordinal `?tile=` opens the drawer at —
   * which is where `placeOnPlan.ts#placeFileAsFamily` gets the file it pins.
   */
  it('renders the preview file, and opens on it, whatever the lock would print', async () => {
    setLockSystem('dragonlock')
    const file = CatalogFileSchema.parse(FIXTURE_CATALOG)
    const index = buildAggregateIndex(file)
    const byId = new Map(file.records.map((record) => [record.id, record]))
    const item = index.aggregates.find((one) => one.variantClass === 'both')
    if (item === undefined) throw new Error('the fixture lost its merged pair')

    const preview = byId.get(item.preview)
    const print = byId.get(selectVariantForLock(item, 'dragonlock').variant.id)
    expect(preview).toBeDefined()
    expect(print).toBeDefined()
    // The premise. Without it the two assertions below would both pass on a card
    // that read the lock, which is the bug they exist to catch.
    expect(print?.id).not.toBe(preview?.id)

    await renderCatalog()
    const card = screen
      .getByRole('heading', { level: 2, name: FIXTURE_NAMES[1] })
      .closest('.of-card')
    expect(card).not.toBeNull()

    const sheet = card?.querySelector<HTMLImageElement>('.of-thumb-sheet')
    expect(sheet?.getAttribute('src')).toContain(preview?.blob)
    expect(sheet?.getAttribute('src')).not.toContain(print?.blob)

    // `?tile=` is a `ManifestOrdinal`, so the drawer opens on the variant the
    // card drew and the place button pins that file rather than the lock's.
    const open = card?.querySelector<HTMLAnchorElement>('.of-card-open')
    expect(open?.getAttribute('href')).toContain(`tile=${preview?.ord}`)
    expect(open?.getAttribute('href')).not.toContain(`tile=${print?.ord}`)
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

  it('links by the preview variant’s ordinal, never by the aggregate’s address', async () => {
    await renderCatalog('/catalog?tex=wood')

    // Row A4 types `?tile=` as a `ManifestOrdinal` and A1 brands
    // `AggregateAddress` so it cannot be handed to one. The address happens to
    // equal the group's lowest ordinal, so a card whose preview is *not* the
    // lowest is the only case that can tell the two apart — this one's preview is
    // its only variant, and the assertion is that the number is an `ord` at all.
    const link = screen.getByRole('link', { name: FIXTURE_NAMES[3] })
    expect(link).toHaveAttribute('href', '/catalog?tex=wood&tile=3')
  })
})

/* --------------------------------------------------------------- aggregation */

describe('a card is an item, not a file', () => {
  it('renders one card for the two files of one design', async () => {
    await renderCatalog('/catalog?tex=dungeon_stone%7Ceroded')

    // Ord 1 and ord 6 are one design, so they are one card — with one title,
    // not two.
    expect(cardTitles()).toEqual([FIXTURE_NAMES[1]])
    expect(document.querySelectorAll('.of-card')).toHaveLength(1)
  })

  it('states the byte range across the item’s variants, not one file’s size', async () => {
    await renderCatalog('/catalog?tex=dungeon_stone%7Ceroded')

    // 4.5 MB (the dragonlock print) to 15.9 MB (the topper). One figure here
    // would be an assertion the data does not support: A1 measured the max/min
    // ratio at 3.46 at p90 across multi-variant items.
    expect(screen.getByText('4.5–15.9 MB')).toBeInTheDocument()
  })

  it('collapses the range to one figure for a single-variant item', async () => {
    await renderCatalog('/catalog?kinds=base')

    expect(screen.getByText('838 KB')).toBeInTheDocument()
    expect(document.querySelector('.of-card-bytes')?.textContent).not.toContain('–')
  })

  it('counts items in the result line and files beside them', async () => {
    await renderCatalog()

    // Six cards over seven files. Both numbers, because one of them alone is
    // either an under-report of the download or a disagreement with the grid.
    expect(screen.getByRole('status')).toHaveTextContent('6 tiles · 7 files')
  })

  it('drops the file clause when every match is a single file', async () => {
    await renderCatalog('/catalog?kinds=base')

    expect(screen.getByRole('status')).toHaveTextContent('1 tile match')
    expect(screen.getByRole('status').textContent).not.toContain('files')
  })
})

/* ------------------------------------------------------- availability chips */

describe('the availability chips', () => {
  it('says a base is needed, and names the lock the tile carries on its sides', async () => {
    await renderCatalog('/catalog?tex=wood')

    // A topper with `connection|side|openlock` and no bottom system: two parts to
    // print, and the openlock is between it and its neighbours rather than
    // between it and the table. Reading the flattened `conn` would have shown a
    // plain "OpenLOCK" here and over-claimed on 1,283 live toppers.
    expect(chipLabels()).toEqual(['Needs a base', 'OpenLOCK sides'])
    expect(chipStates()).toEqual(['base:need', 'lock:sides'])
  })

  it('says no base is needed and marks the lock as self-sufficient', async () => {
    await renderCatalog('/catalog?kinds=base')

    expect(chipLabels()).toEqual(['No base needed', 'OpenLOCK'])
    expect(chipStates()).toEqual(['base:have', 'lock:underside'])
  })

  it('says the base is optional for the merged pair — the point of aggregating', async () => {
    await renderCatalog('/catalog?tex=dungeon_stone%7Ceroded')

    // The topper needs a base, the dragonlock print does not, and the item offers
    // both. 931 live items read this way.
    expect(chipLabels()).toEqual(['Base optional', 'DragonLock'])
    expect(chipStates()).toEqual(['base:choice', 'lock:underside'])
  })

  it('reports an insert rather than inventing a lock for it', async () => {
    await renderCatalog('/catalog?kinds=%21other')

    expect(chipLabels()).toEqual(['No base needed', 'Insert'])
    expect(chipStates()).toEqual(['base:have', 'note:note'])
  })

  it('reports untagged joinery as unknown, not as incompatible', async () => {
    await renderCatalog('/catalog?tex=cave')

    // The cave corner wall needs no base and records nothing about what it
    // connects with. 93 live items are in this state and 33 of them name a lock
    // in the filename only.
    expect(chipLabels()).toEqual(['No base needed', 'Joinery untagged'])
  })

  it('gives every card at least one chip', async () => {
    await renderCatalog()

    const cards = [...document.querySelectorAll('.of-card')]
    expect(cards).toHaveLength(6)
    for (const card of cards) {
      expect(card.querySelectorAll('.of-avail').length).toBeGreaterThan(0)
    }
  })

  it('carries the claim in full in each chip’s accessible name', async () => {
    await renderCatalog('/catalog?tex=wood')

    // The fill difference between `underside` and `sides` is the only visual
    // difference, so a reader who cannot see it gets the sentence instead.
    const strip = screen.getByRole('list', { name: 'Availability' })
    expect(strip).toHaveTextContent('joins its neighbours with OpenLOCK')
    expect(strip).toHaveTextContent('needs a separately printed base')
  })

  it('explains the fill difference once, above the grid', async () => {
    await renderCatalog()

    const legend = document.querySelector('.of-avail-legend')
    expect(legend?.textContent).toContain('locks underneath')
    expect(legend?.textContent).toContain('joins at the sides only')
    // Hidden from assistive technology: every chip it explains already carries
    // the same sentence, so reading it too would say everything twice.
    expect(legend).toHaveAttribute('aria-hidden', 'true')
  })

  it('offers no legend above the empty state, where it would key nothing', async () => {
    await renderCatalog('/catalog?q=nothinglikethis')

    expect(document.querySelector('.of-avail-legend')).toBeNull()
  })
})

/* --------------------------------------------------------- the filename token */

describe('the filename token', () => {
  it('distinguishes a card without putting the raw filename on it', async () => {
    await renderCatalog('/catalog?kinds=base')

    // `dungeon_stone%base+square.1x3.openlock.stl` → `1x3`. 131 live display
    // names are shared by 323 items, and this is the field that separates them.
    expect(document.querySelector('.of-card-token')?.textContent).toBe('1x3')
  })

  it('skips the connection segment, so it names the design and not one variant', async () => {
    await renderCatalog('/catalog?tex=dungeon_stone%7Ceroded')

    // The preview is the openforge topper, whose filename tail is
    // `4x#Q,90.openlock` — but the token stops at the first segment that is not
    // connection vocabulary, so both variants of this item agree on it. Taking
    // the tail whole would disagree between the variants of 1,210 live items.
    expect(document.querySelector('.of-card-token')?.textContent).toBe('4x#Q,90')
  })

  it('still never renders a whole filename', async () => {
    await renderCatalog()

    for (const record of FIXTURE_CATALOG.records) {
      expect(screen.queryByText(record.file)).not.toBeInTheDocument()
    }
  })
})

/* ------------------------------------------------------------------ tag chips */

describe('the tag chips', () => {
  it('shows a tag the title does not already carry', async () => {
    await renderCatalog('/catalog?kinds=base')

    // `dungeon_stone%base+square.1x3.openlock.stl` carries `shape|base`,
    // `texture|dungeon_stone`, `build|separate wall` and `connection|openlock`.
    // Three of the four are already on the card — "Base" and "Dungeon Stone" in
    // the title, the connection in the availability strip — so one chip is left,
    // and it is the one the card had no other way to say.
    expect(tagLabels()).toEqual(['Separate wall'])
  })

  it('renders the row even when there is nothing to put in it', async () => {
    // "Wood Floor Wall 1x1" carries `shape|floor`, `shape|wall`, `texture|wood`
    // and `connection|side|openlock`: every one is suppressed or dropped. The
    // `<ul>` is still in the DOM, because `VirtuosoGrid` assumes a uniform item
    // height and a row that disappeared on a quarter of the corpus would drift
    // the scroll position. jsdom reports every box as 0x0, so what this proves is
    // that the element is rendered — **not** that it occupies 15px. Only a real
    // engine can show that, and `catalog.css` is where the height is declared.
    await renderCatalog('/catalog?tex=wood')

    expect(tagLabels()).toEqual([])
    expect(document.querySelector('.of-card .of-card-tags')).toBeInTheDocument()
    // And it is not announced as an empty list.
    expect(document.querySelector('.of-card .of-card-tags')).not.toHaveAttribute('aria-label')
  })

  it('never chips a connection tag, which the availability strip owns', async () => {
    await renderCatalog()

    // Every fixture record but one carries a `connection|` tag, and no card
    // shows one as a chip: `conn` throws the position segment away, which is the
    // measured reason `availability.ts` derives the claim instead of printing it.
    for (const label of ['OpenLOCK', 'DragonLock', 'openlock', 'dragonlock']) {
      expect(
        [...document.querySelectorAll('.of-card .of-card-tags .of-chip')].map((chip) => chip.textContent),
      ).not.toContain(label)
    }
  })

  it('carries the tag’s own path in the chip’s accessible name', async () => {
    await renderCatalog('/catalog?kinds=base')

    // "Separate wall" alone does not say what kind of fact it is. The clipped
    // hint is the segments above the label — here just `build`.
    const chip = document.querySelector('.of-card .of-card-tags .of-chip')
    expect(chip?.textContent).toContain('Separate wall')
    expect(chip?.textContent).toContain('build')
  })
})

/* -------------------------------------------------------------- detail drawer */

describe('the detail drawer', () => {
  it('opens on a card press, which until row X2 it could not', async () => {
    // `src/screens/detail/index.ts` had said since row 13 that the catalog
    // screen mounts `TileDrawer`. It did not: the card's link set `?tile=`, the
    // URL changed and nothing opened — and because nothing imported the
    // component, the whole of §2.5 was tree-shaken out of `dist/`. This is the
    // assertion that would have caught it.
    await renderCatalog('/catalog?kinds=base')

    fireEvent.click(screen.getByRole('link', { name: new RegExp(FIXTURE_NAMES[5]) }))

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: FIXTURE_NAMES[5] })).toBeInTheDocument()
    })
  })

  it('offers the gated 3D view inside it, which is where row 21 put it', async () => {
    // The other half of the same defect: `Tile3DPanel` was mounted nowhere, so
    // G2 measured three.js as absent from the bundle entirely. The fixture base
    // is 838 KB, well inside the 24 MiB gate, so the control is offered rather
    // than refused.
    //
    // What this proves is that the panel is mounted and its gate decided `stl`.
    // It does **not** prove anything renders: the press behind this button loads
    // a `lazy()` chunk that constructs a `WebGLRenderer`, and jsdom has no WebGL
    // and rasterises nothing. `src/three/panel.test.tsx` covers the panel's own
    // states and `src/three/gate.test.ts` the corpus split behind the gate.
    await renderCatalog('/catalog?kinds=base')
    fireEvent.click(screen.getByRole('link', { name: new RegExp(FIXTURE_NAMES[5]) }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /View in 3D/ })).toBeInTheDocument()
    })
    // The size is part of the label, not decoration: the press starts the
    // download, so the figure has to be legible before it.
    expect(screen.getByRole('button', { name: /View in 3D/ })).toHaveTextContent('0.8 MB')
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
