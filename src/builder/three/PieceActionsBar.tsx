/**
 * The verbs, on the selected piece — the floating contextual toolbar.
 *
 * ## Why the verbs are here rather than only on the keyboard
 *
 * The keys existed before the selection did: `R` turned, `Delete` removed, and a
 * right click opened the slot editor. What none of them had was an
 * **affordance** — nothing on screen said the verbs existed, so the builder was
 * discoverable only by reading the key help. The pattern this borrows is the
 * contextual toolbar a 2D editor puts over a selection (Figma, Miro) and its 3D
 * relative, the app bar Microsoft's mixed-reality guidance pairs with
 * affordance-based manipulation — which that guidance recommends *"because it
 * provides a high level of granularity"* where precision matters, against
 * grabbing the object directly.
 *
 * Every button names its key, so the bar teaches the keyboard rather than
 * competing with it. That is the whole reason the `kbd` is not decorative: a
 * user who finds `⟳` here should end up pressing `R`.
 *
 * ## It carries the slot editor too, and the right column stays the bill
 *
 * The alternative was an inspector in the right-hand column, which is where a
 * DCC editor would put it. It was rejected for a specific cost: that column is
 * the bill of tiles, and a bill that disappeared whenever a piece was selected
 * would take away the one view of *what this room will cost to print* exactly
 * when the user is changing it. So the properties come to the work instead, and
 * the bill is never displaced.
 *
 * What that buys beyond the column: the slots are edited **at the piece they
 * belong to**. `SlotsPanel`'s list could only identify a piece by name, and a
 * room with four `Fixture corner`s in it made that a guess.
 *
 * ## Pointer events stop here
 *
 * `RoomSurface` listens for `pointerdown` on the canvas's **parent** in the
 * capture phase, and drei's `<Html>` portals this component into that same
 * parent. Two things therefore have to be true, and both are:
 *
 *   1. `RoomSurface` ignores presses whose target is not the canvas —
 *      `selection.ts#claimsPress`, and it is written as a fix for the *class*
 *      rather than for this component.
 *   2. This root stops propagation anyway. Belt to that brace, and it is the
 *      half that survives someone moving the portal: a press on a button must
 *      never also reach `OrbitControls`, or clicking `Remove` orbits the camera
 *      while the piece disappears.
 */
import { useState } from 'react'

import type { ScenePiece } from '@/builder/canvas'
import { pieceName } from '@/builder/canvas'
import { Button, VisuallyHidden } from '@/ui/primitives'

import './actions.css'

export interface PieceActionsBarProps {
  /** The selected piece. The bar exists only while there is one. */
  readonly piece: ScenePiece
  /**
   * Builds the slot editor for {@link piece}, and takes the callback that
   * collapses this disclosure.
   *
   * A render prop rather than a node, and the boundary is the reason:
   * `SlotEditor` lives in `builder/panels/slots/`, on the far side of the line
   * `builder/panels/boundary.test.ts` keeps, so this component must not import
   * it. The caller composes it and this holds the space.
   *
   * `close` is passed *down* rather than the open state being lifted up,
   * because the disclosure belongs to this bar: the editor's own dismiss should
   * collapse the section, not drop the selection and take the whole bar with
   * it. Absent when the caller has no editor to offer, which leaves a two-verb
   * bar rather than a broken third button.
   */
  readonly renderSlots?: (piece: ScenePiece, close: () => void) => React.ReactNode
  readonly onTurn: () => void
  readonly onRemove: () => void
}

export function PieceActionsBar({ piece, renderSlots, onTurn, onRemove }: PieceActionsBarProps) {
  const [open, setOpen] = useState(false)
  const name = pieceName(piece)
  const close = () => {
    setOpen(false)
  }

  return (
    <div
      className="of-piece-actions"
      role="group"
      aria-label={`${name} — actions`}
      // See the docblock: never let a press on a button reach the camera.
      onPointerDown={(event) => {
        event.stopPropagation()
      }}
    >
      <div className="of-piece-actions-row">
        <Button
          size="sm"
          onClick={onTurn}
          title={`Turn ${name} — R`}
        >
          <span aria-hidden="true">⟳</span>
          <VisuallyHidden>Turn {name}</VisuallyHidden>
          <kbd className="of-build-key" aria-hidden="true">
            R
          </kbd>
        </Button>

        <Button
          size="sm"
          disabled={renderSlots === undefined}
          onClick={() => {
            setOpen((current) => !current)
          }}
          aria-expanded={open}
          title={`Choose the parts of ${name} — Enter`}
        >
          <span aria-hidden="true">▤</span>
          <span>Slots</span>{' '}
          <VisuallyHidden>of {name}</VisuallyHidden>
        </Button>

        <Button
          size="sm"
          onClick={onRemove}
          title={`Remove ${name} — Delete`}
        >
          <span aria-hidden="true">⌦</span>
          <VisuallyHidden>Remove {name}</VisuallyHidden>
          {/*
            No confirmation, deliberately. The action is one keystroke to
            reverse — `history.ts`'s ring covers every mutation of the placement
            map — and undo is the better design than a dialog for a reversible
            action the user takes often.
          */}
          <kbd className="of-build-key" aria-hidden="true">
            ⌫
          </kbd>
        </Button>
      </div>

      {/*
        `hidden` rather than a conditional render, so the editor's own state — a
        half-chosen slot, a scrolled list — survives a collapse. The reset
        happens when the *selection* changes, because the caller keys this
        component on the piece.
      */}
      <div className="of-piece-actions-slots" hidden={!open}>
        {renderSlots?.(piece, close)}
      </div>
    </div>
  )
}
