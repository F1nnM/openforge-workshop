/// <reference types="node" />
/**
 * Lock buildability.
 *
 * Same two-group split as `reach.test.ts`, for the same reason:
 *
 *   1. **The derivation, over a fourteen-design fixture.** Every figure the
 *      picker shows comes out of the index it was handed, so the assertions here
 *      are about the *rule*. The fixture is built so that all three of the real
 *      corpus's behaviours are present at a scale a reader can hold: one system
 *      falls when buildability is asked instead of reachability, one **rises**,
 *      and the spread between best and worst collapses. Its numbers are
 *      deliberately nothing like the archive's — 14 designs — so if `3,822`,
 *      `88.3%` or `3,375` ever shows up in a component test, something is reading
 *      a constant.
 *   2. **The real corpus, as a cross-check.** One block, skipped when the emitted
 *      index is absent, pinning the figures the picker actually shows and the
 *      relationships between the two readings that the copy asserts in words.
 *
 * ## Why the corpus block pins relationships and not only counts
 *
 * The counts have moved twice already: the research measured 3,199 / 2,928 /
 * 2,818 buildable, row A1 re-derived 3,352 / 3,087 / 2,977 after the footprint
 * classifier changed, and this row measures 3,375 / 3,118 / 3,008 against the
 * index as emitted today. Every one of those was correct when it was taken. What
 * has *not* moved through any of it is the shape of the answer — openlock below
 * its reachability, magnetic well above it, and a single-digit spread in place of
 * a 40-point one — and that shape is what the screen's copy claims in prose. So
 * the block asserts both: the counts, so a drift is visible and deliberate, and
 * the relationships, so a drift that would make the copy *wrong* fails
 * differently from one that merely makes it stale.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { CatalogFile, Footprint } from '@/catalog'
import { CatalogFile as CatalogFileSchema, MEASURED_SPRITE_SHEET, SCHEMA_VERSION } from '@/catalog'

import { buildOf, deriveLockBuild } from './build'
import { ALL_LOCK_SYSTEMS, shareLabel } from './reach'

/* ------------------------------------------------------------------ fixture */

interface Draft {
  readonly design: string
  readonly layer: 'base' | 'topper' | 'integral' | 'insert'
  /** Raw `connection|…` tags. `buildAggregateIndex` reads these for the positional split. */
  readonly conn: readonly string[]
  readonly foot?: Footprint
}

const MD5 = '0123456789abcdef0123456789abcde'

/** `['openforge', 'side|openlock']` from `['connection|openforge', 'connection|side|openlock']`. */
function flatten(conn: readonly string[]): string[] {
  return conn.map((tag) => tag.slice('connection|'.length))
}

/**
 * A parsed `CatalogFile` from a handful of drafts.
 *
 * Parsed rather than cast, so a draft that could not exist in a real index fails
 * here instead of quietly exercising the derivation on an impossible record. The
 * two connection fields are written from one source: `record.conn` is the
 * flattened form `reach.ts` and the base match read, `record.tags` the raw form
 * the aggregate's positional projection reads, and a fixture that let them
 * disagree would be testing a state the importer cannot produce.
 */
function catalog(drafts: readonly Draft[]): CatalogFile {
  const table: string[] = ['shape|wall']
  const intern = (tag: string): number => {
    const at = table.indexOf(tag)
    if (at !== -1) return at
    table.push(tag)
    return table.length - 1
  }
  const records = drafts.map((draft, i) => ({
    id: `tiles/x/${draft.design}/${draft.layer}.stl`,
    ord: i,
    blob: `${MD5}${String(i % 10)}`,
    file: `${draft.design}.${draft.layer}.stl`,
    bytes: 1000 + i,
    sprite: true,
    family: `tiles/x/${draft.design}`,
    design: draft.design,
    name: draft.design,
    kinds: [draft.layer === 'base' ? 'base' : 'wall'],
    conn: flatten(draft.conn),
    layer: draft.layer,
    tags: [0, ...draft.conn.map(intern)],
    foot: draft.foot ?? ({ shape: 'wall', length: 2 } satisfies Footprint),
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

const WALL: Footprint = { shape: 'wall', length: 2 }
const CELL: Footprint = { shape: 'rect', w: 1, d: 1 }
const BIG: Footprint = { shape: 'rect', w: 4, d: 4 }
const SLAB: Footprint = { shape: 'rect', w: 2, d: 2 }

/**
 * Fourteen designs, one record each, chosen so that every branch of the rule and
 * every direction of the reachability/buildability difference is present.
 *
 * | design(s) | what it is | reachable under | buildable under |
 * | --- | --- | --- | --- |
 * | `b-open-wall`, `b-open-cell` | openlock bases, `wall:2` and `rect:1x1` | openlock | openlock |
 * | `b-mag-wall` | a magnetic base, `wall:2` | magnetic | magnetic |
 * | `b-drag-cell`, `b-drag-slab` | dragonlock bases, `rect:1x1` and `rect:2x2` | dragonlock | dragonlock |
 * | `i-open` | an openlock integral — one part, no base | openlock | openlock |
 * | `t-side-a/b/c` | `wall:2` toppers whose only lock is on the **side** | openlock only | openlock **and magnetic** |
 * | `t-side-cell` | the same, `rect:1x1`, and the only dragonlock side connector | openlock, dragonlock | openlock, dragonlock |
 * | `t-free-wall` | a `wall:2` topper with no lock at all | all three | openlock, magnetic |
 * | `t-orphan` | a `rect:4x4` topper; no base is congruent | all three | **none** |
 * | `x-insert` | an insert, never on the grid | openlock | **none** |
 * | `x-untagged` | an integral with no connection tag at all | all three | **none** |
 *
 * So reachability is openlock 11, magnetic 4, dragonlock 5, and buildability is
 * openlock 8, magnetic 5, dragonlock 3. **Magnetic rises** — 4 to 5 — on the four
 * `wall:2` toppers whose own tags never mention it, which is exactly the corpus
 * behaviour that takes the real magnetic figure from 59.7% to 78.7%. **Openlock
 * falls** — 11 to 8 — on the three designs no base can carry. And the spread goes
 * from 50.0 points to 35.7, which is the collapse the aggregation row was for.
 */
const FIXTURE: readonly Draft[] = [
  { design: 'b-open-wall', layer: 'base', conn: ['connection|openlock'], foot: WALL },
  { design: 'b-open-cell', layer: 'base', conn: ['connection|openlock'], foot: CELL },
  { design: 'b-mag-wall', layer: 'base', conn: ['connection|magnetic'], foot: WALL },
  { design: 'b-drag-cell', layer: 'base', conn: ['connection|dragonlock'], foot: CELL },
  { design: 'b-drag-slab', layer: 'base', conn: ['connection|dragonlock'], foot: SLAB },
  { design: 'i-open', layer: 'integral', conn: ['connection|openlock'], foot: CELL },
  {
    design: 't-side-a',
    layer: 'topper',
    conn: ['connection|openforge', 'connection|side|openlock'],
    foot: WALL,
  },
  {
    design: 't-side-b',
    layer: 'topper',
    conn: ['connection|openforge', 'connection|side|openlock'],
    foot: WALL,
  },
  {
    design: 't-side-c',
    layer: 'topper',
    conn: ['connection|openforge', 'connection|side|openlock'],
    foot: WALL,
  },
  {
    design: 't-side-cell',
    layer: 'topper',
    conn: ['connection|openforge', 'connection|side|openlock', 'connection|side|dragonlock'],
    foot: CELL,
  },
  { design: 't-free-wall', layer: 'topper', conn: ['connection|openforge'], foot: WALL },
  { design: 't-orphan', layer: 'topper', conn: ['connection|openforge'], foot: BIG },
  { design: 'x-insert', layer: 'insert', conn: ['connection|openlock'], foot: CELL },
  { design: 'x-untagged', layer: 'integral', conn: [], foot: CELL },
]

const fixture = deriveLockBuild(catalog(FIXTURE))

/* --------------------------------------------------------------- derivation */

describe('deriveLockBuild', () => {
  it('counts designs, not files', () => {
    expect(fixture.totalDesigns).toBe(14)
  })

  it('counts a design it can resolve into a complete assembly', () => {
    expect(buildOf(fixture, 'openlock')?.buildable).toBe(8)
    expect(buildOf(fixture, 'magnetic')?.buildable).toBe(5)
    expect(buildOf(fixture, 'dragonlock')?.buildable).toBe(3)
  })

  it('separates the designs that need no base from the ones that do', () => {
    // Tier 1 — a variant carrying the lock on its own underside. Bases count,
    // because a base needs no base.
    expect(buildOf(fixture, 'openlock')?.onePart).toBe(3)
    expect(buildOf(fixture, 'magnetic')?.onePart).toBe(1)
    expect(buildOf(fixture, 'dragonlock')?.onePart).toBe(2)
    for (const system of ALL_LOCK_SYSTEMS) {
      const entry = buildOf(fixture, system)
      expect(entry?.withBase, system).toBe((entry?.buildable ?? 0) - (entry?.onePart ?? 0))
    }
  })

  it('rises above reachability where a base supplies the joinery', () => {
    // The whole argument for aggregating the catalog, at fixture scale: four
    // `wall:2` toppers never mention magnetic and a magnetic `wall:2` base
    // exists, so the app can hand you all four.
    const magnetic = buildOf(fixture, 'magnetic')
    expect(magnetic?.reach.designs).toBe(4)
    expect(magnetic?.buildable).toBe(5)
  })

  it('falls below reachability where nothing can be resolved', () => {
    // Reachability counts a design whose tags name no lock as reachable under
    // every option, and three such designs cannot be built under any.
    const openlock = buildOf(fixture, 'openlock')
    expect(openlock?.reach.designs).toBe(11)
    expect(openlock?.buildable).toBe(8)
  })

  it('collapses the spread', () => {
    expect(fixture.reach.spreadPoints).toBeCloseTo((100 * (11 - 4)) / 14, 6)
    expect(fixture.spreadPoints).toBeCloseTo((100 * (8 - 3)) / 14, 6)
    expect(fixture.spreadPoints).toBeLessThan(fixture.reach.spreadPoints)
  })

  it('refuses a base in the wrong system rather than counting it', () => {
    // Tier 3, which is not a tier this app offers: the only `wall:2` bases are
    // openlock and magnetic, so a dragonlock build gets no wall at all. Counting
    // "some base was found" here would promise an assembly whose two halves do
    // not clip together — a defect the bill flags, not a design you can build.
    expect(buildOf(fixture, 'dragonlock')?.buildable).toBe(3)
    const dragonlockOnly = deriveLockBuild(
      catalog([
        { design: 'b', layer: 'base', conn: ['connection|openlock'], foot: WALL },
        { design: 't', layer: 'topper', conn: ['connection|openforge'], foot: WALL },
      ]),
    )
    expect(buildOf(dragonlockOnly, 'dragonlock')?.buildable).toBe(0)
    expect(buildOf(dragonlockOnly, 'openlock')?.buildable).toBe(2)
  })

  it('never counts an insert as buildable, in any system', () => {
    // 94 aggregates in the archive. An insert is fitted into another piece and
    // never sits on the grid, so no lock preference reaches it.
    const inserts = deriveLockBuild(
      catalog([{ design: 'x', layer: 'insert', conn: ['connection|openlock'], foot: CELL }]),
    )
    for (const system of ALL_LOCK_SYSTEMS) expect(buildOf(inserts, system)?.buildable, system).toBe(0)
    expect(inserts.unbuildable).toEqual({ total: 1, inserts: 1, untagged: 0, noBase: 0 })
  })

  it('partitions what nothing can build, by reason', () => {
    expect(fixture.unbuildable.total).toBe(3)
    expect(fixture.unbuildable.inserts).toBe(1)
    expect(fixture.unbuildable.untagged).toBe(1)
    expect(fixture.unbuildable.noBase).toBe(1)
    // A partition, not three overlapping buckets — the screen adds them up in
    // prose and a double-counted design would make that sentence wrong.
    const { total, inserts, untagged, noBase } = fixture.unbuildable
    expect(inserts + untagged + noBase).toBe(total)
  })

  it('counts side connectors, and reports a zero as a zero', () => {
    // Magnetic is never a side connector in the archive — 0 of 3,822 — which is
    // why this is a number on the row rather than a chip in a trio. The fixture
    // reproduces the asymmetry rather than asserting it as a constant.
    expect(buildOf(fixture, 'openlock')?.sideJoinery).toBe(4)
    expect(buildOf(fixture, 'dragonlock')?.sideJoinery).toBe(1)
    expect(buildOf(fixture, 'magnetic')?.sideJoinery).toBe(0)
  })

  it('orders the options by buildability, not by reachability or declaration', () => {
    // In the fixture the two orderings agree; the assertion is that the order is
    // read off `buildable`, so a corpus where they disagreed would reorder the
    // list rather than leave a stale "recommended" at the top.
    expect(fixture.entries.map((entry) => entry.system)).toEqual(['openlock', 'magnetic', 'dragonlock'])
    const flipped = deriveLockBuild(
      catalog([
        { design: 'b1', layer: 'base', conn: ['connection|magnetic'], foot: WALL },
        { design: 'b2', layer: 'base', conn: ['connection|magnetic'], foot: CELL },
        { design: 'b3', layer: 'base', conn: ['connection|openlock'], foot: SLAB },
      ]),
    )
    expect(flipped.entries[0]?.system).toBe('magnetic')
  })

  it('breaks a tie by name, so the order is stable across runs', () => {
    const tied = deriveLockBuild(
      catalog([
        { design: 'b1', layer: 'base', conn: ['connection|dragonlock'], foot: WALL },
        { design: 'b2', layer: 'base', conn: ['connection|magnetic'], foot: CELL },
      ]),
    )
    expect(tied.entries.map((entry) => entry.system)).toEqual(['dragonlock', 'magnetic', 'openlock'])
  })

  it('counts what every system can build', () => {
    // Zero in the fixture, because each of its buildable designs is buildable in
    // one or two systems and never in all three.
    expect(fixture.buildableUnderAll).toBe(0)
    const universal = deriveLockBuild(
      catalog([
        { design: 'b1', layer: 'base', conn: ['connection|openlock'], foot: WALL },
        { design: 'b2', layer: 'base', conn: ['connection|dragonlock'], foot: WALL },
        { design: 'b3', layer: 'base', conn: ['connection|magnetic'], foot: WALL },
        { design: 't', layer: 'topper', conn: ['connection|openforge'], foot: WALL },
      ]),
    )
    expect(universal.buildableUnderAll).toBe(1)
  })

  it('survives an empty catalog rather than dividing by zero', () => {
    // What a component renders before its stubbed fetch resolves.
    const empty = deriveLockBuild(catalog([]))
    expect(empty.totalDesigns).toBe(0)
    expect(empty.spreadPoints).toBe(0)
    expect(empty.entries).toHaveLength(ALL_LOCK_SYSTEMS.length)
    for (const entry of empty.entries) {
      expect(entry.share).toBe(0)
      expect(Number.isNaN(entry.share)).toBe(false)
      expect(entry.reach.designs).toBe(0)
    }
    expect(empty.unbuildable.total).toBe(0)
  })

  it('carries the archive reading for every system, so a row needs one lookup', () => {
    for (const system of ALL_LOCK_SYSTEMS) {
      const entry = buildOf(fixture, system)
      expect(entry?.reach.system, system).toBe(system)
      expect(entry?.reach.designs, system).toBe(
        fixture.reach.entries.find((other) => other.system === system)?.designs,
      )
    }
  })
})

/* ------------------------------------------------------------- the real index */

const CATALOG_PATH = process.env.OPENFORGE_CATALOG ?? join(process.cwd(), 'public', 'catalog', 'catalog.json')
const corpus = existsSync(CATALOG_PATH)
  ? CatalogFileSchema.parse(JSON.parse(readFileSync(CATALOG_PATH, 'utf8')) as unknown)
  : undefined

if (corpus === undefined) {
  process.stderr.write(
    [
      '',
      `  build.test.ts: no catalog index at ${CATALOG_PATH};`,
      '  skipping the buildability figures.',
      '  Build one with: npm run import:catalog',
      '',
      '',
    ].join('\n'),
  )
}

describe.skipIf(corpus === undefined)('the buildability figures on the real index', () => {
  /**
   * What the emitted index says today, measured on `catalog.json` at fixtures
   * `4282896`, pipeline stamp 1.
   *
   * **Assertions about the corpus**, not values the app reads — the app derives
   * its own and never sees this table. It is here so that a rescan that moves the
   * figures the copy quotes fails visibly. It has moved twice already; see this
   * file's docblock.
   */
  const MEASURED = {
    designs: 3822,
    buildable: { openlock: 3375, dragonlock: 3118, magnetic: 3008 },
    onePart: { openlock: 1497, dragonlock: 359, magnetic: 255 },
    sideJoinery: { openlock: 848, dragonlock: 468, magnetic: 0 },
    reachable: { openlock: 3817, dragonlock: 2854, magnetic: 2282 },
    unbuildable: { total: 446, inserts: 94, untagged: 93, noBase: 259 },
    buildableUnderAll: 2988,
  } as const

  const build = deriveLockBuild(corpus ?? ({} as CatalogFile))

  it('reproduces the measured buildability table', () => {
    expect(build.totalDesigns).toBe(MEASURED.designs)
    for (const [system, designs] of Object.entries(MEASURED.buildable)) {
      expect(buildOf(build, system as never)?.buildable, system).toBe(designs)
    }
    // 88.3% / 81.6% / 78.7% — what each row's headline percentage reads.
    expect(shareLabel(buildOf(build, 'openlock')?.share ?? 0)).toBe('88.3%')
    expect(shareLabel(buildOf(build, 'dragonlock')?.share ?? 0)).toBe('81.6%')
    expect(shareLabel(buildOf(build, 'magnetic')?.share ?? 0)).toBe('78.7%')
  })

  it('reproduces the one-part counts, which run the other way', () => {
    // A1's tier-1 measurement. The sharpest real difference between the three
    // systems, and the reason the bar is split rather than flat: magnetic is
    // nearly as buildable as openlock and almost never a single print.
    for (const [system, designs] of Object.entries(MEASURED.onePart)) {
      expect(buildOf(build, system as never)?.onePart, system).toBe(designs)
    }
    expect(buildOf(build, 'openlock')?.onePart).toBeGreaterThan(buildOf(build, 'magnetic')?.onePart ?? 0)
    expect(buildOf(build, 'openlock')?.buildable).toBeGreaterThan(buildOf(build, 'magnetic')?.buildable ?? 0)
  })

  it('reproduces the archive reading it carries, unchanged', () => {
    for (const [system, designs] of Object.entries(MEASURED.reachable)) {
      expect(buildOf(build, system as never)?.reach.designs, system).toBe(designs)
    }
  })

  it('finds magnetic is never a side connector', () => {
    // The fact that stops the picker having three symmetrical side chips. If a
    // rescan ever produces one, this fails and the screen's copy has to change
    // shape rather than quietly print a "0".
    for (const [system, designs] of Object.entries(MEASURED.sideJoinery)) {
      expect(buildOf(build, system as never)?.sideJoinery, system).toBe(designs)
    }
  })

  it('partitions the designs nothing can build', () => {
    expect(build.unbuildable).toEqual(MEASURED.unbuildable)
    expect(build.buildableUnderAll).toBe(MEASURED.buildableUnderAll)
  })

  /**
   * The three claims the screen's prose makes, asserted as relationships rather
   * than as numbers.
   *
   * These are what must not break even when the counts move: the copy says
   * openlock is lower than its tags suggest, magnetic much higher, and the spread
   * single-digit against a 40-point one. A rescan that moved a count fails the
   * blocks above and is a bookkeeping job; a rescan that broke one of these
   * would make sentences on the settings screen false.
   */
  it('keeps the relationships the screen states in words', () => {
    const openlock = buildOf(build, 'openlock')
    const magnetic = buildOf(build, 'magnetic')

    // openlock falls: buildability refuses to count a design it cannot resolve.
    expect(openlock?.buildable).toBeLessThan(openlock?.reach.designs ?? 0)
    // magnetic rises, and by a lot: the auto-inserted base supplies the joinery.
    expect(magnetic?.buildable).toBeGreaterThan((magnetic?.reach.designs ?? 0) + 500)
    // And the spread the whole choice costs collapses into single digits.
    expect(build.spreadPoints).toBeLessThan(10)
    expect(build.reach.spreadPoints).toBeGreaterThan(40)
    expect(build.spreadPoints).toBeLessThan(build.reach.spreadPoints / 4)
  })
})
