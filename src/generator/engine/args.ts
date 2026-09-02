/**
 * OpenSCAD's argv, built rather than concatenated — and `--backend=manifold`
 * made impossible to omit.
 *
 * ## Why the backend flag is not an option
 *
 * Row S2 measured both backends on this exact engine release. WASM CGAL, the
 * default, is **7.8 s at 2×2 and 16.0 s at 4×4**. The architecture plan's
 * threshold is ~3 s, past which *"the design needs an explicit Generate
 * button"*, so the default is five times over it. Manifold is **437 ms median,
 * 481 ms p95 at 4×4** — comfortably inside an auto-preview budget.
 *
 * That is a 33× spread hiding behind one flag, and the failure is silent: a
 * forgotten `--backend=manifold` produces correct geometry, slowly, and the
 * observable consequence is a UX decision made by accident. So
 * {@link renderArgs} always emits it and {@link assertManifoldBackend} refuses
 * an argv without it. The worker calls the assertion on every argv it is about
 * to run, including one it did not build itself.
 *
 * ## Why `$fn` is refused rather than accepted
 *
 * S2 also established that **there is no tessellation lever**: every `$fn` in
 * the vendored geometry is a call-site argument, so `-D '$fn=50'` produces
 * byte-identical output. Accepting a `$fn` parameter would offer a quality
 * slider that does nothing, and "does nothing, silently" is the failure mode
 * this whole module is arranged against. Any `$`-prefixed name is rejected with
 * that reason attached.
 */

/** The one flag that must always be there. */
export const MANIFOLD_BACKEND = '--backend=manifold'

/**
 * Output formats worth exposing. `binstl` is the default because the download
 * pack and the STL parser both want binary, and ASCII is ~5× the bytes.
 */
export type ExportFormat = 'binstl' | 'asciistl' | 'off' | '3mf'

/** Where the engine writes, inside its own filesystem. Never a host path. */
export const OUTPUT_PATH = 'out.stl'

/** The file the schema export is written to, inside the engine's filesystem. */
export const SCHEMA_PATH = 'schema.json'

export class EngineArgsError extends Error {
  override readonly name = 'EngineArgsError'
}

/** A parameter assignment, before it becomes a `-D` token. */
export type ParameterAssignment = number | string | boolean | readonly number[]

export interface RenderArgsRequest {
  /** An entry-point filename, e.g. `bases-square.scad`. Bare, never a path. */
  readonly entry: string
  /** `-D` assignments. An empty record renders the file's own defaults. */
  readonly parameters: Readonly<Record<string, ParameterAssignment>>
  /** Defaults to `binstl`. */
  readonly format?: ExportFormat
}

/**
 * The argv for one render.
 *
 * `--backend=manifold` comes first so that reading a failing command in a log
 * makes the backend the first thing visible, and so a reviewer scanning for it
 * does not have to reach the end of a 30-token line.
 */
export function renderArgs(request: RenderArgsRequest): readonly string[] {
  const format = request.format ?? 'binstl'
  return [
    MANIFOLD_BACKEND,
    `--export-format=${format}`,
    '-o',
    OUTPUT_PATH,
    ...defines(request.parameters),
    entryPath(request.entry),
  ]
}

/**
 * The argv for a schema export.
 *
 * It carries the backend flag too, even though `--export-format=param` runs no
 * CSG: OpenSCAD still instantiates the geometry tree to evaluate the file, and
 * an argv that is exempt from the rule is an argv somebody copies.
 */
export function schemaArgs(entry: string): readonly string[] {
  return [MANIFOLD_BACKEND, '--export-format=param', '-o', SCHEMA_PATH, entryPath(entry)]
}

/**
 * Throw unless the argv selects Manifold.
 *
 * Deliberately not a boolean. A caller that has to remember to check the return
 * value is a caller that can forget, and the cost of forgetting is 16 seconds.
 */
export function assertManifoldBackend(argv: readonly string[]): void {
  const backends = argv.filter((token) => token.startsWith('--backend'))
  if (backends.length === 0) {
    throw new EngineArgsError(
      `refusing to run OpenSCAD without ${MANIFOLD_BACKEND}: the default backend is WASM CGAL, ` +
        'measured at 7.8 s for a 2x2 base and 16.0 s for a 4x4 against a ~3 s budget',
    )
  }
  const wrong = backends.filter((token) => token !== MANIFOLD_BACKEND)
  if (wrong.length > 0) {
    throw new EngineArgsError(
      `refusing to run OpenSCAD with ${wrong.join(' ')}: only ${MANIFOLD_BACKEND} is fast enough`,
    )
  }
}

/**
 * `-D name=value` pairs.
 *
 * There is no shell here — each token is passed to `main` as its own `argv`
 * entry — so the quoting is OpenSCAD's expression syntax, not a shell's. A
 * string value must arrive as `LOCK="openlock"`, because bare `LOCK=openlock`
 * parses as an undefined *variable* reference and yields `undef`. That failure
 * is silent too: the geometry builds, with the parameter unset.
 */
function defines(parameters: Readonly<Record<string, ParameterAssignment>>): string[] {
  return Object.entries(parameters).flatMap(([name, value]) => ['-D', `${define(name)}=${literal(name, value)}`])
}

function define(name: string): string {
  if (name.startsWith('$')) {
    throw new EngineArgsError(
      `refusing to set ${name}: every $-variable in the vendored geometry is a call-site argument, ` +
        'so -D on one is a no-op that would advertise a control with no effect',
    )
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new EngineArgsError(`${name} is not an OpenSCAD identifier`)
  }
  return name
}

function literal(name: string, value: ParameterAssignment): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new EngineArgsError(`${name} is ${String(value)}, which OpenSCAD cannot parse`)
    return String(value)
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  // A string is tested for rather than an array: `Array.isArray` does not narrow
  // a `readonly T[]` out of a union, so the array case has to be the remainder.
  if (typeof value === 'string') return `"${quote(name, value)}"`
  for (const entry of value) {
    if (!Number.isFinite(entry)) throw new EngineArgsError(`${name} contains ${String(entry)}`)
  }
  return `[${value.map((entry) => String(entry)).join(',')}]`
}

/**
 * Escape a string for an OpenSCAD double-quoted literal.
 *
 * Control characters are refused rather than escaped. Every string value in this
 * geometry comes from a customizer enum — `"openlock"`, `"inch"`,
 * `"flex_magnetic"` — so a newline in one means the caller built the request
 * from something other than the schema, and guessing what they meant is worse
 * than saying so.
 */
function quote(name: string, value: string): string {
  // The control characters are the point of the check, not an accident.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/u.test(value)) {
    throw new EngineArgsError(`${name} contains a control character, which no schema option does`)
  }
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

/**
 * The entry point, as the engine's filesystem sees it.
 *
 * S1 verified that all 39 `include` statements in the vendored set are **bare
 * filenames** — no `/`, no `..`, 19 distinct targets, zero dangling — which is
 * what lets the virtual filesystem be a flat map. The same has to hold for the
 * argv: a path here would put the working directory somewhere the flat map is
 * not, and every include would then fail to resolve.
 */
function entryPath(entry: string): string {
  if (entry === '' || entry.includes('/') || entry.includes('\\') || entry.includes('..')) {
    throw new EngineArgsError(`${entry} is not a bare filename; the virtual filesystem is flat`)
  }
  if (!entry.endsWith('.scad')) throw new EngineArgsError(`${entry} is not a .scad file`)
  return entry
}
