/**
 * The hero image: a chamber drawn in plan, from the builder's own primitives.
 *
 * ## What replaced the mock's 3D render, and why
 *
 * design-contract.md §2.1 fills the right column of the hero with "a rendered
 * composition — a small room built from real tiles, produced by the 3D engine at
 * load time". **v1 has no 3D engine.** The builder is a top-down plan view (PR
 * 17) and even the single-tile STL viewer is gated behind a size check and does
 * not land until PR 21. There is no honest way to ship the mock's hero.
 *
 * So the hero is a *drawing*, in the same top-down idiom the builder works in,
 * built from the same two footprint primitives the builder can place and tinted
 * from the same material registry that will fill its tiles. It is a picture of
 * the product rather than a picture of the subject matter — which is the only
 * kind of hero this app can put on its front door without overclaiming.
 *
 * The alternatives, and what ruled each out:
 *
 *   - **A collage of sprite-sheet frames from R2.** The frames exist for 8,701
 *     tiles and are real geometry, which is the argument for them. Against:
 *     every sheet is `stl-thumb`'s default **blue** Phong material — 99.8% of
 *     opaque pixels non-neutral, per `src/materials/palette.ts` — which is a
 *     cobalt collage on a parchment ground and cannot be CSS-tinted out. Sheets
 *     average 529 KB and hold ten 512 px frames in a 2×5 grid, so using one
 *     three-quarter view costs the whole sheet: a five-tile composition is
 *     ~2.6 MB of blocking imagery on the one screen every first-time visitor
 *     sees. PR 20's 256 px WebP derivatives would fix the weight, and they do
 *     not exist yet. It is also a cross-origin dependency, so a CORS or bucket
 *     hiccup renders the hero as five broken images.
 *   - **A photograph of printed terrain.** No rights to one, and it would
 *     misrepresent the deliverable: what the archive hands you is colourless
 *     geometry, not painted resin.
 *   - **A shimmer placeholder** (what the mock shows before its render lands).
 *     Honest and inert, and it would read as an unfinished page for ever.
 *
 * Cost of the choice: **zero network bytes**. It is inline SVG, it paints with
 * the first frame, it has no external dependency to fail, and it scales to any
 * width without a second asset.
 *
 * ## Everything visual here comes from a measured source
 *
 * Geometry is `plan.ts`, in grid units. Fill, contour colour, contour style and
 * surface treatment come from `MATERIALS`; there is no colour literal in this
 * file. Surface patterns are generated *from the registry's own numbers* —
 * `mortar.scale` sets the coursing pitch and `mortar.darken` its strength,
 * `grain.scale` sets the stipple pitch and `grain.amplitude` its weight — so
 * retuning a material retunes the drawing.
 *
 * ## Accessibility
 *
 * One `role="img"` with a description of what the plan shows. The caption
 * beneath it (in `Landing.tsx`) carries the measurements as real text, so the
 * figures are readable rather than trapped in the graphic — which is also why
 * there is no text inside the SVG: at 375 px the drawing renders around 300 px
 * wide, and 10 px type inside a 500-unit viewBox would arrive at 6 px.
 */
import { MATERIALS } from '@/materials'
import type { MaterialFamily, MaterialId } from '@/materials'

import { PLAN_FIXTURES, PLAN_FLOORS, PLAN_MATERIALS, PLAN_WALLS, planBounds } from './plan'
import type { PlanPiece } from './plan'

/** User units per grid unit. Sets the drawing's internal resolution, nothing else. */
const UNIT = 40

/**
 * The frame, in user units — the room's own bounding box plus a margin.
 *
 * Derived, so the drawing is centred in it and the hero's aspect ratio follows
 * the room rather than the room having to fill a shape someone chose. Computed
 * once at module load: the geometry is a constant.
 */
const BOUNDS = planBounds()
const VIEW = {
  x: BOUNDS.x * UNIT,
  y: BOUNDS.y * UNIT,
  w: BOUNDS.w * UNIT,
  d: BOUNDS.d * UNIT,
}

/** Contour weight, in user units. ~1.1 CSS px at the hero's usual rendered size. */
const CONTOUR_W = 1.25

/**
 * Ceiling on a surface pattern's cell, in grid units.
 *
 * A material's own pitch is `1 / scale` units, which for timber (`scale` 0.6) is
 * 1.67 units — larger than the door leaf it would be drawn on, so the door would
 * get no texture at all. Capping means every piece receives at least one cell.
 */
const MAX_PATTERN_CELL = 0.6

/* --------------------------------------------------------------- id plumbing */

const gridPatternId = 'of-plan-grid'
const surfacePatternId = (material: MaterialId) => `of-plan-surface-${material}`

/* ---------------------------------------------------------------- primitives */

/**
 * The surface treatment for one material, as an SVG pattern.
 *
 * Two treatments, matching the two the registry defines beyond `flat`:
 *
 *   - `noise+mortar` — a square lattice of joints at the material's Worley
 *     pitch, drawn in its contour colour at its own `darken` strength. Coursed
 *     ashlar, which is what the mortar spec describes.
 *   - `noise` — a rotated stipple at the grain pitch, weighted by amplitude. A
 *     lattice of dots is a poor imitation of fBm and a good imitation of the
 *     hatch a draughtsman would use for the same thing, which is the register
 *     this drawing is in.
 *
 * The joint and stipple ink is the material's `edge`, not a computed shade of
 * its `tint`: `edge` is the colour the palette already publishes for "darker
 * than this fill, still this material", so using it keeps the drawing inside the
 * palette instead of inventing values between its entries.
 */
function SurfacePattern({ family }: { family: MaterialFamily }) {
  const id = surfacePatternId(family.id)

  if (family.surface === 'noise+mortar' && family.mortar) {
    const cell = Math.min(1 / family.mortar.scale, MAX_PATTERN_CELL) * UNIT
    return (
      <pattern id={id} width={cell} height={cell} patternUnits="userSpaceOnUse">
        <path
          d={`M 0 0 H ${String(cell)} M 0 0 V ${String(cell)}`}
          fill="none"
          stroke={family.edge}
          strokeWidth={0.9}
          opacity={family.mortar.darken}
        />
      </pattern>
    )
  }

  if (family.surface === 'noise' && family.grain) {
    const cell = Math.min(1 / family.grain.scale, MAX_PATTERN_CELL) * UNIT
    return (
      <pattern
        id={id}
        width={cell}
        height={cell}
        patternUnits="userSpaceOnUse"
        // Off-axis so the stipple does not line up with the tile seams and read
        // as a second, wrong grid.
        patternTransform="rotate(18)"
      >
        <circle
          cx={cell / 2}
          cy={cell / 2}
          r={1 + family.grain.amplitude * 3}
          fill={family.edge}
          opacity={0.14 + family.grain.amplitude}
        />
      </pattern>
    )
  }

  return null
}

/** Whether a material has a pattern to overlay. Mirrors {@link SurfacePattern}. */
function hasSurfacePattern(family: MaterialFamily): boolean {
  if (family.surface === 'noise+mortar') return family.mortar !== null
  if (family.surface === 'noise') return family.grain !== null
  return false
}

/**
 * The line work drawn inside a piece: stair nosings, or the joints between the
 * boards of the door leaf.
 *
 * Treads run across the depth axis (you climb along it); boards run across the
 * width axis (they stand upright in the leaf). Both are features of the sculpt,
 * which is why they are drawn rather than left to the surface pattern.
 */
function PieceDetailLines({ piece, family }: { piece: PlanPiece; family: MaterialFamily }) {
  const x = piece.x * UNIT
  const y = piece.y * UNIT
  const w = piece.w * UNIT
  const d = piece.d * UNIT

  const lines =
    piece.detail === 'treads'
      ? [1, 2, 3].map((i) => `M ${String(x)} ${String(y + (d * i) / 4)} h ${String(w)}`)
      : [1, 2].map((i) => `M ${String(x + (w * i) / 3)} ${String(y)} v ${String(d)}`)

  return (
    <path
      d={lines.join(' ')}
      fill="none"
      stroke={family.edge}
      strokeWidth={CONTOUR_W}
      opacity={0.75}
    />
  )
}

/**
 * One rectangle of the plan: fill, surface pattern, then contour.
 *
 * The contour is a separate stroke on top rather than a stroke on the filled
 * rect, because the pattern overlay sits between them — and because
 * `palette.ts` is explicit that silhouette is carried by the contour, not the
 * fill: meeting 3:1 against the well with fills alone would force every
 * material below L* 50 and destroy the light end of the palette.
 */
function Piece({ piece }: { piece: PlanPiece }) {
  const family = MATERIALS[piece.material]
  const x = piece.x * UNIT
  const y = piece.y * UNIT
  const w = piece.w * UNIT
  const d = piece.d * UNIT

  return (
    <g>
      <rect x={x} y={y} width={w} height={d} fill={family.tint} />
      {hasSurfacePattern(family) ? (
        <rect x={x} y={y} width={w} height={d} fill={`url(#${surfacePatternId(piece.material)})`} />
      ) : null}
      {piece.detail === undefined ? null : <PieceDetailLines piece={piece} family={family} />}
      <rect
        x={x}
        y={y}
        width={w}
        height={d}
        fill="none"
        stroke={family.edge}
        strokeWidth={CONTOUR_W}
        strokeDasharray={family.contour === 'dashed' ? '4 3' : undefined}
      />
    </g>
  )
}

/**
 * Corner registration marks, in the accent.
 *
 * The one purely graphic element in the drawing, and it is doing a job: it
 * frames the plan as a sheet rather than leaving it floating in the middle of a
 * well, and it is the only place the burnt-sienna accent appears in the image,
 * which ties the drawing to the rest of the palette.
 */
function CornerMarks() {
  const inset = 7
  const arm = 15
  const left = VIEW.x + inset
  const right = VIEW.x + VIEW.w - inset
  const top = VIEW.y + inset
  const bottom = VIEW.y + VIEW.d - inset
  const corners: [number, number, number, number][] = [
    [left, top, 1, 1],
    [right, top, -1, 1],
    [left, bottom, 1, -1],
    [right, bottom, -1, -1],
  ]

  return (
    <path
      className="of-plan-marks"
      d={corners
        .map(
          ([x, y, sx, sy]) =>
            `M ${String(x + sx * arm)} ${String(y)} H ${String(x)} V ${String(y + sy * arm)}`,
        )
        .join(' ')}
      fill="none"
      stroke="var(--acc)"
      strokeWidth={1.4}
      opacity={0.5}
    />
  )
}

/* ------------------------------------------------------------------ the plan */

/**
 * The description read to assistive technology.
 *
 * Written out rather than assembled from the piece list: a screen reader user
 * needs to know what the picture is *of*, not an inventory of twelve rectangles.
 */
const PLAN_LABEL =
  'Plan view of a chamber laid out from OpenForge tiles: a tiled floor seven by four units, ' +
  'stone walls with a doorway to the north and a corridor leading east, a stair against the ' +
  'south wall, and four columns inset from the corners.'

export function HeroPlan() {
  return (
    <svg
      className="of-plan"
      viewBox={`${String(VIEW.x)} ${String(VIEW.y)} ${String(VIEW.w)} ${String(VIEW.d)}`}
      role="img"
      aria-label={PLAN_LABEL}
    >
      <defs>
        {/* One grid cell, drawn on two edges so adjacent cells share a line. */}
        <pattern id={gridPatternId} width={UNIT} height={UNIT} patternUnits="userSpaceOnUse">
          <path
            d={`M 0 0 H ${String(UNIT)} M 0 0 V ${String(UNIT)}`}
            fill="none"
            stroke="var(--line)"
            strokeWidth={1}
          />
        </pattern>
        {PLAN_MATERIALS.map((material) => (
          <SurfacePattern key={material} family={MATERIALS[material]} />
        ))}
      </defs>

      {/* The builder's grid, under everything. */}
      <rect
        className="of-plan-grid"
        x={VIEW.x}
        y={VIEW.y}
        width={VIEW.w}
        height={VIEW.d}
        fill={`url(#${gridPatternId})`}
      />

      {/* Painted in build order — floors, then walls, then what stands on them —
          which is also the order the load sequence reveals them in. */}
      <g className="of-plan-floors">
        {PLAN_FLOORS.map((piece, i) => (
          <Piece key={`floor-${String(i)}`} piece={piece} />
        ))}
      </g>
      <g className="of-plan-walls">
        {PLAN_WALLS.map((piece, i) => (
          <Piece key={`wall-${String(i)}`} piece={piece} />
        ))}
      </g>
      <g className="of-plan-fixtures">
        {PLAN_FIXTURES.map((piece, i) => (
          <Piece key={`fixture-${String(i)}`} piece={piece} />
        ))}
      </g>

      <CornerMarks />
    </svg>
  )
}
