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

import { CatalogFile, shardedPath } from '../src/catalog'

import type { BuildResult } from './build'
import { buildCatalog } from './build'
import { measureCatalog, serialiseCatalog } from './emit'
import { CONNECTION_POSITIONS, classifyLayer, connectionSystems, connectionsByPosition, isLockSystem } from './facets'
import type { FixtureRow } from './fixtures'
import { fixturesDir, liveRows, loadFixtureRows } from './fixtures'
import { TAG_ALIASES, normaliseTags } from './normalise'
import { emptyManifest } from './ordinals'
import { CURVE_TAG_SEGMENTS, NON_CURVE_TAG_SEGMENTS } from './tessellation'
import { SIZE_BUDGET_BYTES } from './version'

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
 * Timeout for the tests that build the 8,702-tile corpus again, or brotli it at
 * quality 11. Both are seconds of real work on 5 MB of JSON, and the 5 s default
 * turns that into a flaky failure rather than a slow pass.
 */
const SLOW_MS = 120_000

describeCorpus(title, () => {
  const rows: FixtureRow[] = hasFixtures ? loadFixtureRows(FIXTURES_DIR) : []
  const live = liveRows(rows)
  const result: BuildResult = buildCatalog({
    rows,
    manifest: emptyManifest(),
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

  it('interns every tag and de-interns back to the normalised list', () => {
    // `normaliseTags` is applied on the way in, so the round trip is against the
    // canonical list rather than the raw fixture one. Comparing to the raw list
    // was right until tag drift was collapsed, and would now report the two
    // `foundations` tiles as corruption.
    const bySource = new Map(live.map((row) => [row.file_metadata.full_name, row]))
    const wrong = result.file.records.filter(
      (record) =>
        record.tags.map((id) => result.file.tags[id]).join('\u0000') !==
        normaliseTags(bySource.get(record.id)?.tags ?? []).join('\u0000'),
    )
    expect(wrong.map((record) => record.id)).toEqual([])
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

    it('agrees on all four footprint counts', () => {
      const facts = verifyFacts()
      expect(result.stats.footprints.rect).toBe(leading(facts, 'footprint RECT'))
      expect(result.stats.footprints.wall).toBe(leading(facts, 'footprint WALL_SEG'))
      expect(result.stats.footprints.arc).toBe(leading(facts, 'footprint ARC'))
      expect(result.stats.footprints.none).toBe(leading(facts, 'footprint NONE'))

      // W3's movement, pinned so it cannot drift back. 403 tiles left NONE for
      // RECT and nothing else moved: WALL and ARC are untouched, which is what
      // makes DEFAULT_ARC_SWEEP_DEG's reach W1's and W4's problem and not this
      // row's. The literals are the only ones in this block, because they are
      // the claim the row is accountable for.
      expect(result.stats.footprints.rect).toBe(3_454)
      expect(result.stats.footprints.wall).toBe(3_116)
      expect(result.stats.footprints.arc).toBe(1_391)
      expect(result.stats.footprints.none).toBe(741)
      const covered = result.stats.records - (result.stats.footprints.none ?? 0)
      expect(((100 * covered) / result.stats.records).toFixed(1)).toBe('91.5')
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
      expect(fragments).toHaveLength(leading(facts, 'size|segment fragments'))
      expect(fragments.filter((row) => shapeOf(row) === 'arc')).toHaveLength(
        leading(facts, 'fragments \u00b7 radius wins'),
      )
      expect(fragments.filter((row) => shapeOf(row) === 'none')).toHaveLength(
        leading(facts, 'fragments \u00b7 vetoed to NONE'),
      )
      // A fragment is arc or none. Never rect, never wall.
      expect(fragments.filter((row) => shapeOf(row) === 'rect' || shapeOf(row) === 'wall')).toEqual([])

      // The 403 movers, and the honest label on them: a curve-marked RECT is an
      // axis-aligned over-approximation of an annular sector. W5 reshapes it.
      const curvedRects = live.filter(
        (row) =>
          shapeOf(row) === 'rect' &&
          row.tags.some((tag) => tag.split('|').some((seg) => CURVE_TAG_SEGMENTS.includes(seg))),
      )
      expect(curvedRects).toHaveLength(leading(facts, 'RECT that is really a sector'))
      expect(curvedRects).toHaveLength(403)
    })

    it('agrees on what is left in NONE, and whose row can move it', () => {
      const facts = verifyFacts()
      const stranded = live.filter((row) => shapeByPath.get(row.file_metadata.full_name) === 'none')
      const coded = stranded.filter((row) => row.tags.some((tag) => tag.startsWith('size|openlock|')))
      const fragments = stranded.filter((row) => row.tags.some((tag) => tag.startsWith('size|segment|')))
      const neither = stranded.filter((row) => !coded.includes(row) && !fragments.includes(row))

      expect(stranded).toHaveLength(leading(facts, 'footprint NONE'))
      expect(coded).toHaveLength(leading(facts, 'NONE \u00b7 carries a tessellation code'))
      expect(fragments).toHaveLength(leading(facts, 'NONE \u00b7 a fragment'))
      expect(neither).toHaveLength(leading(facts, 'NONE \u00b7 no code, no fragment letter'))
      // The three are disjoint and exhaustive: no NONE tile carries both a code
      // and a fragment letter, so the breakdown is a partition and W1's and W4's
      // shares of the remaining 741 do not overlap.
      expect(coded.filter((row) => fragments.includes(row))).toEqual([])
      expect(coded.length + fragments.length + neither.length).toBe(stranded.length)
      expect(coded).toHaveLength(161)
      expect(fragments).toHaveLength(283)
    })

    it('agrees that W3 did not change how many arcs get a fabricated sweep', () => {
      // `DEFAULT_ARC_SWEEP_DEG` invents 90 degrees for every arc with no
      // `size|angle`. W3 moves nothing into or out of ARC, so the count it
      // reaches must be exactly what it was: 165. W1 measures them, W4 settles
      // them, and this asserts that neither inherits a moved target.
      const facts = verifyFacts()
      const fabricated = live.filter(
        (row) =>
          !row.tags.some((tag) => tag.startsWith('size|angle|')) &&
          row.tags.some((tag) => tag.startsWith('size|radius|')),
      )
      expect(fabricated).toHaveLength(leading(facts, 'ARC with no size|angle'))
      expect(fabricated).toHaveLength(165)
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
      fixturesRef: 'test',
      builtAt: BUILT_AT,
    })
    expect(serialiseCatalog(again.file)).toBe(json)
  }, SLOW_MS)

  it('produces the same output regardless of the order rows arrive in', () => {
    const shuffled = buildCatalog({
      rows: [...rows].reverse(),
      manifest: emptyManifest(),
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

  /* ------------------------------------------------------------ size budget */

  it('fits the 500 KB brotli budget, and reports what it actually costs', () => {
    const size = measureCatalog(json)
    process.stdout.write(
      `\n[catalog] raw ${String(size.raw)} B · gzip ${String(size.gzip)} B · brotli ${String(size.brotli)} B ` +
        `of ${String(SIZE_BUDGET_BYTES)} B budget\n`,
    )
    expect(size.brotli).toBeLessThanOrEqual(SIZE_BUDGET_BYTES)
  }, SLOW_MS)
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
