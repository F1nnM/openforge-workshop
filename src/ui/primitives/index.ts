/**
 * The shared primitives, as one import.
 *
 * Rows 13–19: `import { Drawer, Chip, Eyebrow } from '@/ui/primitives'`. These
 * are thin, token-styled wrappers over Base UI — not a design system. If one of
 * them does not fit a screen, extend the wrapper here rather than reaching past
 * it to Base UI, so there stays one focus model, one set of chip sizes and one
 * eyebrow in the app.
 *
 * Importing any of them pulls in `primitives.css`.
 */
export { Dialog, Drawer } from './Overlay'
export type { DialogProps } from './Overlay'

export { Tooltip, TooltipProvider } from './Tooltip'
export type { TooltipProps } from './Tooltip'

export { ToggleGroup, ToggleItem } from './ToggleGroup'
export type { ToggleGroupProps, ToggleItemProps } from './ToggleGroup'

export { Tab, TabIndicator, TabList, TabPanel, Tabs } from './Tabs'
export type { TabListProps, TabPanelProps, TabProps, TabsProps } from './Tabs'

export { Chip, Eyebrow, VisuallyHidden } from './Text'
export type { ChipProps, EyebrowProps } from './Text'
