#!/usr/bin/env tsx
/**
 * Derive decimated GLB previews from the STLs in the OpenForge bucket.
 *
 *     npm run lod                          # deterministic 36-mesh stratified sample
 *     npm run lod -- --sample 60           # a bigger sample
 *     npm run lod -- --above-gate          # the 957 md5s the STL gate refuses
 *     npm run lod -- --all                 # every mesh — see below
 *     npm run lod -- --no-meshopt          # plain GLB, identity node transform
 *     npm run lod -- --out /tmp/lod        # stage somewhere else
 *     npm run lod -- --dry-run             # plan and counts, no network at all
 *
 * Run under `tsx` for the same reason `tools/thumbnails/cli.ts` is: it imports
 * `src/catalog`, which re-exports `./schema` extensionless because the app is
 * bundler-resolved, and Node's own ESM resolver will not load that.
 *
 * **`--all` is 8,353 objects and about 108 GB of egress from someone else's
 * production bucket, with no cache rule on it yet (blocker B1).** It is
 * implemented, it is polite (concurrency 8, spaced requests, bounded retries,
 * identifying User-Agent, md5-verified bodies) and it is not the default.
 *
 * **Nothing is uploaded.** Blocker **B2** — R2 write credentials for `/lod/` — is
 * open. The run stages files and writes an upload manifest naming every intended
 * object; the manifest carries the exact commands and the format contract G2
 * builds against.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

import {
  CATALOG_PATH,
  DEFAULT_CACHE_DIR,
  DEFAULT_OUT_DIR,
  REPO_ROOT,
  STL_GATE_BYTES,
  aboveGate,
  loadCatalog,
  lodBase,
  lodPrefix,
  meshTargets,
} from './catalog'
import type { MeshTarget } from './catalog'
import { DEFAULT_CONCURRENCY } from './fetch'
import { buildLodManifest, serialiseLodManifest } from './manifest'
import { MAX_TRIANGLES, MIN_TRIANGLES } from './mesh'
import { formatBytes, formatCount, project, summarise } from './measure'
import type { SamplePick } from './sample'
import { DEFAULT_SAMPLE_SIZE, selectAboveGate, selectAll, selectSample, strataCounts } from './sample'
import type { RunReport } from './run'
import { runLod } from './run'

interface Args {
  catalog: string
  out: string
  cache?: string
  manifest?: string
  mode: { kind: 'sample'; limit: number } | { kind: 'above-gate' } | { kind: 'all' }
  minTriangles: number
  maxTriangles: number
  meshopt: boolean
  force: boolean
  concurrency?: number
  dryRun: boolean
}

const USAGE = `Usage: npm run lod -- [options]

  --sample N        deterministic stratified sample of N meshes (default ${String(DEFAULT_SAMPLE_SIZE)})
  --above-gate      every mesh the STL gate refuses — the tiles with no 3D path today
  --all             every mesh in the index (8,353 objects, ~108 GB of egress)
  --out DIR         where to stage objects (default tools/lod/out)
  --cache DIR       STL cache (default off; --cache with no value uses tools/lod/.cache/models)
  --manifest PATH   upload manifest (default <out>/upload-manifest.json)
  --catalog PATH    index to read (default public/catalog/catalog.json)
  --min N           band floor in triangles (default ${String(MIN_TRIANGLES)})
  --max N           band ceiling in triangles (default ${String(MAX_TRIANGLES)})
  --no-meshopt      skip EXT_meshopt_compression: 4.7x bigger, identity node transform
  --force           re-derive objects that already exist
  --concurrency N   requests in flight (default ${String(DEFAULT_CONCURRENCY)} — this is a production bucket)
  --dry-run         print the plan and exit; no network, nothing written
  --help
`

async function main(argv: readonly string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE)
    return 0
  }
  const args = parseArgs(argv)
  const catalog = loadCatalog(args.catalog)
  const { targets, records, deduped, designs } = meshTargets(catalog)
  const gate = aboveGate(catalog)

  const picks = select(args, targets)
  const prefix = lodPrefix(catalog)
  const manifestPath = args.manifest ?? join(args.out, 'upload-manifest.json')

  process.stdout.write(plan(args, catalog.version.fixtures, { records, targets, deduped, designs, gate, picks }))
  if (args.dryRun) {
    process.stdout.write('\noutput        (dry run — no network, nothing written)\n')
    return 0
  }

  const report = await runLod({
    catalog,
    picks,
    outDir: args.out,
    ...(args.cache === undefined ? {} : { cacheDir: args.cache }),
    force: args.force,
    ...(args.concurrency === undefined ? {} : { concurrency: args.concurrency }),
    decimate: { meshopt: args.meshopt, minTriangles: args.minTriangles, maxTriangles: args.maxTriangles },
    onProgress: (event) => {
      if (event.outcome === 'failed') {
        process.stderr.write(`  ! ${event.blob}: ${event.reason ?? 'failed'}\n`)
      } else if (event.outcome === 'empty') {
        process.stderr.write(`  · ${event.blob}: zero-facet STL, no object emitted\n`)
      } else {
        process.stdout.write(
          `  ${String(event.index + 1).padStart(5)}/${String(event.total)} ${event.blob} ` +
            `${formatBytes(event.sourceBytes).padStart(9)} → ${formatBytes(event.bytes ?? 0).padStart(9)} ` +
            `· ${formatCount(event.triangles ?? 0).padStart(7)} tris${event.outcome === 'skipped' ? ' (cached)' : ''}\n`,
        )
      }
    },
  })

  const manifest = buildLodManifest({
    catalog,
    prefix,
    publicBase: lodBase(catalog),
    staged: stagedPath(args.out),
    meshopt: args.meshopt,
    minTriangles: args.minTriangles,
    maxTriangles: args.maxTriangles,
    entries: report.entries
      .filter((entry) => entry.outcome === 'written')
      .map((entry) => ({
        key: entry.key,
        blob: entry.blob,
        tiles: entry.tiles,
        designs: entry.designs,
        sourceBytes: entry.sourceBytes,
        sourceTriangles: entry.sourceTriangles,
        bytes: entry.bytes,
        triangles: entry.triangles,
        vertices: entry.vertices,
        weld: entry.weld === null ? null : { before: entry.weld.before, after: entry.weld.after },
        fidelity:
          entry.fidelity === null
            ? null
            : {
                areaError: entry.fidelity.areaError,
                bboxDelta: entry.fidelity.bboxDelta,
                acceptable: entry.fidelity.acceptable,
              },
        passThrough: entry.passThrough,
        aboveGate: entry.aboveGate,
      })),
    contents: report.contents,
  })
  mkdirSync(dirname(manifestPath), { recursive: true })
  writeFileSync(manifestPath, serialiseLodManifest(manifest))

  process.stdout.write(results(report, { targets, gate, manifestPath, meshopt: args.meshopt }))
  process.stdout.write(`\n${manifest.commands.join('\n')}\n`)

  return report.failed.length === 0 ? 0 : 1
}

/* --------------------------------------------------------------------- args */

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    catalog: CATALOG_PATH,
    out: DEFAULT_OUT_DIR,
    mode: { kind: 'sample', limit: DEFAULT_SAMPLE_SIZE },
    minTriangles: MIN_TRIANGLES,
    maxTriangles: MAX_TRIANGLES,
    meshopt: true,
    force: false,
    dryRun: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const value = (): string => {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) throw new Error(`${String(flag)} needs a value`)
      i += 1
      return next
    }
    const optional = (): string | undefined => {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) return undefined
      i += 1
      return next
    }
    switch (flag) {
      case '--sample':
        args.mode = { kind: 'sample', limit: integer(value(), '--sample') }
        break
      case '--above-gate':
        args.mode = { kind: 'above-gate' }
        break
      case '--all':
        args.mode = { kind: 'all' }
        break
      case '--out':
        args.out = value()
        break
      case '--cache':
        args.cache = optional() ?? DEFAULT_CACHE_DIR
        break
      case '--manifest':
        args.manifest = value()
        break
      case '--catalog':
        args.catalog = value()
        break
      case '--min':
        args.minTriangles = integer(value(), '--min')
        break
      case '--max':
        args.maxTriangles = integer(value(), '--max')
        break
      case '--no-meshopt':
        args.meshopt = false
        break
      case '--force':
        args.force = true
        break
      case '--concurrency':
        args.concurrency = integer(value(), '--concurrency')
        break
      case '--dry-run':
        args.dryRun = true
        break
      default:
        throw new Error(`unknown option ${String(flag)}\n\n${USAGE}`)
    }
  }
  if (args.minTriangles > args.maxTriangles) {
    throw new Error(`--min ${String(args.minTriangles)} is above --max ${String(args.maxTriangles)}`)
  }
  return args
}

/**
 * The staging directory as the upload commands should name it.
 *
 * Repo-relative when it is inside the repo, which is the normal case and keeps
 * the commands copy-pasteable from the repository root. Absolute when `--out`
 * points somewhere else, because `../../../../tmp/...` is a command nobody should
 * be asked to trust.
 */
function stagedPath(out: string): string {
  const inside = relative(REPO_ROOT, out)
  if (inside === '') return '.'
  return inside.startsWith('..') ? out : inside
}

function integer(raw: string, flag: string): number {
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${flag} needs a positive integer, got ${raw}`)
  return value
}

function select(args: Args, targets: readonly MeshTarget[]): SamplePick[] {
  switch (args.mode.kind) {
    case 'all':
      return selectAll(targets)
    case 'above-gate':
      return selectAboveGate(targets)
    case 'sample':
      return selectSample(targets, { limit: args.mode.limit })
  }
}

/* ------------------------------------------------------------------ reporting */

interface PlanIndex {
  records: number
  targets: readonly MeshTarget[]
  deduped: number
  designs: number
  gate: ReturnType<typeof aboveGate>
  picks: readonly SamplePick[]
}

function plan(args: Args, fixturesRef: string, index: PlanIndex): string {
  const strata = strataCounts(index.picks)
  const corpusBytes = index.targets.reduce((total, target) => total + target.bytes, 0)
  const pickedBytes = index.picks.reduce((total, pick) => total + pick.target.bytes, 0)
  const pickedGate = index.picks.filter((pick) => pick.target.aboveGate).length
  return `${[
    `catalog       ${args.catalog}`,
    `  fixtures    ${fixturesRef}`,
    `  records     ${formatCount(index.records)} live · ${formatCount(index.targets.length)} distinct meshes ` +
      `(${formatCount(index.deduped)} collapsed by md5) · ${formatCount(index.designs)} designs`,
    `  corpus      ${formatBytes(corpusBytes)} of STL over the distinct meshes`,
    `  gate        ${formatCount(index.gate.tiles)} tiles (${(100 * index.gate.share).toFixed(2)}%) over ` +
      `${formatBytes(STL_GATE_BYTES)} — ${formatCount(index.gate.blobs)} distinct meshes with no 3D path today`,
    `plan          ${formatCount(index.picks.length)} meshes · ${formatBytes(pickedBytes)} to fetch · ` +
      `${formatCount(pickedGate)} above the gate · ${describe(strata)}`,
    `lod           ${formatCount(args.minTriangles)}–${formatCount(args.maxTriangles)} triangles · one level · ` +
      `${args.meshopt ? 'EXT_meshopt_compression' : 'uncompressed'} · POSITION only, flat-shaded`,
    `staging       ${args.out}`,
    `cache         ${args.cache ?? '(disabled — a full pass would be 108 GB on disk)'}`,
  ].join('\n')}\n`
}

interface ResultContext {
  targets: readonly MeshTarget[]
  gate: ReturnType<typeof aboveGate>
  manifestPath: string
  meshopt: boolean
}

function results(report: RunReport, context: ResultContext): string {
  const stats = summarise(report.entries)
  const corpusSourceBytes = context.targets.reduce((total, target) => total + target.bytes, 0)
  const projection = project(report.entries, {
    blobs: context.targets.length,
    aboveGate: context.gate.blobs,
    sourceBytes: corpusSourceBytes,
  })

  const lines = [
    '',
    `run           ${formatCount(report.written)} written · ${formatCount(report.skipped)} skipped · ` +
      `${formatCount(report.empty)} empty · ${formatCount(report.failed.length)} failed · ` +
      `${(report.elapsedMs / 1000).toFixed(1)} s`,
    `  network     ${formatCount(report.fetched)} fetched (${formatBytes(report.sourceBytesFetched)}) · ` +
      `${formatCount(report.fromCache)} from cache` +
      (report.sourceBytesFetched > 0 && report.elapsedMs > 0
        ? ` · ${(report.sourceBytesFetched / 1e6 / (report.elapsedMs / 1000)).toFixed(1)} MB/s aggregate`
        : ''),
    `weld          post/pre vertex ratio: mean ${stats.weldRatio.mean.toFixed(4)} · ` +
      `median ${stats.weldRatio.median.toFixed(4)} · worst ${stats.weldRatio.max.toFixed(4)} ` +
      `over ${formatCount(stats.weldRatio.count)} meshes`,
    `triangles     ${formatCount(stats.sourceTriangles.total)} → ${formatCount(stats.triangles.total)} ` +
      `(${stats.triangleReduction.toFixed(1)}× on totals)`,
    `  source      mean ${formatCount(stats.sourceTriangles.mean)} · median ${formatCount(stats.sourceTriangles.median)} ` +
      `· min ${formatCount(stats.sourceTriangles.min)} · max ${formatCount(stats.sourceTriangles.max)}`,
    `  lod         mean ${formatCount(stats.triangles.mean)} · median ${formatCount(stats.triangles.median)} ` +
      `· min ${formatCount(stats.triangles.min)} · max ${formatCount(stats.triangles.max)}`,
    `bytes         ${formatBytes(stats.sourceBytes.total)} → ${formatBytes(stats.lodBytes.total)} ` +
      `(${stats.byteReduction.toFixed(1)}× on totals)`,
    `  lod size    mean ${formatBytes(stats.lodBytes.mean)} · median ${formatBytes(stats.lodBytes.median)} ` +
      `· p95 ${formatBytes(stats.lodBytes.p95)} · min ${formatBytes(stats.lodBytes.min)} ` +
      `· max ${formatBytes(stats.lodBytes.max)}`,
    `fidelity      area error mean ${(100 * stats.areaError.mean).toFixed(2)}% · ` +
      `median ${(100 * stats.areaError.median).toFixed(2)}% · worst ${(100 * stats.areaError.max).toFixed(2)}% ` +
      `over ${formatCount(stats.areaError.count)} decimated meshes`,
    `  band        ${formatCount(stats.passThrough)} passed through (already ≤ ceiling) · ` +
      `${formatCount(stats.escalated)} escalated to the ceiling · ` +
      `${formatCount(stats.unfaithful)} shipped over the fidelity bar`,
    `corpus        ${formatCount(projection.blobs)} meshes projected: ${formatBytes(projection.bytes)} of store ` +
      `from ${formatBytes(projection.sourceBytes)} of STL`,
    `  strata      above gate ${formatCount(projection.aboveGate)} × ${formatBytes(projection.meanAboveGate)} · ` +
      `below ${formatCount(projection.belowGate)} × ${formatBytes(projection.meanBelowGate)}`,
  ]

  if (report.failed.length > 0) {
    lines.push(`failures      ${formatCount(report.failed.length)}:`)
    for (const failure of report.failed.slice(0, 20)) {
      lines.push(`  ${failure.blob}  ${failure.kind}: ${failure.reason}`)
    }
  }

  lines.push(
    `manifest      ${context.manifestPath} — ${formatCount(report.entries.filter((entry) => entry.outcome === 'written').length)} objects, nothing uploaded`,
    `compression   ${context.meshopt ? 'EXT_meshopt_compression + KHR_mesh_quantization — the mesh node carries a transform; see the manifest notes' : 'none — identity node transform, 4.7× larger over the default sample'}`,
    '',
  )
  return `${lines.join('\n')}\n`
}

function describe(counts: Record<string, number>): string {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => `${key} ${String(count)}`)
    .join(' · ')
}

/* --------------------------------------------------------------------- entry */

const exitCode = await main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  return 1
})
process.exitCode = exitCode
