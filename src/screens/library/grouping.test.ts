/// <reference types="node" />
/**
 * The library's grouping rule, its resolution, and its byte total.
 *
 * Node environment: all three derivations are pure functions of catalog records
 * and a lock preference, and the properties that matter are arithmetic rather
 * than visual. The screen's rendering of them is `library.test.tsx`.
 *
 * Two levels, matching the convention in `../detail`:
 *
 *   1. **Hand-built records**, one per branch — every corpus `kinds` combination
 *      the precedence order has to decide, the shared-md5 case, and row V2's
 *      three new ones: a picture and a download that are different files, a saved
 *      design that resolves to no item, and a library whose keys are the *wrong
 *      kind of id* altogether.
 *   2. **The emitted corpus**, where the numbers in `grouping.ts`'s docblock are
 *      re-derived **per lock**. The invariant that actually matters — every item
 *      in exactly one group, so the group counts sum to the summary — is only
 *      convincing over 3,822 items. Skips loudly when the index has not been
 *      built.
 *
 * Every fixture goes through `CatalogFile.parse` and then `buildAggregateIndex`,
 * rather than through a hand-written `AggregateIndex`. A stub index would let
 * this file assert against an aggregate shape the real derivation cannot produce,
 * which is exactly the class of bug this row is exposed to: the whole row is a
 * reader of A1's output and of V5's preview rule.
 *
 * ## What these tests cannot prove
 *
 * Nothing here renders. The gap between the file a card *pictures* and the file
 * it *downloads as* is asserted as two ids and two byte figures; that the card
 * puts them in the right two places on screen is `library.test.tsx`'s job, and
 * that the sprite sheet for the pictured file actually exists is nobody's — the
 * corpus block reads the index, not the object store.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { AggregateIndex, CatalogFile, CatalogRecord, DesignId, TileId } from '@/catalog'
import {
  CatalogFile as CatalogFileSchema,
  CatalogRecord as CatalogRecordSchema,
  DesignId as DesignIdSchema,
  buildAggregateIndex,
  selectVariant,
} from '@/catalog'
import { PRINT_OPTIONS } from '@/assembly'
import { KIND_OTHER } from '@/search'
import type { WorkshopState } from '@/store'
import { LockSystem, libraryDesigns } from '@/store'

import type { LibraryContents } from './grouping'
import { KIND_PRECEDENCE, collectLibrary, groupKindOf, roundBytesLabel, totalBytesLabel } from './grouping'

/* --------------------------------------------------- the key, at type level */

/**
 * Four compile-time assertions about the library key, and they are this row's
 * most valuable guard because the failure they prevent is invisible at runtime.
 *
 * A wrong key does not throw. Every entry resolves to no aggregate, every item
 * lands in {@link LibraryContents.missing}, and the screen renders a plausible
 * "N saved tiles are not in this build of the catalog" — which is precisely the
 * shape that let 29 of this directory's 31 screen assertions pass against a
 * library the store can no longer hold. So the guard has to be in the type
 * system, and it has to sit where a brand actually survives. Verified with `tsc`:
 *
 *   - `Readonly<Record<TileId, true>>` **is** assignable to
 *     `Readonly<Record<DesignId, true>>` — a branded string is not a literal
 *     union, so `Record` collapses to an index signature and the brand is gone
 *     from the key position. A function taking the library *map* checks nothing.
 *   - `readonly TileId[]` and `Iterable<TileId>` are **not** assignable to their
 *     `DesignId` equivalents. The array and the iterable are the safe positions,
 *     which is why {@link collectLibrary} takes one and {@link libraryDesigns}
 *     exists to produce it.
 *
 * Deliberately **not** inside an `it`: a `@ts-expect-error` is checked by `tsc`
 * and not by the runner, so an `it` wrapping these would be a passing test
 * proving nothing. `TS2578: Unused '@ts-expect-error' directive` is the failure
 * mode — the build breaks the day one of these shapes starts compiling again.
 * (It fired for real while this block was being written, on a directive placed a
 * line too high: it suppresses only the line beneath it, so the one inside the
 * object literal has to sit against the `ids:` property.)
 *
 * Wrapped in a function that is never called, and that is not decoration either.
 * A `declare const` has no runtime value, so at module scope
 * `libraryDesigns(fileKeyedLibrary)` would be `Object.keys(undefined)` and would
 * throw on import, taking the whole file with it. The body is typechecked and
 * never executed.
 */
declare const fileKeyedLibrary: Readonly<Record<TileId, true>>
declare const storeLibrary: WorkshopState['library']
declare const anyIndex: AggregateIndex

const libraryKeyGuards = (): void => {
  // The positive control. Without it the three rejections below would still pass
  // if the parameter had been narrowed to something nothing satisfies.
  const accepted: Iterable<DesignId> = libraryDesigns(storeLibrary)
  void accepted

  // @ts-expect-error a file-keyed map infers `TileId[]`, which `DesignId` refuses
  const rejected: Iterable<DesignId> = libraryDesigns(fileKeyedLibrary)
  void rejected

  collectLibrary({
    // @ts-expect-error and the same shape is refused at the real call site
    ids: libraryDesigns(fileKeyedLibrary),
    record: () => undefined,
    aggregates: anyIndex,
    preference: {},
    kindOrder: [],
  })

  // @ts-expect-error the raw map is not an iterable at all, whatever its key type
  const rawMap: Iterable<DesignId> = storeLibrary
  void rawMap
}

void libraryKeyGuards

/* ------------------------------------------------------------------ fixtures */

/**
 * The tag vocabulary every fixture file carries.
 *
 * Interned rather than written per record because that is how a real
 * `CatalogFile` carries them — and because `TileVariant.bottomConn` is derived
 * from these strings and not from `CatalogRecord.conn`. A fixture that set only
 * `conn` would give every variant an empty `bottomConn`, and then `selectVariant`
 * would answer `unknown-joinery` for everything and this file would be asserting
 * against a corpus that does not exist.
 */
const FIXTURE_TAGS = [
  'connection|openlock',
  'connection|openforge',
  'connection|dragonlock',
  'connection|side|openlock',
] as const

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
    thumb: false,
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
    tags: [...FIXTURE_TAGS],
    records,
  })
}

/** The lookup `collectLibrary` takes, over a list of records. */
function lookupOver(records: readonly CatalogRecord[]): (id: TileId) => CatalogRecord | undefined {
  const byId = new Map(records.map((record) => [record.id as string, record]))
  return (id) => byId.get(id)
}

/** The designs in a record list, deduplicated, in first-seen order. */
function designsOf(records: readonly CatalogRecord[]): DesignId[] {
  return [...new Set(records.map((record) => record.design))]
}

/**
 * Collect a library holding **every design** in a record list.
 *
 * The lock is a parameter with an explicit default rather than a hidden one:
 * every figure this module produces except the group counts is a function of it,
 * and a helper that concealed that would let a test claim a byte total without
 * saying which build it belongs to.
 */
function collect(
  records: readonly CatalogRecord[],
  { lock = 'openlock', kindOrder = CORPUS_ORDER }: { lock?: string; kindOrder?: readonly string[] } = {},
): LibraryContents {
  return collectLibrary({
    ids: designsOf(records),
    record: lookupOver(records),
    aggregates: buildAggregateIndex(fileOf(records)),
    preference: { bottom: lock, options: PRINT_OPTIONS },
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

    // Three items, two of them resolving to one STL filed under another path.
    expect(contents.items).toBe(3)
    expect(contents.files).toBe(2)
    expect(contents.size.bytes).toBe(25_000_000)
    // All three still render — deduping bytes must not dedupe cards.
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

  it('collapses a design named twice, because the parameter is an iterable and an array can repeat', () => {
    const records = [tile(0, { kinds: ['wall'] })]
    const design = records[0]?.design as DesignId
    const contents = collectLibrary({
      ids: [design, design],
      record: lookupOver(records),
      aggregates: buildAggregateIndex(fileOf(records)),
      preference: { bottom: 'openlock', options: PRINT_OPTIONS },
      kindOrder: CORPUS_ORDER,
    })

    // One card and one file's worth of bytes, not two. The store's own keys
    // cannot repeat, so this is a property of the signature rather than of the
    // app — and the signature is what `grouping.test` and the palette call.
    expect(contents.items).toBe(1)
    expect(contents.files).toBe(1)
    expect(contents.size.bytes).toBe(10_000_000)
  })

  it('is empty, not undefined, for an empty library', () => {
    const contents = collect([])

    expect(contents.groups).toEqual([])
    expect(contents.items).toBe(0)
    expect(contents.files).toBe(0)
    expect(contents.needsBase).toBe(0)
    expect(contents.size.bytes).toBe(0)
    expect(contents.missing).toEqual([])
  })
})

/* -------------------------------------------------------------- missing keys */

describe('a saved design the catalog cannot resolve', () => {
  it('is reported rather than silently skipped, and costs no bytes', () => {
    const records = [tile(0, { kinds: ['wall'] })]
    const stale = DesignIdSchema.parse('d0000deadbeef')
    const contents = collectLibrary({
      ids: [records[0]?.design as DesignId, stale],
      record: lookupOver(records),
      aggregates: buildAggregateIndex(fileOf(records)),
      preference: { bottom: 'openlock', options: PRINT_OPTIONS },
      kindOrder: CORPUS_ORDER,
    })

    expect(contents.missing).toEqual([stale])
    expect(contents.items).toBe(1)
    expect(contents.size.bytes).toBe(10_000_000)
  })

  it('puts an entire file-keyed library in `missing`, which is the failure this key can have', () => {
    // Row V1's warning, made a test. `DesignId` is `z.string().min(1)`, so it
    // *accepts* a `TileId` — the type system stops a call to `addToLibrary`, and
    // nothing stops a value that got into the map another way (a hand-edited
    // export, a preview build). Under this key every such entry resolves to no
    // aggregate, so the whole library lands here and the screen says so, rather
    // than rendering an empty page that looks like a lost library.
    const records = [tile(0, { kinds: ['wall'] }), tile(1, { kinds: ['floor'] })]
    const fileKeys = records.map((record) => DesignIdSchema.parse(record.id))
    const contents = collectLibrary({
      ids: fileKeys,
      record: lookupOver(records),
      aggregates: buildAggregateIndex(fileOf(records)),
      preference: { bottom: 'openlock', options: PRINT_OPTIONS },
      kindOrder: CORPUS_ORDER,
    })

    expect(contents.items).toBe(0)
    expect(contents.groups).toEqual([])
    expect(contents.missing).toEqual([...fileKeys].sort())
    expect(contents.size.bytes).toBe(0)
  })

  it('reports an item whose preview record the lookup does not hold', () => {
    // `record` and `aggregates` are two independent arguments and nothing forces
    // them to agree: this is the mixed pair, an index over one catalog with a
    // lookup over another. A card needs the preview record for its thumbnail and
    // its material tint, so the honest answer is `missing` rather than a card
    // with a hole in it.
    const indexed = [tile(0, { kinds: ['wall'] })]
    const other = [tile(1, { kinds: ['wall'] })]
    const contents = collectLibrary({
      ids: designsOf(indexed),
      record: lookupOver(other),
      aggregates: buildAggregateIndex(fileOf(indexed)),
      preference: { bottom: 'openlock', options: PRINT_OPTIONS },
      kindOrder: CORPUS_ORDER,
    })

    expect(contents.items).toBe(0)
    expect(contents.missing).toEqual(designsOf(indexed))
  })
})

/* -------------------------------------------- the picture and the download */

/**
 * One design, two ways to print it — the shape row V2 exists for.
 *
 * A `topper` on `connection|openforge` and an `integral` on
 * `connection|openlock`, which is exactly the 931-aggregate mixed pair. The two
 * rules disagree about it *by design*: `TileAggregate.preview` prefers the
 * sprite-carrying topper (the tile alone), and `selectVariant` prefers one part
 * over two. So under openlock the card pictures the topper and downloads the
 * integral, and under dragonlock — which the integral does not offer — it
 * pictures and downloads the same topper and needs a base for it.
 */
const PAIR = [
  tile(0, {
    kinds: ['wall'],
    name: 'Arrow Slit',
    design: 'dpair',
    file: 'arrow_slit.2x.openforge.stl',
    layer: 'topper',
    conn: ['openforge'],
    tags: [1],
    bytes: 12_000_000,
  }),
  tile(1, {
    kinds: ['wall'],
    name: 'Arrow Slit',
    design: 'dpair',
    file: 'arrow_slit.2x.openlock.stl',
    layer: 'integral',
    conn: ['openlock'],
    tags: [0],
    bytes: 18_000_000,
  }),
] as const

describe('an item whose picture and download are different files', () => {
  it('pictures the topper and downloads the one-part print under openlock', () => {
    const contents = collect([...PAIR], { lock: 'openlock' })
    const [entry] = allItems(contents)

    expect(contents.items).toBe(1)
    // The picture is `TileAggregate.preview` — V5's sprite-carrying topper.
    expect(entry?.preview.id).toBe(PAIR[0].id)
    expect(entry?.item.preview).toBe(PAIR[0].id)
    // The download is the integral, because openlock is on its underside and one
    // part beats two.
    expect(entry?.resolved.id).toBe(PAIR[1].id)
    expect(entry?.verdict).toBe('self-sufficient')
    // And this is the reason the field exists: the two files are different sizes,
    // which the corpus says is true of *every* item where they differ.
    expect(entry?.preview.bytes).toBe(12_000_000)
    expect(entry?.resolved.bytes).toBe(18_000_000)
  })

  it('states the resolution’s bytes in the total, not the picture’s', () => {
    expect(collect([...PAIR], { lock: 'openlock' }).size.bytes).toBe(18_000_000)
    // Under dragonlock the integral is not on offer, so the topper is both the
    // picture and the download — and the total moves with it.
    expect(collect([...PAIR], { lock: 'dragonlock' }).size.bytes).toBe(12_000_000)
  })

  it('falls back to the topper and reports the base under a lock the item does not offer', () => {
    const contents = collect([...PAIR], { lock: 'dragonlock' })
    const [entry] = allItems(contents)

    expect(entry?.resolved.id).toBe(PAIR[0].id)
    expect(entry?.verdict).toBe('needs-base')
    // The count `LibraryNotes` states once, rather than a caveat per card.
    expect(contents.needsBase).toBe(1)
    // The same library under openlock owes no base at all.
    expect(collect([...PAIR], { lock: 'openlock' }).needsBase).toBe(0)
  })

  it('keeps the preview even when the item’s only sprite is on the file it will not print', () => {
    // The one live case tier 2 of V5's rule exists for: a spriteless winner would
    // blank the card. `selectVariant` does not read `sprite` at all, so the card
    // must be free to picture one file and print another — which is what the two
    // fields are.
    const records = [
      tile(0, { ...variantFields(PAIR[0]), sprite: true }),
      tile(1, { ...variantFields(PAIR[1]), sprite: false }),
    ]
    const [entry] = allItems(collect(records, { lock: 'openlock' }))

    expect(entry?.preview.sprite).toBe(true)
    expect(entry?.preview.id).toBe(records[0]?.id)
    expect(entry?.resolved.id).toBe(records[1]?.id)
    expect(entry?.resolved.sprite).toBe(false)
  })

  it('dedupes on the file it resolves to, not on the file it pictures', () => {
    // Design `dpair` shares its *integral*'s mesh with a second item. Under
    // openlock the resolution is that integral, so the library is one file; under
    // dragonlock it is the topper, so it is two. A dedupe that ran over previews
    // would report two in both cases and overstate the openlock download.
    const shared = '0000000000000000000000000000cafe'
    const records = [
      tile(0, { ...variantFields(PAIR[0]), bytes: 12_000_000 }),
      tile(1, { ...variantFields(PAIR[1]), blob: shared, bytes: 18_000_000 }),
      tile(2, { kinds: ['floor'], blob: shared, bytes: 18_000_000 }),
    ]

    const openlock = collect(records, { lock: 'openlock' })
    expect(openlock.items).toBe(2)
    expect(openlock.files).toBe(1)
    expect(openlock.size.bytes).toBe(18_000_000)

    const dragonlock = collect(records, { lock: 'dragonlock' })
    expect(dragonlock.items).toBe(2)
    expect(dragonlock.files).toBe(2)
    expect(dragonlock.size.bytes).toBe(30_000_000)
  })

  it('resolves a singleton item to its one file whatever the lock', () => {
    // 2,117 of 3,822 aggregates are singletons, so this is the common card and it
    // must not depend on the preference at all.
    for (const lock of LockSystem.options) {
      const [entry] = allItems(collect([tile(0, { kinds: ['wall'] })], { lock }))
      expect(entry?.resolved.id).toBe('tiles/fixture/tile-00.stl')
      expect(entry?.preview.id).toBe('tiles/fixture/tile-00.stl')
    }
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
    tags: [...record.tags],
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

/**
 * The corpus lookup, built **once**.
 *
 * `lookupOver` interns 8,702 records into a `Map`, so calling it inside a loop
 * over 3,822 aggregates is quadratic and times the block out — which is how this
 * was first written.
 */
const corpusRecord = loaded === undefined ? undefined : lookupOver(corpus.records)

/** The whole corpus saved, under one lock. */
function collectCorpus(lock: string): LibraryContents {
  return collectLibrary({
    ids: (corpusAggregates as AggregateIndex).aggregates.map((aggregate) => aggregate.design),
    record: corpusRecord as (id: TileId) => CatalogRecord | undefined,
    aggregates: corpusAggregates as AggregateIndex,
    preference: { bottom: lock, options: PRINT_OPTIONS },
    kindOrder: CORPUS_ORDER,
  })
}

describeCorpus('the whole corpus, as one library', () => {
  it('assigns every item exactly one group, whatever the lock', () => {
    for (const lock of LockSystem.options) {
      const contents = collectCorpus(lock)
      expect(contents.missing).toEqual([])
      expect(contents.items).toBe(3822)
      expect(allItems(contents)).toHaveLength(contents.items)
    }
  })

  it('re-derives the group sizes the precedence order is documented against', () => {
    const contents = collectCorpus('openlock')
    const sizes = Object.fromEntries(contents.groups.map((group) => [group.kind, group.items.length]))

    // Item counts, and unchanged by the key or the lock: bases are 340 and that
    // is exactly A1's `base-only` class count, which is the measurement behind "a
    // base never shares a group with anything else" — `shape|base` is in the
    // design key, so a base is always its own design and aggregation never merges
    // one into the tile it supports.
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

  it('downloads a different file from the one it pictures, on up to 42.2% of items', () => {
    // The measurement the whole row turns on, and the one figure a correct-looking
    // total hides: the per-item counts below against a sum that is right to 0.1%.
    const record = corpusRecord as (id: TileId) => CatalogRecord | undefined
    const differ: Record<string, number> = {}
    let sameBytes = 0
    for (const lock of LockSystem.options) {
      let count = 0
      for (const item of (corpusAggregates as AggregateIndex).aggregates) {
        const resolved = selectVariant(item, { bottom: lock, options: PRINT_OPTIONS }).variant
        if (resolved.id === item.preview) continue
        count += 1
        // Not one of them is a coincidence of equal sizes, which is what makes
        // "size the picture" wrong rather than merely imprecise.
        if (resolved.bytes === record(item.preview)?.bytes) sameBytes += 1
      }
      differ[lock] = count
    }

    expect(differ).toEqual({ openlock: 1611, dragonlock: 609, magnetic: 1055 })
    expect(differ.openlock as number).toBeGreaterThan(3822 * 0.42)
    expect(sameBytes).toBe(0)
  })

  it('re-derives the per-lock byte total, file count and base count', () => {
    // `previewSum` is what the cards would add up to if each sized its own
    // picture — 54.60 GB, against the 54.56 / 54.39 / 53.68 GB the resolutions
    // add up to before the md5 dedupe and the 54.28 / 54.12 / 53.39 GB asserted
    // below after it. Within 0.1% of the openlock answer and wrong on 1,611
    // individual cards, which is the whole argument for asserting both.
    const record = corpusRecord as (id: TileId) => CatalogRecord | undefined
    const previewSum = (corpusAggregates as AggregateIndex).aggregates.reduce(
      (sum, item) => sum + (record(item.preview)?.bytes ?? 0),
      0,
    )
    expect(previewSum).toBe(54_601_429_273)

    const expected = {
      openlock: { bytes: 54_279_145_298, files: 3786, needsBase: 2137 },
      dragonlock: { bytes: 54_123_495_224, files: 3790, needsBase: 3062 },
      magnetic: { bytes: 53_393_773_473, files: 3788, needsBase: 3068 },
    } as const

    for (const lock of LockSystem.options) {
      const contents = collectCorpus(lock)
      expect({ bytes: contents.size.bytes, files: contents.files, needsBase: contents.needsBase }).toEqual(
        expected[lock],
      )
      // The surviving md5 collision: two *different* items resolving to one
      // file. 36 rows of 3,822 under openlock, against the 349 the file-keyed
      // library deduped — smaller, and still not nothing.
      expect(contents.items - contents.files).toBeGreaterThan(0)
      expect(contents.items - contents.files).toBeLessThan(40)
      // A majority of items print as a topper under every lock, so the total is
      // one file of two for most of the library and `LibraryNotes` says so.
      expect(contents.needsBase / contents.items).toBeGreaterThan(0.5)
    }
  })
})
