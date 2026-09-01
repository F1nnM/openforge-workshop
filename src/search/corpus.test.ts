/**
 * The engine against the real 8,702-tile corpus.
 *
 * Everything asserted here is a **measured property of the data**, not of the
 * code: the queries §6 names must return plausible non-zero counts, the
 * concave/cave trap must stay shut, sizes that appear in zero tags must be
 * findable, and each facet's shape must match what the corpus does. The
 * disjunctive-count comparison against `oracle.ts` runs again at full scale,
 * because a bitset bug that only shows up past 8,192 members (the 257th word) is
 * exactly the kind that a 1,080-record fixture hides.
 *
 * It also **measures and prints** index build time and per-query time. The
 * architecture plan quotes ~10 ms and 3.7 µs; both are wrong by roughly an order
 * of magnitude and the numbers below are the correction. The assertions are
 * deliberately loose — they are there to catch a regression of an order of
 * magnitude, not to pin a benchmark to a laptop's clock.
 *
 * `catalog.json` is gitignored and rebuilt from the fixtures
 * (`npm run import:catalog`), so it is not present in CI. The whole block then
 * skips **loudly**, naming the path and the command, following the precedent
 * `pipeline/catalog.test.ts` sets: a quietly skipped real-data test is worse than
 * a failing one.
 */
import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import type { CatalogFile as CatalogFileType } from '@/catalog'
import { CatalogFile } from '@/catalog'

import { createSearchEngine } from './engine'
import { FACET_KEYS, KIND_OTHER } from './facets'
import { buildOracle, oracleCount, oracleIds } from './oracle'
import { BUILD_UNSPECIFIED, buildSystemFilter, defaultFacetSearch } from './searchSchema'
import type { FacetSearch } from './searchSchema'
import { tokenise } from './text'

const CATALOG = 'public/catalog/catalog.json'
const present = existsSync(CATALOG)

const describeCorpus = present ? describe : describe.skip
const title = present
  ? 'real corpus'
  : `real corpus — SKIPPED, no ${CATALOG} (run \`npm run import:catalog\`)`

/** Building the index over 8,702 records, then comparing it against an O(n·v) oracle. */
const SLOW_MS = 120_000

describeCorpus(title, () => {
  const file: CatalogFileType = present
    ? CatalogFile.parse(JSON.parse(readFileSync(CATALOG, 'utf8')))
    : ({ records: [], tags: [] } as unknown as CatalogFileType)

  const engine = createSearchEngine(file)

  function search(overrides: Partial<FacetSearch> = {}): FacetSearch {
    return { ...defaultFacetSearch(), ...overrides }
  }

  const hits = (q: string): number => engine.search(search({ q })).total

  /* ------------------------------------------------------------------ scale */

  it('indexes every live tile', () => {
    expect(engine.size).toBe(8702)
    expect(engine.search(search()).total).toBe(8702)
  })

  /* ------------------------------------------- the queries §6 says must work */

  it('answers every multi-word query §6 names with a plausible non-zero count', () => {
    // Under the mock's substring matcher every one of these returned **zero**,
    // because no filename contains a space and only five tag values do.
    for (const query of ['dungeon stone', 'arrow slit', 'cave wall', '2x2 floor']) {
      expect(hits(query), query).toBeGreaterThan(0)
    }
    // Order-of-magnitude sanity, so a matcher that degenerated to OR would fail:
    // each of these is a small slice of the catalog, not most of it.
    expect(hits('arrow slit')).toBeLessThan(500)
    expect(hits('cave wall')).toBeLessThan(1_000)
    expect(hits('2x2 floor')).toBeLessThan(1_500)
    expect(hits('dungeon stone')).toBeLessThan(4_000)
  })

  it('does not let `cave` match the concave pieces', () => {
    // §6's trap: substring `cave` hits 658 *con*cave pieces, taking the query
    // from ~407 real hits to 1,080. Word boundaries make `concave` its own token.
    const cave = hits('cave')
    const concave = hits('concave')

    expect(cave).toBeGreaterThan(300)
    expect(cave).toBeLessThan(500)
    expect(concave).toBeGreaterThan(500)
    expect(cave + concave).toBeGreaterThan(1_000)

    // And every result of `cave` carries the word as a *whole token* in one of
    // the three indexed fields — never as the tail of `concave`. The filename
    // matters here as much as the name: `cave%sandstone+3#wall,slope.SB.top.stl`
    // is a cave tile whose display name reads "Sandstone Fracture Slope 4x1".
    for (const id of engine.search(search({ q: 'cave' })).ids) {
      const record = engine.record(id)
      const fields = [record?.name ?? '', record?.file ?? '', ...(record?.tags.map((tag) => file.tags[tag]) ?? [])]
      expect(fields.some((field) => tokenise(field ?? '').includes('cave')), record?.name).toBe(true)
    }

    // Stated the other way round, which is the trap itself: most concave pieces
    // are *not* cave pieces, and a substring matcher returns all of them.
    const caveHits = new Set(engine.search(search({ q: 'cave' })).ids)
    const concaveOnly = engine.search(search({ q: 'concave' })).ids.filter((id) => !caveHits.has(id))
    expect(concaveOnly.length).toBeGreaterThan(500)
  })

  it('finds the synthesised size tokens, which appear in zero tags', () => {
    // §6: the literal `4x4` is in no tag; it exists only in the size token the
    // importer synthesises into the display name. And no `×` rewrite — applying
    // one takes this from 347 hits to 0.
    for (const size of ['4x4', '2x2', '1x1', '2r90']) {
      expect(hits(size), size).toBeGreaterThan(0)
    }
    expect(hits('4x4')).toBeGreaterThan(300)
    expect(hits('4×4')).not.toBe(hits('4x4'))

    // Every hit spells the size as `4x4` in its name or its filename. The two
    // disagree more often than one would expect — `wood#door_lintel+a.4x4.stl`
    // is named "Wood Lintel Curved 4r90", because the footprint is the arc and
    // the filename names the opening it fits — which is why both are indexed.
    for (const id of engine.search(search({ q: '4x4' })).ids) {
      const record = engine.record(id)
      expect(`${record?.name ?? ''} ${record?.file ?? ''}`, record?.id).toContain('4x4')
    }
  })

  it('ranks a name match above a tag-only match for `wall`', () => {
    // `build|separate wall` sits on 3,351 tiles regardless of shape, so an
    // unweighted scorer opens a search for walls on floors.
    const result = engine.search(search({ q: 'wall' }))
    for (const id of result.ids.slice(0, 50)) {
      expect(engine.record(id)?.name.toLowerCase(), id).toContain('wall')
    }
  })

  /* ------------------------------------------------------- facet semantics */

  it('kinds — 19.5% in two or more buckets, 11.9% in none', () => {
    const multi = file.records.filter((record) => record.kinds.length >= 2).length
    const none = file.records.filter((record) => record.kinds.length === 0).length
    expect(multi).toBe(1_693)
    expect(none).toBe(1_032)

    const other = engine.search(search()).facets.kinds.find((bucket) => bucket.value === KIND_OTHER)
    expect(other?.count).toBe(none)
    expect(engine.search(search({ kinds: [KIND_OTHER] })).total).toBe(none)
  })

  it('tex — all 38 roots reach a record, including the one `record.texture` never reports', () => {
    // PR 4 measured that only 37 roots ever win `record.texture`, because
    // `texture|stucco` is always secondary to an alphabetically earlier root.
    // Matching on tags rather than on that field is what keeps all 38 usable.
    expect(engine.vocabulary.tex).toHaveLength(38)

    const buckets = engine.search(search()).facets.tex
    for (const bucket of buckets) expect(bucket.count, bucket.value).toBeGreaterThan(0)

    const reported = new Set(file.records.map((record) => record.texture).filter((root) => root !== undefined))
    expect(reported.size).toBe(37)
    expect(reported.has('stucco')).toBe(false)
    expect(engine.search(search({ tex: ['stucco'] })).total).toBe(24)
  })

  it('tex — a root matches everything nested under it, and nothing that merely shares a prefix', () => {
    const dungeon = engine.search(search({ tex: ['dungeon_stone'] }))
    expect(dungeon.total).toBe(3_130)

    const nested = engine.search(search({ tex: ['dungeon_stone|eroded'] }))
    expect(nested.total).toBeGreaterThan(0)
    expect(nested.total).toBeLessThan(dungeon.total)

    // `cavern` (39) is not under `cave` (368), and `stone_brick` (84) is not
    // under `stone` (57).
    expect(engine.search(search({ tex: ['cave'] })).total).toBe(368)
    expect(engine.search(search({ tex: ['cavern'] })).total).toBe(39)
    expect(engine.search(search({ tex: ['stone'] })).total).toBe(57)
    expect(engine.search(search({ tex: ['stone_brick'] })).total).toBe(84)
  })

  it('build — 2,978 tiles (34.2%) are unspecified, and that is a filter value', () => {
    const unspecified = file.records.filter((record) => record.build === undefined).length
    expect(unspecified).toBe(2_978)
    expect(engine.search(search({ build: BUILD_UNSPECIFIED })).total).toBe(unspecified)

    const buckets = engine.search(search()).facets.build
    expect(buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(8_702)
    expect(buckets.map((bucket) => bucket.value)).toContain(BUILD_UNSPECIFIED)
    expect(engine.search(search({ build: buildSystemFilter('separate wall') })).total).toBe(3_351)
  })

  it('conn — 2,493 tiles (28.6%) carry two or more systems', () => {
    // Was 2,499 (28.7%) while `pipeline/facets.ts` read `bottom`, `left` and
    // `right` as connection systems rather than as positions. Six of the eight
    // records that carried such a phantom had it as their *second* value — e.g.
    // `connection|bottom` + `connection|openlock` counted as two systems where the
    // tile offers one — so removing the phantoms takes 2,499 to 2,493. The other
    // two keep two real systems and stay in the count. The definition of record is
    // `connection_systems()` in `docs/verify-catalog-facts.py`, which the pipeline
    // corpus suite cross-checks against.
    expect(file.records.filter((record) => record.conn.length >= 2).length).toBe(2_493)
    // No `conn` value is a position name: the whole vocabulary is 7 systems, not 10.
    expect(new Set(file.records.flatMap((record) => record.conn)).size).toBe(7)
    const openlock = engine.search(search({ conn: ['openlock'] })).total
    const magnetic = engine.search(search({ conn: ['magnetic'] })).total
    const both = engine.search(search({ conn: ['openlock', 'magnetic'] })).total
    expect(both).toBeLessThan(openlock + magnetic)
    expect(both).toBeGreaterThan(Math.max(openlock, magnetic))
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
    'matches the brute-force oracle on ids and ranking at full scale',
    () => {
      const oracle = buildOracle(file)
      for (const state of [
        search(),
        search({ q: 'dungeon stone' }),
        search({ q: 'wall' }),
        search({ q: 'cave 2x2', conn: ['openlock'] }),
        search({ kinds: ['base'], build: BUILD_UNSPECIFIED }),
      ]) {
        expect(engine.search(state).ids, JSON.stringify(state)).toEqual(oracleIds(oracle, state))
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
    expect(engine.search(search()).total).toBe(8_702)
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
        `\n[search] index build ${build.toFixed(0)} ms over ${String(engine.size)} records` +
          `\n[search] per query: ${timings.join(' · ')}\n`,
      )

      // The plan's figures were ~10 ms and 3.7 µs. The real ones are an order of
      // magnitude larger and still comfortably inside a frame: the build happens
      // once, alongside a 5.4 MB JSON parse that costs more, and the worst query
      // is a fraction of a 16 ms frame. These ceilings catch a regression, not a
      // slow machine.
      expect(build).toBeLessThan(1_000)
      expect(worst).toBeLessThan(20_000)
    },
    SLOW_MS,
  )
})
