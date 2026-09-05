import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    globals: true,
    // Node by default: the facet engine, importer, assembly resolver and share
    // codec are all headless. Component tests opt in per file with a docblock:
    //   // @vitest-environment jsdom
    environment: 'node',
    /*
      ── Why the per-test timeout is not vitest's 5,000 ms default ────────────

      **Because 5,000 ms is not a budget anybody in this project chose, and the
      suite it has to survive is 181 files of corpus work on a shared machine.**
      Four files had already overridden it one at a time — `SLOW_CORPUS_MS`
      (120 s) in `src/composition/corpus.test.ts`, `SLOW_CAPACITY_MS` (120 s) in
      `src/share/capacity.test.ts`, and `SLOW_MS` in `src/template/{corpus,size}.test.ts`
      — each time after a row reproduced a timeout and wrote down why.

      Row C5 measured the class rather than adding a fifth. On one commit, with
      the suite deliberately descheduled (26 and 32 workers on 12 cores, which
      is the shape of a machine running other work), **six different tests in
      five files timed out across two runs, and no two runs failed the same
      pair**:

      | test | isolated |
      | --- | ---: |
      | `template/relock` — fits a lock toggle in a frame | **777 ms** |
      | `screens/builder/builder` — renders all three columns | **854 ms** |
      | `screens/detail/slots/slots` — the plan row's 62% | **555 ms** |
      | `pipeline/families` — takes the reach from 3,079 to 8,417 | **462 ms** |
      | `assembly/assembly` — hands out the same base as the code key | **299 ms** |

      Every one of them is 6× to 17× inside the old default, and the same commit
      runs **181 files / 3,998 tests green in 142 s** at the default worker count.
      So the failures are the scheduler, and patching them one file at a time is
      a queue with 36 catalog-parsing test files in it.

      30,000 ms rather than the 120,000 ms the named constants use: a genuine
      hang must still fail *fast* relative to the suite, and 30 s is a fifth of
      the whole run. The named constants stay exactly as they are — each is a
      real measurement of a block that legitimately takes tens of seconds, and
      this is the floor under everything else rather than a replacement for
      them. `hookTimeout` is untouched: no corpus work in this repo runs in a
      hook, it runs at module scope, which this setting does not bound either.

      **This does not weaken a single assertion.** Every wall-clock *budget* in
      the suite — `resolveMs`, the lock toggle's 16 ms, C5's own 250 ms — is an
      `expect`, and they are all still exactly where they were.
    */
    testTimeout: 30_000,
    // Only loaded for suites that opt into jsdom; a node-environment suite
    // importing @testing-library would fail on a missing document.
    setupFiles: ['./vitest.setup.ts'],
    include: [
      'src/**/*.test.{ts,tsx}',
      'pipeline/**/*.test.ts',
      'tools/**/*.test.ts',
      // The iOS zip Worker. A glob that matches nothing is not an error, so this
      // is inert until workers/ exists.
      'workers/**/*.test.ts',
    ],
  },
})
