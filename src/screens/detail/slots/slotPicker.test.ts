/**
 * The picker's resolution, headless.
 *
 * The whole subject of these tests is the thing C1 could not precompute: what a
 * slot's candidates are *after* a sibling has been filled. So almost every case
 * below is a pair — the same slot before and after a pick — because a single
 * snapshot of a candidate set is exactly the artefact C1 declined to ship.
 *
 * `fixture.ts` carries which corpus branch each record stands for.
 */
import { describe, expect, it, vi } from 'vitest'

import type * as CatalogModule from '@/catalog'
import type { CatalogFile, TileId } from '@/catalog'

/**
 * How many times the aggregate index has actually been built.
 *
 * The module is wrapped rather than replaced — every export is the real one and
 * `buildAggregateIndex` delegates — because the fact under test is a *cost*, and
 * a cost is invisible to a test that only checks the answer.
 * {@link compositionIndexFor} used to take `aggregates = buildAggregateIndex(file)`
 * as a **default argument**, which JavaScript evaluates before the function body
 * and therefore before the `WeakMap` was consulted: every hit rebuilt 8,702
 * records (38–48 ms) and discarded the result. Identity alone could not see it.
 */
const builds = { count: 0 }

vi.mock('@/catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof CatalogModule>()
  return {
    ...actual,
    buildAggregateIndex: (file: CatalogFile) => {
      builds.count += 1
      return actual.buildAggregateIndex(file)
    },
  }
})

import { CatalogFile as CatalogFileSchemaForTest } from '@/catalog'

import { FILL, PARENT, SLOT_CATALOG } from './fixture'
import {
  BASE_SLOT,
  compositionIndexFor,
  deadEndReason,
  emptySlotReason,
  pickerSlots,
  slotChoiceKey,
  slotStates,
} from './slotPicker'

const index = compositionIndexFor(SLOT_CATALOG)

const tile = (id: string): TileId => id as unknown as TileId

const states = (parent: string, selection: Record<string, string> = {}) =>
  slotStates(
    index,
    tile(parent),
    Object.fromEntries(Object.entries(selection).map(([name, id]) => [name, tile(id)])),
  )

const slot = (parent: string, name: string, selection: Record<string, string> = {}) => {
  const found = states(parent, selection).find((state) => state.name === name)
  if (found === undefined) throw new Error(`no slot named ${name} on ${parent}`)
  return found
}

/* --------------------------------------------------------------- the surface */

describe('the accessory surface', () => {
  it('never offers the base slot as a choice', () => {
    expect(pickerSlots(index, tile(PARENT.wallTowne)).map((part) => part.name)).toEqual(['torch'])
    expect(index.slotsOf(tile(PARENT.wallTowne)).map((part) => part.name)).toEqual([
      BASE_SLOT,
      'torch',
    ])
  })

  it('has nothing to render for a file whose only slot is the base match', () => {
    // 2,031 of 8,702 files. The component renders `null` on this.
    expect(states(PARENT.baseOnly)).toEqual([])
  })

  it('has nothing to render for a file with no config at all', () => {
    // 5,666 of 8,702 files.
    expect(states(PARENT.plainFloor)).toEqual([])
  })

  it('grids items and not files, so two files of one print are one card', () => {
    const torch = slot(PARENT.wallTowne, 'torch')

    // Three candidate files — two names for one dungeon_stone print and one
    // towne — over two items. C1's rule: the grid is an item grid and the file is
    // chosen after. The two stone files share a `blob`, so F5 has nothing to
    // expand: one print filed twice is one card however it is named.
    expect(torch.candidates).toBe(3)
    expect(torch.options).toHaveLength(2)
    expect(torch.options.flatMap((option) => option.tiles)).toHaveLength(3)
    expect(torch.options.every((option) => option.label === undefined)).toBe(true)
  })

  it('contributes a file that is itself a candidate for the slot', () => {
    const [stoneTorch] = slot(PARENT.wallTowne, 'torch').options
    expect(stoneTorch?.tiles).toContain(stoneTorch?.variant.id)
  })
})

/* ------------------------------------------------- one card per sculpt — F5 */

/**
 * **The owner's finding: only one lintel was offered.**
 *
 * `door_lintel.1/2/3.stl` are three wood-grain sculpts of one catalog design, so
 * an item grid showed one card — and the other two prints were not hidden behind
 * a control, they were not on screen at all. An item whose candidate files make
 * the **same connection claim** is therefore expanded to one card per print, and
 * an item whose files differ by joinery still collapses, because there the choice
 * is the lock preference's rather than the user's.
 *
 * `sculptWall` carries all three shapes: three sculpts, one lintel in two
 * joineries, and two prints that share a filename. The corpus has **no** item of
 * the second kind under an accessory slot, which is why the fixture must.
 */
describe('one card per print where only the mesh tells them apart', () => {
  const lintel = () => slot(PARENT.sculptWall, 'lintel')
  const named = (name: string) =>
    lintel().options.filter((option) => option.aggregate.name === name)

  it('offers a card per sculpt, each naming its own file', () => {
    const sculpts = named('Wood Door Lintel')

    expect(sculpts.map((option) => option.variant.id)).toEqual([
      FILL.lintelWoodOne,
      FILL.lintelWoodTwo,
      FILL.lintelWoodThree,
    ])
    // Each card stands for its own file, so a pick names the sculpt that was
    // pressed rather than the item's preferred print.
    expect(sculpts.map((option) => option.tiles)).toEqual([
      [FILL.lintelWoodOne],
      [FILL.lintelWoodTwo],
      [FILL.lintelWoodThree],
    ])
  })

  it('labels each card with the part of the filename that differs', () => {
    expect(named('Wood Door Lintel').map((option) => option.label)).toEqual(['1', '2', '3'])
  })

  it('labels from the path when two prints share a filename', () => {
    // Both files are `lintel.stl`, so the filename cannot tell them apart and the
    // cut is retried over the family. 569 of the corpus's expanded slots are this
    // case — `shutters.stl` under two families, `door.metal.stl` under two.
    const plain = named('Plain Door Lintel')
    expect(plain.map((option) => option.variant.file)).toEqual(['lintel.stl', 'lintel.stl'])
    expect(plain.map((option) => option.label)).toEqual(['cut_stone', 'towne'])
  })

  it('keeps an item whose files differ by joinery to one card', () => {
    /* The reason the grid collapses files at all: `selectVariant` answers which
       of these to print from the lock preference, so a card per file would ask
       the user a question the app has already answered. */
    const locked = named('Dungeon Stone Door Lintel')
    expect(locked).toHaveLength(1)
    expect(locked[0]?.label).toBeUndefined()
    expect(locked[0]?.tiles).toEqual([FILL.lintelStone, FILL.lintelStoneLocked])
  })

  it('labels the same way twice, and never two cards alike', () => {
    const once = lintel().options.map((option) => option.label)
    expect(lintel().options.map((option) => option.label)).toEqual(once)

    const labels = once.flatMap((label) => label ?? [])
    expect(new Set(labels).size).toBe(labels.length)
  })
})

/* ------------------------------------------------------------ dead-end greying */

describe('dead-end greying', () => {
  it('greys the pick that would empty a sibling accessory slot, and names the slot', () => {
    const torch = slot(PARENT.wallSiblings, 'torch')
    const towne = torch.options.find((option) => option.aggregate.name === 'Towne Torch')
    const stone = torch.options.find((option) => option.aggregate.name === 'Dungeon Stone Torch')

    // `constrain: [{ tag: 'texture' }]` on the `top` slot collects the wall's
    // `texture|dungeon_stone` and the torch's `texture|towne`, keeps both
    // because neither is a prefix of the other, and no top carries both.
    expect(towne?.deadEnd).toBe(true)
    expect(towne?.empties).toEqual(['top'])

    // The same-texture torch changes nothing, so it is not greyed.
    expect(stone?.deadEnd).toBe(false)
    expect(stone?.empties).toEqual([])
  })

  it('does not grey a pick that only empties the base — the room chooses that', () => {
    /* `wallTowne` is the corpus's own case and all 416 of its item picks: the
       towne torch pushes `texture|towne` into the wall's `base` part and empties
       it. The base is not a sibling of an accessory — it is the template's slot,
       matched on footprint — so nothing here is a dead end. This is F2: reading
       it as one greyed every door on the Cut Stone door wall. */
    const torch = slot(PARENT.wallTowne, 'torch')
    expect(torch.options.map((option) => option.empties)).toEqual([[], []])
    expect(torch.options.some((option) => option.deadEnd)).toBe(false)

    // And the emptying itself is real, which is what makes the exclusion a
    // decision rather than a measurement error: asked directly, the base slot
    // does go empty under that pick.
    const base = index.slotsOf(tile(PARENT.wallTowne))[0]!
    expect(base.name).toBe(BASE_SLOT)
    expect(
      index.resolve(base, tile(PARENT.wallTowne), [
        { partName: 'torch', tags: index.tagsOf(tile(FILL.torchTowne)) },
      ]).deadEnd,
    ).toBe(true)
  })

  it('is computed before the pick, and the pick confirms it', () => {
    // The greying is a prediction. This is the assertion that it is a correct
    // one — the same slot, actually resolved with the towne torch in place.
    expect(slot(PARENT.wallSiblings, 'torch').options.some((option) => option.deadEnd)).toBe(true)

    const top = index.slotsOf(tile(PARENT.wallSiblings))[1]!
    expect(top.name).toBe('top')
    const after = index.resolve(top, tile(PARENT.wallSiblings), [
      { partName: 'torch', tags: index.tagsOf(tile(FILL.torchTowne)) },
    ])
    expect(after.deadEnd).toBe(true)

    const harmless = index.resolve(top, tile(PARENT.wallSiblings), [
      { partName: 'torch', tags: index.tagsOf(tile(FILL.torchStone)) },
    ])
    expect(harmless.deadEnd).toBe(false)
  })

  it('says what a dead end costs rather than only dimming it', () => {
    const towne = slot(PARENT.wallSiblings, 'torch').options.find((option) => option.deadEnd)
    expect(deadEndReason(towne!)).toBe('Leaves the top slot with nothing to fill it.')
  })

  it('stops greying a slot the user has already filled', () => {
    // With the `top` slot settled there is nothing left to close, so the towne
    // torch is no longer a dead end — the property that keeps `empties` about
    // *open* questions.
    const torch = slot(PARENT.wallSiblings, 'torch', { top: FILL.topWall })
    expect(torch.options.every((option) => option.empties.length === 0)).toBe(true)
  })
})

/* --------------------------------------------------------------- the rescue */

describe('a sibling pick can open a slot as well as close one', () => {
  it('reports the slot a pick would open', () => {
    // `filterSpecificTags` keeps the most general survivor, so the parent's
    // `shape|wall|low` is dropped in favour of the top's `shape|wall`. The
    // rescued slot is an accessory and not the base, for `empties`' reason: the
    // corpus's own three rescues are all the base, and the base is not a sibling.
    const top = slot(PARENT.wallRescue, 'top')
    // Both tops carry `shape|wall`, and the `crosshead` sibling constrains on
    // `shape` alone, so both of them open it.
    expect(top.options).toHaveLength(2)
    expect(top.options.map((option) => option.rescues)).toEqual([['crosshead'], ['crosshead']])
    expect(top.options.some((option) => option.deadEnd)).toBe(false)
  })

  it('and the base slot really is empty until it is made', () => {
    const base = index.slotsOf(tile(PARENT.wallLow))[0]
    expect(base?.name).toBe(BASE_SLOT)
    expect(index.resolve(base!, tile(PARENT.wallLow)).deadEnd).toBe(true)
    expect(
      index.resolve(base!, tile(PARENT.wallLow), [
        { partName: 'top', tags: index.tagsOf(tile(FILL.topWall)) },
      ]).deadEnd,
    ).toBe(false)
  })
})

/* --------------------------------------------------- nothing matches, two ways */

describe('an empty slot', () => {
  it('tells a dangling ref apart from a set that narrowed to nothing', () => {
    const statue = slot(PARENT.danglingRef, 'statue')
    expect(statue.deadEnd).toBe(true)
    expect(statue.unknownRefs).toEqual(['component|statue'])
    expect(emptySlotReason(statue)).toContain('component|statue')

    const broken = slot(PARENT.contradiction, 'broken_section')
    expect(broken.deadEnd).toBe(true)
    expect(broken.unknownRefs).toEqual([])
    expect(emptySlotReason(broken)).toContain('Nothing in the archive fits this slot')
  })

  it('words a required empty slot as a failure and an optional one as a choice', () => {
    expect(emptySlotReason(slot(PARENT.contradiction, 'broken_section'))).toContain(
      'cannot be completed',
    )
    expect(
      emptySlotReason({ ...slot(PARENT.contradiction, 'broken_section'), optional: true }),
    ).toContain('leave it empty')
  })
})

/* ------------------------------------------------------------------- pairing */

describe('slots the fixture pairs', () => {
  it('names the other half rather than inventing a rule for it', () => {
    const [left, right] = states(PARENT.pairedGrate)
    expect(left?.name).toBe('grate (left)')
    expect(left?.pairedWith).toEqual(['grate (right)'])
    expect(right?.pairedWith).toEqual(['grate (left)'])
  })

  it('leaves an unpaired slot with no pairing to report', () => {
    expect(slot(PARENT.wallTowne, 'torch').pairedWith).toEqual([])
  })
})

/* ----------------------------------------------------------------- the key */

describe('the slot choice key', () => {
  it('is the parent file and the slot name, joined by a control character', () => {
    const key = slotChoiceKey(tile(PARENT.wallTowne), 'torch')
    expect(key).toBe(`${PARENT.wallTowne}\u0000torch`)
    // The delimiter has to be one that cannot occur in either half: 5 live tile
    // ids contain a space and 5 of the 29 slot names do.
    expect(key.split('\u0000')).toEqual([PARENT.wallTowne, 'torch'])
  })

  it('is what the resolved state carries, not an array position', () => {
    expect(slot(PARENT.wallTowne, 'torch').key).toBe(
      slotChoiceKey(tile(PARENT.wallTowne), 'torch'),
    )
  })

  it('separates the same slot name on two different parents', () => {
    expect(slotChoiceKey(tile(PARENT.wallTowne), 'base')).not.toBe(
      slotChoiceKey(tile(PARENT.baseOnly), 'base'),
    )
  })
})

/* ----------------------------------------------------------------- the index */

describe('the composition index', () => {
  it('is built once per parsed file and shared', () => {
    // Three mounts over one catalog pay 10.7 ms once, not three times.
    expect(compositionIndexFor(SLOT_CATALOG)).toBe(compositionIndexFor(SLOT_CATALOG))
  })

  it('builds no aggregate index on a hit, and exactly one on a miss', () => {
    // The module-scope `index` above has already paid for this file, so a hit is
    // all that is left to make.
    const before = builds.count
    compositionIndexFor(SLOT_CATALOG)
    compositionIndexFor(SLOT_CATALOG)
    expect(builds.count).toBe(before)

    /* A second parsed object over the same bytes: a different file to the
       `WeakMap`, which is the miss the fallback exists for. One build, not two —
       the caller that already holds an aggregate index still passes it. */
    const other = CatalogFileSchemaForTest.parse(structuredClone(SLOT_CATALOG))
    compositionIndexFor(other)
    expect(builds.count).toBe(before + 1)
  })
})
