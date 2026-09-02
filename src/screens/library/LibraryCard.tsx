/**
 * One library card — design-contract.md §2.3's "lighter variant of the catalog
 * card: thumbnail, name, size chip, remove".
 *
 * What "lighter" removes, relative to `../catalog/TileCard.tsx`: the texture
 * line, the material swatch, and the full-width library toggle. What it keeps,
 * and why:
 *
 *   - **{@link TileThumb}, imported rather than rebuilt.** It is the sprite-sheet
 *     maths — 2×5 sheet, frame offsets, the `max-width: none` that Tailwind's
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
 *   - **The availability chips**, which are new in row A3 and are the same
 *     `AvailabilityStrip` the catalog card renders. Both screens showing the same
 *     chips is the point of deriving them once: the library is where a user
 *     decides what to print, and "does this need a base" is the question that
 *     decides it. Unlike the catalog's, this strip is **not** height-capped —
 *     `library.css` releases it, because the library is a plain CSS grid and has
 *     no virtualiser to keep honest.
 *
 * ## The card is an item, and its byte figure is the files the user saved
 *
 * Row A3. The store holds files and this screen lists items, so a card can stand
 * for one saved file or several — 44.6% of items have more than one variant to
 * save. What that changes:
 *
 *   - **The size is the deduped total across the saved variants**, not the
 *     aggregate's `bytesRange`. The catalog card states a range because a
 *     browsing user has not chosen yet; a library card states a total because
 *     these are the files in the download.
 *   - **Two or more saved files get a row each**, with its own remove. That is
 *     where the per-file rows this screen used to be made of went. A card holding
 *     one file shows no such list, so the common case is unchanged.
 *   - **"Remove" becomes "Remove all"** when there is more than one, because a
 *     button that removed four files while saying "Remove" beside a "2 files"
 *     count would be lying about its own blast radius.
 *
 * Unlike the catalog card this one has **no fixed-height requirement** — the
 * library is a plain CSS grid, not `VirtuosoGrid`, so nothing extrapolates one
 * card's height to a scrollbar. That is what makes the variant rows affordable
 * here and not there. The title is still clamped to two lines, for the ordinary
 * reason that a 51-character filename-derived name would otherwise set the
 * height of its whole row.
 */
import { Link } from '@tanstack/react-router'

import type { CatalogAssets, SpriteSheet, TileVariant } from '@/catalog'
import { AvailabilityStrip, fileSizeLabel, sizeLabel, variantTokenLabel } from '@/screens/catalog'
import { removeFromLibrary } from '@/store'
import { Chip, VisuallyHidden } from '@/ui/primitives'
import { TileThumb } from '@/ui/thumb'

import type { LibraryItem } from './grouping'

export interface LibraryCardProps {
  entry: LibraryItem
  assets: CatalogAssets
  sheet: SpriteSheet
}

export function LibraryCard({ entry, assets, sheet }: LibraryCardProps) {
  const { item, saved, preview, bytes } = entry
  const several = saved.length > 1

  return (
    <article className="of-lib-card">
      <Link className="of-lib-card-open" to="/catalog" search={{ tile: preview.ord }}>
        <TileThumb blob={preview.blob} sprite={preview.sprite} assets={assets} sheet={sheet} />
        <h3 className="of-lib-card-title">{item.name}</h3>
      </Link>

      <p className="of-lib-card-meta">
        <Chip tone="size">{sizeLabel(item.foot, item.sizeCode)}</Chip>
        <span className="of-lib-card-bytes">{fileSizeLabel(bytes)}</span>
      </p>

      <AvailabilityStrip item={item} />

      {several ? <SavedVariants item={item.name} saved={saved} /> : null}

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
          for (const variant of saved) removeFromLibrary(variant.id)
        }}
      >
        <span aria-hidden="true">✕</span>
        <span>{several ? 'Remove all' : 'Remove'}</span> <VisuallyHidden>{item.name}</VisuallyHidden>
      </button>
    </article>
  )
}

/* --------------------------------------------------------- saved variant rows */

/**
 * The per-file rows, for a card holding more than one saved variant.
 *
 * Each row names the file by its own filename token, carries its own byte figure,
 * and removes only itself. Without this, an item-level card would make a
 * two-variant save unpickable: the user could see "2 files" and 30 MB and have no
 * way to drop one of them short of clearing the item and re-adding the one they
 * wanted.
 *
 * The label is `variantTokenLabel` and **not** the `fileTokenLabel` on the
 * catalog card, which is the one place the two must differ: that one strips the
 * connection segments so it names the design, and two variants of one design
 * differ in exactly those segments. It would label both of these rows `2x`.
 *
 * A `<ul>` with a real heading-free label, because it is a list of files rather
 * than prose. The count is in the label rather than in a chip beside it: the
 * whole block only renders when the count is 2 or more, so the number is the
 * reason the block exists and belongs in its one sentence.
 *
 * The row's remove button repeats the token in its accessible name and not the
 * item's — the item's name is on the card's own remove button, and two buttons
 * with the same accessible name inside one card is exactly the confusion the
 * clipped suffixes exist to avoid.
 */
function SavedVariants({ item, saved }: { item: string; saved: readonly TileVariant[] }) {
  return (
    <div className="of-lib-variants">
      <p className="of-lib-variants-label">{saved.length} files saved</p>
      <ul className="of-lib-variant-list">
        {saved.map((variant) => {
          const token = variantTokenLabel(variant.file)
          return (
            <li className="of-lib-variant" key={variant.id}>
              <span className="of-lib-variant-token">{token === '' ? variant.file : token}</span>
              <span className="of-lib-variant-bytes">{fileSizeLabel(variant.bytes)}</span>
              <button
                type="button"
                className="of-lib-variant-remove"
                onClick={() => {
                  removeFromLibrary(variant.id)
                }}
              >
                <span aria-hidden="true">✕</span>
                <VisuallyHidden>
                  Remove {token === '' ? variant.file : token} of {item}
                </VisuallyHidden>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
