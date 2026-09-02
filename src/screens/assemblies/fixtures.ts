/**
 * Reading the 40 recipe templates out of the blueprint fixtures, and proving the
 * reader lost nothing.
 *
 * ## What the "40 recipe templates" actually are
 *
 * `architecture-plan.md` §14 item 7 and this row's line in `v2-pr-series.md` both
 * say *"the 40 recipe templates"* and neither says where the 40 came from. It is
 * a real, exact count and this file is where it is checked: the fixtures
 * directory holds **42 files — 21 `*.json` and 20 `*.yaml`**, plus one that is
 * neither, and the YAML files carry **exactly 40 top-level blueprint entries**,
 * two per file.
 *
 * They are templates rather than tiles for one structural reason: **none of the
 * 40 carries `file_metadata`**, so none of them is an STL, none becomes a
 * `CatalogRecord`, and none is in `catalog.json`. All 40 carry a `config`. They
 * are pure recipes — *"S2W: Wall on Tile: Wall: Torch (Modular)"* — naming
 * **128 parts** to be filled from the archive.
 *
 * `pipeline/fixtures.ts` reads `*.json` and says so deliberately: *"Globbing `*`
 * here would silently change every number in the plan."* That is correct for
 * every count in the plan, and it is also why the 40 have never been built. The
 * durable home for them is that pipeline; row C3 does not own it, so the
 * templates are read here at test time and shipped as the typed data in
 * `templates.ts`.
 *
 * ## Two grammar features live only here
 *
 * Measured over both halves of the fixtures directory:
 *
 * | grammar | in the 8,721 JSON rows | in the 40 YAML templates |
 * | --- | ---: | ---: |
 * | `constrain[].siblings` | **0** | **30** |
 * | part-level `fulfills` | **0** | **20** |
 * | record-level `config.fulfills` | 21 | 0 |
 * | `optional` on a part | 2,653 | **0** |
 * | `id` on a part | 6 | 0 |
 *
 * Row C1's docblock predicted the first row of that table exactly — *"zero live
 * `constrain` entries carry `siblings` or `parent`… if a fixture ever writes one,
 * `src/catalog/schema.ts` has to widen `ConstrainRef` or Zod will strip it and
 * the source control will be lost in silence."* A fixture already does, thirty
 * times over, in the half of the directory the pipeline does not read. Both
 * omissions are reported to the schema's owner rather than fixed here; neither
 * bites this row, because nothing below goes through `PartSlot`.
 *
 * ## Why this is a reader and not a YAML dependency
 *
 * There is no YAML parser in this project and `package.json` belongs to row W0.
 * So this file reads the fixtures' own subset of YAML, and it is **strict**: it
 * is a table over the exact `(indentation, key)` pairs the 20 files contain and
 * it throws, naming the file and line, on anything else. The subset is small
 * because the fixtures are machine-regular — ASCII, LF, no tabs, no trailing
 * space, two-space indent, quotes on nothing but the two top-level scalars, and
 * `require` → `deny` → `constrain` in that order on all 128 parts.
 *
 * A strict reader that throws still cannot prove it read *correctly*, so it is
 * not asked to. {@link printFixture} re-emits a parsed file in the fixtures' own
 * layout and `corpus.test.ts` asserts the result is **byte-identical to the file
 * on disk, for all 20**. That is the proof: a reader that dropped a key, folded
 * two entries or lost a `siblings` list could not round-trip. It is a stronger
 * check than agreeing with a second parser would be, and it costs no dependency.
 *
 * ## This is the only file under `src/` that imports a `node:` module
 *
 * Which is worth naming rather than leaving to be discovered. Nothing the app
 * can reach imports it — `templates.ts` holds the output, and the *reader* is
 * needed only to verify that output — and `corpus.test.ts` asserts that
 * separation directly, so the boundary cannot spread by accident. `fixture.ts`
 * in `src/routes/`, `src/screens/catalog/` and `src/screens/detail/slots/`
 * already establishes test-support modules living beside the code they support;
 * the filesystem access is the new part, and it is what reading a fixture
 * directory *is*.
 *
 * The alternative was to have the pipeline emit the templates into
 * `catalog.json`. That is the better long-term home and it is
 * `pipeline/fixtures.ts`, which row C3 does not own — reported rather than taken.
 *
 * ## What the shipped copy costs
 *
 * Measured the way C1 measured its own: esbuild, bundled, minified, `@/*`
 * external, brotli quality 11.
 *
 * | module | minified | brotli |
 * | --- | ---: | ---: |
 * | `templates.ts` — the 40 recipes, 128 parts | 37,326 B | **1,474 B** |
 * | `assembly.ts` — the model | 4,398 B | 1,661 B |
 * | together | 41,724 B | **3,119 B** |
 *
 * 1.5 kB brotli for the whole of the data, because 128 parts over six part names
 * and a few dozen tag strings is almost entirely repetition. It is **JavaScript
 * and not index**, so it spends nothing at all of `catalog.json`'s 500 KB budget
 * — the constraint C1 was working against when it chose to emit 0 bytes.
 *
 * A one-off measurement rather than a CI assertion, unlike C1's: that row's
 * figures decided between four encodings and could trip X4's budget gate, while
 * this one is 1.5 kB of JavaScript with no gate to trip. The command is
 * `npx esbuild src/screens/assemblies/templates.ts --bundle --minify
 * --format=esm --platform=browser "--external:@/*"`.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/* ---------------------------------------------------------------- the fixture */

/** One `constrain` entry, in fixture order and with its source control intact. */
export interface FixtureConstrain {
  readonly tag?: string
  readonly filter?: string
  /** The `siblings` list. 30 entries carry one; the JSON corpus has none. */
  readonly siblings?: readonly string[]
}

/** One part of a template: a name, a constraint block, and what it covers. */
export interface FixturePart {
  readonly name: string
  /** Present on all 128 parts. */
  readonly require: readonly string[]
  /** Present on 82. */
  readonly deny: readonly string[]
  /** Present on 110. */
  readonly constrain: readonly FixtureConstrain[]
  /**
   * Part names this part's own fill covers. 20 entries, every one naming `base`.
   *
   * Scoped to *nested* parts, not siblings — see `assemblyPicker.ts`, which
   * carries the spec quotation and the reference implementation's one line.
   */
  readonly fulfills: readonly string[]
}

/** One of the 40 templates, exactly as the fixture writes it. */
export interface TemplateFixture {
  /** The fixture's file name, kept as provenance. */
  readonly source: string
  /** `"S2W: Wall on Tile: Wall: Torch (Modular)"`. Unique across all 40. */
  readonly name: string
  /** `"blueprint"` on all 40. Carried so the round-trip can re-emit it. */
  readonly type: string
  /** The template's own tags — the `parentTags` a `constrain` entry reads. */
  readonly tags: readonly string[]
  readonly parts: readonly FixturePart[]
}

/**
 * Where the fixtures are.
 *
 * The same literal and the same override `pipeline/fixtures.ts` uses, so a
 * checkout that has already pointed that pipeline somewhere else points this
 * reader there too.
 */
export const DEFAULT_FIXTURES_DIR = '/home/finn/Repos/openforge-catalog/openforge/db/fixtures/blueprints'

export function templateFixturesDir(explicit?: string): string {
  return explicit ?? process.env.OPENFORGE_FIXTURES ?? DEFAULT_FIXTURES_DIR
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

function describe(indent: number, dash: boolean, key: string | undefined): string {
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
    if (row === undefined) fail(`expected ${describe(indent, dash, key)}, reached end of file`)
    if (row.indent !== indent || row.dash !== dash || row.key !== key) {
      fail(`expected ${describe(indent, dash, key)}, found ${describe(row.indent, row.dash, row.key)}`, row)
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
function flowList(cursor: Cursor, row: Row): readonly string[] {
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
function readConstrain(cursor: Cursor): readonly FixtureConstrain[] {
  const out: FixtureConstrain[] = []
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
    if (row.key === 'filter' && siblings !== undefined) {
      // The spec is explicit that a filter carries no source control, and no
      // fixture writes one. Refusing it is the difference between reading the
      // grammar and inventing a wider one.
      cursor.fail('a `filter` entry cannot carry `siblings`', row)
    }
    out.push(
      row.key === 'tag'
        ? siblings === undefined
          ? { tag: row.value }
          : { tag: row.value, siblings }
        : { filter: row.value },
    )
  }
  return out
}

/** `- tag: x` refs at indent 12, with no source control. */
function readTagRefs(cursor: Cursor): readonly string[] {
  const out: string[] = []
  while (cursor.looksLike(12, true, 'tag')) out.push(cursor.take(12, true, 'tag').value)
  if (out.length === 0) cursor.fail('a require/deny block with no `tag` entry')
  return out
}

function readPart(cursor: Cursor): FixturePart {
  const name = cursor.take(6, true, 'name').value
  cursor.take(8, false, 'tags')

  cursor.take(10, false, 'require')
  const require = readTagRefs(cursor)

  const deny = cursor.looksLike(10, false, 'deny') ? (cursor.take(10, false, 'deny'), readTagRefs(cursor)) : []

  const constrain = cursor.looksLike(10, false, 'constrain')
    ? (cursor.take(10, false, 'constrain'), readConstrain(cursor))
    : []
  if (cursor.looksLike(10, false, 'constrain')) cursor.fail('two `constrain` blocks on one part')

  const fulfills: string[] = []
  if (cursor.looksLike(8, false, 'fulfills')) {
    cursor.take(8, false, 'fulfills')
    while (cursor.looksLike(10, true, 'part')) fulfills.push(cursor.take(10, true, 'part').value)
    if (fulfills.length === 0) cursor.fail('a `fulfills` block with no `part` entry')
  }

  return { name, require, deny, constrain, fulfills }
}

function readEntry(cursor: Cursor): TemplateFixture {
  const name = unquote(cursor, cursor.take(0, true, 'name'))
  const type = unquote(cursor, cursor.take(2, false, 'type'))

  cursor.take(2, false, 'tags')
  const tags: string[] = []
  while (cursor.looksLike(4, true, undefined)) tags.push(cursor.take(4, true, undefined).value)
  if (tags.length === 0) cursor.fail('a template with no tags')

  cursor.take(2, false, 'config')
  cursor.take(4, false, 'parts')
  const parts: FixturePart[] = []
  while (cursor.looksLike(6, true, 'name')) parts.push(readPart(cursor))
  if (parts.length === 0) cursor.fail('a template with no parts')

  return { source: cursor.source, name, type, tags, parts }
}

/** Every template in one fixture file. Throws on anything the subset omits. */
export function readTemplateFile(source: string, text: string): readonly TemplateFixture[] {
  const cursor = cursorOver(source, tokenise(text))
  const out: TemplateFixture[] = []
  while (!cursor.done) out.push(readEntry(cursor))
  return out
}

/**
 * All 40 templates, in `readdir` order sorted — so the shipped data is
 * deterministic across machines.
 */
export function readTemplateFixtures(dir = templateFixturesDir()): readonly TemplateFixture[] {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.yaml'))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return files.flatMap((name) => readTemplateFile(name, readFileSync(join(dir, name), 'utf8')))
}

/* ---------------------------------------------------------- the round-trip */

/**
 * A parsed file back in the fixtures' own layout, byte for byte.
 *
 * The whole point is the assertion in `corpus.test.ts`: this must equal the file
 * it was read from, for all 20 files. Every layout decision here is therefore an
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
    for (const part of entry.parts) {
      lines.push(`      - name: ${part.name}`)
      lines.push('        tags:')
      lines.push('          require:')
      for (const tag of part.require) lines.push(`            - tag: ${tag}`)
      if (part.deny.length > 0) {
        lines.push('          deny:')
        for (const tag of part.deny) lines.push(`            - tag: ${tag}`)
      }
      if (part.constrain.length > 0) {
        lines.push('          constrain:')
        for (const ref of part.constrain) {
          if (ref.filter !== undefined) lines.push(`            - filter: ${ref.filter}`)
          else lines.push(`            - tag: ${String(ref.tag)}`)
          if (ref.siblings !== undefined) lines.push(`              siblings: [${ref.siblings.join(', ')}]`)
        }
      }
      if (part.fulfills.length > 0) {
        lines.push('        fulfills:')
        for (const name of part.fulfills) lines.push(`          - part: ${name}`)
      }
    }
  })
  return `${lines.join('\n')}\n`
}

/* ------------------------------------------------------------ the shipped data */

/**
 * A template's id: a slug of its name.
 *
 * Derived from the name rather than from the file, because the two entries in a
 * file differ only by their name and a file-derived id would need an ordinal —
 * which is exactly the kind of position row A5 is careful never to persist. The
 * 40 names are distinct and so are the 40 slugs; {@link printTemplatesModule}
 * throws on a collision rather than emitting one.
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

function printConstrain(ref: FixtureConstrain): string {
  if (ref.filter !== undefined) return `{ filter: ${quote(ref.filter)} }`
  const tag = `tag: ${quote(String(ref.tag))}`
  if (ref.siblings === undefined) return `{ ${tag} }`
  return `{ ${tag}, siblings: [${ref.siblings.map(quote).join(', ')}] }`
}

function printPart(part: FixturePart): readonly string[] {
  const tags: string[] = [`require: [${part.require.map((tag) => `{ tag: ${quote(tag)} }`).join(', ')}]`]
  if (part.deny.length > 0) {
    tags.push(`deny: [${part.deny.map((tag) => `{ tag: ${quote(tag)} }`).join(', ')}]`)
  }
  if (part.constrain.length > 0) {
    tags.push(`constrain: [${part.constrain.map(printConstrain).join(', ')}]`)
  }
  return [
    '      {',
    `        name: ${quote(part.name)},`,
    '        tags: {',
    ...tags.map((line) => `          ${line},`),
    '        },',
    `        fulfills: [${part.fulfills.map(quote).join(', ')}],`,
    '      },',
  ]
}

/**
 * The whole of `templates.ts`, emitted from the fixtures.
 *
 * `corpus.test.ts` asserts that the committed file is byte-identical to what
 * this returns, so `templates.ts` is *provably* the fixtures' content and not a
 * transcription of it. To refresh it after an upstream fixture change, run the
 * one-liner the test's failure message prints. A `package.json` script would be
 * the nicer home for that and `package.json` belongs to row W0.
 */
export function printTemplatesModule(entries: readonly TemplateFixture[]): string {
  const seen = new Set<string>()
  const body: string[] = []

  for (const entry of entries) {
    const id = templateSlug(entry.name)
    if (seen.has(id)) throw new Error(`two templates slug to ${id}`)
    seen.add(id)
    if (entry.type !== 'blueprint') throw new Error(`${entry.name}: type is ${entry.type}, not blueprint`)
    body.push(
      '  {',
      `    id: ${quote(id)},`,
      `    name: ${quote(entry.name)},`,
      `    source: ${quote(entry.source)},`,
      `    tags: [${entry.tags.map(quote).join(', ')}],`,
      '    parts: [',
      ...entry.parts.flatMap(printPart),
      '    ],',
      '  },',
    )
  }

  return `${[
    '/**',
    ' * The 40 recipe templates, as data.',
    ' *',
    ' * **Generated. Do not edit.** `corpus.test.ts` asserts this file is',
    " * byte-identical to `printTemplatesModule(readTemplateFixtures())`, so an edit",
    ' * here fails the suite rather than drifting quietly. `fixtures.ts` carries the',
    ' * provenance: what the 40 are, why they are not in `catalog.json`, and the',
    ' * round-trip proof that the reader which produced them lost nothing.',
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
