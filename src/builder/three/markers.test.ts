/**
 * The flat geometry, checked against the footprints it is built from.
 *
 * Two of these assertions are about failures that are invisible rather than
 * loud, which is why they are here at all:
 *
 *   - **Winding.** A plate wound the other way is back-facing and therefore
 *     *invisible from above* with no error anywhere — and the plan's polygons
 *     wind so that the naive fan points **down**, so getting this right takes a
 *     deliberate reversal. The test computes the face normal and checks its
 *     sign.
 *   - **Coverage.** A plate that did not cover the footprint would be a marker
 *     that under-states an occupied cell, which is the whole thing plates exist
 *     to prevent. The test compares the plate's own bounds against the piece's
 *     `box`, in millimetres.
 *
 * Built over real scene pieces rather than hand-written polygons, so the arc
 * case goes through `sector.ts`'s convex subdivision and the `diag` case through
 * its intrinsic 45°.
 */
import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'

import type { PlanPart, ScenePiece } from '@/builder/canvas'
import { planCatalogFromFile } from '@/builder/canvas'
import { FIXTURE_IDS, fixtureCatalogFile } from '@/builder/canvas/fixture'
import { GRID_UNIT_MM } from '@/catalog'

import { sceneOf } from './fixture'
import {
  PLATE_HEIGHT_MM,
  caretGeometry,
  plateEdgeGeometry,
  plateEdgePositions,
  plateGeometry,
  platePositions,
  plateTriangles,
} from './markers'

const CATALOG = planCatalogFromFile(fixtureCatalogFile())

/** A quad, an arc's sectors and a diagonal — three genuinely different shapes. */
const PIECES: readonly ScenePiece[] = sceneOf(CATALOG, [
  { tileId: FIXTURE_IDS.floor2, x: 0, z: 0 },
  { tileId: FIXTURE_IDS.arc, x: 6, z: 0 },
  { tileId: FIXTURE_IDS.diag, x: 12, z: 0 },
  { tileId: FIXTURE_IDS.tri, x: 18, z: 0 },
]).pieces

describe('the fan', () => {
  it('emits one triangle fewer than two per vertex, per convex part', () => {
    expect(plateTriangles([square()])).toBe(2)
    expect(plateTriangles([square(), square()])).toBe(4)
    // A hexagon fans into four.
    expect(plateTriangles([[[0, 0], [1, 0], [2, 1], [1, 2], [0, 2], [-1, 1]]])).toBe(4)
  })

  it('contributes nothing for a degenerate part rather than a NaN', () => {
    // `planParts` does not produce these; a hand-built fixture or a future
    // footprint case could, and a two-vertex "polygon" would otherwise emit one
    // zero-area triangle whose normal is (0, 0, 0) — a mesh that shades black.
    expect(plateTriangles([[[0, 0], [1, 0]]])).toBe(0)
    expect(platePositions([[[0, 0], [1, 0]]], 1)).toHaveLength(0)
    expect(platePositions([], 1)).toHaveLength(0)
  })

  it('matches the buffer to the arithmetic on every real footprint', () => {
    expect(PIECES).toHaveLength(4)
    for (const piece of PIECES) {
      const positions = platePositions(piece.parts, PLATE_HEIGHT_MM)
      expect(positions.length).toBe(plateTriangles(piece.parts) * 9)
      expect(positions.length).toBeGreaterThan(0)
    }
  })

  it('is flat at the height it was asked for', () => {
    for (const piece of PIECES) {
      const positions = platePositions(piece.parts, PLATE_HEIGHT_MM)
      for (let i = 1; i < positions.length; i += 3) {
        // `toBeCloseTo`, not `toBe`: the buffer is a `Float32Array`, so 0.6
        // stores as 0.6000000238418579. Flatness is the claim, not the bit pattern.
        expect(positions[i]).toBeCloseTo(PLATE_HEIGHT_MM, 5)
      }
    }
  })

  it('faces up, which the naive fan does not', () => {
    // The plan winds its polygons so that (origin, part[i], part[i+1]) has a
    // normal of (0, -1, 0) — pointing *away* from the camera. Asserted on every
    // triangle of every real footprint, not just the first.
    for (const piece of PIECES) {
      const positions = platePositions(piece.parts, PLATE_HEIGHT_MM)
      for (let i = 0; i < positions.length; i += 9) {
        expect(faceNormalY(positions, i)).toBeGreaterThan(0)
      }
    }
  })

  /**
   * The property that matters: **a plate never under-states an occupied cell.**
   *
   * The whole reason a plate exists is that a cell which looks empty invites a
   * second tile onto the first, so a marker smaller than the footprint would be
   * the original defect in a subtler form. Asserted as containment rather than
   * equality, because for an `arc` the two are genuinely different: `planBox`
   * takes an arc's extent from `sector.ts`'s `arcSectorExtent` — the true
   * sector — while the parts are the *convex subdivision* of it, whose chords
   * bulge outside the arc. Measured on the fixture's `r2` curve, the overshoot
   * is 0.246 mm, which is a hundredth of a grid unit and outward.
   */
  it('never under-states the cell, and overshoots only outward', () => {
    let worst = 0
    for (const piece of PIECES) {
      const positions = platePositions(piece.parts, PLATE_HEIGHT_MM)
      let minX = Infinity
      let maxX = -Infinity
      let minZ = Infinity
      let maxZ = -Infinity
      for (let i = 0; i < positions.length; i += 3) {
        minX = Math.min(minX, positions[i] as number)
        maxX = Math.max(maxX, positions[i] as number)
        minZ = Math.min(minZ, positions[i + 2] as number)
        maxZ = Math.max(maxZ, positions[i + 2] as number)
      }
      const box = {
        minX: piece.box.x * GRID_UNIT_MM,
        maxX: (piece.box.x + piece.box.w) * GRID_UNIT_MM,
        minZ: piece.box.z * GRID_UNIT_MM,
        maxZ: (piece.box.z + piece.box.d) * GRID_UNIT_MM,
      }
      // Contains the box, to a float32 tolerance.
      expect(minX).toBeLessThanOrEqual(box.minX + 1e-3)
      expect(maxX).toBeGreaterThanOrEqual(box.maxX - 1e-3)
      expect(minZ).toBeLessThanOrEqual(box.minZ + 1e-3)
      expect(maxZ).toBeGreaterThanOrEqual(box.maxZ - 1e-3)
      worst = Math.max(
        worst,
        box.minX - minX,
        maxX - box.maxX,
        box.minZ - minZ,
        maxZ - box.maxZ,
      )
    }
    // And the overshoot is bounded and small: a hundredth of a grid unit.
    expect(worst).toBeGreaterThan(0)
    expect(worst).toBeLessThan(GRID_UNIT_MM / 100)
  })
})

describe('the outline', () => {
  it('closes every ring, so a plate is bounded on all sides', () => {
    for (const piece of PIECES) {
      const expected = piece.parts.reduce((total, part) => total + part.length, 0)
      // One segment per edge, two vertices each, three floats each.
      expect(plateEdgePositions(piece.parts, PLATE_HEIGHT_MM).length).toBe(expected * 6)
    }
  })

  it('joins the last vertex back to the first', () => {
    const positions = plateEdgePositions([square()], 2)
    // The final segment runs from (0, 1) back to (0, 0), which is the wrap.
    expect(positions[positions.length - 3]).toBeCloseTo(0, 9)
    expect(positions[positions.length - 1]).toBeCloseTo(0, 9)
  })

  it('contributes nothing for a single point', () => {
    expect(plateEdgePositions([[[0, 0]]], 1)).toHaveLength(0)
  })
})

describe('the geometries', () => {
  it('carries positions with a bounding sphere, and no normals', () => {
    // No `NORMAL`: `flatShading` derives the face normal in three's own shader,
    // exactly as G1's store objects rely on — `lod.ts` records that a LOD object
    // carries `POSITION` and nothing else.
    const piece = PIECES[0] as ScenePiece
    const plate = plateGeometry(piece.parts)
    expect(plate.getAttribute('position').itemSize).toBe(3)
    expect(plate.getAttribute('normal')).toBeUndefined()
    expect(plate.boundingSphere).not.toBeNull()
    expect(plate.boundingSphere?.radius).toBeGreaterThan(0)
    plate.dispose()

    const ring = plateEdgeGeometry(piece.parts)
    expect(ring.getAttribute('position').itemSize).toBe(3)
    expect(ring.boundingSphere).not.toBeNull()
    ring.dispose()
  })

  it('is thin enough that nobody could read it as a tile', () => {
    // 0.6 mm against a 4.5 mm median floor and a 63.5 mm wall — see `markers.ts`
    // on why a plate is not the primitive stand-in the owner rejected.
    expect(PLATE_HEIGHT_MM).toBeLessThan(4.5 / 4)
    // And above the grid, which is dropped 0.2 mm, so the two cannot z-fight.
    expect(PLATE_HEIGHT_MM).toBeGreaterThan(0.2)
  })

  it('builds the caret at the plan view’s own arm length', () => {
    const caret = caretGeometry()
    const positions = caret.getAttribute('position')
    expect(positions.count).toBe(4)
    // 0.35 units either side of the centre, in millimetres.
    // Float32 again: 8.89 mm stores as 8.890000343322754.
    expect(positions.getX(1)).toBeCloseTo(0.35 * GRID_UNIT_MM, 4)
    expect(positions.getZ(3)).toBeCloseTo(0.35 * GRID_UNIT_MM, 4)
    // Flat: every vertex on `y = 0`, positioned by the caller.
    for (let i = 0; i < positions.count; i += 1) expect(positions.getY(i)).toBe(0)
    caret.dispose()
  })
})

/* ------------------------------------------------------------------- helpers */

function square(): PlanPart {
  return [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ]
}

/** The `y` of one triangle's face normal, from its position triple. */
function faceNormalY(positions: Float32Array, at: number): number {
  const a = new Vector3(positions[at], positions[at + 1], positions[at + 2])
  const b = new Vector3(positions[at + 3], positions[at + 4], positions[at + 5])
  const c = new Vector3(positions[at + 6], positions[at + 7], positions[at + 8])
  return b.sub(a).cross(c.sub(a)).y
}
