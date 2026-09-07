/**
 * The room-wide design preference, as one import.
 *
 * Four things, in the order a caller is likely to want them:
 *
 *   - **`DesignToggle`** — the control, in the builder's work area. A trigger
 *     stating the design in effect and how much of the build it reaches, over a
 *     modal disclosure holding `DesignPicker` and the consequence of a change.
 *     `DesignToggle.tsx` carries the argument, including which of
 *     `LockToggle`'s it inherits and the one prop it does not.
 *   - **`DesignPicker`** — the picker itself, controlled. A second host can
 *     mount the same component with its own `name`, which is what that prop is
 *     for.
 *   - **`useDesignReach`** / **`deriveDesignReach`** — the measured comparison.
 *     Use the hook when you hold the screen's indexes; use the function in a
 *     test or a measurement, where the indexes are built explicitly.
 *   - **`designLabel`** — a `texture` root as a sentence. Derived from the tag
 *     rather than from a table, so a rescan that adds a root does not render it
 *     raw; `reach.ts` sets out why that is the opposite call from the lock
 *     picker's `lockLabel`.
 *
 * ## What the store holds, and what this directory holds
 *
 * `@/store`'s `WorkshopState.design` is the value — one `texture` root, or
 * absent for *no design*. Everything here is the *comparison*: which designs are
 * worth offering, and how far each one reaches over the templates this build can
 * place. None of those figures is a constant in this directory, for the reason
 * `lock-picker/build.ts` gives about its own: the buildability figures moved
 * twice while that row was being written, and a constant would have shipped the
 * stale one.
 *
 * Importing any component pulls in `design-picker.css`.
 */
export type { DesignReach, DesignReachEntry } from './reach'
export { countLabel, deriveDesignReach, designLabel, designOf, shareLabel } from './reach'

export type { DesignAuthorities } from './useDesignReach'
export { useDesignReach } from './useDesignReach'

export type { DesignPickerProps } from './DesignPicker'
export { DesignPicker } from './DesignPicker'

export type { DesignToggleProps } from './DesignToggle'
export { DESIGN_TOGGLE_ID, DesignToggle } from './DesignToggle'
