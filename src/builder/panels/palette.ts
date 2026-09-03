/**
 * What the palette shows, decided without a DOM.
 *
 * **A row is an item, not a file** — row V3, finishing §7's *"place designs, not
 * files"* on the one surface that still armed a concrete STL. Everything below
 * therefore takes {@link TileAggregate}s and returns rows keyed by
 * {@link DesignId}, and **the only place a file appears at all is
 * {@link PaletteRow.preview}, which is a picture.**
 *
 * That last sentence is row V4's, and it cost two functions. V3 left an
 * `armFile`/`armedItem` pair here — the *resolve-to-arm hop* — because
 * `usePlanTools.selectedTileId` was a `TileId`, because `Placement.tileId` was
 * one, so the item the user picked had to become a file before the canvas could
 * place it. V4 made a placement address a design, so the hop had nothing left to
 * bridge: the click handler is `tools.setSelectedDesign(item.design)` and the
 * pressed row is `selected === item.design`. Nothing resolves anything in this
 * module now, which is why `selectVariant` and `PRINT_OPTIONS` are no longer
 * imported.
 *
 * ## It was three functions and row A0 left one
 *
 * The palette listed the **library** and offered search results as a way to add
 * to it. Row A0 deleted the library, so two of the three had nothing to answer
 * for and are gone rather than repointed:
 *
 *   - **`paletteRows`** ordered the library so placeable items came first,
 *     sinking the **370 items whose footprint is `none`** (9.7% of the corpus,
 *     8.3% of files, {@link isPlaceable}) into one contiguous block at the end.
 *     The measurement survives as a fact about the corpus and is why
 *     {@link PaletteRow.placeable} is still on every row; the *ordering* does not,
 *     because the list is now search results and those must keep the engine's own
 *     ranking — see {@link searchRows}.
 *   - **`starterSet`** answered design-contract.md §2.4's "Add a starter set" by
 *     putting six floors and walls of one texture into the library. There is no
 *     library to put them in, and under the templates plan a starter set of six
 *     *tiles* is the wrong unit anyway: row **C1** replaces the palette with 52
 *     generated template families, and a starter set, if it comes back, is a
 *     starter *room*.
 *
 * {@link searchRows} is what is left, and it exists because the answer is not
 * obvious from the contract: it caps the result list. The engine answers an
 * unfiltered query with all 3,822 items in 2.6 ms, and rendering that many
 * sprite-sheet thumbnails in a 272px column is 3,822 × 529 KB of images. The
 * catalog screen virtualises; a palette does not need to, it needs to stop.
 *
 * It takes items and returns rows. Nothing here reads the store, the URL or the
 * network — and since row A0 there is no store field left for it to read.
 */
import { isPlaceable } from '@/builder/canvas'
import type { CatalogRecord, DesignId, TileAggregate } from '@/catalog'

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
}

/**
 * Resolves a design to the item and the picture a row needs.
 *
 * One lookup rather than two so a row cannot pair one index's aggregate with
 * another index's record, and so the palette has **one** drop rule instead of
 * two. `undefined` means "this build's catalog does not hold that design", which
 * is still reachable now that the rows come from a search: the selection channel
 * row G5 owns carries a design across a navigation, and the catalog can have been
 * re-imported in between.
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
 * Search results, as rows.
 *
 * **Not** reordered: the engine ranks by text score and then by document
 * ordinal, and a palette that re-sorted its results would throw that ranking
 * away — the top hit for "2x2 dungeon" has to be at the top. Unplaceable results
 * stay where the ranking put them, marked, because a search is a question about
 * the whole catalog and silently dropping a tenth of the answers would make the
 * result count disagree with the list. (The deleted `paletteRows` sank them
 * instead. That was right for a library, which is a list the user assembled and
 * has no ranking of its own, and is wrong here for the same reason.)
 *
 * `items` are the engine's own aggregates and the lookup is asked for each one
 * anyway, for the preview record — so the two halves of a row always come from
 * one index.
 */
export function searchRows(
  items: readonly TileAggregate[],
  lookup: PaletteLookup,
  limit = MAX_SEARCH_ROWS,
): PaletteRow[] {
  const rows: PaletteRow[] = []
  for (const item of items) {
    if (rows.length >= limit) break
    const found = lookup(item.design)
    if (found === undefined) continue
    rows.push({ ...found, placeable: isPlaceable(found.item) })
  }
  return rows
}
