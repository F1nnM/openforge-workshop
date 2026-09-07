/**
 * The three authored conventions, and the key they hang on.
 *
 * These need no `catalog.json`: the 40 recipes ship as generated data in
 * `src/screens/assemblies/templates.ts`, so the classification claim — **the
 * part-name set is right on 40 of 40 and the template's own `shape|` tag is
 * wrong on 2 of them** — is computable from the bundle alone and is asserted
 * here rather than in `corpus.test.ts`. What needs the archive is everything
 * about *fills*, and that is the other file.
 *
 * The internal consistency of the conventions is asserted as a **property**
 * wherever a property exists, because the alternative is restating the numbers
 * the table already carries. The two walls of an external corner being on
 * adjacent faces and the column being in the corner they share is a property; a
 * table saying `0`, `3`, `0` is not.
 *
 * ## 40, and the two rows that are gone
 *
 * Row E3 authored two assemblies in this repo — a wall recipe whose floor slot
 * was widened off the shipped `(Any, Modular)` one, and a corridor — and both
 * have been withdrawn along with `pipeline/authored.ts` and the `CORRIDOR`
 * convention. `rules.ts#SLOT_CONVENTIONS` carries why: both rested on a floor
 * slot that admitted floors which are not `s2w`, and an `s2w` recipe's floor has
 * to be an `s2w` floor or the slab does not fit the cell its walls leave. So
 * `RECIPE_TEMPLATES` is the fixtures and nothing else, and the split between
 * *claims about the fixtures* and *claims about the layout model* that this file
 * used to have to draw is gone with it — the two populations are the same 40.
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
    /* One wall short of an external corner, and one part short of it: `(base,
       floor, left wall)` has a cell and an edge but no column, and no convention
       claims it. This used to be row E3's `CORRIDOR` minus a wall; with that
       convention withdrawn the four-part set is unclaimed too, which the next
       case pins so its return cannot be silent. */
    expect(conventionFor(['base', 'floor', 'left wall'])).toBeUndefined()
    expect(conventionFor(['base', 'floor', 'left wall', 'right wall'])).toBeUndefined()
  })

  it('claims the external corner only with its column, so no set falls through to it', () => {
    /* The external corner is the only five-part convention and the only one whose
       set strictly contains another candidate's. A key that ignored the column
       would hand any two-wall recipe the corner's mitred layout — which is what a
       `shape|`-tag key does to two internal corners, measured below. */
    expect(conventionFor(['base', 'column', 'floor', 'left wall', 'right wall'])).toBe(EXTERNAL_CORNER)
    expect(conventionFor(['base', 'column', 'floor', 'right wall'])).toBeUndefined()
  })
})

describe('the three conventions against the 40 shipped recipes', () => {
  it('classifies 40 of 40 on the part-name set, and the 40 are the fixtures’', () => {
    const classified = RECIPE_TEMPLATES.filter((template) => conventionFor(namesOf(template)) !== undefined)
    expect(RECIPE_TEMPLATES).toHaveLength(40)
    expect(classified).toHaveLength(40)
    /* Every one of them read from a fixture: nothing in this build is authored
       here any more, which is what withdrawing row E3 means and what makes every
       measurement in this file a measurement of upstream's recipes. */
    expect(RECIPE_TEMPLATES.filter((template) => template.source.startsWith('authored:'))).toEqual([])
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
    /* The 128 the 20 fixtures declare, and nothing beside them. */
    expect(parts).toBe(128)
    expect(Object.fromEntries(byConvention)).toEqual({
      'wall-on-tile': 32,
      'external-corner': 4,
      'internal-corner': 4,
    })
  })

  it('is wrong on 2 of the 40 if it keys on the template’s own shape tag instead', () => {
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

    /* Over all 40, which since row E3's withdrawal is the same population as
       *upstream's own* — the claim is about another repository's tags and there is
       nothing of this repo's left in the array to inflate the census with. */
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

  it('gives the 128 parts 40 cell anchors, 40 residuals, 40 edges and 8 corners', () => {
    const tally = { cell: 0, edge: 0, corner: 0, residual: 0 }
    for (const template of RECIPE_TEMPLATES) {
      for (const slot of conventionFor(namesOf(template))?.slots ?? []) tally[slot.anchor] += 1
    }
    /* The 80 / 48 split of the plan, from the other side, and with the 80
       derived half now split in two: the 40 `base` slots are `cell`-anchored and
       the 40 `floor` slots are `residual`, which is the whole of this change.
       The 48 that were authored are unmoved — 40 edges plus 8 corners. */
    expect(tally).toEqual({ cell: 40, residual: 40, edge: 40, corner: 8 })
    expect(tally.cell + tally.residual).toBe(80)
    expect(tally.edge + tally.corner).toBe(48)

    /* And the split is by *slot name*, not by convention: every `base` is `cell`
       and every `floor` is `residual`, on all three. A convention that anchored
       one floor differently would be a second rule for one derived quantity. */
    for (const convention of SLOT_CONVENTIONS) {
      expect(ruleFor(convention, 'base')?.anchor, convention.id).toBe('cell')
      expect(ruleFor(convention, 'floor')?.anchor, convention.id).toBe('residual')
    }
  })
})

describe('each convention, as a property rather than a table', () => {
  const each = (assertion: (convention: SlotConvention) => void): void => {
    for (const convention of SLOT_CONVENTIONS) assertion(convention)
  }

  it('names a cell slot that is the residual — the cell it defines, less its walls', () => {
    each((convention) => {
      const cell = ruleFor(convention, convention.cell)
      expect(cell, convention.id).toBeDefined()
      /* The cell slot's *footprint* is the cell and its *position* is the
         residual, and those are not in tension: `offsets.ts#cellExtentOf` reads
         the fill's tagged extent as the cell and `residualBox` subtracts the
         walls from it. An `s2w` floor is tagged at the size of its tile and
         measures 0.5 less per walled axis, so the two readings are the two
         truths the tag conflates. */
      expect(cell?.anchor, convention.id).toBe('residual')
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

  it('ignores the side of every whole-cell anchor by keeping it 0', () => {
    each((convention) => {
      for (const slot of convention.slots) {
        /* `cell` and `residual` are both stated against the whole cell rather
           than against one face, so neither reads its side and both must carry
           0 — a non-zero side on one of them would be a number with no meaning
           that a later reader could mistake for one. */
        if (slot.anchor === 'cell' || slot.anchor === 'residual') {
          expect(slot.side, `${convention.id}/${slot.part}`).toBe(0)
        }
      }
    })
  })

  it('leaves the internal corner’s residual equal to its cell, having no edge to subtract', () => {
    /* Why one anchor covers all three rather than the internal corner keeping
       `cell` as an exception. A residual is the cell less what the `edge` slots
       take, this convention has no `edge` slot, so the subtraction is empty and
       the floor gets the whole cell — which is the right answer for a piece whose
       18 candidates are all `rect 2x2` with the column's square cut out of the
       run rather than off an edge. `offsets.test.ts` measures the identity on the
       arithmetic; this is the structural fact underneath it. */
    expect(INTERNAL_CORNER.slots.filter((slot) => slot.anchor === 'edge')).toEqual([])
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

  it('has no convention whose two edges eat one axis, which is why no-walk is unreachable', () => {
    /* The property `offsets.ts`'s `no-walk` doubt was written for, stated where
       the conventions are. Row E3's corridor was the one layout with an opposed
       pair of edges — two walls taking from the same axis of the cell — and with
       it withdrawn no convention has one. The doubt is *not* dead code: the
       residual is now checked on both axes for every convention, so a single wall
       as deep as its own cell reaches it too — and one of the 1,215 walked
       combinations of the 40 does, which E3's pairing could not see.
       `corpus.test.ts` names it. What is gone is the *opposed* case. */
    const opposedPairs = (convention: SlotConvention): number => {
      const sides = new Set(edgesOf(convention).map((slot) => slot.side))
      return [
        [0, 2],
        [1, 3],
      ].filter(([a, b]) => sides.has(a as SlotSide) && sides.has(b as SlotSide)).length
    }
    expect(SLOT_CONVENTIONS.map(opposedPairs)).toEqual([0, 0, 0])
  })
})
