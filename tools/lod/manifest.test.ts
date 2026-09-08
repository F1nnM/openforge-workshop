/**
 * The handover artefact, and the contract G2 builds against.
 *
 * Two of these tests are not really about this module. `the decoder path` reads
 * `node_modules` directly, because the claim "`MeshoptDecoder` exists at
 * `three/examples/jsm/libs/meshopt_decoder.module.js` in three 0.185.1" is the
 * kind that is true when written and false after an upgrade — and `examples/jsm`
 * is outside three's semver guarantee, so a *patch* release may move it. Better
 * a red test here than a builder that renders nothing.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { REPO_ROOT } from './catalog'
import { COPYRIGHT, TOOL } from './decimate'
import { testCatalog } from './fixtures/catalog'
import {
  LOD_CACHE_CONTROL,
  LOD_CONTENT_TYPE,
  MANIFEST_VERSION,
  MESHOPT_DECODER_IMPORT,
  VERIFIED_THREE_VERSION,
  buildLodManifest,
  lodFormat,
  serialiseLodManifest,
} from './manifest'
import { MAX_TRIANGLES, MIN_TRIANGLES } from './mesh'

const A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

const CATALOG = testCatalog({
  records: [
    { id: 'tiles/a.stl', ord: 0, blob: A, bytes: 1_000_000 },
    { id: 'tiles/b.stl', ord: 1, blob: B, bytes: 40_000_000 },
  ],
})

function entry(overrides: Partial<Parameters<typeof buildLodManifest>[0]['entries'][number]> = {}) {
  return {
    key: `lod/bbbbbb/${B}.glb`,
    blob: B,
    tiles: 3,
    designs: 2,
    sourceBytes: 40_000_000,
    sourceTriangles: 799_998,
    bytes: 44_000,
    triangles: 8_000,
    vertices: 4_100,
    weld: { before: 2_399_994, after: 400_000 },
    fidelity: { areaError: 0.012, bboxDelta: 0.004, acceptable: true },
    passThrough: false,
    aboveGate: true,
    ...overrides,
  }
}

function manifest(entries = [entry()], contents = new Map([[entries[0]?.key ?? '', new Uint8Array([1, 2, 3])]])) {
  return buildLodManifest({
    catalog: CATALOG,
    prefix: 'lod',
    publicBase: 'https://objects.example.test/lod',
    staged: 'tools/lod/out',
    meshopt: true,
    entries,
    contents,
    generated: '2026-01-01T00:00:00.000Z',
  })
}

describe('buildLodManifest', () => {
  it('hashes every staged object and sorts by key', () => {
    const first = entry({ key: `lod/zzzzzz/${B}.glb` })
    const second = entry({ key: `lod/aaaaaa/${A}.glb`, blob: A, aboveGate: false })
    const built = manifest(
      [first, second],
      new Map([
        [first.key, new Uint8Array([1])],
        [second.key, new Uint8Array([2])],
      ]),
    )
    expect(built.entries.map((item) => item.key)).toEqual([second.key, first.key])
    expect(built.entries[0]?.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(built.entries[0]?.sha256).not.toBe(built.entries[1]?.sha256)
  })

  it('totals what a reviewer checks the run against', () => {
    const built = manifest()
    expect(built.totals.objects).toBe(1)
    expect(built.totals.bytes).toBe(44_000)
    expect(built.totals.sourceBytes).toBe(40_000_000)
    expect(built.totals.aboveGate).toBe(1)
    expect(built.totals.unfaithful).toBe(0)
  })

  it('counts an object that shipped over the fidelity bar', () => {
    const built = manifest([entry({ fidelity: { areaError: 0.09, bboxDelta: 0.01, acceptable: false } })])
    expect(built.totals.unfaithful).toBe(1)
  })

  it('carries the index stamp verbatim, which is what X4 hangs the LOD store on', () => {
    expect(manifest().catalog).toEqual(CATALOG.version)
  })

  it('is stable given a pinned timestamp', () => {
    expect(serialiseLodManifest(manifest())).toBe(serialiseLodManifest(manifest()))
  })

  it('says loudly that nothing was uploaded, and names the blocker', () => {
    const notes = manifest().notes.join('\n')
    expect(notes).toContain('B2')
    expect(notes).toContain('Nothing here has been uploaded')
    expect(notes).toContain('PREVIEW-ONLY')
    expect(notes).toContain('read from CatalogAssets.lod')
    expect(notes).toContain('ours to mint')
  })

  it('warns G2 about the node transform and the decoder', () => {
    const notes = manifest().notes.join('\n')
    expect(notes).toContain('node.matrixWorld')
    expect(notes).toContain(MESHOPT_DECODER_IMPORT)
  })

  it('emits upload commands that set the content type and cache control', () => {
    const commands = manifest().commands.join('\n')
    expect(commands).toContain('--dryrun')
    expect(commands).toContain(LOD_CONTENT_TYPE)
    expect(commands).toContain(LOD_CACHE_CONTROL)
    expect(commands).toContain('r2.cloudflarestorage.com')
  })
})

describe('the format contract', () => {
  it('is one level, and says why in the type', () => {
    expect(lodFormat({ meshopt: true, prefix: 'lod' }).levels).toBe(1)
  })

  it('names the path scheme G2 builds URLs with', () => {
    expect(lodFormat({ meshopt: true, prefix: 'lod' }).path).toBe('lod/{md5[0:6]}/{md5}.glb')
  })

  it('declares POSITION only, indexed triangles, no material', () => {
    const format = lodFormat({ meshopt: true, prefix: 'lod' })
    expect(format.attributes).toEqual(['POSITION'])
    expect(format.indexed).toBe(true)
    expect(format.primitiveMode).toBe('TRIANGLES')
    expect(format.material).toBe('none')
    expect(format.shading).toContain('flatShading')
  })

  it('declares the band and the guard thresholds the run enforced', () => {
    const format = lodFormat({ meshopt: true, prefix: 'lod' })
    expect(format.minTriangles).toBe(MIN_TRIANGLES)
    expect(format.maxTriangles).toBe(MAX_TRIANGLES)
    expect(format.weldRatioLimit).toBeLessThan(1)
  })

  it('declares the node transform, which is the footgun', () => {
    expect(lodFormat({ meshopt: true, prefix: 'lod' }).nodeTransform).toBe('quantized')
    expect(lodFormat({ meshopt: false, prefix: 'lod' }).nodeTransform).toBe('identity')
  })

  it('declares exactly the extensions a loader must support', () => {
    expect(lodFormat({ meshopt: true, prefix: 'lod' }).extensionsRequired).toEqual([
      'EXT_meshopt_compression',
      'KHR_mesh_quantization',
    ])
    expect(lodFormat({ meshopt: false, prefix: 'lod' }).extensionsRequired).toEqual([])
  })

  it('carries the tool and the licence the objects travel with', () => {
    const format = lodFormat({ meshopt: true, prefix: 'lod' })
    expect(format.tool).toBe(TOOL)
    expect(format.copyright).toBe(COPYRIGHT)
    expect(format.versions['@gltf-transform/core']).toMatch(/^v?4\./)
  })

  it('has a manifest version to bump when this shape changes', () => {
    expect(MANIFEST_VERSION).toBe(1)
  })
})

describe('the decoder path', () => {
  const HERE = dirname(fileURLToPath(import.meta.url))

  it('exists in the installed three, at the pin the plan requires', () => {
    const pkg = JSON.parse(
      readFileSync(join(REPO_ROOT, 'node_modules', 'three', 'package.json'), 'utf8'),
    ) as { version: string }
    expect(pkg.version).toBe(VERIFIED_THREE_VERSION)

    const decoder = join(REPO_ROOT, 'node_modules', MESHOPT_DECODER_IMPORT)
    expect(existsSync(decoder)).toBe(true)
    // The named export G2 imports. `examples/jsm` is outside three's semver
    // guarantee, so this is checked rather than assumed.
    expect(readFileSync(decoder, 'utf8')).toContain('export { MeshoptDecoder }')
    expect(HERE).toContain('tools/lod')
  })

  it('is a path GLTFLoader can be told about', () => {
    const loader = readFileSync(
      join(REPO_ROOT, 'node_modules', 'three', 'examples', 'jsm', 'loaders', 'GLTFLoader.js'),
      'utf8',
    )
    expect(loader).toContain('setMeshoptDecoder')
    expect(loader).toContain('EXT_meshopt_compression')
    expect(loader).toContain('KHR_mesh_quantization')
    // The reason there is no NORMAL attribute in the store.
    expect(loader).toContain('geometry.attributes.normal === undefined')
  })
})
