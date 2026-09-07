/**
 * The size predicate: its arithmetic, its agreement with B2's geometry, and the
 * measurement that settles *exact* against *compatible*.
 *
 * `pipeline/size.test.ts` owns the corpus figures for the **resolution** — what
 * cell each of the 8,702 records occupies — because that module is in the node
 * project and this file is in the app project. What can only be measured here is
 * the predicate against the *templates*: `assemblyState` and `RECIPE_TEMPLATES`
 * are both under `src/`, and B2's walk is the only population in the repository
 * that can say whether an exact size requirement admits the fills the layout can
 * actually place.
 *
 * The archive block skips **loudly** without `public/catalog/catalog.json`,
 * naming the path and the command, on `corpus.test.ts`'s argument.
 */
import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { footprintExtent } from '@/builder/canvas'
import type { CatalogRecord, Footprint } from '@/catalog'
import { CatalogFile, WALL_THICKNESS_UNITS } from '@/catalog'
import type { AssemblyChoice, RecipeIndex, RecipeTemplate } from '@/assembly/recipeWalk'
import { assemblyState, createRecipeIndex } from '@/assembly/recipeWalk'
import { RECIPE_TEMPLATES } from '@/assembly/templates'

import { edgeRun, placeTemplateSlots } from './offsets'
import type { SlotName, SlotRule, TemplateLayout } from './rules'
import { EXTERNAL_CORNER, INTERNAL_CORNER, WALL_ON_TILE, conventionFor, ruleFor } from './rules'
import type { GridSize, SizePredicate } from './size'
import {
  GRID_UNITS,
  LATTICE_TOLERANCE_UNITS,
  RUN_DENY_TAGS,
  cornerSpanOf,
  faceSpan,
  formatUnits,
  isOnLattice,
  latticeDistance,
  layoutSizePredicates,
  sizeAdmits,
  sizeRefs,
  sizeRefsResolve,
  sizeSentence,
  slotSizePredicate,
  snapToLattice,
} from './size'

/* ------------------------------------------------------------- the arithmetic */

describe('the lattice', () => {
  it('snaps the two measured curved-interface runs back to their tagged value', () => {
    /* The whole reason a tolerance exists. Without it `AxG`'s cell is 1.991
       units wide, which is a size no slot can ask for, on a wall that fills a
       2-unit face. */
    expect(snapToLattice(1.991)).toBe(2)
    expect(snapToLattice(1.547)).toBe(1.5)
    expect(isOnLattice(1.991)).toBe(true)
    expect(isOnLattice(1.547)).toBe(true)
  })

  it('refuses the nearest thing that must not snap', () => {
    /* The 45 degree sector `1.5-2 @45`, whose box is 0.939 x 1.414. Its worst
       axis is 0.0858 off the lattice — 1.8x the tolerance — so the interval the
       tolerance sits in is empty in both directions. */
    expect(latticeDistance(0.939)).toBeCloseTo(0.061, 3)
    expect(latticeDistance(1.414)).toBeCloseTo(0.086, 3)
    expect(isOnLattice(1.414)).toBe(false)
    expect(LATTICE_TOLERANCE_UNITS).toBeLessThan(0.0858)
    expect(LATTICE_TOLERANCE_UNITS).toBeGreaterThan(0.047)
  })

  it('keeps the half-unit tail a predicate over integers would lose', () => {
    for (const value of [0.5, 1.5, 2.5, 3.5]) expect(snapToLattice(value)).toBe(value)
    expect(GRID_UNITS).toBe(0.5)
    expect(formatUnits(0.5)).toBe('0.5')
    expect(formatUnits(2)).toBe('2')
    expect(formatUnits(1.5)).toBe('1.5')
  })
})

describe('the predicate a slot carries', () => {
  const cell: GridSize = { w: 2, d: 3 }

  it('is exact congruence for a `cell` anchor', () => {
    const rule = { part: 'floor', anchor: 'cell', side: 0, restsOn: null } as const
    expect(slotSizePredicate(rule, cell)).toEqual({ kind: 'cell', w: 2, d: 3 })
    /* A 2x2 floor slot must not admit a 4x4 floor — the brief's own test. */
    const two: SizePredicate = { kind: 'cell', w: 2, d: 2 }
    expect(sizeAdmits(two, { w: 2, d: 2, run: 2 })).toBe(true)
    expect(sizeAdmits(two, { w: 4, d: 4, run: 4 })).toBe(false)
    /* And not a transposed one either: 2x3 is not 3x2. A slot's `side` is what
       reaches the other orientation, not a symmetric predicate. */
    expect(sizeAdmits({ kind: 'cell', w: 2, d: 3 }, { w: 3, d: 2, run: 3 })).toBe(false)
  })

  it('is the face it is anchored to for an `edge` anchor, less the corner span', () => {
    const front = { part: 'wall', anchor: 'edge', side: 0, restsOn: 'base' } as const
    const flank = { part: 'wall', anchor: 'edge', side: 1, restsOn: 'base' } as const
    expect(slotSizePredicate(front, cell)).toEqual({ kind: 'run', run: 2 })
    expect(slotSizePredicate(flank, cell)).toEqual({ kind: 'run', run: 3 })
    /* A corner sibling takes half a unit off both of the faces it touches, which
       is the arithmetic `offsets.ts` closes on. */
    expect(slotSizePredicate(front, cell, GRID_UNITS)).toEqual({ kind: 'run', run: 1.5 })
    expect(faceSpan(cell, 2)).toBe(2)
    expect(faceSpan(cell, 3)).toBe(3)
  })

  it('is nothing at all for a `corner` anchor, and says so', () => {
    const rule = { part: 'column', anchor: 'corner', side: 0, restsOn: 'base' } as const
    expect(slotSizePredicate(rule, cell)).toEqual({ kind: 'none' })
    expect(sizeAdmits({ kind: 'none' }, undefined)).toBe(true)
    expect(sizeSentence({ kind: 'none' })).toBe('any size')
  })

  it('refuses a fill with no resolved size, except under `none`', () => {
    expect(sizeAdmits({ kind: 'cell', w: 2, d: 2 }, undefined)).toBe(false)
    expect(sizeAdmits({ kind: 'run', run: 2 }, undefined)).toBe(false)
    /* A cell with no run cannot fill an edge: it has no face to lie along. */
    expect(sizeAdmits({ kind: 'run', run: 2 }, { w: 2, d: 2, run: null })).toBe(false)
    expect(sizeAdmits({ kind: 'cell', w: 2, d: 2 }, { w: 2, d: 2, run: null })).toBe(true)
  })
})

describe('the refs a predicate resolves to', () => {
  it('spells a cell as the tagged pair and a run as the width plus two denies', () => {
    expect(sizeRefs({ kind: 'cell', w: 2, d: 1.5 })).toEqual({
      require: ['size|width|2', 'size|depth|1.5'],
      deny: [],
    })
    expect(sizeRefs({ kind: 'run', run: 3 })).toEqual({
      require: ['size|width|3'],
      deny: RUN_DENY_TAGS,
    })
    expect(sizeRefs({ kind: 'none' })).toEqual({ require: [], deny: [] })
  })

  it('denies the three tags that make a `size|width` mean something else', () => {
    /* `shape|corner` is row **D9**'s: 245 corner walls are tagged
       `size|width|2` and measure 1.500, so a `run: 2` ref that did not deny it
       would offer a 1.5 wall for a 2-unit face. See `size.ts#RUN_DENY_TAGS` for
       what the third entry costs (595 records unreachable by a run ref) and why
       that is affordable (no shipped path was reaching them through one). */
    expect(RUN_DENY_TAGS).toEqual([
      'shape|angled|right',
      'shape|option|curved_interface',
      'shape|corner',
    ])
  })

  it('asks the vocabulary rather than holding one', () => {
    const has = (tag: string): boolean => ['size|width|2', 'size|depth|2', ...RUN_DENY_TAGS].includes(tag)
    expect(sizeRefsResolve({ kind: 'cell', w: 2, d: 2 }, has)).toBe(true)
    expect(sizeRefsResolve({ kind: 'cell', w: 2, d: 9 }, has)).toBe(false)
    expect(sizeRefsResolve({ kind: 'run', run: 2 }, has)).toBe(true)
    expect(sizeRefsResolve({ kind: 'run', run: 9 }, has)).toBe(false)
    /* A `none` predicate needs no ref at all, so it resolves against an empty
       vocabulary. That is what makes a corner slot generable. */
    expect(sizeRefsResolve({ kind: 'none' }, () => false)).toBe(true)
  })
})

describe('the run is the cell’s own width, or there is no run', () => {
  const feet: readonly Footprint[] = [
    { shape: 'rect', w: 2, d: 3 },
    { shape: 'wall', length: 4 },
    { shape: 'column' },
    { shape: 'tri', leg: 2 },
    { shape: 'diag', run: 2.828 },
    { shape: 'arc', rIn: 2, rOut: 2.5, sweep: 90, band: 'concave', bandBasis: 'measured' },
    { shape: 'none' },
  ]

  it('agrees with `offsets.ts#edgeRun` on every case of `Footprint`', () => {
    /* The identity that lets **one** resolved size answer both a `cell` and a
       `run` predicate: wherever B2's `edgeRun` gives a number, it is the `w` of
       the piece's own extent, and wherever it gives `null` the piece has no
       axis-aligned face to lie along. Asserted over all seven cases so a new
       primitive cannot quietly break it. */
    for (const foot of feet) {
      const run = edgeRun(foot)
      const extent = footprintExtent(foot)
      if (run === null) continue
      expect(extent).toBeDefined()
      expect(run).toBe(extent?.w)
    }
    expect(feet.filter((foot) => edgeRun(foot) !== null)).toHaveLength(3)
    expect(edgeRun({ shape: 'column' })).toBe(WALL_THICKNESS_UNITS)
  })

  it('has the three refusals be the three whose extent is not a grid box', () => {
    /* `diag`'s extent is along its own 45 degree axes, `tri` presents a
       hypotenuse and `arc` meets a face at a tangent. All three have an extent
       and none of them has a run, which is why the run cannot be derived from
       the extent alone. */
    expect(edgeRun({ shape: 'diag', run: 2.828 })).toBeNull()
    expect(edgeRun({ shape: 'tri', leg: 2 })).toBeNull()
    expect(edgeRun({ shape: 'arc', rIn: 2, rOut: 2.5, sweep: 90, band: 'concave', bandBasis: 'measured' })).toBeNull()
    for (const foot of feet.filter((one) => one.shape !== 'none'))
      expect(footprintExtent(foot)).toBeDefined()
  })
})

describe('a layout’s predicates come from one cell', () => {
  it('gives the 32 wall recipes one cell requirement and one run', () => {
    const predicates = layoutSizePredicates(WALL_ON_TILE, { w: 2, d: 2 })
    expect(predicates).toEqual([
      { part: 'base', anchor: 'cell', size: { kind: 'cell', w: 2, d: 2 } },
      /* `residual` and it asks for the **cell**, which is deliberate and is the
         next case's subject: the floor is *drawn* at what the wall leaves and
         *selected* by its own tags, and an `s2w` floor's tags name its tile. */
      { part: 'floor', anchor: 'residual', size: { kind: 'cell', w: 2, d: 2 } },
      { part: 'wall', anchor: 'edge', size: { kind: 'run', run: 2 } },
    ])
    expect(cornerSpanOf(WALL_ON_TILE)).toBe(0)
  })

  it('asks the cell of a `residual` slot, not the residual, so the tags can answer', () => {
    /* The shared branch in `slotSizePredicate`, asserted rather than left to look
       like an oversight. A `residual` slot is drawn at what the walls leave and
       selected by what its tags say, and for an `s2w` floor those are two
       different numbers: 1.5 x 1.5 of geometry behind a `size|width|2 +
       size|depth|2` pair. Asking the archive for the residual would ask for a
       `size|width|1.5` floor to fill a 2 x 2 recipe, and every one of the 88
       `shape|floor|wall` and 41 `shape|floor|corner` records is tagged at its
       tile size instead — so the pool would be empty. */
    const cell = { w: 2, d: 2 }
    const floor = ruleFor(WALL_ON_TILE, 'floor')
    const base = ruleFor(WALL_ON_TILE, 'base')
    expect(floor?.anchor).toBe('residual')
    expect(base?.anchor).toBe('cell')
    expect(slotSizePredicate(floor as SlotRule, cell)).toEqual(slotSizePredicate(base as SlotRule, cell))
    expect(slotSizePredicate(floor as SlotRule, cell)).toEqual({ kind: 'cell', w: 2, d: 2 })
  })

  it('takes the column’s half unit off both walls of an external corner', () => {
    expect(cornerSpanOf(EXTERNAL_CORNER)).toBe(GRID_UNITS)
    const predicates = layoutSizePredicates(EXTERNAL_CORNER, { w: 2, d: 2 })
    const runs = predicates.filter((one) => one.anchor === 'edge').map((one) => one.size)
    expect(runs).toEqual([
      { kind: 'run', run: 1.5 },
      { kind: 'run', run: 1.5 },
    ])
    /* And that is exactly the number B2's closure refuses to invent: two 2-unit
       walls plus a 0.5 column cannot share two 2-unit edges, so the fills that
       *would* close a 2x2 external corner are 1.5-unit walls — and the corpus
       has 554 pieces with a 1.5-unit run. The predicate names those; it does not
       fabricate a mitre for the 2-unit ones. */
    expect(predicates.find((one) => one.part === 'column')?.size).toEqual({ kind: 'none' })
  })

  it('gives an internal corner no run requirement at all', () => {
    /* No `edge` slot, so no run, so nothing to close — which is why all 38 of
       B2's internal-corner combinations are `undecidable` rather than fits. */
    const predicates = layoutSizePredicates(INTERNAL_CORNER, { w: 2, d: 2 })
    expect(predicates.filter((one) => one.size.kind === 'run')).toHaveLength(0)
    expect(cornerSpanOf(INTERNAL_CORNER)).toBe(GRID_UNITS)
  })
})

/* ------------------------------------------------------------- the archive */

const CATALOG = 'public/catalog/catalog.json'
const hasCatalog = existsSync(CATALOG)
const describeCorpus = hasCatalog ? describe : describe.skip
const corpusTitle = hasCatalog
  ? 'exact against compatible, over B2’s walked combinations'
  : `size predicate against the archive — SKIPPED, no ${CATALOG} (run \`npm run import:catalog\`)`

/** B2's walk: 1,215 combinations, each through a fresh `assemblyState`. */
const SLOW_MS = 600_000

interface Combination {
  readonly template: RecipeTemplate
  readonly layout: TemplateLayout
  readonly feet: ReadonlyMap<SlotName, Footprint>
}

/**
 * B2's walk, restated.
 *
 * Take **each** live candidate for the first part and the first non-dead-end
 * candidate for every part after it — the same population `corpus.test.ts`
 * measures its 1,006 / 33 / 176 closure split over, so the comparison below is
 * against B2's own numbers and not against a differently-sampled corpus.
 */
function walk(recipes: RecipeIndex, byId: ReadonlyMap<string, CatalogRecord>): readonly Combination[] {
  const out: Combination[] = []
  /* The 40 read from the fixtures, and not row **E3**'s two authored beside
     them: this whole block is a comparison against *B2's own* 1,006 / 33 / 176,
     and folding two more templates into the population would silently redefine
     what the comparison is about. `src/template/corpus.test.ts` walks the
     authored pair separately. */
  for (const template of RECIPE_TEMPLATES.filter((one) => !one.source.startsWith('authored:'))) {
    const layout = conventionFor(template.parts.map((part) => part.name))
    if (layout === undefined) throw new Error(`no convention for ${template.id}`)
    const first = template.parts[0]
    if (first === undefined) continue
    const cold = assemblyState(recipes, template, {})
    const step = cold.steps.find((one) => one.part.name === first.name)
    for (const option of step?.options ?? []) {
      if (option.empties.length > 0) continue
      let choice: AssemblyChoice = { [first.name]: option.variant.id }
      const feet = new Map<SlotName, Footprint>()
      const firstRecord = byId.get(option.variant.id)
      if (firstRecord !== undefined) feet.set(first.name, firstRecord.foot)
      for (const part of template.parts.slice(1)) {
        const state = assemblyState(recipes, template, choice)
        const next = state.steps.find((one) => one.part.name === part.name)
        const live = next?.options.filter((one) => one.empties.length === 0) ?? []
        const pick = live[0] ?? next?.options[0]
        if (pick === undefined) break
        choice = { ...choice, [part.name]: pick.variant.id }
        const record = byId.get(pick.variant.id)
        if (record !== undefined) feet.set(part.name, record.foot)
      }
      out.push({ template, layout, feet })
    }
  }
  return out
}

describeCorpus(corpusTitle, () => {
  const file = hasCatalog ? CatalogFile.parse(JSON.parse(readFileSync(CATALOG, 'utf8'))) : undefined
  const byId = new Map<string, CatalogRecord>((file?.records ?? []).map((record) => [record.id, record]))
  const recipes = file === undefined ? undefined : createRecipeIndex(file)
  const combinations = recipes === undefined ? [] : walk(recipes, byId)

  it('walks the 1,215 combinations B2 measured', () => {
    expect(combinations).toHaveLength(1215)
  })

  it('has the exact run predicate and B2’s closure agree on 1,211 of 1,211 edge slots', () => {
    /* **The measurement that settles the brief's question.** For every edge slot
       of every walked combination, ask two independent things: does the fill's
       run equal the face the rule anchors it to, and what verdict does
       `placeTemplateSlots` reach about that slot. They agree everywhere:

       | run vs the face | B2's doubt | slots |
       | --- | --- | ---: |
       | exact           | none — placed  | **1,034** |
       | not exact       | `over-run`     | 41 |
       | no run at all   | `no-run`       | 104 |
       | no run at all   | `no-footprint` | 32 |

       So exactness is not a second condition layered on the geometry; it *is*
       the geometry's own condition, moved one step earlier into the candidate
       set. A *compatible* reading — the fill fits inside the face — would admit
       the 25 short slots below, every one of which B2 reports as `over-run`. */
    const outcome = new Map<string, number>()
    let short = 0
    let long = 0
    let total = 0

    for (const combination of combinations) {
      const cellFoot = combination.feet.get(combination.layout.cell)
      if (cellFoot === undefined || cellFoot.shape !== 'rect') continue
      const cell: GridSize = { w: cellFoot.w, d: cellFoot.d }
      const span = cornerSpanOf(combination.layout)
      const placed = placeTemplateSlots(combination.layout, combination.feet)

      for (const rule of combination.layout.slots) {
        if (rule.anchor !== 'edge') continue
        total += 1
        const foot = combination.feet.get(rule.part)
        const doubt = placed.doubts.find((one) => one.part === rule.part)
        const verdict = doubt?.code ?? 'placed'
        const run = foot === undefined ? null : edgeRun(foot)
        if (run === null || !isOnLattice(run)) {
          outcome.set(`no run/${verdict}`, (outcome.get(`no run/${verdict}`) ?? 0) + 1)
          expect(doubt).toBeDefined()
          continue
        }
        const predicate = slotSizePredicate(rule, cell, span)
        const snapped = snapToLattice(run)
        const admitted = sizeAdmits(predicate, { w: snapped, d: GRID_UNITS, run: snapped })
        const key = `${admitted ? 'exact' : 'not exact'}/${verdict}`
        outcome.set(key, (outcome.get(key) ?? 0) + 1)
        if (admitted) expect(doubt).toBeUndefined()
        else {
          expect(doubt).toBeDefined()
          if (predicate.kind === 'run' && snapped < predicate.run) short += 1
          else long += 1
        }
      }
    }

    expect(total).toBe(1211)
    /* One row per outcome, and there is **no row where the two disagree** — no
       `exact/<a doubt>` and no `not exact/placed`. */
    expect(Object.fromEntries([...outcome].sort())).toEqual({
      'exact/placed': 1050,
      'no run/no-footprint': 32,
      'no run/no-run': 104,
      'not exact/over-run': 25,
    })
    expect([...outcome.values()].reduce((a, b) => a + b, 0)).toBe(1211)
    /* What a *compatible* predicate would buy, and it is still a loss. Row **D9**
       moved 16 slots from `not exact` to `exact`: the 8 external-corner failures
       counted once per wall, whose runs a `size|width|2` tag made 2 units long
       against a face the column leaves 1.5 of. Measured, the run **is** 1.5, so
       the exact predicate and B2's closure agree on them the way they always
       agreed on everything else.

       All 25 that remain are **short** of the face and none over-runs it, and
       they are exactly the 25 `wall-on-tile` combinations B2 reports as `fails`
       — a 0.5 column filling a wall slot. A "fits inside the face" reading would
       admit all 25 and every one of them arrives as a doubt nobody chose. */
    expect({ short, long }).toEqual({ short: 25, long: 0 })
    expect(short + long).toBe(25)
  }, SLOW_MS)

  it('has `cornerSpanOf` agree with B2’s fill-read reservation on every corner slot', () => {
    /* `cornerSpanOf` reads the *rules* because a generator has no fills yet;
       `offsets.ts#cornerReservation` reads the fills. They must agree or a
       generated run predicate would ask for a face length the layout does not
       close on.

       Row **D9** made the fill-read side *signed* and per-face — a corner sits at
       one end of one face and the other end of its neighbour — so what is
       compared here is the magnitude, which is the quantity a run predicate
       needs. The sum below is over the corner slots rather than over the faces,
       which is exactly `cornerSpanOf`'s own shape. */
    let checked = 0
    for (const combination of combinations) {
      let fromFills = 0
      for (const rule of combination.layout.slots) {
        if (rule.anchor !== 'corner') continue
        const foot = combination.feet.get(rule.part)
        const extent = foot === undefined ? undefined : footprintExtent(foot)
        fromFills += extent?.w ?? WALL_THICKNESS_UNITS
      }
      expect(cornerSpanOf(combination.layout)).toBe(fromFills)
      if (fromFills > 0) checked += 1
    }
    /* The 34 external corners and the 38 internal ones. */
    expect(checked).toBe(72)
  }, SLOW_MS)

  it('has every run the edge pools offer be a lattice value', () => {
    /* The candidate pools rather than the walk: every record any edge slot of
       any of the 40 recipes admits, cold. 5,456 candidate references, 5,071 with
       a run, and the runs are six lattice values — so a generated run predicate
       has a finite, enumerable domain and nothing in it needs rounding. */
    if (recipes === undefined) return
    let poolTotal = 0
    const runs = new Map<string, number>()
    // The 40 fixtures, as everything in this block is — see `walk` above.
    for (const template of RECIPE_TEMPLATES.filter((one) => !one.source.startsWith('authored:'))) {
      const layout = conventionFor(template.parts.map((part) => part.name))
      if (layout === undefined) continue
      for (const step of assemblyState(recipes, template, {}).steps) {
        const rule = layout.slots.find((one) => one.part === step.part.name)
        if (rule?.anchor !== 'edge') continue
        for (const option of step.options) {
          for (const tile of option.tiles) {
            const record = byId.get(tile)
            if (record === undefined) continue
            poolTotal += 1
            const run = edgeRun(record.foot)
            if (run === null || !isOnLattice(run)) continue
            const key = formatUnits(snapToLattice(run))
            runs.set(key, (runs.get(key) ?? 0) + 1)
          }
        }
      }
    }
    expect(poolTotal).toBe(5456)
    expect([...runs.values()].reduce((a, b) => a + b, 0)).toBe(5071)
    expect([...runs.keys()].map(Number).sort((a, b) => a - b)).toEqual([0.5, 1, 1.5, 2, 3, 4])
    /* 1,663 at run 2 before row **D9**, and the 277 that left are corner-wall
       candidate references — the same records, counted once per slot that admits
       them. They are at 1.5 now because that is what the meshes measure, and the
       domain is still the same six lattice values, so nothing about the
       predicate's enumerability changed. Both halves asserted, because a drop at
       2 with no matching rise at 1.5 would mean records had left the pools
       rather than moved within them. */
    expect(runs.get('2')).toBe(1386)
    expect(runs.get('1.5')).toBe(1371)
    expect((runs.get('2') ?? 0) + (runs.get('1.5') ?? 0)).toBe(1663 + 1094)
  }, SLOW_MS)

  it('splits B2’s verdicts 979 / 26 / 138 for `wall-on-tile`, which is not a run comparison', () => {
    /* The brief quotes *"a wall's run equal to the floor cell's width on 980 of
       1,143"*. That figure is B2's per-convention **verdict** split, and the
       distinction matters: of the 164 non-closures, only **26** are a size
       mismatch and 138 are fills with no run to compare at all. So exactness
       costs 26 combinations rather than 164.

       **It was 980 / 25 / 138 until the residual anchor.** The one that moved is
       the 1 x 1 cell whose `wall` slot resolves to
       `rough_stone#column+low.I.openforge.stl`, a `rect 1x1` rather than a
       half-unit run: its run tiles the 1-unit face exactly, so `over-run` never
       saw it, and it ate the cell's whole depth, so the floor was a slab of zero
       extent that the old paired walkability check had no opposed sibling to
       compare against. `offsets.ts#walkability` carries the reasoning and
       `corpus.test.ts` names the combination. */
    const per = new Map<string, Record<string, number>>()
    for (const combination of combinations) {
      const id = conventionFor(combination.template.parts.map((part) => part.name))?.id ?? '?'
      const verdict = placeTemplateSlots(combination.layout, combination.feet).verdict
      const row = per.get(id) ?? { closes: 0, fails: 0, undecidable: 0 }
      row[verdict] = (row[verdict] ?? 0) + 1
      per.set(id, row)
    }
    expect(per.get('wall-on-tile')).toEqual({ closes: 979, fails: 26, undecidable: 138 })
    const wallOnTile = per.get('wall-on-tile')
    const walked = Object.values(wallOnTile ?? {}).reduce((a, b) => a + b, 0)
    expect(walked).toBe(1143)
  }, SLOW_MS)
}, SLOW_MS)
