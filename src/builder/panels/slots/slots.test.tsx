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
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { DesignId } from '@/catalog'
import { PARENT, SLOT_CATALOG } from '@/screens/detail/slots/fixture'
import type { Placement } from '@/store'
import { clearPersistedWorkshopState, resetWorkshop } from '@/store'

import { planSlots } from './planSlots'
import { SlotsPanel } from './SlotsPanel'

/**
 * The design a fixture file belongs to.
 *
 * Read off the fixture catalog rather than written out, because a placement names
 * a design (row V4) and every holder below is named by one of its files.
 */
const designOf = (id: string): string => {
  const record = SLOT_CATALOG.records.find((candidate) => candidate.id === id)
  if (record === undefined) throw new Error(`no fixture record for ${id}`)
  return record.design
}

/** An item this index does not hold — the orphan case, since row V4. */
const RETIRED_DESIGN = 'd-retired-nothing' as DesignId

/** A placement of {@link RETIRED_DESIGN} at the origin. */
function atRetired(): Placement {
  return { design: RETIRED_DESIGN, x: 0, z: 0, rotation: 0 }
}

/**
 * A placement of the item a fixture file belongs to.
 *
 * Row V4, and it interacts with this file's subject: `FILL.torchStone` and
 * `FILL.torchStoneFlex` are two files of **one** item, so placing either now
 * places the same design and the panel resolves the file whose slots it shows
 * from the lock preference. Every `at(…)` below names a holder, and holders in
 * this fixture are single-file designs.
 */
function at(id: string, x: number, z: number): Placement {
  return { design: designOf(id) as DesignId, x, z, rotation: 0 }
}

const plan = (entries: Record<string, Placement>) => entries

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
    expect(inventory.holders.map((holder) => holder.id)).toEqual(['nearLeft', 'nearRight', 'far'])
  })

  it('calls a placement the index has retired an orphan rather than dropping it', () => {
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
    expect(screen.getByText('x 3.5, z 2')).toBeInTheDocument()
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
      // "an item", not "a file": since row V4 a placement names a design, so an
      // orphan is an item the index has lost and not a file it has retired.
      screen.getByText(/1 placement names an item this index no longer holds/),
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
