/**
 * The 40 recipe templates, against their fixtures and against the JSON half.
 *
 * Four things are checked here and they are four different kinds of claim:
 *
 *   1. **The two halves cannot cross.** A template is not a record, and the
 *      reason is structural rather than careful — two loaders, two globs, and a
 *      `file_metadata` that `FixtureRow` requires and the template shape does
 *      not model. Both directions are *run*, not described.
 *   2. **The reader lost nothing.** All 20 files are re-emitted and compared
 *      **byte for byte**. Because the parts go through `PartSlot` from
 *      `src/catalog/schema.ts`, that comparison now also proves the app's shared
 *      grammar carries the whole fixture grammar — and the pre-row schema is
 *      reconstructed here to show it did not, losing 30 sibling lists and 20
 *      `fulfills` blocks with **zero parse errors**.
 *   3. **The committed module is the emitter's output**, byte for byte. Row C3
 *      established that guarantee for a screen-local generator; it moves here
 *      with the generator.
 *   4. **The census.** Every figure `pipeline/templates.ts` and row C3's PR
 *      quote, computed rather than restated.
 *
 * Skips **loudly** without the fixtures, naming the path and the override — the
 * precedent `src/composition/corpus.test.ts` and `src/search/corpus.test.ts`
 * both set. CI pins the corpus, so every assertion below fires on every pull
 * request.
 *
 * ## What this file cannot prove
 *
 * That the *semantics* are right. A round-trip proves the bytes survived and a
 * census proves the totals; neither says a `siblings` list means what
 * `src/composition/config.ts` does with it. That is C1's 69 ported tests and
 * C3's `assemblies.test.ts`. Nor does anything here observe the emitted module
 * being *typed*: `RECIPE_TEMPLATES: readonly RecipeTemplate[]` is checked by
 * `tsc -b` in the app project, which this test cannot reach and does not try to.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { TagRef } from '../src/catalog'

import { FixtureRow, fixtureFingerprint, fixturesDir, loadFixtureRows } from './fixtures'
import type { TemplateFixture } from './templates'
import {
  TEMPLATES_MODULE_PATH,
  loadTemplateFixtures,
  printFixture,
  printTemplateModule,
  readTemplateFile,
  templateSlug,
} from './templates'

const FIXTURES = fixturesDir()
const hasFixtures = existsSync(FIXTURES)
const describeFixtures = hasFixtures ? describe : describe.skip
const title = hasFixtures
  ? 'the 40 recipe templates'
  : `the 40 recipe templates — SKIPPED, no ${FIXTURES} (set OPENFORGE_FIXTURES)`

const REFRESH = 'Regenerate it with `npm run import:catalog`.'

describeFixtures(title, () => {
  const yaml = hasFixtures ? readdirSync(FIXTURES).filter((name) => name.endsWith('.yaml')).sort() : []
  const json = hasFixtures ? readdirSync(FIXTURES).filter((name) => name.endsWith('.json')).sort() : []
  const entries: readonly TemplateFixture[] = hasFixtures ? loadTemplateFixtures(FIXTURES) : []
  const parts = entries.flatMap((entry) => entry.parts)
  const constrain = parts.flatMap((part) => part.tags.constrain ?? [])

  /* ------------------------------------------------------------ the two halves */

  it('holds 20 YAML files beside 21 JSON ones', () => {
    // The number "40 recipe templates" comes out of: two entries per YAML file.
    expect(yaml).toHaveLength(20)
    expect(json).toHaveLength(21)
  })

  it('reads 40 templates over 20 files and 128 parts', () => {
    expect(entries).toHaveLength(40)
    expect(new Set(entries.map((entry) => entry.source)).size).toBe(20)
    expect(parts).toHaveLength(128)
    expect(entries.every((entry) => entry.type === 'blueprint')).toBe(true)
    // Part names are unique within a template, which is what makes C3's
    // `(template, part)` key total and A1's private `slotKey` unnecessary.
    const duplicated = entries.filter(
      (entry) => new Set(entry.parts.map((part) => part.name)).size !== entry.parts.length,
    )
    expect(duplicated).toEqual([])
  })

  /**
   * The first half of "a template cannot become a `CatalogRecord`", run rather
   * than asserted in prose.
   *
   * `FixtureRow.file_metadata` is required, and the template shape models no
   * such field at all — so every one of the 40 fails that parse, and it fails
   * *naming* the field rather than silently yielding a half-built row. Make
   * `file_metadata` optional and all 40 of these parses start succeeding, which
   * is exactly the mistake this is here to catch.
   */
  it('cannot parse one of the 40 as a fixture row, because file_metadata is required', () => {
    const results = entries.map((entry) =>
      FixtureRow.safeParse({ name: entry.name, tags: entry.tags, config: { parts: entry.parts } }),
    )

    expect(results.filter((result) => result.success)).toHaveLength(0)
    expect(results.every((result) => !result.success && /file_metadata/.test(result.error.message))).toBe(true)
  })

  /** And the other direction: the YAML reader on a JSON fixture. */
  it('cannot read a JSON fixture as a template file', () => {
    const name = json[0]
    expect(name).toBeDefined()
    expect(() => readTemplateFile(String(name), readFileSync(join(FIXTURES, String(name)), 'utf8'))).toThrow(
      /expected/,
    )
  })

  /**
   * The join, over the two loaders' actual output.
   *
   * The two globs are disjoint by construction, so this is the check that they
   * are disjoint *in the archive too* — a template's name occurring as a live
   * tile's identity or display name would mean the halves had started to
   * overlap upstream, which no schema here would notice.
   */
  it('shares no identity between the 8,721 JSON rows and the 40 templates', () => {
    const rows = loadFixtureRows(FIXTURES)
    expect(rows).toHaveLength(8_721)
    expect(rows.filter((row) => row.file_metadata.full_name.length > 0)).toHaveLength(8_721)

    const names = new Set(entries.map((entry) => entry.name))
    const collisions = rows.filter(
      (row) => names.has(row.file_metadata.full_name) || names.has(row.file_metadata.file),
    )
    expect(collisions).toEqual([])
  })

  /* ------------------------------------------------------------- the round-trip */

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

  /**
   * Row C1's prediction, reproduced — and the reason the schema had to be
   * widened *before* this pipeline read the YAML rather than after.
   *
   * C1 wrote: *"if a fixture ever writes one, `src/catalog/schema.ts` has to
   * widen `ConstrainRef` or Zod will strip it and the source control will be
   * lost in silence."* `NarrowPartSlot` below is that schema verbatim as it stood
   * before this row. Parsing all 128 real parts through it produces **no error
   * at all** — Zod object schemas strip what they do not model — and the
   * round-trip it feeds is 70 lines short across the 20 files: 30 `siblings`
   * lines, 20 `fulfills:` headers and 20 `- part:` entries.
   *
   * This is what makes the widening load-bearing rather than decorative. Revert
   * either field in `src/catalog/schema.ts` and the byte-for-byte test above
   * fails; this test is the same fact stated as a measurement, so a reader does
   * not have to break the schema to see it.
   */
  it('would lose 30 sibling lists and 20 fulfills blocks under the pre-row schema, silently', () => {
    const NarrowConstrain = z.union([TagRef, z.object({ filter: z.string().min(1) })])
    const NarrowPartSlot = z.object({
      name: z.string().min(1),
      id: z.string().min(1).optional(),
      optional: z.boolean().optional(),
      tags: z.object({
        require: z.array(TagRef).optional(),
        deny: z.array(TagRef).optional(),
        constrain: z.array(NarrowConstrain).optional(),
      }),
    })

    const narrowed = parts.map((part) => NarrowPartSlot.safeParse(part))
    // Not one of the 128 complains. That is the whole finding.
    expect(narrowed.filter((result) => !result.success)).toEqual([])

    const kept = narrowed.flatMap((result) => (result.success ? [result.data] : []))
    expect(kept.flatMap((part) => part.tags.constrain ?? []).filter((ref) => 'siblings' in ref)).toEqual([])
    expect(kept.filter((part) => 'fulfills' in part)).toEqual([])

    const reprinted = entries.map((entry) => ({
      ...entry,
      parts: entry.parts.map((part) => NarrowPartSlot.parse(part)),
    }))
    const lost = yaml.reduce((total, name) => {
      const original = readFileSync(join(FIXTURES, name), 'utf8').split('\n').length
      const after = printFixture(reprinted.filter((entry) => entry.source === name)).split('\n').length
      return total + (original - after)
    }, 0)
    expect(lost).toBe(70)
  })

  /* ---------------------------------------------------------- the emitted module */

  it('has the committed module byte-identical to the emitter’s output', () => {
    expect(
      printTemplateModule(entries),
      `${TEMPLATES_MODULE_PATH} is out of date or hand-edited. ${REFRESH}`,
    ).toBe(readFileSync(TEMPLATES_MODULE_PATH, 'utf8'))
  })

  it('slugs the 40 names to 40 distinct ids, and refuses to emit a collision', () => {
    const ids = entries.map((entry) => templateSlug(entry.name))
    expect(new Set(ids).size).toBe(40)
    expect(ids.every((id) => /^[a-z0-9-]+$/.test(id))).toBe(true)

    // The guard, shown failing: two entries whose names differ only in
    // punctuation slug to one id, and the emitter throws instead of emitting a
    // duplicate key the screen would render as a disappearing card.
    const [first] = entries
    if (first === undefined) throw new Error('no templates to build the collision from')
    expect(() => printTemplateModule([first, { ...first, name: `${first.name}!` }])).toThrow(/slug to/)
  })

  /* ------------------------------------------------------------------ the census */

  it('carries 30 sibling lists and 20 part-level fulfills, all naming base', () => {
    expect(constrain.filter((ref) => 'siblings' in ref && ref.siblings !== undefined)).toHaveLength(30)

    const fulfills = parts.flatMap((part) => part.fulfills ?? [])
    expect(fulfills).toEqual(Array.from({ length: 20 }, () => ({ part: 'base' })))
    expect(parts.filter((part) => (part.fulfills ?? []).length > 0)).toHaveLength(20)

    // `require` is on all 128; `deny` on 82 and `constrain` on 110.
    expect(parts.filter((part) => (part.tags.require ?? []).length > 0)).toHaveLength(128)
    expect(parts.filter((part) => (part.tags.deny ?? []).length > 0)).toHaveLength(82)
    expect(parts.filter((part) => (part.tags.constrain ?? []).length > 0)).toHaveLength(110)

    // 226 constrain entries, 36 of them filters. The 226 is the number C1's
    // "all 9,180 of them" was missing.
    expect(constrain).toHaveLength(226)
    expect(constrain.filter((ref) => 'filter' in ref)).toHaveLength(36)

    // Six part names over all 128, which is why the tag repetition compresses to
    // 1.4 kB.
    expect([...new Set(parts.map((part) => part.name))].sort()).toEqual([
      'base',
      'column',
      'floor',
      'left wall',
      'right wall',
      'wall',
    ])
  })

  /**
   * The other half of the directory, read **raw**.
   *
   * The claim that these two grammar features occur only in the templates is a
   * claim about the JSON, so it is measured on the JSON — and without Zod,
   * because `pipeline/fixtures.ts`'s schema models neither field and would strip
   * both before a count could see them. Which is the same silent strip, one
   * schema over.
   */
  it('finds neither grammar feature in the 8,721 JSON rows, nor parent or accept in either half', () => {
    interface RawPart {
      readonly name: string
      readonly optional?: boolean
      readonly id?: string
      readonly fulfills?: unknown
      readonly tags?: {
        readonly accept?: unknown
        readonly constrain?: readonly Record<string, unknown>[]
      }
    }
    interface RawRow {
      readonly config?: { readonly parts?: readonly RawPart[]; readonly fulfills?: readonly unknown[] }
    }

    const rows: RawRow[] = json.flatMap((name) => {
      const parsed: unknown = JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'))
      return Array.isArray(parsed) ? (parsed as RawRow[]) : []
    })
    const rawParts = rows.flatMap((row) => row.config?.parts ?? [])
    const rawConstrain = rawParts.flatMap((part) => part.tags?.constrain ?? [])

    expect(rows).toHaveLength(8_721)
    expect(rawParts).toHaveLength(3_703)
    expect(rawConstrain).toHaveLength(9_180)

    expect(rawParts.filter((part) => part.fulfills !== undefined)).toHaveLength(0)
    expect(rawConstrain.filter((ref) => 'siblings' in ref)).toHaveLength(0)

    // `parent` and `accept` are the two features C1 also reported unmodelled,
    // and this is the first time they are counted over *both* halves. 0 either
    // side, so the schema still does not model them — a field with no measured
    // fact behind it is the one thing `src/catalog/schema.ts` does not carry.
    expect(rawConstrain.filter((ref) => 'parent' in ref)).toHaveLength(0)
    expect(rawParts.filter((part) => part.tags?.accept !== undefined)).toHaveLength(0)
    expect(constrain.filter((ref) => 'parent' in ref)).toHaveLength(0)

    // And the two the JSON does have and the templates do not.
    expect(rawParts.filter((part) => part.optional !== undefined)).toHaveLength(2_653)
    expect(rawParts.filter((part) => part.id !== undefined)).toHaveLength(6)
    expect(parts.filter((part) => part.optional !== undefined)).toHaveLength(0)
    expect(parts.filter((part) => part.id !== undefined)).toHaveLength(0)
    expect(rows.filter((row) => (row.config?.fulfills ?? []).length > 0)).toHaveLength(21)
  })

  /**
   * The sharpest fact about the 40, and the one that makes them load-bearing
   * rather than decorative.
   *
   * The corpus's 21 record-level `config.fulfills` declarations name `column`,
   * `left wall` and `right wall`. If those occurred as part names in the JSON the
   * corpus could resolve its own inverse relation. They do not, anywhere — so it
   * cannot, and the only place they exist is the corner recipes here.
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
    const named = new Set(rows.flatMap((row) => row.config?.fulfills ?? []).map((ref) => ref.part))

    expect([...named].sort()).toEqual(['column', 'left wall', 'right wall'])
    expect([...named].filter((name) => declared.has(name))).toEqual([])

    const templateParts = new Set(parts.map((part) => part.name))
    expect([...named].every((name) => templateParts.has(name))).toBe(true)
  })
})

/* --------------------------------------------------------------- the provenance */

/**
 * The fingerprint fallback, and the gap this row closed in it.
 *
 * `resolveFixturesRef` prefers `OPENFORGE_FIXTURES_COMMIT`, then the fixtures
 * repository's `HEAD`, then a sha256 over the fixture bytes. The first two always
 * covered the YAML — a commit covers every file in the tree. The third hashed
 * `*.json` only, so on a checkout with no `.git` (a tarball in CI is the case its
 * own docblock names) a changed recipe template produced an **unchanged**
 * `version.fixtures`, which is §16's risk 1 with no symptom.
 *
 * Asserted against {@link fixtureFingerprint} and not through
 * `resolveFixturesRef`, deliberately: CI exports `OPENFORGE_FIXTURES_COMMIT`, so
 * the wrapper returns a pinned SHA there and a test written against it would
 * have measured the environment instead of the function — passing whatever the
 * hash did. Temporary directories rather than the real fixtures for the same
 * reason: the real one is inside a git checkout, where this branch never runs.
 */
describe('the fixtures fingerprint', () => {
  function fixtureDirWith(yamlBody: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'of-fixtures-'))
    writeFileSync(join(dir, 'blueprints.json'), '[]')
    writeFileSync(join(dir, 'blueprints.recipes.yaml'), yamlBody)
    return dir
  }

  it('moves when a YAML template changes, which it did not before this row', () => {
    const a = fixtureFingerprint(fixtureDirWith('- name: "A"\n'))
    const b = fixtureFingerprint(fixtureDirWith('- name: "B"\n'))

    expect(a).toHaveLength(64)
    expect(a).not.toBe(b)
  })

  it('is stable when nothing changes, so a rebuild is not reported as drift', () => {
    const body = '- name: "A"\n'
    expect(fixtureFingerprint(fixtureDirWith(body))).toBe(fixtureFingerprint(fixtureDirWith(body)))
  })

  it('still ignores the directory’s one non-fixture file', () => {
    // `docs/verify-catalog-facts.py` lives beside the fixtures and is not an
    // input to this pipeline. Hashing it would report a script edit as a corpus
    // change.
    const dir = fixtureDirWith('- name: "A"\n')
    const before = fixtureFingerprint(dir)
    writeFileSync(join(dir, 'verify.py'), 'print("hello")\n')

    expect(fixtureFingerprint(dir)).toBe(before)
  })
})
