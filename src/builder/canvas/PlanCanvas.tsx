/**
 * The plan-view builder canvas.
 *
 * A top-down drawing of a room being laid out, in catalog grid units — 1 unit =
 * {@link GRID_UNIT_MM} = 25.4 mm = one inch. architecture-plan.md §7: a room
 * layout **is** a plan, and rendering it as one removes the height problem, the
 * LOD problem and the VRAM problem in a single move. Row G2 swaps the renderer
 * behind the same placement model, so nothing in this file is throwaway except
 * the drawing itself.
 *
 * design-contract.md §2.4 describes this pane as a "full-bleed 3D viewport".
 * There is no 3D engine in v1 and the size-gated single-tile viewer does not land
 * until row 21, so what is taken from the contract is its *layout language* and
 * its *toolbar vocabulary* — Place / Erase, ⟳ Rotate on `R`, Clear, a mono
 * `snap {value}` readout, a contextual hint bottom-left and the selected tile
 * name bottom-right — and not its rendering approach.
 *
 * ## SVG, measured rather than assumed
 *
 * The landing hero is SVG, which argues for consistency; a builder holding
 * hundreds of placements argues for Canvas 2D. Both were built as a 200-shape
 * and an 800-shape scene with the same fills, surface patterns and contours, and
 * panned and zoomed for 120 frames each in headless Chromium 148, at 1×, 6× and
 * 20× CPU throttling (mean frame interval, ms):
 *
 * | scene | throttle | SVG pan | SVG zoom | Canvas pan | Canvas zoom |
 * | ----- | -------- | ------: | -------: | ---------: | ----------: |
 * | 200   | 1×       |   16.67 |    16.67 |      16.67 |       16.67 |
 * | 200   | 6×       |   16.67 |    16.67 |      20.97 |       35.14 |
 * | 200   | 20×      |   16.67 |    17.91 |      73.05 |      121.80 |
 * | 800   | 6×       |   16.67 |    16.67 |      25.69 |       41.80 |
 * | 800   | 20×      |   33.05 |    45.83 |      90.69 |      139.30 |
 *
 * At the target size both hold 60 fps unthrottled, so the unthrottled row
 * decides nothing; the throttled rows are the measurement. SVG holds vsync at
 * 200 placements even at 20×, where Canvas is at 4–7 fps. The structural reason
 * is that a `viewBox` change is a compositor-and-raster job that leaves the main
 * thread idle (main-thread work per frame: 0.7 ms SVG, 5.0 ms Canvas at 200/20×),
 * whereas a Canvas 2D pan is a full redraw on the main thread — every frame,
 * every pattern fill, in JavaScript.
 *
 * **The honest caveat**: headless Chromium runs `--disable-gpu`, so Canvas 2D
 * rasterises on the CPU and is disadvantaged relative to a GPU-backed browser.
 * The measurement is therefore a floor for Canvas, not its ceiling. Two things
 * make SVG the right call regardless of how much a GPU would recover:
 *
 *   - **This subtree does not re-render on camera moves at all.** Line weights
 *     use `vector-effect="non-scaling-stroke"` and pattern cells are in grid
 *     units, so no piece depends on the scale; `PlanPieces` is memoised on the
 *     scene and a pan touches exactly one attribute on one element. A Canvas
 *     implementation has no equivalent — it must redraw everything, always.
 *   - **Accessibility.** A `<canvas>` is one opaque node. Real elements are what
 *     make the drawing inspectable, hit-testable and stylable from CSS tokens,
 *     and the accessibility story below leans on that.
 *
 * The bench is `docs/` material rather than repo code and lives in the PR
 * description; re-running it needs nothing but the numbers above to compare to.
 *
 * ## Accessibility, and what it does not cover
 *
 * A drag-to-place canvas is unusable by keyboard unless it is designed for, so:
 *
 *   - The canvas is **one tab stop** with `role="application"`, which is what
 *     lets it take the arrow keys. Its `aria-describedby` names the full key map,
 *     rendered as real text and shown on focus.
 *   - A **plan cursor** moves on the snap step with the arrow keys, and the view
 *     scrolls to follow it, so there is no separate pan chord to learn. Every
 *     move announces the grid position and what is under it.
 *   - **`Enter` places** the armed tile at the cursor — the non-pointer path to
 *     placing a tile. `Delete` removes what is under it. `R` turns it.
 *   - **`[` and `]` step the cursor through the placements** in reading order,
 *     announcing each, so every piece is reachable and removable without a
 *     pointer and without a 200-deep tab chain.
 *   - **A piece can be picked up, carried and dropped from the keyboard.**
 *     `Shift`+`Enter` — or plain `Enter` in the Move mode — picks up whatever is
 *     under the cursor; the arrow keys then carry the *piece* instead of the
 *     cursor, announcing each step and any overlap; `Enter` drops it and
 *     `Escape` puts it back. See `move.ts`.
 *   - Every action, refusal and conflict is announced through a polite live
 *     region.
 *
 * ## The move, and how it stays out of drag-paint's way
 *
 * PR #29 refused a move on a real objection: the primary button is already
 * drag-paint, so a drag-to-move on the same button is ambiguous. Two things
 * resolve it, neither of which arbitrates the ambiguous case:
 *
 *   - a **Move mode** in §2.4's toolbar, where the primary button has no other
 *     job, which is the discoverable path; and
 *   - **`Shift` with the primary button**, which moves in *any* mode. That is
 *     precisely the shape `Alt` + primary already has for panning — a gesture
 *     with no mode of its own — so it is one more modifier on a vocabulary the
 *     canvas already teaches, not a second editing model.
 *
 * `Alt` is tested first, so `Alt`+`Shift`+primary pans.
 *
 * **What is not accessible in v1, stated rather than left unmentioned:**
 *
 *   - **The drawing itself is not readable by a screen reader.** The `<svg>` is
 *     `role="img"` with a summary — tile count, material count, conflict count —
 *     and the per-piece detail is reachable only by moving the cursum through it
 *     with `[` / `]`. A spatial drawing has no good linear reading, and a 200-item
 *     list of coordinates is not one. Row 18's bill-of-tiles panel is the right
 *     home for a browsable inventory.
 *   - **Pinch-zoom and touch drag are untested.** Pointer events cover them in
 *     principle; no touch device was available to check.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { CatalogRecord } from '@/catalog'
import { GRID_UNIT_MM } from '@/catalog'
import type { MaterialId } from '@/materials'
import type { PlacementId } from '@/store'
import {
  moveGeneratedPlacement,
  movePlacement,
  placeTile,
  removeGeneratedPlacement,
  removePlacement,
  rotateGeneratedPlacement,
  rotatePlacement,
  useGeneratedPlacements,
  usePlacements,
} from '@/store'

import type { PlanCatalog, PlanStyle } from './catalog'
import { createStyleResolver } from './catalog'
import type { PlanPoint, SnapMode } from './geometry'
import {
  boxCentre,
  describeCell,
  formatUnits,
  nextRotation,
  rotationStepFor,
  snapTo,
} from './geometry'
import { computeGhost } from './ghost'
import type { PlanGhost } from './ghost'
import { useAnnouncer, useCanvasSize } from './hooks'
import type { MoveDrag, MovePreview } from './move'
import {
  beginMove,
  describeCancel,
  describeDrop,
  describeGrab,
  describeMoveHint,
  describeNudge,
  dragMoveTo,
  nudgeMove,
  previewMove,
} from './move'
import { PlanPieces, shapeTransform } from './PlanPieces'
import { buildPlanScene, navigationOrder, pieceAt, pieceName, pieceRotationStep, scenePaintOrder } from './scene'
import type { PlanScene, ScenePiece } from './scene'
import { PlanDefs, GRID_PATTERN_ID, REFUSAL_PATTERN_ID, UNMEASURED_PATTERN_ID } from './surfaces'
import type { PlanTool, PlanTools } from './usePlanTools'
import type { Viewport } from './viewport'
import {
  defaultViewport,
  ensureVisible,
  fitBoxes,
  panByPixels,
  toWorld,
  usableSize,
  viewBox,
  wheelFactor,
  zoomAt,
} from './viewport'

import './canvas.css'

/* -------------------------------------------------------------------- status */

/**
 * What the canvas knows that its surroundings want to show.
 *
 * Reported through a callback rather than rendered, because §2.4 puts the snap
 * readout in row 18's floating toolbar and the hint in the canvas's own
 * bottom-left corner. The canvas draws its two corner plates itself (they are
 * inside its own bounds) and hands row 18 the same facts for the toolbar.
 */
export interface PlanStatus {
  readonly cursor: PlanPoint
  readonly snap: SnapMode
  readonly step: number
  readonly tool: PlanTool
  /** The contextual hint string, §2.4's bottom-left. */
  readonly hint: string
  /** The armed tile's display name, §2.4's bottom-right, or `null`. */
  readonly selectedName: string | null
  /** Set when the armed tile cannot be drawn at all. */
  readonly refusal: string | null
  /**
   * The name of the piece currently in the air, or `null`.
   *
   * Reported rather than left to the canvas because a move started with
   * `Shift`+drag has no mode showing in the toolbar, and a user who has picked a
   * piece up needs the toolbar to say so somewhere.
   */
  readonly moving: string | null
  readonly placements: number
  readonly conflicts: number
}

/** Half a unit above the grid line the half-unit lines become legible at, in px per unit. */
const HALF_GRID_SCALE = 34

/** Zoom factor for one press of `+` or `-`. */
const KEY_ZOOM = 1.25

/** How many snap steps a shifted arrow key travels. */
const FAST_STEPS = 4

export interface PlanCanvasProps {
  /** The catalog, as two lookups. See `catalog.ts`; row 18 builds this once. */
  readonly catalog: PlanCatalog
  /** Shared tool state — row 18's palette and toolbar write to the same object. */
  readonly tools: PlanTools
  /** Called whenever the readout changes, for the toolbar and the hint plate. */
  readonly onStatus?: (status: PlanStatus) => void
  /** Set `false` when row 18 renders its own corner plates. Defaults to `true`. */
  readonly chrome?: boolean
  readonly className?: string
}

export function PlanCanvas({ catalog, tools, onStatus, chrome = true, className }: PlanCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const measured = useCanvasSize(hostRef)
  const size = usableSize(measured)
  const [view, setView] = useState<Viewport>(defaultViewport)
  const [cursor, setCursor] = useState<PlanPoint>([0, 0])
  /** The cursor, readable from the stable event handlers below. */
  const cursorRef = useRef<PlanPoint>(cursor)
  cursorRef.current = cursor
  const [pointerInside, setPointerInside] = useState(false)
  const [focused, setFocused] = useState(false)
  /**
   * Whether the key map is on screen.
   *
   * Driven by *how the canvas was reached*, not by `:focus-visible`. Chromium
   * grants `:focus-visible` to an element focused programmatically, and this
   * canvas focuses itself on `pointerdown` so that the keys are live after a
   * click — so a CSS-only rule put the help plate over the drawing after every
   * single click. Shown when focus arrives from the keyboard or a key is pressed,
   * hidden the moment a pointer is used.
   */
  const [keyHelp, setKeyHelp] = useState(false)
  const pointerFocus = useRef(false)
  /** Mirrors `keyHelp`, so a pointer move can dismiss it without a state read. */
  const keyHelpShown = useRef(false)
  keyHelpShown.current = keyHelp
  const { message, announce } = useAnnouncer()

  const placements = usePlacements()
  // The generated half of the scene, from the store's second map. A separate
  // subscription rather than one over the whole state, so a catalog placement
  // does not re-project the generated pieces or the other way round — both maps
  // have a stable identity until their own contents change.
  const generated = useGeneratedPlacements()
  const styleOf = useMemo(() => createStyleResolver(catalog), [catalog])
  const scene = useMemo(
    () => buildPlanScene(placements, catalog, styleOf, generated),
    [placements, catalog, styleOf, generated],
  )

  const selected = tools.selectedDesign === null ? undefined : catalog.record(tools.selectedDesign)
  const ghost = useMemo(
    () => (selected === undefined ? null : computeGhost(selected, tools.rotation, cursor, tools.step, scene)),
    [selected, tools.rotation, tools.step, cursor, scene],
  )
  const under = useMemo(() => pieceAt(scene, cursor), [scene, cursor])

  /**
   * The move in progress, and its resolution against the scene.
   *
   * Component state, never the store — `src/store/schema.ts` is explicit that a
   * drag-in-progress belongs here, and it is also what makes the move **one**
   * store write: a forty-event pointer drag writes nothing and the drop writes
   * once. `dragRef` is the synchronous mirror the stable pointer handlers read,
   * for the same reason `latest` exists.
   */
  const [drag, setDrag] = useState<MoveDrag | null>(null)
  const dragRef = useRef<MoveDrag | null>(null)
  const setMove = useCallback((next: MoveDrag | null) => {
    dragRef.current = next
    setDrag(next)
  }, [])
  const moving = useMemo(() => (drag === null ? undefined : previewMove(drag, scene)), [drag, scene])

  /**
   * Everything the event handlers need, refreshed each render.
   *
   * Handlers read this rather than closing over state, so they are stable for the
   * life of the component and a pointer drag cannot act on a scene three frames
   * stale. The alternative — handlers in the dependency array — reattaches the
   * non-passive wheel listener on every pointer move.
   */
  const latest = useRef({ scene, selected, tools, view, size, under })
  latest.current = { scene, selected, tools, view, size, under }

  /* ------------------------------------------------------------- announcing */

  const lastSaid = useRef('')
  const say = useCallback(
    (text: string) => {
      if (text === lastSaid.current) return
      lastSaid.current = text
      announce(text)
    },
    [announce],
  )

  const sayCell = useCallback(
    (point: PlanPoint) => {
      const piece = pieceAt(latest.current.scene, point)
      const what = piece === undefined ? 'empty' : piece.label
      say(`${describeCell(point[0], point[1])} — ${what}${piece?.conflict === true ? ', overlapping' : ''}`)
    },
    [say],
  )

  /* ---------------------------------------------------------------- actions */

  /** Commit the ghost. Returns whether the scene changed. */
  const commit = useCallback(
    (at: PlanPoint): boolean => {
      const { selected: record, tools: current, scene: currentScene } = latest.current
      if (record === undefined) {
        say('No tile is armed. Choose one in the palette first.')
        return false
      }
      const candidate = computeGhost(record, current.rotation, at, current.step, currentScene)
      if (candidate.refusal !== null) {
        say(candidate.refusal.message)
        return false
      }
      if (candidate.duplicate) {
        say(`${record.name} is already placed at ${describeCell(candidate.anchor[0], candidate.anchor[1])}.`)
        return false
      }
      placeTile({
        // The armed **item**, since row V4. `record` is the variant this build
        // would print, so `record.design` is the item the palette armed — and
        // the file is deliberately not stored: the bill re-resolves it under
        // whatever preference is set when the download is asked for.
        design: record.design,
        x: candidate.anchor[0],
        z: candidate.anchor[1],
        rotation: candidate.rotation,
      })
      const conflict = candidate.conflict ? ', overlapping a piece already there' : ''
      // The caveat is announced on the act, not only carried on the piece: a
      // drag-paint of twenty curves should say once per placement that the
      // outline is the band rule's and not a measurement's. 462 of the 1,199
      // curves are in that population — see `geometry.ts`'s `placementCaveat`.
      const caveat = candidate.caveat === null ? '' : ` ${candidate.caveat.message}`
      say(
        `Placed ${record.name} at ${describeCell(candidate.anchor[0], candidate.anchor[1])}${conflict}.${caveat}`,
      )
      return true
    },
    [say],
  )

  /**
   * Remove one piece, named. Shared by the erase gesture and the move's `Delete`.
   *
   * Two store actions, because the scene is two maps: `removeGeneratedPlacement`
   * also releases the held mesh when the removal orphans it, which `removePlacement`
   * has nothing to release. One readout either way — see `scene.ts`'s `pieceName`.
   */
  const erasePiece = useCallback(
    (piece: ScenePiece): boolean => {
      if (piece.kind === 'generated') removeGeneratedPlacement(piece.id)
      else removePlacement(piece.id)
      say(`Removed ${pieceName(piece)} from ${describeCell(piece.placement.x, piece.placement.z)}.`)
      return true
    },
    [say],
  )

  /** Remove the topmost piece under a point. */
  const erase = useCallback(
    (at: PlanPoint): boolean => {
      const piece = pieceAt(latest.current.scene, at)
      if (piece === undefined) {
        say(`Nothing to remove at ${describeCell(at[0], at[1])}.`)
        return false
      }
      return erasePiece(piece)
    },
    [erasePiece, say],
  )

  /* ------------------------------------------------------------------- move */

  /**
   * Pick up the topmost piece under a point.
   *
   * `from` is the world point a pointer grabbed at, or `null` for a keyboard
   * grab; `move.ts` uses it to keep the piece under the part of it that was
   * grabbed instead of centring it on the cursor.
   */
  const grabAt = useCallback(
    (at: PlanPoint, from: PlanPoint | null): boolean => {
      const { scene: currentScene } = latest.current
      const piece = pieceAt(currentScene, at)
      if (piece === undefined) {
        say(`Nothing to move at ${describeCell(at[0], at[1])}.`)
        return false
      }
      const next = beginMove(piece, from)
      const preview = previewMove(next, currentScene)
      if (preview === undefined) return false
      setMove(next)
      say(describeGrab(preview))
      return true
    },
    [say, setMove],
  )

  /**
   * Put the piece down.
   *
   * The **only** store write the whole gesture makes, and the refusal set is
   * `ghost.ts`'s: an identical tile at identical coordinates and an identical
   * angle is refused and the piece goes back, an overlap is committed and
   * announced, and a drop where the piece already is writes nothing at all. See
   * `move.ts` for why an overlap informs rather than prevents.
   */
  const drop = useCallback((): boolean => {
    const current = dragRef.current
    if (current === null) return false
    const preview = previewMove(current, latest.current.scene)
    setMove(null)
    if (preview === undefined) return false
    if (preview.refusal !== null) {
      say(preview.refusal.message)
      return false
    }
    if (!preview.committable) {
      say(describeDrop(preview))
      return false
    }
    if (preview.piece.kind === 'generated') {
      moveGeneratedPlacement(current.id, current.anchor[0], current.anchor[1])
    } else {
      movePlacement(current.id, current.anchor[0], current.anchor[1])
    }
    say(describeDrop(preview))
    return true
  }, [say, setMove])

  /** Abandon the move. Nothing was written, so there is nothing to put back but the state. */
  const cancelMove = useCallback((): boolean => {
    const current = dragRef.current
    if (current === null) return false
    const preview = previewMove(current, latest.current.scene)
    setMove(null)
    say(preview === undefined ? 'Move cancelled.' : describeCancel(preview))
    return true
  }, [say, setMove])

  /**
   * Turn the piece under the cursor, or the ghost when there is none.
   *
   * The step is the tile's own either way — `rotStep`, defaulting to 90 — because
   * 893 tiles carry an angle that is not a multiple of 90 and would never tile on
   * a 90° step.
   */
  /**
   * The placement `R` is currently turning.
   *
   * Sticky until the cursor moves, because turning a piece can move it out from
   * under the cursor — a 2 × 0.5 wall turned 60° no longer covers the point it
   * was clicked at — and the next press would then silently turn the *ghost*
   * instead. Repeated `R` has to keep meaning the same thing.
   */
  const rotationTarget = useRef<PlacementId | null>(null)

  const rotate = useCallback(
    (direction: 1 | -1 = 1) => {
      const { under, selected: record, tools: current, scene: currentScene } = latest.current
      // A piece in the air outranks both the sticky target and the cursor: `R`
      // during a move turns the piece being carried, and the preview follows it
      // because `previewMove` reads the rotation the scene holds rather than a
      // copy taken at grab time. The rotation is its own store write; the move
      // is still one.
      const held = dragRef.current
      const sticky = held?.id ?? rotationTarget.current
      const target =
        sticky === null ? undefined : scenePaintOrder(currentScene).find((it) => it.id === sticky)
      const piece = target ?? under
      if (piece !== undefined) {
        rotationTarget.current = piece.id
        const step = pieceRotationStep(piece)
        const rotation = nextRotation(piece.placement.rotation, step, direction)
        if (piece.kind === 'generated') rotateGeneratedPlacement(piece.id, rotation)
        else rotatePlacement(piece.id, rotation)
        say(`Turned ${pieceName(piece)} to ${formatUnits(rotation)} degrees.`)
        return
      }
      if (record === undefined) {
        say('Nothing to turn. Arm a tile or put the cursor on a placed one.')
        return
      }
      rotationTarget.current = null
      const step = rotationStepFor(record)
      current.rotate(step, direction)
      say(`${record.name} will be placed at ${formatUnits(nextRotation(current.rotation, step, direction))} degrees.`)
    },
    [say],
  )

  const actAt = useCallback(
    (at: PlanPoint) => {
      if (latest.current.tools.tool === 'erase') erase(at)
      else commit(at)
    },
    [commit, erase],
  )

  /* ---------------------------------------------------------------- pointer */

  const dragging = useRef<'pan' | 'act' | 'move' | null>(null)
  const lastPointer = useRef<{ x: number; y: number } | null>(null)

  const localPoint = useCallback((event: React.PointerEvent | WheelEvent): { x: number; y: number } => {
    const rect = hostRef.current?.getBoundingClientRect()
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }
  }, [])

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      pointerFocus.current = true
      setKeyHelp(false)
      hostRef.current?.focus()
      const local = localPoint(event)
      lastPointer.current = local
      // Middle button, or Alt with the primary button: pan. Alt because the
      // primary button alone is the place/erase gesture and a builder that
      // needed a modifier for its main action would be a worse builder.
      if (event.button === 1 || (event.button === 0 && event.altKey)) {
        dragging.current = 'pan'
        capture(event)
        event.preventDefault()
        return
      }
      if (event.button !== 0) return
      const point = toWorld(latest.current.view, local.x, local.y)
      // Move mode, or Shift in any mode. Tested after the pan clause, so
      // Alt+Shift+primary pans rather than being ambiguous between the two.
      if (latest.current.tools.tool === 'move' || event.shiftKey) {
        setCursor(point)
        if (grabAt(point, point)) {
          dragging.current = 'move'
          capture(event)
          event.preventDefault()
        } else {
          dragging.current = null
        }
        return
      }
      dragging.current = 'act'
      capture(event)
      actAt(point)
    },
    [actAt, grabAt, localPoint],
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const local = localPoint(event)
      const previous = lastPointer.current
      lastPointer.current = local
      setPointerInside(true)
      // Reaching for the mouse dismisses the key map — it sits over the drawing,
      // and a pointer user has no use for it. Guarded on the mirror so this is
      // not a state write on every one of the hundreds of moves in a drag.
      if (keyHelpShown.current) setKeyHelp(false)

      if (dragging.current === 'pan' && previous !== null) {
        setView((current) => panByPixels(current, previous.x - local.x, previous.y - local.y))
        return
      }
      const point = toWorld(latest.current.view, local.x, local.y)
      rotationTarget.current = null
      setCursor(point)
      // A pointer drag is not announced step by step: the outline is already
      // following the pointer, and a live region firing on every one of the
      // hundreds of moves in a drag would drown the drop that matters.
      if (dragging.current === 'move') {
        const current = dragRef.current
        if (current !== null) setMove(dragMoveTo(current, point, latest.current.tools.step))
        return
      }
      if (dragging.current === 'act') actAt(point)
    },
    [actAt, localPoint, setMove],
  )

  const endDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (dragging.current === 'move') drop()
      dragging.current = null
      release(event)
    },
    [drop],
  )

  /**
   * A drag the platform took away, or one that walked off the canvas without
   * pointer capture. Put the piece back rather than committing a position the
   * user never released on.
   */
  const abortDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (dragging.current === 'move') cancelMove()
      dragging.current = null
      release(event)
    },
    [cancelMove],
  )

  /**
   * Zoom on the wheel, anchored at the pointer.
   *
   * Attached by hand because React registers `wheel` at the root as a **passive**
   * listener, so `preventDefault` inside `onWheel` is ignored and the page
   * scrolls behind the canvas.
   */
  useEffect(() => {
    const element = hostRef.current
    if (element === null) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      setView((current) => zoomAt(current, wheelFactor(event.deltaY), x, y))
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      element.removeEventListener('wheel', onWheel)
    }
  }, [])

  /* --------------------------------------------------------------- keyboard */

  const navIndex = useRef(-1)

  const moveCursor = useCallback(
    (dx: number, dz: number) => {
      const { tools: current, view: currentView, size: currentSize } = latest.current
      const [x, z] = cursorRef.current
      // Snap the cursor itself on the way, so keyboard travel stays on the
      // lattice however it started — a pointer move may have left it anywhere.
      const next: PlanPoint = [snapTo(x + dx, current.step), snapTo(z + dz, current.step)]
      rotationTarget.current = null
      setCursor(next)
      setView(ensureVisible(currentView, currentSize, { x: next[0] - 0.25, z: next[1] - 0.25, w: 0.5, d: 0.5 }, 1.5))
      sayCell(next)
    },
    [sayCell],
  )

  const stepToPiece = useCallback(
    (direction: 1 | -1) => {
      const order = navigationOrder(latest.current.scene)
      if (order.length === 0) {
        say('No tiles placed yet.')
        return
      }
      navIndex.current = (navIndex.current + direction + order.length) % order.length
      const piece = order[navIndex.current] as ScenePiece
      const centre = boxCentre(piece.box)
      setCursor([centre.x, centre.z])
      setView(ensureVisible(latest.current.view, latest.current.size, piece.box, 1.5))
      say(`${String(navIndex.current + 1)} of ${String(order.length)}: ${piece.label}`)
    },
    [say],
  )

  /**
   * Carry the held piece by one keyboard step, and take the cursor with it.
   *
   * The cursor follows so that the caret stays on the piece and `ensureVisible`
   * scrolls the view to keep it on screen — a keyboard user carrying a piece off
   * the viewport would otherwise be moving something they cannot see.
   */
  const nudge = useCallback(
    (dx: number, dz: number) => {
      const current = dragRef.current
      if (current === null) return
      const { scene: currentScene, tools, view: currentView, size: currentSize } = latest.current
      const next = nudgeMove(current, dx, dz, tools.step)
      const preview = previewMove(next, currentScene)
      if (preview === undefined) {
        setMove(null)
        return
      }
      setMove(next)
      const centre = boxCentre(preview.box)
      setCursor([centre.x, centre.z])
      setView(ensureVisible(currentView, currentSize, preview.box, 1.5))
      say(describeNudge(preview))
    },
    [say, setMove],
  )

  const zoomCentre = useCallback((factor: number) => {
    setView((current) => zoomAt(current, factor, latest.current.size.width / 2, latest.current.size.height / 2))
  }, [])

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const { tools: current, scene: currentScene, size: currentSize } = latest.current
      const step = current.step * (event.shiftKey ? FAST_STEPS : 1)
      const handled = () => {
        event.preventDefault()
        event.stopPropagation()
        setKeyHelp(true)
      }

      // A piece in the air claims exactly the six keys the gesture needs. Every
      // other key falls through to the map below and keeps working — zoom, fit,
      // snap, bracket navigation — because the drag is component state and
      // depends on none of them. Switching snap mid-carry changes the step the
      // arrows travel, which is the behaviour a builder wants.
      if (dragRef.current !== null) {
        switch (event.key) {
          case 'ArrowLeft':
            handled()
            nudge(-step, 0)
            return
          case 'ArrowRight':
            handled()
            nudge(step, 0)
            return
          case 'ArrowUp':
            handled()
            nudge(0, -step)
            return
          case 'ArrowDown':
            handled()
            nudge(0, step)
            return
          case 'Enter':
          case ' ':
            handled()
            drop()
            return
          case 'Escape':
            handled()
            cancelMove()
            return
          case 'Delete':
          case 'Backspace': {
            // Deleting what you are holding is a coherent thing to mean, and it
            // is the one case where the drag ends without either a drop or a
            // put-back.
            handled()
            const held = currentScene.pieces.find((piece) => piece.id === dragRef.current?.id)
            setMove(null)
            if (held !== undefined) erasePiece(held)
            return
          }
          default:
            break
        }
      }

      switch (event.key) {
        case 'ArrowLeft':
          handled()
          moveCursor(-step, 0)
          return
        case 'ArrowRight':
          handled()
          moveCursor(step, 0)
          return
        case 'ArrowUp':
          handled()
          moveCursor(0, -step)
          return
        case 'ArrowDown':
          handled()
          moveCursor(0, step)
          return
        case 'Enter':
        case ' ':
          handled()
          // Shift is the modeless move on the keyboard exactly as it is on the
          // pointer, so the modifier means one thing on both.
          if (current.tool === 'move' || event.shiftKey) grabAt(cursorRef.current, null)
          else actAt(cursorRef.current)
          return
        case 'Delete':
        case 'Backspace':
          handled()
          erase(cursorRef.current)
          return
        case 'r':
        case 'R':
          handled()
          rotate(event.shiftKey ? -1 : 1)
          return
        case '[':
          handled()
          stepToPiece(-1)
          return
        case ']':
          handled()
          stepToPiece(1)
          return
        case 'g':
        case 'G': {
          handled()
          current.toggleSnap()
          const next = current.snap === 'fine' ? 'coarse' : 'fine'
          say(`Snap ${next === 'fine' ? '0.5' : '1'} units.`)
          return
        }
        case 'e':
        case 'E':
          handled()
          current.setTool('erase')
          say('Erase mode. Click or press Delete to remove a tile.')
          return
        case 'p':
        case 'P':
          handled()
          current.setTool('place')
          say('Place mode.')
          return
        case 'm':
        case 'M':
          handled()
          current.setTool('move')
          say('Move mode. Drag a tile, or press Enter on one to pick it up.')
          return
        case '+':
        case '=':
          handled()
          zoomCentre(KEY_ZOOM)
          return
        case '-':
        case '_':
          handled()
          zoomCentre(1 / KEY_ZOOM)
          return
        case '0':
        case 'Home': {
          handled()
          const boxes = currentScene.pieces.map((piece) => piece.box)
          setView(fitBoxes(boxes, currentSize))
          say(boxes.length === 0 ? 'View reset.' : `View fitted to ${String(boxes.length)} tiles.`)
          return
        }
        default:
          return
      }
    },
    [
      actAt,
      cancelMove,
      drop,
      erase,
      erasePiece,
      grabAt,
      moveCursor,
      nudge,
      rotate,
      say,
      setMove,
      stepToPiece,
      zoomCentre,
    ],
  )

  /* ----------------------------------------------------------------- status */

  const hint = useMemo(
    () => buildHint(tools, selected, ghost, under, moving),
    [tools, selected, ghost, under, moving],
  )
  const status = useMemo<PlanStatus>(
    () => ({
      cursor,
      snap: tools.snap,
      step: tools.step,
      tool: tools.tool,
      hint,
      selectedName: selected?.name ?? null,
      refusal: ghost?.refusal?.message ?? null,
      moving: moving === undefined ? null : pieceName(moving.piece),
      placements: scene.pieces.length,
      conflicts: scene.conflicts.size,
    }),
    [cursor, tools.snap, tools.step, tools.tool, hint, selected, ghost, moving, scene],
  )

  useEffect(() => {
    onStatus?.(status)
  }, [onStatus, status])

  /* ---------------------------------------------------------------- drawing */

  const frame = viewBox(view, size)
  const ghostStyle = ghost === null ? null : styleOf(ghost.record)
  const materials = useMemo(() => usedMaterials(scene, ghostStyle), [scene, ghostStyle])
  // The place-ghost is suppressed while a piece is in the air: two dashed
  // outlines following the same pointer, one of which cannot be committed, is
  // the drawing telling the user two contradictory things.
  const showGhost = ghost !== null && moving === undefined && (pointerInside || focused)

  return (
    <div
      ref={hostRef}
      className={className === undefined ? 'of-plan-canvas' : `of-plan-canvas ${className}`}
      role="application"
      aria-roledescription="plan grid"
      aria-label={`Builder plan, ${String(scene.pieces.length)} tiles placed. One grid unit is ${formatUnits(GRID_UNIT_MM)} millimetres.`}
      aria-describedby={KEY_HELP_ID}
      tabIndex={0}
      data-tool={tools.tool}
      data-snap={tools.snap}
      data-moving={moving === undefined ? undefined : 'true'}
      data-keys={keyHelp ? 'on' : undefined}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={abortDrag}
      onPointerLeave={(event) => {
        setPointerInside(false)
        abortDrag(event)
      }}
      onFocus={() => {
        setFocused(true)
        setKeyHelp(!pointerFocus.current)
        pointerFocus.current = false
      }}
      onBlur={() => {
        setFocused(false)
        setKeyHelp(false)
      }}
    >
      <svg
        className="of-plan-svg"
        viewBox={`${String(frame.x)} ${String(frame.z)} ${String(frame.w)} ${String(frame.d)}`}
        role="img"
        aria-label={describeScene(scene)}
      >
        <PlanDefs materials={materials} halfGrid={view.scale >= HALF_GRID_SCALE} />

        {/* The grid, anchored on the world origin and deliberately camera-
            independent: a fixed rectangle 2,000 units square costs one node and
            never changes, where a rectangle sized to the viewport would be
            rewritten on every pan. The browser rasterises only what is on
            screen. */}
        <rect className="of-plan-grid" x={-1000} y={-1000} width={2000} height={2000} fill={`url(#${GRID_PATTERN_ID})`} />
        <path
          className="of-plan-axes"
          d="M -1000 0 H 1000 M 0 -1000 V 1000"
          fill="none"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />

        {/* Two `<g>`s in this order, so a generated base is painted *under* the
            catalog's pieces — see `scene.ts`'s `scenePaintOrder`, which is the
            same statement in arithmetic and is what `pieceAt` hit-tests by. */}
        <PlanPieces pieces={scene.generated} movingId={moving?.id ?? null} generated />
        <PlanPieces pieces={scene.pieces} movingId={moving?.id ?? null} />

        {/* A generated base carries its own resolved style — row S5 asks
            `src/materials` for `texture|plain` — so the shadow reads the piece
            rather than re-resolving a record it has not got. */}
        {moving === undefined ? null : (
          <MoveShadow
            preview={moving}
            style={moving.piece.kind === 'catalog' ? styleOf(moving.piece.record) : moving.piece.style}
          />
        )}
        {showGhost && ghostStyle !== null ? <Ghost ghost={ghost} style={ghostStyle} /> : null}
        {focused ? <Caret at={cursor} /> : null}
      </svg>

      {chrome ? (
        <>
          <p className="of-plan-plate of-plan-hint">{hint}</p>
          <p className="of-plan-plate of-plan-armed">
            {selected === undefined ? 'No tile armed' : selected.name}
            <span className="of-plan-readout">
              {' '}
              snap {tools.step === 1 ? '1' : '0.5'} · {describeCell(cursor[0], cursor[1])}
            </span>
          </p>
        </>
      ) : null}

      <p className="of-plan-keys" id={KEY_HELP_ID}>
        Arrow keys move the plan cursor by the snap step, Shift for four steps. Enter places the armed tile, Delete
        removes the one under the cursor, R turns it. Shift and Enter together pick the tile under the cursor up to
        move it; the arrow keys then carry the tile, Enter drops it and Escape puts it back. Square brackets step
        through the placed tiles. G switches snap between half a unit and one unit, P, E and M switch between place,
        erase and move, plus and minus zoom, 0 fits the room. Drag with the middle button or Alt to pan, and Shift-drag
        to move a tile.
      </p>

      <p className="of-plan-live" aria-live="polite" aria-atomic="true">
        {message}
      </p>
    </div>
  )
}

const KEY_HELP_ID = 'of-plan-keys'

/* ------------------------------------------------------------ pointer capture */

/**
 * Capture and release, feature-detected.
 *
 * Capture is what keeps a drag alive when the pointer leaves the canvas — a pan
 * that stopped at the edge of the viewport would be unusable. jsdom implements
 * neither method, so the guards are also what let the component tests dispatch
 * pointer events at all; they are a real capability check, not a test hook, and
 * a browser without capture degrades to a drag that ends at the boundary.
 */
function capture(event: React.PointerEvent<HTMLDivElement>): void {
  const target = event.currentTarget
  if (typeof target.setPointerCapture === 'function') target.setPointerCapture(event.pointerId)
}

function release(event: React.PointerEvent<HTMLDivElement>): void {
  const target = event.currentTarget
  if (typeof target.hasPointerCapture !== 'function' || typeof target.releasePointerCapture !== 'function') return
  if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
}

/* ------------------------------------------------------------------- pieces */

/**
 * The ghost, drawn the same way a placed piece is so the two cannot disagree.
 *
 * Same outline and the same transform as `PlanPieces.tsx` — `shapeTransform`
 * lives there and is imported here rather than restated, because a preview drawn
 * by a second implementation of the placement arithmetic is how a ghost ends up
 * half a unit from where the tile lands.
 */
function Ghost({ ghost, style }: { ghost: PlanGhost; style: PlanStyle }) {
  const outline = { d: ghost.shape.outline }
  const transform = shapeTransform(ghost.shape, ghost.box, ghost.angle)

  if (ghost.refusal !== null) {
    const { w, d } = ghost.extent
    return (
      <g className="of-plan-ghost" data-refused="true" transform={transform}>
        <path {...outline} fill={`url(#${REFUSAL_PATTERN_ID})`} />
        <path {...outline} fill="none" stroke="var(--mut)" strokeWidth={1.5} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
        <path
          d={`M 0 0 l ${String(w)} ${String(d)} M ${String(w)} 0 l ${String(-w)} ${String(d)}`}
          fill="none"
          stroke="var(--mut)"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      </g>
    )
  }

  const blocked = ghost.duplicate || ghost.conflict
  return (
    <g
      className="of-plan-ghost"
      data-blocked={blocked ? 'true' : undefined}
      data-basis={ghost.caveat === null ? undefined : 'fallback'}
      transform={transform}
    >
      <path {...outline} fill={style.tint} opacity={0.42} />
      {/* The unmeasured mark is on the ghost too, not just on the placed piece:
          the point of disclosing it is that the user knows *before* clicking. */}
      {ghost.caveat === null ? null : <path {...outline} fill={`url(#${UNMEASURED_PATTERN_ID})`} />}
      <path
        {...outline}
        fill="none"
        stroke={blocked ? 'var(--acc)' : style.edge}
        strokeWidth={blocked ? 2.5 : 1.75}
        strokeDasharray="5 4"
        vectorEffect="non-scaling-stroke"
      />
    </g>
  )
}

/**
 * The piece in the air: a leader line from where it was, and the outline where
 * it would land.
 *
 * Drawn through `shapeTransform` and the shape's own `outline`, the same two
 * things `PlanPieces.tsx` and `Ghost` use, so the preview cannot be a different
 * piece from the one that lands. The piece at its origin is not re-drawn here —
 * it is the real piece, dimmed in place by `data-moving`, which keeps the origin
 * marker exact and costs no extra nodes.
 *
 * The leader line is what makes the displacement legible: without a reference
 * point a user pushing a 2 × 0.5 wall along a run has no way to see whether they
 * have travelled one step or three, and a plan has no other cue.
 */
function MoveShadow({ preview, style }: { preview: MovePreview; style: PlanStyle }) {
  const outline = { d: preview.piece.shape.outline }
  const transform = shapeTransform(preview.piece.shape, preview.box, preview.angle)
  const blocked = preview.refusal !== null || preview.conflict
  const from = boxCentre(preview.fromBox)
  const to = boxCentre(preview.box)

  return (
    <g
      className="of-plan-move"
      data-blocked={blocked ? 'true' : undefined}
      data-basis={preview.piece.caveat === null ? undefined : 'fallback'}
    >
      {preview.unchanged ? null : (
        <path
          className="of-plan-move-lead"
          d={`M ${String(from.x)} ${String(from.z)} L ${String(to.x)} ${String(to.z)}`}
          fill="none"
          strokeWidth={1.25}
          strokeDasharray="3 4"
          vectorEffect="non-scaling-stroke"
        />
      )}
      <g transform={transform}>
        <path {...outline} fill={style.tint} opacity={0.55} />
        {/* The unmeasured mark travels with the piece. 462 of the 1,199 curves
            carry it, and a move must not be the operation that quietly drops the
            one disclosure the builder makes about a curve's provenance. */}
        {preview.piece.caveat === null ? null : <path {...outline} fill={`url(#${UNMEASURED_PATTERN_ID})`} />}
        <path
          {...outline}
          fill="none"
          stroke={blocked ? 'var(--acc)' : style.edge}
          strokeWidth={blocked ? 2.5 : 2}
          strokeDasharray="5 4"
          vectorEffect="non-scaling-stroke"
        />
      </g>
    </g>
  )
}

/**
 * The plan cursor's crosshair.
 *
 * Shown only while the canvas has focus, because it exists for the keyboard: a
 * mouse user already has a pointer and a ghost, and a second crosshair following
 * them would be noise.
 */
function Caret({ at }: { at: PlanPoint }) {
  const [x, z] = at
  const arm = 0.35
  return (
    <path
      className="of-plan-caret"
      d={`M ${String(x - arm)} ${String(z)} H ${String(x + arm)} M ${String(x)} ${String(z - arm)} V ${String(z + arm)}`}
      fill="none"
      strokeWidth={1.5}
      vectorEffect="non-scaling-stroke"
    />
  )
}

/* ------------------------------------------------------------------ strings */

function usedMaterials(scene: PlanScene, ghostStyle: PlanStyle | null): readonly MaterialId[] {
  const set = new Set<MaterialId>(scene.pieces.map((piece) => piece.style.material))
  if (ghostStyle !== null) set.add(ghostStyle.material)
  return [...set]
}

/** The `<svg role="img">` summary. Deliberately a summary, not an inventory. */
function describeScene(scene: PlanScene): string {
  if (scene.pieces.length === 0) return 'An empty plan grid.'
  const materials = new Set(scene.pieces.map((piece) => piece.style.label))
  const conflict = scene.conflicts.size === 0 ? '' : `, ${String(scene.conflicts.size)} overlapping`
  return `Plan view of ${String(scene.pieces.length)} placed tiles in ${String(materials.size)} materials${conflict}.`
}

/** §2.4's bottom-left hint, and the same string the live region opens with. */
function buildHint(
  tools: PlanTools,
  selected: CatalogRecord | undefined,
  ghost: PlanGhost | null,
  under: ScenePiece | undefined,
  moving: MovePreview | undefined,
): string {
  // A piece in the air out-ranks every other state, including a refusal about
  // the armed tile: nothing else on screen is what the user is doing.
  if (moving !== undefined) return describeMoveHint(moving)
  if (tools.tool === 'move') {
    return under === undefined
      ? 'Move: drag a tile to reposition it, or press Enter with the cursor on one. Shift-drag does the same in any mode.'
      : `Move: drag ${pieceName(under)}, or press Enter to pick it up.`
  }
  if (tools.tool === 'erase') {
    return under === undefined
      ? 'Erase: click a tile to remove it.'
      : `Erase: click to remove ${pieceName(under)}.`
  }
  if (selected === undefined) return 'Choose a tile in the palette, then click the grid to place it.'
  if (ghost !== null && ghost.refusal !== null) return ghost.refusal.message
  if (ghost?.duplicate === true) return `${selected.name} is already here — move the cursor to place another.`
  if (ghost?.conflict === true) return `Overlaps a piece already placed. R turns by ${formatUnits(rotationStepFor(selected))}°.`
  // Below the two problems and above the plain case: an unmeasured outline is
  // neither a refusal nor an error, so it must not out-rank one, and it must not
  // be silent either.
  if (ghost?.caveat != null) return `${ghost.caveat.message} R turns by ${formatUnits(rotationStepFor(selected))}°.`
  return `Click to place ${selected.name}. R turns by ${formatUnits(rotationStepFor(selected))}°.`
}
