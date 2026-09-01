/**
 * The engine against a synthetic corpus, checked against `oracle.ts`.
 *
 * This suite runs everywhere, including in CI where the `openforge-catalog`
 * fixtures are not available and `public/catalog/catalog.json` therefore does not
 * exist. `corpus.test.ts` re-runs the same comparison over the real 8,702-tile
 * corpus when it does.
 *
 * The fixture is a full cross product — 9 texture shapes × 6 kind shapes × 4
 * build states × 5 connection shapes = 1,080 tiles — because the property under
 * test is about *combinations* of filters. Every corner the real corpus has that
 * a naive facet implementation gets wrong is represented deliberately:
 *
 *   - a tile in **two** kind buckets, and a tile in **none**;
 *   - a texture tag **nested two deep** (`texture|cave|sandstone`), so prefix
 *     matching has something to match;
 *   - two roots where one is a **string prefix of the other but not a namespace
 *     prefix** (`stone` / `stone_brick`, `cave` / `cavern`);
 *   - a tile carrying **two** texture roots where the second is alphabetically
 *     later (`towne` + `stucco`) — the shape that makes `record.texture` a
 *     37-value field over a 38-root vocabulary;
 *   - tiles with **no** build tag, and tiles with **no** connection tag;
 *   - a `wall` token that appears only in a **tag** (`build|separate wall`) on
 *     tiles that are floors, which is the ranking trap.
 */
import { describe, expect, it } from 'vitest'

import type { BlobId, CatalogFile, CatalogRecord, DesignId, ManifestOrdinal, TagId, TileId } from '@/catalog'
import { CatalogFile as CatalogFileSchema, MEASURED_SPRITE_SHEET } from '@/catalog'

import { createSearchEngine } from './engine'
import { FACET_KEYS, KIND_OTHER } from './facets'
import type { FacetKey } from './facets'
import { buildOracle, oracleCount, oracleIds } from './oracle'
import { BUILD_UNSPECIFIED, buildSystemFilter, defaultFacetSearch } from './searchSchema'
import type { FacetSearch } from './searchSchema'

/* ------------------------------------------------------------------- fixture */

const TEXTURE_SHAPES: readonly (readonly string[])[] = [
  ['texture|dungeon_stone'],
  ['texture|dungeon_stone|eroded'],
  ['texture|cave'],
  ['texture|cave|sandstone'],
  ['texture|cavern'],
  ['texture|stone'],
  ['texture|stone_brick'],
  ['texture|towne', 'texture|stucco'],
  [],
]

const KIND_SHAPES: readonly (readonly string[])[] = [[], ['floor'], ['wall'], ['floor', 'wall'], ['base'], ['stairs']]

const BUILD_SHAPES: readonly (string | undefined)[] = [undefined, 'separate wall', 'wall on tile', 's2w']

const CONNECTION_SHAPES: readonly (readonly string[])[] = [
  [],
  ['openlock'],
  ['openforge'],
  ['openlock', 'magnetic'],
  ['dragonlock'],
]

/** Title-case a tag segment the way `pipeline/naming.ts` does. */
function words(segment: string): string[] {
  return segment.split(/[|_-]/).map((part) => part.charAt(0).toUpperCase() + part.slice(1))
}

function synthesise(): CatalogFile {
  const intern = new Map<string, number>()
  const tagTable: string[] = []
  const tagId = (tag: string): TagId => {
    const existing = intern.get(tag)
    if (existing !== undefined) return existing as TagId
    intern.set(tag, tagTable.length)
    tagTable.push(tag)
    return (tagTable.length - 1) as TagId
  }

  const records: CatalogRecord[] = []
  let ord = 0

  for (const textures of TEXTURE_SHAPES) {
    for (const kinds of KIND_SHAPES) {
      for (const build of BUILD_SHAPES) {
        for (const conn of CONNECTION_SHAPES) {
          const w = 1 + (ord % 4)
          const d = 1 + (Math.floor(ord / 4) % 4)
          const tags = [
            ...textures,
            ...kinds.map((kind) => `shape|${kind}`),
            ...conn.map((system) => `connection|${system}`),
            ...(build === undefined ? [] : [`build|${build}`]),
            `size|width|${String(w)}`,
            `size|depth|${String(d)}`,
          ]
          const name = [
            ...(textures[0]?.split('|').slice(1).flatMap(words) ?? []),
            ...kinds.flatMap(words),
            `${String(w)}x${String(d)}`,
          ].join(' ')
          const file = `${name.toLowerCase().replaceAll(' ', '_')}.${String(ord)}.stl`

          records.push({
            id: `tiles/synthetic/${String(ord)}/${file}` as TileId,
            ord: ord as ManifestOrdinal,
            blob: ord.toString(16).padStart(32, '0') as BlobId,
            file,
            bytes: 1_000 + ord,
            sprite: true,
            family: `tiles/synthetic/${String(TEXTURE_SHAPES.indexOf(textures))}`,
            design: `design-${String(ord)}` as DesignId,
            name: name === '' ? file : name,
            kinds: [...kinds],
            conn: [...conn],
            ...(build === undefined ? {} : { build }),
            layer: kinds.includes('base') ? 'base' : conn.includes('openforge') ? 'topper' : 'integral',
            ...(textures[0] === undefined ? {} : { texture: textures[0].split('|')[1] }),
            tags: tags.map(tagId),
            foot: { shape: 'rect', w, d },
          })
          ord++
        }
      }
    }
  }

  return CatalogFileSchema.parse({
    version: {
      schema: 1,
      pipeline: 1,
      fixtures: 'synthetic',
      manifest: 1,
      built: '2026-01-01T00:00:00.000Z',
    },
    assets: {
      models: 'https://objects.example/models/',
      sprites: 'https://objects.example/sprites/',
      thumbs: 'https://objects.example/thumbs/',
    },
    sprite: MEASURED_SPRITE_SHEET,
    tags: tagTable,
    records,
  })
}

const file = synthesise()
const engine = createSearchEngine(file)
const oracle = buildOracle(file)

function search(overrides: Partial<FacetSearch> = {}): FacetSearch {
  return { ...defaultFacetSearch(), ...overrides }
}

/* -------------------------------------------------------------------- the set */

describe('the fixture covers the corners it claims to', () => {
  it('has tiles in two kind buckets and tiles in none', () => {
    expect(file.records.some((record) => record.kinds.length >= 2)).toBe(true)
    expect(file.records.some((record) => record.kinds.length === 0)).toBe(true)
  })

  it('has a tile whose second texture root never reaches `record.texture`', () => {
    const twoRoots = file.records.filter((record) =>
      record.tags.map((tag) => file.tags[tag]).some((tag) => tag === 'texture|stucco'),
    )
    expect(twoRoots.length).toBeGreaterThan(0)
    expect(twoRoots.every((record) => record.texture === 'towne')).toBe(true)
  })
})

/* ---------------------------------------------------------- results and order */

describe('results', () => {
  it('returns everything for an empty search', () => {
    const result = engine.search(search())
    expect(result.total).toBe(file.records.length)
    expect(result.ids).toHaveLength(file.records.length)
  })

  it('orders an unfiltered search by manifest ordinal', () => {
    const result = engine.search(search())
    const ords = result.ids.map((id) => engine.record(id)?.ord ?? -1)
    expect(ords).toEqual([...ords].sort((a, b) => a - b))
  })

  it('is deterministic: the same search twice gives the same order', () => {
    const first = engine.search(search({ q: 'wall stone' }))
    const second = engine.search(search({ q: 'wall stone' }))
    expect(second.ids).toEqual(first.ids)
  })

  it('is deterministic across engines built from the same file', () => {
    const other = createSearchEngine(file)
    expect(other.search(search({ q: 'cave 2x2' })).ids).toEqual(engine.search(search({ q: 'cave 2x2' })).ids)
  })

  it('resolves every returned id back to a record', () => {
    for (const id of engine.search(search({ kinds: ['stairs'] })).ids) {
      expect(engine.record(id)).toBeDefined()
    }
  })

  it('matches the oracle on ids and order', () => {
    for (const state of [
      search(),
      search({ q: 'wall' }),
      search({ q: 'dungeon stone' }),
      search({ q: 'cave 2x2', conn: ['openlock'] }),
      search({ kinds: ['floor', 'wall'], build: buildSystemFilter('s2w') }),
      search({ tex: ['cave'], conn: ['openlock', 'magnetic'] }),
    ]) {
      expect(engine.search(state).ids).toEqual(oracleIds(oracle, state))
    }
  })
})

/* ------------------------------------------------------- disjunctive counting */

/**
 * The combinations the disjunctive property is checked over.
 *
 * Deliberately includes states with two and three facets active at once: with a
 * single facet selected, the naive "count against the fully filtered set"
 * implementation is *right* for the three facets it does not touch, so a
 * one-facet test passes against a broken engine.
 */
const COMBINATIONS: readonly FacetSearch[] = [
  search(),
  search({ kinds: ['wall'] }),
  search({ kinds: ['wall', 'floor'] }),
  search({ kinds: [KIND_OTHER] }),
  search({ tex: ['cave'] }),
  search({ tex: ['cave', 'stone'] }),
  search({ tex: ['cave|sandstone'] }),
  search({ build: BUILD_UNSPECIFIED }),
  search({ build: buildSystemFilter('separate wall') }),
  search({ conn: ['openlock'] }),
  search({ conn: ['openlock', 'dragonlock'] }),
  search({ kinds: ['wall'], tex: ['cave'] }),
  search({ kinds: ['floor'], tex: ['dungeon_stone'], conn: ['openforge'] }),
  search({ kinds: ['base'], tex: ['towne'], build: BUILD_UNSPECIFIED, conn: ['magnetic'] }),
  search({ q: 'wall', kinds: ['floor'], tex: ['cave'] }),
  search({ q: '2x2', build: buildSystemFilter('s2w'), conn: ['openlock'] }),
]

describe('disjunctive facet counts', () => {
  it('matches a brute-force oracle for every value of every facet', () => {
    for (const state of COMBINATIONS) {
      const result = engine.search(state)
      for (const key of FACET_KEYS) {
        for (const bucket of result.facets[key]) {
          expect(bucket.count, `${key}=${bucket.value} under ${JSON.stringify(state)}`).toBe(
            oracleCount(oracle, state, key, bucket.value),
          )
        }
      }
    }
  })

  it('keeps the other values of a facet reachable once one is selected', () => {
    // The dead-end bug: counting against the fully filtered set makes every
    // unselected texture read zero the moment one is selected, and the user's
    // only legal next click is undo.
    const unfiltered = engine.search(search())
    const selected = engine.search(search({ tex: ['dungeon_stone'] }))
    const cave = (key: FacetKey, result: ReturnType<typeof engine.search>): number =>
      result.facets[key].find((bucket) => bucket.value === 'cave')?.count ?? -1

    expect(cave('tex', unfiltered)).toBeGreaterThan(0)
    expect(cave('tex', selected)).toBe(cave('tex', unfiltered))
  })

  it('narrows the other facets when one is selected', () => {
    const unfiltered = engine.search(search())
    const selected = engine.search(search({ tex: ['cave'] }))
    const walls = (result: ReturnType<typeof engine.search>): number =>
      result.facets.kinds.find((bucket) => bucket.value === 'wall')?.count ?? -1

    expect(walls(selected)).toBeGreaterThan(0)
    expect(walls(selected)).toBeLessThan(walls(unfiltered))
  })

  it('applies the text query to every facet count', () => {
    // The query is not a facet, so unlike a facet's own filter it constrains
    // that facet's counts too. `stairs` keeps its whole bucket; `floor` loses all
    // of it, because no floor tile carries the token.
    const withQuery = engine.search(search({ q: 'stairs' }))
    const withoutQuery = engine.search(search())
    const bucket = (result: ReturnType<typeof engine.search>, value: string): number =>
      result.facets.kinds.find((entry) => entry.value === value)?.count ?? -1

    expect(bucket(withQuery, 'stairs')).toBe(bucket(withoutQuery, 'stairs'))
    expect(bucket(withQuery, 'floor')).toBe(0)
    expect(bucket(withoutQuery, 'floor')).toBeGreaterThan(0)
  })

  it('offers a stable, query-independent value order', () => {
    const order = (state: FacetSearch): string[] => engine.search(state).facets.tex.map((bucket) => bucket.value)
    expect(order(search({ q: 'cave' }))).toEqual(order(search()))
    expect(order(search({ kinds: ['stairs'] }))).toEqual(order(search()))
  })
})

/* ------------------------------------------------------------ facet semantics */

describe('kinds — multi-select OR with an explicit other bucket', () => {
  it('unions the selected buckets', () => {
    const floors = engine.search(search({ kinds: ['floor'] })).total
    const walls = engine.search(search({ kinds: ['wall'] })).total
    const both = engine.search(search({ kinds: ['floor', 'wall'] })).total

    expect(both).toBeLessThan(floors + walls) // the tiles in both buckets
    expect(both).toBeGreaterThan(Math.max(floors, walls))
  })

  it('reaches the tiles that are in no bucket, and only those', () => {
    const result = engine.search(search({ kinds: [KIND_OTHER] }))
    expect(result.total).toBeGreaterThan(0)
    for (const id of result.ids) expect(engine.record(id)?.kinds).toEqual([])
  })

  it('counts every tile exactly once across the buckets plus other', () => {
    const buckets = engine.search(search()).facets.kinds
    const multi = file.records.filter((record) => record.kinds.length >= 2).length
    const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0)
    // Over-count is exactly the tiles in two buckets, which is the fact that
    // makes `kinds` an array rather than a value.
    expect(total).toBe(file.records.length + multi)
  })
})

describe('tex — prefix matching over texture roots', () => {
  it('matches a root and everything nested under it', () => {
    const result = engine.search(search({ tex: ['cave'] }))
    const tags = result.ids.flatMap((id) => engine.record(id)?.tags.map((tag) => file.tags[tag]) ?? [])
    expect(tags).toContain('texture|cave')
    expect(tags).toContain('texture|cave|sandstone')
  })

  it('does not match a root that merely starts with the same letters', () => {
    // `cavern` is not a child of `cave`, and `stone_brick` is not a child of
    // `stone`. Prefixes are matched on namespace segments, which is the facet-side
    // spelling of the substring trap the tokeniser fixes for queries.
    const cave = engine.search(search({ tex: ['cave'] }))
    for (const id of cave.ids) expect(engine.record(id)?.texture).not.toBe('cavern')

    const stone = engine.search(search({ tex: ['stone'] }))
    for (const id of stone.ids) expect(engine.record(id)?.texture).not.toBe('stone_brick')
  })

  it('filters at a deeper path too', () => {
    const deep = engine.search(search({ tex: ['cave|sandstone'] }))
    const shallow = engine.search(search({ tex: ['cave'] }))
    expect(deep.total).toBeGreaterThan(0)
    expect(deep.total).toBeLessThan(shallow.total)
  })

  it('offers every root in the tag table, including one no record reports', () => {
    // The 37-versus-38 fact in miniature: `stucco` is always the alphabetically
    // later of two roots, so it never wins `record.texture` — but it is a real
    // root that a real user will click, and matching on tags gives it a count.
    expect(engine.vocabulary.tex).toContain('stucco')
    const result = engine.search(search({ tex: ['stucco'] }))
    expect(result.total).toBeGreaterThan(0)
    for (const id of result.ids) expect(engine.record(id)?.texture).toBe('towne')
  })

  it('does not offer the nested paths as top-level values', () => {
    expect(engine.vocabulary.tex).not.toContain('cave|sandstone')
    expect(engine.vocabulary.tex).toContain('cave')
  })
})

describe('build — single-select with a first-class unspecified', () => {
  it('filters for the tiles that carry no build tag', () => {
    const result = engine.search(search({ build: BUILD_UNSPECIFIED }))
    expect(result.total).toBeGreaterThan(0)
    for (const id of result.ids) expect(engine.record(id)?.build).toBeUndefined()
  })

  it('offers unspecified as a value with a count', () => {
    const bucket = engine.search(search()).facets.build.find((entry) => entry.value === BUILD_UNSPECIFIED)
    expect(bucket?.count).toBe(file.records.filter((record) => record.build === undefined).length)
  })

  it('distinguishes unspecified from no filter', () => {
    expect(engine.search(search({ build: BUILD_UNSPECIFIED })).total).toBeLessThan(
      engine.search(search()).total,
    )
  })

  it('filters for one system', () => {
    const result = engine.search(search({ build: buildSystemFilter('s2w') }))
    expect(result.total).toBeGreaterThan(0)
    for (const id of result.ids) expect(engine.record(id)?.build).toBe('s2w')
  })

  it('partitions the corpus — the counts sum to every tile', () => {
    const total = engine.search(search()).facets.build.reduce((sum, bucket) => sum + bucket.count, 0)
    expect(total).toBe(file.records.length)
  })
})

describe('conn — multi-select OR', () => {
  it('unions the selected systems and reaches the multi-system tiles from either', () => {
    const openlock = engine.search(search({ conn: ['openlock'] }))
    const magnetic = engine.search(search({ conn: ['magnetic'] }))
    const both = engine.search(search({ conn: ['openlock', 'magnetic'] }))

    expect(both.total).toBe(openlock.total) // every magnetic tile here is also openlock
    for (const id of magnetic.ids) expect(openlock.ids).toContain(id)
  })
})

/* -------------------------------------------------------------------- ranking */

describe('ranking', () => {
  it('puts a name match above a tag-only match', () => {
    // `wall` sits in `build|separate wall` and `build|wall on tile`, on floors as
    // well as walls. Unweighted, a search for walls opens on floors.
    const result = engine.search(search({ q: 'wall' }))
    const first = engine.record(result.ids[0] ?? ('' as TileId))
    expect(first?.name.toLowerCase()).toContain('wall')

    const tagOnly = result.ids.findIndex((id) => !(engine.record(id)?.name.toLowerCase().includes('wall') ?? true))
    const nameLast = result.ids.reduce(
      (last, id, index) => (engine.record(id)?.name.toLowerCase().includes('wall') ? index : last),
      -1,
    )
    expect(tagOnly).toBeGreaterThan(-1)
    expect(tagOnly).toBeGreaterThan(nameLast - result.ids.length) // sanity: both groups present
    expect(nameLast).toBeLessThan(tagOnly)
  })

  it('breaks score ties by manifest ordinal', () => {
    const result = engine.search(search({ q: 'stairs' }))
    const ords = result.ids.map((id) => engine.record(id)?.ord ?? -1)
    // Every hit scores identically here, so the whole list must be ordinal-ordered.
    expect(ords).toEqual([...ords].sort((a, b) => a - b))
  })
})

/* --------------------------------------------------------- queries and garbage */

describe('text queries', () => {
  it('answers a multi-word query with the intersection', () => {
    const both = engine.search(search({ q: 'cave wall' }))
    expect(both.total).toBeGreaterThan(0)
    for (const id of both.ids) {
      const record = engine.record(id)
      const searchable = [record?.name ?? '', record?.file ?? '', ...(record?.tags.map((tag) => file.tags[tag]) ?? [])]
        .join(' ')
        .toLowerCase()
      // Both tokens, in any field — which is what an intersection means when the
      // fields are a name, a filename and a tag list.
      expect(searchable).toContain('wall')
      expect(searchable).toContain('cave')
    }
    expect(both.total).toBeLessThan(engine.search(search({ q: 'wall' })).total)
  })

  it('finds the synthesised size token', () => {
    const result = engine.search(search({ q: '2x2' }))
    expect(result.total).toBeGreaterThan(0)
    for (const id of result.ids) expect(engine.record(id)?.name).toContain('2x2')
  })

  it('does not match `cave` against `concave`-style neighbours', () => {
    const cave = engine.search(search({ q: 'cave' }))
    for (const id of cave.ids) {
      const record = engine.record(id)
      expect(record?.texture).not.toBe('cavern')
    }
  })

  it('prefix-matches a token the corpus does not know', () => {
    // `cav` is not a token, so it expands — and then it *does* reach cavern.
    const result = engine.search(search({ q: 'cav' }))
    expect(result.total).toBeGreaterThan(engine.search(search({ q: 'cave' })).total)
  })

  it('returns nothing for a query whose tokens are not in the corpus', () => {
    expect(engine.search(search({ q: 'zzzz' })).total).toBe(0)
    expect(engine.search(search({ q: 'wall zzzz' })).total).toBe(0)
  })

  it('returns nothing — and does not throw — for a query with no tokens at all', () => {
    for (const q of ['###', '|||', '%%%', '   .   ']) {
      expect(() => engine.search(search({ q }))).not.toThrow()
      expect(engine.search(search({ q })).total).toBe(0)
    }
  })

  it('zeroes every facet count when the query matches nothing', () => {
    const result = engine.search(search({ q: 'zzzz' }))
    for (const key of FACET_KEYS) {
      for (const bucket of result.facets[key]) expect(bucket.count).toBe(0)
    }
  })
})

describe('rotted links', () => {
  it('shows an unknown selected value so it can be removed', () => {
    const result = engine.search(search({ tex: ['unobtainium'] }))
    expect(result.total).toBe(0)
    const bucket = result.facets.tex.find((entry) => entry.value === 'unobtainium')
    expect(bucket).toEqual({ value: 'unobtainium', count: 0, selected: true })
  })

  it('keeps a known selection working alongside an unknown one', () => {
    const result = engine.search(search({ tex: ['cave', 'unobtainium'] }))
    expect(result.total).toBe(engine.search(search({ tex: ['cave'] })).total)
  })

  it('treats an unknown build system as an empty result, not as no filter', () => {
    const result = engine.search(search({ build: 'no such system' }))
    expect(result.total).toBe(0)
  })

  it('never throws on a hand-mangled search', () => {
    for (const state of [
      search({ kinds: ['', '!!!', 'floor'] }),
      search({ tex: ['|', '||', 'cave|'] }),
      search({ build: '!!weird' }),
      search({ conn: ['🙂'] }),
      search({ q: '🙂🙂🙂' }),
    ]) {
      expect(() => engine.search(state)).not.toThrow()
    }
  })
})

describe('the exported surface', () => {
  it('reports its size and vocabulary', () => {
    expect(engine.size).toBe(file.records.length)
    expect(engine.vocabulary.kinds).toContain(KIND_OTHER)
    expect(engine.vocabulary.build).toContain(BUILD_UNSPECIFIED)
    expect(engine.vocabulary.conn).toContain('openlock')
  })

  it('returns undefined for an id it does not hold', () => {
    expect(engine.record('nope' as TileId)).toBeUndefined()
  })

  it('survives an empty catalog', () => {
    // Not a hypothetical: `corpus.test.ts` builds an engine over a stub when
    // `catalog.json` is absent, because a `describe.skip` callback still runs to
    // collect its tests. A zero-length bitset is also where the tail-masking
    // arithmetic is most likely to go wrong.
    const empty = createSearchEngine({ ...file, tags: [], records: [] })
    expect(empty.size).toBe(0)
    expect(empty.search(search()).total).toBe(0)
    expect(empty.search(search({ q: 'cave', tex: ['cave'] })).total).toBe(0)
    for (const key of FACET_KEYS) expect(empty.search(search()).facets[key]).toEqual([])
  })
})
