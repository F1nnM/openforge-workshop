/**
 * The tile thumbnail — one image in a 4:3 radial-gradient well, from whichever
 * of the two sources exists.
 *
 * Extracted from `screens/catalog/TileCard.tsx` by row P0 because four subtrees
 * rendered it; `screens/detail/slots/SlotFills.tsx` has since made five. Row P1
 * mounted the tint filters here, for the same reason: this is the one module all
 * five instantiate. Row P3 added the second source.
 *
 * See {@link TileThumbProps} for the interface, and `thumb.css` for the geometry
 * of each source.
 *
 * ## Two sources, and the switch is one variable on purpose
 *
 * The sheet is **2 rows × 5 columns of 512px frames, averaging 529 KB**, at
 * `/sprites/{md5[:6]}/{md5}.png`; frame 0 is shown by clipping it, so a
 * screenful of cards decodes hundreds of megabytes. The derivative is **one
 * 256px square WebP** at `/thumbs/{md5[:6]}/{md5}.webp`, already cropped to
 * frame 0 and already greyscale. It is the fix for that decode cost, and
 * `CatalogRecord.thumb` is what says whether it exists — measured against the
 * live bucket, not assumed. Today it exists for **0 of 8,352 blobs**, so this
 * component renders sheets, honestly.
 *
 * The two sources need different CSS geometry *and* different `feColorMatrix`
 * chains, and **pointing one chain at the other source is not symmetric**
 * (`ThumbSource` in `src/materials/tint.ts` carries the measurements):
 *
 *   - a sheet through the `thumb` matrix is a median **1.38–4.51** ΔE00 — the
 *     "muddy wash", real and survivable;
 *   - a thumbnail through the `sprite` matrix is a median **10.52–73.52** ΔE00
 *     and **collapses towards black** (`necro` lands on `#000000`), because the
 *     un-mix's shading row sums to zero, so a grey input yields a *negative*
 *     shading term and the family's diffuse is subtracted rather than added.
 *
 * So the dangerous crossing is the one an `onError` swap produces: change the
 * `src` and not the `filter`, and the grid goes black. That is why the chosen
 * source is the only state this component has, and why the `src`, the
 * intrinsic dimensions, the image class, the frame geometry and the filter id
 * are **all five derived from it** by {@link imageFor} and {@link frameStyle}.
 * There is no code path that sets one without the others; the crossing is not
 * avoided by discipline, it is unrepresentable.
 *
 * ## The fallback is a chain, not a boolean
 *
 * `thumb`, then `sprite`, then the "no render" plate — and a source that errors
 * hands over to the next one. Three things fall out of writing it that way
 * rather than as "if the thumb 404s, use the sheet":
 *
 *   - **A stale `thumb: true` degrades instead of breaking.** The index is built
 *     from a probe, and a probe is a reading of a bucket at a moment; an object
 *     deleted afterwards would otherwise be a permanently broken image.
 *   - **The one live tile of 8,702 with no sheet needs no special case.** Its
 *     chain is empty, and an empty chain *is* the plate.
 *   - **A 404 on the sheet now reaches the plate too**, where before it reached
 *     the browser's broken-image glyph. That is a behaviour change and it is
 *     deliberate; the plate is the honest rendering of "no picture of this tile".
 *
 * The chain position is keyed on the blob, because `VirtuosoGrid` recycles
 * component instances as the user scrolls: state remembered against the instance
 * would take a fallback earned by one tile and apply it to whichever tile landed
 * in that slot next. Deriving the position from the current `blob` during render
 * means no effect, no flash, and no stale fallback.
 *
 * ## Where the tint goes, and what P3 re-measured about it
 *
 * P1 put the filter on `.of-thumb-frame` rather than on the `<img>`, for two
 * reasons. The first still holds for both sources: the well's gradient
 * (`.of-thumb`), the plate and the library's shimmer skeleton — a bare
 * `<div class="of-thumb of-shimmer">` in `screens/library/LibraryScreen.tsx` —
 * are token colours that must not inherit a filter, and the frame exists only
 * inside the image branch and carries no colour of its own.
 *
 * The second was that filtering the frame is **ten times cheaper**, because a
 * CSS filter rasterises the element's own clipped box and `.of-thumb-sheet`'s
 * box is `cols × 100%` by `rows × 100%` — all ten camera angles, to show one.
 * P3 was asked to re-examine that for the new source and it **does not hold**:
 * a 256px square derivative's `<img>` box *is* the frame box, so the two
 * attachment points allocate the same surface and the saving is 1×, not 10×.
 * The filter stays on the frame regardless, and the reason is now the switch
 * rather than the surface — one attachment point means a source change cannot
 * leave two filters on two elements, or one on an element the other source does
 * not render. (What the derivative *does* save is the decode: 256² of WebP
 * against 2560×1024 of PNG.)
 *
 * Inline rather than in `thumb.css`, and that is a WebKit hazard rather than a
 * preference: `url(#id)` in a bundled external stylesheet has historically been
 * resolved against the stylesheet's own URL instead of the document's, which
 * fails in a production bundle while working from a dev server.
 *
 * The `<defs>` those ids resolve against mount once per document, imperatively,
 * from `TintFilters.tsx` — which carries why that is DOM and not JSX, and why
 * all 32 filters (16 families × 2 sources) are mounted whether or not anything
 * references them. That is what makes this row's switch one argument.
 *
 * ## Two notes for anyone editing this
 *
 * **Geometry is read from the index, never from constants.** The sheet's rows,
 * columns and tile size come from `CatalogFile.sprite`, so a future layout needs
 * no code change here. The derivative's edge comes from `MEASURED_THUMB`, which
 * is the same constant `tools/thumbnails/render.ts` renders at — the number is
 * defined once because a mismatch is an 8,352-way 404 nothing would catch.
 *
 * **The sheet's ten frames are ten distinct renders.** An earlier claim that
 * three were duplicates was disproved by decoding the pixels (mean absolute
 * difference 12.6–27.0 for the supposedly identical pairs, against 3.5–9.1 for
 * pairs 180° apart). It is the `camera_pos` *metadata* that is wrong, so frame
 * arithmetic here is sound and only a caller trying to *name* an angle needs
 * care. The derivative has one frame and `frame` does not apply to it.
 */
import type { CSSProperties } from 'react'
import { useState } from 'react'

import type { BlobId, CatalogAssets, SpriteSheet } from '@/catalog'
import { MEASURED_THUMB, shardedPath } from '@/catalog'
import type { MaterialId, ThumbSource } from '@/materials'
import { tintFilterId } from '@/materials'
import { Eyebrow } from '@/ui/primitives'

import './thumb.css'
import { useTintFilters } from './TintFilters'

export interface TileThumbProps {
  blob: BlobId
  /** `CatalogRecord.sprite` — whether a 2×5 sheet exists at all. */
  sprite: boolean
  /**
   * `CatalogRecord.thumb` — whether the 256px `/thumbs/` derivative exists.
   *
   * Required, like `sprite`, and for the stronger version of the same reason.
   * Before this existed the component could only render the sheet, because it
   * had no way to tell "there is no derivative" from "nobody told me about the
   * derivative" — and guessing wrong in one direction is a 404 on every card.
   * A caller that has a `CatalogRecord` or a `TileVariant` has this field on it;
   * a caller that does not have one has no business claiming a thumbnail exists.
   *
   * `false` on all 8,702 records today. See `pipeline/thumbs.ts`.
   */
  thumb: boolean
  assets: CatalogAssets
  sheet: SpriteSheet
  /**
   * Which of the sheet's 10 camera angles to show. Frame 0 is the default view.
   *
   * Applies to the `sprite` source only: the derivative is a crop of the sheet's
   * `defaultFrame`, so there is no other angle in it. A caller that needs a
   * specific angle is asking for the sheet, and passing `frame` does **not**
   * force it — a record with `thumb: true` still shows the derivative, which is
   * frame 0. No caller passes `frame` today; `screens/detail/SpriteRotator.tsx`
   * is the subtree that wants other angles and it has its own geometry.
   */
  frame?: number
  /**
   * The family to tint the render as — `index.materialOf(record)`, or
   * `DEFAULT_THUMB_MATERIAL` for a caller that means "no claim".
   *
   * **Required, and row P3 made it so rather than inherit P1's default.** P1
   * shipped it optional, defaulting to `unknown` on the argument that the
   * renderer's blue is not the neutral option: it is 31.88 ΔE00 from the
   * *palette albedos* on average and 14.82 from `water`, so an un-tinted grid
   * names a material and names the wrong one. The row was asked to test that
   * rather than inherit it, and re-measuring it in the space that actually
   * ships — rendering against rendering, at the corpus-mean sprite pixel,
   * where the palette's own 9.0 confusability floor lives — inverts it:
   *
   *   `unknown` renders as `#535352`; nearest family rendering **`rough_stone`
   *   at 9.64 ΔE00**, mean 23.28. The raw blue renders as `#3173bd`; nearest
   *   **`water` at 15.94 ΔE00**, mean 31.84.
   *
   * So the `unknown` default is *more* confusable with a specific real material
   * than the blue it replaced — 0.64 ΔE00 above the floor against 6.94 —
   * and P1's numbers compared palette albedos with a rendered pixel, which are
   * not the same quantity. Neither default is therefore safe, and the fix is not
   * to pick the other one: it is that a call site which was never told the
   * material must not be *renderable*. Required makes an unwired caller a
   * compile error instead of a plausible grey card, which is the only version of
   * this that cannot silently look correct. `DEFAULT_THUMB_MATERIAL` is still
   * the right thing to pass **explicitly** when a caller genuinely has no claim
   * to make; whether its docblock's argument survives is P1's to decide.
   *
   * Pass the record's **full de-interned tag list** to `resolveMaterial`, never
   * a reconstructed `` `texture|${record.texture}` ``: measured over all 8,702
   * records, a `TEXTURE_ROOT_MATERIAL[record.texture]` shortcut disagrees with
   * `resolveMaterial` on **691** of them (7.9%) — 252 `cave` tiles that are
   * `sandstone`, 257 `towne` tiles split between `cut_stone` and `wood`, and 85
   * with no `texture` at all that still resolve through a filename hint or a
   * part fallback. `CatalogIndex.materialOf` does it correctly, once per record,
   * memoised, and four of the five callers use it.
   */
  material: MaterialId
  className?: string
}

/**
 * The custom properties that clip one frame out of a sheet.
 *
 * `left`/`top` percentages resolve against the frame box, so `-100%` is exactly
 * one column or one row — which is why this is four numbers and not a
 * pixel calculation that would have to know the rendered size.
 *
 * The `thumb` source has no counterpart to this and deliberately does not get an
 * empty-object stand-in: {@link frameStyle} branches, so a reader can see that
 * one source has geometry to compute and the other has none.
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
 * The sources this record has, best first.
 *
 * `thumb` before `sprite` because it is a quarter of the pixels and a fraction
 * of the bytes. Both are checked rather than assuming `thumb` implies `sprite`:
 * it does today, since the derivative is cropped from the sheet, but the
 * implication is a property of how the objects happen to be produced and not
 * something this component should break if it changes.
 */
function sourceChain(sprite: boolean, thumb: boolean): ThumbSource[] {
  const chain: ThumbSource[] = []
  if (thumb) chain.push('thumb')
  if (sprite) chain.push('sprite')
  return chain
}

/** The frame's inline style: this source's geometry, and this source's filter. */
function frameStyle(
  source: ThumbSource,
  sheet: SpriteSheet,
  frame: number | undefined,
  material: MaterialId,
): CSSProperties {
  const geometry = source === 'sprite' ? sheetFrameStyle(sheet, frame) : {}
  return { ...geometry, filter: `url(#${tintFilterId(material, source)})` }
}

interface ImageSpec {
  className: string
  src: string
  width: number
  height: number
}

/**
 * The `<img>` for one source: its URL, its class and its intrinsic size.
 *
 * The dimensions are the object's real ones — the sheet's 2560×1024, the
 * derivative's 256×256 — so the aspect ratio is reserved before the image
 * lands. Both paths are content-addressed through {@link shardedPath}, so an
 * off-by-one in the shard cannot differ between them.
 */
function imageFor(source: ThumbSource, blob: BlobId, assets: CatalogAssets, sheet: SpriteSheet): ImageSpec {
  if (source === 'thumb') {
    return {
      className: 'of-thumb-image',
      src: `${assets.thumbs}/${shardedPath(blob)}${MEASURED_THUMB.extension}`,
      width: MEASURED_THUMB.size,
      height: MEASURED_THUMB.size,
    }
  }
  return {
    className: 'of-thumb-sheet',
    src: `${assets.sprites}/${shardedPath(blob)}.png`,
    width: sheet.cols * sheet.tile,
    height: sheet.rows * sheet.tile,
  }
}

/** One tile's thumbnail, from the best source it has, in a 4:3 well. */
export function TileThumb({
  blob,
  sprite,
  thumb,
  assets,
  sheet,
  frame,
  material,
  className,
}: TileThumbProps) {
  // Mounts the page's single `<defs>`, from the one module every
  // thumbnail-rendering subtree instantiates. See `TintFilters.tsx`.
  useTintFilters()

  // How far down this *blob's* chain we have fallen. Keyed on the blob rather
  // than held as a bare counter because `VirtuosoGrid` recycles instances: a
  // counter would carry one tile's 404 onto its replacement. Derived during
  // render, so there is no effect and no un-filtered first paint.
  const [fallen, setFallen] = useState<{ blob: BlobId; steps: number } | null>(null)
  const chain = sourceChain(sprite, thumb)
  const at = fallen?.blob === blob ? fallen.steps : 0
  const shownSource = chain[at]

  return (
    <div className={['of-thumb', className].filter(Boolean).join(' ')}>
      {shownSource === undefined ? (
        <Eyebrow className="of-thumb-missing">no render</Eyebrow>
      ) : (
        <ThumbImage
          blob={blob}
          source={shownSource}
          assets={assets}
          sheet={sheet}
          frame={frame}
          material={material}
          onFail={() => {
            setFallen({ blob, steps: at + 1 })
          }}
        />
      )}
    </div>
  )
}

/**
 * The frame and the image for one source.
 *
 * Its own component so that the `key` can be the source: swapping sources
 * replaces the `<img>` rather than mutating the `src` of the one that just
 * failed, which is what stops a browser reporting a second `error` for the old
 * URL against the new element and skipping a step of the chain.
 */
function ThumbImage({
  blob,
  source,
  assets,
  sheet,
  frame,
  material,
  onFail,
}: {
  blob: BlobId
  source: ThumbSource
  assets: CatalogAssets
  sheet: SpriteSheet
  frame: number | undefined
  material: MaterialId
  onFail: () => void
}) {
  const image = imageFor(source, blob, assets, sheet)

  return (
    <div className="of-thumb-frame" style={frameStyle(source, sheet, frame, material)}>
      <img
        key={source}
        className={image.className}
        src={image.src}
        width={image.width}
        height={image.height}
        loading="lazy"
        decoding="async"
        onError={onFail}
        // Decorative: the card's title is the tile's name, and a second
        // reading of it here would make every card announce twice.
        alt=""
      />
    </div>
  )
}
