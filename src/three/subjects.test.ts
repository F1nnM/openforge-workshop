/**
 * The shared canvas's decisions, checked against three.js's own arithmetic.
 *
 * ## What this file proves
 *
 *   - The per-subject orbit **is** three's spherical coordinate system, not
 *     something adjacent to it: every conversion is asserted against
 *     `three.Spherical` and `three.Vector3`, and the pole clamp against
 *     `Spherical.makeSafe()`. `subjects.ts` deliberately imports no three.js, so
 *     this is where the two are put side by side.
 *   - A slot's default view is **`Stage`'s camera position**, to twelve decimal
 *     places, in both directions.
 *   - A drag rotates by exactly what `OrbitControls` would rotate by, so the
 *     gesture on a card and the gesture in the drawer are the same gesture.
 *   - **One painter serves N subjects.** The loop calls `aim → render → present`
 *     once per dirty subject through a single painter, in a deliberate order,
 *     under a per-frame budget, and it never spins on a subject it cannot draw.
 *
 * ## What it cannot prove
 *
 * That one WebGL context was created. jsdom has no `getContext('webgl2')`, so
 * `SharedStage.tsx` — the fourteen lines that turn this bookkeeping into pixels —
 * is not mounted anywhere in CI. What is checked here is the **call sequence** a
 * renderer would receive: that the painter is one object, that it is handed one
 * subject at a time, and that the copy of each finished frame happens
 * immediately after that subject's render rather than later. Whether the frame
 * looks right is a browser question.
 */
import { describe, expect, it, vi } from 'vitest'
import { Spherical, Vector3 } from 'three'

import { CAMERA_DISTANCE, CAMERA_POSITION, ORBIT_MAX_DISTANCE, ORBIT_MIN_DISTANCE, ORBIT_ROTATE_SPEED } from './frame'
import type { PooledSubject, SubjectEntry, SubjectOrbit, SubjectPainter, SubjectSurface } from './subjects'
import {
  DEFAULT_ORBIT,
  MAX_SLOT_PX,
  ORBIT_POLE_EPSILON,
  SUBJECTS_PER_FRAME,
  clampOrbit,
  createSubjectPool,
  orbitDrag,
  orbitFromPosition,
  orbitPosition,
  paintOrder,
  paintable,
  poolSlotSize,
  presentRect,
} from './subjects'

/* ------------------------------------------------------------------- orbits */

const ORBITS: SubjectOrbit[] = [
  DEFAULT_ORBIT,
  { azimuth: 0, polar: Math.PI / 2, distance: 3 },
  { azimuth: -2.4, polar: 0.3, distance: 1.5 },
  { azimuth: 2.9, polar: Math.PI - 0.05, distance: 8.75 },
]

describe('the orbit is three’s spherical system', () => {
  it('converts to a position exactly as Vector3.setFromSpherical does', () => {
    for (const orbit of ORBITS) {
      const expected = new Vector3().setFromSpherical(
        new Spherical(orbit.distance, orbit.polar, orbit.azimuth),
      )
      const actual = orbitPosition(orbit)

      expect(actual.x).toBeCloseTo(expected.x, 12)
      expect(actual.y).toBeCloseTo(expected.y, 12)
      expect(actual.z).toBeCloseTo(expected.z, 12)
    }
  })

  it('reads a position back exactly as Spherical.setFromVector3 does', () => {
    for (const orbit of ORBITS) {
      const position = orbitPosition(orbit)
      const expected = new Spherical().setFromVector3(
        new Vector3(position.x, position.y, position.z),
      )
      const actual = orbitFromPosition(position.x, position.y, position.z)

      expect(actual.distance).toBeCloseTo(expected.radius, 12)
      expect(actual.polar).toBeCloseTo(expected.phi, 12)
      expect(actual.azimuth).toBeCloseTo(expected.theta, 12)
    }
  })

  it('gives the origin three’s own degenerate answer rather than a NaN', () => {
    const expected = new Spherical().setFromVector3(new Vector3())
    const actual = orbitFromPosition(0, 0, 0)
    expect([actual.distance, actual.polar, actual.azimuth]).toEqual([
      expected.radius,
      expected.phi,
      expected.theta,
    ])
  })

  it('clamps the poles to the same epsilon Spherical.makeSafe uses', () => {
    expect(clampOrbit({ azimuth: 0, polar: -5, distance: 3 }).polar).toBe(
      new Spherical(3, -5, 0).makeSafe().phi,
    )
    expect(clampOrbit({ azimuth: 0, polar: 99, distance: 3 }).polar).toBe(
      new Spherical(3, 99, 0).makeSafe().phi,
    )
    expect(ORBIT_POLE_EPSILON).toBe(new Spherical(1, -1, 0).makeSafe().phi)
  })

  it('clamps the distance to Stage’s own orbit band', () => {
    expect(clampOrbit({ azimuth: 0, polar: 1, distance: 0.01 }).distance).toBe(ORBIT_MIN_DISTANCE)
    expect(clampOrbit({ azimuth: 0, polar: 1, distance: 1000 }).distance).toBe(ORBIT_MAX_DISTANCE)
  })
})

describe('the default view', () => {
  it('is Stage’s camera position, in both directions', () => {
    const position = orbitPosition(DEFAULT_ORBIT)
    expect(position.x).toBeCloseTo(CAMERA_POSITION[0], 12)
    expect(position.y).toBeCloseTo(CAMERA_POSITION[1], 12)
    expect(position.z).toBeCloseTo(CAMERA_POSITION[2], 12)
  })

  it('sits at the camera distance, which is what makes that offset a direction', () => {
    // `frame.ts` claims the start position is a unit direction "to within
    // 2 × 10⁻⁴". Asserted, because the claim is what lets a shared-canvas slot
    // reuse `CAMERA_DISTANCE` as its orbit radius.
    expect(Math.abs(DEFAULT_ORBIT.distance / CAMERA_DISTANCE - 1)).toBeLessThan(2.1e-4)
    expect(DEFAULT_ORBIT.distance).toBeGreaterThan(ORBIT_MIN_DISTANCE)
    expect(DEFAULT_ORBIT.distance).toBeLessThan(ORBIT_MAX_DISTANCE)
  })
})

describe('a drag', () => {
  it('rotates by OrbitControls’ own formula: 2π · delta · speed / height', () => {
    const dragged = orbitDrag(DEFAULT_ORBIT, 100, -40, 256)
    const scale = (2 * Math.PI * ORBIT_ROTATE_SPEED) / 256

    expect(dragged.azimuth).toBeCloseTo(DEFAULT_ORBIT.azimuth - 100 * scale, 12)
    expect(dragged.polar).toBeCloseTo(DEFAULT_ORBIT.polar + 40 * scale, 12)
    expect(dragged.distance).toBe(DEFAULT_ORBIT.distance)
  })

  it('divides the horizontal drag by the height too — “yes, height”', () => {
    // Upstream's own comment on that line. Dividing x by the width would make
    // one gesture rotate at two speeds on a non-square slot.
    const wide = orbitDrag(DEFAULT_ORBIT, 50, 0, 200)
    const tall = orbitDrag(DEFAULT_ORBIT, 50, 0, 200)
    expect(wide.azimuth).toBe(tall.azimuth)
    expect(orbitDrag(DEFAULT_ORBIT, 50, 0, 400).azimuth).toBeCloseTo(
      DEFAULT_ORBIT.azimuth - (2 * Math.PI * ORBIT_ROTATE_SPEED * 50) / 400,
      12,
    )
  })

  it('cannot be dragged over the pole', () => {
    const overhead = orbitDrag(DEFAULT_ORBIT, 0, 10_000, 256)
    expect(overhead.polar).toBe(ORBIT_POLE_EPSILON)
    const underneath = orbitDrag(DEFAULT_ORBIT, 0, -10_000, 256)
    expect(underneath.polar).toBeCloseTo(Math.PI - ORBIT_POLE_EPSILON, 12)
  })

  it('ignores a drag on a slot with no height', () => {
    expect(orbitDrag(DEFAULT_ORBIT, 20, 20, 0)).toBe(DEFAULT_ORBIT)
  })
})

/* --------------------------------------------------------------- the buffer */

describe('poolSlotSize', () => {
  it('gives an empty pool a size, because a zero-sized buffer has no context', () => {
    expect(poolSlotSize([])).toEqual({ width: 1, height: 1 })
  })

  it('takes the largest slot in each axis, rounded up', () => {
    const subjects = [pooled('a', { width: 256, height: 200 }), pooled('b', { width: 120, height: 288.4 })]
    expect(poolSlotSize(subjects)).toEqual({ width: 256, height: 289 })
  })

  it('caps a runaway slot, so one subject cannot make the others pay', () => {
    expect(poolSlotSize([pooled('a', { width: 9000, height: 9000 })])).toEqual({
      width: MAX_SLOT_PX,
      height: MAX_SLOT_PX,
    })
  })
})

describe('presentRect', () => {
  it('copies the whole frame when the aspects agree', () => {
    expect(presentRect({ width: 512, height: 512 }, { width: 256, height: 256 })).toEqual({
      sx: 0,
      sy: 0,
      sw: 512,
      sh: 512,
      dx: 0,
      dy: 0,
      dw: 256,
      dh: 256,
    })
  })

  it('crops the long axis of a wider source, centred', () => {
    const rect = presentRect({ width: 800, height: 400 }, { width: 200, height: 200 })
    expect(rect).toEqual({ sx: 200, sy: 0, sw: 400, sh: 400, dx: 0, dy: 0, dw: 200, dh: 200 })
  })

  it('crops the long axis of a taller source, centred', () => {
    const rect = presentRect({ width: 400, height: 800 }, { width: 200, height: 200 })
    expect(rect).toEqual({ sx: 0, sy: 200, sw: 400, sh: 400, dx: 0, dy: 0, dw: 200, dh: 200 })
  })

  it('refuses a surface with no area, which is a slot that is not laid out yet', () => {
    expect(presentRect({ width: 0, height: 512 }, { width: 256, height: 256 })).toBe(null)
    expect(presentRect({ width: 512, height: 512 }, { width: 256, height: 0 })).toBe(null)
  })
})

/* ----------------------------------------------------------------- the pool */

describe('one painter, N subjects', () => {
  it('paints every registered subject through a single painter', () => {
    const pool = createSubjectPool()
    const painter = recorder()
    for (const id of ['a', 'b', 'c']) pool.register(entry(id))

    const result = pool.paint(painter, 10)

    expect(result.painted).toEqual(['a', 'b', 'c'])
    expect(result.deferred).toBe(0)
    // The sequence a renderer would see: one subject aimed, rendered and copied
    // out before the next one is aimed. The copy has to sit between two renders
    // rather than after all of them, because a drawing buffer is only valid
    // until the frame is composited.
    expect(painter.calls).toEqual([
      'aim:a',
      'render:a',
      'present:a',
      'aim:b',
      'render:b',
      'present:b',
      'aim:c',
      'render:c',
      'present:c',
    ])
  })

  it('paints nothing on a second pass, because nothing is dirty', () => {
    const pool = createSubjectPool()
    const painter = recorder()
    pool.register(entry('a'))

    expect(pool.paint(painter).painted).toEqual(['a'])
    expect(pool.paint(painter).painted).toEqual([])
    expect(painter.calls).toHaveLength(3)
  })

  it('repaints a subject whose orbit changed, and only that one', () => {
    const pool = createSubjectPool()
    const painter = recorder()
    pool.register(entry('a'))
    pool.register(entry('b'))
    pool.paint(painter)

    pool.update('b', { orbit: { azimuth: 1, polar: 1, distance: 3 } })
    expect(pool.paint(painter).painted).toEqual(['b'])
  })

  it('does not repaint for `active`, which changes an order rather than a pixel', () => {
    const pool = createSubjectPool()
    const painter = recorder()
    pool.register(entry('a'))
    pool.paint(painter)

    pool.update('a', { active: true })
    expect(pool.paint(painter).painted).toEqual([])
  })

  it('paints the subject under the pointer first', () => {
    const pool = createSubjectPool()
    const painter = recorder()
    for (const id of ['a', 'b', 'c']) pool.register(entry(id))
    pool.update('c', { active: true })

    expect(pool.paint(painter, 10).painted).toEqual(['c', 'a', 'b'])
  })

  it('spends the frame budget and asks for another frame', () => {
    const pool = createSubjectPool()
    const painter = recorder()
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) pool.register(entry(id))

    const first = pool.paint(painter)
    expect(first.painted).toHaveLength(SUBJECTS_PER_FRAME)
    expect(first.deferred).toBe(6 - SUBJECTS_PER_FRAME)

    const second = pool.paint(painter)
    expect(second.painted).toHaveLength(6 - SUBJECTS_PER_FRAME)
    expect(second.deferred).toBe(0)
  })

  it('never asks for a frame for a subject it cannot draw', () => {
    // The infinite-loop guard. A slot with no 2D context or no layout stays
    // dirty, and counting it as deferred would drive `frameloop="demand"` at
    // 60 fps forever over a canvas that can never be painted.
    const pool = createSubjectPool()
    const painter = recorder()
    pool.register({ ...entry('none'), surface: null })
    pool.register({ ...entry('unlaid'), width: 0, height: 0 })

    const result = pool.paint(painter)
    expect(result.painted).toEqual([])
    expect(result.deferred).toBe(0)
    expect(painter.calls).toEqual([])
  })

  it('defers a subject the painter cannot aim, and leaves it dirty', () => {
    // The race `SubjectPainter.aim` documents: a card registers from an effect
    // and the host mounts the subtree on the render that registration triggers,
    // so one frame can arrive in between. Painting it would copy out an empty
    // frame and mark it clean — a blank preview forever.
    const pool = createSubjectPool()
    const refusing = recorder(false)
    pool.register(entry('a'))

    const first = pool.paint(refusing)
    expect(first.painted).toEqual([])
    expect(first.deferred).toBe(1)
    expect(refusing.calls).toEqual(['aim:a'])

    // Still dirty, so the next frame paints it.
    const accepting = recorder()
    expect(pool.paint(accepting).painted).toEqual(['a'])
  })

  it('drops a subject on unregister', () => {
    const pool = createSubjectPool()
    const painter = recorder()
    const remove = pool.register(entry('a'))
    remove()

    expect(pool.subjects()).toEqual([])
    expect(pool.paint(painter).painted).toEqual([])
  })
})

describe('the store contract useSyncExternalStore needs', () => {
  it('returns the same snapshot until something changes', () => {
    const pool = createSubjectPool()
    pool.register(entry('a'))
    const first = pool.subjects()
    expect(pool.subjects()).toBe(first)

    pool.update('a', { occlusion: '#123456' })
    expect(pool.subjects()).not.toBe(first)
  })

  it('notifies once per frame rather than once per painted subject', () => {
    // Four dirty flags cleared is one change to the outside world. Without the
    // batch the host re-renders up to four times inside one animation frame,
    // every frame somebody is dragging a card.
    const pool = createSubjectPool()
    for (const id of ['a', 'b', 'c', 'd']) pool.register(entry(id))

    const listener = vi.fn()
    const unsubscribe = pool.subscribe(listener)
    pool.paint(recorder())
    unsubscribe()

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('notifies on register, update and unregister', () => {
    const pool = createSubjectPool()
    const listener = vi.fn()
    pool.subscribe(listener)

    const remove = pool.register(entry('a'))
    pool.update('a', { occlusion: '#000000' })
    remove()

    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('ignores an update or an invalidation for a subject that has gone', () => {
    const pool = createSubjectPool()
    pool.update('gone', { active: true })
    pool.invalidate('gone')
    expect(pool.subjects()).toEqual([])
  })

  it('marks everything dirty again on demand', () => {
    const pool = createSubjectPool()
    const painter = recorder()
    pool.register(entry('a'))
    pool.register(entry('b'))
    pool.paint(painter)

    pool.invalidateAll()
    expect(pool.paint(painter).painted).toEqual(['a', 'b'])
  })
})

describe('paintOrder and paintable', () => {
  it('lists only dirty subjects', () => {
    const subjects = [pooled('a', { dirty: false }), pooled('b', {}), pooled('c', {})]
    expect(paintOrder(subjects).map((subject) => subject.id)).toEqual(['b', 'c'])
  })

  it('calls a subject unpaintable when it has no surface or no area', () => {
    expect(paintable(pooled('a', {}))).toBe(true)
    expect(paintable(pooled('a', { surface: null }))).toBe(false)
    expect(paintable(pooled('a', { width: 0 }))).toBe(false)
    expect(paintable(pooled('a', { height: 0 }))).toBe(false)
  })
})

/* --------------------------------------------------------------- test doubles */

/** A 2D surface that records what was asked of it, in three lines. */
function fakeSurface(width = 512, height = 512): SubjectSurface {
  return {
    canvas: { width, height },
    clearRect: () => undefined,
    drawImage: () => undefined,
  }
}

function entry(id: string): SubjectEntry {
  return {
    id,
    content: null,
    width: 256,
    height: 256,
    surface: fakeSurface(),
    occlusion: null,
    orbit: DEFAULT_ORBIT,
    active: false,
  }
}

function pooled(id: string, over: Partial<PooledSubject>): PooledSubject {
  return { ...entry(id), dirty: true, ...over }
}

interface Recorder extends SubjectPainter {
  readonly calls: string[]
}

function recorder(aimable = true): Recorder {
  const calls: string[] = []
  return {
    calls,
    aim: (subject) => {
      calls.push(`aim:${subject.id}`)
      return aimable
    },
    render: (subject) => {
      calls.push(`render:${subject.id}`)
    },
    present: (subject) => {
      calls.push(`present:${subject.id}`)
    },
  }
}
