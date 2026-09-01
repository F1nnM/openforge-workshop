/**
 * The library's two derivations: which group a tile is in, and what the library
 * costs to download.
 *
 * Both are here rather than in the screen because both are answers to questions
 * the data makes non-obvious, and both are checkable without a DOM.
 *
 * ## 1. `kinds` is an array, so "grouped by component kind" needs a rule
 *
 * design-contract.md §2.3 groups the library by component kind. The mock could
 * write that as `groupBy(tile.kind)` because its `kind` was a single value. The
 * real field is `CatalogRecord.kinds`, an array, and over the emitted 8,702-row
 * index:
 *
 * | tiles | `kinds`                          |
 * | ----- | -------------------------------- |
 * | 3,590 | `wall`                           |
 * | 1,288 | `floor`                          |
 * | 1,032 | *(empty)*                        |
 * |   906 | `base` + `wall`                  |
 * |   686 | `base`                           |
 * |   189 | `stairs`                         |
 * |   176 | `floor` + `wall`                 |
 * |   176 | `base` + `riser`                 |
 * |   147 | `angled` + `wall`                |
 * |   143 | `riser`                          |
 * |   116 | `base` + `floor`                 |
 * |    81 | `column`                         |
 * |    79 | `angled` + `base`                |
 * |    53 | `column` + `wall`                |
 * |    31 | `angled` + `floor`               |
 * |     8 | `stairs` + `wall`                |
 * |     1 | `angled` + `column` + `floor` + `wall` |
 *
 * 1,693 tiles (19.5%) carry two or more and 1,032 (11.9%) carry none. Rendering
 * a tile once per bucket would put the 906 wall bases in two groups, and then
 * the group counts sum to more than the library — a summary that says "12 tiles"
 * above groups adding to 15 is a bug the user can see. So **exactly one group per
 * tile**, chosen by {@link KIND_PRECEDENCE}, and {@link collectLibrary} asserts
 * the sum by construction: every id lands in exactly one bucket or in `missing`.
 *
 * The precedence is *specificity*, not frequency:
 *
 *   - **`base` first.** A base is defined by what it mounts rather than by what
 *     it looks like, which is why 906 rows are `base`+`wall` and 116 are
 *     `base`+`floor` — and why the assembly resolver keys on `layer: 'base'`
 *     independently of shape. Letting `wall` or `floor` win would file the whole
 *     base inventory inside the two largest groups, where a user hunting for the
 *     base that fits a topper cannot see it.
 *   - **The specific vertical forms next** — `stairs`, `riser`, `angled`,
 *     `column`. These tags are only ever applied *in addition to* a wall or a
 *     floor to say "this one is actually a staircase / a riser / an angled
 *     piece": 147 `angled`+`wall`, 53 `column`+`wall`, 8 `stairs`+`wall`. The
 *     rarer noun is the informative one.
 *   - **`wall` beats `floor`.** The 176 `floor`+`wall` rows are wall-on-tile
 *     pieces: the floor plate is what the wall is mounted on, and the wall is
 *     what the user went looking for. Filing them under Floors would also put
 *     them among the plain floor tiles, which is the one place they must not be.
 *   - **`floor` last** of the known kinds — the most generic form, and the right
 *     fallback for the 31 `angled`+`floor` and 1 four-kind row that reach it.
 *   - **No `kinds` at all → {@link KIND_OTHER}**, the sentinel
 *     `src/search/facets.ts` already invented for the same 1,032 tiles (mostly
 *     `component|` inserts — doors and windows carry no `shape|` root, and
 *     `shape|door` has zero occurrences in the corpus). It gets a **visible
 *     group**, for the same reason the facet sidebar gives it a visible row:
 *     without one, an eighth of anything the user can save is displayed nowhere.
 *
 * ## 2. The byte total dedupes by md5
 *
 * 171 md5s are shared by 520 catalog rows — the same physical STL filed under
 * two paths, which is correct data modelling and fatal to summing over tile ids.
 * `src/assembly/bill.ts` records the same fact and the same conclusion for a
 * *scene*; a library is not a scene (no placements, no auto-inserted bases, no
 * quantities), so `buildBillOfTiles` is the wrong shape here and only its two
 * transferable pieces are reused: the dedupe key (`blob`) and
 * {@link downloadSize}, so the library warns at exactly the byte counts the
 * builder's bill warns at instead of inventing a second pair of thresholds.
 */
import type { BlobId, CatalogRecord, TileId } from '@/catalog'
import type { DownloadSize } from '@/assembly'
import { downloadSize } from '@/assembly'
import { KIND_OTHER } from '@/search'

/* -------------------------------------------------------------- precedence */

/**
 * Which kind wins when a tile is in several buckets. Most specific first.
 *
 * See the module docblock for the corpus combinations each entry decides. A kind
 * the importer adds later (the vocabulary is `string[]`, not an enum) is not an
 * error: it ranks after every entry here, so an unrecognised bucket still
 * produces one group with a humanised label rather than silently folding into
 * `floor`.
 */
export const KIND_PRECEDENCE: readonly string[] = [
  'base',
  'stairs',
  'riser',
  'angled',
  'column',
  'wall',
  'floor',
]

function precedenceRank(kind: string): number {
  const index = KIND_PRECEDENCE.indexOf(kind)
  return index === -1 ? KIND_PRECEDENCE.length : index
}

/**
 * The one group a record belongs to.
 *
 * Total and deterministic for every possible `kinds` array: the minimum
 * precedence rank wins, ties between two equally unranked kinds break
 * lexicographically, and an empty array is {@link KIND_OTHER}.
 */
export function groupKindOf(record: CatalogRecord): string {
  let best: string | undefined
  let bestRank = Number.POSITIVE_INFINITY

  for (const kind of record.kinds) {
    const rank = precedenceRank(kind)
    if (rank < bestRank || (rank === bestRank && best !== undefined && kind < best)) {
      best = kind
      bestRank = rank
    }
  }

  return best ?? KIND_OTHER
}

/* ------------------------------------------------------------------ grouping */

/** One rule-and-cards block on the screen. Never empty. */
export interface LibraryGroup {
  /** The kind bucket, for {@link kindLabel}. May be {@link KIND_OTHER}. */
  readonly kind: string
  /** The tiles in it, sorted by name then id. */
  readonly records: readonly CatalogRecord[]
}

/** Everything the screen renders, derived once per library or catalog change. */
export interface LibraryContents {
  /** Groups in display order; only non-empty ones. Counts sum to `tiles`. */
  readonly groups: readonly LibraryGroup[]
  /** Saved tiles resolved against the catalog. `groups` holds exactly these. */
  readonly tiles: number
  /**
   * Distinct files behind those tiles — `tiles` minus the shared-md5 duplicates.
   * Equal to `tiles` for almost every library; see the module docblock.
   */
  readonly files: number
  /** Deduped byte total, with the builder's own download verdict. */
  readonly size: DownloadSize
  /**
   * Saved ids the current catalog does not contain, sorted.
   *
   * A real state rather than a defensive branch: an imported file (or a link
   * shared by someone on an older build) can name a tile a later import
   * renamed or dropped, and the store holds ids the catalog is free to change
   * out from under. Reported so the user can clear them, because a saved tile
   * that renders nowhere and cannot be removed is unremovable for ever.
   */
  readonly missing: readonly TileId[]
}

export interface CollectLibraryOptions {
  /** The saved ids, in any order. */
  readonly ids: Iterable<TileId>
  /** Catalog lookup — `SearchEngine.record`. */
  readonly record: (id: TileId) => CatalogRecord | undefined
  /**
   * Group display order, as a list of kinds — pass `engine.vocabulary.kinds`.
   *
   * **Corpus order, not the user's own counts.** The vocabulary is ordered by
   * corpus count descending (wall, base, floor, riser, angled, stairs, column),
   * so it is a property of the catalog and is the same on every visit. Ordering
   * the groups by how many the *user* has is tempting — it puts their biggest
   * group first — but the library is the one screen whose primary verb is
   * *remove*, and count-ordered groups reorder the moment that verb is used: the
   * remove button the user was about to press second moves out from under the
   * cursor because the first press changed a group's rank. `src/search/facets.ts`
   * records the same objection for the sidebar's chips. Each group prints its own
   * count beside its rule, which is what "how many walls do I have" actually
   * needed.
   *
   * {@link KIND_OTHER} is forced last however the vocabulary ranks it (the
   * corpus puts it third), because it is the bucket meaning "none of the above"
   * and reads as a remainder rather than as a category.
   */
  readonly kindOrder: readonly string[]
}

export function collectLibrary({ ids, record, kindOrder }: CollectLibraryOptions): LibraryContents {
  const buckets = new Map<string, CatalogRecord[]>()
  const missing: TileId[] = []
  const blobs = new Set<BlobId>()
  let tiles = 0
  let bytes = 0

  for (const id of ids) {
    const found = record(id)
    if (found === undefined) {
      missing.push(id)
      continue
    }
    tiles += 1
    // One copy per md5, whatever the number of catalog rows pointing at it.
    if (!blobs.has(found.blob)) {
      blobs.add(found.blob)
      bytes += found.bytes
    }
    const kind = groupKindOf(found)
    const bucket = buckets.get(kind)
    if (bucket === undefined) buckets.set(kind, [found])
    else bucket.push(found)
  }

  for (const bucket of buckets.values()) bucket.sort(compareRecords)

  return {
    groups: [...buckets.entries()]
      .map(([kind, records]) => ({ kind, records }))
      .sort((a, b) => displayRank(a.kind, kindOrder) - displayRank(b.kind, kindOrder)),
    tiles,
    files: blobs.size,
    size: downloadSize(bytes),
    missing: missing.sort(compareIds),
  }
}

/**
 * Card order inside a group: display name, then id.
 *
 * Alphabetical rather than insertion order, because insertion order is not a
 * thing the user can see — two visits to the same library would otherwise differ
 * only in a way that looks arbitrary — and because a group of thirty walls is
 * scannable by name and not by when it was clicked. Code-unit comparison, not
 * `localeCompare`: names are synthesised from ASCII tag segments, and collation
 * that varies with the browser's ICU build would make the order a property of
 * the machine. `id` breaks the tie, and `CatalogFile` proves it unique.
 */
function compareRecords(a: CatalogRecord, b: CatalogRecord): number {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1
  return compareIds(a.id, b.id)
}

function compareIds(a: TileId, b: TileId): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

/** Position of a group's rule. Unknown kinds after known ones, `!other` last. */
function displayRank(kind: string, kindOrder: readonly string[]): number {
  if (kind === KIND_OTHER) return kindOrder.length + 1
  const index = kindOrder.indexOf(kind)
  return index === -1 ? kindOrder.length : index
}

/* ------------------------------------------------------------------- summary */

/**
 * The summary's byte figure — `29.1 MB`, `518.3 MB`, `1.6 GB`.
 *
 * design-contract.md §2.3 writes the summary as `{n} tiles · {mb} MB`, and MB is
 * the right unit for the libraries the mock was drawn against. It stops being
 * the right unit at this corpus's scale: the median tile is 10.36 MB and p95 is
 * 32.89 MB, so sixty saved walls is comfortably past a gigabyte, and `1640.0 MB`
 * is a number a reader has to convert before it means anything. The unit is
 * therefore chosen from the value, which is the same call — and the same
 * reasoning — as `src/screens/landing/stats.ts#formatBytes`.
 *
 * Not shared with that function: it rounds MB to whole numbers, which is right
 * for a 108 GB corpus figure and wrong here, where a three-tile library reading
 * `29 MB` loses the precision the cards beside it show. Nor shared with
 * `fileSizeLabel`, which is always MB above a megabyte because a single STL
 * never reaches a gigabyte. Decimal units (10⁶, 10⁹) throughout, matching every
 * other size in the app and what the OS reports for the same file.
 */
export function totalBytesLabel(bytes: number): string {
  if (bytes < 1_000_000) return `${String(Math.round(bytes / 1_000))} kB`
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`
}

/**
 * A threshold, without the decimal {@link totalBytesLabel} keeps.
 *
 * Only ever applied to `DownloadSize.threshold`, which is 512 MB or 2 GB — round
 * by construction, so "over 512 MB" is exact and "over 512.0 MB" would be a
 * false claim of precision about a limit nobody measured.
 */
export function roundBytesLabel(bytes: number): string {
  if (bytes < 1_000_000_000) return `${String(Math.round(bytes / 1_000_000))} MB`
  return `${String(Math.round(bytes / 1_000_000_000))} GB`
}
