// @vitest-environment jsdom
/**
 * The tool state, and specifically the two things arming a family resets.
 *
 * `usePlanTools` had no test file of its own: every property of it was asserted
 * through a component that used it — the palette writes the selection, the
 * toolbar writes the mode, the surface reads all of them — which is honest
 * coverage of the *wiring* and silent about the hook's own rules. Row **C5**
 * added `armedSize`, whose whole subject is a rule of that kind: it is reset when
 * a family is armed, and if it were not, a size chosen for one row would decide
 * what a different family places.
 *
 * `renderHook` rather than a harness component, because there is nothing to
 * render: three lines of a component would only be a place for the assertions to
 * hide.
 */
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { TemplateId } from '@/store'

import { usePlanTools } from './usePlanTools'

const FLOOR = 'floor-straight' as TemplateId
const WALL = 'wall-straight' as TemplateId
const TWO_BY_TWO = ['size|width|2', 'size|depth|2']

describe('the armed size', () => {
  it('starts at `any size`, which is an empty list and a real position', () => {
    // `[]` is not an absence: with no tags the slot's `constrain` collects
    // nothing and the family admits every size, which is exactly what a user
    // who never touches the control should place at.
    const { result } = renderHook(() => usePlanTools())

    expect(result.current.armedPosition).toEqual([])
  })

  it('is the position the palette wrote, in the corpus’s own spelling', () => {
    const { result } = renderHook(() => usePlanTools())

    act(() => {
      result.current.setArmedPosition('size', TWO_BY_TWO)
    })

    expect(result.current.armedPosition).toEqual(TWO_BY_TWO)
  })

  it('is dropped when a **different** family is armed', () => {
    /* The rule this file exists for. The size domains are per row — 303
       positions over 47 families with 7 having none, and an assembly's own
       domain on top — so `2 x 2` carried across can be a size the new row's
       candidates do not carry, which C2 classifies `no-candidate` and no sibling
       change can reopen. Since the recipe fold the same is true of a *component*:
       carrying an arched door onto a corner arms a tag that row cannot express.
       The angle is reset for the same shape of reason, which `usePlanTools`
       argues at length. */
    const { result } = renderHook(() => usePlanTools())

    act(() => {
      result.current.setSelectedTemplate(FLOOR)
    })
    act(() => {
      result.current.setArmedPosition('size', TWO_BY_TWO)
      result.current.rotate(90)
    })
    expect(result.current.armedPosition).toEqual(TWO_BY_TWO)
    expect(result.current.rotation).toBe(90)

    act(() => {
      result.current.setSelectedTemplate(WALL)
    })

    expect(result.current.armedPosition).toEqual([])
    expect(result.current.rotation).toBe(0)
  })

  it('survives arming **at** a size, which is the RECENT strip’s gesture', () => {
    /* C1's chips arm a family *and* a size, as two calls in order — which only
       works if the reset above happens on the arm and not after it. A strip that
       came back at `any size` would drop the only part of the choice the user
       made twice. */
    const { result } = renderHook(() => usePlanTools())

    act(() => {
      result.current.setSelectedTemplate(FLOOR)
      result.current.setArmedPosition('size', TWO_BY_TWO)
    })

    expect(result.current.selectedTemplate).toBe(FLOOR)
    expect(result.current.armedPosition).toEqual(TWO_BY_TWO)
  })

  it('keeps one axis when another is chosen, so a component does not clear a size', () => {
    /* What the per-axis setter is for. Before the recipe fold there was one axis
       and one list; three axes sharing a single setter would make every control
       responsible for re-sending the other two, and the first one to forget
       would silently drop a choice the user had made. */
    const { result } = renderHook(() => usePlanTools())

    act(() => {
      result.current.setSelectedTemplate(WALL)
    })
    act(() => {
      result.current.setArmedPosition('size', TWO_BY_TWO)
    })
    act(() => {
      result.current.setArmedPosition('component', ['component|door|arched'])
    })

    expect(result.current.armedPosition).toEqual(
      expect.arrayContaining([...TWO_BY_TWO, 'component|door|arched']),
    )
    expect(result.current.armedPosition).toHaveLength(3)

    // And arming a different row still clears every axis at once.
    act(() => {
      result.current.setSelectedTemplate(FLOOR)
    })
    expect(result.current.armedPosition).toEqual([])
  })

  it('takes a default, so a test can arm a size without a palette', () => {
    const { result } = renderHook(() => usePlanTools({ selectedTemplate: FLOOR, armedPosition: TWO_BY_TWO }))

    expect(result.current.armedPosition).toEqual(TWO_BY_TWO)
  })

  it('is stable across renders that change nothing, because the surface memoises on it', () => {
    /* `RoomSurface` reads this through a ref and `BuilderRoom` memoises its
       filler on the indexes; the *tools object* is memoised here, and a new
       array identity per render would make every consumer that depends on it
       re-run. `useState` holds the same array, so this is a property of the hook
       rather than of the caller. */
    const { result, rerender } = renderHook(() => usePlanTools())
    const first = result.current.armedPosition

    rerender()

    expect(result.current.armedPosition).toBe(first)
  })
})
