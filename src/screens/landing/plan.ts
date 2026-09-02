/**
 * The hero drawing's geometry: a small chamber, described in catalog grid units.
 *
 * This is data, not art direction — `HeroPlan.tsx` only turns it into `<rect>`s.
 * It lives in its own module for two reasons: the drawing is the one part of
 * this screen a designer will want to change, and separating the numbers from
 * the rendering means changing the room is an edit to a table rather than to
 * JSX.
 *
 * ## Why the room is drawn from `rect` and `wall` only
 *
 * Those are exactly the two footprint cases v1's builder can place — 3,449
 * `rect` plus 3,079 `wall` tiles, **75.0%** of the live corpus
 * (`src/catalog/schema.ts`, `Footprint`). `arc` (14.1%) lands in v1.1, and so do
 * the three cases row W4 added: `diag` (1.4%), `column` (1.4%) and `tri` (0.1%),
 * which is 249 tiles the builder can now describe and still not draw — row W6 is
 * where they arrive on the canvas. `none` (8.0%) is never placeable. So a hero
 * drawn from rectangles and wall segments is not a simplification of the
 * product: it is a picture of what the product does, and it cannot promise a
 * shape the builder would refuse.
 *
 * Every wall segment is {@link WALL_THICKNESS_UNITS} (0.5 units, the measured
 * 12.7 mm) on its short axis, and every coordinate here is a multiple of 0.25
 * units so the drawing sits on the same lattice the builder snaps to.
 *
 * ## Why the materials are named, not coloured
 *
 * A piece carries a {@link MaterialId}, and the fill, contour colour, contour
 * style and surface treatment all come from `MATERIALS` at render time. No hex
 * literal appears in this directory. Retuning the palette retints the hero, and
 * a material family that gets removed is a type error here rather than a colour
 * that quietly stops matching the rest of the app.
 */
import { WALL_THICKNESS_UNITS } from '@/catalog'
import type { MaterialId } from '@/materials'

/** Half a unit, spelled out once so the wall rectangles read as walls. */
const T = WALL_THICKNESS_UNITS

/**
 * Extra line work drawn inside a piece, on top of its fill.
 *
 * Only the cases the drawing actually uses. `treads` is the stair's step
 * nosings; `grain` is the two boards of the door leaf. Both are real features of
 * the sculpt rather than decoration, which is why they are here and not a
 * generic hatch knob.
 */
export type PieceDetail = 'treads' | 'grain'

/** One rectangle of the plan, in grid units, top-left origin. */
export interface PlanPiece {
  /** Which `MATERIALS` family supplies fill, contour and surface treatment. */
  readonly material: MaterialId
  readonly x: number
  readonly y: number
  readonly w: number
  readonly d: number
  readonly detail?: PieceDetail
}

/**
 * Clear space around the drawing, in grid units.
 *
 * The viewBox is derived from the pieces rather than declared (see
 * {@link planBounds}), so moving a tile cannot leave the room sitting off-centre
 * in a fixed frame — which is exactly what happened when the extent was a
 * hand-written 14 × 8.
 */
export const PLAN_MARGIN = 1

/**
 * Inner face of the chamber's east wall, in units.
 *
 * The one coordinate two things agree on — where the chamber stops and the
 * corridor starts — so it is named rather than repeated, and
 * {@link chamberExtent} uses it to tell the room from the passage.
 */
const CHAMBER_EAST_WALL = 10.5

/**
 * Floor tiles — `rect` footprints, in the sizes the catalog actually ships.
 *
 * Six 2×2 tiles and a column of four 1×1s, which is how a 7 × 4 chamber is
 * really tiled: the big pieces do the middle and the singles close the odd unit
 * at the east wall. Drawing it as one 7 × 4 slab would have been easier and
 * would have hidden the thing the plan view is for — seeing which tiles you
 * need.
 */
export const PLAN_FLOORS: readonly PlanPiece[] = [
  { material: 'dungeon_stone', x: 3.5, y: 1.5, w: 2, d: 2 },
  { material: 'dungeon_stone', x: 5.5, y: 1.5, w: 2, d: 2 },
  { material: 'dungeon_stone', x: 7.5, y: 1.5, w: 2, d: 2 },
  { material: 'dungeon_stone', x: 3.5, y: 3.5, w: 2, d: 2 },
  { material: 'dungeon_stone', x: 5.5, y: 3.5, w: 2, d: 2 },
  { material: 'dungeon_stone', x: 7.5, y: 3.5, w: 2, d: 2 },
  { material: 'dungeon_stone', x: 9.5, y: 1.5, w: 1, d: 1 },
  { material: 'dungeon_stone', x: 9.5, y: 2.5, w: 1, d: 1 },
  { material: 'dungeon_stone', x: 9.5, y: 3.5, w: 1, d: 1 },
  { material: 'dungeon_stone', x: 9.5, y: 4.5, w: 1, d: 1 },
  // The corridor east out of the chamber: a 2×1 and a 1×1.
  { material: 'dungeon_stone', x: 10.5, y: 3, w: 2, d: 1 },
  { material: 'dungeon_stone', x: 12.5, y: 3, w: 1, d: 1 },
]

/**
 * Wall segments — `wall` footprints, 0.5 units thick.
 *
 * The gaps are the point: a doorway in the north wall at x 6–7, and the
 * corridor mouth in the east wall at y 3–4. A continuous rectangle of wall
 * would be a box, not a room.
 */
export const PLAN_WALLS: readonly PlanPiece[] = [
  // North, broken by the doorway.
  { material: 'cut_stone', x: 3, y: 1, w: 3, d: T },
  { material: 'cut_stone', x: 7, y: 1, w: 4, d: T },
  // South.
  { material: 'cut_stone', x: 3, y: 5.5, w: 8, d: T },
  // West.
  { material: 'cut_stone', x: 3, y: 1, w: T, d: 5 },
  // East, broken by the corridor mouth.
  { material: 'cut_stone', x: 10.5, y: 1, w: T, d: 2 },
  { material: 'cut_stone', x: 10.5, y: 4, w: T, d: 2 },
  // The corridor's own two walls.
  { material: 'cut_stone', x: 11, y: 2.5, w: 2.5, d: T },
  { material: 'cut_stone', x: 11, y: 4, w: 2.5, d: T },
]

/**
 * What sits on the floor: a stair against the south wall, the door leaf in the
 * north doorway, and four columns inset from the chamber corners.
 *
 * The stair started outside the north doorway, as a porch. In plan at hero size
 * a 1 × 1 dark block protruding from a wall reads as a chimney, so it moved
 * inside, where it is 2 × 1 and unmistakably a stair.
 *
 * Columns are 0.5 × 0.5 — the smallest footprint in the corpus and the one that
 * makes the 0.5-unit lattice visible in the drawing.
 */
export const PLAN_FIXTURES: readonly PlanPiece[] = [
  { material: 'rough_stone', x: 7.5, y: 4.5, w: 2, d: 1, detail: 'treads' },
  { material: 'wood', x: 6, y: 1, w: 1, d: T, detail: 'grain' },
  { material: 'plain', x: 3.75, y: 1.75, w: 0.5, d: 0.5 },
  { material: 'plain', x: 9.75, y: 1.75, w: 0.5, d: 0.5 },
  { material: 'plain', x: 3.75, y: 4.75, w: 0.5, d: 0.5 },
  { material: 'plain', x: 9.75, y: 4.75, w: 0.5, d: 0.5 },
]

/**
 * The material families the drawing uses, in the order the legend lists them.
 *
 * Derived rather than restated so a piece added above cannot fall out of the
 * legend, and a family dropped from the drawing cannot linger in it.
 */
export const PLAN_MATERIALS: readonly MaterialId[] = [
  ...new Set([...PLAN_FLOORS, ...PLAN_WALLS, ...PLAN_FIXTURES].map((piece) => piece.material)),
]

/**
 * The chamber's interior, in units — the figure the drawing's dimension line
 * annotates.
 *
 * Computed from the floor pieces rather than written down, so moving a tile
 * cannot leave the label claiming a room size the drawing does not have. The
 * corridor is excluded on purpose: it is a passage, not part of the chamber, and
 * including it would make the label describe a bounding box instead of a room.
 */
export function chamberExtent(): { w: number; d: number } {
  const chamber = PLAN_FLOORS.filter((piece) => piece.x + piece.w <= CHAMBER_EAST_WALL)
  const left = Math.min(...chamber.map((piece) => piece.x))
  const right = Math.max(...chamber.map((piece) => piece.x + piece.w))
  const top = Math.min(...chamber.map((piece) => piece.y))
  const bottom = Math.max(...chamber.map((piece) => piece.y + piece.d))
  return { w: right - left, d: bottom - top }
}

/**
 * The drawing's frame: the pieces' bounding box, plus {@link PLAN_MARGIN} of
 * clear space on every side.
 *
 * Derived rather than declared, so the plan is always centred in its own frame
 * and the hero's aspect ratio is a consequence of the room instead of a number
 * the room has to fit.
 */
export function planBounds(): { x: number; y: number; w: number; d: number } {
  const pieces = [...PLAN_FLOORS, ...PLAN_WALLS, ...PLAN_FIXTURES]
  const left = Math.min(...pieces.map((piece) => piece.x)) - PLAN_MARGIN
  const top = Math.min(...pieces.map((piece) => piece.y)) - PLAN_MARGIN
  const right = Math.max(...pieces.map((piece) => piece.x + piece.w)) + PLAN_MARGIN
  const bottom = Math.max(...pieces.map((piece) => piece.y + piece.d)) + PLAN_MARGIN
  return { x: left, y: top, w: right - left, d: bottom - top }
}
