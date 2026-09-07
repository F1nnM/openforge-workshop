// @vitest-environment jsdom
/**
 * The design control in the builder's work area, against the real store.
 *
 * The fixture's figures are nothing like the archive's — **three offered
 * designs over two parts** — so if `139`, `120`, `36` or `dungeon_stone` appears
 * on screen during these tests, something has hard-coded a number that is
 * supposed to be measured. `lock-picker/lockToggle.test.tsx` set that trap one
 * preference over and it is worth more here: a design's reach moves with the
 * archive *and* with the template table, so there are two ways for a constant to
 * go stale.
 *
 * ## What is asserted, and why each is here rather than left to a manual pass
 *
 *   - **Picking a design writes the store**, not just the DOM. The value feeds
 *     C2's solver through `FillContext.family`; a picker that only looked
 *     selected would be the silent no-op row C1 declined to ship.
 *   - **The trigger states what is in effect and how far it reaches.** That is
 *     what makes the setting honest at a glance rather than a name whose
 *     consequence is one press away.
 *   - **A design that reaches nothing is not offered.** 8 of the archive's 36
 *     roots are in that state, and offering one is a control that appears to
 *     work and does not.
 *   - **The consequence copy is conditional on there being a scene**, and it is
 *     the *opposite* sentence from the lock's: a lock change leaves every placed
 *     file where it is, and a design change rewrites every unpinned one.
 *   - **`reach === null` still lets the choice be made.** The store does not
 *     need a catalog to record a preference.
 *
 * ## What these tests cannot prove
 *
 * That any of it is visible. jsdom applies no CSS, rasterises nothing and
 * reports every element as 0 x 0 — `lockToggle.test.tsx` states the same limit
 * for the same band. Nothing here can tell whether the trigger is clipped by the
 * stage's overflow or whether it overlaps the lock toggle beside it.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildAggregateIndex } from '@/catalog'
import type { AssemblyTemplate } from '@/assembly'
import { buildAssemblyIndex } from '@/assembly'
import { createCompositionIndex } from '@/composition'
import { clearPersistedWorkshopState, resetWorkshop, setRoomDesign, useWorkshopStore } from '@/store'
import type { FillFixtureRecord } from '@/template/fixture'
import { fillFixture } from '@/template/fixture'

import { DesignToggle } from './DesignToggle'
import type { DesignAuthorities } from './useDesignReach'

/* ------------------------------------------------------------------ fixture */

/**
 * Three designs that reach a part, one that reaches only the base, one that
 * reaches nothing.
 *
 * `slate` 2 parts, `bark-wood` 1, `mosaic` 1; `plain` is base-only and
 * `driftwood` is on a shape no part admits. `2`, `1` and `Driftwood` are strings
 * only this fixture can produce.
 */
const RECORDS: readonly FillFixtureRecord[] = [
  { id: 'tiles/wall.slate', design: 'wall-slate', tags: ['shape|wall'], texture: 'slate' },
  { id: 'tiles/wall.bark', design: 'wall-bark', tags: ['shape|wall'], texture: 'bark-wood' },
  { id: 'tiles/floor.slate', design: 'floor-slate', tags: ['shape|floor'], texture: 'slate' },
  { id: 'tiles/floor.mosaic', design: 'floor-mosaic', tags: ['shape|floor'], texture: 'mosaic' },
  { id: 'tiles/base.plain', design: 'base-plain', layer: 'base', tags: ['shape|base'], texture: 'plain' },
  { id: 'tiles/decor.drift', design: 'decor-drift', tags: ['shape|decor'], texture: 'driftwood' },
]

const TEMPLATE: AssemblyTemplate = {
  id: 'fixture-wall',
  tags: ['object|tile'],
  parts: [
    { name: 'wall', tags: { require: [{ tag: 'shape|wall' }] } },
    { name: 'floor', tags: { require: [{ tag: 'shape|floor' }] } },
    { name: 'base', tags: { require: [{ tag: 'shape|base' }] } },
  ],
}

function authorities(): DesignAuthorities {
  const file = fillFixture(RECORDS)
  return {
    recipes: [TEMPLATE],
    index: buildAssemblyIndex(file),
    composition: createCompositionIndex(file, buildAggregateIndex(file)),
  }
}

/** The empty authorities a host with no catalog in hand passes. */
const NO_FIGURES: DesignAuthorities = { recipes: undefined, index: undefined, composition: undefined }

const design = (): string | undefined => useWorkshopStore.getState().design

function open(props: Partial<{ placed: number; authorities: DesignAuthorities }> = {}): HTMLElement {
  render(<DesignToggle authorities={props.authorities ?? authorities()} placed={props.placed ?? 0} />)
  fireEvent.click(screen.getByRole('button', { name: /Room design/ }))
  return screen.getByRole('dialog')
}

beforeEach(() => {
  resetWorkshop()
  clearPersistedWorkshopState()
})

afterEach(() => {
  resetWorkshop()
})

/* ------------------------------------------------------------------ the trigger */

describe('the trigger', () => {
  it('says there is no design, and says what that means', () => {
    render(<DesignToggle authorities={authorities()} placed={0} />)

    const trigger = screen.getByRole('button', { name: /Room design/ })
    expect(trigger).toHaveAccessibleName(/Room design: none/)
    // The consequence, not just the state: with no design a piece can come out
    // of several designs at once, which is the defect row D6 exists to close.
    expect(trigger).toHaveAccessibleName(/can mix designs/)
  })

  it('states the design in effect and how far it reaches', () => {
    setRoomDesign('slate')
    render(<DesignToggle authorities={authorities()} placed={0} />)

    const trigger = screen.getByRole('button', { name: /Room design/ })
    expect(trigger).toHaveAccessibleName(/Room design: Slate/)
    // Measured, from the fixture's own two parts. A build that hard-coded a
    // figure here would print the archive's instead.
    expect(trigger).toHaveAccessibleName(/reaching 2 of 2 placeable parts/)
    expect(trigger).toHaveTextContent('2/2')
  })

  it('shows a dash rather than a figure when the indexes are not in hand', () => {
    setRoomDesign('slate')
    render(<DesignToggle authorities={NO_FIGURES} placed={0} />)

    const trigger = screen.getByRole('button', { name: /Room design/ })
    expect(trigger).toHaveTextContent('—')
    // The name still carries the design: the choice is recorded in the store and
    // does not depend on the catalog.
    expect(trigger).toHaveAccessibleName(/Room design: slate/)
  })
})

/* ------------------------------------------------------------------- the picker */

describe('the picker', () => {
  it('offers no design first, then the designs that reach something', () => {
    const dialog = open()

    /* Order is the derivation's — reach descending, then the label — so a
       rescan that moved which design reaches furthest reorders the list rather
       than leaving a stale first row. `Bark wood` and `Mosaic` both reach one
       part, and the label is what separates them. */
    expect(
      within(dialog)
        .getAllByRole('radio')
        .map((radio) => (radio.getAttribute('aria-label') ?? '').split('.')[0]),
    ).toEqual(['No room design', 'Slate', 'Bark wood', 'Mosaic'])
  })

  it('does not offer a design that reaches nothing this build can place', () => {
    const dialog = open()

    // `driftwood` is on a record no part admits and `plain` is on the base slot
    // only. Choosing either could not change a fill, so neither is a choice.
    expect(within(dialog).queryByRole('radio', { name: /Driftwood/ })).toBeNull()
    expect(within(dialog).queryByRole('radio', { name: /Plain/ })).toBeNull()
    // And the count of what is not offered is stated rather than hidden.
    expect(dialog).toHaveTextContent(/2 more designs exist in the archive and are not offered/)
  })

  it('announces a row as one sentence carrying both numbers', () => {
    const dialog = open()

    expect(within(dialog).getByRole('radio', { name: /^Slate/ })).toHaveAccessibleName(
      'Slate. Reaches 2 of 2 parts (100.0%), 2 items in the archive.',
    )
  })

  it('writes the store when a design is picked', () => {
    const dialog = open()

    fireEvent.click(within(dialog).getByRole('radio', { name: /^Mosaic/ }))

    // Not just the DOM: this value is what `FillContext.family` reads, and a
    // picker that only looked selected would change no fill.
    expect(design()).toBe('mosaic')
  })

  it('clears the design back to none, which is a decision and not an undo', () => {
    setRoomDesign('slate')
    const dialog = open()

    fireEvent.click(within(dialog).getByRole('radio', { name: /^No room design/ }))

    expect(design()).toBeUndefined()
  })

  it('reports a press on the design already in effect', () => {
    setRoomDesign('slate')
    const dialog = open()

    // A controlled radio fires no `change` when it is already checked, so the
    // component listens for the click too — `LockPicker`'s finding, and without
    // it this row would be a dead press for a user who opened the picker to
    // confirm their answer.
    fireEvent.click(within(dialog).getByRole('radio', { name: /^Slate/ }))

    expect(design()).toBe('slate')
  })

  it('lets the choice be made with no figures at all', () => {
    const dialog = open({ authorities: NO_FIGURES })

    expect(dialog).toHaveTextContent(/has not been read yet/)
    fireEvent.click(within(dialog).getByRole('radio', { name: /^No room design/ }))
    expect(design()).toBeUndefined()
  })
})

/* -------------------------------------------------------------- the disclosure */

describe('the disclosure', () => {
  it('says the base is not in the count, and why', () => {
    const dialog = open()

    // Every base in this fixture is `plain`, as 38 of the archive's 40 base
    // slots are — so the sentence is derived and reads as *none of them*.
    expect(dialog).toHaveTextContent(/Bases are not in the count/)
    expect(dialog).toHaveTextContent(/Not one of the 1 base slots has a candidate in any design/)
  })

  it('says a design is a preference and not a filter', () => {
    const dialog = open()

    expect(dialog).toHaveTextContent(/a part with nothing in your design is still filled/)
  })

  it('does not warn about a scene when there is none', () => {
    const dialog = open({ placed: 0 })

    expect(dialog).toHaveTextContent(/Nothing is placed yet/)
    expect(dialog).not.toHaveTextContent(/chosen by hand/)
  })

  it('warns that a change rewrites the room, and says what it keeps', () => {
    const dialog = open({ placed: 12 })

    // The *opposite* sentence from the lock's, and that is the reason it is not
    // shared copy: a lock change keeps every placed file, and a design change
    // rewrites every unpinned one — 108 of 128 slots on the live archive.
    expect(dialog).toHaveTextContent(/You have 12 pieces placed/)
    expect(dialog).toHaveTextContent(/re-fills every part you have not chosen by hand/)
    expect(dialog).toHaveTextContent(/pinned and is kept exactly as it is/)
  })

  it('says pieces in the singular for one', () => {
    expect(open({ placed: 1 })).toHaveTextContent(/You have 1 piece placed/)
  })
})
