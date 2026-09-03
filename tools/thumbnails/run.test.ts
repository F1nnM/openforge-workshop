/**
 * The whole run, against the real fixture sheet and an injected bucket.
 *
 * Four properties are proved here and nowhere else:
 *
 *   1. Output lands at `thumbs/{md5[0:6]}/{md5}.webp`, mirroring the bucket.
 *   2. A rerun does no work — the incremental claim, which is the difference
 *      between a scan costing minutes and costing 4.5 GB.
 *   3. A missing sheet is a recorded failure, not a lost run.
 *   4. The manifest lists every object that was staged, whether it was written
 *      this run or skipped from a previous one.
 */
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import type { CatalogFile } from '../../src/catalog'
import { BlobId } from '../../src/catalog'

import { spriteTargets, thumbKey } from './catalog'
import { blobOf, testCatalog } from './fixtures/catalog'
import { FIXTURE_SHEET, loadFixtureSheet } from './fixtures/sheet'
import { buildUploadManifest } from './manifest'
import { runThumbnails } from './run'
import { selectAll } from './sample'

const sheetBytes = loadFixtureSheet()

const BLOBS = ['a1', 'b2', 'c3'].map((seed) => blobOf(`${seed}${'0123456789abcdef'.repeat(2)}`))

/** Brand a test md5 rather than asserting the branded type away. */
const id = (blob: string): BlobId => BlobId.parse(blob)

/** An index whose sheets are the fixture's geometry, so the fixture is a valid sheet for it. */
function index(): CatalogFile {
  return testCatalog({
    sprite: FIXTURE_SHEET,
    records: BLOBS.map((blob, i) => ({
      id: `tiles/x/tile-${String(i)}.stl`,
      ord: i,
      blob,
      texture: `texture-${String(i)}`,
    })),
  })
}

/** A bucket that serves the fixture for every blob except the ones named 404. */
function bucket(missing: readonly string[] = []): typeof fetch {
  return (url) => {
    const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
    if (missing.some((blob) => href.includes(blob))) {
      return Promise.resolve(new Response('', { status: 404, statusText: 'Not Found' }))
    }
    return Promise.resolve(new Response(new Uint8Array(sheetBytes), { status: 200 }))
  }
}

function temp(): { out: string; cache: string } {
  const root = mkdtempSync(join(tmpdir(), 'openforge-run-'))
  return { out: join(root, 'out'), cache: join(root, 'cache') }
}

const nap = (): Promise<void> => Promise.resolve()

async function run(options: {
  catalog: CatalogFile
  out: string
  cache: string
  missing?: string[]
  force?: boolean
  size?: number
}): ReturnType<typeof runThumbnails> {
  return runThumbnails({
    catalog: options.catalog,
    picks: selectAll(spriteTargets(options.catalog).targets),
    outDir: options.out,
    cacheDir: options.cache,
    size: options.size ?? 64,
    ...(options.force === undefined ? {} : { force: options.force }),
    minIntervalMs: 0,
    fetch: { fetchImpl: bucket(options.missing ?? []), sleep: nap },
  })
}

describe('runThumbnails', () => {
  it('writes one WebP per sheet at the sharded path', async () => {
    const catalog = index()
    const { out, cache } = temp()
    const report = await run({ catalog, out, cache })

    expect(report.written).toBe(3)
    expect(report.skipped).toBe(0)
    expect(report.failed).toEqual([])
    expect(report.fetched).toBe(3)

    for (const blob of BLOBS) {
      const path = join(out, thumbKey(catalog, id(blob)))
      expect(existsSync(path)).toBe(true)
      expect(path).toContain(`/thumbs/${blob.slice(0, 6)}/${blob}.webp`)
      const meta = await sharp(readFileSync(path)).metadata()
      expect(meta.format).toBe('webp')
      expect(meta.width).toBe(64)
    }
  })

  it('measures every object it wrote', async () => {
    const catalog = index()
    const { out, cache } = temp()
    const report = await run({ catalog, out, cache })
    expect(report.stats).toHaveLength(3)
    for (const stat of report.stats) {
      expect(stat.sheetBytes).toBe(sheetBytes.byteLength)
      expect(stat.thumbBytes).toBeGreaterThan(0)
      expect(stat.thumbBytes).toBeLessThan(stat.sheetBytes)
    }
    expect(report.neutrality.opaque).toBeGreaterThan(0)
    expect(report.neutrality.share).toBeGreaterThan(0.9)
  })

  it('does nothing on a rerun, and leaves the bytes untouched', async () => {
    const catalog = index()
    const { out, cache } = temp()
    await run({ catalog, out, cache })

    const path = join(out, thumbKey(catalog, id(BLOBS[0] as string)))
    const before = readFileSync(path)
    const mtime = statSync(path).mtimeMs

    const again = await runThumbnails({
      catalog,
      picks: selectAll(spriteTargets(catalog).targets),
      outDir: out,
      cacheDir: cache,
      size: 64,
      minIntervalMs: 0,
      fetch: {
        fetchImpl: () => Promise.reject(new Error('a rerun must not touch the bucket')),
        sleep: nap,
      },
    })

    expect(again.written).toBe(0)
    expect(again.skipped).toBe(3)
    expect(again.failed).toEqual([])
    expect(Buffer.compare(readFileSync(path), before)).toBe(0)
    expect(statSync(path).mtimeMs).toBe(mtime)
    // Skipped objects still measure, because the sheet cache is still warm.
    expect(again.stats).toHaveLength(3)
  })

  it('re-encodes on --force, from the cache rather than the bucket', async () => {
    const catalog = index()
    const { out, cache } = temp()
    await run({ catalog, out, cache })
    const forced = await run({ catalog, out, cache, force: true, size: 32 })

    expect(forced.written).toBe(3)
    expect(forced.fromCache).toBe(3)
    expect(forced.fetched).toBe(0)
    const meta = await sharp(readFileSync(join(out, thumbKey(catalog, id(BLOBS[0] as string))))).metadata()
    expect(meta.width).toBe(32)
  })

  it('records a missing sheet and produces the rest', async () => {
    const catalog = index()
    const { out, cache } = temp()
    const missing = BLOBS[1] as string
    const report = await run({ catalog, out, cache, missing: [missing] })

    expect(report.written).toBe(2)
    expect(report.failed).toHaveLength(1)
    expect(report.failed[0]?.blob).toBe(missing)
    expect(report.failed[0]?.reason).toMatch(/HTTP 404/)
    expect(report.failed[0]?.key).toBe(thumbKey(catalog, id(missing)))
    expect(existsSync(join(out, thumbKey(catalog, id(missing))))).toBe(false)
    expect(report.files.map((file) => file.blob)).not.toContain(missing)
  })

  it('fails an object whose sheet does not match the declared geometry', async () => {
    // The index claims the real 512 px layout; the bucket serves the 640×256 fixture.
    const catalog = testCatalog({
      records: [{ id: 'tiles/x/one.stl', ord: 0, blob: BLOBS[0] as string }],
    })
    const { out, cache } = temp()
    const report = await run({ catalog, out, cache })
    expect(report.written).toBe(0)
    expect(report.failed[0]?.reason).toMatch(/sheet is 640×256, expected 2560×1024/)
  })

  it('stages nothing for the tile with no sprite', async () => {
    const catalog = testCatalog({
      sprite: FIXTURE_SHEET,
      records: [
        { id: 'tiles/x/has.stl', ord: 0, blob: BLOBS[0] as string },
        { id: 'tiles/x/has-not.stl', ord: 1, blob: BLOBS[1] as string, sprite: false },
      ],
    })
    const { out, cache } = temp()
    const report = await run({ catalog, out, cache })
    expect(report.attempted).toBe(1)
    expect(report.files).toHaveLength(1)
    expect(spriteTargets(catalog).withoutSprite).toEqual(['tiles/x/has-not.stl'])
  })

  it('hands the manifest every staged object, written or skipped', async () => {
    const catalog = index()
    const { out, cache } = temp()
    await run({ catalog, out, cache })
    const rerun = await run({ catalog, out, cache })

    const manifest = buildUploadManifest({
      catalog,
      prefix: 'thumbs',
      staged: 'tools/thumbnails/out',
      frame: rerun.frame,
      size: rerun.size,
      quality: rerun.quality,
      tone: rerun.tone,
      files: rerun.files,
      generated: '2026-01-01T00:00:00.000Z',
    })

    expect(manifest.entries.map((entry) => entry.blob).sort()).toEqual([...BLOBS].sort())
    expect(manifest.totals.objects).toBe(3)
    for (const entry of manifest.entries) {
      const staged = readFileSync(join(out, entry.key))
      expect(entry.bytes).toBe(staged.byteLength)
    }
  })

  it('reports the frame, size, quality and tone it actually used', async () => {
    const catalog = index()
    const { out, cache } = temp()
    const report = await run({ catalog, out, cache })
    expect(report.frame).toBe(FIXTURE_SHEET.defaultFrame)
    expect(report.size).toBe(64)
    expect(report.quality).toBe(80)
    // `neutral` since row P3: the app's `thumb` tint chain is calibrated against
    // the greyscale derivative, so that is what an unqualified run stages.
    expect(report.tone).toBe('neutral')
  })
})
