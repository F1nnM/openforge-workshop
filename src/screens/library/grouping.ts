/**
 * The library's two derivations: which group an item is in, and what the library
 * costs to download.
 *
 * Both are here rather than in the screen because both are answers to questions
 * the data makes non-obvious, and both are checkable without a DOM.
 *
 * ## One entry is one item, so there is nothing left to reconcile
 *
 * Row V2, on top of V1. This module used to open with an argument titled *"the
 * library lists items and stores files, and both numbers are real"*, and the
 * whole of it is gone: `WorkshopState.library` is keyed by {@link DesignId}, so
 * the unit the store holds and the unit the screen lists are the same thing. The
 * two counts it reconciled — cards against saved files — cannot disagree, because
 * there is no saved file. What each entry now needs is not a *set* of files but
 * an answer to one question: **which file will this item actually download?**
 *
 * That question has an answer, and it is `selectVariant` under the build's lock
 * preference — the same function `resolvePlacement` resolves a placement with, so
 * the library and the builder cannot name different files for one item. The
 * preference arrives as a parameter ({@link CollectLibraryOptions.preference})
 * rather than being read from the store here, which is what keeps this module
 * pure and lets `grouping.test.ts` re-derive every figure below per lock.
 *
 * ## The picture and the download are different files, and that is measured
 *
 * {@link LibraryItem.preview} is `TileAggregate.preview` — a sprite-carrying
 * **topper** by row V5's rule, because a topper's mesh is the tile and nothing
 * else. {@link LibraryItem.resolved} is `selectVariant`'s pick, whose first
 * criterion is the opposite one — *prefer one part over two*, so a
 * self-sufficient `integral` beats a topper. They therefore disagree, often:
 *
 * | lock | resolution ≠ preview | median byte ratio | p90 | max |
 * | --- | ---: | ---: | ---: | ---: |
 * | openlock   | **1,611** of 3,822 (42.2%) | 1.09 | 2.86 | 146× |
 * | dragonlock | 609 (15.9%) | 1.03 | 1.65 | 39,401× |
 * | magnetic   | 1,055 (27.6%) | 1.04 | 2.85 | 39,401× |
 *
 * Every one of those disagreements is also a **byte** disagreement — the counts
 * are identical, so there is not one item where the two files happen to be the
 * same size. That is the whole reason {@link LibraryItem.resolved} exists as a
 * field instead of the card sizing its own picture: a card that printed
 * `preview.bytes` would be out by 2.86× on a tenth of an openlock library and by
 * four orders of magnitude in the worst case. It is also the same defect row V1
 * fixed one level down — *render one file, act on another* — so this module
 * declines to reintroduce it in the byte figure.
 *
 * The corpus-wide totals hide it completely: 54.60 GB of preview against 54.56 /
 * 54.39 / 53.68 GB of resolution. **A total that is right to 0.1% over a
 * per-item error of 42.2% is exactly the kind of green nobody should trust**, and
 * it is why `grouping.test.ts` asserts the per-item counts and not only the sum.
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
 * the sum by construction: every design lands in exactly one bucket or in
 * `missing`.
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
 * ## 2. The byte total still dedupes by md5, and it is still not a no-op
 *
 * 171 md5s are shared by 520 catalog rows — the same physical STL filed under
 * two paths, which is correct data modelling and fatal to summing per item.
 * Aggregation used to add a second source of the same collision (two saved
 * variants of one item on one blob); that source is gone with the saved set, and
 * what is left is the original one, **measured through the resolution rather than
 * over every file**: with the whole corpus saved, two or more items resolve to a
 * single md5 for **28 blobs across 64 designs under openlock** (24/56 dragonlock,
 * 26/60 magnetic), so 36 of 3,822 rows are a second path to a file already
 * counted.
 *
 * That is 0.94% rather than the 4.0% the file-keyed version deduped, and it is
 * still worth doing: `blob` is one `Set` over a list the module already walks,
 * the alternative overstates a figure the screen exists to warn about, and
 * {@link LibraryContents.files} is what lets `LibraryNotes` explain why a
 * twelve-card library reports eleven files. The dedupe is **global**, not
 * per-card: one card resolves to one file, so a per-card dedupe would be a no-op
 * and this module no longer has one.
 *
 * ## 3. What the byte total leaves out, said rather than hidden
 *
 * The figure is **one file per item** — the tile, not the assembly. For an item
 * whose resolution is a topper the print is two parts, and measured per lock the
 * majority of items are exactly that: **2,137 of 3,822 (55.9%) under openlock,
 * 3,062 (80.1%) under dragonlock, 3,068 (80.3%) under magnetic.**
 *
 * The old field could stay quiet about this, because it summed files the user had
 * *chosen*: the library made no claim to know what a complete print was. This one
 * does make that claim, so the omission became a claim too, and
 * {@link LibraryContents.needsBase} carries it to `LibraryNotes` for one note on
 * the screen rather than a caveat on 80% of the cards.
 *
 * **The count is the bill's own base-insertion predicate.** `resolvePlacement`
 * runs `selectVariant(aggregate, { bottom: lock, options: PRINT_OPTIONS })` — the
 * same call, with the same preference — and inserts a base part on exactly
 * `selection.verdict === 'needs-base'` (`src/assembly/resolve.ts`). So the note
 * is not an estimate of what the builder would do; under the same lock it is the
 * same expression evaluated over a library instead of over a scene.
 *
 * Row V3 corrected a neighbouring claim that is worth not repeating: *arming* a
 * topper in the palette does **not** put a base in the bill, because rule 0
 * re-resolves the item and may pick the one-part print instead. What earns a base
 * is the *resolution* being a topper, which is what this field counts — not the
 * user having placed one.
 *
 * **Not filled in here**: which base an item gets is `matchBase`'s answer, it
 * needs the base index in `src/assembly/resolve.ts`, and it is only answerable
 * for 88.3 / 81.6 / 78.7% of designs — so counting it would swap a stated
 * omission for a silently partial total. The builder's bill of tiles is where a
 * base becomes a line item, and that is the screen with a download button on it.
 *
 * `src/assembly/bill.ts` records the same md5 conclusion for a *scene*; a library
 * is not a scene (no placements, no auto-inserted bases, no quantities), so
 * `buildBillOfTiles` is the wrong shape here and only its two transferable pieces
 * are reused: the dedupe key (`blob`) and {@link downloadSize}, so the library
 * warns at exactly the byte counts the builder's bill warns at instead of
 * inventing a second pair of thresholds.
 */
import type {
  AggregateIndex,
  BlobId,
  CatalogRecord,
  DesignId,
  TileAggregate,
  TileId,
  TileVariant,
  VariantPreference,
  VariantVerdict,
} from '@/catalog'
import { selectVariant } from '@/catalog'
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

/** One card on the screen: an item, its picture, and the file it downloads as. */
export interface LibraryItem {
  readonly item: TileAggregate
  /**
   * The record behind {@link TileAggregate.preview} — thumbnail, blob, sprite
   * sheet, and the manifest ordinal the card's link carries.
   *
   * **`TileAggregate.preview` and nothing else.** This field used to be derived
   * here, from the saved set, under a docblock arguing that the aggregate's own
   * preview was the wrong picture because *"this card is showing what the user
   * actually has"*. There is no saved set to be faithful to any more: the user
   * has the item. Row V5 additionally made the aggregate's rule prefer a
   * sprite-carrying **topper**, which is the picture of the tile alone, so the
   * derivation this module used to run would now be a worse answer as well as an
   * unmotivated one. It is deleted rather than repointed — see the module
   * docblock's disagreement table for what it was deriving.
   *
   * A `CatalogRecord` and not the {@link TileVariant}, because
   * `CatalogIndex.materialOf` takes a record: the tint must be the same
   * resolution the catalog grid uses, or one mesh reads as stone on one screen
   * and grey on the other.
   */
  readonly preview: CatalogRecord
  /**
   * The file this item downloads as under {@link CollectLibraryOptions.preference}
   * — `selectVariant`'s pick, and the card's byte figure.
   *
   * **Singular, and that is the measurement that killed the list.** The plan for
   * this row suggested the old per-file rows become *"what this will resolve to"*
   * under the current lock. `selectVariant` is single-valued, so under one lock
   * that list has exactly one row for **3,822 of 3,822 items** — it is a line,
   * not a list, and it is rendered as one. The 1,419 items (37.1%) that resolve
   * to two or more distinct files do so *across the three locks*, which is a
   * question no single render of this card asks; `src/store/corpus.test.ts` owns
   * that figure, as the argument for the key rather than for a card.
   *
   * Not the same file as {@link preview} for up to 42.2% of items, which is why
   * the card names it instead of only sizing it.
   */
  readonly resolved: TileVariant
  /**
   * How complete a print {@link resolved} is — `selectVariant`'s verdict.
   *
   * Read for one thing: `'needs-base'` means the byte figure is one file of two.
   * See the module docblock for the per-lock shares and for why the base is not
   * added to the total.
   */
  readonly verdict: VariantVerdict
}

/** One rule-and-cards block on the screen. Never empty. */
export interface LibraryGroup {
  /** The kind bucket, for `kindLabel`. May be {@link KIND_OTHER}. */
  readonly kind: string
  /** The items in it, sorted by name then design. */
  readonly items: readonly LibraryItem[]
}

/** Everything the screen renders, derived once per library, catalog or lock change. */
export interface LibraryContents {
  /** Groups in display order; only non-empty ones. Item counts sum to {@link items}. */
  readonly groups: readonly LibraryGroup[]
  /** Items on screen — the cards, and the summary's headline count. */
  readonly items: number
  /**
   * Distinct files behind those items — `items` minus the shared-md5 duplicates.
   *
   * `<= items`, and equal for almost every library: the collision needs two
   * *different* items to resolve to one md5, which the whole corpus does 28 times
   * over 64 designs. It is the number `LibraryNotes` explains the byte total
   * with.
   */
  readonly files: number
  /** Deduped byte total, with the builder's own download verdict. */
  readonly size: DownloadSize
  /**
   * Items whose {@link LibraryItem.verdict} is `'needs-base'` — the ones
   * {@link size} counts one file of two for.
   *
   * A majority under every lock (55.9 / 80.1 / 80.3%), so it is a note on the
   * screen and not a badge on each card.
   */
  readonly needsBase: number
  /**
   * Saved designs the current catalog does not contain, sorted.
   *
   * A real state rather than a defensive branch, and the reasons changed with the
   * key. A `DesignId` is a content hash of the design's tag set, so it stops
   * resolving when someone **edits a tag on the item the user saved** — the
   * design hash's own instability, which `src/store/schema.ts` accepts as the
   * smaller exposure precisely because it fails closed *here*. An export written
   * on an older catalog can also name an item a later import dropped.
   *
   * Reported so the user can clear them, because a saved item that renders
   * nowhere and cannot be removed is unremovable for ever. It is also the bucket
   * a **wrong key** lands in silently: a library still keyed by file id resolves
   * to no design at all, so every entry arrives here and the screen says so — see
   * `grouping.test.ts`, which constructs exactly that.
   */
  readonly missing: readonly DesignId[]
}


export interface CollectLibraryOptions {
  /**
   * The saved designs, in any order — pass {@link libraryDesigns}`(library)`.
   *
   * An `Iterable` of a branded id and **not** the library map, because the brand
   * survives here and does not survive there; {@link libraryDesigns} carries the
   * measurement. Duplicates collapse: the store's keys cannot repeat, but this
   * parameter is an iterable and an array can.
   */
  readonly ids: Iterable<DesignId>
  /**
   * Catalog lookup — `SearchEngine.record`. Called once per item, for
   * {@link TileAggregate.preview}.
   */
  readonly record: (id: TileId) => CatalogRecord | undefined
  /**
   * The aggregate layer — `SearchEngine.aggregates`.
   *
   * Read for `byDesign` alone now: one hop from a saved key to its item, against
   * the two hops (`byTile`, then `byDesign`) a file-keyed library needed. It is a
   * map A1 builds once for the whole session, so grouping a sixty-item library is
   * sixty lookups rather than a scan.
   */
  readonly aggregates: AggregateIndex
  /**
   * Which file each item resolves to — pass
   * `{ bottom: lock, options: PRINT_OPTIONS }`.
   *
   * A parameter and not a store read, so this module stays pure and the tests can
   * re-derive the per-lock figures in its docblock. `options` matters: without it
   * `selectVariant`'s rank stops at "fewest options" and falls through to `bytes`
   * ascending on 121 variant tuples covering 297 records, every one a base — so
   * omitting it would let the smallest *print* of a base decide the card.
   */
  readonly preference: VariantPreference
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

export function collectLibrary({
  ids,
  record,
  aggregates,
  preference,
  kindOrder,
}: CollectLibraryOptions): LibraryContents {
  const buckets = new Map<string, LibraryItem[]>()
  const seenDesign = new Set<DesignId>()
  const missing = new Set<DesignId>()
  const blobs = new Set<BlobId>()
  let bytes = 0
  let items = 0
  let needsBase = 0

  for (const design of ids) {
    if (seenDesign.has(design)) continue
    seenDesign.add(design)

    const item = aggregates.byDesign.get(design)
    // `preview` names a file of the same `CatalogFile` the index was built from,
    // so a resolved item always has a preview record **when both parameters come
    // from one engine** — which the screen guarantees and this function cannot.
    // They are two independent arguments; a caller that mixes an index with
    // another catalog's lookup gets the item reported rather than a card with no
    // picture, and `grouping.test.ts` builds exactly that pair.
    const preview = item === undefined ? undefined : record(item.preview)
    if (item === undefined || preview === undefined) {
      missing.add(design)
      continue
    }

    const selection = selectVariant(item, preference)
    items += 1
    if (selection.verdict === 'needs-base') needsBase += 1
    // One copy per md5 across the whole library. Two *different* items resolving
    // to one file is the surviving collision — 28 blobs over 64 designs corpus
    // wide — and a card cannot see it, so the dedupe is here and nowhere else.
    if (!blobs.has(selection.variant.blob)) {
      blobs.add(selection.variant.blob)
      bytes += selection.variant.bytes
    }

    const kind = groupKindOf(item.kinds)
    const built: LibraryItem = {
      item,
      preview,
      resolved: selection.variant,
      verdict: selection.verdict,
    }
    const bucket = buckets.get(kind)
    if (bucket === undefined) buckets.set(kind, [built])
    else bucket.push(built)
  }

  for (const bucket of buckets.values()) bucket.sort(compareItems)

  return {
    groups: [...buckets.entries()]
      .map(([kind, group]) => ({ kind, items: group }))
      .sort((a, b) => displayRank(a.kind, kindOrder) - displayRank(b.kind, kindOrder)),
    items,
    files: blobs.size,
    size: downloadSize(bytes),
    needsBase,
    missing: [...missing].sort(compareIds),
  }
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

function compareIds(a: DesignId, b: DesignId): number {
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
