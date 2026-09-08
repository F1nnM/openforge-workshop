/**
 * Serialising the catalog, and producing the precompressed artefact beside it.
 *
 * ## What used to be here, and why it is gone
 *
 * This module also measured the emitted index and failed the build when it
 * exceeded a 500 KB brotli ceiling — `SizeReport`, `measureCatalog` and
 * `assertWithinBudget`. The ceiling was a product decision and it has been
 * revisited: the app is a 3D tool that already pays for `three`, a mesh fetch
 * and a render, the index is ~366 KB against a budget that was never close to
 * binding, and a longer cold load is explicitly acceptable. Measuring a delta
 * nobody would act on was costing more than it bought — brotli at quality 11
 * over 5.9 MB is ~6.6 s per call, and the tests around it were **61% of the
 * whole suite's running time**.
 *
 * What is deliberately *not* replaced: nothing checks the artefact's size any
 * more, in the build or in the tests. A pipeline defect that stops interning
 * tags or duplicates every record would ship a much larger file silently. That
 * is an accepted gap rather than an oversight.
 *
 * {@link compressCatalog} stays, because it is not a measurement — it writes
 * `catalog.json.br`, which is the artefact a CDN serves.
 */
import { brotliCompressSync, constants } from 'node:zlib'

import type { CatalogFile } from '../src/catalog'

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
 * The brotli artefact itself, for a CDN that serves precompressed files.
 *
 * Quality 11 with the size hint set, which is what a precompressed asset is
 * built with. This runs once per build, not once per test.
 */
export function compressCatalog(json: string): Buffer {
  const bytes = Buffer.from(json, 'utf8')
  return brotliCompressSync(bytes, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
      [constants.BROTLI_PARAM_SIZE_HINT]: bytes.byteLength,
    },
  })
}

/** 1024-based byte formatting for build reports. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}
