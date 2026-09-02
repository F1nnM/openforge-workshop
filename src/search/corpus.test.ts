/**
 * The engine against the real corpus — **3,822 items over 8,702 files**.
 *
 * Everything asserted here is a **measured property of the data**, not of the
 * code: the queries §6 names must return plausible non-zero counts, the
 * concave/cave trap must stay shut, sizes that appear in zero tags must be
 * findable, and each facet's shape must match what the corpus does. The
 * disjunctive-count comparison against `oracle.ts` runs again at full scale,
 * because a bitset bug that only shows up past 8,192 members (the 257th word) is
 * exactly the kind that a small fixture hides.
 *
 * ## Every count in this file moved with row A2
 *
 * The engine now indexes row A1's aggregates, so a count is a number of *items*
 * and not of files, and the figures below are re-measured rather than scaled:
 * `cave` went from 368 files to 77 items, `dungeon_stone` from 3,130 to 1,566,
 * `build|separate wall` from 3,351 to 826. Two of the changes are load-bearing
 * rather than cosmetic:
 *
 *   - **`conn` gained members.** 2,493 files (28.6%) carry two or more systems;
 *     **1,605 items (42.0%)** do, because an item offers the union of its
 *     variants'. All 255 magnetic items are also openlock items, so selecting
 *     both systems returns exactly the openlock set — a collapse that is
 *     invisible at file level, where the two sets are 1,159 and 3,965 records.
 *   - **`build` still partitions.** Its buckets sum to exactly 3,822, which is
 *     only true because A1 measured `build` not to vary inside a group. That sum
 *     is the assertion guarding the hoist.
 *
 * It also **measures and prints** index build time and per-query time. The
 * architecture plan quotes ~10 ms and 3.7 µs; both are wrong by roughly an order
 * of magnitude and the numbers below are the correction. The assertions are
 * deliberately loose — they are there to catch a regression of an order of
 * magnitude, not to pin a benchmark to a laptop's clock.
 *
 * `catalog.json` is gitignored and rebuilt from the fixtures
 * (`npm run import:catalog`). **CI does have it**: the stamp step regenerates it
 * from the pinned fixtures before the suite runs, so the measurements below are
 * taken on every pull request rather than only on a developer's machine. Row X5
 * corrected this note, which claimed the opposite.
 *
 * Absent — a fresh checkout that has not imported — the whole block skips
 * **loudly**, naming the path and the command, following the precedent
 * `pipeline/catalog.test.ts` sets: a quietly skipped real-data test is worse than
 * a failing one.
 */
import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import type { CatalogFile as CatalogFileType } from '@/catalog'
import { CatalogFile } from '@/catalog'

import { buildSearchDocs } from './documents'
import { createSearchEngine } from './engine'
import { FACET_KEYS, KIND_OTHER, buildFacetIndex } from './facets'
import { buildOracle, oracleAddresses, oracleCount, oracleIds } from './oracle'
import { BUILD_UNSPECIFIED, buildSystemFilter, defaultFacetSearch } from './searchSchema'
import type { FacetSearch } from './searchSchema'
import { tokenise } from './text'

const CATALOG = 'public/catalog/catalog.json'
const present = existsSync(CATALOG)

const describeCorpus = present ? describe : describe.skip
const title = present
  ? 'real corpus'
  : `real corpus — SKIPPED, no ${CATALOG} (run \`npm run import:catalog\`)`

/** Building the index over 3,822 items, then comparing it against an O(n·v) oracle. */
const SLOW_MS = 120_000

describeCorpus(title, () => {
  const file: CatalogFileType = present
    ? CatalogFile.parse(JSON.parse(readFileSync(CATALOG, 'utf8')))
    : ({ records: [], tags: [] } as unknown as CatalogFileType)

  const engine = createSearchEngine(file)
  const byId = new Map(file.records.map((record) => [record.id as string, record]))

  function search(overrides: Partial<FacetSearch> = {}): FacetSearch {
    return { ...defaultFacetSearch(), ...overrides }
  }

  const hits = (q: string): number => engine.search(search({ q })).total

  /** Everything one item is searchable by: its name, and every variant's filename and tags. */
  const searchable = (item: { name: string; variants: readonly { id: string; file: string }[] }): string[] => [
    item.name,
    ...item.variants.map((variant) => variant.file),
    ...item.variants.flatMap((variant) =>
      (byId.get(variant.id)?.tags ?? []).map((tag) => file.tags[tag] ?? ''),
    ),
  ]

  /* ------------------------------------------------------------------ scale */

  it('indexes one item per design, over every live file', () => {
    expect(engine.size).toBe(3_822)
    expect(engine.files).toBe(8_702)
    expect(engine.search(search()).total).toBe(3_822)
    // 2.28 files per item. The whole row, in one ratio.
    expect(engine.files / engine.size).toBeCloseTo(2.28, 2)
    expect(engine.aggregates.aggregates.reduce((sum, item) => sum + item.variants.length, 0)).toBe(8_702)
  })

  it('indexes on the dense document index, not on the aggregate address', () => {
    // The measurement A1 published `docOf` for. The 3,822 addresses are spread
    // over 0…8,701, so a bitset keyed on the address needs 272 words to hold
    // 3,822 members and 55.9% of every posting is padding. Keyed on the position
    // in `AggregateIndex.aggregates` it needs 120.
    //
    // Asserted in bytes rather than by inspecting the code, because the failure
    // mode is silent: an address-keyed index answers every query correctly and
    // simply costs twice the memory.
    const addresses = engine.aggregates.aggregates.map((item) => Number(item.address))
    expect(Math.min(...addresses)).toBe(0)
    expect(Math.max(...addresses)).toBe(8_701)

    const docs = buildSearchDocs(file, engine.aggregates)
    const facets = buildFacetIndex(docs, file.tags)
    const values = Object.values(facets.fields)
    const bitsets = values.reduce((sum, field) => sum + field.bits.size, 0)
    const bytes = values.reduce(
      (sum, field) => sum + [...field.bits.values()].reduce((inner, bits) => inner + bits.byteLength, 0),
      0,
    )

    // 103 facet values — 8 kinds, 82 filterable texture paths, 6 build states,
    // 7 connection systems — over 120 words each.
    expect(bitsets).toBe(103)
    expect(bytes).toBe(49_440)
    // What the same 103 values cost over the file population, which is also what
    // they would cost over the sparse address space: 103 × 272 × 4.
    expect(103 * 272 * 4).toBe(112_064)
  })

  /* ------------------------------------------- the queries §6 says must work */

  it('answers every multi-word query §6 names with a plausible non-zero count', () => {
    // Under the mock's substring matcher every one of these returned **zero**,
    // because no filename contains a space and only five tag values do. Measured
    // over items: 1,568 / 54 / 54 / 378.
    for (const query of ['dungeon stone', 'arrow slit', 'cave wall', '2x2 floor']) {
      expect(hits(query), query).toBeGreaterThan(0)
    }
    // Order-of-magnitude sanity, so a matcher that degenerated to OR would fail:
    // each of these is a small slice of the catalog, not most of it.
    expect(hits('arrow slit')).toBeLessThan(300)
    expect(hits('cave wall')).toBeLessThan(500)
    expect(hits('2x2 floor')).toBeLessThan(800)
    expect(hits('dungeon stone')).toBeLessThan(2_000)
  })

  it('does not let `cave` match the concave pieces', () => {
    // §6's trap: substring `cave` hits the *con*cave pieces too. Over items the
    // two sets are 77 and 218, and they barely intersect — a substring matcher
    // would return their union for the first query.
    const cave = hits('cave')
    const concave = hits('concave')

    expect(cave).toBeGreaterThan(50)
    expect(cave).toBeLessThan(150)
    expect(concave).toBeGreaterThan(150)
    expect(concave).toBeGreaterThan(cave)

    // And every result of `cave` carries the word as a *whole token* in one of
    // the three indexed fields of one of its variants — never as the tail of
    // `concave`. The filename matters here as much as the name:
    // `cave%sandstone+3#wall,slope.SB.top.stl` is a cave tile whose display name
    // reads "Sandstone Fracture Slope 4x1".
    for (const item of engine.search(search({ q: 'cave' })).items) {
      const tokens = searchable(item).flatMap((field) => tokenise(field))
      expect(tokens.includes('cave'), item.name).toBe(true)
    }

    // Stated the other way round, which is the trap itself: most concave pieces
    // are *not* cave pieces, and a substring matcher returns all of them.
    const caveHits = new Set(engine.search(search({ q: 'cave' })).ids)
    const concaveOnly = engine.search(search({ q: 'concave' })).ids.filter((id) => !caveHits.has(id))
    expect(concaveOnly.length).toBeGreaterThan(150)
  })

  it('finds the synthesised size tokens, which appear in zero tags', () => {
    // §6: the literal `4x4` is in no tag; it exists only in the size token the
    // importer synthesises into the display name. And no `×` rewrite — `4×4`
    // tokenises to `4` and `4`, which is a different (and much wider) query.
    for (const size of ['4x4', '2x2', '1x1', '2r90']) {
      expect(hits(size), size).toBeGreaterThan(0)
    }
    expect(hits('4x4')).toBeGreaterThan(200)
    expect(hits('4×4')).not.toBe(hits('4x4'))

    // Every hit spells the size as `4x4` in its name or in one of its variants'
    // filenames. The two disagree more often than one would expect —
    // `wood#door_lintel+a.4x4.stl` is named "Wood Lintel Curved 4r90", because
    // the footprint is the arc and the filename names the opening it fits —
    // which is why both are indexed.
    for (const item of engine.search(search({ q: '4x4' })).items) {
      expect(
        [item.name, ...item.variants.map((variant) => variant.file)].some((field) => field.includes('4x4')),
        item.design,
      ).toBe(true)
    }
  })

  it('ranks a name match above a tag-only match for `wall`', () => {
    // `build|separate wall` sits on 826 items regardless of shape, so an
    // unweighted scorer opens a search for walls on floors.
    const result = engine.search(search({ q: 'wall' }))
    for (const item of result.items.slice(0, 50)) {
      expect(item.name.toLowerCase(), item.design).toContain('wall')
    }
  })

  it('drops the `stl` token, which every file carries', () => {
    expect(hits('stl')).toBe(0)
  })

  /* ------------------------------------------------------- facet semantics */

  it('kinds — 13.7% of items in two or more buckets, 16.0% in none', () => {
    // The file-level figures were 19.5% and 11.9%. Both moved because the
    // multi-file designs are not distributed evenly across the buckets, and
    // `kinds` is hoisted so an item's list is exactly its variants'.
    const items = engine.aggregates.aggregates
    const multi = items.filter((item) => item.kinds.length >= 2).length
    const none = items.filter((item) => item.kinds.length === 0).length
    expect(multi).toBe(522)
    expect(none).toBe(611)

    const other = engine.search(search()).facets.kinds.find((bucket) => bucket.value === KIND_OTHER)
    expect(other?.count).toBe(none)
    expect(engine.search(search({ kinds: [KIND_OTHER] })).total).toBe(none)

    // The buckets over-count by exactly the memberships past the first.
    const total = engine.search(search()).facets.kinds.reduce((sum, bucket) => sum + bucket.count, 0)
    expect(total).toBe(items.reduce((sum, item) => sum + Math.max(item.kinds.length, 1), 0))
    expect(total).toBe(4_346)
  })

  it('tex — all 37 roots reach an item, including the one `record.texture` never reports', () => {
    // Two numbers, one behind the other. Only 36 roots ever win
    // `record.texture`, because `texture|stucco` is always secondary to an
    // alphabetically earlier root; matching on tags rather than on that field is
    // what keeps all 37 usable.
    //
    // Both were one higher until D3 collapsed `texture|foundations` (2 tiles)
    // into `texture|foundation` (51) in `pipeline/normalise.ts`. The facet
    // vocabulary is derived from the tags, so it lost that value with them:
    // 38 → 37 present, 37 → 36 in first position. That is the user-visible cost
    // of the collapse, and it is asserted below rather than left implicit.
    expect(engine.vocabulary.tex).toHaveLength(37)

    const buckets = engine.search(search()).facets.tex
    for (const bucket of buckets) expect(bucket.count, bucket.value).toBeGreaterThan(0)

    const reported = new Set(file.records.map((record) => record.texture).filter((root) => root !== undefined))
    expect(reported.size).toBe(36)
    expect(reported.has('stucco')).toBe(false)
    // 24 files and 24 items: every `stucco` tile is its own design.
    expect(engine.search(search({ tex: ['stucco'] })).total).toBe(24)
  })

  it('tex — the collapsed spelling is gone from the facet, and its tiles are not', () => {
    // What a user loses: `foundations` is no longer selectable, so the tiles
    // that carried it cannot be isolated by texture any more. What they keep:
    // the canonical root reaches them, and free text still finds them, because
    // the text index tokenises every variant's `file`, whose stem is
    // `foundations`.
    expect(engine.vocabulary.tex).not.toContain('foundations')
    expect(engine.vocabulary.tex).toContain('foundation')
    expect(engine.search(search({ tex: ['foundations'] })).total).toBe(0)
    expect(engine.search(search({ tex: ['foundation'] })).total).toBe(13)
    expect(engine.search(search({ q: 'foundations' })).total).toBeGreaterThan(0)
  })

  it('tex — a root matches everything nested under it, and nothing that merely shares a prefix', () => {
    const dungeon = engine.search(search({ tex: ['dungeon_stone'] }))
    expect(dungeon.total).toBe(1_566)

    const nested = engine.search(search({ tex: ['dungeon_stone|eroded'] }))
    expect(nested.total).toBe(453)
    expect(nested.total).toBeLessThan(dungeon.total)

    // `cavern` (29) is not under `cave` (77), and `stone_brick` (46) is not
    // under `stone` (22).
    expect(engine.search(search({ tex: ['cave'] })).total).toBe(77)
    expect(engine.search(search({ tex: ['cavern'] })).total).toBe(29)
    expect(engine.search(search({ tex: ['stone'] })).total).toBe(22)
    expect(engine.search(search({ tex: ['stone_brick'] })).total).toBe(46)
  })

  it('build — 1,511 items (39.5%) are unspecified, and that is a filter value', () => {
    const unspecified = engine.aggregates.aggregates.filter((item) => item.build === undefined).length
    expect(unspecified).toBe(1_511)
    expect(engine.search(search({ build: BUILD_UNSPECIFIED })).total).toBe(unspecified)

    // A partition, and only because `build` is one of A1's seven hoisted fields:
    // 0 of 3,822 aggregates hold two distinct values of it. If one ever did,
    // this sum would exceed 3,822 and a single-select facet would silently have
    // become a union.
    const buckets = engine.search(search()).facets.build
    expect(buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(3_822)
    expect(buckets.map((bucket) => bucket.value)).toContain(BUILD_UNSPECIFIED)
    expect(engine.search(search({ build: buildSystemFilter('separate wall') })).total).toBe(826)
  })

  it('conn — the union takes 2,493 files (28.6%) to 1,605 items (42.0%)', () => {
    // Was 2,499 files (28.7%) while `pipeline/facets.ts` read `bottom`, `left`
    // and `right` as connection systems rather than as positions (row D2). The
    // definition of record is `connection_systems()` in
    // `docs/verify-catalog-facts.py`, which the pipeline corpus suite
    // cross-checks against.
    expect(file.records.filter((record) => record.conn.length >= 2).length).toBe(2_493)
    // No `conn` value is a position name: the whole vocabulary is 7 systems, not 10.
    expect(new Set(file.records.flatMap((record) => record.conn)).size).toBe(7)
    expect(engine.vocabulary.conn).toHaveLength(7)

    const systemsOf = (item: (typeof engine.aggregates.aggregates)[number]): Set<string> =>
      new Set(item.variants.flatMap((variant) => byId.get(variant.id)?.conn ?? []))
    expect(engine.aggregates.aggregates.filter((item) => systemsOf(item).size >= 2)).toHaveLength(1_605)

    const openlock = engine.search(search({ conn: ['openlock'] })).total
    const magnetic = engine.search(search({ conn: ['magnetic'] })).total
    const both = engine.search(search({ conn: ['openlock', 'magnetic'] })).total
    expect(openlock).toBe(1_790)
    expect(magnetic).toBe(255)
    // **Every magnetic item is also an openlock item.** At file level the two
    // sets are 1,159 and 3,965 records and neither contains the other; the
    // magnetic bases carry `magnetic|flex` and share a design with an openlock
    // print of the same base, so the union swallows the distinction. A user who
    // selects both systems sees exactly the openlock set — which is the honest
    // answer, and is why row A3 shows availability chips per variant rather than
    // implying the item is magnetic-only.
    expect(both).toBe(openlock)
    expect(both).toBeLessThan(openlock + magnetic)
  })

  it('conn — an item matches a system only one of its variants carries', () => {
    // 3,068 items offer openforge somewhere in the group, against the 4,363
    // files that carry the tag.
    const openforge = engine.search(search({ conn: ['openforge'] }))
    expect(openforge.total).toBe(3_068)

    const partial = openforge.items.filter((item) => {
      const carrying = item.variants.filter((variant) => (byId.get(variant.id)?.conn ?? []).includes('openforge'))
      return carrying.length < item.variants.length
    })
    // **931**, and that is exactly A1's `both` class: an item is in this bucket
    // on a strict subset of its files precisely when it holds a topper beside a
    // self-sufficient variant. Two independent derivations of the same set, so
    // this is the union semantics pinned to a number rather than to a shape.
    expect(partial).toHaveLength(931)
    expect(engine.aggregates.stats.classes.both).toBe(931)
  })

  /* --------------------------------------------------- disjunctive at scale */

  it(
    'matches the brute-force oracle on disjunctive counts at full scale',
    () => {
      const oracle = buildOracle(file)
      const combinations: FacetSearch[] = [
        search(),
        search({ tex: ['dungeon_stone'] }),
        search({ kinds: ['wall'], conn: ['openlock'] }),
        search({ conn: ['openforge'] }),
        search({ kinds: ['floor', 'base'], tex: ['cave', 'cut-stone'], build: BUILD_UNSPECIFIED }),
        search({ q: 'corner', kinds: ['wall'], tex: ['dungeon_stone'], conn: ['openforge'] }),
      ]

      for (const state of combinations) {
        const result = engine.search(state)
        for (const key of FACET_KEYS) {
          for (const bucket of result.facets[key]) {
            expect(bucket.count, `${key}=${bucket.value} under ${JSON.stringify(state)}`).toBe(
              oracleCount(oracle, state, key, bucket.value),
            )
          }
        }
      }
    },
    SLOW_MS,
  )

  it(
    'matches the brute-force oracle on items, previews and ranking at full scale',
    () => {
      const oracle = buildOracle(file)
      for (const state of [
        search(),
        search({ q: 'dungeon stone' }),
        search({ q: 'wall' }),
        search({ q: 'cave 2x2', conn: ['openlock'] }),
        search({ kinds: ['base'], build: BUILD_UNSPECIFIED }),
      ]) {
        const result = engine.search(state)
        expect(result.items.map((item) => Number(item.address)), JSON.stringify(state)).toEqual(
          oracleAddresses(oracle, state),
        )
        expect(result.ids, JSON.stringify(state)).toEqual(oracleIds(oracle, state))
      }
    },
    SLOW_MS,
  )

  it('selecting one texture leaves every other texture reachable', () => {
    const unfiltered = engine.search(search()).facets.tex
    const filtered = engine.search(search({ tex: ['dungeon_stone'] })).facets.tex
    // Identical, because a facet's own filter is excluded from its own counts.
    expect(filtered.map((bucket) => bucket.count)).toEqual(unfiltered.map((bucket) => bucket.count))
  })

  /* ------------------------------------------------------------ robustness */

  it('returns everything for an empty query and nothing for a garbage one', () => {
    expect(engine.search(search()).total).toBe(3_822)
    expect(engine.search(search({ q: 'qwertyuiop' })).total).toBe(0)
    expect(engine.search(search({ q: 'wall qwertyuiop' })).total).toBe(0)
    expect(() => engine.search(search({ q: '#|%+,.-' }))).not.toThrow()
    expect(engine.search(search({ q: '#|%+,.-' })).total).toBe(0)
  })

  /* ----------------------------------------------------------- measurement */

  it(
    'builds and queries fast enough to run on every keystroke',
    () => {
      const builds: number[] = []
      for (let round = 0; round < 3; round++) {
        const started = performance.now()
        createSearchEngine(file)
        builds.push(performance.now() - started)
      }
      const build = Math.min(...builds)

      const queries: readonly [string, FacetSearch][] = [
        ['(empty)', search()],
        ['cave', search({ q: 'cave' })],
        ['dungeon stone', search({ q: 'dungeon stone' })],
        ['4x4', search({ q: '4x4' })],
        ['wall', search({ q: 'wall' })],
        ['no hits', search({ q: 'qwertyuiop' })],
        ['facets only', search({ kinds: ['wall'], tex: ['dungeon_stone'], conn: ['openlock'] })],
      ]

      const timings: string[] = []
      let worst = 0
      for (const [label, state] of queries) {
        for (let warm = 0; warm < 20; warm++) engine.search(state)
        const rounds = 200
        const started = performance.now()
        for (let i = 0; i < rounds; i++) engine.search(state)
        const micros = ((performance.now() - started) / rounds) * 1_000
        worst = Math.max(worst, micros)
        timings.push(`${label} ${micros.toFixed(0)}µs`)
      }

      process.stdout.write(
        `\n[search] index build ${build.toFixed(0)} ms over ${String(engine.size)} items / ` +
          `${String(engine.files)} files` +
          `\n[search] per query: ${timings.join(' · ')}\n`,
      )

      // The plan's figures were ~10 ms and 3.7 µs. The real ones are an order of
      // magnitude larger and still comfortably inside a frame: the build happens
      // once, alongside a 5.4 MB JSON parse that costs more, and the worst query
      // is a fraction of a 16 ms frame. Row A2 added the aggregate derivation to
      // the build — ~50 ms of the ~85 — and took the query work down with the
      // population. These ceilings catch a regression, not a slow machine.
      expect(build).toBeLessThan(1_000)
      expect(worst).toBeLessThan(20_000)
    },
    SLOW_MS,
  )
})
