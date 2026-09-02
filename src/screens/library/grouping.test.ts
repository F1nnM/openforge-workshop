/// <reference types="node" />
/**
 * The library's grouping rule and its byte total.
 *
 * Node environment: both derivations are pure functions of catalog records, and
 * the properties that matter are arithmetic rather than visual. The screen's
 * rendering of them is `library.test.tsx`.
 *
 * Two levels, matching the convention in `../detail`:
 *
 *   1. **Hand-built records**, one per branch — every corpus `kinds` combination
 *      the precedence order has to decide, the shared-md5 case, and row A3's two
 *      new ones: several saved variants of one item, and a saved id that resolves
 *      to no aggregate.
 *   2. **The emitted corpus**, where the numbers in `grouping.ts`'s docblock are
 *      re-derived. The invariant that actually matters — every item in exactly
 *      one group, so the group counts sum to the summary — is only convincing
 *      over 3,822 items and 8,702 files. Skips loudly when the index has not been
 *      built.
 *
 * Every fixture goes through `CatalogFile.parse` and then `buildAggregateIndex`,
 * rather than through a hand-written `AggregateIndex`. A stub index would let
 * this file assert against an aggregate shape the real derivation cannot produce,
 * which is exactly the class of bug row A3 is exposed to: the whole row is a
 * reader of A1's output.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { AggregateIndex, CatalogFile, CatalogRecord, TileId } from '@/catalog'
import {
  CatalogFile as CatalogFileSchema,
  CatalogRecord as CatalogRecordSchema,
  TileId as TileIdSchema,
  buildAggregateIndex,
} from '@/catalog'
import { KIND_OTHER } from '@/search'

import type { LibraryContents } from './grouping'
import { KIND_PRECEDENCE, collectLibrary, groupKindOf, roundBytesLabel, totalBytesLabel } from './grouping'

/* ------------------------------------------------------------------ fixtures */

/**
 * A record, parsed rather than cast.
 *
 * Through `CatalogRecord.parse`, so a fixture that drifts from the schema fails
 * here instead of exercising a shape the real index could never produce.
 *
 * `design` defaults to one per ordinal, so records are singleton aggregates
 * unless a test deliberately shares a design — which is how the multi-variant
 * cases below are built.
 */
function tile(index: number, overrides: Record<string, unknown> = {}): CatalogRecord {
  const suffix = index.toString().padStart(2, '0')
  return CatalogRecordSchema.parse({
    id: `tiles/fixture/tile-${suffix}.stl`,
    ord: index,
    blob: `000000000000000000000000000000${suffix}`,
    file: `tile-${suffix}.stl`,
    bytes: 10_000_000,
    sprite: true,
    family: 'tiles/fixture',
    design: `dfix0${suffix}`,
    name: `Tile ${suffix}`,
    kinds: [],
    conn: [],
    layer: 'integral',
    tags: [],
    foot: { shape: 'none' },
    ...overrides,
  })
}

/**
 * A parsed `CatalogFile` over a list of records.
 *
 * `CatalogFile.parse` is what checks for dangling tag ids and duplicate ids and
 * ordinals, so a fixture that reuses an ordinal fails here rather than producing
 * an aggregate index with a silently missing member.
 */
function fileOf(records: readonly CatalogRecord[]): CatalogFile {
  return CatalogFileSchema.parse({
    version: {
      schema: 1,
      pipeline: 1,
      fixtures: '0000000000000000000000000000000000000000',
      manifest: records.length,
      built: '2026-09-01T00:00:00.000Z',
    },
    assets: {
      models: 'https://objects.openforge.tools/models',
      sprites: 'https://objects.openforge.tools/sprites',
      thumbs: 'https://objects.openforge.tools/thumbs',
      lod: 'https://objects.openforge.tools/lod',
    },
    sprite: { rows: 2, cols: 5, tile: 512, frames: 10, defaultFrame: 0 },
    tags: [],
    records,
  })
}

/** The lookup `collectLibrary` takes, over a list of records. */
function lookupOver(records: readonly CatalogRecord[]): (id: TileId) => CatalogRecord | undefined {
  const byId = new Map(records.map((record) => [record.id as string, record]))
  return (id) => byId.get(id)
}

function collect(
  records: readonly CatalogRecord[],
  kindOrder: readonly string[] = CORPUS_ORDER,
): LibraryContents {
  const file = fileOf(records)
  return collectLibrary({
    ids: records.map((record) => record.id),
    record: lookupOver(records),
    aggregates: buildAggregateIndex(file),
    kindOrder,
  })
}

/** `engine.vocabulary.kinds` for the live corpus: count descending. */
const CORPUS_ORDER = ['wall', 'base', 'floor', KIND_OTHER, 'riser', 'angled', 'stairs', 'column']

/** Every group's items, flattened — the sum that has to equal the summary. */
function allItems(contents: LibraryContents) {
  return contents.groups.flatMap((group) => group.items)
}

/* ---------------------------------------------------------------- precedence */

describe('groupKindOf', () => {
  it.each([
    [['base', 'wall'], 'base'],
    [['base', 'floor'], 'base'],
    [['base', 'riser'], 'base'],
    [['angled', 'base'], 'base'],
    [['floor', 'wall'], 'wall'],
    [['angled', 'wall'], 'angled'],
    [['angled', 'floor'], 'angled'],
    [['column', 'wall'], 'column'],
    [['stairs', 'wall'], 'stairs'],
    [['angled', 'column', 'floor', 'wall'], 'angled'],
    [['wall'], 'wall'],
    [['floor'], 'floor'],
  ])('puts %j in %s', (kinds, expected) => {
    expect(groupKindOf(kinds)).toBe(expected)
  })

  it('puts a tile with no kinds in the sentinel bucket the facet index already uses', () => {
    expect(groupKindOf([])).toBe(KIND_OTHER)
  })

  it('is order-independent — the array is a set, and the importer may emit it either way', () => {
    expect(groupKindOf(['wall', 'base'])).toBe('base')
    expect(groupKindOf(['base', 'wall'])).toBe('base')
  })

  it('ranks a kind the importer adds later after every known one, without folding it into floor', () => {
    expect(groupKindOf(['floor', 'balcony'])).toBe('floor')
    expect(groupKindOf(['balcony'])).toBe('balcony')
  })

  it('breaks a tie between two unranked kinds deterministically', () => {
    expect(groupKindOf(['gantry', 'balcony'])).toBe('balcony')
    expect(groupKindOf(['balcony', 'gantry'])).toBe('balcony')
  })

  it('ranks every documented kind, so no known bucket relies on the unknown fallback', () => {
    expect([...KIND_PRECEDENCE].sort()).toEqual(
      ['angled', 'base', 'column', 'floor', 'riser', 'stairs', 'wall'].sort(),
    )
  })
})

/* ------------------------------------------------------------------ grouping */

describe('collectLibrary', () => {
  it('puts a multi-kind item in exactly one group, so the counts sum to the library', () => {
    const records = [
      tile(0, { kinds: ['floor'] }),
      tile(1, { kinds: ['floor', 'wall'] }),
      tile(2, { kinds: ['base', 'wall'] }),
      tile(3, { kinds: [] }),
    ]
    const contents = collect(records)

    expect(contents.items).toBe(4)
    expect(contents.tiles).toBe(4)
    expect(allItems(contents)).toHaveLength(contents.items)

    const appearances = contents.groups.flatMap((group) =>
      group.items.filter((entry) => entry.item.design === records[1]?.design).map(() => group.kind),
    )
    expect(appearances).toEqual(['wall'])
  })

  it('gives the no-kind items a visible bucket rather than dropping them', () => {
    const contents = collect([tile(0, { kinds: [] }), tile(1, { kinds: ['wall'] })])
    const other = contents.groups.find((group) => group.kind === KIND_OTHER)

    expect(other?.items).toHaveLength(1)
    expect(contents.items).toBe(2)
  })

  it('orders groups by the catalog vocabulary and puts the sentinel last', () => {
    const contents = collect([
      tile(0, { kinds: [] }),
      tile(1, { kinds: ['column'] }),
      tile(2, { kinds: ['wall'] }),
      tile(3, { kinds: ['base'] }),
    ])

    expect(contents.groups.map((group) => group.kind)).toEqual(['wall', 'base', 'column', KIND_OTHER])
  })

  it('sorts cards inside a group by name, then design', () => {
    const contents = collect([
      tile(0, { kinds: ['wall'], name: 'Zinc Wall' }),
      tile(1, { kinds: ['wall'], name: 'Arrow Slit' }),
      tile(2, { kinds: ['wall'], name: 'Arrow Slit' }),
    ])

    expect(contents.groups[0]?.items.map((entry) => entry.item.name)).toEqual([
      'Arrow Slit',
      'Arrow Slit',
      'Zinc Wall',
    ])
    // `design` and not `id` breaks the tie: 131 display names are shared by 323
    // aggregates, so the tie is reached far more often per item than per file.
    expect(contents.groups[0]?.items[0]?.item.design).toBe('dfix001')
  })

  it('counts a shared md5 once — 171 corpus md5s carry 520 catalog rows', () => {
    const shared = '0000000000000000000000000000beef'
    const contents = collect([
      tile(0, { kinds: ['wall'], blob: shared, bytes: 20_000_000 }),
      tile(1, { kinds: ['floor'], blob: shared, bytes: 20_000_000 }),
      tile(2, { kinds: ['floor'], bytes: 5_000_000 }),
    ])

    // Three files, two of them one STL under another path.
    expect(contents.tiles).toBe(3)
    expect(contents.files).toBe(2)
    expect(contents.size.bytes).toBe(25_000_000)
    // All three still render — deduping bytes must not dedupe cards. They are
    // three separate designs, so they are three items.
    expect(contents.items).toBe(3)
    expect(allItems(contents)).toHaveLength(3)
  })

  it("carries the builder's own download verdict rather than a second set of thresholds", () => {
    const under = collect([tile(0, { kinds: ['wall'], bytes: 400_000_000 })])
    const over = collect([tile(0, { kinds: ['wall'], bytes: 600_000_000 })])
    const way = collect([tile(0, { kinds: ['wall'], bytes: 2_400_000_000 })])

    expect(under.size.verdict).toBe('ok')
    expect(over.size.verdict).toBe('large')
    expect(over.size.threshold).toBe(512_000_000)
    expect(way.size.verdict).toBe('huge')
  })

  it('reports a saved id the catalog no longer has, instead of silently skipping it', () => {
    const records = [tile(0, { kinds: ['wall'] })]
    const stale = TileIdSchema.parse('tiles/renamed/gone.stl')
    const contents = collectLibrary({
      ids: [records[0]?.id, stale].filter((id): id is TileId => id !== undefined),
      record: lookupOver(records),
      aggregates: buildAggregateIndex(fileOf(records)),
      kindOrder: CORPUS_ORDER,
    })

    expect(contents.missing).toEqual([stale])
    // Not counted as an item or a tile, and not counted in the bytes it cannot
    // describe.
    expect(contents.items).toBe(1)
    expect(contents.tiles).toBe(1)
    expect(contents.size.bytes).toBe(10_000_000)
  })

  it('is empty, not undefined, for an empty library', () => {
    const contents = collect([])

    expect(contents.groups).toEqual([])
    expect(contents.items).toBe(0)
    expect(contents.tiles).toBe(0)
    expect(contents.files).toBe(0)
    expect(contents.size.bytes).toBe(0)
    expect(contents.missing).toEqual([])
  })
})

/* ------------------------------------------------------ several saved variants */

/**
 * Two files of one design, which is the case aggregation created and 1,705 of
 * the 3,822 items (44.6%) allow.
 *
 * A1 asserts that the hoisted facets never vary inside an aggregate, so the pair
 * agrees on everything but the connection axis and its per-file consequences —
 * which is what these fixtures model: same `design`, `name`, `kinds`, different
 * `layer`, `blob` and `bytes`.
 */
const PAIR = [
  tile(0, {
    kinds: ['wall'],
    name: 'Arrow Slit',
    design: 'dpair',
    file: 'arrow_slit.2x.openforge.stl',
    layer: 'topper',
    conn: ['openforge'],
    bytes: 12_000_000,
  }),
  tile(1, {
    kinds: ['wall'],
    name: 'Arrow Slit',
    design: 'dpair',
    file: 'arrow_slit.2x.openlock.stl',
    layer: 'integral',
    conn: ['openlock'],
    bytes: 18_000_000,
  }),
] as const

describe('an item with several saved variants', () => {
  it('renders one card, and names every saved file on it', () => {
    const contents = collect([...PAIR])

    expect(contents.items).toBe(1)
    expect(contents.tiles).toBe(2)
    const [entry] = allItems(contents)
    expect(entry?.saved.map((variant) => variant.id)).toEqual([PAIR[0].id, PAIR[1].id])
  })

  it('sums the card’s bytes over the saved files, not over the item’s range', () => {
    const contents = collect([...PAIR])

    expect(allItems(contents)[0]?.bytes).toBe(30_000_000)
    expect(contents.size.bytes).toBe(30_000_000)
  })

  it('counts one file when the two saved variants share a mesh — 66 items allow it', () => {
    const shared = '0000000000000000000000000000cafe'
    const contents = collect([
      tile(0, { ...variantFields(PAIR[0]), blob: shared, bytes: 12_000_000 }),
      tile(1, { ...variantFields(PAIR[1]), blob: shared, bytes: 12_000_000 }),
    ])

    expect(contents.items).toBe(1)
    expect(contents.tiles).toBe(2)
    expect(contents.files).toBe(1)
    expect(contents.size.bytes).toBe(12_000_000)
    expect(allItems(contents)[0]?.bytes).toBe(12_000_000)
  })

  it('shows one card holding one file when only one variant is saved', () => {
    const file = fileOf([...PAIR])
    const contents = collectLibrary({
      ids: [PAIR[1].id],
      record: lookupOver([...PAIR]),
      aggregates: buildAggregateIndex(file),
      kindOrder: CORPUS_ORDER,
    })

    expect(contents.items).toBe(1)
    expect(contents.tiles).toBe(1)
    const [entry] = allItems(contents)
    expect(entry?.saved).toHaveLength(1)
    expect(entry?.preview.id).toBe(PAIR[1].id)
    // The item still knows about both variants; only one of them is saved.
    expect(entry?.item.variants).toHaveLength(2)
  })

  it('previews a saved variant that has a sprite sheet over one that has none', () => {
    const records = [
      tile(0, { ...variantFields(PAIR[0]), sprite: false }),
      tile(1, { ...variantFields(PAIR[1]), sprite: true }),
    ]
    const contents = collect(records)

    // The first saved variant has no sheet, so the card would render "no render"
    // for an item whose other saved file has a picture. A1 applies the same rule
    // to `TileAggregate.preview` for the one live record of 8,702 with no sheet.
    expect(allItems(contents)[0]?.preview.id).toBe(records[1]?.id)
  })

  it('previews the first saved variant when none of them has a sheet', () => {
    const records = [
      tile(0, { ...variantFields(PAIR[0]), sprite: false }),
      tile(1, { ...variantFields(PAIR[1]), sprite: false }),
    ]
    const contents = collect(records)

    expect(allItems(contents)[0]?.preview.id).toBe(records[0]?.id)
  })

  it('orders the saved files by the aggregate’s own variant order, not by insertion', () => {
    const file = fileOf([...PAIR])
    const aggregates = buildAggregateIndex(file)
    const forwards = collectLibrary({
      ids: [PAIR[0].id, PAIR[1].id],
      record: lookupOver([...PAIR]),
      aggregates,
      kindOrder: CORPUS_ORDER,
    })
    const backwards = collectLibrary({
      ids: [PAIR[1].id, PAIR[0].id],
      record: lookupOver([...PAIR]),
      aggregates,
      kindOrder: CORPUS_ORDER,
    })

    // An export and a re-import can hand the ids back in any order; the card must
    // not reorder its file rows because of it.
    expect(allItems(forwards)[0]?.saved.map((variant) => variant.id)).toEqual(
      allItems(backwards)[0]?.saved.map((variant) => variant.id),
    )
  })
})

/**
 * Everything about a fixture record except its ordinal-derived identity, so a
 * test can vary one field of the pair without restating the other eight.
 */
function variantFields(record: CatalogRecord): Record<string, unknown> {
  return {
    kinds: [...record.kinds],
    name: record.name,
    design: record.design,
    file: record.file,
    layer: record.layer,
    conn: [...record.conn],
    bytes: record.bytes,
  }
}

/* ------------------------------------------------------------------- figures */

describe('byte labels', () => {
  it.each([
    [45_284, '45 kB'],
    [999_999, '1000 kB'],
    [10_360_000, '10.4 MB'],
    [518_000_000, '518.0 MB'],
    [1_640_000_000, '1.6 GB'],
  ])('formats %i as %s', (bytes, expected) => {
    expect(totalBytesLabel(bytes)).toBe(expected)
  })

  it('drops the decimal for a round threshold', () => {
    expect(roundBytesLabel(512_000_000)).toBe('512 MB')
    expect(roundBytesLabel(2_000_000_000)).toBe('2 GB')
  })
})

/* -------------------------------------------------------------------- corpus */

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
      '  screens/library/grouping.test: SKIPPED the corpus block — no emitted index.',
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
const corpus = loaded as CatalogFile
const corpusAggregates: AggregateIndex | undefined =
  loaded === undefined ? undefined : buildAggregateIndex(loaded)

function collectCorpus(): LibraryContents {
  return collectLibrary({
    ids: corpus.records.map((record) => record.id),
    record: lookupOver(corpus.records),
    aggregates: corpusAggregates as AggregateIndex,
    kindOrder: CORPUS_ORDER,
  })
}

describeCorpus('the whole corpus, as one library', () => {
  it('assigns every item exactly one group', () => {
    const contents = collectCorpus()

    expect(contents.missing).toEqual([])
    expect(contents.tiles).toBe(corpus.records.length)
    expect(contents.items).toBe(3822)
    expect(allItems(contents)).toHaveLength(contents.items)
  })

  it('re-derives the group sizes the precedence order is documented against', () => {
    const contents = collectCorpus()
    const sizes = Object.fromEntries(contents.groups.map((group) => [group.kind, group.items.length]))

    // Item counts, not file counts: the whole corpus saved is 3,822 cards over
    // 8,702 files. Bases are 340 and that is exactly A1's `base-only` class
    // count, which is the measurement behind "a base never shares a group with
    // anything else" — `shape|base` is in the design key, so a base is always its
    // own design and aggregation never merges one into the tile it supports.
    expect(sizes).toEqual({
      wall: 1463,
      base: 340,
      floor: 940,
      riser: 131,
      angled: 68,
      stairs: 167,
      column: 102,
      [KIND_OTHER]: 611,
    })
    expect(Object.values(sizes).reduce((sum, count) => sum + count, 0)).toBe(3822)
  })

  it('re-derives the multi-kind and no-kind shares in the docblock', () => {
    const multi = corpus.records.filter((record) => record.kinds.length > 1).length
    const none = corpus.records.filter((record) => record.kinds.length === 0).length

    expect(multi).toBe(1693)
    expect(none).toBe(1032)
    // 19.5% in two or more, 11.9% in none — the two facts that make a single
    // `groupBy(kind)` wrong.
    expect(multi / corpus.records.length).toBeCloseTo(0.195, 3)
    expect(none / corpus.records.length).toBeCloseTo(0.119, 3)
  })

  it('groups an item by the same kind as every one of its files', () => {
    // The rule reads `kinds` off the aggregate, which is only sound because A1
    // measured that no aggregate holds two distinct values of it. Asserted here
    // rather than assumed, because this module would otherwise file 1,705
    // multi-variant items by one arbitrary member's kinds.
    for (const item of (corpusAggregates as AggregateIndex).aggregates) {
      const byItem = groupKindOf(item.kinds)
      for (const variant of item.variants) {
        const record = corpus.records[variant.ord as unknown as number]
        expect(groupKindOf(record?.kinds ?? [])).toBe(byItem)
      }
    }
  })

  it('deduping by md5 removes 349 rows from the byte total', () => {
    const contents = collectCorpus()

    // 171 md5s across 520 rows, so 349 rows are a second path to a file already
    // counted. Summing over ids would overstate the download by those 349 files.
    expect(contents.tiles).toBe(8702)
    expect(contents.files).toBe(8353)
    expect(contents.size.bytes).toBe(106_129_621_189)

    const naive = corpus.records.reduce((sum, record) => sum + record.bytes, 0)
    expect(contents.size.bytes).toBeLessThan(naive)
  })

  it('dedupes across items and not only within one, which the cards cannot', () => {
    const contents = collectCorpus()
    const perCard = allItems(contents).reduce((sum, entry) => sum + entry.bytes, 0)

    // A card states what it costs on its own, so a blob shared by two *items* is
    // counted on both cards — 467,082,553 bytes of double-counting corpus-wide.
    // The summary's total dedupes globally, which is what a single download
    // actually transfers, and `LibraryNotes` is what explains the gap.
    expect(perCard).toBe(106_596_703_742)
    expect(contents.size.bytes).toBeLessThan(perCard)
  })
})
