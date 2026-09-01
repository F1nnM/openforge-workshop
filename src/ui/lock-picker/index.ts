/**
 * The lock preference UI, as one import.
 *
 * Three things, in the order a caller is likely to want them:
 *
 *   - **`LockNotice`** — the one-time banner. No props, renders `null` once the
 *     user has answered. Mount it where the preference changes what the user
 *     gets: the builder, and anything on the download path. Not on the landing
 *     page. `LockNotice.tsx` carries the banner-not-modal reasoning.
 *   - **`LockPicker`** — the picker itself, controlled. `@/screens/settings`
 *     mounts it under a heading; a toolbar or dialog can mount the same
 *     component with its own `name`.
 *   - **`useLockReach`** / **`deriveLockReach`** — the measured reachability.
 *     Use the hook to get it from the emitted index; use the function when you
 *     already hold records, which is what the tests do. Nothing in here is a
 *     hard-coded percentage, and `reach.ts` explains at length why not.
 *
 * Importing any component pulls in `lock-picker.css`.
 */
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

export { loadLockReach, resetLockReach, useLockReach } from './useLockReach'
