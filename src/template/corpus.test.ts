/**
 * The slot-anchor model against the live archive.
 *
 * **Every figure quoted in a docblock in this directory is recomputed here**,
 * rather than restated — the pattern `src/screens/assemblies/corpus.test.ts` and
 * `src/composition/corpus.test.ts` both set. That matters more for this row than
 * for most, twice over: nothing in the app reads `src/template/**` yet, so these
 * assertions are the whole of the row's evidence; and the research report the
 * row was briefed from no longer exists, so a figure that is not recomputed here
 * is a figure nobody can check.
 *
 * Two artefacts. **`catalog.json`**, gitignored and rebuilt by
 * `npm run import:catalog`, and absent it the whole block skips **loudly**,
 * naming the path and the command. And **`tools/measure/measurements.json`**,
 * which *is* committed — 1,163 measured blobs, whole-object reads over every
 * vertex of every facet — and which is the only thing in the repository that can
 * say anything about a real mesh's z extent.
 *
 * ## What this file cannot do, stated up front
 *
 * It cannot tell you the three authored conventions are *right*. There is
 * nothing to check them against: the corpus's entire positional vocabulary is
 * chirality on 427 tiles (4.91%) plus 8 tiles carrying a face-named connection
 * tag (0.09%), both recomputed below, and **4 of the 128 parts have even one
 * candidate with a measured bounding box** — all four the same 20 files, and
 * those 20 are one print-plate row whose authored `minX` marches in constant
 * 45.00 mm steps. So the meshes cannot adjudicate either. What this file proves
 * is that the *arithmetic* the conventions imply closes on the archive, exactly
 * how often, and exactly which combinations it refuses.
 */
import { existsSync, readFileSync } from 'node:fs'
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import type { Extent, PlanPart } from '@/builder/canvas'
import { footprintShape, partsOverlap, planBand, planParts, rotatedExtent } from '@/builder/canvas'
import type { CatalogRecord, Footprint } from '@/catalog'
import { CatalogFile } from '@/catalog'
import type { AssemblyChoice, RecipeIndex, RecipeTemplate } from '@/screens/assemblies/assembly'
import { assemblyState, createRecipeIndex } from '@/screens/assemblies/assembly'
import { RECIPE_TEMPLATES } from '@/screens/assemblies/templates'

import { buildAggregateIndex } from '@/catalog'
import type { AssemblyIndex, AssemblyTemplate } from '@/assembly'
import { buildAssemblyIndex } from '@/assembly'
import { createCompositionIndex, resolveSlotTags } from '@/composition'

import type { FillContext } from './fill'
import { SOLVE_QUERIES, solveTemplateFills } from './fill'
import type { SceneCost } from './measure'
import {
  measureBacktracking,
  measureBaseLadder,
  measureFilterSoundness,
  measureGreedy,
  measureGreying,
  measureLockSpread,
  measureMonotonicity,
  measureSceneCost,
  measureSolver,
} from './measure'
import type { PlacedTemplate, SlotDoubtCode } from './offsets'
import { placeTemplateSlots, slotOffset } from './offsets'
import type { SlotName, TemplateLayout } from './rules'
import { SLOT_CONVENTIONS, conventionFor, ruleFor } from './rules'

/* ----------------------------------------------------------------- the corpus */

const CATALOG = 'public/catalog/catalog.json'
const MEASURED = 'tools/measure/measurements.json'
const hasCatalog = existsSync(CATALOG)
const describeCorpus = hasCatalog ? describe : describe.skip
const corpusTitle = hasCatalog
  ? 'the slot-anchor model against the live archive'
  : `slot geometry against the live archive — SKIPPED, no ${CATALOG} (run \`npm run import:catalog\`)`

/**
 * The walk resolves 1,215 combinations, each one through a fresh `assemblyState`
 * over 8,702 records. Minutes of real work rather than a hang, and the 5,000 ms
 * default is what fails first.
 */
const SLOW_MS = 600_000

/**
 * The payload epoch, so the byte figures below are the quotable ones.
 *
 * Spelled out rather than imported: `pipeline/version.ts` is in the node project
 * and this file is in the app project, which is exactly why
 * `src/generator/panel/corpus.test.ts` writes the same literal for the same
 * figure. A drift between the two would show up as a byte count that no longer
 * matches, which is a visible failure rather than a silent one.
 */
const PAYLOAD_TIMESTAMP = '2026-01-01T00:00:00.000Z'
const SIZE_BUDGET_BYTES = 500 * 1024

/** `emit.ts#measureCatalog`'s own instrument: brotli 11 with the size hint set. */
function brotli(json: string): number {
  const bytes = Buffer.from(json, 'utf8')
  return brotliCompressSync(bytes, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: zlibConstants.BROTLI_MAX_QUALITY,
      [zlibConstants.BROTLI_PARAM_SIZE_HINT]: bytes.byteLength,
    },
  }).byteLength
}

interface MeasuredExtent {
  readonly minMm: readonly number[]
  readonly maxMm: readonly number[]
}

function measuredExtents(): Record<string, { extent?: MeasuredExtent }> {
  return (
    JSON.parse(readFileSync(MEASURED, 'utf8')) as {
      measurements: Record<string, { extent?: MeasuredExtent }>
    }
  ).measurements
}

/** One walked combination: the template, and the record filling each part. */
interface Combination {
  readonly template: RecipeTemplate
  readonly layout: TemplateLayout
  readonly fills: ReadonlyMap<SlotName, CatalogRecord>
  readonly feet: ReadonlyMap<SlotName, Footprint>
  readonly placed: PlacedTemplate
}

/**
 * Every `(template, first-part candidate)` combination, resolved in declared
 * order.
 *
 * Take **each** live candidate for the first part and the first non-dead-end
 * candidate for every part after it. That is 1,215 combinations, and it is the
 * population every closure figure below is a fraction of. The walk is the
 * greying-aware one the plan measured at 40 of 40 recipes completed, so a
 * combination that fails to fill is a genuine dead end and not an artefact of
 * taking the first card blindly.
 */
function walk(recipes: RecipeIndex, byId: ReadonlyMap<string, CatalogRecord>): readonly Combination[] {
  const out: Combination[] = []
  for (const template of RECIPE_TEMPLATES) {
    const layout = conventionFor(template.parts.map((part) => part.name))
    if (layout === undefined) throw new Error(`no convention for ${template.id}`)
    const first = template.parts[0]
    if (first === undefined) continue
    const cold = assemblyState(recipes, template, {})
    const step = cold.steps.find((one) => one.part.name === first.name)
    for (const option of step?.options ?? []) {
      if (option.empties.length > 0) continue
      let choice: AssemblyChoice = { [first.name]: option.variant.id }
      const fills = new Map<SlotName, CatalogRecord>()
      const firstRecord = byId.get(option.variant.id)
      if (firstRecord !== undefined) fills.set(first.name, firstRecord)
      for (const part of template.parts.slice(1)) {
        const state = assemblyState(recipes, template, choice)
        const next = state.steps.find((one) => one.part.name === part.name)
        const live = next?.options.filter((one) => one.empties.length === 0) ?? []
        const pick = live[0] ?? next?.options[0]
        if (pick === undefined) break
        choice = { ...choice, [part.name]: pick.variant.id }
        const record = byId.get(pick.variant.id)
        if (record !== undefined) fills.set(part.name, record)
      }
      const feet = new Map<SlotName, Footprint>([...fills].map(([name, record]) => [name, record.foot]))
      out.push({ template, layout, fills, feet, placed: placeTemplateSlots(layout, feet) })
    }
  }
  return out
}

/** Every candidate record of every one of the 128 parts, cold. */
function coldCandidates(
  recipes: RecipeIndex,
  byId: ReadonlyMap<string, CatalogRecord>,
): readonly {
  readonly template: RecipeTemplate
  readonly part: SlotName
  readonly records: readonly CatalogRecord[]
}[] {
  const out: { template: RecipeTemplate; part: SlotName; records: readonly CatalogRecord[] }[] = []
  for (const template of RECIPE_TEMPLATES) {
    for (const step of assemblyState(recipes, template, {}).steps) {
      const records = step.options
        .flatMap((option) => [...option.tiles])
        .map((tile) => byId.get(tile))
        .filter((record): record is CatalogRecord => record !== undefined)
      out.push({ template, part: step.part.name, records })
    }
  }
  return out
}

const tally = <T>(values: readonly T[]): Record<string, number> => {
  const counts: Record<string, number> = {}
  for (const value of values) {
    const key = String(value)
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

describeCorpus(corpusTitle, () => {
  const file = hasCatalog ? CatalogFile.parse(JSON.parse(readFileSync(CATALOG, 'utf8'))) : undefined
  const byId = new Map<string, CatalogRecord>((file?.records ?? []).map((record) => [record.id, record]))
  const recipes = file === undefined ? undefined : createRecipeIndex(file)
  const parts = recipes === undefined ? [] : coldCandidates(recipes, byId)
  const combinations = recipes === undefined ? [] : walk(recipes, byId)

  /** Tiles carrying a given tag, by de-interning the table once per call. */
  const tilesWith = (predicate: (tag: string) => boolean): number => {
    const ids = new Set<number>()
    ;(file?.tags ?? []).forEach((tag, id) => {
      if (predicate(tag)) ids.add(id)
    })
    return (file?.records ?? []).filter((record) => record.tags.some((id) => ids.has(id))).length
  }

  /* ------------------------------------------- nothing in the tags names an edge */

  it('has 8 tiles, 0.09%, carrying any tag that could name a face of a cell', () => {
    /* The negative result the whole row rests on, recomputed rather than
       quoted. `connection|left`, `connection|right` and `connection|bottom` are
       the only tag strings in the corpus that could name a face, and between
       them they reach 8 records. */
    const faceNamed = tilesWith(
      (tag) => tag === 'connection|left' || tag === 'connection|right' || tag === 'connection|bottom',
    )
    expect(faceNamed).toBe(8)
    expect(faceNamed / (file?.records.length ?? 1)).toBeCloseTo(0.0009, 4)
  })

  it('has `connection|side` naming a system on 2,080 tiles and a position on none', () => {
    expect(tilesWith((tag) => tag === 'connection|side')).toBe(2080)
    // Its three children are the three connector systems, which is the trap
    // `src/catalog/schema.ts` already flags from the other direction.
    expect(
      (file?.tags ?? []).filter((tag) => tag.startsWith('connection|side|')).sort(),
    ).toEqual(['connection|side|dragonlock', 'connection|side|filament', 'connection|side|openlock'])
  })

  it('has chirality on 427 tiles and an edge name on none of them', () => {
    expect(tilesWith((tag) => tag === 'shape|corner|left')).toBe(133)
    expect(tilesWith((tag) => tag === 'shape|corner|right')).toBe(133)
    const leftRight = tilesWith((tag) => /left|right/.test(tag))
    expect(leftRight).toBe(427)
    expect(leftRight / (file?.records.length ?? 1)).toBeCloseTo(0.0491, 4)
  })

  it('matches 41 tags on 576 tiles when swept for a face word, and not one is an edge', () => {
    /* The sweep, as a whole path segment. Every match is chirality
       (`shape|corner|left`), a component name (`component|edge_gutter`) or a
       part interface (`interface|stairs|top`) — the qualitative reading is a
       human one and cannot be asserted, but the population it was read over is
       pinned here so a corpus change that widened it would fail.

       As a bare *substring* the same word list matches 115 tags, and that count
       is an artefact: 56 of the extra hits are `interface|*` tags matched by the
       letters "face" inside "interface". The whole-segment figure is the
       honest one. */
    const words =
      /(?:^|[|_])(north|south|east|west|top|bottom|front|back|left|right|up|down|edge|side|face|origin|anchor|offset)(?:$|[|_])/
    const outsideConnection = (tag: string): boolean => words.test(tag) && !tag.startsWith('connection|')
    const matched = (file?.tags ?? []).filter(outsideConnection)
    expect(matched).toHaveLength(41)
    const tiles = tilesWith(outsideConnection)
    expect(tiles).toBe(576)
    expect(tiles / (file?.records.length ?? 1)).toBeCloseTo(0.0662, 4)
    // The substring reading, and why it is not the one quoted.
    const substring = (file?.tags ?? []).filter(
      (tag) =>
        /north|south|east|west|top|bottom|front|back|left|right|up|down|edge|side|face|origin|anchor|offset/.test(
          tag,
        ),
    )
    expect(substring).toHaveLength(115)
    expect(substring.filter((tag) => tag.startsWith('interface|'))).toHaveLength(67)
  })

  /* ------------------------------------------------- the census of the 128 */

  it('is 40 recipes over 128 parts in 3 part-name sets, all three of them authored', () => {
    expect(RECIPE_TEMPLATES).toHaveLength(40)
    expect(parts).toHaveLength(128)
    const sets = new Set(RECIPE_TEMPLATES.map((template) => template.parts.map((part) => part.name).join('|')))
    expect(sets.size).toBe(3)
    expect(SLOT_CONVENTIONS).toHaveLength(3)
  })

  it(
    'gives the base slot 25 footprints, the wall slot 14 and the floor slot 8',
    () => {
      /* The load-bearing result of the row, and the reason a `SlotLayout`
         carrying `(dx, dz, dy, yaw)` is not implementable: a stored offset is
         right for one fill of a slot and wrong for the next. */
      const perSlot = new Map<SlotName, Set<string>>()
      for (const { part, records } of parts) {
        const feet = perSlot.get(part) ?? new Set<string>()
        for (const record of records) feet.add(JSON.stringify(record.foot))
        perSlot.set(part, feet)
      }
      expect(Object.fromEntries([...perSlot].map(([name, feet]) => [name, feet.size]))).toEqual({
        base: 25,
        floor: 8,
        wall: 14,
        column: 1,
        'right wall': 4,
        'left wall': 4,
      })
      const oneFootprint = parts.filter(
        ({ records }) => new Set(records.map((record) => JSON.stringify(record.foot))).size === 1,
      )
      expect(oneFootprint).toHaveLength(28)
    },
    SLOW_MS,
  )

  it('admits a fill with no placeable footprint at all, on the wall slot', () => {
    /* `{shape:'none'}` — the case `footprintShape` returns `undefined` for by
       design, on 726 tiles corpus-wide. No offset exists for it at any price,
       which is what makes refusal rather than approximation the only option. */
    const wallFeet = new Set(
      parts.filter(({ part }) => part === 'wall').flatMap(({ records }) => records.map((r) => r.foot.shape)),
    )
    expect([...wallFeet].sort()).toEqual(['column', 'diag', 'none', 'rect', 'tri', 'wall'])
    expect(footprintShape({ shape: 'none' })).toBeUndefined()
  })

  it('derives 80 of the 128 and authors 48, and the 80 are every base and every floor', () => {
    const derived = parts.filter(({ part }) => part === 'base' || part === 'floor')
    expect(derived).toHaveLength(80)
    expect(parts.length - derived.length).toBe(48)

    // The two derivations, checked rather than assumed. `base` here is the
    // `layer` value and not a role — row A9 measured `shape|base` exactly
    // coextensive with `layer === 'base'` (1,963 both ways), and this row needs
    // only that every candidate of a base slot is one.
    for (const { records } of parts.filter(({ part }) => part === 'base')) {
      expect(records.every((record) => record.layer === 'base')).toBe(true)
    }
    for (const { records } of parts.filter(({ part }) => part === 'floor')) {
      expect(records.every((record) => record.layer === 'topper')).toBe(true)
      expect(records.every((record) => record.kinds.includes('floor'))).toBe(true)
    }

    // And the anchors those derivations imply.
    const anchors = parts.map(
      ({ template, part }) =>
        ruleFor(conventionFor(template.parts.map((one) => one.name)) as TemplateLayout, part)?.anchor,
    )
    expect(tally(anchors)).toEqual({ cell: 80, edge: 40, corner: 8 })
  })

  it('gives the cell slot a rectangle on every candidate, which the base slot cannot promise', () => {
    /* Why `TemplateLayout.cell` is `floor` and not `base`. The floor slot's
       candidates are rect on all of them; the base slot's 25 footprints include
       five `wall` runs, and one of the 40 base parts really does admit them. */
    const floorFiles = parts.filter(({ part }) => part === 'floor').flatMap(({ records }) => records)
    expect(floorFiles).toHaveLength(2996)
    expect(floorFiles.filter((record) => record.foot.shape !== 'rect')).toHaveLength(0)

    const baseParts = parts.filter(({ part }) => part === 'base')
    const withWallRun = baseParts.filter(({ records }) => records.some((r) => r.foot.shape === 'wall'))
    expect(baseParts.flatMap(({ records }) => records)).toHaveLength(5677)
    /* The one caveat the research left unquantified, quantified: **1 of the 40
       base parts** admits a wall-run candidate, over 248 files. */
    expect(withWallRun).toHaveLength(1)
    expect(withWallRun[0]?.records.filter((r) => r.foot.shape === 'wall')).toHaveLength(248)
    const baseFeet = new Set(baseParts.flatMap(({ records }) => records.map((r) => r.foot.shape)))
    expect([...baseFeet].sort()).toEqual(['rect', 'wall'])
  })

  /* ------------------------------------------------------------ the closure */

  it(
    'closes on 1,006 of 1,215 combinations, fails on 33 and cannot decide 176',
    () => {
      expect(combinations).toHaveLength(1215)
      const verdicts = tally(combinations.map((one) => one.placed.verdict))
      process.stdout.write(`\n[template] closure ${JSON.stringify(verdicts)}\n`)
      expect(verdicts).toEqual({ closes: 1006, fails: 33, undecidable: 176 })
      expect(1006 / 1215).toBeCloseTo(0.828, 3)
      expect(33 / 1215).toBeCloseTo(0.027, 3)
      expect(176 / 1215).toBeCloseTo(0.145, 3)
    },
    SLOW_MS,
  )

  it('splits that 1,143 / 34 / 38 across the three conventions', () => {
    const per = new Map<string, Record<string, number>>()
    for (const one of combinations) {
      const id = (one.layout as { id?: string }).id ?? ''
      const counts = per.get(id) ?? { closes: 0, fails: 0, undecidable: 0 }
      counts[one.placed.verdict] = (counts[one.placed.verdict] ?? 0) + 1
      per.set(id, counts)
    }
    expect(per.get('wall-on-tile')).toEqual({ closes: 980, fails: 25, undecidable: 138 })
    expect(per.get('external-corner')).toEqual({ closes: 26, fails: 8, undecidable: 0 })
    /* All 38 internal-corner combinations, and every one of them undecidable:
       with no wall part there is no anchored face and so no closure to check.
       Counting them as fits would inflate 82.8% by three points on nothing. */
    expect(per.get('internal-corner')).toEqual({ closes: 0, fails: 0, undecidable: 38 })
  })

  it('itemises the 33 failures as 25 columns in a wall slot and the 8 single-piece mitres', () => {
    const failures = combinations.filter((one) => one.placed.verdict === 'fails')
    expect(failures).toHaveLength(33)

    const columnsAsWalls = failures.filter((one) => one.feet.get('wall')?.shape === 'column')
    expect(columnsAsWalls).toHaveLength(25)
    for (const one of columnsAsWalls) {
      // A 0.5 column filling a wall slot on a 2 x 2 floor. The corpus admits it;
      // there is no 2-unit edge run to match.
      expect(one.placed.doubts).toEqual([{ part: 'wall', code: 'over-run', want: 2, got: 0.5 }])
    }

    const mitres = failures.filter((one) => one.layout === SLOT_CONVENTIONS[1])
    expect(mitres).toHaveLength(8)
    for (const one of mitres) {
      /* **The 8 the plan's §9 singles out.** Every one is a `single_piece`
         corner: two `size|width|2` walls plus a 0.5 column on a 2 x 2 cell,
         where `2 + 0.5 !== 2`. The meshes must be mitred back physically and
         **nothing in the corpus records the mitre** — 0 of the 266
         `shape|corner|left`/`right` records have a measured mesh, asserted
         below. So the doubt names the edge and the sum and stops: *do not
         silently write 1.5*. */
      expect(one.template.tags).toContain('build|s2w|single_piece')
      expect(one.placed.doubts.map((doubt) => doubt.code)).toEqual(['over-run', 'over-run'])
      expect(one.placed.doubts.every((doubt) => doubt.want === 2 && doubt.got === 2.5)).toBe(true)
      expect(one.placed.slots.map((slot) => slot.part)).toEqual(['base', 'floor', 'column'])
      expect(JSON.stringify(one.placed)).not.toContain('1.5')
    }
  })

  it('itemises the 176 undecidables, and the 102 diagonals are four measured runs', () => {
    const reasons = combinations
      .filter((one) => one.placed.verdict === 'undecidable')
      .map((one) => {
        const doubt = one.placed.doubts.find((each) => each.code !== 'over-run')
        if (doubt === undefined) return 'no anchored face'
        const shape = one.feet.get(doubt.part)?.shape ?? 'absent'
        return `${doubt.code satisfies SlotDoubtCode}:${shape}`
      })
    expect(tally(reasons)).toEqual({
      'no anchored face': 38,
      'no-run:diag': 102,
      'no-footprint:none': 32,
      'no-run:tri': 2,
      'unfilled:absent': 2,
    })

    const runs = combinations
      .filter((one) => one.feet.get('wall')?.shape === 'diag')
      .map((one) => {
        const foot = one.feet.get('wall')
        return foot?.shape === 'diag' ? foot.run : 0
      })
    /* The four measured `diag` runs, per code: `PA` 2.828, `PB` 2.835,
       `PC` 3.334, `P` 3.536. A 45° run has no cell face to lie along, which is
       different geometry rather than an approximation of this. */
    expect(tally(runs)).toEqual({ '3.334': 37, '2.835': 29, '2.828': 18, '3.536': 18 })
  })

  it('never centres a cell-anchored base off its floor, on 1,213 of 1,213', () => {
    /* The other half of the wall-run-base caveat. Five of the base slot's 25
       footprints are `wall` runs and a wall-run base anchored to the cell centre
       would probably be wrong — measured, it never happens: the fill walk picks
       a congruent rect base on every combination that has one. So the `cell`
       anchor on `base` is safe over the whole walked population and the risk is
       confined to the 248 non-default candidates of one slot. */
    let checked = 0
    let disagrees = 0
    for (const one of combinations) {
      const base = one.feet.get('base')
      const floor = one.feet.get('floor')
      if (base === undefined || floor === undefined || floor.shape !== 'rect') continue
      checked += 1
      if (!(base.shape === 'rect' && base.w === floor.w && base.d === floor.d)) disagrees += 1
    }
    expect(checked).toBe(1213)
    expect(disagrees).toBe(0)
  })

  it('produces four distinct edge insets, three of them off the 0.5 snap lattice', () => {
    const insets = new Set<number>()
    for (const one of combinations) {
      for (const slot of one.placed.slots) {
        if (slot.anchor !== 'edge') continue
        insets.add(slot.offset[0] === 0 ? slot.offset[1] : slot.offset[0])
      }
    }
    const sorted = [...insets].sort((a, b) => a - b)
    /* The four the archive really produces. `0` is the degenerate case — a 1 x 1
       cell filled by a 1 x 1 wall piece, where the piece *is* the cell — and the
       other three are odd multiples of 0.25. */
    expect(sorted).toEqual([-1.25, -0.75, -0.25, 0])
    // Multiples of 0.25 without exception, and three of the four off the 0.5 step.
    for (const inset of sorted) expect(Number.isInteger(inset * 4)).toBe(true)
    expect(sorted.filter((inset) => !Number.isInteger(inset * 2))).toHaveLength(3)
  })

  it('gives every closing combination an offset on the quarter-unit lattice', () => {
    let offsets = 0
    for (const one of combinations) {
      if (one.placed.verdict !== 'closes') continue
      for (const slot of one.placed.slots) {
        offsets += 1
        for (const value of slot.offset) expect(Number.isInteger(value * 4)).toBe(true)
      }
    }
    /* 1,006 closing combinations: 980 wall recipes at 3 slots and 26 corners at
       5. Every coordinate of every one is on the quarter-unit lattice, and the
       template origin is the only thing that ever gets snapped. */
    expect(offsets).toBe(980 * 3 + 26 * 5)
  })

  it('recomputes the same offset from the rule and from the footprints, for all of them', () => {
    /* That `placeTemplateSlots` is not a second arithmetic: every offset it
       produced is exactly what `slotOffset` gives for the same rule, cell and
       part extents. */
    for (const one of combinations) {
      if (one.placed.cell === undefined) continue
      const cell: Extent = one.placed.cell
      for (const slot of one.placed.slots) {
        const rule = ruleFor(one.layout, slot.part)
        const foot = one.feet.get(slot.part)
        const shape = foot === undefined ? undefined : footprintShape(foot)
        if (rule === undefined || shape === undefined) continue
        expect(slotOffset(rule, cell, shape.extent)).toEqual(slot.offset)
      }
    }
  })

  /* ------------------------------------------------------------- rotation */

  it('has a non-90 rotation step on 10 of the 128 parts, all of them the wall slot', () => {
    const perSlot = new Map<SlotName, Record<string, number>>()
    let offStep = 0
    for (const { part, records } of parts) {
      const steps = perSlot.get(part) ?? {}
      let any = false
      for (const record of records) {
        const step = record.rotStep ?? 90
        steps[String(step)] = (steps[String(step)] ?? 0) + 1
        if (step % 90 !== 0) any = true
      }
      if (any) offStep += 1
      perSlot.set(part, steps)
    }
    expect(offStep).toBe(10)
    /* A placed template rotates as a unit at 0/90/180/270, and 118 of 128 parts
       have nothing but 90° candidates. The 379 exceptions are the `diag` walls,
       whose own step disagrees with their container's — the one case a template
       rotation cannot reach, named rather than rounded. */
    expect(perSlot.get('wall')).toEqual({ '45': 379, '90': 3682 })
    expect(perSlot.get('base')).toEqual({ '90': 5677 })
    expect(perSlot.get('floor')).toEqual({ '90': 2996 })
    expect(perSlot.get('column')).toEqual({ '90': 112 })
    expect(perSlot.get('right wall')).toEqual({ '90': 698 })
    expect(perSlot.get('left wall')).toEqual({ '90': 697 })
  })

  /* ------------------------------------------------------------- collision */

  it('needs no change to partsOverlap, which already takes a multi-part array', () => {
    /* The claim, verified rather than assumed. A template's collision shape is
       the union of its slots' rotated parts, and `partsOverlap` is
       `a.some(one => b.some(other => quadsOverlap(one, other)))` over
       `readonly PlanPart[]` on both sides — the `arc` case already exercises it
       to 14 parts. So a five-slot corner is well inside the exercised range. */
    const closing = combinations.find(
      (one) => one.layout === SLOT_CONVENTIONS[1] && one.placed.verdict === 'closes',
    )
    expect(closing).toBeDefined()
    const partsAt = (x: number, z: number): readonly PlanPart[] =>
      (closing?.placed.slots ?? []).flatMap((slot) => {
        const foot = closing?.feet.get(slot.part)
        const shape = foot === undefined ? undefined : footprintShape(foot)
        if (shape === undefined) return []
        const turned = rotatedExtent(shape.extent, slot.yaw + shape.angle)
        return planParts(shape, slot.yaw, x + slot.offset[0] - turned.w / 2, z + slot.offset[1] - turned.d / 2)
      })

    const here = partsAt(1, 1)
    expect(here).toHaveLength(5)
    // Itself, an overlapping neighbour and an abutting one — a real overlap and
    // a real abutment, through the unmodified SAT layer.
    expect(partsOverlap(here, here)).toBe(true)
    expect(partsOverlap(here, partsAt(2, 1))).toBe(true)
    expect(partsOverlap(here, partsAt(3, 1))).toBe(false)
  })

  it('has no single PlanBand, which is the boundary row A7 owns', () => {
    /* And the half of the claim that is **false**: `subjectsConflict` gates on
       `a.band !== b.band` before it reaches `partsOverlap`, and a corner
       template's five fills are not all in one band. So a template cannot be
       reduced to one `OverlapSubject` without deciding what its band is, and
       `isCornerJunction` separately exempts exactly the perpendicular wall pair
       that lives *inside* a corner template — it would read a corner's own
       geometry as legal and, worse, would read the 8 mitres as legal too. Row
       **A7** owns elevation-aware overlap and both of these; this row stops here
       rather than widening `overlap.ts`. */
    const corner = combinations.find((one) => one.layout === SLOT_CONVENTIONS[1])
    const bands = new Set([...(corner?.fills.values() ?? [])].map((record) => planBand(record)))
    expect(bands.size).toBeGreaterThan(1)
    expect([...bands].sort()).toEqual(['area', 'edge'])
  })

  /* ------------------------------------------------------------ elevation */

  it('measures 4 of the 128 parts, so the meshes cannot adjudicate the anchors', () => {
    const measured = measuredExtents()
    const withMesh = parts.filter(({ records }) =>
      records.some((record) => measured[record.blob]?.extent !== undefined),
    )
    expect(withMesh).toHaveLength(4)
    // All four are the `right wall` / `left wall` slots of the two Modular
    // corner templates, and they resolve to the same 20 files.
    expect(new Set(withMesh.map(({ part }) => part))).toEqual(new Set(['right wall', 'left wall']))
    for (const { records } of withMesh) {
      expect(records.filter((record) => measured[record.blob]?.extent !== undefined).length).toBeGreaterThan(0)
    }
  })

  it('has no measured mesh at all for the corner families, so the mitre cannot be settled', () => {
    /* Why the 8 failures are surfaced rather than corrected. The tag groups that
       would have to be measured to find the physical mitre have **zero** measured
       meshes between them. */
    const measured = measuredExtents()
    const countFor = (tag: string): { records: number; measured: number } => {
      /* A `Set<number>` rather than `record.tags.includes(id)`: `TagId` is a
         branded number, so `includes` refuses a plain one — and `tsc -b` is what
         catches that, not vitest. */
      const wanted = new Set<number>()
      ;(file?.tags ?? []).forEach((each, id) => {
        if (each === tag) wanted.add(id)
      })
      const rows = (file?.records ?? []).filter((record) => record.tags.some((id) => wanted.has(id)))
      return {
        records: rows.length,
        measured: rows.filter((record) => measured[record.blob]?.extent !== undefined).length,
      }
    }
    expect(countFor('shape|corner|left')).toEqual({ records: 133, measured: 0 })
    expect(countFor('shape|corner|right')).toEqual({ records: 133, measured: 0 })
    expect(countFor('shape|column|corner')).toEqual({ records: 20, measured: 0 })
  })

  it('puts every measured base on z = 0 at about 6 mm, which is what a floor is lifted by', () => {
    const measured = measuredExtents()
    const heights: number[] = []
    let onZero = 0
    for (const record of file?.records ?? []) {
      if (record.layer !== 'base') continue
      const extent = measured[record.blob]?.extent
      if (extent === undefined) continue
      const min = extent.minMm[2] ?? 0
      const max = extent.maxMm[2] ?? 0
      heights.push(max - min)
      if (Math.abs(min) < 0.1) onZero += 1
    }
    expect(heights).toHaveLength(343)
    expect(onZero).toBe(343)
    /* **The brief said 291 of 343 sit at 6.00-6.01 mm and that does not
       reproduce.** Measured within 0.015 mm of that band it is **279 of 343
       (81.3%)**; 295 (86.0%) are below 6.1 mm, and the remaining 48 are 12 each
       at 12.70, 25.40, 38.10 and 50.80. The pinned figure is the measured one.
       What the row needs from it is unchanged: a base is about one 6 mm slab, so
       a topper resting on `y = 0` beside it would be entirely inside it. */
    expect(heights.filter((height) => height >= 5.995 && height <= 6.015)).toHaveLength(279)
    expect(heights.filter((height) => height < 6.1)).toHaveLength(295)
    expect(heights.filter((height) => height > 12).sort((a, b) => a - b)).toHaveLength(48)
  })

  it('has 18.4% of measured toppers authored pre-lifted and 77.5% not, so elevation stays derived', () => {
    const measured = measuredExtents()
    const buckets = { atZero: 0, oneBase: 0, other: 0, negative: 0 }
    for (const record of file?.records ?? []) {
      if (record.layer !== 'topper') continue
      const extent = measured[record.blob]?.extent
      if (extent === undefined) continue
      const min = extent.minMm[2] ?? 0
      if (min < -0.1) buckets.negative += 1
      else if (Math.abs(min) < 0.1) buckets.atZero += 1
      else if (Math.abs(min - 6) < 0.25) buckets.oneBase += 1
      else buckets.other += 1
    }
    /* The whole argument for `restsOn` naming a part rather than carrying a
       number. 583 measured toppers: 452 rest on z = 0 and 107 are already a base
       thickness up. A stored elevation would freeze one of the two populations
       into the rule, so `place.ts` normalises to `-upright.min.y` and the lift is
       applied on top of that. */
    expect(buckets).toEqual({ atZero: 452, oneBase: 107, other: 18, negative: 6 })
    const total = buckets.atZero + buckets.oneBase + buckets.other + buckets.negative
    expect(total).toBe(583)
    expect(buckets.oneBase / total).toBeCloseTo(0.184, 3)
    expect(buckets.atZero / total).toBeCloseTo(0.775, 3)
  })

  /* -------------------------------------------------------- the byte price */

  it(
    'would cost the index +222 B to ship the rule as 128 rows, so it ships in the bundle',
    () => {
      /* The counterfactual, measured with `emit.ts`'s own brotli-11 instrument
         over the **shipped artefact at the payload epoch** — the construction
         `src/generator/panel/corpus.test.ts` calls *"the one every payload docblock
         in the repo quotes"*, and the baseline is its 366,768 B.

         The row itself adds **0 B**: `pipeline/templates.test.ts` rebuilds the
         corpus from the fixtures and finds the emitted bytes identical to row B1's
         pinned figure, with `build.ts` and `emit.ts` reaching neither
         `pipeline/templates.ts` nor `src/template/**`.

         Two other measurements of the same table, kept because they disagree:
         against a fresh build at the same epoch with an empty ordinal manifest it
         is +808 B, and the research measured +374 B against the pre-B1
         `catalog.json` (365,598 B baseline). Row B1 recorded the lesson — brotli is
         not additive over 5.9 MB, so this is a fact about one artefact at one
         epoch and never a rate. */
      const raw = JSON.parse(readFileSync(CATALOG, 'utf8')) as Record<string, unknown>
      const version = raw.version as Record<string, unknown>
      const atEpoch = { ...raw, version: { ...version, built: PAYLOAD_TIMESTAMP } }
      const baseline = brotli(JSON.stringify(atEpoch))

      const layouts = RECIPE_TEMPLATES.map((template) => {
        const convention = conventionFor(template.parts.map((part) => part.name))
        if (convention === undefined) throw new Error(`no convention for ${template.id}`)
        return {
          id: template.id,
          slots: convention.slots.map((slot) => ({
            part: slot.part,
            anchor: slot.anchor,
            side: slot.side,
            restsOn: slot.restsOn,
          })),
        }
      })
      const withTable = brotli(JSON.stringify({ ...atEpoch, layouts }))

      process.stdout.write(
        `\n[template] index ${String(baseline)} B · with a 128-row layouts key ${String(withTable)} B ` +
          `(+${String(withTable - baseline)})\n`,
      )
      expect(baseline).toBe(366_768)
      expect(layouts.reduce((total, one) => total + one.slots.length, 0)).toBe(128)
      expect(withTable - baseline).toBe(222)
      expect(baseline / SIZE_BUDGET_BYTES).toBeLessThan(0.72)
    },
    SLOW_MS,
  )
})

/* ============================================================== row C2's half */

/**
 * The **fill solver** against the same archive.
 *
 * Row C2 shares this directory with B2's slot geometry and shares nothing else
 * with it, so it gets its own block and its own indexes rather than threading
 * two rows' fixtures through one closure. What it does share is the reason the
 * file exists: nothing in the app reads `src/template/**` yet, and the research
 * report this row was briefed from no longer exists, so **a figure that is not
 * recomputed here is a figure nobody can check.**
 *
 * The row's headline is one comparison, and it is the first two assertions
 * below: 24 of 40 against 40 of 40.
 */
describeCorpus(
  hasCatalog
    ? 'the fill solver against the live archive'
    : `the fill solver against the live archive — SKIPPED, no ${CATALOG} (run \`npm run import:catalog\`)`,
  () => {
    const catalog = hasCatalog ? CatalogFile.parse(JSON.parse(readFileSync(CATALOG, 'utf8'))) : undefined
    const composition =
      catalog === undefined ? undefined : createCompositionIndex(catalog, buildAggregateIndex(catalog))
    const assembly = catalog === undefined ? undefined : buildAssemblyIndex(catalog)
    const context = composition === undefined ? undefined : { composition, lock: 'openlock' as const }

    /* Every figure below is computed from these three, so a `!` here would be the
       only unchecked claim in the block. `describeCorpus` skips when the artefact
       is absent, so the guard is unreachable rather than defensive. */
    const ready = (): { index: AssemblyIndex; context: FillContext } => {
      if (assembly === undefined || context === undefined) throw new Error('no catalog')
      return { index: assembly, context }
    }

    /* ------------------------------------------------- the policy comparison */

    it('completes 24 of the 40 recipes on the first candidate, and all 16 failures are the base slot', () => {
      const { context: ctx } = ready()
      const greedy = measureGreedy(RECIPE_TEMPLATES, ctx.composition)

      expect(greedy.completed).toBe(24)
      expect(greedy.failures).toHaveLength(16)
      // Not "mostly the base slot". Every one of them, on the sixteen modular
      // wall recipes, and each with candidates before its siblings were picked.
      expect(new Set(greedy.failures.map((one) => one.slot))).toEqual(new Set(['base']))
      expect(greedy.failures.every((one) => one.template.endsWith('-modular'))).toBe(true)
      expect(greedy.failures.every((one) => one.atFailure === 0)).toBe(true)
      expect([...new Set(greedy.failures.map((one) => one.cold))].sort((a, b) => a - b)).toEqual([48, 305])
    })

    it('completes 40 of 40 when it refuses a candidate that empties a sibling', () => {
      const { index, context: ctx } = ready()
      const greying = measureGreying(RECIPE_TEMPLATES, ctx.composition)
      const solver = measureSolver(RECIPE_TEMPLATES, index, ctx)

      // The independent walk and the shipped solver, separately, on the same 40.
      expect(greying.completed).toBe(40)
      expect(greying.failures).toEqual([])
      expect(solver.completed).toBe(40)
      expect(solver.failures).toEqual([])
      expect(solver.skipped).toBe(23)

      process.stdout.write(
        `\n[fill] first candidate ${String(measureGreedy(RECIPE_TEMPLATES, ctx.composition).completed)}/40 · ` +
          `greying walk ${String(greying.completed)}/40 · solver ${String(solver.completed)}/40 ` +
          `(${String(solver.queries)} queries, ${String(solver.skipped)} candidates refused)\n`,
      )
    })

    it('is refusing a policy failure and not an unsolvable archive', () => {
      const { context: ctx } = ready()
      const search = measureBacktracking(RECIPE_TEMPLATES, ctx.composition)

      // Every recipe is solvable over item representatives, so the greedy walk's
      // 16 failures belong to the walk. And backtracking completes the same 40
      // the one-step rule does, at 162 nodes — so the extra machinery buys
      // nothing on this corpus and the one-step rule is not a compromise.
      expect(search.unsolvable).toEqual([])
      expect(search.completed).toBe(40)
      expect(search.nodes).toBe(162)
    })

    it('empties nothing it had not filled, over all 148 post-pick observations', () => {
      const { index, context: ctx } = ready()
      const walk = measureMonotonicity(RECIPE_TEMPLATES, index, ctx)

      /* The plan's claim, restated as an observation of the walk the solver
         actually took: **0 of 148 emptied**. The 90 narrowings are the same 90
         the guided flow reports (72 on the first pick, 18 on the second), and
         the 0 rescues are the corner the grammar permits and this archive does
         not contain. */
      expect(walk).toEqual({ observations: 148, emptied: 0, rescued: 0, narrowed: 90 })
    })

    it('drops 36 of those 148 probes as unreachable, and every one of them is inert', () => {
      const { index, context: ctx } = ready()
      const filter = measureFilterSoundness(RECIPE_TEMPLATES, index, ctx)

      expect(filter).toEqual({ pairs: 148, probed: 112, dropped: 36, inert: 36 })
    })

    it('costs the queries `SOLVE_QUERIES` names', () => {
      const { index, context: ctx } = ready()
      const solver = measureSolver(RECIPE_TEMPLATES, index, ctx)

      expect(solver.queries).toBe(SOLVE_QUERIES)
      // 128 slot resolutions is the floor: one per part, and the rest is the
      // greying rule's probes plus the lazy before-counts.
      expect(solver.queries).toBeGreaterThan(128)
    })

    /* ------------------------------------------------------- the empty sets */

    it('has no template part that is ever empty, and two that offer 308 and 428 items', () => {
      const { context: ctx } = ready()
      const cold = RECIPE_TEMPLATES.flatMap((template) =>
        template.parts.map((part) =>
          ctx.composition.candidatesFor(resolveSlotTags(part.tags, template.tags, [])),
        ),
      )

      /* The three empty-set situations are three situations: **0 of 128**
         template parts is ever empty, minimum 5 candidate files, so that path
         needs no UI at all — and the two `(Any, …)` walls are why a default fill
         is not optional. */
      expect(cold).toHaveLength(128)
      expect(cold.filter((one) => one.deadEnd)).toEqual([])
      expect(Math.min(...cold.map((one) => one.tiles.length))).toBe(5)
      expect(
        cold
          .map((one) => one.items.length)
          .sort((a, b) => b - a)
          .slice(0, 2),
      ).toEqual([428, 308])
    })

    /* -------------------------------------------------------- the base ladder */

    it('hands every base slot a `plain` base, where the candidate order hands 16 of 40 a topless one', () => {
      const { index, context: ctx } = ready()
      const picks = measureBaseLadder(RECIPE_TEMPLATES, index, ctx)
      const tally = (options: readonly (string | undefined)[]): Record<string, number> => {
        const counts: Record<string, number> = {}
        for (const option of options) counts[String(option)] = (counts[String(option)] ?? 0) + 1
        return counts
      }

      /* This is why `rankBases` is consumed rather than reimplemented as "take
         the first candidate". A topless base has no top surface: 16 of the 40
         recipes would print one, and nothing on screen would say so. */
      expect(picks).toHaveLength(40)
      expect(tally(picks.map((one) => one.rankedOption))).toEqual({ plain: 40 })
      expect(tally(picks.map((one) => one.orderedOption))).toEqual({ plain: 24, topless: 16 })
      expect(picks.filter((one) => one.lockAgrees)).toHaveLength(40)

      /* And the honest half: of the ladder's five criteria only two do any work
         here. **0 of 40** chosen bases publish the floor's `size|openlock` code,
         because a `base` slot's candidates are selected by tag rather than by
         footprint congruence and the coded bases are not among them. The code
         criterion is not wrong — it decides 1,870 of 1,999 coded toppers for
         `matchBase` — it is silent on this population. */
      expect(picks.filter((one) => one.codeAgrees)).toHaveLength(0)
      expect(picks.every((one) => one.ranked !== one.ordered)).toBe(true)

      process.stdout.write(
        `\n[fill] base slots: ranked ${JSON.stringify(tally(picks.map((one) => one.rankedOption)))} · ` +
          `candidate order ${JSON.stringify(tally(picks.map((one) => one.orderedOption)))}\n`,
      )
    })

    it('reads the base slot off the layout, and it is `base` on all 40 recipes', () => {
      const rested = RECIPE_TEMPLATES.map((template) => {
        const layout = conventionFor(template.parts.map((part) => part.name))
        if (layout === undefined) throw new Error(`no convention for ${template.id}`)
        return layout.slots.filter((rule) => layout.slots.some((other) => other.restsOn === rule.part)).map((rule) => rule.part)
      })

      expect(new Set(rested.map((parts) => parts.join(',')))).toEqual(new Set(['base']))
      // And the cell the ladder ranks against is the floor, on all 40.
      expect(
        new Set(
          RECIPE_TEMPLATES.map(
            (template) => conventionFor(template.parts.map((part) => part.name))?.cell,
          ),
        ),
      ).toEqual(new Set(['floor']))
    })

    /* ------------------------------------------------------ the two preferences */

    it('completes 40 of 40 under every lock preference and under none', () => {
      const { index, context: ctx } = ready()

      for (const lock of [undefined, 'openlock', 'dragonlock', 'magnetic'] as const) {
        const result = measureSolver(RECIPE_TEMPLATES, index, { composition: ctx.composition, lock })
        expect(result.completed, `lock ${String(lock)}`).toBe(40)
      }
    })

    it('moves 74 of the 128 slots between the three locks, and not one item', () => {
      const { index, context: ctx } = ready()
      const spread = measureLockSpread(RECIPE_TEMPLATES, index, ctx, ['openlock', 'dragonlock', 'magnetic'])

      /* What a lock toggle is *for*, measured: 74 slots change file. And the
         structural claim `relock.ts` rests on — **the candidate set is
         lock-free** — measured from the other side: 0 slots change *item*, so a
         toggle can never empty a slot or complete one. */
      expect(spread.reduce((total, one) => total + one.moved.length, 0)).toBe(74)
      expect(spread.flatMap((one) => one.movedItem)).toEqual([])
      expect(spread.filter((one) => one.moved.length > 0)).toHaveLength(40)
    })

    it('completes 40 of 40 under every design family, honouring it where the family reaches', () => {
      const { index, context: ctx } = ready()
      const families = ['dungeon_stone', 'cut-stone', 'towne', 'aztlan', 'cave'] as const
      const honoured: string[] = []

      for (const family of families) {
        const local = { composition: ctx.composition, lock: 'openlock' as const, family }
        expect(measureSolver(RECIPE_TEMPLATES, index, local).completed, family).toBe(40)
        const slots = RECIPE_TEMPLATES.flatMap(
          (template) => solveTemplateFills(template, index, local).decisions,
        ).filter((one) => one.familyHonoured).length
        honoured.push(`${family} ${String(slots)}/128`)
      }

      /* The family is a **preference and not a filter**, and this is the pair of
         figures that says so: `dungeon_stone` reaches 89 of the 128 slots and
         `cave` reaches **none of them** — and both complete all 40. A filter
         would have completed 0 recipes under `cave`. */
      expect(honoured).toEqual([
        'dungeon_stone 89/128',
        'cut-stone 89/128',
        'towne 66/128',
        'aztlan 49/128',
        'cave 0/128',
      ])
    })

    /* ------------------------------------------------------- the fills, placed */

    it('produces a template that closes geometrically on 34 of the 40, and B2 owns the other 6', () => {
      const { index, context: ctx } = ready()
      const verdicts: Record<string, number> = {}
      const doubts: Record<string, number> = {}
      const failing: string[] = []

      for (const template of RECIPE_TEMPLATES) {
        const layout = conventionFor(template.parts.map((part) => part.name))
        if (layout === undefined) throw new Error(`no convention for ${template.id}`)
        const fill = solveTemplateFills(template, index, ctx)
        const feet = new Map<SlotName, Footprint>()
        for (const [slot, tile] of Object.entries(fill.fills)) {
          const record = index.byId.get(tile)
          if (record !== undefined) feet.set(slot, record.foot)
        }
        const placed = placeTemplateSlots(layout, feet)
        verdicts[placed.verdict] = (verdicts[placed.verdict] ?? 0) + 1
        for (const doubt of placed.doubts) doubts[doubt.code] = (doubts[doubt.code] ?? 0) + 1
        if (placed.verdict === 'fails') failing.push(template.id)
      }

      /* The end-to-end question this row cannot answer on its own: does the
         one-click default actually *fit*? On 34 of 40 it does. The 6 that do not
         are B2's known population and not this solver's choice:

           - **4 `undecidable`** — the four internal corners, which have no wall
             part at all, so there is no closure to check;
           - **2 `fails`** — the two external-corner `single_piece` recipes,
             whose two `size|width|2` walls plus a 0.5 column cannot share two
             2-unit edges. The mitre is in no tag and in no measured mesh, and
             B2's §9 rule is *"do not silently write 1.5"*, so they surface as
             `over-run` doubts, two walls each.

         No choice of fill closes those two — the arithmetic is over the tagged
         widths, which every candidate carries — so this is not a policy failure
         and a different ordering would not fix it. What it does mean is that a
         one-click placement can arrive with a doubt on it, which is C1's and
         C3's to disclose and is exactly what `SlotDoubt` is for. */
      expect(verdicts).toEqual({ closes: 34, fails: 2, undecidable: 4 })
      expect(doubts).toEqual({ 'over-run': 4 })
      expect(failing.every((id) => id.includes('corner') && id.endsWith('-single-piece'))).toBe(true)
    })

    /* --------------------------------------------------------- the scene scale */

    it('re-solves a 250-instance room inside a frame, and only because it memoises', () => {
      const { index, context: ctx } = ready()
      const room = Array.from(
        { length: 250 },
        (_, at) => RECIPE_TEMPLATES[at % RECIPE_TEMPLATES.length] as AssemblyTemplate,
      )

      /* §11's third gap: *"the lock re-solve has never been measured at scene
         scale — 250 instances at 5 slots is 1,250 candidate queries,
         synchronously, on one click."* Measured, a solve per instance is 1,790
         queries; memoised on `(template, preference, pins)` it is 288, because
         a room of 250 instances is built out of 40 recipes.

         A floor over attempts, for `screens/assemblies/corpus.test.ts`'s reason:
         contention can only add time, so a shape that is genuinely over budget
         is over budget on every attempt. The budget is loose because this is a
         regression guard and the line printed below is the measurement: read in
         isolation the two shapes are 53-65 ms and 8-9 ms, and inside a
         whole-suite run 149.6 ms and 22.8 ms — a scheduling spike, not a
         different function. */
      const floors = new Map<string, SceneCost>()
      for (let attempt = 0; attempt < 5; attempt += 1) {
        for (const cost of measureSceneCost(room, index, ctx)) {
          const best = floors.get(cost.shape)
          if (best === undefined || cost.ms < best.ms) floors.set(cost.shape, cost)
        }
      }

      const perInstance = floors.get('per instance')
      const memoised = floors.get('memoised')

      expect(perInstance?.solves).toBe(250)
      expect(perInstance?.queries).toBe(1_790)
      expect(memoised?.solves).toBe(40)
      expect(memoised?.queries).toBe(SOLVE_QUERIES)

      process.stdout.write(
        `\n[fill] 250-instance re-solve: per instance ${(perInstance?.ms ?? 0).toFixed(1)} ms / ` +
          `${String(perInstance?.queries)} queries · memoised ${(memoised?.ms ?? 0).toFixed(1)} ms / ` +
          `${String(memoised?.queries)} queries\n`,
      )

      // One frame at 60 Hz is 16.7 ms and the memoised reading is 8-9 in
      // isolation. The bound is loose enough not to fail under whole-suite
      // contention (22.8 ms there) and tight enough that losing the memo fails
      // it (53-65 ms in isolation, 149.6 ms contended).
      expect(memoised?.ms).toBeLessThan(40)
    })
  },
)
