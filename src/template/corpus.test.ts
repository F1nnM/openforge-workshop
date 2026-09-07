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
 * It cannot tell you the four authored conventions are *right*. There is
 * nothing to check them against: the corpus's entire positional vocabulary is
 * chirality on 427 tiles (4.91%) plus 8 tiles carrying a face-named connection
 * tag (0.09%), both recomputed below, and **4 of the 128 parts have even one
 * candidate with a measured bounding box** — all four the same 20 files, and
 * those 20 are one print-plate row whose authored `minX` marches in constant
 * 45.00 mm steps. So the meshes cannot adjudicate either. What this file proves
 * is that the *arithmetic* the conventions imply closes on the archive, exactly
 * how often, and exactly which combinations it refuses.
 *
 * ## Two populations, deliberately not merged — row E3
 *
 * `RECIPE_TEMPLATES` is 42 since row E3 authored two assemblies in this repo, and
 * **every figure in this file that was a fact about the 40 stays a fact about the
 * 40.** The 1,215 walked combinations, the 25 footprints of the `base` slot, the
 * 24-of-40 greedy walk: those are measurements of *upstream's* recipes, and
 * folding two authored rows into them would silently redefine what
 * "1,014 of 1,215" means without a single assertion going red. So
 * {@link FIXTURE_RECIPES} carries the 40 and every existing measurement runs over
 * it; the two authored rows get their own block at the end, with their own walk,
 * their own closure split and their own acceptance gate.
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
import { GENERATED_FAMILIES, GENERATED_FAMILY_SIZES, RECIPE_TEMPLATES } from '@/screens/assemblies/templates'

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
import { cornerReservation, placeTemplateSlots, slotOffset } from './offsets'
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
 * The 40 read from the fixtures, and row **E3**'s two authored beside them.
 *
 * Split on `source`, whose `authored:` prefix is
 * `pipeline/authored.ts#AUTHORED_SOURCE_PREFIX` — spelled here rather than
 * imported, the same node/app boundary {@link PAYLOAD_TIMESTAMP} is written
 * across, so a drift shows up as a count that no longer matches.
 */
const FIXTURE_RECIPES = RECIPE_TEMPLATES.filter((template) => !template.source.startsWith('authored:'))
const AUTHORED = RECIPE_TEMPLATES.filter((template) => template.source.startsWith('authored:'))

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
function walk(
  recipes: RecipeIndex,
  byId: ReadonlyMap<string, CatalogRecord>,
  population: readonly RecipeTemplate[],
): readonly Combination[] {
  const out: Combination[] = []
  for (const template of population) {
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
  population: readonly RecipeTemplate[],
): readonly {
  readonly template: RecipeTemplate
  readonly part: SlotName
  readonly records: readonly CatalogRecord[]
}[] {
  const out: { template: RecipeTemplate; part: SlotName; records: readonly CatalogRecord[] }[] = []
  for (const template of population) {
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
  const parts = recipes === undefined ? [] : coldCandidates(recipes, byId, FIXTURE_RECIPES)
  const combinations = recipes === undefined ? [] : walk(recipes, byId, FIXTURE_RECIPES)

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

  it('is 40 fixture recipes over 128 parts in 3 part-name sets, plus row E3\u2019s two', () => {
    expect(FIXTURE_RECIPES).toHaveLength(40)
    expect(parts).toHaveLength(128)
    const sets = new Set(FIXTURE_RECIPES.map((template) => template.parts.map((part) => part.name).join('|')))
    expect(sets.size).toBe(3)

    /* Four conventions for four part-name sets, and the fourth is reached by
       exactly one template in the build: the widened wall is a `wall-on-tile`,
       because only its floor slot's admissions differ from the shipped
       recipe's. */
    expect(RECIPE_TEMPLATES).toHaveLength(42)
    expect(AUTHORED).toHaveLength(2)
    expect(SLOT_CONVENTIONS).toHaveLength(4)
    expect(AUTHORED.map((template) => conventionFor(template.parts.map((part) => part.name))?.id)).toEqual([
      'wall-on-tile',
      'corridor',
    ])
  })

  it(
    'gives the base slot 25 footprints, the wall slot 14 and the floor slot 8',
    () => {
      /* The load-bearing result of the row, and the reason a `SlotLayout`
         carrying `(dx, dz, dy, yaw)` is not implementable: a stored offset is
         right for one fill of a slot and wrong for the next.

         **The corner wall slots hold 3 each, not 4** — row D9. They used to
         offer `{wall,length:2}` and `{wall,length:1.5}` as two footprints, from
         a `size|width|2` tag and a `size|width|1.5` tag; measured, both classes
         of mesh run 1.500 and they are one footprint. The single-piece and
         modular corners are the same geometry differing only in print count,
         so the slot's *domain* shrank while its record count did not. */
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
        'right wall': 3,
        'left wall': 3,
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
    'closes on 1,014 of 1,215 combinations, fails on 25 and cannot decide 176',
    () => {
      /* **Row D9 moved this split, and the movement is exactly the 8 mitres.**
         D8 left it at 1,006 / 33 / 176 on purpose, because settling it meant
         measuring a mitre nobody had measured. Measured — 157 corner-wall
         meshes from R2, run 1.500 on all 245 records tagged `size|width|2` —
         two 1.5 walls and a 0.5 column tile two 2-unit faces exactly, so the 8
         `single_piece` corner combinations move from `fails` to `closes` and
         nothing else moves at all. `undecidable` is byte-identical at 176: the
         `diag`, `tri` and `no-footprint` refusals are untouched by a wall run.

         82.8% to **83.5%**, and the remaining 25 failures are one population
         rather than two — see the itemisation below. */
      expect(combinations).toHaveLength(1215)
      const verdicts = tally(combinations.map((one) => one.placed.verdict))
      process.stdout.write(`\n[template] closure ${JSON.stringify(verdicts)}\n`)
      expect(verdicts).toEqual({ closes: 1014, fails: 25, undecidable: 176 })
      expect(1014 / 1215).toBeCloseTo(0.835, 3)
      expect(25 / 1215).toBeCloseTo(0.021, 3)
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
    /* `wall-on-tile` is untouched — its 40 edges have no `corner` sibling, so
       `cornerReservation` is 0 on every one of them and not a coordinate moved.
       `external-corner` is where the whole movement lives: **34 of 34 close**,
       where D8 measured 8 `fails` and 26 `closes`. */
    expect(per.get('wall-on-tile')).toEqual({ closes: 980, fails: 25, undecidable: 138 })
    expect(per.get('external-corner')).toEqual({ closes: 34, fails: 0, undecidable: 0 })
    /* All 38 internal-corner combinations, and every one of them undecidable:
       with no wall part there is no anchored face and so no closure to check.
       Counting them as fits would inflate 82.8% by three points on nothing. */
    expect(per.get('internal-corner')).toEqual({ closes: 0, fails: 0, undecidable: 38 })
  })

  it('itemises the 25 failures as one population: a column filling a wall slot', () => {
    /* **What row D9 emptied.** This used to read *25 columns in a wall slot and
       the 8 single-piece mitres*, and the 8 were the whole of §9's *"do not
       silently write 1.5"*. They are gone from this list because the 1.5 was
       measured rather than written: two 1.5 walls and a 0.5 column tile two
       2-unit faces, so all 34 external-corner combinations close.

       What is left is one population and no corner among it — asserted below in
       both directions, because "the mitres closed" and "the mitres stopped being
       counted" would look the same from the count alone. */
    const failures = combinations.filter((one) => one.placed.verdict === 'fails')
    expect(failures).toHaveLength(25)

    const columnsAsWalls = failures.filter((one) => one.feet.get('wall')?.shape === 'column')
    expect(columnsAsWalls).toHaveLength(25)
    for (const one of columnsAsWalls) {
      // A 0.5 column filling a wall slot on a 2 x 2 floor. The corpus admits it;
      // there is no 2-unit edge run to match, and no corner sibling reserves any
      // of the face either, so `want` is the whole 2.
      expect(one.placed.doubts).toEqual([{ part: 'wall', code: 'over-run', want: 2, got: 0.5 }])
      expect(one.layout).toBe(SLOT_CONVENTIONS[0])
    }
    // No external corner fails at all any more, and no `single_piece` recipe
    // does either — the two spellings of the same fact.
    expect(failures.filter((one) => one.layout === SLOT_CONVENTIONS[1])).toEqual([])
    expect(failures.filter((one) => one.template.tags.includes('build|s2w|single_piece'))).toEqual([])
  })

  it('closes the 8 single-piece mitres on the measured 1.5, with all five parts placed', () => {
    /* **The row's headline, asserted as a positive rather than an absence.**

       Every `single_piece` external corner: two walls that a `size|width|2` tag
       used to make 2 units long, and that 157 R2 meshes measure at **1.500** —
       `footprint.ts#cornerWallRun`. 1.5 + 0.5 = 2 on both faces, so there is no
       doubt left to raise, and the offsets abut the column instead of running a
       quarter unit through it (D8 measured that overlap; `offsets.test.ts`
       measures the abutment).

       §9's caution is kept in the plan and its reason is kept here: the number
       is asserted to be the *measured* one and not an arithmetic convenience —
       `2 - WALL_THICKNESS_UNITS` is written nowhere in this file. */
    const singlePiece = combinations.filter(
      (one) =>
        one.layout === SLOT_CONVENTIONS[1] && one.template.tags.includes('build|s2w|single_piece'),
    )
    expect(singlePiece).toHaveLength(8)
    for (const one of singlePiece) {
      expect(one.placed.verdict).toBe('closes')
      expect(one.placed.doubts).toEqual([])
      expect(one.feet.get('right wall')).toEqual({ shape: 'wall', length: 1.5 })
      expect(one.feet.get('left wall')).toEqual({ shape: 'wall', length: 1.5 })
      expect(one.feet.get('column')).toEqual({ shape: 'column' })
      expect(one.placed.slots.map((slot) => slot.part)).toEqual([
        'base',
        'floor',
        'right wall',
        'left wall',
        'column',
      ])
      // Abutted, not centred: a quarter unit off the face centre, towards the
      // end the column does not take.
      const byPart = new Map(one.placed.slots.map((slot) => [slot.part, slot]))
      expect(byPart.get('right wall')?.offset).toEqual([0.25, -0.75])
      expect(byPart.get('left wall')?.offset).toEqual([-0.75, 0.25])
    }
    /* And the modular half resolves to the same geometry, which is the sharpest
       form of the finding: the two recipes differ only in how many prints the
       corner takes. */
    const modular = combinations.filter(
      (one) => one.layout === SLOT_CONVENTIONS[1] && !one.template.tags.includes('build|s2w|single_piece'),
    )
    expect(modular).toHaveLength(26)
    for (const one of modular) expect(one.placed.verdict).toBe('closes')
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

  it('produces five distinct edge coordinates, four of them off the 0.5 snap lattice', () => {
    /* **Row D9 added the fifth, and it is the abutment.** The flush inset along
       the anchored axis is unchanged — `-1.25`, `-0.75`, `-0.25`, `0` — and the
       new `0.25` is the *other* axis: half of the 0.5 a corner column reserves,
       on the 68 edge slots of the 34 external-corner combinations. Every edge of
       every `wall-on-tile` combination still reads 0 there, which is why 980
       closing combinations did not move.

       Collected as "whichever coordinate is not zero" the way this test always
       has, so both axes land in one set — see the pair below for the split. */
    const insets = new Set<number>()
    for (const one of combinations) {
      for (const slot of one.placed.slots) {
        if (slot.anchor !== 'edge') continue
        insets.add(slot.offset[0] === 0 ? slot.offset[1] : slot.offset[0])
      }
    }
    const sorted = [...insets].sort((a, b) => a - b)
    /* The five the archive really produces. `0` is the degenerate case — a 1 x 1
       cell filled by a 1 x 1 wall piece, where the piece *is* the cell — and the
       other four are odd multiples of 0.25. */
    expect(sorted).toEqual([-1.25, -0.75, -0.25, 0, 0.25])
    // Multiples of 0.25 without exception, and four of the five off the 0.5 step.
    for (const inset of sorted) expect(Number.isInteger(inset * 4)).toBe(true)
    expect(sorted.filter((inset) => !Number.isInteger(inset * 2))).toHaveLength(4)

    /* And the abutment is confined to the corner recipes, measured rather than
       argued: an edge slot picks up a non-zero shift along its face exactly when
       its layout has a `corner` sibling on that face. */
    let shifted = 0
    let unshifted = 0
    for (const one of combinations) {
      for (const slot of one.placed.slots) {
        if (slot.anchor !== 'edge') continue
        const along = cornerReservation(one.layout, one.feet, slot.side) / 2
        if (along === 0) unshifted += 1
        else shifted += 1
      }
    }
    // 68 = the two walls of each of the 34 external-corner combinations.
    expect(shifted).toBe(68)
    expect(unshifted).toBe(1007)
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
    /* 1,014 closing combinations: 980 wall recipes at 3 slots and **34** corners
       at 5 — row D9 moved 8 of them out of `fails`. Every coordinate of every one
       is on the quarter-unit lattice, and the template origin is the only thing
       that ever gets snapped. */
    expect(offsets).toBe(980 * 3 + 34 * 5)
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
        /* The fourth argument is row D9's, and passing it here is the point:
           `placeTemplateSlots` computes the face's own reservation from the
           layout and the fills, and `slotOffset` must reproduce the same
           coordinate from the same three inputs plus that one number. Omitting
           it would silently compare a corner edge against its pre-D9 centre. */
        const reserved = cornerReservation(one.layout, one.feet, rule.side)
        expect(slotOffset(rule, cell, shape.extent, reserved)).toEqual(slot.offset)
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
    'would cost the index +541 B to ship the rule as 135 rows, so it ships in the bundle',
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
        `\n[template] index ${String(baseline)} B · with a 135-row layouts key ${String(withTable)} B ` +
          `(+${String(withTable - baseline)})\n`,
      )
      /* 366,768 B before row **D9**. The corrected corner footprint writes
         `"length":1.5` where 245 records said `"length":2` and turns their size
         token from `2x` to `1.5x`, which is +980 B raw and **+40 B brotli** —
         a fact about one artefact at one epoch, never a rate, exactly as B1
         recorded. */
      expect(baseline).toBe(366_682)
      /* 135 rows since row **E3**, not 128: the shipped bundle carries 42
         templates and the counterfactual has to price what would actually be
         emitted. The delta is asserted as a *bound* and printed as a number,
         because the number is a fact about one artefact at one epoch and never a
         rate — D4 measured +4/+8/+12/+40 entries at +227/+3/+115/+176 B, **not
         monotone**, over a 5.9 MB payload. What the assertion has to say is that
         the table is small against the 146 kB of headroom. **+102 B at 128 rows
         and +541 B at 135 is that non-monotonicity again, from the other side:
         seven more rows cost 5.3x the previous 128, because the two authored ids
         are strings the index has never seen while the 40 fixture ids appear in
         nothing it compresses against either — brotli is not additive.** */
      expect(layouts.reduce((total, one) => total + one.slots.length, 0)).toBe(135)
      expect(withTable - baseline).toBe(541)
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
      const greedy = measureGreedy(FIXTURE_RECIPES, ctx.composition)

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
      const greying = measureGreying(FIXTURE_RECIPES, ctx.composition)
      const solver = measureSolver(FIXTURE_RECIPES, index, ctx)

      // The independent walk and the shipped solver, separately, on the same 40.
      expect(greying.completed).toBe(40)
      expect(greying.failures).toEqual([])
      expect(solver.completed).toBe(40)
      expect(solver.failures).toEqual([])
      expect(solver.skipped).toBe(23)

      process.stdout.write(
        `\n[fill] first candidate ${String(measureGreedy(FIXTURE_RECIPES, ctx.composition).completed)}/40 · ` +
          `greying walk ${String(greying.completed)}/40 · solver ${String(solver.completed)}/40 ` +
          `(${String(solver.queries)} queries, ${String(solver.skipped)} candidates refused)\n`,
      )
    })

    it('is refusing a policy failure and not an unsolvable archive', () => {
      const { context: ctx } = ready()
      const search = measureBacktracking(FIXTURE_RECIPES, ctx.composition)

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
      const walk = measureMonotonicity(FIXTURE_RECIPES, index, ctx)

      /* The plan's claim, restated as an observation of the walk the solver
         actually took: **0 of 148 emptied**. The 90 narrowings are the same 90
         the guided flow reports (72 on the first pick, 18 on the second), and
         the 0 rescues are the corner the grammar permits and this archive does
         not contain. */
      expect(walk).toEqual({ observations: 148, emptied: 0, rescued: 0, narrowed: 90 })
    })

    it('drops 36 of those 148 probes as unreachable, and every one of them is inert', () => {
      const { index, context: ctx } = ready()
      const filter = measureFilterSoundness(FIXTURE_RECIPES, index, ctx)

      expect(filter).toEqual({ pairs: 148, probed: 112, dropped: 36, inert: 36 })
    })

    it('costs the queries `SOLVE_QUERIES` names', () => {
      const { index, context: ctx } = ready()
      const solver = measureSolver(FIXTURE_RECIPES, index, ctx)

      expect(solver.queries).toBe(SOLVE_QUERIES)
      // 128 slot resolutions is the floor: one per part, and the rest is the
      // greying rule's probes plus the lazy before-counts.
      expect(solver.queries).toBeGreaterThan(128)
    })

    /* ------------------------------------------------------- the empty sets */

    it('has no template part that is ever empty, and two that offer 308 and 428 items', () => {
      const { context: ctx } = ready()
      const cold = FIXTURE_RECIPES.flatMap((template) =>
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
      const picks = measureBaseLadder(FIXTURE_RECIPES, index, ctx)
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
      const rested = FIXTURE_RECIPES.map((template) => {
        const layout = conventionFor(template.parts.map((part) => part.name))
        if (layout === undefined) throw new Error(`no convention for ${template.id}`)
        return layout.slots.filter((rule) => layout.slots.some((other) => other.restsOn === rule.part)).map((rule) => rule.part)
      })

      expect(new Set(rested.map((parts) => parts.join(',')))).toEqual(new Set(['base']))
      // And the cell the ladder ranks against is the floor, on all 40.
      expect(
        new Set(
          FIXTURE_RECIPES.map(
            (template) => conventionFor(template.parts.map((part) => part.name))?.cell,
          ),
        ),
      ).toEqual(new Set(['floor']))
    })

    /* ------------------------------------------------------ the two preferences */

    it('completes 40 of 40 under every lock preference and under none', () => {
      const { index, context: ctx } = ready()

      for (const lock of [undefined, 'openlock', 'dragonlock', 'magnetic'] as const) {
        const result = measureSolver(FIXTURE_RECIPES, index, { composition: ctx.composition, lock })
        expect(result.completed, `lock ${String(lock)}`).toBe(40)
      }
    })

    it('moves 74 of the 128 slots between the three locks, and not one item', () => {
      const { index, context: ctx } = ready()
      const spread = measureLockSpread(FIXTURE_RECIPES, index, ctx, ['openlock', 'dragonlock', 'magnetic'])

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
        expect(measureSolver(FIXTURE_RECIPES, index, local).completed, family).toBe(40)
        const slots = FIXTURE_RECIPES.flatMap(
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

    it('produces a template that closes geometrically on 36 of the 40, and B2 owns the other 4', () => {
      const { index, context: ctx } = ready()
      const verdicts: Record<string, number> = {}
      const doubts: Record<string, number> = {}
      const failing: string[] = []

      for (const template of FIXTURE_RECIPES) {
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
         one-click default actually *fit*? On **36 of 40** it does, and the 4 that
         do not are the four internal corners, which have no wall part at all and
         so no closure to check.

         **Row D9 closed the other 2.** They were the external-corner
         `single_piece` recipes, whose two walls a `size|width|2` tag made 2 units
         long against a 0.5 column on a 2-unit face. C2's note said *"no choice of
         fill closes those two — the arithmetic is over the tagged widths, which
         every candidate carries"*, and that was right: **no choice of fill could,
         because the tag was wrong.** 157 corner-wall meshes measure the run at
         1.500, so the arithmetic is now over a measured run and closes for every
         candidate rather than for none.

         So a one-click placement no longer arrives with a doubt on it anywhere in
         the archive — `doubts` is empty. C1's and C3's disclosure paths are still
         needed for an *incomplete* fill, which is a different code. */
      expect(verdicts).toEqual({ closes: 36, undecidable: 4 })
      expect(doubts).toEqual({})
      expect(failing).toEqual([])
    })

    /* ------------------------------------------------- row B4's 47 families */

    it('has no convention for any of B4’s 47 generated families, which is why size arrives as refs', () => {
      /* The merge finding, and it corrects this row rather than B4. Every one of
         B4's generated families has **exactly one part** — 17 `wall`, 15
         `floor`, 6 `column`, 3 `stair`, 2 `riser`, 2 `roof`, 1 `decor`, 1
         `base` — and it declines a layout deliberately, with four measurements
         behind it. (51 families and 19/17 walls and floors until row D1 denied
         `shape|base` on every family and dropped the four whose whole
         population was bases.) So none of them has a part-name set `rules.ts` has a
         convention for, there is no anchor, and B3's per-slot derivation cannot
         fire: `FillContext.cell` narrows **nothing** on any palette row C1 is
         building. `FillContext.size` is what this measurement bought. */
      expect(GENERATED_FAMILIES).toHaveLength(47)
      expect(GENERATED_FAMILIES.filter((family) => family.parts.length !== 1)).toEqual([])
      expect(
        GENERATED_FAMILIES.filter(
          (family) => conventionFor(family.parts.map((part) => part.name)) !== undefined,
        ),
      ).toEqual([])
      // And the 40 shipped recipes are untouched by B4's arrival: a separate
      // export, still 40 templates over 128 parts. Row E3 appended two more to
      // `RECIPE_TEMPLATES`, which is a different merge and asserted separately.
      expect(FIXTURE_RECIPES).toHaveLength(40)
      expect(FIXTURE_RECIPES.flatMap((template) => template.parts)).toHaveLength(128)
      expect(RECIPE_TEMPLATES).toHaveLength(42)
      expect(RECIPE_TEMPLATES.flatMap((template) => template.parts)).toHaveLength(135)
    })

    it('fills all 47 generated families, at every one of their 303 size options', () => {
      const { index, context: ctx } = ready()
      let options = 0
      const unfilled: string[] = []

      for (const family of GENERATED_FAMILIES) {
        // With no size asked for at all — the palette's own default.
        if (!solveTemplateFills(family, index, ctx).complete) unfilled.push(`${family.id} / no size`)
        for (const option of GENERATED_FAMILY_SIZES[family.id] ?? []) {
          options += 1
          const fill = solveTemplateFills(family, index, { ...ctx, size: option.tags })
          if (!fill.complete) unfilled.push(`${family.id} / ${option.label}`)
        }
      }

      /* The acceptance measurement for C1's palette: every row, at every size
         its control offers, places filled. 304 options over 47 families, and
         7 of those families offer nothing but *any size* — an empty domain,
         which B3 predicted for 5 — so the no-tags option is exercised 47 times
         over.

         `unfilled` being empty is also what settled row D1's judgement call:
         four families admitted nothing but bases, so denying the base left them
         admitting nothing, and a family that admits nothing arrives here as a
         row that cannot be filled at any size. They are dropped from the
         generator instead, and their records are reached through `shape-base`.
         (350 over 51 with 8 empty domains before that row.) */
      /* 304 before row **D9**, and the one it lost is `wall-corner-s2w`'s
         *"2 wide"*: no corner wall is 2 units long, so that position had no
         geometry behind it. Its records fold into the family's existing
         *"1.5 wide"*. The `2 wide by 2 deep` position stays — those are the 21
         `grate+widened.2x2` cells, measured at 2.000 x 2.000 and genuinely
         whole-cell. */
      expect(options).toBe(303)
      expect(unfilled).toEqual([])
      expect(
        Object.values(GENERATED_FAMILY_SIZES).filter((sizes) => sizes.length === 1),
      ).toHaveLength(7)
    })

    /* --------------------------------------------------------- the scene scale */

    it('re-solves a 250-instance room inside a frame, and only because it memoises', () => {
      const { index, context: ctx } = ready()
      const room = Array.from(
        { length: 250 },
        (_, at) => FIXTURE_RECIPES[at % FIXTURE_RECIPES.length] as AssemblyTemplate,
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

/* ============================================================== row E3's half */

/**
 * The **two authored assemblies** against the same archive.
 *
 * Row E3 shares this directory with B2's slot geometry and C2's fill solver and
 * shares its populations with neither, for the reason the module docblock gives:
 * every figure above is a measurement of upstream's 40, and this block is a
 * measurement of the two this repo authored. `pipeline/authored.test.ts` proves
 * they are exactly the documented difference from a shipped fixture slot; this is
 * where they meet the corpus.
 *
 * ## The gate, and why it is the whole block
 *
 * An assembly that ships without being resolved against the real archive is a
 * palette row that may arrive broken — row B4's own lesson, and the shape it used:
 * resolve every authored slot through `src/composition`'s postings, **compare the
 * admitted set to what was meant**, then run it through the greedy walk, the
 * greying walk, `solveTemplateFills` and `placeTemplateSlots`, requiring
 * `complete` and a non-`fails` verdict. All five are below, in that order.
 *
 * The comparison is the part that cannot be skipped. Every other step would pass
 * on a slot that admits twice what its author intended — the fill completes, the
 * layout closes, and the palette row silently offers 1,963 bases where twelve were
 * meant. So each admitted set is recomputed straight off the tag table here and
 * compared by identity, not by count.
 */
describeCorpus(
  hasCatalog
    ? "row E3's two authored assemblies against the live archive"
    : `row E3's two authored assemblies — SKIPPED, no ${CATALOG} (run \`npm run import:catalog\`)`,
  () => {
    const catalog = hasCatalog ? CatalogFile.parse(JSON.parse(readFileSync(CATALOG, 'utf8'))) : undefined
    const composition =
      catalog === undefined ? undefined : createCompositionIndex(catalog, buildAggregateIndex(catalog))
    const assembly = catalog === undefined ? undefined : buildAssemblyIndex(catalog)
    const recipes = catalog === undefined ? undefined : createRecipeIndex(catalog)
    const byIdE3 = new Map<string, CatalogRecord>((catalog?.records ?? []).map((one) => [one.id, one]))

    const ready = (): { index: AssemblyIndex; context: FillContext } => {
      if (assembly === undefined || composition === undefined) throw new Error('no catalog')
      return { index: assembly, context: { composition, lock: 'openlock' as const } }
    }

    const WIDENED = 'wall-on-tile-wall-any-modular-any-floor'
    const CORRIDOR_ID = 'wall-on-tile-corridor-any-modular'
    const authoredById = (id: string): RecipeTemplate => {
      const found = AUTHORED.find((template) => template.id === id)
      if (found === undefined) throw new Error(`no authored template ${id}`)
      return found
    }

    /**
     * The tag id one string interns to, or `undefined`.
     *
     * Built once. A per-call sweep of the 930-string table inside a loop over
     * 8,702 records is a minute of work for an answer that never changes, and
     * this block already pays for two walked populations.
     */
    const idOfTag = new Map<string, number>((catalog?.tags ?? []).map((tag, id) => [tag, id]))
    const carries = (record: CatalogRecord, tag: string): boolean => {
      const id = idOfTag.get(tag)
      return id !== undefined && record.tags.includes(id as never)
    }
    /** The records a predicate over tag strings selects, as an id set. */
    const meant = (predicate: (tags: ReadonlySet<string>) => boolean): ReadonlySet<string> => {
      const table = catalog?.tags ?? []
      return new Set(
        (catalog?.records ?? [])
          .filter((record) => predicate(new Set(record.tags.map((id) => table[id] ?? ''))))
          .map((record) => record.id),
      )
    }
    /** What one slot of one authored template really admits, cold. */
    const admits = (template: RecipeTemplate, part: SlotName): ReadonlySet<string> => {
      const slot = template.parts.find((one) => one.name === part)
      if (slot === undefined || composition === undefined) throw new Error(`no slot ${part}`)
      return new Set(composition.candidatesFor(resolveSlotTags(slot.tags, template.tags, [])).tiles)
    }
    /** Every record any slot of these templates admits, and its designs. */
    const reachOf = (templates: readonly RecipeTemplate[]): { records: number; designs: number } => {
      const ids = new Set<string>()
      for (const template of templates) {
        for (const part of template.parts) for (const tile of admits(template, part.name)) ids.add(tile)
      }
      return {
        records: ids.size,
        designs: new Set([...ids].map((id) => byIdE3.get(id)?.design ?? id)).size,
      }
    }

    /* ------------------------------------------------------------- the reach */

    it(
      'takes the assemblies section from 3,079 / 905 to 4,453 / 1,895, and the widened floor is 1,362 of it',
      () => {
        /* **Both ends re-derived rather than quoted**, which is what D10 asked
           of whoever built this. Its recommendation was priced at 4,441 / 1,893
           and that reproduces to the record; the extra **+12 records over 2
           designs** are the corridor's, and they are the only records in this row
           that the widened floor slot does not already reach — the twelve
           `plain#base+hallway.2x2` bases. **0 of the 40 fixture base slots reach
           one**, measured, and structurally: between them the 40 require exactly
           four `shape|base|` qualifiers — `corner`, `internal_corner`, `square`
           and `wall` — and none of the twelve carries any of them. */
        const forty = reachOf(FIXTURE_RECIPES)
        const widened = reachOf([...FIXTURE_RECIPES, authoredById(WIDENED)])
        const both = reachOf(RECIPE_TEMPLATES)

        expect(forty).toEqual({ records: 3079, designs: 905 })
        expect(widened).toEqual({ records: 4441, designs: 1893 })
        expect(both).toEqual({ records: 4453, designs: 1895 })

        expect(widened.records - forty.records).toBe(1362)
        expect(widened.designs - forty.designs).toBe(988)
        expect(both.records - widened.records).toBe(12)
        expect(both.designs - widened.designs).toBe(2)

        const total = catalog?.records.length ?? 1
        const designs = new Set((catalog?.records ?? []).map((one) => one.design)).size
        expect(forty.records / total).toBeCloseTo(0.354, 3)
        expect(both.records / total).toBeCloseTo(0.512, 3)
        expect(forty.designs / designs).toBeCloseTo(0.237, 3)
        expect(both.designs / designs).toBeCloseTo(0.496, 3)

        process.stdout.write(
          `\n[E3] assemblies reach ${String(forty.records)}/${String(forty.designs)} -> ` +
            `${String(both.records)}/${String(both.designs)}\n`,
        )
      },
      SLOW_MS,
    )

    it('adds nothing for `shape|base|square` on the widened base, which D10 flagged as the one exception', () => {
      /* D10 §4 measured A8 and A9 reaching 281 and 75 records A1 does not, and
         flagged `shape|base|square` as possibly the one base predicate worth
         having. **Re-measured on this tree it is not**: it widens the base pool
         from 48 files to 337 and adds **+0 records and +0 designs**, because those
         bases are already the single-piece wall recipe's own base slot. It also
         costs something: the solver's pick becomes a **2 x 1** cell where the
         shipped base gives 2 x 2, so the default a click produces is a sliver. So
         the base slot comes across from the fixture unchanged. */
      const widened = authoredById(WIDENED)
      const square: RecipeTemplate = {
        ...widened,
        id: 'a8-probe',
        parts: widened.parts.map((part) =>
          part.name === 'base'
            ? {
                ...part,
                tags: {
                  ...part.tags,
                  require: [{ tag: 'shape|base' }, { tag: 'shape|base|square' }],
                },
              }
            : part,
        ),
      }
      const forty = reachOf(FIXTURE_RECIPES)
      expect(reachOf([...FIXTURE_RECIPES, square])).toEqual(reachOf([...FIXTURE_RECIPES, widened]))
      expect(reachOf([...FIXTURE_RECIPES, square]).records - forty.records).toBe(1362)
      expect(admits(square, 'base').size).toBe(337)
      expect(admits(widened, 'base').size).toBe(48)
    })

    /* ------------------------------- the gate, step 1: what the slots admit */

    it('admits exactly what each authored slot means, on all 7 of them', () => {
      const widened = authoredById(WIDENED)
      const corridor = authoredById(CORRIDOR_ID)
      const shipped = FIXTURE_RECIPES.find(
        (template) => template.name === 'S2W: Wall on Tile: Wall (Any, Modular)',
      )
      if (shipped === undefined) throw new Error('no shipped (Any, Modular)')

      /* The wall predicate, shared by all three wall slots in this row: the
         shipped `(Any, Modular)` wall plus D1's `deny shape|base`. 1,330 files,
         and the 278 the deny costs are the whole difference from the shipped
         slot's 1,608 — **not** the `connection|side` constrain, which D10 §3.3
         credits and which cannot narrow a cold pool at all: a `constrain` block
         collects from the parent and the siblings, cold there are no siblings, and
         a template parent carries no `connection|` tag on any of the 42. */
      const wallPool = meant(
        (tags) =>
          tags.has('build|separate wall') &&
          tags.has('shape|wall') &&
          !tags.has('shape|curved') &&
          !tags.has('size|width|1.5') &&
          !tags.has('shape|base'),
      )
      expect(admits(widened, 'wall')).toEqual(wallPool)
      expect(admits(corridor, 'right wall')).toEqual(wallPool)
      expect(admits(corridor, 'left wall')).toEqual(wallPool)
      expect(wallPool.size).toBe(1330)
      expect(admits(shipped, 'wall').size).toBe(1608)
      expect([...admits(shipped, 'wall')].filter((id) => !wallPool.has(id))).toHaveLength(278)

      /* The widened floor: `shape|floor` denying `shape|base`, and nothing else.
         88 files on the shipped slot, 1,496 here — the whole of the row's gain. */
      expect(admits(widened, 'floor')).toEqual(
        meant((tags) => tags.has('shape|floor') && !tags.has('shape|base')),
      )
      expect(admits(widened, 'floor').size).toBe(1496)
      expect(admits(shipped, 'floor').size).toBe(88)

      // The base comes across unchanged, so it must admit the identical set.
      expect(admits(widened, 'base')).toEqual(admits(shipped, 'base'))
      expect(admits(widened, 'base').size).toBe(48)

      /* The corridor's base: upstream's own corridor piece. 12 records, and the
         predicate reaches all 12 and nothing else. */
      expect(admits(corridor, 'base')).toEqual(
        meant(
          (tags) =>
            tags.has('shape|base') &&
            tags.has('shape|base|hallway') &&
            !tags.has('shape|base|corner') &&
            !tags.has('shape|option|notch'),
        ),
      )
      expect(admits(corridor, 'base').size).toBe(12)

      /* And the corridor's floor: the widened pool minus the three sub-2 depths. */
      expect(admits(corridor, 'floor')).toEqual(
        meant(
          (tags) =>
            tags.has('shape|floor') &&
            !tags.has('shape|base') &&
            !tags.has('size|depth|0.5') &&
            !tags.has('size|depth|1') &&
            !tags.has('size|depth|1.5'),
        ),
      )
      expect(admits(corridor, 'floor').size).toBe(1218)
    })

    /* ------------- the gate, steps 2 to 5: it fills, it walks, and it closes */

    it(
      'fills and closes both, under the solver and under both walks',
      () => {
        const { index, context } = ready()
        for (const template of AUTHORED) {
          const layout = conventionFor(template.parts.map((part) => part.name))
          if (layout === undefined) throw new Error(`no convention for ${template.id}`)

          const fill = solveTemplateFills(template, index, context)
          expect(fill.complete, template.id).toBe(true)
          expect(measureGreying([template], context.composition).completed, template.id).toBe(1)

          const feet = new Map<SlotName, Footprint>()
          for (const [slot, tile] of Object.entries(fill.fills)) {
            const record = index.byId.get(tile)
            if (record !== undefined) feet.set(slot, record.foot)
          }
          const placed = placeTemplateSlots(layout, feet)
          expect(placed.verdict, template.id).toBe('closes')
          expect(placed.doubts, template.id).toEqual([])
          expect(placed.cell, template.id).toEqual({ w: 2, d: 2 })
          expect(placed.slots.map((slot) => slot.part), template.id).toEqual(
            layout.slots.map((rule) => rule.part),
          )
        }

        /* The two differ on the *first-candidate* walk, and the difference is
           worth naming: the corridor completes on it (its 12-record base is
           pinned to 2 x 2, so the greying rule has nothing left to refuse) while
           the widened wall needs greying, exactly as its shipped parent does —
           16 of the 40 fixtures fail the blind walk on the base slot and this is
           a seventeenth of the same kind. */
        expect(measureGreedy([authoredById(CORRIDOR_ID)], ready().context.composition).completed).toBe(1)
        expect(measureGreedy([authoredById(WIDENED)], ready().context.composition).completed).toBe(0)
      },
      SLOW_MS,
    )

    it(
      'walks 263 closes of 323 on the widened wall and 143 of 200 on the corridor',
      () => {
        /* The honest number rather than the solver's single pick, over each row's
           own first-part population — the same walk the 40 are measured on above.

           **D10 measured the corridor at 263 / 25 / 94 of 382 and that figure is
           gone, because it used §3.3's base and floor predicates and both are
           corrected here.** Requiring `shape|base|hallway` takes the walked
           population from 382 to **200**: the 12 hallway bases are all
           `rect 2x2`, so the greying rule refuses every first-part pick that
           would empty the base, and the 59 combinations D10 counted as
           `base: unfilled` and the 123 that resolved to a non-2x2 cell are not
           walked at all. What is left closes at **71.5%**, against `wall-on-tile`'s
           85.7% and `internal-corner`'s 0%, so the shape is a member of the same
           population rather than an easy case.

           The widened wall's 263 is D10's 263 by coincidence of population rather
           than of predicate: its 323 walked combinations are the shipped
           `(Any, Modular)` row's, and re-flooring does not change which wall
           candidates are live. */
        if (recipes === undefined) throw new Error('no catalog')
        const per = new Map<string, Record<string, number>>()
        const cells = new Map<string, Record<string, number>>()
        for (const template of AUTHORED) {
          const one = walk(recipes, byIdE3, [template])
          per.set(template.id, tally(one.map((each) => each.placed.verdict)))
          cells.set(
            template.id,
            tally(one.map((each) => (each.placed.cell === undefined ? '—' : `${String(each.placed.cell.w)}x${String(each.placed.cell.d)}`))),
          )
        }
        expect(per.get(WIDENED)).toEqual({ closes: 263, fails: 25, undecidable: 35 })
        expect(per.get(CORRIDOR_ID)).toEqual({ closes: 143, fails: 25, undecidable: 32 })
        expect(263 / 323).toBeCloseTo(0.814, 3)
        expect(143 / 200).toBeCloseTo(0.715, 3)

        /* Every walked corridor is a 2 x 2 cell, and that is the base doing it:
           its twelve candidates are all `rect 2x2` and its `constrain` collects
           `size|width` and `size|depth` from the walls and the floor, so any pick
           that would make the cell another size empties it and is refused. */
        expect(cells.get(CORRIDOR_ID)).toEqual({ '2x2': 200 })
        expect(cells.get(WIDENED)).toEqual({ '2x2': 200, '3x3': 51, '4x2': 69, '4x4': 3 })

        process.stdout.write(
          `\n[E3] walked closure ${JSON.stringify(Object.fromEntries(per))}\n`,
        )
      },
      SLOW_MS,
    )

    /* --------------------------------------------- the corridor's base slot */

    it('reaches upstream’s own corridor piece, which §3.3’s predicate structurally could not', () => {
      /* The twelve `plain#base+hallway.2x2` bases: `rect 2x2` on all twelve,
         `size|width|2 + size|depth|2` with the inferred `role|floor` and
         `form|straight`, over the connection variants and two designs (the plain
         run and the `+electronics` one). **0 of the 12 carry `shape|base|wall`**,
         which is the tag §3.3's base predicate requires — so that predicate could
         not have reached the one piece in the archive built for this shape, at any
         pool size. */
      const hallway = [...admits(authoredById(CORRIDOR_ID), 'base')].map((id) => byIdE3.get(id))
      expect(hallway).toHaveLength(12)
      expect(new Set(hallway.map((record) => record?.design)).size).toBe(2)
      expect(hallway.filter((record) => record !== undefined && carries(record, 'shape|base|wall'))).toEqual([])
      for (const record of hallway) {
        expect(record?.layer).toBe('base')
        expect(record?.foot).toEqual({ shape: 'rect', w: 2, d: 2 })
      }
      /* And **no fixture base slot reaches one**, which is the structural half of
         why this row's 12 records are new: between them the 40 require exactly
         four `shape|base|` qualifiers and `hallway` is not among them. */
      const corridorBases = admits(authoredById(CORRIDOR_ID), 'base')
      for (const template of FIXTURE_RECIPES) {
        const base = template.parts.find((part) => part.name === 'base')
        if (base === undefined) continue
        expect(
          [...admits(template, 'base')].filter((id) => corridorBases.has(id)),
          template.id,
        ).toEqual([])
      }
      const qualifiers = new Set(
        FIXTURE_RECIPES.flatMap((template) => template.parts)
          .filter((part) => part.name === 'base')
          .flatMap((part) => (part.tags.require ?? []).map((ref) => ref.tag))
          .filter((tag) => tag.startsWith('shape|base|')),
      )
      expect([...qualifiers].sort()).toEqual([
        'shape|base|corner',
        'shape|base|internal_corner',
        'shape|base|square',
        'shape|base|wall',
      ])
    })

    it('has no expressible fallback to `shape|base|wall`, because `require` is an intersection', () => {
      /* Asked for as *"is admitting `shape|base|wall` as a fallback better or
         merely wider"*, and the answer is that it is **neither, because it is not
         expressible**. `candidates.ts` sorts the posting lists and intersects
         them, so a slot's `require` is a conjunction and `hallway OR wall` has no
         form in this grammar. The two things that *are* expressible:

           - `shape|base|hallway` — 12 files, the corridor bases;
           - `shape|base|wall` — 305 files, and **0 of them a corridor base**;

         and their intersection is empty, which is the measurement that makes
         "fallback" impossible rather than unwise. The only widening available is
         dropping the qualifier to bare `shape|base`, which is a different slot:
         1,918 files after the shipped denies, none of them chosen for a corridor,
         and it takes this row's marginal reach from +12 records to +2,251 by
         admitting every square and corner base in the archive as a corridor
         floor's support. */
      const hallway = meant((tags) => tags.has('shape|base|hallway'))
      const wall = meant((tags) => tags.has('shape|base|wall'))
      expect(hallway.size).toBe(12)
      expect(wall.size).toBe(305)
      expect([...hallway].filter((id) => wall.has(id))).toEqual([])
    })

    /* ------------------------------------------ the corridor's floor slot */

    it('has 270 rect floors over 187 designs that close a solid block of wall', () => {
      /* **The check that decides whether this row is honest.** Over the widened
         floor pool — 1,496 records, 1,224 `rect` and 272 not — the depth axis
         splits like this, and the walkable width is `depth - 1` because two
         half-unit walls eat one unit of depth between them:

         | depth | rect floors | designs | walkable across |
         | ---: | ---: | ---: | ---: |
         | 1 | **270** | 187 | **0.0 — the two walls meet** |
         | 2 | 564 | 455 | 1.0 (25.4 mm, one 25 mm mini base) |
         | 3 | 103 | 80 | 2.0 |
         | 4 | 252 | 199 | 3.0 |
         | 6 | 20 | 8 | 5.0 |
         | 8 | 15 | 5 | 7.0 |

         So **954 of the 1,224 rect floors, over 747 designs, are usable** — and
         the axis has to be *depth* and not the smallest dimension. A `1 x 2` floor
         has a smallest dimension of 1 and is a one-unit corridor segment; a
         `2 x 1` is the solid one. The min-dimension reading gives **943 / 736** and
         is wrong. */
      const floors = (catalog?.records ?? []).filter(
        (record) => carries(record, 'shape|floor') && !carries(record, 'shape|base'),
      )
      expect(floors).toHaveLength(1496)
      const rects = floors.filter((record) => record.foot.shape === 'rect')
      expect(rects).toHaveLength(1224)
      expect(tally(floors.filter((record) => record.foot.shape !== 'rect').map((record) => record.foot.shape))).toEqual(
        { none: 163, arc: 56, wall: 44, tri: 9 },
      )
      expect(tally(rects.map((record) => (record.foot.shape === 'rect' ? record.foot.d : 0)))).toEqual({
        '1': 270,
        '2': 564,
        '3': 103,
        '4': 252,
        '6': 20,
        '8': 15,
      })

      const usable = rects.filter((record) => record.foot.shape === 'rect' && record.foot.d > 1)
      expect(usable).toHaveLength(954)
      expect(new Set(usable.map((record) => record.design)).size).toBe(747)

      // The reading #135 corrects, kept because the two disagree and the
      // disagreement is the finding.
      const minDim = rects.filter(
        (record) => record.foot.shape === 'rect' && Math.min(record.foot.w, record.foot.d) > 1,
      )
      expect(minDim).toHaveLength(943)
      expect(new Set(minDim.map((record) => record.design)).size).toBe(736)
    })

    it('agrees between a floor’s depth tag and its footprint on 1,224 of 1,224, circularly', () => {
      /* `docs/tile-sizing.md`'s closing rule is that *a size tag is a claim about
         a piece; only a mesh is a measurement of one*, and the deny this row ships
         is a **tag** predicate. So: does the tag agree with the footprint? On every
         rect floor in the pool, with no exception and none missing a depth tag.

         **And the agreement is partly circular, which is the honest half.**
         `pipeline/footprint.ts` derives a `rect`'s `d` *from* `size|depth`, so this
         measures that the derivation is total over this population rather than that
         the archive's meshes are 2 units deep. D9's mesh-versus-tag exception was
         corner **walls** — `footprint.ts#cornerWallRun`, where 245 records tagged
         `size|width|2` measure 1.500 — and it is a wall correction: no floor
         footprint is measured anywhere in this pipeline, so floors carry no such
         exception and the deny is exactly as good as the tag. */
      const table = catalog?.tags ?? []
      let checked = 0
      for (const record of catalog?.records ?? []) {
        if (!carries(record, 'shape|floor') || carries(record, 'shape|base')) continue
        if (record.foot.shape !== 'rect') continue
        const depth = record.tags
          .map((id) => table[id] ?? '')
          .filter((tag) => tag.startsWith('size|depth|'))
          .map((tag) => Number(tag.slice('size|depth|'.length)))
        expect(depth, record.id).toHaveLength(1)
        expect(depth[0], record.id).toBe(record.foot.d)
        checked += 1
      }
      expect(checked).toBe(1224)
    })

    it('cannot see the 272 non-rect floors, and does not need to', () => {
      /* The deny removes only the **8** non-`rect` floors that happen to carry
         `size|depth|1`; 264 survive it. That is sound rather than lucky:
         `cellExtentOf` refuses anything but a `rect` as a cell, so a corridor
         filled with one of them is `undecidable` on `floor: no-cell` (or
         `no-footprint` for the 163 `{shape:'none'}`) and can never be a false
         `closes`. The deny is about the population the closure check *can* be
         fooled by. */
      const corridorFloors = [...admits(authoredById(CORRIDOR_ID), 'floor')].map((id) => byIdE3.get(id))
      expect(corridorFloors).toHaveLength(1218)
      const nonRect = corridorFloors.filter((record) => record?.foot.shape !== 'rect')
      expect(nonRect).toHaveLength(264)

      const layout = conventionFor(authoredById(CORRIDOR_ID).parts.map((part) => part.name))
      if (layout === undefined) throw new Error('no corridor convention')
      const verdicts = nonRect.map((record) => {
        const feet = new Map<SlotName, Footprint>([
          ['base', { shape: 'rect', w: 2, d: 2 }],
          ['floor', record?.foot ?? { shape: 'none' }],
          ['right wall', { shape: 'wall', length: 2 }],
          ['left wall', { shape: 'wall', length: 2 }],
        ])
        return placeTemplateSlots(layout, feet).verdict
      })
      expect(new Set(verdicts)).toEqual(new Set(['undecidable']))
    })

    /* ----------------------------------------- the convention-level check */

    it('raises `no-walk` on every unusable floor the deny would let through, and on none it keeps', () => {
      /* The two mechanisms, each measured with the other removed — which is what
         says neither is load-bearing alone. Take every candidate the floor slot
         admits, put a wall as wide as the floor on each of the two `z` faces, and
         ask `placeTemplateSlots`:

           - **without the deny**, 270 of the 1,496 come out `no-walk` — exactly
             the depth-1 rect floors, over 187 designs. Every one of them would
             otherwise be `closes` with an empty doubt list.
           - **with it**, 0 of the 1,218 do.

         So the predicate is enough to ship correctly, and the convention-level
         check is what makes any *future* convention with two opposed edges safe
         without anybody re-deriving this table. */
      const layout = conventionFor(authoredById(CORRIDOR_ID).parts.map((part) => part.name))
      if (layout === undefined) throw new Error('no corridor convention')

      const census = (pool: ReadonlySet<string>): { noWalk: number; designs: number; closes: number } => {
        let noWalk = 0
        let closes = 0
        const designs = new Set<string>()
        for (const id of pool) {
          const record = byIdE3.get(id)
          if (record === undefined) continue
          const run = record.foot.shape === 'rect' ? record.foot.w : 2
          const placed = placeTemplateSlots(
            layout,
            new Map<SlotName, Footprint>([
              ['base', { shape: 'rect', w: 2, d: 2 }],
              ['floor', record.foot],
              ['right wall', { shape: 'wall', length: run }],
              ['left wall', { shape: 'wall', length: run }],
            ]),
          )
          if (placed.doubts.some((doubt) => doubt.code === 'no-walk')) {
            noWalk += 1
            designs.add(record.design)
          } else if (placed.verdict === 'closes') closes += 1
        }
        return { noWalk, designs: designs.size, closes }
      }

      const widenedFloors = admits(authoredById(WIDENED), 'floor')
      const corridorFloors = admits(authoredById(CORRIDOR_ID), 'floor')
      const without = census(widenedFloors)
      const with_ = census(corridorFloors)

      expect(without.noWalk).toBe(270)
      expect(without.designs).toBe(187)
      expect(with_.noWalk).toBe(0)

      process.stdout.write(
        `\n[E3] no-walk: ${String(without.noWalk)} of ${String(widenedFloors.size)} floors without the deny, ` +
          `${String(with_.noWalk)} of ${String(corridorFloors.size)} with it\n`,
      )
    })

    it(
      'cannot fire on any of the 1,215 combinations of the 40 fixtures',
      () => {
        /* Structural rather than lucky, and asserted against the archive rather
           than against the conventions: `no-walk` needs two `edge` slots two
           quarter-turns apart, and no shipped convention has one. So this check
           moves nothing that was measured before it — the 1,014 / 25 / 176 split
           above is byte-identical with and without it. */
        if (recipes === undefined) throw new Error('no catalog')
        const fixtures = walk(recipes, byIdE3, FIXTURE_RECIPES)
        expect(fixtures).toHaveLength(1215)
        expect(
          fixtures.filter((one) => one.placed.doubts.some((doubt) => doubt.code === 'no-walk')),
        ).toEqual([])
      },
      SLOW_MS,
    )
  },
)
