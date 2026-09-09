/**
 * The depth map — the whole detector rests on this file.
 *
 * Cast a 0.5 mm grid through the mesh along one axis and keep, per column, the
 * first hit from either side and the hit count. Everything a mount is — an
 * opening (a column with no hits inside the silhouette), a socket (a column
 * whose first hit sits well behind its neighbours), a hole (an empty column in a
 * floor) — is read off that map. Measured over the 227-host sample the spike
 * used, 0.5 mm resolves a 5.5 × 3 mm Dupont slot at 11 × 6 cells and costs
 * ~0.4 s per pass over a 170k-triangle wall; no BVH is needed because each
 * triangle only visits the cells of its own 2D bbox.
 */

/** Grid pitch of every cast in this file, millimetres. */
export const CELL_MM = 0.5

/** Which of x, y, z a cast runs along. */
export type Axis = 0 | 1 | 2

export interface Columns {
  readonly axis: Axis
  readonly u: Axis
  readonly v: Axis
  readonly ou: number
  readonly ov: number
  readonly nu: number
  readonly nv: number
  /** First hit along `axis`, per column. `Infinity` where nothing was hit. */
  readonly tmin: Float64Array
  /** Last hit along `axis`, per column. `-Infinity` where nothing was hit. */
  readonly tmax: Float64Array
  /** Surface crossings per column, index `i * nv + j`. */
  readonly hits: Uint32Array
}

function others(axis: Axis): [Axis, Axis] {
  return axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1]
}

/** Twice the area below which a projected triangle is an edge, not a surface. */
const DEGENERATE_AREA = 1e-12

/** Fraction of a triangle's projected area within which a sample counts as covered. */
const EDGE_BAND = 1e-9

/**
 * How far the sample lattice sits off the bounding-box corner, in u and in v.
 *
 * A sample that lands exactly on the edge of a projected triangle has no right
 * answer available. Count it in both of the triangles that meet there and a
 * quad-triangulated face reads as two crossings instead of one — the 50 × 50
 * wall the tests use has its diagonal through every plain cell centre on
 * `z = x + 25`, and reports `hits = 4`. Hand the edge to one of the two by a
 * claim rule and the *other* case breaks: an edge on the silhouette of the
 * projection has only one non-degenerate triangle — cast along y, a wall's top
 * edge is shared only with the edge-on top face, which never runs — so whenever
 * the claim falls to the discarded triangle the sample is lost, and a 50.25 mm
 * tall wall reads `hits = 0`, `tmin = Infinity` along the whole `z = 50.25` row
 * of solid material. Measured, both of them.
 *
 * So the lattice is moved instead of the arithmetic: no sample lands on an
 * axis-aligned face edge or a 45° diagonal of a mesh whose features sit on
 * quarter-millimetre multiples of its own bounding-box corner, which is what
 * tile geometry is. Two different offsets, because a single one shifts u and v
 * together and cancels along exactly the 45° diagonals a quad is cut on. Both
 * are far below the 0.5 mm cell — a feature cannot hide between samples — and
 * far above float32's ~4e-6 mm resolution at tile scale, so the nudge survives
 * the coordinates being read back out of an STL.
 */
const NUDGE_U_MM = 1e-3,
  NUDGE_V_MM = 3e-3

/** The grid of a mesh with nothing measurable in it. */
function noColumns(axis: Axis, u: Axis, v: Axis): Columns {
  return {
    axis,
    u,
    v,
    ou: 0,
    ov: 0,
    nu: 0,
    nv: 0,
    tmin: new Float64Array(0),
    tmax: new Float64Array(0),
    hits: new Uint32Array(0),
  }
}

/**
 * Cast the grid along `axis` over a non-indexed triangle soup.
 *
 * The grid spans the mesh's own bounding box in the other two axes, sampled at
 * cell centres nudged off the box corner, and each triangle only visits the
 * cells its 2D bounding box covers — which is why no acceleration structure is
 * needed for a build-time pass.
 */
export function columns(positions: ArrayLike<number>, triangles: number, axis: Axis): Columns {
  const [u, v] = others(axis)
  // A valid corpus STL can declare zero facets — the smallest live file is an
  // 84-byte header doing exactly that — and an empty mesh has no grid, not a
  // NaN-sized one.
  if (triangles <= 0) return noColumns(axis, u, v)

  let lu = Infinity,
    lv = Infinity,
    hu = -Infinity,
    hv = -Infinity
  for (let o = 0; o < triangles * 9; o += 3) {
    const pu = positions[o + u] as number
    const pv = positions[o + v] as number
    if (pu < lu) lu = pu
    if (pu > hu) hu = pu
    if (pv < lv) lv = pv
    if (pv > hv) hv = pv
  }
  if (!Number.isFinite(lu) || !Number.isFinite(lv)) return noColumns(axis, u, v)

  // The cell count comes from the true extent and the origin from the nudged
  // one, so the nudge cannot add a row: the last centre still clears `hu`, and
  // the first still precedes `lu`.
  const ou = lu - NUDGE_U_MM,
    ov = lv - NUDGE_V_MM
  const nu = Math.ceil((hu - lu) / CELL_MM) + 1,
    nv = Math.ceil((hv - lv) / CELL_MM) + 1
  const tmin = new Float64Array(nu * nv).fill(Infinity),
    tmax = new Float64Array(nu * nv).fill(-Infinity),
    hits = new Uint32Array(nu * nv)

  for (let t = 0; t < triangles; t += 1) {
    const o = t * 9
    const x0 = positions[o + u] as number,
      y0 = positions[o + v] as number,
      w0 = positions[o + axis] as number
    const x1 = positions[o + 3 + u] as number,
      y1 = positions[o + 3 + v] as number,
      w1 = positions[o + 3 + axis] as number
    const x2 = positions[o + 6 + u] as number,
      y2 = positions[o + 6 + v] as number,
      w2 = positions[o + 6 + axis] as number

    // Twice the projected signed area. A triangle edge-on to the cast covers no
    // cell, and dividing by its area would put a hit everywhere in its bbox.
    const area2 = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0)
    if (Math.abs(area2) < DEGENERATE_AREA) continue
    // Sign-normalised so an inside sample makes all three edge functions
    // positive whichever way this triangle happens to wind.
    const sign = area2 > 0 ? 1 : -1
    const scale = Math.abs(area2),
      band = EDGE_BAND * scale

    const i0 = Math.floor((Math.min(x0, x1, x2) - ou) / CELL_MM),
      i1 = Math.floor((Math.max(x0, x1, x2) - ou) / CELL_MM)
    const j0 = Math.floor((Math.min(y0, y1, y2) - ov) / CELL_MM),
      j1 = Math.floor((Math.max(y0, y1, y2) - ov) / CELL_MM)
    for (let i = i0; i <= i1; i += 1) {
      const px = ou + (i + 0.5) * CELL_MM
      for (let j = j0; j <= j1; j += 1) {
        const py = ov + (j + 0.5) * CELL_MM
        // Each edge function is the barycentric weight of the opposite corner,
        // times `scale`. The band is inclusive on purpose: the nudged lattice
        // means a sample this close to an edge is float noise rather than a real
        // coincidence, and counting it twice costs a wrong `hits` where dropping
        // it would cost a phantom hole.
        const e01 = sign * ((x1 - x0) * (py - y0) - (y1 - y0) * (px - x0))
        if (e01 < -band) continue
        const e12 = sign * ((x2 - x1) * (py - y1) - (y2 - y1) * (px - x1))
        if (e12 < -band) continue
        const e20 = sign * ((x0 - x2) * (py - y2) - (y0 - y2) * (px - x2))
        if (e20 < -band) continue

        const w = (e12 * w0 + e20 * w1 + e01 * w2) / scale
        const k = i * nv + j
        if (w < (tmin[k] as number)) tmin[k] = w
        if (w > (tmax[k] as number)) tmax[k] = w
        hits[k] = (hits[k] as number) + 1
      }
    }
  }

  return { axis, u, v, ou, ov, nu, nv, tmin, tmax, hits }
}

/**
 * 4-connected components of a mask, numbered from 1. Zero means "not in a
 * component".
 *
 * 4-connected rather than 8: two openings that meet at a single corner are two
 * openings, and a diagonal chain of stray cells left by a textured surface is
 * not a mount.
 */
export function label(
  mask: Uint8Array,
  nu: number,
  nv: number,
): { readonly labels: Int32Array; readonly count: number } {
  const labels = new Int32Array(nu * nv)
  let count = 0
  const stack: number[] = []
  const neighbours = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const
  for (let s = 0; s < nu * nv; s += 1) {
    if (mask[s] === 0 || labels[s] !== 0) continue
    count += 1
    labels[s] = count
    stack.push(s)
    while (stack.length > 0) {
      const k = stack.pop() as number
      const i = Math.floor(k / nv),
        j = k % nv
      for (const [di, dj] of neighbours) {
        const ni = i + di,
          nj = j + dj
        if (ni < 0 || nj < 0 || ni >= nu || nj >= nv) continue
        const n = ni * nv + nj
        if (mask[n] !== 0 && labels[n] === 0) {
          labels[n] = count
          stack.push(n)
        }
      }
    }
  }
  return { labels, count }
}

export interface Opening {
  /** (u, v) centre of the body rows, mm. */
  readonly at: readonly [number, number]
  readonly width: number
  readonly sill: number
  readonly head: number
  readonly bboxSize: readonly [number, number]
  readonly area: number
  readonly openTop: boolean
}

const OPENING_MIN_AREA_MM2 = 60,
  OPENING_MIN_SIZE_MM = 8

function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0
}

/**
 * Empty columns *inside the silhouette*: below the top line (90th percentile of
 * per-column topmost hits) and between the ends. An open-topped doorway is then
 * a component that reaches the top line, reported with `openTop`, rather than
 * one merged with the sky. Width is the median run over the body rows, which is
 * immune to the slivers a textured shoulder leaves under the top line.
 */
export function throughOpenings(col: Columns): Opening[] {
  const { nu, nv, hits } = col
  const tops: number[] = []
  let left = nu,
    right = -1
  for (let i = 0; i < nu; i += 1) {
    for (let j = nv - 1; j >= 0; j -= 1) {
      if ((hits[i * nv + j] as number) > 0) {
        tops.push(j)
        if (i < left) left = i
        if (i > right) right = i
        break
      }
    }
  }
  if (tops.length === 0) return []
  const top = percentile(
    tops.sort((a, b) => a - b),
    90,
  )

  const mask = new Uint8Array(nu * nv)
  for (let i = left + 1; i < right; i += 1) {
    for (let j = 0; j <= top; j += 1) if (hits[i * nv + j] === 0) mask[i * nv + j] = 1
  }
  const { labels, count } = label(mask, nu, nv)
  const cellsOf: [number, number][][] = Array.from({ length: count }, () => [])
  for (let k = 0; k < nu * nv; k += 1) {
    const component = labels[k] as number
    if (component === 0) continue
    const cells = cellsOf[component - 1] as [number, number][]
    cells.push([Math.floor(k / nv), k % nv])
  }

  const out: Opening[] = []
  for (const cells of cellsOf) {
    const area = cells.length * CELL_MM * CELL_MM
    if (area < OPENING_MIN_AREA_MM2) continue

    let iMin = Infinity,
      iMax = -Infinity,
      jMin = Infinity,
      jMax = -Infinity
    const perRow = new Map<number, number>()
    for (const [i, j] of cells) {
      if (i < iMin) iMin = i
      if (i > iMax) iMax = i
      if (j < jMin) jMin = j
      if (j > jMax) jMax = j
      perRow.set(j, (perRow.get(j) ?? 0) + 1)
    }
    const su = (iMax - iMin + 1) * CELL_MM,
      sv = (jMax - jMin + 1) * CELL_MM
    if (Math.min(su, sv) < OPENING_MIN_SIZE_MM) continue

    // The body is the rows at least half as wide as the median row, so a
    // tapering shoulder or a sliver under the top line cannot set the width.
    const median = percentile(
      [...perRow.values()].sort((a, b) => a - b),
      50,
    )
    const body = [...perRow.entries()].filter(([, run]) => run >= 0.5 * median)
    const width =
      percentile(
        body.map(([, run]) => run).sort((a, b) => a - b),
        50,
      ) * CELL_MM
    const bodyRows = new Set(body.map(([j]) => j))

    let sumU = 0,
      inBody = 0
    for (const [i, j] of cells) {
      if (!bodyRows.has(j)) continue
      sumU += col.ou + (i + 0.5) * CELL_MM
      inBody += 1
    }
    let vMin = Infinity,
      vMax = -Infinity
    for (const j of bodyRows) {
      if (j < vMin) vMin = j
      if (j > vMax) vMax = j
    }

    out.push({
      at: [sumU / inBody, col.ov + ((vMin + vMax) / 2 + 0.5) * CELL_MM],
      width,
      sill: col.ov + vMin * CELL_MM,
      head: col.ov + (vMax + 1) * CELL_MM,
      bboxSize: [su, sv],
      area,
      openTop: vMax >= top - 2,
    })
  }
  return out.sort((a, b) => b.area - a.area)
}

/**
 * NaN-aware median over a win×win window; a pocket narrower than win/2 pops out
 * of it.
 *
 * O(nu·nv·win²·log win) — fine for the ≤ 200 × 100 grids here (≈ 0.3 s); do not
 * optimise until a measurement says to.
 */
export function localBaseline(
  values: Float64Array,
  nu: number,
  nv: number,
  win = 25,
): Float64Array {
  const half = Math.floor(win / 2),
    out = new Float64Array(nu * nv).fill(NaN)
  const window: number[] = []
  for (let i = 0; i < nu; i += 1) {
    for (let j = 0; j < nv; j += 1) {
      window.length = 0
      for (let a = Math.max(0, i - half); a <= Math.min(nu - 1, i + half); a += 1) {
        for (let b = Math.max(0, j - half); b <= Math.min(nv - 1, j + half); b += 1) {
          const x = values[a * nv + b] as number
          if (Number.isFinite(x)) window.push(x)
        }
      }
      if (window.length === 0) continue
      window.sort((p, q) => p - q)
      out[i * nv + j] = window[Math.floor(window.length / 2)] as number
    }
  }
  return out
}

/**
 * The two axes a right-handed turn about `axis` moves, in order.
 *
 * Cyclic — (y, z), (z, x), (x, y) — which is *not* `others()`'s ascending pair.
 * They agree about x and about z and disagree about y, where the ascending pair
 * (x, z) turns the wrong way and computes R_y(−θ).
 */
function turnPair(axis: Axis): [Axis, Axis] {
  return axis === 0 ? [1, 2] : axis === 1 ? [2, 0] : [0, 1]
}

/** Rotate every vertex about `axis` by `degrees` (right-handed). Returns a copy. */
export function rotateAbout(
  positions: ArrayLike<number>,
  axis: Axis,
  degrees: number,
): Float64Array {
  const [i, j] = turnPair(axis)
  const c = Math.cos((degrees * Math.PI) / 180),
    s = Math.sin((degrees * Math.PI) / 180)
  const out = Float64Array.from(positions)
  for (let o = 0; o < out.length; o += 3) {
    const a = out[o + i] as number,
      b = out[o + j] as number
    out[o + i] = c * a - s * b
    out[o + j] = s * a + c * b
  }
  return out
}
