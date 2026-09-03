/**
 * Turning a configuration into an OpenSCAD command line.
 *
 * Four things here are load-bearing and every one of them is a documented trap
 * rather than a preference:
 *
 * 1. **`--export-format=binstl`, never `-o out.stl` alone.** `export.cc:102`
 *    aliases the `stl` suffix to `asciistl`, so the openscad-wasm README's own
 *    example produces ASCII STL — ~5× the bytes and ~3× the parse cost. A
 *    latency benchmark that inherited that bug would be measuring the exporter.
 *
 * 2. **`--backend` is passed explicitly.** OpenSCAD made Manifold the default on
 *    2025-08-17, but a pinned older build still defaults to CGAL and the flag is
 *    the only thing standing between this harness and a 46× slower kernel. It is
 *    also the axis the sweep varies deliberately, so it is a field, not a
 *    constant.
 *
 * 3. **`"true"` is a string in these files.** `bases-square.scad` writes
 *    `TOPLESS = "true"; // [true, false]` — a *string* domain, not a boolean.
 *    `-D TOPLESS=true` sets an undefined identifier and the comparison
 *    `TOPLESS == "true"` then silently fails. So parameter values carry their
 *    SCAD type and strings are emitted quoted.
 *
 * 4. **`$fn` is refused.** Measured on 2026.01.02: `-D '$fn=50'`, `200` and
 *    `400` all produce byte-identical output, because every `$fn` in the
 *    vendored set is a *call-site argument* (`cylinder(..., $fn=200)`), never a
 *    top-level assignment. A call-site `$fn` cannot be overridden from the
 *    command line. Accepting the flag would produce four identical rows labelled
 *    as four different tessellations, which is worse than refusing it.
 *
 * The `-D` flags are emitted in a stable sorted order so that a configuration
 * has one canonical command line, quotable in a report and comparable between
 * runs.
 */
import { lockRow } from './locks'
import type { LockFamily, LockValue } from './locks'

/** A SCAD value, carrying the type so `-D` can quote it correctly. */
export type ScadValue = { kind: 'number'; value: number } | { kind: 'string'; value: string }

export const num = (value: number): ScadValue => ({ kind: 'number', value })
export const str = (value: string): ScadValue => ({ kind: 'string', value })

/** The two rendering kernels. Varied by the sweep, not assumed. */
export type Backend = 'manifold' | 'cgal'

/** The four bases `bases-*.scad` offers, with their millimetre values. */
export const SQUARE_BASIS: Readonly<Record<string, number>> = {
  '25mm': 25,
  inch: 25.4,
  wyloch: 31.75,
  drc: 38.1,
}

/** One thing to render, once. */
export interface BenchConfig {
  /** Stable id, used as the result key and in the report. */
  readonly id: string
  /** Which sweep this row belongs to, for grouping in the report. */
  readonly suite: string
  /** Entry-point filename inside `src/generator/scad/`, e.g. `bases-square.scad`. */
  readonly entry: string
  /** `-D` parameters. `LOCK`/`SUPPORTS`/`TOPLESS` may come from the lock table. */
  readonly params: Readonly<Record<string, ScadValue>>
  readonly backend: Backend
  /** The catalogued filename label for this lock, when one applies. See `locks.ts`. */
  readonly lockLabel?: { label: string; family: LockFamily }
  /**
   * A ceiling on repeats for this row alone, below the run's `--repeats`.
   *
   * Exists for CGAL. Measured on the WASM engine, `bases-square` 4×4 through CGAL
   * takes 25 s against Manifold's 0.4 s, so a uniform 21 repeats would spend the
   * entire run on rows that exist only to price a flag nobody should drop. The
   * comparison needs a couple of samples, not a distribution.
   */
  readonly maxRepeats?: number
}

/** `$fn` and its friends cannot be set from the command line here. See note 4. */
const REFUSED_PARAMS = ['$fn', '$fa', '$fs'] as const

/** One `-D` argument. */
export function defineArg(name: string, value: ScadValue): string {
  if ((REFUSED_PARAMS as readonly string[]).includes(name)) {
    throw new Error(
      `-D ${name} is refused: every $fn in the vendored .scad set is a call-site ` +
        `argument (cylinder(..., $fn=200)), never a top-level assignment, so a ` +
        `command-line override has no effect. Measured on OpenSCAD 2026.01.02: ` +
        `$fn=50, 200 and 400 give byte-identical output. Accepting it would report ` +
        `identical rows as different tessellations.`,
    )
  }
  return `-D ${name}=${render(value)}`
}

function render(value: ScadValue): string {
  if (value.kind === 'number') {
    if (!Number.isFinite(value.value)) throw new Error(`non-finite -D number: ${String(value.value)}`)
    return String(value.value)
  }
  if (value.value.includes('"')) throw new Error(`-D string value must not contain a quote: ${value.value}`)
  return `"${value.value}"`
}

/**
 * The parameters actually handed to OpenSCAD, with the lock table applied.
 *
 * When `lockLabel` is set, the table's `LOCK`/`SUPPORTS`/`TOPLESS` win over
 * anything of the same name in `params` — the point of the table is that the
 * label does not determine the value, so the label must be authoritative once
 * chosen.
 */
export function resolvedParams(config: BenchConfig): Record<string, ScadValue> {
  const params: Record<string, ScadValue> = { ...config.params }
  if (config.lockLabel !== undefined) {
    const row = lockRow(config.lockLabel.label, config.lockLabel.family)
    params.LOCK = str(row.lock)
    if (row.supports !== undefined) params.SUPPORTS = str(row.supports)
    if (row.topless !== undefined) params.TOPLESS = str(row.topless)
  }
  return params
}

export interface BuildArgsOptions {
  /** Absolute path to the vendored `.scad` directory. Includes resolve beside it. */
  readonly scadDir: string
  /** Absolute path of the STL to write. */
  readonly outPath: string
}

/**
 * The full argv after the engine, in the order the report should quote it.
 *
 * `-D` flags are sorted by name so the same configuration always yields the same
 * command line.
 */
export function buildArgs(config: BenchConfig, options: BuildArgsOptions): string[] {
  if (config.entry.includes('/') || !config.entry.endsWith('.scad')) {
    throw new Error(`entry must be a bare .scad filename in the vendored set, got "${config.entry}"`)
  }
  const params = resolvedParams(config)
  const defines = Object.keys(params)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => defineArg(name, params[name] as ScadValue))
  return [
    `${options.scadDir}/${config.entry}`,
    '-o',
    options.outPath,
    '--export-format=binstl',
    `--backend=${config.backend}`,
    ...defines,
  ]
}

/**
 * Whether the *geometry itself* refuses this configuration — trap 3.
 *
 * `bases-*.scad` `echo("ERROR: …")` and emit nothing when `dragonlock` or
 * `infinitylock` is combined with a non-inch basis. That is not a latency
 * result, and a benchmark that timed the refusal would report a suspiciously
 * fast row for a mesh that does not exist. Detected before the run so the row is
 * recorded as unsupported rather than measured.
 */
export function geometryRefusal(config: BenchConfig): string | undefined {
  const params = resolvedParams(config)
  const basis = params.SQUARE_BASIS
  const lock = params.LOCK
  if (basis === undefined || basis.kind !== 'string') return undefined
  if (lock === undefined || lock.kind !== 'string') return undefined
  if (basis.value === 'inch') return undefined
  if (lock.value === 'dragonlock' || lock.value === 'infinitylock') {
    return `${lock.value} is only compatible with the inch basis; SQUARE_BASIS="${basis.value}" emits no geometry`
  }
  return undefined
}

/** The `-D LOCK` value of a configuration, for grouping. */
export function lockOf(config: BenchConfig): LockValue | undefined {
  const lock = resolvedParams(config).LOCK
  if (lock === undefined || lock.kind !== 'string') return undefined
  return LOCK_SET.has(lock.value) ? (lock.value as LockValue) : undefined
}

const LOCK_SET = new Set<string>(['openlock', 'triplex', 'infinitylock', 'dragonlock', 'none'])
