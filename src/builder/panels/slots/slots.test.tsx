// @vitest-environment jsdom
/**
 * The plan's accessory slots, as an inventory and as a panel.
 *
 * The interesting assertions are the two the bill of tiles cannot make: that a
 * drawing's *open* slots are counted at all, and that the count separates a slot
 * the user can fill from one **nothing in the archive can** — 9 of the corpus's
 * 1,244 accessory declarations are the second kind, and telling somebody to fill
 * one would be sending them after a file that does not exist.
 *
 * The fixture is row C2's, shared with the drawer's picker rather than copied:
 * the dead-end case is delicate enough that two versions of it would drift.
 *
 * Row **A0** removed the two assertions about where a pick *lands*. They proved
 * the `TileId` to `DesignId` hop — that two files of one item could not put two
 * entries in the library for one pick — and the library they landed in is gone.
 * **Row C3 gives the pick a destination** (a `SlotFill` on a placed template
 * instance) and owns the assertions that go with it; what is left here is that
 * the press is inert and the panel says so.
 *
 * ## A holder is a filled slot, since row A8
 *
 * Every `at(…)` below is now a **template instance with one fill**, and the fill
 * names the file whose accessory slots the assertion is about. That is a
 * simplification rather than a translation: a placement used to name a design and
 * `planSlots` had to resolve it to a file through the lock preference, because
 * `config` differs between an item's variants. A fill *is* the file, so the
 * preference is gone from the signature and `FILL.torchStone` versus
 * `FILL.torchStoneFlex` — two files of one item, which this file's subject turns
 * on — is now a distinction a test can simply state.
 *
 * One instance with two filled slots is two holders, and the last test in the
 * inventory block is what pins that.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { TileId } from '@/catalog'
import { PARENT, SLOT_CATALOG } from '@/screens/detail/slots/fixture'
import type { TemplateInstance } from '@/store'
import {
  PlacementId,
  SlotName,
  TemplateId,
  clearPersistedWorkshopState,
  resetWorkshop,
} from '@/store'

import { planSlots } from './planSlots'
import { SlotsPanel } from './SlotsPanel'

/**
 * The one recipe these tests place.
 *
 * A slug rather than one of the 40 real ids: `planSlots` never looks a template
 * up — it walks the fills — so the family it names is not one of this file's
 * facts, and naming a real one would imply the fills below belong to its slots.
 */
const A_RECIPE = 'slots-fixture'

/** A file this index does not hold — the orphan case. */
const RETIRED_TILE = 'tiles/gone/forever.stl' as TileId

/** An instance whose one fill names {@link RETIRED_TILE}, at the origin. */
function atRetired(): TemplateInstance {
  return instance({ fill: RETIRED_TILE, x: 0, z: 0 })
}

/**
 * An instance holding one file per slot, at a cell.
 *
 * The slots are named `slot0`, `slot1`, … because `planSlots` orders a holder's
 * siblings by slot name and nothing here depends on the recipe's declared order;
 * `id` is a placeholder the caller's map key overwrites in the store and which
 * this inventory reads only as `holder.placement`.
 */
function instance({ fill, fills, x, z }: { fill?: TileId; fills?: readonly TileId[]; x: number; z: number }): TemplateInstance {
  const tiles = fills ?? (fill === undefined ? [] : [fill])
  return {
    id: PlacementId.parse('p'),
    template: TemplateId.parse(A_RECIPE),
    x,
    z,
    rotation: 0,
    fills: Object.fromEntries(
      tiles.map((tile, at) => [SlotName.parse(`slot${String(at)}`), { tile, pinned: false }]),
    ),
  }
}

/** An instance whose single fill is one named fixture file. */
function at(id: string, x: number, z: number): TemplateInstance {
  return instance({ fill: id as TileId, x, z })
}

const plan = (entries: Record<string, TemplateInstance>) => entries

beforeEach(() => {
  resetWorkshop()
})

afterEach(() => {
  clearPersistedWorkshopState()
  resetWorkshop()
})

/* ------------------------------------------------------------- the inventory */

describe('planSlots', () => {
  it('finds nothing in a plan of pieces that hold nothing', () => {
    const inventory = planSlots(
      SLOT_CATALOG,
      plan({ a: at(PARENT.plainFloor, 0, 0), b: at(PARENT.baseOnly, 1, 0) }),
    )
    expect(inventory).toMatchObject({ slots: 0, required: 0, unfillable: 0, holders: [] })
    expect(inventory.byName).toEqual([])
  })

  it('counts the slots a plan opens, and how many of them are required', () => {
    const inventory = planSlots(
      SLOT_CATALOG,
      plan({ a: at(PARENT.wallTowne, 0, 0), b: at(PARENT.wallLow, 1, 0) }),
    )
    // `torch` is optional, `top` is not — and `base` is neither, because the
    // base match is A6's and never appears here.
    expect(inventory.slots).toBe(2)
    expect(inventory.required).toBe(1)
    expect(inventory.byName).toEqual([
      { name: 'top', count: 1 },
      { name: 'torch', count: 1 },
    ])
  })

  it('separates a slot nothing in the archive can fill from one the user can', () => {
    const inventory = planSlots(
      SLOT_CATALOG,
      plan({ a: at(PARENT.contradiction, 0, 0), b: at(PARENT.wallTowne, 1, 0) }),
    )
    expect(inventory.slots).toBe(2)
    expect(inventory.unfillable).toBe(1)
  })

  it('reads the plan in depth-then-across order, the same as the bill', () => {
    const inventory = planSlots(
      SLOT_CATALOG,
      plan({
        far: at(PARENT.wallLow, 0, 4),
        nearRight: at(PARENT.wallTowne, 3, 0),
        nearLeft: at(PARENT.pairedGrate, 0, 0),
      }),
    )
    expect(inventory.holders.map((holder) => holder.placement)).toEqual([
      'nearLeft',
      'nearRight',
      'far',
    ])
  })

  it('gives one instance a holder per filled slot, because each file has its own', () => {
    // Row A8's change of unit, stated: a template instance is up to five files
    // and each declares its own accessory slots, so a single placed recipe can
    // open several. `wallTowne` opens `torch` and `pairedGrate` opens two grates.
    const inventory = planSlots(
      SLOT_CATALOG,
      plan({
        one: instance({
          fills: [PARENT.wallTowne as TileId, PARENT.pairedGrate as TileId],
          x: 0,
          z: 0,
        }),
      }),
    )
    expect(inventory.holders).toHaveLength(2)
    // Keyed by placement *and* slot, so two holders of one instance are distinct
    // React keys rather than a duplicate.
    expect(inventory.holders.map((holder) => holder.id)).toEqual(['one|slot0', 'one|slot1'])
    expect(inventory.holders.map((holder) => holder.parent)).toEqual([
      PARENT.wallTowne,
      PARENT.pairedGrate,
    ])
  })

  it('calls a fill the index has retired an orphan rather than dropping it', () => {
    const inventory = planSlots(SLOT_CATALOG, plan({ gone: atRetired() }))
    expect(inventory.orphans).toEqual(['gone'])
    expect(inventory.holders).toEqual([])
  })
})

/* ----------------------------------------------------------------- the panel */

describe('SlotsPanel', () => {
  it('states the archive’s 11.5% when the plan opens nothing', () => {
    render(<SlotsPanel catalog={SLOT_CATALOG} placements={plan({ a: at(PARENT.plainFloor, 0, 0) })} />)
    expect(screen.getByText(/1,005 of the archive’s 8,702 files declare a slot/)).toBeInTheDocument()
  })

  it('leads with the required count and says a pick has nowhere to go yet', () => {
    render(
      <SlotsPanel
        catalog={SLOT_CATALOG}
        placements={plan({ a: at(PARENT.wallTowne, 0, 0), b: at(PARENT.wallLow, 2, 0) })}
      />,
    )
    expect(screen.getByText(/2 slots open on 2 pieces, 1 of them required/)).toBeInTheDocument()
    // Row A0: it said "adds its item to your library" until the library was
    // deleted. It does not claim the bill will show a fill either, because the
    // bill is built from placements and a slot fill is not one until row C3.
    expect(screen.getByText(/not yet something this build can keep/)).toBeInTheDocument()
    expect(screen.getByText(/a slot fill is not one/)).toBeInTheDocument()
  })

  it('names each holder with its grid position', () => {
    render(<SlotsPanel catalog={SLOT_CATALOG} placements={plan({ a: at(PARENT.wallTowne, 3.5, 2) })} />)
    // The slot leads, because two holders of one instance sit at one cell.
    expect(screen.getByText(/slot0 · x 3\.5, z 2/)).toBeInTheDocument()
    expect(screen.getByText(/Dungeon Stone Torch Wall 2x/)).toBeInTheDocument()
  })

  it('calls an unfillable slot an archive gap rather than a step to take', () => {
    render(
      <SlotsPanel catalog={SLOT_CATALOG} placements={plan({ a: at(PARENT.contradiction, 0, 0) })} />,
    )
    expect(screen.getByText(/gap in the archive, not a step to take/)).toBeInTheDocument()
  })

  it('greys the dead-end pick here too, because the picker is the same one', () => {
    render(<SlotsPanel catalog={SLOT_CATALOG} placements={plan({ a: at(PARENT.wallTowne, 0, 0) })} />)
    expect(screen.getByRole('button', { name: /Towne Torch/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('accepts a pick and keeps nothing, because the destination is row C3’s', () => {
    // Row A0. The pick used to write the chosen file's item to the library; the
    // library is gone and **row C3** replaces the destination with a `SlotFill`
    // on a placed template instance. What must stay true in between is that the
    // press is harmless and the panel says so, rather than the panel offering a
    // control that throws or silently mutates something else.
    render(<SlotsPanel catalog={SLOT_CATALOG} placements={plan({ a: at(PARENT.wallTowne, 0, 0) })} />)

    const card = () => screen.getByRole('button', { name: /Dungeon Stone Torch/ })
    fireEvent.click(card())
    fireEvent.click(card())

    expect(screen.getByText(/not yet something this build can keep/)).toBeInTheDocument()
    expect(card()).toBeInTheDocument()
  })

  it('says how many placements it cannot describe', () => {
    render(
      <SlotsPanel
        catalog={SLOT_CATALOG}
        placements={plan({ gone: atRetired() })}
      />,
    )
    expect(
      // "a file", not "an item": a fill names a file (decision D1), so an orphan
      // is a file the index has retired rather than an item it has lost.
      screen.getByText(/1 placement names a file this index no longer holds/),
    ).toBeInTheDocument()
  })

  it('scopes each holder’s picker to that placement’s own file', () => {
    const { container } = render(
      <SlotsPanel
        catalog={SLOT_CATALOG}
        placements={plan({ a: at(PARENT.wallTowne, 0, 0), b: at(PARENT.pairedGrate, 2, 0) })}
      />,
    )
    // By class, not by `listitem`: the option cards are list items too, which is
    // the right markup for a grid and makes the role ambiguous here.
    const holders = [...container.querySelectorAll<HTMLElement>('.of-planslots-holder')]
    expect(holders).toHaveLength(2)
    expect(within(holders[0]!).getByRole('group', { name: 'Fill the torch slot' })).toBeInTheDocument()
    expect(
      within(holders[1]!).getByRole('group', { name: 'Fill the grate (left) slot' }),
    ).toBeInTheDocument()
  })
})
