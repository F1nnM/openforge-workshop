/**
 * The virtualised card grid, its skeleton, and its empty state.
 *
 * ## Why it is virtualised at all
 *
 * An unfiltered query returns all 3,822 items (`SearchEngine.search` is uncapped
 * by design). Rendering them is not a React problem — it is a **decoded-bitmap**
 * problem: every card holds a 2560×1024 PNG, and 3,822 of those would be tens of
 * gigabytes of image memory. Virtualisation is what keeps the mounted set to
 * roughly one and a half screenfuls, so the browser can drop the decodes for
 * everything else.
 *
 * Aggregation cut the count 2.28× — 8,702 files became 3,822 items — which
 * lowers the ceiling but changes nothing about the argument: a hundred mounted
 * cards is still hundreds of megabytes of decoded sheet.
 *
 * ## VirtuosoGrid's one constraint, and how it is met
 *
 * `VirtuosoGrid` measures a single item and extrapolates. Items of varying height
 * therefore make the scroll position drift — visibly, after a few dozen rows.
 * Two things guarantee uniformity here and neither is optional:
 *
 *   1. **The card is a fixed height** (`catalog.css`: clamped title, fixed
 *      texture line, an em dash where a size chip would be missing, and a
 *      fixed-height two-line availability strip whatever number of chips it
 *      holds — see `availability.ts#CHIP_BUDGET` for the width arithmetic that
 *      keeps four chips inside two lines).
 *   2. **The thumbnail is `aspect-ratio: 4 / 3`**, reserved before the image
 *      loads, so a card does not grow when its sheet arrives.
 *
 * Item *width* varies with the viewport — `repeat(auto-fill, minmax(215px, 1fr))`
 * is the contract's grid — but every item in a given layout is the same width, so
 * every item is the same height. That is what the constraint actually requires.
 *
 * ## Overscan
 *
 * Deliberately tight: {@link OVERSCAN} keeps about half a screen of cards mounted
 * beyond the viewport in the scroll direction. The usual reason to overscan
 * generously — avoiding blank space during a fast flick — is outweighed here by
 * what a mounted card costs in image memory. `loading="lazy"` on the sheet gives
 * a second layer of the same protection: a card can mount without its 529 KB
 * sheet being fetched until it is genuinely close to the viewport.
 *
 * ## Why the window is the scroll container
 *
 * `useWindowScroll`, so the sticky header and the sticky facet sidebar behave
 * like page furniture rather than like panes. `src/routes/router.ts` already
 * leaves TanStack's scroll restoration off for exactly this reason, so nothing
 * fights the virtualiser over `window.scrollY`.
 */
import { VirtuosoGrid } from 'react-virtuoso'

import type { TileAggregate, TileId } from '@/catalog'
import { Eyebrow } from '@/ui/primitives'

import type { CatalogIndex } from './catalogIndex'
import { TileCard } from './TileCard'

/**
 * Pixels of cards mounted beyond the viewport, ahead and behind.
 *
 * One card is roughly 300 px tall — the availability strip added 49 px of it —
 * so this is about one extra row in the scroll direction. See the module docblock
 * for why it is not larger.
 */
export const OVERSCAN = { main: 300, reverse: 150 } as const

export interface TileGridProps {
  index: CatalogIndex
  /** The matching items, in display order — `SearchResult.items`. */
  items: readonly TileAggregate[]
  /**
   * One preview tile id per item, in the same order — `SearchResult.ids`.
   *
   * Row A2 kept this beside `items` precisely so a grid does not have to reach
   * into an aggregate to find the file it renders. It is the *key* as well as the
   * lookup: an item's identity for React's reconciler is the preview id rather
   * than the aggregate address, because that is the id whose 529 KB sheet the
   * cell has mounted — re-keying on anything else would drop a decoded sheet the
   * new cell immediately re-fetches.
   */
  ids: readonly TileId[]
}

export function TileGrid({ index, items, ids }: TileGridProps) {
  const { assets, sprite } = index.file

  return (
    <VirtuosoGrid
      useWindowScroll
      totalCount={items.length}
      overscan={OVERSCAN}
      listClassName="of-card-grid"
      itemClassName="of-card-cell"
      // `computeItemKey` rather than the index, so adding a filter reuses the
      // cards for items that survived it instead of re-keying every slot and
      // re-fetching every sheet.
      computeItemKey={(position) => ids[position] ?? position}
      itemContent={(position) => {
        const item = items[position]
        const id = ids[position]
        const preview = id === undefined ? undefined : index.engine.record(id)
        // Unreachable: `items` and `ids` come from one `search()` call and are
        // the same length, and every id in it is one of the 8,702 records
        // `record` resolves. Rendering a hole rather than throwing keeps a single
        // bad id from taking the grid down, and the fixed cell height means the
        // layout does not notice.
        if (item === undefined || preview === undefined) return null
        return (
          <TileCard
            item={item}
            preview={preview}
            tags={index.tagsFor(preview)}
            assets={assets}
            sheet={sprite}
          />
        )
      }}
    />
  )
}

/* ------------------------------------------------------------------ skeleton */

/**
 * Pending cards, using the frame's `.of-shimmer` keyframe.
 *
 * Twelve, because that is roughly one screenful at the contract's grid width and
 * the point of a skeleton is to reserve the space the content will occupy. The
 * cells are the real `.of-card-cell` in the real `.of-card-grid`, so the layout
 * does not shift when the index lands.
 */
export function TileGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="of-card-grid" aria-hidden="true">
      {Array.from({ length: count }, (_, position) => (
        <div className="of-card-cell" key={position}>
          <div className="of-card of-card-pending">
            <div className="of-thumb of-shimmer" />
            <div className="of-pending-line of-shimmer" />
            <div className="of-pending-line of-pending-short of-shimmer" />
          </div>
        </div>
      ))}
    </div>
  )
}

/* --------------------------------------------------------------- empty state */

/**
 * design-contract.md §2.2's empty state, verbatim, with its note.
 *
 * The note is not filler: the emitted index holds the 8,702 tiles that are
 * organised and tagged, and the wider Dropbox archive holds more. Saying so is
 * the difference between "your filter is too narrow" and "the catalog is
 * broken".
 */
export function TileGridEmpty({ onClear }: { onClear: () => void }) {
  return (
    <div className="of-catalog-empty">
      <Eyebrow as="div">No matches</Eyebrow>
      <p className="of-empty-title">Nothing in the organized archive matches.</p>
      <p className="of-empty-note">
        Untagged tiles exist in storage but are not yet reachable from the catalog.
      </p>
      <button type="button" className="of-facet-clear of-empty-clear" onClick={onClear}>
        <span aria-hidden="true">✕ </span>Clear filters
      </button>
    </div>
  )
}
