// @vitest-environment jsdom
/**
 * The three panels, rendered.
 *
 * Nothing is mocked that has a real implementation available. The **real store**
 * (so a placement goes through `placeTile`'s Zod parse), the **real facet engine**
 * over a nine-record fixture through the **real `CatalogFile.parse`**, the **real
 * assembly resolver** (so a base is auto-inserted by the rule rather than by a
 * stub) and the **real archive planner** (so an entry name is the one the zip
 * would carry).
 *
 * Two seams are injected, and both are ones `@/download` publishes for exactly
 * this: {@link SaveEnvironment} and {@link BlobSource}. That is what lets every
 * download failure be exercised without a network and without a browser that can
 * save a file — which is the whole point of the table in
 * `useArchiveDownload.ts`. Injecting them is not stubbing our code; it is using
 * the parameters that module was designed around.
 *
 * There is deliberately **no test of the plan canvas here.** Row 17 owns it and
 * `../canvas/canvas.test.tsx` covers it; what this file asserts about it is one
 * thing only — that selecting a palette row arms it, which is the contract
 * between the two PRs.
 */
import { TextEncoder as NodeTextEncoder } from 'node:util'

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useMemo } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AssemblyIndex, BillOfTiles } from '@/assembly'
import { buildAssemblyIndex, buildBillOfTiles } from '@/assembly'
import { usePlanTools } from '@/builder/canvas'
import type { CatalogFile, TileId } from '@/catalog'
import { CatalogFile as CatalogFileSchema, resolveTags } from '@/catalog'
import type { BlobSource, SaveEnvironment } from '@/download'
import { BlobFetchError, PreviewMeshRefusedError } from '@/download'
import { createSearchEngine, defaultFacetSearch } from '@/search'
import type { CatalogIndex } from '@/screens/catalog'
import type { LockSystem, Placement } from '@/store'
import {
  clearPersistedWorkshopState,
  placeTile,
  resetWorkshop,
  usePlacements,
  useWorkshopStore,
} from '@/store'

import { BillPanel } from './BillPanel'
import { FIXTURE_CATALOG, FIXTURE_IDS, FIXTURE_NAMES, fixtureCatalogFile } from './fixture'
import { PalettePanel } from './PalettePanel'
import { PlanToolbar } from './PlanToolbar'
import { useArchiveDownload } from './useArchiveDownload'
import type { ArchiveDownload } from './useArchiveDownload'
import { DownloadAction } from './DownloadAction'

/* ------------------------------------------------------------------ scaffold */

const id = (key: keyof typeof FIXTURE_IDS): TileId => FIXTURE_IDS[key] as TileId

let file: CatalogFile
let index: CatalogIndex
let assembly: AssemblyIndex

beforeEach(() => {
  resetWorkshop()
  clearPersistedWorkshopState()
  file = fixtureCatalogFile()
  const engine = createSearchEngine(file)
  index = { file, engine, tagsFor: (record) => resolveTags(file, record) }
  assembly = buildAssemblyIndex(file)
})

afterEach(() => {
  resetWorkshop()
  clearPersistedWorkshopState()
  vi.unstubAllGlobals()
})

function place(key: keyof typeof FIXTURE_IDS, x = 0, z = 0): void {
  act(() => {
    placeTile({ tileId: id(key), x, z, rotation: 0 })
  })
}

function library(): string[] {
  return Object.keys(useWorkshopStore.getState().library)
}

function placementCount(): number {
  return Object.keys(useWorkshopStore.getState().placements).length
}

/* -------------------------------------------------------------- the palette */

/** The palette, plus a readout of the tool state it writes. */
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
      <p data-testid="armed">{tools.selectedTileId ?? 'none'}</p>
      <p data-testid="tool">{tools.tool}</p>
    </div>
  )
}

describe('the palette', () => {
  it('greys the tiles the plan view cannot place, and offers no control for them', () => {
    for (const key of ['floor1', 'arc', 'slab'] as const) {
      act(() => {
        useWorkshopStore.setState((state) => ({ library: { ...state.library, [id(key)]: true } }))
      })
    }
    render(<PaletteHarness />)

    // The floor and the curve are buttons; the footprint-less column is not a
    // control at all — see `PalettePanel.tsx` on why not a disabled button.
    // Row W6 made the sector placeable, so `none` is the only case left greyed.
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(3)

    const placeable = rows.filter((row) => row.hasAttribute('data-placeable'))
    expect(placeable).toHaveLength(2)
    expect(within(placeable[0] as HTMLElement).getByRole('button', { pressed: false })).toHaveTextContent(
      FIXTURE_NAMES.floor1,
    )

    for (const row of rows.filter((candidate) => !candidate.hasAttribute('data-placeable'))) {
      expect(within(row).queryAllByRole('button')).toHaveLength(0)
    }
    expect(screen.getByText('no plan shape')).toBeInTheDocument()
    // The canvas's own refusal sentence, so the two cannot disagree about why.
    expect(screen.getByText(/no derivable footprint/)).toBeInTheDocument()
  })

  it('sinks the unplaceable tiles to the end of the list rather than interleaving them', () => {
    act(() => {
      useWorkshopStore.setState({
        library: { [id('slab')]: true, [id('floor2')]: true, [id('floor1')]: true },
      })
    })
    render(<PaletteHarness />)

    const rows = screen.getAllByRole('listitem')
    expect(rows.map((row) => row.hasAttribute('data-placeable'))).toEqual([true, true, false])
    expect(rows[0]).toHaveTextContent(FIXTURE_NAMES.floor1)
    expect(rows[1]).toHaveTextContent(FIXTURE_NAMES.floor2)
  })

  it('arms the canvas when a row is selected, and forces place mode', () => {
    act(() => {
      useWorkshopStore.setState({ library: { [id('floor1')]: true } })
    })
    render(<PaletteHarness />)

    expect(screen.getByTestId('armed')).toHaveTextContent('none')
    expect(screen.getByTestId('tool')).toHaveTextContent('erase')

    fireEvent.click(screen.getByRole('button', { name: new RegExp(FIXTURE_NAMES.floor1) }))

    expect(screen.getByTestId('armed')).toHaveTextContent(FIXTURE_IDS.floor1)
    // §3: "Sets the active tile and forces place mode."
    expect(screen.getByTestId('tool')).toHaveTextContent('place')
    expect(screen.getByRole('button', { name: new RegExp(FIXTURE_NAMES.floor1) })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('disarms when the armed row is selected again', () => {
    act(() => {
      useWorkshopStore.setState({ library: { [id('floor1')]: true } })
    })
    render(<PaletteHarness />)
    const row = () => screen.getByRole('button', { name: new RegExp(FIXTURE_NAMES.floor1) })

    fireEvent.click(row())
    fireEvent.click(row())
    expect(screen.getByTestId('armed')).toHaveTextContent('none')
  })

  it('searches the whole catalog and offers "+ add" only for tiles not saved', () => {
    act(() => {
      useWorkshopStore.setState({ library: { [id('floor1')]: true } })
    })
    render(<PaletteHarness query="dungeon stone floor" />)

    // Three fixture records match, one of which is already saved — so two "+ add"
    // buttons in the results and none in the library block.
    // The `+` glyph is aria-hidden, so the accessible name starts at "add" and
    // carries the tile — forty rows must not present forty identical buttons.
    const adds = screen.getAllByRole('button', { name: /^add / })
    expect(adds.length).toBeGreaterThan(0)

    const twinAdd = screen.getByRole('button', { name: new RegExp(`add ${FIXTURE_NAMES.twin} to the library`) })
    fireEvent.click(twinAdd)
    expect(library()).toContain(FIXTURE_IDS.twin)
  })

  it('offers a starter set when the library is empty, and the set is one texture of floors and walls', () => {
    render(<PaletteHarness />)

    fireEvent.click(screen.getByRole('button', { name: /Add a starter set/ }))

    // The fixture's only textured, placeable, non-base tiles are the two
    // dungeon_stone floors and the twin; the cave wall is a topper and placeable
    // too. What matters is that a base is never offered and every id is real.
    const saved = library()
    expect(saved.length).toBeGreaterThan(0)
    for (const saved_id of saved) {
      const record = index.engine.record(saved_id as TileId)
      expect(record).toBeDefined()
      expect(record?.layer).not.toBe('base')
      expect(record?.foot.shape === 'rect' || record?.foot.shape === 'wall').toBe(true)
    }
  })
})

/* -------------------------------------------------------------- the toolbar */

function ToolbarHarness() {
  const tools = usePlanTools()
  const placements = usePlacements()
  const placed = Object.keys(placements).length
  const armed = tools.selectedTileId === null ? undefined : index.engine.record(tools.selectedTileId)
  return (
    <div>
      <button type="button" onClick={() => tools.setSelectedTileId(id('floor1'))}>
        arm
      </button>
      <PlanToolbar
        tools={tools}
        status={null}
        armed={armed}
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
})

/* ----------------------------------------------------------------- the bill */

/**
 * The bill panel over the **real store** — the same three lines the builder
 * screen uses, so a `placeTile` in a test reaches the panel by the production
 * path rather than through a prop.
 */
function BillHarness({ download }: { download?: ArchiveDownload }) {
  const placements = usePlacements()
  const bill = useMemo(() => buildBillOfTiles(Object.values(placements), assembly, { lock: 'openlock' }), [placements])
  return (
    <BillPanel
      bill={bill}
      placements={placements}
      assets={file.assets}
      sheet={file.sprite}
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
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('0 tiles placed')
    expect(screen.getByText(/Nothing placed yet/)).toBeInTheDocument()

    place('floor1', 0, 0)
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('1 tile placed')

    place('floor1', 2, 0)
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('2 tiles placed')
  })

  it('dedupes by md5, not by tile id', () => {
    // Two different catalog paths over one mesh — 171 live md5s are shared by 520
    // rows, so this is the normal case rather than an edge one.
    place('floor1', 0, 0)
    place('twin', 2, 0)
    render(<BillHarness />)

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('2 tiles placed')
    // One line, quantity two, and one file's bytes — not two.
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('×2')
    expect(rows[0]).toHaveTextContent('1.0 MB')
    expect(screen.getByText('1 unique model')).toBeInTheDocument()
    expect(screen.getByText('1.0 MB', { selector: '.of-bill-bytes' })).toBeInTheDocument()
  })

  it('marks the base it inserted for a topper the user did not place', () => {
    place('floor2')
    render(<BillHarness />)

    expect(screen.getByText(/2 parts to print/)).toBeInTheDocument()

    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)

    const auto = rows.filter((row) => row.hasAttribute('data-auto'))
    expect(auto).toHaveLength(1)
    expect(auto[0]).toHaveTextContent(FIXTURE_NAMES.base2)
    expect(auto[0]).toHaveTextContent(/Added under a topper you placed, not placed by you/)
    // And it is not expandable, because there is no placement of it to remove.
    expect(within(auto[0] as HTMLElement).queryByRole('button')).toBeNull()
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

  it('lists a placement whose tile the catalog no longer holds, and offers to remove it', () => {
    act(() => {
      placeTile({ tileId: 'tiles/retired/gone.stl' as TileId, x: 4, z: 4, rotation: 0 })
    })
    render(<BillHarness />)

    // One paragraph, not two: `unknown-tile`'s rolled-up note is deliberately
    // dropped from the warning list because this block is its rendering and can
    // act on it. See `BillPanel.tsx`.
    expect(screen.getByText(/1 placed tile is not in this catalog build/)).toBeInTheDocument()
    expect(screen.getByText('tiles/retired/gone.stl')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Remove the retired tile/ }))
    expect(placementCount()).toBe(0)
  })

  it('renders the verdict at the 512 MB threshold', () => {
    place('big')
    render(<BillHarness />)

    expect(screen.getByText(/Over 512 MB to download/)).toBeInTheDocument()
    expect(screen.getByText(/Expect a long transfer/)).toBeInTheDocument()
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
    expect(screen.getByText('2100.0 MB', { selector: '.of-bill-bytes' })).toHaveAttribute(
      'data-verdict',
      'huge',
    )
  })

  it('shows a missing-base warning in full rather than behind a disclosure', () => {
    place('wallNoBase')
    render(<BillHarness />)

    const note = screen.getByText(/1 piece has no base in the archive/).closest('.of-bill-note')
    expect(note).not.toBeNull()
    expect(note).toHaveAttribute('data-tone', 'warn')
    // The consequence, spelled out — this is the note that decides whether
    // somebody prints a wall that cannot stand up.
    expect(note).toHaveTextContent(/nothing to lock to and will not stay upright/)
    // Row D4's re-key took this bucket from 129 tiles over nine size codes to 86
    // over six, and row A6 corrected the copy. Asserted rather than left to a
    // reader, because a stale corpus figure in user-facing prose is exactly the
    // thing nobody notices.
    expect(note).toHaveTextContent(/six size codes are affected, over 86 tiles corpus-wide/)
    // And it is not inside the `<details>` the info notes live in.
    expect(note?.closest('details')).toBeNull()
  })

  it('keeps the info notes quiet but present', () => {
    place('floor2')
    render(<BillHarness />)

    const details = screen.getByText(/notes? about this scene/).closest('details')
    expect(details).not.toBeNull()
    expect(details).toHaveTextContent(/base was added for you/)
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

/* ------------------------------------------------- the three missing-base gaps */

/**
 * The three ways a topper can end up with nothing under it, rendered.
 *
 * 377 of the 4,363 live openforge toppers reach one of them, and the whole of
 * row D5 is that they are **three different problems with three different
 * remedies** — the archive is missing a base (86 tiles), no base can carry the
 * shape (31), or the tile publishes no key to search bases by (260). One generic
 * "no base found" would tell the first group they had made a mistake and send the
 * second group looking for an object that cannot exist.
 *
 * Those are the *archive's* counts. What a user meets under openlock is
 * 29 / 29 / 247, because row A6's rule 0 resolves 72 of the 377 to a sibling
 * variant that needs no base at all — see `variant resolution in the bill`
 * below, which is where that half is asserted.
 *
 * The shared fixture only covers the first case, so this block extends it rather
 * than editing it: `src/builder/canvas` and `src/screens/builder` parse the same
 * nine records, and adding tiles to it would change what their palettes list.
 * New tags are **appended**, because the existing records index into that array
 * by position.
 */
const GAP_TAGS = [...FIXTURE_CATALOG.tags, 'connection|openlock|topless'] as const

const GAP_IDS = {
  strip: 'tiles/cut-stone/misc/risers/risers/cut-stone#riser+high.2x0.5.openforge.stl',
  shapeless: 'tiles/cavern/volcanic/thick_wall/corner/cavern%volcanic#corner.corner,120°.openforge.stl',
  toplessTopper: 'tiles/towne/floors/floor/openforge/towne#floor.2x2.T.openforge.stl',
  toplessBase: 'tiles/bases/plain/base/openlock/plain#base.T.openlock+topless.stl',
} as const

const GAP_NAMES = {
  strip: 'Cut Stone High Riser 2x0.5',
  shapeless: 'Cavern Volcanic Hex Corner 120°',
  toplessTopper: 'Towne Floor 2x2 T',
  toplessBase: 'Plain Base T Topless',
} as const

function gapCatalog(): CatalogFile {
  const tag = (name: string): number => GAP_TAGS.indexOf(name as (typeof GAP_TAGS)[number])
  const next = FIXTURE_CATALOG.records.length
  return CatalogFileSchema.parse({
    ...FIXTURE_CATALOG,
    tags: [...GAP_TAGS],
    records: [
      ...FIXTURE_CATALOG.records,
      {
        // A half-unit strip. `footprintKey` gives `rect:0.5x2`; no base in this
        // catalog — or in the live one — is half a unit wide. `no-congruent-base`.
        id: GAP_IDS.strip,
        ord: next,
        blob: '9'.repeat(32),
        file: 'cut-stone#riser+high.2x0.5.openforge.stl',
        bytes: 2_000_000,
        sprite: true,
        family: 'tiles/cut-stone/misc/risers/risers',
        design: 'd-strip',
        name: GAP_NAMES.strip,
        kinds: ['riser'],
        conn: ['openforge'],
        layer: 'topper',
        texture: 'cut-stone',
        tags: [tag('connection|openforge')],
        foot: { shape: 'rect', w: 2, d: 0.5 },
      },
      {
        // No size code and no derivable footprint: nothing to search bases by.
        // `base-unmatchable`.
        id: GAP_IDS.shapeless,
        ord: next + 1,
        blob: 'a'.repeat(32),
        file: 'cavern%volcanic#corner.corner,120°.openforge.stl',
        bytes: 8_000_000,
        sprite: true,
        family: 'tiles/cavern/volcanic/thick_wall/corner',
        design: 'd-shapeless',
        name: GAP_NAMES.shapeless,
        kinds: [],
        conn: ['openforge'],
        build: 'wall on tile',
        layer: 'topper',
        texture: 'cavern',
        tags: [tag('connection|openforge'), tag('build|wall on tile')],
        foot: { shape: 'none' },
      },
      {
        // A topper whose only base is the topless print — the case D1 left a note
        // code for and could not add. `base-auto-inserted` *and*
        // `base-option-chosen`.
        id: GAP_IDS.toplessTopper,
        ord: next + 2,
        blob: 'b'.repeat(32),
        file: 'towne#floor.2x2.T.openforge.stl',
        bytes: 4_000_000,
        sprite: true,
        family: 'tiles/towne/floors/floor/openforge',
        design: 'd-topless-topper',
        name: GAP_NAMES.toplessTopper,
        kinds: ['floor'],
        conn: ['openforge'],
        layer: 'topper',
        texture: 'towne',
        tags: [tag('connection|openforge')],
        // 3x3 rather than 2x2: row D4 keys base matching on the resolved
        // primitive rather than the size code, and the shared fixture already
        // holds a *plain* 2x2 base. Under a congruence join that plain base
        // legitimately outscores the topless one, so this case stopped being
        // "the only base is the topless print" and `base-option-chosen`
        // correctly did not fire. The fixture was relying on the size code being
        // the key. 3x3 is a primitive no other fixture base shares.
        foot: { shape: 'rect', w: 3, d: 3 },
        sizeCode: 'T',
      },
      {
        id: GAP_IDS.toplessBase,
        ord: next + 3,
        blob: 'c'.repeat(32),
        file: 'plain#base.T.openlock+topless.stl',
        bytes: 300_000,
        sprite: true,
        family: 'tiles/bases/plain/base/openlock',
        design: 'd-topless-base',
        name: GAP_NAMES.toplessBase,
        kinds: ['base', 'floor'],
        conn: ['openlock'],
        layer: 'base',
        texture: 'plain',
        tags: [tag('shape|base'), tag('connection|openlock|topless')],
        // Matches the topper above, and nothing else in either fixture set.
        foot: { shape: 'rect', w: 3, d: 3 },
        sizeCode: 'T',
      },
    ],
  })
}

/** Both id maps, so a scene can mix a shared-fixture tile with a gap one. */
const ALL_IDS = { ...FIXTURE_IDS, ...GAP_IDS }

/** The panel over `gapCatalog`, with the placements passed in rather than stored. */
function GapHarness({ tiles }: { tiles: readonly (keyof typeof ALL_IDS)[] }) {
  const gapFile = useMemo(gapCatalog, [])
  const gapAssembly = useMemo(() => buildAssemblyIndex(gapFile), [gapFile])
  const placements = useMemo<Record<string, Placement>>(
    () =>
      Object.fromEntries(
        tiles.map((key, i) => [`p${String(i)}`, { tileId: ALL_IDS[key] as TileId, x: i * 2, z: 0, rotation: 0 }]),
      ),
    [tiles],
  )
  const bill = useMemo(
    () => buildBillOfTiles(Object.values(placements), gapAssembly, { lock: 'openlock' }),
    [placements, gapAssembly],
  )
  return (
    <BillPanel
      bill={bill}
      placements={placements}
      assets={gapFile.assets}
      sheet={gapFile.sprite}
      download={inertDownload(bill)}
    />
  )
}

describe('the missing-base gap', () => {
  /** The warning paragraphs, in the order the panel renders them. */
  function warnings(): string[] {
    return [...document.querySelectorAll('.of-bill-note[data-tone="warn"]')].map(
      (element) => element.textContent ?? '',
    )
  }

  it('tells a user with no base in the archive that the library is what is missing', () => {
    render(<GapHarness tiles={['wallNoBase']} />)

    const note = screen.getByText(/1 piece has no base in the archive/).closest('.of-bill-note')
    expect(note).toHaveAttribute('data-tone', 'warn')
    // Not the user's mistake — the sentence that has to be there.
    expect(note).toHaveTextContent(/a gap in the library rather than anything you did/)
    // The consequence, and something to do about it.
    expect(note).toHaveTextContent(/nothing to lock to and will not stay upright/)
    expect(note).toHaveTextContent(/pair each one with a base you already own/)
    expect(note?.closest('details')).toBeNull()
  })

  it('tells a user with an unsupportable shape that it is geometry, not a gap', () => {
    render(<GapHarness tiles={['strip']} />)

    const note = screen.getByText(/1 piece has a shape no base is built to carry/).closest('.of-bill-note')
    expect(note).toHaveAttribute('data-tone', 'warn')
    // The distinction from the case above, in as many words: nobody should go
    // looking for a base that cannot exist.
    expect(note).toHaveTextContent(/this is geometry, not an omission/)
    expect(note).toHaveTextContent(/the narrowest base in the archive is a full unit wide/)
    expect(note).toHaveTextContent(/print them standalone/)
    expect(note?.closest('details')).toBeNull()
  })

  it('tells a user with nothing to match on that the tile, not the archive, is silent', () => {
    render(<GapHarness tiles={['shapeless']} />)

    const note = screen.getByText(/1 piece gives nothing to match a base on/).closest('.of-bill-note')
    expect(note).toHaveAttribute('data-tone', 'warn')
    expect(note).toHaveTextContent(/no key to search bases by/)
    // Which is the opposite advice to the geometry case: the base may well exist.
    expect(note).toHaveTextContent(/A base for these probably does exist/)
    expect(note?.closest('details')).toBeNull()
  })

  it('renders the three causes as three separate warnings, never as one', () => {
    render(<GapHarness tiles={['wallNoBase', 'strip', 'shapeless']} />)

    const shown = warnings()
    expect(shown).toHaveLength(3)
    // Three distinct headlines and three distinct bodies — the defect this row
    // fixes is one sentence standing in for all three.
    expect(new Set(shown).size).toBe(3)
    expect(shown.join(' ')).toMatch(/no base in the archive/)
    expect(shown.join(' ')).toMatch(/a shape no base is built to carry/)
    expect(shown.join(' ')).toMatch(/gives nothing to match a base on/)
  })

  it('names the print option when the base handed out is not the plain one', () => {
    render(<GapHarness tiles={['toplessTopper']} />)

    // The base *was* inserted, so this is not a gap — it is the disclosure D1
    // left the code for: what you print is a different product.
    const note = screen.getByText(/1 matched base is a print variant, not the plain base/).closest('.of-bill-note')
    expect(note).toHaveAttribute('data-tone', 'warn')
    expect(note).toHaveTextContent(/topless — has no top surface at all/)
    // Both causes, distinguished: `option` ranks directly below `lock` and above
    // everything else, so either the archive has nothing plainer or the lock beat
    // it — and only the second one has a lever. Saying only the second would be a
    // false promise on this very fixture, where the topless print is the only `T`
    // base there is.
    expect(note).toHaveTextContent(/the archive holds no plainer print of this base/)
    expect(note).toHaveTextContent(/changing the lock preference gets the full base back; in the first, nothing will/)

    // Two lines in the bill, one of them the base nobody placed.
    expect(screen.getByText(/2 parts to print/)).toBeInTheDocument()
    expect(screen.getByText(GAP_NAMES.toplessBase)).toBeInTheDocument()
  })

  it('keeps the option disclosure out of the way when the plain base wins', () => {
    render(<GapHarness tiles={['floor2']} />)

    expect(screen.queryByText(/print variant/)).toBeNull()
    expect(warnings()).toHaveLength(0)
  })
})

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
  const bill = useMemo(() => buildBillOfTiles(Object.values(placements), assembly, { lock: 'openlock' }), [placements])
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
    const placements: Record<string, Placement> = {
      p1: { tileId: id('floor1'), x: 0, z: 0, rotation: 0 },
    }
    const bill = buildBillOfTiles(Object.values(placements), brokenIndex, { lock: 'openlock' })

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

/* --------------------------------------------------------------- the library */

/* ------------------------------------------- row A6: variant resolution in the bill */

/**
 * One design published twice — the merge the whole aggregation epic is for.
 *
 * **The shared fixture cannot express this and deliberately does not try.** Every
 * one of its nine records has its own `design`, because row A2 had to give `twin`
 * one: two records in a group must agree on `name`, `kinds`, `texture`, `build`,
 * `foot`, `sizeCode` and `rotStep` — A1 measures zero live aggregates that hold
 * two of any of them, and `pipeline/aggregate.ts` fails the build on it — and
 * `twin` carries a different display name from `floor1` on purpose. So a
 * two-variant item is a *new* fixture, built to that invariant rather than
 * against it, and this block extends the shared catalog the way `gapCatalog`
 * does.
 *
 * Three items, and each is one verdict rule 0 has to reach:
 *
 *   - **`mergedTopper` + `mergedIntegral`** — `d-merged`, one item, two files.
 *     Under openlock the integral file wins and the assembly is one part; under
 *     dragonlock and magnetic there is no integral variant in that system, so the
 *     topper wins and a base is added. This is the item the row exists for.
 *   - **`dragonOnly`** — `d-dragon`, a single self-sufficient file carrying
 *     dragonlock. Under openlock the honest verdict is `wrong-system`: it will
 *     print and stand and it will not clip to its neighbours.
 *   - **`untagged`** — `d-untagged`, a single file with **no connection tag at
 *     all**. 93 live aggregates (2.4%) are in this state, 33 of which name a lock
 *     in the filename only. The verdict is `unknown-joinery`, and because
 *     `notes.ts` has no code for it the row mark is the only place it can surface.
 *
 * `mergedIntegral` shares `mergedTopper`'s name, kinds, texture, build, foot and
 * size code, and differs only in `file`, `family`, `blob`, `bytes`, `conn` and
 * `layer` — which is exactly the axis A1 measures as the only one that varies.
 */
const A6_TAGS = [...FIXTURE_CATALOG.tags, 'connection|dragonlock'] as const

const A6_IDS = {
  mergedTopper: 'tiles/towne/floors/floor/openforge/towne#floor.2x2.merged.openforge.stl',
  mergedIntegral: 'tiles/towne/floors/floor/openlock/towne#floor.2x2.merged.openlock.stl',
  dragonOnly: 'tiles/towne/walls/wall/dragonlock/towne#wall.2x.dragonlock.stl',
  untagged: 'tiles/towne/props/pillar/towne#pillar.1x1.stl',
} as const

const A6_NAMES = {
  merged: 'Towne Merged Floor 2x2',
  dragonOnly: 'Towne Dragonlock Wall 2x',
  untagged: 'Towne Pillar 1x1',
} as const

function a6Catalog(): CatalogFile {
  const tag = (name: string): number => A6_TAGS.indexOf(name as (typeof A6_TAGS)[number])
  const next = FIXTURE_CATALOG.records.length
  // Everything the two `d-merged` variants must agree on, spelled once so the
  // fixture cannot drift out of A1's hoisting invariant.
  const merged = {
    design: 'd-merged',
    name: A6_NAMES.merged,
    kinds: ['floor'],
    build: 'separate wall',
    texture: 'towne',
    foot: { shape: 'rect', w: 2, d: 2 },
    sizeCode: 'A',
    sprite: true,
  }
  return CatalogFileSchema.parse({
    ...FIXTURE_CATALOG,
    tags: [...A6_TAGS],
    records: [
      ...FIXTURE_CATALOG.records,
      {
        ...merged,
        id: A6_IDS.mergedTopper,
        ord: next,
        blob: 'd'.repeat(32),
        file: 'towne#floor.2x2.merged.openforge.stl',
        bytes: 4_000_000,
        family: 'tiles/towne/floors/floor/openforge',
        conn: ['openforge'],
        layer: 'topper',
        tags: [tag('shape|floor'), tag('connection|openforge')],
      },
      {
        // The same design, printed with the OpenLOCK footer in the mesh. Bigger
        // than the topper, which is the ordinary case and the reason `bytes` is
        // never the tie-break that decides a variant.
        ...merged,
        id: A6_IDS.mergedIntegral,
        ord: next + 1,
        blob: 'e'.repeat(32),
        file: 'towne#floor.2x2.merged.openlock.stl',
        bytes: 4_600_000,
        family: 'tiles/towne/floors/floor/openlock',
        conn: ['openlock'],
        layer: 'integral',
        tags: [tag('shape|floor'), tag('connection|openlock')],
      },
      {
        id: A6_IDS.dragonOnly,
        ord: next + 2,
        blob: 'f'.repeat(32),
        file: 'towne#wall.2x.dragonlock.stl',
        bytes: 2_000_000,
        sprite: true,
        family: 'tiles/towne/walls/wall/dragonlock',
        design: 'd-dragon',
        name: A6_NAMES.dragonOnly,
        kinds: ['wall'],
        conn: ['dragonlock'],
        layer: 'integral',
        build: 'separate wall',
        texture: 'towne',
        tags: [tag('shape|wall'), tag('connection|dragonlock')],
        foot: { shape: 'wall', length: 2 },
      },
      {
        id: A6_IDS.untagged,
        ord: next + 3,
        blob: '1'.repeat(31) + 'a',
        file: 'towne#pillar.1x1.stl',
        bytes: 700_000,
        sprite: true,
        family: 'tiles/towne/props/pillar',
        design: 'd-untagged',
        name: A6_NAMES.untagged,
        kinds: ['column'],
        // No connection tag anywhere, which is what `joineryUntagged` is.
        conn: [],
        layer: 'integral',
        texture: 'towne',
        tags: [tag('shape|floor')],
        foot: { shape: 'rect', w: 1, d: 1 },
      },
    ],
  })
}

const A6_ALL_IDS = { ...FIXTURE_IDS, ...A6_IDS }

/** The bill over `a6Catalog`, under a stated lock preference. */
function A6Harness({
  tiles,
  lock,
}: {
  tiles: readonly (keyof typeof A6_ALL_IDS)[]
  lock: LockSystem
}) {
  const a6File = useMemo(a6Catalog, [])
  const a6Assembly = useMemo(() => buildAssemblyIndex(a6File), [a6File])
  const placements = useMemo<Record<string, Placement>>(
    () =>
      Object.fromEntries(
        tiles.map((key, i) => [`p${String(i)}`, { tileId: A6_ALL_IDS[key] as TileId, x: i * 2, z: 0, rotation: 0 }]),
      ),
    [tiles],
  )
  const bill = useMemo(
    () => buildBillOfTiles(Object.values(placements), a6Assembly, { lock }),
    [placements, a6Assembly, lock],
  )
  return (
    <BillPanel
      bill={bill}
      placements={placements}
      assets={a6File.assets}
      sheet={a6File.sprite}
      download={inertDownload(bill)}
    />
  )
}

describe('variant resolution in the bill', () => {
  /** Every row's leading text, in the order the panel renders them. */
  function rowNames(): string[] {
    return [...document.querySelectorAll('.of-bill-name')].map((element) => element.textContent ?? '')
  }

  function rowMarks(): string[] {
    return [...document.querySelectorAll('.of-bill-auto')].map((element) => element.textContent ?? '')
  }

  it('prints one part under openlock and two under magnetic, for the same placement', () => {
    // The owner's request, end to end: *"in the builder one can just choose a
    // lock system for the current build, and we choose the correct file from the
    // aggregated item, or add a base if there is no tile of that system."*
    render(<A6Harness tiles={['mergedTopper']} lock="openlock" />)
    expect(rowNames()).toHaveLength(1)
    expect(screen.getByText(/1 tile placed/)).toBeInTheDocument()
    // The openlock file, not the one that was placed — and named as such.
    expect(document.body).toHaveTextContent(/openlock · one part/)
    expect(document.body).toHaveTextContent(/Printed instead of towne#floor\.2x2\.merged\.openforge\.stl/)
    expect(document.body).toHaveTextContent(/carries its own joinery, so nothing goes under it/)
    // One part, so no "parts to print" subline and no added base.
    expect(document.body).not.toHaveTextContent(/base · added/)
  })

  it('falls back to base auto-insertion when no variant carries the lock', () => {
    render(<A6Harness tiles={['mergedTopper']} lock="magnetic" />)
    // Two rows: the topper the user placed, and the base the resolver added.
    // `BASE_2X2` is openlock and `magnetic` has no base in this fixture, so the
    // match is a lock mismatch — which is the honest outcome and is disclosed.
    expect(rowNames()).toHaveLength(2)
    expect(document.body).toHaveTextContent(/2 parts to print/)
    expect(document.body).toHaveTextContent(/base · added/)
    expect(screen.getByText(/matched base does not offer your lock system/)).toBeInTheDocument()
  })

  it('says so when no version of a tile carries the chosen lock', () => {
    render(<A6Harness tiles={['dragonOnly']} lock="openlock" />)
    expect(document.body).toHaveTextContent(/not openlock/)
    expect(document.body).toHaveTextContent(/No version of this tile carries openlock/)
    // And §7's rule holds: informed, never refused. The row is in the bill.
    expect(rowNames()).toHaveLength(1)
    expect(screen.getByText(/has no version in your lock system/)).toBeInTheDocument()
  })

  it('reports untagged joinery as unknown rather than as incompatible', () => {
    render(<A6Harness tiles={['untagged']} lock="openlock" />)
    expect(document.body).toHaveTextContent(/joinery untagged/)
    expect(document.body).toHaveTextContent(/missing data rather than an incompatibility/)
    // The one verdict `notes.ts` has no code for, so the row mark is the only
    // surface it has. If a note is ever added for it, this is where the two
    // would start saying the same thing twice.
    expect(document.body).not.toHaveTextContent(/no version in your lock system/)
  })

  it('summarises what the preference did to the whole scene, once', () => {
    render(<A6Harness tiles={['mergedTopper', 'floor2', 'floor1']} lock="openlock" />)
    const summary = screen.getByText(/Resolved for openlock/).closest('.of-bill-note')
    expect(summary).toHaveAttribute('data-tone', 'resolved')
    // `mergedTopper` becomes one part, `floor2` keeps its base, `floor1` needed
    // nothing to begin with.
    expect(summary).toHaveTextContent(/2 print as one part/)
    expect(summary).toHaveTextContent(/1 needs a base under it/)
    expect(summary).toHaveTextContent(/1 of 3 placements print a different file of the same tile/)
    // Quieter than a warning, and below them: the block is disclosure, and a
    // missing base must stay the loudest thing in the column.
    expect(summary?.closest('details')).toBeNull()
  })

  it('says nothing at all when the preference changed nothing', () => {
    // A scene of one self-sufficient tile that was placed as itself. A permanent
    // row of reassurance is how a warning surface stops being read.
    render(<A6Harness tiles={['floor1']} lock="openlock" />)
    expect(screen.queryByText(/Resolved for/)).toBeNull()
    expect(rowMarks()).toEqual([])
  })

  it('keeps a substituted placement removable rather than reporting it as retired', () => {
    // The join this row had to rewrite. `line.tileIds` names the *resolved* file
    // and the store's placement names the *placed* one, so the pre-A6 join found
    // nothing for a substituted placement and would have put it in the orphan
    // block: "not in this catalog build", offered for removal, about a tile that
    // is in the bill and printing correctly.
    render(<A6Harness tiles={['mergedTopper']} lock="openlock" />)
    expect(screen.queryByText(/not in this catalog build/)).toBeNull()

    const row = screen.getByRole('button', { expanded: false })
    fireEvent.click(row)
    // Reachable and removable from the keyboard, which is the whole reason the
    // join exists — see `BillPanel.tsx` on the canvas being one tab stop.
    expect(screen.getByRole('button', { name: /Remove/ })).toBeInTheDocument()
    expect(screen.getByText('x 0, z 0')).toBeInTheDocument()
  })

  it('names the resolved file in the row, and the placed one only in the mark', () => {
    // A1 measures zero aggregates holding two display names, so the *name* is
    // identical either side of a substitution and naming it would say nothing.
    // The file is what changed, so the file is what the mark names.
    render(<A6Harness tiles={['mergedTopper']} lock="openlock" />)
    expect(rowNames()[0]).toContain(A6_NAMES.merged)
    const marks = rowMarks()
    expect(marks).toHaveLength(1)
    expect(marks[0]).toContain('towne#floor.2x2.merged.openforge.stl')
  })
})

describe('the library block', () => {
  it('drops ids the catalog no longer holds rather than rendering a nameless row', () => {
    act(() => {
      useWorkshopStore.setState({
        library: { [id('floor1')]: true, ['tiles/retired/gone.stl' as TileId]: true },
      })
    })
    render(<PaletteHarness />)

    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.queryByText(/retired/)).toBeNull()
  })
})
