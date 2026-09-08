/**
 * The action bar, put where the selected piece is.
 *
 * **The one part of the selection model no test in this repo can reach**, and it
 * is deliberately the smallest such part: everything decidable lives in
 * `anchor.ts` (the clamp) and `PieceActionsBar.tsx` (the markup and the
 * behaviour), both of which are covered. What is left here is the `<Html>` call
 * and the arithmetic that turns a piece into a point, and both need a WebGL
 * context — see the decomposition note in the design spec.
 *
 * ## Why drei's `<Html>` and not a hand-rolled overlay
 *
 * The alternative is projecting to screen space ourselves into a sibling div,
 * driven off `OrbitControls`' `change` event. It is more code for the same
 * result, and it gets the harder half wrong more easily: `<Html>` re-projects
 * inside the render loop, so under `Stage`'s `frameloop="demand"` it syncs on
 * exactly the frames that are already being drawn — which are exactly the frames
 * on which the anchor can have gone stale (a camera move, a geometry arrival, a
 * store write). A `change`-driven overlay has to rediscover that set of moments
 * and will miss one.
 *
 * Three options are load-bearing:
 *
 *   - **No `occlude`.** The default, and it must stay the default: an occluded
 *     bar would hide behind the very piece it acts on the moment the camera got
 *     below it. This is chrome, not geometry.
 *   - **No `distanceFactor`.** Without one the overlay holds a constant pixel
 *     size instead of scaling with distance. A control that shrank as the user
 *     zoomed out would become unreadable exactly when a wide view made it most
 *     useful, and its hit target would shrink with it.
 *   - **`calculatePosition`,** so {@link clampAnchor} runs. `<Html>` will
 *     happily position an overlay off-canvas; see `anchor.ts` for why that is
 *     reachable by ordinary orbiting and why clamping beats hiding.
 *
 * ## Where the anchor point comes from
 *
 * The centre of the piece's plan box, at the top of its tallest part. Not the
 * piece's own origin, which is a **minimum corner** and would hang the bar off
 * the top-left of a 4 x 4 floor; and not the centre of the mesh's bounding box,
 * which nothing here has — a part's height is `SlotLayout.elevationMm`, the
 * project's one elevation source, and `heightOf` is the same function the pick
 * uses to decide what the pointer landed on. So the bar sits above the piece
 * from every angle, and it sits above the same piece the pointer would have hit.
 */
import { Html } from '@react-three/drei'
import type { Camera, Object3D } from 'three'
import { Vector3 } from 'three'

import type { ScenePiece } from '@/builder/canvas'
import { GRID_UNIT_MM } from '@/catalog'

import { clampAnchor } from './anchor'
import { PieceActionsBar } from './PieceActionsBar'

/**
 * Scratch vector for the projection, module-scoped.
 *
 * `calculatePosition` runs once per drawn frame, so a `new Vector3()` inside it
 * is a garbage-collected allocation per frame for the lifetime of a selection.
 * This is the pattern the rest of `builder/three` uses for exactly the same
 * reason — see the module-level `Matrix4` in `place.ts`.
 */
const PROJECTED = new Vector3()

/**
 * World position to canvas pixels — drei's own default, written out.
 *
 * Written out rather than imported because drei does not export it, and
 * `calculatePosition` is all-or-nothing: overriding it to clamp means owning the
 * projection too. It is four lines and they are the standard ones — project to
 * normalised device coordinates, then map `[-1, 1]` onto the viewport with `y`
 * inverted, because NDC counts up and a page counts down.
 */
function projectToScreen(element: Object3D, camera: Camera, size: { width: number; height: number }): [number, number] {
  PROJECTED.setFromMatrixPosition(element.matrixWorld)
  PROJECTED.project(camera)
  const halfWidth = size.width / 2
  const halfHeight = size.height / 2
  return [PROJECTED.x * halfWidth + halfWidth, -(PROJECTED.y * halfHeight) + halfHeight]
}

export interface SelectionAnchorProps {
  readonly piece: ScenePiece
  /** The piece's height above the plan, in millimetres — the pick's own answer. */
  readonly heightMm: number
  /** Builds the slot editor for this piece; `close` collapses the disclosure. */
  readonly renderSlots?: (piece: ScenePiece, close: () => void) => React.ReactNode
  readonly onTurn: () => void
  readonly onRemove: () => void
}

export function SelectionAnchor({ piece, heightMm, renderSlots, onTurn, onRemove }: SelectionAnchorProps) {
  const { box } = piece
  const centreX = (box.x + box.w / 2) * GRID_UNIT_MM
  const centreZ = (box.z + box.d / 2) * GRID_UNIT_MM

  return (
    <Html
      // Millimetres, because this renders inside the surface's millimetre group
      // — the same space `tileMatrix` and the plates are in. Mixing units here
      // would put the bar a factor of 25.4 away from the piece.
      position={[centreX, heightMm, centreZ]}
      center
      zIndexRange={[100, 0]}
      calculatePosition={(element, camera, size) => {
        const [x, y] = projectToScreen(element, camera, size)
        const inside = clampAnchor({ x, y }, size)
        return [inside.x, inside.y]
      }}
    >
      <PieceActionsBar
        piece={piece}
        {...(renderSlots === undefined ? {} : { renderSlots })}
        onTurn={onTurn}
        onRemove={onRemove}
      />
    </Html>
  )
}
