/**
 * Running the sweep, and recording enough to reproduce it.
 *
 * A latency number without its engine version is not a measurement, so every
 * result carries the engine, its version, the backend and the exact argv. The
 * argv is stored verbatim rather than reconstructed for the report, because the
 * point of quoting it is that somebody can paste it.
 *
 * The repeat model is one process per render, which is what the shipped design
 * does too: `docs/base-generator-integration.md` §2 specifies a *fresh*
 * `OpenSCAD()` instance per job, terminated afterwards, precisely so a failed
 * render cannot poison the next one. So the per-run cost includes engine
 * start-up on every run, and `startupFloor` measures that start-up separately —
 * against a near-empty model on the same engine — so the report can say how much
 * of a figure is fixed cost that a browser worker holding a compiled
 * `WebAssembly.Module` would not pay again.
 *
 * There is no concurrency. Timing several renders at once on a 12-thread laptop
 * measures the scheduler.
 */
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildArgs, geometryRefusal, lockOf, resolvedParams } from './args'
import type { BenchConfig } from './args'
import { STARTUP_FLOOR_SOURCE } from './engine'
import type { Engine } from './engine'
import { echoedErrors, readStl, unknownVariables } from './stl'
import type { Timings } from './stats'

/** One render's outcome. */
export type Outcome = 'measured' | 'refused' | 'failed'

export interface BenchResult {
  readonly id: string
  readonly suite: string
  readonly outcome: Outcome
  /** Present for `measured`. */
  readonly timings?: Timings
  readonly triangles?: number
  readonly bytes?: number
  /** Present for `refused` and `failed`. */
  readonly reason?: string
  /** The argv after the engine, verbatim. Quotable. */
  readonly argv: readonly string[]
  readonly backend: string
  readonly lock?: string
  /** The catalogued filename label, when the config named one. Trap 1. */
  readonly lockLabel?: string
  readonly entry: string
  readonly params: Readonly<Record<string, string>>
  /** `Ignoring unknown variable "X"` from the engine, deduplicated. */
  readonly unknownVariables?: readonly { name: string; occurrences: number }[]
}

export interface RunOptions {
  readonly engine: Engine
  readonly scadDir: string
  /** Renders per configuration. The first is cold; the rest are warm. */
  readonly repeats: number
  /** Per-render wall-clock ceiling. */
  readonly timeoutMs: number
  readonly onResult?: (result: BenchResult) => void
}

export interface RunReport {
  readonly engine: Engine
  readonly results: readonly BenchResult[]
  /** Fixed cost of one render on this engine: `cube(0.01)`, same flags. */
  readonly startupFloor: Timings
  readonly elapsedMs: number
}

interface Spawned {
  readonly ms: number
  readonly stdout: string
  readonly stderr: string
  readonly code: number | null
  readonly timedOut: boolean
}

async function spawnOnce(engine: Engine, argv: readonly string[], timeoutMs: number): Promise<Spawned> {
  const started = performance.now()
  return await new Promise<Spawned>((resolve) => {
    execFile(
      engine.command,
      [...engine.prefix, ...argv],
      { timeout: timeoutMs, maxBuffer: 64 << 20, killSignal: 'SIGKILL' },
      (error, stdout, stderr) => {
        const ms = performance.now() - started
        const killed = error !== null && 'killed' in error && error.killed === true
        const code = error !== null && 'code' in error && typeof error.code === 'number' ? error.code : 0
        resolve({ ms, stdout, stderr, code: error === null ? 0 : code, timedOut: killed })
      },
    )
  })
}

/**
 * Render one configuration `repeats` times.
 *
 * A configuration the geometry refuses (trap 3) is not run at all: it exits 0 and
 * writes an 84-byte STL very quickly, and timing that would put the fastest row
 * in the table next to a mesh that does not exist.
 */
export async function benchOne(config: BenchConfig, options: RunOptions, workDir: string): Promise<BenchResult> {
  const outPath = join(workDir, `${config.id.replace(/[^\w.-]/g, '_')}.stl`)
  const argv = buildArgs(config, { scadDir: options.scadDir, outPath })
  const params = Object.fromEntries(
    Object.entries(resolvedParams(config)).map(([name, value]) => [name, String(value.value)]),
  )
  const base = {
    id: config.id,
    suite: config.suite,
    argv,
    backend: config.backend,
    entry: config.entry,
    params,
    ...(lockOf(config) === undefined ? {} : { lock: lockOf(config) }),
    ...(config.lockLabel === undefined
      ? {}
      : { lockLabel: `${config.lockLabel.family}:${config.lockLabel.label}` }),
  }

  const refusal = geometryRefusal(config)
  if (refusal !== undefined) return { ...base, outcome: 'refused', reason: refusal }

  const repeats = Math.max(1, Math.min(options.repeats, config.maxRepeats ?? options.repeats))
  const samples: number[] = []
  let triangles = 0
  let bytes = 0
  let unknowns: { name: string; occurrences: number }[] = []

  for (let attempt = 0; attempt < repeats; attempt += 1) {
    rmSync(outPath, { force: true })
    const spawned = await spawnOnce(options.engine, argv, options.timeoutMs)
    if (spawned.timedOut) {
      return { ...base, outcome: 'failed', reason: `timed out after ${String(options.timeoutMs)} ms` }
    }
    const echoed = echoedErrors(spawned.stderr)
    let data: Uint8Array
    try {
      data = readFileSync(outPath)
    } catch {
      const detail = echoed.length > 0 ? echoed.join(' · ') : `exit ${String(spawned.code)}`
      return { ...base, outcome: 'failed', reason: `no output written: ${detail}` }
    }
    const parsed = readStl(data)
    if (!parsed.ok) {
      const detail = echoed.length > 0 ? `${parsed.reason} · ${echoed.join(' · ')}` : parsed.reason
      return { ...base, outcome: 'failed', reason: detail }
    }
    samples.push(spawned.ms)
    triangles = parsed.summary.triangles
    bytes = parsed.summary.bytes
    if (attempt === 0) unknowns = unknownVariables(spawned.stderr)
  }
  rmSync(outPath, { force: true })

  const [cold, ...warm] = samples
  return {
    ...base,
    outcome: 'measured',
    timings: { cold: cold as number, warm },
    triangles,
    bytes,
    ...(unknowns.length > 0 ? { unknownVariables: unknowns } : {}),
  }
}

/**
 * The fixed cost of one render on this engine.
 *
 * A near-empty model through the same flags on the same engine. Written into the
 * work directory rather than the vendored `.scad` tree, which is read-only S1
 * territory.
 */
export async function measureStartupFloor(options: RunOptions, workDir: string): Promise<Timings> {
  const source = join(workDir, '__floor.scad')
  const outPath = join(workDir, '__floor.stl')
  writeFileSync(source, STARTUP_FLOOR_SOURCE)
  const argv = [source, '-o', outPath, '--export-format=binstl', '--backend=manifold']
  const samples: number[] = []
  for (let attempt = 0; attempt < options.repeats; attempt += 1) {
    rmSync(outPath, { force: true })
    const spawned = await spawnOnce(options.engine, argv, options.timeoutMs)
    if (spawned.timedOut) throw new Error('the startup floor render timed out — the engine is not usable')
    samples.push(spawned.ms)
  }
  const [cold, ...warm] = samples
  return { cold: cold as number, warm }
}

/** The whole sweep, sequentially. */
export async function runSweep(configs: readonly BenchConfig[], options: RunOptions): Promise<RunReport> {
  const workDir = mkdtempSync(join(tmpdir(), 'scad-bench-'))
  mkdirSync(workDir, { recursive: true })
  const started = performance.now()
  try {
    const startupFloor = await measureStartupFloor(options, workDir)
    const results: BenchResult[] = []
    for (const config of configs) {
      const result = await benchOne(config, options, workDir)
      results.push(result)
      options.onResult?.(result)
    }
    return { engine: options.engine, results, startupFloor, elapsedMs: performance.now() - started }
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}
