#!/usr/bin/env tsx
/**
 * Build `public/catalog/catalog.json` from the `openforge-catalog` fixtures.
 *
 *     npm run import:catalog
 *     OPENFORGE_FIXTURES=/path/to/blueprints npm run import:catalog
 *     npm run import:catalog -- --dry-run
 *
 * Run under `tsx` rather than Node's own type stripping. Node 22.21 strips types
 * natively, but its ESM resolver still demands a full specifier on every
 * relative import, and the contract module this pipeline validates against —
 * `src/catalog/index.ts` — re-exports `./schema` extensionless because the app
 * is bundler-resolved. Node cannot load it; tsx resolves it the way Vite does.
 * The dependency is free: `tsx` is already in the tree as a dependency of Vite 8
 * and npm dedupes it to the same version.
 *
 * The import writes two files it is not the only writer of, and both matter:
 *
 *   - `public/catalog/catalog.json` (+ `.br`) — gitignored, rebuilt in CI.
 *   - `pipeline/ordinals/manifest.json` — **checked in**. It is the append-only
 *     record of which integer every share link means. `--dry-run` skips both, so
 *     a size check on a branch cannot append ordinals as a side effect.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  assertWithinBudget,
  buildCatalog,
  compressCatalog,
  fixturesDir,
  formatBytes,
  loadFixtureRows,
  loadManifest,
  measureCatalog,
  resolveFixturesRef,
  serialiseCatalog,
  writeManifest,
} from '../pipeline'

const OUT_DIR = join(process.cwd(), 'public', 'catalog')

function main(): number {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const dir = fixturesDir(args.find((arg) => !arg.startsWith('-')))

  const rows = loadFixtureRows(dir)
  const result = buildCatalog({
    rows,
    manifest: loadManifest(),
    fixturesRef: resolveFixturesRef(dir),
  })

  const json = serialiseCatalog(result.file)
  const size = measureCatalog(json)
  report(dir, result, size, dryRun)

  if (!dryRun) {
    mkdirSync(OUT_DIR, { recursive: true })
    writeFileSync(join(OUT_DIR, 'catalog.json'), json)
    writeFileSync(join(OUT_DIR, 'catalog.json.br'), compressCatalog(json))
    writeManifest(result.manifest)
  }

  // Last, so the numbers are printed even when the build fails on them.
  assertWithinBudget(size)
  return 0
}

function report(
  dir: string,
  result: ReturnType<typeof buildCatalog>,
  size: ReturnType<typeof measureCatalog>,
  dryRun: boolean,
): void {
  const { stats, file } = result
  const lines = [
    `fixtures      ${dir}`,
    `  commit      ${file.version.fixtures}`,
    `  rows        ${String(stats.fixtureRows)} (${String(stats.deprecated)} deprecated, ${String(stats.records)} live)`,
    `version       schema ${String(file.version.schema)} · pipeline ${String(file.version.pipeline)} · manifest ${String(file.version.manifest)} · built ${file.version.built}`,
    `footprints    ${describe(stats.footprints, stats.records)}`,
    `layers        ${describe(stats.layers, stats.records)}`,
    `tags          ${String(stats.tags)} distinct · ${String(stats.tagReferences)} references`,
    `designs       ${String(stats.designs)} (${(stats.records / stats.designs).toFixed(2)} files each)`,
    `families      ${String(stats.families)}`,
    `configs       ${String(stats.withConfig)} tiles carry one, unresolved`,
    `names         ${String(stats.distinctNames)} distinct over ${String(stats.records)} records`,
    `ordinals      ${String(result.manifest.ids.length)} issued · ${String(stats.newOrdinals)} new · ${String(stats.retiredOrdinals)} retired`,
    `size          raw ${formatBytes(size.raw)} · gzip ${formatBytes(size.gzip)} · brotli ${formatBytes(size.brotli)} of ${formatBytes(size.budget)} budget`,
    dryRun ? 'output        (dry run — nothing written)' : `output        ${OUT_DIR}/catalog.json`,
  ]
  process.stdout.write(`${lines.join('\n')}\n`)
}

function describe(counts: Record<string, number>, total: number): string {
  return Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .map(([key, count]) => `${key} ${String(count)} (${((100 * count) / total).toFixed(1)}%)`)
    .join(' · ')
}

process.exitCode = main()
