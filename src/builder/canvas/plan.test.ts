/**
 * Overlap, the scene projection and the ghost. Headless.
 *
 * The load-bearing test in this file is the one that *fails to fire*: a wall
 * lying on the edge of a floor tile must not be reported as an overlap, because
 * that is how OpenForge is built (3,351 tiles are `build|separate wall`, 863 are
 * `build|wall on tile`) and a canvas that flagged it would flag every wall in
 * every room.
 *
 * Since row **A1** there is a second one of the same kind, and it fires on a
 * *single* placement: a template's `base` and `floor` slots are stacked by
 * design, in the same band, on the same square, so an instance that could
 * collide with itself would hatch every piece in every room. `findConflicts`
 * refuses same-id pairs and "does not flag an instance against its own parts"
 * is the test that says so.
 */
import { describe, expect, it } from 'vitest'

import type { TileId } from '@/catalog'
import type { PlacementId, WorkshopState } from '@/store'

import { createStyleResolver, planCatalogFromFile } from './catalog'
import {
  FIXTURE_IDS,
  FIXTURE_SLOTS,
  FIXTURE_TEMPLATE,
  fixtureCatalogFile,
  fixtureFills,
  fixtureInstance,
  fixtureSlotLayout,
} from './fixture'
import { computeGhost, ghostOverlaps } from './ghost'
import { SNAP_STEP, planBox, planQuad } from './geometry'
import { findConflicts, partsOverlap, planBand, quadsOverlap } from './overlap'
import type { OverlapCandidate } from './overlap'
import { buildPlanScene, navigationOrder, partAt, pieceAt, pieceRotationStep } from './scene'
import type { PlanPiece } from './scene'
import { sectorSlack } from './sector'

const file = fixtureCatalogFile()
/** The real layout rule for these tests — see `fixture.ts#fixtureSlotLayout`. */
const catalog = planCatalogFromFile(file, fixtureSlotLayout)
const styleOf = createStyleResolver(catalog)

/**
 * The record a fixture file id names.
 *
 * A direct lookup since row A1: `PlanCatalog.record` takes a {@link TileId},
 * because a `SlotFill` names an exact file (decision D1). Row V4's
 * `fixtureDesignOf` hop is gone with the aggregate it hopped through.
 */
const record = (id: string) => {
  const found = catalog.record(id as TileId)
  if (found === undefined) throw new Error(`no fixture record ${id}`)
  return found
}

/**
 * A scene of **one-part instances**, from `[key, tileId, x, z, rotation]` tuples.
 *
 * The tuple still names a file, because that is what most of this file is about
 * — which outline, which band, which tint — and the one slot it fills is `floor`,
 * whose fixture layout is `(0, 0)` unturned. So a one-part instance has exactly
 * the geometry the pre-A1 placement of the same file had, which is what lets the
 * assertions about boxes, bands, sectors and labels carry over unchanged and
 * keeps this helper honest about what it is testing.
 *
 * {@link instancesOf} is the multi-part counterpart.
 */
function sceneOf(rows: readonly [string, string, number, number, number][]): WorkshopState['placements'] {
  const placements: Record<string, WorkshopState['placements'][PlacementId]> = {}
  for (const [key, tileId, x, z, rotation] of rows) {
    placements[key] = fixtureInstance(key, fixtureFills([[FIXTURE_SLOTS.floor, tileId]]), { x, z, rotation })
  }
  return placements
}

/** A scene of instances with whatever fill maps you hand it. */
function instancesOf(
  rows: readonly (readonly [string, readonly (readonly [string, string])[], number, number, number])[],
): WorkshopState['placements'] {
  const placements: Record<string, WorkshopState['placements'][PlacementId]> = {}
  for (const [key, fills, x, z, rotation] of rows) {
    placements[key] = fixtureInstance(key, fixtureFills(fills), { x, z, rotation })
  }
  return placements
}

/** The one piece a single-instance scene holds. */
function onlyPiece(placements: WorkshopState['placements']): PlanPiece {
  const scene = buildPlanScene(placements, catalog, styleOf)
  const piece = scene.pieces[0]
  if (piece === undefined) throw new Error('the scene drew no piece')
  return piece
}

/** The one part a one-part piece holds. */
function onlyPart(placements: WorkshopState['placements']) {
  const piece = onlyPiece(placements)
  const part = piece.parts[0]
  if (part === undefined) throw new Error('the piece drew no part')
  return part
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
  it('projects a one-part instance into a piece with a box, a band and a material', () => {
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
    // Band, style and box all live on the **part** since row A1 — a template has
    // a floor in `area` and two walls in `edge`, so there is no single answer at
    // the piece.
    const floor = scene.pieces.flatMap((piece) => piece.parts).find((part) => part.band === 'area')
    expect(floor?.box).toEqual({ x: 0, z: 0, w: 2, d: 2 })
    expect(floor?.style.material).toBe('dungeon_stone')
    expect(floor?.style.tint).toMatch(/^#[0-9a-f]{6}$/)
    expect(floor?.style.edge).not.toBe(floor?.style.tint)
    expect(scene.bounds).toEqual({ x: 0, z: -0.5, w: 2, d: 2.5 })
  })

  it('resolves one instance into one record per filled slot, with the slot on each', () => {
    // The keystone of this row: `PlanCatalog.parts` returns N records per piece.
    const piece = onlyPiece(
      instancesOf([
        [
          'p1',
          [
            [FIXTURE_SLOTS.floor, FIXTURE_IDS.floor2],
            [FIXTURE_SLOTS.leftWall, FIXTURE_IDS.wall2],
            [FIXTURE_SLOTS.rightWall, FIXTURE_IDS.wall2],
            [FIXTURE_SLOTS.column, FIXTURE_IDS.column],
          ],
          0,
          0,
          0,
        ],
      ]),
    )
    // Sorted by slot name, which is `catalog.ts`'s stated determinism rule.
    expect(piece.parts.map((part) => part.slot)).toEqual(['column', 'floor', 'left wall', 'right wall'])
    expect(piece.parts.map((part) => part.record.name)).toEqual([
      'Dungeon stone column I',
      'Dungeon stone floor 2×2',
      'Cut stone wall 2',
      'Cut stone wall 2',
    ])
    // One record per slot, and the two walls are the *same file* in two slots —
    // which is the case a design-keyed lookup could not have expressed at all.
    expect(piece.parts[2]?.record.id).toBe(piece.parts[3]?.record.id)
    expect(piece.parts[2]?.slot).not.toBe(piece.parts[3]?.slot)
  })

  it('carries the slot layout onto each part: offset, own yaw and elevation', () => {
    const piece = onlyPiece(
      instancesOf([
        [
          'p1',
          [
            [FIXTURE_SLOTS.base, FIXTURE_IDS.floor2],
            [FIXTURE_SLOTS.floor, FIXTURE_IDS.floor2],
            [FIXTURE_SLOTS.rightWall, FIXTURE_IDS.wall2],
          ],
          0,
          0,
          0,
        ],
      ]),
    )
    const by = (slot: string) => piece.parts.find((part) => part.slot === slot)

    // The offsets are the rule's, and the right wall's 1.5 is a multiple of 0.25
    // that is *on* the 0.5 lattice; the layout is not snapped either way.
    expect(by('base')?.layout).toEqual({ dx: 0, dz: 0, rotation: 0, elevationMm: 0 })
    expect(by('right wall')?.layout).toEqual({ dx: 1.5, dz: 0, rotation: 90, elevationMm: 12.7 })

    // Elevation is per part and normalised — never read off the mesh. Three
    // distinct heights on one instance is what a renderer needs to stack them.
    expect(piece.parts.map((part) => part.layout.elevationMm)).toEqual([0, 6.35, 12.7])
  })

  it('turns each part about the instance origin, folding the slot yaw into the drawn angle', () => {
    // The composition rule: the part turns about its own anchor corner and that
    // corner orbits the instance origin. A 2 x 0.5 wall at dx 1.5 with a slot
    // yaw of 90 is the east edge of the 2 x 2 cell.
    const piece = onlyPiece(
      instancesOf([
        [
          'p1',
          [
            [FIXTURE_SLOTS.floor, FIXTURE_IDS.floor2],
            [FIXTURE_SLOTS.rightWall, FIXTURE_IDS.wall2],
          ],
          0,
          0,
          0,
        ],
      ]),
    )
    const wall = piece.parts.find((part) => part.slot === 'right wall')
    expect(wall?.angle).toBe(90)
    expect(wall?.box).toEqual({ x: 1.5, z: 0, w: 0.5, d: 2 })
    // The floor is unturned and at the origin, so the instance box is the union.
    expect(piece.box).toEqual({ x: 0, z: 0, w: 2, d: 2 })
  })

  it('orbits a slot offset exactly on a quarter turn, so parts stay on the lattice', () => {
    // `turnOffset` computes the quarter turns by swapping rather than by
    // trigonometry: `Math.cos(Math.PI / 2)` is 6.1e-17, and a 1.5-unit offset
    // turned by trig would land 9e-17 off the lattice — which is precisely the
    // value that makes two parts look flush and fail an equality test.
    const piece = onlyPiece(instancesOf([['p1', [[FIXTURE_SLOTS.rightWall, FIXTURE_IDS.wall2]], 0, 0, 90]]))
    const wall = piece.parts[0]
    // The east edge becomes the south edge: local (1.5, 0) maps to world
    // (0, 1.5), because a positive angle carries +x onto +z (`place`'s own
    // convention, z being down the page). Exact equality, not `toBeCloseTo`.
    expect(wall?.box.x).toBe(0)
    expect(wall?.box.z).toBe(1.5)
    // And `+0` rather than `-0`, which the negating branch really does produce
    // from a zero offset. `-0` survives in memory but not through
    // `JSON.stringify`, so a scene holding one stops comparing equal to itself
    // after an export and re-import.
    expect(Object.is(wall?.box.x, -0)).toBe(false)
    // Instance rotation 90 plus the slot's own 90 is a half turn, so the 2 x 0.5
    // wall keeps its extents about the orbited corner.
    expect(wall?.angle).toBe(180)
    expect(wall?.box.w).toBe(2)
    expect(wall?.box.d).toBe(0.5)
  })

  it('gives each part its own band, so one instance spans both', () => {
    const piece = onlyPiece(
      instancesOf([
        [
          'p1',
          [
            [FIXTURE_SLOTS.floor, FIXTURE_IDS.floor2],
            [FIXTURE_SLOTS.leftWall, FIXTURE_IDS.wall2],
            [FIXTURE_SLOTS.column, FIXTURE_IDS.column],
          ],
          0,
          0,
          0,
        ],
      ]),
    )
    const bands = new Map(piece.parts.map((part) => [part.slot, part.band]))
    expect(bands.get(FIXTURE_SLOTS.floor)).toBe('area')
    expect(bands.get(FIXTURE_SLOTS.leftWall)).toBe('edge')
    expect(bands.get(FIXTURE_SLOTS.column)).toBe('edge')
  })

  it('does not flag an instance against its own parts, though base and floor are stacked', () => {
    // **The test that must fail to fire.** `base` and `floor` both sit at the
    // origin in the same `area` band with the same 2 x 2 outline, so every
    // instance in every room would hatch itself without `findConflicts`'
    // same-id rule.
    const scene = buildPlanScene(
      instancesOf([
        [
          'p1',
          [
            [FIXTURE_SLOTS.base, FIXTURE_IDS.floor2],
            [FIXTURE_SLOTS.floor, FIXTURE_IDS.floor2],
          ],
          0,
          0,
          0,
        ],
      ]),
      catalog,
      styleOf,
    )
    expect(scene.pieces).toHaveLength(1)
    expect(scene.pieces[0]?.parts).toHaveLength(2)
    // The two parts really do occupy the same square, which is what makes this
    // an exemption rather than a vacuous pass.
    expect(scene.pieces[0]?.parts[0]?.box).toEqual(scene.pieces[0]?.parts[1]?.box)
    expect([...scene.conflicts]).toEqual([])
  })

  it('still flags two different instances whose parts share a square', () => {
    // The other side of the same rule: the exemption is by identity, not by
    // geometry, so two instances stacked are still reported.
    const scene = buildPlanScene(
      instancesOf([
        ['p1', [[FIXTURE_SLOTS.floor, FIXTURE_IDS.floor2]], 0, 0, 0],
        ['p2', [[FIXTURE_SLOTS.floor, FIXTURE_IDS.floor2]], 1, 1, 0],
      ]),
      catalog,
      styleOf,
    )
    expect([...scene.conflicts].sort()).toEqual(['p1', 'p2'])
  })

  it('finds a conflict against a part that is not the first, and marks the whole piece', () => {
    // One sweep over *parts*: `p2`'s floor lands on `p1`'s right wall, which is
    // the fourth of its four parts. A sweep over pieces would have compared
    // `p1`'s union box and reported the same thing for the wrong reason; a sweep
    // over first-parts-only would have missed it.
    const scene = buildPlanScene(
      instancesOf([
        [
          'p1',
          [
            [FIXTURE_SLOTS.floor, FIXTURE_IDS.floor2],
            [FIXTURE_SLOTS.rightWall, FIXTURE_IDS.wall2],
          ],
          0,
          0,
          0,
        ],
        // A 1x1 floor at (1.5, 0) is inside the right wall's 0.5 x 2 box — but
        // the wall is `edge` and a floor is `area`, so what conflicts is `p1`'s
        // *floor*, at the overlap of the two 2x2 cells.
        ['p2', [[FIXTURE_SLOTS.floor, FIXTURE_IDS.floor1]], 1.5, 0, 0],
      ]),
      catalog,
      styleOf,
    )
    expect([...scene.conflicts].sort()).toEqual(['p1', 'p2'])
    expect(scene.pieces.every((piece) => piece.conflict)).toBe(true)
  })

  it('reports a fill whose file has left the corpus, and still draws the rest', () => {
    // One dead file must not take the other parts of its own instance down —
    // which is the whole difference between a per-slot omission and a per-
    // placement one.
    const scene = buildPlanScene(
      instancesOf([
        [
          'p1',
          [
            [FIXTURE_SLOTS.floor, FIXTURE_IDS.floor2],
            [FIXTURE_SLOTS.leftWall, 'tiles/gone/retired.stl'],
          ],
          0,
          0,
          0,
        ],
      ]),
      catalog,
      styleOf,
    )
    expect(scene.pieces).toHaveLength(1)
    expect(scene.pieces[0]?.parts.map((part) => part.slot)).toEqual(['floor'])
    expect(scene.unknown).toHaveLength(1)
    expect(scene.unknown[0]?.slot).toBe('left wall')
    expect(scene.unknown[0]?.tile).toBe('tiles/gone/retired.stl')
    expect(scene.unknown[0]?.template).toBe(FIXTURE_TEMPLATE)
    expect(scene.unknown[0]?.reason).toContain('retired')
  })

  it('reports a fill that cannot be drawn instead of dropping it', () => {
    // `none` is the only case left: 726 tiles, and after row W4 the only
    // footprint with nothing to draw.
    const scene = buildPlanScene(sceneOf([['p1', FIXTURE_IDS.shapeless, 0, 0, 0]]), catalog, styleOf)
    expect(scene.pieces).toEqual([])
    expect(scene.undrawable).toHaveLength(1)
    expect(scene.undrawable[0]?.slot).toBe('floor')
    expect(scene.undrawable[0]?.tile).toBe(FIXTURE_IDS.shapeless)
    expect(scene.undrawable[0]?.reason).toContain('none')
  })

  it('reports an instance with no filled slots at all rather than losing it', () => {
    // Contract C-g's limit: §3.2 places a template with slots still open, and
    // the fully-open case has nothing to draw. It must not become a piece with
    // an empty `parts` array and a degenerate box, and it must not vanish — the
    // user has to be able to see it and remove it.
    const scene = buildPlanScene(instancesOf([['p1', [], 2, 3, 0]]), catalog, styleOf)
    expect(scene.pieces).toEqual([])
    expect(scene.unknown).toEqual([])
    expect(scene.undrawable).toEqual([])
    expect(scene.unfilled).toHaveLength(1)
    expect(scene.unfilled[0]?.id).toBe('p1')
    expect(scene.unfilled[0]?.slot).toBeNull()
    expect(scene.unfilled[0]?.tile).toBeNull()
    expect(scene.unfilled[0]?.reason).toContain('no filled slots')
  })

  it('does not double-report an instance whose every fill failed', () => {
    // Both fills are retired, so `unknown` names them both and `unfilled` must
    // stay empty — the instance is already accounted for, twice over.
    const scene = buildPlanScene(
      instancesOf([
        [
          'p1',
          [
            [FIXTURE_SLOTS.floor, 'tiles/gone/a.stl'],
            [FIXTURE_SLOTS.base, 'tiles/gone/b.stl'],
          ],
          0,
          0,
          0,
        ],
      ]),
      catalog,
      styleOf,
    )
    expect(scene.pieces).toEqual([])
    expect(scene.unknown).toHaveLength(2)
    expect(scene.unfilled).toEqual([])
  })

  it('draws a sector at its own box, with its curve and not its bounding rectangle', () => {
    const scene = buildPlanScene(sceneOf([['p1', FIXTURE_IDS.arc, 0, 0, 0]]), catalog, styleOf)
    const part = scene.pieces[0]?.parts[0]
    expect(scene.undrawable).toEqual([])
    // A quarter disc of radius 2: the box degenerates to rOut x rOut at 90.
    expect(part?.box).toEqual({ x: 0, z: 0, w: 2, d: 2 })
    // Two `A` commands would be an annulus; a disc has one, closed through the
    // centre.
    expect(part?.shape.outline.match(/A /g)).toHaveLength(1)
    expect(part?.shape.cover).toBe('outward')
    expect(part?.polygons.length).toBeGreaterThan(1)
    // The box corner opposite the arc centre is outside the disc, which is the
    // whole reason the box is not the shape.
    expect(pieceAt(scene, [1.95, 1.95])).toBeUndefined()
    expect(pieceAt(scene, [0.4, 0.4])?.id).toBe('p1')
  })

  it('carries a diagonal wall at its intrinsic 45 degrees, and says so', () => {
    const piece = onlyPiece(sceneOf([['p1', FIXTURE_IDS.diag, 0, 0, 0]]))
    const part = piece.parts[0]
    expect(piece.placement.rotation).toBe(0)
    // The drawn angle is not the instance's rotation for this one case.
    expect(part?.angle).toBe(45)
    expect(part?.axisAligned).toBe(false)
    // 2.828 x 0.5 turned 45 degrees: a square box of (run + 0.5)/sqrt(2).
    expect(part?.box.w).toBeCloseTo((2.828 + 0.5) / Math.SQRT2, 10)
    expect(part?.box.d).toBeCloseTo((2.828 + 0.5) / Math.SQRT2, 10)
  })

  it('marks a fallback band as unmeasured on the part, and summarises it on the piece', () => {
    const scene = buildPlanScene(
      instancesOf([
        [
          'both',
          [
            [FIXTURE_SLOTS.leftWall, FIXTURE_IDS.arcFallback],
            [FIXTURE_SLOTS.floor, FIXTURE_IDS.arc],
          ],
          0,
          0,
          0,
        ],
      ]),
      catalog,
      styleOf,
    )
    const piece = scene.pieces[0]
    const fallback = piece?.parts.find((part) => part.slot === 'left wall')
    const measured = piece?.parts.find((part) => part.slot === 'floor')
    expect(fallback?.caveat?.code).toBe('unmeasured-band')
    expect(fallback?.caveat?.message).toContain('convex')
    expect(fallback?.label).toContain('unmeasured outline')
    expect(measured?.caveat).toBeNull()
    expect(measured?.label).not.toContain('unmeasured')
    // The piece counts them rather than repeating five paragraphs into a live
    // region.
    expect(piece?.label).toContain('1 outline unmeasured')
  })

  it('describes a curve by its radii and sweep, never by its bounding box', () => {
    const part = onlyPart(sceneOf([['p1', FIXTURE_IDS.arcFallback, 0, 0, 0]]))
    expect(part.label).toContain('radius 3.5 to 4 units')
    expect(part.label).toContain('45° sweep')
  })

  it('does not flag a column standing on the floor it stands on', () => {
    // The 75-tile band move, end to end: before it, this pair was two `area`
    // pieces in the same square and the canvas hatched both. Two *instances*
    // here, so the same-id rule is not what is doing the work.
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

  it('names a part by its slot, its material, its size, its angle and its position', () => {
    const part = onlyPart(sceneOf([['p1', FIXTURE_IDS.angled, 1, 2, 45]]))
    expect(part.label).toContain('floor:')
    expect(part.label).toContain('Wood angled floor')
    expect(part.label).toContain('2 × 1 units')
    expect(part.label).toContain('45 degrees')
    expect(part.label).toContain('x 1, z 2')
  })

  it('names a piece by its family, its part count and its slots', () => {
    const piece = onlyPiece(
      instancesOf([
        [
          'p1',
          [
            [FIXTURE_SLOTS.floor, FIXTURE_IDS.floor2],
            [FIXTURE_SLOTS.leftWall, FIXTURE_IDS.wall2],
          ],
          1,
          2,
          90,
        ],
      ]),
    )
    // A presentation of the slug, not a looked-up name: the family table lives
    // beside a screen and the canvas must not reach it.
    expect(piece.label).toContain('Fixture corner')
    expect(piece.label).toContain('2 parts')
    expect(piece.label).toContain('floor, left wall')
    expect(piece.label).toContain('90 degrees')
    expect(piece.label).toContain('x 1, z 2')
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

  it('resolves a pick to the slot it landed in, once the piece is known', () => {
    // The second half of a pick since row A1: the surface asks which instance,
    // a slot editor asks which slot.
    const piece = onlyPiece(
      instancesOf([
        [
          'p1',
          [
            [FIXTURE_SLOTS.floor, FIXTURE_IDS.floor2],
            [FIXTURE_SLOTS.rightWall, FIXTURE_IDS.wall2],
          ],
          0,
          0,
          0,
        ],
      ]),
    )
    // Inside the floor only.
    expect(partAt(piece, [0.5, 1])?.slot).toBe('floor')
    // Inside the right wall's box at x 1.5..2 — and the floor too, so the last
    // part in the list wins, which is `right wall` after the slot-name sort.
    expect(partAt(piece, [1.75, 1])?.slot).toBe('right wall')
    // Outside everything.
    expect(partAt(piece, [9, 9])).toBeUndefined()
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

describe('the rotation step of a multi-part instance', () => {
  const stepOf = (rows: readonly (readonly [string, string])[]) =>
    pieceRotationStep(onlyPiece(instancesOf([['p1', rows, 0, 0, 0]])))

  it('is the tile s own step when there is one part', () => {
    // 90 is the default; the angled fixture carries 45, one of the 893.
    expect(stepOf([[FIXTURE_SLOTS.floor, FIXTURE_IDS.floor2]])).toBe(90)
    expect(stepOf([[FIXTURE_SLOTS.floor, FIXTURE_IDS.angled]])).toBe(45)
  })

  it('is the least common multiple across parts, not the maximum or the minimum', () => {
    // A 45-step floor beside a 90-step wall: 90 is the coarsest angle *both*
    // can mate at. The minimum, 45, would land the wall somewhere it cannot.
    expect(
      stepOf([
        [FIXTURE_SLOTS.floor, FIXTURE_IDS.angled],
        [FIXTURE_SLOTS.leftWall, FIXTURE_IDS.wall2],
      ]),
    ).toBe(90)
  })

  it('is exact on the quarter-degree steps, where floats would not be', () => {
    // The fixture s fallback curve carries 45 and the diagonal carries 45, so
    // both agree; what this pins is that the scaled-integer arithmetic returns
    // 45 exactly rather than 45.000000000000004.
    const step = stepOf([
      [FIXTURE_SLOTS.floor, FIXTURE_IDS.diag],
      [FIXTURE_SLOTS.leftWall, FIXTURE_IDS.arcFallback],
    ])
    expect(step).toBe(45)
    expect(Number.isInteger(step * 4)).toBe(true)
  })

  it('never proposes an angle a part cannot reach', () => {
    // The property, over every pair the fixture can make: the instance step is
    // a whole multiple of each part s own, which is exactly what "every part
    // can mate at it" means.
    const files = [
      FIXTURE_IDS.floor1,
      FIXTURE_IDS.floor2,
      FIXTURE_IDS.wall2,
      FIXTURE_IDS.angled,
      FIXTURE_IDS.arc,
      FIXTURE_IDS.arcFallback,
      FIXTURE_IDS.column,
      FIXTURE_IDS.tri,
      FIXTURE_IDS.diag,
    ]
    for (const one of files) {
      for (const other of files) {
        const piece = onlyPiece(
          instancesOf([
            [
              'p1',
              [
                [FIXTURE_SLOTS.floor, one],
                [FIXTURE_SLOTS.leftWall, other],
              ],
              0,
              0,
              0,
            ],
          ]),
        )
        const step = pieceRotationStep(piece)
        for (const part of piece.parts) {
          const own = part.record.rotStep ?? 90
          expect(
            Number.isInteger(Math.round((step / own) * 1e6) / 1e6),
            `${one} + ${other}: step ${String(step)} is not a multiple of ${String(own)}`,
          ).toBe(true)
        }
      }
    }
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

  it('blocks a ghost that duplicates one part of a template, not just a whole placement', () => {
    // **The case row A1 made reachable.** The refusal used to compare
    // `piece.placement.design`; a template has no design and five files, so the
    // comparison has to be against the *parts*. Here the armed wall lands exactly
    // where the instance's `left wall` slot already puts that same file, which is
    // the invisible double the rule exists to refuse — and a placement-level
    // comparison would have missed every one of them.
    const scene = buildPlanScene(
      instancesOf([
        [
          'p1',
          [
            [FIXTURE_SLOTS.floor, FIXTURE_IDS.floor2],
            [FIXTURE_SLOTS.leftWall, FIXTURE_IDS.wall2],
          ],
          0,
          0,
          0,
        ],
      ]),
      catalog,
      styleOf,
    )
    const onTheWall = computeGhost(record(FIXTURE_IDS.wall2), 0, [1, 0.25], SNAP_STEP.fine, scene)
    expect(onTheWall.anchor).toEqual([0, 0])
    expect(onTheWall.duplicate).toBe(true)
    expect(onTheWall.placeable).toBe(false)

    // The same file one unit south is not a twin, so the rule is about the place
    // and not about the file being present anywhere in the room.
    const clear = computeGhost(record(FIXTURE_IDS.wall2), 0, [1, 2.25], SNAP_STEP.fine, scene)
    expect(clear.duplicate).toBe(false)
    expect(clear.placeable).toBe(true)
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
