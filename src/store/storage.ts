/**
 * OpenForge Workshop — where persisted state lives, and how little we trust it.
 *
 * **`localStorage` is a cache, not storage.** Safari evicts it after seven days
 * without a visit (§13), and a tool you open between game sessions is *exactly*
 * the access pattern that trips that timer — so eviction is the normal case
 * here, not an edge case. Two consequences, both implemented in this module and
 * in `transfer.ts`:
 *
 *   1. Ask the browser to exempt us, best-effort, via
 *      {@link requestPersistentStorage}. It is a request, not a guarantee: some
 *      browsers grant it silently, some prompt, some refuse.
 *   2. Ship JSON export/import from day one, so the durable copy of a scene is a
 *      file the user holds — see `transfer.ts`.
 *
 * **The write path stays synchronous.** `createJSONStorage` over `localStorage`
 * is a synchronous `getItem`/`setItem` pair, and it is kept that way
 * deliberately. An async storage adapter (IndexedDB, or a promise wrapper added
 * "for consistency") turns every placement into a queued write, and dragging a
 * tile across a grid issues writes faster than they settle — the classic
 * lost-update race, where the scene on screen and the scene in storage disagree
 * and only a reload reveals it.
 */
import { createJSONStorage } from 'zustand/middleware'

import type { WorkshopState } from './schema'

/**
 * The `localStorage` key.
 *
 * No version suffix: `persist` writes `{ state, version }` and the version lives
 * *inside* the value. Encoding it in the key instead would orphan every old
 * scene on the first bump — the migration would have nothing to read, because it
 * would be looking under a key nobody had written.
 */
export const STORAGE_KEY = 'openforge-workshop'

/** `globalThis.localStorage`, or `undefined` where the platform has none. */
function localStorageOrUndefined(): Storage | undefined {
  const storage: Storage | undefined = globalThis.localStorage
  return storage
}

/**
 * The storage adapter handed to `persist`.
 *
 * `createJSONStorage` catches a throw from this callback and returns
 * `undefined`, which puts `persist` into an in-memory mode that warns on every
 * write instead of crashing. That degraded mode is the correct behaviour in the
 * two places it happens: a non-DOM environment, and a browser where the user has
 * blocked site data — in which case a working app that forgets on reload beats a
 * blank page.
 */
export const workshopStorage = createJSONStorage<WorkshopState>(() => {
  const storage = localStorageOrUndefined()
  if (storage === undefined) throw new Error('localStorage is unavailable')
  return storage
})

/**
 * Delete the persisted scene.
 *
 * Talks to `localStorage` directly rather than through `store.persist
 * .clearStorage()`, and the reason is a temporal-dead-zone trap rather than a
 * preference: with synchronous storage, `persist` runs `onRehydrateStorage`'s
 * callback *during* `create(...)`, before the `const` holding the store is
 * initialised. A `clearStorage()` reached through the store handle would throw a
 * `ReferenceError` from inside the very error path meant to recover from a
 * corrupt blob — leaving the poison in place and the app dead on every reload.
 * This function has no such dependency and can be called at any point.
 */
export function clearPersistedWorkshopState(): void {
  try {
    localStorageOrUndefined()?.removeItem(STORAGE_KEY)
  } catch {
    // Storage is unreadable, so there is nothing to clear and nothing to report.
  }
}

/**
 * Ask the browser to exempt this origin from storage eviction.
 *
 * Best-effort by definition — `navigator.storage.persist()` may resolve `false`,
 * prompt the user, or not exist at all — so the return value is informational
 * and never gates a write. Call it once from a user gesture, where browsers that
 * prompt are most likely to grant it; calling it on load usually gets a silent
 * refusal.
 *
 * Async deliberately, and safely so: this is *not* on the write path. It touches
 * a browser permission, not the store.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    const manager: StorageManager | undefined = globalThis.navigator?.storage
    if (manager === undefined) return false
    if (typeof manager.persisted === 'function' && (await manager.persisted())) return true
    if (typeof manager.persist !== 'function') return false
    return await manager.persist()
  } catch {
    // An origin with storage blocked throws here; that is a "no", not a crash.
    return false
  }
}
