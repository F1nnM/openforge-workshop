/**
 * The shared canvas, as arithmetic and bookkeeping — everything about hosting
 * many subjects on one WebGL context that does not need the context.
 *
 * `SharedStage.tsx` is fourteen lines of three.js around this file. That split
 * is deliberate and it is the only way this row is testable at all: jsdom has no
 * `getContext('webgl2')`, so nothing in CI can render a pixel, but the *decisions*
 * — which subject is painted, in what order, at what size, where the frame is
 * copied to, and where the camera is pointed — are all pure functions and a
 * registry, and those are checked in `subjects.test.ts` against three.js's own
 * `Spherical` and `Vector3`.
 *
 * ## One context, N subjects, and what the browser actually counts
 *
 * `index.ts` records the constraint this row exists for: **r3f calls
 * `renderer.dispose()` on unmount but reclaiming the GPU context is the
 * browser's decision, browsers cap live contexts (~16 in Chrome) and drop the
 * oldest** — so a grid of cards with a `<Canvas>` each does not merely cost a lot,
 * it silently loses the earliest previews as the user scrolls.
 *
 * So: **one `<Canvas>`, one WebGLRenderer, one context, one post stack, one
 * camera.** Each card contributes a subject — a scene subtree, an orbit and a
 * plain 2D `<canvas>` — and the host paints subjects *sequentially* into the
 * shared drawing buffer, copying each finished frame into that card's own canvas
 * with `drawImage`. For N subjects that is **one WebGL context and N 2D
 * contexts**, and 2D contexts are not on the WebGL budget.
 *
 * They are not free either, and the honest cost is memory: a 2D canvas holds
 * `width × height × 4` bytes of backing store, so a 256 px slot at dpr 2 is
 * 512 × 512 × 4 = 1.05 MB. A virtualised grid with twenty cards mounted is
 * therefore ~21 MB of slot canvases, against the ~36 MB `gate.ts` allows one raw
 * mesh. Unmounting a card frees it, which is the property `react-virtuoso`
 * already gives us.
 *
 * ## Why copy the frame out rather than scissor the canvas
 *
 * The alternative — one canvas stretched over the page, each card's rectangle
 * rendered with `setViewport`/`setScissor` (drei's `<View>`) — is the standard
 * answer and it is the wrong one *here*, for two specific reasons:
 *
 *  1. **The AO pass is not scissorable.** `Stage`'s post stack is
 *     `RenderPass → N8AO → SMAA`, and N8AO is a full-screen pass that samples
 *     the depth buffer around each pixel. Two views packed into one buffer
 *     therefore occlude each other across the seam: the top edge of one card
 *     darkens because of the geometry in the card above it. And §9's argument is
 *     that **the AO pass *is* the contour** — the thing that stops a sandstone
 *     tile dissolving into a light ground — so it is not a pass this project can
 *     drop for a grid.
 *  2. **An overlay fights the app it is in.** A single stretched canvas has to
 *     sit above the cards in the stacking order and below the drawer, and it has
 *     to be told about every scroll of a virtualised list. Copying the frame out
 *     leaves each card an ordinary element in ordinary flow.
 *
 * The cost of copying is one `drawImage` per painted subject, GPU-side in every
 * current browser, and one constraint: **the copy has to happen in the same
 * animation-frame callback as the render**, because a WebGL drawing buffer is
 * only guaranteed to hold its contents until the frame is composited. That is
 * why {@link paintPool} renders and presents inside one loop body rather than
 * presenting later from an effect, and why the context does not need
 * `preserveDrawingBuffer` (which would cost a full-buffer copy on every frame).
 *
 * ## Every subject is at the origin, unit radius, and only one is visible
 *
 * `geometry.ts` normalises every model to `VIEW_RADIUS = 1` centred on its
 * bounding box, and `place.ts` does the same for a whole room. So subjects all
 * occupy the same unit sphere at the origin and the host makes exactly one of
 * them visible before each render. That is what lets a shared canvas keep
 * `Stage`'s camera, its lights and its **one tuned AO radius** unchanged: there
 * is no per-subject framing to compute, and `AO_RADIUS` is as correct for a card
 * as it is for the drawer.
 */
import type { ReactNode } from 'react'

import {
  CAMERA_POSITION,
  ORBIT_MAX_DISTANCE,
  ORBIT_MIN_DISTANCE,
  ORBIT_ROTATE_SPEED,
} from './frame'

/* ------------------------------------------------------------------- orbits */

/**
 * A subject's camera, in spherical coordinates about the origin.
 *
 * three's own convention, so it round-trips through `three.Spherical` exactly:
 * `azimuth` is `theta`, measured in the x–z plane from +z toward +x, and `polar`
 * is `phi`, measured down from +y. `subjects.test.ts` asserts the round trip
 * rather than trusting this comment.
 *
 * Spherical rather than a position vector because the *gesture* is angular: a
 * drag adds radians, and a position would have to be converted back and forth
 * and would drift off the sphere as it went.
 */
export interface SubjectOrbit {
  readonly azimuth: number
  readonly polar: number
  readonly distance: number
}

/**
 * How close to the poles the orbit may come, in radians.
 *
 * three's `Spherical.makeSafe()` clamps `phi` to `[EPS, π − EPS]` at exactly this
 * value, and for a reason worth restating: at `phi = 0` the eye is directly above
 * the origin, the view direction is parallel to the camera's up vector, and
 * `lookAt` has no basis to build — the frame flips or goes NaN. Mirrored here
 * rather than imported because this module deliberately imports no three.js.
 */
export const ORBIT_POLE_EPSILON = 0.000001

/** Spherical → Cartesian, three's `Vector3.setFromSpherical`. */
export function orbitPosition(orbit: SubjectOrbit): { x: number; y: number; z: number } {
  const sinPolar = Math.sin(orbit.polar)
  return {
    x: orbit.distance * sinPolar * Math.sin(orbit.azimuth),
    y: orbit.distance * Math.cos(orbit.polar),
    z: orbit.distance * sinPolar * Math.cos(orbit.azimuth),
  }
}

/** Cartesian → spherical, three's `Spherical.setFromCartesianCoords`. */
export function orbitFromPosition(x: number, y: number, z: number): SubjectOrbit {
  const distance = Math.sqrt(x * x + y * y + z * z)
  if (distance === 0) return { azimuth: 0, polar: 0, distance: 0 }
  return {
    azimuth: Math.atan2(x, z),
    polar: Math.acos(Math.min(1, Math.max(-1, y / distance))),
    distance,
  }
}

/** Clamp to the pole band and to `Stage`'s own orbit distances. */
export function clampOrbit(orbit: SubjectOrbit): SubjectOrbit {
  return {
    azimuth: orbit.azimuth,
    polar: Math.min(Math.PI - ORBIT_POLE_EPSILON, Math.max(ORBIT_POLE_EPSILON, orbit.polar)),
    distance: Math.min(ORBIT_MAX_DISTANCE, Math.max(ORBIT_MIN_DISTANCE, orbit.distance)),
  }
}

/**
 * Where a subject starts: `Stage`'s own camera position, in spherical form.
 *
 * Derived from `frame.ts`'s `CAMERA_POSITION` rather than restated, so a card's
 * first frame is the detail drawer's first frame and stays that way if the camera
 * is ever re-tuned.
 */
export const DEFAULT_ORBIT: SubjectOrbit = clampOrbit(
  orbitFromPosition(...(CAMERA_POSITION as [number, number, number])),
)

/**
 * A drag, in CSS pixels, applied to an orbit.
 *
 * The mapping is `OrbitControls`' own, transcribed from
 * `three/examples/jsm/controls/OrbitControls.js`: `theta -= 2π · dx · speed / h`,
 * `phi -= 2π · dy · speed / h`, **both divided by the element's height** — the
 * upstream comment on that line reads `// yes, height`, and the reason is that
 * dividing x by the width would make the same gesture rotate at two speeds on a
 * non-square element. So a drag across a card feels like a drag across the
 * drawer, because it is the same formula at the same {@link ORBIT_ROTATE_SPEED}.
 *
 * What is deliberately *not* here is damping. drei's `OrbitControls` runs an
 * inertial decay that needs a frame loop per control; a grid of previews would
 * mean N decaying controls all asking for frames. A card's drag ends when the
 * pointer lifts.
 */
export function orbitDrag(orbit: SubjectOrbit, dx: number, dy: number, height: number): SubjectOrbit {
  if (height <= 0) return orbit
  const scale = (2 * Math.PI * ORBIT_ROTATE_SPEED) / height
  return clampOrbit({
    azimuth: orbit.azimuth - dx * scale,
    polar: orbit.polar - dy * scale,
    distance: orbit.distance,
  })
}

/* ------------------------------------------------------------------ subjects */

export type SubjectId = string

/**
 * The 2D surface a subject's frame is copied into.
 *
 * Narrowed to the three members {@link paintPool} touches, rather than typed as
 * `CanvasRenderingContext2D`. Two reasons: it says exactly what this module is
 * allowed to do to a caller's canvas, and it makes the test double three lines
 * instead of a mock of the whole 2D API.
 */
export interface SubjectSurface {
  readonly canvas: { readonly width: number; readonly height: number }
  clearRect(x: number, y: number, width: number, height: number): void
  drawImage(
    image: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void
}

/** What a card registers. */
export interface SubjectEntry {
  readonly id: SubjectId
  /** The subject's own scene subtree, hoisted into the shared canvas by the host. */
  readonly content: ReactNode
  /** Slot size in CSS pixels. The host's drawing buffer is sized from the largest. */
  readonly width: number
  readonly height: number
  /** `null` until the slot's canvas is mounted, or if the browser refused a 2D context. */
  readonly surface: SubjectSurface | null
  /** The family's measured `edge`, or `null` for N8AO's black. One per subject. */
  readonly occlusion: string | null
  readonly orbit: SubjectOrbit
  /** Painted first: the subject the pointer is on. At most one is, in practice. */
  readonly active: boolean
}

/** A registered subject, plus whether it owes a frame. */
export interface PooledSubject extends SubjectEntry {
  readonly dirty: boolean
}

/** Fields a card may change after registering. */
export type SubjectPatch = Partial<Omit<SubjectEntry, 'id'>>

/**
 * Subjects painted in one animation frame. **A budget, not a measurement.**
 *
 * Each painted subject costs a full `RenderPass → N8AO → SMAA` at the shared
 * buffer's size, so a grid that mounts twenty cards at once would otherwise do
 * twenty of them inside one callback and drop a visible number of frames. Four
 * spreads that over five frames instead. Nothing in CI can time a GPU, so this
 * number is a deliberate cap rather than something measured — it is the knob to
 * turn if a grid hitches, and {@link paintPool} reports how many it deferred so
 * the host can ask for another frame.
 */
export const SUBJECTS_PER_FRAME = 4

/**
 * Largest slot the shared buffer will be sized to, in CSS pixels.
 *
 * The buffer is allocated once for the whole pool and the AO pass costs per
 * pixel of it, so one oversized subject would make every other subject pay. Both
 * real callers are far below this: the detail well is 288 px and a catalog card's
 * thumb is 256 px. A slot larger than the cap is still drawn — it is presented
 * upscaled, which is a soft failure rather than a missing preview.
 */
export const MAX_SLOT_PX = 1536

/**
 * The CSS size the host element takes: the largest slot in the pool.
 *
 * One buffer for every subject, rather than a resize per subject: resizing an
 * `EffectComposer` reallocates four render targets and every subject would pay
 * that on every frame. Subjects smaller than the buffer are presented scaled
 * down, which is supersampling and looks better rather than worse.
 *
 * An empty pool still needs a size, because a zero-sized element gives r3f a
 * zero-sized drawing buffer and some drivers refuse to create the context at all.
 */
export function poolSlotSize(
  subjects: readonly PooledSubject[],
): { readonly width: number; readonly height: number } {
  let width = 1
  let height = 1
  for (const subject of subjects) {
    if (subject.width > width) width = subject.width
    if (subject.height > height) height = subject.height
  }
  return { width: Math.min(MAX_SLOT_PX, Math.ceil(width)), height: Math.min(MAX_SLOT_PX, Math.ceil(height)) }
}

/**
 * The `drawImage` rectangles for copying a frame into a slot: an aspect-preserving
 * **cover**.
 *
 * The shared buffer is one size and slots may be several, so a straight
 * nine-argument copy of the whole buffer into a differently-shaped slot would
 * squash the tile. Cover instead — crop the long axis of the source, fill the
 * destination — because every subject is framed with slack (`CAMERA_DISTANCE` is
 * 3.0 where fitting the bounding sphere would need 3.49), so the crop takes empty
 * background and never the model. A grid of equal-sized cards hits the exact case
 * and crops nothing.
 *
 * Returns `null` when either surface has no area, which is the state of a slot
 * that has been mounted but not yet laid out.
 */
export interface PresentRect {
  readonly sx: number
  readonly sy: number
  readonly sw: number
  readonly sh: number
  readonly dx: number
  readonly dy: number
  readonly dw: number
  readonly dh: number
}

export function presentRect(
  source: { readonly width: number; readonly height: number },
  destination: { readonly width: number; readonly height: number },
): PresentRect | null {
  if (source.width <= 0 || source.height <= 0) return null
  if (destination.width <= 0 || destination.height <= 0) return null

  const sourceAspect = source.width / source.height
  const destinationAspect = destination.width / destination.height

  // Crop whichever source axis is proportionally longer than the destination's.
  const sw = sourceAspect > destinationAspect ? source.height * destinationAspect : source.width
  const sh = sourceAspect > destinationAspect ? source.height : source.width / destinationAspect

  return {
    sx: (source.width - sw) / 2,
    sy: (source.height - sh) / 2,
    sw,
    sh,
    dx: 0,
    dy: 0,
    dw: destination.width,
    dh: destination.height,
  }
}

/* --------------------------------------------------------------------- pool */

/**
 * The registry the host renders from and the cards write to.
 *
 * A hand-rolled store rather than zustand, for one reason that matters: this
 * module is imported by `SharedPreview.tsx`, which is on the **eager** side of
 * the lazy boundary (a card can render its slot before the renderer chunk has
 * arrived, and must not pull three.js to do it). So it imports React types only,
 * and `boundary.test.ts` asserts that.
 *
 * {@link subjects} returns a snapshot that is referentially stable between
 * mutations, which is what `useSyncExternalStore` requires — returning a fresh
 * array each call makes React re-render forever.
 */
export interface SubjectPool {
  /** Add a subject. Returns its unregister function. */
  readonly register: (entry: SubjectEntry) => () => void
  /** Change some fields. Anything visual marks the subject dirty. */
  readonly update: (id: SubjectId, patch: SubjectPatch) => void
  /** Ask for a repaint of one subject. */
  readonly invalidate: (id: SubjectId) => void
  /** Ask for a repaint of every subject — a resize, or a theme change. */
  readonly invalidateAll: () => void
  /**
   * The current subjects, as an array whose identity changes only when something
   * about them does.
   *
   * Declared as properties rather than methods so `pool.subscribe` and
   * `pool.subjects` can be handed straight to `useSyncExternalStore` — a method
   * type would make that an unbound-method lint error, and wrapping each in an
   * arrow at the call site would hand React a new function on every render,
   * which is a resubscribe per render.
   */
  readonly subjects: () => readonly PooledSubject[]
  readonly subscribe: (listener: () => void) => () => void
  /** Paint up to `limit` dirty subjects through `painter`. */
  readonly paint: (painter: SubjectPainter, limit?: number) => PaintResult
}

/**
 * What the host does with one subject, in the order {@link paintPool} calls it.
 *
 * Three methods, and the interface exists so the loop can be tested without a
 * GPU: `SharedStage.tsx` implements it against three.js, `subjects.test.ts`
 * implements it as a recorder, and the assertions are then about the call
 * sequence — which is the honest thing to assert in jsdom.
 */
export interface SubjectPainter {
  /**
   * Make this subject the only visible one and point the shared camera at it.
   *
   * Returns `false` when the subject's scene subtree is not in the scene yet —
   * a real race, and one whose consequence is permanent: a card registers itself
   * from an effect, and the host mounts the matching subtree on the render that
   * registration triggers. Frames come from `requestAnimationFrame`, which
   * normally lands after React has committed, but nothing guarantees it. Painting
   * anyway would copy out an empty frame and mark the subject clean, leaving a
   * blank preview that nothing ever repaints. So a subject that could not be
   * aimed is deferred instead, which costs one frame.
   */
  aim(subject: PooledSubject): boolean
  /** Render the shared scene through the post stack. */
  render(subject: PooledSubject): void
  /** Copy the finished frame into the subject's own canvas. */
  present(subject: PooledSubject): void
}

export interface PaintResult {
  readonly painted: readonly SubjectId[]
  /**
   * Paintable subjects still dirty at the end of the frame — the budget ran out,
   * or their subtree was not in the scene yet.
   *
   * The host asks for another frame when this is above zero. It deliberately
   * does **not** count a subject with no surface or no area: those stay dirty
   * until something changes, and counting them would spin `frameloop="demand"`
   * at 60 fps forever over a slot that cannot be drawn.
   */
  readonly deferred: number
}

/** Whether a subject can be drawn at all right now. */
export function paintable(subject: PooledSubject): boolean {
  return subject.surface !== null && subject.width > 0 && subject.height > 0
}

/**
 * Paint order: the active subject, then registration order.
 *
 * The card under the pointer is the one whose frames a person can see arriving,
 * so it goes first and the budget can only ever delay the others.
 */
export function paintOrder(subjects: readonly PooledSubject[]): readonly PooledSubject[] {
  const dirty = subjects.filter((subject) => subject.dirty)
  return [...dirty.filter((subject) => subject.active), ...dirty.filter((subject) => !subject.active)]
}

/**
 * One frame: aim, render and present each dirty subject in turn.
 *
 * Separate from the pool so it can be called with a recorder. Clearing the dirty
 * flag is the pool's job and happens through the `clear` callback, which is how
 * a subject that cannot be painted still stops asking — see
 * {@link PaintResult.deferred}.
 */
export function paintPool(
  subjects: readonly PooledSubject[],
  painter: SubjectPainter,
  clear: (id: SubjectId) => void,
  limit: number = SUBJECTS_PER_FRAME,
): PaintResult {
  const painted: SubjectId[] = []
  let deferred = 0

  for (const subject of paintOrder(subjects)) {
    if (!paintable(subject)) continue
    if (painted.length >= limit) {
      deferred += 1
      continue
    }
    if (!painter.aim(subject)) {
      // Still dirty, and worth another frame — see `SubjectPainter.aim`.
      deferred += 1
      continue
    }
    painter.render(subject)
    painter.present(subject)
    clear(subject.id)
    painted.push(subject.id)
  }

  return { painted, deferred }
}

/** A pool. One per host; the app has one host. */
export function createSubjectPool(): SubjectPool {
  const entries = new Map<SubjectId, PooledSubject>()
  const listeners = new Set<() => void>()
  let snapshot: readonly PooledSubject[] = []
  // Set while a frame is painting. Clearing four dirty flags is one change to
  // the outside world, not four: without this the host re-renders once per
  // painted subject, which is up to four React passes inside one animation
  // frame while somebody is dragging a card.
  let batching = false
  let pending = false

  const publish = () => {
    if (batching) {
      pending = true
      return
    }
    snapshot = [...entries.values()]
    for (const listener of listeners) listener()
  }

  const mark = (id: SubjectId, dirty: boolean) => {
    const entry = entries.get(id)
    if (entry === undefined || entry.dirty === dirty) return
    entries.set(id, { ...entry, dirty })
    publish()
  }

  return {
    register: (entry) => {
      entries.set(entry.id, { ...entry, dirty: true })
      publish()
      return () => {
        if (!entries.delete(entry.id)) return
        publish()
      }
    },

    update: (id, patch) => {
      const entry = entries.get(id)
      if (entry === undefined) return
      // `active` alone does not change a pixel, so it does not force a repaint —
      // it only changes the order the next one happens in.
      const visual = Object.keys(patch).some((key) => key !== 'active')
      entries.set(id, { ...entry, ...patch, dirty: entry.dirty || visual })
      publish()
    },

    invalidate: (id) => {
      mark(id, true)
    },

    invalidateAll: () => {
      let changed = false
      for (const [id, entry] of entries) {
        if (entry.dirty) continue
        entries.set(id, { ...entry, dirty: true })
        changed = true
      }
      if (changed) publish()
    },

    subjects: () => snapshot,

    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    paint: (painter, limit) => {
      batching = true
      pending = false
      try {
        return paintPool(
          snapshot,
          painter,
          (id) => {
            mark(id, false)
          },
          limit,
        )
      } finally {
        batching = false
        if (pending) publish()
      }
    },
  }
}
