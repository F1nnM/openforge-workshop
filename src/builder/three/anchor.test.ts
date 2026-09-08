/**
 * The action bar's position, at the edges and past them.
 *
 * **What these tests prove:** that a selection near or beyond the edge of the
 * viewport still has a reachable bar, and that no arithmetic here can produce a
 * `NaN` for a CSS transform to swallow the element with.
 *
 * **What they cannot prove:** that drei's `<Html>` calls `clampAnchor` at all.
 * That is one line in `SelectionAnchor.tsx` and it needs a WebGL context, which
 * jsdom has not got.
 */
import { describe, expect, it } from 'vitest'

import { ANCHOR_MARGIN_PX, clampAnchor } from './anchor'

const SIZE = { width: 800, height: 600 }

describe('the clamp', () => {
  it('leaves a point that is already inside alone', () => {
    expect(clampAnchor({ x: 400, y: 300 }, SIZE)).toEqual({ x: 400, y: 300 })
  })

  it('pulls a point inside at every edge', () => {
    expect(clampAnchor({ x: -50, y: 300 }, SIZE)).toEqual({ x: ANCHOR_MARGIN_PX, y: 300 })
    expect(clampAnchor({ x: 900, y: 300 }, SIZE)).toEqual({ x: 800 - ANCHOR_MARGIN_PX, y: 300 })
    expect(clampAnchor({ x: 400, y: -20 }, SIZE)).toEqual({ x: 400, y: ANCHOR_MARGIN_PX })
    expect(clampAnchor({ x: 400, y: 700 }, SIZE)).toEqual({ x: 400, y: 600 - ANCHOR_MARGIN_PX })
  })

  it('clamps both axes at once for a corner', () => {
    expect(clampAnchor({ x: -100, y: 900 }, SIZE)).toEqual({
      x: ANCHOR_MARGIN_PX,
      y: 600 - ANCHOR_MARGIN_PX,
    })
  })

  it('lands exactly on the margin, not one pixel off it', () => {
    // The boundary rather than a value near it: an off-by-one here is invisible
    // on screen and would make the two edges disagree by a pixel.
    expect(clampAnchor({ x: ANCHOR_MARGIN_PX, y: ANCHOR_MARGIN_PX }, SIZE)).toEqual({
      x: ANCHOR_MARGIN_PX,
      y: ANCHOR_MARGIN_PX,
    })
  })

  it('resolves a viewport too small for both bounds instead of returning NaN', () => {
    // No position satisfies `>= 8` and `<= 2` at once. The upper bound wins,
    // which is arbitrary and documented as such — what matters is that the
    // answer is a number.
    const tiny = clampAnchor({ x: 5, y: 5 }, { width: 10, height: 10 })
    expect(Number.isFinite(tiny.x)).toBe(true)
    expect(tiny).toEqual({ x: 2, y: 2 })
  })

  it('sends a non-finite projection to the centre rather than propagating it', () => {
    // A projection behind the camera can invert to Infinity or NaN. Propagated
    // into a CSS transform it removes the element from the page and does not put
    // it back; `frameloop="demand"` redraws on the next camera change, so one
    // frame in the middle of the viewport is the cheap wrong answer.
    expect(clampAnchor({ x: Number.NaN, y: 300 }, SIZE)).toEqual({ x: 400, y: 300 })
    expect(clampAnchor({ x: 400, y: Number.POSITIVE_INFINITY }, SIZE)).toEqual({ x: 400, y: 300 })
  })

  it('takes a margin, so a caller with a taller bar can ask for more room', () => {
    expect(clampAnchor({ x: 0, y: 0 }, SIZE, 24)).toEqual({ x: 24, y: 24 })
  })
})
