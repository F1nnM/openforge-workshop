/**
 * One `/lod/` object → one `BufferGeometry` in millimetres. And the footgun,
 * disarmed in one place.
 *
 * ## The node transform is baked, not read
 *
 * G1's warning, restated because it is the whole reason this module is not four
 * lines: a meshopt-compressed GLB quantizes `POSITION` to normalized integers
 * and **moves the scale and offset onto the node**. Measured on the fixture next
 * door — a real archive mesh through G1's real pipeline — the node carries a
 * uniform scale of 12.7 and a translation of (0, 0, 3), the geometry's own
 * bounding box is 2.000 × 1.000153 × 0.472427, and the world box is
 * 25.400 × 12.702 × 6.000 mm. G1 measured the same shape on the corpus's largest
 * mesh at a scale of 50.8132.
 *
 * An `InstancedMesh` cannot carry that node. Its geometry is shared by every
 * instance and an instance matrix multiplies the *geometry*, so there is nowhere
 * left for a per-node transform to be applied — read `mesh.geometry` and ignore
 * `node.matrixWorld` and every tile renders at a fortieth of its size at the
 * origin, with no error anywhere. So {@link loadLodGeometry} applies
 * `matrixWorld` to the vertices as it copies them out, and what it returns is
 * already in millimetres: `geometry.boundingBox` on the result is the world box.
 *
 * **It cannot be done with `geometry.applyMatrix4`.** `BufferAttribute.setXYZ`
 * re-*normalizes* on write, so writing a 25.4 mm coordinate into a normalized
 * `int16` attribute clamps it to 1.0 — the array would be destroyed, in place,
 * silently. The vertices are therefore read through `Vector3.fromBufferAttribute`
 * (which denormalizes), transformed, and written into a fresh `Float32Array`.
 * That widening is not a cost this module chose: `float32` positions are what
 * `lod.ts`'s memory budget is computed against.
 *
 * ## The absences are the normal case, and row R1 answers them
 *
 * Blocker **B2** is open, nothing is uploaded, and G1's handover note says a 404
 * on `/lod/` must be treated as expected. So {@link LodAbsentError} is a distinct
 * type from {@link LodLoadError}: one is "the backfill has not happened", which
 * the panel reports as a state, and the other is a fault worth a retry.
 *
 * **`/lod/` being empty is not a reason for the builder to draw nothing.** Row
 * R1 converts the source STL in the browser when an item joins the library and
 * caches the result in IndexedDB (`src/mesh/`), so there is a second place a
 * mesh can come from. {@link loadMeshGeometry} is the seam: it asks `/lod/`
 * first — one 21 kB GLB against a 10.77 MB STL, so the store is strictly cheaper
 * whenever it answers — and reads the converted cache when `/lod/` says 404.
 *
 * The order matters and is not arbitrary. The day **B7** runs, every mesh starts
 * arriving from `/lod/` and the fallback stops firing on its own, with no line
 * changed and nothing to clean up. Until then the fallback is the only path that
 * produces geometry at all.
 *
 * ### What a consumer may know
 *
 * `LodGeometry.source` names where the geometry came from, for the readout and
 * for the tests. Nothing else may branch on it: an `InstancedMesh` cannot tell,
 * because both paths hand back the same thing — positions in **millimetres**, in
 * the store's Z-up axes, indexed, no normals — and `place.ts` stands either one
 * up with the same matrix. Rows R2 and R3 take a `BufferGeometry` per md5 and
 * must not ask which store it came out of.
 *
 * A 200 is not trusted on its own either. A CDN error page is served with a 200
 * and an HTML body, and `GLTFLoader.parse` on HTML fails somewhere deep with a
 * JSON message, so the four magic bytes are checked first — the same reasoning as
 * `src/download/source.ts`'s `Content-Type` guard, one layer lower.
 */
import { BufferAttribute, BufferGeometry, Box3, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import type { Group, Mesh } from 'three'

import type { BlobId, CatalogAssets } from '@/catalog'
import type { MeshCache, MeshRecord } from '@/mesh'
import { MESH_CACHE_VERSION } from '@/mesh'

import { footprintDelta } from './place'
import { lodGlbUrl } from './lod'

/** `glTF` — the first four bytes of every binary glTF container. */
const GLB_MAGIC = 0x46546c67

/** Content types R2 may serve a `.glb` as. `model/gltf-binary` is the registered one. */
const GLB_CONTENT_TYPES: readonly string[] = [
  'model/gltf-binary',
  'application/octet-stream',
  'application/gltf-buffer',
  'binary/octet-stream',
]

/**
 * The store has no object for this mesh. **Expected today**, not a fault.
 *
 * See `lod.ts`'s `LOD_ABSENT_IS_EXPECTED`: `/lod/` is empty until a human with
 * R2 write credentials runs `tools/lod/manifest.ts`'s commands.
 */
export class LodAbsentError extends Error {
  override readonly name = 'LodAbsentError'
  readonly blob: BlobId
  readonly url: string
  readonly status: number

  constructor(blob: BlobId, url: string, status: number) {
    super(`no LOD object at ${url} (HTTP ${String(status)}) — the /lod/ prefix is not backfilled yet`)
    this.blob = blob
    this.url = url
    this.status = status
  }
}

/** The object was there and could not be used. Worth a retry; the absence is not. */
export class LodLoadError extends Error {
  override readonly name = 'LodLoadError'
  readonly blob: BlobId
  readonly url: string

  constructor(blob: BlobId, url: string, reason: string, options?: ErrorOptions) {
    super(`could not load the LOD object for ${blob} from ${url}: ${reason}`, options)
    this.blob = blob
    this.url = url
  }
}

/** Where a geometry came from. See the module note on what may branch on it. */
export type LodSource = 'lod' | 'converted'

/** One loaded object, ready to instance. Identical whichever store it came from. */
export interface LodGeometry {
  readonly blob: BlobId
  /** `'lod'` for a `/lod/` GLB, `'converted'` for an R1 in-browser conversion. */
  readonly source: LodSource
  /**
   * Positions in **millimetres**, in the store's Z-up axes, indexed, no normals.
   *
   * `node.matrixWorld` is already applied. `place.ts` stands it up.
   */
  readonly geometry: BufferGeometry
  /** The geometry's own bounds — which are the world bounds, because of the bake. */
  readonly bounds: Box3
  readonly triangles: number
  readonly vertices: number
  /** Bytes over the wire. */
  readonly bytes: number
  /** Decoded typed-array bytes: positions plus index. What the budget spends. */
  readonly decodedBytes: number
  /** The uniform scale the node carried. 1 when the object is uncompressed. */
  readonly nodeScale: number
  /** How far the real mesh disagrees with a tagged footprint extent, in grid units. */
  footprintDelta(extent: { readonly w: number; readonly d: number }): {
    readonly w: number
    readonly d: number
    readonly worst: number
  }
  /** Release the GPU buffers. Owned by whoever loaded it. */
  dispose(): void
}

/**
 * The one loader, with the decoder set once.
 *
 * Shared at module scope because `setMeshoptDecoder` installs a WASM module and
 * a loader per object would instantiate it per object. `GLTFLoader.parse` holds
 * no state across calls, so sharing is safe.
 */
let shared: GLTFLoader | null = null

function loader(): GLTFLoader {
  if (shared === null) {
    shared = new GLTFLoader()
    // Without this, an `extensionsRequired: [EXT_meshopt_compression]` document
    // throws from GLTFLoader with a legible message rather than rendering
    // nothing — verified in `contract.test.ts`.
    shared.setMeshoptDecoder(MeshoptDecoder)
  }
  return shared
}

/** Whether the decoder's WASM is usable in this environment. */
export function meshoptSupported(): boolean {
  return MeshoptDecoder.supported === true
}

export interface LoadLodOptions {
  readonly assets: Pick<CatalogAssets, 'lod'>
  readonly signal?: AbortSignal
  readonly fetchImpl?: typeof fetch
}

/** Fetch and decode one store object. */
export async function loadLodGeometry(blob: BlobId, options: LoadLodOptions): Promise<LodGeometry> {
  const url = lodGlbUrl(options.assets, blob)
  const doFetch = options.fetchImpl ?? fetch

  let response: Response
  try {
    response = await doFetch(url, options.signal === undefined ? {} : { signal: options.signal })
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    throw new LodLoadError(blob, url, 'the request failed', { cause })
  }

  // 403 alongside 404: a bucket whose public access is not configured answers
  // with one and not the other, and both mean "there is no object here yet".
  if (response.status === 404 || response.status === 403) {
    throw new LodAbsentError(blob, url, response.status)
  }
  if (!response.ok) {
    throw new LodLoadError(blob, url, `HTTP ${String(response.status)} ${response.statusText}`)
  }

  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
  if (contentType !== undefined && contentType !== '' && !GLB_CONTENT_TYPES.includes(contentType)) {
    throw new LodLoadError(blob, url, `served as ${contentType}, which is not a binary glTF`)
  }

  let buffer: ArrayBuffer
  try {
    buffer = await response.arrayBuffer()
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    throw new LodLoadError(blob, url, 'the body could not be read', { cause })
  }

  return parseLodGlb(blob, buffer, url)
}

/**
 * Decode GLB bytes into a millimetre geometry. The half with no network in it.
 *
 * Exported so a test can hand it real bytes off disk, which is how the contract
 * against G1 is actually checked.
 */
export async function parseLodGlb(blob: BlobId, buffer: ArrayBuffer, url = `lod:${blob}`): Promise<LodGeometry> {
  if (buffer.byteLength < 12) throw new LodLoadError(blob, url, `only ${String(buffer.byteLength)} bytes`)
  if (new DataView(buffer).getUint32(0, true) !== GLB_MAGIC) {
    throw new LodLoadError(blob, url, 'the body does not start with the glTF magic — probably an error page')
  }

  let scene: Group
  try {
    scene = await new Promise<Group>((resolve, reject) => {
      loader().parse(buffer, '', (gltf) => {
        resolve(gltf.scene)
      }, reject)
    })
  } catch (cause) {
    throw new LodLoadError(blob, url, cause instanceof Error ? cause.message : 'the document could not be parsed', {
      cause,
    })
  }

  // Local matrices are composed from the node's TRS at construction, but
  // `matrixWorld` is only up to date after this call — and `matrixWorld` is the
  // whole point.
  scene.updateMatrixWorld(true)

  const meshes: Mesh[] = []
  scene.traverse((object) => {
    if ((object as Mesh).isMesh) meshes.push(object as Mesh)
  })

  const source = meshes[0]
  if (source === undefined) throw new LodLoadError(blob, url, 'the document holds no mesh')
  if (meshes.length > 1) {
    // G1 writes one mesh with one primitive. More than one means the format
    // moved, and instancing a single geometry would silently drop the rest.
    throw new LodLoadError(blob, url, `${String(meshes.length)} meshes, expected 1 — the store format changed`)
  }

  const geometry = bakeWorldMatrix(source, blob, url)
  disposeLoaded(scene)

  const bounds = geometry.boundingBox ?? new Box3()
  const index = geometry.getIndex()
  const position = geometry.getAttribute('position')
  const triangles = index === null ? Math.floor(position.count / 3) : Math.floor(index.count / 3)

  return {
    blob,
    source: 'lod',
    geometry,
    bounds,
    triangles,
    vertices: position.count,
    bytes: buffer.byteLength,
    decodedBytes: position.count * 3 * 4 + (index === null ? 0 : index.count * index.array.BYTES_PER_ELEMENT),
    nodeScale: uniformScaleOf(source),
    footprintDelta: (extent) => footprintDelta(bounds, extent),
    dispose: () => {
      geometry.dispose()
    },
  }
}

/**
 * Copy the vertices out through `node.matrixWorld` into a float geometry.
 *
 * Not `geometry.applyMatrix4` — see the module note on `setXYZ` re-normalizing
 * an `int16` attribute into oblivion.
 */
function bakeWorldMatrix(mesh: Mesh, blob: BlobId, url: string): BufferGeometry {
  const position = mesh.geometry.getAttribute('position')
  if (position === undefined) throw new LodLoadError(blob, url, 'the primitive has no POSITION attribute')

  const count = position.count
  const positions = new Float32Array(count * 3)
  const vertex = new Vector3()
  for (let i = 0; i < count; i += 1) {
    // Denormalizes an int16 normalized attribute on the way out.
    vertex.fromBufferAttribute(position, i)
    vertex.applyMatrix4(mesh.matrixWorld)
    positions[i * 3] = vertex.x
    positions[i * 3 + 1] = vertex.y
    positions[i * 3 + 2] = vertex.z
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))

  const index = mesh.geometry.getIndex()
  if (index !== null) {
    // Cloned rather than shared: the loaded document is disposed immediately
    // after, and an index attribute holding a view into a disposed buffer is a
    // black mesh with no error.
    geometry.setIndex(new BufferAttribute(index.array.slice(0), 1))
  }

  // No `computeVertexNormals()`. There is no NORMAL attribute in the store by
  // design and `src/three/material.ts` sets `flatShading: true`, under which
  // three derives the face normal in the fragment shader from the screen-space
  // derivatives of the view position — so a normal attribute would be compiled
  // out of the shader and cost 12 bytes a vertex to be ignored.
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

/** The node's uniform scale, for the readout and for the contract test. */
function uniformScaleOf(mesh: Mesh): number {
  return new Vector3().setFromMatrixColumn(mesh.matrixWorld, 0).length()
}

/**
 * Release what `GLTFLoader` built.
 *
 * It constructs a `MeshStandardMaterial` per primitive (a material-less glTF
 * primitive gets the loader's default) and the quantized geometry we have
 * already copied out of. Neither is used again, and neither is owned by r3f
 * because neither came from JSX.
 */
function disposeLoaded(scene: Group): void {
  scene.traverse((object) => {
    const mesh = object as Mesh
    if (mesh.isMesh !== true) return
    mesh.geometry.dispose()
    const material = mesh.material
    if (Array.isArray(material)) for (const one of material) one.dispose()
    else material.dispose()
  })
}

/* ------------------------------------------------- the converted-mesh source */

/**
 * A cached conversion → the same `LodGeometry` the GLB path yields.
 *
 * Nothing is baked and nothing is denormalised here, which is the whole
 * difference between the two paths: `src/mesh/convert.ts` writes `float32`
 * positions in millimetres with an identity transform, because it has no
 * container to quantise for. So this function is a wrap, not a decode — the
 * arrays come out of IndexedDB through the structured clone algorithm as typed
 * arrays and go straight onto a `BufferGeometry`. That is why a cache hit is
 * milliseconds against the 1.4 s the download it replaces takes.
 *
 * No `computeVertexNormals()`, for `bakeWorldMatrix`'s three reasons: the app's
 * material sets `flatShading: true`, glTF says a primitive with no `NORMAL`
 * renders flat, and a normal attribute is 12 bytes a vertex to be compiled out
 * of the shader.
 */
export function geometryFromRecord(record: MeshRecord): LodGeometry {
  const geometry = new BufferGeometry()
  // Copied rather than adopted. The record's arrays are the ones IndexedDB
  // handed back and a caller may hold the record for its readout fields; a
  // `BufferGeometry.dispose()` that detached a buffer somebody else is reading
  // is the kind of bug that shows up as a black mesh three interactions later.
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(record.positions), 3))
  geometry.setIndex(
    record.indices instanceof Uint16Array
      ? new BufferAttribute(new Uint16Array(record.indices), 1)
      : new BufferAttribute(new Uint32Array(record.indices), 1),
  )
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()

  const bounds = geometry.boundingBox ?? new Box3()
  const index = geometry.getIndex()
  const position = geometry.getAttribute('position')

  return {
    blob: record.blob as BlobId,
    source: 'converted',
    geometry,
    bounds,
    triangles: record.triangles,
    vertices: record.vertices,
    // What the source STL cost to fetch, so the readout can say what the
    // conversion saved. There were no GLB bytes over the wire on this path.
    bytes: record.sourceBytes,
    decodedBytes:
      position.count * 3 * 4 + (index === null ? 0 : index.count * index.array.BYTES_PER_ELEMENT),
    // No node transform to undo: the conversion emits millimetres directly.
    nodeScale: 1,
    footprintDelta: (extent) => footprintDelta(bounds, extent),
    dispose: () => {
      geometry.dispose()
    },
  }
}

export interface LoadMeshOptions extends LoadLodOptions {
  /**
   * The converted-mesh cache, or `undefined` for "there is none".
   *
   * A `Promise` because opening IndexedDB is asynchronous and `useLodStore`
   * must be able to start a load without having awaited it. It resolves to
   * `null` — and `undefined` is allowed too — where there is no usable
   * IndexedDB, which is Node, jsdom and Firefox in private browsing. Either
   * degrades to exactly this module's behaviour before row R1: `/lod/` or
   * nothing.
   */
  readonly cache?: Promise<MeshCache | null> | undefined
}

/**
 * One mesh, from whichever store has it. **The seam rows R2 and R3 consume.**
 *
 * `/lod/` first, the converted cache second, {@link LodAbsentError} only when
 * neither has it — which today means "this design was never added to the
 * library, so nothing converted it". A {@link LodLoadError} from `/lod/` is
 * *not* covered by the fallback: a corrupt or misconfigured store object is a
 * fault worth reporting, and quietly converting 10.77 MB of STL to paper over it
 * would hide the one failure the panel offers a retry for.
 */
export async function loadMeshGeometry(blob: BlobId, options: LoadMeshOptions): Promise<LodGeometry> {
  try {
    return await loadLodGeometry(blob, options)
  } catch (cause) {
    if (!(cause instanceof LodAbsentError)) throw cause
    if (options.cache === undefined) throw cause

    let record: MeshRecord | undefined
    try {
      const cache = await options.cache
      if (cache === null) throw cause
      record = await cache.get(blob)
    } catch {
      // A cache that cannot be read is the same outcome as a cache that is
      // empty: there is no geometry for this blob. It is reported as the
      // absence it is rather than as a load fault, because a retry would fail
      // the same way.
      throw cause
    }
    if (record === undefined || record.version !== MESH_CACHE_VERSION) throw cause
    return geometryFromRecord(record)
  }
}
