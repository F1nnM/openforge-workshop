/**
 * Slot name in, mount out — the layer that turns depth-map geometry into the
 * five kinds of place an accessory can be attached to.
 *
 * ## The slot name decides what to look for, and that is a cost decision
 *
 * 1,005 of the 8,702 live catalog rows carry an accessory slot, spelled with
 * **28 distinct names** (measured over `public/catalog/catalog.json`: `torch`
 * 356 files, `door` 248, `lintel` 143, `frame` and `shutters` 71 each, `grate`
 * 66, `portcullis` 65, `treasure` 55, down to one `broken_section`). Every one
 * of them is in {@link SLOT_CLASSES}, because the name is the only cheap
 * evidence available *before* measuring, and measuring is what costs:
 *
 *   - one `socketPoses` sweep over its 31 tilt angles costs **≈14 s** on a
 *     50 mm wall, and the four side faces of a host make that ≈56 s;
 *   - a single `columns` pass costs **≈0.4 s** on a 170k-triangle wall.
 *
 * So the tilt sweep runs only for a host that declares a socket- or
 * pocket-class slot, hole detection only for a floor (a `rect` footprint under
 * {@link STANDING_HEIGHT_MM}), and the through-cast only where an opening or the
 * socket exclusion below needs it. A `statue` on a floor tile costs one bounding
 * box; without the gate it would cost a minute, and 1,005 hosts of that is nine
 * hours of build time spent finding nothing.
 *
 * A pocket-class slot is swept at **θ = 0 only, on the two thin faces**, which
 * is a fraction of the socket sweep: a treasure niche is square to its face by
 * construction, and {@link isTreasurePocket} would discard every tilted frame
 * anyway.
 *
 * ## Sockets are the tight rule, and the openings mask them
 *
 * A Dupont socket enters its face at 62–65° (measured on 38 sockets across
 * every torch family), so the acceptance band here is 58–68° with a 5–6.5 ×
 * 2–3.5 mm mouth and ≥ 12 mm of depth — a slot the 0.5 mm grid resolves at
 * 11 × 6 cells. That rule is narrow enough that the one thing which can still
 * impersonate it is the *edge of a doorway*, where the local median baseline
 * sits on the reveal rather than on the face. Hence every candidate within
 * {@link OPENING_CLEARANCE_MM} of an opening's box is dropped, which is why the
 * through-cast also runs for a socket host with no opening slot at all.
 *
 * ## "Modelled in" is measured as enclosed voids, not as bare through-columns
 *
 * A slot with nothing to show for it is worth telling apart two ways: the host
 * has a hole that does not pass the rule, or the host has no hole at all and the
 * feature is sculpted into the solid. The second is `modelled-in`, and the test
 * for it is **no enclosed empty cell inside the silhouette on the thin axis** —
 * an empty column with material above it *and* material either side of it in its
 * own row ({@link silhouetteOf}).
 *
 * Counting bare empty columns instead would call a crenellated wall's sky a
 * void and report a wall with its door modelled in as `no-opening`, which is a
 * different instruction to whoever reads the build log. The trade-off runs the
 * other way for one shape: an open-topped opening so wide that
 * `throughOpenings` cannot see it — see the top-line note below — has no
 * enclosed cell either, so it also reads `modelled-in` today rather than
 * `no-opening`. `classify.test.ts` pins that case as it stands.
 *
 * The near-full-width case is `geometry.ts`'s, not this file's:
 * `throughOpenings` takes the roof line as the **90th percentile** of per-column
 * tops, so an open-topped opening spanning more than about 90% of a host's
 * columns drags that line below its own sill and leaves no silhouette to cut an
 * opening out of.
 *
 * ## Everything comes out in bbox coordinates
 *
 * Hosts are authored wherever the modeller left them — the cut-stone door wall
 * sits at y 53.5..66.5 — and the room places a tile by its footprint, not by the
 * modeller's origin. So every `at` goes through {@link toBboxCoordinates}: x and
 * y from the bbox centre, z from the bbox bottom, axes left as unit vectors.
 * `sill` and `head` are measured the same way, so a lintel's height and a
 * mount's `at[2]` are in one frame.
 *
 * Curved hosts are read in `arcs.ts`'s unrolled frame and every pose is rolled
 * back onto the arc before that conversion, so a consumer never sees an
 * unrolled coordinate. `face` is the one thing that stays in the unrolled frame
 * — it is a label, and on a sector `-y` is the inner radius rather than a plane
 * — so every mount also carries {@link outwardNormal}'s `normal`, the re-rolled
 * outward surface normal, which is what an insert is actually oriented by.
 */

import type {
  Face,
  Footprint,
  HoleMount,
  InsertAnchor,
  Mount,
  OpeningMount,
  SocketMount,
  SurfaceMount,
  Vec3,
} from '../../src/catalog'
import { GRID_UNIT_MM, faceVector } from '../../src/catalog'
import type { ArcFit } from './arcs'
import { ARC_FIT_MIN_ON_RADIUS, fitArcCentre, reroll, rerollVector, unroll } from './arcs'
import type { Axis, Columns, Opening } from './geometry'
import { CELL_MM, columns, throughOpenings } from './geometry'
import type { Pocket, SweepOptions } from './sockets'
import { POCKET_MIN_DEPTH_MM, socketPoses } from './sockets'

/**
 * The five kinds of mount, the six faces and the millimetre triple they are
 * spelled in all come from the **catalog contract**, not from this file.
 *
 * They used to be declared here and inferred from Zod there, which is two
 * declarations of one shape with a build step between them: this tool writes
 * `pipeline/mounts/inventory.json`, the pipeline parses it, and a field renamed
 * on one side would have surfaced as a parse failure over 16 GB of measurement
 * rather than as a compile error. `src/catalog/schema.ts` owns them, and its
 * `Vec3` docblock owns the coordinate contract {@link toBboxCoordinates}
 * enforces.
 */
export type { Face, HoleMount, InsertAnchor, Mount, OpeningMount, SocketMount, SurfaceMount, Vec3 }

/** An axis-aligned box in mesh millimetres. */
export interface Bounds {
  readonly min: Vec3
  readonly max: Vec3
}

/**
 * Why a slot got no mount. Each is a different thing to do about it.
 *
 *   - `no-opening` / `no-socket` / `no-hole` / `no-pocket` — the cast ran and
 *     found nothing that passes that class's rule. The host has *something*
 *     cut into it; it does not pass.
 *   - `modelled-in` — **no enclosed empty cell inside the silhouette on the thin
 *     axis**: the host is not cut through at all, so the feature is sculpted into
 *     the solid and there is nothing to fit an accessory into. See
 *     {@link silhouetteOf} for what "enclosed" means, and the docblock at the top
 *     of this file for the case it gets wrong.
 *   - `runs-off-end` — every opening reaches the end of the host, so there is no
 *     jamb to hinge against.
 *   - `arc-fit-refused` — the host is tagged as a sector but its mesh is not
 *     struck from those radii, so it cannot be unrolled and nothing is measured.
 */
export type UnresolvedReason =
  | 'no-opening'
  | 'no-socket'
  | 'no-hole'
  | 'no-pocket'
  | 'arc-fit-refused'
  | 'runs-off-end'
  | 'modelled-in'

export interface Unresolved {
  readonly slot: string
  readonly reason: UnresolvedReason
}

export interface HostSlot {
  readonly name: string
  readonly require: readonly string[]
}

export interface HostInput {
  readonly foot: Footprint
  readonly slots: readonly HostSlot[]
}

export interface HostMeasurement {
  readonly bbox: Bounds
  readonly arc?: ArcFit
  readonly mounts: readonly Mount[]
  readonly unresolved: readonly Unresolved[]
}

export interface InsertMeasurement {
  readonly bbox: Bounds
  readonly anchor: InsertAnchor
}

/** What a slot's name says to go looking for. `grate` is settled by host height. */
export type SlotClass = 'opening' | 'socket' | 'hole' | 'pocket' | 'surface' | 'grate'

/** A slot class with `grate` already resolved — what the matchers switch on. */
type ResolvedClass = Exclude<SlotClass, 'grate'>

/**
 * Every accessory slot name in the corpus, classed.
 *
 * All 28 of them are listed rather than left to the fallback, because a name
 * that is not here falls back to `'surface'` — the accessory is placed standing
 * on the host's top face, which is the one answer that always resolves and never
 * costs a cast. That is a safe default and a silent one, so the table is
 * exhaustive over the corpus on purpose: a new name is a table edit, not a
 * surface mount nobody ordered. A `grate` is an opening in a wall and a hole in a
 * floor, which is the one class a name alone cannot settle.
 */
export const SLOT_CLASSES: Readonly<Record<string, SlotClass>> = {
  arch: 'opening',
  archway: 'opening',
  beam: 'surface',
  brace: 'surface',
  brazier: 'surface',
  brazier_base: 'surface',
  broken_section: 'surface',
  crosshead: 'surface',
  door: 'opening',
  'fracture slope': 'surface',
  frame: 'opening',
  grate: 'grate',
  'grate (left)': 'grate',
  'grate (right)': 'grate',
  'grate door': 'opening',
  'grate flange': 'grate',
  lintel: 'opening',
  portcullis: 'opening',
  shutters: 'opening',
  slab_1: 'surface',
  slab_2: 'surface',
  statue: 'surface',
  support: 'surface',
  top: 'surface',
  torch: 'socket',
  trapdoor: 'hole',
  treasure: 'pocket',
  window: 'opening',
}

/** Below this a `rect` host is a floor: read from above, not from the side. */
const STANDING_HEIGHT_MM = 15

/** The `require` tags that mean a doorway takes two leaves rather than one. */
const TWO_LEAF_TAGS = ['size|wide', 'size|double']

/** How close to an opening a pocket may sit before it is that opening's reveal. */
const OPENING_CLEARANCE_MM = 3

/** The Dupont socket rule: entry angle, mouth and depth, from 38 measured sockets. */
const SOCKET_ANGLE_DEG = [58, 68] as const,
  SOCKET_WIDTH_MM = [5, 6.5] as const,
  SOCKET_THICKNESS_MM = [2, 3.5] as const,
  SOCKET_MIN_DEPTH_MM = 12

/**
 * A treasure niche's mouth, whichever way round it is measured — the three
 * catalog variants run 9, 13 and 30 mm nominal.
 */
const POCKET_SIZE_MM = [7, 32] as const

/**
 * The pocket sweep's own thresholds: any masked pocket is deep enough — a
 * treasure hollow measures 5–7 mm deep against the 12 mm the socket rule
 * wants — and its mouth may run as wide as {@link POCKET_SIZE_MM}'s top end.
 * θ = 0 and the thin faces are handled by the caller, not by these options.
 */
const POCKET_OPTIONS: SweepOptions = {
  angles: [0],
  minDepthMm: POCKET_MIN_DEPTH_MM,
  maxSizeMm: POCKET_SIZE_MM[1],
}

/** Thickest a slab may be, and shortest its other two sides, to be a leaf. */
const LEAF_MAX_THICKNESS_MM = 10,
  LEAF_MIN_SPAN_MM = 10

/** A peg's cross-section must be near-square, and its length between these. */
const PEG_CROSS_RATIO = 1.5,
  PEG_LENGTH_RATIO = 1.4,
  PEG_MAX_LENGTH_MM = 40

/** How near an end a vertex must sit to measure that end's cross-section. */
const PEG_END_BAND_MM = 1

/** How near its plane a triangle must sit to count as lying on a bbox face. */
const PLATE_PLANE_MM = 0.3

/** The fraction of a face a plate must cover, with its opposite under half of it. */
const PLATE_MIN_COVERAGE = 0.5

const AXIS_NAME = ['x', 'y', 'z'] as const

/** x and y from the bbox centre, z from the bbox bottom. Axes are not touched. */
export function toBboxCoordinates(p: Vec3, bbox: Bounds): Vec3 {
  return [
    p[0] - (bbox.min[0] + bbox.max[0]) / 2,
    p[1] - (bbox.min[1] + bbox.max[1]) / 2,
    p[2] - bbox.min[2],
  ]
}

/**
 * The bbox bottom-face centre in bbox coordinates — which is their origin, so
 * this is a constant rather than arithmetic that always cancels.
 */
const BOTTOM_CENTRE: Vec3 = [0, 0, 0]

function meshBounds(positions: ArrayLike<number>, triangles: number): Bounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let o = 0; o < triangles * 9; o += 3) {
    for (const axis of [0, 1, 2] as const) {
      const value = positions[o + axis] as number
      if (value < min[axis]) min[axis] = value
      if (value > max[axis]) max[axis] = value
    }
  }
  // A valid corpus STL can declare zero facets — the smallest live file is an
  // 84-byte header doing exactly that — and an empty mesh has no box, rather
  // than one spanning infinity.
  return Number.isFinite(min[0]) ? { min, max } : { min: [0, 0, 0], max: [0, 0, 0] }
}

function extentOf(bbox: Bounds): Vec3 {
  return [bbox.max[0] - bbox.min[0], bbox.max[1] - bbox.min[1], bbox.max[2] - bbox.min[2]]
}

function between(value: number, [lo, hi]: readonly [number, number]): boolean {
  return value >= lo && value <= hi
}

/**
 * Which face of the host a mount opens on.
 *
 * Named in the frame the mount was *read* in, so on a curved host `-y` and `+y`
 * are the inner and outer radius rather than two parallel planes — the `axis`
 * beside them is the rolled-back direction and carries the real orientation.
 */
function faceName(axis: Axis, sign: -1 | 1): Face {
  return `${sign < 0 ? '-' : '+'}${AXIS_NAME[axis]}`
}

/** The unit vector along `axis`, pointing whichever way `sign` says. */
function unitVector(axis: Axis, sign: -1 | 1): Vec3 {
  const v: [number, number, number] = [0, 0, 0]
  v[axis] = sign
  return v
}

/** The two axes that are not `axis`, ascending. */
function otherAxes(axis: Axis): readonly [Axis, Axis] {
  return axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1]
}

/** The centre of one bbox face, in mesh coordinates. */
function faceCentre(bbox: Bounds, axis: Axis, sign: -1 | 1): Vec3 {
  const p: [number, number, number] = [
    (bbox.min[0] + bbox.max[0]) / 2,
    (bbox.min[1] + bbox.max[1]) / 2,
    (bbox.min[2] + bbox.max[2]) / 2,
  ]
  p[axis] = sign < 0 ? bbox.min[axis] : bbox.max[axis]
  return p
}

/* ------------------------------------------------------------------- hosts */

/**
 * The frame the detector reads a host in.
 *
 * Flat hosts are read as authored; curved ones are unrolled about their fitted
 * centre, where `run` is arc length and `thin` is radius, and `back`/`backVec`
 * roll a pose and a direction back onto the arc. For a flat host both are the
 * identity, so nothing downstream has to know which kind it has.
 */
interface Frame {
  readonly work: ArrayLike<number>
  readonly thin: Axis
  readonly run: Axis
  /** Where an opening's mid-plane sits on `thin`: mid-thickness, or the mid radius. */
  readonly mid: number
  readonly curved: boolean
  readonly back: (p: Vec3) => Vec3
  readonly backVec: (p: Vec3, v: Vec3) => Vec3
}

interface Silhouette {
  /** First and last column of the cast to hit anything. */
  readonly left: number
  readonly right: number
  /**
   * Empty columns enclosed by material above and on both sides — every void the
   * host has, whether or not one is large enough to be an opening. Zero means
   * the feature is modelled in rather than cut through.
   */
  readonly voids: number
}

interface FoundOpening {
  readonly opening: Opening
  readonly offEnd: boolean
}

interface Openings {
  readonly list: readonly FoundOpening[]
  readonly silhouette: Silhouette
}

interface FoundPocket {
  readonly pocket: Pocket
  readonly faceAxis: Axis
  readonly face: Face
}

interface FoundHole {
  /** Mesh-space centre of the hole, on the host's top face. */
  readonly at: Vec3
  readonly size: readonly [number, number]
}

interface Found {
  readonly openings: Openings
  readonly sockets: readonly FoundPocket[]
  readonly holes: readonly FoundHole[]
}

interface Context {
  readonly bbox: Bounds
  readonly frame: Frame
}

interface Match {
  readonly mounts: readonly Mount[]
  readonly reason?: UnresolvedReason
}

/** Only reached by a host no class of which asks about openings. */
const NO_OPENINGS: Openings = { list: [], silhouette: { left: 0, right: -1, voids: 0 } }

/** Tall enough to be looked at from the side rather than from above. */
function isStanding(size: Vec3): boolean {
  return size[2] >= STANDING_HEIGHT_MM
}

function resolveClass(name: string, size: Vec3): ResolvedClass {
  const declared = SLOT_CLASSES[name] ?? 'surface'
  if (declared !== 'grate') return declared
  return isStanding(size) ? 'opening' : 'hole'
}

function isFloor(foot: Footprint, size: Vec3): boolean {
  return foot.shape === 'rect' && !isStanding(size)
}

function frameOf(
  foot: Footprint,
  arc: ArcFit | undefined,
  bbox: Bounds,
  size: Vec3,
  positions: ArrayLike<number>,
): Frame {
  if (foot.shape === 'arc' && arc !== undefined) {
    const centre = arc.centre,
      rMid = ((foot.rIn + foot.rOut) / 2) * GRID_UNIT_MM
    return {
      work: unroll(positions, centre, rMid),
      thin: 1,
      run: 0,
      mid: 0,
      curved: true,
      back: (p) => reroll(p, centre, rMid),
      backVec: (p, v) => rerollVector(p, v, centre, rMid),
    }
  }
  const thin: Axis = size[1] <= size[0] ? 1 : 0
  return {
    work: positions,
    thin,
    run: thin === 1 ? 0 : 1,
    mid: (bbox.min[thin] + bbox.max[thin]) / 2,
    curved: false,
    back: (p) => p,
    backVec: (_p, v) => v,
  }
}

/** A point of the work frame from its place along the run, its depth and z. */
function place(frame: Frame, u: number, w: number, z: number): Vec3 {
  const p: [number, number, number] = [0, 0, 0]
  p[frame.run] = u
  p[frame.thin] = w
  p[2] = z
  return p
}

/**
 * The outward unit normal of the host surface at a mount, in the **mesh** frame.
 *
 * `face` names the frame the mount was *read* in, so on a flat host this is
 * `faceVector(face)` and nothing more. On a curved one the unrolled `-y` and
 * `+y` are the inner and the outer radius, and the answer is that face normal
 * rolled back at the mount's own bearing — through the same `rerollVector` a
 * socket's `axis` goes through, so the two stay in one frame and
 * `dot(axis, normal)` is the cosine of the socket's tilt on an arc as it is on a
 * plane. `-y` is the inner face, so its normal points at the arc centre.
 *
 * `p` is the mount's own point in the work frame; a flat frame ignores it.
 */
function outwardNormal(face: Face, p: Vec3, frame: Frame): Vec3 {
  return frame.backVec(p, faceVector(face))
}

/**
 * The host's outline and its enclosed voids, in one pass over the cast.
 *
 * The top of each column and the ends of each row are all that "inside the
 * silhouette" needs here: a cell is a void when its own column carries material
 * above it and its own row carries material either side. A gap between two
 * crenels is therefore not a void, which is what separates a wall with its door
 * modelled in from a wall with a doorway too small to qualify.
 */
function silhouetteOf(col: Columns): Silhouette {
  const { nu, nv, hits } = col
  const tops = new Int32Array(nu).fill(-1)
  const rowFirst = new Int32Array(nv).fill(nu),
    rowLast = new Int32Array(nv).fill(-1)
  for (let i = 0; i < nu; i += 1) {
    for (let j = 0; j < nv; j += 1) {
      if ((hits[i * nv + j] as number) === 0) continue
      tops[i] = j
      if (i < (rowFirst[j] as number)) rowFirst[j] = i
      rowLast[j] = i
    }
  }

  let left = nu,
    right = -1,
    voids = 0
  for (let i = 0; i < nu; i += 1) {
    const top = tops[i] as number
    if (top >= 0) {
      if (i < left) left = i
      right = i
    }
    for (let j = 0; j < top; j += 1) {
      if ((hits[i * nv + j] as number) !== 0) continue
      if (i > (rowFirst[j] as number) && i < (rowLast[j] as number)) voids += 1
    }
  }
  return { left, right, voids }
}

/**
 * Whether an opening reaches the outermost column the silhouette leaves
 * maskable — the wall running out, rather than a hole in it.
 *
 * `throughOpenings` masks `left + 1 .. right − 1`, so an opening's own bbox edge
 * — its body centre, less half its bbox, back to a cell centre — landing on that
 * column means there is no jamb for a door to hinge against. Half a cell of
 * tolerance, because both sides of the comparison are cell centres a whole cell
 * apart and the opening's centre is a weighted mean rather than an exact bbox
 * midpoint.
 */
function runsOffEnd(o: Opening, col: Columns, s: Silhouette): boolean {
  const half = CELL_MM / 2
  const lo = o.at[0] - o.bboxSize[0] / 2 + half,
    hi = o.at[0] + o.bboxSize[0] / 2 - half
  return (
    lo - (col.ou + (s.left + 1.5) * CELL_MM) < half || col.ou + (s.right - 0.5) * CELL_MM - hi < half
  )
}

function findOpenings(frame: Frame, triangles: number): Openings {
  const col = columns(frame.work, triangles, frame.thin)
  const silhouette = silhouetteOf(col)
  return {
    list: throughOpenings(col).map((opening) => ({
      opening,
      offEnd: runsOffEnd(opening, col, silhouette),
    })),
    silhouette,
  }
}

/** A candidate whose mouth sits in an opening's reveal, not in the host's face. */
function nearOpening(pocket: Pocket, frame: Frame, openings: Openings): boolean {
  const u = pocket.entrance[frame.run],
    z = pocket.entrance[2]
  return openings.list.some(
    ({ opening }) =>
      Math.abs(u - opening.at[0]) <= opening.bboxSize[0] / 2 + OPENING_CLEARANCE_MM &&
      z >= opening.sill - OPENING_CLEARANCE_MM &&
      z <= opening.head + OPENING_CLEARANCE_MM,
  )
}

/** One face, one sweep: every pocket it turns up that is not an opening's reveal. */
function sweepFace(
  frame: Frame,
  triangles: number,
  faceAxis: Axis,
  sign: -1 | 1,
  options: SweepOptions,
  openings: Openings,
): readonly FoundPocket[] {
  const runAxis = faceAxis === frame.thin ? frame.run : frame.thin
  const out: FoundPocket[] = []
  for (const pocket of socketPoses(frame.work, triangles, faceAxis, runAxis, sign, options)) {
    if (nearOpening(pocket, frame, openings)) continue
    out.push({ pocket, faceAxis, face: faceName(faceAxis, sign) })
  }
  return out
}

/**
 * Every pocket of the faces worth sweeping, in the work frame.
 *
 * A socket-class slot pays the full tilt sweep over both pairs of side faces,
 * at the socket sweep's own (unmodified) thresholds. A pocket-class slot needs
 * only θ = 0 on the two thin faces, at {@link POCKET_OPTIONS}. A host that
 * declares both runs the two sweeps separately rather than merging their
 * options — a merged `maxSizeMm` could let a wider pocket-sized candidate
 * displace a genuine socket in `sockets.ts`'s per-cluster pick. A curved host
 * has one pair of faces for the socket sweep — the radii — because its ends
 * are cut planes rather than a surface anything mounts on.
 */
function findSockets(
  frame: Frame,
  triangles: number,
  wants: ReadonlySet<ResolvedClass>,
  openings: Openings,
): readonly FoundPocket[] {
  const out: FoundPocket[] = []
  if (wants.has('socket')) {
    const faces: readonly Axis[] = frame.curved ? [frame.thin] : [frame.thin, frame.run]
    for (const faceAxis of faces)
      for (const sign of [-1, 1] as const)
        out.push(...sweepFace(frame, triangles, faceAxis, sign, {}, openings))
  }
  if (wants.has('pocket')) {
    for (const sign of [-1, 1] as const)
      out.push(...sweepFace(frame, triangles, frame.thin, sign, POCKET_OPTIONS, openings))
  }
  return out
}

/** A void as wide as the face itself is the cast missing the slab, not a hole. */
function spansFace(o: Opening, col: Columns, s: Silhouette): boolean {
  return o.bboxSize[0] > (s.right - s.left - 2) * CELL_MM || o.bboxSize[1] > (col.nv - 2) * CELL_MM
}

/**
 * Holes read from above. Floors are flat by definition, so the cast's (u, v) are
 * already x and y and no frame mapping is owed.
 */
function findHoles(frame: Frame, triangles: number, bbox: Bounds): readonly FoundHole[] {
  const col = columns(frame.work, triangles, 2)
  const silhouette = silhouetteOf(col)
  const out: FoundHole[] = []
  for (const o of throughOpenings(col)) {
    if (o.openTop || spansFace(o, col, silhouette)) continue
    out.push({ at: [o.at[0], o.at[1], bbox.max[2]], size: [o.width, o.head - o.sill] })
  }
  return out
}

function openingMount(slot: HostSlot, o: Opening, ctx: Context): OpeningMount {
  const { frame, bbox } = ctx
  // Openings go through the host, so the face is informational: name the one the
  // thin axis points away from.
  const face = faceName(frame.thin, -1)
  const work = place(frame, o.at[0], frame.mid, o.at[1])
  return {
    slot: slot.name,
    kind: 'opening',
    face,
    normal: outwardNormal(face, work, frame),
    at: toBboxCoordinates(frame.back(work), bbox),
    width: o.width,
    sill: o.sill - bbox.min[2],
    head: o.head - bbox.min[2],
    openTop: o.openTop,
    leaves: TWO_LEAF_TAGS.some((tag) => slot.require.includes(tag)) ? 2 : 1,
  }
}

function socketMount(
  slot: HostSlot,
  kind: 'socket' | 'pocket',
  found: FoundPocket,
  ctx: Context,
): SocketMount {
  const { pocket } = found
  return {
    slot: slot.name,
    kind,
    face: found.face,
    normal: outwardNormal(found.face, pocket.entrance, ctx.frame),
    at: toBboxCoordinates(ctx.frame.back(pocket.entrance), ctx.bbox),
    axis: ctx.frame.backVec(pocket.entrance, pocket.axis),
    section: pocket.entranceSize,
    depth: pocket.depth,
  }
}

function holeMount(slot: HostSlot, hole: FoundHole, ctx: Context): HoleMount {
  return {
    slot: slot.name,
    kind: 'hole',
    face: '+z',
    // Read from above, and only ever on a flat floor: the top face's normal is
    // +z in the mesh frame with no re-rolling owed.
    normal: faceVector('+z'),
    at: toBboxCoordinates(hole.at, ctx.bbox),
    size: hole.size,
  }
}

function surfaceMount(slot: HostSlot, bbox: Bounds): SurfaceMount {
  return {
    slot: slot.name,
    kind: 'surface',
    face: '+z',
    // The accessory stands on the top face, whose normal is +z on a curved host
    // too — the roll turns the (x, y) plane and leaves z alone.
    normal: faceVector('+z'),
    at: toBboxCoordinates(faceCentre(bbox, 2, 1), bbox),
  }
}

/**
 * Whether a pocket is a Dupont socket: the entry angle, the mouth in both
 * directions, and the depth.
 *
 * Exported so the five thresholds can be tested on their own. A full sweep of a
 * real host is the only way to *produce* a socket pocket and costs ~14 s a face,
 * which is no way to check a bound.
 */
export function isDupontSocket(pocket: Pocket): boolean {
  return (
    between(pocket.angleFromNormal, SOCKET_ANGLE_DEG) &&
    between(pocket.entranceSize[0], SOCKET_WIDTH_MM) &&
    between(pocket.entranceSize[1], SOCKET_THICKNESS_MM) &&
    pocket.depth >= SOCKET_MIN_DEPTH_MM
  )
}

function isTreasurePocket({ pocket, faceAxis }: FoundPocket, frame: Frame): boolean {
  return (
    pocket.theta === 0 &&
    faceAxis === frame.thin &&
    between(Math.max(pocket.entranceSize[0], pocket.entranceSize[1]), POCKET_SIZE_MM)
  )
}

function matchOpening(slot: HostSlot, openings: Openings, ctx: Context): Match {
  const usable = openings.list.filter((found) => !found.offEnd)
  if (usable.length > 0)
    return { mounts: usable.map(({ opening }) => openingMount(slot, opening, ctx)) }
  if (openings.list.length > 0) return { mounts: [], reason: 'runs-off-end' }
  return { mounts: [], reason: openings.silhouette.voids === 0 ? 'modelled-in' : 'no-opening' }
}

function matchSocket(slot: HostSlot, sockets: readonly FoundPocket[], ctx: Context): Match {
  const kept = sockets.filter((found) => isDupontSocket(found.pocket))
  if (kept.length === 0) return { mounts: [], reason: 'no-socket' }
  return { mounts: kept.map((found) => socketMount(slot, 'socket', found, ctx)) }
}

function matchPocket(slot: HostSlot, sockets: readonly FoundPocket[], ctx: Context): Match {
  let best: FoundPocket | undefined
  for (const found of sockets) {
    if (!isTreasurePocket(found, ctx.frame)) continue
    if (best === undefined || found.pocket.depth > best.pocket.depth) best = found
  }
  if (best === undefined) return { mounts: [], reason: 'no-pocket' }
  return { mounts: [socketMount(slot, 'pocket', best, ctx)] }
}

function matchHole(slot: HostSlot, holes: readonly FoundHole[], ctx: Context): Match {
  if (holes.length === 0) return { mounts: [], reason: 'no-hole' }
  return { mounts: holes.map((hole) => holeMount(slot, hole, ctx)) }
}

function matchSlot(slot: HostSlot, cls: ResolvedClass, found: Found, ctx: Context): Match {
  switch (cls) {
    case 'opening':
      return matchOpening(slot, found.openings, ctx)
    case 'socket':
      return matchSocket(slot, found.sockets, ctx)
    case 'pocket':
      return matchPocket(slot, found.sockets, ctx)
    case 'hole':
      return matchHole(slot, found.holes, ctx)
    case 'surface':
      return { mounts: [surfaceMount(slot, ctx.bbox)] }
  }
}

/**
 * Measure one host: what each of its slots attaches to, or why nothing does.
 *
 * The classes its slots resolve to decide which casts run at all — see the
 * docblock at the top of the file for what each one costs.
 */
export function analyseHost(
  input: HostInput,
  positions: Float32Array,
  triangles: number,
): HostMeasurement {
  const bbox = meshBounds(positions, triangles)
  const size = extentOf(bbox)
  const slots = input.slots.map((slot) => ({ slot, cls: resolveClass(slot.name, size) }))
  const arc =
    input.foot.shape === 'arc'
      ? fitArcCentre(
          positions,
          triangles,
          input.foot.rIn * GRID_UNIT_MM,
          input.foot.rOut * GRID_UNIT_MM,
        )
      : undefined
  // A host tagged as a sector whose mesh is not struck from those radii cannot
  // be unrolled, and reading it flat would put every mount on a chord.
  if (arc !== undefined && arc.onRadius < ARC_FIT_MIN_ON_RADIUS)
    return {
      bbox,
      arc,
      mounts: [],
      unresolved: slots.map(({ slot }) => ({ slot: slot.name, reason: 'arc-fit-refused' })),
    }

  const frame = frameOf(input.foot, arc, bbox, size, positions)
  const wants = new Set(slots.map(({ cls }) => cls))
  const hunting = wants.has('socket') || wants.has('pocket')
  const openings = wants.has('opening') || hunting ? findOpenings(frame, triangles) : NO_OPENINGS
  const found: Found = {
    openings,
    sockets: hunting ? findSockets(frame, triangles, wants, openings) : [],
    holes: wants.has('hole') && isFloor(input.foot, size) ? findHoles(frame, triangles, bbox) : [],
  }

  const ctx: Context = { bbox, frame }
  const mounts: Mount[] = []
  const unresolved: Unresolved[] = []
  for (const { slot, cls } of slots) {
    const match = matchSlot(slot, cls, found, ctx)
    mounts.push(...match.mounts)
    if (match.reason !== undefined) unresolved.push({ slot: slot.name, reason: match.reason })
  }
  return { bbox, ...(arc === undefined ? {} : { arc }), mounts, unresolved }
}

/* ----------------------------------------------------------------- inserts */

/** The area of one triangle of the soup. */
function triangleArea(positions: ArrayLike<number>, o: number): number {
  const ax = (positions[o + 3] as number) - (positions[o] as number),
    ay = (positions[o + 4] as number) - (positions[o + 1] as number),
    az = (positions[o + 5] as number) - (positions[o + 2] as number)
  const bx = (positions[o + 6] as number) - (positions[o] as number),
    by = (positions[o + 7] as number) - (positions[o + 1] as number),
    bz = (positions[o + 8] as number) - (positions[o + 2] as number)
  return Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) / 2
}

/**
 * The fraction of each bbox face actually covered by surface, indexed
 * `axis * 2 + (max face ? 1 : 0)` so `face ^ 1` is the opposite one.
 *
 * A triangle counts for a face when all three of its vertices lie within
 * {@link PLATE_PLANE_MM} of that face's plane, and its own area is then its
 * projected area to within that tolerance.
 */
function faceCoverage(positions: ArrayLike<number>, triangles: number, bbox: Bounds): Float64Array {
  const covered = new Float64Array(6)
  for (let t = 0; t < triangles; t += 1) {
    const o = t * 9
    const area = triangleArea(positions, o)
    for (let face = 0; face < 6; face += 1) {
      const axis = (face >> 1) as Axis
      const plane = face % 2 === 0 ? bbox.min[axis] : bbox.max[axis]
      let on = true
      for (let k = 0; k < 3 && on; k += 1)
        on = Math.abs((positions[o + k * 3 + axis] as number) - plane) <= PLATE_PLANE_MM
      if (on) covered[face] = (covered[face] as number) + area
    }
  }

  const size = extentOf(bbox)
  for (let face = 0; face < 6; face += 1) {
    const [u, v] = otherAxes((face >> 1) as Axis)
    const whole = size[u] * size[v]
    covered[face] = whole > 0 ? (covered[face] as number) / whole : 0
  }
  return covered
}

function thinnestAxis(size: Vec3): Axis {
  if (size[0] <= size[1] && size[0] <= size[2]) return 0
  return size[1] <= size[2] ? 1 : 2
}

function longestAxis(size: Vec3): Axis {
  if (size[0] >= size[1] && size[0] >= size[2]) return 0
  return size[1] >= size[2] ? 1 : 2
}

/**
 * Which end of `axis` carries the wider cross-section — the base a peg is meant
 * to be pushed in by. Ties go to the low end, which is how a peg standing on the
 * build plate is authored.
 */
function widerEnd(
  positions: ArrayLike<number>,
  triangles: number,
  bbox: Bounds,
  axis: Axis,
): -1 | 1 {
  const [u, v] = otherAxes(axis)
  const span = [0, 0]
  for (const end of [0, 1] as const) {
    const plane = end === 0 ? bbox.min[axis] : bbox.max[axis]
    let uMin = Infinity,
      uMax = -Infinity,
      vMin = Infinity,
      vMax = -Infinity
    for (let o = 0; o < triangles * 9; o += 3) {
      if (Math.abs((positions[o + axis] as number) - plane) > PEG_END_BAND_MM) continue
      const pu = positions[o + u] as number,
        pv = positions[o + v] as number
      if (pu < uMin) uMin = pu
      if (pu > uMax) uMax = pu
      if (pv < vMin) vMin = pv
      if (pv > vMax) vMax = pv
    }
    span[end] = uMax > uMin && vMax > vMin ? (uMax - uMin) * (vMax - vMin) : 0
  }
  return (span[1] as number) > (span[0] as number) ? 1 : -1
}

/**
 * A slab: thin one way, wide the other two. Its axis is the thin one.
 *
 * **Positive by convention, and that is a limitation rather than a
 * measurement.** {@link InsertAnchor}'s `axis` runs from `at` into the body, and
 * a leaf's body straddles the thin axis: a door is a slab with a front and a
 * back, and nothing in the mesh says which is which. So `+thin` is chosen and
 * declared, and a leaf hung the wrong way round is a face-flip the consumer
 * cannot detect either — see `src/builder/three/place.ts#openingSeat`, which
 * seats a leaf on the opening's mid-plane where the choice costs nothing but the
 * side the relief faces.
 */
function leafAnchor(size: Vec3): InsertAnchor | undefined {
  const thin = thinnestAxis(size)
  const [u, v] = otherAxes(thin)
  if (size[thin] > LEAF_MAX_THICKNESS_MM) return undefined
  if (size[u] < LEAF_MIN_SPAN_MM || size[v] < LEAF_MIN_SPAN_MM) return undefined
  return { kind: 'leaf', at: BOTTOM_CENTRE, axis: unitVector(thin, 1), size }
}

/**
 * A near-square prism, longer than it is thick: anchored on its wider end.
 *
 * Tried **after** {@link plateAnchor} — see {@link analyseInsert} for the
 * measurement that ordering came from.
 *
 * The axis runs **from that end towards the other one**, which is the whole of
 * {@link InsertAnchor}'s sign convention on the one kind that can be authored
 * either way up. `widerEnd` picks the flange and `at` is that end's face centre,
 * so the body lies at `−widerEnd` along the long axis and `+1` would point out
 * of the insert. `torch.stl` has its flange at the min end and read correctly
 * under either sign; the 356 torch files are not all authored that way, and one
 * that is not would have been seated *inside* the wall.
 */
function pegAnchor(
  positions: ArrayLike<number>,
  triangles: number,
  bbox: Bounds,
  size: Vec3,
): InsertAnchor | undefined {
  const long = longestAxis(size)
  const [u, v] = otherAxes(long)
  const thinner = Math.min(size[u], size[v]),
    thicker = Math.max(size[u], size[v])
  if (thicker > thinner * PEG_CROSS_RATIO) return undefined
  if (size[long] < thicker * PEG_LENGTH_RATIO || size[long] > PEG_MAX_LENGTH_MM) return undefined
  const end = widerEnd(positions, triangles, bbox, long)
  return {
    kind: 'peg',
    at: toBboxCoordinates(faceCentre(bbox, long, end), bbox),
    axis: unitVector(long, end < 0 ? 1 : -1),
    size,
  }
}

/**
 * One face carries the surface, and its opposite carries under half of it.
 *
 * The axis is that face's **inward** normal, which is {@link InsertAnchor}'s
 * convention with nothing else to decide: `at` is the flat face and the body is
 * the only place left to point at.
 */
function plateAnchor(
  positions: ArrayLike<number>,
  triangles: number,
  bbox: Bounds,
  size: Vec3,
): InsertAnchor | undefined {
  const covered = faceCoverage(positions, triangles, bbox)
  let best = -1,
    bestCover = 0
  for (let face = 0; face < 6; face += 1) {
    const cover = covered[face] as number,
      opposite = covered[face ^ 1] as number
    if (cover < PLATE_MIN_COVERAGE || opposite > cover / 2) continue
    if (cover > bestCover) {
      bestCover = cover
      best = face
    }
  }
  if (best < 0) return undefined

  const axis = (best >> 1) as Axis,
    sign: -1 | 1 = best % 2 === 0 ? -1 : 1
  return {
    kind: 'plate',
    at: toBboxCoordinates(faceCentre(bbox, axis, sign), bbox),
    // Into the body, off the face it lies on: a consumer aligns the direction
    // out of the host to it and the plate lands flat against the host.
    axis: unitVector(axis, sign < 0 ? 1 : -1),
    size,
  }
}

function anchorOf(
  positions: ArrayLike<number>,
  triangles: number,
  bbox: Bounds,
  size: Vec3,
): InsertAnchor {
  return (
    leafAnchor(size) ??
    plateAnchor(positions, triangles, bbox, size) ??
    pegAnchor(positions, triangles, bbox, size) ?? {
      // The fallback: it stands on its own bottom face, so `+z` is up through
      // the body — the convention with the least measured about it.
      kind: 'block',
      at: BOTTOM_CENTRE,
      axis: [0, 0, 1],
      size,
    }
  )
}

/**
 * Measure one insert: the box it occupies and the anchor it presents.
 *
 * Ordered leaf → **plate** → peg → block, because the tests each shape passes
 * are not exclusive — a door leaf is also a one-sided plate — and the earlier
 * kinds are the more specific claims.
 *
 * **Plate before peg, and that ordering is a measurement.** `torch_plate.stl` is
 * 7.5 × 8.9 × 13.5 mm: a flat back plate with a short body protruding from it,
 * and a near-square prism 1.4× longer than it is thick. It therefore satisfies
 * {@link pegAnchor} as well as {@link plateAnchor}, and under peg-first it came
 * back a `peg` anchored on the *end* of its longest axis — which hung the whole
 * accessory off the wrong face and left the spec's `socket` + `plate` renderer
 * row with nothing in the corpus to exercise it. A ≥ 50 % flat face whose
 * opposite carries under half of it is the *stronger* claim of the two: it is a
 * measurement of where the piece lies against the host, where the peg rule is an
 * inference from three bbox ratios. The plate rule's own asymmetry now also
 * catches `torch.stl` — a 7 × 7 × 12 mm prism with a flat 7 × 7 base and a
 * tapered head — which reads `plate` with a byte-identical anchor (`at [0,0,0]`,
 * `axis [0,0,1]`) to what {@link pegAnchor} gave it before. The render is
 * unchanged either way, because a socket mount aligns the anchor *axis*
 * regardless of `kind`, and the only place in `src/` that reads `anchor.kind`
 * is `copiesOf`'s `leaf` test. No corpus insert now exercises the spec's
 * `socket` + `peg` row — the `brazier+small` blobs and the synthetic fixtures
 * keep {@link pegAnchor} itself covered.
 *
 * **Every kind's `axis` runs from `at` into the insert's body** — the contract
 * `src/catalog/schema.ts#InsertAnchor` states and `place.ts#accessoryMatrix`
 * consumes by aligning it with the direction *out of* the host. Only `peg` has
 * to measure which way that is; `leaf` cannot know and says so.
 */
export function analyseInsert(positions: Float32Array, triangles: number): InsertMeasurement {
  const bbox = meshBounds(positions, triangles)
  return { bbox, anchor: anchorOf(positions, triangles, bbox, extentOf(bbox)) }
}
