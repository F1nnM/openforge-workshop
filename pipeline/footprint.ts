/**
 * Footprint resolution — the single primitive the builder places a tile with.
 *
 * **This is a line-by-line port of `footprint_kind` in
 * `docs/verify-catalog-facts.py`, and it must stay one.** That script's output
 * is the authority for every footprint figure the architecture plan quotes
 * (RECT 3,051 / WALL 3,116 / ARC 1,391 / NONE 1,144), and `facts.test.ts` runs
 * the script and compares its table against what this module produces. Any
 * "improvement" made here without making it there first will fail that test.
 *
 * Three things in the port look wrong and are not:
 *
 *   - **`radius` wins over width+depth.** A tile with all three is an arc, not a
 *     rectangle: §2 measured the size tags as design-family *labels* that
 *     diverge from the mesh by a median 96 mm on curves, so on a curve the
 *     width/depth pair names the family the fragment came from.
 *   - **The curve marker test is a substring scan over the joined tag string**,
 *     not a segment match. `shape|curved|concave`, `shape|base|radial` and
 *     `shape|hex` all hit; so would a hypothetical `texture|hexagonal`. Making
 *     it segment-exact would move the NONE bucket and break the plan's numbers.
 *   - **`wall` carries no depth.** Depth is not in the data for any of those
 *     3,116 tiles; it is the measured `WALL_THICKNESS_UNITS` constant, which is
 *     why the schema's `wall` case has no field for a guess to be written into.
 */
import type { Footprint } from '../src/catalog'

import { numericTagValue } from './tags'

/**
 * Tags whose presence means a width/depth pair does not describe an
 * axis-aligned rectangle. Verbatim from the verify script.
 */
const NON_RECT_MARKERS = ['curved', 'radial', 'concave', 'convex', 'hex'] as const

/**
 * Sweep assumed for an arc that carries a radius but no `size|angle`.
 *
 * Most curved bases are quarter sweeps and no angle is tagged for them. The
 * schema's `arc` case requires an angle, so the choice is between a documented
 * default and dropping those tiles out of the arc bucket entirely — and
 * dropping them would move the ARC count away from the verify script's 1,391.
 */
export const DEFAULT_ARC_SWEEP_DEG = 90

/** The verify script's `is_non_rect`: a substring scan over the joined tags. */
export function hasCurveMarker(tags: readonly string[]): boolean {
  const joined = tags.join(' ')
  return NON_RECT_MARKERS.some((marker) => joined.includes(marker))
}

/** Which of the four cases this tile falls into. Order of tests is the contract. */
export function footprintKind(tags: readonly string[]): Footprint['shape'] {
  const width = numericTagValue(tags, 'size|width')
  const depth = numericTagValue(tags, 'size|depth')
  const radius = numericTagValue(tags, 'size|radius')

  if (radius !== undefined) return 'arc'
  if (hasCurveMarker(tags)) return 'none'
  if (width !== undefined && depth !== undefined) return 'rect'
  if (width !== undefined) return 'wall'
  return 'none'
}

/** The placement primitive, parameterised. */
export function resolveFootprint(tags: readonly string[]): Footprint {
  switch (footprintKind(tags)) {
    case 'arc': {
      const radius = numericTagValue(tags, 'size|radius')
      if (radius === undefined || radius <= 0) return { shape: 'none' }
      return { shape: 'arc', radius, angle: numericTagValue(tags, 'size|angle') ?? DEFAULT_ARC_SWEEP_DEG }
    }
    case 'rect': {
      const w = numericTagValue(tags, 'size|width')
      const d = numericTagValue(tags, 'size|depth')
      if (w === undefined || d === undefined || w <= 0 || d <= 0) return { shape: 'none' }
      return { shape: 'rect', w, d }
    }
    case 'wall': {
      const length = numericTagValue(tags, 'size|width')
      if (length === undefined || length <= 0) return { shape: 'none' }
      return { shape: 'wall', length }
    }
    default:
      return { shape: 'none' }
  }
}

/**
 * The synthesised size token, e.g. `4x4`, `2x`, `2r90`.
 *
 * §6: **the literal string `4x4` appears in zero tags**, so without this the
 * most natural query a user types matches nothing. The forms are the corpus's
 * own filename convention rather than an invention — `aztlan#floor.1x1…`,
 * `…#corner,door.2x…`, `plain#base+curved+inverted.3x3+2r…` — which is what
 * makes them the tokens a user who has seen the files will actually type.
 *
 * The schema deliberately keeps this off `CatalogRecord` because it is
 * derivable from `foot`; it reaches the search index through the display name.
 */
export function sizeToken(foot: Footprint): string | undefined {
  switch (foot.shape) {
    case 'rect':
      return `${formatUnit(foot.w)}x${formatUnit(foot.d)}`
    case 'wall':
      return `${formatUnit(foot.length)}x`
    case 'arc':
      return `${formatUnit(foot.radius)}r${formatUnit(foot.angle)}`
    default:
      return undefined
  }
}

/** `1` not `1.0`, `1.5` not `1.50` — the form the filenames use. */
export function formatUnit(value: number): string {
  return String(Number(value.toFixed(4)))
}
