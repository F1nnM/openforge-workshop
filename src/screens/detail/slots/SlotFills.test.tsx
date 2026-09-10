// @vitest-environment jsdom
/**
 * The picker as a control.
 *
 * Two of these tests are the row's headline and the rest support them: **a pick
 * that leads nowhere is greyed before it is made and says why**, and **filling
 * one slot re-narrows the others**. Both are asserted through the rendered
 * output rather than through the resolver, because the resolver already has its
 * own suite in `slotPicker.test.ts` and what is at issue here is whether the
 * control shows what the resolver worked out.
 *
 * A greyed card is checked for `aria-disabled` and for still being in the
 * accessibility tree with its reason in its accessible name — the whole argument
 * for not using `disabled` is that the reason has to be reachable, so that is
 * the thing tested.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { TileId } from '@/catalog'

import { FILL, PARENT, SLOT_CATALOG } from './fixture'
import { SlotFills } from './SlotFills'

const tile = (id: string): TileId => id as unknown as TileId

/** `onPick` is spread rather than passed as `undefined`: `exactOptionalPropertyTypes`. */
function mount(parent: string, onPick?: (slot: string, picked: TileId | undefined) => void) {
  return render(
    <SlotFills catalog={SLOT_CATALOG} parent={tile(parent)} {...(onPick ? { onPick } : {})} />,
  )
}

/** One slot's block, by the label on its `role="group"` container. */
const group = (name: string) => screen.getByRole('group', { name: `Fill the ${name} slot` })

/* ------------------------------------------------------------------ nothing */

describe('a file with nothing to choose', () => {
  it('renders nothing at all for a base-only config', () => {
    const { container } = mount(PARENT.baseOnly)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing at all for a file with no config', () => {
    const { container } = mount(PARENT.plainFloor)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing rather than throwing when handed no index', () => {
    // Both call sites require a `CatalogFile` and both pass one, so this is only
    // reachable from code transpiled without a type check. It matters anyway: a
    // throw here unmounts the drawer, and a missing picker is a smaller failure
    // than a missing drawer.
    const { container } = render(<SlotFills catalog={undefined} parent={tile(PARENT.wallTowne)} />)
    expect(container).toBeEmptyDOMElement()
  })
})

/* ------------------------------------------------------- one card per sculpt */

describe('an item whose files differ only by sculpt', () => {
  it('renders a card per print, with the label that tells them apart', () => {
    // **F5.** Three wood-grain sculpts of one lintel: three cards, and the label
    // is the only thing on the card that differs, so it has to be rendered and
    // not merely computed.
    mount(PARENT.sculptWall)

    const cards = within(group('lintel'))
      .getAllByRole('button')
      .filter((card) => (card.textContent ?? '').startsWith('Wood Door Lintel'))

    expect(cards.map((card) => card.textContent)).toEqual([
      'Wood Door Lintel1',
      'Wood Door Lintel2',
      'Wood Door Lintel3',
    ])
    // And in the accessible name, before the filename: a screen-reader user
    // moving through the grid hears the name alone, and three cards called
    // *Wood Door Lintel* would be three of the same thing.
    expect(cards[0]).toHaveAccessibleName('Wood Door Lintel — 1 — door_lintel.1.stl')
  })

  it('names the file the pressed card stands for', () => {
    const picks: [string, TileId | undefined][] = []
    mount(PARENT.sculptWall, (slot, picked) => {
      picks.push([slot, picked])
    })

    fireEvent.click(within(group('lintel')).getByRole('button', { name: /Wood Door Lintel — 2/ }))
    expect(picks).toEqual([['lintel', FILL.lintelWoodTwo]])
  })
})

/* ------------------------------------------------------------ the greyed card */

describe('dead-end greying', () => {
  /*
    `wallSiblings` and not `wallTowne`, and the swap is F2: the towne torch
    empties `wallTowne`'s **base** slot, which is the room's own slot rather than
    a sibling of the torch, so the picker no longer calls that a dead end. The
    greyed card is the one that closes another *accessory* slot.
  */
  it('greys the pick that closes another slot, and says what it closes', () => {
    mount(PARENT.wallSiblings)

    const towne = screen.getByRole('button', { name: /Towne Torch/ })
    expect(towne).toHaveAttribute('aria-disabled', 'true')
    expect(towne).toHaveAccessibleName(/Leaves the top slot with nothing to fill it/)
    // Rendered as well as announced: a sighted user needs the reason too, and a
    // tooltip would hide the row's whole point behind a hover.
    expect(towne).toHaveTextContent('Leaves the top slot with nothing to fill it.')

    // The harmless sibling is an ordinary card.
    const stone = screen.getByRole('button', { name: /Dungeon Stone Torch/ })
    expect(stone).not.toHaveAttribute('aria-disabled')
    expect(stone).toHaveAttribute('aria-pressed', 'false')
  })

  it('greys nothing on a wall whose only closed slot is its base', () => {
    mount(PARENT.wallTowne)
    const towne = screen.getByRole('button', { name: /Towne Torch/ })
    expect(towne).not.toHaveAttribute('aria-disabled')
    expect(towne).toHaveAttribute('aria-pressed', 'false')
    expect(group('torch')).not.toHaveTextContent('would close another slot')
  })

  it('keeps a greyed card focusable, so its reason is reachable', () => {
    mount(PARENT.wallSiblings)
    const towne = screen.getByRole('button', { name: /Towne Torch/ })
    towne.focus()
    expect(towne).toHaveFocus()
    expect(towne).not.toBeDisabled()
  })

  it('declines the pick rather than preventing the press', () => {
    const picks: (string | undefined)[] = []
    mount(PARENT.wallSiblings, (_slot, picked) => {
      picks.push(picked)
    })

    fireEvent.click(screen.getByRole('button', { name: /Towne Torch/ }))
    expect(picks).toEqual([])
    expect(screen.getByRole('button', { name: /Towne Torch/ })).not.toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('counts the greyed cards in the slot’s note', () => {
    mount(PARENT.wallSiblings)
    expect(group('torch')).toHaveTextContent('2 to pick from, over 3 files.')
    expect(group('torch')).toHaveTextContent('1 of them would close another slot')
  })
})

/* ---------------------------------------------------------- picking, and after */

describe('a pick', () => {
  it('marks the card and reports the file it contributes', () => {
    const picks: [string, string | undefined][] = []
    mount(PARENT.wallTowne, (slot, picked) => {
      picks.push([slot, picked])
    })

    fireEvent.click(screen.getByRole('button', { name: /Dungeon Stone Torch/ }))
    expect(picks).toEqual([['torch', FILL.torchStone]])
    expect(screen.getByRole('button', { name: /Dungeon Stone Torch/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('is cleared by a second press on the same card', () => {
    const picks: (string | undefined)[] = []
    mount(PARENT.wallTowne, (_slot, picked) => {
      picks.push(picked)
    })

    const card = () => screen.getByRole('button', { name: /Dungeon Stone Torch/ })
    fireEvent.click(card())
    fireEvent.click(card())
    expect(picks).toEqual([FILL.torchStone, undefined])
    expect(card()).toHaveAttribute('aria-pressed', 'false')
  })

  it('re-narrows the slots that are still open', () => {
    // The archway's `lintel` starts wide — a `{ filter }` entry drops the
    // parent's own texture from what it inherits — and the torch is what
    // narrows it. This is the capability C1 emitted 0 bytes for: the set is
    // correct only until the next click.
    mount(PARENT.archway)
    expect(group('lintel')).toHaveTextContent('2 to pick from, over 2 files.')

    fireEvent.click(screen.getByRole('button', { name: /Towne Torch/ }))
    expect(group('lintel')).toHaveTextContent('1 to pick from, over 1 file.')
  })

  it('leaves the others alone when the pick contributes nothing new', () => {
    // The dungeon_stone torch contributes the texture the `{ filter }` entry
    // removes, so the lintel does not move. "Inert" is 94.0% of sibling effects
    // in the live corpus and it has to look like nothing happening.
    mount(PARENT.archway)
    fireEvent.click(screen.getByRole('button', { name: /Dungeon Stone Torch/ }))
    expect(group('lintel')).toHaveTextContent('2 to pick from, over 2 files.')
  })

  it('offers to clear an optional slot once something is in it', () => {
    mount(PARENT.wallTowne)
    expect(screen.queryByRole('button', { name: 'Leave this slot empty' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Dungeon Stone Torch/ }))

    const clear = screen.getByRole('button', { name: 'Leave this slot empty' })
    fireEvent.click(clear)
    expect(screen.getByRole('button', { name: /Dungeon Stone Torch/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })
})

/* ------------------------------------------------------ the owner's selection */

/**
 * The controlled mode row C3's builder panel needs.
 *
 * The drawer's own use is uncontrolled and stays that way — a pick there narrows
 * the remaining slots and is not persisted anywhere — but the plan's accessory
 * section holds the answer in `SlotFill.holds` and writes it to the store. So it
 * hands the selection down, and what it hands down is what is shown: the picker
 * must not keep a second copy that can disagree with the room.
 */
describe('a selection the owner holds', () => {
  const controlled = (torch: string | undefined) => (
    <SlotFills
      catalog={SLOT_CATALOG}
      parent={tile(PARENT.archway)}
      selection={torch === undefined ? {} : { torch: tile(torch) }}
    />
  )

  it('shows the owner’s pick, and follows it when the owner changes it', () => {
    const { rerender } = render(controlled(FILL.torchStone))
    expect(screen.getByRole('button', { name: /Dungeon Stone Torch/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    rerender(controlled(FILL.torchTowne))
    expect(screen.getByRole('button', { name: /Dungeon Stone Torch/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getByRole('button', { name: /Towne Torch/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('leaves a press to the owner rather than moving on its own', () => {
    // The whole of *controlled*: the card reports the pick and waits. An owner
    // that refuses the write leaves the grid where it was, which is the state
    // the room is actually in.
    const picks: [string, string | undefined][] = []
    render(
      <SlotFills
        catalog={SLOT_CATALOG}
        parent={tile(PARENT.archway)}
        selection={{}}
        onPick={(slot, picked) => {
          picks.push([slot, picked])
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Dungeon Stone Torch/ }))

    expect(picks).toEqual([['torch', FILL.torchStone]])
    expect(screen.getByRole('button', { name: /Dungeon Stone Torch/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })
})

/* -------------------------------------------------------------- the rescue */

describe('a pick that opens a slot', () => {
  it('says so on the card', () => {
    // `wallRescue`, for the greying's reason: the corpus's own rescues open the
    // base, which the picker neither shows nor resolves, so the case it can
    // still report is one accessory slot opening another.
    mount(PARENT.wallRescue)
    const top = screen.getAllByRole('button', { name: /Dungeon Stone Secret Door Top/ })[0]
    expect(top).toHaveTextContent('Opens the crosshead slot.')
    expect(top).toHaveAccessibleName(/opens the crosshead slot/)
    expect(top).not.toHaveAttribute('aria-disabled')
  })
})

/* ------------------------------------------------------------- empty slots */

describe('a slot nothing can fill', () => {
  it('names the tag that does not exist, rather than saying nothing matched', () => {
    mount(PARENT.danglingRef)
    expect(group('statue')).toHaveTextContent('component|statue')
    expect(group('statue')).toHaveTextContent('this index holds no such tag')
    expect(within(group('statue')).queryAllByRole('button')).toEqual([])
  })

  it('says a required slot cannot be completed', () => {
    mount(PARENT.contradiction)
    expect(group('broken_section')).toHaveTextContent(
      'Nothing in the archive fits this slot, so this piece cannot be completed',
    )
  })
})

/* ------------------------------------------------------- one grid at a time */

describe('the open slot', () => {
  it('renders one grid of sprite sheets and not one per slot', () => {
    // The whole memory lever available before the 256px derivative lands
    // (blocker B2): the grids are 8 cards at worst and ~10.5 MB of bitmap each.
    mount(PARENT.pairedGrate)
    expect(within(group('grate (left)')).getAllByRole('button').length).toBeGreaterThan(0)
    expect(within(group('grate (right)')).getByRole('button')).toHaveTextContent(/Choose/)
  })

  it('opens a closed slot on its own control', () => {
    mount(PARENT.pairedGrate)
    fireEvent.click(within(group('grate (right)')).getByRole('button', { name: /Choose/ }))
    expect(within(group('grate (right)')).getAllByRole('button').length).toBeGreaterThan(0)
    expect(within(group('grate (left)')).getByRole('button')).toHaveTextContent(/Choose/)
  })

  it('states the pairing the fixture declares', () => {
    mount(PARENT.pairedGrate)
    expect(group('grate (left)')).toHaveTextContent('Paired with grate (right)')
  })
})
