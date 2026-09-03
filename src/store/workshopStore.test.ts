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

import { DesignId, TileId } from '@/catalog'

import { STORE_VERSION } from './migrations'
import type { Placement, PlacementId } from './schema'
import { DEFAULT_LOCK_SYSTEM, WorkshopState } from './schema'
import { STORAGE_KEY, clearPersistedWorkshopState, requestPersistentStorage } from './storage'
import { WORKSHOP_EXPORT_KIND, WorkshopExport, exportWorkshop, importWorkshop } from './transfer'
import {
  acknowledgeLockSystem,
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
  selectLockChosen,
  selectPlacementCount,
  setLockSystem,
  toggleLibrary,
  useWorkshopStore,
} from './workshopStore'

const TILE_A = TileId.parse('tiles/dungeon_stone/floor/2x2/openlock/dungeon_stone%2x2.openlock.stl')
const TILE_B = TileId.parse('tiles/cave/thick_wall/wall/corner/openlock/cave%corner.IL.openlock.stl')

/**
 * Two designs, spelled the way `pipeline/design.ts` mints one — `d` plus twelve
 * hex characters. Not shortened to `d1`, because the shape is what
 * `migrations.ts` relies on to tell an item from a file, and a fixture that
 * cheated on it would let a regression through.
 */
const DESIGN_A = DesignId.parse('d4c2a57740b65')
const DESIGN_B = DesignId.parse('d0f1a2b3c4d5e')

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
  it('adds and removes items', () => {
    addToLibrary(DESIGN_A)
    addToLibrary(DESIGN_B)
    expect(state().library).toEqual({ [DESIGN_A]: true, [DESIGN_B]: true })

    removeFromLibrary(DESIGN_A)
    expect(state().library).toEqual({ [DESIGN_B]: true })
  })

  it('is a set: adding twice changes nothing and wakes no subscriber', () => {
    addToLibrary(DESIGN_A)
    const before = state().library
    addToLibrary(DESIGN_A)
    expect(state().library).toBe(before)
  })

  it('ignores a removal of a tile that was never there', () => {
    addToLibrary(DESIGN_A)
    const before = state().library
    removeFromLibrary(DESIGN_B)
    expect(state().library).toBe(before)
  })

  it('toggles', () => {
    toggleLibrary(DESIGN_A)
    expect(selectIsInLibrary(DESIGN_A)(state())).toBe(true)
    toggleLibrary(DESIGN_A)
    expect(selectIsInLibrary(DESIGN_A)(state())).toBe(false)
  })

  it('clears without touching placements or the lock preference', () => {
    addToLibrary(DESIGN_A)
    placeTile(aPlacement())
    setLockSystem('magnetic')

    clearLibrary()
    expect(selectLibraryCount(state())).toBe(0)
    expect(selectPlacementCount(state())).toBe(1)
    expect(state().lock).toBe('magnetic')
  })

  it('preserves insertion order, which is what the library screen lists by', () => {
    addToLibrary(DESIGN_B)
    addToLibrary(DESIGN_A)
    expect(Object.keys(state().library)).toEqual([DESIGN_B, DESIGN_A])
  })

  it('reports whether the add inserted — the hook row R1 attaches to', () => {
    // The one press that means "this item is new to the library", which is the
    // moment R1 warms its meshes. A second press of the same item must not
    // report one, or the warm-up runs again for bytes the browser already has.
    expect(addToLibrary(DESIGN_A)).toBe(true)
    expect(addToLibrary(DESIGN_A)).toBe(false)

    removeFromLibrary(DESIGN_A)
    expect(addToLibrary(DESIGN_A)).toBe(true)
  })

  it('carries one key per item, whatever the file count behind it', () => {
    // Not a tautology about the map: it is the property the row exists for. The
    // three lock systems pick two or more distinct *files* for 1,419 of the
    // 3,822 items (see `corpus.test.ts`), so under the old file key these two
    // presses — the same item, saved under two preferences — left two entries
    // and the library screen had to explain them. Nothing here can express the
    // difference, which is the point.
    expect(addToLibrary(DESIGN_A)).toBe(true)
    expect(addToLibrary(DESIGN_A)).toBe(false)
    expect(selectLibraryCount(state())).toBe(1)
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
    addToLibrary(DESIGN_A)
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

  it('starts out unchosen, so a one-time prompt can exist', () => {
    // Without this bit, `lock === 'openlock'` is indistinguishable from "never
    // opened the picker" — which is why PR 14 flagged the flag as missing.
    expect(state().lockChosen).toBe(false)
    expect(selectLockChosen(state())).toBe(false)
  })

  it('counts picking a system as choosing, including re-picking the default', () => {
    setLockSystem('magnetic')
    expect(state().lockChosen).toBe(true)

    resetWorkshop()
    setLockSystem(DEFAULT_LOCK_SYSTEM)
    // The value did not change; the decision did. A toolbar control that left
    // this false would leave the first-run notice on screen after the user had
    // answered it.
    expect(state().lock).toBe(DEFAULT_LOCK_SYSTEM)
    expect(state().lockChosen).toBe(true)
  })

  it('lets the user accept the default without restating it', () => {
    acknowledgeLockSystem()
    expect(state().lockChosen).toBe(true)
    expect(state().lock).toBe(DEFAULT_LOCK_SYSTEM)
  })

  it('survives a persist round trip', () => {
    setLockSystem('dragonlock')
    const payload = storedPayload()
    expect((payload?.state as WorkshopState).lockChosen).toBe(true)
    expect((payload?.state as WorkshopState).lock).toBe('dragonlock')

    resetWorkshop()
    expect(state().lockChosen).toBe(false)

    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    void useWorkshopStore.persist.rehydrate()
    expect(state().lockChosen).toBe(true)
    expect(state().lock).toBe('dragonlock')
  })

  it('survives an export and re-import', () => {
    setLockSystem('magnetic')
    const file = exportWorkshop()
    resetWorkshop()
    expect(importWorkshop(file)).toEqual({ ok: true, dropped: [] })
    expect(state().lockChosen).toBe(true)
    expect(state().lock).toBe('magnetic')
  })
})

/* ----------------------------------------------------------------- selectors */

describe('selector granularity', () => {
  it('does not disturb library subscribers when a tile is placed', () => {
    addToLibrary(DESIGN_A)
    const libraryBefore = state().library
    const membershipBefore = selectIsInLibrary(DESIGN_A)(state())

    placeTile(aPlacement())
    placeTile(aPlacement({ x: 1 }))

    // Same object identity and the same boolean, so a catalog card subscribed
    // through `useIsInLibrary` re-renders for neither placement.
    expect(state().library).toBe(libraryBefore)
    expect(selectIsInLibrary(DESIGN_A)(state())).toBe(membershipBefore)
  })

  it('does not disturb scene subscribers when a tile is filed', () => {
    const id = placeTile(aPlacement())
    const placementsBefore = state().placements
    addToLibrary(DESIGN_B)
    expect(state().placements).toBe(placementsBefore)
    expect(state().placements[id]).toBe(placementsBefore[id])
  })

  it('reports counts as numbers, so an unchanged count is not a re-render', () => {
    addToLibrary(DESIGN_A)
    expect(selectLibraryCount(state())).toBe(1)
    addToLibrary(DESIGN_A)
    expect(selectLibraryCount(state())).toBe(1)
  })
})

/* --------------------------------------------------------------- persistence */

describe('persistence', () => {
  it('writes synchronously, with the version stamped from the first commit', () => {
    addToLibrary(DESIGN_A)
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
      addToLibrary(DesignId.parse(`d${index.toString(16).padStart(12, '0')}`))
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
    addToLibrary(DESIGN_A)
    placeTile(aPlacement())
    setLockSystem('dragonlock')

    resetWorkshop()
    expect(state()).toEqual({
      library: {},
      placements: {},
      generated: {},
      lock: DEFAULT_LOCK_SYSTEM,
      lockChosen: false,
    })
    expect(storedPayload()?.state).toEqual(state())
  })

  it('clears the persisted copy on request', () => {
    addToLibrary(DESIGN_A)
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull()
    clearPersistedWorkshopState()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})

/* --------------------------------------------------------------- rehydration */

describe('rehydrating', () => {
  it('reads back a payload it wrote', async () => {
    addToLibrary(DESIGN_A)
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
        // A file id among the keys is the one corruption row V1 introduced the
        // possibility of: it is what every version 1–3 library was made of, so a
        // hand edit or a stale preview build can put one here under the current
        // stamp. It must be refused rather than kept as a key that resolves to
        // no record.
        library: { [DESIGN_A]: true, [DESIGN_B]: 'yes', '': true, [TILE_A]: true },
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
    expect(state().library).toEqual({ [DESIGN_A]: true })
    expect(Object.keys(state().placements)).toEqual(['good'])
    expect(state().lock).toBe(DEFAULT_LOCK_SYSTEM)
    expect(console.warn).toHaveBeenCalledOnce()
  })

  it.each([
    ['version 1 — a library of files, no lockChosen, no generated', 1],
    ['version 2 — lockChosen but no generated', 2],
    ['version 3 — the shape before the library held designs', 3],
    ['a version from the future', STORE_VERSION + 3],
  ])('discards a payload stamped %s and rewrites storage at the current version', async (_label, version) => {
    silenceWarnings()
    // Written the way version 1–3 wrote it: the library is a map of *files*.
    // Nothing about it is readable as a version 4 state, and the owner's
    // decision is that nothing is deployed so nothing has to be — see
    // `migrations.ts`.
    writeStored({
      ...(version === undefined ? {} : { version }),
      state: { library: { [TILE_A]: true }, placements: {}, lock: 'dragonlock' },
    })
    await useWorkshopStore.persist.rehydrate()

    expect(state()).toEqual({
      library: {},
      placements: {},
      generated: {},
      lock: DEFAULT_LOCK_SYSTEM,
      lockChosen: false,
    })
    // Rewritten at the current version, so the next load is a clean read rather
    // than a second discard.
    expect(storedPayload()?.version).toBe(STORE_VERSION)
    expect(console.warn).toHaveBeenCalledOnce()
  })

  it('never reaches the version gate for a blob whose stamp is not a number', async () => {
    silenceWarnings()
    // Measured against `zustand/middleware`, not assumed: `persist` calls
    // `migrate` only when `typeof value.version === 'number'`, so an unstamped
    // blob — or one stamped `"3"` — bypasses the gate entirely and is read by
    // `merge`, which is `salvageWorkshopState`. That is why `salvageLibrary`
    // rejects a file id in the library rather than trusting the gate to have
    // discarded the shape first: on this path it is the only reader there is.
    writeStored({ state: { library: { [TILE_A]: true }, placements: {}, lock: 'dragonlock' } })
    await useWorkshopStore.persist.rehydrate()

    // The library is empty because every key was a file id, named and dropped.
    expect(state().library).toEqual({})
    // And the rest of the blob survived, because salvage keeps what it can — so
    // the lock is the one the blob carried, not the default a discard produces.
    expect(state().lock).toBe('dragonlock')
    expect(console.warn).toHaveBeenCalledOnce()
  })

  it('starts fresh and throws the poison away when the payload is not even JSON', async () => {
    silenceWarnings()
    localStorage.setItem(STORAGE_KEY, '{"state":{"library"')
    await useWorkshopStore.persist.rehydrate()

    expect(state()).toEqual({
      library: {},
      placements: {},
      generated: {},
      lock: DEFAULT_LOCK_SYSTEM,
      lockChosen: false,
    })
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
    ['no envelope at all', { library: { [DESIGN_A]: true } }],
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
    addToLibrary(DESIGN_A)
    addToLibrary(DESIGN_B)
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
    addToLibrary(DESIGN_A)
    const parsed = WorkshopExport.parse(JSON.parse(exportWorkshop()))
    expect(parsed.kind).toBe(WORKSHOP_EXPORT_KIND)
    expect(parsed.version).toBe(STORE_VERSION)
    expect(parsed.state).toEqual(state())
    expect(Date.parse(parsed.exportedAt)).not.toBeNaN()
  })

  it('persists what it imported', () => {
    addToLibrary(DESIGN_A)
    const file = exportWorkshop()
    resetWorkshop()
    importWorkshop(file)
    expect(storedPayload()?.state).toEqual(state())
  })

  it('replaces rather than merging, so the result is exactly the file', () => {
    addToLibrary(DESIGN_A)
    const file = exportWorkshop()
    resetWorkshop()
    addToLibrary(DESIGN_B)
    placeTile(aPlacement({ tileId: TILE_B }))

    importWorkshop(file)
    expect(state().library).toEqual({ [DESIGN_A]: true })
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
    addToLibrary(DESIGN_A)
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
          library: { [DESIGN_A]: true },
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

  it.each([
    ['an older version', 3],
    ['a newer version', STORE_VERSION + 1],
    ['no version at all', undefined],
  ])('refuses a file exported at %s, and says which', (_label, version) => {
    addToLibrary(DESIGN_A)
    const before = state()
    const result = importWorkshop(
      JSON.stringify({
        kind: WORKSHOP_EXPORT_KIND,
        ...(version === undefined ? {} : { version }),
        state: { library: { [TILE_B]: true }, placements: {}, lock: 'magnetic' },
      }),
    )

    expect(result.ok).toBe(false)
    // The message has to name the version, because "that file does not work" is
    // indistinguishable to the user from "that file is corrupt" — and the two
    // have different answers, one of which is "keep it, a later build will read
    // it".
    expect(result.ok || result.reason).toMatch(/version/)
    // Refusing changes nothing at all, which is what makes it safe to try the
    // next file.
    expect(state()).toBe(before)
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
