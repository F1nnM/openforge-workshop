/**
 * Annular sectors: the one footprint in the union that is **not convex**, and
 * the collision algorithm that makes it safe anyway.
 *
 * ## Why this file exists at all
 *
 * `overlap.ts` is a separating-axis test. SAT is a theorem about *convex* sets:
 * two convex sets are disjoint if and only if some axis separates their
 * projections. An annular sector fails the premise — the chord across its inner
 * arc leaves the region — so feeding a sector's boundary points to SAT does not
 * give a wrong answer occasionally, it gives an answer with no theorem behind it.
 * `src/catalog/schema.ts` reshaped `arc` into `{rIn, rOut, sweep, band,
 * bandBasis}` for 1,199 tiles, and this file is what the builder needs before it
 * can place one.
 *
 * ## The local frame, and where the arc centre sits
 *
 * A sector is stated in a frame whose origin is the **minimum corner of its own
 * bounding box**, so that it composes with every other footprint through the one
 * anchoring rule `geometry.ts` sets out. In that frame the arc centre is at
 * `(-rIn·cos θ, 0)` and the region is
 *
 * ```
 *   { (r·cos φ − rIn·cos θ, r·sin φ)  |  r ∈ [rIn, rOut],  φ ∈ [0, θ] }
 * ```
 *
 * which puts the box at `[0, rOut − rIn·cos θ] × [0, rOut·sin θ]` — exactly
 * {@link arcSectorExtent}, and exactly `arcSectorExtent` in
 * `pipeline/tessellation.ts`, verified there to ±0.002 units against 8
 * independent plain-base samples. The two are the same two lines of arithmetic
 * on purpose; `src/**` never imports `pipeline/**`, so the alternative to
 * restating them is for the builder to have no sector box at all.
 *
 * **The centre is only *at* the box corner when the sweep is 90° or the inner
 * radius is 0.** `src/catalog/schema.ts` describes it as sitting at a corner,
 * which holds for the 554 sectors at 90° (`cos 90° = 0`) and for the 43 with
 * `rIn = 0`; for the other sweeps it sits `rIn·cos θ` outside the box's left
 * edge. That offset is why {@link sectorCentre} is a function and not the
 * anchor.
 *
 * ## The collision approach: an outward convex decomposition
 *
 * The sweep is cut into `n` sub-sectors and each sub-sector is replaced by the
 * **smallest convex quadrilateral that provably contains it**: the wedge between
 * the two bounding radii, clipped by the *tangent* line to the outer arc at the
 * sub-sector's mid-angle and by the *chord* across its inner arc.
 *
 * ```
 *          tangent at φm                        each part is the intersection of
 *        ·─────────────────·                    three half-planes — a wedge and
 *         ╲               ╱                     two lines — so it is convex, and
 *          ╲   outer arc ╱                      its four vertices are exactly the
 *           ╲ ,-‾‾‾‾‾-, ╱                       four crossings drawn here
 *            ·`       `·
 *             ╲       ╱   ← inner chord (cuts *inside* the material, so
 *              ·─────·       including the sliver over-covers, never under-)
 *               ╲   ╱
 *                ╲ ╱
 *                 ·  arc centre
 * ```
 *
 * Three facts make this the right trade, and all three are proved rather than
 * asserted — `sector.test.ts` checks each one numerically:
 *
 *   1. **Each part contains its sub-sector.** Project any point of the
 *      sub-sector onto the mid-angle bisector: the projection is
 *      `r·cos(φ − φm)`, which is at most `rOut` (so the point is inside the
 *      tangent line) and at least `rIn·cos(Δ/2)` (so it is outside the inner
 *      chord), and `φ ∈ [φ0, φ1]` puts it in the wedge. Hence
 *      **parts ⊇ sector**, always.
 *   2. **The error is one-directional.** Because the union of the parts is a
 *      *superset* of the sector, SAT over the parts can only ever report an
 *      overlap the true sectors do not have. It can never miss one. A false
 *      positive costs a warning the user can ignore; a false negative would ship
 *      a room whose pieces cannot both be printed into the same square. See
 *      {@link sectorSlack} for the magnitude.
 *   3. **The magnitude is bounded and small.** The parts extend past the outline
 *      by at most `rOut·(sec(Δ/2) − 1)` outward and `rIn·(1 − cos(Δ/2))` inward,
 *      and the second is always the smaller. Subdividing to
 *      {@link SECTOR_TOLERANCE_UNITS} bounds the first by construction: across
 *      all 1,199 arc tiles the worst realised slack is **0.009677 units = 0.2458
 *      mm**, over 8,359 convex parts in total (mean 6.97 per sector, worst 14).
 *
 * ## What was rejected, and why
 *
 *   - **An exact sector-versus-sector test.** It is writable — arc/arc, arc/segment
 *     and containment, plus the case of one sector wholly inside another — but it
 *     is a large amount of code whose degenerate cases (tangency, concentric
 *     arcs, equal radii, a zero-width band) fail in *both* directions. An
 *     approximation whose error direction is proved is worth more here than an
 *     exact algorithm whose error direction is "whichever branch is wrong".
 *   - **The bounding box alone.** A 90° sector fills 78.5% of its box; a 22.5°
 *     one at `rIn = 4, rOut = 4.5` fills 11.4%. Two curved walls facing each
 *     other across a corridor would be reported as colliding on the strength of
 *     boxes that touch where neither piece is.
 *   - **Inscribed chords instead of tangents.** Cheaper by nothing, and it flips
 *     the error to under-approximation — the direction that ships an unprintable
 *     room. This is the same choice `pipeline/footprint.ts` makes when it keeps a
 *     trusted over-approximation rather than fabricating a sector.
 *
 * The box reject in `overlap.ts` stays on the **exact** box rather than the
 * parts' slightly larger one, and that is safe in the same direction: a true
 * overlap implies the exact boxes overlap, so rejecting on them never discards a
 * real conflict — it only prunes envelope-only contacts, which *reduces* the
 * false positives.
 */
import type { ArcFootprint } from '@/catalog'

import type { Extent, PlanPoint } from './geometry'

/**
 * How far, in grid units, a sector's collision decomposition may extend beyond
 * the sector itself.
 *
 * 0.01 units is **0.254 mm**: a hundredth of the 25.4 mm grid unit and a
 * fiftieth of the 12.70 mm wall thickness. It is the width of the band in which
 * this module may warn about a contact that is not quite there; two pieces that
 * clear each other by more than that are never falsely flagged, and the 0.5-unit
 * snap cannot put two pieces inside it deliberately.
 *
 * The cost curve is why it is not smaller. Across the corpus's 1,199 sectors,
 * 0.02 buys 6,273 convex parts, 0.01 buys 8,359 and 0.005 buys 11,935 — so
 * halving it again costs 43% more SAT work to narrow a warning band the 0.5-unit
 * snap already cannot address.
 */
export const SECTOR_TOLERANCE_UNITS = 0.01

/**
 * Cosine and sine of an angle in **degrees**, exact on the quarter turns.
 *
 * `Math.cos(Math.PI / 2)` is 6.1e-17, not 0, and 554 of the corpus's 1,199
 * sectors sweep exactly 90° — where `rIn·cos θ` is the arc centre's offset from
 * the box corner and has to be *exactly* zero for the piece to sit on the
 * lattice. `geometry.ts` refuses trigonometric residue in `rotatedExtent` for
 * the same reason and by the same means: special-case the exact angles rather
 * than tolerate a value that makes two pieces look flush and compare unequal.
 */
function cosDeg(degrees: number): number {
  const folded = ((degrees % 360) + 360) % 360
  if (folded === 0) return 1
  if (folded === 90 || folded === 270) return 0
  if (folded === 180) return -1
  return Math.cos((degrees * Math.PI) / 180)
}

function sinDeg(degrees: number): number {
  const folded = ((degrees % 360) + 360) % 360
  if (folded === 0 || folded === 180) return 0
  if (folded === 90) return 1
  if (folded === 270) return -1
  return Math.sin((degrees * Math.PI) / 180)
}

/**
 * The bounding box of an annular sector in its own frame.
 *
 * `w = rOut − rIn·cos θ`, `d = rOut·sin θ`. See the module docblock: this is
 * `arcSectorExtent` in `pipeline/tessellation.ts`, restated because `src/**`
 * cannot import `pipeline/**`. Valid for `θ ≤ 90°`, which
 * `MAX_SECTOR_SWEEP_DEG` makes a parse-time guarantee rather than a convention.
 */
export function arcSectorExtent(rIn: number, rOut: number, sweepDeg: number): Extent {
  return { w: rOut - rIn * cosDeg(sweepDeg), d: rOut * sinDeg(sweepDeg) }
}

/**
 * The arc centre, in the sector's own box-anchored frame.
 *
 * `x` is negative for every sector with an inner radius and a sweep under 90°,
 * because the centre of curvature is then *outside* the piece's bounding box.
 * The consequence is worth stating where a reader will meet it: two concentric
 * sub-90° sectors share a centre only if their anchors differ by `rIn·cos θ`,
 * which is irrational for the corpus's 45°, 22.5° and 11.25° sweeps and so is
 * not reachable on the 0.5 snap. Those pieces draw and collide correctly; what
 * the snap cannot do is *mate* two of them concentrically without free
 * positioning. At 90° the offset is exactly 0 and mating is on the lattice.
 */
export function sectorCentre(foot: ArcFootprint): PlanPoint {
  // `+ 0` for the same reason `snapTo` does it: at a 90° sweep the product is
  // exactly zero and `-1 * 0` is `-0`, which does not survive `JSON.stringify`.
  return [-foot.rIn * cosDeg(foot.sweep) + 0, 0]
}

/**
 * How many convex parts this sector is cut into.
 *
 * Solved from the tolerance rather than fixed: the outward slack of one part is
 * `rOut·(sec(Δ/2) − 1)`, so requiring it to stay under `SECTOR_TOLERANCE_UNITS`
 * gives `Δ ≤ 2·acos(rOut / (rOut + tol))`. A fixed angular step would instead
 * hold the *angle* constant and let the slack grow with the radius — 3× larger
 * at `rOut = 6` than at `rOut = 2`, and `rOut = 6` is where the corpus's 76
 * widest curves are.
 */
export function sectorSubdivisions(rOut: number, sweepDeg: number): number {
  const maxStepRad = 2 * Math.acos(rOut / (rOut + SECTOR_TOLERANCE_UNITS))
  const maxStepDeg = (maxStepRad * 180) / Math.PI
  return Math.max(1, Math.ceil(sweepDeg / maxStepDeg))
}

/**
 * The proved upper bound, in grid units, on how far {@link sectorParts} reaches
 * beyond the sector's true outline.
 *
 * Outward by `rOut·(sec(Δ/2) − 1)` past the outer arc and inward by
 * `rIn·(1 − cos(Δ/2))` past the inner one. The first dominates for every
 * sector — `sec x − 1 = (1 − cos x)/cos x ≥ 1 − cos x` and `rIn < rOut` — so one
 * number bounds both, and it is the number a caller should quote when it wants
 * to say how far this module may be wrong.
 */
export function sectorSlack(rOut: number, sweepDeg: number): number {
  const half = sweepDeg / sectorSubdivisions(rOut, sweepDeg) / 2
  return rOut * (1 / cosDeg(half) - 1)
}

/** A point on a ray from the sector's centre, in the local frame. Degrees, so the quarter turns stay exact. */
function at(centre: PlanPoint, radius: number, angleDeg: number): PlanPoint {
  return [centre[0] + radius * cosDeg(angleDeg) + 0, centre[1] + radius * sinDeg(angleDeg) + 0]
}

/**
 * Below this the inner radius is treated as zero and a part becomes a triangle.
 *
 * Not a fudge for near-zero radii: the schema admits `rIn` of *exactly* 0 for a
 * `disc` band and for `radial` at R = 2, where `R − 2` degenerates, and 43 tiles
 * take it. A degenerate quad with two coincident vertices would in fact survive
 * SAT — `overlap.ts` skips zero-length edges — but emitting the triangle says
 * what the shape is instead of relying on that.
 */
const ZERO_RADIUS = 1e-9

/**
 * The sector as convex parts, in its own box-anchored frame.
 *
 * Their union strictly contains the sector and exceeds it by at most
 * {@link sectorSlack}. This is the geometry `overlap.ts` tests; the geometry the
 * user *sees* is {@link sectorPath}, which is exact.
 */
export function sectorParts(foot: ArcFootprint): readonly (readonly PlanPoint[])[] {
  const centre = sectorCentre(foot)
  const count = sectorSubdivisions(foot.rOut, foot.sweep)
  const step = foot.sweep / count
  const outer = foot.rOut / cosDeg(step / 2)
  const solid = foot.rIn <= ZERO_RADIUS
  const parts: (readonly PlanPoint[])[] = []

  for (let i = 0; i < count; i += 1) {
    const from = i * step
    const to = from + step
    parts.push(
      solid
        ? [centre, at(centre, outer, from), at(centre, outer, to)]
        : [
            at(centre, foot.rIn, from),
            at(centre, outer, from),
            at(centre, outer, to),
            at(centre, foot.rIn, to),
          ],
    )
  }

  return parts
}

/** Path coordinates, rounded so the `d` string is short and byte-stable across renders. */
function fixed(value: number): string {
  return String(Math.round(value * 1e5) / 1e5 + 0)
}

/**
 * The sector as an SVG path `d`, in its own box-anchored frame — **exact**.
 *
 * Two `A` commands and two straight sides, so what is drawn is the annulus
 * rather than the 7-to-14 facets the collision test uses. Drawing the
 * decomposition would show the user a piece 0.25 mm too big and a faceted arc,
 * and `src/catalog/schema.ts`'s whole argument for reshaping `arc` was that an
 * outline the user can see must not be a shape nobody measured.
 *
 * The large-arc flag is always 0 (`MAX_SECTOR_SWEEP_DEG` bounds the sweep at
 * 90°) and the sweep flags are 1 outward, 0 back: SVG's positive-angle direction
 * is increasing φ in this frame, because `z` and SVG's `y` both grow downward.
 */
export function sectorPath(foot: ArcFootprint): string {
  const centre = sectorCentre(foot)
  const theta = foot.sweep
  const [ox, oz] = at(centre, foot.rOut, 0)
  const [fx, fz] = at(centre, foot.rOut, theta)
  const head = `M ${fixed(ox)} ${fixed(oz)} A ${fixed(foot.rOut)} ${fixed(foot.rOut)} 0 0 1 ${fixed(fx)} ${fixed(fz)}`

  if (foot.rIn <= ZERO_RADIUS) return `${head} L ${fixed(centre[0])} ${fixed(centre[1])} Z`

  const [ix, iz] = at(centre, foot.rIn, theta)
  const [jx, jz] = at(centre, foot.rIn, 0)
  return `${head} L ${fixed(ix)} ${fixed(iz)} A ${fixed(foot.rIn)} ${fixed(foot.rIn)} 0 0 0 ${fixed(jx)} ${fixed(jz)} Z`
}
