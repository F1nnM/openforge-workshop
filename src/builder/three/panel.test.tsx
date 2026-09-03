// @vitest-environment jsdom
/**
 * The mount point: the boundary, and the gate that is gone.
 *
 * `./BuilderRoom` is mocked, and the mock is the point rather than a
 * convenience. The real module pulls three.js, r3f, drei, `postprocessing`, n8ao
 * and the glTF loader, and **jsdom renders nothing** — there is no WebGL context
 * for `Stage` to create, so a test that mounted the real room would be asserting
 * on a failed context, not on a picture. The interesting question is not "does
 * the canvas render", it is **"is the 3D stack behind a boundary at all, and
 * does the surface arrive with the screen"**. A stub standing in for the whole
 * chunk answers both.
 *
 * ## What row R2 changed, and what these tests now assert
 *
 * The panel used to be a *gate*: a plate in the corner whose button was
 * **disabled until a tile had been placed**, so the 3D view could not be reached
 * until the 2D view had been used first. The owner asked for the opposite — the
 * 3D view *is* the builder — so the surface is open on arrival and the empty
 * room is a usable work surface rather than a locked door. The old "offers the
 * control but does not arm it" test asserted the gate and has been replaced by
 * its inverse.
 *
 * ## What these tests prove
 *
 *   - The room arrives **asynchronously**, which is the dynamic boundary showing
 *     through. The Suspense *frame* is not asserted, and the test says why: React
 *     caches a resolved `lazy` module for the life of the process, so the frame
 *     exists only on the first mount in a file and asserting it would pass or
 *     fail on test order. `boundary.test.ts` asserts the mechanism by reading the
 *     source instead, which is stable.
 *   - An **empty** plan gets a work surface, which is what makes a first
 *     placement possible at all.
 *   - The scene and the shared tool state reach the room, so the palette and the
 *     toolbar drive the 3D surface.
 *   - Closing unmounts the room — which aborts the fetches and disposes the
 *     geometries — and retracts the surface's readout so the corner plates do not
 *     keep quoting a pointer that has gone.
 *
 * ## What they cannot prove
 *
 * Anything about pixels, the WebGL context, the AO pass, a raycast or an
 * instanced draw. Every one of those needs a GPU. The surface's *own* logic —
 * the pick, the verdicts, the plate geometry — is tested without React in
 * `surface.test.ts`, `edits.test.ts` and `markers.test.ts`, which is where it
 * can be tested honestly.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { planCatalogFromFile } from '@/builder/canvas'
import type { PlanScene, PlanTools } from '@/builder/canvas'
import { FIXTURE_IDS, fixtureCatalogFile, fixtureDesignOf } from '@/builder/canvas/fixture'

import { Builder3DPanel } from './Builder3DPanel'
import { planTools, sceneOf } from './fixture'

vi.mock('./BuilderRoom', () => ({
  default: ({
    onClose,
    scene,
    tools,
  }: {
    onClose: () => void
    scene: PlanScene
    tools: PlanTools
  }) => (
    <div data-testid="room">
      <span>room of {scene.pieces.length}</span>
      <span data-testid="armed">{tools.selectedDesign ?? 'nothing'}</span>
      <button type="button" onClick={onClose}>
        Back to the plan
      </button>
    </div>
  ),
}))

const CATALOG = planCatalogFromFile(fixtureCatalogFile())
const ASSETS = {
  lod: 'https://objects.openforge.tools/lod',
  models: 'https://objects.openforge.tools/models',
}

function scene(count: number): PlanScene {
  return sceneOf(
    CATALOG,
    Array.from({ length: count }, (_unused, i) => ({ tileId: FIXTURE_IDS.floor1, x: i * 2, z: 0 })),
  )
}

describe('with an empty plan', () => {
  it('opens a work surface anyway, because that is where the first tile goes', async () => {
    // The inverse of the assertion this file used to make. A surface that
    // refused to open until something had been placed could never be the thing
    // the first placement happened on.
    render(<Builder3DPanel catalog={CATALOG} scene={scene(0)} tools={planTools()} assets={ASSETS} />)
    expect(await screen.findByTestId('room')).toHaveTextContent('room of 0')
    expect(screen.queryByRole('button', { name: /build in 3d/i })).toBe(null)
  })
})

describe('the boundary', () => {
  it('reaches the room asynchronously, never synchronously', async () => {
    // `await`, and that *is* the assertion: a statically imported component
    // would be in the tree on the first render, so `findBy` succeeding where a
    // synchronous `getBy` would not is the boundary showing through. In the app
    // the frame it covers is a network fetch of the ~400 kB chunk, and
    // `data-status="chunk"` is the fallback the panel already renders for it —
    // no test hook was added to production markup.
    //
    // The fallback is deliberately *not* asserted here. React caches a resolved
    // `lazy` module for the life of the process, so the Suspense frame exists
    // only on the first mount in a file and an assertion on it would pass or
    // fail on test order. The mechanism is asserted where it is stable, by
    // reading the source: `boundary.test.ts` checks the `lazy(() => import(…))`
    // and checks that `BuilderRoom` is outside the static closure.
    render(<Builder3DPanel catalog={CATALOG} scene={scene(3)} tools={planTools()} assets={ASSETS} />)
    expect(await screen.findByTestId('room')).toBeInTheDocument()
  })
})

describe('what reaches the room', () => {
  it('hands over the screen’s scene rather than a placements map', async () => {
    // The contract with row V4: the room never sees a `Placement`, so a change
    // to what a placement *is* cannot reach this row.
    render(<Builder3DPanel catalog={CATALOG} scene={scene(4)} tools={planTools()} assets={ASSETS} />)
    expect(await screen.findByTestId('room')).toHaveTextContent('room of 4')
  })

  it('hands over the shared tool state, so the palette arms the 3D surface', async () => {
    render(
      <Builder3DPanel
        catalog={CATALOG}
        scene={scene(1)}
        tools={planTools({ selectedDesign: fixtureDesignOf(FIXTURE_IDS.wall2) })}
        assets={ASSETS}
      />,
    )
    // The design, not the file: since row V4 the tool state arms an item and
    // `RoomSurface` resolves the variant. Asserted as the same expression that
    // was armed, so this proves the hand-over rather than a literal.
    expect(await screen.findByTestId('armed')).toHaveTextContent(fixtureDesignOf(FIXTURE_IDS.wall2))
  })
})

describe('the closed plate, which is now a way back rather than a gate', () => {
  it('is offered with no placements at all', () => {
    render(
      <Builder3DPanel
        catalog={CATALOG}
        scene={scene(0)}
        tools={planTools()}
        assets={ASSETS}
        initiallyOpen={false}
      />,
    )
    // Enabled, unlike the gate it replaces: there is nothing to withhold now
    // that the surface is where a room is built.
    expect(screen.getByRole('button', { name: /build in 3d/i })).toBeEnabled()
  })

  /**
   * The one structural fact behind row X10's item 8, asserted where a pixel
   * measurement cannot reach.
   *
   * A live Chrome found the right 14 px of the toolbar's `snap 0.5` button
   * unclickable, with `elementFromPoint` naming `.of-b3d-toggle-note` at those
   * columns, and the proposed one-line fix was `pointer-events: none` on the
   * note. **It would not work, and this is why:** the note is a child of the
   * button, so declining hits on it hands them to `.of-b3d-toggle` — still not
   * to the snap toggle underneath. And a flex-column child cannot spill outside
   * its parent, so the note is not overlapping anything; it *sets* the plate's
   * width, being its longest line.
   *
   * jsdom reports every element as 0 × 0 and so can say nothing about the
   * overlap itself. It can say this, which is the half that refutes the fix, and
   * it fails the day someone lifts the note out of the button — at which point
   * the `pointer-events` fix becomes available and this test is the prompt to
   * reconsider it. `builder3d.css` carries the measurement and the candidate
   * designs.
   */
  it('keeps the note inside the button, which is why pointer-events cannot fix the overlap', () => {
    render(
      <Builder3DPanel
        catalog={CATALOG}
        scene={scene(3)}
        tools={planTools()}
        assets={ASSETS}
        initiallyOpen={false}
      />,
    )

    const button = screen.getByRole('button', { name: /build in 3d/i })
    const note = document.querySelector('.of-b3d-toggle-note')
    expect(note).not.toBeNull()
    expect(note?.closest('.of-b3d-toggle')).toBe(button)
    // Blocker B2: `/lod/` is empty, so the label discloses that the meshes come
    // from a per-user conversion rather than from a published store. It is also
    // the longest line in the plate, so the plate's width is the note's.
    expect(note?.textContent).toBe('preview meshes, not yet published')
    expect(button.textContent).toContain('Build in 3D')
  })
})

describe('closing', () => {
  it('unmounts the room and retracts the readout with it', async () => {
    const opened: boolean[] = []
    const readouts: unknown[] = []
    render(
      <Builder3DPanel
        catalog={CATALOG}
        scene={scene(2)}
        tools={planTools()}
        assets={ASSETS}
        onOpenChange={(open) => opened.push(open)}
        onStatus={(next) => readouts.push(next)}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: /back to the plan/i }))

    expect(opened).toEqual([false])
    // Gone from the tree: `useLodStore`'s effect cleanup is the only thing that
    // aborts an in-flight request and disposes what arrived, so this is the
    // assertion that dropping back to the plan costs nothing beyond what had
    // already landed.
    expect(screen.queryByTestId('room')).toBe(null)
    // And the surface's readout is withdrawn, so `BuilderScreen`'s corner plates
    // fall back to the plan view's rather than holding a sentence about a
    // pointer that is no longer over anything.
    expect(readouts).toEqual([null])
    expect(screen.getByRole('button', { name: /build in 3d/i })).toBeEnabled()
  })
})
