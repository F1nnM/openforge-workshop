#!/usr/bin/env tsx
/**
 * Derive catalog-grid thumbnails from the sprite sheets in the OpenForge bucket.
 *
 *     npm run thumbs                      # deterministic 56-sheet sample
 *     npm run thumbs -- --screenful 60    # the first 60 cards in display order
 *     npm run thumbs -- --all             # all 8,701 sheets — see below
 *     npm run thumbs -- --tone neutral --out /tmp/grey   # the desaturated variant
 *     npm run thumbs -- --dry-run         # plan and counts, no network at all
 *     npm run thumbs -- --inventory       # ask the bucket what already exists
 *
 * Run under `tsx` for the same reason `scripts/import-catalog.ts` is: it imports
 * `src/catalog`, which re-exports `./schema` extensionless because the app is
 * bundler-resolved, and Node's own ESM resolver will not load that.
 *
 * **`--all` is 8,701 objects and roughly 4.5 GB of egress from someone else's
 * production bucket.** It is implemented, it is polite (concurrency 2, spaced
 * requests, bounded retries, identifying User-Agent) and it is not the default.
 * The sample answers the question this PR asks — what does a thumbnail cost, and
 * what does a screenful cost afterwards — to within the variance it reports.
 *
 * **Nothing is uploaded.** The run stages files and writes an upload manifest
 * naming every intended object; `v1-pr-series.md`'s blockers table has R2 write
 * credentials and Cloudflare zone access both open. The manifest carries the
 * exact commands.
 *
 * **`--inventory` is the other half of that, and it is row P3's input.** It
 * renders nothing: it HEADs all 8,352 candidate URLs and rewrites
 * `pipeline/thumbs/inventory.json`, which is where `CatalogRecord.thumb` comes
 * from. Run it *after* the sync and then rebuild the index — that is the whole
 * of flipping the catalog grid over to the derivative, and it needs no code
 * change. It deliberately takes no `--sample`: a partial probe would record
 * absence for objects it never asked about, and `thumb: false` on a thumbnail
 * that exists is a regression nothing would report.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

import type { CatalogFile, SpriteSheet } from '../../src/catalog'
import { THUMB_INVENTORY_PATH, readThumbInventory, serialiseThumbInventory } from '../../pipeline'

import {
  CATALOG_PATH,
  DEFAULT_CACHE_DIR,
  DEFAULT_OUT_DIR,
  REPO_ROOT,
  loadCatalog,
  spriteTargets,
  thumbPrefix,
} from './catalog'
import { sheetExtent } from './geometry'
import { probeThumbs, thumbCandidates } from './inventory'
import { PR13, PR13_UNIT_NOTE, formatBytes, measure } from './measure'
import { buildUploadManifest, serialiseUploadManifest } from './manifest'
import type { Tone } from './render'
import { THUMB_QUALITY, THUMB_SIZE } from './render'
import type { RunReport } from './run'
import { runThumbnails } from './run'
import type { SamplePick } from './sample'
import {
  DEFAULT_SAMPLE_SIZE,
  MEASURED_CARD_RUN,
  selectAll,
  selectSample,
  selectScreenful,
  strataCounts,
} from './sample'

interface Args {
  catalog: string
  out: string
  cache?: string
  manifest?: string
  mode:
    | { kind: 'sample'; limit: number }
    | { kind: 'screenful'; cards: number }
    | { kind: 'all' }
    | { kind: 'inventory' }
  inventory: string
  frame?: number
  size: number
  quality: number
  tone: Tone
  force: boolean
  concurrency?: number
  colour: boolean
  dryRun: boolean
}

const USAGE = `Usage: npm run thumbs -- [options]

  --sample N        deterministic stratified sample of N sheets (default ${String(DEFAULT_SAMPLE_SIZE)})
  --screenful N     the first N sheets in display order (default ${String(MEASURED_CARD_RUN)})
  --all             every sheet in the index (8,701 objects, ~4.5 GB of egress)
  --inventory       probe the bucket for existing /thumbs/ objects and rewrite
                    pipeline/thumbs/inventory.json; renders nothing
  --inventory-path P  where to write it (default pipeline/thumbs/inventory.json)
  --out DIR         where to stage objects (default tools/thumbnails/out)
  --cache DIR       sheet cache (default tools/thumbnails/.cache/sheets)
  --no-cache        do not read or write the sheet cache
  --manifest PATH   upload manifest (default <out>/upload-manifest.json)
  --catalog PATH    index to read (default public/catalog/catalog.json)
  --frame N         sheet frame to crop (default the index's defaultFrame)
  --size N          output edge in px (default ${String(THUMB_SIZE)})
  --quality N       WebP quality (default ${String(THUMB_QUALITY)})
  --tone blue|neutral   keep the renderer's blue, or desaturate (default)
  --force           re-encode objects that already exist
  --concurrency N   requests in flight (default 2 — this is a production bucket)
  --no-colour       skip the chroma measurement (one fewer decode per sheet)
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
  if (args.mode.kind === 'inventory') return inventory(args, catalog)

  const { targets, withoutSprite, records, deduped } = spriteTargets(catalog)

  const picks = select(args, targets)
  const prefix = thumbPrefix(catalog)
  const manifestPath = args.manifest ?? join(args.out, 'upload-manifest.json')

  process.stdout.write(
    plan(args, catalog.version.fixtures, { records, targets: targets.length, deduped, withoutSprite, picks }),
  )
  if (args.dryRun) {
    process.stdout.write('\noutput        (dry run — no network, nothing written)\n')
    return 0
  }

  const report = await runThumbnails({
    catalog,
    picks,
    outDir: args.out,
    ...(args.cache === undefined ? {} : { cacheDir: args.cache }),
    ...(args.frame === undefined ? {} : { frame: args.frame }),
    size: args.size,
    quality: args.quality,
    tone: args.tone,
    force: args.force,
    ...(args.concurrency === undefined ? {} : { concurrency: args.concurrency }),
    measureColour: args.colour,
    onProgress: (event) => {
      if (event.outcome === 'failed') {
        process.stderr.write(`  ! ${event.blob}: ${event.reason ?? 'failed'}\n`)
      }
    },
  })

  const manifest = buildUploadManifest({
    catalog,
    prefix,
    staged: relative(REPO_ROOT, args.out) || '.',
    frame: report.frame,
    size: report.size,
    quality: report.quality,
    tone: report.tone,
    files: report.files,
  })
  mkdirSync(dirname(manifestPath), { recursive: true })
  writeFileSync(manifestPath, serialiseUploadManifest(manifest))

  process.stdout.write(results(args, report, catalog.sprite, targets.length, manifestPath))
  process.stdout.write(`\n${manifest.commands.join('\n')}\n`)

  return report.failed.length === 0 ? 0 : 1
}

/* --------------------------------------------------------------------- args */

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    catalog: CATALOG_PATH,
    out: DEFAULT_OUT_DIR,
    cache: DEFAULT_CACHE_DIR,
    mode: { kind: 'sample', limit: DEFAULT_SAMPLE_SIZE },
    inventory: THUMB_INVENTORY_PATH,
    size: THUMB_SIZE,
    quality: THUMB_QUALITY,
    tone: 'neutral',
    force: false,
    colour: true,
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
    switch (flag) {
      case '--sample':
        args.mode = { kind: 'sample', limit: integer(value(), '--sample') }
        break
      case '--screenful':
        args.mode = { kind: 'screenful', cards: integer(value(), '--screenful') }
        break
      case '--all':
        args.mode = { kind: 'all' }
        break
      case '--inventory':
        args.mode = { kind: 'inventory' }
        break
      case '--inventory-path':
        args.inventory = value()
        break
      case '--out':
        args.out = value()
        break
      case '--cache':
        args.cache = value()
        break
      case '--no-cache':
        delete args.cache
        break
      case '--manifest':
        args.manifest = value()
        break
      case '--catalog':
        args.catalog = value()
        break
      case '--frame':
        args.frame = integer(value(), '--frame')
        break
      case '--size':
        args.size = integer(value(), '--size')
        break
      case '--quality':
        args.quality = integer(value(), '--quality')
        break
      case '--tone': {
        const tone = value()
        if (tone !== 'blue' && tone !== 'neutral') throw new Error(`--tone must be blue or neutral, got ${tone}`)
        args.tone = tone
        break
      }
      case '--force':
        args.force = true
        break
      case '--concurrency':
        args.concurrency = integer(value(), '--concurrency')
        break
      case '--no-colour':
      case '--no-color':
        args.colour = false
        break
      case '--dry-run':
        args.dryRun = true
        break
      default:
        throw new Error(`unknown option ${String(flag)}\n\n${USAGE}`)
    }
  }
  return args
}

function integer(raw: string, flag: string): number {
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${flag} needs a positive integer, got ${raw}`)
  return value
}

function select(args: Args, targets: Parameters<typeof selectSample>[0]): SamplePick[] {
  switch (args.mode.kind) {
    case 'all':
      return selectAll(targets)
    case 'screenful':
      return selectScreenful(targets, args.mode.cards)
    case 'sample':
      return selectSample(targets, { limit: args.mode.limit })
    case 'inventory':
      // Unreachable: `main` returns before this. Stated rather than defaulted,
      // so adding a mode is a compile error here and not a silent full run.
      throw new Error('--inventory renders nothing and selects no sheets')
  }
}

/* ------------------------------------------------------------------ inventory */

/**
 * Ask the bucket which thumbnails exist and write `pipeline/thumbs/inventory.json`.
 *
 * Every candidate, never a sample — see the header note. Nothing is written
 * when any probe failed: an inventory that could not ask about an object cannot
 * tell "absent" from "no answer", and emitting `thumb: false` for it would take
 * a working thumbnail out of the grid until somebody noticed.
 */
async function inventory(args: Args, catalog: CatalogFile): Promise<number> {
  const blobs = thumbCandidates(catalog)
  const before = readThumbInventory(args.inventory)

  process.stdout.write(
    `${[
      `catalog       ${args.catalog}`,
      `  fixtures    ${catalog.version.fixtures}`,
      `probe         ${String(blobs.length)} distinct sprite-carrying md5s`,
      `  base        ${catalog.assets.thumbs}`,
      `  previous    ${
        before === undefined
          ? '(no inventory on disk)'
          : `${String(before.counted.present)} present, probed ${before.probed}`
      }`,
      `output        ${args.inventory}`,
      '',
    ].join('\n')}\n`,
  )

  if (args.dryRun) {
    process.stdout.write('probe         (dry run — no network, nothing written)\n')
    return 0
  }

  let done = 0
  const report = await probeThumbs({
    catalog,
    blobs,
    ...(args.concurrency === undefined ? {} : { concurrency: args.concurrency }),
    onProgress: (event) => {
      done += 1
      // One line per thousand: a per-object line is 8,352 lines of noise, and a
      // silent eight-minute run looks hung.
      if (done % 1000 === 0 || done === event.total) {
        process.stdout.write(`  probed      ${String(done)} of ${String(event.total)}\n`)
      }
    },
  })

  const { counted } = report.inventory
  const gained = report.inventory.present.filter((blob) => !(before?.present ?? []).includes(blob)).length
  process.stdout.write(
    `${[
      '',
      `result        ${String(counted.present)} present · ${String(counted.absent)} absent · ` +
        `${String(counted.failed)} failed · ${(report.elapsedMs / 1000).toFixed(1)} s`,
      `  new         ${String(gained)} since the previous inventory`,
      ...report.failures.slice(0, 20).map((failure) => `  ! ${failure.blob}  ${failure.reason}`),
    ].join('\n')}\n`,
  )

  if (counted.failed > 0) {
    process.stderr.write(
      `\n${String(counted.failed)} probes failed, so this inventory cannot distinguish an absent ` +
        'thumbnail from an unanswered request. Nothing was written; re-run when the bucket is ' +
        'reachable.\n',
    )
    return 1
  }

  mkdirSync(dirname(args.inventory), { recursive: true })
  writeFileSync(args.inventory, serialiseThumbInventory(report.inventory))
  process.stdout.write(
    `\nwrote         ${args.inventory}\nnext          npm run import:catalog\n`,
  )
  return 0
}

/* ------------------------------------------------------------------ reporting */

function plan(
  args: Args,
  fixturesRef: string,
  index: {
    records: number
    targets: number
    deduped: number
    withoutSprite: string[]
    picks: readonly SamplePick[]
  },
): string {
  const strata = strataCounts(index.picks)
  return `${[
    `catalog       ${args.catalog}`,
    `  fixtures    ${fixturesRef}`,
    `  records     ${String(index.records)} live · ${String(index.targets)} distinct sheets ` +
      `(${String(index.deduped)} collapsed by md5)`,
    `  no sprite   ${String(index.withoutSprite.length)}${
      index.withoutSprite.length === 0 ? '' : ` — ${index.withoutSprite.join(', ')}`
    }`,
    `plan          ${String(index.picks.length)} sheets · ${describe(strata)}`,
    `thumbnail     frame ${String(args.frame ?? 'default')} · ${String(args.size)} px · q${String(args.quality)} webp · ${args.tone}`,
    `staging       ${args.out}`,
    `cache         ${args.cache ?? '(disabled)'}`,
  ].join('\n')}\n`
}

function results(
  args: Args,
  report: RunReport,
  sprite: SpriteSheet,
  corpusSheets: number,
  manifestPath: string,
): string {
  const stats = measure(report.stats, {
    corpus: { ...PR13, tiles: corpusSheets, sheets: corpusSheets },
    sheetExtent: sheetExtent(sprite),
    thumbSize: report.size,
    elapsedMs: report.elapsedMs,
  })
  const chroma = report.neutrality

  const lines = [
    '',
    `run           ${String(report.written)} written · ${String(report.skipped)} skipped · ${String(report.failed.length)} failed ` +
      `· ${(report.elapsedMs / 1000).toFixed(1)} s`,
    `  network     ${String(report.fetched)} fetched · ${String(report.fromCache)} from cache`,
    `thumbnails    total ${formatBytes(stats.thumb.total)} over ${String(stats.thumb.count)} objects`,
    `  size        mean ${formatBytes(stats.thumb.mean)} · median ${formatBytes(stats.thumb.median)} ` +
      `· p95 ${formatBytes(stats.thumb.p95)} · min ${formatBytes(stats.thumb.min)} · max ${formatBytes(stats.thumb.max)} ` +
      `· sd ${formatBytes(stats.thumb.stdev)}`,
    `  sheets      mean ${formatBytes(stats.sheet.mean)} · median ${formatBytes(stats.sheet.median)} ` +
      `· max ${formatBytes(stats.sheet.max)}`,
    `  reduction   ${stats.reductionOverall.toFixed(1)}× on totals · ${stats.reductionMedian.toFixed(1)}× on medians`,
    `screenful     ${String(stats.screenful.cards)} cards${stats.screenful.complete ? '' : ' (short of a viewport)'}: ` +
      `${formatBytes(stats.screenful.sheetBytes)} → ${formatBytes(stats.screenful.thumbBytes)} ` +
      `(${stats.screenful.reduction.toFixed(1)}×), measured`,
    `${String(stats.cardRun.cards)}-card run   ${formatBytes(stats.cardRun.sheetBytes)} (PR 13, measured) → ` +
      `${formatBytes(stats.cardRun.projectedThumbBytes)} projected (${stats.cardRun.reduction.toFixed(1)}×)`,
    `corpus        ${String(stats.corpus.sheets)} sheets: ${formatBytes(stats.corpus.sheetBytes)} → ` +
      `${formatBytes(stats.corpus.projectedThumbBytes)} projected (${stats.corpus.reduction.toFixed(1)}×)`,
    `decode        one sheet ${formatBytes(stats.decode.sheetBytes)} → one thumbnail ` +
      `${formatBytes(stats.decode.thumbBytes)} (${stats.decode.factor.toFixed(0)}×); ` +
      `${String(PR13.cards)} cards ${formatBytes(stats.decode.screenfulSheetBytes)} → ` +
      `${formatBytes(stats.decode.screenfulThumbBytes)} of source bitmap`,
  ]

  if (chroma.opaque > 0) {
    lines.push(
      `colour        ${(100 * chroma.share).toFixed(1)}% of ${String(chroma.opaque)} opaque pixels are non-neutral ` +
        `· mean chroma ${chroma.meanChroma.toFixed(1)}/255 · mean rgb ` +
        `${chroma.mean.r.toFixed(0)},${chroma.mean.g.toFixed(0)},${chroma.mean.b.toFixed(0)}`,
    )
  }
  if (report.failed.length > 0) {
    lines.push(`failures      ${String(report.failed.length)}:`)
    for (const failure of report.failed.slice(0, 20)) {
      lines.push(`  ${failure.blob}  ${failure.reason}`)
    }
  }
  lines.push(
    `units         1024-based, as pipeline/emit.ts prints them · ${PR13_UNIT_NOTE}`,
    `manifest      ${manifestPath} — ${String(report.files.length)} objects, nothing uploaded`,
    `tone          ${args.tone}${args.tone === 'blue' ? ' (the raw stl-thumb render; see architecture-plan.md §8)' : ''}`,
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
