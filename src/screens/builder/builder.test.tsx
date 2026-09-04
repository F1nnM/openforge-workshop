// @vitest-environment jsdom
/**
 * The builder screen, mounted through the real router.
 *
 * The **real route tree** (so `?q=` really is validated by PR 6's schema before
 * the palette sees it), the **real search engine**, the **real assembly resolver**
 * and the **real store**. The only thing stubbed is `fetch`, which returns the
 * panels' nine-record fixture instead of the 5.6 MB index — a component test has
 * no business fetching a build artefact, and the fixture still travels the real
 * path through `CatalogFile.parse`.
 *
 * ## Why the no-page-scroll requirement is asserted against the stylesheet
 *
 * design-contract.md §2.4 is explicit that the builder is three columns at the
 * viewport's height with **no page scroll**, and that is the one requirement on
 * this screen that jsdom cannot check: it reports every element as 0 × 0, applies
 * no imported stylesheet and lays nothing out. Asserting it in the DOM would
 * produce a test that passes whatever the CSS says.
 *
 * So the layout invariants are asserted against the text of `builder.css` and
 * `panels.css`, and each one is there because it broke or would break something
 * real:
 *
 *   - the two fixed track widths and `minmax(0, 1fr)` between them — without the
 *     `0` minimum a long tile name widens the palette's track and pushes the
 *     stage out of the viewport;
 *   - the height in terms of `--of-header-h` rather than a restated `60px`;
 *   - `overflow: hidden` on the grid;
 *   - **`position: relative` on the grid and on both scroll containers.** This one
 *     is a measured regression: every `VisuallyHidden` span is `position:
 *     absolute`, so without a positioned ancestor its containing block is the
 *     *initial* containing block, it escapes every `overflow: hidden` between it
 *     and the root, and it contributes its offset to the document's scroll
 *     height. Measured in Chromium before the fix: **2,809px of page scroll on a
 *     900px viewport**, on the one screen specified to have none.
 *
 * A browser pass is what actually verified the layout — `window.scrollTo(0, 2000)`
 * leaving `scrollY` at 0 at 1440px, 1000px and 860px wide. These assertions are
 * what stop it silently regressing between browser passes.
 */
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as BuilderThree from '@/builder/three'
import type * as GeneratorPanelModule from '@/generator/panel'
import type { ArchivedPlacement } from '@/generator/placement'
import { createWorkshopRouter } from '@/routes'
import type { FacetSearch } from '@/search'
import { TileId } from '@/catalog'
import { FIXTURE_CATALOG, FIXTURE_IDS, FIXTURE_NAMES, anInstance } from '@/builder/panels/fixture'
import { resetCatalogSearchIndex } from '@/screens/catalog'
import {
  SlotName,
  TemplateId,
  clearPersistedWorkshopState,
  placeTemplate,
  resetWorkshop,
  useWorkshopStore,
} from '@/store'
import { CatalogStatsProvider, resetCatalogIndexCache } from '@/ui/shell'

/**
 * The 3D surface, stubbed — and row R2 is what makes this necessary.
 *
 * The surface is now open on arrival, because the owner asked for the 3D view to
 * *be* the builder rather than a panel behind a gate. So mounting this screen
 * mounts `<Canvas>`, and jsdom has no WebGL context and no `ResizeObserver`:
 * r3f throws at mount, the route's `CatchBoundary` catches it, and the whole
 * screen is replaced by an error — which is what happened when this mock was not
 * here, and it took the palette with it.
 *
 * `importActual` keeps `@/builder/three`'s module real, so the barrel's own
 * boundary is still exercised by the import; only the element is swapped. What
 * this screen's tests are about — three columns, no page scroll, the bill driven
 * from the store, the query in the URL — is entirely unaffected by which
 * renderer draws the room, and the surface's own behaviour is tested in
 * `src/builder/three/**` where it can be tested honestly.
 *
 * Row **R4** deleted the plan view, so this stub is now the *only* thing in the
 * stage. One assertion changed for it and the change is recorded at the call
 * site: nothing in this file can any longer see a `role="application"`.
 */
vi.mock('@/builder/three', async () => {
  const actual = await vi.importActual<typeof BuilderThree>('@/builder/three')
  return { ...actual, Builder3DPanel: () => <div data-testid="builder-3d" /> }
})

/**
 * The generator drawer, reduced to its one seam — `onPlace`.
 *
 * Row **A8** needs the screen's *handling* of a resolved recipe under test, and
 * the drawer that produces one is behind a lazy boundary with the pinned
 * parameter schemas, the base resolver and, one import further on, the OpenSCAD
 * engine. Mounting it to press a button would put all of that in this test's
 * graph to exercise one callback.
 *
 * So the element is swapped for a button that calls `onPlace` with the value the
 * real drawer hands over. That value is `placeRecipe`'s own return type, spelled
 * as a literal here rather than produced by calling it: what is under test is
 * what `BuilderScreen` does with an {@link ArchivedPlacement}, not how the
 * generator arrives at one — `src/generator/placement/placement.test.ts` owns
 * that half, and building a `Resolution` here would couple this test to the
 * resolver's fixtures for nothing.
 *
 * `importActual` keeps the module real, so the barrel's own type surface is
 * still exercised by the import; only the component is replaced.
 */
const ARCHIVED_BASE_FILE = 'plain#base.2x2.openlock.stl'
const ARCHIVED: ArchivedPlacement = {
  kind: 'archived',
  fill: { tile: TileId.parse(FIXTURE_IDS.base2), pinned: true },
  at: { x: 4, z: 0, rotation: 0 },
  // `ArchiveBase` is the resolver's own record type and carries a dozen fields
  // this screen never reads — it takes the file and the fill and nothing else —
  // so only those are spelled, and the cast is what says the rest is not this
  // test's subject. `src/generator/panel/resolve.ts` owns the whole shape.
  base: { id: FIXTURE_IDS.base2, file: ARCHIVED_BASE_FILE } as ArchivedPlacement['base'],
  recipeId: 'abcd1234',
  note: `Placed from the generator. ${ARCHIVED_BASE_FILE} is Devon's published mesh.`,
}

vi.mock('@/generator/panel', async () => {
  const actual = await vi.importActual<typeof GeneratorPanelModule>('@/generator/panel')
  return {
    ...actual,
    GeneratorPanel: ({ onPlace }: GeneratorPanelModule.GeneratorPanelProps) => (
      <button
        type="button"
        onClick={() => {
          onPlace?.(ARCHIVED, null)
        }}
      >
        place the archived base
      </button>
    ),
  }
})

/* ------------------------------------------------------------------ scaffold */

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

async function renderBuilder(path = '/builder') {
  const router = createWorkshopRouter({ history: createMemoryHistory({ initialEntries: [path] }) })
  const result = render(
    <CatalogStatsProvider value={null}>
      <RouterProvider router={router} />
    </CatalogStatsProvider>,
  )

  await act(async () => {
    await router.load()
  })
  // The index resolves in a microtask after mount; the first assertion would
  // otherwise race the loading state.
  await waitFor(() => {
    expect(screen.getByRole('complementary', { name: 'Palette' })).toBeInTheDocument()
  })

  return { ...result, router }
}

function currentSearch(router: ReturnType<typeof createWorkshopRouter>): FacetSearch {
  return router.state.matches.at(-1)?.search as FacetSearch
}

beforeEach(() => {
  resetWorkshop()
  clearPersistedWorkshopState()
  resetCatalogSearchIndex()
  resetCatalogIndexCache()
  stubFetch()
})

afterEach(() => {
  resetWorkshop()
  clearPersistedWorkshopState()
  resetCatalogSearchIndex()
  resetCatalogIndexCache()
  vi.unstubAllGlobals()
})

/* -------------------------------------------------------------- the three columns */

describe('the builder screen', () => {
  it('replaces the placeholder and renders all three columns', async () => {
    await renderBuilder()

    expect(screen.getByRole('complementary', { name: 'Palette' })).toBeInTheDocument()
    // The middle column. `getByRole('application')` used to stand for it, which
    // was `PlanCanvas`'s markup: row **R4** deleted that renderer, and the 3D
    // surface — which sets the same role on its `<canvas>` — is the stub at the
    // top of this file, because r3f throws in jsdom. So the honest assertion at
    // this level is that the stage's element is mounted; the role itself is
    // asserted where a real renderer produces it, in `three/room.test.tsx`.
    expect(screen.getByTestId('builder-3d')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /pieces placed/ })).toBeInTheDocument()
    expect(screen.queryByText(/Placeholder/)).toBeNull()
  })

  it('has one main landmark and a clipped heading, not a second <main>', async () => {
    await renderBuilder()
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Builder' })).toHaveClass('of-sr-only')
  })

  it('shows the lock notice and the work-area lock control, which is what it now points at', async () => {
    await renderBuilder()
    // PR 19 mounts nothing itself: `LockNotice` renders here or nowhere.
    expect(screen.getByRole('complementary', { name: 'Lock system' })).toBeInTheDocument()
    // Row L1: the notice used to be the only route to `/settings`. That screen
    // is deleted and the preference is a control in the stage, so both have to
    // be on this screen — the notice's "show me the control" action moves focus
    // to the second of these and does nothing if it is absent.
    expect(screen.getByRole('button', { name: /^Lock system: / })).toBeInTheDocument()
  })

  it('reads the facets out of the URL, so a shared palette search arrives filtered', async () => {
    const { router } = await renderBuilder('/builder?q=cave')

    expect(currentSearch(router).q).toBe('cave')
    // The archive block appears with the matching tile in it — the palette
    // searched the whole catalog rather than only the (empty) library.
    expect(screen.getByRole('region', { name: /^Archive/ })).toHaveTextContent(FIXTURE_NAMES.wallNoBase)
  })

  it('writes the palette query back to the URL', async () => {
    const { router } = await renderBuilder()

    fireEvent.change(screen.getByRole('searchbox', { name: /Search the catalog/ }), {
      target: { value: 'dungeon' },
    })
    await waitFor(() => {
      expect(currentSearch(router).q).toBe('dungeon')
    })
  })

  it('drives the bill from the store, through the whole screen', async () => {
    await renderBuilder()

    expect(screen.getByRole('heading', { name: '0 pieces placed' })).toBeInTheDocument()

    act(() => {
      // Through `placeTemplate`, not `setState`: the screen's bill needs a real
      // {@link TemplateInstance} and the store's parse is the thing that says
      // this fixture is one. `anInstance` puts one file in a one-slot recipe —
      // `fixture.ts` carries both, and the screen resolves them against the
      // shipped table, so the recipe here is deliberately *not* one of the 40.
      placeTemplate(anInstance([FIXTURE_IDS.floor1]))
    })

    // One placement, and the bill reports it as an instance whose recipe this
    // build does not ship — which is the honest outcome for a fixture family and
    // is what makes the count and the orphan block both live.
    expect(screen.getByRole('heading', { name: '1 piece placed' })).toBeInTheDocument()
    expect(screen.getByText(/1 placed piece has nothing this build can print/)).toBeInTheDocument()
  })

  it('drives the bill through the shipped recipe table, so a real family resolves', async () => {
    await renderBuilder()

    act(() => {
      // `s2w-wall-on-tile-corner-low-single-piece` is one of the 40 in
      // `screens/assemblies/templates.ts`, and its `floor` slot is a real slot —
      // so this is the one assertion that the screen's `templates` lookup is the
      // shipped table rather than an empty one. Four of its five slots are open,
      // which §3.2 places anyway.
      placeTemplate({
        template: TemplateId.parse('s2w-wall-on-tile-corner-low-single-piece'),
        x: 0,
        z: 0,
        rotation: 0,
        fills: { [SlotName.parse('floor')]: { tile: TileId.parse(FIXTURE_IDS.floor1), pinned: false } },
      })
    })

    expect(screen.getByText(FIXTURE_NAMES.floor1, { selector: '.of-bill-name' })).toBeInTheDocument()
    // The recipe resolved, so the piece is a row rather than an orphan — and the
    // open slots are reported instead.
    expect(screen.queryByText(/nothing this build can print/)).toBeNull()
    expect(screen.getByText(/4 slots are still empty/)).toBeInTheDocument()
  })

  /**
   * **Row A8's one refusal, asserted so row B4 finds it deliberate.**
   *
   * The generator's archived arm resolves a recipe to a file Devon already
   * publishes — 682 of the archive's 709 resolvable keys — and that shortcut is
   * what stops the 298 kB worker chunk and the 10.5 MB WASM being fetched at all.
   * It cannot *place* the result: a base goes on the grid as a one-slot recipe
   * predicating on `shape|base`, row **B4** owes that family, and `base` is not
   * one of B1's eight roles, so no family keyed on `(role, form, build)` can be
   * it (all 686 resolvable base records spread across eight keys, none a base).
   *
   * So this pins both halves: the resolved file is named on screen, and the store
   * is untouched. Filling the `base` slot of a `role|floor` family would compile,
   * would work geometrically, and would mislabel a base as a floor in the
   * palette — which is why A9 left this as a compile error and A8 left it as a
   * refusal rather than closing it with a guess.
   */
  it('names the archived base it resolved and declines to place it, pending row B4', async () => {
    await renderBuilder()

    act(() => {
      screen.getByRole('button', { name: 'place the archived base' }).click()
    })

    // By class, not by role: the screen already has two live regions of its own
    // (the toolbar's readout and the bill's verdict), so `getByRole('status')`
    // is ambiguous here. The role itself is asserted on the node.
    const notice = document.querySelector('.of-build-declined')
    expect(notice).not.toBeNull()
    expect(notice).toHaveAttribute('role', 'status')
    expect(notice).toHaveTextContent(ARCHIVED_BASE_FILE)
    expect(notice).toHaveTextContent(/already in the archive, so nothing was generated/)
    expect(notice).toHaveTextContent(/a base is placed as a one-slot recipe, and that recipe is not in this build/)
    // Nothing was written to either map: not the catalog scene, and not the
    // generated one — the archive publishes this file, so generating it would be
    // the other wrong answer.
    expect(useWorkshopStore.getState().placements).toEqual({})
    expect(useWorkshopStore.getState().generated).toEqual({})
  })

  it('offers a retry rather than a blank screen when the index cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

    const router = createWorkshopRouter({ history: createMemoryHistory({ initialEntries: ['/builder'] }) })
    render(
      <CatalogStatsProvider value={null}>
        <RouterProvider router={router} />
      </CatalogStatsProvider>,
    )
    await act(async () => {
      await router.load()
    })

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/could not be loaded/)
    })
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    // The heading survives the failure, so the screen is still identifiable.
    expect(screen.getByRole('heading', { level: 1, name: 'Builder' })).toBeInTheDocument()
  })
})

/* ------------------------------------------------------------ layout contract */

const css = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

describe('the layout does not scroll the page', () => {
  const layout = css('./builder.css')
  const panels = css('../../builder/panels/panels.css')

  it('is three columns at the viewport height, with the header measured rather than restated', () => {
    expect(layout).toContain('grid-template-columns: 272px minmax(0, 1fr) 302px')
    expect(layout).toContain('height: calc(100dvh - var(--of-header-h))')
    // `100vh` on mobile Safari is the *largest* viewport height, so a page sized
    // to it scrolls by the height of the collapsing toolbar.
    expect(layout).not.toMatch(/height: calc\(100vh/)
    // A restated 60px is the thing `--of-header-h` exists to prevent.
    expect(layout).not.toMatch(/100dvh - 60px/)
  })

  it('clips the grid and gives it a positioning context', () => {
    const builder = block(layout, '.of-builder')
    expect(builder).toContain('overflow: hidden')
    expect(builder).toContain('min-height: 0')
    // The measured regression: 2,809px of page scroll from clipped spans whose
    // containing block was the initial containing block.
    expect(builder).toContain('position: relative')
  })

  it('makes both side columns their own scroll containers, each positioned', () => {
    for (const selector of ['.of-palette', '.of-bill-scroll']) {
      const rule = block(panels, selector)
      expect(rule, selector).toContain('overflow-y: auto')
      expect(rule, selector).toContain('position: relative')
      expect(rule, selector).toContain('min-height: 0')
    }
  })

  it('keeps the bill’s total and download action out of the scrolling band', () => {
    // Three bands — head, scroll, foot — so a fifty-row room cannot push the
    // download button off screen.
    expect(block(panels, '.of-bill')).toContain('grid-template-rows: auto minmax(0, 1fr) auto')
  })
})

/**
 * The declarations of one rule, by selector.
 *
 * A regex rather than a CSS parser: the alternative is a parser dependency for a
 * handful of assertions, and this file is asserting the *text* of a contract
 * deliberately — see the module note on why the DOM cannot answer these.
 */
function block(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`^${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(source)
  if (match === null) throw new Error(`no rule for ${selector}`)
  return match[1] ?? ''
}
