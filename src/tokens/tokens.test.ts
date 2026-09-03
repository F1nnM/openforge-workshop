// tsconfig.app.json pins `types` to vitest/globals, so Node's ambient module
// declarations are not in the program by default. Pull them in for this file
// rather than widening the shared compiler options — this is the only file in
// src/ that touches the filesystem, and it does so because reading tokens.css
// off disk is the point of the suite.
/// <reference types="node" />
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import type { ColorToken, FontToken } from './tokens'
import { color, colorVar, font, fontVar } from './tokens'

const stylesheet = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8')

const colorTokens = Object.keys(color) as ColorToken[]
const fontTokens = Object.keys(font) as FontToken[]

/** Declared token values, keyed by the custom property they are published under. */
const declaredTokens = new Map<string, string>([
  ...colorTokens.map((token) => [colorVar(token), color[token]] as const),
  ...fontTokens.map((token) => [fontVar(token), font[token]] as const),
])

// ── Reading the stylesheet ──────────────────────────────────────────────────
// A regex, not a CSS parser. tokens.css is a flat file of custom properties
// with no nesting, no at-rule bodies inside the blocks we read and no `;` or
// `}` inside any value, which is the whole of what these two helpers assume.
// If that ever stops being true, these tests fail loudly rather than quietly.

const withoutComments = stylesheet.replace(/\/\*[\s\S]*?\*\//g, '')

/** The body of the first `{ … }` that follows `opener`. */
function blockBody(opener: string): string {
  const start = withoutComments.indexOf(opener)
  if (start < 0) throw new Error(`tokens.css has no \`${opener}\` block`)
  const open = withoutComments.indexOf('{', start)
  const close = withoutComments.indexOf('}', open)
  if (open < 0 || close < open) throw new Error(`\`${opener}\` block is unterminated`)
  return withoutComments.slice(open + 1, close)
}

/** Every `--name: value` declaration in a block, with runs of whitespace collapsed. */
function customProperties(block: string): Map<string, string> {
  const declarations = new Map<string, string>()
  const pattern = /(--[\w-]+)\s*:\s*([^;}]+)/g
  for (const [, name = '', value = ''] of block.matchAll(pattern)) {
    declarations.set(name, value.trim().replace(/\s+/g, ' '))
  }
  return declarations
}

const rootBlock = customProperties(blockBody(':root'))
const themeBlock = customProperties(blockBody('@theme inline'))

// ── The three.js constraint ─────────────────────────────────────────────────

interface Rgb {
  r: number
  g: number
  b: number
}

const BLACK: Rgb = { r: 0, g: 0, b: 0 }

/**
 * The subset of CSS colour syntax that `THREE.Color.setStyle()` understands:
 * `#rgb`/`#rrggbb`, and legacy comma-separated `rgb()`/`rgba()`. Anything else
 * comes back BLACK.
 *
 * Reimplemented here rather than imported, so the token set does not drag
 * three.js into the test graph for one regex. It is deliberately *narrower*
 * than three's — three also reads legacy `hsl()` and CSS named colours — which
 * is the safe direction to err in: this can fail a value three would have
 * accepted, but it can never pass one three would reject.
 *
 * Why this is worth a test at all. three.js does not throw on a colour it
 * cannot read — it emits a console warning and leaves the material's colour at
 * its default. A token authored in any modern colour syntax (`oklch()`,
 * `lab()`, `color(display-p3 …)`, or even the space-separated `rgb(r g b / a)`
 * form CSS now prefers) would therefore sail through the browser, render
 * correctly in every piece of UI chrome, and turn every tinted 3D tile into a
 * flat unintended block — with nothing in the build to say so. Here the same
 * value parses to black and fails the assertion below instead.
 */
function parseSrgb(value: string): Rgb {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)
  if (hex) {
    const [, digits = ''] = hex
    const full = digits.length === 3 ? digits.replace(/./g, (digit) => digit + digit) : digits
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
    }
  }

  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(\d*\.?\d+)\s*)?\)$/i.exec(
    value,
  )
  if (rgb) {
    const [, red = '', green = '', blue = ''] = rgb
    const parsed = { r: Number(red), g: Number(green), b: Number(blue) }
    const inRange = parsed.r <= 255 && parsed.g <= 255 && parsed.b <= 255
    return inRange ? parsed : BLACK
  }

  return BLACK
}

const isBlack = (rgb: Rgb): boolean => rgb.r === 0 && rgb.g === 0 && rgb.b === 0

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Parchment tokens', () => {
  describe('tokens.ts and tokens.css agree', () => {
    it('declares exactly the same custom properties in both files', () => {
      // Both directions: a token added to one file and forgotten in the other
      // fails here, whichever file it was added to.
      expect([...rootBlock.keys()].sort()).toEqual([...declaredTokens.keys()].sort())
    })

    it('gives every custom property the same value in both files', () => {
      expect(Object.fromEntries(rootBlock)).toEqual(Object.fromEntries(declaredTokens))
    })

    it('aliases every token into a Tailwind namespace with @theme inline', () => {
      // This is what makes `bg-bg2`, `text-ink`, `border-line` and `font-mono`
      // exist as utilities, and — because the block is `inline` — what makes
      // them compile to `var(--bg2)` rather than `var(--color-bg2)`, so the raw
      // token stays the single point of override.
      const expected = new Map<string, string>([
        ...colorTokens.map((token) => [`--color-${token}`, `var(${colorVar(token)})`] as const),
        ...fontTokens.map((token) => [`--font-${token}`, `var(${fontVar(token)})`] as const),
      ])
      expect(Object.fromEntries(themeBlock)).toEqual(Object.fromEntries(expected))
    })
  })

  describe('colour values', () => {
    it.each(colorTokens)('%s is a valid sRGB CSS colour', (token) => {
      const value = color[token]
      const isHex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)
      const isRgb =
        /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/i.test(value)
      expect(isHex || isRgb, `${value} is neither a hex nor an rgb()/rgba() colour`).toBe(true)

      const { r, g, b } = parseSrgb(value)
      for (const channel of [r, g, b]) {
        expect(channel).toBeGreaterThanOrEqual(0)
        expect(channel).toBeLessThanOrEqual(255)
      }
    })

    it.each(colorTokens)('%s survives THREE.Color().setStyle()', (token) => {
      // The plan feeds this same token set to three.js material colours, so
      // every value has to stay inside three's parseable subset. See parseSrgb:
      // a value three cannot read does not raise, it silently renders wrong.
      const rgb = parseSrgb(color[token])
      expect(isBlack(rgb), `${color[token]} is not readable by THREE.Color.setStyle()`).toBe(false)
    })

    it('the parser rejects the syntaxes three.js cannot read', () => {
      // Guards the assertion above: if parseSrgb were lenient enough to accept
      // these, the suite would pass on tokens that break the 3D views.
      for (const unreadable of [
        'oklch(0.72 0.11 68)',
        'lab(54% 25 42)',
        'color(display-p3 0.9 0.86 0.77)',
        'rgb(80 60 30 / 20%)',
        'hsl(38deg 40% 84%)',
        'var(--bg)',
        '#e7dcc',
      ]) {
        expect(isBlack(parseSrgb(unreadable)), `${unreadable} should not have parsed`).toBe(true)
      }
    })
  })
})
