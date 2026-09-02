/// <reference types="node" />
/**
 * The card against the real catalog — the availability chips and the
 * distinguishability cascade, asserted over all 3,822 items.
 *
 * `availability.test.ts` proves each branch in isolation. This file proves the
 * four things only the whole corpus can prove, and that a reviewer would
 * otherwise have to take on trust:
 *
 *   1. **No card renders a blank availability strip.** All 3,822 items produce at
 *      least one chip, and the three sources of chips partition the corpus with
 *      nothing left over.
 *   2. **The strip fits its fixed two-line box.** The widest row the live corpus
 *      produces is measured against `CHIP_BUDGET`, so a relabel that would clip a
 *      chip out of sight fails the build rather than shipping.
 *   3. **Magnetic never reaches the `sides` state.** That measurement is the whole
 *      reason side-ness is a state of a lock's own chip rather than a second row
 *      of three chips, one of which could never light.
 *   4. **A card is distinguishable.** 131 display names are shared by 323 items,
 *      so the cascade from "name alone" to "everything the card shows" is
 *      re-derived here step by step. It is the only way to tell whether the
 *      facets a card carries are doing the work claimed for them.
 *
 * The corpus is the emitted `public/catalog/catalog.json` (`npm run
 * import:catalog`), matching the convention in `../detail/corpus.test.ts`. When
 * it is absent every block **skips loudly**.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { CatalogFile, CatalogRecord, TileAggregate } from '@/catalog'
import { CatalogFile as CatalogFileSchema, buildAggregateIndex } from '@/catalog'

import { CHIP_BUDGET, availabilityChips, availabilityOf, chipStripWidth } from './availability'
import { bytesRangeLabel, fileTokenLabel, humaniseSegment, sizeLabel } from './format'

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
      '  screens/catalog/corpus.test: SKIPPED — no emitted catalog index.',
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
const items: readonly TileAggregate[] = loaded === undefined ? [] : buildAggregateIndex(loaded).aggregates
const records: readonly CatalogRecord[] = loaded?.records ?? []
const byId = new Map(records.map((record) => [record.id as string, record]))

const previewOf = (item: TileAggregate): CatalogRecord | undefined => byId.get(item.preview)
const chipsOf = (item: TileAggregate) => availabilityChips(availabilityOf(item))

function tally(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1
  return counts
}

/** How many values are shared by two or more items, and by how many items. */
function collisions(keys: readonly string[]): {
  groups: number
  items: number
  worst: number
} {
  const counts = new Map<string, number>()
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1)
  const shared = [...counts.values()].filter((count) => count > 1)
  return {
    groups: shared.length,
    items: shared.reduce((sum, count) => sum + count, 0),
    worst: shared.length === 0 ? 0 : Math.max(...shared),
  }
}

/* ------------------------------------------------------------------- corpus */

describeCorpus('the corpus this row was measured against', () => {
  it('is 3,822 items over 8,702 files', () => {
    expect(items).toHaveLength(3822)
    expect(records).toHaveLength(8702)
    expect(records.length / items.length).toBeCloseTo(2.28, 2)
  })
})

/* ------------------------------------------------------------------- chips */

describeCorpus('the availability strip over every item', () => {
  it('is never empty — no card says nothing about how to print it', () => {
    for (const item of items) expect(chipsOf(item).length).toBeGreaterThan(0)
  })

  it('takes exactly 17 distinct forms, and every chip state is reachable', () => {
    const rows = new Set(items.map((item) => chipsOf(item).map((chip) => chip.label).join(' · ')))
    expect(rows.size).toBe(17)

    // Every state appears, which is what "no dead control" means concretely: a
    // state with a zero here would be a chip the user could never see lit.
    expect(
      tally(items.flatMap((item) => chipsOf(item).map((chip) => `${chip.kind}:${chip.state}`))),
    ).toEqual({
      'base:need': 2137,
      'base:choice': 931,
      'base:have': 754,
      // 1,497 openlock + 359 dragonlock + 255 magnetic.
      'lock:underside': 2111,
      // 293 openlock + 468 dragonlock + 0 magnetic.
      'lock:sides': 761,
      // 94 inserts + 93 untagged, with no overlap.
      'note:note': 187,
    })
  })

  it('never gives magnetic the sides state — 0 of 3,822', () => {
    // The measurement the layout rests on. Magnets are glued into a pocket in a
    // piece's base and nothing in this corpus mounts one on a side wall, so a
    // symmetrical two-row grid of six chips would ship one that can never light.
    const magneticSides = items.filter((item) =>
      availabilityOf(item).locks.some((chip) => chip.lock === 'magnetic' && chip.reach === 'sides'),
    )
    expect(magneticSides).toHaveLength(0)

    // And magnetic's chip is not therefore dead: it lights 255 times underneath.
    const magneticUnderside = items.filter((item) =>
      availabilityOf(item).locks.some((chip) => chip.lock === 'magnetic' && chip.reach === 'underside'),
    )
    expect(magneticUnderside).toHaveLength(255)
  })

  it('reaches the per-lock counts A1 measured', () => {
    const underside = (lock: string) =>
      items.filter((item) =>
        availabilityOf(item).locks.some((chip) => chip.lock === lock && chip.reach === 'underside'),
      ).length
    const sides = (lock: string) =>
      items.filter((item) =>
        availabilityOf(item).locks.some((chip) => chip.lock === lock && chip.reach === 'sides'),
      ).length

    expect([underside('openlock'), underside('dragonlock'), underside('magnetic')]).toEqual([
      1497, 359, 255,
    ])
    // Side-*only*. `sideConn` holds 848 openlock and 468 dragonlock; 555 of the
    // openlock ones also lock underneath and are shown as that stronger claim, so
    // 293 remain as outlined chips. Dragonlock's self and side sets are disjoint,
    // which is why all 468 of its side chips survive.
    expect([sides('openlock'), sides('dragonlock'), sides('magnetic')]).toEqual([293, 468, 0])
  })

  it('partitions the items with no lock chip, leaving nothing unexplained', () => {
    const noLock = items.filter((item) => availabilityOf(item).locks.length === 0)
    expect(noLock).toHaveLength(2027)

    // 1,878 are toppers, so the base chip is their whole strip and says something
    // real. The other 149 need no base either, and are exactly the two note
    // cases — which is why `JoineryNote` has two values and no `'none'`.
    const toppers = noLock.filter((item) => item.needsBase === 'always')
    const rest = noLock.filter((item) => item.needsBase !== 'always')
    expect(toppers).toHaveLength(1878)
    expect(rest).toHaveLength(149)
    expect(tally(rest.map((item) => availabilityOf(item).note ?? 'none'))).toEqual({
      insert: 93,
      untagged: 56,
    })
  })

  it('never has to choose between the two notes, because they do not overlap', () => {
    // The `'insert'`-wins precedence in `availabilityOf` is currently
    // unreachable: every untagged item is `integrated-only`, so none is an
    // insert. Asserted rather than assumed, because if the corpus grew an
    // overlapping case the strip would silently drop a claim.
    const untagged = items.filter((item) => item.joineryUntagged)
    expect(untagged).toHaveLength(93)
    for (const item of untagged) expect(item.variantClass).toBe('integrated-only')
    expect(items.filter((item) => item.variantClass === 'insert-only' && item.joineryUntagged)).toHaveLength(0)
  })

  it('does not chip `filament`, and no item loses its only chip to that', () => {
    // `connection|side|filament` is the side system on 114 records, one per
    // design and so 114 items, and is not something the builder can be locked
    // to. Every one of them is a topper, so the base chip carries all 114 and the
    // 26 that name no lock at all still get a strip.
    const filament = items.filter((item) => item.sideConn.includes('filament'))
    expect(filament).toHaveLength(114)
    for (const item of filament) {
      expect(item.needsBase).toBe('always')
      expect(chipsOf(item).length).toBeGreaterThan(0)
    }
    expect(filament.filter((item) => availabilityOf(item).locks.length === 0)).toHaveLength(26)
  })
})

/* ------------------------------------------------------------------ budget */

describeCorpus('the strip fits its fixed two-line box', () => {
  it('never exceeds four chips or sixty characters', () => {
    const chips = items.map((item) => chipsOf(item))
    expect(Math.max(...chips.map((row) => row.length))).toBe(CHIP_BUDGET.chips)
    expect(Math.max(...chips.map((row) => row.reduce((total, chip) => total + chip.label.length, 0)))).toBe(
      CHIP_BUDGET.characters,
    )
  })

  it('never exceeds the box, with 29px of the 394px to spare at the worst card', () => {
    const widest = Math.max(...items.map((item) => chipStripWidth(chipsOf(item))))
    expect(widest).toBeCloseTo(365, 0)
    expect(widest).toBeLessThanOrEqual(CHIP_BUDGET.widthPx)
  })
})

/* --------------------------------------------------------- distinguishability */

describeCorpus('a card can be told from its neighbour', () => {
  /** Everything the card renders, as the strings it renders them as. */
  const parts = (item: TileAggregate) => {
    const preview = previewOf(item)
    return {
      name: item.name,
      texture: item.texture === undefined ? 'Untextured' : humaniseSegment(item.texture),
      size: sizeLabel(item.foot, item.sizeCode),
      chips: chipsOf(item)
        .map((chip) => chip.label)
        .join('·'),
      bytes: bytesRangeLabel(item.bytesRange),
      token: preview === undefined ? '' : fileTokenLabel(preview.file),
    }
  }

  it('resolves every preview to a record, so no card renders a hole', () => {
    for (const item of items) expect(previewOf(item)).toBeDefined()
  })

  it('narrows 131 shared names to 21 identical cards, facet by facet', () => {
    const keyed = (of: (item: TileAggregate) => readonly string[]) =>
      collisions(items.map((item) => of(item).join('|')))

    // The starting point A1 measured: the title alone is not identity.
    expect(keyed((item) => [parts(item).name])).toEqual({ groups: 131, items: 323, worst: 6 })

    // Texture and the size chip separate **nothing**, and that is the finding
    // that makes the rest of this row necessary rather than nice: two aggregates
    // sharing a display name share their texture set and their footprint by
    // construction, because `name` is synthesised from those very tags.
    expect(
      keyed((item) => {
        const part = parts(item)
        return [part.name, part.texture, part.size]
      }),
    ).toEqual({ groups: 131, items: 323, worst: 6 })

    // The availability chips are the first thing that separates anything — they
    // are derived from the connection axis, which is exactly what an aggregate
    // does *not* hoist.
    expect(
      keyed((item) => {
        const part = parts(item)
        return [part.name, part.texture, part.size, part.chips]
      }),
    ).toEqual({ groups: 91, items: 233, worst: 5 })

    // The byte range, which is the other field that genuinely varies per item.
    expect(
      keyed((item) => {
        const part = parts(item)
        return [part.name, part.texture, part.size, part.chips, part.bytes]
      }),
    ).toEqual({ groups: 38, items: 79, worst: 3 })

    // And the filename token, the one field that is not a tag: 21 groups over 45
    // items remain, 1.2% of the catalog, worst 3.
    expect(
      keyed((item) => {
        const part = parts(item)
        return [part.name, part.texture, part.size, part.chips, part.bytes, part.token]
      }),
    ).toEqual({ groups: 21, items: 45, worst: 3 })
  })

  it('leaves a remainder that tag chips would close — every one of the 21', () => {
    // Row X2 owns the design contract's tag chips, which v1 left out. Measured:
    // the union of a group's resolved tags separates **all 21** remaining
    // collisions, so the last 45 cards are a scheduled row away from distinct
    // rather than an unsolved problem. The causes are visible in the filenames —
    // `magnetic+imperial` against `magnetic+metric`, `arch+glass` against `arch`,
    // `minimal-full-full` against `minimal-full-minimal`.
    const tagsOf = (item: TileAggregate) =>
      [
        ...new Set(
          item.variants.flatMap((variant) =>
            (byId.get(variant.id as string)?.tags ?? []).map((at) => loaded?.tags[at] ?? ''),
          ),
        ),
      ]
        .sort()
        .join(',')

    const cardKey = (item: TileAggregate) => {
      const part = parts(item)
      return [part.name, part.texture, part.size, part.chips, part.bytes, part.token].join('|')
    }

    const groups = new Map<string, TileAggregate[]>()
    for (const item of items) {
      const key = cardKey(item)
      const found = groups.get(key)
      if (found === undefined) groups.set(key, [item])
      else found.push(item)
    }

    const remaining = [...groups.values()].filter((group) => group.length > 1)
    expect(remaining).toHaveLength(21)
    for (const group of remaining) {
      expect(new Set(group.map(tagsOf)).size).toBe(group.length)
    }
  })
})

/* ------------------------------------------------------------------ figures */

describeCorpus('the two per-item figures the card states', () => {
  it('renders the byte range as one figure on 2,193 items and a range on 1,629', () => {
    const single = items.filter((item) => !bytesRangeLabel(item.bytesRange).includes('–'))
    expect(single).toHaveLength(2193)
    expect(items.length - single.length).toBe(1629)

    // Every singleton reads as one figure, which is why most cards are unchanged
    // by aggregation; the ranges are the multi-variant items whose spread does
    // not hide inside one decimal place.
    for (const item of items) {
      if (item.variants.length === 1) expect(bytesRangeLabel(item.bytesRange)).not.toContain('–')
    }
  })

  it('gives 3,782 items a filename token, from a 148-value vocabulary', () => {
    const tokens = items.map((item) => {
      const preview = previewOf(item)
      return preview === undefined ? '' : fileTokenLabel(preview.file)
    })

    // 40 filenames carry nothing but a connection spec after the first dot, and
    // render nothing rather than a placeholder.
    expect(tokens.filter((token) => token === '')).toHaveLength(40)
    expect(new Set(tokens).size).toBe(148)
    // Short enough to sit on the meta line beside the size chip and the bytes.
    expect(Math.max(...tokens.map((token) => token.length))).toBe(14)
  })

  it('reads the token off the design and not off one arbitrary file', () => {
    // The connection segments are skipped, which is what makes this a property of
    // the item: taking the filename tail whole would disagree between the variants
    // of 1,210 items. Skipping them leaves 22, and those 22 are the only cards
    // whose token depends on which variant supplies the preview.
    const varying = items.filter(
      (item) => new Set(item.variants.map((variant) => fileTokenLabel(variant.file))).size > 1,
    )
    expect(varying).toHaveLength(22)
  })
})
