/**
 * The work list, taken from the emitted index rather than from the bucket.
 *
 * **Why not list the bucket.** `catalog.json` is the authority on what exists:
 * it is the artefact the app fetches, it is validated against the schema's
 * cross-record integrity checks before it is written, and it carries the one
 * field a bucket listing cannot — `sprite`, which says whether a sheet exists
 * at all. Listing R2 instead would derive the work list from the side effects of
 * a previous scan and would happily generate thumbnails for objects no live tile
 * references. So the index is read, parsed as a `CatalogFile`, and the targets
 * come out of it.
 *
 * **The degenerate tile is in the data, not in a special case.** 8,701 of the
 * 8,702 live tiles carry exactly one sprite sheet;
 * `tiles/aztlan/separate_walls/primary_walls/column/dragonlock/aztlan#column.col+T.side+dragonlock.stl`
 * carries none. `spriteTargets` returns it separately rather than filtering it
 * away silently, so the run can report it and the frontend's missing-thumbnail
 * fallback has a known test case.
 *
 * **Targets are blobs, not tiles.** 171 md5 values are shared by 520 catalog
 * rows — the same physical STL filed under two paths — and the sprite sheet is
 * addressed by md5. Keying the work list on `id` would fetch and encode those
 * sheets twice and write the same output file twice.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { BlobId, CatalogFile } from '../../src/catalog'
import { CatalogFile as CatalogFileSchema, MEASURED_THUMB, shardedPath } from '../../src/catalog'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Repository root — `tools/thumbnails` is two levels down. */
export const REPO_ROOT = join(HERE, '..', '..')

/** The importer's output. `npm run import:catalog` writes it; it is gitignored. */
export const CATALOG_PATH = join(REPO_ROOT, 'public', 'catalog', 'catalog.json')

/** Where derived thumbnails are staged before a human uploads them. */
export const DEFAULT_OUT_DIR = join(HERE, 'out')

/** Where fetched sheets are cached between runs. */
export const DEFAULT_CACHE_DIR = join(HERE, '.cache', 'sheets')

/**
 * Load and validate the index.
 *
 * Parsed, not cast. This tool derives 8,702 objects from it and a shape change
 * should fail here with the offending path rather than surface as a crop of the
 * wrong rectangle.
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

/** One sheet to derive a thumbnail from, and every tile that will display it. */
export interface SheetTarget {
  blob: BlobId
  /** Lowest manifest ordinal among the tiles sharing this blob — the display order key. */
  ord: number
  /** Every catalog id sharing this blob, ordinal-sorted. */
  ids: string[]
  /** Texture root of the lowest-ordinal tile, for stratified sampling. */
  texture?: string
  /** STL size in bytes of the lowest-ordinal tile — a proxy for render complexity. */
  bytes: number
}

export interface TargetList {
  /** Blob-deduped, sorted by `ord` — which is the catalog's display order. */
  targets: SheetTarget[]
  /** Live tile ids with `sprite: false`. Exactly one, today. */
  withoutSprite: string[]
  /** Live records the targets were derived from. */
  records: number
  /** Rows collapsed by md5 dedupe (`records` minus `targets.length`, ignoring the spriteless). */
  deduped: number
}

/** Every sheet the index says exists, deduped by md5 and in display order. */
export function spriteTargets(file: CatalogFile): TargetList {
  const byBlob = new Map<string, SheetTarget>()
  const withoutSprite: string[] = []

  for (const record of [...file.records].sort((a, b) => a.ord - b.ord)) {
    if (!record.sprite) {
      withoutSprite.push(record.id)
      continue
    }
    const existing = byBlob.get(record.blob)
    if (existing) {
      existing.ids.push(record.id)
      continue
    }
    byBlob.set(record.blob, {
      blob: record.blob,
      ord: record.ord,
      ids: [record.id],
      ...(record.texture === undefined ? {} : { texture: record.texture }),
      bytes: record.bytes,
    })
  }

  const targets = [...byBlob.values()].sort((a, b) => a.ord - b.ord)
  return {
    targets,
    withoutSprite,
    records: file.records.length,
    deduped: file.records.length - withoutSprite.length - targets.length,
  }
}

/** The sprite sheet's URL — `{sprites}/{md5[0:6]}/{md5}.png`, verified across all 8,701. */
export function spriteUrl(file: CatalogFile, blob: BlobId): string {
  return `${file.assets.sprites}/${shardedPath(blob)}.png`
}

/** The thumbnail's public URL, once uploaded. */
export function thumbUrl(file: CatalogFile, blob: BlobId): string {
  return `${file.assets.thumbs}/${shardedPath(blob)}${MEASURED_THUMB.extension}`
}

/**
 * The R2 object key, relative to the bucket root: `thumbs/{md5[0:6]}/{md5}.webp`.
 *
 * Derived from `assets.thumbs`'s last path segment rather than hardcoded, so the
 * key and the URL the app builds cannot drift apart.
 */
export function thumbKey(file: CatalogFile, blob: BlobId): string {
  return `${thumbPrefix(file)}/${shardedPath(blob)}${MEASURED_THUMB.extension}`
}

/** The bucket prefix the thumbnails live under — `thumbs`, from `assets.thumbs`. */
export function thumbPrefix(file: CatalogFile): string {
  const prefix = new URL(file.assets.thumbs).pathname.replace(/^\/+|\/+$/g, '')
  if (prefix === '') {
    throw new Error(`assets.thumbs (${file.assets.thumbs}) has no path segment to use as a key prefix`)
  }
  return prefix
}

/** Where a thumbnail is staged locally: `{outDir}/{key}`, mirroring the bucket exactly. */
export function thumbPath(file: CatalogFile, blob: BlobId, outDir: string): string {
  return join(outDir, thumbKey(file, blob))
}
