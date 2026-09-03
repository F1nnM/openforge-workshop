/**
 * What the mesh cache holds, how big it is, and what gets thrown away — the
 * arithmetic half, with no IndexedDB in it.
 *
 * ## Why a cache at all, in one table
 *
 * Measured on this corpus (`public/catalog/catalog.json`, 8,702 records over
 * 8,353 distinct meshes), for the six-design starter set the palette offers:
 *
 * | | |
 * | --- | ---: |
 * | source STLs, the six lock-resolved variants | **64.1 MB** |
 * | the same six, converted | **351 kB** |
 * | source STLs, every variant of all six designs | **502.8 MB** |
 * | the same 36 meshes, converted | **2.16 MB** |
 *
 * So caching the *source* is not an option — 64 MB for six tiles, and the whole
 * point of the conversion is that what comes out is **1/178th** of what went in,
 * measured on those six meshes rather than projected. Caching the *converted*
 * mesh is what makes the second visit free, and it is cheap enough that the
 * eviction story below is mostly theoretical.
 *
 * ## Keyed by md5, which is why it can never be stale
 *
 * The key is `CatalogRecord.blob`, the content address of the source STL. A mesh
 * cannot change under its own key: if Devon re-exports a tile the importer gives
 * it a new md5 and a new cache entry, and the old one ages out. There is no
 * invalidation problem to solve here, which is the whole reason the row is
 * content-addressed and not keyed by tile id or design.
 *
 * What *can* go stale is the conversion, not the mesh — a change to the band, to
 * the simplifier's version, or to the weld would make a stored record disagree
 * with what this code would produce today. {@link MESH_CACHE_VERSION} covers
 * that: it is part of the stored record and a mismatch is a miss.
 *
 * ## The eviction story
 *
 * LRU over `usedAt`, against {@link MESH_CACHE_BUDGET_BYTES}, run after a write
 * and again when the browser refuses one.
 *
 * The budget is **64 MB**, and stating what that buys is more useful than
 * defending the number: at the measured **58.6 kB** per converted mesh it is
 * about **1,140 meshes**, which at the corpus's 1.54 lock-reachable meshes per
 * design is roughly **740 designs**. A library that large is not a library, so
 * the expected behaviour of this budget is that it never evicts anything; it
 * exists for the two cases where "never" is wrong: somebody who browses the
 * whole catalog with the 3D view open, and a shared link that names hundreds of
 * distinct designs.
 *
 * **`usedAt` is touched on read, not only on write**, which is what makes it LRU
 * rather than FIFO: the tiles a user keeps placing stay, and the one they added
 * once in March goes. The touch is deliberately *not* awaited by the read path —
 * see `cache.ts`.
 *
 * A quota refusal is a different event from a full budget and is handled
 * separately: the browser's own limit is opaque, varies by origin and by
 * available disk, and Safari's is small enough to be reached. So a
 * `QuotaExceededError` triggers an eviction down to half the budget and one
 * retry, and a second refusal reaches the UI as `queue.ts`'s **`uncached`**
 * state — one the user sees, because a silently unstored conversion means every
 * reload re-downloads the source, which for the starter set is 64 MB.
 */

/**
 * The stored record's schema version.
 *
 * Bump this when a change to the conversion would make an already-stored record
 * disagree with a fresh one: the triangle band, the weld rule, the index width,
 * the simplifier's error budget. A record at another version is a **miss**, not
 * an error — `cache.ts` deletes it on the way past, so a bump is self-cleaning
 * and does not need a migration.
 *
 * 1 — the first shape: welded, position-only, simplified into the 5,000–20,000
 * band at `SIMPLIFY_ERROR` 0.05, indices narrowed to 16 bits when they fit.
 */
export const MESH_CACHE_VERSION = 1

/** The IndexedDB database and object store names. */
export const MESH_CACHE_DB = 'openforge-workshop-meshes'
export const MESH_CACHE_STORE = 'converted'

/**
 * Bytes of converted geometry to keep. 64 MB — see the module note.
 *
 * Not derived from `lod.ts`'s `LOD_ROOM_BUDGET_BYTES` (36.24 MB), and the
 * difference is the point: that one bounds what a *room* may hold in memory at
 * once, this one bounds what a *browser* keeps on disk between sessions. A
 * library legitimately holds more than one room's worth.
 */
export const MESH_CACHE_BUDGET_BYTES = 64 * 1024 * 1024

/** One converted mesh, as stored. Plain data — structured-cloneable, no methods. */
export interface MeshRecord {
  /** The source STL's md5. The primary key. */
  readonly blob: string
  readonly version: number
  /** Positions in millimetres, welded, indexed, no normals. */
  readonly positions: Float32Array
  readonly indices: Uint16Array | Uint32Array
  readonly triangles: number
  readonly vertices: number
  readonly sourceTriangles: number
  readonly sourceBytes: number
  /** Post-weld over pre-weld vertex count. ~0.167 on real geometry. */
  readonly weldRatio: number
  /** `true` when the source was already inside the band and was not simplified. */
  readonly passThrough: boolean
  /** Surface area lost to simplification, as a fraction. */
  readonly areaError: number
  /** Largest axis-extent shrink, in millimetres. */
  readonly extentError: number
  /** Milliseconds spent converting, in the worker. */
  readonly convertMs: number
  /** Epoch millis the record was written. */
  readonly storedAt: number
  /** Epoch millis it was last read. The LRU key. */
  readonly usedAt: number
}

/** Bytes a record's typed arrays occupy. What the budget spends. */
export function meshRecordBytes(record: Pick<MeshRecord, 'positions' | 'indices'>): number {
  return record.positions.byteLength + record.indices.byteLength
}

/** The index row the eviction plan works from — no geometry, so it is cheap to list. */
export interface MeshCacheEntry {
  readonly blob: string
  readonly bytes: number
  readonly usedAt: number
}

/** What the cache currently holds. */
export interface MeshCacheStats {
  readonly count: number
  readonly bytes: number
  readonly budget: number
}

/**
 * Which entries to drop to get under `budget`, oldest use first.
 *
 * Returns `[]` when nothing needs to go, which is the expected answer — see the
 * module note on what 64 MB buys. Ties on `usedAt` break on `blob` so the plan
 * is a pure function of its input and two calls cannot disagree.
 */
export function evictionPlan(
  entries: readonly MeshCacheEntry[],
  budget: number = MESH_CACHE_BUDGET_BYTES,
): readonly string[] {
  let held = entries.reduce((total, entry) => total + entry.bytes, 0)
  if (held <= budget) return []

  const oldest = [...entries].sort((a, b) =>
    a.usedAt !== b.usedAt ? a.usedAt - b.usedAt : a.blob < b.blob ? -1 : 1,
  )

  const drop: string[] = []
  for (const entry of oldest) {
    if (held <= budget) break
    drop.push(entry.blob)
    held -= entry.bytes
  }
  return drop
}
