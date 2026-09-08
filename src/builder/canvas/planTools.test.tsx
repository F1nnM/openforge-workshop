// @vitest-environment jsdom
/**
 * The tool state: what arming a family resets, and the one invariant the hook
 * exists to make unbreakable.
 *
 * `usePlanTools` had no test file of its own: every property of it was asserted
 * through a component that used it — the palette writes the arming, the toolbar
 * wrote the mode, the surface reads all of it — which is honest coverage of the
 * *wiring* and silent about the hook's own rules. Row **C5** added `armedSize`,
 * whose whole subject is a rule of that kind: it is reset when a family is
 * armed, and if it were not, a size chosen for one row would decide what a
 * different family places.
 *
 * The second block is the rule that replaced the modes. `selectedTemplate` and
 * `selected` both claim the primary button, `R` and `Delete`, and the hook
 * resolves all three ambiguities with one rule — they are **never both set** —
 * by writing one state object rather than two. That is a property of this module
 * and of nothing else: `three/fixture.ts#planTools` deliberately does *not*
 * enforce it, precisely so a reader can be tested against an impossible state,
 * so if the invariant is not asserted here it is asserted nowhere.
 *
 * `renderHook` rather than a harness component, because there is nothing to
 * render: three lines of a component would only be a place for the assertions to
 * hide.
 */
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { PlacementId, TemplateId } from '@/store'

import { usePlanTools } from './usePlanTools'

const FLOOR = 'floor-straight' as TemplateId
const WALL = 'wall-straight' as TemplateId
const TWO_BY_TWO = ['size|width|2', 'size|depth|2']
const A_PIECE = 'p0' as PlacementId
const ANOTHER_PIECE = 'p1' as PlacementId

describe('the armed size', () => {
  it('starts at `any size`, which is an empty list and a real position', () => {
    // `[]` is not an absence: with no tags the slot's `constrain` collects
    // nothing and the family admits every size, which is exactly what a user
    // who never touches the control should place at.
    const { result } = renderHook(() => usePlanTools())

    expect(result.current.armedSize).toEqual([])
  })

  it('is the position the palette wrote, in the corpus’s own spelling', () => {
    const { result } = renderHook(() => usePlanTools())

    act(() => {
      result.current.setArmedSize(TWO_BY_TWO)
    })

    expect(result.current.armedSize).toEqual(TWO_BY_TWO)
  })

  it('is dropped when a **different** family is armed', () => {
    /* The rule this file exists for. B4's size domains are per family — 350
       options over 51 families and 8 with none — so `2 x 2` carried across can
       be a size the new family's candidates do not carry, which C2 classifies
       `no-candidate` and no sibling change can reopen. The angle is reset for
       the same shape of reason, which `usePlanTools` argues at length. */
    const { result } = renderHook(() => usePlanTools())

    act(() => {
      result.current.arm(FLOOR)
    })
    act(() => {
      result.current.setArmedSize(TWO_BY_TWO)
      result.current.rotate(90)
    })
    expect(result.current.armedSize).toEqual(TWO_BY_TWO)
    expect(result.current.rotation).toBe(90)

    act(() => {
      result.current.arm(WALL)
    })

    expect(result.current.armedSize).toEqual([])
    expect(result.current.rotation).toBe(0)
  })

  it('survives arming **at** a size, which is the RECENT strip’s gesture', () => {
    /* C1's chips arm a family *and* a size, which is why `arm` takes the
       position rather than leaving the caller to write it in a second call: the
       reset above happens on the arm, so a follow-up setter would be racing it.
       A strip that came back at `any size` would drop the only part of the
       choice the user made twice. */
    const { result } = renderHook(() => usePlanTools())

    act(() => {
      result.current.arm(FLOOR, TWO_BY_TWO)
    })

    expect(result.current.selectedTemplate).toBe(FLOOR)
    expect(result.current.armedSize).toEqual(TWO_BY_TWO)
  })

  it('takes a default, so a test can arm a size without a palette', () => {
    const { result } = renderHook(() => usePlanTools({ selectedTemplate: FLOOR, armedSize: TWO_BY_TWO }))

    expect(result.current.armedSize).toEqual(TWO_BY_TWO)
  })

  it('is stable across renders that change nothing, because the surface memoises on it', () => {
    /* `RoomSurface` reads this through a ref and `BuilderRoom` memoises its
       filler on the indexes; the *tools object* is memoised here, and a new
       array identity per render would make every consumer that depends on it
       re-run. `useState` holds the same array, so this is a property of the hook
       rather than of the caller. */
    const { result, rerender } = renderHook(() => usePlanTools())
    const first = result.current.armedSize

    rerender()

    expect(result.current.armedSize).toBe(first)
  })
})

describe('arming and selecting are mutually exclusive', () => {
  it('drops the selection when a family is armed', () => {
    /* The palette's direction. Both states claim the primary button, `R` and
       `Delete`, so a builder holding both would need a tie-break per verb; one
       object holding at most one of them removes all three questions at once.
       It is also what every tile editor does — picking from the catalogue drops
       your selection. */
    const { result } = renderHook(() => usePlanTools())

    act(() => {
      result.current.select(A_PIECE)
    })
    expect(result.current.selected).toBe(A_PIECE)

    act(() => {
      result.current.arm(FLOOR)
    })

    expect(result.current.selectedTemplate).toBe(FLOOR)
    expect(result.current.selected).toBeNull()
  })

  it('disarms the palette when a piece is selected', () => {
    // The surface's direction, and it has to be asserted separately: two
    // `useState` calls agreeing by convention would pass one of these two tests
    // and fail the other, which is exactly the failure the single state object
    // makes unreachable.
    const { result } = renderHook(() => usePlanTools())

    act(() => {
      result.current.arm(FLOOR, TWO_BY_TWO)
    })
    expect(result.current.selectedTemplate).toBe(FLOOR)

    act(() => {
      result.current.select(A_PIECE)
    })

    expect(result.current.selected).toBe(A_PIECE)
    expect(result.current.selectedTemplate).toBeNull()
    // The size goes with the family it was chosen for, for the reason above:
    // a position is a list of `size|` tags and B4's domains differ per family.
    expect(result.current.armedSize).toEqual([])
  })

  it('resolves a default that names both by arming, which is `arm`’s own precedence', () => {
    // A caller error rather than a state to honour, so it is resolved the same
    // way a live `arm` resolves it. Asserted because the alternative — trusting
    // both defaults — would let a test construct the one state every reader is
    // promised is impossible.
    const { result } = renderHook(() => usePlanTools({ selectedTemplate: FLOOR, selected: A_PIECE }))

    expect(result.current.selectedTemplate).toBe(FLOOR)
    expect(result.current.selected).toBeNull()
  })

  it('keeps a selection handed in on its own', () => {
    const { result } = renderHook(() => usePlanTools({ selected: A_PIECE }))

    expect(result.current.selected).toBe(A_PIECE)
    expect(result.current.selectedTemplate).toBeNull()
  })
})

describe('the activity is a reading of those two, never a fourth state', () => {
  it('reads `idle` with nothing armed and nothing selected', () => {
    // The state the three modes could not express: `place` with nothing armed
    // told the user to click while the primary button did nothing.
    const { result } = renderHook(() => usePlanTools())

    expect(result.current.activity).toBe('idle')
  })

  it('reads `armed` from the arming alone', () => {
    const { result } = renderHook(() => usePlanTools())

    act(() => {
      result.current.arm(FLOOR)
    })

    expect(result.current.activity).toBe('armed')
  })

  it('reads `selected` from the selection alone', () => {
    const { result } = renderHook(() => usePlanTools())

    act(() => {
      result.current.select(A_PIECE)
    })

    expect(result.current.activity).toBe('selected')
  })

  it('goes back to `idle` on a disarm and on a deselect, which is what Escape does', () => {
    /* `Escape` is one key over two states — `RoomSurface` disarms if something
       is armed and deselects otherwise — and it can only be one key because
       both roads lead to the same third state. */
    const { result } = renderHook(() => usePlanTools())

    act(() => {
      result.current.arm(FLOOR)
    })
    act(() => {
      result.current.arm(null)
    })
    expect(result.current.activity).toBe('idle')

    act(() => {
      result.current.select(A_PIECE)
    })
    act(() => {
      result.current.select(null)
    })
    expect(result.current.activity).toBe('idle')
  })

  it('stays `selected` when the selection moves from one piece to another', () => {
    // `[` and `]` step the selection, which is a `select` per press; the
    // activity is a fact about *whether* there is one and must not flicker.
    const { result } = renderHook(() => usePlanTools({ selected: A_PIECE }))

    act(() => {
      result.current.select(ANOTHER_PIECE)
    })

    expect(result.current.activity).toBe('selected')
    expect(result.current.selected).toBe(ANOTHER_PIECE)
  })
})
