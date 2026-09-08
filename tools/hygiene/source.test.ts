/**
 * Source hygiene: two rules the type system cannot state.
 *
 * One is about bytes in a source file. The other is about a rendering primitive
 * whose size is silently tied to the display — see *"Device-dependent line
 * widths"* below.
 *
 * ## Why this exists
 *
 * Five files in this repo used a control character as a delimiter and wrote it
 * as the character itself rather than as an escape:
 *
 *   record.tags.map(...).join('<a literal NUL byte>')
 *
 * The string is identical either way, so nothing failed and no test caught it.
 * What it cost was reviewability. Git decides text-versus-binary by scanning for
 * a NUL, so those files diffed as
 *
 *   pipeline/catalog.test.ts | Bin 17346 -> 23273 bytes
 *
 * A file that diffs as `Bin` cannot be reviewed, cannot be blamed line by line,
 * and drops out of every grep-shaped tool. In a series whose whole premise is
 * small reviewable diffs, that is the defect — not the byte.
 *
 * ## What counts
 *
 * Tab, newline and carriage return are ordinary text. Everything else below
 * 0x20 is rejected: the NUL that trips git's binary heuristic, and the
 * neighbouring control characters that break terminals and diff viewers without
 * tripping it.
 *
 * The remedy is never to remove the delimiter. It is a good delimiter, precisely
 * because it cannot occur in a tag or a filename. Write it as an escape.
 *
 * ## Device-dependent line widths
 *
 * `THREE.LineSegments` and `THREE.Line` draw `gl.LINES`, and WebGL renders those
 * at **exactly one device pixel**; `LineBasicMaterial.linewidth` is ignored on
 * every platform this app runs on. So the width of such a line is never written
 * down anywhere — it is whatever `devicePixelRatio` happens to be — and it moves
 * when something entirely unrelated moves.
 *
 * It did. Raising the dpr floor to 2 to stop the room looking pixelated took the
 * floor grid, the plate rings and the plan caret from 0.91 CSS px to 0.5 CSS px
 * in one commit, and the grid began breaking into dashes because a half-pixel
 * line cannot cover a pixel. No line of code about any of them changed, and no
 * test failed.
 *
 * `src/three/ScreenLine.tsx` is the replacement, and its width is in
 * device-independent pixels by construction. This rule stops the old primitive
 * coming back: it is the kind of mistake that is invisible in review, because
 * `<lineSegments>` is exactly what you would write.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * Extensions this asserts over. Deliberately an allowlist of text formats rather
 * than a denylist of binary ones: a new binary fixture should not have to know
 * this test exists, whereas a new `.ts` file should be covered the day it lands.
 */
const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.css',
  '.json',
  '.jsonc',
  '.py',
  '.md',
  '.html',
  '.yml',
  '.yaml',
  '.scad',
  '.txt',
])

/** Tab, newline, carriage return. Nothing else below 0x20 is text. */
const ALLOWED_CONTROL = new Set([0x09, 0x0a, 0x0d])

const NUL_SEPARATOR = '\u0000'

function trackedTextFiles(): string[] {
  // `git ls-files` rather than a directory walk: it already honours .gitignore,
  // so build output and downloaded fixtures cannot make this test fail.
  //
  // `--others --exclude-standard` alongside `--cached` is not optional. Without
  // them the listing is tracked files only, so a brand-new file carrying a raw
  // NUL passes locally — it is not tracked yet — and fails in CI, where the
  // commit has made it tracked. That happened exactly once, on the row that
  // added `src/catalog/aggregate.ts`, and cost a red build to learn.
  const listed = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  return listed
    .split(NUL_SEPARATOR)
    .filter((path) => path !== '')
    .filter((path) => TEXT_EXTENSIONS.has(extname(path)))
}

function controlBytes(bytes: Buffer): { offset: number; byte: number }[] {
  const found: { offset: number; byte: number }[] = []
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i]
    if (byte === undefined) continue
    if (byte < 0x20 && !ALLOWED_CONTROL.has(byte)) found.push({ offset: i, byte })
  }
  return found
}

/**
 * The device-dependent primitives, as they appear in r3f's JSX and in three's own
 * API. Matched as source text rather than by parsing: a regex over the tracked
 * files is the whole implementation, and the failure it produces names the file.
 */
const DEVICE_DEPENDENT_LINES: readonly { pattern: RegExp; what: string }[] = [
  { pattern: /<lineSegments[\s/>]/, what: '<lineSegments>' },
  { pattern: /<lineBasicMaterial[\s/>]/, what: '<lineBasicMaterial>' },
  { pattern: /<gridHelper[\s/>]/, what: '<gridHelper>' },
  { pattern: /new\s+LineBasicMaterial\b/, what: 'new LineBasicMaterial' },
]

/**
 * Files allowed to name them, and why each one is.
 *
 * `ScreenLine.tsx` is the replacement and explains the rule; the hygiene test
 * itself has to contain the patterns to check for them. Nothing else should be
 * on this list — a new entry is the thing this rule exists to make someone argue
 * for.
 */
const LINE_RULE_EXEMPT = new Set(['src/three/ScreenLine.tsx', 'tools/hygiene/source.test.ts'])

/**
 * Code with the comments taken out.
 *
 * The rule is about what the renderer is asked to draw, and this repository
 * documents heavily — several files explain the banned primitive at length,
 * including the one that replaced it. A check that could not tell a docblock
 * from a call site would make the rule unwriteable in prose, which is the
 * opposite of what it is for.
 *
 * Crude on purpose: block comments, then line comments where the `//` is not
 * preceded by a colon, so a `https://` inside a string survives. It only has to
 * be good enough to tell JSX from prose.
 */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

describe('source hygiene', () => {
  it('finds text files to check, so a broken listing cannot pass vacuously', () => {
    const files = trackedTextFiles()
    expect(files.length).toBeGreaterThan(100)
    expect(files).toContain('pipeline/catalog.test.ts')
  })

  it('has no raw control byte in any tracked text file', () => {
    const offenders: string[] = []
    for (const path of trackedTextFiles()) {
      let bytes: Buffer
      try {
        bytes = readFileSync(resolve(REPO_ROOT, path))
      } catch {
        // Listed by git but absent from the working tree: a deletion staged on
        // another branch, or a path listed while being rewritten. Not a hygiene
        // failure.
        continue
      }
      const found = controlBytes(bytes)
      if (found.length === 0) continue
      const shown = found
        .slice(0, 4)
        .map(({ offset, byte }) => `0x${byte.toString(16).padStart(2, '0')}@${String(offset)}`)
        .join(', ')
      offenders.push(`${path}: ${String(found.length)} (${shown})`)
    }

    // The message carries the remedy, because the instinct on reading this
    // failure is to delete the delimiter rather than to escape it.
    expect(
      offenders,
      'Write the delimiter as an escape, not as the byte itself. A raw NUL makes git treat the file as binary, so it diffs as "Bin" and cannot be reviewed.',
    ).toEqual([])
  })
})

describe('device-independent line widths', () => {
  it('checks the files that would carry the primitive, so this cannot pass vacuously', () => {
    const checked = trackedTextFiles().filter((path) => path.endsWith('.tsx') && path.startsWith('src/'))
    expect(checked.length).toBeGreaterThan(10)
    expect(checked).toContain('src/builder/three/RoomSurface.tsx')
  })

  it('draws no line whose width is one device pixel', () => {
    const offenders: string[] = []
    for (const path of trackedTextFiles()) {
      if (!path.startsWith('src/')) continue
      if (LINE_RULE_EXEMPT.has(path)) continue
      let text: string
      try {
        text = withoutComments(readFileSync(resolve(REPO_ROOT, path), 'utf8'))
      } catch {
        continue
      }
      for (const { pattern, what } of DEVICE_DEPENDENT_LINES) {
        if (pattern.test(text)) offenders.push(`${path}: ${what}`)
      }
    }

    expect(
      offenders,
      'WebGL draws gl.LINES at one device pixel and ignores `linewidth`, so these scale with devicePixelRatio and their width is never stated anywhere. Use `<ScreenLine>` (src/three/ScreenLine.tsx), whose width is in CSS pixels.',
    ).toEqual([])
  })
})
