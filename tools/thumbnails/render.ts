/**
 * Sheet bytes in, one thumbnail out.
 *
 * ## Why sharp
 *
 * `sharp` 0.35.2 is **already in the dependency tree** — wrangler 4.127.1 pulls
 * it through miniflare — so declaring it as a devDependency at the same version
 * adds nothing to install weight and npm dedupes to one copy. It ships
 * prebuilt libvips binaries for `linux-x64` (and musl, and wasm32 as a
 * fallback), so `ubuntu-latest` in CI needs no `apt-get`. ImageMagick and
 * `cwebp` would both need a system package added to `mise.toml` and a
 * subprocess per object, and neither buys anything here: the operation is one
 * crop, one Lanczos resize and one WebP encode.
 *
 * ## Determinism
 *
 * Every knob that has a default is passed explicitly, because the defaults are
 * the library's and can move between versions while the output silently
 * changes. `kernel: 'lanczos3'`, `effort: 4`, `alphaQuality: 100`,
 * `smartSubsample: false`, and metadata stripped (sharp's default — no
 * `withMetadata()` call, so no timestamps or ICC profiles land in the file).
 * Given one libvips/libwebp build, the same sheet produces byte-identical
 * output, which is what makes `--force` reruns diffable and the manifest's
 * per-object sha256 meaningful.
 *
 * ## The alpha detail that matters
 *
 * The sheets are RGBA with a fully transparent background, and the RGB values
 * *underneath* the transparent pixels are not zero — they carry the renderer's
 * background colour. sharp premultiplies alpha before resizing, so those hidden
 * values contribute nothing to the result, and `alphaQuality: 100` keeps the
 * cutout edge from being chewed up by the lossy path. A thumbnail therefore
 * composites cleanly onto the parchment ground rather than arriving with a blue
 * fringe.
 */
import sharp from 'sharp'

import type { SpriteSheet } from '../../src/catalog'
import { MEASURED_THUMB } from '../../src/catalog'

import { assertSheetExtent, frameRect } from './geometry'

/**
 * Output edge length in pixels.
 *
 * architecture-plan.md §8. 256 px is 2× the largest size the catalog grid's
 * card renders a thumbnail at, so it stays sharp on a 2× display and is a
 * quarter of the source frame's 512 px — a downscale, never an upscale.
 */
export const THUMB_SIZE = MEASURED_THUMB.size

/** WebP quality. §8's "q80"; measured output at this setting is in `measure.ts`. */
export const THUMB_QUALITY = 80

/**
 * Colour treatment.
 *
 * `blue` keeps the source render untouched — `stl-thumb` renders in a default
 * blue Phong material and the sheet is emitted as it came. `neutral`
 * desaturates, which is architecture-plan.md §8's position and what the CLI
 * defaults to.
 *
 * **Two things this docblock used to say are no longer true, both corrected by
 * measurement.**
 *
 * It said the blue grid's disagreement with the tinted plan view is *"accepted
 * rather than hidden"*. It is neither: row P1 tints the sheets in the browser,
 * off these same PNGs, so the disagreement is closed. `blue` is therefore no
 * longer a product position — it is the raw render, for anyone who wants it.
 *
 * And it said `neutral` *"converts to Rec.709 luma"*. It does not. Row P1
 * measured this exact `sharp().greyscale()` call against **393,157 real pixels**:
 * it is Rec.709 **luminance computed in *linear* light** and re-encoded to sRGB
 * (MAD **0.375 / 255**), against **7.053 / 255** for the gamma-space luma reading
 * — a factor of 19. That is not a nicety. `src/materials/tint.ts`'s `thumb` chain
 * is calibrated against what this call actually does, and because a
 * linear-light luminance is not even an affine function of the sheet's two Phong
 * terms, the chain has to *regress* them (R² 0.4993 / 0.6128) where the `sprite`
 * chain un-mixes them exactly. **Changing this line changes that calibration.**
 *
 * **Row P3 moved the defaults to match.** `cli.ts` already passed `neutral`
 * explicitly; {@link renderThumbnail} and `runThumbnails` still defaulted to
 * `blue`, so a caller using the library rather than the CLI staged objects the
 * app would then tint through the wrong chain — the crossing `ThumbSource`
 * measures at 1.38 to 4.51 median ΔE00. They agree now. `blue` stays
 * reachable, because the measurement that chose between them has to stay
 * reproducible.
 */
export type Tone = 'blue' | 'neutral'

export interface RenderOptions {
  /** Sheet geometry, from `CatalogFile.sprite`. */
  sheet: SpriteSheet
  /** Which frame to crop. Defaults to the index's `defaultFrame`. */
  frame?: number
  /** Output edge length. Defaults to {@link THUMB_SIZE}. */
  size?: number
  /** WebP quality. Defaults to {@link THUMB_QUALITY}. */
  quality?: number
  /** Defaults to `'neutral'` — see {@link Tone}. */
  tone?: Tone
  /** For error messages: the md5 or URL these bytes came from. */
  label?: string
}

/**
 * The cropped frame as raw RGBA at its native size, for tests that need to
 * assert *which* frame was taken rather than what it encoded to.
 */
export async function cropFrame(
  bytes: Buffer,
  options: RenderOptions,
): Promise<{ data: Buffer; width: number; height: number; channels: number }> {
  const image = sharp(bytes)
  const meta = await image.metadata()
  assertSheetExtent(meta, options.sheet, options.label ?? 'sheet')

  const rect = frameRect(options.sheet, options.frame ?? options.sheet.defaultFrame)
  const { data, info } = await sharp(bytes)
    .extract(rect)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height, channels: info.channels }
}

/** Crop the frame, resize, encode. The whole derivative, in one call. */
export async function renderThumbnail(bytes: Buffer, options: RenderOptions): Promise<Buffer> {
  const image = sharp(bytes, { failOn: 'error' })
  const meta = await image.metadata()
  assertSheetExtent(meta, options.sheet, options.label ?? 'sheet')

  const rect = frameRect(options.sheet, options.frame ?? options.sheet.defaultFrame)
  const size = options.size ?? THUMB_SIZE
  let pipeline = sharp(bytes, { failOn: 'error' })
    .extract(rect)
    .resize(size, size, { fit: 'cover', kernel: 'lanczos3', withoutEnlargement: false })
  if ((options.tone ?? 'neutral') === 'neutral') pipeline = pipeline.greyscale()

  return pipeline
    .webp({
      quality: options.quality ?? THUMB_QUALITY,
      effort: 4,
      alphaQuality: 100,
      smartSubsample: false,
    })
    .toBuffer()
}
