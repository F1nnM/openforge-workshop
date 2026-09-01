// @vitest-environment jsdom
/**
 * Settings screen tests.
 *
 * Rendered through the **real router** over `createMemoryHistory()`, with the
 * **real store** and a stubbed `fetch` serving a fixture index. The only stub is
 * the network, for the same reason the landing and library suites stub it: the
 * index is a 5.6 MB build artefact.
 *
 * The fixture's reachability figures are deliberately nothing like the real
 * archive's — **4 designs**, giving 75.0% / 50.0% / 25.0% — so if `3,822`,
 * `99.9%`, `74.7%` or `59.7%` ever appears on screen during these tests,
 * something has hard-coded a number that is supposed to be measured. That is the
 * failure this file exists to catch: the plan's first draft put the cost of this
 * choice at 0.1 points and was wrong by two orders of magnitude, and a constant
 * in the UI is exactly how a stale figure survives a rescan.
 *
 * Every share is distinct on purpose: a tie would make "which option reaches
 * furthest" depend on the name tie-break, and the assertions below would then be
 * testing the tie-break rather than the screen.
 *
 * What else is asserted, and why each is here rather than left to a manual pass:
 *
 *   - **Picking an option writes the store**, not just the DOM. The value feeds
 *     `@/assembly` and the download pack; a picker that only looked selected
 *     would be a silent no-op.
 *   - **Picking marks the preference as chosen**, which is what retires the
 *     one-time notice. The two are one action in the store precisely so they
 *     cannot come apart.
 *   - **The notice dismisses without changing the lock**, because "keep what I
 *     have" is a real answer and must not be implemented as
 *     `setLockSystem(default)`.
 *   - **The consequences copy is conditional on there being a scene.** Telling a
 *     user with an empty grid about `base-lock-mismatch` is noise; not telling a
 *     user with forty tiles placed is dishonest.
 */
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TileId } from '@/catalog'
import type { WorkshopRouter } from '@/routes'
import { createWorkshopRouter } from '@/routes'
import {
  clearPersistedWorkshopState,
  placeTile,
  resetWorkshop,
  setLockSystem,
  useWorkshopStore,
} from '@/store'
import { LockNotice, resetLockReach } from '@/ui/lock-picker'
import { CatalogStatsProvider, resetCatalogIndexCache } from '@/ui/shell'

/* ------------------------------------------------------------------ fixture */

const TILE_A = 'tiles/cave/floors/floor/openlock/cave#floor.2x2.openlock.stl'

/**
 * Four designs across five records:
 *
 * | design    | locks                        | reachable under |
 * | --------- | ---------------------------- | --------------- |
 * | `d-open`  | openlock, twice — one of them |
 * |           | tagged `side\|openlock`      | openlock only |
 * | `d-open2` | openlock                     | openlock only |
 * | `d-mag`   | magnetic, and it is a base   | magnetic only |
 * | `d-free`  | *(openforge)* — no lock      | all three |
 *
 * openlock 3/4, magnetic 2/4, dragonlock 1/4 — so `3 / 4 designs` and `50.0 pp`
 * are strings only this fixture can produce.
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
  tags: ['texture|cave', 'shape|floor', 'shape|base'],
  records: [
    {
      id: TILE_A,
      ord: 0,
      blob: 'a'.repeat(32),
      file: 'cave#floor.2x2.openlock.stl',
      bytes: 1_000_000,
      sprite: true,
      family: 'tiles/cave/floors/floor/openlock',
      design: 'd-open',
      name: 'Cave Floor 2x2',
      kinds: ['floor'],
      conn: ['openlock'],
      layer: 'integral',
      texture: 'cave',
      tags: [0, 1],
      foot: { shape: 'rect', w: 2, d: 2 },
      rotStep: 90,
    },
    {
      // The position-segment case: `side|openlock` is openlock mounted on the
      // side, and it is the second file of a design already reachable under
      // openlock — so misreading it as a `side` system would not change the
      // count. It is here as the smallest live example of the tag shape.
      id: 'tiles/cave/floors/floor/openlock/cave#floor.2x2.openlock.topless.stl',
      ord: 1,
      blob: 'b'.repeat(32),
      file: 'cave#floor.2x2.openlock.topless.stl',
      bytes: 1_000_000,
      sprite: true,
      family: 'tiles/cave/floors/floor/openlock',
      design: 'd-open',
      name: 'Cave Floor 2x2 Topless',
      kinds: ['floor'],
      conn: ['side|openlock'],
      layer: 'integral',
      texture: 'cave',
      tags: [0, 1],
      foot: { shape: 'rect', w: 2, d: 2 },
      rotStep: 90,
    },
    {
      id: 'tiles/cave/floors/floor/openlock/cave#floor.1x1.openlock.stl',
      ord: 2,
      blob: 'e'.repeat(32),
      file: 'cave#floor.1x1.openlock.stl',
      bytes: 1_000_000,
      sprite: true,
      family: 'tiles/cave/floors/floor/openlock',
      design: 'd-open2',
      name: 'Cave Floor 1x1',
      kinds: ['floor'],
      conn: ['openlock'],
      layer: 'integral',
      texture: 'cave',
      tags: [0, 1],
      foot: { shape: 'rect', w: 1, d: 1 },
      rotStep: 90,
    },
    {
      id: 'tiles/cave/bases/base/magnetic/cave#base.2x2.magnetic.stl',
      ord: 3,
      blob: 'c'.repeat(32),
      file: 'cave#base.2x2.magnetic.stl',
      bytes: 1_000_000,
      sprite: true,
      family: 'tiles/cave/bases/base/magnetic',
      design: 'd-mag',
      name: 'Cave Base 2x2',
      kinds: ['base'],
      conn: ['magnetic'],
      layer: 'base',
      texture: 'cave',
      tags: [0, 2],
      foot: { shape: 'rect', w: 2, d: 2 },
      rotStep: 90,
    },
    {
      id: 'tiles/cave/walls/wall/openforge/cave#wall.2.openforge.stl',
      ord: 4,
      blob: 'd'.repeat(32),
      file: 'cave#wall.2.openforge.stl',
      bytes: 1_000_000,
      sprite: true,
      family: 'tiles/cave/walls/wall/openforge',
      design: 'd-free',
      name: 'Cave Wall 2',
      kinds: ['wall'],
      conn: ['openforge'],
      layer: 'topper',
      texture: 'cave',
      tags: [0],
      foot: { shape: 'wall', length: 2 },
      rotStep: 90,
    },
  ],
}

/* -------------------------------------------------------------------- harness */

function renderAt(path: string) {
  const router = createWorkshopRouter({ history: createMemoryHistory({ initialEntries: [path] }) })
  return render(
    <CatalogStatsProvider value={null}>
      <RouterProvider router={router} />
    </CatalogStatsProvider>,
  )
}

const lockState = () => useWorkshopStore.getState()

beforeEach(() => {
  localStorage.clear()
  clearPersistedWorkshopState()
  resetWorkshop()
  resetCatalogIndexCache()
  resetLockReach()
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(RAW_INDEX), { status: 200 }))),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetCatalogIndexCache()
  resetLockReach()
  resetWorkshop()
})

/** The `<label>` for one option, which is the whole clickable row. */
function optionRow(name: string): HTMLElement {
  return screen.getByRole('radio', { name: new RegExp(name, 'i') }).closest('label') as HTMLElement
}

/* ------------------------------------------------------------------- figures */

describe('the reachable-design figures', () => {
  it('come from the index, not from a constant', async () => {
    renderAt('/settings')

    // Four designs in the fixture; the real archive has 3,822. If the screen
    // ever shows the latter, it is reading the plan rather than the index.
    await waitFor(() => {
      expect(screen.getByText('3 / 4 designs')).toBeInTheDocument()
    })
    expect(screen.getByText('2 / 4 designs')).toBeInTheDocument()
    expect(screen.getByText('1 / 4 designs')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('3,822')
    expect(document.body.textContent).not.toContain('99.9%')
    expect(document.body.textContent).not.toContain('74.7%')
  })

  it('reads a position segment as a position', async () => {
    // Both openlock designs must be counted, one of which is reached only
    // through `side|openlock`.
    renderAt('/settings')
    await waitFor(() => {
      expect(within(optionRow('OpenLOCK')).getByText('3 / 4 designs')).toBeInTheDocument()
    })
  })

  it('states the cost of every option that is not the best', async () => {
    renderAt('/settings')
    await waitFor(() => {
      expect(within(optionRow('DragonLock')).getByText(/hides 3/)).toBeInTheDocument()
    })
    expect(within(optionRow('Magnetic')).getByText(/hides 2/)).toBeInTheDocument()
    // The best option still hides one design here (the magnetic-only base), and
    // says so — but without a "0.0 pp behind itself" clause, which would be
    // gibberish. This is the case the real corpus also hits: openlock hides 5.
    expect(within(optionRow('OpenLOCK')).getByText('hides 1 · the fewest of the three')).toBeInTheDocument()
  })

  it('measures the spread over this catalog', async () => {
    renderAt('/settings')
    // 3/4 - 1/4 = 50.0 points, which only this fixture produces.
    await waitFor(() => {
      expect(screen.getByText('50.0 pp')).toBeInTheDocument()
    })
  })

  it('names every base’s lock system, and that none lacks one', async () => {
    renderAt('/settings')
    await waitFor(() => {
      expect(screen.getByText(/every one/i)).toBeInTheDocument()
    })
    // One base in the fixture, magnetic. Not 1,963 and not 1,141.
    expect(screen.getByText(/Magnetic 1/)).toBeInTheDocument()
  })

  it('still offers the choice when the index cannot be read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('nope', { status: 500 }))),
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    renderAt('/settings')

    await waitFor(() => {
      expect(screen.getByText(/could not be read/i)).toBeInTheDocument()
    })
    // The point: the setting still works. A network blip must not cost the user
    // the ability to record a preference the store does not need the catalog for.
    fireEvent.click(screen.getByRole('radio', { name: /magnetic/i }))
    expect(lockState().lock).toBe('magnetic')
    warn.mockRestore()
  })
})

/* -------------------------------------------------------------------- writing */

describe('picking a system', () => {
  it('writes the store, not just the radio', async () => {
    renderAt('/settings')
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /OpenLOCK/i })).toBeChecked()
    })

    fireEvent.click(screen.getByRole('radio', { name: /DragonLock/i }))

    expect(lockState().lock).toBe('dragonlock')
    expect(screen.getByRole('radio', { name: /DragonLock/i })).toBeChecked()
    expect(screen.getByRole('radio', { name: /OpenLOCK/i })).not.toBeChecked()
  })

  it('records that the user has now chosen', async () => {
    renderAt('/settings')
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /OpenLOCK/i })).toBeChecked()
    })
    expect(lockState().lockChosen).toBe(false)
    expect(screen.getByText(/you have not changed it/i)).toBeInTheDocument()

    // Re-picking the value already in effect still counts: the decision was made
    // even though the value did not move.
    fireEvent.click(screen.getByRole('radio', { name: /OpenLOCK/i }))
    expect(lockState().lockChosen).toBe(true)
    expect(screen.queryByText(/you have not changed it/i)).toBeNull()
  })

  it('shows the reach of what is in effect, and follows a change', async () => {
    renderAt('/settings')
    await waitFor(() => {
      expect(screen.getByText(/OpenLOCK · 3 of 4 designs reachable/)).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('radio', { name: /DragonLock/i }))
    expect(screen.getByText(/DragonLock · 1 of 4 designs reachable/)).toBeInTheDocument()
  })
})

/* --------------------------------------------------------------- consequences */

describe('what changing it does to a build in progress', () => {
  it('says nothing about warnings while the grid is empty', async () => {
    renderAt('/settings')
    await waitFor(() => {
      expect(screen.getByText(/Nothing is placed yet/i)).toBeInTheDocument()
    })
    expect(screen.queryByText('base-lock-mismatch')).toBeNull()
  })

  it('names the placements and the exact warnings once there are some', async () => {
    act(() => {
      placeTile({ tileId: TileId.parse(TILE_A), x: 0, z: 0, rotation: 0 })
      placeTile({ tileId: TileId.parse(TILE_A), x: 1, z: 0, rotation: 0 })
    })
    renderAt('/settings')

    await waitFor(() => {
      expect(screen.getByText(/tiles placed/i, { selector: '.of-set-note-lead' })).toBeInTheDocument()
    })
    expect(screen.getByText('2', { selector: '.of-set-mono' })).toBeInTheDocument()
    // The honesty requirement: the codes named here are the strings the bill of
    // tiles shows, so a user can recognise them there.
    expect(screen.getByText('base-lock-mismatch')).toBeInTheDocument()
    expect(screen.getByText('lock-unavailable')).toBeInTheDocument()
    // And it must not claim the scene is destroyed, because it is not.
    expect(screen.getByText(/keeps every one of them/i, { selector: '.of-set-note-lead' })).toBeInTheDocument()
  })

  it('describes the preference as a preference, not a filter', async () => {
    renderAt('/settings')
    await waitFor(() => {
      expect(screen.getByText(/preference, not a filter/i)).toBeInTheDocument()
    })
  })
})

/* --------------------------------------------------------------- the notice */

describe('the one-time notice', () => {
  /**
   * The notice needs a router — it links to `/settings` — and no route in the
   * app mounts it yet, so the host is built here.
   *
   * A throwaway root route rendering `<LockNotice/>` above an `<Outlet/>` is the
   * closest thing to how a real host will mount it (the builder shell, PR 18),
   * and it exercises the `Link` for real rather than stubbing the router. The
   * route tree is local to this test on purpose: adding a mount point to the app
   * means editing `src/ui/shell/AppFrame.tsx` or `src/builder/**`, and neither is
   * this PR's file.
   */
  function renderNotice() {
    const noticeRoot = createRootRoute({
      component: () => (
        <>
          <LockNotice />
          <Outlet />
        </>
      ),
    })
    const router = createRouter({
      routeTree: noticeRoot.addChildren([
        createRoute({ getParentRoute: () => noticeRoot, path: '/' }),
        createRoute({ getParentRoute: () => noticeRoot, path: '/settings' }),
      ]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    })
    return render(<RouterProvider router={router as unknown as WorkshopRouter} />)
  }

  it('states the reach of the current preference, measured', async () => {
    renderNotice()
    await waitFor(() => {
      expect(screen.getByText(/reaches 3 of 4 designs \(75\.0%\)/)).toBeInTheDocument()
    })
  })

  it('dismisses without changing the lock system', async () => {
    renderNotice()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /keep openlock/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /keep openlock/i }))

    expect(lockState().lockChosen).toBe(true)
    expect(lockState().lock).toBe('openlock')
    expect(screen.queryByRole('button', { name: /keep openlock/i })).toBeNull()
  })

  it('is absent once the choice has been made anywhere', () => {
    act(() => {
      setLockSystem('magnetic')
    })
    renderNotice()
    expect(screen.queryByLabelText('Lock system')).toBeNull()
  })

  it('leads to the settings screen', async () => {
    renderNotice()
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /compare the three/i })).toHaveAttribute('href', '/settings')
    })
  })
})
