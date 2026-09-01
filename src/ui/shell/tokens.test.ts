/// <reference types="node" />
/**
 * The UI reads tokens through CSS, never through `getComputedStyle`.
 *
 * A source-level assertion, because the failure it guards against does not look
 * like a bug. `tokens.css` ships two `rgba()` values, and Lightning CSS rewrites
 * them to eight-digit hex when it minifies the production build:
 * `rgba(80,60,30,0.2)` becomes `#503c1e33`. Any code that reads a token back out
 * of the cascade and hands it to something with a narrower colour parser —
 * `THREE.Color.setStyle()` handles three- and six-digit hex only — therefore
 * works in dev, works in every test, and silently renders wrong in production.
 *
 * The rule that avoids it entirely: styling goes through `var(--token)` and
 * JavaScript that needs a literal imports it from `src/tokens/tokens.ts`. So the
 * check is not "is the value correct" but "was the value ever read this way", and
 * that is a grep.
 *
 * Scoped to `src/ui/` — this PR's directories. Other trees are their owners' to
 * assert on.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const UI_ROOT = new URL('..', import.meta.url).pathname

/**
 * Assembled from two pieces so this file does not contain what it forbids.
 *
 * The paren matters: the name alone appears in the prose above, and a check that
 * its own documentation fails is a check nobody keeps.
 */
const FORBIDDEN = 'getComputedStyle' + '('

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx|css)$/.test(entry.name) ? [path] : []
  })
}

describe('src/ui', () => {
  const files = sourceFiles(UI_ROOT)

  it('has source files to check', () => {
    // Guards the assertion below: an empty list would pass it vacuously.
    expect(files.length).toBeGreaterThan(8)
  })

  it.each(files.map((path) => [path.slice(UI_ROOT.length), path]))(
    '%s does not read a token via getComputedStyle',
    (_name, path) => {
      expect(readFileSync(path, 'utf8')).not.toContain(FORBIDDEN)
    },
  )
})
