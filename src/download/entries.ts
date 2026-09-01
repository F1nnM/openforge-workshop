/**
 * Naming the entries — the part of the download that is a correctness problem.
 *
 * **89 corpus filenames map to two or three genuinely different meshes.**
 * `tudor#door+narrow.stl` is three distinct md5s across five catalog paths. A ZIP
 * writer given the same entry name twice writes both, and every extractor keeps
 * the last: the user gets one mesh where they asked for three, with no error
 * anywhere. That is a wrong print, not a confusing archive, which is why the
 * uniqueness invariant here is asserted rather than assumed.
 *
 * The disambiguator is **the `full_name` directory**, which is to say the catalog
 * path — `id === family + '/' + file`, verified for all 8,702 live rows, and
 * `CatalogFile` proves `id` unique at parse time. So the long name needs no
 * invention: it is data that already exists and is already known to be unique.
 * `buildBillOfTiles` (PR 9) has already decided *which* lines collide, over the
 * bill rather than over the corpus — a scene holding one `tudor#door+narrow.stl`
 * gets the short name, because prefixing for a collision that is not in the zip
 * would bury every entry five directories deep for nothing.
 *
 * What this module adds on top of that decision:
 *
 *   - a `models/` prefix, which is what makes `LICENSE.txt` and
 *     `ATTRIBUTION.csv` unshadowable by a catalog file that happens to be named
 *     one of them, rather than a check that could be forgotten;
 *   - the leading `tiles/` stripped, since all 8,702 ids carry it and a constant
 *     prefix cannot disambiguate anything;
 *   - sanitisation of segments that a filesystem would reject or reinterpret;
 *   - a **total** uniqueness guarantee, because sanitisation can in principle map
 *     two distinct paths onto one string. Where it does, every member of the
 *     collapsed group takes an `~{md5}` suffix — the md5 is the line's identity,
 *     one line per blob, so the result is unique by construction and the final
 *     assertion is unreachable rather than merely unlikely.
 */
import type { BillLine } from '@/assembly'
import type { BlobId } from '@/catalog'

/** Every model lives under this. See the module note on why it is not optional. */
export const MODELS_PREFIX = 'models/'

/** The licence text, at the archive root. §10, obligation 2. */
export const LICENSE_ENTRY_NAME = 'LICENSE.txt'

/** The per-file attribution table, at the archive root. §10, obligation 2. */
export const ATTRIBUTION_ENTRY_NAME = 'ATTRIBUTION.csv'

/** Names reserved for the licensing entries; no model may take one. */
export const RESERVED_ENTRY_NAMES: readonly string[] = [LICENSE_ENTRY_NAME, ATTRIBUTION_ENTRY_NAME]

/**
 * The prefix every catalog id carries, stripped from long entry names.
 *
 * Verified: all 8,702 live `full_name` values start `tiles/`. Stripping a
 * constant prefix cannot make two distinct paths equal, so this costs nothing in
 * uniqueness and saves a directory level on every disambiguated entry.
 */
export const CATALOG_ROOT_PREFIX = 'tiles/'

/**
 * Entry naming produced a name it could not make unique.
 *
 * Unreachable given the `~{md5}` fallback below; it exists so that if it ever
 * *is* reached the download fails loudly instead of writing an archive that
 * silently drops a mesh.
 */
export class ArchiveNamingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArchiveNamingError'
  }
}

/**
 * Entry name per line, keyed by content address.
 *
 * Keyed on the blob because that is the line's identity in `buildBillOfTiles`:
 * one line per distinct md5, whatever the number of catalog paths pointing at it.
 */
export function archiveEntryNames(lines: readonly BillLine[]): Map<BlobId, string> {
  const preferred = lines.map((line) => ({ blob: line.blob, name: MODELS_PREFIX + sanitizePath(preferredPath(line)) }))

  const counts = new Map<string, number>()
  for (const { name } of preferred) counts.set(name, (counts.get(name) ?? 0) + 1)

  const names = new Map<BlobId, string>()
  for (const { blob, name } of preferred) {
    names.set(blob, (counts.get(name) ?? 0) > 1 ? suffixWithBlob(name, blob) : name)
  }

  assertUsableEntryNames(names)
  return names
}

/**
 * The path an entry wants before sanitisation.
 *
 * `filenameCollides` is PR 9's decision and is not second-guessed here. Note the
 * shape of the long name: `entryName` on a colliding line is already the full
 * catalog path, so this reads the two source fields directly rather than
 * unpicking that string.
 */
function preferredPath(line: BillLine): string {
  if (!line.filenameCollides) return line.filename
  const id: string = line.tile.id
  return id.startsWith(CATALOG_ROOT_PREFIX) ? id.slice(CATALOG_ROOT_PREFIX.length) : id
}

/**
 * Make a catalog path safe as a ZIP entry path, and as a path on disk.
 *
 * The corpus needs less of this than it looks: ids contain `#`, `+`, `,`, `%` and
 * `°` (1,249 paths carry a non-ASCII character) and no backslashes, no `..` and
 * no control characters. All of those survive untouched — `#` and `%` are only
 * special in URLs, not in archives, and the writer flags names as UTF-8 so `°`
 * extracts correctly on Windows too. What is removed is what an *extractor*
 * would mishandle: `..` traversal, control bytes, and the characters Windows
 * refuses in a filename.
 */
export function sanitizePath(path: string): string {
  const segments = path
    .replace(/\\/g, '/')
    .split('/')
    .map(sanitizeSegment)
    .filter((segment) => segment !== '' && segment !== '.' && segment !== '..')

  if (segments.length === 0) throw new ArchiveNamingError(`path "${path}" sanitises to nothing`)
  return segments.join('/')
}

function sanitizeSegment(segment: string): string {
  return (
    segment
      // eslint-disable-next-line no-control-regex -- stripping control bytes is the point
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/[:*?"<>|]/g, '_')
      // Windows silently drops trailing dots and spaces, which would turn two
      // distinct names into one file on extraction.
      .replace(/[. ]+$/, '')
      .replace(/^ +/, '')
  )
}

/**
 * Append the content address before the extension: `wall.stl` → `wall~{md5}.stl`.
 *
 * Unique by construction — there is exactly one line per md5 — and readable
 * enough that somebody looking at the archive can match it back to
 * `ATTRIBUTION.csv`.
 */
function suffixWithBlob(name: string, blob: BlobId): string {
  const dot = name.lastIndexOf('.')
  const slash = name.lastIndexOf('/')
  if (dot <= slash + 1) return `${name}~${blob}`
  return `${name.slice(0, dot)}~${blob}${name.slice(dot)}`
}

/**
 * The three properties an archive's entry names must have.
 *
 * Uniqueness is the one that matters; the other two are cheap and each closes a
 * way for a valid-looking archive to extract wrongly.
 */
function assertUsableEntryNames(names: ReadonlyMap<BlobId, string>): void {
  const seen = new Set<string>()
  for (const name of names.values()) {
    if (seen.has(name)) {
      throw new ArchiveNamingError(`entry name "${name}" is used by two different meshes`)
    }
    seen.add(name)

    if (RESERVED_ENTRY_NAMES.includes(name)) {
      throw new ArchiveNamingError(`entry name "${name}" is reserved for the licensing files`)
    }
  }

  // A file cannot also be a directory. Impossible in the corpus — no path
  // segment of any `family` is also a filename, checked over all 8,702 rows —
  // but an extractor faced with both writes one and errors or skips on the
  // other, so it is asserted rather than trusted.
  // Collected as a set of every directory prefix rather than compared between
  // neighbours in a sorted list: `/` is not the lowest character in these paths
  // (`#`, `+`, `,`, `.` and `%` all sort below it), so the colliding pair is not
  // reliably adjacent.
  const directories = new Set<string>()
  for (const name of seen) {
    const segments = name.split('/')
    for (let i = 1; i < segments.length; i += 1) directories.add(segments.slice(0, i).join('/'))
  }
  for (const name of seen) {
    if (directories.has(name)) {
      throw new ArchiveNamingError(`entry "${name}" is also a directory in this archive`)
    }
  }
}
