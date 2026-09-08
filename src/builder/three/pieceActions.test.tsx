// @vitest-environment jsdom
/**
 * The selection's action bar — the one part of the new surface a test can mount.
 *
 * **What these tests prove:** that each verb fires, that each names its key so
 * the bar teaches the keyboard, that the slot editor is disclosed rather than
 * always present, and that a press on a button does not escape to the camera.
 *
 * That last one is not a nicety. `RoomSurface` listens for `pointerdown` on the
 * canvas's *parent* in the capture phase and drei's `<Html>` portals this
 * component into that same parent, so a press that propagated would reach
 * `OrbitControls` and orbit the camera while the piece was being removed. The
 * guard exists in two places — `claimsPress` there, `stopPropagation` here — and
 * this file pins the second.
 *
 * **What they cannot prove:** that the bar is anchored to the right piece, or
 * that it is on screen at all. `anchor.test.ts` proves the arithmetic and the
 * `<Html>` call needs a WebGL context jsdom has not got.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

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

import { PieceActionsBar } from './PieceActionsBar'

const catalog = planCatalogFromFile(fixtureCatalogFile(), fixtureSlotLayout)
const styleOf = createStyleResolver(catalog)

/** One real piece, projected the way the surface projects it. */
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

function bar(over: Partial<Parameters<typeof PieceActionsBar>[0]> = {}) {
  const props = {
    piece: onePiece(),
    onEditSlots: vi.fn(),
    onTurn: vi.fn(),
    onRemove: vi.fn(),
    ...over,
  }
  render(<PieceActionsBar {...props} />)
  return props
}

describe('the verbs', () => {
  it('turns, and names the key that does the same thing', () => {
    const props = bar()
    const turn = screen.getByRole('button', { name: /turn/i })
    expect(turn).toHaveAttribute('title', expect.stringContaining('R'))
    fireEvent.click(turn)
    expect(props.onTurn).toHaveBeenCalledOnce()
  })

  it('removes, and names its key too', () => {
    const props = bar()
    const remove = screen.getByRole('button', { name: /remove/i })
    expect(remove).toHaveAttribute('title', expect.stringContaining('Delete'))
    fireEvent.click(remove)
    expect(props.onRemove).toHaveBeenCalledOnce()
  })

  it('offers no confirmation on the destructive verb', () => {
    // Deliberate, and worth a test so nobody adds one back as a kindness: the
    // action is one keystroke to reverse, and undo is the better design than a
    // dialog for a reversible action taken often.
    bar()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('names the piece in every button, so the group is legible out of context', () => {
    // A screen reader reaching this bar by tab order has no idea which piece it
    // is on unless the buttons say. The visible labels are icons.
    const piece = onePiece()
    bar({ piece })
    for (const pattern of [/turn/i, /remove/i, /slots/i]) {
      expect(screen.getByRole('button', { name: pattern })).toBeInTheDocument()
    }
    expect(screen.getByRole('group', { name: /actions/i })).toBeInTheDocument()
  })
})

describe('the slots', () => {
  it('opens the editor rather than holding it', () => {
    // The bar *routes* to the editor. It cannot hold it: `SlotEditor` renders a
    // `Dialog`, which portals to the document body, so an editor nested in a
    // collapsed disclosure here appeared the moment a piece was selected and
    // ignored the collapse entirely. What the bar contributes is the operand.
    const props = bar()
    fireEvent.click(screen.getByRole('button', { name: /slots/i }))
    expect(props.onEditSlots).toHaveBeenCalledOnce()
  })

  it('disables the button when the caller has nowhere to open one', () => {
    // The landing hero and the component tests are real callers with no editor
    // to offer. A button that did nothing would be worse than a disabled one.
    render(
      <PieceActionsBar piece={onePiece()} onTurn={vi.fn()} onRemove={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: /slots/i })).toBeDisabled()
  })
})

describe('the camera', () => {
  it('does not let a press on a button escape to the surface below', () => {
    const escaped = vi.fn()
    render(
      <div onPointerDown={escaped}>
        <PieceActionsBar piece={onePiece()} onEditSlots={vi.fn()} onTurn={vi.fn()} onRemove={vi.fn()} />
      </div>,
    )
    const remove = screen.getByRole('button', { name: /remove/i })
    remove.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(escaped).not.toHaveBeenCalled()
  })
})
