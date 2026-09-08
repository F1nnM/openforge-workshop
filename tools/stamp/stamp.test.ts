/**
 * The readers, the manifest-version cross-checks, the share regeneration, and
 * the whole step against the real corpus.
 *
 * The cross-checks matter more than they look. `artefacts.ts` declares which
 * manifest shapes it understands as three integers rather than importing the
 * owning tools' constants, because `tools/thumbnails/manifest.ts` imports
 * `sharp` — a native module — and a gate that compares hashes should not be able
 * to die on a libvips load. The declaration is only safe if something compares
 * it to the real thing, so this file does, in the one place where importing
 * `sharp` costs nothing.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { CatalogFile, ManifestOrdinal } from '../../src/catalog'
import { emptyManifest, fixturesDir, readThumbInventory, thumbBlobs } from '../../pipeline'
import { MANIFEST_VERSION as LOD_MANIFEST_VERSION } from '../lod/manifest'
import { MEASURE_SIDECAR_VERSION } from '../measure/sidecar'
import { blobOf, testCatalog } from '../measure/fixtures/catalog'
import { MANIFEST_VERSION as THUMB_MANIFEST_VERSION } from '../thumbnails/manifest'

import { parseArgs } from './args'
import {
  ARTEFACT_PATHS,
  SUPPORTED_MANIFEST_VERSIONS,
  UPLOAD_MANIFEST_NAME,
  readMeasureSidecar,
  readUploadManifest,
  stampDifference,
  stampOf,
} from './artefacts'
import { corpusDigest } from './corpus'
import { runStamp, shareReport } from './run'

const FIXTURES_DIR = fixturesDir()
const hasFixtures = existsSync(FIXTURES_DIR) && readdirSync(FIXTURES_DIR).some((name) => name.endsWith('.json'))

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'openforge-stamp-'))
}

const STAMP = { schema: 3, pipeline: 1, fixtures: 'abcdef0123456789', manifest: 1 }

describe('the manifest versions this module claims to understand', () => {
  it('are the ones the owning tools export', () => {
    // Fails the day any of the three tools reshapes its manifest and bumps its
    // version — which is exactly when reading it under the old assumptions would
    // report a stale artefact as clean. Both sides are imported; neither is a
    // literal in this assertion.
    expect(SUPPORTED_MANIFEST_VERSIONS).toEqual({
      sidecar: MEASURE_SIDECAR_VERSION,
      thumbs: THUMB_MANIFEST_VERSION,
      lod: LOD_MANIFEST_VERSION,
    })
  })

  it('point at the paths the owning tools default to', () => {
    expect(ARTEFACT_PATHS.thumbs.endsWith(join('thumbnails', 'out', UPLOAD_MANIFEST_NAME))).toBe(true)
    expect(ARTEFACT_PATHS.lod.endsWith(join('lod', 'out', UPLOAD_MANIFEST_NAME))).toBe(true)
    expect(ARTEFACT_PATHS.sidecar.endsWith(join('measure', 'measurements.json'))).toBe(true)
  })
})

describe('the readers', () => {
  it('returns undefined for an artefact that was never staged', () => {
    expect(readUploadManifest('lod', join(tempDir(), 'nothing.json'))).toBeUndefined()
    expect(readMeasureSidecar(join(tempDir(), 'nothing.json'))).toBeUndefined()
  })

  it('refuses a manifest whose own version it does not understand', () => {
    const path = join(tempDir(), UPLOAD_MANIFEST_NAME)
    writeFileSync(
      path,
      JSON.stringify({ version: THUMB_MANIFEST_VERSION + 1, catalog: STAMP, entries: [{ blob: 'a'.repeat(32) }] }),
    )
    // Fails if the reader parses optimistically — the failure mode being that a
    // reshaped manifest is read as having no entries and reported as clean.
    expect(() => readUploadManifest('thumbs', path)).toThrow(/understands 1/)
  })

  it('counts only measured entries as coverage', () => {
    // A `failed` entry records an attempt and carries no dimension, so counting
    // it would report an unreadable mesh as done. Fails if the filter is dropped.
    const path = join(tempDir(), 'measurements.json')
    writeFileSync(
      path,
      JSON.stringify({
        version: MEASURE_SIDECAR_VERSION,
        catalog: STAMP,
        coverage: { blobs: 2, pending: 1 },
        measurements: {
          ['a'.repeat(32)]: { status: 'measured' },
          ['b'.repeat(32)]: { status: 'failed' },
        },
      }),
    )
    const read = readMeasureSidecar(path)
    expect(read?.blobs).toEqual(['a'.repeat(32)])
    expect(read?.pending).toBe(1)
  })

  it('drops `built` from a stamp comparison, and nothing else', () => {
    // Two artefacts derived from the same index minutes apart carry different
    // clock readings. Fails if `built` is compared, which would report every
    // artefact as drifted forever.
    const version = { ...STAMP, built: '2026-01-01T00:00:00.000Z' }
    expect(stampDifference(stampOf(version), stampOf({ ...version, built: '2026-06-06T00:00:00.000Z' }))).toEqual([])
    expect(stampDifference(stampOf(version), stampOf({ ...version, schema: 1 }))).toEqual(['schema 3 to 1'])
  })
})

describe('parseArgs', () => {
  it('requires every --require value to be an artefact id', () => {
    expect(() => parseArgs(['--require', 'thumbnails'])).toThrow(/unknown artefact thumbnails/)
    expect(parseArgs(['--require', 'thumbs,lod'])).toMatchObject({ require: ['thumbs', 'lod'] })
  })

  it('refuses an unknown flag rather than ignoring it', () => {
    expect(() => parseArgs(['--regenerate'])).toThrow(/unknown option/)
  })

  it('defaults to writing the stamp next to the index', () => {
    expect(parseArgs([])).toMatchObject({ dryRun: false, stamp: 'public/catalog/stamp.json' })
  })
})

/* ------------------------------------------------------ the share manifest */

function fixture(): CatalogFile {
  return testCatalog([
    { id: 'tiles/test/a.stl', ord: 1, blob: blobOf('aa') },
    { id: 'tiles/test/b.stl', ord: 2, blob: blobOf('bb') },
    { id: 'tiles/test/c.stl', ord: 3, blob: blobOf('cc') },
  ])
}

describe('shareReport', () => {
  const manifest = { manifest: 1, ids: ['tiles/test/x.stl', 'tiles/test/a.stl', 'tiles/test/b.stl', 'tiles/test/c.stl'] }

  it('round-trips every record and reports the reserved slots', () => {
    const report = shareReport(fixture(), manifest, { added: [], retired: ['tiles/test/x.stl'] })
    expect(report).toMatchObject({ roundTrip: 3, live: 3, reserved: 4, retired: 1, violations: [] })
  })

  it('fails when two records share an ordinal', () => {
    // Constructed after the parse, because `CatalogFile`'s superRefine rejects a
    // duplicate ordinal — which is the point: this asserts the *second* line of
    // defence, over the mapping every share link is written against.
    const file = fixture()
    const collided: CatalogFile = {
      ...file,
      records: [file.records[0]!, { ...file.records[1]!, ord: file.records[0]!.ord }, file.records[2]!],
    }
    const report = shareReport(collided, manifest, { added: [], retired: [] })
    expect(report.roundTrip).toBe(2)
    // "item", not "tile": since row V4 a link's ordinal names a design's
    // address, so drift makes it decode to a different *item*.
    expect(report.violations.join('\n')).toContain('decodes to a different item')
  })

  it('fails when the published manifest version and the ordinal file disagree', () => {
    const report = shareReport(fixture(), { ...manifest, manifest: 2 }, { added: [], retired: [] })
    expect(report.violations.join('\n')).toContain('invalidates every link in circulation')
  })

  it('fails when this build issued an ordinal nobody committed', () => {
    const report = shareReport(fixture(), manifest, { added: ['tiles/test/d.stl'], retired: [] })
    expect(report.violations.join('\n')).toContain('npm run import:catalog')
  })

  it('moves the pairs digest when an ordinal is reassigned', () => {
    // The §13 failure: a renumbering that nobody announced. Fails if the digest
    // is taken over ids or ordinals alone rather than the pairs.
    const file = fixture()
    const renumbered: CatalogFile = {
      ...file,
      records: [{ ...file.records[0]!, ord: 9 as ManifestOrdinal }, ...file.records.slice(1)],
    }
    const before = shareReport(file, manifest, { added: [], retired: [] })
    const after = shareReport(renumbered, manifest, { added: [], retired: [] })
    expect(after.pairs).not.toBe(before.pairs)
  })

  it('is unmoved by a record order that carries the same pairs', () => {
    const file = fixture()
    const reordered: CatalogFile = { ...file, records: [...file.records].reverse() }
    expect(shareReport(reordered, manifest, { added: [], retired: [] }).pairs).toBe(
      shareReport(file, manifest, { added: [], retired: [] }).pairs,
    )
  })

  it('reports an empty manifest as reserving nothing', () => {
    expect(shareReport(fixture(), emptyManifest(), { added: [], retired: [] }).reserved).toBe(0)
  })
})

/* ------------------------------------------------------- the whole step */

const title = hasFixtures ? 'the step, over the real corpus' : `SKIPPED — no fixtures at ${FIXTURES_DIR}`
const describeCorpus = hasFixtures ? describe : describe.skip

describeCorpus(title, () => {
  const run = runStamp({ write: false, builtAt: '2026-01-01T00:00:00.000Z' })

  it('passes the gate on this tree', () => {
    expect(run.report.failures).toEqual([])
  })

  it('emits the thumb flag from the committed inventory, because this is the index CI ships', () => {
    // `npm run stamp` is what `deploy.yml` and `pr-preview.yml` run, and it
    // *overwrites* `public/catalog/catalog.json`. So if this build does not join
    // the inventory, `thumb` is false in every deployed index no matter what
    // `npm run import:catalog` wrote a moment earlier — the backfill lands in the
    // bucket and the grid keeps cropping sprite sheets, with nothing failing.
    //
    // The lock's build stays thumbless on purpose (`lock.ts`: "a backfill is not
    // a derivation"). This one is the artefact, not the digest.
    const present = thumbBlobs(readThumbInventory())
    const withThumb = run.file.records.filter((record) => record.thumb)
    expect(present.size).toBeGreaterThan(0)
    expect(withThumb.length).toBeGreaterThan(0)
    for (const record of run.file.records) {
      expect(record.thumb, record.blob).toBe(present.has(record.blob))
    }
  })

  it('finds the sidecar restamped and materially complete, not stale', () => {
    // The measured fact this row's severity policy rests on: W4 and W5 both
    // reshaped the record after W1 measured, so the committed sidecar carries an
    // older schema — and every md5 in it still resolves. Fails if either half
    // stops being true, which is exactly when a reviewer should look.
    const sidecar = run.report.artefacts.find((artefact) => artefact.id === 'sidecar')
    expect(sidecar?.status).toBe('restamped')
    expect(sidecar?.stampDrift.length).toBeGreaterThan(0)
    expect(sidecar?.drift).toMatchObject({ missing: [], orphaned: [], stale: [] })
  })

  it('regenerates the share manifest and round-trips every record', () => {
    expect(run.report.share.roundTrip).toBe(run.report.records)
    expect(run.report.share.violations).toEqual([])
  })

  it('names every md5 the index carries, deduped', () => {
    // Derived on both sides rather than asserted as 8,353: the digest is
    // recomputed here from the file the run returned.
    expect(run.report.corpus).toEqual(corpusDigest(run.file.records.map((record) => record.blob)))
    expect(run.report.corpus.blobs).toBeLessThan(run.report.records)
  })

  it('promotes an advisory artefact when --require names it', () => {
    // What X1 and X6 do here once B1 and B2 clear. The LOD store is not staged
    // in this checkout, so requiring it must fail — if it does not, the flag is
    // decoration.
    const required = runStamp({ write: false, require: ['lod'], builtAt: '2026-01-01T00:00:00.000Z' })
    expect(required.report.failures.join('\n')).toContain('LOD store')
    expect(required.report.artefacts.find((artefact) => artefact.id === 'lod')?.required).toBe(true)
  })
}, 600_000)
