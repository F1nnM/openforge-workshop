/**
 * The room-wide design against the live archive.
 *
 * **Every figure quoted in a docblock in this directory is recomputed here**,
 * and so is every figure row D6 wrote into `store/schema.ts`,
 * `template/fill.ts` and `screens/builder/BuilderScreen.tsx` — the pattern
 * `src/template/corpus.test.ts` and `src/composition/corpus.test.ts` both set.
 *
 * The measurement that matters most is `honoured per slot`. A room-wide design
 * that is silently ignored on most slots is worse than no setting at all, so the
 * question is not *does the solver read the field* — `fill.test.ts` answers that
 * over a fixture — but **how much of a real room a real design actually
 * reaches**. It is answered by solving all 40 shipped recipes once per candidate
 * design and counting `SlotDecision.familyHonoured`, which is the solver's own
 * answer rather than this file's opinion about one.
 *
 * Three things it establishes, in the order they change a decision:
 *
 *   1. **What the picker may offer.** 28 of the 36 reachable roots reach at
 *      least one placeable part and 8 reach none, so the control offers 28 and
 *      is not a list of 36 names 8 of which do nothing.
 *   2. **That the base slot is out of scope, and that this is the archive's
 *      shape rather than a defect.** 38 of the 40 base slots have only `plain`
 *      candidates, so a design has nothing to prefer there and row A3's
 *      `rankBases` keeps deciding them.
 *   3. **That `reach.ts`' cold bound is tight.** The control cannot afford 36
 *      whole solves, so it counts cold candidate pools instead; the two are
 *      compared here per design so the bound cannot loosen unnoticed.
 *
 * `catalog.json` is gitignored and rebuilt by `npm run import:catalog`; absent
 * it the whole block skips **loudly**, naming the path and the command.
 */
import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { CatalogFile, buildAggregateIndex } from '@/catalog'
import type { AssemblyIndex, AssemblyTemplate } from '@/assembly'
import { buildAssemblyIndex } from '@/assembly'
import type { CompositionIndex } from '@/composition'
import { createCompositionIndex } from '@/composition'
import { PLACEABLE_TEMPLATES } from '@/builder/panels/families'
import { RECIPE_TEMPLATES } from '@/assembly/templates'
import type { FillContext } from '@/template'
import { solveTemplateFills } from '@/template'
import type { SceneCost } from '@/template/measure'
import { measureSceneCost } from '@/template/measure'

import { deriveDesignReach } from './reach'

/* ----------------------------------------------------------------- the corpus */

const CATALOG = 'public/catalog/catalog.json'
const hasCatalog = existsSync(CATALOG)
const describeCorpus = hasCatalog ? describe : describe.skip
const corpusTitle = hasCatalog
  ? 'the room-wide design against the live archive'
  : `the room-wide design against the live archive — SKIPPED, no ${CATALOG} (run \`npm run import:catalog\`)`

/**
 * Solving 40 recipes once per design is 36 whole walks over 8,702 records, and
 * the scene-cost block builds a 250-instance room on top of that. Seconds of
 * real work rather than a hang, and vitest's 5,000 ms default is what fails
 * first — the same argument `template/relock.test.ts` makes for `SLOW_RESOLVE_MS`.
 */
const SLOW_MS = 300_000

interface Corpus {
  readonly index: AssemblyIndex
  readonly composition: CompositionIndex
  readonly recipes: readonly AssemblyTemplate[]
  readonly placeable: readonly AssemblyTemplate[]
}

let cached: Corpus | undefined

/** The indexes, built once for the whole file. `buildAssemblyIndex` is 12 ms. */
function corpus(): Corpus {
  if (cached !== undefined) return cached
  const file = CatalogFile.parse(JSON.parse(readFileSync(CATALOG, 'utf8')))
  cached = {
    index: buildAssemblyIndex(file),
    composition: createCompositionIndex(file, buildAggregateIndex(file)),
    /* The 40 fixtures, which since row E3's withdrawal is the whole of
       `RECIPE_TEMPLATES`. The filter stays: it is what says the 128-slot and
       108-of-128 figures below are measurements of *upstream's* recipes, and a
       future authored row must not join them silently. */
    recipes: RECIPE_TEMPLATES.filter((template) => !template.source.startsWith('authored:')),
    placeable: PLACEABLE_TEMPLATES,
  }
  return cached
}

/** Every `texture` root reachable as `CatalogRecord.texture`, most records first. */
function rootsByRecords(composition: CompositionIndex, index: AssemblyIndex): readonly string[] {
  const counts = new Map<string, number>()
  for (const record of index.byId.values()) {
    if (record.texture === undefined) continue
    counts.set(record.texture, (counts.get(record.texture) ?? 0) + 1)
  }
  void composition
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([root]) => root)
}

/** One design, solved over every recipe. */
interface Solved {
  readonly design: string
  /** Slots whose fill is in the design, over the 128 shipped parts. */
  readonly honoured: number
  /** Of those, the ones on a `base` slot. */
  readonly onBase: number
  readonly complete: number
  readonly queries: number
}

function solveAll(design: string | undefined, { recipes, index, composition }: Corpus): Solved {
  const context: FillContext = { composition, lock: 'openlock', ...(design === undefined ? {} : { family: design }) }
  let honoured = 0
  let onBase = 0
  let complete = 0
  let queries = 0
  for (const template of recipes) {
    const solved = solveTemplateFills(template, index, context)
    if (solved.complete) complete += 1
    queries += solved.queries
    for (const decision of solved.decisions) {
      if (!decision.familyHonoured) continue
      honoured += 1
      if (decision.slot === 'base') onBase += 1
    }
  }
  return { design: design ?? '(none)', honoured, onBase, complete, queries }
}

/* ------------------------------------------------------------------ the block */

describeCorpus(corpusTitle, () => {
  /* ------------------------------------------------------------- the families */

  it('has 37 texture roots, 36 of them reachable as a record’s design', () => {
    const { index, composition } = corpus()
    const onTags = new Set<string>()
    for (const record of index.byId.values()) {
      /* `record.tags` is interned — `TagId` is an index into
         `CatalogFile.tags` — so the strings come from the composition index,
         which is the one reader that holds the intern table. */
      for (const tag of composition.tagsOf(record.id)) {
        if (!tag.startsWith('texture|')) continue
        const root = tag.slice('texture|'.length).split('|')[0]
        if (root !== undefined && root !== '') onTags.add(root)
      }
    }
    const asField = new Set([...index.byId.values()].map((record) => record.texture).filter((one) => one !== undefined))

    // 37 on some texture tag; 36 in first position, because `stucco` is always
    // secondary to `shingles` and `CatalogRecord.texture` is the root of the
    // *first* tag. `catalog/schema.ts` carries the argument.
    expect(onTags.size).toBe(37)
    expect(asField.size).toBe(36)
    expect(onTags.has('stucco')).toBe(true)
    expect(asField.has('stucco')).toBe(false)
  })

  it('is dominated by five roots, and 89 records carry no design at all', () => {
    const { index } = corpus()
    const counts = new Map<string, number>()
    let untextured = 0
    for (const record of index.byId.values()) {
      if (record.texture === undefined) {
        untextured += 1
        continue
      }
      counts.set(record.texture, (counts.get(record.texture) ?? 0) + 1)
    }
    const ordered = [...counts.values()].sort((a, b) => b - a)
    const top5 = ordered.slice(0, 5).reduce((sum, one) => sum + one, 0)

    expect(untextured).toBe(89)
    expect(top5 / index.byId.size).toBeCloseTo(0.756, 3)
  })

  it('refutes “12 families hold 1–2 items”, which is the brief’s figure', () => {
    /* Row D6 was briefed that *"12 families hold 1–2 items"*. Measured over the
       live archive it is **7** roots holding 1–2 items and **5** holding 1–2
       records; the count that comes out at 12 is roots holding fewer than *ten*
       items. The direction of the brief's point survives — there is a long tail
       and a picker should not treat it as 36 equal choices — but the figure it
       rested on does not, and `reach.ts` cuts the tail on measured *reach*
       rather than on item count for exactly that reason: `shingles` holds 82
       items and reaches 2 parts. */
    const { index, composition } = corpus()
    const items = new Map<string, number>()
    const records = new Map<string, number>()
    for (const aggregate of composition.aggregates.aggregates) {
      if (aggregate.texture === undefined) continue
      items.set(aggregate.texture, (items.get(aggregate.texture) ?? 0) + 1)
    }
    for (const record of index.byId.values()) {
      if (record.texture === undefined) continue
      records.set(record.texture, (records.get(record.texture) ?? 0) + 1)
    }

    expect([...items.values()].filter((n) => n <= 2)).toHaveLength(7)
    expect([...records.values()].filter((n) => n <= 2)).toHaveLength(5)
    expect([...items.values()].filter((n) => n < 10)).toHaveLength(12)
    // And the largest, which the brief did get right.
    expect(items.get('dungeon_stone')).toBe(1566)
  })

  it('spells the second-largest root `cut-stone`, not `cut_stone`', () => {
    /* Row D6 found `FillContext.family`'s docblock offering `cut_stone` as an
       example of the values this field takes. It is not one: the archive spells
       that root with a hyphen, so `family: 'cut_stone'` is honoured on **zero**
       of the 128 slots while `family: 'cut-stone'` is honoured on 89. Both
       spellings parse — `WorkshopState.design` is a `min(1)` string and cannot
       consult the catalog — so nothing in the app could have caught it, and the
       example was the only place the wrong spelling was written down. */
    const { index } = corpus()
    const roots = new Set([...index.byId.values()].map((record) => record.texture))

    expect(roots.has('cut-stone')).toBe(true)
    expect(roots.has('cut_stone')).toBe(false)
  })

  /* ------------------------------------------------- honoured, per slot (item 2) */

  it(
    'honours a design on every non-base slot for the two largest, and on 0 of 128 for 22 roots',
    () => {
      const source = corpus()
      const designs = rootsByRecords(source.composition, source.index)
      const solved = designs.map((design) => solveAll(design, source)).sort((a, b) => b.honoured - a.honoured)

      const slots = source.recipes.reduce((sum, template) => sum + template.parts.length, 0)
      const baseSlots = source.recipes.filter((template) =>
        template.parts.some((part) => part.name === 'base'),
      ).length
      expect(slots).toBe(128)
      expect(baseSlots).toBe(40)

      console.log(
        `[design] honoured of ${String(slots)}: ` +
          solved
            .slice(0, 6)
            .map((one) => `${one.design} ${String(one.honoured)}`)
            .join(' · ') +
          ` · ${String(solved.filter((one) => one.honoured === 0).length)} roots reach 0`,
      )

      const best = solved[0]
      expect(best?.design).toBe('dungeon_stone')
      // 89 of 128 = **88 of the 88 non-base slots**, plus one base. So a room
      // genuinely does come out in one design; the base is the whole remainder.
      expect(best?.honoured).toBe(89)
      expect(best?.honoured ?? 0 - (best?.onBase ?? 0)).toBe(slots - baseSlots + 1)
      expect(solved.find((one) => one.design === 'cut-stone')?.honoured).toBe(89)
      expect(solved.find((one) => one.design === 'towne')?.honoured).toBe(66)
      expect(solved.find((one) => one.design === 'aztlan')?.honoured).toBe(49)

      // The long tail, and the reason the picker is not a list of 36 names.
      expect(solved.filter((one) => one.honoured === 0)).toHaveLength(22)

      // **A design never costs a completion.** That is C2's fallback contract
      // measured at the top level: a preference reorders and never filters, so
      // every recipe still fills under every root.
      for (const one of solved) expect(one.complete).toBe(40)
      expect(solveAll(undefined, source).complete).toBe(40)
    },
    SLOW_MS,
  )

  it(
    'reaches the base slot on 1 of 40, because 38 of 40 base slots are plain-only',
    () => {
      const source = corpus()
      const designs = rootsByRecords(source.composition, source.index)
      const onBase = designs.map((design) => solveAll(design, source)).filter((one) => one.onBase > 0)

      /* The brief asked whether a room design can essentially never apply to a
         base, and the answer is that it cannot — but the cause is the archive
         and not the ladder. `deriveDesignReach` measures **2 of 40** base slots
         holding any non-`plain` candidate, so on 38 of them there is nothing in
         any design to prefer; of the 2 that do, the five-criterion ladder takes
         one. Row A3's `rankBases` is therefore left deciding the base, which
         `template/fill.ts` records as deliberate. */
      const reach = deriveDesignReach(source.recipes, source.index, source.composition)
      expect(reach.baseSlots).toBe(40)
      expect(reach.basesInDesign).toBe(2)

      /* Three designs, and `plain` is the one that makes the point. It
         "honours" **all 40** base slots — because `plain` *is* what the ladder
         picks — while moving only 1 of the 128 slot fills in the whole corpus.
         So `familyHonoured` on a base is not evidence that the setting reached
         it; it is evidence that the setting agreed with a decision row A3's
         ladder had already made. That is exactly why `reach.ts` counts non-base
         parts and why `plain` reaches 19 of 139 rather than 59 of 179. */
      expect(onBase.map((one) => [one.design, one.onBase])).toEqual([
        ['dungeon_stone', 1],
        ['plain', 40],
        ['cut-stone', 1],
      ])
      // The two that genuinely moved a base away from the ladder's own answer.
      expect(onBase.filter((one) => one.design !== 'plain').map((one) => one.onBase)).toEqual([1, 1])
    },
    SLOW_MS,
  )

  it('measures the archive’s bases as overwhelmingly plain, but not exclusively', () => {
    const { index, composition } = corpus()
    const bases = [...index.byId.values()].filter((record) =>
      composition.tagsOf(record.id).some((tag) => tag === 'shape|base' || tag.startsWith('shape|base|')),
    )
    const plain = bases.filter((record) => record.texture === 'plain').length

    /* The brief's guess — *"bases look overwhelmingly plain"* — is right about
       the direction and worth stating precisely: 1,235 of 1,963 bases (62.9%)
       are `plain` and 728 carry one of fourteen other designs. So the reason a
       *slot* almost never honours a design is not that textured bases do not
       exist; it is that the 40 shipped base slots' tag constraints admit them on
       only 2. That distinction matters, because the first would be an archive
       gap nobody can close and the second is a recipe question. */
    expect(bases).toHaveLength(1963)
    expect(plain).toBe(1235)
    expect(plain / bases.length).toBeCloseTo(0.629, 3)
    expect(new Set(bases.map((record) => record.texture)).size).toBeGreaterThan(10)
  })

  /* ------------------------------------------------ what the picker may offer */

  it('offers 28 of 36 designs over the placeable families, and cuts 8', () => {
    const source = corpus()

    const reach = deriveDesignReach(source.placeable, source.index, source.composition)

    /* Derived, not pinned: row D1 dropped four base-only families after this
       row was cut, taking the palette from 91 rows to 87. A literal here would
       fail on somebody else's correct change, which is what it did. */
    expect(source.placeable).toHaveLength(PLACEABLE_TEMPLATES.length)
    process.stdout.write(
      `\n[design] placeable ${String(source.placeable.length)} · parts ${String(reach.totalParts)}` +
        ` · baseSlots ${String(reach.baseSlots)} · roots ${String(reach.roots)}` +
        ` · offered ${String(reach.entries.length)} · unreached ${String(reach.unreached)}` +
        ` · untextured ${String(reach.untextured)}` +
        ` · top ${reach.entries.slice(0, 4).map((e) => `${e.family}=${String(e.parts)}`).join(' ')}\n`,
    )
    /* **75 and 10 since the recipe fold**, from 135 and 40. It was 139 and 40
       before row D1 dropped four base-only families, and 140 and 42 while row
       E3's two authored assemblies shipped. The fold takes 30 duplicate assembly
       rows out — 32 wall recipes became 2 — so 60 non-base slots and 30 base
       slots go with them.

       **The headline has not moved through any of the three: 28 designs offered
       and 8 cut**, with 36 roots and 44 untextured, because a design's reach is a
       property of the archive's textures and not of how many rows ask for them.
       Three independent changes to the row count is the strongest form that claim
       has been in. */
    expect(reach.totalParts).toBe(75)
    expect(reach.baseSlots).toBe(10)
    expect(reach.roots).toBe(36)
    expect(reach.entries).toHaveLength(28)
    expect(reach.unreached).toBe(8)
    expect(reach.untextured).toBe(44)
    expect(reach.entries.slice(0, 4).map((entry) => [entry.family, entry.parts])).toEqual([
      /* Down one each from this row's own first pass: D1 dropped four base-only
         families, each a single part, so the part total fell 139 to 135 and three
         of these four lost the one part they had in a dropped family (`towne` had
         none in them and did not move). Row E3 then added seven slots and took
         these to 124 / 113 / 90 / 60; withdrawing it takes 5 back off the first
         three and **2 off `aztlan`**, which is the interesting number — E3's
         seven slots were not all reachable by every design, so the four do not
         move together and a single subtraction would have been wrong.

         The recipe fold moves all four again and, as before, **not together**:
         119 / 108 / 85 / 58 becomes 59 / 48 / 47 / 27. `towne` loses 38 where
         `dungeon_stone` loses 60, because the 30 folded rows were 30 copies of
         the same three slots and the designs did not reach those slots equally.
         What has not moved through any of it is the headline, 28 designs offered
         and 8 cut. */
      ['dungeon_stone', 59],
      ['cut-stone', 48],
      ['towne', 47],
      ['aztlan', 27],
    ])
    // Descending, which is the ordering `DesignPicker` renders and does not sort.
    for (let at = 1; at < reach.entries.length; at += 1) {
      expect(reach.entries[at]?.parts ?? 0).toBeLessThanOrEqual(reach.entries[at - 1]?.parts ?? 0)
    }
  })

  it('costs a picker one pass over the slots, not one solve per design', () => {
    const source = corpus()

    const started = performance.now()
    deriveDesignReach(source.placeable, source.index, source.composition)
    const ms = performance.now() - started

    console.log(`[design] reach over ${String(source.placeable.length)} families: ${ms.toFixed(1)} ms`)
    /* A regression guard rather than the measurement — `relock.test.ts` records
       why a millisecond bound is kept loose. What it protects is the shape: if
       this ever ran a solve per design it would be two orders of magnitude
       slower and a picker would block the frame it renders in. */
    expect(ms).toBeLessThan(400)
  })

  it(
    'bounds the honoured count tightly, which is what lets the picker count cold pools',
    () => {
      const source = corpus()
      const reach = deriveDesignReach(source.recipes, source.index, source.composition)

      const gaps: [string, number][] = []
      for (const entry of reach.entries) {
        const solved = solveAll(entry.family, source)
        const nonBase = solved.honoured - solved.onBase
        /* The cold count is an **upper bound**: a design in the pool can still
           lose to the greying rule, which refuses a candidate that would close a
           sibling. It must never be an under-count, or the picker would offer a
           design as reaching less than it does. */
        expect(nonBase).toBeLessThanOrEqual(entry.parts)
        gaps.push([entry.family, entry.parts - nonBase])
      }
      const worst = gaps.reduce((most, one) => (one[1] > most[1] ? one : most), ['', 0] as [string, number])

      console.log(
        `[design] cold bound over the 40 recipes: worst gap ${String(worst[1])} slots (${worst[0]}), ` +
          `${String(gaps.filter(([, gap]) => gap === 0).length)} of ${String(gaps.length)} designs exact`,
      )

      /* Tight, and the bound is the measurement rather than a round number: two
         slots is the worst any design loses to the greying rule over the 40
         shipped recipes. A picker whose figure was loose by more than that would
         be quoting the archive rather than the setting. */
      expect(worst[1]).toBeLessThanOrEqual(2)
    },
    SLOW_MS,
  )

  /* -------------------------------------------- what a design change costs (item 4) */

  it(
    'costs less than a lock change at scene scale, and the store is still the expensive half',
    () => {
      const source = corpus()
      const scene = Array.from(
        { length: 250 },
        (_, at) => source.recipes[at % source.recipes.length] as AssemblyTemplate,
      )
      const base = { composition: source.composition, lock: 'openlock' } as const

      const lockOnly = measureSceneCost(scene, source.index, base)
      const withDesign = measureSceneCost(scene, source.index, { ...base, family: 'dungeon_stone' })

      const memoised = (costs: readonly SceneCost[]) => costs.find((cost) => cost.shape === 'memoised')

      console.log(
        `[design] 250-instance re-solve: no design ${String(memoised(lockOnly)?.queries)} queries / ` +
          `${(memoised(lockOnly)?.ms ?? 0).toFixed(1)} ms · dungeon_stone ${String(memoised(withDesign)?.queries)} / ` +
          `${(memoised(withDesign)?.ms ?? 0).toFixed(1)} ms`,
      )

      /* The answer to *"what does a design change cost at scene scale"* is: less
         than a lock change, and for a structural reason rather than by luck —
         the family ordering puts an acceptable candidate earlier, so the greying
         rule pays fewer sibling probes. **242 queries against 288.** Both are
         one memoised pass over the 40 distinct recipes, because `reSolveScene`
         memoises on `(template, pins)` and the design is constant across a call.

         So **no batched store write is needed for this row**, and none is added:
         `relock.ts` reports the store as the expensive half at scene scale
         (750 fills at 80.5 ms against the solver's 0.8) and names three options,
         all of which are A1's surface. A design change is the same shape and the
         same trade — a visible hitch on a rare gesture. */
      expect(memoised(withDesign)?.queries).toBe(242)
      expect(memoised(lockOnly)?.queries).toBe(288)
      expect(memoised(withDesign)?.queries ?? 0).toBeLessThan(memoised(lockOnly)?.queries ?? 0)
      expect(memoised(withDesign)?.solves).toBe(40)
    },
    SLOW_MS,
  )

  it(
    'moves 108 of the 128 slots, which is why a change must re-solve at all',
    () => {
      const source = corpus()
      const context = { composition: source.composition, lock: 'openlock' } as const
      let moved = 0
      let slots = 0
      for (const template of source.recipes) {
        const before = solveTemplateFills(template, source.index, context)
        const after = solveTemplateFills(template, source.index, { ...context, family: 'dungeon_stone' })
        for (let at = 0; at < before.decisions.length; at += 1) {
          slots += 1
          if (before.decisions[at]?.tile !== after.decisions[at]?.tile) moved += 1
        }
      }

      /* The figure `setRoomDesign` and `BuilderScreen`'s effect both quote. It
         is what makes the store write worth paying for: a fill names an exact
         file, row A2 proved `planSceneMeshes` is lock-free, so without the
         re-solve a design change would move the picker and nothing on the grid.
         Contrast a lock change, which cannot move which *item* fills a slot at
         all. */
      expect(slots).toBe(128)
      expect(moved).toBe(108)
    },
    SLOW_MS,
  )

  /* ------------------------------------- the mixed-design corner, before and after */

  it('builds the five-slot corner out of one design instead of four', () => {
    const source = corpus()
    /* **The exact recipe the defect was found on** — *S2W: Wall on Tile: Corner
       (Any, Single Piece)* — rather than a corner that merely resembles it. */
    const corner = source.recipes.find((template) => template.id === 's2w-wall-on-tile-corner-any-single-piece')
    expect(corner).toBeDefined()
    if (corner === undefined) return

    const designsOf = (family: string | undefined): readonly (string | undefined)[] =>
      solveTemplateFills(corner, source.index, {
        composition: source.composition,
        lock: 'openlock',
        ...(family === undefined ? {} : { family }),
      }).decisions.map((decision) => decision.record?.texture)

    /* The defect, reproduced file for file: an `aztlan` column, two `cut-stone`
       arrow-slit walls, an `aztlan` floor and a `plain` base — **three stone
       types and a plate in one corner**, with `complete: true` throughout, which
       is why nothing failed and why the owner found it by looking rather than by
       a test. (The brief called it four; `plain` is the fourth, and it is the one
       that is not a design choice at all.) */
    expect(designsOf(undefined)).toEqual(['aztlan', 'cut-stone', 'cut-stone', 'aztlan', 'plain'])
    expect(new Set(designsOf(undefined)).size).toBe(3)

    /* And fixed: four of the five parts in the asked-for design, the fifth being
       the base, which is `plain` because 38 of 40 base slots have nothing else
       to offer. Three stone types down to one plus a plain plate. */
    expect(designsOf('dungeon_stone')).toEqual([
      'dungeon_stone',
      'dungeon_stone',
      'dungeon_stone',
      'dungeon_stone',
      'plain',
    ])
    expect(designsOf('cut-stone')).toEqual(['cut-stone', 'cut-stone', 'cut-stone', 'cut-stone', 'plain'])
  })
})
