/**
 * The 40 recipe templates: the other half of the fixtures directory, read at
 * last.
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
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { z } from 'zod'

import { PartSlot } from '../src/catalog'
import type { ConstrainRef, TagRef } from '../src/catalog'

import { fixturesDir } from './fixtures'

/**
 * Where the generated module is written and read back.
 *
 * Relative to the repository root, and a pipeline constant rather than a screen
 * one: the consumer's location is the app's business, the fact that a build step
 * owns the bytes is this module's.
 */
export const TEMPLATES_MODULE_PATH = 'src/screens/assemblies/templates.ts'

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
  return files.flatMap((name) => readTemplateFile(name, readFileSync(join(dir, name), 'utf8')))
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
 * The whole of {@link TEMPLATES_MODULE_PATH}, emitted from the fixtures.
 *
 * `templates.test.ts` asserts the committed file is byte-identical to what this
 * returns, so the module is *provably* the fixtures' content and not a
 * transcription of it. `npm run import:catalog` rewrites it, which is the only
 * thing that should: the header says so and the test enforces it.
 *
 * The emitted `fulfills` is flattened from the grammar's `[{ part: 'base' }]` to
 * `['base']`, which is a derivation and is named as one. `PartSlot.fulfills`
 * models the grammar because that is what a fixture writes; the module carries
 * the projection the consumer reads, the same way `CatalogRecord.blob` is a
 * projection of `file_metadata.md5`.
 */
export function printTemplateModule(entries: readonly TemplateFixture[]): string {
  const seen = new Set<string>()
  const body: string[] = []

  for (const entry of entries) {
    const id = templateSlug(entry.name)
    if (seen.has(id)) throw new Error(`two templates slug to ${id}`)
    seen.add(id)
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

  return `${[
    '/**',
    ' * The 40 recipe templates, as data.',
    ' *',
    ' * **Generated. Do not edit.** `pipeline/templates.ts` reads the 20 `*.yaml`',
    ' * fixtures beside the JSON and emits this file; `npm run import:catalog` writes',
    ' * it and `pipeline/templates.test.ts` asserts the committed bytes are exactly',
    " * `printTemplateModule(loadTemplateFixtures())`, so an edit here fails the suite",
    ' * rather than drifting quietly.',
    ' *',
    ' * The 40 are not in `catalog.json`: none of them carries `file_metadata`, so none',
    ' * is an STL and none is a `CatalogRecord`. Putting them in the index anyway was',
    ' * measured at +1,260 B brotli and declined — `pipeline/templates.ts` carries the',
    ' * table and the reason, which is that the recipe list is the one part of this',
    ' * screen that renders before the index lands.',
    ' *',
    ` * ${String(entries.length)} templates over ${String(new Set(entries.map((entry) => entry.source)).size)} fixture files, ${String(
      entries.reduce((total, entry) => total + entry.parts.length, 0),
    )} parts.`,
    ' */',
    "import type { RecipeTemplate } from './assembly'",
    '',
    'export const RECIPE_TEMPLATES: readonly RecipeTemplate[] = [',
    ...body,
    ']',
  ].join('\n')}\n`
}
