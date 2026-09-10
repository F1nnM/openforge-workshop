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
import type { Footprint, HoleMount, InsertAnchor, OpeningMount, SocketMount } from '@/catalog'
import { GRID_UNIT_MM, faceVector } from '@/catalog'

import type { HostFrame } from './place'
import {
  Z_UP_TO_Y_UP_RADIANS,
  accessoryMatrix,
  fitRoom,
  footprintDelta,
  isLeafPair,
  liftMatrix,
  meshFootprintUnits,
  placedBounds,
  roomBounds,
  tileMatrix,
  uprightBounds,
  zUpToYUp,
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

describe('liftMatrix', () => {
  it('raises the placed box by exactly the elevation and moves it nowhere else', () => {
    const foot: Footprint = { shape: 'rect', w: 2, d: 1 }
    const geometry = geometryFor(foot, 0, 3, -2)
    const mesh = meshFor(geometry.shape.extent, 4.5)

    const grounded = placedBounds(mesh, tileMatrix(mesh, geometry))
    const lifted = placedBounds(mesh, liftMatrix(tileMatrix(mesh, geometry), 6.002))

    // 6.002 mm is the median height measured over 193 real archive bases — a
    // realistic slot elevation rather than a round number that could hide a
    // rounding bug.
    expect(lifted.min.y).toBeCloseTo(grounded.min.y + 6.002, 6)
    expect(lifted.max.y).toBeCloseTo(grounded.max.y + 6.002, 6)
    expect(lifted.min.x).toBeCloseTo(grounded.min.x, 6)
    expect(lifted.min.z).toBeCloseTo(grounded.min.z, 6)
    expect(lifted.max.x).toBeCloseTo(grounded.max.x, 6)
    expect(lifted.max.z).toBeCloseTo(grounded.max.z, 6)
  })

  it('lifts a turned tile upwards and not sideways, which post-multiplying would not', () => {
    // The one thing this function is capable of getting wrong. `tileMatrix`
    // ends with `R_x(-90°)`, so in the mesh's own pre-rotation frame `+y` is the
    // STL's `-z` — post-multiplying a y-translation would send a 90° wall
    // sideways along the plan instead of up. Asserted on a 4 x 0.5 wall at 90°,
    // the same case that catches a mirrored yaw.
    const foot: Footprint = { shape: 'rect', w: 4, d: 0.5 }
    const geometry = geometryFor(foot, 90, 0, 0)
    const mesh = meshFor({ w: 4, d: 0.5 }, 63.5)

    const grounded = placedBounds(mesh, tileMatrix(mesh, geometry))
    const lifted = placedBounds(mesh, liftMatrix(tileMatrix(mesh, geometry), 6))
    const wrong = placedBounds(
      mesh,
      tileMatrix(mesh, geometry).multiply(new Matrix4().makeTranslation(0, 6, 0)),
    )

    expect(lifted.min.y).toBeCloseTo(grounded.min.y + 6, 6)
    expect(lifted.min.x).toBeCloseTo(grounded.min.x, 6)
    expect(lifted.min.z).toBeCloseTo(grounded.min.z, 6)

    // The wrong composition leaves the height untouched and slides the tile
    // across the plan by the whole 6 mm instead. At this yaw the displacement
    // lands in `x`; the direction is a function of the angle, which is why the
    // assertion is on the horizontal distance rather than on one axis.
    expect(wrong.min.y).toBeCloseTo(grounded.min.y, 6)
    expect(Math.hypot(wrong.min.x - grounded.min.x, wrong.min.z - grounded.min.z)).toBeCloseTo(6, 6)
  })

  it('is the identity at zero, so nothing the plan view ever drew moves', () => {
    const foot: Footprint = { shape: 'rect', w: 1, d: 1 }
    const geometry = geometryFor(foot, 0, 0, 0)
    const mesh = meshFor(geometry.shape.extent)
    const plain = tileMatrix(mesh, geometry)

    expect(liftMatrix(tileMatrix(mesh, geometry), 0).elements).toEqual(plain.elements)
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

/* --------------------------------------------------------------- accessories */

/**
 * One accessory instance, checked as points and directions rather than as a
 * matrix.
 *
 * A 4×4 has no readable failure message, and the two things that can be wrong
 * here are *where the anchor lands* and *which way the insert points* — so every
 * assertion below is one of those two, at the brief's 0.1 mm and 1°.
 *
 * The insert meshes are deliberately **off the origin in all three axes**, for
 * `meshFor`'s reason one level down: the anchor's `at` is in the insert's bbox
 * coordinates, so a composition that forgot the insert's own normalisation would
 * pass against a mesh that happened to be centred and fail on every real one.
 */
const PEG_MESH = new Box3(new Vector3(100, -50, 7), new Vector3(107, -43, 19))
/** The peg's base centre and its tip, as points of that mesh. 7 × 7 × 12 mm. */
const PEG_BASE = new Vector3(103.5, -46.5, 7)
const PEG_TIP = new Vector3(103.5, -46.5, 19)
const PEG: InsertAnchor = { kind: 'peg', at: [0, 0, 0], axis: [0, 0, 1], size: [7, 7, 12] }

/** The measured torch socket: a 5.5 × 3 mm mouth entering at the 62–65° lean. */
const SOCKET: SocketMount = {
  slot: 'torch',
  kind: 'socket',
  face: '-y',
  normal: [0, -1, 0],
  at: [0, -6.5, 28],
  axis: [0, 0.45, -0.89],
  section: [5.5, 3],
  depth: 14,
}

const LEAF_MESH = new Box3(new Vector3(-214, 60, 33), new Vector3(-186, 63, 88))
/** The leaf's bottom centre, as a point of that mesh. 28 × 3 × 55 mm. */
const LEAF_SEAT = new Vector3(-200, 61.5, 33)
const LEAF: InsertAnchor = { kind: 'leaf', at: [0, 0, 0], axis: [0, 1, 0], size: [28, 3, 55] }

/** A `wide` doorway: two leaves over a 28 mm opening, sill 1.5, head 61.5. */
const DOORWAY: OpeningMount = {
  slot: 'door',
  kind: 'opening',
  face: '-y',
  normal: [0, -1, 0],
  at: [0, -6.5, 30],
  width: 28,
  sill: 1.5,
  head: 61.5,
  openTop: false,
  leaves: 2,
}

/**
 * A host part whose plan box is centred on the world origin, at `rotation`.
 *
 * Centred so that the mount's own bbox coordinates and the world ones agree at
 * rotation 0 — which is what makes the expected numbers below readable — and a
 * real 2-unit wall rather than a synthetic box, so the yaw the rotated case
 * checks is the plan's own.
 */
function hostFrame(rotation: number, elevationMm = 0): HostFrame {
  const shape = footprintShape({ shape: 'wall', length: 2 })
  if (shape === undefined) throw new Error('a wall has no plan shape')
  const turned = rotatedExtent(shape.extent, rotation)
  return { geometry: planGeometry(shape, rotation, -turned.w / 2, -turned.d / 2), elevationMm }
}

/** Where a point of the insert's own mesh lands, in world millimetres. */
function landsAt(matrix: Matrix4, mesh: Vector3): Vector3 {
  return mesh.clone().applyMatrix4(matrix)
}

/** The world direction from one mesh point to another, once placed. */
function pointsAlong(matrix: Matrix4, from: Vector3, to: Vector3): Vector3 {
  return landsAt(matrix, to).sub(landsAt(matrix, from)).normalize()
}

function expectAt(got: Vector3, x: number, y: number, z: number): void {
  expect(got.x).toBeCloseTo(x, 1)
  expect(got.y).toBeCloseTo(y, 1)
  expect(got.z).toBeCloseTo(z, 1)
}

/** Degrees between two directions. The brief's tolerance is 1°. */
function degreesBetween(a: Vector3, b: Vector3): number {
  return (a.angleTo(b) * 180) / Math.PI
}

describe('zUpToYUp', () => {
  it('is the same swap uprightBounds applies, on a vector', () => {
    expect(zUpToYUp([1, 2, 3]).toArray()).toEqual([1, 3, -2])
    // The archive's up — the host's own +z — becomes three's +y, which is what
    // makes "the flame points up" a statement about the mesh's own axes.
    expect(zUpToYUp([0, 0, 1]).equals(new Vector3(0, 1, 0))).toBe(true)
  })
})

describe('accessoryMatrix seats a peg in a socket', () => {
  const insert = { bounds: PEG_MESH, anchor: PEG }

  it('lands the peg’s base centre on the socket’s own bbox point', () => {
    const matrix = accessoryMatrix(hostFrame(0), SOCKET, insert, 'torch', 0)
    // (x, y, z) → (x, z, −y): the mount's [0, −6.5, 28] is 28 mm up the wall and
    // 6.5 mm out of its centre plane.
    expectAt(landsAt(matrix, PEG_BASE), 0, 28, 6.5)
  })

  it('points the peg up the socket’s 62–65° lean, out of the wall', () => {
    const matrix = accessoryMatrix(hostFrame(0), SOCKET, insert, 'torch', 0)
    // The socket's `axis` enters the host; the torch leaves along its negation,
    // which in Y-up is up and away from the face.
    const out = zUpToYUp(SOCKET.axis).negate().normalize()
    expect(degreesBetween(pointsAlong(matrix, PEG_BASE, PEG_TIP), out)).toBeLessThan(1)
    expect(out.y).toBeGreaterThan(0)
  })

  it('carries the point round with the host’s own yaw', () => {
    const matrix = accessoryMatrix(hostFrame(90), SOCKET, insert, 'torch', 0)
    // R_y(−90°) sends (x, z) to (−z, x): the wall now runs along z and its face
    // looks down −x, so the 6.5 mm stand-off does too.
    expectAt(landsAt(matrix, PEG_BASE), -6.5, 28, 0)
  })

  it('raises the whole seat by the host part’s elevation and nothing else', () => {
    const matrix = accessoryMatrix(hostFrame(0, 6.002), SOCKET, insert, 'torch', 0)
    expectAt(landsAt(matrix, PEG_BASE), 0, 28 + 6.002, 6.5)
  })
})

describe('accessoryMatrix hangs leaves in an opening', () => {
  const insert = { bounds: LEAF_MESH, anchor: LEAF }

  it('splits a two-leaf opening at ± a quarter of its width', () => {
    const left = accessoryMatrix(hostFrame(0), DOORWAY, insert, 'door', 0)
    const right = accessoryMatrix(hostFrame(0), DOORWAY, insert, 'door', 1)
    // 28 mm of opening, two leaves: each is centred a quarter of the width off
    // the mount, which is where two 14 mm halves meet in the middle.
    expectAt(landsAt(left, LEAF_SEAT), -7, 1.5, 6.5)
    expectAt(landsAt(right, LEAF_SEAT), 7, 1.5, 6.5)
  })

  it('turns the second leaf 180° about the vertical', () => {
    const left = accessoryMatrix(hostFrame(0), DOORWAY, insert, 'door', 0)
    const right = accessoryMatrix(hostFrame(0), DOORWAY, insert, 'door', 1)
    const across = new Vector3(LEAF_MESH.max.x, LEAF_SEAT.y, LEAF_SEAT.z)
    const one = pointsAlong(left, LEAF_SEAT, across)
    const other = pointsAlong(right, LEAF_SEAT, across)
    expect(degreesBetween(one, other.clone().negate())).toBeLessThan(1)
    // About the vertical and not about anything else: both leaves still stand up.
    for (const matrix of [left, right]) {
      const up = pointsAlong(matrix, LEAF_SEAT, new Vector3(LEAF_SEAT.x, LEAF_SEAT.y, LEAF_MESH.max.z))
      expect(degreesBetween(up, new Vector3(0, 1, 0))).toBeLessThan(1)
    }
  })

  it('seats a lintel at the head and everything else at the sill', () => {
    const single: OpeningMount = { ...DOORWAY, leaves: 1 }
    const lintel = accessoryMatrix(hostFrame(0), single, insert, 'lintel', 0)
    const door = accessoryMatrix(hostFrame(0), single, insert, 'door', 0)
    // The slot name decides, not the insert's shape: the same leaf hung under
    // `lintel` sits on the head and under `door` on the sill.
    expectAt(landsAt(lintel, LEAF_SEAT), 0, 61.5, 6.5)
    expectAt(landsAt(door, LEAF_SEAT), 0, 1.5, 6.5)
  })

  it('faces the leaf along the measured normal, not along the face label', () => {
    // A sector host is measured unrolled, where `face` names the inner radius
    // rather than a plane — so `faceVector('-y')` is a chord normal that can
    // miss the real one by half the sweep. Here the surface at the mount is
    // turned 30°, and the leaf has to turn with it.
    const turned = (30 * Math.PI) / 180
    const curved: OpeningMount = { ...DOORWAY, leaves: 1, normal: [Math.sin(turned), -Math.cos(turned), 0] }
    const matrix = accessoryMatrix(hostFrame(0), curved, insert, 'door', 0)
    const facing = pointsAlong(matrix, LEAF_SEAT, new Vector3(LEAF_SEAT.x, LEAF_MESH.max.y, LEAF_SEAT.z))
    expect(degreesBetween(facing, zUpToYUp(curved.normal))).toBeLessThan(1)
    expect(degreesBetween(facing, zUpToYUp(faceVector('-y')))).toBeCloseTo(30, 1)
  })
})

describe('accessoryMatrix stands a block in a hole', () => {
  it('points the anchor axis at world up, whatever the mount’s own face', () => {
    const hole: HoleMount = {
      slot: 'grate',
      kind: 'hole',
      face: '+z',
      normal: [0, 0, 1],
      at: [3, -4, 6],
      size: [20, 20],
    }
    const block: InsertAnchor = { kind: 'block', at: [0, 0, 0], axis: [0, 0, 1], size: [20, 20, 8] }
    const mesh = new Box3(new Vector3(-10, -10, 0), new Vector3(10, 10, 8))
    const matrix = accessoryMatrix(hostFrame(0), hole, { bounds: mesh, anchor: block }, 'grate', 0)
    expectAt(landsAt(matrix, new Vector3(0, 0, 0)), 3, 6, 4)
    const up = pointsAlong(matrix, new Vector3(0, 0, 0), new Vector3(0, 0, 8))
    expect(degreesBetween(up, new Vector3(0, 1, 0))).toBeLessThan(1)
  })
})

describe('accessoryMatrix on a measurement that is not a direction', () => {
  const insert = { bounds: LEAF_MESH, anchor: LEAF }

  it('draws one leaf and turns nothing when the opening’s normal is vertical', () => {
    // `up × normal` is the only thing that says where the *second* leaf goes, so
    // a level face has nowhere to put it. Two at one seat would be two coplanar
    // slabs z-fighting — an error that looks like a rendering artefact rather
    // than like bad data, which is why the pair rule refuses it outright.
    const level: OpeningMount = { ...DOORWAY, normal: [0, 0, 1] }
    expect(isLeafPair(level, LEAF)).toBe(false)
    expect(isLeafPair(DOORWAY, LEAF)).toBe(true)

    const first = accessoryMatrix(hostFrame(0), level, insert, 'door', 0)
    const second = accessoryMatrix(hostFrame(0), level, insert, 'door', 1)
    // One leaf: the count comes from the same predicate, so the second index is
    // never asked for — and if it were, it is the identical instance rather than
    // a flipped twin on top of the first.
    expect(second.elements).toEqual(first.elements)
    expectAt(landsAt(first, LEAF_SEAT), 0, 1.5, 6.5)
  })

  it('falls back to the face normal for a socket with no axis', () => {
    const axisless: SocketMount = { ...SOCKET, axis: [0, 0, 0] }
    const matrix = accessoryMatrix(hostFrame(0), axisless, { bounds: PEG_MESH, anchor: PEG }, 'torch', 0)
    // Straight out of the face with none of the lean — and, above all, finite: a
    // zero vector through `setFromUnitVectors` is a NaN quaternion, and a NaN
    // matrix is a mesh that fails every frustum test and vanishes silently.
    const out = pointsAlong(matrix, PEG_BASE, PEG_TIP)
    expect(degreesBetween(out, zUpToYUp(axisless.normal))).toBeLessThan(1)
    expect(matrix.elements.every((n) => Number.isFinite(n))).toBe(true)
  })

  it('falls back to the insert’s own up for an anchor with no axis', () => {
    const axisless: InsertAnchor = { ...PEG, axis: [0, 0, 0] }
    const matrix = accessoryMatrix(hostFrame(0), SOCKET, { bounds: PEG_MESH, anchor: axisless }, 'torch', 0)
    expect(matrix.elements.every((n) => Number.isFinite(n))).toBe(true)
    expectAt(landsAt(matrix, PEG_BASE), 0, 28, 6.5)
  })
})
