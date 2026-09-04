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
 *   3. **The elevation must come from the one existing measurement.**
 *      `bases.ts#baseElevationMm` is that measurement and this row does not
 *      import it — row A4b owns the file and row A2 reports it may be deleted.
 *      So the block below pins the **contract** that function satisfies (the
 *      upright z extent of the resting mesh, with a fallback when the mesh is
 *      absent) and proves {@link slotElevationMm} composes it without adding
 *      arithmetic of its own.
 */
import { describe, expect, it } from 'vitest'

import { SNAP_STEP, snapTo } from '@/builder/canvas'
import type { Footprint } from '@/catalog'
import { WALL_THICKNESS_UNITS } from '@/catalog'

import {
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
 * The 8 failures, verbatim from the corpus.
 *
 * The closure walk resolves the four `single_piece` corner recipes and gets
 * `right wall` and `left wall` both at `{shape:'wall',length:2}` on a
 * `rect 2 x 2` floor, on 8 of 34 walked combinations. Two 2-unit runs plus a
 * 0.5 column cannot occupy two 2-unit edges, and **the mitre that would make
 * them fit is in no tag and in no measured mesh** — 0 of the 266
 * `shape|corner|left`/`right` records have a measured bounding box.
 */
const CORNER_MITRE = feetOf([
  ['base', rect(2, 2)],
  ['floor', rect(2, 2)],
  ['right wall', wall(2)],
  ['left wall', wall(2)],
  ['column', column],
])

/** The same recipe with 1.5-unit walls, which is what the `modular` half resolves to. */
const CORNER_CLOSING = feetOf([
  ['base', rect(2, 2)],
  ['floor', rect(2, 2)],
  ['right wall', wall(1.5)],
  ['left wall', wall(1.5)],
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

  it('places a closing external corner, and subtracts the column from both edges', () => {
    const placed = placeTemplateSlots(EXTERNAL_CORNER, CORNER_CLOSING)
    expect(placed.verdict).toBe('closes')
    // 1.5 + 0.5 = 2 on both faces, which is why the modular half closes where
    // the single-piece half does not.
    expect(placed.slots).toHaveLength(5)
    const byPart = new Map(placed.slots.map((slot) => [slot.part, slot]))
    expect(byPart.get('right wall')?.offset).toEqual([0, -0.75])
    expect(byPart.get('right wall')?.yaw).toBe(0)
    expect(byPart.get('left wall')?.offset).toEqual([-0.75, 0])
    expect(byPart.get('left wall')?.yaw).toBe(270)
    expect(byPart.get('column')?.offset).toEqual([-0.75, -0.75])
  })

  it('surfaces the 8 single-piece mitres as needing a choice, and writes no 1.5', () => {
    /* §9 of the plan, verbatim: *"the mitre is in no tag and no measurement. Do
       not silently write 1.5."* So the verdict is `fails`, the two walls get no
       coordinate at all, and the doubt reports the edge and the sum — never the
       difference and never a corrected run. */
    const placed = placeTemplateSlots(EXTERNAL_CORNER, CORNER_MITRE)
    expect(placed.verdict).toBe('fails')
    expect(placed.doubts).toEqual([
      { part: 'right wall', code: 'over-run', want: 2, got: 2.5 },
      { part: 'left wall', code: 'over-run', want: 2, got: 2.5 },
    ])
    expect(placed.slots.map((slot) => slot.part)).toEqual(['base', 'floor', 'column'])
    expect(JSON.stringify(placed)).not.toContain('1.5')
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
