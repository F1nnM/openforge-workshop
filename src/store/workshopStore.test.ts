// @vitest-environment jsdom
//
// jsdom, because everything below is about `localStorage`. Declared per file
// rather than globally: the catalog schema, the facet engine and the importer
// are headless and pay nothing for a DOM they never touch. (`environmentMatchGlobs`
// was removed in Vitest 4, so this docblock is the mechanism.)
/**
 * The store, its actions and its persistence.
 *
 * The four tests worth reading first are `places a template whose fills are
 * empty` — contract **C-g**, and the reason `placeTemplate` takes no
 * completeness argument; `refuses to re-solve a slot the user pinned` —
 * contract **C-k**, and the mechanism keeping the lock toggle alive; `rapid
 * sequential writes`, the reason the write path is synchronous and every action
 * uses a functional update; and the `rehydrating` block, which drives the real
 * `persist` middleware rather than calling the migration functions directly, so
 * it proves the wiring and not just the logic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TileId } from '@/catalog'
import { DesignId } from '@/catalog'

import { ANOTHER_TILE, A_TEMPLATE, A_TILE, aFullFillMap, aTemplateInstance } from './fixture'
import { STORE_VERSION } from './migrations'
import type { PlacementId, TemplateId } from './schema'
import { DEFAULT_LOCK_SYSTEM, SlotName as SlotNameSchema, WorkshopState } from './schema'
import { claimPendingDesign, sendDesignToBuilder } from './selection'
import { STORAGE_KEY, clearPersistedWorkshopState, requestPersistentStorage } from './storage'
import { WORKSHOP_EXPORT_KIND, WorkshopExport, exportWorkshop, importWorkshop } from './transfer'
import {
  acknowledgeLockSystem,
  clearPlacements,
  fillSlot,
  movePlacement,
  pinFill,
  placeTemplate,
  removePlacement,
  resetWorkshop,
  rotatePlacement,
  selectLockChosen,
  selectPlacementCount,
  setLockSystem,
  useWorkshopStore,
} from './workshopStore'

const FLOOR = SlotNameSchema.parse('floor')
const WALL = SlotNameSchema.parse('right wall')

/**
 * A design id for the selection channel, which still carries an item.
 *
 * Row C1 owns whether that stays true — a palette of 52 template families may
 * want a `TemplateId` in the box instead — so this row reads the channel without
 * taking a position on its currency, and names the one fact it needs:
 * `resetWorkshop` empties it.
 */
const A_PENDING_DESIGN = DesignId.parse('d4c2a57740b65')

const state = () => useWorkshopStore.getState()

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

/** The empty state, spelled out so a field added to it is a deliberate edit here. */
const EMPTY = {
  placements: {},
  generated: {},
  lock: DEFAULT_LOCK_SYSTEM,
  lockChosen: false,
}

beforeEach(() => {
  localStorage.clear()
  resetWorkshop()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/* ------------------------------------------------------------------ placement */

describe('placing a template', () => {
  it('puts an instance on the grid under a fresh key each time', () => {
    const first = placeTemplate(aTemplateInstance({ x: 1, z: 1 }))
    const second = placeTemplate(aTemplateInstance({ x: 2, z: 2 }))
    expect(first).not.toBe(second)
    expect(state().placements[first]?.template).toBe(A_TEMPLATE)
    expect(state().placements[first]?.x).toBe(1)
    expect(selectPlacementCount(state())).toBe(2)
  })

  it('mints the id, so the map key and the id field cannot disagree', () => {
    // `schema.ts` puts `id` inside the instance because an instance travels
    // detached from the map, and pays for it with a disagreement that is
    // expressible in a blob out of storage. Nothing in the *app* can produce
    // one, and this is why: the caller never supplies an id.
    const id = placeTemplate(aTemplateInstance())
    expect(state().placements[id]?.id).toBe(id)
    for (const [key, instance] of Object.entries(state().placements)) {
      expect(instance.id).toBe(key)
    }
  })

  it('places a template whose fills are empty — contract C-g', () => {
    // §3.2: a template with no candidate for a part *"places anyway"*, marked
    // needs a choice. If this row refused an incomplete map, that state would be
    // unreachable from the store upward: C2's solver could not report a slot it
    // failed to fill, and C3's editor would have nothing to open on.
    const id = placeTemplate(aTemplateInstance({ fills: {} }))
    expect(state().placements[id]?.fills).toEqual({})
    expect(selectPlacementCount(state())).toBe(1)
  })

  it('places a partly-filled template, which is the ordinary case', () => {
    const id = placeTemplate(aTemplateInstance({ fills: { [FLOOR]: { tile: A_TILE, pinned: false } } }))
    expect(state().placements[id]?.fills[FLOOR]).toEqual({ tile: A_TILE, pinned: false })
    // And the four slots nobody filled read as absent rather than as anything
    // else — the shape §3.2's "needs a choice" is rendered from.
    expect(state().placements[id]?.fills[WALL]).toBeUndefined()
  })

  it('places a fully-filled template too', () => {
    const id = placeTemplate(aTemplateInstance({ fills: aFullFillMap() }))
    expect(Object.keys(state().placements[id]?.fills ?? {})).toHaveLength(5)
  })

  it('accepts a slot name the schema cannot check against the template', () => {
    // Deliberate, and stated because it looks like a hole: validating that a key
    // of `fills` is a slot of `template` needs the family table, which must not
    // enter the store's file closure (`schema.ts#TemplateId`). It fails closed —
    // rendering walks the *template's* parts and asks `fills` for each, so an
    // unknown key is never read.
    const id = placeTemplate(
      aTemplateInstance({ fills: { [SlotNameSchema.parse('no such slot')]: { tile: A_TILE, pinned: true } } }),
    )
    expect(state().placements[id]?.fills[SlotNameSchema.parse('no such slot')]?.pinned).toBe(true)
  })

  it('folds rotation into [0, 360) on the way in', () => {
    const id = placeTemplate(aTemplateInstance({ rotation: 450 }))
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
    const id = placeTemplate(aTemplateInstance({ x: -0, z: -0 }))
    expect(Object.is(state().placements[id]?.x, 0)).toBe(true)
    expect(Object.is(state().placements[id]?.z, 0)).toBe(true)
  })

  it('moves and removes', () => {
    const id = placeTemplate(aTemplateInstance())
    movePlacement(id, -2.5, 4)
    expect(state().placements[id]?.x).toBe(-2.5)
    expect(state().placements[id]?.z).toBe(4)
    // A move keeps the fills: which files the piece is made of is not a question
    // about where it sits.
    expect(state().placements[id]?.fills).toEqual(aTemplateInstance().fills)

    removePlacement(id)
    expect(state().placements).toEqual({})
  })

  it('rotates as one unit, leaving the fills alone', () => {
    // §1: a template is "placed and rotated as one unit". The slot offsets are
    // arithmetic against this one angle at fill time (§2.2), so there is nothing
    // per-slot to rotate and nothing here to keep in step.
    const id = placeTemplate(aTemplateInstance({ fills: aFullFillMap() }))
    const before = state().placements[id]?.fills
    rotatePlacement(id, 180)
    expect(state().placements[id]?.rotation).toBe(180)
    expect(state().placements[id]?.fills).toBe(before)
  })

  it('ignores edits to a key that is not on the grid', () => {
    const ghost = 'not-a-placement-in-this-scene' as PlacementId
    placeTemplate(aTemplateInstance())
    const before = state().placements
    movePlacement(ghost, 1, 1)
    rotatePlacement(ghost, 90)
    removePlacement(ghost)
    // A stale drag is a bug in the caller rather than an outcome of the room, so
    // it is named rather than folded into "nothing changed".
    expect(fillSlot(ghost, FLOOR, A_TILE)).toBe('unknown-placement')
    expect(pinFill(ghost, FLOOR, A_TILE)).toBe('unknown-placement')
    expect(state().placements).toBe(before)
  })

  it('rejects an unusable instance at the call that made it', () => {
    // Loud here, where the stack names the culprit — rather than months later
    // during a hydration, where it is indistinguishable from storage corruption.
    expect(() => placeTemplate(aTemplateInstance({ x: Number.NaN }))).toThrow()
    // A template id is a lowercase hyphen-separated slug, so a catalog path, an
    // empty string and `"undefined"` are all refused. That pattern is the only
    // thing standing between a corrupt blob and an instance naming no template.
    expect(() => placeTemplate(aTemplateInstance({ template: '' as TemplateId }))).toThrow()
    expect(() => placeTemplate(aTemplateInstance({ template: 'tiles/x.stl' as TemplateId }))).toThrow()
    expect(() => placeTemplate(aTemplateInstance({ template: 'Not A Slug' as TemplateId }))).toThrow()
    // And a fill whose file is not a catalog path.
    expect(() =>
      placeTemplate(aTemplateInstance({ fills: { [FLOOR]: { tile: 'nonsense' as TileId, pinned: false } } })),
    ).toThrow()
    expect(state().placements).toEqual({})
  })

  it('clears the scene', () => {
    placeTemplate(aTemplateInstance())
    clearPlacements()
    expect(state().placements).toEqual({})
    expect(state().lock).toBe(DEFAULT_LOCK_SYSTEM)
  })
})

/* ---------------------------------------------------------------------- fills */

describe('filling slots', () => {
  it('fills a slot auto, and reports that it wrote', () => {
    const id = placeTemplate(aTemplateInstance({ fills: {} }))
    expect(fillSlot(id, FLOOR, A_TILE)).toBe('filled')
    expect(state().placements[id]?.fills[FLOOR]).toEqual({ tile: A_TILE, pinned: false })
  })

  it('pins a slot the user picked', () => {
    const id = placeTemplate(aTemplateInstance({ fills: {} }))
    expect(pinFill(id, FLOOR, A_TILE)).toBe('filled')
    expect(state().placements[id]?.fills[FLOOR]).toEqual({ tile: A_TILE, pinned: true })
  })

  it('refuses to re-solve a slot the user pinned — contract C-k', () => {
    // §2.1: "a lock change re-solves every `auto` fill and never touches a
    // `pinned` one". The refusal lives in the store rather than in the solver,
    // because a solver that simply forgot to skip pinned slots would silently
    // discard every deliberate choice in the room with nothing failing.
    const id = placeTemplate(aTemplateInstance({ fills: {} }))
    pinFill(id, FLOOR, A_TILE)

    // `'kept-pinned'` and not `false`: after a lock change the count of these is
    // the number of deliberate choices the re-solve honoured, which is what §3.3
    // has to disclose. A boolean would hide it among two other falses — see
    // `FillOutcome`.
    expect(fillSlot(id, FLOOR, ANOTHER_TILE)).toBe('kept-pinned')
    expect(state().placements[id]?.fills[FLOOR]).toEqual({ tile: A_TILE, pinned: true })
  })

  it('re-solves an auto slot, which is what makes the lock toggle live', () => {
    const id = placeTemplate(aTemplateInstance({ fills: {} }))
    fillSlot(id, FLOOR, A_TILE)
    expect(fillSlot(id, FLOOR, ANOTHER_TILE)).toBe('filled')
    expect(state().placements[id]?.fills[FLOOR]).toEqual({ tile: ANOTHER_TILE, pinned: false })
  })

  it('lets the user override their own pick, and their own is the only thing that can', () => {
    const id = placeTemplate(aTemplateInstance({ fills: {} }))
    pinFill(id, FLOOR, A_TILE)
    expect(pinFill(id, FLOOR, ANOTHER_TILE)).toBe('filled')
    expect(state().placements[id]?.fills[FLOOR]).toEqual({ tile: ANOTHER_TILE, pinned: true })
  })

  it('is a no-op that wakes no subscriber when the fill is already what it would write', () => {
    const id = placeTemplate(aTemplateInstance({ fills: {} }))
    fillSlot(id, FLOOR, A_TILE)
    const before = state().placements
    // `'unchanged'`, distinguishable from `'kept-pinned'`: a re-solve that
    // produces the same file is not news, while one that honoured a user's pick
    // is.
    expect(fillSlot(id, FLOOR, A_TILE)).toBe('unchanged')
    expect(state().placements).toBe(before)
  })

  it('promotes an auto fill to pinned even when the file does not change', () => {
    // The one case the identity check above must not swallow: "yes, that one" on
    // the file the solver already chose is a decision, and it has to stick or the
    // next lock change would undo it.
    const id = placeTemplate(aTemplateInstance({ fills: {} }))
    fillSlot(id, FLOOR, A_TILE)
    expect(pinFill(id, FLOOR, A_TILE)).toBe('filled')
    expect(state().placements[id]?.fills[FLOOR]?.pinned).toBe(true)
    expect(fillSlot(id, FLOOR, ANOTHER_TILE)).toBe('kept-pinned')
  })

  it('touches one slot and one instance', () => {
    const first = placeTemplate(aTemplateInstance({ fills: aFullFillMap() }))
    const second = placeTemplate(aTemplateInstance({ x: 4, fills: aFullFillMap() }))
    const otherInstance = state().placements[second]
    const otherSlot = state().placements[first]?.fills[WALL]

    pinFill(first, FLOOR, ANOTHER_TILE)

    expect(state().placements[second]).toBe(otherInstance)
    expect(state().placements[first]?.fills[WALL]).toBe(otherSlot)
  })

  it('survives a persist round trip with the pinned bits intact', () => {
    const id = placeTemplate(aTemplateInstance({ fills: {} }))
    fillSlot(id, FLOOR, A_TILE)
    pinFill(id, WALL, ANOTHER_TILE)

    const payload = storedPayload()
    resetWorkshop()
    writeStored(payload)
    void useWorkshopStore.persist.rehydrate()

    expect(state().placements[id]?.fills[FLOOR]?.pinned).toBe(false)
    expect(state().placements[id]?.fills[WALL]?.pinned).toBe(true)
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

  it('does not itself re-solve a fill, and this is the boundary it holds', () => {
    // The repair is a *re-solve* — C2 walking the slots and calling `fillSlot` —
    // and it is not this action's, because doing it here would put the fill
    // solver and therefore the catalog inside the store. So switching the lock
    // leaves the room exactly as it was and the trigger is all it is.
    const id = placeTemplate(aTemplateInstance({ fills: {} }))
    fillSlot(id, FLOOR, A_TILE)
    const before = state().placements[id]?.fills[FLOOR]

    setLockSystem('dragonlock')

    expect(state().placements[id]?.fills[FLOOR]).toBe(before)
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
  it('does not disturb one instance’s subscribers when another is placed', () => {
    const id = placeTemplate(aTemplateInstance())
    const instanceBefore = state().placements[id]

    placeTemplate(aTemplateInstance({ x: 1 }))
    placeTemplate(aTemplateInstance({ x: 2 }))

    // Same object identity, so a component subscribed through `usePlacement(id)`
    // re-renders for neither.
    expect(state().placements[id]).toBe(instanceBefore)
  })

  it('reports counts as numbers, so an unchanged count is not a re-render', () => {
    const id = placeTemplate(aTemplateInstance())
    expect(selectPlacementCount(state())).toBe(1)
    // A slot edit changes the scene and not the count, which is the whole reason
    // the header subscribes to a number.
    fillSlot(id, WALL, A_TILE)
    expect(selectPlacementCount(state())).toBe(1)
  })

  it('counts instances rather than parts', () => {
    // One instance is up to five printed pieces. This chip is about what the
    // user put down; row C4 owns the count of parts, which needs the templates.
    placeTemplate(aTemplateInstance({ fills: aFullFillMap() }))
    expect(selectPlacementCount(state())).toBe(1)
  })
})

/* --------------------------------------------------------------- persistence */

describe('persistence', () => {
  it('writes synchronously, with the version stamped from the first commit', () => {
    placeTemplate(aTemplateInstance())
    // No await: an async storage adapter would make this line flaky and every
    // rapid placement a lost-update race.
    const payload = storedPayload()
    expect(payload?.version).toBe(STORE_VERSION)
    expect(payload?.state).toEqual(state())
  })

  it('persists instances, their fills and the lock preference', () => {
    const id = placeTemplate(aTemplateInstance({ x: 3, z: -1, rotation: 90, fills: {} }))
    pinFill(id, FLOOR, A_TILE)
    setLockSystem('magnetic')
    const payload = storedPayload()
    expect(WorkshopState.safeParse(payload?.state).success).toBe(true)
    expect((payload?.state as WorkshopState).placements[id]).toEqual({
      id,
      template: A_TEMPLATE,
      x: 3,
      z: -1,
      rotation: 90,
      fills: { [FLOOR]: { tile: A_TILE, pinned: true } },
    })
    expect((payload?.state as WorkshopState).lock).toBe('magnetic')
  })

  it('loses no update across rapid sequential writes', () => {
    const placed: PlacementId[] = []
    for (let index = 0; index < 250; index += 1) {
      placed.push(placeTemplate(aTemplateInstance({ x: index * 0.5, z: 0, rotation: (index * 90) % 360 })))
      fillSlot(placed[index] as PlacementId, WALL, ANOTHER_TILE)
    }

    expect(new Set(placed).size).toBe(250)
    expect(selectPlacementCount(state())).toBe(250)

    // The persisted copy must agree with memory exactly. A dropped write shows
    // up here even when the in-memory count is right.
    const persisted = storedPayload()?.state
    expect(persisted).toEqual(state())
    expect(Object.keys((persisted as WorkshopState).placements)).toHaveLength(250)
    for (const id of placed) {
      expect((persisted as WorkshopState).placements[id]?.fills[WALL]?.tile).toBe(ANOTHER_TILE)
    }
  })

  it('resets state and storage together', () => {
    placeTemplate(aTemplateInstance())
    setLockSystem('dragonlock')

    resetWorkshop()
    expect(state()).toEqual(EMPTY)
    expect(storedPayload()?.state).toEqual(state())
  })

  it('clears the selection channel on reset — contract C-f', () => {
    // `selection.ts` used to argue the opposite, and its premise was the
    // library: "a reset that emptied the library disarms the handoff by making
    // it unclaimable". Row A0 deleted the library, so the palette now lists 52
    // generated template families that no reset can clear — and a pending
    // handoff would survive "clear everything" and still be claimable.
    sendDesignToBuilder(A_PENDING_DESIGN)
    resetWorkshop()
    expect(claimPendingDesign()).toBeNull()
  })

  it('clears the persisted copy on request', () => {
    placeTemplate(aTemplateInstance())
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull()
    clearPersistedWorkshopState()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})

/* --------------------------------------------------------------- rehydration */

describe('rehydrating', () => {
  it('reads back a payload it wrote', async () => {
    const id = placeTemplate(aTemplateInstance({ x: 2, z: 2, rotation: 180, fills: aFullFillMap() }))
    setLockSystem('magnetic')
    const written = state()

    resetWorkshop()
    writeStored({ state: written, version: STORE_VERSION })
    await useWorkshopStore.persist.rehydrate()

    expect(state()).toEqual(written)
    expect(state().placements[id]?.rotation).toBe(180)
    expect(Object.keys(state().placements[id]?.fills ?? {})).toHaveLength(5)
  })

  it('validates a correctly stamped but corrupt payload — the crashed-tab case', async () => {
    silenceWarnings()
    writeStored({
      version: STORE_VERSION,
      state: {
        placements: {
          good: { id: 'good', template: A_TEMPLATE, x: 1, z: 1, rotation: 0, fills: {} },
          bad: { id: 'bad', template: A_TEMPLATE, x: null, z: 1, rotation: 0, fills: {} },
          // The identity every version 5 blob wrote, and the one
          // `salvageTemplate` recognises by field name.
          stale: { design: 'd4c2a57740b65', x: 0, z: 0, rotation: 0 },
          // A readable instance with one unreadable fill: it keeps the instance
          // and loses the slot, which then reads as needs a choice.
          partial: {
            id: 'partial',
            template: A_TEMPLATE,
            x: 2,
            z: 2,
            rotation: 0,
            fills: { floor: { tile: A_TILE, pinned: true }, 'right wall': { tile: 'nonsense', pinned: false } },
          },
        },
        lock: 'padlock',
      },
    })
    await useWorkshopStore.persist.rehydrate()

    // The version matches, so `migrate` never runs; only `merge` stands between
    // this payload and the app.
    expect(Object.keys(state().placements).sort()).toEqual(['good', 'partial'])
    expect(state().placements['partial' as PlacementId]?.fills).toEqual({
      [FLOOR]: { tile: A_TILE, pinned: true },
    })
    expect(state().lock).toBe(DEFAULT_LOCK_SYSTEM)
    expect(console.warn).toHaveBeenCalledOnce()
  })

  it.each([
    ['version 1 — a library of files, no lockChosen, no generated', 1],
    ['version 4 — a library of designs, placements still keyed by file', 4],
    ['version 5 — the shape before a placement held a template', 5],
    ['a version from the future', STORE_VERSION + 3],
  ])('discards a payload stamped %s and rewrites storage at the current version', async (_label, version) => {
    silenceWarnings()
    // Written the way version 5 wrote it: a `library` beside placements that
    // name a design. Nothing about it is readable as a version 6 state, and the
    // owner's decision is that nothing is deployed so nothing has to be — see
    // `migrations.ts`, including why a 5 → 6 rung would have to *fabricate* a
    // family and a fill set rather than convert anything.
    writeStored({
      version,
      state: {
        library: { d4c2a57740b65: true },
        placements: { p1: { design: 'd4c2a57740b65', x: 0, z: 0, rotation: 0 } },
        lock: 'dragonlock',
      },
    })
    await useWorkshopStore.persist.rehydrate()

    expect(state()).toEqual(EMPTY)
    // Rewritten at the current version, so the next load is a clean read rather
    // than a second discard.
    expect(storedPayload()?.version).toBe(STORE_VERSION)
    expect(console.warn).toHaveBeenCalledOnce()
  })

  it('never reaches the version gate for a blob whose stamp is not a number', async () => {
    silenceWarnings()
    // Measured against `zustand/middleware`, not assumed: `persist` calls
    // `migrate` only when `typeof value.version === 'number'`, so an unstamped
    // blob — or one stamped `"5"` — bypasses the gate entirely and is read by
    // `merge`, which is `salvageWorkshopState`. That is why `salvageTemplate`
    // recognises the old `design` field by name rather than trusting the gate to
    // have discarded the shape first: on this path it is the only reader there is.
    writeStored({
      state: {
        placements: { p1: { design: 'd4c2a57740b65', x: 0, z: 0, rotation: 0 } },
        lock: 'dragonlock',
      },
    })
    await useWorkshopStore.persist.rehydrate()

    // The scene is empty because the one placement named an item rather than a
    // template, named and dropped.
    expect(state().placements).toEqual({})
    // And the rest of the blob survived, because salvage keeps what it can — so
    // the lock is the one the blob carried, not the default a discard produces.
    expect(state().lock).toBe('dragonlock')
    expect(console.warn).toHaveBeenCalledOnce()
  })

  it('says nothing about a leftover library key, because that field no longer exists', async () => {
    silenceWarnings()
    // Not corruption of the current shape — a field the build has dropped. On
    // the unstamped path it has no reader and no effect, and a message about it
    // would tell the user about a feature that is gone.
    writeStored({ state: { library: { d4c2a57740b65: true }, placements: {}, lock: 'magnetic' } })
    await useWorkshopStore.persist.rehydrate()

    expect(state().lock).toBe('magnetic')
    expect(state()).toEqual({ ...EMPTY, lock: 'magnetic' })
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('starts fresh and throws the poison away when the payload is not even JSON', async () => {
    silenceWarnings()
    localStorage.setItem(STORAGE_KEY, '{"state":{"placements"')
    await useWorkshopStore.persist.rehydrate()

    expect(state()).toEqual(EMPTY)
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
    ['no envelope at all', { placements: {} }],
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
    placeTemplate(aTemplateInstance({ x: 1.5, z: -2, rotation: 22.5, fills: aFullFillMap() }))
    placeTemplate(aTemplateInstance({ x: 0, z: 0, rotation: 270, fills: {} }))
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
    placeTemplate(aTemplateInstance())
    const parsed = WorkshopExport.parse(JSON.parse(exportWorkshop()))
    expect(parsed.kind).toBe(WORKSHOP_EXPORT_KIND)
    expect(parsed.version).toBe(STORE_VERSION)
    expect(parsed.state).toEqual(state())
    expect(Date.parse(parsed.exportedAt)).not.toBeNaN()
  })

  it('persists what it imported', () => {
    placeTemplate(aTemplateInstance())
    const file = exportWorkshop()
    resetWorkshop()
    importWorkshop(file)
    expect(storedPayload()?.state).toEqual(state())
  })

  it('replaces rather than merging, so the result is exactly the file', () => {
    const kept = placeTemplate(aTemplateInstance())
    const file = exportWorkshop()
    resetWorkshop()
    placeTemplate(aTemplateInstance({ x: 9 }))

    importWorkshop(file)
    expect(Object.keys(state().placements)).toEqual([kept])
  })

  it.each([
    ['not JSON', 'this is not json'],
    ['an empty string', ''],
    ['a bare array', '[]'],
    ['someone else’s JSON', '{"nodes":[],"edges":[]}'],
    ['a bare state with no envelope', '{"placements":{},"lock":"magnetic"}'],
    ['the wrong kind', '{"kind":"something-else","version":1,"state":{}}'],
  ])('changes nothing when given %s', (_label, file) => {
    placeTemplate(aTemplateInstance())
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
          placements: {
            keep: { id: 'keep', template: A_TEMPLATE, x: 0, z: 0, rotation: 90, fills: {} },
            lose: { id: 'lose', template: A_TEMPLATE, x: 'somewhere', z: 0, rotation: 0, fills: {} },
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
    ['an older version', 5],
    ['a newer version', STORE_VERSION + 1],
    ['no version at all', undefined],
  ])('refuses a file exported at %s, and says which', (_label, version) => {
    placeTemplate(aTemplateInstance())
    const before = state()
    const result = importWorkshop(
      JSON.stringify({
        kind: WORKSHOP_EXPORT_KIND,
        ...(version === undefined ? {} : { version }),
        state: { placements: {}, lock: 'magnetic' },
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
