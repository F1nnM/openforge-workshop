/**
 * Where frame *n* lives on a sprite sheet, and refusing to guess when it doesn't.
 *
 * The whole thumbnail derivative rests on one arithmetic fact: frame 0 of a
 * 2×5 sheet of 512 px frames is the rectangle `(0, 0, 512, 512)`. That is
 * trivial and it is also exactly the kind of thing that goes wrong silently —
 * a column-major reading of the same sheet puts frame 1 at `(0, 512)` instead
 * of `(512, 0)`, and the result is 8,702 thumbnails of the wrong camera angle
 * with no error anywhere.
 *
 * So the geometry is **read from the index** (`CatalogFile.sprite`, which the
 * importer stamps from `MEASURED_SPRITE_SHEET`) rather than hardcoded here, and
 * every sheet is checked against it before a pixel is cropped. A sheet whose
 * real dimensions disagree with the declared geometry is a hard failure: it
 * means either the upstream sprite pipeline changed its layout or this tool
 * fetched the wrong object, and both of those should stop the run rather than
 * produce a plausible-looking crop of nothing.
 */
import type { SpriteSheet } from '../../src/catalog'

/** A crop rectangle, in the argument shape `sharp.extract` takes. */
export interface FrameRect {
  left: number
  top: number
  width: number
  height: number
}

/** The pixel dimensions a sheet with this geometry must have. */
export function sheetExtent(sheet: SpriteSheet): { width: number; height: number } {
  return { width: sheet.cols * sheet.tile, height: sheet.rows * sheet.tile }
}

/**
 * The rectangle frame `index` occupies.
 *
 * **Row-major**, which is the order `src/screens/detail/spriteFrames.ts`
 * documents from the upstream renderer: row 0 is the eight-step azimuth ring's
 * first five angles, row 1 the rest plus the two poles. Frame 0 is the top-left
 * one and is the frame the catalog grid's thumbnail is cropped from.
 *
 * @throws on an index outside the sheet, rather than returning a rectangle that
 * extends past the image and would fail three layers later inside libvips.
 */
export function frameRect(sheet: SpriteSheet, index: number): FrameRect {
  if (!Number.isInteger(index) || index < 0 || index >= sheet.frames) {
    throw new Error(
      `frame ${String(index)} is not on a ${String(sheet.rows)}×${String(sheet.cols)} sheet of ${String(sheet.frames)} frames`,
    )
  }
  const col = index % sheet.cols
  const row = (index - col) / sheet.cols
  if (row >= sheet.rows) {
    throw new Error(
      `frame ${String(index)} lands on row ${String(row)} of a ${String(sheet.rows)}-row sheet — ` +
        'the declared frame count and grid disagree',
    )
  }
  return { left: col * sheet.tile, top: row * sheet.tile, width: sheet.tile, height: sheet.tile }
}

/**
 * @throws unless the decoded sheet is exactly the size the geometry claims.
 *
 * `label` is the sheet's md5 or URL, because a run over thousands of objects is
 * useless if the failure does not say which one.
 */
export function assertSheetExtent(
  actual: { width?: number; height?: number },
  sheet: SpriteSheet,
  label: string,
): void {
  const want = sheetExtent(sheet)
  if (actual.width !== want.width || actual.height !== want.height) {
    throw new Error(
      `${label}: sheet is ${String(actual.width ?? '?')}×${String(actual.height ?? '?')}, ` +
        `expected ${String(want.width)}×${String(want.height)} from the index's declared ` +
        `${String(sheet.rows)}×${String(sheet.cols)} grid of ${String(sheet.tile)} px frames`,
    )
  }
}
