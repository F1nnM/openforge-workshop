// @vitest-environment jsdom
/**
 * The three panels, rendered.
 *
 * Nothing is mocked that has a real implementation available. The **real store**
 * (so a placement goes through `placeTemplate`'s Zod parse), the **real facet
 * engine** over a nine-record fixture through the **real `CatalogFile.parse`**,
 * the **real assembly resolver** over the two recipes in `fixture.ts`, and the
 * **real archive planner** (so an entry name is the one the zip would carry).
 *
 * ## What row A8 deleted from this file, and why it is a deletion
 *
 * Two whole blocks — **`the missing-base gap`** (6 tests) and **`variant
 * resolution in the bill`** (8) — plus three cases in the bill block. Every one
 * of them asserted a sentence the panel can no longer be handed, and the facts
 * behind them are not moved but gone:
 *
 *   - the three base-gap notes, the `base · added` mark, the print-variant
 *     disclosure and `base-already-on-plan` were rule 1's. **Nothing inserts a
 *     base**: a recipe declares one as an ordinary slot, so there is no
 *     auto-insert to disclose and `NoteCode` lost all eight codes.
 *   - the `Resolved for openlock` summary, the per-row `openlock · one part`
 *     marks and the `published as 2 files` copy were rule 0's. **A fill names an
 *     exact file**, so nothing chooses at resolution time and `VariantResolution`
 *     no longer exists to read a verdict off.
 *
 * They are not rewritten here, because what replaces them is row **C4**'s
 * question — what a bill should say about a *fill* — and answering it in this row
 * would be inventing the panel C4 owns. `assembly/assembly.test.ts` already holds
 * the resolver-side facts (`fill-off-slot`, `slot-unfilled`, `complete`), and
 * `billView.ts`'s own docblock records the deletion with the measurements.
 *
 * What arrived in their place is one test per new surface: the empty-slot note,
 * the download's refusal of an incomplete scene, and the reduced palette.
 *
 * Two seams are injected, and both are ones `@/download` publishes for exactly
 * this: {@link SaveEnvironment} and {@link BlobSource}. That is what lets every
 * download failure be exercised without a network and without a browser that can
 * save a file — which is the whole point of the table in
 * `useArchiveDownload.ts`. Injecting them is not stubbing our code; it is using
 * the parameters that module was designed around.
 *
 * There is deliberately **no test of the work surface here.** What this file
 * asserts about it is one thing only — that selecting a palette row arms it,
 * which is the contract between the palette and whichever renderer draws the
 * room. Row **R4** deleted `../canvas/canvas.test.tsx` with the plan canvas it
 * covered; the surface's own behaviour is in `src/builder/three/**`.
 */
import { TextEncoder as NodeTextEncoder } from 'node:util'

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useMemo } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AssemblyIndex, BillOfTiles } from '@/assembly'
import { buildAssemblyIndex, buildBillOfTiles } from '@/assembly'
import { usePlanTools } from '@/builder/canvas'
import type { SurfaceStatus } from '@/builder/three'
import type { CatalogFile, DesignId } from '@/catalog'
import { CatalogFile as CatalogFileSchema, resolveTags, selectVariant } from '@/catalog'
import type { BlobSource, SaveEnvironment } from '@/download'
import { BlobFetchError, PreviewMeshRefusedError } from '@/download'
import { createSearchEngine, defaultFacetSearch } from '@/search'
import { resolveMaterial } from '@/materials'
import type { CatalogIndex } from '@/screens/catalog'
import {
  TemplateId,
  clearPendingDesign,
  clearPersistedWorkshopState,
  placeTemplate,
  resetWorkshop,
  sendDesignToBuilder,
  setLockSystem,
  usePlacements,
  useSelectionStore,
  useWorkshopStore,
} from '@/store'

import { BillPanel } from './BillPanel'
import {
  FIXTURE_CATALOG,
  FIXTURE_DESIGNS,
  FIXTURE_IDS,
  FIXTURE_NAMES,
  MIXED_INTEGRAL,
  ONE_SLOT_TEMPLATE_ID,
  aStrictInstance,
  anInstance,
  fixtureContext,
  fixtureCatalogFile,
  mixedCatalogFile,
} from './fixture'
import { searchRows } from './palette'
import { PalettePanel } from './PalettePanel'
import { PlanToolbar } from './PlanToolbar'
import { useArchiveDownload } from './useArchiveDownload'
import type { ArchiveDownload } from './useArchiveDownload'
import { DownloadAction } from './DownloadAction'

/* ------------------------------------------------------------------ scaffold */

/**
 * The design behind a fixture key.
 *
 * The selection channel is design-keyed since row V1, a palette row is an item
 * since row V3, and a **placement** is one since row V4 — so everything that used
 * to be `id(…)` in this file is now `design(…)`. `id` survives for the assertions
 * that are genuinely about a file: which entry a download pack writes, which
 * record a bill line names, which blob a thumb loads.
 */
const design = (key: keyof typeof FIXTURE_DESIGNS): DesignId => FIXTURE_DESIGNS[key] as DesignId

let file: CatalogFile
let index: CatalogIndex
let assembly: AssemblyIndex

beforeEach(() => {
  resetWorkshop()
  clearPersistedWorkshopState()
  file = fixtureCatalogFile()
  const engine = createSearchEngine(file)
  index = {
    file,
    engine,
    tagsFor: (record) => resolveTags(file, record),
    materialOf: (record) => resolveMaterial(resolveTags(file, record), record.file).material,
  }
  assembly = buildAssemblyIndex(file)
})

afterEach(() => {
  resetWorkshop()
  clearPersistedWorkshopState()
  vi.unstubAllGlobals()
})

/**
 * Place one file, as a one-slot instance.
 *
 * The unit changed and the helper's shape did not: a test still names a fixture
 * key and a cell, and what reaches the store is `fixture.ts`'s one-slot recipe
 * with that file in its only slot. That keeps every assertion below about one
 * file per placement, which is what they were written for — {@link placeBoth} is
 * the two-slot case, added for the one thing a one-slot recipe cannot express.
 */
function place(key: keyof typeof FIXTURE_IDS, x = 0, z = 0): void {
  act(() => {
    placeTemplate(anInstance([FIXTURE_IDS[key]], { x, z }))
  })
}

/** One instance of the two-slot recipe, so a bill has more parts than placements. */
function placeBoth(a: keyof typeof FIXTURE_IDS, b: keyof typeof FIXTURE_IDS, x = 0, z = 0): void {
  act(() => {
    placeTemplate(anInstance([FIXTURE_IDS[a], FIXTURE_IDS[b]], { x, z }))
  })
}

/**
 * One instance of the two-slot recipe with its second slot left open.
 *
 * Contract **C-g**: §3.2 places a template with a part still empty, so this is
 * an ordinary state of an instance and not a corrupt one — and it is the state
 * `slot-unfilled` and the download's refusal are both about.
 */
function placeHalf(a: keyof typeof FIXTURE_IDS, x = 0, z = 0): void {
  act(() => {
    placeTemplate(anInstance([FIXTURE_IDS[a], null], { x, z }))
  })
}

function placementCount(): number {
  return Object.keys(useWorkshopStore.getState().placements).length
}

/* -------------------------------------------------------------- the palette */

/**
 * The palette, plus a readout of the tool state it writes.
 *
 * **The armed readout comes out of the DOM now, not out of `PlanTools`.** Row A8
 * reduced the panel: `usePlanTools` holds a `selectedTemplate` and this list
 * holds no template families, so the selection is the panel's own state and
 * `aria-pressed` is the only place it is observable. That is the honest place to
 * assert it from — it is also the only place a *user* can see it — and
 * {@link armedRow} is the reader.
 *
 * `tool` is still read from `PlanTools`, because forcing place mode is the one
 * write the panel still makes.
 */
function PaletteHarness({ query = '' }: { query?: string }) {
  const tools = usePlanTools({ tool: 'erase' })
  return (
    <div>
      <PalettePanel
        index={index}
        tools={tools}
        search={{ ...defaultFacetSearch(), q: query }}
        onQueryChange={() => undefined}
      />
      <p data-testid="selected-template">{tools.selectedTemplate ?? 'none'}</p>
      <p data-testid="tool">{tools.tool}</p>
    </div>
  )
}

/** The name on the pressed palette row, or `'none'`. */
function armedRow(): string {
  const pressed = screen.queryAllByRole('button', { pressed: true })
  const first = pressed[0]
  return first === undefined ? 'none' : (first.textContent ?? '')
}

describe('the palette', () => {
  it('lists the archive on an empty query, which is the only list it has since row A0', () => {
    // The panel used to hide the search block on an empty query and show the
    // library instead. There is no library, so an empty query is a browse of the
    // whole archive capped at `MAX_SEARCH_ROWS` — nine fixture items here, all of
    // them, in the engine's own ranking.
    render(<PaletteHarness />)

    expect(screen.getAllByRole('listitem')).toHaveLength(Object.keys(FIXTURE_DESIGNS).length)
    expect(screen.getByRole('heading', { name: /Archive 9/ })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Library/ })).toBeNull()
  })

  it('greys the tiles the plan cannot hold, and offers no control for them', () => {
    render(<PaletteHarness query="cave column" />)

    // The footprint-less column is not a control at all — see `PalettePanel.tsx`
    // on why not a disabled button. Row W6 made the annular sector placeable, so
    // `none` is the only case left greyed.
    const rows = screen.getAllByRole('listitem')
    const refused = rows.filter((row) => !row.hasAttribute('data-placeable'))
    expect(refused).toHaveLength(1)
    expect(refused[0]).toHaveTextContent(FIXTURE_NAMES.slab)
    expect(within(refused[0] as HTMLElement).queryAllByRole('button')).toHaveLength(0)

    expect(screen.getByText('no plan shape')).toBeInTheDocument()
    // The canvas's own refusal sentence, so the two cannot disagree about why.
    expect(screen.getByText(/no derivable footprint/)).toBeInTheDocument()
  })

  it('keeps the engine’s ranking rather than sinking the refused rows', () => {
    // Row A0's one behavioural change to the ordering. The deleted `paletteRows`
    // sank the unplaceable items into a block at the end, which was right for a
    // library — a list the user assembled, with no ranking of its own — and is
    // wrong for a search: the top hit for a query has to be at the top, and
    // silently reordering a tenth of the answers would make the count beside the
    // field disagree with the list.
    render(<PaletteHarness />)

    const rows = screen.getAllByRole('listitem')
    const refusedAt = rows.findIndex((row) => !row.hasAttribute('data-placeable'))
    expect(refusedAt).toBeGreaterThanOrEqual(0)
    // Not last: the fixture's refused column sits mid-ranking, which is exactly
    // what the deleted sort would have moved.
    expect(refusedAt).toBeLessThan(rows.length - 1)
  })

  it('selects a row and forces place mode, and arms the surface with nothing', () => {
    render(<PaletteHarness />)

    expect(armedRow()).toBe('none')
    expect(screen.getByTestId('tool')).toHaveTextContent('erase')

    fireEvent.click(screen.getByRole('button', { name: new RegExp(FIXTURE_NAMES.floor1) }))

    expect(armedRow()).toContain(FIXTURE_NAMES.floor1)
    // §3: "Sets the active tile and forces place mode." Still the panel's one
    // write, and the reason it keeps the `tools` prop.
    expect(screen.getByTestId('tool')).toHaveTextContent('place')
    expect(screen.getByRole('button', { name: new RegExp(FIXTURE_NAMES.floor1) })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  /**
   * **Row A8's reduction, asserted so the next row finds it deliberate.**
   *
   * The work surface places a template **family** and this list holds the
   * archive's individual files — 3,822 items, none of them a recipe. So a press
   * here cannot arm anything, and the panel must neither pretend it did nor pass
   * a `DesignId` off as a `TemplateId`: the two id spaces are measurably *not*
   * lexically disjoint (`store/schema.ts#TemplateId`), so such a cast compiles
   * and every resulting placement would be reported `unknown-template`.
   *
   * Row **C1** replaces the list with the generated families and restores the
   * write. Until then this pins both halves: nothing reaches `PlanTools`, and the
   * panel says so on screen rather than leaving the toolbar's "No recipe armed"
   * plate as the only clue.
   */
  it('arms no template, and says so, until row C1 lands the family list', () => {
    render(<PaletteHarness />)
    fireEvent.click(screen.getByRole('button', { name: new RegExp(FIXTURE_NAMES.floor1) }))

    expect(screen.getByTestId('selected-template')).toHaveTextContent('none')
    expect(screen.getByText(/Placing is not wired to this list yet/)).toBeInTheDocument()
    expect(screen.getByText(/selecting one shows what you picked and arms nothing/)).toBeInTheDocument()
  })

  it('disarms when the armed row is selected again', () => {
    render(<PaletteHarness />)
    const row = () => screen.getByRole('button', { name: new RegExp(FIXTURE_NAMES.floor1) })

    fireEvent.click(row())
    fireEvent.click(row())
    expect(armedRow()).toBe('none')
  })

  it('narrows to the matching items and writes nothing when a row is picked', () => {
    render(<PaletteHarness query="dungeon stone floor" />)

    // Three fixture records match. It offered a "+ add" button on each row that
    // was not already saved, and that button was the only store write in the
    // panel; row A0 deleted it with the library. A row is now a pick and nothing
    // else, so the whole store is untouched until something is placed.
    const rows = screen.getAllByRole('listitem')
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining(FIXTURE_NAMES.floor1),
      expect.stringContaining(FIXTURE_NAMES.floor2),
      expect.stringContaining(FIXTURE_NAMES.twin),
    ])
    expect(screen.queryAllByRole('button', { name: /^add / })).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: new RegExp(FIXTURE_NAMES.twin) }))
    expect(armedRow()).toContain(FIXTURE_NAMES.twin)
    expect(placementCount()).toBe(0)
  })

  it('says how much of the archive it is showing, and nothing about a starter set', () => {
    // §2.4's "Add a starter set" put six floors and walls of one texture into the
    // library, and row A0 deleted both. Asserted as an absence because **row C1**
    // replaces this whole panel with 52 generated template families, and a
    // starter set — if it comes back — is a starter *room*.
    render(<PaletteHarness />)

    expect(screen.queryByRole('button', { name: /Add a starter set/ })).toBeNull()
    expect(screen.getByRole('heading', { name: /Archive 9/ })).toBeInTheDocument()
  })
})

/* ----------------------------------------------- the "use in builder" handoff */

/**
 * Row G5's reader side.
 *
 * The channel is cleared around every test in this block rather than in the
 * file's shared `beforeEach`: it is not part of `WorkshopState`, so
 * `resetWorkshop()` does not touch it, and a value left in the box would arm a
 * palette in an unrelated test.
 */
describe('the pre-selection handoff', () => {
  beforeEach(() => {
    clearPendingDesign()
  })

  afterEach(() => {
    clearPendingDesign()
  })

  /**
   * Mount the palette inside an `act` of our own.
   *
   * `render` has one, but the claim happens in an effect and wakes a
   * `useSyncExternalStore` subscriber after that act has closed — so the outer
   * one is what flushes the re-render instead of leaving React to warn about it.
   */
  function mountPalette(): ReturnType<typeof render> {
    let view: ReturnType<typeof render> | undefined
    act(() => {
      view = render(<PaletteHarness />)
    })
    if (view === undefined) throw new Error('the palette did not mount')
    return view
  }

  it('arms the item the catalog drawer sent, and forces place mode', () => {
    // Exactly what `TileDrawer`'s action does, in its order: post it, then
    // navigate — the navigation being this render. It filed the item in the
    // library first, until row A0; the palette lists the archive now, so a row
    // for the item exists without one.
    act(() => {
      sendDesignToBuilder(design('floor1'))
    })

    mountPalette()

    expect(armedRow()).toContain(FIXTURE_NAMES.floor1)
    // The harness opens in `erase`; selecting forces `place`, as a click does.
    expect(screen.getByTestId('tool')).toHaveTextContent('place')
    expect(screen.getByRole('button', { name: new RegExp(FIXTURE_NAMES.floor1) })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('claims the handoff once, so a re-mount does not re-arm a tile the user disarmed', () => {
    act(() => {
      sendDesignToBuilder(design('floor1'))
    })

    const first = mountPalette()
    expect(armedRow()).toContain(FIXTURE_NAMES.floor1)
    expect(useSelectionStore.getState().pending).toBeNull()

    first.unmount()
    mountPalette()
    expect(armedRow()).toBe('none')
    expect(screen.getByTestId('tool')).toHaveTextContent('erase')
  })

  it('takes the second press when two arrive with no claim between them', () => {
    act(() => {
      sendDesignToBuilder(design('floor1'))
      sendDesignToBuilder(design('floor2'))
    })

    mountPalette()
    expect(armedRow()).toContain(FIXTURE_NAMES.floor2)
  })

  it('arms nothing for an item the plan cannot hold, and the row says why', () => {
    // The `none` footprint: 370 of 3,822 items, 726 of 8,702 files. Arming it
    // would give the user an armed tile every click of which the canvas correctly
    // refuses, which is the failure the greyed rows exist to avoid.
    act(() => {
      sendDesignToBuilder(design('slab'))
    })

    mountPalette()

    expect(armedRow()).toBe('none')
    expect(screen.getByTestId('tool')).toHaveTextContent('erase')
    // The explanation is already on screen, on the row itself, because the
    // archive list holds every item — so the refusal costs no new copy. Row A0
    // moved it there from a note under the library block, which counted the
    // refused *saved* items and had nothing to count once the library went.
    expect(screen.getByText('no plan shape')).toBeInTheDocument()
    expect(screen.getByText(/no derivable footprint/)).toBeInTheDocument()
    // Claimed all the same: a handoff this palette will not act on must not sit
    // in the box waiting to arm the next mount.
    expect(useSelectionStore.getState().pending).toBeNull()
  })

  it('arms nothing for a design this catalog build does not hold', () => {
    act(() => {
      sendDesignToBuilder('d-retired-and-gone' as DesignId)
    })

    mountPalette()
    expect(armedRow()).toBe('none')
    expect(useSelectionStore.getState().pending).toBeNull()
  })

  it('carries the item, and the bill prints exactly what the slots name', () => {
    // The channel is a selection, never a resolution — and since row A3 nothing
    // downstream resolves either. `floor2` is a `connection|openforge` topper, so
    // this used to be the auto-insert case: one placement, **two** parts, with a
    // base the resolver chose. A recipe declares its base as an ordinary slot, so
    // a one-slot instance of the topper is one part and the base is absent
    // because nobody filled a slot with one — not because the resolver declined.
    act(() => {
      sendDesignToBuilder(design('floor2'))
    })

    mountPalette()
    expect(armedRow()).toContain(FIXTURE_NAMES.floor2)

    const bill = buildBillOfTiles([anInstance([FIXTURE_IDS.floor2])], assembly, {
      ...fixtureContext(file),
      lock: 'openlock',
    })
    expect(bill.placements).toBe(1)
    expect(bill.parts).toBe(1)
    expect(bill.lines.map((line) => line.tile.id)).toEqual([FIXTURE_IDS.floor2])
    // And filling both slots of the two-slot recipe is what puts the base in the
    // bill: the scene asks for it, so it is a line the user can account for.
    const both = buildBillOfTiles([anInstance([FIXTURE_IDS.floor2, FIXTURE_IDS.base2])], assembly, {
      ...fixtureContext(file),
      lock: 'openlock',
    })
    expect(both.parts).toBe(2)
    expect([...both.lines.map((line) => line.tile.id)].sort()).toEqual(
      [FIXTURE_IDS.base2, FIXTURE_IDS.floor2].sort(),
    )
  })
})

/* -------------------------------------------------------- the two-sided item */

/**
 * The bug the owner reported, on the one item shape that can express it.
 *
 * `MIXED_INTEGRAL` joins `floor2`'s design, so `d-floor-2` becomes the corpus's
 * `both` class: a `topper` that needs a base, and an `integral` that does not.
 * **931 live items (24.4%) are this shape and on all 931 the two rules disagree**
 * — `TileAggregate.preview` names the topper and `selectVariant` names the
 * integral. The palette asks both questions and this block pins each answer to
 * the right one:
 *
 *   - the **thumb** renders the topper, because that mesh is the tile;
 *   - the **armed id** is the integral, because that is what this build prints.
 *
 * Reversed, the row shows a tile welded to a base — which is what the owner
 * described seeing — or arms a topper and lets the bill charge for a base the
 * user could have skipped. Both are asserted, so neither can be reintroduced by
 * "simplifying" the two calls into one.
 *
 * The index is swapped in this block's own `beforeEach`, which runs after the
 * file's: the outer one restores the nine-record fixture for every other block.
 */
describe('the two-sided item', () => {
  let mixedAssembly: AssemblyIndex

  beforeEach(() => {
    const mixedFile = mixedCatalogFile()
    const engine = createSearchEngine(mixedFile)
    index = {
      file: mixedFile,
      engine,
      tagsFor: (record) => resolveTags(mixedFile, record),
      materialOf: (record) => resolveMaterial(resolveTags(mixedFile, record), record.file).material,
    }
    mixedAssembly = buildAssemblyIndex(mixedFile)
  })

  /** The item really is two-sided, so the two assertions below are not vacuous. */
  it('is one item over two variants, previewing the topper', () => {
    const item = index.engine.aggregates.byDesign.get(design('floor2'))
    expect(item?.variantClass).toBe('both')
    expect(item?.variants.map((variant) => variant.id).sort()).toEqual(
      [FIXTURE_IDS.floor2, MIXED_INTEGRAL.id].sort(),
    )
    expect(item?.preview).toBe(FIXTURE_IDS.floor2)
    // And the resolver disagrees, which is the premise of the whole block.
    expect(selectVariant(item!, { bottom: 'openlock' }).variant.id).toBe(MIXED_INTEGRAL.id)
  })

  it('renders the topper in the row, not the file the resolver would print', () => {
    // Narrowed to the two-sided item's own row: the palette lists the whole
    // archive in ranking order since row A0, so index 0 is no longer this item.
    render(<PaletteHarness query="dungeon stone floor 2x2" />)

    const row = screen
      .getAllByRole('listitem')
      .find((candidate) => candidate.textContent?.includes(FIXTURE_NAMES.floor2)) as HTMLElement
    expect(row).toBeDefined()
    const image = within(row).getByRole('presentation', { hidden: true })
    // The sprite URL is content-addressed, so the blob in it names the file the
    // thumb is showing. `2…` is the topper's md5, `9…` the integral's.
    expect(image).toHaveAttribute('src', expect.stringContaining('2'.repeat(32)))
    expect(image.getAttribute('src')).not.toContain('9'.repeat(32))
  })

  /**
   * The row selects the item, and the bill prints whatever a slot names.
   *
   * **The two-sidedness has stopped reaching the bill at all, and that is the
   * finding this test now carries.** V3's defect was that the palette armed a
   * *file* and rule 0 then printed a different one, so the bill told the user it
   * had printed something they did not place — measured on every one of the 931
   * two-sided items. Both halves are gone: the palette selects an item and arms
   * nothing (row A8), and a fill names an exact file (row A3), so the file in the
   * bill is the file in the slot and no rule can move it.
   *
   * So the disagreement between `preview` and `selectVariant` survives only in
   * the *thumbnail*, which the test above pins, and the bill's half of it is
   * asserted here as an identity: place the integral, print the integral.
   * Choosing which of an item's files fills a slot is row **C2**'s, and
   * `selectVariantForLock` is still exported for it.
   */
  it('selects the item, and the bill prints exactly the file the slot names', () => {
    render(<PaletteHarness />)
    fireEvent.click(screen.getByRole('button', { name: new RegExp(FIXTURE_NAMES.floor2) }))

    expect(armedRow()).toContain(FIXTURE_NAMES.floor2)
    // The palette still writes nothing to the surface — the reduction holds on
    // the one item shape where a wrong arming would have been invisible.
    expect(screen.getByTestId('selected-template')).toHaveTextContent('none')

    for (const tile of [MIXED_INTEGRAL.id, FIXTURE_IDS.floor2]) {
      const bill = buildBillOfTiles([anInstance([tile])], mixedAssembly, {
        ...fixtureContext(index.file),
        lock: 'openlock',
      })
      // One part, and it is the file named — for *either* file of the item. Under
      // rule 0 the second of these would have printed the first.
      expect(bill.parts).toBe(1)
      expect(bill.lines.map((line) => line.tile.id)).toEqual([tile])
      expect(bill.complete).toBe(true)
    }
  })

  /**
   * The pressed row survives a change of lock preference.
   *
   * **This test is the same and its subject is gone.** Under V3 the palette armed
   * a *file*, so the pressed state had to be decided by asking which design that
   * file belonged to (`armedItem`); comparing `armFile(item, lock)` to the armed
   * id would have un-pressed the row the moment the preference changed — the
   * three locks disagree about the file for **37.1%** of items, so a common state
   * and not a corner — leaving the canvas armed with nothing highlighted. After
   * V4 the selected value *is* the row's key and there is nothing a preference
   * can move. Kept as a regression on the behaviour, not on the mechanism.
   */
  it('keeps the row pressed when the lock preference changes under it', () => {
    render(<PaletteHarness />)
    const row = () => screen.getByRole('button', { name: new RegExp(FIXTURE_NAMES.floor2) })

    fireEvent.click(row())
    expect(row()).toHaveAttribute('aria-pressed', 'true')
    const selected = armedRow()

    act(() => {
      setLockSystem('dragonlock')
    })

    expect(row()).toHaveAttribute('aria-pressed', 'true')
    // And nothing else became pressed either.
    expect(armedRow()).toBe(selected)
  })
})

/* -------------------------------------------------------------- the toolbar */

function ToolbarHarness({ moving }: { moving?: string }) {
  const tools = usePlanTools()
  const placements = usePlacements()
  const placed = Object.keys(placements).length
  // The armed **step**, since row A8 — the toolbar takes a number rather than a
  // record, because what is armed is a family of up to five files and has no
  // single `rotStep`. `ARMED_TURN_STEP_DEG` is what `BuilderScreen` passes and
  // what `three/edits.ts#planTurn` turns by; 90 is spelled here so the harness
  // does not import the surface for one constant.
  const armedStep = tools.selectedTemplate === null ? undefined : 90
  // The 3D surface reports its readout through `onStatus`; the toolbar only
  // reads it. `moving` is the one field this harness needs to stand in for, so
  // the rest is the empty readout the toolbar already handles. `SurfaceStatus`
  // since row R4 — it was `PlanStatus`, which the deleted plan canvas declared.
  const status: SurfaceStatus | null =
    moving === undefined
      ? null
      : {
          cursor: [0, 0],
          snap: tools.snap,
          step: tools.step,
          tool: tools.tool,
          hint: '',
          selectedName: null,
          refusal: null,
          moving,
          placements: placed,
          conflicts: 0,
        }
  return (
    <div>
      <button type="button" onClick={() => tools.setSelectedTemplate(ONE_SLOT_TEMPLATE_ID)}>
        arm
      </button>
      <PlanToolbar
        tools={tools}
        status={status}
        armedStep={armedStep}
        placed={placed}
        onClear={() => {
          useWorkshopStore.setState({ placements: {} })
        }}
      />
      <p data-testid="rotation">{String(tools.rotation)}</p>
      <p data-testid="snap">{String(tools.step)}</p>
    </div>
  )
}

describe('the toolbar', () => {
  it('offers 0.5 and 1.0 only — never the quarter-unit grid the mock had', () => {
    render(<ToolbarHarness />)
    const snap = screen.getByRole('button', { name: /^snap/ })

    expect(snap).toHaveTextContent('snap 0.5')
    fireEvent.click(snap)
    expect(screen.getByTestId('snap')).toHaveTextContent('1')
    expect(snap).toHaveTextContent('snap 1')
    fireEvent.click(snap)
    expect(screen.getByTestId('snap')).toHaveTextContent('0.5')
  })

  it('cannot rotate until a tile is armed, then turns it by the tile’s own step', () => {
    render(<ToolbarHarness />)
    const rotate = () => screen.getByRole('button', { name: /Rotate/ })

    expect(rotate()).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'arm' }))
    expect(rotate()).toBeEnabled()

    fireEvent.click(rotate())
    // `floor1` carries no `rotStep`, so the step is the schema's 90° default.
    expect(screen.getByTestId('rotation')).toHaveTextContent('90')
  })

  it('cannot clear an empty scene, and clears a placed one', () => {
    render(<ToolbarHarness />)
    expect(screen.getByRole('button', { name: /^Clear/ })).toBeDisabled()

    place('floor1')
    expect(screen.getByRole('button', { name: /^Clear/ })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: /^Clear/ }))
    expect(placementCount()).toBe(0)
  })

  it('switches between place and erase', () => {
    render(<ToolbarHarness />)
    fireEvent.click(screen.getByRole('button', { name: 'Erase' }))
    expect(screen.getByRole('button', { name: 'Erase' })).toHaveAttribute('data-pressed')
  })

  it('offers Move as a third mode, and only one mode is ever up', () => {
    // PR #29 refused a move because a drag on the primary button is already
    // drag-paint. A mode removes the ambiguity rather than arbitrating it; the
    // canvas's Shift-drag is the same operation without the mode switch.
    render(<ToolbarHarness />)
    fireEvent.click(screen.getByRole('button', { name: 'Move' }))
    expect(screen.getByRole('button', { name: 'Move' })).toHaveAttribute('data-pressed')
    expect(screen.getByRole('button', { name: 'Place' })).not.toHaveAttribute('data-pressed')
    expect(screen.getByRole('button', { name: 'Erase' })).not.toHaveAttribute('data-pressed')
  })

  it('names the piece in the air, which a Shift-drag move leaves no mode to show', () => {
    render(<ToolbarHarness moving="Cut stone wall 2" />)
    expect(screen.getByText(/moving Cut stone wall 2/)).toBeInTheDocument()
  })
})

/* ----------------------------------------------------------------- the bill */

/**
 * The bill panel over the **real store** — the same three lines the builder
 * screen uses, so a `placeTile` in a test reaches the panel by the production
 * path rather than through a prop.
 */
function BillHarness({ download }: { download?: ArchiveDownload }) {
  const placements = usePlacements()
  const bill = useMemo(
    () => buildBillOfTiles(Object.values(placements), assembly, { ...fixtureContext(file), lock: 'openlock' }),
    [placements],
  )
  return (
    <BillPanel
      bill={bill}
      placements={placements}
      assets={file.assets}
      sheet={file.sprite}
      materialOf={index.materialOf}
      download={download ?? inertDownload(bill)}
    />
  )
}

/** A download that does nothing, for the tests that are about the bill. */
function inertDownload(bill: BillOfTiles): ArchiveDownload {
  void bill
  return {
    state: { status: 'idle' },
    start: () => undefined,
    cancel: () => undefined,
    dismiss: () => undefined,
    saveUrlList: () => undefined,
  }
}

describe('the bill of tiles', () => {
  it('reflects the store as it fills', () => {
    render(<BillHarness />)
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('0 pieces placed')
    expect(screen.getByText(/Nothing placed yet/)).toBeInTheDocument()

    place('floor1', 0, 0)
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('1 piece placed')

    place('floor1', 2, 0)
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('2 pieces placed')
  })

  it('dedupes by md5, not by tile id', () => {
    // Two different catalog paths over one mesh — 171 live md5s are shared by 520
    // rows, so this is the normal case rather than an edge one.
    place('floor1', 0, 0)
    place('twin', 2, 0)
    render(<BillHarness />)

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('2 pieces placed')
    // One line, quantity two, and one file's bytes — not two.
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('×2')
    expect(rows[0]).toHaveTextContent('1.0 MB')
    expect(screen.getByText('1 unique model')).toBeInTheDocument()
    expect(screen.getByText('1.0 MB', { selector: '.of-bill-bytes' })).toBeInTheDocument()
  })

  /**
   * The parts subline, and the mark that used to sit beside it.
   *
   * **`base · added` is gone and nothing replaced it**, which is the whole of what
   * row A3 changed about this panel's rows. It read `BillLine.baseQuantity` and
   * said *"added under a topper you placed, not placed by you"*; a recipe declares
   * its base as an ordinary slot, so every copy in the bill is one the scene asked
   * for and there is no unaccountable row left to mark. What survives is the
   * inequality the subline is really about: one placement, more than one part.
   */
  it('says how many parts a recipe prints, and marks nothing as added', () => {
    placeBoth('floor2', 'base2')
    render(<BillHarness />)

    expect(screen.getByText(/1 piece placed/)).toBeInTheDocument()
    // **Row C4: the subline is unconditional and names both figures.** The
    // heading counts instances and this counts what they cost, so a reader never
    // has to infer one from the other — and it was rendered only when
    // `parts > placements`, which hid the part count for every one-part scene and
    // for every scene whose instances have holes in them.
    expect(screen.getByText(/2 parts to print, over 2 files/)).toBeInTheDocument()

    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.textContent).join(' ')).toContain(FIXTURE_NAMES.base2)
    expect(document.body).not.toHaveTextContent(/base · added/)
    expect(document.body).not.toHaveTextContent(/not placed by you/)
    // **Both rows expand to the same instance**, which is the other half of the
    // change: an instance is attached to the line of every part it resolved to,
    // so a five-slot corner is removable from any of its five rows rather than
    // from one.
    for (const row of rows) {
      expect(within(row).getByRole('button', { expanded: false })).toBeInTheDocument()
    }
  })

  /**
   * The empty slot, on the panel.
   *
   * `slot-unfilled` is the note row A3 added and the loudest thing this panel can
   * now say: every slot of every shipped recipe is required — `PartSlot.optional`
   * is absent from all 128 parts of the 40 — so an empty one is a hole in the
   * print, and it is the one condition that refuses a download.
   */
  it('warns in full about a slot the scene has not filled', () => {
    placeHalf('floor2')
    render(<BillHarness />)

    const note = screen.getByText(/1 slot is still empty/).closest('.of-bill-note')
    expect(note).not.toBeNull()
    expect(note).toHaveAttribute('data-tone', 'warn')
    expect(note).toHaveTextContent(/none of the 128 parts is marked optional/)
    expect(note).toHaveTextContent(/the download is refused until each one is filled/)
    // Not behind the `<details>` the info notes live in, and the piece is still
    // on the plan — §3.2's "places anyway".
    expect(note?.closest('details')).toBeNull()
    expect(screen.getByText(/1 piece placed/)).toBeInTheDocument()

    // **Row C4: and the roll-up now has a list behind it.** The note says *how
    // many* slots are empty; before this block that was the whole of it, and a
    // user was sent to look at a drawing that is one tab stop. This names the
    // recipe, the slot and the cell.
    const fault = screen.getByText(/panels-two-slot · wall · x 0, z 0/)
    expect(fault.closest('.of-bill-fault')).toHaveAttribute('data-blocking', '')
    expect(screen.getByText(/1 slot needs attention/)).toBeInTheDocument()
    expect(screen.getByText(/The download is refused until each one holds a file/)).toBeInTheDocument()
    expect(screen.getByText(/Nothing is in this slot/)).toBeInTheDocument()

    // One bill row for the filled slot, one fault entry for the empty one.
    expect(document.querySelectorAll('.of-bill-list > .of-bill-row')).toHaveLength(1)
    expect(document.querySelectorAll('.of-bill-fault')).toHaveLength(1)
  })

  /**
   * **The state row A3 created and row A8 could not surface: a fill that is
   * wrong.**
   *
   * Rule 0 chose the file from a design, so there was nothing to disagree with —
   * a placement resolved or it did not. A fill names an exact file, so
   * `@/composition` can say the slot does not admit it, and `fill-off-slot` is
   * the note. The note is a roll-up: it says how many slots hold a file they
   * should not, and nothing about which. This block is the which.
   *
   * `STRICT_TEMPLATE` is the fixture that makes it reachable — the two A8
   * recipes both declare `tags: {}`, and an empty require set admits every
   * record, so no bill either of them produces can carry this note at all.
   */
  it('names the slot holding a file it does not admit, and does not refuse the download over it', () => {
    act(() => {
      // A wall in a slot that requires `shape|floor`. The record is real, the
      // catalog holds it, and the slot does not admit it — which is exactly the
      // population `fill-off-slot` describes: a pinned fill from outside the
      // candidate set.
      placeTemplate(aStrictInstance(FIXTURE_IDS.wallNoBase, { x: 3, z: 1 }))
    })
    render(<BillHarness />)

    expect(screen.getByText(/1 filled slot holds a file it does not admit/)).toBeInTheDocument()
    const fault = screen.getByText(/panels-floor-only · floor · x 3, z 1/)
    // **Not blocking**, and that split is §7's: an unprintable pack is refused, a
    // wrong build is disclosed. The piece prints; it will not fit.
    expect(fault.closest('.of-bill-fault')).not.toHaveAttribute('data-blocking')
    expect(screen.getByText(/These will print and will not fit/)).toBeInTheDocument()
    expect(screen.getByText(/You pinned it; pick another file for the slot/)).toBeInTheDocument()

    // The file is still billed — one part lost is not the instance, and this one
    // is not even lost.
    expect(document.querySelectorAll('.of-bill-list > .of-bill-row')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: /Remove the piece with the faulty floor at x 3, z 1/ }))
    expect(placementCount()).toBe(0)
  })

  it('tells a retired fill apart from an empty slot, and blocks the download over both', () => {
    // The three states an explicitly-filled instance can be wrong in are
    // `empty`, `retired` and `off-slot`, and the first two look identical to
    // `BillOfTiles.complete` — the pack is one file short either way. They are
    // not identical to a user: one slot was never filled, the other names a file
    // that has left the archive, and `ResolvedSlotFill.admissible` is
    // `undefined` for both because there is nothing to check.
    act(() => {
      placeTemplate(anInstance([FIXTURE_IDS.floor1, 'tiles/gone/away.stl'], { x: 2, z: 2 }))
    })
    render(<BillHarness />)

    const fault = screen.getByText(/panels-two-slot · wall · x 2, z 2/)
    expect(fault.closest('.of-bill-fault')).toHaveAttribute('data-blocking', '')
    expect(screen.getByText(/has left the archive, so there is nothing to print for it/)).toBeInTheDocument()
    // Not an orphan: the other slot resolved, so the instance is a row with a
    // hole in it rather than a piece with nothing to print.
    expect(screen.queryByText(/nothing this build can print/)).toBeNull()
    expect(document.querySelectorAll('.of-bill-list > .of-bill-row')).toHaveLength(1)
  })

  it('gives an instance with nothing to print one block and one Remove, not two', () => {
    // Both surfaces can describe an instance that resolved to no parts — the
    // orphan block by cause, the fault block slot by slot — and two Remove
    // buttons for one piece in a 302px column is worse than either. The orphan
    // block wins because the whole piece has to go.
    act(() => {
      placeTemplate(anInstance([null, null], { x: 5, z: 5 }))
    })
    render(<BillHarness />)

    expect(screen.getByText(/1 placed piece has nothing this build can print/)).toBeInTheDocument()
    expect(screen.queryByText(/slots need attention/)).toBeNull()
    expect(screen.getAllByRole('button', { name: /^Remove/ })).toHaveLength(1)
  })

  it('says nothing at all when every fill belongs in its slot', () => {
    // The negative, over the same strict recipe: a floor in a floor slot. Without
    // it the assertion above would pass on a block that always renders.
    act(() => {
      placeTemplate(aStrictInstance(FIXTURE_IDS.floor1, { x: 3, z: 1 }))
    })
    render(<BillHarness />)

    expect(screen.queryByText(/needs attention/)).toBeNull()
    expect(document.querySelectorAll('.of-bill-fault')).toHaveLength(0)
    expect(document.querySelectorAll('.of-bill-note[data-tone="warn"]')).toHaveLength(0)
  })

  /**
   * **`BillLine.slots`' first consumer, and the reason A3 added the field.**
   *
   * Two slots of one instance resolving to the same md5 is a legitimate quantity
   * of 2 — contract C-c, the md5 dedupe doing its job — and before this the row
   * read `×2` with one placement under it and no way to account for the second
   * copy. `tileIds` cannot carry it: it is one id per *catalog path*, so it
   * cannot tell two askers of one path from one.
   */
  it('names both slots when one instance asks for one file twice', () => {
    placeBoth('floor1', 'twin', 1, 1)
    render(<BillHarness />)

    // One line, quantity two, one instance.
    const row = screen.getByRole('button', { expanded: false })
    expect(row).toHaveTextContent('×2')
    fireEvent.click(row)

    expect(screen.getByText(/x 1, z 1 · floor \+ wall/)).toBeInTheDocument()
  })

  it('makes every placement reachable and removable from the panel', () => {
    // Row 17 was explicit that the canvas is one tab stop with no linearly
    // readable drawing. This is where that gap closes.
    place('floor1', 1, 2)
    place('floor1', 3, 2)
    render(<BillHarness />)

    const row = screen.getByRole('button', { expanded: false })
    fireEvent.click(row)

    expect(screen.getByText('x 1, z 2')).toBeInTheDocument()
    expect(screen.getByText('x 3, z 2')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Remove .* at x 1, z 2/ }))
    expect(placementCount()).toBe(1)
    expect(screen.queryByText('x 1, z 2')).toBeNull()
  })

  it('lists an instance nothing in this build can print, and offers to remove it', () => {
    act(() => {
      // A recipe this build does not ship. Since row A1 that is one of the two
      // ways an instance resolves to no parts at all — the other being a fill
      // whose file has left the archive — and both land in this block, because
      // the consequence is the same: no line, and no way to reach the piece from
      // the inventory without one.
      placeTemplate({
        ...anInstance([FIXTURE_IDS.floor1], { x: 4, z: 4 }),
        template: TemplateId.parse('gone-forever'),
      })
    })
    render(<BillHarness />)

    expect(screen.getByText(/1 placed piece has nothing this build can print/)).toBeInTheDocument()
    // The template id, which is the only identity an orphan is guaranteed to
    // have.
    expect(screen.getByText('gone-forever')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Remove the unprintable piece/ }))
    expect(placementCount()).toBe(0)
  })

  it('renders the verdict at the 512 MB threshold', () => {
    place('big')
    render(<BillHarness />)

    expect(screen.getByText(/Over 512 MB to download/)).toBeInTheDocument()
    // **Row C4 changed this sentence's subject.** It said "expect a long
    // transfer" and quoted the whole-corpus median; 512 MB is
    // `download/save.ts#BLOB_FALLBACK_LIMIT_BYTES` to the byte, so for every
    // browser without a streaming save it is a *refusal* rather than a slow
    // download — which is the only part of it a user can act on.
    expect(screen.getByText(/refuse it outright rather than slowing down/)).toBeInTheDocument()
    expect(screen.getByText(/about fifty distinct files/)).toBeInTheDocument()
    expect(screen.queryByText(/Expect a long transfer/)).toBeNull()
    expect(screen.getByText('600.0 MB', { selector: '.of-bill-bytes' })).toHaveAttribute(
      'data-verdict',
      'large',
    )
  })

  it('renders the verdict at the 2 GB threshold, and says not to start it', () => {
    place('big')
    place('huge')
    render(<BillHarness />)

    expect(screen.getByText(/Over 2 GB to download/)).toBeInTheDocument()
    expect(screen.getByText(/past what one browser download reliably finishes/)).toBeInTheDocument()
    expect(screen.getByText('2.1 GB', { selector: '.of-bill-bytes' })).toHaveAttribute(
      'data-verdict',
      'huge',
    )
  })

  /**
   * **The missing-base warning is gone from this panel, and this is the negative
   * that records it.**
   *
   * `wallNoBase` is an openforge topper whose size code (`ZZ`) no base in the
   * fixture — or in the live corpus — answers to, and placing it used to produce
   * `no-matching-base`: *"a gap in the library rather than anything you did …
   * nothing to lock to and will not stay upright."* Rule 1 emitted it, row A3
   * deleted rule 1, and `assembly/baseMatch.ts#baseGap` still classifies the
   * archive's 86 / 31 / 260 split for whoever asks — but **no bill can ask**, so
   * the copy left `noteCopy` rather than being rendered for a note that can never
   * arrive.
   *
   * Warning a user before they fill a `base` slot with nothing is row **C2**'s
   * (the solver has the candidate set) and row **C3**'s (the editor has the
   * slot). Asserted as an absence here so that neither row re-adds it to the bill
   * by accident.
   */
  it('says nothing about a missing base, because nothing adds one any more', () => {
    place('wallNoBase')
    render(<BillHarness />)

    expect(screen.queryByText(/no base in the archive/)).toBeNull()
    expect(screen.queryByText(/will not stay upright/)).toBeNull()
    expect(document.querySelectorAll('.of-bill-note[data-tone="warn"]')).toHaveLength(0)
    // One row, one part: the topper, exactly as the scene named it.
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText(FIXTURE_NAMES.wallNoBase, { selector: '.of-bill-name' })).toBeInTheDocument()
  })

  it('keeps the info notes quiet but present', () => {
    // `slab` is the `none` footprint — 726 corpus files — so the scene carries
    // exactly one `info` note and no `warn` one. It read `base was added for
    // you` until row A3 deleted `base-auto-inserted` with the rule that emitted
    // it, and `no-footprint` is the archetype that survives: true of the data,
    // nothing to act on.
    place('slab')
    render(<BillHarness />)

    const details = screen.getByText(/notes? about this scene/).closest('details')
    expect(details).not.toBeNull()
    expect(details).toHaveTextContent(/cannot be drawn on the plan/)
    expect(details).toHaveTextContent(/726 corpus tiles are in this state/)
  })

  it('sorts rows by copies descending', () => {
    place('floor1', 0, 0)
    place('floor1', 2, 0)
    place('wallNoBase', 4, 0)
    render(<BillHarness />)

    const rows = screen.getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent(FIXTURE_NAMES.floor1)
    expect(rows[0]).toHaveTextContent('×2')
    expect(rows[1]).toHaveTextContent(FIXTURE_NAMES.wallNoBase)
  })
})

/* --------------------------------- deleted: the three missing-base gaps (A3) */

/*
  Six tests stood here, over a four-record extension of the shared fixture
  (`gapCatalog`): a half-unit strip with no congruent base, a shapeless corner
  with no key to match on, and a topper whose only base is the topless print.
  They asserted the three remedies `no-matching-base` / `no-congruent-base` /
  `base-unmatchable` spelled out, plus `base-option-chosen`'s print-variant
  disclosure and the negative when the plain base won.

  **All five codes left `NoteCode` with rule 1, so no bill can emit one and no
  render can reach the copy.** The classification survives — `baseGap` measures
  86 / 31 / 260 over 4,363 toppers, identically under every lock preference, and
  `src/generator/placement/corpus.test.ts` asserts that split against the live
  archive. What has no caller is the *bill's* rendering of it.

  Not rewritten against a slot, because the question "what do we tell a user
  whose base slot has no candidate" is answered where the candidate set is: row
  **C2**'s solver, and row **C3**'s editor. The bill-block test above — "says
  nothing about a missing base" — is the negative that keeps this from being
  re-added here by accident.
*/


/* ------------------------------------------------------------- the download */

/**
 * A `BlobSource` that never touches the network.
 *
 * `bytes` decides what comes back: the declared size (a good download), fewer
 * (the truncation the length guard exists for), or a thrown error.
 */
function fakeSource(behaviour: (blob: string) => 'ok' | 'short' | Error, sizes: Map<string, number>): BlobSource {
  return {
    urlFor: (blob) => `https://objects.openforge.tools/models/${blob.slice(0, 6)}/${blob}.stl`,
    open: (blob) => {
      const outcome = behaviour(blob)
      if (outcome instanceof Error) return Promise.reject(outcome)
      const size = sizes.get(blob) ?? 0
      const length = outcome === 'short' ? Math.max(0, size - 1) : size
      return Promise.resolve(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(length))
            controller.close()
          },
        }),
      )
    },
  }
}

function sizesOf(catalogFile: CatalogFile): Map<string, number> {
  return new Map(catalogFile.records.map((record) => [record.blob as string, record.bytes]))
}

function DownloadHarness({
  environment,
  source,
}: {
  environment?: SaveEnvironment
  source?: BlobSource
}) {
  const placements = usePlacements()
  const bill = useMemo(
    () => buildBillOfTiles(Object.values(placements), assembly, { ...fixtureContext(file), lock: 'openlock' }),
    [placements],
  )
  const download = useArchiveDownload({
    bill,
    assets: file.assets,
    ...(environment === undefined ? {} : { environment }),
    ...(source === undefined ? {} : { source }),
  })
  return (
    <div>
      <DownloadAction download={download} files={bill.files} />
      {/* An always-enabled trigger, so the empty-bill refusal can be reached
          through the hook as well as through the disabled button. */}
      <button type="button" onClick={download.start}>
        force download
      </button>
    </div>
  )
}

const saved: { blob: Blob; filename: string }[] = []

/**
 * **A jsdom realm shim, and the only piece of scaffolding here that is not a
 * published seam.**
 *
 * Vitest's jsdom environment takes its globals from jsdom's VM context, typed
 * arrays included, so `globalThis.Uint8Array` is *jsdom's* class. `TextEncoder`
 * is not — it is Node's, and it returns a Node `Uint8Array`. So under jsdom, and
 * only under jsdom:
 *
 * ```js
 * new TextEncoder().encode('x') instanceof Uint8Array  // false
 * ```
 *
 * `vendor/client-zip` branches on exactly that check to decide whether an
 * entry's body is bytes or a stream. `LICENSE.txt` is the first entry of every
 * archive and its body is a string, so the writer took the stream branch for it
 * and died on `bytes.getReader is not a function` — before a single test
 * assertion could be reached.
 *
 * Nothing under test is wrong: the same path produced a real 12.9 MB zip in
 * Chromium with correct CRCs, and `src/download/download.test.ts` exercises it in
 * the node environment where the two realms are one. This encoder is Node's,
 * re-wrapped so its output is allocated with the *global* `Uint8Array` — the same
 * bytes, in the realm the rest of the process believes in.
 */
class RealmSafeTextEncoder {
  readonly encoding = 'utf-8'

  encode(input = ''): Uint8Array {
    // `Uint8Array.from` allocates with the global constructor, which is the whole
    // point; the copy is a few kilobytes of licence text.
    return Uint8Array.from(new NodeTextEncoder().encode(input))
  }

  encodeInto(input: string, destination: Uint8Array): { read: number; written: number } {
    const bytes = this.encode(input)
    const written = Math.min(bytes.length, destination.length)
    destination.set(bytes.subarray(0, written))
    return { read: input.length, written }
  }
}

beforeEach(() => {
  vi.stubGlobal('TextEncoder', RealmSafeTextEncoder)
})

function blobEnvironment(limit?: number): SaveEnvironment {
  return {
    saveBlob: (blob, filename) => {
      saved.push({ blob, filename })
    },
    ...(limit === undefined ? {} : { blobLimitBytes: limit }),
  }
}

beforeEach(() => {
  saved.length = 0
})

async function failureText(): Promise<HTMLElement> {
  return waitFor(() => screen.getByRole('alert'))
}

describe('the download action', () => {
  it('refuses an empty bill, and says so rather than emitting a licence-only archive', async () => {
    render(<DownloadHarness environment={blobEnvironment()} />)

    expect(screen.getByRole('button', { name: /Download tile pack/ })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'force download' }))
    const alert = await failureText()
    expect(alert).toHaveAttribute('data-kind', 'empty')
    expect(alert).toHaveTextContent(/Nothing to download/)
    expect(alert).toHaveTextContent(/an archive holding only a licence is not a result/i)
  })

  /**
   * **The hole between the lines, refused — row A8's one behaviour requirement.**
   *
   * `src/download/**` cannot see this state: a plan is built from `BillLine`s and
   * an unfilled slot is the *absence* of one, so a pack of an incomplete scene
   * would be a plausible zip that opens cleanly and is one file short of a
   * printable model. `BillOfTiles.complete` and `.unfilled` are the two facts,
   * and `useArchiveDownload` is the only caller that holds them.
   *
   * Every slot of every shipped recipe is required — `PartSlot.optional` is
   * absent from all 128 parts of the 40 — so there is no scene for which this
   * refusal has an exemption to make.
   */
  it('refuses a scene with an unfilled slot, before it fetches a byte', async () => {
    placeHalf('floor1')
    let opened = 0
    render(
      <DownloadHarness
        environment={blobEnvironment()}
        source={fakeSource(() => {
          opened += 1
          return 'ok'
        }, sizesOf(file))}
      />,
    )

    // The bill is not empty — the filled slot is a line, and the button offers
    // it — which is exactly why the refusal has to be on the press.
    expect(screen.getByRole('button', { name: /Download tile pack/ })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: /Download tile pack/ }))

    const alert = await failureText()
    expect(alert).toHaveAttribute('data-kind', 'incomplete')
    expect(alert).toHaveTextContent(/One slot on the plan is still empty/)
    // The recipe and the slot, named — a bare count would send the user to look
    // at a drawing that is one tab stop.
    expect(alert).toHaveTextContent(/panels-two-slot: wall/)
    expect(alert).toHaveTextContent(/a streamed zip records its sizes at the end/)
    expect(within(alert).queryByRole('button', { name: 'Try again' })).toBeNull()
    // Nothing was fetched and nothing was saved.
    expect(opened).toBe(0)
    expect(saved).toHaveLength(0)
  })

  it('streams and saves a real archive', async () => {
    place('floor1')
    render(
      <DownloadHarness
        environment={blobEnvironment()}
        source={fakeSource(() => 'ok', sizesOf(file))}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Download tile pack/ }))

    await waitFor(() => {
      expect(screen.getByText(/^Saved/)).toBeInTheDocument()
    })
    expect(saved).toHaveLength(1)
    expect(saved[0]?.filename).toMatch(/^openforge-room-\d{4}-\d{2}-\d{2}\.zip$/)
    // Licence, attribution and the one model.
    expect(saved[0]?.blob.size).toBeGreaterThan(1_000_000)
  })

  it('refuses a room too large to buffer before it fetches a byte, and offers the URL list', async () => {
    place('big')
    let opened = 0
    render(
      <DownloadHarness
        environment={blobEnvironment(1_000_000)}
        source={fakeSource(() => {
          opened += 1
          return 'ok'
        }, sizesOf(file))}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Download tile pack/ }))
    const alert = await failureText()

    expect(alert).toHaveAttribute('data-kind', 'too-large')
    expect(alert).toHaveTextContent(/This room is 600.0 MB/)
    expect(alert).toHaveTextContent(/the limit is 1\.0 MB/)
    // Nothing was fetched: the refusal happens on the plan, not after 600 MB.
    expect(opened).toBe(0)

    // §11's degradation path, and §10's obligation riding with it: the URL list
    // and the attribution table, never one without the other.
    const urls: string[] = []
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: (blob: Blob) => {
        urls.push(String(blob.type))
        return 'blob:stub'
      },
      revokeObjectURL: () => undefined,
    })
    fireEvent.click(within(alert).getByRole('button', { name: /Take the URL list/ }))
    expect(urls).toHaveLength(2)
    expect(urls.some((type) => type.startsWith('text/plain'))).toBe(true)
    expect(urls.some((type) => type.startsWith('text/csv'))).toBe(true)
  })

  it('says so when the browser offers no way to save a file at all', async () => {
    place('floor1')
    render(<DownloadHarness environment={{}} source={fakeSource(() => 'ok', sizesOf(file))} />)

    fireEvent.click(screen.getByRole('button', { name: /Download tile pack/ }))
    const alert = await failureText()
    expect(alert).toHaveAttribute('data-kind', 'no-save-target')
    expect(alert).toHaveTextContent(/cannot save a file/)
  })

  it('names the file that could not be fetched, and offers a retry', async () => {
    place('floor1')
    const url = 'https://objects.openforge.tools/models/111111/11111111111111111111111111111111.stl'
    render(
      <DownloadHarness
        environment={blobEnvironment()}
        source={fakeSource(
          (blob) => new BlobFetchError(blob as never, url, 'HTTP 503 Service Unavailable'),
          sizesOf(file),
        )}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Download tile pack/ }))
    const alert = await failureText()
    expect(alert).toHaveAttribute('data-kind', 'fetch')
    expect(alert).toHaveTextContent(url)
    expect(alert).toHaveTextContent(/503/)
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('reports a refused URL as an integrity problem rather than something to retry', async () => {
    place('floor1')
    render(
      <DownloadHarness
        environment={blobEnvironment()}
        source={fakeSource(
          () => new PreviewMeshRefusedError('https://objects.openforge.tools/thumbs/x.webp', 'served as image/webp'),
          sizesOf(file),
        )}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Download tile pack/ }))
    const alert = await failureText()
    expect(alert).toHaveAttribute('data-kind', 'refused')
    expect(within(alert).queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('fails a truncated archive rather than saving one that still opens', async () => {
    place('floor1')
    render(
      <DownloadHarness
        environment={blobEnvironment()}
        source={fakeSource(() => 'short', sizesOf(file))}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Download tile pack/ }))
    const alert = await failureText()
    expect(alert).toHaveAttribute('data-kind', 'length-mismatch')
    expect(alert).toHaveTextContent(/came out the wrong size/)
    expect(alert).toHaveTextContent(/failed rather than saved/)
    expect(saved).toHaveLength(0)
  })

  it('surfaces a naming failure distinctly', async () => {
    // `sanitizePath` throws when a path sanitises to nothing, which a filename of
    // nothing but dots does. Reached through a one-record catalog rather than the
    // shared fixture, so the palette tests are not asked to render a tile that
    // cannot be named.
    const broken = CatalogFileSchema.parse({
      ...FIXTURE_CATALOG,
      records: [{ ...FIXTURE_CATALOG.records[0], file: '...' }],
    })
    const brokenIndex = buildAssemblyIndex(broken)
    const instance = anInstance([FIXTURE_IDS.floor1])
    const bill = buildBillOfTiles([instance], brokenIndex, {
      ...fixtureContext(broken),
      lock: 'openlock',
    })

    function Harness() {
      const download = useArchiveDownload({ bill, assets: file.assets, environment: blobEnvironment() })
      return <DownloadAction download={download} files={bill.files} />
    }

    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: /Download tile pack/ }))
    const alert = await failureText()
    expect(alert).toHaveAttribute('data-kind', 'naming')
    expect(alert).toHaveTextContent(/could not be told apart/)
  })

  it('surfaces an unexpected failure with its own message rather than a generic one', async () => {
    place('floor1')
    render(
      <DownloadHarness
        environment={blobEnvironment()}
        source={fakeSource(() => new Error('the disk caught fire'), sizesOf(file))}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Download tile pack/ }))
    const alert = await failureText()
    expect(alert).toHaveAttribute('data-kind', 'unknown')
    expect(alert).toHaveTextContent('the disk caught fire')
  })

  it('treats a dismissed picker as a cancellation, not a failure', async () => {
    place('floor1')
    const abort = Object.assign(new Error('user dismissed'), { name: 'AbortError' })
    render(
      <DownloadHarness
        environment={{
          showSaveFilePicker: () => Promise.reject(abort),
        }}
        source={fakeSource(() => 'ok', sizesOf(file))}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Download tile pack/ }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Download tile pack/ })).toBeEnabled()
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

/* ------------------------ deleted: row A6's variant resolution in the bill (A3) */

/*
  Eight tests stood here, over a four-record extension of the shared fixture
  (`a6Catalog`): one design published twice, a dragonlock-only tile, and a tile
  with no connection tag at all. They asserted rule 0 end to end — one part under
  openlock and two under magnetic for the same placement, `wrong-system`,
  `unknown-joinery`, the `Resolved for openlock` scene summary, the per-row
  "published as 2 files" mark, and the join that kept a resolved placement
  removable rather than reporting it as retired.

  **Every one of them read a `VariantResolution`, and a fill names an exact
  file.** Nothing chooses at resolution time, so there is no verdict, no variant
  count and no option tie to report; `billView.ts` lost `resolutionSummary` and
  `rowResolutionCopy` with the type. The `unknown-joinery` mark went with them and
  was the only surface for the 93 items (2.4%) that name no connector anywhere —
  recorded here because it is a real loss rather than a tidy-up, and row **C4**
  owns where it comes back.

  Two of the eight facts are asserted elsewhere rather than dropped. That the bill
  prints exactly the file a slot names, for *either* file of a two-sided item, is
  the last test of "the two-sided item" above. That an instance stays reachable
  and removable from every line it contributed to is "says how many parts a recipe
  prints" in the bill block.

  Choosing which file of an item fills a slot is row **C2**'s, and
  `selectVariantForLock` is exported for it: a candidate grid is an *item* grid
  and the file is picked from the item afterwards.
*/


describe('the row drop rule', () => {
  /**
   * Asserted against `searchRows` directly, since row A0.
   *
   * It used to be a panel test: the library could name a design the current
   * catalog build no longer holds — an entry outlives the import that retired its
   * files — so the panel was rendered with one live key and one retired one and
   * had to show a single row. There is no library, and the rows now come from the
   * engine's own result, so **no render can reach the miss**. The rule itself is
   * unchanged and still load-bearing: a row with no name, no size and no
   * thumbnail is worse than no row, and row G5's selection channel still carries
   * a design across a navigation that a re-import can have invalidated.
   */
  it('drops a design the lookup does not hold rather than making a nameless row', () => {
    const items = index.engine.aggregates.aggregates
    expect(items.length).toBeGreaterThan(1)

    const live = items[0]!
    const rows = searchRows(items, (id) =>
      id === live.design ? { item: live, preview: index.engine.record(live.preview)! } : undefined,
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]?.item.design).toBe(live.design)
  })
})
