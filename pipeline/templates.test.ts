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
 *   5. **Row B2's slot geometry costs the index nothing.** Every fixture's
 *      part-name set resolves to one of the three authored conventions (40 of
 *      40), an unknown set fails the *import* rather than the browser, and the
 *      emitted artefact is byte-identical with and without the row — asserted by
 *      rebuilding the corpus at the payload epoch, not by prose.
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

import { SLOT_CONVENTIONS, conventionFor } from '../src/template/rules'

import { buildCatalog } from './build'
import { measureCatalog, serialiseCatalog } from './emit'
import { deriveFamilies } from './families'
import type { GeneratedFamily } from './families'
import { FixtureRow, fixtureFingerprint, fixturesDir, loadFixtureRows } from './fixtures'
import { emptyManifest } from './ordinals'
import type { TemplateFixture } from './templates'
import {
  RECORDED_TAG_DEFECTS,
  TEMPLATES_MODULE_PATH,
  checkTemplateTags,
  loadTemplateFixtures,
  printFixture,
  printTemplateModule,
  readTemplateFile,
  tagDefectKey,
  templateConvention,
  templateSlug,
  templateTagDefects,
} from './templates'
import { PAYLOAD_TIMESTAMP, SIZE_BUDGET_BYTES } from './version'

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

  /**
   * Row B4's families, built once and lazily.
   *
   * The emitted module has two sources now, so the byte-identity assertion below
   * needs both — and the second one is a function of the *built corpus* rather
   * than of the fixtures directory, which is what makes its 0 B structural. Built
   * on first use so the two-thirds of this file that only reads YAML still runs
   * without paying for a corpus build.
   */
  let cachedFamilies: readonly GeneratedFamily[] | undefined
  const families = (): readonly GeneratedFamily[] => {
    cachedFamilies ??= deriveFamilies(
      buildCatalog({
        rows: loadFixtureRows(FIXTURES),
        manifest: emptyManifest(),
        fixturesRef: 'test',
        builtAt: PAYLOAD_TIMESTAMP,
      }).file,
    )
    return cachedFamilies
  }

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

  /* ------------------------------------------------------------ slot geometry */

  /**
   * Rebuilding the 8,702-tile corpus and brotli-ing 5.9 MB at quality 11, twice.
   * `role.test.ts` measures the same way for the same reason.
   */
  const SLOW_MS = 300_000

  describe('row B2’s slot conventions', () => {
    it('covers all 40 part-name sets, in the 32 / 4 / 4 split', () => {
      const per = new Map<string, number>()
      for (const entry of entries) {
        const convention = templateConvention(entry)
        per.set(convention.id, (per.get(convention.id) ?? 0) + 1)
      }
      expect(Object.fromEntries(per)).toEqual({
        'wall-on-tile': 32,
        'external-corner': 4,
        'internal-corner': 4,
      })
      expect(SLOT_CONVENTIONS).toHaveLength(3)
    })

    it('fails the import, naming the file and the template, on a set it does not know', () => {
      /* The whole point of reading the conventions from the pipeline. A
         twenty-first fixture file with a new part set is a template this project
         cannot lay out, and the honest place to find that out is
         `npm run import:catalog` — not the browser, where an unlaid-out template
         is indistinguishable from an archive gap. */
      const invented: TemplateFixture = {
        source: 'blueprints.s2w.invented.yaml',
        name: 'S2W: Wall on Tile: Ceiling (Any, Modular)',
        type: 'blueprint',
        tags: ['object|tile'],
        parts: [
          { name: 'ceiling', tags: { require: [{ tag: 'shape|roof' }] } },
          { name: 'floor', tags: { require: [{ tag: 'shape|floor' }] } },
          { name: 'base', tags: { require: [{ tag: 'shape|base' }] } },
        ],
      }
      expect(() => templateConvention(invented)).toThrow(/blueprints\.s2w\.invented\.yaml/)
      expect(() => templateConvention(invented)).toThrow(/no slot convention covers/)
      expect(() => printTemplateModule([...entries, invented], [])).toThrow(/no slot convention covers/)
    })

    it('keys on the part-name set, which the fixtures’ own shape tags cannot do', () => {
      /* Two of the four internal-corner entries carry `shape|corner`. Read from
         the fixtures rather than from the generated module, so the defect is
         observed at its source. Row **B6** files it upstream. */
      const misTagged = entries.filter(
        (entry) =>
          entry.tags.includes('shape|corner') &&
          conventionFor(entry.parts.map((part) => part.name))?.id === 'internal-corner',
      )
      expect(misTagged).toHaveLength(2)
      expect(misTagged.map((entry) => entry.source).sort()).toEqual([
        'blueprints.s2w.internal_corner.low.yaml',
        'blueprints.s2w.internal_corner.yaml',
      ])
      // And every one of them really has no wall part, which is what a
      // tag-keyed rule would have gone looking for.
      for (const entry of misTagged) {
        expect(entry.parts.map((part) => part.name)).not.toContain('wall')
      }
    })

    it(
      'adds 0 B to the index, against +808 B for shipping the same rule inside it',
      () => {
        /* The claim the row rests on, measured rather than argued. The
           conventions ship in the bundle, `pipeline/build.ts` never reaches this
           module, and the emitted artefact is therefore **byte-identical** to
           what row B1 pinned — which is what "0 B" has to mean to be checkable.

           Confirmed once directly as well, by building the same corpus at the
           same epoch from a tree with this row reverted: same raw length
           (5,907,324 B), same brotli (366,173 B) and the same SHA-256 of the
           serialised index, `cf21ab85ac304a20…`.

           The counterfactual here is the 128-row expansion of the same three
           rules as a `layouts` key, against **this** construction — a fresh
           build with an empty ordinal manifest. `src/template/corpus.test.ts`
           prices it against the shipped artefact instead and gets +222 B, and
           the research measured +374 B against the pre-B1 `catalog.json`. All
           three are the same table. Row B1 records the lesson in this same
           file: brotli is not additive over 5.9 MB, so a "this field costs N
           bytes" figure is a fact about one artefact at one epoch, never a
           rate. */
        const { file } = buildCatalog({
          rows: loadFixtureRows(FIXTURES),
          manifest: emptyManifest(),
          fixturesRef: 'test',
          builtAt: PAYLOAD_TIMESTAMP,
        })
        const json = serialiseCatalog(file)
        const shipped = measureCatalog(json)

        const layouts = entries.map((entry) => ({
          id: templateSlug(entry.name),
          slots: templateConvention(entry).slots.map((slot) => ({
            part: slot.part,
            anchor: slot.anchor,
            side: slot.side,
            restsOn: slot.restsOn,
          })),
        }))
        const withTable = measureCatalog(serialiseCatalog({ ...file, layouts } as never))

        process.stdout.write(
          `\n[template] index ${String(shipped.brotli)} B unchanged · the same rule inside it ` +
            `${String(withTable.brotli)} B (+${String(withTable.brotli - shipped.brotli)})\n`,
        )

        expect(shipped.brotli).toBe(366_173)
        expect(shipped.withinBudget).toBe(true)
        expect(shipped.brotli / SIZE_BUDGET_BYTES).toBeLessThan(0.72)
        // And nothing of the model is in the bytes, which is the structural half.
        for (const needle of ['anchor', 'restsOn', 'layouts', 'wall-on-tile', 'external-corner']) {
          expect(json).not.toContain(needle)
        }
        expect(layouts.reduce((total, one) => total + one.slots.length, 0)).toBe(128)
        expect(withTable.brotli - shipped.brotli).toBe(808)
      },
      SLOW_MS,
    )

    it('is not on the index’s path at all, so the 0 B is structural', () => {
      /* `pipeline/templates.ts` already documents that `build.ts` does not
         import it; this asserts it, and asserts the same of `emit.ts`, which is
         what actually writes the bytes. A future row wiring slot geometry into
         the index fails here rather than moving a byte count silently. */
      for (const module of ['pipeline/build.ts', 'pipeline/emit.ts']) {
        const source = readFileSync(module, 'utf8')
        expect(source, module).not.toContain("from './templates'")
        expect(source, module).not.toContain('src/template')
      }
    })
  })

  /* ------------------------------------------- row B6’s internal-corner defect */

  describe('the upstream internal-corner tag defect', () => {
    /** The one `shape|` tag each of the 40 carries. */
    const shapeTagsOf = (entry: TemplateFixture): readonly string[] =>
      entry.tags.filter((tag) => tag.startsWith('shape|'))

    it('tags four of the 40 shape|corner where only two are corners', () => {
      const tally = new Map<string, number>()
      for (const entry of entries) {
        const shape = shapeTagsOf(entry)
        // Exactly one `shape|` tag each, which is what makes the tally a
        // partition of the 40 rather than a count of tags.
        expect(shape, entry.name).toHaveLength(1)
        for (const tag of shape) tally.set(tag, (tally.get(tag) ?? 0) + 1)
      }

      expect(Object.fromEntries([...tally].sort())).toEqual({
        'shape|corner': 4,
        'shape|corner|low': 2,
        'shape|internal_corner': 1,
        'shape|internal_corner|low': 1,
        'shape|wall': 32,
      })
    })

    it('makes one internal corner tag-identical to an external one', () => {
      /* The sharpest reading of the defect, and the reason a tag key cannot be
         rescued by looking harder at the tags: these two templates carry the
         same five strings in the same order and are not the same shape. */
      const find = (name: string): TemplateFixture => {
        const entry = entries.find((each) => each.name === name)
        if (entry === undefined) throw new Error(`no template named ${name}`)
        return entry
      }
      const internal = find('S2W: Wall on Tile: Internal Corner: Low (Modular)')
      const external = find('S2W: Wall on Tile: Corner (Any, Modular)')

      expect(internal.tags).toEqual(external.tags)
      expect(internal.parts).toHaveLength(3)
      expect(external.parts).toHaveLength(5)
      // The low one loses its qualifier too: neither `internal_corner` nor `low`
      // survives, though its column part still requires `shape|column|low`.
      expect(internal.tags).toContain('shape|corner')
      expect(
        internal.parts.flatMap((part) => (part.tags.require ?? []).map((ref) => ref.tag)),
      ).toContain('shape|column|low')
    })

    it('is detected from each fixture’s own parts, on 4 of 4 and 0 of the other 36', () => {
      /* The signal the census is built on, measured in both directions. It has
         to be independent of the tag it is checking, or the check is circular. */
      const partsSayInternal = entries.filter((entry) =>
        entry.parts.some((part) =>
          (part.tags.require ?? []).some((ref) => ref.tag.split('|')[2] === 'internal_corner'),
        ),
      )

      expect(partsSayInternal).toHaveLength(4)
      expect(partsSayInternal.map((entry) => templateConvention(entry).id)).toEqual([
        'internal-corner',
        'internal-corner',
        'internal-corner',
        'internal-corner',
      ])
      // Every one of the four says so on its `floor` part; the two modular ones
      // say it on their `base` part as well.
      const requires = (entry: TemplateFixture, part: string): readonly string[] =>
        (entry.parts.find((each) => each.name === part)?.tags.require ?? []).map((ref) => ref.tag)
      for (const entry of partsSayInternal) {
        expect(requires(entry, 'floor'), entry.name).toContain('shape|floor|internal_corner')
      }
      expect(
        partsSayInternal.filter((entry) => requires(entry, 'base').includes('shape|base|internal_corner')),
      ).toHaveLength(2)
    })

    it('censuses exactly the two recorded templates, both Modular and both wall-less', () => {
      const defects = templateTagDefects(entries)

      expect(defects.map(tagDefectKey).sort()).toEqual([...RECORDED_TAG_DEFECTS].sort())
      for (const defect of defects) {
        expect(defect.carries).toEqual(['shape|corner'])
        expect(defect.part).toBe('floor')
        expect(defect.requires).toBe('shape|floor|internal_corner')
        expect(defect.name).toContain('Modular')
      }
      // Neither has a wall part, which is what a tag-keyed layout would have
      // gone looking for after handing them the external corner's convention.
      const named = defects.map((defect) => defect.name)
      for (const entry of entries.filter((each) => named.includes(each.name))) {
        expect(entry.parts.map((part) => part.name)).not.toContain('wall')
      }
    })

    it('passes the pinned fixtures, which is the only reason the import runs', () => {
      // `loadTemplateFixtures` calls this, so a red census fails
      // `npm run import:catalog` before it rewrites the generated module.
      expect(() => {
        checkTemplateTags(entries)
      }).not.toThrow()
    })

    it('fails, and says the defect is gone, when the census empties', () => {
      /* The direction a hard-coded allow-list of two names could not see.
         Upstream correcting either fixture is the good outcome and must still
         stop the import, because the workaround and the guard both become dead
         weight the moment it happens. */
      const repaired = entries.map((entry) =>
        entry.tags.includes('shape|corner') && entry.parts.every((part) => part.name !== 'wall')
          ? { ...entry, tags: entry.tags.map((tag) => (tag === 'shape|corner' ? 'shape|internal_corner' : tag)) }
          : entry,
      )

      expect(templateTagDefects(repaired)).toEqual([])
      expect(() => {
        checkTemplateTags(repaired)
      }).toThrow(/is gone/)
      expect(() => {
        checkTemplateTags(repaired)
      }).toThrow(/upstream fixing the data/)
    })

    it('fails, naming it, when a third template joins the census', () => {
      const invented: TemplateFixture = {
        source: 'blueprints.s2w.invented.yaml',
        name: 'S2W: Wall on Tile: Internal Corner (Any, Modular)',
        type: 'blueprint',
        tags: ['object|tile', 'build|s2w', 'shape|corner'],
        parts: [
          { name: 'column', tags: { require: [{ tag: 'size|column_shape|L' }] } },
          { name: 'floor', tags: { require: [{ tag: 'shape|floor|internal_corner' }] } },
          { name: 'base', tags: { require: [{ tag: 'shape|base' }] } },
        ],
      }

      expect(templateTagDefects([...entries, invented])).toHaveLength(3)
      expect(() => {
        checkTemplateTags([...entries, invented])
      }).toThrow(/blueprints\.s2w\.invented\.yaml/)
      expect(() => {
        checkTemplateTags([...entries, invented])
      }).toThrow(/census moved: 3 templates/)
    })

    it('is inherited by nothing, because those four templates carry no constrain', () => {
      /* The one path a template's own tags reach candidate resolution by:
         `assembly.ts` passes them to `resolveSlotTags` as the `parentTags` a
         `constrain` entry inherits. If the two defective templates had a
         `constrain` block, the wrong tag would be a live resolution bug rather
         than a labelling one — and the answer here would have had to be a
         normalisation. They do not. */
      const constrainCount = (entry: TemplateFixture): number =>
        entry.parts.reduce((total, part) => total + (part.tags.constrain ?? []).length, 0)
      const internal = entries.filter((entry) => templateConvention(entry).id === 'internal-corner')

      expect(internal).toHaveLength(4)
      expect(internal.map(constrainCount)).toEqual([0, 0, 0, 0])
      // And they are the only four of the 40 with none.
      expect(entries.filter((entry) => constrainCount(entry) === 0)).toHaveLength(4)
      const others = entries.filter((entry) => constrainCount(entry) > 0).map(constrainCount)
      expect(others).toHaveLength(36)
      expect(Math.min(...others)).toBe(3)
      expect(Math.max(...others)).toBe(8)
    })

    it(
      'leaves the emitted module carrying the fixtures’ own tags, defect included',
      () => {
        /* The decision, asserted rather than described: the guard records the
           defect and does not repair it, so the generated module is still
           provably the fixtures' content. A normalisation would show up here.

           **Both arms take the real emitter call, families included, and that
           is load-bearing since row B4.** The module has two sources now, so
           the tally below is a claim about the *whole* file rather than about
           its fixture half: a generated family whose tags spelled
           `shape|corner` would break it, and none does — the 51 emit only
           `role|`, `form|`, `build|` and `shape|base`. Passing `[]` here would
           still compile and would quietly narrow the assertion back to the 40,
           which is why this test pays for the corpus build. The byte-identity
           test below is the other half: it proves the committed file *is* this
           emitter's output, so the two arms are one artefact reached two ways. */
        const occurrences = (text: string, needle: string): number => text.split(needle).length - 1
        for (const text of [
          printTemplateModule(entries, families()),
          readFileSync(TEMPLATES_MODULE_PATH, 'utf8'),
        ]) {
          expect(text).toContain("name: 'S2W: Wall on Tile: Internal Corner: Low (Modular)'")
          // The fixtures' own tally survives into the module: four `shape|corner`,
          // one `shape|internal_corner|low`. A normalisation would read 2 and 2.
          expect(occurrences(text, "'shape|corner'")).toBe(4)
          expect(occurrences(text, "'shape|internal_corner|low'")).toBe(1)
          expect(occurrences(text, "'shape|internal_corner'")).toBe(1)
        }
      },
      SLOW_MS,
    )
  })

  /* ---------------------------------------------------------- the emitted module */

  it(
    'has the committed module byte-identical to the emitter’s output',
    () => {
      expect(
        printTemplateModule(entries, families()),
        `${TEMPLATES_MODULE_PATH} is out of date or hand-edited. ${REFRESH}`,
      ).toBe(readFileSync(TEMPLATES_MODULE_PATH, 'utf8'))
    },
    SLOW_MS,
  )

  it(
    'emits the 40 byte-for-byte identically with and without the family table',
    () => {
      /* The merge point's own property, and the reason rows B6 and B4 can both
         claim the module. B6 asserts the emitted module is byte-provably the
         *fixtures'* content; B4 changed the byte-identity assertion above to
         compare against **two** sources. Neither replaced the other, and this is
         what says so: the `RECIPE_TEMPLATES` region is identical whether the
         family table is emitted beside it or not, so the families are appended
         and change nothing about the 40.

         Without this, a future emitter change that interleaved the two — sorting
         all 91 into one array, say — would still pass both guards separately
         while destroying B6's claim, because its tally would then be counting
         family bytes it never measured. */
      const region = (text: string): string => {
        const from = text.indexOf('export const RECIPE_TEMPLATES')
        const to = text.indexOf('export const GENERATED_FAMILIES')
        expect(from).toBeGreaterThan(-1)
        return to < 0 ? text.slice(from) : text.slice(from, to)
      }
      const withFamilies = printTemplateModule(entries, families())
      expect(region(withFamilies)).toBe(region(printTemplateModule(entries, [])))
      expect(region(withFamilies)).toBe(region(readFileSync(TEMPLATES_MODULE_PATH, 'utf8')))

      /* And the other half of the same claim, from the family side: the only
         `shape|` tag the 51 families emit is `shape|base`, which is why B6's
         `shape|corner` tally is a statement about the whole file and not just
         about its fixture region. */
      const familyRegion = withFamilies.slice(withFamilies.indexOf('export const GENERATED_FAMILIES'))
      const shapeTags = new Set([...familyRegion.matchAll(/'(shape\|[^']*)'/g)].map((match) => match[1]))
      expect([...shapeTags]).toEqual(['shape|base'])
    },
    SLOW_MS,
  )

  it('slugs the 40 names to 40 distinct ids, and refuses to emit a collision', () => {
    const ids = entries.map((entry) => templateSlug(entry.name))
    expect(new Set(ids).size).toBe(40)
    expect(ids.every((id) => /^[a-z0-9-]+$/.test(id))).toBe(true)

    // The guard, shown failing: two entries whose names differ only in
    // punctuation slug to one id, and the emitter throws instead of emitting a
    // duplicate key the screen would render as a disappearing card.
    const [first] = entries
    if (first === undefined) throw new Error('no templates to build the collision from')
    expect(() => printTemplateModule([first, { ...first, name: `${first.name}!` }], [])).toThrow(/slug to/)
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
