/**
 * STL → decimated GLB. This is the row.
 *
 * ## The trap, and the assertion that is the point of the module
 *
 * `weld()` then `simplify()` is the standard glTF Transform recipe and it
 * **silently no-ops on STL-derived geometry**. A binary STL stores a normal per
 * *facet* and shares no vertices, so every triangle has three unique corners; if
 * those facet normals reach `weld()` — which merges *bitwise identical*
 * vertices, all attributes included — then two triangles meeting at a corner
 * disagree on its normal, nothing merges, `simplify()` has no edges to collapse,
 * and the job emits a GLB barely smaller than the STL with no error and no
 * warning.
 *
 * Measured on real catalog meshes, welding position **and** facet normal against
 * welding position alone:
 *
 * | mesh | source tris | 3× tris | welded, +normals | welded, positions only |
 * | --- | --- | --- | --- | --- |
 * | `8180da93…` | 118 | 354 | 326 (0.921×) | **59 (0.167×)** |
 * | `8d5a91bf…` | 71,292 | 213,876 | 210,367 (0.984×) | **35,591 (0.166×)** |
 * | `5234f9d5…` | 207,296 | 621,888 | 474,729 (0.763×) | **103,678 (0.167×)** |
 * | `6fe979d2…` | 359,248 | 1,077,744 | 1,076,976 (0.999×) | **179,594 (0.167×)** |
 * | `e8eec0ae…` | 527,488 | 1,582,464 | 1,228,255 (0.776×) | **263,354 (0.166×)** |
 * | `2d32f890…` | 2,178,242 | 6,534,726 | 6,488,791 (0.993×) | **1,090,458 (0.167×)** |
 *
 * And the consequence, with the facet normals left in: `2d32f890…` simplified
 * from 2,178,242 triangles to **2,174,382** — a 0.18% reduction, reported as
 * success. Positions only, the same mesh reaches 11,971.
 *
 * So {@link assertWeldDropped} runs per mesh and fails loudly. The threshold is
 * {@link WELD_MIN_DROP} = 0.5: a closed triangulated surface has V ≈ T/2 unique
 * vertices against 3T unshared ones, i.e. ~0.167, and every real mesh measured
 * above lands within 0.002 of that; the trap's *best* case is 0.763. Nothing sits
 * near 0.5, in either direction.
 *
 * Note what this assertion is not: it is **not** "the GLB is smaller than the
 * STL". A GLB of the same geometry is smaller than an STL regardless — different
 * container, indexed, no per-facet normal — so that comparison passes with the
 * trap fully armed.
 *
 * ## Why there is no NORMAL attribute in the output
 *
 * Dropping the facet normals is the fix, and *not* replacing them is a second,
 * separate decision with three reasons:
 *
 *  1. `src/three/material.ts:128` sets `flatShading: true`, so the app's material
 *     ignores a supplied normal attribute anyway, and `src/three/geometry.ts`
 *     already recomputes flat normals for the raw-STL path.
 *  2. glTF says a primitive with no `NORMAL` **must** be rendered flat-shaded,
 *     and three 0.185.1 implements exactly that: `GLTFLoader.js` sets
 *     `material.flatShading = true` when `geometry.attributes.normal` is
 *     undefined. So omitting normals *is* how you ask for the look this app wants.
 *  3. It is 44% of the file. Measured on `e8eec0ae…` at 5,275 triangles:
 *     **20.2 KB without normals, 36.0 KB with smooth normals** after meshopt.
 *
 * ## Compression
 *
 * `EXT_meshopt_compression`, on by default, measured rather than assumed. At the
 * same triangle count, `e8eec0ae…`: **59.1 KB raw → 19.2 KB meshopt**, a 3.1×
 * reduction, and 3.2–3.4× across the four meshes measured individually. Over the
 * default 36-mesh sample run end to end the whole-store figure is larger, because
 * the sample includes pass-through meshes whose uncompressed indices dominate:
 * **819.0 KB compressed against 3.9 MB uncompressed, 4.7×** (mean object 23.4 KB
 * against 110.6 KB). Projected over 8,353 meshes that is **176.1 MB against
 * 833.4 MB**. Draco is rejected upstream (§8): no release since January 2024, and
 * a 100 KB decoder against meshopt's 7 KB.
 *
 * **The compression carries a contract G2 must honour.** glTF Transform's
 * `meshopt()` is a wrapper over `reorder` + `quantize` + the extension, so
 * `POSITION` comes out as normalized `int16` and the *scale and offset move onto
 * the node transform*. Loaded with three 0.185.1's own `GLTFLoader` and
 * `MeshoptDecoder`, the corpus's largest mesh (`2d32f890…`, the boss door) comes
 * back as:
 *
 * | | |
 * | --- | --- |
 * | `geometry.boundingBox` size | **2.000 × 0.251 × 1.813** |
 * | `mesh.matrixWorld` | uniform scale **50.8132**, translation `[-0.0063, 0.0085, 46.0602]` |
 * | world bounding box size | **101.626 × 12.741 × 92.123 mm** |
 *
 * So a consumer that reads `mesh.geometry` and ignores `node.matrixWorld` renders
 * a 101 mm tile as a 2-unit one, at the origin. `contract.test.ts` measures both
 * numbers against the real loader so that failure arrives as a diff.
 *
 * Quantization is what buys the last 1.47× — 18.7 KB against 27.5 KB for meshopt
 * with float positions and an identity node — so the trade is taken and stated,
 * and `--no-meshopt` produces plain float GLBs with identity transforms for
 * anyone who would rather not honour it.
 */
import { Document, Logger, NodeIO } from '@gltf-transform/core'
import type { Accessor, Primitive } from '@gltf-transform/core'
import { EXTMeshoptCompression, KHRONOS_EXTENSIONS } from '@gltf-transform/extensions'
import {
  VertexCountMethod,
  getSceneVertexCount,
  meshopt,
  simplify,
  weld,
} from '@gltf-transform/functions'
import { MeshoptDecoder } from 'meshoptimizer/decoder'
import { MeshoptEncoder } from 'meshoptimizer/encoder'
import { MeshoptSimplifier } from 'meshoptimizer/simplifier'

import type { ParsedStl } from '../../src/three/stl/parse'
import { parseStl } from '../../src/three/stl/parse'

import type { Band, Fidelity, MeshMetrics } from './mesh'
import {
  MAX_TRIANGLES,
  MIN_TRIANGLES,
  SIMPLIFY_ERROR,
  fidelity,
  isPassThrough,
  meshMetrics,
  targetTriangles,
} from './mesh'

/**
 * Post-weld vertex count must be **at most this fraction** of the pre-weld count.
 *
 * See the table in the module docblock: real STL geometry welds to 0.166–0.167,
 * the trap's loosest observed case is 0.763, and 0.5 sits between with margin on
 * both sides.
 */
export const WELD_MIN_DROP = 0.5

/**
 * Meshes below this triangle count skip the weld assertion.
 *
 * The ratio is only meaningful once a mesh has interior edges to share. A single
 * triangle welds 3 → 3 by definition and is not evidence of anything. Twelve is
 * a cube, the smallest closed thing worth asserting on; the smallest real mesh in
 * the corpus with any geometry at all has 118 facets and welds to 0.167.
 */
export const WELD_ASSERT_MIN_TRIANGLES = 12

/** Attempts at landing inside the band before giving up. */
export const MAX_SIMPLIFY_ATTEMPTS = 3

/**
 * This tool's own provenance string, carried in `asset.extras.tool`.
 *
 * **Not** `asset.generator`: glTF Transform's writer overwrites that with its own
 * version on every `writeBinary`, so a generator set here would be silently
 * replaced by `glTF-Transform v4.5.0`. `extras` survives the write, which makes
 * it the only place a derived object can say which tool derived it.
 */
export const TOOL = 'openforge-workshop tools/lod (glTF Transform + meshoptimizer)'

/**
 * `asset.copyright` on every object.
 *
 * The meshes are somebody's work under a share-alike licence, and a decimated
 * preview that travels without its attribution is a small but real failure. The
 * second sentence is architecture-plan.md §8's rule, in the file itself, where
 * anyone who finds a stray GLB will read it.
 */
export const COPYRIGHT =
  'OpenForge — Devon Jones, CC BY-NC-SA 4.0. Decimated preview only; the printable original is the STL.'

/** Facet normals survived into `weld()`, or the mesh has no shared vertices at all. */
export class WeldNoOpError extends Error {
  override readonly name = 'WeldNoOpError'
  readonly before: number
  readonly after: number
  readonly ratio: number
  readonly limit: number
  constructor(before: number, after: number, limit: number) {
    const ratio = before === 0 ? 1 : after / before
    super(
      `weld() left ${String(after)} of ${String(before)} vertices (${ratio.toFixed(4)}×), ` +
        `over the ${limit.toFixed(2)}× limit — simplification would silently no-op. ` +
        'The usual cause is per-facet normals reaching weld(): STL stores one normal per ' +
        'facet and shares no vertices, so two triangles meeting at a corner disagree on it ' +
        'and nothing merges. Build the primitive from POSITION alone.',
    )
    this.before = before
    this.after = after
    this.ratio = ratio
    this.limit = limit
  }
}

/** The source STL holds no triangles. Not an error in the file — see `gate.ts`. */
export class EmptyMeshError extends Error {
  override readonly name = 'EmptyMeshError'
  readonly sourceBytes: number
  constructor(sourceBytes: number) {
    super(`${String(sourceBytes)} bytes of valid STL declaring zero facets — there is no mesh to decimate`)
    this.sourceBytes = sourceBytes
  }
}

/** Simplification could not reach the band. Never shipped quietly. */
export class TargetMissedError extends Error {
  override readonly name = 'TargetMissedError'
  readonly triangles: number
  readonly limit: number
  readonly attempts: number
  constructor(triangles: number, limit: number, attempts: number) {
    super(
      `after ${String(attempts)} attempts the mesh still holds ${String(triangles)} triangles, ` +
        `over the ${String(limit)} ceiling`,
    )
    this.triangles = triangles
    this.limit = limit
    this.attempts = attempts
  }
}

export interface DecimateOptions {
  /** Band floor. Defaults to {@link MIN_TRIANGLES}. */
  minTriangles?: number
  /** Band ceiling. Defaults to {@link MAX_TRIANGLES}. */
  maxTriangles?: number
  /** Simplifier error budget, fraction of mesh radius. Defaults to {@link SIMPLIFY_ERROR}. */
  error?: number
  /** Apply `EXT_meshopt_compression`. Default `true`. */
  meshopt?: boolean
  /** Weld ratio ceiling. Defaults to {@link WELD_MIN_DROP}. Lowering it is a mistake. */
  weldMinDrop?: number
}

/** Vertex counts either side of `weld()` — the evidence the trap did not bite. */
export interface WeldReport {
  before: number
  after: number
  ratio: number
}

/** Everything one object's run produced, and everything the manifest reports. */
export interface DecimateResult {
  glb: Uint8Array
  format: ParsedStl['format']
  sourceBytes: number
  sourceTriangles: number
  /** Triangles the parser dropped for a non-finite coordinate. Normally 0. */
  droppedTriangles: number
  weld: WeldReport
  /** Triangle count aimed for. Equals `sourceTriangles` for a pass-through. */
  target: number
  triangles: number
  vertices: number
  /** `true` when the source was already at or below the ceiling and was left alone. */
  passThrough: boolean
  /** `true` when fidelity forced the target up to the ceiling. */
  escalated: boolean
  attempts: number
  fidelity: Fidelity
  source: MeshMetrics
  lod: MeshMetrics
  compression: 'EXT_meshopt_compression' | 'none'
  extensionsRequired: string[]
  /** The node transform the compression baked out of the positions. */
  node: { translation: [number, number, number]; scale: [number, number, number] }
}

/* ------------------------------------------------------------------- runtime */

let readyPromise: Promise<void> | undefined

/**
 * Initialise the three wasm modules. Idempotent, and awaited by {@link decimate}.
 *
 * Exposed so a caller can pay the cost once, before a run, rather than inside
 * the first object's timing.
 */
export function ready(): Promise<void> {
  readyPromise ??= Promise.all([MeshoptSimplifier.ready, MeshoptEncoder.ready, MeshoptDecoder.ready]).then(
    () => undefined,
  )
  return readyPromise
}

/** Quiet IO. glTF Transform's default logger writes `prune:` chatter to stdout. */
function silentLogger(): Logger {
  return new Logger(Logger.Verbosity.ERROR)
}

function plainIO(): NodeIO {
  return new NodeIO().setLogger(silentLogger()).registerExtensions(KHRONOS_EXTENSIONS)
}

function meshoptIO(): NodeIO {
  return new NodeIO()
    .setLogger(silentLogger())
    .registerExtensions([...KHRONOS_EXTENSIONS, EXTMeshoptCompression])
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })
}

/* --------------------------------------------------------------------- entry */

/**
 * Decimate one STL.
 *
 * @throws {EmptyMeshError} when the file is valid but declares no facets.
 * @throws {WeldNoOpError} when welding did not materially reduce the vertex count.
 * @throws {TargetMissedError} when simplification could not reach the band.
 */
export async function decimate(stl: Uint8Array, options: DecimateOptions = {}): Promise<DecimateResult> {
  await ready()
  const parsed = parseStl(stl)
  if (parsed.triangles === 0) throw new EmptyMeshError(parsed.sourceBytes)

  const welded = await weldPositions(parsed.positions, options.weldMinDrop ?? WELD_MIN_DROP)
  const source = meshMetrics(welded.positions, welded.indices)

  const band: Band = {
    min: options.minTriangles ?? MIN_TRIANGLES,
    max: options.maxTriangles ?? MAX_TRIANGLES,
  }
  const passThrough = isPassThrough(parsed.triangles, band)
  const firstTarget = targetTriangles(parsed.triangles, band)

  const simplified = await reachBand(welded, source, {
    band,
    firstTarget,
    passThrough,
    error: options.error ?? SIMPLIFY_ERROR,
  })

  const useMeshopt = options.meshopt ?? true
  const doc = buildDocument(simplified.positions, simplified.indices)
  const asset = doc.getRoot().getAsset()
  asset.copyright = COPYRIGHT
  asset.extras = {
    tool: TOOL,
    source: { triangles: parsed.triangles, bytes: parsed.sourceBytes, format: parsed.format },
    lod: { triangles: simplified.metrics.triangles, target: simplified.target },
  }

  let glb: Uint8Array
  if (useMeshopt) {
    await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
    glb = await meshoptIO().writeBinary(doc)
  } else {
    glb = await plainIO().writeBinary(doc)
  }

  const node = doc.getRoot().listNodes()[0]
  const translation = (node?.getTranslation() ?? [0, 0, 0])
  const scale = (node?.getScale() ?? [1, 1, 1])

  return {
    glb,
    format: parsed.format,
    sourceBytes: parsed.sourceBytes,
    sourceTriangles: parsed.triangles,
    droppedTriangles: parsed.dropped,
    weld: welded.report,
    target: simplified.target,
    triangles: simplified.metrics.triangles,
    vertices: simplified.positions.length / 3,
    passThrough,
    escalated: simplified.escalated,
    attempts: simplified.attempts,
    fidelity: simplified.fidelity,
    source,
    lod: simplified.metrics,
    compression: useMeshopt ? 'EXT_meshopt_compression' : 'none',
    extensionsRequired: doc
      .getRoot()
      .listExtensionsRequired()
      .map((extension) => extension.extensionName)
      .sort(),
    node: { translation, scale },
  }
}

/* ---------------------------------------------------------------------- weld */

/**
 * Typed arrays glTF Transform will accept.
 *
 * `setArray` wants an array over a plain `ArrayBuffer`; the default
 * `Float32Array` is over `ArrayBufferLike`, which admits `SharedArrayBuffer` and
 * is therefore rejected. `src/three/stl/parse.ts` already narrows its output the
 * same way and for the same reason.
 */
export type Positions = Float32Array<ArrayBuffer>
export type Indices = Uint32Array<ArrayBuffer>

/** A welded, indexed triangle mesh, plus the evidence that welding worked. */
export interface WeldedMesh {
  positions: Positions
  indices: Indices
  report: WeldReport
}

/**
 * Weld a non-indexed STL soup through glTF Transform, asserting it worked.
 *
 * The primitive is built from `POSITION` **alone**. That is deliberate and it is
 * the fix for the trap this module exists to avoid; see the docblock.
 */
export async function weldPositions(
  positions: Positions,
  limit: number = WELD_MIN_DROP,
): Promise<WeldedMesh> {
  await ready()
  const doc = buildDocument(positions, null)
  const scene = doc.getRoot().listScenes()[0]
  if (scene === undefined) throw new Error('the document lost its scene before welding')

  const before = getSceneVertexCount(scene, VertexCountMethod.UPLOAD)
  await doc.transform(weld())
  const after = getSceneVertexCount(scene, VertexCountMethod.UPLOAD)

  const triangles = positions.length / 9
  assertWeldDropped(before, after, limit, triangles)

  const prim = firstPrimitive(doc)
  return {
    positions: floatArray(prim.getAttribute('POSITION')),
    indices: indexArray(prim.getIndices()),
    report: { before, after, ratio: before === 0 ? 1 : after / before },
  }
}

/**
 * Fail unless welding materially reduced the vertex count.
 *
 * **The single most important line in this row.** Deleting it does not break any
 * other code path: the pipeline would keep running, keep reporting success, and
 * keep emitting GLBs at the source triangle count.
 */
export function assertWeldDropped(
  before: number,
  after: number,
  limit: number = WELD_MIN_DROP,
  triangles = Infinity,
): void {
  if (triangles < WELD_ASSERT_MIN_TRIANGLES) return
  if (after > before * limit) throw new WeldNoOpError(before, after, limit)
}

/* ------------------------------------------------------------------ simplify */

interface BandOptions {
  band: Band
  firstTarget: number
  passThrough: boolean
  error: number
}

interface BandResult {
  positions: Positions
  indices: Indices
  metrics: MeshMetrics
  fidelity: Fidelity
  target: number
  escalated: boolean
  attempts: number
}

/**
 * Simplify into the band, escalating once on fidelity and retrying on overshoot.
 *
 * Three things can go wrong and each has one response:
 *
 *  - **The mesh is already small enough.** Nothing runs; it ships as welded.
 *  - **The result is faithful but heavy.** meshoptimizer aims at a target index
 *    count and can land above it on awkward topology (measured: target 1,500 →
 *    1,738 triangles on `2d32f890…`). The retry scales the ratio down by the
 *    overshoot and tries again, bounded by {@link MAX_SIMPLIFY_ATTEMPTS}.
 *  - **The result is light but wrong.** Surface area or bounding box moved more
 *    than `mesh.ts` allows, so the target escalates to the ceiling — once. If
 *    the ceiling is still not faithful the result ships with `fidelity.acceptable`
 *    false, because a preview that is 6% coarse is better than no 3D at all for
 *    the 11.2% of the corpus that has none; the manifest reports every such
 *    object by name.
 */
async function reachBand(welded: WeldedMesh, source: MeshMetrics, options: BandOptions): Promise<BandResult> {
  if (options.passThrough) {
    return {
      positions: welded.positions,
      indices: welded.indices,
      metrics: source,
      fidelity: fidelity(source, source),
      target: source.triangles,
      escalated: false,
      attempts: 0,
    }
  }

  let target = options.firstTarget
  let escalated = false
  let attempts = 0
  let best: BandResult | undefined

  for (let attempt = 1; attempt <= MAX_SIMPLIFY_ATTEMPTS; attempt += 1) {
    attempts = attempt
    const doc = buildDocument(welded.positions, welded.indices)
    await doc.transform(
      simplify({ simplifier: MeshoptSimplifier, ratio: target / source.triangles, error: options.error }),
    )
    const prim = firstPrimitive(doc)
    const positions = floatArray(prim.getAttribute('POSITION'))
    const indices = indexArray(prim.getIndices())
    const metrics = meshMetrics(positions, indices)
    const quality = fidelity(source, metrics)
    best = { positions, indices, metrics, fidelity: quality, target, escalated, attempts }

    if (metrics.triangles > options.band.max) {
      if (attempt === MAX_SIMPLIFY_ATTEMPTS) {
        throw new TargetMissedError(metrics.triangles, options.band.max, attempt)
      }
      // Aim lower by the overshoot, with 10% of headroom.
      target = Math.max(1, Math.floor((target * options.band.max) / metrics.triangles / 1.1))
      continue
    }

    if (!quality.acceptable && target < options.band.max) {
      target = options.band.max
      escalated = true
      continue
    }

    return best
  }

  if (best === undefined) throw new TargetMissedError(source.triangles, options.band.max, attempts)
  return best
}

/* ------------------------------------------------------------------ document */

/**
 * A one-mesh, one-primitive, position-only glTF document.
 *
 * No material: G2 supplies its own from the texture registry (§9), and a glTF
 * primitive with no material renders with the viewer's default, which is never
 * what ships. No `NORMAL`, for the three reasons in the docblock.
 */
export function buildDocument(positions: Positions, indices: Indices | null): Document {
  const doc = new Document().setLogger(silentLogger())
  const buffer = doc.createBuffer()
  const position = doc.createAccessor('position').setType('VEC3').setArray(positions).setBuffer(buffer)
  const prim = doc.createPrimitive().setMode(4 /* TRIANGLES */).setAttribute('POSITION', position)
  if (indices !== null) {
    prim.setIndices(doc.createAccessor('indices').setType('SCALAR').setArray(indices).setBuffer(buffer))
  }
  doc.createScene().addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(prim)))
  return doc
}

function firstPrimitive(doc: Document): Primitive {
  const prim = doc.getRoot().listMeshes()[0]?.listPrimitives()[0]
  if (prim === undefined) throw new Error('the document holds no primitive — simplification disposed the mesh')
  return prim
}

function floatArray(accessor: Accessor | null): Positions {
  const array = accessor?.getArray()
  if (array === undefined || array === null) throw new Error('the primitive has no POSITION attribute')
  return array instanceof Float32Array ? (array) : new Float32Array(array)
}

/**
 * Indices as `Uint32Array`.
 *
 * glTF Transform narrows an index accessor to `Uint16Array` once the mesh fits
 * in 16 bits, which every in-band LOD does, so this widens rather than casts.
 */
function indexArray(accessor: Accessor | null): Indices {
  const array = accessor?.getArray()
  if (array === undefined || array === null) throw new Error('the primitive is not indexed')
  return array instanceof Uint32Array ? (array) : new Uint32Array(array)
}

/* --------------------------------------------------------------------- read */

/** What a GLB actually holds, read back from its bytes. */
export interface GlbSummary {
  triangles: number
  vertices: number
  hasNormals: boolean
  extensionsRequired: string[]
  /** Whoever wrote the container — glTF Transform stamps this itself. */
  generator: string
  /** {@link TOOL}, from `asset.extras`. */
  tool: string
  copyright: string
  node: { translation: [number, number, number]; scale: [number, number, number] }
  extents: [number, number, number]
}

/**
 * Parse an emitted GLB and report what is in it.
 *
 * Used by the tests to check the manifest against the object rather than against
 * the code that wrote it, and by a resumed run to fill in an entry for an object
 * it did not produce this time.
 */
export async function readGlb(glb: Uint8Array): Promise<GlbSummary> {
  await ready()
  const doc = await meshoptIO().readBinary(glb)
  const prim = firstPrimitive(doc)
  const indices = prim.getIndices()
  const position = prim.getAttribute('POSITION')
  if (position === null) throw new Error('the GLB has no POSITION attribute')
  const node = doc.getRoot().listNodes()[0]

  const vertices = position.getCount()
  const dequantized = dequantizedExtents(position, node?.getScale())

  return {
    triangles: (indices === null ? vertices : indices.getCount()) / 3,
    vertices,
    hasNormals: prim.getAttribute('NORMAL') !== null,
    extensionsRequired: doc
      .getRoot()
      .listExtensionsRequired()
      .map((extension) => extension.extensionName)
      .sort(),
    generator: doc.getRoot().getAsset().generator ?? '',
    tool: assetTool(doc.getRoot().getAsset().extras),
    copyright: doc.getRoot().getAsset().copyright ?? '',
    node: {
      translation: (node?.getTranslation() ?? [0, 0, 0]),
      scale: (node?.getScale() ?? [1, 1, 1]),
    },
    extents: dequantized,
  }
}

/** `extras.tool`, when the object carries one. */
function assetTool(extras: unknown): string {
  if (typeof extras !== 'object' || extras === null) return ''
  const tool = (extras as { tool?: unknown }).tool
  return typeof tool === 'string' ? tool : ''
}

/**
 * World-space extents of a possibly quantized POSITION accessor.
 *
 * `getMinNormalized`/`getMaxNormalized` undo the accessor's own normalization;
 * the node's scale then undoes the quantization volume. Translation cancels out
 * of an extent, so it is not needed here.
 */
function dequantizedExtents(position: Accessor, scale: number[] | undefined): [number, number, number] {
  const min = position.getMinNormalized([0, 0, 0])
  const max = position.getMaxNormalized([0, 0, 0])
  const factor = scale ?? [1, 1, 1]
  return [0, 1, 2].map((axis) => ((max[axis] ?? 0) - (min[axis] ?? 0)) * (factor[axis] ?? 1)) as [
    number,
    number,
    number,
  ]
}
