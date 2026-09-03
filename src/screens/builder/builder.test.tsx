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
import { createWorkshopRouter } from '@/routes'
import type { FacetSearch } from '@/search'
import { FIXTURE_CATALOG, FIXTURE_DESIGNS, FIXTURE_NAMES } from '@/builder/panels/fixture'
import { resetCatalogSearchIndex } from '@/screens/catalog'
import { clearPersistedWorkshopState, resetWorkshop, useWorkshopStore } from '@/store'
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
    expect(screen.getByRole('heading', { name: /tiles placed/ })).toBeInTheDocument()
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

    expect(screen.getByRole('heading', { name: '0 tiles placed' })).toBeInTheDocument()

    act(() => {
      useWorkshopStore.setState({
        placements: {
          // `PlacementId` and `DesignId` are branded strings over the same
          // scene; the store's own parse is exercised in `panels.test.tsx`.
          p1: { design: FIXTURE_DESIGNS.floor1, x: 0, z: 0, rotation: 0 },
        } as never,
      })
    })

    expect(screen.getByRole('heading', { name: '1 tile placed' })).toBeInTheDocument()
    expect(screen.getByText(FIXTURE_NAMES.floor1, { selector: '.of-bill-name' })).toBeInTheDocument()
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
