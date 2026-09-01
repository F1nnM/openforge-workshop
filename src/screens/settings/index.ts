/**
 * The settings screen, as one import.
 *
 * `src/routes/routeTree.tsx` mounts `SettingsScreen` on `/settings`, and that
 * `component:` reference plus the route declaration is the only change this PR
 * makes outside this directory and `src/ui/lock-picker/` (and the store, for the
 * "has chosen" flag).
 *
 * The picker itself is **not** re-exported from here. It lives in
 * `@/ui/lock-picker` precisely so that the builder's toolbar and the one-time
 * notice can mount it without importing a screen — a screen import would drag
 * this stylesheet and this page's copy into the builder bundle.
 */
export { SettingsScreen } from './SettingsScreen'
