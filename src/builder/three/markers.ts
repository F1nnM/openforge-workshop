/**
 * The flat geometry the surface draws that is not a tile: footprint plates,
 * their outlines, and the plan cursor.
 *
 * All three are built from `geometry.ts`'s **convex parts** — the same polygons
 * `partsOverlap` separates and `pieceAt` tests containment against — so a plate
 * covers exactly the ground the collision sweep thinks the piece covers. That is
 * the property that makes a plate a truthful stand-in for a piece whose mesh has
 * not arrived: it is not a guess at the tile's shape, it is the footprint the
 * catalog tagged, drawn at the size the builder is already reasoning about.
 *
 * ## Why this exists at all, and why it is not the primitive the owner rejected
 *
 * A mesh may legitimately be absent — R1's cache has seven states and four of
 * them are terminal, and R1 measured **0.60 s to a first warm mesh and 1.37 s
 * cold**, so a placed tile with no geometry is a common state and not an edge
 * case. Drawing nothing would be the one unacceptable answer: an occupied cell
 * that looks empty invites a second tile on top of the first, and the user would
 * not find out until the bill listed two.
 *
 * The owner rejected `design/forge3d.js`'s **procedural tile geometry** — a box
 * per `kind`, an extrusion per curve, standing in for the real model. A plate is
 * a different object and says a different thing: it is deliberately *flat*,
 * 0.6 mm of nothing where a 4.5 mm floor or a 63.5 mm wall would be, so it can
 * never be mistaken for the tile. It reads as the plan view's outline given just
 * enough thickness to catch the light.
 *
 * ## Fan triangulation is exact here, and only because the parts are convex
 *
 * `planParts` returns convex polygons by construction — `sector.ts` subdivides
 * an annular sector into convex quads for exactly this reason, and `tri`, `diag`
 * and every rect case are convex outright. So a triangle fan from vertex 0 is a
 * correct tessellation with no ear clipping and no library. On a concave polygon
 * it would fold, which is why {@link platePositions} takes parts and not an
 * outline path: the `outline` field is an SVG `d` string and can be concave.
 */
import { BufferAttribute, BufferGeometry } from 'three'

import type { PlanPart, PlanPoint } from '@/builder/canvas'
import { GRID_UNIT_MM } from '@/catalog'

/**
 * A plate's thickness above the plan, in millimetres: **0.6**.
 *
 * Thin enough that nobody could read it as a tile — the median floor is 4.5 mm
 * and a wall is 63.5 mm — and thick enough to be unambiguously above
 * {@link SURFACE_GRID_DROP_MM}'s grid and above a coplanar floor's top face, so
 * a plate on the same cell as a loaded floor does not z-fight with it.
 */
export const PLATE_HEIGHT_MM = 0.6

/** Vertices per triangle. Named so the arithmetic below reads as itself. */
const VERTICES_PER_TRIANGLE = 3

/**
 * Triangle-fan positions for a set of convex parts, in millimetres, `y` up.
 *
 * Absolute: the parts are already in world plan coordinates, so the result needs
 * no matrix and can be dropped straight into the millimetre group beside the
 * instanced tiles. Degenerate parts — fewer than three vertices, which
 * `planParts` does not produce but a hand-built fixture can — contribute nothing
 * rather than a NaN.
 */
export function platePositions(parts: readonly PlanPart[], heightMm: number): Float32Array {
  const values: number[] = []
  for (const part of parts) {
    if (part.length < 3) continue
    const origin = part[0] as PlanPoint
    for (let i = 1; i + 1 < part.length; i += 1) {
      const a = part[i] as PlanPoint
      const b = part[i + 1] as PlanPoint
      // Wound so the face points up: the plan's `z` grows the way three's does
      // (`place.ts`'s second coordinate fact), and a plan polygon is wound
      // clockwise in that frame, which is counter-clockwise seen from `+y`.
      values.push(
        origin[0] * GRID_UNIT_MM, heightMm, origin[1] * GRID_UNIT_MM,
        b[0] * GRID_UNIT_MM, heightMm, b[1] * GRID_UNIT_MM,
        a[0] * GRID_UNIT_MM, heightMm, a[1] * GRID_UNIT_MM,
      )
    }
  }
  return new Float32Array(values)
}

/**
 * How many triangles {@link platePositions} will emit for these parts.
 *
 * A convex `n`-gon fans into `n - 2`. Stated as a function so the tests can
 * check the buffer against the arithmetic rather than against a transcription of
 * it.
 */
export function plateTriangles(parts: readonly PlanPart[]): number {
  return parts.reduce((total, part) => total + Math.max(0, part.length - 2), 0)
}

/**
 * A filled plate over `parts`, ready to mount.
 *
 * No normals: `MeshStandardMaterial` with `flatShading` derives them from the
 * geometry, exactly as G1's store objects do — `lod.ts` records that a LOD
 * object carries `POSITION` and nothing else, and three's own shader computes
 * the face normal when `FLAT_SHADED` is set. One less attribute to allocate for
 * a surface that is a single plane anyway.
 */
export function plateGeometry(parts: readonly PlanPart[], heightMm = PLATE_HEIGHT_MM): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(platePositions(parts, heightMm), VERTICES_PER_TRIANGLE))
  geometry.computeBoundingSphere()
  return geometry
}

/**
 * The closed outline of every part, as line-segment pairs, in millimetres.
 *
 * The outline is what does the work: a flat fill in the material's own tint
 * reads as a *very thin tile* at a glance, and the bright ring is what says
 * "this is a marker". §9's argument for the plan view applies unchanged —
 * silhouette is carried by the contour, not by the fill.
 */
export function plateEdgePositions(parts: readonly PlanPart[], heightMm = PLATE_HEIGHT_MM): Float32Array {
  const values: number[] = []
  for (const part of parts) {
    if (part.length < 2) continue
    for (let i = 0; i < part.length; i += 1) {
      const from = part[i] as PlanPoint
      const to = part[(i + 1) % part.length] as PlanPoint
      values.push(
        from[0] * GRID_UNIT_MM, heightMm, from[1] * GRID_UNIT_MM,
        to[0] * GRID_UNIT_MM, heightMm, to[1] * GRID_UNIT_MM,
      )
    }
  }
  return new Float32Array(values)
}

/**
 * The plan cursor's crosshair, in millimetres, centred on the origin.
 *
 * Positioned by the caller rather than baked at a point, so a keyboard user
 * stepping the cursor moves one `position` and reuses one geometry — a room's
 * worth of arrow presses allocates nothing.
 *
 * `armUnits` is in grid units and 0.35 is `PlanCanvas`'s own `Caret` arm, kept
 * so the two views' cursors are the same size relative to a tile.
 */
export function caretPositions(armUnits = 0.35): Float32Array {
  const arm = armUnits * GRID_UNIT_MM
  // Segment endpoints, the layout `ScreenLine` and a `LineSegments` position
  // attribute share: two strokes crossing at the origin.
  return new Float32Array([-arm, 0, 0, arm, 0, 0, 0, 0, -arm, 0, 0, arm])
}
