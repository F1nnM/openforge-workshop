/**
 * The 40 recipe templates: the other half of the fixtures directory, read at
 * last — and, since row **B4**, the merge point where they meet the generated
 * families.
 *
 * The 40 and the 51 have nothing in common upstream: one set is parsed out of
 * YAML and validated part-by-part against `PartSlot`, the other is a `GROUP BY`
 * over the emitted `(role, form, build)` tags in `pipeline/families.ts`. They
 * meet in {@link printTemplateModule}, which emits **one** file with three
 * exports, because they arrive in the browser through the same lazily-mounted
 * chunk and neither is in the index. That function's docblock carries the merge
 * decisions; everything below it is still about the 40 alone.
 *
 * ## What the 40 are, and why nothing had read them
 *
 * The fixtures directory holds **42 files — 21 `*.json` and 20 `*.yaml`** (plus
 * one `.py`), and the YAML carries **exactly 40 top-level blueprint entries, two
 * per file, over 128 parts**. `pipeline/fixtures.ts` reads only the JSON and says
 * so deliberately: *"globbing `*` here would silently change every number in the
 * plan."* That is right about every count in the plan, and it is also why the 40
 * had never been built — row C3 shipped them as generated data inside its own
 * screen directory and reported that *"the durable home for the 40 is
 * `pipeline/`, reading `*.yaml` beside the JSON. I don't own it."* This is that
 * home.
 *
 * They are templates rather than tiles for one structural reason: **none of the
 * 40 carries `file_metadata`**, so none is an STL, none becomes a
 * `CatalogRecord`, and none is in `catalog.json`. All 40 carry a `config`. They
 * are pure recipes — *"S2W: Wall on Tile: Wall: Torch (Modular)"* — naming parts
 * to be filled from the archive.
 *
 * ## A template cannot become a record, structurally
 *
 * Four independent facts. None of them is "the code is careful":
 *
 *   1. **Two loaders, two disjoint globs.** {@link loadTemplateFixtures} reads
 *      `*.yaml`; `loadFixtureRows` reads `*.json`. Both throw on an empty match,
 *      so neither can silently read the other's half.
 *   2. **{@link TemplateEntry} models no `file_metadata`** — not optionally,
 *      not at all — and `FixtureRow.file_metadata` is **required**. Feeding one
 *      of the 40 to `FixtureRow.safeParse` fails naming that field, and
 *      `templates.test.ts` runs exactly that rather than asserting it in prose.
 *   3. **Nothing here produces a `FixtureRow`, and `buildCatalog` takes
 *      nothing else.** `pipeline/build.ts` does not import this module; its only
 *      record source is its `rows` parameter, typed `readonly FixtureRow[]`.
 *   4. **The emitted index has no key a template could occupy.** Putting them in
 *      `catalog.json` was measured and declined — see "Why not the index" below.
 *
 * ## Why this is a reader and not a YAML dependency
 *
 * There is no YAML parser in this project and `package.json` belongs to row W0.
 * So this reads the fixtures' own subset of YAML, and it is **strict**: a table
 * over the exact `(indentation, key)` pairs the 20 files contain, throwing and
 * naming the file and line on anything else. The subset is small because the
 * fixtures are machine-regular — ASCII, LF, no tabs, no trailing space, two-space
 * indent, quotes on nothing but the two top-level scalars, and `require` →
 * `deny` → `constrain` in that order on all 128 parts.
 *
 * A strict reader that throws still cannot prove it read *correctly*, so it is
 * not asked to. {@link printFixture} re-emits a parsed file in the fixtures' own
 * layout and `templates.test.ts` asserts the result is **byte-identical to the
 * file on disk, for all 20**. A reader that dropped a key, folded two entries or
 * lost a `siblings` list could not round-trip. It needs no dependency and it is
 * a stronger check than agreeing with a second parser would be.
 *
 * **What is new here is where the round-trip passes through.** C3's reader had
 * its own private types, so its round-trip proved a property of C3's reader. This
 * one validates every part with `PartSlot` from `src/catalog/schema.ts` — the
 * app's shared grammar — so the byte-for-byte re-emission now also proves that
 * *the schema carries the whole grammar*. That is not a free upgrade: it only
 * became possible once `ConstrainRef` learned `siblings` and `PartSlot` learned
 * part-level `fulfills`, and with either widening reverted the round-trip fails
 * on 30 and 20 lines respectively. `templates.test.ts` demonstrates both
 * failures rather than describing them.
 *
 * ## Why not the index
 *
 * Measured at `PAYLOAD_EPOCH`, over the pinned corpus, with the real
 * ordinal manifest and thumbnail inventory — so it is comparable to every other
 * figure in `pipeline/version.ts`:
 *
 * | | raw | brotli | of budget |
 * | --- | ---: | ---: | ---: |
 * | `catalog.json` as merged | 5,907,360 B | 366,768 B | 71.6% |
 * | with a `templates` key | 5,946,827 B | 368,028 B | 71.9% |
 * | **the 40 would add** | **+39,467 B** | **+1,260 B** | **+0.25 pt** |
 * | the same 40 alone | 39,454 B | 1,452 B | — |
 *
 * So the index could afford them — 1,260 B is 0.86% of the 146,397 B of
 * headroom, and per row P3's warning that figure is a fact about one artefact at
 * one epoch rather than a rate. **The budget is not why they are not in there.**
 *
 * The reason is a property of C3's screen that the index would destroy.
 * `AssembliesScreen`'s recipe list *"needs no catalog — it is the one part of the
 * screen that works before the 5.6 MB index has landed"*, because a template has
 * no sprite and nothing to render but its name and its parts. Move the 40 into
 * `catalog.json` and the first thing that screen shows becomes the last thing
 * that arrives. A second fetched artefact has the same defect plus a sixth
 * artefact for row X4's stamp to cover.
 *
 * So the 40 stay **in the bundle**, in the lazily-mounted `/assemblies` chunk row
 * X9 landed — 1,474 B brotli of JavaScript, paid by the people who open the
 * screen and by nobody else, and 0 B of the index. What changes is who writes
 * them: {@link printTemplateModule} does, `npm run import:catalog` runs it, and
 * `templates.test.ts` fails when the committed module is not byte-for-byte what
 * this file emits. The path is {@link TEMPLATES_MODULE_PATH} and it is a constant
 * of this module, not of the screen.
 *
 * ## One thing here is not a reader
 *
 * {@link checkTemplateTags} is row **B6**'s answer to an upstream tag defect:
 * two of the four internal-corner templates carry `shape|corner`. The fixtures
 * are pinned and read-only, so this repo records the defect rather than
 * repairing it — and records it as a *census computed from each fixture's own
 * parts*, so that upstream fixing the data fails the import as loudly as
 * upstream breaking a third template would. The reasoning, and why a
 * normalisation was declined, is beside {@link TemplateTagDefect}.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { z } from 'zod'

import { PartSlot } from '../src/catalog'
import type { ConstrainRef, TagRef } from '../src/catalog'
import type { SlotConvention } from '../src/template/rules'
import { conventionFor } from '../src/template/rules'

import type { GeneratedFamily } from './families'
import { fixturesDir } from './fixtures'

/**
 * Where the generated module is written and read back.
 *
 * Relative to the repository root, and a pipeline constant rather than a screen
 * one: the consumer's location is the app's business, the fact that a build step
 * owns the bytes is this module's.
 */
export const TEMPLATES_MODULE_PATH = 'src/assembly/templates.ts'

/* ---------------------------------------------------------------- the fixture */

/**
 * One of the 40, exactly as the fixture writes it.
 *
 * `parts` is `PartSlot` — the app's own slot grammar from
 * `src/catalog/schema.ts` — and not a private shape. A template part and a
 * tile's accessory slot are the same six keys in the same grammar; the
 * difference between a recipe and a tile is `file_metadata`, which is a property
 * of the row and not of its parts.
 */
export interface TemplateFixture {
  /** The fixture's file name, kept as provenance. */
  readonly source: string
  /** `"S2W: Wall on Tile: Wall: Torch (Modular)"`. Unique across all 40. */
  readonly name: string
  /** `"blueprint"` on all 40. Carried so the round-trip can re-emit it. */
  readonly type: string
  /** The template's own tags — the `parentTags` a `constrain` entry reads. */
  readonly tags: readonly string[]
  readonly parts: readonly PartSlot[]
}

/**
 * The validated row shape. **There is no `file_metadata` here and that is the
 * point** — see the module note's second structural fact.
 *
 * Validated rather than cast for `pipeline/fixtures.ts`'s stated reason: the
 * fixtures are an external input maintained in another repository by a different
 * process, and a shape change there should fail this build with the offending
 * row's name rather than surface three layers later as `undefined` in a display
 * name.
 */
const TemplateEntry = z.object({
  name: z.string().min(1),
  /** `blueprint` on all 40; a `tile` in this half would mean the halves moved. */
  type: z.literal('blueprint'),
  tags: z.array(z.string().min(1)).min(1),
  config: z.object({ parts: z.array(PartSlot).min(1) }),
})

/** The same override `pipeline/fixtures.ts` honours, so one env var points both. */
export function templateFixturesDir(explicit?: string): string {
  return fixturesDir(explicit)
}

/* ----------------------------------------------------------------- the reader */

/** One tokenised line. `indent` counts leading spaces, before any `- `. */
interface Row {
  readonly no: number
  readonly indent: number
  readonly dash: boolean
  readonly key: string | undefined
  readonly value: string
}

const KEYED = /^([a-z_]+):(?: (.*))?$/

function tokenise(text: string): Row[] {
  const rows: Row[] = []
  text.split('\n').forEach((line, at) => {
    if (line === '') return
    const lead = /^ */.exec(line)?.[0].length ?? 0
    let rest = line.slice(lead)
    let dash = false
    if (rest.startsWith('- ')) {
      dash = true
      rest = rest.slice(2)
    }
    const keyed = KEYED.exec(rest)
    rows.push({
      no: at + 1,
      indent: lead,
      dash,
      key: keyed?.[1],
      value: keyed === null ? rest : (keyed[2] ?? ''),
    })
  })
  return rows
}

/**
 * A cursor over the tokenised rows, so every production below reads like the
 * grammar it accepts.
 *
 * A factory rather than a class for the reason `erasableSyntaxOnly` enforces
 * repo-wide: constructor parameter properties are not erasable syntax, and this
 * project compiles with them banned.
 */
interface Cursor {
  readonly source: string
  readonly done: boolean
  /** The next row without consuming it. */
  peek(): Row | undefined
  /** True when the next row is exactly this shape. Never throws. */
  looksLike(indent: number, dash: boolean, key?: string): boolean
  /** Consume a row of exactly this shape, or throw naming the file and line. */
  take(indent: number, dash: boolean, key: string | undefined): Row
  fail(why: string, row?: Row): never
}

function describeShape(indent: number, dash: boolean, key: string | undefined): string {
  const shape = key === undefined ? 'a bare scalar' : `\`${key}:\``
  return `${shape} at indent ${String(indent)}${dash ? ' under a dash' : ''}`
}

function cursorOver(source: string, rows: readonly Row[]): Cursor {
  let at = 0

  function peek(): Row | undefined {
    return rows[at]
  }

  function fail(why: string, row?: Row): never {
    const where = row ?? peek()
    throw new Error(`${source}:${where === undefined ? 'EOF' : String(where.no)}: ${why}`)
  }

  function looksLike(indent: number, dash: boolean, key?: string): boolean {
    const row = peek()
    if (row === undefined) return false
    return row.indent === indent && row.dash === dash && (key === undefined || row.key === key)
  }

  function take(indent: number, dash: boolean, key: string | undefined): Row {
    const row = peek()
    if (row === undefined) fail(`expected ${describeShape(indent, dash, key)}, reached end of file`)
    if (row.indent !== indent || row.dash !== dash || row.key !== key) {
      fail(
        `expected ${describeShape(indent, dash, key)}, found ${describeShape(row.indent, row.dash, row.key)}`,
        row,
      )
    }
    at += 1
    return row
  }

  return {
    source,
    get done() {
      return at >= rows.length
    },
    peek,
    looksLike,
    take,
    fail,
  }
}

/** `"S2W: …"` to `S2W: …`. Throws on an internal quote rather than guessing. */
function unquote(cursor: Cursor, row: Row): string {
  const raw = row.value
  if (!raw.startsWith('"') || !raw.endsWith('"') || raw.length < 2) {
    cursor.fail(`expected a double-quoted scalar, found ${raw}`, row)
  }
  const inner = raw.slice(1, -1)
  if (inner.includes('"') || inner.includes('\\')) {
    cursor.fail('quoted scalar carries a quote or an escape, which this reader does not model', row)
  }
  return inner
}

/** `[a, b]` to `['a', 'b']`. The only flow collection in the fixtures. */
function flowList(cursor: Cursor, row: Row): string[] {
  const raw = row.value
  if (!raw.startsWith('[') || !raw.endsWith(']')) {
    cursor.fail(`expected a flow sequence, found ${raw}`, row)
  }
  const inner = raw.slice(1, -1)
  if (inner.trim() === '') cursor.fail('empty flow sequence, which the fixtures never write', row)
  return inner.split(',').map((part) => {
    const trimmed = part.trim()
    if (trimmed === '') cursor.fail(`empty member in ${raw}`, row)
    return trimmed
  })
}

/** `tag:` / `filter:` refs at indent 12, each optionally carrying `siblings`. */
function readConstrain(cursor: Cursor): ConstrainRef[] {
  const out: ConstrainRef[] = []
  while (cursor.looksLike(12, true)) {
    const row = cursor.peek()
    if (row === undefined) break
    if (row.key !== 'tag' && row.key !== 'filter') {
      cursor.fail(`\`constrain\` admits \`tag\` and \`filter\`, not \`${String(row.key)}\``, row)
    }
    cursor.take(12, true, row.key)
    const siblings = cursor.looksLike(14, false, 'siblings')
      ? flowList(cursor, cursor.take(14, false, 'siblings'))
      : undefined
    if (row.key === 'filter') {
      if (siblings !== undefined) {
        // A `filter` removes a prefix from what the `tag` entries collected, so
        // it has nothing to inherit and no source to control. `ConstrainRef`'s
        // union would quietly match its second branch and drop the list, which
        // is the silent strip this row exists to stop; refusing it is the
        // difference between reading the grammar and inventing a wider one.
        cursor.fail('a `filter` entry cannot carry `siblings`', row)
      }
      out.push({ filter: row.value })
      continue
    }
    out.push(siblings === undefined ? { tag: row.value } : { tag: row.value, siblings })
  }
  return out
}

/** `- tag: x` refs at indent 12, with no source control. */
function readTagRefs(cursor: Cursor): TagRef[] {
  const out: TagRef[] = []
  while (cursor.looksLike(12, true, 'tag')) out.push({ tag: cursor.take(12, true, 'tag').value })
  if (out.length === 0) cursor.fail('a require/deny block with no `tag` entry')
  return out
}

function readPart(cursor: Cursor): unknown {
  const name = cursor.take(6, true, 'name').value
  cursor.take(8, false, 'tags')

  cursor.take(10, false, 'require')
  const require = readTagRefs(cursor)

  const deny = cursor.looksLike(10, false, 'deny') ? (cursor.take(10, false, 'deny'), readTagRefs(cursor)) : []

  const constrain = cursor.looksLike(10, false, 'constrain')
    ? (cursor.take(10, false, 'constrain'), readConstrain(cursor))
    : []
  if (cursor.looksLike(10, false, 'constrain')) cursor.fail('two `constrain` blocks on one part')

  const fulfills: { part: string }[] = []
  if (cursor.looksLike(8, false, 'fulfills')) {
    cursor.take(8, false, 'fulfills')
    while (cursor.looksLike(10, true, 'part')) fulfills.push({ part: cursor.take(10, true, 'part').value })
    if (fulfills.length === 0) cursor.fail('a `fulfills` block with no `part` entry')
  }

  // Assembled untyped and handed to `PartSlot` to validate, so the schema is the
  // thing that decides what a part is. Building a typed object here and parsing
  // it afterwards would let a key the schema drops still reach a caller.
  return {
    name,
    tags: {
      require,
      ...(deny.length > 0 ? { deny } : {}),
      ...(constrain.length > 0 ? { constrain } : {}),
    },
    ...(fulfills.length > 0 ? { fulfills } : {}),
  }
}

function readEntry(cursor: Cursor): TemplateFixture {
  const name = unquote(cursor, cursor.take(0, true, 'name'))
  const type = unquote(cursor, cursor.take(2, false, 'type'))

  cursor.take(2, false, 'tags')
  const tags: string[] = []
  while (cursor.looksLike(4, true, undefined)) tags.push(cursor.take(4, true, undefined).value)

  cursor.take(2, false, 'config')
  cursor.take(4, false, 'parts')
  const parts: unknown[] = []
  while (cursor.looksLike(6, true, 'name')) parts.push(readPart(cursor))

  const result = TemplateEntry.safeParse({ name, type, tags, config: { parts } })
  if (!result.success) {
    cursor.fail(`${name} does not match the template shape: ${result.error.message}`)
  }
  return {
    source: cursor.source,
    name: result.data.name,
    type: result.data.type,
    tags: result.data.tags,
    parts: result.data.config.parts,
  }
}

/** Every template in one fixture file. Throws on anything the subset omits. */
export function readTemplateFile(source: string, text: string): readonly TemplateFixture[] {
  const cursor = cursorOver(source, tokenise(text))
  const out: TemplateFixture[] = []
  while (!cursor.done) out.push(readEntry(cursor))
  return out
}

/**
 * All 40 templates, in sorted `readdir` order — so the emitted module is
 * deterministic across machines.
 *
 * Throws on an empty match, exactly as `loadFixtureRows` does for the JSON: a
 * directory with no `*.yaml` is a wrong path, and 0 templates is not a fact
 * about the archive.
 */
export function loadTemplateFixtures(dir: string = templateFixturesDir()): readonly TemplateFixture[] {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.yaml'))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  if (files.length === 0) throw new Error(`no *.yaml fixtures in ${dir}`)
  const entries = files.flatMap((name) => readTemplateFile(name, readFileSync(join(dir, name), 'utf8')))
  /* The complete pinned set is the only place the tag-defect census means
     anything, and this is the only function that has it. See below. */
  checkTemplateTags(entries)
  return entries
}

/* ------------------------------------------------ the internal-corner defect */

/**
 * The upstream tag defect this repo records rather than repairs.
 *
 * **Two of the four internal-corner templates carry `shape|corner`** where
 * their siblings carry `shape|internal_corner`, and one of the two loses its
 * `|low` qualifier with it. Measured over all 40, each of which carries exactly
 * one `shape|` tag:
 *
 * | `shape|` tag | templates |
 * | --- | ---: |
 * | `shape\|wall` | 32 |
 * | `shape\|corner` | **4** |
 * | `shape\|corner\|low` | 2 |
 * | `shape\|internal_corner` | 1 |
 * | `shape\|internal_corner\|low` | 1 |
 *
 * Four templates are tagged `shape|corner` where only two are corners. The
 * sharpest form of it: `S2W: Wall on Tile: Internal Corner: Low (Modular)`
 * carries a tag list **identical, string for string, to
 * `S2W: Wall on Tile: Corner (Any, Modular)`** — five tags, same order — while
 * having three parts against the other's five. On tags alone those two
 * templates are the same template.
 *
 * `shape|corner` is not a coarser reading of `shape|internal_corner`; the two
 * are **siblings** under `shape|`, so this is a wrong answer rather than a
 * partial one. The fixtures do also drop a *qualifier* twice — both
 * `blueprints.s2w.wall.wall+low.yaml` entries carry plain `shape|wall` while
 * requiring `shape|wall|low` on their wall part — and that is a defensible
 * family root, which is why the check below is about the form and not about the
 * qualifier.
 *
 * ## Why this is a guard and not a normalisation
 *
 * The tempting fix is to rewrite the tag on the way in. Declined, for three
 * measured reasons and one structural one:
 *
 *   1. **It would falsify this module's central claim.** Everything here rests
 *      on one property: `printFixture` re-emits the fixtures byte for byte and
 *      {@link printTemplateModule}'s output is asserted byte-identical to the
 *      committed module, so `src/screens/assemblies/templates.ts` is *provably*
 *      the fixtures' content. Rewrite a tag and the shipped module carries a
 *      string that appears in no fixture, with the normaliser as the only
 *      witness that the difference is exactly the correction.
 *   2. **Nothing reads a template's `shape|` tag, and the one path that could
 *      is empty on exactly these four templates.** `AssembliesScreen` groups on
 *      `build|s2w|single_piece` / `build|s2w|modular`; `measure.ts` and
 *      `assemblies.test.ts` read tag *roots* only; every layout decision keys on
 *      the part-name set, which is right on 40 of 40. The one path that reaches
 *      candidate resolution is `assembly.ts`'s
 *      `resolveSlotTags(part.tags, template.tags, ...)`, where a template's own
 *      tags are the `parentTags` a `constrain` entry inherits — and **all four
 *      internal-corner templates carry 0 `constrain` entries**, the only 4 of
 *      the 40 that do; the other 36 carry between 3 and 8. So the wrong tag is
 *      inherited by nothing, and the correction has no beneficiary today.
 *   3. **It would erase two rows' evidence.** `src/template/rules.test.ts` and
 *      `pipeline/templates.test.ts` both measure this defect off the fixtures to
 *      justify keying on the part-name set. A normalisation turns both green by
 *      vacuity, and both live in directories row B6 does not own.
 *   4. The fixtures are pinned and read-only (`.github/fixtures.env`), so the
 *      real repair belongs upstream and this repo's job is to notice.
 *
 * ## Why the predicate is the contradiction and not the spelling
 *
 * A hard-coded list of two `(source, name)` pairs cannot tell whether upstream
 * fixed the data — it would keep passing over corrected fixtures for ever. A
 * bare `count !== 2` cannot say which template moved. So the census below is
 * computed from a signal **inside each fixture**: a template whose own parts
 * require an `internal_corner` form while its own `shape|` tag names a
 * different one. Measured over the 40, the parts say `internal_corner` on
 * **4 of 4** internal corners and on **0 of the other 36** — every one of the
 * four requires `shape|floor|internal_corner` on its `floor` part, and the two
 * modular ones additionally require `shape|base|internal_corner`.
 *
 * That predicate fires in both directions. Upstream fixing either template
 * drops the census below two and {@link checkTemplateTags} fails the import
 * saying so; a third mis-tagged template raises it and fails naming that one.
 */
export interface TemplateTagDefect {
  /** The fixture file. */
  readonly source: string
  /** The template's name, which is unique across all 40. */
  readonly name: string
  /** The `shape|` tag it carries — exactly one on all 40. */
  readonly carries: readonly string[]
  /** The part whose `require` contradicts it. */
  readonly part: string
  /** That part's contradicting `require` tag. */
  readonly requires: string
}

/** The form segment of a `shape|`-rooted tag, or `undefined` for a bare root. */
function shapeForm(tag: string, at: 1 | 2): string | undefined {
  const parts = tag.split('|')
  return parts[0] === 'shape' ? parts[at] : undefined
}

/**
 * The tag-defect census over a set of templates.
 *
 * A template is a defect when one of its parts requires a `shape|<x>|<form>`
 * tag whose `<form>` its own `shape|` tag does not name. Only
 * `internal_corner` is treated as such a form, and deliberately: it is the one
 * the fixtures contradict themselves about, and the one whose mis-spelling
 * names a sibling rather than a coarser parent.
 */
export function templateTagDefects(entries: readonly TemplateFixture[]): readonly TemplateTagDefect[] {
  const out: TemplateTagDefect[] = []
  for (const entry of entries) {
    const carries = entry.tags.filter((tag) => tag.startsWith('shape|'))
    const claimed = new Set(carries.map((tag) => shapeForm(tag, 1)))
    for (const part of entry.parts) {
      const ref = (part.tags.require ?? []).find((each) => shapeForm(each.tag, 2) === 'internal_corner')
      if (ref === undefined || claimed.has('internal_corner')) continue
      out.push({ source: entry.source, name: entry.name, carries, part: part.name, requires: ref.tag })
      break
    }
  }
  return out
}

/**
 * The two defects this repo has recorded, at `OPENFORGE_CATALOG_SHA`.
 *
 * Both are the `(Modular)` entry of their file, both carry `shape|corner`, and
 * neither has a `wall` part at all — so a tag-keyed layout would hand an
 * internal corner an external corner's two-wall convention and then look for
 * `right wall` and `left wall` fills that cannot exist.
 */
export const RECORDED_TAG_DEFECTS: readonly string[] = [
  'blueprints.s2w.internal_corner.low.yaml: S2W: Wall on Tile: Internal Corner: Low (Modular)',
  'blueprints.s2w.internal_corner.yaml: S2W: Wall on Tile: Internal Corner (Modular)',
]

/** `source: name`, the form {@link RECORDED_TAG_DEFECTS} is written in. */
export function tagDefectKey(defect: TemplateTagDefect): string {
  return `${defect.source}: ${defect.name}`
}

const DEFECT_ADVICE =
  'The fixtures are pinned and read-only, so this repo records the defect instead of repairing it: ' +
  'see the census in pipeline/templates.ts, RECORDED_TAG_DEFECTS beside it, ' +
  "and src/template/rules.test.ts's tag-key measurement."

/**
 * The guard: the census must be exactly {@link RECORDED_TAG_DEFECTS}, or the
 * import fails saying which way it moved.
 *
 * Called from {@link loadTemplateFixtures}, because that is the only function
 * that holds the complete pinned set and because it is what
 * `npm run import:catalog` calls before it regenerates the module. A fixture
 * refresh therefore lands on this rather than quietly rewriting
 * `src/screens/assemblies/templates.ts` with a different census behind it.
 *
 * The empty case gets its own message, because it is the good news and reads as
 * a failure otherwise: nothing to work around means the workaround and this
 * guard should go.
 */
export function checkTemplateTags(entries: readonly TemplateFixture[]): void {
  const found = templateTagDefects(entries).map(tagDefectKey).sort()
  const expected = [...RECORDED_TAG_DEFECTS].sort()
  if (found.length === expected.length && found.every((key, at) => key === expected[at])) return

  if (found.length === 0) {
    throw new Error(
      'the upstream internal-corner tag defect is gone: no template contradicts its own parts, ' +
        `where ${String(expected.length)} did at the pinned fixtures. This is upstream fixing the data. ` +
        'Delete RECORDED_TAG_DEFECTS, this guard and its test, and the tag-key measurements in ' +
        'pipeline/templates.test.ts and src/template/rules.test.ts that exist only because of it.',
    )
  }

  const gone = expected.filter((key) => !found.includes(key))
  const added = found.filter((key) => !expected.includes(key))
  const subject = found.length === 1 ? 'template contradicts' : 'templates contradict'
  throw new Error(
    `the internal-corner tag defect census moved: ${String(found.length)} ${subject} their own ` +
      `parts, against the ${String(expected.length)} recorded.` +
      (added.length > 0 ? ` No longer recorded: ${added.join(' | ')}.` : '') +
      (gone.length > 0 ? ` Recorded but no longer found: ${gone.join(' | ')}.` : '') +
      ` ${DEFECT_ADVICE}`,
  )
}

/* -------------------------------------------------------------- slot geometry */

/**
 * The layout convention for one template, or a throw naming the template.
 *
 * Row **B2**'s build-time gate, and the one thing the pipeline does with slot
 * geometry. Nothing is *emitted*: the three conventions ship in the bundle in
 * `src/template/rules.ts`, and the index gains **0 B** — a 128-row expansion of
 * the same rule as a `layouts` key was measured at **+222 B** brotli against the
 * shipped artefact at the payload epoch and declined, exactly as the 40
 * templates themselves were. `templates.test.ts` asserts the 0 B rather than
 * quoting it, by rebuilding the corpus and comparing the emitted bytes;
 * `src/template/corpus.test.ts` prices the counterfactual against the shipped
 * artefact.
 *
 * What the gate is for: `conventionFor` is keyed on the **part-name set**, which
 * classifies 40 of 40, and a set it does not know is a template this project
 * cannot lay out. Reading it here makes that a failure of
 * `npm run import:catalog`, naming the file and the template, rather than a
 * template that reaches the browser with no geometry and reads as an archive
 * gap. `src/template/rules.ts` is deliberately import-free so this crossing
 * costs `tsconfig.node.json` one named file and no transitive dependency.
 */
export function templateConvention(entry: TemplateFixture): SlotConvention {
  const convention = conventionFor(entry.parts.map((part) => part.name))
  if (convention === undefined) {
    throw new Error(
      `${entry.source}: ${entry.name} has the part set ` +
        `[${entry.parts.map((part) => part.name).join(', ')}], which no slot convention covers — ` +
        'author one in src/template/rules.ts',
    )
  }
  return convention
}

/* ------------------------------------------------------------- the round-trip */

/**
 * A parsed file back in the fixtures' own layout, byte for byte.
 *
 * The whole point is the assertion in `templates.test.ts`: this must equal the
 * file it was read from, for all 20. Every layout decision here is therefore an
 * observation rather than a preference — quotes on `name` and `type` and on
 * nothing else, `require` before `deny` before `constrain`, one blank line
 * between entries, a trailing newline and no trailing blank line.
 */
export function printFixture(entries: readonly TemplateFixture[]): string {
  const lines: string[] = []
  entries.forEach((entry, at) => {
    if (at > 0) lines.push('')
    lines.push(`- name: "${entry.name}"`)
    lines.push(`  type: "${entry.type}"`)
    lines.push('  tags:')
    for (const tag of entry.tags) lines.push(`    - ${tag}`)
    lines.push('  config:')
    lines.push('    parts:')
    for (const part of entry.parts) lines.push(...printFixturePart(part))
  })
  return `${lines.join('\n')}\n`
}

function printFixturePart(part: PartSlot): string[] {
  const lines = [`      - name: ${part.name}`, '        tags:', '          require:']
  for (const ref of part.tags.require ?? []) lines.push(`            - tag: ${ref.tag}`)
  if ((part.tags.deny ?? []).length > 0) {
    lines.push('          deny:')
    for (const ref of part.tags.deny ?? []) lines.push(`            - tag: ${ref.tag}`)
  }
  if ((part.tags.constrain ?? []).length > 0) {
    lines.push('          constrain:')
    for (const ref of part.tags.constrain ?? []) {
      if ('filter' in ref) {
        lines.push(`            - filter: ${ref.filter}`)
        continue
      }
      lines.push(`            - tag: ${ref.tag}`)
      if (ref.siblings !== undefined) lines.push(`              siblings: [${ref.siblings.join(', ')}]`)
    }
  }
  if ((part.fulfills ?? []).length > 0) {
    lines.push('        fulfills:')
    for (const ref of part.fulfills ?? []) lines.push(`          - part: ${ref.part}`)
  }
  return lines
}

/* ------------------------------------------------------------ the shipped data */

/**
 * A template's id: a slug of its name.
 *
 * Derived from the name rather than from the file, because the two entries in a
 * file differ only by their name and a file-derived id would need an ordinal —
 * exactly the kind of position row A5 is careful never to persist. The 40 names
 * are distinct and so are the 40 slugs; {@link printTemplateModule} throws on a
 * collision rather than emitting one.
 */
export function templateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function quote(value: string): string {
  if (value.includes("'") || value.includes('\\')) {
    throw new Error(`fixture scalar needs escaping, which the emitter does not do: ${value}`)
  }
  return `'${value}'`
}

function printConstrain(ref: ConstrainRef): string {
  if ('filter' in ref) return `{ filter: ${quote(ref.filter)} }`
  const tag = `tag: ${quote(ref.tag)}`
  if (ref.siblings === undefined) return `{ ${tag} }`
  return `{ ${tag}, siblings: [${ref.siblings.map(quote).join(', ')}] }`
}

function printModulePart(part: PartSlot): string[] {
  const refs = (list: readonly TagRef[]): string => list.map((ref) => `{ tag: ${quote(ref.tag)} }`).join(', ')
  const tags: string[] = [`require: [${refs(part.tags.require ?? [])}]`]
  if ((part.tags.deny ?? []).length > 0) {
    tags.push(`deny: [${refs(part.tags.deny ?? [])}]`)
  }
  if ((part.tags.constrain ?? []).length > 0) {
    tags.push(`constrain: [${(part.tags.constrain ?? []).map(printConstrain).join(', ')}]`)
  }
  return [
    '      {',
    `        name: ${quote(part.name)},`,
    '        tags: {',
    ...tags.map((line) => `          ${line},`),
    '        },',
    `        fulfills: [${(part.fulfills ?? []).map((ref) => quote(ref.part)).join(', ')}],`,
    '      },',
  ]
}

/**
 * The whole of {@link TEMPLATES_MODULE_PATH}, emitted from the fixtures **and**
 * from row B4's generated families.
 *
 * `templates.test.ts` asserts the committed file is byte-identical to what this
 * returns, so the module is *provably* its two sources' content and not a
 * transcription of it. `npm run import:catalog` rewrites it, which is the only
 * thing that should: the header says so and the test enforces it.
 *
 * ## Two sources, three exports, one file
 *
 * The 40 come from YAML and are validated part-by-part against `PartSlot`; the
 * families come from the *corpus*, keyed on the `(role, form, build)` tags
 * `pipeline/build.ts` already interned. They meet only here, and they meet as the
 * same emitted type: `RecipeTemplate` covers both without a field to spare,
 * because a family's `tags` are the `parentTags` its size positions are joined
 * against and its `source` is the corpus key it was derived from.
 *
 * **A third source was here and has been withdrawn.** Row E3's
 * `pipeline/authored.ts` derived two assemblies from named slots of the YAML and
 * appended them below a marker; both of them widened a floor slot off its
 * `build|s2w` requirement, which is the defect `src/template/rules.ts`'s
 * `SLOT_CONVENTIONS` docblock measures. With it gone `RECIPE_TEMPLATES` is again
 * exactly the fixtures' content, so the marker and the byte-identity guard that
 * cut the array on it go too — the *whole* array is now what `templates.test.ts`
 * compares, which is the stronger claim the marker was standing in for.
 *
 * The **families** stay a separate array, and that is not tidiness: a family has
 * one slot, no layout convention and its own size control, and `families.ts`
 * gives it a role heading in the single-tile section of the palette.
 * `src/builder/panels/families.ts` keys the palette's assemblies *section* on
 * which of the two arrays a template came from and nothing else, so an assembly
 * emitted anywhere but `RECIPE_TEMPLATES` reaches the browser as a one-slot
 * single-tile row under a role heading — the exact defect the owner reported and
 * row D2 repaired.
 *
 * The `id` namespace is shared, though, and checked as one: {@link templateSlug}
 * and `families.ts#familySlug` are the same construction and a collision between
 * a fixture slug and a family key throws here rather than becoming a duplicate
 * React key.
 *
 * The emitted `fulfills` is flattened from the grammar's `[{ part: 'base' }]` to
 * `['base']`, which is a derivation and is named as one. `PartSlot.fulfills`
 * models the grammar because that is what a fixture writes; the module carries
 * the projection the consumer reads, the same way `CatalogRecord.blob` is a
 * projection of `file_metadata.md5`.
 */
export function printTemplateModule(
  entries: readonly TemplateFixture[],
  families: readonly GeneratedFamily[],
): string {
  const seen = new Set<string>()
  const body: string[] = []

  const emit = (entry: TemplateFixture): void => {
    const id = templateSlug(entry.name)
    if (seen.has(id)) throw new Error(`two templates slug to ${id}`)
    seen.add(id)
    /* Row B2's gate, run here because this is what `npm run import:catalog`
       calls. It emits nothing — the conventions ship in the bundle and the index
       gains 0 B — so the bytes below are unchanged by it, and a fixture with an
       unknown part set fails the import rather than the browser. */
    templateConvention(entry)
    body.push(
      '  {',
      `    id: ${quote(id)},`,
      `    name: ${quote(entry.name)},`,
      `    source: ${quote(entry.source)},`,
      `    tags: [${entry.tags.map(quote).join(', ')}],`,
      '    parts: [',
      ...entry.parts.flatMap(printModulePart),
      '    ],',
      '  },',
    )
  }

  for (const entry of entries) emit(entry)

  const familyBody: string[] = []
  for (const family of families) {
    if (seen.has(family.id)) throw new Error(`two templates slug to ${family.id}`)
    seen.add(family.id)
    familyBody.push(
      '  {',
      `    id: ${quote(family.id)},`,
      `    name: ${quote(family.name)},`,
      /* The corpus key — a generated family's whole provenance, and the answer a
         fixture template gives with a file name. */
      `    source: ${quote(family.key)},`,
      `    tags: [${family.tags.map(quote).join(', ')}],`,
      '    parts: [',
      ...printModulePart(family.slot),
      '    ],',
      '  },',
    )
  }

  const sizeBody = families.map(
    (family) =>
      `  ${quote(family.id)}: [${family.sizes
        .map((size) => `{ label: ${quote(size.label)}, tags: [${size.tags.map(quote).join(', ')}] }`)
        .join(', ')}],`,
  )

  return `${[
    '/**',
    ` * The ${String(entries.length)} recipe templates and the ${String(families.length)} generated families, as data.`,
    ' *',
    ' * **Generated. Do not edit.** `pipeline/templates.ts` reads the 20 `*.yaml`',
    ' * fixtures beside the JSON, `pipeline/families.ts` derives the families',
    ' * from the built corpus, and this file is what the two emit;',
    ' * `npm run import:catalog` writes it and `pipeline/templates.test.ts` asserts the',
    ' * committed bytes are exactly what the emitter returns, so an edit here fails the',
    ' * suite rather than drifting quietly.',
    ' *',
    ` * \`RECIPE_TEMPLATES\` is the ${String(entries.length)} read from the fixtures and nothing else — all`,
    ' * of them `S2W: Wall on Tile`, reaching 35.4% of the corpus.',
    ' * `GENERATED_FAMILIES` is one',
    ' * family per `(role, form, build)` key the emitted tags already carry, each with',
    ' * one required slot denying `shape|base`, plus the bare-base family no such key',
    ' * can name and which requires it.',
    ' * `GENERATED_FAMILY_SIZES` is each family’s size control keyed by family id: a',
    ' * placed instance adds a position’s tags to its `parentTags`, where the slot’s own',
    ' * `constrain` block collects them, so size costs no new resolution code at all.',
    ' * `pipeline/families.ts` carries every measurement behind all three.',
    ' *',
    ' * None of it is in `catalog.json`. No template carries `file_metadata`, so none is',
    ' * an STL and none is a `CatalogRecord`; putting the 40 in the index anyway was',
    ' * measured at +1,260 B brotli and declined. Every ref the families emit is a tag',
    ' * the corpus already carries, so the index gains 0 B and the tag table stays at 930',
    ' * strings. The reason both live in the bundle is that the recipe list is the one',
    ' * part of the builder’s palette that renders before the index lands.',
    ' *',
    ` * ${String(entries.length)} templates over ${String(new Set(entries.map((entry) => entry.source)).size)} fixture files, ${String(
      entries.reduce((total, entry) => total + entry.parts.length, 0),
    )} parts.`,
    ` * ${String(families.length)} generated families over ${String(
      families.reduce((total, family) => total + family.records, 0),
    )} records, ${String(families.reduce((total, family) => total + family.sizes.length, 0))} size positions.`,
    ' */',
    "import type { RecipeTemplate } from './recipeWalk'",
    '',
    'export const RECIPE_TEMPLATES: readonly RecipeTemplate[] = [',
    ...body,
    ']',
    '',
    'export const GENERATED_FAMILIES: readonly RecipeTemplate[] = [',
    ...familyBody,
    ']',
    '',
    'export const GENERATED_FAMILY_SIZES: Readonly<',
    '  Record<string, readonly { readonly label: string; readonly tags: readonly string[] }[]>',
    '> = {',
    ...sizeBody,
    '}',
  ].join('\n')}\n`
}
