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
import { CatalogFile as CatalogFileSchema, buildAggregateIndex } from '@/catalog'

import { NO_FOOTPRINT, NO_HEIGHT, footprintLabel, heightLabel, storageAddress } from './labels'
import { spriteSheetUrl } from './spriteFrames'
import { joinsOf, slotRows, variantRows } from './variants'

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
    //   `shape-word` 399 → 503  +104: the 57 de-arced tiles W4 proved are not
    //                           sectors and have no other tagged dimension, the
    //                           20 `shingles` barge-boards whose pair the mesh
    //                           contradicts by up to 2.905 units, and W5's 27
    //                           `curved_interface` floors, which keep the word
    //                           "Curved" and lose a width that over-stated the
    //                           mesh by 0.300 or 1.513 units.
    //   `unspecified` 181       untouched across both rows. Nothing either did
    //                           took a tile from having something to say to
    //                           having nothing — a de-arced curve is still a
    //                           curve, and tier 8 says so.
    //
    // `diag` 121 came out of `wall` and `tri` 9 out of `rect`, so both are a
    // relabel of a tile that already had a dimension, printed more precisely.
    expect(tally(footprints.map((value) => value.basis))).toEqual({
      rect: 3449,
      wall: 3079,
      arc: 1199,
      diag: 121,
      column: 119,
      tri: 9,
      'size-code': 42,
      'shape-word': 503,
      unspecified: 181,
    })
  })

  it('is a printable dimension for 91.7% of the corpus', () => {
    const dimensioned = footprints.filter((value) =>
      (['rect', 'wall', 'arc', 'diag', 'column', 'tri'] as const).some((basis) => value.basis === basis),
    ).length
    expect(dimensioned / records.length).toBeCloseTo(0.917, 3)
    // The three W4 tiers are worth 249 tiles of it, and the figure moved
    // 91.5% → 92.0% → 91.7% rather than to the ~95% the plan predicted, because
    // 104 tiles left a dimensioned tier across the two rows: W1 measured them
    // and the dimension they had was wrong. Coverage is not the objective; a
    // dimension that is right is.
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

describeCorpus('the variants table over the live corpus', () => {
  const index = loaded === undefined ? undefined : buildAggregateIndex(loaded)
  const aggregates = index?.aggregates ?? []

  it('discloses every file of every item, and 55.4% of items have exactly one', () => {
    expect(aggregates).toHaveLength(3822)

    let disclosed = 0
    let singletons = 0
    let widest = 0
    for (const aggregate of aggregates) {
      const rows = variantRows(aggregate)
      // Nothing filtered, nothing deduplicated, nothing truncated — the row's
      // whole requirement is that all of them are rendered.
      expect(rows).toHaveLength(aggregate.variants.length)
      expect(rows.map((row) => row.variant.id)).toEqual(aggregate.variants.map((variant) => variant.id))
      disclosed += rows.length
      if (rows.length === 1) singletons += 1
      widest = Math.max(widest, rows.length)
    }

    expect(disclosed).toBe(8702)
    expect(singletons).toBe(2117)
    expect(singletons / aggregates.length).toBeCloseTo(0.554, 3)
    // The largest group. A scrolling drawer shows 20 rows; nothing hides them.
    expect(widest).toBe(20)
  })

  it('gives every row an identity the derived facts cannot supply', () => {
    // 171 aggregates (4.5%) hold two variants agreeing on part count, layer,
    // every system this table renders and every option — worst case 18 of them,
    // among the 20 files of `Plain Wall Base 1x IA`. The figure is 215 (5.6%)
    // when only the three lock systems are compared, which is what a card does;
    // this table shows the unfiltered vocabulary and so separates 44 more items.
    // Either way the derived facts are not an identity, and `label` is.
    const described = (row: ReturnType<typeof variantRows>[number]): string =>
      [
        row.partsLabel,
        row.variant.layer,
        row.joins.map((join) => `${join.face}:${join.system}`).join('/'),
        row.options.join('+'),
      ].join('|')

    let collided = 0
    let worst = 0
    for (const aggregate of aggregates) {
      const rows = variantRows(aggregate)
      const counts = new Map<string, number>()
      for (const row of rows) counts.set(described(row), (counts.get(described(row)) ?? 0) + 1)
      const duplicated = [...counts.values()].filter((n) => n > 1)
      if (duplicated.length > 0) {
        collided += 1
        worst = Math.max(worst, ...duplicated)
      }
      // The identity, however, is always total.
      expect(new Set(rows.map((row) => row.label)).size).toBe(rows.length)
      expect(new Set(rows.map((row) => row.variant.id)).size).toBe(rows.length)
    }

    expect(collided).toBe(171)
    expect(worst).toBe(18)
  })

  it('claims a part count and never a material saving', () => {
    let toppers = 0
    let single = 0
    for (const aggregate of aggregates) {
      for (const row of variantRows(aggregate)) {
        if (row.minParts === 2) {
          toppers += 1
          expect(row.variant.needsBase).toBe(true)
        } else {
          single += 1
          expect(row.variant.needsBase).toBe(false)
        }
        // A download size, formatted, and nothing that reads as a comparison:
        // no percentage, no ratio, no "saves", no "smaller".
        expect(row.download).toMatch(/^[\d.,]+ (B|KB|MB)$/)
        expect(row.partsNote).not.toMatch(/filament|material|print time|saving|smaller|lighter/i)
      }
    }
    // The layer split, which is what the part count is derived from.
    expect(toppers).toBe(4363)
    expect(single).toBe(4339)
  })

  it('measures the two byte ratios that were in circulation, and neither is filament', () => {
    const quantile = (values: readonly number[], q: number): number => {
      const sorted = [...values].sort((a, b) => a - b)
      return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))] ?? 0
    }

    // A1's figure: the spread *within* an aggregate, over the multi-variant ones.
    const spread = aggregates
      .filter((aggregate) => aggregate.variants.length > 1)
      .map((aggregate) => aggregate.bytesRange[1] / aggregate.bytesRange[0])
    expect(spread).toHaveLength(1705)
    expect(quantile(spread, 0.5)).toBeCloseTo(1.13, 2)
    expect(quantile(spread, 0.9)).toBeCloseTo(3.46, 2)
    expect(Math.round(quantile(spread, 1))).toBe(39401)
    expect(spread.filter((ratio) => ratio > 1.25)).toHaveLength(719)
    expect(spread.filter((ratio) => ratio > 2)).toHaveLength(325)

    // The row's own draft figure: an integrated variant against its topper, over
    // the 931 aggregates holding both. A different population and a different
    // statistic — which is why both numbers were right.
    const paired: number[] = []
    let smaller = 0
    for (const aggregate of aggregates) {
      const integrated = aggregate.variants.filter(
        (variant) => !variant.needsBase && variant.layer !== 'insert',
      )
      const topper = aggregate.variants.filter((variant) => variant.needsBase)
      if (integrated.length === 0 || topper.length === 0) continue
      const one = Math.min(...integrated.map((variant) => variant.bytes))
      const two = Math.min(...topper.map((variant) => variant.bytes))
      paired.push(one / two)
      if (one < two) smaller += 1
    }
    expect(paired).toHaveLength(931)
    expect(quantile(paired, 0.5)).toBeCloseTo(1.024, 3)
    expect(smaller).toBe(254)
    expect(smaller / paired.length).toBeCloseTo(0.273, 3)

    // And the reason no ratio may be rendered as a saving. Two `integral`
    // variants of one item, 84 bytes against 3,309,684 — a degenerate mesh, not
    // a cheaper print.
    const worst = aggregates.find((aggregate) => aggregate.bytesRange[0] === 84)
    expect(worst?.name).toBe('Aztlan Wall Column T')
    expect(worst?.bytesRange[1]).toBe(3_309_684)
  })

  it('drops `openforge` from the joins at no cost, because it is the base declaration', () => {
    let toppersUnderOpenforge = 0
    let selfSufficientUnderOpenforge = 0
    let joinsMentioningOpenforge = 0
    for (const aggregate of aggregates) {
      for (const variant of aggregate.variants) {
        if (variant.bottomConn.includes('openforge')) {
          if (variant.needsBase) toppersUnderOpenforge += 1
          else selfSufficientUnderOpenforge += 1
        }
        if (joinsOf(variant).some((join) => join.system === 'openforge')) joinsMentioningOpenforge += 1
      }
    }
    expect(toppersUnderOpenforge).toBe(4363)
    // Nothing is lost: it is on the underside of every topper and no other file.
    expect(selfSufficientUnderOpenforge).toBe(0)
    expect(joinsMentioningOpenforge).toBe(0)
  })

  it('separates the base slot from the 552 real accessory slots', () => {
    let slots = 0
    let baseSlots = 0
    let accessories = 0
    let itemsWithAccessories = 0
    let nonUniversal = 0
    for (const aggregate of aggregates) {
      slots += aggregate.slots.length
      baseSlots += aggregate.slots.filter((slot) => slot.slot.name === 'base').length
      const rows = slotRows(aggregate)
      const printLabels = new Set(variantRows(aggregate).map((row) => row.label))
      accessories += rows.length
      if (rows.length > 0) itemsWithAccessories += 1
      for (const row of rows) {
        // Provenance is total: a universal slot names no print, a non-universal
        // one names every print that carries it, never all of them, and always
        // by a label the table's own rows carry — so the cross-reference the
        // drawer asks the user to make actually resolves.
        if (row.universal) expect(row.onlyOn).toHaveLength(0)
        else {
          nonUniversal += 1
          expect(row.onlyOn.length).toBeGreaterThan(0)
          expect(row.onlyOn.length).toBeLessThan(aggregate.variants.length)
          for (const label of row.onlyOn) expect(printLabels).toContain(label)
        }
      }
      // `base` never survives into a slot row.
      expect(rows.map((row) => row.name)).not.toContain('base')
    }

    expect(slots).toBe(2112)
    // 1,560 of the corpus's slots are the base match, which the part count states.
    expect(baseSlots).toBe(1560)
    expect(accessories).toBe(552)
    expect(itemsWithAccessories).toBe(445)
    expect(nonUniversal).toBeGreaterThan(0)
  })
})
