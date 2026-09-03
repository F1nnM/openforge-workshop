/**
 * Reading the engine's version, and the exit-code trap that cost row S2 a run.
 *
 * S2 hit this and wrote it down: *"The WASM build exits 7 on `--version` while
 * printing to stderr. S2's first probe trusted the exit code and silently fell
 * through to native."* A probe that reads the status and not the output
 * concludes there is no WASM engine, picks the native binary instead, and
 * publishes native latency figures under a WASM heading. Nothing errors.
 *
 * In-process the trap is worse, not better. Measured on the vendored
 * `2026.01.02.wasm30346` build, driven through Emscripten's `callMain`:
 *
 * | argv | `callMain` returns | throws | version text |
 * | --- | --- | --- | --- |
 * | `--version` | `undefined` | **yes** — `program has already aborted!` | on **stderr** |
 * | `--info` | **`1`** | no | on stdout |
 * | a successful render | `0` | no | — |
 *
 * So `--version` does not merely exit non-zero: OpenSCAD's `exit(7)` becomes an
 * Emscripten `ExitStatus`, which surfaces as a thrown error *after* the text has
 * already been printed. And `--info` returns 1 for an unrelated reason — it
 * cannot create an offscreen GL context in WebAssembly — so even a "non-zero
 * means broken" rule misclassifies the one call that reports the source commit.
 *
 * The rule this module enforces: **the output is the signal, the status is
 * noise.** {@link parseVersion} is given whatever was captured, from either
 * stream, and the *only* failure is the absence of a version line.
 */

export interface EngineVersion {
  /** The whole line, verbatim: `OpenSCAD version 2026.01.02.wasm30346`. */
  readonly line: string
  /** Just the version: `2026.01.02.wasm30346`. */
  readonly version: string
  /**
   * The OpenSCAD commit, when the output was `--info` rather than `--version`.
   * `--version` does not print it, so this is `null` for that call.
   */
  readonly commit: string | null
}

export class EngineVersionError extends Error {
  override readonly name = 'EngineVersionError'
}

/** `OpenSCAD version 2026.01.02.wasm30346` — what `--version` prints. */
const VERSION_LINE = /OpenSCAD version\s+(\S+)/i

/**
 * `OpenSCAD Version: 2026.01.02.wasm30346 (git 7a2053ed)` — what `--info` prints.
 * Different capitalisation, a colon, and the commit. Both are matched because
 * either call may be the one that produced the text.
 */
const INFO_LINE = /OpenSCAD Version:\s+(\S+)(?:\s+\(git\s+([0-9a-f]+)\))?/i

/**
 * Extract the version from captured engine output.
 *
 * @param lines Everything captured, stdout and stderr together and in any
 *   order. Which stream carried it is an Emscripten detail, and a caller that
 *   had to know would be a caller that can get it wrong.
 */
export function parseVersion(lines: readonly string[]): EngineVersion {
  for (const line of lines) {
    const info = INFO_LINE.exec(line)
    if (info?.[1] !== undefined) {
      return { line: line.trim(), version: info[1], commit: info[2] ?? null }
    }
  }
  for (const line of lines) {
    const version = VERSION_LINE.exec(line)
    if (version?.[1] !== undefined) {
      return { line: line.trim(), version: version[1], commit: null }
    }
  }
  throw new EngineVersionError(
    'the engine printed no version line. Note that this is the only reliable signal: ' +
      'the WASM build exits 7 on --version and returns 1 from --info, so neither status ' +
      'distinguishes a working engine from a broken one',
  )
}

/**
 * Whether captured output is sufficient to call an engine present.
 *
 * The boolean companion to {@link parseVersion}, for the one caller that wants
 * to branch rather than throw. It exists so nobody reaches for `exitCode === 0`.
 */
export function looksLikeOpenScad(lines: readonly string[]): boolean {
  return lines.some((line) => VERSION_LINE.test(line) || INFO_LINE.test(line))
}
