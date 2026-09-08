// @vitest-environment jsdom
/**
 * The drawer, through a real router.
 *
 * Two things are worth stating about the harness, because both are deliberate:
 *
 *   1. **A purpose-built route tree, not `createWorkshopRouter()`.** The app's
 *      `/` renders the catalog screen (row 13), which loads and indexes
 *      the whole catalog; mounting it here would make every assertion below
 *      depend on a screen this PR does not own. The tree used instead is the two
 *      routes the drawer actually touches — the catalog at `/` with the real
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
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { CatalogFile } from '@/catalog'
import { openTileDrawer } from '@/routes'
import { TINT_FILTER_SHEET_ID } from '@/ui/thumb'
import { parseCompactSearch, stringifyCompactSearch, validateCatalogSearch, validateFacetSearch } from '@/search'
import {
  claimPendingArm,
  clearPendingArm,
  clearPersistedWorkshopState,
  resetWorkshop,
  setLockSystem,
  useWorkshopStore,
} from '@/store'

import { SpriteRotator } from './SpriteRotator'
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
  /**
   * The three files of one item — row A5's whole subject.
   *
   * `archTopper` is the group's lowest ordinal, so it is the address holder and
   * a `?tile=30` link is `canonical`. The other two are not, so a link to either
   * of them must show that file and apply no preference.
   */
  archTopper: 30,
  archIntegral: 31,
  archTopless: 32,
} as const

const TAGS = [
  'shape|floor',
  'shape|wall|low',
  'shape|floor|curved',
  'texture|cave',
  'size|width|1',
  'component|door',
  'connection|openlock',
  // Row A5's vocabulary. `openforge` underneath is the base declaration and is
  // deliberately not rendered as a join; `side|dragonlock` is neighbour joinery
  // on a file that still needs a base; `openlock|topless` is a print option on a
  // variant that needs none.
  'connection|openforge',
  'connection|side|dragonlock',
  'connection|openlock|topless',
  'shape|arch',
  /* Rows C1 and C3. The drawer's two actions both derive a template family from
     `(role, form, build)` — or from `shape|base` — through
     `familyKey.ts#armForTags`, so a fixture record with neither axis names no
     family at all. That state is real (an unclassified record) and the drawer
     says something different about it than about an insert, so both are
     exercised: the records below carry the axes, the ones that do not are the
     unclassified case, and `shapeless` is the insert. Row C3's *"+ Place on the
     plan"* is gated on the same answer, so these four tags are what let it
     resolve `floor-straight` and place into its one slot. */
  'role|floor',
  'form|straight',
  'role|wall',
  'role|insert',
]

/** Indices into {@link TAGS}, for the four row C1 added. */
const ROLE_FLOOR = 11
const FORM_STRAIGHT = 12
const ROLE_WALL = 13
const ROLE_INSERT = 14

/**
 * One record. `design` is required rather than defaulted, because after A1 the
 * design key **is** the item and a fixture that let eight records share one by
 * accident would collapse to a single eight-variant aggregate whose name,
 * footprint and texture all varied — which A1's own pipeline check forbids.
 */
function tile(overrides: Record<string, unknown> & { design: string }): Record<string, unknown> {
  return {
    blob: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    bytes: 1_335_084,
    sprite: true,
    thumb: false,
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
      design: 'd-floor-1x1',
      file: 'cave%floor.1x1.stl',
      family: 'tiles/cave/floors/floor',
      name: 'Cave Floor 1x1',
      build: 'separate wall',
      tags: [0, 3, 4, ROLE_FLOOR, FORM_STRAIGHT],
    }),
    tile({
      id: 'tiles/cave/floors/floor/cave%floor.2x2.stl',
      ord: ORD.floor2x2,
      design: 'd-floor-2x2',
      file: 'cave%floor.2x2.stl',
      family: 'tiles/cave/floors/floor',
      name: 'Cave Floor 2x2',
      foot: { shape: 'rect', w: 2, d: 2 },
    }),
    tile({
      id: 'tiles/cave/floors/floor/cave%floor.1x2.stl',
      ord: ORD.floor1x2,
      design: 'd-floor-1x2',
      file: 'cave%floor.1x2.stl',
      family: 'tiles/cave/floors/floor',
      name: 'Cave Floor 1x2',
      foot: { shape: 'rect', w: 1, d: 2 },
    }),
    tile({
      id: 'tiles/cave/walls/wall/cave%wall.2x.stl',
      ord: ORD.wall,
      design: 'd-wall',
      file: 'cave%wall.2x.stl',
      family: 'tiles/cave/walls/wall',
      name: 'Cave Wall 2x Low',
      kinds: ['wall'],
      // `shape|wall|low` — the height lookup's single-qualifier branch.
      tags: [1, 3, ROLE_WALL, FORM_STRAIGHT],
      foot: { shape: 'wall', length: 2 },
      // A one-file item that still declares an accessory slot, so the slot
      // section's singular wording is exercised rather than assumed.
      config: { parts: [{ name: 'torch', tags: { require: [{ tag: 'component|torch' }] } }] },
    }),
    tile({
      id: 'tiles/cave/walls/curve/cave%curve.2r90.stl',
      ord: ORD.arc,
      design: 'd-arc',
      file: 'cave%curve.2r90.stl',
      family: 'tiles/cave/walls/curve',
      name: 'Cave Curve 2r90',
      foot: { shape: 'arc', rIn: 2, rOut: 2.5, sweep: 90, band: 'concave', bandBasis: 'measured' },
    }),
    tile({
      id: 'tiles/cave/misc/coded/cave%coded.stl',
      ord: ORD.coded,
      design: 'd-coded',
      file: 'cave%coded.stl',
      family: 'tiles/cave/misc/coded',
      name: 'Cave Coded Piece',
      foot: { shape: 'none' },
      sizeCode: 'BA',
    }),
    tile({
      id: 'tiles/cave/misc/curved/cave%curved.stl',
      ord: ORD.shapeless,
      design: 'd-shapeless',
      file: 'cave%curved.stl',
      family: 'tiles/cave/misc/curved',
      name: 'Cave Curved Insert',
      foot: { shape: 'none' },
      // `role|insert`: one of the 94 designs no family names, on purpose.
      tags: [2, 3, ROLE_INSERT, FORM_STRAIGHT],
    }),
    tile({
      id: 'tiles/aztlan/separate_walls/column/aztlan%column.stl',
      ord: ORD.noSprite,
      design: 'd-column',
      file: 'aztlan%column.stl',
      family: 'tiles/aztlan/separate_walls/column',
      name: 'Aztlan Column T',
      // The one live tile in the archive with no sprite sheet.
      sprite: false,
      thumb: false,
      kinds: [],
      texture: undefined,
      foot: { shape: 'none' },
      tags: [5],
    }),

    /* ------------------------------------------------- one item, three files */

    tile({
      id: 'tiles/cave/arches/arch/openforge/cave%arch.2x.openforge.stl',
      ord: ORD.archTopper,
      design: 'd-arch',
      file: 'cave%arch.2x.openforge.stl',
      family: 'tiles/cave/arches/arch/openforge',
      name: 'Cave Arch 2x',
      kinds: ['wall'],
      layer: 'topper',
      bytes: 2_100_000,
      // `openforge` underneath plus `side|dragonlock`: needs a base, and joins
      // its neighbours in dragonlock.
      tags: [3, 7, 8, 10, ROLE_WALL, FORM_STRAIGHT],
      foot: { shape: 'wall', length: 2 },
      // A `base` slot, which is the base match and must NOT be listed as an
      // accessory, and a `torch` slot, which must be — and which only this file
      // declares, so its provenance is the interesting case.
      config: {
        parts: [
          { name: 'base', tags: { require: [{ tag: 'shape|base' }] } },
          { name: 'torch', optional: true, tags: { require: [{ tag: 'component|torch' }] } },
        ],
      },
    }),
    tile({
      id: 'tiles/cave/arches/arch/openlock/cave%arch.2x.openlock.stl',
      ord: ORD.archIntegral,
      design: 'd-arch',
      file: 'cave%arch.2x.openlock.stl',
      family: 'tiles/cave/arches/arch/openlock',
      name: 'Cave Arch 2x',
      kinds: ['wall'],
      layer: 'integral',
      bytes: 2_400_000,
      tags: [3, 6, 10, ROLE_WALL, FORM_STRAIGHT],
      foot: { shape: 'wall', length: 2 },
    }),
    tile({
      id: 'tiles/cave/arches/arch/openlock/cave%arch.2x.openlock.topless.stl',
      ord: ORD.archTopless,
      design: 'd-arch',
      file: 'cave%arch.2x.openlock.topless.stl',
      family: 'tiles/cave/arches/arch/openlock',
      name: 'Cave Arch 2x',
      kinds: ['wall'],
      layer: 'integral',
      // The smallest of the three, which is exactly why a byte tie-break must
      // not be allowed to read as a recommendation: `topless` has no top surface.
      bytes: 900_000,
      tags: [3, 9, 10, ROLE_WALL, FORM_STRAIGHT],
      foot: { shape: 'wall', length: 2 },
    }),
  ],
})

/* ------------------------------------------------------------------ harness */

/**
 * The catalog stand-in: a focusable control to prove focus restoration, plus the
 * drawer under test.
 *
 * It rendered `useLibraryCount()` beside them until row A0, so a test could see
 * the drawer's toggle write through to the store. The toggle and the library are
 * both gone; the drawer's one remaining action is observed through the router and
 * the selection channel instead.
 */
function CatalogStub() {
  return (
    <div>
      <button type="button">a card</button>
      <TileDrawer catalog={CATALOG} />
    </div>
  )
}

function buildRouter(path: string) {
  const root = createRootRoute({})
  const catalog = createRoute({
    getParentRoute: () => root,
    path: '/',
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
  // Row G5's channel is not part of `WorkshopState`, so `resetWorkshop` does not
  // reach it and a handoff left in the box would leak between tests.
  clearPendingArm()
})

afterEach(() => {
  resetWorkshop()
  clearPersistedWorkshopState()
  clearPendingArm()
})

/* ----------------------------------------------------------------- the URL */

describe('opening and closing', () => {
  it('opens on the URL param, cold, with no interaction', async () => {
    await renderAt(`/?tile=${String(ORD.floor1x1)}`)

    expect(drawer()).toBeInTheDocument()
    expect(titleOf('Cave Floor 1x1')).toBeInTheDocument()
    expect(screen.getByText('Cave · Floor')).toBeInTheDocument()
  })

  it('stays closed when the param is absent', async () => {
    await renderAt('/')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes with Back — one press, and nothing left to go back to', async () => {
    const router = await renderAt('/')
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
    const router = await renderAt('/')
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
    const router = await renderAt(`/?tile=${String(ORD.floor1x1)}`)

    await act(async () => {
      fireEvent.keyDown(drawer(), { key: 'Escape' })
      await Promise.resolve()
    })

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(openTile(router)).toBeNull()
  })

  it('renders an honest panel for a tile the index does not hold', async () => {
    await renderAt('/?tile=999999')

    expect(drawer()).toBeInTheDocument()
    expect(within(drawer()).getByText(/Ordinals are never reissued/)).toBeInTheDocument()
  })
})

/* -------------------------------------------------------------- the variants */

describe('the variants table', () => {
  const table = () => within(drawer()).getByRole('table')
  const bodyRows = () => within(table()).getAllByRole('row').slice(1)

  it('discloses every file of the item, with nothing behind a control', async () => {
    await renderAt(`/?tile=${String(ORD.archTopper)}`)

    expect(within(drawer()).getByText(/How to print this/)).toBeInTheDocument()
    // Three files, three rows. No accordion, no summary, no "show more".
    expect(bodyRows()).toHaveLength(3)
    expect(drawer().querySelector('details')).toBeNull()
    expect(within(drawer()).queryByRole('button', { name: /show (more|all)|expand/i })).toBeNull()

    // Each row names its own file — the identity, since two of the three agree
    // on layer and system.
    for (const file of [
      'cave%arch.2x.openforge.stl',
      'cave%arch.2x.openlock.stl',
      'cave%arch.2x.openlock.topless.stl',
    ]) {
      expect(within(table()).getByText(file)).toBeInTheDocument()
    }
  })

  it('claims a part count and states that size is a download, not filament', async () => {
    await renderAt(`/?tile=${String(ORD.archTopper)}`)

    // The topper is two parts; both integrals are one.
    expect(within(table()).getByText('2 parts')).toBeInTheDocument()
    expect(within(table()).getAllByText('1 part')).toHaveLength(2)

    // The caption says what the bytes are, in as many words.
    const caption = table().querySelector('caption')?.textContent ?? ''
    expect(caption).toMatch(/not filament/i)
    expect(caption).toMatch(/no print time/i)

    // And nowhere does the table compare two sizes or claim a saving — the
    // whole point of the row. The topless file is the smallest of the three.
    const text = table().textContent ?? ''
    expect(text).toContain('2.1 MB')
    expect(text).toContain('900 KB')
    expect(text).not.toMatch(/saves?|smaller|less filament|%\s*(less|smaller)/i)
  })

  it('names the connection systems by face, and never openforge underneath', async () => {
    await renderAt(`/?tile=${String(ORD.archTopper)}`)

    // The topper's real joinery is dragonlock on its sides.
    expect(within(table()).getByText('DragonLock')).toBeInTheDocument()
    expect(within(table()).getAllByText('sides').length).toBeGreaterThan(0)
    // Its underside declares `openforge`, which is the base declaration and is
    // carried by "2 parts" rather than advertised as a connector.
    expect(within(table()).queryByText('OpenForge')).toBeNull()

    // The integrals lock underneath, which is the stronger claim.
    expect(within(table()).getAllByText('OpenLOCK')).toHaveLength(2)
    expect(within(table()).getAllByText('underneath')).toHaveLength(2)
    // `topless` is a print option, shown as itself rather than as a discount.
    expect(within(table()).getByText('topless')).toBeInTheDocument()
  })

  it('lets the user choose a variant, and swapping replaces so Back still closes', async () => {
    const router = await renderAt('/')
    await open(router, ORD.archTopper)

    await act(async () => {
      fireEvent.click(within(drawer()).getByRole('button', { name: /^Show the 2 parts print/ }))
      await Promise.resolve()
    })
    expect(openTile(router)).toBe(ORD.archTopper)

    await act(async () => {
      fireEvent.click(
        within(drawer()).getByRole('button', {
          name: /^Show the 1 part print, cave%arch\.2x\.openlock\.topless\.stl/,
        }),
      )
      await Promise.resolve()
    })
    expect(openTile(router)).toBe(ORD.archTopless)

    // Two variants browsed, and still exactly one entry to consume.
    await act(async () => {
      fireEvent.keyDown(drawer(), { key: 'Escape' })
      await Promise.resolve()
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(router.history.canGoBack()).toBe(false)
  })

  it('marks the row it is showing, and only that one', async () => {
    await renderAt(`/?tile=${String(ORD.archTopless)}`)

    const current = bodyRows().filter((row) => row.getAttribute('aria-current') === 'true')
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveTextContent('cave%arch.2x.openlock.topless.stl')
    expect(
      within(drawer()).getByRole('button', { name: /^Showing the 1 part print/ }),
    ).toBeInTheDocument()
  })

  /* ------------------------------------------------------------- canonical */

  it('applies the build preference for a link to the item, and says it did', async () => {
    // `?tile=30` is `variants[0]`, so A4 reports `canonical: true`: the link
    // named the item and the preference may decide. With no lock chosen the
    // rank still prefers one part over two and a full top over `topless`, so
    // the drawer shows the plain openlock integral — not the address holder.
    await renderAt(`/?tile=${String(ORD.archTopper)}`)

    const current = bodyRows().filter((row) => row.getAttribute('aria-current') === 'true')
    expect(current[0]).toHaveTextContent('cave%arch.2x.openlock.stl')
    // And it does not claim a preference the visitor never expressed: the store
    // defaults to `openlock` and `lockChosen` is false, so the note says why
    // without naming a build.
    expect(within(drawer()).getByText(/best match for the item/)).toBeInTheDocument()
    expect(within(drawer()).queryByText(/Chosen for your/)).toBeNull()
  })

  it('honours a chosen lock, moving the shown row to the only file that can serve it', async () => {
    // No integral offers dragonlock, so A1's rank falls through to tier 2 —
    // topper plus base — and the shown row becomes the topper.
    act(() => {
      setLockSystem('dragonlock')
    })
    await renderAt(`/?tile=${String(ORD.archTopper)}`)

    const current = bodyRows().filter((row) => row.getAttribute('aria-current') === 'true')
    expect(current[0]).toHaveTextContent('cave%arch.2x.openforge.stl')
    // The topper is also `variants[0]`, so the preference did not move the row —
    // it agreed with it, and the note distinguishes the two.
    expect(
      within(drawer()).getByText(/your DragonLock preference agrees with the first file/),
    ).toBeInTheDocument()
  })

  it('never applies a preference to a link that named a file, and says so', async () => {
    // `?tile=32` is not the group minimum, so `canonical` is false. Even with a
    // lock chosen that would rank this file last, the URL wins.
    act(() => {
      setLockSystem('dragonlock')
    })
    await renderAt(`/?tile=${String(ORD.archTopless)}`)

    const current = bodyRows().filter((row) => row.getAttribute('aria-current') === 'true')
    expect(current[0]).toHaveTextContent('cave%arch.2x.openlock.topless.stl')
    expect(within(drawer()).getByText(/Showing the file this link named/)).toBeInTheDocument()
    expect(within(drawer()).queryByText(/Chosen for your/)).toBeNull()
  })

  it('leaves the URL alone when the preference moves the shown row', async () => {
    // Rewriting `?tile=` to the preferred file would consume A4's `canonical`
    // signal and freeze a preference into a shareable link.
    const router = await renderAt(`/?tile=${String(ORD.archTopper)}`)
    expect(openTile(router)).toBe(ORD.archTopper)
  })

  /* ------------------------------------------------------- the 55.4% case */

  it('states the single way to print a one-file item, without a table', async () => {
    await renderAt(`/?tile=${String(ORD.floor1x1)}`)

    expect(within(drawer()).queryByRole('table')).toBeNull()
    expect(within(drawer()).getByText(/nothing to choose/)).toBeInTheDocument()
    // The same facts a row would have carried.
    expect(within(drawer()).getByText('2 parts.')).toBeInTheDocument()
    expect(within(drawer()).getByText(/Print this and a base/)).toBeInTheDocument()
    expect(within(drawer()).getByText('cave%floor.1x1.stl')).toBeInTheDocument()
    expect(within(drawer()).getByText(/1\.3 MB to download/)).toBeInTheDocument()
  })

  it('says so where a file declares no connection system at all', async () => {
    // The `insert`, whose `conn` resolves to nothing on either face.
    await renderAt(`/?tile=${String(ORD.noSprite)}`)
    expect(within(drawer()).getByText('No connection system declared')).toBeInTheDocument()
  })

  /* ---------------------------------------------------------------- slots */

  it('lists an accessory slot with the print that carries it, and not the base slot', async () => {
    await renderAt(`/?tile=${String(ORD.archTopper)}`)

    expect(within(drawer()).getByText('Accessory slots')).toBeInTheDocument()
    expect(within(drawer()).getByText('torch')).toBeInTheDocument()
    expect(within(drawer()).getByText('optional')).toBeInTheDocument()

    // Provenance: only the topper declares it, and the slot names that file by
    // the same label the table's row carries.
    const slot = within(drawer()).getByText('torch').closest('div')
    expect(slot).toHaveTextContent('Only on 1 of 3 prints')
    expect(slot).toHaveTextContent('cave%arch.2x.openforge.stl')

    // The `base` slot restates `needsBase`, which the part count already says,
    // so it is never listed as an accessory.
    expect(drawer().querySelectorAll('.of-detail-slots dt')).toHaveLength(1)

    // And the item is flagged as declaring different slots on different prints.
    expect(within(drawer()).getByText(/which file you print decides what it can hold/)).toBeInTheDocument()
  })

  it('words a one-file item’s slot in the singular', async () => {
    await renderAt(`/?tile=${String(ORD.wall)}`)

    // One variant, so the slot is universal by definition — and "on every one
    // of the 1 prints" is not a sentence.
    expect(within(drawer()).queryByRole('table')).toBeNull()
    expect(within(drawer()).getByText('torch')).toBeInTheDocument()
    expect(within(drawer()).getByText('On the only print of this item.')).toBeInTheDocument()
    expect(within(drawer()).queryByText(/of the 1 prints/)).toBeNull()
    // Required, not optional — absence of the flag means required.
    expect(within(drawer()).queryByText('optional')).toBeNull()
  })

  it('shows no slot section for an item that declares no composition', async () => {
    await renderAt(`/?tile=${String(ORD.floor1x1)}`)
    expect(within(drawer()).queryByText('Accessory slots')).toBeNull()
  })
})

/* ----------------------------------------------------------------- focus */

describe('focus', () => {
  it('traps focus inside the drawer and restores it on close', async () => {
    const router = await renderAt('/')
    const card = screen.getByRole('button', { name: 'a card' })
    act(() => {
      card.focus()
    })
    expect(card).toHaveFocus()

    await open(router, ORD.floor1x1)
    // `waitFor`, because Base UI moves focus in an effect rather than during
    // the navigation: the drawer's body mounts a sprite rotator and a variants
    // table, so "the drawer has rendered" and "focus has landed in it" are not
    // the same tick. What is asserted is unchanged — focus ends up inside.
    await waitFor(() => {
      expect(drawer().contains(document.activeElement)).toBe(true)
    })

    await act(async () => {
      fireEvent.keyDown(drawer(), { key: 'Escape' })
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(card).toHaveFocus()
    })
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
    [ORD.arc, '2 – 2.5 r 90°'],
    [ORD.coded, 'OpenLOCK BA'],
    [ORD.shapeless, 'Curved'],
    [ORD.noSprite, 'Size not specified'],
  ])('renders footprint tier for tile %i as %s', async (ord, expected) => {
    await renderAt(`/?tile=${String(ord)}`)
    expect(cell('Footprint')).toHaveTextContent(expected)
  })

  it('shows a qualitative height where the tags carry one', async () => {
    await renderAt(`/?tile=${String(ORD.wall)}`)
    expect(cell('Height')).toHaveTextContent('Low')
  })

  it('says so where no height basis exists, rather than printing a number', async () => {
    await renderAt(`/?tile=${String(ORD.floor1x1)}`)
    const height = cell('Height')
    expect(height).toHaveTextContent('Not recorded')
    expect(height).toHaveAttribute('data-empty')
    expect(height.getAttribute('title')).toContain('bounding box')
  })

  it('names the build system and its absence', async () => {
    await renderAt(`/?tile=${String(ORD.floor1x1)}`)
    expect(cell('Build system')).toHaveTextContent('Separate wall')

    await renderAt(`/?tile=${String(ORD.wall)}`)
    expect(cell('Build system')).toHaveTextContent('Not specified')
  })

  it('describes the file as an STL and a decimal size', async () => {
    await renderAt(`/?tile=${String(ORD.floor1x1)}`)
    expect(cell('File')).toHaveTextContent('STL · 1.3 MB')
  })
})

/* --------------------------------------------------------- storage address */

describe('the storage address', () => {
  it('is a real HTTPS link to the archive', async () => {
    await renderAt(`/?tile=${String(ORD.floor1x1)}`)

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
  it('offers §2.5’s two actions, the library toggle having become a placement', async () => {
    // Row A0 deleted the first action with the library it wrote to; **row C3**
    // puts one back with a different verb, because templates are the only
    // placement unit and *"I am going to print this"* now means *"this piece is
    // on my plan"*. The old library toggle is still asserted absent, so nothing
    // can quietly bring a second destination back.
    await renderAt(`/?tile=${String(ORD.floor1x1)}`)

    const actions = within(drawer())
      .getAllByRole('button')
      .filter((button) => button.className.includes('of-detail-action'))
    expect(actions.map((button) => button.textContent)).toEqual([
      '+ Place on the plan',
      'Use in builder →',
    ])
    expect(within(drawer()).queryByRole('button', { name: /Add to library/ })).toBeNull()
  })

  it('places the shown file into the family that admits it, keeping the file', async () => {
    // Row C3's half of the two actions, and the difference from arming: this
    // keeps the **file**. `armForTags` names the family — `role|floor` +
    // `form|straight` is `floor-straight` — and `placeFileAsFamily` pins the
    // variant on screen into that family's one slot, so the piece on the plan is
    // the piece in the preview well. `placeOnPlan` picks the cell with the
    // plan's own collision predicate.
    const router = await renderAt(`/?tile=${String(ORD.floor1x1)}`)

    fireEvent.click(within(drawer()).getByRole('button', { name: /Place on the plan/ }))
    // `waitFor`, because the press fetches `./placeOnPlan` and, through it, the
    // plan projection and the family table — the boundary that keeps all three
    // out of the catalog's own chunk, and the reason this is not synchronous.
    await waitFor(() => {
      expect(within(drawer()).getByRole('status')).toHaveTextContent(/Placed as/)
    })

    const placements = Object.values(useWorkshopStore.getState().placements)
    expect(placements).toHaveLength(1)
    expect(placements[0]).toMatchObject({
      template: 'floor-straight',
      rotation: 0,
      // `pinned: true`: the user pressed a button naming this tile, so the lock
      // re-solve must honour it (§2.1, contract C-k).
      fills: { floor: { tile: 'tiles/cave/floors/floor/cave%floor.1x1.stl', pinned: true } },
    })
    // It does not navigate, which is what keeps it a second action rather than a
    // quieter copy of "Use in builder →": the library toggle accumulated without
    // leaving the catalog and so does this. Nothing reaches the channel either —
    // placing is not arming.
    expect(router.state.location.pathname).toBe('/')
    expect(claimPendingArm()).toBeNull()
    expect(within(drawer()).getByRole('status')).toHaveTextContent(/Placed as Floor: Straight at x /)
  })

  it('sends the family that admits the tile, and no query with it', async () => {
    const router = await renderAt(`/?tile=${String(ORD.floor1x1)}`)

    await act(async () => {
      fireEvent.click(within(drawer()).getByRole('button', { name: /Use in builder/ }))
      await Promise.resolve()
    })

    expect(router.state.location.pathname).toBe('/builder')
    expect(screen.getByText('Builder screen')).toBeInTheDocument()
    // **The seeded query is gone, and its absence is the assertion.** The action
    // used to navigate with `?q=` the tile's name, because row A0's palette
    // listed the archive and the search was what put a row for the item in front
    // of the claim. Row C1's palette lists 91 template families, so a tile's name
    // narrows it to nothing — the arm is the whole handoff now.
    expect((router.state.location.search as { q?: string }).q).toBeUndefined()
    // Row G5's channel, carrying row C1's arm: the family derived from this
    // record's own `(role, form)` — `role|floor form|straight` is the key
    // `floor|straight|-`, whose id `familyKey.ts` *constructs* rather than looks
    // up — plus the tile's own size tags. The **palette** turns those into a
    // position of that family's control, because the domain is in the table the
    // drawer deliberately does not import.
    expect(claimPendingArm()).toEqual({ template: 'floor-straight', size: ['size|width|1'] })
  })

  it('says which family it will arm, because a family is not the tile', async () => {
    // The lossiness, disclosed at the writer. `armForTags` maps a tile to the
    // family that admits it, and the fill solver may put a different print — or a
    // different tile of the family — in the slot; a press that said only "use in
    // builder" would be claiming more than it does.
    //
    // The *family* and not the size: the size travels as the tile's own tags and
    // becomes a position on arrival, so naming one here would mean a third copy
    // of the generator's labels for no gain.
    await renderAt(`/?tile=${String(ORD.floor1x1)}`)
    expect(within(drawer()).getByText(/Arms/)).toHaveTextContent(
      'Arms the Floor: Straight family, at this tile’s size.',
    )
  })

  it('offers no arm for an insert, and says where it goes instead', async () => {
    // 94 designs, all `role|insert`, and 262 of their 285 records are already
    // reachable as a fill for a host tile's accessory slot — which is the grid
    // this same drawer renders. So the action is replaced rather than disabled,
    // and nothing reaches the channel.
    await renderAt(`/?tile=${String(ORD.shapeless)}`)

    expect(within(drawer()).queryByRole('button', { name: /Use in builder/ })).toBeNull()
    expect(within(drawer()).getByText(/Inserts are not placed on their own/)).toBeInTheDocument()
    expect(claimPendingArm()).toBeNull()
    // Row C3. Both actions are gated on the same answer, so the sentence stands
    // alone rather than beside a "place it" that would place it wrongly.
    expect(within(drawer()).queryByRole('button', { name: /Place on the plan/ })).toBeNull()
  })

  it('offers no arm for a tile this build files under no family', async () => {
    // Unreachable over the emitted index — all 8,702 records carry exactly one
    // role and one form — and reachable after an import that fails to classify
    // one. It must not read as the insert case: that tile has somewhere to go and
    // this one does not.
    await renderAt(`/?tile=${String(ORD.arc)}`)

    expect(within(drawer()).queryByRole('button', { name: /Use in builder/ })).toBeNull()
    expect(within(drawer()).getByText(/files no template family for this tile/)).toBeInTheDocument()
    // Row C3, as above: one refusal for both verbs.
    expect(within(drawer()).queryByRole('button', { name: /Place on the plan/ })).toBeNull()
  })

  it('sends the family, and still shows the variant the preference picked', async () => {
    // `?tile=30` is canonical, and with no lock chosen A1's rank shows the plain
    // openlock integral rather than the address holder — the case the tests above
    // assert, and it is unchanged: the drawer's *display* is still per-variant.
    // What travels is a family, so the two questions have come apart — which was
    // row V1's change to this channel and survives row C1's.
    await renderAt(`/?tile=${String(ORD.archTopper)}`)
    expect(
      within(drawer())
        .getAllByRole('row')
        .filter((row) => row.getAttribute('aria-current') === 'true')[0],
    ).toHaveTextContent('cave%arch.2x.openlock.stl')

    await act(async () => {
      fireEvent.click(within(drawer()).getByRole('button', { name: /Use in builder/ }))
      await Promise.resolve()
    })

    expect(claimPendingArm()?.template).toBe('wall-straight')
  })

  it.each([
    ['a dragonlock preference and the topless variant', 'dragonlock', ORD.archTopless] as const,
    ['no preference and the topper variant', 'openlock', ORD.archTopper] as const,
  ])('sends the same arm under %s', async (_label, lock, ord) => {
    // `?tile=32` asked for a specific print and the drawer still shows it. Under
    // the old file-carrying channel this case existed because the handoff had to
    // carry *that* file, or following a link and pressing the action would arm a
    // different one — a lock preference leaking into a handoff. A family cannot
    // leak, so the claim is the same arm from either variant under either lock,
    // and the assertion is an *invariance* rather than an identity.
    //
    // It is also the fixture's copy of a corpus measurement: over all 3,822
    // items, the number whose variants disagree about either the family or the
    // size position is **0** — which is what makes reading the shown record's
    // tags rather than the item's a safe question to ask.
    act(() => {
      setLockSystem(lock)
    })
    await renderAt(`/?tile=${String(ord)}`)

    await act(async () => {
      fireEvent.click(within(drawer()).getByRole('button', { name: /Use in builder/ }))
      await Promise.resolve()
    })

    expect(claimPendingArm()).toEqual({ template: 'wall-straight', size: [] })
  })
})

/* ------------------------------------------------------------- the preview */

describe('the gated 3D panel', () => {
  it('is offered under the rotator, closed, with the download size in its label', async () => {
    // Row 21 built `Tile3DPanel` and mounted it nowhere; row X2 put it here, one
    // line under the rotator, exactly as that module's docblock specifies. The
    // floor is 1.3 MB, inside the 24 MiB gate, so the control is offered.
    await renderAt(`/?tile=${String(ORD.floor1x1)}`)

    const button = within(drawer()).getByRole('button', { name: /View in 3D/ })
    expect(button).toHaveTextContent('1.3 MB')
    // Closed on open: the chunk, the WebGL context and the fetch all start on
    // the same press, so nothing has been paid for yet.
    expect(drawer().querySelector('.of-3d-well')).toBeNull()
    expect(drawer().querySelector('.of-3d-panel')).toHaveAttribute('data-gate', 'open')
  })

  it('sits between the rotator and the title, and does not replace either', async () => {
    // The two previews coexist, and the reason is a capability rather than
    // taste: `OrbitControls` has no key bindings, so the rotator's `role="slider"`
    // remains the keyboard route to every angle.
    await renderAt(`/?tile=${String(ORD.floor1x1)}`)

    const rotator = within(drawer()).getByRole('slider')
    const panel = drawer().querySelector('.of-3d-panel')
    const title = drawer().querySelector('.of-detail-title')

    expect(panel).not.toBeNull()
    expect(rotator.compareDocumentPosition(panel as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect((panel as Node).compareDocumentPosition(title as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it('describes the variant on screen, which is not always the one the URL named', async () => {
    // The panel's record is assembled from the aggregate and the **shown**
    // variant, so a link to the address holder that resolves to a different file
    // offers that file's size and not the address holder's. `archTopper` is
    // 2.1 MB and the preference-selected integral is 2.4 MB.
    await renderAt(`/?tile=${String(ORD.archTopper)}`)

    expect(within(drawer()).getByRole('button', { name: /View in 3D/ })).toHaveTextContent('2.4 MB')
  })

  it('is not a WebGL test, and jsdom could not make it one', async () => {
    // Stated rather than implied. Pressing the button loads a `lazy()` chunk
    // that constructs a `WebGLRenderer` and uploads two `Float32Array`s to a GPU
    // jsdom does not have; it rasterises nothing and reports every box as 0x0.
    // What is provable here is the gate's decision, the label, the placement and
    // the closed initial state — all of which are above. The renderer's own
    // states live in `src/three/panel.test.tsx`, the corpus split behind the gate
    // in `src/three/gate.test.ts`, and the promise that none of it reaches the
    // entry chunk in `src/three/boundary.test.ts`, which reads the import graph.
    await renderAt(`/?tile=${String(ORD.floor1x1)}`)

    expect(drawer().querySelector('canvas')).toBeNull()
  })
})

describe('the sprite rotator', () => {
  const frame = () => within(drawer()).getByRole('slider')
  /**
   * The sheet itself, which is a child of the slider rather than the slider.
   *
   * Row X10 split the two: a CSS filter takes the element's box decorations with
   * it, and the slider carries the app's one accent focus ring. Asserted as a
   * child of the slider so the split cannot silently become two siblings.
   */
  const sheet = () => {
    const found = frame().querySelector<HTMLElement>('.of-detail-sheet')
    if (found === null) throw new Error('no .of-detail-sheet inside the slider')
    return found
  }

  it('shows the default frame of the tile’s sheet', async () => {
    await renderAt(`/?tile=${String(ORD.floor1x1)}`)

    expect(frame()).toHaveAttribute('data-frame', '0')
    expect(sheet().style.backgroundImage).toContain(
      'https://objects.openforge.tools/sprites/a1b2c3/a1b2c3d4e5f60718293a4b5c6d7e8f90.png',
    )
    // 5 columns × 2 rows of 288px frames, showing the first.
    expect(sheet().style.backgroundSize).toBe('1440px 576px')
    expect(sheet().style.backgroundPosition).toBe('0px 0px')

    // The tint, through the *sheet's* chain and not the derivative's, and on the
    // inert child. The id rather than the whole `url()`: row P1 found Chrome and
    // jsdom serialise the quotes differently, so the id is the stable half.
    expect(sheet().style.filter).toContain('#of-tint-sprite-cave')
    expect(sheet().style.filter).not.toContain('of-tint-thumb-')
    // The slider itself must carry no filter, or the accent focus ring goes
    // through the matrix with it.
    expect(frame().style.filter).toBe('')

    // And the filters it references are in the document, mounted by this
    // component rather than borrowed from whatever else happens to be on screen.
    const defs = document.getElementById(TINT_FILTER_SHEET_ID)
    expect(defs).not.toBeNull()
    expect(defs?.querySelector('#of-tint-sprite-cave')).not.toBeNull()
  })

  it('rotates with the arrow keys, around the ring and to the poles', async () => {
    await renderAt(`/?tile=${String(ORD.floor1x1)}`)

    fireEvent.keyDown(frame(), { key: 'ArrowRight' })
    expect(frame()).toHaveAttribute('aria-valuetext', 'front right')
    expect(sheet().style.backgroundPosition).toBe('-288px 0px')

    // Backwards past `front` wraps to the far end of the ring rather than
    // stopping — the eight frames are a closed 360° orbit.
    fireEvent.keyDown(frame(), { key: 'ArrowLeft' })
    fireEvent.keyDown(frame(), { key: 'ArrowLeft' })
    expect(frame()).toHaveAttribute('aria-valuetext', 'front left')

    // The poles are off the ring; leaving one returns to the azimuth held.
    fireEvent.keyDown(frame(), { key: 'ArrowUp' })
    expect(frame()).toHaveAttribute('aria-valuetext', 'top')
    expect(frame()).toHaveAttribute('aria-valuenow', '7')
    expect(sheet().style.backgroundPosition).toBe('-864px -288px')

    fireEvent.keyDown(frame(), { key: 'ArrowRight' })
    expect(frame()).toHaveAttribute('aria-valuetext', 'front')
  })

  it('rotates by dragging, one step per 30px', async () => {
    await renderAt(`/?tile=${String(ORD.floor1x1)}`)

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
    await renderAt(`/?tile=${String(ORD.floor1x1)}`)

    fireEvent.click(within(drawer()).getByRole('button', { name: 'bottom' }))
    expect(frame()).toHaveAttribute('aria-valuetext', 'bottom')
    expect(within(drawer()).getByRole('button', { name: 'bottom' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('states the caption as pre-rendered frames, not as a live render', async () => {
    await renderAt(`/?tile=${String(ORD.floor1x1)}`)

    expect(within(drawer()).getByText(/pre-rendered angles/)).toBeInTheDocument()
    expect(within(drawer()).queryByText(/live render/)).toBeNull()
  })

  it('mounts the tint filters itself, with no thumbnail anywhere on the page', () => {
    // The claim in `@/ui/thumb`'s barrel is that a caller like this one needs
    // only the `url(#…)` because the filters are already in the document. They
    // are — when a `TileThumb` is mounted, which is the catalog grid's doing and
    // not this subtree's. So the sheet is removed and the rotator rendered on its
    // own: this fails if the `useTintFilters()` call in `SpriteRotator` goes.
    document.getElementById(TINT_FILTER_SHEET_ID)?.remove()
    expect(document.getElementById(TINT_FILTER_SHEET_ID)).toBeNull()

    render(
      <SpriteRotator
        material="necro"
        name="Aztlan Floor 1x1"
        sheet={{ cols: 5, rows: 2, tile: 512, frames: 10, defaultFrame: 0 }}
        sheetUrl="https://objects.openforge.tools/sprites/ab/abcdef.png"
      />,
    )

    const defs = document.getElementById(TINT_FILTER_SHEET_ID)
    expect(defs).not.toBeNull()
    expect(defs?.querySelector('#of-tint-sprite-necro')).not.toBeNull()
    const sheetEl = screen.getByRole('slider').querySelector<HTMLElement>('.of-detail-sheet')
    expect(sheetEl?.style.filter).toContain('#of-tint-sprite-necro')
  })

  it('renders the one tile with no sprite sheet, saying which it is', async () => {
    await renderAt(`/?tile=${String(ORD.noSprite)}`)

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
    await renderAt(`/?tile=${String(ORD.wall)}`)

    expect(within(drawer()).getByText('shape|wall|low')).toBeInTheDocument()
    expect(within(drawer()).getByText('texture|cave')).toBeInTheDocument()
  })
})
