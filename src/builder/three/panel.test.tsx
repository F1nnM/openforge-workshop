// @vitest-environment jsdom
/**
 * The panel: the offer, the empty room, and the fact that nothing loads unasked.
 *
 * `./BuilderRoom` is mocked, and the mock is the point rather than a
 * convenience. The real module pulls three.js, r3f, drei, `postprocessing`, n8ao
 * and the glTF loader, and **jsdom renders nothing** — there is no WebGL context
 * for `Stage` to create, so a test that mounted the real room would be asserting
 * on a failed context, not on a picture. The interesting question is not "does
 * the canvas render", it is **"is the 3D stack behind a boundary at all, and is
 * that boundary crossed on the press and not before"**. A stub standing in for
 * the whole chunk answers that.
 *
 * ## What these tests prove
 *
 *   - The heavy chunk is not requested until the button is pressed, and the
 *     button is not offered for an empty room.
 *   - The pre-press label says the meshes are not published yet, so the empty
 *     room that follows is expected rather than a surprise.
 *   - Closing unmounts the room, which is what aborts the fetches and disposes
 *     the geometries.
 *
 * ## What they cannot prove
 *
 * Anything about pixels, the WebGL context, the AO pass, the flat-shaded shader
 * or an instanced draw. Every one of those needs a GPU. The room's *own* logic —
 * grouping, matrices, absences, the budget — is tested without React in
 * `instances.test.ts` and `place.test.ts`, which is where it can be tested
 * honestly.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { FIXTURE_IDS, fixtureCatalogFile } from '@/builder/canvas/fixture'
import { planCatalogFromFile } from '@/builder/canvas'
import type { Placement, WorkshopState } from '@/store'

import { Builder3DPanel } from './Builder3DPanel'

vi.mock('./BuilderRoom', () => ({
  default: ({ onClose, placements }: { onClose: () => void; placements: Record<string, unknown> }) => (
    <div data-testid="room">
      <span>room of {Object.keys(placements).length}</span>
      <button type="button" onClick={onClose}>
        Back to the plan
      </button>
    </div>
  ),
}))

const CATALOG = planCatalogFromFile(fixtureCatalogFile())
const ASSETS = { lod: 'https://objects.openforge.tools/lod' }

function placements(count: number): WorkshopState['placements'] {
  return Object.fromEntries(
    Array.from({ length: count }, (_unused, i) => [
      `p${String(i)}`,
      { tileId: FIXTURE_IDS.floor1, x: i, z: 0, rotation: 0 } as Placement,
    ]),
  )
}

describe('with an empty plan', () => {
  it('offers the control but does not arm it', () => {
    render(<Builder3DPanel catalog={CATALOG} placements={placements(0)} assets={ASSETS} />)

    const button = screen.getByRole('button', { name: /view in 3d/i })
    expect(button).toBeDisabled()
    // A control that vanishes and reappears as tiles are placed reads as a bug
    // in the app; one that is present and says why it cannot be pressed does not.
    expect(button).toHaveTextContent('place a tile first')
    expect(screen.queryByTestId('room')).toBe(null)
  })
})

/**
 * The one structural fact behind row X10's item 8, asserted where a pixel
 * measurement cannot reach.
 *
 * A live Chrome found the right 14 px of the toolbar's `snap 0.5` button
 * unclickable, with `elementFromPoint` naming `.of-b3d-toggle-note` at those
 * columns, and the proposed one-line fix was `pointer-events: none` on the note.
 * **It would not work, and this is why:** the note is a child of the button, so
 * declining hits on it hands them to `.of-b3d-toggle` — still not to the snap
 * toggle underneath. And a flex-column child cannot spill outside its parent, so
 * the note is not overlapping anything; it *sets* the plate's width, being its
 * longest line.
 *
 * jsdom reports every element as 0 x 0 and so can say nothing about the overlap
 * itself. It can say this, which is the half that refutes the fix, and it fails
 * the day someone lifts the note out of the button — at which point the
 * `pointer-events` fix becomes available and this test is the prompt to
 * reconsider it. `builder3d.css` carries the measurement and the candidate
 * designs.
 */
describe('the closed plate, for row X10 item 8', () => {
  it('keeps the note inside the button, which is why pointer-events cannot fix the overlap', () => {
    render(<Builder3DPanel catalog={CATALOG} placements={placements(3)} assets={ASSETS} />)

    const button = screen.getByRole('button', { name: /view in 3d/i })
    const note = document.querySelector('.of-b3d-toggle-note')
    expect(note).not.toBeNull()
    expect(note?.closest('.of-b3d-toggle')).toBe(button)
    // And the note is the longest line in it, so the plate's width is the note's.
    expect(note?.textContent).toBe('preview meshes, not yet published')
    expect(button.textContent).toContain('View in 3D')
  })
})

describe('with a room', () => {
  it('says the meshes are not published before the press, not after', () => {
    render(<Builder3DPanel catalog={CATALOG} placements={placements(3)} assets={ASSETS} />)
    // Blocker B2: `/lod/` is empty. The label is where that is disclosed, so the
    // empty room behind the press is expected rather than a failure.
    expect(screen.getByRole('button', { name: /view in 3d/i })).toHaveTextContent('not yet published')
  })

  it('loads nothing until the press', async () => {
    render(<Builder3DPanel catalog={CATALOG} placements={placements(3)} assets={ASSETS} />)
    expect(screen.queryByTestId('room')).toBe(null)

    fireEvent.click(screen.getByRole('button', { name: /view in 3d/i }))
    // `await` rather than a synchronous read, and that is the boundary showing
    // through: `lazy()` resolves a dynamic import, so there is a frame where the
    // fallback is on screen. In the app that frame is a network fetch of the
    // 480 kB chunk.
    // `data-status="chunk"` is the fallback the panel already renders; no test
    // hook was added to production markup for this.
    expect(document.querySelector('[data-status="chunk"]')).not.toBeNull()
    expect(await screen.findByTestId('room')).toHaveTextContent('room of 3')
  })

  it('unmounts the room on close, which is what aborts the fetches', async () => {
    const opened: boolean[] = []
    render(
      <Builder3DPanel
        catalog={CATALOG}
        placements={placements(2)}
        assets={ASSETS}
        onOpenChange={(open) => opened.push(open)}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /view in 3d/i }))
    fireEvent.click(await screen.findByRole('button', { name: /back to the plan/i }))

    expect(opened).toEqual([true, false])
    // Gone from the tree: `useLodStore`'s effect cleanup is the only thing that
    // aborts an in-flight GLB request and disposes what arrived, so this is the
    // assertion that a misclick costs nothing beyond what had already landed.
    expect(screen.queryByTestId('room')).toBe(null)
    expect(screen.getByRole('button', { name: /view in 3d/i })).toBeEnabled()
  })
})
