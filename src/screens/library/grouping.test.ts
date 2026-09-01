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
 *      the precedence order has to decide, plus the shared-md5 case.
 *   2. **The emitted corpus**, where the numbers in `grouping.ts`'s docblock are
 *      re-derived. The invariant that actually matters — every tile in exactly
 *      one group, so the group counts sum to the summary — is only convincing
 *      over 8,702 rows. Skips loudly when the index has not been built.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { CatalogFile, CatalogRecord, TileId } from '@/catalog'
import { CatalogFile as CatalogFileSchema, CatalogRecord as CatalogRecordSchema, TileId as TileIdSchema } from '@/catalog'
import { KIND_OTHER } from '@/search'

import { KIND_PRECEDENCE, collectLibrary, groupKindOf, roundBytesLabel, totalBytesLabel } from './grouping'

/* ------------------------------------------------------------------ fixtures */

/**
 * A record, parsed rather than cast.
 *
 * Through `CatalogRecord.parse`, so a fixture that drifts from the schema fails
 * here instead of exercising a shape the real index could never produce.
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

/** The lookup `collectLibrary` takes, over a list of records. */
function lookupOver(records: readonly CatalogRecord[]): (id: TileId) => CatalogRecord | undefined {
  const byId = new Map(records.map((record) => [record.id as string, record]))
  return (id) => byId.get(id)
}

function collect(records: readonly CatalogRecord[], kindOrder: readonly string[] = CORPUS_ORDER) {
  return collectLibrary({ ids: records.map((record) => record.id), record: lookupOver(records), kindOrder })
}

/** `engine.vocabulary.kinds` for the live corpus: count descending. */
const CORPUS_ORDER = ['wall', 'base', 'floor', KIND_OTHER, 'riser', 'angled', 'stairs', 'column']

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
    expect(groupKindOf(tile(0, { kinds }))).toBe(expected)
  })

  it('puts a tile with no kinds in the sentinel bucket the facet index already uses', () => {
    expect(groupKindOf(tile(0, { kinds: [] }))).toBe(KIND_OTHER)
  })

  it('is order-independent — the array is a set, and the importer may emit it either way', () => {
    expect(groupKindOf(tile(0, { kinds: ['wall', 'base'] }))).toBe('base')
    expect(groupKindOf(tile(0, { kinds: ['base', 'wall'] }))).toBe('base')
  })

  it('ranks a kind the importer adds later after every known one, without folding it into floor', () => {
    expect(groupKindOf(tile(0, { kinds: ['floor', 'balcony'] }))).toBe('floor')
    expect(groupKindOf(tile(0, { kinds: ['balcony'] }))).toBe('balcony')
  })

  it('breaks a tie between two unranked kinds deterministically', () => {
    expect(groupKindOf(tile(0, { kinds: ['gantry', 'balcony'] }))).toBe('balcony')
    expect(groupKindOf(tile(0, { kinds: ['balcony', 'gantry'] }))).toBe('balcony')
  })

  it('ranks every documented kind, so no known bucket relies on the unknown fallback', () => {
    expect([...KIND_PRECEDENCE].sort()).toEqual(
      ['angled', 'base', 'column', 'floor', 'riser', 'stairs', 'wall'].sort(),
    )
  })
})

/* ------------------------------------------------------------------ grouping */

describe('collectLibrary', () => {
  it('puts a multi-kind tile in exactly one group, so the counts sum to the library', () => {
    const records = [
      tile(0, { kinds: ['floor'] }),
      tile(1, { kinds: ['floor', 'wall'] }),
      tile(2, { kinds: ['base', 'wall'] }),
      tile(3, { kinds: [] }),
    ]
    const contents = collect(records)

    expect(contents.tiles).toBe(4)
    expect(contents.groups.reduce((sum, group) => sum + group.records.length, 0)).toBe(contents.tiles)

    const appearances = contents.groups.flatMap((group) =>
      group.records.filter((record) => record.id === records[1]?.id).map(() => group.kind),
    )
    expect(appearances).toEqual(['wall'])
  })

  it('gives the no-kind tiles a visible bucket rather than dropping them', () => {
    const contents = collect([tile(0, { kinds: [] }), tile(1, { kinds: ['wall'] })])
    const other = contents.groups.find((group) => group.kind === KIND_OTHER)

    expect(other?.records).toHaveLength(1)
    expect(contents.tiles).toBe(2)
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

  it('sorts cards inside a group by name, then id', () => {
    const contents = collect([
      tile(0, { kinds: ['wall'], name: 'Zinc Wall' }),
      tile(1, { kinds: ['wall'], name: 'Arrow Slit' }),
      tile(2, { kinds: ['wall'], name: 'Arrow Slit' }),
    ])

    expect(contents.groups[0]?.records.map((record) => record.name)).toEqual([
      'Arrow Slit',
      'Arrow Slit',
      'Zinc Wall',
    ])
    expect(contents.groups[0]?.records[0]?.id).toBe('tiles/fixture/tile-01.stl')
  })

  it('counts a shared md5 once — 171 corpus md5s carry 520 catalog rows', () => {
    const shared = '0000000000000000000000000000beef'
    const contents = collect([
      tile(0, { kinds: ['wall'], blob: shared, bytes: 20_000_000 }),
      tile(1, { kinds: ['floor'], blob: shared, bytes: 20_000_000 }),
      tile(2, { kinds: ['floor'], bytes: 5_000_000 }),
    ])

    // Three tiles, two files: the second row is the same STL under another path.
    expect(contents.tiles).toBe(3)
    expect(contents.files).toBe(2)
    expect(contents.size.bytes).toBe(25_000_000)
    // Both rows still render — deduping bytes must not dedupe cards.
    expect(contents.groups.reduce((sum, group) => sum + group.records.length, 0)).toBe(3)
  })

  it('carries the builder\'s own download verdict rather than a second set of thresholds', () => {
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
      kindOrder: CORPUS_ORDER,
    })

    expect(contents.missing).toEqual([stale])
    // Not counted as a tile, and not counted in the bytes it cannot describe.
    expect(contents.tiles).toBe(1)
    expect(contents.size.bytes).toBe(10_000_000)
  })

  it('is empty, not undefined, for an empty library', () => {
    const contents = collect([])

    expect(contents.groups).toEqual([])
    expect(contents.tiles).toBe(0)
    expect(contents.files).toBe(0)
    expect(contents.size.bytes).toBe(0)
    expect(contents.missing).toEqual([])
  })
})

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

describeCorpus('the whole corpus, as one library', () => {
  it('assigns every tile exactly one group', () => {
    const contents = collectLibrary({
      ids: corpus.records.map((record) => record.id),
      record: lookupOver(corpus.records),
      kindOrder: CORPUS_ORDER,
    })

    expect(contents.missing).toEqual([])
    expect(contents.tiles).toBe(corpus.records.length)
    expect(contents.groups.reduce((sum, group) => sum + group.records.length, 0)).toBe(
      corpus.records.length,
    )
  })

  it('re-derives the group sizes the precedence order is documented against', () => {
    const contents = collectLibrary({
      ids: corpus.records.map((record) => record.id),
      record: lookupOver(corpus.records),
      kindOrder: CORPUS_ORDER,
    })
    const sizes = Object.fromEntries(contents.groups.map((group) => [group.kind, group.records.length]))

    // Every base-tagged tile lands in Bases (1,963), which is the point of
    // putting `base` first: 906 of them are also walls and 116 also floors, and
    // filing those under Walls or Floors hides the base inventory. The 176
    // `floor`+`wall` rows land in Walls, which is why Floors is 1,288 and not
    // 1,464.
    expect(sizes).toEqual({
      wall: 3766,
      base: 1963,
      floor: 1288,
      [KIND_OTHER]: 1032,
      stairs: 197,
      angled: 179,
      riser: 143,
      column: 134,
    })
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

  it('deduping by md5 removes 349 rows from the byte total', () => {
    const contents = collectLibrary({
      ids: corpus.records.map((record) => record.id),
      record: lookupOver(corpus.records),
      kindOrder: CORPUS_ORDER,
    })

    // 171 md5s across 520 rows, so 349 rows are a second path to a file already
    // counted. Summing over ids would overstate the download by those 349 files.
    expect(contents.tiles).toBe(8702)
    expect(contents.files).toBe(8353)

    const naive = corpus.records.reduce((sum, record) => sum + record.bytes, 0)
    expect(contents.size.bytes).toBeLessThan(naive)
  })
})
