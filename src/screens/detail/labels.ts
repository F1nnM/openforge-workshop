/**
 * The detail drawer's spec grid, in words — and the two fields that cannot be
 * filled naively.
 *
 * design-contract.md §2.5 asks for a 2×2 grid of **Footprint**, **Height**,
 * **Build system** and **File**. Two of those four are honest only if they are
 * allowed to say "no data", and this module is where that honesty lives, so the
 * component renders labels and never derives one.
 *
 * ## Height does not exist in the catalog
 *
 * Not one of the 8,702 live entries carries a bounding box, so there is no
 * number to print. What the corpus *does* carry is a **qualitative** vocabulary
 * in the tag tree — `shape|wall|low`, `shape|riser|high`, `component|wall|low`,
 * and compound per-segment profiles like `component|wall|full-low` — and that is
 * what {@link heightLabel} reads. Re-derived over the emitted index:
 * **1,831 tiles (21.0%)** carry a height qualifier — 1,494 a single word and 337 a
 * per-segment profile — and no tile carries two conflicting ones. The other
 * **6,871 (79.0%)** get {@link NO_HEIGHT}, which says so.
 *
 * The mock's `h` in inches (design-contract.md §4) has no counterpart in the
 * real data, and inventing one — 2.0 for a wall, 0.25 for a floor — would put a
 * fabricated measurement in mono type next to three real ones. `corpus.test.ts`
 * asserts the 21.0% so the fallback rate stays a measured fact.
 *
 * ## Footprint is a union, and only 35.1% of it is a `W×D`
 *
 * `CatalogRecord.foot` is `rect` (35.1%) / `wall` (35.8%) / `arc` (16.0%) /
 * `none` (13.1%). {@link footprintLabel} is a six-tier cascade, and every tier
 * reports which one it came from so the cell can name its own provenance:
 *
 * | tier | label            | source                                  | live tiles |
 * | ---- | ---------------- | --------------------------------------- | ---------- |
 * | 1    | `1 × 1`          | `rect` — tagged width and depth          | 35.1%      |
 * | 2    | `2 × 0.5`        | `wall` — tagged length × measured 12.7mm | 35.8%      |
 * | 3    | `2r 90°`         | `arc` — radius and sweep                 | 16.0%      |
 * | 4    | `OpenLOCK D`     | `size|openlock`, when there is no shape  | 2.6%       |
 * | 5    | `Curved`         | a geometry word from `shape|…`           | 8.1%       |
 * | 6    | `Size not specified` | nothing to go on                     | 2.4%       |
 *
 * Tier 2 is the one deliberate addition to the cascade the brief specified. A
 * `wall` footprint has a real tagged length and no depth field at all, because
 * the depth is not in the data — it is `WALL_THICKNESS_UNITS`, measured from the
 * meshes and bit-exact at exactly half a grid unit. Dropping those 3,116 tiles
 * to tier 4 or 5 would throw away a measurement in order to print a size code,
 * so the cell prints `length × 0.5` and its note names the constant. Nothing is
 * guessed at: `Footprint`'s comment forbids an importer *writing* a depth, not a
 * reader stating the constant it uses to place the tile.
 *
 * Tier 5's vocabulary is ordered, and the order is load-bearing for the measured
 * coverage above: a tile carrying both `hex` and `curved` resolves to `hex`.
 */
import type { CatalogAssets, CatalogRecord } from '@/catalog'
import { WALL_THICKNESS_MM, WALL_THICKNESS_UNITS, shardedPath } from '@/catalog'

/* ------------------------------------------------------------------ numbers */

/**
 * A grid-unit length, without trailing noise.
 *
 * Every dimension in the catalog is a multiple of 0.5 units, so two decimals is
 * more than the data can carry; the rounding is there to keep a float artefact
 * out of mono type rather than to lose precision.
 */
export function formatUnits(value: number): string {
  return String(Math.round(value * 1000) / 1000)
}

/**
 * File size, decimal.
 *
 * Decimal (1e6) rather than binary, because the number this has to agree with is
 * the one R2 and every OS file listing report for the same STL, and because
 * every corpus figure the plan quotes is decimal (10.36 MB median, 108.9 MB
 * largest).
 *
 * Deliberately the same three branches and the same precision as the catalog
 * screen's `fileSizeLabel`, and deliberately *not* imported from it: the PR
 * series makes row 15 depend on rows 8 and 12, not on row 13, so a drawer that
 * imported a sibling screen's module could not be reviewed or merged
 * independently of it. The duplication is four lines and the alternative is a
 * cross-screen edge in the dependency graph.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1_000) return `${String(bytes)} B`
  if (bytes < 1_000_000) return `${String(Math.round(bytes / 1_000))} KB`
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

/* ------------------------------------------------------------------- words */

/** `dungeon_stone` → `Dungeon stone`. Underscores are the corpus's word breaks. */
function humanise(value: string): string {
  const spaced = value.replaceAll('_', ' ').replaceAll('-', ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/* --------------------------------------------------------------- provenance */

/** Which tier of {@link footprintLabel}'s cascade produced a label. */
export type FootprintBasis = 'rect' | 'wall' | 'arc' | 'size-code' | 'shape-word' | 'unspecified'

/**
 * A spec-grid value, plus where it came from.
 *
 * `note` is rendered as the cell's `title`, so every value in the grid can be
 * interrogated for its provenance. That matters most where the value is a
 * refusal: "Not recorded" with no explanation reads as a bug in the app rather
 * than as a gap in the archive.
 */
export interface SpecValue<Basis extends string> {
  /** What the cell shows. Never blank, never a guess. */
  text: string
  /** Which tier or vocabulary produced it. */
  basis: Basis
  /** One sentence naming the source, for the cell's `title`. */
  note: string
}

/* --------------------------------------------------------------- footprint */

/**
 * Geometry words from the `shape|` tree, in resolution order.
 *
 * Only five of these fire in the live corpus (`curved` 461, `concave` 98,
 * `square` 81, `hex` 56, `convex` 13 — over the tiles that reach tier 5); the
 * rest are present because they exist in the tag tree on tiles that reach an
 * earlier tier, and a tag that migrates should land on a word rather than on
 * "not specified".
 */
export const SHAPE_WORDS: readonly string[] = [
  'hex',
  'octagon',
  'concave',
  'convex',
  'radial',
  'curved',
  'angled',
  'square',
  'round',
  'diagonal',
  'triangle',
  'notch',
]

/** The tier-6 text, exported so the tests and the corpus check share one string. */
export const NO_FOOTPRINT = 'Size not specified'

function shapeWord(tags: readonly string[]): string | undefined {
  const segments = new Set<string>()
  for (const tag of tags) {
    if (!tag.startsWith('shape|')) continue
    for (const segment of tag.split('|').slice(1)) segments.add(segment)
  }
  return SHAPE_WORDS.find((word) => segments.has(word))
}

/**
 * The footprint cell — the six-tier cascade documented at the top of this file.
 *
 * `tags` is the record's de-interned tag list (`resolveTags`), needed only by
 * tier 5.
 */
export function footprintLabel(
  record: CatalogRecord,
  tags: readonly string[],
): SpecValue<FootprintBasis> {
  const foot = record.foot

  switch (foot.shape) {
    case 'rect':
      return {
        text: `${formatUnits(foot.w)} × ${formatUnits(foot.d)}`,
        basis: 'rect',
        note: 'Width × depth in grid units (1 unit = 25.4 mm), from the tile’s size tags.',
      }
    case 'wall':
      return {
        text: `${formatUnits(foot.length)} × ${formatUnits(WALL_THICKNESS_UNITS)}`,
        basis: 'wall',
        note:
          `Length in grid units from the tile’s size tag. The catalog records no depth for a ` +
          `wall — ${formatUnits(WALL_THICKNESS_UNITS)} units is the measured ${formatUnits(WALL_THICKNESS_MM)} mm wall thickness.`,
      }
    case 'arc':
      return {
        text: `${formatUnits(foot.radius)}r ${formatUnits(foot.angle)}°`,
        basis: 'arc',
        note:
          'Radius and swept angle. Curves are not given as width × depth: on a curve the size ' +
          'tags name the design family, and diverge from the mesh by 96 mm at the median.',
      }
    case 'none':
      break
  }

  if (record.sizeCode !== undefined) {
    return {
      text: `OpenLOCK ${record.sizeCode}`,
      basis: 'size-code',
      note: 'No footprint is derivable from this tile’s tags; the OpenLOCK size code is what it does carry.',
    }
  }

  const word = shapeWord(tags)
  if (word !== undefined) {
    return {
      text: humanise(word),
      basis: 'shape-word',
      note: 'A shape word from the tile’s tags. No numeric footprint is derivable, so none is shown.',
    }
  }

  return {
    text: NO_FOOTPRINT,
    basis: 'unspecified',
    note: 'This tile carries no size tags, no OpenLOCK code and no shape word. Nothing to state.',
  }
}

/* ------------------------------------------------------------------ height */

/** The qualitative height vocabulary, weakest first. Order is display order. */
export const HEIGHT_WORDS: readonly string[] = ['minimal', 'low', 'mid', 'medium', 'high', 'tall', 'full']

/** The text shown for the 79.0% of tiles with no height basis at all. */
export const NO_HEIGHT = 'Not recorded'

/** Which vocabulary produced a height label. */
export type HeightBasis = 'qualitative' | 'profile' | 'none'

/**
 * True for the last segment of a height-bearing tag: a single qualifier, or a
 * hyphenated per-segment profile of two or three of them.
 */
function heightSegments(segment: string): readonly string[] | undefined {
  const parts = segment.split('-')
  if (parts.length > 3) return undefined
  return parts.every((part) => HEIGHT_WORDS.includes(part)) ? parts : undefined
}

/**
 * The height cell.
 *
 * Qualitative by necessity — see the module docblock. A compound tag
 * (`component|wall|full-low`, 337 tiles / 3.9%) is a per-segment profile, not a
 * range, so it is rendered as a list and labelled as a profile.
 */
export function heightLabel(tags: readonly string[]): SpecValue<HeightBasis> {
  for (const tag of tags) {
    const segments = tag.split('|')
    const root = segments[0]
    const last = segments.at(-1)
    if (last === undefined) continue
    if (root !== 'shape' && root !== 'component') continue
    if (segments.length < 2) continue

    const words = heightSegments(last)
    if (words === undefined) continue

    if (words.length === 1) {
      return {
        text: humanise(words[0] ?? ''),
        basis: 'qualitative',
        note:
          `Qualitative, from \`${tag}\`. The catalog holds no bounding box for any tile, so no ` +
          `height in millimetres exists to show.`,
      }
    }
    return {
      text: words.map((word) => humanise(word)).join(' / '),
      basis: 'profile',
      note: `A per-segment height profile, from \`${tag}\` — one value per side or step, not a range.`,
    }
  }

  return {
    text: NO_HEIGHT,
    basis: 'none',
    note:
      'Not one of the 8,702 catalogued tiles carries a bounding box, and this one carries no ' +
      'qualitative height tag either. A number here would be invented.',
  }
}

/* ------------------------------------------------------- the other two cells */

/** Which build system, or the fact that 34.2% of the corpus names none. */
export function buildLabel(record: CatalogRecord): SpecValue<'tagged' | 'none'> {
  if (record.build === undefined) {
    return {
      text: 'Not specified',
      basis: 'none',
      note: '2,978 tiles (34.2%) carry no build tag. Absence is a real state here, not missing data.',
    }
  }
  return {
    text: humanise(record.build),
    basis: 'tagged',
    note: `From the tile’s \`build|${record.build}\` tag.`,
  }
}

/** `STL · 12.34 MB`. Every live file in the archive is an STL. */
export function fileLabel(record: CatalogRecord): SpecValue<'stl'> {
  return {
    text: `STL · ${formatFileSize(record.bytes)}`,
    basis: 'stl',
    note: `${record.file} — ${record.bytes.toLocaleString('en-GB')} bytes, as published.`,
  }
}

/* ---------------------------------------------------------- header and links */

/**
 * The raw archive URL for the mesh.
 *
 * Derived rather than stored: verified across all 8,702 live rows with zero
 * exceptions, every `storage_address` is `{assets.models}/{md5[:6]}/{md5}.stl`.
 * The drawer shows it because the design deliberately surfaces it — §2.5 — and
 * it is a real, fetchable HTTPS URL, so it is rendered as a link.
 */
export function storageAddress(assets: CatalogAssets, record: CatalogRecord): string {
  return `${assets.models}/${shardedPath(record.blob)}.stl`
}

/** The eyebrow's first half. 89 tiles (1.0%) carry no texture tag. */
export function textureSetLabel(record: CatalogRecord): string {
  return record.texture === undefined ? 'No texture set' : humanise(record.texture)
}

/**
 * The eyebrow's second half.
 *
 * `kinds` is an array on purpose: 19.5% of tiles are in two or more buckets and
 * 11.9% are in none. Both cases are shown as they are rather than collapsed to a
 * first element or to a blank.
 */
export function componentLabel(record: CatalogRecord): string {
  if (record.kinds.length === 0) return 'Uncategorised'
  return record.kinds.map((kind) => humanise(kind)).join(' + ')
}

/**
 * The family subtitle: `tiles/aztlan/floors/floor/openforge` →
 * `aztlan / floors / floor / openforge`.
 *
 * This is the **catalog** family — a Dropbox folder, 1,130 of them — which is
 * what drives the variant buttons at the foot of the drawer. It is not the
 * material family; that resolves from the texture tag through the registry.
 */
export function familyTrail(record: CatalogRecord): string {
  const segments = record.family.split('/').filter((segment) => segment !== '')
  const withoutRoot = segments[0] === 'tiles' ? segments.slice(1) : segments
  return withoutRoot.length === 0 ? record.family : withoutRoot.join(' / ')
}
