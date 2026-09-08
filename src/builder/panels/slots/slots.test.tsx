// @vitest-environment jsdom
/**
 * The plan's pieces and their slots — the inventory, the panel, and row C3's
 * editor.
 *
 * Three groups of assertions, and each one is about something no other surface
 * in the app can say:
 *
 *   - **the accessory inventory** — a drawing's *open* composition slots are
 *     counted at all, and the count separates a slot the user can fill from one
 *     **nothing in the archive can** (9 of the corpus's 1,244 declarations);
 *   - **the panel** — one row per placed piece, naming the family and what it
 *     still needs, and opening the editor on a **right click** as well as on a
 *     press, because §3.3 asks for both;
 *   - **the editor** — the design filter, the greyed dead end, the write that is
 *     `pinned`, and the refusal. The refusal is the row's headline and is the
 *     one thing the guided-assembly walk cannot report on its own: a card that
 *     would empty a still-**open** sibling is greyed before it is pressed, and a
 *     card that would invalidate a sibling's **existing fill** is pressed,
 *     refused, and told why.
 *
 * The fixture is row C2's, shared with the drawer's picker rather than copied:
 * the dead-end case is delicate enough that two versions of it would drift.
 * {@link EDITOR_TEMPLATE} is this file's own and is the smallest recipe that
 * reaches both failures — a `top` slot whose two items carry different textures,
 * and a `base` slot that inherits texture from it.
 *
 * Row **A0** removed the two assertions about where a pick *lands*, because the
 * library they landed in was gone. They are back, against the destination the
 * templates plan intended: `pinFill` on the placed instance, `pinned: true`.
 *
 * ## A holder is a filled slot, since row A8
 *
 * Every `at(…)` below is a **template instance with one fill**, and the fill
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
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildAssemblyIndex } from '@/assembly'
import type { TileId } from '@/catalog'
import type { RecipeTemplate } from '@/assembly'
import { FILL, PARENT, SLOT_CATALOG } from '@/screens/detail/slots/fixture'
import type { TemplateInstance } from '@/store'
import {
  PlacementId,
  SlotName,
  TemplateId,
  clearPersistedWorkshopState,
  resetWorkshop,
  useWorkshopStore,
} from '@/store'

import { slotEditorModel } from './slotEditor'
import { planPieces, planSlots } from './planSlots'
import type { SlotEditTarget } from './SlotsPanel'
import { SlotsPanel } from './SlotsPanel'

/** Built once: it is a pure function of the fixture and scans every record. */
const ASSEMBLY = buildAssemblyIndex(SLOT_CATALOG)

/**
 * The smallest recipe that reaches both of §3.3's failures.
 *
 * `top` offers two items in two textures — `Dungeon Stone Secret Door Top` and
 * `Towne Secret Door Top` — and `base` inherits `texture` from whatever fills
 * `top`. So with `base` still open, the towne top is a **dead end** (no base is
 * towne, and the greying walk says so before the press); with `base` already
 * filled by the stone base, the same card is not greyed — `assemblyState`'s
 * `open` map excludes a part that has a choice — and pressing it must be
 * **refused**, because it would put that base outside its own slot.
 *
 * The recipe's own tags carry no `texture|`, which is what makes the constraint
 * come from the sibling rather than from the template: 230 template tags over the
 * 40 fixture recipes and four roots, none of them `size|` or `texture|`.
 */
const EDITOR_TEMPLATE: RecipeTemplate = {
  id: 'fixture-secret-door',
  name: 'Fixture: Secret Door',
  source: 'fixture',
  tags: ['object|tile'],
  parts: [
    { name: 'top', tags: { require: [{ tag: 'component|top' }] }, fulfills: [] },
    {
      name: 'base',
      tags: { require: [{ tag: 'shape|base' }], constrain: [{ tag: 'texture' }] },
      fulfills: [],
    },
  ],
}

/**
 * A recipe whose part names **are** one of B2's three layout conventions, so the
 * geometry rule actually runs.
 *
 * `WALL_ON_TILE` is exactly `base`, `floor`, `wall` and `layoutFor` matches on
 * the part-name *set*, so this is the smallest template for which
 * `placeTemplateSlots` produces a cell, a size predicate per slot and a doubt.
 * {@link EDITOR_TEMPLATE} deliberately does not match one — a two-part `top` and
 * `base` recipe is B4's generated shape, where there is no authored layout and
 * therefore nothing to disclose.
 *
 * `floor` is the cell slot on all three conventions, and it predicates on
 * `size|width|2` rather than on a shape so that the fixture's `rect 2x2` grate
 * and its `wall`-footed walls are both in the pool: what is under test is the
 * closure arithmetic over the fills, not the tag.
 */
const MITRE_TEMPLATE: RecipeTemplate = {
  id: 'fixture-wall-on-tile',
  name: 'Fixture: Wall on Tile',
  source: 'fixture',
  tags: ['object|tile'],
  parts: [
    { name: 'base', tags: { require: [{ tag: 'shape|base' }] }, fulfills: [] },
    { name: 'floor', tags: { require: [{ tag: 'size|width|2' }] }, fulfills: [] },
    { name: 'wall', tags: { require: [{ tag: 'shape|wall' }] }, fulfills: [] },
  ],
}

const TEMPLATES = (id: string): RecipeTemplate | undefined =>
  [EDITOR_TEMPLATE, MITRE_TEMPLATE].find((one) => one.id === id)

/**
 * The panel with the two indexes the builder screen hands it — and the open
 * state row **C8** lifted out of it.
 *
 * A host component holding `editing` rather than a fixed prop, and the
 * difference is not cosmetic: since C8 the editor's open state is
 * `BuilderScreen`'s, because the same dialog opens from a right click on the 3D
 * drawing, so every assertion below about the editor appearing is now an
 * assertion about the **round trip** — the panel asks through `onEdit`, the
 * owner of the state answers, the panel renders. Passing `editing={null}` with a
 * no-op `onEdit` would leave all of them passing while the editor never opened.
 *
 * `start` is what a right click on the *drawing* hands over: a placement and the
 * slot whose part was under the pointer. It defaults to `null`, so every test
 * written before this row exercises exactly the path it did.
 */
function panel(placements: Record<string, TemplateInstance>, start: SlotEditTarget | null = null) {
  function Host() {
    const [editing, setEditing] = useState<SlotEditTarget | null>(start)
    return (
      <SlotsPanel
        assembly={ASSEMBLY}
        catalog={SLOT_CATALOG}
        editing={editing}
        onEdit={setEditing}
        placements={placements}
        templates={TEMPLATES}
      />
    )
  }
  return render(<Host />)
}

/**
 * The one recipe these tests place.
 *
 * A slug rather than one of the 40 real ids: `planSlots` never looks a template
 * up — it walks the fills — so the family it names is not one of this file's
 * facts, and naming a real one would imply the fills below belong to its slots.
 */
const A_RECIPE = 'slots-fixture'

/** The one placement key the editor tests read back, branded once. */
const KEY = PlacementId.parse('a')

/** The `top` slot, branded once — a `Record<SlotName, …>` will not take a literal. */
const TOP = SlotName.parse('top')

/** The stone base, which is what the towne top would strand. */
const BASE_STONE = 'tiles/dungeon_stone/bases/base/stone%base.2x.stl'

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
    /* *Any* on every axis, which is what these fixtures are about: a position
       narrows the slot lists and each test that cares passes its own. */
    position: [],
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

/* ------------------------------------------------------------- the piece list */

/**
 * An instance of {@link EDITOR_TEMPLATE} with named fills.
 *
 * `pinned: false` throughout, so the editor's own write is the only thing in
 * this file that can produce a `true` — which is what makes the `pinned`
 * assertion below about contract **C-k** rather than about the fixture.
 */
function piece(fills: Readonly<Record<string, string>>, x = 0, z = 0): TemplateInstance {
  return {
    /* {@link KEY}, and it has to match the map key the panel is given: `pinFill`
       addresses the store by `TemplateInstance.id` and the schema's rule is that
       the key wins, so a fixture whose two disagree would silently write
       nothing. */
    id: KEY,
    template: TemplateId.parse(EDITOR_TEMPLATE.id),
    x,
    z,
    rotation: 0,
    fills: Object.fromEntries(
      Object.entries(fills).map(([slot, tile]) => [
        SlotName.parse(slot),
        { tile: tile as TileId, pinned: false },
      ]),
    ),
    position: [],
  }
}

describe('planPieces', () => {
  it('counts the declared slots a piece has filled, and names the ones it has not', () => {
    const [only] = planPieces(SLOT_CATALOG, { a: piece({ top: FILL.topWall }) }, TEMPLATES)
    expect(only).toMatchObject({ name: 'Fixture: Secret Door', slots: 2, filled: 1, pinned: 0 })
    expect(only?.needsChoice).toEqual(['base'])
  })

  it('reads the plan in depth-then-across order, the same as the bill', () => {
    const pieces = planPieces(
      SLOT_CATALOG,
      {
        far: piece({ top: FILL.topWall }, 0, 4),
        nearRight: piece({ top: FILL.topWall }, 3, 0),
        nearLeft: piece({ top: FILL.topWall }, 0, 0),
      },
      TEMPLATES,
    )
    expect(pieces.map((one) => one.placement)).toEqual(['nearLeft', 'nearRight', 'far'])
  })

  it('calls a fill this index has retired a slot needing a choice', () => {
    // Not "filled": the file is in the store and not in the catalog, so there is
    // nothing to print and nothing to draw. The same reading `resolveInstance`
    // takes, which emits `unknown-tile` *and* `slot-unfilled` for one fill.
    const [only] = planPieces(SLOT_CATALOG, { a: piece({ top: RETIRED_TILE }) }, TEMPLATES)
    expect(only).toMatchObject({ filled: 0 })
    expect(only?.needsChoice).toEqual(['top', 'base'])
  })

  it('says nothing about the slots of a recipe this build no longer ships', () => {
    const [only] = planPieces(SLOT_CATALOG, { a: at(PARENT.wallTowne, 0, 0) }, TEMPLATES)
    expect(only?.template).toBeUndefined()
    // The id, because there is no name to give: `TemplateId` is not a catalog
    // identity and only the party holding the table can turn one into a name.
    expect(only?.name).toBe(A_RECIPE)
    expect(only?.slots).toBe(0)
  })
})

/* ----------------------------------------------------------------- the panel */

describe('SlotsPanel', () => {
  it('states the archive’s 11.5% when the plan opens no accessory', () => {
    panel({ a: at(PARENT.plainFloor, 0, 0) })
    expect(screen.getByText(/1,005 of the archive’s 8,702 files declare a slot/)).toBeInTheDocument()
  })

  it('leads with the pieces and how many slots still need a choice', () => {
    panel({ a: piece({ top: FILL.topWall }), b: piece({}, 2, 0) })
    // One piece has its `base` open and the other has both — three in all.
    expect(screen.getByText(/2 pieces placed\./)).toBeInTheDocument()
    expect(screen.getByText(/3 slots need a choice/)).toBeInTheDocument()
  })

  it('names each piece with its family and its grid position', () => {
    panel({ a: piece({ top: FILL.topWall }, 3.5, 2) })
    const row = screen.getByRole('button', { name: /Fixture: Secret Door/ })
    expect(row).toHaveAccessibleName(/at x 3\.5, z 2/)
    expect(row).toHaveAccessibleName(/1 of 2 slots filled/)
    expect(row).toHaveAccessibleName(/needs a choice: base/)
  })

  it('refuses to open a piece whose recipe this build does not ship, and says so', () => {
    panel({ a: at(PARENT.wallTowne, 0, 0) })
    expect(screen.getByRole('button', { name: /ships no such recipe/ })).toBeDisabled()
    expect(
      screen.getByText(/1 piece names a recipe this build no longer ships/),
    ).toBeInTheDocument()
  })

  it('explains that an accessory pick is a preview, because a fill is one level up', () => {
    panel({ a: at(PARENT.wallTowne, 0, 0), b: at(PARENT.wallLow, 2, 0) })
    expect(screen.getByText(/2 slots open on 2 pieces, 1 of them required/)).toBeInTheDocument()
    // Row A0 said "not yet something this build can keep", which was a schedule.
    // The reason is structural and is now stated as one: `fills` is flat.
    expect(screen.getByText(/one level below the recipe’s own slots/)).toBeInTheDocument()
  })

  it('names each accessory holder with its slot and grid position', () => {
    panel({ a: at(PARENT.wallTowne, 3.5, 2) })
    expect(screen.getByText(/slot0 · x 3\.5, z 2/)).toBeInTheDocument()
    expect(screen.getByText(/Dungeon Stone Torch Wall 2x/)).toBeInTheDocument()
  })

  it('calls an unfillable accessory slot an archive gap rather than a step to take', () => {
    panel({ a: at(PARENT.contradiction, 0, 0) })
    expect(screen.getByText(/gap in the archive, not a step to take/)).toBeInTheDocument()
  })

  it('greys the dead-end accessory pick here too, because the picker is the same one', () => {
    panel({ a: at(PARENT.wallTowne, 0, 0) })
    expect(screen.getByRole('button', { name: /Towne Torch/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('says how many placements it cannot describe', () => {
    panel({ gone: atRetired() })
    expect(
      // "a file", not "an item": a fill names a file (decision D1), so an orphan
      // is a file the index has retired rather than an item it has lost.
      screen.getByText(/1 placement names a file this index no longer holds/),
    ).toBeInTheDocument()
  })

  it('scopes each accessory picker to that placement’s own file', () => {
    const { container } = panel({ a: at(PARENT.wallTowne, 0, 0), b: at(PARENT.pairedGrate, 2, 0) })
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

/* ---------------------------------------------------------------- the editor */

/** The piece row, whichever way it is going to be opened. */
const pieceRow = () => screen.getByRole('button', { name: /Fixture: Secret Door/ })

/** A card in the editor's grid, by the item it stands for. */
const card = (name: string | RegExp) =>
  within(screen.getByRole('group', { name: /^Fill the/ })).getByRole('button', { name })

describe('the instance’s control position narrows the editor', () => {
  /**
   * A one-slot recipe whose slot **constrains `texture`**, so a position can
   * reach it.
   *
   * Purpose-built rather than reusing {@link EDITOR_TEMPLATE}: that one's `top`
   * slot declares no `constrain` at all, which is the correct shape for what it
   * tests and exactly the shape a position cannot narrow. A position is offered
   * to every slot and collected only by the ones that asked — that is the whole
   * mechanism — so a fixture without a `constrain` block would test nothing here
   * and adding one to it would move the assertions of five other tests.
   */
  const TEXTURED: RecipeTemplate = {
    id: 'fixture-textured-top',
    name: 'Fixture: Textured Top',
    source: 'fixture',
    tags: ['object|tile'],
    parts: [
      {
        name: 'top',
        tags: { require: [{ tag: 'component|top' }], constrain: [{ tag: 'texture', siblings: [] }] },
        fulfills: [],
      },
    ],
  }

  const modelAt = (position: readonly string[]) =>
    slotEditorModel(
      SLOT_CATALOG,
      ASSEMBLY,
      {
        id: KEY,
        template: TemplateId.parse(TEXTURED.id),
        x: 0,
        z: 0,
        rotation: 0,
        fills: {},
        position,
      },
      TEXTURED,
    )

  it('offers every texture when the instance was placed at no position', () => {
    // `[]` is *any*: the `constrain` collects nothing and the slot admits what
    // its own `require` does.
    const designs = modelAt([]).slots[0]?.designs ?? []
    expect(designs.length).toBeGreaterThan(1)
  })

  it('offers only the position’s texture when the instance carries one', () => {
    /* **The point of storing the position.** The instance was placed as a towne
       piece, so its editor offers towne tops — not every top in the archive and
       then a surprise when the user picks one the placement never meant. */
    const designs = modelAt(['texture|towne']).slots[0]?.designs ?? []
    expect(designs.length).toBeGreaterThan(0)
    expect(designs.length).toBeLessThan((modelAt([]).slots[0]?.designs ?? []).length)
    for (const bucket of designs) expect(bucket.family).toBe('towne')
  })
})

describe('the slot editor', () => {
  it('opens on a right click, which is what §3.3 asks for', () => {
    panel({ a: piece({ top: FILL.topWall }) })
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.contextMenu(pieceRow())

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAccessibleName('Fixture: Secret Door')
    // Both slots listed, and it opens on the one still needing a choice.
    expect(within(dialog).getByRole('group', { name: 'Fill the base slot' })).toBeInTheDocument()
  })

  it('opens on the slot the drawing’s right click landed in, not on the first gap', () => {
    /*
      Row **C8**, and the assertion is the *difference* rather than the mere
      presence of a dialog: `top` is filled and `base` is empty, so the editor's
      own rule — first slot needing a choice — opens on `base`. A right click on
      the drawing lands on a part, `partAt` names `top`, and the row the user
      pointed at wins. Without `initialSlot` the group below reads
      *Fill the base slot*, which is what the test above asserts.
    */
    panel({ a: piece({ top: FILL.topWall }) }, { placement: KEY, slot: TOP })

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('group', { name: 'Fill the top slot' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('group', { name: 'Fill the base slot' })).toBeNull()
  })

  it('falls back to the first gap when the named slot is not one this recipe has', () => {
    // The two slot names come from different walks — a drawn part's `slot` and
    // `template.parts` — and they agree today because a fill is keyed by the
    // recipe's own part name. If they ever stop agreeing the editor must open on
    // its own rule rather than on nothing.
    panel({ a: piece({ top: FILL.topWall }) }, { placement: KEY, slot: SlotName.parse('no such slot') })

    expect(
      within(screen.getByRole('dialog')).getByRole('group', { name: 'Fill the base slot' }),
    ).toBeInTheDocument()
  })

  it('opens on a plain press too, so it is reachable without a pointer', () => {
    // The right click has no keyboard equivalent every platform agrees on, so
    // the row is a real `<button>` and `Enter` fires its `onClick`. Asserted as
    // a click because that is what jsdom dispatches for `Enter` on a button.
    panel({ a: piece({ top: FILL.topWall }) })
    fireEvent.click(pieceRow())
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('closes on Escape, so it is dismissible without a pointer', () => {
    panel({ a: piece({ top: FILL.topWall }) })
    fireEvent.contextMenu(pieceRow())
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('offers the design filter, counted in items, and applies it', () => {
    // §1.6: the filter is the texture family, and the count is what it leaves.
    // `top` offers one dungeon_stone item and one towne item.
    panel({ a: piece({}) })
    fireEvent.contextMenu(pieceRow())

    // By class rather than by role, because a chip and the card it leaves carry
    // the same texture in their accessible names.
    const chips = () => [
      ...document.querySelectorAll<HTMLButtonElement>('.of-sloted-design'),
    ]
    // Every chip says how many cards it leaves, which is the number the filter
    // exists to move — §1.6's 394 buckets against 428 unfiltered.
    expect(chips().map((chip) => chip.textContent)).toEqual([
      'Any design2',
      'Dungeon stone1',
      'Towne1',
    ])
    expect(chips()[0]).toHaveAttribute('aria-pressed', 'true')
    expect(card(/Dungeon Stone Secret Door Top/)).toBeInTheDocument()
    expect(card(/Towne Secret Door Top/)).toBeInTheDocument()

    fireEvent.click(chips()[2]!)
    expect(screen.queryByRole('button', { name: /Dungeon Stone Secret Door Top/ })).toBeNull()
    expect(card(/Towne Secret Door Top/)).toBeInTheDocument()
  })

  it('greys the pick that would empty a still-open sibling, before it is pressed', () => {
    panel({ a: piece({}) })
    fireEvent.contextMenu(pieceRow())

    const towne = card(/Towne Secret Door Top/)
    expect(towne).toHaveAttribute('aria-disabled', 'true')
    expect(towne).toHaveAccessibleName(/unavailable/)
    // Focusable, so the reason stays reachable — C2's rule, kept.
    expect(towne).not.toBeDisabled()

    fireEvent.click(towne)
    expect(useWorkshopStore.getState().placements[KEY]?.fills[TOP]).toBeUndefined()
  })

  it('writes a pick as pinned, so the lock re-solve honours it', () => {
    // Contract C-k from the other end: the editor is the one thing in the app
    // that writes `pinned: true`, and `fillSlot` refuses to overwrite it.
    useWorkshopStore.setState({ placements: { [KEY]: piece({}) } })
    panel(useWorkshopStore.getState().placements)
    fireEvent.contextMenu(pieceRow())

    fireEvent.click(card(/Dungeon Stone Secret Door Top/))

    expect(useWorkshopStore.getState().placements[KEY]?.fills[TOP]).toEqual({
      tile: FILL.topWall,
      pinned: true,
    })
  })

  it('refuses a pick that would invalidate a sibling’s existing fill, with the reason', () => {
    // §3.3's rule, and the row's headline. `base` holds the stone base, so the
    // towne top is *not* greyed — the greying walk only speaks about still-open
    // parts — and the press has to be refused rather than repaired, because
    // there is no store action that can clear the base it would strand.
    const held = piece({ top: FILL.topWall, base: BASE_STONE })
    useWorkshopStore.setState({ placements: { [KEY]: held } })
    panel(useWorkshopStore.getState().placements)
    fireEvent.contextMenu(pieceRow())
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^top —/ }))

    const towne = card(/Towne Secret Door Top/)
    expect(towne).not.toHaveAttribute('aria-disabled')

    fireEvent.click(towne)

    expect(screen.getByRole('alert')).toHaveTextContent(
      /Towne Secret Door Top cannot go in the top slot/,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      /Dungeon Stone Base 2x in the base slot/,
    )
    // Refused, not repaired: neither slot moved.
    expect(useWorkshopStore.getState().placements[KEY]?.fills).toEqual(held.fills)
  })

  it('discloses a slot the layout rule cannot fit, rather than fabricating a number', () => {
    // §9 and brief point 1: the 8 single-piece corner mitres are in no tag and
    // no measurement, so an over-run must surface as *needs a choice* and the
    // panel must not write the figure that would close it. `slotDoubtSentence`'s
    // docblock says the panel that mounts it is this row's; this is that mount.
    //
    // A 1 x 1 cell with a 2-unit wall on its edge is the same arithmetic the
    // corner mitres fail on, reached with two fills instead of five.
    panel({
      a: {
        id: KEY,
        template: TemplateId.parse(MITRE_TEMPLATE.id),
        x: 0,
        z: 0,
        rotation: 0,
        fills: {
          [SlotName.parse('floor')]: { tile: PARENT.plainFloor as TileId, pinned: true },
          [SlotName.parse('wall')]: { tile: PARENT.wallTowne as TileId, pinned: true },
        },
        position: [],
      },
    })
    fireEvent.contextMenu(screen.getByRole('button', { name: /Fixture: Wall on Tile/ }))

    // Both numbers, and neither is a correction: `want` is the cell edge and
    // `got` is what the pieces on it sum to.
    expect(
      screen.getByText(/The wall part needs a choice: this edge is 1 units and the pieces on it come to 2/),
    ).toBeInTheDocument()
    // And the empty slot is named as a doubt of its own, not inferred.
    expect(screen.getByText(/The base part needs a choice\./)).toBeInTheDocument()
  })

  it('names the size a slot wants, which is how "based on size" is answered', () => {
    // B3's predicate over the instance's own resolved cell — the 2 x 2 grate in
    // the `floor` slot makes it a 2 x 2 cell, so the `base` slot wants that and
    // the `wall` slot wants a 2-unit run along its edge.
    panel({
      a: {
        id: KEY,
        template: TemplateId.parse(MITRE_TEMPLATE.id),
        x: 0,
        z: 0,
        rotation: 0,
        fills: { [SlotName.parse('floor')]: { tile: PARENT.pairedGrate as TileId, pinned: true } },
        position: [],
      },
    })
    fireEvent.contextMenu(screen.getByRole('button', { name: /Fixture: Wall on Tile/ }))

    expect(screen.getByText(/This slot takes 2 wide by 2 deep\./)).toBeInTheDocument()
  })

  it('leads with the slots that still need a choice', () => {
    panel({ a: piece({}) })
    fireEvent.contextMenu(pieceRow())
    expect(screen.getByText(/2 of these slots need a choice: top, base/)).toBeInTheDocument()
  })

  /* --------------------------------------------------- row A11's two actions */

  it('empties a slot on the user’s say-so, and the piece stays on the plan', () => {
    // Contract C-g from the editor's end: `clearFill` removes the fill and not
    // the instance, so the slot reads *needs a choice* and the download refuses
    // until it is filled. `panels.test.tsx` carries the refusal itself, because
    // that needs a bill.
    useWorkshopStore.setState({ placements: { [KEY]: piece({ top: FILL.topWall }) } })
    panel(useWorkshopStore.getState().placements)
    fireEvent.contextMenu(pieceRow())
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^top —/ }))

    fireEvent.click(screen.getByRole('button', { name: /^Empty the top slot/ }))

    const fills = useWorkshopStore.getState().placements[KEY]?.fills ?? {}
    expect(fills[TOP]).toBeUndefined()
    // The key is gone rather than set to `undefined` — see `clearFill`.
    expect(TOP in fills).toBe(false)
    expect(useWorkshopStore.getState().placements[KEY]?.template).toBeDefined()
  })

  it('offers nothing to empty on a slot that is already empty', () => {
    panel({ a: piece({}) })
    fireEvent.contextMenu(pieceRow())
    expect(screen.queryByRole('button', { name: /^Empty the/ })).toBeNull()
  })

  it('offers no hand-back on a slot the solver filled, only on one the user chose', () => {
    // The preference already owns an `auto` fill, so the control would claim to
    // do something it cannot — and `unpinFill` would answer `'unchanged'`.
    useWorkshopStore.setState({ placements: { [KEY]: piece({ top: FILL.topWall }) } })
    panel(useWorkshopStore.getState().placements)
    fireEvent.contextMenu(pieceRow())
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^top —/ }))

    expect(screen.getByRole('button', { name: /^Empty the top slot/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Hand the top slot back/ })).toBeNull()
  })

  it('hands a pinned slot back to the lock and re-solves it in the same press', () => {
    // Row A11's headline, and the reason the re-solve cannot wait for the next
    // lock change: `relock.ts#pinsOf` walks the *pinned* fills only, so an unpin
    // with no re-solve would remove the slot from C2's `PinLockWarning` while
    // leaving the file it warned about in the pack.
    //
    // The pin is the **towne** top, which the solver would never choose with
    // `base` open — no base in this fixture is towne, so it is the greying
    // walk's dead end. That makes the assertion below prove three things at
    // once: the bit was dropped, the solver actually ran, and it ran against the
    // instance as the store holds it *after* the unpin. Passing the render's
    // copy would have handed the towne top back as a fixed preset and the whole
    // press would have been a no-op that looked like a repair.
    const pinned = piece({ top: FILL.topTowne })
    useWorkshopStore.setState({
      placements: { [KEY]: { ...pinned, fills: { [TOP]: { tile: FILL.topTowne as TileId, pinned: true } } } },
    })
    panel(useWorkshopStore.getState().placements)
    fireEvent.contextMenu(pieceRow())
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^top —/ }))

    fireEvent.click(screen.getByRole('button', { name: /^Hand the top slot back/ }))

    expect(useWorkshopStore.getState().placements[KEY]?.fills[TOP]).toEqual({
      tile: FILL.topWall,
      pinned: false,
    })
  })
})
