/**
 * One card's preview: a plain `<canvas>`, a subject registration, and a drag.
 *
 * ```tsx
 * <SharedPreview pool={pool} id={record.id} label={`3D preview of ${record.name}`} size={256}>
 *   <StlModel geometry={model.geometry} material={material} />
 * </SharedPreview>
 * ```
 *
 * ## Nothing in this file can render, and that is the point
 *
 * It imports React, `subjects.ts`, `frame.ts` and a stylesheet — **not three, r3f,
 * drei, `postprocessing` or n8ao**. So a catalog card can mount a slot in the
 * entry chunk, and the ~420 kB renderer arrives later behind
 * `lazy(() => import('./SharedStage'))` and starts filling slots in. Until it
 * does, the slot is a transparent canvas of the right size: no layout shift, and
 * no second code path for "3D not loaded yet".
 *
 * `boundary.test.ts` walks this file's static imports and fails if a renderer
 * package appears, because the failure is otherwise invisible — the app keeps
 * working and every catalog visitor downloads three.js.
 *
 * ## The canvas is a 2D canvas, and it is the *destination*
 *
 * The frame is rendered on the one shared WebGL canvas the host owns and copied
 * in here with `drawImage`. `subjects.ts` explains why copying beats one
 * stretched canvas with scissored viewports, and what it costs. Two consequences
 * live in this file:
 *
 *   - **The backing store is sized in device pixels** (`frame.ts`'s
 *     `devicePixels`), under the same `[1, 2]` dpr cap `<Canvas dpr>` applies to
 *     the shared buffer. Both ends have to agree or the copy is scaled by the
 *     ratio of two dpr assumptions and every preview is soft.
 *   - **A 2D context can be refused.** `getContext('2d')` returns `null` when the
 *     browser is out of canvas memory — and it also returns `null` in jsdom,
 *     which is how the tests reach this path. A subject with no surface is
 *     registered anyway and simply never painted, so the card keeps its layout.
 *
 * ## Drag to orbit; no wheel, no keys
 *
 * The drag is `OrbitControls`' own rotation mapping at the same speed
 * (`subjects.ts`), so a card feels like the drawer. Two omissions are deliberate:
 *
 *   - **No wheel zoom.** A card sits in a scrolling grid, and a preview that ate
 *     the scroll wheel would trap the page. Zoom lives in the detail drawer,
 *     which is one click away and owns the full-size view.
 *   - **No keyboard orbit.** `Viewer.tsx` made this call for the drawer —
 *     `OrbitControls` has no rotation keys and inventing a set would put a
 *     second, differently-behaved rotation gesture next to the sprite rotator's.
 *     The same reasoning applies harder here: the card's pre-rendered sprite is
 *     the keyboard-reachable preview, so this canvas is labelled `role="img"` and
 *     is not focusable.
 */
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { useEffect, useId, useRef, useState } from 'react'

import { devicePixels } from './frame'
import type { SubjectId, SubjectOrbit, SubjectPool, SubjectSurface } from './subjects'
import { DEFAULT_ORBIT, orbitDrag } from './subjects'

import './shared.css'

export interface SharedPreviewProps {
  readonly pool: SubjectPool
  /**
   * Stable identity for the subject. A tile id, or an aggregate address.
   *
   * Optional: without one the slot takes React's `useId`, which is right for a
   * one-off preview and wrong for a list, where a stable id is what stops a
   * scroll from re-registering every card.
   */
  readonly id?: SubjectId
  /** What the shared canvas draws for this slot: an r3f subtree. */
  readonly children: ReactNode
  /** Slot edge in CSS pixels. Square, like the sprite thumbs it sits beside. */
  readonly size?: number
  /** Non-square slots pass both. */
  readonly width?: number
  readonly height?: number
  /** The family's measured `edge`, for the AO pass. Omit for N8AO's black. */
  readonly occlusion?: string
  /** Describes the tile, not the widget: this is an image of a model. */
  readonly label: string
  readonly className?: string
  /** Set `false` for a slot that should not respond to a drag. */
  readonly interactive?: boolean
  /** Injected by tests. Defaults to `window.devicePixelRatio`. */
  readonly pixelRatio?: number
}

/** The default slot edge: the catalog card's thumb, in CSS pixels. */
export const SLOT_SIZE_PX = 256

export function SharedPreview({
  pool,
  id,
  children,
  size = SLOT_SIZE_PX,
  width = size,
  height = size,
  occlusion,
  label,
  className,
  interactive = true,
  pixelRatio,
}: SharedPreviewProps) {
  const fallbackId = useId()
  const subjectId = id ?? fallbackId

  const canvas = useRef<HTMLCanvasElement | null>(null)
  const [orbit, setOrbit] = useState<SubjectOrbit>(DEFAULT_ORBIT)
  const drag = useRef<{ pointer: number; x: number; y: number } | null>(null)

  const ratio =
    pixelRatio ?? (typeof window === 'undefined' ? 1 : window.devicePixelRatio)

  /*
     Registration, and nothing else in this effect.

     Keyed on the id and the geometry only. The orbit and the content change far
     more often and go through `pool.update` below, because re-registering would
     drop the subject out of the pool for a tick — long enough for the host to
     unmount its scene subtree and for the card to flash empty.
  */
  useEffect(() => {
    const element = canvas.current
    // A 2D context is refused in jsdom and when the browser is out of canvas
    // memory. Registering without one keeps the slot in the pool, at its real
    // size, and simply never paintable — see `paintable` in `subjects.ts`.
    const surface: SubjectSurface | null = element?.getContext('2d') ?? null

    return pool.register({
      id: subjectId,
      content: children,
      width,
      height,
      surface,
      occlusion: occlusion ?? null,
      orbit,
      active: false,
    })
  }, [pool, subjectId, width, height])

  // The content and the colour, pushed as updates rather than as registrations.
  useEffect(() => {
    pool.update(subjectId, { content: children, occlusion: occlusion ?? null })
  }, [pool, subjectId, children, occlusion])

  useEffect(() => {
    pool.update(subjectId, { orbit })
  }, [pool, subjectId, orbit])

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!interactive) return
    drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY }
    // Capture, so a drag that leaves the card keeps rotating it rather than
    // stopping at the card's edge — which is most drags on a 256 px slot.
    event.currentTarget.setPointerCapture(event.pointerId)
    pool.update(subjectId, { active: true })
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const state = drag.current
    if (state === null || state.pointer !== event.pointerId) return
    const dx = event.clientX - state.x
    const dy = event.clientY - state.y
    drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY }
    setOrbit((current) => orbitDrag(current, dx, dy, height))
  }

  const endDrag = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (drag.current === null) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    pool.update(subjectId, { active: false })
  }

  return (
    <canvas
      ref={canvas}
      className={className === undefined ? 'of-3d-slot' : `of-3d-slot ${className}`}
      data-interactive={interactive ? 'true' : 'false'}
      role="img"
      aria-label={label}
      width={devicePixels(width, ratio)}
      height={devicePixels(height, ratio)}
      style={{ width: `${String(width)}px`, height: `${String(height)}px` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    />
  )
}
