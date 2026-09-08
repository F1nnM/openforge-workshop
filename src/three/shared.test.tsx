// @vitest-environment jsdom
/**
 * The slot, mounted for real — and the honest boundary of what jsdom can say.
 *
 * ## What this file proves
 *
 *   - A card's slot is **a plain 2D canvas**, labelled as an image, sized in CSS
 *     pixels with a backing store in device pixels under the same `[2, 2]` band
 *     `<Canvas dpr>` applies to the shared buffer. The two ends agreeing on dpr
 *     is the difference between a crisp preview and a soft one, and it is checked
 *     here by reading the registered surface's own canvas back.
 *   - N slots register N subjects **in one pool**, and the pool's buffer is sized
 *     to the largest of them. That is the shape of the claim this row exists to
 *     make: one canvas for a grid.
 *   - A drag rotates that subject's orbit by `OrbitControls`' own formula, marks
 *     it active for the duration, and does nothing at all when the slot is not
 *     interactive.
 *   - A browser that refuses a 2D context leaves the slot registered, at its real
 *     size, and unpaintable — so the card keeps its layout and nothing throws.
 *
 * ## What it cannot prove
 *
 * **No renderer runs.** `SharedStage.tsx` is not mounted anywhere in this suite:
 * jsdom has no `getContext('webgl2')`, so `<Canvas>` cannot create a
 * `WebGLRenderer` and `useThree` throws outside one. Everything about the frame
 * itself — that one context serves every subject, that the AO pass lands, that
 * `drawImage` copies what was just drawn — is a browser assertion. What is
 * checked in CI is the arithmetic and the call sequence (`subjects.test.ts`) and
 * the DOM the slots put on the page (this file).
 *
 * ## Two jsdom stubs, and why they are not faking the subject
 *
 * `getContext('2d')` returns `null` in jsdom unless the optional `canvas`
 * package is installed, and `Element.setPointerCapture` is not implemented at
 * all. Neither is a decision this row made, so both are stubbed — a recorder for
 * the context, and a capture that tracks its own state. The null-context path
 * gets its own test, with the stub switched off, because in a real browser that
 * path is "out of canvas memory" rather than "not implemented".
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { devicePixels } from './frame'
import { SharedPreview } from './SharedPreview'
import type { SubjectPool } from './subjects'
import { DEFAULT_ORBIT, createSubjectPool, orbitDrag, paintable, poolSlotSize } from './subjects'

/** jsdom implements no pointer capture. Tracked, so the release path is real. */
function stubPointerCapture(): void {
  const captured = new WeakMap<Element, Set<number>>()
  const ids = (element: Element) => {
    const existing = captured.get(element)
    if (existing !== undefined) return existing
    const created = new Set<number>()
    captured.set(element, created)
    return created
  }

  Object.assign(Element.prototype, {
    setPointerCapture(this: Element, id: number) {
      ids(this).add(id)
    },
    releasePointerCapture(this: Element, id: number) {
      ids(this).delete(id)
    },
    hasPointerCapture(this: Element, id: number) {
      return ids(this).has(id)
    },
  })
}

/** A 2D context that records nothing but exists, with its canvas attached. */
function stubContext2d(context: unknown = null): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
    kind: string,
  ) {
    if (kind !== '2d') return null
    if (context !== null) return context as CanvasRenderingContext2D
    return {
      canvas: this,
      clearRect: () => undefined,
      drawImage: () => undefined,
    } as unknown as CanvasRenderingContext2D
  } as typeof HTMLCanvasElement.prototype.getContext)
}

let pool: SubjectPool

beforeEach(() => {
  vi.restoreAllMocks()
  stubPointerCapture()
  stubContext2d()
  pool = createSubjectPool()
})

describe('a slot', () => {
  it('is a labelled image, not a control', () => {
    render(
      <SharedPreview pool={pool} id="floor" label="3D preview of Dungeon stone floor 4×1">
        <mesh />
      </SharedPreview>,
    )

    const slot = screen.getByRole('img', { name: /Dungeon stone floor/ })
    expect(slot.tagName).toBe('CANVAS')
    // Not focusable, for `Viewer.tsx`'s reason: the sprite sheet beside it is the
    // keyboard-reachable preview and this must not become a second one.
    expect(slot).not.toHaveAttribute('tabindex')
  })

  it('sizes the backing store in device pixels, under the same cap as the shared buffer', () => {
    render(
      <SharedPreview pool={pool} id="floor" label="preview" size={256} pixelRatio={3}>
        <mesh />
      </SharedPreview>,
    )

    const slot = screen.getByRole<HTMLCanvasElement>('img')
    // dpr 3 clamped to 2 — the cap is `frame.ts`'s DPR_BAND, which is also what
    // `<Canvas dpr>` gets, so the copy between the two is 1:1.
    expect(slot.width).toBe(devicePixels(256, 3))
    expect(slot.width).toBe(512)
    expect(slot.style.width).toBe('256px')
    expect(slot.style.height).toBe('256px')
  })

  it('registers itself, with the context whose canvas it is', () => {
    render(
      <SharedPreview pool={pool} id="floor" label="preview" size={288} pixelRatio={2}>
        <mesh />
      </SharedPreview>,
    )

    const [subject] = pool.subjects()
    expect(subject?.id).toBe('floor')
    expect(subject?.width).toBe(288)
    expect(paintable(subject!)).toBe(true)
    // The surface's own canvas is the slot's, at the device size — which is what
    // `presentRect` measures the copy against.
    expect(subject?.surface?.canvas.width).toBe(devicePixels(288, 2))
  })

  it('carries the family’s measured edge through as the occlusion colour', () => {
    render(
      <SharedPreview pool={pool} id="floor" label="preview" occlusion="#3f4450">
        <mesh />
      </SharedPreview>,
    )
    expect(pool.subjects()[0]?.occlusion).toBe('#3f4450')
  })

  it('leaves the pool when it unmounts', () => {
    const view = render(
      <SharedPreview pool={pool} id="floor" label="preview">
        <mesh />
      </SharedPreview>,
    )
    expect(pool.subjects()).toHaveLength(1)

    view.unmount()
    expect(pool.subjects()).toEqual([])
  })

  it('stays registered and unpaintable when the browser refuses a 2D context', () => {
    vi.restoreAllMocks()
    stubPointerCapture()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)

    render(
      <SharedPreview pool={pool} id="floor" label="preview" size={256}>
        <mesh />
      </SharedPreview>,
    )

    const [subject] = pool.subjects()
    expect(subject?.surface).toBe(null)
    expect(subject?.width).toBe(256)
    expect(paintable(subject!)).toBe(false)
  })
})

describe('a grid of slots', () => {
  it('puts N subjects in one pool, and sizes the shared buffer to the largest', () => {
    render(
      <>
        <SharedPreview pool={pool} id="a" label="a" size={256}>
          <mesh />
        </SharedPreview>
        <SharedPreview pool={pool} id="b" label="b" size={256}>
          <mesh />
        </SharedPreview>
        <SharedPreview pool={pool} id="c" label="c" size={288}>
          <mesh />
        </SharedPreview>
      </>,
    )

    expect(pool.subjects().map((subject) => subject.id)).toEqual(['a', 'b', 'c'])
    // One buffer for three subjects. Sixteen live WebGL contexts is the browser's
    // limit; this is the number that stays at one however long the grid is.
    expect(poolSlotSize(pool.subjects())).toEqual({ width: 288, height: 288 })
  })

  it('gives each slot its own id when none is supplied', () => {
    render(
      <>
        <SharedPreview pool={pool} label="a">
          <mesh />
        </SharedPreview>
        <SharedPreview pool={pool} label="b">
          <mesh />
        </SharedPreview>
      </>,
    )
    const ids = pool.subjects().map((subject) => subject.id)
    expect(new Set(ids).size).toBe(2)
  })
})

describe('the host module', () => {
  it('imports, with the whole renderer graph behind it', async () => {
    // Worth a test on its own, and `src/builder/three/room.test.tsx` makes the
    // same case: a module-level failure anywhere in three.js, r3f, drei,
    // `postprocessing` or n8ao — n8ao touching `document` at import time, a
    // renamed export in `Stage.tsx` — would break this feature at runtime with
    // nothing else in the suite noticing. Importing is all this can do: mounting
    // needs `getContext('webgl2')`.
    const module = await import('./SharedStage')
    expect(typeof module.SharedStage).toBe('function')
    expect(module.default).toBe(module.SharedStage)
  })
})

describe('dragging a slot', () => {
  function drag(slot: Element, dx: number, dy: number): void {
    fireEvent.pointerDown(slot, { pointerId: 7, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(slot, { pointerId: 7, clientX: 100 + dx, clientY: 100 + dy })
    fireEvent.pointerUp(slot, { pointerId: 7, clientX: 100 + dx, clientY: 100 + dy })
  }

  it('rotates that subject’s orbit by the drawer’s own formula', () => {
    render(
      <SharedPreview pool={pool} id="floor" label="preview" size={256}>
        <mesh />
      </SharedPreview>,
    )

    drag(screen.getByRole('img'), 64, -12)

    const expected = orbitDrag(DEFAULT_ORBIT, 64, -12, 256)
    expect(pool.subjects()[0]?.orbit.azimuth).toBeCloseTo(expected.azimuth, 12)
    expect(pool.subjects()[0]?.orbit.polar).toBeCloseTo(expected.polar, 12)
  })

  it('marks the subject active for the duration and no longer', () => {
    render(
      <SharedPreview pool={pool} id="floor" label="preview">
        <mesh />
      </SharedPreview>,
    )
    const slot = screen.getByRole('img')

    fireEvent.pointerDown(slot, { pointerId: 7, clientX: 0, clientY: 0 })
    expect(pool.subjects()[0]?.active).toBe(true)

    fireEvent.pointerUp(slot, { pointerId: 7, clientX: 0, clientY: 0 })
    expect(pool.subjects()[0]?.active).toBe(false)
  })

  it('ends the drag on a cancelled pointer as well as a lifted one', () => {
    render(
      <SharedPreview pool={pool} id="floor" label="preview">
        <mesh />
      </SharedPreview>,
    )
    const slot = screen.getByRole('img')

    fireEvent.pointerDown(slot, { pointerId: 7, clientX: 0, clientY: 0 })
    fireEvent.pointerCancel(slot, { pointerId: 7, clientX: 0, clientY: 0 })
    expect(pool.subjects()[0]?.active).toBe(false)
  })

  it('ignores a move from a second pointer mid-drag', () => {
    render(
      <SharedPreview pool={pool} id="floor" label="preview">
        <mesh />
      </SharedPreview>,
    )
    const slot = screen.getByRole('img')

    fireEvent.pointerDown(slot, { pointerId: 7, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(slot, { pointerId: 9, clientX: 500, clientY: 500 })
    expect(pool.subjects()[0]?.orbit).toEqual(DEFAULT_ORBIT)
  })

  it('does nothing on a slot that is not interactive', () => {
    render(
      <SharedPreview pool={pool} id="floor" label="preview" interactive={false}>
        <mesh />
      </SharedPreview>,
    )
    const slot = screen.getByRole('img')
    expect(slot).toHaveAttribute('data-interactive', 'false')

    drag(slot, 90, 40)
    expect(pool.subjects()[0]?.orbit).toEqual(DEFAULT_ORBIT)
    expect(pool.subjects()[0]?.active).toBe(false)
  })
})
