/// <reference types="node" />
/**
 * The click's fill, on catalogs small enough to reason about — and then on the
 * live archive, because the numbers this row is judged by are archive numbers.
 *
 * Two halves:
 *
 *   - **The fixtures** state each decision with the corpus taken out of it: the
 *     armed size deciding which file lands, the two ways the size reaches the
 *     solver, the three ways a slot ends up empty as the *user* reads them, a
 *     B2 doubt surviving all the way into the sentence a one-click placement
 *     announces, and the memo.
 *   - **The corpus block** measures the cost on the click path and the coverage
 *     over all 91 placeable families and all of B4's size positions. It is what
 *     the row reports rather than assumes, and it is where the brief's *"288
 *     queries per solve"* is corrected: 288 is `SOLVE_QUERIES`, the whole
 *     40-recipe walk.
 *
 * `catalog.json` is gitignored and rebuilt from the fixtures
 * (`npm run import:catalog`); CI regenerates it before the suite. Absent, the
 * corpus block skips loudly, which is `palette.corpus.test.ts`'s precedent.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { AssemblyTemplate, TemplateLookup } from '@/assembly'
import { buildAssemblyIndex } from '@/assembly'
import type { TemplateFamily } from '@/builder/panels'
import { PLACEABLE_TEMPLATES, TEMPLATE_FAMILIES } from '@/builder/panels'
import type { CatalogFile } from '@/catalog'
import { CatalogFile as CatalogFileSchema, buildAggregateIndex } from '@/catalog'
import { createCompositionIndex } from '@/composition'
import type { FillFixtureRecord } from '@/template/fixture'
import { fillFixture } from '@/template/fixture'
import type { TemplateId } from '@/store'

import type { PlacementFiller } from './fills'
import { createPlacementFiller, describePlacementFill, sizeContextFor } from './fills'

/* ------------------------------------------------------------------ fixtures */

/**
 * Two floors, two walls, two bases and a decoy, all size-tagged.
 *
 * The 1x1s come **first**, which is the whole point: `@/composition`'s postings
 * are in record order, so a solve with no size takes the 1x1 and a solve at 2x2
 * can only take the 2x2 by having been narrowed. A row that read the size as a
 * *hint* would pass every other test in this file and fail that one.
 *
 * The column carries `size|width|3` and `size|depth|3` and is the only record
 * that does. That puts the tags in the vocabulary while leaving **no floor** at
 * 3x3, which is the difference between C2's `unknown-ref` (a tag this build does
 * not hold) and its `no-candidate` (a size the archive has nothing of) — two
 * different sentences, and the user-facing one is the second.
 */
const SIZED_RECORDS: readonly FillFixtureRecord[] = [
  {
    id: 'tiles/floor-1x1',
    design: 'floor-1x1',
    tags: ['shape|floor', 'size|width|1', 'size|depth|1'],
    texture: 'dungeon_stone',
    foot: { shape: 'rect', w: 1, d: 1 },
  },
  {
    id: 'tiles/floor-2x2',
    design: 'floor-2x2',
    tags: ['shape|floor', 'size|width|2', 'size|depth|2'],
    texture: 'dungeon_stone',
    foot: { shape: 'rect', w: 2, d: 2 },
  },
  {
    id: 'tiles/wall-1',
    design: 'wall-1',
    tags: ['shape|wall', 'size|width|1'],
    texture: 'dungeon_stone',
    foot: { shape: 'rect', w: 1, d: 0.5 },
  },
  {
    id: 'tiles/wall-2',
    design: 'wall-2',
    tags: ['shape|wall', 'size|width|2'],
    texture: 'dungeon_stone',
    foot: { shape: 'rect', w: 2, d: 0.5 },
  },
  {
    id: 'tiles/base-1x1',
    design: 'base-1x1',
    layer: 'base',
    conn: ['openlock'],
    tags: ['shape|base', 'size|width|1', 'size|depth|1', 'connection|openlock'],
    foot: { shape: 'rect', w: 1, d: 1 },
  },
  {
    id: 'tiles/base-2x2',
    design: 'base-2x2',
    layer: 'base',
    conn: ['openlock'],
    tags: ['shape|base', 'size|width|2', 'size|depth|2', 'connection|openlock'],
    foot: { shape: 'rect', w: 2, d: 2 },
  },
  {
    id: 'tiles/column-3',
    design: 'column-3',
    tags: ['shape|column', 'size|width|3', 'size|depth|3'],
    foot: { shape: 'rect', w: 3, d: 3 },
  },
  {
    // Never a candidate, and `fill.test.ts` carries the same record for the
    // same reason: it puts `RUN_DENY_TAGS` in the vocabulary, so an `edge`
    // slot's `deny` is a real refusal rather than a dangling ref — which C2
    // classifies `unknown-ref` and which would mask every gap below.
    id: 'tiles/decoy',
    design: 'decoy',
    tags: ['shape|angled|right', 'shape|option|curved_interface'],
  },
]

const FLOOR_FAMILY = 'floor-family' as TemplateId
const WALL_RECIPE = 'wall-on-tile' as TemplateId

/** B4's shape: **one** part, no convention, so the size applies family-wide. */
const FLOOR_ONLY: AssemblyTemplate = {
  id: FLOOR_FAMILY,
  tags: ['object|tile'],
  parts: [{ name: 'floor', tags: { require: [{ tag: 'shape|floor' }] } }],
}

/** B2's `WALL_ON_TILE` part-name set, so the same size arrives as a **cell**. */
const WALL_ON_TILE: AssemblyTemplate = {
  id: WALL_RECIPE,
  tags: ['object|tile'],
  parts: [
    { name: 'wall', tags: { require: [{ tag: 'shape|wall' }] } },
    { name: 'floor', tags: { require: [{ tag: 'shape|floor' }] } },
    { name: 'base', tags: { require: [{ tag: 'shape|base' }] } },
  ],
}

const TWO_BY_TWO = ['size|width|2', 'size|depth|2']

function fillerOver(
  records: readonly FillFixtureRecord[],
  templates: readonly AssemblyTemplate[],
): PlacementFiller {
  const file = fillFixture(records)
  const composition = createCompositionIndex(file, buildAggregateIndex(file))
  const lookup: TemplateLookup = (id) => templates.find((template) => template.id === id)
  return createPlacementFiller({
    index: buildAssemblyIndex(file),
    context: { templates: lookup, composition, lock: 'openlock' },
  })
}

/* -------------------------------------------------------- the armed size lands */

describe('the armed size decides what lands', () => {
  const fill = fillerOver(SIZED_RECORDS, [FLOOR_ONLY, WALL_ON_TILE])

  it('takes the first candidate when the palette is at `any size`', () => {
    // `any size` is `[]` and a real position: with no tags nothing is required
    // and the family admits every size, so record order settles it.
    const placed = fill(FLOOR_FAMILY, [])

    expect(placed.fills).toEqual({ floor: { tile: 'tiles/floor-1x1', pinned: false } })
    expect(placed.filled).toBe(1)
    expect(placed.needsChoice).toEqual([])
  })

  it('places the size the user armed, which is the defect row C5 closes', () => {
    // The row in one assertion. Before C5 the palette's *2 wide by 2 deep* wrote
    // `fills: {}` and the solver's default arrived; the 1x1 is still first in
    // record order here, so only a real narrowing can produce this.
    const placed = fill(FLOOR_FAMILY, TWO_BY_TWO)

    expect(placed.fills).toEqual({ floor: { tile: 'tiles/floor-2x2', pinned: false } })
  })

  it('writes every fill `auto`, because the solver chose it and not the user', () => {
    // `pinned: true` would freeze the choice against every later lock change —
    // the store's own warning, and the one thing a default-fill must not do.
    const placed = fill(FLOOR_FAMILY, TWO_BY_TWO)

    expect(Object.values(placed.fills).map((one) => one?.pinned)).toEqual([false])
  })

  it('narrows a layout-bearing recipe per slot rather than family-wide', () => {
    /* The same two tags, read the other way: B3's derivation gives the `floor`
       (a `cell` anchor) a 2x2 congruence and the `wall` (an `edge` anchor) a
       2-unit *run*, and no single ref list could ask for both — the wall carries
       no `size|depth` at all. */
    const placed = fill(WALL_RECIPE, TWO_BY_TWO)

    expect(placed.fills).toEqual({
      wall: { tile: 'tiles/wall-2', pinned: false },
      floor: { tile: 'tiles/floor-2x2', pinned: false },
      base: { tile: 'tiles/base-2x2', pinned: false },
    })
    expect(placed.filled).toBe(3)
    expect(placed.doubts).toEqual([])
  })

  it('reads the size as a cell only where there is a layout to read it against', () => {
    // The branch, stated directly, because the two paths are the difference
    // between narrowing three slots correctly and emptying two of them.
    expect(sizeContextFor(WALL_ON_TILE, TWO_BY_TWO)).toEqual({ cell: { w: 2, d: 2 } })
    expect(sizeContextFor(FLOOR_ONLY, TWO_BY_TWO)).toEqual({ size: TWO_BY_TWO })
  })

  it('keeps a one-axis position family-wide, because a cell needs both spans', () => {
    // C1's *"2 wide"* position. Inventing the depth would place a size nobody
    // chose, so it stays an exact ref on every slot.
    expect(sizeContextFor(WALL_ON_TILE, ['size|width|2'])).toEqual({ size: ['size|width|2'] })
  })
})

/* ---------------------------------------------------------- what does not fill */

describe('a slot the solver cannot fill still places', () => {
  const fill = fillerOver(SIZED_RECORDS, [FLOOR_ONLY, WALL_ON_TILE])

  it('reads a size the archive has nothing of as `no-candidate`', () => {
    /* Contract C-g and §3.2: leave it empty, mark *needs a choice*, place
       anyway. The classification matters because it is the difference between
       *change an earlier pick* and *nothing in the archive is this size* — and
       no sibling change can reopen the second. */
    const placed = fill(FLOOR_FAMILY, ['size|width|3', 'size|depth|3'])

    expect(placed.fills).toEqual({})
    expect(placed.needsChoice).toEqual([{ slot: 'floor', gap: 'no-candidate' }])
    // A clause and not a sentence: `edits.ts` says `Placed <family> at A1: …`,
    // so the fill's own words continue that sentence rather than starting one.
    expect(describePlacementFill(placed)).toBe(
      'no part could be chosen for its 1 slot. Nothing in the archive is this size.',
    )
  })

  it('names the slot when the rest of the template filled', () => {
    /* A 1-unit wall and a 2x2 cell: the `floor` and the `base` take the size
       congruently and the `wall`'s 2-unit run matches nothing, so two slots fill
       and one is named. `shape|wall` and `size|width|2` are both in the
       vocabulary, which is what makes this `no-candidate` — *nothing is this
       size* — rather than `unknown-ref`. */
    const partial = fillerOver(
      SIZED_RECORDS.filter((record) => record.id !== 'tiles/wall-2'),
      [WALL_ON_TILE],
    )
    const placed = partial(WALL_RECIPE, TWO_BY_TWO)

    expect(placed.filled).toBe(2)
    expect(placed.needsChoice).toEqual([{ slot: 'wall', gap: 'no-candidate' }])
    expect(describePlacementFill(placed)).toBe(
      '2 of 3 parts chosen for you. The wall part needs a choice: nothing in the archive is this size.',
    )
  })

  it('places a family this build ships no recipe for, and says which happened', () => {
    /* C1 measured this against the real table: all 51 generated families report
       `unknown-template` where the lookup holds only the 40 recipes. The click
       must still place — the bill is where it is priced and refused. */
    const placed = fill('no-such-family' as TemplateId, [])

    expect(placed).toMatchObject({ known: false, slots: 0, fills: {} })
    expect(describePlacementFill(placed)).toContain('no recipe for that family')
  })
})

/* ------------------------------------------------------------------ the doubts */

describe('a one-click placement discloses B2’s doubt', () => {
  it('quotes the editor’s own sentence rather than looking clean', () => {
    /* The shape of C2's measured failure, in four records: the only wall is
       2 units and the cell the floor resolves to is 1, so the edge cannot
       close. C2 hit it on the 2 external-corner `single_piece` recipes, whose
       mitre is in no tag and no measured mesh — and **no ordering fixes it**, so
       the honest answer is to place and say so.

       The numbers are `slotDoubtSentence`'s, which is what C3's editor mounts,
       so the surface and the editor cannot describe the same mitre differently. */
    const fill = fillerOver(
      SIZED_RECORDS.filter((record) => record.id !== 'tiles/wall-1'),
      [WALL_ON_TILE],
    )
    const placed = fill(WALL_RECIPE, [])

    expect(placed.filled).toBe(3)
    expect(placed.doubts).toEqual([{ part: 'wall', code: 'over-run', want: 1, got: 2 }])
    expect(describePlacementFill(placed)).toBe(
      '3 of 3 parts chosen for you. The wall part needs a choice: this edge is 1 units and the pieces on it come to 2.',
    )
  })
})

/* -------------------------------------------------------------------- the memo */

describe('the memo', () => {
  const fill = fillerOver(SIZED_RECORDS, [FLOOR_ONLY, WALL_ON_TILE])

  it('costs the second placement of the same row nothing', () => {
    const first = fill(WALL_RECIPE, TWO_BY_TWO)
    const second = fill(WALL_RECIPE, TWO_BY_TWO)

    expect(first.queries).toBeGreaterThan(0)
    expect(second.queries).toBe(0)
    expect(second.fills).toEqual(first.fills)
  })

  it('is not fooled by the order the two size tags arrive in', () => {
    // Sorted into the key, because a position spelled `depth` first is the same
    // solve and the recent-arms strip can hand back either order.
    fill(FLOOR_FAMILY, ['size|width|2', 'size|depth|2'])

    expect(fill(FLOOR_FAMILY, ['size|depth|2', 'size|width|2']).queries).toBe(0)
  })

  it('re-solves a different size rather than answering with the cached one', () => {
    fill(FLOOR_FAMILY, TWO_BY_TWO)
    const other = fill(FLOOR_FAMILY, [])

    expect(other.queries).toBeGreaterThan(0)
    expect(other.fills).toEqual({ floor: { tile: 'tiles/floor-1x1', pinned: false } })
  })
})

/* ------------------------------------------------------------- the live archive */

const CATALOG_PATH =
  process.env.OPENFORGE_CATALOG ?? join(process.cwd(), 'public', 'catalog', 'catalog.json')

function loadCatalog(): CatalogFile | undefined {
  if (!existsSync(CATALOG_PATH)) return undefined
  return CatalogFileSchema.parse(JSON.parse(readFileSync(CATALOG_PATH, 'utf8')) as unknown)
}

const loaded = loadCatalog()

if (loaded === undefined) {
  process.stderr.write(
    [
      '',
      '='.repeat(72),
      '  builder/three/fills.test: corpus block SKIPPED — no emitted catalog index.',
      `  Looked for: ${CATALOG_PATH}`,
      '  Build one with:  npm run import:catalog',
      '='.repeat(72),
      '',
    ].join('\n'),
  )
}

const describeCorpus = loaded === undefined ? describe.skip : describe

/** Building both indexes over 8,702 records is the slow part, not the solving. */
const SLOW_MS = 120_000

describeCorpus('the click path over the live archive', () => {
  const file = loaded as CatalogFile
  const index = buildAssemblyIndex(file)
  const composition = createCompositionIndex(file, buildAggregateIndex(file))
  const templates = new Map(PLACEABLE_TEMPLATES.map((template) => [template.id, template]))
  const authorities = {
    index,
    context: {
      templates: ((id: TemplateId) => templates.get(id)) as TemplateLookup,
      composition,
      lock: 'openlock' as const,
    },
  }

  /** A fresh filler, so a measurement is never taken against another one's memo. */
  const cold = (): PlacementFiller => createPlacementFiller(authorities)

  /* `RecipeTemplate.id` is a plain `string` and `PlacementFiller` takes the
     brand. C1's `familyOf` parses the same ids with `TemplateId.parse` and all 91
     pass, which `palette.corpus.test.ts` asserts — so this is the assertion that
     row's parse already made, not a new claim. */
  const idOf = (template: { readonly id: string }): TemplateId => template.id as TemplateId

  it(
    'fills every one of the 91 placeable families at `any size`',
    () => {
      const fill = cold()
      const placed = PLACEABLE_TEMPLATES.map((template) => fill(idOf(template), []))

      expect(placed.filter((one) => !one.known)).toEqual([])
      // Not one family arms an instance with nothing in it, which is what makes
      // the A4b "draws nothing" surfaces the exception they are now written as.
      expect(placed.filter((one) => one.filled === 0)).toEqual([])
      // Every declared slot of every family, which is C2's 40-of-40 and
      // 51-of-51 restated through the click's own entry point.
      expect(placed.filter((one) => one.filled < one.slots).map((one) => one.needsChoice)).toEqual([])
    },
    SLOW_MS,
  )

  it(
    'costs one placement nowhere near a frame, and a repeat nothing at all',
    () => {
      const fill = cold()
      const timed = PLACEABLE_TEMPLATES.map((template) => {
        const started = performance.now()
        const placed = fill(idOf(template), [])
        return { id: template.id, ms: performance.now() - started, queries: placed.queries }
      })
      const worst = timed.reduce((slowest, one) => (one.ms > slowest.ms ? one : slowest))
      const queries = timed.map((one) => one.queries).sort((a, b) => a - b)

      const repeat = performance.now()
      for (const template of PLACEABLE_TEMPLATES) fill(idOf(template), [])
      const repeatMs = performance.now() - repeat

      process.stderr.write(
        `\n  C5 click cost — 91 cold solves in ${total(timed).toFixed(1)} ms, ` +
          `worst ${worst.ms.toFixed(1)} ms (${worst.id}), ` +
          `queries min ${String(queries[0])} / median ${String(queries[Math.floor(queries.length / 2)])} / ` +
          `max ${String(queries.at(-1))}, total ${String(queries.reduce((a, b) => a + b, 0))}; ` +
          `91 memoised repeats in ${repeatMs.toFixed(1)} ms\n`,
      )

      // A frame is 16.7 ms and this is one gesture, so the bound is generous by
      // design: what it guards is a *regression in kind* — a solve that started
      // walking the archive per candidate — not a millisecond.
      expect(worst.ms).toBeLessThan(250)
      // The memo is the claim, not the speed: 91 repeats cost no queries at all.
      expect(repeatMs).toBeLessThan(worst.ms + 50)
    },
    SLOW_MS,
  )

  it(
    'corrects the brief: 288 is the whole 40-recipe walk, not one solve',
    () => {
      /* `SOLVE_QUERIES = 288` is documented in `fill.ts` as *"the candidate
         queries the whole 40-recipe walk costs"*, and the brief for this row
         quoted it as the cost of a single solve. Measured here on the click's
         own path, one solve is an order of magnitude cheaper — which is why a
         placement is nowhere near a frame. */
      const fill = cold()
      const recipes = PLACEABLE_TEMPLATES.filter((template) => template.parts.length > 1)
      const queries = recipes.map((template) => fill(idOf(template), []).queries)
      const total = queries.reduce((a, b) => a + b, 0)

      process.stderr.write(
        `\n  C5 queries — ${String(recipes.length)} multi-slot recipes cost ${String(total)} queries, ` +
          `${(total / recipes.length).toFixed(1)} per solve\n`,
      )

      expect(total).toBeGreaterThan(0)
      expect(total / recipes.length).toBeLessThan(288)
    },
    SLOW_MS,
  )

  it(
    'places a filled instance at every size the palette can arm',
    () => {
      /* B4's `GENERATED_FAMILY_SIZES` as C1 offers it: every position of every
         row that has a control. This is the row's user-facing claim — pick a
         size, get that size — measured over the whole domain rather than on one
         family, and it also reports how many positions the archive cannot fill,
         which is the `no-candidate` reading the surface now says out loud. */
      const fill = cold()
      const armable = TEMPLATE_FAMILIES.filter((family: TemplateFamily) => family.sizes.length > 0)
      const results = armable.flatMap((family) =>
        family.sizes.map((position) => ({
          family: family.id,
          label: position.label,
          placed: fill(family.id, position.tags),
        })),
      )
      const empty = results.filter((one) => one.placed.filled === 0)

      process.stderr.write(
        `\n  C5 size domain — ${String(armable.length)} families with a control, ` +
          `${String(results.length)} positions, ${String(results.length - empty.length)} fill, ` +
          `${String(empty.length)} do not\n`,
      )

      expect(results.length).toBeGreaterThan(300)
      // Every position that fails does so as `no-candidate` — *nothing in the
      // archive is this size* — and not as a sibling having closed it, which is
      // C2's note for C1 and the only honest sentence for a one-slot family.
      expect(
        empty.flatMap((one) => one.placed.needsChoice.filter((gap) => gap.gap !== 'no-candidate')),
      ).toEqual([])
    },
    SLOW_MS,
  )

  it(
    'reports the recipes whose fills do not close, rather than hiding them',
    () => {
      /* C2 composed its solved fills with B2's geometry and measured closure on
         34 of 40 recipes, `undecidable` on the 4 internal corners with no wall
         to close, and `fail` on the 2 external-corner `single_piece` recipes.
         The point of re-measuring it *here* is that a one-click placement is the
         surface where a user meets it, and `describePlacementFill` is where it
         is said. */
      const fill = cold()
      const recipes = PLACEABLE_TEMPLATES.filter((template) => template.parts.length > 1)
      const doubted = recipes
        .map((template) => ({ id: template.id, placed: fill(idOf(template), []) }))
        .filter((one) => one.placed.doubts.length > 0)
      const codes = new Map<string, number>()
      for (const one of doubted) {
        for (const doubt of one.placed.doubts) {
          codes.set(doubt.code, (codes.get(doubt.code) ?? 0) + 1)
        }
      }

      process.stderr.write(
        `\n  C5 closure — ${String(recipes.length - doubted.length)} of ${String(recipes.length)} ` +
          `recipes raise no doubt; doubts ${[...codes]
            .map(([code, n]) => `${code}=${String(n)}`)
            .join(', ')}\n`,
      )

      /* **This is not C2's 34 of 40, and the two do not disagree.** C2 counted
         `PlacedTemplate.verdict`, where the 4 internal corners are
         `undecidable` — they have no `wall` slot, so there is no edge to close
         and `placeTemplateSlots` raises no doubt about them. Counted by *doubts*
         — which is what a surface can say a sentence about — the failures are
         the 2 external-corner `single_piece` recipes and their 4 `over-run`
         walls. A row that reported `undecidable` as a doubt would be inventing a
         sentence about a rule that declined to answer. */
      expect(codes.get('over-run')).toBe(4)
      expect(doubted).toHaveLength(2)

      // Every doubt reaches the sentence the surface announces. A placement that
      // cannot close must not read as a clean one.
      for (const one of doubted) {
        expect(describePlacementFill(one.placed)).toMatch(/needs a choice|anchored|placeable|straight run/)
      }
    },
    SLOW_MS,
  )
})

function total(timed: readonly { readonly ms: number }[]): number {
  return timed.reduce((sum, one) => sum + one.ms, 0)
}
