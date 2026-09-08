// @vitest-environment jsdom
/**
 * The lock control in the builder's work area, and the one-time notice.
 *
 * **This file is row L1's relocation of `src/screens/settings/settings.test.tsx`,
 * fixture and all.** The screen it tested is deleted; the *subject* — one global
 * preference whose cost has two correct measurements that disagree — moved into
 * `LockToggle`, so the suite moved with it rather than being rewritten. Every
 * assertion below that also existed on the screen is there because it caught
 * something once, and the two that no longer have a target are recorded as
 * deletions rather than dropped quietly (see `what row L1 dropped`).
 *
 * ## Rendered with the real store and no router
 *
 * The only stub is the network, for the reason the landing and library suites
 * stub it: the index is a 5.6 MB build artefact. **The router is gone from this
 * suite**, and that is a consequence rather than a simplification — the notice
 * used to render a `<Link to="/settings">` and needed a route tree to resolve it,
 * and nothing in the lock UI navigates any more.
 *
 * The fixture's figures are deliberately nothing like the real archive's — **5
 * designs** — so if `3,822`, `99.9%`, `74.7%`, `59.7%` or `88.3%` ever appears on
 * screen during these tests, something has hard-coded a number that is supposed
 * to be measured. That is the failure this file exists to catch: the plan's first
 * draft put the cost of this choice at 0.1 points and was wrong by two orders of
 * magnitude, and a constant in the UI is exactly how a stale figure survives a
 * rescan.
 *
 * **The control states two figures per option and they are different questions.**
 * *Buildable* is what the app can resolve into a complete printable assembly;
 * *in the archive* is what the tags say. On the real corpus they disagree by up
 * to 19 points and in opposite directions per system, so a surface that printed
 * one where the other belongs would look entirely plausible. The fixture is built
 * so that they differ on every row and the assertions name which is which.
 *
 * Every share is distinct within a reading on purpose: a tie would make "which
 * option builds furthest" depend on the name tie-break, and the assertions below
 * would then be testing the tie-break rather than the control.
 *
 * ## What these tests prove, and what they cannot
 *
 * They prove the numbers, the store writes, the ordering, the conditional copy
 * and the notice's two actions. **They prove nothing about whether any of it is
 * visible.** jsdom applies no CSS, rasterises nothing and reports every element
 * as 0 x 0, so no test here can tell whether the trigger is clipped by the
 * stage's overflow, whether the disclosure is positioned on screen, or whether the
 * control overlaps the toolbar it sits beside. Row L1 measured those three in
 * Chrome for Testing 148 and wrote the numbers into
 * `src/screens/builder/builder.css`; there is no way to hold them from here.
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
 *   - **The notice's new action moves focus to the control** — it used to
 *     navigate to `/settings` — **and dismisses without one on the page**, which
 *     is the branch a host on the download path would hit.
 *   - **The consequences copy is conditional on there being a scene.** Telling a
 *     user with an empty grid what switching costs a build is noise; not telling
 *     a user with forty pieces placed is dishonest.
 *
 * Row **A8** re-aimed that last pair. The copy named `base-lock-mismatch` as the
 * flag a user would meet in the bill, and row A3 deleted that note code with the
 * auto-insert that emitted it — so the assertion was guarding a string no bill
 * can produce. `lock-unavailable` is the one code that survives, and it is what
 * is asserted now; `LockToggle.tsx` carries the argument for the rewritten
 * sentence.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TileId } from '@/catalog'
import {
  clearPersistedWorkshopState,
  placeTemplate,
  resetWorkshop,
  setLockSystem,
  useWorkshopStore,
} from '@/store'
import { aTemplateInstance } from '@/store/fixture'
import { LockToggle, resetLockBuild } from '@/ui/lock-picker'
import { resetCatalogIndexCache } from '@/ui/shell'

/* ------------------------------------------------------------------ fixture */

const TILE_A = TileId.parse('tiles/cave/floors/floor/openlock/cave#floor.2x2.openlock.stl')

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
      thumb: false,
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
      thumb: false,
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
      thumb: false,
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
      thumb: false,
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
      thumb: false,
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
      thumb: false,
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

/** The trigger, which is the whole always-visible control. */
function trigger(): HTMLElement {
  return screen.getByRole('button', { name: /^Lock system: / })
}

/**
 * Render the control and open its disclosure.
 *
 * The picker is behind a press now rather than being a screen, so every figure
 * assertion needs the disclosure open. Awaiting the build first is deliberate:
 * the trigger renders before `deriveLockBuild` resolves and a disclosure opened in that
 * window would mount `LockPicker` with `build === null`, which is a real state
 * with its own test below and not the one these assertions are about.
 */
async function openDisclosure() {
  render(<LockToggle />)
  await waitFor(() => {
    expect(trigger()).toHaveAccessibleName(/designs buildable/)
  })
  fireEvent.click(trigger())
  await waitFor(() => {
    expect(screen.getAllByRole('radio')).toHaveLength(3)
  })
}

/**
 * Close the disclosure and wait for the page behind it to come back.
 *
 * **The trigger is unreachable while the disclosure is open**, and that is not a
 * quirk of the test environment — it is what "modal" means. `Dialog` marks
 * everything behind the popup inert, so `getByRole` cannot see the trigger until
 * the overlay is gone. Any assertion about what the trigger *says* therefore has
 * to close it first, which is why this helper exists rather than each test
 * poking at the close button.
 *
 * It also asserts the one property that makes a modal acceptable for this
 * control: focus comes back to the trigger. A user who opened the comparison
 * from the keyboard, read it and closed it is returned to where they were rather
 * than to the top of the document.
 */
async function closeDisclosure() {
  fireEvent.click(screen.getByRole('button', { name: /close the lock comparison/i }))
  await waitFor(() => {
    expect(screen.queryByRole('radio')).toBeNull()
  })
  expect(document.activeElement).toBe(trigger())
}

/** The `<label>` for one option, which is the whole clickable row. */
function optionRow(name: string): HTMLElement {
  return screen.getByRole('radio', { name: new RegExp(name, 'i') }).closest('label') as HTMLElement
}

/* ------------------------------------------------------------------- figures */

describe('the two figures', () => {
  it('come from the index, not from a constant', async () => {
    await openDisclosure()

    // Five designs in the fixture; the real archive has 3,822. If the control
    // ever shows the latter, it is reading the plan rather than the index.
    expect(within(optionRow('OpenLOCK')).getByText('4 of 5')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('3,822')
    expect(document.body.textContent).not.toContain('99.9%')
    expect(document.body.textContent).not.toContain('74.7%')
    expect(document.body.textContent).not.toContain('88.3%')
  })

  it('states buildability and reachability as different numbers, per option', async () => {
    await openDisclosure()

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
    await openDisclosure()
    // Buildable 4 / 1 / 0. Reachability would order them 4 / 2 / 1 — the same
    // order in this fixture, but read off the other field.
    expect(screen.getAllByRole('radio').map((radio) => (radio as HTMLInputElement).value)).toEqual([
      'openlock',
      'magnetic',
      'dragonlock',
    ])
  })

  it('says how many of the buildable designs need no separate base', async () => {
    await openDisclosure()
    // Three of openlock's four are one-part prints: two integrals and the base.
    // Magnetic's single buildable design is its own base, so one.
    //
    // **This is the correction the trigger's single figure needs and the reason
    // it is not optional.** Buildability flatters magnetic by 19 points on the
    // real corpus precisely because an auto-inserted base supplies the joinery,
    // and `need no base` is the number that runs the other way and says so.
    expect(within(optionRow('OpenLOCK')).getByText('3 need no base')).toBeInTheDocument()
    expect(within(optionRow('Magnetic')).getByText('1 need no base')).toBeInTheDocument()
    expect(within(optionRow('DragonLock')).getByText('0 need no base')).toBeInTheDocument()
  })

  it('reads a position segment as a position', async () => {
    // Both openlock designs must be counted, one of which is reached only
    // through `side|openlock`. Reachability is the reading that shows it: the
    // aggregate counts a side lock as neighbour joinery, never as a base.
    await openDisclosure()
    expect(within(optionRow('OpenLOCK')).getByText('4 of 5 · 80.0%')).toBeInTheDocument()
  })

  it('states the cost of every option that is not the best', async () => {
    await openDisclosure()
    expect(within(optionRow('DragonLock')).getByText(/^5 out of reach/)).toBeInTheDocument()
    expect(within(optionRow('DragonLock')).getByText(/80\.0 pp behind OpenLOCK/)).toBeInTheDocument()
    expect(within(optionRow('Magnetic')).getByText(/60\.0 pp behind OpenLOCK/)).toBeInTheDocument()
    // The best option still leaves one design out here, and says so — but
    // without a "0.0 pp behind itself" clause, which would be gibberish. This is
    // the case the real corpus also hits: openlock cannot build 447.
    expect(within(optionRow('OpenLOCK')).getByText('1 out of reach · the fewest of the three')).toBeInTheDocument()
  })

  it('measures both spreads, and does not print one for the other', async () => {
    await openDisclosure()
    // Buildable 4/5 − 0/5 = 80.0 points; in the archive 4/5 − 1/5 = 60.0. Only
    // this fixture produces that pair, and only a surface reading the right field
    // for each produces both. Asserted on the sentence rather than on the two
    // figures alone, because "60.0 pp" is also what the second-best option costs
    // here and the point is which figure sits where.
    expect(screen.getByText('80.0 pp')).toBeInTheDocument()
    expect(document.body.textContent).toContain('80.0 pp between the best and worst option, over 5 designs')
    expect(document.body.textContent).toContain('against 60.0 pp if you go by the archive’s tags alone')
    expect(document.body.textContent).toContain('costs 60.0 pp of what you can build, not the 40.0 pp')
  })

  it('states the side-connector asymmetry rather than showing a dead chip', async () => {
    await openDisclosure()
    // One design carries `connection|side|openlock`; neither of the others
    // carries a side connector at all. In the real archive magnetic is the
    // permanent zero — the reason this is one sentence and not three badges.
    expect(screen.getByText(/not one design does that in Magnetic or DragonLock/i)).toBeInTheDocument()
    expect(document.body.textContent).toContain('(OpenLOCK 1 · Magnetic 0 · DragonLock 0)')
  })

  it('says nothing about a floor when every design is buildable somewhere', async () => {
    await openDisclosure()
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
    render(<LockToggle />)

    // The trigger renders at once and shows a dash where the share goes, which
    // is the state `LockPicker` documents: the choice does not depend on the
    // catalog.
    fireEvent.click(trigger())
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

/* ------------------------------------------------------------------- trigger */

describe('the always-visible control', () => {
  /**
   * The trigger shows **buildability**, which is the unflattering figure for the
   * default and the whole reason this is asserted rather than eyeballed.
   *
   * openlock builds 4 of 5 here and *names* 4 of 5 too, so the fixture cannot
   * separate the two on that row — which is why the second half of this test
   * switches to DragonLock, where they part company: 0 buildable against 1 named.
   * A trigger quoting reachability would read `20.0%` there.
   */
  it('quotes buildability and not the archive figure', async () => {
    render(<LockToggle />)
    await waitFor(() => {
      expect(trigger()).toHaveAccessibleName('Lock system: OpenLOCK, 4 of 5 designs buildable (80.0%). Compare the three options.')
    })

    act(() => {
      setLockSystem('dragonlock')
    })
    expect(trigger()).toHaveAccessibleName('Lock system: DragonLock, 0 of 5 designs buildable (0.0%). Compare the three options.')
    // Reachability for dragonlock in this fixture. If it ever appears here the
    // trigger has switched fields.
    expect(trigger()).not.toHaveAccessibleName(/20\.0%/)
  })

  it('shows the figure visually as well as in its name, and follows a change', async () => {
    render(<LockToggle />)
    await waitFor(() => {
      expect(screen.getByText('80.0%')).toBeInTheDocument()
    })
    expect(screen.getByText('OpenLOCK')).toBeInTheDocument()

    act(() => {
      setLockSystem('magnetic')
    })
    expect(screen.getByText('Magnetic')).toBeInTheDocument()
    // Magnetic builds 1 of 5 here.
    expect(screen.getByText('20.0%')).toBeInTheDocument()
  })

  /**
   * The no-figures state, asserted **after** the load has failed rather than
   * before it has finished.
   *
   * The obvious version of this test renders and asserts `Figures unknown`
   * immediately — and it cannot fail, because that is also what the trigger says
   * for the first tick of a *successful* load. Waiting for `useLockBuild`'s own
   * warning is what pins the assertion to the failure: the hook logs it only on
   * a rejection and only while mounted, so by the time it has fired the fetch
   * has been answered and the trigger has had every chance to show a figure.
   */
  it('names the figures unknown rather than showing a stale one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('nope', { status: 500 }))),
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<LockToggle />)

    await waitFor(() => {
      expect(warn).toHaveBeenCalledWith('lock buildability unavailable', expect.anything())
    })

    expect(trigger()).toHaveAccessibleName(/Figures unknown/)
    expect(screen.getByText('—')).toBeInTheDocument()
    warn.mockRestore()
  })
})

/* -------------------------------------------------------------------- writing */

describe('picking a system', () => {
  it('writes the store, not just the radio', async () => {
    await openDisclosure()
    expect(screen.getByRole('radio', { name: /OpenLOCK/i })).toBeChecked()

    fireEvent.click(screen.getByRole('radio', { name: /DragonLock/i }))

    expect(lockState().lock).toBe('dragonlock')
    expect(screen.getByRole('radio', { name: /DragonLock/i })).toBeChecked()
    expect(screen.getByRole('radio', { name: /OpenLOCK/i })).not.toBeChecked()
  })

  it('records that the user has now chosen', async () => {
    await openDisclosure()
    expect(lockState().lockChosen).toBe(false)

    // Re-picking the value already in effect still counts: the decision was made
    // even though the value did not move. `LockPicker` carries the `onClick` that
    // makes it recordable, because a controlled radio already checked fires no
    // `change` event.
    fireEvent.click(screen.getByRole('radio', { name: /OpenLOCK/i }))
    expect(lockState().lockChosen).toBe(true)
  })

  it('moves the trigger with the choice, so the two cannot disagree', async () => {
    await openDisclosure()
    fireEvent.click(screen.getByRole('radio', { name: /DragonLock/i }))
    await closeDisclosure()
    // The control and the thing it controls are one store read apart, which is
    // the reason `LockToggle` takes no props.
    expect(trigger()).toHaveAccessibleName(/DragonLock, 0 of 5 designs buildable/)
  })
})

/* --------------------------------------------------------------- consequences */

describe('what changing it does to a build in progress', () => {
  it('says nothing about warnings while the grid is empty', async () => {
    await openDisclosure()
    expect(screen.getByText(/Nothing is placed yet/i)).toBeInTheDocument()
    expect(screen.queryByText('lock-unavailable')).toBeNull()
  })

  it('names the placements and the exact warnings once there are some', async () => {
    act(() => {
      // A template instance, since row A1 — the placed unit is a recipe with a
      // fill per slot, and this control's copy is about what a change of
      // preference does to those fills.
      placeTemplate(aTemplateInstance({ x: 0, z: 0 }))
      placeTemplate(aTemplateInstance({ x: 1, z: 0 }))
    })
    await openDisclosure()

    expect(screen.getByText(/pieces placed/i, { selector: '.of-lock-pop-note-lead' })).toBeInTheDocument()
    expect(screen.getByText('2', { selector: '.of-lock-pop-mono' })).toBeInTheDocument()
    // The honesty requirement, unchanged in substance: every code named here is
    // one the bill of tiles can actually show, so a user can recognise it there.
    // `base-lock-mismatch` was the other one and row A3 deleted it — see the
    // module note.
    expect(screen.getByText('lock-unavailable')).toBeInTheDocument()
    // And it must not claim the scene is destroyed, because it is not.
    expect(screen.getByText(/keeps every one of them/i, { selector: '.of-lock-pop-note-lead' })).toBeInTheDocument()
  })

  it('describes the preference as a preference, not a filter', async () => {
    await openDisclosure()
    expect(screen.getByText(/preference, not a filter/i)).toBeInTheDocument()
  })
})

/* ------------------------------------------------------ what row L1 dropped */

describe('what the disclosure dropped relative to the 300-word screen', () => {
  /**
   * Asserted as an absence, on purpose.
   *
   * The deleted screen carried `BaseFacts`: a per-system tally of how many
   * catalogued bases carry each lock system, and the point that **zero** carry
   * none, so *"there is no neutral base to fall back on"*. Row L1 dropped it —
   * the picker's three different measured numbers make the same point, and the
   * corpus tally is not what a disclosure like this is for.
   *
   * This test exists so the drop is a decision in the suite rather than a hole.
   * If a later row wants that fact back, this is the test that tells them it was
   * removed deliberately and where the argument is; and if somebody
   * reintroduces the tally, it fails and they have to say why.
   *
   * `(OpenLOCK 1 · Magnetic 1 · DragonLock 0)` is the base tally over this
   * fixture — the side-joinery sentence prints the same shape with different
   * numbers (`Magnetic 0`), which is why this asserts the base line's own text
   * and not merely the absence of a parenthesised list.
   */
  it('no longer states the per-system base tally', async () => {
    await openDisclosure()
    expect(document.body.textContent).not.toContain('(OpenLOCK 1 · Magnetic 1 · DragonLock 0)')
    expect(screen.queryByText(/delegates its joinery to a separately printed base/i)).toBeNull()
    expect(screen.queryByText(/no neutral base/i)).toBeNull()
  })

  /**
   * The screen's `CurrentSummary` line said what was in effect and what it could
   * build. The trigger says both, permanently, so the line is gone rather than
   * relocated — including its "the default; you have not changed it" tail, which
   * the notice now carries by existing at all.
   */
  it('no longer prints a separate "in effect" line, because the trigger is one', async () => {
    await openDisclosure()
    expect(screen.queryByText(/you have not changed it/i)).toBeNull()
    expect(screen.queryByText(/named in the archive/i)).toBeNull()
    // The information did not vanish with the line.
    await closeDisclosure()
    expect(trigger()).toHaveAccessibleName(/OpenLOCK, 4 of 5 designs buildable/)
  })
})
