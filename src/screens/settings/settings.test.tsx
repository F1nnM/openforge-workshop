// @vitest-environment jsdom
/**
 * Settings screen tests.
 *
 * Rendered through the **real router** over `createMemoryHistory()`, with the
 * **real store** and a stubbed `fetch` serving a fixture index. The only stub is
 * the network, for the same reason the landing and library suites stub it: the
 * index is a 5.6 MB build artefact.
 *
 * The fixture's figures are deliberately nothing like the real archive's — **5
 * designs** — so if `3,822`, `99.9%`, `74.7%`, `59.7%` or `88.3%` ever appears on
 * screen during these tests, something has hard-coded a number that is supposed
 * to be measured. That is the failure this file exists to catch: the plan's first
 * draft put the cost of this choice at 0.1 points and was wrong by two orders of
 * magnitude, and a constant in the UI is exactly how a stale figure survives a
 * rescan.
 *
 * **The screen states two figures per option and they are different questions.**
 * *Buildable* is what the app can resolve into a complete printable assembly;
 * *in the archive* is what the tags say. On the real corpus they disagree by up
 * to 19 points and in opposite directions per system, so a screen that printed
 * one where the other belongs would look entirely plausible. The fixture is built
 * so that they differ on every row and the assertions name which is which.
 *
 * Every share is distinct within a reading on purpose: a tie would make "which
 * option builds furthest" depend on the name tie-break, and the assertions below
 * would then be testing the tie-break rather than the screen.
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
import { LockNotice, resetLockBuild } from '@/ui/lock-picker'
import { CatalogStatsProvider, resetCatalogIndexCache } from '@/ui/shell'

/* ------------------------------------------------------------------ fixture */

const TILE_A = 'tiles/cave/floors/floor/openlock/cave#floor.2x2.openlock.stl'

/**
 * Five designs across six records, carrying **both** connection forms.
 *
 * Each record's `conn` is the flattened field `@/ui/lock-picker/reach.ts` reads
 * and its `tags` carry the raw `connection|…` tags the aggregate's positional
 * projection reads. Both, from one source, because the buildability derivation
 * needs the second: a fixture with a populated `conn` and no connection tags —
 * which this was, and which nothing noticed while only reachability was on
 * screen — reports every design as unbuildable in every system.
 *
 * | design       | what it is                              | reachable under | buildable under |
 * | ------------ | --------------------------------------- | --------------- | --------------- |
 * | `d-open`     | two openlock integrals, one of them tagged `side\|openlock` | openlock | openlock |
 * | `d-open2`    | an openlock integral                    | openlock | openlock |
 * | `d-mag`      | a magnetic base, `rect:2x2`             | magnetic | magnetic |
 * | `d-free`     | a `wall:2` topper with no lock at all   | all three | openlock, via `d-basewall` |
 * | `d-basewall` | an openlock base, `wall:2`              | openlock | openlock |
 *
 * So reachability is openlock 4/5, magnetic 2/5, dragonlock 1/5 and buildability
 * is openlock 4/5, magnetic 1/5, dragonlock 0/5 — `2 of 5`, `1 of 5`, `80.0 pp`
 * and `60.0 pp` are strings only this fixture can produce, and every value is
 * distinct within its own reading so no assertion below rests on a name
 * tie-break.
 *
 * The magnetic and dragonlock rows are where the two readings separate: magnetic
 * reaches 2 and builds 1, dragonlock reaches 1 and builds 0. A screen that
 * printed one figure where the other belongs fails on those two rows.
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
    lod: 'https://objects.example.test/lod',
  },
  sprite: { rows: 2, cols: 5, tile: 512, frames: 10, defaultFrame: 0 },
  tags: [
    'texture|cave',
    'shape|floor',
    'shape|base',
    'connection|openlock',
    'connection|side|openlock',
    'connection|magnetic',
    'connection|openforge',
    'shape|wall',
  ],
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
      tags: [0, 1, 3],
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
      tags: [0, 1, 4],
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
      tags: [0, 1, 3],
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
      tags: [0, 2, 5],
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
      tags: [0, 7, 6],
      foot: { shape: 'wall', length: 2 },
      rotStep: 90,
    },
    {
      // The base that makes `d-free` buildable, and the only reason the two
      // spreads on this screen differ from each other: without it every system
      // loses exactly one design to buildability and the two figures coincide,
      // which would let a bug that printed one where the other belongs pass.
      id: 'tiles/cave/bases/base/openlock/cave#base+wall.2.openlock.stl',
      ord: 5,
      blob: 'f'.repeat(32),
      file: 'cave#base+wall.2.openlock.stl',
      bytes: 1_000_000,
      sprite: true,
      family: 'tiles/cave/bases/base/openlock',
      design: 'd-basewall',
      name: 'Cave Wall Base 2',
      kinds: ['base'],
      conn: ['openlock'],
      layer: 'base',
      texture: 'cave',
      tags: [0, 2, 3],
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
  resetLockBuild()
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(RAW_INDEX), { status: 200 }))),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetCatalogIndexCache()
  resetLockBuild()
  resetWorkshop()
})

/** The `<label>` for one option, which is the whole clickable row. */
function optionRow(name: string): HTMLElement {
  return screen.getByRole('radio', { name: new RegExp(name, 'i') }).closest('label') as HTMLElement
}

/* ------------------------------------------------------------------- figures */

describe('the two figures', () => {
  it('come from the index, not from a constant', async () => {
    renderAt('/settings')

    // Five designs in the fixture; the real archive has 3,822. If the screen
    // ever shows the latter, it is reading the plan rather than the index.
    await waitFor(() => {
      expect(within(optionRow('OpenLOCK')).getByText('4 of 5')).toBeInTheDocument()
    })
    expect(document.body.textContent).not.toContain('3,822')
    expect(document.body.textContent).not.toContain('99.9%')
    expect(document.body.textContent).not.toContain('74.7%')
    expect(document.body.textContent).not.toContain('88.3%')
  })

  it('states buildability and reachability as different numbers, per option', async () => {
    renderAt('/settings')
    await waitFor(() => {
      expect(within(optionRow('Magnetic')).getByText('buildable')).toBeInTheDocument()
    })

    // Magnetic reaches two designs and can build one; DragonLock reaches one and
    // can build none. Both rows would look plausible with the two figures
    // swapped, which is why they are asserted as a pair rather than singly.
    const magnetic = within(optionRow('Magnetic'))
    expect(magnetic.getByText('1 of 5')).toBeInTheDocument()
    expect(magnetic.getByText('2 of 5 · 40.0%')).toBeInTheDocument()

    const dragonlock = within(optionRow('DragonLock'))
    expect(dragonlock.getByText('0 of 5')).toBeInTheDocument()
    expect(dragonlock.getByText('1 of 5 · 20.0%')).toBeInTheDocument()
  })

  it('orders the options by what they can build', async () => {
    renderAt('/settings')
    await waitFor(() => {
      expect(screen.getAllByRole('radio')).toHaveLength(3)
    })
    // Buildable 4 / 1 / 0. Reachability would order them 4 / 2 / 1 — the same
    // order in this fixture, but read off the other field.
    expect(screen.getAllByRole('radio').map((radio) => (radio as HTMLInputElement).value)).toEqual([
      'openlock',
      'magnetic',
      'dragonlock',
    ])
  })

  it('says how many of the buildable designs need no separate base', async () => {
    renderAt('/settings')
    // Three of openlock's four are one-part prints: two integrals and the base.
    // Magnetic's single buildable design is its own base, so one.
    await waitFor(() => {
      expect(within(optionRow('OpenLOCK')).getByText('3 need no base')).toBeInTheDocument()
    })
    expect(within(optionRow('Magnetic')).getByText('1 need no base')).toBeInTheDocument()
    expect(within(optionRow('DragonLock')).getByText('0 need no base')).toBeInTheDocument()
  })

  it('reads a position segment as a position', async () => {
    // Both openlock designs must be counted, one of which is reached only
    // through `side|openlock`. Reachability is the reading that shows it: the
    // aggregate counts a side lock as neighbour joinery, never as a base.
    renderAt('/settings')
    await waitFor(() => {
      expect(within(optionRow('OpenLOCK')).getByText('4 of 5 · 80.0%')).toBeInTheDocument()
    })
  })

  it('states the cost of every option that is not the best', async () => {
    renderAt('/settings')
    await waitFor(() => {
      expect(within(optionRow('DragonLock')).getByText(/^5 out of reach/)).toBeInTheDocument()
    })
    expect(within(optionRow('DragonLock')).getByText(/80\.0 pp behind OpenLOCK/)).toBeInTheDocument()
    expect(within(optionRow('Magnetic')).getByText(/60\.0 pp behind OpenLOCK/)).toBeInTheDocument()
    // The best option still leaves one design out here, and says so — but
    // without a "0.0 pp behind itself" clause, which would be gibberish. This is
    // the case the real corpus also hits: openlock cannot build 447.
    expect(within(optionRow('OpenLOCK')).getByText('1 out of reach · the fewest of the three')).toBeInTheDocument()
  })

  it('measures both spreads, and does not print one for the other', async () => {
    renderAt('/settings')
    // Buildable 4/5 − 0/5 = 80.0 points; in the archive 4/5 − 1/5 = 60.0. Only
    // this fixture produces that pair, and only a screen reading the right field
    // for each produces both. Asserted on the sentence rather than on the two
    // figures alone, because "60.0 pp" is also what the second-best option costs
    // here and the point is which figure sits where.
    await waitFor(() => {
      expect(screen.getByText('80.0 pp')).toBeInTheDocument()
    })
    expect(document.body.textContent).toContain('80.0 pp between the best and worst option, over 5 designs')
    expect(document.body.textContent).toContain('against 60.0 pp if you go by the archive’s tags alone')
    expect(document.body.textContent).toContain('costs 60.0 pp of what you can build, not the 40.0 pp')
  })

  it('names every base’s lock system, and that none lacks one', async () => {
    renderAt('/settings')
    await waitFor(() => {
      expect(screen.getByText(/every one/i)).toBeInTheDocument()
    })
    // Two bases in the fixture, one each, and the zero rendered as a zero.
    // Not 1,963 and not 1,141. The list is one span per system, so this reads
    // the assembled text rather than a single node.
    expect(document.body.textContent).toContain('(OpenLOCK 1 · Magnetic 1 · DragonLock 0)')
  })

  it('states the side-connector asymmetry rather than showing a dead chip', async () => {
    renderAt('/settings')
    // One design carries `connection|side|openlock`; neither of the others
    // carries a side connector at all. In the real archive magnetic is the
    // permanent zero — the reason this is one sentence and not three badges.
    await waitFor(() => {
      expect(screen.getByText(/Not one design carries edge-to-edge joinery in Magnetic or DragonLock/)).toBeInTheDocument()
    })
    expect(document.body.textContent).toContain('(OpenLOCK 1 · Magnetic 0 · DragonLock 0)')
  })

  it('says nothing about a floor when every design is buildable somewhere', async () => {
    renderAt('/settings')
    await waitFor(() => {
      expect(within(optionRow('OpenLOCK')).getByText('4 of 5')).toBeInTheDocument()
    })
    // All five fixture designs build under something, so the "no option reaches
    // these" paragraph is absent rather than reading "0 of 5".
    expect(screen.queryByText(/cannot be completed under/)).toBeNull()
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

  it('shows what is in effect can build, and follows a change', async () => {
    renderAt('/settings')
    await waitFor(() => {
      expect(screen.getByText(/OpenLOCK · 4 of 5 designs buildable · 4 named in the archive/)).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('radio', { name: /DragonLock/i }))
    // Both readings follow, and they part company here: nothing builds in
    // DragonLock in this fixture while one design still names it.
    expect(screen.getByText(/DragonLock · 0 of 5 designs buildable · 1 named in the archive/)).toBeInTheDocument()
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

  it('states what the current preference can build, measured', async () => {
    renderNotice()
    // The same figure the picker one click away leads with. It used to quote
    // reachability, which meant the number dropped when you followed the link.
    await waitFor(() => {
      expect(screen.getByText(/can build 4 of 5 designs \(80\.0%\)/)).toBeInTheDocument()
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
