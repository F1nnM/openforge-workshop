/**
 * Tooltip — a hint attached to a control.
 *
 * Base UI supplies the parts that are easy to get wrong: the popup opens on
 * keyboard focus as well as hover, `Escape` dismisses it, the positioner flips
 * sides rather than rendering off-screen, and one hover delay can be shared
 * across a group of triggers.
 *
 * ## A tooltip is a visual affordance, not an accessible one
 *
 * Base UI deliberately does not give the popup `role="tooltip"` and does not
 * point the trigger's `aria-describedby` at it, because a tooltip is unreachable
 * by touch and unreliably announced by screen readers. Its documentation states
 * the consequence as a requirement: the trigger must carry its own accessible
 * name, closely matching the hint.
 *
 * That is why {@link TooltipProps.label} exists and why this wrapper stamps it on
 * the trigger. Two rules follow, and they are the whole of using this correctly:
 *
 *   - **The trigger must be focusable and named.** It is composed through Base
 *     UI's `render` prop, so a `<button>` works and a `<div>` does not. If the
 *     trigger has no visible text — a `⟳` in the builder toolbar — pass `label`.
 *   - **The hint must be redundant.** Anything a user *needs* is inline text or a
 *     popover, never a tooltip. A tooltip repeats and elaborates; it does not
 *     hold the only copy of something.
 */
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip'
import type { ReactElement, ReactNode } from 'react'

import './primitives.css'

export interface TooltipProps {
  /** The hint. Short — the popup caps at 26ch. */
  content: ReactNode
  /**
   * The control the hint describes. Must accept a ref and be focusable.
   *
   * Passed as an element rather than as `children` so the trigger and the hint
   * cannot be confused at the call site.
   */
  trigger: ReactElement
  /**
   * Accessible name for the trigger, for a trigger with no visible text.
   *
   * Applied as `aria-label`. Keep it close to `content`: a screen reader user
   * gets this and never gets the hint, so the two drifting apart means two
   * different users are told two different things about one button.
   */
  label?: string
  /** Preferred side. Flipped automatically to avoid a collision. */
  side?: 'top' | 'bottom' | 'left' | 'right'
  /** Milliseconds of hover before opening. Focus always opens immediately. */
  delay?: number
}

export function Tooltip({ content, trigger, label, side = 'top', delay }: TooltipProps) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={trigger} delay={delay} aria-label={label} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} sideOffset={6}>
          <BaseTooltip.Popup className="of-tooltip">{content}</BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  )
}

/**
 * Share one hover delay across a group of tooltips.
 *
 * Worth wrapping a toolbar in: without it, moving along §2.4's `Place` / `Erase`
 * / `Rotate` / `Clear` row waits out the full delay at every button. With it,
 * the first tooltip pays the delay and its neighbours open immediately.
 */
export const TooltipProvider = BaseTooltip.Provider
