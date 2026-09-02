/**
 * The catalog screen's measured facts, as strings.
 *
 * Everything in here produces text the design contract sets in **mono** — a
 * size, a byte count, a facet count. That is the whole reason these live in one
 * file rather than inline: design-contract.md §1 makes "anything that is a
 * measured fact is set in mono" load-bearing, and the corollary is that anything
 * formatted here is a fact and belongs in a `Chip` or an `Eyebrow`. The label
 * maps below are the exception and are marked as such.
 *
 * Row 14 renders a lighter variant of the same card, so all of this is exported
 * through `src/screens/catalog/index.ts` rather than kept private.
 */
import type { Footprint } from '@/catalog'
import { WALL_THICKNESS_UNITS, arcInterfaceRadius } from '@/catalog'
import { BUILD_UNSPECIFIED, KIND_OTHER } from '@/search'

/* ------------------------------------------------------------------- numbers */

/**
 * Thousands-separated count. `8702` → `8,702`.
 *
 * Fixed to `en-US` rather than the visitor's locale: the number sits inside a
 * mono line beside a hard-coded English noun (`tiles`), and a locale that
 * separates with a space or a dot would read as a different number in that
 * sentence rather than as the same number spelled locally.
 */
const COUNT_FORMAT = new Intl.NumberFormat('en-US')

export function countLabel(value: number): string {
  return COUNT_FORMAT.format(value)
}

/**
 * File size, decimal. `10360000` → `10.4 MB`, `45284` → `45 KB`.
 *
 * Decimal (1e6), not binary (2^20), because the number it has to agree with is
 * the one Cloudflare R2 and every OS file listing reports for the same STL. The
 * corpus median is 10.36 MB and the largest file is 108.9 MB
 * (`src/catalog/schema.ts#CatalogRecord.bytes`), so one decimal place is the
 * right precision across the whole range and `MB` is the only unit the grid ever
 * needs above a kilobyte.
 */
export function fileSizeLabel(bytes: number): string {
  if (bytes < 1_000) return `${String(bytes)} B`
  if (bytes < 1_000_000) return `${String(Math.round(bytes / 1_000))} KB`
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

/**
 * An aggregate's file size — `10.4 MB`, or `4.3–15.9 MB` across its variants.
 *
 * A **range and never a single figure**, which is A1's measurement and not a
 * stylistic choice: across the 1,705 multi-variant aggregates the max/min byte
 * ratio is 1.13 at the median but **3.46 at p90**, so one number on an item that
 * holds a 4 MB topper and a 16 MB base-integrated print would be an assertion
 * the data does not support.
 *
 * It collapses to one figure when the two ends round the same way, which is
 * **2,193 of 3,822 aggregates** — every singleton, plus the multi-variant items
 * whose spread hides inside one decimal place. So most cards read exactly as
 * they did before aggregation, and a range appears only where there genuinely is
 * one.
 *
 * The dash is an en dash (`–`), the range dash, rather than a hyphen: the
 * figures either side are numbers and `4.3-15.9` reads as arithmetic.
 *
 * The unit is repeated only once, on the high end, because both ends come from
 * the same `fileSizeLabel` and a range that crosses a unit boundary keeps both —
 * `838 KB–1.2 MB` — rather than pretending the low end is megabytes.
 */
export function bytesRangeLabel(range: readonly [min: number, max: number]): string {
  const [min, max] = range
  const low = fileSizeLabel(min)
  const high = fileSizeLabel(max)
  if (low === high) return low
  // Same unit on both ends: drop the low one, so `4.3–15.9 MB` rather than
  // `4.3 MB–15.9 MB`. A crossed boundary keeps both units.
  const lowUnit = low.slice(low.lastIndexOf(' ') + 1)
  const highUnit = high.slice(high.lastIndexOf(' ') + 1)
  const lowText = lowUnit === highUnit ? low.slice(0, low.lastIndexOf(' ')) : low
  return `${lowText}–${high}`
}

/**
 * The filename's own variant token — `wood#dormer,window_insert.2x.stl` → `2x`,
 * `portcullis.very_narrow.stl` → `very_narrow`.
 *
 * **This is what makes a card distinguishable, and it is a measured need rather
 * than decoration.** A1 records 131 display names shared by 323 aggregates, worst
 * 6, so a title cannot carry identity on its own. Measured over the emitted index
 * against the strings a card actually renders (`corpus.test.ts` re-derives the
 * whole cascade): the texture line and the size chip separate **nothing** — two
 * items sharing a display name share both by construction, because `name` is
 * synthesised from those very tags — the availability chips take 131 groups to
 * **91**, the byte range takes it to **38**, and this token takes it to **21
 * groups over 45 items**, 1.2% of the catalog, worst 3.
 *
 * It works because the importer synthesises `name` from *tags*, and the
 * discriminator between two same-named designs often survives only in the
 * filename: `window_insert.2x` / `.3x` / `.4x` / `.6x` are four aggregates with
 * one display name, and `portcullis.narrow` / `.standard` / `.very_narrow` /
 * `.wide` are four more.
 *
 * ## The connection segments are skipped, and that is what makes it an item's
 * token rather than a file's
 *
 * A filename's tail is `{variant}.{connection spec}` — `2x.openforge,side+dragonlock`,
 * `4x2.openlock+unsupported,magnetic+flex` — and the connection spec is exactly
 * what an aggregate collapses across. Taking the tail whole would put a variant's
 * private connection string on an item's card: measured, the raw tail **varies
 * between the variants of 1,210 of the 3,822 aggregates**, so the card would be
 * quoting one arbitrary file. Skipping any segment whose `+`/`,`-joined parts are
 * all connection vocabulary takes that to **22 aggregates**, and the token's
 * length from a 38-character maximum down to 14 (median 3). A property of the
 * design, in other words, rather than of the file — which is the test a fact has
 * to pass to belong on this card at all.
 *
 * The 148-value vocabulary it leaves is size and shape variants: `1x1`, `2x2`,
 * `AS`, `col+L`, `narrow`, `IL+corner,90°`.
 *
 * Everything before the *first* `.` is dropped: that is the part `name` is built
 * from, and repeating it would put the raw `#`/`%`/`+`/`,` filename on the card,
 * which `catalog.test.tsx` asserts never happens.
 *
 * **40 aggregates have no token** — a filename with nothing but a connection
 * spec after the first dot, or no dot at all — and get an empty string, which the
 * card renders as nothing rather than as a placeholder. An em dash here would
 * claim a missing measurement where the truth is that the filename carries no
 * variant to name.
 *
 * 21 groups (45 items) remain identical on every facet a card shows, including
 * this one. Measured, a tag chip would separate **every one of the 21** — the
 * causes are visible in the filenames: `magnetic+imperial` against
 * `magnetic+metric`, `arch+glass` against `arch`, `minimal-full-full` against
 * `minimal-full-minimal`. The design contract specified tag chips on the card and
 * v1 left them out; row **X2** owns them, so the last 45 cards are a scheduled row
 * away from distinct rather than an unsolved problem.
 */
export function fileTokenLabel(file: string): string {
  const base = file.slice(file.lastIndexOf('/') + 1)
  const stem = base.replace(/\.stl$/i, '')
  const dot = stem.indexOf('.')
  if (dot === -1) return ''
  for (const segment of stem.slice(dot + 1).split('.')) {
    if (!isConnectionSpec(segment)) return segment
  }
  return ''
}

/**
 * The **file's** own token — everything after the first `.`, minus the `.stl`.
 *
 * `cave%arrow_slit.2x.openlock.stl` → `2x.openlock`. The sibling of
 * {@link fileTokenLabel} and its exact complement: that one skips the connection
 * segments to name a *design*, and this one keeps them to name a *file*.
 *
 * Both are needed and neither substitutes for the other, which the measurements
 * make plain. The connection segments vary between the variants of **1,210 of
 * the 3,822 items**, so:
 *
 *   - on an item's card they are noise, and worse than noise — they would print
 *     one arbitrary variant's string on something that stands for all of them.
 *   - on a **row naming one saved file** they are the only thing there is. Two
 *     variants of one design differ in the connection axis and nothing else, so
 *     `fileTokenLabel` gives both of them `2x` and tells the user nothing about
 *     which row is which.
 *
 * Used by the library card's saved-file rows, where the whole point of the row is
 * that it is one file out of several. Longer than the design token — 38
 * characters at the corpus maximum against 14 — and affordable there because the
 * library is a plain CSS grid with no fixed card height.
 *
 * Empty for a filename with no dot before the extension, and then the caller
 * shows the filename instead: a row that named nothing could not be told from
 * its neighbour, which is the one thing it exists to do.
 */
export function variantTokenLabel(file: string): string {
  const base = file.slice(file.lastIndexOf('/') + 1)
  const stem = base.replace(/\.stl$/i, '')
  const dot = stem.indexOf('.')
  return dot === -1 ? '' : stem.slice(dot + 1)
}

/**
 * Whether a filename segment is nothing but connection vocabulary.
 *
 * The vocabulary is {@link CONN_LABELS}' own keys — the systems and positions
 * this file already had to spell for the sidebar — plus the four print modifiers
 * `src/catalog/aggregate.ts` measured as the whole set the corpus uses in that
 * slot. Derived from the label map rather than written out again, so a system
 * added to the sidebar cannot fall out of this rule.
 *
 * `every`, not `some`: `col+L` contains no connection word and is a real variant
 * token, while `openforge,side+dragonlock` is wholly connection and is not.
 */
function isConnectionSpec(segment: string): boolean {
  const parts = segment.split(/[+,]/).filter((part) => part !== '')
  return parts.length > 0 && parts.every((part) => CONNECTION_VOCABULARY.has(part))
}

/* ----------------------------------------------------------------- footprint */

/** `1` not `1.0`, `1.5` not `1.50` — the form the filenames use. */
function formatUnit(value: number): string {
  return String(Number(value.toFixed(4)))
}

/**
 * The card's size chip.
 *
 * Deliberately the same shape as the size token the importer folds into
 * `CatalogRecord.name` (`pipeline/footprint.ts#sizeToken`), with `×` for the
 * multiplication so it reads as a dimension rather than as a filename fragment:
 *
 * | footprint | chip     | note |
 * | --------- | -------- | ---- |
 * | `rect`    | `2×2`    | width × depth in grid units |
 * | `wall`    | `4×`     | length only; the depth is the measured 12.7 mm constant, not data |
 * | `arc`     | `4r22.5` | the tagged interface radius and the sweep; the width/depth pair is a design-family label, not a measurement |
 * | `diag`    | `2.83×∡`  | the measured 45° run; the `∡` is what stops it reading as a straight 2.83 wall |
 * | `column`  | `0.5×0.5` | the measured pillar. All 119 are the same square, so the chip does not vary |
 * | `tri`     | `2×2◺`   | the bounding cell, marked as half of it |
 * | `none`    | the `size|openlock` code, or `—` | 726 tiles have no derivable footprint |
 *
 * `—` rather than an omitted chip: `VirtuosoGrid` assumes a uniform item size,
 * so a card that sometimes drops a row of content would drift the scroll
 * position. An em dash also says "no data" where a blank says "not rendered
 * yet".
 */
export function sizeLabel(foot: Footprint, sizeCode?: string): string {
  switch (foot.shape) {
    case 'rect':
      return `${formatUnit(foot.w)}×${formatUnit(foot.d)}`
    case 'wall':
      return `${formatUnit(foot.length)}×`
    case 'arc':
      // The tagged interface radius, not the band pair — see
      // `arcInterfaceRadius`. `4r22.5` is the token the filenames use and so the
      // one a user types; `4 → 4.5 r` would match nothing. The band pair is
      // disclosed on the detail screen instead, where there is room to explain it.
      return `${formatUnit(arcInterfaceRadius(foot))}r${formatUnit(foot.sweep)}`
    case 'diag':
      return `${formatUnit(foot.run)}×∡`
    case 'column':
      return `${formatUnit(WALL_THICKNESS_UNITS)}×${formatUnit(WALL_THICKNESS_UNITS)}`
    case 'tri':
      return `${formatUnit(foot.leg)}×${formatUnit(foot.leg)}◺`
    case 'none':
      return sizeCode ?? '—'
  }
}

/* -------------------------------------------------------------------- labels */

/**
 * Turn a tag segment into prose. `dungeon_stone` → `Dungeon stone`.
 *
 * Both separators, because the corpus uses both and inconsistently: 38 texture
 * roots include `dungeon_stone`, `cut-stone` and `mortar_and_stone`. Only the
 * first word is capitalised — these are common nouns, and title case would make
 * `Mortar And Stone` out of a material name.
 */
export function humaniseSegment(value: string): string {
  const words = value.replaceAll(/[-_]+/g, ' ').trim()
  if (words === '') return value
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * Kind bucket → sidebar label.
 *
 * Plural, because each row names a set of tiles rather than a property of one.
 * `!other` is the engine's sentinel for the 1,032 tiles (11.9%) whose `shape|`
 * roots fall outside the importer's vocabulary; without a visible row for it an
 * eighth of the catalog is reachable only by clearing the facet, which is the
 * reason `src/search/facets.ts` invented the value.
 */
const KIND_LABELS: Readonly<Record<string, string>> = {
  wall: 'Walls',
  base: 'Bases',
  floor: 'Floors',
  riser: 'Risers',
  angled: 'Angled',
  stairs: 'Stairs',
  column: 'Columns',
  [KIND_OTHER]: 'Other',
}

export function kindLabel(value: string): string {
  return KIND_LABELS[value] ?? humaniseSegment(value)
}

/**
 * Connection system → chip label.
 *
 * Spelled the way the systems are spelled by the people who made them —
 * `OpenLOCK`, `DragonLock`, `OpenForge` — because these are product names, and
 * `humaniseSegment` would render the project's own flagship connector as
 * `Openforge`. `left`, `right` and `bottom` carry 1–6 tiles each and are almost
 * certainly position tags that survived normalisation; they are labelled rather
 * than hidden, since hiding a value with a live count would make the sidebar
 * disagree with the result count.
 */
const CONN_LABELS: Readonly<Record<string, string>> = {
  openforge: 'OpenForge',
  openlock: 'OpenLOCK',
  dragonlock: 'DragonLock',
  magnetic: 'Magnetic',
  pegs: 'Pegs',
  filament: 'Filament',
  dual: 'Dual',
  bottom: 'Bottom',
  left: 'Left',
  right: 'Right',
}

export function connLabel(value: string): string {
  return CONN_LABELS[value] ?? humaniseSegment(value)
}

/**
 * Every word that can appear in a filename's connection segment.
 *
 * {@link CONN_LABELS}' keys carry the systems and the three stray position tags;
 * `side` is the position the label map has no chip for (it is a face, not a
 * value) and the last four are the print modifiers `src/catalog/aggregate.ts`
 * measured as the entire vocabulary the corpus uses in that slot —
 * `openlock|topless` (384), `openlock|unsupported` (413),
 * `dragonlock|unsupported` (8), `magnetic|flex` (1,159) and `openforge|split`
 * (1).
 *
 * Read only by {@link fileTokenLabel}. It is a *recogniser*, not a taxonomy: a
 * word missing from it costs one card a slightly longer token, never a wrong
 * fact.
 */
const CONNECTION_VOCABULARY: ReadonlySet<string> = new Set([
  ...Object.keys(CONN_LABELS),
  'side',
  'topless',
  'unsupported',
  'flex',
  'split',
])

/**
 * Build system → chip label.
 *
 * `s2w` is an abbreviation ("stone to wall") and reads as noise in sentence
 * case, so it is upper-cased; `s-system` keeps its lowercase suffix because that
 * is how the tag is written. The `!none` sentinel becomes **Unspecified**, which
 * is the whole point of the facet's shape: 2,978 tiles (34.2%) carry no `build|`
 * tag and "show me those" is a question the sidebar has to be able to ask.
 */
const BUILD_LABELS: Readonly<Record<string, string>> = {
  s2w: 'S2W',
  's-system': 'S-system',
  [BUILD_UNSPECIFIED]: 'Unspecified',
}

export function buildLabel(value: string): string {
  return BUILD_LABELS[value] ?? humaniseSegment(value)
}
