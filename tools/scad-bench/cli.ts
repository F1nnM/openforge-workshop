#!/usr/bin/env tsx
/**
 * Time OpenSCAD rendering the vendored base geometry, so row S4 can decide
 * whether the parameter panel auto-previews or needs a Generate button.
 *
 *     npm run scad-bench                       # the default sweep, WASM if present
 *     npm run scad-bench -- --suite size,plan  # just those suites
 *     npm run scad-bench -- --repeats 21       # 21 renders each: a real p95
 *     npm run scad-bench -- --engine .engines/squashfs-root/AppRun
 *     npm run scad-bench -- --json out/bench.json
 *     npm run scad-bench -- --plan             # what would run, no engine needed
 *
 * From `docs/architecture-plan.md` §12:
 *
 * > **Render latency is unmeasured.** OpenSCAD was not installed on any machine
 * > used for this research, so no render was timed. […] A v0 spike must measure it
 * > before the UX commits to auto-preview; if a 4×4 base exceeds ~3 s, the design
 * > needs an explicit Generate button.
 *
 * This is that spike. It **fails loudly with no engine** rather than estimating:
 * the plan already has estimates, and a second set wearing a benchmark's
 * formatting would be worse than none. See `engine.ts`.
 *
 * **Nothing is vendored and nothing is shipped.** `.engines/` is gitignored, no
 * engine enters `src/`, `vendor/` or the bundle, and `vite.config.ts` is
 * untouched. Bundling the GPL-2 WASM engine is blocker **B4** and row **S3**;
 * running OpenSCAD locally to time it conveys nothing to anyone and raises no
 * licence question.
 *
 * Run under `tsx` for the same reason the other tools are.
 */
import { cpus, release, totalmem } from 'node:os'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { arch, platform } from 'node:process'

import { buildArgs, geometryRefusal } from './args'
import type { EngineKind } from './engine'
import { resolveEngine } from './engine'
import { fullReport, recommend, reportFromSaved } from './report'
import type { Machine, SavedRun } from './report'
import { runSweep } from './run'
import type { BenchResult } from './run'
import { DEFAULT_SUITES, SUITES, parseSuites, sweep } from './sweep'
import type { Suite } from './sweep'

const TOOL_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(TOOL_DIR, '..', '..')
const SCAD_DIR = join(REPO_ROOT, 'src', 'generator', 'scad')

/**
 * Renders per configuration.
 *
 * 7 is a compromise, and the report says so rather than hiding it: nearest-rank
 * p95 over 7 samples is the maximum. It is enough to see whether a configuration
 * is stable and cheap enough that the default sweep finishes in seconds. Pass
 * `--repeats 21` for a p95 that is an actual quantile.
 */
const DEFAULT_REPEATS = 7

/** Generous. The plan's own watchdog is 45 s; this is per render. */
const DEFAULT_TIMEOUT_MS = 120_000

interface Args {
  suites: Suite[]
  repeats: number
  timeoutMs: number
  engine?: string
  engineKind?: EngineKind
  json?: string
  planOnly: boolean
  heavy: boolean
  fromJson?: string
}

const USAGE = `Usage: npm run scad-bench -- [options]

  --suite LIST      comma-separated suites (default ${DEFAULT_SUITES.join(',')})
                    known: ${SUITES.join(', ')}
  --repeats N       renders per configuration (default ${String(DEFAULT_REPEATS)}; use 21+ for a real p95)
  --timeout MS      per-render ceiling (default ${String(DEFAULT_TIMEOUT_MS)})
  --engine PATH     an OpenSCAD binary, or the WASM glue (.cjs/.js/.mjs)
  --engine-kind K   native | wasm — only needed when the path does not say
  --json PATH       write the full result set as JSON
  --heavy           add 8×8 to the backend suite: minutes per CGAL render
  --plan            print the configurations and their command lines; no engine needed
  --report PATH     re-print the report from a saved --json run; no engine needed
  --help

Engines are never vendored: .engines/ is gitignored, nothing enters src/, vendor/
or the bundle. Bundling the GPL-2 WASM engine is blocker B4 and row S3.

  OPENSCAD=/usr/bin/openscad         npm run scad-bench
  OPENSCAD_WASM=/path/openscad.cjs   npm run scad-bench

With no engine at all this exits non-zero with fetch commands. It does not estimate.
`

function machine(): Machine {
  const cores = cpus()
  return {
    platform,
    release: release(),
    arch,
    cpu: cores[0]?.model.trim() ?? 'unknown',
    cores: cores.length,
    memoryGb: Math.round(totalmem() / 1e9),
    node: process.versions.node,
  }
}

async function main(argv: readonly string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE)
    return 0
  }
  const args = parseArgs(argv)

  if (args.fromJson !== undefined) {
    const saved = JSON.parse(readFileSync(args.fromJson, 'utf8')) as SavedRun
    process.stdout.write(reportFromSaved(saved))
    return 0
  }

  const configs = sweep(args.suites, { heavy: args.heavy })

  if (args.planOnly) {
    process.stdout.write(planText(configs, args))
    return 0
  }

  const engine = await resolveEngine({
    toolDir: TOOL_DIR,
    repoRoot: REPO_ROOT,
    ...(args.engine === undefined ? {} : { explicit: args.engine }),
    ...(args.engineKind === undefined ? {} : { explicitKind: args.engineKind }),
  })

  process.stdout.write(
    `running       ${String(configs.length)} configurations × ${String(args.repeats)} renders on ` +
      `${engine.kind} ${engine.version}\n`,
  )

  const report = await runSweep(configs, {
    engine,
    scadDir: SCAD_DIR,
    repeats: args.repeats,
    timeoutMs: args.timeoutMs,
    onResult: (result) => {
      process.stdout.write(`  ${progressLine(result)}\n`)
    },
  })

  process.stdout.write(fullReport(report, machine(), args.repeats, args.suites))

  if (args.json !== undefined) {
    mkdirSync(dirname(args.json), { recursive: true })
    writeFileSync(
      args.json,
      `${JSON.stringify(
        {
          engine: {
            kind: engine.kind,
            version: engine.version,
            source: engine.source,
            command: engine.command,
            prefix: engine.prefix,
          },
          machine: machine(),
          repeats: args.repeats,
          suites: args.suites,
          scadDir: SCAD_DIR,
          startupFloor: report.startupFloor,
          recommendation: recommend(report),
          results: report.results,
          elapsedMs: report.elapsedMs,
        },
        null,
        2,
      )}\n`,
    )
    process.stdout.write(`json          ${args.json}\n`)
  }

  const failed = report.results.filter((result) => result.outcome === 'failed')
  if (failed.length > 0) {
    process.stderr.write(`\n${String(failed.length)} configuration(s) failed:\n`)
    for (const result of failed) process.stderr.write(`  ${result.id}: ${result.reason ?? 'unknown'}\n`)
    return 1
  }
  return 0
}

function progressLine(result: BenchResult): string {
  if (result.outcome === 'measured') {
    const warm = result.timings?.warm ?? []
    const best = warm.length > 0 ? Math.min(...warm) : (result.timings?.cold ?? 0)
    return `${result.id.padEnd(36)} ${best.toFixed(0).padStart(6)} ms  ${String(result.triangles ?? 0).padStart(7)} tris`
  }
  return `${result.id.padEnd(36)} ${result.outcome}: ${result.reason ?? ''}`
}

/** `--plan`: everything the run would do, computable with no engine present. */
function planText(configs: readonly ReturnType<typeof sweep>[number][], args: Args): string {
  const lines = [
    `plan          ${String(configs.length)} configurations × ${String(args.repeats)} renders`,
    `  suites      ${args.suites.join(', ')}`,
    `  scad        ${SCAD_DIR}`,
    '',
  ]
  for (const config of configs) {
    const refusal = geometryRefusal(config)
    const argv = buildArgs(config, { scadDir: SCAD_DIR, outPath: '<out>.stl' })
    lines.push(`  ${config.id}${refusal === undefined ? '' : `  (refused: ${refusal})`}`)
    lines.push(`      openscad ${argv.join(' ')}`)
  }
  lines.push('', '  No engine was needed to produce this. Nothing was rendered.', '')
  return lines.join('\n')
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    suites: [...DEFAULT_SUITES],
    repeats: DEFAULT_REPEATS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    planOnly: false,
    heavy: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const value = (): string => {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) throw new Error(`${String(flag)} needs a value`)
      i += 1
      return next
    }
    switch (flag) {
      case '--suite':
        args.suites = parseSuites(value())
        break
      case '--repeats':
        args.repeats = integer(value(), '--repeats')
        break
      case '--timeout':
        args.timeoutMs = integer(value(), '--timeout')
        break
      case '--engine':
        args.engine = value()
        break
      case '--engine-kind': {
        const kind = value()
        if (kind !== 'native' && kind !== 'wasm') throw new Error(`--engine-kind must be native or wasm, got ${kind}`)
        args.engineKind = kind
        break
      }
      case '--json':
        args.json = value()
        break
      case '--heavy':
        args.heavy = true
        break
      case '--report':
        args.fromJson = value()
        break
      case '--plan':
        args.planOnly = true
        break
      default:
        throw new Error(`unknown option ${String(flag)}\n\n${USAGE}`)
    }
  }
  if (args.repeats < 2) throw new Error('--repeats must be at least 2: one cold render and one warm')
  return args
}

function integer(raw: string, flag: string): number {
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${flag} needs a positive integer, got ${raw}`)
  return value
}

const exitCode = await main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  return 1
})
process.exitCode = exitCode
