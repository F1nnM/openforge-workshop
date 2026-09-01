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

import type { TileId } from '@/catalog'
import type { PlacementId, WorkshopState } from '@/store'

import { createStyleResolver, planCatalogFromFile } from './catalog'
import { FIXTURE_IDS, fixtureCatalogFile } from './fixture'
import { computeGhost, ghostOverlaps } from './ghost'
import { SNAP_STEP, planBox, planQuad } from './geometry'
import { findConflicts, planBand, quadsOverlap } from './overlap'
import type { OverlapCandidate } from './overlap'
import { buildPlanScene, navigationOrder, pieceAt } from './scene'

const file = fixtureCatalogFile()
const catalog = planCatalogFromFile(file)
const styleOf = createStyleResolver(catalog)

const record = (id: string) => {
  const found = catalog.record(id as TileId)
  if (found === undefined) throw new Error(`no fixture record ${id}`)
  return found
}

/** A scene from a list of `[key, tileId, x, z, rotation]` tuples. */
function sceneOf(rows: readonly [string, string, number, number, number][]): WorkshopState['placements'] {
  const placements: WorkshopState['placements'] = {}
  for (const [key, tileId, x, z, rotation] of rows) {
    placements[key as PlacementId] = { tileId: tileId as TileId, x, z, rotation }
  }
  return placements
}

const candidate = (id: string, band: 'area' | 'edge', x: number, z: number, w: number, d: number): OverlapCandidate => ({
  id: id as PlacementId,
  band,
  box: { x, z, w, d },
  quad: planQuad({ w, d }, 0, x, z),
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

  it('reports a placement whose tile has left the corpus instead of throwing', () => {
    const scene = buildPlanScene(sceneOf([['p1', 'tiles/gone/retired.stl', 0, 0, 0]]), catalog, styleOf)
    expect(scene.pieces).toEqual([])
    expect(scene.unknown).toHaveLength(1)
    expect(scene.unknown[0]?.reason).toContain('retired')
  })

  it('reports a placement the plan view cannot draw instead of dropping it', () => {
    const scene = buildPlanScene(sceneOf([['p1', FIXTURE_IDS.arc, 0, 0, 0]]), catalog, styleOf)
    expect(scene.pieces).toEqual([])
    expect(scene.undrawable).toHaveLength(1)
    expect(scene.undrawable[0]?.reason).toContain('arc')
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

  it('marks an arc as refused and unplaceable, with the reason', () => {
    const ghost = computeGhost(record(FIXTURE_IDS.arc), 0, [1, 1], SNAP_STEP.fine, empty)
    expect(ghost.placeable).toBe(false)
    expect(ghost.refusal?.code).toBe('arc')
    // Still has a box, so the canvas can draw a marker rather than nothing.
    expect(ghost.box.w).toBe(1)
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
