/// <reference types="node" />
/**
 * Two properties of the shipped markup that no component test can see.
 *
 * Both are row X2's, and both are the same kind of thing as the control-byte
 * guard beside them: a fact about the repository rather than about a feature.
 *
 *   1. **What the document head promises.** `index.html` is not rendered by
 *      React and no test mounts it, so its share block is unasserted by
 *      construction — including the tag that is *deliberately absent*, which is
 *      the half that rots silently. A future row adding `og:image` because "the
 *      head looks incomplete" would ship a broken share card on every platform
 *      that reads it, and nothing would fail.
 *   2. **That there is exactly one class name for a button.** `.of-action` and
 *      `.of-lib-action` were aliases `primitives.css` answered to while the
 *      markup carrying them belonged to other rows. X2 swapped all seven call
 *      sites and deleted both. A CSS alias cannot be deleted by the type system
 *      and a re-added one would work perfectly, which is exactly why it needs a
 *      test: the failure mode of a second button class is not a broken button,
 *      it is a second place to change the padding.
 */
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * Source with its comments removed.
 *
 * Every assertion below is about *markup or a selector*, and every one of them
 * has prose next to it saying why — including, in `index.html`, four paragraphs
 * naming the exact tags that must not be there. Matching the raw text would make
 * each explanation the thing that fails the test it explains.
 *
 * Block comments in all three syntaxes, plus the leading-`//` and continuation-`*`
 * lines a docblock is made of. Deliberately not a parser: a stray `/*` inside a
 * string literal would over-strip, and over-stripping this file can only ever
 * *hide* a match, never invent one — and the two positive counts below would
 * catch that immediately.
 */
function withoutComments(source: string): string {
  return source
    .replaceAll(/<!--[\s\S]*?-->/g, '')
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => {
      const trimmed = line.trimStart()
      return !trimmed.startsWith('//') && !trimmed.startsWith('*')
    })
    .join('\n')
}

const rawHead = readFileSync(resolve(REPO_ROOT, 'index.html'), 'utf8')
const head = withoutComments(rawHead)

/** Every tracked file under `src/`, so a deleted alias stays deleted. */
function trackedSources(): string[] {
  return execFileSync('git', ['ls-files', '-z', 'src'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((path) => path !== '')
}

describe('the document head', () => {
  it('states the same three things twice, once in each vocabulary', () => {
    // A share card that described the app differently from its own <title> would
    // be two claims about one product, so the Open Graph strings are the
    // document's own strings rather than a reworded second set.
    expect(head).toContain('<title>OpenForge Workshop</title>')
    expect(head).toContain('<meta property="og:title" content="OpenForge Workshop" />')
    expect(head).toContain('<meta property="og:site_name" content="OpenForge Workshop" />')
    expect(head).toContain('<meta property="og:type" content="website" />')

    const description =
      'Browse the OpenForge catalog of 3D-printable dungeon terrain, keep a library of the tiles you print with, and lay out a room.'
    // Twice: once as `name="description"` and once as `property="og:description"`.
    expect(head.split(description)).toHaveLength(3)
  })

  it('omits og:image, and says summary rather than summary_large_image', () => {
    // **The decision this file exists for.** There is no image to point at: the
    // only rasters this project has are 2x5 sprite sheets of one tile in the
    // untinted blue row P1 exists to correct, the thumbnail derivative does not
    // exist until rows P3 and X1, and an `og:image` that resolves to nothing is
    // rendered by Slack, Discord and Twitter as a card with a broken image well
    // rather than as the text card they would show without the tag.
    //
    // `summary_large_image` has the same problem one step further on: with no
    // image it renders nothing at all.
    expect(head).not.toContain('og:image')
    expect(head).toContain('<meta name="twitter:card" content="summary" />')
    expect(head).not.toContain('summary_large_image')
  })

  it('omits og:url and rel=canonical, because one document serves four routes', () => {
    // `wrangler.jsonc` sets `not_found_handling: "single-page-application"`, so
    // this exact file is served for `/catalog`, `/builder` and `/library` too. A
    // single absolute URL baked in here would tell a crawler that every one of
    // those is a duplicate of the root.
    expect(head).not.toContain('og:url')
    expect(head).not.toContain('rel="canonical"')
  })

  it('paints the first frame in the palette’s own background', () => {
    // The browser paints its chrome and the page ground before any stylesheet
    // arrives. `src/tokens/tokens.css` declares both of these; saying them here
    // is what keeps a cold load from flashing white.
    const tokens = readFileSync(resolve(REPO_ROOT, 'src/tokens/tokens.css'), 'utf8')
    expect(tokens).toContain('color-scheme: light')
    expect(tokens).toContain('--bg: #e7dcc4')
    expect(head).toContain('<meta name="color-scheme" content="light" />')
    expect(head).toContain('<meta name="theme-color" content="#e7dcc4" />')
  })
})

describe('there is one class name for a button', () => {
  it('has no `.of-action` or `.of-lib-action` left in any source file', () => {
    // Prose about the two deleted aliases is allowed and is the point of the
    // remaining mentions; a selector or a `className` is not. So the match is on
    // the two shapes either would take.
    const offenders: string[] = []
    for (const path of trackedSources()) {
      const source = withoutComments(readFileSync(resolve(REPO_ROOT, path), 'utf8'))
      for (const alias of ['of-action', 'of-lib-action']) {
        // A CSS selector — `.of-action {`, `.of-action:hover`, `.of-action[…]`,
        // or the alias on its own line in a selector list.
        if (new RegExp(`\\.${alias}(?![\\w-])`).test(source)) offenders.push(`${path}: .${alias}`)
        // A class attribute in JSX.
        if (new RegExp(`className=(?:"|{')[^"']*\\b${alias}\\b`).test(source)) {
          offenders.push(`${path}: className ${alias}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('spells every button through Button or buttonProps at the seven call sites', () => {
    // The two screens that had grown their own copy of the block. Counted, so a
    // regression is a number a reviewer can see: two on the landing hero, and
    // five across the library screen and its backup block.
    const read = (path: string) => withoutComments(readFileSync(resolve(REPO_ROOT, path), 'utf8'))
    const landing = read('src/screens/landing/Landing.tsx')
    const screenFile = read('src/screens/library/LibraryScreen.tsx')
    const transfer = read('src/screens/library/LibraryTransfer.tsx')

    const uses = (source: string) =>
      (source.match(/buttonProps\(\{/g) ?? []).length + (source.match(/<Button[\s/>]/g) ?? []).length

    // The hero's two are `Link`s, so both are `buttonProps` — and both name the
    // `lg` size, which used to arrive implicitly through the `.of-action` alias.
    expect(uses(landing)).toBe(2)
    expect(landing.match(/size: 'lg'/g) ?? []).toHaveLength(2)

    // Two `Link`s and one real `<button>`.
    expect(uses(screenFile)).toBe(3)
    // One real `<button>` and one `<label>` wrapping a clipped file input.
    expect(uses(transfer)).toBe(2)
  })
})
