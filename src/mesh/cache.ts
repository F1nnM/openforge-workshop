/**
 * The converted-mesh cache, in IndexedDB.
 *
 * ## Why IndexedDB and not the two easier things
 *
 * The record shapes and the budget arithmetic are in `record.ts`; this module is
 * the storage, and the choice was between three:
 *
 *   - **In memory.** Dies on reload, which is the one moment the cache is worth
 *     having: a reload is exactly when a 64 MB re-download would otherwise
 *     happen. `src/store/meshes.ts` is deliberately in-memory for the generated
 *     bases and says why — those meshes are only meaningful for the engine build
 *     that made them. A converted catalog mesh is meaningful for ever, because it
 *     is keyed by the md5 of bytes that cannot change.
 *   - **`localStorage`.** Synchronous, string-only, and a 5–10 MB quota. The
 *     six-design starter library is 1.4 MB converted, so it would *fit* — and
 *     then base64 would inflate it by a third, every write would block the main
 *     thread, and the fourth room would fail. `src/store/schema.ts` already
 *     draws this line for the persisted store.
 *   - **IndexedDB.** Asynchronous, stores typed arrays through the structured
 *     clone algorithm without any encoding, and quotas in the hundreds of
 *     megabytes to gigabytes. It is the only one of the three that can hold the
 *     thing.
 *
 * Typed arrays go in **as typed arrays**. That is not a detail: structured clone
 * preserves a `Float32Array`, so a read hands back an array a `BufferGeometry`
 * can take directly, with no parse, no decode and no base64. It is the reason a
 * cache hit is measured in single-digit milliseconds against the 1.9 s the
 * download it replaces takes.
 *
 * ## No library
 *
 * `idb`, `dexie` and friends are 3–12 kB gzipped to wrap five request objects,
 * and this module needs exactly five operations. The raw API's one genuine trap
 * is transaction lifetime — an `IDBTransaction` commits when the microtask queue
 * drains, so an `await` on anything that is not the request itself kills it — and
 * {@link request} is the whole mitigation: every operation awaits its own request
 * and nothing else inside a transaction.
 *
 * ## What is injectable, and what that is for
 *
 * {@link openMeshCache} takes an `IDBFactory`. In the app that is
 * `globalThis.indexedDB`; nothing else is passed anywhere in `src/`. It is a
 * parameter because a *test* can supply one, and because the absence of
 * `indexedDB` is a state this module has to answer for rather than throw on —
 * see {@link MeshCacheUnavailableError}. Node has no IndexedDB, jsdom has none,
 * and Firefox in private browsing has one that refuses to open, so "there is no
 * cache" is a real runtime condition and not only a test condition.
 */
import type { MeshCacheEntry, MeshCacheStats, MeshRecord } from './record'
import {
  MESH_CACHE_BUDGET_BYTES,
  MESH_CACHE_DB,
  MESH_CACHE_STORE,
  MESH_CACHE_VERSION,
  evictionPlan,
  meshRecordBytes,
} from './record'

/** There is no usable IndexedDB here. A state, not a fault — see the module note. */
export class MeshCacheUnavailableError extends Error {
  override readonly name = 'MeshCacheUnavailableError'
  constructor(reason: string) {
    super(`the converted-mesh cache is unavailable: ${reason}`)
  }
}

/**
 * The browser refused a write for space.
 *
 * Distinct from every other write failure because the response differs: the
 * queue evicts and retries once, and only then reports it. The user needs to
 * know, because an uncached conversion means the download happens again on every
 * reload.
 */
export class MeshCacheQuotaError extends Error {
  override readonly name = 'MeshCacheQuotaError'
  readonly blob: string
  constructor(blob: string, options?: ErrorOptions) {
    super(`the browser refused to store the converted mesh for ${blob} — the origin is out of space`, options)
    this.blob = blob
  }
}

/** The five operations the rest of the row needs. */
export interface MeshCache {
  /** One record, or `undefined`. Touches `usedAt`. */
  get(blob: string): Promise<MeshRecord | undefined>
  /** Which of these are already stored, without reading any geometry. */
  have(blobs: readonly string[]): Promise<ReadonlySet<string>>
  /** Store one record, evicting to stay inside the budget. */
  put(record: MeshRecord): Promise<void>
  /** Count and bytes held. */
  stats(): Promise<MeshCacheStats>
  /** Drop everything. For a settings-screen "clear cached 3D meshes" and for tests. */
  clear(): Promise<void>
  close(): void
}

/** Promisify one `IDBRequest`. The only `await` allowed inside a transaction. */
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => {
      resolve(req.result)
    }
    req.onerror = () => {
      reject(req.error ?? new Error('the IndexedDB request failed'))
    }
  })
}

/** `true` for the two ways a browser says "out of space". */
function isQuotaError(error: unknown): boolean {
  if (!(error instanceof DOMException)) return false
  // `QuotaExceededError` is the standard name; Firefox has historically used the
  // numeric legacy code 22 with a different name.
  return error.name === 'QuotaExceededError' || error.code === 22
}

/**
 * Open the store.
 *
 * The object store is keyed on `blob` and carries a `usedAt` index, which is
 * what makes {@link MeshCache.stats} and the eviction plan a cursor walk over
 * keys rather than a read of every geometry. An `onupgradeneeded` at a version
 * bump **deletes and recreates** the store: every record in it is derivable from
 * a URL the user can fetch again, so there is nothing to migrate and a
 * re-conversion is strictly cheaper than a migration path nobody tests.
 */
export async function openMeshCache(
  factory: IDBFactory | undefined = globalThis.indexedDB,
  budget: number = MESH_CACHE_BUDGET_BYTES,
): Promise<MeshCache> {
  if (factory === undefined) throw new MeshCacheUnavailableError('this environment has no indexedDB')

  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    let open: IDBOpenDBRequest
    try {
      open = factory.open(MESH_CACHE_DB, MESH_CACHE_VERSION)
    } catch (cause) {
      reject(new MeshCacheUnavailableError('indexedDB.open threw'))
      void cause
      return
    }
    open.onupgradeneeded = () => {
      const upgrading = open.result
      if (upgrading.objectStoreNames.contains(MESH_CACHE_STORE)) {
        upgrading.deleteObjectStore(MESH_CACHE_STORE)
      }
      const store = upgrading.createObjectStore(MESH_CACHE_STORE, { keyPath: 'blob' })
      store.createIndex('usedAt', 'usedAt')
    }
    open.onsuccess = () => {
      resolve(open.result)
    }
    open.onerror = () => {
      reject(new MeshCacheUnavailableError(open.error?.message ?? 'the database could not be opened'))
    }
    // Firefox in private browsing fires neither success nor error on some
    // builds; a blocked open is another database holding an old version.
    open.onblocked = () => {
      reject(new MeshCacheUnavailableError('another tab is holding an older version of the database'))
    }
  })

  const readonlyStore = (): IDBObjectStore =>
    db.transaction(MESH_CACHE_STORE, 'readonly').objectStore(MESH_CACHE_STORE)

  const writableStore = (): IDBObjectStore =>
    db.transaction(MESH_CACHE_STORE, 'readwrite').objectStore(MESH_CACHE_STORE)

  /** Every key's bytes and last use, without reading a single geometry. */
  const listEntries = async (): Promise<MeshCacheEntry[]> => {
    const entries: MeshCacheEntry[] = []
    const cursorRequest = readonlyStore().openCursor()
    await new Promise<void>((resolve, reject) => {
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result
        if (cursor === null) {
          resolve()
          return
        }
        const record = cursor.value as MeshRecord
        entries.push({ blob: record.blob, bytes: meshRecordBytes(record), usedAt: record.usedAt })
        cursor.continue()
      }
      cursorRequest.onerror = () => {
        reject(cursorRequest.error ?? new Error('the cache could not be listed'))
      }
    })
    return entries
  }

  const deleteMany = async (blobs: readonly string[]): Promise<void> => {
    if (blobs.length === 0) return
    const store = writableStore()
    await Promise.all(blobs.map((blob) => request(store.delete(blob))))
  }

  const evict = async (target: number): Promise<void> => {
    await deleteMany(evictionPlan(await listEntries(), target))
  }

  const write = async (record: MeshRecord): Promise<void> => {
    await request(writableStore().put(record))
  }

  return {
    get: async (blob) => {
      const found = (await request(readonlyStore().get(blob))) as MeshRecord | undefined
      if (found === undefined) return undefined

      // A record written by an older conversion is a miss and is cleaned up on
      // the way past, which is what makes a `MESH_CACHE_VERSION` bump
      // self-healing rather than a migration.
      if (found.version !== MESH_CACHE_VERSION) {
        await request(writableStore().delete(blob))
        return undefined
      }

      // The LRU touch. **Not awaited**: the caller is waiting for geometry, the
      // touch is a write to a field only eviction reads, and a failed touch
      // costs an entry its recency rather than the caller its mesh. A rejection
      // here would otherwise become an unhandled one, so it is swallowed
      // explicitly.
      void write({ ...found, usedAt: Date.now() }).catch(() => undefined)
      return found
    },

    have: async (blobs) => {
      if (blobs.length === 0) return new Set()
      const store = readonlyStore()
      // `getKey` reads the key and never the value, so checking 16 variants
      // costs no geometry — which is what lets `library.ts` skip a whole
      // aggregate that is already converted without loading 1.4 MB to find out.
      const found = await Promise.all(blobs.map(async (blob) => [blob, await request(store.getKey(blob))] as const))
      return new Set(found.filter(([, key]) => key !== undefined).map(([blob]) => blob))
    },

    put: async (record) => {
      try {
        await write(record)
      } catch (cause) {
        if (!isQuotaError(cause)) throw cause
        // Halve rather than trim to the budget: a quota refusal means the
        // browser's real limit is below ours, and evicting to exactly our
        // budget would refuse again on the next write.
        await evict(Math.floor(budget / 2))
        try {
          await write(record)
        } catch (retry) {
          throw new MeshCacheQuotaError(record.blob, { cause: retry })
        }
        return
      }
      await evict(budget)
    },

    stats: async () => {
      const entries = await listEntries()
      return {
        count: entries.length,
        bytes: entries.reduce((total, entry) => total + entry.bytes, 0),
        budget,
      }
    },

    clear: async () => {
      await request(writableStore().clear())
    },

    close: () => {
      db.close()
    },
  }
}

/* ------------------------------------------------------------- the singleton */

let opening: Promise<MeshCache | null> | null = null

/**
 * The origin's one cache, opened on first use and **never rejecting**.
 *
 * `null` for "there is none", which is a real runtime state and not only a test
 * one: Node and jsdom have no `indexedDB` at all, and Firefox in private
 * browsing has one whose `open` never succeeds. Both callers — `queue.ts` and
 * `loadLod.ts` — degrade correctly on `null`: the conversion still runs and its
 * geometry is still usable this session, reported as `uncached`.
 *
 * It never rejects because both callers reach it from paths where a rejection
 * would become an unhandled one — a React effect and a queue worker loop — and
 * "the browser has no IndexedDB" is not an exception, it is an answer.
 */
export function sharedMeshCache(): Promise<MeshCache | null> {
  opening ??= openMeshCache().catch(() => null)
  return opening
}

/** Forget the shared handle. For tests, and after a `clear()` from a settings action. */
export function resetSharedMeshCache(): void {
  void opening?.then((cache) => cache?.close())
  opening = null
}
