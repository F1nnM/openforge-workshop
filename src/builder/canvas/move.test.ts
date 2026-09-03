/**
 * The move operation, headless.
 *
 * **What these tests prove:** the arithmetic of a drag — that the grab offset is
 * preserved, that every proposal lands on the snap lattice, that rotation is
 * untouched at 45° and 90° steps alike, that an overlap is *reported and
 * allowed* while an identical twin is *refused*, and that the concentric-snap
 * limitation is disclosed on exactly the pieces it applies to.
 *
 * **What they cannot prove:** anything about the gesture. There is no pointer, no
 * canvas and no store here; whether `Shift`+drag reaches `beginMove` is
 * `canvas.test.tsx`'s question, and whether the preview *looks* like the piece is
 * nobody's — jsdom lays out no SVG and rasterises no pixel, so both files assert
 * the geometry that was emitted and never its appearance.
 *
 * The overlap numbers here are also not a re-proof of `overlap.ts`. That module
 * proves its own error direction over 240 randomised pairs; this file only checks
 * that a move routes through the same predicate rather than approximating it,
 * which is the property that matters — a false negative would ship a room that
 * cannot be printed.
 */
import { describe, expect, it } from 'vitest'

import type { PlacementId, WorkshopState } from '@/store'

import { createStyleResolver, planCatalogFromFile } from './catalog'
import { FIXTURE_IDS, fixtureCatalogFile, fixtureDesignOf } from './fixture'
import { SNAP_STEP } from './geometry'
import {
  beginMove,
  concentricNote,
  concentricOffset,
  describeCancel,
  describeDrop,
  describeGrab,
  describeMoveHint,
  describeNudge,
  dragMoveTo,
  isConcentricOnLattice,
  nudgeMove,
  previewMove,
} from './move'
import type { MoveDrag } from './move'
import { buildPlanScene } from './scene'
import type { PlanPiece, PlanScene } from './scene'

const file = fixtureCatalogFile()
const catalog = planCatalogFromFile(file)
const styleOf = createStyleResolver(catalog)

/**
 * The record a fixture file id names.
 *
 * Through `fixtureDesignOf` since row V4: `PlanCatalog.record` is keyed by
 * design and resolves the variant the build would print, and with one file per
 * fixture design that is the file asked for.
 */
const record = (id: string) => {
  const found = catalog.record(fixtureDesignOf(id))
  if (found === undefined) throw new Error(`no fixture record ${id}`)
  return found
}

/** A scene from `[key, tileId, x, z, rotation]` tuples — `plan.test.ts`'s shape, `fixtureDesignOf` included. */
function sceneOf(rows: readonly [string, string, number, number, number][]): PlanScene {
  const placements: WorkshopState['placements'] = {}
  for (const [key, tileId, x, z, rotation] of rows) {
    placements[key as PlacementId] = { design: fixtureDesignOf(tileId), x, z, rotation }
  }
  return buildPlanScene(placements, catalog, styleOf)
}

function piece(scene: PlanScene, key: string): PlanPiece {
  const found = scene.pieces.find((candidate) => candidate.id === (key as PlacementId))
  if (found === undefined) throw new Error(`no piece ${key} in the scene`)
  return found
}

/** The drag a grab-then-carry produces, as one expression. */
function carried(scene: PlanScene, key: string, dx: number, dz: number, step = SNAP_STEP.fine): MoveDrag {
  return nudgeMove(beginMove(piece(scene, key), null), dx, dz, step)
}

describe('picking a piece up', () => {
  it('starts where the piece is, so an untouched drag is a no-op', () => {
    const scene = sceneOf([['a', FIXTURE_IDS.floor2, 2, 3, 0]])
    const drag = beginMove(piece(scene, 'a'), null)

    expect(drag.origin).toEqual([2, 3])
    expect(drag.anchor).toEqual([2, 3])
    const preview = previewMove(drag, scene)
    expect(preview?.unchanged).toBe(true)
    expect(preview?.committable).toBe(false)
  })

  it('reports the piece as the scene holds it, not as a copy', () => {
    // The point of reading through the scene: `R` can be pressed mid-move, and
    // the store write it makes has to reach the preview.
    const before = sceneOf([['a', FIXTURE_IDS.wall2, 0, 0, 0]])
    const drag = beginMove(piece(before, 'a'), null)
    const after = sceneOf([['a', FIXTURE_IDS.wall2, 0, 0, 90]])

    const preview = previewMove(drag, after)
    // The 2 x 0.5 wall turned a quarter turn: the box is 0.5 x 2 about the same
    // anchor corner, which is `geometry.ts`'s anchoring rule.
    expect(preview?.box.w).toBe(0.5)
    expect(preview?.box.d).toBe(2)
    expect(preview?.angle).toBe(90)
  })

  it('gives up rather than throwing when the piece has gone', () => {
    const scene = sceneOf([['a', FIXTURE_IDS.floor1, 0, 0, 0]])
    const drag = beginMove(piece(scene, 'a'), null)
    expect(previewMove(drag, sceneOf([]))).toBeUndefined()
  })
})

describe('a pointer drag', () => {
  it('keeps the piece under the part of it that was grabbed', () => {
    // Grab a 2 x 2 floor near its bottom-right corner and drag one unit right.
    // The piece must travel one unit, not leap so its centre lands on the
    // pointer — which is the specific annoyance the row is about.
    const scene = sceneOf([['a', FIXTURE_IDS.floor2, 0, 0, 0]])
    const drag = beginMove(piece(scene, 'a'), [1.8, 1.8])

    expect(dragMoveTo(drag, [2.8, 1.8], SNAP_STEP.fine).anchor).toEqual([1, 0])
    expect(dragMoveTo(drag, [1.8, 2.8], SNAP_STEP.fine).anchor).toEqual([0, 1])
  })

  it('snaps every proposal onto the lattice, at both steps', () => {
    const scene = sceneOf([['a', FIXTURE_IDS.wall2, 0, 0, 0]])
    const drag = beginMove(piece(scene, 'a'), [0, 0])

    for (const step of [SNAP_STEP.fine, SNAP_STEP.coarse]) {
      for (const raw of [0.13, 0.37, 1.61, 2.49, -0.8]) {
        const { anchor } = dragMoveTo(drag, [raw, raw], step)
        expect(Number.isInteger(anchor[0] / step)).toBe(true)
        expect(Number.isInteger(anchor[1] / step)).toBe(true)
      }
    }
  })

  it('ignores a world point when the grab was a keyboard one', () => {
    const scene = sceneOf([['a', FIXTURE_IDS.floor1, 0, 0, 0]])
    const drag = beginMove(piece(scene, 'a'), null)
    expect(dragMoveTo(drag, [5, 5], SNAP_STEP.fine)).toBe(drag)
  })
})

describe('a keyboard carry', () => {
  it('accumulates, so twenty presses travel twenty steps', () => {
    const scene = sceneOf([['a', FIXTURE_IDS.floor1, 0, 0, 0]])
    let drag = beginMove(piece(scene, 'a'), null)
    for (let i = 0; i < 20; i += 1) drag = nudgeMove(drag, SNAP_STEP.fine, 0, SNAP_STEP.fine)
    expect(drag.anchor).toEqual([10, 0])
    // And the origin is still the origin, which is what makes a cancel exact.
    expect(drag.origin).toEqual([0, 0])
  })

  it('regularises a placement that arrived off the lattice', () => {
    // `src/share/payload.ts` falls back to eight bytes for a coordinate that is
    // not a multiple of 0.5, so an imported scene really can hold one. The first
    // nudge is the only way the builder has to put it back on the grid.
    const scene = sceneOf([['a', FIXTURE_IDS.floor1, 1.3, -0.2, 0]])
    const drag = nudgeMove(beginMove(piece(scene, 'a'), null), SNAP_STEP.fine, 0, SNAP_STEP.fine)
    expect(drag.anchor).toEqual([2, 0])
  })

  it('returns the same object when the step rounds to no change', () => {
    // Identity, not equality: the canvas re-renders on the drag object, and a
    // fresh object per key-repeat would re-render for nothing.
    const scene = sceneOf([['a', FIXTURE_IDS.floor1, 0, 0, 0]])
    const drag = beginMove(piece(scene, 'a'), null)
    expect(nudgeMove(drag, 0, 0, SNAP_STEP.fine)).toBe(drag)
  })
})

describe('rotation survives a move', () => {
  it('carries a 45° angle through, on a tile whose step is 45', () => {
    const scene = sceneOf([['a', FIXTURE_IDS.angled, 0, 0, 45]])
    const preview = previewMove(carried(scene, 'a', 1.5, 0), scene)
    expect(preview?.piece.placement.rotation).toBe(45)
    expect(preview?.angle).toBe(45)
  })

  it('keeps a diag’s intrinsic 45° folded into the drawn angle', () => {
    // The `diag` case: `placement.rotation` is 0 and the drawn angle is 45, and
    // it is the drawn angle that decides `axisAligned` — which is what the
    // corner-junction exemption reads.
    const scene = sceneOf([['a', FIXTURE_IDS.diag, 0, 0, 0]])
    const preview = previewMove(carried(scene, 'a', 1, 1), scene)
    expect(preview?.piece.placement.rotation).toBe(0)
    expect(preview?.angle).toBe(45)
    expect(preview?.axisAligned).toBe(false)
  })

  it('moves an arc at a sub-90° sweep without touching its angle', () => {
    const scene = sceneOf([['a', FIXTURE_IDS.arcFallback, 0, 0, 22.5]])
    const preview = previewMove(carried(scene, 'a', 2, 0), scene)
    expect(preview?.piece.placement.rotation).toBe(22.5)
    expect(preview?.anchor).toEqual([2, 0])
  })
})

describe('a blocked move', () => {
  it('reports an overlap and allows it — overlap.ts informs, never prevents', () => {
    const scene = sceneOf([
      ['a', FIXTURE_IDS.floor2, 0, 0, 0],
      ['b', FIXTURE_IDS.floor2, 4, 0, 0],
    ])
    // Carry `b` half a unit into `a`. Half a unit and not the whole way: landing
    // exactly on `a` would be the *twin* case below, which is the one thing a
    // move refuses, and this test is about the case it allows.
    const preview = previewMove(carried(scene, 'b', -3.5, 0), scene)
    expect(preview?.overlaps.map((hit) => hit.id)).toEqual(['a'])
    expect(preview?.conflict).toBe(true)
    expect(preview?.refusal).toBeNull()
    expect(preview?.committable).toBe(true)
    expect(describeDrop(preview!)).toContain('overlapping 1 piece already there')
  })

  it('never counts the piece against itself', () => {
    const scene = sceneOf([['a', FIXTURE_IDS.floor2, 0, 0, 0]])
    // Half a unit, so the piece's old and new boxes genuinely intersect.
    const preview = previewMove(carried(scene, 'a', 0.5, 0), scene)
    expect(preview?.overlaps).toEqual([])
    expect(preview?.conflict).toBe(false)
  })

  it('refuses an identical twin, and says what it would have cost', () => {
    const scene = sceneOf([
      ['a', FIXTURE_IDS.floor1, 0, 0, 0],
      ['b', FIXTURE_IDS.floor1, 3, 0, 0],
    ])
    const preview = previewMove(carried(scene, 'b', -3, 0), scene)
    expect(preview?.refusal?.code).toBe('duplicate')
    expect(preview?.refusal?.message).toContain('double its line in the bill')
    expect(preview?.committable).toBe(false)
  })

  it('does not call it a twin when the angle differs', () => {
    // Same tile, same square, different angle: a physically distinct placement,
    // visible on the plan, and two separate lines are the truth.
    const scene = sceneOf([
      ['a', FIXTURE_IDS.wall2, 0, 0, 0],
      ['b', FIXTURE_IDS.wall2, 4, 0, 90],
    ])
    const preview = previewMove(carried(scene, 'b', -4, 0), scene)
    expect(preview?.refusal).toBeNull()
    expect(preview?.committable).toBe(true)
  })

  it('respects the corner-junction exemption rather than re-deriving it', () => {
    // Two perpendicular walls meeting at a corner share the 0.5 x 0.5 square
    // that *is* the corner. `overlap.ts` exempts it; a move that had its own
    // collision rule would light up every corner in every room.
    const scene = sceneOf([
      ['a', FIXTURE_IDS.wall2, 0, 0, 0],
      ['b', FIXTURE_IDS.wall2, 6, 6, 90],
    ])
    const preview = previewMove(carried(scene, 'b', -6, -6), scene)
    expect(preview?.anchor).toEqual([0, 0])
    expect(preview?.conflict).toBe(false)
  })

  it('does not flag a wall carried onto a floor tile — the bands differ', () => {
    const scene = sceneOf([
      ['a', FIXTURE_IDS.floor2, 0, 0, 0],
      ['b', FIXTURE_IDS.wall2, 6, 0, 0],
    ])
    const preview = previewMove(carried(scene, 'b', -6, 0.5), scene)
    expect(preview?.piece.band).toBe('edge')
    expect(preview?.conflict).toBe(false)
  })
})

describe('the concentric-snap limitation', () => {
  it('is nothing at all for a straight footprint', () => {
    expect(concentricOffset(record(FIXTURE_IDS.floor2).foot)).toBe(0)
    expect(isConcentricOnLattice(record(FIXTURE_IDS.wall2).foot)).toBe(true)
    expect(concentricNote(record(FIXTURE_IDS.diag).foot)).toBeNull()
  })

  it('is nothing for a sector whose centre sits on the box corner', () => {
    // The fixture's `arc` is a quarter disc at rIn 0, so `rIn·cos θ` is 0 twice
    // over. 554 of the corpus's 1,199 arcs are at a 90° sweep, where the cosine
    // alone forces it.
    const foot = record(FIXTURE_IDS.arc).foot
    expect(foot.shape).toBe('arc')
    expect(concentricOffset(foot)).toBe(0)
    expect(isConcentricOnLattice(foot)).toBe(true)
    expect(concentricNote(foot)).toBeNull()
  })

  it('discloses it for a 45° sector with an inner radius', () => {
    // rIn 3.5 at a 45° sweep: 3.5·cos 45° = 2.474…, which is not a multiple of
    // half a unit, so no anchor on this lattice makes two of these concentric.
    // 645 of the 1,199 arcs are in that population (439 at 45°, 186 at 22.5°, 20
    // at 11.25°) and not one arc in the corpus has a non-zero offset that *is*
    // on the lattice.
    const foot = record(FIXTURE_IDS.arcFallback).foot
    expect(concentricOffset(foot)).toBeCloseTo(2.474874, 6)
    expect(isConcentricOnLattice(foot)).toBe(false)
    expect(concentricNote(foot)?.code).toBe('off-lattice-centre')
    expect(concentricNote(foot)?.message).toContain('cannot line it up concentrically')
  })

  it('is written as the arithmetic, so an on-lattice offset would pass', () => {
    // A 60° sweep at rIn 3 gives 3·cos 60° = 1.5 exactly — on the lattice, and
    // mateable. No corpus arc has that sweep; the predicate is the reason, not
    // the data.
    expect(isConcentricOnLattice({ shape: 'arc', rIn: 3, rOut: 3.5, sweep: 60, band: 'radial', bandBasis: 'fallback' })).toBe(
      true,
    )
  })

  it('is said at the grab, where it can still change the drag', () => {
    const scene = sceneOf([['a', FIXTURE_IDS.arcFallback, 0, 0, 0]])
    const preview = previewMove(beginMove(piece(scene, 'a'), null), scene)
    expect(describeGrab(preview!)).toContain('cannot line it up concentrically')
  })
})

describe('what the live region says', () => {
  const scene = sceneOf([
    ['a', FIXTURE_IDS.floor2, 0, 0, 0],
    ['b', FIXTURE_IDS.wall2, 6, 6, 0],
  ])

  it('names the piece and the keys on the grab', () => {
    const preview = previewMove(beginMove(piece(scene, 'b'), null), scene)
    expect(describeGrab(preview!)).toContain('Picked up Cut stone wall 2')
    expect(describeGrab(preview!)).toContain('x 6, z 6')
    expect(describeGrab(preview!)).toContain('Escape puts it back')
  })

  it('is short on a step, and says where the piece is', () => {
    const preview = previewMove(carried(scene, 'b', 1, 0), scene)
    expect(describeNudge(preview!)).toBe('Cut stone wall 2 to x 7, z 6.')
  })

  it('says so when a carry has come back to where it started', () => {
    const preview = previewMove(carried(scene, 'b', 0, 0), scene)
    expect(describeNudge(preview!)).toContain('where it started')
  })

  it('names both ends on a drop', () => {
    const preview = previewMove(carried(scene, 'b', -1, 0), scene)
    expect(describeDrop(preview!)).toBe('Moved Cut stone wall 2 from x 6, z 6 to x 5, z 6.')
  })

  it('reports a no-op drop as one rather than silently', () => {
    const preview = previewMove(beginMove(piece(scene, 'b'), null), scene)
    expect(describeDrop(preview!)).toContain('Nothing moved')
  })

  it('says where a cancelled piece went back to', () => {
    const preview = previewMove(carried(scene, 'b', 3, 3), scene)
    expect(describeCancel(preview!)).toBe('Put Cut stone wall 2 back at x 6, z 6.')
  })

  it('pluralises the overlap count', () => {
    const four = sceneOf([
      ['a', FIXTURE_IDS.floor1, 0, 0, 0],
      ['b', FIXTURE_IDS.floor1, 1, 0, 0],
      ['c', FIXTURE_IDS.floor2, 8, 8, 0],
    ])
    const preview = previewMove(carried(four, 'c', -8, -8), four)
    expect(preview?.overlaps).toHaveLength(2)
    expect(describeDrop(preview!)).toContain('overlapping 2 pieces already there')
  })

  it('lets the refusal own the hint when there is one', () => {
    const twins = sceneOf([
      ['a', FIXTURE_IDS.floor1, 0, 0, 0],
      ['b', FIXTURE_IDS.floor1, 3, 0, 0],
    ])
    const preview = previewMove(carried(twins, 'b', -3, 0), twins)
    expect(describeMoveHint(preview!)).toBe(preview?.refusal?.message)
  })

  it('otherwise tells the hint plate how to finish the move', () => {
    const preview = previewMove(carried(scene, 'b', 1, 0), scene)
    expect(describeMoveHint(preview!)).toContain('Moving Cut stone wall 2 to x 7, z 6')
    expect(describeMoveHint(preview!)).toContain('Escape puts it back')
  })
})
