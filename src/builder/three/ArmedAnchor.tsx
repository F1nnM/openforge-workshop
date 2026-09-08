/**
 * The armed label, put at the cell the next click will place in.
 *
 * A sibling of `SelectionAnchor` and the same division of labour: the `<Html>`
 * call and the arithmetic that turns a plan anchor into a world point live here,
 * where no test can reach them, and everything decidable lives in `ArmedLabel`,
 * where they are covered without a canvas.
 *
 * **It is a separate file for a reason a test found.** Written inline in
 * `RoomSurface`, the `<Html>` reached drei's real `useThree` past the fiber mock
 * that lets `gesture.test.tsx` mount the surface at all — so every test that
 * mounted *armed* threw `R3F: Hooks can only be used within the Canvas
 * component`. Isolating the wrapper is what makes it mockable, and the surface
 * gets to keep its `Html` and `GRID_UNIT_MM` imports out of it.
 *
 * ## Anchored to the cell, not to the pointer
 *
 * The position is the **snapped anchor's centre**, so the label holds still
 * while the pointer moves within a cell and steps when the ghost steps. Chasing
 * the raw cursor would put a plate in constant sub-pixel motion under the user's
 * hand, and it would disagree with the ghost it is describing.
 *
 * No `center` and no clamp, unlike `SelectionAnchor`. The offset that lifts it
 * clear of the pointer is `actions.css`'s `transform`, in screen-space pixels;
 * and it needs no clamp because it only exists while the cursor is on the plan,
 * which means it is on screen by construction.
 */
import { Html } from '@react-three/drei'

import type { ScenePiece } from '@/builder/canvas'
import { GRID_UNIT_MM } from '@/catalog'

import { ArmedLabel } from './ArmedLabel'
import { PLATE_HEIGHT_MM } from './markers'

export interface ArmedAnchorProps {
  /** The ghost's snapped minimum corner, in grid units. */
  readonly anchor: readonly [number, number]
  /** The armed family, as a readout says it. */
  readonly name: string
  readonly blocked?: readonly ScenePiece[] | undefined
}

export function ArmedAnchor({ anchor, name, blocked }: ArmedAnchorProps) {
  return (
    <Html
      position={[
        (anchor[0] + 0.5) * GRID_UNIT_MM,
        // Just above the plates and the caret, so the label is never buried in
        // the ground plane at a shallow camera angle.
        PLATE_HEIGHT_MM * 4,
        (anchor[1] + 0.5) * GRID_UNIT_MM,
      ]}
      // Under the selection's action bar, which is aimed at rather than read in
      // passing. The two are never on screen together anyway — arming clears the
      // selection — so this is belt to a brace `usePlanTools` already holds.
      zIndexRange={[90, 0]}
      /*
        **On the wrapper, not just the plate**, and this is the bug that made the
        difference: drei renders two container divs between this call and
        `ArmedLabel`'s root, and both are `pointer-events: auto` — measured in
        the running app, not assumed. The content wrapper boxes the plate
        exactly, so with `none` set only on the plate the wrapper still swallowed
        every pointer event over the label. The canvas then got `pointerleave`,
        the cursor went null, the label unmounted, the pointer was over the
        canvas again, and the whole thing flickered.

        Which matters far more here than for `SelectionAnchor`: that bar is
        *aimed at* and wants its clicks, while this label rides under the cursor,
        so anything it swallowed would be swallowed on every single click — the
        one gesture the surface is built around. `actions.css` keeps the rule on
        the plate as well; neither is redundant, because they cover different
        divs.
      */
      style={{ pointerEvents: 'none' }}
    >
      <ArmedLabel name={name} blocked={blocked} />
    </Html>
  )
}
