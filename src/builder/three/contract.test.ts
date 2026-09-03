/// <reference types="node" />
/**
 * The G1 contract, checked against real bytes instead of against a docblock.
 *
 * `v2-pr-series.md`'s contract table: *"G1 LOD → G2. GLB format, LOD levels,
 * `/lod/` path scheme. G2 renders nothing if the shape differs."* The two rows
 * share no files, so nothing in either one's `Owns` set can catch a
 * disagreement. `tools/lod/contract.test.ts` closes the gap from the producing
 * side by loading a GLB it just produced through the loader G2 will use; this
 * file closes it from the consuming side by running **`loadLod.ts`'s own code
 * path** over two GLBs that G1's pipeline produced from a real archive mesh.
 * See `fixtures/PROVENANCE.md`.
 *
 * ## What these tests prove
 *
 *   - `GLTFLoader` and `MeshoptDecoder` exist at the paths recorded in `lod.ts`,
 *     in the installed three, and decode a G1 object.
 *   - **`node.matrixWorld` is honoured.** The strongest assertion in the row: the
 *     loaded geometry's *own* bounding box is 25.4 mm, where the GLB's is 2.0.
 *     A regression that dropped the bake would fail here with a number in the
 *     diff.
 *   - There is no `NORMAL` attribute, and `flatShading` comes back `true` from
 *     `GLTFLoader` without anyone setting it.
 *   - `postprocessing`'s peer range and three's version are what `lod.ts` claims.
 *   - The uncompressed variant loads with **no decoder at all**, and the
 *     compressed one refuses legibly without it.
 *   - A 404 is an absence and an HTML error page with a 200 is a failure, and the
 *     two are different types.
 *
 * ## What they cannot prove
 *
 * **Nothing here renders a pixel.** There is no WebGL context in this
 * environment — `GLTFLoader.parse` and `BufferGeometry` are pure CPU-side
 * objects, so what is asserted is geometry, attributes, matrices and byte
 * counts. That the flat-shaded fragment shader compiles, that N8AO's occlusion
 * lands where the creases are, and that an `InstancedMesh` of 50 tiles draws in
 * one call are **not** checked by any test in this row: they need a GPU. The
 * shader path is at least *read* rather than assumed — see the `FLAT_SHADED`
 * assertion, which greps three's own compiled chunk.
 *
 * It also cannot prove anything about the **real** store, because there is not
 * one: blocker B2 is open and `/lod/` is empty. What it proves is that if the
 * store holds what G1's pipeline produces, this consumer reads it correctly.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { Vector3 } from 'three'
import type { Group, Mesh , Box3} from 'three'
import { describe, expect, it } from 'vitest'

import type { BlobId, CatalogAssets } from '@/catalog'

import {
  LOD_ATTRIBUTES,
  LOD_EXTENSIONS_REQUIRED,
  LOD_LEVELS,
  LOD_NODE_TRANSFORM,
  LOD_UP_AXIS,
  MESHOPT_DECODER_IMPORT,
  POSTPROCESSING_THREE_RANGE,
  VERIFIED_THREE_VERSION,
} from './lod'
import { LodAbsentError, LodLoadError, loadLodGeometry, parseLodGlb } from './loadLod'

const FIXTURES = join(process.cwd(), 'src', 'builder', 'three', 'fixtures')

/** The fixture mesh's md5 — also its content address in the bucket. */
const BLOB = '8180da93549154744c37f8370a82738f' as BlobId

const ASSETS: Pick<CatalogAssets, 'lod'> = { lod: 'https://objects.openforge.tools/lod' }

function fixture(name: string): ArrayBuffer {
  const bytes = readFileSync(join(FIXTURES, name))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

/** The compressed object, as `GLTFLoader` hands it over — *before* the bake. */
async function rawLoaded(name: string, decoder: boolean): Promise<Mesh> {
  const loader = new GLTFLoader()
  if (decoder) loader.setMeshoptDecoder(MeshoptDecoder)
  const scene = await new Promise<Group>((resolve, reject) => {
    loader.parse(fixture(name), '', (gltf) => {
      resolve(gltf.scene)
    }, reject)
  })
  scene.updateMatrixWorld(true)
  const meshes: Mesh[] = []
  scene.traverse((object) => {
    if ((object as Mesh).isMesh) meshes.push(object as Mesh)
  })
  const mesh = meshes[0]
  if (mesh === undefined) throw new Error('the fixture holds no mesh')
  // One mesh, one primitive: this row instances a single geometry per object,
  // and a second mesh would be silently dropped.
  expect(meshes).toHaveLength(1)
  return mesh
}

function sizeOf(box: Box3): Vector3 {
  return box.getSize(new Vector3())
}

/* ------------------------------------------------------------------ the pins */

describe('the three.js pins G1 asked this row to verify', () => {
  it('is on the three release the format was verified against', () => {
    const three = JSON.parse(readFileSync(join(process.cwd(), 'node_modules', 'three', 'package.json'), 'utf8')) as {
      version: string
      exports: Record<string, unknown>
    }
    expect(three.version).toBe(VERIFIED_THREE_VERSION)
    // CONFIRMED, claim 1: the loader and the decoder come out of `examples/jsm`,
    // which three exposes as a path pattern and excludes from semver. `files`
    // ships `build`, `examples/jsm` and `src` — the addons are a separate tree,
    // not part of the versioned entry point.
    expect(three.exports['./examples/jsm/*']).toBe('./examples/jsm/*')
    expect(three.exports['./addons/*']).toBe('./examples/jsm/*')
    expect(MESHOPT_DECODER_IMPORT).toBe('three/examples/jsm/libs/meshopt_decoder.module.js')
  })

  it('is pinned there by postprocessing, which refuses 0.186', () => {
    const pp = JSON.parse(
      readFileSync(join(process.cwd(), 'node_modules', 'postprocessing', 'package.json'), 'utf8'),
    ) as { version: string; peerDependencies: Record<string, string> }

    // CONFIRMED, claim 2. n8ao sits on top of postprocessing, and Stage's AO
    // pass sits on top of n8ao, so this range is what holds the decoder path
    // still: the three upgrade that could move `examples/jsm` is the upgrade
    // postprocessing will not accept.
    expect(pp.peerDependencies['three']).toBe(POSTPROCESSING_THREE_RANGE)
    expect(POSTPROCESSING_THREE_RANGE).toContain('< 0.186.0')
    expect(VERIFIED_THREE_VERSION.startsWith('0.185.')).toBe(true)
  })

  it('has a usable meshopt decoder in this environment', () => {
    expect(MeshoptDecoder.supported).toBe(true)
  })
})

/* ------------------------------------------------------------ the node bake */

describe('loadLod honours node.matrixWorld', () => {
  it('reads 2 units out of the GLB and 25.4 mm out of the loader', async () => {
    // What GLTFLoader hands over: quantized positions and the scale on the node.
    const raw = await rawLoaded('wall-8180da93.glb', true)
    raw.geometry.computeBoundingBox()
    const rawBox = raw.geometry.boundingBox
    if (rawBox === null) throw new Error('no bounding box')
    const rawSize = sizeOf(rawBox)

    expect(rawSize.x).toBeCloseTo(2, 3)
    expect(rawSize.y).toBeCloseTo(1.000153, 3)
    expect(rawSize.z).toBeCloseTo(0.472427, 3)

    // The node's transform is a uniform scale plus a translation, nothing else.
    const scale = new Vector3().setFromMatrixColumn(raw.matrixWorld, 0).length()
    expect(scale).toBeCloseTo(12.7, 6)
    const translation = new Vector3().setFromMatrixPosition(raw.matrixWorld)
    expect(translation.x).toBe(0)
    expect(translation.y).toBe(0)
    // 3.000000238… — the node's translation is a float32 in the GLB. Worth
    // seeing rather than rounding away: it is 0.24 nanometres of error against a
    // 25.4 mm tile, and it is why every dimensional assertion in this file is a
    // `toBeCloseTo` and not an equality.
    expect(translation.z).toBeCloseTo(3, 6)

    // What this row's loader hands over: the same mesh, in millimetres, with
    // matrixWorld already in the vertices. `geometry.boundingBox` alone is now
    // the world box, which is the property `place.ts` and `instances.ts` rely on
    // and the one an InstancedMesh cannot get any other way.
    const lod = await parseLodGlb(BLOB, fixture('wall-8180da93.glb'))
    const bakedSize = sizeOf(lod.bounds)
    expect(bakedSize.x).toBeCloseTo(25.4, 2)
    expect(bakedSize.y).toBeCloseTo(12.702, 2)
    expect(bakedSize.z).toBeCloseTo(6.0, 2)

    // And the ratio is the node scale, not 1 — the assertion that fails loudly
    // if the bake is ever dropped.
    expect(bakedSize.x / rawSize.x).toBeCloseTo(12.7, 3)
    expect(lod.nodeScale).toBeCloseTo(12.7, 6)
    lod.dispose()
  })

  it('does not corrupt the quantized array by writing through it', async () => {
    // `BufferAttribute.setXYZ` re-normalizes on write, so `applyMatrix4` on a
    // normalized int16 attribute clamps every coordinate to 1.0. The loader
    // copies into a fresh Float32Array instead, and this is the check that it
    // did: a clamped array would have a bounding box of at most 2 units.
    const lod = await parseLodGlb(BLOB, fixture('wall-8180da93.glb'))
    const position = lod.geometry.getAttribute('position')
    expect(position.array).toBeInstanceOf(Float32Array)
    expect(position.normalized).toBe(false)
    expect(Math.max(...Array.from(position.array as Float32Array).map(Math.abs))).toBeGreaterThan(6)
    lod.dispose()
  })

  it('lands the plain object on the same millimetres with an identity node', async () => {
    const raw = await rawLoaded('wall-8180da93.plain.glb', false)
    expect(raw.matrixWorld.elements[0]).toBe(1)
    expect(new Vector3().setFromMatrixPosition(raw.matrixWorld).toArray()).toEqual([0, 0, 0])

    const lod = await parseLodGlb(BLOB, fixture('wall-8180da93.plain.glb'))
    const size = sizeOf(lod.bounds)
    expect(size.x).toBeCloseTo(25.4, 3)
    expect(size.y).toBeCloseTo(12.7, 3)
    expect(size.z).toBeCloseTo(6.0, 3)
    // LOD_NODE_TRANSFORM describes the default (`meshopt: true`) path; the plain
    // path is `identity`, and the consumer is correct for both because it
    // applies whatever matrix is there.
    expect(LOD_NODE_TRANSFORM).toBe('quantized')
    expect(lod.nodeScale).toBeCloseTo(1, 9)
    lod.dispose()
  })

  it('rests on z = 0 with height on z, which is why place.ts rotates about X', async () => {
    const lod = await parseLodGlb(BLOB, fixture('wall-8180da93.glb'))
    // The tall axis is the third one and the mesh sits on it at zero: the
    // archive is Z-up and the store carries its axes unchanged. glTF's own
    // convention is Y-up, so a consumer that trusted the container would lay
    // every tile on its back.
    expect(LOD_UP_AXIS).toBe('z')
    expect(lod.bounds.min.z).toBeCloseTo(0, 2)
    expect(lod.bounds.min.y).toBeCloseTo(-6.351, 2)
    expect(lod.bounds.max.y).toBeCloseTo(6.351, 2)
    lod.dispose()
  })
})

/* -------------------------------------------------------------- the format */

describe('the object’s shape is what lod.ts says', () => {
  it('carries POSITION and nothing else, indexed, at one level', async () => {
    const lod = await parseLodGlb(BLOB, fixture('wall-8180da93.glb'))
    expect(Object.keys(lod.geometry.attributes)).toEqual(['position'])
    expect(lod.geometry.getAttribute('normal')).toBeUndefined()
    expect(lod.geometry.getIndex()).not.toBeNull()
    expect(lod.triangles).toBe(118)
    expect(lod.vertices).toBe(59)
    // 118 triangles over 59 vertices is exactly the 0.5 ratio the memory budget
    // in `lod.ts` is computed from, and G1 measured the same 0.166–0.167 weld
    // ratio from 118 to 2.18 M triangles.
    expect(lod.vertices / lod.triangles).toBeCloseTo(0.5, 6)
    expect(LOD_ATTRIBUTES).toEqual(['POSITION'])
    expect(LOD_LEVELS).toBe(1)
    lod.dispose()
  })

  it('gets flat shading from GLTFLoader without anyone setting it', async () => {
    const raw = await rawLoaded('wall-8180da93.glb', true)
    expect(raw.geometry.getAttribute('normal')).toBeUndefined()
    // Nobody set this. glTF requires a primitive without NORMAL to render flat,
    // and GLTFLoader implements it — which is why the store carries no normals
    // and why this row does not call computeVertexNormals().
    expect((raw.material as { flatShading?: boolean }).flatShading).toBe(true)
  })

  it('needs no NORMAL attribute for FLAT_SHADED, read out of three’s own shader', () => {
    // Not a render test — there is no GPU here. What this checks is that the
    // shader chunk three 0.185.1 will compile derives the normal from the view
    // position's screen-space derivatives under FLAT_SHADED, and compiles the
    // vNormal varying out entirely. So a NORMAL attribute would be uploaded and
    // ignored, which is the claim `loadLod.ts` makes when it skips
    // computeVertexNormals().
    const three = readFileSync(join(process.cwd(), 'node_modules', 'three', 'build', 'three.module.js'), 'utf8')
    expect(three).toContain('#ifdef FLAT_SHADED\\n\\tvec3 fdx = dFdx( vViewPosition );')
    expect(three).toContain('normal_vertex = "#ifndef FLAT_SHADED\\n\\tvNormal = normalize( transformedNormal );')
  })

  it('declares the two extensions as required', () => {
    // Read off the JSON chunk rather than through the loader: `extensionsRequired`
    // is what makes the decoder mandatory, and GLTFLoader does not expose it.
    const glb = fixture('wall-8180da93.glb')
    const view = new DataView(glb)
    const jsonLength = view.getUint32(12, true)
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, jsonLength))) as {
      extensionsRequired?: string[]
      asset: { copyright?: string; extras?: { tool?: string } }
    }
    expect(json.extensionsRequired?.slice().sort()).toEqual([...LOD_EXTENSIONS_REQUIRED].sort())
    // G1 stamps its own provenance into the asset. A store object that lost it
    // came from somewhere else.
    expect(json.asset.copyright).toContain('OpenForge')
    expect(json.asset.extras?.tool).toContain('tools/lod')
  })

  it('refuses a compressed object legibly when the decoder is missing', async () => {
    const loader = new GLTFLoader()
    // Deliberately no setMeshoptDecoder.
    await expect(
      new Promise((resolve, reject) => {
        loader.parse(fixture('wall-8180da93.glb'), '', resolve, reject)
      }),
    ).rejects.toThrow(/setMeshoptDecoder must be called/)
  })
})

/* -------------------------------------------------------------- the network */

describe('the absences, since nothing is uploaded', () => {
  const notFound = (): Promise<Response> => Promise.resolve(new Response(null, { status: 404 }))

  it('reports a 404 as an absence, not a failure', async () => {
    await expect(loadLodGeometry(BLOB, { assets: ASSETS, fetchImpl: notFound })).rejects.toBeInstanceOf(
      LodAbsentError,
    )
  })

  it('reports a 403 the same way — a bucket with no public access', async () => {
    const forbidden = (): Promise<Response> => Promise.resolve(new Response(null, { status: 403 }))
    const error = await loadLodGeometry(BLOB, { assets: ASSETS, fetchImpl: forbidden }).catch(
      (cause: unknown) => cause,
    )
    expect(error).toBeInstanceOf(LodAbsentError)
    expect((error as LodAbsentError).message).toContain('not backfilled yet')
  })

  it('refuses an HTML error page served with a 200', async () => {
    // Cloudflare will do this, and `GLTFLoader.parse` on HTML fails somewhere
    // deep with a JSON syntax error. The magic bytes are checked first.
    const errorPage = (): Promise<Response> =>
      Promise.resolve(
        new Response('<!doctype html><title>502</title>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      )
    await expect(loadLodGeometry(BLOB, { assets: ASSETS, fetchImpl: errorPage })).rejects.toBeInstanceOf(
      LodLoadError,
    )
  })

  it('loads a real object through the fetch seam and lands in millimetres', async () => {
    const served = (): Promise<Response> =>
      Promise.resolve(
        new Response(fixture('wall-8180da93.glb'), {
          status: 200,
          headers: { 'content-type': 'model/gltf-binary' },
        }),
      )
    const lod = await loadLodGeometry(BLOB, { assets: ASSETS, fetchImpl: served })
    expect(lod.bytes).toBe(2052)
    expect(sizeOf(lod.bounds).x).toBeCloseTo(25.4, 2)
    lod.dispose()
  })

  it('rejects a body that is not a glTF at all', async () => {
    const wrong = (): Promise<Response> => Promise.resolve(new Response(new Uint8Array(64), { status: 200 }))
    await expect(loadLodGeometry(BLOB, { assets: ASSETS, fetchImpl: wrong })).rejects.toThrow(/glTF magic/)
  })
})
