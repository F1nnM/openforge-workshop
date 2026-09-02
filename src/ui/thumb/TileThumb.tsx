/**
 * The tile thumbnail — one frame of a sprite sheet in a 4:3 radial-gradient well.
 *
 * Extracted from `screens/catalog/TileCard.tsx` by row P0, unchanged. Four
 * subtrees render it — the catalog card, the library card, the builder's bill of
 * tiles and the builder's palette — and three later rows wanted to edit it, so it
 * gets one owner before any of them start:
 *
 *   - **P1** mounts `feColorMatrix` filters that have to be reachable from every
 *     one of those subtrees. Four copies of a `<defs>` block is four ids.
 *   - **P3** switches the image between a 256px thumbnail derivative and this
 *     sheet, and the two need different CSS geometry *and* different filter
 *     chains.
 *
 * See {@link TileThumbProps} for the interface those rows extend, and the two
 * contract sections at the foot of this comment for what they may assume.
 *
 * ## The sheets are 2×5 grids, and they are the catalog screen's real cost
 *
 * There is still no thumbnail derivative in the bucket, so the only image
 * available is the sheet the detail viewer rotates: **2 rows × 5 columns of
 * 512px frames, averaging 529 KB**, at `/sprites/{md5[:6]}/{md5}.png`. Frame 0 is
 * shown by clipping the sheet, and the consequences are dealt with as follows:
 *
 *   - **`<img>`, not `background-image`.** A background cannot be lazily loaded
 *     and has no intrinsic size, so a screenful of them is a screenful of
 *     immediate requests. This `<img>` carries `width`/`height` (the sheet's real
 *     2560×1024, so the aspect ratio is reserved before it lands),
 *     `loading="lazy"` and `decoding="async"`.
 *   - **The clip is a square box with the sheet scaled to `cols × 100%` by
 *     `rows × 100%`.** The rendered image is therefore 5× the frame's width and
 *     2× its height, which is exactly what makes this expensive: a screenful
 *     decodes hundreds of megabytes. Nothing can be done about it here; the
 *     256px derivative is the fix, and P3 is the row that switches to it.
 *   - **The frame box is square inside the 4:3 well**, so the frame is never
 *     distorted and the well keeps its radial gradient at the sides.
 *   - **The sheets are blue**, not grey — `stl-thumb`'s default Phong material.
 *     v1 accepted a blue grid beside tinted 3D views (architecture-plan.md §8)
 *     and deliberately did **not** CSS-tint it, because a `filter` over a lit
 *     render produces a muddy wash. P1 is the row that revisits that, by
 *     computing luminance first rather than tinting the lit pixels directly.
 *   - **One live tile has no sheet at all** — `CatalogRecord.sprite` is `false`
 *     for exactly one of 8,702. It gets a mono "no render" plate rather than a
 *     broken-image glyph.
 *
 * A note for anyone picking a frame other than 0: the sheet's ten frames are ten
 * distinct renders. An earlier claim that three of them were duplicates was
 * disproved by decoding the pixels (mean absolute difference 12.6–27.0 for the
 * supposedly identical pairs, against 3.5–9.1 for pairs 180° apart). It is the
 * `camera_pos` **metadata** that is wrong, not the images — so index arithmetic
 * here is sound, and only a caller trying to name an angle needs to be careful.
 *
 * ## Where the styling lives, which is not here
 *
 * `.of-thumb`, `.of-thumb-frame`, `.of-thumb-sheet` and `.of-thumb-missing` are
 * defined in `screens/catalog/catalog.css`, which `screens/library/library.css`
 * and `builder/panels/panels.css` both `@import` for exactly these four rules.
 * P0 moved the component and not the stylesheet, because a copy of those rules in
 * a second file would be two definitions of one class and a race over which
 * `<style>` Vite emits second — and because `.of-thumb-sheet`'s `max-width: none`
 * is load-bearing against Tailwind's Preflight, so a rule that lost the race
 * would squeeze all ten camera angles into the well and still look plausible.
 * **P3 already owns both `catalog.css` and this directory**, and is the row that
 * can move the block to `ui/thumb/thumb.css` while it is changing the geometry
 * anyway.
 *
 * ## The contract P1 reads: where the filter goes, and where the `<defs>` mount
 *
 *   - **`.of-thumb-sheet` is the element to filter.** It is the only element in
 *     this component carrying rendered pixels. The well's gradient
 *     (`.of-thumb`), the "no render" plate and the library screen's shimmer
 *     skeleton — a bare `<div class="of-thumb of-shimmer">` in
 *     `screens/library/LibraryScreen.tsx` — are token colours that are already
 *     right, and a filter inherited onto them would be a regression.
 *   - **A filter id has to be resolvable in the same document, not the same
 *     subtree.** `filter: url(#id)` is a document-scoped fragment reference, so
 *     one mount anywhere in the page serves every thumb. What this component
 *     guarantees is *reachability*: it is the one module all four subtrees
 *     instantiate, so mounting `TintFilters` from inside this directory is the
 *     only mount that cannot be forgotten by a fifth caller.
 *   - **Do not render a `<defs>` per thumb.** A catalog screenful is one thumb
 *     per rendered card, so a per-thumb `<svg><defs>` would repeat one id dozens
 *     of times: `url(#id)` silently resolves to the first, which is the right
 *     picture for the wrong reason and duplicate ids besides. Either mount once
 *     at the app shell, or refcount a single document-level mount from here.
 *   - **`filter` in an external stylesheet is the hazard to check.** These rules
 *     ship in a bundled `.css` file, and `url(#id)` in a stylesheet has
 *     historically been resolved against the stylesheet's own URL rather than
 *     the document's in WebKit. P1 should verify a real browser before relying
 *     on a CSS-side reference, and can sidestep it entirely by putting the
 *     `filter` in the inline `style` object this component already builds.
 *   - **The detail screen is not a consumer.** `screens/detail/SpriteRotator.tsx`
 *     has its own sprite geometry and does not use this component, so a mount
 *     inside `TileThumb` does not cover it.
 *
 * ## The contract P3 reads: the geometry is one pure function
 *
 * {@link sheetFrameStyle} is the whole of the sprite-sheet arithmetic, separated
 * from the markup so the second source can be a second branch with its own test
 * rather than a conditional threaded through JSX. Geometry is read from the
 * index's `sprite` block and never from constants: the schema holds it as data,
 * so a future sheet layout needs no code change here — and a 256px square
 * derivative is a different shape, not a different constant.
 */
import type { CSSProperties } from 'react'

import type { BlobId, CatalogAssets, SpriteSheet } from '@/catalog'
import { shardedPath } from '@/catalog'
import { Eyebrow } from '@/ui/primitives'

export interface TileThumbProps {
  blob: BlobId
  /** `CatalogRecord.sprite` — whether a sheet exists at all. */
  sprite: boolean
  assets: CatalogAssets
  sheet: SpriteSheet
  /** Which of the 10 camera angles to show. Frame 0 is the default view. */
  frame?: number
  className?: string
}

/**
 * The custom properties that clip one frame out of a sheet.
 *
 * `left`/`top` percentages resolve against the frame box, so `-100%` is exactly
 * one column or one row — which is why this is four numbers and not a
 * pixel calculation that would have to know the rendered size.
 */
export function sheetFrameStyle(sheet: SpriteSheet, frame?: number): CSSProperties {
  const index = frame ?? sheet.defaultFrame
  const column = index % sheet.cols
  const row = Math.floor(index / sheet.cols)

  return {
    '--of-sheet-cols': String(sheet.cols),
    '--of-sheet-rows': String(sheet.rows),
    '--of-sheet-x': `${String(column * -100)}%`,
    '--of-sheet-y': `${String(row * -100)}%`,
  } as CSSProperties
}

/** One frame of a tile's sprite sheet, in a 4:3 radial-gradient well. */
export function TileThumb({ blob, sprite, assets, sheet, frame, className }: TileThumbProps) {
  return (
    <div className={['of-thumb', className].filter(Boolean).join(' ')}>
      {sprite ? (
        <div className="of-thumb-frame" style={sheetFrameStyle(sheet, frame)}>
          <img
            className="of-thumb-sheet"
            src={`${assets.sprites}/${shardedPath(blob)}.png`}
            width={sheet.cols * sheet.tile}
            height={sheet.rows * sheet.tile}
            loading="lazy"
            decoding="async"
            // Decorative: the card's title is the tile's name, and a second
            // reading of it here would make every card announce twice.
            alt=""
          />
        </div>
      ) : (
        <Eyebrow className="of-thumb-missing">no render</Eyebrow>
      )}
    </div>
  )
}
