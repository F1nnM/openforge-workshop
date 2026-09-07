/**
 * The default-fill solver, on catalogs small enough to reason about.
 *
 * Every case here is one of the row's decisions with the archive taken out of
 * it, so a failure names the decision rather than a corpus figure: the greying
 * rule (and the greedy control failing the *same* template), the base ladder
 * beating the candidate order, the three preferences in order, the three ways a
 * slot ends up empty, and B3's size refs layered on. `corpus.test.ts` is where
 * the same behaviours are measured over all 8,702 records and 40 recipes.
 *
 * The greedy control is `measure.ts#measureGreedy`, run over these fixtures as
 * well as over the archive. That is the point of it being an independent walk:
 * a four-record catalog on which the two policies disagree is the smallest
 * possible statement of why this row exists.
 */
import { describe, expect, it } from 'vitest'

import type { CatalogFile, TileId } from '@/catalog'
import { buildAggregateIndex } from '@/catalog'
import type { AssemblyIndex, AssemblyTemplate } from '@/assembly'
import { buildAssemblyIndex } from '@/assembly'
import { createCompositionIndex } from '@/composition'
import type { LockSystem } from '@/store'

import type { FillContext } from './fill'
import { solveTemplateFills } from './fill'
import type { FillFixtureRecord } from './fixture'
import { fillFixture } from './fixture'
import { measureGreedy, measureGreying } from './measure'
import { EXTERNAL_CORNER, INTERNAL_CORNER, SLOT_CONVENTIONS, WALL_ON_TILE, conventionFor } from './rules'

/* ------------------------------------------------------------------ the harness */

interface Harness {
  readonly file: CatalogFile
  readonly index: AssemblyIndex
  readonly context: FillContext
}

function harness(records: readonly FillFixtureRecord[], over: Partial<FillContext> = {}): Harness {
  const file = fillFixture(records)
  const aggregates = buildAggregateIndex(file)
  const composition = createCompositionIndex(file, aggregates)
  return { file, index: buildAssemblyIndex(file), context: { composition, ...over } }
}

/** A template in the shipped `wall`/`floor`/`base` declared order. */
function wallTemplate(parts: AssemblyTemplate['parts']): AssemblyTemplate {
  return { id: 'fixture-wall', tags: ['object|tile'], parts }
}

const tile = (id: string): TileId => id as unknown as TileId

/* ---------------------------------------------------------------- the greying rule */

/**
 * Four records and one template on which the two policies disagree.
 *
 * The wall's two candidates carry different `connection|side` systems, and the
 * base inherits that namespace from its siblings — which is the archive's own
 * mechanism, not a contrived one: it is why the sixteen modular wall recipes
 * have 48 candidate bases before their siblings are picked and 0 after.
 * `tiles/wall-openlock` comes first in catalog order, so a greedy walk takes it
 * and closes the base.
 */
const SIBLING_RECORDS: readonly FillFixtureRecord[] = [
  {
    id: 'tiles/wall-openlock',
    design: 'wall-openlock',
    tags: ['shape|wall', 'connection|side|openlock'],
    texture: 'dungeon_stone',
  },
  {
    id: 'tiles/wall-dragonlock',
    design: 'wall-dragonlock',
    tags: ['shape|wall', 'connection|side|dragonlock'],
    texture: 'cut_stone',
  },
  { id: 'tiles/floor', design: 'floor', tags: ['shape|floor'], texture: 'dungeon_stone' },
  {
    id: 'tiles/base-topless',
    design: 'base-topless',
    layer: 'base',
    conn: ['openlock'],
    tags: ['shape|base', 'connection|side|dragonlock', 'connection|openlock|topless'],
  },
  {
    id: 'tiles/base-plain',
    design: 'base-plain',
    layer: 'base',
    conn: ['openlock'],
    tags: ['shape|base', 'connection|side|dragonlock', 'connection|openlock'],
  },
]

const SIBLING_TEMPLATE = wallTemplate([
  { name: 'wall', tags: { require: [{ tag: 'shape|wall' }] } },
  { name: 'floor', tags: { require: [{ tag: 'shape|floor' }] } },
  { name: 'base', tags: { require: [{ tag: 'shape|base' }], constrain: [{ tag: 'connection|side' }] } },
])

describe('the greying rule', () => {
  const { index, context } = harness(SIBLING_RECORDS, { lock: 'openlock' })

  it('passes over a candidate that would empty a still-open sibling', () => {
    const fill = solveTemplateFills(SIBLING_TEMPLATE, index, context)

    expect(fill.complete).toBe(true)
    expect(fill.needsChoice).toEqual([])
    // Not the first candidate in catalog order: that one leaves the base with
    // nothing, which is the whole of the 24-of-40 failure in four records.
    expect(fill.fills.wall).toBe('tiles/wall-dragonlock')
    expect(fill.decisions.find((one) => one.slot === 'wall')?.skipped).toBe(1)
  })

  it('is the difference between completing this template and not', () => {
    const greedy = measureGreedy([SIBLING_TEMPLATE], context.composition)
    const greying = measureGreying([SIBLING_TEMPLATE], context.composition)

    expect(greedy.completed).toBe(0)
    expect(greedy.failures).toEqual([{ template: 'fixture-wall', slot: 'base', cold: 2, atFailure: 0 }])
    expect(greying.completed).toBe(1)
    expect(greying.skipped).toBe(1)
  })

  it('probes only the siblings whose `constrain` can read the part being filled', () => {
    /* `floor` has no `constrain` at all, so no pick can move it and the walk
       never resolves it to find out. What is left is 3 slot resolutions, 3
       probes of `base` under a candidate — 2 for the wall's candidates and 1 for
       the floor's — and **one** before-count, resolved lazily on the single
       probe that came back empty. */
    const fill = solveTemplateFills(SIBLING_TEMPLATE, index, context)
    expect(fill.queries).toBe(7)

    /* Give `floor` a `constrain` that inherits nothing — no record here carries
       a `texture|` tag — and the answer is identical while the walk pays for
       three more resolutions. That is the filter measured on its own: it changes
       the cost and not the fills. */
    const reader = wallTemplate([
      { name: 'wall', tags: { require: [{ tag: 'shape|wall' }] } },
      { name: 'floor', tags: { require: [{ tag: 'shape|floor' }], constrain: [{ tag: 'texture' }] } },
      { name: 'base', tags: { require: [{ tag: 'shape|base' }], constrain: [{ tag: 'connection|side' }] } },
    ])
    const probed = solveTemplateFills(reader, index, context)

    expect(probed.queries).toBe(9)
    expect(probed.fills).toEqual(fill.fills)
  })

  it('places anyway when a pin closes a slot, and says which of the three reasons', () => {
    /* Contract **C-g**: the instance places with a hole in it. The pin is the
       candidate the greying walk refuses, so this is the one route by which a
       solved instance can still have a closed slot — and the re-solve must
       honour it rather than repair it. */
    const fill = solveTemplateFills(SIBLING_TEMPLATE, index, context, {
      wall: tile('tiles/wall-openlock'),
    })

    expect(fill.complete).toBe(false)
    expect(fill.needsChoice).toEqual(['base'])
    expect(fill.fills.floor).toBe('tiles/floor')
    const base = fill.decisions.find((one) => one.slot === 'base')
    expect(base?.gap).toBe('closed-by-siblings')
    expect(base?.candidates).toBe(0)
  })

  it('costs nothing for a pinned slot and reports it as pinned', () => {
    const fill = solveTemplateFills(SIBLING_TEMPLATE, index, context, {
      wall: tile('tiles/wall-dragonlock'),
    })
    const wall = fill.decisions.find((one) => one.slot === 'wall')

    expect(wall?.reason).toBe('pinned')
    expect(wall?.queries).toBe(0)
    expect(wall?.tile).toBe('tiles/wall-dragonlock')
    expect(fill.complete).toBe(true)
  })
})

/* ------------------------------------------------------------------ the base ladder */

describe('the base slot', () => {
  const { index, context } = harness(SIBLING_RECORDS, { lock: 'openlock' })

  it('is ranked by `rankBases`, not taken in candidate order', () => {
    const fill = solveTemplateFills(SIBLING_TEMPLATE, index, context)
    const base = fill.decisions.find((one) => one.slot === 'base')

    // `tiles/base-topless` has the lower item address, so every ordering policy
    // in this file would have taken it. A topless base has no top surface.
    expect(base?.tile).toBe('tiles/base-plain')
    expect(base?.reason).toBe('base-ranking')
    expect(base?.base?.option).toBe('plain')
    expect(base?.base?.optionsOffered).toEqual(['plain', 'topless'])
    expect(base?.base?.lockAgrees).toBe(true)
  })

  it('is the slot the layout says something rests on, on all four conventions', () => {
    /* Read off B2's `restsOn` rather than off the name `base`, so the two cannot
       drift. The assertion is the identity of the slot, not the name test. */
    const restedOn = SLOT_CONVENTIONS.map((convention) => [
      convention.id,
      convention.slots.filter((rule) => convention.slots.some((other) => other.restsOn === rule.part)).map((rule) => rule.part),
    ])

    expect(restedOn).toEqual([
      ['wall-on-tile', ['base']],
      ['external-corner', ['base']],
      ['internal-corner', ['base']],
    ])
  })

  it('ranks against the fill of the layout’s cell, which is the floor', () => {
    /* The reference decides three of the ladder's five criteria, and B2 measured
       the base congruent to the floor cell on 1,213 of 1,213 combinations. With
       the floor's texture on one base and not the other, the reference is what
       chooses — and the ladder's texture criterion can only ever break a tie. */
    const records: readonly FillFixtureRecord[] = [
      { id: 'tiles/floor', design: 'floor', tags: ['shape|floor'], texture: 'tudor' },
      {
        id: 'tiles/base-a',
        design: 'base-a',
        layer: 'base',
        conn: ['openlock'],
        tags: ['shape|base', 'connection|openlock'],
        texture: 'cave',
      },
      {
        id: 'tiles/base-b',
        design: 'base-b',
        layer: 'base',
        conn: ['openlock'],
        tags: ['shape|base', 'connection|openlock'],
        texture: 'tudor',
      },
    ]
    const local = harness(records, { lock: 'openlock' })
    const template: AssemblyTemplate = {
      id: 'fixture-floor-base',
      tags: ['object|tile'],
      // A two-part template has no convention, so the layout — and with it the
      // base ranking — is absent. The convention's own part names are used.
      parts: [
        { name: 'floor', tags: { require: [{ tag: 'shape|floor' }] } },
        { name: 'wall', tags: { require: [{ tag: 'shape|floor' }] } },
        { name: 'base', tags: { require: [{ tag: 'shape|base' }] } },
      ],
    }
    const fill = solveTemplateFills(template, local.index, local.context)
    const base = fill.decisions.find((one) => one.slot === 'base')

    expect(base?.tile).toBe('tiles/base-b')
    expect(base?.base?.textureAgrees).toBe(true)
  })

  it('falls back to the candidate order when nothing that rests on it is filled', () => {
    /* `base` declared **first**, so the ladder has no reference and says so by
       not being used. No shipped recipe reaches this — all three declared orders
       put `base` last — and the honest fallback is the ordering policy. */
    const template: AssemblyTemplate = {
      id: 'fixture-base-first',
      tags: ['object|tile'],
      parts: [
        { name: 'base', tags: { require: [{ tag: 'shape|base' }] } },
        { name: 'floor', tags: { require: [{ tag: 'shape|floor' }] } },
        { name: 'wall', tags: { require: [{ tag: 'shape|wall' }] } },
      ],
    }
    const fill = solveTemplateFills(template, index, context)
    const base = fill.decisions.find((one) => one.slot === 'base')

    expect(base?.base).toBeUndefined()
    // Its item has one file, so that file is also the item's preferred variant.
    expect(base?.reason).toBe('preferred')
    expect(base?.tile).toBe('tiles/base-topless')
  })
})

/* ------------------------------------------------------------------ the preferences */

describe('the three preferences, in order', () => {
  const FAMILY_RECORDS: readonly FillFixtureRecord[] = [
    ...SIBLING_RECORDS,
    {
      id: 'tiles/wall-tudor',
      design: 'wall-tudor',
      tags: ['shape|wall', 'connection|side|dragonlock'],
      texture: 'tudor',
    },
  ]

  it('takes the room’s design family over a lower item address', () => {
    const { index, context } = harness(FAMILY_RECORDS, { lock: 'openlock', family: 'tudor' })
    const fill = solveTemplateFills(SIBLING_TEMPLATE, index, context)
    const wall = fill.decisions.find((one) => one.slot === 'wall')

    // `tiles/wall-dragonlock` has the lower address and is equally safe.
    expect(wall?.tile).toBe('tiles/wall-tudor')
    expect(wall?.reason).toBe('family')
    expect(wall?.familyHonoured).toBe(true)
  })

  it('is a preference and not a filter: a part with none of the family still fills', () => {
    const { index, context } = harness(FAMILY_RECORDS, { lock: 'openlock', family: 'tudor' })
    const fill = solveTemplateFills(SIBLING_TEMPLATE, index, context)
    const base = fill.decisions.find((one) => one.slot === 'base')

    expect(base?.tile).toBe('tiles/base-plain')
    expect(base?.familyHonoured).toBe(false)
    expect(fill.complete).toBe(true)
  })

  it('never lets the family beat the greying rule', () => {
    /* The family is asked for on the one candidate that closes the base. The
       ordering puts it first and the rule refuses it anyway — which is the
       ordering being a *preference within* the admissible set rather than above
       it. */
    const { index, context } = harness(SIBLING_RECORDS, { lock: 'openlock', family: 'dungeon_stone' })
    const fill = solveTemplateFills(SIBLING_TEMPLATE, index, context)

    expect(fill.fills.wall).toBe('tiles/wall-dragonlock')
    expect(fill.decisions.find((one) => one.slot === 'wall')?.familyHonoured).toBe(false)
    expect(fill.complete).toBe(true)
  })

  it('takes the item’s preferred variant under the lock preference', () => {
    /* Two files of one design, one clipping openlock underneath and one
       dragonlock. The item is chosen by address and the *file* by
       `selectVariantForLock`, which is the two-step every candidate grid in this
       app uses — and it is the half of the lock preference that survives into a
       fill. */
    const records: readonly FillFixtureRecord[] = [
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
    ]
    const template: AssemblyTemplate = {
      id: 'fixture-one-part',
      tags: ['object|tile'],
      parts: [{ name: 'wall', tags: { require: [{ tag: 'shape|wall' }] } }],
    }

    const pick = (lock: LockSystem): string | undefined => {
      const { index, context } = harness(records, { lock })
      const fill = solveTemplateFills(template, index, context)
      return fill.fills.wall
    }

    expect(pick('openlock')).toBe('tiles/wall.openlock')
    expect(pick('dragonlock')).toBe('tiles/wall.dragonlock')
  })

  it('reports `address` when the item’s preferred file is not a candidate', () => {
    /* The slot denies the tag the preferred variant carries, so the pool starts
       with a file its own item would not have offered. Reporting that as
       `preferred` would name the wrong criterion. */
    const records: readonly FillFixtureRecord[] = [
      {
        id: 'tiles/wall.tall',
        design: 'wall-multi',
        tags: ['shape|wall', 'shape|wall|tall', 'connection|openlock'],
        conn: ['openlock'],
      },
      { id: 'tiles/wall.plain', design: 'wall-multi', tags: ['shape|wall'], conn: [] },
    ]
    const { index, context } = harness(records, { lock: 'openlock' })
    const template: AssemblyTemplate = {
      id: 'fixture-denied',
      tags: ['object|tile'],
      parts: [
        {
          name: 'wall',
          tags: { require: [{ tag: 'shape|wall' }], deny: [{ tag: 'shape|wall|tall' }] },
        },
      ],
    }
    const wall = solveTemplateFills(template, index, context).decisions[0]

    expect(wall?.tile).toBe('tiles/wall.plain')
    expect(wall?.reason).toBe('address')
  })
})

/* --------------------------------------------------------------------- the gaps */

describe('the three ways a slot ends up with nothing', () => {
  const { index, context } = harness(SIBLING_RECORDS, { lock: 'openlock' })

  it('calls a slot that never had a candidate an archive gap', () => {
    const template = wallTemplate([
      {
        name: 'wall',
        // Both tags exist; no record carries both. **0 of the 128 shipped
        // template parts** is in this state, which is why it needs no UI.
        tags: { require: [{ tag: 'shape|wall' }, { tag: 'shape|floor' }] },
      },
      { name: 'floor', tags: { require: [{ tag: 'shape|floor' }] } },
      { name: 'base', tags: { require: [{ tag: 'shape|base' }] } },
    ])
    const fill = solveTemplateFills(template, index, context)
    const wall = fill.decisions.find((one) => one.slot === 'wall')

    expect(wall?.gap).toBe('no-candidate')
    expect(wall?.unknownRefs).toEqual([])
    // The rest of the template still fills, and the instance still places.
    expect(fill.fills.floor).toBe('tiles/floor')
    expect(fill.complete).toBe(false)
  })

  it('tells a dangling ref from a narrowing', () => {
    const template = wallTemplate([
      { name: 'wall', tags: { require: [{ tag: 'shape|unicorn' }] } },
      { name: 'floor', tags: { require: [{ tag: 'shape|floor' }] } },
      { name: 'base', tags: { require: [{ tag: 'shape|base' }] } },
    ])
    const wall = solveTemplateFills(template, index, context).decisions[0]

    expect(wall?.gap).toBe('unknown-ref')
    expect(wall?.unknownRefs).toEqual(['shape|unicorn'])
  })

  it('does not fault an optional slot it could not fill', () => {
    const template = wallTemplate([
      { name: 'wall', tags: { require: [{ tag: 'shape|unicorn' }] }, optional: true },
      { name: 'floor', tags: { require: [{ tag: 'shape|floor' }] } },
      { name: 'base', tags: { require: [{ tag: 'shape|base' }] } },
    ])
    const fill = solveTemplateFills(template, index, context)

    // Absence means required — all 128 shipped parts are — so this is the path
    // B4's generated families may take and the shipped ones never do.
    expect(fill.complete).toBe(true)
    expect(fill.needsChoice).toEqual(['wall'])
  })
})

/* --------------------------------------------------------------------- the size */

describe('the size parameter', () => {
  const SIZED_RECORDS: readonly FillFixtureRecord[] = [
    { id: 'tiles/floor-1x1', design: 'floor-1x1', tags: ['shape|floor', 'size|width|1', 'size|depth|1'] },
    { id: 'tiles/floor-2x2', design: 'floor-2x2', tags: ['shape|floor', 'size|width|2', 'size|depth|2'] },
    { id: 'tiles/wall-2', design: 'wall-2', tags: ['shape|wall', 'size|width|2'] },
    { id: 'tiles/column', design: 'column', tags: ['shape|column|corner', 'size|column_shape|L'] },
    {
      id: 'tiles/base-2x2',
      design: 'base-2x2',
      layer: 'base',
      conn: ['openlock'],
      tags: ['shape|base', 'size|width|2', 'size|depth|2', 'connection|openlock'],
    },
    {
      // Never a candidate. It carries `RUN_DENY_TAGS` so the vocabulary holds
      // them, which is what keeps an `edge` slot's `deny` from reading as a
      // dangling ref — the deny is real and satisfied by the whole fixture.
      id: 'tiles/decoy',
      design: 'decoy',
      tags: ['shape|angled|right', 'shape|option|curved_interface'],
    },
  ]

  const sizedTemplate = wallTemplate([
    { name: 'wall', tags: { require: [{ tag: 'shape|wall' }] } },
    { name: 'floor', tags: { require: [{ tag: 'shape|floor' }] } },
    { name: 'base', tags: { require: [{ tag: 'shape|base' }] } },
  ])

  it('takes the recipe’s own answer when no cell is asked for', () => {
    const { index, context } = harness(SIZED_RECORDS, { lock: 'openlock' })
    const fill = solveTemplateFills(sizedTemplate, index, context)

    expect(fill.fills.floor).toBe('tiles/floor-1x1')
  })

  it('layers B3’s refs on when a cell is', () => {
    const { index, context } = harness(SIZED_RECORDS, { lock: 'openlock', cell: { w: 2, d: 2 } })
    const fill = solveTemplateFills(sizedTemplate, index, context)
    const floor = fill.decisions.find((one) => one.slot === 'floor')

    // The 1x1 floor comes first in catalog order and is no longer a candidate at
    // all, which is the difference between a size parameter and a size hint.
    expect(fill.fills.floor).toBe('tiles/floor-2x2')
    expect(floor?.candidates).toBe(1)
    expect(floor?.unknownRefs).toEqual([])
    expect(fill.complete).toBe(true)
  })

  it('adds no ref for a `corner` anchor, so a slot with no size control still fills', () => {
    /* B3: the 133 corner-square pieces carry `size|column_shape` in five
       spellings and no size tag at all, so the honest predicate is
       `{ kind: 'none' }`. The column here has no size tag, and a 2x2 cell must
       not empty it. */
    const { index, context } = harness(SIZED_RECORDS, { lock: 'openlock', cell: { w: 2, d: 2 } })
    const template: AssemblyTemplate = {
      id: 'fixture-internal-corner',
      tags: ['object|tile'],
      parts: [
        { name: 'column', tags: { require: [{ tag: 'shape|column|corner' }] } },
        { name: 'floor', tags: { require: [{ tag: 'shape|floor' }] } },
        { name: 'base', tags: { require: [{ tag: 'shape|base' }] } },
      ],
    }
    const fill = solveTemplateFills(template, index, context)

    expect(INTERNAL_CORNER.slots.find((rule) => rule.part === 'column')?.anchor).toBe('corner')
    expect(fill.fills.column).toBe('tiles/column')
    expect(fill.complete).toBe(true)
  })

  it('reports a size the corpus has no tag for rather than dropping the constraint', () => {
    /* `size|width` runs 1 to 8 in the corpus and has no `0.5` and nothing above
       8, so a cell whose face span has no tag is expressible. Silently ignoring
       the ref would place a wrong-size part and call the instance complete. */
    const { index, context } = harness(SIZED_RECORDS, { lock: 'openlock', cell: { w: 5, d: 5 } })
    const fill = solveTemplateFills(sizedTemplate, index, context)
    const floor = fill.decisions.find((one) => one.slot === 'floor')

    expect(floor?.gap).toBe('unknown-ref')
    expect(floor?.unknownRefs).toEqual(['size|width|5'])
    expect(fill.complete).toBe(false)
  })

  it('applies B4’s per-family refs to every slot, layout or no layout', () => {
    /* Row B4's own size control: `GENERATED_FAMILY_SIZES` gives a family a list
       of `{ label, tags }` whose tags are exactly this spelling. All 51 of its
       families have one part and none has a convention, so this is the only
       path that reaches them — `corpus.test.ts` runs all 350 of its options. */
    const { index, context } = harness(SIZED_RECORDS, {
      lock: 'openlock',
      size: ['size|width|2', 'size|depth|2'],
    })
    const template: AssemblyTemplate = {
      id: 'fixture-generated-floor',
      tags: ['role|floor'],
      parts: [{ name: 'floor', tags: { require: [{ tag: 'shape|floor' }] } }],
    }
    const fill = solveTemplateFills(template, index, context)

    expect(conventionFor(['floor'])).toBeUndefined()
    expect(fill.fills.floor).toBe('tiles/floor-2x2')
    expect(fill.complete).toBe(true)
  })

  it('narrows nothing for a family whose size domain is empty', () => {
    /* B4 ships *any size* as an option carrying no tags at all, and 8 of its 51
       families have nothing else. An empty ref list must not read as a
       constraint — B3's third measured trap, and the one the brief names. */
    const { index, context } = harness(SIZED_RECORDS, { lock: 'openlock', size: [] })
    const template: AssemblyTemplate = {
      id: 'fixture-no-domain',
      tags: ['role|floor'],
      parts: [{ name: 'floor', tags: { require: [{ tag: 'shape|floor' }] } }],
    }
    const fill = solveTemplateFills(template, index, context)

    expect(fill.fills.floor).toBe('tiles/floor-1x1')
    expect(fill.decisions[0]?.candidates).toBe(2)
  })

  it('intersects the two size paths when a caller gives both', () => {
    const { index, context } = harness(SIZED_RECORDS, {
      lock: 'openlock',
      cell: { w: 2, d: 2 },
      size: ['size|width|1'],
    })
    const floor = solveTemplateFills(sizedTemplate, index, context).decisions.find(
      (one) => one.slot === 'floor',
    )

    /* `size|width|1` and `size|width|2` at once: the caller asked for an
       intersection and gets one, empty — reported, not silently preferred.

       And the gap is `no-candidate` rather than `closed-by-siblings`, because
       the cold re-resolution behind that classification carries the size too.
       That is the reading a user needs: *nothing in the archive is this size*,
       not *change an earlier choice*. No sibling could reopen it. */
    expect(floor?.tile).toBeUndefined()
    expect(floor?.gap).toBe('no-candidate')
  })

  it('reads the cell through the layout, so an unknown part-name set narrows nothing', () => {
    /* No convention for these part names, so no anchor, so no predicate. A
       template this project cannot lay out must not also become one it cannot
       fill — `rules.ts` returns `undefined` on purpose and this is the
       consequence. */
    const { index, context } = harness(SIZED_RECORDS, { lock: 'openlock', cell: { w: 2, d: 2 } })
    const template: AssemblyTemplate = {
      id: 'fixture-no-convention',
      tags: ['object|tile'],
      parts: [{ name: 'lintel', tags: { require: [{ tag: 'shape|floor' }] } }],
    }
    const fill = solveTemplateFills(template, index, context)

    expect(fill.fills.lintel).toBe('tiles/floor-1x1')
    expect(WALL_ON_TILE.parts).not.toContain('lintel')
    expect(EXTERNAL_CORNER.parts).not.toContain('lintel')
  })
})
