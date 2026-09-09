/**
 * The arithmetic, on footprints small enough to check by hand.
 *
 * `corpus.test.ts` is the census — every figure quoted in the docblocks,
 * recomputed against the live archive. This file is the semantics, and three of
 * its blocks exist because of a hazard rather than a feature:
 *
 *   1. **A slot offset must never be snapped.** Three of the four insets the
 *      corpus produces are odd multiples of 0.25 and `SNAP_STEP.fine` is 0.5,
 *      so a `snapTo` introduced anywhere in `offsets.ts` moves a wall a quarter
 *      unit off the face it is supposed to be flush with. The block asserts the
 *      gap in both directions, so it fails on the snap rather than on the
 *      symptom.
 *   2. **The rule table must hold no millimetre.** Asserted structurally: the
 *      only numbers in the three conventions are the legal `side` values.
 *   3. **The frame swap must stay equal to `rotatedExtent`.** `offsets.ts` does
 *      the w/d swap itself rather than calling the general rotation, because a
 *      slot's `side` is one of four values and `rotatedExtent` also carries a
 *      trigonometric branch this row never uses — and row A4a is rewriting that
 *      directory. The equivalence is therefore asserted here instead of assumed
 *      by an import, over every extent and every side.
 *   4. **The elevation must come from the one existing measurement.**
 *      `bases.ts#baseElevationMm` is that measurement and this row does not
 *      import it — row A4b owns the file and row A2 reports it may be deleted.
 *      So the block below pins the **contract** that function satisfies (the
 *      upright z extent of the resting mesh, with a fallback when the mesh is
 *      absent) and proves {@link slotElevationMm} composes it without adding
 *      arithmetic of its own.
 */
import { describe, expect, it } from 'vitest'

import {
  SNAP_STEP,
  boxShape,
  footprintShape,
  rotatedExtent,
  slotGeometry,
  snapTo,
  unionBox,
} from '@/builder/canvas'
import type { Extent, PlanBox, PlanShape, SlotLayout } from '@/builder/canvas'
import type { Footprint } from '@/catalog'
import { WALL_THICKNESS_UNITS } from '@/catalog'

import type { SlotPlacement } from './offsets'
import {
  NO_INSETS,
  cornerReservation,
  edgeInsets,
  edgeRun,
  placeTemplateSlots,
  quarterTurn,
  residualBox,
  slotDoubtSentence,
  slotElevationMm,
  slotOffset,
  slotYaw,
} from './offsets'
import type { SlotName, SlotRule, TemplateLayout } from './rules'
import {
  EXTERNAL_CORNER,
  INTERNAL_CORNER,
  SLOT_CONVENTIONS,
  WALL_ON_TILE,
  ruleFor,
} from './rules'

/* ------------------------------------------------------------------ fixtures */

const rect = (w: number, d: number): Footprint => ({ shape: 'rect', w, d })
const wall = (length: number): Footprint => ({ shape: 'wall', length })
const column: Footprint = { shape: 'column' }

const feetOf = (entries: readonly (readonly [SlotName, Footprint])[]): Map<SlotName, Footprint> =>
  new Map(entries)

/** A closing 2 x 2 wall-on-tile: a 2-unit wall on a 2 x 2 floor over a 2 x 2 base. */
const WALL_2X2 = feetOf([
  ['base', rect(2, 2)],
  ['floor', rect(2, 2)],
  ['wall', wall(2)],
])

/**
 * A 2 x 2 external corner, at the footprint the meshes have: two **1.5**-unit
 * walls and a 0.5 column on a 2 x 2 cell.
 *
 * It used to read `wall(2)`, from a `size|width|2` tag. Row **D9** fetched 157
 * corner-wall meshes from R2 and measured the run at **1.500** on all 245
 * records that carry that tag — the tag names the cell, and
 * `footprint.ts#cornerWallRun` now says so. 1.5 + 0.5 = 2 on both faces, so
 * this is a closing recipe rather than the 8 failures it used to model, and
 * both corner recipes resolve to it.
 */
const CORNER_2X2 = feetOf([
  ['base', rect(2, 2)],
  ['floor', rect(2, 2)],
  ['right wall', wall(1.5)],
  ['left wall', wall(1.5)],
  ['column', column],
])

/**
 * The same recipe with the **wrong** 2-unit run the corpus used to derive, kept
 * as the one place this file still exercises an over-run on a corner.
 *
 * Not reachable from the archive any more — 0 records resolve to it — and it is
 * here for two measurements the change has to keep honest: that a run longer
 * than the span its corner leaves still earns an `over-run` doubt rather than
 * being quietly re-fitted, and that such a run really does leave the cell,
 * which is the cost D8 named for this convention and the reason the number had
 * to be measured before it could be taken.
 */
const CORNER_OVER_RUN = feetOf([
  ['base', rect(2, 2)],
  ['floor', rect(2, 2)],
  ['right wall', wall(2)],
  ['left wall', wall(2)],
  ['column', column],
])

const ruleOf = (layout: TemplateLayout, part: SlotName): SlotRule => {
  const rule = ruleFor(layout, part)
  if (rule === undefined) throw new Error(`no rule for ${part}`)
  return rule
}

/* -------------------------------------------------------------- quarter turns */

describe('quarterTurn', () => {
  it('walks the faces -z, +x, +z, -x, matching geometry.ts’s own rotation', () => {
    /* `place` rotates by `[dx·cos − dz·sin, dx·sin + dz·cos]`, so `+90°` sends
       `(x, z)` to `(−z, x)`. If this direction were reversed, `side: 3` would
       name `+x` and an external corner's two walls would sit on opposite faces
       while every unit test on the rules table still passed. */
    expect(quarterTurn([0, -1], 0)).toEqual([0, -1])
    expect(quarterTurn([0, -1], 1)).toEqual([1, 0])
    expect(quarterTurn([0, -1], 2)).toEqual([0, 1])
    expect(quarterTurn([0, -1], 3)).toEqual([-1, 0])
  })

  it('is an exact swap, so no slot picks up 6.1e-17', () => {
    const [x, z] = quarterTurn([0.75, -1.25], 1)
    expect(x).toBe(1.25)
    expect(z).toBe(0.75)
    // What the trigonometric route would have produced instead.
    expect(Math.cos(Math.PI / 2) * 0.75).not.toBe(0)
  })

  it('normalises -0, which survives in memory but not through JSON', () => {
    for (const side of [0, 1, 2, 3] as const) {
      for (const value of quarterTurn([0, 0], side)) expect(Object.is(value, -0)).toBe(false)
    }
  })
})

/* --------------------------------------------------------------- the offsets */

describe('slotOffset', () => {
  it('puts a cell anchor at the template’s own centre', () => {
    expect(slotOffset(ruleOf(WALL_ON_TILE, 'base'), { w: 2, d: 2 }, { w: 2, d: 2 })).toEqual([0, 0])
    // And it does so whatever the fill's extent is, which is the point of the
    // anchor: 25 distinct base footprints reach here.
    expect(slotOffset(ruleOf(WALL_ON_TILE, 'base'), { w: 4, d: 2 }, { w: 1, d: 1 })).toEqual([0, 0])
  })

  it('puts a residual anchor where the walls leave room, and needs the insets to know', () => {
    /* The `floor` rule, which used to be the case above's second line. Both
       arguments matter and the second is the one that is easy to lose: with the
       insets the floor sits a quarter unit off the cell's centre, without them it
       sits *on* it — which is precisely the wrong answer this anchor replaced.
       `offsets.ts`'s module note explains why the parameter defaults anyway. */
    const floor = ruleOf(WALL_ON_TILE, 'floor')
    const cell = { w: 2, d: 2 }
    const insets = { minX: 0, maxX: 0, minZ: WALL_THICKNESS_UNITS, maxZ: 0 }
    expect(slotOffset(floor, cell, cell, 0, insets)).toEqual([0, 0.25])
    expect(slotOffset(floor, cell, cell)).toEqual([0, 0])
  })

  it('puts an edge anchor flush against its face and centred across it', () => {
    const rule = ruleOf(WALL_ON_TILE, 'wall')
    // A 2 x 0.5 wall on a 2 x 2 cell: the -z face is at z = -1 and the wall's
    // centre is a quarter unit inside it.
    expect(slotOffset(rule, { w: 2, d: 2 }, { w: 2, d: WALL_THICKNESS_UNITS })).toEqual([0, -0.75])
    // A deeper fill sits further in. `{shape:'rect',w:2,d:1.5}` is one of the 14
    // real footprints of the `wall` slot.
    expect(slotOffset(rule, { w: 2, d: 2 }, { w: 2, d: 1.5 })).toEqual([0, -0.25])
    // And a 4-unit cell gives a deeper inset again.
    expect(slotOffset(rule, { w: 4, d: 4 }, { w: 4, d: WALL_THICKNESS_UNITS })).toEqual([0, -1.75])
  })

  it('reads the cell’s own axis for the anchored face, not always its depth', () => {
    /* The one place a naive reading of the rule is wrong. On a non-square cell
       the inset for side 1 is half of `cell.w` and not half of `cell.d`, because
       side 1 is the +x face. A formula that used `cell.d` for all four sides
       would agree with every square-cell test and be wrong by a unit here. */
    const cell = { w: 4, d: 2 }
    const part = { w: 4, d: WALL_THICKNESS_UNITS }
    const north: SlotRule = { part: 'wall', anchor: 'edge', side: 0, spin: 0, restsOn: 'base' }
    const east: SlotRule = { part: 'wall', anchor: 'edge', side: 1, spin: 0, restsOn: 'base' }
    expect(slotOffset(north, cell, part)).toEqual([0, -0.75])
    expect(slotOffset(east, cell, part)).toEqual([1.75, 0])
  })

  it('puts a corner anchor flush against both of its faces', () => {
    const rule = ruleOf(EXTERNAL_CORNER, 'column')
    expect(slotOffset(rule, { w: 2, d: 2 }, { w: 0.5, d: 0.5 })).toEqual([-0.75, -0.75])
    // The internal corner's column is the far diagonal of the same cell.
    expect(slotOffset(ruleOf(INTERNAL_CORNER, 'column'), { w: 2, d: 2 }, { w: 0.5, d: 0.5 })).toEqual([
      0.75, 0.75,
    ])
  })

  it('reduces to the plan’s `(-(W - 0.5) / 2, -(D - 0.5) / 2)` on every real corner fill', () => {
    /* The plan states the corner offset with a literal 0.5. `offsets.ts` reads
       the fill's own extent instead, and the two agree on 100% of real data
       because `{shape:'column'}` is the only footprint any of the 8 `corner`
       slots admits and a column is exactly `WALL_THICKNESS_UNITS` square. This
       asserts the equivalence so the generalisation cannot drift away from the
       figure the plan quotes. */
    const rule = ruleOf(EXTERNAL_CORNER, 'column')
    for (const [w, d] of [
      [1, 1],
      [2, 2],
      [4, 2],
      [8, 8],
    ] as const) {
      expect(slotOffset(rule, { w, d }, { w: WALL_THICKNESS_UNITS, d: WALL_THICKNESS_UNITS })).toEqual([
        -(w - 0.5) / 2,
        -(d - 0.5) / 2,
      ])
    }
  })

  it('shifts an edge by half of what its corner reserves, and by nothing when nothing does', () => {
    /* The `reserved` term, isolated. Zero reserved is the 40 `wall-on-tile`
       edges and it must be *exactly* the old behaviour, because those 980
       closing combinations did not move and the suite asserts they did not. */
    const rule = ruleOf(EXTERNAL_CORNER, 'right wall')
    const part = { w: 1.5, d: WALL_THICKNESS_UNITS }
    expect(slotOffset(rule, { w: 2, d: 2 }, part)).toEqual([0, -0.75])
    expect(slotOffset(rule, { w: 2, d: 2 }, part, 0.5)).toEqual([0.25, -0.75])
    expect(slotOffset(rule, { w: 2, d: 2 }, part, -0.5)).toEqual([-0.25, -0.75])
    // And an unfilled corner reserves nothing, so the wall does not move off
    // centre for a column that is not there.
    expect(slotOffset(rule, { w: 2, d: 2 }, part, 0)).toEqual([0, -0.75])
  })
})

describe('residualBox', () => {
  it('centres the remainder on the cell when the two ends of an axis are eaten equally', () => {
    /* The formula's own property, stated where no convention can state it: the
       offset is `(minX - maxX) / 2`, a *difference*, so an axis eaten equally
       from both ends leaves the remainder centred and only its extent shrinks.
       No convention in the table takes from both ends of one axis — row E3's
       corridor did and is withdrawn — so this is the arithmetic's guarantee
       rather than a measurement of a shipped recipe, and it is what keeps a
       fourth convention from needing a fourth formula. */
    expect(residualBox({ w: 2, d: 2 }, { minX: 0.5, maxX: 0.5, minZ: 0, maxZ: 0 })).toEqual({
      offset: [0, 0],
      extent: { w: 1, d: 2 },
    })
  })

  it('pushes the remainder away from whichever end is eaten, and normalises -0', () => {
    // `+ 0` on both terms, for `quarterTurn`'s reason: a `-0` survives in memory
    // but not through `JSON.stringify`, and this offset reaches the store's codec.
    const near = residualBox({ w: 2, d: 2 }, { minX: 0.5, maxX: 0, minZ: 0, maxZ: 0.5 })
    expect(near).toEqual({ offset: [0.25, -0.25], extent: { w: 1.5, d: 1.5 } })
    expect(Object.is(residualBox({ w: 1, d: 1 }, NO_INSETS).offset[0], -0)).toBe(false)
  })

  it('is the cell itself when nothing is eaten, which is the `cell` anchor’s answer', () => {
    /* Why one anchor covers a convention with edges and one without. `NO_INSETS`
       in gives the cell out at the origin — exactly what `slotOffset` returns for
       a `cell` rule — so `internal-corner` needs no exception. */
    expect(residualBox({ w: 4, d: 2 }, NO_INSETS)).toEqual({
      offset: [0, 0],
      extent: { w: 4, d: 2 },
    })
  })
})

describe('cornerReservation', () => {
  const feet = feetOf([
    ['base', rect(2, 2)],
    ['floor', rect(2, 2)],
    ['right wall', wall(1.5)],
    ['left wall', wall(1.5)],
    ['column', column],
  ])

  it('signs the two faces its corner touches, and refuses the two it does not', () => {
    /* `corner`, `side: 0` is the `(-x, -z)` square, so it belongs to face 0 —
       where it sits at that face's own `-x` end — and to face 3, where the same
       square lands at `+x`. Faces 1 and 2 it does not touch at all, and a span
       subtracted from those would be a column reserving room on the far side of
       the tile. */
    expect(cornerReservation(EXTERNAL_CORNER, feet, 0)).toBe(WALL_THICKNESS_UNITS)
    expect(cornerReservation(EXTERNAL_CORNER, feet, 3)).toBe(-WALL_THICKNESS_UNITS)
    expect(cornerReservation(EXTERNAL_CORNER, feet, 1)).toBe(0)
    expect(cornerReservation(EXTERNAL_CORNER, feet, 2)).toBe(0)
  })

  it('derives the +x half from quarterTurn rather than trusting the docstring', () => {
    /* The sign is the whole of what could be got backwards, and getting it
       backwards draws the wall *through* the column at one of the two sides —
       which is what a first attempt at this row did. So it is derived: put the
       corner's own flush offset through `quarterTurn` for both faces it touches
       and read which end of each face the square lands on.

       For a 2 x 2 cell the column's flush offset in `F(0)` is `(-0.75, -0.75)`.
       Face 0 reads it directly: `x = -0.75`, the `-x` end, so an edge there
       shifts `+`. Face 3 is the same square seen from a frame one quarter turn
       away, and `quarterTurn` is what says where that is. */
    const cell = { w: 2, d: 2 }
    const columnExtent = { w: WALL_THICKNESS_UNITS, d: WALL_THICKNESS_UNITS }
    const flush = slotOffset(ruleOf(EXTERNAL_CORNER, 'column'), cell, columnExtent)

    for (const side of [0, 3] as const) {
      // Undo the face frame's quarter turn to read the square in that frame.
      const back = quarterTurn(flush, ((4 - side) % 4) as 0 | 1 | 2 | 3)
      const atMinusX = (back[0] ?? 0) < 0
      const expected = atMinusX ? WALL_THICKNESS_UNITS : -WALL_THICKNESS_UNITS
      expect(cornerReservation(EXTERNAL_CORNER, feet, side), `side ${String(side)}`).toBe(expected)
    }
  })

  it('reads the fill’s extent, so a corner of another size reserves its own span', () => {
    /* 0.5 on all 8 real corner slots, because a column is the only footprint any
       of them admits — but read off the fill, so the arithmetic does not have to
       be revisited if a corner slot ever admits something else. */
    const wide = feetOf([...feet, ['column', rect(1, 1)]])
    expect(cornerReservation(EXTERNAL_CORNER, wide, 0)).toBe(1)
    expect(cornerReservation(EXTERNAL_CORNER, wide, 3)).toBe(-1)
    // An unfilled corner keeps D8's 0.5 fallback: it is what the closure check
    // for an `unfilled` combination is measured against.
    const bare = feetOf([
      ['base', rect(2, 2)],
      ['floor', rect(2, 2)],
      ['right wall', wall(1.5)],
    ])
    expect(cornerReservation(EXTERNAL_CORNER, bare, 0)).toBe(WALL_THICKNESS_UNITS)
  })

  it('is 0 on every face of a layout with no corner slot at all', () => {
    // The 40 `wall-on-tile` edges, which is why none of their 980 closing
    // combinations moved.
    for (const side of [0, 1, 2, 3] as const) {
      expect(cornerReservation(WALL_ON_TILE, WALL_2X2, side)).toBe(0)
    }
  })
})

describe('the frame swap, against the general rotation it deliberately does not call', () => {
  it('agrees with rotatedExtent on every extent and every side', () => {
    /* `slotOffset` derives the inset in the frame where the anchored face is
       `-z`, and gets there by swapping `w` and `d` on an odd quarter turn. That
       is exactly `rotatedExtent(cell, side * 90)` for a multiple of 90, and this
       recomputes the whole offset through the general function to prove it.

       Asserted rather than imported: the source depends on `footprintExtent`
       from `@/builder/canvas` and on nothing else there, so a change to rotation
       semantics in row A4a's directory fails *this test* — visibly — instead of
       silently moving every slot in the builder. */
    const cells: readonly Extent[] = [
      { w: 1, d: 1 },
      { w: 2, d: 2 },
      { w: 4, d: 2 },
      { w: 2, d: 4 },
      { w: 3, d: 1 },
      { w: 8, d: 8 },
    ]
    const parts: readonly Extent[] = [
      { w: 2, d: WALL_THICKNESS_UNITS },
      { w: 2, d: 1.5 },
      { w: WALL_THICKNESS_UNITS, d: WALL_THICKNESS_UNITS },
    ]

    for (const anchor of ['edge', 'corner'] as const) {
      for (const side of [0, 1, 2, 3] as const) {
        /* And over the spin, which is the term the anchors gained: a part turned
           inside its anchor is anchored flush by its *drawn* depth, so the two
           extents reach the face's frame by different turns. Written against
           `rotatedExtent` on both, so the file's own equivalence carries the new
           term as well as the old one. */
        for (const spin of [0, 1, 2, 3] as const) {
          for (const cell of cells) {
            for (const part of parts) {
              const rule: SlotRule = { part: 'wall', anchor, side, spin, restsOn: 'base' }
              const inFrame = rotatedExtent(cell, side * 90)
              const drawn = rotatedExtent(part, spin * 90)
              const dz = -(inFrame.d - drawn.d) / 2
              const dx = anchor === 'corner' ? -(inFrame.w - drawn.w) / 2 : 0
              expect(
                slotOffset(rule, cell, part),
                `${anchor}/${String(side)}/${String(spin)}`,
              ).toEqual(quarterTurn([dx, dz], side))
            }
          }
        }
      }
    }
  })
})

/* ------------------------------------------------------- hazard 1: the lattice */

describe('the 0.25 lattice, which the snap step does not reach', () => {
  /** The four insets the corpus actually produces, measured over the 1,006 fits. */
  const MEASURED_INSETS = [-1.25, -0.75, -0.25, 0]

  it('produces exactly the four measured insets, three of them off the 0.5 lattice', () => {
    const rule = ruleOf(WALL_ON_TILE, 'wall')
    const produced = [
      slotOffset(rule, { w: 3, d: 3 }, { w: 3, d: WALL_THICKNESS_UNITS })[1],
      slotOffset(rule, { w: 2, d: 2 }, { w: 2, d: WALL_THICKNESS_UNITS })[1],
      slotOffset(rule, { w: 2, d: 2 }, { w: 2, d: 1.5 })[1],
      slotOffset(rule, { w: 1, d: 1 }, { w: 1, d: 1 })[1],
    ]
    expect(produced).toEqual(MEASURED_INSETS)
    const offLattice = MEASURED_INSETS.filter((inset) => snapTo(inset, SNAP_STEP.fine) !== inset)
    expect(offLattice).toEqual([-1.25, -0.75, -0.25])
    expect(SNAP_STEP.fine).toBe(0.5)
  })

  it('would move a wall a quarter unit if a slot offset were ever snapped', () => {
    /* This is the test that fails if `snapTo` is introduced into `slotOffset`.
       It asserts the *gap*, so it cannot be satisfied by snapping the
       expectation too: the value the rule produces and the value the lattice
       admits are a quarter unit apart, and a quarter unit is the difference
       between a wall flush against a floor and a wall inside it. */
    const [, dz] = slotOffset(ruleOf(WALL_ON_TILE, 'wall'), { w: 2, d: 2 }, { w: 2, d: WALL_THICKNESS_UNITS })
    expect(dz).toBe(-0.75)
    expect(snapTo(dz, SNAP_STEP.fine)).toBe(-0.5)
    expect(Math.abs(snapTo(dz, SNAP_STEP.fine) - dz)).toBe(0.25)
  })

  it('leaves a rotated template on the lattice, because only the origin is snapped', () => {
    /* The composition that makes the off-lattice offset safe: the template's
       own origin is the snapped quantity, the slot offset is internal, and a
       quarter turn of a quarter-unit offset is still a quarter-unit offset. */
    const [dx, dz] = slotOffset(ruleOf(WALL_ON_TILE, 'wall'), { w: 2, d: 2 }, { w: 2, d: WALL_THICKNESS_UNITS })
    for (const side of [0, 1, 2, 3] as const) {
      for (const value of quarterTurn([dx, dz], side)) {
        expect(Math.abs(value * 4 - Math.round(value * 4))).toBeLessThan(1e-12)
      }
    }
  })
})

/* ------------------------------------------------------------------- the yaw */

describe('slotYaw', () => {
  it('is (side + spin) * 90, and is not stored anywhere it could disagree with the side', () => {
    expect(
      SLOT_CONVENTIONS.flatMap((convention) => convention.slots)
        .map(slotYaw)
        .sort((a, b) => a - b),
    ).toEqual(
      /* 11 slots over the three conventions. Five are drawn in the frame their
         anchor implies — the three bases and the two walls anchored to the
         reference face — and the other six are the two terms composing:

           - the external corner's left wall at 270, side 3 and no spin;
           - `WALL_ON_TILE`'s floor at 180, side 0 and a half turn, which points
             its cut-off half tiles at the wall they belong under;
           - both corner floors and the external corner's column at 90;
           - the internal corner's column at 270, side 2 and a quarter turn — the
             one slot whose two terms are both non-zero.

         Row E3's corridor put a fourth slot at 180 — its left wall, the only
         slot in the table two quarter-turns from the reference face with no
         corner between them — and it is withdrawn with the convention. */
      [0, 0, 0, 0, 0, 90, 90, 90, 180, 270, 270],
    )
    for (const side of [0, 1, 2, 3] as const) {
      for (const spin of [0, 1, 2, 3] as const) {
        const rule: SlotRule = { part: 'wall', anchor: 'edge', side, spin, restsOn: null }
        expect(slotYaw(rule)).toBe(((side + spin) % 4) * 90)
        // Folded, so the one combination that sums to a full turn is 0 and not
        // 360 — a rotation `@/store#normalizeRotation` would never hand out.
        expect(slotYaw(rule)).toBeLessThan(360)
        expect(rule).not.toHaveProperty('yaw')
      }
    }
  })

  it('keeps every slot on a quarter turn when the template is on one', () => {
    for (const rotation of [0, 90, 180, 270]) {
      for (const convention of SLOT_CONVENTIONS) {
        for (const rule of convention.slots) {
          expect((rotation + slotYaw(rule)) % 90).toBe(0)
        }
      }
    }
  })
})

/* --------------------------------------------------- hazard 2: the elevation */

describe('the rule table holds no measurement', () => {
  it('carries no number but the legal sides', () => {
    /* Structural, and it is the assertion behind "elevation stays normalised":
       18.4% of measured `openforge` toppers are authored pre-lifted by exactly
       one base thickness and 77.5% are not, so a millimetre written into a rule
       would freeze one of those populations. There is nowhere to write one. */
    const numbers = new Set<number>()
    const walk = (value: unknown): void => {
      if (typeof value === 'number') numbers.add(value)
      else if (Array.isArray(value)) value.forEach(walk)
      else if (value !== null && typeof value === 'object') Object.values(value).forEach(walk)
    }
    walk(SLOT_CONVENTIONS)
    /* 1 joined the set with `rules.ts#SlotSpin`, and it is a quarter turn like
       every other number here: the table's whole numeric vocabulary is still
       "which of four quarter turns", on two axes instead of one. */
    expect([...numbers].sort((a, b) => a - b)).toEqual([0, 1, 2, 3])
  })
})

describe('slotElevationMm', () => {
  const heights = (mm: number) => (): number => mm

  it('leaves the ground slot at zero and lifts the rest by one base', () => {
    expect(slotElevationMm(WALL_ON_TILE, 'base', heights(6))).toBe(0)
    expect(slotElevationMm(WALL_ON_TILE, 'floor', heights(6))).toBe(6)
    // The wall rests on the base too, not on the floor — so one base, not two.
    // Among the 107 measured toppers authored pre-lifted by exactly one base
    // thickness, 59 are walls and 27 are floors: both stand on a base.
    expect(slotElevationMm(WALL_ON_TILE, 'wall', heights(6))).toBe(6)
    expect(slotElevationMm(EXTERNAL_CORNER, 'column', heights(6))).toBe(6)
  })

  it('takes the height from the caller, so this module holds no millimetre', () => {
    expect(slotElevationMm(WALL_ON_TILE, 'floor', heights(12.7))).toBe(12.7)
    expect(slotElevationMm(WALL_ON_TILE, 'floor', heights(0))).toBe(0)
  })

  it('composes the contract bases.ts#baseElevationMm satisfies, without importing it', () => {
    /* "Reuse rather than write a second elevation source", as a passing test.
       `bases.ts#baseElevationMm(base, geometries)` answers the resting mesh's
       own **upright** height — the store's `z` extent, because `tileMatrix`
       stands the Z-up bytes up before placing them — and falls back to
       `ABSENT_BASE_ELEVATION_MM` when the blob has not landed. That contract is
       reproduced here in three lines over the same shape of input, and
       `slotElevationMm` adds nothing to it: a 6 mm-tall base lifts the floor by
       exactly 6 mm. 279 of the 343 measured bases are within 0.015 mm of
       6.00-6.01, which `corpus.test.ts` recomputes.

       Not imported, deliberately: row **A4b** owns `src/builder/three/**`, row
       **A2** reports `bases.ts` may be deleted outright, and it reaches
       `@/store`, which this row must not touch. */
    const ABSENT_FALLBACK_MM = 1.2
    const bounds = new Map<string, { readonly minZ: number; readonly maxZ: number }>([
      ['base-blob', { minZ: 0, maxZ: 6 }],
    ])
    const blobOf = new Map<SlotName, string>([['base', 'base-blob']])
    const heightMm = (part: SlotName): number => {
      const box = bounds.get(blobOf.get(part) ?? '')
      return box === undefined ? ABSENT_FALLBACK_MM : box.maxZ - box.minZ
    }

    expect(slotElevationMm(WALL_ON_TILE, 'floor', heightMm)).toBe(6)
    expect(slotElevationMm(WALL_ON_TILE, 'base', heightMm)).toBe(0)
    // And the absent-mesh fallback passes through unchanged rather than being
    // replaced by a second default of ours.
    expect(slotElevationMm(WALL_ON_TILE, 'floor', () => ABSENT_FALLBACK_MM)).toBe(ABSENT_FALLBACK_MM)
  })

  it('throws on a cycle rather than hanging the renderer', () => {
    const cyclic: TemplateLayout = {
      cell: 'floor',
      slots: [
        { part: 'floor', anchor: 'cell', side: 0, spin: 0, restsOn: 'wall' },
        { part: 'wall', anchor: 'edge', side: 0, spin: 0, restsOn: 'floor' },
      ],
    }
    expect(() => slotElevationMm(cyclic, 'floor', heights(6))).toThrow(/cycle through/)
  })
})

/* --------------------------------------------------------------- the closure */

describe('edgeRun', () => {
  it('answers for the footprints that have a run along a face', () => {
    expect(edgeRun(wall(2))).toBe(2)
    expect(edgeRun(rect(3, 1.5))).toBe(3)
    expect(edgeRun(column)).toBe(WALL_THICKNESS_UNITS)
  })

  it('refuses for the three that do not, rather than approximating them', () => {
    /* A `diag` is a 45° run with no cell face to lie along; a `tri`'s
       interesting edge is its hypotenuse; a sector meets a face at a tangent.
       102, 2 and 0 of the 1,215 walked combinations respectively. */
    expect(edgeRun({ shape: 'diag', run: 3.334 })).toBeNull()
    expect(edgeRun({ shape: 'tri', leg: 2 })).toBeNull()
    expect(edgeRun({ shape: 'none' })).toBeNull()
  })
})

describe('placeTemplateSlots', () => {
  it('places a closing wall-on-tile, in dependency order, with the offsets above', () => {
    const placed = placeTemplateSlots(WALL_ON_TILE, WALL_2X2)
    expect(placed.verdict).toBe('closes')
    expect(placed.doubts).toEqual([])
    expect(placed.cell).toEqual({ w: 2, d: 2 })
    expect(placed.slots.map((slot) => slot.part)).toEqual(['base', 'floor', 'wall'])
    /* The base at the cell's own centre, the floor a quarter unit off it — the
       centre of the 2 x 1.5 the wall leaves — and the wall flush to face 0 at
       `-(2 - 0.5) / 2`. The floor's quarter unit is the whole of this change:
       under a `cell` anchor it was `[0, 0]`, and an `s2w` floor measures 2 x 1.5
       against a tag that says 2 x 2, so centring it put 0.25 of the slab under
       the wall. */
    expect(placed.slots.map((slot) => slot.offset)).toEqual([
      [0, 0],
      [0, 0.25],
      [0, -0.75],
    ])
    expect(placed.slots.map((slot) => slot.restsOn)).toEqual([null, 'base', 'base'])
  })

  it('places a closing external corner, with each wall abutting the column', () => {
    const placed = placeTemplateSlots(EXTERNAL_CORNER, CORNER_2X2)
    expect(placed.verdict).toBe('closes')
    // 1.5 + 0.5 = 2 on both faces — the measured run against the measured
    // column, and now the run **both** corner recipes resolve to.
    expect(placed.slots).toHaveLength(5)
    const byPart = new Map(placed.slots.map((slot) => [slot.part, slot]))
    /* The quarter unit that used to be the disagreement. `dx` is
       `reserved / 2`, so the wall is centred on the 1.5 the column leaves rather
       than on the 2-unit face: at side 0 the corner is at the `-x` end so the
       wall shifts `+0.25`, and at side 3 the same square lands at `+x` so it
       shifts `-0.25` in that face's own frame — which comes back as `+0.25` on
       `z` after the quarter turn. `the offsets, placed by the canvas` below
       turns both into boxes and measures that they meet the column exactly. */
    expect(byPart.get('right wall')?.offset).toEqual([0.25, -0.75])
    expect(byPart.get('right wall')?.yaw).toBe(0)
    expect(byPart.get('left wall')?.offset).toEqual([-0.75, 0.25])
    expect(byPart.get('left wall')?.yaw).toBe(270)
    expect(byPart.get('column')?.offset).toEqual([-0.75, -0.75])
  })

  it('still warns when a run is longer than the span its corner leaves', () => {
    /* **What used to be the 8 single-piece mitres, and is now reachable from no
       record at all.** §9 of the plan said *"the mitre is in no tag and no
       measurement. Do not silently write 1.5."* Row D9 measured it — 157
       corner-wall meshes, run 1.500 on all 245 records tagged `size|width|2` —
       so the 8 close and this fixture is the hypothetical that remains.

       It is kept because the *reason* §9 was written still stands. A run that
       does not fit the span its corner leaves must earn a doubt naming the face
       and the sum and stop there; the branch must not re-fit it, and it must not
       be handed a number nobody measured. The doubt is still a warning about the
       *sum* rather than a claim that the part has nowhere to go — row D8's
       finding — so all five slots still place. */
    const placed = placeTemplateSlots(EXTERNAL_CORNER, CORNER_OVER_RUN)
    expect(placed.verdict).toBe('fails')
    expect(placed.doubts).toEqual([
      { part: 'right wall', code: 'over-run', want: 2, got: 2.5 },
      { part: 'left wall', code: 'over-run', want: 2, got: 2.5 },
    ])
    expect(placed.slots.map((slot) => slot.part)).toEqual([
      'base',
      'floor',
      'right wall',
      'left wall',
      'column',
    ])
    const byPart = new Map(placed.slots.map((slot) => [slot.part, slot]))
    // The same offsets and yaws a closing corner gets, because the anchor does
    // not depend on whether the sum closes: abutted to the column at side 0,
    // and to the same square at side 3.
    expect(byPart.get('right wall')?.offset).toEqual([0.25, -0.75])
    expect(byPart.get('right wall')?.yaw).toBe(0)
    expect(byPart.get('left wall')?.offset).toEqual([-0.75, 0.25])
    expect(byPart.get('left wall')?.yaw).toBe(270)
    /* And the doubt still reports the face and the sum rather than the run that
       would close it. `2.5 - 2` is 0.5, not 1.5, so the old `not.toContain`
       guard cannot distinguish "wrote 1.5" from "wrote nothing"; what matters is
       that the two reported numbers are the *cell edge* and *what the fills come
       to*, which is asserted above by value. */
    expect(slotDoubtSentence(placed.doubts[0] as never)).toBe(
      'The right wall part needs a choice: this edge is 2 units and the pieces on it come to 2.5.',
    )
  })

  it('gives a wall-on-tile floor the cell less its one wall, and nothing beside it', () => {
    /* The residual, on the simplest layout that has one. A 2 x 2 cell with a
       half-unit wall on face 0 leaves the floor `z ∈ [0.5, 2]` — 2 x 1.5 — so its
       centre sits a quarter unit further from face 0 than the cell's does. Which
       is exactly the quarter unit an `s2w` floor was drawn wrong by while the
       anchor was `cell`: the slab measures 2 x 1.5 and the tag says 2 x 2, so
       centring it in the cell put 0.25 of it under the wall and left 0.25 of base
       bare at the far edge. */
    const placed = placeTemplateSlots(WALL_ON_TILE, WALL_2X2)
    const byPart = new Map(placed.slots.map((slot) => [slot.part, slot]))
    expect(byPart.get('floor')?.anchor).toBe('residual')
    expect(byPart.get('floor')?.offset).toEqual([0, 0.25])
    expect(byPart.get('floor')?.residual).toEqual({ w: 2, d: 1.5 })
    /* And the `base` is untouched: it is `cell`-anchored because the walls stand
       **on** it, which is the one part of the template that really does fill the
       whole cell. */
    expect(byPart.get('base')?.anchor).toBe('cell')
    expect(byPart.get('base')?.offset).toEqual([0, 0])
    expect(byPart.get('base')?.residual).toBeUndefined()
  })

  it('gives an external corner’s floor the 1.5 x 1.5 its two walls leave', () => {
    /* The measured case. `tools/measure/measurements.json` reads
       `dungeon_stone%block#floor+s2w+curved.2x2` at **1.5 x 1.5** inside a tagged
       2 x 2 and the `4x4` at **3.5 x 3.5** inside a tagged 4 x 4 — 0.5 short on
       each walled axis, authored in place in the nominal cell. Both are
       reproduced here from the walls' own footprints and nothing else, which is
       what makes the residual a derivation rather than a number somebody wrote
       down. `corpus.test.ts` joins the two against the sidecar. */
    const placed = placeTemplateSlots(EXTERNAL_CORNER, CORNER_2X2)
    const floor = placed.slots.find((slot) => slot.part === 'floor')
    expect(floor?.residual).toEqual({ w: 1.5, d: 1.5 })
    // Walls on faces 0 (`-z`) and 3 (`-x`), so the remainder is pushed to `+x, +z`.
    expect(floor?.offset).toEqual([0.25, 0.25])

    const big = placeTemplateSlots(
      EXTERNAL_CORNER,
      feetOf([
        ['base', rect(4, 4)],
        ['floor', rect(4, 4)],
        ['right wall', wall(3.5)],
        ['left wall', wall(3.5)],
        ['column', column],
      ]),
    )
    expect(big.slots.find((slot) => slot.part === 'floor')?.residual).toEqual({ w: 3.5, d: 3.5 })
  })

  it('turns a spun floor’s residual into the part’s own frame, so a spin cannot move it', () => {
    /* **The frame contract, and the one thing a spin must never do.**
       `residualBox` derives the box in the *template's* frame — the cell less
       what each wall takes off its own face — and `SlotPlacement.residual`
       carries it in the part's own, because every consumer substitutes it for a
       footprint and then turns it by the slot's yaw. Turning it back has to give
       the template-frame box at every spin, which is what says the part was
       turned and not moved.

       None of the three shipped conventions can see this: `WALL_ON_TILE`'s floor
       spins by a *half* turn and a w/d swap reads only parity, and both corner
       floors are square. The quarter turn on a 2 x 1.5 residual is the case that
       transposes, so it is the case asserted — and the offset stays put through
       all four. */
    const world = residualBox({ w: 2, d: 2 }, edgeInsets(WALL_ON_TILE, WALL_2X2)).extent
    expect(world).toEqual({ w: 2, d: 1.5 })
    for (const spin of [0, 1, 2, 3] as const) {
      const layout: TemplateLayout = {
        cell: 'floor',
        slots: WALL_ON_TILE.slots.map((rule) => (rule.part === 'floor' ? { ...rule, spin } : rule)),
      }
      const floor = placeTemplateSlots(layout, WALL_2X2).slots.find((slot) => slot.part === 'floor')
      const expected = spin % 2 === 0 ? world : { w: world.d, d: world.w }
      expect(floor?.residual, `spin ${String(spin)}`).toEqual(expected)
      expect(rotatedExtent(expected, spin * 90), `spin ${String(spin)} drawn`).toEqual(world)
      expect(floor?.offset, `spin ${String(spin)} offset`).toEqual([0, 0.25])
    }
  })

  it('leaves an internal corner’s residual equal to its cell, having no wall to subtract', () => {
    /* Why one anchor covers all three conventions instead of this one keeping
       `cell`. With no `edge` slot the insets are all 0, so `residualBox` returns
       the cell at offset `[0, 0]` — the `cell` anchor's own answer, reached by
       arithmetic rather than by a branch. Its 18 candidates are all `rect 2x2`
       with the column's square taken out of the middle of the run, so the whole
       cell is the right box for them. */
    const placed = placeTemplateSlots(INTERNAL_CORNER, CORNER_2X2)
    const floor = placed.slots.find((slot) => slot.part === 'floor')
    expect(floor?.offset).toEqual([0, 0])
    expect(floor?.residual).toEqual({ w: 2, d: 2 })
    expect(edgeInsets(INTERNAL_CORNER, CORNER_2X2)).toEqual(NO_INSETS)
  })

  it('reads each wall’s depth off the face it is anchored to, not off one axis', () => {
    /* `edgeInsets` is named by face rather than by axis because the two faces of
       one axis are eaten independently. Face 0 is `-z` and face 3 is `-x`, so an
       external corner takes from `minZ` and `minX` and from neither far face —
       which is what puts its floor at `+x, +z` rather than in the middle. */
    expect(edgeInsets(EXTERNAL_CORNER, CORNER_2X2)).toEqual({
      minX: 0.5,
      maxX: 0,
      minZ: 0.5,
      maxZ: 0,
    })
    expect(edgeInsets(WALL_ON_TILE, WALL_2X2)).toEqual({ minX: 0, maxX: 0, minZ: 0.5, maxZ: 0 })
  })

  it('contributes nothing for a wall that is unfilled, so an incomplete fill keeps the whole cell', () => {
    /* The honest answer and the useful one at once: while the user has not chosen
       a wall the floor really does have the run of the cell, and the slot's own
       `unfilled` doubt is what says the template is incomplete. A guessed
       half-unit here would shrink the floor for a wall nobody has picked. */
    const placed = placeTemplateSlots(
      WALL_ON_TILE,
      feetOf([
        ['base', rect(2, 2)],
        ['floor', rect(2, 2)],
      ]),
    )
    const floor = placed.slots.find((slot) => slot.part === 'floor')
    expect(floor?.residual).toEqual({ w: 2, d: 2 })
    expect(floor?.offset).toEqual([0, 0])
    expect(placed.doubts).toEqual([{ part: 'wall', code: 'unfilled' }])
  })

  it('contributes nothing for a wall with no run, which the rule has already refused a place', () => {
    /* A `diag`, `tri` or `arc` fill does not lie along its face at all, so its
       bounding box says nothing about how much of the cell's axis it takes. Row
       E3 made this correction to the paired walkability check and the residual
       inherits it: a part the rule declined to place must not silently move
       another part. The `no-run` doubt is the report, and the floor keeps the
       cell. */
    const placed = placeTemplateSlots(
      WALL_ON_TILE,
      feetOf([
        ['base', rect(2, 2)],
        ['floor', rect(2, 2)],
        ['wall', { shape: 'diag', run: 2.828 }],
      ]),
    )
    expect(placed.doubts).toEqual([{ part: 'wall', code: 'no-run' }])
    expect(placed.slots.find((slot) => slot.part === 'floor')?.residual).toEqual({ w: 2, d: 2 })
  })

  it('calls a wall as deep as its own cell `fails` on `no-walk`, where the runs still tile', () => {
    /* **The one combination of the 40 that reaches this doubt**, and the one row
       E3's pairing could not see. `rough_stone#column+low.I.openforge.stl`
       resolves to a `rect 1x1`, not a half-unit run, so on a 1 x 1 cell it eats
       the whole depth and the floor is a slab of zero extent.

       Its run *tiles the face exactly* — `edgeRun` of a `rect 1x1` is 1 on a
       1-unit span — so `over-run` was never going to catch it, and with only one
       `edge` slot the old opposed-pair check never looked at the axis at all. So
       the combination came out `closes` with no doubts. The doubt names the
       **cell** slot: the wall is not wrong, the floor is the part with nothing
       left. */
    const placed = placeTemplateSlots(
      WALL_ON_TILE,
      feetOf([
        ['base', rect(1, 1)],
        ['floor', rect(1, 1)],
        ['wall', rect(1, 1)],
      ]),
    )
    expect(placed.verdict).toBe('fails')
    expect(placed.doubts).toEqual([{ part: 'floor', code: 'no-walk', want: 1, got: 1 }])
    expect(slotDoubtSentence(placed.doubts[0] as never)).toBe(
      'The floor part needs a choice: it is 1 units across and the walls on either side take 1, ' +
        'so nothing is left to walk on.',
    )
    /* Placed anyway, exactly as an `over-run` is — row D8's split. The parts do
       have positions; what is wrong is the result, not the arithmetic. */
    expect(placed.slots.map((slot) => slot.part)).toEqual(['base', 'floor', 'wall'])
    expect(placed.doubts.filter((doubt) => doubt.code === 'over-run')).toEqual([])
  })

  it('leaves half a unit of walkable depth alone, so the boundary is `> 0` and not a margin', () => {
    /* The useful side of the same boundary. A single half-unit wall on a 1 x 1
       cell leaves 0.5 to walk on and is an ordinary wall tile — 979 of the 1,143
       `wall-on-tile` combinations close on exactly that arrangement. The check is
       `span - eaten > 0` and not a threshold somebody chose. */
    const placed = placeTemplateSlots(
      WALL_ON_TILE,
      feetOf([
        ['base', rect(1, 1)],
        ['floor', rect(1, 1)],
        ['wall', wall(1)],
      ]),
    )
    expect(placed.verdict).toBe('closes')
    expect(placed.doubts).toEqual([])
    expect(placed.slots.find((slot) => slot.part === 'floor')?.residual).toEqual({ w: 1, d: 0.5 })
  })

  it('cannot fire on either axis of a closing corner, however the cell is shaped', () => {
    /* An external corner takes half a unit off each of two *different* axes, so a
       cell needs only to exceed 0.5 on both to leave something walkable — and
       every `rect` in the corner recipes' floor pools is 1 x 1 or larger.
       `corpus.test.ts` measures the archive; this is the arithmetic. */
    for (const feet of [CORNER_2X2, CORNER_OVER_RUN]) {
      const placed = placeTemplateSlots(EXTERNAL_CORNER, feet)
      expect(placed.doubts.filter((doubt) => doubt.code === 'no-walk')).toEqual([])
    }
  })


  it('refuses a fill with no footprint rather than drawing its bounding box', () => {
    const placed = placeTemplateSlots(
      WALL_ON_TILE,
      feetOf([
        ['base', rect(2, 2)],
        ['floor', rect(2, 2)],
        ['wall', { shape: 'none' }],
      ]),
    )
    expect(placed.verdict).toBe('undecidable')
    expect(placed.doubts).toEqual([{ part: 'wall', code: 'no-footprint' }])
    // The other two still place, which is what "place anyway" means.
    expect(placed.slots.map((slot) => slot.part)).toEqual(['base', 'floor'])
  })

  it('refuses a diagonal fill, which has no face to be flush with', () => {
    const placed = placeTemplateSlots(
      WALL_ON_TILE,
      feetOf([
        ['base', rect(2, 2)],
        ['floor', rect(2, 2)],
        ['wall', { shape: 'diag', run: 2.828 }],
      ]),
    )
    expect(placed.verdict).toBe('undecidable')
    expect(placed.doubts).toEqual([{ part: 'wall', code: 'no-run' }])
    expect(placed.slots.map((slot) => slot.part)).toEqual(['base', 'floor'])
  })

  it('accepts an incomplete instance, which is what C-g requires of placeTemplate', () => {
    const placed = placeTemplateSlots(WALL_ON_TILE, feetOf([['floor', rect(2, 2)]]))
    expect(placed.verdict).toBe('undecidable')
    expect(placed.doubts).toEqual([
      { part: 'base', code: 'unfilled' },
      { part: 'wall', code: 'unfilled' },
    ])
    expect(placed.slots.map((slot) => slot.part)).toEqual(['floor'])
  })

  it('has nothing to anchor to when the cell slot is unfilled', () => {
    const placed = placeTemplateSlots(WALL_ON_TILE, feetOf([['base', rect(2, 2)]]))
    expect(placed.verdict).toBe('undecidable')
    expect(placed.cell).toBeUndefined()
    expect(placed.slots).toEqual([])
    expect(placed.doubts[0]).toEqual({ part: 'floor', code: 'unfilled' })
  })

  it('refuses a non-rectangular cell rather than reading a wall run as one', () => {
    const placed = placeTemplateSlots(
      WALL_ON_TILE,
      feetOf([
        ['base', rect(2, 2)],
        ['floor', wall(2)],
        ['wall', wall(2)],
      ]),
    )
    expect(placed.verdict).toBe('undecidable')
    expect(placed.doubts).toContainEqual({ part: 'floor', code: 'no-cell' })
  })

  it('calls an internal corner undecidable, because it has no anchored face at all', () => {
    /* All 38 walked combinations of the four internal-corner recipes land here.
       They are not fits: with no wall part there is no closure to check, and
       counting them as fits would inflate the 82.8% by three points on
       nothing. */
    const placed = placeTemplateSlots(
      INTERNAL_CORNER,
      feetOf([
        ['base', rect(2, 2)],
        ['floor', rect(2, 2)],
        ['column', column],
      ]),
    )
    expect(placed.verdict).toBe('undecidable')
    expect(placed.doubts).toEqual([])
    expect(placed.slots).toHaveLength(3)
    expect(placed.slots[2]?.offset).toEqual([0.75, 0.75])
  })
})

describe('slotDoubtSentence', () => {
  it('says needs a choice for every code, and names both numbers on an over-run', () => {
    expect(slotDoubtSentence({ part: 'wall', code: 'unfilled' })).toBe('The wall part needs a choice.')
    expect(slotDoubtSentence({ part: 'floor', code: 'no-cell' })).toContain('not a rectangular cell')
    expect(slotDoubtSentence({ part: 'wall', code: 'no-footprint' })).toContain('no placeable footprint')
    expect(slotDoubtSentence({ part: 'wall', code: 'no-run' })).toContain('no straight run')
    expect(slotDoubtSentence({ part: 'left wall', code: 'over-run', want: 4, got: 4.5 })).toBe(
      'The left wall part needs a choice: this edge is 4 units and the pieces on it come to 4.5.',
    )
  })
})

/* ------------------------------------ the two rotation models — row A10 */

/**
 * **This file's offsets, read through the canvas's own placement.**
 *
 * There are two implementations of one idea. This module states a slot's
 * position as an offset from the **template's centre**, computed at fill time;
 * `src/builder/canvas/geometry.ts` states it as a `SlotLayout` whose `dx`/`dz`
 * locate the part's **minimum corner** in the template's own frame, and places it
 * with `slotAnchor`. Nothing wires the first to the second yet — see the note on
 * {@link slotOffset} — so the agreement has to be measured rather than assumed,
 * and this block measures it.
 *
 * ## What it settles
 *
 * Row **A4b** measured a placed template's footprint growing to three times its
 * ground at a half turn, and proposed reading `dx`/`dz` as the part's *centre*
 * offset, which it measured as invariant at **7.56 units²** — including at 0°,
 * where its own table says a 2 x 2 corner covers 4.00. The two readings
 * disagreeing about the *unrotated* footprint is what row A10 had to settle, and
 * this is the answer: **4.00 is right and 7.56 is an artefact.** A 2 x 2 corner
 * covers its cell and nothing more, because every offset this module produces is
 * an *inset* — `edge` is `-(cellF.d - part.d) / 2`, flush to one face and inside
 * the other three; `corner` is `-(cellF.w - part.w) / 2` on both axes, the square
 * where two faces meet. Nothing overhangs at any anchor, so the union of a
 * template's parts is the cell, and 2 x 2 is 4.00. The 7.56 comes from reading
 * `fixture.ts`'s *corner* offsets as centres, which moves four of five parts
 * outward and unions to 2.75 x 2.75.
 *
 * The conversion below is the arithmetic the seam will need, and it is stated
 * once: a centre `o` in the cell-centre frame is the minimum corner
 * `o - E / 2 + cell / 2` in the cell-corner frame, where `E` is the part's extent
 * as drawn — `rotatedExtent(extent, yaw + intrinsic angle)`, so a `diag`'s own
 * 45° is carried too.
 */
describe('the offsets, placed by the canvas', () => {
  const QUARTERS = [0, 90, 180, 270] as const

  /**
   * The box one placement is drawn at: the fill's own rotated footprint, or the
   * residual where the rule narrowed it.
   *
   * The same two lines `builder/canvas/catalog.ts#templateSlotLayout` and
   * `scene.ts#drawnShape` run, which is what makes this block a measurement of
   * the seam rather than of a third convention. A residual is substituted for the
   * footprint and turned exactly like one — it arrives in the part's own frame —
   * and `boxShape` gives it the intrinsic angle 0 that a `rect` has.
   */
  function drawnAt(placement: SlotPlacement, shape: PlanShape): Extent {
    const drawn = placement.residual === undefined ? shape : boxShape(placement.residual)
    return rotatedExtent(drawn.extent, placement.yaw + drawn.angle)
  }

  /** One of this module's placements, read into the canvas's `SlotLayout`. */
  function layoutOf(placement: SlotPlacement, cell: Extent, foot: Footprint): SlotLayout {
    const shape = footprintShape(foot)
    if (shape === undefined) throw new Error(`${placement.part} has no shape`)
    const drawn = drawnAt(placement, shape)
    return {
      dx: placement.offset[0] - drawn.w / 2 + cell.w / 2,
      dz: placement.offset[1] - drawn.d / 2 + cell.d / 2,
      rotation: placement.yaw,
      elevationMm: 0,
      cell,
      ...(placement.residual === undefined ? {} : { residual: placement.residual }),
    }
  }

  /** Every placed slot's plan box, at one instance rotation, anchored at the origin. */
  function boxesAt(
    layout: TemplateLayout,
    feet: ReadonlyMap<SlotName, Footprint>,
    rotation: number,
  ): readonly PlanBox[] {
    const placed = placeTemplateSlots(layout, feet)
    const cell = placed.cell
    if (cell === undefined) throw new Error('the cell must resolve')
    return placed.slots.map((slot) => {
      const foot = feet.get(slot.part)
      if (foot === undefined) throw new Error(`${slot.part} has no fill`)
      const shape = footprintShape(foot)
      if (shape === undefined) throw new Error(`${slot.part} has no shape`)
      /* `boxShape` where the rule narrowed the slot, exactly as `scene.ts` does
         it — the narrowing has to reach the *shape* and not only the offset, or
         the part is drawn at its tagged extent from the residual's corner and
         hangs off the cell by what the walls took. */
      const drawn = slot.residual === undefined ? shape : boxShape(slot.residual)
      return slotGeometry(drawn, layoutOf(slot, cell, foot), [0, 0], rotation).box
    })
  }

  /** Whether two plan boxes share interior area. Abutting is not overlapping. */
  function boxesOverlap(a: PlanBox, b: PlanBox): boolean {
    const gap = 1e-9
    return (
      a.x + a.w - b.x > gap && b.x + b.w - a.x > gap && a.z + a.d - b.z > gap && b.z + b.d - a.z > gap
    )
  }

  function unionAt(
    layout: TemplateLayout,
    feet: ReadonlyMap<SlotName, Footprint>,
    rotation: number,
  ): PlanBox {
    const union = unionBox(boxesAt(layout, feet, rotation))
    if (union === undefined) throw new Error('a placed template must have a box')
    return union
  }

  it('tiles the cell — every closing template’s parts are pairwise disjoint and sum to it', () => {
    /* **The invariant the `residual` anchor bought, and the reason it is worth an
       anchor.** Under a `cell`-anchored floor the union was the cell *because the
       floor alone covered it*: the floor's box overlapped every wall and the
       column, so `unionAt` returning the cell said nothing about whether the
       parts fit together. Now they tile it.

       The `base` is excluded and it is the only exclusion: it is the one part
       that really does fill the whole cell, and it lies **under** everything at
       elevation 0 while the floor, walls and column all stand on it at 6 mm. So
       overlap in plan is not overlap in space for that pair, which is exactly
       what `overlap.ts` reads `SlotLayout.elevationMm` for.

       Areas as well as pairs, because disjointness alone would also be satisfied
       by parts that leave a gap: 1.5² + 1.5·0.5 + 1.5·0.5 + 0.5² is 4.00 on the
       corner, and 2·1.5 + 2·0.5 is 4.00 on the wall recipe. */
    const cases = [
      { layout: WALL_ON_TILE, feet: WALL_2X2, cell: { w: 2, d: 2 } },
      { layout: EXTERNAL_CORNER, feet: CORNER_2X2, cell: { w: 2, d: 2 } },
    ]
    for (const { layout, feet, cell } of cases) {
      for (const rotation of QUARTERS) {
        const placed = placeTemplateSlots(layout, feet)
        const boxes = placed.slots
          .map((slot, index) => ({ part: slot.part, box: boxesAt(layout, feet, rotation)[index] }))
          .filter((entry) => entry.part !== 'base')
        const where = `${layout.id} @${String(rotation)}`
        for (const [i, a] of boxes.entries()) {
          for (const b of boxes.slice(i + 1)) {
            /* Touching is not overlapping — the wall abuts the column and the
               floor abuts both — so the comparison is on open interiors, which
               is what `boxesOverlap` below computes and what `overlap.ts` means
               by a conflict. */
            expect(
              boxesOverlap(a.box as PlanBox, b.box as PlanBox),
              `${where}: ${a.part} vs ${b.part}`,
            ).toBe(false)
          }
        }
        const area = boxes.reduce((total, entry) => total + (entry.box?.w ?? 0) * (entry.box?.d ?? 0), 0)
        expect(area, where).toBeCloseTo(cell.w * cell.d, 9)
        expect(unionAt(layout, feet, rotation), where).toEqual(
          rotation % 180 === 0
            ? { x: 0, z: 0, w: cell.w, d: cell.d }
            : { x: -cell.d + cell.w, z: 0, w: cell.d, d: cell.w },
        )
      }
    }
  })

  it('lays a closing 2 x 2 wall-on-tile inside its own cell, at every quarter turn', () => {
    /* The 96-part convention, on the fills that close it — the run of the wall
       equals the width of the floor cell on 980 of the 1,143 walked wall
       combinations, which is what a piece spanning exactly one face looks like.
       Exact equality on the box, not a comparison of areas: the union *is* the
       cell, at the instance origin, whichever way the instance is turned. */
    for (const rotation of QUARTERS) {
      expect(unionAt(WALL_ON_TILE, WALL_2X2, rotation), `rotation ${String(rotation)}`).toEqual({
        x: 0,
        z: 0,
        w: 2,
        d: 2,
      })
    }
  })

  it('is 4.00 units² for a 2 x 2 corner, not 7.56 — with all five parts drawn', () => {
    /* The figure row A10 had to settle, measured from the conventions rather
       than from a fixture. Nothing overhangs the cell at 0°, so 7.56 could not
       have been the unrotated footprint of a 2 x 2 anything.

       **Row D8 strengthened this from three parts to five, and row D9 removed
       the overlap that made five parts fit.** A10 could measure only the base,
       the floor and the column, because the two walls earned `over-run` and were
       refused a coordinate. D8 placed them and the union was still the cell, but
       only because two 2-unit walls flush to two adjacent faces *overlapped* in
       the 0.5 corner square. On the measured 1.5 run they abut it instead: the
       three parts tile an L with no overlap and no gap, the doubts are gone, and
       the union is still exactly 4.00. So the answer to *"does the corrected
       footprint break A10's invariant"* is measured here and it is no — it holds
       more cleanly than before.

       The 2-unit run **is** outside the cell under this convention, which is the
       cost D8 named for it, and `still warns when a run is longer than the span
       its corner leaves` is where that is measured. It is unreachable from the
       archive: 0 records resolve to a 2-unit corner run. */
    const placed = placeTemplateSlots(EXTERNAL_CORNER, CORNER_2X2)
    expect(placed.doubts).toEqual([])
    expect(placed.slots).toHaveLength(5)

    /* The L, part by part, at rotation 0 — the picture the whole row is about.
       The column takes `[0, 0.5]` of both faces and each wall takes the 1.5 the
       column leaves on its own. Adjacent, not overlapping. */
    const boxes = boxesAt(EXTERNAL_CORNER, CORNER_2X2, 0)
    expect(boxes[2]).toEqual({ x: 0.5, z: 0, w: 1.5, d: 0.5 })
    expect(boxes[3]).toEqual({ x: 0, z: 0.5, w: 0.5, d: 1.5 })
    expect(boxes[4]).toEqual({ x: 0, z: 0, w: 0.5, d: 0.5 })

    for (const rotation of QUARTERS) {
      const union = unionAt(EXTERNAL_CORNER, CORNER_2X2, rotation)
      expect(union, `rotation ${String(rotation)}`).toEqual({ x: 0, z: 0, w: 2, d: 2 })
      expect(union.w * union.d).toBe(4)
    }

    // And every part is inside the cell at every quarter, part by part — the
    // property that makes the union figure mean "fits" rather than "cancels".
    for (const rotation of QUARTERS) {
      for (const box of boxesAt(EXTERNAL_CORNER, CORNER_2X2, rotation)) {
        expect(box.x, `rotation ${String(rotation)}`).toBeGreaterThanOrEqual(0)
        expect(box.z, `rotation ${String(rotation)}`).toBeGreaterThanOrEqual(0)
        expect(box.x + box.w, `rotation ${String(rotation)}`).toBeLessThanOrEqual(2)
        expect(box.z + box.d, `rotation ${String(rotation)}`).toBeLessThanOrEqual(2)
      }
    }
  })

  it('turns the column to a different corner of the same cell on each quarter', () => {
    /* The union being invariant would also be satisfied by ignoring the rotation
       entirely, so this pins the part that moves. `corner`, `side: 0` is the
       `(-x, -z)` square of the cell, and a quarter turn carries it round the
       four corners in the order `place` rotates: +x onto +z. */
    const corners = QUARTERS.map((rotation) => {
      const boxes = boxesAt(EXTERNAL_CORNER, CORNER_2X2, rotation)
      const box = boxes[boxes.length - 1]
      if (box === undefined) throw new Error('the column must place')
      return [box.x, box.z]
    })
    expect(corners).toEqual([
      [0, 0],
      [1.5, 0],
      [1.5, 1.5],
      [0, 1.5],
    ])
  })

  it('lays every closing wall-on-tile inside its cell, over six cells and their runs', () => {
    /* The general property rather than one number: for a wall whose run spans
       the cell's own face — the closing case, and 980 of 1,143 real ones — the
       union is exactly the cell at the origin on all four quarters, for every
       cell the corpus's 8 floor sizes cover and both wall thicknesses the
       measurements carry (0.5 on 3,079 walls, and the 1.5 `thick wall`).

       `thickness <= d` is a real condition and not a convenience: `edge`'s
       `-(cellF.d - part.d) / 2` is an *inset* only while the part is no deeper
       than the face it lies on, and the block below measures what happens when
       it is not. Every inset the corpus produces is <= 0 — see the four measured
       values above — so no real combination crosses it. */
    for (const [w, d] of [
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 2],
      [2, 4],
      [8, 8],
    ] as const) {
      for (const thickness of [WALL_THICKNESS_UNITS, 1.5].filter((value) => value <= d)) {
        const feet = feetOf([
          ['base', rect(w, d)],
          ['floor', rect(w, d)],
          ['wall', rect(w, thickness)],
        ])
        expect(placeTemplateSlots(WALL_ON_TILE, feet).verdict).toBe('closes')
        for (const rotation of QUARTERS) {
          // The cell, at the origin, with `w` and `d` swapped on an odd quarter
          // — which is the whole of "may swap width for depth, must not change
          // the area".
          const swapped = rotation % 180 !== 0
          expect(unionAt(WALL_ON_TILE, feet, rotation), `${w}x${d} t${thickness} @${rotation}`).toEqual({
            x: 0,
            z: 0,
            w: swapped ? d : w,
            d: swapped ? w : d,
          })
        }
      }
    }
  })

  it('overhangs the cell, symmetrically, when a part is deeper than the face it lies on', () => {
    /* The boundary of *"nothing overhangs"*, measured rather than assumed. A
       1.5-unit `thick wall` on a 1 x 1 cell has an inset of `+0.25`, so it
       stands 0.25 outside each of the two faces it does not lie along and the
       union is 1 x 1.5 rather than 1 x 1. The rigid body still holds — the
       union's area is 1.5 at every quarter and the extents swap — so this is a
       fact about the *convention* and not about the rotation.

       It is also where `x`/`z` stops being the minimum corner of the union: the
       canvas re-anchors by the *cell's* turned corner, so the overhang lands
       outside the origin on the two quarters that send it to -x or -z. The two
       readings coincide exactly when nothing overhangs, which is every
       combination the corpus produces: the four insets it yields are -1.25,
       -0.75, -0.25 and 0, all of them <= 0. */
    const feet = feetOf([
      ['base', rect(1, 1)],
      ['floor', rect(1, 1)],
      ['wall', rect(1, 1.5)],
    ])
    expect(slotOffset(ruleOf(WALL_ON_TILE, 'wall'), { w: 1, d: 1 }, { w: 1, d: 1.5 })).toEqual([0, 0.25])
    for (const rotation of QUARTERS) {
      const union = unionAt(WALL_ON_TILE, feet, rotation)
      expect(union.w * union.d, `rotation ${String(rotation)}`).toBe(1.5)
    }
    expect(unionAt(WALL_ON_TILE, feet, 0)).toEqual({ x: 0, z: 0, w: 1, d: 1.5 })
    expect(unionAt(WALL_ON_TILE, feet, 90)).toEqual({ x: -0.5, z: 0, w: 1.5, d: 1 })
  })

  it('abuts an edge against its corner sibling, so a closing corner has no overlap', () => {
    /* **The disagreement D8 measured and left open, now closed by measurement.**

       The closure check subtracts a `corner`-anchored sibling's span from the
       face, but `slotOffset`'s `edge` line used to have `dx: 0` — the wall
       centred across the *whole* face rather than across what the column leaves.
       The two disagreed whenever a corner recipe closed: two 1.5 walls and a 0.5
       column on a 2 x 2 cell was `closes` with no doubts, and the wall then ran
       through the column for 0.25 units and left a 0.25 gap at the far end. D8
       recorded the picture and declined to pick, because picking meant deciding
       whether a corner wall's tagged 2 units include the mitre.

       Row **D9** measured the mitre — 157 corner-wall meshes from R2, run 1.500
       on all 245 records tagged `size|width|2` — and the 1.5 is what makes the
       abutting convention the right one: 1.5 against 0.5 on a 2-unit face has
       exactly one arrangement that neither overlaps nor gaps, and it is this.

       It is also no longer unreachable on the corpus. All 34 walked combinations
       of the four external-corner recipes now `close`, where D8 measured 8
       `fails` and 26 `undecidable`, so this offset is what the archive really
       produces. */
    const placed = placeTemplateSlots(EXTERNAL_CORNER, CORNER_2X2)
    expect(placed.verdict).toBe('closes')
    expect(placed.doubts).toEqual([])

    const boxes = boxesAt(EXTERNAL_CORNER, CORNER_2X2, 0)
    const rightWall = boxes[2]
    const leftWall = boxes[3]
    const columnBox = boxes[4]
    /* The column takes x [0, 0.5] of the north face and the north wall takes the
       1.5 it leaves, [0.5, 2.0] — they meet at 0.5 and share nothing. The same
       on the west face in `z`. The boxes come from the canvas's own
       `slotGeometry`, so this is what the drawing does and not an arithmetic
       restatement of the offsets. */
    expect(rightWall).toEqual({ x: 0.5, z: 0, w: 1.5, d: 0.5 })
    expect(leftWall).toEqual({ x: 0, z: 0.5, w: 0.5, d: 1.5 })
    expect(columnBox).toEqual({ x: 0, z: 0, w: 0.5, d: 0.5 })
    // The union is still the cell and still rigid, at every quarter.
    for (const rotation of QUARTERS) {
      expect(unionAt(EXTERNAL_CORNER, CORNER_2X2, rotation)).toEqual({ x: 0, z: 0, w: 2, d: 2 })
    }
  })

  it('leaves the cell when a run is longer than the span its corner leaves', () => {
    /* The cost of the abutting convention, measured rather than asserted away —
       D8 named it as the reason not to take the edit without a measurement.

       A 2-unit run on a 2-unit face whose corner has already taken 0.5 has
       nowhere to go: abutted, it runs from 0.25 to 2.25 and a quarter unit of it
       is outside the cell, so the union is 2.25² and A10's 4.00 does not hold.
       That is exactly why the footprint had to be measured before this
       convention could be adopted — and it is unreachable from the archive,
       where every corner run is 1.5. */
    const placed = placeTemplateSlots(EXTERNAL_CORNER, CORNER_OVER_RUN)
    expect(placed.doubts.map((doubt) => doubt.code)).toEqual(['over-run', 'over-run'])
    const union = unionAt(EXTERNAL_CORNER, CORNER_OVER_RUN, 0)
    expect(union).toEqual({ x: 0, z: 0, w: 2.25, d: 2.25 })
    expect(union.w * union.d).toBeCloseTo(5.0625, 6)
    const boxes = boxesAt(EXTERNAL_CORNER, CORNER_OVER_RUN, 0)
    expect(boxes[2]).toEqual({ x: 0.25, z: 0, w: 2, d: 0.5 })
  })

  it('keeps every part on the quarter-unit lattice through a full circle', () => {
    /* The hazard this file's first block names, carried through the placement:
       three of the four measured insets are odd multiples of 0.25, and the
       canvas's re-anchoring is a *subtraction*, so it is the step that could
       reintroduce the 6.1e-17 the exact quarter-turn branches exist to avoid. */
    for (const rotation of QUARTERS) {
      for (const box of boxesAt(WALL_ON_TILE, WALL_2X2, rotation)) {
        for (const value of [box.x, box.z, box.w, box.d]) {
          expect(Number.isInteger(value * 4), `${String(value)} at ${String(rotation)}`).toBe(true)
        }
      }
    }
  })
})

/* ------------------------------------------------------------- inset fills */

/**
 * The third parameter, and the one defect it exists for.
 *
 * `rules.ts#isInsetFill` names the population — the 95 s2w bases, authored 0.5
 * short on every walled axis — and this block is what that predicate buys: the
 * base takes the box the floor beside it already takes, on the fill's say-so
 * rather than the recipe's.
 */
describe('placeTemplateSlots with insetParts', () => {
  const insetBase = new Set<SlotName>(['base'])

  it('leaves a plain base on the cell anchor with no residual extent', () => {
    const base = placeTemplateSlots(WALL_ON_TILE, WALL_2X2).slots.find((slot) => slot.part === 'base')
    expect(base?.anchor).toBe('cell')
    expect(base?.residual).toBeUndefined()
  })

  it('puts an inset base on the residual — the same box the floor already gets', () => {
    const placed = placeTemplateSlots(WALL_ON_TILE, WALL_2X2, insetBase)
    const base = placed.slots.find((slot) => slot.part === 'base')
    const floor = placed.slots.find((slot) => slot.part === 'floor')
    expect(base?.anchor).toBe('residual')
    /* 2 x 2 less a 0.5-deep wall on face 0. The measured mesh of
       `plain#base+s2w+square+wall.2x2` is 2.000 x 1.500. */
    expect(base?.residual).toEqual({ w: 2, d: 1.5 })
    expect(base?.offset).toEqual(floor?.offset)
    expect(base?.residual).toEqual(floor?.residual)
  })

  it('takes both faces off an external corner, which is what its mesh measures', () => {
    const base = placeTemplateSlots(EXTERNAL_CORNER, CORNER_2X2, insetBase).slots.find(
      (slot) => slot.part === 'base',
    )
    /* `plain#base+s2w+square+corner.2x2` measures 1.500 x 1.500 — two adjacent
       faces given up rather than one. */
    expect(base?.residual).toEqual({ w: 1.5, d: 1.5 })
  })

  it('is a no-op where the layout has no edge slot, because the residual is the cell', () => {
    const feet = feetOf([
      ['base', rect(2, 2)],
      ['floor', rect(2, 2)],
      ['column', column],
    ])
    const plain = placeTemplateSlots(INTERNAL_CORNER, feet).slots.find((slot) => slot.part === 'base')
    const inset = placeTemplateSlots(INTERNAL_CORNER, feet, insetBase).slots.find((slot) => slot.part === 'base')
    /* And the mesh agrees: `plain#base+square+s2w+internal_corner.2x2` is a full
       2.000 x 2.000, because it has no wall strip to give up. */
    expect(inset?.offset).toEqual(plain?.offset)
    expect(inset?.residual).toEqual({ w: 2, d: 2 })
  })

  it('does not move an edge or corner rule even when its part is named', () => {
    /* Only a `cell` rule can move. An `edge` rule is anchored to a face, and a
       fill being inset says nothing about which face it gave up. */
    const placed = placeTemplateSlots(EXTERNAL_CORNER, CORNER_2X2, new Set<SlotName>(['right wall', 'column']))
    expect(placed.slots.find((slot) => slot.part === 'right wall')?.anchor).toBe('edge')
    expect(placed.slots.find((slot) => slot.part === 'column')?.anchor).toBe('corner')
  })

  it('does not let an inset base change what the walls take off the cell', () => {
    /* `edgeInsets` reads `rule.anchor`, not the effective one, and it must: the
       residual is defined *by* the edge slots, so an inset base that fed back
       into the insets would shrink the box it is being fitted to. */
    const plain = placeTemplateSlots(WALL_ON_TILE, WALL_2X2)
    const inset = placeTemplateSlots(WALL_ON_TILE, WALL_2X2, insetBase)
    const wallOf = (placed: typeof plain) => placed.slots.find((slot) => slot.part === 'wall')
    expect(wallOf(inset)?.offset).toEqual(wallOf(plain)?.offset)
    expect(inset.cell).toEqual(plain.cell)
  })
})
