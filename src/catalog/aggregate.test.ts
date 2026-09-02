/**
 * The aggregate substrate, over hand-built records.
 *
 * The corpus figures live in `pipeline/aggregate.test.ts`, where the fixtures
 * are. What is proved here is the *behaviour* — the grouping, the address, the
 * positional projection, the slot union and the variant selection — against
 * inputs small enough to read, so a failure names a rule rather than a count.
 *
 * Two of these tests are type-level and would be invisible at runtime. The
 * `@ts-expect-error` pair on {@link AggregateAddress} is the whole of the
 * "un-confusable with a `ManifestOrdinal`" claim: if the brands ever collapse the
 * assertions stop erroring and `npm run typecheck` fails. That is the only way to
 * test a compile-time guarantee.
 */
import { describe, expect, it } from 'vitest'

import type { AggregateAddress, CatalogFile, CatalogRecord, Footprint, ManifestOrdinal, PartSlot } from './schema'
import { CatalogFile as CatalogFileSchema, MEASURED_SPRITE_SHEET, SCHEMA_VERSION } from './schema'
import { aggregateAddress, buildAggregateIndex, selectVariant, variantsByPreference } from './aggregate'

/* ----------------------------------------------------------------- fixtures */

interface Draft {
  readonly id: string
  readonly ord: number
  readonly design: string
  readonly tags: readonly string[]
  readonly layer: 'base' | 'topper' | 'integral' | 'insert'
  readonly bytes?: number
  readonly sprite?: boolean
  readonly name?: string
  readonly foot?: Footprint
  readonly parts?: readonly PartSlot[]
  readonly fulfills?: readonly string[]
}

const MD5 = '0123456789abcdef0123456789abcde'

/**
 * A parsed `CatalogFile` from a handful of drafts.
 *
 * Parsed rather than cast, so a draft that could not exist in a real index fails
 * here instead of quietly exercising the aggregate on an impossible record.
 */
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
    bytes: draft.bytes ?? 1000,
    sprite: draft.sprite ?? true,
    family: draft.id.slice(0, draft.id.lastIndexOf('/')),
    design: draft.design,
    name: draft.name ?? 'Test Tile',
    kinds: ['wall'],
    conn: [],
    layer: draft.layer,
    tags: draft.tags.map(intern),
    foot: draft.foot ?? ({ shape: 'wall', length: 2 } satisfies Footprint),
    ...(draft.parts === undefined && draft.fulfills === undefined
      ? {}
      : {
          config: {
            ...(draft.parts === undefined ? {} : { parts: draft.parts }),
            ...(draft.fulfills === undefined ? {} : { fulfills: draft.fulfills.map((part) => ({ part })) }),
          },
        }),
  }))

  return CatalogFileSchema.parse({
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
    records,
  })
}

/** The merged pair the owner asked for: one topper, one integral, one design. */
const PAIR: readonly Draft[] = [
  { id: 'tiles/x/openforge/a.openforge.stl', ord: 4, design: 'd1', tags: ['connection|openforge'], layer: 'topper' },
  { id: 'tiles/x/openlock/a.openlock.stl', ord: 9, design: 'd1', tags: ['connection|openlock'], layer: 'integral' },
]

function only(file: CatalogFile) {
  const index = buildAggregateIndex(file)
  const aggregate = index.aggregates[0]
  if (aggregate === undefined) throw new Error('no aggregate')
  return aggregate
}

/* ------------------------------------------------------------------- suites */

describe('aggregate identity', () => {
  it('puts one item per design, whatever the connection variants', () => {
    const index = buildAggregateIndex(catalog(PAIR))
    expect(index.aggregates).toHaveLength(1)
    expect(index.stats.files).toBe(2)
    expect(index.aggregates[0]?.variants.map((variant) => variant.id)).toEqual([
      'tiles/x/openforge/a.openforge.stl',
      'tiles/x/openlock/a.openlock.stl',
    ])
  })

  it('addresses the aggregate by the lowest ordinal in the group', () => {
    expect(only(catalog(PAIR)).address).toBe(4)
  })

  it('orders variants by ordinal, so variants[0] is the address holder', () => {
    const reversed = [...PAIR].reverse()
    const aggregate = only(catalog(reversed))
    expect(aggregate.variants[0]?.ord).toBe(4)
    expect(aggregate.address as unknown as number).toBe(aggregate.variants[0]?.ord)
  })

  it('gives every aggregate a distinct address', () => {
    const index = buildAggregateIndex(
      catalog([
        ...PAIR,
        { id: 'tiles/y/b.openlock.stl', ord: 1, design: 'd2', tags: ['connection|openlock'], layer: 'integral' },
      ]),
    )
    const addresses = index.aggregates.map((aggregate) => aggregate.address)
    expect(new Set(addresses).size).toBe(addresses.length)
  })

  it('emits aggregates in ascending address, and that order is the document index', () => {
    const index = buildAggregateIndex(
      catalog([
        ...PAIR,
        { id: 'tiles/y/b.openlock.stl', ord: 1, design: 'd2', tags: ['connection|openlock'], layer: 'integral' },
      ]),
    )
    expect(index.aggregates.map((aggregate) => aggregate.address as unknown as number)).toEqual([1, 4])
    const second = index.aggregates[1]
    if (second === undefined) throw new Error('expected two aggregates')
    expect(index.docOf.get(second.design)).toBe(1)
  })

  it('is a dense document index over a sparse address space — row A2 depends on the difference', () => {
    const index = buildAggregateIndex(
      catalog([
        { id: 'tiles/a.openlock.stl', ord: 0, design: 'd1', tags: ['connection|openlock'], layer: 'integral' },
        { id: 'tiles/b.openlock.stl', ord: 77, design: 'd2', tags: ['connection|openlock'], layer: 'integral' },
      ]),
    )
    expect(index.aggregates.map((aggregate) => aggregate.address as unknown as number)).toEqual([0, 77])
    expect(index.aggregates.map((aggregate) => index.docOf.get(aggregate.design))).toEqual([0, 1])
  })

  it('resolves an ordinal to its variant and on to its aggregate — row A4 in two hops', () => {
    const index = buildAggregateIndex(catalog(PAIR))
    const variant = index.byOrdinal.get(9 as ManifestOrdinal)
    if (variant === undefined) throw new Error('ordinal 9 is not in the index')
    expect(variant.id).toBe('tiles/x/openlock/a.openlock.stl')
    expect(index.byDesign.get(variant.design)?.address).toBe(4)
  })
})

describe('AggregateAddress branding', () => {
  it('is not interchangeable with a ManifestOrdinal', () => {
    const ord = 4 as ManifestOrdinal
    const address = aggregateAddress(ord)
    // @ts-expect-error an aggregate address is not a manifest ordinal
    const back: ManifestOrdinal = address
    // @ts-expect-error a manifest ordinal is not an aggregate address
    const forward: AggregateAddress = ord
    // The values agree at runtime — that is the whole hazard, and the reason the
    // separation has to be a type rather than a convention.
    expect(back as unknown as number).toBe(4)
    expect(forward as unknown as number).toBe(4)
  })
})

describe('classification', () => {
  const classOf = (drafts: readonly Draft[]) => only(catalog(drafts)).variantClass

  it('names the five shapes the corpus holds', () => {
    expect(classOf(PAIR)).toBe('both')
    expect(classOf([PAIR[0] as Draft])).toBe('topper-only')
    expect(classOf([PAIR[1] as Draft])).toBe('integrated-only')
    expect(
      classOf([{ id: 'tiles/b.openlock.stl', ord: 0, design: 'd1', tags: ['shape|base'], layer: 'base' }]),
    ).toBe('base-only')
    expect(classOf([{ id: 'tiles/i.stl', ord: 0, design: 'd1', tags: ['part|door'], layer: 'insert' }])).toBe(
      'insert-only',
    )
  })

  it('names anything else `mixed` rather than reporting it as one of the five', () => {
    expect(
      classOf([
        PAIR[0] as Draft,
        { id: 'tiles/i.stl', ord: 7, design: 'd1', tags: ['part|door'], layer: 'insert' },
      ]),
    ).toBe('mixed')
  })

  it('states the base requirement as the card asks it', () => {
    expect(only(catalog(PAIR)).needsBase).toBe('either')
    expect(only(catalog([PAIR[0] as Draft])).needsBase).toBe('always')
    expect(only(catalog([PAIR[1] as Draft])).needsBase).toBe('never')
  })
})

describe('the positional projection', () => {
  const projectOne = (tags: readonly string[], layer: Draft['layer'] = 'integral') => {
    const variant = only(catalog([{ id: 'tiles/a.stl', ord: 0, design: 'd1', tags, layer }])).variants[0]
    if (variant === undefined) throw new Error('no variant')
    return variant
  }

  it('puts an unpositioned system on the bottom face', () => {
    expect(projectOne(['connection|openlock']).bottomConn).toEqual(['openlock'])
  })

  it('reads `connection|openforge` as a bottom declaration and never as a lock', () => {
    const variant = projectOne(['connection|openforge', 'connection|side', 'connection|side|dragonlock'], 'topper')
    expect(variant.bottomConn).toEqual(['openforge'])
    expect(variant.sideConn).toEqual(['dragonlock'])
    expect(variant.needsBase).toBe(true)
  })

  it('does not let a position become a system', () => {
    expect(projectOne(['connection|side|openlock']).bottomConn).toEqual([])
    expect(projectOne(['connection|side|openlock']).sideConn).toEqual(['openlock'])
    // A bare position tag names a face with nothing on it: the system is named
    // by its siblings, so this contributes nothing rather than a `side` system.
    expect(projectOne(['connection|side']).sideConn).toEqual([])
    expect(projectOne(['connection|bottom']).bottomConn).toEqual([])
  })

  it('folds `connection|bottom|x` and `connection|x` into one face', () => {
    expect(projectOne(['connection|bottom|magnetic']).bottomConn).toEqual(['magnetic'])
  })

  it('reads print options from past the system, and only the four words that are options', () => {
    expect(projectOne(['connection|magnetic', 'connection|magnetic|flex']).options).toEqual(['flex'])
    expect(projectOne(['connection|openlock|topless']).options).toEqual(['topless'])
    expect(projectOne(['connection|openforge|split'], 'topper').options).toEqual(['split'])
    // `filament` is the *system* here, not an option — the one place a word from
    // §5's modifier list occupies the system slot.
    expect(projectOne(['connection|side|filament']).options).toEqual([])
    expect(projectOne(['connection|side|filament']).sideConn).toEqual(['filament'])
    // `pegs` is a system in its own right and never a modifier.
    expect(projectOne(['connection|pegs']).options).toEqual([])
    expect(projectOne(['connection|pegs']).bottomConn).toEqual(['pegs'])
  })

  it('offers only the systems of a variant that needs no base as self-sufficient', () => {
    const aggregate = only(catalog(PAIR))
    expect(aggregate.selfSufficientConn).toEqual(['openlock'])
    expect(aggregate.joineryUntagged).toBe(false)
  })

  it('flags an aggregate with no bottom system anywhere as untagged joinery', () => {
    const aggregate = only(
      catalog([{ id: 'tiles/a.stl', ord: 0, design: 'd1', tags: ['shape|wall'], layer: 'integral' }]),
    )
    expect(aggregate.selfSufficientConn).toEqual([])
    expect(aggregate.joineryUntagged).toBe(true)
  })

  it('does not call an insert-only aggregate untagged — an insert is never on the grid', () => {
    const aggregate = only(catalog([{ id: 'tiles/i.stl', ord: 0, design: 'd1', tags: ['part|door'], layer: 'insert' }]))
    expect(aggregate.joineryUntagged).toBe(false)
  })
})

describe('the config union with provenance', () => {
  const slot = (name: string, require: readonly string[] = ['shape|base']): PartSlot => ({
    name,
    tags: { require: require.map((tag) => ({ tag })) },
  })

  it('unions the slots and records which variant declared each', () => {
    const aggregate = only(
      catalog([
        { ...(PAIR[0] as Draft), parts: [slot('base')] },
        { ...(PAIR[1] as Draft), parts: [slot('base'), slot('torch', ['component|torch'])] },
      ]),
    )
    expect(aggregate.slots.map((entry) => entry.slot.name)).toEqual(['base', 'torch'])
    expect(aggregate.slots[0]?.universal).toBe(true)
    expect(aggregate.slots[1]?.universal).toBe(false)
    expect(aggregate.slots[1]?.declaredBy).toEqual(['tiles/x/openlock/a.openlock.stl'])
    expect(aggregate.configVaries).toBe(true)
  })

  it('keeps a union that no single variant carries — the 12 aggregates a pick would break', () => {
    const aggregate = only(
      catalog([
        { ...(PAIR[0] as Draft), parts: [slot('left')] },
        { ...(PAIR[1] as Draft), parts: [slot('right')] },
      ]),
    )
    expect(aggregate.slots).toHaveLength(2)
    expect(aggregate.slots.every((entry) => !entry.universal)).toBe(true)
  })

  it('reports no variance when every variant declares the same slot, however it is written', () => {
    const scrambled: PartSlot = {
      name: 'base',
      tags: { require: [{ tag: 'shape|floor' }, { tag: 'shape|base' }] },
    }
    const ordered: PartSlot = {
      name: 'base',
      tags: { require: [{ tag: 'shape|base' }, { tag: 'shape|floor' }] },
    }
    const aggregate = only(
      catalog([
        { ...(PAIR[0] as Draft), parts: [scrambled] },
        { ...(PAIR[1] as Draft), parts: [ordered] },
      ]),
    )
    expect(aggregate.slots).toHaveLength(1)
    expect(aggregate.configVaries).toBe(false)
  })

  it('treats a slot list as a set, so declaration order is not a config difference', () => {
    const base = slot('base')
    const torch = slot('torch', ['component|torch'])
    const aggregate = only(
      catalog([
        { ...(PAIR[0] as Draft), parts: [base, torch] },
        { ...(PAIR[1] as Draft), parts: [torch, base] },
      ]),
    )
    expect(aggregate.slots).toHaveLength(2)
    expect(aggregate.slots.every((entry) => entry.universal)).toBe(true)
    expect(aggregate.configVaries).toBe(false)
  })

  it('counts a `fulfills` difference as a config difference too', () => {
    const aggregate = only(
      catalog([
        { ...(PAIR[0] as Draft), fulfills: ['door'] },
        { ...(PAIR[1] as Draft), fulfills: ['door', 'grate'] },
      ]),
    )
    expect(aggregate.configVaries).toBe(true)
  })

  it('does not let an absent `optional` and an explicit `false` become two slots', () => {
    const aggregate = only(
      catalog([
        { ...(PAIR[0] as Draft), parts: [{ name: 'base', tags: {} }] },
        { ...(PAIR[1] as Draft), parts: [{ name: 'base', optional: false, tags: {} }] },
      ]),
    )
    expect(aggregate.slots).toHaveLength(1)
  })

  it('unions `fulfills` by part name', () => {
    const aggregate = only(
      catalog([
        { ...(PAIR[0] as Draft), fulfills: ['door'] },
        { ...(PAIR[1] as Draft), fulfills: ['door', 'grate'] },
      ]),
    )
    expect(aggregate.fulfills).toEqual(['door', 'grate'])
  })
})

describe('the card fields', () => {
  it('prefers a variant with a sprite for the preview', () => {
    const aggregate = only(
      catalog([
        { ...(PAIR[0] as Draft), sprite: false },
        { ...(PAIR[1] as Draft), sprite: true },
      ]),
    )
    expect(aggregate.preview).toBe('tiles/x/openlock/a.openlock.stl')
  })

  it('carries a byte range rather than one figure', () => {
    const aggregate = only(
      catalog([
        { ...(PAIR[0] as Draft), bytes: 100 },
        { ...(PAIR[1] as Draft), bytes: 8000 },
      ]),
    )
    expect(aggregate.bytesRange).toEqual([100, 8000])
  })

  it('counts a field that varies inside an aggregate, and one that does not', () => {
    const index = buildAggregateIndex(
      catalog([
        { ...(PAIR[0] as Draft), name: 'One' },
        { ...(PAIR[1] as Draft), name: 'Two' },
      ]),
    )
    expect(index.stats.varies.name).toBe(1)
    expect(index.stats.varies.kinds).toBe(0)
    expect(index.stats.varies.layer).toBe(1)
  })
})

describe('selectVariant', () => {
  it('prefers one part over two when the system is available without a base', () => {
    const selection = selectVariant(only(catalog(PAIR)), { bottom: 'openlock' })
    expect(selection.verdict).toBe('self-sufficient')
    expect(selection.variant.needsBase).toBe(false)
  })

  it('prefers one part over two even with no preference stated', () => {
    expect(selectVariant(only(catalog(PAIR))).verdict).toBe('self-sufficient')
  })

  it('falls back to the topper when the chosen system is not available without a base', () => {
    const selection = selectVariant(only(catalog(PAIR)), { bottom: 'magnetic' })
    expect(selection.verdict).toBe('needs-base')
    expect(selection.variant.needsBase).toBe(true)
  })

  it('prefers a topper whose side joinery matches the build', () => {
    const aggregate = only(
      catalog([
        { id: 'tiles/p.openforge.stl', ord: 0, design: 'd1', tags: ['connection|openforge'], layer: 'topper' },
        {
          id: 'tiles/q.openforge,side.stl',
          ord: 1,
          design: 'd1',
          tags: ['connection|openforge', 'connection|side|dragonlock'],
          layer: 'topper',
        },
      ]),
    )
    expect(selectVariant(aggregate, { bottom: 'dragonlock' }).variant.id).toBe('tiles/q.openforge,side.stl')
  })

  it('says wrong-system rather than refusing, when nothing carries the chosen lock', () => {
    const selection = selectVariant(only(catalog([PAIR[1] as Draft])), { bottom: 'magnetic' })
    expect(selection.verdict).toBe('wrong-system')
    expect(selection.variant.bottomConn).toEqual(['openlock'])
  })

  it('says unknown-joinery rather than incompatible, when the tags name nothing', () => {
    const selection = selectVariant(
      only(catalog([{ id: 'tiles/a.stl', ord: 0, design: 'd1', tags: ['shape|wall'], layer: 'integral' }])),
      { bottom: 'openlock' },
    )
    expect(selection.verdict).toBe('unknown-joinery')
  })

  it('names an insert an insert rather than folding it into unknown-joinery', () => {
    const selection = selectVariant(
      only(catalog([{ id: 'tiles/i.stl', ord: 0, design: 'd1', tags: ['part|door'], layer: 'insert' }])),
    )
    expect(selection.verdict).toBe('insert')
  })

  it('prefers the plain print over a modified one without being told the order', () => {
    const aggregate = only(
      catalog([
        {
          id: 'tiles/topless.stl',
          ord: 0,
          design: 'd1',
          tags: ['shape|base', 'connection|openlock', 'connection|openlock|topless'],
          layer: 'base',
          bytes: 10,
        },
        {
          id: 'tiles/plain.stl',
          ord: 1,
          design: 'd1',
          tags: ['shape|base', 'connection|openlock'],
          layer: 'base',
          bytes: 1000,
        },
      ]),
    )
    const selection = selectVariant(aggregate, { bottom: 'openlock' })
    expect(selection.variant.id).toBe('tiles/plain.stl')
    expect(selection.optionTie).toBe(false)
  })

  it('discloses the tie when two different products differ only by which option they name', () => {
    const drafts: readonly Draft[] = [
      {
        id: 'tiles/topless.stl',
        ord: 0,
        design: 'd1',
        tags: ['shape|base', 'connection|openlock', 'connection|openlock|topless'],
        layer: 'base',
        bytes: 10,
      },
      {
        id: 'tiles/unsupported.stl',
        ord: 1,
        design: 'd1',
        tags: ['shape|base', 'connection|openlock', 'connection|openlock|unsupported'],
        layer: 'base',
        bytes: 1000,
      },
    ]
    const aggregate = only(catalog(drafts))

    // Without a stated preference the two are equally ranked and `bytes` decides
    // — which is the tie-break row D1 removed from base matching, because the
    // topless print of a base is its smallest file. Reported, not hidden.
    const blind = selectVariant(aggregate, { bottom: 'openlock' })
    expect(blind.variant.id).toBe('tiles/topless.stl')
    expect(blind.optionTie).toBe(true)

    // Given D1's order, the answer is decided on suitability and the tie is gone.
    const informed = selectVariant(aggregate, { bottom: 'openlock', options: ['plain', 'unsupported', 'topless'] })
    expect(informed.variant.id).toBe('tiles/unsupported.stl')
    expect(informed.optionTie).toBe(false)
  })

  it('ranks on the worst option a variant names, not the best', () => {
    const aggregate = only(
      catalog([
        {
          id: 'tiles/flex-topless.stl',
          ord: 0,
          design: 'd1',
          tags: ['shape|base', 'connection|magnetic', 'connection|magnetic|flex', 'connection|openlock|topless'],
          layer: 'base',
          bytes: 10,
        },
        {
          id: 'tiles/flex.stl',
          ord: 1,
          design: 'd1',
          tags: ['shape|base', 'connection|magnetic', 'connection|magnetic|flex'],
          layer: 'base',
          bytes: 5000,
        },
      ]),
    )
    const order = ['plain', 'unsupported', 'topless']
    expect(variantsByPreference(aggregate, { options: order })[0]?.id).toBe('tiles/flex.stl')
  })

  it('breaks a true tie on bytes and then on id, so two runs cannot disagree', () => {
    const aggregate = only(
      catalog([
        { id: 'tiles/z.stl', ord: 0, design: 'd1', tags: ['connection|openlock'], layer: 'integral', bytes: 50 },
        { id: 'tiles/a.stl', ord: 1, design: 'd1', tags: ['connection|openlock'], layer: 'integral', bytes: 50 },
      ]),
    )
    expect(variantsByPreference(aggregate).map((variant) => variant.id)).toEqual(['tiles/a.stl', 'tiles/z.stl'])
  })
})

describe('stats', () => {
  it('reports the group-size distribution and the duplicate names', () => {
    const index = buildAggregateIndex(
      catalog([
        ...PAIR,
        { id: 'tiles/y/b.openlock.stl', ord: 1, design: 'd2', tags: ['connection|openlock'], layer: 'integral' },
      ]),
    )
    expect(index.stats.groupSizes).toEqual({ 1: 1, 2: 1 })
    expect(index.stats.duplicateNames).toEqual({ names: 1, aggregates: 2, worst: 2 })
    expect(index.stats.classes.both).toBe(1)
    expect(index.stats.needsBase).toEqual({ always: 0, never: 1, either: 1 })
  })

  it('counts the aggregates whose slot union no single variant carries', () => {
    const index = buildAggregateIndex(
      catalog([
        { ...(PAIR[0] as Draft), parts: [{ name: 'left', tags: {} }] },
        { ...(PAIR[1] as Draft), parts: [{ name: 'right', tags: {} }] },
      ]),
    )
    expect(index.stats.configUnionExceedsEveryVariant).toBe(1)
  })
})

describe('the record fields the aggregate hoists', () => {
  it('takes them from the address-holding variant', () => {
    const record: CatalogRecord | undefined = catalog(PAIR).records.find((candidate) => candidate.ord === 4)
    const aggregate = only(catalog(PAIR))
    expect(aggregate.name).toBe(record?.name)
    expect(aggregate.foot).toEqual(record?.foot)
    expect(aggregate.kinds).toEqual(record?.kinds)
  })
})
