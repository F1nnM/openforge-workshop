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
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { TileId } from '@/catalog'
import { FILL, PARENT, SLOT_CATALOG } from '@/screens/detail/slots/fixture'
import type { Placement } from '@/store'
import { clearPersistedWorkshopState, resetWorkshop, selectLibrary, useWorkshopStore } from '@/store'

import { planSlots } from './planSlots'
import { SlotsPanel } from './SlotsPanel'

const tile = (id: string): TileId => id as unknown as TileId

function at(id: string, x: number, z: number): Placement {
  return { tileId: tile(id), x, z, rotation: 0 }
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
    const inventory = planSlots(SLOT_CATALOG, plan({ gone: at('tiles/retired/nothing.stl', 0, 0) }))
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

  it('leads with the required count and says where a pick goes', () => {
    render(
      <SlotsPanel
        catalog={SLOT_CATALOG}
        placements={plan({ a: at(PARENT.wallTowne, 0, 0), b: at(PARENT.wallLow, 2, 0) })}
      />,
    )
    expect(screen.getByText(/2 slots open on 2 pieces, 1 of them required/)).toBeInTheDocument()
    expect(screen.getByText(/adds its file to your library/)).toBeInTheDocument()
    // And it does not claim the bill will show it, because the bill is built
    // from placements and row G5 owns the channel that would change that.
    expect(screen.getByText(/not a line in it/)).toBeInTheDocument()
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

  it('adds a picked file to the library, and leaves it there when the slot is cleared', () => {
    render(<SlotsPanel catalog={SLOT_CATALOG} placements={plan({ a: at(PARENT.wallTowne, 0, 0) })} />)

    const card = () => screen.getByRole('button', { name: /Dungeon Stone Torch/ })
    fireEvent.click(card())
    expect(Object.keys(selectLibrary(useWorkshopStore.getState()))).toEqual([FILL.torchStone])

    // Clearing the slot does not un-add the file: the panel would be undoing a
    // decision it did not make, and the library is a list of things to print.
    fireEvent.click(card())
    expect(Object.keys(selectLibrary(useWorkshopStore.getState()))).toEqual([FILL.torchStone])
  })

  it('does not add a file for a pick it refused', () => {
    render(<SlotsPanel catalog={SLOT_CATALOG} placements={plan({ a: at(PARENT.wallTowne, 0, 0) })} />)
    fireEvent.click(screen.getByRole('button', { name: /Towne Torch/ }))
    expect(Object.keys(selectLibrary(useWorkshopStore.getState()))).toEqual([])
  })

  it('says how many placements it cannot describe', () => {
    render(
      <SlotsPanel
        catalog={SLOT_CATALOG}
        placements={plan({ gone: at('tiles/retired/nothing.stl', 0, 0) })}
      />,
    )
    expect(
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
