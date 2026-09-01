/**
 * ToggleGroup — a segmented control where at most one item is pressed.
 *
 * Single-select only, and that is a decision rather than an omission: the two
 * places the design contract uses this shape are both single-select. §2.4's
 * builder toolbar switches between `Place` and `Erase`, and §3 records the
 * catalog facets as "single-select per group; re-click clears". Base UI's
 * `ToggleGroup` models the pressed set as an array to cover the multi-select
 * case; this wrapper collapses that to `value: V | null`, so a caller cannot
 * accidentally hold two modes at once and no screen has to write
 * `value={[mode]}`.
 *
 * Base UI supplies arrow-key movement across the items with a single tab stop,
 * `aria-pressed` on each button, and the group's `role`.
 */
import { Toggle } from '@base-ui/react/toggle'
import { ToggleGroup as BaseToggleGroup } from '@base-ui/react/toggle-group'
import type { ReactNode } from 'react'

import './primitives.css'

export interface ToggleGroupProps<V extends string> {
  /**
   * Accessible name for the group.
   *
   * Required: a group of two-letter buttons is meaningless without one, and the
   * design puts the label in a mono eyebrow *outside* the control, which screen
   * readers do not associate with it.
   */
  label: string
  /** The pressed item, or `null` for none. */
  value: V | null
  /**
   * Called with the newly pressed item, or `null` when the pressed item is
   * pressed again.
   *
   * Callers that must always have a selection (the builder's mode) ignore
   * `null`; callers that clear on re-press (the catalog's facets) pass it
   * through. Both are one line at the call site, which is why this wrapper does
   * not grow an `allowEmpty` prop to decide it for them.
   */
  onValueChange: (value: V | null) => void
  orientation?: 'horizontal' | 'vertical'
  className?: string
  children: ReactNode
}

export function ToggleGroup<V extends string>({
  label,
  value,
  onValueChange,
  orientation = 'horizontal',
  className,
  children,
}: ToggleGroupProps<V>) {
  return (
    <BaseToggleGroup
      aria-label={label}
      orientation={orientation}
      className={['of-toggle-group', className].filter(Boolean).join(' ')}
      value={value === null ? [] : [value]}
      onValueChange={(next) => {
        // Single-select, so Base UI hands back either nothing or one value.
        onValueChange(next[0] ?? null)
      }}
    >
      {children}
    </BaseToggleGroup>
  )
}

export interface ToggleItemProps<V extends string> {
  /** Identifies the item within its group. */
  value: V
  disabled?: boolean
  /**
   * Accessible name, for an item whose visible content is an icon or a glyph.
   *
   * A `⟳` button reads as nothing without it.
   */
  label?: string
  children: ReactNode
}

/** One item in a {@link ToggleGroup}. Renders a `<button>`. */
export function ToggleItem<V extends string>({
  value,
  disabled,
  label,
  children,
}: ToggleItemProps<V>) {
  return (
    <Toggle value={value} disabled={disabled} aria-label={label} className="of-toggle">
      {children}
    </Toggle>
  )
}
