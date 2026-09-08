/**
 * The app's one fetch of `catalog.json`, memoised.
 *
 * ## What this module was, and what deleting the stat left behind
 *
 * design-contract.md §2.0 ended the header with a right-aligned mono stat —
 * `{n} tiles · s3 archive` — and this module was that stat: the count read off
 * the emitted index rather than written down, the host named as
 * `objects.openforge.tools` because the archive has never been on S3, a context
 * so a test or a screen could supply both from outside, and a narrow
 * *unvalidated* read of `records.length` so a schema drift in one record's
 * `footprint` could not blank a number in the chrome.
 *
 * **The sidebar row deleted the header, and the stat with it.** The rail is a
 * column now, and the stat was the one thing in the old header that was neither
 * navigation nor identity — it had already been the first thing dropped at
 * 900px, by a media query that said as much. So the context, the provider, the
 * hook and the unvalidated read are all gone; what nothing else could replace is
 * the fetch, and that is the whole of this file now.
 *
 * The second memo went with the stat. There were two — one on the raw document
 * for the stat's structural read, one on the parsed document for everything else
 * — because validating 8,702 records costs a measured 45-90 ms and two callers
 * wanted the index. With one reader left there is one promise.
 *
 * ## Why the loader is here, and where it should end up
 *
 * The index is 5.6 MB of JSON (364 KB brotli), and the catalog screen needs all
 * of it for its facet index while `@/mesh` needs it for a tile's files. Fetching
 * it twice would parse it twice, so the parse is memoised at module scope and
 * exposed as {@link loadCatalogIndex}: the first caller pays, every later caller
 * gets the same promise.
 *
 * That loader belongs in `src/catalog/`, next to the schema it validates
 * against. It is here because PR 3 owned that directory and the seam PR that
 * needed the fetch did not, and a seam PR inventing a file in someone else's
 * directory is worse than one exporting a function from its own. That argument
 * has outlived both PRs and is now the only reason a data loader lives under
 * `src/ui/`. When someone moves it, the export name should survive the move —
 * `@/screens/catalog` and `@/mesh` both import it by name.
 */
// `CatalogFile` is exported as both a Zod schema and the type it infers, so one
// named import serves the `parse` call and the return annotation.
import { CatalogFile } from '@/catalog'

/** Where the build writes the index. `scripts/import-catalog.ts` emits it. */
const CATALOG_INDEX_PATH = '/catalog/catalog.json'

/* ---------------------------------------------------------------- the fetch */

let parsed: Promise<CatalogFile> | null = null

/**
 * Discard the memoised fetch.
 *
 * Exported for tests, which need each case to start from no cached index. There
 * is no reason for the app to call it: the index is a build artefact with a
 * version stamp, so it cannot change under a running session.
 */
export function resetCatalogIndexCache(): void {
  parsed = null
}

/**
 * The whole index, validated against {@link CatalogFile}.
 *
 * Import this rather than fetching `catalog.json` yourselves, so the app pays
 * for one request and one parse.
 *
 * The *parse* is memoised and not just the fetch: validating 8,702 records costs
 * a measured 45-90 ms, and memoising only the fetch — as this did originally —
 * paid that cost once per caller while the docblock claimed otherwise.
 */
export async function loadCatalogIndex(): Promise<CatalogFile> {
  parsed ??= fetch(new URL(CATALOG_INDEX_PATH, window.location.href))
    .then((response) => {
      if (!response.ok) {
        throw new Error(`catalog index: ${String(response.status)} ${response.statusText}`)
      }
      return response.json()
    })
    .then((raw) => CatalogFile.parse(raw))
  return parsed
}
