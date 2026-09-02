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
import { WALL_THICKNESS_UNITS } from '@/catalog'
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
 * | `arc`     | `4r22.5` | radius and sweep; the tagged width/depth are design-family labels, not measurements |
 * | `diag`    | `2.83×∡`  | the measured 45° run; the `∡` is what stops it reading as a straight 2.83 wall |
 * | `column`  | `0.5×0.5` | the measured pillar. All 119 are the same square, so the chip does not vary |
 * | `tri`     | `2×2◺`   | the bounding cell, marked as half of it |
 * | `none`    | the `size|openlock` code, or `—` | 699 tiles have no derivable footprint |
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
      return `${formatUnit(foot.radius)}r${formatUnit(foot.angle)}`
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
