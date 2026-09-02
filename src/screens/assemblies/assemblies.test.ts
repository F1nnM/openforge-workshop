/**
 * The headless model, on a fixture small enough to reason about by hand.
 *
 * ## What this file proves, and what it deliberately does not
 *
 * These are **semantics** tests. Every case here is a hand-built catalog of a
 * handful of records where the right answer is countable, so a failure names a
 * rule rather than a corpus. That is the only way to test narrowing at all: the
 * live archive's numbers are in `corpus.test.ts`, and a number is not a rule.
 *
 * What it cannot prove is that the rules are the *fixtures'* rules. That is
 * `corpus.test.ts`'s job in two halves — the round-trip against the 20 YAML files
 * and the census against `catalog.json` — and neither is available here, because
 * a fixture built to demonstrate narrowing would demonstrate it whatever the
 * archive holds. C1's `measure.ts` docblock makes the same distinction and it is
 * the reason both files exist.
 */
import { describe, expect, it } from 'vitest'

import type { TileId } from '@/catalog'

import type { RecipeTemplate } from './assembly'
import {
  STEP_PAGE,
  assemblyState,
  assemblyStepKey,
  createRecipeIndex,
  deadEndSentence,
  emptyStepSentence,
  narrowingSentence,
  resolvePart,
  stepCountSentence,
} from './assembly'
import { fixtureCatalog } from './catalogFixture'
import { RECIPE_TEMPLATES } from './templates'

const id = (value: string): TileId => value as TileId

/**
 * The narrowing case, in miniature.
 *
 * The template carries **no `size|` tag**, exactly as all 40 do not, and both its
 * parts constrain on `size|width`. So the `floor` part starts with every floor
 * in the fixture and keeps only the ones matching whatever width the `wall` pick
 * contributed. Three widths, one floor each at 2 and 4, two at 2 — so a 2 wall
 * narrows the floor from 4 to 2 and a 4 wall narrows it to 1.
 */
const NARROWING: RecipeTemplate = {
  id: 'narrowing',
  name: 'Narrowing',
  source: 'test',
  tags: ['object|tile', 'build|test'],
  parts: [
    {
      name: 'wall',
      tags: { require: [{ tag: 'shape|wall' }], constrain: [{ tag: 'size|width' }] },
      fulfills: [],
    },
    {
      name: 'floor',
      tags: { require: [{ tag: 'shape|floor' }], constrain: [{ tag: 'size|width' }] },
      fulfills: [],
    },
  ],
}

function narrowingCatalog() {
  return fixtureCatalog([
    { id: 'tiles/w2', ord: 1, design: 'w2', name: 'Wall 2', tags: ['shape|wall', 'size|width|2'] },
    { id: 'tiles/w4', ord: 2, design: 'w4', name: 'Wall 4', tags: ['shape|wall', 'size|width|4'] },
    { id: 'tiles/f2a', ord: 3, design: 'f2a', name: 'Floor 2 A', tags: ['shape|floor', 'size|width|2'] },
    { id: 'tiles/f2b', ord: 4, design: 'f2b', name: 'Floor 2 B', tags: ['shape|floor', 'size|width|2'] },
    { id: 'tiles/f4', ord: 5, design: 'f4', name: 'Floor 4', tags: ['shape|floor', 'size|width|4'] },
    { id: 'tiles/f6', ord: 6, design: 'f6', name: 'Floor 6', tags: ['shape|floor', 'size|width|6'] },
  ])
}

describe('progressive narrowing', () => {
  it('offers every candidate before anything is chosen', () => {
    const recipes = createRecipeIndex(narrowingCatalog())
    const state = assemblyState(recipes, NARROWING)

    expect(state.steps.map((step) => step.name)).toEqual(['wall', 'floor'])
    expect(state.steps[0]?.options).toHaveLength(2)
    expect(state.steps[1]?.options).toHaveLength(4)
    // Nothing has narrowed yet, so there is no "down from" to state.
    expect(state.steps[1]?.narrowedFrom).toBeUndefined()
    expect(state.filled).toBe(0)
    expect(state.complete).toBe(false)
    expect(state.next).toBe('wall')
  })

  it('narrows the other part once one is chosen, and says what it narrowed from', () => {
    const recipes = createRecipeIndex(narrowingCatalog())
    const state = assemblyState(recipes, NARROWING, { wall: id('tiles/w2') })
    const floor = state.steps.find((step) => step.name === 'floor')

    expect(floor?.candidates).toBe(2)
    expect(floor?.narrowedFrom).toBe(4)
    expect(floor?.options.map((option) => option.aggregate.name)).toEqual(['Floor 2 A', 'Floor 2 B'])
    expect(stepCountSentence(floor as never)).toContain('Narrowed from 4')
  })

  it('narrows differently for a different pick — the point of resolving at selection time', () => {
    const recipes = createRecipeIndex(narrowingCatalog())
    const four = assemblyState(recipes, NARROWING, { wall: id('tiles/w4') })

    expect(four.steps.find((step) => step.name === 'floor')?.candidates).toBe(1)
  })

  it('states the narrowing on the card, before it is pressed', () => {
    const recipes = createRecipeIndex(narrowingCatalog())
    const wall = assemblyState(recipes, NARROWING).steps[0]
    const two = wall?.options.find((option) => option.aggregate.name === 'Wall 2')

    expect(two?.narrows).toEqual([{ part: 'floor', from: 4, to: 2 }])
    expect(narrowingSentence(two as never)).toBe('Narrows floor 4 to 2.')
    expect(two?.deadEnd).toBe(false)
  })

  it('completes when every part is answered, and bills the chosen files in step order', () => {
    const recipes = createRecipeIndex(narrowingCatalog())
    const state = assemblyState(recipes, NARROWING, {
      wall: id('tiles/w2'),
      floor: id('tiles/f2b'),
    })

    expect(state.complete).toBe(true)
    expect(state.filled).toBe(2)
    expect(state.next).toBeUndefined()
    expect(state.tiles).toEqual(['tiles/w2', 'tiles/f2b'])
  })
})

describe('dead ends', () => {
  it('greys a pick that would empty another part, and says which', () => {
    // A width-6 wall exists; no width-6 floor does. So picking it closes `floor`.
    const recipes = createRecipeIndex(
      fixtureCatalog([
        { id: 'tiles/w6', ord: 1, design: 'w6', name: 'Wall 6', tags: ['shape|wall', 'size|width|6'] },
        { id: 'tiles/w2', ord: 2, design: 'w2', name: 'Wall 2', tags: ['shape|wall', 'size|width|2'] },
        { id: 'tiles/f2', ord: 3, design: 'f2', name: 'Floor 2', tags: ['shape|floor', 'size|width|2'] },
      ]),
    )
    const wall = assemblyState(recipes, NARROWING).steps[0]
    const six = wall?.options.find((option) => option.aggregate.name === 'Wall 6')
    const two = wall?.options.find((option) => option.aggregate.name === 'Wall 2')

    expect(six?.deadEnd).toBe(true)
    expect(six?.empties).toEqual(['floor'])
    expect(deadEndSentence(six as never)).toBe('Leaves the floor part with nothing to fill it.')
    expect(two?.deadEnd).toBe(false)
  })

  it('names the base part separately, because a recipe cannot be printed without one', () => {
    const template: RecipeTemplate = {
      ...NARROWING,
      parts: [
        NARROWING.parts[0] as never,
        {
          name: 'base',
          tags: { require: [{ tag: 'shape|base' }], constrain: [{ tag: 'size|width' }] },
          fulfills: [],
        },
      ],
    }
    const recipes = createRecipeIndex(
      fixtureCatalog([
        { id: 'tiles/w6', ord: 1, design: 'w6', name: 'Wall 6', tags: ['shape|wall', 'size|width|6'] },
        { id: 'tiles/b2', ord: 2, design: 'b2', name: 'Base 2', tags: ['shape|base', 'size|width|2'] },
      ]),
    )
    const six = assemblyState(recipes, template).steps[0]?.options[0]

    expect(deadEndSentence(six as never)).toBe('Leaves no base this recipe can be printed on.')
  })

  it('tells a part nothing fits apart from one asking for a tag the index lacks', () => {
    const template: RecipeTemplate = {
      ...NARROWING,
      parts: [
        {
          name: 'wall',
          tags: { require: [{ tag: 'shape|nonesuch' }] },
          fulfills: [],
        },
      ],
    }
    const recipes = createRecipeIndex(
      fixtureCatalog([{ id: 'tiles/f2', ord: 1, design: 'f2', tags: ['shape|floor'] }]),
    )
    const step = assemblyState(recipes, template).steps[0]

    expect(step?.deadEnd).toBe(true)
    expect(step?.unknownRefs).toEqual(['shape|nonesuch'])
    expect(emptyStepSentence(step as never)).toContain('holds no such tag')
  })

  it('prefers the variant of an item that closes nothing, when they disagree', () => {
    /*
      One item, two files: a width-2 print and a width-6 one. Only the 2 leaves
      the floor fillable. The card must not be greyed — half of it works — and it
      must contribute the half that does. 87 cards in the real corpus are like
      this; C2 measured 0 on tile parents.
    */
    const recipes = createRecipeIndex(
      fixtureCatalog([
        { id: 'tiles/w-a', ord: 1, design: 'w', name: 'Wall', tags: ['shape|wall', 'size|width|6'] },
        { id: 'tiles/w-b', ord: 2, design: 'w', name: 'Wall', tags: ['shape|wall', 'size|width|2'] },
        { id: 'tiles/f2', ord: 3, design: 'f2', tags: ['shape|floor', 'size|width|2'] },
      ]),
    )
    const card = assemblyState(recipes, NARROWING).steps[0]?.options[0]

    expect(card?.tiles).toHaveLength(2)
    expect(card?.deadEnd).toBe(false)
    expect(card?.variant.id).toBe('tiles/w-b')
    expect(card?.narrows).toEqual([])
  })
})

describe('fulfills, part level — nested scope', () => {
  const template: RecipeTemplate = {
    id: 'nested',
    name: 'Nested',
    source: 'test',
    tags: ['object|tile'],
    parts: [
      { name: 'wall', tags: { require: [{ tag: 'shape|wall' }] }, fulfills: ['base'] },
      { name: 'base', tags: { require: [{ tag: 'shape|base' }] }, fulfills: [] },
    ],
  }

  function catalog() {
    return fixtureCatalog([
      {
        id: 'tiles/w',
        ord: 1,
        design: 'w',
        name: 'Wall',
        tags: ['shape|wall'],
        config: {
          parts: [
            { name: 'base', tags: { require: [{ tag: 'shape|base' }] } },
            { name: 'torch', tags: { require: [{ tag: 'component|torch' }] } },
          ],
        },
      },
      { id: 'tiles/b', ord: 2, design: 'b', name: 'Base', tags: ['shape|base'] },
    ])
  }

  it('hides the chosen file’s own base slot, and keeps its other slots', () => {
    const state = assemblyState(createRecipeIndex(catalog()), template, { wall: id('tiles/w') })
    const wall = state.steps[0]

    expect(wall?.covered).toEqual(['base'])
    expect(wall?.nested.map((slot) => slot.name)).toEqual(['torch'])
  })

  it('does **not** satisfy the sibling base part — the spec scopes it to children', () => {
    const state = assemblyState(createRecipeIndex(catalog()), template, { wall: id('tiles/w') })
    const base = state.steps.find((step) => step.name === 'base')

    expect(base?.coveredBy).toBeUndefined()
    expect(base?.options).toHaveLength(1)
    expect(state.complete).toBe(false)
  })
})

describe('fulfills, blueprint level — sibling scope', () => {
  const corner: RecipeTemplate = {
    id: 'corner',
    name: 'Corner',
    source: 'test',
    tags: ['object|tile'],
    parts: [
      { name: 'column', tags: { require: [{ tag: 'shape|column' }] }, fulfills: [] },
      { name: 'right wall', tags: { require: [{ tag: 'shape|wall' }] }, fulfills: [] },
      { name: 'floor', tags: { require: [{ tag: 'shape|floor' }] }, fulfills: [] },
    ],
  }

  function catalog() {
    return fixtureCatalog([
      { id: 'tiles/col', ord: 1, design: 'col', name: 'Column', tags: ['shape|column'] },
      {
        id: 'tiles/grate',
        ord: 2,
        design: 'grate',
        name: 'Widened Grate',
        tags: ['shape|wall'],
        // The spec's own worked example: an integrated piece standing in for a
        // structural part. 21 records in the archive carry one.
        config: { fulfills: [{ part: 'column' }] },
      },
      { id: 'tiles/plain', ord: 3, design: 'plain', name: 'Plain Wall', tags: ['shape|wall'] },
      { id: 'tiles/f', ord: 4, design: 'f', name: 'Floor', tags: ['shape|floor'] },
    ])
  }

  it('takes the covered part out of the flow entirely', () => {
    const state = assemblyState(createRecipeIndex(catalog()), corner, {
      'right wall': id('tiles/grate'),
    })
    const column = state.steps.find((step) => step.name === 'column')

    expect(column?.coveredBy).toBe('right wall')
    expect(column?.options).toEqual([])
    expect(column?.deadEnd).toBe(false)
    // Two of three parts answered by one pick: the grate is the column too.
    expect(state.filled).toBe(2)
    expect(state.next).toBe('floor')
  })

  it('completes without a pick for the covered part, and bills only what prints', () => {
    const state = assemblyState(createRecipeIndex(catalog()), corner, {
      'right wall': id('tiles/grate'),
      floor: id('tiles/f'),
    })

    expect(state.complete).toBe(true)
    expect(state.tiles).toEqual(['tiles/grate', 'tiles/f'])
  })

  it('reports a now-redundant choice rather than silently deselecting it', () => {
    const state = assemblyState(createRecipeIndex(catalog()), corner, {
      column: id('tiles/col'),
      'right wall': id('tiles/grate'),
      floor: id('tiles/f'),
    })
    const column = state.steps.find((step) => step.name === 'column')

    expect(column?.redundant).toBe(true)
    expect(column?.chosen).toBe('tiles/col')
    expect(state.redundant).toEqual(['column'])
    // The column is not printed: the grate already includes it.
    expect(state.tiles).toEqual(['tiles/grate', 'tiles/f'])
    expect(state.complete).toBe(true)
  })

  it('does nothing when the wrong part is filled with the fulfilling file', () => {
    const state = assemblyState(createRecipeIndex(catalog()), corner, {
      'right wall': id('tiles/plain'),
    })

    expect(state.steps.every((step) => step.coveredBy === undefined)).toBe(true)
  })
})

describe('the step key', () => {
  it('is the template and the part name, delimited by a byte neither can hold', () => {
    expect(assemblyStepKey(NARROWING, 'left wall')).toBe('narrowing\u0000left wall')
  })

  it('distinguishes the same part name on two recipes', () => {
    const other: RecipeTemplate = { ...NARROWING, id: 'other' }
    expect(assemblyStepKey(NARROWING, 'floor')).not.toBe(assemblyStepKey(other, 'floor'))
  })

  it('is total over the shipped templates, so no aggregate key is needed', () => {
    const keys = RECIPE_TEMPLATES.flatMap((template) =>
      template.parts.map((part) => assemblyStepKey(template, part.name)),
    )
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('resolvePart', () => {
  it('reads the parent template’s tags, not the archive’s', () => {
    // The template contributes `build|test`; the part constrains on it. Only the
    // record carrying that tag can fill the part, with no sibling involved.
    const template: RecipeTemplate = {
      id: 'parent',
      name: 'Parent',
      source: 'test',
      tags: ['build|test'],
      parts: [
        {
          name: 'wall',
          tags: { require: [{ tag: 'shape|wall' }], constrain: [{ tag: 'build' }] },
          fulfills: [],
        },
      ],
    }
    const catalog = fixtureCatalog([
      { id: 'tiles/a', ord: 1, design: 'a', tags: ['shape|wall', 'build|test'] },
      { id: 'tiles/b', ord: 2, design: 'b', tags: ['shape|wall', 'build|other'] },
    ])
    const recipes = createRecipeIndex(catalog)

    expect(resolvePart(recipes.composition, template, template.parts[0] as never, {}).tiles).toEqual([
      'tiles/a',
    ])
  })
})

describe('the shipped templates', () => {
  it('are 40, over 20 fixture files, with 128 parts', () => {
    expect(RECIPE_TEMPLATES).toHaveLength(40)
    expect(new Set(RECIPE_TEMPLATES.map((template) => template.source)).size).toBe(20)
    expect(RECIPE_TEMPLATES.reduce((total, template) => total + template.parts.length, 0)).toBe(128)
  })

  it('carry unique names and unique slugs', () => {
    expect(new Set(RECIPE_TEMPLATES.map((template) => template.name)).size).toBe(40)
    expect(new Set(RECIPE_TEMPLATES.map((template) => template.id)).size).toBe(40)
  })

  it('split 20 and 20 between the two build kinds, which is what the screen groups on', () => {
    const single = RECIPE_TEMPLATES.filter((template) =>
      template.tags.includes('build|s2w|single_piece'),
    )
    const modular = RECIPE_TEMPLATES.filter((template) => template.tags.includes('build|s2w|modular'))

    expect(single).toHaveLength(20)
    expect(modular).toHaveLength(20)
    expect(single.length + modular.length).toBe(RECIPE_TEMPLATES.length)
  })

  it('carry the two grammar features the JSON corpus never uses', () => {
    const parts = RECIPE_TEMPLATES.flatMap((template) => template.parts)
    const siblings = parts
      .flatMap((part) => part.tags.constrain ?? [])
      .filter((entry) => 'tag' in entry && entry.siblings !== undefined)

    expect(siblings).toHaveLength(30)
    expect(parts.flatMap((part) => part.fulfills)).toEqual(Array.from({ length: 20 }, () => 'base'))
  })

  it('share no tag root with their own constrain entries, which is why they narrow', () => {
    const root = (tag: string): string => tag.split('|')[0] ?? tag
    const own = new Set(RECIPE_TEMPLATES.flatMap((template) => template.tags).map(root))
    const constrained = new Set(
      RECIPE_TEMPLATES.flatMap((template) => template.parts)
        .flatMap((part) => part.tags.constrain ?? [])
        .flatMap((entry) => ('tag' in entry ? [entry.tag] : []))
        .map(root),
    )

    expect([...own].sort()).toEqual(['build', 'component', 'object', 'shape'])
    expect([...constrained].sort()).toEqual(['connection', 'size'])
    expect([...own].filter((value) => constrained.has(value))).toEqual([])
  })
})

describe('the page size', () => {
  it('is a multiple of every column count the grid can lay out', () => {
    // `assemblies.css` is `auto-fill, minmax(150px, 1fr)`, so 2 to 7 columns at
    // real widths. A page that divides by all of them never leaves one orphan
    // card on the last row of a full page.
    for (const columns of [2, 3, 4, 6]) expect(STEP_PAGE % columns).toBe(0)
  })
})
