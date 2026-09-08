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

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useMemo } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AssemblyIndex, BillOfTiles } from '@/assembly'
import { buildAssemblyIndex, buildBillOfTiles } from '@/assembly'
import { usePlanTools } from '@/builder/canvas'
import type { UndoControls } from '@/builder/canvas/useHistory'
import type { SurfaceStatus } from '@/builder/three'
/* The `UndoControls` recorder, from the surface's fixture rather than a second
   copy here: the toolbar and the surface are handed the *same* controls by the
   screen, so a test double that drifted between the two directories would be
   asserting against a shape neither of them takes. It is a test module and
   reaches no renderer — `panels/boundary.test.ts` walks production entries. */
import { planHistory } from '@/builder/three/fixture'
import type { CatalogFile, DesignId } from '@/catalog'
import { CatalogFile as CatalogFileSchema, resolveTags, selectVariant } from '@/catalog'
import type { BlobSource, SaveEnvironment } from '@/download'
import { BlobFetchError, PreviewMeshRefusedError } from '@/download'
import { createSearchEngine, defaultFacetSearch } from '@/search'
import { resolveMaterial } from '@/materials'
import type { CatalogIndex } from '@/screens/catalog'
import type { PlacementId } from '@/store'
import {
  TemplateId,
  armTemplateInBuilder,
  clearFill,
  clearPendingArm,
  clearPersistedWorkshopState,
  placeTemplate,
  resetWorkshop,
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
  TWO_SLOTS,
  aStrictInstance,
  anInstance,
  fixtureContext,
  fixtureCatalogFile,
  mixedCatalogFile,
} from './fixture'
import { TEMPLATE_FAMILIES } from './families'
import { forgetRecentFamilies } from './palette'
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

/**
 * A placement id for the selection {@link PaletteHarness} opens with.
 *
 * It names nothing in the store on purpose: what the palette does to a selection
 * is drop it, and dropping it does not require it to resolve. `usePlanTools`
 * holds a bare id and `selection.ts` is what looks one up against a scene.
 */
const SELECTED_PIECE = 'p0' as PlacementId

let file: CatalogFile
let index: CatalogIndex
let assembly: AssemblyIndex

beforeEach(() => {
  resetWorkshop()
  clearPersistedWorkshopState()
  // The RECENT ring is module-level session state (`palette.ts` argues why it is
  // not in the store), so a family armed by one test is still in it for the next.
  forgetRecentFamilies()
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
 * **The armed readout is `PlanTools` again.** Row A8 had reduced this panel to
 * its own private selection, because the list was the archive and the surface
 * places a family; row C1 replaced the list with the 87 templates, so
 * `tools.selectedTemplate` is the armed value and the panel keeps no copy of it.
 * {@link armedRow} reads the DOM for the same fact, which is where a *user* sees
 * it, and the two agree on every assertion below.
 *
 * `forgetRecentFamilies()` runs in this file's `beforeEach`: the RECENT ring is
 * module-level session state (`palette.ts` argues why it is not in the store), so
 * a family armed by one test would still be in it for the next.
 *
 * **It opens with a piece selected, which is not idle scenery.** The harness used
 * to open in `erase` so that arming could be shown to force `place`; there are no
 * modes to force, and what took that assertion's place is the invariant that
 * replaced them — arming from the palette *clears the selection*, because both
 * states claim the primary button and `usePlanTools` holds at most one of them.
 * So the readouts below are `activity` and `selected` rather than `tool`, and
 * every arming assertion checks the selection went with it.
 */
function PaletteHarness({ query = '' }: { query?: string }) {
  const tools = usePlanTools({ selected: SELECTED_PIECE })
  return (
    <div>
      <PalettePanel
        index={index}
        tools={tools}
        search={{ ...defaultFacetSearch(), q: query }}
        onQueryChange={() => undefined}
      />
      <p data-testid="selected-template">{tools.selectedTemplate ?? 'none'}</p>
      {/* Row C5: the armed **size**, as `PlanTools` now carries it. The chip on
          screen is the same fact rendered by the panel; this is the fact the 3D
          surface reads to solve the fills, and the two must not diverge. */}
      <p data-testid="armed-size">{tools.armedSize.join(' ') || 'any'}</p>
      <p data-testid="activity">{tools.activity}</p>
      <p data-testid="selected-piece">{tools.selected ?? 'none'}</p>
    </div>
  )
}

/** A palette row, as against a facet chip or a size chip — both are also buttons. */
const isRow = (button: HTMLElement): boolean => button.className.includes('of-pal-pick')

/** Every template row's accessible name, which is the family's **full** name. */
function paletteRows(): string[] {
  return screen
    .queryAllByRole('button')
    .filter(isRow)
    .map((button) => button.getAttribute('aria-label') ?? '')
}

/** The full name on the pressed palette row, or `'none'`. */
function armedRow(): string {
  const pressed = screen.queryAllByRole('button', { pressed: true }).filter(isRow)
  const first = pressed[0]
  return first === undefined ? 'none' : (first.getAttribute('aria-label') ?? '')
}

/**
 * One row, by the family's full name.
 *
 * The **last** match, because a family that is also in the RECENT ring has two
 * rows and RECENT is rendered first — so this is always the row in the family's
 * own group, which is the one a test means when it names a group's heading in
 * the same breath.
 */
function row(name: string): HTMLElement {
  const found = screen
    .queryAllByRole('button')
    .filter(isRow)
    .filter((candidate) => (candidate.getAttribute('aria-label') ?? '').startsWith(`${name},`))
  const last = found[found.length - 1]
  if (last === undefined) throw new Error(`no palette row named "${name}"`)
  return last
}

/** The pressed size chip's label, or `'none'`. */
function armedSize(): string {
  const group = screen.queryByRole('group', { name: /^Size for / })
  if (group === null) return 'none'
  const pressed = within(group).getAllByRole('button', { pressed: true })[0]
  return pressed === undefined ? 'none' : (pressed.getAttribute('aria-label') ?? '')
}

describe('the palette', () => {
  it('lists the 87 templates this build ships, and nothing from the archive', () => {
    // The list was the **library** until row A0 and the **archive search** until
    // this row: 3,822 items, none of them placeable, which is why row A8 had to
    // make the panel arm nothing at all. What is here now is B4's 47 generated
    // families plus the 40 shipped recipes. (51 families until row D1 dropped the
    // four whose whole population was bases; 89 rows while row E3's two authored
    // assemblies shipped, and both are withdrawn.)
    render(<PaletteHarness />)

    expect(paletteRows()).toHaveLength(87)
    // Row D2: the total is two section headings rather than one, because the
    // two counts are the fact the owner needed and 87 was not.
    expect(screen.getByRole('heading', { name: /^Assemblies 40/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^Single tiles 47/ })).toBeInTheDocument()
    // Not the archive, and not the library before it.
    expect(screen.queryByRole('heading', { name: /Archive/ })).toBeNull()
    expect(screen.queryByRole('heading', { name: /Library/ })).toBeNull()
    // The fixture's nine items are 3,822's stand-in and not one of them is a row.
    expect(screen.queryByText(FIXTURE_NAMES.floor1)).toBeNull()
  })

  it('groups the single tiles by role, in corpus order, under the assemblies', () => {
    // §3.1's grouping, now one level down. Ordered by records rather than by
    // family count — wall 5,381, floor 2,162, riser 319, column 223, stair 206,
    // roof 100, decor 26 — then the bare-base family, which A9 proved no
    // `(role, form, build)` key can name. **The ninth group is gone**: the 40
    // authored recipes carry no role at all and were listed under a heading
    // naming their build system, which is how the owner came to place a one-slot
    // corner and conclude the templates were broken.
    render(<PaletteHarness />)

    const headings = screen
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent ?? '')
    expect(headings.map((heading) => heading.replace(/\d+$/, '').trim())).toEqual([
      'Wall',
      'Floor',
      'Riser',
      'Column',
      'Stair',
      'Roof',
      'Decor',
      'Base',
    ])
    // 17 wall families, and the group heading carries the count.
    expect(headings[0]).toContain('17')
    expect(headings).not.toContain('S2W: Wall on Tile')
    // There is no `insert` group: `role|insert` is a perfect bijection with
    // `layer === 'insert'` and 262 of those 285 records are already reachable as
    // a fill for a host tile's accessory slot, so the panel says where they live.
    expect(headings).not.toContain('Insert')
    expect(screen.getByText(/inserts are not templates/i)).toBeInTheDocument()
  })

  it('puts the 40 assemblies above all 47 single tiles', () => {
    /* **The defect, as a DOM order.** The owner placed a corner, got a one-slot
       row, and reported that they could not modify the walls or pick a floor —
       *"Thats the whole point of the templates I wanted."* The assembly they were
       describing was in the build all along, as row 50 of 87. The kind of thing a
       row is is now the first division the list makes. */
    render(<PaletteHarness />)

    const rows = paletteRows()
    /* 40 assemblies first, and every one of them carries the shipped prefix. Row
       E3's two did not — deliberately, because D4 measured that the `S2W:`
       opening all 40 names is the *floor's* build system and E3's widened wall
       lifted exactly that requirement off its floor slot. Both are withdrawn, and
       with them the only rows in this section whose name did not begin `S2W:`. */
    expect(rows.slice(0, 40).filter((name) => name.startsWith('S2W: Wall on Tile: '))).toHaveLength(40)
    expect(rows.slice(40).some((name) => name.includes('Wall on Tile: '))).toBe(false)
    // Two section headings, assemblies first, each carrying its own count.
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent ?? ''),
    ).toEqual(['Assemblies 40', 'Single tiles 47'])
  })

  it('states a slot count on every row, and it is the template\u2019s own part count', () => {
    /* Row D2's third fix and the one the report was literally about: *"It shows
       everywhere as having one slot only."* The number is
       `template.parts.length` and never a count of the slots that still need a
       choice — `screens/assemblies/assembly.ts` measured that the 20 parts
       declaring `fulfills` cover a *nested* blueprint's slots and have no sibling
       impact, so a 5-part corner really is five choices. */
    render(<PaletteHarness />)

    for (const family of TEMPLATE_FAMILIES) {
      expect(family.slots).toBe(family.template.parts.length)
      expect(row(family.name).getAttribute('aria-label')).toContain(
        `, ${String(family.slots)} slot${family.slots === 1 ? '' : 's'},`,
      )
    }
    /* The two populations, as the two things the palette now distinguishes. Row
       E3's corridor was the build's only **4** — a corner's part set minus the
       column — and is withdrawn, so the assemblies are 3s and 5s again. */
    expect(new Set(TEMPLATE_FAMILIES.filter((f) => f.kind === 'recipe').map((f) => f.slots))).toEqual(
      new Set([3, 5]),
    )
    expect(new Set(TEMPLATE_FAMILIES.filter((f) => f.kind === 'family').map((f) => f.slots))).toEqual(
      new Set([1]),
    )
  })

  it('ranks the assembly the owner wanted first for their own query', () => {
    /* `corner` is what they were looking for, and **fourteen** one-slot rows have
       the word in their name — the brief for this row said eleven, and it was
       sixteen before row D1 dropped two of them as base-only. The section puts
       the 8 assemblies above all 14; `palette.ts#rankFamilies` then orders inside
       the section by where the token landed and, for a tie, by how many `': '`
       qualifiers the query did not ask for — so the unqualified
       `Corner (Any, …)` sorts above `Corner: Low (…)`. */
    render(<PaletteHarness query="corner" />)

    const rows = paletteRows()
    expect(rows).toHaveLength(22)
    expect(rows[0]).toContain('S2W: Wall on Tile: Corner (Any, Single Piece)')
    expect(rows.slice(0, 8).every((name) => name.startsWith('S2W: Wall on Tile: '))).toBe(true)
    // The internal corners are still corners and still shown, below the four
    // whose label *starts* with the word.
    expect(rows.slice(0, 4).some((name) => name.includes('Internal'))).toBe(false)
    // An extra token pays for the qualifier and the order inverts, which is what
    // makes the tiebreak a ranking rather than a preference for short names.
    cleanup()
    render(<PaletteHarness query="corner low" />)
    expect(paletteRows()[0]).toContain('S2W: Wall on Tile: Corner: Low (Single Piece)')
  })

  it('takes the shared prefix off an assembly label and keeps the build system on the row', () => {
    /* The 40 rows lost the heading that said `S2W: Wall on Tile`, so the build
       system moved onto the row — from the template's own `build|` tag, which is
       a per-row fact and stays right when a second build system's assemblies
       land. */
    render(<PaletteHarness />)

    const assembly = row('S2W: Wall on Tile: Corner (Any, Single Piece)')
    expect(within(assembly).getByText('Corner (Any, Single Piece)')).toBeInTheDocument()
    expect(assembly.textContent).toContain('5 slots')
    expect(assembly.textContent).toContain('S2W')
    expect(assembly.getAttribute('aria-label')).toBe(
      'S2W: Wall on Tile: Corner (Any, Single Piece), 5 slots, S2W build system',
    )
  })

  it('takes the role off a row name, because the heading already said it', () => {
    render(<PaletteHarness />)

    // `Wall: Straight (Separate Wall)` under a heading that says WALL spends a
    // third of a 272px column repeating itself.
    expect(within(row('Wall: Straight (Separate Wall)')).getByText('Straight (Separate Wall)')).toBeInTheDocument()
    expect(screen.queryByText('Wall: Straight (Separate Wall)')).toBeNull()
    // And the 40 recipes lose the prefix all 40 share.
    expect(
      within(row('S2W: Wall on Tile: Corner: Low (Single Piece)')).getByText('Corner: Low (Single Piece)'),
    ).toBeInTheDocument()
  })

  it('arms a family, writes it to the tool state and drops the selection', () => {
    // **Row A8's reduction, undone.** The panel wrote nothing to `PlanTools`
    // because a `DesignId` in `selectedTemplate` would report every placement
    // `unknown-template`; a family id is what the surface places.
    render(<PaletteHarness />)

    expect(armedRow()).toBe('none')
    expect(screen.getByTestId('selected-template')).toHaveTextContent('none')
    expect(screen.getByTestId('activity')).toHaveTextContent('selected')

    fireEvent.click(row('Wall: Straight (Separate Wall)'))

    expect(screen.getByTestId('selected-template')).toHaveTextContent('wall-straight-separate-wall')
    expect(armedRow()).toContain('Wall: Straight (Separate Wall)')
    /* §3 said "forces place mode"; there is no mode to force, and this is what
       the sentence meant all along — a press on a palette row is the user saying
       the primary button now places, so whatever else was claiming it lets go.
       Asserted from both ends: the activity is a reading and the id is the fact
       behind it, and a panel that armed without calling `arm` would keep one. */
    expect(screen.getByTestId('activity')).toHaveTextContent('armed')
    expect(screen.getByTestId('selected-piece')).toHaveTextContent('none')
  })

  it('disarms when the armed row is pressed again', () => {
    render(<PaletteHarness />)

    fireEvent.click(row('Wall: Straight (Separate Wall)'))
    fireEvent.click(row('Wall: Straight (Separate Wall)'))

    expect(armedRow()).toBe('none')
    expect(screen.getByTestId('selected-template')).toHaveTextContent('none')
  })

  it('narrows on a query over names and axes, conjunctively', () => {
    // Two words of one family's name is the interesting query, so the tokens are
    // ANDed: an OR over `corner s2w` returns every corner and every S2W.
    render(<PaletteHarness query="corner s2w" />)

    const rows = paletteRows()
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((text) => text.toLowerCase().includes('corner'))).toBe(true)
    // `s2w` matches `build|s2w` on the rows whose visible name does not say it.
    expect(screen.getByRole('status')).toHaveTextContent(`${String(rows.length)} of 87 templates`)
  })

  it('narrows the single tiles by form and leaves the assemblies alone', () => {
    /* **`form` is an axis only 47 of the 87 carry.** C1 applied it to everything,
       so a form chip hid all 40 assemblies — and `Corner`, the most natural
       narrowing for the query the owner actually ran, emptied the section holding
       the answer. An assembly carries no `form|` tag: its form is up to five
       values in its parts' own `require` blocks. So the chip is labelled for what
       it reaches and reaches only that. */
    render(<PaletteHarness />)

    const form = screen.getByRole('group', { name: 'Tile form' })
    fireEvent.click(within(form).getByRole('button', { name: 'Octagon' }))

    // Two octagon families: `wall|octagon|separate wall` and `floor|octagon`.
    expect(screen.getByRole('heading', { name: /^Single tiles 2/ })).toBeInTheDocument()
    // And all 40 assemblies are still there, which is the point.
    expect(screen.getByRole('heading', { name: /^Assemblies 40/ })).toBeInTheDocument()
    expect(paletteRows()).toHaveLength(42)

    // Re-pressing clears it, which is what `aria-pressed` promises.
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Tile form' })).getByRole('button', { name: 'Octagon' }),
    )
    expect(paletteRows()).toHaveLength(87)
  })

  it('narrows both sections by build, because every template carries one', () => {
    // `build` is the axis both kinds have on themselves: all 40 assemblies are
    // `build|s2w`, and 7 of the 47 single tiles are.
    render(<PaletteHarness />)

    const build = screen.getByRole('group', { name: 'Build' })
    fireEvent.click(within(build).getByRole('button', { name: 'S2W' }))

    expect(screen.getByRole('heading', { name: /^Assemblies 40/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^Single tiles 7/ })).toBeInTheDocument()
    expect(paletteRows()).toHaveLength(47)

    // A build no assembly carries drops the section rather than heading nothing.
    fireEvent.click(within(screen.getByRole('group', { name: 'Build' })).getByRole('button', { name: 'S2W' }))
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Build' })).getByRole('button', { name: 'Thick Wall' }),
    )
    expect(screen.queryByRole('heading', { name: /^Assemblies/ })).toBeNull()
    expect(screen.getByRole('heading', { name: /^Single tiles 4/ })).toBeInTheDocument()
  })

  it('counts what the resolver admits, and a size position narrows it', () => {
    // **The number is `@/composition`'s own answer**, resolved through the same
    // `resolveSlotTags` a fill will be, so the row cannot disagree with what the
    // solver sees. Over the fixture, `floor|straight|-` admits five items — and
    // its `1 wide by 1 deep` position admits the two 1x1s.
    render(<PaletteHarness />)

    expect(row('Floor: Straight').getAttribute('aria-label')).toBe(
      'Floor: Straight, 1 slot, 5 tiles',
    )

    fireEvent.click(row('Floor: Straight'))
    expect(armedSize()).toBe('any size, 5 tiles')

    const sizes = screen.getByRole('group', { name: 'Size for Floor: Straight' })
    fireEvent.click(within(sizes).getByRole('button', { name: /^1 wide by 1 deep/ }))

    expect(armedSize()).toBe('1 wide by 1 deep, 2 tiles')
    // The row's own number follows the chosen position, because that is the set
    // a fill will come from.
    expect(row('Floor: Straight').getAttribute('aria-label')).toBe(
      'Floor: Straight, 1 slot, 2 tiles',
    )
  })

  it('offers the size control on the armed family only', () => {
    // 304 positions over 47 families: on all of them at once the column would be
    // a wall of chips, and the control's subject is the family being armed.
    render(<PaletteHarness />)
    expect(screen.queryByRole('group', { name: /^Size for/ })).toBeNull()

    fireEvent.click(row('Wall: Straight (Separate Wall)'))
    const sizes = screen.getByRole('group', { name: 'Size for Wall: Straight (Separate Wall)' })
    // Eight positions, `any size` first and pressed.
    expect(within(sizes).getAllByRole('button')).toHaveLength(8)
    expect(armedSize()).toContain('any size')
    // Exactly one control on screen: arming another family moves it.
    fireEvent.click(row('Wall: Curve (Separate Wall)'))
    expect(screen.getAllByRole('group', { name: /^Size for/ })).toHaveLength(1)
    expect(screen.getByRole('group', { name: 'Size for Wall: Curve (Separate Wall)' })).toBeInTheDocument()
  })

  it('gives no size control to a family the archive tags no size for', () => {
    // **7 families, not the 5 this row was briefed with**: B3's five empty
    // domains plus two whose domain is real and inexpressible — `stair|curve`
    // and `column|corner|s2w`. (It was 8 until row D1 dropped
    // `floor|curve|separate wall` as base-only.) Either way the emitted table
    // holds one position, and a control with one position cannot be operated, so
    // the row gets a sentence instead.
    render(<PaletteHarness />)

    fireEvent.click(row('Decor: Straight'))

    expect(screen.queryByRole('group', { name: /^Size for/ })).toBeNull()
    expect(screen.getByText(/archive tags no size for this family/)).toBeInTheDocument()
    // And the family is armed all the same: `any size` is what it places at.
    expect(screen.getByTestId('selected-template')).toHaveTextContent('decor-straight')
  })

  it('shows slots and a build system on an assembly, and offers it no size', () => {
    // An assembly has 3 or 5 slots, so one candidate count cannot answer "how
    // many tiles fill this"; and its parts `require` their own `size|width|2`, so
    // a size is part of which assembly this is rather than a parameter of the
    // placement — a size control here would be a chip that changed nothing,
    // because no `constrain` block would collect its tags.
    render(<PaletteHarness />)

    const recipe = row('S2W: Wall on Tile: Corner: Low (Single Piece)')
    expect(recipe.getAttribute('aria-label')).toContain('5 slots')
    expect(recipe.textContent).toContain('5 slots')
    expect(recipe.textContent).toContain('S2W')
    expect(TEMPLATE_FAMILIES.filter((f) => f.kind === 'recipe' && f.sizes.length > 0)).toEqual([])

    fireEvent.click(recipe)
    expect(screen.queryByRole('group', { name: /^Size for/ })).toBeNull()
    expect(screen.getByTestId('selected-template')).toHaveTextContent(
      's2w-wall-on-tile-corner-low-single-piece',
    )
  })

  it('remembers what was armed, newest first, as a strip and not a third section', () => {
    // RECENT **mitigates** the recognition cost and does not fix it — the
    // research was explicit and `palette.ts` keeps the claim honest where the
    // ring is implemented. Session state, so a reload starts it empty.
    render(<PaletteHarness />)
    expect(screen.queryByRole('group', { name: 'Recent' })).toBeNull()

    fireEvent.click(row('Wall: Straight (Separate Wall)'))
    fireEvent.click(row('Wall: Curve (Separate Wall)'))

    const recent = () => screen.getByRole('group', { name: 'Recent' })
    expect(
      within(recent())
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual([
      'Wall: Curve (Separate Wall), any size',
      'Wall: Straight (Separate Wall), any size',
    ])
    // **A strip, because a group would duplicate rows.** All 87 rows are always
    // listed, so a RECENT group would put a second pressed row — and a second
    // live size control — on screen for the same family.
    expect(paletteRows()).toHaveLength(87)
    expect(screen.getAllByRole('button', { pressed: true }).filter(isRow)).toHaveLength(1)

    // The ring is a set with an order: arming one twice does not spend two slots.
    fireEvent.click(row('Wall: Curve (Separate Wall)'))
    fireEvent.click(row('Wall: Curve (Separate Wall)'))
    expect(within(recent()).getAllByRole('button')).toHaveLength(2)
  })

  it('remembers the size too, so re-placing a 2x2 floor is one press', () => {
    // The ring holds *arms*, not families: a user who has just put down four 2x2
    // floors wants the fifth at 2x2, and a chip that armed the family at `any
    // size` would drop the only part of the choice they made twice.
    render(<PaletteHarness />)

    fireEvent.click(row('Floor: Straight'))
    const sizes = screen.getByRole('group', { name: 'Size for Floor: Straight' })
    fireEvent.click(within(sizes).getByRole('button', { name: /^2 wide by 2 deep/ }))
    // Disarm, so the chip has something to restore.
    fireEvent.click(row('Floor: Straight'))
    expect(armedRow()).toBe('none')

    const chip = within(screen.getByRole('group', { name: 'Recent' })).getByRole('button', {
      name: 'Floor: Straight, 2 wide by 2 deep',
    })
    fireEvent.click(chip)

    expect(screen.getByTestId('selected-template')).toHaveTextContent('floor-straight')
    expect(armedSize()).toBe('2 wide by 2 deep, 1 tiles')
    // Two sizes of one family are two arms, which is the point of holding the
    // size at all.
    fireEvent.click(within(screen.getByRole('group', { name: 'Size for Floor: Straight' })).getByRole('button', { name: /^any size/ }))
    expect(
      within(screen.getByRole('group', { name: 'Recent' })).getAllByRole('button'),
    ).toHaveLength(2)
  })

  it('hands the armed size to `PlanTools`, which is what the click solves with', () => {
    /* **Row C5's handoff.** The size position was `PalettePanel`'s own state
       while nothing read it, and C1 wrote down the consequence: *2 wide by 2
       deep* narrowed a count on screen and the placement got the solver's
       default, because `three/edits.ts` placed with `fills: {}`. The position now
       lives beside the family in `PlanTools`, which is the only object the
       palette and the 3D surface share. */
    render(<PaletteHarness />)

    fireEvent.click(row('Floor: Straight'))
    expect(screen.getByTestId('armed-size')).toHaveTextContent('any')

    const sizes = screen.getByRole('group', { name: 'Size for Floor: Straight' })
    fireEvent.click(within(sizes).getByRole('button', { name: /^2 wide by 2 deep/ }))

    // The exact `size|` spelling `FillContext.size` takes, so the palette and
    // B4's `GENERATED_FAMILY_SIZES` cannot drift into two vocabularies.
    expect(screen.getByTestId('armed-size')).toHaveTextContent('size|width|2 size|depth|2')
    expect(armedSize()).toBe('2 wide by 2 deep, 1 tiles')
  })

  it('drops the armed size when a different family is armed', () => {
    /* A position is a list of `size|` tags and B4's domains differ per family —
       7 of the 47 have none at all. Carrying 2x2 across would hand the solver a
       size the new family's candidates may not carry, which C2 classifies
       `no-candidate` (*nothing in the archive is this size*) for a size the user
       chose for a different row. */
    render(<PaletteHarness />)

    fireEvent.click(row('Floor: Straight'))
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Size for Floor: Straight' })).getByRole('button', {
        name: /^2 wide by 2 deep/,
      }),
    )
    fireEvent.click(row('Wall: Straight (Separate Wall)'))

    expect(screen.getByTestId('armed-size')).toHaveTextContent('any')
  })

  it('says nothing about a starter set, and nothing about placing being unwired', () => {
    // §2.4's "Add a starter set" put six *tiles* in the library; row A0 deleted
    // both and a starter set, if it comes back, is a starter room. Row A8's
    // "placing is not wired to this list" note goes with the list it was about —
    // asserted as an absence so nobody reinstates a disclaimer that is no longer
    // true.
    render(<PaletteHarness />)

    expect(screen.queryByRole('button', { name: /Add a starter set/ })).toBeNull()
    expect(screen.queryByText(/Placing is not wired to this list yet/)).toBeNull()
    expect(screen.queryByText(/arms nothing/)).toBeNull()
  })

  it('says nothing matched, and where the archive went', () => {
    render(<PaletteHarness query="dungeon stone" />)

    expect(paletteRows()).toHaveLength(0)
    // A texture is not a family axis: 89 rows x 36 reachable texture roots is
    // 3,204, which is the recall cost §3.1 inverted. So the panel points at the
    // surface that does index textures.
    expect(screen.getByText(/search the catalog screen/i)).toBeInTheDocument()
  })
})

/* ----------------------------------------------- the "use in builder" handoff */

/**
 * Row G5's reader side, carrying row C1's arm.
 *
 * The channel is cleared around every test in this block rather than in the
 * file's shared `beforeEach`: it is not part of `WorkshopState`, so
 * `resetWorkshop()` does not touch it, and a value left in the box would arm a
 * palette in an unrelated test.
 *
 * **What arrives is a family and a size**, not a design — `store/selection.ts`
 * carries the decision and the drawer's side of it is `detail.test.tsx`.
 */
describe('the pre-selection handoff', () => {
  beforeEach(() => {
    clearPendingArm()
  })

  afterEach(() => {
    clearPendingArm()
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

  it('arms the family the drawer sent, at the size it sent, and drops the selection', () => {
    // Exactly what `TileDrawer`'s action does, in its order: post the arm, then
    // navigate — the navigation being this render. It used to post an item and
    // seed the palette's search with its name, because the list was the archive;
    // a tile's name narrows a list of family names to nothing, so the arm is the
    // whole handoff now.
    act(() => {
      armTemplateInBuilder({
        template: 'floor-straight' as TemplateId,
        size: ['size|width|1', 'size|depth|1'],
      })
    })

    mountPalette()

    expect(screen.getByTestId('selected-template')).toHaveTextContent('floor-straight')
    expect(armedRow()).toContain('Floor: Straight')
    expect(armedSize()).toBe('1 wide by 1 deep, 2 tiles')
    // The harness opens with a piece selected; a handoff arms through the same
    // `arm` a click does, so it drops the selection exactly as a click does.
    expect(screen.getByTestId('activity')).toHaveTextContent('armed')
    expect(screen.getByTestId('selected-piece')).toHaveTextContent('none')
  })

  it('claims the handoff once, so a re-mount does not re-arm a family the user disarmed', () => {
    act(() => {
      armTemplateInBuilder({ template: 'floor-straight' as TemplateId, size: [] })
    })

    const first = mountPalette()
    expect(screen.getByTestId('selected-template')).toHaveTextContent('floor-straight')
    expect(useSelectionStore.getState().pending).toBeNull()

    first.unmount()
    mountPalette()
    expect(screen.getByTestId('selected-template')).toHaveTextContent('none')
    // Nothing armed, so the fresh mount is back on the selection it opened with.
    expect(screen.getByTestId('activity')).toHaveTextContent('selected')
  })

  it('takes the second press when two arrive with no claim between them', () => {
    act(() => {
      armTemplateInBuilder({ template: 'floor-straight' as TemplateId, size: [] })
      armTemplateInBuilder({ template: 'wall-straight' as TemplateId, size: [] })
    })

    mountPalette()
    expect(screen.getByTestId('selected-template')).toHaveTextContent('wall-straight')
  })

  it('arms nothing for a family this build does not ship, and still claims the box', () => {
    // The one reachable failure, and it is narrower than row A0's guard: that one
    // also refused the 370 items with no footprint, which is a property of a
    // *fill* and not of a family. A share link or a tab left open across a
    // re-import is what reaches this.
    act(() => {
      armTemplateInBuilder({ template: 'wall-retired-and-gone' as TemplateId, size: [] })
    })

    mountPalette()

    expect(screen.getByTestId('selected-template')).toHaveTextContent('none')
    // And nothing armed means nothing was dropped either: a handoff the palette
    // refuses must not take the user's selection with it.
    expect(screen.getByTestId('activity')).toHaveTextContent('selected')
    // Claimed all the same: a handoff this palette will not act on must not sit
    // in the box waiting to arm the next mount.
    expect(useSelectionStore.getState().pending).toBeNull()
  })

  it('falls back to any size when the position no longer exists', () => {
    // A catalog re-import between the press and the claim can retire the cell a
    // position named. `any size` is a real position — the slot's `constrain`
    // collects nothing and the family admits every size — so this degrades
    // rather than failing.
    act(() => {
      armTemplateInBuilder({ template: 'floor-straight' as TemplateId, size: ['size|width|99'] })
    })

    mountPalette()

    expect(screen.getByTestId('selected-template')).toHaveTextContent('floor-straight')
    expect(armedSize()).toBe('any size, 5 tiles')
  })

  it('clears a facet so the armed row is on screen', () => {
    // A filter the user set ten minutes ago on another screen must not hide the
    // row a press on a third screen just armed.
    const view = mountPalette()
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Tile form' })).getByRole('button', { name: 'Octagon' }),
    )
    expect(paletteRows()).toHaveLength(42)
    view.unmount()

    act(() => {
      armTemplateInBuilder({ template: 'floor-straight' as TemplateId, size: [] })
    })
    mountPalette()

    expect(paletteRows()).toHaveLength(87)
    expect(armedRow()).toContain('Floor: Straight')
  })

  it('arms a family, and the bill prints exactly what the slots name', () => {
    // The channel is a selection, never a resolution — and since row A3 nothing
    // downstream resolves either. What the arm names is a family; what the bill
    // prints is whatever file a *fill* names, which is row C2's choice to make.
    act(() => {
      armTemplateInBuilder({ template: 'floor-straight' as TemplateId, size: [] })
    })

    mountPalette()
    expect(screen.getByTestId('selected-template')).toHaveTextContent('floor-straight')

    const bill = buildBillOfTiles([anInstance([FIXTURE_IDS.floor2])], assembly, {
      ...fixtureContext(file),
      lock: 'openlock',
    })
    expect(bill.placements).toBe(1)
    expect(bill.parts).toBe(1)
    expect(bill.lines.map((line) => line.tile.id)).toEqual([FIXTURE_IDS.floor2])
  })
})

/* -------------------------------------------------------- the two-sided item */

/**
 * The bug the owner reported, and what is left of it once the palette stops
 * showing pictures.
 *
 * `MIXED_INTEGRAL` joins `floor2`'s design, so `d-floor-2` becomes the corpus's
 * `both` class: a `topper` that needs a base, and an `integral` that does not.
 * **931 live items (24.4%) are this shape and on all 931 the two rules disagree**
 * — `TileAggregate.preview` names the topper and `selectVariant` names the
 * integral.
 *
 * Rows V3 and V5 pinned that in *this file*, because the palette rendered one
 * and armed the other. **Row C1 deleted both halves of that pairing**: a palette
 * row is a family, a family has no picture, and picking a representative tile to
 * show would put the owner's defect back in a new place (`palette.ts` argues it).
 * So two of this block's four tests are gone rather than rewritten:
 *
 *   - *"renders the topper in the row, not the file the resolver would print"* —
 *     the rendered half of the finding. **It has no home in this file any more**,
 *     and the one surface that still renders `item.preview` is the catalog card;
 *     this row's report names that as the place it should be re-asserted, because
 *     nothing else in the suite renders a preview and compares it to the print.
 *     The headless half survives in `palette.corpus.test.ts`, which measures the
 *     disagreement on all 931 items under all three locks.
 *   - *"keeps the row pressed when the lock preference changes under it"* —
 *     there is no file in a palette row for a preference to move. The property is
 *     now structural: `aria-pressed` compares two `TemplateId`s, and nothing in
 *     the store can change either one.
 *
 * What is kept is the premise (the item really is two-sided) and the bill's half
 * of the identity, because that is the assertion a future row would otherwise
 * have to reconstruct.
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

  /** The item really is two-sided, so the assertion below is not vacuous. */
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

  /**
   * The palette arms a family, and the bill prints whatever a slot names.
   *
   * **The two-sidedness has stopped reaching the bill at all, and that is the
   * finding this test carries.** V3's defect was that the palette armed a *file*
   * and rule 0 then printed a different one, on every one of the 931 two-sided
   * items. Both halves are gone: the palette arms a family (row C1) and a fill
   * names an exact file (row A3), so the file in the bill is the file in the slot
   * and no rule can move it. Choosing *which* file of an item fills a slot is row
   * **C2**'s, and `selectVariantForLock` is still exported for it.
   */
  it('arms a family, and the bill prints exactly the file the slot names', () => {
    render(<PaletteHarness />)
    fireEvent.click(row('Floor: Straight'))
    expect(screen.getByTestId('selected-template')).toHaveTextContent('floor-straight')
    // Both files of the two-sided item are in that family's candidate set, and
    // the family names neither of them: it is the *slot* that will.
    expect(row('Floor: Straight').getAttribute('aria-label')).toBe(
      'Floor: Straight, 1 slot, 5 tiles',
    )

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
})

/* -------------------------------------------------------------- the toolbar */

/**
 * The undo controls for every toolbar test that is not about undo.
 *
 * Both stacks report available, which is what keeps the Rotate / Clear / snap
 * assertions below reading a bar in its ordinary state rather than one with two
 * disabled buttons on the left. A test whose subject *is* undo passes its own
 * recorder, so it can read `calls`.
 */
const INERT_HISTORY = planHistory()

function ToolbarHarness({ moving, history }: { moving?: string; history?: UndoControls }) {
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
          activity: tools.activity,
          hint: '',
          selectedName: null,
          refusal: null,
          moving,
          placements: placed,
          conflicts: 0,
        }
  return (
    <div>
      <button type="button" onClick={() => tools.arm(ONE_SLOT_TEMPLATE_ID)}>
        arm
      </button>
      <PlanToolbar
        tools={tools}
        status={status}
        armedStep={armedStep}
        placed={placed}
        history={history ?? INERT_HISTORY}
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

  /**
   * The two buttons that took the mode toggle's place, and the substitution is
   * why they are tested here rather than only in `history.test.ts`.
   *
   * `Place` / `Erase` / `Move` are **gone**, and so are the two tests that
   * pressed them — one asserted the toggle swapped `place` for `erase`, the
   * other that `Move` came up and the other two went down. Both were assertions
   * about a mode, and there is no mode: what the primary button means is a
   * reading of what is armed or selected. The reason that is *safe* for the
   * destructive verb the `Erase` mode used to guard is undo, so undo is what
   * this bar gained, and these are its tests.
   */
  it('offers undo and redo where the three modes were', () => {
    render(<ToolbarHarness />)

    expect(screen.getByRole('button', { name: /^Undo/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Redo/ })).toBeInTheDocument()
    // The names the deleted toggle went by. Queried rather than reasoned about,
    // so re-adding any of them fails here.
    for (const mode of ['Place', 'Erase', 'Move']) {
      expect(screen.queryByRole('button', { name: mode })).toBeNull()
    }
  })

  it('disables each button when its own stack is empty', () => {
    // Independently, and both directions of each: a bar that disabled the pair
    // together would hide a redo the user has and offer an undo they do not.
    render(<ToolbarHarness history={planHistory({ canUndo: false })} />)
    expect(screen.getByRole('button', { name: /^Undo/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^Redo/ })).toBeEnabled()

    cleanup()
    render(<ToolbarHarness history={planHistory({ canRedo: false })} />)
    expect(screen.getByRole('button', { name: /^Undo/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /^Redo/ })).toBeDisabled()
  })

  it('says why a disabled button is disabled, rather than only looking dead', () => {
    // The clipped half of the label. A `disabled` button with no reason on it is
    // the state a screen-reader user cannot tell from a broken one.
    render(<ToolbarHarness history={planHistory({ canUndo: false, canRedo: false })} />)
    expect(screen.getByRole('button', { name: /nothing to undo/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /nothing to redo/i })).toBeInTheDocument()
  })

  it('calls through to the ring, one call per press', () => {
    // The wire, and it is worth asserting because the toolbar takes the controls
    // as a prop precisely so that its buttons and the canvas's Ctrl+Z walk one
    // ring: a bar that built its own would undo a different history.
    const history = planHistory()
    render(<ToolbarHarness history={history} />)

    fireEvent.click(screen.getByRole('button', { name: /^Undo/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Redo/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Redo/ }))

    expect(history.calls).toEqual({ undo: 1, redo: 2 })
  })

  it('names the piece in the air, which nothing else on the bar can see', () => {
    // A piece mid-carry is ephemeral component state inside the surface that no
    // store write has happened for yet — so the readout is the only place it is
    // visible, and it is the one editing state undo cannot describe either.
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
    splitPlans: undefined,
    saveSplitPart: () => undefined,
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
   * **Row A11: the same hole, reached by emptying a slot that was filled.**
   *
   * Before `clearFill` this state was unreachable from inside the app —
   * `fillSlot` and `pinFill` both write a tile, so a complete instance stayed
   * complete and `relock.ts` could only *report* a stale fill it could not
   * remove. The assertion is the one brief point 1 asks for: clearing must make
   * the download refuse, so the pack cannot ship a piece one part short.
   *
   * `bill.complete` is asserted directly as well as through the panel, because
   * that boolean is what `useArchiveDownload` refuses on — the copy is what the
   * user reads and the flag is what stops the bytes.
   */
  it('refuses the download once a slot is cleared, and names the slot', () => {
    let id = '' as PlacementId
    act(() => {
      id = placeTemplate(anInstance([FIXTURE_IDS.floor1, FIXTURE_IDS.floor2], { x: 1, z: 2 }))
    })
    render(<BillHarness />)

    const billNow = (): BillOfTiles =>
      buildBillOfTiles(Object.values(useWorkshopStore.getState().placements), assembly, {
        ...fixtureContext(file),
        lock: 'openlock',
      })

    // Both slots filled: nothing to fault and nothing refused.
    expect(billNow().complete).toBe(true)
    expect(document.querySelectorAll('.of-bill-fault')).toHaveLength(0)

    act(() => {
      expect(clearFill(id, TWO_SLOTS[1]!)).toBe('cleared')
    })

    // C-g: the piece is still on the plan, and the *pack* is what refuses.
    expect(billNow().complete).toBe(false)
    expect(screen.getByText(/1 piece placed/)).toBeInTheDocument()
    expect(screen.getByText(/1 slot is still empty/)).toBeInTheDocument()
    const fault = screen.getByText(/panels-two-slot · wall · x 1, z 2/)
    expect(fault.closest('.of-bill-fault')).toHaveAttribute('data-blocking', '')
    expect(screen.getByText(/Nothing is in this slot/)).toBeInTheDocument()
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

  /**
   * **Splitting is not offered when it cannot help.**
   *
   * One 600 MB file against a 1 MB ceiling: every candidate part is already over
   * the limit before a byte of licensing is reserved, so `splitArchivePlans`
   * raises `ArchivePartTooLargeError` and the failure carries no parts. The URL
   * list stays the only offer, which is what the test above asserts it still is.
   */
  it('does not offer to split when one file alone is over the limit', async () => {
    place('big')
    render(
      <DownloadHarness
        environment={blobEnvironment(1_000_000)}
        source={fakeSource(() => 'ok', sizesOf(file))}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Download tile pack/ }))
    const alert = await failureText()

    expect(alert).toHaveAttribute('data-kind', 'too-large')
    expect(within(alert).queryByRole('button', { name: /Save as .* smaller files/ })).toBeNull()
    expect(alert).toHaveTextContent(/Take the URL list instead and feed it to a download manager/)
  })

  /**
   * **The split offer, taken one part at a time.**
   *
   * Six distinct files — 8 MB, 3 MB, 1.2 MB, 1 MB, 0.9 MB and 0.5 MB, 14.6 MB
   * of models between them — against a 12 MB ceiling. The room does not fit, so
   * the refusal fires exactly as above; but the largest single file (8 MB) sits
   * inside a part's 10 MB budget (12 MB less `SPLIT_OVERHEAD_BYTES`), so
   * first-fit-decreasing packs the six into **two** parts and the failure now
   * carries them.
   *
   * Each part is saved on its own press. Nothing is auto-triggered: two
   * back-to-back saves with no user gesture between them is the shape browsers
   * popup-block.
   */
  it('offers a too-large room as several smaller parts, saved one press at a time', async () => {
    place('floor2', 0, 0)
    place('wallNoBase', 2, 0)
    place('arc', 4, 0)
    place('floor1', 6, 0)
    place('slab', 8, 0)
    place('base2', 10, 0)
    render(
      <DownloadHarness
        environment={blobEnvironment(12_000_000)}
        source={fakeSource(() => 'ok', sizesOf(file))}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Download tile pack/ }))
    const alert = await failureText()
    expect(alert).toHaveAttribute('data-kind', 'too-large')
    expect(alert).toHaveTextContent(/Save it as 2 smaller archives instead/)

    fireEvent.click(within(alert).getByRole('button', { name: 'Save as 2 smaller files' }))

    await waitFor(() => {
      expect(screen.getByText(/Saved part 1 of 2/)).toBeInTheDocument()
    })
    expect(saved).toHaveLength(1)
    expect(saved[0]?.filename).toMatch(/^openforge-room-\d{4}-\d{2}-\d{2}-part-1-of-2\.zip$/)
    expect(saved[0]?.blob.size).toBeLessThanOrEqual(12_000_000)

    fireEvent.click(screen.getByRole('button', { name: 'Save part 2 of 2' }))

    await waitFor(() => {
      expect(screen.getByText(/Saved all 2 parts/)).toBeInTheDocument()
    })
    expect(saved).toHaveLength(2)
    expect(saved[1]?.filename).toMatch(/-part-2-of-2\.zip$/)
    // Every model byte in the bill landed in one part or the other, once —
    // and only once: the upper bound is tight enough that a file duplicated
    // across both parts (adding at least base2's 500,000 bytes) would fail
    // it, while the gap above the measured total (14,608,166: the 14,600,000
    // of model bytes plus two parts' worth of LICENSE.txt/ATTRIBUTION.csv
    // overhead) stays loose enough not to flake on that overhead's exact size.
    const totalSavedBytes = saved.reduce((sum, entry) => sum + entry.blob.size, 0)
    expect(totalSavedBytes).toBeGreaterThan(14_600_000)
    expect(totalSavedBytes).toBeLessThan(14_800_000)
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
