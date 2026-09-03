/**
 * What the shared canvas does to one subject, written against **structural
 * types** so it can be run without a renderer.
 *
 * `SharedStage.tsx` supplies the real things — r3f's camera, the WebGL canvas,
 * `Stage.tsx`'s composer — and every one of them satisfies one of the small
 * interfaces below. Nothing here imports three.js, so `painter.test.ts` can
 * drive the exact code the browser runs with four object literals, and assert
 * the order it does things in.
 *
 * That order is the content of this module, and each step is here for a reason
 * that has bitten somebody:
 *
 *  1. **One subject visible.** Subjects are all normalised to the same unit
 *     sphere at the origin, so they sit on top of each other. Aiming at one means
 *     hiding the rest — every frame, because the previous frame hid a different
 *     set. A subject whose subtree is not in the scene yet is refused rather than
 *     rendered blank; `SubjectPainter.aim` says why that matters.
 *  2. **Move the camera, do not swap it.** N cameras is the obvious shape and it
 *     is a trap: `postprocessing`'s `Pass.mainCamera` setter is a no-op on the
 *     base class and `n8ao`'s pass does not override it, so
 *     `composer.setMainCamera(…)` never reaches the AO pass and every subject
 *     after the first would be occluded from the first one's viewpoint.
 *  3. **`updateMatrixWorld` before rendering.** The renderer would do it, but the
 *     AO pass reads `matrixWorldInverse`, so the ordering is made explicit rather
 *     than inherited from whichever pass happens to run first.
 *  4. **Clear the slot, then copy.** The frame has a transparent background — the
 *     card's own parchment ground shows through, which is what the AO contour is
 *     tuned against — and `drawImage` composites. Without the clear, the previous
 *     frame shows through the gaps in this one.
 *  5. **Copy immediately.** A WebGL drawing buffer is only guaranteed to hold its
 *     contents until the frame is composited, so `present` must run in the same
 *     animation-frame callback as `render`. `paintPool` calls them back to back
 *     for exactly this reason; the alternative is `preserveDrawingBuffer: true`,
 *     which costs a full-buffer copy on every frame of every subject.
 */
import type { PooledSubject, SubjectId, SubjectPainter } from './subjects'
import { orbitPosition, presentRect } from './subjects'

/** Enough of a `PerspectiveCamera` to aim it. */
export interface PainterCamera {
  readonly position: { set(x: number, y: number, z: number): unknown }
  lookAt(x: number, y: number, z: number): void
  updateMatrixWorld(): void
}

/** Enough of the shared WebGL canvas to copy out of it. */
export interface PainterTarget {
  /** The canvas itself, as `drawImage` wants it. */
  readonly source: CanvasImageSource
  /** Its drawing-buffer size in device pixels — not its CSS size. */
  drawingBufferSize(): { readonly width: number; readonly height: number }
}

/** Enough of `Stage.tsx`'s post stack to point it and run it. */
export interface PainterPost {
  readonly configure: (occlusion: string | undefined, aoRadius: number) => void
  readonly render: () => void
}

/** A subject's scene subtree, from the painter's point of view. */
export interface PainterGroup {
  visible: boolean
}

export interface PainterDeps {
  readonly camera: PainterCamera
  readonly target: PainterTarget
  readonly post: PainterPost
  /**
   * The subtrees, by subject id. **Read live**: the host mutates this map as
   * cards mount and unmount, so the painter must not copy it.
   */
  readonly groups: ReadonlyMap<SubjectId, PainterGroup>
  readonly aoRadius: number
}

export function createSubjectPainter(deps: PainterDeps): SubjectPainter {
  const { camera, target, post, groups, aoRadius } = deps

  return {
    aim: (subject: PooledSubject) => {
      // The subtree has to be in the scene before there is anything to aim at.
      // See `SubjectPainter.aim`: the alternative is a blank preview that never
      // repaints.
      if (!groups.has(subject.id)) return false

      for (const [id, group] of groups) group.visible = id === subject.id

      const eye = orbitPosition(subject.orbit)
      camera.position.set(eye.x, eye.y, eye.z)
      camera.lookAt(0, 0, 0)
      camera.updateMatrixWorld()

      post.configure(subject.occlusion ?? undefined, aoRadius)
      return true
    },

    render: () => {
      post.render()
    },

    present: (subject: PooledSubject) => {
      const surface = subject.surface
      if (surface === null) return

      const rect = presentRect(target.drawingBufferSize(), surface.canvas)
      if (rect === null) return

      surface.clearRect(0, 0, surface.canvas.width, surface.canvas.height)
      surface.drawImage(
        target.source,
        rect.sx,
        rect.sy,
        rect.sw,
        rect.sh,
        rect.dx,
        rect.dy,
        rect.dw,
        rect.dh,
      )
    },
  }
}
