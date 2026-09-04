/**
 * The three authored conventions, and the key they hang on.
 *
 * These need no `catalog.json`: the 40 recipes ship as generated data in
 * `src/screens/assemblies/templates.ts`, so the classification claim — **the
 * part-name set is right on 40 of 40 and the template's own `shape|` tag is
 * wrong on 2** — is computable from the bundle alone and is asserted here rather
 * than in `corpus.test.ts`. What needs the archive is everything about *fills*,
 * and that is the other file.
 *
 * The internal consistency of the conventions is asserted as a **property**
 * wherever a property exists, because the alternative is restating the numbers
 * the table already carries. The two walls of an external corner being on
 * adjacent faces and the column being in the corner they share is a property; a
 * table saying `0`, `3`, `0` is not.
 */
import { describe, expect, it } from 'vitest'

/* Deep, not through the barrel: `@/screens/assemblies` also exports the React
   screen, and this file needs only the generated data. */
import { RECIPE_TEMPLATES } from '@/screens/assemblies/templates'

import type { SlotConvention, SlotName, SlotRule, SlotSide } from './rules'
import {
  EXTERNAL_CORNER,
  INTERNAL_CORNER,
  SLOT_CONVENTIONS,
  WALL_ON_TILE,
  conventionFor,
  layoutFor,
  partNameKey,
  ruleFor,
} from './rules'

/** The two faces a `corner`-anchored slot at `side` is flush against. */
function cornerFaces(side: SlotSide): readonly number[] {
  return [side, (side + 3) % 4].sort((a, b) => a - b)
}

const namesOf = (template: { parts: readonly { name: string }[] }): readonly SlotName[] =>
  template.parts.map((part) => part.name)

describe('the key a convention hangs on', () => {
  it('is the part-name set, so declaration order cannot change it', () => {
    /* The corner recipes really do declare `column` first and `base` last, so
       this is not hypothetical: an order-sensitive key would classify the four
       corner templates under a fourth, non-existent convention. */
    expect(namesOf(RECIPE_TEMPLATES[0] as { parts: readonly { name: string }[] })[0]).toBe('column')
    expect(partNameKey(['base', 'floor', 'wall'])).toBe(partNameKey(['wall', 'base', 'floor']))
    expect(conventionFor(['wall', 'floor', 'base'])).toBe(WALL_ON_TILE)
    expect(conventionFor(['base', 'floor', 'wall'])).toBe(WALL_ON_TILE)
  })

  it('cannot be confused by the two part names that contain a space', () => {
    // Under a space delimiter these two sets collide. Two of the six real part
    // names are `right wall` and `left wall`, so the ambiguity is reachable.
    expect(partNameKey(['left wall', 'right wall'])).not.toBe(
      partNameKey(['left', 'wall right', 'wall']),
    )
  })

  it('has no fallback, so an unknown part set is undefined rather than plausible', () => {
    expect(conventionFor(['floor'])).toBeUndefined()
    expect(conventionFor(['wall', 'floor', 'base', 'ceiling'])).toBeUndefined()
    expect(layoutFor([])).toBeUndefined()
  })
})

describe('the three conventions against the 40 shipped recipes', () => {
  it('classifies 40 of 40 on the part-name set', () => {
    const classified = RECIPE_TEMPLATES.filter((template) => conventionFor(namesOf(template)) !== undefined)
    expect(RECIPE_TEMPLATES).toHaveLength(40)
    expect(classified).toHaveLength(40)
  })

  it('covers the 40 in the measured 32 / 4 / 4 split, over 128 parts', () => {
    const byConvention = new Map<string, number>()
    let parts = 0
    for (const template of RECIPE_TEMPLATES) {
      const convention = conventionFor(namesOf(template))
      expect(convention).toBeDefined()
      byConvention.set(convention?.id ?? '', (byConvention.get(convention?.id ?? '') ?? 0) + 1)
      parts += template.parts.length
      /* Every part of every template has a rule, and every rule a part — the
         two directions are separate failures. A convention with a spare rule
         would place a slot the recipe has not got. */
      expect([...(convention?.slots ?? [])].map((slot) => slot.part).sort()).toEqual(
        [...namesOf(template)].sort(),
      )
    }
    expect(parts).toBe(128)
    expect(Object.fromEntries(byConvention)).toEqual({
      'wall-on-tile': 32,
      'external-corner': 4,
      'internal-corner': 4,
    })
  })

  it('is wrong on 2 of 40 if it keys on the template’s own shape tag instead', () => {
    /* The whole reason the key is the part-name set.
       `blueprints.s2w.internal_corner.yaml` and `.low.yaml` each carry one
       `Modular` entry tagged `shape|corner` rather than
       `shape|internal_corner`, and an internal corner has no wall parts at
       all — so a `shape|corner` key hands two internal corners the external
       corner's two-wall layout and then looks for `right wall` and `left wall`
       fills that cannot exist. Row **B6** files the fixture defect; this row
       works around it and measures the cost of not doing so. */
    const shapeTagOf = (template: { tags: readonly string[] }): string | undefined =>
      template.tags.find((tag) => tag.startsWith('shape|'))

    const byShapeTag = (tag: string | undefined): SlotConvention | undefined => {
      if (tag === undefined) return undefined
      if (tag.startsWith('shape|internal_corner')) return INTERNAL_CORNER
      if (tag.startsWith('shape|corner')) return EXTERNAL_CORNER
      if (tag.startsWith('shape|wall')) return WALL_ON_TILE
      return undefined
    }

    const wrong = RECIPE_TEMPLATES.filter(
      (template) => byShapeTag(shapeTagOf(template)) !== conventionFor(namesOf(template)),
    )
    expect(wrong).toHaveLength(2)
    expect(wrong.map((template) => template.source).sort()).toEqual([
      'blueprints.s2w.internal_corner.low.yaml',
      'blueprints.s2w.internal_corner.yaml',
    ])
    // Both are the `Modular` entries, and both really have no wall part.
    for (const template of wrong) {
      expect(template.name).toContain('Modular')
      expect(namesOf(template)).not.toContain('wall')
      expect(shapeTagOf(template)).toBe('shape|corner')
    }
  })

  it('gives the 128 parts 80 cell anchors, 40 edges and 8 corners', () => {
    const tally = { cell: 0, edge: 0, corner: 0 }
    for (const template of RECIPE_TEMPLATES) {
      for (const slot of conventionFor(namesOf(template))?.slots ?? []) tally[slot.anchor] += 1
    }
    /* The 80 / 48 split of the plan, from the other side: 80 parts are
       `cell`-anchored and derived — every `base` and every `floor` — and the 48
       that are not are exactly the 40 edges plus the 8 corners. */
    expect(tally).toEqual({ cell: 80, edge: 40, corner: 8 })
    expect(tally.edge + tally.corner).toBe(48)
  })
})

describe('each convention, as a property rather than a table', () => {
  const each = (assertion: (convention: SlotConvention) => void): void => {
    for (const convention of SLOT_CONVENTIONS) assertion(convention)
  }

  it('names a cell slot that is itself cell-anchored', () => {
    each((convention) => {
      const cell = ruleFor(convention, convention.cell)
      expect(cell, convention.id).toBeDefined()
      expect(cell?.anchor).toBe('cell')
    })
    /* `floor` on all three, and measured rather than chosen: the `floor` slot's
       candidates are rect on 2,996 of 2,996 files where the `base` slot's 25
       footprints include five `wall` runs. `corpus.test.ts` recomputes both. */
    expect(SLOT_CONVENTIONS.map((convention) => convention.cell)).toEqual(['floor', 'floor', 'floor'])
  })

  it('rests every slot on the ground through exactly one root', () => {
    each((convention) => {
      const roots = convention.slots.filter((slot) => slot.restsOn === null)
      expect(
        roots.map((slot) => slot.part),
        convention.id,
      ).toEqual(['base'])
      for (const slot of convention.slots) {
        if (slot.restsOn === null) continue
        expect(ruleFor(convention, slot.restsOn), `${convention.id}/${slot.part}`).toBeDefined()
      }
    })
  })

  it('is acyclic, and in dependency order so a renderer can walk it once', () => {
    each((convention) => {
      const placed = new Set<SlotName>()
      for (const slot of convention.slots) {
        if (slot.restsOn !== null) {
          expect(placed.has(slot.restsOn), `${convention.id}/${slot.part}`).toBe(true)
        }
        placed.add(slot.part)
      }
    })
  })

  it('ignores the side of every cell anchor by keeping it 0', () => {
    each((convention) => {
      for (const slot of convention.slots) {
        if (slot.anchor === 'cell') expect(slot.side, `${convention.id}/${slot.part}`).toBe(0)
      }
    })
  })
})

describe('the corner conventions, where the sides are not free', () => {
  const edgesOf = (convention: SlotConvention): readonly SlotRule[] =>
    convention.slots.filter((slot) => slot.anchor === 'edge')
  const cornersOf = (convention: SlotConvention): readonly SlotRule[] =>
    convention.slots.filter((slot) => slot.anchor === 'corner')

  it('puts an external corner’s two walls on adjacent faces', () => {
    const [right, left] = edgesOf(EXTERNAL_CORNER)
    expect(right?.part).toBe('right wall')
    expect(left?.part).toBe('left wall')
    const gap = ((left?.side ?? 0) - (right?.side ?? 0) + 4) % 4
    /* Adjacent, not opposite: a gap of 2 would be two parallel walls and the
       piece would not be a corner at all. */
    expect([1, 3]).toContain(gap)
  })

  it('puts an external corner’s column in the corner its two walls share', () => {
    const [column] = cornersOf(EXTERNAL_CORNER)
    expect(column?.part).toBe('column')
    /* The column's side is therefore *implied* by the walls' sides rather than
       authored separately — which is why the authored payload is three
       decisions and not five. */
    expect(cornerFaces(column?.side ?? 0)).toEqual(
      edgesOf(EXTERNAL_CORNER)
        .map((slot) => slot.side as number)
        .sort((a, b) => a - b),
    )
  })

  it('puts an internal corner’s column on the far diagonal, and gives it no wall', () => {
    expect(edgesOf(INTERNAL_CORNER)).toEqual([])
    const [inner] = cornersOf(INTERNAL_CORNER)
    const [outer] = cornersOf(EXTERNAL_CORNER)
    /* Re-entrant, defined relative to the external convention: an internal
       corner closes the gap an external corner leaves, so its column must sit
       on the opposite diagonal or the two do not meet at the same rotation.
       Two quarter-turns apart is exactly that, and it makes the two conventions
       one joint decision rather than two. */
    expect(((inner?.side ?? 0) - (outer?.side ?? 0) + 4) % 4).toBe(2)
  })

  it('gives the wall convention one edge and no corner', () => {
    expect(edgesOf(WALL_ON_TILE).map((slot) => slot.part)).toEqual(['wall'])
    expect(cornersOf(WALL_ON_TILE)).toEqual([])
  })
})
