/**
 * Serialising the catalog.
 *
 * ## What used to be here, and why none of it is
 *
 * **The size budget.** This module measured the emitted index and failed the
 * build when it exceeded a 500 KB brotli ceiling — `SizeReport`,
 * `measureCatalog` and `assertWithinBudget`. The ceiling was a product decision
 * and it was revisited: the app is a 3D tool that already pays for `three`, a
 * mesh fetch and a render, the index is ~366 KB against a budget that was never
 * close to binding, and a longer cold load is explicitly acceptable. Measuring a
 * delta nobody would act on cost more than it bought — brotli at quality 11 over
 * 5.9 MB is ~6.6 s per call, and the tests around it were **61% of the whole
 * suite's running time**.
 *
 * **The precompressed artefact.** `compressCatalog` wrote
 * `public/catalog/catalog.json.br` for "a CDN that serves precompressed files",
 * and this deploy is not one. `wrangler.jsonc` configures Workers Static Assets
 * with no Worker script, and static assets do not negotiate to a precompressed
 * sibling the way `nginx`'s `brotli_static` does — there was no `_headers` rule
 * and no Worker doing it either. Checked against the live staging deploy rather
 * than assumed: a request for `/catalog/catalog.json` comes back
 * `content-encoding: br` at 483,421 B, compressed by Cloudflare on the fly,
 * while `/catalog/catalog.json.br` sat at its own URL as an uploaded asset
 * nothing ever fetched.
 *
 * So the build spent 6.6 s a run producing 366 KB that no client received. The
 * trade is real but small and it is taken deliberately: Cloudflare's on-the-fly
 * brotli is a lower quality setting, so visitors now transfer **483 KB instead
 * of 367 KB** — 117 KB more, on a payload nobody is optimising any more.
 *
 * Recovering those 117 KB does not need this function back. Marking the sibling
 * `Content-Encoding: br` in `public/_headers` and fetching it directly would let
 * the browser inflate it with no Worker involved; whether Cloudflare passes such
 * bytes through untouched is the part that would need testing first.
 *
 * **Not replaced:** nothing checks the artefact's size any more, in the build or
 * in the tests. A pipeline defect that stopped interning tags or duplicated
 * every record would ship a much larger file silently. An accepted gap rather
 * than an oversight.
 */
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

/** 1024-based byte formatting for build reports. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}
