/**
 * `prefers-reduced-motion`, as a hook.
 *
 * The landing page opens with a staged reveal — eyebrow, headline, lede,
 * actions, figures, then the plan assembling floors-walls-fixtures — because it
 * is the one screen where the design is allowed to be expressive, and a front
 * door that draws itself is the cheapest way to say "this is a tool that builds
 * things". It is also exactly the kind of thing that makes some people ill, so
 * it has to be switchable off, and off has to mean *absent*, not *faster*.
 *
 * ## Why a hook and not only a media query
 *
 * `landing.css` carries a `@media (prefers-reduced-motion: reduce)` block as
 * well, and that block is the real guarantee — it holds even if this module is
 * never called. The hook exists on top of it for one reason: it makes the
 * decision *observable*. The screen stamps `data-motion="on" | "off"` on its
 * root, so the sequence is one attribute away from a test, and a regression
 * shows up as a failing assertion rather than as a media query nobody re-reads.
 * Every animated rule in `landing.css` is nested under `[data-motion='on']`, so
 * the attribute is load-bearing, not documentation.
 *
 * ## Why the animations are additive
 *
 * Nothing in this screen has `opacity: 0` in its base rule. The keyframes
 * animate *from* transparent with `animation-fill-mode: both`, so an element
 * whose animation never runs — reduced motion, a stylesheet that failed to load,
 * a browser that does not support the property — is simply visible. The
 * alternative (hidden by default, revealed by animation) fails to a blank page,
 * which is the one thing a landing screen must never do.
 */
import { useSyncExternalStore } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

/**
 * Resolved lazily and not cached: a test replaces `window.matchMedia` between
 * cases, and a list captured at module load would answer with the previous
 * case's stub. Constructing a `MediaQueryList` is cheap.
 *
 * `matchMedia` is optional-chained because it is genuinely absent in some
 * headless environments, and a landing page that throws while deciding whether
 * to animate has failed at something much more important than animating.
 */
function mediaQueryList(): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null
}

function subscribe(onStoreChange: () => void): () => void {
  const list = mediaQueryList()
  // Older `MediaQueryList` implementations only have `addListener`. Nothing to
  // fall back to here — an unsubscribable list just means the preference is read
  // once, at mount, which is the behaviour before this API existed at all.
  if (!list || typeof list.addEventListener !== 'function') return () => {}
  list.addEventListener('change', onStoreChange)
  return () => {
    list.removeEventListener('change', onStoreChange)
  }
}

function getSnapshot(): boolean {
  return mediaQueryList()?.matches ?? false
}

/** `true` when the visitor has asked for less motion. Updates if they change it. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot)
}
