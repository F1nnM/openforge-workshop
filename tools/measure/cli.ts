#!/usr/bin/env tsx
/**
 * Measure the geometry the footprint chain cannot be honest without.
 *
 *     npm run measure -- --dry-run        # the four sets, their sizes, no network
 *     npm run measure -- --calibrate      # the stride experiment, then the table
 *     npm run measure                     # the real run: 1,163 meshes, 11.05 GB
 *     npm run measure -- --set xg         # one question only
 *     npm run measure -- --report         # rebuild the sidecar from the log
 *     npm run measure -- --summary        # the answers, read back from the sidecar
 *
 * Run under `tsx` for the same reason `tools/thumbnails/cli.ts` is: it imports
 * `src/catalog`, which re-exports `./schema` extensionless because the app is
 * bundler-resolved, and Node's own ESM resolver will not load that.
 *
 * **The default run reads 11.05 GB out of somebody else's production bucket.**
 * Concurrency is capped at 8 and defaults to 4, every request identifies the
 * tool, every whole object is hashed and must equal the md5 the index named
 * (the bucket's ETag is a *multipart* ETag above 8 MiB and is not the md5 — see
 * `fetch.ts`), and the run is resumable at md5 granularity — so an interrupted run costs nothing to
 * finish and a completed one is never repeated. `cf-cache-status: DYNAMIC` on
 * every response today (blocker **B1**), so each read is an R2 origin read.
 *
 * Exit codes: 0 all attempted work succeeded; 1 something failed; 2 bad usage.
 */
import { existsSync } from 'node:fs'
import { join, relative } from 'node:path'

import {
  CATALOG_PATH,
  DEFAULT_SIDECAR_PATH,
  DEFAULT_STATE_DIR,
  REPO_ROOT,
  TARGET_SETS,
  XG_CODES,
  loadCatalog,
  measureTargets,
} from './catalog'
import type { MeasureTarget, TargetSet } from './catalog'
import {
  BBOX_RESIDUAL_TOL_MM,
  MIN_ON_ARC_FRACTION,
  ON_ARC_TOL_MM,
  RADIAL_BIN_MM,
} from './arc'
import { CANDIDATE_STRIDES, DEFAULT_SAMPLE, PLAN_CLAIM_MM, calibrate, stratifiedSample } from './calibrate'
import { MM_PER_UNIT, round } from './extent'
import { DEFAULT_CONCURRENCY, MAX_CONCURRENCY } from './fetch'
import { runMeasure } from './run'
import type { MeasureSidecar } from './sidecar'
import { buildSidecar, readLog, readSidecar, writeSidecar } from './sidecar'
import { summariseCodes, summariseExtents, summariseSectors } from './summary'

type Mode = 'measure' | 'calibrate' | 'report' | 'summary'

interface Args {
  mode: Mode
  catalog: string
  log: string
  sidecar: string
  sets: TargetSet[]
  limit?: number
  concurrency: number
  stride?: number
  strideBoundMm?: number
  sample: number
  fitAll: boolean
  retryFailed: boolean
  force: boolean
  dryRun: boolean
}

const USAGE = `Usage: npm run measure -- [options]

  (default)             measure every target that is not already in the log
  --calibrate           read a size-stratified sample in full and tabulate the
                        real error of every candidate stride, then stop
  --report              rebuild the sidecar from the log; no network
  --summary             print the answers from the committed sidecar; no network

  --set NAME            restrict to one set, repeatable:
                        ${TARGET_SETS.join(' | ')}
  --limit N             first N targets in display order
  --concurrency N       requests in flight (default ${String(DEFAULT_CONCURRENCY)}, capped at ${String(MAX_CONCURRENCY)})
  --stride N            facet stride; requires --stride-bound
  --stride-bound MM     the calibrated worst-case error for that stride
  --sample N            meshes in the calibration sample (default ${String(DEFAULT_SAMPLE)})
  --fit-all             attempt a sector fit on every target, not only curved ones
  --retry-failed        re-read targets whose previous attempt failed
  --force               ignore the log entirely and re-read everything
  --log PATH            result log (default tools/measure/.cache/measurements.jsonl)
  --sidecar PATH        sidecar to write (default tools/measure/measurements.json)
  --catalog PATH        index to read (default public/catalog/catalog.json)
  --dry-run             print the plan and exit; no network, nothing written
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

  if (args.mode === 'summary') return summary(args)

  const catalog = loadCatalog(args.catalog)
  const list = measureTargets(catalog)
  const selected = select(list.targets, args)

  process.stdout.write(plan(args, catalog.version.fixtures, list, selected))
  if (args.dryRun) {
    process.stdout.write('\noutput        (dry run — no network, nothing written)\n')
    return 0
  }

  if (args.mode === 'report') {
    const sidecar = emit(args, catalog, list, readLog(args.log))
    process.stdout.write(coverage(args, sidecar))
    return sidecar.coverage.failed > 0 ? 1 : 0
  }

  if (args.mode === 'calibrate') {
    return await runCalibration(args, catalog, selected)
  }

  const started = Date.now()
  let done = 0
  let bytes = 0
  const report = await runMeasure({
    catalog,
    targets: selected,
    logPath: args.log,
    concurrency: args.concurrency,
    ...(args.stride === undefined ? {} : { stride: args.stride, strideBoundMm: args.strideBoundMm ?? 0 }),
    fitAll: args.fitAll,
    retryFailed: args.retryFailed,
    force: args.force,
    onProgress: (event) => {
      done += 1
      bytes += event.bytesRead
      if (event.outcome === 'failed') {
        process.stderr.write(`  fail  ${event.blob}  ${event.reason ?? ''}\n`)
      }
      if (done % 25 === 0 || done === selected.length) {
        const seconds = (Date.now() - started) / 1000
        const rate = seconds === 0 ? 0 : bytes / seconds / 1e6
        const remaining = selected.length - done
        const eta = rate === 0 ? 0 : (remaining * (bytes / Math.max(1, done))) / (rate * 1e6)
        process.stdout.write(
          `  ${String(done).padStart(5)}/${String(selected.length)}  ` +
            `${formatBytes(bytes)}  ${rate.toFixed(2)} MB/s  eta ${formatDuration(eta * 1000)}\n`,
        )
      }
    },
  })

  const sidecar = emit(args, catalog, list, report.entries)
  process.stdout.write(
    `\nrun           ${String(report.measured)} measured, ${String(report.skipped)} already done, ` +
      `${String(report.failed)} failed in ${formatDuration(report.elapsedMs)}\n` +
      `read          ${formatBytes(report.bytesRead)}\n`,
  )
  process.stdout.write(coverage(args, sidecar))
  return report.failed > 0 ? 1 : 0
}

/* ---------------------------------------------------------------- selection */

function select(targets: readonly MeasureTarget[], args: Args): MeasureTarget[] {
  const filtered =
    args.sets.length === 0
      ? [...targets]
      : targets.filter((target) => target.sets.some((set) => args.sets.includes(set)))
  return args.limit === undefined ? filtered : filtered.slice(0, args.limit)
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
  list: ReturnType<typeof measureTargets>,
  selected: readonly MeasureTarget[],
): string {
  const lines = [
    `catalog       ${inRepo(args.catalog)} @ ${fixtures.slice(0, 12)}`,
    `sets          ${list.records} rows → ${list.targets.length} distinct md5 (${String(list.deduped)} collapsed)`,
  ]
  for (const set of TARGET_SETS) {
    const counts = list.counts[set]
    lines.push(
      `  ${set.padEnd(12)}${String(counts.records).padStart(5)} rows  ` +
        `${String(counts.blobs).padStart(5)} md5`,
    )
  }
  const bytes = selected.reduce((total, target) => total + target.bytes, 0)
  lines.push(
    `selected      ${String(selected.length)} md5, ${formatBytes(bytes)}` +
      (args.sets.length === 0 ? '' : ` (sets: ${args.sets.join(', ')})`),
  )
  lines.push(
    `read mode     ${
      args.stride === undefined
        ? 'whole object — exact, confidence "exact"'
        : `stride ${String(args.stride)}, bound ${String(args.strideBoundMm)} mm, confidence "bounded"`
    }`,
  )
  lines.push(`concurrency   ${String(args.concurrency)} (cap ${String(MAX_CONCURRENCY)})`)
  lines.push(`log           ${inRepo(args.log)}`)
  lines.push(`sidecar       ${inRepo(args.sidecar)}`)
  return `${lines.join('\n')}\n`
}

function coverage(args: Args, sidecar: MeasureSidecar): string {
  const lines = [
    `coverage      ${String(sidecar.coverage.measured)} measured, ` +
      `${String(sidecar.coverage.failed)} failed, ${String(sidecar.coverage.pending)} pending ` +
      `of ${String(sidecar.coverage.blobs)} md5`,
  ]
  for (const set of TARGET_SETS) {
    const entry = sidecar.coverage.sets[set]
    lines.push(
      `  ${set.padEnd(12)}${String(entry.measured).padStart(5)} / ${String(entry.blobs).padStart(5)} md5`,
    )
  }
  return `${lines.join('\n')}\n`
}

function emit(
  args: Args,
  catalog: ReturnType<typeof loadCatalog>,
  list: ReturnType<typeof measureTargets>,
  entries: Parameters<typeof buildSidecar>[0]['entries'],
): MeasureSidecar {
  const sidecar = buildSidecar({
    catalog,
    entries,
    wanted: new Set(list.targets.map((target) => target.blob)),
    coverage: {
      blobs: list.targets.length,
      sets: Object.fromEntries(
        TARGET_SETS.map((set) => [set, list.counts[set].blobs]),
      ) as Record<TargetSet, number>,
    },
    method: {
      mmPerUnit: MM_PER_UNIT,
      radialBinMm: RADIAL_BIN_MM,
      onArcToleranceMm: ON_ARC_TOL_MM,
      minOnArcFraction: MIN_ON_ARC_FRACTION,
      bboxResidualToleranceMm: BBOX_RESIDUAL_TOL_MM,
      sectorFit:
        'plane chosen by fitting xy/xz/yz; points recentred on their box; centre ' +
        'seeded from median convex-hull-triple circumcentres at two spacings plus ' +
        'the box corners, the box centre, the origin and a 9x9 grid; scored by ' +
        'radial edge sharpness; refined by Gauss-Newton two-radius concentric least ' +
        "squares; accepted only when the reconstructed sector's own box matches the " +
        'measured box to within bboxResidualToleranceMm',
      extent: 'axis-aligned box over every vertex of every read facet',
      readMode:
        args.stride === undefined
          ? 'whole object, every facet — confidence "exact", boundMm 0'
          : `facet stride ${String(args.stride)}, calibrated bound ${String(args.strideBoundMm)} mm`,
      strideCalibration:
        'measured over 36 size-stratified meshes (332.3 MB read in full): worst ' +
        'bounding-box face error 0.0016 mm at stride 2, 0.0081 mm at 4, 1.6448 mm ' +
        'at 8, 4.9363 at 16, 18.5602 at 128, 141.5500 at 4096. Coalesced at 64 KiB, ' +
        'no stride below 1310 transfers less than the whole object, because a binary ' +
        'facet is 50 bytes. So the plan\'s "~13 GB, sub-0.03 mm" is not jointly ' +
        'achievable and every measurement here is a whole-object read.',
      radiusTolerance:
        'per mesh, by sliding the fitted centre along the sector bisector until the ' +
        'on-arc RMS residual doubles; floored at 8x that residual. Covered the true ' +
        'error on all 80 synthetic sectors of known radii.',
    },
  })
  writeSidecar(args.sidecar, sidecar)
  return sidecar
}

/* -------------------------------------------------------------- calibration */

async function runCalibration(
  args: Args,
  catalog: ReturnType<typeof loadCatalog>,
  selected: readonly MeasureTarget[],
): Promise<number> {
  const sample = stratifiedSample(selected, args.sample)
  const bytes = sample.reduce((total, target) => total + target.bytes, 0)
  process.stdout.write(
    `\ncalibration   ${String(sample.length)} meshes in full, ${formatBytes(bytes)}\n` +
      `strides       ${CANDIDATE_STRIDES.join(', ')}\n\n`,
  )

  const report = await calibrate({
    catalog,
    targets: sample,
    concurrency: args.concurrency,
    onSample: (item, index, total) => {
      process.stdout.write(
        `  ${String(index + 1).padStart(3)}/${String(total)}  ${item.blob.slice(0, 8)}  ` +
          `${formatBytes(item.bytes).padStart(9)}  ${item.format.padEnd(6)}  ` +
          `${String(item.triangles).padStart(8)} facets\n`,
      )
    },
  })

  for (const failure of report.failures) {
    process.stderr.write(`  fail  ${failure.blob}  ${failure.reason}\n`)
  }
  process.stdout.write(
    `\n  ${'stride'.padStart(6)}  ${'max err mm'.padStart(11)}  ${'median mm'.padStart(10)}  ` +
      `${'exact'.padStart(6)}  ${`>${String(PLAN_CLAIM_MM)}mm`.padStart(9)}  ${'transfer'.padStart(9)}  requests\n`,
  )
  const wholeBytes = report.samples.reduce((total, item) => total + item.bytes, 0)
  process.stdout.write(
    `  ${'1'.padStart(6)}  ${'0.000000'.padStart(11)}  ${'0.000000'.padStart(10)}  ` +
      `${String(report.samples.length).padStart(6)}  ${'0'.padStart(9)}  ` +
      `${formatBytes(wholeBytes).padStart(9)}  ${String(report.samples.length)}\n`,
  )
  for (const item of report.verdicts) {
    process.stdout.write(
      `  ${String(item.stride).padStart(6)}  ${item.maxFaceErrorMm.toFixed(6).padStart(11)}  ` +
        `${item.medianFaceErrorMm.toFixed(6).padStart(10)}  ${String(item.exact).padStart(6)}  ` +
        `${String(item.overPlanClaim).padStart(9)}  ${formatBytes(item.sampleBytes).padStart(9)}  ` +
        `${String(item.sampleRequests)}\n`,
    )
  }
  process.stdout.write(
    `\n  A stride's error is a *shrinkage*: a subsample can only lose an extreme,\n` +
      `  never invent one. "max err mm" is therefore the bound for that stride on\n` +
      `  this sample, and the plan's claimed ${String(PLAN_CLAIM_MM)} mm is the column beside it.\n` +
      `  Transfer is what coalesced 64 KiB windows would actually move; R2 charges\n` +
      `  no egress, so a stride buys wall-clock and memory, never money, and costs\n` +
      `  more Class B operations than one whole-object GET.\n`,
  )
  return 0
}

/* ------------------------------------------------------------------ summary */

function summary(args: Args): number {
  if (!existsSync(args.sidecar)) {
    process.stderr.write(`no sidecar at ${args.sidecar} — run \`npm run measure\` first\n`)
    return 2
  }
  const sidecar = readSidecar(args.sidecar)
  const catalog = loadCatalog(args.catalog)
  const list = measureTargets(catalog)

  const out: string[] = [
    `sidecar       ${inRepo(args.sidecar)}`,
    `version       ${String(sidecar.version)}, generated ${sidecar.generated}`,
    `catalog       ${sidecar.catalog.fixtures.slice(0, 12)} (schema ${String(sidecar.catalog.schema)}, pipeline ${String(sidecar.catalog.pipeline)})`,
    `coverage      ${String(sidecar.coverage.measured)} measured / ${String(sidecar.coverage.blobs)} md5, ` +
      `${String(sidecar.coverage.failed)} failed, ${String(sidecar.coverage.pending)} pending`,
    '',
  ]

  for (const set of ['arcNoBand', 'arcNoAngle'] as const) {
    const sectors = summariseSectors(sidecar, set)
    out.push(
      `── ${set} ──`,
      `  measured ${String(sectors.measured)}, sector/annulus ${String(sectors.fitted)}, ` +
        `not attempted ${String(sectors.notAttempted)}`,
      `  rejected ${Object.entries(sectors.rejected)
        .filter(([, count]) => count > 0)
        .map(([reason, count]) => `${reason} ${String(count)}`)
        .join(', ') || 'none'}`,
      `  bands    ${sectors.bands.slice(0, 8).map((b) => `${b.value}×${String(b.count)}`).join('  ') || '—'}`,
      `  widths   ${sectors.bandWidths.slice(0, 8).map((b) => `${b.value}×${String(b.count)}`).join('  ') || '—'}`,
      `  sweeps   ${sectors.sweeps.slice(0, 10).map((b) => `${b.value}°×${String(b.count)}`).join('  ') || '—'}`,
      `  centre offset from origin, mm: ${describe(sectors.centreOffsetMm)}`,
      `  reconstruction residual, mm:   ${describe(sectors.bboxResidualMm)}`,
      `  radius tolerance, mm:          ${describe(sectors.radiusToleranceMm)}`,
      '',
    )
  }

  out.push('── xG trio ──')
  for (const code of summariseCodes(sidecar, list.targets, XG_CODES)) {
    out.push(
      `  ${code.code.padEnd(5)} ${String(code.blobs).padStart(3)} md5  ` +
        `long ${describe(code.longUnits)}  short ${describe(code.shortUnits)}  ` +
        `height ${describe(code.heightUnits)}`,
      `        sectors fitted ${String(code.fittedSectors)}  ` +
        `strip ${describe(code.stripLengthUnits)} × ${describe(code.stripWidthUnits)}`,
    )
  }
  out.push('')

  const extents = summariseExtents(sidecar, 'noneNoCode')
  out.push(
    '── noneNoCode ──',
    `  measured ${String(extents.measured)}, without extent ${String(extents.withoutExtent)}`,
    `  long   ${describe(extents.longUnits)}`,
    `  short  ${describe(extents.shortUnits)}`,
    `  height ${describe(extents.heightUnits)}`,
    `  commonest boxes: ${extents.footprints
      .slice(0, 12)
      .map((f) => `${f.value}×${String(f.count)}`)
      .join('  ')}`,
    '',
  )

  process.stdout.write(`${out.join('\n')}\n`)
  return 0
}

function describe(value: { min: number; median: number; max: number; count: number } | undefined): string {
  if (value === undefined) return '—'
  return `${String(round(value.min, 3))}/${String(round(value.median, 3))}/${String(round(value.max, 3))} (n=${String(value.count)})`
}

/* -------------------------------------------------------------------- args */

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    mode: 'measure',
    catalog: CATALOG_PATH,
    log: join(DEFAULT_STATE_DIR, 'measurements.jsonl'),
    sidecar: DEFAULT_SIDECAR_PATH,
    sets: [],
    concurrency: DEFAULT_CONCURRENCY,
    sample: DEFAULT_SAMPLE,
    fitAll: false,
    retryFailed: false,
    force: false,
    dryRun: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const next = (): string => {
      const value = argv[index + 1]
      if (value === undefined) throw new Error(`${String(flag)} needs a value`)
      index += 1
      return value
    }
    switch (flag) {
      case '--calibrate':
        args.mode = 'calibrate'
        break
      case '--report':
        args.mode = 'report'
        break
      case '--summary':
        args.mode = 'summary'
        break
      case '--set': {
        const value = next()
        if (!(TARGET_SETS as readonly string[]).includes(value)) {
          throw new Error(`unknown set "${value}" — one of ${TARGET_SETS.join(', ')}`)
        }
        args.sets.push(value as TargetSet)
        break
      }
      case '--limit':
        args.limit = positive(next(), flag)
        break
      case '--concurrency':
        args.concurrency = Math.min(positive(next(), flag), MAX_CONCURRENCY)
        break
      case '--stride':
        args.stride = positive(next(), flag)
        break
      case '--stride-bound': {
        const value = Number(next())
        if (!Number.isFinite(value) || value < 0) throw new Error('--stride-bound needs a non-negative number')
        args.strideBoundMm = value
        break
      }
      case '--sample':
        args.sample = positive(next(), flag)
        break
      case '--fit-all':
        args.fitAll = true
        break
      case '--retry-failed':
        args.retryFailed = true
        break
      case '--force':
        args.force = true
        break
      case '--log':
        args.log = next()
        break
      case '--sidecar':
        args.sidecar = next()
        break
      case '--catalog':
        args.catalog = next()
        break
      case '--dry-run':
        args.dryRun = true
        break
      default:
        throw new Error(`unknown option ${String(flag)}`)
    }
  }

  if (args.stride !== undefined && args.strideBoundMm === undefined) {
    throw new Error('--stride requires --stride-bound; run --calibrate to find the real bound')
  }
  return args
}

function positive(raw: string, flag: string | undefined): number {
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${String(flag)} needs a positive integer`)
  return value
}

/* ------------------------------------------------------------------ format */

/** `1.2 GB`, `340 MB`, `28 kB` — decimal, matching how the bucket bills. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} kB`
  return `${String(bytes)} B`
}

/** `2h 14m`, `14m 03s`, `9.4s`. */
export function formatDuration(ms: number): string {
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
