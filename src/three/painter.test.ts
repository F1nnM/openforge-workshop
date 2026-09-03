/**
 * The painter, driven with object literals instead of a GPU.
 *
 * `painter.ts` is the production code the browser runs — not a re-implementation
 * of it — and it is written against structural types so that this file can hand
 * it a fake camera, a fake canvas and a fake post stack and then assert what it
 * did to them.
 *
 * ## What this proves
 *
 *   - **One subject visible per render**, every render, including that the
 *     previously visible one is hidden again.
 *   - The camera is **positioned from the subject's own orbit** and aimed at the
 *     origin, with its world matrix updated before anything renders.
 *   - **Each subject gets its own occlusion colour**, which is what a sequential
 *     paint buys over a room's single frame.
 *   - The frame is **cleared and then copied** with the rectangles `presentRect`
 *     computed, in device pixels off the drawing buffer rather than the canvas's
 *     CSS size.
 *   - A subject with no surface is aimed and rendered but not copied, and
 *     nothing throws.
 *
 * ## What it cannot prove
 *
 * That the copy shows the frame that was just drawn. That is a statement about
 * WebGL drawing-buffer lifetime, and the only place it can be observed is a
 * browser. What is checked here is the *call order* the guarantee depends on:
 * `paintPool` runs `render` and `present` back to back for one subject before it
 * touches the next.
 */
import { describe, expect, it } from 'vitest'

import { createSubjectPainter } from './painter'
import type { PainterGroup } from './painter'
import type { PooledSubject, SubjectSurface } from './subjects'
import { DEFAULT_ORBIT, orbitPosition, paintPool } from './subjects'

/**
 * A stand-in for `Stage.tsx`'s `AO_RADIUS`.
 *
 * Not imported from there: that module pulls three, r3f, drei, `postprocessing`
 * and n8ao, and this suite runs in the Node environment on purpose — the painter
 * needs none of them, and proving that is half the point of `painter.ts`. The
 * real value is asserted against the real constant in `material.test.ts`'s
 * neighbourhood and in `src/builder/three/room.test.tsx`; here it is only a
 * number that has to arrive at `configure` unchanged.
 */
const AO_RADIUS = 0.09

/* ------------------------------------------------------------- test doubles */

interface Recorded {
  readonly calls: string[]
}

function fakeCamera(calls: string[]) {
  return {
    position: {
      set: (x: number, y: number, z: number) =>
        calls.push(`position:${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`),
    },
    lookAt: (x: number, y: number, z: number) => {
      calls.push(`lookAt:${String(x)},${String(y)},${String(z)}`)
    },
    updateMatrixWorld: () => {
      calls.push('updateMatrixWorld')
    },
  }
}

function fakeSurface(calls: string[], width = 256, height = 256): SubjectSurface {
  return {
    canvas: { width, height },
    clearRect: (x, y, w, h) => {
      calls.push(`clear:${String(x)},${String(y)},${String(w)},${String(h)}`)
    },
    drawImage: (_image, sx, sy, sw, sh, dx, dy, dw, dh) => {
      calls.push(
        `draw:${String(sx)},${String(sy)},${String(sw)},${String(sh)}->${String(dx)},${String(dy)},${String(dw)},${String(dh)}`,
      )
    },
  }
}

function subject(id: string, over: Partial<PooledSubject> = {}, calls: string[] = []): PooledSubject {
  return {
    id,
    content: null,
    width: 256,
    height: 256,
    surface: fakeSurface(calls),
    occlusion: null,
    orbit: DEFAULT_ORBIT,
    active: false,
    dirty: true,
    ...over,
  }
}

function harness(
  groups: Map<string, PainterGroup>,
  buffer = { width: 512, height: 512 },
  calls: string[] = [],
) {
  const painter = createSubjectPainter({
    camera: fakeCamera(calls),
    target: {
      // Never dereferenced by the painter: it is handed straight to `drawImage`,
      // which is a fake here.
      source: null as unknown as CanvasImageSource,
      drawingBufferSize: () => buffer,
    },
    post: {
      configure: (occlusion, aoRadius) => {
        calls.push(`configure:${occlusion ?? 'default'}@${String(aoRadius)}`)
      },
      render: () => {
        calls.push('render')
      },
    },
    groups,
    aoRadius: AO_RADIUS,
  })
  return { painter, calls } satisfies { painter: unknown } & Recorded
}

/* -------------------------------------------------------------------- tests */

describe('aiming at a subject', () => {
  it('shows exactly one group and hides the rest, every time', () => {
    const groups = new Map<string, PainterGroup>([
      ['a', { visible: true }],
      ['b', { visible: true }],
      ['c', { visible: true }],
    ])
    const { painter } = harness(groups)

    painter.aim(subject('b'))
    expect([...groups].map(([id, group]) => `${id}:${String(group.visible)}`)).toEqual([
      'a:false',
      'b:true',
      'c:false',
    ])

    // And again, which is the assertion that matters: the previously visible
    // group has to be turned off, not merely left alone.
    painter.aim(subject('c'))
    expect([...groups].map(([id, group]) => `${id}:${String(group.visible)}`)).toEqual([
      'a:false',
      'b:false',
      'c:true',
    ])
  })

  it('refuses a subject whose subtree is not in the scene yet, and touches nothing', () => {
    const { painter, calls } = harness(new Map([['other', { visible: true }]]))

    expect(painter.aim(subject('a'))).toBe(false)
    // Not even the visibility of the other group: a refused aim must leave the
    // scene exactly as the last successful one left it, because that frame is
    // still on screen in somebody's slot.
    expect(calls).toEqual([])
  })

  it('reads the group map live, so a card that mounted later is included', () => {
    const groups = new Map<string, PainterGroup>([['a', { visible: true }]])
    const { painter } = harness(groups)

    groups.set('late', { visible: true })
    expect(painter.aim(subject('a'))).toBe(true)
    expect(groups.get('late')?.visible).toBe(false)
  })

  it('positions the camera from the subject’s own orbit and aims it at the origin', () => {
    const { painter, calls } = harness(new Map([['a', { visible: false }]]))
    const orbit = { azimuth: 1.1, polar: 0.8, distance: 4 }
    painter.aim(subject('a', { orbit }))

    const eye = orbitPosition(orbit)
    expect(calls).toEqual([
      `position:${eye.x.toFixed(4)},${eye.y.toFixed(4)},${eye.z.toFixed(4)}`,
      'lookAt:0,0,0',
      'updateMatrixWorld',
      `configure:default@${String(AO_RADIUS)}`,
    ])
  })

  it('gives each subject its own occlusion colour', () => {
    // The thing a sequential paint buys that a room's single frame cannot have:
    // N8AO has one colour uniform per render, and these are separate renders.
    const { painter, calls } = harness(
      new Map([
        ['a', { visible: false }],
        ['b', { visible: false }],
      ]),
    )
    painter.aim(subject('a', { occlusion: '#3f4450' }))
    painter.aim(subject('b', { occlusion: '#7a5c3a' }))

    expect(calls.filter((call) => call.startsWith('configure:'))).toEqual([
      `configure:#3f4450@${String(AO_RADIUS)}`,
      `configure:#7a5c3a@${String(AO_RADIUS)}`,
    ])
  })
})

describe('presenting a subject', () => {
  it('clears the slot and copies the drawing buffer into it', () => {
    const calls: string[] = []
    const { painter } = harness(new Map(), { width: 512, height: 512 })
    painter.present(subject('a', { surface: fakeSurface(calls, 256, 256) }))

    expect(calls).toEqual(['clear:0,0,256,256', 'draw:0,0,512,512->0,0,256,256'])
  })

  it('measures the source in device pixels, not in the canvas’s CSS size', () => {
    const calls: string[] = []
    const { painter } = harness(new Map(), { width: 576, height: 576 })
    painter.present(subject('a', { surface: fakeSurface(calls, 288, 288) }))

    expect(calls[1]).toBe('draw:0,0,576,576->0,0,288,288')
  })

  it('crops rather than squashes when the slot is a different shape', () => {
    const calls: string[] = []
    const { painter } = harness(new Map(), { width: 800, height: 400 })
    painter.present(subject('a', { surface: fakeSurface(calls, 200, 200) }))

    expect(calls[1]).toBe('draw:200,0,400,400->0,0,200,200')
  })

  it('does nothing for a subject with no surface', () => {
    const { painter, calls } = harness(new Map())
    painter.present(subject('a', { surface: null }))
    expect(calls).toEqual([])
  })

  it('does nothing when the drawing buffer has no area yet', () => {
    const calls: string[] = []
    const { painter } = harness(new Map(), { width: 0, height: 0 })
    painter.present(subject('a', { surface: fakeSurface(calls) }))
    expect(calls).toEqual([])
  })
})

describe('a whole frame through the real painter', () => {
  it('renders and copies one subject before it aims at the next', () => {
    // The ordering the drawing-buffer guarantee rests on, asserted on one
    // interleaved log rather than on two separate ones.
    const groups = new Map<string, PainterGroup>([
      ['a', { visible: false }],
      ['b', { visible: false }],
    ])
    const calls: string[] = []
    const { painter } = harness(groups, { width: 512, height: 512 }, calls)
    const subjects = [
      subject('a', { surface: fakeSurface(calls, 256, 256), occlusion: '#111111' }, calls),
      subject('b', { surface: fakeSurface(calls, 256, 256), occlusion: '#222222' }, calls),
    ]

    const result = paintPool(subjects, painter, () => undefined)

    expect(result.painted).toEqual(['a', 'b'])
    expect(calls.filter((call) => call === 'render' || call.startsWith('draw:'))).toEqual([
      'render',
      'draw:0,0,512,512->0,0,256,256',
      'render',
      'draw:0,0,512,512->0,0,256,256',
    ])
  })
})
