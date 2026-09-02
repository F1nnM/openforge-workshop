/**
 * The tile thumbnail — one frame of a sprite sheet in a 4:3 radial-gradient well.
 *
 * Extracted from `screens/catalog/TileCard.tsx` by row P0. Four subtrees
 * rendered it then — the catalog card, the library card, the builder's bill of
 * tiles and the builder's palette — and `screens/detail/slots/SlotFills.tsx`
 * has since made five, which is the argument for the seam made twice:
 *
 *   - **P1** mounts the `feColorMatrix` filters that tint the blue render, from
 *     here, because this is the one module all five subtrees instantiate. The
 *     fifth caller landed after P0 and inherited the tint without knowing it
 *     exists. See `TintFilters.tsx`.
 *   - **P3** switches the image between a 256px thumbnail derivative and this
 *     sheet, and the two need different CSS geometry *and* different filter
 *     chains — `ThumbSource` in `src/materials/tint.ts` measures what happens
 *     when they are crossed.
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
 *     render produces a muddy wash. P1 revisited that and the objection did not
 *     survive measurement: a lit render in a *known* Phong material can be
 *     un-mixed into its shading and specular terms exactly, and re-mixed with
 *     another material's triple. It is not a wash over a render; it is the same
 *     render, re-lit. `src/materials/tint.ts` carries the whole argument and the
 *     numbers, including why a Rec.709 greyscale of these sheets would have
 *     produced the wash after all.
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
 * ## What P1 landed here: the tint, and where the `<defs>` mount
 *
 *   - **The filter is on `.of-thumb-frame`, inline.** P0's contract named
 *     `.of-thumb-sheet` and the constraint behind it still holds — the well's
 *     gradient (`.of-thumb`), the "no render" plate and the library screen's
 *     shimmer skeleton, a bare `<div class="of-thumb of-shimmer">` in
 *     `screens/library/LibraryScreen.tsx`, are token colours that must not
 *     inherit a filter. The frame honours it and is ten times cheaper; see
 *     {@link tintedFrameStyle} for both halves of that.
 *   - **The `<defs>` mount once, from `TintFilters.tsx`, imperatively.**
 *     `filter: url(#id)` is a document-scoped fragment reference, so one mount
 *     anywhere in the page serves every thumb; what this component provides is
 *     *reachability*, being the one module every thumbnail subtree instantiates.
 *     There is no `<defs>` per thumb, because a screenful would repeat one id
 *     dozens of times and `url(#id)` resolves silently to the first. The file
 *     records why the mount is DOM rather than a portal or a second React root.
 *   - **The detail screen is not a consumer.** `screens/detail/SpriteRotator.tsx`
 *     has its own sprite geometry and does not use this component, so it is not
 *     tinted — but the filters are in its document all the same, since the
 *     mount is page-global and every route renders thumbnails somewhere. A row
 *     that wants the rotator tinted needs only `url(#of-tint-sprite-…)`.
 *   - **The `material` prop defaults to `unknown`, not to no tint.** Callers in
 *     `screens/` and `builder/` pass their resolved family; the five that do not
 *     yet render a neutral grey model rather than the renderer's blue, which is
 *     the honest reading of "this component was not told". See
 *     {@link TileThumbProps.material}.
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
import type { MaterialId } from '@/materials'
import { DEFAULT_THUMB_MATERIAL, tintFilterId } from '@/materials'
import { Eyebrow } from '@/ui/primitives'

import { useTintFilters } from './TintFilters'

export interface TileThumbProps {
  blob: BlobId
  /** `CatalogRecord.sprite` — whether a sheet exists at all. */
  sprite: boolean
  assets: CatalogAssets
  sheet: SpriteSheet
  /** Which of the 10 camera angles to show. Frame 0 is the default view. */
  frame?: number
  /**
   * The family to tint the render as — `resolveMaterial(record.tags, record.file)`.
   *
   * Optional, and it defaults to {@link DEFAULT_THUMB_MATERIAL} (`unknown`)
   * rather than to no tint at all, because the blue the renderer produced is not
   * the neutral choice: it is 31.88 ΔE00 from the palette on average and
   * 14.82 ΔE00 from `water`, so an un-tinted grid names a material, and names
   * the wrong one. `unknown` is the palette's "no claim" entry, which is the
   * claim a caller that did not pass this is entitled to make.
   *
   * Pass the record's **full de-interned tag list** to `resolveMaterial`, never
   * a reconstructed `` `texture|${record.texture}` ``: on the 80 two-root tiles
   * that field is deliberately not the material the tint follows.
   */
  material?: MaterialId
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

/**
 * Where the tint goes, and why it is on the frame and not on the `<img>`.
 *
 * The constraint is that the well's radial gradient (`.of-thumb`), the "no
 * render" plate and the library screen's shimmer skeleton are token colours
 * that are already correct, and must not inherit a filter. `.of-thumb-frame`
 * satisfies that: it exists only in the `sprite` branch, it wraps nothing but
 * the sheet, and `catalog.css` gives it no background, border or colour of its
 * own — so filtering it is pixel-identical to filtering the image inside it.
 *
 * It is also ten times cheaper. A CSS `filter` rasterises the element's own
 * clipped box, and `.of-thumb-sheet` **is** `cols × 100%` by `rows × 100%` —
 * the full 2×5 sheet. Filtering the image allocates a surface for all ten
 * camera angles to show one; filtering the square frame allocates one frame. On
 * a 60-card screen, whose decode cost is already the catalog's real expense,
 * that is not a micro-optimisation.
 *
 * Inline, not in `catalog.css`, and that is the WebKit hazard rather than a
 * preference: `url(#id)` in a bundled external stylesheet has historically been
 * resolved against the stylesheet's own URL instead of the document's, which
 * fails in a production bundle while working from a dev server.
 */
function tintedFrameStyle(sheet: SpriteSheet, frame: number | undefined, material: MaterialId): CSSProperties {
  return {
    ...sheetFrameStyle(sheet, frame),
    // `sprite`, not `thumb`: this component still renders the sheet. P3 owns
    // the switch, and that argument is the whole of it — see `ThumbSource` for
    // what pointing the wrong chain at a source costs.
    filter: `url(#${tintFilterId(material, 'sprite')})`,
  }
}

/** One frame of a tile's sprite sheet, in a 4:3 radial-gradient well. */
export function TileThumb({
  blob,
  sprite,
  assets,
  sheet,
  frame,
  material = DEFAULT_THUMB_MATERIAL,
  className,
}: TileThumbProps) {
  // Mounts the page's single `<defs>`, from the one module every
  // thumbnail-rendering subtree instantiates. See `TintFilters.tsx`.
  useTintFilters()

  return (
    <div className={['of-thumb', className].filter(Boolean).join(' ')}>
      {sprite ? (
        <div className="of-thumb-frame" style={tintedFrameStyle(sheet, frame, material)}>
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
