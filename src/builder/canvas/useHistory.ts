/**
 * Undo and redo, wired to the store by subscription rather than by discipline.
 *
 * ## Why a subscription and not a call at each mutation
 *
 * The obvious wiring is a `record()` beside every store write. It is also the
 * wiring that rots: `workshopStore.ts` exports fourteen actions that touch
 * `placements` — place, move, rotate, remove, clear, fill, clear a fill, pin,
 * unpin, and the generated-base counterparts — and the floating action bar adds
 * more. Every one of them would have to remember, forever, and the failure mode
 * of forgetting is silent: a gesture that simply cannot be undone, discovered by
 * a user rather than by a test.
 *
 * So nothing at the call sites changes. This hook subscribes to the store and
 * records **the value that was there before** on every change to `placements`.
 * Any mutation of that map, from any action, present or future, is undoable by
 * construction. That is the same argument `history.ts` makes for holding
 * snapshots instead of inverse commands, applied one layer out: the property
 * being bought is *"you cannot forget"*, twice.
 *
 * ## The re-entrancy guard, and why it is a ref
 *
 * Applying an undo is itself a write to `placements`, so the subscription would
 * record it and the next undo would restore what was just undone — a two-state
 * loop. {@link applying} suppresses recording for exactly the duration of the
 * restore.
 *
 * It is a `useRef` and not state because it must be true *during* the
 * synchronous `restorePlacements` call. Zustand notifies subscribers
 * synchronously inside `setState`, so a state update — which React batches and
 * applies after the handler returns — would be read as `false` by the listener
 * it exists to silence.
 *
 * ## What is *not* covered, stated rather than left to be discovered
 *
 * The `generated` map. A generated base owns a mesh hold (`retainGeneratedMeshes`),
 * so restoring that map means reconciling holds as well, and a restore that
 * dropped one would free a mesh under a piece still on the plan or leak one under
 * a piece no longer there. `restorePlacements` says the same thing from the
 * store's end. Every gesture the selection model added is a catalog placement, so
 * the gap is real but narrow, and it is a row of its own rather than a bug.
 *
 * ## Re-rendering
 *
 * The ring lives in a ref, because no component renders *from* it — what
 * components read is {@link UndoControls.canUndo} and `canRedo`, two booleans.
 * Those are kept in state so a toolbar button enables and disables, and they are
 * the only reason this hook renders at all: a forty-piece room's history is forty
 * snapshots and zero re-renders beyond those two flags changing.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { restorePlacements, useWorkshopStore } from '@/store'

import type { History, Placements } from './history'
import { EMPTY_HISTORY, describeChange, record, redo, undo } from './history'

/** What a screen needs to offer undo and redo. */
export interface UndoControls {
  readonly canUndo: boolean
  readonly canRedo: boolean
  /**
   * Undo one edit, and return the sentence describing what changed.
   *
   * `null` when there was nothing to undo, so a caller can distinguish *"undid
   * nothing because the stack is empty"* from *"undid something that happened to
   * change nothing"* — which `describeChange` reports as `'No change.'` and is a
   * real outcome, not an error.
   */
  undo: () => string | null
  /** Redo one undone edit. `null` when there is nothing to redo. */
  redo: () => string | null
}

export function useHistory(): UndoControls {
  const history = useRef<History>(EMPTY_HISTORY)
  const applying = useRef(false)
  const [depths, setDepths] = useState({ past: 0, future: 0 })

  const publish = useCallback(() => {
    setDepths({ past: history.current.past.length, future: history.current.future.length })
  }, [])

  useEffect(() => {
    let previous = useWorkshopStore.getState().placements
    return useWorkshopStore.subscribe((state) => {
      const next = state.placements
      // Identity, not equality: the store replaces the map wholesale on every
      // write and never mutates it in place, so a changed identity is exactly a
      // changed map. A deep comparison here would cost a walk of the room on
      // every unrelated store write — a lock change, a room rename — for an
      // answer identity already gives.
      if (next === previous) return
      const before = previous
      previous = next
      if (applying.current) return
      history.current = record(history.current, before)
      publish()
    })
  }, [publish])

  const apply = useCallback(
    (step: typeof undo) => (): string | null => {
      const current = useWorkshopStore.getState().placements
      const result = step(history.current, current)
      if (result === null) return null
      history.current = result.history
      applying.current = true
      try {
        restorePlacements(result.placements)
      } finally {
        // `finally`, so a throw inside the store write cannot leave recording
        // suppressed for the rest of the session — which would silently disable
        // undo rather than reporting anything.
        applying.current = false
      }
      publish()
      return describeChange(current, result.placements)
    },
    [publish],
  )

  return {
    canUndo: depths.past > 0,
    canRedo: depths.future > 0,
    undo: apply(undo),
    redo: apply(redo),
  }
}

/** The ring's own type, re-exported so a test can name what it inspects. */
export type { History, Placements }
