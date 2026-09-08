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
import type { PlacementId, SlotName, TemplateId, WorkshopState } from '@/store'

import {
  BASE_LIFT_MM,
  createStyleResolver,
  isSlotLayout,
  originSlotLayout,
  planCatalogFromFile,
  templateSlotLayout,
} from './catalog'
import type { SlotLayoutAnswer } from './catalog'
import type { SlotLayout } from './geometry'
import {
  FIXTURE_CELL,
  FIXTURE_IDS,
  FIXTURE_SLOTS,
  FIXTURE_TEMPLATE,
  OTHER_FIXTURE_TEMPLATE,
  fixtureCatalogFile,
  fixtureFills,
  fixtureInstance,
  fixtureSlotLayout,
  fixtureTemplateParts,
} from './fixture'
import { SLOT_CONVENTIONS } from '@/template/rules'

import { computeGhost, ghostOverlaps } from './ghost'
import { SNAP_STEP, planBox, planQuad } from './geometry'
import { findConflicts, levelAt, partsOverlap, planBand, quadsOverlap, subjectsConflict } from './overlap'
import type { OverlapCandidate } from './overlap'
import { buildPlanScene, navigationOrder, partAt, pieceAt, pieceRotationStep } from './scene'
import type { PlanPiece } from './scene'
import { sectorSlack } from './sector'

const file = fixtureCatalogFile()
/** The real layout rule for these tests — see `fixture.ts#fixtureSlotLayout`. */
const catalog = planCatalogFromFile(file, fixtureSlotLayout)
const styleOf = createStyleResolver(catalog)

/**
 * The same fixture catalog under `originSlotLayout`.
 *
 * **This was *"the rule the app actually uses"* and since row C6 it is not.**
 * `BuilderScreen.tsx` now calls
 * `planCatalogFromFile(index.file, templateSlotLayout(...))`, so the shipped rule
 * returns real offsets and real elevations. `originSlotLayout` survives as the
 * answer for a template with no convention — B4's 51 one-slot families — and the
 * two tests that pin it are kept because they are still true of it and because
 * they are the baseline the wired ones are measured against.
 */
const grounded = planCatalogFromFile(file, originSlotLayout)
const groundedStyle = createStyleResolver(grounded)

/** The **shipped** rule, over the fixture's two families. */
const wired = planCatalogFromFile(file, templateSlotLayout(fixtureTemplateParts))
const wiredStyle = createStyleResolver(wired)

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

/**
 * The same, on a **named** family.
 *
 * Row C6's rule keys a convention on the template's part-name set, which it
 * looks up by id (`fixtureTemplateParts`), so a test about the wired layout has
 * to say which family an instance belongs to. `instancesOf` uses
 * {@link FIXTURE_TEMPLATE}, the fixture's five-slot corner.
 */
function familyOf(
  template: string,
  rows: readonly (readonly [string, readonly (readonly [string, string])[], number, number, number])[],
): WorkshopState['placements'] {
  const placements: Record<string, WorkshopState['placements'][PlacementId]> = {}
  for (const [key, fills, x, z, rotation] of rows) {
    placements[key] = fixtureInstance(key, fixtureFills(fills), { x, z, rotation, template })
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

/**
 * One axis-aligned candidate. `elevationMm` defaults to the ground, which is
 * where the shipped layout rule puts every part.
 */
const candidate = (
  id: string,
  band: 'area' | 'edge',
  x: number,
  z: number,
  w: number,
  d: number,
  elevationMm = 0,
): OverlapCandidate => ({
  id: id as PlacementId,
  band,
  level: levelAt(elevationMm),
  box: { x, z, w, d },
  parts: [planQuad({ w, d }, 0, x, z)],
  axisAligned: true,
  // A quad is its own outline and the band is given, so this fixture is a
  // *trusted* candidate — which is what keeps every conflict assertion below
  // reading `exact`. The doubtful cases are built by overriding these two, so
  // the default has to be the sound one or the split would be untested.
  cover: 'exact',
  bandMeasured: true,
})


/**
 * A candidate with a real thickness — what a generated base is, and the only
 * population that has one.
 */
const solid = (
  id: string,
  x: number,
  z: number,
  w: number,
  d: number,
  elevationMm: number,
  heightMm: number,
): OverlapCandidate => ({
  ...candidate(id, 'area', x, z, w, d),
  level: { elevationMm, heightMm },
})

describe('bands', () => {
  it('files a wall footprint as an edge piece', () => {
    expect(planBand(record(FIXTURE_IDS.wall2)).band).toBe('edge')
  })

  it('files a thick wall that arrives as a rect as an edge piece too', () => {
    expect(record(FIXTURE_IDS.thickWall).foot.shape).toBe('rect')
    expect(planBand(record(FIXTURE_IDS.thickWall)).band).toBe('edge')
  })

  it('files a floor as an area piece', () => {
    expect(planBand(record(FIXTURE_IDS.floor2)).band).toBe('area')
  })

  it('files an unbucketed tile as an area piece — the conservative answer', () => {
    expect(record(FIXTURE_IDS.shapeless).kinds).toEqual([])
    expect(planBand(record(FIXTURE_IDS.shapeless)).band).toBe('area')
  })

  it('files a column as an edge piece on its footprint, not on its kinds', () => {
    // One of the 75 tiles this changed: `kinds` is ['column'] with no 'wall', so
    // the kind heuristic alone would call a 12.70 x 12.70 mm pillar a floor and
    // then flag it against the floor it stands on.
    expect(record(FIXTURE_IDS.column).kinds).toEqual(['column'])
    expect(planBand(record(FIXTURE_IDS.column)).band).toBe('edge')
  })

  it('files a diagonal wall run as an edge piece', () => {
    expect(planBand(record(FIXTURE_IDS.diag)).band).toBe('edge')
  })

  it('files a curve whose band is one wall thickness wide as an edge piece', () => {
    // `convex` is [R-0.5, R] — a curved *wall*, whatever its kinds say. 248 of
    // the corpus's curved walls carry base/floor/stairs kinds because the curve
    // belongs to a floor family.
    expect(planBand(record(FIXTURE_IDS.arcFallback)).band).toBe('edge')
  })

  it('files a wide curve on its kinds, since its band is a floor and not a wall', () => {
    // The fixture's quarter disc is [0, 2] — two units of band, a floor.
    expect(planBand(record(FIXTURE_IDS.arc)).band).toBe('area')
  })

  it('files a filled right triangle as an area piece', () => {
    expect(planBand(record(FIXTURE_IDS.tri)).band).toBe('area')
  })

  /**
   * The provenance half of the verdict, and the reason it exists: a band read
   * off the footprint is a **measurement**, and one read off `kinds` is the
   * heuristic `overlap.ts` warns drifts. Only the first may refuse a placement.
   */
  it('reports a footprint-derived band as measured', () => {
    expect(planBand(record(FIXTURE_IDS.wall2)).measured).toBe(true)
    expect(planBand(record(FIXTURE_IDS.column)).measured).toBe(true)
    expect(planBand(record(FIXTURE_IDS.diag)).measured).toBe(true)
  })

  it('reports a kinds-derived band as inferred, including the thick-wall case', () => {
    // The thick wall is the sharpest case: it comes out `edge`, which is the
    // *right* band, and it is still inferred — the answer came from
    // `build|thick wall` in the tag data and not from a 0.5-unit footprint.
    expect(planBand(record(FIXTURE_IDS.thickWall))).toEqual({ band: 'edge', measured: false })
    expect(planBand(record(FIXTURE_IDS.floor2)).measured).toBe(false)
    expect(planBand(record(FIXTURE_IDS.shapeless)).measured).toBe(false)
  })
})

/**
 * Which conflicts may be acted on.
 *
 * `overlap.ts` establishes that its error is one-directional — it over-reports
 * and never misses — so a conflict is either a fact or a conservative guess, and
 * only the facts may refuse a placement. These four tests are that split, one
 * per doubt plus the sound case, and they are the contract the refusal gate in
 * `move.ts` and `three/edits.ts` reads.
 */
describe('how much a conflict is trusted', () => {
  const floor = (id: string) => candidate(id, 'area', 0, 0, 1, 1)

  it('is exact when the geometry, the levels and the bands are all sound', () => {
    expect(subjectsConflict(floor('a'), floor('b'))).toEqual({ kind: 'exact', reason: null })
  })

  it('is inexact when either piece only contains its geometry', () => {
    // An `arc`'s convex parts are a superset of the sector by up to 0.246 mm, so
    // the pieces may not actually touch.
    expect(subjectsConflict(floor('a'), { ...floor('b'), cover: 'outward' })).toEqual({
      kind: 'inexact',
      reason: 'curved',
    })
  })

  it('is inexact when either level is unknown, because null reads as every level', () => {
    expect(subjectsConflict(floor('a'), { ...floor('b'), level: null })).toEqual({
      kind: 'inexact',
      reason: 'unknown-level',
    })
  })

  it('is inexact when either band came from the kinds heuristic', () => {
    expect(subjectsConflict(floor('a'), { ...floor('b'), bandMeasured: false })).toEqual({
      kind: 'inexact',
      reason: 'inferred-band',
    })
  })

  it('is null when the pieces do not share area at all', () => {
    expect(subjectsConflict(floor('a'), candidate('b', 'area', 4, 0, 1, 1))).toBeNull()
  })

  it('names the strongest doubt when a pair has more than one', () => {
    const doubtful = { ...floor('b'), cover: 'outward' as const, level: null, bandMeasured: false }
    expect(subjectsConflict(floor('a'), doubtful)?.reason).toBe('curved')
  })

  it('lets an exact conflict win over an inexact one for the same piece', () => {
    // `a` is in two conflicts: an exact one with `b` and a curved one with `c`.
    // It must report `exact`, or the drawing would invite a placement the gate
    // refuses — the one combination that reads as a bug rather than as caution.
    const conflicts = findConflicts([
      floor('a'),
      floor('b'),
      { ...candidate('c', 'area', 0.5, 0, 1, 1), cover: 'outward' },
    ])
    expect(conflicts.get('a' as PlacementId)).toBe('exact')
    expect(conflicts.get('c' as PlacementId)).toBe('inexact')
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
    expect([...conflicts.keys()]).toEqual([])
  })

  it('flags two floors in the same square', () => {
    const conflicts = findConflicts([
      candidate('a', 'area', 0, 0, 2, 2),
      candidate('b', 'area', 1, 1, 1, 1),
    ])
    expect([...conflicts.keys()].sort()).toEqual(['a', 'b'])
  })

  it('flags two walls on the same edge', () => {
    const conflicts = findConflicts([
      candidate('a', 'edge', 0, 0, 2, 0.5),
      candidate('b', 'edge', 1, 0, 2, 0.5),
    ])
    expect([...conflicts.keys()].sort()).toEqual(['a', 'b'])
  })

  it('treats a shared face as touching, not overlapping', () => {
    const conflicts = findConflicts([
      candidate('a', 'area', 0, 0, 1, 1),
      candidate('b', 'area', 1, 0, 1, 1),
      candidate('c', 'area', 0, 1, 1, 1),
    ])
    expect([...conflicts.keys()]).toEqual([])
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
    expect([...conflicts.keys()]).toEqual([])
  })

  it('still needs that exemption after A7, because a corner is a same-level pair', () => {
    /*
      **Measured before deleting.** The brief's guess was that an exemption
      excusing a false positive is dead weight once the elevation removes the
      false positive. It is not: two walls meeting at a corner rest on the *same*
      floor, so they carry the same `elevationMm` at every layout rule there
      could be, and `levelsOverlap` passes them straight through to the geometry.
      Here the two are given one explicit elevation and the exemption is still the
      only thing standing between the drawing and a hatch on it.
    */
    const north = candidate('north', 'edge', 0, 0, 4, 0.5, 12.7)
    const west = candidate('west', 'edge', 0, 0, 0.5, 4, 12.7)
    expect(north.level).toEqual(west.level)
    expect(findConflicts([north, west]).size).toBe(0)
    // Lift one of them and it is not a corner any more — it is a wall crossing
    // over another wall, and the interval alone answers that.
    expect(findConflicts([north, candidate('west', 'edge', 0, 0, 0.5, 4, 25.4)]).size).toBe(0)
  })

  it('never reaches a mitre inside one template, so the exemption cannot misjudge one', () => {
    /*
      Row **B2** warned that `isCornerJunction` *"would read a corner's own
      geometry as legal, and the 8 mitres as legal too"*. Measured, the
      exemption is never asked: no call path tests two parts of one instance
      against each other. `findConflicts` skips same-id pairs, `previewMove`
      filters `candidate.id !== drag.id` before it tests anything, and a ghost is
      a record in no instance at all.

      These two walls are *parallel* and overlap by a half unit — the pair the
      exemption explicitly refuses to excuse — and they are still not reported,
      because they share an id. So the same-id rule and not the exemption is what
      makes a template's own slots safe, whatever their geometry.
    */
    const conflicts = findConflicts([
      candidate('corner', 'edge', 0, 0, 2, 0.5),
      candidate('corner', 'edge', 1.5, 0, 2, 0.5),
    ])
    expect([...conflicts.keys()]).toEqual([])
  })

  it('still flags two parallel walls overlapping by the same half unit', () => {
    // Same shared area as a corner, and no corner piece resolves it.
    const conflicts = findConflicts([
      candidate('a', 'edge', 0, 0, 2, 0.5),
      candidate('b', 'edge', 1.5, 0, 2, 0.5),
    ])
    expect([...conflicts.keys()].sort()).toEqual(['a', 'b'])
  })

  it('does not exempt a corner-sized overlap of two floors', () => {
    const conflicts = findConflicts([
      candidate('a', 'area', 0, 0, 2, 2),
      candidate('b', 'area', 1.5, 1.5, 2, 2),
    ])
    expect([...conflicts.keys()].sort()).toEqual(['a', 'b'])
  })

  it('separates two stacked instances once the layout rule gives them elevations', () => {
    /*
      **The false positive row A4a left behind, and this row's whole subject.**
      Two *different* instances on the same square: one part on the ground, one
      lifted 6.35 mm by its slot rule. Both are `area`-band — the band is
      identical on both sides, so nothing but the elevation can be separating
      them — and A4a's same-id rule does not apply because the ids differ.
    */
    const conflicts = findConflicts([
      candidate('under', 'area', 0, 0, 2, 2, 0),
      candidate('over', 'area', 0, 0, 2, 2, 6.35),
    ])
    expect([...conflicts.keys()]).toEqual([])

    // And the same pair on one level still fires, so the test above is about the
    // height and not about the pair.
    const level = findConflicts([
      candidate('under', 'area', 0, 0, 2, 2, 0),
      candidate('over', 'area', 0, 0, 2, 2, 0),
    ])
    expect([...level.keys()].sort()).toEqual(['over', 'under'])
  })

  it('reads a real thickness as an interval, so a riser reaching a level conflicts with it', () => {
    // A generated base is the one piece with a height (`HEIGHT`, or a riser's `z`
    // half-squares), and the interval is why: a 50.8 mm riser standing on the
    // ground reaches the 12.7 mm level and a bare level comparison would miss it.
    const wall = candidate('wall', 'area', 0, 0, 2, 2, 12.7)
    expect([...findConflicts([solid('riser', 0, 0, 2, 2, 0, 50.8), wall]).keys()].sort()).toEqual(['riser', 'wall'])
    // 6 mm of base does not reach it.
    expect(findConflicts([solid('base', 0, 0, 2, 2, 0, 6), wall]).size).toBe(0)
  })

  it('treats a piece resting exactly on an interval as touching, not overlapping', () => {
    // The vertical spelling of "a shared face is not a conflict": a floor whose
    // slot rule puts it at exactly the top of a 6 mm base is resting on it.
    expect(findConflicts([solid('base', 0, 0, 2, 2, 0, 6), candidate('floor', 'area', 0, 0, 2, 2, 6)]).size).toBe(0)
    // A hair lower and it is inside the base, which must fire — the tolerance is
    // 2.54e-5 mm and this is four orders of magnitude above it.
    expect(
      findConflicts([solid('base', 0, 0, 2, 2, 0, 6), candidate('floor', 'area', 0, 0, 2, 2, 5.9)]).size,
    ).toBe(2)
  })

  it('finds every conflict in a run of overlapping pieces', () => {
    const conflicts = findConflicts([
      candidate('a', 'area', 0, 0, 2, 1),
      candidate('b', 'area', 1, 0, 2, 1),
      candidate('c', 'area', 6, 0, 2, 1),
    ])
    expect([...conflicts.keys()].sort()).toEqual(['a', 'b'])
  })
})

describe('the band, and why row A7 could not delete it — re-measured under row C6', () => {

  /** One instance filling one slot with one file, at a cell. */
  const oneSlot = (key: string, slot: string, tile: string, x: number, z: number) => ({
    [key as PlacementId]: fixtureInstance(key, fixtureFills([[slot, tile]]), { x, z }),
  })

  it('puts every part on the ground under originSlotLayout', () => {
    // The measurement the rest of this block rests on, and the reason the band
    // is still load bearing: row B2 authored the real elevation chain
    // (`template/offsets.ts#slotElevationMm`) and nothing wires it, because it
    // takes the resting part's height as an argument and the only implementation
    // of that argument was the `bases.ts#baseElevationMm` row A4b deleted.
    const scene = buildPlanScene(
      {
        ...oneSlot('p1', FIXTURE_SLOTS.base, FIXTURE_IDS.floor2, 0, 0),
        ...oneSlot('p2', FIXTURE_SLOTS.floor, FIXTURE_IDS.floor2, 4, 0),
        ...oneSlot('p3', FIXTURE_SLOTS.leftWall, FIXTURE_IDS.wall2, 8, 0),
      },
      grounded,
      groundedStyle,
    )
    expect(scene.pieces.flatMap((piece) => piece.parts).map((part) => part.layout.elevationMm)).toEqual([0, 0, 0])
  })

  it('is the only thing separating a wall from a floor under originSlotLayout', () => {
    /*
      **Row A4a's note said `planBand` and `PlanBand` retire with the interval.
      Measured, they cannot.** A wall instance and a floor instance on the same
      square are both at elevation 0 under `originSlotLayout`, so their intervals
      are the same level and `levelsOverlap` is true — the band is the whole of
      what keeps this quiet. Deleting it today would hatch every wall standing on
      a floor, which is the exact false positive this module was built to remove.
    */
    const bands = buildPlanScene(
      {
        ...oneSlot('floor', FIXTURE_SLOTS.floor, FIXTURE_IDS.floor2, 0, 0),
        ...oneSlot('wall', FIXTURE_SLOTS.floor, FIXTURE_IDS.wall2, 0, 0),
      },
      grounded,
      groundedStyle,
    )
    const parts = bands.pieces.flatMap((piece) => piece.parts)
    expect(parts.map((part) => part.band).sort()).toEqual(['area', 'edge'])
    expect(new Set(parts.map((part) => part.layout.elevationMm))).toEqual(new Set([0]))
    expect(bands.conflicts.size).toBe(0)

    // Two pieces of the *same* band on that one level are still reported, which
    // is what makes the line above a statement about the band rather than about
    // the geometry.
    const stacked = buildPlanScene(
      {
        ...oneSlot('base', FIXTURE_SLOTS.base, FIXTURE_IDS.floor2, 0, 0),
        ...oneSlot('floor', FIXTURE_SLOTS.floor, FIXTURE_IDS.floor2, 0, 0),
      },
      grounded,
      groundedStyle,
    )
    expect([...stacked.conflicts.keys()].sort()).toEqual(['base', 'floor'])
  })

  it('is what separates a base from what stands on it, once the rule lifts one', () => {
    /*
      **The half of A7's expectation row C6 does discharge, and it is smaller
      than A7 thought.** One `wall-on-tile` instance, base and floor and wall all
      filled: the base is on the ground and the two toppers are one base up. So
      the interval is real, and it is real *inside* an instance.

      That is also the whole of it, and the reason is `restsOn`. An instance's
      chain starts at its own base, so a second instance on the same square
      starts at 0 too — its base collides with the first one's, which is a true
      conflict and not a false positive. There is no cross-instance pair the
      elevation separates that A4a's same-id rule did not already exempt.
    */
    const scene = buildPlanScene(
      familyOf(OTHER_FIXTURE_TEMPLATE, [
        [
          'piece',
          [
            [FIXTURE_SLOTS.base, FIXTURE_IDS.floor2],
            [FIXTURE_SLOTS.floor, FIXTURE_IDS.floor2],
            [FIXTURE_SLOTS.wall, FIXTURE_IDS.wall2],
          ],
          0,
          0,
          0,
        ],
      ]),
      wired,
      wiredStyle,
    )
    const parts = scene.pieces.flatMap((piece) => piece.parts)
    const elevationOf = (slot: SlotName) => parts.find((part) => part.slot === slot)?.layout.elevationMm
    expect(elevationOf(FIXTURE_SLOTS.base)).toBe(0)
    expect(elevationOf(FIXTURE_SLOTS.floor)).toBe(BASE_LIFT_MM)
    expect(elevationOf(FIXTURE_SLOTS.wall)).toBe(BASE_LIFT_MM)
    // Under `originSlotLayout` all three are on the ground — that is the test at
    // the top of this block, and it is what makes this one a statement about the
    // rule rather than about the fills.
    expect(scene.conflicts.size).toBe(0)
  })

  it('does not retire, because a wall and a floor come out at the same height', () => {
    /*
      **The measurement row C6 owes A7, and it says the band stays.** A7 pinned
      the band on the premise that no rule was wired. The premise is gone and the
      conclusion survives, for a reason that is arithmetic rather than
      circumstantial: B2's conventions rest the `floor` **and** the `wall` on the
      `base` — not the wall on the floor — so the two land at the *same*
      elevation and `levelsOverlap` is true between them wherever they meet. The
      two supports for resting both on the base are measured: the single-piece
      recipes give the wall part `fulfills: [{part: base}]`, and of the 107
      measured toppers authored pre-lifted by exactly one base thickness **59 are
      walls and 27 are floors**.

      So the band is still the whole of what keeps a wall over a floor quiet, and
      deleting it would hatch every one of them.
    */
    const parts = buildPlanScene(
      familyOf(OTHER_FIXTURE_TEMPLATE, [
        [
          'piece',
          [
            [FIXTURE_SLOTS.base, FIXTURE_IDS.floor2],
            [FIXTURE_SLOTS.floor, FIXTURE_IDS.floor2],
            [FIXTURE_SLOTS.wall, FIXTURE_IDS.wall2],
          ],
          0,
          0,
          0,
        ],
      ]),
      wired,
      wiredStyle,
    ).pieces.flatMap((piece) => piece.parts)
    const wall = parts.find((part) => part.slot === FIXTURE_SLOTS.wall)
    const floor = parts.find((part) => part.slot === FIXTURE_SLOTS.floor)
    expect(wall?.layout.elevationMm).toBe(floor?.layout.elevationMm)
    // And the bands differ, which is what does the separating.
    expect(wall?.band).toBe('edge')
    expect(floor?.band).toBe('area')
  })

  it('does not retire for the 51 one-slot families either, which have no elevation at all', () => {
    /*
      The second and larger half of the same answer, and the reachable one: C2
      measured **0 of 51** generated families with a part-name set `rules.ts` has
      a convention for, so `templateSlotLayout` answers `ORIGIN_LAYOUT` for every
      one of them and every part of every one is on the ground. A one-slot wall
      family placed on a one-slot floor family is therefore two `elevationMm: 0`
      parts on one square — A7's exact false positive, still live, still quiet
      only because the bands differ.
    */
    const scene = buildPlanScene(
      familyOf('shape-base', [
        ['floor-only', [[FIXTURE_SLOTS.floor, FIXTURE_IDS.floor2]], 0, 0, 0],
        ['wall-only', [[FIXTURE_SLOTS.floor, FIXTURE_IDS.wall2]], 0, 0, 0],
      ]),
      wired,
      wiredStyle,
    )
    const parts = scene.pieces.flatMap((piece) => piece.parts)
    expect(new Set(parts.map((part) => part.layout.elevationMm))).toEqual(new Set([0]))
    expect(parts.map((part) => part.band).sort()).toEqual(['area', 'edge'])
    expect(scene.conflicts.size).toBe(0)

    // Two of the same band on that one level are still reported, so the line
    // above is about the band and not about the geometry.
    const same = buildPlanScene(
      familyOf('shape-base', [
        ['a', [[FIXTURE_SLOTS.floor, FIXTURE_IDS.floor2]], 0, 0, 0],
        ['b', [[FIXTURE_SLOTS.floor, FIXTURE_IDS.floor2]], 0, 0, 0],
      ]),
      wired,
      wiredStyle,
    )
    expect([...same.conflicts.keys()].sort()).toEqual(['a', 'b'])
  })
})

/**
 * **Row C6: row B2's conventions, as the app runs them.**
 *
 * `templateSlotLayout` is the only rule production uses. Every number below is
 * arithmetic over `@/template`'s three authored conventions, so this block is
 * not a second implementation of them — it is the measurement that the
 * composition, the centre-to-corner conversion and the elevation chain arrive
 * intact at a `SlotLayout`.
 */
describe('the wired slot layout', () => {
  const layout = templateSlotLayout(fixtureTemplateParts)
  /**
   * The five records of a filled 2 x 2 corner, as the rule receives them.
   *
   * The two wall slots hold `cornerWall` — a **1.5**-unit run — and not the
   * straight `wall2`. Row **D9** measured 157 corner-wall meshes out of R2 and
   * every one tagged `size|width|2` runs 1.500, so 1.5 is the footprint the
   * archive actually hands these slots. With `wall2` in them this fixture was a
   * 2-unit run on a face a 0.5 column had already taken half a unit of, which is
   * an over-run no record produces.
   */
  const CORNER = new Map([
    [FIXTURE_SLOTS.base, record(FIXTURE_IDS.floor2)],
    [FIXTURE_SLOTS.floor, record(FIXTURE_IDS.floor2)],
    [FIXTURE_SLOTS.rightWall, record(FIXTURE_IDS.cornerWall)],
    [FIXTURE_SLOTS.leftWall, record(FIXTURE_IDS.cornerWall)],
    [FIXTURE_SLOTS.column, record(FIXTURE_IDS.column)],
  ])
  const answerAt = (slot: SlotName, fills = CORNER) => layout(FIXTURE_TEMPLATE, slot, fills)
  /** The rule's answer, asserted to be a position rather than a refusal. */
  const positionOf = (answer: SlotLayoutAnswer, where: string): SlotLayout => {
    if (!isSlotLayout(answer)) throw new Error(`${where} was refused: ${answer.refused}`)
    return answer
  }
  const at = (slot: SlotName, fills = CORNER) => positionOf(answerAt(slot, fills), slot)

  it('lays a 2 x 2 corner’s five slots out, each wall abutting the column', () => {
    /*
      **The table this row is judged on. Row D8 changed one number in it and row
      D9 changed three more.**

      D8's number is `rotation: 270` on the left wall, and it is the whole of the
      reported defect: before it, both walls came back `rotation: 0` at the same
      corner, so they drew through each other along one face and left the other
      bare.

      D9's are the two walls' `dx`/`dz`. They used to be `0, 0` — every part at
      the cell's minimum corner, every anchor flush to `-x`/`-z`, with only the
      *extents* separating them — and the two walls were 2-unit runs that
      `placeTemplateSlots` answered `over-run want 2 got 2.5` for. The meshes say
      the run is **1.5**, so each wall now sits at the far end of the 1.5 its
      column leaves: the right wall's 1.5 x 0.5 starts half a unit along the
      north face, the left wall's 0.5 x 1.5 starts half a unit down the west
      face, and the 0.5 x 0.5 column has the square where the two meet to itself.
      No overlap, no gap, no doubt.

      **The `residual` anchor changed one more: the floor's.** It used to be
      `0, 0` at the cell's own extent, and it is now `0.5, 0.5` at a 1.5 x 1.5
      box — the square the two walls and the column leave. An `s2w` floor is
      tagged with the size of its *tile* and measures half a unit less on each
      walled axis, so drawing it at 2 x 2 put a quarter of it under each wall and
      left a quarter unit of base bare at each open edge. `residual` is the box
      the renderer draws and `dx`/`dz` are that box's minimum corner, so the five
      parts now tile the cell exactly instead of the floor covering it alone.
    */
    expect(at(FIXTURE_SLOTS.base)).toEqual({ dx: 0, dz: 0, rotation: 0, elevationMm: 0, cell: FIXTURE_CELL })
    expect(at(FIXTURE_SLOTS.floor)).toEqual({
      dx: 0.5,
      dz: 0.5,
      rotation: 0,
      elevationMm: BASE_LIFT_MM,
      cell: FIXTURE_CELL,
      residual: { w: 1.5, d: 1.5 },
    })
    expect(at(FIXTURE_SLOTS.column)).toEqual({
      dx: 0,
      dz: 0,
      rotation: 0,
      elevationMm: BASE_LIFT_MM,
      cell: FIXTURE_CELL,
    })
    expect(at(FIXTURE_SLOTS.rightWall)).toEqual({
      dx: 0.5,
      dz: 0,
      rotation: 0,
      elevationMm: BASE_LIFT_MM,
      cell: FIXTURE_CELL,
    })
    expect(at(FIXTURE_SLOTS.leftWall)).toEqual({
      dx: 0,
      dz: 0.5,
      rotation: 270,
      elevationMm: BASE_LIFT_MM,
      cell: FIXTURE_CELL,
    })
  })

  it('refuses a coordinate for a fill with no run, and says why in the editor’s words', () => {
    /*
      The other half of row D8, and the case the fix does *not* place: a `diag`
      fill in an `edge` slot has no straight run to lie along at all — 104 of
      B2's 1,215 walked combinations — so anchoring it flush from its bounding
      box would set a 45° wall against an axis it does not lie on. There is no
      position, the rule says so, and the sentence is `slotDoubtSentence`'s so
      the plan and C3's slot editor do not describe one fault two ways.
    */
    const diagonal = new Map([
      [FIXTURE_SLOTS.base, record(FIXTURE_IDS.floor2)],
      [FIXTURE_SLOTS.floor, record(FIXTURE_IDS.floor2)],
      [FIXTURE_SLOTS.wall, record(FIXTURE_IDS.diag)],
    ])
    const answer = layout(OTHER_FIXTURE_TEMPLATE, FIXTURE_SLOTS.wall, diagonal)
    expect(isSlotLayout(answer)).toBe(false)
    expect(isSlotLayout(answer) ? '' : answer.refused).toBe(
      'The wall part has no straight run, so it does not lie along an edge of this cell.',
    )
    // And the scene draws nothing for it rather than stacking it on the origin,
    // which is what the old `dx = dz = 0` answer did.
    const scene = buildPlanScene(
      familyOf(OTHER_FIXTURE_TEMPLATE, [
        [
          'diag',
          [
            [FIXTURE_SLOTS.base, FIXTURE_IDS.floor2],
            [FIXTURE_SLOTS.floor, FIXTURE_IDS.floor2],
            [FIXTURE_SLOTS.wall, FIXTURE_IDS.diag],
          ],
          0,
          0,
          0,
        ],
      ]),
      wired,
      wiredStyle,
    )
    expect(scene.undrawable.map((one) => one.slot)).toEqual([FIXTURE_SLOTS.wall])
    expect(scene.undrawable[0]?.reason).toBe(
      'The wall part has no straight run, so it does not lie along an edge of this cell. It is not drawn.',
    )
    expect(scene.pieces[0]?.parts.map((part) => part.slot).sort()).toEqual(['base', 'floor'])
  })

  it('asks for one height and always the base’s, which is what makes 6 mm a constant', () => {
    /*
      The invariant `catalog.ts#liftOf` rests on, asserted over B2's own table
      rather than restated. Every non-null `restsOn` in every shipped convention
      names `base`, so the height reader is called with `base` and nothing else,
      and a normalised base thickness is the only measurement the chain needs. A
      fourth convention resting a part on a `floor` would fail here, which is the
      loud failure this assertion exists to buy.
    */
    const resting = SLOT_CONVENTIONS.flatMap((convention) =>
      convention.slots.map((rule) => rule.restsOn).filter((part) => part !== null),
    )
    expect(new Set(resting)).toEqual(new Set(['base']))
    // And the base itself is on the ground in all three, which is what makes the
    // chain one step long rather than N.
    expect(
      SLOT_CONVENTIONS.map((convention) => convention.slots.find((rule) => rule.part === 'base')?.restsOn),
      // All three conventions, and every one of them rests its whole stack on the
      // one `base` slot.
    ).toEqual([null, null, null])
  })

  it('is a no-op for a family with no convention, and for a family this build lacks', () => {
    // B4's 51 generated families: C2 measured 0 of 51 with a part-name set
    // `rules.ts` has a convention for, and a one-slot family needs none.
    const bare = new Map([[FIXTURE_SLOTS.floor, record(FIXTURE_IDS.floor2)]])
    expect(layout('shape-base' as TemplateId, FIXTURE_SLOTS.floor, bare)).toEqual({
      dx: 0,
      dz: 0,
      rotation: 0,
      elevationMm: 0,
    })
  })

  it('lifts nothing when the base slot has no fill, because nothing is under it', () => {
    // Not a guard: a `wall-on-tile` instance whose base needs a choice has
    // nothing beneath its floor, and drawing it 6 mm up would be a picture of a
    // base nobody chose.
    const noBase = new Map([
      [FIXTURE_SLOTS.floor, record(FIXTURE_IDS.floor2)],
      [FIXTURE_SLOTS.wall, record(FIXTURE_IDS.wall2)],
    ])
    const wallLayout = positionOf(layout(OTHER_FIXTURE_TEMPLATE, FIXTURE_SLOTS.wall, noBase), 'wall')
    expect(wallLayout.elevationMm).toBe(0)
    // And with a base in the map it is one base up.
    noBase.set(FIXTURE_SLOTS.base, record(FIXTURE_IDS.floor2))
    expect(
      positionOf(layout(OTHER_FIXTURE_TEMPLATE, FIXTURE_SLOTS.wall, noBase), 'wall').elevationMm,
    ).toBe(BASE_LIFT_MM)
  })

  it('reads the cell off the cell slot, so a 2 x 1 floor is not laid out in a 2 x 2', () => {
    // The seam's whole purpose: `TemplateLayout.cell` names `floor`, and the
    // rule now has the `floor` fill in hand when it is asked about the `wall`.
    const small = new Map([
      [FIXTURE_SLOTS.base, record(FIXTURE_IDS.angled)],
      [FIXTURE_SLOTS.floor, record(FIXTURE_IDS.angled)],
      [FIXTURE_SLOTS.wall, record(FIXTURE_IDS.wall2)],
    ])
    expect(positionOf(layout(OTHER_FIXTURE_TEMPLATE, FIXTURE_SLOTS.wall, small), 'wall').cell).toEqual({ w: 2, d: 1 })
    expect(positionOf(layout(OTHER_FIXTURE_TEMPLATE, FIXTURE_SLOTS.base, small), 'base').cell).toEqual({ w: 2, d: 1 })
  })

  it('never snaps an offset, and never lands off the 0.25 lattice either', () => {
    // §2.2 in both directions: a slot offset is a multiple of 0.25 and three of
    // the four `edge` insets the corpus produces are off the 0.5 lattice the
    // *origin* snaps to. `snapTo(-0.75, 0.5)` is `-0.5`.
    expect(SNAP_STEP.fine).toBe(0.5)
    for (const slot of CORNER.keys()) {
      const one = at(slot)
      expect(Number.isInteger(one.dx * 4), `${slot} dx`).toBe(true)
      expect(Number.isInteger(one.dz * 4), `${slot} dz`).toBe(true)
    }
  })

  it('keeps a wired instance’s footprint at its own cell on every quarter turn', () => {
    // A10's invariant, through the *production* rule rather than through the
    // fixture's authored numbers: a corner covers 4.00 units² and nothing more,
    // at every rotation, because every offset the conventions produce is an
    // inset.
    for (const rotation of [0, 90, 180, 270]) {
      const scene = buildPlanScene(
        instancesOf([
          [
            'corner',
            [
              [FIXTURE_SLOTS.base, FIXTURE_IDS.floor2],
              [FIXTURE_SLOTS.floor, FIXTURE_IDS.floor2],
              [FIXTURE_SLOTS.rightWall, FIXTURE_IDS.cornerWall],
              [FIXTURE_SLOTS.leftWall, FIXTURE_IDS.cornerWall],
              [FIXTURE_SLOTS.column, FIXTURE_IDS.column],
            ],
            0,
            0,
            rotation,
          ],
        ]),
        wired,
        wiredStyle,
      )
      const piece = scene.pieces[0]
      expect(piece, `rotation ${String(rotation)}`).toBeDefined()
      expect(piece?.box, `rotation ${String(rotation)}`).toEqual({ x: 0, z: 0, w: 2, d: 2 })
    }
  })

  it('turns a wall onto the cell’s other faces, which originSlotLayout could not', () => {
    /*
      **What the wiring actually buys for the 32 `wall-on-tile` recipes, measured
      rather than assumed — and the brief for this row was wrong about it.** A
      2-unit wall on a 2 x 2 floor has minimum corner `(0, 0)` under *both*
      rules at rotation 0: a wall whose run equals the face is already flush
      along it when it is anchored at the cell's own corner. What
      `originSlotLayout` could not do is turn it: with no declared cell each part
      re-anchors to itself, so the wall stayed at `(0, 0)` at 90° and 180° where
      it belongs at `(1.5, 0)` and `(0, 1.5)`. Two of the four quarters, not
      four.
    */
    const wallBoxAt = (rotation: number, view = wired, style = wiredStyle) => {
      const scene = buildPlanScene(
        familyOf(OTHER_FIXTURE_TEMPLATE, [
          [
            'w',
            [
              [FIXTURE_SLOTS.base, FIXTURE_IDS.floor2],
              [FIXTURE_SLOTS.floor, FIXTURE_IDS.floor2],
              [FIXTURE_SLOTS.wall, FIXTURE_IDS.wall2],
            ],
            0,
            0,
            rotation,
          ],
        ]),
        view,
        style,
      )
      const part = scene.pieces[0]?.parts.find((one) => one.slot === FIXTURE_SLOTS.wall)
      if (part === undefined) throw new Error('the wall must draw')
      return part.box
    }

    expect(wallBoxAt(0)).toEqual({ x: 0, z: 0, w: 2, d: 0.5 })
    expect(wallBoxAt(90)).toEqual({ x: 1.5, z: 0, w: 0.5, d: 2 })
    expect(wallBoxAt(180)).toEqual({ x: 0, z: 1.5, w: 2, d: 0.5 })
    expect(wallBoxAt(270)).toEqual({ x: 0, z: 0, w: 0.5, d: 2 })

    // The same four under `originSlotLayout`: the wall never leaves the corner.
    expect(wallBoxAt(0, grounded, groundedStyle)).toEqual({ x: 0, z: 0, w: 2, d: 0.5 })
    expect(wallBoxAt(90, grounded, groundedStyle)).toEqual({ x: 0, z: 0, w: 0.5, d: 2 })
    expect(wallBoxAt(180, grounded, groundedStyle)).toEqual({ x: 0, z: 0, w: 2, d: 0.5 })
    expect(wallBoxAt(270, grounded, groundedStyle)).toEqual({ x: 0, z: 0, w: 0.5, d: 2 })
  })

  it('keys its memo on the whole fill map, so one slot answers per configuration', () => {
    /*
      The memo used to be `(template, slot, file)`. It cannot be: the answer for
      the `wall` slot is a function of the `floor` fill, so a 2 x 1 floor and a
      2 x 2 floor with the *same* wall file must give the wall two different
      cells — and under the old key the second placement would have got the
      first one's.
    */
    const scene = buildPlanScene(
      familyOf(OTHER_FIXTURE_TEMPLATE, [
        [
          'wide',
          [
            [FIXTURE_SLOTS.base, FIXTURE_IDS.floor2],
            [FIXTURE_SLOTS.floor, FIXTURE_IDS.floor2],
            [FIXTURE_SLOTS.wall, FIXTURE_IDS.wall2],
          ],
          0,
          0,
          0,
        ],
        [
          'narrow',
          [
            [FIXTURE_SLOTS.base, FIXTURE_IDS.angled],
            [FIXTURE_SLOTS.floor, FIXTURE_IDS.angled],
            [FIXTURE_SLOTS.wall, FIXTURE_IDS.wall2],
          ],
          6,
          0,
          0,
        ],
      ]),
      wired,
      wiredStyle,
    )
    const cellOf = (id: string) =>
      scene.pieces.find((piece) => piece.id === id)?.parts.find((one) => one.slot === FIXTURE_SLOTS.wall)
        ?.layout.cell
    expect(cellOf('wide')).toEqual({ w: 2, d: 2 })
    expect(cellOf('narrow')).toEqual({ w: 2, d: 1 })
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
    // that is *on* the 0.5 lattice; the layout is not snapped either way. The
    // cell travels with every part of the instance, which is what makes the
    // assembly a rigid body under rotation — see `geometry.ts#slotAnchor`.
    expect(by('base')?.layout).toEqual({
      dx: 0,
      dz: 0,
      rotation: 0,
      elevationMm: 0,
      cell: FIXTURE_CELL,
    })
    expect(by('right wall')?.layout).toEqual({
      dx: 1.5,
      dz: 0,
      rotation: 90,
      elevationMm: 12.7,
      cell: FIXTURE_CELL,
    })

    // Elevation is per part and normalised — never read off the mesh. Three
    // distinct heights on one instance is what a renderer needs to stack them.
    expect(piece.parts.map((part) => part.layout.elevationMm)).toEqual([0, 6.35, 12.7])
  })

  it('turns each part about the instance origin, folding the slot yaw into the drawn angle', () => {
    // The composition rule: the part's box turns about the instance origin and
    // the turned assembly is re-anchored by the cell's own turned corner, so the
    // instance's minimum corner stays its `x`/`z` at every angle. A 2 x 0.5 wall
    // at dx 1.5 with a slot yaw of 90 is the east edge of the 2 x 2 cell.
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
    // wall comes back to its own extents where its turned box landed.
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
    expect([...scene.conflicts.keys()]).toEqual([])
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
    expect([...scene.conflicts.keys()].sort()).toEqual(['p1', 'p2'])
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
    expect([...scene.conflicts.keys()].sort()).toEqual(['p1', 'p2'])
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

  it('is tested against every level, because it fills no slot and has no elevation', () => {
    /*
      A ghost is a bare `CatalogRecord` under the cursor: it belongs to no
      template, so there is no slot rule to ask for a lift and `OverlapSubject`
      carries `level: null`. `overlap.ts` reads that as *every* level rather than
      *no* level, which keeps the prediction on the over-reporting side of the
      module's one-directional error — the scene part here is lifted 6.35 mm by
      the fixture rule and the ghost still fires against it.
    */
    const scene = buildPlanScene(sceneOf([['p1', FIXTURE_IDS.floor2, 0, 0, 0]]), catalog, styleOf)
    expect(scene.pieces[0]?.parts[0]?.layout.elevationMm).toBe(6.35)
    const ghost = computeGhost(record(FIXTURE_IDS.floor1), 0, [0.5, 0.5], SNAP_STEP.fine, scene)
    expect(ghost.conflict).toBe(true)
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
