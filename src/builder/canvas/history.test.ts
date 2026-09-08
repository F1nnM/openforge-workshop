/**
 * The undo ring, headless.
 *
 * **What these tests prove:** that the ring is a linear undo model and behaves
 * like one at its four edges — that an undo hands back the previous map and
 * offers the current one as a redo, that both directions report `null` rather
 * than a silent no-op when their stack is empty, that the fifty-first record
 * drops the *oldest* entry and leaves the stack at exactly
 * {@link HISTORY_DEPTH} (both halves matter: a stack that capped by refusing the
 * newest entry would also be fifty long), and that a fresh edit abandons the
 * redo branch instead of leaving it to be applied on top of a different
 * lineage.
 *
 * They also pin every sentence {@link describeChange} can produce, including the
 * multi-category one, because that sentence is a user-visible string with no
 * type protecting it — and because its whole justification is that it cannot
 * drift from what happened, which is only true if something asserts the mapping.
 * The pair that carries the most weight is the two "no change" cases: an
 * instance object that is *identical* and a distinct object that is *deeply
 * equal on the fields that matter* must both read as unchanged, since the second
 * is what a rehydrated or share-decoded map looks like and reporting it as a
 * room-wide change would be both wrong and alarming.
 *
 * **What they cannot prove:** anything about *when* a record happens. There is
 * no store and no React here — whether a store mutation reaches {@link record}
 * exactly once, and whether an applied undo is kept from recording itself by the
 * re-entrancy flag, is `useHistory.test.ts`'s question and is the half of undo
 * that can actually go wrong in wiring. Nor do they prove the keybindings or the
 * toolbar's disabled states; those read `canUndo`/`canRedo`, which are derived
 * from the stack lengths asserted here.
 */
import { describe, expect, it } from 'vitest'

import type { TemplateInstance } from '@/store'

import { FIXTURE_IDS, FIXTURE_SLOTS, OTHER_FIXTURE_TEMPLATE, fixtureFills, fixtureInstance } from './fixture'
import type { Placements } from './history'
import { EMPTY_HISTORY, HISTORY_DEPTH, describeChange, record, redo, undo } from './history'

/** A one-slot fill map, so an instance differing only in its fill is expressible. */
function floorFill(tile: string): TemplateInstance['fills'] {
  return fixtureFills([[FIXTURE_SLOTS.floor, tile]])
}

/**
 * A placement map from instances, keyed by each instance's own `id`.
 *
 * Keyed off the value rather than from a parallel list of keys, which is
 * `src/store/schema.ts`'s *"the key wins"* rule honoured in a fixture: a helper
 * that let the two disagree would let a test pass against a shape nothing in the
 * app can produce.
 */
function plan(...instances: readonly TemplateInstance[]): Placements {
  const placements: Placements = {}
  for (const instance of instances) placements[instance.id] = instance
  return placements
}

/** A single-piece plan whose floor tile sits at `x`, for telling snapshots apart. */
function at(x: number): Placements {
  return plan(fixtureInstance('a', floorFill(FIXTURE_IDS.floor1), { x }))
}

describe('the ring', () => {
  it('hands back the previous placements, and offers the current ones as redo', () => {
    const history = record(EMPTY_HISTORY, at(0))
    const undone = undo(history, at(1))
    expect(undone?.placements).toEqual(at(0))
    expect(undone?.history.past).toHaveLength(0)
    expect(undone?.history.future).toHaveLength(1)

    const redone = redo(undone?.history ?? EMPTY_HISTORY, at(0))
    expect(redone?.placements).toEqual(at(1))
    expect(redone?.history.past).toHaveLength(1)
    expect(redone?.history.future).toHaveLength(0)
  })

  it('is null when there is nothing to undo', () => {
    expect(undo(EMPTY_HISTORY, at(0))).toBeNull()
  })

  it('is null when there is nothing to redo', () => {
    expect(redo(record(EMPTY_HISTORY, at(0)), at(1))).toBeNull()
  })

  it('drops the oldest entry past the depth', () => {
    let history = EMPTY_HISTORY
    for (let i = 0; i <= HISTORY_DEPTH; i += 1) history = record(history, at(i))
    expect(history.past).toHaveLength(HISTORY_DEPTH)
    // The *oldest* went, not the newest: `at(0)` is gone, `at(1)` is now the
    // bottom of the stack and the last edit made is still on top.
    expect(history.past[0]).toEqual(at(1))
    expect(history.past[HISTORY_DEPTH - 1]).toEqual(at(HISTORY_DEPTH))
  })

  it('discards the redo stack when a fresh edit is recorded', () => {
    const undone = undo(record(EMPTY_HISTORY, at(0)), at(1))
    expect(undone?.history.future).toHaveLength(1)
    expect(record(undone?.history ?? EMPTY_HISTORY, at(0)).future).toHaveLength(0)
  })

  it('leaves the history it was given alone', () => {
    const history = record(EMPTY_HISTORY, at(0))
    undo(history, at(1))
    expect(history.past).toHaveLength(1)
    expect(EMPTY_HISTORY.past).toHaveLength(0)
  })

  it('snapshots the map, so a later write to it cannot rewrite the past', () => {
    const only = fixtureInstance('a', floorFill(FIXTURE_IDS.floor1))
    const live = plan(only)
    const history = record(EMPTY_HISTORY, live)
    delete live[only.id]
    expect(Object.keys(live)).toHaveLength(0)
    expect(Object.keys(history.past[0] ?? {})).toHaveLength(1)
  })
})

describe('describeChange', () => {
  it('names an addition', () => {
    expect(describeChange({}, at(0))).toBe('Placed 1 tile.')
  })

  it('pluralises a multi-tile addition', () => {
    const three = plan(
      fixtureInstance('a', floorFill(FIXTURE_IDS.floor1)),
      fixtureInstance('b', floorFill(FIXTURE_IDS.floor1), { x: 1 }),
      fixtureInstance('c', floorFill(FIXTURE_IDS.floor1), { x: 2 }),
    )
    expect(describeChange({}, three)).toBe('Placed 3 tiles.')
  })

  it('names a removal', () => {
    expect(describeChange(at(0), {})).toBe('Removed 1 tile.')
  })

  it('names a change to a tile that stayed', () => {
    expect(describeChange(at(0), at(1))).toBe('Changed 1 tile.')
  })

  it('counts a re-templated piece and a re-filled slot as changes', () => {
    const templated = plan(
      fixtureInstance('a', floorFill(FIXTURE_IDS.floor1), { template: OTHER_FIXTURE_TEMPLATE }),
    )
    expect(describeChange(at(0), templated)).toBe('Changed 1 tile.')

    const refilled = plan(fixtureInstance('a', floorFill(FIXTURE_IDS.floor2)))
    expect(describeChange(at(0), refilled)).toBe('Changed 1 tile.')

    const emptied = plan(fixtureInstance('a', {}))
    expect(describeChange(at(0), emptied)).toBe('Changed 1 tile.')
  })

  it('says nothing changed when nothing did', () => {
    expect(describeChange(at(0), at(0))).toBe('No change.')
  })

  it('says nothing changed when the instances are rebuilt but equivalent', () => {
    // Distinct objects with equal fields — what a rehydration or a share-link
    // decode produces. An identity-only comparison would call this a change.
    const before = at(2)
    const after = at(2)
    expect(Object.values(before)[0]).not.toBe(Object.values(after)[0])
    expect(describeChange(before, after)).toBe('No change.')
  })

  it('says nothing changed for two empty maps', () => {
    expect(describeChange({}, {})).toBe('No change.')
  })

  it('reports every category that changed in one sentence, in a fixed order', () => {
    const before = plan(
      fixtureInstance('kept', floorFill(FIXTURE_IDS.floor1)),
      fixtureInstance('moved', floorFill(FIXTURE_IDS.floor1), { x: 1 }),
      fixtureInstance('turned', floorFill(FIXTURE_IDS.floor1), { x: 2 }),
      fixtureInstance('gone', floorFill(FIXTURE_IDS.floor1), { x: 3 }),
    )
    const after = plan(
      fixtureInstance('kept', floorFill(FIXTURE_IDS.floor1)),
      fixtureInstance('moved', floorFill(FIXTURE_IDS.floor1), { x: 9 }),
      fixtureInstance('turned', floorFill(FIXTURE_IDS.floor1), { x: 2, rotation: 90 }),
      fixtureInstance('new1', floorFill(FIXTURE_IDS.floor2), { x: 4 }),
      fixtureInstance('new2', floorFill(FIXTURE_IDS.floor2), { x: 5 }),
      fixtureInstance('new3', floorFill(FIXTURE_IDS.floor2), { x: 6 }),
    )
    expect(describeChange(before, after)).toBe('Placed 3 tiles, removed 1 tile, changed 2 tiles.')
  })

  it('joins two categories without naming the third', () => {
    const before = plan(fixtureInstance('a', floorFill(FIXTURE_IDS.floor1)))
    const after = plan(fixtureInstance('b', floorFill(FIXTURE_IDS.floor1), { x: 1 }))
    expect(describeChange(before, after)).toBe('Placed 1 tile, removed 1 tile.')
  })
})
