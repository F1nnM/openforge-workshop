/**
 * Display names, synthesised from tags.
 *
 * **Raw filenames cannot be titles.** Re-measured over the 8,702 live rows:
 * **98.0% contain at least one of `# % + ,`** and the **median is 51
 * characters** (max 92). A catalog card showing
 * `cave%aggregate+2#corner.IL+corner,90.openlock.stl` is not showing the user
 * anything.
 *
 * Nor are filenames distinctive. Nine live rows are called `torch.stl` and nine
 * `torch_plate.stl`; those two groups are one mesh filed under nine catalog
 * paths each (one md5 apiece), so a filename-titled grid shows nine identical
 * cards. Separately, **89 filenames do map to two or three genuinely different
 * meshes**, which is `CatalogRecord.file`'s own warning and the reason §11
 * disambiguates zip entries from `id`. The filename stays on the record because
 * a zip entry needs it; the *name* is built here.
 *
 * The shape of a name is
 *
 *     [texture] [subject] [shape adjectives] [shape noun] [size token]
 *     Cut Stone  Low Torch                    Wall         2x
 *
 * and every part is optional, because plenty of tiles have no texture tag, no
 * component and no resolvable footprint. The size token is the same one §6 asks
 * the search layer for: `4x4` and `2r90` appear in **zero** tags, so a name is
 * where they enter the text index.
 */
import type { Footprint } from '../src/catalog'

import { formatUnit, sizeToken } from './footprint'
import { numericTagValue, tagValue } from './tags'

/**
 * The shape noun, most specific first. The first root present wins and the rest
 * become adjectives, which is why `wall` outranks `corner` (a corner piece of
 * wall is a "Corner Wall") and `riser` outranks `base` (every riser is also
 * tagged `shape|base`, and it is a riser).
 */
const SHAPE_NOUNS = [
  'stairs',
  'riser',
  'column',
  'base',
  'wall',
  'floor',
  'corner',
  'angled',
  'hex',
  'curved',
  'concave',
  'convex',
  'radial',
  'option',
  'square',
] as const

/**
 * `shape|square` sits on 3,709 tiles and says nothing a size token does not say
 * better, so it is dropped as an adjective. It survives as a noun of last resort
 * for the handful of tiles that carry nothing else.
 */
const WEAK_SHAPE_ADJECTIVES = new Set(['square'])

/** Namespaces naming *what the thing is*, in the order they read best. */
const SUBJECT_NAMESPACES = ['part', 'component', 'scatter', 'decoration'] as const

/** Words a naive title-case gets wrong. */
const CASE_OVERRIDES = new Map([
  ['s2w', 'S2W'],
  ['s-system', 'S-System'],
  ['led', 'LED'],
])

const MAX_SUBJECT_ROOTS = 2
const MAX_SHAPE_ADJECTIVES = 3
const MAX_NAME_CHARS = 72

/** Synthesise the display name for one tile. Never empty — see {@link fallbackName}. */
export function displayName(tags: readonly string[], foot: Footprint, file: string): string {
  const shape = shapePhrase(tags)
  const suffix = sizeWords(tags, foot)
  const descriptive = dedupeAdjacent([
    ...texturePhrase(tags),
    ...subjectPhrase(tags, new Set(shape.roots)),
    ...shape.words,
  ])

  // The suffix is what separates one 6x6 curved base from the 8x8 beside it, so
  // it gets its budget first and the adjectives are trimmed around it. Trimming
  // in reading order would drop the discriminator and keep the prose.
  const reserved = suffix.length === 0 ? 0 : suffix.join(' ').length + 1
  const head = truncateWords(descriptive, Math.max(MAX_NAME_CHARS - reserved, 0))
  const name = [head, ...suffix].filter((part) => part.length > 0).join(' ')
  return name.length > 0 ? name : fallbackName(file)
}

/**
 * The trailing size words: the token, then the discriminators that are pure
 * serial numbers in the tags.
 *
 *   - `size|segment|a` splits one curve family across three printable pieces.
 *     Forty `plain#base+curved.6x6` files are otherwise identical.
 *   - `size|openlock` is appended **only when the footprint gives fewer than two
 *     dimensions**. On a wall it is the size — `P`, `PA` and `PB` are three
 *     different 2-unit angled walls — but on a 4x4 floor it repeats what `4x4`
 *     already said, and 4,030 tiles carry one.
 */
function sizeWords(tags: readonly string[], foot: Footprint): string[] {
  const words: string[] = []
  const token = sizeToken(foot) ?? taggedSizeToken(tags)
  if (token !== undefined) words.push(token)

  const segment = tagValue(tags, 'size|segment')
  if (segment !== undefined) words.push(...prettify(segment))

  // `column` and `diag` are on this list because the code is the only thing that
  // separates two pieces of the same size: `col+L` and `col+X` are one measured
  // 0.5 x 0.5 square with different ports, and `P` / `PA` / `PB` / `PC` are four
  // 45-degree runs that all carry `size|width|2`. Both were on it before row W4
  // too, as `none` and `wall` respectively; naming them keeps 240 names intact.
  const code = tagValue(tags, 'size|openlock')
  const wantsCode =
    foot.shape === 'wall' || foot.shape === 'none' || foot.shape === 'column' || foot.shape === 'diag'
  if (code !== undefined && wantsCode) words.push(code)

  return words
}

/**
 * The size a tile is *labelled* with, for the 699 tiles whose footprint is
 * `none` and the 121 whose footprint is a measured `diag` run.
 *
 * §2 is explicit that the size tags are design-family labels rather than mesh
 * measurements, which is exactly why they must not reach `Footprint` — and
 * exactly why they belong in a *name*, which is a label.
 *
 * Rows W3 and W4 both changed what this serves without changing why it exists.
 * A curve with a trusted width/depth pair gets that pair as its footprint, so
 * `sizeToken` supplies its token and this is never reached; what is left is the
 * 319 `size|segment` fragments, whose pair names the *whole* design and so is a
 * label in the strongest sense. Without it, the 40 `plain#base+curved.6x6+a/b/c`
 * files read "Plain Curved Base A" and the 6x6 family is indistinguishable from
 * the 8x8; with it they read "Plain Curved Base 6x6 A".
 *
 * W4 added the 121 `diag` tiles to what it serves, for the opposite reason: their
 * footprint run is *measured* (3.536 for `P`, 2.828 for `PA`) and the corpus
 * writes `size|width|2` for all of them, so the label is the tagged 2 and the
 * footprint is the measurement. `sizeToken` returns `undefined` for `diag` to
 * hand the naming job here.
 *
 * `120°` is the last resort for the hex corners, whose only tagged dimension is
 * a sweep. The degree sign matches the corpus's own filenames and the search
 * tokeniser normalises it away, so the tile is still found by typing `120`.
 */
function taggedSizeToken(tags: readonly string[]): string | undefined {
  const width = numericTagValue(tags, 'size|width')
  const depth = numericTagValue(tags, 'size|depth')
  const angle = numericTagValue(tags, 'size|angle')

  if (width !== undefined && depth !== undefined) return `${formatUnit(width)}x${formatUnit(depth)}`
  if (width !== undefined) return `${formatUnit(width)}x`
  if (angle !== undefined) return `${formatUnit(angle)}°`
  return undefined
}

/* ------------------------------------------------------------------- texture */

/**
 * Every segment of the tags sharing the first texture root, in order and
 * deduped: `texture|towne` + `texture|towne|stone` + `texture|towne|stucco`
 * becomes "Towne Stone Stucco".
 */
function texturePhrase(tags: readonly string[]): string[] {
  const first = tags.find((tag) => tag.startsWith('texture|'))
  if (!first) return []
  const root = first.split('|')[1]
  if (!root) return []

  const segments: string[] = []
  for (const tag of tags) {
    if (!tag.startsWith(`texture|${root}`)) continue
    for (const segment of tag.split('|').slice(1)) {
      if (!segments.includes(segment)) segments.push(segment)
    }
  }
  return segments.flatMap(prettify)
}

/* ------------------------------------------------------------------- subject */

/**
 * What the tile *is*, from the `part` / `component` / `scatter` / `decoration`
 * namespaces.
 *
 * A root the shape phrase already used contributes only its **qualifiers**, not
 * the root word. `component|wall` on a `shape|wall` tile must not produce "Wall
 * Wall" — but dropping the whole tag instead loses `component|wall|full-low`,
 * which is the only thing separating 33 otherwise identical ruined walls.
 */
function subjectPhrase(tags: readonly string[], usedShapeRoots: ReadonlySet<string>): string[] {
  const words: string[] = []
  let roots = 0
  for (const namespace of SUBJECT_NAMESPACES) {
    for (const [root, qualifiers] of groupByRoot(tags, namespace)) {
      if (roots >= MAX_SUBJECT_ROOTS) continue
      const phrase = usedShapeRoots.has(root)
        ? qualifiers.flatMap(prettify)
        : qualifiedPhrase(root, qualifiers)
      if (phrase.length === 0) continue
      roots += 1
      words.push(...phrase)
    }
  }
  return words
}

/* --------------------------------------------------------------------- shape */

function shapePhrase(tags: readonly string[]): { words: string[]; roots: string[] } {
  const groups = groupByRoot(tags, 'shape')
  if (groups.size === 0) return { words: [], roots: [] }

  const noun = SHAPE_NOUNS.find((candidate) => groups.has(candidate)) ?? [...groups.keys()][0]
  if (noun === undefined) return { words: [], roots: [] }

  const adjectives: string[] = []
  for (const [root, qualifiers] of groups) {
    if (root === noun || WEAK_SHAPE_ADJECTIVES.has(root)) continue
    if (adjectives.length >= MAX_SHAPE_ADJECTIVES) break
    adjectives.push(...qualifiedPhrase(root, qualifiers))
  }

  return {
    words: [...adjectives, ...qualifiedPhrase(noun, groups.get(noun) ?? [])],
    roots: [...groups.keys()],
  }
}

/* ------------------------------------------------------------------- helpers */

/** `namespace|root|qualifier…` grouped as root → qualifiers, in first-seen order. */
function groupByRoot(tags: readonly string[], namespace: string): Map<string, string[]> {
  const head = `${namespace}|`
  const groups = new Map<string, string[]>()
  for (const tag of tags) {
    if (!tag.startsWith(head)) continue
    const segments = tag.slice(head.length).split('|')
    const root = segments[0]
    if (!root) continue
    const qualifiers = groups.get(root) ?? []
    for (const qualifier of segments.slice(1)) {
      if (!qualifiers.includes(qualifier)) qualifiers.push(qualifier)
    }
    groups.set(root, qualifiers)
  }
  return groups
}

/**
 * "Low Torch", "Arched Door", "Orthagonal A", "Treasure Hollow 13mm".
 *
 * Word qualifiers read as adjectives and go in front; bare letters and anything
 * starting with a digit are serial numbers and go behind, which is the
 * difference between "Low Torch" and "Torch A".
 */
function qualifiedPhrase(root: string, qualifiers: readonly string[]): string[] {
  const before: string[] = []
  const after: string[] = []
  for (const qualifier of qualifiers) {
    ;(isSerial(qualifier) ? after : before).push(...prettify(qualifier))
  }
  return [...before, ...prettify(root), ...after]
}

function isSerial(segment: string): boolean {
  return /^[a-z]$/.test(segment) || /^\d/.test(segment)
}

/** `dungeon_stone` → `["Dungeon", "Stone"]`, `cut-stone` → `["Cut", "Stone"]`, `13mm` → `["13mm"]`. */
function prettify(segment: string): string[] {
  const override = CASE_OVERRIDES.get(segment)
  if (override) return [override]
  return segment
    .split(/[_\s-]+/)
    .filter((word) => word.length > 0)
    .map((word) => CASE_OVERRIDES.get(word) ?? word.charAt(0).toUpperCase() + word.slice(1))
}

function dedupeAdjacent(words: readonly string[]): string[] {
  const seen = new Set<string>()
  return words.filter((word) => {
    const key = word.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function truncateWords(words: readonly string[], limit: number): string {
  const kept: string[] = []
  let length = 0
  for (const word of words) {
    const next = length === 0 ? word.length : length + 1 + word.length
    if (next > limit) break
    kept.push(word)
    length = next
  }
  return kept.join(' ')
}

/**
 * The last resort, for a tile with no texture, subject, shape or footprint tag.
 * Strips the corpus's filename punctuation rather than showing it raw.
 */
export function fallbackName(file: string): string {
  const stem = file.replace(/\.stl$/i, '')
  const words = stem
    .split(/[|_+,%#.\s-]+/)
    .filter((word) => word.length > 0)
    .flatMap(prettify)
  return truncateWords(dedupeAdjacent(words), MAX_NAME_CHARS) || stem
}
