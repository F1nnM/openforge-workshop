/**
 * Lines whose width is stated in **device-independent pixels**, and the reason
 * this component exists rather than a `<lineSegments>`.
 *
 * ## What went wrong, once, and would go wrong again
 *
 * `THREE.LineSegments` draws `gl.LINES`, and WebGL renders those at **exactly
 * one device pixel** — `LineBasicMaterial.linewidth` is ignored on every
 * platform the app runs on, and three's own docs say so. That is a width nobody
 * chose: it is whatever one pixel of the drawing buffer happens to be, so it
 * silently rescales with `devicePixelRatio`.
 *
 * Raising {@link DPR_BAND}'s floor to 2 — which is what stopped the room looking
 * pixelated — took every one of those lines from `1 / 1.1 = 0.91` CSS px to
 * `1 / 2 = 0.5` CSS px. The grid, the plate rings and the plan caret all halved
 * in weight at once, and the grid started breaking into dashes because a
 * half-pixel line cannot cover a pixel. **No line of code about the grid
 * changed.** That is the shape of the bug worth designing out: a width that is
 * never written down anywhere cannot be reviewed, and it moves when something
 * unrelated moves.
 *
 * ## The fix is a unit, not a number
 *
 * `LineMaterial` renders a segment as an instanced quad, and its shader ends
 * with `offset *= linewidth; offset /= resolution.y`. So the width on screen is
 * `linewidth / resolution.y` of the viewport — a *ratio*. Feed it a `resolution`
 * in **CSS pixels** (r3f's `state.size`, not `state.gl.getDrawingBufferSize()`)
 * and `linewidth` is in CSS pixels too, and stays there whatever the dpr does.
 * The dpr-independence is then a property of the construction rather than a
 * number someone has to remember to re-tune.
 *
 * That is the whole rule this component exists to enforce, and
 * `tools/hygiene/source.test.ts` refuses `<lineSegments>` in app source so the
 * device-dependent primitive cannot come back by accident.
 *
 * ## What it costs
 *
 * A fat line is two triangles per segment instead of one `GL_LINE`, plus the
 * instanced-quad shader. For the three call sites here — a 388-vertex grid, a
 * footprint ring and a crosshair — that is nothing, and it buys widths that can
 * be *stated*: see `SURFACE_GRID_WIDTH_PX` and its neighbours.
 *
 * `LineSegments2` also needs `computeLineDistances` only for dashing, which
 * nothing here uses, so it is not called.
 */
import { useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { Color } from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'

export interface ScreenLineProps {
  /**
   * Segment endpoints, `[x0, y0, z0, x1, y1, z1, …]` — the same layout a
   * `BufferGeometry` position attribute for `LineSegments` carries, so a caller
   * that already builds one of those passes its array straight through.
   */
  readonly positions: Float32Array
  /**
   * Per-**vertex** colours, `[r, g, b, …]` in linear space, or omitted for a
   * single {@link colour}. What the grid needs: its axis lines are a different
   * colour from its cells and it is one draw call.
   */
  readonly colors?: Float32Array
  readonly colour?: string
  /**
   * Width in **CSS pixels**. Device-independent: the same on a 1× monitor, on
   * the owner's 1.1× display and on a 3× phone.
   */
  readonly widthPx: number
  readonly opacity?: number
  /** Millimetres, as every position in this project is. */
  readonly position?: readonly [number, number, number]
  readonly depthWrite?: boolean
  readonly renderOrder?: number
}

/**
 * One `LineSegments2` at a width that means the same thing on every display.
 *
 * The geometry and the material are both owned here and disposed on unmount —
 * `dispose={null}` on the primitive, because r3f did not create either and a
 * reconciler-driven dispose would race the memo that still holds them.
 */
export function ScreenLine({
  positions,
  colors,
  colour = '#ffffff',
  widthPx,
  opacity = 1,
  position,
  depthWrite = false,
  renderOrder,
}: ScreenLineProps) {
  // CSS pixels, deliberately. See the module note: this is the whole of what
  // makes `widthPx` device-independent.
  const size = useThree((state) => state.size)

  const geometry = useMemo(() => {
    const built = new LineSegmentsGeometry()
    built.setPositions(positions)
    if (colors !== undefined) built.setColors(colors)
    return built
  }, [positions, colors])

  const material = useMemo(
    () =>
      new LineMaterial({
        color: new Color(colour).getHex(),
        linewidth: widthPx,
        vertexColors: colors !== undefined,
        transparent: opacity < 1,
        opacity,
        depthWrite,
        // Rounded caps and joins would pill the crosshair's four separate
        // strokes; these are butt-ended segments and should look it.
        dashed: false,
      }),
    [colour, widthPx, colors, opacity, depthWrite],
  )

  useEffect(() => {
    material.resolution.set(size.width, size.height)
  }, [material, size.width, size.height])

  useEffect(
    () => () => {
      geometry.dispose()
    },
    [geometry],
  )
  useEffect(
    () => () => {
      material.dispose()
    },
    [material],
  )

  const line = useMemo(() => new LineSegments2(geometry, material), [geometry, material])

  return (
    <primitive
      object={line}
      dispose={null}
      {...(position === undefined ? {} : { position })}
      {...(renderOrder === undefined ? {} : { renderOrder })}
    />
  )
}
