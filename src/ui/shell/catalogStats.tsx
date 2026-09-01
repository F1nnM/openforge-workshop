/**
 * The header's archive stat, and the one fetch of `catalog.json` it shares.
 *
 * design-contract.md §2.0 ends the header with a right-aligned mono stat:
 * `{n} tiles · s3 archive`. Two things about that line need deciding, and this
 * module is where both live.
 *
 * ## Where the number comes from
 *
 * From the emitted index, never from a literal. The count is the one number in
 * the chrome that a reader will treat as a fact about the archive, and a
 * hard-coded `8,702` becomes a lie the first time the importer runs — silently,
 * because nothing tests a string. So the header reads `records.length` off
 * `public/catalog/catalog.json`, and shows the mock's own placeholder (`…`, see
 * `design/OpenForge-Studio.dc.html`: `statTiles: tiles.length || '…'`) until the
 * fetch lands.
 *
 * ## Why the loader is here, and where it should end up
 *
 * The index is 5.6 MB of JSON (364 KB brotli), and rows 13 and 16 both need all
 * of it — the catalog screen for its facet index, the landing screen for its
 * four live stats. Fetching it twice would parse it twice. So the fetch is
 * memoised at module scope and exposed as {@link loadCatalogIndex}: the first
 * caller pays, every later caller gets the same promise.
 *
 * That loader belongs in `src/catalog/`, next to the schema it validates
 * against. It is here because PR 3 owns that directory and this PR does not, and
 * a seam PR inventing a file in someone else's directory is worse than one
 * exporting a function from its own. When someone moves it, the export name
 * should survive the move — rows 13 and 16 import it by name.
 *
 * ## Why `loadCatalogStats` does not validate
 *
 * {@link loadCatalogIndex} runs the full Zod parse, because unvalidated records
 * reaching the facet engine or a three.js material is the failure mode
 * `CatalogFile`'s integrity checks exist to catch. The header wants two scalars
 * out of the same document, and a schema drift in some record's `footprint`
 * should not blank the tile count in the chrome. So the stats read is narrow and
 * structural: it walks to `records.length` and `assets.models` and asserts
 * nothing else.
 */
import type { ReactNode } from 'react'
import { createContext, useContext, useEffect, useState } from 'react'

// `CatalogFile` is exported as both a Zod schema and the type it infers, so one
// named import serves the `parse` call and the return annotation.
import { CatalogFile } from '@/catalog'

/** Where the build writes the index. `scripts/import-catalog.ts` emits it. */
const CATALOG_INDEX_PATH = '/catalog/catalog.json'

/** What the header needs to know about the archive. */
export interface CatalogStats {
  /** Live tiles in the emitted index — the `{n}` of `{n} tiles`. */
  tileCount: number
  /**
   * Host serving the STL archive, read from the index's own `assets.models`.
   *
   * The contract says `s3 archive`; the archive is an HTTPS Cloudflare R2 bucket
   * on `objects.openforge.tools` and has never been on S3, so the header names
   * the host the index actually points at rather than a storage vendor it does
   * not use. Reading it from the index also means moving the bucket updates the
   * chrome without anyone editing this file.
   */
  archiveHost: string
}

/* ---------------------------------------------------------------- the fetch */

let pending: Promise<unknown> | null = null
let parsed: Promise<CatalogFile> | null = null

/** The raw parsed document, fetched at most once per session. */
function rawCatalog(): Promise<unknown> {
  pending ??= fetch(new URL(CATALOG_INDEX_PATH, window.location.href)).then((response) => {
    if (!response.ok) {
      throw new Error(`catalog index: ${String(response.status)} ${response.statusText}`)
    }
    return response.json()
  })
  return pending
}

/**
 * Discard the memoised fetch.
 *
 * Exported for tests, which need each case to start from no cached index. There
 * is no reason for the app to call it: the index is a build artefact with a
 * version stamp, so it cannot change under a running session.
 */
export function resetCatalogIndexCache(): void {
  pending = null
  parsed = null
}

/**
 * The whole index, validated against {@link CatalogFile}.
 *
 * Import this rather than fetching `catalog.json` yourselves, so the app pays
 * for one request and one parse.
 *
 * The *parse* is memoised, not just the fetch. Validating 8,702 records costs a
 * measured 45-90 ms, and the landing screen and the catalog screen both want
 * the index — so memoising only the fetch (as this did originally) paid that
 * cost twice while the docblock claimed otherwise.
 */
function parsedCatalog(): Promise<CatalogFile> {
  parsed ??= rawCatalog().then((raw) => CatalogFile.parse(raw))
  return parsed
}

export async function loadCatalogIndex(): Promise<CatalogFile> {
  return parsedCatalog()
}

/** Read `{ tileCount, archiveHost }` out of the index without validating it. */
export async function loadCatalogStats(): Promise<CatalogStats> {
  const document_ = (await rawCatalog()) as {
    records?: unknown
    assets?: { models?: unknown }
  }

  const records = document_.records
  if (!Array.isArray(records)) throw new Error('catalog index has no records array')

  const models = document_.assets?.models
  if (typeof models !== 'string') throw new Error('catalog index has no assets.models URL')

  return { tileCount: records.length, archiveHost: new URL(models).host }
}

/* -------------------------------------------------------------- the context */

/**
 * `undefined` means "nobody is providing these", which is the signal
 * {@link useCatalogStats} uses to load them itself. A provider supplying `null`
 * therefore means something different and useful: *known* to be unavailable, so
 * render the placeholder and do not fetch. Tests use both.
 */
const CatalogStatsContext = createContext<CatalogStats | null | undefined>(undefined)

export interface CatalogStatsProviderProps {
  value: CatalogStats | null
  children: ReactNode
}

/**
 * Supply the archive stats from outside.
 *
 * The frame does not render one — left alone, the header loads its own. This
 * exists for the two cases where that is wrong: a test that wants a fixed count
 * and no network, and a screen that has already loaded the index and would
 * rather hand over what it has.
 */
export function CatalogStatsProvider({ value, children }: CatalogStatsProviderProps) {
  return <CatalogStatsContext.Provider value={value}>{children}</CatalogStatsContext.Provider>
}

/**
 * The archive stats, or `null` while they are unknown.
 *
 * Self-loading when no provider is above it, which is what keeps the header
 * honest without making the frame own a data dependency. A failed load resolves
 * to `null` — the stat keeps its placeholder. It is chrome; it does not get to
 * take a screen down with it.
 */
export function useCatalogStats(): CatalogStats | null {
  const provided = useContext(CatalogStatsContext)
  const [loaded, setLoaded] = useState<CatalogStats | null>(null)

  useEffect(() => {
    if (provided !== undefined) return
    let alive = true
    loadCatalogStats().then(
      (stats) => {
        if (alive) setLoaded(stats)
      },
      (error: unknown) => {
        // Only while still mounted: a frame that unmounted mid-flight (every
        // component test that renders the router without supplying stats) has
        // nothing to report and should not narrate it.
        if (alive) console.warn('archive stats unavailable', error)
      },
    )
    return () => {
      alive = false
    }
  }, [provided])

  return provided ?? loaded
}
