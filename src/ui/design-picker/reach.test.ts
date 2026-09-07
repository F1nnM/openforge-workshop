/**
 * The design reach derivation, over a fixture whose figures are nothing like the
 * archive's.
 *
 * Four designs and eight records, deliberately: if `36`, `139`, `120` or
 * `dungeon_stone` ever appears in an assertion here, something has hard-coded a
 * figure that is supposed to be measured. That is the failure mode
 * `lock-picker/lockToggle.test.tsx` was written to catch one preference over,
 * and it is sharper here — the reach figures move with **both** the archive and
 * the template table, so there are two ways for a constant to go stale.
 *
 * `corpus.test.ts` beside this file is where the real numbers are recomputed and
 * where the cold bound is checked against C2's solver.
 */
import { describe, expect, it } from 'vitest'

import { buildAggregateIndex } from '@/catalog'
import type { AssemblyIndex, AssemblyTemplate } from '@/assembly'
import { buildAssemblyIndex } from '@/assembly'
import type { CompositionIndex } from '@/composition'
import { createCompositionIndex } from '@/composition'
import type { FillFixtureRecord } from '@/template/fixture'
import { fillFixture } from '@/template/fixture'

import { deriveDesignReach, designLabel, designOf } from './reach'

/* ------------------------------------------------------------------ fixture */

/**
 * Four designs over eight records.
 *
 * | design      | wall | floor | base | reaches (of 2 non-base parts) |
 * | ----------- | :--: | :---: | :--: | ----------------------------: |
 * | `slate`     |  ✓   |   ✓   |      | 2 |
 * | `bark-wood` |  ✓   |       |      | 1 |
 * | `mosaic`    |      |   ✓   |      | 1 |
 * | `plain`     |      |       |  ✓   | 0 |
 * | `driftwood` |      |       |      | 0 — an accessory nothing can place |
 *
 * `plain` and `driftwood` are the two ways a design can reach nothing and they
 * are different: `plain` is on the base slot, which is excluded from the count
 * by design, and `driftwood` is on a record no part admits at all. Both must
 * end up unoffered, and `unreached` must count both.
 *
 * `bark-wood` is hyphenated and `mosaic` is one word, so {@link designLabel} is
 * exercised on the two spellings the archive actually contains.
 */
const RECORDS: readonly FillFixtureRecord[] = [
  { id: 'tiles/wall.slate', design: 'wall-slate', tags: ['shape|wall'], texture: 'slate' },
  { id: 'tiles/wall.slate.b', design: 'wall-slate-b', tags: ['shape|wall'], texture: 'slate' },
  { id: 'tiles/wall.bark', design: 'wall-bark', tags: ['shape|wall'], texture: 'bark-wood' },
  { id: 'tiles/floor.slate', design: 'floor-slate', tags: ['shape|floor'], texture: 'slate' },
  { id: 'tiles/floor.mosaic', design: 'floor-mosaic', tags: ['shape|floor'], texture: 'mosaic' },
  { id: 'tiles/base.plain', design: 'base-plain', layer: 'base', tags: ['shape|base'], texture: 'plain' },
  { id: 'tiles/decor.drift', design: 'decor-drift', tags: ['shape|decor'], texture: 'driftwood' },
  { id: 'tiles/untextured', design: 'untextured', tags: ['shape|wall'] },
]

/** `wall` / `floor` / `base` — the part-name set `rules.ts` reads as a modular tile. */
const TEMPLATE: AssemblyTemplate = {
  id: 'fixture-wall',
  tags: ['object|tile'],
  parts: [
    { name: 'wall', tags: { require: [{ tag: 'shape|wall' }] } },
    { name: 'floor', tags: { require: [{ tag: 'shape|floor' }] } },
    { name: 'base', tags: { require: [{ tag: 'shape|base' }] } },
  ],
}

/** A one-slot family, which is the shape all 51 of B4's generated families have. */
const ONE_SLOT: AssemblyTemplate = {
  id: 'fixture-floor-only',
  tags: ['object|tile'],
  parts: [{ name: 'floor', tags: { require: [{ tag: 'shape|floor' }] } }],
}

function indexes(): { index: AssemblyIndex; composition: CompositionIndex } {
  const file = fillFixture(RECORDS)
  return { index: buildAssemblyIndex(file), composition: createCompositionIndex(file, buildAggregateIndex(file)) }
}

/* ------------------------------------------------------------------- labels */

describe('designLabel', () => {
  it('reads a tag root as a sentence', () => {
    expect(designLabel('dungeon_stone')).toBe('Dungeon stone')
    expect(designLabel('cut-stone')).toBe('Cut stone')
    expect(designLabel('aztlan')).toBe('Aztlan')
  })

  it('does not title-case, so a tag’s own words stay its words', () => {
    // `mortar_and_stone` is a real root, and "Mortar And Stone" would capitalise
    // a conjunction the tag author wrote in lower case.
    expect(designLabel('mortar_and_stone')).toBe('Mortar and stone')
  })

  it('answers for a root it has never seen, which is the whole reason it is a function', () => {
    // A frozen table would render this raw, and a raw tag on screen reads as a
    // bug rather than as a material the archive has just gained.
    expect(designLabel('brand_new_root')).toBe('Brand new root')
  })
})

/* --------------------------------------------------------------- the reach */

describe('deriveDesignReach', () => {
  it('counts the parts a design can reach, and offers nothing else', () => {
    const { index, composition } = indexes()

    const reach = deriveDesignReach([TEMPLATE], index, composition)

    expect(reach.totalParts).toBe(2)
    expect(reach.baseSlots).toBe(1)
    expect(reach.entries.map((entry) => [entry.family, entry.parts])).toEqual([
      ['slate', 2],
      ['bark-wood', 1],
      ['mosaic', 1],
    ])
    // `plain` reaches only the base and `driftwood` reaches nothing at all, so
    // neither is offered — choosing either could not change a fill.
    expect(reach.entries.map((entry) => entry.family)).not.toContain('plain')
    expect(reach.entries.map((entry) => entry.family)).not.toContain('driftwood')
    expect(reach.unreached).toBe(2)
  })

  it('orders by reach and then by label, so a tie is not the declaration order', () => {
    const { index, composition } = indexes()

    const reach = deriveDesignReach([TEMPLATE], index, composition)

    // `bark-wood` and `mosaic` both reach one part. Without the label tie-break
    // the order would be whichever template declared its part first, which is a
    // fact about the recipe table rather than about the designs.
    expect(reach.entries.slice(1).map((entry) => entry.label)).toEqual(['Bark wood', 'Mosaic'])
  })

  it('counts a part once per template, so two templates are two chances', () => {
    const { index, composition } = indexes()

    const reach = deriveDesignReach([TEMPLATE, ONE_SLOT], index, composition)

    // Three non-base parts now: the modular tile's wall and floor, and the
    // one-slot family's floor. `slate` is in all three.
    expect(reach.totalParts).toBe(3)
    expect(designOf(reach, 'slate')?.parts).toBe(3)
    expect(designOf(reach, 'mosaic')?.parts).toBe(2)
  })

  it('has no base slot for a template with no layout', () => {
    const { index, composition } = indexes()

    const reach = deriveDesignReach([ONE_SLOT], index, composition)

    // Read off B2's layout rather than off the name `base`: a one-slot family
    // has no layout, so nothing rests on anything and there is no base slot to
    // exclude. That is correct rather than a fallback.
    expect(reach.baseSlots).toBe(0)
    expect(reach.basesInDesign).toBe(0)
    expect(reach.totalParts).toBe(1)
  })

  it('counts the base slots that could honour a design at all', () => {
    const { index, composition } = indexes()

    // Every base in this fixture is `plain`, exactly as 38 of the archive's 40
    // base slots are — so no base slot has a design to prefer.
    expect(deriveDesignReach([TEMPLATE], index, composition).basesInDesign).toBe(0)
  })

  it('notices a base slot that does have a design, so the exclusion can stop being right', () => {
    const file = fillFixture([
      ...RECORDS,
      { id: 'tiles/base.slate', design: 'base-slate', layer: 'base', tags: ['shape|base'], texture: 'slate' },
    ])
    const index = buildAssemblyIndex(file)
    const composition = createCompositionIndex(file, buildAggregateIndex(file))

    const reach = deriveDesignReach([TEMPLATE], index, composition)

    expect(reach.basesInDesign).toBe(1)
    // And it is still not in the parts count: the base is decided by row A3's
    // ladder, in which the design is only the tie-break under five criteria.
    expect(designOf(reach, 'slate')?.parts).toBe(2)
  })

  it('shares the denominator across every entry, so the bars are comparable', () => {
    const { index, composition } = indexes()

    const reach = deriveDesignReach([TEMPLATE], index, composition)

    for (const entry of reach.entries) {
      expect(entry.share).toBeCloseTo(entry.parts / reach.totalParts, 10)
    }
  })

  it('reports the items with no design as a population rather than dropping them', () => {
    const { index, composition } = indexes()

    // One record carries no texture tag, which is the archive's 89 records / 44
    // items in miniature. A design preference can never reach them.
    expect(deriveDesignReach([TEMPLATE], index, composition).untextured).toBe(1)
  })

  it('counts items in the archive rather than in the candidate pools', () => {
    const { index, composition } = indexes()

    // `slate` is two walls and a floor — three items — where its *reach* is two
    // parts. The two columns answer different questions, which is why both are
    // on the row.
    expect(designOf(deriveDesignReach([TEMPLATE], index, composition), 'slate')?.items).toBe(3)
  })

  it('answers for no templates at all without dividing by zero', () => {
    const { index, composition } = indexes()

    const reach = deriveDesignReach([], index, composition)

    expect(reach.entries).toEqual([])
    expect(reach.totalParts).toBe(0)
    expect(reach.unreached).toBe(reach.roots)
  })
})

describe('designOf', () => {
  it('answers undefined for no design, for an unreached one, and for no figures', () => {
    const { index, composition } = indexes()
    const reach = deriveDesignReach([TEMPLATE], index, composition)

    expect(designOf(reach, undefined)).toBeUndefined()
    // A design the archive has but this build cannot use, and a design the
    // archive does not have. Both are *no figures for this design*, and a
    // surface renders them the same way.
    expect(designOf(reach, 'driftwood')).toBeUndefined()
    expect(designOf(reach, 'cut_stone')).toBeUndefined()
    expect(designOf(null, 'slate')).toBeUndefined()
  })
})
