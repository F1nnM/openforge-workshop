/**
 * What the next click will place, said at the cursor — and how to stop.
 *
 * ## Why the armed state needed its own affordance
 *
 * Arming a family already changed three things on screen: a ghost appeared under
 * the pointer, the hint plate at the bottom-left named the family, and the
 * readout at the bottom-right named it again. What none of them did was tell the
 * user **how to stop**, and two of the three are in the corners of a full-bleed
 * viewport — as far from the thing the user is looking at as the layout allows.
 *
 * So a user who armed a family by accident, or changed their mind, had a ghost
 * following their pointer, no visible way out, and a primary button that placed a
 * tile wherever they clicked next. `Escape` disarmed and always did; nothing said
 * so. This is that sentence, put where the eye already is.
 *
 * ## It must never take a pointer event
 *
 * The label follows the cursor, so anything it swallowed would be swallowed on
 * every single click — the gesture this whole surface is built around.
 * `pointer-events: none` in `actions.css` is therefore load-bearing rather than
 * tidy, and it is the reason this is a *label* and not a small toolbar: a control
 * here would be unclickable by construction.
 *
 * That is also why the cancel affordance is **stated rather than offered**. The
 * two ways out are a key and a gesture, both of which work with the pointer
 * wherever it is; a button at the cursor would have to be chased.
 */
import type { ScenePiece } from '@/builder/canvas'
import { pieceName } from '@/builder/canvas'

import './actions.css'

export interface ArmedLabelProps {
  /** The armed family, as a readout says it — `describeTemplate`'s wording. */
  readonly name: string
  /**
   * The pieces this placement would be refused by, if any.
   *
   * Named here as well as in the hint plate, and the duplication is deliberate:
   * the plate carries the full sentence with the cell, and this carries the
   * *verdict* — three words, at the cursor, where a user who is about to press
   * will actually see them. A greyed ghost alone leaves them to infer why.
   */
  readonly blocked?: readonly ScenePiece[] | undefined
}

export function ArmedLabel({ name, blocked }: ArmedLabelProps) {
  const blocker = blocked?.[0]

  return (
    <div className="of-armed-label" data-blocked={blocker === undefined ? undefined : 'true'}>
      <span className="of-armed-label-name">{name}</span>
      {blocker === undefined ? null : (
        <span className="of-armed-label-blocked">{pieceName(blocker)} is in the way</span>
      )}
      <span className="of-armed-label-cancel">
        <kbd className="of-build-key">Esc</kbd> or right-click to cancel
      </span>
    </div>
  )
}
