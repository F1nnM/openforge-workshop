/**
 * The precomputed lookups assembly resolution needs, derived once per catalog.
 *
 * A pure function of `CatalogFile`, and the reason it exists rather than being
 * folded into the resolver is arithmetic: resolving a placement without an index
 * means scanning 8,702 records for a matching base, and a 50-placement room
 * would scan 435,100 records to draw one bill. Built once, it is four maps.
 *
 * Nothing here interprets. The four maps are the four *keys* the corpus supports
 * — catalog identity, base size code, base footprint, content address — plus the
 * filename multimap the download path needs. Which of them a match should use is
 * the resolver's decision, in `resolve.ts`.
 */
import type { BlobId, CatalogFile, CatalogRecord, TileId } from '@/catalog'

import { footprintKey } from './footprint'

/** What the index measured while building itself. Every figure is a corpus fact a test asserts. */
export interface AssemblyIndexStats {
  /** Live records in this catalog build. 8,702 today. */
  records: number
  /** `layer === 'base'` — 1,963 (22.6%). */
  bases: number
  /** `layer === 'topper'`, i.e. `connection|openforge` — 4,363 (50.1%). */
  toppers: number
  /** Bases carrying a `size|openlock` code — 774 of 1,963. */
  basesWithSizeCode: number
  /** Distinct footprint keys the bases cover — the fallback join's reach. */
  baseFootprints: number
  /** md5s carried by more than one record — 171, over 520 rows. */
  sharedBlobs: number
  /** Records sharing an md5 with another record — 520. */
  sharedBlobRecords: number
  /** Filenames mapping to two or more distinct meshes — 89, of which 7 map to three. */
  collidingFilenames: number
}

/**
 * The resolver's input, beside the placements.
 *
 * Every collection is `readonly` because the resolver must not be able to mutate
 * its own index: one accidental `push` into a candidate array would corrupt
 * every subsequent resolution in the session, and the symptom would be a bill
 * that changes depending on what the user placed first.
 */
export interface AssemblyIndex {
  /** Catalog identity → record. The lookup every placement starts from. */
  readonly byId: ReadonlyMap<TileId, CatalogRecord>

  /**
   * `size|openlock` code → the bases carrying it, in match-ranking order.
   *
   * 26 codes on the base side against 27 on the topper side, which is the whole
   * of the gap this key can produce: a topper code absent here has no
   * size-matched base anywhere in the corpus (129 toppers, 6.5% of the 1,999
   * that carry a code).
   */
  readonly basesBySizeCode: ReadonlyMap<string, readonly CatalogRecord[]>

  /** {@link footprintKey} → the bases congruent to it. The fallback for coded-less toppers. */
  readonly basesByFootprint: ReadonlyMap<string, readonly CatalogRecord[]>

  /**
   * md5 → every record carrying it.
   *
   * The bill deduplicates on this, and the reason it is a *multimap* rather than
   * a set is that both identities are needed at once: the line is one file, and
   * it still has to name the tiles that asked for it. 171 md5s are shared by 520
   * rows, and the largest group holds 9.
   */
  readonly byBlob: ReadonlyMap<BlobId, readonly CatalogRecord[]>

  /**
   * Filename → the distinct md5s published under it.
   *
   * 89 filenames map to two or three genuinely different meshes
   * (`tudor#door+narrow.stl` is three), so a zip entry named by filename
   * silently overwrites. This is what lets the download path see the collision
   * before it names anything.
   */
  readonly blobsByFilename: ReadonlyMap<string, readonly BlobId[]>

  readonly stats: AssemblyIndexStats
}

/**
 * Derive the index from a parsed catalog.
 *
 * Pure and deterministic: candidate arrays are sorted here, once, so a match is
 * a scan of a pre-ordered list and two runs cannot disagree about which base
 * wins a tie. Sorting is `bytes` ascending then `id` — the smaller base is the
 * cheaper print, and `id` is unique by {@link CatalogFile}'s own parse check, so
 * the order is total.
 */
export function buildAssemblyIndex(catalog: CatalogFile): AssemblyIndex {
  const byId = new Map<TileId, CatalogRecord>()
  const basesBySizeCode = new Map<string, CatalogRecord[]>()
  const basesByFootprint = new Map<string, CatalogRecord[]>()
  const byBlob = new Map<BlobId, CatalogRecord[]>()
  const blobsByFilename = new Map<string, BlobId[]>()

  let bases = 0
  let toppers = 0
  let basesWithSizeCode = 0

  for (const record of catalog.records) {
    byId.set(record.id, record)
    push(byBlob, record.blob, record)

    const blobs = blobsByFilename.get(record.file)
    if (blobs === undefined) blobsByFilename.set(record.file, [record.blob])
    else if (!blobs.includes(record.blob)) blobs.push(record.blob)

    if (record.layer === 'topper') toppers += 1
    if (record.layer !== 'base') continue

    bases += 1
    if (record.sizeCode !== undefined) {
      basesWithSizeCode += 1
      push(basesBySizeCode, record.sizeCode, record)
    }
    const foot = footprintKey(record.foot)
    if (foot !== undefined) push(basesByFootprint, foot, record)
  }

  for (const candidates of basesBySizeCode.values()) candidates.sort(byCost)
  for (const candidates of basesByFootprint.values()) candidates.sort(byCost)
  for (const blobs of blobsByFilename.values()) blobs.sort()

  const shared = [...byBlob.values()].filter((group) => group.length > 1)

  return {
    byId,
    basesBySizeCode,
    basesByFootprint,
    byBlob,
    blobsByFilename,
    stats: {
      records: catalog.records.length,
      bases,
      toppers,
      basesWithSizeCode,
      baseFootprints: basesByFootprint.size,
      sharedBlobs: shared.length,
      sharedBlobRecords: shared.reduce((total, group) => total + group.length, 0),
      collidingFilenames: [...blobsByFilename.values()].filter((blobs) => blobs.length > 1).length,
    },
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key)
  if (existing === undefined) map.set(key, [value])
  else existing.push(value)
}

/** Smaller print first, then catalog path. Total, because `id` is unique. */
function byCost(a: CatalogRecord, b: CatalogRecord): number {
  if (a.bytes !== b.bytes) return a.bytes - b.bytes
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}
