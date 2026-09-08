/**
 * Where the selection's action bar sits on screen.
 *
 * Two functions, both pure, and they are in their own module for the reason
 * every other pure module in `builder/three` is: **jsdom has no WebGL context,
 * so no test in this repo can mount the 3D surface.** The bar's position is
 * arithmetic over a projected point and a viewport, and arithmetic can be proved
 * exactly; what cannot be proved is that drei's `<Html>` calls it, and that is
 * the one line {@link SelectionAnchor} contributes.
 *
 * ## Why the clamp exists at all
 *
 * `<Html>` positions its overlay wherever the projection lands, including off
 * the edge of the canvas and including *behind the camera*, where the projection
 * inverts. Both are reachable by ordinary use: select a piece at the edge of a
 * room and orbit, and the piece leaves the viewport while remaining selected. An
 * unclamped bar then becomes unreachable — the verbs are still bound to keys, so
 * the state is not lost, but the control that teaches them is gone with no
 * explanation.
 *
 * Clamping rather than hiding is the deliberate half. A bar that vanished at the
 * edge would read as the selection having been dropped, which is a lie about the
 * state; a bar pinned to the edge reads as *"your selection is over there"*,
 * which is true and is also how a 2D editor's contextual toolbar behaves at the
 * edge of a viewport.
 */

/** Keep this many device-independent pixels between the bar and every edge. */
export const ANCHOR_MARGIN_PX = 8

export interface ScreenPoint {
  readonly x: number
  readonly y: number
}

export interface ViewportSize {
  readonly width: number
  readonly height: number
}

/**
 * A projected point, pulled inside the viewport by {@link ANCHOR_MARGIN_PX}.
 *
 * **Total, including for a viewport smaller than twice the margin.** A 10 px
 * tall canvas has no position satisfying both bounds, and the arithmetic settles
 * it rather than asserting: `Math.min` is applied after `Math.max`, so the upper
 * bound wins and the bar sits at `height - margin`. Preferring one bound over
 * the other is arbitrary and the arbitrariness is the point — anything is better
 * than a `NaN` reaching a CSS transform, which is what an unordered clamp
 * produces on a degenerate viewport.
 *
 * A non-finite input — which is what a projection behind the camera can produce
 * — is treated as the centre of the viewport rather than propagated. The bar is
 * then in the wrong place for one frame, and `frameloop="demand"` means the next
 * camera change corrects it; propagating `NaN` would remove the element from the
 * page and not put it back.
 */
export function clampAnchor(
  point: ScreenPoint,
  size: ViewportSize,
  margin: number = ANCHOR_MARGIN_PX,
): ScreenPoint {
  return {
    x: clampAxis(point.x, size.width, margin),
    y: clampAxis(point.y, size.height, margin),
  }
}

function clampAxis(value: number, extent: number, margin: number): number {
  if (!Number.isFinite(value)) return extent / 2
  return Math.min(Math.max(value, margin), extent - margin)
}
