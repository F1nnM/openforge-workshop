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
  HoldName,
  PlacementId,
  SlotName,
  TemplateId,
  clearPersistedWorkshopState,
  resetWorkshop,
  useWorkshopStore,
} from '@/store'

import { AccessorySection } from './AccessorySection'
import { planSlots } from './planSlots'
import type { SlotEditTarget } from './SlotEditor'
import { SlotEditor } from './SlotEditor'
import { slotEditorModel } from './slotEditor'

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

/**
 * A one-slot recipe carrying a **real assembly's id**, so `families.ts` has a row
 * for it and its three control axes exist.
 *
 * The id is the one fact this fixture borrows: `editorAxes` reads the domain off
 * `ASSEMBLY_CONTROLS` — deliberately, so the palette and the editor cannot offer
 * different chips for the same piece — and an invented id has no row and
 * therefore no axes. The *parts* are this file's own, and the slot is shaped so
 * two of that assembly's real component positions reach the fixture's records:
 * `constrain: [component]` collects the filter, and `texture|dungeon_stone`
 * admits the stone torches, tops and grates alike until one does.
 */
const FILTERED_TEMPLATE: RecipeTemplate = {
  id: 's2w-wall-on-tile-wall-modular',
  name: 'S2W: Wall on Tile: Wall (Modular)',
  source: 'fixture',
  tags: ['object|tile'],
  parts: [
    {
      name: 'insert',
      tags: {
        require: [{ tag: 'texture|dungeon_stone' }],
        constrain: [{ tag: 'component', siblings: [] }],
      },
      fulfills: [],
    },
  ],
}

const TEMPLATES = (id: string): RecipeTemplate | undefined =>
  [EDITOR_TEMPLATE, MITRE_TEMPLATE, FILTERED_TEMPLATE].find((one) => one.id === id)

/** The accessory inventory over a plan, which is all this section is now. */
function accessories(placements: Record<string, TemplateInstance>) {
  return render(<AccessorySection catalog={SLOT_CATALOG} placements={placements} />)
}

/**
 * The editor, mounted the way `BuilderScreen` mounts it.
 *
 * **It is not opened from a panel any more, and that is what the sidebar cleanup
 * moved.** The editor is a modal dialog and its open state was already the
 * screen's — two surfaces open one dialog, so neither could hold the other's —
 * and the surfaces are now the 3D drawing's right click and a `Slots` press on a
 * bill row. Neither is in this file, so this host is the screen's own three
 * lines: resolve the target to an instance and a recipe, render the dialog, and
 * take `null` back from `onClose`.
 *
 * `target` is what an opener hands over: a placement, and optionally the slot
 * whose part was under the pointer. Held in state rather than fixed, so the
 * Escape assertion is a real round trip.
 */
function editor(placements: Record<string, TemplateInstance>, target: SlotEditTarget) {
  function Host() {
    const [editing, setEditing] = useState<SlotEditTarget | null>(target)
    const instance = editing === null ? undefined : placements[editing.placement]
    const template = instance === undefined ? undefined : TEMPLATES(instance.template)
    if (instance === undefined || template === undefined) return null
    return (
      <SlotEditor
        catalog={SLOT_CATALOG}
        index={ASSEMBLY}
        instance={instance}
        key={`${instance.id}:${editing?.slot ?? ''}`}
        onClose={() => {
          setEditing(null)
        }}
        {...(editing?.slot === undefined ? {} : { initialSlot: editing.slot })}
        template={template}
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
    filters: [],
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
    filters: [],
  }
}

/* ------------------------------------------------------ the accessory list */

describe('AccessorySection', () => {
  /**
   * **The empty state is the normal state, so it is nothing at all.**
   *
   * 1,005 of the archive's 8,702 files declare a slot — 11.5% — so the common
   * plan opens none, and this section used to spend a four-line paragraph
   * quoting that arithmetic at every user who had not placed a torch wall. In a
   * fixed-height column beside a parts list, an explanation of why there is
   * nothing to show costs the parts list four lines on nearly every visit.
   */
  it('renders nothing when the plan opens no accessory', () => {
    const { container } = accessories({ a: at(PARENT.plainFloor, 0, 0) })
    expect(container).toBeEmptyDOMElement()
  })

  it('states what a pick here does, now that it keeps it', () => {
    accessories({ a: at(PARENT.wallTowne, 0, 0), b: at(PARENT.wallLow, 2, 0) })
    // The count that *moves*: `torch` is optional and `top` is not, and neither
    // is held, so one slot is a hole. It used to read "1 of them required",
    // which is a property of the archive and stayed put after the user had
    // filled everything.
    expect(screen.getByText(/2 slots on 2 pieces, 1 required and still empty/)).toBeInTheDocument()
    // The structural reason it kept nothing is gone: `SlotFill.holds` is the key
    // for a slot of a *file*, so a press here is a store write like any other and
    // the line says what the write does rather than apologising for its absence.
    expect(screen.getByText(/pinned to that piece and counted once per measured mount/)).toBeInTheDocument()
    expect(screen.queryByText(/Previews only/)).toBeNull()
  })

  it('names each accessory holder with its slot and grid position', () => {
    accessories({ a: at(PARENT.wallTowne, 3.5, 2) })
    expect(screen.getByText(/slot0 · x 3\.5, z 2/)).toBeInTheDocument()
    expect(screen.getByText(/Dungeon Stone Torch Wall 2x/)).toBeInTheDocument()
  })

  it('calls an unfillable accessory slot an archive gap rather than a step to take', () => {
    accessories({ a: at(PARENT.contradiction, 0, 0) })
    expect(screen.getByText(/gap in the archive, not a step to take/)).toBeInTheDocument()
  })

  it('greys the dead-end accessory pick here too, because the picker is the same one', () => {
    accessories({ a: at(PARENT.wallTowne, 0, 0) })
    expect(screen.getByRole('button', { name: /Towne Torch/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('says how many placements it cannot describe', () => {
    accessories({ gone: atRetired() })
    expect(
      // "a file", not "an item": a fill names a file (decision D1), so an orphan
      // is a file the index has retired rather than an item it has lost.
      screen.getByText(/1 placement names a file this index no longer holds/),
    ).toBeInTheDocument()
  })

  it('scopes each accessory picker to that placement’s own file', () => {
    const { container } = accessories({
      a: at(PARENT.wallTowne, 0, 0),
      b: at(PARENT.pairedGrate, 2, 0),
    })
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

/* ------------------------------------------------------- the pick that lands */

/**
 * **Row C3's other half: a press here writes.**
 *
 * The section used to say *"previews only"* because `TemplateInstance.fills` was
 * one level deep and had no key for a slot of a file. `SlotFill.holds` is that
 * key, so the picker is now the app's editor for an accessory and these are the
 * assertions that it is: what a piece holds is what the picker shows, a press
 * pins, and a second press on the same card takes it out again.
 *
 * The archway rather than the torch wall, because a *write* needs a card that is
 * not greyed: the towne torch closes `wallTowne`'s base slot and the picker
 * declines it, while the archway's `{ filter }` entry means the same card only
 * narrows the lintel. It is also the fixture's one measured host, which is what
 * the mount lines below are read off.
 */
describe('the accessory picker writes what it is given', () => {
  const SLOT0 = SlotName.parse('slot0')

  /** One placed piece whose `slot0` fill is the archway, holding what it is told to. */
  function archway(holds: Readonly<Record<string, string>>): Record<string, TemplateInstance> {
    return {
      [KEY]: {
        id: KEY,
        template: TemplateId.parse(A_RECIPE),
        x: 0,
        z: 0,
        rotation: 0,
        fills: {
          [SLOT0]: {
            tile: PARENT.archway as TileId,
            pinned: false,
            holds: Object.fromEntries(
              Object.entries(holds).map(([hold, tile]) => [
                HoldName.parse(hold),
                { tile: tile as TileId, pinned: true },
              ]),
            ),
          },
        },
        filters: [],
      },
    }
  }

  /**
   * The section over the **store's** scene, because the presses below write
   * there and `pinHold` addresses a placement by its key.
   */
  function placed(placements: Record<string, TemplateInstance>) {
    useWorkshopStore.setState({ placements })
    return accessories(useWorkshopStore.getState().placements)
  }

  /** The holds of the one fill, as the store has them after a press. */
  const held = () => useWorkshopStore.getState().placements[KEY]?.fills[SLOT0]?.holds

  it('shows what the piece already holds as the chosen card', () => {
    placed(archway({ torch: FILL.torchStone }))
    expect(screen.getByRole('button', { name: /Dungeon Stone Torch/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('pins a pick onto the hold it names', () => {
    placed(archway({}))
    fireEvent.click(screen.getByRole('button', { name: /Towne Torch/ }))
    // `pinned: true` — the user chose it, so contract C-k's default-hold pass
    // must not overwrite it on the next hydrate.
    expect(held()).toEqual({ torch: { tile: FILL.torchTowne, pinned: true } })
  })

  it('takes the accessory out again on a second press of the card it holds', () => {
    placed(archway({ torch: FILL.torchStone }))
    fireEvent.click(screen.getByRole('button', { name: /Dungeon Stone Torch/ }))
    // `{}` and not `undefined`: *the user took it out* has to survive a reload as
    // something other than *nobody has looked yet*. See `clearHold`.
    expect(held()).toEqual({})
  })

  it('says how many mounts a slot fills, so the bill’s quantity is no surprise', () => {
    // Row A8 bills one copy per measured mount, and four torches for one press
    // is a number a user cannot account for unless the picker says so first.
    placed(archway({}))
    expect(screen.getByText(/torch × 4 mounts/)).toBeInTheDocument()
  })

  it('stops asking for the slots once every one of them is filled', () => {
    // The summary is about what is left to do, so a plan with nothing left says
    // so. Both of the archway's slots are optional, so this is also the case
    // where "required" was never the interesting number.
    placed(archway({ torch: FILL.torchStone, lintel: FILL.topWall }))
    expect(screen.getByText(/2 slots on 1 piece, all filled/)).toBeInTheDocument()
  })

  it('does not call a plan with an empty optional slot finished', () => {
    // The third ending, and it is not pedantry: *all filled* is a claim about
    // every slot, and an optional socket left empty on purpose has not been
    // filled. What is true is that nothing required is outstanding.
    placed(archway({ torch: FILL.torchStone }))
    expect(screen.getByText(/2 slots on 1 piece, nothing required is still empty/)).toBeInTheDocument()
  })

  it('says when nothing has measured where an accessory goes', () => {
    // `CatalogRecord.mounts` is absent both for a host with no accessory slot and
    // for one nobody has measured, so *counted once, not drawn* is the honest
    // reading of the archive today rather than an error state.
    placed(archway({}))
    expect(
      screen.getByText(/lintel: no measured mount — counted once, not drawn/),
    ).toBeInTheDocument()
  })
})

/* ---------------------------------------------------------------- the editor */

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

  const modelAt = (filters: readonly string[]) =>
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
        filters,
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

describe('the filter chips above the slots', () => {
  const INSERT = SlotName.parse('insert')
  const TORCH_STONE = FILL.torchStone as TileId

  /** One placed instance of {@link FILTERED_TEMPLATE}, at a filter position. */
  function filtered(
    fills: TemplateInstance['fills'] = {},
    filters: readonly string[] = [],
  ): Record<string, TemplateInstance> {
    return {
      a: {
        id: KEY,
        template: TemplateId.parse(FILTERED_TEMPLATE.id),
        x: 0,
        z: 0,
        rotation: 0,
        fills,
        filters,
      },
    }
  }

  /**
   * The editor, open on that instance — **in the store**, because the presses
   * below write there.
   *
   * The host holds its placements as a prop, so the dialog's own copy stays at
   * the position it opened on until the owner re-reads; every assertion here is
   * therefore about the store or about the dialog's own state, which is what
   * those two presses actually move.
   */
  function open(placements: Record<string, TemplateInstance>): HTMLElement {
    useWorkshopStore.setState({ placements })
    editor(useWorkshopStore.getState().placements, { placement: KEY })
    return screen.getByRole('dialog')
  }

  const chip = (dialog: HTMLElement, name: string) =>
    within(dialog).getByRole('button', { name })

  const stored = () => useWorkshopStore.getState().placements[KEY]

  it('mounts one group per axis, above the slot list', () => {
    /* **The placement the owner asked for**: *"It should be placed above the
       actual slots."* Asserted as document order rather than as presence,
       because a control mounted below the slots it narrows would pass every
       other assertion in this block. */
    const dialog = open(filtered())

    const component = within(dialog).getByRole('group', { name: /^Component for / })
    const slots = dialog.querySelector('.of-sloted-slots')

    expect(within(dialog).getByRole('group', { name: /^Height for / })).toBeInTheDocument()
    expect(within(dialog).getByRole('group', { name: /^Size for / })).toBeInTheDocument()
    expect(slots).not.toBeNull()
    expect(
      component.compareDocumentPosition(slots!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeGreaterThan(0)
  })

  it('presses the chip the instance was placed at', () => {
    // The stored filters *are* the control's state — that is the whole point of
    // storing them, and `AxisControl`'s pressed rule is `positionIn`'s.
    const dialog = open(filtered({}, ['component|torch']))
    expect(chip(dialog, 'Component: torch')).toHaveAttribute('aria-pressed', 'true')
    expect(chip(dialog, 'Component: grate')).toHaveAttribute('aria-pressed', 'false')
  })

  it('writes the pressed position onto the instance and re-solves it', () => {
    const dialog = open(filtered())
    expect(stored()?.filters).toEqual([])

    fireEvent.click(chip(dialog, 'Component: torch'))

    expect(stored()?.filters).toEqual(['component|torch'])
    // Re-solved, not merely re-labelled: the slot now holds a torch, which is
    // the only thing the new filter admits.
    expect(stored()?.fills[INSERT]?.tile).toBe(TORCH_STONE)
  })

  it('keeps the other axes where they are', () => {
    /* `filtersWith` rebuilds the whole list from the axes, so a component press
       must not clear a height the user set first — the same rule
       `usePlanTools#setArmedPosition` keeps for the palette, and the reason the
       hook holds three lists rather than one. */
    const dialog = open(filtered({}, ['shape|wall']))

    fireEvent.click(chip(dialog, 'Component: torch'))

    expect(stored()?.filters).toEqual(['component|torch', 'shape|wall'])
  })

  it('drops a pin the new position does not admit, and says so', () => {
    /* **Contract C-k's other half.** `reSolveInstance` may discard a pin on a
       filter change and this is the surface that must not swallow the report:
       the stone top is a deliberate choice, `component|torch` does not admit it,
       and the dialog names both the piece and the slot. */
    const dialog = open(filtered({ [INSERT]: { tile: FILL.topWall as TileId, pinned: true } }))

    fireEvent.click(chip(dialog, 'Component: torch'))

    expect(within(dialog).getByRole('status').textContent).toContain(
      'Dungeon Stone Secret Door Top in the insert slot',
    )
    expect(stored()?.fills[INSERT]).toEqual({ tile: TORCH_STONE, pinned: false })
  })

  it('keeps a pin the new position still admits', () => {
    // The pin is a stone torch and the new position is *torch*, so the choice
    // survives with its bit — nothing is reported and nothing is rewritten.
    const dialog = open(filtered({ [INSERT]: { tile: TORCH_STONE, pinned: true } }))

    fireEvent.click(chip(dialog, 'Component: torch'))

    // `queryAll`, because `needsChoice` is a `status` in this dialog too — what
    // must not be there is the *report*, not every live region.
    expect(
      within(dialog)
        .queryAllByRole('status')
        .some((one) => (one.textContent ?? '').includes('no longer available')),
    ).toBe(false)
    expect(stored()?.fills[INSERT]).toEqual({ tile: TORCH_STONE, pinned: true })
  })
})

describe('the slot editor', () => {
  /**
   * **Where it opens *from* is no longer in this file.**
   *
   * The two openers are a right click on the 3D drawing — asserted in
   * `builder/three/` against the 5 px click discriminator that lives there — and
   * a `Slots` press on a bill row, asserted in `panels.test.tsx` against the
   * request it emits. Both hand over the same {@link SlotEditTarget}, and what
   * is this file's is what the editor does with one.
   */
  it('opens on the piece it is given, on the slot still needing a choice', () => {
    editor({ a: piece({ top: FILL.topWall }) }, { placement: KEY })

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAccessibleName('Fixture: Secret Door')
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
    editor({ a: piece({ top: FILL.topWall }) }, { placement: KEY, slot: TOP })

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('group', { name: 'Fill the top slot' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('group', { name: 'Fill the base slot' })).toBeNull()
  })

  it('falls back to the first gap when the named slot is not one this recipe has', () => {
    // The two slot names come from different walks — a drawn part's `slot` and
    // `template.parts` — and they agree today because a fill is keyed by the
    // recipe's own part name. If they ever stop agreeing the editor must open on
    // its own rule rather than on nothing.
    editor(
      { a: piece({ top: FILL.topWall }) },
      { placement: KEY, slot: SlotName.parse('no such slot') },
    )

    expect(
      within(screen.getByRole('dialog')).getByRole('group', { name: 'Fill the base slot' }),
    ).toBeInTheDocument()
  })

  it('closes on Escape, so it is dismissible without a pointer', () => {
    editor({ a: piece({ top: FILL.topWall }) }, { placement: KEY })
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('offers the design filter, counted in items, and applies it', () => {
    // §1.6: the filter is the texture family, and the count is what it leaves.
    // `top` offers one dungeon_stone item and one towne item.
    editor({ a: piece({}) }, { placement: KEY })

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
    editor({ a: piece({}) }, { placement: KEY })

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
    editor(useWorkshopStore.getState().placements, { placement: KEY })

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
    editor(useWorkshopStore.getState().placements, { placement: KEY })
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
    editor(
      {
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
        filters: [],
      },
      },
      { placement: KEY },
    )

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
    editor(
      {
        a: {
          id: KEY,
          template: TemplateId.parse(MITRE_TEMPLATE.id),
        x: 0,
        z: 0,
        rotation: 0,
        fills: { [SlotName.parse('floor')]: { tile: PARENT.pairedGrate as TileId, pinned: true } },
        filters: [],
      },
      },
      { placement: KEY },
    )

    expect(screen.getByText(/This slot takes 2 wide by 2 deep\./)).toBeInTheDocument()
  })

  it('leads with the slots that still need a choice', () => {
    editor({ a: piece({}) }, { placement: KEY })
    expect(screen.getByText(/2 of these slots need a choice: top, base/)).toBeInTheDocument()
  })

  /* --------------------------------------------------- row A11's two actions */

  it('empties a slot on the user’s say-so, and the piece stays on the plan', () => {
    // Contract C-g from the editor's end: `clearFill` removes the fill and not
    // the instance, so the slot reads *needs a choice* and the download refuses
    // until it is filled. `panels.test.tsx` carries the refusal itself, because
    // that needs a bill.
    useWorkshopStore.setState({ placements: { [KEY]: piece({ top: FILL.topWall }) } })
    editor(useWorkshopStore.getState().placements, { placement: KEY })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^top —/ }))

    fireEvent.click(screen.getByRole('button', { name: /^Empty the top slot/ }))

    const fills = useWorkshopStore.getState().placements[KEY]?.fills ?? {}
    expect(fills[TOP]).toBeUndefined()
    // The key is gone rather than set to `undefined` — see `clearFill`.
    expect(TOP in fills).toBe(false)
    expect(useWorkshopStore.getState().placements[KEY]?.template).toBeDefined()
  })

  it('offers nothing to empty on a slot that is already empty', () => {
    editor({ a: piece({}) }, { placement: KEY })
    expect(screen.queryByRole('button', { name: /^Empty the/ })).toBeNull()
  })

  it('offers no hand-back on a slot the solver filled, only on one the user chose', () => {
    // The preference already owns an `auto` fill, so the control would claim to
    // do something it cannot — and `unpinFill` would answer `'unchanged'`.
    useWorkshopStore.setState({ placements: { [KEY]: piece({ top: FILL.topWall }) } })
    editor(useWorkshopStore.getState().placements, { placement: KEY })
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
    editor(useWorkshopStore.getState().placements, { placement: KEY })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^top —/ }))

    fireEvent.click(screen.getByRole('button', { name: /^Hand the top slot back/ }))

    expect(useWorkshopStore.getState().placements[KEY]?.fills[TOP]).toEqual({
      tile: FILL.topWall,
      pinned: false,
    })
  })
})
