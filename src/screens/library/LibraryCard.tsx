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
 *     bugs.
 *   - **The mono file size**, which the contract's list does not mention. It is
 *     here because the screen's summary is a byte total the user is expected to
 *     act on: a library over 512 MB tells them *that* there is a problem, and the
 *     per-card figure is the only thing that tells them *which tile* to drop. A
 *     warning with no attribution is a warning you cannot act on.
 *   - **The thumbnail and title as one link into the drawer.** Same target as the
 *     catalog card (`/catalog?tile={ord}`), which `src/routes/tileDrawer.ts`
 *     explicitly anticipates being linked to from another screen: Back returns
 *     to the library, because that is where the user came from.
 *
 * Unlike the catalog card this one has **no fixed-height requirement** — the
 * library is a plain CSS grid, not `VirtuosoGrid`, so nothing extrapolates one
 * card's height to a scrollbar. The title is still clamped to two lines, for the
 * ordinary reason that a 51-character filename-derived name would otherwise set
 * the height of its whole row.
 */
import { Link } from '@tanstack/react-router'

import type { CatalogAssets, CatalogRecord, SpriteSheet } from '@/catalog'
import { TileThumb, fileSizeLabel, sizeLabel } from '@/screens/catalog'
import { removeFromLibrary } from '@/store'
import { Chip, VisuallyHidden } from '@/ui/primitives'

export interface LibraryCardProps {
  record: CatalogRecord
  assets: CatalogAssets
  sheet: SpriteSheet
}

export function LibraryCard({ record, assets, sheet }: LibraryCardProps) {
  return (
    <article className="of-lib-card">
      <Link className="of-lib-card-open" to="/catalog" search={{ tile: record.ord }}>
        <TileThumb blob={record.blob} sprite={record.sprite} assets={assets} sheet={sheet} />
        <h3 className="of-lib-card-title">{record.name}</h3>
      </Link>

      <p className="of-lib-card-meta">
        <Chip tone="size">{sizeLabel(record.foot, record.sizeCode)}</Chip>
        <span className="of-lib-card-bytes">{fileSizeLabel(record.bytes)}</span>
      </p>

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
          removeFromLibrary(record.id)
        }}
      >
        <span aria-hidden="true">✕</span>
        <span>Remove</span> <VisuallyHidden>{record.name}</VisuallyHidden>
      </button>
    </article>
  )
}
