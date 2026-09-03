/**
 * One placement → one instance matrix. The whole of the "same placement model as
 * the plan view" claim lives in this file.
 *
 * ## It consumes the plan view's own answer, it does not restate it
 *
 * The input is a `PlanGeometry` from `@/builder/canvas` — the object row **W6**
 * produced, carrying the resolved footprint, the *drawn* angle
 * (`rotation + shape.angle`, which differs from the stored rotation on the 121
 * `diag` tiles), the axis-aligned box anchored at the placement's corner, and the
 * convex parts. So there is no second geometry here and no second switch over
 * `Footprint`: an annular sector's box comes from `sector.ts`'s
 * `arcSectorExtent`, a `diag`'s intrinsic 45° is already folded in, and `tri`'s
 * canonical orientation is the one the plan drew. If the plan view and this view
 * ever disagree about where a piece is, it is a bug in one function
 * ({@link tileMatrix}) rather than a divergence between two models.
 *
 * ## Three coordinate facts, in the order they bite
 *
 *  1. **The store's bytes are Z-up.** `src/three/StlModel.tsx` measured it and
 *     rotates −90° about X; G1's GLBs carry the STL's axes unchanged, so the
 *     same rotation applies. It is a *proper* rotation (determinant +1), not the
 *     axis swap `(x, y, z) → (x, z, y)` that first suggests itself — that one is
 *     a reflection, and it would invert every triangle's winding.
 *  2. **The plan's `z` and three's `z` run the same way.** Plan-view `z` grows
 *     down the drawing (it is the SVG `y`), and this module maps it straight to
 *     three's `+z`, so the 3D view seen from above is the plan view. That leaves
 *     the tile's *own* orientation determined up to a 180° yaw, because nothing
 *     in the data links the STL's second axis to the plan's depth direction —
 *     the footprint comes from tags, not from the mesh. So the tile takes a
 *     **canonical orientation**, exactly as `geometry.ts` does for `tri` and
 *     `diag`, and the tile's own `rotStep` reaches the others.
 *  3. **Yaw is negative.** The plan rotates `(dx, dz)` to
 *     `(dx cos θ − dz sin θ, dx sin θ + dz cos θ)`. three's Y-rotation by `φ`
 *     sends `(x, z)` to `(x cos φ + z sin φ, −x sin φ + z cos φ)`, which is the
 *     plan's rotation at `φ = −θ`. Getting this sign wrong mirrors every
 *     non-square room about its own diagonal and is invisible on a 1×1 tile,
 *     which is why `place.test.ts` asserts it on a 4×1 wall at 90°.
 *
 * ## The mesh is centred on the footprint box, never scaled to it
 *
 * The footprint is derived from *tags* and the mesh is the mesh; where they
 * disagree, `src/catalog/schema.ts` records disagreements up to 1.513 units on
 * the 27 curved-interface floors alone. Scaling the mesh to the tagged box would
 * hide that by deforming real geometry, so the mesh keeps its measured
 * millimetres and is *centred* on the plan's box, with its lowest point resting
 * on `y = 0`. {@link footprintDelta} is how a caller finds out by how much the
 * two disagree instead of having the answer hidden from it.
 *
 * ## `y = 0` is the plan, not the floor of the assembly — row R3
 *
 * {@link tileMatrix} still rests every mesh it is handed on `y = 0`, unchanged,
 * and that is what makes it usable for a **base** as well as a tile. What row R3
 * added is one composable step on top of it, {@link liftMatrix}, for the case the
 * corpus makes the majority of: 1,878 of 3,822 items resolve under openlock to a
 * topper *plus* an auto-inserted base, the base is a median **6.00 mm** tall and
 * the median floor tile is 4.50 mm, so a topper left on `y = 0` would be entirely
 * inside the base it is meant to be standing on. The base takes `y = 0`; the
 * topper is lifted by the base's own measured height. Nothing about the
 * placement's stored shape changes — `bases.ts` says why the elevation is a
 * derivation rather than a field.
 */
import { Box3, Matrix4, Vector3 } from 'three'

import type { PlanGeometry } from '@/builder/canvas'
import { boxCentre } from '@/builder/canvas'
import { GRID_UNIT_MM } from '@/catalog'

/**
 * The archive's Z-up into three.js's Y-up: −90° about X.
 *
 * The same constant as `src/three/StlModel.tsx`'s `Z_UP_TO_Y_UP`, which is the
 * module that measured it. **A duplicated constant, and a reported seam rather
 * than an oversight**: that value is a private `[number, number, number]` inside
 * a component in `src/three/**`, which row **G3** owns and this row must not
 * edit. Exporting it from there is a one-line change for G3 — the same shape of
 * note `tools/lod/catalog.ts` leaves about `STL_GATE_BYTES`.
 */
export const Z_UP_TO_Y_UP_RADIANS = -Math.PI / 2

/** A tile's own bounds, in millimetres, in the store's Z-up axes. */
export type MeshBounds = Box3

/**
 * The mesh's axis-aligned bounds after {@link Z_UP_TO_Y_UP_RADIANS}, in mm.
 *
 * Computed by hand rather than by `Box3.applyMatrix4` because the rotation is
 * exact on the quarter turn and `Math.cos(-Math.PI / 2)` is 6.1e-17 — the same
 * refusal to tolerate trigonometric residue that `sector.ts` and
 * `geometry.ts` make, and for the same reason: a 6.1e-17 offset is what makes
 * two tiles look flush and compare unequal.
 *
 * `(x, y, z) → (x, z, −y)`.
 */
export function uprightBounds(bounds: MeshBounds): Box3 {
  return new Box3(
    new Vector3(bounds.min.x, bounds.min.z, -bounds.max.y),
    new Vector3(bounds.max.x, bounds.max.z, -bounds.min.y),
  )
}

/**
 * The instance matrix for one placed tile, in millimetres, three.js Y-up.
 *
 * `M = T(target) · R_y(−θ) · T(−localCentre) · R_x(−90°)`, read right to left:
 * stand the mesh up, bring its footprint centre to the origin with its base on
 * `y = 0`, turn it by the plan's drawn angle, and put it where the plan put it.
 *
 * `target` is written into the caller's matrix when one is supplied, so a room of
 * placements costs no allocations per frame.
 */
export function tileMatrix(bounds: MeshBounds, geometry: PlanGeometry, target = new Matrix4()): Matrix4 {
  const upright = uprightBounds(bounds)
  const centre = boxCentre(geometry.box)

  // Radians of yaw. Negative: see the module note's third coordinate fact.
  const yaw = (-geometry.angle * Math.PI) / 180

  const stand = new Matrix4().makeRotationX(Z_UP_TO_Y_UP_RADIANS)
  const toOrigin = new Matrix4().makeTranslation(
    -(upright.min.x + upright.max.x) / 2,
    -upright.min.y,
    -(upright.min.z + upright.max.z) / 2,
  )
  const turn = new Matrix4().makeRotationY(yaw)
  const toPlan = new Matrix4().makeTranslation(centre.x * GRID_UNIT_MM, 0, centre.z * GRID_UNIT_MM)

  return target.copy(toPlan).multiply(turn).multiply(toOrigin).multiply(stand)
}

/**
 * Raise an instance matrix by `elevationMm`. `M' = T(0, e, 0) · M`.
 *
 * **Pre**-multiplied, which is the whole content of the function: the elevation
 * is a translation in the *world* frame, applied after everything
 * {@link tileMatrix} did, so it does not turn with the tile's yaw and does not
 * scale with anything. Post-multiplying would put the offset in the mesh's own
 * pre-rotation frame — where `+y` is the STL's `−z` — and a 90° placement would
 * send the tile sideways instead of upwards.
 *
 * Mutates and returns its argument, because every caller has just built the
 * matrix and a room of instances must not allocate a second one per frame. `0`
 * is the identity and is the common case: 1,497 of 3,822 items are
 * `self-sufficient` under openlock and stand on nothing.
 *
 * This is row **R3**'s answer to row R2's hand-off. R2 computed a stacking
 * elevation and declined to apply it, because *"an elevated ghost would sit where
 * the tile will not land"* — true while the elevation came from a piece the user
 * had placed, since `Placement` has no `y` to put it in. The auto-inserted base
 * is different in kind: it is derived from `(design, lock)` rather than chosen,
 * so the number is the same for the ghost, the instance, the pick and the plate,
 * and `bases.ts` computes it in one place for all four.
 */
export function liftMatrix(matrix: Matrix4, elevationMm: number): Matrix4 {
  if (elevationMm === 0) return matrix
  return matrix.premultiply(new Matrix4().makeTranslation(0, elevationMm, 0))
}

/**
 * The mesh's own footprint, in grid units, before any placement rotation.
 *
 * The `x`/`z` extent of {@link uprightBounds} over the 25.4 mm grid unit. What a
 * caller compares against `PlanShape.extent`.
 */
export function meshFootprintUnits(bounds: MeshBounds): { readonly w: number; readonly d: number } {
  const upright = uprightBounds(bounds)
  return {
    w: (upright.max.x - upright.min.x) / GRID_UNIT_MM,
    d: (upright.max.z - upright.min.z) / GRID_UNIT_MM,
  }
}

/**
 * How far the real mesh disagrees with the tagged footprint, in grid units.
 *
 * Reported rather than corrected. The corpus's disagreements are known and
 * documented — `src/catalog/schema.ts` names 27 curved-interface floors whose
 * tagged width over-states the mesh by up to 1.513 units, and the `AxG`/`BAxG`/
 * `QxG` trio whose tagged widths disagree in opposite directions — and this row
 * is the first one that can *see* them, because it is the first with both
 * numbers in memory at once.
 *
 * Symmetric in the two axes: a 90° placement swaps them, and the disagreement is
 * a property of the tile rather than of how it was turned.
 */
export function footprintDelta(
  bounds: MeshBounds,
  extent: { readonly w: number; readonly d: number },
): { readonly w: number; readonly d: number; readonly worst: number } {
  const mesh = meshFootprintUnits(bounds)
  const w = mesh.w - extent.w
  const d = mesh.d - extent.d
  return { w, d, worst: Math.max(Math.abs(w), Math.abs(d)) }
}

/* ------------------------------------------------------------ the whole room */

/**
 * The normalisation that lets the room reuse `src/three/Stage.tsx` unchanged.
 *
 * `Stage` is tuned for **one model at a unit bounding radius** — camera distance
 * 3.0 at a 32° field of view, `near` 0.05, `far` 40, and `OrbitControls` clamped
 * to `1.5×`–`9×` `VIEW_RADIUS`. A room in millimetres is 25 to 2,000 units
 * across, so it would sit outside the far plane and outside the orbit clamp at
 * both ends. Rather than build a second renderer — row **G3** owns the canvas and
 * this row must not fork it — the room is scaled into the frame `Stage` already
 * expects, which is the identical argument `src/three/geometry.ts` makes for
 * normalising a single model.
 *
 * The radius is the bounding box's **half-diagonal**, not a vertex bounding
 * sphere. Cheap (no vertex pass over a room of instances), and conservative in
 * the safe direction: it can only frame the room with room to spare, never clip
 * it.
 */
export interface RoomFit {
  /** Millimetres → normalised units. */
  readonly scale: number
  /** The room's centre, in millimetres, before scaling. */
  readonly centre: Vector3
  /** Half-diagonal of the room's bounding box, in millimetres. */
  readonly radiusMm: number
  /** Extent in millimetres, for the readout. */
  readonly sizeMm: Vector3
}

/**
 * Fit a room's bounds to `viewRadius`.
 *
 * An empty or degenerate room — one zero-height tile, every vertex coincident —
 * gets `scale: 1` rather than a division by zero. `src/three/geometry.ts` guards
 * the same case for the same reason: a NaN bounding sphere disables culling and
 * raycasting with no warning at all.
 */
export function fitRoom(bounds: Box3, viewRadius: number): RoomFit {
  if (bounds.isEmpty()) {
    return { scale: 1, centre: new Vector3(), radiusMm: 0, sizeMm: new Vector3() }
  }
  const sizeMm = bounds.getSize(new Vector3())
  const centre = bounds.getCenter(new Vector3())
  const radiusMm = sizeMm.length() / 2
  return { scale: radiusMm > 0 ? viewRadius / radiusMm : 1, centre, radiusMm, sizeMm }
}

/** The union of every instance's world bounds. */
export function roomBounds(boxes: readonly Box3[]): Box3 {
  const union = new Box3()
  for (const box of boxes) union.union(box)
  return union
}

/** A tile's world bounds once placed: its own box carried through its instance matrix. */
export function placedBounds(bounds: MeshBounds, matrix: Matrix4): Box3 {
  return bounds.clone().applyMatrix4(matrix)
}
