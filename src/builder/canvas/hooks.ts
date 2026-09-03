/**
 * One small hook the 3D surface needs and nothing else does.
 *
 * It was two. `useCanvasSize` measured an element with a `ResizeObserver` and
 * fell back to a window `resize` listener, and its only caller was
 * `PlanCanvas.tsx` — an SVG renderer has to know its pixel box to compute a
 * `viewBox`. Row **R4** deleted that renderer, and r3f's `<Canvas>` does its own
 * measuring, so the hook went with `viewport.ts`: it was the last importer of
 * that module's `CanvasSize`, which is why deleting the one made deleting the
 * other possible.
 *
 * This file therefore survives the deletion for `useAnnouncer` alone, which
 * `BuilderRoom` imports.
 */
import { useCallback, useRef, useState } from 'react'

/**
 * A polite live region's text, and a way to set it.
 *
 * The zero-width space is load-bearing. `aria-live` announces on a *text
 * change*, so placing two identical tiles in a row, or stepping the cursor back
 * onto a cell it just left, would produce the same string and be silent — the
 * two cases where a keyboard user most needs confirmation. Alternating an
 * invisible character guarantees a change without changing what is read out.
 */
const ZERO_WIDTH_SPACE = '\u200B'

export function useAnnouncer(): { readonly message: string; announce: (text: string) => void } {
  const [message, setMessage] = useState('')
  const flip = useRef(false)

  const announce = useCallback((text: string) => {
    flip.current = !flip.current
    setMessage(flip.current ? text : `${text}${ZERO_WIDTH_SPACE}`)
  }, [])

  return { message, announce }
}
