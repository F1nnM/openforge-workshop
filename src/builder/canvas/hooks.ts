/**
 * Two small hooks the canvas needs and nothing else does.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import type { CanvasSize } from './viewport'

/**
 * The element's CSS pixel size, tracked.
 *
 * `ResizeObserver` when the platform has it, a window `resize` listener when it
 * does not. jsdom implements neither and reports every element as 0 × 0 (the
 * catalog screen's tests document the same problem), so the fallback path is the
 * one component tests take — and `usableSize` turns a zero into
 * {@link FALLBACK_SIZE}, which is why the canvas still has a coherent
 * coordinate system under test.
 */
export function useCanvasSize(ref: React.RefObject<HTMLElement | null>): CanvasSize | null {
  const [size, setSize] = useState<CanvasSize | null>(null)

  useEffect(() => {
    const element = ref.current
    if (element === null) return

    const measure = () => {
      const rect = element.getBoundingClientRect()
      setSize((current) =>
        current !== null && current.width === rect.width && current.height === rect.height
          ? current
          : { width: rect.width, height: rect.height },
      )
    }
    measure()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => {
        window.removeEventListener('resize', measure)
      }
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [ref])

  return size
}

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
