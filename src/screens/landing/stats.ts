/**
 * The hero's four figures, derived from the emitted index.
 *
 * design-contract.md §2.1 asks for "four mono stats: catalogued tiles, texture
 * sets, build systems, MB of STLs". **None of them is a constant here.** The
 * landing page is where a visitor decides whether this archive is worth their
 * time, so its numbers are the ones most worth being true, and a hard-coded
 * `8,702` is a claim that rots the first time the importer runs — silently,
 * because nothing tests a string. The header made the same call for the same
 * reason (`src/ui/shell/catalogStats.tsx`).
 *
 * Each figure below records what it currently comes out at, so a reviewer can
 * see the drift, and `landing.test.tsx` drives the derivation from a fixture
 * index rather than from the real one — a test that asserted 8,702 would be
 * asserting the data, not the code.
 */
import type { CatalogFile } from '@/catalog'

/** Prefix marking a texture tag. The root is the segment that follows it. */
const TEXTURE_PREFIX = 'texture|'

export interface LandingStats {
  /** Live tiles in the index. Currently 8,702. */
  tiles: number
  /** Distinct level-1 texture roots. Currently 38. */
  textureSets: number
  /** Distinct `build|` systems. Currently 5. */
  buildSystems: number
  /** Total STL bytes across the catalogued tiles. Currently 108.0 GB. */
  bytes: number
}

/**
 * Read the four figures off a parsed index.
 *
 * Where each comes from, and why that source and not another:
 *
 *   - **tiles** — `records.length`. The index holds live tiles only; the 19
 *     `deprecated` fixture rows never reach it, so this is already the number
 *     the contract means by "catalogued".
 *
 *   - **textureSets** — distinct roots across the *tag intern table*, not
 *     distinct `record.texture` values. The two disagree, and the difference is
 *     documented in `src/materials/mapping.ts`: 37 roots exist, but only 36 can
 *     ever appear in `record.texture`, because `stucco` is always outranked by
 *     an earlier tag in first position. The catalog sidebar filters textures by
 *     prefix over the whole tag list, so all 37 are reachable as a filter — and
 *     the landing stat should count what the catalog can actually offer.
 *
 *   - **buildSystems** — distinct `record.build`. Five: `s2w`, `wall on tile`,
 *     `separate wall`, `thick wall`, `s-system`. It is the smallest of the four
 *     figures by two orders of magnitude and it stays, because it is the axis a
 *     printer chooses along and 2,978 tiles (34.2%) carry no build tag at all,
 *     which is itself worth knowing.
 *
 *   - **bytes** — summed over records, so it is the size of *what the catalog
 *     lists* and is consistent with the tile count beside it. It is not the size
 *     of the bucket: 8,702 records share 8,353 distinct md5s (171 md5s are filed
 *     under 2+ catalog paths, which is correct data modelling, see
 *     `BlobId`), so the distinct bytes are 106.1 GB against this 108.0 GB.
 */
export function deriveLandingStats(file: CatalogFile): LandingStats {
  const textureRoots = new Set<string>()
  for (const tag of file.tags) {
    if (tag.startsWith(TEXTURE_PREFIX)) {
      textureRoots.add(tag.slice(TEXTURE_PREFIX.length).split('|')[0] ?? '')
    }
  }

  const buildSystems = new Set<string>()
  let bytes = 0
  for (const record of file.records) {
    if (record.build !== undefined) buildSystems.add(record.build)
    bytes += record.bytes
  }

  return {
    tiles: file.records.length,
    textureSets: textureRoots.size,
    buildSystems: buildSystems.size,
    bytes,
  }
}

/* --------------------------------------------------------------- formatting */

/** English-only app, so an explicit locale rather than the visitor's. */
const NUMBER = new Intl.NumberFormat('en-US')

/** `8702` → `"8,702"`. */
export function formatCount(value: number): string {
  return NUMBER.format(value)
}

/**
 * A byte total split into a figure and its unit, so the unit can be set smaller
 * than the number beside it.
 *
 * **The contract's label is "MB of STLs" and that label is now wrong.** The
 * corpus is 108.0 GB — the mock was written against 31 hand-written tiles, where
 * megabytes were the right unit. Rendering 108,003 MB to match the label would
 * be technically true and actively misleading about the scale of the archive, so
 * the unit is chosen from the value. Decimal GB (10⁹), matching the figures in
 * `src/catalog/schema.ts` and `docs/verify-catalog-facts.py`.
 */
export function formatBytes(value: number): { figure: string; unit: string } {
  if (value >= 1e9) return { figure: (value / 1e9).toFixed(1), unit: 'GB' }
  if (value >= 1e6) return { figure: (value / 1e6).toFixed(0), unit: 'MB' }
  return { figure: (value / 1e3).toFixed(0), unit: 'kB' }
}
