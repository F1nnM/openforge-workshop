/**
 * What would be uploaded, and the exact command to upload it.
 *
 * **This tool does not upload.** `v1-pr-series.md`'s non-PR blockers table lists
 * "R2 write credentials for the `/thumbs/` prefix" and "Cloudflare zone admin:
 * CORS unconditional **first**, then the cache rule" as open, and both gate this
 * row's execution rather than its code. So the run writes thumbnails locally and
 * emits this manifest: every intended object with its key, its byte count and
 * the sha256 of its contents, plus the commands a human with credentials runs.
 *
 * The sha256 per object is what makes the handover checkable. An uploader can
 * verify what landed against what was staged, and a rerun that produces
 * different bytes for the same md5 — a libvips upgrade, a changed quality
 * setting — is visible in the manifest diff instead of being discovered as a
 * cache inconsistency months later.
 *
 * The manifest is also the *inventory*: `entries.length` is the count a human
 * checks against `catalog.json`'s sprite-carrying record count before believing
 * the backfill is complete.
 */
import { createHash } from 'node:crypto'

import sharp from 'sharp'

import type { CatalogFile } from '../../src/catalog'

import type { Tone } from './render'

/** Version of this manifest's own shape. */
export const MANIFEST_VERSION = 1

export interface ManifestEntry {
  /** Object key relative to the bucket root: `thumbs/{md5[0:6]}/{md5}.webp`. */
  key: string
  /** The source sheet's md5, which is also the thumbnail's content address. */
  blob: string
  bytes: number
  /** sha256 of the staged file, hex. */
  sha256: string
  /** How many live catalog tiles display this thumbnail. */
  tiles: number
}

export interface UploadManifest {
  tool: string
  version: number
  generated: string
  /** Which index this was derived from — the same stamp `catalog.json` carries. */
  catalog: CatalogFile['version']
  /** How the derivative was produced, in enough detail to reproduce it. */
  thumb: {
    frame: number
    size: number
    quality: number
    tone: Tone
    sheet: CatalogFile['sprite']
    encoder: Record<string, string>
  }
  bucket: {
    /** Key prefix, from `assets.thumbs`. */
    prefix: string
    /** The public base the app builds URLs against. */
    publicBase: string
    /** Cache-Control the objects should be served with. */
    cacheControl: string
  }
  /** Directory the objects are staged in, relative to the repository root. */
  staged: string
  totals: { objects: number; bytes: number }
  /** Shell commands, in order, for a human holding write credentials. */
  commands: string[]
  /** Things that must be true before or after the upload. */
  notes: string[]
  /** Every intended object, sorted by key. */
  entries: ManifestEntry[]
}

/**
 * Recommended `Cache-Control` for a thumbnail.
 *
 * Immutable is correct and unusually easy to justify here: the object key
 * contains the source mesh's md5, so a changed mesh is a changed key. A year is
 * the longest value browsers honour meaningfully.
 */
export const THUMB_CACHE_CONTROL = 'public, max-age=31536000, immutable'

export interface ManifestInputs {
  catalog: CatalogFile
  prefix: string
  staged: string
  frame: number
  size: number
  quality: number
  tone: Tone
  files: readonly { key: string; blob: string; bytes: number; contents: Buffer; tiles: number }[]
  /** Overridable so a manifest can be byte-reproducible in a test. */
  generated?: string
}

export function buildUploadManifest(inputs: ManifestInputs): UploadManifest {
  const entries: ManifestEntry[] = inputs.files
    .map((file) => ({
      key: file.key,
      blob: file.blob,
      bytes: file.bytes,
      sha256: createHash('sha256').update(file.contents).digest('hex'),
      tiles: file.tiles,
    }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))

  return {
    tool: 'tools/thumbnails',
    version: MANIFEST_VERSION,
    generated: inputs.generated ?? timestamp(),
    catalog: inputs.catalog.version,
    thumb: {
      frame: inputs.frame,
      size: inputs.size,
      quality: inputs.quality,
      tone: inputs.tone,
      sheet: inputs.catalog.sprite,
      encoder: encoderVersions(),
    },
    bucket: {
      prefix: inputs.prefix,
      publicBase: inputs.catalog.assets.thumbs,
      cacheControl: THUMB_CACHE_CONTROL,
    },
    staged: inputs.staged,
    totals: {
      objects: entries.length,
      bytes: entries.reduce((total, entry) => total + entry.bytes, 0),
    },
    commands: uploadCommands(inputs.staged, inputs.prefix),
    notes: uploadNotes(entries.length),
    entries,
  }
}

/**
 * The commands, with credentials and bucket name as environment variables
 * because this tool does not know either and must not guess them.
 *
 * `aws s3 sync` over R2's S3-compatible endpoint is the primary form: one
 * process, resumable, and it sets `Cache-Control` and `Content-Type` in the same
 * pass. `wrangler r2 object put` is one HTTP request per object and would be
 * 8,702 invocations, so it appears only as the single-object spot check.
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
    `  --content-type image/webp --cache-control '${THUMB_CACHE_CONTROL}' \\`,
    '  --size-only --dryrun',
    '',
    '# Then the real thing: drop --dryrun.',
    `aws s3 sync ${staged}/${prefix} "s3://$R2_BUCKET/${prefix}" \\`,
    '  --endpoint-url "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com" \\',
    '  --region auto --checksum-algorithm CRC32 \\',
    `  --content-type image/webp --cache-control '${THUMB_CACHE_CONTROL}' \\`,
    '  --size-only',
    '',
    '# Spot check one object through the public hostname, not the S3 endpoint.',
    '#   curl -sSI https://objects.openforge.tools/<key from entries[0].key>',
  ]
}

function uploadNotes(objects: number): string[] {
  return [
    'v1-pr-series.md, non-PR blockers: R2 write credentials for the /thumbs/ prefix are OPEN. ' +
      'Nothing here has been uploaded.',
    'Zone admin, same table: add the unconditional CORS rule on objects.openforge.tools FIRST, ' +
      'then the cache rule. In that order — a cache rule installed before CORS caches responses ' +
      'without the CORS headers, and the app then fails on cached 200s that look fine in curl.',
    `Expect ${String(objects)} objects. Compare against the sprite-carrying record count in ` +
      'catalog.json before believing the backfill is complete.',
    'Objects are content-addressed on the source mesh md5, so the sync is safe to repeat and ' +
      '--size-only is sufficient; a changed mesh is a new key, never a rewritten one.',
    'Until the prefix is fully backfilled the app must treat a 404 on /thumbs/ as expected and ' +
      'fall back to the sprite sheet — see the PR description.',
  ]
}

/** libvips and libwebp versions, so a byte difference between runs is explicable. */
export function encoderVersions(): Record<string, string> {
  const versions = sharp.versions as unknown as Record<string, string | undefined>
  const picked: Record<string, string> = {}
  for (const key of ['sharp', 'vips', 'webp']) {
    const value = versions[key]
    if (value !== undefined) picked[key] = value
  }
  return picked
}

export function serialiseUploadManifest(manifest: UploadManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

/** `SOURCE_DATE_EPOCH`-aware, matching `pipeline/version.ts`'s `buildTimestamp`. */
function timestamp(): string {
  const pinned = process.env.SOURCE_DATE_EPOCH
  if (pinned !== undefined && /^\d+$/.test(pinned.trim())) {
    return new Date(Number(pinned.trim()) * 1000).toISOString()
  }
  return new Date().toISOString()
}
