/**
 * The surface's drawing primitives — everything it puts in the scene that is not
 * a tile mesh.
 *
 * Extracted from `RoomSurface.tsx`, and the reason is that file's own size gate
 * rather than tidiness: the selection model gave the surface three new things to
 * draw (the projected ghost, the selection's ground contour, and the anchored
 * action bar) and one new projection to compute, and a component that owns both
 * *what a gesture means* and *how every mark is drawn* is doing two jobs. This
 * half has no state, no pointer handling and no store access — every function
 * here is a pure function of its props.
 *
 * **The line-weight constants live here with the lines they weigh.** They are in
 * CSS pixels rather than world units for `ScreenLine.tsx`'s reason, which is
 * worth restating because it is the kind of thing a reader assumes is arbitrary:
 * every one of these was a `gl.LINES` primitive, which WebGL draws one *device*
 * pixel wide, so the weight was whatever `devicePixelRatio` happened to be —
 * 0.91 CSS px on the display it was reported from, and 0.5 px once the dpr floor
 * went to 2, at which point the grid started breaking into dashes.
 */
import { useEffect, useMemo, useRef } from 'react'
import type { BufferGeometry, Matrix4, Mesh } from 'three'
import { GridHelper } from 'three'

import type { PlanPart, PlanPoint } from '@/builder/canvas'
import { GRID_UNIT_MM } from '@/catalog'
import { ScreenLine } from '@/three/ScreenLine'

import { PLATE_HEIGHT_MM, caretPositions, plateEdgePositions } from './markers'
import { SURFACE_GRID_DROP_MM, SURFACE_GRID_UNITS } from './surface'

/** The grid's lines and its two centre lines. `--mut` and `--line`'s dark end. */
const GRID_LINE = '#79684d'
/**
 * Line weights, in **CSS pixels**. See `ScreenLine.tsx` for why the unit is
 * spelled out and why these are numbers at all.
 *
 * They were never chosen before: every one of these lines was a `gl.LINES`
 * primitive, which WebGL draws one *device* pixel wide, so the weight was
 * whatever `devicePixelRatio` happened to be — 0.91 CSS px on the display this
 * was reported from, and 0.5 px once the dpr floor went to 2, at which point the
 * grid started breaking into dashes. The values here restore the weights that
 * display used to get and then hold them there on every other display too.
 */
const GRID_WIDTH_PX = 1
const PLATE_OUTLINE_WIDTH_PX = 1.5
const CARET_WIDTH_PX = 1.5
/**
 * The selection contour's weight: **2**, the heaviest line the surface draws.
 *
 * Heavier than a plate's 1.5 and the caret's 1.5 on purpose. It is the only one
 * of the three that marks a *state the user chose* rather than a fact about the
 * drawing, and it has to stay legible against a plate contour on the same
 * footprint — the case `SELECTION_MARK_HEIGHT_MM` separates in depth, and this
 * separates in weight so the two do not read as one thick line.
 */
const SELECTION_MARK_WIDTH_PX = 2
const GRID_AXIS = '#8f5b21'


/**
 * The lattice, in millimetres, one inch a division.
 *
 * `GridHelper` still builds it — it is core three, it is the right arithmetic and
 * it carries the two colours on a vertex attribute — but it is used as a
 * *source of geometry* rather than mounted. Mounted, it is a `LineSegments`, and
 * that is one device pixel per line whatever the display: at dpr 2 the grid came
 * out at half a CSS pixel and broke into dashes, because a half-pixel line cannot
 * cover a pixel. {@link ScreenLine} draws the same 388 vertices at a width stated
 * in CSS pixels.
 *
 * Dropped {@link SURFACE_GRID_DROP_MM} below the plan so a floor tile resting on
 * `y = 0` does not z-fight with the line under it.
 *
 * Both arrays are memoised with no dependencies, so the helper is constructed
 * and read once: a fresh array every render would rebuild the geometry on every
 * pointer move.
 */
export function Lattice() {
  const lattice = useMemo(() => {
    const helper = new GridHelper(SURFACE_GRID_UNITS * GRID_UNIT_MM, SURFACE_GRID_UNITS, GRID_AXIS, GRID_LINE)
    const positions = new Float32Array(helper.geometry.getAttribute('position').array)
    const colours = new Float32Array(helper.geometry.getAttribute('color').array)
    // The helper owns a `LineBasicMaterial` and the geometry we have just copied
    // out of; neither is used again and neither is r3f's, because neither came
    // from JSX.
    helper.geometry.dispose()
    helper.material.dispose()
    return { positions, colours }
  }, [])

  return (
    <ScreenLine
      positions={lattice.positions}
      colors={lattice.colours}
      widthPx={GRID_WIDTH_PX}
      position={[0, -SURFACE_GRID_DROP_MM, 0]}
    />
  )
}

/**
 * A part with no mesh: its tagged footprint, filled and ringed.
 *
 * Flat, 0.6 mm of it, in the part's own material tint with a bright contour —
 * `markers.ts` sets out why that cannot be read as the tile and why it must not
 * be omitted.
 *
 * Takes `parts` and two colours rather than a piece, which since row **A4b** is
 * the only shape that works: a plate is drawn **per slot**, so it needs that
 * slot's own outline and tint, and a generated base has neither a record nor a
 * slot. `heightMm` is the slot's declared elevation plus the plate's thickness,
 * so a wall waiting for a mesh appears at wall height over the floor that has
 * one.
 *
 * **The geometry is handed in since row D7** and is not this component's to
 * dispose. It used to be built and released here, which was right while a plate
 * was the only thing drawn from it; the hover cue outlines the plate's own
 * silhouette, so the plate and the cue have to hold the same object, and the
 * owner is the one place that can see both — see the {@link plated} memo.
 */
/**
 * How far above the plan the selection's contour sits, in millimetres: **0.9**.
 *
 * Above {@link PLATE_HEIGHT_MM}'s 0.6 by 0.3 mm, which is the whole of the
 * reason for a constant rather than a reuse: a selected piece that is *also*
 * waiting for a mesh has a plate on the same footprint, and two coplanar loops
 * z-fight into a dashed line that reads as a rendering fault. 0.3 mm is far
 * enough apart to resolve at every camera distance the stage allows and far
 * enough below a 4.5 mm floor's top face to stay unmistakably a mark on the
 * ground rather than an edge of the tile.
 */
const SELECTION_MARK_HEIGHT_MM = 0.9

/**
 * The selected piece's contour, on the plan.
 *
 * Takes `parts` and not a piece, for {@link FootprintPlate}'s reason and one of
 * its own: the marker is the **whole instance's** footprint — every part's
 * polygons flattened, which is what `ScenePiece.polygons` is — so a corner
 * template is ringed once around its floor and its walls together rather than
 * three times. A per-part marker would say *three things are selected*.
 */
export function SelectionMark({ parts, colour }: { parts: readonly PlanPart[]; colour: string }) {
  const positions = useMemo(() => plateEdgePositions(parts, SELECTION_MARK_HEIGHT_MM), [parts])
  return <ScreenLine positions={positions} colour={colour} widthPx={SELECTION_MARK_WIDTH_PX} opacity={1} />
}

export function FootprintPlate({
  parts,
  geometry,
  tint,
  edge,
  heightMm,
}: {
  parts: readonly PlanPart[]
  geometry: BufferGeometry
  tint: string
  edge: string
  heightMm: number
}) {
  return (
    <>
      <mesh geometry={geometry} dispose={null}>
        <meshStandardMaterial color={tint} flatShading transparent opacity={0.72} roughness={0.95} metalness={0} />
      </mesh>
      <PlateOutline parts={parts} colour={edge} heightMm={heightMm} />
    </>
  )
}

/**
 * The ring around a plate, and the ghost's fallback when it has no mesh.
 *
 * Not the hover cue any more — row D7 moved that to a silhouette pass, and the
 * two things it drew were never the same drawing: this one traces the tagged
 * footprint on purpose, because a plate *is* the tagged footprint given 0.6 mm of
 * thickness, while a cue tracing a footprint over a 63.5 mm wall was the defect.
 */
export function PlateOutline({
  parts,
  colour,
  heightMm,
}: {
  parts: readonly PlanPart[]
  colour: string
  heightMm: number
}) {
  const positions = useMemo(() => plateEdgePositions(parts, heightMm), [parts, heightMm])

  return <ScreenLine positions={positions} colour={colour} widthPx={PLATE_OUTLINE_WIDTH_PX} opacity={0.9} />
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
export function Ghost({
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
export function Caret({ at, colour }: { at: PlanPoint; colour: string }) {
  const positions = useMemo(() => caretPositions(), [])
  return (
    <ScreenLine
      positions={positions}
      colour={colour}
      widthPx={CARET_WIDTH_PX}
      position={[at[0] * GRID_UNIT_MM, PLATE_HEIGHT_MM * 3, at[1] * GRID_UNIT_MM]}
    />
  )
}
