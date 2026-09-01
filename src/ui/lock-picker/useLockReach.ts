/**
 * The lock comparison, as render state.
 *
 * One job: hand a component a {@link LockReach} derived from the index the app
 * actually loaded. It is a separate module from `reach.ts` so that the
 * derivation stays testable without a DOM and without a stubbed `fetch` — the
 * numbers are the thing worth testing, and they are a pure function.
 *
 * ## Why it reads the shell's loader and not its own fetch
 *
 * `loadCatalogIndex()` (`@/ui/shell`) is memoised, and the header, the landing
 * stats, the catalog engine and this all want the same 364 KB brotli document.
 * A second fetch here would double the download for a settings page nobody
 * visits on a cold load.
 *
 * ## Why the derivation is memoised too
 *
 * It is a pure function of a build artefact carrying a version stamp, so it
 * cannot change under a running session — the same argument
 * `src/screens/catalog/catalogIndex.ts` makes for its engine. Deriving inside
 * the component instead would re-walk 8,702 records on every remount, which is
 * every navigation to the settings page and back.
 *
 * ## Failure is `null`, not a thrown error
 *
 * A failed index load leaves the picker with no numbers, and the picker's own
 * copy says so. The *choice* still works: the store does not need the catalog to
 * record a preference, and a network blip must not cost the user the ability to
 * set one. This is the same call the header's archive stat makes for the same
 * reason.
 */
import { useEffect, useState } from 'react'

import { loadCatalogIndex } from '@/ui/shell'

import type { LockReach } from './reach'
import { deriveLockReach } from './reach'

let pending: Promise<LockReach> | null = null

/** The comparison over the emitted index, derived at most once per session. */
export function loadLockReach(): Promise<LockReach> {
  pending ??= loadCatalogIndex().then((file) => deriveLockReach(file.records))
  const attempt = pending
  // A rejection must not become the memoised answer for the rest of the session,
  // or a single blip permanently blanks the figures. The shell's own fetch memo
  // is left alone: it is not this module's to reset, and `catalogIndex.ts`
  // already owns that retry path.
  attempt.catch(() => {
    if (pending === attempt) pending = null
  })
  return attempt
}

/** Drop the memoised comparison. For tests. */
export function resetLockReach(): void {
  pending = null
}

/**
 * The comparison, or `null` while it is unknown.
 *
 * `null` covers both "still loading" and "could not load", deliberately: the
 * picker renders identically in both — options with no figures — so splitting
 * them would give the component a state it does not use. Nothing about the
 * choice itself depends on the catalog.
 */
export function useLockReach(): LockReach | null {
  const [reach, setReach] = useState<LockReach | null>(null)

  useEffect(() => {
    let alive = true
    loadLockReach().then(
      (value) => {
        if (alive) setReach(value)
      },
      (error: unknown) => {
        // Only while mounted: every component test that renders this without a
        // resolved index unmounts mid-flight and has nothing to report.
        if (alive) console.warn('lock reachability unavailable', error)
      },
    )
    return () => {
      alive = false
    }
  }, [])

  return reach
}
