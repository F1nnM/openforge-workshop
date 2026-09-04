/**
 * The pointer maths, proven — and this file is the answer to a real objection.
 *
 * jsdom has no WebGL context, decodes nothing and reports every element as
 * 0 × 0, so it is tempting to conclude that nothing about a 3D pointer gesture
 * can be tested here. That is true of the *picture* and false of the
 * *arithmetic*: a `PerspectiveCamera` is a 4 × 4 matrix, `Raycaster.setFromCamera`
 * is an unprojection, and `Ray.intersectPlane` is a division. All three run in
 * Node exactly as they run in Chrome. So **"did the raycast hit the right
 * cell" is testable**, and it is tested below against a camera built from
 * `src/three/frame.ts`'s own numbers rather than a convenient one.
 *
 * What is still out of reach, stated so it is not implied otherwise: whether the
 * ghost *looked* right, whether the drag *felt* right, whether the AO landed in
 * the creases, and whether a click at a given screen pixel reaches this code at
 * all — that last one is a hit-testing question about the CSS, and row L1's
 * measurement of a 60-of-60-dead `Place` button is the reminder that it is a
 * separate question with its own answer.
 */
import { Box3, PerspectiveCamera, Ray, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'

import type { PlanBand, PlanPoint, ScenePiece } from '@/builder/canvas'
import { boxCentre, pieceAt, planCatalogFromFile } from '@/builder/canvas'
import { FIXTURE_IDS, fixtureCatalogFile } from '@/builder/canvas/fixture'
import { GRID_UNIT_MM } from '@/catalog'
import { CAMERA_FAR, CAMERA_FOV, CAMERA_NEAR, CAMERA_POSITION, VIEW_RADIUS } from '@/three/frame'

import { sceneOf } from './fixture'
import {
  CAMERA_ELEVATION_RADIANS,
  DRAG_THRESHOLD_PX,
  SURFACE_AREA_UNITS,
  groundParallaxUnits,
  groundPlanPoint,
  isClickGesture,
  meshHeightMm,
  ndcOf,
  pickSurface,
  pointerRay,
  planToScene,
  sceneToPlan,
  surfaceFit,
} from './surface'

const CATALOG = planCatalogFromFile(fixtureCatalogFile())
const FIT = surfaceFit(VIEW_RADIUS)

/** A 2½-inch wall and the median floor's 4.5 mm, the two heights in the docblock. */
const WALL_MM = 63.5
const FLOOR_MM = 4.5

/* ------------------------------------------------------------------ the frame */

describe('the work fit', () => {
  it('normalises a fixed work area, so the scale never moves', () => {
    // The half-diagonal of a 12 × 12-unit square in millimetres.
    const radiusMm = (SURFACE_AREA_UNITS * GRID_UNIT_MM * Math.SQRT2) / 2
    expect(FIT.radiusMm).toBeCloseTo(radiusMm, 9)
    expect(FIT.radiusMm).toBeCloseTo(215.5261, 4)
    // The defining property: the work area's radius *is* `VIEW_RADIUS`, which is
    // the frame `Stage`'s camera, orbit clamp and far plane are all tuned for.
    expect(FIT.radiusMm * FIT.scale).toBeCloseTo(VIEW_RADIUS, 12)
  })

  it('puts a 1 × 1 tile at the size the docblock claims', () => {
    // 6.9% of `Stage`'s visible span at the orbit target — the number
    // `SURFACE_AREA_UNITS` was chosen on. At the mockup's own 24-unit grid this
    // would be 3.4%, which is 20 px in a 600 px stage.
    const tile = GRID_UNIT_MM * FIT.scale
    expect(tile).toBeCloseTo(0.1179, 4)
    const span = 2 * 3.0 * Math.tan((CAMERA_FOV / 2) * (Math.PI / 180))
    expect(tile / span).toBeCloseTo(0.0685, 3)
  })

  it('converts both ways exactly, because the origin is shared', () => {
    for (const point of [[0, 0], [1, -1], [-3.5, 12.25], [0.5, 0.5]] as PlanPoint[]) {
      const scene = planToScene(point, 0, FIT)
      const back = sceneToPlan(scene.x, scene.z, FIT)
      expect(back[0]).toBeCloseTo(point[0], 12)
      expect(back[1]).toBeCloseTo(point[1], 12)
    }
  })

  it('carries an elevation into the scene without touching the plan point', () => {
    const raised = planToScene([2, 3], WALL_MM, FIT)
    const flat = planToScene([2, 3], 0, FIT)
    expect(raised.x).toBeCloseTo(flat.x, 12)
    expect(raised.z).toBeCloseTo(flat.z, 12)
    expect(raised.y).toBeCloseTo(WALL_MM * FIT.scale, 12)
  })
})

/* ---------------------------------------------------------------- the pointer */

describe('a pointer position as NDC', () => {
  const rect = { left: 100, top: 50, width: 800, height: 600 }

  it('puts the centre at the origin and the corners at the unit square', () => {
    expect(ndcOf(500, 350, rect)).toEqual({ x: 0, y: 0 })
    expect(ndcOf(100, 50, rect)).toEqual({ x: -1, y: 1 })
    expect(ndcOf(900, 650, rect)).toEqual({ x: 1, y: -1 })
  })

  it('returns the centre for a zero-sized rect rather than a NaN', () => {
    // Not a defensive flourish: jsdom reports every element as 0 × 0, and a NaN
    // here propagates into the unprojection and disables the raycaster with no
    // error at all. Demonstrated rather than asserted abstractly — the NaN is
    // what the arithmetic actually produces.
    expect((320 - 0) / 0).toBe(Infinity)
    expect(ndcOf(320, 240, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 })
  })
})

describe('the 5 px threshold, which is the mockup’s own', () => {
  it('separates a click from an orbit at exactly five pixels', () => {
    expect(DRAG_THRESHOLD_PX).toBe(5)
    expect(isClickGesture({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(true)
    // On the boundary and just past it, so the comparison cannot be `<` by
    // accident: a 3-4-5 triangle is exactly the threshold.
    expect(isClickGesture({ x: 10, y: 10 }, { x: 13, y: 14 })).toBe(true)
    expect(isClickGesture({ x: 10, y: 10 }, { x: 13, y: 15 })).toBe(false)
    expect(isClickGesture({ x: 10, y: 10 }, { x: 40, y: 10 })).toBe(false)
  })
})

/* ----------------------------------------------------------------- the parallax */

describe('why one ground plane is not enough', () => {
  it('reads the camera’s elevation off the shared frame', () => {
    const degrees = (CAMERA_ELEVATION_RADIANS * 180) / Math.PI
    expect(degrees).toBeCloseTo(27.38, 2)
    // Derived, not written down: it follows `CAMERA_POSITION`.
    expect(CAMERA_ELEVATION_RADIANS).toBeCloseTo(
      Math.atan2(CAMERA_POSITION[1], Math.hypot(CAMERA_POSITION[0], CAMERA_POSITION[2])),
      12,
    )
  })

  it('measures the error a ground-only pick would make', () => {
    // The two rows of the table in `surface.ts`'s docblock.
    expect(groundParallaxUnits(FLOOR_MM)).toBeCloseTo(0.342, 3)
    expect(groundParallaxUnits(WALL_MM)).toBeCloseTo(4.83, 2)
    // 4.83 units is nineteen fine snap steps, which is the point.
    expect(groundParallaxUnits(WALL_MM) / 0.5).toBeGreaterThan(9)
    // Straight down has no parallax at all, and the horizon has infinite.
    expect(groundParallaxUnits(WALL_MM, Math.PI / 2)).toBeCloseTo(0, 9)
    expect(groundParallaxUnits(WALL_MM, 0)).toBe(Infinity)
  })
})

/* --------------------------------------------------------------------- the pick */

/** A camera at `CAMERA_POSITION`'s offset looking at one scene point. */
function cameraOn(target: Vector3): PerspectiveCamera {
  const camera = new PerspectiveCamera(CAMERA_FOV, 1.5, CAMERA_NEAR, CAMERA_FAR)
  camera.position.copy(target).add(new Vector3(...CAMERA_POSITION))
  camera.lookAt(target)
  camera.updateMatrixWorld()
  camera.updateProjectionMatrix()
  return camera
}

describe('the ground plane, through a real projection', () => {
  it('lands the centre of the viewport on the point the camera is looking at', () => {
    const aim: PlanPoint = [3, -2]
    const camera = cameraOn(planToScene(aim, 0, FIT))
    const point = groundPlanPoint(pointerRay(camera, ndcOf(400, 300, { left: 0, top: 0, width: 800, height: 600 })), FIT)
    expect(point).not.toBeNull()
    expect((point as PlanPoint)[0]).toBeCloseTo(aim[0], 6)
    expect((point as PlanPoint)[1]).toBeCloseTo(aim[1], 6)
  })

  it('is null when the ray never reaches the plan', () => {
    // Under the plan, looking further down. A real state: the orbit can be taken
    // below the horizon, and the pointer is then over no cell at all.
    const camera = new PerspectiveCamera(CAMERA_FOV, 1.5, CAMERA_NEAR, CAMERA_FAR)
    camera.position.set(0, -1, 0)
    camera.lookAt(0, -2, 0)
    camera.updateMatrixWorld()
    camera.updateProjectionMatrix()
    expect(groundPlanPoint(pointerRay(camera, { x: 0, y: 0 }), FIT)).toBeNull()
  })
})

describe('picking the surface under the pointer', () => {
  const heightOf = (): number => FLOOR_MM

  it('finds bare ground as bare ground', () => {
    const scene = sceneOf(CATALOG, [])
    const camera = cameraOn(planToScene([0, 0], 0, FIT))
    const pick = pickSurface(scene, pointerRay(camera, { x: 0, y: 0 }), FIT, heightOf)
    expect(pick?.piece).toBeUndefined()
    expect(pick?.elevationMm).toBe(0)
    expect(pick?.point[0]).toBeCloseTo(0, 6)
  })

  it('finds a flat tile the pointer is over', () => {
    const scene = sceneOf(CATALOG, [{ tile: FIXTURE_IDS.floor2, x: 0, z: 0 }])
    const floor = scene.pieces[0]
    expect(floor).toBeDefined()
    const centre = boxCentre((floor as NonNullable<typeof floor>).box)
    const camera = cameraOn(planToScene([centre.x, centre.z], FLOOR_MM, FIT))
    const pick = pickSurface(scene, pointerRay(camera, { x: 0, y: 0 }), FIT, heightOf)
    expect(pick?.piece?.id).toBe((floor as NonNullable<typeof floor>).id)
    expect(pick?.elevationMm).toBe(FLOOR_MM)
  })

  /**
   * The measurement that justifies the whole of `pickSurface`, as a test.
   *
   * A 2½-inch wall, aimed at the top of it from `Stage`'s own camera. A
   * ground-only pick resolves 4.83 units away — and a floor tile is put exactly
   * there, so the ground answer is not merely wrong but *confidently* wrong: it
   * names a real piece, and erasing would take the floor the user is not
   * pointing at.
   */
  it('takes the wall the pointer is on, not the floor five units behind it', () => {
    const withWall = sceneOf(CATALOG, [{ tile: FIXTURE_IDS.wall2, x: 0, z: 0 }])
    const wall = withWall.pieces[0]
    expect(wall).toBeDefined()
    const wallCentre = boxCentre((wall as NonNullable<typeof wall>).box)
    const aim: PlanPoint = [wallCentre.x, wallCentre.z]

    const camera = cameraOn(planToScene(aim, WALL_MM, FIT))
    const ray = pointerRay(camera, { x: 0, y: 0 })

    // Where a single ground plane would send this press.
    const ground = groundPlanPoint(ray, FIT)
    expect(ground).not.toBeNull()
    const stray = ground as PlanPoint
    const travelled = Math.hypot(stray[0] - aim[0], stray[1] - aim[1])
    expect(travelled).toBeCloseTo(groundParallaxUnits(WALL_MM), 4)
    expect(travelled).toBeGreaterThan(4.8)

    // A 1 × 1 floor centred on exactly that stray point, so the wrong answer is
    // a real piece rather than an absence.
    const scene = sceneOf(CATALOG, [
      { tile: FIXTURE_IDS.wall2, x: 0, z: 0 },
      { tile: FIXTURE_IDS.floor1, x: stray[0] - 0.5, z: stray[1] - 0.5 },
    ])
    const heights = (piece: ScenePiece): number => (bandOf(piece) === 'edge' ? WALL_MM : FLOOR_MM)

    // The ground answer: the floor. Confidently, wrongly.
    const under = pieceAt(scene, stray)
    expect(under).toBeDefined()
    expect(bandOf(under as ScenePiece)).toBe('area')

    // The surface answer: the wall, at its own height.
    const pick = pickSurface(scene, pointerRay(cameraOn(planToScene(aim, WALL_MM, FIT)), { x: 0, y: 0 }), FIT, heights)
    expect(pick?.piece).toBeDefined()
    expect(bandOf(pick?.piece as ScenePiece)).toBe('edge')
    expect(pick?.elevationMm).toBe(WALL_MM)
    expect(pick?.point[0]).toBeCloseTo(aim[0], 5)
    expect(pick?.point[1]).toBeCloseTo(aim[1], 5)
  })

  it('does not credit a plane to a piece that never reaches it', () => {
    // The one-line bug this function could have had: intersect the wall's plane,
    // find *something* at that point, and return it. Here the pointer is over
    // the floor only, and the wall's plane crosses the floor's cell — so a pick
    // that skipped the height check would report the floor at 63.5 mm.
    const scene = sceneOf(CATALOG, [
      { tile: FIXTURE_IDS.wall2, x: 10, z: 10 },
      { tile: FIXTURE_IDS.floor2, x: 0, z: 0 },
    ])
    const heights = (piece: ScenePiece): number => (bandOf(piece) === 'edge' ? WALL_MM : FLOOR_MM)
    const floor = scene.pieces.find((piece) => bandOf(piece) === 'area')
    expect(floor).toBeDefined()
    const centre = boxCentre((floor as NonNullable<typeof floor>).box)
    const pick = pickSurface(
      scene,
      pointerRay(cameraOn(planToScene([centre.x, centre.z], FLOOR_MM, FIT)), { x: 0, y: 0 }),
      FIT,
      heights,
    )
    expect(pick?.elevationMm).toBe(FLOOR_MM)
    expect(pick?.piece).toBeDefined()
    expect(bandOf(pick?.piece as ScenePiece)).toBe('area')
  })

  it('is null when the ray misses the plan, whatever is on it', () => {
    const scene = sceneOf(CATALOG, [{ tile: FIXTURE_IDS.floor2, x: 0, z: 0 }])
    const camera = new PerspectiveCamera(CAMERA_FOV, 1.5, CAMERA_NEAR, CAMERA_FAR)
    camera.position.set(0, 2, 0)
    camera.lookAt(0, 3, 0)
    camera.updateMatrixWorld()
    camera.updateProjectionMatrix()
    expect(pickSurface(scene, pointerRay(camera, { x: 0, y: 0 }), FIT, heightOf)).toBeNull()
  })

  it('works on a hand-built ray, so the camera is not load-bearing', () => {
    // Straight down through plan (2, 3): the simplest case there is, and the one
    // that would still pass if the projection were wrong. Kept beside the camera
    // tests rather than instead of them.
    const scene = sceneOf(CATALOG, [])
    const above = planToScene([2, 3], 100, FIT)
    const ray = new Ray(above, new Vector3(0, -1, 0))
    const pick = pickSurface(scene, ray, FIT, heightOf)
    expect(pick?.point[0]).toBeCloseTo(2, 12)
    expect(pick?.point[1]).toBeCloseTo(3, 12)
  })
})

/* -------------------------------------------------------------- a mesh’s height */

describe('a mesh’s height', () => {
  it('reads the store’s z-extent, because the bytes are Z-up', () => {
    // A 4 × 1 wall as the store holds it: 101.6 mm on x, 12.7 mm on y (the wall
    // thickness) and 63.5 mm on z (the height). Taking the raw `y` extent would
    // call this tile 12.7 mm tall; taking `x` would call it 101.6.
    const bounds = new Box3(new Vector3(0, 0, 0), new Vector3(101.6, 12.7, 63.5))
    expect(meshHeightMm(bounds)).toBeCloseTo(63.5, 9)
  })

  it('is unaffected by where the mesh sits on the plan', () => {
    const bounds = new Box3(new Vector3(-50, -6, 12), new Vector3(51.6, 6.7, 75.5))
    expect(meshHeightMm(bounds)).toBeCloseTo(63.5, 9)
  })
})

/* ------------------------------------------------------------------- helpers */

/**
 * A fixture piece's band. Row **A4a** moved `band` off the piece onto the part.
 *
 * A helper here rather than a widened accessor in the canvas, because the
 * question this file asks — *"is the thing at this point a wall or a floor?"* —
 * only has one answer for a **single-part** piece, and every placement in this
 * suite is one file in one slot. A five-part template has a floor in `area` and
 * two walls in `edge`, which is exactly why contract **C-h** deleted the field
 * from the piece: a `piece.band` returning the first part's would have compiled
 * everywhere and described a fifth of the placement. Elevation-aware picking
 * across a real template is row **A7**'s.
 */
function bandOf(piece: ScenePiece): PlanBand {
  if (piece.kind === 'generated') return piece.band
  const [first] = piece.parts
  // Non-empty by `PlanPiece.parts`'s own invariant.
  return (first as NonNullable<typeof first>).band
}
