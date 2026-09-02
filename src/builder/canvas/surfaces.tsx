/**
 * The SVG `<defs>` the plan draws with: the grid, the material surface patterns,
 * the conflict hatch and the refusal hatch.
 *
 * ## Everything is in grid units
 *
 * The canvas's `viewBox` is in grid units (see `viewport.ts`), so a pattern tile
 * of `0.5` is half a grid unit at every zoom level and a material's texture
 * scales with the tiles it fills — which is what it does on a real printed
 * floor. The consequence worth stating: **nothing in this file depends on the
 * camera**, so the defs and every piece drawn with them survive a pan or a zoom
 * without a React re-render. Line weights that need to stay constant on screen
 * use `vector-effect="non-scaling-stroke"` instead of dividing by the scale,
 * which is the same trick for the same reason.
 *
 * ## The surface patterns are the landing hero's
 *
 * `src/screens/landing/HeroPlan.tsx` draws a room in this exact idiom and
 * generates its patterns from the registry's own numbers — `mortar.scale` sets
 * the coursing pitch and `mortar.darken` its strength, `grain.scale` the stipple
 * pitch and `grain.amplitude` its weight. This file reproduces that mapping so
 * the builder and the hero read as the same drawing, which they have to, because
 * the hero's whole justification is that it is a picture of the builder.
 *
 * They are not shared code: `src/screens/landing/` belongs to row 16 and this
 * directory to row 17, and the hero draws in a fixed 40-user-units-per-grid-unit
 * space while the builder draws in grid units directly. Extracting one component
 * would mean parameterising the unit and moving a file out of another PR's
 * ownership. The duplication is ~30 lines and is flagged in both places.
 */
import type { MaterialFamily, MaterialId } from '@/materials'
import { MATERIALS } from '@/materials'

/** One grid unit of grid lines. */
export const GRID_PATTERN_ID = 'of-plan-grid'
/** Half-unit lines, drawn under the unit lines when the zoom can resolve them. */
export const HALF_GRID_PATTERN_ID = 'of-plan-grid-half'
/** Diagonal hatch marking two pieces in the same band and the same square. */
export const CONFLICT_PATTERN_ID = 'of-plan-conflict'
/** Cross-hatch marking a tile the plan view cannot draw. */
export const REFUSAL_PATTERN_ID = 'of-plan-refused'
/**
 * Sparse stipple marking a curve whose outline rests on an unmeasured band rule.
 *
 * 462 of the 1,199 `arc` tiles are `bandBasis: 'fallback'` and they are drawn,
 * not refused (`geometry.ts`, `placementCaveat`) — so the drawing has to say so.
 * Deliberately unlike {@link CONFLICT_PATTERN_ID}: dots rather than lines, the
 * muted ink rather than the accent, and at a quarter of the conflict hatch's
 * density, because this is a provenance note about a legal placement and not a
 * problem to fix. It is a *second* channel, never the only one — the same fact
 * is named in the piece's accessible label, since a stipple is invisible to a
 * screen reader.
 */
export const UNMEASURED_PATTERN_ID = 'of-plan-unmeasured'

export const surfacePatternId = (material: MaterialId): string => `of-plan-surface-${material}`

/**
 * Ceiling on a surface pattern's cell, in grid units — the hero's constant, for
 * the hero's reason: timber's own pitch (`scale` 0.6) is 1.67 units, larger than
 * the 0.5 × 0.5 column it would be drawn on, so the column would receive no
 * texture at all.
 */
const MAX_PATTERN_CELL = 0.6

/** Whether a material has a surface pattern to overlay. Mirrors {@link SurfacePattern}. */
export function hasSurfacePattern(family: MaterialFamily): boolean {
  if (family.surface === 'noise+mortar') return family.mortar !== null
  if (family.surface === 'noise') return family.grain !== null
  return false
}

/**
 * One material's surface treatment.
 *
 * The joint and stipple ink is the material's `edge`, not a computed shade of
 * its `tint`: `edge` is the colour the palette already publishes for "darker
 * than this fill, still this material", so using it keeps the drawing inside the
 * palette instead of inventing values between its entries.
 */
function SurfacePattern({ family }: { family: MaterialFamily }) {
  const id = surfacePatternId(family.id)

  if (family.surface === 'noise+mortar' && family.mortar !== null) {
    const cell = Math.min(1 / family.mortar.scale, MAX_PATTERN_CELL)
    return (
      <pattern id={id} width={cell} height={cell} patternUnits="userSpaceOnUse">
        <path
          d={`M 0 0 H ${String(cell)} M 0 0 V ${String(cell)}`}
          fill="none"
          stroke={family.edge}
          strokeWidth={0.9}
          vectorEffect="non-scaling-stroke"
          opacity={family.mortar.darken}
        />
      </pattern>
    )
  }

  if (family.surface === 'noise' && family.grain !== null) {
    const cell = Math.min(1 / family.grain.scale, MAX_PATTERN_CELL)
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
          // The hero's radius, converted: it draws at 40 user units per grid
          // unit and uses `1 + amplitude * 3`, so the same dot in grid units is
          // this. Keeping the two identical is the point — the builder and the
          // hero have to read as the same drawing.
          r={(1 + family.grain.amplitude * 3) / 40}
          fill={family.edge}
          opacity={0.14 + family.grain.amplitude}
        />
      </pattern>
    )
  }

  return null
}

export interface PlanDefsProps {
  /** The materials actually on the plan. Patterns for the other 14 are not emitted. */
  readonly materials: readonly MaterialId[]
  /** Whether the zoom can resolve half-unit lines. */
  readonly halfGrid: boolean
}

/**
 * Every pattern the plan needs, and only those.
 *
 * Emitting all 16 materials' patterns would cost 32 nodes on an empty canvas;
 * emitting the ones in use costs one pattern per family present, which for a
 * real room is two or three.
 */
export function PlanDefs({ materials, halfGrid }: PlanDefsProps) {
  return (
    <defs>
      {/* Drawn on two edges only, so adjacent cells share a line rather than
          doubling its weight. */}
      <pattern id={HALF_GRID_PATTERN_ID} width={0.5} height={0.5} patternUnits="userSpaceOnUse">
        <path
          d="M 0 0 H 0.5 M 0 0 V 0.5"
          fill="none"
          stroke="var(--line)"
          strokeWidth={0.75}
          strokeDasharray="2 3"
          vectorEffect="non-scaling-stroke"
        />
      </pattern>
      <pattern id={GRID_PATTERN_ID} width={1} height={1} patternUnits="userSpaceOnUse">
        {halfGrid ? <rect x={0} y={0} width={1} height={1} fill={`url(#${HALF_GRID_PATTERN_ID})`} /> : null}
        <path d="M 0 0 H 1 M 0 0 V 1" fill="none" stroke="var(--line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      </pattern>
      <pattern
        id={CONFLICT_PATTERN_ID}
        width={0.34}
        height={0.34}
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(45)"
      >
        <path d="M 0 0 V 0.34" fill="none" stroke="var(--acc)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </pattern>
      <pattern
        id={UNMEASURED_PATTERN_ID}
        width={0.34}
        height={0.34}
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(45)"
      >
        <circle cx={0.17} cy={0.17} r={0.035} fill="var(--mut)" opacity={0.55} />
      </pattern>
      <pattern id={REFUSAL_PATTERN_ID} width={0.25} height={0.25} patternUnits="userSpaceOnUse">
        <path
          d="M 0 0 L 0.25 0.25 M 0.25 0 L 0 0.25"
          fill="none"
          stroke="var(--mut)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      </pattern>
      {materials.map((material) => (
        <SurfacePattern key={material} family={MATERIALS[material]} />
      ))}
    </defs>
  )
}
