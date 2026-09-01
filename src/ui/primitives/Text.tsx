/**
 * The three typographic devices the design repeats on every screen.
 *
 * These are not Base UI wrappers and they are barely components. They are here
 * because the mono/serif/sans split is the load-bearing part of this design —
 * "anything that is a measured fact is set in mono" — and four screens written
 * in parallel by four agents will otherwise arrive at four slightly different
 * eyebrows and three chip sizes. One `<span>` each is a cheap way to make the
 * typographic rule the default rather than a thing to remember.
 */
import type { ReactNode } from 'react'

import './primitives.css'

export interface ChipProps {
  /**
   * Which chip this is. All three are mono on the chip fill; they differ in
   * size, radius and ink.
   *
   *   - `count` — a number beside a label. Accent ink, pill radius. The header's
   *     library and placement counts, and the facet counts.
   *   - `size`  — a size code or dimension. Primary ink, so it reads as part of
   *     the card's data rather than as a badge.
   *   - `tag`   — a catalog tag. Muted and smallest; there are often six.
   */
  tone?: 'count' | 'size' | 'tag'
  className?: string
  children: ReactNode
}

/** A mono chip on the chip fill. Renders a `<span>`. */
export function Chip({ tone = 'count', className, children }: ChipProps) {
  return (
    <span className={['of-chip', className].filter(Boolean).join(' ')} data-tone={tone}>
      {children}
    </span>
  )
}

export interface EyebrowProps {
  /** `accent` for the landing hero's; muted everywhere else. */
  tone?: 'muted' | 'accent'
  /**
   * Render as something other than a `<span>`.
   *
   * `'h2'` and `'h3'` are here because a group rule is a real heading, and
   * `'dt'` because a figure label is a real definition term — rows 14 and 16
   * both had to nest an Eyebrow inside one of those to keep the semantics.
   */
  as?: 'span' | 'div' | 'p' | 'h2' | 'h3' | 'dt'
  className?: string
  children: ReactNode
}

/**
 * The uppercase mono label above every section and sidebar group.
 *
 * Text is passed through as written, and uppercased by CSS rather than by the
 * caller: `text-transform` keeps the accessible name in mixed case, so a screen
 * reader says "texture set" instead of spelling out an acronym.
 */
export function Eyebrow({ tone = 'muted', as = 'span', className, children }: EyebrowProps) {
  const Element = as
  return (
    <Element className={['of-eyebrow', className].filter(Boolean).join(' ')} data-tone={tone}>
      {children}
    </Element>
  )
}

/**
 * Text for assistive technology only.
 *
 * Used to turn a bare number into a sentence — the header's count chips read as
 * "Library, 4 tiles saved" rather than "Library 4" — and clipped rather than
 * `display: none`, which would remove it from the accessibility tree too.
 */
export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="of-sr-only">{children}</span>
}
