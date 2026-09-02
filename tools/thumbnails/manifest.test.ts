/**
 * The handover artefact.
 *
 * This file is the only thing a human with R2 credentials will read, so it has
 * to be complete, stable and honest about the fact that nothing has been
 * uploaded. The count in `totals.objects` is what gets compared against the
 * index before anyone believes the backfill finished.
 */
import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  MANIFEST_VERSION,
  THUMB_CACHE_CONTROL,
  buildUploadManifest,
  encoderVersions,
  serialiseUploadManifest,
  uploadCommands,
} from './manifest'
import { blobOf, testCatalog } from './fixtures/catalog'

const BLOBS = ['0a', '1b', '2c'].map((seed) => blobOf(`${seed}${'0123456789abcdef'.repeat(2)}`))

const catalog = testCatalog({
  records: BLOBS.map((blob, i) => ({ id: `tiles/x/tile-${String(i)}.stl`, ord: i, blob })),
})

const files = BLOBS.map((blob, i) => ({
  key: `thumbs/${blob.slice(0, 6)}/${blob}.webp`,
  blob,
  bytes: 4000 + i,
  contents: Buffer.from(`thumb-${blob}`),
  tiles: 1,
}))

function manifest(): ReturnType<typeof buildUploadManifest> {
  return buildUploadManifest({
    catalog,
    prefix: 'thumbs',
    staged: 'tools/thumbnails/out',
    frame: 0,
    size: 256,
    quality: 80,
    tone: 'blue',
    files,
    generated: '2026-01-01T00:00:00.000Z',
  })
}

describe('buildUploadManifest', () => {
  it('lists every intended object exactly once', () => {
    const result = manifest()
    expect(result.entries).toHaveLength(files.length)
    expect(result.entries.map((entry) => entry.blob).sort()).toEqual([...BLOBS].sort())
    expect(result.totals.objects).toBe(files.length)
    expect(result.totals.bytes).toBe(files.reduce((total, file) => total + file.bytes, 0))
  })

  it('records the sha256 of the staged bytes, so the upload is checkable', () => {
    for (const entry of manifest().entries) {
      const file = files.find((candidate) => candidate.blob === entry.blob)
      expect(entry.sha256).toBe(createHash('sha256').update(file?.contents ?? Buffer.alloc(0)).digest('hex'))
    }
  })

  it('sorts entries by key, so two runs diff cleanly', () => {
    const keys = manifest().entries.map((entry) => entry.key)
    expect(keys).toEqual([...keys].sort())
  })

  it('serialises byte-identically for the same input', () => {
    expect(serialiseUploadManifest(manifest())).toBe(serialiseUploadManifest(manifest()))
  })

  it('stamps the index it derived from and how the derivative was made', () => {
    const result = manifest()
    expect(result.version).toBe(MANIFEST_VERSION)
    expect(result.catalog).toEqual(catalog.version)
    expect(result.thumb).toMatchObject({ frame: 0, size: 256, quality: 80, tone: 'blue' })
    expect(result.thumb.sheet).toEqual(catalog.sprite)
    expect(result.thumb.encoder.sharp).toBeTruthy()
  })

  it('carries the public base and an immutable cache policy', () => {
    const result = manifest()
    expect(result.bucket.publicBase).toBe(catalog.assets.thumbs)
    expect(result.bucket.prefix).toBe('thumbs')
    expect(result.bucket.cacheControl).toBe(THUMB_CACHE_CONTROL)
    expect(THUMB_CACHE_CONTROL).toMatch(/immutable/)
  })

  it('says out loud that nothing was uploaded and why', () => {
    const notes = manifest().notes.join('\n')
    expect(notes).toMatch(/R2 write credentials.*OPEN/)
    expect(notes).toMatch(/Nothing here has been uploaded/)
    expect(notes).toMatch(/CORS rule.*FIRST/)
    expect(notes).toMatch(/falls back to the sprite sheet/)
  })

  it('names the two commands that make the upload visible, in order', () => {
    // Row P3. The sync alone changes nothing a user can see: `CatalogRecord.thumb`
    // comes from a probe of the bucket and the index has to be rebuilt from it.
    // This note is where a human holding credentials is looking when the sync
    // finishes, so it is the only place worth putting the next two steps.
    const notes = manifest().notes.join('\n')
    const probe = notes.indexOf('npm run thumbs -- --inventory')
    const build = notes.indexOf('npm run import:catalog')
    expect(probe).toBeGreaterThan(-1)
    expect(build).toBeGreaterThan(probe)
  })

  it('emits commands that name the staged directory and the prefix', () => {
    const commands = uploadCommands('tools/thumbnails/out', 'thumbs').join('\n')
    expect(commands).toContain('tools/thumbnails/out/thumbs')
    expect(commands).toContain('s3://$R2_BUCKET/thumbs')
    expect(commands).toContain('r2.cloudflarestorage.com')
    expect(commands).toContain('--dryrun')
    expect(commands).toContain('image/webp')
    expect(commands).toContain(THUMB_CACHE_CONTROL)
    // No credentials, no bucket name, and no account id are invented.
    expect(commands).not.toMatch(/AKIA|openforge-[a-z]+-bucket/)
  })
})

describe('encoderVersions', () => {
  it('records libvips and libwebp, so a byte difference between runs is explicable', () => {
    const versions = encoderVersions()
    expect(versions.sharp).toMatch(/^\d+\.\d+\.\d+/)
    expect(versions.vips).toBeTruthy()
  })
})
