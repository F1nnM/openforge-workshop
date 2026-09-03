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
 *      the same item two handoffs without a nonce.
 *   2. **Not persisted.** Nothing here reaches `localStorage`, so the store's
 *      version stamp gains nothing and an export carries no handoff.
 *   3. **Unresolved.** What goes in comes out byte-identical, whatever the lock
 *      preference is set to in between — because A6's rule 0 owns the choice of
 *      file and this channel owns the choice of item, and 37.1% of the corpus's
 *      items give those two questions different answers.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DesignId, TileId } from '@/catalog'

import { STORAGE_KEY, clearPersistedWorkshopState } from './storage'
import {
  claimPendingDesign,
  clearPendingDesign,
  selectPendingDesign,
  sendDesignToBuilder,
  useSelectionStore,
} from './selection'
import { addToLibrary, placeTile, resetWorkshop, setLockSystem, useWorkshopStore } from './workshopStore'

/**
 * Two items, spelled the way `pipeline/design.ts` mints one — `d` plus twelve
 * hex characters. Row V1 turned the channel over from files to designs; the
 * fixtures follow the real shape so the "not a file id" assertion below is a
 * real discrimination and not a comparison of two made-up strings.
 */
const DESIGN_A = DesignId.parse('d4c2a57740b65')
const DESIGN_B = DesignId.parse('d0f1a2b3c4d5e')

const pending = () => useSelectionStore.getState().pending

beforeEach(() => {
  clearPendingDesign()
  resetWorkshop()
  clearPersistedWorkshopState()
})

afterEach(() => {
  clearPendingDesign()
  resetWorkshop()
  clearPersistedWorkshopState()
})

describe('the channel', () => {
  it('starts empty, which is every render of the builder not reached through the drawer', () => {
    expect(pending()).toBeNull()
    expect(claimPendingDesign()).toBeNull()
  })

  it('hands over exactly the file that was sent', () => {
    sendDesignToBuilder(DESIGN_A)
    expect(pending()).toBe(DESIGN_A)
    expect(claimPendingDesign()).toBe(DESIGN_A)
  })

  it('is a mailbox: a claim empties it, so nothing is armed twice', () => {
    sendDesignToBuilder(DESIGN_A)
    expect(claimPendingDesign()).toBe(DESIGN_A)
    expect(pending()).toBeNull()
    expect(claimPendingDesign()).toBeNull()
  })

  it('makes the same tile sent twice two handoffs, with no nonce', () => {
    // The reason the channel clears on read rather than holding a last value: a
    // plain field would compare equal on the second press and wake no reader.
    sendDesignToBuilder(DESIGN_A)
    expect(claimPendingDesign()).toBe(DESIGN_A)
    sendDesignToBuilder(DESIGN_A)
    expect(claimPendingDesign()).toBe(DESIGN_A)
  })

  it('keeps the last press when two arrive with no claim between them', () => {
    sendDesignToBuilder(DESIGN_A)
    sendDesignToBuilder(DESIGN_B)
    expect(claimPendingDesign()).toBe(DESIGN_B)
  })

  it('can be emptied without arming anything', () => {
    sendDesignToBuilder(DESIGN_A)
    clearPendingDesign()
    expect(claimPendingDesign()).toBeNull()
  })

  it('wakes a subscriber on a send and on a claim, and on nothing else', () => {
    const seen: (DesignId | null)[] = []
    const stop = useSelectionStore.subscribe((state) => {
      seen.push(selectPendingDesign(state))
    })

    sendDesignToBuilder(DESIGN_A)
    claimPendingDesign()
    // Claiming an empty box writes nothing, so a reader that runs on every
    // render of the builder does not re-render it.
    claimPendingDesign()
    stop()

    expect(seen).toEqual([DESIGN_A, null])
  })
})

describe('what it is not', () => {
  it('is not part of the persisted state, so nothing reaches localStorage', () => {
    // The persisted store is made to write first, so the assertion is about what
    // the channel *adds* to a real blob rather than about an absent key.
    addToLibrary(DESIGN_A)
    const before = localStorage.getItem(STORAGE_KEY)
    expect(before).not.toBeNull()

    sendDesignToBuilder(DESIGN_B)

    expect(localStorage.getItem(STORAGE_KEY)).toBe(before)
    expect(before).not.toContain('pending')
  })

  it('is not part of WorkshopState, so no migration rung describes it', () => {
    sendDesignToBuilder(DESIGN_A)
    // Two stores, and the persisted one is untouched — which is why
    // `STORE_VERSION` did not move for this row.
    // `generated` is row X9's, and it *is* part of `WorkshopState` — it moved
    // `STORE_VERSION` to 3 for exactly the reason this test states. Listed here
    // rather than counted so adding a field stays a deliberate edit.
    expect(Object.keys(useWorkshopStore.getState())).toEqual([
      'library',
      'placements',
      'generated',
      'lock',
      'lockChosen',
    ])
  })

  it('survives a workshop reset, because a reset is about a scene and this is not one', () => {
    // Stated rather than assumed: `resetWorkshop` deliberately does not reach
    // into this store, and the reader's guard is what disarms a handoff whose
    // tile is no longer listed.
    sendDesignToBuilder(DESIGN_A)
    resetWorkshop()
    expect(pending()).toBe(DESIGN_A)
  })

  it('is not a placement: sending an item puts nothing on the grid', () => {
    sendDesignToBuilder(DESIGN_A)
    expect(Object.keys(useWorkshopStore.getState().placements)).toHaveLength(0)
    // Since row V4 a placement addresses the same thing the box carries, so
    // this line needs no conversion at all — which is the shape G5's original
    // argument said was impossible.
    placeTile({ design: DESIGN_A, x: 0, z: 0, rotation: 0 })
    expect(pending()).toBe(DESIGN_A)
  })
})

describe('selection against resolution', () => {
  it('is unresolved: the lock preference cannot move the file in flight', () => {
    // A6's rule 0 resolves a *placed* file to the variant the lock preference
    // wants, and `assembly.test.ts` measures the three locks disagreeing for
    // 1,419 of 3,822 items. That choice belongs to the resolver at bill time; a
    // channel that anticipated it would hand the palette a file the drawer never
    // showed, and would freeze a preference into a handoff.
    sendDesignToBuilder(DESIGN_B)
    setLockSystem('openlock')
    expect(claimPendingDesign()).toBe(DESIGN_B)

    sendDesignToBuilder(DESIGN_A)
    setLockSystem('dragonlock')
    expect(claimPendingDesign()).toBe(DESIGN_A)
  })

  it('carries an item and no number, so neither of A4’s two brands is in play', () => {
    sendDesignToBuilder(DESIGN_A)
    const claimed = claimPendingDesign()
    expect(typeof claimed).toBe('string')
    // A `DesignId` is the item — the same currency as `WorkshopState.library`'s
    // keys since row V1, and what row V3's palette rows will be keyed by. An
    // ordinal would be a `ManifestOrdinal` the reader had to re-resolve, and an
    // `AggregateAddress` names the same item but is a catalog *address* that its
    // own docblock says moves when a sibling file retires.
    expect(claimed).toBe(DESIGN_A)
    expect(DesignId.parse(claimed)).toBe(DESIGN_A)
    // And what it is *not*: nothing out of this box may parse as a catalog path,
    // because a reader that resolved one as a file would be back to freezing a
    // lock preference into a handoff.
    expect(TileId.safeParse(claimed).success).toBe(false)
  })
})
