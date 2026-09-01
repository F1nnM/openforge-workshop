/**
 * The landing screen, as one import.
 *
 * `src/routes/routeTree.tsx` swaps `LandingPlaceholder` for `Landing` on the `/`
 * route; that one `component:` reference is the only change this PR makes
 * outside this directory.
 *
 * `deriveLandingStats` and the formatters are exported for the tests, and
 * because the four figures are the part of this screen another screen might
 * legitimately want — not because anything else imports them today.
 */
export { Landing } from './Landing'
export { deriveLandingStats, formatBytes, formatCount } from './stats'
export type { LandingStats } from './stats'
