/**
 * Serialising the catalog, measuring it, and failing when it will not fit.
 *
 * The size assertion is here rather than in CI config because the number it
 * guards is a *product* decision — how much a cold load costs — and it should
 * break the build that caused it, on the machine that caused it, with the
 * offending measurement printed.
 */
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'

import type { CatalogFile } from '../src/catalog'

import { SIZE_BUDGET_BYTES } from './version'

export interface SizeReport {
  raw: number
  gzip: number
  brotli: number
  budget: number
  withinBudget: boolean
}

/**
 * Compact JSON. No pretty-printing: the artefact is fetched, not read, and
 * indentation is a third of the raw bytes for nothing.
 *
 * Key order comes from `CatalogFile.parse`'s output, which follows the schema's
 * declaration order — so it is the schema, not this function, that decides it,
 * and two runs cannot disagree.
 */
export function serialiseCatalog(file: CatalogFile): string {
  return JSON.stringify(file)
}

/**
 * Raw, gzip and brotli sizes.
 *
 * Brotli at quality 11 with the size hint set is what a precompressed CDN asset
 * is built with, so anything less would flatter the measurement. Gzip is
 * reported because it is what a client without `br` in `Accept-Encoding` gets.
 */
export function measureCatalog(json: string, budget: number = SIZE_BUDGET_BYTES): SizeReport {
  const bytes = Buffer.from(json, 'utf8')
  const brotli = brotliCompressSync(bytes, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
      [constants.BROTLI_PARAM_SIZE_HINT]: bytes.byteLength,
    },
  }).byteLength

  return {
    raw: bytes.byteLength,
    gzip: gzipSync(bytes, { level: 9 }).byteLength,
    brotli,
    budget,
    withinBudget: brotli <= budget,
  }
}

/**
 * @throws when the payload is over budget.
 *
 * **§5's contingency was measured and it is the wrong lever.** The plan says
 * that if the full index overshoots, tags stay inline and configs move to a
 * lazily-fetched second asset. Measured over the real corpus at 355.8 KB brotli,
 * dropping every `config` saves **5.4 KB** and dropping every `tags` array saves
 * 19.7 KB — together 24.8 KB, or 7% of the payload. Both are enormous raw (611 KB
 * and 305 KB) and almost free compressed, because the corpus has 104 distinct
 * config refs and 915 distinct tags and brotli collapses the repetition.
 *
 * The payload is 8,702 catalog paths. `id` alone is most of it, with `file`
 * (23.5 KB) and `family` (11.3 KB) as its basename and dirname. So the real
 * headroom is corpus growth, not fields: at 41.8 bytes per record brotli, the
 * 500 KB budget is reached at roughly **12,200 records** — 40% growth from
 * today. Anything that trims this index meaningfully has to shorten the
 * identity, and that is the schema's decision rather than the importer's.
 */
export function assertWithinBudget(report: SizeReport): void {
  if (report.withinBudget) return
  throw new Error(
    `catalog.json is ${formatBytes(report.brotli)} brotli, over the ${formatBytes(report.budget)} budget ` +
      `(raw ${formatBytes(report.raw)}, gzip ${formatBytes(report.gzip)}). ` +
      'Dropping `config` and `tags` recovers only ~25 KB brotli between them; the payload is the 8,702 ' +
      'catalog paths in `id`, `family` and `file`, so the fix is a shorter identity encoding in ' +
      'src/catalog/schema.ts, not a second asset.',
  )
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

/** The brotli artefact itself, for a CDN that serves precompressed files. */
export function compressCatalog(json: string): Buffer {
  const bytes = Buffer.from(json, 'utf8')
  return brotliCompressSync(bytes, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
      [constants.BROTLI_PARAM_SIZE_HINT]: bytes.byteLength,
    },
  })
}
