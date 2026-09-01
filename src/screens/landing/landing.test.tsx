// @vitest-environment jsdom
/**
 * Landing screen tests.
 *
 * Rendered through the real router over `createMemoryHistory()`, and fed a real
 * index through a stubbed `fetch`. Both choices are the same choice: the thing
 * worth testing on this screen is that the four figures come out of the document
 * the app actually loads, and a test that handed the component a props object
 * would only prove that this file and that props object agree.
 *
 * So the fixture below is a complete, schema-valid `catalog.json` with figures
 * that could not be mistaken for the real archive's — 3 tiles, 2 texture sets, 2
 * build systems, 2.5 GB. If any of `8,702`, `38`, `5` or `108.0` ever appears on
 * screen during these tests, something is reading a constant.
 *
 * The shared fetch is memoised at module scope in `src/ui/shell/catalogStats.tsx`,
 * so every case clears it first; that is what `resetCatalogIndexCache` is for.
 */
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CatalogFile } from '@/catalog'
import { createWorkshopRouter } from '@/routes'
import { clearPersistedWorkshopState, resetWorkshop } from '@/store'
import { resetCatalogIndexCache } from '@/ui/shell'

import { deriveLandingStats, formatBytes, formatCount } from './stats'

/* ----------------------------------------------------------------- fixtures */

/**
 * A three-record index. Deliberately nothing like the real one:
 *
 *   - 3 records                                        → "3" catalogued tiles
 *   - `texture|` roots {cave, towne} in the tag table   → "2" texture sets
 *   - `build` values {s2w, thick wall}                  → "2" build systems
 *   - 1.0 + 1.2 + 0.3 GB                               → "2.5 GB"
 *
 * `texture|cave|wet` is in the tag table on purpose: the texture stat counts
 * *roots*, so a sub-tag under a root already counted must not count again.
 * `texture|towne|stucco` is there for the opposite reason — a root that appears
 * only as a sub-tag's parent still counts, which is the case
 * `src/materials/mapping.ts` documents as unreachable through `record.texture`.
 */
const RAW_INDEX = {
  version: {
    schema: 1,
    pipeline: 1,
    fixtures: '0000000000000000000000000000000000000000',
    manifest: 1,
    built: '2026-01-01T00:00:00Z',
  },
  assets: {
    models: 'https://objects.example.test/models',
    sprites: 'https://objects.example.test/sprites',
    thumbs: 'https://objects.example.test/thumbs',
  },
  sprite: { rows: 2, cols: 5, tile: 512, frames: 10, defaultFrame: 0 },
  tags: ['texture|cave', 'texture|cave|wet', 'texture|towne|stucco', 'build|s2w', 'shape|floor'],
  records: [
    {
      id: 'tiles/cave/floors/floor/openlock/cave#floor.2x2.openlock.stl',
      ord: 0,
      blob: 'a'.repeat(32),
      file: 'cave#floor.2x2.openlock.stl',
      bytes: 1_000_000_000,
      sprite: true,
      family: 'tiles/cave/floors/floor/openlock',
      design: 'design-a',
      name: 'Cave Floor 2x2',
      kinds: ['floor'],
      conn: ['openlock'],
      build: 's2w',
      layer: 'integral',
      texture: 'cave',
      tags: [0, 4],
      foot: { shape: 'rect', w: 2, d: 2 },
    },
    {
      id: 'tiles/towne/walls/wall/openlock/towne#wall.2.openlock.stl',
      ord: 1,
      blob: 'b'.repeat(32),
      file: 'towne#wall.2.openlock.stl',
      bytes: 1_200_000_000,
      sprite: true,
      family: 'tiles/towne/walls/wall/openlock',
      design: 'design-b',
      name: 'Towne Wall 2',
      kinds: ['wall'],
      conn: ['openlock'],
      build: 'thick wall',
      layer: 'integral',
      texture: 'towne',
      tags: [2],
      foot: { shape: 'wall', length: 2 },
    },
    {
      id: 'tiles/cave/floors/floor/openlock/cave#floor.1x1.openlock.stl',
      ord: 2,
      blob: 'c'.repeat(32),
      file: 'cave#floor.1x1.openlock.stl',
      bytes: 300_000_000,
      sprite: false,
      family: 'tiles/cave/floors/floor/openlock',
      design: 'design-a',
      name: 'Cave Floor 1x1',
      kinds: ['floor'],
      conn: ['openlock'],
      build: 's2w',
      layer: 'integral',
      texture: 'cave',
      tags: [0, 1, 4],
      foot: { shape: 'rect', w: 1, d: 1 },
    },
  ],
}

/* -------------------------------------------------------------- test harness */

/** How `fetch` should answer for `catalog.json` in a given case. */
type IndexResponse = 'ok' | 'http-error' | 'network-error' | 'pending'

function stubFetch(mode: IndexResponse) {
  vi.stubGlobal(
    'fetch',
    vi.fn((): Promise<Response> => {
      // Never settles, so the loading state can be asserted without racing it.
      if (mode === 'pending') return new Promise<Response>(() => {})
      if (mode === 'network-error') return Promise.reject(new Error('offline'))
      if (mode === 'http-error') {
        return Promise.resolve(new Response('nope', { status: 503, statusText: 'unavailable' }))
      }
      return Promise.resolve(
        new Response(JSON.stringify(RAW_INDEX), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    }),
  )
}

/**
 * Set `prefers-reduced-motion`.
 *
 * jsdom implements `matchMedia` but always reports `matches: false`, so the
 * reduced-motion case has to be supplied. Both branches are stubbed rather than
 * only the interesting one, so neither test depends on a jsdom default.
 */
function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(
      (query: string): MediaQueryList => ({
        matches: reduce && query.includes('prefers-reduced-motion: reduce'),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    ),
  )
}

async function renderLanding() {
  const router = createWorkshopRouter({ history: createMemoryHistory({ initialEntries: ['/'] }) })
  const result = render(<RouterProvider router={router} />)
  // The router resolves its first match in a microtask; the heading is the
  // cheapest proof the screen is mounted and not still the router's pending
  // state.
  await screen.findByRole('heading', { level: 1 })
  return result
}

/** The four figures, as `{ label: value }`, read off the rendered definition list. */
function readFigures(): Record<string, string> {
  const entries: Record<string, string> = {}
  document.querySelectorAll('.of-hero-figures .of-figure').forEach((cell) => {
    const label = cell.querySelector('dt')?.textContent?.trim()
    const value = cell.querySelector('dd')?.textContent?.trim()
    if (label !== undefined && value !== undefined) entries[label] = value
  })
  return entries
}

beforeEach(() => {
  resetWorkshop()
  clearPersistedWorkshopState()
  resetCatalogIndexCache()
  stubReducedMotion(false)
  stubFetch('ok')
  window.scrollTo = () => undefined
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetWorkshop()
  clearPersistedWorkshopState()
  resetCatalogIndexCache()
})

/* ----------------------------------------------------------------- the stats */

describe('deriveLandingStats', () => {
  it('reads all four figures out of the index it is given', () => {
    const stats = deriveLandingStats(CatalogFile.parse(RAW_INDEX))

    expect(stats).toEqual({
      tiles: 3,
      // cave and towne. `texture|cave|wet` is a sub-tag of a root already seen.
      textureSets: 2,
      buildSystems: 2,
      bytes: 2_500_000_000,
    })
  })

  it('counts texture roots from the tag table, not from `record.texture`', () => {
    // `stucco` is a real root that can never appear in `record.texture` — an
    // earlier tag always wins that position — so counting the record field would
    // undercount the catalog's own texture facet.
    const withUnreachableRoot = CatalogFile.parse({
      ...RAW_INDEX,
      tags: [...RAW_INDEX.tags, 'texture|stucco|smooth'],
    })

    expect(deriveLandingStats(withUnreachableRoot).textureSets).toBe(3)
    expect(new Set(withUnreachableRoot.records.map((record) => record.texture)).size).toBe(2)
  })
})

describe('formatBytes', () => {
  it('names the unit the value deserves rather than the contract label', () => {
    // The contract says "MB of STLs". At 108 GB that label is misleading, and at
    // the mock's 31 tiles it was right — so the unit comes from the value.
    expect(formatBytes(108_002_975_383)).toEqual({ figure: '108.0', unit: 'GB' })
    expect(formatBytes(412_000_000)).toEqual({ figure: '412', unit: 'MB' })
    expect(formatBytes(4_200)).toEqual({ figure: '4', unit: 'kB' })
  })

  it('groups counts for reading', () => {
    expect(formatCount(8702)).toBe('8,702')
  })
})

/* ---------------------------------------------------------------- the screen */

describe('Landing', () => {
  it('renders the hero and the credit line from the markup, before any data', async () => {
    await renderLanding()

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Every tile in the archive, ready for your next dungeon.',
    )
    expect(screen.getByText(/Open-source printable terrain/i)).toBeInTheDocument()
    expect(screen.getByText(/OpenForge tiles by Masterwork Tools/)).toBeInTheDocument()
    expect(screen.getByText(/organised, tagged portion of the archive/)).toBeInTheDocument()
  })

  it('renders the four figures from the supplied index, not from constants', async () => {
    await renderLanding()

    await waitFor(() => {
      expect(readFigures()).toEqual({
        'Catalogued tiles': '3',
        'Texture sets': '2',
        'Build systems': '2',
        'STL geometry': '2.5GB',
      })
    })

    // The real archive's figures must not be able to leak in from a literal.
    expect(screen.queryByText('8,702')).toBeNull()
    expect(screen.queryByText('108.0')).toBeNull()
  })

  it('names the archive host the index points at', async () => {
    const { container } = await renderLanding()

    // Scoped to the footer: the header shows the same host, from the same
    // document, and asserting on the page as a whole would pass on either.
    await waitFor(() => {
      expect(container.querySelector('.of-landing-host')).toHaveTextContent(
        'objects.example.test',
      )
    })
  })

  it('shows the mock placeholder while the figures are unknown', async () => {
    stubFetch('pending')
    await renderLanding()

    // `…` is the mock's own placeholder (`statTiles: tiles.length || '…'`), and
    // all four carry it, so the block holds its shape while it waits.
    const figures = Object.values(readFigures())
    expect(figures).toHaveLength(4)
    expect(figures.every((value) => value.includes('…'))).toBe(true)
  })

  it('links both hero actions at the routes they name', async () => {
    await renderLanding()

    expect(screen.getByRole('link', { name: 'Browse the catalog' })).toHaveAttribute(
      'href',
      '/catalog',
    )
    expect(screen.getByRole('link', { name: 'Open the builder' })).toHaveAttribute(
      'href',
      '/builder',
    )
  })

  it('renders the three steps as an ordered list, with their numerals in sequence', async () => {
    const { container } = await renderLanding()

    const steps = container.querySelector('ol.of-steps')
    expect(steps?.tagName).toBe('OL')

    const items = within(steps as HTMLElement).getAllByRole('listitem')
    expect(items.map((item) => item.querySelector('.of-step-numeral')?.textContent)).toEqual([
      'I · Search',
      'II · Curate',
      'III · Construct',
    ])
    expect(items.map((item) => item.querySelector('h2')?.textContent)).toEqual([
      'Find the right tile',
      'Build your library',
      'Lay out the room',
    ])
  })

  it('keeps heading order: one h1, then the three card titles', async () => {
    await renderLanding()

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(3)
    // Nothing skips a level, and no screen may render a second `<main>`.
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0)
    expect(within(screen.getByRole('main')).queryByRole('main')).toBeNull()
  })

  it('describes the hero drawing rather than leaving it as an unlabelled graphic', async () => {
    await renderLanding()

    expect(screen.getByRole('img', { name: /plan view of a chamber/i })).toBeInTheDocument()
  })
})

/* --------------------------------------------------------------- degradation */

describe.each<[string, IndexResponse]>([
  ['the request fails outright', 'network-error'],
  ['the archive answers with an error status', 'http-error'],
])('when %s', (_name, mode) => {
  it('still renders the whole page, with the figures marked unavailable', async () => {
    stubFetch(mode)
    await renderLanding()

    // The screen is complete: headline, both actions, all three steps, footer.
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Browse the catalog' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(3)
    expect(screen.getByText(/OpenForge tiles by Masterwork Tools/)).toBeInTheDocument()

    await waitFor(() => {
      expect(Object.values(readFigures()).every((value) => value.includes('—'))).toBe(true)
    })

    // The footer drops the host from its sentence rather than guessing one.
    expect(document.querySelector('.of-landing-host')).toBeNull()
    expect(screen.getByText(/organised, tagged portion of the archive/)).toBeInTheDocument()
  })
})

/* --------------------------------------------------------------------- motion */

describe('reduced motion', () => {
  it('arms the load sequence when no preference is set', async () => {
    stubReducedMotion(false)
    const { container } = await renderLanding()

    expect(container.querySelector('.of-landing')).toHaveAttribute('data-motion', 'on')
  })

  it('disarms it when the visitor asks for less motion', async () => {
    stubReducedMotion(true)
    const { container } = await renderLanding()

    expect(container.querySelector('.of-landing')).toHaveAttribute('data-motion', 'off')
  })
})
