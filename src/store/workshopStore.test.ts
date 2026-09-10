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

import { ANOTHER_TILE, A_TEMPLATE, A_TILE, aFullFillMap, aTemplateInstance } from './fixture'
import { STORE_VERSION } from './migrations'
import type { PlacementId, TemplateId } from './schema'
import {
  DEFAULT_LOCK_SYSTEM,
  HoldFill,
  HoldName as HoldNameSchema,
  SlotName as SlotNameSchema,
  WorkshopState,
  filledSlots,
} from './schema'
import { armTemplateInBuilder, claimPendingArm } from './selection'
import { STORAGE_KEY, clearPersistedWorkshopState, requestPersistentStorage } from './storage'
import { WORKSHOP_EXPORT_KIND, WorkshopExport, exportWorkshop, importWorkshop } from './transfer'
import {
  clearFill,
  clearHold,
  clearPlacements,
  fillHold,
  fillHolds,
  fillSlot,
  movePlacement,
  pinFill,
  pinHold,
  placeTemplate,
  removePlacement,
  resetWorkshop,
  rotatePlacement,
  selectLockChosen,
  selectPlacementCount,
  selectRoomDesign,
  setLockSystem,
  setPlacementFilters,
  setRoomDesign,
  unpinFill,
  unpinHold,
  useWorkshopStore,
} from './workshopStore'

const FLOOR = SlotNameSchema.parse('floor')
const WALL = SlotNameSchema.parse('right wall')

/** Two holds of a wall, named the way the measuring tool names a mount. */
const TORCH = HoldNameSchema.parse('torch')
const DOOR = HoldNameSchema.parse('left door')

/** One slot filled with {@link A_TILE}, ready for a hold to go into. */
const oneFilledSlot = () => ({ [WALL]: { tile: A_TILE, pinned: false } })

/** The holds of one slot, or `undefined` when that fill was never solved. */
const holdsOf = (id: PlacementId, slot = WALL) => state().placements[id]?.fills[slot]?.holds

/**
 * An arm for the selection channel.
 *
 * This row read the channel without taking a position on its currency, because
 * **row C1 owned what it should carry** and took the decision: an item was
 * something no reader could act on, so the box holds the palette's arm — a
 * `TemplateId` and one size position. The one fact this row needs is unchanged:
 * `resetWorkshop` empties it. `selection.test.ts` holds the rest.
 */
const A_PENDING_ARM = { template: A_TEMPLATE, size: [] as readonly string[] }

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

  it('keeps the control position it was placed at', () => {
    /* The position is **not** recoverable from the fills, which is the whole
       reason it is stored: *any component* and *arched door, which happens to be
       what is filled* produce identical fills. The slot editor needs the
       difference — one offers every wall, the other offers 54. */
    const id = placeTemplate(
      aTemplateInstance({ filters: ['component|door|arched', 'size|width|2', 'size|depth|2'] }),
    )
    expect(state().placements[id]?.filters).toEqual([
      'component|door|arched',
      'size|width|2',
      'size|depth|2',
    ])
  })

  it('defaults the position to none, which is a real choice and not an absence', () => {
    // `[]` is *any* on every axis: with no tags the slots' `constrain` blocks
    // collect nothing and the instance admits whatever its recipe does. Every
    // instance placed before this field existed was in exactly that state.
    // Placed first and read after: `state()` is a snapshot, so calling it in the
    // same expression as the placement reads the state from before it.
    const id = placeTemplate(aTemplateInstance())
    expect(state().placements[id]?.filters).toEqual([])
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

/* ------------------------------------------------ clearing and unpinning */

/**
 * Row **A11**'s two actions, and the two facts they exist for.
 *
 * `clearFill` is the only thing in the app that makes a filled slot empty
 * again — `fillSlot` and `pinFill` both write a tile — so before it a re-solve
 * that could no longer fill a slot left the previous answer in place
 * (`relock.ts`'s fourth gap, `InstanceReSolve.stale`).
 *
 * `unpinFill` is the only thing that writes `false` over a `true`, so before it
 * **the first pin made a slot permanently deaf to the lock toggle**. The test
 * named `re-exposes an unpinned slot to the lock` is the one to read: it is the
 * whole of contract C-k's missing half, and it fails by `fillSlot` returning
 * `'kept-pinned'` for a slot the user has handed back.
 */
describe('clearing and unpinning a fill', () => {
  it('clears a fill and removes the key, rather than setting it to undefined', () => {
    // The distinction the type system cannot make and three readers can:
    // `canvas/catalog.ts#parts`, `share/link.ts` and `migrations.ts#salvageFills`
    // all walk `Object.keys(fills)`, so a key holding `undefined` would draw
    // nothing, encode a `pinned` bit for no file, and fail the schema on the way
    // back in.
    const id = placeTemplate(aTemplateInstance({ fills: aFullFillMap() }))
    expect(clearFill(id, FLOOR)).toBe('cleared')

    const fills = state().placements[id]?.fills ?? {}
    expect(Object.keys(fills)).not.toContain(FLOOR)
    // `filledSlots` is `Object.keys`, so it is the one line that decides it.
    expect([...filledSlots(fills)].sort()).toEqual(['base', 'column', 'left wall', 'right wall'])
    expect(FLOOR in fills).toBe(false)
  })

  it('leaves the instance on the grid — contract C-g', () => {
    // §3.2's "places anyway": an empty slot reads *needs a choice* and the room
    // still holds the piece, so clearing is not a shorthand for removing.
    const id = placeTemplate(aTemplateInstance({ fills: aFullFillMap() }))
    clearFill(id, FLOOR)
    expect(selectPlacementCount(state())).toBe(1)
    expect(state().placements[id]?.template).toBe(A_TEMPLATE)
    expect(state().placements[id]?.fills[WALL]).toEqual({ tile: A_TILE, pinned: false })
  })

  it('clears a fill the user pinned, because clearing is the user own action', () => {
    // `clearFill` has no pinned guard and no guarded twin: the only caller is
    // the user, and emptying a slot you chose is the strongest form of "I no
    // longer want my choice". No solver clears anything — C2's `reSolveScene`
    // reports `UnfilledReport.stale` instead.
    const id = placeTemplate(aTemplateInstance({ fills: {} }))
    pinFill(id, FLOOR, A_TILE)
    expect(clearFill(id, FLOOR)).toBe('cleared')
    expect(state().placements[id]?.fills[FLOOR]).toBeUndefined()
  })

  it('is unchanged on a slot that is already empty, and wakes no subscriber', () => {
    const id = placeTemplate(aTemplateInstance({ fills: {} }))
    const before = state().placements
    expect(clearFill(id, FLOOR)).toBe('unchanged')
    expect(state().placements).toBe(before)
  })

  it('reports an unknown placement rather than writing', () => {
    const gone = 'not-on-the-grid' as PlacementId
    expect(clearFill(gone, FLOOR)).toBe('unknown-placement')
    expect(unpinFill(gone, FLOOR)).toBe('unknown-placement')
    expect(state().placements[gone]).toBeUndefined()
  })

  it('re-exposes an unpinned slot to the lock, which is C-k missing half', () => {
    // The headline. `pinFill` is a one-way door without this: nothing else in
    // the app writes `false` over a `true`, so the slot would answer
    // `'kept-pinned'` to every re-solve for the life of the room — and the lock
    // is a live preference, disagreeing about which file to print for 1,419 of
    // 3,822 items (37.1%).
    const id = placeTemplate(aTemplateInstance({ fills: {} }))
    pinFill(id, FLOOR, A_TILE)
    expect(fillSlot(id, FLOOR, ANOTHER_TILE)).toBe('kept-pinned')

    expect(unpinFill(id, FLOOR)).toBe('unpinned')

    expect(fillSlot(id, FLOOR, ANOTHER_TILE)).toBe('filled')
    expect(state().placements[id]?.fills[FLOOR]).toEqual({ tile: ANOTHER_TILE, pinned: false })
  })

  it('keeps the file when it unpins, which is the whole difference from clearing', () => {
    // Two actions rather than one with a mode, and this is the state that
    // separates them: unpinning leaves a printable file and moves only the
    // authority over it, where clearing leaves a hole that stops the pack.
    const id = placeTemplate(aTemplateInstance({ fills: {} }))
    pinFill(id, FLOOR, A_TILE)
    unpinFill(id, FLOOR)
    expect(state().placements[id]?.fills[FLOOR]).toEqual({ tile: A_TILE, pinned: false })
  })

  it('is unchanged on a slot the lock already owns, whether filled or empty', () => {
    // Both spellings of one fact — *the lock decides this slot on its next
    // pass* — which is why `UnpinOutcome` does not name them apart. `fillSlot`
    // writes to both alike, so a caller reading them apart would have nothing
    // different to do.
    const id = placeTemplate(aTemplateInstance({ fills: {} }))
    fillSlot(id, FLOOR, A_TILE)

    let before = state().placements
    expect(unpinFill(id, FLOOR)).toBe('unchanged')
    expect(state().placements).toBe(before)

    before = state().placements
    expect(unpinFill(id, WALL)).toBe('unchanged')
    expect(state().placements).toBe(before)
  })

  it('touches one slot and one instance', () => {
    const first = placeTemplate(aTemplateInstance({ fills: aFullFillMap() }))
    const second = placeTemplate(aTemplateInstance({ x: 4, fills: aFullFillMap() }))
    pinFill(first, FLOOR, A_TILE)
    const otherInstance = state().placements[second]
    const otherSlot = state().placements[first]?.fills[WALL]

    unpinFill(first, FLOOR)
    expect(state().placements[second]).toBe(otherInstance)
    expect(state().placements[first]?.fills[WALL]).toBe(otherSlot)

    clearFill(first, FLOOR)
    expect(state().placements[second]).toBe(otherInstance)
    expect(state().placements[first]?.fills[WALL]).toBe(otherSlot)
  })

  it('leaves a cleared slot absent across a persist round trip', () => {
    // The wire and the storage blob agree with the map: an absent slot is
    // already the representation of *unfilled* on both, so a cleared slot needs
    // nothing new from `share/link.ts` and no migration from `migrations.ts`.
    const id = placeTemplate(aTemplateInstance({ fills: aFullFillMap() }))
    clearFill(id, FLOOR)
    pinFill(id, WALL, A_TILE)

    const payload = storedPayload()
    resetWorkshop()
    writeStored(payload)
    void useWorkshopStore.persist.rehydrate()

    expect(state().placements[id]?.fills[FLOOR]).toBeUndefined()
    expect(FLOOR in (state().placements[id]?.fills ?? {})).toBe(false)
    expect(state().placements[id]?.fills[WALL]).toEqual({ tile: A_TILE, pinned: true })
  })

  it('lets the next re-solve fill a cleared slot, because an empty slot is not pinned', () => {
    // §2.1 read literally, and `clearFill`'s docblock states it: the lock owns
    // every slot the user has not pinned, and a slot the user emptied is not
    // pinned. So clearing is "I have taken this out and not yet said what goes
    // in", and the download refuses until then rather than for ever.
    const id = placeTemplate(aTemplateInstance({ fills: aFullFillMap() }))
    clearFill(id, FLOOR)
    expect(fillSlot(id, FLOOR, A_TILE)).toBe('filled')
    expect(state().placements[id]?.fills[FLOOR]).toEqual({ tile: A_TILE, pinned: false })
  })
})

/* --------------------------------------------------------------------- holds */

/**
 * A **hold** is a fill of a fill: the torch fitted into the socket of the wall a
 * slot is filled with.
 *
 * The three tests worth reading first are `refuses a slot with no fill` — the
 * reason `FillOutcome` grew `'unknown-slot'`, since a hold has nowhere to live
 * until the file that declares the mount is chosen; `clears the last hold to an
 * empty map` — the `undefined` / `{}` distinction the whole feature turns on,
 * because a later default-hold pass fills only the fills that were never solved;
 * and `drops the holds when the slot takes a different file` — a hold belongs to
 * the file, so a new file has different mounts and the old accessories are
 * answers to a question nobody asked.
 */
describe('holds — accessories fitted into a slot’s fill', () => {
  it('cannot carry holds of its own, by construction rather than by a check', () => {
    // `HoldFill` has no `holds` field, so Zod strips one rather than nesting it.
    // That is the whole of the depth rule: no `z.lazy`, no counter, and no
    // salvage that has to walk an unbounded tree.
    const parsed = HoldFill.parse({ tile: A_TILE, pinned: true, holds: { torch: { tile: A_TILE, pinned: true } } })
    expect(parsed).toEqual({ tile: A_TILE, pinned: true })
    expect('holds' in parsed).toBe(false)
  })

  it('refuses a slot with no fill, because a hold is a fill of that file', () => {
    // Not `'unknown-placement'`: the piece is on the grid and the caller is not
    // stale, the *slot* is simply empty — and there is no file to hang an
    // accessory on. Writing anyway would mean inventing the slot's own fill.
    const id = placeTemplate(aTemplateInstance({ fills: {} }))
    expect(fillHold(id, WALL, TORCH, A_TILE)).toBe('unknown-slot')
    expect(pinHold(id, WALL, TORCH, A_TILE)).toBe('unknown-slot')
    expect(fillHolds(id, WALL, {})).toBe('unknown-slot')
    expect(state().placements[id]?.fills[WALL]).toBeUndefined()
  })

  it('reports an unknown placement rather than writing', () => {
    const gone = 'not-on-the-grid' as PlacementId
    expect(fillHold(gone, WALL, TORCH, A_TILE)).toBe('unknown-placement')
    expect(pinHold(gone, WALL, TORCH, A_TILE)).toBe('unknown-placement')
    expect(fillHolds(gone, WALL, {})).toBe('unknown-placement')
    expect(clearHold(gone, WALL, TORCH)).toBe('unknown-placement')
    expect(unpinHold(gone, WALL, TORCH)).toBe('unknown-placement')
    expect(state().placements[gone]).toBeUndefined()
  })

  it('starts a fill out never solved, which is not the same as solved and empty', () => {
    // The absent key is the state every fill written before this field existed
    // is in, and it is what a later default-hold pass looks for.
    const id = placeTemplate(aTemplateInstance({ fills: oneFilledSlot() }))
    expect(holdsOf(id)).toBeUndefined()
    expect('holds' in (state().placements[id]?.fills[WALL] ?? {})).toBe(false)
  })

  it('fills a hold auto, and reports that it wrote', () => {
    const id = placeTemplate(aTemplateInstance({ fills: oneFilledSlot() }))
    expect(fillHold(id, WALL, TORCH, A_TILE)).toBe('filled')
    expect(holdsOf(id)).toEqual({ [TORCH]: { tile: A_TILE, pinned: false } })
    // And the slot's own fill is untouched — the file and its pin are a
    // different decision from what is fitted into it.
    expect(state().placements[id]?.fills[WALL]?.tile).toBe(A_TILE)
    expect(state().placements[id]?.fills[WALL]?.pinned).toBe(false)
  })

  it('keeps a hold the user pinned — contract C-k, one level down', () => {
    // The same refusal `fillSlot` makes, for the same reason: a default-hold
    // pass that overwrote a pinned hold would discard a deliberate choice with
    // nothing failing and nothing on screen to say so.
    const id = placeTemplate(aTemplateInstance({ fills: oneFilledSlot() }))
    expect(pinHold(id, WALL, TORCH, A_TILE)).toBe('filled')
    expect(fillHold(id, WALL, TORCH, ANOTHER_TILE)).toBe('kept-pinned')
    expect(holdsOf(id)).toEqual({ [TORCH]: { tile: A_TILE, pinned: true } })
  })

  it('lets the user override their own hold, and their own is the only thing that can', () => {
    const id = placeTemplate(aTemplateInstance({ fills: oneFilledSlot() }))
    pinHold(id, WALL, TORCH, A_TILE)
    expect(pinHold(id, WALL, TORCH, ANOTHER_TILE)).toBe('filled')
    expect(holdsOf(id)).toEqual({ [TORCH]: { tile: ANOTHER_TILE, pinned: true } })
  })

  it('is a no-op that wakes no subscriber when the hold is already what it would write', () => {
    const id = placeTemplate(aTemplateInstance({ fills: oneFilledSlot() }))
    fillHold(id, WALL, TORCH, A_TILE)
    const before = state().placements
    expect(fillHold(id, WALL, TORCH, A_TILE)).toBe('unchanged')
    expect(state().placements).toBe(before)
  })

  it('clears the last hold to an empty map, which reads as solved rather than never solved', () => {
    // The headline. `{}` is *the user took the torch out*, and a default-hold
    // pass must leave it alone; `undefined` is *nobody has looked yet*, and that
    // pass owns it. Deleting the field here would put the torch back on the next
    // reload.
    const id = placeTemplate(aTemplateInstance({ fills: oneFilledSlot() }))
    fillHold(id, WALL, TORCH, A_TILE)
    expect(clearHold(id, WALL, TORCH)).toBe('cleared')
    expect(holdsOf(id)).toEqual({})
    expect(holdsOf(id)).not.toBeUndefined()
  })

  it('leaves the other holds alone when one is cleared', () => {
    const id = placeTemplate(aTemplateInstance({ fills: oneFilledSlot() }))
    fillHold(id, WALL, TORCH, A_TILE)
    pinHold(id, WALL, DOOR, ANOTHER_TILE)
    expect(clearHold(id, WALL, TORCH)).toBe('cleared')
    expect(holdsOf(id)).toEqual({ [DOOR]: { tile: ANOTHER_TILE, pinned: true } })
  })

  it('clears a hold the user pinned, because clearing is the user’s own action', () => {
    // `clearFill`'s argument one level down: emptying a mount you chose is the
    // strongest form of "I no longer want my choice", and no solver clears.
    const id = placeTemplate(aTemplateInstance({ fills: oneFilledSlot() }))
    pinHold(id, WALL, TORCH, A_TILE)
    expect(clearHold(id, WALL, TORCH)).toBe('cleared')
    expect(holdsOf(id)).toEqual({})
  })

  it('is unchanged when the hold is not there, whether the fill was solved or never was', () => {
    // Both readings are *nothing to remove*, and neither is a caller bug worth a
    // name of its own — `clearFill` gives an already-empty slot the same answer.
    // A fill that was never solved stays never solved: clearing must not be a
    // back door that marks it solved.
    const id = placeTemplate(aTemplateInstance({ fills: oneFilledSlot() }))
    let before = state().placements
    expect(clearHold(id, WALL, TORCH)).toBe('unchanged')
    expect(state().placements).toBe(before)
    expect(holdsOf(id)).toBeUndefined()

    fillHold(id, WALL, DOOR, A_TILE)
    before = state().placements
    expect(clearHold(id, WALL, TORCH)).toBe('unchanged')
    expect(state().placements).toBe(before)
  })

  it('is unchanged on a slot that has no fill, because there is no hold to give back', () => {
    // The asymmetry with `fillHold` is deliberate: writing needs a file to write
    // *into* and says so with `'unknown-slot'`, while removing what is not there
    // has already happened.
    const id = placeTemplate(aTemplateInstance({ fills: {} }))
    const before = state().placements
    expect(clearHold(id, WALL, TORCH)).toBe('unchanged')
    expect(unpinHold(id, WALL, TORCH)).toBe('unchanged')
    expect(state().placements).toBe(before)
  })

  it('hands a pinned hold back to the solver and keeps the file', () => {
    // `unpinFill`'s difference from `clearFill`, one level down: the accessory
    // stays printable and only the authority over it moves.
    const id = placeTemplate(aTemplateInstance({ fills: oneFilledSlot() }))
    pinHold(id, WALL, TORCH, A_TILE)
    expect(fillHold(id, WALL, TORCH, ANOTHER_TILE)).toBe('kept-pinned')

    expect(unpinHold(id, WALL, TORCH)).toBe('unpinned')
    expect(holdsOf(id)).toEqual({ [TORCH]: { tile: A_TILE, pinned: false } })
    expect(fillHold(id, WALL, TORCH, ANOTHER_TILE)).toBe('filled')
  })

  it('is unchanged unpinning a hold the solver already owns', () => {
    const id = placeTemplate(aTemplateInstance({ fills: oneFilledSlot() }))
    fillHold(id, WALL, TORCH, A_TILE)
    const before = state().placements
    expect(unpinHold(id, WALL, TORCH)).toBe('unchanged')
    expect(state().placements).toBe(before)
  })

  it('drops the holds when the slot takes a different file', () => {
    // A hold is a fill of *that file*: a different wall declares different
    // mounts, so keeping the torch would hang it on a socket that may not exist.
    const id = placeTemplate(aTemplateInstance({ fills: oneFilledSlot() }))
    pinHold(id, WALL, TORCH, A_TILE)
    expect(fillSlot(id, WALL, ANOTHER_TILE)).toBe('filled')
    expect(state().placements[id]?.fills[WALL]).toEqual({ tile: ANOTHER_TILE, pinned: false })
    // Dropped to *never solved*, so the next default-hold pass fits the new
    // file's own mounts rather than treating the slot as already answered.
    expect(holdsOf(id)).toBeUndefined()
  })

  it('keeps the holds when the same file is pinned, unpinned or rewritten unchanged', () => {
    // The file is what the holds belong to, and none of these three changes it.
    // `pinFill` on the file the solver already chose is the case that would hurt
    // most: it is one press in the editor and it must not empty the sockets.
    const id = placeTemplate(aTemplateInstance({ fills: oneFilledSlot() }))
    fillHold(id, WALL, TORCH, A_TILE)
    const held = holdsOf(id)

    expect(pinFill(id, WALL, A_TILE)).toBe('filled')
    expect(holdsOf(id)).toEqual(held)

    expect(unpinFill(id, WALL)).toBe('unpinned')
    expect(holdsOf(id)).toEqual(held)

    const before = state().placements
    expect(fillSlot(id, WALL, A_TILE)).toBe('unchanged')
    expect(state().placements).toBe(before)
    expect(holdsOf(id)).toEqual(held)
  })

  it('replaces every unpinned hold and keeps the pinned ones — the solver’s wholesale write', () => {
    // One `setState` for a whole file's mounts, for `setPlacementFilters`'
    // reason: the holds of one fill are one answer, and writing them one at a
    // time would put a half-fitted wall on screen for a render. Wholesale means
    // an unpinned hold the new answer does not name is *gone*, which is how the
    // pass says "nothing fits here any more".
    const id = placeTemplate(aTemplateInstance({ fills: oneFilledSlot() }))
    pinHold(id, WALL, DOOR, A_TILE)
    fillHold(id, WALL, TORCH, A_TILE)

    expect(
      fillHolds(id, WALL, {
        [TORCH]: { tile: ANOTHER_TILE, pinned: false },
        [DOOR]: { tile: ANOTHER_TILE, pinned: false },
      }),
    ).toBe('filled')
    expect(holdsOf(id)).toEqual({
      [TORCH]: { tile: ANOTHER_TILE, pinned: false },
      // Kept, and kept *pinned*: the write is the solver's and the pin is the
      // user's.
      [DOOR]: { tile: A_TILE, pinned: true },
    })
  })

  it('keeps a pinned hold the wholesale write does not mention', () => {
    const id = placeTemplate(aTemplateInstance({ fills: oneFilledSlot() }))
    pinHold(id, WALL, DOOR, A_TILE)
    fillHold(id, WALL, TORCH, A_TILE)

    expect(fillHolds(id, WALL, {})).toBe('filled')
    // The unpinned torch is gone and the pinned door is not.
    expect(holdsOf(id)).toEqual({ [DOOR]: { tile: A_TILE, pinned: true } })
  })

  it('never writes holds back to undefined, so a solved fill stays solved', () => {
    // `fillHolds(id, slot, {})` is the pass saying *I looked and nothing fits*,
    // which is a result and not the absence of one. Writing `undefined` would
    // make the pass run again on every hydrate, for ever.
    const id = placeTemplate(aTemplateInstance({ fills: oneFilledSlot() }))
    expect(holdsOf(id)).toBeUndefined()
    expect(fillHolds(id, WALL, {})).toBe('filled')
    expect(holdsOf(id)).toEqual({})

    const before = state().placements
    expect(fillHolds(id, WALL, {})).toBe('unchanged')
    expect(state().placements).toBe(before)
  })

  it('reports kept-pinned when the pins are the only reason nothing moved', () => {
    // The count §3.3 has to disclose, at the granularity the wholesale write
    // has: a pass that wrote nothing because the user had chosen everything is
    // not the same as a pass with nothing to do.
    const id = placeTemplate(aTemplateInstance({ fills: oneFilledSlot() }))
    pinHold(id, WALL, TORCH, A_TILE)
    const before = state().placements
    expect(fillHolds(id, WALL, { [TORCH]: { tile: ANOTHER_TILE, pinned: false } })).toBe('kept-pinned')
    expect(state().placements).toBe(before)
    expect(holdsOf(id)).toEqual({ [TORCH]: { tile: A_TILE, pinned: true } })
  })

  it('rejects an unusable hold at the call that made it', () => {
    // `placeTemplate`'s reason: the wholesale write takes a caller-built map, so
    // a bad file id fails here where the stack names the culprit rather than at
    // a hydration months later where it reads as storage corruption.
    const id = placeTemplate(aTemplateInstance({ fills: oneFilledSlot() }))
    expect(() => fillHolds(id, WALL, { [TORCH]: { tile: 'nonsense' as TileId, pinned: false } })).toThrow()
    expect(holdsOf(id)).toBeUndefined()
  })

  it('touches one hold, one slot and one instance', () => {
    const first = placeTemplate(aTemplateInstance({ fills: aFullFillMap() }))
    const second = placeTemplate(aTemplateInstance({ x: 4, fills: aFullFillMap() }))
    fillHold(first, WALL, DOOR, A_TILE)
    const otherInstance = state().placements[second]
    const otherSlot = state().placements[first]?.fills[FLOOR]
    const otherHold = holdsOf(first)?.[DOOR]

    fillHold(first, WALL, TORCH, ANOTHER_TILE)

    expect(state().placements[second]).toBe(otherInstance)
    expect(state().placements[first]?.fills[FLOOR]).toBe(otherSlot)
    expect(holdsOf(first)?.[DOOR]).toBe(otherHold)
  })

  it('survives a persist round trip with the holds and their pins intact', () => {
    const id = placeTemplate(aTemplateInstance({ fills: oneFilledSlot() }))
    fillHold(id, WALL, TORCH, A_TILE)
    pinHold(id, WALL, DOOR, ANOTHER_TILE)
    // A second slot solved to nothing, which is the state a JSON round trip is
    // likeliest to lose: `{}` has to come back as `{}` rather than as absent.
    fillSlot(id, FLOOR, A_TILE)
    fillHolds(id, FLOOR, {})

    const payload = storedPayload()
    resetWorkshop()
    writeStored(payload)
    void useWorkshopStore.persist.rehydrate()

    expect(holdsOf(id)).toEqual({
      [TORCH]: { tile: A_TILE, pinned: false },
      [DOOR]: { tile: ANOTHER_TILE, pinned: true },
    })
    expect(holdsOf(id, FLOOR)).toEqual({})
  })
})

/* ------------------------------------------------------------------- filters */

describe('re-arming a placed instance', () => {
  it('writes the filters and the fills in one transaction', () => {
    /* The reason the action takes a whole map: a filter change moves the
       candidate *set*, so a room that had the filters written before the fills
       would show, for one render, an instance claiming to be one thing and
       holding another. */
    const id = placeTemplate(aTemplateInstance({ fills: aFullFillMap() }))
    const before = state().placements[id]

    expect(
      setPlacementFilters(id, ['component|door|arched'], {
        [FLOOR]: { tile: ANOTHER_TILE, pinned: false },
      }),
    ).toBe('set')

    const now = state().placements[id]
    expect(now?.filters).toEqual(['component|door|arched'])
    // Replaced wholesale, not merged: the four other slots of `aFullFillMap` are
    // gone, because a filter change can empty a slot and a merge cannot say so.
    expect([...filledSlots(now?.fills ?? {})]).toEqual([FLOOR])
    expect(before?.filters).toEqual([])
  })

  it('replaces a fill the user pinned, which no other write here may do', () => {
    /* Contract **C-k**'s one exception, and it is an exception about the
       *caller*: `template/relock.ts#reSolveInstance` decides which pins the new
       filters still admit and reports every one it drops, so this action's guard
       is deliberately absent rather than forgotten. `fillSlot` in the same
       situation returns `'kept-pinned'` and writes nothing. */
    const id = placeTemplate(aTemplateInstance({ fills: {} }))
    pinFill(id, FLOOR, A_TILE)
    expect(fillSlot(id, FLOOR, ANOTHER_TILE)).toBe('kept-pinned')

    expect(
      setPlacementFilters(id, ['component|torch'], { [FLOOR]: { tile: ANOTHER_TILE, pinned: false } }),
    ).toBe('set')
    expect(state().placements[id]?.fills[FLOOR]).toEqual({ tile: ANOTHER_TILE, pinned: false })
  })

  it('is unchanged when the position and every fill are already there, and wakes no subscriber', () => {
    // Pressing the chip an instance is already on is the common case, and this
    // action writes the whole map on every press — so the identity check matters
    // more here than it does for one slot.
    const id = placeTemplate(aTemplateInstance({ fills: aFullFillMap(), filters: ['shape|wall'] }))
    const before = state().placements
    const held = state().placements[id]?.fills ?? {}

    expect(setPlacementFilters(id, ['shape|wall'], held)).toBe('unchanged')
    expect(state().placements).toBe(before)
  })

  it('reports an unknown placement rather than writing', () => {
    const gone = 'not-on-the-grid' as PlacementId
    expect(setPlacementFilters(gone, ['shape|wall'], {})).toBe('unknown-placement')
    expect(selectPlacementCount(state())).toBe(0)
  })

  it('parses on the way in, so a malformed tag fails at the call that made it', () => {
    // `placeTemplate`'s reason: a bad value should fail where the stack still
    // names the culprit, not at a hydration months later where it reads as
    // storage corruption.
    const id = placeTemplate(aTemplateInstance({ fills: {} }))
    expect(() => setPlacementFilters(id, [''], {})).toThrow()
    expect(state().placements[id]?.filters).toEqual([])
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

/* --------------------------------------------------------------- room design */

describe('room design', () => {
  it('ships with none, and that is a decision rather than a gap', () => {
    /* `defaultWorkshopState` sets out why: the lock has a default because some
       joinery has to be printed and 99.9% reach makes one answer least-bad,
       where the top two designs reach 122 and 111 of 179 placeable parts and
       choosing between them for the user is choosing what their dungeon looks
       like. */
    expect(state().design).toBeUndefined()
    expect(selectRoomDesign(state())).toBeUndefined()
  })

  it('holds one design for the whole room', () => {
    setRoomDesign('dungeon_stone')
    expect(state().design).toBe('dungeon_stone')
    expect(selectRoomDesign(state())).toBe('dungeon_stone')
  })

  it('clears back to no design, which is one of the picker’s options', () => {
    setRoomDesign('dungeon_stone')
    setRoomDesign(undefined)
    expect(state().design).toBeUndefined()
  })

  it('has no chosen flag beside it, and does not need one', () => {
    // `lockChosen` exists because `lock === 'openlock'` cannot be told from
    // "never opened the picker". The design's shipped value is *absent*, so the
    // field answers that question by itself.
    expect('designChosen' in state()).toBe(false)
    setRoomDesign('cave')
    expect(state().lockChosen).toBe(false)
  })

  it('does not itself re-solve a fill, and this is the boundary it holds', () => {
    /* The same boundary `setLockSystem` holds, for the same reason: the repair
       is `reSolveScene` walking the slots and calling `fillSlot`, and doing it
       here would put the fill solver — and therefore the catalog — inside the
       store. `BuilderScreen` is the caller. */
    const id = placeTemplate(aTemplateInstance({ fills: {} }))
    fillSlot(id, FLOOR, A_TILE)
    const before = state().placements[id]?.fills[FLOOR]

    setRoomDesign('dungeon_stone')

    expect(state().placements[id]?.fills[FLOOR]).toBe(before)
  })

  it('survives a persist round trip', () => {
    setRoomDesign('towne')
    const payload = storedPayload()
    expect((payload?.state as WorkshopState).design).toBe('towne')

    resetWorkshop()
    expect(state().design).toBeUndefined()

    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    void useWorkshopStore.persist.rehydrate()
    expect(state().design).toBe('towne')
  })

  it('round-trips *no design* as an absent key rather than as a null', () => {
    /* `JSON.stringify` drops an `undefined` value, so the persisted blob has no
       `design` key at all — and `salvageDesign` reads an absent key as no
       preference. The two halves have to agree or a cleared design would come
       back as a `null` the schema refuses. */
    setRoomDesign('towne')
    setRoomDesign(undefined)
    const payload = storedPayload()
    expect('design' in (payload?.state as object)).toBe(false)

    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    void useWorkshopStore.persist.rehydrate()
    expect(state().design).toBeUndefined()
  })

  it('survives an export and re-import', () => {
    setRoomDesign('aztlan')
    const file = exportWorkshop()
    resetWorkshop()
    expect(importWorkshop(file)).toEqual({ ok: true, dropped: [] })
    expect(state().design).toBe('aztlan')
  })

  it('is cleared by a reset, like every other persisted field', () => {
    setRoomDesign('aztlan')
    resetWorkshop()
    expect(state().design).toBeUndefined()
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
      // Persisted like every other field. `[]` is *any* on each axis, which is
      // what this instance was placed at.
      filters: [],
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
    // it unclaimable". Row A0 deleted the library, so the palette now lists the
    // 91 templates this build ships, which no reset can clear — and a pending
    // handoff would survive "clear everything" and still be claimable.
    armTemplateInBuilder(A_PENDING_ARM)
    resetWorkshop()
    expect(claimPendingArm()).toBeNull()
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

  it('imports a file exported at the version below, because the reader climbs that rung', () => {
    // The import path asks the reader which versions it reads rather than
    // comparing against `STORE_VERSION`, so the 8 → 9 rung reaches a *file* too.
    // Without that, a room exported the day before the bump would be refused
    // while the same state in `localStorage` came back fine — which is the
    // "there is deliberately no second recovery path" claim broken in the one
    // direction a user would notice.
    const result = importWorkshop(
      JSON.stringify({
        kind: WORKSHOP_EXPORT_KIND,
        version: STORE_VERSION - 1,
        state: {
          placements: {
            keep: { id: 'keep', template: A_TEMPLATE, x: 0, z: 0, rotation: 0, fills: aFullFillMap() },
          },
          lock: 'magnetic',
        },
      }),
    )

    expect(result).toEqual({ ok: true, dropped: [] })
    expect(Object.keys(state().placements)).toEqual(['keep'])
    // A version 8 fill has no holds, and *never solved* is the right reading.
    expect(state().placements['keep' as PlacementId]?.fills[FLOOR]?.holds).toBeUndefined()
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
