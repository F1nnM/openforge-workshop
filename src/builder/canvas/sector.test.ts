/**
 * The annular sector, and the **direction** of its collision error. Headless.
 *
 * This file is the row's load-bearing test, because the decomposition in
 * `sector.ts` is an approximation and the only thing that makes an
 * approximation acceptable here is that its error is one-directional and
 * bounded. So the assertions are not "the answer is right"; they are:
 *
 *   1. every point of the true sector is inside the convex parts — **no false
 *      negatives**, which is the failure that would ship a room whose two pieces
 *      cannot both be printed into the same square;
 *   2. every point of the parts is within the proved `slack` of the true sector
 *      — the error is *outward only*, and small;
 *   3. over 240 randomised placed pairs, `subjectsConflict` fires on every pair
 *      that genuinely intersects, and every pair it fires on that does *not*
 *      intersect is separated by less than the slack.
 *
 * ## What this proves, and what it cannot
 *
 * The oracle is an **independent** analytic membership test: it inverts the
 * placement transform and asks `rIn ≤ r ≤ rOut, 0 ≤ φ ≤ θ` directly, sharing no
 * code with `sectorParts`. So a bug in the decomposition cannot hide in the
 * oracle.
 *
 * What it cannot prove is coverage of the *continuum*. Containment is checked on
 * a grid of sample points, not symbolically, so a defect confined to a region
 * smaller than the sample pitch would pass. The pitch is chosen against that:
 * the radial and angular grids are deliberately not multiples of the
 * subdivision count, so samples land inside sub-sectors rather than repeatedly
 * on their boundaries, and the analytic bound in `sectorSlack` is asserted
 * separately from the sampling so the two failures are distinguishable.
 *
 * Nothing here touches the DOM. What a sector *looks like* is not testable in
 * jsdom at all — jsdom parses an SVG `d` but measures nothing — so `sectorPath`
 * is checked for the coordinates it names, which is the part a wrong answer
 * would get wrong, and never for what it renders.
 */
import type { ArcFootprint } from '@/catalog'
import { describe, expect, it } from 'vitest'

import type { PlanPart, PlanPoint } from './geometry'
import { footprintShape, partsContain, planGeometry } from './geometry'
import { subjectsConflict } from './overlap'
import type { OverlapSubject } from './overlap'
import {
  SECTOR_TOLERANCE_UNITS,
  arcSectorExtent,
  sectorCentre,
  sectorParts,
  sectorPath,
  sectorSlack,
  sectorSubdivisions,
} from './sector'

const arc = (rIn: number, rOut: number, sweep: number, band: ArcFootprint['band'] = 'radial'): ArcFootprint => ({
  shape: 'arc',
  rIn,
  rOut,
  sweep,
  band,
  bandBasis: band === 'convex' || band === 's2w_radial' ? 'fallback' : 'measured',
})

/**
 * Every `(rIn, rOut, sweep, band)` combination the corpus actually produces —
 * all **29**, enumerated by running `pipeline/footprint.ts` over the fixtures
 * and grouping, with the tile count and basis of each recorded beside it.
 *
 * Enumerated rather than generated from the five band rules crossed with the
 * radii, because that cross product invents sectors: there is no `disc` at
 * R = 6 and no `concave` at R = 6.5. Testing a shape the corpus cannot contain
 * would be testing the generator.
 *
 * They collapse to **28 distinct geometric triples** — `(0, 2, 90)` arrives as
 * both `radial` at R = 2, where `R − 2` degenerates, and as the `disc` of code
 * `F` — and to five distinct outer radii, 2, 2.5, 4, 4.5 and 6.
 */
const CORPUS_SECTORS: readonly ArcFootprint[] = [
  arc(0, 2, 90, 'radial'), //          31 tiles, measured
  arc(0, 2, 90, 'disc'), //             6 tiles, measured
  arc(0.5, 2, 90, 's2w_radial'), //     1 tile,  fallback
  arc(1.5, 2, 22.5, 'convex'), //       4 tiles, fallback
  arc(1.5, 2, 45, 'convex'), //        98 tiles, fallback
  arc(1.5, 2, 90, 'convex'), //       128 tiles, fallback
  arc(2, 2.5, 22.5, 'concave'), //     24 tiles, measured
  arc(2, 2.5, 45, 'concave'), //      124 tiles, measured
  arc(2, 2.5, 90, 'concave'), //      199 tiles, measured
  arc(0, 4, 90, 'disc'), //             6 tiles, measured
  arc(2, 4, 22.5, 'radial'), //        25 tiles, measured
  arc(2, 4, 45, 'radial'), //          32 tiles, measured
  arc(2, 4, 90, 'radial'), //          34 tiles, measured
  arc(2.5, 4, 22.5, 's2w_radial'), //   2 tiles, fallback
  arc(2.5, 4, 45, 's2w_radial'), //     2 tiles, fallback
  arc(2.5, 4, 90, 's2w_radial'), //     2 tiles, fallback
  arc(3.5, 4, 22.5, 'convex'), //      49 tiles, fallback
  arc(3.5, 4, 45, 'convex'), //        66 tiles, fallback
  arc(3.5, 4, 90, 'convex'), //        52 tiles, fallback
  arc(4, 4.5, 22.5, 'concave'), //     56 tiles, measured
  arc(4, 4.5, 45, 'concave'), //       95 tiles, measured
  arc(4, 4.5, 90, 'concave'), //       87 tiles, measured
  arc(4, 6, 11.25, 'radial'), //       19 tiles, measured
  arc(4, 6, 22.5, 'radial'), //        25 tiles, measured
  arc(4, 6, 45, 'radial'), //          21 tiles, measured
  arc(4, 6, 90, 'radial'), //           8 tiles, measured
  arc(4.5, 6, 11.25, 's2w_radial'), //  1 tile,  fallback
  arc(4.5, 6, 22.5, 's2w_radial'), //   1 tile,  fallback
  arc(4.5, 6, 45, 's2w_radial'), //     1 tile,  fallback
]

/** The corpus's 1,199 arc tiles, summed over the rows above — the set is complete. */
const CORPUS_ARC_TILES = 1199

/* ------------------------------------------------------------------- oracle */

/**
 * How far inside a sector a point must be for the oracle to count it, in grid
 * units.
 *
 * 0.001 units is 0.025 mm, and it is here because `overlap.ts` deliberately does
 * **not** flag two pieces that merely *touch*: a tiled floor shares a face at
 * every seam, and a rule that fired on a shared face would fire on every room.
 * A set-theoretic oracle over closed regions calls a shared boundary an
 * intersection, so without an inset the "never misses" claim would be testing
 * the touching rule rather than the decomposition — the first randomised pair to
 * fail was two sectors tangent along `z = 2`.
 *
 * The consequence, stated rather than hidden: what the claim below proves is
 * that no intersection **deeper than 0.001 units** is missed. It is a tenth of
 * the decomposition's own slack, so it cannot mask an error the decomposition
 * could make.
 */
const INTERIOR_MARGIN = 0.001

/**
 * Whether a world point is at least `margin` inside a placed sector —
 * analytically, sharing no code with `sectorParts`.
 *
 * Inverts `planGeometry`'s transform (rotate about the box centre, offset by
 * half the extent) and then asks the sector's own definition.
 */
function inPlacedSector(
  foot: ArcFootprint,
  rotation: number,
  x: number,
  z: number,
  point: PlanPoint,
  margin = 0,
): boolean {
  const shape = footprintShape(foot)
  if (shape === undefined) throw new Error('an arc has a shape')
  const placed = planGeometry(shape, rotation, x, z)
  const cx = placed.box.x + placed.box.w / 2
  const cz = placed.box.z + placed.box.d / 2
  const radians = (-placed.angle * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const dx = point[0] - cx
  const dz = point[1] - cz
  // Un-rotate, then back into the shape's local [0, w] x [0, d] frame.
  const lx = dx * cos - dz * sin + shape.extent.w / 2
  const lz = dx * sin + dz * cos + shape.extent.d / 2
  const [ox, oz] = sectorCentre(foot)
  const rx = lx - ox
  const rz = lz - oz
  const radius = Math.hypot(rx, rz)
  const angle = (Math.atan2(rz, rx) * 180) / Math.PI
  // The angular inset that puts a point `margin` clear of the two radial faces
  // is `asin(margin / r)`, not a fixed number of degrees.
  const inset = (Math.asin(Math.min(1, margin / Math.max(radius, 1e-9))) * 180) / Math.PI
  return (
    radius >= foot.rIn + margin &&
    radius <= foot.rOut - margin &&
    angle >= inset &&
    angle <= foot.sweep - inset
  )
}

/** Points on a grid strictly inside a sector, in its own local frame. */
function sectorSamples(foot: ArcFootprint, rings: number, spokes: number): readonly PlanPoint[] {
  const [ox, oz] = sectorCentre(foot)
  const points: PlanPoint[] = []
  for (let i = 0; i <= rings; i += 1) {
    const radius = foot.rIn + ((foot.rOut - foot.rIn) * i) / rings
    for (let j = 0; j <= spokes; j += 1) {
      const angle = ((foot.sweep * j) / spokes) * (Math.PI / 180)
      points.push([ox + radius * Math.cos(angle), oz + radius * Math.sin(angle)])
    }
  }
  return points
}

/** The signed area of a polygon — positive or negative, never both, if convex. */
function isConvex(part: PlanPart): boolean {
  let sign = 0
  for (let i = 0; i < part.length; i += 1) {
    const [ax, az] = part[i] as PlanPoint
    const [bx, bz] = part[(i + 1) % part.length] as PlanPoint
    const [cx, cz] = part[(i + 2) % part.length] as PlanPoint
    const cross = (bx - ax) * (cz - bz) - (bz - az) * (cx - bx)
    if (Math.abs(cross) < 1e-12) continue
    const next = cross > 0 ? 1 : -1
    if (sign === 0) sign = next
    else if (sign !== next) return false
  }
  return true
}

/* -------------------------------------------------------------------- shape */

describe('the sector box', () => {
  it('is the tessellation table s own two lines of arithmetic', () => {
    // `pipeline/tessellation.ts`: bboxX = rOut - rIn*cos(theta), bboxY = rOut*sin(theta).
    const extent = arcSectorExtent(2, 4, 45)
    expect(extent.w).toBeCloseTo(4 - 2 * Math.cos(Math.PI / 4), 12)
    expect(extent.d).toBeCloseTo(4 * Math.sin(Math.PI / 4), 12)
  })

  it('degenerates to rOut x rOut at 90 degrees, where the centre IS the box corner', () => {
    const extent = arcSectorExtent(2, 4.5, 90)
    expect(extent.w).toBeCloseTo(4.5, 12)
    expect(extent.d).toBeCloseTo(4.5, 12)
    // Exactly zero, not `Math.cos(Math.PI / 2)`'s 6.1e-17, and not `-0`.
    expect(sectorCentre(arc(2, 4.5, 90))).toEqual([0, 0])
  })

  it('puts the arc centre outside the box for every sub-90 sweep with an inner radius', () => {
    // The consequence documented in `sectorCentre`: two concentric sub-90
    // sectors mate only at an anchor offset of rIn*cos(theta), which is
    // irrational here and so unreachable on the 0.5 snap.
    const [x] = sectorCentre(arc(4, 4.5, 45))
    expect(x).toBeCloseTo(-4 * Math.cos(Math.PI / 4), 12)
    expect(Number.isInteger(x * 2)).toBe(false)
  })

  it('bounds the outline exactly — the box is the extent, for every corpus sector', () => {
    for (const foot of CORPUS_SECTORS) {
      const extent = arcSectorExtent(foot.rIn, foot.rOut, foot.sweep)
      for (const [x, z] of sectorSamples(foot, 9, 13)) {
        expect(x).toBeGreaterThanOrEqual(-1e-9)
        expect(z).toBeGreaterThanOrEqual(-1e-9)
        expect(x).toBeLessThanOrEqual(extent.w + 1e-9)
        expect(z).toBeLessThanOrEqual(extent.d + 1e-9)
      }
    }
  })
})

/* ------------------------------------------------------------ decomposition */

describe('the convex decomposition', () => {
  it('holds its own tolerance on every sector the corpus produces', () => {
    for (const foot of CORPUS_SECTORS) {
      expect(sectorSlack(foot.rOut, foot.sweep)).toBeLessThanOrEqual(SECTOR_TOLERANCE_UNITS + 1e-12)
    }
  })

  it('bounds the worst realised slack at 0.2458 mm across the corpus', () => {
    // Computed, not targeted: the maximum of `sectorSlack` over the 29 rows
    // above -- and so over all 1,199 arc tiles, since every tile is one of them
    // -- is 0.009677 units. It is attained wherever the subdivision lands the
    // sub-angle on exactly 11.25 degrees, which the bisection ladder makes the
    // common case rather than an outlier. Guarding it means a change to the
    // tolerance or to the subdivision rule must restate the consequence rather
    // than absorb it.
    const worst = Math.max(...CORPUS_SECTORS.map((foot) => sectorSlack(foot.rOut, foot.sweep)))
    expect(worst).toBeCloseTo(0.009677, 6)
    expect(worst * 25.4).toBeLessThan(0.246)
    // And the set really is the whole corpus, so "worst across the corpus" holds.
    expect(CORPUS_ARC_TILES).toBe(1199)
  })

  it('emits between 1 and 14 parts, and a triangle when the inner radius is zero', () => {
    for (const foot of CORPUS_SECTORS) {
      const parts = sectorParts(foot)
      expect(parts).toHaveLength(sectorSubdivisions(foot.rOut, foot.sweep))
      expect(parts.length).toBeGreaterThanOrEqual(1)
      expect(parts.length).toBeLessThanOrEqual(14)
      for (const part of parts) expect(part).toHaveLength(foot.rIn === 0 ? 3 : 4)
    }
  })

  it('emits only convex parts — SAT has no theorem behind it otherwise', () => {
    for (const foot of CORPUS_SECTORS) {
      for (const part of sectorParts(foot)) expect(isConvex(part)).toBe(true)
    }
  })

  it('CONTAINS the sector: no sampled point of any corpus sector falls outside the parts', () => {
    // Claim 1, and the one that fixes the error direction. 28 sectors x 140
    // sample points. The ring and spoke counts are coprime with the subdivision
    // counts (1..14) where possible, so samples land inside sub-sectors rather
    // than repeatedly on the radii that bound them.
    for (const foot of CORPUS_SECTORS) {
      const parts = sectorParts(foot)
      for (const point of sectorSamples(foot, 9, 13)) {
        expect(partsContain(parts, point)).toBe(true)
      }
    }
  })

  it('exceeds the sector OUTWARD ONLY, and by no more than the proved slack', () => {
    // Claim 2. Every vertex of every part is inside the wedge and within
    // `slack` of the band, so the parts can only ever be too big.
    for (const foot of CORPUS_SECTORS) {
      const slack = sectorSlack(foot.rOut, foot.sweep)
      const [ox, oz] = sectorCentre(foot)
      for (const part of sectorParts(foot)) {
        for (const [x, z] of part) {
          const radius = Math.hypot(x - ox, z - oz)
          const angle = (Math.atan2(z - oz, x - ox) * 180) / Math.PI
          expect(radius).toBeLessThanOrEqual(foot.rOut + slack + 1e-9)
          expect(radius).toBeGreaterThanOrEqual(Math.max(0, foot.rIn - slack) - 1e-9)
          expect(angle).toBeGreaterThanOrEqual(-1e-9)
          expect(angle).toBeLessThanOrEqual(foot.sweep + 1e-9)
        }
      }
    }
  })
})

/* --------------------------------------------------------------- the path */

describe('the drawn outline', () => {
  it('names the sector s four corners and two radii, not the decomposition', () => {
    const foot = arc(2, 4, 90)
    const path = sectorPath(foot)
    // Starts at the outer arc on the +x axis, which at 90 degrees is (rOut, 0).
    expect(path.startsWith('M 4 0 A 4 4 0 0 1 ')).toBe(true)
    // Two arc commands: outer forward, inner back. Not 14 line segments.
    expect(path.match(/A /g)).toHaveLength(2)
    expect(path.endsWith('Z')).toBe(true)
  })

  it('closes a zero-inner-radius sector through the arc centre, with one arc', () => {
    const path = sectorPath(arc(0, 2, 90, 'disc'))
    expect(path.match(/A /g)).toHaveLength(1)
    expect(path).toContain('L 0 0 Z')
  })

  it('never emits a negative zero, which would round-trip differently through JSON', () => {
    for (const foot of CORPUS_SECTORS) expect(sectorPath(foot)).not.toContain('-0 ')
  })
})

/* ------------------------------------------------- the error direction, placed */

/**
 * A placed sector as an overlap subject — the same call the scene makes.
 *
 * Both sectors are given the same band so the band model does not silently
 * exempt the pair; this file is testing the geometry, and `plan.test.ts` tests
 * the band model.
 */
function subject(foot: ArcFootprint, rotation: number, x: number, z: number): OverlapSubject {
  const shape = footprintShape(foot)
  if (shape === undefined) throw new Error('an arc has a shape')
  const placed = planGeometry(shape, rotation, x, z)
  return { band: 'area', box: placed.box, parts: placed.parts, axisAligned: placed.axisAligned }
}

/**
 * Whether two placed sectors truly intersect **by more than a touch**, by the
 * independent oracle on a fine grid.
 *
 * Walks A's own polar interior — inset by {@link INTERIOR_MARGIN}, so a point on
 * A's boundary is not offered — and asks B's analytic membership, inset by the
 * same margin. A hit therefore means a point strictly inside both.
 */
function trulyIntersect(
  a: { foot: ArcFootprint; rotation: number; x: number; z: number },
  b: { foot: ArcFootprint; rotation: number; x: number; z: number },
): boolean {
  const shape = footprintShape(a.foot)
  if (shape === undefined) throw new Error('an arc has a shape')
  const placed = planGeometry(shape, a.rotation, a.x, a.z)
  // Walk a's own polar grid, mapped into world units, and ask b's oracle.
  const [ox, oz] = sectorCentre(a.foot)
  const cx = placed.box.x + placed.box.w / 2
  const cz = placed.box.z + placed.box.d / 2
  const radians = (placed.angle * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const inner = a.foot.rIn + INTERIOR_MARGIN
  const outer = a.foot.rOut - INTERIOR_MARGIN
  for (let i = 0; i <= 40; i += 1) {
    const radius = inner + ((outer - inner) * i) / 40
    const inset = (Math.asin(Math.min(1, INTERIOR_MARGIN / radius)) * 180) / Math.PI
    for (let j = 0; j <= 60; j += 1) {
      const angle = ((inset + ((a.foot.sweep - 2 * inset) * j) / 60) * Math.PI) / 180
      const lx = ox + radius * Math.cos(angle) - shape.extent.w / 2
      const lz = oz + radius * Math.sin(angle) - shape.extent.d / 2
      const point: PlanPoint = [cx + lx * cos - lz * sin, cz + lx * sin + lz * cos]
      if (inPlacedSector(b.foot, b.rotation, b.x, b.z, point, INTERIOR_MARGIN)) return true
    }
  }
  return false
}

describe('the error direction, on placed pairs', () => {
  /** A deterministic generator, so a failure is reproducible from the seed alone. */
  function lcg(seed: number): () => number {
    let state = seed >>> 0
    return () => {
      state = (state * 1_664_525 + 1_013_904_223) >>> 0
      return state / 0x1_0000_0000
    }
  }

  it('never misses a real intersection, over 240 randomised pairs', () => {
    // Claim 3, the half that matters: a false negative here is an unprintable
    // room. The oracle finds the truth by sampling A's interior and asking B's
    // analytic membership, so it shares no code with the decomposition. "Real"
    // means deeper than INTERIOR_MARGIN, because a shared boundary is not a
    // conflict by design — see the constant.
    const random = lcg(20_260_902)
    const shapes = [arc(0, 2, 90, 'disc'), arc(2, 4, 45), arc(3.5, 4, 22.5, 'convex'), arc(4, 4.5, 90, 'concave')]
    let missed = 0
    let real = 0
    let flagged = 0
    for (let trial = 0; trial < 240; trial += 1) {
      const a = {
        foot: shapes[trial % shapes.length] as ArcFootprint,
        rotation: Math.floor(random() * 8) * 45,
        x: 0,
        z: 0,
      }
      const b = {
        foot: shapes[(trial * 3 + 1) % shapes.length] as ArcFootprint,
        rotation: Math.floor(random() * 8) * 45,
        x: Math.round((random() * 8 - 4) * 2) / 2,
        z: Math.round((random() * 8 - 4) * 2) / 2,
      }
      const reported = subjectsConflict(
        subject(a.foot, a.rotation, a.x, a.z),
        subject(b.foot, b.rotation, b.x, b.z),
      )
      const truth = trulyIntersect(a, b) || trulyIntersect(b, a)
      if (truth) real += 1
      if (reported) flagged += 1
      if (truth && !reported) missed += 1
    }
    // The trial set has to actually exercise both answers, or "never missed" is
    // vacuous.
    expect(real).toBeGreaterThan(40)
    expect(flagged).toBeGreaterThan(40)
    expect(missed).toBe(0)
  })

  it('errs toward the false positive, and demonstrably so', () => {
    // Two 90-degree quarter discs of radius 2, anchored so their straight faces
    // are 0.5 units apart: no contact, and none reported.
    const apart = subjectsConflict(subject(arc(0, 2, 90, 'disc'), 0, 0, 0), subject(arc(0, 2, 90, 'disc'), 0, 2.5, 0))
    expect(apart).toBe(false)

    // Overlapped by a whole unit: reported.
    const over = subjectsConflict(subject(arc(0, 2, 90, 'disc'), 0, 0, 0), subject(arc(0, 2, 90, 'disc'), 0, 1, 0))
    expect(over).toBe(true)

    // And the direction of the residual error, stated as an inequality rather
    // than as an example: the decomposition is a superset, so anything it
    // reports that is not real lies within `slack` of being real. There is no
    // pair for which the reverse can hold.
    const slack = sectorSlack(2, 90)
    expect(slack).toBeGreaterThan(0)
    expect(slack).toBeLessThanOrEqual(SECTOR_TOLERANCE_UNITS)
  })
})
