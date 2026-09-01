/**
 * Footprint resolution — the single primitive the builder places a tile with.
 *
 * **This is a line-by-line port of `footprint_kind` in
 * `docs/verify-catalog-facts.py`, and it must stay one.** That script's output
 * is the authority for every footprint figure the architecture plan quotes
 * (RECT 3,454 / WALL 3,116 / ARC 1,391 / NONE 741), and `catalog.test.ts` runs
 * the script and compares its table against what this module produces. Any
 * "improvement" made here without making it there first will fail that test.
 *
 * ## What row W3 changed, and what it found
 *
 * The previous version vetoed a footprint on a **curve marker**, by a substring
 * scan over the joined tag string, and its own docblock said making that scan
 * segment-exact "would move the NONE bucket and break the plan's numbers".
 * Measured: **it moves nothing.** Every one of the five markers occurs in the
 * corpus only as a whole `|`-segment — the single near-miss,
 * `shape|option|curved_interface` (111 tags), sits on tiles that also carry a
 * bare `shape|curved`, so the substring scan's false positive is masked. The
 * substring scan flags 2,133 tiles and the segment scan 2,077; the difference is
 * **exactly the 56 `hex` tiles**, and a hex is not a curve
 * ({@link NON_CURVE_TAG_SEGMENTS}).
 *
 * So the veto's problem was never its matching. It was the veto. A curve marker
 * says *the outline is a sector*; it says nothing about whether the width/depth
 * pair describes this file. The corpus states that separately, and explicitly:
 *
 *   - **`size|radius`** — the pair names the design family and the radius names
 *     this fragment (`plain#base+curved+inverted.3x3+2r`). Unchanged, and still
 *     the first test.
 *   - **`size|segment|<letter>`** — the file is one lettered piece of a design
 *     whose size token names the *whole* design. 319 tiles, all of them
 *     curve-marked, 283 of them with a pair and no radius.
 *
 * Both are measured. Bounding boxes taken from the meshes, in catalog units:
 *
 * | tile                                                   | tagged | measured      |
 * | ------------------------------------------------------ | ------ | ------------- |
 * | `cut-stone#floor+curved.4x4`                            | 4 × 4  | 4.000 × 4.000 |
 * | `plain#base+curved.4x4`                                 | 4 × 4  | 4.000 × 4.000 |
 * | `plain#riser+high+curved.1x1`                           | 1 × 1  | 1.000 × 1.000 |
 * | `cave%sandstone+2#corner.IL+corner,270`                 | 1 × 1  | 1.011 × 1.006 |
 * | `dungeon_stone%block#floor+curved+concave.8x8+b`         | 8 × 8  | 4.000 × 4.000 |
 * | `cut-stone#floor+curved+concave.6x6+b`                   | 6 × 6  | 3.000 × 3.000 |
 * | `dungeon_stone%eroded#floor+curved,orthagonal+b.8x8+b`   | 8 × 8  | 2.079 × 1.931 |
 *
 * A curve with no segment letter measures its tagged pair; a segment measures
 * something else entirely, and not by a rule — `8x8+b` is 4 × 4 in one design
 * and 2.079 × 1.931 in another. So the pair is trustworthy exactly when there is
 * no segment letter, which is what {@link footprintKind} now tests. **403 tiles
 * leave NONE, all of them into RECT**, and coverage goes 86.9% → 91.5%.
 *
 * The row predicted 742. That figure is the whole marker-vetoed NONE population,
 * and 339 of it cannot honestly move here: 283 are segment fragments whose real
 * extent only W1's measurement can supply, and 56 are hex corners with no size
 * tag at all — their only tagged dimension is a `size|angle` of 60/120/240/300,
 * which `NON_SWEEP_ANGLES_DEG` exists to say is never a sweep.
 *
 * ## Two things in the port still look wrong and are not
 *
 *   - **`radius` wins over width+depth.** A tile with all three is an arc, not a
 *     rectangle: §2 measured the size tags as design-family *labels* that
 *     diverge from the mesh by a median 96 mm on curves, so on a curve the
 *     width/depth pair names the family the fragment came from.
 *   - **`wall` carries no depth.** Depth is not in the data for any of those
 *     3,116 tiles; it is the measured `WALL_THICKNESS_UNITS` constant, which is
 *     why the schema's `wall` case has no field for a guess to be written into.
 *
 * ## Known imprecision, for W1
 *
 * 26 of the 403 movers are the `shingles#roof,corner+…` set, whose pairs the
 * mesh does not honour in either direction — `,a.3.5x3.5` measures
 * 0.596 × 4.980 and `.1.5x1.5` measures 2.120 × 2.121. They are lettered by
 * `component|a`/`component|b`, not by `size|segment`, and a single-letter last
 * segment is the corpus's variant convention for 25 different tag families
 * (`component|torch|a`, `texture|towne|long_planks|b`, …), so it is not a
 * fragment signal. Blacklisting one texture family is not a classifier fix;
 * measuring the 26 is, and they are inside W1's 921 code-less NONE sweep.
 */
import type { Footprint } from '../src/catalog'

import { numericTagValue } from './tags'
import { CURVE_TAG_SEGMENTS } from './tessellation'

/**
 * Sweep assumed for an arc that carries a radius but no `size|angle`.
 *
 * Most curved bases are quarter sweeps and no angle is tagged for them. The
 * schema's `arc` case requires an angle, so the choice is between a documented
 * default and dropping those tiles out of the arc bucket entirely — and
 * dropping them would move the ARC count away from the verify script's 1,391.
 *
 * W3 did not change its reach: it is still fabricated for the same **165** arc
 * tiles, because W3 moves nothing into or out of ARC. W1 measures them and W4
 * settles them.
 */
export const DEFAULT_ARC_SWEEP_DEG = 90

/**
 * Whether the tile's outline is curved — a **segment-exact** test against W2's
 * {@link CURVE_TAG_SEGMENTS}, which is `curved` / `radial` / `concave` /
 * `convex` and deliberately not `hex`.
 *
 * This is no longer a veto. It is the flag that says a `rect` footprint is an
 * axis-aligned over-approximation of an annular sector rather than the outline
 * itself: 403 of the 3,454 RECT tiles are curve-marked. W5, which reshapes
 * `arc` into a sector, is the row that consumes it.
 *
 * Two false positives it drops relative to the substring scan it replaces. Only
 * the first exists in the corpus today; both are the same mistake.
 *
 *   - `shape|hex` / `shape|base|hex` — 56 tiles. A hex is a different geometry
 *     family with its own primitive, and calling it a curve places hex corners
 *     as bogus arcs.
 *   - a hypothetical `texture|hexagonal`, or any other segment that merely
 *     *contains* a marker. The near-miss the corpus already has is
 *     `shape|option|curved_interface`; it happens to be harmless because those
 *     111 tiles also carry `shape|curved`.
 */
export function hasCurveMarker(tags: readonly string[]): boolean {
  return tags.some((tag) => tag.split('|').some((segment) => CURVE_TAG_SEGMENTS.includes(segment)))
}

/**
 * Whether this file is one lettered piece of a larger design, so that its
 * `size|width` / `size|depth` pair names the design rather than the piece.
 *
 * 319 live tiles carry `size|segment|<letter>`; 36 also carry a radius (which
 * wins, and is this piece's own parameter), leaving **283** whose pair is a
 * label for something they are only part of. The letters are `a` `b` `c` and the
 * composite `ac` `ax` `cx`.
 *
 * Every one of the 319 is curve-marked, so restricting this test to curves would
 * select the same set on today's corpus. It is not restricted, because the fact
 * it encodes — a fragment's size token is its family's — is about the `size|`
 * namespace and not about curvature.
 *
 * Deliberately narrow: `size|segment` is the corpus's *explicit* fragment
 * marker. It is not the same thing as a single-letter last segment, which 25 tag
 * families use as a plain variant suffix.
 */
export function isDesignFragment(tags: readonly string[]): boolean {
  return tags.some((tag) => tag.startsWith('size|segment|'))
}

/** Which of the four cases this tile falls into. Order of tests is the contract. */
export function footprintKind(tags: readonly string[]): Footprint['shape'] {
  const width = numericTagValue(tags, 'size|width')
  const depth = numericTagValue(tags, 'size|depth')
  const radius = numericTagValue(tags, 'size|radius')

  if (radius !== undefined) return 'arc'
  if (isDesignFragment(tags)) return 'none'
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
