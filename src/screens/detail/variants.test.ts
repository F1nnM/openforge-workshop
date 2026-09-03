/**
 * `variants.ts` in isolation — the four decisions the corpus test can only
 * confirm in aggregate.
 *
 * `corpus.test.ts` proves the measured figures over all 3,822 items. This file
 * proves the *branches*, over hand-built aggregates small enough to read:
 *
 *   1. Every variant survives to a row, in ordinal order, with nothing dropped.
 *   2. `label` is the shortest unique path suffix — the case that had to be
 *      measured, because 93 aggregates hold two variants with one basename.
 *   3. `openforge` leaves the joins and nothing else does.
 *   4. `slotRows` drops the `base` slot and carries provenance for the rest.
 *
 * The fixtures go through `CatalogFile.parse` and `buildAggregateIndex` rather
 * than being cast into a `TileAggregate`, so a draft that could not exist in a
 * real index fails here instead of quietly exercising the module on an
 * impossible item. Same reasoning as `src/routes/fixture.ts`, and deliberately
 * not an import of it: that fixture is shaped to control which ordinals are
 * group minima, which is row A4's subject and not this one's.
 */
import { describe, expect, it } from 'vitest'

import type { TileAggregate } from '@/catalog'
import { CatalogFile, MEASURED_SPRITE_SHEET, SCHEMA_VERSION, buildAggregateIndex } from '@/catalog'

import { joinsOf, optionNote, slotRows, systemLabel, variantRows } from './variants'

/* ------------------------------------------------------------------ fixture */

interface Draft {
  readonly id: string
  readonly ord: number
  readonly layer: 'base' | 'topper' | 'integral' | 'insert'
  readonly bytes?: number
  /** Raw `connection|…` tags, exactly as the corpus spells them. */
  readonly conn?: readonly string[]
  readonly config?: unknown
}

/** One aggregate over the drafts. Every draft shares one design, by construction. */
function aggregateOf(drafts: readonly Draft[]): TileAggregate {
  const table: string[] = ['texture|cave']
  const intern = (tag: string): number => {
    const at = table.indexOf(tag)
    if (at !== -1) return at
    table.push(tag)
    return table.length - 1
  }

  const file = CatalogFile.parse({
    version: {
      schema: SCHEMA_VERSION,
      pipeline: 1,
      fixtures: 'test',
      manifest: 1,
      built: '2026-01-01T00:00:00.000Z',
    },
    assets: {
      models: 'https://example.test/models',
      sprites: 'https://example.test/sprites',
      thumbs: 'https://example.test/thumbs',
      lod: 'https://example.test/lod',
    },
    sprite: MEASURED_SPRITE_SHEET,
    tags: table,
    records: drafts.map((draft, at) => ({
      id: draft.id,
      ord: draft.ord,
      blob: `0123456789abcdef0123456789abcd${String(at).padStart(2, '0')}`,
      file: draft.id.slice(draft.id.lastIndexOf('/') + 1),
      bytes: draft.bytes ?? 1_000_000,
      sprite: true,
      thumb: false,
      family: draft.id.slice(0, draft.id.lastIndexOf('/')),
      design: 'd-one',
      name: 'Cave Thing',
      kinds: ['wall'],
      conn: [],
      layer: draft.layer,
      texture: 'cave',
      tags: [0, ...(draft.conn ?? []).map(intern)],
      foot: { shape: 'wall', length: 2 },
      ...(draft.config === undefined ? {} : { config: draft.config }),
    })),
  })

  const first = file.records[0]
  if (first === undefined) throw new Error('the fixture holds no records')
  const aggregate = buildAggregateIndex(file).byDesign.get(first.design)
  if (aggregate === undefined) throw new Error('the fixture produced no aggregate')
  return aggregate
}

/* ------------------------------------------------------------ disclosing all */

describe('variantRows', () => {
  it('emits one row per file, in the aggregate’s own order, dropping none', () => {
    const aggregate = aggregateOf([
      { id: 'tiles/x/a/thing.a.stl', ord: 7, layer: 'topper', conn: ['connection|openforge'] },
      { id: 'tiles/x/b/thing.b.stl', ord: 3, layer: 'integral', conn: ['connection|openlock'] },
      { id: 'tiles/x/c/thing.c.stl', ord: 5, layer: 'integral', conn: ['connection|openlock'] },
    ])

    const rows = variantRows(aggregate)
    expect(rows).toHaveLength(3)
    // Ordinal order, which is `variants` order — and which carries no claim,
    // unlike a rank that would end on a byte tie-break.
    expect(rows.map((row) => row.variant.ord)).toEqual([3, 5, 7])
  })

  it('reports a minimum part count, not a size comparison', () => {
    const aggregate = aggregateOf([
      { id: 'tiles/x/a/top.stl', ord: 1, layer: 'topper', conn: ['connection|openforge'], bytes: 500 },
      { id: 'tiles/x/b/int.stl', ord: 2, layer: 'integral', conn: ['connection|openlock'], bytes: 9_000_000 },
      { id: 'tiles/x/c/ins.stl', ord: 3, layer: 'insert' },
    ])

    const [topper, integral, insert] = variantRows(aggregate)
    // The topper is the *smallest* file here and still takes two prints. A
    // byte-derived claim would have got this exactly backwards.
    expect(topper?.minParts).toBe(2)
    expect(topper?.partsLabel).toBe('2 parts')
    expect(topper?.partsNote).toMatch(/and a base/)

    expect(integral?.minParts).toBe(1)
    expect(integral?.partsNote).toMatch(/meets the table on its own/)

    // An insert is one print and still never reaches the grid — a third reading
    // of "1 part", which is why the note is not derived from the count.
    expect(insert?.minParts).toBe(1)
    expect(insert?.partsNote).toMatch(/fitted into another piece/)
  })

  it('formats the size as a download and states no ratio', () => {
    const aggregate = aggregateOf([
      { id: 'tiles/x/a/small.stl', ord: 1, layer: 'integral', bytes: 84 },
      { id: 'tiles/x/b/large.stl', ord: 2, layer: 'integral', bytes: 3_309_684 },
    ])

    const rows = variantRows(aggregate)
    // The real corpus's worst pair, 39,401x apart. Both are stated; neither is
    // compared, because the small one is a degenerate mesh and not a saving.
    expect(rows.map((row) => row.download)).toEqual(['84 B', '3.3 MB'])
  })
})

/* -------------------------------------------------------------- the identity */

describe('the row label', () => {
  it('is the bare filename where filenames already differ', () => {
    const aggregate = aggregateOf([
      { id: 'tiles/x/a/thing.openforge.stl', ord: 1, layer: 'topper' },
      { id: 'tiles/x/b/thing.openlock.stl', ord: 2, layer: 'integral' },
    ])

    expect(variantRows(aggregate).map((row) => row.label)).toEqual([
      'thing.openforge.stl',
      'thing.openlock.stl',
    ])
  })

  it('grows to the shortest unique suffix when two files share a basename', () => {
    // 93 aggregates (2.4%) are shaped like this: one basename, two folders.
    const aggregate = aggregateOf([
      { id: 'tiles/x/openforge/thing.stl', ord: 1, layer: 'topper' },
      { id: 'tiles/x/openlock/thing.stl', ord: 2, layer: 'integral' },
    ])

    expect(variantRows(aggregate).map((row) => row.label)).toEqual([
      'openforge/thing.stl',
      'openlock/thing.stl',
    ])
  })

  it('deepens only as far as it must, and stays unique when it must go far', () => {
    const aggregate = aggregateOf([
      { id: 'tiles/one/deep/same/thing.stl', ord: 1, layer: 'integral' },
      { id: 'tiles/two/deep/same/thing.stl', ord: 2, layer: 'integral' },
    ])

    const labels = variantRows(aggregate).map((row) => row.label)
    // Three segments would still collide on `deep/same/thing.stl`, so it takes
    // four — and no more than four.
    expect(labels).toEqual(['one/deep/same/thing.stl', 'two/deep/same/thing.stl'])
    expect(new Set(labels).size).toBe(2)
  })

  it('is unique for every variant of a group whose facts are identical', () => {
    // The `Plain Wall Base 1x IA` shape: same layer, same system, same option,
    // separated only by the file. 18 of these share one derived description in
    // the real corpus.
    const aggregate = aggregateOf(
      [1, 2, 3, 4].map((n) => ({
        id: `tiles/bases/plain/base.${String(n)}.magnetic.stl`,
        ord: n,
        layer: 'base' as const,
        conn: ['connection|magnetic|flex'],
      })),
    )

    const rows = variantRows(aggregate)
    // Every derived fact agrees...
    expect(new Set(rows.map((row) => `${row.partsLabel}|${row.joins.map((j) => j.system).join()}`)).size).toBe(1)
    // ...and the label still separates all four.
    expect(new Set(rows.map((row) => row.label)).size).toBe(4)
  })
})

/* ------------------------------------------------------------------ the joins */

describe('joinsOf', () => {
  it('drops openforge underneath, because that is the base declaration', () => {
    const aggregate = aggregateOf([
      {
        id: 'tiles/x/a/top.stl',
        ord: 1,
        layer: 'topper',
        conn: ['connection|openforge', 'connection|side|dragonlock'],
      },
    ])

    const joins = joinsOf(aggregate.variants[0])
    expect(joins.map((join) => join.system)).toEqual(['dragonlock'])
    expect(joins[0]?.face).toBe('sides')
    // The variant does declare it; the display drops it.
    expect(aggregate.variants[0].bottomConn).toContain('openforge')
  })

  it('keeps every other system unfiltered, underside before sides', () => {
    const aggregate = aggregateOf([
      {
        id: 'tiles/x/a/thing.stl',
        ord: 1,
        layer: 'integral',
        // `pegs` is a system on 147 records and `filament` a side system on 114.
        // A card filters both away; the drawer states them.
        conn: ['connection|pegs', 'connection|side|filament'],
      },
    ])

    expect(joinsOf(aggregate.variants[0])).toEqual([
      { system: 'pegs', label: 'Pegs', face: 'underside' },
      { system: 'filament', label: 'Filament hinge', face: 'sides' },
    ])
  })

  it('returns nothing for a file that declares no system', () => {
    const aggregate = aggregateOf([{ id: 'tiles/x/a/ins.stl', ord: 1, layer: 'insert' }])
    expect(joinsOf(aggregate.variants[0])).toEqual([])
  })
})

describe('the label maps', () => {
  it('spells the systems the way the people who made them do', () => {
    expect(systemLabel('openlock')).toBe('OpenLOCK')
    expect(systemLabel('dragonlock')).toBe('DragonLock')
    // An unknown word falls through rather than being dropped or guessed at.
    expect(systemLabel('something-new')).toBe('something-new')
  })

  it('says what a print option means, and never that it is cheaper', () => {
    expect(optionNote('topless')).toMatch(/different product/)
    expect(optionNote('unsupported')).toMatch(/without supports/)
    expect(optionNote('nonesuch')).toBeUndefined()

    // The whole measured option vocabulary is these four words, and not one of
    // them may *assert* a material or time saving. `topless` is allowed to
    // mention cheapness because it denies it — "not a cheaper print of the same
    // one" is the sentence the row exists to make, so the assertion is against
    // an affirmative claim rather than against the word.
    for (const option of ['flex', 'unsupported', 'topless', 'split']) {
      const note = optionNote(option) ?? ''
      expect(note).not.toBe('')
      expect(note).not.toMatch(/\bsaves\b|\buses less\b|less (filament|material|time)/i)
    }
    expect(optionNote('topless')).toMatch(/not a cheaper print/)
  })
})

/* ------------------------------------------------------------------ the slots */

describe('slotRows', () => {
  const withSlots = () =>
    aggregateOf([
      {
        id: 'tiles/x/a/top.stl',
        ord: 1,
        layer: 'topper',
        conn: ['connection|openforge'],
        config: {
          parts: [
            { name: 'base', tags: { require: [{ tag: 'shape|base' }] } },
            { name: 'torch', optional: true, tags: { require: [{ tag: 'component|torch' }] } },
            { name: 'lintel', tags: { require: [{ tag: 'component|lintel' }] } },
          ],
        },
      },
      {
        id: 'tiles/x/b/int.stl',
        ord: 2,
        layer: 'integral',
        conn: ['connection|openlock'],
        config: { parts: [{ name: 'lintel', tags: { require: [{ tag: 'component|lintel' }] } }] },
      },
    ])

  it('drops the base slot, which the part count already states', () => {
    const rows = slotRows(withSlots())
    expect(rows.map((row) => row.name)).toEqual(['torch', 'lintel'])
    // It is in the aggregate's union — it is just not an accessory.
    expect(withSlots().slots.map((slot) => slot.slot.name)).toContain('base')
  })

  it('carries provenance: universal, or the prints that have it', () => {
    const [torch, lintel] = slotRows(withSlots())

    // Only the topper declares `torch`, so a user choosing the other print
    // loses it — A1's 654-aggregate case, and the reason for the union.
    expect(torch?.universal).toBe(false)
    expect(torch?.onlyOn).toEqual(['top.stl'])
    expect(torch?.optional).toBe(true)

    // Both declare `lintel`, so no choice of print loses it and naming the
    // files would be noise.
    expect(lintel?.universal).toBe(true)
    expect(lintel?.onlyOn).toEqual([])
    // Absence of `optional` means required, not unknown.
    expect(lintel?.optional).toBe(false)
  })

  it('names prints by the same label the table’s rows carry', () => {
    // Two folders, one basename — so the provenance label must be the
    // disambiguated path, or the cross-reference the drawer asks the user to
    // make would not resolve.
    const aggregate = aggregateOf([
      {
        id: 'tiles/x/openforge/thing.stl',
        ord: 1,
        layer: 'topper',
        config: { parts: [{ name: 'torch', tags: {} }] },
      },
      { id: 'tiles/x/openlock/thing.stl', ord: 2, layer: 'integral' },
    ])

    const labels = variantRows(aggregate).map((row) => row.label)
    expect(slotRows(aggregate)[0]?.onlyOn).toEqual(['openforge/thing.stl'])
    expect(labels).toContain('openforge/thing.stl')
  })

  it('is empty for an item that declares no composition', () => {
    const aggregate = aggregateOf([{ id: 'tiles/x/a/thing.stl', ord: 1, layer: 'integral' }])
    expect(slotRows(aggregate)).toEqual([])
  })

  it('keeps the array position it was found at, and it is only a React key', () => {
    // C1 reported that `AggregateSlot` has no stable key. `at` is the position
    // in `aggregate.slots` — stable within a build, not across one — so this
    // asserts what it is rather than promising it survives a rebuild.
    const rows = slotRows(withSlots())
    const slots = withSlots().slots
    for (const row of rows) expect(slots[row.at]?.slot.name).toBe(row.name)
  })
})
