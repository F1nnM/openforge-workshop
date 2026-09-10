/**
 * Test-only STL builder: boxes, minus boxes.
 *
 * Enough geometry to give the detector a doorway, a lintel notch, a tilted
 * socket (as a stack of thin stepped cuts) and a floor hole with exact expected
 * answers, and no network. The alternative — fixture files pulled from the
 * archive — makes every assertion a measurement of a mesh nobody can read, and
 * the answers the detector has to get right are the ones written into these box
 * coordinates.
 *
 * A cut that spans a solid produces a through-opening; a cut that stops inside
 * one produces a pocket. The six faces of each solid are emitted with the cut
 * regions removed by 2D rectangle subtraction, then the cut's own faces are
 * emitted wherever they fall strictly inside a solid. Face splitting is exact
 * but not minimal — the detector samples at 0.5 mm, so a face carved into four
 * rectangles instead of the fewest possible costs nothing.
 *
 * A cut whose mouth is *flush* with the solid's face leaves watertight geometry:
 * a 10 × 10 × 3 mm pocket flush with the test wall's +y face reads back as
 * `tmax` 3.5 inside the pocket against 6.5 beside it, which is exactly the 3 mm
 * recess a socket has to measure as. A cut that overshoots the face, as
 * the tests' doorway overshoots the top of the wall and both of its sides,
 * leaves its inner walls poking out by the overshoot: harmless along the axis it
 * opens on, where those walls project edge-on and `columns` discards them, but
 * it does enlarge the bounding box the grid is laid over. So overshoot only
 * where the fixture wants a through-opening, and stay flush for a pocket.
 *
 * Winding is *not* consistent, and does not need to be: the detector reads
 * vertex positions and never a normal, and `columns` sign-normalises every
 * triangle it visits.
 */

/** An axis-aligned box in millimetres. */
export interface Box {
  readonly min: readonly [number, number, number]
  readonly max: readonly [number, number, number]
}

type Axis = 0 | 1 | 2
type Point = readonly [number, number, number]
type Tri = readonly [Point, Point, Point]
/** `[p0, q0, p1, q1]` in whichever plane the caller is working in. */
type Rect = readonly [number, number, number, number]

/**
 * The two axes a face with normal `axis` spans.
 *
 * Spelled here rather than imported from `geometry.ts` on purpose: the builder
 * supplies the expected answers, so sharing a helper with the module under test
 * would let one mistake cancel itself out on both sides of the assertion.
 */
const PLANE: readonly [readonly [Axis, Axis], readonly [Axis, Axis], readonly [Axis, Axis]] = [
  [1, 2],
  [0, 2],
  [0, 1],
]

function quad(a: Point, b: Point, c: Point, d: Point): Tri[] {
  return [
    [a, b, c],
    [a, c, d],
  ]
}

/** Rectangles of `outer` not covered by any of `holes`, all in one (p, q) plane. */
function subtractRects(outer: Rect, holes: readonly Rect[]): Rect[] {
  let pieces: Rect[] = [outer]
  for (const [hp0, hq0, hp1, hq1] of holes) {
    const next: Rect[] = []
    for (const [p0, q0, p1, q1] of pieces) {
      if (hp1 <= p0 || hp0 >= p1 || hq1 <= q0 || hq0 >= q1) {
        next.push([p0, q0, p1, q1])
        continue
      }
      const cp0 = Math.max(p0, hp0),
        cp1 = Math.min(p1, hp1),
        cq0 = Math.max(q0, hq0),
        cq1 = Math.min(q1, hq1)
      if (p0 < cp0) next.push([p0, q0, cp0, q1])
      if (cp1 < p1) next.push([cp1, q0, p1, q1])
      if (q0 < cq0) next.push([cp0, q0, cp1, cq0])
      if (cq1 < q1) next.push([cp0, cq1, cp1, q1])
    }
    pieces = next
  }
  return pieces
}

/** A point on the plane `axis = side`, at `(pp, qq)` in that plane's own axes. */
function on(axis: Axis, side: number, p: Axis, q: Axis, pp: number, qq: number): Point {
  const v: [number, number, number] = [0, 0, 0]
  v[axis] = side
  v[p] = pp
  v[q] = qq
  return v
}

/** Binary STL bytes of the union of `solids` minus `cuts`. */
export function syntheticStl(solids: readonly Box[], cuts: readonly Box[] = []): Uint8Array {
  const tris: Tri[] = []

  for (const solid of solids) {
    for (const axis of [0, 1, 2] as const) {
      const [p, q] = PLANE[axis]
      for (const side of [solid.min[axis], solid.max[axis]]) {
        const holes = cuts
          .filter((cut) => cut.min[axis] <= side && cut.max[axis] >= side) // the cut reaches this face
          .map((cut): Rect => [cut.min[p], cut.min[q], cut.max[p], cut.max[q]])
        const outer: Rect = [solid.min[p], solid.min[q], solid.max[p], solid.max[q]]
        for (const [p0, q0, p1, q1] of subtractRects(outer, holes)) {
          tris.push(
            ...quad(
              on(axis, side, p, q, p0, q0),
              on(axis, side, p, q, p1, q0),
              on(axis, side, p, q, p1, q1),
              on(axis, side, p, q, p0, q1),
            ),
          )
        }
      }
    }
  }

  for (const cut of cuts) {
    // The cut's inner walls: its faces that lie strictly inside some solid. A
    // face flush with, or outside, every solid bounds no material and is skipped.
    for (const axis of [0, 1, 2] as const) {
      const [p, q] = PLANE[axis]
      for (const side of [cut.min[axis], cut.max[axis]]) {
        if (!solids.some((solid) => side > solid.min[axis] && side < solid.max[axis])) continue
        tris.push(
          ...quad(
            on(axis, side, p, q, cut.min[p], cut.min[q]),
            on(axis, side, p, q, cut.max[p], cut.min[q]),
            on(axis, side, p, q, cut.max[p], cut.max[q]),
            on(axis, side, p, q, cut.min[p], cut.max[q]),
          ),
        )
      }
    }
  }

  const bytes = new Uint8Array(84 + tris.length * 50)
  const view = new DataView(bytes.buffer)
  view.setUint32(80, tris.length, true)
  let at = 84
  for (const tri of tris) {
    at += 12 // the facet normal stays zero; nothing downstream reads it
    for (const vertex of tri) {
      view.setFloat32(at, vertex[0], true)
      view.setFloat32(at + 4, vertex[1], true)
      view.setFloat32(at + 8, vertex[2], true)
      at += 12
    }
    at += 2 // attribute byte count
  }
  return bytes
}
