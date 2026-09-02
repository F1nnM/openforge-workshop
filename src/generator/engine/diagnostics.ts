/**
 * Separating the engine's real complaints from the noise it always makes.
 *
 * OpenSCAD writes warnings, `echo()` output and its own boot grumbles to the
 * same stream, and this build grumbles on **every single run**. Handing all of
 * that to the panel would put three permanent warnings under a base that
 * rendered perfectly, which trains the reader to ignore the fourth one — the
 * real one.
 *
 * Three sources of guaranteed noise, all measured on the vendored release:
 *
 * **`Ignoring unknown variable "DUAL"`.** S2 found this on **48 of 48**
 * configurations: `connectors.scad` at S1's pinned commit references `DUAL` at
 * lines 25, 137 and 291 without any entry point defining it. It is an upstream
 * defect, it is harmless, and it fires several times per render. S2's note is
 * explicit — *"Expect it in engine output; do not treat it as an error."*
 *
 * **`Could not initialize localization`.** The WASM build has no message
 * catalogue on its virtual filesystem. Once per boot, and there is one boot per
 * render.
 *
 * **`Fontconfig error: Cannot load default config file`.** No font config in the
 * image either. Irrelevant to a base with no text in it.
 *
 * Everything else is passed through untouched. In particular `ECHO:` lines are
 * kept: `connectors.scad` echoes the resolved magnet type, which is the geometry
 * telling you what it decided, and `ERROR:` lines are the documented refusal
 * path — S1 recorded that `bases-*.scad` `echo("ERROR: …")` and emit nothing
 * when `dragonlock` or `infinitylock` meets a non-inch `SQUARE_BASIS`. Those
 * must reach the user, because the alternative is an empty mesh and no reason.
 */

/** A line the engine printed, once classified. */
export interface Diagnostic {
  readonly kind: 'error' | 'warning' | 'echo' | 'other'
  readonly text: string
}

export interface Diagnostics {
  /** Lines worth showing, in the order printed, deduplicated. */
  readonly notable: readonly Diagnostic[]
  /** How many lines were dropped as known noise. Reported, not hidden. */
  readonly suppressed: number
  /**
   * Whether the engine printed an `ERROR:`. OpenSCAD's refusal path is an
   * `echo`, not a non-zero status, so this is the only way to see it.
   */
  readonly failed: boolean
}

/**
 * Lines this build emits on every run regardless of input.
 *
 * Matched as substrings against the whole line rather than anchored, because
 * OpenSCAD prefixes some of them with `WARNING: ` and the file and line number
 * vary with the working directory.
 */
const ALWAYS_NOISE = [
  'Ignoring unknown variable "DUAL"',
  'Could not initialize localization',
  'Fontconfig error: Cannot load default config file',
] as const

/**
 * Partition captured output.
 *
 * Deduplicates on the exact text: the `DUAL` warning aside, a real warning
 * repeated once per lock instance is one fact, and a panel listing it eleven
 * times is less readable than one listing it once.
 */
export function classifyOutput(lines: readonly string[]): Diagnostics {
  const notable: Diagnostic[] = []
  const seen = new Set<string>()
  let suppressed = 0

  for (const raw of lines) {
    const text = raw.trimEnd()
    if (text === '') continue
    if (ALWAYS_NOISE.some((noise) => text.includes(noise))) {
      suppressed += 1
      continue
    }
    if (seen.has(text)) continue
    seen.add(text)
    notable.push({ kind: classify(text), text })
  }

  return { notable, suppressed, failed: notable.some((diagnostic) => diagnostic.kind === 'error') }
}

function classify(text: string): Diagnostic['kind'] {
  // `ERROR:` inside an ECHO is the geometry's own refusal, which is the case
  // that matters most, so it is checked before the ECHO prefix.
  if (/\bERROR\b/.test(text)) return 'error'
  if (text.startsWith('WARNING:')) return 'warning'
  if (text.startsWith('ECHO:')) return 'echo'
  return 'other'
}
