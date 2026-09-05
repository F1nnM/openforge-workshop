/**
 * Shared test setup. PRs 5 and 6 each hit these two problems independently and
 * worked around them inline, which is the signal that they belong here.
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
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
configure({ asyncUtilTimeout: 5_000 })

// React only suppresses its "not wrapped in act(...)" warning when this is set,
// and Vitest does not set it.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// jsdom does not implement navigation-adjacent APIs and prints "Not implemented"
// once per mount, which buries real failures in noise.
//
// The obvious guard — `!('scrollTo' in window)` — never fires: jsdom 30 *defines*
// scrollTo, as a stub that throws. So overwrite unconditionally.
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'scrollTo', { value: () => {}, writable: true, configurable: true })
  Object.defineProperty(window, 'scrollBy', { value: () => {}, writable: true, configurable: true })
}

afterEach(() => {
  cleanup()
})
