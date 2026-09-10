/**
 * The importer against the real corpus.
 *
 * Four things are proved here and nowhere else, all of them over the **whole**
 * 8,702-tile corpus rather than a sample:
 *
 *   1. The emitted artefact parses as a `CatalogFile`, including the file-level
 *      integrity checks for dangling tag ids and duplicate ids and ordinals.
 *   2. Every count this pipeline derives matches `docs/verify-catalog-facts.py`,
 *      which is run as a subprocess and whose table is parsed. Not a copy of its
 *      numbers — the script itself. A definition that drifts in one and not the
 *      other fails here.
 *   3. Two runs over identical input produce byte-identical output.
 *   4. Ordinals survive a removal and an addition.
 *
 * If the fixtures are not on this machine the whole block is skipped **loudly**,
 * with the path it looked in. A quietly skipped real-data test is worse than a
 * failing one.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { printOption } from '../src/assembly/assemblyIndex'
import { footprintKey } from '../src/assembly/footprint'
import {
  ARC_BAND_EVIDENCE,
  ArcBand,
  CatalogFile,
  MAX_SECTOR_SWEEP_DEG,
  arcBandIsMeasured,
  arcInterfaceRadius,
  buildAggregateIndex,
  resolveTags,
  shardedPath,
} from '../src/catalog'

import type { BuildResult } from './build'
import { buildCatalog } from './build'
import { serialiseCatalog } from './emit'
import { CONNECTION_POSITIONS, classifyLayer, connectionSystems, connectionsByPosition, isLockSystem } from './facets'
import type { FixtureRow } from './fixtures'
import { fixturesDir, liveRows, loadFixtureRows } from './fixtures'
import { TAG_ALIASES, normaliseTags } from './normalise'
import { FORMS, ROLES } from './role'
import { hasTagPrefix, hasTagSegment } from './tags'
import { emptyMountInventory } from './mounts'
import { emptyManifest } from './ordinals'
import { CURVED_INTERFACE_TAG, radiusIsFeature } from './footprint'
import {
  ARC_BAND_RULES,
  COLUMN_TOKEN_BY_LETTER,
  CURVE_TAG_SEGMENTS,
  NON_CURVE_TAG_SEGMENTS,
  TESSELLATION_BY_CODE,
  arcBandFor,
  arcBandSideOfRadius,
  isMeasured,
} from './tessellation'

const FIXTURES_DIR = fixturesDir()

const hasFixtures =
  existsSync(FIXTURES_DIR) && readdirSync(FIXTURES_DIR).some((name) => name.endsWith('.json'))

const describeCorpus = hasFixtures ? describe : describe.skip
const title = hasFixtures
  ? 'real corpus'
  : `real corpus — SKIPPED, no fixtures at ${FIXTURES_DIR} (set OPENFORGE_FIXTURES)`

/** Pinned so `version.built` cannot make two builds differ for a reason that is not a bug. */
const BUILT_AT = '2026-01-01T00:00:00.000Z'

/**
 * Timeout for the tests that build the 8,702-tile corpus again. That is seconds
 * of real work on 5 MB of JSON, and the 5 s default turns it into a flaky
 * failure rather than a slow pass.
 */
const SLOW_MS = 120_000

describeCorpus(title, () => {
  const rows: FixtureRow[] = hasFixtures ? loadFixtureRows(FIXTURES_DIR) : []
  const live = liveRows(rows)
  const result: BuildResult = buildCatalog({
    rows,
    manifest: emptyManifest(),
    thumbs: new Set(),
    mounts: emptyMountInventory(),
    fixturesRef: 'test',
    builtAt: BUILT_AT,
  })
  const json = serialiseCatalog(result.file)

  /**
   * Every record's footprint case, keyed by the *fixture row's* path.
   *
   * `record.id` is a branded `TileId` and `file_metadata.full_name` is a plain
   * string, so the map is declared over `string` once here rather than cast at
   * every lookup. Four of the footprint tests below need the join.
   */
  const shapeByPath = new Map<string, string>(
    result.file.records.map((record) => [record.id, record.foot.shape]),
  )

  /**
   * The primitive a congruence key names, from the key string alone.
   *
   * `docs/verify-catalog-facts.py` publishes its per-code spans as keys
   * (`rect:1x1`, `tri:4`, `arc:*`), and its keys are deliberately coarser than
   * `src/assembly/footprint.ts#footprintKey`: an `arc`'s radii come from its
   * band, a `diag`'s length and an `xG` wall's run from W2's table, and all
   * three are **parameters** the script does not hold — W5's rule, so the
   * offsets keep one home.
   *
   * So the cross-check runs at the granularity both sides can spell — the
   * discriminant — and it is exact rather than approximate, because every key
   * either *is* a shape name or is prefixed by one.
   *
   * **That last clause used to be an assertion about code this file could not
   * import.** Row W7 filed the boundary against `tsconfig.node.json`, row X4
   * admitted `src/assembly/footprint.ts` and `assemblyIndex.ts` to the pipeline
   * project, and row X5 spent it: the claim is now checked against the real
   * `footprintKey` over all 8,702 emitted footprints, below.
   */
  const shapeOfKey = (key: string): string => key.split(':')[0] ?? key

  /** A `name count, name count` string ordered by descending count, as the script renders it. */
  const renderTally = (tally: Readonly<Record<string, number>>): string =>
    Object.entries(tally)
      .filter(([, count]) => count > 0)
      .sort(([, a], [, b]) => b - a)
      .map(([name, count]) => `${name} ${String(count)}`)
      .join(', ')

  /* ------------------------------------------------------------ the contract */

  it('emits a file that validates against CatalogFile', () => {
    expect(() => CatalogFile.parse(JSON.parse(json))).not.toThrow()
  })

  it('emits one record per live row and none for the deprecated ones', () => {
    expect(result.file.records).toHaveLength(live.length)
    expect(result.file.records).toHaveLength(rows.length - 19)
  })

  it('drops the deprecated rows, every one of which duplicates a live path', () => {
    // Not a tidiness detail. All 19 `deprecated` rows carry a `full_name` that a
    // live row also carries, so an importer that forgot the filter would emit 19
    // duplicate ids — which `CatalogFile` rejects and the append-only manifest
    // rejects first. The trap is that "deprecated" reads like "obsolete and
    // absent" when it actually means "superseded and still present".
    const liveIds = new Set(live.map((row) => row.file_metadata.full_name))
    const deprecated = rows.filter((row) => !liveIds.has(row.file_metadata.full_name))
    expect(deprecated).toHaveLength(0)
    expect(rows.filter((row) => Boolean(row.deprecated))).toHaveLength(19)
  })

  it('reconstructs every storage address from the asset bases and the md5', () => {
    // The record carries no URLs because storing both per record would add
    // roughly 600 KB of raw JSON to say the same thing 8,702 times. That saving
    // becomes an 8,702-way 404 if the convention ever moves, so it is checked
    // against every row rather than assumed.
    const bySource = new Map(live.map((row) => [row.file_metadata.full_name, row]))
    const wrong = result.file.records.filter(
      (record) =>
        `${result.file.assets.models}/${shardedPath(record.blob)}.stl` !==
        bySource.get(record.id)?.file_metadata.storage_address,
    )
    expect(wrong.map((record) => record.id)).toEqual([])
  })

  it('keeps id, family and file consistent with the catalog path', () => {
    const wrong = result.file.records.filter(
      (record) =>
        record.family !== dirname(record.id) ||
        record.file !== basename(record.id) ||
        !record.id.startsWith('tiles/'),
    )
    expect(wrong.map((record) => record.id)).toEqual([])
  })

  it('interns every tag and de-interns back to the normalised list plus the two derived axes', () => {
    // `normaliseTags` is applied on the way in, so the round trip is against the
    // canonical list rather than the raw fixture one. Comparing to the raw list
    // was right until tag drift was collapsed, and would now report the two
    // `foundations` tiles as corruption.
    //
    // **Row B1 appended two derived tags rather than rewriting any**, and this
    // assertion is where that is pinned exactly: the scanned tags in their
    // original order, then `role|<x>`, then `form|<x>`, and nothing else. It is
    // the guard on the one thing the position of the role step inside
    // `buildCatalog` could get wrong — a derived tag reaching a derivation that
    // reads the tag list. If it did, this comparison would drift from
    // `normaliseTags(raw)` on the left and no other test would notice.
    const bySource = new Map(live.map((row) => [row.file_metadata.full_name, row]))
    const wrong = result.file.records.filter((record) => {
      const emitted = record.tags.map((id) => result.file.tags[id] ?? '')
      const scanned = normaliseTags(bySource.get(record.id)?.tags ?? [])
      const derived = emitted.slice(scanned.length)
      return (
        emitted.slice(0, scanned.length).join('\u0000') !== scanned.join('\u0000') ||
        derived.length !== 2 ||
        !(derived[0] ?? '').startsWith('role|') ||
        !(derived[1] ?? '').startsWith('form|')
      )
    })
    expect(wrong.map((record) => record.id)).toEqual([])
  })

  it('reads the tag tree the same way whether the match is a prefix or a segment', () => {
    // `pipeline/role.ts` uses `hasTagSegment` where `classifyLayer` and
    // `hasCurveMarker` use `hasTagPrefix`, and this is the claim that makes both
    // choices safe: over the whole corpus, at every path either function is
    // called with, **the two return the same answer on all 8,702 records**. So
    // the segment match is not a bug fix and the prefix match is not a latent
    // bug — but the day a `shape|wallpaper` or a `partition|` enters the scan,
    // this test names which functions have to be looked at.
    const paths = [
      'part',
      'scatter',
      'decoration',
      'interface',
      'shape',
      'shape|base',
      'shape|wall',
      'shape|floor',
      'shape|column',
      'shape|riser',
      'shape|stairs',
      'shape|corner',
      'shape|curved',
      'shape|hex',
      'connection|openforge',
    ]
    const disagreeing = result.file.records.flatMap((record) => {
      const tags = record.tags.map((id) => result.file.tags[id] ?? '')
      return paths
        .filter((path) => hasTagSegment(tags, path) !== hasTagPrefix(tags, path))
        .map((path) => `${record.id} @ ${path}`)
    })
    expect(disagreeing).toEqual([])
  })

  it('normalises exactly the records the alias table names, and no others', () => {
    // The guard on the test above: if `normaliseTags` became the identity, the
    // round trip would still pass and prove nothing. This asserts the collapse
    // actually happened, and that its blast radius is two records.
    const bySource = new Map(live.map((row) => [row.file_metadata.full_name, row]))
    const moved = result.file.records.filter((record) => {
      const raw = bySource.get(record.id)?.tags ?? []
      return normaliseTags(raw).join('\u0000') !== raw.join('\u0000')
    })
    expect(moved.map((record) => record.id).sort()).toEqual(
      result.file.records
        .filter((record) => (bySource.get(record.id)?.tags ?? []).includes('texture|foundations'))
        .map((record) => record.id)
        .sort(),
    )
    expect(moved).toHaveLength(2)
  })

  /* ------------------------------------------------ cross-check: the oracle */

  describe('matches docs/verify-catalog-facts.py', () => {
    it(
      'agrees on the corpus size',
      () => {
        const facts = verifyFacts()
        expect(result.stats.fixtureRows).toBe(leading(facts, 'total fixture rows'))
        expect(result.stats.deprecated).toBe(leading(facts, 'deprecated'))
        expect(result.stats.records).toBe(leading(facts, 'live tiles'))
      },
      // This is the test that pays for the whole `describe` block: `verifyFacts`
      // is memoised, so the first caller runs the Python oracle over all 8,721
      // fixture rows as a subprocess. That is ~2.5 s alone, and under the rest of
      // the suite it crossed the 5 s default and failed as a timeout rather than
      // as a disagreement.
      SLOW_MS,
    )

    it('agrees on all seven footprint counts', () => {
      const facts = verifyFacts()
      expect(result.stats.footprints.rect).toBe(leading(facts, 'footprint RECT'))
      expect(result.stats.footprints.wall).toBe(leading(facts, 'footprint WALL_SEG'))
      expect(result.stats.footprints.arc).toBe(leading(facts, 'footprint ARC'))
      expect(result.stats.footprints.diag).toBe(leading(facts, 'footprint DIAG'))
      expect(result.stats.footprints.column).toBe(leading(facts, 'footprint COLUMN'))
      expect(result.stats.footprints.tri).toBe(leading(facts, 'footprint TRI'))
      expect(result.stats.footprints.none).toBe(leading(facts, 'footprint NONE'))

      // W4's movement, pinned so it cannot drift back. The literals are the only
      // ones in this block, because they are the claim the row is accountable
      // for. Seven groups move and nothing else:
      //
      //   none -> column   119   size|column_shape, four measured letters
      //   wall -> diag     121   shape|angled|right with no depth
      //   rect -> tri        9   shape|angled|right with a depth
      //   arc  -> wall      84   the xG interface walls
      //   arc  -> rect      24   inverted plates whose box the mesh honours
      //   arc  -> none      57   36 inverted fragments, 21 lintel inserts
      //   rect -> none      20   lettered component| parts of a curved design
      //   arc  -> none      27   W5: the xG interface FLOORS, whose width is nowhere
      //
      // 3454 - 9 - 20 + 24 = 3449 · 3116 - 121 + 84 = 3079 · 1391 - 192 = 1199 ·
      // 741 - 119 + 57 + 20 + 27 = 726.
      expect(result.stats.footprints.rect).toBe(3_449)
      expect(result.stats.footprints.wall).toBe(3_079)
      expect(result.stats.footprints.arc).toBe(1_199)
      expect(result.stats.footprints.diag).toBe(121)
      expect(result.stats.footprints.column).toBe(119)
      expect(result.stats.footprints.tri).toBe(9)
      expect(result.stats.footprints.none).toBe(726)

      // 91.7%, computed. Coverage is deliberately not monotone across the list
      // above — 104 tiles LOSE a footprint, because W1 measured them and the one
      // they had was wrong. The plan predicted ~95% before it had measurements;
      // this is what the change produces.
      const covered = result.stats.records - (result.stats.footprints.none ?? 0)
      expect(((100 * covered) / result.stats.records).toFixed(1)).toBe('91.7')
      expect(((100 * covered) / result.stats.records).toFixed(1)).toBe(
        facts.get('coverage all seven cases')?.replace('%', ''),
      )

      // Every case the schema declares and no others. A `footprintKind` the
      // union has no member for would fail `CatalogFile.parse`, but only after
      // the build has already tallied it, so the tally is checked directly.
      expect(Object.keys(result.stats.footprints).sort()).toEqual([
        'arc',
        'column',
        'diag',
        'none',
        'rect',
        'tri',
        'wall',
      ])
    })

    it('gives every sector a band, and says which of them are measured', () => {
      // Row W5. A sector needs two radii and the tag gives one, so the missing
      // piece is the band — and the band is a PARAMETER, which is why the
      // verify script does not mirror it: the offsets live in
      // `pipeline/tessellation.ts` and the code-to-band map in W2's table, and a
      // second copy in Python would give both two homes. This asserts against
      // the emitted index instead, which is a stronger check than a mirror.
      const arcs = result.file.records
        .map((record) => record.foot)
        .filter((foot): foot is Extract<typeof foot, { shape: 'arc' }> => foot.shape === 'arc')
      expect(arcs).toHaveLength(1_199)

      const tally = (values: readonly string[]) => {
        const counts: Record<string, number> = {}
        for (const value of values) counts[value] = (counts[value] ?? 0) + 1
        return counts
      }
      expect(tally(arcs.map((foot) => foot.band))).toEqual({
        concave: 585,
        convex: 397,
        radial: 195,
        s2w_radial: 10,
        disc: 12,
      })
      // `F` is a `disc` and not a `radial`, which is W2's table's call and not
      // this module's: `[0, 2]` at R = 2 is exactly where the radial band
      // degenerates to a quarter disc. Reading the table beats restating a
      // code-to-band map, and this is the case that proves it.
      expect(ARC_BAND_EVIDENCE.disc.measuredBlobs).toBe(11)

      // `measured` means the band rule has an accepted W1 sector fit behind it
      // AND the tile named its band. The 462 that do not: 397 `convex` (43
      // meshes attempted, 43 refused), 10 `s2w_radial` (never attempted — all 10
      // carry a modifier, so they were in none of W1's five target sets) and 55
      // that named no band at all and took the `radial` default.
      expect(tally(arcs.map((foot) => foot.bandBasis))).toEqual({ measured: 737, fallback: 462 })
      expect(397 + 10 + 55).toBe(462)

      // The two unmeasured bands can never be stamped otherwise, and the schema
      // is what enforces it rather than this test — `CatalogFile.parse` has
      // already run over every record by the time we get here.
      for (const foot of arcs) {
        if (foot.band === 'convex' || foot.band === 's2w_radial') expect(foot.bandBasis).toBe('fallback')
        expect(arcBandIsMeasured(foot.band)).toBe(ARC_BAND_EVIDENCE[foot.band].basis === 'measured')
      }

      // Every band rule agrees with W2's offsets, which is where they live, and
      // every pair is a real band: the sector formula needs rOut > rIn and the
      // schema refines on it.
      for (const foot of arcs) {
        const pair = arcBandFor(foot.band, arcInterfaceRadius(foot))
        expect(pair.innerRadiusUnits).toBeCloseTo(foot.rIn, 10)
        expect(pair.outerRadiusUnits).toBeCloseTo(foot.rOut, 10)
        expect(foot.rOut).toBeGreaterThan(foot.rIn)
        expect(foot.sweep).toBeLessThanOrEqual(MAX_SECTOR_SWEEP_DEG)
      }

      // The two vocabularies are the same five strings, and W2's `ArcBand` is
      // the one that holds the numbers. `arcBandFor` above is typed on it, so a
      // divergence in the names is already a compile error; this checks the
      // runtime lists have not drifted apart either.
      expect([...ArcBand.options].sort()).toEqual(Object.keys(ARC_BAND_RULES).sort())
      for (const band of ArcBand.options) {
        expect(ARC_BAND_EVIDENCE[band].side).toBe(arcBandSideOfRadius(band))
        expect(ARC_BAND_EVIDENCE[band].expression).toBe(ARC_BAND_RULES[band].expression)
      }

      // The sweeps the corpus actually uses: a bisection ladder and nothing else.
      expect([...new Set(arcs.map((foot) => foot.sweep))].sort((a, b) => a - b)).toEqual([11.25, 22.5, 45, 90])
    })

    it('agrees on where each of the 1,199 sectors got its band from', () => {
      // Row W5's resolution order, measured end to end. The verify script owns
      // the half that is a fact about tags — 1,090 sectors name their own band
      // and 109 do not — and this owns the half that needs W2's table, because
      // splitting those 109 means asking whether the tile's code has an `arc`
      // row. Neither side can produce the other's number, which is the whole
      // reason the split is where it is.
      const facts = verifyFacts()
      const arcs = result.file.records.filter((record) => record.foot.shape === 'arc')
      expect(arcs).toHaveLength(1_199)

      // The band modifiers, derived from `CURVE_TAG_SEGMENTS` rather than listed:
      // a curve's segments are `curved` plus the three that say which SIDE of the
      // interface radius the material is on, and only those three name a band.
      // The script derives its own list the same way from the same four, so
      // neither can grow a fourth modifier without the other.
      const bandModifiers = CURVE_TAG_SEGMENTS.filter((segment) => segment !== 'curved')
      expect([...bandModifiers].sort()).toEqual(['concave', 'convex', 'radial'])

      const routeOf = (record: (typeof arcs)[number]): 'modifier' | 'code' | 'default' => {
        const tags = resolveTags(result.file, record)
        if (tags.some((tag) => tag.split('|').some((segment) => bandModifiers.includes(segment)))) {
          return 'modifier'
        }
        const row = record.sizeCode === undefined ? undefined : TESSELLATION_BY_CODE.get(record.sizeCode)
        return row?.size.kind === 'arc' ? 'code' : 'default'
      }
      const routes = { modifier: 0, code: 0, default: 0 }
      const codesUsed = new Map<string, number>()
      for (const record of arcs) {
        const route = routeOf(record)
        routes[route] += 1
        if (route === 'code' && record.sizeCode !== undefined) {
          codesUsed.set(record.sizeCode, (codesUsed.get(record.sizeCode) ?? 0) + 1)
        }
      }

      expect(routes).toEqual({ modifier: 1_090, code: 54, default: 55 })
      expect(routes.modifier).toBe(leading(facts, 'ARC naming its own band'))
      expect(routes.code + routes.default).toBe(leading(facts, 'ARC naming no band'))
      // The five codes carrying an arc row, and the reason `arcBandFromCode`
      // exists at all: `V` and `VxE` carry identical tags and are a quarter disc
      // and an annular band, so nothing but the letter separates them.
      expect([...codesUsed.entries()].sort()).toEqual([
        ['F', 6],
        ['V', 6],
        ['VxE', 6],
        ['X', 18],
        ['XA', 18],
      ])
      // A tile on the default route names no band and its code carries no arc
      // row — so `radial` is written, not derived, and `bandBasis` says so.
      expect(arcs.filter((record) => routeOf(record) === 'default').every((record) => record.foot.shape === 'arc' && record.foot.bandBasis === 'fallback')).toBe(true)
    })

    it('places every column it can and refuses the one letter nobody measured', () => {
      const facts = verifyFacts()
      const columns = live.filter((row) => row.tags.some((tag) => tag.startsWith('size|column_shape|')))
      const shapeOf = (row: FixtureRow) => shapeByPath.get(row.file_metadata.full_name)
      const letterOf = (row: FixtureRow) =>
        row.tags.find((tag) => tag.startsWith('size|column_shape|'))?.split('|')[2]

      expect(columns).toHaveLength(133)
      expect(columns.filter((row) => shapeOf(row) === 'column')).toHaveLength(119)

      // The refusal is exactly `col+T` and exactly W2's confidence label. Read
      // off `isMeasured` rather than restated, so a future measurement of that
      // row moves this test by moving the table.
      const refused = columns.filter((row) => shapeOf(row) !== 'column')
      expect(refused).toHaveLength(14)
      expect([...new Set(refused.map(letterOf))]).toEqual(['T'])
      for (const row of columns) {
        const entry = COLUMN_TOKEN_BY_LETTER.get(letterOf(row) ?? '')
        expect(entry).toBeDefined()
        expect(shapeOf(row) === 'column').toBe(isMeasured(entry as { confidence: 'measured' }))
      }

      // `shape|column` is the wrong gate, and this is the pair that proves it:
      // a 1 x 1 cell and a 2 x 2 right triangle, both column-shaped subjects on
      // a tile footprint. Calling either a 0.5 x 0.5 pillar shrinks it fourfold.
      const shapeColumns = live.filter((row) => row.tags.includes('shape|column'))
      expect(shapeColumns).toHaveLength(135)
      const notPillars = shapeColumns.filter((row) => !columns.includes(row))
      expect(notPillars.map((row) => shapeOf(row))).toEqual(['rect', 'tri'])

      expect(refused).toHaveLength(
        Number(facts.get('columns refused as unmeasured')?.split(':')[0] ?? -1),
      )
    })

    it('splits the 45-degree family into a triangle and a run, with nothing left over', () => {
      const diagonals = live.filter((row) => row.tags.includes('shape|angled|right'))
      const shapeOf = (row: FixtureRow) => shapeByPath.get(row.file_metadata.full_name)
      expect(diagonals).toHaveLength(130)
      expect(diagonals.filter((row) => shapeOf(row) === 'diag')).toHaveLength(121)
      expect(diagonals.filter((row) => shapeOf(row) === 'tri')).toHaveLength(9)
      // Total: no angled-right tile falls through to rect, wall or none.
      expect(diagonals.every((row) => shapeOf(row) === 'diag' || shapeOf(row) === 'tri')).toBe(true)
      // And every one of them is a 45-degree piece, which is the claim the tag
      // is being trusted for. `shape|angled` alone would also select 79
      // `plain#base+angled` bases with no angle at all and 48 hex pieces at 60.
      expect(diagonals.every((row) => row.tags.includes('size|angle|45'))).toBe(true)

      // The runs are W2's measurements, and not one of them is the tagged 2.
      const runs = new Map(
        result.file.records
          .filter((record) => record.foot.shape === 'diag')
          .map((record) => [record.sizeCode, record.foot.shape === 'diag' ? record.foot.run : 0]),
      )
      expect([...runs.entries()].sort()).toEqual([
        ['P', 3.536],
        ['PA', 2.828],
        ['PB', 2.835],
        ['PC', 3.334],
      ])
      expect(diagonals.filter((row) => shapeOf(row) === 'diag').every((row) => row.tags.includes('size|width|2'))).toBe(
        true,
      )
    })

    it('de-arcs exactly the 192 tiles W1 refused a sector fit on', () => {
      const facts = verifyFacts()
      const shapeOf = (row: FixtureRow) => shapeByPath.get(row.file_metadata.full_name)
      const withRadius = live.filter((row) => row.tags.some((tag) => tag.startsWith('size|radius|')))
      const reassigned = withRadius.filter((row) => radiusIsFeature(row.tags))

      expect(reassigned).toHaveLength(leading(facts, 'radius reassigned to a feature'))
      expect(reassigned).toHaveLength(192)
      // W4's 165 were exactly the radius-carrying tiles with no `size|angle`.
      // W5's 27 are the other side of the same fact: they DO carry a sweep, and
      // W1 refused a sector fit on them anyway, because a curved interface is a
      // bite out of a rectangle rather than a sector. So the set is no longer
      // "radius without a sweep" — it is "radius that is not an outline", which
      // is what `radiusIsFeature` was always named for.
      const sweepless = withRadius.filter((row) => !row.tags.some((tag) => tag.startsWith('size|angle|')))
      expect(sweepless).toHaveLength(165)
      expect(sweepless.every((row) => reassigned.includes(row))).toBe(true)
      const swept = reassigned.filter((row) => !sweepless.includes(row))
      expect(swept).toHaveLength(27)
      expect(swept.every((row) => row.tags.includes(CURVED_INTERFACE_TAG))).toBe(true)
      expect(swept.every((row) => shapeOf(row) === 'none')).toBe(true)
      expect(reassigned.some((row) => shapeOf(row) === 'arc')).toBe(false)

      const landed = (predicate: (row: FixtureRow) => boolean) => {
        const rows = reassigned.filter(predicate)
        const counts: Record<string, number> = {}
        for (const row of rows) {
          const shape = shapeOf(row) ?? '?'
          counts[shape] = (counts[shape] ?? 0) + 1
        }
        return counts
      }
      // 111 curved interfaces, and the split inside them is the whole of W5's
      // classification change: a wall run has a measured length in W2's table, a
      // floor has nothing, and their code is not even in `size|openlock`.
      expect(landed((row) => row.tags.includes(CURVED_INTERFACE_TAG))).toEqual({ none: 27, wall: 84 })
      expect(landed((row) => row.tags.some((tag) => tag === 'size|openlock|QxG' || tag === 'size|openlock|AxG' || tag === 'size|openlock|BAxG'))).toEqual({ wall: 84 })
      expect(landed((row) => row.tags.some((tag) => tag.split('|').includes('inverted')))).toEqual({ rect: 24, none: 36 })
      expect(landed((row) => row.tags.includes('part|lintel'))).toEqual({ none: 21 })

      // The correction the row exists for: QxG is tagged 4 and is 3.
      const qxg = result.file.records.filter((record) => record.sizeCode === 'QxG')
      expect(qxg).toHaveLength(28)
      expect(new Set(qxg.map((record) => JSON.stringify(record.foot)))).toEqual(
        new Set([JSON.stringify({ shape: 'wall', length: 3 })]),
      )
      expect(qxg.every((record) => resolveTags(result.file, record).includes('size|width|4'))).toBe(true)
    })

    it('agrees on the four size codes that span two primitives, from the emitted shape', () => {
      // Row D4's premise, derived a third time and from a third artefact. The
      // verify script reads it off the TAGS with a coarse key,
      // `src/assembly/assembly.test.ts` reads it off the built index with the
      // fully dimensioned `footprintKey`, and this reads it off the footprint
      // this build just emitted. All three have to name the same four codes out
      // of 36 — and the second half of this test is stronger than that: the
      // script's per-code spans are compared key by key against the emitted
      // shapes, so a span that drifted would have to drift on both sides in the
      // same direction to survive.
      const facts = verifyFacts()
      const spans = new Map<string, Map<string, number>>()
      for (const record of result.file.records) {
        if (record.sizeCode === undefined || record.foot.shape === 'none') continue
        const tally = spans.get(record.sizeCode) ?? new Map<string, number>()
        tally.set(record.foot.shape, (tally.get(record.foot.shape) ?? 0) + 1)
        spans.set(record.sizeCode, tally)
      }

      const ambiguous = [...spans.entries()]
        .filter(([, tally]) => tally.size > 1)
        .map(([code]) => code)
        .sort()
      expect(ambiguous).toEqual(['I', 'O', 'S', 'X'])
      expect(ambiguous).toHaveLength(leading(facts, 'codes spanning 2+ primitives'))
      expect(ambiguous).toEqual(facts.get('codes spanning 2+ primitives')?.split(': ')[1]?.split(', '))
      // 36 codes, 35 of which reach a footprint: `T` is W2's one unmeasured
      // column letter and all 14 of its tiles are NONE, so it has no span at all.
      expect(new Set(result.file.records.map((record) => record.sizeCode).filter((code) => code !== undefined)).size).toBe(36)
      expect(spans.size).toBe(35)

      // The script's row, key by key. `O = 34 column, 5 tri:2, 4 tri:4` becomes
      // `{ column: 34, tri: 9 }` — the dimensions are the half only the script
      // spells here, and the discriminant is the half only the emitted footprint
      // can confirm.
      const fromScript = new Map<string, Record<string, number>>()
      for (const span of (facts.get('ambiguous code spans') ?? '').split(' \u00b7 ')) {
        const [code, tail] = span.split(' = ')
        if (code === undefined || tail === undefined) continue
        const tally: Record<string, number> = {}
        for (const part of tail.split(', ')) {
          const [count, key] = part.split(' ')
          if (count === undefined || key === undefined) continue
          tally[shapeOfKey(key)] = (tally[shapeOfKey(key)] ?? 0) + Number(count)
        }
        fromScript.set(code, tally)
      }
      expect([...fromScript.keys()].sort()).toEqual(ambiguous)
      for (const code of ambiguous) {
        expect(Object.fromEntries([...(spans.get(code) ?? [])])).toEqual(fromScript.get(code))
      }
      // And the headline case in full, because "a code spans two primitives" is
      // abstract and "a code join can put a 0.5 x 0.5 pillar under a 4 x 4
      // triangle" is what it means.
      expect(fromScript.get('O')).toEqual({ column: 34, tri: 9 })
      expect(fromScript.get('X')).toEqual({ arc: 18, column: 11 })
      expect(fromScript.get('I')).toEqual({ column: 24, rect: 84 })
      expect(fromScript.get('S')).toEqual({ rect: 176, wall: 6 })

      const under = result.file.records.filter(
        (record) =>
          record.sizeCode !== undefined && ambiguous.includes(record.sizeCode) && record.foot.shape !== 'none',
      )
      expect(under).toHaveLength(leading(facts, 'records under an ambiguous code'))
      expect(under).toHaveLength(362)
    })

    it('coarsens a congruence key to its discriminant without losing anything', () => {
      // The premise `shapeOfKey` rests on, and the reason the comparison above is
      // exact rather than approximate: a `footprintKey` is its shape name, or its
      // shape name followed by `:` and the parameters the verify script does not
      // hold. Checked against the real function over every emitted footprint, not
      // asserted in a comment — which is what it was until rows W7, X4 and X5
      // between them made the import possible.
      //
      // What makes this fail: a new footprint case whose key does not start with
      // its own discriminant (`0.5sq` for a column, say). The span comparison
      // above would then silently compare a key against a shape name that is not
      // a prefix of it, and agree by mapping both sides to nonsense.
      const keyed = result.file.records.filter((record) => record.foot.shape !== 'none')
      expect(keyed.length).toBe(result.stats.records - (result.stats.footprints.none ?? 0))
      for (const record of keyed) {
        const key = footprintKey(record.foot)
        expect(key, record.id).toBeDefined()
        expect(shapeOfKey(key ?? ''), record.id).toBe(record.foot.shape)
      }
      // And the other half of the rule: `none` keys to nothing at all, because a
      // shared `'none'` key would match every shapeless topper to every shapeless
      // base. `footprint.ts` prices that at 27,976 false pairs.
      for (const record of result.file.records) {
        if (record.foot.shape !== 'none') continue
        expect(footprintKey(record.foot), record.id).toBeUndefined()
      }
      // How much the coarsening actually throws away, as a number: **76 distinct
      // keys collapse onto 6 discriminants.** That is the price of comparing at
      // the granularity the script can spell, stated rather than implied, and it
      // moves if a new footprint case lands or a band is re-measured.
      const keys = new Set(keyed.map((record) => footprintKey(record.foot)))
      expect(keys.size).toBe(76)
      expect([...new Set([...keys].map((key) => shapeOfKey(key ?? '')))].sort()).toEqual([
        'arc',
        'column',
        'diag',
        'rect',
        'tri',
        'wall',
      ])
    })

    it('agrees with the script on the print option every base amounts to', () => {
      // Row D1's candidate pool, derived from the emitted tags by the same
      // function the assembly index folds with. The script reads the raw fixture
      // rows and ranks the modifier slot itself; this reads `printOption` over
      // the interned tag list the index will actually serve. W7 asked for this
      // comparison and could not have it — the pipeline project did not admit
      // `src/assembly/assemblyIndex.ts` until row X4.
      //
      // What makes this fail: `printOption`'s ranking and the script's
      // `RANKED_PRINT_MODIFIERS` disagreeing about which modifier wins, or a
      // normalisation step rewriting a `connection|…|topless` segment on the way
      // into the index. Either way one side moves and the other does not.
      const facts = verifyFacts()
      const bases = result.file.records.filter((record) => record.layer === 'base')
      expect(bases).toHaveLength(leading(facts, 'shape|base tiles'))

      const tally: Record<string, number> = {}
      for (const record of bases) {
        const option = printOption(resolveTags(result.file, record))
        tally[option] = (tally[option] ?? 0) + 1
      }
      const rendered = Object.entries(tally)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([option, count]) => `${option} ${String(count)}`)
        .join(', ')
      expect(rendered).toBe(facts.get('bases by print option'))
      // The headline, in full: 584 of the 1,963 bases are a print variant rather
      // than the base itself, which is the pool D1's old bytes-ascending
      // tie-break was drawing 79.1% of its openlock answers from.
      expect(tally).toEqual({ plain: 1379, topless: 378, unsupported: 206 })
    })

    it('agrees on the base range that bounds every match', () => {
      // What a topper can possibly be matched to, and the fact rows D4 and D5
      // both rest on: **not one base in the corpus is a triangle, a diagonal run
      // or a pillar.** So the 130 `shape|angled|right` tiles and the 119 columns
      // are a gap in what has been published, not a resolver failure — which is
      // why D5 files them upstream rather than widening the match.
      //
      // The count of classes those bases fall into is asserted where the key
      // lives: `src/assembly/assembly.test.ts` pins `stats.baseFootprints` at 44
      // over 1,835 keyed bases. This side owns the distribution and the absence.
      const facts = verifyFacts()
      const bases = result.file.records.filter((record) => record.layer === 'base')
      expect(bases).toHaveLength(leading(facts, 'layer base'))

      const shapes: Record<string, number> = {}
      for (const record of bases) shapes[record.foot.shape] = (shapes[record.foot.shape] ?? 0) + 1
      // The script's row verbatim, which it renders alphabetically.
      expect(
        Object.entries(shapes)
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([name, count]) => `${String(count)} ${name}`)
          .join(', '),
      ).toBe(facts.get('base primitives'))
      expect(shapes).toEqual({ arc: 313, none: 128, rect: 1_037, wall: 485 })
      expect(Object.keys(shapes).sort()).toEqual(['arc', 'none', 'rect', 'wall'])
      expect(1_963 - 128).toBe(1_835)
    })

    it('agrees that the only curve markers the substring scan added were hex', () => {
      // The claim `footprint.ts` used to make and decline to test: that making
      // the scan segment-exact "would move the NONE bucket". It moves nothing.
      // Both scans are computed here rather than imported, so a change to
      // `hasCurveMarker` cannot make this test agree with itself.
      const facts = verifyFacts()
      const markers = [...CURVE_TAG_SEGMENTS, ...NON_CURVE_TAG_SEGMENTS]
      const substring = live.filter((row) => {
        const joined = row.tags.join(' ')
        return markers.some((marker) => joined.includes(marker))
      })
      const segmentExact = live.filter((row) =>
        row.tags.some((tag) => tag.split('|').some((seg) => CURVE_TAG_SEGMENTS.includes(seg))),
      )
      const falsePositives = substring.filter((row) => !segmentExact.includes(row))

      expect(segmentExact).toHaveLength(leading(facts, 'curve-marked \u00b7 segment scan'))
      expect(substring).toHaveLength(leading(facts, 'curve-marked \u00b7 substring scan'))
      expect(falsePositives).toHaveLength(leading(facts, 'curve marker false positives'))
      // Every one of them is a hex tile, and every one of them still has no
      // footprint — because it carries no size tag, not because a hex is a curve.
      expect(
        falsePositives.every((row) =>
          row.tags.some((tag) => tag.split('|').some((seg) => NON_CURVE_TAG_SEGMENTS.includes(seg))),
        ),
      ).toBe(true)
      expect(falsePositives).toHaveLength(56)
      expect(
        falsePositives.every((row) => shapeByPath.get(row.file_metadata.full_name) === 'none'),
      ).toBe(true)
    })

    it('agrees on the fragments it refuses and the sectors it approximates', () => {
      const facts = verifyFacts()
      const fragments = live.filter((row) => row.tags.some((tag) => tag.startsWith('size|segment|')))
      const shapeOf = (row: FixtureRow) => shapeByPath.get(row.file_metadata.full_name)

      // A fragment's width/depth pair names the design it is one lettered piece
      // of, so there is nothing to place. `8x8+b` measures 4.000 x 4.000 in one
      // design and 2.079 x 1.931 in another, so it is not derivable either.
      //
      // After W4 **all 319** are NONE. W3 reached 283, because a radius outranked
      // the fragment veto on the 36 `curved+inverted` pieces; W1 measured those
      // 36 and their tagged 7 x 7 is 5 x 2, so the radius was never an outline.
      expect(fragments).toHaveLength(leading(facts, 'size|segment fragments'))
      expect(fragments).toHaveLength(319)
      expect(fragments.filter((row) => shapeOf(row) === 'arc')).toHaveLength(
        leading(facts, 'fragments \u00b7 radius wins'),
      )
      expect(fragments.filter((row) => shapeOf(row) === 'arc')).toEqual([])
      expect(fragments.filter((row) => shapeOf(row) === 'none')).toHaveLength(
        leading(facts, 'fragments \u00b7 vetoed to NONE'),
      )
      // A fragment has no footprint at all now. Never rect, never wall, never arc.
      expect(fragments.every((row) => shapeOf(row) === 'none')).toBe(true)

      // The movers, and the honest label on them: a curve-marked RECT is an
      // axis-aligned over-approximation of an annular sector. **W5 reshaped none
      // of them**, and this count is the guard that the set did not drift while
      // it reshaped the arcs: W1 fitted 402 of the 407 and accepted 96, so 306
      // carry no measured sector and no radius or sweep to build one from, and a
      // trusted over-approximation places where a fabricated sector does not.
      // 407, not W3's 403: the 24 unlettered `inverted` plates arrived from ARC
      // and the 20 `shingles` barge-boards left for NONE.
      const curvedRects = live.filter(
        (row) =>
          shapeOf(row) === 'rect' &&
          row.tags.some((tag) => tag.split('|').some((seg) => CURVE_TAG_SEGMENTS.includes(seg))),
      )
      expect(curvedRects).toHaveLength(leading(facts, 'RECT that is really a sector'))
      expect(curvedRects).toHaveLength(407)

      // 27 of the 407 are NOT over-approximations: an `inverted` plate is a
      // square with a curved cut, so its box IS its outline and W5 must leave it
      // alone. Measured 3.000 x 3.000 and 5.000 x 5.000, exactly.
      const invertedRects = curvedRects.filter((row) =>
        row.tags.some((tag) => tag.split('|').includes('inverted')),
      )
      expect(invertedRects).toHaveLength(leading(facts, 'RECT curve-marked but NOT a sector'))
      expect(invertedRects).toHaveLength(27)
    })

    it('agrees on what is left in NONE, and why each part of it is refused', () => {
      const facts = verifyFacts()
      const stranded = live.filter((row) => shapeByPath.get(row.file_metadata.full_name) === 'none')
      const coded = stranded.filter((row) => row.tags.some((tag) => tag.startsWith('size|openlock|')))
      const fragments = stranded.filter((row) => row.tags.some((tag) => tag.startsWith('size|segment|')))
      const interfaces = stranded.filter((row) => row.tags.includes(CURVED_INTERFACE_TAG))
      const neither = stranded.filter(
        (row) => !coded.includes(row) && !fragments.includes(row) && !interfaces.includes(row),
      )

      expect(stranded).toHaveLength(leading(facts, 'footprint NONE'))
      expect(fragments).toHaveLength(leading(facts, 'NONE \u00b7 a fragment'))
      expect(interfaces).toHaveLength(leading(facts, 'NONE \u00b7 a curved interface, no code'))
      expect(neither).toHaveLength(leading(facts, 'NONE \u00b7 no code, no part letter'))
      // The four are disjoint and exhaustive: no NONE tile carries both a code
      // and a fragment letter, and W5's 27 carry no code at all, so the breakdown
      // is a partition and the rows' shares of the 726 do not overlap.
      expect(coded.filter((row) => fragments.includes(row))).toEqual([])
      expect(interfaces.filter((row) => coded.includes(row) || fragments.includes(row))).toEqual([])
      expect(coded.length + fragments.length + interfaces.length + neither.length).toBe(stranded.length)
      expect(stranded).toHaveLength(726)
      expect(fragments).toHaveLength(319)
      expect(interfaces).toHaveLength(27)

      // W3 left 161 coded tiles here and W4 places 119 of them. The 42 that
      // remain are **deliberate refusals**, not unread tags, and they are two
      // codes: `col+T`, the one column letter W2 marks unmeasured, and `U`,
      // which is one of W2's four `ambiguous` codes — simultaneously a 4 x 4
      // floor and the Y/YA/Z/ZA octagon segments. All 28 of these are the
      // segments (`dungeon_stone#wall.Z`, `#window+arched.ZA`), they carry a
      // depth and no width, and none is measured, so resolving them from the
      // code would place a wall as a 4 x 4 floor.
      expect(coded).toHaveLength(42)
      const codes = new Map<string, number>()
      for (const row of coded) {
        const code = row.tags.find((tag) => tag.startsWith('size|openlock|'))?.split('|')[2] ?? '?'
        codes.set(code, (codes.get(code) ?? 0) + 1)
      }
      expect([...codes.entries()].sort()).toEqual([
        ['T', 14],
        ['U', 28],
      ])
    })

    it('agrees that no arc anywhere gets a fabricated sweep', () => {
      // `DEFAULT_ARC_SWEEP_DEG` invented 90 degrees for 165 arc tiles, and W1
      // fitted an annular sector to every one of those 165 and refused all 165.
      // So W4 deleted the constant and moved the tiles out of ARC instead. The
      // 165 still exist as a population — they are the tiles whose radius
      // parameterises a feature — and the claim here is that not one of them is
      // an arc any more, so no sweep is invented anywhere.
      const facts = verifyFacts()
      const shapeOf = (row: FixtureRow) => shapeByPath.get(row.file_metadata.full_name)
      const sweepless = live.filter(
        (row) =>
          !row.tags.some((tag) => tag.startsWith('size|angle|')) &&
          row.tags.some((tag) => tag.startsWith('size|radius|')),
      )
      expect(sweepless).toHaveLength(165)
      expect(sweepless.filter((row) => shapeOf(row) === 'arc')).toEqual([])
      expect(leading(facts, 'ARC with no size|angle')).toBe(0)
      expect(
        result.file.records.filter(
          (record) => record.foot.shape === 'arc' && !resolveTags(result.file, record).some((tag) => tag.startsWith('size|angle|')),
        ),
      ).toEqual([])
    })

    it('agrees on the connection vocabulary, position segment and all', () => {
      const facts = verifyFacts()
      const tagged = live.map((row) => row.tags)
      const noConnection = tagged.filter((tags) => !tags.some((t) => t.startsWith('connection|'))).length
      const openforge = tagged.filter((tags) => tags.some((t) => t.startsWith('connection|openforge'))).length
      const withLock = tagged.filter((tags) => connectionSystems(tags).some(isLockSystem)).length
      const multi = tagged.filter((tags) => connectionSystems(tags).length >= 2).length
      // The position vocabulary, not the one literal `connection|side|` this line
      // used to hardcode — which asserted the shape of the bug rather than the
      // definition, and would have stayed green when `bottom` was added.
      const positional = tagged.filter((tags) =>
        tags.some((t) => CONNECTION_POSITIONS.some((position) => t.startsWith(`connection|${position}|`))),
      ).length
      const barePosition = tagged.filter((tags) =>
        tags.some((t) => CONNECTION_POSITIONS.some((position) => t === `connection|${position}`)),
      ).length

      expect(noConnection).toBe(leading(facts, 'no connection tag at all'))
      expect(openforge).toBe(leading(facts, 'carries connection|openforge'))
      expect(withLock).toBe(leading(facts, 'carries a lock system'))
      expect(multi).toBe(leading(facts, '2+ connection systems'))
      expect(positional).toBe(leading(facts, 'connection carries a position'))
      expect(barePosition).toBe(leading(facts, 'connection is a bare position'))
    })

    it('agrees that no connection system is named after a position', () => {
      const facts = verifyFacts()
      const vocabulary = new Set(result.file.records.flatMap((record) => record.conn))
      const phantom = CONNECTION_POSITIONS.filter((position) => vocabulary.has(position))

      // `connection|bottom` (6 tags), `|left` (1) and `|right` (1) are positions
      // with no system on them. Read as systems they minted three phantom values
      // that the `conn` facet then offered as filters with counts 6, 1 and 1.
      expect(phantom).toEqual([])
      expect(vocabulary.size).toBe(leading(facts, 'distinct connection systems'))
      expect(leading(facts, 'systems named after a position')).toBe(0)
    })

    it('agrees on the joinery each layer carries, per face', () => {
      const facts = verifyFacts()
      for (const layer of ['topper', 'integral', 'base', 'insert'] as const) {
        const rowsIn = live.filter((row) => classifyLayer(row.tags) === layer)
        const locksAt = (tags: readonly string[], face: 'bottom' | 'side') =>
          connectionsByPosition(tags)[face].filter(isLockSystem)
        const bottom = rowsIn.filter((row) => locksAt(row.tags, 'bottom').length > 0).length
        const sideOnly = rowsIn.filter(
          (row) => locksAt(row.tags, 'side').length > 0 && locksAt(row.tags, 'bottom').length === 0,
        ).length

        expect(rowsIn).toHaveLength(leading(facts, `layer ${layer}`))
        expect(bottom).toBe(leading(facts, `${layer} \u00b7 bottom lock`))
        expect(sideOnly).toBe(leading(facts, `${layer} \u00b7 side lock only`))
      }
    })

    it('agrees that not one topper carries a bottom lock', () => {
      // The fact the aggregate substrate rests on, and the reason position may not
      // be flattened. A topper's underside IS `connection|openforge` — the
      // declaration that its joinery lives on a separately printed base — so the
      // toppers that name a lock name it on the *side*, to the neighbour. Read off
      // the flattened `conn` list those look like tiles offering that lock
      // underneath, which is joinery the mesh does not have.
      //
      // Both figures come from the oracle, not from a literal here, so the day the
      // corpus grows a topper with a bottom lock this fails rather than lying.
      const facts = verifyFacts()
      const toppers = live.filter((row) => classifyLayer(row.tags) === 'topper')
      const withBottomLock = toppers.filter(
        (row) => connectionsByPosition(row.tags).bottom.filter(isLockSystem).length > 0,
      )
      const withSideLock = toppers.filter(
        (row) => connectionsByPosition(row.tags).side.filter(isLockSystem).length > 0,
      )

      expect(toppers).toHaveLength(leading(facts, 'layer topper'))
      expect(withBottomLock).toHaveLength(leading(facts, 'topper \u00b7 bottom lock'))
      expect(leading(facts, 'topper \u00b7 bottom lock')).toBe(0)

      // And the ones the flat reading would have mis-sold: they do offer a lock,
      // just not where a base matcher needs it.
      expect(withSideLock).toHaveLength(leading(facts, 'topper \u00b7 side lock only'))
      expect(withSideLock.length).toBeGreaterThan(1_000)
      expect(withSideLock.every((row) => connectionSystems(row.tags).some(isLockSystem))).toBe(true)
    })

    it('agrees on the five shapes a design collapses into', () => {
      // Row A1's class counts, derived a second time. `pipeline/aggregate.test.ts`
      // asserts them off `buildAggregateIndex`; the verify script now derives the
      // same five from the raw fixtures, grouping on its own `design_key` and its
      // own port of `classifyLayer`. Two independent derivations of one figure is
      // the whole point — a copy of A1's numbers would have proved nothing.
      const facts = verifyFacts()
      const index = buildAggregateIndex(result.file)
      expect(index.stats.aggregates).toBe(leading(facts, 'distinct designs (connection only)'))
      expect(renderTally(index.stats.classes)).toBe(facts.get('aggregate classes'))

      // `mixed` is 0 **by construction**, not by measurement, and the script says
      // so in that many words: `classifyLayer` reads `part|`, `shape|base` and
      // `connection|openforge`, and the design key collapses only the last — so
      // the only two layers that can meet inside one design are topper and
      // integral. Asserting 0 here would be an invariant that cannot fail; what
      // can fail is the premise, so that is what is checked.
      expect(index.stats.classes.mixed).toBe(0)
      expect(leading(facts, 'designs whose layer signal varies')).toBe(0)
      const signals = (tags: readonly string[]) =>
        `${String(tags.some((tag) => tag.startsWith('part|')))}/${String(tags.some((tag) => tag.startsWith('shape|base')))}`
      const perDesign = new Map<string, Set<string>>()
      for (const record of result.file.records) {
        const design = record.design as unknown as string
        const seen = perDesign.get(design) ?? new Set<string>()
        seen.add(signals(resolveTags(result.file, record)))
        perDesign.set(design, seen)
      }
      expect([...perDesign.values()].filter((seen) => seen.size > 1)).toEqual([])

      const spread = `${String(index.aggregates.filter((aggregate) => aggregate.variants.length === 1).length)} singletons, largest ${String(Math.max(...index.aggregates.map((aggregate) => aggregate.variants.length)))}`
      expect(spread).toBe(facts.get('aggregate spread'))
    })

    it('agrees on the design count', () => {
      const facts = verifyFacts()
      expect(result.stats.designs).toBe(leading(facts, 'distinct designs (connection only)'))
    })

    it('agrees on textures, build tags, bases and configs', () => {
      const facts = verifyFacts()
      const roots = new Set(
        result.file.tags.filter((tag) => tag.startsWith('texture|')).map((tag) => tag.split('|')[1]),
      )
      const noBuild = result.file.records.filter((r) => r.build === undefined).length
      const bases = live.filter((row) => row.tags.some((t) => t.startsWith('shape|base'))).length

      // Against the normalised row, not the raw one. The script reads raw
      // fixtures and reports both, so this cross-check names which reading it
      // means — and the row below pins that the two differ by exactly the alias.
      expect(roots.size).toBe(leading(facts, 'distinct texture roots (normalised)'))
      const retiredTextureRoots = new Set(
        TAG_ALIASES.filter(([retired]) => retired.startsWith('texture|')).map(
          ([retired]) => retired.split('|')[1],
        ),
      )
      expect(leading(facts, 'distinct texture roots')).toBe(roots.size + retiredTextureRoots.size)
      expect(noBuild).toBe(leading(facts, 'no build| tag'))
      expect(bases).toBe(leading(facts, 'shape|base tiles'))
      expect(result.stats.withConfig).toBe(leading(facts, 'tiles with a config'))
    })

    it('agrees on the tiles needing a finer rotation step than 90 degrees', () => {
      const facts = verifyFacts()
      const fine = result.file.records.filter(
        (r) => r.rotStep !== undefined && r.rotStep % 90 !== 0,
      ).length
      expect(fine).toBe(leading(facts, 'angle not a multiple of 90'))
    })
  })

  /* ------------------------------------------------------------- properties */

  it('reports the two derived axes as a closed, total tally', () => {
    // The emitted distribution is asserted in `role.test.ts`, off the tags. This
    // is the *reported* one, and it exists so the build's own summary cannot go
    // quiet: a ninth role key means the ladder produced `unknown`, and
    // `roleConfidence.none` above 0 means it ran out of rungs. Both are seeded,
    // so either reads as a number rather than as an absent key.
    expect(Object.keys(result.stats.roles).sort()).toEqual([...ROLES].sort())
    expect(Object.keys(result.stats.forms).sort()).toEqual([...FORMS].sort())
    expect(Object.values(result.stats.roles).reduce((a, b) => a + b, 0)).toBe(8702)
    expect(Object.values(result.stats.forms).reduce((a, b) => a + b, 0)).toBe(8702)
    expect(result.stats.roleConfidence).toEqual({ high: 7413, medium: 1246, low: 43, none: 0 })
    // Two derived references per record, on top of the 84,023 the scan produced.
    expect(result.stats.tags).toBe(930)
    expect(result.stats.tagReferences).toBe(101_427)
  })

  it('classifies every tile into exactly one layer, on disjoint signals', () => {
    // The three positive signals must stay mutually exclusive. If they ever
    // overlap, `classifyLayer` silently takes the first branch and a whole class
    // of tiles quietly changes layer.
    const overlapping = live.filter((row) => {
      const signals = [
        row.tags.some((t) => t.startsWith('part|')),
        row.tags.some((t) => t.startsWith('shape|base')),
        row.tags.some((t) => t.startsWith('connection|openforge')),
      ].filter(Boolean).length
      return signals > 1
    })
    expect(overlapping).toHaveLength(0)

    const total = Object.values(result.stats.layers).reduce((a, b) => a + b, 0)
    expect(total).toBe(result.stats.records)
  })

  it('gives the eight position-tagged records their real systems and no phantom', () => {
    // The whole population of the defect, listed rather than counted: every live
    // record carrying `connection|bottom`, `|left` or `|right`. Each used to get a
    // connection system named after the face, so the `conn` facet offered `bottom`
    // (6), `left` (1) and `right` (1) as things a user could filter by.
    // `side` is excluded because it was already in the vocabulary: a bare
    // `connection|side` never minted a phantom, and the 2,080 tiles carrying one
    // would drown the eight this row is about.
    const minted = ['bottom', 'left', 'right'].map((position) => `connection|${position}`)
    const affected = live.filter((row) => row.tags.some((tag) => minted.includes(tag)))
    expect(affected).toHaveLength(8)

    const byId = new Map<string, (typeof result.file.records)[number]>(
      result.file.records.map((record) => [record.id, record]),
    )
    const shapes = affected
      .map((row) => ({
        file: basename(row.file_metadata.full_name),
        conn: byId.get(row.file_metadata.full_name)?.conn,
      }))
      .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
    expect(shapes).toEqual([
      { file: 'catacombs#wall,loculus.S.openforge+split,bottom.stl', conn: ['openforge'] },
      { file: 'cave%sandstone+3#wall,slope.SB.openforge,bottom.stl', conn: ['openforge'] },
      { file: 'cave%sandstone+3#wall,slope.SB.openforge,side+dragonlock,bottom.stl', conn: ['dragonlock', 'openforge'] },
      { file: 'cave%sandstone+3#wall,slope.SB.openforge,side,bottom.stl', conn: ['openforge', 'openlock'] },
      { file: 'cave%sandstone+3#wall,slope.SB.openlock,bottom.stl', conn: ['openlock'] },
      { file: 'cave%sandstone+3#wall,slope.SB.openlock,side,bottom.stl', conn: ['openlock'] },
      { file: 'dungeon_stone#phone_portal.8x2.openforge,left.stl', conn: ['openforge'] },
      { file: 'dungeon_stone#phone_portal.8x2.openforge,right.stl', conn: ['openforge'] },
    ])
  })

  it('puts 19.5% of tiles in two or more kind buckets and 11.9% in none', () => {
    const multi = result.file.records.filter((r) => r.kinds.length >= 2).length
    const none = result.file.records.filter((r) => r.kinds.length === 0).length
    expect(((100 * multi) / result.stats.records).toFixed(1)).toBe('19.5')
    expect(((100 * none) / result.stats.records).toFixed(1)).toBe('11.9')
  })

  it('resolves 36 of the 37 texture roots onto a record', () => {
    // `texture` is the root of a tile's *first* texture tag. `texture|stucco`
    // (24 occurrences) is always secondary to an alphabetically earlier root, so
    // it never lands on a record even though the material registry is specified
    // against it. Asserted so the discrepancy stays a documented fact.
    //
    // Both counts dropped by one when `foundations` was collapsed into
    // `foundation`. Three different numbers are in play and were being conflated,
    // so all three are now asserted separately:
    //
    //   37  roots across all texture tags        (was 38)
    //   36  roots that win first position        (was 37)
    //   38  roots the material registry maps     (unchanged — it keeps the alias
    //       as the fallback for a caller resolving off raw fixtures)
    //
    // `stucco` is still exactly the root that exists but never wins.
    const onRecords = new Set(result.file.records.map((r) => r.texture).filter((r) => r !== undefined))
    const inTags = new Set(
      result.file.tags.filter((tag) => tag.startsWith('texture|')).map((tag) => tag.split('|')[1]),
    )
    expect(inTags.size).toBe(37)
    expect(onRecords.size).toBe(36)
    expect([...inTags].filter((root) => root !== undefined && !onRecords.has(root))).toEqual(['stucco'])
    expect(result.file.records.filter((r) => r.texture === undefined)).toHaveLength(89)
  })

  it('marks a sprite sheet on 8,701 of 8,702 tiles', () => {
    expect(result.file.records.filter((r) => r.sprite).length).toBe(live.length - 1)
  })

  it('gives every tile a name free of filename punctuation', () => {
    expect(result.file.records.filter((r) => /[#%+,|]/.test(r.name))).toHaveLength(0)
    expect(result.stats.distinctNames).toBeGreaterThan(3500)
  })

  it('carries composition configs through unresolved', () => {
    const withParts = result.file.records.filter((r) => (r.config?.parts ?? []).length > 0)
    const slots = withParts.flatMap((r) => r.config?.parts ?? [])
    expect(slots).toHaveLength(3695)
    expect(slots.filter((s) => s.optional === true)).toHaveLength(2645)
    // §5: `constrain` semantics are the plan's largest open question, so the raw
    // grammar is carried and nothing is resolved.
    expect(slots.flatMap((s) => s.tags.constrain ?? [])).toHaveLength(9156)
  })

  /* ------------------------------------------------------------ determinism */

  it('produces byte-identical output for two runs over identical input', () => {
    const again = buildCatalog({
      rows,
      manifest: emptyManifest(),
      thumbs: new Set(),
      mounts: emptyMountInventory(),
      fixturesRef: 'test',
      builtAt: BUILT_AT,
    })
    expect(serialiseCatalog(again.file)).toBe(json)
  }, SLOW_MS)

  it('produces the same output regardless of the order rows arrive in', () => {
    const shuffled = buildCatalog({
      rows: [...rows].reverse(),
      manifest: emptyManifest(),
      thumbs: new Set(),
      mounts: emptyMountInventory(),
      fixturesRef: 'test',
      builtAt: BUILT_AT,
    })
    expect(serialiseCatalog(shuffled.file)).toBe(json)
  }, SLOW_MS)

  /* --------------------------------------------------------------- ordinals */

  it('keeps every existing ordinal across an import that loses and gains tiles', () => {
    const first = buildCatalog({
      rows,
      manifest: emptyManifest(),
      thumbs: new Set(),
      mounts: emptyMountInventory(),
      fixturesRef: 'test',
      builtAt: BUILT_AT,
    })
    const before = new Map(first.file.records.map((r) => [r.id, r.ord]))

    const dropped = first.file.records[42]
    expect(dropped).toBeDefined()
    const invented: FixtureRow[] = ['zzz-new-a', 'zzz-new-b'].map((suffix) => ({
      tags: ['shape|floor', 'size|width|1', 'size|depth|1'],
      file_metadata: {
        file: `${suffix}.stl`,
        full_name: `tiles/${suffix}/${suffix}.stl`,
        md5: 'a'.repeat(32),
        size: 1,
      },
    }))

    const second = buildCatalog({
      rows: [...rows.filter((row) => row.file_metadata.full_name !== dropped?.id), ...invented],
      manifest: first.manifest,
      thumbs: new Set(),
      mounts: emptyMountInventory(),
      fixturesRef: 'test',
      builtAt: BUILT_AT,
    })

    for (const record of second.file.records) {
      const previous = before.get(record.id)
      if (previous !== undefined) expect(record.ord).toBe(previous)
    }

    const retiredOrdinal = dropped === undefined ? undefined : before.get(dropped.id)
    expect(retiredOrdinal).toBeDefined()
    expect(second.file.records.map((r) => r.ord)).not.toContain(retiredOrdinal)

    const highestBefore = Math.max(...before.values())
    expect(second.stats.newOrdinals).toBe(2)
    expect(second.stats.retiredOrdinals).toBe(1)
    for (const record of second.file.records) {
      if (!before.has(record.id)) expect(record.ord).toBeGreaterThan(highestBefore)
    }
  }, SLOW_MS)

  it('emits records in id order, not in ordinal order', () => {
    // Sorting by id is worth a large part of the brotli saving, because catalog
    // paths share long prefixes. It also means `ord === index` is false the
    // moment a single tile is retired, so nothing downstream can grow that
    // assumption unnoticed.
    const ids = result.file.records.map((r) => r.id)
    expect(ids).toEqual([...ids].sort())
  })

  /* --------------------------------------------------------- the thumb flag */

  describe('the /thumbs/ flag', () => {
    it('is false on every record when no inventory says otherwise', () => {
      // The state of the world: `tools/thumbnails/inventory.ts` HEADed all 8,352
      // candidate URLs on 2026-09-02 and found nothing, because the backfill is
      // blocked on R2 write credentials. This build passes no `thumbs` set at
      // all, which is the same answer arrived at the cheap way.
      expect(result.file.records.every((record) => !record.thumb)).toBe(true)
      expect(result.stats.withThumb).toBe(0)
    })

    it('flips the records whose md5 the inventory names, and only those', () => {
      const first = result.file.records[0]
      if (first === undefined) throw new Error('no records')
      const rebuilt = buildCatalog({
        rows,
        manifest: emptyManifest(),
        fixturesRef: 'test',
        builtAt: BUILT_AT,
        thumbs: new Set([first.blob]),
        mounts: emptyMountInventory(),
      })
      const flipped = rebuilt.file.records.filter((record) => record.thumb)
      expect(flipped.length).toBeGreaterThan(0)
      expect(flipped.every((record) => record.blob === first.blob)).toBe(true)
      expect(rebuilt.stats.withThumb).toBe(flipped.length)
    }, SLOW_MS)

    it('is keyed on the md5, so every row sharing a mesh agrees', () => {
      // 171 md5s are shared by 520 rows and the object is content-addressed, so
      // "does a thumbnail exist" is a property of the blob. A flag keyed on the
      // id would let two rows of one mesh disagree, and one of them would be
      // wrong. This is the case that would catch that.
      const shared = new Map<string, string[]>()
      for (const record of result.file.records) {
        const held = shared.get(record.blob) ?? []
        held.push(record.id)
        shared.set(record.blob, held)
      }
      const multi = [...shared.entries()].filter(([, ids]) => ids.length > 1)
      expect(multi.length).toBeGreaterThan(100)

      const pick = multi[0]?.[0]
      if (pick === undefined) throw new Error('no shared blob')
      const rebuilt = buildCatalog({
        rows,
        manifest: emptyManifest(),
        fixturesRef: 'test',
        builtAt: BUILT_AT,
        thumbs: new Set([pick]),
        mounts: emptyMountInventory(),
      })
      const rows_ = rebuilt.file.records.filter((record) => record.blob === pick)
      expect(rows_.length).toBeGreaterThan(1)
      expect(rows_.every((record) => record.thumb)).toBe(true)
    }, SLOW_MS)

    it('never claims a thumbnail for a tile with no sheet, because the crop comes from one', () => {
      // Not enforced by the schema — `@/ui/thumb` deliberately handles the
      // combination — but it is a property of the data today, and a build that
      // started producing it would mean the inventory had been probed against a
      // different corpus.
      const spriteless = result.file.records.filter((record) => !record.sprite)
      expect(spriteless).toHaveLength(1)
      expect(spriteless.every((record) => !record.thumb)).toBe(true)
    })
  })
})

/* -------------------------------------------------------------------- oracle */

/**
 * The verify script's table, run once and memoised.
 *
 * Called from inside each `it` rather than at suite scope: `describe.skip` still
 * *evaluates* its factory to collect test names, so a subprocess started there
 * runs even when the suite is skipped — and on a machine with no fixtures the
 * script exits 2 and takes the whole file down with a collection error rather
 * than the loud skip this file is designed to produce.
 */
let memoisedFacts: ReadonlyMap<string, string> | undefined
function verifyFacts(): ReadonlyMap<string, string> {
  memoisedFacts ??= runVerifyScript()
  return memoisedFacts
}

/**
 * Run the verify script and parse its markdown table into fact → value.
 *
 * Split on `|` and it breaks immediately: half the fact names *are* tag
 * prefixes — `carries connection|openforge`, `no build| tag` — so the delimiter
 * appears inside the first column. The script pads that column to a fixed width
 * and prints a dashed separator of exactly that width, so the width is read off
 * the separator and the columns are sliced by position.
 */
function runVerifyScript(): ReadonlyMap<string, string> {
  const script = join(process.cwd(), 'docs', 'verify-catalog-facts.py')
  const stdout = execFileSync('python3', [script, FIXTURES_DIR], { encoding: 'utf8', maxBuffer: 1 << 22 })
  const lines = stdout.split('\n')

  const separator = lines.find((line) => /^\| -+ \|/.test(line))
  if (!separator) throw new Error(`verify-catalog-facts.py produced no table:\n${stdout}`)
  const width = (/^\| (-+) \|/.exec(separator)?.[1] ?? '').length

  const facts = new Map<string, string>()
  for (const line of lines) {
    if (!line.startsWith('| ') || line === separator) continue
    const fact = line.slice(2, 2 + width).trim()
    const value = line.slice(2 + width + 3).split(' | ')[0]?.trim()
    if (fact && value && fact !== 'Fact') facts.set(fact, value)
  }
  if (facts.size === 0) throw new Error(`verify-catalog-facts.py produced no rows:\n${stdout}`)
  return facts
}

/** The leading integer of a cell like `3454 (39.7%)`. */
function leading(facts: ReadonlyMap<string, string>, fact: string): number {
  const value = facts.get(fact)
  if (value === undefined) throw new Error(`verify-catalog-facts.py did not report "${fact}"`)
  const match = /^-?\d+/.exec(value)
  if (!match) throw new Error(`"${fact}" is not a count: ${value}`)
  return Number(match[0])
}
