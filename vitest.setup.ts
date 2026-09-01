/**
 * Shared test setup. PRs 5 and 6 each hit these two problems independently and
 * worked around them inline, which is the signal that they belong here.
 */
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

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
