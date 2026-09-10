#!/usr/bin/env tsx
/**
 * Measure where accessories attach to the corpus's hosts, and how inserts seat.
 *
 *     npm run mounts -- --dry-run            # the work list and its size, no network
 *     npm run mounts -- --sample 40          # one blob per (slots, family, footprint)
 *     npm run mounts                         # the real run, resumable
 *     npm run mounts -- --report             # what the log holds; no network
 *     npm run mounts -- --inventory          # write pipeline/mounts/inventory.json
 *
 * Run under `tsx` for the same reason `tools/measure/cli.ts` is: it imports
 * `src/catalog`, which re-exports `./schema` extensionless because the app is
 * bundler-resolved, and Node's own ESM resolver will not load that. The
 * measuring threads inherit the loader — see `run.ts`.
 *
 * **The default run reads about 16 GB out of somebody else's production
 * bucket.** Concurrency is capped at 8 and defaults to 4, every request
 * identifies the tool, every object is hashed and must equal the md5 the index
 * named (the bucket's ETag is a *multipart* ETag above 8 MiB and is not the
 * md5 — see `../measure/fetch.ts`), and the run is resumable at md5
 * granularity, so an interrupted run costs nothing to finish and a completed
 * one is never repeated.
 *
 * Exit codes: 0 all attempted work succeeded; 1 something failed; 2 bad usage.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, relative } from 'node:path'

import { DEFAULT_CONCURRENCY, MAX_CONCURRENCY } from '../measure/fetch'
// `SOURCE_DATE_EPOCH`-aware, and already tested next door. The two `format*`
// helpers at the foot of this file are the one thing that *is* copied from
// `tools/measure/cli.ts` rather than imported: that module runs its `main` at
// import time, so importing it would start a measurement run.
import { generatedAt } from '../measure/sidecar'

import type { MountTarget, MountTargetList } from './catalog'
import {
  CATALOG_PATH,
  DEFAULT_INVENTORY_PATH,
  DEFAULT_LOG_PATH,
  REPO_ROOT,
  loadCatalog,
  mountTargets,
} from './catalog'
import { runMounts } from './run'
import type { LogEntry } from './sidecar'
import { buildInventory, readLog, serialise, stratifiedSample } from './sidecar'

type Mode = 'run' | 'report' | 'inventory'

interface Args {
  readonly mode: Mode
  readonly catalog: string
  readonly log: string
  readonly inventory: string
  readonly limit?: number
  readonly sample?: number
  readonly concurrency: number
  readonly retryFailed: boolean
  readonly force: boolean
  readonly allowFailed: boolean
  readonly dryRun: boolean
}

const USAGE = `Usage: npm run mounts -- [options]

  (default)             measure every target that is not already in the log
  --report              print what the log holds; no network
  --inventory [PATH]    build the inventory from the log and write it
                        (default pipeline/mounts/inventory.json); no network

  --sample N            N targets, one per (slots, family, footprint) first
  --limit N             first N targets in manifest order
  --concurrency N       requests in flight (default ${String(DEFAULT_CONCURRENCY)}, capped at ${String(MAX_CONCURRENCY)})
  --retry-failed        re-read targets whose previous attempt failed
  --force               ignore the log entirely and re-read everything
  --allow-failed        write the inventory even though the log holds failures.
                        The build REFUSES such an inventory — a non-zero failed
                        count cannot tell "no mount here" from "no answer" — so
                        this writes one for inspection only. Clear the failures
                        with --retry-failed, or purge their lines from the log.
  --log PATH            result log (default tools/mounts/.cache/mounts.jsonl)
  --catalog PATH        index to read (default public/catalog/catalog.json)
  --dry-run             print the work list and exit; no network, nothing written
  --help
`

async function main(argv: readonly string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE)
    return 0
  }

  let args: Args
  try {
    args = parseArgs(argv)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`)
    return 2
  }

  const catalog = loadCatalog(args.catalog)
  const list = mountTargets(catalog)
  const selected = select(list.targets, args)

  process.stdout.write(plan(args, catalog.version.fixtures, list, selected))
  if (args.dryRun) {
    process.stdout.write('output        (dry run — no network, nothing written)\n')
    return 0
  }

  if (args.mode === 'report') return report(args, list)
  if (args.mode === 'inventory') return inventory(args, catalog.version.fixtures, list)
  return await measure(args, catalog, list, selected)
}

/* ------------------------------------------------------------------ the run */

async function measure(
  args: Args,
  catalog: ReturnType<typeof loadCatalog>,
  list: MountTargetList,
  selected: readonly MountTarget[],
): Promise<number> {
  process.stdout.write('\n')
  const outcome = await runMounts({
    catalog,
    targets: selected,
    logPath: args.log,
    concurrency: args.concurrency,
    retryFailed: args.retryFailed,
    force: args.force,
    onProgress: (event) => {
      if (event.outcome === 'skipped') return
      const head = `  ${String(event.index + 1).padStart(5)}/${String(event.total)}  ${event.blob.slice(0, 8)}  ${event.kind.padEnd(6)}`
      if (event.outcome === 'failed') {
        process.stderr.write(`${head}  fail  ${event.reason ?? ''}\n`)
        return
      }
      process.stdout.write(
        `${head}  ${formatBytes(event.bytesRead).padStart(9)}  ${event.seconds.toFixed(1).padStart(6)}s  ` +
          `${String(event.mounts)} mounts\n`,
      )
    },
  })

  process.stdout.write(
    `\nrun           ${String(outcome.measured)} measured, ${String(outcome.skipped)} already done, ` +
      `${String(outcome.failed)} failed in ${formatDuration(outcome.elapsedMs)}\n` +
      `read          ${formatBytes(outcome.bytesRead)}\n` +
      `found         ${String(outcome.mounts)} mounts\n`,
  )
  process.stdout.write(coverage(list, outcome.entries))
  process.stdout.write(`next          npm run mounts -- --inventory\n`)
  return outcome.failed > 0 ? 1 : 0
}

/* --------------------------------------------------------------- the report */

function report(args: Args, list: MountTargetList): number {
  const entries = readLog(args.log)
  process.stdout.write(coverage(list, entries))
  const failures = wanted(list, entries).filter((entry) => entry.status === 'failed')
  for (const entry of failures) process.stderr.write(`  fail  ${entry.blob}  ${entry.reason}\n`)
  return failures.length > 0 ? 1 : 0
}

/**
 * The log entries the current work list actually asks for.
 *
 * A stale entry — a blob the list no longer wants — is neither coverage nor a
 * failure to act on: the measurement is still true of those bytes and nobody is
 * asking the question any more, so it must not decide an exit code or reach the
 * inventory.
 */
function wanted(list: MountTargetList, entries: ReadonlyMap<string, LogEntry>): LogEntry[] {
  const asked = new Set<string>(list.targets.map((target) => target.blob))
  return [...entries.values()].filter((entry) => asked.has(entry.blob))
}

/**
 * Coverage against the *current* work list.
 *
 * Entries for blobs the list no longer asks for are counted as `stale` rather
 * than as coverage: the log is append-only and survives a re-import, so a tile
 * whose slots changed leaves a measurement behind that is still true of those
 * bytes and is no longer anybody's question.
 */
function coverage(list: MountTargetList, entries: ReadonlyMap<string, LogEntry>): string {
  const asked = new Set<string>(list.targets.map((target) => target.blob))
  let measured = 0
  let failed = 0
  let stale = 0
  let mounts = 0
  for (const entry of entries.values()) {
    if (!asked.has(entry.blob)) {
      stale += 1
      continue
    }
    if (entry.status === 'failed') failed += 1
    else {
      measured += 1
      mounts += entry.host?.mounts.length ?? 0
    }
  }
  return (
    `coverage      ${String(measured)} measured, ${String(failed)} failed, ` +
    `${String(asked.size - measured - failed)} pending of ${String(asked.size)} md5` +
    `${stale === 0 ? '' : ` (+${String(stale)} stale)`}\n` +
    `mounts        ${String(mounts)} across the measured hosts\n`
  )
}

/* ------------------------------------------------------------ the inventory */

function inventory(args: Args, fixtures: string, list: MountTargetList): number {
  const entries = wanted(list, readLog(args.log))
  const failed = entries.filter((entry) => entry.status === 'failed')

  if (failed.length > 0 && !args.allowFailed) {
    process.stderr.write(
      `\n${String(failed.length)} blobs in the log failed to measure, so the inventory would be ` +
        'silently short of them. Retry them with `--retry-failed`, or pass `--allow-failed` to ' +
        'write one anyway — but `npm run import:catalog` and `npm run stamp` will **refuse** it: ' +
        '`readMountInventory` throws on any non-zero `counted.failed`, because an inventory that ' +
        'could not read every mesh cannot tell "no mount here" from "no answer". The only routes ' +
        'to an inventory the build will read are retrying the failures until they measure, or ' +
        `purging their lines from ${inRepo(args.log)}.\n`,
    )
    return 1
  }

  const built = buildInventory(entries, { fixtures, measured: generatedAt() })
  mkdirSync(dirname(args.inventory), { recursive: true })
  writeFileSync(args.inventory, serialise(built), 'utf8')

  process.stdout.write(
    `\ninventory     ${inRepo(args.inventory)}\n` +
      `wrote         ${String(built.counted.hosts)} hosts, ${String(built.counted.inserts)} inserts, ` +
      `${String(built.counted.mounts)} mounts, ${String(built.counted.failed)} failed\n`,
  )
  /* Written under `--allow-failed`, so say plainly what it is. The build refuses
     a non-zero `counted.failed` unconditionally — see `pipeline/mounts.ts` — and
     an artefact on disk that no build will read is worth one loud line. */
  if (built.counted.failed > 0) {
    process.stderr.write(
      `\nthis inventory records ${String(built.counted.failed)} measurement failures, so ` +
        '`npm run import:catalog` and `npm run stamp` will refuse to read it. It is for ' +
        'inspection until the failures are retried (`--retry-failed`) or their lines are purged ' +
        'from the log.\n',
    )
  }
  return 0
}

/* ---------------------------------------------------------------- selection */

function select(targets: readonly MountTarget[], args: Args): MountTarget[] {
  const sampled = args.sample === undefined ? [...targets] : stratifiedSample(targets, args.sample)
  return args.limit === undefined ? sampled : sampled.slice(0, args.limit)
}

/* ------------------------------------------------------------------- output */

/** Repo-relative when the path is inside the repo, absolute when it is not. */
function inRepo(path: string): string {
  const rel = relative(REPO_ROOT, path)
  return rel.startsWith('..') ? path : rel
}

function plan(
  args: Args,
  fixtures: string,
  list: MountTargetList,
  selected: readonly MountTarget[],
): string {
  const slots = list.targets.reduce((total, target) => total + target.slots.length, 0)
  const bytes = selected.reduce((total, target) => total + target.bytes, 0)
  return (
    `${[
      `catalog       ${inRepo(args.catalog)} @ ${fixtures.slice(0, 12)}`,
      `work list     ${String(list.targets.length)} md5, ${formatBytes(list.bytes)}`,
      `  hosts       ${String(list.hosts).padStart(5)}  ${String(slots)} accessory slots`,
      `  inserts     ${String(list.inserts).padStart(5)}  ` +
        `+${String(list.alsoInserts)} hosts that are also inserts`,
      `selected      ${String(selected.length)} md5, ${formatBytes(bytes)}`,
      `concurrency   ${String(args.concurrency)} requests (cap ${String(MAX_CONCURRENCY)})`,
      `log           ${inRepo(args.log)}`,
      `inventory     ${inRepo(args.inventory)}`,
    ].join('\n')}\n`
  )
}

/* -------------------------------------------------------------------- args */

function parseArgs(argv: readonly string[]): Args {
  let mode: Mode = 'run'
  let catalog = CATALOG_PATH
  let log = DEFAULT_LOG_PATH
  let inventoryPath = DEFAULT_INVENTORY_PATH
  let limit: number | undefined
  let sample: number | undefined
  let concurrency = DEFAULT_CONCURRENCY
  let retryFailed = false
  let force = false
  let allowFailed = false
  let dryRun = false

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const next = (): string => {
      const value = argv[index + 1]
      if (value === undefined) throw new Error(`${String(flag)} needs a value`)
      index += 1
      return value
    }
    /** `--inventory` may or may not carry a path; a following flag is not one. */
    const optional = (): string | undefined => {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('-')) return undefined
      index += 1
      return value
    }
    switch (flag) {
      case '--report':
        mode = 'report'
        break
      case '--inventory': {
        mode = 'inventory'
        inventoryPath = optional() ?? inventoryPath
        break
      }
      case '--sample':
        sample = positive(next(), flag)
        break
      case '--limit':
        limit = positive(next(), flag)
        break
      case '--concurrency':
        concurrency = Math.min(positive(next(), flag), MAX_CONCURRENCY)
        break
      case '--retry-failed':
        retryFailed = true
        break
      case '--force':
        force = true
        break
      case '--allow-failed':
        allowFailed = true
        break
      case '--log':
        log = next()
        break
      case '--catalog':
        catalog = next()
        break
      case '--dry-run':
        dryRun = true
        break
      default:
        throw new Error(`unknown option ${String(flag)}`)
    }
  }

  return {
    mode,
    catalog,
    log,
    inventory: inventoryPath,
    ...(limit === undefined ? {} : { limit }),
    ...(sample === undefined ? {} : { sample }),
    concurrency,
    retryFailed,
    force,
    allowFailed,
    dryRun,
  }
}

function positive(raw: string, flag: string | undefined): number {
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${String(flag)} needs a positive integer`)
  return value
}

/* ------------------------------------------------------------------ format */

/** `1.2 GB`, `340 MB`, `28 kB` — decimal, matching how the bucket bills. */
function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} kB`
  return `${String(bytes)} B`
}

/** `2h 14m`, `14m 03s`, `9.4s`. */
function formatDuration(ms: number): string {
  const seconds = ms / 1000
  if (seconds >= 3600) {
    return `${String(Math.floor(seconds / 3600))}h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}m`
  }
  if (seconds >= 60) {
    return `${String(Math.floor(seconds / 60))}m ${String(Math.floor(seconds % 60)).padStart(2, '0')}s`
  }
  return `${seconds.toFixed(1)}s`
}

const exitCode = await main(process.argv.slice(2))
process.exitCode = exitCode
