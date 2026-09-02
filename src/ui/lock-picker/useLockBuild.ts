/**
 * The lock comparison, as render state.
 *
 * One job: hand a component a {@link LockBuild} derived from the index the app
 * actually loaded. It is a separate module from `build.ts` and `reach.ts` so that
 * both derivations stay testable without a DOM and without a stubbed `fetch` —
 * the numbers are the thing worth testing, and they are pure functions.
 *
 * ## One loader, both questions
 *
 * {@link LockBuild} carries the reachability reading on `build.reach`, so a
 * consumer that wants both — every one of them does; the picker draws
 * buildability and prints reachability beside it — holds **one** object and
 * **one** null state. Two loaders would give the picker four states (both
 * loaded, neither, and two halves) and three of them would render a row whose
 * two figures came from different moments.
 *
 * ## Why it reads the shell's loader and not its own fetch
 *
 * `loadCatalogIndex()` (`@/ui/shell`) is memoised, and the header, the landing
 * stats, the catalog engine and this all want the same 364 KB brotli document.
 * A second fetch here would double the download for a settings page nobody
 * visits on a cold load.
 *
 * ## Why the derivation is memoised, and what it costs not to be
 *
 * `deriveLockBuild` is about **185 ms** on the emitted index — 62 ms for the
 * aggregate index, 12 ms for the assembly index, 110 ms for the per-topper base
 * probe — against `deriveLockReach`'s single pass over 8,702 records. It is a
 * pure function of a build artefact carrying a version stamp, so it cannot change
 * under a running session; memoising it is the same argument
 * `src/screens/catalog/catalogIndex.ts` makes for its engine, with about fifty
 * times more at stake. Deriving inside the component would re-walk the corpus on
 * every remount, which is every navigation to the settings page and back.
 *
 * The one-time notice mounts in the builder, so the builder pays this once too.
 * It is deliberate: the notice's whole content is the consequence of the
 * preference, and quoting reachability there while the picker quoted
 * buildability would show the reader the number drop with no explanation for it.
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

import type { LockBuild } from './build'
import { deriveLockBuild } from './build'

let pending: Promise<LockBuild> | null = null

/** The comparison over the emitted index, derived at most once per session. */
export function loadLockBuild(): Promise<LockBuild> {
  pending ??= loadCatalogIndex().then((file) => deriveLockBuild(file))
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
export function resetLockBuild(): void {
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
export function useLockBuild(): LockBuild | null {
  const [build, setBuild] = useState<LockBuild | null>(null)

  useEffect(() => {
    let alive = true
    loadLockBuild().then(
      (value) => {
        if (alive) setBuild(value)
      },
      (error: unknown) => {
        // Only while mounted: every component test that renders this without a
        // resolved index unmounts mid-flight and has nothing to report.
        if (alive) console.warn('lock buildability unavailable', error)
      },
    )
    return () => {
      alive = false
    }
  }, [])

  return build
}
