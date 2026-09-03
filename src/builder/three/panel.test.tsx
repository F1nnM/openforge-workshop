// @vitest-environment jsdom
/**
 * The mount point: the boundary, and both of the states that are gone.
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
 * ## Three rows have now taken something away from this file
 *
 * The panel started as a *gate*: a plate in the corner whose button was
 * **disabled until a tile had been placed**, so the 3D view could not be reached
 * until the 2D view had been used first. Row **R2** inverted that — the owner
 * asked for the 3D view to *be* the builder — and the surface opened with the
 * screen, leaving the plate behind as a way *back* to the plan. Row **R4**
 * deleted the plan view, so there is nowhere back to go: the plate, `open`,
 * `initiallyOpen`, `onOpenChange` and `BuilderRoom`'s `onClose` are all gone and
 * this component holds no state.
 *
 * **Two suites went with them, and both were about to become vacuous rather than
 * merely redundant.** "The closed plate, which is now a way back rather than a
 * gate" mounted the panel with `initiallyOpen={false}`; delete that prop and the
 * suite either fails to compile or silently asserts against the *open* surface,
 * where `getByRole('button', { name: /build in 3d/i })` finds nothing. "Closing"
 * pressed the room stub's own "Back to the plan" button — a button the mock
 * defined, so it would have gone on passing against a production component that
 * could no longer close at all. That second one is the shape of vacuous guard
 * this series keeps finding: the test's subject lived in the test.
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
 *   - **No control offers to leave it.** Asserted as an absence, which is worth
 *     one line: it is the whole of what R4 did to this component's markup, and a
 *     re-added toggle would otherwise be caught by nothing here.
 *
 * ## What they cannot prove
 *
 * Anything about pixels, the WebGL context, the AO pass, a raycast or an
 * instanced draw. Every one of those needs a GPU. The surface's *own* logic —
 * the pick, the verdicts, the plate geometry — is tested without React in
 * `surface.test.ts`, `edits.test.ts` and `markers.test.ts`, which is where it
 * can be tested honestly. The band's clickability needs a real browser and is
 * measured there; `builder3d.css` and `screens/builder/builder.css` carry the
 * numbers.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { planCatalogFromFile } from '@/builder/canvas'
import type { PlanScene, PlanTools } from '@/builder/canvas'
import { FIXTURE_IDS, fixtureCatalogFile, fixtureDesignOf } from '@/builder/canvas/fixture'

import { Builder3DPanel } from './Builder3DPanel'
import { planTools, sceneOf } from './fixture'

vi.mock('./BuilderRoom', () => ({
  default: ({ scene, tools }: { scene: PlanScene; tools: PlanTools }) => (
    <div data-testid="room">
      <span>room of {scene.pieces.length}</span>
      <span data-testid="armed">{tools.selectedDesign ?? 'nothing'}</span>
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

describe('what row R4 took away', () => {
  it('offers no control that leaves the surface, because there is nowhere to go', async () => {
    render(<Builder3DPanel catalog={CATALOG} scene={scene(3)} tools={planTools()} assets={ASSETS} />)
    await screen.findByTestId('room')

    // The three names the retired plate and its button went by. Queried rather
    // than reasoned about, so re-adding any of them fails here — and asserted
    // after the room has arrived, so this is the *open* surface's markup and not
    // a Suspense frame that happens to contain no buttons.
    expect(screen.queryByRole('button', { name: /build in 3d/i })).toBe(null)
    expect(screen.queryByRole('button', { name: /back to the plan/i })).toBe(null)
    expect(document.querySelector('.of-b3d-toggle')).toBe(null)
    // And the surface is the stage rather than a plate in a corner of it: the
    // `[data-open]` attribute both `builder3d.css` rules used to select on is
    // gone, so a stylesheet that still carried them would style nothing.
    const launch = document.querySelector('.of-b3d-launch')
    expect(launch).not.toBeNull()
    expect(launch?.hasAttribute('data-open')).toBe(false)
  })
})
