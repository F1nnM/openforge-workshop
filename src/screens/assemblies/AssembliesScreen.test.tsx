// @vitest-environment jsdom
/**
 * The screen, driven through one **real** recipe.
 *
 * The fixture is not an invented template. It is a ten-record catalog built to
 * satisfy `S2W: Wall on Tile: Wall: Torch (Modular)` — one of the shipped 40,
 * with its real `require`, `deny` and `constrain` blocks, including the
 * `{ tag: 'connection', siblings: ['wall'] }` entry and the two `filter`s that
 * moderate it. So these tests exercise the fixtures' own grammar rather than a
 * shape chosen to make them pass, and a `templates.ts` regeneration that changed
 * that recipe would fail here.
 *
 * The only stub is the network: the index is a 5.6 MB build artefact, and
 * `useCatalogIndex` fetches it. Everything else is real — the aggregation, C1's
 * resolution, C2's `compositionIndexFor`, the store.
 *
 * ## What these tests prove
 *
 *   - The 40 recipes list, grouped 20 and 20 on their own build tag.
 *   - Opening a recipe shows its parts, and the first is the one the guide opens.
 *   - **A pick narrows the next part, and the screen says so in numbers.** This
 *     is the row, and it is the assertion that would fail if narrowing were
 *     mistakenly dropped in favour of C2's greying-only model.
 *   - **A dead-end card is greyed, focusable, and states its consequence** — and
 *     pressing it does nothing.
 *   - Paging bounds a large step, and the button says how many are left.
 *   - A finished recipe writes its files to the real store.
 *
 * ## What they cannot prove
 *
 * **jsdom measures no layout and rasterises nothing.** So:
 *
 *   - Nothing here shows the grid is legible, that a card is the same height as
 *     its neighbour, or that a 428-card step is usable. `assemblies.css` is not
 *     under test; every geometric claim in it rests on reading.
 *   - The image-memory argument for {@link STEP_PAGE} and for opening one step at
 *     a time is **unobservable here**. jsdom decodes no sprite sheet, so a page
 *     of 48 and a page of 480 cost the same in this environment. What is asserted
 *     is the *mechanism* — that a bounded number of cards is in the DOM and that a
 *     closed step renders none — which is the part a test can hold. The 10.5 MB
 *     per sheet is C2's measurement and the bound follows from it by arithmetic,
 *     not by this file.
 *   - `aria-disabled` is asserted as an attribute. That it produces the right
 *     announcement in a real screen reader is not something jsdom can say.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetCatalogSearchIndex } from '@/screens/catalog'
import { clearPersistedWorkshopState, resetWorkshop, useWorkshopStore } from '@/store'
import { CatalogStatsProvider, resetCatalogIndexCache } from '@/ui/shell'

import { STEP_PAGE } from './assembly'
import { AssembliesScreen } from './AssembliesScreen'
import type { FixtureRecord } from './catalogFixture'
import { fixtureCatalog } from './catalogFixture'

/* ------------------------------------------------------------------ fixture */

const RECIPE = 'S2W: Wall on Tile: Wall: Torch (Modular)'

/**
 * Ten records, chosen so every branch of that recipe is reachable.
 *
 * | record | why it is here |
 * | --- | --- |
 * | `wall-2`, `wall-4` | two widths, so the `size|width` constrain has something to do |
 * | `wall-6` | a width with **no** floor and no base — the dead end |
 * | `floor-2`, `floor-4` | one per wall width; `floor-2` is what a width-2 wall narrows to |
 * | `base-2`, `base-4` | ditto, and they carry `connection|openlock` so the `siblings: ['wall']` entry has a tag to inherit |
 * | `base-2-alt` | a second width-2 base, so the narrowed step still has two cards and "narrowed" is not the same as "settled" |
 * | `filler` | matches nothing in the recipe, so a part cannot pass by matching everything |
 *
 * `wall-2` carries `connection|openforge` and `connection|side|openlock`
 * **as well as** `connection|openlock`. The first two are what the recipe's two
 * `filter` entries exist to remove, so their presence is what makes the filter
 * assertion meaningful rather than vacuous.
 */
const RECORDS: readonly FixtureRecord[] = [
  {
    id: 'tiles/fix/wall-2.stl',
    ord: 0,
    design: 'wall-2',
    name: 'Torch Wall 2',
    tags: [
      'build|separate wall',
      'component|torch',
      'shape|wall',
      'size|width|2',
      'connection|openlock',
      'connection|openforge',
      'connection|side|openlock',
    ],
  },
  {
    id: 'tiles/fix/wall-4.stl',
    ord: 1,
    design: 'wall-4',
    name: 'Torch Wall 4',
    tags: ['build|separate wall', 'component|torch', 'shape|wall', 'size|width|4', 'connection|openlock'],
  },
  {
    id: 'tiles/fix/wall-6.stl',
    ord: 2,
    design: 'wall-6',
    name: 'Torch Wall 6',
    tags: ['build|separate wall', 'component|torch', 'shape|wall', 'size|width|6', 'connection|openlock'],
  },
  {
    id: 'tiles/fix/floor-2.stl',
    ord: 3,
    design: 'floor-2',
    name: 'Wall Floor 2',
    tags: ['shape|floor', 'shape|floor|wall', 'build|s2w', 'size|width|2', 'size|depth|2'],
  },
  {
    id: 'tiles/fix/floor-4.stl',
    ord: 4,
    design: 'floor-4',
    name: 'Wall Floor 4',
    tags: ['shape|floor', 'shape|floor|wall', 'build|s2w', 'size|width|4', 'size|depth|2'],
  },
  {
    id: 'tiles/fix/base-2.stl',
    ord: 5,
    design: 'base-2',
    name: 'Wall Base 2',
    tags: [
      'shape|base',
      'shape|base|wall',
      'build|s2w',
      'size|width|2',
      'size|depth|2',
      'connection|openlock',
    ],
  },
  {
    id: 'tiles/fix/base-2-alt.stl',
    ord: 6,
    design: 'base-2-alt',
    name: 'Wall Base 2 Alt',
    tags: [
      'shape|base',
      'shape|base|wall',
      'build|s2w',
      'size|width|2',
      'size|depth|2',
      'connection|openlock',
    ],
  },
  {
    id: 'tiles/fix/base-4.stl',
    ord: 7,
    design: 'base-4',
    name: 'Wall Base 4',
    tags: [
      'shape|base',
      'shape|base|wall',
      'build|s2w',
      'size|width|4',
      'size|depth|2',
      'connection|openlock',
    ],
  },
  { id: 'tiles/fix/filler.stl', ord: 8, design: 'filler', name: 'Unrelated', tags: ['texture|cave'] },
  /*
    A grate wall that the `Grate` recipe *denies*: it carries every tag that
    recipe requires and `shape|curved` as well. It is the difference between the
    two empty-step sentences — every ref resolves, and still nothing fits — and
    without it the fixture could only ever produce the dangling-ref case, because
    a tag absent from a nine-record vocabulary is absent from the index too.
  */
  {
    id: 'tiles/fix/grate-curved.stl',
    ord: 9,
    design: 'grate-curved',
    name: 'Curved Grate Wall',
    tags: [
      'build|separate wall',
      'component|grate',
      'shape|wall',
      'shape|curved',
      'size|width|2',
    ],
  },
]

const FIXTURE_CATALOG = fixtureCatalog(RECORDS)

/**
 * The same recipe over enough items to page.
 *
 * `STEP_PAGE + 12` walls, each its own design so each is its own card. The real
 * corpus reaches this on 4 of its 128 parts when walked in order and on 39 cold,
 * the largest being 428 items — so paging is a path the archive takes and not a
 * hypothetical, but it needs more records than the ten above to reach.
 */
const PAGED_CATALOG = fixtureCatalog([
  ...RECORDS.filter((record) => !record.design.startsWith('wall-')),
  ...Array.from({ length: STEP_PAGE + 12 }, (_unused, at) => ({
    id: `tiles/fix/many-${String(at).padStart(3, '0')}.stl`,
    ord: 100 + at,
    design: `many-${String(at).padStart(3, '0')}`,
    name: `Many Wall ${String(at).padStart(3, '0')}`,
    tags: [
      'build|separate wall',
      'component|torch',
      'shape|wall',
      'size|width|2',
      'connection|openlock',
    ],
  })),
])

/* ------------------------------------------------------------------ harness */

function stubFetch(catalog: unknown = FIXTURE_CATALOG): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve(catalog),
      }),
    ),
  )
}

async function renderScreen() {
  const result = render(
    <CatalogStatsProvider value={null}>
      <AssembliesScreen />
    </CatalogStatsProvider>,
  )
  // The list renders without the index; the steps need it.
  await waitFor(() => {
    expect(screen.getByRole('heading', { level: 1, name: 'Guided assemblies' })).toBeTruthy()
  })
  return result
}

/** Open one recipe and wait for its first step to resolve. */
async function openRecipe(name = RECIPE) {
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(name.replace(/[()]/g, '\\$&')) }))
  })
  await waitFor(() => {
    expect(screen.getByRole('group', { name: 'Choose the wall' })).toBeTruthy()
  })
}

/**
 * The cards inside one step, by their accessible name.
 *
 * Keyed on `aria-label` being *present*, which is what tells a card apart from
 * the step's own "Choose —" / "Show 48 more" controls: only a card carries one,
 * because only a card has a consequence to state.
 */
function cardsIn(part: string): string[] {
  return within(screen.getByRole('group', { name: `Choose the ${part}` }))
    .queryAllByRole('button')
    .map((node) => node.getAttribute('aria-label'))
    .filter((label): label is string => label !== null)
}

/**
 * Press a card in a step by the item name on it.
 *
 * `act` synchronously, not `await act(async …)`: every state transition on this
 * screen is a `useState` write, so there is nothing to await, and an async `act`
 * with no `await` inside is what `@typescript-eslint/require-await` objects to.
 * The one genuinely asynchronous step is the index fetch, which `renderScreen`
 * and `openRecipe` wait for with `waitFor`.
 */
function pick(part: string, item: string): void {
  const step = within(screen.getByRole('group', { name: `Choose the ${part}` }))
  act(() => {
    fireEvent.click(step.getByRole('button', { name: new RegExp(`^${item} — `) }))
  })
}

/**
 * Open a step, or leave it alone if it is already open.
 *
 * An open step renders its grid instead of its opener, so the button is simply
 * absent — which is the state the guide leaves `state.next` in.
 */
function openStep(part: string): void {
  const step = within(screen.getByRole('group', { name: `Choose the ${part}` }))
  const opener = step.queryByRole('button', { name: /^(Choose —|Filled)/ })
  if (opener === null) return
  act(() => {
    fireEvent.click(opener)
  })
}

beforeEach(() => {
  stubFetch()
  resetWorkshop()
  resetCatalogSearchIndex()
  resetCatalogIndexCache()
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetWorkshop()
  clearPersistedWorkshopState()
  resetCatalogSearchIndex()
  resetCatalogIndexCache()
})

/* -------------------------------------------------------------------- tests */

describe('the recipe list', () => {
  it('lists all 40 recipes in two groups of 20', async () => {
    await renderScreen()

    expect(screen.getByRole('heading', { name: /Single piece — 20/ })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /Modular — 20/ })).toBeTruthy()
    // Every recipe is a button, plus nothing else: 40 buttons on this view.
    expect(screen.getAllByRole('button')).toHaveLength(40)
  })

  it('names each recipe’s parts, so a recipe can be chosen before the index lands', async () => {
    await renderScreen()
    const button = screen.getByRole('button', { name: new RegExp(RECIPE.replace(/[()]/g, '\\$&')) })

    expect(button.textContent).toContain('wall · floor · base')
  })
})

describe('opening a recipe', () => {
  it('shows one step per part and opens the first', async () => {
    await renderScreen()
    await openRecipe()

    expect(screen.getByRole('group', { name: 'Choose the wall' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Choose the floor' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Choose the base' })).toBeTruthy()
    // Only the open step renders cards. A three-part recipe therefore mounts one
    // grid, not three — the bound the module docblock argues for, asserted as a
    // mechanism because jsdom cannot observe the image memory it is about.
    expect(cardsIn('wall').length).toBeGreaterThan(0)
    expect(cardsIn('floor')).toEqual([])
    expect(cardsIn('base')).toEqual([])
  })

  it('states how many items and files fit, and that nothing has narrowed yet', async () => {
    await renderScreen()
    await openRecipe()
    const wall = screen.getByRole('group', { name: 'Choose the wall' })

    expect(wall.textContent).toContain('3 items fit, over 3 files.')
    expect(wall.textContent).not.toContain('Narrowed from')
    expect(screen.getByText(/0 of 3 parts answered/)).toBeTruthy()
  })

  it('goes back to the list', async () => {
    await renderScreen()
    await openRecipe()
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: '← All recipes' }))
    })

    expect(screen.getByRole('heading', { name: /Modular — 20/ })).toBeTruthy()
  })
})

describe('progressive narrowing, on the screen', () => {
  it('narrows the floor when the wall is chosen, and shows both numbers', async () => {
    await renderScreen()
    await openRecipe()

    // Before: two floors fit, one per wall width.
    openStep('floor')
    expect(screen.getByRole('group', { name: 'Choose the floor' }).textContent).toContain(
      '2 items fit, over 2 files.',
    )

    openStep('wall')
    pick('wall', 'Torch Wall 2')

    const floor = screen.getByRole('group', { name: 'Choose the floor' })
    expect(floor.textContent).toContain('1 item fits, over 1 file.')
    expect(floor.textContent).toContain('Narrowed from 2 by what you have already chosen.')
  })

  it('narrows differently for the other width — the pick is read at selection time', async () => {
    await renderScreen()
    await openRecipe()
    pick('wall', 'Torch Wall 4')
    openStep('floor')

    expect(cardsIn('floor').map((label) => label.split(' — ')[0])).toEqual(['Wall Floor 4'])
  })

  it('tells a card what it would narrow before it is pressed', async () => {
    await renderScreen()
    await openRecipe()

    // Two consequences on one card, because the recipe has two other parts.
    expect(cardsIn('wall').find((label) => label.startsWith('Torch Wall 2'))).toContain(
      'Narrows floor 2 to 1, base 3 to 2.',
    )
  })

  it('applies the connection constrain through its siblings list and its filters', async () => {
    /*
      The base part inherits `connection` from the `wall` sibling only, with
      `connection|side` and `connection|openforge` filtered out. `wall-2` carries
      all three, so a reading that ignored the filters would require
      `connection|openforge` — which no base has — and empty the step.
    */
    await renderScreen()
    await openRecipe()
    pick('wall', 'Torch Wall 2')
    openStep('base')

    expect(cardsIn('base').map((label) => label.split(' — ')[0]).sort()).toEqual([
      'Wall Base 2',
      'Wall Base 2 Alt',
    ])
  })
})

describe('dead ends', () => {
  it('greys the card that would empty the other parts, and says which', async () => {
    await renderScreen()
    await openRecipe()
    const six = within(screen.getByRole('group', { name: 'Choose the wall' })).getByRole('button', {
      name: /^Torch Wall 6 — /,
    })

    expect(six.getAttribute('aria-disabled')).toBe('true')
    expect(six.getAttribute('aria-label')).toContain('unavailable')
    // Alphabetical, so the sentence is stable whatever order the parts declare.
    expect(six.getAttribute('aria-label')).toContain('Leaves base and floor with nothing to fill them.')
    // Focusable, not `disabled`: the accessible name has to survive.
    expect(six.hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('group', { name: 'Choose the wall' }).textContent).toContain(
      '1 of these would leave another part with nothing to fill it',
    )
  })

  it('declines the press rather than preventing it', async () => {
    await renderScreen()
    await openRecipe()
    pick('wall', 'Torch Wall 6')

    // Nothing chosen, and the step is still the one the guide points at.
    expect(screen.getByText(/0 of 3 parts answered/)).toBeTruthy()
    expect(cardsIn('wall').length).toBe(3)
  })
})

describe('finishing', () => {
  it('reports progress, bills the files, and writes their items to the store', async () => {
    await renderScreen()
    await openRecipe()
    pick('wall', 'Torch Wall 2')
    expect(screen.getByText(/1 of 3 parts answered/)).toBeTruthy()

    openStep('floor')
    pick('floor', 'Wall Floor 2')
    openStep('base')
    pick('base', 'Wall Base 2')

    expect(screen.getByText(/3 of 3 parts answered/)).toBeTruthy()
    expect(screen.getByText('3 files to print.')).toBeTruthy()

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Add all to library' }))
    })

    // Designs, not files: row V1's library holds items. The three parts of this
    // recipe are three separate items, so the button's two counts agree and the
    // note above it stays a bare "3 files to print." — the panel only splits the
    // two figures when a recipe names two prints of one item, which no fixture
    // template does.
    expect(Object.keys(useWorkshopStore.getState().library).sort()).toEqual(['base-2', 'floor-2', 'wall-2'])
    expect(screen.getByRole('button', { name: 'Added to your library' })).toBeTruthy()
  })

  it('clears a pick when its own card is pressed again', async () => {
    await renderScreen()
    await openRecipe()
    pick('wall', 'Torch Wall 2')
    expect(screen.getByText(/1 of 3 parts answered/)).toBeTruthy()

    openStep('wall')
    pick('wall', 'Torch Wall 2')

    expect(screen.getByText(/0 of 3 parts answered/)).toBeTruthy()
  })
})

describe('paging a large step', () => {
  it('mounts one page, then the rest on request, and says how many are left', async () => {
    vi.unstubAllGlobals()
    stubFetch(PAGED_CATALOG)
    resetCatalogSearchIndex()
    resetCatalogIndexCache()

    await renderScreen()
    await openRecipe()

    const total = STEP_PAGE + 12
    expect(cardsIn('wall')).toHaveLength(STEP_PAGE)

    const more = within(screen.getByRole('group', { name: 'Choose the wall' })).getByRole('button', {
      name: `Show 12 more of ${String(total)}`,
    })
    act(() => {
      fireEvent.click(more)
    })

    expect(cardsIn('wall')).toHaveLength(total)
    // And the opener is gone rather than showing "Show 0 more".
    expect(
      within(screen.getByRole('group', { name: 'Choose the wall' })).queryByRole('button', {
        name: /^Show /,
      }),
    ).toBeNull()
  })
})

describe('a part nothing fits', () => {
  it('says nothing fits when every ref resolves and no candidate survives', async () => {
    /*
      The one grate wall in the fixture is `shape|curved`, which that recipe
      denies. So the step is empty for the ordinary reason — the archive has
      nothing that fits — which is the state 0 of the 128 real parts are in, and
      the state a corpus gap would put one in.
    */
    await renderScreen()
    await openRecipe('S2W: Wall on Tile: Wall: Grate (Modular)')
    const wall = screen.getByRole('group', { name: 'Choose the wall' })

    expect(wall.textContent).toContain('Nothing in the archive fits this part')
    expect(cardsIn('wall')).toEqual([])
  })

  it('says so differently when the part names a tag the index does not hold', async () => {
    /*
      A different sentence, and the distinction is the point: "nothing matches"
      is a gap in the archive and "no such tag" is a gap in the *index*, which is
      what a fixture import that renamed a tag would produce. All 91 real
      `require` refs resolve today, so this branch is unreachable on the live
      corpus and reachable only here.
    */
    await renderScreen()
    await openRecipe('S2W: Wall on Tile: Wall: Portcullis (Modular)')
    const wall = screen.getByRole('group', { name: 'Choose the wall' })

    expect(wall.textContent).toContain('component|portcullis')
    expect(wall.textContent).toContain('this index holds no such tag')
  })
})
