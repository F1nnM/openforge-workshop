/**
 * One library card — design-contract.md §2.3's "lighter variant of the catalog
 * card: thumbnail, name, size chip, remove".
 *
 * What "lighter" removes, relative to `../catalog/TileCard.tsx`: the texture
 * line, the material swatch, and the full-width library toggle. What it keeps,
 * and why:
 *
 *   - **{@link TileThumb}, imported rather than rebuilt.** It is the two sources
 *     and their geometry — 2×5 sheet, frame offsets, the `max-width: none` that Tailwind's
 *     Preflight would otherwise use to squeeze all ten camera angles into the
 *     well, explicit intrinsic dimensions so the well does not resize when the
 *     image lands, lazy loading, and the "no render" plate for the one live tile
 *     with no sheet. A second copy of that is a second place for the same four
 *     bugs. Row P0 moved it from the catalog card to `@/ui/thumb`, so this import
 *     no longer reaches into another screen for it.
 *   - **The mono file size**, which the contract's list does not mention. It is
 *     here because the screen's summary is a byte total the user is expected to
 *     act on: a library over 512 MB tells them *that* there is a problem, and the
 *     per-card figure is the only thing that tells them *which tile* to drop. A
 *     warning with no attribution is a warning you cannot act on.
 *   - **The thumbnail and title as one link into the drawer.** Same target as the
 *     catalog card (`/catalog?tile={ord}`), which `src/routes/tileDrawer.ts`
 *     explicitly anticipates being linked to from another screen: Back returns
 *     to the library, because that is where the user came from.
 *   - **The availability chips**, which are the same `AvailabilityStrip` the
 *     catalog card renders. Both screens showing the same chips is the point of
 *     deriving them once: the library is where a user decides what to print, and
 *     "does this need a base" is the question that decides it. Unlike the
 *     catalog's, this strip is **not** height-capped — `library.css` releases it,
 *     because the library is a plain CSS grid and has no virtualiser to keep
 *     honest.
 *
 * ## The card is the item, and it names the file the item downloads as
 *
 * Row V2. An entry is a design, so a card no longer stands for a set of saved
 * files and there is no set to disclose. What replaced that disclosure is one
 * line, and the reason it is one line is a measurement: `selectVariant` is
 * single-valued, so under the build's current lock **every** item resolves to
 * exactly one file. What changed on the card:
 *
 *   - **The byte figure is the resolved file's size**, not the aggregate's
 *     `bytesRange` and not the picture's. The catalog card states a range because
 *     a browsing user has not chosen a lock preference to resolve under; this one
 *     has one, so it states the number that preference implies.
 *   - **The resolved file is named**, because it is not the file in the picture.
 *     `TileAggregate.preview` prefers a topper (the tile alone) and
 *     `selectVariant` prefers one part over two, so they disagree on **1,611 of
 *     3,822 items under openlock (42.2%)**, 609 under dragonlock and 1,055 under
 *     magnetic — and in every one of those cases the two files are different
 *     sizes. A card that showed one file and sized another is the defect row V1
 *     removed from the store; naming the file is what keeps it out of the card.
 *   - **"+ a base"** when the resolution is a topper. Not a restatement of the
 *     strip's chip: for the 931 items whose `needsBase` is `'either'` the chip
 *     can only say "Base optional", and this line is which side of that
 *     optionality the user's own lock landed on.
 *   - **"Remove" is one call and never "Remove all"**, because one entry is one
 *     item. The per-file rows, their own remove buttons and the plural label all
 *     went with the saved set.
 *
 * Unlike the catalog card this one has **no fixed-height requirement** — the
 * library is a plain CSS grid, not `VirtuosoGrid`, so nothing extrapolates one
 * card's height to a scrollbar. The title is still clamped to two lines, for the
 * ordinary reason that a 51-character filename-derived name would otherwise set
 * the height of its whole row.
 */
import { Link } from '@tanstack/react-router'

import type { CatalogAssets, SpriteSheet } from '@/catalog'
import type { MaterialId } from '@/materials'
import { AvailabilityStrip, fileSizeLabel, sizeLabel, variantTokenLabel } from '@/screens/catalog'
import { removeFromLibrary } from '@/store'
import { Chip, VisuallyHidden } from '@/ui/primitives'
import { TileThumb } from '@/ui/thumb'

import type { LibraryItem } from './grouping'

export interface LibraryCardProps {
  entry: LibraryItem
  assets: CatalogAssets
  sheet: SpriteSheet
  /**
   * The tint for {@link LibraryItem.preview} — `index.materialOf(entry.preview)`.
   *
   * Row P3, and it is the one place the "lighter card" argument at the top of
   * this file needed a second look. What this card drops relative to the
   * catalog's is the material **swatch**: an explicit dot and a texture-set name,
   * which is disclosure the library does not need because the user already chose
   * these items. The tint is not that. It is the picture of the tile, and the
   * same mesh appearing stone here and stone there is the point of resolving it
   * once — a card that showed a grey model beside a catalog card showing a
   * sandstone one would read as a different tile, not as less information.
   */
  material: MaterialId
}

export function LibraryCard({ entry, assets, sheet, material }: LibraryCardProps) {
  const { item, preview, resolved, verdict } = entry

  return (
    <article className="of-lib-card">
      <Link className="of-lib-card-open" to="/catalog" search={{ tile: preview.ord }}>
        <TileThumb
          blob={preview.blob}
          sprite={preview.sprite}
          thumb={preview.thumb}
          assets={assets}
          sheet={sheet}
          material={material}
        />
        <h3 className="of-lib-card-title">{item.name}</h3>
      </Link>

      <p className="of-lib-card-meta">
        <Chip tone="size">{sizeLabel(item.foot, item.sizeCode)}</Chip>
        <span className="of-lib-card-bytes">{fileSizeLabel(resolved.bytes)}</span>
      </p>

      <AvailabilityStrip item={item} />

      <ResolvedFile file={resolved.file} needsBase={verdict === 'needs-base'} />

      {/*
        The tile's name rides in the accessible name after the visible word, so a
        screen reader's element list does not present forty buttons all called
        "Remove". `aria-label` would have been shorter and wrong: it replaces the
        name outright, so "remove" would stop being part of it (WCAG 2.5.3) and
        voice control would lose the word on screen. Same reasoning, and the same
        shape, as the catalog card's toggle.
      */}
      <button
        type="button"
        className="of-lib-remove"
        onClick={() => {
          removeFromLibrary(item.design)
        }}
      >
        <span aria-hidden="true">✕</span>
        <span>Remove</span> <VisuallyHidden>{item.name}</VisuallyHidden>
      </button>
    </article>
  )
}

/* --------------------------------------------------------- the resolved file */

/**
 * Which file this item downloads as, and whether that is the whole print.
 *
 * Named by the filename's **variant** token and not the `fileTokenLabel` on the
 * catalog card, which is the one place the two must differ: that one strips the
 * connection segments so it names the design, and the connection segments are
 * precisely what distinguishes one way of printing an item from another. It
 * would label the openlock and the openforge print of a wall `2x` alike.
 *
 * Prose in a `<p>` rather than a chip or a list. It is a sentence about a
 * consequence — *given your lock, this is the file* — and the two facts in it are
 * a name and a qualifier rather than two independent values; a list of one row
 * was what this replaced.
 *
 * Falls back to the whole filename when the token is empty, which happens for a
 * filename with no dot before the extension: a line that named nothing could not
 * be told from the card above it, which is the one thing it exists to do.
 */
function ResolvedFile({ file, needsBase }: { file: string; needsBase: boolean }) {
  const token = variantTokenLabel(file)

  return (
    <p className="of-lib-card-resolved">
      <span className="of-lib-resolved-label">Prints as</span>{' '}
      <span className="of-lib-resolved-token">{token === '' ? file : token}</span>
      {needsBase ? <span className="of-lib-resolved-base"> + a base</span> : null}
    </p>
  )
}
