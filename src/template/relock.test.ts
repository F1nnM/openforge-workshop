// @vitest-environment jsdom
//
// jsdom, because half of this file is about the **store**: the four-state
// `FillOutcome` is the store's answer and not the driver's, and the scene-scale
// cost includes `persist` writing the whole scene to `localStorage` on every
// fill. Declared per file, the way `src/store/workshopStore.test.ts` declares
// it — a node-environment suite would exercise `persist`'s degraded in-memory
// mode and measure the wrong thing.
/**
 * The lock re-solve, against the real store.
 *
 * The three things worth reading first: `keeps a pinned fill and rewrites the
 * auto one beside it` — contract **C-k**, and the whole reason the toggle
 * works; `warns that a pinned fill cannot print under the new lock` — the
 * plan's §11 gap 2, which nothing owned; and `re-solves a 250-instance room`,
 * which is §11 gap 3 measured, and where the surprise is that the solver is not
 * the expensive half.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildAggregateIndex } from '@/catalog'
import type { TileId } from '@/catalog'
import type { AssemblyContext, AssemblyIndex, AssemblyTemplate } from '@/assembly'
import { buildAssemblyIndex } from '@/assembly'
import { createCompositionIndex } from '@/composition'
import type { FillOutcome, PlacementId, SlotName, TemplateId, TemplateInstance } from '@/store'
import {
  SlotName as SlotNameSchema,
  TemplateId as TemplateIdSchema,
  clearPlacements,
  fillSlot,
  filledSlots,
  placeTemplate,
  resetWorkshop,
  useWorkshopStore,
} from '@/store'

import type { FillContext } from './fill'
import type { FillWriter, SceneFillContext } from './relock'
import { reSolveScene } from './relock'
import type { FillFixtureRecord } from './fixture'
import { fillFixture } from './fixture'

/* ------------------------------------------------------------------ the fixture */

const WALL = SlotNameSchema.parse('wall')
const FLOOR = SlotNameSchema.parse('floor')
const BASE = SlotNameSchema.parse('base')

const OPENLOCK_WALL = 'tiles/wall.openlock' as unknown as TileId
const DRAGONLOCK_WALL = 'tiles/wall.dragonlock' as unknown as TileId
const AGNOSTIC_WALL = 'tiles/wall.agnostic' as unknown as TileId

/**
 * One design in three prints plus a floor and two bases.
 *
 * `tiles/wall.openlock` and `tiles/wall.dragonlock` are two files of **one**
 * design, which is what makes a pin repairable: the warning can name the sibling
 * variant. `tiles/wall.agnostic` is a design carrying no lock system at all —
 * `connection|openforge` delegates joinery to a separately printed base — and it
 * is the case a naive `conn.includes(lock)` test would report as broken.
 */
const RECORDS: readonly FillFixtureRecord[] = [
  {
    id: 'tiles/wall.openlock',
    design: 'wall-multi',
    tags: ['shape|wall', 'connection|openlock'],
    conn: ['openlock'],
  },
  {
    id: 'tiles/wall.dragonlock',
    design: 'wall-multi',
    tags: ['shape|wall', 'connection|dragonlock'],
    conn: ['dragonlock'],
  },
  {
    id: 'tiles/wall.agnostic',
    design: 'wall-agnostic',
    tags: ['shape|wall', 'connection|openforge'],
    conn: ['openforge'],
  },
  { id: 'tiles/floor-1x1', design: 'floor-1x1', tags: ['shape|floor', 'size|width|1', 'size|depth|1'] },
  { id: 'tiles/floor-2x2', design: 'floor-2x2', tags: ['shape|floor', 'size|width|2', 'size|depth|2'] },
  {
    id: 'tiles/base',
    design: 'base',
    layer: 'base',
    conn: ['openlock'],
    tags: ['shape|base', 'connection|openlock', 'size|width|1', 'size|depth|1'],
  },
  { id: 'tiles/decoy', design: 'decoy', tags: ['shape|angled|right', 'shape|option|curved_interface'] },
]

const A_TEMPLATE = TemplateIdSchema.parse('fixture-wall')

function templateOf(id: string): AssemblyTemplate {
  return {
    id,
    tags: ['object|tile'],
    parts: [
      { name: 'wall', tags: { require: [{ tag: 'shape|wall' }] } },
      { name: 'floor', tags: { require: [{ tag: 'shape|floor' }] } },
      { name: 'base', tags: { require: [{ tag: 'shape|base' }] } },
    ],
  }
}

interface Harness {
  readonly index: AssemblyIndex
  readonly context: SceneFillContext
}

function harness(over: Partial<FillContext> = {}, templates: readonly AssemblyTemplate[] = [templateOf(A_TEMPLATE)]): Harness {
  const file = fillFixture(RECORDS)
  const composition = createCompositionIndex(file, buildAggregateIndex(file))
  const byId = new Map(templates.map((template) => [template.id, template]))
  return {
    index: buildAssemblyIndex(file),
    context: {
      composition,
      templates: (id) => byId.get(id),
      ...over,
    },
  }
}

const scene = (): readonly TemplateInstance[] => Object.values(useWorkshopStore.getState().placements)

/** Every write recorded rather than applied, so a test can count without a store. */
function recorder(): { readonly writes: [PlacementId, SlotName, TileId][]; readonly write: FillWriter } {
  const writes: [PlacementId, SlotName, TileId][] = []
  return {
    writes,
    write: (id, slot, tile) => {
      writes.push([id, slot, tile])
      return 'filled'
    },
  }
}

beforeEach(() => {
  resetWorkshop()
})

afterEach(() => {
  clearPlacements()
})

/* ---------------------------------------------------- the design fixture (D6) */

/**
 * Two designs of every part, so a family preference has something to move.
 *
 * The module fixture above carries **no** `texture` at all, deliberately —
 * `fixture.ts` says so — because every test before this one is about the lock.
 * A design change needs the axis to exist, and it needs the *first* candidate in
 * record order to be the wrong design, or a family preference and a
 * first-in-order walk would be indistinguishable. So `cut-stone` leads on every
 * part and `dungeon_stone` follows.
 *
 * Spelled `cut-stone` with a hyphen and `dungeon_stone` with an underscore,
 * which is not a typo: those are the two roots the live archive actually
 * carries, and row D6 found `FillContext.family`'s own docblock offering
 * `cut_stone` as an example of a value that reaches **nothing**.
 */
const DESIGN_RECORDS: readonly FillFixtureRecord[] = [
  { id: 'tiles/wall.cut', design: 'wall-cut', tags: ['shape|wall'], texture: 'cut-stone' },
  { id: 'tiles/wall.dungeon', design: 'wall-dungeon', tags: ['shape|wall'], texture: 'dungeon_stone' },
  { id: 'tiles/floor.cut', design: 'floor-cut', tags: ['shape|floor'], texture: 'cut-stone' },
  { id: 'tiles/floor.dungeon', design: 'floor-dungeon', tags: ['shape|floor'], texture: 'dungeon_stone' },
  { id: 'tiles/base.plain', design: 'base-plain', layer: 'base', tags: ['shape|base'], texture: 'plain' },
]

const CUT_WALL = 'tiles/wall.cut' as unknown as TileId
const DUNGEON_WALL = 'tiles/wall.dungeon' as unknown as TileId

function designHarness(over: Partial<FillContext> = {}): Harness {
  const file = fillFixture(DESIGN_RECORDS)
  const composition = createCompositionIndex(file, buildAggregateIndex(file))
  const template = templateOf(A_TEMPLATE)
  return {
    index: buildAssemblyIndex(file),
    context: { composition, templates: (id) => (id === template.id ? template : undefined), ...over },
  }
}

/* ------------------------------------------------------------- the seam itself */

describe('the context', () => {
  it('accepts `@/assembly`’s own `AssemblyContext` unchanged', () => {
    /* A **compile-time** assertion wearing a runtime one. `FillContext` and
       `SceneFillContext` are spelled so that the context a caller already built
       for the bill is the context this solver takes — same `composition`, same
       optional `lock`, same `templates` — and the whole point of that is that
       C1 and C3 do not have to build a second one or write an adapter. If
       either type drifts, this assignment stops compiling here rather than in
       the consumer that has not been written yet. */
    const { index, context } = harness({ lock: 'openlock' })
    const assembly: AssemblyContext = {
      templates: context.templates,
      composition: context.composition,
      lock: 'openlock',
    }
    const asScene: SceneFillContext = assembly
    const asFill: FillContext = assembly

    placeTemplate({ template: A_TEMPLATE, x: 0, z: 0, rotation: 0, fills: {} })
    expect(reSolveScene(scene(), index, asScene).solves).toBe(1)
    expect(asFill.composition).toBe(context.composition)
  })
})

/* --------------------------------------------------------------- the pinned bit */

describe('the pinned bit', () => {
  it('keeps a pinned fill and rewrites the auto one beside it', () => {
    const { index, context } = harness({ lock: 'dragonlock' })
    const id = placeTemplate({
      template: A_TEMPLATE,
      x: 0,
      z: 0,
      rotation: 0,
      fills: {
        [WALL]: { tile: OPENLOCK_WALL, pinned: true },
        [FLOOR]: { tile: 'tiles/floor-2x2' as unknown as TileId, pinned: false },
      },
    })

    const result = reSolveScene(scene(), index, context)
    const fills = useWorkshopStore.getState().placements[id]?.fills

    // The pin is the user's; the auto fill beside it is the solver's, and the
    // count of the first is what §3.3 has to disclose.
    expect(result.outcomes['kept-pinned']).toBe(1)
    expect(fills?.[WALL]).toEqual({ tile: OPENLOCK_WALL, pinned: true })
    expect(fills?.[FLOOR]).toEqual({ tile: 'tiles/floor-1x1', pinned: false })
    expect(fills?.[BASE]).toEqual({ tile: 'tiles/base', pinned: false })
  })

  it('tells `unchanged` from `kept-pinned`, which is the whole of C-k', () => {
    const { index, context } = harness({ lock: 'openlock' })
    placeTemplate({ template: A_TEMPLATE, x: 0, z: 0, rotation: 0, fills: {} })

    const first = reSolveScene(scene(), index, context)
    const again = reSolveScene(scene(), index, context)

    expect(first.outcomes).toEqual({ filled: 3, unchanged: 0, 'kept-pinned': 0, 'unknown-placement': 0 })
    // A re-solve that produces the same files is the common case and is not
    // news. Collapsing it into `kept-pinned` is what would make a lock change
    // look like it had honoured forty pins when it had honoured none.
    expect(again.outcomes).toEqual({ filled: 0, unchanged: 3, 'kept-pinned': 0, 'unknown-placement': 0 })
  })

  it('costs no solver work for a pinned slot but still writes through the store', () => {
    const { index, context } = harness({ lock: 'openlock' })
    placeTemplate({
      template: A_TEMPLATE,
      x: 0,
      z: 0,
      rotation: 0,
      fills: { [WALL]: { tile: DRAGONLOCK_WALL, pinned: true } },
    })
    const { writes, write } = recorder()

    const result = reSolveScene(scene(), index, context, write)

    // Three writes for three slots — the pinned one included, because the
    // refusal is the store's answer and not this driver's opinion.
    expect(writes.map(([, slot]) => slot)).toEqual(['wall', 'floor', 'base'])
    expect(result.perInstance[0]?.fill?.decisions.find((one) => one.slot === 'wall')?.queries).toBe(0)
  })

  it('reports an instance whose recipe this build does not ship, and writes nothing', () => {
    const { index, context } = harness({ lock: 'openlock' }, [])
    const id = placeTemplate({ template: A_TEMPLATE, x: 0, z: 0, rotation: 0, fills: {} })
    const { writes, write } = recorder()

    const result = reSolveScene(scene(), index, context, write)

    expect(result.unknownTemplates).toEqual([id])
    expect(writes).toEqual([])
    expect(result.slots).toBe(0)
    expect(result.perInstance[0]?.fill).toBeUndefined()
  })
})

/* ------------------------------------------------------------- the lock warning */

describe('a pinned fill under a new lock', () => {
  it('warns, and names the variant of the same design that would print', () => {
    const { index, context } = harness({ lock: 'dragonlock' })
    const id = placeTemplate({
      template: A_TEMPLATE,
      x: 0,
      z: 0,
      rotation: 0,
      fills: { [WALL]: { tile: OPENLOCK_WALL, pinned: true } },
    })

    const [warning, ...rest] = reSolveScene(scene(), index, context).pinWarnings

    expect(rest).toEqual([])
    expect(warning).toEqual({
      placement: id,
      template: A_TEMPLATE,
      slot: 'wall',
      tile: OPENLOCK_WALL,
      offers: ['openlock'],
      wanted: 'dragonlock',
      alternative: DRAGONLOCK_WALL,
    })
    // Reported, never repaired: `pinned: true` means print this exact file.
    expect(useWorkshopStore.getState().placements[id]?.fills[WALL]?.tile).toBe(OPENLOCK_WALL)
  })

  it('says nothing about a fill that carries no lock system at all', () => {
    /* `resolve.ts#lock-unavailable`'s reading, so the warning and the bill's
       note cannot disagree: 349 records carry no `connection|` tag and 60.6%
       carry a lock system, so "no system" is a large population and it is
       lock-agnostic rather than broken. */
    const { index, context } = harness({ lock: 'dragonlock' })
    placeTemplate({
      template: A_TEMPLATE,
      x: 0,
      z: 0,
      rotation: 0,
      fills: { [WALL]: { tile: AGNOSTIC_WALL, pinned: true } },
    })

    expect(reSolveScene(scene(), index, context).pinWarnings).toEqual([])
  })

  it('says nothing when no lock preference was stated', () => {
    const { index, context } = harness({})
    placeTemplate({
      template: A_TEMPLATE,
      x: 0,
      z: 0,
      rotation: 0,
      fills: { [WALL]: { tile: OPENLOCK_WALL, pinned: true } },
    })

    expect(reSolveScene(scene(), index, context).pinWarnings).toEqual([])
  })

  it('has no alternative to name when the design comes in one lock only', () => {
    const { index, context } = harness({ lock: 'magnetic' })
    placeTemplate({
      template: A_TEMPLATE,
      x: 0,
      z: 0,
      rotation: 0,
      fills: { [BASE]: { tile: 'tiles/base' as unknown as TileId, pinned: true } },
    })

    expect(reSolveScene(scene(), index, context).pinWarnings[0]?.alternative).toBeUndefined()
  })
})

/* -------------------------------------------------------------- the stale fill */

describe('a fill the re-solve can no longer make', () => {
  it('reports it, because no store action can clear it', () => {
    /* The fourth gap around the `pinned` bit, and the one this row found: a
       size change can empty a slot that was filled, `fillSlot` and `pinFill`
       both write a tile, and there is no delete. Unreachable through the lock —
       the candidate set is lock-free — so this is the whole population. */
    const { index, context } = harness({ lock: 'openlock', cell: { w: 5, d: 5 } })
    const id = placeTemplate({
      template: A_TEMPLATE,
      x: 0,
      z: 0,
      rotation: 0,
      fills: { [FLOOR]: { tile: 'tiles/floor-1x1' as unknown as TileId, pinned: false } },
    })

    const result = reSolveScene(scene(), index, context)

    expect(result.unfilled).toContainEqual({
      placement: id,
      template: A_TEMPLATE,
      slot: 'floor',
      gap: 'unknown-ref',
      stale: 'tiles/floor-1x1',
    })
    expect(result.perInstance[0]?.stale).toEqual(['floor'])
    // Still in the store, and still wrong. The report is the only surface for it.
    expect(useWorkshopStore.getState().placements[id]?.fills[FLOOR]?.tile).toBe('tiles/floor-1x1')
  })

  it('says nothing stale about a slot that was empty and stays empty', () => {
    const { index, context } = harness({ lock: 'openlock', cell: { w: 5, d: 5 } })
    placeTemplate({ template: A_TEMPLATE, x: 0, z: 0, rotation: 0, fills: {} })

    const result = reSolveScene(scene(), index, context)

    // All three slots: a 5x5 cell has no `size|width|5` tag to find anything by,
    // and only the one that was already filled has anything stale about it.
    expect(result.unfilled.map((one) => one.stale)).toEqual([undefined, undefined, undefined])
    expect(result.perInstance[0]?.stale).toEqual([])
  })
})

/* --------------------------------------------------------- a design change (D6) */

/**
 * A design change is this driver's second caller, and the contract is the lock's
 * word for word: **re-solve every `auto` fill, never touch a `pinned` one.**
 *
 * That it is the *same* driver is the finding rather than the convenience. Row
 * D6 was briefed to wire a room-wide design and the plumbing turned out to be
 * complete on this side of the seam — `FillContext.family` has been the solver's
 * first preference since C2 and `reSolveScene` passes its whole context
 * through — so what this block proves is that nothing had to be added here for
 * a design change to behave correctly, including the half a new caller is most
 * likely to get wrong.
 */
describe('a design change', () => {
  it('rewrites an auto fill to the room’s design', () => {
    const id = placeTemplate({ template: A_TEMPLATE, x: 0, z: 0, rotation: 0, fills: {} })

    // No design: the walk falls through to the ascending address, so the
    // first-declared `cut-stone` wall wins. This is the state the defect was
    // found in — the corner that came out of four stone types.
    const none = designHarness({ lock: 'openlock' })
    reSolveScene(scene(), none.index, none.context)
    expect(useWorkshopStore.getState().placements[id]?.fills[WALL]?.tile).toBe(CUT_WALL)

    const dungeon = designHarness({ lock: 'openlock', family: 'dungeon_stone' })
    const result = reSolveScene(scene(), dungeon.index, dungeon.context)

    const fills = useWorkshopStore.getState().placements[id]?.fills
    expect(fills?.[WALL]).toEqual({ tile: DUNGEON_WALL, pinned: false })
    expect(fills?.[FLOOR]?.tile).toBe('tiles/floor.dungeon')
    // Two of the three moved. The base did not, and that is the archive's shape
    // rather than a failure: `plain` is the only base in the pool, exactly as it
    // is on 38 of the 40 shipped base slots.
    expect(result.outcomes.filled).toBe(2)
    expect(fills?.[BASE]?.tile).toBe('tiles/base.plain')
  })

  it('never touches a pinned fill, exactly as a lock change does not', () => {
    /* The owner's requirement is *"Room-Wide Design as the default, manual
       deviations are always allowed"*, and this is the second half of it. The
       pinned wall is in the *wrong* design and stays: `pinned: true` means
       print this exact file, and a driver that silently restyled it would
       discard a deliberate choice with nothing failing. */
    const id = placeTemplate({
      template: A_TEMPLATE,
      x: 0,
      z: 0,
      rotation: 0,
      fills: { [WALL]: { tile: CUT_WALL, pinned: true } },
    })
    const { index, context } = designHarness({ lock: 'openlock', family: 'dungeon_stone' })

    const result = reSolveScene(scene(), index, context)
    const fills = useWorkshopStore.getState().placements[id]?.fills

    expect(result.outcomes['kept-pinned']).toBe(1)
    expect(fills?.[WALL]).toEqual({ tile: CUT_WALL, pinned: true })
    // And the auto fill beside it *did* follow the design, which is what makes
    // the refusal a policy rather than a no-op.
    expect(fills?.[FLOOR]?.tile).toBe('tiles/floor.dungeon')
  })

  it('honours the pin at no solver cost, and reports it as pinned', () => {
    placeTemplate({
      template: A_TEMPLATE,
      x: 0,
      z: 0,
      rotation: 0,
      fills: { [WALL]: { tile: CUT_WALL, pinned: true } },
    })
    const { index, context } = designHarness({ lock: 'openlock', family: 'dungeon_stone' })

    const decisions = reSolveScene(scene(), index, context).perInstance[0]?.fill?.decisions
    const wall = decisions?.find((one) => one.slot === 'wall')

    expect(wall?.reason).toBe('pinned')
    expect(wall?.queries).toBe(0)
    // The pin is not in the family, and the decision says so rather than
    // claiming the design was honoured because the slot has a fill.
    expect(wall?.familyHonoured).toBe(false)
  })

  it('fills a slot with nothing in the design rather than leaving it empty', () => {
    /* C2's fallback contract, at the driver level: a design is a preference and
       never a filter. `towne` is in this fixture's pool nowhere at all — which
       is the reachable case, since 8 of the archive's 36 roots reach no
       placeable part — and every slot still fills. */
    const id = placeTemplate({ template: A_TEMPLATE, x: 0, z: 0, rotation: 0, fills: {} })
    const { index, context } = designHarness({ lock: 'openlock', family: 'towne' })

    const result = reSolveScene(scene(), index, context)
    const fills = useWorkshopStore.getState().placements[id]?.fills

    expect(result.unfilled).toEqual([])
    expect(filledSlots(fills ?? {})).toEqual(['wall', 'floor', 'base'])
    expect(result.perInstance[0]?.fill?.complete).toBe(true)
  })

  it('reports no pin warning, because a design cannot make a file unprintable', () => {
    /* `PinLockWarning` is about joinery: a pinned file that carries some lock
       system and not the wanted one. A design has no such failure mode — the
       piece prints, it just looks like a different room — so this driver has
       nothing to warn about and deliberately does not invent a second warning
       shape for it. */
    placeTemplate({
      template: A_TEMPLATE,
      x: 0,
      z: 0,
      rotation: 0,
      fills: { [WALL]: { tile: CUT_WALL, pinned: true } },
    })
    const { index, context } = designHarness({ lock: 'openlock', family: 'dungeon_stone' })

    expect(reSolveScene(scene(), index, context).pinWarnings).toEqual([])
  })
})

/* ------------------------------------------------------------- the scene scale */

/**
 * The scene-scale block builds a 250-instance room, re-solves it five times and
 * writes 750 fills through the real store. That is seconds of real work, and
 * vitest's 5,000 ms default is not enough for it under contention: it times out
 * on a whole-suite run that takes 2-3.6x its usual wall-clock, and passes in
 * isolation (27 of 27 in 7.4 s) and in CI twice over.
 *
 * The same argument and the same fix as `src/composition/corpus.test.ts`'s
 * `SLOW_CORPUS_MS` and `src/share/capacity.test.ts`'s `SLOW_CAPACITY_MS`. What
 * the block asserts is unchanged — the *ratio* between the solver and the store
 * write, which contention scales together — so only the wall-clock cap moves.
 */
const SLOW_RESOLVE_MS = 120_000

describe('the scene-scale re-solve', () => {
  /**
   * Forty recipes, 250 instances — the plan's own room size.
   *
   * Distinct template ids over identical parts, because what the memo is keyed
   * on is the *id*: a room of one recipe would prove the memo works and would
   * not prove it is bounded by the recipe count.
   */
  const TEMPLATES = Array.from({ length: 40 }, (_, at) => templateOf(`fixture-recipe-${String(at)}`))
  const ids = TEMPLATES.map((template) => TemplateIdSchema.parse(template.id))

  const room = (count: number, pins: number): void => {
    for (let at = 0; at < count; at += 1) {
      const template = ids[at % ids.length] as TemplateId
      placeTemplate({
        template,
        x: at % 20,
        z: Math.floor(at / 20),
        rotation: 0,
        fills: at < pins ? { [WALL]: { tile: DRAGONLOCK_WALL, pinned: true } } : {},
      })
    }
  }

  it('solves each recipe once however many instances share it', () => {
    const { index, context } = harness({ lock: 'openlock' }, TEMPLATES)
    room(250, 0)
    const { write } = recorder()

    const result = reSolveScene(scene(), index, context, write)

    // 250 instances, 750 slots, **40** solves. That is the answer to the plan's
    // "1,250 candidate queries, synchronously, on one click": the solve is a
    // pure function of (template, preference, pins) and a room is built out of
    // 40 recipes.
    expect(result.instances).toBe(250)
    expect(result.slots).toBe(750)
    expect(result.solves).toBe(40)
    expect(result.cached).toBe(210)
    // Three slot resolutions per solve and no sibling probes at all: no part of
    // this fixture template carries a `constrain`, so `readsSibling` excludes
    // every pair. The archive's own figure is `SOLVE_QUERIES`.
    expect(result.queries).toBe(40 * 3)
  })

  it('keys the memo on the pins, so a pinned instance is solved on its own', () => {
    const { index, context } = harness({ lock: 'openlock' }, TEMPLATES)
    room(80, 40)
    const { write } = recorder()

    const result = reSolveScene(scene(), index, context, write)

    // 40 pinned instances of 40 distinct recipes, then 40 unpinned ones: two
    // distinct keys per recipe and no sharing between them.
    expect(result.solves).toBe(80)
    expect(result.cached).toBe(0)
  })

  it('shares one solve between two instances pinned the same way', () => {
    const { index, context } = harness({ lock: 'openlock' }, TEMPLATES)
    for (let at = 0; at < 3; at += 1) {
      placeTemplate({
        template: ids[0] as TemplateId,
        x: at,
        z: 0,
        rotation: 0,
        fills: { [WALL]: { tile: DRAGONLOCK_WALL, pinned: true } },
      })
    }
    const { write } = recorder()

    const result = reSolveScene(scene(), index, context, write)

    expect(result.solves).toBe(1)
    expect(result.cached).toBe(2)
    // The warning is read off each instance's own pins, so a shared solve still
    // reports one per instance.
    expect(reSolveScene(scene(), index, { ...context, lock: 'magnetic' }, write).pinWarnings).toHaveLength(3)
  })

  it('fits a lock toggle in a frame, and the store write is the expensive half', () => {
    /*
      The measurement §11 asks for, and the answer is not the one the plan
      expects. Over a 250-instance room, floor of five attempts:

      | half | ms |
      | --- | ---: |
      | the solver, memoised, over this seven-record fixture | **0.8** |
      | the same 750 fills written through the real store | **80.5** |

      And on the *live archive*, where a candidate query walks real posting
      lists rather than a seven-record fixture, `corpus.test.ts` measures the
      solver's two shapes at **8-9 ms memoised against 53-65 ms per instance**.
      So memoising is what keeps the solver inside a 16.7 ms frame there, and it
      does keep it inside one.

      What does not fit in a frame is the **write**: `persist` serialises the
      whole scene to `localStorage` on every `setState`, so 750 fills of a
      250-instance room is 750 JSON encodings of the entire room. That is A1's
      surface and not this row's to change, and the honest options are named in
      the module docblock rather than papered over here. This test asserts the
      half this row owns and measures the other so the number exists.

      A floor over repeats rather than a single reading, for the reason
      `screens/assemblies/corpus.test.ts` gives: contention can only ever add
      time, so a policy that is genuinely over budget is over budget on every
      attempt. The budget is loose — this is a regression guard, not the
      measurement.
    */
    const { index, context } = harness({ lock: 'openlock' }, TEMPLATES)
    room(250, 0)
    const instances = scene()
    const { write } = recorder()

    const floorOf = (run: () => void): number => {
      let floor = Number.POSITIVE_INFINITY
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const started = performance.now()
        run()
        floor = Math.min(floor, performance.now() - started)
      }
      return floor
    }

    const solver = floorOf(() => {
      reSolveScene(instances, index, context, write)
    })
    const stored = floorOf(() => {
      reSolveScene(instances, index, context)
    })

    expect(solver).toBeLessThan(16)
    // Not an assertion about the store's speed — an assertion that the two
    // halves are not the same size, which is the finding.
    expect(stored).toBeGreaterThan(solver)
  }, SLOW_RESOLVE_MS)

  it('writes through the store’s own guard, so a fill it refuses stays refused', () => {
    const { index, context } = harness({ lock: 'openlock' }, TEMPLATES)
    room(4, 4)

    const outcomes: FillOutcome[] = []
    reSolveScene(scene(), index, context, (id, slot, tile) => {
      const outcome = fillSlot(id, slot, tile)
      outcomes.push(outcome)
      return outcome
    })

    expect(outcomes.filter((one) => one === 'kept-pinned')).toHaveLength(4)
    for (const instance of scene()) {
      expect(instance.fills[WALL]).toEqual({ tile: DRAGONLOCK_WALL, pinned: true })
    }
  })
})
