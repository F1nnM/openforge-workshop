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
 * ## It *opens* the slot editor rather than holding it
 *
 * The plan was for the editor to expand inside this bar, so that the right-hand
 * column could stay the bill of tiles permanently — a bill that disappeared
 * whenever a piece was selected would take away the one view of *what this room
 * will cost to print* exactly when the user is changing it.
 *
 * **That is not what `SlotEditor` is.** It renders a `Dialog`, for a reason its
 * own docblock gives, and a dialog portals to the document body — so an editor
 * nested in a collapsed disclosure here appeared the moment a piece was
 * selected, ignoring the collapse entirely. Rendering a modal inside a floating
 * bar is a category error, not a wiring mistake.
 *
 * So this button opens it, and the outcome the column argument wanted is
 * reached anyway: the bill is never displaced, because the editor was never
 * going to live in that column either way. What the bar contributes is the
 * **operand** — the editor opens on the piece the user selected, where
 * `SlotsPanel`'s list could only identify a piece by name and a room with four
 * `Fixture corner`s in it made that a guess.
 *
 * Making the editor inline-able is a real option and a separate change: it owns
 * its own dialog semantics and its own tests, and rewriting it to render in
 * either shape is not this row's work.
 *
 * ## Pointer events stop here, and focus does not move
 *
 * `RoomSurface` listens for `pointerdown` on the canvas's **parent** in the
 * capture phase, and drei's `<Html>` portals this component into that same
 * parent. Three things therefore have to be true:
 *
 *   1. `RoomSurface` ignores presses whose target is not the canvas —
 *      `selection.ts#claimsPress`, and it is written as a fix for the *class*
 *      rather than for this component.
 *   2. This root stops propagation anyway. Belt to that brace, and it is the
 *      half that survives someone moving the portal: a press on a button must
 *      never also reach `OrbitControls`, or clicking `Remove` orbits the camera
 *      while the piece disappears.
 *   3. **A press here does not move focus.** This is the one that was wrong, and
 *      it was invisible to every test in this repo: clicking a `<button>` focuses
 *      it, which blurs the canvas — so after pressing `⟳` here, `R`, `Delete`
 *      and `Ctrl`+`Z` stopped reaching the surface and the keyboard caret went
 *      out. `preventDefault` on `mousedown` is the standard answer for a toolbar
 *      floating over a canvas, and it costs nothing in accessibility: `Tab`
 *      still reaches every button, because tab focus is not a default action.
 */
import type { ScenePiece } from '@/builder/canvas'
import { pieceName } from '@/builder/canvas'
import { Button, VisuallyHidden } from '@/ui/primitives'

import './actions.css'

export interface PieceActionsBarProps {
  /** The selected piece. The bar exists only while there is one. */
  readonly piece: ScenePiece
  /**
   * Open the slot editor on this piece, or `undefined` when the caller has
   * nowhere to open one.
   *
   * A callback out and not a component in, which is the shape the surface
   * already uses for this destination: the editor lives in
   * `builder/panels/slots/`, on the far side of the line
   * `builder/panels/boundary.test.ts` keeps, so nothing here may import it. The
   * `undefined` case leaves a two-verb bar rather than a button that does
   * nothing — the landing hero and the component tests are real callers with no
   * editor to offer.
   */
  readonly onEditSlots?: (() => void) | undefined
  readonly onTurn: () => void
  readonly onRemove: () => void
}

export function PieceActionsBar({ piece, onEditSlots, onTurn, onRemove }: PieceActionsBarProps) {
  const name = pieceName(piece)

  return (
    <div
      className="of-piece-actions"
      role="group"
      aria-label={`${name} — actions`}
      // See the docblock: never let a press on a button reach the camera.
      onPointerDown={(event) => {
        event.stopPropagation()
      }}
      // And never let it take focus off the canvas, or the key map goes with it.
      onMouseDown={(event) => {
        event.preventDefault()
      }}
    >
      <div className="of-piece-actions-row">
        <Button size="sm" onClick={onTurn} title={`Turn ${name} — R`}>
          <span aria-hidden="true">⟳</span>
          <VisuallyHidden>Turn {name}</VisuallyHidden>
          <kbd className="of-build-key" aria-hidden="true">
            R
          </kbd>
        </Button>

        <Button
          size="sm"
          disabled={onEditSlots === undefined}
          onClick={onEditSlots}
          title={`Choose the parts of ${name} — Enter`}
        >
          <span aria-hidden="true">▤</span>
          <span>Slots</span>{' '}
          <VisuallyHidden>of {name}</VisuallyHidden>
        </Button>

        {/*
          One glyph, and the key named in words.

          It read badly before because it carried **two** delete symbols — a
          `⌦` icon beside a `⌫` keycap — which are near-identical shapes saying
          the same thing twice, and neither of them says *which* key. `Del` is
          the label on the key the user has to find, and it matches how the turn
          button names `R`: the icon carries the meaning, the chip carries the
          shortcut, and the two never compete.

          No confirmation, deliberately. The action is one keystroke to reverse —
          `history.ts`'s ring covers every mutation of the placement map — and
          undo is the better design than a dialog for a reversible action the
          user takes often.
        */}
        <Button size="sm" onClick={onRemove} title={`Remove ${name} — Delete`}>
          <span aria-hidden="true">⌦</span>
          <VisuallyHidden>Remove {name}</VisuallyHidden>
          <kbd className="of-build-key" aria-hidden="true">
            Del
          </kbd>
        </Button>
      </div>
    </div>
  )
}
