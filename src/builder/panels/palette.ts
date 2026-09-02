/**
 * What the palette shows, decided without a DOM.
 *
 * Three pure functions, and each of them exists because the answer is not
 * obvious from the contract:
 *
 *   - **{@link paletteRows}** orders the library so the tiles that can be placed
 *     come first. 8.3% of the corpus — the 726 tiles with a `none` footprint —
 *     is all the plan view refuses (`isPlaceable`), so a library assembled from
 *     the catalog screen will contain some. Interleaving greyed rows with live
 *     ones turns the list into a minefield; sinking them into one contiguous
 *     block at the end makes the refusal legible as a group and keeps the top of
 *     the list usable.
 *
 *     It was 29.1% and an `arc`-or-`none` test until row W6 made annular sectors
 *     placeable; `none` is the whole of it now.
 *   - **{@link searchRows}** caps the result list. The engine answers an
 *     unfiltered query with all 8,702 ids in 2.6 ms, and rendering that many
 *     sprite-sheet thumbnails in a 272px column is 8,702 × 529 KB of images.
 *     The catalog screen virtualises; a palette does not need to, it needs to
 *     stop.
 *   - **{@link starterSet}** answers design-contract.md §2.4's "Add a starter
 *     set" with tiles that actually make a room: floors and walls of one texture,
 *     chosen from the live catalog rather than hard-coded, because a hard-coded
 *     tile id is a link into a corpus that renames files.
 *
 * All three take records and return records. Nothing here reads the store, the
 * URL or the network.
 */
import type { CatalogRecord, TileId } from '@/catalog'
import { isPlaceable } from '@/builder/canvas'

/** One row of the palette. */
export interface PaletteRow {
  readonly record: CatalogRecord
  /** `isPlaceable(record)` — false for the 8.3% the plan view cannot draw. */
  readonly placeable: boolean
  /** Whether the tile is already saved, which decides "+ add" versus nothing. */
  readonly inLibrary: boolean
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
 * Ids the current catalog does not hold are dropped here. The library screen
 * reports them and offers to remove them — that is the right place for it, and a
 * builder palette that listed a tile it cannot describe would be offering a row
 * with no name, no size and no thumbnail.
 */
export function paletteRows(
  ids: readonly TileId[],
  record: (id: TileId) => CatalogRecord | undefined,
): PaletteRow[] {
  const rows: PaletteRow[] = []
  for (const id of ids) {
    const found = record(id)
    if (found === undefined) continue
    rows.push({ record: found, placeable: isPlaceable(found), inLibrary: true })
  }
  return rows.sort(byPlaceableThenName)
}

/**
 * Search results, as rows.
 *
 * **Not** reordered: the engine ranks by text score and then by manifest
 * ordinal, and a palette that re-sorted its results would throw that ranking
 * away — the top hit for "2x2 dungeon" has to be at the top. Unplaceable results
 * stay where the ranking put them, marked, because a search is a question about
 * the whole catalog and silently dropping a third of the answers would make the
 * result count disagree with the list.
 */
export function searchRows(
  ids: readonly TileId[],
  record: (id: TileId) => CatalogRecord | undefined,
  inLibrary: (id: TileId) => boolean,
  limit = MAX_SEARCH_ROWS,
): PaletteRow[] {
  const rows: PaletteRow[] = []
  for (const id of ids) {
    if (rows.length >= limit) break
    const found = record(id)
    if (found === undefined) continue
    rows.push({ record: found, placeable: isPlaceable(found), inLibrary: inLibrary(id) })
  }
  return rows
}

function byPlaceableThenName(a: PaletteRow, b: PaletteRow): number {
  if (a.placeable !== b.placeable) return a.placeable ? -1 : 1
  if (a.record.name !== b.record.name) return a.record.name < b.record.name ? -1 : 1
  // Names are not unique — a texture set can hold two 2×2 floors under different
  // connection systems — so the id breaks the tie and the order stays total.
  return a.record.id < b.record.id ? -1 : 1
}

/* --------------------------------------------------------------- starter set */

/**
 * What a starter set is made of, in the order it is offered.
 *
 * Floors before walls, small before large, because that is the order a room gets
 * built in. Six tiles: enough to lay a floor and wall it, few enough that the
 * palette does not open on a scroll.
 *
 * Every entry is a *shape*, never a tile id. Ids are catalog paths and the corpus
 * renames files between imports; a shape is a fact about the geometry the plan
 * view can draw.
 */
const STARTER_SHAPES: readonly { readonly label: string; readonly match: (record: CatalogRecord) => boolean }[] = [
  { label: 'floor 1×1', match: (r) => r.kinds.includes('floor') && isRect(r, 1, 1) },
  { label: 'floor 2×2', match: (r) => r.kinds.includes('floor') && isRect(r, 2, 2) },
  { label: 'floor 2×1', match: (r) => r.kinds.includes('floor') && isRect(r, 2, 1) },
  { label: 'wall 1', match: (r) => r.kinds.includes('wall') && isWall(r, 1) },
  { label: 'wall 2', match: (r) => r.kinds.includes('wall') && isWall(r, 2) },
  { label: 'wall 4', match: (r) => r.kinds.includes('wall') && isWall(r, 4) },
]

function isRect(record: CatalogRecord, w: number, d: number): boolean {
  return record.foot.shape === 'rect' && record.foot.w === w && record.foot.d === d
}

function isWall(record: CatalogRecord, length: number): boolean {
  return record.foot.shape === 'wall' && record.foot.length === length
}

/**
 * Six tiles of one texture set that can be built into a room.
 *
 * **One texture, and that is the point.** Picking the lowest-ordinal match for
 * each shape independently produces an aztlan floor under a tudor wall, which
 * looks like a bug in the starter set rather than a choice by the user. So the
 * texture is chosen first — the one that satisfies the most shapes, breaking ties
 * on how many placeable tiles it has overall and then on its name so the answer
 * is a function of the corpus and not of iteration order — and every tile comes
 * from it.
 *
 * Returns fewer than six if the chosen set cannot fill every shape, and an empty
 * array for a catalog with no placeable rectangles at all. Both are honest: the
 * caller renders what it gets.
 */
export function starterSet(records: readonly CatalogRecord[]): TileId[] {
  const byTexture = new Map<string, CatalogRecord[]>()
  for (const record of records) {
    if (!isPlaceable(record)) continue
    // Untextured tiles are a real bucket but not a set anybody would start from:
    // a starter set is meant to look like one material.
    if (record.texture === undefined) continue
    // Bases are never offered. Half the corpus's `wall` footprints are the base
    // *under* a wall — "Dungeon Stone Wall Base 2x A" is a 2-unit wall footprint
    // and is invisible once built — and a starter set made of those looks like a
    // room with no walls. Every topper that needs one gets it auto-inserted into
    // the bill anyway, so putting a base in the palette is offering the user a
    // decision the resolver already makes better.
    if (record.layer === 'base') continue
    const bucket = byTexture.get(record.texture)
    if (bucket === undefined) byTexture.set(record.texture, [record])
    else bucket.push(record)
  }

  let best: { texture: string; picks: CatalogRecord[]; total: number } | null = null
  for (const [texture, bucket] of byTexture) {
    const picks = pickShapes(bucket)
    if (best === null || better({ texture, picks, total: bucket.length }, best)) {
      best = { texture, picks, total: bucket.length }
    }
  }

  return best === null ? [] : best.picks.map((record) => record.id)
}

/**
 * The plainest match for each starter shape, in shape order.
 *
 * "Plainest" is measured as the shortest display name, with the manifest ordinal
 * as the tie-break. The importer folds every qualifier a tile carries into its
 * name — `Dungeon Stone Block Ruined Broken 010 000 Floor 2x2` against
 * `Dungeon Stone Floor 2x2` — so name length is a direct measure of how many
 * qualifiers a variant has, and the shortest is the one somebody starting a room
 * would have reached for. Picking by ordinal alone gives whichever variant the
 * importer happened to walk first, which for dungeon_stone is the ruined set.
 */
function pickShapes(bucket: readonly CatalogRecord[]): CatalogRecord[] {
  const picks: CatalogRecord[] = []
  for (const shape of STARTER_SHAPES) {
    let chosen: CatalogRecord | undefined
    for (const record of bucket) {
      if (!shape.match(record)) continue
      if (chosen === undefined || plainer(record, chosen)) chosen = record
    }
    if (chosen !== undefined) picks.push(chosen)
  }
  return picks
}

function plainer(candidate: CatalogRecord, incumbent: CatalogRecord): boolean {
  if (candidate.name.length !== incumbent.name.length) return candidate.name.length < incumbent.name.length
  return candidate.ord < incumbent.ord
}

function better(
  candidate: { texture: string; picks: CatalogRecord[]; total: number },
  incumbent: { texture: string; picks: CatalogRecord[]; total: number },
): boolean {
  if (candidate.picks.length !== incumbent.picks.length) return candidate.picks.length > incumbent.picks.length
  if (candidate.total !== incumbent.total) return candidate.total > incumbent.total
  return candidate.texture < incumbent.texture
}
