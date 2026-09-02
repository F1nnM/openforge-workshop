// @vitest-environment jsdom
/**
 * The drawer, through a real router.
 *
 * Two things are worth stating about the harness, because both are deliberate:
 *
 *   1. **A purpose-built route tree, not `createWorkshopRouter()`.** The app's
 *      `/catalog` renders the catalog screen (row 13), which loads and indexes
 *      the whole catalog; mounting it here would make every assertion below
 *      depend on a screen this PR does not own. The tree used instead is the two
 *      routes the drawer actually touches — `/catalog` with the real
 *      `validateCatalogSearch`, and `/builder` — over the real compact search
 *      codec and a memory history. What is being tested is the drawer against
 *      the *URL contract*, and that contract is `src/search/searchSchema.ts`'s,
 *      which is imported rather than restated.
 *   2. **A parsed fixture index.** `CatalogFile.parse` runs over it, so a
 *      fixture that drifts from the schema fails here rather than rendering
 *      something the real index could never produce. Seven records, one per
 *      branch the drawer has to handle.
 *
 * The history assertions are the point of the file. `openTileDrawer` pushes,
 * `showTileInDrawer` replaces and `closeTileDrawer` consumes — so after opening a
 * drawer, browsing two variants and dismissing it, the user must be back where
 * they started with **one** Back press, and there must be nothing left to go back
 * to. That is checked by `canGoBack()`, not by counting `history.length`, which
 * jsdom does not reset between tests.
 */
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { CatalogFile } from '@/catalog'
import { openTileDrawer } from '@/routes'
import { parseCompactSearch, stringifyCompactSearch, validateCatalogSearch, validateFacetSearch } from '@/search'
import { clearPersistedWorkshopState, resetWorkshop, useLibraryCount } from '@/store'

import { TileDrawer } from './TileDrawer'

/* ------------------------------------------------------------------ fixture */

/** Ordinals used by the tests, named so an assertion reads as a case. */
const ORD = {
  floor1x1: 10,
  floor2x2: 11,
  floor1x2: 12,
  wall: 20,
  arc: 21,
  coded: 22,
  shapeless: 23,
  noSprite: 24,
} as const

const TAGS = [
  'shape|floor',
  'shape|wall|low',
  'shape|floor|curved',
  'texture|cave',
  'size|width|1',
  'component|door',
  'connection|openlock',
]

function tile(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    blob: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    bytes: 1_335_084,
    sprite: true,
    design: 'd51024cbbcd6f',
    kinds: ['floor'],
    conn: ['openlock'],
    layer: 'topper',
    texture: 'cave',
    tags: [0, 3],
    foot: { shape: 'rect', w: 1, d: 1 },
    ...overrides,
  }
}

const CATALOG = CatalogFile.parse({
  version: {
    schema: 1,
    pipeline: 1,
    fixtures: 'deadbeef',
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
  tags: TAGS,
  records: [
    tile({
      id: 'tiles/cave/floors/floor/cave%floor.1x1.stl',
      ord: ORD.floor1x1,
      file: 'cave%floor.1x1.stl',
      family: 'tiles/cave/floors/floor',
      name: 'Cave Floor 1x1',
      build: 'separate wall',
      tags: [0, 3, 4],
    }),
    tile({
      id: 'tiles/cave/floors/floor/cave%floor.2x2.stl',
      ord: ORD.floor2x2,
      file: 'cave%floor.2x2.stl',
      family: 'tiles/cave/floors/floor',
      name: 'Cave Floor 2x2',
      foot: { shape: 'rect', w: 2, d: 2 },
    }),
    tile({
      id: 'tiles/cave/floors/floor/cave%floor.1x2.stl',
      ord: ORD.floor1x2,
      file: 'cave%floor.1x2.stl',
      family: 'tiles/cave/floors/floor',
      name: 'Cave Floor 1x2',
      foot: { shape: 'rect', w: 1, d: 2 },
    }),
    tile({
      id: 'tiles/cave/walls/wall/cave%wall.2x.stl',
      ord: ORD.wall,
      file: 'cave%wall.2x.stl',
      family: 'tiles/cave/walls/wall',
      name: 'Cave Wall 2x Low',
      kinds: ['wall'],
      // `shape|wall|low` — the height lookup's single-qualifier branch.
      tags: [1, 3],
      foot: { shape: 'wall', length: 2 },
    }),
    tile({
      id: 'tiles/cave/walls/curve/cave%curve.2r90.stl',
      ord: ORD.arc,
      file: 'cave%curve.2r90.stl',
      family: 'tiles/cave/walls/curve',
      name: 'Cave Curve 2r90',
      foot: { shape: 'arc', radius: 2, angle: 90 },
    }),
    tile({
      id: 'tiles/cave/misc/coded/cave%coded.stl',
      ord: ORD.coded,
      file: 'cave%coded.stl',
      family: 'tiles/cave/misc/coded',
      name: 'Cave Coded Piece',
      foot: { shape: 'none' },
      sizeCode: 'BA',
    }),
    tile({
      id: 'tiles/cave/misc/curved/cave%curved.stl',
      ord: ORD.shapeless,
      file: 'cave%curved.stl',
      family: 'tiles/cave/misc/curved',
      name: 'Cave Curved Insert',
      foot: { shape: 'none' },
      tags: [2, 3],
    }),
    tile({
      id: 'tiles/aztlan/separate_walls/column/aztlan%column.stl',
      ord: ORD.noSprite,
      file: 'aztlan%column.stl',
      family: 'tiles/aztlan/separate_walls/column',
      name: 'Aztlan Column T',
      // The one live tile in the archive with no sprite sheet.
      sprite: false,
      kinds: [],
      texture: undefined,
      foot: { shape: 'none' },
      tags: [5],
    }),
  ],
})

/* ------------------------------------------------------------------ harness */

/**
 * The catalog stand-in: a focusable control to prove focus restoration, plus the
 * drawer under test.
 */
function CatalogStub() {
  const count = useLibraryCount()
  return (
    <div>
      <button type="button">a card</button>
      <output>library {count}</output>
      <TileDrawer catalog={CATALOG} />
    </div>
  )
}

function buildRouter(path: string) {
  const root = createRootRoute({})
  const catalog = createRoute({
    getParentRoute: () => root,
    path: '/catalog',
    validateSearch: validateCatalogSearch,
    component: CatalogStub,
  })
  const builder = createRoute({
    getParentRoute: () => root,
    path: '/builder',
    validateSearch: validateFacetSearch,
    component: () => <div>Builder screen</div>,
  })

  return createRouter({
    routeTree: root.addChildren([catalog, builder]),
    history: createMemoryHistory({ initialEntries: [path] }),
    parseSearch: parseCompactSearch,
    stringifySearch: stringifyCompactSearch,
  })
}

type TestRouter = ReturnType<typeof buildRouter>

async function renderAt(path: string) {
  const router = buildRouter(path)
  render(<RouterProvider router={router as unknown as never} />)
  await act(async () => {
    await router.load()
  })
  return router
}

/** `openTileDrawer`'s push, driven through the module that owns the semantics. */
async function open(router: TestRouter, ord: number) {
  await act(async () => {
    await openTileDrawer(router as never, ord as never)
  })
}

const drawer = () => screen.getByRole('dialog')

/**
 * The open tile, from the URL.
 *
 * `location.search` is the *raw* parsed object — the compact codec's output
 * before `validateSearch` coerces it — so `tile` arrives as a string when it is
 * present and is absent rather than `null` when it is not. Reading it raw is the
 * point: this is what a shared link actually says.
 */
function openTile(router: TestRouter): number | null {
  const raw = (router.state.location.search as { tile?: unknown }).tile
  return raw === undefined || raw === null ? null : Number(raw)
}

/** The visible serif title, which is a `<p>` — see `TileDrawer.tsx`. */
const titleOf = (name: string) => within(drawer()).getByText(name, { selector: 'p' })

beforeEach(() => {
  resetWorkshop()
  clearPersistedWorkshopState()
})

afterEach(() => {
  resetWorkshop()
  clearPersistedWorkshopState()
})

/* ----------------------------------------------------------------- the URL */

describe('opening and closing', () => {
  it('opens on the URL param, cold, with no interaction', async () => {
    await renderAt(`/catalog?tile=${String(ORD.floor1x1)}`)

    expect(drawer()).toBeInTheDocument()
    expect(titleOf('Cave Floor 1x1')).toBeInTheDocument()
    expect(screen.getByText('Cave · Floor')).toBeInTheDocument()
  })

  it('stays closed when the param is absent', async () => {
    await renderAt('/catalog')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes with Back — one press, and nothing left to go back to', async () => {
    const router = await renderAt('/catalog')
    await open(router, ORD.floor1x1)
    expect(drawer()).toBeInTheDocument()

    // Escape is a close path, and `closeTileDrawer` consumes the pushed entry.
    await act(async () => {
      fireEvent.keyDown(drawer(), { key: 'Escape' })
      await Promise.resolve()
    })

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(openTile(router)).toBeNull()
    expect(router.history.canGoBack()).toBe(false)
  })

  it('closes on a backdrop press, through the same path Escape takes', async () => {
    const router = await renderAt('/catalog')
    await open(router, ORD.floor1x1)

    const backdrop = document.querySelector('.of-backdrop')
    if (backdrop === null) throw new Error('the drawer rendered no backdrop')
    await act(async () => {
      fireEvent.pointerDown(backdrop, { button: 0, isPrimary: true })
      fireEvent.mouseDown(backdrop, { button: 0 })
      fireEvent.pointerUp(backdrop, { button: 0, isPrimary: true })
      fireEvent.click(backdrop, { button: 0 })
      await Promise.resolve()
    })

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(openTile(router)).toBeNull()
    expect(router.history.canGoBack()).toBe(false)
  })

  it('closes a cold-loaded shared link without trapping the user in the app', async () => {
    const router = await renderAt(`/catalog?tile=${String(ORD.floor1x1)}`)

    await act(async () => {
      fireEvent.keyDown(drawer(), { key: 'Escape' })
      await Promise.resolve()
    })

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(openTile(router)).toBeNull()
  })

  it('renders an honest panel for a tile the index does not hold', async () => {
    await renderAt('/catalog?tile=999999')

    expect(drawer()).toBeInTheDocument()
    expect(within(drawer()).getByText(/Ordinals are never reissued/)).toBeInTheDocument()
  })
})

/* -------------------------------------------------------------- the variants */

describe('family variants', () => {
  it('lists the other distinct sizes in the family, and not the tile itself', async () => {
    await renderAt(`/catalog?tile=${String(ORD.floor1x1)}`)

    const variants = within(drawer()).getByRole('button', { name: '2 × 2' })
    expect(variants).toBeInTheDocument()
    expect(within(drawer()).getByRole('button', { name: '1 × 2' })).toBeInTheDocument()
    expect(within(drawer()).queryByRole('button', { name: '1 × 1' })).toBeNull()
  })

  it('swapping the subject replaces, so Back still closes the drawer', async () => {
    const router = await renderAt('/catalog')
    await open(router, ORD.floor1x1)

    for (const label of ['2 × 2', '1 × 2']) {
      await act(async () => {
        fireEvent.click(within(drawer()).getByRole('button', { name: label }))
        await Promise.resolve()
      })
    }
    expect(openTile(router)).toBe(ORD.floor1x2)
    expect(titleOf('Cave Floor 1x2')).toBeInTheDocument()

    // Two variants browsed, and still exactly one entry to consume.
    await act(async () => {
      fireEvent.keyDown(drawer(), { key: 'Escape' })
      await Promise.resolve()
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(router.history.canGoBack()).toBe(false)
  })

  it('shows no variant section for a family with one size', async () => {
    await renderAt(`/catalog?tile=${String(ORD.coded)}`)
    expect(within(drawer()).queryByText('Other sizes in this family')).toBeNull()
  })
})

/* ----------------------------------------------------------------- focus */

describe('focus', () => {
  it('traps focus inside the drawer and restores it on close', async () => {
    const router = await renderAt('/catalog')
    const card = screen.getByRole('button', { name: 'a card' })
    act(() => {
      card.focus()
    })
    expect(card).toHaveFocus()

    await open(router, ORD.floor1x1)
    expect(drawer().contains(document.activeElement)).toBe(true)

    await act(async () => {
      fireEvent.keyDown(drawer(), { key: 'Escape' })
      await Promise.resolve()
    })

    expect(card).toHaveFocus()
  })
})

/* ------------------------------------------------------------- the spec grid */

describe('the spec grid', () => {
  const cell = (label: string) => {
    const term = within(drawer()).getByText(label)
    const value = term.parentElement?.querySelector('dd')
    if (value === null || value === undefined) throw new Error(`no value cell for ${label}`)
    return value
  }

  it.each([
    [ORD.floor1x1, '1 × 1 in'],
    [ORD.wall, '2 × 0.5 in'],
    [ORD.arc, '2r 90°'],
    [ORD.coded, 'OpenLOCK BA'],
    [ORD.shapeless, 'Curved'],
    [ORD.noSprite, 'Size not specified'],
  ])('renders footprint tier for tile %i as %s', async (ord, expected) => {
    await renderAt(`/catalog?tile=${String(ord)}`)
    expect(cell('Footprint')).toHaveTextContent(expected)
  })

  it('shows a qualitative height where the tags carry one', async () => {
    await renderAt(`/catalog?tile=${String(ORD.wall)}`)
    expect(cell('Height')).toHaveTextContent('Low')
  })

  it('says so where no height basis exists, rather than printing a number', async () => {
    await renderAt(`/catalog?tile=${String(ORD.floor1x1)}`)
    const height = cell('Height')
    expect(height).toHaveTextContent('Not recorded')
    expect(height).toHaveAttribute('data-empty')
    expect(height.getAttribute('title')).toContain('bounding box')
  })

  it('names the build system and its absence', async () => {
    await renderAt(`/catalog?tile=${String(ORD.floor1x1)}`)
    expect(cell('Build system')).toHaveTextContent('Separate wall')

    await renderAt(`/catalog?tile=${String(ORD.wall)}`)
    expect(cell('Build system')).toHaveTextContent('Not specified')
  })

  it('describes the file as an STL and a decimal size', async () => {
    await renderAt(`/catalog?tile=${String(ORD.floor1x1)}`)
    expect(cell('File')).toHaveTextContent('STL · 1.3 MB')
  })
})

/* --------------------------------------------------------- storage address */

describe('the storage address', () => {
  it('is a real HTTPS link to the archive', async () => {
    await renderAt(`/catalog?tile=${String(ORD.floor1x1)}`)

    const link = within(drawer()).getByRole('link', { name: /objects\.openforge\.tools/ })
    const href = link.getAttribute('href') ?? ''
    expect(new URL(href).protocol).toBe('https:')
    expect(href).toBe(
      'https://objects.openforge.tools/models/a1b2c3/a1b2c3d4e5f60718293a4b5c6d7e8f90.stl',
    )
    expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'))
  })
})

/* ------------------------------------------------------------------ actions */

describe('the actions', () => {
  it('toggles the tile in and out of the library', async () => {
    await renderAt(`/catalog?tile=${String(ORD.floor1x1)}`)

    const toggle = within(drawer()).getByRole('button', { name: '+ Add to library' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')

    act(() => {
      fireEvent.click(toggle)
    })
    expect(within(drawer()).getByRole('button', { name: '✓ In library' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByText('library 1')).toBeInTheDocument()
  })

  it('sends the tile to the builder, adding it to the library on the way', async () => {
    const router = await renderAt(`/catalog?tile=${String(ORD.floor1x1)}`)

    await act(async () => {
      fireEvent.click(within(drawer()).getByRole('button', { name: /Use in builder/ }))
      await Promise.resolve()
    })

    expect(router.state.location.pathname).toBe('/builder')
    expect((router.state.location.search as unknown as { q: string }).q).toBe('Cave Floor 1x1')
    expect(screen.getByText('Builder screen')).toBeInTheDocument()
  })
})

/* ------------------------------------------------------------- the preview */

describe('the sprite rotator', () => {
  const frame = () => within(drawer()).getByRole('slider')

  it('shows the default frame of the tile’s sheet', async () => {
    await renderAt(`/catalog?tile=${String(ORD.floor1x1)}`)

    expect(frame()).toHaveAttribute('data-frame', '0')
    expect(frame().style.backgroundImage).toContain(
      'https://objects.openforge.tools/sprites/a1b2c3/a1b2c3d4e5f60718293a4b5c6d7e8f90.png',
    )
    // 5 columns × 2 rows of 288px frames, showing the first.
    expect(frame().style.backgroundSize).toBe('1440px 576px')
    expect(frame().style.backgroundPosition).toBe('0px 0px')
  })

  it('rotates with the arrow keys, around the ring and to the poles', async () => {
    await renderAt(`/catalog?tile=${String(ORD.floor1x1)}`)

    fireEvent.keyDown(frame(), { key: 'ArrowRight' })
    expect(frame()).toHaveAttribute('aria-valuetext', 'front right')
    expect(frame().style.backgroundPosition).toBe('-288px 0px')

    // Backwards past `front` wraps to the far end of the ring rather than
    // stopping — the eight frames are a closed 360° orbit.
    fireEvent.keyDown(frame(), { key: 'ArrowLeft' })
    fireEvent.keyDown(frame(), { key: 'ArrowLeft' })
    expect(frame()).toHaveAttribute('aria-valuetext', 'front left')

    // The poles are off the ring; leaving one returns to the azimuth held.
    fireEvent.keyDown(frame(), { key: 'ArrowUp' })
    expect(frame()).toHaveAttribute('aria-valuetext', 'top')
    expect(frame()).toHaveAttribute('aria-valuenow', '7')
    expect(frame().style.backgroundPosition).toBe('-864px -288px')

    fireEvent.keyDown(frame(), { key: 'ArrowRight' })
    expect(frame()).toHaveAttribute('aria-valuetext', 'front')
  })

  it('rotates by dragging, one step per 30px', async () => {
    await renderAt(`/catalog?tile=${String(ORD.floor1x1)}`)

    fireEvent.pointerDown(frame(), { button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(window, { clientX: 190, clientY: 100 })
    expect(frame()).toHaveAttribute('data-frame', '3')

    // Past the end of the ring and round again.
    fireEvent.pointerMove(window, { clientX: 100 + 30 * 9, clientY: 100 })
    expect(frame()).toHaveAttribute('data-frame', '1')

    // A vertical drag reaches a pole instead.
    fireEvent.pointerMove(window, { clientX: 100, clientY: 40 })
    expect(frame()).toHaveAttribute('aria-valuetext', 'top')

    fireEvent.pointerUp(window)
    // The drag has ended, so a later move must not keep rotating.
    fireEvent.pointerMove(window, { clientX: 400, clientY: 100 })
    expect(frame()).toHaveAttribute('aria-valuetext', 'top')
  })

  it('reaches any frame from the angle pad', async () => {
    await renderAt(`/catalog?tile=${String(ORD.floor1x1)}`)

    fireEvent.click(within(drawer()).getByRole('button', { name: 'bottom' }))
    expect(frame()).toHaveAttribute('aria-valuetext', 'bottom')
    expect(within(drawer()).getByRole('button', { name: 'bottom' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('states the caption as pre-rendered frames, not as a live render', async () => {
    await renderAt(`/catalog?tile=${String(ORD.floor1x1)}`)

    expect(within(drawer()).getByText(/pre-rendered angles/)).toBeInTheDocument()
    expect(within(drawer()).queryByText(/live render/)).toBeNull()
  })

  it('renders the one tile with no sprite sheet, saying which it is', async () => {
    await renderAt(`/catalog?tile=${String(ORD.noSprite)}`)

    expect(within(drawer()).queryByRole('slider')).toBeNull()
    expect(within(drawer()).getByText('No preview rendered')).toBeInTheDocument()
    expect(within(drawer()).getByText(/no sprite sheet/)).toBeInTheDocument()
    // No caption and no angle pad: there are no frames for either to describe.
    expect(within(drawer()).queryByText(/pre-rendered angles/)).toBeNull()
    expect(within(drawer()).queryByRole('group', { name: 'Camera angle' })).toBeNull()
    // The rest of the drawer is unaffected.
    expect(titleOf('Aztlan Column T')).toBeInTheDocument()
    expect(screen.getByText('No texture set · Uncategorised')).toBeInTheDocument()
  })
})

/* --------------------------------------------------------------------- tags */

describe('the tags', () => {
  it('shows every tag the record carries', async () => {
    await renderAt(`/catalog?tile=${String(ORD.wall)}`)

    expect(within(drawer()).getByText('shape|wall|low')).toBeInTheDocument()
    expect(within(drawer()).getByText('texture|cave')).toBeInTheDocument()
  })
})
