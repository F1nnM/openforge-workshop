// @vitest-environment jsdom
//
// jsdom, because the sharpest assertion in this file is a *negative* one about
// `localStorage`: the selection channel must leave no trace in the persisted
// blob. That needs a real storage object for the persisted store to write to.
/**
 * The selection channel — row G5.
 *
 * Three properties, and each one is a decision the module's docblock argues for
 * rather than a detail of the implementation:
 *
 *   1. **One-shot.** A claim empties the box, which is what makes two presses of
 *      the same tile two handoffs without a nonce.
 *   2. **Not persisted.** Nothing here reaches `localStorage`, so the store's
 *      version ladder gains no rung and an export carries no handoff.
 *   3. **Unresolved.** What goes in comes out byte-identical, whatever the lock
 *      preference is set to in between — because A6's rule 0 owns the choice of
 *      file and this channel owns the choice of tile, and 37.1% of the corpus's
 *      items give those two questions different answers.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { TileId } from '@/catalog'

import { STORAGE_KEY, clearPersistedWorkshopState } from './storage'
import {
  claimPendingTile,
  clearPendingTile,
  selectPendingTile,
  sendTileToBuilder,
  useSelectionStore,
} from './selection'
import { addToLibrary, placeTile, resetWorkshop, setLockSystem, useWorkshopStore } from './workshopStore'

const TILE_A = TileId.parse('tiles/dungeon_stone/floor/2x2/openlock/dungeon_stone%2x2.openlock.stl')
const TILE_B = TileId.parse('tiles/dungeon_stone/floor/2x2/dragonlock/dungeon_stone%2x2.dragonlock.stl')

const pending = () => useSelectionStore.getState().pending

beforeEach(() => {
  clearPendingTile()
  resetWorkshop()
  clearPersistedWorkshopState()
})

afterEach(() => {
  clearPendingTile()
  resetWorkshop()
  clearPersistedWorkshopState()
})

describe('the channel', () => {
  it('starts empty, which is every render of the builder not reached through the drawer', () => {
    expect(pending()).toBeNull()
    expect(claimPendingTile()).toBeNull()
  })

  it('hands over exactly the file that was sent', () => {
    sendTileToBuilder(TILE_A)
    expect(pending()).toBe(TILE_A)
    expect(claimPendingTile()).toBe(TILE_A)
  })

  it('is a mailbox: a claim empties it, so nothing is armed twice', () => {
    sendTileToBuilder(TILE_A)
    expect(claimPendingTile()).toBe(TILE_A)
    expect(pending()).toBeNull()
    expect(claimPendingTile()).toBeNull()
  })

  it('makes the same tile sent twice two handoffs, with no nonce', () => {
    // The reason the channel clears on read rather than holding a last value: a
    // plain field would compare equal on the second press and wake no reader.
    sendTileToBuilder(TILE_A)
    expect(claimPendingTile()).toBe(TILE_A)
    sendTileToBuilder(TILE_A)
    expect(claimPendingTile()).toBe(TILE_A)
  })

  it('keeps the last press when two arrive with no claim between them', () => {
    sendTileToBuilder(TILE_A)
    sendTileToBuilder(TILE_B)
    expect(claimPendingTile()).toBe(TILE_B)
  })

  it('can be emptied without arming anything', () => {
    sendTileToBuilder(TILE_A)
    clearPendingTile()
    expect(claimPendingTile()).toBeNull()
  })

  it('wakes a subscriber on a send and on a claim, and on nothing else', () => {
    const seen: (TileId | null)[] = []
    const stop = useSelectionStore.subscribe((state) => {
      seen.push(selectPendingTile(state))
    })

    sendTileToBuilder(TILE_A)
    claimPendingTile()
    // Claiming an empty box writes nothing, so a reader that runs on every
    // render of the builder does not re-render it.
    claimPendingTile()
    stop()

    expect(seen).toEqual([TILE_A, null])
  })
})

describe('what it is not', () => {
  it('is not part of the persisted state, so nothing reaches localStorage', () => {
    // The persisted store is made to write first, so the assertion is about what
    // the channel *adds* to a real blob rather than about an absent key.
    addToLibrary(TILE_A)
    const before = localStorage.getItem(STORAGE_KEY)
    expect(before).not.toBeNull()

    sendTileToBuilder(TILE_B)

    expect(localStorage.getItem(STORAGE_KEY)).toBe(before)
    expect(before).not.toContain('pending')
  })

  it('is not part of WorkshopState, so no migration rung describes it', () => {
    sendTileToBuilder(TILE_A)
    // Two stores, and the persisted one is untouched — which is why
    // `STORE_VERSION` did not move for this row.
    expect(Object.keys(useWorkshopStore.getState())).toEqual([
      'library',
      'placements',
      'lock',
      'lockChosen',
    ])
  })

  it('survives a workshop reset, because a reset is about a scene and this is not one', () => {
    // Stated rather than assumed: `resetWorkshop` deliberately does not reach
    // into this store, and the reader's guard is what disarms a handoff whose
    // tile is no longer listed.
    sendTileToBuilder(TILE_A)
    resetWorkshop()
    expect(pending()).toBe(TILE_A)
  })

  it('is not a placement: sending a tile puts nothing on the grid', () => {
    sendTileToBuilder(TILE_A)
    expect(Object.keys(useWorkshopStore.getState().placements)).toHaveLength(0)
    placeTile({ tileId: TILE_A, x: 0, z: 0, rotation: 0 })
    expect(pending()).toBe(TILE_A)
  })
})

describe('selection against resolution', () => {
  it('is unresolved: the lock preference cannot move the file in flight', () => {
    // A6's rule 0 resolves a *placed* file to the variant the lock preference
    // wants, and `assembly.test.ts` measures the three locks disagreeing for
    // 1,419 of 3,822 items. That choice belongs to the resolver at bill time; a
    // channel that anticipated it would hand the palette a file the drawer never
    // showed, and would freeze a preference into a handoff.
    sendTileToBuilder(TILE_B)
    setLockSystem('openlock')
    expect(claimPendingTile()).toBe(TILE_B)

    sendTileToBuilder(TILE_A)
    setLockSystem('dragonlock')
    expect(claimPendingTile()).toBe(TILE_A)
  })

  it('carries a file and no number, so neither of A4’s two brands is in play', () => {
    sendTileToBuilder(TILE_A)
    const claimed = claimPendingTile()
    expect(typeof claimed).toBe('string')
    // A `TileId` is the catalog path — the same currency as `Placement.tileId`
    // and as `PaletteRow.record.id`, which is what the palette arms. An ordinal
    // would be a `ManifestOrdinal` the reader had to re-resolve, and an
    // `AggregateAddress` names an item rather than a printable file.
    expect(claimed).toBe(TILE_A)
    expect(TileId.parse(claimed)).toBe(TILE_A)
  })
})
