// @vitest-environment jsdom
/**
 * The armed label — what the next click will place, and how to stop.
 *
 * **What these tests prove:** that the label names the family, that it always
 * states both ways out, that it names the blocker when there is one, and that it
 * takes no pointer events.
 *
 * That last one is the reason this file exists rather than the label being left
 * to the browser check that found the need for it. The label **follows the
 * cursor**, so a pointer event it swallowed would be swallowed on every click —
 * the one gesture the whole surface is built around. A regression there would
 * not look like a broken label; it would look like a builder that had stopped
 * placing tiles.
 *
 * **What they cannot prove:** that it is positioned at the ghost. That is the
 * `<Html>` call in `RoomSurface`, and jsdom has no WebGL context.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { buildPlanScene, createStyleResolver, planCatalogFromFile } from '@/builder/canvas'
import type { ScenePiece } from '@/builder/canvas'
import {
  FIXTURE_IDS,
  FIXTURE_SLOTS,
  fixtureCatalogFile,
  fixtureFills,
  fixtureInstance,
  fixtureSlotLayout,
} from '@/builder/canvas/fixture'
import type { PlacementId } from '@/store'

import { ArmedLabel } from './ArmedLabel'

const catalog = planCatalogFromFile(fixtureCatalogFile(), fixtureSlotLayout)
const styleOf = createStyleResolver(catalog)

function onePiece(): ScenePiece {
  const scene = buildPlanScene(
    {
      ['a' as PlacementId]: fixtureInstance('a', fixtureFills([[FIXTURE_SLOTS.floor, FIXTURE_IDS.floor2]]), {
        x: 0,
        z: 0,
        rotation: 0,
      }),
    },
    catalog,
    styleOf,
  )
  const piece = scene.pieces[0]
  if (piece === undefined) throw new Error('the fixture scene drew no piece')
  return piece
}

describe('the armed label', () => {
  it('names what the next click will place', () => {
    render(<ArmedLabel name="Fixture corner" />)
    expect(screen.getByText('Fixture corner')).toBeInTheDocument()
  })

  it('always states both ways out', () => {
    /*
      The gap this whole component closes. `Escape` disarmed before it existed
      and nothing said so, so a user who armed a family by accident had a ghost
      following their pointer, a primary button that placed on the next click,
      and no visible way to stop.

      Both are asserted because both are load-bearing for different users: the
      key is the one a keyboard user has, and the gesture is the one someone
      whose hand is already on the mouse will reach for.
    */
    render(<ArmedLabel name="Fixture corner" />)
    expect(screen.getByText('Esc')).toBeInTheDocument()
    expect(screen.getByText(/right-click to cancel/i)).toBeInTheDocument()
  })

  it('names the blocker when the placement would be refused', () => {
    // Duplicated from the hint plate on purpose: the plate carries the full
    // sentence with the cell, and this carries the verdict at the cursor, where
    // a user who is about to press will actually see it.
    render(<ArmedLabel name="Fixture corner" blocked={[onePiece()]} />)
    expect(screen.getByText(/is in the way/)).toBeInTheDocument()
  })

  it('says nothing about blocking when nothing blocks', () => {
    render(<ArmedLabel name="Fixture corner" blocked={[]} />)
    expect(screen.queryByText(/is in the way/)).not.toBeInTheDocument()
  })

  it('marks itself blocked for the styling, so colour is not the only signal', () => {
    // The ghost greys and this greys with it; the attribute is what lets the two
    // read as one statement rather than as two independent cues.
    const { container } = render(<ArmedLabel name="Fixture corner" blocked={[onePiece()]} />)
    expect(container.querySelector('.of-armed-label')).toHaveAttribute('data-blocked', 'true')
  })

  it('takes no pointer events, because it sits under the cursor', () => {
    /*
      **The assertion that matters most here.** The label follows the pointer, so
      anything it captured would be captured on every click. Asserted through the
      class rather than through a computed style, because jsdom does not load the
      stylesheet — what is being pinned is that the element still carries the hook
      `actions.css` hangs `pointer-events: none` on, so a rename cannot silently
      drop it.
    */
    const { container } = render(<ArmedLabel name="Fixture corner" />)
    expect(container.querySelector('.of-armed-label')).toBeInTheDocument()
    // And no interactive element inside it — a control here would be unclickable
    // by construction, which is why the cancel affordance is stated, not offered.
    expect(container.querySelectorAll('button, a, input')).toHaveLength(0)
  })
})
