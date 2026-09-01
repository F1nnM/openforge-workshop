/// <reference types="node" />
/**
 * The spec grid against the real catalog — the coverage numbers, asserted.
 *
 * `labels.test.ts` proves each branch in isolation. This file proves the two
 * things that only the whole corpus can prove, and that a reviewer would
 * otherwise have to take on trust:
 *
 *   1. **The cascade never produces a blank or a guess.** All 8,702 live tiles
 *      get a footprint label and a height label, and every one of those labels
 *      is either a measurement or an explicit refusal.
 *   2. **The distribution the module documents is live.** Every percentage in
 *      `labels.ts`'s docblock is re-derived here, so a tag-vocabulary drift that
 *      quietly moved 400 tiles from a measurement to "not specified" fails the
 *      build instead of shipping.
 *
 * The corpus is the emitted `public/catalog/catalog.json` (`npm run
 * import:catalog`), matching the convention in `src/materials` and
 * `src/assembly`. When it is absent every block **skips loudly**.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { CatalogFile, CatalogRecord } from '@/catalog'
import { CatalogFile as CatalogFileSchema } from '@/catalog'

import { NO_FOOTPRINT, NO_HEIGHT, footprintLabel, heightLabel, storageAddress } from './labels'
import { spriteSheetUrl } from './spriteFrames'
import { familyVariants } from './variants'

const CATALOG_PATH =
  process.env.OPENFORGE_CATALOG ?? join(process.cwd(), 'public', 'catalog', 'catalog.json')

function loadCatalog(): CatalogFile | undefined {
  if (!existsSync(CATALOG_PATH)) return undefined
  return CatalogFileSchema.parse(JSON.parse(readFileSync(CATALOG_PATH, 'utf8')) as unknown)
}

const loaded = loadCatalog()

if (loaded === undefined) {
  process.stderr.write(
    [
      '',
      '='.repeat(72),
      '  screens/detail/corpus.test: SKIPPED — no emitted catalog index.',
      `  Looked for: ${CATALOG_PATH}`,
      '  Build one with:  npm run import:catalog',
      '  Or point at one: OPENFORGE_CATALOG=/path/to/catalog.json',
      '='.repeat(72),
      '',
    ].join('\n'),
  )
}

const describeCorpus = loaded === undefined ? describe.skip : describe

// Safe: every block below is skipped when the index is absent.
const records: readonly CatalogRecord[] = loaded?.records ?? []
const tagTable: readonly string[] = loaded?.tags ?? []

const tagsOf = (record: CatalogRecord): string[] => record.tags.map((id) => tagTable[id] ?? '')

function tally<T extends string>(values: readonly T[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1
  return counts
}

const footprints = records.map((record) => footprintLabel(record, tagsOf(record)))
const heights = records.map((record) => heightLabel(tagsOf(record)))

describeCorpus('footprint cascade over the live corpus', () => {
  it('covers every tile, with the documented tier distribution', () => {
    expect(records).toHaveLength(8702)
    expect(tally(footprints.map((value) => value.basis))).toEqual({
      rect: 3051,
      wall: 3116,
      arc: 1391,
      'size-code': 223,
      'shape-word': 709,
      unspecified: 212,
    })
  })

  it('is a printable dimension for 86.9% of the corpus', () => {
    const dimensioned = footprints.filter(
      (value) => value.basis === 'rect' || value.basis === 'wall' || value.basis === 'arc',
    ).length
    expect(dimensioned / records.length).toBeCloseTo(0.869, 3)
    // The contract's own figure: a `W × D` alone reaches only a third.
    const rects = footprints.filter((value) => value.basis === 'rect').length
    expect(rects / records.length).toBeCloseTo(0.351, 3)
  })

  it('never renders a blank, and refuses explicitly where it must', () => {
    for (const value of footprints) {
      expect(value.text.trim()).not.toBe('')
      expect(value.note.trim()).not.toBe('')
      if (value.basis === 'unspecified') expect(value.text).toBe(NO_FOOTPRINT)
      else expect(value.text).not.toBe(NO_FOOTPRINT)
    }
  })
})

describeCorpus('height lookup over the live corpus', () => {
  it('has a qualitative basis for 21.0% of tiles and says so for the rest', () => {
    expect(tally(heights.map((value) => value.basis))).toEqual({
      qualitative: 1494,
      profile: 337,
      none: 6871,
    })
    const known = 1494 + 337
    expect(known / records.length).toBeCloseTo(0.21, 3)
  })

  it('prints a number nowhere — the catalog holds no bounding box', () => {
    for (const value of heights) {
      if (value.basis === 'none') {
        expect(value.text).toBe(NO_HEIGHT)
        continue
      }
      // Every non-fallback height is words from the tag tree, never digits.
      expect(value.text).toMatch(/^[A-Za-z]+( \/ [A-Za-z]+)*$/)
    }
  })
})

describeCorpus('the derived URLs', () => {
  it('are HTTPS under the sharded path, for every record', () => {
    const assets = loaded?.assets
    if (assets === undefined) throw new Error('unreachable: guarded by describeCorpus')

    for (const record of records) {
      const address = storageAddress(assets, record)
      expect(new URL(address).protocol).toBe('https:')
      expect(address).toBe(
        `${assets.models}/${record.blob.slice(0, 6)}/${record.blob}.stl`,
      )
      if (record.sprite) {
        expect(spriteSheetUrl(assets, record.blob)).toBe(
          `${assets.sprites}/${record.blob.slice(0, 6)}/${record.blob}.png`,
        )
      }
    }
  })

  it('confirms exactly one live tile has no sprite sheet', () => {
    expect(records.filter((record) => !record.sprite)).toHaveLength(1)
  })
})

describeCorpus('family variants over the live corpus', () => {
  it('never offers a tile its own size, and stays a short list', () => {
    const catalog = loaded
    if (catalog === undefined) throw new Error('unreachable: guarded by describeCorpus')

    // One record per family is enough to exercise every family exactly once,
    // and keeps this a 1,130-scan rather than an 8,702-scan of 8,702.
    const seen = new Set<string>()
    let widest = 0
    for (const record of catalog.records) {
      if (seen.has(record.family)) continue
      seen.add(record.family)

      const own = footprintLabel(record, tagsOf(record)).text
      const variants = familyVariants(catalog, record)
      const labels = variants.map((variant) => variant.label)

      expect(labels).not.toContain(own)
      expect(new Set(labels).size).toBe(labels.length)
      widest = Math.max(widest, labels.length)
    }

    expect(seen.size).toBe(1130)
    // 24 distinct footprints is the widest family in the corpus (the shingled
    // roofs); one less than that, since the subject's own size is dropped.
    expect(widest).toBe(23)
  })
})
