// @vitest-environment jsdom
/**
 * Undo, wired to a real store.
 *
 * jsdom, because `renderHook` needs a document to mount into. Note what that
 * does *not* buy: jsdom has no WebGL context, so the surface that presses
 * `Ctrl`+`Z` still cannot be mounted, and this file's subject is the hook alone.
 *
 * **What these tests prove:** that recording happens without any call site
 * asking for it, that applying an undo does not record itself, and that the two
 * booleans a toolbar reads follow the ring. `history.ts` proves the ring's own
 * arithmetic over 17 cases and none of it is re-proved here — what is at stake
 * in this file is the *wiring*, which is the part that can be silently wrong: a
 * missing subscription looks exactly like a working one until someone presses
 * Ctrl+Z.
 *
 * **What they cannot prove:** anything about keys or buttons. `Ctrl`+`Z` reaching
 * this hook is `RoomSurface`'s listener and the toolbar's `onClick`, and jsdom
 * has no WebGL context so no test in this repo can mount the surface.
 *
 * The store is real, not a stub, and reset between tests: a subscription test
 * against a fake store would prove the fake notifies.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { fixtureFills, fixtureInstance } from '@/builder/canvas/fixture'
import type { PlacementId } from '@/store'
import { clearPlacements, placeTemplate, removePlacement, useWorkshopStore, writeSilently } from '@/store'

import { FIXTURE_IDS, FIXTURE_SLOTS, FIXTURE_TEMPLATE } from './fixture'
import { useHistory } from './useHistory'

/** Write the placements directly — the shortest way to a known starting state. */
function setPlacements(entries: readonly (readonly [string, number])[]): void {
  const placements: Record<string, ReturnType<typeof fixtureInstance>> = {}
  for (const [key, x] of entries) {
    placements[key] = fixtureInstance(key, fixtureFills([[FIXTURE_SLOTS.floor, FIXTURE_IDS.floor2]]), {
      x,
      z: 0,
      rotation: 0,
    })
  }
  useWorkshopStore.setState({ placements: placements })
}

const ids = (): string[] => Object.keys(useWorkshopStore.getState().placements).sort()

afterEach(() => {
  clearPlacements()
})

describe('recording', () => {
  it('records a mutation nothing asked it to record', () => {
    const { result } = renderHook(() => useHistory())
    expect(result.current.canUndo).toBe(false)

    act(() => {
      setPlacements([['a', 0]])
    })
    // The store write went through no code that knows this hook exists, which is
    // the whole property: a fifteenth action added tomorrow is undoable without
    // being told to be.
    expect(result.current.canUndo).toBe(true)
  })

  it('ignores a store write that does not touch the placements', () => {
    const { result } = renderHook(() => useHistory())
    act(() => {
      useWorkshopStore.setState({ lockChosen: true })
    })
    expect(result.current.canUndo).toBe(false)
  })

  it('records once per edit, not once per subscriber notification', () => {
    const { result } = renderHook(() => useHistory())
    act(() => {
      setPlacements([['a', 0]])
    })
    act(() => {
      setPlacements([['a', 0], ['b', 4]])
    })
    act(() => {
      result.current.undo()
    })
    expect(ids()).toEqual(['a'])
    act(() => {
      result.current.undo()
    })
    expect(ids()).toEqual([])
  })
})

describe('writes that are not edits', () => {
  it('records nothing for a write that declared itself silent', () => {
    const { result } = renderHook(() => useHistory())

    act(() => {
      writeSilently(() => {
        setPlacements([['a', 0]])
      })
    })

    /* The default-hold pass is the one writer that is not a gesture, and it must
       not merely avoid cluttering the ring: recorded, its write buries the
       placement it followed, because undoing it restores the unsolved fill the
       pass then re-solves — and that re-solve clears `future`. See the module
       docblock and `@/store#writeSilently`. */
    expect(result.current.canUndo).toBe(false)
  })

  it('keeps recording the edits around one', () => {
    const { result } = renderHook(() => useHistory())

    act(() => {
      setPlacements([['a', 0]])
    })
    act(() => {
      writeSilently(() => {
        setPlacements([['a', 0], ['b', 1]])
      })
    })
    act(() => {
      result.current.undo()
    })

    // The undo steps past the silent write to the state before the edit, which
    // is what "not an edit" has to mean for the stack to stay legible.
    expect(ids()).toEqual([])
  })
})

describe('applying', () => {
  it('restores the previous placements and offers the redo', () => {
    const { result } = renderHook(() => useHistory())
    act(() => {
      setPlacements([['a', 0]])
    })

    let said: string | null = null
    act(() => {
      said = result.current.undo()
    })
    expect(ids()).toEqual([])
    expect(said).toBe('Removed 1 tile.')
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(true)

    act(() => {
      said = result.current.redo()
    })
    expect(ids()).toEqual(['a'])
    expect(said).toBe('Placed 1 tile.')
  })

  it('does not record the undo it just applied', () => {
    // The loop this guards against: without the re-entrancy flag the restore is
    // itself a change to `placements`, so undo would push the pre-undo state and
    // the next undo would put it straight back — two states, for ever.
    const { result } = renderHook(() => useHistory())
    act(() => {
      setPlacements([['a', 0]])
    })
    act(() => {
      result.current.undo()
    })
    expect(result.current.canUndo).toBe(false)
    expect(ids()).toEqual([])
  })

  it('is null when there is nothing to undo or redo', () => {
    const { result } = renderHook(() => useHistory())
    expect(result.current.undo()).toBeNull()
    expect(result.current.redo()).toBeNull()
  })

  it('drops the redo stack once a fresh edit lands on top of an undo', () => {
    const { result } = renderHook(() => useHistory())
    act(() => {
      setPlacements([['a', 0]])
    })
    act(() => {
      result.current.undo()
    })
    expect(result.current.canRedo).toBe(true)

    act(() => {
      setPlacements([['b', 4]])
    })
    expect(result.current.canRedo).toBe(false)
  })

  it('undoes a removal made through the store’s own action', () => {
    // Not `setPlacements`: this is the real path a Delete takes, so it proves the
    // subscription sees the actions the app actually calls rather than only the
    // test's shortcut.
    const { result } = renderHook(() => useHistory())
    let placed: PlacementId | null = null
    act(() => {
      placed = placeTemplate({
        template: FIXTURE_TEMPLATE,
        x: 0,
        z: 0,
        rotation: 0,
        fills: fixtureFills([[FIXTURE_SLOTS.floor, FIXTURE_IDS.floor2]]),
      })
    })
    act(() => {
      removePlacement(placed as unknown as PlacementId)
    })
    expect(ids()).toEqual([])

    act(() => {
      result.current.undo()
    })
    expect(ids()).toEqual([placed])
  })
})
