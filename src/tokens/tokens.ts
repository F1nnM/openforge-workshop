/**
 * OpenForge Workshop — Parchment design tokens, for JavaScript consumers.
 *
 * The palette has to be readable from two places: CSS (Tailwind utilities and
 * hand-written rules) and TypeScript (three.js material colours, canvas
 * drawing, anything that needs a literal rather than a `var()`). Three ways to
 * keep one set of numbers serving both, and why this file is the third:
 *
 *   - **Generate the CSS from this file.** Rejected: the generator would need a
 *     script entry in `package.json`, which this PR does not own, so nothing
 *     would run it. A generator nobody invokes is worse than no generator — the
 *     checked-in output silently becomes the real source.
 *
 *   - **Parse `tokens.css` at runtime** (`import css from './tokens.css?raw'`).
 *     Rejected: it ships a CSS parser and the stylesheet text to every visitor,
 *     and moves a class of authoring mistake from build time to first paint.
 *
 *   - **State the values twice and make drift a test failure.** Chosen. The
 *     stylesheet stays the artefact the browser loads and this file stays a
 *     plain, side-effect-free module three.js can import cheaply. Neither
 *     derives from the other, so `tokens.test.ts` reads `tokens.css` off disk
 *     and asserts an exact bijection — same names, same values, in both
 *     directions. Editing one without the other fails CI rather than shipping a
 *     UI whose 3D tints no longer match its chrome.
 *
 * So: the design contract is the source of truth, `tokens.css` and this file
 * are two transcriptions of it, and the test is the clamp holding them equal.
 *
 * Values: docs/design-contract.md §1. There is no dark variant — see the note
 * in tokens.css.
 */

/**
 * The Parchment palette.
 *
 * Every value stays inside the sRGB subset that `THREE.Color.setStyle()` can
 * read (hex, or legacy comma-separated `rgb()`/`rgba()`). `tokens.test.ts`
 * enforces that; the reasoning is documented there.
 *
 * Read colours for three.js from *here*, not from `getComputedStyle()`. The
 * build minifies the stylesheet, and Lightning CSS rewrites the two alpha
 * tokens to eight-digit hex — `rgba(80,60,30,0.2)` ships as `#503c1e33`, which
 * `setStyle()` cannot parse (it handles three- and six-digit hex only). These
 * literals are not minified, so this module is the stable JavaScript view of
 * the palette.
 */
export const color = {
  /** Page ground (aged paper). */
  bg: '#e7dcc4',
  /** Raised surface — header, cards, sidebars. */
  bg2: '#f1e8d3',
  /** Recessed surface — inputs, thumbnail wells. */
  bg3: '#dfd2b5',
  /** Primary text (dark umber, not black). */
  ink: '#2c2418',
  /** Secondary text, labels, counts. */
  mut: '#79684d',
  /** Accent — links, primary buttons, active state (burnt sienna). */
  acc: '#8f5b21',
  /** Text on accent fills. */
  accink: '#f6efe0',
  /** Secondary accent — "in library" confirmation, storage address (verdigris). */
  acc2: '#5d7a68',
  /** Hairline borders. */
  line: 'rgba(80,60,30,0.2)',
  /** Tag/count chip fill. */
  chip: '#d8caab',
  /** Modal backdrop. */
  scrim: 'rgba(60,45,25,0.4)',
} as const

/**
 * The three faces, loaded in `index.html`.
 *
 * The split is a rule, not a palette: display for headings and the wordmark,
 * body for prose and UI, and mono for every measured fact — counts, sizes,
 * dimensions, tag chips, storage addresses, eyebrow labels.
 */
export const font = {
  /** Alegreya — wordmark, page headings, drawer card titles, empty-state headlines. */
  display: "'Alegreya', 'Iowan Old Style', Palatino, Georgia, serif",
  /** Alegreya Sans — UI and body text; the default `body` face. */
  body: "'Alegreya Sans', ui-sans-serif, system-ui, 'Segoe UI', Helvetica, Arial, sans-serif",
  /** IBM Plex Mono — data. Anything measured is set in this. */
  mono: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
} as const

export type ColorToken = keyof typeof color
export type FontToken = keyof typeof font

/**
 * The custom property a colour token is published under.
 *
 * These are the contract's own names, so `colorVar('ink')` is `--ink`. Setting
 * one on an element retints that subtree, Tailwind utilities included, because
 * the utilities are aliased with `@theme inline`.
 */
export function colorVar<K extends ColorToken>(token: K): `--${K}` {
  return `--${token}`
}

/**
 * The custom property a typeface token is published under.
 *
 * Prefixed to keep the raw layer clear of Tailwind's `--font-*` namespace,
 * which `tokens.css` aliases into: `fontVar('mono')` is `--face-mono`, and the
 * `font-mono` utility resolves through it.
 */
export function fontVar<K extends FontToken>(token: K): `--face-${K}` {
  return `--face-${token}`
}
