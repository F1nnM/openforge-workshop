/**
 * The G2 contract, checked against the real loader instead of against a docblock.
 *
 * Row G2's dependency on this row is a **contract dependency**: it shares no files
 * with `tools/lod/**`, so nothing in either row's file list can catch a
 * disagreement, and G2 "renders nothing if the shape differs". The cheapest place
 * to catch that is here, by loading an object this pipeline just produced with the
 * exact loader and decoder G2 will use.
 *
 * That is also the only honest way to make the three claims this row hands over:
 *
 *  1. `MeshoptDecoder` exists at `three/examples/jsm/libs/meshopt_decoder.module.js`
 *     in three 0.185.1. `examples/jsm` is outside three's semver guarantee and
 *     `postprocessing` 6.39.4 pins `three <0.186.0`, so this is checked, not assumed.
 *  2. Omitting `NORMAL` gets flat shading for free — `material.flatShading` comes
 *     back `true` without anyone setting it.
 *  3. **The node transform is load-bearing.** Meshopt quantization moves the scale
 *     and offset onto the node, so `geometry` alone is a unit-ish mesh and only
 *     `matrixWorld` restores millimetres. This test measures both, so the failure
 *     mode is a number in a diff rather than a builder full of tiny tiles.
 *
 * three is a dev-time import here. Nothing in `tools/` ships.
 */
import type { Group, Mesh } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { beforeAll, describe, expect, it } from 'vitest'

import { decimate } from './decimate'
import { icosphere, binaryStl } from './fixtures/stl'

/** A 25 mm-radius sphere at 81,920 triangles — well above the ceiling. */
const SOURCE = binaryStl(icosphere(6, 25))

interface LoadedGltf {
  scene: Group
}

function loadGlb(glb: Uint8Array): Promise<LoadedGltf> {
  const loader = new GLTFLoader()
  loader.setMeshoptDecoder(MeshoptDecoder)
  const buffer = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer
  return new Promise((resolve, reject) => {
    loader.parse(buffer, '', (gltf) => resolve(gltf), reject)
  })
}

function onlyMesh(scene: Group): Mesh {
  scene.updateMatrixWorld(true)
  const meshes: Mesh[] = []
  scene.traverse((object) => {
    if ((object as Mesh).isMesh) meshes.push(object as Mesh)
  })
  const mesh = meshes[0]
  if (mesh === undefined) throw new Error('the loaded scene holds no mesh')
  // One mesh, one primitive: G2 instances a single geometry per design.
  expect(meshes).toHaveLength(1)
  return mesh
}

describe('three 0.185.1 loads what this pipeline writes', () => {
  let compressed: Awaited<ReturnType<typeof decimate>>
  let mesh: Mesh

  beforeAll(async () => {
    compressed = await decimate(SOURCE)
    mesh = onlyMesh((await loadGlb(compressed.glb)).scene)
  }, 60_000)

  it('decodes to the triangle count the manifest claims', () => {
    expect(mesh.geometry.index?.count).toBe(compressed.triangles * 3)
    expect(mesh.geometry.attributes.position?.count).toBe(compressed.vertices)
  })

  it('flat-shades itself, because there is no NORMAL attribute', () => {
    expect(mesh.geometry.attributes.normal).toBeUndefined()
    // Nobody set this. GLTFLoader does it when normals are absent, which is why
    // the store carries none — see decimate.ts.
    expect((mesh.material as { flatShading?: boolean }).flatShading).toBe(true)
  })

  it('needs matrixWorld to be in millimetres — the footgun, measured', () => {
    mesh.geometry.computeBoundingBox()
    const local = mesh.geometry.boundingBox
    if (local === null) throw new Error('no bounding box')

    const localSize = local.max.clone().sub(local.min)
    const worldSize = local.clone().applyMatrix4(mesh.matrixWorld).max.clone().sub(
      local.clone().applyMatrix4(mesh.matrixWorld).min,
    )

    // The source sphere is 50 mm across. The geometry alone is not.
    expect(worldSize.x).toBeCloseTo(50, 0)
    expect(localSize.x).toBeLessThan(3)
    expect(worldSize.x / localSize.x).toBeGreaterThan(10)

    // And the transform is a uniform scale plus a translation, nothing else.
    const scale = mesh.matrixWorld.elements
    expect(scale[0]).toBeCloseTo(scale[5] ?? 0, 6)
    expect(scale[0]).toBeCloseTo(scale[10] ?? 0, 6)
  })

  it('needs no decoder at all without meshopt, and is then already in millimetres', async () => {
    const plain = await decimate(SOURCE, { meshopt: false })
    const loader = new GLTFLoader()
    // Deliberately no setMeshoptDecoder: an uncompressed object must still load.
    const buffer = plain.glb.buffer.slice(
      plain.glb.byteOffset,
      plain.glb.byteOffset + plain.glb.byteLength,
    ) as ArrayBuffer
    const gltf = await new Promise<LoadedGltf>((resolve, reject) => {
      loader.parse(buffer, '', (loaded) => resolve(loaded), reject)
    })
    const uncompressed = onlyMesh(gltf.scene)
    uncompressed.geometry.computeBoundingBox()
    const box = uncompressed.geometry.boundingBox
    if (box === null) throw new Error('no bounding box')
    expect(box.max.x - box.min.x).toBeCloseTo(50, 0)
    expect(uncompressed.matrixWorld.elements[0]).toBe(1)
  }, 60_000)
})
