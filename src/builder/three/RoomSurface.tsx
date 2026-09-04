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
 *      union of parts row **C2**'s fill solver has not chosen yet — so there is
 *      no mesh to draw and no footprint to fall back to.
 *      `edits.ts#templateGhost` states exactly what the marker claims. **This is
 *      the one place the surface got less capable this row**, and it is temporary
 *      in the precise sense that one call restores it: `computeGhost` over a
 *      solved fill map, fed through `reanchorPiece`, which is what A4a suggests.
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
 * template is placed and rotated as one unit. `partAt` is the other half of a
 * pick and is deliberately not called here: it names the *slot* a point landed
 * in, which is the slot editor's question rather than the surface's.
 * `subjectsConflict` is reached only through `pieceAt` and the move. There is no
 * second geometry in this file and no second opinion about where anything is.
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
import type { BufferGeometry, Matrix4, Mesh } from 'three'
import { Raycaster } from 'three'

import type {
  MoveDrag,
  PlanPart,
  PlanPiecePart,
  PlanPoint,
  PlanScene,
  PlanTools,
  ScenePiece,
} from '@/builder/canvas'
import {
  describeCell,
  describeNudge,
  dragMoveTo,
  navigationOrder,
  nudgeMove,
  pieceAt,
  pieceName,
  previewMove,
  snapTo,
} from '@/builder/canvas'
import { GRID_UNIT_MM } from '@/catalog'
import type { PlacementId, TemplateId } from '@/store'
import {
  moveGeneratedPlacement,
  movePlacement,
  placeTemplate,
  removeGeneratedPlacement,
  removePlacement,
  rotateGeneratedPlacement,
  rotatePlacement,
} from '@/store'

import type { SurfaceEdit, SurfaceStatus, TemplateGhost } from './edits'
import {
  describeAbandon,
  describeSurfaceHint,
  planDrop,
  planGrab,
  planPlacement,
  planRemoval,
  planTurn,
  removalOf,
  templateGhost,
} from './edits'
import { InstancedTiles } from './InstancedTiles'
import type { LodInstanceGroup, Room3D } from './instances'
import type { LodGeometry } from './loadLod'
import { PLATE_HEIGHT_MM, caretGeometry, plateEdgeGeometry, plateGeometry } from './markers'
import { liftMatrix, tileMatrix } from './place'
import type { SurfaceFit, SurfacePick } from './surface'
import {
  SURFACE_GRID_DROP_MM,
  SURFACE_GRID_UNITS,
  isClickGesture,
  meshHeightMm,
  ndcOf,
  pickSurface,
  pointerRay,
} from './surface'

/** How many snap steps a shifted arrow key travels. `PlanCanvas`'s own. */
const FAST_STEPS = 4

/** The accent, as three cannot read a CSS custom property. `--acc` in `tokens.css`. */
const ACCENT = '#8f5b21'

/** The grid's lines and its two centre lines. `--mut` and `--line`'s dark end. */
const GRID_LINE = '#79684d'
const GRID_AXIS = '#8f5b21'

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
   * thing is *resolved* stays the caller's, which is where it will have to be
   * when row C2's fill solver turns a family into a fill map.
   */
  readonly armed: TemplateId | null
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
  const [focused, setFocused] = useState(false)
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
   * Everything with no mesh, as one flat list of plates — **per part**.
   *
   * Both populations and, since row A4b, both *arities*. A catalog part is
   * waiting on R1's conversion or on a `/lod/` object that is not there; a
   * generated base has never been in this store at all, since `buildRoom3D` walks
   * `scene.pieces` alone. Either way the ground is occupied and must look it.
   *
   * Flattened to parts rather than left as pieces because a three-part template
   * with one converted file is **one mesh and two plates**, and a plate drawn per
   * *piece* would have to choose one of the three outlines to be — which is
   * exactly the single-primitive assumption A1 broke. Each plate takes its own
   * part's tint, elevation and outline, so a wall waiting for a mesh appears at
   * wall height over the floor that has one.
   */
  const plated = useMemo<readonly PlatedPart[]>(() => {
    const plates: PlatedPart[] = [
      ...scene.generated.map((piece) => ({
        key: piece.id,
        id: piece.id,
        polygons: piece.polygons,
        tint: piece.style.tint,
        edge: piece.style.edge,
        heightMm: PLATE_HEIGHT_MM,
      })),
    ]
    for (const piece of scene.pieces) {
      for (const part of piece.parts) {
        if (geometries.has(part.record.blob)) continue
        plates.push({
          key: `${piece.id}:${part.slot}`,
          id: piece.id,
          polygons: part.polygons,
          tint: part.style.tint,
          edge: part.style.edge,
          heightMm: part.layout.elevationMm + PLATE_HEIGHT_MM,
        })
      }
    }
    return plates
  }, [scene, geometries])

  /** The placements with at least one plate on them, for the erase ring's test. */
  const platedIds = useMemo(() => new Set(plated.map((plate) => plate.id)), [plated])

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
   * and the fills come off the verdict rather than being written here, so the day
   * row C2 solves them this line does not change. `edits.ts` sets out why they
   * are empty today and why contract **C-g** makes that a placement rather than a
   * failure.
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
  const latest = useRef({ scene, tools, armed, drag, heightOf, fit, apply, say })
  latest.current = { scene, tools, armed, drag, heightOf, fit, apply, say }

  /** The pick under a pointer event, or `null` when the ray misses the plan. */
  const pickAt = useCallback(
    (clientX: number, clientY: number): SurfacePick | null => {
      const rect = gl.domElement.getBoundingClientRect()
      const ray = pointerRay(camera, ndcOf(clientX, clientY, rect), CASTER)
      return pickSurface(latest.current.scene, ray, latest.current.fit, latest.current.heightOf)
    },
    [camera, gl],
  )

  const actAt = useCallback(
    (at: PlanPoint) => {
      const { scene: current, tools: state, armed: family, apply: run } = latest.current
      if (state.tool === 'erase') run(planRemoval(current, at))
      else run(planPlacement(family, state.rotation, at, state.step))
    },
    [],
  )

  /* -------------------------------------------------------------- the pointer */

  /** The press being tracked, or `null`. `claimed` means the surface took it. */
  const press = useRef<{ x: number; y: number; button: number; claimed: boolean } | null>(null)

  useEffect(() => {
    const canvas = gl.domElement
    // The capture-phase host: see the docblock. `parentElement` is r3f's own
    // wrapper div and is always there in practice; the canvas itself is the
    // honest fallback and degrades to "OrbitControls may also see the press",
    // which is the behaviour without this listener at all.
    const host = canvas.parentElement ?? canvas

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      const { scene: current, tools: state } = latest.current
      const pick = pickAt(event.clientX, event.clientY)
      if (pick === null) return
      setCursor(pick.point)

      // Move mode, or Shift with the primary button in any mode — the same
      // modeless gesture `PlanCanvas` teaches, so the modifier means one thing
      // in both views.
      const wantsMove = state.tool === 'move' || event.shiftKey
      if (wantsMove) {
        const grabbed = planGrab(current, pick.point, pick.point)
        latest.current.say(grabbed.message)
        if (grabbed.drag === null) return
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

      // Not claimed: `OrbitControls` gets the press and orbits. Whether the
      // release also edits the plan is decided by the 5 px test on `pointerup`.
      press.current = { x: event.clientX, y: event.clientY, button: event.button, claimed: false }
    }

    const onMove = (event: PointerEvent) => {
      // Reaching for the mouse ends `R`'s stickiness, exactly as a cursor move
      // does: the sticky target exists so repeated `R` keeps turning the same
      // piece, and pointing somewhere else is the user saying otherwise.
      sticky.current = null
      const pick = pickAt(event.clientX, event.clientY)
      if (pick === null) {
        setCursor(null)
        return
      }
      setCursor(pick.point)
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
      const started = press.current
      press.current = null
      if (started === null) return
      if (typeof canvas.hasPointerCapture === 'function' && canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId)
      }

      if (started.claimed) {
        const held = latest.current.drag
        setDrag(null)
        if (held !== null) latest.current.apply(planDrop(held, latest.current.scene))
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
      // The mockup hides its ghost here too: a ghost frozen at the edge of the
      // canvas after the pointer has gone is a tile that looks placed and is not.
      setCursor(null)
      invalidate()
    }

    const onCancel = (event: PointerEvent) => {
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

  /**
   * The placement `R` is currently turning.
   *
   * Sticky until the pointer or the cursor moves, because turning a piece can
   * move it out from under the point that was clicked — a 2 × 0.5 wall turned
   * 60° no longer covers it — and the next press would then silently turn the
   * *ghost*. `PlanCanvas` learned this; the behaviour has to match or `R` means
   * two different things in the two views.
   */
  const sticky = useRef<PlacementId | null>(null)
  const navIndex = useRef(-1)

  const moveCursor = useCallback((dx: number, dz: number) => {
    const { tools: state } = latest.current
    const [x, z] = cursorRef.current ?? [0, 0]
    const next: PlanPoint = [snapTo(x + dx, state.step), snapTo(z + dz, state.step)]
    sticky.current = null
    setCursor(next)
    const piece = pieceAt(latest.current.scene, next)
    latest.current.say(
      `${describeCell(next[0], next[1])} — ${piece === undefined ? 'empty' : piece.label}${piece?.conflict === true ? ', overlapping' : ''}`,
    )
  }, [])

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

  const stepToPiece = useCallback((direction: 1 | -1) => {
    const order = navigationOrder(latest.current.scene)
    if (order.length === 0) {
      latest.current.say('No tiles placed yet.')
      return
    }
    navIndex.current = (navIndex.current + direction + order.length) % order.length
    const piece = order[navIndex.current] as ScenePiece
    setCursor([piece.box.x + piece.box.w / 2, piece.box.z + piece.box.d / 2])
    latest.current.say(`${String(navIndex.current + 1)} of ${String(order.length)}: ${piece.label}`)
  }, [])

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

      switch (event.key) {
        case 'ArrowLeft': handled(); moveCursor(-step, 0); return
        case 'ArrowRight': handled(); moveCursor(step, 0); return
        case 'ArrowUp': handled(); moveCursor(0, -step); return
        case 'ArrowDown': handled(); moveCursor(0, step); return
        case 'Enter':
        case ' ': {
          handled()
          if (at === null) {
            latest.current.say('Move the cursor onto the plan first.')
            return
          }
          if (state.tool === 'move' || event.shiftKey) {
            const grabbed = planGrab(current, at, null)
            latest.current.say(grabbed.message)
            setDrag(grabbed.drag)
            return
          }
          actAt(at)
          return
        }
        case 'Delete':
        case 'Backspace':
          handled()
          if (at !== null) run(planRemoval(current, at))
          return
        case 'r':
        case 'R': {
          handled()
          const target = at === null ? undefined : pieceAt(current, at)
          const edit = planTurn(current, sticky.current, target, family, state.rotation, event.shiftKey ? -1 : 1)
          sticky.current = edit.kind === 'turn' ? edit.id : null
          run(edit)
          return
        }
        case '[': handled(); stepToPiece(-1); return
        case ']': handled(); stepToPiece(1); return
        case 'g':
        case 'G': {
          handled()
          state.toggleSnap()
          latest.current.say(`Snap ${state.snap === 'fine' ? '1' : '0.5'} units.`)
          return
        }
        case 'e':
        case 'E': handled(); state.setTool('erase'); latest.current.say('Erase mode. Click a tile to remove it.'); return
        case 'p':
        case 'P': handled(); state.setTool('place'); latest.current.say('Place mode.'); return
        case 'm':
        case 'M': handled(); state.setTool('move'); latest.current.say('Move mode. Drag a tile to reposition it.'); return
        default:
          return
      }
    }

    const onFocus = () => { setFocused(true) }
    const onBlur = () => { setFocused(false) }

    canvas.addEventListener('keydown', onKey)
    canvas.addEventListener('focus', onFocus)
    canvas.addEventListener('blur', onBlur)
    return () => {
      canvas.removeEventListener('keydown', onKey)
      canvas.removeEventListener('focus', onFocus)
      canvas.removeEventListener('blur', onBlur)
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
        tool: tools.tool,
        armed,
        under,
        moving,
        onPlan: cursor !== null,
        waiting: plated.length,
        unfilled: scene.unfilled.length,
      }),
    [tools.tool, armed, under, moving, cursor, plated.length, scene.unfilled.length],
  )

  const status = useMemo<SurfaceStatus>(
    () => ({
      cursor: cursor ?? [0, 0],
      snap: tools.snap,
      step: tools.step,
      tool: tools.tool,
      hint,
      selectedName: ghost?.name ?? null,
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
    [cursor, tools.snap, tools.step, tools.tool, hint, ghost, moving, scene],
  )

  useEffect(() => {
    onStatus(status)
  }, [onStatus, status])

  // `frameloop="demand"`: nothing redraws unless something asks, and everything
  // this component draws is derived from state the renderer knows nothing about.
  useEffect(() => {
    invalidate()
  }, [invalidate, ghost, moving, plated, room, focused])

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
   * a template halfway through converting still shows its full outline while it
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
          tint={plate.tint}
          edge={plate.id === under?.id && tools.tool === 'erase' ? ACCENT : plate.edge}
          heightMm={plate.heightMm}
        />
      ))}

      {/*
        The piece under the pointer in erase mode, ringed at its own height, so
        "click to remove that" names a piece the user can see is named. The ring
        is the **instance's** union outline and not a part's, because erase takes
        the whole placement — `removalOf` names one `PlacementId` — and ringing
        one slot of five would promise a removal the store cannot make.
      */}
      {under === undefined || tools.tool !== 'erase' || platedIds.has(under.id) ? null : (
        <PlateOutline parts={under.polygons} colour={ACCENT} heightMm={heightOf(under) + PLATE_HEIGHT_MM} />
      )}

      {/*
        The armed marker: one cell at the snapped anchor, with no mesh behind it
        and none available — `edits.ts#templateGhost` sets out why, and the
        module note calls it the one capability this row lost. Drawn through
        `Ghost` with a null matrix, which is the path a tile whose mesh had not
        arrived already took, so there is no second absent-geometry state.
      */}
      {ghost === null ? null : (
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

      {focused && cursor !== null ? <Caret at={cursor} /> : null}
    </group>
  )
}

/** One plate to draw: an outline, two colours and a height. */
interface PlatedPart {
  /** Stable across renders: the placement, then the slot. */
  readonly key: string
  /** The placement it belongs to, for the erase highlight. */
  readonly id: PlacementId
  readonly polygons: readonly PlanPart[]
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

/* -------------------------------------------------------------------- drawing */

/**
 * The lattice, in millimetres, one inch a division.
 *
 * `GridHelper` rather than a hand-built `LineSegments`, because it is core three
 * — no bundle cost beyond what `Stage` already pulls — and it is one draw call
 * for 388 vertices. Dropped {@link SURFACE_GRID_DROP_MM} below the plan so a
 * floor tile resting on `y = 0` does not z-fight with the line under it.
 *
 * The args array is memoised so r3f constructs the helper once: a fresh array
 * every render would rebuild the geometry on every pointer move.
 */
function Lattice() {
  const args = useMemo<[number, number, string, string]>(
    () => [SURFACE_GRID_UNITS * GRID_UNIT_MM, SURFACE_GRID_UNITS, GRID_AXIS, GRID_LINE],
    [],
  )
  return <gridHelper args={args} position={[0, -SURFACE_GRID_DROP_MM, 0]} />
}

/**
 * A part with no mesh: its tagged footprint, filled and ringed.
 *
 * Flat, 0.6 mm of it, in the part's own material tint with a bright contour —
 * `markers.ts` sets out why that cannot be read as the tile and why it must not
 * be omitted. The geometry is built from the outline's convex parts and disposed
 * explicitly on unmount rather than left to the reconciler, which disposes what
 * it constructed and not what it was handed.
 *
 * Takes `parts` and two colours rather than a piece, which since row **A4b** is
 * the only shape that works: a plate is drawn **per slot**, so it needs that
 * slot's own outline and tint, and a generated base has neither a record nor a
 * slot. `heightMm` is the slot's declared elevation plus the plate's thickness,
 * so a wall waiting for a mesh appears at wall height over the floor that has
 * one.
 */
function FootprintPlate({
  parts,
  tint,
  edge,
  heightMm,
}: {
  parts: readonly PlanPart[]
  tint: string
  edge: string
  heightMm: number
}) {
  const geometry = useMemo(() => plateGeometry(parts, heightMm), [parts, heightMm])
  useEffect(() => () => { geometry.dispose() }, [geometry])

  return (
    <>
      <mesh geometry={geometry} dispose={null}>
        <meshStandardMaterial color={tint} flatShading transparent opacity={0.72} roughness={0.95} metalness={0} />
      </mesh>
      <PlateOutline parts={parts} colour={edge} heightMm={heightMm} />
    </>
  )
}

/** The ring around a plate, or around the piece the erase gesture would take. */
function PlateOutline({
  parts,
  colour,
  heightMm,
}: {
  parts: readonly PlanPart[]
  colour: string
  heightMm: number
}) {
  const geometry = useMemo(() => plateEdgeGeometry(parts, heightMm), [parts, heightMm])
  useEffect(() => () => { geometry.dispose() }, [geometry])

  return (
    <lineSegments geometry={geometry} dispose={null}>
      <lineBasicMaterial color={colour} transparent opacity={0.9} depthWrite={false} />
    </lineSegments>
  )
}

/**
 * The ghost: the tile's own geometry where it will land, translucent.
 *
 * `matrix` comes from `place.ts`'s `tileMatrix` — the *same* call
 * `buildRoom3D` makes for the placed instance — so the ghost and the tile
 * cannot be in different places. When the mesh has not arrived there is no
 * matrix and the footprint plate stands in, which is the same fallback a placed
 * piece gets and for the same reason.
 *
 * The material is this component's own and never `material.ts`'s: that registry
 * refcounts a material shared with the detail viewer, and turning its opacity
 * down for a ghost would make every tile in the drawer translucent.
 */
function Ghost({
  parts,
  matrix,
  geometry,
  tint,
  plateHeightMm = PLATE_HEIGHT_MM * 2,
}: {
  parts: readonly PlanPart[]
  matrix: Matrix4 | null
  geometry: BufferGeometry | undefined
  tint: string
  /**
   * Where the fallback ring is drawn when there is no mesh.
   *
   * A parameter rather than the constant it was, because a part that will land
   * at a slot elevation has to ring the cell at the height it will land at — the
   * same reason the matrix is lifted.
   */
  plateHeightMm?: number
}) {
  const ref = useRef<Mesh>(null)
  useEffect(() => {
    const mesh = ref.current
    if (mesh === null || matrix === null) return
    mesh.matrixAutoUpdate = false
    mesh.matrix.copy(matrix)
    mesh.matrixWorldNeedsUpdate = true
  }, [matrix])

  if (geometry === undefined || matrix === null) {
    return <PlateOutline parts={parts} colour={tint} heightMm={plateHeightMm} />
  }

  return (
    <mesh ref={ref} geometry={geometry} dispose={null}>
      {/* `depthWrite: false` so the ghost does not occlude the tile it is about
          to sit beside, and `flatShading` so it reads as the same kind of object
          as the placed tiles rather than as a smooth blob. */}
      <meshStandardMaterial
        color={tint}
        flatShading
        transparent
        opacity={0.5}
        depthWrite={false}
        roughness={0.6}
        metalness={0}
      />
    </mesh>
  )
}

/**
 * The plan cursor, shown only while the canvas has focus.
 *
 * `PlanCanvas`'s reasoning, unchanged: it exists for the keyboard, and a second
 * crosshair chasing a mouse pointer that already has a ghost is noise.
 */
function Caret({ at }: { at: PlanPoint }) {
  const geometry = useMemo(() => caretGeometry(), [])
  useEffect(() => () => { geometry.dispose() }, [geometry])
  return (
    <lineSegments geometry={geometry} position={[at[0] * GRID_UNIT_MM, PLATE_HEIGHT_MM * 3, at[1] * GRID_UNIT_MM]} dispose={null}>
      <lineBasicMaterial color={ACCENT} depthWrite={false} />
    </lineSegments>
  )
}
