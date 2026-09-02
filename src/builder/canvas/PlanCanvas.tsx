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
 *   - Every action, refusal and conflict is announced through a polite live
 *     region.
 *
 * **What is not accessible in v1, stated rather than left unmentioned:**
 *
 *   - **There is no keyboard *move*.** Repositioning a piece is erase-then-place.
 *     `movePlacement` exists in the store and this canvas does not call it,
 *     because a drag-to-move gesture is ambiguous against drag-to-paint on the
 *     one mouse button the contract's two-mode toolbar leaves free, and a
 *     keyboard move with no pointer equivalent would be a second model to learn.
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
import { placeTile, removePlacement, rotatePlacement, usePlacements } from '@/store'

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
import { PlanPieces, shapeTransform } from './PlanPieces'
import { buildPlanScene, navigationOrder, pieceAt } from './scene'
import type { PlanPiece, PlanScene } from './scene'
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
  const styleOf = useMemo(() => createStyleResolver(catalog), [catalog])
  const scene = useMemo(() => buildPlanScene(placements, catalog, styleOf), [placements, catalog, styleOf])

  const selected = tools.selectedTileId === null ? undefined : catalog.record(tools.selectedTileId)
  const ghost = useMemo(
    () => (selected === undefined ? null : computeGhost(selected, tools.rotation, cursor, tools.step, scene)),
    [selected, tools.rotation, tools.step, cursor, scene],
  )
  const under = useMemo(() => pieceAt(scene, cursor), [scene, cursor])

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
        tileId: record.id,
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

  /** Remove the topmost piece under a point. */
  const erase = useCallback(
    (at: PlanPoint): boolean => {
      const piece = pieceAt(latest.current.scene, at)
      if (piece === undefined) {
        say(`Nothing to remove at ${describeCell(at[0], at[1])}.`)
        return false
      }
      removePlacement(piece.id)
      say(`Removed ${piece.record.name} from ${describeCell(piece.placement.x, piece.placement.z)}.`)
      return true
    },
    [say],
  )

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
      const sticky = rotationTarget.current
      const piece = (sticky === null ? undefined : currentScene.pieces.find((it) => it.id === sticky)) ?? under
      if (piece !== undefined) {
        rotationTarget.current = piece.id
        const step = rotationStepFor(piece.record)
        const rotation = nextRotation(piece.placement.rotation, step, direction)
        rotatePlacement(piece.id, rotation)
        say(`Turned ${piece.record.name} to ${formatUnits(rotation)} degrees.`)
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

  const dragging = useRef<'pan' | 'act' | null>(null)
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
      dragging.current = 'act'
      capture(event)
      actAt(toWorld(latest.current.view, local.x, local.y))
    },
    [actAt, localPoint],
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
      if (dragging.current === 'act') actAt(point)
    },
    [actAt, localPoint],
  )

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = null
    release(event)
  }, [])

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
      const piece = order[navIndex.current] as PlanPiece
      const centre = boxCentre(piece.box)
      setCursor([centre.x, centre.z])
      setView(ensureVisible(latest.current.view, latest.current.size, piece.box, 1.5))
      say(`${String(navIndex.current + 1)} of ${String(order.length)}: ${piece.label}`)
    },
    [say],
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
          actAt(cursorRef.current)
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
    [actAt, erase, moveCursor, rotate, say, stepToPiece, zoomCentre],
  )

  /* ----------------------------------------------------------------- status */

  const hint = useMemo(() => buildHint(tools, selected, ghost, under), [tools, selected, ghost, under])
  const status = useMemo<PlanStatus>(
    () => ({
      cursor,
      snap: tools.snap,
      step: tools.step,
      tool: tools.tool,
      hint,
      selectedName: selected?.name ?? null,
      refusal: ghost?.refusal?.message ?? null,
      placements: scene.pieces.length,
      conflicts: scene.conflicts.size,
    }),
    [cursor, tools.snap, tools.step, tools.tool, hint, selected, ghost, scene],
  )

  useEffect(() => {
    onStatus?.(status)
  }, [onStatus, status])

  /* ---------------------------------------------------------------- drawing */

  const frame = viewBox(view, size)
  const ghostStyle = ghost === null ? null : styleOf(ghost.record)
  const materials = useMemo(() => usedMaterials(scene, ghostStyle), [scene, ghostStyle])
  const showGhost = ghost !== null && (pointerInside || focused)

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
      data-keys={keyHelp ? 'on' : undefined}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={() => {
        setPointerInside(false)
        dragging.current = null
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

        <PlanPieces pieces={scene.pieces} />

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
        removes the one under the cursor, R turns it. Square brackets step through the placed tiles. G switches snap
        between half a unit and one unit, P and E switch between place and erase, plus and minus zoom, 0 fits the room.
        Drag with the middle button or Alt to pan.
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
  under: PlanPiece | undefined,
): string {
  if (tools.tool === 'erase') {
    return under === undefined ? 'Erase: click a tile to remove it.' : `Erase: click to remove ${under.record.name}.`
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
