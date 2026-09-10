// @vitest-environment jsdom
/**
 * A placed piece's slots — row C3's editor, and the accessories the files in it
 * hold.
 *
 * Two groups of assertions, and each is about something no other surface in the
 * app can say:
 *
 *   - **the editor** — the design filter, the greyed dead end, the write that is
 *     `pinned`, and the refusal. The refusal is the row's headline and is the
 *     one thing the guided-assembly walk cannot report on its own: a card that
 *     would empty a still-**open** sibling is greyed before it is pressed, and a
 *     card that would invalidate a sibling's **existing fill** is pressed,
 *     refused, and told why.
 *   - **the accessories under a filled slot** — the composition picker, mounted
 *     under the recipe slot whose file opens it, writing `pinHold` /
 *     `clearHold`. What a hold **costs** (one copy per measured mount), what
 *     nothing has **measured**, what the host was **printed holding**, and which
 *     required slot is still a hole in the print.
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
 * ## The accessory assertions moved here with the control — F7
 *
 * They were a section in the bill column (`AccessorySection`, and a `planSlots`
 * inventory over the whole drawing behind it), which is where an accessory was
 * chosen until the owner ruled otherwise: *"move the accessory choosing out of
 * the sidebar and into the tile/slots editing popup."* So the plan-wide
 * inventory is gone — nothing asks *which pieces on this drawing open a slot*
 * any more — and what is left is `slotAccessories.ts#fillAccessories` over one
 * fill, asserted through the dialog that renders it. {@link HOST_TEMPLATE} is
 * the one-slot recipe those assertions place, because the file whose accessory
 * slots they are about has to be *in a slot of a recipe* to be reachable at all.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildAssemblyIndex } from '@/assembly'
import type { TileId } from '@/catalog'
import { CatalogFile as CatalogFileSchema } from '@/catalog'
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

/**
 * A one-slot recipe whose slot takes a **host wall**, so the file in it is one
 * that opens accessory slots of its own.
 *
 * The accessory assertions need a recipe for the same reason the editor does: an
 * accessory is a slot of a file, and a file is only on the plan by being in a
 * slot of a placed recipe. `shape|wall` admits every parent in row C2's fixture
 * — the archway with its four measured torch sockets, the two-accessory-slot
 * walls, and the contradiction — so one recipe reaches all of them and the fill
 * is on-slot, which keeps `fill-off-slot`'s copy out of these assertions.
 */
const HOST_TEMPLATE: RecipeTemplate = {
  id: 'fixture-host-wall',
  name: 'Fixture: Host Wall',
  source: 'fixture',
  tags: ['object|tile'],
  parts: [{ name: 'wall', tags: { require: [{ tag: 'shape|wall' }] }, fulfills: [] }],
}

const TEMPLATES = (id: string): RecipeTemplate | undefined =>
  [EDITOR_TEMPLATE, MITRE_TEMPLATE, FILTERED_TEMPLATE, HOST_TEMPLATE].find((one) => one.id === id)

/**
 * The same fixture with the archway's `lintel` **built into its mesh** —
 * `CatalogRecord.modelledIn`, the measurement's verdict for the three
 * `floor,brazier+small.2x2` floors whose brazier is sculpted on.
 */
const BUILT_IN_CATALOG = CatalogFileSchema.parse({
  ...SLOT_CATALOG,
  records: SLOT_CATALOG.records.map((record) =>
    record.id === PARENT.archway ? { ...record, modelledIn: ['lintel'] } : record,
  ),
})

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
function editor(
  placements: Record<string, TemplateInstance>,
  target: SlotEditTarget,
  /* The index the dialog reads. Only the built-in case passes another, and it
     keeps `ASSEMBLY`: `modelledIn` is the one field between the two catalogs and
     nothing in the assembly walk reads it. */
  catalog = SLOT_CATALOG,
) {
  function Host() {
    const [editing, setEditing] = useState<SlotEditTarget | null>(target)
    const instance = editing === null ? undefined : placements[editing.placement]
    const template = instance === undefined ? undefined : TEMPLATES(instance.template)
    if (instance === undefined || template === undefined) return null
    return (
      <SlotEditor
        catalog={catalog}
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

/** The one placement key these tests read back, branded once. */
const KEY = PlacementId.parse('a')

/** The `top` slot, branded once — a `Record<SlotName, …>` will not take a literal. */
const TOP = SlotName.parse('top')

/** {@link HOST_TEMPLATE}'s one slot, which is where a host file sits. */
const WALL = SlotName.parse('wall')

/** The stone base, which is what the towne top would strand. */
const BASE_STONE = 'tiles/dungeon_stone/bases/base/stone%base.2x.stl'

/** A file this index does not hold — a fill whose accessories are unknowable. */
const RETIRED_TILE = 'tiles/gone/forever.stl' as TileId

/**
 * One placed {@link HOST_TEMPLATE} whose `wall` slot holds `parent`, **holding**
 * the accessories given.
 *
 * Keyed under {@link KEY} because the presses below write to the store and
 * `pinHold` addresses a placement by its map key. `pinned: true` on the holds
 * throughout: those fixtures stand for a choice already made.
 */
function hosting(
  parent: string,
  holds?: Readonly<Record<string, string>>,
): Record<string, TemplateInstance> {
  return {
    [KEY]: {
      id: KEY,
      template: TemplateId.parse(HOST_TEMPLATE.id),
      x: 0,
      z: 0,
      rotation: 0,
      fills: {
        [WALL]: {
          tile: parent as TileId,
          pinned: false,
          ...(holds === undefined
            ? {}
            : {
                holds: Object.fromEntries(
                  Object.entries(holds).map(([hold, tile]) => [
                    HoldName.parse(hold),
                    { tile: tile as TileId, pinned: true },
                  ]),
                ),
              }),
        },
      },
      filters: [],
    },
  }
}

beforeEach(() => {
  resetWorkshop()
})

afterEach(() => {
  clearPersistedWorkshopState()
  resetWorkshop()
})

/**
 * An instance of {@link EDITOR_TEMPLATE} with named fills.
 *
 * `pinned: false` throughout, so the editor's own write is the only thing in
 * this file that can produce a `true` — which is what makes the `pinned`
 * assertion below about contract **C-k** rather than about the fixture.
 */
function piece(fills: Readonly<Record<string, string>>, x = 0, z = 0): TemplateInstance {
  return {
    /* {@link KEY}, and it has to match the map key the editor is given: `pinFill`
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

/* ----------------------------------------- what the file in a slot holds */

/**
 * **The accessory picker, in the editor and writing — F7.**
 *
 * The owner's ruling: *"move the accessory choosing out of the sidebar and into
 * the tile/slots editing popup."* So these assertions are about the dialog now,
 * and they are the same facts the deleted sidebar section had to carry — what the
 * piece holds is what the grid shows, a press pins it onto that fill, a second
 * press takes it out, and each slot says what it costs.
 *
 * The archway rather than the torch wall, because it is the fixture's one
 * measured host and the mount lines are read off it — four torch sockets and an
 * unmeasured `lintel`. Its `{ filter }` entry also means the towne torch merely
 * narrows the lintel, where on `wallSiblings` the same card empties the `top`
 * slot and is declined.
 */
describe('the accessories under a filled slot', () => {
  /**
   * The editor over the **store's** scene, because the presses below write there
   * and `pinHold` addresses a placement by its key.
   */
  function open(placements: Record<string, TemplateInstance>, catalog = SLOT_CATALOG) {
    useWorkshopStore.setState({ placements })
    editor(useWorkshopStore.getState().placements, { placement: KEY }, catalog)
    return screen.getByRole('dialog')
  }

  /** The holds of the one fill, as the store has them after a press. */
  const held = () => useWorkshopStore.getState().placements[KEY]?.fills[WALL]?.holds

  /**
   * One accessory card, **inside the accessory block**.
   *
   * Scoped and not `screen.getByRole`, because the dialog holds two grids and
   * their names overlap: the recipe slot's own candidates include *Dungeon Stone
   * Torch Wall 2x*, which is a wall that takes a torch, beside the accessory
   * grid's *Dungeon Stone Torch*, which is the torch. A press on the wrong one
   * would write a fill rather than a hold.
   */
  const holdsBlock = () =>
    screen.getByRole('dialog').querySelector<HTMLElement>('.of-sloted-holds')!
  const holdCard = (name: RegExp) => within(holdsBlock()).getByRole('button', { name })

  it('renders no accessory block for a file that opens no slot', () => {
    // 88.5% of the archive: `fillAccessories` answers `undefined` and the row is
    // the recipe slot alone. `baseOnly` declares a `base` part and nothing else,
    // which is A6's base match rather than an accessory.
    const dialog = open(hosting(PARENT.baseOnly))
    expect(dialog.querySelector('.of-sloted-holds')).toBeNull()
  })

  it('renders none for a fill this build has retired, whose slots are unknowable', () => {
    const dialog = open(hosting(RETIRED_TILE))
    expect(dialog.querySelector('.of-sloted-holds')).toBeNull()
  })

  it('mounts the picker under the recipe slot whose file opens it', () => {
    const dialog = open(hosting(PARENT.archway))
    const holds = dialog.querySelector<HTMLElement>('.of-sloted-holds')
    expect(holds).not.toBeNull()
    // The row and its accessories are one list item, so the grid is under the
    // file it belongs to rather than under the dialog.
    expect(holds!.closest('li')?.querySelector('.of-sloted-slotname')?.textContent).toBe('wall')
    expect(within(holds!).getByRole('group', { name: 'Fill the torch slot' })).toBeInTheDocument()
    expect(within(holds!).getByRole('group', { name: 'Fill the lintel slot' })).toBeInTheDocument()
  })

  it('shows what the piece already holds as the chosen card', () => {
    open(hosting(PARENT.archway, { torch: FILL.torchStone }))
    expect(holdCard(/Dungeon Stone Torch/)).toHaveAttribute('aria-pressed', 'true')
  })

  it('pins a pick onto the hold it names', () => {
    open(hosting(PARENT.archway, {}))
    fireEvent.click(holdCard(/Towne Torch/))
    // `pinned: true` — the user chose it, so contract C-k's default-hold pass
    // must not overwrite it on the next hydrate.
    expect(held()).toEqual({ torch: { tile: FILL.torchTowne, pinned: true } })
  })

  it('takes the accessory out again on a second press of the card it holds', () => {
    open(hosting(PARENT.archway, { torch: FILL.torchStone }))
    fireEvent.click(holdCard(/Dungeon Stone Torch/))
    // `{}` and not `undefined`: *the user took it out* has to survive a reload as
    // something other than *nobody has looked yet*. See `clearHold`.
    expect(held()).toEqual({})
  })

  it('says how many mounts a slot fills, so the bill’s quantity is no surprise', () => {
    // One copy per measured mount, and four torches for one press is a number a
    // user cannot account for unless the picker says so first.
    open(hosting(PARENT.archway, {}))
    expect(screen.getByText(/torch × 4 mounts/)).toBeInTheDocument()
  })

  it('says when nothing has measured where an accessory goes', () => {
    // `CatalogRecord.mounts` is absent both for a host with no accessory slot and
    // for one nobody has measured, so *counted once, not drawn* is the honest
    // reading of the archive today rather than an error state.
    open(hosting(PARENT.archway, {}))
    expect(
      screen.getByText(/lintel: no measured mount — counted once, not drawn/),
    ).toBeInTheDocument()
  })

  it('says a slot the host was printed holding is built in, and offers no grid for it', () => {
    /* **F6.** Not *no measured mount* — there is nothing to measure and nothing
       missing. And no grid either: offering one would offer a second brazier for
       a floor that was printed carrying one, which is what `SlotFills`' `omit`
       exists for. The slot is still resolved, so the torch beside it is narrowed
       by what the mesh already holds. */
    const dialog = open(hosting(PARENT.archway, {}), BUILT_IN_CATALOG)
    expect(screen.getByText(/lintel: built into this piece/)).toBeInTheDocument()
    expect(screen.queryByText(/lintel: no measured mount/)).toBeNull()
    expect(within(dialog).queryByRole('group', { name: 'Fill the lintel slot' })).toBeNull()
    expect(within(dialog).getByRole('group', { name: 'Fill the torch slot' })).toBeInTheDocument()
  })

  it('gives a required accessory slot the weight of an empty recipe slot', () => {
    /* The same hole one level down: `wallLow`'s `top` slot is required —
       `optional` is absent, and absence means required — so the piece will print
       incomplete until it is filled, and the download refuses either way. Both of
       the archway's slots are optional, which is why this one is the low wall. */
    const dialog = open(hosting(PARENT.wallLow))
    expect(within(dialog).getByText(/top needs a choice/)).toBeInTheDocument()
    expect(dialog.querySelector('.of-sloted-holdgap')).not.toBeNull()
  })

  it('says nothing about a required slot the piece already holds', () => {
    const dialog = open(hosting(PARENT.wallLow, { top: FILL.topWall }))
    expect(dialog.querySelector('.of-sloted-holdgap')).toBeNull()
  })

  it('counts a required hold naming a retired file as a hole, not as filled', () => {
    /*
      The two surfaces have to agree. `resolveInstance` refuses the download for a
      required hold whose record is missing — an empty socket *and* an accessory
      the archive has dropped — and `billView.ts#holeFaults` faults both, so a
      dialog that read the second as filled would say nothing over a scene the
      bill panel is refusing. The grid agrees: a retired id matches no card, so
      the slot renders with nothing chosen.
    */
    const dialog = open(hosting(PARENT.wallLow, { top: RETIRED_TILE }))
    expect(within(dialog).getByText(/top needs a choice/)).toBeInTheDocument()
    expect(holdCard(/Dungeon Stone Secret Door Top/)).toHaveAttribute('aria-pressed', 'false')
  })

  it('greys the dead-end accessory pick here too, because the picker is the same one', () => {
    // `wallSiblings`: the pick that closes another *accessory* slot. A pick that
    // only empties the host's base part is not a dead end — F2 — and
    // `wallTowne`'s towne torch is exactly that one.
    open(hosting(PARENT.wallSiblings))
    expect(holdCard(/Towne Torch/)).toHaveAttribute('aria-disabled', 'true')
  })

  it('calls a slot nothing in the archive fits a gap rather than a step to take', () => {
    // 9 of the corpus's 1,244 declarations are unsatisfiable, and the picker's own
    // sentence is the one the editor shows: there is nothing here for the user to
    // press.
    open(hosting(PARENT.contradiction))
    expect(
      screen.getByText(/Nothing in the archive fits this slot, so this piece cannot be completed/),
    ).toBeInTheDocument()
  })

  it('scopes each block to its own slot’s file', () => {
    /* Two fills, each opening its own accessory slots, so a two-file piece gets
       two blocks and a press in one cannot land on the other. `MITRE_TEMPLATE`
       rather than {@link HOST_TEMPLATE}, because that is the fixture with more
       than one slot. */
    useWorkshopStore.setState({
      placements: {
        [KEY]: {
          id: KEY,
          template: TemplateId.parse(MITRE_TEMPLATE.id),
          x: 0,
          z: 0,
          rotation: 0,
          fills: {
            [SlotName.parse('floor')]: { tile: PARENT.pairedGrate as TileId, pinned: false },
            [SlotName.parse('wall')]: { tile: PARENT.archway as TileId, pinned: false },
          },
          filters: [],
        },
      },
    })
    editor(useWorkshopStore.getState().placements, { placement: KEY })

    const blocks = [...document.querySelectorAll<HTMLElement>('.of-sloted-holds')]
    expect(blocks).toHaveLength(2)
    expect(
      within(blocks[0]!).getByRole('group', { name: 'Fill the grate (left) slot' }),
    ).toBeInTheDocument()
    expect(within(blocks[1]!).getByRole('group', { name: 'Fill the torch slot' })).toBeInTheDocument()
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
