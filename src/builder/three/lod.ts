/**
 * The `/lod/` store as its **consumer** sees it — row G1's output format,
 * restated on this side of a contract that shares no files.
 *
 * `v2-pr-series.md`'s contract table: *"G1 LOD → G2. GLB format, LOD levels,
 * `/lod/` path scheme. G2 renders nothing if the shape differs."* `Owns` cannot
 * reveal that dependency, so this module is where every assumption G2 makes
 * about G1's bytes is written down as a value, and `contract.test.ts` checks
 * each one against **a GLB this repository's own pipeline produced** rather than
 * against this docblock. The same discipline as `tools/lod/contract.test.ts`,
 * pointing the other way.
 *
 * Nothing here imports three, React or `@/materials`: the panel needs the URL
 * and the budget decision *before* it will pay for the 3D chunk, exactly as
 * `src/three/gate.ts` needs to refuse before importing a renderer.
 *
 * ## What the store holds — the five facts that matter to a consumer
 *
 *  1. **One level.** {@link LOD_LEVELS} is 1, and it is 1 *because of this row*:
 *     an `InstancedMesh` shares a single `BufferGeometry` across its instances,
 *     so a distance-switched ladder is not expressible through it without one
 *     mesh per (design, level). G1's `manifest.ts` records the same reasoning
 *     from the producing side.
 *  2. **`POSITION` only, and no `NORMAL` on purpose.** glTF mandates flat
 *     shading for a primitive without `NORMAL`, `GLTFLoader` implements it, and
 *     `src/three/material.ts` sets `flatShading: true` regardless — so a supplied
 *     normal would be ignored at a measured 78% more bytes. {@link LOD_ATTRIBUTES}.
 *  3. **The node carries the scale.** {@link LOD_NODE_TRANSFORM} is
 *     `'quantized'`: meshopt quantizes `POSITION` to normalized integers and
 *     moves the scale and offset onto the node. See {@link LOD_NODE_TRANSFORM}
 *     for the measured consequence.
 *  4. **The bytes are the source STL's own axes and units** — millimetres,
 *     **Z-up**, unrotated. `tools/lod/decimate.ts`'s `buildDocument` writes the
 *     parsed positions straight through, and G1's manifest says
 *     *"millimetres, the source STL's own units, unchanged"*. glTF's own
 *     convention is Y-up, so a consumer that trusts the container rather than
 *     the note lays every tile on its back. {@link LOD_UP_AXIS}.
 *  5. **Nothing is uploaded.** Blocker **B2** — R2 write credentials for
 *     `/lod/` — is open, `tools/lod/manifest.ts` emits its sync commands
 *     unexecuted, and G1 ran 35 objects of a projected 8,353. So a 404 is the
 *     *expected* answer today and {@link LOD_ABSENT_IS_EXPECTED} says so where a
 *     reader will meet it.
 *
 * ## Why this row does not go through `@/download`
 *
 * `src/download/source.ts` is deliberately closed to it: `BlobSource.open` takes
 * a content address and nothing else, and `DERIVATIVE_PATH_SEGMENTS` already
 * names `lod` as a store the download path must refuse. That guard exists so a
 * decimated preview can never reach somebody's printer (§10, obligation 3), and
 * it is *load-bearing for this row* — so this module builds the LOD URL itself
 * and validates it in the mirror-image direction: {@link lodGlbUrl} demands a
 * `/lod/` segment and a `.glb` extension, and refuses anything that looks like
 * an original mesh. Two builders, each of which rejects the other's output.
 */
import type { BlobId, CatalogAssets } from '@/catalog'
import { shardedPath } from '@/catalog'
import { STL_GATE_BYTES, estimateGeometryBytes } from '@/three/gate'

/* ---------------------------------------------------------------- the format */

/**
 * Levels of detail in the store. **One.**
 *
 * Not a simplification and not a deferral: G1 rejected a ladder *because of this
 * row's architecture*. One `InstancedMesh` per design shares a single
 * `BufferGeometry`, so "level" is not a property an instance can carry — a
 * two-level ladder would be two meshes per design and two geometries resident,
 * which is the cost instancing was chosen to avoid. The band is adaptive per
 * mesh instead (`tools/lod/mesh.ts`).
 */
export const LOD_LEVELS = 1

/** Vertex attributes a store object carries. `POSITION` alone — see the module note. */
export const LOD_ATTRIBUTES: readonly string[] = ['POSITION']

/**
 * Whether the mesh node carries a transform this consumer must apply.
 *
 * `'quantized'` means **yes**, and this is the single most expensive thing to
 * get wrong in this row. Measured through the real loader on the fixture in
 * `fixtures/` — a 1×0.5 wall base, the smallest mesh in the corpus with any
 * geometry:
 *
 * | | |
 * | --- | --- |
 * | `geometry.boundingBox` size | 2.000 × 1.000153 × 0.472427 |
 * | `node.matrixWorld` scale | 12.7, uniform |
 * | `node.matrixWorld` translation | (0, 0, 3) |
 * | world bounding box | **25.400 × 12.702 × 6.000 mm** |
 *
 * and G1 measured the same shape on the corpus's largest mesh: geometry box
 * 2.000 × 0.251 × 1.813, scale 50.8132, world box 101.626 × 12.741 × 92.123 mm.
 *
 * So reading `mesh.geometry` and ignoring `node.matrixWorld` renders a 25 mm
 * tile as a 2-unit one at the origin — a builder full of tiny tiles, with no
 * error anywhere. `loadLod.ts` bakes the matrix into the geometry at load,
 * which is the only form an `InstancedMesh` can use:
 * an instance matrix multiplies the *geometry*, so a per-node transform has
 * nowhere left to be applied.
 */
export const LOD_NODE_TRANSFORM = 'quantized'

/**
 * The axis the archive treats as up, in the store's bytes.
 *
 * **Z.** `src/three/StlModel.tsx` established it by measurement — the median
 * tile is 101.60 × 12.70 × 4.50 and the p95 tile 76.59 × 25.40 × 45.01, tall
 * axis Z in both, which is the convention every slicer expects — and rotates
 * −90° about X to reach three.js's Y-up.
 *
 * **G1's GLBs inherit it.** `buildDocument` puts the parsed STL positions into
 * the accessor untouched, so the container says Y-up (glTF's convention) and the
 * contents are Z-up. Confirmed on the fixture: world bounding box
 * 25.400 × 12.702 × 6.000 with `min.y = −6.351` and `min.z = 0.0001`, i.e. the
 * 6 mm dimension is the height and it rests on z = 0. G1's `format` block does
 * **not** carry this field, which is the one addition this row would ask for —
 * see the report.
 */
export const LOD_UP_AXIS = 'z'

/** `EXT_meshopt_compression` implies `KHR_mesh_quantization`; `GLTFLoader` handles both. */
export const LOD_EXTENSIONS_REQUIRED: readonly string[] = [
  'EXT_meshopt_compression',
  'KHR_mesh_quantization',
]

/**
 * The decoder module, and the pin verification G1 asked for.
 *
 * `EXT_meshopt_compression` needs a WASM decoder in the browser and three ships
 * one at this path. **Both halves of G1's warning are confirmed against the
 * installed tree** (see `contract.test.ts`, which asserts them rather than
 * quoting them):
 *
 *   - The path is under `three/examples/jsm`, which three's own `package.json`
 *     exposes as `./examples/jsm/*` and `./addons/*` and which is **outside
 *     three's semver guarantee**. A minor bump may move or rename it.
 *   - `postprocessing` 6.39.4 declares `peerDependencies.three` as
 *     `">= 0.168.0 < 0.186.0"`, and this project is pinned at
 *     {@link VERIFIED_THREE_VERSION}. So the upgrade that would move the decoder
 *     is also the upgrade `postprocessing` refuses, and n8ao sits on top of
 *     `postprocessing`. The pin is what keeps this import path stable.
 */
export const MESHOPT_DECODER_IMPORT = 'three/examples/jsm/libs/meshopt_decoder.module.js'

/** The three release the format above was verified against. */
export const VERIFIED_THREE_VERSION = '0.185.1'

/**
 * `postprocessing`'s peer range, restated so a lockfile bump that widens it is
 * a visible diff. `contract.test.ts` reads the installed manifest and compares.
 */
export const POSTPROCESSING_THREE_RANGE = '>= 0.168.0 < 0.186.0'

/* ------------------------------------------------------------------- the URL */

/**
 * The only URL shape this row will fetch.
 *
 * The exact mirror of `src/download/source.ts`'s `ORIGINAL_STL_URL`, and it
 * refuses what that one accepts: a `/lod/` segment introducing the six-hex
 * shard, the full md5, and `.glb`. A misconfigured `assets.lod` pointing at the
 * models bucket throws here instead of streaming 108 GB of printable STL into a
 * preview.
 */
export const LOD_GLB_URL = /^https:\/\/[^/?#]+(?:\/[^/?#]+)*?\/lod\/([0-9a-f]{6})\/([0-9a-f]{32})\.glb$/

/** The LOD path was asked for something that is not a store object. */
export class LodUrlError extends Error {
  override readonly name = 'LodUrlError'
  readonly url: string

  constructor(url: string, reason: string) {
    super(`refusing to load ${url} as a LOD object: ${reason}`)
    this.url = url
  }
}

/**
 * The store object's URL for a content address.
 *
 * Reads `assets.lod` directly. That field **now exists** —
 * `src/catalog/schema.ts`'s `CatalogAssets` carries it and `pipeline/version.ts`
 * emits `https://objects.openforge.tools/lod` — which is worth noting because
 * `tools/lod/catalog.ts` still reconstructs the same base by swapping the last
 * path segment of `assets.models`, with a docblock saying row X4 should add the
 * field. It has been added. That derivation is now a redundant inference over a
 * value the index states, and removing it is a one-line change in a file this
 * row does not own.
 */
export function lodGlbUrl(assets: Pick<CatalogAssets, 'lod'>, blob: BlobId): string {
  const url = `${assets.lod.replace(/\/+$/, '')}/${shardedPath(blob)}.glb`

  const match = LOD_GLB_URL.exec(url)
  if (match === null) throw new LodUrlError(url, 'not the verified LOD object URL shape')

  const [, shard, md5] = match
  if (md5 !== blob) throw new LodUrlError(url, `md5 in the path (${String(md5)}) is not the requested blob`)
  if (shard !== blob.slice(0, 6)) throw new LodUrlError(url, `shard ${String(shard)} does not match the md5`)

  return url
}

/* -------------------------------------------------------------- the absences */

/**
 * Whether an absent object is a fault or the expected state. **Expected.**
 *
 * B2 is open: writing to `/lod/` needs credentials this project does not hold,
 * `tools/lod/manifest.ts` emits its `aws s3 sync` commands for a human to run
 * and G1 produced 35 objects locally against a projected 8,353 (176.1 MB). So
 * every object is absent today, and G1's own handover note says the app *"must
 * treat a 404 on /lod/ as expected and fall back to the plan view, exactly as
 * /thumbs/ falls back to the sprite sheet"*.
 *
 * This constant is read by the panel to choose its copy. Flip it when the
 * backfill lands and a 404 becomes a real gap worth reporting.
 */
export const LOD_ABSENT_IS_EXPECTED = true

/** Objects the store is projected to hold once B2 is closed. G1's `totals.objects`. */
export const LOD_PROJECTED_OBJECTS = 8_353

/** Bytes those objects are projected to occupy. G1's `totals.bytes`, 176.1 MB. */
export const LOD_PROJECTED_BYTES = 176_100_000

/* --------------------------------------------------------------- the budget */

/**
 * Vertices a store object holds per triangle, measured.
 *
 * `weld()` collapses a triangle soup to V ≈ T/2 on a closed surface, and G1
 * measured 0.166–0.167 across meshes from 118 to 2.18 M triangles — the fixture
 * itself welds 354 → 59 vertices at 118 triangles, i.e. **0.5 vertices per
 * triangle**. So a ceiling-sized object is 20,000 triangles over ~10,000
 * vertices.
 */
export const LOD_VERTICES_PER_TRIANGLE = 0.5

/** G1's ceiling. `tools/lod/mesh.ts`'s `MAX_TRIANGLES`. */
export const LOD_MAX_TRIANGLES = 20_000

/** G1's floor. `tools/lod/mesh.ts`'s `MIN_TRIANGLES`. */
export const LOD_MIN_TRIANGLES = 5_000

/**
 * Decoded bytes a worst-case store object occupies.
 *
 * `POSITION` is three `float32`s per vertex and there is no `NORMAL`; the
 * primitive is indexed and every in-band LOD fits in 16 bits, so an index is two
 * bytes. At the 20,000-triangle ceiling: 10,000 × 12 + 60,000 × 2 = **240 kB**,
 * and the GPU holds its own copy of both buffers.
 */
export function lodGeometryBytes(triangles: number = LOD_MAX_TRIANGLES): number {
  const vertices = Math.ceil(triangles * LOD_VERTICES_PER_TRIANGLE)
  return vertices * 3 * 4 + triangles * 3 * 2
}

/**
 * The room's decoded-geometry budget, in bytes.
 *
 * **Borrowed rather than invented.** `src/three/gate.ts` already decided how
 * much typed array one 3D view of this archive may hold: a 24 MiB STL, which
 * `estimateGeometryBytes` puts at 36.24 MB of positions and normals. A room is
 * the same tab and the same mobile-Safari budget, so it gets the same ceiling
 * and the number moves when that one moves.
 */
export const LOD_ROOM_BUDGET_BYTES = estimateGeometryBytes(STL_GATE_BYTES)

/**
 * Distinct store objects a room may hold, at the worst-case size.
 *
 * {@link LOD_ROOM_BUDGET_BYTES} over {@link lodGeometryBytes} — **150** at the
 * current constants, pinned by `lod.test.ts` so a change to either is visible.
 * A cap is needed rather than nice: a share link may name any number of
 * placements, and an uncapped loader would fetch and decode all of them.
 *
 * It bounds *distinct geometries*, not placements. Instancing is what makes that
 * the right axis — a further copy of a tile already loaded costs one 4×4 matrix.
 */
export function lodObjectBudget(
  budgetBytes: number = LOD_ROOM_BUDGET_BYTES,
  perObject: number = lodGeometryBytes(),
): number {
  return Math.max(1, Math.floor(budgetBytes / perObject))
}

/** How the panel explains a room the budget refuses. */
export function lodBudgetRefusal(objects: number, budget: number = lodObjectBudget()): string {
  return (
    `This room needs ${String(objects)} different meshes and the 3D view loads at most ` +
    `${String(budget)} — that is ${String(Math.round(lodGeometryBytes() / 1024))} kB of geometry each, ` +
    'against the same memory ceiling the detail viewer applies to a single mesh. The plan view draws ' +
    'every piece.'
  )
}
