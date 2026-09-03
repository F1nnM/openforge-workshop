/**
 * Where the pointer is, in grid units — the arithmetic that turns the 3D view
 * into a work surface, with no React and no renderer in it.
 *
 * `design/forge3d.js`'s `createBuilder` is the owner's reference and this module
 * is its middle: a ground plane raycast, a snapped point, and a 5 px threshold
 * separating an orbit-drag from a click. Everything downstream of the point —
 * what may be placed there, what is already there, whether it collides — is
 * `@/builder/canvas`'s and is *called*, never restated. Placement is still a 2D
 * lattice with an elevation, so `geometry.ts`, `overlap.ts`, `sector.ts`,
 * `ghost.ts`, `move.ts` and `scene.ts` are all still exactly correct.
 *
 * ## One departure from the mockup, and it is the one that matters
 *
 * The mockup picks a tile by raycasting **the placed meshes** and walking up to
 * the hit's owning group. This module raycasts a **plane** and resolves the hit
 * with {@link ScenePiece}-level containment — `pieceAt` — because that is the
 * same geometry the collision sweep uses. Mesh picking and `subjectsConflict`
 * would be two different opinions about where a piece is, and they disagree
 * exactly where W6's annular sectors are outward bounds: on a curve, the convex
 * parts cover ground the triangles do not. A user who erased by mesh and
 * collided by parts would find pieces that refuse to be clicked and pieces that
 * block a placement from a cell that looks empty.
 *
 * ## Which plane, though — and this is where a single ground plane is wrong
 *
 * A ground-plane-only pick is exact for the ground and wrong for anything
 * standing on it, because a perspective camera above the plan projects the *top*
 * of a piece onto ground well beyond the piece's own footprint. The size of that
 * error is not a rounding matter. `src/three/frame.ts` starts the camera at
 * `CAMERA_POSITION`, whose elevation above the horizon is
 * {@link CAMERA_ELEVATION_RADIANS} — **27.38°** — so a surface `h` millimetres
 * up projects {@link groundParallaxUnits} = `h / (tan 27.38° · 25.4)` grid units
 * beyond where it stands:
 *
 * | surface | height | ground error at the start camera |
 * | --- | ---: | ---: |
 * | a floor tile's top (`4.5 mm`, the median tile) | 4.50 mm | **0.34 units** |
 * | a wall's top (`63.5 mm`, 2½ inches) | 63.50 mm | **4.83 units** |
 *
 * 4.83 units is nineteen fine snap steps. Clicking the top of a wall to erase it
 * would erase whatever is five units behind it, and nothing about the drawing
 * would explain why.
 *
 * So {@link pickSurface} intersects the ray with the plane of **each distinct
 * occupied elevation**, highest first, and accepts the first one whose plan point
 * lands inside a piece that actually reaches that height — falling back to the
 * ground. Highest-first is also nearest-first along the ray, and provably so: a
 * ray that reaches `y = 0` from a camera above it descends, so it crosses higher
 * planes earlier. The result is the surface the user is looking at, resolved by
 * `pieceAt` and therefore by the same parts the conflict sweep tests.
 *
 * This is not mesh picking and it does not need a mesh. It needs each piece's
 * *height*, which the caller supplies — from the loaded geometry's bounds when
 * there is one, and from the marker plate's own height when there is not.
 *
 * ## The frame is fixed, and that is a work-surface decision
 *
 * `place.ts`'s `fitRoom` normalises a room's own bounds into `Stage`'s unit
 * frame, which is right for *looking* at a room and wrong for *building* one:
 * the scale changes every time the bounds change, so placing a tile at the edge
 * would rescale and recentre the whole plan under the cursor mid-gesture, and
 * the tile the user just placed would not be where they aimed. So the work
 * surface uses {@link surfaceFit} instead — a **constant** scale derived from a
 * fixed work area — and reaches the rest of the plan with the orbit's own pan and
 * zoom. `Stage`'s `enablePan` exists for precisely this and its docblock says so.
 *
 * `fitRoom` is untouched and still reports the room's extent through
 * `Room3D.fit`, which is what the readout quotes.
 */
import type { Camera, Ray } from 'three'
import { Plane, Raycaster, Vector2, Vector3 } from 'three'

import type { PlanPoint, PlanScene, ScenePiece } from '@/builder/canvas'
import { pieceAt } from '@/builder/canvas'
import { GRID_UNIT_MM } from '@/catalog'
import { CAMERA_POSITION } from '@/three/frame'

import { uprightBounds } from './place'
import type { MeshBounds } from './place'

/**
 * The work area, in grid units, whose half-diagonal is normalised to
 * `VIEW_RADIUS`.
 *
 * Twelve, and the number is a compromise between two measurable things rather
 * than a taste. `Stage`'s camera sits at `CAMERA_DISTANCE` = 3.0 with a 32°
 * vertical field of view, so the visible span at the orbit target is
 * `2 · 3 · tan 16°` = **1.72** scene units; a 1 × 1 tile is `25.4 / radiusMm`
 * scene units across. At 12 units the work area's half-diagonal is 215.53 mm, so
 * a 1 × 1 tile is 0.118 units — **6.9% of the visible height**, or 41 px in a
 * 600 px stage. At the mockup's own 24-unit grid it is 3.4%, i.e. 20 px, which
 * is too small to aim at; at 6 units a four-by-four room is already outside the
 * frame on load.
 *
 * It bounds nothing. {@link SURFACE_GRID_UNITS} of lattice are drawn and the
 * orbit pans and zooms over all of it, so this decides the *initial* framing and
 * the constant scale, not how large a room may be.
 */
export const SURFACE_AREA_UNITS = 12

/**
 * How much lattice is drawn, in grid units square: **96**, eight feet.
 *
 * Eight times the work area, so a user who zooms out to the orbit's own
 * `ORBIT_MAX_DISTANCE` (9 × `VIEW_RADIUS`, three times the start distance) still
 * has grid under the plan rather than a void. 97 lines each way is 388 vertices
 * and one draw call; the cost of choosing this generously is nil.
 */
export const SURFACE_GRID_UNITS = 96

/**
 * How far below the plan the grid is drawn, in millimetres.
 *
 * A fifth of a millimetre, and it exists because a floor tile's underside rests
 * exactly on `y = 0` — `place.ts`'s `tileMatrix` puts it there — so a grid line
 * in the same plane z-fights with it and flickers per fragment as the camera
 * moves. The mockup drops its ground by `0.02` of a 1-unit-per-tile world, which
 * is the same fraction of a tile; this is the same decision in millimetres.
 *
 * Small enough that the line still reads as being *on* the floor at every zoom
 * the orbit allows: at `ORBIT_MIN_DISTANCE` one scene unit is about 1,000 px, so
 * 0.2 mm is 0.0009 scene units and under a fifth of a pixel.
 */
export const SURFACE_GRID_DROP_MM = 0.2

/**
 * Pointer travel, in CSS pixels, that turns a click into an orbit.
 *
 * **Five, the mockup's own threshold**, kept rather than re-derived: it is the
 * number the owner's reference was built and felt with. The gesture it separates
 * is the same one — `OrbitControls` is rotating the camera throughout, so this
 * decides only whether the *release* also edits the plan.
 *
 * The consequence worth stating: there is no drag-paint in 3D. `PlanCanvas`
 * painted while the primary button was down; here that same drag is the orbit, so
 * a press-and-release places one tile. Row **R4** deleted the renderer that
 * painted, so this is no longer a difference between two surfaces — it is simply
 * how placing works.
 */
export const DRAG_THRESHOLD_PX = 5

/**
 * The start camera's elevation above the horizon, in radians — **0.4779**, 27.38°.
 *
 * Read off `CAMERA_POSITION` rather than written down, so it follows a change to
 * the shared frame instead of going stale. It is the whole input to
 * {@link groundParallaxUnits}, which is why a ground-only pick is not enough.
 */
export const CAMERA_ELEVATION_RADIANS = Math.atan2(
  CAMERA_POSITION[1],
  Math.hypot(CAMERA_POSITION[0], CAMERA_POSITION[2]),
)

/**
 * How far a surface `heightMm` above the plan projects beyond its own footprint,
 * in grid units, at a given camera elevation.
 *
 * The error a single ground plane would make. Defaults to
 * {@link CAMERA_ELEVATION_RADIANS} because that is the elevation the view opens
 * at; the user can orbit lower, which makes it worse, or straight down, which
 * makes it zero.
 */
export function groundParallaxUnits(heightMm: number, elevation = CAMERA_ELEVATION_RADIANS): number {
  const slope = Math.tan(elevation)
  if (slope <= 0) return Infinity
  return heightMm / slope / GRID_UNIT_MM
}

/* ------------------------------------------------------------------ the frame */

/**
 * Millimetres of plan → the normalised units `Stage` is tuned for, constantly.
 *
 * Four fields and no centre, which is the difference from `RoomFit`: the work
 * surface is anchored on the plan's own origin, so `plan (0, 0)` is scene
 * `(0, 0, 0)` for the life of the view and the conversion in both directions is
 * a single multiply. That is what makes {@link sceneToPlan} exact and what stops
 * the plan moving under a gesture.
 */
export interface SurfaceFit {
  /** Millimetres → normalised units. Constant for the life of the view. */
  readonly scale: number
  /** Half-diagonal of the work area, in millimetres. */
  readonly radiusMm: number
  /** The work area's side, in grid units. */
  readonly areaUnits: number
}

/** The fit for a work area of `areaUnits` square, normalised to `viewRadius`. */
export function surfaceFit(viewRadius: number, areaUnits: number = SURFACE_AREA_UNITS): SurfaceFit {
  const sideMm = areaUnits * GRID_UNIT_MM
  const radiusMm = (sideMm * Math.SQRT2) / 2
  return { scale: viewRadius / radiusMm, radiusMm, areaUnits }
}

/** A plan point and an elevation, as a scene-space position. */
export function planToScene(point: PlanPoint, elevationMm: number, fit: SurfaceFit, target = new Vector3()): Vector3 {
  return target.set(point[0] * GRID_UNIT_MM * fit.scale, elevationMm * fit.scale, point[1] * GRID_UNIT_MM * fit.scale)
}

/** Scene-space `x`/`z` back to a plan point, in grid units. The exact inverse. */
export function sceneToPlan(x: number, z: number, fit: SurfaceFit): PlanPoint {
  const perUnit = GRID_UNIT_MM * fit.scale
  return [x / perUnit, z / perUnit]
}

/* ----------------------------------------------------------------- the pointer */

/** A pointer position in normalised device coordinates, `[-1, 1]` both axes. */
export interface Ndc {
  readonly x: number
  readonly y: number
}

/**
 * A pointer event's client position, as NDC within an element's rect.
 *
 * Takes the rect rather than the element so it is callable from a test, and
 * returns the centre of the element for a zero-sized rect rather than a NaN —
 * jsdom reports every element as 0 × 0, and a NaN here propagates into the
 * projection matrix and disables the raycaster silently.
 */
export function ndcOf(
  clientX: number,
  clientY: number,
  rect: { readonly left: number; readonly top: number; readonly width: number; readonly height: number },
): Ndc {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 }
  return {
    x: ((clientX - rect.left) / rect.width) * 2 - 1,
    y: -((clientY - rect.top) / rect.height) * 2 + 1,
  }
}

/** Whether a press and a release are close enough together to be a click. */
export function isClickGesture(
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
  threshold = DRAG_THRESHOLD_PX,
): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) <= threshold
}

/** Reused by {@link pointerRay}; a pointer move must not allocate. */
const NDC_SCRATCH = new Vector2()

/**
 * The camera ray through a pointer position.
 *
 * A `Raycaster` may be passed in so a pointer move allocates nothing; the
 * returned `Ray` is that raycaster's own and is overwritten by the next call.
 */
export function pointerRay(camera: Camera, ndc: Ndc, caster = new Raycaster()): Ray {
  caster.setFromCamera(NDC_SCRATCH.set(ndc.x, ndc.y), camera)
  return caster.ray
}

/* -------------------------------------------------------------------- the pick */

/** The plan, as a plane. `y = 0`, normal up. */
const GROUND = new Plane(new Vector3(0, 1, 0), 0)

/** What the pointer is over. */
export interface SurfacePick {
  /** The plan point, in grid units, un-snapped. */
  readonly point: PlanPoint
  /** The piece whose top surface was hit, or `undefined` for bare ground. */
  readonly piece: ScenePiece | undefined
  /** How high that surface is above the plan, in millimetres. `0` for the ground. */
  readonly elevationMm: number
}

/** Tolerance for "this piece reaches that elevation", in millimetres. */
const SAME_HEIGHT_MM = 1e-6

/**
 * The plan point on the ground plane, or `null` when the ray never reaches it.
 *
 * `null` is a real state and not a defensive guard: orbiting to the horizon
 * makes the ray parallel to the plan, and orbiting below it makes the ray point
 * away. Both leave the pointer over no cell at all, which is what the ghost
 * hides on.
 */
export function groundPlanPoint(ray: Ray, fit: SurfaceFit, target = new Vector3()): PlanPoint | null {
  const hit = ray.intersectPlane(GROUND, target)
  if (hit === null) return null
  return sceneToPlan(hit.x, hit.z, fit)
}

/**
 * The surface under the pointer: highest occupied plane first, ground last.
 *
 * `heightOf` gives a piece's own height in millimetres above the plan. It is the
 * caller's because it is the one thing here that depends on a mesh having
 * arrived — {@link meshHeightMm} is the answer when one has — and because the
 * marker a mesh-less piece draws has a height of its own that must be pickable
 * too.
 *
 * Returns `null` only when the ray misses the ground plane entirely.
 */
export function pickSurface(
  scene: PlanScene,
  ray: Ray,
  fit: SurfaceFit,
  heightOf: (piece: ScenePiece) => number,
): SurfacePick | null {
  const scratch = new Vector3()
  const ground = ray.intersectPlane(GROUND, scratch)
  if (ground === null) return null
  const groundPoint = sceneToPlan(ground.x, ground.z, fit)

  // Descending, deduped. A room of forty pieces has a handful of distinct
  // heights — a floor thickness, a wall height, a column height — so this loop
  // is over three or four planes and not over forty pieces.
  const heights = elevations(scene, heightOf)
  const plane = new Plane(new Vector3(0, 1, 0), 0)
  for (const heightMm of heights) {
    plane.constant = -heightMm * fit.scale
    const hit = ray.intersectPlane(plane, scratch)
    if (hit === null) continue
    const point = sceneToPlan(hit.x, hit.z, fit)
    const piece = pieceAt(scene, point)
    // The piece found at that point must be one that actually reaches this
    // height. Without the check, the top plane of a wall would "hit" a floor
    // tile lying six units behind it — which is the parallax bug this whole
    // function exists to remove, reintroduced one line lower down.
    if (piece !== undefined && Math.abs(heightOf(piece) - heightMm) <= SAME_HEIGHT_MM) {
      return { point, piece, elevationMm: heightMm }
    }
  }

  return { point: groundPoint, piece: pieceAt(scene, groundPoint), elevationMm: 0 }
}

/** Distinct positive piece heights in a scene, highest first. */
function elevations(scene: PlanScene, heightOf: (piece: ScenePiece) => number): readonly number[] {
  const seen = new Set<number>()
  for (const piece of scene.pieces) seen.add(heightOf(piece))
  for (const piece of scene.generated) seen.add(heightOf(piece))
  return [...seen].filter((height) => height > 0).sort((a, b) => b - a)
}

/**
 * A loaded mesh's height above the plan, in millimetres.
 *
 * `uprightBounds` and not the raw bounds: the store's bytes are Z-up and
 * `tileMatrix` stands them up before placing them, so the height is the extent
 * of the *upright* box's `y` — which is the store's `z`. Taking the raw `y`
 * extent would report a 4 × 1 floor strip as 101.6 mm tall.
 */
export function meshHeightMm(bounds: MeshBounds): number {
  const upright = uprightBounds(bounds)
  return upright.max.y - upright.min.y
}
