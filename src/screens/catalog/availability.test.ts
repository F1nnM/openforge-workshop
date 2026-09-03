/**
 * The availability chips, branch by branch, plus the label budget.
 *
 * Node environment: `availabilityOf` is a pure function of a `TileAggregate` and
 * the labels are strings. `catalog.test.tsx` renders them; `corpus.test.ts`
 * asserts the distribution over the real 3,822.
 *
 * The aggregates here are built by `buildAggregateIndex` over parsed fixture
 * records rather than written out as object literals. A hand-written
 * `TileAggregate` would let this file assert against a shape A1 cannot produce —
 * `selfSufficientConn` and `sideConn` are derived from the *positional* split of
 * a record's connection tags, and getting that wrong by hand is precisely the
 * mistake the chips exist to avoid.
 */
import { describe, expect, it } from 'vitest'

import type { CatalogFile, CatalogRecord, TileAggregate } from '@/catalog'
import {
  CatalogFile as CatalogFileSchema,
  CatalogRecord as CatalogRecordSchema,
  buildAggregateIndex,
} from '@/catalog'

import type { AvailabilityChip } from './availability'
import {
  CHIP_BUDGET,
  LOCK_CHIP_ORDER,
  availabilityChips,
  availabilityOf,
  baseRequirementHint,
  baseRequirementLabel,
  chipStripWidth,
  joineryNoteHint,
  joineryNoteLabel,
  lockChipHint,
  lockChipLabel,
} from './availability'

/* ------------------------------------------------------------------ fixtures */

/**
 * The connection tag vocabulary these fixtures need, interned.
 *
 * Spelled with the position segment, because that is the whole point: A1 reads
 * `connection|side|dragonlock` as neighbour joinery and `connection|dragonlock`
 * as table joinery, and a fixture that flattened them would exercise neither.
 */
const TAGS = [
  'connection|openforge',
  'connection|openlock',
  'connection|dragonlock',
  'connection|magnetic',
  'connection|side|openlock',
  'connection|side|dragonlock',
  'connection|side|filament',
  'connection|pegs',
  'shape|wall',
] as const

const TAG = Object.fromEntries(TAGS.map((tag, at) => [tag, at])) as Record<(typeof TAGS)[number], number>

let nextOrd = 0

function record(overrides: Record<string, unknown> = {}): CatalogRecord {
  const ord = nextOrd
  nextOrd += 1
  const suffix = ord.toString().padStart(3, '0')
  return CatalogRecordSchema.parse({
    id: `tiles/fixture/tile-${suffix}.stl`,
    ord,
    blob: `00000000000000000000000000000${suffix}`,
    file: `tile-${suffix}.2x.stl`,
    bytes: 10_000_000,
    sprite: true,
    thumb: false,
    family: 'tiles/fixture',
    design: `dfix${suffix}`,
    name: `Tile ${suffix}`,
    kinds: ['wall'],
    conn: [],
    layer: 'integral',
    tags: [TAG['shape|wall']],
    foot: { shape: 'rect', w: 1, d: 1 },
    ...overrides,
  })
}

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
    tags: [...TAGS],
    records,
  })
}

/** One aggregate over the given records, which must share a design. */
function aggregate(...records: readonly CatalogRecord[]): TileAggregate {
  const index = buildAggregateIndex(fileOf(records))
  const [only, ...rest] = index.aggregates
  if (only === undefined || rest.length > 0) {
    throw new Error(`expected one aggregate, built ${String(index.aggregates.length)}`)
  }
  return only
}

const labels = (aggregate: TileAggregate) => availabilityChips(availabilityOf(aggregate)).map((chip) => chip.label)
const states = (aggregate: TileAggregate) =>
  availabilityChips(availabilityOf(aggregate)).map((chip) => `${chip.kind}:${chip.state}`)

/* --------------------------------------------------------- base requirement */

describe('the base requirement chip', () => {
  it('says a base is needed for a topper — 2,137 items', () => {
    const item = aggregate(
      record({ layer: 'topper', tags: [TAG['shape|wall'], TAG['connection|openforge']] }),
    )

    expect(availabilityOf(item).base).toBe('always')
    expect(labels(item)).toEqual(['Needs a base'])
  })

  it('says no base is needed for a self-sufficient print — 754 items', () => {
    const item = aggregate(
      record({ layer: 'integral', tags: [TAG['shape|wall'], TAG['connection|openlock']] }),
    )

    expect(availabilityOf(item).base).toBe('never')
    expect(labels(item)).toEqual(['No base needed', 'OpenLOCK'])
  })

  it('says the choice exists for the merged pair — 931 items', () => {
    const item = aggregate(
      record({
        design: 'dpair',
        layer: 'topper',
        tags: [TAG['shape|wall'], TAG['connection|openforge']],
      }),
      record({
        design: 'dpair',
        layer: 'integral',
        tags: [TAG['shape|wall'], TAG['connection|openlock']],
      }),
    )

    expect(availabilityOf(item).base).toBe('either')
    expect(labels(item)).toEqual(['Base optional', 'OpenLOCK'])
  })

  it('is on every strip, so the strip is never empty', () => {
    // A topper with no lock anywhere is the commonest shape in the corpus —
    // 1,878 items — and its whole strip is this one chip.
    const bare = aggregate(
      record({ layer: 'topper', tags: [TAG['shape|wall'], TAG['connection|openforge']] }),
    )

    expect(availabilityChips(availabilityOf(bare))).toHaveLength(1)
  })
})

/* ---------------------------------------------------------------- lock chips */

describe('the lock chips', () => {
  it('marks a system on the underside as the self-sufficient state', () => {
    const item = aggregate(
      record({ layer: 'integral', tags: [TAG['shape|wall'], TAG['connection|dragonlock']] }),
    )

    expect(availabilityOf(item).locks).toEqual([{ lock: 'dragonlock', reach: 'underside' }])
    expect(states(item)).toEqual(['base:have', 'lock:underside'])
    expect(labels(item)).toEqual(['No base needed', 'DragonLock'])
  })

  it('marks a system only on the side as the sides state, and says so in the label', () => {
    const item = aggregate(
      record({
        layer: 'topper',
        tags: [TAG['shape|wall'], TAG['connection|openforge'], TAG['connection|side|dragonlock']],
      }),
    )

    expect(availabilityOf(item).locks).toEqual([{ lock: 'dragonlock', reach: 'sides' }])
    expect(labels(item)).toEqual(['Needs a base', 'DragonLock sides'])
  })

  it('prefers the underside when a system is on both faces — 555 items for openlock', () => {
    const item = aggregate(
      record({
        layer: 'integral',
        tags: [TAG['shape|wall'], TAG['connection|openlock'], TAG['connection|side|openlock']],
      }),
    )

    // The stronger claim wins: one chip, not two, and it says "print one part".
    expect(availabilityOf(item).locks).toEqual([{ lock: 'openlock', reach: 'underside' }])
    expect(labels(item)).toEqual(['No base needed', 'OpenLOCK'])
  })

  it('orders the chips openlock, dragonlock, magnetic whatever the tag order', () => {
    const item = aggregate(
      record({
        layer: 'integral',
        tags: [
          TAG['shape|wall'],
          TAG['connection|magnetic'],
          TAG['connection|dragonlock'],
          TAG['connection|openlock'],
        ],
      }),
    )

    expect(availabilityOf(item).locks.map((chip) => chip.lock)).toEqual([
      'openlock',
      'dragonlock',
      'magnetic',
    ])
    expect(LOCK_CHIP_ORDER).toEqual(['openlock', 'dragonlock', 'magnetic'])
  })

  it('emits no chip for a system on neither face', () => {
    const item = aggregate(
      record({ layer: 'integral', tags: [TAG['shape|wall'], TAG['connection|openlock']] }),
    )

    // Three lock systems exist; only the one the mesh carries gets a chip. The
    // alternative — three chips always, one of them dimmed — would put 2,027
    // items' worth of dark furniture on the grid to say nothing.
    expect(availabilityOf(item).locks).toHaveLength(1)
  })

  it('emits no chip for a system that is not a lock', () => {
    const item = aggregate(
      record({
        layer: 'topper',
        tags: [TAG['shape|wall'], TAG['connection|openforge'], TAG['connection|side|filament']],
      }),
    )

    // `filament` is a side system on 114 records and is not something the builder
    // can be locked to, so it gets no chip. All 26 such items are toppers, so
    // none of them loses its only chip to the omission — which this asserts.
    expect(availabilityOf(item).locks).toEqual([])
    expect(labels(item)).toEqual(['Needs a base'])
  })

  it('has no side state for magnetic, because side-ness is a state and not a chip', () => {
    // There is no `connection|side|magnetic` in the corpus — 0 aggregates — so
    // the only way magnetic reaches a chip is on the underside. Modelled here as
    // a state the vocabulary allows and the data never produces, rather than as a
    // symmetrical grid cell that could never light.
    const underside = aggregate(
      record({ layer: 'integral', tags: [TAG['shape|wall'], TAG['connection|magnetic']] }),
    )

    expect(availabilityOf(underside).locks).toEqual([{ lock: 'magnetic', reach: 'underside' }])
    expect(labels(underside)).toEqual(['No base needed', 'Magnetic'])
  })
})

/* -------------------------------------------------------------------- notes */

describe('the joinery note', () => {
  it('reports an insert, which never meets the grid — 94 items', () => {
    const item = aggregate(record({ layer: 'insert', kinds: [], tags: [] }))

    expect(availabilityOf(item).note).toBe('insert')
    expect(labels(item)).toEqual(['No base needed', 'Insert'])
  })

  it('reports untagged joinery as unknown rather than incompatible — 93 items', () => {
    const item = aggregate(record({ layer: 'integral', tags: [TAG['shape|wall']] }))

    expect(item.joineryUntagged).toBe(true)
    expect(availabilityOf(item).note).toBe('untagged')
    expect(labels(item)).toEqual(['No base needed', 'Joinery untagged'])
  })

  it('is absent when a lock is named', () => {
    const item = aggregate(
      record({ layer: 'integral', tags: [TAG['shape|wall'], TAG['connection|openlock']] }),
    )

    expect(availabilityOf(item).note).toBeUndefined()
  })

  it('is absent for a topper, whose base chip already carries it', () => {
    const item = aggregate(
      record({ layer: 'topper', tags: [TAG['shape|wall'], TAG['connection|openforge']] }),
    )

    expect(availabilityOf(item).note).toBeUndefined()
  })

  it('still appears beside a side-only lock chip — 22 items read this way', () => {
    const item = aggregate(
      record({
        layer: 'integral',
        tags: [TAG['shape|wall'], TAG['connection|side|openlock']],
      }),
    )

    // Untagged is a claim about the *underside*; a side lock does not settle it.
    expect(labels(item)).toEqual(['No base needed', 'OpenLOCK sides', 'Joinery untagged'])
  })
})

/* ------------------------------------------------------------------- labels */

describe('every chip carries a label and a sentence', () => {
  it('names all three base requirements', () => {
    expect((['always', 'never', 'either'] as const).map(baseRequirementLabel)).toEqual([
      'Needs a base',
      'No base needed',
      'Base optional',
    ])
    for (const base of ['always', 'never', 'either'] as const) {
      expect(baseRequirementHint(base).trim()).not.toBe('')
    }
  })

  it('spells the systems the way the people who made them spell them', () => {
    expect(LOCK_CHIP_ORDER.map((lock) => lockChipLabel({ lock, reach: 'underside' }))).toEqual([
      'OpenLOCK',
      'DragonLock',
      'Magnetic',
    ])
    // Not `Openforge`-style sentence case, and not an invented abbreviation.
    for (const lock of LOCK_CHIP_ORDER) {
      for (const reach of ['underside', 'sides'] as const) {
        expect(lockChipHint({ lock, reach })).toContain(lockChipLabel({ lock, reach: 'underside' }))
      }
    }
  })

  it('names both notes', () => {
    expect((['insert', 'untagged'] as const).map(joineryNoteLabel)).toEqual([
      'Insert',
      'Joinery untagged',
    ])
    for (const note of ['insert', 'untagged'] as const) {
      expect(joineryNoteHint(note).trim()).not.toBe('')
    }
  })

  it('gives every chip a non-empty label and hint, so none renders blank', () => {
    const every: AvailabilityChip[] = [
      ...(['always', 'never', 'either'] as const).flatMap((base) =>
        availabilityChips({ base, locks: [], note: undefined }),
      ),
      ...LOCK_CHIP_ORDER.flatMap((lock) =>
        (['underside', 'sides'] as const).flatMap((reach) =>
          availabilityChips({ base: 'never', locks: [{ lock, reach }], note: undefined }),
        ),
      ),
      ...(['insert', 'untagged'] as const).flatMap((note) =>
        availabilityChips({ base: 'never', locks: [], note }),
      ),
    ]

    for (const chip of every) {
      expect(chip.label.trim()).not.toBe('')
      expect(chip.hint.trim()).not.toBe('')
      expect(chip.key).toMatch(/^(?:base|lock|note):/)
    }
  })

  it('keys the chips uniquely within a strip, so React can reconcile them', () => {
    const chips = availabilityChips({
      base: 'never',
      locks: [
        { lock: 'openlock', reach: 'underside' },
        { lock: 'dragonlock', reach: 'sides' },
      ],
      note: 'untagged',
    })

    expect(new Set(chips.map((chip) => chip.key)).size).toBe(chips.length)
  })
})

/* ------------------------------------------------------------------- budget */

describe('the fixed two-line strip has room for the widest row', () => {
  /**
   * The widest strip the label vocabulary can produce, not the widest the corpus
   * happens to contain.
   *
   * Built from the labels rather than hard-coded, so a relabel is measured
   * instead of being trusted. `magnetic` is given its `underside` label because
   * that is the only state it reaches; giving it `sides` here would make the
   * budget defend a row the data cannot produce and could mask a real overflow
   * elsewhere.
   */
  const widest = availabilityChips({
    base: 'never',
    locks: [
      { lock: 'openlock', reach: 'sides' },
      { lock: 'dragonlock', reach: 'sides' },
      { lock: 'magnetic', reach: 'underside' },
    ],
    note: undefined,
  })

  it('never emits more chips than the box holds', () => {
    const most = availabilityChips({
      base: 'never',
      locks: LOCK_CHIP_ORDER.map((lock) => ({ lock, reach: 'sides' as const })),
      note: 'untagged',
    })

    expect(most).toHaveLength(5)
    // Five is unreachable: a strip with three lock chips and a note needs an item
    // that names a lock *and* records nothing on its underside, and the note
    // branches are `insert-only` (which has no lock in 93 of 94 cases) and
    // `joineryUntagged` (which is bounded by two side systems, magnetic having
    // none). `corpus.test.ts` asserts the real ceiling of four.
    expect(CHIP_BUDGET.chips).toBe(4)
  })

  it('fits the measured worst case inside the two-line box', () => {
    // `No base needed · OpenLOCK sides · DragonLock sides · Joinery untagged` —
    // 4 chips, 60 characters, 15 aggregates. See CHIP_BUDGET for the arithmetic.
    const worst = availabilityChips({
      base: 'never',
      locks: [
        { lock: 'openlock', reach: 'sides' },
        { lock: 'dragonlock', reach: 'sides' },
      ],
      note: 'untagged',
    })

    expect(worst).toHaveLength(CHIP_BUDGET.chips)
    expect(worst.reduce((total, chip) => total + chip.label.length, 0)).toBe(CHIP_BUDGET.characters)
    expect(chipStripWidth(worst)).toBeLessThanOrEqual(CHIP_BUDGET.widthPx)
  })

  it('fits the widest row the vocabulary allows, not only the one the corpus has', () => {
    expect(chipStripWidth(widest)).toBeLessThanOrEqual(CHIP_BUDGET.widthPx)
  })

  it('costs nothing for an empty strip', () => {
    expect(chipStripWidth([])).toBe(0)
  })
})
