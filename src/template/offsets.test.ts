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
  footprintShape,
  rotatedExtent,
  slotGeometry,
  snapTo,
  unionBox,
} from '@/builder/canvas'
import type { Extent, PlanBox, SlotLayout } from '@/builder/canvas'
import type { Footprint } from '@/catalog'
import { WALL_THICKNESS_UNITS } from '@/catalog'

import type { SlotPlacement } from './offsets'
import {
  cornerReservation,
  edgeRun,
  placeTemplateSlots,
  quarterTurn,
  slotDoubtSentence,
  slotElevationMm,
  slotOffset,
  slotYaw,
} from './offsets'
import type { SlotName, SlotRule, TemplateLayout } from './rules'
import { EXTERNAL_CORNER, INTERNAL_CORNER, SLOT_CONVENTIONS, WALL_ON_TILE, ruleFor } from './rules'

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
    // anchor: 8 distinct floor footprints and 25 base footprints reach here.
    expect(slotOffset(ruleOf(WALL_ON_TILE, 'floor'), { w: 4, d: 2 }, { w: 1, d: 1 })).toEqual([0, 0])
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
    const north: SlotRule = { part: 'wall', anchor: 'edge', side: 0, restsOn: 'base' }
    const east: SlotRule = { part: 'wall', anchor: 'edge', side: 1, restsOn: 'base' }
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
        for (const cell of cells) {
          for (const part of parts) {
            const rule: SlotRule = { part: 'wall', anchor, side, restsOn: 'base' }
            const inFrame = rotatedExtent(cell, side * 90)
            const dz = -(inFrame.d - part.d) / 2
            const dx = anchor === 'corner' ? -(inFrame.w - part.w) / 2 : 0
            expect(slotOffset(rule, cell, part), `${anchor}/${String(side)}`).toEqual(
              quarterTurn([dx, dz], side),
            )
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
  it('is side * 90, and is not stored anywhere it could disagree with the side', () => {
    expect(
      SLOT_CONVENTIONS.flatMap((convention) => convention.slots)
        .map(slotYaw)
        .sort((a, b) => a - b),
    ).toEqual(
      /* 11 slots over the three conventions: 9 on the reference face, the
         external corner's left wall at 270 and the internal corner's column at
         180. */
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 180, 270],
    )
    for (const side of [0, 1, 2, 3] as const) {
      const rule: SlotRule = { part: 'wall', anchor: 'edge', side, restsOn: null }
      expect(slotYaw(rule)).toBe(side * 90)
      expect(rule).not.toHaveProperty('yaw')
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
    expect([...numbers].sort((a, b) => a - b)).toEqual([0, 2, 3])
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
        { part: 'floor', anchor: 'cell', side: 0, restsOn: 'wall' },
        { part: 'wall', anchor: 'edge', side: 0, restsOn: 'floor' },
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
    expect(placed.slots.map((slot) => slot.offset)).toEqual([
      [0, 0],
      [0, 0],
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

  /** One of this module's placements, read into the canvas's `SlotLayout`. */
  function layoutOf(placement: SlotPlacement, cell: Extent, foot: Footprint): SlotLayout {
    const shape = footprintShape(foot)
    if (shape === undefined) throw new Error(`${placement.part} has no shape`)
    const drawn = rotatedExtent(shape.extent, placement.yaw + shape.angle)
    return {
      dx: placement.offset[0] - drawn.w / 2 + cell.w / 2,
      dz: placement.offset[1] - drawn.d / 2 + cell.d / 2,
      rotation: placement.yaw,
      elevationMm: 0,
      cell,
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
      return slotGeometry(shape, layoutOf(slot, cell, foot), [0, 0], rotation).box
    })
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
