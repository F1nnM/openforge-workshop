// @vitest-environment jsdom
//
// jsdom, because the sharpest assertion in this file is a *negative* one about
// `localStorage`: the selection channel must leave no trace in the persisted
// blob. That needs a real storage object for the persisted store to write to.
/**
 * The selection channel — row G5, re-aimed by row C1.
 *
 * Four properties, and each one is a decision the module's docblock argues for
 * rather than a detail of the implementation:
 *
 *   1. **One-shot.** A claim empties the box, which is what makes two presses of
 *      the same tile two handoffs without a nonce.
 *   2. **Not persisted.** Nothing here reaches `localStorage`, so the store's
 *      version stamp gains nothing and an export carries no handoff.
 *   3. **Unresolved.** What goes in comes out unchanged, whatever the lock
 *      preference is set to in between — because A6's rule 0 owns the choice of
 *      *file* and this channel owns the choice of *family*, and 37.1% of the
 *      corpus's items give those two questions different answers.
 *   4. **Actionable, which is row C1's whole change.** The box used to hold a
 *      `DesignId`; a placement is a template family with a fill per slot, so
 *      nothing downstream could act on one. It now holds the arm the palette
 *      writes: a `TemplateId` and one size position's tags.
 *
 * The arms below are spelled as literals rather than imported from
 * `builder/panels/families.ts`, for the reason `schema.ts#TemplateId` gives at
 * length: `@/store` must not reach a screen, and a test of this closure must not
 * either, or the boundary is only as strong as the test's imports. That the ids
 * are real ones this build ships — and that `size` holds a real position of the
 * family — is asserted where the table lives, in
 * `builder/panels/palette.corpus.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { TileId } from '@/catalog'

import { A_TEMPLATE, aTemplateInstance } from './fixture'
import { STORAGE_KEY, clearPersistedWorkshopState } from './storage'
import type { PendingArm } from './selection'
import {
  armTemplateInBuilder,
  claimPendingArm,
  clearPendingArm,
  selectPendingArm,
  useSelectionStore,
} from './selection'
import { TemplateId } from './schema'
import { placeTemplate, resetWorkshop, setLockSystem, useWorkshopStore } from './workshopStore'

/** A generated family, at one position of its size control. */
const ARM_A: PendingArm = {
  template: TemplateId.parse('floor-straight'),
  size: ['size|width|2', 'size|depth|2'],
}

/** A second family, at `any size` — the position every family carries. */
const ARM_B: PendingArm = { template: TemplateId.parse('wall-straight-separate-wall'), size: [] }

const pending = () => useSelectionStore.getState().pending

beforeEach(() => {
  clearPendingArm()
  resetWorkshop()
  clearPersistedWorkshopState()
})

afterEach(() => {
  clearPendingArm()
  resetWorkshop()
  clearPersistedWorkshopState()
})

describe('the channel', () => {
  it('starts empty, which is every render of the builder not reached through the drawer', () => {
    expect(pending()).toBeNull()
    expect(claimPendingArm()).toBeNull()
  })

  it('hands over exactly the arm that was sent, by identity', () => {
    armTemplateInBuilder(ARM_A)
    // The same object, not a copy: the reader is a `useSyncExternalStore`
    // subscriber, so a fresh object on every read would re-render the palette on
    // every unrelated store write.
    expect(pending()).toBe(ARM_A)
    expect(claimPendingArm()).toBe(ARM_A)
  })

  it('is a mailbox: a claim empties it, so nothing is armed twice', () => {
    armTemplateInBuilder(ARM_A)
    expect(claimPendingArm()).toBe(ARM_A)
    expect(pending()).toBeNull()
    expect(claimPendingArm()).toBeNull()
  })

  it('makes the same family sent twice two handoffs, with no nonce', () => {
    // The reason the channel clears on read rather than holding a last value: a
    // plain field would compare equal on the second press and wake no reader.
    armTemplateInBuilder(ARM_A)
    expect(claimPendingArm()).toBe(ARM_A)
    armTemplateInBuilder(ARM_A)
    expect(claimPendingArm()).toBe(ARM_A)
  })

  it('keeps the last press when two arrive with no claim between them', () => {
    armTemplateInBuilder(ARM_A)
    armTemplateInBuilder(ARM_B)
    expect(claimPendingArm()).toBe(ARM_B)
  })

  it('can be emptied without arming anything', () => {
    armTemplateInBuilder(ARM_A)
    clearPendingArm()
    expect(claimPendingArm()).toBeNull()
  })

  it('wakes a subscriber on a send and on a claim, and on nothing else', () => {
    const seen: (PendingArm | null)[] = []
    const stop = useSelectionStore.subscribe((state) => {
      seen.push(selectPendingArm(state))
    })

    armTemplateInBuilder(ARM_A)
    claimPendingArm()
    // Claiming an empty box writes nothing, so a reader that runs on every
    // render of the builder does not re-render it.
    claimPendingArm()
    stop()

    expect(seen).toEqual([ARM_A, null])
  })

  it('carries a size position, including the empty one, unchanged', () => {
    // `[]` is `any size` — a real position and not a missing selection: with no
    // size chosen the slot's `constrain` block collects nothing and the family
    // admits every size. So there is no third state for a reader to confuse
    // "chose any size" with.
    armTemplateInBuilder(ARM_B)
    expect(claimPendingArm()?.size).toEqual([])

    armTemplateInBuilder(ARM_A)
    expect(claimPendingArm()?.size).toEqual(['size|width|2', 'size|depth|2'])
  })
})

describe('what it is not', () => {
  it('is not part of the persisted state, so nothing reaches localStorage', () => {
    // The persisted store is made to write first, so the assertion is about what
    // the channel *adds* to a real blob rather than about an absent key.
    placeTemplate(aTemplateInstance())
    const before = localStorage.getItem(STORAGE_KEY)
    expect(before).not.toBeNull()

    armTemplateInBuilder(ARM_B)

    expect(localStorage.getItem(STORAGE_KEY)).toBe(before)
    expect(before).not.toContain('pending')
  })

  it('is not part of WorkshopState, so no migration rung describes it', () => {
    armTemplateInBuilder(ARM_A)
    // Two stores, and the persisted one is untouched — which is why
    // `STORE_VERSION` did not move for this row.
    // `generated` is row X9's, and it *is* part of `WorkshopState` — it moved
    // `STORE_VERSION` to 3 for exactly the reason this test states. Listed here
    // rather than counted so adding a field stays a deliberate edit.
    expect(Object.keys(useWorkshopStore.getState())).toEqual(['placements', 'generated', 'lock', 'lockChosen'])
  })

  it('is cleared by a workshop reset — contract C-f, and it inverts row G5', () => {
    // **This assertion used to be the opposite one**, and the argument it rested
    // on was the library: `resetWorkshop` did not reach into this store because
    // "a reset that emptied the library disarms the handoff by making it
    // unclaimable", the palette holding no placeable row for an item nobody had
    // saved.
    //
    // Row A0 deleted the library and row A1 deleted the field. The palette lists
    // the 91 templates this build ships (§3.1) — a function of the bundle, which
    // no reset touches — so the old mechanism is gone and a pending handoff
    // would survive "clear everything" *and stay claimable*. Row C1 makes that
    // sharper rather than milder: the arm is now something the reader can act
    // on, so the first render of the builder after a reset really would arm it.
    armTemplateInBuilder(ARM_A)
    resetWorkshop()
    expect(pending()).toBeNull()
  })

  it('is not a placement: arming a family puts nothing on the grid', () => {
    armTemplateInBuilder(ARM_A)
    expect(Object.keys(useWorkshopStore.getState().placements)).toHaveLength(0)
    // Row V4 had made the box and a placement address the same thing; row A1
    // parted them again, and row C1 joined them at the *family* rather than at
    // the item: what is in the box is what `placeTemplate` names, plus the size
    // a fill will be chosen at. Placing still does not consume the handoff — the
    // palette's claim does.
    placeTemplate(aTemplateInstance())
    expect(pending()).toBe(ARM_A)
  })

  it('is not a fill: nothing in the box names a file', () => {
    // The property row C1 had to keep while changing the box's kind. A fill
    // names an exact file (D1) and the lock preference chooses which; a family
    // and a size have no file in them, so there is nothing here for a preference
    // to freeze.
    armTemplateInBuilder(ARM_A)
    const claimed = claimPendingArm()
    expect(claimed).not.toBeNull()
    expect(TileId.safeParse(claimed?.template).success).toBe(false)
    for (const tag of claimed?.size ?? []) expect(TileId.safeParse(tag).success).toBe(false)
  })
})

describe('selection against resolution', () => {
  it('is unresolved: the lock preference cannot move what is in flight', () => {
    // A6's rule 0 resolves a *placed* file to the variant the lock preference
    // wants, and `assembly.test.ts` measures the three locks disagreeing for
    // 1,419 of 3,822 items. That choice belongs to the resolver at bill time; a
    // channel that anticipated it would hand the palette a file the drawer never
    // showed, and would freeze a preference into a handoff.
    armTemplateInBuilder(ARM_B)
    setLockSystem('openlock')
    expect(claimPendingArm()).toBe(ARM_B)

    armTemplateInBuilder(ARM_A)
    setLockSystem('dragonlock')
    expect(claimPendingArm()).toBe(ARM_A)
  })

  it('carries a template id and no number, so neither of A4’s two brands is in play', () => {
    armTemplateInBuilder({ template: A_TEMPLATE, size: [] })
    const claimed = claimPendingArm()
    expect(typeof claimed?.template).toBe('string')
    // A `TemplateId` is what a placement names. An ordinal would be a
    // `ManifestOrdinal` the reader had to re-resolve, and an `AggregateAddress`
    // names an item — which is exactly what row C1 took *out* of this box,
    // because the palette lists no items.
    expect(claimed?.template).toBe(A_TEMPLATE)
    expect(TemplateId.parse(claimed?.template)).toBe(A_TEMPLATE)
  })
})
