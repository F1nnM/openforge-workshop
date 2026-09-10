/**
 * The aggregate layer against the real corpus.
 *
 * `src/catalog/aggregate.test.ts` proves the rules on inputs small enough to
 * read. This file proves the **numbers**, over all 8,702 tiles, because every one
 * of them is a claim about the corpus rather than about the code — and rows A2
 * through A7 are scoped against them. `docs/tile-aggregation.md` measured them
 * once, on 2026-09-01, with nothing protecting them from drift; row W7 will fold
 * the same figures into `docs/verify-catalog-facts.py`, and until then this is
 * what fails the build when one moves.
 *
 * Several have already moved since the research, and where they have, the drift
 * is named beside the assertion. The two biggest movers are both row W3's doing:
 * it gave 403 tiles a footprint, so 209 more toppers can be matched to a base,
 * which lifts every buildability figure.
 *
 * If the fixtures are not on this machine the whole block is skipped **loudly**,
 * with the path it looked in — the convention `catalog.test.ts` sets.
 */
import { existsSync, readdirSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import type { TileAggregate } from '../src/catalog/aggregate'
import { buildAggregateIndex, selectVariant } from '../src/catalog/aggregate'
import { SCHEMA_VERSION } from '../src/catalog/schema'

import { assertAggregation, measureAggregation } from './aggregate'
import { buildCatalog } from './build'
import { LOCK_SYSTEMS } from './facets'
import type { FixtureRow } from './fixtures'
import { fixturesDir, loadFixtureRows } from './fixtures'
import { emptyMountInventory } from './mounts'
import { emptyManifest } from './ordinals'
import { PIPELINE_VERSION } from './version'

const FIXTURES_DIR = fixturesDir()
const hasFixtures = existsSync(FIXTURES_DIR) && readdirSync(FIXTURES_DIR).some((name) => name.endsWith('.json'))
const describeCorpus = hasFixtures ? describe : describe.skip
const title = hasFixtures
  ? 'aggregation over the real corpus'
  : `aggregation over the real corpus — SKIPPED, no fixtures at ${FIXTURES_DIR} (set OPENFORGE_FIXTURES)`

/** Building 8,702 records twice over is seconds of real work, not a 5 s default. */
const SLOW_MS = 120_000

describeCorpus(title, () => {
  const rows: FixtureRow[] = hasFixtures ? loadFixtureRows(FIXTURES_DIR) : []
  const result = buildCatalog({
    rows,
    manifest: emptyManifest(),
    thumbs: new Set(),
    mounts: emptyMountInventory(),
    fixturesRef: 'test',
    builtAt: '2026-01-01T00:00:00.000Z',
  })
  const index = buildAggregateIndex(result.file)
  const report = measureAggregation(result.file)

  /** Systems on a face, narrowed to the three the user chooses between. */
  const locks = (systems: readonly string[]): string[] =>
    systems.filter((system) => (LOCK_SYSTEMS as readonly string[]).includes(system))

  const countWhere = (predicate: (aggregate: TileAggregate) => boolean): number =>
    index.aggregates.filter(predicate).length

  it('collapses 8,702 files into 3,822 items, 2.28 each', () => {
    expect(index.stats.files).toBe(8702)
    expect(index.stats.aggregates).toBe(3822)
    expect(index.stats.files / index.stats.aggregates).toBeCloseTo(2.28, 2)
  })

  it('is 55.4% singletons and tops out at 20 files', () => {
    expect(index.stats.groupSizes[1]).toBe(2117)
    const sizes = Object.keys(index.stats.groupSizes).map(Number)
    expect(Math.max(...sizes)).toBe(20)
  })

  it('holds the five shapes the aggregation rows are scoped against', () => {
    expect(index.stats.classes).toEqual({
      'topper-only': 2137,
      both: 931,
      'base-only': 340,
      'integrated-only': 320,
      'insert-only': 94,
      mixed: 0,
    })
  })

  it('merges 931 pairs — and only 931, which is why no looser key is worth it', () => {
    // The research measured three looser keys (collapsing `build`, collapsing
    // `size|openlock`, and both) and all three produce this same number. What a
    // looser key adds is bad merges: `build|separate wall` joined to
    // `build|wall on tile`, which is a wall fused to its floor tile — a different
    // product.
    expect(index.stats.needsBase.either).toBe(931)
    expect(index.stats.needsBase.always).toBe(2137)
    expect(index.stats.needsBase.never).toBe(754)
  })

  it('never merges a base with anything else', () => {
    // `shape|base` is in the design key, so a base is always its own design.
    // That is the right answer — a base is a separately printed part with its own
    // purchase decision — and it means aggregation does not merge a base into the
    // tile it supports.
    const mixedWithBase = countWhere(
      (aggregate) =>
        aggregate.variants.some((variant) => variant.layer === 'base') &&
        aggregate.variants.some((variant) => variant.layer !== 'base'),
    )
    expect(mixedWithBase).toBe(0)
  })

  it('is lossless on every facet the card and the sidebar hoist', () => {
    // The strongest measured result behind this row. Not one aggregate holds two
    // distinct values of any of the seven, so aggregation needs no new title
    // logic, no facet re-derivation and no footprint reconciliation.
    for (const field of ['name', 'kinds', 'texture', 'build', 'sizeCode', 'rotStep', 'foot']) {
      expect(index.stats.varies[field], field).toBe(0)
    }
  })

  it('is not lossless on the connection axis, and says exactly where', () => {
    expect(index.stats.varies.layer).toBe(931)
    expect(index.stats.varies.conn).toBe(1563)
    expect(index.stats.varies.family).toBe(1589)
    expect(index.stats.varies.bytes).toBe(1669)
    expect(index.stats.varies.blob).toBe(1680)
    // Research: `conn` 1,565. Row D2 folded three phantom positions out of the
    // vocabulary and D3 collapsed a tag alias; two aggregates stopped varying.
  })

  it('varies `sprite` on exactly one aggregate, which is why `preview` exists', () => {
    expect(index.stats.varies.sprite).toBe(1)
    const varying = index.aggregates.find(
      (aggregate) => new Set(aggregate.variants.map((variant) => variant.sprite)).size > 1,
    )
    expect(varying?.variants.some((variant) => !variant.sprite)).toBe(true)
    // The card shows a variant that has a picture, not simply the first one.
    // This aggregate holds no topper, so row V5's tier 1 passes it over and
    // tier 2 is what saves its card — see the V5 block below.
    expect(varying?.variants.find((variant) => variant.id === varying.preview)?.sprite).toBe(true)
    expect(varying?.variants.some((variant) => variant.layer === 'topper')).toBe(false)
  })

  /* --------------------------------------------------- row V5: the preview rule */

  /**
   * What the preview rule was before row V5 — *the first sprite-carrying variant
   * in variant order* — kept here so the change can be measured as a difference
   * rather than asserted as a total. A total agrees with several rules; a
   * per-aggregate diff against the rule it replaced agrees with one.
   */
  const previewBeforeV5 = (aggregate: TileAggregate): string =>
    (aggregate.variants.find((variant) => variant.sprite) ?? aggregate.variants[0]).id

  const layersOf = (aggregate: TileAggregate): Set<string> =>
    new Set(aggregate.variants.map((variant) => variant.layer))

  const variantOf = (aggregate: TileAggregate, id: string) =>
    aggregate.variants.find((variant) => variant.id === id)

  it('moves exactly 6 previews of 3,822, and leaves 3,816 where they were', () => {
    // The whole scope of the row, stated as the number it must not exceed. A
    // change that moved more than six previews would be a different change: the
    // preference is meant to *formalise* an ordering that was already right in
    // 925 of 931 mixed cases, not to re-pick the corpus.
    const moved = index.aggregates.filter((aggregate) => aggregate.preview !== previewBeforeV5(aggregate))
    expect(moved).toHaveLength(6)
    expect(index.aggregates.length - moved.length).toBe(3816)
  })

  it('names the 6 aggregates that previewed a dragonlock integral over an openforge topper', () => {
    const moved = index.aggregates
      .filter((aggregate) => aggregate.preview !== previewBeforeV5(aggregate))
      .map((aggregate) => {
        const was = variantOf(aggregate, previewBeforeV5(aggregate))
        const now = variantOf(aggregate, aggregate.preview)
        return `${aggregate.name} :: ${was?.file ?? '?'} -> ${now?.file ?? '?'}`
      })
      .sort()

    expect(moved).toEqual([
      'Brick A Foundation Wall Edge Stairs 1.5x BA :: brick#foundation,stairs+edge,a.BA.dragonlock.stl -> brick#foundation,stairs+edge,a.BA.openforge,side.stl',
      'Brick B Foundation Wall Edge Stairs 1.5x BA :: brick#foundation,stairs+edge,b.BA.dragonlock.stl -> brick#foundation,stairs+edge,b.BA.openforge,side.stl',
      'Brick Foundation Stairs 1x1 :: brick#foundation,stairs.I.dragonlock.stl -> brick#foundation,stairs.I.openforge.stl',
      'Brick Foundation Stairs 2x1 :: brick#foundation,stairs.S.dragonlock.stl -> brick#foundation,stairs.S.openforge.stl',
      'Cave Entrance 6x2 :: cave#cave_entrance.6x2.dragonlock.stl -> cave#cave_entrance.6x2.openforge.stl',
      'Cave Squares Entrance 6x2 :: cave#cave_entrance+squares.6x2.dragonlock.stl -> cave#cave_entrance+squares.6x2.openforge.stl',
    ])

    // Every one is the same shape: the group's lowest ordinal is a `dragonlock`
    // integral, so it headed the variant list and the old rule stopped there.
    for (const aggregate of index.aggregates.filter(
      (candidate) => candidate.preview !== previewBeforeV5(candidate),
    )) {
      expect(aggregate.variantClass).toBe('both')
      expect(aggregate.variants[0].layer).toBe('integral')
      expect(aggregate.variants[0].sprite).toBe(true)
      expect(variantOf(aggregate, aggregate.preview)?.layer).toBe('topper')
    }
  })

  it('previews a topper on every one of the 3,068 aggregates that hold one', () => {
    // The rule, stated as a property rather than a diff: if a sprite-carrying
    // topper exists, the card shows it. 925 of the 931 mixed aggregates already
    // satisfied this before the row and 6 did not.
    const withTopper = index.aggregates.filter((aggregate) => layersOf(aggregate).has('topper'))
    expect(withTopper).toHaveLength(3068)
    for (const aggregate of withTopper) {
      expect(variantOf(aggregate, aggregate.preview)?.layer, aggregate.name).toBe('topper')
    }

    const already = withTopper.filter(
      (aggregate) => layersOf(aggregate).has('integral') && previewBeforeV5(aggregate) === aggregate.preview,
    )
    expect(already).toHaveLength(925)
  })

  it('cannot move the 754 aggregates that hold no topper', () => {
    // The no-op half. Tier 1 needs a `topper` to fire, so a `base`, an
    // `integral`-only or an `insert` item falls to tier 2 and picks exactly what
    // the old rule picked. This is where "more than six moved" would surface.
    const byClass = { base: 0, integral: 0, insert: 0 }
    for (const aggregate of index.aggregates) {
      const layers = layersOf(aggregate)
      if (layers.has('topper')) continue
      expect(aggregate.preview, aggregate.name).toBe(previewBeforeV5(aggregate))
      expect(layers.size).toBe(1)
      for (const layer of layers) byClass[layer as keyof typeof byClass] += 1
    }
    expect(byClass).toEqual({ base: 340, integral: 320, insert: 94 })
  })

  it('reaches tier 1 on all 3,068 and tier 2 on the rest — so the corpus proves neither the sprite clause nor the fallback', () => {
    // Named as a limit rather than left implicit. Tier 1's `&& sprite` never
    // fires here because every topper-carrying aggregate has a sprite-carrying
    // topper, and tier 3 is unreachable because no aggregate lacks a sprite
    // everywhere. Both are proved on fixtures in `src/catalog/aggregate.test.ts`;
    // this test exists to say that these totals cannot.
    const spritelessTopperAggregates = index.aggregates.filter(
      (aggregate) =>
        layersOf(aggregate).has('topper') &&
        !aggregate.variants.some((variant) => variant.layer === 'topper' && variant.sprite),
    )
    expect(spritelessTopperAggregates).toHaveLength(0)
    expect(index.aggregates.filter((aggregate) => aggregate.variants.every((variant) => !variant.sprite))).toHaveLength(0)
    expect(index.aggregates.filter((aggregate) => aggregate.variants.some((variant) => variant.sprite))).toHaveLength(3822)
  })

  it('disagrees with `selectVariant` on 1,598 aggregates, and that is the point of both', () => {
    // The preview picks the picture of the item; `selectVariant` picks the file
    // to print, and its first criterion is the opposite one — prefer one part
    // over two. If these two ever agreed everywhere, one of them would have
    // stopped answering its own question.
    const disagree = index.aggregates.filter((aggregate) => selectVariant(aggregate).variant.id !== aggregate.preview)
    expect(disagree).toHaveLength(1598)

    // All 931 mixed aggregates are in it, by construction rather than by count.
    const mixed = index.aggregates.filter(
      (aggregate) => layersOf(aggregate).has('topper') && layersOf(aggregate).has('integral'),
    )
    expect(mixed).toHaveLength(931)
    for (const aggregate of mixed) {
      expect(selectVariant(aggregate).variant.needsBase, aggregate.name).toBe(false)
      expect(variantOf(aggregate, aggregate.preview)?.needsBase, aggregate.name).toBe(true)
    }
  })

  it('leaves every catalog URL where it was, even on the six that moved', () => {
    // `variants[0].ord` is the catalog address and no tier touches it. The six
    // that moved are the proof: each still addresses the integral it no longer
    // shows.
    for (const aggregate of index.aggregates.filter(
      (candidate) => candidate.preview !== previewBeforeV5(candidate),
    )) {
      expect(Number(aggregate.address)).toBe(Number(aggregate.variants[0].ord))
      expect(aggregate.variants[0].id).not.toBe(aggregate.preview)
    }
  })

  it('varies `config` on 828 aggregates, which is why the slots are a union', () => {
    expect(index.stats.varies.config).toBe(828)
    // And on 12 of them the union is larger than *every* variant's own set: no
    // single file carries all the slots the item offers, so "pick the richest
    // variant" would lose a slot outright rather than merely lose provenance.
    expect(index.stats.configUnionExceedsEveryVariant).toBe(12)
    // And the provenance is load-bearing rather than decorative: slots that only
    // some variants declare are the common case, not the exception.
    const partial = index.aggregates.flatMap((aggregate) =>
      aggregate.slots.filter((slot) => !slot.universal),
    )
    expect(partial.length).toBeGreaterThan(0)
  })

  it('surfaces the untagged-joinery gap rather than hiding it', () => {
    // 93 aggregates, every one `integrated-only`: the tags name no bottom system
    // at all. 33 of the underlying records name a lock in the filename only, 18
    // of those an imperial/metric magnet size that exists nowhere in the tag
    // vocabulary. The honest verdict is "unknown", not "incompatible".
    expect(index.stats.joineryUntagged).toBe(93)
    const untagged = index.aggregates.filter((aggregate) => aggregate.joineryUntagged)
    expect(new Set(untagged.map((aggregate) => aggregate.variantClass))).toEqual(new Set(['integrated-only']))
    for (const aggregate of untagged) {
      expect(selectVariant(aggregate, { bottom: 'openlock' }).verdict).toBe('unknown-joinery')
    }
  })

  it('cuts visible duplication by 19x', () => {
    /* 6,749 files share a display name with another file today, and the worst
       single query returns 24 identical-looking cards. After the collapse: 130
       names over 321 aggregates, worst case 6.

       131 / 323 before row **D9**. A display name carries the size token, and
       correcting 245 corner walls from a 2-unit run to their measured 1.5 turns
       `2x` into `1.5x` on them — which *separates* one name that two aggregates
       used to share. So the duplication figure improved for the same reason the
       footprint did: two things that looked alike were different sizes. */
    expect(index.stats.duplicateNames).toEqual({ names: 130, aggregates: 321, worst: 6 })
    const perFile = new Map<string, number>()
    for (const record of result.file.records) perFile.set(record.name, (perFile.get(record.name) ?? 0) + 1)
    expect(Math.max(...perFile.values())).toBe(24)
  })

  it('detects "needs a base" at 100% precision and 99.9% recall', () => {
    // Scored against the filename's connection token — a description of the same
    // file authored in Dropbox rather than in the fixture rows, and one no part of
    // the rule reads.
    expect(report.detection.flagged).toBe(4363)
    expect(report.detection.truthPositives).toBe(4367)
    expect(report.detection.falsePositives).toBe(0)
    expect(report.detection.precision).toBe(1)
    expect(report.detection.recall).toBeCloseTo(0.999, 3)
    // All four misses, by name. Each is the same corpus defect: a filename that
    // says openforge on a row carrying no `connection|` tag at all.
    expect(report.detection.missed).toEqual([
      'tiles/catacombs/thick_wall/loculus/catacombs#wall,loculus.S.openforge+split,top,arch.stl',
      'tiles/catacombs/thick_wall/loculus/catacombs#wall,loculus.S.openforge+split,top,flat.stl',
      'tiles/dungeon_stone/wall_on_tile/wall+special/statue_and_secret_door/dungeon_stone#wall,secret_door+broken_section.2x.openforge.stl',
      'tiles/dungeon_stone/wall_on_tile/wall+special/statue_and_secret_door/dungeon_stone#wall,secret_door+tamoachan_statue.2x.openforge.stl',
    ])
  })

  it('never puts a lock on a topper own underside, and 1,283 toppers put one on the side', () => {
    const toppers = index.aggregates.flatMap((aggregate) =>
      aggregate.variants.filter((variant) => variant.needsBase),
    )
    expect(toppers).toHaveLength(4363)
    expect(toppers.filter((variant) => locks(variant.bottomConn).length > 0)).toHaveLength(0)
    // Every one declares `openforge` there instead — which *is* the declaration
    // that the joinery lives on a separately printed base.
    expect(toppers.every((variant) => variant.bottomConn.includes('openforge'))).toBe(true)
    // Read off the flattened `conn` these 1,283 look like tiles that offer
    // dragonlock. They offer it to the neighbour, not to the table.
    expect(toppers.filter((variant) => locks(variant.sideConn).length > 0)).toHaveLength(1283)
  })

  it('holds the availability chips A3 renders', () => {
    // Deliberately *not* "which locks exist somewhere in this family": that
    // vocabulary was measured and is useless, sitting on ~67% of the catalog for
    // all three systems because the base families are system-complete. These
    // answer "what do I have to print".
    expect(countWhere((aggregate) => aggregate.variantClass === 'topper-only')).toBe(2137)
    expect(countWhere((aggregate) => aggregate.selfSufficientConn.includes('openlock'))).toBe(1497)
    expect(countWhere((aggregate) => aggregate.selfSufficientConn.includes('dragonlock'))).toBe(359)
    expect(countWhere((aggregate) => aggregate.selfSufficientConn.includes('magnetic'))).toBe(255)
    expect(countWhere((aggregate) => aggregate.sideConn.includes('openlock'))).toBe(848)
    expect(countWhere((aggregate) => aggregate.sideConn.includes('dragonlock'))).toBe(468)
    // Magnets are never a side connector in this corpus, so the chip would be
    // dead. A7 needs to know that before it offers three symmetrical rows.
    expect(countWhere((aggregate) => aggregate.sideConn.includes('magnetic'))).toBe(0)
  })

  it('reaches those same counts through selectVariant, which is what A6 calls', () => {
    for (const [lock, expected] of [
      ['openlock', 1497],
      ['dragonlock', 359],
      ['magnetic', 255],
    ] as const) {
      const oneParter = countWhere(
        (aggregate) => selectVariant(aggregate, { bottom: lock }).verdict === 'self-sufficient',
      )
      expect(oneParter, lock).toBe(expected)
    }
  })

  it('names the print options the corpus actually uses, and no others', () => {
    // `pegs` is a connection system on 147 records and never a modifier;
    // `filament` occupies a modifier position only in `connection|side|filament`,
    // where it *is* the side system. Counting either as a print option would
    // invent an option and, for filament, lose 114 toppers' only side connector.
    expect(report.options).toEqual({ flex: 1159, topless: 384, unsupported: 421, split: 1 })
  })

  it('addresses every aggregate with an ordinal one of its own files already holds', () => {
    for (const aggregate of index.aggregates) {
      const address = aggregate.address as unknown as number
      expect(aggregate.variants.some((variant) => (variant.ord as unknown as number) === address)).toBe(true)
    }
    expect(new Set(index.aggregates.map((aggregate) => aggregate.address)).size).toBe(3822)
    // 1,705 aggregates hold two or more files, so 44.6% of addresses would move
    // if their lowest-ordinal file were retired. Acceptable only because this
    // number never enters a share link.
    expect(countWhere((aggregate) => aggregate.variants.length > 1)).toBe(1705)
  })

  it('leaves the manifest and the version stamp alone', () => {
    // Aggregation adds no field and no key, so an index is fully readable under
    // it — which is what the stamp is supposed to mean. Pinned against
    // `SCHEMA_VERSION` rather than against the literal `3` this row inherited:
    // row P3 took the schema to 4 by adding `CatalogRecord.thumb`, which is a
    // field and *is* announced, and a literal here read as though aggregation
    // had announced it. What A1's claim needs is that this build's stamp is the
    // module's, unmodified, and `pipeline/version.ts` is where the two numbers
    // are argued about.
    expect(result.file.version.schema).toBe(SCHEMA_VERSION)
    expect(result.file.version.pipeline).toBe(PIPELINE_VERSION)
    expect(result.file.records).toHaveLength(8702)
    // Every record still carries its own ordinal; nothing was renumbered.
    expect(new Set(result.file.records.map((record) => record.ord)).size).toBe(8702)
  })

  it('reports the aggregates the key genuinely cannot tell apart', () => {
    // 145 aggregates hold two or more files that agree on **every** axis a
    // variant control could offer — needs-a-base, both faces' systems and the
    // print option — and are still different meshes. `Aztlan Idol Treasure` is
    // three different idols under one name. These are pre-existing corpus
    // problems aggregation makes *visible* rather than creates: today they render
    // as several indistinguishable cards. Row A5's variants table is the cover,
    // and no chip design fixes them.
    //
    // The research says 182 on a looser axis — lock systems only, so a `dual` or
    // `pegs` difference did not separate two files — and the same-md5 case was not
    // excluded there. 25 tie groups are one physical STL filed under two catalog
    // paths, which is correct data modelling and not an ambiguity, so this
    // measurement compares the blob too.
    expect(report.ambiguous).toBe(145)
  })

  it('passes its own invariants, and reports them all in one place', () => {
    expect(report.violations).toEqual([])
    expect(() => {
      assertAggregation(report)
    }).not.toThrow()
  })

  it('surfaces the aggregate figures on BuildStats', () => {
    expect(result.stats.aggregateClasses).toEqual(index.stats.classes)
    expect(result.stats.baseDetection.precision).toBe(1)
    expect(result.stats.baseDetection.missed).toBe(4)
    expect(result.stats.aggregatesWithVaryingConfig).toBe(828)
  })

  it(
    'derives the same index twice, byte for byte',
    () => {
      const again = buildAggregateIndex(result.file)
      expect(JSON.stringify(again.aggregates)).toBe(JSON.stringify(index.aggregates))
    },
    SLOW_MS,
  )
})
