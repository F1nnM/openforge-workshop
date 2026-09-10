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
 * ## `y = 0` is the plan, not the floor of the assembly
 *
 * {@link tileMatrix} rests every mesh it is handed on `y = 0`, and that is what
 * makes it usable for a **base** as well as a tile: a base is one part of a
 * template like any other, and it is the part whose elevation is zero. One
 * composable step sits on top of it, {@link liftMatrix}, for every part whose
 * elevation is not — a floor standing on that base, and the walls standing on the
 * floor. Without it a template's parts would all rest on the plan and the room
 * would show one object where the bill lists three.
 *
 * **The elevation is a rule's answer, not a measurement, and it is not this
 * module's to derive.** It arrives as `SlotLayout.elevationMm` from row A4a's
 * per-part projection, in millimetres, normalised; `geometry.ts` measures why a
 * height read off the mesh would be wrong. Nothing about the placement's stored
 * shape carries it — a `TemplateInstance` has an `x`, a `z` and one rotation, and
 * the lift follows from the recipe.
 */
import { Box3, Matrix4, Quaternion, Vector3 } from 'three'

import type { PlanGeometry } from '@/builder/canvas'
import { boxCentre } from '@/builder/canvas'
import type { InsertAnchor, Mount, OpeningMount, Vec3 } from '@/catalog'
import { copiesOf, GRID_UNIT_MM } from '@/catalog'

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
  const centre = boxCentre(geometry.box)

  // Radians of yaw. Negative: see the module note's third coordinate fact.
  const yaw = (-geometry.angle * Math.PI) / 180

  const turn = new Matrix4().makeRotationY(yaw)
  const toPlan = new Matrix4().makeTranslation(centre.x * GRID_UNIT_MM, 0, centre.z * GRID_UNIT_MM)

  return target.copy(toPlan).multiply(turn).multiply(standUpright(bounds))
}

/**
 * `T(−bboxCentre) · R_x(−90°)`: a mesh's own bytes into its **bbox frame**, Y-up.
 *
 * The half of {@link tileMatrix} that is about the mesh rather than about the
 * placement, extracted because {@link accessoryMatrix} needs exactly the same
 * step for the *insert* and the two must not be able to drift apart.
 *
 * What comes out is the frame `src/catalog/schema.ts#Vec3` describes, swapped to
 * Y-up: a mesh point at bbox coordinates `(x, y, z)` — x and y from the bbox
 * centre, z from its floor, Z-up — lands at `(x, z, −y)`, which is
 * {@link zUpToYUp} of it. That identity is the whole reason a `Mount.at` and an
 * `InsertAnchor.at` can be used as points here without any further conversion.
 */
function standUpright(bounds: MeshBounds): Matrix4 {
  const upright = uprightBounds(bounds)
  const toOrigin = new Matrix4().makeTranslation(
    -(upright.min.x + upright.max.x) / 2,
    -upright.min.y,
    -(upright.min.z + upright.max.z) / 2,
  )
  return toOrigin.multiply(new Matrix4().makeRotationX(Z_UP_TO_Y_UP_RADIANS))
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
 * is the identity and is the common case rather than an edge: `base` and `floor`
 * are **80 of the 128 parts** the 40 shipped families declare, and the `base`
 * slot's elevation is zero by construction.
 *
 * This is row **R3**'s answer to row R2's hand-off, on the footing row A4a gave
 * it. R2 computed a stacking elevation and declined to apply it, because *"an
 * elevated ghost would sit where the tile will not land"* — true while the
 * elevation was a *guess* about a piece the user had placed. A slot's elevation
 * is not a guess: it is declared by the recipe and delivered per part as
 * `SlotLayout.elevationMm`, so the instance, the pick and the plate all read one
 * number out of the projection and cannot disagree about it.
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

/* ---------------------------------------------------------- accessories */

/**
 * The host part an accessory hangs off, as much of it as a mount needs.
 *
 * A {@link PlanGeometry} and an elevation, which is exactly what
 * {@link tileMatrix} and {@link liftMatrix} take for the part itself — so the
 * host's frame here and the host's own instance matrix are built from one pair
 * of numbers and cannot disagree about where the wall is.
 */
export interface HostFrame {
  readonly geometry: PlanGeometry
  readonly elevationMm: number
}

/** The insert's own mesh and the anchor measured on it. */
export interface InsertFrame {
  readonly bounds: MeshBounds
  readonly anchor: InsertAnchor
}

/**
 * A bbox vector into three's Y-up: `(x, y, z) → (x, z, −y)`.
 *
 * The same swap {@link uprightBounds} applies to a box and `R_x(−90°)` applies
 * to a mesh, written out for the one-off vectors that arrive as plain triples —
 * a mount's `at`, its `normal`, a socket's `axis`, an anchor's. Exact on the
 * quarter turn, for {@link uprightBounds}' reason: `Math.cos(-Math.PI / 2)` is
 * 6.1e-17, and a normal that is 6.1e-17 off vertical is a torch that leans.
 */
export function zUpToYUp(v: Vec3): Vector3 {
  return new Vector3(v[0], v[2], -v[1])
}

/**
 * The world matrix of **one accessory instance** — one insert, at one mount.
 *
 * `M = hostFrame · T(seat) · R(align) · T(−anchor) · T(−bboxCentre) · R_x(−90°)`,
 * read right to left: stand the insert up in its own bbox frame, bring its
 * anchor point to the origin, turn the anchor's axis to face the way the mount
 * wants, move it to the seat, and carry the lot round with the host.
 *
 * `hostFrame` is {@link tileMatrix} **without** its `standUpright` — because the
 * mount's coordinates are already in the host's bbox frame, so applying the
 * host's own normalisation a second time would offset every torch by the host's
 * bbox centre. It keeps the elevation, which {@link liftMatrix} applies to the
 * host part: an accessory in a wall that stands 6 mm up stands 6 mm up too.
 *
 * ## Orientation comes from `mount.normal`, never from `faceVector(mount.face)`
 *
 * On a curved host `face` is a label in the *unrolled* frame
 * `tools/mounts/arcs.ts` reads a sector in — `-y` and `+y` are the inner and the
 * outer radius rather than two parallel planes — so `faceVector(face)` there is a
 * chord normal. Measured, the same torch sockets read 59.7–65.5° from it on flat
 * hosts and 62–81° on arcs. `Mount.normal` is the re-rolled surface normal and
 * equals `faceVector(face)` wherever the host is flat, so it is right in both
 * cases and the face label is right in one.
 *
 * ## Two ways to pose an insert, and the kind chooses between them
 *
 * **`socket` and `pocket` pose by the anchor's axis**, because a peg's axis *is*
 * its pose: the pin has one direction it can go in, the mouth was measured, and
 * the insert's own body has to lie along it. The axis is aimed at `−mount.axis`
 * — the axis enters the host, so its negation leaves it, and for the measured
 * torch socket that is up the **62–65° lean**: a 5.5 × 3 mm mouth tilting 25°
 * off vertical, up and out. Aiming at the normal instead would bury the torch's
 * tail in the wall. {@link alignToAxis} then chooses the remaining roll so the
 * flame stands as near upright as the lean allows.
 *
 * **`opening`, `hole` and `surface` pose by the insert's bbox extents**, and the
 * anchor's axis is used for nothing but a sign. The reason is a measurement: a
 * `leaf`'s axis is its *thinnest* bbox axis, which is the through-wall direction
 * for a door (28 × 4 × 35.5 mm — thin is the depth) and the **height** for a
 * lintel (`door_lintel.1.stl` is 32.84 × 12.99 × 6.09 mm — thin is the 6.1 mm
 * height). Aiming that axis at the surface normal laid all 131 lintel mounts on
 * their side, height pointing out of the wall, and did the same to the two
 * `block` inserts on openings and to any `plate` anchored on its `+z` face
 * (`brazier+large,base.stl`, axis `[0, 0, −1]`, which came out upside down).
 *
 * The extents cannot be wrong that way, because an insert is authored **Z-up**
 * like every other file in the archive:
 *
 *   - the insert's mesh `+z` stays world up, which {@link standUpright} has
 *     already done — so there is no vertical alignment step at all;
 *   - of the two horizontal mesh axes, the **longer is the span** and the
 *     **shorter is the through-wall axis**. For an `opening` the through axis is
 *     turned onto `±mount.normal` and the span therefore lands across the face;
 *     the sign is the anchor axis's when the anchor axis *is* that mesh axis —
 *     a door's declared `+thin`, so its relief faces out — and `+normal`
 *     otherwise, a lintel's `at` being on its mid-plane where the choice costs
 *     nothing;
 *   - `hole` and `surface` take **no rotation whatever**: the accessory stands on
 *     a floor, nothing in the mount fixes its yaw, and the host's own `x` is as
 *     good an answer as any invented one.
 *
 * There is no roll step on these three kinds because there is no freedom left to
 * spend on one: the vertical is fixed by the extents and the yaw by the normal.
 *
 * ## The **slot name** decides the seat in an opening
 *
 * `lintel` sits at the `head` and everything else — `door`, `portcullis`,
 * `frame`, `shutters`, `window`, `archway`, `grate door` — at the `sill`. It is
 * the slot and not the insert's shape, because the shape does not say: a lintel
 * and a door leaf are both a slab of about the same section, and the only thing
 * that distinguishes *the piece that spans the top* from *the piece that fills
 * the hole* is what the host called the slot it goes in.
 *
 * `slot` is an argument rather than `mount.slot` read off the record. The two are
 * equal by construction — `catalog/mounts.ts#mountsFor` selects a host's mounts
 * *by* the hold name — and taking it explicitly is what puts the dependency at
 * the call site: the caller is placing a named hold, and the seat rule reads the
 * name the caller is placing rather than a field it never looks at.
 */
export function accessoryMatrix(
  host: HostFrame,
  mount: Mount,
  insert: InsertFrame,
  slot: string,
  copy: 0 | 1,
  target = new Matrix4(),
): Matrix4 {
  const seat = mountSeat(mount, insert.anchor, slot, copy)
  const anchor = zUpToYUp(insert.anchor.at)

  return target
    .copy(hostMatrix(host))
    .multiply(new Matrix4().makeTranslation(seat.point.x, seat.point.y, seat.point.z))
    .multiply(new Matrix4().makeRotationFromQuaternion(seat.align))
    .multiply(new Matrix4().makeTranslation(-anchor.x, -anchor.y, -anchor.z))
    .multiply(standUpright(insert.bounds))
}

/** Where one instance sits on the host, and how it is turned to get there. */
interface Seat {
  /** The anchor's landing point, in the host's bbox frame, Y-up. */
  readonly point: Vector3
  /**
   * The turn applied to the insert **after** {@link standUpright}.
   *
   * A whole quaternion rather than a target axis, because the two kinds of pose
   * {@link accessoryMatrix} describes do not both reduce to *aim this axis
   * there*: a socket aims the anchor axis and then rolls, an opening yaws the
   * insert's own box onto the face, and a hole does not turn it at all.
   */
  readonly align: Quaternion
}

/**
 * `tileMatrix`'s placement half: where the host part is, and how it is turned.
 *
 * Deliberately **not** the host's whole instance matrix — see
 * {@link accessoryMatrix} on why the host's own normalisation must not be
 * applied to a mount.
 */
function hostMatrix(host: HostFrame): Matrix4 {
  const centre = boxCentre(host.geometry.box)
  return new Matrix4()
    .makeTranslation(centre.x * GRID_UNIT_MM, host.elevationMm, centre.z * GRID_UNIT_MM)
    .multiply(new Matrix4().makeRotationY((-host.geometry.angle * Math.PI) / 180))
}

/** One {@link Seat} per kind — {@link accessoryMatrix} states how each is posed. */
function mountSeat(mount: Mount, anchor: InsertAnchor, slot: string, copy: 0 | 1): Seat {
  switch (mount.kind) {
    case 'socket':
    case 'pocket': {
      // The entry direction reversed. A socket with no axis at all is not a
      // direction to point along, and the surface normal is the honest fallback:
      // straight out of the face, with none of the lean.
      const entry = zUpToYUp(mount.axis)
      const axis = entry.lengthSq() > EPSILON ? entry.negate().normalize() : outwardAxis(mount.normal)
      // The insert's own up is the fallback for an anchor with no axis — see
      // {@link EPSILON} for what a zero vector does to the alignment.
      const from = zUpToYUp(anchor.axis)
      const align = alignToAxis(from.lengthSq() > EPSILON ? from.normalize() : WORLD_UP.clone(), axis)
      return { point: zUpToYUp(mount.at), align }
    }
    case 'opening':
      return openingSeat(mount, anchor, slot, copy)
    case 'hole':
    case 'surface':
      // No turn at all: `standUpright` has already put the insert's own +z up,
      // and nothing in a hole or a top face fixes a yaw to spend the remaining
      // freedom on. See {@link accessoryMatrix}.
      return { point: zUpToYUp(mount.at), align: new Quaternion() }
  }
}

/** The composition slot whose insert seats at the opening's head. See {@link accessoryMatrix}. */
const LINTEL_SLOT = 'lintel'

/**
 * Below this a squared length is not a direction.
 *
 * A zero vector reaching `Quaternion.setFromUnitVectors` produces a **NaN**
 * quaternion, and a NaN matrix is a mesh that fails every frustum test and
 * disappears with no error anywhere — the failure mode `fitRoom` guards the same
 * way, and for the same reason.
 */
const EPSILON = 1e-12

/**
 * Three's up, shared rather than allocated per call.
 *
 * Every use below either clones it or reads it — `setFromAxisAngle` and `cross`
 * do not write through their argument — because this runs once per accessory
 * per frame.
 */
const WORLD_UP = new Vector3(0, 1, 0)

/**
 * A measured triple as a unit direction out of the host, in Y-up.
 *
 * World up when the measurement is degenerate, so nothing downstream is handed a
 * zero vector. See {@link EPSILON}.
 */
function outwardAxis(normal: Vec3): Vector3 {
  const out = zUpToYUp(normal)
  return out.lengthSq() > EPSILON ? out.normalize() : WORLD_UP.clone()
}

/** The horizontal direction lying in a face: `up × out`, unit — or `null` on a level face. */
function faceAcross(out: Vector3): Vector3 | null {
  const along = WORLD_UP.clone().cross(out)
  return along.lengthSq() > EPSILON ? along.normalize() : null
}

/**
 * A leaf, a lintel or a grille in a doorway — posed by its own extents.
 *
 * The seat is the slot's: `lintel` on the `head`, everything else on the `sill`,
 * at the opening's `at` in the other two axes. The turn is the yaw that lays the
 * insert's **shorter horizontal extent** through the wall and therefore its
 * **longer** one across the face; see {@link accessoryMatrix} for why the
 * anchor's axis cannot be asked instead, and {@link copiesOf} for the second
 * leaf's offset.
 */
function openingSeat(mount: OpeningMount, anchor: InsertAnchor, slot: string, copy: 0 | 1): Seat {
  const out = outwardAxis(mount.normal)
  const point = zUpToYUp([mount.at[0], mount.at[1], slot === LINTEL_SLOT ? mount.head : mount.sill])

  const through = throughIndex(anchor.size)
  const align = yawOnto(meshAxis(through), out.clone().multiplyScalar(throughSign(anchor, through)))

  // `±width/4` is where two half-width slabs meet in the middle of the opening.
  // Non-null whenever `copiesOf` says two — it is the same `up × normal` test.
  const along = copiesOf(mount, anchor) === 2 ? faceAcross(out) : null
  if (along !== null) {
    point.addScaledVector(along, ((copy === 0 ? -1 : 1) * mount.width) / 4)
    // The vertical is the world's, not the leaf's: a door leaf turns about the
    // hinge line, and premultiplying is what keeps the axis out of the leaf's
    // own frame — where it would be whichever way the leaf happens to lean.
    if (copy === 1) align.premultiply(new Quaternion().setFromAxisAngle(WORLD_UP, Math.PI))
  }

  return { point, align }
}

/**
 * Which of the insert's two horizontal bbox axes runs **through** the host.
 *
 * The shorter one, `0` for the mesh's own x and `1` for its y — an insert being
 * authored Z-up, so its third extent is the height and is never a candidate. A
 * tie goes to x, which is arbitrary and unreachable in the corpus: no measured
 * insert has two equal horizontal extents.
 */
function throughIndex(size: Vec3): 0 | 1 {
  return size[0] <= size[1] ? 0 : 1
}

/** One of the insert's own horizontal mesh axes as a Y-up direction. */
function meshAxis(index: 0 | 1): Vector3 {
  return zUpToYUp(index === 0 ? [1, 0, 0] : [0, 1, 0])
}

/**
 * Which way round the through axis goes: **out of the host, or into it.**
 *
 * `+1` unless the anchor's own axis *is* that mesh axis and points the other
 * way. A `leaf`'s axis is `+thin` by declaration and a door's thin axis is its
 * depth, so this is what makes a door leaf's declared front face out of the
 * doorway. For a lintel — whose axis is its height, not its depth — there is
 * nothing to read, and `+normal` is free: its `at` sits on the opening's
 * mid-plane, where the choice costs nothing but which side the relief faces.
 */
function throughSign(anchor: InsertAnchor, index: 0 | 1): 1 | -1 {
  const component = anchor.axis[index]
  if (Math.abs(component) < 1 - AXIS_TOLERANCE) return 1
  return component > 0 ? 1 : -1
}

/** How near ±1 a component must be for the anchor's axis to *be* a bbox axis. */
const AXIS_TOLERANCE = 1e-6

/**
 * The rotation **about world up** that turns `from` onto `to`.
 *
 * Written as an explicit yaw rather than `setFromUnitVectors`, and both halves
 * of that matter. The shortest arc between two horizontal vectors is not about
 * the vertical: at 180° — an opposite-facing wall, which is half of them —
 * `setFromUnitVectors` picks an arbitrary perpendicular axis and can hand back a
 * turn that lays the insert on its face. And when `to` leans off horizontal, the
 * honest answer is still a yaw: the vertical is fixed by the insert's extents,
 * so what is being chosen here is only which way round the box faces.
 *
 * `to` is projected onto the horizontal plane by construction — the two dot
 * products below use its x and z alone. A `to` that is purely vertical leaves
 * both at zero, and the identity is the honest answer: nothing about a level
 * face says which way an insert should turn.
 */
function yawOnto(from: Vector3, to: Vector3): Quaternion {
  // `R_y(φ)` sends `(x, z)` to `(x cos φ + z sin φ, −x sin φ + z cos φ)`, so
  // these two are the cosine and sine of the angle that lands `from` on `to`.
  const cos = from.x * to.x + from.z * to.z
  const sin = from.z * to.x - from.x * to.z
  if (cos * cos + sin * sin < EPSILON) return new Quaternion()
  return new Quaternion().setFromAxisAngle(WORLD_UP, Math.atan2(sin, cos))
}

/**
 * Turn `from` onto `to`, then roll about `to` so the insert's own up stays up.
 *
 * A socket's pose and nothing else — see {@link accessoryMatrix} for why the
 * other three kinds do not go through here.
 *
 * Aligning two axes leaves one degree of freedom, and nothing in the data fixes
 * it: `setFromUnitVectors` resolves it with the shortest arc, which for a torch
 * on a leaning socket rolls the flame sideways. So the roll is chosen rather
 * than inherited — the insert's own **+Z**, which `standUpright` has already
 * made `+Y`, is brought as close to world up as the alignment allows.
 *
 * Both projections vanish when the target axis *is* vertical or when the
 * insert's up is its anchor axis (a peg, whose yaw about its own pin nothing can
 * see anyway). Then there is no roll to choose and the alignment stands.
 */
function alignToAxis(from: Vector3, to: Vector3): Quaternion {
  const align = new Quaternion().setFromUnitVectors(from, to)

  const up = WORLD_UP.clone().applyQuaternion(align).projectOnPlane(to)
  const worldUp = WORLD_UP.clone().projectOnPlane(to)
  if (up.lengthSq() > EPSILON && worldUp.lengthSq() > EPSILON) {
    const roll = Math.atan2(new Vector3().crossVectors(up, worldUp).dot(to), up.dot(worldUp))
    align.premultiply(new Quaternion().setFromAxisAngle(to, roll))
  }
  return align
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
