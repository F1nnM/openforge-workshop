/**
 * The sprite sheet's ten frames, and what they actually contain.
 *
 * design-contract.md §2.5 asks for a 288px **live 3D canvas** with drag to orbit
 * and scroll to zoom. v1 has no 3D — architecture-plan.md §8 gates a real STL
 * load on file size and defers it to PR 21, against a corpus whose median mesh
 * is 10.36 MB and whose largest is 108.9 MB. What is already in the bucket is a
 * pre-rendered **2×5 sprite sheet** per tile: 512px frames, ten camera angles,
 * uniform across all 8,701 sheets. So the preview is a sprite rotator, and it is
 * captioned as pre-rendered frames rather than as a live render.
 *
 * ## The frame order, and why it is written down here
 *
 * `CatalogFile.sprite` carries the sheet's geometry (rows, columns, frame edge,
 * default frame) but no angle names, because the geometry is what varies and the
 * names never have. They are:
 *
 * ```
 *   row 0:  0 front   1 front-right  2 right  3 back-right  4 back
 *   row 1:  5 back-left  6 left  7 front-left  8 top  9 bottom
 * ```
 *
 * Frames 0–7 are a closed azimuth ring at 45° steps; 8 and 9 are the poles.
 *
 * ## The duplicate camera positions are a metadata bug, not duplicate frames
 *
 * The upstream sprite pipeline records a `camera_pos` per angle, and three pairs
 * of those are identical in every one of the 8,701 sheets: `front`/`left` are
 * both `(-4,0,2)`, `front-right`/`back-left` both `(-3,2,3)`, `right`/`back`
 * both `(0,2,4)`. Taken at face value that would mean a ten-step rotation
 * stutters over three repeated views.
 *
 * It does not, because the *renders* are all distinct. Measured on two live
 * sheets by mean absolute per-channel difference (MAD) over the decoded frames:
 *
 *   - `4896685b…` — an Aztlan door, strongly asymmetric. The pairs the metadata
 *     calls identical differ by **27.0** (front/left), **27.0** (right/back) and
 *     **12.6** (front-right/back-left) — while the genuinely similar pairs are
 *     the ones 180° apart on the ring (right/left **3.5**, front/back **9.1**),
 *     which is what a symmetric doorway looks like from opposite sides.
 *   - `87076088…` — a 1×1 Aztlan floor, four-fold symmetric. Its eight ring
 *     frames collapse into exactly **two** clusters of four — {front, right,
 *     back, left} and the four diagonals — MAD ≤ 2.3 within a cluster against
 *     ≈14 across. Two clusters of four is the signature of a four-fold
 *     symmetric tile sampled at 45°; three duplicated cameras could not produce
 *     it.
 *
 * Frame-by-frame inspection of the door's strip agrees: face-on, turned,
 * edge-on, turned, face-on again — a monotone 360° sweep.
 *
 * So the handling is: **rotate over frames 0–7 in index order, wrapping.** No
 * de-duplication, no stutter, and nothing in this app reads `camera_pos` — the
 * workshop index does not carry it, which is why the bug is invisible here and
 * why this comment exists to stop someone "fixing" the rotator for it.
 */
import type { BlobId, CatalogAssets, SpriteSheet } from '@/catalog'
import { shardedPath } from '@/catalog'

/** The ten angle names, in frame order. Uniform across every sheet in the bucket. */
export const SPRITE_ANGLES = [
  'front',
  'front-right',
  'right',
  'back-right',
  'back',
  'back-left',
  'left',
  'front-left',
  'top',
  'bottom',
] as const

export type SpriteAngle = (typeof SPRITE_ANGLES)[number]

/** Frames 0–7: the closed azimuth ring, 45° apart. */
export const RING_FRAMES: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7]

/** The two poles, which are not on the ring and are reached deliberately. */
export const TOP_FRAME = 8
export const BOTTOM_FRAME = 9

/** Degrees of azimuth between adjacent ring frames. */
export const AZIMUTH_STEP_DEG = 360 / RING_FRAMES.length

/**
 * Pointer travel that advances one ring step.
 *
 * 30px matches the catalog app's own sprite viewer, which is the only
 * calibration of this gesture anyone has actually used.
 */
export const DRAG_STEP_PX = 30

/** Vertical travel before a drag is read as "show me the pole" instead. */
export const POLE_DRAG_PX = 30

/** Short label for the angle pad — `FR` for `front-right`. */
export function frameCode(frame: number): string {
  const angle = SPRITE_ANGLES[frame]
  if (angle === undefined) return '?'
  if (angle === 'top') return 'TOP'
  if (angle === 'bottom') return 'BOT'
  return angle
    .split('-')
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
}

/** Spoken form of an angle — `front right`, for an `aria-label`. */
export function frameName(frame: number): string {
  return (SPRITE_ANGLES[frame] ?? 'unknown').replaceAll('-', ' ')
}

/** Whether a frame is one of the two poles rather than a point on the ring. */
export function isPole(frame: number): boolean {
  return frame === TOP_FRAME || frame === BOTTOM_FRAME
}

/**
 * Step `delta` places around the azimuth ring.
 *
 * From a pole the ring is re-entered at `from`, which is where the user left it
 * — the catalog app resets to `front` instead, and losing the heading on the way
 * back from a top view is the more annoying of the two behaviours.
 */
export function stepRing(frame: number, delta: number, from = 0): number {
  const base = isPole(frame) ? from : frame
  const size = RING_FRAMES.length
  return (((base + delta) % size) + size) % size
}

/** `{assets.sprites}/{md5[:6]}/{md5}.png` — verified for all 8,701 live sheets. */
export function spriteSheetUrl(assets: CatalogAssets, blob: BlobId): string {
  return `${assets.sprites}/${shardedPath(blob)}.png`
}

/** Where a frame sits in the sheet, in rows and columns. */
export function frameCell(frame: number, sheet: SpriteSheet): { row: number; col: number } {
  return { row: Math.floor(frame / sheet.cols), col: frame % sheet.cols }
}

/**
 * The `background-*` values that show one frame at a chosen rendered size.
 *
 * The sheet is scaled as a whole — `background-size` is the full sheet at
 * `rendered` per frame — so one element and two numbers show any frame, which is
 * the whole reason a sprite sheet beats ten `<img>` elements here: the browser
 * decodes one image and rotation is a repaint.
 */
export function frameBackground(
  frame: number,
  sheet: SpriteSheet,
  rendered: number,
): { backgroundSize: string; backgroundPosition: string } {
  const { row, col } = frameCell(frame, sheet)
  return {
    backgroundSize: `${String(sheet.cols * rendered)}px ${String(sheet.rows * rendered)}px`,
    backgroundPosition: `${String(-col * rendered)}px ${String(-row * rendered)}px`,
  }
}
