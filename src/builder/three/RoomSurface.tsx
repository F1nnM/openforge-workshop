/**
 * The work surface: the room, the ghost, and the pointer that edits it.
 *
 * This is the component that makes the 3D view a builder rather than a preview.
 * It lives *inside* `Stage`'s `<Canvas>` because the pointer maths needs the
 * camera, and it owns the two pieces of ephemeral state a gesture has — where
 * the pointer is on the plan, and what is in the air — while every decision
 * about what a gesture *means* comes from `edits.ts` and every piece of geometry
 * from `@/builder/canvas`.
 *
 * ## The gesture model, and where it departs from the mockup
 *
 * `design/forge3d.js`'s `createBuilder` is the owner's reference and four of its
 * five decisions are kept verbatim: an orbit camera, a ground-plane raycast for
 * the placement point, a translucent snapped ghost following the pointer and
 * hidden on `pointerleave`, and a **5 px** threshold
 * ({@link DRAG_THRESHOLD_PX}) separating an orbit-drag from a click.
 *
 * Three depart, each for a reason that is written down where the reason lives:
 *
 *   1. **Erase picks the plane, not the meshes.** `surface.ts` sets out why, and
 *      why a single ground plane is not enough either.
 *   2. **The ghost is a cell marker, and row A4b is why.** The mockup builds a
 *      box or an extrusion per tile kind and the owner rejected primitives, so
 *      until this row the ghost was the *tile's own mesh*, positioned by the same
 *      `tileMatrix` call the placed instance would use and falling back to the
 *      tagged footprint as a plate. Since row **A1** the armed thing is a
 *      **template family** rather than a file, and a family's geometry is the
 *      union of its parts' — so there was no mesh to draw and no footprint to
 *      fall back to. `edits.ts#templateGhost` states exactly what the marker
 *      claims. **This is the one place the surface got less capable in A4b**, and
 *      it has been unblocked in two steps since. Row **C5** moved the blocker
 *      rather than clearing it: the fill *is* solved now, on the click and
 *      memoised, so a ghost could ask for one on hover — but the union of a
 *      solved fill's boxes needs B2's layout rule, and that rule did not reach
 *      the canvas. **Row C6 wired it**: `BuilderScreen` composes
 *      `templateSlotLayout` over the family table, so a projected instance's
 *      parts now stand where the recipe says. Nothing about the ghost is waiting
 *      on a rule any more. What is left is two shapes rather than two unknowns —
 *      a hover would pay the solve `actAt` deliberately pays on the click (1 to
 *      19 queries, up to 3.3 ms cold, memoised on `(family, size)`), and
 *      projecting the piece needs a `PlanCatalog`, which this component is not
 *      given: it takes a `scene`. One call still restores it — `computeGhost`
 *      over a solved fill map through `reanchorPiece`, which is what A4a
 *      suggests — and it is now a row of its own rather than a row behind
 *      another.
 *   3. **The parts rise by the recipe's own elevations, and by nothing else.**
 *      The mockup lifts a wall 0.25 units when a floor is under it, and it can,
 *      because it stores a `y` with every placement. A `TemplateInstance` has no
 *      `y` and needs none: a part's height above the plan is
 *      `SlotLayout.elevationMm`, declared by the recipe and delivered per part by
 *      row **A4a**, so the instance matrix, the plate and the pick all read one
 *      number and cannot disagree about it. What is still computed and still
 *      **not** applied is `SurfacePick.elevationMm` — a *user-directed* stack, a
 *      wall the user puts on top of another instance's floor, which would need a
 *      stored `y` this app does not have. Row R2 refused to draw it and that
 *      refusal stands.
 *
 * ## Why the drag has to fight for the pointer, and how it wins cleanly
 *
 * `OrbitControls` is `makeDefault` and listens on the same canvas, so a
 * move-drag and an orbit-drag are the same physical gesture. Disabling the
 * controls from a `pointerdown` on the canvas is a race — three's own handler may
 * already have captured the pointer and added its document listeners, and it
 * bails out of `onPointerUp` while disabled, leaving them attached. So the
 * surface listens on the canvas's **parent, in the capture phase**, and calls
 * `stopPropagation` on exactly the presses it claims. The event then never
 * reaches `OrbitControls` at all, which is deterministic rather than
 * nearly-always-right, and every press the surface does *not* claim orbits
 * normally.
 *
 * ## Everything pure is called, nothing pure is restated
 *
 * `usePlanTools` transfers untouched — it has no DOM in it, so the mode, the
 * snap, the pending rotation and the palette selection are the same state object
 * `PlanToolbar` already writes. `beginMove` / `dragMoveTo` / `nudgeMove` /
 * `previewMove` are the whole move. `pieceAt` resolves every pick, and it
 * resolves it to a **placement** — which is the right arity for all four
 * gestures, because erase, move and turn each act on one `PlacementId` and a
 * template is placed and rotated as one unit. The right click is the one gesture
 * with a second level to it, and the section below says what it does with it.
 * `subjectsConflict` is reached only through `pieceAt` and the move. There is no
 * second geometry in this file and no second opinion about where anything is.
 *
 * `partAt` **is** now reached, and row C8 is the change: it names the *slot* a
 * point landed in, which used to be the slot editor's question and not the
 * surface's, because the editor opened from a row in a panel where there is no
 * point to name. With the gesture on the drawing the point is the whole of what
 * the user said, so the pick resolves both levels — the instance through
 * `pieceAt`, the slot through `partAt` — and it does so inside
 * `edits.ts#planSlotEdit` rather than here, because *what a gesture means* has
 * been that module's since row A4b and a right click is not an exception.
 *
 * ## The right click is the camera's again
 *
 * The owner asked for the slot editor to *"come up with a right click"*, and
 * row C3 delivered it here — through a `pointerup` rather than a `contextmenu`,
 * with the 5 px test separating a click from a pan, because `contextmenu` fires
 * from the mouse *down* on X11 and macOS and would have opened a dialog at the
 * start of every pan.
 *
 * **All of it is deleted**, and what deleted it is the selection rather than a
 * change of mind about the gesture. The right click was carrying the editor
 * because there was nothing else to carry it: with no persistent selection the
 * only operand available was *whatever the pointer resolved to*, so the gesture
 * had to be a pointer gesture. The editor now opens from the action bar over
 * the selected piece, which is an operand the user chose deliberately.
 *
 * So the secondary button pans and does nothing else, the `contextmenu`
 * suppression is gone with it, and a user right-clicking the canvas gets their
 * browser's own menu like anywhere else on the page.
 *
 * ## Row D7: the glow is the tile's silhouette, and D3's was the plan view
 *
 * The owner asked that *"when hovering over a template in the editor, its
 * outline glow slightly"*, and the section above is why that is load-bearing
 * rather than decorative: a right click opens the slot editor on **whichever
 * piece the pointer resolves to**, so a user has to be able to see which piece
 * that is before pressing. Erase and move have had the same problem for longer.
 *
 * Row D3 drew it and drew the wrong thing, and the owner's diagnosis was exact:
 * *"a 1px wide border floating on top of the element, not a glowing outline of
 * the rendered tile"*. It built the cue from `polygons` — the **tagged
 * footprint** — as a flat `lineSegments` loop lifted to the part's top height,
 * so on a wall it was a horizontal rectangle in the air above the mesh. That is
 * not a thin version of the right drawing; it is the plan view, drawn in 3D, at
 * a height. It also could be *occluded* by anything standing between the camera
 * and that plane, so the cue was as likely to be hidden as to be misread.
 *
 * D7 replaces it with the **silhouette of the geometry that is on screen**,
 * traced by an outline pass in `src/three/Stage.tsx`. {@link silhouettes} is
 * what this component contributes and carries the derivation; `outline.ts`
 * carries why an instanced room needs a proxy mesh, and `Stage.tsx` carries the
 * reconciliation with a design direction that says there is no stroke in 3D.
 * Three things about it are stated here because they are facts about the
 * *surface* and not about the pass:
 *
 *   1. **The cue is a screen-space edge, so nothing can hide it.** The mask's
 *      boundary is where the piece stops covering pixels, which is exactly where
 *      the user needs the line, whether the piece abuts a neighbour or stands
 *      alone. A drawn loop had to be positioned in the world and could lose.
 *   2. **A plate is outlined as a plate**, not as a mesh it does not have — the
 *      flat loop is *correct* when the flat plate is what was rendered, which is
 *      every piece today while blocker B2 is open.
 *   3. **The pointer path did not change.** It did not change in D3 either, and
 *      the A/B below still holds: `under` was already computed on every move.
 *
 * **Nothing was added to the pointer path to draw it.** `under` — `pieceAt` over
 * the cursor this component has tracked for the ghost since the mockup — was
 * already computed on every pointer move, for the erase ring and for the status
 * hint, and `onMove` already called `invalidate` on every move. So the brief's
 * warning about a hover handler that invalidates on every pointer move describes
 * the surface as it already was, and the A/B says so: **ten pointer moves are
 * ten invalidations before this row and ten after**, and a move over a hovered
 * two-part piece goes from 0.187 ms to 0.221 ms (medians of ten 200-move rounds
 * in jsdom against React's development build; the fastest rounds are 0.145 and
 * 0.168) — **+0.03 ms**, against the 3.3 ms row C5 pays on a click. Over bare
 * ground the two are the same to the noise floor. There is nothing here to
 * throttle, and the reason there is nothing is that `pieceAt` returns the
 * scene's own object: the outline is memoised on the piece, so 200 moves across
 * one piece rebuild its geometry **zero** times.
 *
 * Three decisions came out of D3 and all three survive the change of drawing:
 *
 *   1. **The cue names the instance and not the resolved part.** D3 settled it
 *      with an argument about `polygons` being the flat map of its parts';
 *      the pass settles it by construction — see the note beside the drawing.
 *   2. **It goes out while a button is held**, because a held button here means
 *      the camera: left orbits and right pans. {@link dragging} carries the
 *      mechanism, and why it is read off `PointerEvent.buttons` rather than
 *      tracked from the presses.
 *   3. **It follows the cursor and not the pointer**, so `[`, `]` and the arrow
 *      keys ring the piece they announce and a keyboard user gets the same cue
 *      from the keyboard. That is also how D3 found that neither keyboard
 *      cursor writer asked for a frame at all — {@link moveCursor} has the
 *      measurement — which is a defect in the *caret* that predates the glow.
 *
 * The erase cue is the same drawing at full strength rather than a second one,
 * and two special cases went with it in D3: the ring used to be skipped for any
 * piece with a plate on it and the plate's own contour recoloured instead, so a
 * template with one mesh loaded and two still waiting highlighted **only the two
 * that were waiting**. It also used to be one loop at the *tallest* part's
 * height, which drew a corner template's floor outline at its **wall's** top —
 * 12.7 mm above the floor on this directory's fixture and 63.5 mm on a shipped
 * wall, the height `surface.ts` measures its parallax against. Both are moot
 * now: there is one mask over whatever the piece is drawn as.
 *
 * ## Row A4b: everything drawn is a **part**, and the preview is a whole piece
 *
 * A placement is N parts, so every list this component builds is a list of parts
 * — the plates, the ring, the preview — and each one takes its own `box`, `angle`,
 * `polygons`, `style` and `layout.elevationMm` off the {@link PlanPiecePart} A4a
 * resolved. `box.x`/`box.z` on a part **is** its world anchor and `angle` is
 * already the drawn angle, so nothing here composes an offset or adds two
 * rotations; `slotGeometry` did both, once, in the projection.
 *
 * The move preview is the clearest case of the shape paying off.
 * `MovePreview.moved` is *the whole piece re-projected at the proposed anchor* —
 * A1 replaced the flat `box`/`parts`/`angle`/`axisAligned` quartet with it,
 * because four numbers could only ever describe one part of five. So the preview
 * is drawn by the same `map` over `parts` that draws the scene, and there is no
 * second shape to keep in step.
 *
 * A piece's **height** for the pick is the tallest of its parts' tops rather than
 * one mesh's height, and `heightOf` is where that is stated: a pointer over a
 * corner template must land on the wall standing on the floor, not on the floor
 * under it, or the click falls through to the plane below.
 */
import { useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BufferGeometry } from 'three'
import { Matrix4, Raycaster } from 'three'

import type {
  MoveDrag,
  PlanCatalog,
  PlanPart,
  PlanPiecePart,
  PlanPoint,
  PlanScene,
  PlanTools,
  ScenePiece,
} from '@/builder/canvas'
import {
  beginMove,
  claimsPress,
  createStyleResolver,
  describeCell,
  describeNudge,
  dragMoveTo,
  navigationOrder,
  nudgeMove,
  pieceAt,
  pieceName,
  pressMeaning,
  previewMove,
  resolveSelection,
  snapTo,
} from '@/builder/canvas'
import type { UndoControls } from '@/builder/canvas/useHistory'
import type { PlacementId, SlotName, TemplateId } from '@/store'
import {
  moveGeneratedPlacement,
  movePlacement,
  placeTemplate,
  removeGeneratedPlacement,
  removePlacement,
  rotateGeneratedPlacement,
  rotatePlacement,
} from '@/store'
import type { OutlineRequest, OutlineSubject } from '@/three/outline'

import type { SurfaceEdit, SurfaceStatus, TemplateGhost } from './edits'
import type { PlacementFiller } from './fills'
import {
  describeAbandon,
  describeSurfaceHint,
  planDrop,
  planGrab,
  planPlacement,
  planSlotEdit,
  planTurn,
  projectPlacement,
  removalOf,
  templateGhost,
} from './edits'
import { InstancedTiles } from './InstancedTiles'
import { ArmedAnchor } from './ArmedAnchor'
import { SelectionAnchor } from './SelectionAnchor'
import { Caret, FootprintPlate, Ghost, Lattice, SelectionMark } from './surfaceDraw'
import type { LodInstanceGroup, Room3D } from './instances'
import type { LodGeometry } from './loadLod'
import { PLATE_HEIGHT_MM, plateGeometry } from './markers'
import { liftMatrix, tileMatrix } from './place'
import type { SurfaceFit, SurfacePick } from './surface'
import {
  isClickGesture,
  meshHeightMm,
  ndcOf,
  pickSurface,
  pointerRay,
} from './surface'

/** How many snap steps a shifted arrow key travels. `PlanCanvas`'s own. */
const FAST_STEPS = 4

/**
 * `PointerEvent.button` for the secondary button — the right one, by name.
 *
 * Two, from the UI Events spec's own table, and written down because `2` appears
 * three times in the gesture below and every one of them means the same thing.
 * The `button` value and not `buttons`: `button` names the one button whose state
 * *changed*, which is the question a press and a release each ask.
 */
const SECONDARY_BUTTON = 2

/** The accent, as three cannot read a CSS custom property. `--acc` in `tokens.css`. */
const ACCENT = '#8f5b21'

/**
 * A ghost that will not place: **`--mut`**, the palette's own de-emphasis tone.
 *
 * Not a red, and the absence is the palette's rather than an omission —
 * `tokens.css` has no danger colour, because the parchment theme has no red in
 * it at all. Inventing one for this would put a colour on screen that belongs to
 * no family and would be the only saturated hue in the app.
 *
 * `--mut` says the right thing anyway, and arguably the better thing: a greyed
 * ghost reads as **disabled**, and *"this click will do nothing"* is exactly
 * what a blocked placement is. It also matches the one precedent the surface
 * already has — `movingParts` draws an alarmed preview in the accent rather than
 * in a warning colour, so a second warning vocabulary would be a third opinion
 * about the same idea.
 *
 * **Colour is not the sole carrier.** The hint line names the piece that is in
 * the way and the cell it is in — `edits.ts#blockedMessage` — so a user who
 * cannot distinguish these two browns is told in words, before pressing.
 */
const BLOCKED = '#79684d'



/**
 * The hover cue's colour: **`--acc` lifted 35% of the way to `--bg`**.
 *
 * The owner asked for a hovered outline to glow *"slightly"*, and this is that
 * word as a number rather than as a taste. It is not a new colour in the
 * design — it is the accent and the page ground, the two tokens §1's table
 * already carries, mixed — so the cue cannot drift into the saturated
 * selection colour the contract has no token for. `gesture.test.tsx` asserts
 * the mix against `@/tokens` so a hand-edited digit fails rather than merely
 * looking different.
 *
 * Measured against the three things the line is actually seen against, over
 * all sixteen material families:
 *
 * | seen against | this | {@link ACCENT} |
 * | --- | ---: | ---: |
 * | the parchment ground, `--bg` | **2.39:1** | 4.19:1 |
 * | a mesh-less part's own contour, worst family | **3.29:1** | 1.88:1 |
 * | a family's own fill, worst family | 1.01:1 | 1.16:1 |
 *
 * The first row is the *"slightly"*: against the ground the plan is drawn on,
 * a hovered outline carries 43% less contrast than the ring the erase gesture
 * puts round the piece it would delete, so pointing at a piece cannot be read
 * as arming it. The second is why it is nonetheless legible where the line
 * lands — it overdraws the part's own dark contour, and it is a **larger**
 * change to that contour than the accent itself would be. The third is a limit
 * of the palette and not a tuning failure: no candidate colour, the accent
 * included, clears **1.2:1** against all sixteen fills (the sweep ran
 * `--acc`→`--bg` at nine mixes and `--acc`→`--ink` at two; every one landed
 * between 1.00 and 1.16), because the families span L* 18 to 82 by design.
 * `palette.ts` states the answer to that as a rule — silhouette is carried by
 * the contour and not by the fill — and the contour is exactly where this cue
 * is drawn.
 */
export const HOVER_GLOW = '#ae885a'

export interface RoomSurfaceProps {
  readonly scene: PlanScene
  readonly room: Room3D
  /** Loaded objects by content address — R1's map, provenance unasked. */
  readonly geometries: ReadonlyMap<string, LodGeometry>
  readonly fit: SurfaceFit
  readonly tools: PlanTools
  /**
   * The armed **family** — `tools.selectedTemplate`, taken as a prop.
   *
   * A `TemplateId` since row A1, because §2.5 makes templates the only placement
   * unit and there is no file for the palette to arm. It is still a prop rather
   * than read off `tools` inside the component so that the one place the armed
   * thing is *resolved* stays the caller's — which is where row **C5** put it:
   * see {@link RoomSurfaceProps.fill}.
   */
  readonly armed: TemplateId | null
  /**
   * What the armed family is filled with, solved at the click.
   *
   * **Required, and that is contract C-k's shape applied to placing.** An
   * optional filler would mean a caller that forgot to pass one still compiles
   * and still places — with `fills: {}`, drawing nothing, silently, which is
   * precisely the state row C5 exists to end. `BuilderRoom` builds it in a
   * `useMemo` over the three authorities `BuilderScreen` already holds, so the
   * memo inside it survives every re-render and a room of twenty identical
   * placements is one solve.
   */
  readonly fill: PlacementFiller
  /**
   * Open the slot editor on one instance — the owner's right click, arriving on
   * the piece rather than on its row in the panel.
   *
   * **Optional, and it is the one prop in this file that should be.** Every other
   * prop here is something the surface cannot draw without; this one is a
   * *destination*, and the destination is a dialog that lives in
   * `builder/panels/slots/` — on the far side of the boundary
   * `builder/panels/boundary.test.ts` keeps. So the surface reports two
   * primitives and knows nothing about what opens: `BuilderScreen` holds the
   * open state and hands it to `SlotsPanel`, which is also still the *only*
   * pointer-free way in and stays exactly as it was.
   *
   * `slot` is the slot whose part the pick landed in, pre-selected in the editor.
   * `edits.ts#planSlotEdit` is the whole of the decision and carries why a
   * secondary press resolves through the same `pieceAt` erase does.
   */
  readonly onEditSlots?: (placement: PlacementId, slot?: SlotName) => void
  /**
   * The hover cue, published as a request for `Stage`'s silhouette pass — row **D7**.
   *
   * **Required**, for the reason {@link RoomSurfaceProps.fill} gives about a
   * filler: an optional cue would mean a caller that forgot to wire it still
   * compiles, still picks, still erases — and never shows the user which piece
   * any of that is happening to. That is precisely the class of silent failure
   * row D3 shipped and this row is fixing.
   *
   * It is a *callback out* rather than a handle in, and that is the same shape
   * {@link RoomSurfaceProps.onStatus} already has: this component owns the
   * ephemeral state of a gesture and publishes what it means, and `BuilderRoom`
   * holds it and passes it to the canvas that can draw it. The surface cannot own
   * the pass — the pass is one per `<Canvas>` and shared with the catalog's tile
   * previews (row G3) — and it must not reach into a composer to get at one.
   *
   * Called from an effect on a memoised value, so a pointer crossing one piece
   * publishes **once** and two hundred moves across it publish nothing further.
   * There is no clearing cleanup: `BuilderRoom` mounts this component and the
   * `Stage` that draws for it under one condition, so they unmount together and
   * a final empty request would be a state update into a tree that is going away.
   */
  readonly onOutline: (request: OutlineRequest) => void
  /**
   * The catalog, so a candidate placement can be projected before it happens.
   *
   * **Required, and it is what makes the overlap refusal possible at all.** The
   * surface used to take a `scene` and nothing else, which is why
   * `edits.ts#templateGhost` could only draw a one-cell marker and
   * `planPlacement` could only refuse an empty palette: with no catalog there is
   * no way to turn an armed *family* into the parts it would draw, so there was
   * no footprint to test a conflict against.
   *
   * `BuilderRoom` already holds one, so this is a prop and not a second lookup.
   */
  readonly catalog: PlanCatalog
  /**
   * Undo and redo, so `Ctrl`+`Z` has something to call.
   *
   * **A prop and not a `useHistory()` call here**, and the reason is a defect the
   * shape prevents: the hook holds its ring in a `useRef` and subscribes to the
   * store, so two callers would build two independent rings, both recording every
   * edit, and the toolbar's buttons would undo a different history from the
   * keyboard's. It is called once, by the screen that owns the builder, and
   * handed to everything that offers the verb.
   */
  readonly history: UndoControls
  readonly onStatus: (status: SurfaceStatus) => void
  readonly announce: (text: string) => void
  /** Id of the paragraph holding the key map, for the canvas's `aria-describedby`. */
  readonly keyHelpId: string
  readonly label: string
}

export function RoomSurface({
  scene,
  room,
  geometries,
  fit,
  tools,
  armed,
  fill,
  catalog,
  history,
  onEditSlots,
  onOutline,
  onStatus,
  announce,
  keyHelpId,
  label,
}: RoomSurfaceProps) {
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const invalidate = useThree((state) => state.invalidate)

  const [cursor, setCursor] = useState<PlanPoint | null>(null)
  const [drag, setDrag] = useState<MoveDrag | null>(null)
  /**
   * Whether the plan cursor was last moved by the **keyboard**.
   *
   * This was `focused`, tracking whether the canvas held focus, and the swap is
   * forced by the key map moving off the canvas: with shortcuts working from
   * anywhere on the screen, a caret that appeared only while the canvas had
   * focus would be absent for the arrow keys that move it — the one cursor whose
   * *only* visible mark it is.
   *
   * Set by the two keyboard cursor writers and cleared by a pointer move, which
   * is exactly `Caret`'s own argument for existing: *"a crosshair chasing a
   * mouse pointer that already has a ghost is noise"*. So it is drawn when the
   * cursor is a keyboard cursor, and not merely when a cursor exists.
   */
  const [keyCursor, setKeyCursor] = useState(false)
  /**
   * Whether a button is held *while the pointer moves* — an orbit, a pan, or a
   * carry. Row D3, and it exists to keep the hover glow off the camera.
   *
   * Read off `PointerEvent.buttons` on the move itself rather than tracked from
   * the presses, and that is what makes it self-healing rather than merely
   * shorter. `OrbitControls` captures the pointer, so a release outside the
   * canvas never reaches `onUp` — a flag raised on `pointerdown` and cleared on
   * `pointerup` can therefore stick raised, which for this flag would mean the
   * glow silently never coming back. The next move with no button held clears
   * it, whatever happened to the release.
   *
   * `buttons` and not `button`: this asks *what is held*, which is the plural
   * question, and {@link SECONDARY_BUTTON}'s note is the singular one.
   */
  const [dragging, setDragging] = useState(false)
  /**
   * {@link dragging}, mirrored for the listeners — so a move that changes
   * nothing enqueues nothing.
   *
   * Every pointer move already writes `cursor`, so the fiber always has a
   * pending update when the button state is written and React's eager bail-out
   * cannot fire; without this the hundreds of moves in a plain hover would each
   * queue a second no-op update. Measured: without it a hover over bare ground
   * cost **0.171 ms** a move against this row's 0.146 ms baseline, and with it
   * the two are the same to the noise floor.
   */
  const buttonHeld = useRef(false)
  /** The cursor, readable from the stable listeners below. */
  const cursorRef = useRef<PlanPoint | null>(cursor)
  cursorRef.current = cursor

  /**
   * The top of one part, in millimetres above the plan.
   *
   * Its declared elevation plus whatever stands on it — the mesh's own upright
   * height when one has arrived, and the plate's when it has not. A part with no
   * geometry is exactly as tall as the marker drawn for it, so it is pickable at
   * the height it appears at.
   */
  const partTopMm = useCallback(
    (part: PlanPiecePart): number => {
      const lod = geometries.get(part.record.blob)
      return part.layout.elevationMm + (lod === undefined ? PLATE_HEIGHT_MM : meshHeightMm(lod.bounds))
    },
    [geometries],
  )

  /**
   * A piece's height above the plan, in millimetres: its **tallest** part's top.
   *
   * The one place the gesture path consults the mesh store, and row A4b is what
   * makes the maximum the right reduction: a corner template is a base under a
   * floor under two walls and a column, so the surface a pointer lands on is the
   * top of the column and not the top of the base. Told to `pickSurface`, because
   * a plane placed at any of the other four would let a click fall through to the
   * ground behind the piece.
   *
   * Nothing else in the gesture path reads `geometries` at all — which is why a
   * missing mesh cannot make a cell behave as though it were empty.
   */
  const heightOf = useCallback(
    (piece: ScenePiece): number => {
      if (piece.kind !== 'catalog') return PLATE_HEIGHT_MM
      // `parts` is never empty — `PlanPiece`'s own invariant — so this is a real
      // maximum and not `-Infinity`.
      return Math.max(...piece.parts.map(partTopMm))
    },
    [partTopMm],
  )

  /* --------------------------------------------------------------- derivations */

  const ghost = useMemo<TemplateGhost | null>(
    () => (armed === null || cursor === null ? null : templateGhost(armed, tools.rotation, cursor, tools.step)),
    [armed, cursor, tools.rotation, tools.step],
  )
  const under = useMemo(() => (cursor === null ? undefined : pieceAt(scene, cursor)), [scene, cursor])
  const moving = useMemo(() => (drag === null ? undefined : previewMove(drag, scene)), [drag, scene])
  /**
   * The selected piece, **resolved against the current scene on every render**.
   *
   * Not cached, and that is the point. The scene is a pure projection of the
   * store and is rebuilt on every write, so a held `ScenePiece` would be a stale
   * copy the moment the user turned or moved it. Resolving the id instead makes
   * two invariants one rule: a piece that has been removed, cleared or undone out
   * of existence simply resolves to `null`, so the selection cannot outlive its
   * subject and nothing has to remember to clear it.
   */
  const selectedPiece = useMemo(() => resolveSelection(scene, tools.selected), [scene, tools.selected])

  /**
   * The style resolver the candidate projection goes through.
   *
   * Created once per catalog rather than per call, for `createStyleResolver`'s
   * own stated reason: it memoises on the record, so one built inside `actAt`
   * would be thrown away on every gesture and memoise nothing.
   */
  const style = useMemo(() => createStyleResolver(catalog), [catalog])

  /**
   * The armed template as the scene would draw it, and whether it lands clear.
   *
   * ## Why this can exist now, and could not before
   *
   * `edits.ts#templateGhost` draws a **one-cell marker**, and its docblock is
   * emphatic that this is honest rather than lazy: since row A4b the armed thing
   * is a *family*, a family's footprint is the union of its parts' boxes as B2's
   * rule places them, and the surface had neither the fills nor a `PlanCatalog`
   * to resolve them. Rows C5 and C6 supplied the solver and the layout rule; the
   * `catalog` prop supplies the last of it. So the ghost is the real parts.
   *
   * ## Memoised on the snapped anchor, not on the cursor
   *
   * This is the difference between an affordable hover and a per-frame cost. The
   * anchor changes when the pointer crosses a **cell boundary**, and the cursor
   * changes on every pointer move — hundreds a second. Keying the memo on the
   * anchor means a pointer travelling across one cell projects **once**, and
   * `fills.ts` memoises the solve on `(family, size)` on top of that, so the
   * second cell costs a projection and no solve at all.
   *
   * What is left per boundary crossing is one `buildPlanScene` over a single
   * instance and one conflict sweep against the room. That is the cost the click
   * already paid; it is now paid one gesture earlier, which is the entire point —
   * an overlapping placement is refused, and a refusal the user could not see
   * coming would be the worst version of that.
   */
  const armedGhost = useMemo(() => {
    if (armed === null || ghost === null) return null
    const solved = fill(armed, tools.armedSize)
    return projectPlacement(catalog, style, scene, armed, ghost.anchor, tools.rotation, solved.fills)
    // `ghost.anchor` and not `cursor`: see the docblock. `ghost` is itself
    // memoised on the cursor, so this depends on the snapped value through it.
  }, [armed, ghost, fill, tools.armedSize, tools.rotation, catalog, style, scene])

  /**
   * Everything with no mesh, as one flat list of plates — **per part**.
   *
   * Both populations and, since row A4b, both *arities*. A catalog part is
   * waiting on R1's conversion or on a `/lod/` object that is not there; a
   * generated base has never been in this store at all, since `buildRoom3D` walks
   * `scene.pieces` alone. Either way the ground is occupied and must look it.
   *
   * Flattened to parts rather than left as pieces because a three-part template
   * with one loaded file is **one mesh and two plates**, and a plate drawn per
   * *piece* would have to choose one of the three outlines to be — which is
   * exactly the single-primitive assumption A1 broke. Each plate takes its own
   * part's tint, elevation and outline, so a wall waiting for a mesh appears at
   * wall height over the floor that has one.
   *
   * **Row D7 builds the geometry here rather than inside `FootprintPlate`**, and
   * it is an ownership change rather than a tidy-up: the hover cue outlines the
   * silhouette of *the object that is drawn*, so the plate and its silhouette
   * have to be the same `BufferGeometry` and not two builds of the same
   * arithmetic. One geometry per plate, one owner, one disposal below. The
   * rebuild frequency is unchanged in the case that matters — nothing in this
   * memo's dependencies moves with the pointer.
   */
  const plated = useMemo<readonly PlatedPart[]>(() => {
    const plates: PlatedPart[] = [
      ...scene.generated.map((piece) => ({
        key: piece.id,
        pieceId: piece.id,
        polygons: piece.polygons,
        geometry: plateGeometry(piece.polygons, PLATE_HEIGHT_MM),
        tint: piece.style.tint,
        edge: piece.style.edge,
        heightMm: PLATE_HEIGHT_MM,
      })),
    ]
    for (const piece of scene.pieces) {
      for (const part of piece.parts) {
        if (geometries.has(part.record.blob)) continue
        const heightMm = part.layout.elevationMm + PLATE_HEIGHT_MM
        plates.push({
          key: `${piece.id}:${part.slot}`,
          pieceId: piece.id,
          polygons: part.polygons,
          geometry: plateGeometry(part.polygons, heightMm),
          tint: part.style.tint,
          edge: part.style.edge,
          heightMm,
        })
      }
    }
    return plates
  }, [scene, geometries])

  // The plates' geometries are this component's, so they are released here —
  // `FootprintPlate` no longer has one of its own to dispose. React runs this
  // cleanup against the *previous* list before the next effect, so a scene change
  // disposes exactly the geometries that scene built.
  useEffect(
    () => () => {
      for (const plate of plated) plate.geometry.dispose()
    },
    [plated],
  )

  /**
   * The piece under the pointer, as the **silhouette of what is drawn for it** —
   * row D7, and the whole of the row.
   *
   * Row D3 built this list out of `polygons` — the tagged *footprint*, as a flat
   * loop lifted to the part's top height — and the owner read the result
   * correctly: *"a 1px wide border floating on top of the element, not a glowing
   * outline of the rendered tile"*. On a 63.5 mm wall that loop is a horizontal
   * rectangle hanging in the air over the mesh. It is not a thin version of the
   * right drawing; it is a drawing of the plan view, in 3D, at a height.
   *
   * So nothing here is a polygon. Each subject is a geometry **that is already on
   * screen** and the matrix it is already drawn with:
   *
   *   - **a part with a mesh** contributes `group.lod.geometry` and
   *     `group.matrices[i]`, read straight out of the {@link Room3D} the
   *     instanced draw was built from. Not recomputed through `tileMatrix`: a
   *     second derivation of the same placement is a second opinion about where
   *     the tile is, and the cue's one job is to agree with the picture.
   *   - **a part with no mesh** contributes its footprint **plate's** geometry —
   *     the same object {@link FootprintPlate} draws. A plate is flat by design
   *     (0.6 mm where a wall is 63.5), so its silhouette *is* a flat loop, and
   *     that is the honest cue rather than the wrong one: the flat outline is
   *     right exactly when the thing on screen is flat. Blocker **B2** makes this
   *     the common case today — nothing is uploaded to `/lod/`, so a room is all
   *     plates — and row D3's own predecessor got this wrong in the other
   *     direction by *skipping* the cue for any piece carrying a plate.
   *
   * The pass unions the subjects into one mask and traces its boundary, so N
   * parts produce **one** loop around the piece as drawn and no interior lines
   * between a template's floor and its wall. That settles D3's first decision —
   * the glow rings the instance, not the part — as a property of the drawing
   * instead of as an argument about arithmetic.
   *
   * **Memoised on the piece and not on the pointer**, which is this row's cost
   * control exactly as it was D3's: `pieceAt` returns the scene's own object, so
   * `under` keeps its identity while the pointer stays on one piece, and 200
   * moves across a two-part piece build **one** subject list.
   */
  /**
   * Which piece the pass is drawing: **the selection, or the hover when there is
   * none.**
   *
   * One pass, one colour — see {@link outline} — so the subject and the colour
   * have to be chosen by the same rule or they disagree. They did: this memo
   * read `under` while the colour read `selectedPiece`, so hovering a *neighbour*
   * of the selected piece outlined the neighbour in the **selection** colour.
   * That is the worst available answer, because it says the wrong piece is
   * selected rather than merely showing a cue at the wrong strength.
   *
   * The selection winning is also what makes the ground marker's job the one
   * `markers.ts` describes: the marker persists so that hovering elsewhere does
   * not *lose* the selection cue, and that only holds if the pass is showing the
   * hover at those moments rather than the selection twice.
   */
  const litPiece = selectedPiece ?? under

  const silhouettes = useMemo<readonly OutlineSubject[]>(() => {
    if (litPiece === undefined || litPiece === null) return []
    const under = litPiece
    const subjects: OutlineSubject[] = []
    // The surface draws in millimetres inside a scaled group; the pass draws in
    // the scene's own frame. `outline.ts` carries why the scale is composed here.
    const world = new Matrix4().makeScale(fit.scale, fit.scale, fit.scale)
    for (const group of room.groups) {
      for (const [index, id] of group.placements.entries()) {
        const matrix = group.matrices[index]
        if (id !== under.id || matrix === undefined) continue
        subjects.push({
          key: `${under.id}:${group.blob}:${String(index)}`,
          geometry: group.lod.geometry,
          matrix: new Matrix4().multiplyMatrices(world, matrix),
        })
      }
    }
    for (const plate of plated) {
      // The plate's positions are absolute millimetres, so the fit is its whole
      // transform — the same one its `<mesh>` gets from the group it sits in.
      if (plate.pieceId === under.id) subjects.push({ key: plate.key, geometry: plate.geometry, matrix: world })
    }
    return subjects
  }, [litPiece, room, plated, fit.scale])

  /**
   * The cue, published for `Stage`'s pass — one drawing at two strengths.
   *
   * Erase keeps {@link ACCENT} and hover keeps {@link HOVER_GLOW}, which is D3's
   * decision and still right: a click in erase mode *deletes* the thing being
   * named, so the loud cue is the honest one there and the quiet one everywhere
   * else. The **colour** is the axis and the drawing is not, so there is one
   * shape to get right and one place it is got right.
   *
   * Empty while a button is held, for {@link dragging}'s reason: a held button
   * here means the camera, and a cue that hops from piece to piece while the
   * view swings under a stationary hand is worse than no cue.
   */
  const outline = useMemo<OutlineRequest>(
    () => ({
      subjects: dragging ? [] : silhouettes,
      // One pass, one colour, and which cue it carries is a fact about the
      // state. The tempting alternative — a second, heavier outline for the
      // selection — costs a second `OutlineEffect`, a second mask render target
      // and a second fullscreen quad, against a pass `Stage.tsx` is deliberate
      // about costing *one*. So the pass draws whichever cue is live, and the
      // selection's persistent marker is a different drawing entirely:
      // `markers.ts` puts a contour on its footprint, on the plan, where
      // nothing can occlude it and where it stays while the pointer hovers
      // something else.
      colour: selectedPiece !== null ? ACCENT : HOVER_GLOW,
    }),
    [dragging, silhouettes, selectedPiece],
  )

  useEffect(() => {
    onOutline(outline)
  }, [onOutline, outline])

  /* ------------------------------------------------------------- the mutations */

  const lastSaid = useRef('')
  const say = useCallback(
    (text: string) => {
      if (text === lastSaid.current) return
      lastSaid.current = text
      announce(text)
    },
    [announce],
  )

  /**
   * Apply one verdict: at most one store write, then say what happened.
   *
   * The only function in this row that writes to the store, and the only one
   * that names the store's placement shape. Everything above it deals in
   * families, anchors and angles.
   *
   * `placeTemplate` since row A1 — the only placement action the store offers —
   * and the fills come off the verdict rather than being written here, which is
   * why row **C5** changed this function by **not one line**: C2's solve reaches
   * the store through `edit.fills`, exactly where A4b left the field for it.
   */
  const apply = useCallback(
    (edit: SurfaceEdit): boolean => {
      switch (edit.kind) {
        case 'place':
          placeTemplate({
            template: edit.template,
            x: edit.anchor[0],
            z: edit.anchor[1],
            rotation: edit.rotation,
            fills: edit.fills,
          })
          break
        case 'remove':
          if (edit.generated) removeGeneratedPlacement(edit.id)
          else removePlacement(edit.id)
          break
        case 'move':
          if (edit.generated) moveGeneratedPlacement(edit.id, edit.x, edit.z)
          else movePlacement(edit.id, edit.x, edit.z)
          break
        case 'turn':
          if (edit.generated) rotateGeneratedPlacement(edit.id, edit.rotation)
          else rotatePlacement(edit.id, edit.rotation)
          break
        case 'arm':
          tools.rotate(edit.step, edit.direction)
          break
        case 'none':
          break
      }
      say(edit.message)
      invalidate()
      return edit.kind !== 'none'
    },
    [invalidate, say, tools],
  )

  /**
   * Everything the stable listeners need, refreshed every render.
   *
   * The listeners below are attached once for the life of the component — a
   * capture-phase listener reattached on every pointer move would drop events
   * mid-gesture — so they read this rather than closing over state. `PlanCanvas`
   * needs the same thing for the same reason.
   */
  const latest = useRef({
    scene,
    tools,
    armed,
    fill,
    drag,
    heightOf,
    fit,
    apply,
    say,
    onEditSlots,
    catalog,
    style,
    history,
  })
  latest.current = {
    scene,
    tools,
    armed,
    fill,
    drag,
    heightOf,
    fit,
    apply,
    say,
    onEditSlots,
    catalog,
    style,
    history,
  }

  /** The pick under a pointer event, or `null` when the ray misses the plan. */
  const pickAt = useCallback(
    (clientX: number, clientY: number): SurfacePick | null => {
      const rect = gl.domElement.getBoundingClientRect()
      const ray = pointerRay(camera, ndcOf(clientX, clientY, rect), CASTER)
      return pickSurface(latest.current.scene, ray, latest.current.fit, latest.current.heightOf)
    },
    [camera, gl],
  )

  /**
   * The gesture, resolved and applied.
   *
   * **The one place the fill is solved**, and it is solved here rather than on
   * hover for a measured reason: a cold solve is 1 to 19 candidate queries and up
   * to 3.3 ms over the live archive (`fills.test.ts`), and a pointer move fires
   * hundreds of times a second where a click fires once. The filler memoises on
   * `(family, size)` anyway, so the second placement of the same row costs
   * nothing — but paying it on the gesture that writes is the shape that cannot
   * degrade into a per-frame cost.
   *
   * The armed **size** comes off `PlanTools` beside the family, which is row C1's
   * control finally reaching the piece that lands: before row C5 `PlanTools` held
   * `selectedTemplate` alone and *2 wide by 2 deep* changed only a number on
   * screen.
   */
  const actAt = useCallback(
    (at: PlanPoint) => {
      const {
        scene: current,
        tools: state,
        armed: family,
        fill: solve,
        apply: run,
        style: styleOf,
        catalog: table,
      } = latest.current
      // `pressMeaning` and not a branch of its own: the pointer and the keyboard
      // both arrive here, and a second reading of "what does a press at this
      // point mean" is a second thing to keep in step with the first.
      const meaning = pressMeaning(current, at, family !== null)
      if (meaning.kind === 'camera') return
      if (meaning.kind === 'deselect') {
        state.select(null)
        return
      }
      if (meaning.kind === 'select') {
        state.select(meaning.id)
        const piece = resolveSelection(current, meaning.id)
        if (piece !== null) latest.current.say(`${pieceName(piece)} selected.`)
        return
      }
      const solved = family === null ? undefined : solve(family, state.armedSize)
      // The projection is the whole of the refusal, and it is computed here
      // rather than inside `planPlacement` for that module's own reason: it is
      // pure, and projecting needs a catalog and a style resolver. So the
      // component resolves the candidate and the verdict reads it.
      const projection =
        family === null
          ? undefined
          : projectPlacement(
              table,
              styleOf,
              current,
              family,
              templateGhost(family, state.rotation, at, state.step).anchor,
              state.rotation,
              solved?.fills ?? {},
            )
      run(planPlacement(family, state.rotation, at, state.step, solved, projection))
    },
    [],
  )

  /* -------------------------------------------------------------- the pointer */

  /** The press being tracked, or `null`. `claimed` means the surface took it. */
  const press = useRef<{ x: number; y: number; button: number; claimed: boolean } | null>(null)

  /**
   * Where a **secondary** press started, or `null`. Its own ref, deliberately.
   *
   * Two refs rather than one with a `button` field, and the second one is worth
   * a paragraph because the alternative reintroduces a bug this file already
   * fixed once: `press` is read by `onUp` *whatever button was released*, so
   * with a right press recorded in the same slot a chorded gesture resolves as
   * the wrong one — hold the primary button, right-click without releasing it,
   * and the release passes the 5 px test against the *primary* press and places
   * a tile. Keeping the two apart makes each release read only its own press.
   *
   * There is no `claimed` on this one and there never can be: claiming a
   * secondary press would take the camera pan away from the right button.
   */
  const secondary = useRef<{ x: number; y: number } | null>(null)


  useEffect(() => {
    const canvas = gl.domElement
    // The capture-phase host: see the docblock. `parentElement` is r3f's own
    // wrapper div and is always there in practice; the canvas itself is the
    // honest fallback and degrades to "OrbitControls may also see the press",
    // which is the behaviour without this listener at all.
    const host = canvas.parentElement ?? canvas

    /**
     * The glow's switch: on when the hand is empty, off while a button is held.
     *
     * Written through {@link buttonHeld} so a move that changes nothing costs
     * nothing, which is what makes this affordable on a `pointermove`.
     */
    const glowWhileHeld = (held: boolean) => {
      if (buttonHeld.current === held) return
      buttonHeld.current = held
      setDragging(held)
    }

    /**
     * A secondary release: the slot editor, if the gesture was a click.
     *
     * The 5 px test first and the pick second, in that order, because the pick
     * is a raycast against every occupied elevation and a pan gesture must not
     * pay for it. `planSlotEdit` decides the rest — including both arms that
     * open nothing, each of which still says so.
     */
    const onDown = (event: PointerEvent) => {
      // A secondary press is **recorded and never claimed**. Not claimed,
      // because `OrbitControls` binds the right button to `MOUSE.PAN` and
      // `Stage` passes `enablePan` — so every pan gesture starts with one, and
      // claiming it would take panning away from the button. Recorded, so the
      // release can ask the 5 px question and tell a *click* from a pan.
      //
      // The one thing a right-click does is **cancel what is armed**, which is
      // the affordance `ArmedLabel` states. That is a much safer thing to hang
      // on this button than the slot editor row C3 hung here: a stray cancel
      // costs one click to undo by re-arming, where a stray dialog interrupted
      // the pan it was mistaken for. It is also why a bare `contextmenu`
      // listener is still the wrong seam — that event fires from the mouse
      // *down* on X11 and macOS, before any travel exists to measure.
      if (event.button === SECONDARY_BUTTON) {
        secondary.current = { x: event.clientX, y: event.clientY }
        return
      }
      if (event.button !== 0) return
      // **The bug class, not one instance.** This listener is on the canvas's
      // *parent* in the capture phase and calls `stopPropagation` on the presses
      // it claims, and drei's `<Html>` portals its overlays into that same
      // parent. Without this guard, no button on the selection's action bar — or
      // on any overlay added inside the host later — is ever clickable, because
      // the press is swallowed before it reaches the button. Moving one portal
      // elsewhere would leave the trap armed for the next one.
      if (!claimsPress(event.target, canvas)) return
      const { scene: current, tools: state } = latest.current
      const pick = pickAt(event.clientX, event.clientY)
      if (pick === null) return
      setCursor(pick.point)

      // A press on a piece with nothing armed **selects it and picks it up in
      // one gesture** — the editor "tweak": press to select, then drag to move,
      // with no intermediate click. A press on bare ground is not claimed, so it
      // orbits, which is what keeps the camera reachable without a mode.
      const meaning = pressMeaning(current, pick.point, state.selectedTemplate !== null)
      if (meaning.kind === 'select') {
        state.select(meaning.id)
        const grabbed = planGrab(current, pick.point, pick.point)
        if (grabbed.drag !== null) {
          // Claimed: the orbit must not also run, or the camera swings while the
          // piece is being carried.
          event.stopPropagation()
          event.preventDefault()
          press.current = { x: event.clientX, y: event.clientY, button: event.button, claimed: true }
          setDrag(grabbed.drag)
          if (typeof canvas.setPointerCapture === 'function') canvas.setPointerCapture(event.pointerId)
          invalidate()
          return
        }
        // Selectable but not grabbable. The selection stands; the press is left
        // to the camera rather than being claimed for a drag that cannot start.
        latest.current.say(grabbed.message)
      }

      // Not claimed: `OrbitControls` gets the press and orbits. Whether the
      // release also edits the plan is decided by the 5 px test on `pointerup`.
      press.current = { x: event.clientX, y: event.clientY, button: event.button, claimed: false }
    }

    const onMove = (event: PointerEvent) => {
      // A held button means the camera, here: left orbits and right pans. So the
      // hover glow goes out for the duration, because a cue that hops from piece
      // to piece while the view swings under a stationary hand is worse than no
      // cue — the brief's own point, and this is the answer to it. A press with
      // no travel never reaches this line, so a click keeps its glow.
      glowWhileHeld(event.buttons !== 0)
      const pick = pickAt(event.clientX, event.clientY)
      if (pick === null) {
        setCursor(null)
        return
      }
      setCursor(pick.point)
      setKeyCursor(false)
      const held = latest.current.drag
      if (held !== null && press.current?.claimed === true) {
        // A pointer drag is not announced step by step: the outline is following
        // the pointer, and a live region firing on every one of the hundreds of
        // moves in a drag would drown the drop that matters.
        setDrag(dragMoveTo(held, pick.point, latest.current.tools.step))
      }
      invalidate()
    }

    const onUp = (event: PointerEvent) => {
      // Whatever the release was, it ended it: the glow comes back on the piece
      // the pointer finished over, without waiting for the next move.
      glowWhileHeld(false)
      if (event.button === SECONDARY_BUTTON) {
        const from = secondary.current
        secondary.current = null
        // A pan, not a click. Nothing to do; the camera already moved.
        if (from === null || !isClickGesture(from, { x: event.clientX, y: event.clientY })) return
        if (latest.current.tools.selectedTemplate !== null) {
          latest.current.tools.arm(null)
          latest.current.say('Nothing armed.')
        }
        return
      }
      const started = press.current
      press.current = null
      if (started === null) return
      if (typeof canvas.hasPointerCapture === 'function' && canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId)
      }

      if (started.claimed) {
        const held = latest.current.drag
        setDrag(null)
        if (held === null) return
        // The same 5 px question the unclaimed path asks, and it has to be asked
        // here too now that a press on a piece is claimed for the tweak: a
        // *click* on a piece is a selection and nothing else, and running it
        // through `planDrop` would announce "left at (4, 7). Nothing moved." on
        // every selecting click. A press that travelled is a real move.
        if (isClickGesture(started, { x: event.clientX, y: event.clientY })) {
          const piece = resolveSelection(latest.current.scene, latest.current.tools.selected)
          if (piece !== null) latest.current.say(`${pieceName(piece)} selected.`)
          return
        }
        latest.current.apply(planDrop(held, latest.current.scene))
        return
      }
      // The mockup's own test, and the whole of the orbit/click distinction.
      if (!isClickGesture(started, { x: event.clientX, y: event.clientY })) return
      const pick = pickAt(event.clientX, event.clientY)
      if (pick === null) return
      setCursor(pick.point)
      actAt(pick.point)
    }

    const onLeave = () => {
      glowWhileHeld(false)
      // The mockup hides its ghost here too: a ghost frozen at the edge of the
      // canvas after the pointer has gone is a tile that looks placed and is not.
      setCursor(null)
      invalidate()
    }

    const onCancel = (event: PointerEvent) => {
      glowWhileHeld(false)
      secondary.current = null
      const started = press.current
      press.current = null
      if (started?.claimed !== true) return
      const held = latest.current.drag
      setDrag(null)
      if (held !== null) latest.current.say(describeAbandon(held, latest.current.scene))
      if (typeof canvas.hasPointerCapture === 'function' && canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId)
      }
    }


    host.addEventListener('pointerdown', onDown, true)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('pointercancel', onCancel)
    return () => {
      host.removeEventListener('pointerdown', onDown, true)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('pointercancel', onCancel)
    }
  }, [actAt, gl, invalidate, pickAt])

  /* ------------------------------------------------------------- the keyboard */

  const navIndex = useRef(-1)

  /**
   * The cursor, one snap step over — and **a frame asked for**, which row D3
   * found missing rather than added.
   *
   * `frameloop` is `demand`, so a state change that nothing invalidates is not
   * drawn. Every other cursor writer already asked: `onMove` invalidates on
   * every pointer move, `nudge` invalidates for the held piece, and the effect
   * below invalidates when the ghost, the preview, the plates or the focus ring
   * change. The two **keyboard** cursor writers — this and
   * {@link stepToPiece} — did not, and the cursor is not in that effect's
   * dependencies, so with nothing armed there was no `ghost` to change and an
   * arrow key moved the caret in state without redrawing it. The glow inherits
   * exactly the same path, which is how the omission surfaced.
   */
  const moveCursor = useCallback(
    (dx: number, dz: number) => {
      const { tools: state } = latest.current
      const [x, z] = cursorRef.current ?? [0, 0]
      const next: PlanPoint = [snapTo(x + dx, state.step), snapTo(z + dz, state.step)]
      setCursor(next)
      setKeyCursor(true)
      const piece = pieceAt(latest.current.scene, next)
      latest.current.say(
        `${describeCell(next[0], next[1])} — ${piece === undefined ? 'empty' : piece.label}${piece?.conflict === true ? ', overlapping' : ''}`,
      )
      invalidate()
    },
    [invalidate],
  )

  /**
   * Move the selection by one snap step, with no drag in the air.
   *
   * **A one-shot grab, drop and announce**, rather than the {@link nudge} path,
   * which nudges a piece the user is already carrying. The two are not the same
   * gesture: a carried piece is ephemeral component state and commits on release,
   * where an arrow key on a selection is a complete edit — so this writes to the
   * store once per press, which is exactly what undo wants to see.
   *
   * The refusal path is `move.ts`'s and is not re-decided here: a nudge into an
   * exact overlap comes back as an uncommittable preview, is said out loud, and
   * the piece stays where it was.
   */
  const nudgeSelection = useCallback((dx: number, dz: number) => {
    const { scene: current, tools: state, apply: run } = latest.current
    const chosen = resolveSelection(current, state.selected)
    if (chosen === null) return
    const proposed = nudgeMove(beginMove(chosen, null), dx, dz, state.step)
    const preview = previewMove(proposed, current)
    if (preview === undefined) return
    if (!preview.committable) {
      latest.current.say(preview.refusal?.message ?? describeNudge(preview))
      invalidate()
      return
    }
    run(planDrop(proposed, current))
    const box = preview.moved.box
    setCursor([box.x + box.w / 2, box.z + box.d / 2])
    invalidate()
  }, [invalidate])

  const nudge = useCallback(
    (dx: number, dz: number) => {
      const held = latest.current.drag
      if (held === null) return
      const next = nudgeMove(held, dx, dz, latest.current.tools.step)
      const preview = previewMove(next, latest.current.scene)
      if (preview === undefined) {
        setDrag(null)
        return
      }
      setDrag(next)
      // The **proposed** box — `moved` is the whole piece re-projected at the
      // anchor the nudge just produced — so the cursor lands on the centre of
      // where the piece would be, not on where it still is.
      const box = preview.moved.box
      setCursor([box.x + box.w / 2, box.z + box.d / 2])
      latest.current.say(describeNudge(preview))
      invalidate()
    },
    [invalidate],
  )

  /**
   * `[` and `]`: the cursor onto the next piece — which now **rings** it.
   *
   * The glow follows the cursor and not the pointer, so this navigation got a
   * visible subject for free: a keyboard user stepping through a room sees each
   * piece outlined as it is announced. That is the accessibility half of row D3
   * and it cost one call to {@link invalidate} — see {@link moveCursor} for why
   * that call was missing here too.
   */
  const stepToPiece = useCallback(
    (direction: 1 | -1) => {
      const order = navigationOrder(latest.current.scene)
      if (order.length === 0) {
        latest.current.say('No tiles placed yet.')
        return
      }
      navIndex.current = (navIndex.current + direction + order.length) % order.length
      const piece = order[navIndex.current] as ScenePiece
      setCursor([piece.box.x + piece.box.w / 2, piece.box.z + piece.box.d / 2])
      setKeyCursor(true)
      // **Selects, not merely announces**, and that is what makes this the
      // primary keyboard route rather than a readout. Every verb acts on the
      // selection, so stepping onto a piece has to *be* selecting it or a
      // keyboard user could reach a piece and then have nothing to press.
      latest.current.tools.select(piece.id)
      latest.current.say(`${String(navIndex.current + 1)} of ${String(order.length)}: ${piece.label}`)
      invalidate()
    },
    [invalidate],
  )

  useEffect(() => {
    const canvas = gl.domElement
    // The canvas is the work surface, so it is the tab stop and it takes the
    // arrow keys. Set here rather than on `<Canvas>` because r3f puts unknown
    // props on its wrapper div, and the element the keys have to reach is the
    // one the pointer listeners are on.
    canvas.tabIndex = 0
    canvas.setAttribute('role', 'application')
    canvas.setAttribute('aria-roledescription', '3D plan')
    canvas.setAttribute('aria-describedby', keyHelpId)

    const onKey = (event: KeyboardEvent) => {
      const { tools: state, scene: current, armed: family, apply: run } = latest.current
      const step = state.step * (event.shiftKey ? FAST_STEPS : 1)
      const at = cursorRef.current
      const handled = () => {
        event.preventDefault()
        event.stopPropagation()
      }

      // A piece in the air claims six keys; everything else falls through and
      // keeps working, because the drag is component state and depends on none
      // of it. Switching snap mid-carry changes the step the arrows travel,
      // which is what a builder wants.
      if (latest.current.drag !== null) {
        switch (event.key) {
          case 'ArrowLeft': handled(); nudge(-step, 0); return
          case 'ArrowRight': handled(); nudge(step, 0); return
          case 'ArrowUp': handled(); nudge(0, -step); return
          case 'ArrowDown': handled(); nudge(0, step); return
          case 'Enter':
          case ' ': {
            handled()
            const held = latest.current.drag
            setDrag(null)
            if (held !== null) run(planDrop(held, current))
            return
          }
          case 'Escape': {
            handled()
            const held = latest.current.drag
            setDrag(null)
            if (held !== null) latest.current.say(describeAbandon(held, current))
            return
          }
          case 'Delete':
          case 'Backspace': {
            handled()
            const held = latest.current.drag
            const piece = held === null ? undefined : findPiece(current, held.id)
            setDrag(null)
            if (piece !== undefined) run(removalOf(piece))
            return
          }
          default:
            break
        }
      }

      // Undo first, and modifier-qualified, so it cannot be shadowed by a bare
      // letter below. `metaKey` as well as `ctrlKey`: on macOS the gesture is
      // Cmd+Z, and a builder that only answered Ctrl would appear to have no
      // undo at all on half the platforms the app ships to.
      if ((event.ctrlKey || event.metaKey) && (event.key === 'z' || event.key === 'Z')) {
        handled()
        const said = event.shiftKey ? latest.current.history.redo() : latest.current.history.undo()
        latest.current.say(said ?? (event.shiftKey ? 'Nothing to redo.' : 'Nothing to undo.'))
        return
      }
      if ((event.ctrlKey || event.metaKey) && (event.key === 'y' || event.key === 'Y')) {
        handled()
        latest.current.say(latest.current.history.redo() ?? 'Nothing to redo.')
        return
      }

      const chosen = resolveSelection(current, state.selected)

      switch (event.key) {
        // The arrows do one of two things, and which one is a fact about the
        // state rather than a mode: with a selection they nudge **the piece**,
        // and with none they walk the plan cursor so a keyboard user can reach
        // a piece to select in the first place.
        case 'ArrowLeft': handled(); if (chosen !== null) nudgeSelection(-step, 0); else moveCursor(-step, 0); return
        case 'ArrowRight': handled(); if (chosen !== null) nudgeSelection(step, 0); else moveCursor(step, 0); return
        case 'ArrowUp': handled(); if (chosen !== null) nudgeSelection(0, -step); else moveCursor(0, -step); return
        case 'ArrowDown': handled(); if (chosen !== null) nudgeSelection(0, step); else moveCursor(0, step); return
        case 'Enter':
        case ' ': {
          handled()
          // On a selection, `Enter` opens its slots — the gesture the right
          // click used to carry, moved to the keyboard path that has an operand.
          if (chosen !== null) {
            const asked = planSlotEdit(current, [chosen.placement.x, chosen.placement.z])
            latest.current.say(asked.message)
            if (asked.placement !== null) latest.current.onEditSlots?.(asked.placement, asked.slot)
            return
          }
          if (at === null) {
            latest.current.say('Move the cursor onto the plan first.')
            return
          }
          actAt(at)
          return
        }
        case 'Delete':
        case 'Backspace':
          handled()
          // The selection, not the cursor. This is the whole of what replaced
          // erase mode: one operand, chosen deliberately, and undo behind it.
          if (chosen !== null) run(removalOf(chosen))
          else latest.current.say('Nothing selected. Click a template to select it.')
          return
        case 'r':
        case 'R': {
          handled()
          // No `sticky` ref any more. It existed to remember which piece `R`
          // turned last, because the pointer may have moved off it between
          // presses — which is exactly the job a selection does, and does
          // without a second piece of state that can disagree with the drawing.
          const edit = planTurn(current, chosen?.id ?? null, chosen ?? undefined, family, state.rotation, event.shiftKey ? -1 : 1)
          run(edit)
          return
        }
        case '[': handled(); stepToPiece(-1); return
        case ']': handled(); stepToPiece(1); return
        case 'Escape':
          handled()
          // One key, two things to let go of, and they are mutually exclusive
          // so there is no precedence to decide: disarm the palette, or drop the
          // selection.
          if (state.selectedTemplate !== null) {
            state.arm(null)
            latest.current.say('Nothing armed.')
          } else if (state.selected !== null) {
            state.select(null)
            latest.current.say('Nothing selected.')
          }
          return
        case 'g':
        case 'G': {
          handled()
          state.toggleSnap()
          latest.current.say(`Snap ${state.snap === 'fine' ? '1' : '0.5'} units.`)
          return
        }
        default:
          return
      }
    }

    const onFocus = () => {
      // Put the keyboard cursor somewhere visible if it has nowhere yet, so
      // tabbing to the surface has an **in-scene** cue rather than only a ring
      // around the viewport. A `role="application"` tab stop has to show that it
      // holds the keys, and the caret says it where the user is looking;
      // `builder3d.css` carries why the ring itself is as quiet as it is.
      if (cursorRef.current === null) {
        setCursor([0, 0])
        setKeyCursor(true)
        invalidate()
      }
    }

    /*
      **The key map listens on the window, not on the canvas, and that is a bug
      fix rather than a widening.**

      It was on the `<canvas>`, which is a `tabIndex = 0` element — so every
      shortcut needed the canvas to hold focus. Nothing on this screen keeps it
      there: arming a family means clicking a *palette row*, which is a
      `<button>` and takes focus, so `R` and `Escape` reached the palette and did
      nothing. Pressing `Undo` on the rail broke `Ctrl`+`Z` the same way. The
      class is *any* chrome interaction, and fixing it per control — a
      `preventDefault` on every button — is both whack-a-mole and wrong for a
      keyboard user who has to be able to Tab to those buttons.

      What made it survivable until now was the toolbar's `Rotate`, which turned
      the armed ghost on a click and needed no focus at all. That button is gone,
      so the key is the only route and it has to work from anywhere.

      Two guards keep it from being a land grab:

        - **Never while typing.** A form field or a `contenteditable` owns its own
          keys — the palette's search box is one, and `r` in it must type an `r`.
        - **Never while a dialog is open.** The slot editor and the two pickers
          are modals: `Escape` there belongs to the dialog, and a shortcut firing
          behind one would edit a room the user cannot see. Suspending the whole
          map while any dialog is up is the correct modal behaviour and needs no
          per-key exceptions.
    */
    const typingIn = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false
      if (target.isContentEditable) return true
      return ['input', 'textarea', 'select'].includes(target.tagName.toLowerCase())
    }
    const guarded = (event: KeyboardEvent) => {
      if (typingIn(event.target)) return
      if (document.querySelector('[role="dialog"], [role="alertdialog"]') !== null) return
      onKey(event)
    }

    canvas.addEventListener('focus', onFocus)
    window.addEventListener('keydown', guarded)
    return () => {
      canvas.removeEventListener('focus', onFocus)
      window.removeEventListener('keydown', guarded)
    }
  }, [actAt, gl, keyHelpId, moveCursor, nudge, stepToPiece])

  /** The label is the room's summary and changes as the room does. */
  useEffect(() => {
    gl.domElement.setAttribute('aria-label', label)
  }, [gl, label])

  /* ---------------------------------------------------------------- the status */

  const hint = useMemo(
    () =>
      describeSurfaceHint({
        activity: tools.activity,
        armed,
        selected: selectedPiece ?? undefined,
        under,
        moving,
        onPlan: cursor !== null,
        waiting: plated.length,
        unfilled: scene.unfilled.length,
        blocked: armedGhost?.blocking,
      }),
    [
      tools.activity,
      armed,
      selectedPiece,
      under,
      moving,
      cursor,
      plated.length,
      scene.unfilled.length,
      armedGhost,
    ],
  )

  const status = useMemo<SurfaceStatus>(
    () => ({
      cursor: cursor ?? [0, 0],
      snap: tools.snap,
      step: tools.step,
      activity: tools.activity,
      hint,
      // The armed family's name while armed, and the selected piece's while
      // selected — the two are exclusive, so one field answers for both and the
      // readout never has to show two names or choose between them.
      selectedName: ghost?.name ?? (selectedPiece === null ? null : pieceName(selectedPiece)),
      // Nothing left to refuse about an armed family — see `edits.ts`. It stays a
      // field of the readout because `move.ts` and row C2's solver both have
      // refusals to put in it, and a `null` here is a true statement about the
      // *place* gesture rather than a placeholder.
      refusal: null,
      moving: moving === undefined ? null : pieceName(moving.piece),
      // Instances with nothing chosen are placements — they are in the store, they
      // can be filled and they can be removed — so a count that omitted them
      // would say "0 placed" about a room the user has just clicked five times
      // into.
      placements: scene.pieces.length + scene.unfilled.length,
      conflicts: scene.conflicts.size,
    }),
    [cursor, tools.snap, tools.step, tools.activity, hint, ghost, moving, scene, selectedPiece],
  )

  useEffect(() => {
    onStatus(status)
  }, [onStatus, status])

  // `frameloop="demand"`: nothing redraws unless something asks, and everything
  // this component draws is derived from state the renderer knows nothing about.
  useEffect(() => {
    invalidate()
    // `keyCursor` is deliberately **not** a dependency, where `focused` used to
    // be. Every writer of it already asks for a frame — `moveCursor`,
    // `stepToPiece`, `onMove` and `onFocus` all call `invalidate` themselves —
    // so listing it here bought a *second* frame on the press that first shows
    // the caret. Measured by the frame-economy test below it: one arrow key went
    // from 1 invalidation to 2.
  }, [invalidate, ghost, moving, plated, room])

  /* --------------------------------------------------------------- the drawing */

  /**
   * The piece in the air, as parts with their own matrices — row A4b.
   *
   * `moving.moved` is the whole piece re-projected at the proposed anchor, so the
   * preview is built by the same walk over `parts` that draws the scene: one
   * translucent copy per slot, at that slot's own box, angle and elevation. The
   * flat `box`/`angle`/`axisAligned` triple this used to read is gone from
   * `MovePreview`, which is contract **C-h** doing its job — a wall of a corner
   * template would have been drawn at the floor's angle and nothing would have
   * complained.
   *
   * A part with no mesh contributes a translucent plate rather than nothing, so
   * a template halfway through loading still shows its full outline while it
   * is carried.
   */
  const movingParts = useMemo<readonly MovingPart[]>(() => {
    if (moving === undefined) return []
    const piece = moving.moved
    const alarmed = moving.refusal !== null || moving.conflict
    // A generated base has never been in the mesh store — `buildRoom3D` walks
    // `scene.pieces` alone — so its preview is a plate by construction rather
    // than as a fallback, exactly as its placed form is.
    if (piece.kind === 'generated') {
      return [
        {
          key: piece.id,
          polygons: piece.polygons,
          matrix: null,
          geometry: undefined,
          tint: alarmed ? ACCENT : piece.style.tint,
          plateHeightMm: PLATE_HEIGHT_MM * 2,
        },
      ]
    }
    return piece.parts.map((part) => {
      const lod = geometries.get(part.record.blob)
      return {
        key: `${piece.id}:${part.slot}`,
        polygons: part.polygons,
        matrix:
          lod === undefined
            ? null
            : liftMatrix(
                tileMatrix(lod.bounds, {
                  shape: part.shape,
                  rotation: piece.placement.rotation,
                  angle: part.angle,
                  box: part.box,
                  parts: part.polygons,
                  axisAligned: part.axisAligned,
                }),
                part.layout.elevationMm,
              ),
        geometry: lod?.geometry,
        tint: alarmed ? ACCENT : part.style.tint,
        plateHeightMm: part.layout.elevationMm + PLATE_HEIGHT_MM * 2,
      }
    })
  }, [moving, geometries])

  return (
    <group scale={fit.scale}>
      <Lattice />

      {/*
        One list, because a base is one part of a template like any other. Row
        R3 drew a `baseGroups` list first and called it *"what a base is rather
        than a tie-break"*; with the base declared as a slot there is no second
        list to order, and in 3D there is no paint order to get wrong either — a
        pick is a raycast and the nearest hit wins by geometry.
      */}
      {room.groups.map((group: LodInstanceGroup) => (
        <InstancedTiles key={group.key} group={group} />
      ))}

      {plated.map((plate) => (
        <FootprintPlate
          key={plate.key}
          parts={plate.polygons}
          geometry={plate.geometry}
          tint={plate.tint}
          edge={plate.edge}
          heightMm={plate.heightMm}
        />
      ))}

      {/*
        What the next click will place, and how to stop — at the cursor, where
        the eye already is.

        The armed state used to announce itself only in the two corner plates of
        a full-bleed viewport, and neither of them said how to *stop*: `Escape`
        disarmed and always did, and nothing on screen mentioned it. A user who
        armed a family by accident had a ghost following their pointer and a
        primary button that placed a tile wherever they clicked next.

        Anchored at the ghost's own snapped anchor rather than at the raw
        cursor, so the label sits still while the pointer moves within a cell —
        the same value the projection is memoised on. `ArmedLabel` carries why it
        takes no pointer events, which is the constraint that makes it a label
        rather than a control.
      */}
      {ghost === null || armed === null ? null : (
        <ArmedAnchor anchor={ghost.anchor} name={ghost.name} blocked={armedGhost?.blocking} />
      )}

      {/*
        The selection's **persistent** cue, on the plan.

        The outline pass carries whichever cue is live — the selection, or the
        hover when nothing is selected — because it is one pass with one colour
        and `Stage.tsx` is deliberate about it costing one fullscreen quad. That
        leaves a gap this fills: while the pointer hovers a *different* piece,
        the pass is drawing that one, and the user still needs to see what is
        selected.

        A contour on the footprint answers it, and it is **D3's rejected drawing
        used correctly**. D3 built the *hover* cue this way — a flat loop lifted
        to a part's top height — and the owner's diagnosis was right: as a
        silhouette substitute it was the plan view floating in the air above the
        mesh, and occludable. On the ground, where the piece's footprint
        actually is, it is none of those things. It is what `markers.ts` exists
        to draw.

        No new geometry function: `plateEdgePositions` already traces the convex
        parts, so the marker and the plates come out of one derivation and
        cannot disagree about where a piece is.
      */}
      {selectedPiece !== null && (
        <SelectionMark parts={selectedPiece.polygons} colour={ACCENT} />
      )}

      {/*
        The selection's verbs, anchored to the piece they act on.

        `key` on the placement id, which is what resets the bar's own disclosure
        state when the selection moves to another piece: an expanded slot editor
        left open across a change of subject would be showing one piece's parts
        under another piece's name.

        Absent when there is no selection, so the DOM has no inert overlay over
        the canvas — which matters because the capture-phase listener would
        otherwise have a target to ignore on every press.
      */}
      {selectedPiece !== null && (
        <SelectionAnchor
          key={selectedPiece.id}
          piece={selectedPiece}
          heightMm={heightOf(selectedPiece)}
          {...(onEditSlots === undefined
            ? {}
            : {
                onEditSlots: () => {
                  // `planSlotEdit` and not a bare `onEditSlots(id)`: it is the
                  // one place that decides *which slot* a request opens on, and
                  // the piece's own anchor is the honest point to ask about when
                  // the request came from a button rather than from a pointer.
                  const asked = planSlotEdit(scene, [
                    selectedPiece.placement.x,
                    selectedPiece.placement.z,
                  ])
                  say(asked.message)
                  if (asked.placement !== null) onEditSlots(asked.placement, asked.slot)
                },
              })}
          onTurn={() => {
            apply(planTurn(scene, selectedPiece.id, selectedPiece, armed, tools.rotation, 1))
          }}
          onRemove={() => {
            apply(removalOf(selectedPiece))
          }}
        />
      )}

      {/*
        The hover cue is **not drawn here**, and that is row D7's whole shape. It
        is a silhouette of the geometry above rather than a loop beside it, so it
        cannot be a line in this tree: it is a post pass over the frame this tree
        renders, and what this component contributes is {@link silhouettes} —
        published through `onOutline`, drawn by `Stage`'s outline pass, in
        `Stage.tsx` and `src/three/outline.ts`.

        Row C8 is why the cue has to exist at all: a right click opens the slot
        editor on whichever piece the pointer resolves to, so a user has to be
        able to see which piece that is before pressing. Erase and move have had
        the same problem for longer.

        The cue names the **instance** and not the slot, even though a right click
        does resolve one level further. That level stays undrawn for the reason
        D3 gave and the pass now enforces: the mask is the union of the piece's
        parts, so a second "resolved part" silhouette inside it would trace a
        boundary that is not there. The slot is named in words instead, by
        `planSlotEdit`, on the one gesture that uses it.
      */}

      {/*
        The armed marker: one cell at the snapped anchor, with no mesh behind it
        and none available — `edits.ts#templateGhost` sets out why, and the
        module note calls it the one capability this row lost. Drawn through
        `Ghost` with a null matrix, which is the path a tile whose mesh had not
        arrived already took, so there is no second absent-geometry state.
      */}
      {/*
        The ghost, as the real parts where they are known and as the one-cell
        marker where they are not — a caller with no recipe for the armed family
        still gets something under the pointer rather than nothing, which is
        `edits.ts#templateGhost`'s own argument for the marker existing at all.

        A **blocked** ghost is tinted with the refusal colour *and* hatched: it is
        the one state on this surface where the drawing has to say "this click
        will do nothing", and colour is never the sole carrier of that.
      */}
      {ghost === null
        ? null
        : (armedGhost?.piece?.parts ?? []).length > 0
          ? armedGhost?.piece?.parts.map((part) => (
              <Ghost
                key={`${ghost.anchor[0]}:${ghost.anchor[1]}:${part.slot}`}
                parts={part.polygons}
                matrix={null}
                geometry={undefined}
                tint={armedGhost.blocking.length > 0 ? BLOCKED : ACCENT}
                plateHeightMm={part.layout.elevationMm + PLATE_HEIGHT_MM * 2}
              />
            ))
          : (
              <Ghost
                parts={ghost.polygons}
                matrix={null}
                geometry={undefined}
                tint={ACCENT}
                plateHeightMm={PLATE_HEIGHT_MM * 2}
              />
            )}

      {movingParts.map((part) => (
        <Ghost
          key={part.key}
          parts={part.polygons}
          matrix={part.matrix}
          geometry={part.geometry}
          tint={part.tint}
          plateHeightMm={part.plateHeightMm}
        />
      ))}

      {keyCursor && cursor !== null ? <Caret at={cursor} colour={ACCENT} /> : null}
    </group>
  )
}

/** One plate to draw: a geometry, an outline, two colours and a height. */
interface PlatedPart {
  /** Stable across renders: the placement, then the slot. */
  readonly key: string
  /**
   * The piece this plate belongs to.
   *
   * Row D7: the hover cue asks *"which of these plates is the piece under the
   * pointer"*, and a placement id answers it for both populations — a generated
   * base is one plate keyed by its own id, a catalog part one plate per waiting
   * slot. Deriving it back out of {@link key} would be string surgery on a
   * composite, which is what a second field costs less than.
   */
  readonly pieceId: PlacementId
  readonly polygons: readonly PlanPart[]
  /** Built and disposed by the surface; drawn by the plate and outlined by the cue. */
  readonly geometry: BufferGeometry
  readonly tint: string
  readonly edge: string
  readonly heightMm: number
}

/** One translucent part of the piece in the air. */
interface MovingPart {
  readonly key: string
  readonly polygons: readonly PlanPart[]
  /** `null` when this part's mesh has not arrived; the plate is drawn instead. */
  readonly matrix: Matrix4 | null
  readonly geometry: BufferGeometry | undefined
  readonly tint: string
  readonly plateHeightMm: number
}

/** One raycaster for the life of the module. A pointer move must not allocate. */
const CASTER = new Raycaster()

/* -------------------------------------------------------------------- helpers */

function findPiece(scene: PlanScene, id: PlacementId): ScenePiece | undefined {
  return scene.pieces.find((piece) => piece.id === id) ?? scene.generated.find((piece) => piece.id === id)
}
