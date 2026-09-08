/**
 * The thumbnail inventory reader, and the committed inventory itself.
 *
 * Two kinds of case here. The first is the reader's refusals: an inventory that
 * does not parse, that declares a version this pipeline does not understand, or
 * that records a probe failure must all **throw**, because every one of them
 * would otherwise emit `thumb: false` on records whose objects exist — and a
 * false negative is indistinguishable from an un-backfilled bucket, which is a
 * state this app was in for years and which looked entirely correct throughout.
 * Now that the backfill has run, those refusals are what stop it silently
 * reverting to that appearance.
 *
 * The second is the file on disk. It is checked in, it is the only input to
 * `CatalogRecord.thumb`, and it is the artefact a reviewer of this row is being
 * asked to trust, so the shape of it is asserted rather than assumed.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { THUMB_INVENTORY_PATH, THUMB_INVENTORY_VERSION, readThumbInventory, thumbBlobs } from './thumbs'

const MD5 = '0'.repeat(31)

const sample = {
  note: 'test',
  version: THUMB_INVENTORY_VERSION,
  probed: '2026-01-01T00:00:00.000Z',
  base: 'https://objects.example.test/thumbs',
  extension: '.webp',
  counted: { probed: 2, present: 1, absent: 1, failed: 0 },
  present: [`${MD5}1`],
}

function written(body: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'of-thumbs-'))
  const path = join(dir, 'inventory.json')
  writeFileSync(path, JSON.stringify(body))
  return path
}

describe('readThumbInventory', () => {
  it('reads a probe result', () => {
    const inventory = readThumbInventory(written(sample))
    expect(inventory?.counted).toEqual({ probed: 2, present: 1, absent: 1, failed: 0 })
    expect(inventory?.present).toEqual([`${MD5}1`])
  })

  it('treats an absent file as "no thumbnails", because a fresh clone has never probed', () => {
    // `undefined` rather than an empty inventory, so the importer can report the
    // difference between "nobody has asked" and "asked, and there are none".
    expect(readThumbInventory(join(tmpdir(), 'of-thumbs-nothing-here', 'inventory.json'))).toBeUndefined()
  })

  it('refuses a version it does not understand rather than reading it optimistically', () => {
    expect(() => readThumbInventory(written({ ...sample, version: THUMB_INVENTORY_VERSION + 1 }))).toThrow(
      /understands/,
    )
  })

  it('refuses an inventory with probe failures, because absent and unanswered are not the same', () => {
    // The reason this is fatal and not a warning: a 503 on 40 objects would
    // silently take 40 working thumbnails out of the grid, and the grid would
    // look exactly like the 8,312 that genuinely have none.
    expect(() =>
      readThumbInventory(written({ ...sample, counted: { probed: 3, present: 1, absent: 1, failed: 1 } })),
    ).toThrow(/probe failures/)
  })

  it('refuses a malformed md5 rather than emitting a flag keyed on nonsense', () => {
    expect(() => readThumbInventory(written({ ...sample, present: ['not-an-md5'] }))).toThrow()
  })
})

describe('thumbBlobs', () => {
  it('is the set the build looks records up in', () => {
    const set = thumbBlobs(readThumbInventory(written(sample)))
    expect(set.has(`${MD5}1`)).toBe(true)
    expect(set.has(`${MD5}2`)).toBe(false)
  })

  it('is empty for an absent inventory, which is what makes a forgotten caller safe', () => {
    expect(thumbBlobs(undefined).size).toBe(0)
  })
})

describe('the committed inventory', () => {
  const inventory = readThumbInventory()

  it('exists, because the build reads it on every import', () => {
    expect(inventory).toBeDefined()
  })

  it('records a complete probe of the live bucket, with every object found', () => {
    // Measured 2026-09-08, after the backfill: every one of the 8,352 distinct
    // sprite-carrying md5s HEADed through the public hostname, 407.8 s. All 200.
    //
    // The previous reading here was the mirror of this one — 0 present, 8,352
    // absent, probed 2026-09-02 — because B2 had blocked the upload against a
    // bucket this project could not write to. It now writes its own, so the
    // 8,352 objects exist and `withThumb` is 8,701 of 8,702 records in the
    // import's report: one record carries no sprite sheet to derive from, and
    // 349 md5s are shared by more than one record.
    expect(inventory?.counted).toEqual({ probed: 8352, present: 8352, absent: 0, failed: 0 })
    expect(inventory?.present).toHaveLength(8352)
  })

  it('names the base and extension it probed, so a moved bucket is visible', () => {
    // An inventory taken against a different `assets.thumbs` is not evidence
    // about this one. Recorded rather than checked against `ASSET_BASES` here,
    // because the pipeline importing its own config into this assertion would
    // make the two agree by construction and prove nothing.
    //
    // The bucket did move — this literal is the proof that the probe followed it
    // rather than that the two were wired to agree. `pipeline/headers.test.ts`
    // takes the opposite approach for the CSP, and deliberately: there two files
    // that share no import must agree, so deriving one from the other is the
    // whole check. Here the file records an event, so it is pinned.
    expect(inventory?.base).toBe('https://bucket-openforge-workshop.mfinn.de/thumbs')
    expect(inventory?.extension).toBe('.webp')
  })

  it('lives beside the ordinal manifest, the other checked-in build input', () => {
    expect(THUMB_INVENTORY_PATH).toMatch(/pipeline\/thumbs\/inventory\.json$/)
  })
})
