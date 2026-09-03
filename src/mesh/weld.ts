/**
 * A triangle soup → an indexed mesh, on **position alone**. The whole trick.
 *
 * ## Why this is not `weld()` from the LOD pipeline
 *
 * `tools/lod/decimate.ts` does the same job through glTF Transform, and its
 * docblock is the reason this module exists rather than being a call into it:
 * welding a binary STL with its facet normals still attached is a **silent
 * no-op**. An STL stores one normal per *facet* and shares no vertices, so two
 * triangles meeting at a corner disagree about that corner and nothing merges.
 * Measured there, on real catalog meshes, welding position-and-normal against
 * position-only:
 *
 * | mesh | source tris | welded, +normals | welded, positions only |
 * | --- | --- | --- | --- |
 * | `8180da93…` | 118 | 326 (0.921×) | **59 (0.167×)** |
 * | `5234f9d5…` | 207,296 | 474,729 (0.763×) | **103,678 (0.167×)** |
 * | `2d32f890…` | 2,178,242 | 6,488,791 (0.993×) | **1,090,458 (0.167×)** |
 *
 * With the normals left in, that last mesh simplifies from 2,178,242 triangles
 * to 2,174,382 — a 0.18% reduction, reported as success. So the cost of getting
 * this wrong is six times the GPU memory and no error anywhere, which is why
 * {@link assertWeldDropped} runs on every mesh here too and why it is a hard
 * failure rather than a warning.
 *
 * `src/three/stl/parse.ts` never produces a normal attribute — it skips the 12
 * stored bytes per facet on the way past — so the trap cannot be armed through
 * this path. That is not a reason to drop the assertion: it is the reason the
 * assertion is cheap. It is also the only thing standing between a future
 * "helpful" `computeVertexNormals()` upstream of here and a builder that renders
 * at 6× the cost.
 *
 * ## Bitwise, not tolerant
 *
 * Two corners merge when their three `float32` bit patterns are equal, which is
 * glTF Transform's `weld()` at its default tolerance of 0 and therefore the same
 * rule the uploaded `/lod/` objects were built with. A tolerant weld would merge
 * more and is the wrong tool: the corpus is watertight printable geometry whose
 * shared corners are the *same* exported float, and a tolerance large enough to
 * matter would also collapse the 0.4 mm detail an OpenLOCK clip is made of.
 *
 * The one canonicalisation is `-0`, which carries a different bit pattern from
 * `+0` and is the same point. Cheap to fix, and a mesh sitting on the origin
 * plane — which most of this corpus does — is exactly where it would show up.
 *
 * ## Open addressing, because a `Map` is the wrong shape here
 *
 * The median distinct mesh in the corpus is 215,314 triangles, so 645,942 corner
 * lookups, and the heaviest is 2,178,242 triangles / 6,534,726 lookups. A
 * `Map<string, number>` keyed on a joined coordinate string allocates one string
 * per corner: 6.5 million short-lived strings, which is minutes of collector
 * pressure inside a worker whose whole job is to finish quickly. This is a
 * `Int32Array` hash table with linear probing and no allocation per corner.
 * Measured on the six real meshes of the palette's starter set — 54,840 to
 * 485,262 triangles — the weld costs **3 to 76 ms**, against 18 to 305 ms for
 * the simplifier that follows it and 840 to 3,078 ms for the download that
 * precedes it.
 */

/**
 * Post-weld vertex count must be at most this fraction of the pre-weld count.
 *
 * 0.5, and the number is `tools/lod/decimate.ts`'s `WELD_MIN_DROP` deliberately
 * — the same threshold guarding the same trap on the same corpus. A closed
 * triangulated surface has V ≈ T/2 unique vertices against 3T unshared ones,
 * i.e. ~0.167, and every real mesh measured in the pipeline lands within 0.002
 * of that; the trap's *best* observed case is 0.763. Nothing sits near 0.5 in
 * either direction.
 *
 * It is duplicated rather than imported because `tools/` is outside the app's
 * TypeScript program (a composite project rejects the import — TS6307, the wall
 * rows C1, W7, X4 and X10 each hit), and `weld.test.ts` asserts the two agree by
 * reading the tool's source, so a change on either side fails a run.
 */
export const WELD_MAX_RATIO = 0.5

/**
 * Meshes below this triangle count skip the assertion.
 *
 * Twelve, matching the pipeline. The ratio is only meaningful once a mesh has
 * interior edges to share: a single triangle welds 3 → 3 by definition and is
 * evidence of nothing. The smallest real mesh in the corpus with any geometry at
 * all has 118 facets and welds to 0.167.
 */
export const WELD_ASSERT_MIN_TRIANGLES = 12

/** Positions over a plain `ArrayBuffer`, so the array is transferable. */
export type Positions = Float32Array<ArrayBuffer>

/** Indices over a plain `ArrayBuffer`, so the array is transferable. */
export type Indices = Uint32Array<ArrayBuffer>

/** Vertex counts either side of the weld — the evidence the trap did not bite. */
export interface WeldReport {
  /** Corners before welding: 3 per triangle, always. */
  readonly before: number
  /** Distinct positions after. */
  readonly after: number
  /** `after / before`. ~0.167 on real geometry. */
  readonly ratio: number
}

/** A welded, indexed mesh. */
export interface WeldedMesh {
  readonly positions: Positions
  readonly indices: Indices
  readonly triangles: number
  readonly report: WeldReport
}

/**
 * Welding did not materially reduce the vertex count.
 *
 * Its own type because the response differs from every other conversion
 * failure: a mesh that fails here must not be cached and must not be simplified,
 * since simplification would run, succeed, and emit something the size of the
 * source.
 */
export class WeldNoOpError extends Error {
  override readonly name = 'WeldNoOpError'
  readonly before: number
  readonly after: number
  readonly ratio: number
  readonly limit: number

  constructor(before: number, after: number, limit: number) {
    const ratio = before === 0 ? 1 : after / before
    super(
      `welding left ${String(after)} of ${String(before)} vertices (${ratio.toFixed(4)}×), ` +
        `over the ${limit.toFixed(2)}× limit — simplification would silently no-op. ` +
        'The usual cause is a per-facet normal reaching the weld: an STL stores one normal ' +
        'per facet and shares no vertices, so two triangles meeting at a corner disagree ' +
        'about it and nothing merges. Weld on position alone.',
    )
    this.before = before
    this.after = after
    this.ratio = ratio
    this.limit = limit
  }
}

/**
 * Fail unless welding materially reduced the vertex count.
 *
 * **The single most important line in this module.** Deleting it breaks no other
 * code path: the conversion would keep running, keep reporting success, and keep
 * caching geometry at the source triangle count.
 */
export function assertWeldDropped(
  before: number,
  after: number,
  limit: number = WELD_MAX_RATIO,
  triangles = Infinity,
): void {
  if (triangles < WELD_ASSERT_MIN_TRIANGLES) return
  if (after > before * limit) throw new WeldNoOpError(before, after, limit)
}

/** `-0` and `+0` are one point; nothing else is canonicalised. See the docblock. */
const NEGATIVE_ZERO = 0x8000_0000

/** Next power of two at or above `n`, with a floor of 16. */
function tableSize(n: number): number {
  let size = 16
  while (size < n) size *= 2
  return size
}

/**
 * Weld a non-indexed soup of `9 × triangles` floats into an indexed mesh.
 *
 * @throws {WeldNoOpError} when the ratio exceeds `limit` — see {@link assertWeldDropped}.
 */
export function weldPositions(soup: Float32Array, limit: number = WELD_MAX_RATIO): WeldedMesh {
  const corners = Math.floor(soup.length / 3)
  const triangles = Math.floor(corners / 3)

  // Bit patterns, not floats: a `Uint32Array` view over the same bytes turns
  // "are these the same coordinate" into three integer comparisons and lets the
  // hash be computed without touching the FPU.
  const bits = new Uint32Array(soup.buffer, soup.byteOffset, soup.length)

  // Load factor 0.5 at most, which keeps linear probing short. One slot per
  // corner plus headroom; `-1` means empty.
  const capacity = tableSize(corners * 2)
  const mask = capacity - 1
  const table = new Int32Array(capacity).fill(-1)

  // Sized for the worst case (nothing merges) and sliced at the end. A closed
  // mesh uses a sixth of this; over-allocating once is cheaper than growing.
  const welded = new Float32Array(corners * 3)
  // The same bytes as `welded`, addressed as words. Written through rather than
  // through the float view so the canonicalised `-0` is stored as the `+0` bit
  // pattern the next probe will compare against, and so a probe costs three
  // integer loads and no allocation.
  const weldedBits = new Uint32Array(welded.buffer)
  const indices = new Uint32Array(corners)
  let unique = 0

  for (let corner = 0; corner < corners; corner += 1) {
    const at = corner * 3
    let x = bits[at] ?? 0
    let y = bits[at + 1] ?? 0
    let z = bits[at + 2] ?? 0
    if (x === NEGATIVE_ZERO) x = 0
    if (y === NEGATIVE_ZERO) y = 0
    if (z === NEGATIVE_ZERO) z = 0

    // FNV-1a over the three words. Cheap, and measured to probe ~1.3 slots per
    // lookup on real catalog geometry — a multiplicative hash over raw float
    // bits clusters badly because exponents repeat.
    let hash = 0x811c_9dc5
    hash = Math.imul(hash ^ (x & 0xffff), 0x0100_0193)
    hash = Math.imul(hash ^ (x >>> 16), 0x0100_0193)
    hash = Math.imul(hash ^ (y & 0xffff), 0x0100_0193)
    hash = Math.imul(hash ^ (y >>> 16), 0x0100_0193)
    hash = Math.imul(hash ^ (z & 0xffff), 0x0100_0193)
    hash = Math.imul(hash ^ (z >>> 16), 0x0100_0193)

    let slot = hash & mask
    for (;;) {
      const held = table[slot] ?? -1
      if (held === -1) {
        const write = unique * 3
        weldedBits[write] = x
        weldedBits[write + 1] = y
        weldedBits[write + 2] = z
        table[slot] = unique
        indices[corner] = unique
        unique += 1
        break
      }
      const other = held * 3
      if (
        (weldedBits[other] ?? 0) === x &&
        (weldedBits[other + 1] ?? 0) === y &&
        (weldedBits[other + 2] ?? 0) === z
      ) {
        indices[corner] = held
        break
      }
      slot = (slot + 1) & mask
    }
  }

  assertWeldDropped(corners, unique, limit, triangles)

  return {
    // `slice` rather than `subarray`: what leaves here is transferred across a
    // thread boundary and a transfer moves whole buffers, not views, so a view
    // into the worst-case allocation would ship six times the bytes.
    positions: welded.slice(0, unique * 3),
    indices: indices.slice(0, triangles * 3),
    triangles,
    report: { before: corners, after: unique, ratio: corners === 0 ? 1 : unique / corners },
  }
}
