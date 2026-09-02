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
    // Row W3 moved 403 tiles into tier 1: `rect` went 3,051 → 3,454, and the
    // fallback tiers gave up exactly those 403, including the 62 `IL+corner`
    // cells that were labelled by their code because a `concave`/`convex`
    // *corner sense* was read as a curve.
    //
    // Row W4 added tiers 4 to 6, and every tile that reaches one of them arrives
    // from a *worse* tier rather than a better one:
    //
    //   `size-code` 161 → 42    the 119 columns now state their measured
    //                           0.5 × 0.5 instead of printing "OpenLOCK L".
    //                           The 42 left are the codes W4 refuses — 28 `U`
    //                           (ambiguous) and 14 `col+T` (unmeasured).
    //   `shape-word` 399 → 476  +77: the 57 de-arced tiles W1 proved are not
    //                           sectors and have no other tagged dimension,
    //                           plus the 20 `shingles` barge-boards whose pair
    //                           the mesh contradicts by up to 2.905 units.
    //   `unspecified` 181       untouched. Nothing W4 did took a tile from
    //                           having something to say to having nothing.
    //
    // `diag` 121 came out of `wall` and `tri` 9 out of `rect`, so both are a
    // relabel of a tile that already had a dimension, printed more precisely.
    expect(tally(footprints.map((value) => value.basis))).toEqual({
      rect: 3449,
      wall: 3079,
      arc: 1226,
      diag: 121,
      column: 119,
      tri: 9,
      'size-code': 42,
      'shape-word': 476,
      unspecified: 181,
    })
  })

  it('is a printable dimension for 92.0% of the corpus', () => {
    const dimensioned = footprints.filter((value) =>
      (['rect', 'wall', 'arc', 'diag', 'column', 'tri'] as const).some((basis) => value.basis === basis),
    ).length
    expect(dimensioned / records.length).toBeCloseTo(0.92, 3)
    // The three W4 tiers are worth 249 tiles of it, and they are the reason the
    // figure moved 91.5% → 92.0% rather than to the ~95% the plan predicted:
    // 77 tiles left a dimensioned tier in the same change, because W1 measured
    // them and the dimension they had was wrong.
    const measuredByW4 = footprints.filter((value) =>
      (['diag', 'column', 'tri'] as const).some((basis) => value.basis === basis),
    ).length
    expect(measuredByW4).toBe(249)
    // The contract's own figure: a `W × D` alone reaches only two fifths.
    const rects = footprints.filter((value) => value.basis === 'rect').length
    expect(rects / records.length).toBeCloseTo(0.396, 3)
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
