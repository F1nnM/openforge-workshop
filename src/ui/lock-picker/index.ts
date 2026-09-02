/**
 * The lock preference UI, as one import.
 *
 * Four things, in the order a caller is likely to want them:
 *
 *   - **`LockNotice`** — the one-time banner. No props, renders `null` once the
 *     user has answered. Mount it where the preference changes what the user
 *     gets: the builder, and anything on the download path. Not on the landing
 *     page. `LockNotice.tsx` carries the banner-not-modal reasoning.
 *   - **`LockPicker`** — the picker itself, controlled. `@/screens/settings`
 *     mounts it under a heading; a toolbar or dialog can mount the same
 *     component with its own `name`.
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

export { LockNotice } from './LockNotice'

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
