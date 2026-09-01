/**
 * The plan camera — pan and zoom, as pure functions.
 *
 * A viewport is three numbers: the world coordinate under the canvas's top-left
 * pixel, and the pixel size of one grid unit. Everything else is derived, which
 * is what makes the whole camera testable without a DOM.
 *
 * **The SVG's `viewBox` is in grid units, not pixels.** So one attribute carries
 * the entire camera, a pan is one attribute write rather than a transform on
 * every piece, and no piece needs to know the scale. The cost is that stroke
 * widths would scale with zoom, which `vector-effect="non-scaling-stroke"`
 * cancels — and that is a feature: a contour that thinned as you zoomed out is
 * exactly the contour WCAG 1.4.11 is relying on to carry the silhouette.
 *
 * Zoom is anchored on a screen point rather than on the centre, because a
 * builder zooms towards the thing under the cursor. Anchoring on the centre
 * makes the piece you were looking at drift off screen, which reads as the app
 * fighting you.
 */
import type { PlanBox, PlanPoint } from './geometry'

/** Pixels per grid unit, and where the world sits under the top-left pixel. */
export interface Viewport {
  readonly x: number
  readonly z: number
  readonly scale: number
}

/** The canvas's CSS pixel size. */
export interface CanvasSize {
  readonly width: number
  readonly height: number
}

/**
 * Zoom limits, in pixels per grid unit — i.e. per 25.4 mm.
 *
 * The floor is set by the smallest thing on the plan: a 0.5 × 0.5 column
 * (`plan.ts` calls it the smallest footprint in the corpus) is 5 px across at
 * scale 10, which is the point below which a piece stops being a shape and
 * becomes a speck. The ceiling is where one grid square fills a third of a
 * 1,000 px canvas and there is nothing left to see.
 */
export const MIN_SCALE = 10
export const MAX_SCALE = 320
/** One grid unit ≈ 44 px: a 2 × 2 tile is 88 px, about a thumbnail. */
export const DEFAULT_SCALE = 44

/**
 * The size assumed before the element has been laid out.
 *
 * Not a test hook: a `getBoundingClientRect` on a freshly mounted flex child is
 * genuinely 0 × 0 in a real browser too, and a zero-width canvas produces a
 * zero-width `viewBox`, which SVG treats as "draw nothing" — a blank builder on
 * first paint. jsdom reports 0 × 0 permanently, so component tests exercise this
 * path and get a deterministic mapping out of it.
 */
export const FALLBACK_SIZE: CanvasSize = { width: 960, height: 640 }

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return DEFAULT_SCALE
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

/** The canvas size to use, substituting {@link FALLBACK_SIZE} for an unlaid-out element. */
export function usableSize(size: CanvasSize | null): CanvasSize {
  if (size === null || size.width < 1 || size.height < 1) return FALLBACK_SIZE
  return size
}

/** The visible world rectangle — i.e. the SVG `viewBox`, in grid units. */
export function viewBox(view: Viewport, size: CanvasSize): PlanBox {
  return { x: view.x, z: view.z, w: size.width / view.scale, d: size.height / view.scale }
}

/** A point in the element's local pixels, to grid units. */
export function toWorld(view: Viewport, px: number, pz: number): PlanPoint {
  return [view.x + px / view.scale, view.z + pz / view.scale]
}

/** Grid units to the element's local pixels. */
export function toScreen(view: Viewport, x: number, z: number): PlanPoint {
  return [(x - view.x) * view.scale, (z - view.z) * view.scale]
}

/** Scroll the view by a pixel delta. */
export function panByPixels(view: Viewport, dxPx: number, dzPx: number): Viewport {
  return { ...view, x: view.x + dxPx / view.scale, z: view.z + dzPx / view.scale }
}

/**
 * Zoom by `factor`, keeping the world point under (`px`, `pz`) where it is.
 *
 * The clamp is applied before the anchor correction, so at the limits the view
 * stops rather than drifting sideways while the scale refuses to change.
 */
export function zoomAt(view: Viewport, factor: number, px: number, pz: number): Viewport {
  const scale = clampScale(view.scale * factor)
  if (scale === view.scale) return view
  const [wx, wz] = toWorld(view, px, pz)
  return { scale, x: wx - px / scale, z: wz - pz / scale }
}

/** One wheel notch, as a scale factor. Exponential so a fast flick is not linear. */
export function wheelFactor(deltaY: number): number {
  return Math.exp(-deltaY * 0.0015)
}

/** Put a world point in the middle of the canvas. */
export function centreOn(view: Viewport, size: CanvasSize, x: number, z: number): Viewport {
  return { ...view, x: x - size.width / view.scale / 2, z: z - size.height / view.scale / 2 }
}

/**
 * The smallest scroll that brings `box` fully inside the view, with `margin`
 * grid units of clear space. Returns the same object when nothing needs to move,
 * so a keyboard cursor stepping around the middle of the room does not re-render
 * the camera.
 *
 * This is what replaces an explicit keyboard pan: the cursor pushes the view
 * when it reaches the edge, the way a text caret scrolls a textarea. A separate
 * pan chord would be one more thing to document and one more thing to forget.
 */
export function ensureVisible(view: Viewport, size: CanvasSize, box: PlanBox, margin = 1): Viewport {
  const frame = viewBox(view, size)
  let { x, z } = view
  if (box.x - margin < frame.x) x = box.x - margin
  else if (box.x + box.w + margin > frame.x + frame.w) x = box.x + box.w + margin - frame.w
  if (box.z - margin < frame.z) z = box.z - margin
  else if (box.z + box.d + margin > frame.z + frame.d) z = box.z + box.d + margin - frame.d
  if (x === view.x && z === view.z) return view
  return { ...view, x, z }
}

/**
 * A view framing every box, or the default view when there are none.
 *
 * `padding` is in grid units and is applied on all four sides, matching
 * `plan.ts`'s `PLAN_MARGIN`: the hero derives its frame from its pieces for the
 * same reason, so that the drawing is centred in its own frame rather than the
 * room having to fill a shape someone chose.
 */
export function fitBoxes(boxes: readonly PlanBox[], size: CanvasSize, padding = 1.5): Viewport {
  if (boxes.length === 0) return defaultViewport()
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const box of boxes) {
    left = Math.min(left, box.x)
    top = Math.min(top, box.z)
    right = Math.max(right, box.x + box.w)
    bottom = Math.max(bottom, box.z + box.d)
  }
  const w = right - left + padding * 2
  const d = bottom - top + padding * 2
  const scale = clampScale(Math.min(size.width / w, size.height / d))
  const centred = { x: 0, z: 0, scale }
  return centreOn(centred, size, (left + right) / 2, (top + bottom) / 2)
}

/**
 * The opening view: the origin near the top-left, a little clear space around it.
 *
 * Not centred on the origin, because a room grows east and south from where you
 * start it and a centred origin wastes half the canvas on the quadrant nobody
 * builds into.
 */
export function defaultViewport(): Viewport {
  return { x: -2, z: -2, scale: DEFAULT_SCALE }
}
