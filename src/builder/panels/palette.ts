/**
 * What the palette shows, decided without a DOM.
 *
 * **A row is an item, not a file** — row V3, finishing §7's *"place designs, not
 * files"* on the one surface that still armed a concrete STL. Everything below
 * therefore takes {@link TileAggregate}s and returns rows keyed by
 * {@link DesignId}, and the only place a file appears is
 * {@link PaletteRow.preview} (the picture) and {@link armFile} (the print).
 *
 * Four pure functions, and each of them exists because the answer is not
 * obvious from the contract:
 *
 *   - **{@link paletteRows}** orders the library so the items that can be placed
 *     come first. 9.7% of the corpus — the **370 items whose footprint is
 *     `none`** — is all the plan view refuses ({@link isPlaceable}), so a library
 *     assembled from the catalog screen will contain some. Interleaving greyed
 *     rows with live ones turns the list into a minefield; sinking them into one
 *     contiguous block at the end makes the refusal legible as a group and keeps
 *     the top of the list usable.
 *
 *     It was 29.1% of *files* and an `arc`-or-`none` test until row W6 made
 *     annular sectors placeable, and 8.3% of files after it. **As items it is
 *     9.7%, not 8.3%**: the 726 footprint-less files collapse into 370 designs,
 *     which is a smaller list of a larger share, because an unplaceable design
 *     averages 1.96 files against the corpus's 2.28.
 *   - **{@link searchRows}** caps the result list. The engine answers an
 *     unfiltered query with all 3,822 items in 2.6 ms, and rendering that many
 *     sprite-sheet thumbnails in a 272px column is 3,822 × 529 KB of images.
 *     The catalog screen virtualises; a palette does not need to, it needs to
 *     stop.
 *   - **{@link starterSet}** answers design-contract.md §2.4's "Add a starter
 *     set" with items that actually make a room: floors and walls of one texture,
 *     chosen from the live catalog rather than hard-coded, because a hard-coded
 *     id is a link into a corpus that renames files.
 *   - **{@link armFile}** is the one hop that still names a file, and it is
 *     temporary. See its own note; **row V4 deletes it.**
 *
 * All four take items and return items or designs. Nothing here reads the store,
 * the URL or the network.
 *
 * ## Why the keys arrive through {@link libraryDesigns} and not through a cast
 *
 * Before V3 the panel called this module as `paletteRows(Object.keys(library) as
 * TileId[], …)`. After V1 re-keyed the library to designs that call **still
 * compiled**, because the assertion said so, and every lookup then missed: the
 * palette's library block rendered empty for every saved item. A cast hid a wrong
 * key and the failure mode was an absence rather than an error.
 *
 * The fix is therefore not "cast to `DesignId[]` instead", and it is not "take the
 * map" either. **Measured against `tsc`, the map form is the weaker of the two:**
 *
 *   - `Readonly<Record<TileId, true>>` **is** assignable to
 *     `Readonly<Record<DesignId, true>>`. A branded string is not a literal
 *     union, so `Record` produces an index signature and the brand is dropped
 *     from the key position — a parameter typed as the design-keyed map accepts
 *     the file-keyed one in silence.
 *   - `readonly TileId[]` is **not** assignable to `readonly DesignId[]`. In an
 *     element position the brands are disjoint and the call is an error.
 *
 * So {@link paletteRows} takes the array, and {@link libraryDesigns} is what
 * produces it: generic over the record's own key type, so `libraryDesigns` over a
 * file-keyed map yields `TileId[]` and `paletteRows` then refuses it. The panel
 * holds no assertion of its own, and re-keying the library a second time is a
 * compile error at the call site rather than an empty list on screen. That is the
 * demonstration, not the hope: the two assignability facts above were checked
 * against the compiler, in both directions, before this shape was chosen.
 */
import { PRINT_OPTIONS } from '@/assembly'
import { isPlaceable } from '@/builder/canvas'
import type { CatalogRecord, DesignId, TileAggregate, TileId } from '@/catalog'
import { selectVariant } from '@/catalog'

/**
 * One row of the palette: an item, and the file whose picture stands for it.
 *
 * `item` is what the row *is* — the name, the size and the placeability all come
 * off it, and every one of those facets is hoisted, so reading them from the
 * aggregate rather than from a variant is not a shortcut. `preview` is what the
 * row *shows*.
 */
export interface PaletteRow {
  readonly item: TileAggregate
  /**
   * The record behind {@link TileAggregate.preview} — the thumbnail's blob,
   * sprite flag and material.
   *
   * Since row V5 this is a sprite-carrying **topper** wherever the item has one,
   * which is the bug the owner reported: the palette used to render whatever
   * file the library happened to hold, and for the 931 items that carry both an
   * `integral` and a `topper` the catalog card and the palette row could show
   * two different meshes of the same tile.
   *
   * A `CatalogRecord` and not a {@link TileVariant} because `CatalogIndex`'s
   * `materialOf` resolves the tint from a record's full tag list, and the tint
   * is often the only thing telling two 272px rows apart.
   */
  readonly preview: CatalogRecord
  /**
   * `isPlaceable(item)` — false for the 370 items with a `none` footprint.
   *
   * **A question about the item, and it is well posed.** `foot` is one of
   * `TileAggregate`'s hoisted facets: `pipeline/aggregate.ts` fails the build if
   * any of the 3,822 aggregates holds two distinct footprints, so every variant
   * of an item answers `isPlaceable` the same way. Measured directly over the
   * emitted index, the number of items whose variants disagree is **0**, and the
   * 370 refused items hold exactly the 726 refused files with nothing left over
   * — see `palette.corpus.test.ts`, which is what stops that becoming a stale
   * claim.
   *
   * That is also why a variant swap must not be attempted to rescue a refused
   * row: there is no sibling with a footprint to swap to.
   */
  readonly placeable: boolean
  /** Whether the item is already saved, which decides "+ add" versus nothing. */
  readonly inLibrary: boolean
}

/**
 * Resolves a design to the item and the picture a row needs.
 *
 * One lookup rather than two so a row cannot pair one index's aggregate with
 * another index's record, and so the palette has **one** drop rule instead of
 * two. `undefined` means "this build's catalog does not hold that design", which
 * is reachable: a library entry outlives the import that retired its files.
 */
export type PaletteLookup = (design: DesignId) => PaletteSource | undefined

/** What {@link PaletteLookup} resolves to. */
export interface PaletteSource {
  readonly item: TileAggregate
  readonly preview: CatalogRecord
}

/**
 * How many search results the palette lists.
 *
 * 40 is two screenfuls of 44px rows at the shortest viewport the layout supports,
 * which is enough to see that the query is working and few enough that the count
 * beside the field ("40 of 312") is what tells the user to narrow it.
 */
export const MAX_SEARCH_ROWS = 40


/**
 * The library, as rows: placeable first, then by name.
 *
 * Sorted rather than left in the store's insertion order. Insertion order is
 * "the order you happened to click Add on the catalog screen", which is not an
 * order anybody can navigate a fortnight later; a name sort is, and the corpus's
 * display names begin with the texture set, so the sort also groups a library by
 * material for free.
 *
 * Designs the current catalog does not hold are dropped here. The library screen
 * reports them and offers to remove them — that is the right place for it, and a
 * builder palette that listed an item it cannot describe would be offering a row
 * with no name, no size and no thumbnail.
 */
export function paletteRows(designs: readonly DesignId[], lookup: PaletteLookup): PaletteRow[] {
  const rows: PaletteRow[] = []
  for (const design of designs) {
    const found = lookup(design)
    if (found === undefined) continue
    rows.push({ ...found, placeable: isPlaceable(found.item), inLibrary: true })
  }
  return rows.sort(byPlaceableThenName)
}

/**
 * Search results, as rows.
 *
 * **Not** reordered: the engine ranks by text score and then by document
 * ordinal, and a palette that re-sorted its results would throw that ranking
 * away — the top hit for "2x2 dungeon" has to be at the top. Unplaceable results
 * stay where the ranking put them, marked, because a search is a question about
 * the whole catalog and silently dropping a tenth of the answers would make the
 * result count disagree with the list.
 *
 * `items` are the engine's own aggregates and the lookup is asked for each one
 * anyway, for the preview record — so the two halves of a row always come from
 * one index.
 */
export function searchRows(
  items: readonly TileAggregate[],
  lookup: PaletteLookup,
  inLibrary: (design: DesignId) => boolean,
  limit = MAX_SEARCH_ROWS,
): PaletteRow[] {
  const rows: PaletteRow[] = []
  for (const item of items) {
    if (rows.length >= limit) break
    const found = lookup(item.design)
    if (found === undefined) continue
    rows.push({ ...found, placeable: isPlaceable(found.item), inLibrary: inLibrary(item.design) })
  }
  return rows
}

function byPlaceableThenName(a: PaletteRow, b: PaletteRow): number {
  if (a.placeable !== b.placeable) return a.placeable ? -1 : 1
  if (a.item.name !== b.item.name) return a.item.name < b.item.name ? -1 : 1
  // Names are not unique — 131 of them are shared by 323 items — so the
  // aggregate's address breaks the tie and the order stays total. The address is
  // the group's lowest manifest ordinal, so the tie-break is *manifest order*
  // and reads as "whichever the importer met first"; the design id would also be
  // total but it is a content hash, and hash order is arbitrary on screen.
  return a.item.address - b.item.address
}

/* --------------------------------------------------------------- starter set */

/**
 * What a starter set is made of, in the order it is offered.
 *
 * Floors before walls, small before large, because that is the order a room gets
 * built in. Six items: enough to lay a floor and wall it, few enough that the
 * palette does not open on a scroll.
 *
 * Every entry is a *shape*, never an id. Ids are catalog paths and the corpus
 * renames files between imports; a shape is a fact about the geometry the plan
 * view can draw.
 */
const STARTER_SHAPES: readonly {
  readonly label: string
  readonly match: (item: TileAggregate) => boolean
}[] = [
  { label: 'floor 1×1', match: (i) => i.kinds.includes('floor') && isRect(i, 1, 1) },
  { label: 'floor 2×2', match: (i) => i.kinds.includes('floor') && isRect(i, 2, 2) },
  { label: 'floor 2×1', match: (i) => i.kinds.includes('floor') && isRect(i, 2, 1) },
  { label: 'wall 1', match: (i) => i.kinds.includes('wall') && isWall(i, 1) },
  { label: 'wall 2', match: (i) => i.kinds.includes('wall') && isWall(i, 2) },
  { label: 'wall 4', match: (i) => i.kinds.includes('wall') && isWall(i, 4) },
]

function isRect(item: TileAggregate, w: number, d: number): boolean {
  return item.foot.shape === 'rect' && item.foot.w === w && item.foot.d === d
}

function isWall(item: TileAggregate, length: number): boolean {
  return item.foot.shape === 'wall' && item.foot.length === length
}

/**
 * Six items of one texture set that can be built into a room.
 *
 * **One texture, and that is the point.** Picking the lowest-address match for
 * each shape independently produces an aztlan floor under a tudor wall, which
 * looks like a bug in the starter set rather than a choice by the user. So the
 * texture is chosen first — the one that satisfies the most shapes, breaking ties
 * on how many placeable items it has overall and then on its name so the answer
 * is a function of the corpus and not of iteration order — and every item comes
 * from it.
 *
 * Returns fewer than six if the chosen set cannot fill every shape, and an empty
 * array for a catalog with no placeable rectangles at all. Both are honest: the
 * caller renders what it gets.
 *
 * **Returns designs, and reads items.** Before V3 this walked records and
 * returned `TileId`s that the caller then had to hop back to designs; the hop is
 * gone rather than moved, because every field the choice turns on — `kinds`,
 * `foot`, `texture`, `name` — is a hoisted facet of the item, and there was never
 * a per-file question here. Two variants of one design cannot pull the set in
 * two directions any more, and the answer over the live corpus is unchanged: the
 * same six dungeon_stone floors and walls, now named once each.
 */
export function starterSet(items: readonly TileAggregate[]): DesignId[] {
  const byTexture = new Map<string, TileAggregate[]>()
  for (const item of items) {
    if (!isPlaceable(item)) continue
    // Untextured items are a real bucket but not a set anybody would start from:
    // a starter set is meant to look like one material.
    if (item.texture === undefined) continue
    // Bases are never offered. Half the corpus's `wall` footprints are the base
    // *under* a wall — "Dungeon Stone Wall Base 2x A" is a 2-unit wall footprint
    // and is invisible once built — and a starter set made of those looks like a
    // room with no walls. Every topper that needs one gets it auto-inserted into
    // the bill anyway, so putting a base in the palette is offering the user a
    // decision the resolver already makes better.
    //
    // `variantClass` and not a per-variant `layer` test, and the two are the
    // same test: `shape|base` is part of the design key, so a base is always its
    // own design and **0 of the 3,822 items hold a base variant beside a
    // non-base one** (`aggregate.ts#AggregateClass`, re-measured by
    // `palette.corpus.test.ts`).
    if (item.variantClass === 'base-only') continue
    const bucket = byTexture.get(item.texture)
    if (bucket === undefined) byTexture.set(item.texture, [item])
    else bucket.push(item)
  }

  let best: { texture: string; picks: TileAggregate[]; total: number } | null = null
  for (const [texture, bucket] of byTexture) {
    const picks = pickShapes(bucket)
    if (best === null || better({ texture, picks, total: bucket.length }, best)) {
      best = { texture, picks, total: bucket.length }
    }
  }

  return best === null ? [] : best.picks.map((item) => item.design)
}

/**
 * The plainest match for each starter shape, in shape order.
 *
 * "Plainest" is measured as the shortest display name, with the aggregate's
 * address as the tie-break. The importer folds every qualifier a tile carries
 * into its name — `Dungeon Stone Block Ruined Broken 010 000 Floor 2x2` against
 * `Dungeon Stone Floor 2x2` — so name length is a direct measure of how many
 * qualifiers a variant has, and the shortest is the one somebody starting a room
 * would have reached for. Picking by address alone gives whichever item the
 * importer happened to walk first, which for dungeon_stone is the ruined set.
 */
function pickShapes(bucket: readonly TileAggregate[]): TileAggregate[] {
  const picks: TileAggregate[] = []
  for (const shape of STARTER_SHAPES) {
    let chosen: TileAggregate | undefined
    for (const item of bucket) {
      if (!shape.match(item)) continue
      if (chosen === undefined || plainer(item, chosen)) chosen = item
    }
    if (chosen !== undefined) picks.push(chosen)
  }
  return picks
}

function plainer(candidate: TileAggregate, incumbent: TileAggregate): boolean {
  if (candidate.name.length !== incumbent.name.length) return candidate.name.length < incumbent.name.length
  return candidate.address < incumbent.address
}

function better(
  candidate: { texture: string; picks: TileAggregate[]; total: number },
  incumbent: { texture: string; picks: TileAggregate[]; total: number },
): boolean {
  if (candidate.picks.length !== incumbent.picks.length) return candidate.picks.length > incumbent.picks.length
  if (candidate.total !== incumbent.total) return candidate.total > incumbent.total
  return candidate.texture < incumbent.texture
}

/* ------------------------------------------------ the resolve-to-arm hop (V4) */

/**
 * The file to arm for an item, under the build's lock preference.
 *
 * **This function is scaffolding and row V4 deletes it, together with
 * {@link armedItem} and both of their call sites in `PalettePanel.tsx`.** The
 * palette now knows an item; `usePlanTools.selectedTileId` is a `TileId` because
 * `Placement.tileId` is, and until a placement addresses a design there has to be
 * one hop from the item the user picked to a file the canvas can place. That hop
 * lives here, named, in one place, rather than inlined in a click handler.
 *
 * **It is `selectVariant`'s answer and not `TileAggregate.preview`'s, and the two
 * disagree by construction.** `variantsByPreference`' own docblock says why, and
 * the disagreement is measured over the emitted index: with no preference the two
 * name a different file on **1,598 of 3,822** items, including **all 931** that
 * hold both an `integral` and a `topper`; with a lock stated it is 1,612 openlock,
 * 697 dragonlock, 1,056 magnetic. Which is right depends entirely on the
 * question, and the palette asks both:
 *
 *   - *what does this item look like* — `preview`, a sprite-carrying topper,
 *     because that mesh is the tile and nothing else. {@link PaletteRow.preview}.
 *   - *what would I place and print* — `selectVariant`, whose first criterion is
 *     §5.2's prefer-one-part-over-two. This.
 *
 * Reversing either would be a bug: arming `preview` would place a topper and let
 * the bill's auto-insert charge for a base the user could have avoided, and
 * showing `selectVariant`'s pick is exactly the *"tile with an integrated base"*
 * the owner sees in the sidebar today.
 *
 * `PRINT_OPTIONS` is passed for the reason `VariantPreference.options` gives:
 * without it the rank falls through to `bytes` ascending, which is the topless
 * print of a base — an undisclosed answer to a print-option question the palette
 * never asked.
 */
export function armFile(item: TileAggregate, lock: string): TileId {
  return selectVariant(item, { bottom: lock, options: PRINT_OPTIONS }).variant.id
}

/**
 * Which item an armed file belongs to, so the row that armed it reads as pressed.
 *
 * The inverse of {@link armFile} and **row V4 deletes it too.** Not
 * `armFile(item, lock) === armed`, deliberately: that comparison is taken under
 * *today's* lock, so switching the lock preference after arming would silently
 * un-press the row and leave the canvas armed. Asking which design the armed file
 * belongs to is a fact about the corpus rather than about a setting, so it
 * survives the switch — and after V4 it collapses into `armed === item.design`.
 *
 * `undefined` from the lookup means the armed file is not in this build, which
 * `usePlanTools` allows (it holds whatever it was handed) and which reads
 * correctly here as "no row is pressed".
 */
export function armedItem(
  armed: TileId | null,
  design: (id: TileId) => DesignId | undefined,
): DesignId | null {
  if (armed === null) return null
  return design(armed) ?? null
}
