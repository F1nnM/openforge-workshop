/**
 * Source hygiene: no raw control byte in a text source file.
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
  const listed = execFileSync('git', ['ls-files', '-z'], {
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
        // another branch, not a hygiene failure.
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
