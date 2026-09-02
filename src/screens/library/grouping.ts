/**
 * The library's two derivations: which group an item is in, and what the library
 * costs to download.
 *
 * Both are here rather than in the screen because both are answers to questions
 * the data makes non-obvious, and both are checkable without a DOM.
 *
 * ## The library lists items and stores files, and both numbers are real
 *
 * Row A3. The store holds `TileId`s, because a library entry is a *file* someone
 * downloads and prints — nothing about aggregation changes that, and it should
 * not: 8,702 files is what the archive contains and `client-zip` puts files in a
 * zip. What changes is the **unit the screen lists**, which is now the item, the
 * same unit the catalog grid shows.
 *
 * So a saved library has two honest sizes and this module reports both:
 *
 *   - {@link LibraryContents.items} — the cards on screen, and what the group
 *     counts sum to.
 *   - {@link LibraryContents.tiles} — the saved files behind them.
 *
 * They differ whenever a user saves two variants of one design, which 1,705 of
 * the 3,822 aggregates (44.6%) allow. That is not an edge case to smooth over: a
 * user who saved the topless *and* the unsupported print of a base has two files
 * to print and deliberately said so. Collapsing them to one card without saying
 * "2 files" would under-report the download, and the byte total is the number
 * this screen exists to warn about.
 *
 * **What happened to the per-file rows:** they moved inside the card. One saved
 * variant renders exactly the card it always did. Two or more render that card
 * plus a row per saved file, each with its own remove — see
 * {@link LibraryItem.saved}. Nothing is hidden and nothing became unreachable;
 * the library is one card per item and still one row per file underneath.
 *
 * ## 1. `kinds` is an array, so "grouped by component kind" needs a rule
 *
 * design-contract.md §2.3 groups the library by component kind. The mock could
 * write that as `groupBy(tile.kind)` because its `kind` was a single value. The
 * real field is `kinds`, an array, and over the emitted 8,702-row index:
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
 * the group counts sum to more than the library — a summary that says "12 items"
 * above groups adding to 15 is a bug the user can see. So **exactly one group per
 * item**, chosen by {@link KIND_PRECEDENCE}, and {@link collectLibrary} asserts
 * the sum by construction: every id lands in exactly one bucket or in `missing`.
 *
 * The rule reads `kinds` off the **aggregate**, and that costs nothing: A1
 * measured that the number of aggregates holding two distinct values of `kinds`
 * is **0**, so an item's kind bucket is its files' kind bucket and grouping did
 * not have to be re-derived at all.
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
 * ## 2. The byte total dedupes by md5, and now has two reasons to
 *
 * 171 md5s are shared by 520 catalog rows — the same physical STL filed under
 * two paths, which is correct data modelling and fatal to summing over tile ids.
 *
 * Aggregation adds a second source of the same collision: **66 of the 1,705
 * multi-variant aggregates hold two variants sharing one blob**, and 25 hold
 * variants that are *all* one blob. So a user who saves two variants of one of
 * those items has saved one file twice. `blob` is the dedupe key for both cases
 * and one pass over it settles them together.
 *
 * `src/assembly/bill.ts` records the same fact and the same conclusion for a
 * *scene*; a library is not a scene (no placements, no auto-inserted bases, no
 * quantities), so `buildBillOfTiles` is the wrong shape here and only its two
 * transferable pieces are reused: the dedupe key (`blob`) and
 * {@link downloadSize}, so the library warns at exactly the byte counts the
 * builder's bill warns at instead of inventing a second pair of thresholds.
 */
import type {
  AggregateIndex,
  BlobId,
  CatalogRecord,
  TileAggregate,
  TileId,
  TileVariant,
} from '@/catalog'
import type { DownloadSize } from '@/assembly'
import { downloadSize } from '@/assembly'
import { KIND_OTHER } from '@/search'

/* -------------------------------------------------------------- precedence */

/**
 * Which kind wins when an item is in several buckets. Most specific first.
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
 * The one group a `kinds` array belongs to.
 *
 * Takes the array rather than a record or an aggregate, because both carry the
 * same field and A1 measured that they always agree — 0 of 3,822 aggregates hold
 * two distinct values of `kinds`. A signature naming either type would make the
 * function look like it knew something about that type that it does not.
 *
 * Total and deterministic for every possible array: the minimum precedence rank
 * wins, ties between two equally unranked kinds break lexicographically, and an
 * empty array is {@link KIND_OTHER}.
 */
export function groupKindOf(kinds: readonly string[]): string {
  let best: string | undefined
  let bestRank = Number.POSITIVE_INFINITY

  for (const kind of kinds) {
    const rank = precedenceRank(kind)
    if (rank < bestRank || (rank === bestRank && best !== undefined && kind < best)) {
      best = kind
      bestRank = rank
    }
  }

  return best ?? KIND_OTHER
}

/* ------------------------------------------------------------------ grouping */

/** One card on the screen: an item, and the files of it the user saved. */
export interface LibraryItem {
  readonly item: TileAggregate
  /**
   * The saved variants, in {@link TileAggregate.variants} order. Never empty —
   * an item is in this list because at least one of its files is saved.
   *
   * This is the per-file detail the card discloses. Its length is 1 for a user
   * who saved one way of printing the item and more for one who saved several,
   * which 44.6% of items allow.
   */
  readonly saved: readonly [TileVariant, ...TileVariant[]]
  /**
   * The record the card renders — thumbnail, blob, sprite sheet.
   *
   * The first **saved** variant carrying a sprite, else the first saved variant.
   * Deliberately not {@link TileAggregate.preview}: that is the best-looking
   * variant of the whole item, and this card is showing what the user actually
   * has. The sprite preference is A1's rule scoped to the saved set, and it
   * matters for the one record of 8,702 that has no sheet — if that is the file
   * the user saved, the card says "no render", which is the truth about their
   * file rather than a picture of a sibling's.
   */
  readonly preview: CatalogRecord
  /** Deduped bytes across {@link saved} — what this card costs to download. */
  readonly bytes: number
}

/** One rule-and-cards block on the screen. Never empty. */
export interface LibraryGroup {
  /** The kind bucket, for `kindLabel`. May be {@link KIND_OTHER}. */
  readonly kind: string
  /** The items in it, sorted by name then design. */
  readonly items: readonly LibraryItem[]
}

/** Everything the screen renders, derived once per library or catalog change. */
export interface LibraryContents {
  /** Groups in display order; only non-empty ones. Item counts sum to {@link items}. */
  readonly groups: readonly LibraryGroup[]
  /** Items on screen — the cards, and the summary's headline count. */
  readonly items: number
  /** Saved files resolved against the catalog. `>= items`; equal for most libraries. */
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
   * The aggregate layer — `SearchEngine.aggregates`.
   *
   * Read for `byTile` (a saved id to its variant, then to its design) and
   * `byDesign` (that design's item). Both are maps A1 built once for the whole
   * session, so grouping a sixty-tile library is sixty map lookups rather than a
   * scan.
   */
  readonly aggregates: AggregateIndex
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

/**
 * What one item accumulates while the saved ids are walked.
 *
 * Both lists are typed **non-empty**, which is not decoration: an entry is
 * created with one variant and only ever appended to, so emptiness is
 * unreachable — and typing it this way is what lets {@link buildItem} pick a
 * first element and a fallback record without a cast or a fabricated stand-in
 * for a case that cannot happen. The same argument A1 makes for
 * `TileAggregate.variants`.
 */
interface Pending {
  readonly item: TileAggregate
  readonly saved: [TileVariant, ...TileVariant[]]
  readonly records: [CatalogRecord, ...CatalogRecord[]]
}

export function collectLibrary({
  ids,
  record,
  aggregates,
  kindOrder,
}: CollectLibraryOptions): LibraryContents {
  const pending = new Map<string, Pending>()
  const missing: TileId[] = []
  let tiles = 0

  for (const id of ids) {
    const found = record(id)
    const variant = aggregates.byTile.get(id)
    const item = variant === undefined ? undefined : aggregates.byDesign.get(variant.design)
    // All three come from one `CatalogFile`, so a resolved record always has a
    // variant and an item. A saved id from an older build resolves to none of
    // them and is reported rather than dropped; treating a partial resolution as
    // missing too is the only honest option, since a card needs all three.
    if (found === undefined || variant === undefined || item === undefined) {
      missing.push(id)
      continue
    }

    tiles += 1
    const existing = pending.get(item.design)
    if (existing === undefined) {
      pending.set(item.design, { item, saved: [variant], records: [found] })
    } else {
      existing.saved.push(variant)
      existing.records.push(found)
    }
  }

  const buckets = new Map<string, LibraryItem[]>()
  const blobs = new Set<BlobId>()
  let bytes = 0

  for (const entry of pending.values()) {
    const built = buildItem(entry)
    // One copy per md5 across the whole library, whatever the number of catalog
    // rows or sibling variants pointing at it.
    for (const variant of entry.saved) {
      if (blobs.has(variant.blob)) continue
      blobs.add(variant.blob)
      bytes += variant.bytes
    }
    const kind = groupKindOf(entry.item.kinds)
    const bucket = buckets.get(kind)
    if (bucket === undefined) buckets.set(kind, [built])
    else bucket.push(built)
  }

  for (const bucket of buckets.values()) bucket.sort(compareItems)

  return {
    groups: [...buckets.entries()]
      .map(([kind, items]) => ({ kind, items }))
      .sort((a, b) => displayRank(a.kind, kindOrder) - displayRank(b.kind, kindOrder)),
    items: pending.size,
    tiles,
    files: blobs.size,
    size: downloadSize(bytes),
    missing: missing.sort(compareIds),
  }
}

/**
 * One card, from what the walk accumulated.
 *
 * The saved variants are re-sorted into the aggregate's own order rather than
 * kept in `Object.keys` order: the store's key order is an artefact of insertion
 * and would make the same library render its variant rows differently after an
 * export and re-import.
 */
function buildItem({ item, saved, records }: Pending): LibraryItem {
  const order = new Map(item.variants.map((variant, at) => [variant.id, at]))
  // Copied as a tuple and sorted in place, so the non-emptiness survives the
  // sort — `[...saved].sort()` would widen it to an array and cost a cast.
  const sorted: [TileVariant, ...TileVariant[]] = [saved[0], ...saved.slice(1)]
  sorted.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))

  const byId = new Map(records.map((found) => [found.id, found]))
  const withSprite = sorted.find((variant) => variant.sprite) ?? sorted[0]

  return {
    item,
    saved: sorted,
    // `records` is appended in lockstep with `saved`, so it holds the record for
    // every saved variant; `records[0]` is the unreachable branch's answer and is
    // a real record rather than a fabrication.
    preview: byId.get(withSprite.id) ?? records[0],
    bytes: dedupedBytes(sorted),
  }
}

/** Bytes across one card's saved variants, counting a shared md5 once. */
function dedupedBytes(variants: readonly TileVariant[]): number {
  const seen = new Set<BlobId>()
  let total = 0
  for (const variant of variants) {
    if (seen.has(variant.blob)) continue
    seen.add(variant.blob)
    total += variant.bytes
  }
  return total
}

/**
 * Card order inside a group: display name, then design.
 *
 * Alphabetical rather than insertion order, because insertion order is not a
 * thing the user can see — two visits to the same library would otherwise differ
 * only in a way that looks arbitrary — and because a group of thirty walls is
 * scannable by name and not by when it was clicked. Code-unit comparison, not
 * `localeCompare`: names are synthesised from ASCII tag segments, and collation
 * that varies with the browser's ICU build would make the order a property of
 * the machine.
 *
 * `design` breaks the tie and is what makes the order total where `id` used to:
 * 131 display names are shared by 323 aggregates, so the tie is reached far more
 * often than it was per-file, and `design` is unique across the 3,822 by
 * construction.
 */
function compareItems(a: LibraryItem, b: LibraryItem): number {
  if (a.item.name !== b.item.name) return a.item.name < b.item.name ? -1 : 1
  return a.item.design < b.item.design ? -1 : a.item.design > b.item.design ? 1 : 0
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
