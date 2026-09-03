/// <reference types="node" />
/**
 * The IndexedDB adapter, driven by an in-test IndexedDB.
 *
 * ## What this proves and what it cannot — stated up front, because it matters
 *
 * There is **no IndexedDB in this test environment**. Node 22 has none, jsdom
 * has none, and this repo has no `fake-indexeddb` (adding one would write into a
 * `node_modules` that is symlinked and shared with three other rows' worktrees).
 * So {@link MemoryIdb} below is a test double for the *browser API*, in exactly
 * the sense `client.test.ts`'s `ScriptedWorker` is one for `Worker`.
 *
 * That means this file proves the adapter's **control flow**: that a version
 * mismatch is a miss and deletes the record, that `have()` reads keys and never
 * geometry, that a quota refusal evicts and retries once and then reports, that
 * the LRU touch happens on read, and that a missing factory is an answer rather
 * than a crash. Those are where the bugs actually are.
 *
 * It does **not** prove IndexedDB's own semantics: transaction lifetime — an
 * `IDBTransaction` commits when the microtask queue drains, which is the raw
 * API's one real trap — structured-clone fidelity for a `Float32Array`, real
 * quota behaviour, or `onblocked`. Those need a browser, and no browser was
 * available on this machine (no `google-chrome`, no `chromium`, no
 * `~/.cache/puppeteer`). The mitigation for the transaction trap is structural
 * rather than tested: `request()` is the only `await` inside a transaction in
 * `cache.ts`, which a reader can check by grep, and the last test here asserts
 * that property of the source.
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { MeshCacheQuotaError, MeshCacheUnavailableError, openMeshCache } from './cache'
import type { MeshRecord } from './record'
import { MESH_CACHE_VERSION } from './record'

/* ------------------------------------------------------ the IndexedDB double */

interface Row {
  key: string
  value: MeshRecord
}

/** How a write should behave. `'quota'` throws the DOMException a full origin throws. */
type WriteMode = 'ok' | 'quota' | 'quota-always'

interface MemoryIdb {
  rows: Map<string, Row>
  writeMode: WriteMode
  /** Every `get`/`getKey` call, so a test can prove geometry was not read. */
  reads: string[]
  version: number
  indexedDB: IDBFactory
}

/** A factory rather than a class, so the closures capture a plain object. */
function memoryIdb(): MemoryIdb {
    const self: MemoryIdb = {
      rows: new Map<string, Row>(),
      writeMode: 'ok',
      reads: [],
      version: 0,
      indexedDB: undefined as unknown as IDBFactory,
    }
    const succeed = <T>(result: T): IDBRequest<T> => {
      const req = { result, error: null } as unknown as {
        result: T
        error: DOMException | null
        onsuccess: (() => void) | null
        onerror: (() => void) | null
      }
      queueMicrotask(() => {
        req.onsuccess?.()
      })
      return req as unknown as IDBRequest<T>
    }
    const fail = (error: DOMException): IDBRequest<never> => {
      const req = { result: undefined, error } as unknown as {
        error: DOMException
        onsuccess: (() => void) | null
        onerror: (() => void) | null
      }
      queueMicrotask(() => {
        req.onerror?.()
      })
      return req as unknown as IDBRequest<never>
    }

    const store: IDBObjectStore = {
      get: (key: string) => {
        self.reads.push(`get:${key}`)
        return succeed(self.rows.get(key)?.value)
      },
      getKey: (key: string) => {
        self.reads.push(`getKey:${key}`)
        return succeed(self.rows.has(key) ? key : undefined)
      },
      put: (value: MeshRecord) => {
        if (self.writeMode !== 'ok') {
          if (self.writeMode === 'quota') self.writeMode = 'ok'
          return fail(new DOMException('the quota has been exceeded', 'QuotaExceededError'))
        }
        self.rows.set(value.blob, { key: value.blob, value })
        return succeed(undefined)
      },
      delete: (key: string) => {
        self.rows.delete(key)
        return succeed(undefined)
      },
      clear: () => {
        self.rows.clear()
        return succeed(undefined)
      },
      openCursor: () => {
        // A cursor that walks a snapshot of the rows, one `continue()` at a time.
        const snapshot = [...self.rows.values()]
        let at = -1
        const req = {} as unknown as {
          result: { value: MeshRecord; continue: () => void } | null
          error: DOMException | null
          onsuccess: (() => void) | null
          onerror: (() => void) | null
        }
        const step = () => {
          at += 1
          const row = snapshot[at]
          req.result =
            row === undefined ? null : { value: row.value, continue: () => queueMicrotask(step) }
          req.onsuccess?.()
        }
        queueMicrotask(step)
        return req as unknown as IDBRequest<IDBCursorWithValue | null>
      },
      createIndex: () => undefined,
    } as unknown as IDBObjectStore

    const db: IDBDatabase = {
      objectStoreNames: { contains: () => self.version > 0 } as unknown as DOMStringList,
      createObjectStore: () => store,
      deleteObjectStore: () => undefined,
      transaction: () => ({ objectStore: () => store }) as unknown as IDBTransaction,
      close: () => undefined,
    } as unknown as IDBDatabase

    const factory = {
      open: (_name: string, version?: number) => {
        const req = { result: db, error: null } as unknown as {
          result: IDBDatabase
          error: DOMException | null
          onupgradeneeded: (() => void) | null
          onsuccess: (() => void) | null
          onerror: (() => void) | null
          onblocked: (() => void) | null
        }
        queueMicrotask(() => {
          if ((version ?? 1) > self.version) {
            self.version = version ?? 1
            req.onupgradeneeded?.()
          }
          req.onsuccess?.()
        })
        return req as unknown as IDBOpenDBRequest
      },
    } as unknown as IDBFactory
  // Assigned onto the same object the closures above captured. Spreading into a
  // copy here would give the test a `rows` and a `writeMode` the double never
  // reads — which is exactly the bug this line replaced.
  self.indexedDB = factory
  return self
}

/* ------------------------------------------------------------------ fixtures */

function record(blob: string, triangles = 5_000, usedAt = 1_000): MeshRecord {
  const vertices = Math.ceil(triangles / 2)
  return {
    blob,
    version: MESH_CACHE_VERSION,
    positions: new Float32Array(vertices * 3),
    indices: new Uint16Array(triangles * 3),
    triangles,
    vertices,
    sourceTriangles: triangles * 40,
    sourceBytes: triangles * 40 * 50 + 84,
    weldRatio: 0.1667,
    passThrough: false,
    areaError: 0.01,
    extentError: 0.01,
    convertMs: 130,
    storedAt: usedAt,
    usedAt,
  }
}

/** Bytes one 5,000-triangle record occupies: 2,500 × 12 + 15,000 × 2. */
const RECORD_BYTES = 2_500 * 3 * 4 + 5_000 * 3 * 2

/* --------------------------------------------------------------------- tests */

describe('openMeshCache', () => {
  it('reports an environment with no indexedDB rather than throwing something opaque', async () => {
    await expect(openMeshCache(undefined)).rejects.toThrow(MeshCacheUnavailableError)
    await expect(openMeshCache(undefined)).rejects.toThrow(/has no indexedDB/)
  })

  it('stores and returns a record', async () => {
    const idb = memoryIdb()
    const cache = await openMeshCache(idb.indexedDB)

    await cache.put(record('aaa'))
    const found = await cache.get('aaa')

    expect(found?.blob).toBe('aaa')
    expect(found?.triangles).toBe(5_000)
    expect(found?.positions).toBeInstanceOf(Float32Array)
    expect(found?.indices).toBeInstanceOf(Uint16Array)
  })

  it('misses on an unknown blob', async () => {
    const cache = await openMeshCache(memoryIdb().indexedDB)
    expect(await cache.get('nope')).toBeUndefined()
  })

  it('treats a record from an older conversion as a miss, and cleans it up', async () => {
    const idb = memoryIdb()
    const cache = await openMeshCache(idb.indexedDB)
    // Written by a build whose band, weld or index width differed. Returning it
    // would put geometry in a scene that this code would not have produced.
    idb.rows.set('old', { key: 'old', value: { ...record('old'), version: MESH_CACHE_VERSION - 1 } })

    expect(await cache.get('old')).toBeUndefined()
    // Self-healing: a `MESH_CACHE_VERSION` bump needs no migration because the
    // stale record is deleted on the way past.
    expect(idb.rows.has('old')).toBe(false)
  })

  it('answers have() from keys alone, reading no geometry', async () => {
    const idb = memoryIdb()
    const cache = await openMeshCache(idb.indexedDB)
    await cache.put(record('aaa'))
    await cache.put(record('bbb'))
    idb.reads = []

    const held = await cache.have(['aaa', 'bbb', 'ccc'])

    expect([...held].sort()).toEqual(['aaa', 'bbb'])
    // This is the assertion that makes checking a 16-variant aggregate free:
    // every read was a `getKey`, never a `get`.
    expect(idb.reads.every((one) => one.startsWith('getKey:'))).toBe(true)
    expect(idb.reads).toHaveLength(3)
  })

  it('answers an empty have() without touching the database', async () => {
    const idb = memoryIdb()
    const cache = await openMeshCache(idb.indexedDB)
    idb.reads = []
    expect((await cache.have([])).size).toBe(0)
    expect(idb.reads).toEqual([])
  })

  it('touches usedAt on read, which is what makes eviction LRU and not FIFO', async () => {
    const idb = memoryIdb()
    const cache = await openMeshCache(idb.indexedDB)
    await cache.put(record('aaa', 5_000, 1_000))

    await cache.get('aaa')
    // The touch is deliberately not awaited by the read path, so it settles a
    // microtask later.
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })

    expect(idb.rows.get('aaa')?.value.usedAt).toBeGreaterThan(1_000)
    expect(idb.rows.get('aaa')?.value.storedAt).toBe(1_000)
  })

  it('reports what it holds', async () => {
    const cache = await openMeshCache(memoryIdb().indexedDB)
    await cache.put(record('aaa'))
    await cache.put(record('bbb'))

    const stats = await cache.stats()
    expect(stats.count).toBe(2)
    expect(stats.bytes).toBe(RECORD_BYTES * 2)
  })

  it('evicts the least recently used once the budget is passed', async () => {
    const idb = memoryIdb()
    // A budget of two and a half records.
    const cache = await openMeshCache(idb.indexedDB, RECORD_BYTES * 2 + 1)

    await cache.put(record('oldest', 5_000, 100))
    await cache.put(record('middle', 5_000, 200))
    await cache.put(record('newest', 5_000, 300))

    expect([...idb.rows.keys()].sort()).toEqual(['middle', 'newest'])
  })

  it('evicts to half the budget and retries once when the browser refuses a write', async () => {
    const idb = memoryIdb()
    // A budget of two records, so halving it leaves room for one.
    const cache = await openMeshCache(idb.indexedDB, RECORD_BYTES * 2)
    await cache.put(record('a', 5_000, 100))
    await cache.put(record('b', 5_000, 200))
    expect(idb.rows.size).toBe(2)

    // The next write is refused, once.
    idb.writeMode = 'quota'
    await cache.put(record('c', 5_000, 300))

    // Halved rather than trimmed to the budget: a refusal means the browser's
    // real limit is below ours, so trimming to ours would refuse again.
    expect(idb.rows.has('c')).toBe(true)
    expect(idb.rows.has('a')).toBe(false)
  })

  it('reports a persistent refusal instead of pretending the write happened', async () => {
    const idb = memoryIdb()
    const cache = await openMeshCache(idb.indexedDB)
    idb.writeMode = 'quota-always'

    // This is the state that would otherwise look like success: the geometry is
    // fine, the view draws, and every reload re-downloads tens of megabytes.
    await expect(cache.put(record('aaa'))).rejects.toThrow(MeshCacheQuotaError)
    expect(idb.rows.has('aaa')).toBe(false)
  })

  it('clears', async () => {
    const idb = memoryIdb()
    const cache = await openMeshCache(idb.indexedDB)
    await cache.put(record('aaa'))
    await cache.clear()
    expect(idb.rows.size).toBe(0)
    expect((await cache.stats()).count).toBe(0)
  })
})

describe('the transaction trap, guarded structurally because it cannot be tested here', () => {
  it('awaits nothing but request() inside cache.ts', () => {
    // An `IDBTransaction` commits when the microtask queue drains, so an
    // `await` on anything that is not the request itself kills the transaction
    // it is inside — and the symptom is a `TransactionInactiveError` on the
    // *next* operation, in a browser, under load. No test in this repo can
    // reproduce it, so the property is asserted over the source instead: every
    // `await` in this module either awaits `request(...)`, awaits another
    // function of this module that opens its own transaction, or is outside one.
    const source = readFileSync('src/mesh/cache.ts', 'utf8')
    const awaits = [...source.matchAll(/await ([A-Za-z_$][\w$.]*)\(/g)].map((match) => match[1])
    const allowed = new Set([
      'request',
      'Promise.all',
      'new',
      'write',
      'listEntries',
      'evict',
      'deleteMany',
      'openMeshCache',
    ])
    expect(awaits.filter((name) => name !== undefined && !allowed.has(name))).toEqual([])
    // And the guard is capable of failing: the allowlist is not empty, so it is
    // matching real call sites rather than an empty set.
    expect(awaits).toContain('request')
    expect(awaits.length).toBeGreaterThan(5)
  })
})
