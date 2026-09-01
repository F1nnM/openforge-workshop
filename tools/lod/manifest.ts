/**
 * What would be uploaded, the exact command to upload it, and **the contract G2
 * builds against**.
 *
 * ## This tool does not upload
 *
 * `v2-pr-series.md`'s blockers table lists **B2, R2 write credentials for
 * `/thumbs/` and `/lod/`**, as open, and it gates this row's *execution* rather
 * than its code. So the run writes GLBs locally and emits this manifest: every
 * intended object with its key, its byte count and the sha256 of its contents,
 * plus the commands a human with credentials runs. The sha256 is what makes the
 * handover checkable — an uploader can verify what landed against what was
 * staged, and a rerun that produces different bytes for the same md5 (a
 * meshoptimizer upgrade, a changed target band) shows up in the manifest diff
 * instead of surfacing as a cache inconsistency months later.
 *
 * ## The `format` block is a contract, not documentation
 *
 * The series table says G1's output format is a **contract dependency of G2**,
 * which shares no files with this row. `Owns` therefore cannot reveal it, and G2
 * renders nothing if the shape differs. So the shape is written down here, in the
 * artefact G2's author reads, in enough detail to build a loader against:
 * attribute set, index type, primitive mode, extensions required, the decoder's
 * exact import path, and — the one that bites — **whether the node carries a
 * transform**.
 *
 * ## The version stamp
 *
 * `catalog` is the index's own `VersionStamp`, copied verbatim, exactly as
 * `tools/thumbnails/manifest.ts` does it. Row **X4** stamps five artefacts in one
 * CI step and the LOD store is one of them; carrying the index's stamp unchanged
 * is what makes "these GLBs were derived from *that* index" checkable without X4
 * having to reach into this tool. What X4 must add elsewhere is `lod` to
 * `CatalogAssets` and `ASSET_BASES` — see `catalog.ts`.
 */
import { createHash } from 'node:crypto'

import { VERSION as GLTF_TRANSFORM_VERSION } from '@gltf-transform/core'

import type { CatalogFile } from '../../src/catalog'

import { COPYRIGHT, TOOL, WELD_MIN_DROP } from './decimate'
import { KEEP_FRACTION, MAX_AREA_ERROR, MAX_BBOX_DELTA, MAX_TRIANGLES, MIN_TRIANGLES, SIMPLIFY_ERROR } from './mesh'

/** Version of this manifest's own shape. */
export const MANIFEST_VERSION = 1

/**
 * Recommended `Cache-Control` for a LOD object.
 *
 * Immutable is correct and unusually easy to justify: the key contains the source
 * mesh's md5, so a changed mesh is a changed key. A year is the longest value
 * browsers honour meaningfully.
 */
export const LOD_CACHE_CONTROL = 'public, max-age=31536000, immutable'

/** `model/gltf-binary` is the registered type for a `.glb`. */
export const LOD_CONTENT_TYPE = 'model/gltf-binary'

/**
 * The decoder import path G2 must use, verified against the installed tree.
 *
 * `EXT_meshopt_compression` needs a decoder in the browser, and three's is at
 * `three/examples/jsm/libs/meshopt_decoder.module.js` — **verified present in
 * three 0.185.1**, exporting `MeshoptDecoder` on its last line. `examples/jsm` is
 * outside three's semver guarantee, and `postprocessing` 6.39.4 peers
 * `three <0.186.0` while this project is pinned at 0.185.1, so the path is
 * recorded here rather than assumed: if a three upgrade moves it, this string is
 * what a reviewer diffs against.
 *
 * `GLTFLoader` also supports `KHR_mesh_quantization` (declared in its own header,
 * handled at `GLTFLoader.js:2510`), which the compression implies.
 */
export const MESHOPT_DECODER_IMPORT = 'three/examples/jsm/libs/meshopt_decoder.module.js'

/** The three release the decoder path above was verified against. */
export const VERIFIED_THREE_VERSION = '0.185.1'

/** One staged object. */
export interface ManifestEntry {
  /** Object key relative to the bucket root: `lod/{md5[0:6]}/{md5}.glb`. */
  key: string
  /** The source mesh's md5 — also this object's content address. */
  blob: string
  /** How many live catalog tiles resolve to this mesh. */
  tiles: number
  /** How many designs do. G2 keys an `InstancedMesh` per design. */
  designs: number
  /** Source STL size, bytes. */
  sourceBytes: number
  sourceTriangles: number
  bytes: number
  triangles: number
  vertices: number
  /** sha256 of the staged file, hex. */
  sha256: string
  /** Vertex counts either side of `weld()` — the evidence the trap did not bite. */
  weld: { before: number; after: number } | null
  /** Surface-area loss as a fraction, and whether it cleared the fidelity bar. */
  fidelity: { areaError: number; bboxDelta: number; acceptable: boolean } | null
  /** `true` when the source was already inside the band and shipped undecimated. */
  passThrough: boolean
  /** `true` when the tile has no 3D path today because the STL gate refuses it. */
  aboveGate: boolean
}

/** The shape of every object in the store. G2's contract. */
export interface LodFormat {
  /**
   * How many levels of detail the store holds. **One.**
   *
   * G2 renders one `InstancedMesh` per design, and an `InstancedMesh` shares a
   * single geometry across its instances, so a distance-switched ladder is not
   * expressible through it. The band is adaptive per mesh instead — see
   * `mesh.ts`.
   */
  levels: 1
  path: string
  minTriangles: number
  maxTriangles: number
  keepFraction: number
  simplifyError: number
  maxAreaError: number
  maxBboxDelta: number
  weldRatioLimit: number
  /** Vertex attributes present. `POSITION` only — no `NORMAL`, deliberately. */
  attributes: string[]
  /**
   * Why there is no `NORMAL`, in the artefact the consumer reads.
   */
  shading: string
  indexed: boolean
  primitiveMode: 'TRIANGLES'
  material: 'none'
  compression: 'EXT_meshopt_compression' | 'none'
  extensionsRequired: string[]
  /**
   * Whether the mesh node carries a transform the consumer must apply.
   *
   * `'quantized'` means yes: meshopt compression quantizes `POSITION` to
   * normalized `int16` and moves the scale and offset onto the node. Reading
   * `mesh.geometry` and ignoring `node.matrixWorld` renders every tile at a
   * fraction of its size at the origin.
   */
  nodeTransform: 'quantized' | 'identity'
  decoder: { import: string; export: string; three: string; setter: string }
  units: string
  tool: string
  copyright: string
  versions: Record<string, string>
}

export interface LodManifest {
  tool: 'tools/lod'
  version: number
  generated: string
  /** The index this was derived from — the same stamp `catalog.json` carries. */
  catalog: CatalogFile['version']
  format: LodFormat
  bucket: { prefix: string; publicBase: string; cacheControl: string; contentType: string }
  /** Directory the objects are staged in, relative to the repository root. */
  staged: string
  totals: {
    objects: number
    bytes: number
    sourceBytes: number
    sourceTriangles: number
    triangles: number
    /** Objects for whose tiles no 3D path exists today. */
    aboveGate: number
    /** Objects that shipped without clearing the fidelity bar. */
    unfaithful: number
  }
  /** Shell commands, in order, for a human holding write credentials. */
  commands: string[]
  /** Things that must be true before or after the upload. */
  notes: string[]
  /** Every intended object, sorted by key. */
  entries: ManifestEntry[]
}

export interface ManifestInputs {
  catalog: CatalogFile
  prefix: string
  publicBase: string
  staged: string
  meshopt: boolean
  minTriangles?: number
  maxTriangles?: number
  entries: readonly Omit<ManifestEntry, 'sha256'>[]
  /** Contents keyed by object key, for the sha256 column. */
  contents: ReadonlyMap<string, Uint8Array>
  /** Overridable so a manifest can be byte-reproducible in a test. */
  generated?: string
}

export function buildLodManifest(inputs: ManifestInputs): LodManifest {
  const entries: ManifestEntry[] = inputs.entries
    .map((entry) => ({
      ...entry,
      sha256: sha256Hex(inputs.contents.get(entry.key)),
    }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))

  return {
    tool: 'tools/lod',
    version: MANIFEST_VERSION,
    generated: inputs.generated ?? timestamp(),
    catalog: inputs.catalog.version,
    format: lodFormat(inputs),
    bucket: {
      prefix: inputs.prefix,
      publicBase: inputs.publicBase,
      cacheControl: LOD_CACHE_CONTROL,
      contentType: LOD_CONTENT_TYPE,
    },
    staged: inputs.staged,
    totals: {
      objects: entries.length,
      bytes: sum(entries, (entry) => entry.bytes),
      sourceBytes: sum(entries, (entry) => entry.sourceBytes),
      sourceTriangles: sum(entries, (entry) => entry.sourceTriangles),
      triangles: sum(entries, (entry) => entry.triangles),
      aboveGate: entries.filter((entry) => entry.aboveGate).length,
      unfaithful: entries.filter((entry) => entry.fidelity !== null && !entry.fidelity.acceptable).length,
    },
    commands: uploadCommands(inputs.staged, inputs.prefix),
    notes: lodNotes(entries.length, inputs.meshopt),
    entries,
  }
}

/** The store's shape, as G2 must implement it. */
export function lodFormat(inputs: Pick<ManifestInputs, 'meshopt' | 'minTriangles' | 'maxTriangles' | 'prefix'>): LodFormat {
  const meshopt = inputs.meshopt
  return {
    levels: 1,
    path: `${inputs.prefix}/{md5[0:6]}/{md5}.glb`,
    minTriangles: inputs.minTriangles ?? MIN_TRIANGLES,
    maxTriangles: inputs.maxTriangles ?? MAX_TRIANGLES,
    keepFraction: KEEP_FRACTION,
    simplifyError: SIMPLIFY_ERROR,
    maxAreaError: MAX_AREA_ERROR,
    maxBboxDelta: MAX_BBOX_DELTA,
    weldRatioLimit: WELD_MIN_DROP,
    attributes: ['POSITION'],
    shading:
      'No NORMAL attribute. glTF requires a primitive without NORMAL to be rendered flat-shaded, ' +
      'and three 0.185.1 does exactly that (GLTFLoader sets material.flatShading = true when ' +
      'geometry.attributes.normal is undefined). src/three/material.ts already sets flatShading, ' +
      'so a supplied normal would be ignored; omitting it saves 44% of the file.',
    indexed: true,
    primitiveMode: 'TRIANGLES',
    material: 'none',
    compression: meshopt ? 'EXT_meshopt_compression' : 'none',
    extensionsRequired: meshopt ? ['EXT_meshopt_compression', 'KHR_mesh_quantization'] : [],
    nodeTransform: meshopt ? 'quantized' : 'identity',
    decoder: {
      import: MESHOPT_DECODER_IMPORT,
      export: 'MeshoptDecoder',
      three: VERIFIED_THREE_VERSION,
      setter: 'new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)',
    },
    units: 'millimetres, the source STL’s own units, unchanged',
    tool: TOOL,
    copyright: COPYRIGHT,
    versions: {
      '@gltf-transform/core': GLTF_TRANSFORM_VERSION,
      meshoptimizer: '1.2.0',
      three: VERIFIED_THREE_VERSION,
    },
  }
}

/**
 * The commands, with credentials and bucket name as environment variables
 * because this tool does not know either and must not guess them.
 *
 * `aws s3 sync` over R2's S3-compatible endpoint is the primary form: one
 * process, resumable, and it sets `Cache-Control` and `Content-Type` in the same
 * pass. `wrangler r2 object put` is one HTTP request per object and would be
 * 8,353 invocations, so it appears only as the single-object spot check.
 */
export function uploadCommands(staged: string, prefix: string): string[] {
  return [
    '# Credentials — an R2 API token scoped to Object Read & Write on this bucket only.',
    'export AWS_ACCESS_KEY_ID=…',
    'export AWS_SECRET_ACCESS_KEY=…',
    'export R2_ACCOUNT_ID=…',
    'export R2_BUCKET=…',
    '',
    '# Dry run first. Expect the object count in totals.objects and nothing else.',
    `aws s3 sync ${staged}/${prefix} "s3://$R2_BUCKET/${prefix}" \\`,
    '  --endpoint-url "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com" \\',
    '  --region auto --checksum-algorithm CRC32 \\',
    `  --content-type ${LOD_CONTENT_TYPE} --cache-control '${LOD_CACHE_CONTROL}' \\`,
    '  --size-only --dryrun',
    '',
    '# Then the real thing: drop --dryrun.',
    `aws s3 sync ${staged}/${prefix} "s3://$R2_BUCKET/${prefix}" \\`,
    '  --endpoint-url "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com" \\',
    '  --region auto --checksum-algorithm CRC32 \\',
    `  --content-type ${LOD_CONTENT_TYPE} --cache-control '${LOD_CACHE_CONTROL}' \\`,
    '  --size-only',
    '',
    '# Spot check one object through the public hostname, not the S3 endpoint.',
    '#   curl -sSI https://objects.openforge.tools/<key from entries[0].key>',
  ]
}

function lodNotes(objects: number, meshopt: boolean): string[] {
  const notes = [
    'v2-pr-series.md, non-PR blockers: B2, R2 write credentials for the /lod/ prefix, is OPEN. ' +
      'Nothing here has been uploaded.',
    'Zone admin, B1, same table: add the unconditional CORS rule on objects.openforge.tools FIRST, ' +
      'then the cache rule. In that order — a cache rule installed before CORS caches responses ' +
      'without the CORS headers, and the app then fails on cached 200s that look fine in curl.',
    `Expect ${String(objects)} objects. Compare against the distinct-md5 count in catalog.json ` +
      'before believing the store is complete.',
    'Objects are content-addressed on the source mesh md5, so the sync is safe to repeat and ' +
      '--size-only is sufficient; a re-exported mesh is a new key, never a rewritten one.',
    'CatalogAssets has no `lod` base yet, so the public URL above is derived from assets.models. ' +
      'Row X4 should add `lod` to CatalogAssets and pipeline/version.ts ASSET_BASES; tools/lod/catalog.ts ' +
      'then reads it instead of deriving it.',
    'DECIMATED MESHES ARE PREVIEW-ONLY. architecture-plan.md §8: the download path always serves the ' +
      'original STL. Shipping a decimated mesh to somebody’s printer would be a serious trust failure.',
    'Until the prefix is backfilled the app must treat a 404 on /lod/ as expected and fall back to the ' +
      'plan view, exactly as /thumbs/ falls back to the sprite sheet.',
  ]
  if (meshopt) {
    notes.push(
      'G2: the GLB is meshopt-compressed and position-quantized, so the mesh node carries a translation ' +
        'and a uniform scale. Apply node.matrixWorld (or bake it into the geometry before instancing) — ' +
        'reading mesh.geometry alone renders every tile at a fraction of its size at the origin. Measured ' +
        'with three 0.185.1 on the corpus’s largest mesh: geometry bounding box 2.000 x 0.251 x 1.813, ' +
        'matrixWorld scale 50.8132, world bounding box 101.626 x 12.741 x 92.123 mm.',
      `G2: call setMeshoptDecoder before loading. import { MeshoptDecoder } from '${MESHOPT_DECODER_IMPORT}' ` +
        `— verified present in three ${VERIFIED_THREE_VERSION}. That path is in examples/jsm, outside ` +
        'three’s semver guarantee, and postprocessing 6.39.4 pins three <0.186.0.',
    )
  }
  return notes
}

export function serialiseLodManifest(manifest: LodManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

function sum<T>(items: readonly T[], of: (item: T) => number): number {
  return items.reduce((total, item) => total + of(item), 0)
}

function sha256Hex(contents: Uint8Array | undefined): string {
  if (contents === undefined) return ''
  return createHash('sha256').update(contents).digest('hex')
}

/** `SOURCE_DATE_EPOCH`-aware, matching `pipeline/version.ts`'s `buildTimestamp`. */
function timestamp(): string {
  const pinned = process.env.SOURCE_DATE_EPOCH
  if (pinned !== undefined && /^\d+$/.test(pinned.trim())) {
    return new Date(Number(pinned.trim()) * 1000).toISOString()
  }
  return new Date().toISOString()
}
