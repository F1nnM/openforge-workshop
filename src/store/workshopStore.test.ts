// @vitest-environment jsdom
//
// jsdom, because everything below is about `localStorage`. Declared per file
// rather than globally: the catalog schema, the facet engine and the importer
// are headless and pay nothing for a DOM they never touch. (`environmentMatchGlobs`
// was removed in Vitest 4, so this docblock is the mechanism.)
/**
 * The store, its actions and its persistence.
 *
 * The two tests worth reading first are `rapid sequential writes` — the reason
 * the write path is synchronous and every action uses a functional update — and
 * the `rehydrating` block, which drives the real `persist` middleware rather
 * than calling the migration functions directly, so it proves the wiring and not
 * just the logic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TileId } from '@/catalog'

import { STORE_VERSION } from './migrations'
import type { Placement, PlacementId } from './schema'
import { DEFAULT_LOCK_SYSTEM, WorkshopState } from './schema'
import { STORAGE_KEY, clearPersistedWorkshopState, requestPersistentStorage } from './storage'
import { WORKSHOP_EXPORT_KIND, WorkshopExport, exportWorkshop, importWorkshop } from './transfer'
import {
  addToLibrary,
  clearLibrary,
  clearPlacements,
  movePlacement,
  placeTile,
  removeFromLibrary,
  removePlacement,
  resetWorkshop,
  rotatePlacement,
  selectIsInLibrary,
  selectLibraryCount,
  selectPlacementCount,
  setLockSystem,
  toggleLibrary,
  useWorkshopStore,
} from './workshopStore'

const TILE_A = TileId.parse('tiles/dungeon_stone/floor/2x2/openlock/dungeon_stone%2x2.openlock.stl')
const TILE_B = TileId.parse('tiles/cave/thick_wall/wall/corner/openlock/cave%corner.IL.openlock.stl')

const state = () => useWorkshopStore.getState()

function aPlacement(over: Partial<Placement> = {}): Placement {
  return { tileId: TILE_A, x: 0, z: 0, rotation: 0, ...over }
}

/** The raw `{ state, version }` envelope `persist` writes, or `null`. */
function storedPayload(): { state?: unknown; version?: unknown } | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw === null) return null
  return JSON.parse(raw) as { state?: unknown; version?: unknown }
}

/** Put a payload under the store's key exactly as `persist` would have. */
function writeStored(value: unknown): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
}

function silenceWarnings(): void {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
}

beforeEach(() => {
  localStorage.clear()
  resetWorkshop()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/* ------------------------------------------------------------------- library */

describe('library', () => {
  it('adds and removes tiles', () => {
    addToLibrary(TILE_A)
    addToLibrary(TILE_B)
    expect(state().library).toEqual({ [TILE_A]: true, [TILE_B]: true })

    removeFromLibrary(TILE_A)
    expect(state().library).toEqual({ [TILE_B]: true })
  })

  it('is a set: adding twice changes nothing and wakes no subscriber', () => {
    addToLibrary(TILE_A)
    const before = state().library
    addToLibrary(TILE_A)
    expect(state().library).toBe(before)
  })

  it('ignores a removal of a tile that was never there', () => {
    addToLibrary(TILE_A)
    const before = state().library
    removeFromLibrary(TILE_B)
    expect(state().library).toBe(before)
  })

  it('toggles', () => {
    toggleLibrary(TILE_A)
    expect(selectIsInLibrary(TILE_A)(state())).toBe(true)
    toggleLibrary(TILE_A)
    expect(selectIsInLibrary(TILE_A)(state())).toBe(false)
  })

  it('clears without touching placements or the lock preference', () => {
    addToLibrary(TILE_A)
    placeTile(aPlacement())
    setLockSystem('magnetic')

    clearLibrary()
    expect(selectLibraryCount(state())).toBe(0)
    expect(selectPlacementCount(state())).toBe(1)
    expect(state().lock).toBe('magnetic')
  })

  it('preserves insertion order, which is what the library screen lists by', () => {
    addToLibrary(TILE_B)
    addToLibrary(TILE_A)
    expect(Object.keys(state().library)).toEqual([TILE_B, TILE_A])
  })
})

/* ---------------------------------------------------------------- placements */

describe('placements', () => {
  it('places a tile under a fresh key each time', () => {
    const first = placeTile(aPlacement({ x: 1, z: 1 }))
    const second = placeTile(aPlacement({ x: 2, z: 2 }))
    expect(first).not.toBe(second)
    expect(state().placements[first]).toEqual({ tileId: TILE_A, x: 1, z: 1, rotation: 0 })
    expect(selectPlacementCount(state())).toBe(2)
  })

  it('folds rotation into [0, 360) on the way in', () => {
    const id = placeTile(aPlacement({ rotation: 450 }))
    expect(state().placements[id]?.rotation).toBe(90)
    rotatePlacement(id, -90)
    expect(state().placements[id]?.rotation).toBe(270)
    rotatePlacement(id, 22.5)
    expect(state().placements[id]?.rotation).toBe(22.5)
  })

  it('folds a negative zero coordinate to positive zero', () => {
    // `Math.round(-0.2) * 0.5` is `-0`, so a snap function produces this. It
    // survives in memory but not through `JSON.stringify`, which would make an
    // exported scene differ from the one it was exported from.
    const id = placeTile(aPlacement({ x: -0, z: -0 }))
    expect(Object.is(state().placements[id]?.x, 0)).toBe(true)
    expect(Object.is(state().placements[id]?.z, 0)).toBe(true)
  })

  it('moves and removes', () => {
    const id = placeTile(aPlacement())
    movePlacement(id, -2.5, 4)
    expect(state().placements[id]).toEqual({ tileId: TILE_A, x: -2.5, z: 4, rotation: 0 })

    removePlacement(id)
    expect(state().placements).toEqual({})
  })

  it('ignores edits to a key that is not on the grid', () => {
    const ghost = 'not-a-placement-in-this-scene' as PlacementId
    placeTile(aPlacement())
    const before = state().placements
    movePlacement(ghost, 1, 1)
    rotatePlacement(ghost, 90)
    removePlacement(ghost)
    expect(state().placements).toBe(before)
  })

  it('rejects an unusable placement at the call that made it', () => {
    // Loud here, where the stack names the culprit — rather than months later
    // during a hydration, where it is indistinguishable from storage corruption.
    expect(() => placeTile(aPlacement({ x: Number.NaN }))).toThrow()
    expect(() => placeTile({ ...aPlacement(), tileId: '' as TileId })).toThrow()
    expect(state().placements).toEqual({})
  })

  it('clears the scene without touching the library', () => {
    addToLibrary(TILE_A)
    placeTile(aPlacement())
    clearPlacements()
    expect(state().placements).toEqual({})
    expect(selectLibraryCount(state())).toBe(1)
  })
})

/* --------------------------------------------------------------------- locks */

describe('lock preference', () => {
  it('defaults to openlock, which reaches 99.9% of designs', () => {
    expect(state().lock).toBe('openlock')
    expect(DEFAULT_LOCK_SYSTEM).toBe('openlock')
  })

  it('is a single global choice', () => {
    setLockSystem('dragonlock')
    expect(state().lock).toBe('dragonlock')
  })
})

/* ----------------------------------------------------------------- selectors */

describe('selector granularity', () => {
  it('does not disturb library subscribers when a tile is placed', () => {
    addToLibrary(TILE_A)
    const libraryBefore = state().library
    const membershipBefore = selectIsInLibrary(TILE_A)(state())

    placeTile(aPlacement())
    placeTile(aPlacement({ x: 1 }))

    // Same object identity and the same boolean, so a catalog card subscribed
    // through `useIsInLibrary` re-renders for neither placement.
    expect(state().library).toBe(libraryBefore)
    expect(selectIsInLibrary(TILE_A)(state())).toBe(membershipBefore)
  })

  it('does not disturb scene subscribers when a tile is filed', () => {
    const id = placeTile(aPlacement())
    const placementsBefore = state().placements
    addToLibrary(TILE_B)
    expect(state().placements).toBe(placementsBefore)
    expect(state().placements[id]).toBe(placementsBefore[id])
  })

  it('reports counts as numbers, so an unchanged count is not a re-render', () => {
    addToLibrary(TILE_A)
    expect(selectLibraryCount(state())).toBe(1)
    addToLibrary(TILE_A)
    expect(selectLibraryCount(state())).toBe(1)
  })
})

/* --------------------------------------------------------------- persistence */

describe('persistence', () => {
  it('writes synchronously, with the version stamped from the first commit', () => {
    addToLibrary(TILE_A)
    // No await: an async storage adapter would make this line flaky and every
    // rapid placement a lost-update race.
    const payload = storedPayload()
    expect(payload?.version).toBe(STORE_VERSION)
    expect(payload?.state).toEqual(state())
  })

  it('persists placements and the lock preference too', () => {
    const id = placeTile(aPlacement({ x: 3, z: -1, rotation: 90 }))
    setLockSystem('magnetic')
    const payload = storedPayload()
    expect(WorkshopState.safeParse(payload?.state).success).toBe(true)
    expect((payload?.state as WorkshopState).placements[id]).toEqual({
      tileId: TILE_A,
      x: 3,
      z: -1,
      rotation: 90,
    })
    expect((payload?.state as WorkshopState).lock).toBe('magnetic')
  })

  it('loses no update across rapid sequential writes', () => {
    const placed: PlacementId[] = []
    for (let index = 0; index < 250; index += 1) {
      placed.push(placeTile(aPlacement({ x: index * 0.5, z: 0, rotation: (index * 90) % 360 })))
      addToLibrary(TileId.parse(`tiles/dungeon_stone/floor/1x1/openlock/tile-${String(index)}.stl`))
    }

    expect(new Set(placed).size).toBe(250)
    expect(selectPlacementCount(state())).toBe(250)
    expect(selectLibraryCount(state())).toBe(250)

    // The persisted copy must agree with memory exactly. A dropped write shows
    // up here even when the in-memory count is right.
    const persisted = storedPayload()?.state
    expect(persisted).toEqual(state())
    expect(Object.keys((persisted as WorkshopState).placements)).toHaveLength(250)
  })

  it('resets state and storage together', () => {
    addToLibrary(TILE_A)
    placeTile(aPlacement())
    setLockSystem('dragonlock')

    resetWorkshop()
    expect(state()).toEqual({ library: {}, placements: {}, lock: DEFAULT_LOCK_SYSTEM })
    expect(storedPayload()?.state).toEqual(state())
  })

  it('clears the persisted copy on request', () => {
    addToLibrary(TILE_A)
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull()
    clearPersistedWorkshopState()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})

/* --------------------------------------------------------------- rehydration */

describe('rehydrating', () => {
  it('reads back a payload it wrote', async () => {
    addToLibrary(TILE_A)
    const id = placeTile(aPlacement({ x: 2, z: 2, rotation: 180 }))
    setLockSystem('magnetic')
    const written = state()

    resetWorkshop()
    writeStored({ state: written, version: STORE_VERSION })
    await useWorkshopStore.persist.rehydrate()

    expect(state()).toEqual(written)
    expect(state().placements[id]?.rotation).toBe(180)
  })

  it('validates a correctly stamped but corrupt payload — the crashed-tab case', async () => {
    silenceWarnings()
    writeStored({
      version: STORE_VERSION,
      state: {
        library: { [TILE_A]: true, [TILE_B]: 'yes', '': true },
        placements: {
          good: { tileId: TILE_A, x: 1, z: 1, rotation: 0 },
          bad: { tileId: TILE_B, x: null, z: 1, rotation: 0 },
        },
        lock: 'padlock',
      },
    })
    await useWorkshopStore.persist.rehydrate()

    // The version matches, so `migrate` never runs; only `merge` stands between
    // this payload and the app.
    expect(state().library).toEqual({ [TILE_A]: true })
    expect(Object.keys(state().placements)).toEqual(['good'])
    expect(state().lock).toBe(DEFAULT_LOCK_SYSTEM)
    expect(console.warn).toHaveBeenCalledOnce()
  })

  it('migrates a payload stamped with an older version and rewrites it', async () => {
    writeStored({
      version: 0,
      state: { library: { [TILE_A]: true }, placements: {}, lock: 'dragonlock' },
    })
    await useWorkshopStore.persist.rehydrate()

    expect(state().library).toEqual({ [TILE_A]: true })
    expect(state().lock).toBe('dragonlock')
    expect(storedPayload()?.version).toBe(STORE_VERSION)
  })

  it('starts fresh and throws the poison away when the payload is not even JSON', async () => {
    silenceWarnings()
    localStorage.setItem(STORAGE_KEY, '{"state":{"library"')
    await useWorkshopStore.persist.rehydrate()

    expect(state()).toEqual({ library: {}, placements: {}, lock: DEFAULT_LOCK_SYSTEM })
    // Removed, so the next load starts clean instead of reproducing this
    // forever — which is the difference between a bad session and a dead app.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(console.warn).toHaveBeenCalled()
  })

  it.each([
    ['a null state', { state: null, version: STORE_VERSION }],
    ['an array state', { state: [], version: STORE_VERSION }],
    ['a missing state', { version: STORE_VERSION }],
    ['a future version', { state: { lock: 'magnetic' }, version: STORE_VERSION + 3 }],
    ['no envelope at all', { library: { [TILE_A]: true } }],
  ])('survives %s in storage', async (_label, payload) => {
    silenceWarnings()
    writeStored(payload)
    await useWorkshopStore.persist.rehydrate()
    expect(WorkshopState.safeParse(state()).success).toBe(true)
  })
})

/* ------------------------------------------------------------ export, import */

describe('export and import', () => {
  it('round-trips to identical state', () => {
    addToLibrary(TILE_A)
    addToLibrary(TILE_B)
    placeTile(aPlacement({ x: 1.5, z: -2, rotation: 22.5 }))
    placeTile(aPlacement({ tileId: TILE_B, x: 0, z: 0, rotation: 270 }))
    setLockSystem('dragonlock')
    const original = state()

    const file = exportWorkshop()
    resetWorkshop()
    expect(state()).not.toEqual(original)

    const result = importWorkshop(file)
    expect(result).toEqual({ ok: true, dropped: [] })
    expect(state()).toEqual(original)
  })

  it('writes an envelope that identifies itself and carries the version', () => {
    addToLibrary(TILE_A)
    const parsed = WorkshopExport.parse(JSON.parse(exportWorkshop()))
    expect(parsed.kind).toBe(WORKSHOP_EXPORT_KIND)
    expect(parsed.version).toBe(STORE_VERSION)
    expect(parsed.state).toEqual(state())
    expect(Date.parse(parsed.exportedAt)).not.toBeNaN()
  })

  it('persists what it imported', () => {
    addToLibrary(TILE_A)
    const file = exportWorkshop()
    resetWorkshop()
    importWorkshop(file)
    expect(storedPayload()?.state).toEqual(state())
  })

  it('replaces rather than merging, so the result is exactly the file', () => {
    addToLibrary(TILE_A)
    const file = exportWorkshop()
    resetWorkshop()
    addToLibrary(TILE_B)
    placeTile(aPlacement({ tileId: TILE_B }))

    importWorkshop(file)
    expect(state().library).toEqual({ [TILE_A]: true })
    expect(state().placements).toEqual({})
  })

  it.each([
    ['not JSON', 'this is not json'],
    ['an empty string', ''],
    ['a bare array', '[]'],
    ['someone else’s JSON', '{"nodes":[],"edges":[]}'],
    ['a bare state with no envelope', '{"library":{},"placements":{},"lock":"magnetic"}'],
    ['the wrong kind', '{"kind":"something-else","version":1,"state":{}}'],
  ])('changes nothing when given %s', (_label, file) => {
    addToLibrary(TILE_A)
    const before = state()
    const result = importWorkshop(file)
    expect(result.ok).toBe(false)
    expect(state()).toBe(before)
  })

  it('imports the readable part of a damaged file and names the rest', () => {
    const result = importWorkshop(
      JSON.stringify({
        kind: WORKSHOP_EXPORT_KIND,
        version: STORE_VERSION,
        state: {
          library: { [TILE_A]: true },
          placements: {
            keep: { tileId: TILE_A, x: 0, z: 0, rotation: 90 },
            lose: { tileId: TILE_B, x: 'somewhere', z: 0, rotation: 0 },
          },
          lock: 'magnetic',
        },
      }),
    )
    expect(result.ok).toBe(true)
    expect(result.ok && result.dropped).toHaveLength(1)
    expect(Object.keys(state().placements)).toEqual(['keep'])
    expect(state().lock).toBe('magnetic')
  })

  it('walks the migration ladder for a file exported by an older version', () => {
    const result = importWorkshop(
      JSON.stringify({
        kind: WORKSHOP_EXPORT_KIND,
        version: 0,
        state: { library: { [TILE_A]: true }, placements: {}, lock: 'openlock' },
      }),
    )
    expect(result.ok).toBe(true)
    expect(state().library).toEqual({ [TILE_A]: true })
  })
})

/* ---------------------------------------------------- storage durability ask */

describe('requestPersistentStorage', () => {
  it('reports false where the browser has no storage manager', async () => {
    vi.stubGlobal('navigator', {})
    await expect(requestPersistentStorage()).resolves.toBe(false)
  })

  it('reports true without asking again when the origin is already persisted', async () => {
    const persist = vi.fn()
    vi.stubGlobal('navigator', { storage: { persisted: () => Promise.resolve(true), persist } })
    await expect(requestPersistentStorage()).resolves.toBe(true)
    expect(persist).not.toHaveBeenCalled()
  })

  it('passes on the browser’s answer when it has to ask', async () => {
    vi.stubGlobal('navigator', {
      storage: { persisted: () => Promise.resolve(false), persist: () => Promise.resolve(true) },
    })
    await expect(requestPersistentStorage()).resolves.toBe(true)
  })

  it('treats a refusal or a throw as a no rather than a crash', async () => {
    vi.stubGlobal('navigator', {
      storage: { persisted: () => Promise.resolve(false), persist: () => Promise.resolve(false) },
    })
    await expect(requestPersistentStorage()).resolves.toBe(false)

    vi.stubGlobal('navigator', {
      storage: {
        persisted: () => {
          throw new Error('storage is blocked on this origin')
        },
      },
    })
    await expect(requestPersistentStorage()).resolves.toBe(false)
  })
})
