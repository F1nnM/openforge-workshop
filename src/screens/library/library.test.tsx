// @vitest-environment jsdom
/**
 * Library screen tests.
 *
 * Rendered through the **real router**, the **real facet engine** over a
 * nine-record fixture, and the **real store**. The only stubs are the network
 * (the index is a 5.6 MB build artefact) and `URL.createObjectURL`, which jsdom
 * does not implement.
 *
 * What is asserted, and why each one is here rather than left to a manual pass:
 *
 *   - **Grouping is deterministic and the counts add up.** A multi-kind tile
 *     appearing in two groups is the failure this screen is most likely to have,
 *     it looks plausible on screen, and it makes the summary disagree with the
 *     groups under it.
 *   - **The no-kind bucket renders.** 11.9% of the corpus has an empty `kinds`,
 *     so a screen that groups only by the kinds a tile *has* silently loses an
 *     eighth of anything the user can save.
 *   - **The MB total dedupes shared md5s.** 171 corpus md5s carry 520 rows;
 *     summing over ids overstates the download.
 *   - **Remove writes through to the store**, not just to the DOM, and the
 *     summary follows it.
 *   - **Export → import round-trips, and a corrupt file reports.** The reason
 *     the feature exists (Safari's seven-day eviction) means it is used exactly
 *     when the local state is already gone, so a silent failure there loses the
 *     only copy.
 *
 * The fixture is parsed by `CatalogFile.parse` on the way through the stubbed
 * `fetch`, so a record that drifted from the schema fails here.
 */
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TileId } from '@/catalog'
import { createWorkshopRouter } from '@/routes'
import { resetCatalogSearchIndex } from '@/screens/catalog'
import {
  addToLibrary,
  clearPersistedWorkshopState,
  placeTile,
  resetWorkshop,
  useWorkshopStore,
} from '@/store'
import { CatalogStatsProvider, resetCatalogIndexCache } from '@/ui/shell'

/* ------------------------------------------------------------------ fixture */

/**
 * Eleven records over ten designs, one per branch this screen has to handle.
 *
 * | ord | kinds          | note |
 * | --- | -------------- | ---- |
 * | 0   | `floor`        | plain |
 * | 1   | `wall`         | plain |
 * | 2   | `floor` `wall` | two buckets — must appear once, under Walls |
 * | 3   | `base` `wall`  | two buckets — must appear once, under Bases |
 * | 4   | *(none)*       | the `!other` bucket |
 * | 5   | `wall`         | **shares ord 1's md5** — the same STL under a second path |
 * | 6   | `stairs`       | a rare kind, for group ordering |
 * | 7   | `wall`         | second wall, so a group holds more than one card |
 * | 8   | `wall`         | 540 MB — see below |
 * | 9   | `wall`         | **shares ord 7's design** — row A3's merged pair |
 * | 10  | `wall`         | **shares ord 7's design and its md5** — two saved variants, one mesh |
 *
 * Ord 8 is **larger than any real file** (the corpus maximum is 108.9 MB). It is
 * deliberate: the 512 MB download warning is a real surface with a real
 * threshold, and reaching it honestly would need six fixture records at 90 MB
 * each, which would put a warning on every other test in this file. One
 * oversized record keeps the warning reachable in a single `addToLibrary` and
 * quiet everywhere else.
 *
 * Ords 7, 9 and 10 are **one design with three variants**, which is the shape row
 * A3 created: the screen lists items and the store holds files, so one card can
 * stand for one saved file or three. They agree on every facet A1 hoists — name,
 * kinds, texture, build, foot — and differ only in the connection axis and its
 * consequences, because A1 measured that 0 of 3,822 live aggregates disagree on
 * any hoisted facet. Ord 10 additionally shares ord 7's md5, so the card's own
 * byte figure has a dedupe to do: 66 live items hold two variants on one mesh.
 *
 * Ord 5 keeps a **different** design from ord 1 on purpose. It is the older
 * shared-md5 case — one STL filed under two catalog paths — and conflating it
 * with the merged pair would leave neither tested.
 */
const FIXTURE_TAGS = [
  'shape|floor',
  'shape|wall',
  'shape|base',
  'shape|stairs',
  'component|door',
  'texture|cave',
  // Row A3: the availability chips read the *positional* connection tags, so a
  // fixture that only set `CatalogRecord.conn` would render no lock chip at all.
  'connection|openlock',
  'connection|openforge',
]

const NAMES = [
  'Cave Floor 2x2',
  'Cave Wall 4x',
  'Cave Wall On Tile 1x1',
  'Cave Wall Base 1x3',
  'Cave Rectangular Door',
  'Cave Wall 4x Alternate Path',
  'Cave Stairs 2x2',
  'Cave Arrow Slit 2x',
  'Cave Wall Colossal 4x',
  'Cave Arrow Slit 2x',
  'Cave Arrow Slit 2x',
] as const

/** Ord 1 and ord 5 are the same mesh: the shared-md5 case. */
const SHARED_BLOB = '0000000000000000000000000000bbb2'

/** Ords 7, 9 and 10 are one design. Ord 10 also shares ord 7's mesh. */
const PAIR_DESIGN = 'dpair'
const PAIR_BLOB = '0000000000000000000000000000bbb7'

interface FixtureSpec {
  kinds: string[]
  tags: number[]
  bytes: number
  blob?: string
  sprite?: boolean
  design?: string
  layer?: 'base' | 'integral' | 'topper' | 'insert'
  file?: string
  /** Replaces `tags` where a record needs a `connection|` tag of its own. */
  tagsOverride?: number[]
}

const SPECS: readonly FixtureSpec[] = [
  { kinds: ['floor'], tags: [0, 5], bytes: 8_925_384 },
  { kinds: ['wall'], tags: [1, 5], bytes: 15_853_634, blob: SHARED_BLOB },
  { kinds: ['floor', 'wall'], tags: [0, 1, 5], bytes: 4_307_234 },
  { kinds: ['base', 'wall'], tags: [1, 2, 5], bytes: 838_214 },
  // Like exactly one live tile of 8,702, this one has no sprite sheet.
  { kinds: [], tags: [4], bytes: 45_284, sprite: false },
  { kinds: ['wall'], tags: [1, 5], bytes: 15_853_634, blob: SHARED_BLOB },
  { kinds: ['stairs'], tags: [3, 5], bytes: 22_110_002 },
  {
    kinds: ['wall'],
    tags: [1, 5],
    bytes: 6_004_100,
    blob: PAIR_BLOB,
    design: PAIR_DESIGN,
    layer: 'integral',
    file: 'cave%arrow_slit.2x.openlock.stl',
    tagsOverride: [1, 5, 6],
  },
  { kinds: ['wall'], tags: [1, 5], bytes: 540_000_000 },
  // The merged pair's other half: the same design as a topper, so the item is
  // `Base optional` and its byte range spans the two.
  {
    kinds: ['wall'],
    tags: [1, 5],
    bytes: 3_002_050,
    design: PAIR_DESIGN,
    layer: 'topper',
    file: 'cave%arrow_slit.2x.openforge.stl',
    tagsOverride: [1, 5, 7],
  },
  // A third variant of the same design, on the same mesh as ord 7 — so saving
  // both counts one file, not two.
  {
    kinds: ['wall'],
    tags: [1, 5],
    bytes: 6_004_100,
    blob: PAIR_BLOB,
    design: PAIR_DESIGN,
    layer: 'integral',
    file: 'cave%arrow_slit.2x.openlock+topless.stl',
    tagsOverride: [1, 5, 6],
  },
]

const FIXTURE_CATALOG = {
  version: {
    schema: 1,
    pipeline: 1,
    fixtures: '0000000000000000000000000000000000000000',
    manifest: 1,
    built: '2026-09-01T00:00:00.000Z',
  },
  assets: {
    models: 'https://objects.openforge.tools/models',
    sprites: 'https://objects.openforge.tools/sprites',
    thumbs: 'https://objects.openforge.tools/thumbs',
    lod: 'https://objects.openforge.tools/lod',
  },
  sprite: { rows: 2, cols: 5, tile: 512, frames: 10, defaultFrame: 0 },
  tags: [...FIXTURE_TAGS],
  records: SPECS.map((spec, ord) => ({
    id: `tiles/cave/fixture/cave%fixture-${String(ord)}.stl`,
    ord,
    blob: spec.blob ?? `0000000000000000000000000000bb${String(ord).padStart(2, 'b')}`,
    file: spec.file ?? `cave%fixture-${String(ord)}.stl`,
    bytes: spec.bytes,
    sprite: spec.sprite ?? true,
    family: 'tiles/cave/fixture',
    design: spec.design ?? `dfix00${String(ord)}`,
    name: NAMES[ord],
    kinds: spec.kinds,
    conn: ['openlock'],
    layer: spec.layer ?? (spec.kinds.includes('base') ? 'base' : 'integral'),
    texture: 'cave',
    tags: spec.tagsOverride ?? spec.tags,
    foot: { shape: 'rect' as const, w: 1, d: 1 },
  })),
}

function fixtureId(ord: number): TileId {
  return TileId.parse(FIXTURE_CATALOG.records[ord]?.id)
}

/* ------------------------------------------------------------------- harness */

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

/**
 * jsdom implements neither object URL function.
 *
 * The stub hands back a **hash** rather than a `blob:` URL on purpose: the
 * download is a synthesised anchor click, and jsdom logs "Not implemented:
 * navigation" for any real scheme while handling a hash change silently. The
 * blob itself is captured, which is what the round-trip test reads.
 */
function stubObjectUrls(): { blobs: Blob[] } {
  const blobs: Blob[] = []
  Object.defineProperty(URL, 'createObjectURL', {
    value: (blob: Blob) => {
      blobs.push(blob)
      return `#exported-${String(blobs.length)}`
    },
    configurable: true,
    writable: true,
  })
  Object.defineProperty(URL, 'revokeObjectURL', { value: () => {}, configurable: true, writable: true })
  return { blobs }
}

async function renderLibrary({ wait = true } = {}) {
  const router = createWorkshopRouter({ history: createMemoryHistory({ initialEntries: ['/library'] }) })
  const result = render(
    <CatalogStatsProvider value={null}>
      <RouterProvider router={router} />
    </CatalogStatsProvider>,
  )

  await act(async () => {
    await router.load()
  })
  if (wait) {
    // The index resolves in a microtask after mount, and the summary's size is
    // the last thing to arrive — so waiting for the separator waits for the
    // whole screen, whichever groups this test's library produces.
    await waitFor(() => {
      expect(summary()).toContain('·')
    })
  }

  return { ...result, router }
}

/** The mono summary line, `{n} tiles · {mb}`. */
function summary(): string {
  return screen.getByRole('heading', { level: 1, name: 'Library' }).parentElement?.querySelector('p')
    ?.textContent ?? ''
}

/** One group's block, addressed by its visible rule. */
function group(name: RegExp): HTMLElement {
  return screen.getByRole('heading', { level: 2, name }).closest('section') as HTMLElement
}

/** Card titles in a group, in render order. */
function cardsIn(name: RegExp): string[] {
  return within(group(name))
    .queryAllByRole('heading', { level: 3 })
    .map((heading) => heading.textContent ?? '')
}

/** Every card title on the screen, whichever group it is in. */
function allCards(): string[] {
  return screen.queryAllByRole('heading', { level: 3 }).map((heading) => heading.textContent ?? '')
}

beforeEach(() => {
  clearPersistedWorkshopState()
  resetWorkshop()
  resetCatalogSearchIndex()
  resetCatalogIndexCache()
  stubFetch()
})

afterEach(() => {
  vi.unstubAllGlobals()
  clearPersistedWorkshopState()
  resetWorkshop()
  resetCatalogSearchIndex()
  resetCatalogIndexCache()
})

/** Put tiles in the library before the screen mounts. */
function save(...ords: number[]): void {
  act(() => {
    for (const ord of ords) addToLibrary(fixtureId(ord))
  })
}

/* ------------------------------------------------------------------ grouping */

describe('grouping', () => {
  it('groups by kind under mono uppercase rules, in catalog order with the remainder last', async () => {
    save(0, 1, 3, 4, 6)
    await renderLibrary()

    // Order is `engine.vocabulary.kinds` — corpus count descending — and not a
    // list in this screen. That is visible here precisely because the *fixture's*
    // counts are not the live corpus's: nine records make walls first and floors
    // second, where the real index puts bases second. `!other` is forced last
    // whatever the vocabulary says, because it means "none of the above".
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      'Walls 1',
      'Floors 1',
      'Bases 1',
      'Stairs 1',
      'Other 1',
      // The backup block's own heading, which is page furniture rather than a
      // group; asserted here so a new group heading cannot slip in unnoticed.
      'Backup',
    ])
  })

  it('puts a two-kind tile in exactly one group', async () => {
    // Ord 2 is `floor`+`wall` and ord 3 is `base`+`wall`.
    save(0, 2, 3)
    await renderLibrary()

    expect(cardsIn(/^walls/i)).toEqual(['Cave Wall On Tile 1x1'])
    expect(cardsIn(/^bases/i)).toEqual(['Cave Wall Base 1x3'])
    expect(cardsIn(/^floors/i)).toEqual(['Cave Floor 2x2'])
    // Three saved tiles, three cards — not five.
    expect(allCards()).toHaveLength(3)
  })

  it('gives the tiles with no kind at all a visible bucket', async () => {
    save(4)
    await renderLibrary({ wait: false })

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'Other 1' })).toBeInTheDocument()
    })
    expect(cardsIn(/^other/i)).toEqual(['Cave Rectangular Door'])
    // No sheet for this one: the fallback plate, not a broken image.
    expect(within(group(/^other/i)).getByText('no render')).toBeInTheDocument()
  })

  it('group counts sum to the summary', async () => {
    save(0, 1, 2, 3, 4, 6, 7)
    await renderLibrary()

    const counts = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => Number(/\d+/.exec(heading.textContent ?? '')?.[0] ?? 0))
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(7)
    expect(summary()).toContain('7 tiles')
  })
})

/* ---------------------------------------------------------------------- size */

describe('the size summary', () => {
  it('counts a shared md5 once', async () => {
    // Ord 1 and ord 5 are the same 15.85 MB mesh under two catalog paths.
    save(1, 5)
    await renderLibrary()

    // 15.85 MB, not 31.7 MB. Two designs, so two items and no file clause.
    expect(summary()).toBe('2 tiles · 15.9 MB')
    // Both cards still render — deduping bytes must not dedupe cards, and these
    // are two separate designs however many meshes they share.
    expect(allCards()).toHaveLength(2)
    expect(screen.getByText(/filed under a second catalog path/i)).toBeInTheDocument()
    expect(screen.getByText(/counts 1 file rather than 2/i)).toBeInTheDocument()
  })

  it('adds the bytes of two different tiles', async () => {
    save(0, 6)
    await renderLibrary()

    // 8,925,384 + 22,110,002 = 31,035,386.
    expect(summary()).toBe('2 tiles · 31.0 MB')
    expect(screen.queryByText(/same model filed under/i)).not.toBeInTheDocument()
  })

  it('warns at the same threshold the builder bill warns at', async () => {
    save(8)
    await renderLibrary()

    expect(summary()).toBe('1 tile · 540.0 MB')
    expect(screen.getByText(/Over 512 MB to download/i)).toBeInTheDocument()
    expect(screen.getByText(/median model in this archive is 10.4 MB/i)).toBeInTheDocument()
  })

  it('says nothing about size when there is nothing to say', async () => {
    save(0)
    await renderLibrary({ wait: false })

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'Floors 1' })).toBeInTheDocument()
    })
    expect(summary()).toBe('1 tile · 8.9 MB')
    expect(screen.queryByText(/to download/i)).not.toBeInTheDocument()
  })
})

/* --------------------------------------------------------------- aggregation */

describe('the library lists items and holds files', () => {
  it('collapses two saved variants of one design into one card', async () => {
    save(7, 9)
    await renderLibrary()

    // One card, and the group count is an item count so it agrees with it.
    expect(allCards()).toEqual(['Cave Arrow Slit 2x'])
    expect(screen.getByRole('heading', { level: 2, name: 'Walls 1' })).toBeInTheDocument()
  })

  it('says how many files are behind the items, and totals all of them', async () => {
    save(7, 9)
    await renderLibrary()

    // 6,004,100 + 3,002,050 = 9,006,150. One card, two files, and both numbers
    // on the line: the item count alone would under-report a 9 MB download.
    expect(summary()).toBe('1 tile · 2 files · 9.0 MB')
  })

  it('drops the file clause when every item is one file', async () => {
    save(0, 1)
    await renderLibrary()

    expect(summary()).toBe('2 tiles · 24.8 MB')
    expect(summary()).not.toContain('files')
  })

  it('names each saved file on the card, with its own size', async () => {
    save(7, 9)
    await renderLibrary()

    // This is where the per-file rows went. Named by the filename's variant
    // token, which is what tells two files of one design apart.
    expect(screen.getByText('2 files saved')).toBeInTheDocument()
    const rows = [...document.querySelectorAll('.of-lib-variant')]
    expect(rows.map((row) => row.querySelector('.of-lib-variant-token')?.textContent)).toEqual([
      '2x.openlock',
      '2x.openforge',
    ])
    expect(rows.map((row) => row.querySelector('.of-lib-variant-bytes')?.textContent)).toEqual([
      '6.0 MB',
      '3.0 MB',
    ])
  })

  it('offers no file list for a card holding one file', async () => {
    save(0)
    await renderLibrary()

    expect(screen.queryByText(/files saved/i)).not.toBeInTheDocument()
    expect(document.querySelectorAll('.of-lib-variant')).toHaveLength(0)
  })

  it('removes one file without taking the item with it', async () => {
    save(7, 9)
    await renderLibrary()

    const one = screen.getByRole('button', { name: /remove 2x\.openforge of cave arrow slit 2x/i })
    act(() => {
      one.click()
    })

    // The other file survives, so the card does — and with one file left it
    // stops offering a file list.
    expect(Object.keys(useWorkshopStore.getState().library)).toEqual([fixtureId(7)])
    await waitFor(() => {
      expect(summary()).toBe('1 tile · 6.0 MB')
    })
    expect(allCards()).toEqual(['Cave Arrow Slit 2x'])
    expect(screen.queryByText(/files saved/i)).not.toBeInTheDocument()
  })

  it('says "Remove all" and clears every saved file when there is more than one', async () => {
    save(7, 9)
    await renderLibrary()

    // A button that removed two files while saying "Remove" beside a "2 files"
    // count would be lying about its own blast radius.
    expect(screen.queryByRole('button', { name: /^remove cave arrow slit 2x$/i })).not.toBeInTheDocument()
    const all = screen.getByRole('button', { name: /remove all cave arrow slit 2x/i })
    act(() => {
      all.click()
    })

    expect(Object.keys(useWorkshopStore.getState().library)).toEqual([])
  })

  it('keeps "Remove" for a card holding one file', async () => {
    save(0)
    await renderLibrary()

    expect(screen.getByRole('button', { name: /^remove cave floor 2x2$/i })).toBeInTheDocument()
  })

  it('counts one file when two saved variants share a mesh — 66 live items allow it', async () => {
    save(7, 10)
    await renderLibrary()

    // Both files are saved and both rows render, but the mesh is one download.
    expect(summary()).toBe('1 tile · 2 files · 6.0 MB')
    expect(document.querySelectorAll('.of-lib-variant')).toHaveLength(2)
    expect(screen.getByText(/filed under a second catalog path/i)).toBeInTheDocument()
  })

  it('shows the availability chips the catalog card shows', async () => {
    save(7, 9)
    await renderLibrary()

    // The library is where a user decides what to print, so "does this need a
    // base" belongs here too — and derived once, so the two screens cannot
    // disagree. Ord 7 is integral and ord 9 a topper, so the item offers both.
    const strip = screen.getByRole('list', { name: 'Availability' })
    expect(strip).toHaveTextContent('Base optional')
    expect(strip).toHaveTextContent('OpenLOCK')
  })

  it('releases the catalog’s fixed strip height, having no virtualiser to keep honest', async () => {
    save(7, 9)
    await renderLibrary()

    // A style assertion, because the constraint is a `VirtuosoGrid` requirement
    // of the *catalog grid* and not a property of the strip. jsdom does not
    // apply the stylesheet, so what is checked is that the strip is inside a
    // library card — which `library.css` targets.
    expect(document.querySelector('.of-lib-card .of-avail-strip')).not.toBeNull()
  })
})

/* -------------------------------------------------------------------- remove */

describe('remove', () => {
  it('writes through to the store and updates the summary', async () => {
    save(0, 1)
    await renderLibrary()

    expect(summary()).toBe('2 tiles · 24.8 MB')

    const remove = within(group(/^walls/i)).getByRole('button', { name: /remove cave wall 4x$/i })
    act(() => {
      remove.click()
    })

    // The store, not just the DOM.
    expect(Object.keys(useWorkshopStore.getState().library)).toEqual([fixtureId(0)])
    await waitFor(() => {
      expect(summary()).toBe('1 tile · 8.9 MB')
    })
    // The emptied group's rule goes with it.
    expect(screen.queryByRole('heading', { level: 2, name: /^walls/i })).not.toBeInTheDocument()
  })

  it('leaves the empty state behind when the last tile goes', async () => {
    save(0)
    await renderLibrary({ wait: false })

    const remove = await screen.findByRole('button', { name: /remove cave floor 2x2$/i })
    act(() => {
      remove.click()
    })

    expect(await screen.findByText('Your library is empty.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Browse the catalog' })).toHaveAttribute('href', '/catalog')
  })
})

/* --------------------------------------------------------------- empty state */

describe('the empty state', () => {
  it('renders with its call to action, without waiting for the index', async () => {
    const router = createWorkshopRouter({ history: createMemoryHistory({ initialEntries: ['/library'] }) })
    render(
      <CatalogStatsProvider value={null}>
        <RouterProvider router={router} />
      </CatalogStatsProvider>,
    )
    await act(async () => {
      await router.load()
    })

    // Synchronously present: nothing about "you have saved nothing" depends on a
    // 5.6 MB fetch.
    expect(screen.getByText('Your library is empty.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Browse the catalog' })).toBeInTheDocument()
    expect(summary()).toBe('0 tiles')
    // No "open in builder" with nothing to open.
    expect(screen.queryByRole('link', { name: /open in builder/i })).not.toBeInTheDocument()
  })
})

/* ------------------------------------------------------------ open in builder */

describe('the primary action', () => {
  it('links to the builder once something is saved', async () => {
    save(1)
    await renderLibrary()

    expect(screen.getByRole('link', { name: /open in builder/i })).toHaveAttribute('href', '/builder')
  })

  it('links a card into the catalog drawer', async () => {
    save(1)
    await renderLibrary()

    expect(within(group(/^walls/i)).getByRole('link')).toHaveAttribute('href', '/catalog?tile=1')
  })
})

/* ------------------------------------------------------------ export / import */

describe('export and import', () => {
  /**
   * The backup block's own outcome message.
   *
   * Scoped, because the screen has other live regions — the size and stale-id
   * notes are `status` too — and an unscoped `getByRole('status')` would be
   * ambiguous exactly when a test set both up.
   */
  function report(): HTMLElement {
    return within(screen.getByRole('region', { name: 'Backup' })).getByRole('status')
  }

  function failure(): HTMLElement {
    return within(screen.getByRole('region', { name: 'Backup' })).getByRole('alert')
  }

  /** Fire a file at the import control and let its async handler settle. */
  async function importFile(contents: string, name = 'workshop.json'): Promise<void> {
    const input = screen.getByLabelText('Import JSON', { selector: 'input' })
    const file = new File([contents], name, { type: 'application/json' })
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } })
      await Promise.resolve()
    })
  }

  it('round-trips a library and a scene through a file', async () => {
    const urls = stubObjectUrls()
    save(0, 1, 6)
    act(() => {
      placeTile({ tileId: fixtureId(1), x: 1.5, z: -2, rotation: 90 })
    })
    await renderLibrary()

    act(() => {
      screen.getByRole('button', { name: 'Export JSON' }).click()
    })
    expect(urls.blobs).toHaveLength(1)
    const exported = await (urls.blobs[0] as Blob).text()

    // Everything gone, as an eviction would leave it.
    act(() => {
      resetWorkshop()
    })
    await waitFor(() => {
      expect(screen.getByText('Your library is empty.')).toBeInTheDocument()
    })

    await importFile(exported)

    await waitFor(() => {
      expect(summary()).toContain('3 tiles')
    })
    const state = useWorkshopStore.getState()
    expect(Object.keys(state.library).sort()).toEqual([fixtureId(0), fixtureId(1), fixtureId(6)].sort())
    expect(Object.values(state.placements)).toEqual([
      { tileId: fixtureId(1), x: 1.5, z: -2, rotation: 90 },
    ])
    expect(report()).toHaveTextContent('Imported 3 tiles and 1 placement.')
  })

  it('reports a file that is not ours, and changes nothing', async () => {
    save(0)
    await renderLibrary({ wait: false })
    await screen.findByRole('heading', { level: 2, name: 'Floors 1' })

    await importFile(JSON.stringify({ kind: 'some-other-app/scene', state: {} }))

    expect(failure()).toHaveTextContent(
      'That file is not an OpenForge Workshop export. Nothing was changed.',
    )
    expect(Object.keys(useWorkshopStore.getState().library)).toEqual([fixtureId(0)])
  })

  it('reports a file that is not JSON at all, rather than throwing', async () => {
    save(0)
    await renderLibrary({ wait: false })
    await screen.findByRole('heading', { level: 2, name: 'Floors 1' })

    await importFile('<html>this is not a workshop</html>')

    expect(failure()).toHaveTextContent('That file is not valid JSON.')
    expect(Object.keys(useWorkshopStore.getState().library)).toEqual([fixtureId(0)])
  })

  it('names what it discarded from a partly damaged file', async () => {
    await renderLibrary({ wait: false })

    await importFile(
      JSON.stringify({
        kind: 'openforge-workshop/scene',
        version: 1,
        state: {
          // A `TileId` is any non-empty string, so the realistic corruption in a
          // hand-edited file is a bad *value*, not a bad key.
          library: { [fixtureId(0)]: true, 'tiles/cave/fixture/half-typed.stl': 5 },
          placements: {},
          lock: 'openlock',
        },
      }),
    )

    expect(report()).toHaveTextContent('Imported 1 tile and 0 placements.')
    expect(report()).toHaveTextContent('1 entry could not be read')
    expect(report()).toHaveTextContent('library.tiles/cave/fixture/half-typed.stl: expected true, found 5')
    // The readable half survived.
    expect(Object.keys(useWorkshopStore.getState().library)).toEqual([fixtureId(0)])
  })

  it('offers import on an empty library, which is when it matters most', async () => {
    await renderLibrary({ wait: false })

    expect(screen.getByText('Your library is empty.')).toBeInTheDocument()
    expect(screen.getByLabelText('Import JSON', { selector: 'input' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export JSON' })).toBeInTheDocument()
  })
})

/* ------------------------------------------------------------- stale saved ids */

describe('a saved id the catalog no longer has', () => {
  it('is reported with a way to clear it', async () => {
    save(0)
    act(() => {
      addToLibrary(TileId.parse('tiles/cave/fixture/renamed-away.stl'))
    })
    await renderLibrary({ wait: false })

    const note = await screen.findByText(/not in this build of the catalog/i)
    expect(note).toHaveTextContent('1 saved tile is not in this build of the catalog')
    // The headline counts the one item that resolved, not the two ids in the
    // store: a summary that counted a tile it cannot describe would put a byte
    // total beside a count the total does not cover. The unresolved id is
    // reported in its own note instead, with a way to clear it.
    expect(summary()).toBe('1 tile · 8.9 MB')

    act(() => {
      screen.getByRole('button', { name: /remove it/i }).click()
    })

    await waitFor(() => {
      expect(screen.queryByText(/not in this build of the catalog/i)).not.toBeInTheDocument()
    })
    expect(Object.keys(useWorkshopStore.getState().library)).toEqual([fixtureId(0)])
  })
})
