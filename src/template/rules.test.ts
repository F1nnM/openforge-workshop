/**
 * The four authored conventions, and the key they hang on.
 *
 * These need no `catalog.json`: the 42 recipes ship as generated data in
 * `src/screens/assemblies/templates.ts`, so the classification claim — **the
 * part-name set is right on 42 of 42 and the template's own `shape|` tag is
 * wrong on 2 of the 40 fixtures** — is computable from the bundle alone and is
 * asserted here rather than in `corpus.test.ts`. What needs the archive is
 * everything about *fills*, and that is the other file.
 *
 * The internal consistency of the conventions is asserted as a **property**
 * wherever a property exists, because the alternative is restating the numbers
 * the table already carries. The two walls of an external corner being on
 * adjacent faces and the column being in the corner they share is a property; a
 * table saying `0`, `3`, `0` is not. Row **E3**'s corridor adds the one property
 * the other three do not need: its two walls are **opposite**, which is what
 * makes it not a corner.
 *
 * ## 42, and the two that are not fixtures
 *
 * Row E3 authored two assemblies in this repo — a wall recipe whose floor slot is
 * widened off the shipped `(Any, Modular)` one, and the corridor — and
 * `pipeline/authored.ts` says why they are `RECIPE_TEMPLATES` entries rather than
 * a third export. They are distinguishable by `source`, and the measurements
 * below that are claims about *the fixtures* use {@link FIXTURE_RECIPES} while
 * the ones that are claims about *the layout model* use all 42. Which is which is
 * the point: `conventionFor` classifying 42 of 42 is the model's business, and
 * two internal corners carrying `shape|corner` is upstream's.
 */
import { describe, expect, it } from 'vitest'

/* Deep, not through the barrel: `@/screens/assemblies` also exports the React
   screen, and this file needs only the generated data. */
import { RECIPE_TEMPLATES } from '@/screens/assemblies/templates'

import type { SlotConvention, SlotName, SlotRule, SlotSide } from './rules'
import {
  CORRIDOR,
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

/**
 * The 40 read from the fixtures, without row E3's two.
 *
 * The prefix is `pipeline/authored.ts#AUTHORED_SOURCE_PREFIX`, spelled here
 * rather than imported: that module is in the node project and this file is in
 * the app project, the same boundary `corpus.test.ts` writes `PAYLOAD_TIMESTAMP`
 * across, and a drift shows up as a count that no longer matches.
 */
const FIXTURE_RECIPES = RECIPE_TEMPLATES.filter((template) => !template.source.startsWith('authored:'))

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
    /* The corridor's set minus one wall is the shape D10 §8 was right about and
       generalised wrongly from: `(wall, base)` has no cell, so no edge, so no
       closure — and no convention either. */
    expect(conventionFor(['base', 'floor', 'left wall'])).toBeUndefined()
  })

  it('tells the corridor from the external corner on the part set alone', () => {
    /* The two are one part apart — the corner's column — and they are the only
       two conventions in the table whose sets are in a subset relation. A key
       that dropped the column would hand a corridor the corner's mitred layout. */
    expect(conventionFor(['base', 'floor', 'left wall', 'right wall'])).toBe(CORRIDOR)
    expect(conventionFor(['base', 'column', 'floor', 'left wall', 'right wall'])).toBe(EXTERNAL_CORNER)
  })
})

describe('the four conventions against the 42 shipped recipes', () => {
  it('classifies 42 of 42 on the part-name set, of which 40 are the fixtures’', () => {
    const classified = RECIPE_TEMPLATES.filter((template) => conventionFor(namesOf(template)) !== undefined)
    expect(RECIPE_TEMPLATES).toHaveLength(42)
    expect(classified).toHaveLength(42)
    expect(FIXTURE_RECIPES).toHaveLength(40)
  })

  it('covers the 42 in the measured 33 / 4 / 4 / 1 split, over 135 parts', () => {
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
    /* 128 fixture parts, plus row E3's 3 + 4. The widened wall is a
       `wall-on-tile` — its layout is the shipped recipe's and only its floor
       slot's admissions differ — so the corridor is the only member of the
       fourth convention in the whole build. */
    expect(parts).toBe(135)
    expect(Object.fromEntries(byConvention)).toEqual({
      'wall-on-tile': 33,
      'external-corner': 4,
      'internal-corner': 4,
      corridor: 1,
    })
  })

  it('is wrong on 2 of the 40 fixtures if it keys on the template’s own shape tag instead', () => {
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

    /* Over the fixtures, because the claim is about **upstream's** tags: row
       E3's corridor carries `shape|hallway`, which no tag-keyed rule has ever had
       a branch for, and counting it here would inflate a census that exists to
       measure a defect in another repository. */
    const wrong = FIXTURE_RECIPES.filter(
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

  it('gives the 135 parts 84 cell anchors, 43 edges and 8 corners', () => {
    const tally = { cell: 0, edge: 0, corner: 0 }
    for (const template of RECIPE_TEMPLATES) {
      for (const slot of conventionFor(namesOf(template))?.slots ?? []) tally[slot.anchor] += 1
    }
    /* The 80 / 48 split of the plan, from the other side, plus row E3's 7: 84
       parts are `cell`-anchored and derived — every `base` and every `floor` —
       and the 51 that are not are exactly the 43 edges plus the 8 corners. The
       corridor adds **two** edges to one template, which no shipped recipe does
       and which is the whole of what is new about it. */
    expect(tally).toEqual({ cell: 84, edge: 43, corner: 8 })
    expect(tally.edge + tally.corner).toBe(51)

    // The fixtures' own share is unmoved, which is what says E3 appended.
    const fixtures = { cell: 0, edge: 0, corner: 0 }
    for (const template of FIXTURE_RECIPES) {
      for (const slot of conventionFor(namesOf(template))?.slots ?? []) fixtures[slot.anchor] += 1
    }
    expect(fixtures).toEqual({ cell: 80, edge: 40, corner: 8 })
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
    /* `floor` on all four, and measured rather than chosen: the `floor` slot's
       candidates are rect on 2,996 of 2,996 files where the `base` slot's 25
       footprints include five `wall` runs. `corpus.test.ts` recomputes both. */
    expect(SLOT_CONVENTIONS.map((convention) => convention.cell)).toEqual([
      'floor',
      'floor',
      'floor',
      'floor',
    ])
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

describe('the corner conventions and the corridor, where the sides are not free', () => {
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

  it('puts the corridor’s two walls on **opposite** faces, which is what makes it not a corner', () => {
    /* Row **E3**'s one assertion the other three conventions do not need. A gap
       of 1 or 3 is {@link EXTERNAL_CORNER} without its column — adjacent walls
       meeting at a mitre nobody has measured — and a gap of 0 is two walls on one
       face. Two quarter-turns is the shape, and the *only* shape. */
    const [right, left] = edgesOf(CORRIDOR)
    expect(right?.part).toBe('right wall')
    expect(left?.part).toBe('left wall')
    expect(((left?.side ?? 0) - (right?.side ?? 0) + 4) % 4).toBe(2)

    /* And it has no `corner` slot at all, which is why it needs none of the
       repair `offsets.ts#cornerReservation` wants for a face flanked by two
       corners: with no corner-anchored sibling the reservation is 0 on all four
       faces, exactly as it is on all 40 `wall-on-tile` edges. */
    expect(cornersOf(CORRIDOR)).toEqual([])
  })

  it('keeps the corridor’s chirality consistent with the external corner’s', () => {
    /* Which of the two walls is *right* is the one positional thing the corpus
       carries — `shape|corner|right` / `left`, 133 tiles each — and it carries a
       mirror class rather than a mapping to a face. So the assignment is authored,
       and the only thing available to be consistent with is the convention that
       already made it: `right wall` takes side 0 on both. */
    const [cornerRight] = edgesOf(EXTERNAL_CORNER)
    const [corridorRight] = edgesOf(CORRIDOR)
    expect(cornerRight?.part).toBe('right wall')
    expect(corridorRight?.part).toBe('right wall')
    expect(corridorRight?.side).toBe(cornerRight?.side)
  })

  it('is the only convention whose two edges eat one axis', () => {
    /* The property `offsets.ts`'s `no-walk` doubt exists for, stated where the
       conventions are: an opposed pair of edges takes from the same axis of the
       cell, and until the corridor no layout had one. This is also why **0 of the
       1,215 walked combinations of the 40 fixtures** can reach that doubt. */
    const opposedPairs = (convention: SlotConvention): number => {
      const sides = new Set(edgesOf(convention).map((slot) => slot.side))
      return [
        [0, 2],
        [1, 3],
      ].filter(([a, b]) => sides.has(a as SlotSide) && sides.has(b as SlotSide)).length
    }
    expect(SLOT_CONVENTIONS.map(opposedPairs)).toEqual([0, 0, 0, 1])
  })
})
