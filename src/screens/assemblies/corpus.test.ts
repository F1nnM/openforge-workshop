/**
 * The 40 recipes against their own fixtures and against the live archive.
 *
 * Two independent halves with two independent gates, because they need different
 * inputs and either can be missing on a fresh checkout:
 *
 *   1. **The fixtures** (`OPENFORGE_FIXTURES`, or the literal
 *      `pipeline/fixtures.ts` uses). This half proves the reader lost nothing —
 *      re-emitting each of the 20 YAML files and comparing **bytes** — and that
 *      the committed `templates.ts` is exactly what the generator produces from
 *      them. It also measures the JSON half of the directory, which is where the
 *      claim *"these two grammar features exist only in the templates"* is either
 *      true or not.
 *   2. **`catalog.json`**, gitignored and rebuilt by `npm run import:catalog`.
 *      This half is the census: **every figure quoted in `assembly.ts`**, computed
 *      rather than restated, plus the four invariants `assertTemplates` throws on.
 *
 * Either half absent skips **loudly**, naming the path and the command — the
 * precedent `src/composition/corpus.test.ts` and `src/search/corpus.test.ts` both
 * set. CI has both: the fixtures are pinned and the stamp step regenerates the
 * index before the suite runs, so every assertion below fires on every pull
 * request.
 *
 * ## What these tests cannot do
 *
 * They cannot tell you the *rules* are right — a census is a set of totals, and a
 * total agrees with several different rules. `assemblies.test.ts` is the
 * semantics half, on fixtures small enough to count by hand. What this file
 * uniquely proves is that the rules are being applied to the archive the plan
 * describes, and that a fixture import which moved any of it says so.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { CatalogFile } from '@/catalog'

import { STEP_PAGE, createRecipeIndex } from './assembly'
import {
  printFixture,
  printTemplatesModule,
  readTemplateFile,
  readTemplateFixtures,
  templateFixturesDir,
} from './fixtures'
import { assertTemplates, measureTemplates } from './measure'
import { RECIPE_TEMPLATES } from './templates'

/* ---------------------------------------------------------------- the boundary */

describe('the fixture reader’s boundary', () => {
  /**
   * `fixtures.ts` is the only file under `src/` that imports a `node:` module,
   * and the only thing keeping that safe is that nothing the browser reaches
   * imports it. Asserted rather than trusted: an `import './fixtures'` added to
   * the screen would build locally in the dev server's Node context and fail in
   * the production bundle, which is exactly the class of mistake worth a test.
   */
  it('is imported by no file the app can reach', () => {
    const reachable = ['assembly.ts', 'templates.ts', 'AssembliesScreen.tsx', 'index.ts', 'measure.ts']
    const offenders = reachable.filter((name) =>
      /from '\.\/fixtures'/.test(readFileSync(`src/screens/assemblies/${name}`, 'utf8')),
    )

    expect(offenders).toEqual([])
  })

  it('is the only file under src/ reaching for the filesystem, outside tests', () => {
    // A directory walk rather than `git ls-files`, so an untracked new file
    // counts — the lesson `tools/hygiene/source.test.ts` records paying for.
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) return walk(path)
        return /\.tsx?$/.test(entry.name) && !entry.name.includes('.test.') ? [path] : []
      })
    const importers = walk('src').filter((path) => readFileSync(path, 'utf8').includes("from 'node:"))

    expect(importers).toEqual(['src/screens/assemblies/fixtures.ts'])
  })
})

/* --------------------------------------------------------------- the fixtures */

const FIXTURES = templateFixturesDir()
const hasFixtures = existsSync(FIXTURES)
const describeFixtures = hasFixtures ? describe : describe.skip
const fixturesTitle = hasFixtures
  ? 'the blueprint fixtures'
  : `the blueprint fixtures — SKIPPED, no ${FIXTURES} (set OPENFORGE_FIXTURES)`

/** The module path, so a failure can name the file that is out of date. */
const MODULE = 'src/screens/assemblies/templates.ts'

const REFRESH =
  'npx tsx -e "import {writeFileSync} from \'node:fs\';' +
  "import {readTemplateFixtures,printTemplatesModule} from './src/screens/assemblies/fixtures.ts';" +
  `writeFileSync('${MODULE}', printTemplatesModule(readTemplateFixtures()))"`

describeFixtures(fixturesTitle, () => {
  const yaml = hasFixtures ? readdirSync(FIXTURES).filter((name) => name.endsWith('.yaml')).sort() : []
  const json = hasFixtures ? readdirSync(FIXTURES).filter((name) => name.endsWith('.json')).sort() : []

  it('holds 20 YAML files beside 21 JSON ones', () => {
    // The number the row's "40 recipe templates" comes out of. Two entries per
    // YAML file; `pipeline/fixtures.ts` reads only the JSON, deliberately.
    expect(yaml).toHaveLength(20)
    expect(json).toHaveLength(21)
  })

  it('re-emits every YAML file byte for byte, which is the proof the reader lost nothing', () => {
    const mismatched: string[] = []
    for (const name of yaml) {
      const text = readFileSync(join(FIXTURES, name), 'utf8')
      if (printFixture(readTemplateFile(name, text)) !== text) mismatched.push(name)
    }
    expect(
      mismatched,
      'The reader dropped or reordered something. It is a strict subset reader; widen it rather than loosening this comparison.',
    ).toEqual([])
  })

  it('reads exactly 40 templates, none of which is a file in the catalog', () => {
    const entries = readTemplateFixtures(FIXTURES)
    expect(entries).toHaveLength(40)
    expect(entries.reduce((total, entry) => total + entry.parts.length, 0)).toBe(128)
    // A template has no `file_metadata`, which is exactly why it is a recipe and
    // not a tile. The reader models no such field, so this is structural: nothing
    // it can return could ever become a `CatalogRecord`.
    expect(entries.every((entry) => entry.type === 'blueprint')).toBe(true)
  })

  it('has the committed templates.ts byte-identical to the generator’s output', () => {
    expect(
      printTemplatesModule(readTemplateFixtures(FIXTURES)),
      `${MODULE} is out of date or hand-edited. Regenerate it:\n${REFRESH}`,
    ).toBe(readFileSync(MODULE, 'utf8'))
  })

  it('carries 30 sibling lists and 20 part-level fulfills, all naming base', () => {
    const parts = readTemplateFixtures(FIXTURES).flatMap((entry) => entry.parts)
    const constrain = parts.flatMap((part) => part.constrain)

    expect(constrain.filter((entry) => entry.siblings !== undefined)).toHaveLength(30)
    expect(parts.flatMap((part) => part.fulfills)).toEqual(Array.from({ length: 20 }, () => 'base'))
    // `require` is on all 128; `deny` on 82 and `constrain` on 110.
    expect(parts.filter((part) => part.require.length > 0)).toHaveLength(128)
    expect(parts.filter((part) => part.deny.length > 0)).toHaveLength(82)
    expect(parts.filter((part) => part.constrain.length > 0)).toHaveLength(110)
    expect(constrain.filter((entry) => entry.filter !== undefined)).toHaveLength(36)
  })

  /**
   * The other half of the directory, read raw.
   *
   * `assembly.ts` and `fixtures.ts` both rest on the claim that
   * `constrain[].siblings` and part-level `fulfills` occur **only** in the
   * templates. That claim is about the JSON, so it is measured on the JSON —
   * without Zod, because `pipeline/fixtures.ts`'s schema models neither field
   * and would strip both before a count could see them. That stripping is itself
   * the finding C1 predicted, and it is reported to the schema's owner.
   */
  it('finds neither grammar feature in the 8,721 JSON rows', () => {
    interface RawPart {
      readonly name: string
      readonly optional?: boolean
      readonly id?: string
      readonly fulfills?: unknown
      readonly tags?: { readonly constrain?: readonly Record<string, unknown>[] }
    }
    interface RawRow {
      readonly config?: { readonly parts?: readonly RawPart[]; readonly fulfills?: readonly unknown[] }
    }

    const rows: RawRow[] = json.flatMap((name) => {
      const parsed: unknown = JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'))
      return Array.isArray(parsed) ? (parsed as RawRow[]) : []
    })
    const parts = rows.flatMap((row) => row.config?.parts ?? [])

    expect(rows).toHaveLength(8_721)
    expect(parts).toHaveLength(3_703)
    expect(parts.filter((part) => part.fulfills !== undefined)).toHaveLength(0)
    expect(
      parts
        .flatMap((part) => part.tags?.constrain ?? [])
        .filter((entry) => 'siblings' in entry || 'parent' in entry),
    ).toHaveLength(0)
    // The two the JSON does have and the templates do not, for the same table.
    expect(parts.filter((part) => part.optional !== undefined)).toHaveLength(2_653)
    expect(parts.filter((part) => part.id !== undefined)).toHaveLength(6)
    expect(rows.filter((row) => (row.config?.fulfills ?? []).length > 0)).toHaveLength(21)
  })

  /**
   * The sharpest fact in this row, and the one that makes the templates
   * load-bearing rather than decorative.
   *
   * The corpus's 21 `config.fulfills` declarations name `column`, `left wall` and
   * `right wall`. If those names occur as part names in the JSON, the corpus can
   * resolve its own inverse relation. They do not, anywhere — so it cannot, and
   * the only place they exist is the four corner recipes here.
   */
  it('names three parts in config.fulfills that exist in no JSON part declaration', () => {
    interface RawRow {
      readonly config?: {
        readonly parts?: readonly { readonly name: string }[]
        readonly fulfills?: readonly { readonly part: string }[]
      }
    }
    const rows: RawRow[] = json.flatMap((name) => {
      const parsed: unknown = JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'))
      return Array.isArray(parsed) ? (parsed as RawRow[]) : []
    })
    const declared = new Set(rows.flatMap((row) => row.config?.parts ?? []).map((part) => part.name))
    const named = new Set(rows.flatMap((row) => row.config?.fulfills ?? []).map((entry) => entry.part))

    expect([...named].sort()).toEqual(['column', 'left wall', 'right wall'])
    expect([...named].filter((name) => declared.has(name))).toEqual([])
    // And all three are template part names.
    const templateParts = new Set(
      readTemplateFixtures(FIXTURES).flatMap((entry) => entry.parts.map((part) => part.name)),
    )
    expect([...named].every((name) => templateParts.has(name))).toBe(true)
  })
})

/* ----------------------------------------------------------------- the corpus */

const CATALOG = 'public/catalog/catalog.json'
const hasCatalog = existsSync(CATALOG)
const describeCorpus = hasCatalog ? describe : describe.skip
const corpusTitle = hasCatalog
  ? 'the 40 recipes against the live archive'
  : `the 40 recipes against the live archive — SKIPPED, no ${CATALOG} (run \`npm run import:catalog\`)`

/**
 * The census runs one full pass over 8,702 records — an inverted index, 128 part
 * resolutions with per-card consequences, two walks and an exhaustive
 * solvability search. Seconds of real work rather than a hang, and the 5,000 ms
 * default is what fails first on a loaded machine.
 */
const SLOW_MS = 300_000

describeCorpus(corpusTitle, () => {
  const report = hasCatalog
    ? measureTemplates(
        createRecipeIndex(CatalogFile.parse(JSON.parse(readFileSync(CATALOG, 'utf8')))),
        RECIPE_TEMPLATES,
        STEP_PAGE,
      )
    : undefined

  it(
    'is 40 recipes over 20 files with 128 uniquely-named parts',
    () => {
      expect(report?.templates).toBe(40)
      expect(report?.sourceFiles).toBe(20)
      expect(report?.parts).toBe(128)
      // What makes `(template, part)` a total key, so A1's private `slotKey` is
      // not needed. C2 flagged this row as the one most likely to want it.
      expect(report?.duplicatePartNames).toBe(0)
      expect(report?.partNames).toEqual([
        'base',
        'column',
        'floor',
        'left wall',
        'right wall',
        'wall',
      ])
    },
    SLOW_MS,
  )

  it('shares no tag root with its own constrain entries — the whole mechanism', () => {
    expect(report?.tagRoots).toEqual(['build', 'component', 'object', 'shape'])
    expect(report?.constrainRoots).toEqual(['connection', 'size'])
    expect(report?.sharedRoots).toEqual([])
  })

  it('offers a candidate for every one of the 128 parts, cold', () => {
    // Against 526 of C1's 3,695 tile slots (14.2%) that are dead on arrival.
    expect(report?.deadEndParts).toBe(0)
    expect(report?.unknownRefParts).toBe(0)
    expect(report?.initialFiles).toMatchObject({ n: 128, min: 5, median: 67, max: 1_608, total: 14_241 })
    expect(report?.initialItems).toMatchObject({ n: 128, min: 1, median: 27, p90: 88, max: 428 })
  })

  /**
   * The row's premise, measured — and the reason C2 was right to ship greying
   * without it.
   */
  it('narrows 8,645 of 11,938 sibling observations, where C2 measured 0 of 33,221', () => {
    expect(report?.siblings).toEqual({
      observations: 11_938,
      unchanged: 2_108,
      emptied: 1_185,
      narrowed: 8_645,
      widened: 0,
    })
    expect(report?.narrowingFactor.median).toBe(4)
    expect(report?.narrowingFactor.max).toBe(48)
  })

  it('completes all 40 with greying on and 24 without, and never empties a part when guided', () => {
    expect(report?.blindWalk.completed).toBe(24)
    expect(report?.guidedWalk.completed).toBe(40)
    // Every one is solvable, so the 16 blind failures are the naive flow's fault
    // and not the archive's. This is the argument for C2's capability in one line.
    expect(report?.solvable).toBe(40)

    expect(report?.guidedWalk.steps).toEqual([
      { after: 1, observations: 88, unchanged: 16, emptied: 0, narrowed: 72, widened: 0 },
      { after: 2, observations: 48, unchanged: 30, emptied: 0, narrowed: 18, widened: 0 },
      { after: 3, observations: 8, unchanged: 8, emptied: 0, narrowed: 0, widened: 0 },
      { after: 4, observations: 4, unchanged: 4, emptied: 0, narrowed: 0, widened: 0 },
    ])
    // Guided, not one observation in 148 is emptied — the flow is pure narrowing.
    expect(report?.guidedWalk.steps.reduce((total, step) => total + step.emptied, 0)).toBe(0)
    expect(report?.guidedWalk.cardsGreyed).toBe(250)
    expect(report?.guidedWalk.cardsOffered).toBe(2_934)
  })

  it('is what takes the over-a-page steps from 39 to 4', () => {
    // The row's payoff in the unit a user feels. `STEP_PAGE` is 48.
    expect(report?.unnarrowedOverPage).toBe(39)
    expect(report?.guidedWalk.overPage).toBe(4)
  })

  it('has 87 cards whose variants disagree, where C2 had 0 of 4,330', () => {
    // So `contributedVariant`'s tie-break is load-bearing here rather than a
    // defensive branch: without it, 87 cards would look available and close a
    // part anyway.
    expect(report?.partialOptions).toBe(87)
    // And C2's three rescues do not occur on templates. Asserted so that a
    // fixture import which created one would surface rather than pass.
    expect(report?.cardsRescuing).toBe(0)
  })

  it('fires part-level fulfills on 1,329 nested parts, every one of them a base', () => {
    expect(report?.partsWithNestedCandidates).toBe(38)
    expect(report?.fulfillingParts).toBe(20)
    expect(report?.fulfillsEntries).toBe(20)
    expect(report?.fulfillsNotBase).toBe(0)
    expect(report?.fulfillingCandidates).toBe(1_631)
    expect(report?.fulfillingCandidatesNested).toBe(1_403)
    expect(report?.coveredNestedParts).toBe(1_329)
    // `base` is in this list, and it is the only name any `fulfills` uses — which
    // is why the spec's nested filter is a no-op against C2's picker, since
    // `SlotFills` never offers a `base` slot as a choice.
    expect(report?.nestedNames).toEqual([
      'base',
      'door',
      'frame',
      'grate',
      'grate (left)',
      'grate (right)',
      'lintel',
      'portcullis',
      'shutters',
      'top',
      'torch',
    ])
  })

  it('reaches all 21 blueprint-level fulfills from exactly one recipe', () => {
    expect(report?.coveringRecords).toBe(21)
    expect(report?.coveringPairs).toBe(24)
    expect(report?.coveringParts).toEqual(['left wall', 'right wall'])
    expect(report?.coveringTemplates).toEqual(['S2W: Wall on Tile: Corner (Any, Single Piece)'])
  })

  it('resolves a whole recipe inside a frame budget a click can absorb', () => {
    /*
      A range and not a threshold: this is wall-clock on shared CI, so a tight
      bound would be flaky and a loose one would say nothing. What it guards is
      the order of magnitude — the pass was 162 ms at its worst before the
      redundant `before` resolution was hoisted out of the per-card loop, and a
      regression that put it back would show up here as tens of milliseconds
      becoming hundreds.
    */
    expect(report?.resolveMs.n).toBe(40)
    expect(report?.resolveMs.median).toBeLessThan(60)
    expect(report?.resolveMs.max).toBeLessThan(400)
  })

  it('satisfies the four invariants the screen would be wrong without', () => {
    expect(() => {
      assertTemplates(report as never)
    }).not.toThrow()
  })
})
