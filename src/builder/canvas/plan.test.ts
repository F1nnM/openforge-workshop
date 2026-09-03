/**
 * Overlap, the scene projection and the ghost. Headless.
 *
 * The load-bearing test in this file is the one that *fails to fire*: a wall
 * lying on the edge of a floor tile must not be reported as an overlap, because
 * that is how OpenForge is built (3,351 tiles are `build|separate wall`, 863 are
 * `build|wall on tile`) and a canvas that flagged it would flag every wall in
 * every room.
 */
import { describe, expect, it } from 'vitest'

import type { PlacementId, WorkshopState } from '@/store'

import { createStyleResolver, planCatalogFromFile } from './catalog'
import type { DesignId } from '@/catalog'

import { FIXTURE_IDS, fixtureCatalogFile, fixtureDesignOf } from './fixture'
import { computeGhost, ghostOverlaps } from './ghost'
import { SNAP_STEP, planBox, planQuad } from './geometry'
import { findConflicts, partsOverlap, planBand, quadsOverlap } from './overlap'
import type { OverlapCandidate } from './overlap'
import { buildPlanScene, navigationOrder, pieceAt } from './scene'
import { sectorSlack } from './sector'

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

/**
 * A scene from a list of `[key, tileId, x, z, rotation]` tuples.
 *
 * The tuple still names a **file**, because that is what a canvas test is about
 * — which outline, which band, which tint — and `fixtureDesignOf` carries it to
 * the item a placement actually holds since row V4. Every fixture record is its
 * own design, so the conversion is injective and the scene draws exactly the
 * file the tuple names.
 */
function sceneOf(rows: readonly [string, string, number, number, number][]): WorkshopState['placements'] {
  const placements: WorkshopState['placements'] = {}
  for (const [key, tileId, x, z, rotation] of rows) {
    placements[key as PlacementId] = { design: fixtureDesignOf(tileId), x, z, rotation }
  }
  return placements
}

const candidate = (id: string, band: 'area' | 'edge', x: number, z: number, w: number, d: number): OverlapCandidate => ({
  id: id as PlacementId,
  band,
  box: { x, z, w, d },
  parts: [planQuad({ w, d }, 0, x, z)],
  axisAligned: true,
})


describe('bands', () => {
  it('files a wall footprint as an edge piece', () => {
    expect(planBand(record(FIXTURE_IDS.wall2))).toBe('edge')
  })

  it('files a thick wall that arrives as a rect as an edge piece too', () => {
    expect(record(FIXTURE_IDS.thickWall).foot.shape).toBe('rect')
    expect(planBand(record(FIXTURE_IDS.thickWall))).toBe('edge')
  })

  it('files a floor as an area piece', () => {
    expect(planBand(record(FIXTURE_IDS.floor2))).toBe('area')
  })

  it('files an unbucketed tile as an area piece — the conservative answer', () => {
    expect(record(FIXTURE_IDS.shapeless).kinds).toEqual([])
    expect(planBand(record(FIXTURE_IDS.shapeless))).toBe('area')
  })

  it('files a column as an edge piece on its footprint, not on its kinds', () => {
    // One of the 75 tiles this changed: `kinds` is ['column'] with no 'wall', so
    // the kind heuristic alone would call a 12.70 x 12.70 mm pillar a floor and
    // then flag it against the floor it stands on.
    expect(record(FIXTURE_IDS.column).kinds).toEqual(['column'])
    expect(planBand(record(FIXTURE_IDS.column))).toBe('edge')
  })

  it('files a diagonal wall run as an edge piece', () => {
    expect(planBand(record(FIXTURE_IDS.diag))).toBe('edge')
  })

  it('files a curve whose band is one wall thickness wide as an edge piece', () => {
    // `convex` is [R-0.5, R] — a curved *wall*, whatever its kinds say. 248 of
    // the corpus's curved walls carry base/floor/stairs kinds because the curve
    // belongs to a floor family.
    expect(planBand(record(FIXTURE_IDS.arcFallback))).toBe('edge')
  })

  it('files a wide curve on its kinds, since its band is a floor and not a wall', () => {
    // The fixture's quarter disc is [0, 2] — two units of band, a floor.
    expect(planBand(record(FIXTURE_IDS.arc))).toBe('area')
  })

  it('files a filled right triangle as an area piece', () => {
    expect(planBand(record(FIXTURE_IDS.tri))).toBe('area')
  })
})

describe('overlap', () => {
  it('does not flag a wall lying over the edge of a floor tile', () => {
    // The 2 × 2 floor fills [0,2]², and the wall band is [0,2] × [0,0.5] — fully
    // inside it. A tile-versus-tile box test reports a collision here; the real
    // build has the wall standing on or beside the floor.
    const conflicts = findConflicts([
      candidate('floor', 'area', 0, 0, 2, 2),
      candidate('wall', 'edge', 0, 0, 2, 0.5),
    ])
    expect([...conflicts]).toEqual([])
  })

  it('flags two floors in the same square', () => {
    const conflicts = findConflicts([
      candidate('a', 'area', 0, 0, 2, 2),
      candidate('b', 'area', 1, 1, 1, 1),
    ])
    expect([...conflicts].sort()).toEqual(['a', 'b'])
  })

  it('flags two walls on the same edge', () => {
    const conflicts = findConflicts([
      candidate('a', 'edge', 0, 0, 2, 0.5),
      candidate('b', 'edge', 1, 0, 2, 0.5),
    ])
    expect([...conflicts].sort()).toEqual(['a', 'b'])
  })

  it('treats a shared face as touching, not overlapping', () => {
    const conflicts = findConflicts([
      candidate('a', 'area', 0, 0, 1, 1),
      candidate('b', 'area', 1, 0, 1, 1),
      candidate('c', 'area', 0, 1, 1, 1),
    ])
    expect([...conflicts]).toEqual([])
  })

  it('tests turned pieces as shapes, not as bounding boxes', () => {
    // Two 2 × 2 tiles turned 45° and offset diagonally. Their bounding boxes
    // share a half-unit corner; the diamonds inside them are nowhere near each
    // other, which is the whole reason this is a separating-axis test.
    const box = planBox({ w: 2, d: 2 }, 45, 0, 0)
    const offset = box.w - 0.5
    expect(offset).toBeLessThan(box.w)
    const a = planQuad({ w: 2, d: 2 }, 45, 0, 0)
    const apart = planQuad({ w: 2, d: 2 }, 45, offset, offset)
    expect(quadsOverlap(a, apart)).toBe(false)
    const across = planQuad({ w: 2, d: 2 }, 45, 1, 0)
    expect(quadsOverlap(a, across)).toBe(true)
  })

  it('composes over convex parts, so any part touching any part is a hit', () => {
    // The union of convex sets is not convex, so SAT cannot be handed the union;
    // `partsOverlap` is the pairwise composition a sector needs.
    const left = [planQuad({ w: 1, d: 1 }, 0, 0, 0), planQuad({ w: 1, d: 1 }, 0, 4, 0)]
    const right = [planQuad({ w: 1, d: 1 }, 0, 4.5, 0)]
    expect(quadsOverlap(left[0] ?? [], right[0] ?? [])).toBe(false)
    expect(partsOverlap(left, right)).toBe(true)
  })

  it('exempts two perpendicular walls meeting at a corner', () => {
    // The landing hero's chamber has three of these. Flagging them would light up
    // the drawing the app puts on its own front door.
    const conflicts = findConflicts([
      candidate('north', 'edge', 0, 0, 4, 0.5),
      candidate('west', 'edge', 0, 0, 0.5, 4),
    ])
    expect([...conflicts]).toEqual([])
  })

  it('still flags two parallel walls overlapping by the same half unit', () => {
    // Same shared area as a corner, and no corner piece resolves it.
    const conflicts = findConflicts([
      candidate('a', 'edge', 0, 0, 2, 0.5),
      candidate('b', 'edge', 1.5, 0, 2, 0.5),
    ])
    expect([...conflicts].sort()).toEqual(['a', 'b'])
  })

  it('does not exempt a corner-sized overlap of two floors', () => {
    const conflicts = findConflicts([
      candidate('a', 'area', 0, 0, 2, 2),
      candidate('b', 'area', 1.5, 1.5, 2, 2),
    ])
    expect([...conflicts].sort()).toEqual(['a', 'b'])
  })

  it('finds every conflict in a run of overlapping pieces', () => {
    const conflicts = findConflicts([
      candidate('a', 'area', 0, 0, 2, 1),
      candidate('b', 'area', 1, 0, 2, 1),
      candidate('c', 'area', 6, 0, 2, 1),
    ])
    expect([...conflicts].sort()).toEqual(['a', 'b'])
  })
})

describe('scene', () => {
  it('projects placements into pieces with boxes, bands and materials', () => {
    const scene = buildPlanScene(
      sceneOf([
        ['p1', FIXTURE_IDS.floor2, 0, 0, 0],
        ['p2', FIXTURE_IDS.wall2, 0, -0.5, 0],
      ]),
      catalog,
      styleOf,
    )
    expect(scene.pieces).toHaveLength(2)
    expect(scene.conflicts.size).toBe(0)
    const floor = scene.pieces.find((piece) => piece.band === 'area')
    expect(floor?.box).toEqual({ x: 0, z: 0, w: 2, d: 2 })
    expect(floor?.style.material).toBe('dungeon_stone')
    expect(floor?.style.tint).toMatch(/^#[0-9a-f]{6}$/)
    expect(floor?.style.edge).not.toBe(floor?.style.tint)
    expect(scene.bounds).toEqual({ x: 0, z: -0.5, w: 2, d: 2.5 })
  })

  it('paints areas before edges, so a wall reads as standing on the floor', () => {
    const scene = buildPlanScene(
      sceneOf([
        ['wall', FIXTURE_IDS.wall2, 0, 0, 0],
        ['floor', FIXTURE_IDS.floor2, 0, 0, 0],
      ]),
      catalog,
      styleOf,
    )
    expect(scene.pieces.map((piece) => piece.band)).toEqual(['area', 'edge'])
  })

  it('reports a placement whose item has left the corpus instead of throwing', () => {
    // A **design** this catalog does not hold, built by hand rather than through
    // `fixtureDesignOf`: since row V4 that is what strands a placement, and it
    // is a different event from a file being retired — a design survives as
    // long as one of its variants does, so what does this is the whole item
    // leaving or a tag edit moving its files to another design.
    const placements: WorkshopState['placements'] = {
      ['p1' as PlacementId]: { design: 'd-gone-retired' as DesignId, x: 0, z: 0, rotation: 0 },
    }
    const scene = buildPlanScene(placements, catalog, styleOf)
    expect(scene.pieces).toEqual([])
    expect(scene.unknown).toHaveLength(1)
    expect(scene.unknown[0]?.design).toBe('d-gone-retired')
    expect(scene.unknown[0]?.reason).toContain('retired')
  })

  it('reports a placement the plan view cannot draw instead of dropping it', () => {
    // `none` is the only case left: 726 tiles, and after this row the only
    // footprint with nothing to draw.
    const scene = buildPlanScene(sceneOf([['p1', FIXTURE_IDS.shapeless, 0, 0, 0]]), catalog, styleOf)
    expect(scene.pieces).toEqual([])
    expect(scene.undrawable).toHaveLength(1)
    expect(scene.undrawable[0]?.reason).toContain('none')
  })

  it('draws a sector at its own box, with its curve and not its bounding rectangle', () => {
    const scene = buildPlanScene(sceneOf([['p1', FIXTURE_IDS.arc, 0, 0, 0]]), catalog, styleOf)
    const piece = scene.pieces[0]
    expect(scene.undrawable).toEqual([])
    // A quarter disc of radius 2: the box degenerates to rOut x rOut at 90.
    expect(piece?.box).toEqual({ x: 0, z: 0, w: 2, d: 2 })
    // Two `A` commands would be an annulus; a disc has one, closed through the
    // centre.
    expect(piece?.shape.outline.match(/A /g)).toHaveLength(1)
    expect(piece?.shape.cover).toBe('outward')
    expect(piece?.parts.length).toBeGreaterThan(1)
    // The box corner opposite the arc centre is outside the disc, which is the
    // whole reason the box is not the shape.
    expect(pieceAt(scene, [1.95, 1.95])).toBeUndefined()
    expect(pieceAt(scene, [0.4, 0.4])?.id).toBe('p1')
  })

  it('carries a diagonal wall at its intrinsic 45 degrees, and says so', () => {
    const scene = buildPlanScene(sceneOf([['p1', FIXTURE_IDS.diag, 0, 0, 0]]), catalog, styleOf)
    const piece = scene.pieces[0]
    expect(piece?.placement.rotation).toBe(0)
    // The drawn angle is not the placement's rotation for this one case.
    expect(piece?.angle).toBe(45)
    expect(piece?.axisAligned).toBe(false)
    // 2.828 x 0.5 turned 45 degrees: a square box of (run + 0.5)/sqrt(2).
    expect(piece?.box.w).toBeCloseTo((2.828 + 0.5) / Math.SQRT2, 10)
    expect(piece?.box.d).toBeCloseTo((2.828 + 0.5) / Math.SQRT2, 10)
  })

  it('marks a fallback band as unmeasured, and leaves a measured one unmarked', () => {
    const scene = buildPlanScene(
      sceneOf([
        ['fallback', FIXTURE_IDS.arcFallback, 0, 0, 0],
        ['measured', FIXTURE_IDS.arc, 8, 8, 0],
      ]),
      catalog,
      styleOf,
    )
    const fallback = scene.pieces.find((piece) => piece.id === 'fallback')
    const measured = scene.pieces.find((piece) => piece.id === 'measured')
    expect(fallback?.caveat?.code).toBe('unmeasured-band')
    expect(fallback?.caveat?.message).toContain('convex')
    expect(fallback?.label).toContain('unmeasured outline')
    expect(measured?.caveat).toBeNull()
    expect(measured?.label).not.toContain('unmeasured')
  })

  it('describes a curve by its radii and sweep, never by its bounding box', () => {
    const scene = buildPlanScene(sceneOf([['p1', FIXTURE_IDS.arcFallback, 0, 0, 0]]), catalog, styleOf)
    const label = scene.pieces[0]?.label ?? ''
    expect(label).toContain('radius 3.5 to 4 units')
    expect(label).toContain('45° sweep')
  })

  it('does not flag a column standing on the floor it stands on', () => {
    // The 75-tile band move, end to end: before it, this pair was two `area`
    // pieces in the same square and the canvas hatched both.
    const scene = buildPlanScene(
      sceneOf([
        ['floor', FIXTURE_IDS.floor2, 0, 0, 0],
        ['column', FIXTURE_IDS.column, 0.5, 0.5, 0],
      ]),
      catalog,
      styleOf,
    )
    expect(scene.conflicts.size).toBe(0)
  })

  it('still flags two columns in the same square', () => {
    const scene = buildPlanScene(
      sceneOf([
        ['a', FIXTURE_IDS.column, 0, 0, 0],
        ['b', FIXTURE_IDS.column, 0.25, 0, 0],
      ]),
      catalog,
      styleOf,
    )
    expect(scene.conflicts.size).toBe(2)
  })

  it('describes a piece with its material, size, angle and position', () => {
    const scene = buildPlanScene(sceneOf([['p1', FIXTURE_IDS.angled, 1, 2, 45]]), catalog, styleOf)
    const label = scene.pieces[0]?.label ?? ''
    expect(label).toContain('Wood angled floor')
    expect(label).toContain('2 × 1 units')
    expect(label).toContain('45 degrees')
    expect(label).toContain('x 1, z 2')
  })

  it('hit-tests the topmost piece under a point', () => {
    const scene = buildPlanScene(
      sceneOf([
        ['floor', FIXTURE_IDS.floor2, 0, 0, 0],
        ['wall', FIXTURE_IDS.wall2, 0, 0, 0],
      ]),
      catalog,
      styleOf,
    )
    expect(pieceAt(scene, [1, 0.25])?.id).toBe('wall')
    expect(pieceAt(scene, [1, 1.5])?.id).toBe('floor')
    expect(pieceAt(scene, [9, 9])).toBeUndefined()
  })

  it('navigates in reading order, not insertion order', () => {
    const scene = buildPlanScene(
      sceneOf([
        ['south', FIXTURE_IDS.floor1, 0, 4, 0],
        ['north', FIXTURE_IDS.floor1, 0, 0, 0],
        ['middle', FIXTURE_IDS.floor1, 2, 2, 0],
      ]),
      catalog,
      styleOf,
    )
    expect(navigationOrder(scene).map((piece) => piece.id)).toEqual(['north', 'middle', 'south'])
  })
})

describe('ghost', () => {
  const empty = buildPlanScene(sceneOf([]), catalog, styleOf)

  it('centres the piece on the cursor and snaps its corner', () => {
    const ghost = computeGhost(record(FIXTURE_IDS.floor2), 0, [3.3, 2.1], SNAP_STEP.fine, empty)
    expect(ghost.anchor).toEqual([2.5, 1])
    expect(ghost.box).toEqual({ x: 2.5, z: 1, w: 2, d: 2 })
    expect(ghost.placeable).toBe(true)
    expect(ghost.refusal).toBeNull()
  })

  it('swaps a wall on a quarter turn and stays on the lattice', () => {
    const ghost = computeGhost(record(FIXTURE_IDS.wall2), 90, [2, 2], SNAP_STEP.fine, empty)
    expect(ghost.box.w).toBe(0.5)
    expect(ghost.box.d).toBe(2)
    expect(Number.isInteger(ghost.anchor[0] * 2)).toBe(true)
    expect(Number.isInteger(ghost.anchor[1] * 2)).toBe(true)
  })

  it('marks a shapeless tile as refused and unplaceable, with the reason', () => {
    const ghost = computeGhost(record(FIXTURE_IDS.shapeless), 0, [1, 1], SNAP_STEP.fine, empty)
    expect(ghost.placeable).toBe(false)
    expect(ghost.refusal?.code).toBe('no-footprint')
    // Still has a box, so the canvas can draw a marker rather than nothing.
    expect(ghost.box.w).toBe(1)
  })

  it('offers an arc, snapped and centred like any other piece', () => {
    const ghost = computeGhost(record(FIXTURE_IDS.arc), 0, [3.3, 2.1], SNAP_STEP.fine, empty)
    expect(ghost.refusal).toBeNull()
    expect(ghost.placeable).toBe(true)
    expect(ghost.anchor).toEqual([2.5, 1])
    expect(ghost.box).toEqual({ x: 2.5, z: 1, w: 2, d: 2 })
    expect(ghost.parts.length).toBeGreaterThan(1)
  })

  it('carries the unmeasured caveat on the ghost, so it is known before the click', () => {
    const ghost = computeGhost(record(FIXTURE_IDS.arcFallback), 0, [1, 1], SNAP_STEP.fine, empty)
    expect(ghost.placeable).toBe(true)
    expect(ghost.caveat?.code).toBe('unmeasured-band')
  })

  it('turns a sector by its own sweep, which is what makes a curved run close', () => {
    // rotStep equals sweep on all 1,199 arc tiles. Four 45-degree turns of the
    // fixture s 45-degree curve is a half turn, and the box comes back square.
    const record45 = record(FIXTURE_IDS.arcFallback)
    expect(record45.rotStep).toBe(45)
    const straightOn = computeGhost(record45, 0, [4, 4], SNAP_STEP.fine, empty)
    const turned = computeGhost(record45, 45, [4, 4], SNAP_STEP.fine, empty)
    // A 45-degree sector is not square, so a 45-degree turn changes the box —
    // which a 90-degree-only step could never have produced.
    expect(straightOn.box.w).not.toBeCloseTo(straightOn.box.d, 6)
    expect(turned.box.w).toBeCloseTo(turned.box.d, 6)
  })

  it('turns a diagonal wall off its intrinsic 45 and onto the axes', () => {
    const diag = record(FIXTURE_IDS.diag)
    expect(diag.rotStep).toBe(45)
    const asPlaced = computeGhost(diag, 0, [4, 4], SNAP_STEP.fine, empty)
    const oneStep = computeGhost(diag, 45, [4, 4], SNAP_STEP.fine, empty)
    expect(asPlaced.angle).toBe(45)
    expect(asPlaced.axisAligned).toBe(false)
    // One step lands the run on an axis: 2.828 x 0.5, exactly.
    expect(oneStep.angle).toBe(90)
    expect(oneStep.axisAligned).toBe(true)
    expect(oneStep.box.w).toBeCloseTo(0.5, 10)
    expect(oneStep.box.d).toBeCloseTo(2.828, 10)
  })

  it('agrees with the scene about a sector conflict, because both call one predicate', () => {
    const scene = buildPlanScene(sceneOf([['p1', FIXTURE_IDS.arc, 0, 0, 0]]), catalog, styleOf)
    // Centred on the disc s solid quadrant, so the overlap is unambiguous and
    // far larger than the decomposition s slack.
    const ghost = computeGhost(record(FIXTURE_IDS.arc), 0, [0.6, 0.6], SNAP_STEP.fine, scene)
    expect(ghost.conflict).toBe(true)
    expect(ghostOverlaps(scene, ghost).map((piece) => piece.id)).toEqual(['p1'])
    // And the same ghost seven units away does not fire — the decomposition's
    // slack is under 0.01 units, three orders of magnitude below the gap, so
    // there is no question of the envelope reaching.
    const clear = computeGhost(record(FIXTURE_IDS.arc), 0, [9, 9], SNAP_STEP.fine, scene)
    expect(clear.conflict).toBe(false)
    expect(sectorSlack(2, 90)).toBeLessThanOrEqual(0.01)
  })

  it('predicts a conflict without blocking it', () => {
    const scene = buildPlanScene(sceneOf([['p1', FIXTURE_IDS.floor2, 0, 0, 0]]), catalog, styleOf)
    const ghost = computeGhost(record(FIXTURE_IDS.floor1), 0, [0.5, 0.5], SNAP_STEP.fine, scene)
    expect(ghost.conflict).toBe(true)
    expect(ghost.placeable).toBe(true)
    expect(ghostOverlaps(scene, ghost).map((piece) => piece.id)).toEqual(['p1'])
  })

  it('does not predict a conflict for a wall over a floor', () => {
    const scene = buildPlanScene(sceneOf([['p1', FIXTURE_IDS.floor2, 0, 0, 0]]), catalog, styleOf)
    const ghost = computeGhost(record(FIXTURE_IDS.wall2), 0, [1, 0.25], SNAP_STEP.fine, scene)
    expect(ghost.conflict).toBe(false)
  })

  it('blocks the identical placement, which would double a bill line invisibly', () => {
    const scene = buildPlanScene(sceneOf([['p1', FIXTURE_IDS.floor1, 2, 2, 0]]), catalog, styleOf)
    const ghost = computeGhost(record(FIXTURE_IDS.floor1), 0, [2.5, 2.5], SNAP_STEP.fine, scene)
    expect(ghost.anchor).toEqual([2, 2])
    expect(ghost.duplicate).toBe(true)
    expect(ghost.placeable).toBe(false)
  })

  it('allows the same tile turned differently in the same place', () => {
    const scene = buildPlanScene(sceneOf([['p1', FIXTURE_IDS.wall2, 2, 2, 0]]), catalog, styleOf)
    const ghost = computeGhost(record(FIXTURE_IDS.wall2), 90, [2.25, 3], SNAP_STEP.fine, scene)
    expect(ghost.duplicate).toBe(false)
  })

  it('snaps to whole units in coarse mode', () => {
    const ghost = computeGhost(record(FIXTURE_IDS.floor1), 0, [3.4, 2.6], SNAP_STEP.coarse, empty)
    expect(ghost.anchor.every((value) => Number.isInteger(value))).toBe(true)
  })
})
