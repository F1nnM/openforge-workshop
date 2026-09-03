/**
 * The work list and the object keys, taken from the emitted index.
 *
 * Same reasoning as `tools/thumbnails/catalog.ts`: `catalog.json` is the
 * authority on what exists, it is validated against the schema's cross-record
 * integrity checks before it is written, and it is what the app fetches. A
 * bucket listing would derive the work list from the side effects of a previous
 * scan.
 *
 * ## Targets are blobs, but the *consumer* is a design
 *
 * 8,702 live rows collapse to **8,353 distinct md5s** — 349 rows are the same
 * physical STL filed under two paths — so the work list is keyed on `blob`, and
 * the LOD object is content-addressed exactly like the sprite sheet and the
 * thumbnail. That is also what makes the store incremental: a re-exported mesh
 * is a new md5 under a new key, never a rewritten object.
 *
 * G2 renders **one `InstancedMesh` per design** and there are 3,822 designs, so
 * a target carries its design ids as well as its tile ids. `designs` is what a
 * reviewer checks the store's usefulness against; `tiles` is what checks its
 * completeness.
 *
 * ## `assets.lod` does not exist yet
 *
 * `CatalogAssets` is `{models, sprites, thumbs}` and `z.object` strips unknown
 * keys, so even if `pipeline/version.ts` grew a fourth base today this tool
 * could not read it. The base is therefore *derived* from `assets.models` by
 * swapping its last path segment — which is exactly the relationship the
 * architecture plan §8 states (`/lod/{md5[:6]}/{md5}.glb` beside `/models/`) —
 * and {@link LOD_PREFIX} is the one place the word `lod` appears. Row X4 should
 * add `lod` to `CatalogAssets` and `ASSET_BASES`. It has, so `lodBase` now reads
 * the field instead of inferring it by swapping the last segment of
 * `assets.models` — which is the same value, derived rather than declared. The
 * inference could not tell a deliberate move of the store from a typo.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { BlobId, CatalogFile } from '../../src/catalog'
import { CatalogFile as CatalogFileSchema, shardedPath } from '../../src/catalog'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Repository root — `tools/lod` is two levels down. */
export const REPO_ROOT = join(HERE, '..', '..')

/** The importer's output. `npm run import:catalog` writes it; it is gitignored. */
export const CATALOG_PATH = join(REPO_ROOT, 'public', 'catalog', 'catalog.json')

/** Where derived GLBs are staged before a human with R2 write credentials uploads them. */
export const DEFAULT_OUT_DIR = join(HERE, 'out')

/**
 * Where fetched STLs are cached, when caching is asked for.
 *
 * **Off by default**, unlike the sprite cache in `tools/thumbnails`. The sheets
 * are 4.5 GB in total and worth keeping; the meshes are **108.0 GB**, and a tool
 * that silently fills a developer's disk with a hundred gigabytes on its first
 * `--all` is a tool nobody runs twice.
 */
export const DEFAULT_CACHE_DIR = join(HERE, '.cache', 'models')

/** The bucket prefix the LOD store lives under. The only literal `lod` in the tool. */
export const LOD_PREFIX = 'lod'

/**
 * The STL size gate, mirrored from `src/three/gate.ts`.
 *
 * **This is a duplicated constant and that is a reported seam, not an
 * oversight.** `src/three/gate.ts` owns the number; `tsconfig.node.json` names
 * `src/three/stl/parse.ts` as a single file rather than the directory, so a
 * composite project cannot import anything else out of `src/three/` (TS6307),
 * and this row owns neither that tsconfig (W0) nor `src/three/**` (G3). Adding
 * `src/three/gate.ts` to the tool project's file list is a one-line change for
 * whichever of those rows moves next.
 *
 * The gate is why this tool exists: `stlGate` refuses 3D for anything above it,
 * so those tiles have **no 3D path at all** today, and the LOD store is the
 * first one they get. {@link aboveGate} counts them from the index rather than
 * trusting the plan's figure.
 */
export const STL_GATE_BYTES = 24 * 1024 * 1024

/**
 * Load and validate the index.
 *
 * Parsed, not cast — a shape change should fail here naming the offending path
 * rather than surface as 8,353 GLBs of the wrong thing.
 *
 * @throws with the path it looked in when the index has not been built.
 */
export function loadCatalog(path: string = CATALOG_PATH): CatalogFile {
  if (!existsSync(path)) {
    throw new Error(`no catalog index at ${path} — run \`npm run import:catalog\` first`)
  }
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  return CatalogFileSchema.parse(parsed)
}

/** One mesh to decimate, and everything that will render the result. */
export interface MeshTarget {
  blob: BlobId
  /** Lowest manifest ordinal among the tiles sharing this blob — the display order key. */
  ord: number
  /** Every catalog id sharing this blob, ordinal-sorted. */
  ids: string[]
  /** Every design id sharing this blob. G2 keys an `InstancedMesh` on these. */
  designs: string[]
  /** Texture root of the lowest-ordinal tile, for stratified sampling. */
  texture?: string
  /** STL size in bytes — the index's snapshot, and the sampling axis. */
  bytes: number
  /** `true` when `bytes` is over {@link STL_GATE_BYTES}: no 3D path exists today. */
  aboveGate: boolean
}

export interface TargetList {
  /** Blob-deduped, sorted by `ord` — the catalog's display order. */
  targets: MeshTarget[]
  /** Live records the targets were derived from. */
  records: number
  /** Rows collapsed by md5 dedupe. */
  deduped: number
  /** Distinct designs the targets cover. */
  designs: number
}

/** Every mesh the index names, deduped by md5, in display order. */
export function meshTargets(file: CatalogFile): TargetList {
  const byBlob = new Map<string, MeshTarget>()

  for (const record of [...file.records].sort((a, b) => a.ord - b.ord)) {
    const existing = byBlob.get(record.blob)
    if (existing) {
      existing.ids.push(record.id)
      if (!existing.designs.includes(record.design)) existing.designs.push(record.design)
      continue
    }
    byBlob.set(record.blob, {
      blob: record.blob,
      ord: record.ord,
      ids: [record.id],
      designs: [record.design],
      ...(record.texture === undefined ? {} : { texture: record.texture }),
      bytes: record.bytes,
      aboveGate: record.bytes > STL_GATE_BYTES,
    })
  }

  const targets = [...byBlob.values()].sort((a, b) => a.ord - b.ord)
  const designs = new Set<string>()
  for (const target of targets) for (const design of target.designs) designs.add(design)

  return {
    targets,
    records: file.records.length,
    deduped: file.records.length - targets.length,
    designs: designs.size,
  }
}

/** Live tiles the STL gate refuses, and their share of the corpus. */
export function aboveGate(file: CatalogFile, limit: number = STL_GATE_BYTES): {
  tiles: number
  blobs: number
  share: number
} {
  const refused = file.records.filter(
    (record) => !Number.isFinite(record.bytes) || record.bytes <= 0 || record.bytes > limit,
  )
  return {
    tiles: refused.length,
    blobs: new Set(refused.map((record) => record.blob)).size,
    share: file.records.length === 0 ? 0 : refused.length / file.records.length,
  }
}

/** The source mesh's URL — `{models}/{md5[0:6]}/{md5}.stl`. */
export function modelUrl(file: CatalogFile, blob: BlobId): string {
  return `${file.assets.models}/${shardedPath(blob)}.stl`
}

/**
 * The public base the LOD store is served from.
 *
 * Derived from `assets.models` rather than hardcoded, so the store cannot end up
 * on a different host from the meshes it is derived from.
 */
export function lodBase(file: CatalogFile): string {
  const declared = new URL(file.assets.lod)
  const models = new URL(file.assets.models)

  // The field is authoritative — but the inference this replaced carried a real
  // invariant for free, which reading a field does not: the store must sit beside
  // the meshes it is derived from, same origin and same parent path, differing
  // only in the final segment. Losing that would let a typo in one field send
  // every mesh URL to a host nobody uploaded to, and the symptom would be 8,353
  // absences reported as "the store has not been built yet".
  const parent = (url: URL): string => url.pathname.replace(/\/+$/, '').split('/').slice(0, -1).join('/')
  if (declared.origin !== models.origin || parent(declared) !== parent(models)) {
    throw new Error(
      `assets.lod (${file.assets.lod}) is not beside assets.models (${file.assets.models}): ` +
        'the LOD store must share the origin and parent path of the meshes it is derived from',
    )
  }
  if (declared.pathname.replace(/^\/+|\/+$/g, '') === '') {
    throw new Error(`assets.lod (${file.assets.lod}) has no path segment`)
  }
  return file.assets.lod.replace(/\/+$/, '')
}

/** The LOD object's public URL, once uploaded. */
export function lodUrl(file: CatalogFile, blob: BlobId): string {
  return `${lodBase(file)}/${shardedPath(blob)}.glb`
}

/** The R2 object key, relative to the bucket root: `lod/{md5[0:6]}/{md5}.glb`. */
export function lodKey(file: CatalogFile, blob: BlobId): string {
  return `${lodPrefix(file)}/${shardedPath(blob)}.glb`
}

/** The bucket prefix, from the derived base — so key and URL cannot drift apart. */
export function lodPrefix(file: CatalogFile): string {
  const prefix = new URL(lodBase(file)).pathname.replace(/^\/+|\/+$/g, '')
  if (prefix === '') throw new Error(`derived LOD base ${lodBase(file)} has no path segment to use as a key prefix`)
  return prefix
}

/** Where a GLB is staged locally: `{outDir}/{key}`, mirroring the bucket exactly. */
export function lodPath(file: CatalogFile, blob: BlobId, outDir: string): string {
  return join(outDir, lodKey(file, blob))
}
