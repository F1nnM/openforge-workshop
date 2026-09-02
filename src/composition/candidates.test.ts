/**
 * Candidate resolution over hand-built records.
 *
 * The corpus figures live in `corpus.test.ts`, where the real index is. What is
 * proved here is the *behaviour* — exact versus prefix matching, what a filter
 * stops, what a sibling pick costs, and how a dead end reads — against inputs
 * small enough that a failure names a rule rather than a count. It runs in CI,
 * where `public/catalog/catalog.json` does not exist.
 *
 * The fixture builder is the one `src/catalog/aggregate.test.ts` uses, for the
 * reason that file gives: the drafts are **parsed** into a `CatalogFile` rather
 * than cast, so a record that could not exist in a real index fails here instead
 * of quietly exercising the resolver on an impossible input.
 */
import { describe, expect, it } from 'vitest'

import type { CatalogFile, Footprint, PartSlot, TileId } from '@/catalog'
import { CatalogFile as CatalogFileSchema, MEASURED_SPRITE_SHEET, SCHEMA_VERSION } from '@/catalog'

import { createCompositionIndex } from './candidates'

/* ----------------------------------------------------------------- fixtures */

interface Draft {
  readonly id: string
  readonly ord: number
  readonly design: string
  readonly tags: readonly string[]
  readonly layer: 'base' | 'topper' | 'integral' | 'insert'
  readonly parts?: readonly PartSlot[]
}

const MD5 = '0123456789abcdef0123456789abcde'

function catalog(drafts: readonly Draft[]): CatalogFile {
  const table: string[] = []
  const intern = (tag: string): number => {
    const at = table.indexOf(tag)
    if (at !== -1) return at
    table.push(tag)
    return table.length - 1
  }
  const records = drafts.map((draft, i) => ({
    id: draft.id,
    ord: draft.ord,
    blob: `${MD5}${String(i % 10)}`,
    file: draft.id.slice(draft.id.lastIndexOf('/') + 1),
    bytes: 1000,
    sprite: true,
    thumb: false,
    family: draft.id.slice(0, draft.id.lastIndexOf('/')),
    design: draft.design,
    name: 'Test Tile',
    kinds: ['wall'],
    conn: [],
    layer: draft.layer,
    tags: draft.tags.map(intern),
    foot: { shape: 'wall', length: 2 } satisfies Footprint,
    ...(draft.parts === undefined ? {} : { config: { parts: draft.parts } }),
  }))

  return CatalogFileSchema.parse({
    version: { schema: SCHEMA_VERSION, pipeline: 1, fixtures: 'test', manifest: 1, built: '2026-01-01T00:00:00.000Z' },
    assets: {
      models: 'https://example.test/models',
      sprites: 'https://example.test/sprites',
      thumbs: 'https://example.test/thumbs',
      lod: 'https://example.test/lod',
    },
    sprite: MEASURED_SPRITE_SHEET,
    tags: table,
    records: [...records].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  })
}

const tile = (id: string): TileId => id as unknown as TileId

/**
 * One wall declaring a `base` slot, and four bases to choose from.
 *
 * The shapes here are the corpus's: a slot whose `require` is `shape|base` and
 * whose `constrain` is the `shape`/`size|width`/`texture` trio with the
 * `shape|wall` filter, which is the single most common declaration in the
 * fixtures — 906 of the 2,448 `shape` constraints carry exactly that filter.
 */
const BASE_SLOT: PartSlot = {
  name: 'base',
  optional: true,
  tags: {
    require: [{ tag: 'shape|base' }],
    constrain: [{ tag: 'texture' }, { tag: 'shape' }, { filter: 'shape|wall' }],
  },
}

const FIXTURE = catalog([
  {
    id: 'tiles/stone/wall.stl',
    ord: 1,
    design: 'wall',
    layer: 'topper',
    tags: ['shape|wall', 'texture|dungeon_stone', 'size|width|2'],
    parts: [BASE_SLOT],
  },
  {
    id: 'tiles/towne/wall.stl',
    ord: 2,
    design: 'wall-towne',
    layer: 'topper',
    tags: ['shape|wall', 'texture|towne', 'size|width|2'],
    parts: [BASE_SLOT],
  },
  { id: 'tiles/bases/stone/a.stl', ord: 3, design: 'base-stone', layer: 'base', tags: ['shape|base', 'texture|dungeon_stone'] },
  { id: 'tiles/bases/stone/b.stl', ord: 4, design: 'base-stone', layer: 'base', tags: ['shape|base', 'texture|dungeon_stone'] },
  { id: 'tiles/bases/stone/deep.stl', ord: 5, design: 'base-deep', layer: 'base', tags: ['shape|base|square', 'texture|dungeon_stone'] },
  { id: 'tiles/bases/cave/a.stl', ord: 6, design: 'base-cave', layer: 'base', tags: ['shape|base', 'texture|cave'] },
])

describe('createCompositionIndex', () => {
  const index = createCompositionIndex(FIXTURE)

  it('counts the slots and the refs it will resolve', () => {
    expect(index.slots).toBe(2)
    expect(index.tilesWithSlots).toBe(2)
    expect(index.refs).toEqual(['shape', 'shape|base', 'shape|wall', 'texture'])
  })

  it('reads a tile’s slots and tags back', () => {
    expect(index.slotsOf(tile('tiles/stone/wall.stl')).map((slot) => slot.name)).toEqual(['base'])
    expect(index.slotsOf(tile('tiles/bases/cave/a.stl'))).toEqual([])
    expect(index.tagsOf(tile('tiles/bases/cave/a.stl'))).toEqual(['shape|base', 'texture|cave'])
    // A tile nothing knows about resolves to nothing rather than throwing: the
    // parent of a slot can legitimately be a record a caller has just dropped.
    expect(index.tagsOf(tile('nope.stl'))).toEqual([])
  })

  /* ------------------------------------------------------- exact vs prefix */

  it('matches `require` exactly, so a more specific tag is not a candidate', () => {
    const wide = index.candidatesFor({ require: ['shape|base'], deny: [], accept: [] })
    // `tiles/bases/stone/deep.stl` carries `shape|base|square` and NOT `shape|base`.
    expect(wide.tiles).toEqual(['tiles/bases/cave/a.stl', 'tiles/bases/stone/a.stl', 'tiles/bases/stone/b.stl'])
  })

  it('matches `accept` positionally, so a more specific tag is a candidate', () => {
    const accepted = index.candidatesFor({ require: [], deny: [], accept: ['shape|base'] })
    expect(accepted.tiles).toContain('tiles/bases/stone/deep.stl')
    expect(accepted.tiles).toHaveLength(4)
  })

  it('excludes a `deny` exactly, and tolerates one that names no tag', () => {
    const denied = index.candidatesFor({ require: ['shape|base'], deny: ['texture|cave'], accept: [] })
    expect(denied.tiles).toEqual(['tiles/bases/stone/a.stl', 'tiles/bases/stone/b.stl'])

    const harmless = index.candidatesFor({ require: ['shape|base'], deny: ['texture|nonesuch'], accept: [] })
    expect(harmless.tiles).toHaveLength(3)
    expect(harmless.unknownRefs).toEqual(['texture|nonesuch'])
  })

  it('returns nothing, and says why, for a `require` that names no tag', () => {
    const missing = index.candidatesFor({ require: ['shape|base', 'texture|nonesuch'], deny: [], accept: [] })
    expect(missing.tiles).toEqual([])
    expect(missing.deadEnd).toBe(true)
    expect(missing.unknownRefs).toEqual(['texture|nonesuch'])
  })

  /* ------------------------------------------------------------- constrain */

  it('narrows a slot by its parent’s tags before any interaction', () => {
    const resolved = index.resolve(BASE_SLOT, tile('tiles/stone/wall.stl'))

    // `texture` inherits `texture|dungeon_stone`; `shape` inherits nothing,
    // because the only `shape|` tag the parent has is filtered.
    expect(resolved.resolved.require).toEqual(['shape|base', 'texture|dungeon_stone'])
    expect(resolved.tiles).toEqual(['tiles/bases/stone/a.stl', 'tiles/bases/stone/b.stl'])
    expect(resolved.deadEnd).toBe(false)
  })

  it('is a dead end when the parent’s texture has no base', () => {
    const resolved = index.resolve(BASE_SLOT, tile('tiles/towne/wall.stl'))

    expect(resolved.resolved.require).toEqual(['shape|base', 'texture|towne'])
    expect(resolved.deadEnd).toBe(true)
    // Not a dangling ref: `texture|towne` is a real tag, just never on a base.
    expect(resolved.unknownRefs).toEqual([])
  })

  it('drops the `shape|wall` the filter blocks, and lets it through without one', () => {
    const unfiltered: PartSlot = {
      name: 'base',
      tags: { require: [{ tag: 'shape|base' }], constrain: [{ tag: 'shape' }] },
    }
    const resolved = index.resolve(unfiltered, tile('tiles/stone/wall.stl'))

    // With no filter, the parent's own `shape|wall` becomes a require — and no
    // base carries it, so the slot empties. This is the mechanism behind 164 of
    // the corpus's 526 initial dead ends, and it is the fixture's choice, not a
    // bug in the resolver.
    expect(resolved.resolved.require).toEqual(['shape|base', 'shape|wall'])
    expect(resolved.deadEnd).toBe(true)
  })

  it('narrows again when a sibling is picked — which is why nothing is precomputed', () => {
    const slot: PartSlot = {
      name: 'base',
      tags: { require: [{ tag: 'shape|base' }], constrain: [{ tag: 'texture' }] },
    }
    const parent = tile('tiles/stone/wall.stl')

    // Initial state: the parent's texture only.
    expect(index.resolve(slot, parent).tiles).toHaveLength(2)

    // A sibling filled with a cave base adds `texture|cave` as a *second*
    // require, and no tile carries both textures. A precomputed set would have
    // answered "two candidates" here and been wrong.
    const withSibling = index.resolve(slot, parent, [
      { partName: 'torch', tags: index.tagsOf(tile('tiles/bases/cave/a.stl')) },
    ])
    expect(withSibling.resolved.require).toEqual(['shape|base', 'texture|dungeon_stone', 'texture|cave'])
    expect(withSibling.deadEnd).toBe(true)
  })

  it('collapses candidate files to the items they belong to', () => {
    const resolved = index.resolve(BASE_SLOT, tile('tiles/stone/wall.stl'))

    // Two files, one design, so one item — the collapse A1 built and the unit
    // C2's grid renders.
    expect(resolved.tiles).toHaveLength(2)
    expect(resolved.items).toHaveLength(1)
    expect(resolved.items[0]).toBe(index.aggregates.byDesign.get('base-stone' as never)?.address)
  })

  it('offers the whole corpus for a slot that constrains nothing', () => {
    const open = index.candidatesFor({ require: [], deny: [], accept: [] })
    expect(open.tiles).toHaveLength(FIXTURE.records.length)
  })

  /* -------------------------------------------------------------- postings */

  it('builds one exact inverted index over the tag table', () => {
    const references = FIXTURE.records.reduce((total, record) => total + record.tags.length, 0)
    expect(index.postings.docs.length).toBe(references)
    expect(index.postings.offsets.length).toBe(FIXTURE.tags.length + 1)
    expect(index.postings.bytes).toBe((references + FIXTURE.tags.length + 1) * 4)

    // Every posting list ascending, which is what makes the intersection a
    // two-pointer walk rather than a sort.
    for (let id = 0; id < FIXTURE.tags.length; id += 1) {
      const from = index.postings.offsets[id] ?? 0
      const to = index.postings.offsets[id + 1] ?? from
      const list = [...index.postings.docs.subarray(from, to)]
      expect(list).toEqual([...list].sort((a, b) => a - b))
    }
  })
})
