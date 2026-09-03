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
 *   2. **The ghost is the real mesh.** The mockup builds a box or an extrusion
 *      per tile kind; the owner rejected primitives, so the ghost is the tile's
 *      own geometry from the store, positioned by the *same* `tileMatrix` call
 *      the placed instance will use. When the mesh has not arrived the ghost
 *      falls back to a footprint plate — `markers.ts` — which is the footprint
 *      the catalog tagged and not a guess at the tile.
 *   3. **The ghost rises onto its own base, and onto nothing else.** The mockup
 *      lifts a wall 0.25 units when a floor is under it, and it can, because it
 *      stores a `y` with every placement. This app's placement has no `y`, so a
 *      ghost drawn at a *user-directed* stacking elevation would sit where the
 *      tile will not land — the disagreement `ghost.ts` was made pure to prevent.
 *      `SurfacePick.elevationMm` is therefore still computed and still not
 *      applied.
 *
 *      Row **R3** made the one elevation that *is* answerable real: the base rule
 *      1 auto-inserts. It is not a placement and needs no stored `y` — it is a
 *      derivation of `(design, lock)`, so the ghost, the instance, the plate and
 *      the pick all read the same number out of `bases.ts` and cannot disagree.
 *      A median base is 6.00 mm and a median floor tile 4.50 mm, so this is the
 *      difference between a tile standing on its base and a tile buried in it.
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
 * `PlanToolbar` already writes. `computeGhost` draws the ghost and decides the
 * placement. `beginMove` / `dragMoveTo` / `nudgeMove` / `previewMove` are the
 * whole move. `pieceAt` resolves every pick. `subjectsConflict` is reached only
 * through those. There is no second geometry in this file and no second opinion
 * about where anything is.
 */
import { useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BufferGeometry, Matrix4, Mesh } from 'three'
import { Raycaster } from 'three'

import type {
  MoveDrag,
  PlanPart,
  PlanPiece,
  PlanPoint,
  PlanScene,
  PlanStyle,
  PlanTools,
  ScenePiece,
} from '@/builder/canvas'
import {
  computeGhost,
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
import type { AssemblyPart } from '@/assembly'
import type { CatalogRecord } from '@/catalog'
import { GRID_UNIT_MM } from '@/catalog'
import type { PlacementId } from '@/store'
import {
  moveGeneratedPlacement,
  movePlacement,
  placeTile,
  removeGeneratedPlacement,
  removePlacement,
  rotateGeneratedPlacement,
  rotatePlacement,
} from '@/store'

import type { SurfaceEdit, SurfaceStatus } from './edits'
import {
  describeAbandon,
  describeSurfaceHint,
  planDrop,
  planGrab,
  planPlacement,
  planRemoval,
  planTurn,
  removalOf,
} from './edits'
import type { PieceBase } from './bases'
import { baseElevationMm } from './bases'
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
  /** The armed tile, resolved by the caller from `tools.selectedTileId`. */
  readonly armed: CatalogRecord | undefined
  /**
   * The auto-inserted base under each placed piece — row **R3**.
   *
   * Read here for three things the instance matrices cannot carry: the plate a
   * base with no mesh is drawn as, the **height** every piece is picked and
   * plated at, and the ring over a base X10's note says is already on the plan.
   * Defaults to empty, so a caller with no assembly index in hand gets the pre-R3
   * surface exactly.
   */
  readonly bases?: ReadonlyMap<PlacementId, PieceBase>
  /**
   * The base the *armed* item would get, for the ghost.
   *
   * Separate from {@link bases} because the ghost is not a placement: it has no
   * `PlacementId` to look one up by. Without it the ghost would sit 6 mm below
   * where the tile lands, which is precisely the disagreement row R2 refused to
   * introduce when it left this row a correct elevation and no picture.
   */
  readonly armedBase?: AssemblyPart | undefined
  /** For the ghost alone: every placed piece carries its own resolved style. */
  readonly styleOf: (record: CatalogRecord) => PlanStyle
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
  bases = NO_BASES,
  armedBase,
  styleOf,
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
   * How far above the plan a piece's **underside** sits, in millimetres.
   *
   * Zero for everything the plan view ever drew, and the base's own height for
   * the 1,878 items in 3,822 that rule 1 stands on one — row **R3**. One
   * function, `bases.ts`'s, shared with the instance matrices, so a tile cannot
   * be drawn at one height and picked at another.
   */
  const elevationOf = useCallback(
    (piece: ScenePiece): number =>
      piece.kind !== 'catalog' ? 0 : baseElevationMm(bases.get(piece.id), geometries),
    [bases, geometries],
  )

  /**
   * A piece's height above the plan, in millimetres.
   *
   * The one place the pick consults the mesh store, and it is asking a question
   * a plate can answer too: a piece with no geometry is exactly as tall as the
   * marker drawn for it, so it is pickable at the height it appears at. Nothing
   * else in the gesture path reads `geometries` at all — which is why a missing
   * mesh cannot make a cell behave as though it were empty.
   *
   * Since R3 it is the **top** of the assembly: the base lifts the tile, so a
   * pointer over a based floor tile is 6 mm further up than one over an integral
   * floor and `pickSurface` has to be told, or clicking a based tile would fall
   * through to the plane below it.
   */
  const heightOf = useCallback(
    (piece: ScenePiece): number => {
      if (piece.kind !== 'catalog') return PLATE_HEIGHT_MM
      const lod = geometries.get(piece.record.blob)
      return elevationOf(piece) + (lod === undefined ? PLATE_HEIGHT_MM : meshHeightMm(lod.bounds))
    },
    [geometries, elevationOf],
  )

  /* --------------------------------------------------------------- derivations */

  const ghost = useMemo(
    () => (armed === undefined || cursor === null ? null : computeGhost(armed, tools.rotation, cursor, tools.step, scene)),
    [armed, cursor, tools.rotation, tools.step, scene],
  )
  const under = useMemo(() => (cursor === null ? undefined : pieceAt(scene, cursor)), [scene, cursor])
  const moving = useMemo(() => (drag === null ? undefined : previewMove(drag, scene)), [drag, scene])

  /**
   * Placed pieces with no mesh — what the plates are drawn for.
   *
   * Both populations. A catalog piece is waiting on R1's cache or on a `/lod/`
   * object that is not there; a generated base has never been in this store at
   * all, since `buildRoom3D` maps `scene.pieces` alone. Either way the cell is
   * occupied and must look it.
   */
  const plated = useMemo<readonly ScenePiece[]>(
    () => [
      ...scene.generated,
      ...scene.pieces.filter((piece) => !geometries.has(piece.record.blob)),
    ],
    [scene, geometries],
  )

  /**
   * Bases the bill lists and neither store holds a mesh for — row **R3**.
   *
   * The same answer a mesh-less *tile* gets, deliberately reusing R2's plate
   * rather than inventing a second absent-geometry state: the footprint the
   * catalog tagged, flat, in the base's own material tint. Drawn on the plan at
   * `PLATE_HEIGHT_MM` with the topper lifted to `ABSENT_BASE_ELEVATION_MM` above
   * it, so the ring stays visible under the tile instead of being buried in it.
   *
   * Under openlock this is the state **every** based tile is in until R1's
   * conversion has run and, before this row wired it, the state they were all in
   * permanently.
   */
  const basePlates = useMemo(
    () =>
      scene.pieces
        .map((piece) => ({ piece, base: bases.get(piece.id) }))
        .filter(
          (entry): entry is { piece: PlanPiece; base: PieceBase } =>
            entry.base !== undefined && !entry.base.duplicate && !geometries.has(entry.base.record.blob),
        ),
    [scene, bases, geometries],
  )

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
   * that names the store's placement shape — which is the whole of this row's
   * exposure to row **V4**. Everything above it deals in records, anchors and
   * angles.
   */
  const apply = useCallback(
    (edit: SurfaceEdit): boolean => {
      switch (edit.kind) {
        case 'place':
          placeTile({ design: edit.record.design, x: edit.anchor[0], z: edit.anchor[1], rotation: edit.rotation })
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
      const { scene: current, tools: state, armed: record, apply: run } = latest.current
      if (state.tool === 'erase') run(planRemoval(current, at))
      else run(planPlacement(current, record, state.rotation, at, state.step))
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
      setCursor([preview.box.x + preview.box.w / 2, preview.box.z + preview.box.d / 2])
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
      const { tools: state, scene: current, armed: record, apply: run } = latest.current
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
          const edit = planTurn(current, sticky.current, target, record, state.rotation, event.shiftKey ? -1 : 1)
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
        ghost,
        under,
        moving,
        onPlan: cursor !== null,
        waiting: plated.length,
      }),
    [tools.tool, armed, ghost, under, moving, cursor, plated.length],
  )

  const status = useMemo<SurfaceStatus>(
    () => ({
      cursor: cursor ?? [0, 0],
      snap: tools.snap,
      step: tools.step,
      tool: tools.tool,
      hint,
      selectedName: armed?.name ?? null,
      refusal: ghost?.refusal?.message ?? null,
      moving: moving === undefined ? null : pieceName(moving.piece),
      placements: scene.pieces.length,
      conflicts: scene.conflicts.size,
    }),
    [cursor, tools.snap, tools.step, tools.tool, hint, armed, ghost, moving, scene],
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

  const ghostLod = ghost === null ? undefined : geometries.get(ghost.record.blob)
  const movingLod =
    moving === undefined || moving.piece.kind !== 'catalog' ? undefined : geometries.get(moving.piece.record.blob)
  // The ghost stands on the base the bill will list for it, exactly as the
  // placed tile will — `armedBase` is the same `resolvePlacement` answer, asked
  // about a design instead of a placement.
  const ghostLift = baseElevationMm(armedBase, geometries)
  const ghostBaseLod = armedBase === undefined ? undefined : geometries.get(armedBase.record.blob)
  const movingLift = moving === undefined ? 0 : baseElevationMm(bases.get(moving.piece.id), geometries)

  return (
    <group scale={fit.scale}>
      <Lattice />

      {/* Bases first, and that is what a base *is* rather than a tie-break —
          `scene.ts#scenePaintOrder` makes the same argument about the generated
          ones. */}
      {room.baseGroups.map((group: LodInstanceGroup) => (
        <InstancedTiles key={`base:${group.key}`} group={group} />
      ))}

      {room.groups.map((group: LodInstanceGroup) => (
        <InstancedTiles key={group.key} group={group} />
      ))}

      {basePlates.map(({ piece, base }) => (
        <FootprintPlate
          key={`base:${piece.id}`}
          parts={piece.parts}
          tint={styleOf(base.record).tint}
          edge={styleOf(base.record).edge}
          heightMm={PLATE_HEIGHT_MM}
        />
      ))}

      {plated.map((piece) => (
        <FootprintPlate
          key={piece.id}
          parts={piece.parts}
          tint={piece.style.tint}
          edge={piece.id === under?.id && tools.tool === 'erase' ? ACCENT : piece.style.edge}
          heightMm={elevationOf(piece) + PLATE_HEIGHT_MM}
        />
      ))}

      {/* X10's `base-already-on-plan`, drawn. The bill still lists the second
          base; a second solid in the same cell at the same height would read as
          the one already there, so it is a ring at the topper's underside
          instead. `BuilderRoom`'s notice carries the sentence. */}
      {room.duplicateBases.map((id) => {
        const piece = scene.pieces.find((candidate) => candidate.id === id)
        return piece === undefined ? null : (
          <PlateOutline
            key={`dup:${id}`}
            parts={piece.parts}
            colour={ACCENT}
            heightMm={elevationOf(piece) + PLATE_HEIGHT_MM / 2}
          />
        )
      })}

      {/* The piece under the pointer in erase mode, ringed at its own height, so
          "click to remove that" names a piece the user can see is named. */}
      {under === undefined || tools.tool !== 'erase' || plated.includes(under) ? null : (
        <PlateOutline parts={under.parts} colour={ACCENT} heightMm={heightOf(under) + PLATE_HEIGHT_MM} />
      )}

      {ghost === null ? null : (
        <>
          {/* The ghost's own base, translucent, on the plan. Drawn because the
              alternative is a tile floating over an empty cell with the reason
              off screen — the base is the half of the assembly the owner asked
              this row to make visible, and it is as true of a tile about to be
              placed as of one already there. */}
          {ghostBaseLod === undefined ? null : (
            <Ghost
              parts={ghost.parts}
              matrix={tileMatrix(ghostBaseLod.bounds, ghost)}
              geometry={ghostBaseLod.geometry}
              tint={styleOf(ghost.record).tint}
              plateHeightMm={PLATE_HEIGHT_MM}
            />
          )}
          <Ghost
            parts={ghost.parts}
            matrix={ghostLod === undefined ? null : liftMatrix(tileMatrix(ghostLod.bounds, ghost), ghostLift)}
            geometry={ghostLod?.geometry}
            tint={ghost.duplicate || ghost.conflict || ghost.refusal !== null ? ACCENT : styleOf(ghost.record).tint}
            plateHeightMm={ghostLift + PLATE_HEIGHT_MM * 2}
          />
        </>
      )}

      {moving === undefined ? null : (
        <Ghost
          parts={moving.parts}
          matrix={
            movingLod === undefined
              ? null
              : liftMatrix(
                  tileMatrix(movingLod.bounds, {
                    shape: moving.piece.shape,
                    rotation: moving.piece.placement.rotation,
                    angle: moving.angle,
                    box: moving.box,
                    parts: moving.parts,
                    axisAligned: moving.axisAligned,
                  }),
                  movingLift,
                )
          }
          geometry={movingLod?.geometry}
          tint={moving.refusal !== null || moving.conflict ? ACCENT : moving.piece.style.tint}
          plateHeightMm={movingLift + PLATE_HEIGHT_MM * 2}
        />
      )}

      {focused && cursor !== null ? <Caret at={cursor} /> : null}
    </group>
  )
}

/** No bases resolved. A module constant, so the default prop is one identity. */
const NO_BASES: ReadonlyMap<PlacementId, PieceBase> = new Map()

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
 * A piece with no mesh: its tagged footprint, filled and ringed.
 *
 * Flat, 0.6 mm of it, in the piece's own material tint with a bright contour —
 * `markers.ts` sets out why that cannot be read as the tile and why it must not
 * be omitted. The geometry is built from the piece's convex parts and disposed
 * explicitly on unmount rather than left to the reconciler, which disposes what
 * it constructed and not what it was handed.
 *
 * Takes `parts` and two colours rather than a `ScenePiece` since row **R3**, for
 * one reason: an auto-inserted **base** with no mesh gets the same plate, and it
 * is not a `ScenePiece` — it has no placement, and its tint is its own record's
 * rather than the topper's. `heightMm` because a plate for a based tile has to be
 * drawn above the plate for the base underneath it.
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
   * A parameter since row R3 rather than the constant it was, because a ghost
   * that will land on a base has to ring the cell at the height it will land at
   * — the same reason the matrix is lifted.
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
