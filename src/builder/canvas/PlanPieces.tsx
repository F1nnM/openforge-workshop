/**
 * The placed tiles, drawn.
 *
 * Memoised on the scene, and that is the whole performance strategy of this
 * canvas: nothing in this subtree depends on the camera or on the cursor, so a
 * pan, a zoom or a pointer move re-renders the root's `viewBox` and the ghost
 * and bails out here. Only a store write reaches these nodes.
 *
 * Each piece is three `<path>`s — fill, surface pattern, contour — plus one more
 * when it is in conflict and one more when its outline is unmeasured. The
 * contour is a separate stroke on top rather than a stroke on the filled path,
 * because the pattern overlay sits between them, and because
 * `src/materials/palette.ts` is explicit that silhouette is carried by the
 * contour rather than the fill: meeting WCAG 1.4.11's 3:1 against the parchment
 * well with fills alone would force every material below L* 50 and destroy the
 * light end of the palette.
 *
 * ## Why a `<path>` and not a `<rect>`
 *
 * Three of the seven footprint cases are not rectangles. A `tri` is a filled
 * right triangle (9 tiles), a `diag` is a rectangle carried at 45° inside its
 * box (121), and an `arc` is an annular sector (1,199) — 13.8% of the corpus,
 * whose outline needs two `A` commands and cannot be spelled with axis-aligned
 * primitives at all. So the shape publishes its own `d` in a local
 * `[0, w] × [0, d]` frame (`geometry.ts`, `sector.ts`) and this file only has to
 * place that frame. Which is also why nothing here switches on `foot.shape`: a
 * renderer that knew the seven cases would be the second place they are written
 * down, and `geometry.ts` has the exhaustiveness guard.
 *
 * ## The one thing the drawing says that the collision test does not
 *
 * A sector's outline here is **exact** — the arc, not the 3-to-14 convex parts
 * `overlap.ts` tests it with. `sector.ts` sets out why the two differ: the parts
 * are an outward bound, so drawing them would show the user a piece 0.246 mm too
 * large with visible facets, and `src/catalog/schema.ts`'s case for reshaping
 * `arc` at all was that an outline the user can see must not be a shape nobody
 * measured.
 */
import { memo } from 'react'

import { MATERIALS } from '@/materials'
import type { PlacementId } from '@/store'

import type { PlanBox, PlanShape } from './geometry'
import { boxCentre } from './geometry'
import type { ScenePiece } from './scene'
import { CONFLICT_PATTERN_ID, UNMEASURED_PATTERN_ID, hasSurfacePattern, surfacePatternId } from './surfaces'

/** Contour weight in CSS pixels, held constant across zoom by `vector-effect`. */
export const CONTOUR_WIDTH = 1.25

/**
 * How much heavier an edge piece's contour is drawn.
 *
 * Not decoration, and not arbitrary. Two pieces in different height bands can
 * resolve to the *same* material — `Aztlan Floor Wall 2x` and `Aztlan Floor 2x2`
 * both come out as Aztlan tuff, because they are the same stone — so a room built
 * from one texture family renders as a single slab with faint seams, and the wall
 * that gives the plan its shape is the thing you cannot see. Weighting the wall
 * contour is how a draughtsman separates the two on paper, and it is the only
 * signal available in a drawing with no height axis.
 */
const EDGE_CONTOUR_SCALE = 1.8

/**
 * Put a shape's local `[0, w] × [0, d]` frame where the placement says.
 *
 * Read right to left, as SVG applies it: move the shape's own bounding-box
 * centre to the origin, turn it, then move it to the centre of the box the
 * placement reserved. That is the same composition `planParts` does in
 * arithmetic, which is what keeps the drawing and the collision geometry on the
 * same piece — and `angle` is the *drawn* angle, so a `diag` at rotation 0
 * arrives here already carrying its intrinsic 45°.
 */
export function shapeTransform(shape: PlanShape, box: PlanBox, angle: number): string {
  const centre = boxCentre(box)
  const half = `${String(-shape.extent.w / 2)} ${String(-shape.extent.d / 2)}`
  if (angle === 0) return `translate(${String(centre.x - shape.extent.w / 2)} ${String(centre.z - shape.extent.d / 2)})`
  return `translate(${String(centre.x)} ${String(centre.z)}) rotate(${String(angle)}) translate(${half})`
}

/**
 * One piece: fill, surface, contour, the conflict hatch and the unmeasured mark.
 *
 * Drawn as its own outline placed into its own bounding box, rather than as the
 * bounding box itself. For the axis-aligned rectangles the two are the same
 * picture; for the 823 placeable tiles whose step is not a multiple of 90 the
 * bounding box is up to 41% larger than the tile, and drawing it would show the
 * user a piece that does not exist.
 */
function Piece({ piece, moving }: { piece: ScenePiece; moving: boolean }) {
  const { box, shape, style } = piece
  const family = MATERIALS[style.material]
  const outline = { d: shape.outline }

  return (
    <g
      data-placement-id={piece.id}
      data-band={piece.band}
      data-conflict={piece.conflict ? 'true' : undefined}
      data-basis={piece.caveat === null ? undefined : 'fallback'}
      data-generated={piece.kind === 'generated' ? 'true' : undefined}
      data-tiles={offGrid(piece) ? 'false' : undefined}
      data-moving={moving ? 'true' : undefined}
      transform={shapeTransform(shape, box, piece.angle)}
    >
      <path {...outline} fill={style.tint} />
      {hasSurfacePattern(family) ? <path {...outline} fill={`url(#${surfacePatternId(style.material)})`} /> : null}
      {/* The outline is the project's best statement of this curve and not a
          measurement of it — see `geometry.ts`'s `placementCaveat`. Marked, and
          also named in `piece.label`, because a hatch is invisible to a screen
          reader and the provenance is the whole reason `bandBasis` exists. */}
      {piece.caveat === null ? null : <path {...outline} fill={`url(#${UNMEASURED_PATTERN_ID})`} />}
      {piece.conflict ? <path {...outline} fill={`url(#${CONFLICT_PATTERN_ID})`} /> : null}
      <path
        {...outline}
        fill="none"
        stroke={piece.conflict ? 'var(--acc)' : style.edge}
        strokeWidth={contourWidth(piece)}
        strokeDasharray={style.contour === 'dashed' ? '4 3' : undefined}
        vectorEffect="non-scaling-stroke"
      />
    </g>
  )
}

/**
 * Whether a piece's basis is not the builder grid's, so it will not tile.
 *
 * True only for a generated base at `SQUARE_BASIS` 25, 31.75 or 38.1 mm — no
 * catalog tile can be off-grid, all 1,963 archived bases being the inch grid. The
 * *outline* needs no help: row S5 converts the footprint to grid units, so a
 * `wyloch` 2×2 is drawn at the 2.5 squares it really occupies rather than the 2
 * its parameters say, and the collision test agrees. What this attribute adds is
 * that the piece will not snap to the lattice, which the drawing cannot show and
 * the label already says in words.
 */
function offGrid(piece: ScenePiece): boolean {
  return piece.kind === 'generated' && !piece.tiles
}

/** The contour weight for one piece: heavier for walls, heavier again in conflict. */
function contourWidth(piece: ScenePiece): number {
  const base = piece.band === 'edge' ? CONTOUR_WIDTH * EDGE_CONTOUR_SCALE : CONTOUR_WIDTH
  return piece.conflict ? base * 1.6 : base
}

export interface PlanPiecesProps {
  readonly pieces: readonly ScenePiece[]
  /**
   * The placement being carried by a move, or `null`.
   *
   * Marked `data-moving` and dimmed by `canvas.css`, so the piece at its origin
   * *is* the origin marker — exact, and one attribute rather than a second
   * outline. It does not cost the memoisation anything: this prop changes when a
   * piece is picked up and when it is put down, twice per gesture, while the
   * preview that follows the pointer lives in `PlanCanvas` outside this subtree.
   */
  readonly movingId?: PlacementId | null
  /**
   * Marks the group as the generated one, for the stylesheet and for a test.
   *
   * The *pieces* are already distinguishable — every one carries
   * `data-generated` — so this is not how a reader tells them apart. It is on
   * the group because `PlanCanvas` renders two of these and the DOM order is
   * load-bearing: the generated group is first, so a generated base is painted
   * under the catalog's pieces, which is what `scene.ts`'s `scenePaintOrder`
   * says in arithmetic and what `pieceAt` hit-tests by. A test that asserted
   * paint order off two anonymous `<g>`s would be asserting nothing.
   */
  readonly generated?: boolean
}

export const PlanPieces = memo(function PlanPieces({
  pieces,
  movingId = null,
  generated = false,
}: PlanPiecesProps) {
  // Nothing at all rather than an empty group: the generated group is empty for
  // every room that has no generated base in it, which is most of them.
  if (pieces.length === 0) return null
  return (
    <g className="of-plan-pieces" data-generated={generated ? 'true' : undefined}>
      {pieces.map((piece) => (
        <Piece key={piece.id} piece={piece} moving={piece.id === movingId} />
      ))}
    </g>
  )
})
