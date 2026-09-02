// @vitest-environment jsdom
/**
 * The canvas, rendered.
 *
 * Nothing is mocked. The **real store** (so a placement really goes through
 * `placeTile`'s Zod parse and really lands in `localStorage`), the **real
 * material registry** (so a fill is a measured tint rather than a stub) and the
 * fixture catalog through the **real `CatalogFile.parse`**. The only scaffolding
 * is a harness component that calls `usePlanTools` and exposes the arming step
 * row 18's palette will own.
 *
 * Two jsdom facts shape these tests, both documented where they are relied on:
 *
 *   - jsdom reports every element as 0 × 0 and implements no `ResizeObserver`, so
 *     the canvas takes its `FALLBACK_SIZE` path and the pixel-to-unit mapping is
 *     deterministic: with the default view (`x: -2, z: -2, scale: 44`), a client
 *     point of (200, 200) is grid (2.545, 2.545).
 *   - jsdom implements neither `setPointerCapture` nor `hasPointerCapture`; the
 *     component feature-detects both.
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { TileId } from '@/catalog'
import { STORAGE_KEY, clearPersistedWorkshopState, resetWorkshop, useWorkshopStore } from '@/store'

import { planCatalogFromFile } from './catalog'
import { FIXTURE_IDS, fixtureCatalogFile } from './fixture'
import { PlanCanvas } from './PlanCanvas'
import { usePlanTools } from './usePlanTools'

const catalog = planCatalogFromFile(fixtureCatalogFile())

/** The screen row 18 will build: a palette that arms a tile, plus the canvas. */
function Harness({ initial }: { initial?: string }) {
  const tools = usePlanTools(initial === undefined ? {} : { selectedTileId: initial as TileId })
  const [status, setStatus] = useState<string>('')
  return (
    <div>
      <div>
        {Object.values(FIXTURE_IDS).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              tools.setSelectedTileId(id as TileId)
            }}
          >
            arm {id}
          </button>
        ))}
      </div>
      <PlanCanvas catalog={catalog} tools={tools} onStatus={(next) => setStatus(next.hint)} />
      <p data-testid="status">{status}</p>
    </div>
  )
}

function plan(): HTMLElement {
  return screen.getByRole('application')
}

function placements() {
  return Object.values(useWorkshopStore.getState().placements)
}

function live(): string {
  return document.querySelector('.of-plan-live')?.textContent ?? ''
}

beforeEach(() => {
  resetWorkshop()
  clearPersistedWorkshopState()
})

afterEach(() => {
  resetWorkshop()
  clearPersistedWorkshopState()
})

describe('keyboard placement', () => {
  it('places the armed tile at the cursor on Enter — the non-pointer path', () => {
    render(<Harness initial={FIXTURE_IDS.floor1} />)
    fireEvent.keyDown(plan(), { key: 'Enter' })

    expect(placements()).toEqual([{ tileId: FIXTURE_IDS.floor1, x: -0.5, z: -0.5, rotation: 0 }])
    expect(live()).toContain('Placed Dungeon stone floor 1×1')
  })

  it('moves the cursor by the snap step and announces where it is', () => {
    render(<Harness initial={FIXTURE_IDS.floor1} />)
    fireEvent.keyDown(plan(), { key: 'ArrowRight' })
    expect(live()).toContain('x 0.5, z 0')
    expect(live()).toContain('empty')

    fireEvent.keyDown(plan(), { key: 'ArrowDown' })
    expect(live()).toContain('x 0.5, z 0.5')
  })

  it('travels four steps with Shift, and a whole unit in coarse mode', () => {
    render(<Harness initial={FIXTURE_IDS.floor1} />)
    fireEvent.keyDown(plan(), { key: 'ArrowRight', shiftKey: true })
    expect(live()).toContain('x 2, z 0')

    fireEvent.keyDown(plan(), { key: 'g' })
    expect(live()).toContain('Snap 1 units')
    fireEvent.keyDown(plan(), { key: 'ArrowRight' })
    expect(live()).toContain('x 3, z 0')
  })

  it('announces the piece under the cursor once one is there', () => {
    render(<Harness initial={FIXTURE_IDS.floor2} />)
    fireEvent.keyDown(plan(), { key: 'Enter' })
    fireEvent.keyDown(plan(), { key: 'ArrowRight' })
    fireEvent.keyDown(plan(), { key: 'ArrowLeft' })
    expect(live()).toContain('Dungeon stone floor 2×2')
  })

  it('steps through the placed tiles with the bracket keys', () => {
    render(<Harness initial={FIXTURE_IDS.floor1} />)
    fireEvent.keyDown(plan(), { key: 'Enter' })
    fireEvent.keyDown(plan(), { key: 'ArrowRight' })
    fireEvent.keyDown(plan(), { key: 'ArrowRight' })
    fireEvent.keyDown(plan(), { key: 'Enter' })
    expect(placements()).toHaveLength(2)

    fireEvent.keyDown(plan(), { key: ']' })
    expect(live()).toContain('1 of 2')
    fireEvent.keyDown(plan(), { key: ']' })
    expect(live()).toContain('2 of 2')
  })

  it('removes the piece under the cursor with Delete', () => {
    render(<Harness initial={FIXTURE_IDS.floor1} />)
    fireEvent.keyDown(plan(), { key: 'Enter' })
    expect(placements()).toHaveLength(1)

    fireEvent.keyDown(plan(), { key: 'Delete' })
    expect(placements()).toEqual([])
    expect(live()).toContain('Removed Dungeon stone floor 1×1')
  })

  it('says so when there is nothing to remove', () => {
    render(<Harness initial={FIXTURE_IDS.floor1} />)
    fireEvent.keyDown(plan(), { key: 'Delete' })
    expect(live()).toContain('Nothing to remove')
  })
})

describe('place, rotate, and the store', () => {
  it('round-trips a rect through place → rotate → the store', () => {
    render(<Harness initial={FIXTURE_IDS.angled} />)
    fireEvent.keyDown(plan(), { key: 'Enter' })
    const placed = placements()[0]
    expect(placed?.rotation).toBe(0)

    fireEvent.keyDown(plan(), { key: 'r' })
    // 45, because this tile's own `size|angle` says so — not the 90 default.
    expect(placements()[0]?.rotation).toBe(45)
    expect(live()).toContain('45 degrees')
  })

  it('round-trips a wall, whose extents swap on the quarter turn', () => {
    render(<Harness initial={FIXTURE_IDS.wall2} />)
    fireEvent.keyDown(plan(), { key: 'Enter' })
    expect(placements()[0]?.tileId).toBe(FIXTURE_IDS.wall2)

    fireEvent.keyDown(plan(), { key: 'r' })
    expect(placements()[0]?.rotation).toBe(90)
    // The drawn piece is the un-turned 2 x 0.5 rectangle in its own local
    // frame, placed by the group's transform. jsdom does not lay the path out,
    // so this asserts the geometry the renderer emitted and not its appearance.
    const piece = document.querySelector('[data-band="edge"] path')
    expect(piece?.getAttribute('d')).toBe('M 0 0 H 2 V 0.5 H 0 Z')
    const group = document.querySelector('[data-band="edge"]')
    expect(group?.getAttribute('transform')).toContain('rotate(90')
  })

  it('keeps every placed coordinate on the 0.5 lattice', () => {
    render(<Harness initial={FIXTURE_IDS.wall2} />)
    fireEvent.pointerMove(plan(), { clientX: 137, clientY: 211 })
    fireEvent.pointerDown(plan(), { clientX: 137, clientY: 211, button: 0, pointerId: 1 })
    fireEvent.pointerUp(plan(), { clientX: 137, clientY: 211, button: 0, pointerId: 1 })

    const placed = placements()[0]
    expect(placed).toBeDefined()
    expect(Number.isInteger((placed?.x ?? 1) * 2)).toBe(true)
    expect(Number.isInteger((placed?.z ?? 1) * 2)).toBe(true)
  })

  it('turns the pending placement when the cursor is on empty grid', () => {
    render(<Harness initial={FIXTURE_IDS.floor2} />)
    fireEvent.keyDown(plan(), { key: 'r' })
    expect(live()).toContain('will be placed at 90 degrees')
    expect(placements()).toEqual([])

    fireEvent.keyDown(plan(), { key: 'Enter' })
    expect(placements()[0]?.rotation).toBe(90)
  })
})

describe('refusal', () => {
  it('refuses a shapeless footprint with a reason and places nothing', () => {
    render(<Harness initial={FIXTURE_IDS.shapeless} />)
    fireEvent.keyDown(plan(), { key: 'Enter' })

    expect(placements()).toEqual([])
    expect(live()).toContain('no derivable footprint')
    expect(screen.getByTestId('status').textContent).toContain('no derivable footprint')
  })

  it('places an arc rather than refusing it, and draws it as a curve', () => {
    render(<Harness initial={FIXTURE_IDS.arc} />)
    fireEvent.keyDown(plan(), { key: 'Enter' })

    expect(placements()).toHaveLength(1)
    // The drawn outline is the arc itself. jsdom measures nothing, so this
    // asserts the `d` the renderer emitted and NOT what it looks like: an `A`
    // command is present and no `<rect>` stands in for the sector.
    const piece = document.querySelector('.of-plan-pieces g path')
    expect(piece?.getAttribute('d')).toMatch(/^M 2 0 A 2 2 /)
    expect(document.querySelector('.of-plan-pieces rect')).toBeNull()
  })

  it('marks a curve whose band nobody measured, without refusing it', () => {
    render(<Harness initial={FIXTURE_IDS.arcFallback} />)
    fireEvent.focus(plan())
    // The ghost is offered, and carries the provenance mark.
    expect(document.querySelector('.of-plan-ghost[data-refused="true"]')).toBeNull()
    expect(document.querySelector('.of-plan-ghost[data-basis="fallback"]')).not.toBeNull()
    // The mark is a second channel and never the only one: the hint says it in
    // words, before the click, and the announcement repeats it after.
    expect(screen.getByTestId('status').textContent).toContain('no accepted mesh fit')

    fireEvent.keyDown(plan(), { key: 'Enter' })
    expect(placements()).toHaveLength(1)
    expect(document.querySelector('.of-plan-pieces g[data-basis="fallback"]')).not.toBeNull()
    expect(live()).toContain('Placed Cut stone convex curve 4r45')
    expect(live()).toContain('no accepted mesh fit')
  })

  it('leaves a measured curve unmarked, so the mark means something', () => {
    render(<Harness initial={FIXTURE_IDS.arc} />)
    fireEvent.keyDown(plan(), { key: 'Enter' })
    expect(document.querySelector('.of-plan-pieces g[data-basis]')).toBeNull()
  })

  it('draws a refused tile as a visible marker rather than nothing', () => {
    render(<Harness initial={FIXTURE_IDS.shapeless} />)
    fireEvent.focus(plan())
    expect(document.querySelector('.of-plan-ghost[data-refused="true"]')).not.toBeNull()
  })

  it('says so when nothing is armed', () => {
    render(<Harness />)
    fireEvent.keyDown(plan(), { key: 'Enter' })
    expect(placements()).toEqual([])
    expect(live()).toContain('No tile is armed')
  })

  it('refuses the identical placement twice over', () => {
    render(<Harness initial={FIXTURE_IDS.floor1} />)
    fireEvent.keyDown(plan(), { key: 'Enter' })
    fireEvent.keyDown(plan(), { key: 'Enter' })
    expect(placements()).toHaveLength(1)
    expect(live()).toContain('already placed')
  })
})

describe('overlap feedback', () => {
  it('marks two floors in the same square and does not block the second', () => {
    render(<Harness initial={FIXTURE_IDS.floor2} />)
    fireEvent.keyDown(plan(), { key: 'Enter' })
    fireEvent.keyDown(plan(), { key: 'ArrowRight' })
    fireEvent.keyDown(plan(), { key: 'Enter' })

    expect(placements()).toHaveLength(2)
    expect(document.querySelectorAll('[data-conflict="true"]')).toHaveLength(2)
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('2 overlapping')
  })

  it('does not mark a wall lying over a floor tile', () => {
    render(<Harness initial={FIXTURE_IDS.floor2} />)
    fireEvent.keyDown(plan(), { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: `arm ${FIXTURE_IDS.wall2}` }))
    fireEvent.keyDown(plan(), { key: 'Enter' })

    expect(placements()).toHaveLength(2)
    expect(document.querySelectorAll('[data-conflict="true"]')).toHaveLength(0)
  })
})

describe('the store is the single source of truth', () => {
  it('draws the scene from the store, not from canvas state', () => {
    const view = render(<Harness initial={FIXTURE_IDS.floor1} />)
    fireEvent.keyDown(plan(), { key: 'Enter' })
    expect(document.querySelectorAll('[data-placement-id]')).toHaveLength(1)

    // Unmount and remount: nothing the canvas held survives, and the piece is
    // still there because the placement never lived in the canvas.
    view.unmount()
    render(<Harness initial={FIXTURE_IDS.floor1} />)
    expect(document.querySelectorAll('[data-placement-id]')).toHaveLength(1)
  })

  it('survives a reload — the persisted blob rehydrates the same scene', async () => {
    render(<Harness initial={FIXTURE_IDS.floor2} />)
    fireEvent.keyDown(plan(), { key: 'Enter' })
    const before = placements()

    const stored = window.localStorage.getItem(STORAGE_KEY)
    expect(stored).toContain(FIXTURE_IDS.floor2)
    if (stored === null) throw new Error('nothing was persisted')

    // What a reload does: an empty in-memory store, then a rehydrate from the
    // blob that was on disk before it. The `setItem` in the middle is not
    // ceremony — clearing the state persists the *empty* scene, so without
    // putting the pre-reload blob back there would be nothing left to rehydrate
    // from and the test would pass for the wrong reason.
    await act(async () => {
      useWorkshopStore.setState({ placements: {} })
      window.localStorage.setItem(STORAGE_KEY, stored)
      await useWorkshopStore.persist.rehydrate()
    })

    expect(placements()).toEqual(before)
    expect(document.querySelectorAll('[data-placement-id]')).toHaveLength(1)
  })
})

describe('pointer', () => {
  it('places on click at the pointer, snapped', () => {
    render(<Harness initial={FIXTURE_IDS.floor1} />)
    fireEvent.pointerMove(plan(), { clientX: 200, clientY: 200 })
    fireEvent.pointerDown(plan(), { clientX: 200, clientY: 200, button: 0, pointerId: 1 })
    fireEvent.pointerUp(plan(), { clientX: 200, clientY: 200, button: 0, pointerId: 1 })

    // (200, 200) with the fallback size and the default view is grid 2.545, and a
    // 1 × 1 tile centred there anchors at 2.
    expect(placements()).toEqual([{ tileId: FIXTURE_IDS.floor1, x: 2, z: 2, rotation: 0 }])
  })

  it('paints along a drag without stacking duplicates', () => {
    render(<Harness initial={FIXTURE_IDS.floor1} />)
    fireEvent.pointerDown(plan(), { clientX: 200, clientY: 200, button: 0, pointerId: 1 })
    fireEvent.pointerMove(plan(), { clientX: 210, clientY: 200, button: 0, pointerId: 1 })
    fireEvent.pointerMove(plan(), { clientX: 250, clientY: 200, button: 0, pointerId: 1 })
    fireEvent.pointerUp(plan(), { clientX: 250, clientY: 200, button: 0, pointerId: 1 })

    const xs = placements().map((placement) => placement.x)
    expect(new Set(xs).size).toBe(xs.length)
    expect(xs.length).toBeGreaterThanOrEqual(2)
  })

  it('erases on click in erase mode', () => {
    render(<Harness initial={FIXTURE_IDS.floor1} />)
    fireEvent.pointerDown(plan(), { clientX: 200, clientY: 200, button: 0, pointerId: 1 })
    fireEvent.pointerUp(plan(), { clientX: 200, clientY: 200, button: 0, pointerId: 1 })
    expect(placements()).toHaveLength(1)

    fireEvent.keyDown(plan(), { key: 'e' })
    expect(plan().dataset.tool).toBe('erase')
    fireEvent.pointerDown(plan(), { clientX: 200, clientY: 200, button: 0, pointerId: 1 })
    fireEvent.pointerUp(plan(), { clientX: 200, clientY: 200, button: 0, pointerId: 1 })
    expect(placements()).toEqual([])
  })

  it('pans with Alt held rather than placing', () => {
    render(<Harness initial={FIXTURE_IDS.floor1} />)
    fireEvent.pointerDown(plan(), { clientX: 200, clientY: 200, button: 0, pointerId: 1, altKey: true })
    fireEvent.pointerMove(plan(), { clientX: 244, clientY: 200, button: 0, pointerId: 1, altKey: true })
    fireEvent.pointerUp(plan(), { clientX: 244, clientY: 200, button: 0, pointerId: 1, altKey: true })

    expect(placements()).toEqual([])
    // 44 px at the default scale is one grid unit of pan.
    expect(screen.getByRole('img').getAttribute('viewBox')).toContain('-3 -2')
  })
})

describe('accessibility surface', () => {
  it('is one tab stop with a described key map', () => {
    render(<Harness initial={FIXTURE_IDS.floor1} />)
    const application = plan()
    expect(application.tabIndex).toBe(0)
    const help = document.getElementById(application.getAttribute('aria-describedby') ?? '')
    expect(help?.textContent).toContain('Arrow keys move the plan cursor')
    expect(help?.textContent).toContain('Enter places')
  })

  it('summarises the drawing rather than inventorying it', () => {
    render(<Harness initial={FIXTURE_IDS.floor1} />)
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('An empty plan grid.')
    fireEvent.keyDown(plan(), { key: 'Enter' })
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('1 placed tiles in 1 materials')
  })

  it('states the grid unit in millimetres on the application label', () => {
    render(<Harness initial={FIXTURE_IDS.floor1} />)
    expect(plan().getAttribute('aria-label')).toContain('25.4 millimetres')
  })

  it('shows the key map when reached from the keyboard, not after a click', () => {
    render(<Harness initial={FIXTURE_IDS.floor1} />)
    expect(plan().dataset.keys).toBeUndefined()

    // Tab-style focus: no pointer was involved, so the help is offered.
    fireEvent.focus(plan())
    expect(plan().dataset.keys).toBe('on')

    // A click takes it away again — the plate sits over the drawing.
    fireEvent.pointerDown(plan(), { clientX: 200, clientY: 200, button: 0, pointerId: 1 })
    expect(plan().dataset.keys).toBeUndefined()

    // …and a keypress brings it back.
    fireEvent.keyDown(plan(), { key: 'ArrowRight' })
    expect(plan().dataset.keys).toBe('on')

    // Reaching for the mouse dismisses it again, without a click.
    fireEvent.pointerMove(plan(), { clientX: 300, clientY: 300 })
    expect(plan().dataset.keys).toBeUndefined()
  })

  it('keeps turning the same placement while the cursor stays put', () => {
    render(<Harness initial={FIXTURE_IDS.wall2} />)
    fireEvent.keyDown(plan(), { key: 'Enter' })
    fireEvent.keyDown(plan(), { key: 'r' })
    fireEvent.keyDown(plan(), { key: 'r' })
    // The wall turned twice; without a sticky target the second press would have
    // turned the ghost, because a turned wall no longer covers the point it was
    // placed at.
    expect(placements()[0]?.rotation).toBe(180)

    // Moving the cursor releases it: the next press turns the ghost.
    fireEvent.keyDown(plan(), { key: 'ArrowRight' })
    fireEvent.keyDown(plan(), { key: 'ArrowRight' })
    fireEvent.keyDown(plan(), { key: 'ArrowRight' })
    fireEvent.keyDown(plan(), { key: 'ArrowRight' })
    fireEvent.keyDown(plan(), { key: 'r' })
    expect(placements()[0]?.rotation).toBe(180)
    expect(live()).toContain('will be placed at')
  })

  it('reports the hint and the snap readout for row 18', () => {
    render(<Harness initial={FIXTURE_IDS.floor1} />)
    expect(screen.getByTestId('status').textContent).toContain('Click to place Dungeon stone floor 1×1')
    expect(document.querySelector('.of-plan-readout')?.textContent).toContain('snap 0.5')
  })
})
