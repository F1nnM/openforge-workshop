/**
 * The 3D placement is the plan-view placement. Asserted numerically, not by
 * inspection.
 *
 * ## What these tests prove
 *
 * The load-bearing one: for a mesh whose real footprint matches its tagged one,
 * the axis-aligned box of the placed mesh in 3D is **exactly** `planBox` — the
 * same function the 2D canvas draws and `overlap.ts` collides against. It is
 * checked at 0°, at a quarter turn (where the extents swap), at 45° (where the
 * bounding box is 41% larger than the piece), on a `diag` (whose intrinsic 45°
 * is folded into the drawn angle before any of this), and on an `arc` (whose box
 * comes from `sector.ts`'s annular-sector arithmetic, not from a width and a
 * depth). So the two views cannot disagree about where a piece is without one of
 * these failing.
 *
 * The **sign of the yaw** gets its own test, because it is the mistake that does
 * not look like a mistake: rotating the wrong way mirrors a room about its own
 * diagonal and is completely invisible on a square tile. The check is a 4 × 0.5
 * wall at 90°, where the long axis has to end up along `z` and the drawn box has
 * to be 0.5 × 4.
 *
 * ## What they cannot prove
 *
 * Nothing renders. These are matrices and bounding boxes on the CPU; whether the
 * GPU draws them, whether they are lit correctly and whether the AO reads as a
 * crease are all outside any test in this row. And the *canonical orientation* —
 * which of two 180°-apart yaws a tile takes — is a decision, not a fact: the
 * footprint comes from tags and nothing in the data links the STL's second axis
 * to the plan's depth direction, so these tests pin the choice rather than
 * validate it. `geometry.ts` makes the same disclosure about `tri` and `diag`.
 */
import { Box3, Matrix4, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'

import { footprintShape, planBox, planGeometry, rotatedExtent } from '@/builder/canvas'
import type { Extent, PlanGeometry } from '@/builder/canvas'
import type { Footprint } from '@/catalog'
import { GRID_UNIT_MM } from '@/catalog'

import {
  Z_UP_TO_Y_UP_RADIANS,
  fitRoom,
  footprintDelta,
  meshFootprintUnits,
  placedBounds,
  roomBounds,
  tileMatrix,
  uprightBounds,
} from './place'

/**
 * A synthetic mesh whose footprint matches an extent exactly, in Z-up mm.
 *
 * Deliberately offset from the origin in all three axes: the archive's meshes
 * are not centred on anything in particular, and a `tileMatrix` that forgot to
 * recentre would pass every test written against a mesh that happened to be.
 */
function meshFor(extent: Extent, heightMm = 6, offset = new Vector3(37, -19, 0)): Box3 {
  return new Box3(
    offset.clone(),
    offset.clone().add(new Vector3(extent.w * GRID_UNIT_MM, extent.d * GRID_UNIT_MM, heightMm)),
  )
}

function geometryFor(foot: Footprint, rotation: number, x: number, z: number): PlanGeometry {
  const shape = footprintShape(foot)
  if (shape === undefined) throw new Error(`${foot.shape} has no plan shape`)
  return planGeometry(shape, rotation, x, z)
}

/** The placed mesh's axis-aligned box, in **grid units**, so it compares to `planBox`. */
function placedUnits(bounds: Box3, geometry: PlanGeometry): { x: number; z: number; w: number; d: number } {
  const box = placedBounds(bounds, tileMatrix(bounds, geometry))
  return {
    x: box.min.x / GRID_UNIT_MM,
    z: box.min.z / GRID_UNIT_MM,
    w: (box.max.x - box.min.x) / GRID_UNIT_MM,
    d: (box.max.z - box.min.z) / GRID_UNIT_MM,
  }
}

function expectMatchesPlan(foot: Footprint, rotation: number, x: number, z: number): void {
  const geometry = geometryFor(foot, rotation, x, z)
  const mesh = meshFor(geometry.shape.extent)
  const placed = placedUnits(mesh, geometry)
  expect(placed.x).toBeCloseTo(geometry.box.x, 9)
  expect(placed.z).toBeCloseTo(geometry.box.z, 9)
  expect(placed.w).toBeCloseTo(geometry.box.w, 9)
  expect(placed.d).toBeCloseTo(geometry.box.d, 9)
}

/* ---------------------------------------------------------------- the Z flip */

describe('uprightBounds', () => {
  it('is exact on the quarter turn, unlike the matrix', () => {
    const bounds = new Box3(new Vector3(0, 1, 2), new Vector3(10, 4, 8))
    const upright = uprightBounds(bounds)
    // (x, y, z) → (x, z, −y). No 6.1e-17 anywhere, which is the same refusal
    // `sector.ts` and `geometry.ts` make about trigonometric residue.
    expect(upright.min.toArray()).toEqual([0, 2, -4])
    expect(upright.max.toArray()).toEqual([10, 8, -1])
  })

  it('is a rotation and not a reflection', () => {
    // The axis swap (x, y, z) → (x, z, y) is the mapping that first suggests
    // itself and it has determinant −1: it would mirror every tile and invert
    // every triangle's winding. −90° about X does not.
    const matrix = new Matrix4().makeRotationX(Z_UP_TO_Y_UP_RADIANS)
    expect(matrix.determinant()).toBeCloseTo(1, 12)
    expect(Z_UP_TO_Y_UP_RADIANS).toBeCloseTo(-Math.PI / 2, 15)
  })

  it('turns the archive’s tall Z axis into three’s tall Y axis', () => {
    // The fixture mesh's real numbers: 25.4 long, 12.7 across, 6 tall on Z.
    const bounds = new Box3(new Vector3(-12.7, -6.351, 0), new Vector3(12.7, 6.351, 6))
    const upright = uprightBounds(bounds)
    expect(upright.max.y - upright.min.y).toBeCloseTo(6, 9)
    expect(upright.max.z - upright.min.z).toBeCloseTo(12.702, 9)
  })
})

/* ------------------------------------------------------ agreement with plan */

describe('tileMatrix reproduces planBox', () => {
  const rect: Footprint = { shape: 'rect', w: 2, d: 1 }
  const wall: Footprint = { shape: 'wall', length: 4 }

  it('on a 2 × 1 rect at the origin', () => {
    expectMatchesPlan(rect, 0, 0, 0)
  })

  it('on a 2 × 1 rect off the origin, at a half-unit anchor', () => {
    expectMatchesPlan(rect, 0, 3.5, -2)
  })

  it('on a quarter turn, where the extents swap', () => {
    expectMatchesPlan(rect, 90, 1, 1)
    expectMatchesPlan(rect, 270, -4.5, 6)
  })

  it('at 45°, where the bounding box is 41% larger than the piece', () => {
    expectMatchesPlan(rect, 45, 2, 2)
  })

  it('on a 4-unit wall, whose depth is the measured 0.5 constant', () => {
    expectMatchesPlan(wall, 0, 0, 0)
    expectMatchesPlan(wall, 90, 0, 0)
  })

  it('on a column, a tri and a hex wall run at 60°', () => {
    expectMatchesPlan({ shape: 'column' }, 0, 1.5, 1.5)
    expectMatchesPlan({ shape: 'tri', leg: 1 }, 45, 0, 0)
    expectMatchesPlan({ shape: 'wall', length: 1 }, 60, 2, 0)
  })

  it('on a diag, whose intrinsic 45° is already in the drawn angle', () => {
    const foot: Footprint = { shape: 'diag', run: 3.536 }
    const geometry = geometryFor(foot, 0, 0, 0)
    // The placement's rotation is 0 and the drawn angle is 45 — this is the one
    // case where the two differ, on all 121 of them.
    expect(geometry.rotation).toBe(0)
    expect(geometry.angle).toBe(45)
    expectMatchesPlan(foot, 0, 0, 0)
    expectMatchesPlan(foot, 45, 1, 1)
  })

  it('on an arc, whose box is an annular sector’s and not a width by a depth', () => {
    const foot: Footprint = {
      shape: 'arc',
      rIn: 4,
      rOut: 4.5,
      sweep: 22.5,
      band: 'radial',
      bandBasis: 'measured',
    }
    const geometry = geometryFor(foot, 0, 0, 0)
    // sector.ts: w = rOut − rIn·cos θ, d = rOut·sin θ. Not 4.5 × 4.5.
    expect(geometry.shape.extent.w).toBeCloseTo(4.5 - 4 * Math.cos(Math.PI / 8), 9)
    expect(geometry.shape.extent.d).toBeCloseTo(4.5 * Math.sin(Math.PI / 8), 9)
    expectMatchesPlan(foot, 0, 0, 0)
    expectMatchesPlan(foot, 22.5, 0, 0)
    expectMatchesPlan(foot, 90, 2, 3)
  })
})

describe('the sign of the yaw', () => {
  it('turns a 4 × 0.5 wall onto the z axis at 90°, not off the lattice', () => {
    const foot: Footprint = { shape: 'wall', length: 4 }
    const geometry = geometryFor(foot, 90, 0, 0)
    expect(geometry.box.w).toBeCloseTo(0.5, 9)
    expect(geometry.box.d).toBeCloseTo(4, 9)

    const mesh = meshFor(geometry.shape.extent)
    const placed = placedUnits(mesh, geometry)
    // The long axis is now z. A yaw of the opposite sign gives the same *box*
    // here — which is exactly why the box test alone is not enough — so the
    // check below is on a point, not on an extent.
    expect(placed.w).toBeCloseTo(0.5, 9)
    expect(placed.d).toBeCloseTo(4, 9)
  })

  it('sends the mesh’s +x end to +z, matching the plan’s own rotation', () => {
    // The plan rotates (dx, dz) to (dx cos θ − dz sin θ, dx sin θ + dz cos θ).
    // At θ = 90° the local +x corner goes to local +z. three's R_y(φ) sends
    // (x, z) to (x cos φ + z sin φ, −x sin φ + z cos φ), which matches at
    // φ = −θ — so the matrix must carry a *negative* yaw.
    const extent: Extent = { w: 4, d: 0.5 }
    const foot: Footprint = { shape: 'wall', length: 4 }
    const geometry = geometryFor(foot, 90, 0, 0)
    const mesh = meshFor(extent)
    const matrix = tileMatrix(mesh, geometry)

    // The mesh's own +x extreme, mid-depth, at its base.
    const tip = new Vector3(mesh.max.x, (mesh.min.y + mesh.max.y) / 2, mesh.min.z).applyMatrix4(matrix)
    const centre = new Vector3(
      (geometry.box.x + geometry.box.w / 2) * GRID_UNIT_MM,
      0,
      (geometry.box.z + geometry.box.d / 2) * GRID_UNIT_MM,
    )
    expect(tip.x - centre.x).toBeCloseTo(0, 6)
    expect(tip.z - centre.z).toBeCloseTo(2 * GRID_UNIT_MM, 6)
    expect(tip.y).toBeCloseTo(0, 6)
  })

  it('rotates about the plan’s box centre, so the anchor corner is preserved', () => {
    // geometry.ts's anchoring rule: rotation preserves the anchor corner and the
    // extents swap around it. If this row rotated about the mesh's origin
    // instead, a 2-unit wall would move 0.75 units — a multiple of 0.25, off the
    // 0.5 lattice, which is the whole thing the corner anchor exists to prevent.
    const foot: Footprint = { shape: 'wall', length: 2 }
    for (const rotation of [0, 90, 180, 270]) {
      const geometry = geometryFor(foot, rotation, 1.5, -0.5)
      const placed = placedUnits(meshFor(geometry.shape.extent), geometry)
      expect(placed.x).toBeCloseTo(1.5, 9)
      expect(placed.z).toBeCloseTo(-0.5, 9)
    }
  })
})

describe('the base rests on the ground', () => {
  it('puts the mesh’s lowest point at y = 0 whatever its own origin was', () => {
    const foot: Footprint = { shape: 'rect', w: 1, d: 1 }
    const geometry = geometryFor(foot, 0, 0, 0)
    for (const offset of [new Vector3(0, 0, 0), new Vector3(-500, 220, 41.7)]) {
      const mesh = meshFor(geometry.shape.extent, 45.01, offset)
      const box = placedBounds(mesh, tileMatrix(mesh, geometry))
      expect(box.min.y).toBeCloseTo(0, 6)
      // The p95 tile is 45.01 mm tall; height survives the placement untouched.
      expect(box.max.y).toBeCloseTo(45.01, 6)
    }
  })
})

/* -------------------------------------------------- mesh versus the tag data */

describe('footprintDelta', () => {
  it('is zero when the mesh is the tagged size', () => {
    const extent: Extent = { w: 4, d: 0.5 }
    expect(footprintDelta(meshFor(extent), extent).worst).toBeCloseTo(0, 9)
    expect(meshFootprintUnits(meshFor(extent))).toEqual({ w: 4, d: 0.5 })
  })

  it('reports the corpus’s known worst case rather than correcting it', () => {
    // src/catalog/schema.ts: 27 curved-interface floors whose tagged width
    // over-states the mesh by up to 1.513 units. A row that scaled the mesh into
    // the tagged box would hide that by deforming real geometry.
    const tagged: Extent = { w: 4, d: 4 }
    const mesh = meshFor({ w: 4 - 1.513, d: 4 })
    const delta = footprintDelta(mesh, tagged)
    expect(delta.w).toBeCloseTo(-1.513, 6)
    expect(delta.d).toBeCloseTo(0, 9)
    expect(delta.worst).toBeCloseTo(1.513, 6)
  })
})

/* ------------------------------------------------------------------ the room */

describe('fitRoom', () => {
  it('normalises a room to the unit radius Stage is tuned for', () => {
    const bounds = new Box3(new Vector3(0, 0, 0), new Vector3(101.6, 12.7, 4.5))
    const fit = fitRoom(bounds, 1)
    // Half the box diagonal, which for the median tile's extents is 51.246 mm.
    expect(fit.radiusMm).toBeCloseTo(Math.hypot(101.6, 12.7, 4.5) / 2, 9)
    expect(fit.scale).toBeCloseTo(1 / fit.radiusMm, 12)
    expect(fit.centre.toArray()).toEqual([50.8, 6.35, 2.25])
  })

  it('grows the scale as the room grows, so the frame is constant', () => {
    const one = fitRoom(new Box3(new Vector3(), new Vector3(25.4, 6, 25.4)), 1)
    const forty = fitRoom(new Box3(new Vector3(), new Vector3(254, 6, 254)), 1)
    expect(forty.scale).toBeLessThan(one.scale)
    expect(one.radiusMm * one.scale).toBeCloseTo(1, 12)
    expect(forty.radiusMm * forty.scale).toBeCloseTo(1, 12)
  })

  it('does not divide by zero on an empty or degenerate room', () => {
    // geometry.ts guards the same case for the same reason: a NaN bounding
    // sphere disables culling and raycasting with no warning at all.
    expect(fitRoom(new Box3(), 1).scale).toBe(1)
    expect(fitRoom(new Box3(new Vector3(), new Vector3()), 1).scale).toBe(1)
    expect(Number.isFinite(fitRoom(new Box3(), 1).radiusMm)).toBe(true)
  })

  it('unions the placements it is given', () => {
    const union = roomBounds([
      new Box3(new Vector3(0, 0, 0), new Vector3(25.4, 6, 25.4)),
      new Box3(new Vector3(-25.4, 0, 0), new Vector3(0, 12, 25.4)),
    ])
    expect(union.min.toArray()).toEqual([-25.4, 0, 0])
    expect(union.max.toArray()).toEqual([25.4, 12, 25.4])
    expect(roomBounds([]).isEmpty()).toBe(true)
  })
})

/* -------------------------------------------------------------- the plan API */

describe('this row reads the plan view’s geometry rather than restating it', () => {
  it('takes its box from planBox and its swap from rotatedExtent', () => {
    // If either of those two functions changes, this row changes with it — which
    // is the point of consuming `PlanGeometry` instead of a width and a depth.
    const extent: Extent = { w: 2, d: 0.5 }
    expect(rotatedExtent(extent, 90)).toEqual({ w: 0.5, d: 2 })
    expect(planBox(extent, 90, 1, 2)).toEqual({ x: 1, z: 2, w: 0.5, d: 2 })
  })
})
