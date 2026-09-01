/**
 * The builder screen, as one import.
 *
 * `BuilderScreen` is wired into `/builder` in `src/routes/routeTree.tsx`, and
 * that is the only place it is mounted. Nothing else is exported: the three
 * columns are `@/builder/panels` and the drawing is `@/builder/canvas`, so a
 * caller wanting a piece of the builder wants one of those rather than this.
 */
export { BuilderScreen } from './BuilderScreen'
