/**
 * Size resolution against the real corpus, and against the plan's own figures.
 *
 * Twelve numbers in `docs/templates-plan.md` §2.4 and in this row's brief are
 * re-derived here rather than restated. **Nine reproduce exactly, three do
 * not**, and each of the three is asserted at the value the corpus gives with
 * the plan's value written beside it — the pattern rows A1, A3, A5 and B2 set.
 * The three are gathered in one block, `the plan's figures that do not
 * reproduce`, so a reader can find them without reading the file.
 *
 * Skipped **loudly** with the path it looked in when the fixtures are absent, on
 * `catalog.test.ts`'s argument: a quietly skipped real-data test is worse than a
 * failing one.
 */
import { existsSync, readdirSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import type { CatalogFile, CatalogRecord } from '../src/catalog'
import type { SizePredicate } from '../src/template/size'
import {
  LATTICE_TOLERANCE_UNITS,
  RUN_DENY_TAGS,
  RUN_UNREACHABLE,
  formatUnits,
  latticeDistance,
  sizeAdmits,
  sizeRefs,
  sizeRefsResolve,
} from '../src/template/size'

import { buildCatalog } from './build'
import { fixturesDir, loadFixtureRows } from './fixtures'
import { formatUnit, sizeToken } from './footprint'
import { emptyManifest } from './ordinals'
import { cellExtentUnits, resolveGridSize, sizeRefusalOf } from './size'
import type { SizeRefusal } from './size'
import { numericTagValue, tagValue } from './tags'
import { PAYLOAD_TIMESTAMP } from './version'

const FIXTURES_DIR = fixturesDir()
const hasFixtures =
  existsSync(FIXTURES_DIR) && readdirSync(FIXTURES_DIR).some((name) => name.endsWith('.json'))
const describeCorpus = hasFixtures ? describe : describe.skip
const title = hasFixtures
  ? 'size resolution over the real corpus'
  : `size resolution — SKIPPED, no fixtures at ${FIXTURES_DIR} (set OPENFORGE_FIXTURES)`

/** Building the corpus once and brotli-ing 5.9 MB at quality 11, four times. */
const SLOW_MS = 300_000

const tally = <T>(values: readonly T[]): Map<string, number> => {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(String(value), (counts.get(String(value)) ?? 0) + 1)
  return counts
}

describeCorpus(title, () => {
  const file: CatalogFile = hasFixtures
    ? buildCatalog({
        rows: loadFixtureRows(FIXTURES_DIR),
        manifest: emptyManifest(),
        fixturesRef: 'test',
        /* The payload epoch, so the byte figures below are the quotable ones. */
        builtAt: PAYLOAD_TIMESTAMP,
      }).file
    : ({ tags: [], records: [] } as unknown as CatalogFile)

  const tagsOf = new Map<string, readonly string[]>(
    file.records.map((record) => [record.id, record.tags.map((id) => file.tags[id] ?? '')]),
  )
  const tags = (record: CatalogRecord): readonly string[] => tagsOf.get(record.id) ?? []
  const sizeOf = (record: CatalogRecord) => resolveGridSize(record.foot, tags(record))
  const resolved = file.records.filter((record) => sizeOf(record) !== undefined)
  const refused = file.records.filter((record) => sizeOf(record) === undefined)
  const has = (tag: string): boolean => file.tags.includes(tag)

  it('has the corpus every figure below is a fraction of', () => {
    expect(file.records).toHaveLength(8702)
  })

  /* ------------------------------------------------------- the chain, per rung */

  it('resolves a dimension for 8,384 of 8,702 records — the plan’s 96.3%, exactly', () => {
    /* §2.4's chain, and it needs the `size|column_shape` rung the plan does not
       list to reach the plan's own number. Deliberately looser than
       `resolveGridSize`: it asks *does the corpus say anything about this
       record's size*, which is what §2.4 answers, and not *can a slot name it*,
       which is what a predicate answers. The two figures differ by 794 and the
       gap is itemised below. */
    const dimensionResolves = (record: CatalogRecord): boolean =>
      cellExtentUnits(record.foot) !== undefined ||
      tagValue(tags(record), 'size|column_shape') !== undefined ||
      numericTagValue(tags(record), 'size|width') !== undefined ||
      numericTagValue(tags(record), 'size|depth') !== undefined

    const count = file.records.filter(dimensionResolves).length
    expect(count).toBe(8384)
    expect(count / file.records.length).toBeCloseTo(0.963, 3)

    /* The 318 refusals, as the plan's four groups. They partition exactly. */
    const out = file.records.filter((record) => !dimensionResolves(record))
    expect(out).toHaveLength(318)
    expect(out.filter((record) => record.layer === 'insert')).toHaveLength(234)
    expect(out.filter((record) => tags(record).includes('form|hex'))).toHaveLength(56)
    expect(out.filter((record) => tags(record).includes('role|decor'))).toHaveLength(26)
    expect(out.filter((record) => tagValue(tags(record), 'size|width') === 'wot')).toHaveLength(50)
    /* 2 of those 50 are not inserts: the `wall_on_tile` secret doors. */
    expect(
      out.filter(
        (record) => tagValue(tags(record), 'size|width') === 'wot' && record.layer !== 'insert',
      ),
    ).toHaveLength(2)
    /* 234 + 56 + 26 + 2 = 318, with the other 48 `wot` inside the inserts. */
    const grouped = out.filter(
      (record) =>
        record.layer === 'insert' ||
        tags(record).includes('form|hex') ||
        tags(record).includes('role|decor') ||
        tagValue(tags(record), 'size|width') === 'wot',
    )
    expect(grouped).toHaveLength(318)

    /* Every one of the 56 carries a `size|angle` and nothing else under `size|`,
       which is the plan's description of them. */
    const angleOnly = out.filter((record) => {
      const sized = tags(record).filter((tag) => tag.startsWith('size|'))
      return sized.length > 0 && sized.every((tag) => tag.startsWith('size|angle'))
    })
    expect(angleOnly).toHaveLength(56)
  })

  it('gets 14 records from the `size|column_shape` rung the plan does not list', () => {
    /* `col+T`, all 14. W2 marks the code `unmeasured` so `footprintKind` refuses
       a primitive, but the size is not in doubt — the letter is a port count and
       all five letters are the same 12.70 mm square. Without this rung the chain
       reaches 8,370 and the plan's 8,384 is unreachable. */
    const viaColumn = file.records.filter(
      (record) =>
        cellExtentUnits(record.foot) === undefined &&
        tagValue(tags(record), 'size|column_shape') !== undefined,
    )
    expect(viaColumn).toHaveLength(14)
    expect([...new Set(viaColumn.map((r) => tagValue(tags(r), 'size|column_shape')))]).toEqual(['T'])
    for (const record of viaColumn) expect(sizeOf(record)).toEqual({ w: 0.5, d: 0.5, run: 0.5 })
  })

  it('reaches 0 records through `sizeCode`, so the plan’s third rung is dead', () => {
    /* Not one of the 318 carries a `size|openlock` code at all, let alone one of
       the five with a published width. So the rung is a no-op as a *source*; it
       is a no-op as a *corrector* too, because `src/assembly/sizeCode.ts`
       measured the five codes agreeing with the tagged width on all 2,822
       records carrying both. Asserted so that a corpus which gives it work fails
       loudly rather than silently losing those records. */
    const codeWidths = new Set(['A', 'BA', 'IA', 'D', 'Q'])
    const reachable = file.records.filter((record) => {
      if (cellExtentUnits(record.foot) !== undefined) return false
      if (tagValue(tags(record), 'size|column_shape') !== undefined) return false
      if (numericTagValue(tags(record), 'size|width') !== undefined) return false
      if (numericTagValue(tags(record), 'size|depth') !== undefined) return false
      const code = tagValue(tags(record), 'size|openlock')
      return code !== undefined && codeWidths.has(code)
    })
    expect(reachable).toHaveLength(0)
    /* And no code of any kind, which is the stronger statement. */
    const anyCode = file.records.filter(
      (record) =>
        cellExtentUnits(record.foot) === undefined &&
        tagValue(tags(record), 'size|column_shape') === undefined &&
        numericTagValue(tags(record), 'size|width') === undefined &&
        numericTagValue(tags(record), 'size|depth') === undefined &&
        tagValue(tags(record), 'size|openlock') !== undefined,
    )
    expect(anyCode).toHaveLength(0)
  })

  /* -------------------------------------- `foot` is derived, and it corrects 28 */

  it('has `foot` equal to the tagged pair on 3,449 of 3,449 `rect` records', () => {
    const rects = file.records.filter((record) => record.foot.shape === 'rect')
    expect(rects).toHaveLength(3449)
    const exact = rects.filter((record) => {
      const foot = record.foot
      if (foot.shape !== 'rect') return false
      return (
        numericTagValue(tags(record), 'size|width') === foot.w &&
        numericTagValue(tags(record), 'size|depth') === foot.d
      )
    })
    expect(exact).toHaveLength(3449)
  })

  it('has 329 wall corrections in two populations, 245 of them row D9’s corner run', () => {
    const corrections = file.records.filter((record) => {
      const foot = record.foot
      const tagged = numericTagValue(tags(record), 'size|width')
      return foot.shape === 'wall' && tagged !== undefined && tagged !== foot.length
    })
    /* The brief said 56. It was 84 — all `curved_interface` — and row **D9**
       added 245 more: corner walls whose `size|width|2` names the cell and whose
       measured run is 1.5. Two populations, separated by a tag, and every
       correction is in one of them. */
    expect(corrections).toHaveLength(329)
    const population = (record: CatalogRecord): string =>
      tags(record).includes('shape|option|curved_interface') ? 'curved_interface' : 'corner'
    expect(Object.fromEntries(tally(corrections.map(population)))).toEqual({
      curved_interface: 84,
      corner: 245,
    })
    for (const record of corrections.filter((one) => population(one) === 'corner')) {
      const own = tags(record)
      expect(own.some((tag) => tag === 'shape|corner' || tag.startsWith('shape|corner|'))).toBe(true)
      /* And every one of the 245 is code `A` at a tagged 2 — the class D9
         measured, and the reason the correction is gated on the tagged run
         being 2 rather than applied to every corner wall. The 6 `BA` corner
         walls measure 1.500 against a tagged 1.5 and are not corrections. */
      expect(tagValue(own, 'size|openlock')).toBe('A')
      expect(numericTagValue(own, 'size|width')).toBe(2)
      expect(record.foot.shape === 'wall' ? record.foot.length : NaN).toBe(1.5)
    }

    const byCode = tally(
      corrections.map((record) => {
        const foot = record.foot
        const length = foot.shape === 'wall' ? foot.length : NaN
        return `${String(tagValue(tags(record), 'size|openlock'))} ${String(
          numericTagValue(tags(record), 'size|width'),
        )}->${String(length)}`
      }),
    )
    expect([...byCode.entries()].sort()).toEqual([
      ['A 2->1.5', 245],
      ['AxG 2->1.991', 28],
      ['BAxG 1.5->1.547', 28],
      ['QxG 4->3', 28],
    ])

    /* Which corrections **survive the snap to the lattice**, and it is the
       question that separates a measurement from a rounding. Of the 84
       curved-interface walls only the 28 `QxG` do — the other 56 snap back to
       exactly the value their tag already gives, so their correction is a
       sub-lattice one. All **245** of row D9's do, because 1.5 is a lattice value
       and half a unit is not noise: the corner run really is a different size
       from the tag, the way `QxG` really is 3 and not 4. */
    const movedOnTheLattice = corrections.filter((record) => {
      const size = sizeOf(record)
      return size !== undefined && size.w !== numericTagValue(tags(record), 'size|width')
    })
    expect(movedOnTheLattice).toHaveLength(273)
    expect(
      Object.fromEntries(tally(movedOnTheLattice.map((record) => String(sizeOf(record)?.w)))),
    ).toEqual({ '1.5': 245, '3': 28 })
  })

  /* ------------------------------------------------ the lattice, bounded twice */

  it('brackets the lattice tolerance: 0.047 must snap, 0.0858 must not', () => {
    const distances: { worst: number; shape: string }[] = []
    for (const record of file.records) {
      const extent = cellExtentUnits(record.foot)
      if (extent === undefined) continue
      const worst = Math.max(latticeDistance(extent.w), latticeDistance(extent.d))
      if (worst !== 0) distances.push({ worst, shape: record.foot.shape })
    }

    /* 701 extents are off the lattice at all: 56 walls and 645 sectors. */
    expect(distances).toHaveLength(701)
    const walls = distances.filter((entry) => entry.shape === 'wall')
    const arcs = distances.filter((entry) => entry.shape === 'arc')
    expect(walls).toHaveLength(56)
    expect(arcs).toHaveLength(645)

    const mustSnap = Math.max(...walls.map((entry) => entry.worst))
    const mustNot = Math.min(...arcs.map((entry) => entry.worst))
    expect(mustSnap).toBeCloseTo(0.047, 4)
    expect(mustNot).toBeCloseTo(0.0858, 4)
    /* The tolerance sits inside an empty interval, by a factor of 1.8. */
    expect(mustSnap).toBeLessThan(LATTICE_TOLERANCE_UNITS)
    expect(mustNot).toBeGreaterThan(LATTICE_TOLERANCE_UNITS)
  })

  /* --------------------------------------------- what a slot can actually name */

  it('resolves a grid cell for 7,590 records and a run for 6,661', () => {
    expect(resolved).toHaveLength(7590)
    expect(resolved.length / file.records.length).toBeCloseTo(0.872, 3)
    const withRun = resolved.filter((record) => sizeOf(record)?.run !== null)
    expect(withRun).toHaveLength(6661)
    expect(withRun.length / file.records.length).toBeCloseTo(0.765, 3)
    /* The run is the cell's own width wherever there is one, which is what lets
       one resolved size answer both a `cell` and a `run` predicate. */
    for (const record of withRun) {
      const size = sizeOf(record)
      expect(size?.run).toBe(size?.w)
    }
  })

  it('offers 48 distinct grid cells and 10 distinct runs, half units included', () => {
    const cells = tally(resolved.map((record) => `${String(sizeOf(record)?.w)}x${String(sizeOf(record)?.d)}`))
    expect(cells.size).toBe(48)
    /* Row **D9** moved 245 records from `2x0.5` to `1.5x0.5` — the corner walls
       — which is enough to make `2x2` the commonest cell in the archive. The
       count of distinct cells is unchanged at 48: 1.5 x 0.5 already existed. */
    expect([...cells.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)).toEqual([
      ['2x2', 1064],
      ['2x0.5', 978],
      ['1.5x0.5', 797],
      ['4x0.5', 512],
      ['1x1', 500],
      ['4x4', 453],
    ])
    /* Half-unit cells survive, which a predicate over integers would lose: 25 of
       the 48 carry one, and 2.5x2.5 and 4.5x4.5 exist only because the 90 degree
       sectors keep their cell. */
    const halves = [...cells.keys()].filter((key) =>
      key.split('x').some((value) => Number(value) % 1 !== 0),
    )
    expect(halves).toHaveLength(25)
    expect(cells.get('2.5x2.5')).toBe(203)
    expect(cells.get('4.5x4.5')).toBe(87)
    expect(cells.get('1.5x1.5')).toBe(6)

    const runs = tally(
      resolved.map((record) => sizeOf(record)?.run).filter((run): run is number => run !== null && run !== undefined),
    )
    expect([...runs.keys()].map(Number).sort((a, b) => a - b)).toEqual([
      0.5, 1, 1.5, 2, 3, 4, 5, 6, 7, 8,
    ])
  })

  it('keeps the plan’s 37 `rect` dimension pairs, tail and all', () => {
    const pairs = tally(
      file.records
        .filter((record) => record.foot.shape === 'rect')
        .map((record) => {
          const foot = record.foot
          return foot.shape === 'rect' ? `${String(foot.w)}x${String(foot.d)}` : ''
        }),
    )
    expect(pairs.size).toBe(37)
    expect([...pairs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)).toEqual([
      ['2x2', 885],
      ['1x1', 500],
      ['2x1', 395],
      ['4x4', 313],
      ['4x1', 274],
      ['3x1', 219],
      ['3x3', 211],
      ['4x2', 183],
    ])
    /* The half-unit tail the brief names, to the record. */
    expect(pairs.get('2x0.5')).toBe(14)
    expect(pairs.get('1x0.5')).toBe(3)
    expect(pairs.get('1.5x1.5')).toBe(2)
  })

  it('never lets `wot` or `sw` become a size', () => {
    const markers = file.records.filter((record) =>
      ['wot', 'sw'].includes(tagValue(tags(record), 'size|width') ?? ''),
    )
    expect(markers).toHaveLength(83)
    expect(markers.filter((record) => tagValue(tags(record), 'size|width') === 'wot')).toHaveLength(50)
    expect(markers.filter((record) => tagValue(tags(record), 'size|width') === 'sw')).toHaveLength(33)
    /* All 83 have no `build|` tag of their own, and all 50 `wot` sit under
       `wall_on_tile` by path — the brief's two measured constraints. */
    for (const record of markers) expect(record.build).toBeUndefined()
    for (const record of markers)
      if (tagValue(tags(record), 'size|width') === 'wot')
        expect(record.id).toContain('/wall_on_tile/')
    /* And not one of them resolves to a size. */
    expect(markers.filter((record) => sizeOf(record) !== undefined)).toHaveLength(0)
  })

  it('keeps the 554 quarter sectors and refuses the 645 narrower ones', () => {
    const arcs = file.records.filter((record) => record.foot.shape === 'arc')
    expect(arcs).toHaveLength(1199)
    const quarter = arcs.filter((record) => record.foot.shape === 'arc' && record.foot.sweep === 90)
    expect(quarter).toHaveLength(554)
    expect(quarter.filter((record) => sizeOf(record) !== undefined)).toHaveLength(554)
    const narrower = arcs.filter((record) => record.foot.shape === 'arc' && record.foot.sweep !== 90)
    expect(narrower).toHaveLength(645)
    expect(narrower.filter((record) => sizeOf(record) !== undefined)).toHaveLength(0)
  })

  it('partitions all 1,112 refusals into the six named reasons', () => {
    expect(refused).toHaveLength(1112)
    const counts = tally(
      refused.map((record) => sizeRefusalOf(record.foot, tags(record), record.layer)),
    )
    const expected: Record<SizeRefusal, number> = {
      'sub-quarter-arc': 645,
      insert: 234,
      diagonal: 121,
      'off-lattice-family': 56,
      'half-a-pair': 28,
      unstated: 28,
    }
    expect(Object.fromEntries(counts)).toEqual(expected)
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(1112)
  })

  /* ------------------------------------- the refs, against the resolution */

  it('has every ref a family-reachable predicate needs already in the tag table', () => {
    /* The whole 0-byte claim in one assertion: the vocabulary is unchanged, so a
       generated slot's `require` list resolves through the table
       `build.ts#assertConfigRefs` already validates against. */
    expect(file.tags).toHaveLength(930)
    expect(file.tags.filter((tag) => tag.startsWith('size|cell|'))).toHaveLength(0)
    expect(file.tags.filter((tag) => tag.startsWith('size|run|'))).toHaveLength(0)
    for (const tag of RUN_DENY_TAGS) expect(has(tag)).toBe(true)

    /* Every cell a record actually resolves to, asked as a predicate. **46 of
       the 48** are expressible over the existing vocabulary, and the two that
       are not are named rather than counted: `0.5x0.5` (the 133 columns —
       `size|width` has 11 numeric values, 1 through 8, and no 0.5) and
       `4.5x4.5` (the 87 widest quarter sectors — neither axis has a 4.5 tag).
       Neither is a cell a `cell`-anchored slot can want: `offsets.ts#cellExtentOf`
       refuses a non-`rect` cell, and no `rect` record resolves to either. */
    const cells = new Map<string, SizePredicate>()
    for (const record of resolved) {
      const size = sizeOf(record)
      if (size === undefined) continue
      cells.set(`${String(size.w)}x${String(size.d)}`, { kind: 'cell', w: size.w, d: size.d })
    }
    const expressible = [...cells.values()].filter((predicate) => sizeRefsResolve(predicate, has))
    expect(cells.size).toBe(48)
    expect(expressible).toHaveLength(46)
    expect(sizeRefsResolve({ kind: 'cell', w: 0.5, d: 0.5 }, has)).toBe(false)
    expect(sizeRefsResolve({ kind: 'cell', w: 4.5, d: 4.5 }, has)).toBe(false)

    /* Every run, likewise: 9 of the 10 are expressible and the tenth is 0.5. */
    const runs = new Set(
      resolved.map((record) => sizeOf(record)?.run).filter((run): run is number => run !== null && run !== undefined),
    )
    const runPredicates = [...runs].map((run): SizePredicate => ({ kind: 'run', run }))
    expect(runPredicates.filter((predicate) => sizeRefsResolve(predicate, has))).toHaveLength(9)
    expect(sizeRefsResolve({ kind: 'run', run: 0.5 }, has)).toBe(false)
  })

  it('has the run refs admit no record the resolution disagrees with', () => {
    /* **Zero false positives among records that have a footprint at all**, which
       is the direction that matters: a wrongly admitted candidate with real
       geometry is a wall drawn through another wall, and that is what
       {@link RUN_DENY_TAGS} buys.

       **Row D9 broke this and then restored it, which is the whole reason the
       assertion is here.** Correcting 245 corner walls from a tagged 2 to a
       measured 1.5 made them exactly the thing this test forbids — real
       geometry, admitted by a `run: 2` ref, 1.5 units long. `shape|corner`
       joined the deny list in response. The 245 do not become *placeable*
       false positives again under any spelling of the corner tag, which is what
       the 0 below now covers.

       319 records *are* admitted that the resolution refuses, and every one of
       them is `foot: {shape:'none'}` — a tagged `size|width` on a piece with no
       placeable outline, mostly `size|segment` design fragments and the
       octagon-segment `U` codes. (331 before the corner deny took 12 shapeless
       corner records out of reach as well.) They are not reachable as a wrong
       *placement*: `offsets.ts#placeTemplateSlots` refuses a fill with no extent
       as `no-footprint` one step later, which is 32 of B2's 1,211 walked edge
       slots. So they cost a candidate card, not a drawing, and the split is
       asserted rather than the total. */
    const denied = new Set(RUN_DENY_TAGS)
    const admits = (record: CatalogRecord, run: number): boolean => {
      const own = tags(record)
      if (own.some((tag) => denied.has(tag))) return false
      return numericTagValue(own, 'size|width') === run
    }
    let shapeless = 0
    let placeable = 0
    let falseNegatives = 0
    for (const run of [1, 1.5, 2, 3, 4, 5, 6, 7, 8]) {
      const predicate: SizePredicate = { kind: 'run', run }
      for (const record of file.records) {
        const truth = sizeAdmits(predicate, sizeOf(record))
        const byRef = admits(record, run)
        if (byRef && !truth) {
          if (record.foot.shape === 'none') shapeless += 1
          else placeable += 1
        }
        if (truth && !byRef) falseNegatives += 1
      }
    }
    expect(placeable).toBe(0)
    expect(shapeless).toBe(319)
    /* And what it costs, exactly. 84 before row D9 — the 56 curved-interface
       walls whose tag was right and the 28 whose tag was wrong by a unit — and
       **595 more** from the corner deny, of which only 245 are records the deny
       was written for. `RUN_UNREACHABLE`'s docstring itemises all five groups.
       The trade is deliberate and priced there: a false negative costs a
       candidate card, a false positive costs a drawing, and no shipped path was
       reaching the 595 through a run ref in the first place.

       The 133 columns are not in this figure because their run is 0.5, and there
       is no `size|width|0.5` tag for a run-0.5 slot to be spelled with in the
       first place — no cell face is half a unit long, so no family generates
       one. */
    expect(falseNegatives).toBe(RUN_UNREACHABLE)
    expect(RUN_UNREACHABLE).toBe(679)
    expect(falseNegatives / 6661).toBeCloseTo(0.102, 3)
    /* The split, so the 595 cannot quietly grow: every one of them carries a
       corner tag and none of them is one of the 84. */
    const cornerish = (record: CatalogRecord): boolean =>
      tags(record).some((tag) => tag === 'shape|corner' || tag.startsWith('shape|corner|'))
    let corner = 0
    let curved = 0
    for (const run of [1, 1.5, 2, 3, 4, 5, 6, 7, 8]) {
      const predicate: SizePredicate = { kind: 'run', run }
      for (const record of file.records) {
        if (!sizeAdmits(predicate, sizeOf(record))) continue
        if (admits(record, run)) continue
        if (tags(record).includes('shape|option|curved_interface')) curved += 1
        else if (cornerish(record)) corner += 1
      }
    }
    expect({ corner, curved }).toEqual({ corner: 595, curved: 84 })
  })

  it('has the cell refs exact on every `rect` record', () => {
    /* The other direction of the same question, and here there is no cost at
       all: the tagged pair is `foot` on all 3,449 `rect` records, so the two
       refs admit exactly the records the resolution does. */
    let disagreements = 0
    for (const record of file.records) {
      const foot = record.foot
      if (foot.shape !== 'rect') continue
      const predicate: SizePredicate = { kind: 'cell', w: foot.w, d: foot.d }
      const { require } = sizeRefs(predicate)
      const byRef = require.every((tag) => tags(record).includes(tag))
      if (byRef !== sizeAdmits(predicate, sizeOf(record))) disagreements += 1
    }
    expect(disagreements).toBe(0)
  })

  /* ------------------------------------------------- what size in the key costs */

  it('needs 52 families with size parametric, and 217 to 277 with it in the key', () => {
    const key = (record: CatalogRecord, size: string): string =>
      [
        tagValue(tags(record), 'role'),
        size,
        record.build ?? '-',
      ].join('|')
    const families = (size: (record: CatalogRecord) => string): Map<string, number> =>
      tally(file.records.map((record) => key(record, size(record))))

    const withForm = tally(
      file.records.map(
        (record) =>
          `${String(tagValue(tags(record), 'role'))}|${String(tagValue(tags(record), 'form'))}|${record.build ?? '-'}`,
      ),
    )
    expect(withForm.size).toBe(52)

    const byCell = families((record) => {
      const size = sizeOf(record)
      return size === undefined ? '?' : `${String(size.w)}x${String(size.d)}`
    })
    const byFootprint = families((record) => JSON.stringify(record.foot))
    const byToken = families((record) => sizeToken(record.foot) ?? '?')

    expect(byCell.size).toBe(217)
    expect(byFootprint.size).toBe(277)
    expect(byToken.size).toBe(249)
    /* The plan's 285 reproduces under none of the three spellings — see the
       `does not reproduce` block — but its 50 singletons reproduce under one of the three,
       and every spelling is at least 4.2x the 52. That ratio is the claim §2.4
       actually rests on, and it holds. */
    /* 50 before row **D9**, and the 51st is a family whose corner walls left the
       `{wall,length:2}` footprint they shared with something else. The plan's own
       figure was 50 and it reproduced under exactly this spelling; it is
       restated at the measured 51 rather than quietly kept, because the ratio
       below is the claim §2.4 rests on and it is unaffected. */
    expect([...byFootprint.values()].filter((count) => count === 1)).toHaveLength(51)
    // 46 before D9, and the same family moves here for the same reason: a
    // `2x` token that no longer names any corner wall.
    expect([...byToken.values()].filter((count) => count === 1)).toHaveLength(47)
    expect(byCell.size / withForm.size).toBeGreaterThan(4.1)
  })

  it('leaves 5 of the 52 families with no size parameter at all — for B4', () => {
    /* The other half of "size is a slot parameter": a family's parameter domain
       is the set of cells its own records resolve to, and **five families have
       an empty one**. B4 has to be able to generate a family with no size
       control rather than a family that matches nothing, so the five are named
       here rather than discovered later:

       | family | records | why |
       | --- | ---: | --- |
       | `wall\|diagonal\|separate wall` | 121 | the extent is a hypotenuse |
       | `wall\|hex\|thick wall` | 56 | no square-lattice position at all |
       | `decor\|straight\|-` | 26 | nothing in the corpus says |
       | `wall\|octagon\|separate wall` | 20 | `diag` footprints |
       | `floor\|octagon\|-` | 8 | `diag` footprints |

       231 records over 5 families, and the 56 hex are the plan's own "builder
       limitation, not a template gap". */
    const domains = new Map<string, { records: number; cells: Set<string> }>()
    for (const record of file.records) {
      const key = `${String(tagValue(tags(record), 'role'))}|${String(
        tagValue(tags(record), 'form'),
      )}|${record.build ?? '-'}`
      const entry = domains.get(key) ?? { records: 0, cells: new Set<string>() }
      entry.records += 1
      const size = sizeOf(record)
      if (size !== undefined) entry.cells.add(`${String(size.w)}x${String(size.d)}`)
      domains.set(key, entry)
    }
    expect(domains.size).toBe(52)

    const empty = [...domains].filter(([, entry]) => entry.cells.size === 0)
    expect(Object.fromEntries(empty.map(([key, entry]) => [key, entry.records]))).toEqual({
      'wall|diagonal|separate wall': 121,
      'wall|hex|thick wall': 56,
      'decor|straight|-': 26,
      'wall|octagon|separate wall': 20,
      'floor|octagon|-': 8,
    })
    expect(empty.reduce((total, [, entry]) => total + entry.records, 0)).toBe(231)

    /* And the shape of the other 47: **294** cells between all 52, a median of 4
       per family and a maximum of 31 — so a size control is a short list, not a
       48-item dropdown.

       295 before row **D9**. The one that went is `wall|corner|s2w`'s `2x0.5`:
       no corner wall is 2 units long, so that cell had no geometry behind it and
       its records fold into the `1.5x0.5` the family already had. A domain
       shrinking by a cell while losing no records is what a corrected dimension
       looks like. */
    const sizes = [...domains.values()].map((entry) => entry.cells.size).sort((a, b) => a - b)
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(294)
    expect(sizes[Math.floor(sizes.length / 2)]).toBe(4)
    expect(Math.max(...sizes)).toBe(31)
  })

  /* ----------------------------- the plan's figures that do not reproduce */

  describe('the plan’s figures that do not reproduce', () => {
    it('has 0 floors with neither a tagged pair nor a footprint, not 8', () => {
      /* §2.4: *"Only 8 floors have neither a tagged pair nor a footprint."* Zero,
         under all four readings of "floor" the emitted index supports. The 318
         refusals of the dimension chain contain no floor of any kind. */
      const bare = (record: CatalogRecord): boolean =>
        record.foot.shape === 'none' &&
        numericTagValue(tags(record), 'size|width') === undefined &&
        numericTagValue(tags(record), 'size|depth') === undefined
      const readings = [
        (record: CatalogRecord) => tags(record).includes('role|floor'),
        (record: CatalogRecord) => record.kinds.includes('floor'),
        (record: CatalogRecord) => tags(record).some((tag) => tag === 'shape|floor' || tag.startsWith('shape|floor|')),
      ]
      for (const isFloor of readings)
        expect(file.records.filter((record) => isFloor(record) && bare(record))).toHaveLength(0)
    })

    it('has 329 `foot` corrections wearing four deltas, not 56 wearing one', () => {
      /* The brief: *"56 corrections (all `curved_interface`, wrong by exactly
         1.000 u)"*. Measured: 84 corrections, all `curved_interface`, and the
         1.000 u delta belongs to 28 of them. Row **D9** then added 245 at a
         **0.500** delta — the corner runs — so neither the count nor the "all
         `curved_interface`" holds. Asserted in full above; restated here so the
         disagreement is findable. */
      const corrections = file.records.filter((record) => {
        const foot = record.foot
        const tagged = numericTagValue(tags(record), 'size|width')
        return foot.shape === 'wall' && tagged !== undefined && tagged !== foot.length
      })
      expect(corrections).toHaveLength(329)
      const byDelta = tally(
        corrections.map((record) => {
          const foot = record.foot
          const length = foot.shape === 'wall' ? foot.length : NaN
          return ((numericTagValue(tags(record), 'size|width') ?? 0) - length).toFixed(3)
        }),
      )
      expect(Object.fromEntries(byDelta)).toEqual({
        '0.500': 245,
        '0.009': 28,
        '-0.047': 28,
        '1.000': 28,
      })
    })

    it('needs 217 to 277 families with size in the key, and reproduces 285 under no spelling', () => {
      /* §2.4: 285 families, 111 to reach 90%, 50 singletons. The singleton count
         reproduces under two spellings and the other two figures under none. The
         conclusion — size in the key multiplies the count by 4.2x to 5.3x — is
         what every spelling agrees on. */
      const counts = [
        tally(
          file.records.map(
            (record) =>
              `${String(tagValue(tags(record), 'role'))}|${JSON.stringify(record.foot)}|${record.build ?? '-'}`,
          ),
        ).size,
        tally(
          file.records.map(
            (record) =>
              `${String(tagValue(tags(record), 'role'))}|${sizeToken(record.foot) ?? '?'}|${record.build ?? '-'}`,
          ),
        ).size,
        tally(
          file.records.map((record) => {
            const size = sizeOf(record)
            const spelled = size === undefined ? '?' : `${String(size.w)}x${String(size.d)}`
            return `${String(tagValue(tags(record), 'role'))}|${spelled}|${record.build ?? '-'}`
          }),
        ).size,
      ]
      expect(counts).toEqual([277, 249, 217])
      expect(counts).not.toContain(285)
    })
  })

  it('spells a dimension the way `pipeline/footprint.ts` does', () => {
    /* Two `formatUnit`s exist because `src/template/size.ts` may not import
       `pipeline/**`. They agree on every value either produces, which is what
       keeps a `size|width|1.5` ref matching the tag the corpus carries. */
    for (const value of [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 6, 7, 8, 2.828, 3.536, 1.991])
      expect(formatUnits(value)).toBe(formatUnit(value))
  })
}, SLOW_MS)
