/**
 * Overlap detection — and the reason a naive box test is wrong here.
 *
 * ## The problem with AABB overlap on a plan
 *
 * Two floors in the same square is a mistake the user should see. A wall lying
 * along the edge of a floor tile is **not** a mistake — it is how OpenForge is
 * built. 3,351 tiles carry `build|separate wall` (the wall stands beside the
 * tile) and 863 carry `build|wall on tile` (the wall stands *on* it), so in plan
 * a wall band and a floor square legitimately share the same square metre of
 * paper while occupying different heights. `y` is exactly the axis v1 does not
 * model, which is why a renderer cannot see the difference and has to be told
 * about it.
 *
 * A tile-versus-tile AABB test over a real room therefore reports a conflict on
 * every wall in it. Measured on the landing hero's chamber (`src/screens/landing/
 * plan.ts`, 12 floors, 8 walls, 6 fixtures): the walls abut the floors there, so
 * the naive test is quiet — but move any wall half a unit inwards, which the 0.5
 * snap invites and `build|wall on tile` requires, and it fires on all eight.
 *
 * ## What this module does instead
 *
 * Every placement is assigned a **band**, and overlap is only ever tested within
 * a band:
 *
 *   - `edge` — a wall. Occupies the boundary between squares and stands above the
 *     floor. Two walls in the same band position genuinely collide.
 *   - `area` — everything else: floors, bases, stairs, columns, thick walls that
 *     really do fill their square. Two of these in the same square collide.
 *
 * Cross-band pairs are never reported. That is the whole of the false-positive
 * fix, and it is a *model* of the height axis rather than a fudge.
 *
 * ## The vertical axis — row A7, and what it could not get
 *
 * Elevation is a real quantity on the subject now: {@link OverlapSubject} carries
 * a {@link PlanLevel}, and {@link subjectsConflict} tests it for disjointness
 * before it looks at the plan at all. So a floor instance under a wall instance —
 * a legal and common build, and the false positive row **A4a** left behind — is
 * two pieces at two elevations and is no longer reported. A4a fixed the
 * *intra*-instance case only, and by identity rather than by height (see
 * {@link OverlapCandidate}); this is the other half.
 *
 * **Where the numbers come from is the whole of the difficulty.**
 *
 *   - **The underside is `SlotLayout.elevationMm` and nothing else.** Row A4b
 *     deleted `three/bases.ts#baseElevationMm` so that there would be exactly one
 *     elevation source; this module reads that one and derives no second.
 *     Normalised rather than measured, because §2.2 and §9 measured **18.4% of
 *     `openforge` toppers authored pre-lifted by exactly 6.0 mm and 77.5% not**,
 *     so a lift taken off a mesh would encode that inconsistency.
 *   - **The thickness is `0` for every catalog record, and that is measured
 *     rather than deferred.** `catalog.json` carries no height at all: a record
 *     holds `foot`, `kinds`, `layer` and 14 further fields and not one of them is
 *     a `y` extent. The only place a height exists is
 *     `tools/measure/measurements.json`, a dev-tool sidecar — **1,163 measured
 *     blobs, covering 1,284 of 8,702 records (14.8%)** — and nothing under
 *     `src/**` reads it. So a record's thickness is not "not yet plumbed"; there
 *     is nothing to plumb. A piece of no known thickness is **the level it stands
 *     at**, which is what {@link levelsOverlap} is built around.
 *   - **A generated base is the one piece with a real height**, because a recipe
 *     computes one: `HEIGHT` for a base, `z` half-squares for a riser
 *     (`generator/panel/footprint.ts`). That is why this is an interval and not a
 *     level comparison — a 50.8 mm riser reaches up through four levels and a
 *     level test would miss every one of them.
 *   - **A ghost has no level.** It belongs to no template, so there is no slot
 *     rule to ask; `level: null` means *every* level, which is the conservative
 *     direction this module commits to everywhere else — it may report a conflict
 *     that is not quite there and can never miss one.
 *
 * ## What did *not* retire, against A4a's note: the band
 *
 * A4a's plan was that {@link planBand} and {@link PlanBand} retire with this
 * change, the two bands being a two-valued approximation of the interval.
 * **Measured, they cannot, and the measurement is one line:**
 * `planCatalogFromFile` is called with no layout rule everywhere in the app
 * (`screens/builder/BuilderScreen.tsx`), so the rule in force is
 * `catalog.ts#originSlotLayout` → `ORIGIN_LAYOUT` → **`elevationMm: 0` on every
 * part of every placement**. Row **B2** authored the real chain,
 * `template/offsets.ts#slotElevationMm`, and nothing wires it: it takes the
 * resting part's height as an argument and the only implementation of that
 * argument was the `baseElevationMm` A4b deleted. `template/index.ts` says as
 * much outright — *"nothing in the app reads this directory yet"*.
 *
 * So under the shipped rule every part is on the ground, every level is the same
 * level, and an interval test separates nothing. Deleting the band today would
 * flag a wall standing on a floor — the three junctions of the landing hero's own
 * chamber included — which is the exact false positive this module exists to
 * remove. The band therefore stays as what it always was: a **two-valued level
 * index over tag data**, sound where the elevation rule is silent, and the first
 * thing to delete when a `SlotLayoutRule` lands that returns a real elevation.
 * *"is the only thing separating a wall from a floor under the shipped layout
 * rule"* in `plan.test.ts` pins that dependency so the band cannot be deleted by
 * accident, and *"separates two stacked instances once the layout rule gives
 * them elevations"* pins the half that is already live.
 *
 * ## Flag, not prevent
 *
 * A conflict is drawn and counted; the placement still happens. Three reasons:
 *
 *   1. §7 sets the precedent for the whole builder — "compatibility informs; it
 *      never refuses a placement" — and refusal is only used in this PR for
 *      something categorically different: a footprint with nothing to draw.
 *   2. The band assignment is a **heuristic over tag data**, and the tag data
 *      drifts (§16). A heuristic that warns and is occasionally wrong costs the
 *      user a glance; a heuristic that blocks and is occasionally wrong costs
 *      them a tile they cannot place and no way to find out why.
 *   3. Overlapping while arranging is normal. Users push a piece through its
 *      neighbours on the way to where it belongs.
 *
 * ## Two walls meeting at a corner are not a conflict either
 *
 * Perpendicular walls share the 0.5 × 0.5 square at the corner they meet in —
 * that is what a corner *is*, in plan, at a wall thickness of half a unit. The
 * landing hero's own chamber (`src/screens/landing/plan.ts`) has three such
 * junctions, so a rule without this exemption would light up the drawing the app
 * puts on its front door. The exemption is deliberately narrow: both pieces
 * axis-aligned, both long axes perpendicular, and the shared box no larger than
 * the wall thickness on either side. Two *parallel* walls overlapping by the
 * same half unit are still flagged, because that is a collinear overlap and there
 * is no corner piece that resolves it.
 *
 * ## Exact for the straight cases, one-sided for the curved ones
 *
 * The test is a box reject followed by a separating-axis test on the pieces'
 * **convex parts**. The box reject makes the common case one comparison; the SAT
 * pass means the 823 placeable tiles with a non-90° rotation step are tested as
 * the shapes they are. A 45° 2 × 2 tile's bounding box is 41% larger than the
 * tile, so a box-only test would report a collision with a neighbour it visibly
 * misses.
 *
 * SAT is a theorem about convex sets and an annular sector is not one, so a
 * sector arrives here already decomposed into 7 convex parts on average — a
 * decomposition `sector.ts` proves *contains* the sector, by at most 0.246 mm.
 * Two consequences worth stating outright, because they are what makes this test
 * safe to build a print from:
 *
 *   - **The error is one-directional.** Every part is a superset of the geometry
 *     it stands for, so this module can report a conflict that is not quite
 *     there and can never miss one that is. A false positive costs a glance at a
 *     hatch the user can ignore; a false negative would let two pieces occupy the
 *     same square metre of paper and ship a room that cannot be printed.
 *   - **The box reject is on the *exact* box, not the parts' slightly larger
 *     one, and that is safe in the same direction.** A true overlap implies the
 *     exact boxes overlap, so rejecting on them never discards a real conflict;
 *     it only prunes contacts that exist between the envelopes and not between
 *     the pieces, which *reduces* the false positives rather than adding a
 *     false negative.
 */
import type { CatalogRecord } from '@/catalog'
import { GRID_UNIT_MM, WALL_THICKNESS_UNITS } from '@/catalog'
import type { PlacementId } from '@/store'

import type { PlanBox, PlanPart, PlanPoint } from './geometry'

/**
 * Which height band a piece occupies. See the module docblock — this is v1's
 * stand-in for the `y` axis, not a category of tile.
 */
export type PlanBand = 'area' | 'edge'

/**
 * Tolerance, in grid units, below which an intersection is treated as touching.
 *
 * 1e-6 units is 2.5e-5 mm. Anything smaller than that is floating-point residue
 * from the trigonometry in `rotatedExtent`, and two tiles that share a face —
 * the normal case for a tiled floor — must not be a conflict.
 */
const TOUCH_EPS = 1e-6

/**
 * The same tolerance in millimetres, for the vertical axis.
 *
 * `SlotLayout` measures the lift in millimetres and `dx`/`dz` in grid units —
 * *"the unit is in the name because the two must never be added"* — so the plan
 * tolerance cannot be reused as it stands. Converted rather than written out, so
 * that a change to {@link TOUCH_EPS} moves both axes together and the two can
 * never disagree about what touching means. 2.54e-5 mm, which is the figure
 * {@link TOUCH_EPS}'s own note quotes.
 */
const TOUCH_MM = TOUCH_EPS * GRID_UNIT_MM

/** Kind buckets that mean "this piece fills its square", not "it lines an edge". */
const AREA_KINDS: readonly string[] = ['floor', 'base', 'stairs', 'riser']

/**
 * Whether a footprint *is* the wall-thickness constant, and so stands above the
 * floor by construction rather than by what its tags happen to say.
 *
 * Four cases qualify and each for the same reason — the short axis of the
 * footprint is {@link WALL_THICKNESS_UNITS} and nothing in the data says
 * otherwise:
 *
 *   - `wall`, whose 0.5 depth is not in the data at all but is the measured
 *     12.7 mm (3,079 tiles);
 *   - `column`, one 12.70 × 12.70 mm pillar (119);
 *   - `diag`, the same wall bent to 45° (121);
 *   - `arc` whose band is exactly one wall thickness wide — `concave` and
 *     `convex`, 982 tiles, the two bands `src/catalog/schema.ts` records as
 *     curved *walls* named after the floor tile they clip to.
 *
 * Corpus effect, computed against the fixtures: **323 tiles move from `area` to
 * `edge`** — 248 curved walls (156 `concave`, 92 `convex`) whose `kinds` say
 * `base`, `floor` or `stairs` because the curve belongs to a floor family, and
 * 75 columns tagged `column` without `wall`. Nothing moves the other way. Every
 * one of the 323 is a piece that stands *on* a floor rather than being one, so
 * each move deletes a false conflict against the floor underneath it — and the
 * split it replaces filed the same physical pillar two different ways depending
 * on whether its tag list happened to include `wall`.
 */
function isWallThickness(foot: CatalogRecord['foot']): boolean {
  switch (foot.shape) {
    case 'wall':
    case 'column':
    case 'diag':
      return true
    case 'arc':
      return Math.abs(foot.rOut - foot.rIn - WALL_THICKNESS_UNITS) < TOUCH_EPS
    default:
      return false
  }
}

/**
 * The band a tile occupies.
 *
 * Footprint first, kinds second, and in that order for a reason: the `wall`
 * footprint *is* the 0.5-unit thickness constant, so a tile that has one is by
 * construction an edge piece. The kind check then catches the thick-wall
 * variants — 591 tiles carry `build|thick wall` and many of those publish both a
 * `size|width` and a `size|depth`, so they arrive as `rect` and would otherwise
 * be filed as floors.
 *
 * `kinds` is an array and **11.9% of tiles are in no bucket at all**
 * (`src/catalog/schema.ts`), so the fallback has to be a real answer rather than
 * a failure: an unbucketed piece is treated as filling its square, which is the
 * conservative choice — it will be flagged against other fills rather than
 * silently permitted to stack.
 *
 * **A level index, not a height, and that is why row A7 kept it.** The band says
 * *which* of two levels a piece is on and never how thick it is, so it is not a
 * second answer to {@link PlanLevel}'s question and cannot disagree with one.
 * What it is, is the only answer available while `originSlotLayout` is the rule
 * in force — see the module docblock.
 */
export function planBand(record: Pick<CatalogRecord, 'foot' | 'kinds'>): PlanBand {
  if (isWallThickness(record.foot)) return 'edge'
  const wall = record.kinds.includes('wall')
  const fills = record.kinds.some((kind) => AREA_KINDS.includes(kind))
  return wall && !fills ? 'edge' : 'area'
}

/**
 * How much vertical space a piece takes, in millimetres.
 *
 * The two numbers have two different provenances and that is the point of
 * spelling both out rather than storing a single top:
 *
 *   - `elevationMm` is `geometry.ts#SlotLayout.elevationMm`, **the project's one
 *     elevation source** since row A4b deleted the other one. Normalised, never
 *     read off a mesh.
 *   - `heightMm` is how far the piece reaches above that, and it is `0` for every
 *     catalog record because no height for one exists anywhere the app can read.
 *     See the module docblock for the count.
 *
 * A `heightMm` of `0` is not a sentinel and needs no branch of its own in the
 * callers: a piece of no thickness *is* the level it stands at, and
 * {@link levelsOverlap} answers for it in the same sentence it answers for a
 * 50.8 mm riser.
 */
export interface PlanLevel {
  /** The underside, from `SlotLayout.elevationMm`. */
  readonly elevationMm: number
  /** How far it reaches above the underside. `0` when nothing knows. */
  readonly heightMm: number
}

/** A piece of no known thickness: the level it stands at, and nothing above it. */
export function levelAt(elevationMm: number): PlanLevel {
  return { elevationMm, heightMm: 0 }
}

/** A placement's geometry, reduced to what overlap detection needs. */
export interface OverlapSubject {
  readonly band: PlanBand
  /**
   * The vertical space it takes, or `null` when nothing knows yet.
   *
   * `null` is **every** level and not *no* level, which is the only safe reading
   * of an unknown in this module: the one-directional error the docblock proves
   * for the plan axis has to hold on the vertical one too, so a subject with no
   * level is tested against every other and over-reports rather than missing.
   * The ghost is the case — it belongs to no template, so there is no slot rule
   * to ask.
   */
  readonly level: PlanLevel | null
  /** The exact bounding box of the outline. The reject filter, and it is sound — see above. */
  readonly box: PlanBox
  /**
   * The piece as convex polygons. One for the five straight cases; 3 to 14 for a
   * sector, whose union contains it. `geometry.ts` produces these.
   */
  readonly parts: readonly PlanPart[]
  /**
   * Whether the piece's **drawn** angle is a whole number of quarter turns, so
   * that its box *is* its shape. Only the corner-junction exemption reads it,
   * and only to refuse to apply itself to a piece whose box is not its shape —
   * which for a `diag` at rotation 0 means refusing on the intrinsic 45°.
   */
  readonly axisAligned: boolean
}

/**
 * One **part** of one placement, identified by the placement it belongs to.
 *
 * Since row **A1** a placement is a template instance with a fill per named
 * slot, so one placement contributes N candidates and they all carry the same
 * {@link PlacementId}. That is deliberate and it is what keeps
 * `PlanScene.conflicts` a set of placement ids: the question the room asks is
 * *is this piece in conflict*, and every consumer of the set — the hatch, the
 * count, the bill's warning row — is asking it about a piece.
 *
 * The consequence is the rule in {@link findConflicts}: **two candidates with
 * the same id are never tested against each other.** That is not tidiness, and
 * the corpus is what makes it load bearing: measured over
 * `src/screens/assemblies/templates.ts`, **all 40 shipped templates declare both
 * a `floor` slot and a `base` slot**. A base sits under its floor by
 * construction, so those two parts occupy the same square in the same `area`
 * band on *every instance the app can place* — and without this rule every
 * instance in every room would report a conflict with itself and the hatch would
 * mean nothing at all.
 */
export interface OverlapCandidate extends OverlapSubject {
  readonly id: PlacementId
}

/**
 * The top of a level's vertical extent, in millimetres, as an *inclusive* bound.
 *
 * Two sentences, and the second is the reason this is a function rather than an
 * addition at the call site:
 *
 *   - A piece with a thickness reaches `elevationMm + heightMm`, and a piece
 *     resting exactly on that top must not be a conflict — `TOUCH_MM` off the
 *     top is the vertical spelling of the rule {@link TOUCH_EPS} states for a
 *     shared face, and a floor resting on a 6 mm base is the case.
 *   - A piece with no thickness reaches its own underside, so two of them at one
 *     elevation *do* meet and are a conflict — which is the answer the corpus
 *     forces, every catalog record having no height at all.
 *
 * The two would cancel out if the tolerance were applied to both: subtracting it
 * from a zero-height level would put its top *below* its own bottom and nothing
 * would ever collide with anything.
 */
function ceilingMm(level: PlanLevel): number {
  return level.heightMm === 0 ? level.elevationMm : level.elevationMm + level.heightMm - TOUCH_MM
}

/**
 * Whether two pieces share vertical space — the test that makes a wall standing
 * on a floor legal.
 *
 * A closed-interval intersection over {@link ceilingMm}, with one deliberate
 * asymmetry: **a subject with no level at all overlaps every other.** See
 * {@link OverlapSubject.level} for why the unknown resolves that way rather than
 * the other.
 */
function levelsOverlap(a: OverlapSubject, b: OverlapSubject): boolean {
  const here = a.level
  const there = b.level
  if (here === null || there === null) return true
  return here.elevationMm <= ceilingMm(there) && there.elevationMm <= ceilingMm(here)
}

function boxesIntersect(a: PlanBox, b: PlanBox): boolean {
  return (
    a.x + a.w - b.x > TOUCH_EPS &&
    b.x + b.w - a.x > TOUCH_EPS &&
    a.z + a.d - b.z > TOUCH_EPS &&
    b.z + b.d - a.z > TOUCH_EPS
  )
}

/** Project a polygon onto an axis and return its span. */
function project(quad: PlanPart, ax: number, az: number): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity
  for (const [x, z] of quad) {
    const value = x * ax + z * az
    if (value < min) min = value
    if (value > max) max = value
  }
  return { min, max }
}

/** Whether any edge normal of `quad` separates it from `other`. */
function separatedByEdgesOf(quad: PlanPart, other: PlanPart): boolean {
  for (let i = 0; i < quad.length; i += 1) {
    const [ax, az] = quad[i] as PlanPoint
    const [bx, bz] = quad[(i + 1) % quad.length] as PlanPoint
    // Outward normal of this edge; length is irrelevant to the sign of the gap,
    // but it does scale it, so normalise to keep TOUCH_EPS in grid units.
    const nx = bz - az
    const nz = -(bx - ax)
    const length = Math.hypot(nx, nz)
    if (length < TOUCH_EPS) continue
    const a = project(quad, nx / length, nz / length)
    const b = project(other, nx / length, nz / length)
    if (a.max - b.min <= TOUCH_EPS || b.max - a.min <= TOUCH_EPS) return true
  }
  return false
}

/** Which axis a box is longer on, or `null` when it is square. */
function longAxis(box: PlanBox): 'x' | 'z' | null {
  if (box.w - box.d > TOUCH_EPS) return 'x'
  if (box.d - box.w > TOUCH_EPS) return 'z'
  return null
}

/**
 * Whether two edge pieces are simply meeting at a corner.
 *
 * See the module docblock. Every clause is doing work: the band check keeps
 * floors out of it, the axis-aligned check keeps it away from pieces whose box is
 * not their shape, the size check keeps it to a single corner square, and the
 * perpendicular check is what separates a corner from a collinear overlap.
 *
 * **Three of the four edge-band footprints never reach it, and deliberately.**
 * A `column` is square, so `longAxis` is `null` and there is no perpendicular
 * pair to find — which is right, because a column at the end of a wall run
 * *replaces* the corner piece rather than sharing a square with it, and nobody
 * prints both. A `diag` is drawn at 45° or at 135°, so `axisAligned` is false. A
 * curved wall is either square-boxed (at a 90° sweep) or not axis-aligned (at
 * every other sweep). All three therefore fall through to the plain answer: a
 * real shared area is flagged, and merely abutting is not, which is what the
 * `TOUCH_EPS` box reject already gives them.
 *
 * ## Row A7 measured whether the interval retires it. It does not.
 *
 * The brief's guess was that an exemption existing to excuse a false positive is
 * dead weight once the false positive is gone. Two measurements say otherwise,
 * and they point in opposite directions:
 *
 *   - **The interval cannot separate a corner.** Two walls meeting at one rest on
 *     the *same* floor, so they carry the same `elevationMm` and
 *     {@link levelsOverlap} passes them straight through. Whatever the layout
 *     rule becomes, a corner stays a same-level pair — so this is the one
 *     same-level overlap that is legal and it needs its own sentence.
 *   - **The intra-template mitre B2 warned about is unreachable, so it was never
 *     this function's to get wrong.** No call path tests two parts of one
 *     instance against each other: {@link findConflicts} skips same-id pairs,
 *     `move.ts#previewMove` filters `candidate.id !== drag.id` before it tests
 *     anything, and `ghost.ts` compares a record that is in no instance at all.
 *     A template's own five slots therefore never reach a predicate. What this
 *     exemption does see is two **adjacent** corner templates, which is a
 *     different case and a real one.
 */
function isCornerJunction(a: OverlapSubject, b: OverlapSubject): boolean {
  if (a.band !== 'edge' || b.band !== 'edge') return false
  if (!a.axisAligned || !b.axisAligned) return false
  const sharedX = Math.min(a.box.x + a.box.w, b.box.x + b.box.w) - Math.max(a.box.x, b.box.x)
  const sharedZ = Math.min(a.box.z + a.box.d, b.box.z + b.box.d) - Math.max(a.box.z, b.box.z)
  if (sharedX > WALL_THICKNESS_UNITS + TOUCH_EPS || sharedZ > WALL_THICKNESS_UNITS + TOUCH_EPS) return false
  const axisA = longAxis(a.box)
  const axisB = longAxis(b.box)
  return axisA !== null && axisB !== null && axisA !== axisB
}

/**
 * Whether two pieces are in conflict — the single predicate, used by both the
 * scene's conflict pass and the ghost's prediction.
 *
 * One function rather than two, because a ghost that predicted a conflict the
 * scene then did not report would be worse than either answer on its own.
 *
 * Five gates, ordered by cost rather than by importance: a band compare, then
 * two additions and two compares on the vertical interval, then the exact box
 * reject, then SAT over the convex parts, then the corner exemption. Only the
 * last two can cost more than constant time, and neither is reached until the
 * three cheap ones have all said yes.
 */
export function subjectsConflict(a: OverlapSubject, b: OverlapSubject): boolean {
  if (a.band !== b.band) return false
  if (!levelsOverlap(a, b)) return false
  if (!boxesIntersect(a.box, b.box)) return false
  if (!partsOverlap(a.parts, b.parts)) return false
  return !isCornerJunction(a, b)
}

/**
 * Whether two convex polygons share interior area. Touching faces do not count.
 *
 * The separating-axis test itself, and the one place the theorem's premise —
 * both arguments convex — has to hold. Callers with a curved footprint go
 * through {@link partsOverlap}, never this.
 */
export function quadsOverlap(a: PlanPart, b: PlanPart): boolean {
  return !separatedByEdgesOf(a, b) && !separatedByEdgesOf(b, a)
}

/**
 * Whether any convex part of one piece overlaps any convex part of the other.
 *
 * The union of convex sets is not convex, so this is the only way to compose
 * SAT over a decomposition: pairwise, and any hit is a hit. Worst case in the
 * corpus is 14 × 14 = 196 pairs, for two of the 20 sectors at `rOut = 6,
 * sweep = 11.25°`, and only once the box reject has already passed.
 */
export function partsOverlap(a: readonly PlanPart[], b: readonly PlanPart[]): boolean {
  return a.some((one) => b.some((other) => quadsOverlap(one, other)))
}

/**
 * Every placement that shares interior area with another in its own band.
 *
 * Swept on `x` rather than compared pairwise: the candidates are sorted by their
 * left edge and each one is compared only against those still open at its left
 * edge, so a room laid out along a corridor costs about `n` comparisons instead
 * of `n²/2`. At the 200 placements this PR was measured against the difference
 * is a fraction of a millisecond either way; it matters at the 2,000 a large
 * dungeon reaches, where the pairwise version is two million tests on every
 * store write.
 */
export function findConflicts(candidates: readonly OverlapCandidate[]): ReadonlySet<PlacementId> {
  const conflicts = new Set<PlacementId>()
  const ordered = [...candidates].sort((a, b) => a.box.x - b.box.x)
  const open: OverlapCandidate[] = []

  for (const candidate of ordered) {
    // Drop everything whose right edge is left of this candidate's left edge —
    // it cannot intersect this one or anything further right.
    for (let i = open.length - 1; i >= 0; i -= 1) {
      const other = open[i] as OverlapCandidate
      if (other.box.x + other.box.w - candidate.box.x <= TOUCH_EPS) open.splice(i, 1)
    }
    for (const other of open) {
      // Two parts of one instance are never a conflict — see
      // {@link OverlapCandidate}. A piece cannot collide with itself, and since
      // row A1 that sentence has content: a template's stacked slots would
      // otherwise light up every instance in the room.
      if (other.id === candidate.id) continue
      if (!subjectsConflict(other, candidate)) continue
      conflicts.add(candidate.id)
      conflicts.add(other.id)
    }
    open.push(candidate)
  }

  return conflicts
}
