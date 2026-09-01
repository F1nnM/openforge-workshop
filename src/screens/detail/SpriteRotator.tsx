/**
 * The 288px preview well — a sprite-sheet rotator over a radial-gradient ground.
 *
 * What it is not: design-contract.md §2.5 specifies a live three.js canvas with
 * "drag to orbit · scroll to zoom". v1 ships no renderer (architecture-plan.md
 * §8; the gated STL viewer is PR 21), so this shifts `background-position`
 * across the ten pre-rendered frames already in the bucket. The caption says so
 * — `10 pre-rendered angles`, not `live render` — because a caption that
 * promised a live orbit would be the one lie on the screen.
 *
 * The gesture and its calibration come from the catalog app's existing
 * `sprite-viewer.tsx`, against this exact sheet format: a 30px drag threshold,
 * horizontal drag rotating and a vertical drag reaching the poles, arrow keys as
 * the keyboard equivalent, and an explicit control pad so neither gesture is the
 * only route to a frame. Two deliberate departures: the drag uses pointer
 * events, so a pen and a touch drag work rather than only a mouse; and coming
 * back from a pole re-enters the ring where the user left it instead of
 * snapping to `front`.
 *
 * ## Why the frame is a `slider`
 *
 * Rotation is a value on a closed range and arrow keys are that role's own
 * documented interaction, so `role="slider"` gets name, role *and* value right
 * for free — a screen reader announces the current angle by name from
 * `aria-valuetext`, and the element is discoverable as adjustable. The
 * alternatives are worse: a focusable `role="img"` announces nothing about being
 * operable, and a bare `<div tabindex=0>` announces nothing at all. The poles
 * are off the ring, so they are reached from the pad and from `ArrowUp` /
 * `ArrowDown` and leave `aria-valuenow` at the azimuth the user will return to.
 *
 * ## Failure is visible on purpose
 *
 * One live tile has no sheet (`CatalogRecord.sprite === false`), and a 404 on a
 * sheet that is supposed to exist is indistinguishable from it at this layer.
 * Both render the same explicit plate rather than an empty well, so a missing
 * render reads as missing data instead of as a broken drawer.
 */
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { SpriteSheet } from '@/catalog'
import { Eyebrow } from '@/ui/primitives'

import {
  BOTTOM_FRAME,
  DRAG_STEP_PX,
  POLE_DRAG_PX,
  RING_FRAMES,
  SPRITE_ANGLES,
  TOP_FRAME,
  frameBackground,
  frameCode,
  frameName,
  isPole,
  stepRing,
} from './spriteFrames'

/** Rendered edge of one frame, in CSS pixels. §2.5's "288px" preview. */
export const PREVIEW_PX = 288

export interface SpriteRotatorProps {
  /** Tile display name, for the control's accessible name. */
  name: string
  /**
   * The sheet URL, or `null` for the one live tile that has no sheet.
   *
   * `null` and a failed load render the same plate — see the docblock.
   */
  sheetUrl: string | null
  /** Sheet geometry from the index; never assumed to be 2×5 here. */
  sheet: SpriteSheet
}

/** The pad's layout: the ring in reading order, then the two poles. */
const PAD_ROWS: readonly (readonly number[])[] = [RING_FRAMES, [TOP_FRAME, BOTTOM_FRAME]]

export function SpriteRotator({ name, sheetUrl, sheet }: SpriteRotatorProps) {
  const [frame, setFrame] = useState(sheet.defaultFrame)
  /** The azimuth to return to when leaving a pole. */
  const ringFrame = useRef(isPole(sheet.defaultFrame) ? 0 : sheet.defaultFrame)
  const [status, setStatus] = useState<'pending' | 'ready' | 'failed'>(
    sheetUrl === null ? 'failed' : 'pending',
  )

  const show = useCallback((next: number) => {
    if (!isPole(next)) ringFrame.current = next
    setFrame(next)
  }, [])

  /* ── loading ──────────────────────────────────────────────────────────────
     Decoded out of band so the well can shimmer while the 512px sheet arrives
     and can fall back to the plate when it does not. The element keeps its
     background either way, so a browser that reports neither event still paints
     the frame. */
  useEffect(() => {
    if (sheetUrl === null) {
      setStatus('failed')
      return
    }
    setStatus('pending')
    const image = new Image()
    let alive = true
    image.onload = () => {
      if (alive) setStatus('ready')
    }
    image.onerror = () => {
      if (alive) setStatus('failed')
    }
    image.src = sheetUrl
    return () => {
      alive = false
    }
  }, [sheetUrl])

  /* ── drag ─────────────────────────────────────────────────────────────────
     Window listeners rather than pointer capture: `setPointerCapture` is absent
     in jsdom and the listeners are needed anyway for a drag that leaves the
     element. */
  const drag = useRef<{ x: number; y: number; from: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (!dragging) return

    const move = (event: PointerEvent) => {
      const start = drag.current
      if (start === null) return
      const dx = event.clientX - start.x
      const dy = event.clientY - start.y

      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) >= POLE_DRAG_PX) {
        show(dy < 0 ? TOP_FRAME : BOTTOM_FRAME)
        return
      }
      if (Math.abs(dx) < DRAG_STEP_PX) return
      show(stepRing(start.from, Math.trunc(dx / DRAG_STEP_PX), start.from))
    }
    const stop = () => {
      drag.current = null
      setDragging(false)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }, [dragging, show])

  const onPointerDown = (event: ReactPointerEvent) => {
    // Left button / primary contact only: a right-press opens the context menu,
    // which is how the sheet gets saved.
    if (event.button !== 0) return
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      from: isPole(frame) ? ringFrame.current : frame,
    }
    setDragging(true)
  }

  const onKeyDown = (event: ReactKeyboardEvent) => {
    const step = (delta: number) => {
      event.preventDefault()
      show(stepRing(frame, delta, ringFrame.current))
    }
    const jump = (next: number) => {
      event.preventDefault()
      show(next)
    }

    switch (event.key) {
      case 'ArrowRight':
        step(1)
        break
      case 'ArrowLeft':
        step(-1)
        break
      case 'ArrowUp':
        jump(TOP_FRAME)
        break
      case 'ArrowDown':
        jump(BOTTOM_FRAME)
        break
      case 'Home':
        jump(sheet.defaultFrame)
        break
      default:
        break
    }
  }

  const background =
    status === 'failed' || sheetUrl === null
      ? undefined
      : {
          backgroundImage: `url(${sheetUrl})`,
          ...frameBackground(frame, sheet, PREVIEW_PX),
        }

  return (
    <div className="of-detail-preview">
      <div className="of-detail-well" data-status={status}>
        {status === 'failed' ? (
          <div className="of-detail-noshot">
            <Eyebrow as="div">No preview rendered</Eyebrow>
            <p>
              {sheetUrl === null
                ? 'This tile is the one entry in the archive with no sprite sheet.'
                : 'The sprite sheet for this tile did not load.'}
            </p>
          </div>
        ) : (
          <>
            <div
              className="of-detail-frame"
              role="slider"
              tabIndex={0}
              aria-label={`Rotate ${name} preview`}
              aria-orientation="horizontal"
              aria-valuemin={0}
              aria-valuemax={RING_FRAMES.length - 1}
              aria-valuenow={isPole(frame) ? ringFrame.current : frame}
              aria-valuetext={frameName(frame)}
              aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
              data-frame={frame}
              data-dragging={dragging ? '' : undefined}
              style={background}
              onPointerDown={onPointerDown}
              onKeyDown={onKeyDown}
            />
            {status === 'pending' ? <div className="of-detail-pending of-shimmer" aria-hidden="true" /> : null}
          </>
        )}
      </div>

      {/*
        Caption and pad only where there are frames to reach. With no sheet the
        plate above already says why, and a disabled ten-key pad under
        "10 pre-rendered angles" would be claiming ten frames that do not exist.
      */}
      {status === 'failed' ? null : (
        <>
          <p className="of-detail-caption">
            {SPRITE_ANGLES.length} pre-rendered angles · drag or <kbd>←</kbd> <kbd>→</kbd> to
            rotate
          </p>

          <div className="of-detail-pad" role="group" aria-label="Camera angle">
            {PAD_ROWS.map((row, index) => (
              <div className="of-detail-pad-row" key={index}>
                {row.map((candidate) => (
                  <button
                    key={candidate}
                    type="button"
                    className="of-detail-pad-key"
                    aria-pressed={frame === candidate}
                    aria-label={frameName(candidate)}
                    onClick={() => {
                      show(candidate)
                    }}
                  >
                    {frameCode(candidate)}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
