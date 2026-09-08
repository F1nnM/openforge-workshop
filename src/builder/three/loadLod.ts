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
 * ## An absence is still a distinct outcome, and now a rarer one
 *
 * `/lod/` is backfilled: every one of the archive's 8,353 distinct meshes has an
 * object, so a 404 no longer means "the store has not been written yet". It
 * still is not a fault — a share link can name a blob this build's index does
 * not carry, and a bucket misconfigured for public read answers 403 — so
 * {@link LodAbsentError} stays a distinct type from {@link LodLoadError}: one is
 * "there is no object for this mesh", which the panel reports as a state, and
 * the other is a fault worth a retry.
 *
 * **There is no second store.** This module used to fall back to an in-browser
 * conversion of the 10.77 MB source STL, cached in IndexedDB, because `/lod/`
 * answered 404 for everything and the builder would otherwise have drawn nothing
 * at all. The backfill is what that was waiting for, so the whole of `src/mesh/`
 * and the `loadMeshGeometry` seam over it are deleted rather than left dormant:
 * a fallback that can no longer fire is a second answer to a question with one
 * answer, and it kept a 55 kB simplifier, a worker and an IndexedDB schema in
 * the build for a path nothing takes.
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

/** One loaded object, ready to instance. */
export interface LodGeometry {
  readonly blob: BlobId
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
