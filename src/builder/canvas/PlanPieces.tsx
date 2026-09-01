/**
 * The placed tiles, drawn.
 *
 * Memoised on the scene, and that is the whole performance strategy of this
 * canvas: nothing in this subtree depends on the camera or on the cursor, so a
 * pan, a zoom or a pointer move re-renders the root's `viewBox` and the ghost
 * and bails out here. Only a store write reaches these nodes.
 *
 * Each piece is three `<rect>`s — fill, surface pattern, contour — plus a fourth
 * when it is in conflict. The contour is a separate stroke on top rather than a
 * stroke on the filled rect, because the pattern overlay sits between them, and
 * because `src/materials/palette.ts` is explicit that silhouette is carried by
 * the contour rather than the fill: meeting WCAG 1.4.11's 3:1 against the
 * parchment well with fills alone would force every material below L* 50 and
 * destroy the light end of the palette.
 */
import { memo } from 'react'

import { MATERIALS } from '@/materials'

import { boxCentre } from './geometry'
import type { PlanPiece } from './scene'
import { CONFLICT_PATTERN_ID, hasSurfacePattern, surfacePatternId } from './surfaces'

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
 * One piece: fill, surface, contour, and the conflict hatch.
 *
 * Drawn as the *un-turned* rectangle centred in its own bounding box and then
 * rotated, rather than as the bounding box itself. For the 90° cases the two are
 * the same picture; for the 893 tiles whose step is not a multiple of 90 the
 * bounding box is up to 41% larger than the tile, and drawing it would show the
 * user a piece that does not exist.
 */
function Piece({ piece }: { piece: PlanPiece }) {
  const { box, extent, placement, style } = piece
  const centre = boxCentre(box)
  const x = centre.x - extent.w / 2
  const y = centre.z - extent.d / 2
  const family = MATERIALS[style.material]
  const rect = { x, y, width: extent.w, height: extent.d }

  return (
    <g
      data-placement-id={piece.id}
      data-band={piece.band}
      data-conflict={piece.conflict ? 'true' : undefined}
      transform={placement.rotation === 0 ? undefined : `rotate(${String(placement.rotation)} ${String(centre.x)} ${String(centre.z)})`}
    >
      <rect {...rect} fill={style.tint} />
      {hasSurfacePattern(family) ? <rect {...rect} fill={`url(#${surfacePatternId(style.material)})`} /> : null}
      {piece.conflict ? <rect {...rect} fill={`url(#${CONFLICT_PATTERN_ID})`} /> : null}
      <rect
        {...rect}
        fill="none"
        stroke={piece.conflict ? 'var(--acc)' : style.edge}
        strokeWidth={contourWidth(piece)}
        strokeDasharray={style.contour === 'dashed' ? '4 3' : undefined}
        vectorEffect="non-scaling-stroke"
      />
    </g>
  )
}

/** The contour weight for one piece: heavier for walls, heavier again in conflict. */
function contourWidth(piece: PlanPiece): number {
  const base = piece.band === 'edge' ? CONTOUR_WIDTH * EDGE_CONTOUR_SCALE : CONTOUR_WIDTH
  return piece.conflict ? base * 1.6 : base
}

export interface PlanPiecesProps {
  readonly pieces: readonly PlanPiece[]
}

export const PlanPieces = memo(function PlanPieces({ pieces }: PlanPiecesProps) {
  return (
    <g className="of-plan-pieces">
      {pieces.map((piece) => (
        <Piece key={piece.id} piece={piece} />
      ))}
    </g>
  )
})
