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
 * The import writes three files it is not the only writer of, and all three matter:
 *
 *   - `public/catalog/catalog.json` (+ `.br`) — gitignored, rebuilt in CI.
 *   - `pipeline/ordinals/manifest.json` — **checked in**. It is the append-only
 *     record of which integer every share link means.
 *   - `src/screens/assemblies/templates.ts` — **checked in, and generated**. The
 *     40 recipe templates, read out of the 20 `*.yaml` fixtures the index
 *     deliberately skips. They are not records — none carries `file_metadata` —
 *     and they are not in `catalog.json`; `pipeline/templates.ts` carries the
 *     +1,260 B measurement behind that and the reason. This step is the only
 *     thing that should write that module, and `pipeline/templates.test.ts`
 *     fails when its committed bytes are not what the emitter produces.
 *
 * `--dry-run` skips all three, so a size check on a branch cannot append
 * ordinals or rewrite a source file as a side effect.
 *
 * It reads a third, `pipeline/thumbs/inventory.json`, and never writes it. That
 * file says which blobs have a `/thumbs/` object and is what `CatalogRecord.thumb`
 * comes from; `npm run thumbs -- --inventory` is the only thing that produces it,
 * because answering the question means asking the bucket and this build has to
 * stay a pure function of the fixtures. An absent inventory is not an error — a
 * fresh clone has none — and it means every record emits `thumb: false`, which
 * is the truth today. The report below prints the count either way, so a stale
 * inventory after a backfill reads as `0 of 8,352` rather than as nothing.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  TEMPLATES_MODULE_PATH,
  assertWithinBudget,
  buildCatalog,
  compressCatalog,
  fixturesDir,
  formatBytes,
  loadFixtureRows,
  loadManifest,
  loadTemplateFixtures,
  measureCatalog,
  printTemplateModule,
  readThumbInventory,
  resolveFixturesRef,
  serialiseCatalog,
  thumbBlobs,
  writeManifest,
} from '../pipeline'

const OUT_DIR = join(process.cwd(), 'public', 'catalog')

function main(): number {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const dir = fixturesDir(args.find((arg) => !arg.startsWith('-')))

  const rows = loadFixtureRows(dir)
  const templates = loadTemplateFixtures(dir)
  const inventory = readThumbInventory()
  const result = buildCatalog({
    rows,
    manifest: loadManifest(),
    fixturesRef: resolveFixturesRef(dir),
    thumbs: thumbBlobs(inventory),
  })

  const json = serialiseCatalog(result.file)
  const size = measureCatalog(json)
  const module = printTemplateModule(templates)
  report(dir, result, size, dryRun, inventory, templates, module)

  if (!dryRun) {
    mkdirSync(OUT_DIR, { recursive: true })
    writeFileSync(join(OUT_DIR, 'catalog.json'), json)
    writeFileSync(join(OUT_DIR, 'catalog.json.br'), compressCatalog(json))
    writeManifest(result.manifest)
    writeFileSync(join(process.cwd(), TEMPLATES_MODULE_PATH), module)
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
  inventory: ReturnType<typeof readThumbInventory>,
  templates: ReturnType<typeof loadTemplateFixtures>,
  module: string,
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
    `thumbs        ${String(stats.withThumb)} of ${String(stats.records)} records have a /thumbs/ ` +
      `object — ${
        inventory === undefined
          ? 'no inventory on disk; run `npm run thumbs -- --inventory`'
          : `${String(inventory.counted.present)} of ${String(inventory.counted.probed)} blobs, probed ${inventory.probed}`
      }`,
    `names         ${String(stats.distinctNames)} distinct over ${String(stats.records)} records`,
    `ordinals      ${String(result.manifest.ids.length)} issued · ${String(stats.newOrdinals)} new · ${String(stats.retiredOrdinals)} retired`,
    `size          raw ${formatBytes(size.raw)} · gzip ${formatBytes(size.gzip)} · brotli ${formatBytes(size.brotli)} of ${formatBytes(size.budget)} budget`,
    `templates     ${String(templates.length)} recipes over ${String(new Set(templates.map((entry) => entry.source)).size)} yaml fixtures · ` +
      `${String(templates.reduce((total, entry) => total + entry.parts.length, 0))} parts · ` +
      `${formatBytes(Buffer.byteLength(module, 'utf8'))} raw of generated module, 0 B of the index`,
    dryRun
      ? 'output        (dry run — nothing written)'
      : `output        ${OUT_DIR}/catalog.json · ${TEMPLATES_MODULE_PATH}`,
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
