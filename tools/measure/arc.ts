/**
 * Fitting an annular sector to a mesh — and refusing to, when it is not one.
 *
 * ## What has to come out, and why a bounding box cannot supply it
 *
 * `architecture-plan.md` §2 says the curved primitive is
 * `(centre, innerRadius, outerRadius, startAngle, sweep)`. None of inner radius,
 * outer radius or sweep is recoverable from an axis-aligned box: the box of a
 * quarter annulus at `[2, 4]` and the box of a quarter disc at `[0, 4]` differ,
 * but the box of a 45° sector and the box of a differently-oriented 60° sector
 * can coincide exactly. `openlock-tessellation.md` §4 recovers `(Rin, Rout)` from
 * a box only by *assuming* the sweep from the tag and the centre from a box
 * corner. This row exists because 292 tiles have no band tag and 165 have no
 * angle tag, so neither assumption is available. The geometry has to be fitted.
 *
 * ## The method, in five steps
 *
 * 1. **Pick the plane by fitting all three.** OpenForge tiles are expected to be
 *    authored with the sector in XY and the extrusion in Z, but that is
 *    *checked*, not assumed: the fit runs on `xy`, `xz` and `yz` and the
 *    plane that actually produces an accepted sector is the one reported.
 * 2. **Seed the centre.** §4 found the centre at a corner of the bounding box.
 *    That is true only for a sweep of at most 90° *starting on an axis*, and it
 *    is not a property this row may assume — a 90° sector starting at 23.5°
 *    has its centre outside its own bounding box entirely, and a thin 11.25°
 *    band at radius 6 has it six units away. So the primary seed is the
 *    **median circumcentre of convex-hull triples**, at two spacings: an annular
 *    sector's *outer* arc lies on its convex hull, every triple along it agrees
 *    on the centre, and the two straight radial edges contribute near-collinear
 *    triples that the radius filter discards. §4's box corners, the box centre,
 *    **the origin** — checked, never assumed — and a coarse 9×9 grid over the
 *    box are kept as fallback seeds.
 * 3. **Score a candidate centre by edge sharpness.** Radii about the candidate
 *    are histogrammed at {@link RADIAL_BIN_MM}; the score is the share of
 *    vertices falling in the lowest and highest occupied bins. About the true
 *    centre those two bins hold the inner and outer arcs, which is where a
 *    tessellated annulus puts most of its vertices; about a wrong centre the
 *    extreme radii are attained by a handful of points and the score collapses.
 *    This works on sculpted tiles too, because the inner and outer *walls* of a
 *    curved tile are vertical surfaces whatever the top surface does.
 * 4. **Refine by a two-radius concentric fit.** Vertices near the two extreme
 *    radii are assigned to an inner and an outer circle, and the centre is moved
 *    by Gauss-Newton on `|p − c| − R` — the standard concentric-circle
 *    least-squares, alternating with re-estimating the two radii. The best four
 *    seeds are each refined, and the distinct results are separated on step 5's
 *    test rather than on a proxy for it: two centres can both score a perfect
 *    edge sharpness while one reproduces the measured box to 0 mm and the other
 *    to 0.06 mm.
 * 5. **Accept only on a reconstruction test.** From the fitted
 *    `(c, Rin, Rout, start, sweep)` the sector's *own* bounding box is computed
 *    analytically and compared with the mesh's measured box in that plane. This
 *    is the orientation-independent generalisation of §4's
 *    `bboxX = Rout − Rin·cos θ`, and it is the check that a straight wall, an
 *    L-shape or a hex fails. A mesh that fails it is returned as `'rejected'`
 *    with its residual, never fitted anyway.
 * 6. **Measure how well the radii are actually determined.** The model has a
 *    nearly flat direction — slide the centre along the sector's bisector by δ
 *    and shrink both radii by δ and you get an almost identical sector with an
 *    almost identical bounding box. So step 5 cannot catch an error in that one
 *    direction, and {@link radialTolerance} measures it instead, per mesh, by
 *    walking δ until the residual doubles. That number ships beside the radii as
 *    `radiusToleranceMm`, and it is the field row **W5** has to consult before
 *    trusting a band: it is a few hundredths of a millimetre at a 90° sweep and
 *    over a millimetre at 11.25°.
 *
 * `Rin` and `Rout` are finally taken as the **min and max vertex radius about
 * the refined centre over every vertex**, not from the least-squares radii —
 * §4 did the same, and a footprint needs the extent the mesh actually occupies
 * rather than the extent of its best-fit idealisation.
 *
 * ## Assumptions, stated
 *
 *   - The sector lies in one axis-aligned plane and extrudes along the third
 *     axis. A sector tilted off-axis would score badly on all three planes and
 *     be rejected; none was found.
 *   - The centre is **not** assumed to be at the origin, at a box corner, or
 *     inside the bounding box at all.
 *     `centreOffsetMm` records how far off the origin the fitted centre landed
 *     so the assumption can be audited from the sidecar rather than trusted.
 *   - Coordinates are Float32, because that is what binary STL stores.
 *     Quantisation is relative, so the fit degrades with the mesh's distance from
 *     the origin *and* with how short the arc is; the same synthetic band that
 *     fits exactly at the origin was out by 4.9 mm with its centre 2,236 mm away.
 *     Points are recentred on their bounding box before fitting to keep the
 *     arithmetic from making that worse, and `radiusToleranceMm` reports what
 *     remains rather than hiding it.
 *   - Vertex density along the arcs is high enough for the extreme radial bins
 *     to be populated. A four-facet arc approximation would defeat step 3;
 *     `onArcFraction` reports what actually happened and the acceptance
 *     threshold is explicit.
 *   - A sweep is the *minimal covering arc* of the vertex angles. A mesh with a
 *     genuine angular hole inside its sweep is reported through `angularGapDeg`
 *     rather than silently widened.
 */
import { MM_PER_UNIT, round } from './extent'

/** Which pair of axes the sector was fitted in. */
export type SectorPlane = 'xy' | 'xz' | 'yz'

/** Every plane the fit is tried in, in the order it tries them. */
export const SECTOR_PLANES: readonly SectorPlane[] = ['xy', 'xz', 'yz']

/** Radial histogram bin, mm. 0.2 mm is fine against a 12.7 mm wall thickness. */
export const RADIAL_BIN_MM = 0.2

/** How close to a fitted radius a vertex counts as "on the arc", mm. */
export const ON_ARC_TOL_MM = 0.5

/**
 * Minimum share of vertices on the two arcs for a fit to be believed.
 *
 * Sculpted tiles put most of their vertices on the top surface, so this cannot
 * be high. It is a sanity floor, not the acceptance test — that is
 * {@link BBOX_RESIDUAL_TOL_MM}.
 */
export const MIN_ON_ARC_FRACTION = 0.08

/**
 * How far the reconstructed sector's box may sit from the measured box, mm.
 *
 * `openlock-tessellation.md` §6 measured untextured `plain#base` parts landing on
 * exact 25.4 mm multiples with no residual, and textured tiles running 0.1–1.0 mm
 * off nominal because surface displacement moves the extreme vertex. 1.5 mm
 * therefore admits every sculpted sector while still rejecting a shape that is
 * not a sector at all — a straight wall misfits by tens of millimetres.
 */
export const BBOX_RESIDUAL_TOL_MM = 1.5

/** A sweep at least this wide is reported as a full annulus, not a sector. */
export const FULL_ANNULUS_DEG = 359

/**
 * Vertices closer to the fitted centre than this contribute no angle.
 *
 * A quarter *disc* — `radial` at `[0, R]`, which is 365 of the corpus's arc
 * tiles at `2r90` alone — has real vertices **at** the centre, and the angle of a
 * vertex 30 nanometres from the centre is numerical noise. Left in, those few
 * vertices drag the covering arc from 90° to 280° and the reconstruction test
 * then rejects a perfectly good quarter disc. So the angular extent is taken from
 * vertices at a radius of at least `max(ANGLE_MIN_RADIUS_MM, 2% of Rout)`, and
 * the radial extent — which those vertices *do* determine — still uses all of
 * them.
 */
export const ANGLE_MIN_RADIUS_MM = 0.5

/**
 * A gap only counts as the sector's opening when it dominates the spacing
 * between neighbouring vertex angles by this factor.
 *
 * Without it a closed annulus is reported as a `360 − 360/segments` sector: its
 * largest angular gap is just the tessellation step. With it, a gap that is
 * merely one step wide is recognised as no gap at all. The limitation is
 * explicit: a genuine sector sweeping within one tessellation step of 360° is
 * reported as an annulus, and no such tile exists in this corpus.
 */
export const ANNULUS_GAP_RATIO = 1.5

/** Vertices used for the coarse centre search. Enough for a 0.2 mm histogram. */
const COARSE_SAMPLE = 8_000

/** Vertices used for Gauss-Newton refinement. */
const REFINE_SAMPLE = 40_000

/** Gauss-Newton iterations. Converges in far fewer; the cap is a safety net. */
const REFINE_ITERATIONS = 30

/** Seeds carried from the coarse search into refinement. Each yields two candidates. */
const SEEDS_REFINED = 6

/** Vertices used for the rotating-calipers orientation scan. */
const STRIP_SAMPLE = 20_000

/** Vertices used for the radial-tolerance walk. A statistic, so a subsample is enough. */
const TOLERANCE_SAMPLE = 20_000

/**
 * Vertices used to rank candidate centres and planes.
 *
 * Only the *choice* rides on this; the reported numbers come from the single
 * exact evaluation that follows. See {@link fitAnnularSector} for why.
 */
const EVALUATE_SAMPLE = 60_000

/**
 * How much larger than the box diagonal a hull triple's circumradius may be
 * before the triple is treated as collinear and discarded.
 *
 * The straight radial edges of a sector produce triples whose circumradius runs
 * to infinity; the outer arc produces triples at the real radius. A sector of
 * 11.25° at radius 6 has a box diagonal of about 1.2 units against a radius of 6,
 * so the cutoff has to be generous — 200× admits every band in the corpus and
 * still discards a genuinely straight run.
 */
const MAX_CIRCUMRADIUS_RATIO = 200

/**
 * Residual growth factor that defines the radial uncertainty interval.
 *
 * {@link radialTolerance} slides the fitted centre along the sector's bisector
 * and reports how far it can go before the on-arc residual grows by this factor.
 * Two is the conventional "clearly worse than the fit" threshold and needs no
 * distributional assumption, which a chi-squared interval would.
 */
export const RESIDUAL_GROWTH_FACTOR = 2

/** Floor on the residual scale, mm, so a perfect synthetic fit still admits an interval. */
export const RESIDUAL_FLOOR_MM = 1e-4

/**
 * Calibrated multiplier on the identifiability interval, so it is a bound rather
 * than a one-sigma.
 *
 * The walk measures how far the sector can slide before it stops fitting. The
 * fit's *actual* error also contains a bias from Float32 vertex quantisation,
 * which is invisible to any self-consistency check: the displaced sector is
 * internally consistent, just displaced. Measured against 80 synthetic sectors of
 * known radii, the raw interval understated the true error by at most **4.63×**
 * (median 0.29×). Eight covers all 80 with margin, and is calibrated against that
 * table rather than assumed.
 */
export const SECTOR_TOLERANCE_SAFETY = 8

/**
 * Multiple of the on-arc RMS residual that the radial interval never falls below.
 *
 * The walk measures the flat direction only. Float32 quantisation also biases the
 * fitted radii, and that bias is invisible to the walk but visible in the
 * residual. Four covers it on every synthetic case measured.
 */
export const RESIDUAL_FLOOR_FACTOR = 8

/** Diagnostics every outcome carries, so a rejection is as informative as a fit. */
export interface SectorDiagnostics {
  plane: SectorPlane
  /** Fitted centre in mesh coordinates (mm), in the fitted plane's two axes. */
  centreMm: readonly [number, number]
  /** Distance from the mesh's origin to the fitted centre, mm. Audits the §4 assumption. */
  centreOffsetMm: number
  /** Share of vertices within {@link ON_ARC_TOL_MM} of either fitted radius. */
  onArcFraction: number
  /** RMS radial residual of those vertices, mm. */
  radialRmsMm: number
  /** Worst face disagreement between the reconstructed sector box and the measured box, mm. */
  bboxResidualMm: number
  /** Largest empty angular gap inside the fitted sweep, degrees. 0 for a solid sector. */
  angularGapDeg: number
  /** Vertices the fit used. */
  vertices: number
  /**
   * How well the two radii are actually determined, in millimetres.
   *
   * **The number W5 must read before trusting a band.** An annular sector's
   * fit has a nearly flat direction: sliding the centre along the sector's
   * bisector by δ and reducing both radii by δ leaves almost the same residuals
   * and almost the same bounding box. How flat depends on the sweep — for a 90°
   * sector the direction is well pinned and this is a few hundredths of a
   * millimetre; for an 11.25° band it is over a millimetre, and binary STL's
   * Float32 coordinates are not precise enough to do better.
   *
   * Measured per mesh by {@link radialTolerance}, not modelled, and deliberately
   * **conservative** — see {@link SECTOR_TOLERANCE_SAFETY}. Across the corpus it
   * runs a few millimetres while `bboxResidualMm` runs a few hundredths, so it is
   * a bound and not an estimate of the typical error.
   *
   * **Which field to use for what.** The degenerate direction moves both radii
   * *together*, so `outerRadiusUnits − innerRadiusUnits` is far better determined
   * than either endpoint: measured across the corpus the band widths land on
   * 0.50, 2.00 and 4.00 units — the wall thickness and the radial floor width
   * `openlock-tessellation.md` §4 names — with no spread. So W5 should key a band
   * on `bandUnits` and `sweepDeg`, and treat this as the bound on where the pair
   * sits in absolute terms.
   */
  radiusToleranceMm: number
}

/** The fitted primitive, when the mesh is one. */
export interface SectorFit extends SectorDiagnostics {
  fit: 'sector' | 'annulus'
  innerRadiusUnits: number
  outerRadiusUnits: number
  /** `outer - inner` — the band `openlock-tessellation.md` §4 tabulates. */
  bandUnits: number
  /** Where the sweep starts, degrees CCW from the plane's first axis. */
  startDeg: number
  /** Angular extent, degrees. 360 for `fit: 'annulus'`. */
  sweepDeg: number
}

/** Why a mesh is not an annular sector. */
export type SectorRejection =
  | 'no-vertices'
  | 'degenerate-band'
  | 'few-arc-vertices'
  | 'box-mismatch'

/** The mesh is not an annular sector, with the numbers that say so. */
export interface SectorRefusal extends SectorDiagnostics {
  fit: 'rejected'
  reason: SectorRejection
  /** The best-fit numbers, kept for diagnosis. **Not** a footprint. */
  innerRadiusUnits: number
  outerRadiusUnits: number
  sweepDeg: number
  /** Oriented strip the footprint looks like instead, when it looks like one. */
  strip?: StripFit
}

export type SectorResult = SectorFit | SectorRefusal

/**
 * The oriented bounding box of the 2D footprint, from its principal axes.
 *
 * Reported on a rejection because it is the answer for the one family this row
 * has to settle by name: `openlock-tessellation.md` §7 measured `AxG`, `BAxG`
 * and `QxG` as *straight 0.5-thick walls*, so a rejection that also says
 * "3.000 × 0.500 at 0°" is the finding, not a shrug.
 */
export interface StripFit {
  lengthUnits: number
  widthUnits: number
  /** Orientation of the long axis, degrees CCW from the plane's first axis, in [0, 180). */
  angleDeg: number
  /** RMS distance of vertices from the strip's own box, mm. Small for a real strip. */
  residualMm: number
}

/** 2D point list, flat: `[x0, y0, x1, y1, …]`. */
type Points = Float64Array

/**
 * Fit an annular sector to a parsed mesh, trying all three axis planes.
 *
 * Returns the best-scoring plane's outcome. When no plane yields an accepted
 * sector, the `xy` rejection is returned so the sidecar records *why*.
 *
 * ## Two stages, because the corpus has 1.45-million-facet meshes
 *
 * Ranking a dozen candidate centres in three planes means ~36 evaluations, and an
 * evaluation sorts the vertex angles — on the largest mesh in the work list that
 * is 4.35 million doubles sorted 36 times, which measured **88 seconds for one
 * tile**. So candidates are ranked on a bounded subsample and exactly **one**
 * evaluation runs over every vertex, on the winning plane's winning centre. The
 * numbers reported are that exact one; the subsample only decides which centre
 * to spend it on.
 */
export function fitAnnularSector(positions: Float32Array, triangles: number): SectorResult {
  if (triangles <= 0) return refusalWithNoData('xy')

  let best: { plane: SectorPlane; centre: readonly [number, number]; score: number } | undefined
  for (const plane of SECTOR_PLANES) {
    // Recentre on the bounding box before fitting. The circumcentre determinant
    // is a difference of squared coordinates, so it loses most of its significant
    // digits on a mesh authored far from the origin: measured on a synthetic
    // 11.25° band whose centre sits 2,236 mm out, the un-recentred fit was wrong
    // by 4.9 mm. Translation is exact in binary floating point for a
    // representable shift, so this costs nothing and is not a heuristic.
    const points = project(positions, triangles, plane)
    const shift = recentre(points)
    const bbox = bounds2d(points)
    const centre = chooseCentre(points, bbox, plane, shift)
    if (centre === undefined) continue
    const preview = evaluate(subsample(points, EVALUATE_SAMPLE), bbox, centre, plane, shift, false)
    const score = rank(preview)
    if (best === undefined || score > best.score) best = { plane, centre, score }
  }
  if (best === undefined) return refusalWithNoData('xy')

  const points = project(positions, triangles, best.plane)
  const shift = recentre(points)
  return evaluate(points, bounds2d(points), best.centre, best.plane, shift, true)
}

/**
 * Accepted beats rejected, and a smaller reconstruction residual wins among
 * accepted fits.
 *
 * Every rejection ranks **equal**, so the first plane tried wins a tie and the
 * reported rejection is always the `xy` one. That is deliberate: for a shape that
 * is not a sector in any plane the plane label carries no information, and
 * ranking rejections by residual picked whichever projection happened to be
 * squarest — which reported the `xG` walls' *elevation* rather than their
 * footprint.
 */
function rank(result: SectorResult): number {
  return result.fit === 'rejected' ? 0 : 1_000_000 - result.bboxResidualMm
}

function refusalWithNoData(plane: SectorPlane): SectorRefusal {
  return {
    fit: 'rejected',
    reason: 'no-vertices',
    plane,
    centreMm: [0, 0],
    centreOffsetMm: 0,
    onArcFraction: 0,
    radialRmsMm: 0,
    bboxResidualMm: Infinity,
    angularGapDeg: 0,
    vertices: 0,
    radiusToleranceMm: Infinity,
    innerRadiusUnits: 0,
    outerRadiusUnits: 0,
    sweepDeg: 0,
  }
}

/** Vertex coordinates in one axis plane, every vertex of every facet. */
export function project(positions: Float32Array, triangles: number, plane: SectorPlane): Points {
  const [u, v] = plane === 'xy' ? [0, 1] : plane === 'xz' ? [0, 2] : [1, 2]
  const count = triangles * 3
  const out = new Float64Array(count * 2)
  for (let vertex = 0; vertex < count; vertex += 1) {
    const at = vertex * 3
    out[vertex * 2] = positions[at + u] as number
    out[vertex * 2 + 1] = positions[at + v] as number
  }
  return out
}

/* ------------------------------------------------------------------ the fit */

/** Shift a point list so its bounding box is centred on the origin. Returns the shift. */
export function recentre(points: Points): readonly [number, number] {
  const bbox = bounds2d(points)
  const shift = [bbox.midU, bbox.midV] as const
  for (let index = 0; index < points.length; index += 2) {
    points[index] = (points[index] as number) - shift[0]
    points[index + 1] = (points[index + 1] as number) - shift[1]
  }
  return shift
}

/**
 * The centre to spend the exact evaluation on.
 *
 * Seeds, refinement, and a ranking pass over a bounded subsample — everything up
 * to but not including the one full-precision evaluation.
 */
function chooseCentre(
  points: Points,
  bbox: Bounds2d,
  plane: SectorPlane,
  shift: readonly [number, number],
): (readonly [number, number]) | undefined {
  const count = points.length / 2
  if (count === 0) return undefined

  const coarse = subsample(points, COARSE_SAMPLE)
  const refine = subsample(points, REFINE_SAMPLE)
  const ranking = subsample(points, EVALUATE_SAMPLE)

  const scored = seedCentres(bbox, coarse)
    .map((seed) => ({ seed, score: sharpness(coarse, seed) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, SEEDS_REFINED)

  const candidates: (readonly [number, number])[] = []
  const consider = (centre: readonly [number, number]): void => {
    if (!Number.isFinite(centre[0]) || !Number.isFinite(centre[1])) return
    const near = candidates.some(
      (existing) => Math.abs(existing[0] - centre[0]) < 1e-3 && Math.abs(existing[1] - centre[1]) < 1e-3,
    )
    if (!near) candidates.push(centre)
  }
  for (const { seed } of scored) {
    // Both the seed and its refinement. Gauss-Newton minimises radial residual,
    // which a lock cutout or a chamfer can bias away from the centre that
    // actually reproduces the measured box — and the box is the acceptance test.
    // Measured on real `plain#base` curves, keeping the unrefined seed as a
    // candidate is what recovers an exact `[2, 4]` where refinement landed on
    // `[1.964, 3.975]`.
    consider(seed)
    consider(refineCentre(refine, seed))
  }
  if (candidates.length === 0) return [bbox.midU, bbox.midV]

  let bestCentre = candidates[0] as readonly [number, number]
  let bestScore = -Infinity
  for (const centre of candidates) {
    const score = rank(evaluate(ranking, bbox, centre, plane, shift, false))
    if (score > bestScore) {
      bestScore = score
      bestCentre = centre
    }
  }
  return bestCentre
}

interface Bounds2d {
  minU: number
  maxU: number
  minV: number
  maxV: number
  midU: number
  midV: number
}

/** The 2D box of a projected point list. */
export function bounds2d(points: Points): Bounds2d {
  let minU = Infinity
  let maxU = -Infinity
  let minV = Infinity
  let maxV = -Infinity
  for (let index = 0; index < points.length; index += 2) {
    const u = points[index] as number
    const v = points[index + 1] as number
    if (u < minU) minU = u
    if (u > maxU) maxU = u
    if (v < minV) minV = v
    if (v > maxV) maxV = v
  }
  return { minU, maxU, minV, maxV, midU: (minU + maxU) / 2, midV: (minV + maxV) / 2 }
}

/** Every vertex when there are few, an evenly strided subset when there are many. */
function subsample(points: Points, cap: number): Points {
  const count = points.length / 2
  if (count <= cap) return points
  const stride = Math.ceil(count / cap)
  const kept = Math.ceil(count / stride)
  const out = new Float64Array(kept * 2)
  let write = 0
  for (let index = 0; index < count; index += stride) {
    out[write] = points[index * 2] as number
    out[write + 1] = points[index * 2 + 1] as number
    write += 2
  }
  return out.subarray(0, write)
}

/**
 * Candidate centres: the box corners (§4's rule), the box centre, the origin,
 * and a coarse grid over the box expanded by 10% in each direction.
 *
 * The origin is in the list because it is the assumption §4's method leans on
 * and this row is supposed to check it, not inherit it.
 */
function seedCentres(bbox: Bounds2d, points: Points): (readonly [number, number])[] {
  const seeds: (readonly [number, number])[] = [...hullCircumcentres(points, bbox)]
  seeds.push(
    [bbox.minU, bbox.minV],
    [bbox.minU, bbox.maxV],
    [bbox.maxU, bbox.minV],
    [bbox.maxU, bbox.maxV],
    [bbox.midU, bbox.midV],
    [0, 0],
  )
  const spanU = bbox.maxU - bbox.minU
  const spanV = bbox.maxV - bbox.minV
  const steps = 8
  for (let i = 0; i <= steps; i += 1) {
    for (let j = 0; j <= steps; j += 1) {
      seeds.push([
        bbox.minU - spanU * 0.1 + (spanU * 1.2 * i) / steps,
        bbox.minV - spanV * 0.1 + (spanV * 1.2 * j) / steps,
      ])
    }
  }
  return seeds
}

/**
 * Median circumcentres of convex-hull triples, at two spacings.
 *
 * The seeds that make the fit independent of where the sector happens to start.
 * A component-wise median rather than a mean, so the handful of triples that
 * straddle a corner between the outer arc and a radial edge cannot drag it.
 */
export function hullCircumcentres(points: Points, bbox: Bounds2d): (readonly [number, number])[] {
  const hull = convexHull(points)
  if (hull.length < 3) return []
  // Two spacings, because neither dominates. Three *neighbouring* hull points on
  // a short arc are nearly collinear, so their circumcentre is swamped by
  // coordinate quantisation — measured on a real `plain#base` 11.25° band, the
  // consecutive-triple seed missed far enough for the reconstruction test to
  // reject a perfectly good sector. But a third of the hull apart mixes the
  // outer arc with the straight radial edges on other tiles, and there the
  // consecutive seed is the one that lands exactly. Both are offered as seeds and
  // the reconstruction test picks.
  return [1, Math.max(1, Math.floor(hull.length / 3))]
    .map((step) => hullCircumcentreAt(hull, bbox, step))
    .filter((centre): centre is readonly [number, number] => centre !== undefined)
}

function hullCircumcentreAt(
  hull: readonly (readonly [number, number])[],
  bbox: Bounds2d,
  step: number,
): (readonly [number, number]) | undefined {
  const limit =
    MAX_CIRCUMRADIUS_RATIO * Math.hypot(bbox.maxU - bbox.minU, bbox.maxV - bbox.minV)
  const us: number[] = []
  const vs: number[] = []
  for (let index = 0; index < hull.length; index += 1) {
    const a = hull[index] as readonly [number, number]
    const b = hull[(index + step) % hull.length] as readonly [number, number]
    const c = hull[(index + 2 * step) % hull.length] as readonly [number, number]
    const centre = circumcentre(a, b, c)
    if (centre === undefined) continue
    if (Math.hypot(centre[0] - a[0], centre[1] - a[1]) > limit) continue
    us.push(centre[0])
    vs.push(centre[1])
  }
  if (us.length === 0) return undefined

  us.sort((x, y) => x - y)
  vs.sort((x, y) => x - y)
  return [us[Math.floor(us.length / 2)] as number, vs[Math.floor(vs.length / 2)] as number]
}

/** The centre of the circle through three points, or `undefined` if collinear. */
export function circumcentre(
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
): (readonly [number, number]) | undefined {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]))
  if (!Number.isFinite(d) || d === 0) return undefined
  const aa = a[0] * a[0] + a[1] * a[1]
  const bb = b[0] * b[0] + b[1] * b[1]
  const cc = c[0] * c[0] + c[1] * c[1]
  const u = (aa * (b[1] - c[1]) + bb * (c[1] - a[1]) + cc * (a[1] - b[1])) / d
  const v = (aa * (c[0] - b[0]) + bb * (a[0] - c[0]) + cc * (b[0] - a[0])) / d
  return Number.isFinite(u) && Number.isFinite(v) ? [u, v] : undefined
}

/** Andrew's monotone chain. Counter-clockwise, no collinear interior points. */
export function convexHull(points: Points): (readonly [number, number])[] {
  const count = points.length / 2
  if (count < 3) return []
  const sorted: (readonly [number, number])[] = []
  for (let index = 0; index < count; index += 1) {
    sorted.push([points[index * 2] as number, points[index * 2 + 1] as number])
  }
  sorted.sort((a, b) => a[0] - b[0] || a[1] - b[1])

  const cross = (
    o: readonly [number, number],
    a: readonly [number, number],
    b: readonly [number, number],
  ): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

  const build = (source: (readonly [number, number])[]): (readonly [number, number])[] => {
    const chain: (readonly [number, number])[] = []
    for (const point of source) {
      while (
        chain.length >= 2 &&
        cross(
          chain[chain.length - 2] as readonly [number, number],
          chain[chain.length - 1] as readonly [number, number],
          point,
        ) <= 0
      ) {
        chain.pop()
      }
      chain.push(point)
    }
    return chain
  }

  const lower = build(sorted)
  const upper = build([...sorted].reverse())
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

/**
 * Share of vertices in the lowest and highest occupied radial bins about `centre`.
 *
 * The discriminator described in step 3 of the module docstring. Two passes: one
 * for the radial range, one to count the extreme bins.
 */
export function sharpness(points: Points, centre: readonly [number, number]): number {
  const count = points.length / 2
  if (count === 0) return 0

  let min = Infinity
  let max = -Infinity
  for (let index = 0; index < count; index += 1) {
    const r = radius(points, index, centre)
    if (r < min) min = r
    if (r > max) max = r
  }
  if (!Number.isFinite(min) || max - min < RADIAL_BIN_MM) return 0

  let low = 0
  let high = 0
  for (let index = 0; index < count; index += 1) {
    const r = radius(points, index, centre)
    if (r <= min + RADIAL_BIN_MM) low += 1
    if (r >= max - RADIAL_BIN_MM) high += 1
  }
  return (low + high) / count
}

function radius(points: Points, index: number, centre: readonly [number, number]): number {
  const du = (points[index * 2] as number) - centre[0]
  const dv = (points[index * 2 + 1] as number) - centre[1]
  return Math.hypot(du, dv)
}

/**
 * Gauss-Newton on the two-radius concentric fit.
 *
 * Vertices within {@link ON_ARC_TOL_MM} of the current extreme radii are the
 * inner and outer clusters; each iteration re-estimates the two radii as cluster
 * means and then solves the 2×2 normal equations `(Σ uᵀu) Δ = Σ u e` for the
 * centre step, where `u` is the unit radial direction and `e = |p − c| − R`.
 */
export function refineCentre(points: Points, seed: readonly [number, number]): readonly [number, number] {
  const count = points.length / 2
  let cu = seed[0]
  let cv = seed[1]

  for (let iteration = 0; iteration < REFINE_ITERATIONS; iteration += 1) {
    let min = Infinity
    let max = -Infinity
    for (let index = 0; index < count; index += 1) {
      const r = radius(points, index, [cu, cv])
      if (r < min) min = r
      if (r > max) max = r
    }
    if (!Number.isFinite(min) || max - min <= 0) break

    // Cluster means, so a single outlying vertex does not define a radius.
    let innerSum = 0
    let innerCount = 0
    let outerSum = 0
    let outerCount = 0
    for (let index = 0; index < count; index += 1) {
      const r = radius(points, index, [cu, cv])
      if (r <= min + ON_ARC_TOL_MM) {
        innerSum += r
        innerCount += 1
      } else if (r >= max - ON_ARC_TOL_MM) {
        outerSum += r
        outerCount += 1
      }
    }
    if (innerCount === 0 || outerCount === 0) break
    const rIn = innerSum / innerCount
    const rOut = outerSum / outerCount

    let a = 0
    let b = 0
    let c = 0
    let du = 0
    let dv = 0
    for (let index = 0; index < count; index += 1) {
      const pu = (points[index * 2] as number) - cu
      const pv = (points[index * 2 + 1] as number) - cv
      const r = Math.hypot(pu, pv)
      if (r === 0) continue
      const target = Math.abs(r - rIn) <= Math.abs(r - rOut) ? rIn : rOut
      if (Math.abs(r - target) > ON_ARC_TOL_MM) continue
      // `u` is the unit radial direction; `∂r/∂c = -u`, so the normal equations
      // built from `+u` give the step directly rather than its negation.
      const uu = pu / r
      const uv = pv / r
      const e = r - target
      a += uu * uu
      b += uu * uv
      c += uv * uv
      du += uu * e
      dv += uv * e
    }

    const det = a * c - b * b
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) break
    const stepU = (du * c - dv * b) / det
    const stepV = (dv * a - du * b) / det
    if (!Number.isFinite(stepU) || !Number.isFinite(stepV)) break
    cu += stepU
    cv += stepV
    if (Math.hypot(stepU, stepV) < 1e-6) break
  }

  return [cu, cv]
}

/* ------------------------------------------------------------- acceptance */

/**
 * How far the fitted centre can slide along the sector's bisector before the
 * model is visibly worse — the honest error bar on `innerRadiusUnits` and
 * `outerRadiusUnits`.
 *
 * ## Why this direction, and why it needs measuring
 *
 * Sliding the centre by δ along the bisector while reducing both radii by δ maps
 * an annular sector onto a nearly identical one. Along the bisector the outer
 * edge does not move at all; across it the sector narrows by only
 * `2δ·sin(sweep/2)`. So for a 90° sweep the transform is easy to detect and for
 * an 11.25° band it is nearly invisible, and the acceptance test in
 * {@link evaluate} cannot separate the two cases. That is why the interval is
 * measured per mesh instead of quoted as a constant.
 *
 * ## Both halves of the model, because either alone is blind
 *
 * The cost at δ is the worse of two normalised misfits:
 *
 *   - the **radial** RMS of vertices against the two shifted circles, which
 *     catches a wrong *band width*; and
 *   - the **reconstruction** residual of the shifted sector's own bounding box
 *     against the measured one, which catches the slide itself.
 *
 * The radial term alone is exactly blind to the slide — measured on the corpus's
 * quarter discs it never grew at all and the walk ran to the outer radius,
 * reporting "this radius is unknown to within 152 mm" for a disc whose radius is
 * pinned to a hundredth of a millimetre by its two straight edges. Those edges
 * are what the bounding-box term sees.
 *
 * The walk stops when the cost has grown by {@link RESIDUAL_GROWTH_FACTOR} — the
 * conventional "clearly worse" threshold, needing no distributional assumption
 * where a chi-squared interval would — and the result is floored at
 * {@link RESIDUAL_FLOOR_FACTOR} times the residual scale to cover the
 * quantisation bias the walk cannot see, then scaled by the calibrated
 * {@link SECTOR_TOLERANCE_SAFETY}. Verified against 80 synthetic sectors of known
 * radii: the reported interval contains the true error in all 80.
 */
export function radialTolerance(
  points: Points,
  bbox: Bounds2d,
  centre: readonly [number, number],
  rMin: number,
  rMax: number,
  startRad: number,
  sweepRad: number,
): number {
  const sample = subsample(points, TOLERANCE_SAMPLE)
  const bisector = startRad + sweepRad / 2
  const du = Math.cos(bisector)
  const dv = Math.sin(bisector)

  const radialRms = (delta: number): number => {
    const cu = centre[0] + delta * du
    const cv = centre[1] + delta * dv
    const inner = Math.max(0, rMin - delta)
    const outer = rMax - delta
    let squares = 0
    let count = 0
    for (let index = 0; index < sample.length; index += 2) {
      const r = Math.hypot((sample[index] as number) - cu, (sample[index + 1] as number) - cv)
      const residual = Math.min(Math.abs(r - inner), Math.abs(r - outer))
      if (residual > ON_ARC_TOL_MM * 4) continue
      squares += residual * residual
      count += 1
    }
    return count === 0 ? Infinity : Math.sqrt(squares / count)
  }

  const boxResidual = (delta: number): number => {
    const cu = centre[0] + delta * du
    const cv = centre[1] + delta * dv
    const box = sectorBounds(Math.max(0, rMin - delta), rMax - delta, startRad, sweepRad)
    return Math.max(
      Math.abs(box.minU + cu - bbox.minU),
      Math.abs(box.maxU + cu - bbox.maxU),
      Math.abs(box.minV + cv - bbox.minV),
      Math.abs(box.maxV + cv - bbox.maxV),
    )
  }

  const baseRadial = Math.max(radialRms(0), RESIDUAL_FLOOR_MM)
  const baseBox = Math.max(boxResidual(0), RESIDUAL_FLOOR_MM)
  const cost = (delta: number): number =>
    Math.max(radialRms(delta) / baseRadial, boxResidual(delta) / baseBox)

  const floor = baseRadial * RESIDUAL_FLOOR_FACTOR
  let delta = RESIDUAL_FLOOR_MM
  for (let step = 0; step < 60; step += 1) {
    const next = delta * 1.5
    if (next > rMax) return round(rMax, 5)
    if (Math.max(cost(next), cost(-next)) > RESIDUAL_GROWTH_FACTOR) {
      return round(Math.min(rMax, Math.max(next * SECTOR_TOLERANCE_SAFETY, floor)), 5)
    }
    delta = next
  }
  return round(Math.min(rMax, Math.max(delta * SECTOR_TOLERANCE_SAFETY, floor)), 5)
}

function evaluate(
  points: Points,
  bbox: Bounds2d,
  centre: readonly [number, number],
  plane: SectorPlane,
  shift: readonly [number, number],
  /**
   * Whether to compute the two expensive diagnostics.
   *
   * `false` for the ~36 ranking passes, which only consult {@link rank} — that is
   * the accepted/rejected split and the reconstruction residual, and nothing
   * else. Measured: leaving the rotating-calipers strip fit and the radial
   * tolerance walk in the ranking passes made them ~90% of the fit's cost, and
   * they contribute nothing to the choice.
   */
  exact: boolean,
): SectorResult {
  const count = points.length / 2

  // Radial extent over *every* vertex — this is what the footprint needs.
  let rMin = Infinity
  let rMax = -Infinity
  for (let index = 0; index < count; index += 1) {
    const r = radius(points, index, centre)
    if (r < rMin) rMin = r
    if (r > rMax) rMax = r
  }

  // Angular extent over the vertices far enough out to have a meaningful angle.
  const angleFloor = Math.max(ANGLE_MIN_RADIUS_MM, rMax * 0.02)
  let angular = 0
  const angles = new Float64Array(count)
  for (let index = 0; index < count; index += 1) {
    const du = (points[index * 2] as number) - centre[0]
    const dv = (points[index * 2 + 1] as number) - centre[1]
    if (Math.hypot(du, dv) < angleFloor) continue
    angles[angular] = Math.atan2(dv, du)
    angular += 1
  }
  const arc = coveringArc(angles.subarray(0, angular))
  const closed =
    angular > 0 &&
    arc.largestGapDeg <= Math.max(ANNULUS_GAP_RATIO * arc.largestInnerGapDeg, 1e-9) &&
    arc.largestGapDeg < 20
  const sweepRad = closed ? 2 * Math.PI : arc.sweepRad
  const startRad = closed ? 0 : arc.startRad

  let onArc = 0
  let sumSquares = 0
  for (let index = 0; index < count; index += 1) {
    const r = radius(points, index, centre)
    const residual = Math.min(Math.abs(r - rMin), Math.abs(r - rMax))
    if (residual <= ON_ARC_TOL_MM) {
      onArc += 1
      sumSquares += residual * residual
    }
  }

  const reconstructed = sectorBounds(rMin, rMax, startRad, sweepRad)
  const residual = Math.max(
    Math.abs(reconstructed.minU + centre[0] - bbox.minU),
    Math.abs(reconstructed.maxU + centre[0] - bbox.maxU),
    Math.abs(reconstructed.minV + centre[1] - bbox.minV),
    Math.abs(reconstructed.maxV + centre[1] - bbox.maxV),
  )

  const diagnostics: SectorDiagnostics = {
    plane,
    centreMm: [round(centre[0] + shift[0], 4), round(centre[1] + shift[1], 4)],
    centreOffsetMm: round(Math.hypot(centre[0] + shift[0], centre[1] + shift[1]), 4),
    onArcFraction: round(onArc / Math.max(1, count), 4),
    radialRmsMm: round(onArc === 0 ? Infinity : Math.sqrt(sumSquares / onArc), 4),
    bboxResidualMm: round(residual, 4),
    angularGapDeg: round(closed ? 0 : arc.largestInnerGapDeg, 3),
    vertices: count,
    radiusToleranceMm: exact
      ? radialTolerance(points, bbox, centre, rMin, rMax, startRad, sweepRad)
      : Infinity,
  }

  const innerRadiusUnits = round(rMin / MM_PER_UNIT, 4)
  const outerRadiusUnits = round(rMax / MM_PER_UNIT, 4)
  const sweepDeg = closed ? 360 : round((sweepRad * 180) / Math.PI, 3)

  const reject = (reason: SectorRejection): SectorRefusal => {
    const strip = exact ? fitStrip(points) : undefined
    return {
      ...diagnostics,
      fit: 'rejected',
      reason,
      innerRadiusUnits,
      outerRadiusUnits,
      sweepDeg,
      ...(strip === undefined ? {} : { strip }),
    }
  }

  if (angular === 0) return reject('no-vertices')
  if (rMax - rMin < RADIAL_BIN_MM) return reject('degenerate-band')
  if (diagnostics.onArcFraction < MIN_ON_ARC_FRACTION) return reject('few-arc-vertices')
  if (residual > BBOX_RESIDUAL_TOL_MM) return reject('box-mismatch')

  return {
    ...diagnostics,
    fit: sweepDeg >= FULL_ANNULUS_DEG ? 'annulus' : 'sector',
    innerRadiusUnits,
    outerRadiusUnits,
    bandUnits: round(outerRadiusUnits - innerRadiusUnits, 4),
    startDeg: round((startRad * 180) / Math.PI, 3),
    sweepDeg: sweepDeg >= FULL_ANNULUS_DEG ? 360 : sweepDeg,
  }
}

/**
 * The minimal arc covering every angle: `360° −` the largest empty gap.
 *
 * Also returns the largest gap *inside* the covering arc, which is how a shape
 * with an angular hole is distinguished from a solid sector rather than having
 * its sweep silently widened across the hole.
 */
export function coveringArc(angles: Float64Array): {
  startRad: number
  sweepRad: number
  largestGapDeg: number
  largestInnerGapDeg: number
} {
  const count = angles.length
  if (count === 0) return { startRad: 0, sweepRad: 0, largestGapDeg: 360, largestInnerGapDeg: 0 }

  const sorted = Float64Array.from(angles).sort()
  let gapIndex = 0
  let gap = (sorted[0] as number) + 2 * Math.PI - (sorted[count - 1] as number)
  for (let index = 1; index < count; index += 1) {
    const between = (sorted[index] as number) - (sorted[index - 1] as number)
    if (between > gap) {
      gap = between
      gapIndex = index
    }
  }

  const sweepRad = Math.max(0, 2 * Math.PI - gap)
  const startRad = sorted[gapIndex] as number

  // The second-largest gap is the largest hole strictly inside the sweep.
  let inner = 0
  for (let index = 1; index < count; index += 1) {
    if (index === gapIndex) continue
    const between = (sorted[index] as number) - (sorted[index - 1] as number)
    if (between > inner) inner = between
  }
  if (gapIndex !== 0) {
    const wrap = (sorted[0] as number) + 2 * Math.PI - (sorted[count - 1] as number)
    if (wrap > inner) inner = wrap
  }

  return {
    startRad,
    sweepRad,
    largestGapDeg: (gap * 180) / Math.PI,
    largestInnerGapDeg: (inner * 180) / Math.PI,
  }
}

/**
 * The exact 2D box of the ideal sector `[rIn, rOut] × [start, start + sweep]`,
 * relative to its own centre.
 *
 * Extremes of the region occur either at one of the four corners or where an arc
 * crosses a cardinal direction, so both sets are enumerated. This is the
 * orientation-free version of §4's `bboxX = Rout − Rin·cos θ`.
 */
export function sectorBounds(
  rIn: number,
  rOut: number,
  startRad: number,
  sweepRad: number,
): { minU: number; maxU: number; minV: number; maxV: number } {
  const candidates: (readonly [number, number])[] = []
  for (const angle of [startRad, startRad + sweepRad]) {
    for (const r of [rIn, rOut]) candidates.push([r * Math.cos(angle), r * Math.sin(angle)])
  }
  for (let quadrant = -4; quadrant <= 8; quadrant += 1) {
    const angle = (quadrant * Math.PI) / 2
    if (angle < startRad - 1e-12 || angle > startRad + sweepRad + 1e-12) continue
    for (const r of [rIn, rOut]) candidates.push([r * Math.cos(angle), r * Math.sin(angle)])
  }

  let minU = Infinity
  let maxU = -Infinity
  let minV = Infinity
  let maxV = -Infinity
  for (const [u, v] of candidates) {
    if (u < minU) minU = u
    if (u > maxU) maxU = u
    if (v < minV) minV = v
    if (v > maxV) maxV = v
  }
  return { minU, maxU, minV, maxV }
}

/* ---------------------------------------------------------------- the strip */

/**
 * The oriented box of a 2D point cloud, from its principal axes.
 *
 * Reported alongside a rejection. `residualMm` is the RMS distance from the
 * strip's own edges in its short direction — small when the footprint really is
 * a straight run of constant thickness, which is what `openlock-tessellation.md`
 * §7 says the `xG` codes are.
 */
export function fitStrip(points: Points): StripFit | undefined {
  const count = points.length / 2
  if (count < 3) return undefined
  const sample = subsample(points, STRIP_SAMPLE)

  // Minimum-area oriented box by rotating calipers, coarse then fine. A
  // covariance eigenvector would be cheaper but is weighted by how often each
  // vertex is repeated across facets, which tilts the axis of a box mesh by a
  // degree or so — enough to turn an exact 3.000 × 0.500 into 3.009 × 0.557.
  let bestAngle = 0
  let bestArea = Infinity
  const scan = (from: number, to: number, step: number): void => {
    for (let angle = from; angle < to; angle += step) {
      const extent = orientedExtent(sample, angle)
      const area = extent.spanA * extent.spanB
      if (area < bestArea) {
        bestArea = area
        bestAngle = angle
      }
    }
  }
  scan(0, Math.PI, Math.PI / 360)
  scan(bestAngle - Math.PI / 360, bestAngle + Math.PI / 360, Math.PI / 36000)

  // Final extent over every vertex, at the chosen orientation.
  const extent = orientedExtent(points, bestAngle)
  const alongA = extent.spanA >= extent.spanB
  const long = alongA ? extent.spanA : extent.spanB
  const short = alongA ? extent.spanB : extent.spanA
  const halfShort = short / 2
  const midShort = alongA ? (extent.minB + extent.maxB) / 2 : (extent.minA + extent.maxA) / 2

  const cos = Math.cos(bestAngle)
  const sin = Math.sin(bestAngle)
  let sumSquares = 0
  for (let index = 0; index < count; index += 1) {
    const u = points[index * 2] as number
    const v = points[index * 2 + 1] as number
    const across = (alongA ? -u * sin + v * cos : u * cos + v * sin) - midShort
    sumSquares += (halfShort - Math.abs(across)) ** 2
  }

  const angleRad = alongA ? bestAngle : bestAngle + Math.PI / 2
  let angleDeg = ((angleRad * 180) / Math.PI) % 180
  if (angleDeg < 0) angleDeg += 180

  return {
    lengthUnits: round(long / MM_PER_UNIT, 4),
    widthUnits: round(short / MM_PER_UNIT, 4),
    angleDeg: round(angleDeg, 3),
    residualMm: round(Math.sqrt(sumSquares / count), 4),
  }
}

/** Extents of a point list along a rotated frame. */
function orientedExtent(
  points: Points,
  angle: number,
): { minA: number; maxA: number; minB: number; maxB: number; spanA: number; spanB: number } {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  let minA = Infinity
  let maxA = -Infinity
  let minB = Infinity
  let maxB = -Infinity
  for (let index = 0; index < points.length; index += 2) {
    const u = points[index] as number
    const v = points[index + 1] as number
    const a = u * cos + v * sin
    const b = -u * sin + v * cos
    if (a < minA) minA = a
    if (a > maxA) maxA = a
    if (b < minB) minB = b
    if (b > maxB) maxB = b
  }
  return { minA, maxA, minB, maxB, spanA: maxA - minA, spanB: maxB - minB }
}
