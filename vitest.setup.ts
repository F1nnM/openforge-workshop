/**
 * Shared test setup. PRs 5 and 6 each hit these two problems independently and
 * worked around them inline, which is the signal that they belong here.
 *
 * ## Everything DOM-shaped is behind the `document` guard, and why
 *
 * `setupFiles` runs for **every** test file, not only the ones that opt into
 * jsdom — the note in `vitest.config.ts` that said otherwise was wrong. So the
 * two static `@testing-library` imports this file used to carry were paid by all
 * **181** files to be used by the **30** that render anything, and testing-library
 * pulls React and its DOM bindings in behind them.
 *
 * Measured over the whole suite, cold cache, `pool: forks` with isolation on:
 * **`setup` 37.3 s to 7.0 s and total CPU 645 s to 598 s**, with the same 4,070
 * tests passing. Nothing here is disabled — a node-environment file never had a
 * `document` to clean up, and the 30 jsdom files take exactly the setup they
 * always did. Checked rather than assumed: all **21** files that import
 * `@testing-library` are inside the 30 that declare jsdom, so no file loses
 * setup it was using.
 *
 * The guard is `typeof document`, not an env-var or a filename test, because it
 * is the actual precondition: `cleanup()` unmounts from a DOM, and `configure`
 * sets a deadline for queries against one.
 */
import { afterEach } from 'vitest'

/*
  ── The second load-sensitive deadline, and it is not vitest's ─────────────

  `findBy*` and `waitFor` have their **own** budget — testing-library's
  `asyncUtilTimeout`, 1,000 ms by default — and it is unaffected by
  `testTimeout` in `vitest.config.ts`. So a descheduled render fails as *"Unable
  to find role=…"*, which reads like a missing element rather than like a
  deadline, and that is the most misleading failure in this suite.

  Reproduced rather than assumed: with the suite deliberately descheduled at 36
  workers on 12 cores, `screens/detail/detail.test.tsx > places the shown file
  into the family that admits it` failed exactly that way, on a commit where
  the whole suite is green in **142 s** at the default worker count and green at
  26 workers. The element it could not find is rendered by a store write it had
  already made.

  5,000 ms rather than the 30,000 ms `testTimeout` carries: a component that
  genuinely never renders should still fail inside one test's own budget, so the
  message stays *"this test timed out"* and not *"the whole file gave up"*.
*/
if (typeof document !== 'undefined') {
  await import('@testing-library/jest-dom/vitest')
  const { cleanup, configure } = await import('@testing-library/react')

  configure({ asyncUtilTimeout: 5_000 })

  // React only suppresses its "not wrapped in act(...)" warning when this is set,
  // and Vitest does not set it.
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

  // jsdom does not implement navigation-adjacent APIs and prints "Not implemented"
  // once per mount, which buries real failures in noise.
  //
  // The obvious guard — `!('scrollTo' in window)` — never fires: jsdom 30 *defines*
  // scrollTo, as a stub that throws. So overwrite unconditionally.
  Object.defineProperty(window, 'scrollTo', { value: () => {}, writable: true, configurable: true })
  Object.defineProperty(window, 'scrollBy', { value: () => {}, writable: true, configurable: true })

  afterEach(() => {
    cleanup()
  })
}
