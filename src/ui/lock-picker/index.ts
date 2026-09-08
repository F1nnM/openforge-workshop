/**
 * The lock preference UI, as one import.
 *
 * Three things, in the order a caller is likely to want them:
 *
 *   - **`LockToggle`** — the control, in the builder's work area. No props: the
 *     preference is global and the figures come from the emitted index. It is a
 *     trigger stating what is in effect and what it can build, over a modal disclosure
 *     holding `LockPicker` and the disclosure. `LockToggle.tsx` carries the
 *     argument for it, **including the documented decision it overrules** — the
 *     deleted `/settings` screen rejected exactly this shape — and the list of
 *     what the disclosure dropped relative to that screen.
 *   - **`LockPicker`** — the picker itself, controlled. `LockToggle`'s disclosure
 *     mounts it under a title; a second host can mount the same component with
 *     its own `name`, which is what that prop is for.
 *   - **`useLockBuild`** / **`deriveLockBuild`** — the measured comparison, both
 *     readings in one object. Use the hook to get it from the emitted index; use
 *     the function when you already hold a parsed `CatalogFile`, which is what
 *     the tests do.
 *   - **`deriveLockReach`** — the archive reading on its own, over bare records.
 *     `deriveLockBuild` calls it and hangs the result on `LockBuild.reach`, so a
 *     component never needs both; it stays exported because it is a pure
 *     structural function and the cheap half of the pair.
 *
 * ## Two questions, and every consumer needs to know which it is holding
 *
 * **Reachability** is *does this design's tags name that lock, or name none at
 * all* — 99.9 / 74.7 / 59.7 over 3,822 designs. **Buildability** is *can the app
 * resolve a complete printable assembly in that system* — 88.3 / 81.6 / 78.7,
 * because a topper plus an auto-inserted base builds in systems the tile itself
 * never mentions. The second is what a user experiences, so it is what the UI
 * leads with; the first is still shown, because it is what tells a reader whether
 * a design is native to their system or adapted to it. `build.ts` sets out the
 * split, and neither figure is a constant anywhere in this directory.
 *
 * Importing any component pulls in `lock-picker.css`.
 */
export type { LockBuild, LockBuildEntry, UnbuildableDesigns } from './build'
export { buildOf, deriveLockBuild } from './build'

export { LOCK_TOGGLE_ID, LockToggle } from './LockToggle'

export type { LockPickerProps } from './LockPicker'
export { LockPicker } from './LockPicker'

export type { LockReach, LockReachEntry, LockReachRecord } from './reach'
export {
  ALL_LOCK_SYSTEMS,
  countLabel,
  deriveLockReach,
  lockLabel,
  lockNote,
  pointsLabel,
  reachOf,
  shareLabel,
} from './reach'

export { loadLockBuild, resetLockBuild, useLockBuild } from './useLockBuild'
