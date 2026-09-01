/**
 * Tabs — one panel visible at a time, with the header's inset-accent marker.
 *
 * Base UI supplies the tab semantics that hand-rolled tab strips always miss:
 * `role="tablist"` / `tab` / `tabpanel` with the `aria-controls` and
 * `aria-selected` wiring between them, arrow-key movement with one tab stop for
 * the whole strip, and `Tab` moving focus into the active panel rather than to
 * the next tab.
 *
 * `TabIndicator` is optional and renders inside `TabList`; it reads Base UI's
 * `--active-tab-left` / `--active-tab-width` and slides. Without it the selected
 * tab is still marked, by colour and by `aria-selected` — the indicator is the
 * flourish, not the affordance.
 */
import { Tabs as BaseTabs } from '@base-ui/react/tabs'
import type { ReactNode } from 'react'

import './primitives.css'

export interface TabsProps {
  /** The selected tab's value. */
  value: string
  onValueChange: (value: string) => void
  orientation?: 'horizontal' | 'vertical'
  className?: string
  children: ReactNode
}

/** Groups a {@link TabList} and its {@link TabPanel}s. Renders a `<div>`. */
export function Tabs({ value, onValueChange, orientation, className, children }: TabsProps) {
  return (
    <BaseTabs.Root
      value={value}
      onValueChange={(next) => {
        // Base UI's value type admits numbers and `null` for uncontrolled use.
        // This wrapper is controlled and string-keyed, so anything else is a
        // caller error rather than a state to represent.
        if (typeof next === 'string') onValueChange(next)
      }}
      orientation={orientation}
      className={className}
    >
      {children}
    </BaseTabs.Root>
  )
}

export interface TabListProps {
  /** Accessible name for the strip — "Views", "Sizes in this family". */
  label: string
  className?: string
  children: ReactNode
}

export function TabList({ label, className, children }: TabListProps) {
  return (
    <BaseTabs.List
      aria-label={label}
      className={['of-tab-list', className].filter(Boolean).join(' ')}
    >
      {children}
    </BaseTabs.List>
  )
}

export interface TabProps {
  value: string
  disabled?: boolean
  children: ReactNode
}

export function Tab({ value, disabled, children }: TabProps) {
  return (
    <BaseTabs.Tab value={value} disabled={disabled} className="of-tab">
      {children}
    </BaseTabs.Tab>
  )
}

/** The sliding accent marker. Render once, inside a {@link TabList}. */
export function TabIndicator() {
  return <BaseTabs.Indicator className="of-tab-indicator" />
}

export interface TabPanelProps {
  value: string
  className?: string
  children: ReactNode
}

export function TabPanel({ value, className, children }: TabPanelProps) {
  return (
    <BaseTabs.Panel
      value={value}
      className={['of-tab-panel', className].filter(Boolean).join(' ')}
    >
      {children}
    </BaseTabs.Panel>
  )
}
