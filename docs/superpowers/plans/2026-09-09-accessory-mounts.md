# Accessory Mounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure where accessories (torches, doors, lintels, portcullises, trapdoors…) attach to the host meshes that declare slots for them, carry that into the catalog index, let a fill hold accessory fills, and draw, count and download them.

**Architecture:** A build-time tool (`tools/mounts/`) depth-maps every host STL, finds openings / tilted sockets / holes, and writes a blob-keyed inventory the pipeline joins onto `CatalogRecord.mounts` (hosts) and `CatalogRecord.anchor` (inserts). The store nests a `holds` map inside `SlotFill`; the resolver, bill, share codec, plan projection and `buildRoom3D` walk it, and each hold becomes one instance per measured mount.

**Tech Stack:** TypeScript (`tsx` CLIs, `worker_threads`), Zod, zustand, three.js, vitest. Node 22 (`mise.toml`).

**Spec:** `docs/superpowers/specs/2026-09-09-accessory-mounts-design.md` — read it first; every task below argues from it.

## Global Constraints

- Work in the worktree at `.claude/worktrees/accessory-mounts` on branch `worktree-accessory-mounts`. Never `cd` out of it.
- `npm run lint`, `npm run typecheck`, and the tests you touch must pass before each commit; `mise run check` at the end.
- Match the surrounding style: module docblocks that state *why* with measured numbers, `readonly` interfaces, Zod as the source of truth for any persisted or emitted shape, no `any`, no barrel-cycle (`@/store` must not import screens; `builder/three` consumes `@/template`, never the reverse).
- Commit messages describe the result, no conversation narration, no self-advertising. End every commit message with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Units: the catalog is millimetres, Z-up, 25.4 mm per grid unit (`GRID_UNIT_MM` in `@/catalog`). three.js is Y-up: `(x, y, z)_mesh → (x, z, −y)` (`place.ts#uprightBounds`).
- **Bbox coordinates** (the contract for every `at`/`axis` the browser sees): x and y measured from the host bbox **centre**, z from the bbox **bottom**, millimetres, Z-up. Axes are unit vectors in the same Z-up frame.
- Nothing in `src/` may fetch an STL at runtime for this feature; everything measured arrives through `catalog.json`.
- The real measuring run reads ≈ 16 GB from `objects.openforge.tools`; run it once (Task 13), resumable, concurrency ≤ 8, never from a test.

---

## File structure

| Path | Responsibility |
| --- | --- |
| `tools/mounts/synthetic.ts` | Test-only: build binary STL bytes from axis-aligned boxes (union) and boxes-with-cutouts, so detector tests need no network. |
| `tools/mounts/geometry.ts` | Triangle soup → depth-map `Columns`; connected components; `throughOpenings`; `localBaseline`; `rotateAbout`. |
| `tools/mounts/sockets.ts` | The tilt sweep: `socketPoses` (every qualifying pocket on one face, rotated back to mesh mm). |
| `tools/mounts/arcs.ts` | `fitArcCentre`, `unroll`, `reroll`, `rerollVector` for arc footprints. |
| `tools/mounts/classify.ts` | Slot class table, per-class signatures, `analyseHost` → `HostMeasurement`, `analyseInsert` → `InsertMeasurement`; conversion to bbox coordinates. |
| `tools/mounts/catalog.ts` | Targets (hosts, inserts) from `catalog.json`; paths; `modelUrl`. |
| `tools/mounts/sidecar.ts` | JSON-lines log entries, `MountInventory` assembly (`buildInventory`). |
| `tools/mounts/worker.ts` | `worker_threads` entry: bytes in, `HostMeasurement`/`InsertMeasurement` out. |
| `tools/mounts/run.ts` | Fetch (via `tools/measure/fetch.ts`), dispatch to workers, append log, resume. |
| `tools/mounts/cli.ts` | `npm run mounts` — modes `--dry-run`, run, `--report`, `--inventory`, `--sample N`, `--retry-failed`. |
| `pipeline/mounts.ts` | Zod `MountInventory`, `readMountInventory`, `MOUNT_INVENTORY_PATH`, the record join helpers. |
| `pipeline/mounts/inventory.json` | Checked-in measurement (empty shell until Task 13 fills it). |
| `src/catalog/schema.ts` | `Mount`, `InsertAnchor`, `HoldName`-free record fields `mounts?`, `anchor?`; `SCHEMA_VERSION = 5`. |
| `src/catalog/mounts.ts` | `mountsFor(record, slot)`, `faceVector`, `MOUNT_KINDS`. |
| `src/store/schema.ts` | `HoldName`, `SlotFill.holds`. |
| `src/store/workshopStore.ts` | `fillHold`, `pinHold`, `clearHold`, `unpinHold`, `fillHolds`. |
| `src/store/migrations.ts` | `STORE_VERSION = 9`, accept 8, salvage `holds`. |
| `src/share/payload.ts`, `src/share/link.ts` | Format 6: hold columns. |
| `src/assembly/resolve.ts`, `bill.ts` | Hold parts, `hold` on refs, mount-count quantity, `unplaced`. |
| `src/builder/canvas/scene.ts`, `catalog.ts` | `PlanAccessory`, `PlanPiece.accessories`, `PlanScene.unplaced`. |
| `src/builder/three/place.ts`, `instances.ts` | `accessoryMatrix`, accessory instances, `Room3D.unplaced`. |
| `src/builder/three/holds.ts` | `solveHolds`, `missingHolds`, `useHoldSolver`. |
| `src/builder/panels/slots/AccessorySection.tsx` | Picker writes holds; mount count shown. |

---

### Task 1: Synthetic STLs and the depth map

**Files:**
- Create: `tools/mounts/synthetic.ts`
- Create: `tools/mounts/geometry.ts`
- Test: `tools/mounts/geometry.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // synthetic.ts
  export interface Box { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] }
  /** Binary STL bytes of the union of `solids` minus `cuts` — boxes only, cuts fully inside or through a solid. */
  export function syntheticStl(solids: readonly Box[], cuts?: readonly Box[]): Uint8Array
  // geometry.ts
  export const CELL_MM = 0.5
  export type Axis = 0 | 1 | 2
  export interface Columns {
    readonly axis: Axis; readonly u: Axis; readonly v: Axis
    readonly ou: number; readonly ov: number; readonly nu: number; readonly nv: number
    readonly tmin: Float64Array; readonly tmax: Float64Array; readonly hits: Uint32Array   // nu*nv, index i*nv+j
  }
  export function columns(positions: ArrayLike<number>, triangles: number, axis: Axis): Columns
  export function label(mask: Uint8Array, nu: number, nv: number): { readonly labels: Int32Array; readonly count: number }
  export interface Opening {
    readonly at: readonly [number, number]      // (u, v) centre of the body rows, mm
    readonly width: number; readonly sill: number; readonly head: number
    readonly bboxSize: readonly [number, number]; readonly area: number; readonly openTop: boolean
  }
  export function throughOpenings(col: Columns): Opening[]
  export function localBaseline(values: Float64Array, nu: number, nv: number, win?: number): Float64Array
  export function rotateAbout(positions: ArrayLike<number>, axis: Axis, degrees: number): Float64Array
  ```

- [ ] **Step 1: Write `synthetic.ts`**

A box-minus-boxes STL writer. A cut that spans a solid produces a through-opening; a cut inside a face produces a pocket. Emit the six faces of each solid with the cut regions removed by splitting rectangles (2D rectangle subtraction per face), then the cut's inner walls. Keep it simple and exact — the detector samples at 0.5 mm, so face splitting only needs to be correct, not minimal.

```ts
// tools/mounts/synthetic.ts
/**
 * Test-only STL builder: boxes, minus boxes. Enough geometry to give the
 * detector a doorway, a lintel notch, a tilted socket (as a stack of thin
 * stepped cuts) and a floor hole with exact expected answers, and no network.
 */
export interface Box { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] }

type Tri = readonly [readonly number[], readonly number[], readonly number[]]

function quad(a: number[], b: number[], c: number[], d: number[]): Tri[] {
  return [[a, b, c], [a, c, d]]
}

/** Rectangles of `outer` not covered by any `holes`, all in a (p, q) plane. */
function subtractRects(outer: [number, number, number, number], holes: [number, number, number, number][]): [number, number, number, number][] {
  let pieces: [number, number, number, number][] = [outer]
  for (const [hp0, hq0, hp1, hq1] of holes) {
    const next: [number, number, number, number][] = []
    for (const [p0, q0, p1, q1] of pieces) {
      if (hp1 <= p0 || hp0 >= p1 || hq1 <= q0 || hq0 >= q1) { next.push([p0, q0, p1, q1]); continue }
      const cp0 = Math.max(p0, hp0), cp1 = Math.min(p1, hp1), cq0 = Math.max(q0, hq0), cq1 = Math.min(q1, hq1)
      if (p0 < cp0) next.push([p0, q0, cp0, q1])
      if (cp1 < p1) next.push([cp1, q0, p1, q1])
      if (q0 < cq0) next.push([cp0, q0, cp1, cq0])
      if (cq1 < q1) next.push([cp0, cq1, cp1, q1])
    }
    pieces = next
  }
  return pieces
}

export function syntheticStl(solids: readonly Box[], cuts: readonly Box[] = []): Uint8Array {
  const tris: Tri[] = []
  for (const s of solids) {
    for (const axis of [0, 1, 2] as const) {
      const [p, q] = [0, 1, 2].filter((a) => a !== axis) as [number, number]
      for (const side of [s.min[axis], s.max[axis]]) {
        const holes = cuts
          .filter((c) => c.min[axis] <= side && c.max[axis] >= side)   // the cut reaches this face
          .map((c) => [c.min[p], c.min[q], c.max[p], c.max[q]] as [number, number, number, number])
        for (const [p0, q0, p1, q1] of subtractRects([s.min[p], s.min[q], s.max[p], s.max[q]], holes)) {
          const at = (pp: number, qq: number) => { const v = [0, 0, 0]; v[axis] = side; v[p] = pp; v[q] = qq; return v }
          tris.push(...quad(at(p0, q0), at(p1, q0), at(p1, q1), at(p0, q1)))
        }
      }
    }
  }
  for (const c of cuts) {
    // inner walls: the cut's faces that lie strictly inside some solid
    for (const axis of [0, 1, 2] as const) {
      const [p, q] = [0, 1, 2].filter((a) => a !== axis) as [number, number]
      for (const side of [c.min[axis], c.max[axis]]) {
        const inside = solids.some((s) => side > s.min[axis] && side < s.max[axis])
        if (!inside) continue
        const at = (pp: number, qq: number) => { const v = [0, 0, 0]; v[axis] = side; v[p] = pp; v[q] = qq; return v }
        tris.push(...quad(at(c.min[p], c.min[q]), at(c.max[p], c.min[q]), at(c.max[p], c.max[q]), at(c.min[p], c.max[q])))
      }
    }
  }
  const bytes = new Uint8Array(84 + tris.length * 50)
  const view = new DataView(bytes.buffer)
  view.setUint32(80, tris.length, true)
  tris.forEach((tri, i) => {
    const o = 84 + i * 50 + 12
    tri.forEach((v, k) => v.forEach((x, m) => view.setFloat32(o + k * 12 + m * 4, x, true)))
  })
  return bytes
}
```

(Winding is not consistent and does not need to be: the detector never reads normals.)

- [ ] **Step 2: Write the failing tests**

```ts
// tools/mounts/geometry.test.ts
import { describe, expect, it } from 'vitest'
import { parseStl } from '../../src/three/stl/parse'
import { CELL_MM, columns, label, localBaseline, rotateAbout, throughOpenings } from './geometry'
import { syntheticStl } from './synthetic'

// A 50 × 13 × 50 wall along x, thin along y, with a 25 mm wide doorway from z = 10 to the top.
const WALL = { min: [-25, -6.5, 0], max: [25, 6.5, 50] } as const
const DOORWAY = { min: [-12.5, -7, 10], max: [12.5, 7, 51] } as const

describe('columns', () => {
  it('casts a 0.5 mm grid and records first/last hits per column', () => {
    const stl = parseStl(syntheticStl([WALL]))
    const col = columns(stl.positions, stl.triangles, 1)
    expect(col.nu).toBe(Math.ceil(50 / CELL_MM) + 1)
    const i = Math.floor((0 - col.ou) / CELL_MM), j = Math.floor((25 - col.ov) / CELL_MM)
    expect(col.hits[i * col.nv + j]).toBe(2)
    expect(col.tmin[i * col.nv + j]).toBeCloseTo(-6.5, 3)
    expect(col.tmax[i * col.nv + j]).toBeCloseTo(6.5, 3)
  })
})

describe('throughOpenings', () => {
  it('finds an open-topped doorway with its width, sill and head', () => {
    const stl = parseStl(syntheticStl([WALL], [DOORWAY]))
    const [opening, ...rest] = throughOpenings(columns(stl.positions, stl.triangles, 1))
    expect(rest).toEqual([])
    expect(opening.width).toBeCloseTo(25, 0)
    expect(opening.sill).toBeCloseTo(10, 0)
    expect(opening.head).toBeCloseTo(50, 0)
    expect(opening.at[0]).toBeCloseTo(0, 0)
    expect(opening.openTop).toBe(true)
  })
  it('finds an enclosed window and reports it closed at the top', () => {
    const stl = parseStl(syntheticStl([WALL], [{ min: [-8, -7, 20], max: [8, 7, 40] }]))
    const [opening] = throughOpenings(columns(stl.positions, stl.triangles, 1))
    expect(opening.openTop).toBe(false)
    expect(opening.width).toBeCloseTo(16, 0)
    expect(opening.head).toBeCloseTo(40, 0)
  })
  it('finds nothing on a solid wall', () => {
    const stl = parseStl(syntheticStl([WALL]))
    expect(throughOpenings(columns(stl.positions, stl.triangles, 1))).toEqual([])
  })
})

describe('localBaseline', () => {
  it('follows a step in the surface instead of averaging across it', () => {
    const nu = 60, nv = 10
    const values = new Float64Array(nu * nv)
    for (let i = 0; i < nu; i += 1) for (let j = 0; j < nv; j += 1) values[i * nv + j] = i < 30 ? 0 : 5
    const base = localBaseline(values, nu, nv, 9)
    expect(base[10 * nv + 5]).toBe(0)
    expect(base[50 * nv + 5]).toBe(5)
  })
})

describe('rotateAbout', () => {
  it('turns a point a quarter turn about x', () => {
    const out = rotateAbout([0, 1, 0], 0, 90)
    expect(out[1]).toBeCloseTo(0); expect(out[2]).toBeCloseTo(1)
  })
})

describe('label', () => {
  it('counts 4-connected components', () => {
    const mask = new Uint8Array([1, 1, 0, 0, 1, 0, 0, 0, 1])   // 3×3: one 3-cell component (0,0),(0,1),(1,1)? no: (0,0),(0,1) and (1,1) touch → one; (2,2) another
    expect(label(mask, 3, 3).count).toBe(2)
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tools/mounts/geometry.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement `geometry.ts`**

```ts
// tools/mounts/geometry.ts
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
export const CELL_MM = 0.5
export type Axis = 0 | 1 | 2

export interface Columns {
  readonly axis: Axis; readonly u: Axis; readonly v: Axis
  readonly ou: number; readonly ov: number; readonly nu: number; readonly nv: number
  readonly tmin: Float64Array; readonly tmax: Float64Array; readonly hits: Uint32Array
}

function others(axis: Axis): [Axis, Axis] {
  return axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1]
}

export function columns(positions: ArrayLike<number>, triangles: number, axis: Axis): Columns {
  const [u, v] = others(axis)
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < triangles * 9; i += 3) for (let k = 0; k < 3; k += 1) {
    const x = positions[i + k] as number
    if (x < lo[k]) lo[k] = x; if (x > hi[k]) hi[k] = x
  }
  const ou = lo[u], ov = lo[v]
  const nu = Math.ceil((hi[u] - ou) / CELL_MM) + 1, nv = Math.ceil((hi[v] - ov) / CELL_MM) + 1
  const tmin = new Float64Array(nu * nv).fill(Infinity), tmax = new Float64Array(nu * nv).fill(-Infinity), hits = new Uint32Array(nu * nv)
  for (let t = 0; t < triangles; t += 1) {
    const o = t * 9
    const x0 = positions[o + u] as number, y0 = positions[o + v] as number, w0 = positions[o + axis] as number
    const x1 = positions[o + 3 + u] as number, y1 = positions[o + 3 + v] as number, w1 = positions[o + 3 + axis] as number
    const x2 = positions[o + 6 + u] as number, y2 = positions[o + 6 + v] as number, w2 = positions[o + 6 + axis] as number
    const det = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
    if (Math.abs(det) < 1e-12) continue
    const i0 = Math.floor((Math.min(x0, x1, x2) - ou) / CELL_MM), i1 = Math.floor((Math.max(x0, x1, x2) - ou) / CELL_MM)
    const j0 = Math.floor((Math.min(y0, y1, y2) - ov) / CELL_MM), j1 = Math.floor((Math.max(y0, y1, y2) - ov) / CELL_MM)
    for (let i = i0; i <= i1; i += 1) {
      const px = ou + (i + 0.5) * CELL_MM
      for (let j = j0; j <= j1; j += 1) {
        const py = ov + (j + 0.5) * CELL_MM
        const l0 = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / det
        const l1 = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / det
        const l2 = 1 - l0 - l1
        if (l0 < -1e-9 || l1 < -1e-9 || l2 < -1e-9) continue
        const w = l0 * w0 + l1 * w1 + l2 * w2
        const k = i * nv + j
        if (w < tmin[k]) tmin[k] = w
        if (w > tmax[k]) tmax[k] = w
        hits[k] += 1
      }
    }
  }
  return { axis, u, v, ou, ov, nu, nv, tmin, tmax, hits }
}

export function label(mask: Uint8Array, nu: number, nv: number): { readonly labels: Int32Array; readonly count: number } {
  const labels = new Int32Array(nu * nv); let count = 0
  const stack: number[] = []
  for (let s = 0; s < nu * nv; s += 1) {
    if (mask[s] === 0 || labels[s] !== 0) continue
    count += 1; labels[s] = count; stack.push(s)
    while (stack.length > 0) {
      const k = stack.pop() as number; const i = Math.floor(k / nv), j = k % nv
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj
        if (ni < 0 || nj < 0 || ni >= nu || nj >= nv) continue
        const n = ni * nv + nj
        if (mask[n] === 1 && labels[n] === 0) { labels[n] = count; stack.push(n) }
      }
    }
  }
  return { labels, count }
}

export interface Opening {
  readonly at: readonly [number, number]
  readonly width: number; readonly sill: number; readonly head: number
  readonly bboxSize: readonly [number, number]; readonly area: number; readonly openTop: boolean
}

const OPENING_MIN_AREA_MM2 = 60, OPENING_MIN_SIZE_MM = 8

function percentile(sorted: number[], p: number): number {
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
  const tops: number[] = []; let left = nu, right = -1
  const topOf = new Int32Array(nu).fill(-1)
  for (let i = 0; i < nu; i += 1) for (let j = nv - 1; j >= 0; j -= 1) {
    if (hits[i * nv + j] > 0) { topOf[i] = j; tops.push(j); if (i < left) left = i; if (i > right) right = i; break }
  }
  if (tops.length === 0) return []
  const top = percentile([...tops].sort((a, b) => a - b), 90)
  const mask = new Uint8Array(nu * nv)
  for (let i = left + 1; i < right; i += 1) for (let j = 0; j <= top; j += 1) if (hits[i * nv + j] === 0) mask[i * nv + j] = 1
  const { labels, count } = label(mask, nu, nv)
  const out: Opening[] = []
  for (let c = 1; c <= count; c += 1) {
    const cells: [number, number][] = []
    for (let k = 0; k < nu * nv; k += 1) if (labels[k] === c) cells.push([Math.floor(k / nv), k % nv])
    const area = cells.length * CELL_MM * CELL_MM
    if (area < OPENING_MIN_AREA_MM2) continue
    const is = cells.map((c) => c[0]), js = cells.map((c) => c[1])
    const su = (Math.max(...is) - Math.min(...is) + 1) * CELL_MM, sv = (Math.max(...js) - Math.min(...js) + 1) * CELL_MM
    if (Math.min(su, sv) < OPENING_MIN_SIZE_MM) continue
    const perRow = new Map<number, number>(); for (const j of js) perRow.set(j, (perRow.get(j) ?? 0) + 1)
    const counts = [...perRow.values()].sort((a, b) => a - b); const median = percentile(counts, 50)
    const body = [...perRow.entries()].filter(([, n]) => n >= 0.5 * median)
    const bodyRows = body.map(([j]) => j); const width = percentile(body.map(([, n]) => n).sort((a, b) => a - b), 50) * CELL_MM
    const bodySet = new Set(bodyRows)
    const us = cells.filter((c) => bodySet.has(c[1])).map((c) => col.ou + (c[0] + 0.5) * CELL_MM)
    const vMin = Math.min(...bodyRows), vMax = Math.max(...bodyRows)
    out.push({
      at: [us.reduce((a, b) => a + b, 0) / us.length, col.ov + ((vMin + vMax) / 2 + 0.5) * CELL_MM],
      width, sill: col.ov + vMin * CELL_MM, head: col.ov + (vMax + 1) * CELL_MM,
      bboxSize: [su, sv], area, openTop: vMax >= top - 2,
    })
  }
  return out.sort((a, b) => b.area - a.area)
}

/** NaN-aware median over a win×win window; a pocket narrower than win/2 pops out of it. */
export function localBaseline(values: Float64Array, nu: number, nv: number, win = 25): Float64Array {
  const half = Math.floor(win / 2), out = new Float64Array(nu * nv).fill(NaN)
  const buf: number[] = []
  for (let i = 0; i < nu; i += 1) for (let j = 0; j < nv; j += 1) {
    buf.length = 0
    for (let a = Math.max(0, i - half); a <= Math.min(nu - 1, i + half); a += 1)
      for (let b = Math.max(0, j - half); b <= Math.min(nv - 1, j + half); b += 1) {
        const x = values[a * nv + b] as number
        if (Number.isFinite(x)) buf.push(x)
      }
    if (buf.length === 0) continue
    buf.sort((p, q) => p - q); out[i * nv + j] = buf[Math.floor(buf.length / 2)] as number
  }
  return out
}

/** Rotate every vertex about `axis` by `degrees` (right-handed). Returns a copy. */
export function rotateAbout(positions: ArrayLike<number>, axis: Axis, degrees: number): Float64Array {
  const [i, j] = others(axis); const c = Math.cos((degrees * Math.PI) / 180), s = Math.sin((degrees * Math.PI) / 180)
  const out = Float64Array.from(positions as ArrayLike<number>)
  for (let o = 0; o < out.length; o += 3) {
    const a = out[o + i] as number, b = out[o + j] as number
    out[o + i] = c * a - s * b; out[o + j] = s * a + c * b
  }
  return out
}
```

`localBaseline` as written is O(nu·nv·win²·log) — fine for the ≤ 200 × 100 grids here (≈ 0.3 s); do not optimise until a measurement says to.

- [ ] **Step 5: Run to verify it passes, then lint**

Run: `npx vitest run tools/mounts/geometry.test.ts && npx eslint tools/mounts && npx tsc -b --noEmit`
Expected: PASS. Fix the `label` test's expectation if the 3×3 layout comment is wrong — the test must state a mask whose component count is unambiguous (rewrite it as two clearly separate blocks if needed).

- [ ] **Step 6: Commit**

```bash
git add tools/mounts/synthetic.ts tools/mounts/geometry.ts tools/mounts/geometry.test.ts
git commit -m "feat(mounts): depth-map primitives and a synthetic STL builder for the mount detector"
```

---

### Task 2: The tilt sweep and arc unrolling

**Files:**
- Create: `tools/mounts/sockets.ts`, `tools/mounts/arcs.ts`
- Test: `tools/mounts/sockets.test.ts`, `tools/mounts/arcs.test.ts`

**Interfaces:**
- Consumes: `columns`, `label`, `localBaseline`, `rotateAbout`, `CELL_MM`, `Axis` (Task 1).
- Produces:
  ```ts
  // sockets.ts
  export type Vec3 = readonly [number, number, number]
  export interface Pocket {
    readonly face: string                 // '-y' | '+y' | '-x' | '+x'
    readonly entrance: Vec3; readonly bottom: Vec3; readonly axis: Vec3   // mesh mm; axis points into the host
    readonly angleFromNormal: number; readonly depth: number
    readonly entranceSize: readonly [number, number]; readonly area: number; readonly depthMax: number
    readonly theta: number
  }
  export interface SweepOptions { readonly angles?: readonly number[]; readonly maxSizeMm?: number; readonly minDepthMm?: number; readonly minAreaMm2?: number; readonly minDimMm?: number }
  export function socketPoses(positions: ArrayLike<number>, triangles: number, faceAxis: Axis, runAxis: Axis, sign: -1 | 1, options?: SweepOptions): Pocket[]
  export const POCKET_MIN_DEPTH_MM = 3.5
  // arcs.ts
  export interface ArcFit { readonly centre: readonly [number, number]; readonly onRadius: number }
  export function fitArcCentre(positions: ArrayLike<number>, triangles: number, rInMm: number, rOutMm: number): ArcFit
  export function unroll(positions: ArrayLike<number>, centre: readonly [number, number], rMid: number): Float64Array
  export function reroll(p: Vec3, centre: readonly [number, number], rMid: number): Vec3
  export function rerollVector(p: Vec3, v: Vec3, centre: readonly [number, number], rMid: number): Vec3
  export const ARC_FIT_MIN_ON_RADIUS = 0.4
  ```

- [ ] **Step 1: Failing tests**

```ts
// tools/mounts/sockets.test.ts
import { describe, expect, it } from 'vitest'
import { parseStl } from '../../src/three/stl/parse'
import { socketPoses } from './sockets'
import { syntheticStl } from './synthetic'

const WALL = { min: [-25, -6.5, 0], max: [25, 6.5, 45] } as const

/** A 5.5 × 3 mm slot entering the −y face at z = 28, descending into the wall at ~63° from the normal, as 8 stepped cuts. */
function slottedWall(): Uint8Array {
  const steps = []
  for (let k = 0; k < 8; k += 1) {
    const y0 = -6.6 + k * 1.2, z = 28 - k * 2.35          // tan(63°) ≈ 1.96 → 2.35 mm down per 1.2 mm in
    steps.push({ min: [-2.75, y0, z - 1.5], max: [2.75, y0 + 1.25, z + 1.5] } as const)
  }
  return syntheticStl([WALL], steps)
}

describe('socketPoses', () => {
  it('finds a tilted slot on the -y face with its entrance, axis and angle', () => {
    const stl = parseStl(slottedWall())
    const [p, ...rest] = socketPoses(stl.positions, stl.triangles, 1, 0, -1)
    expect(rest).toEqual([])
    expect(p.face).toBe('-y')
    expect(p.entrance[0]).toBeCloseTo(0, 0)
    expect(Math.abs(p.entrance[1] + 6.5)).toBeLessThan(1.5)
    expect(Math.abs(p.entrance[2] - 28)).toBeLessThan(3)
    expect(p.angleFromNormal).toBeGreaterThan(55); expect(p.angleFromNormal).toBeLessThan(72)
    expect(p.axis[2]).toBeLessThan(0)                          // descends
    expect(p.entranceSize[0]).toBeCloseTo(5.5, 0)
  })
  it('finds nothing on the +y face of the same wall', () => {
    const stl = parseStl(slottedWall())
    expect(socketPoses(stl.positions, stl.triangles, 1, 0, +1)).toEqual([])
  })
  it('returns both sockets of a wall with two', () => {
    const cuts = [-20, 20].map((x) => ({ min: [x - 2.75, -6.6, 20], max: [x + 2.75, 3, 23] } as const))
    const stl = parseStl(syntheticStl([WALL], cuts))
    const found = socketPoses(stl.positions, stl.triangles, 1, 0, -1)
    expect(found.map((p) => Math.round(p.entrance[0])).sort((a, b) => a - b)).toEqual([-20, 20])
  })
})
```

```ts
// tools/mounts/arcs.test.ts
import { describe, expect, it } from 'vitest'
import { columns, throughOpenings } from './geometry'
import { fitArcCentre, reroll, rerollVector, unroll } from './arcs'

/** A 90° arc wall, r 50.8..63.5, centred at the origin, 44 tall, with a 24 mm gap at 45°, as 40 trapezoid-ish box segments. */
function arcWallPositions(): { positions: Float64Array; triangles: number } {
  const tris: number[] = []
  const R0 = 50.8, R1 = 63.5, N = 40
  for (let k = 0; k < N; k += 1) {
    const a0 = (Math.PI / 2) * (k / N), a1 = (Math.PI / 2) * ((k + 1) / N)
    const mid = (a0 + a1) / 2
    const gap = Math.abs(mid - Math.PI / 4) < (12 / 57.15)      // ≈ 24 mm of arc at r_mid
    const zTop = 44
    const corners = (r: number, a: number, z: number) => [r * Math.cos(a), r * Math.sin(a), z]
    const quad = (p: number[], q: number[], r: number[], s: number[]) => tris.push(...p, ...q, ...r, ...p, ...r, ...s)
    const zSill = gap ? 10 : 0
    if (gap) { // below the gap only, plus the sill top
      quad(corners(R0, a0, 0), corners(R1, a0, 0), corners(R1, a1, 0), corners(R0, a1, 0))
      quad(corners(R0, a0, zSill), corners(R1, a0, zSill), corners(R1, a1, zSill), corners(R0, a1, zSill))
      quad(corners(R0, a0, 0), corners(R0, a1, 0), corners(R0, a1, zSill), corners(R0, a0, zSill))
      quad(corners(R1, a0, 0), corners(R1, a1, 0), corners(R1, a1, zSill), corners(R1, a0, zSill))
      continue
    }
    quad(corners(R0, a0, 0), corners(R1, a0, 0), corners(R1, a1, 0), corners(R0, a1, 0))
    quad(corners(R0, a0, zTop), corners(R1, a0, zTop), corners(R1, a1, zTop), corners(R0, a1, zTop))
    quad(corners(R0, a0, 0), corners(R0, a1, 0), corners(R0, a1, zTop), corners(R0, a0, zTop))
    quad(corners(R1, a0, 0), corners(R1, a1, 0), corners(R1, a1, zTop), corners(R1, a0, zTop))
    quad(corners(R0, a0, 0), corners(R1, a0, 0), corners(R1, a0, zTop), corners(R0, a0, zTop))
    quad(corners(R0, a1, 0), corners(R1, a1, 0), corners(R1, a1, zTop), corners(R0, a1, zTop))
  }
  return { positions: Float64Array.from(tris), triangles: tris.length / 9 }
}

describe('fitArcCentre', () => {
  it('lands on the origin for a wall authored about it', () => {
    const { positions, triangles } = arcWallPositions()
    const fit = fitArcCentre(positions, triangles, 50.8, 63.5)
    expect(Math.hypot(fit.centre[0], fit.centre[1])).toBeLessThan(0.5)
    expect(fit.onRadius).toBeGreaterThan(0.4)
  })
})

describe('unroll', () => {
  it('turns the doorway of an arc wall into an opening the flat detector reads', () => {
    const { positions, triangles } = arcWallPositions()
    const flat = unroll(positions, [0, 0], 57.15)
    const [opening] = throughOpenings(columns(flat, triangles, 1))
    expect(opening.width).toBeCloseTo(24, -1)
    expect(opening.sill).toBeCloseTo(10, 0)
    const back = reroll([opening.at[0], 0, opening.at[1]], [0, 0], 57.15)
    expect(Math.atan2(back[1], back[0])).toBeCloseTo(Math.PI / 4, 1)
  })
  it('re-rolls a radial vector to point along the radius', () => {
    const v = rerollVector([57.15 * (Math.PI / 4), 0, 20], [0, 1, 0], [0, 0], 57.15)
    expect(v[0]).toBeCloseTo(Math.SQRT1_2, 2); expect(v[1]).toBeCloseTo(Math.SQRT1_2, 2)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tools/mounts/sockets.test.ts tools/mounts/arcs.test.ts` → FAIL, modules missing.

- [ ] **Step 3: Implement `sockets.ts`**

```ts
// tools/mounts/sockets.ts
/**
 * The tilt sweep. A Dupont socket enters the face at 62–65° from the normal
 * (measured on 38 sockets across every torch family), so a straight depth map
 * sees only 3–4 mm of it. Rotate the mesh about the run axis by θ, depth-map
 * the face, and the pocket reads at its full ≈17–19 mm when θ matches the axis.
 * Every qualifying pocket at every θ is a candidate; candidates are clustered by
 * entrance and the deepest-mean per cluster kept, so a 4-unit S-system wall
 * returns both of its sockets and a wall-end sliver cannot outscore either.
 *
 * Depth is measured against a **local median baseline**, not a fitted plane:
 * on a full pillar the capital's underside is a second surface, on an S-system
 * wall the floor plate is, and a global plane through both put the socket below
 * threshold on 4 of 68 sample hosts. The local median makes each its own zero.
 */
import { CELL_MM, columns, label, localBaseline, rotateAbout } from './geometry'
import type { Axis, Columns } from './geometry'

export type Vec3 = readonly [number, number, number]
export const POCKET_MIN_DEPTH_MM = 3.5
const AX = 'xyz'

export interface Pocket { /* as in Interfaces */ }
export interface SweepOptions { /* as in Interfaces */ }

const DEFAULTS = { angles: Array.from({ length: 31 }, (_, k) => -75 + 5 * k), maxSizeMm: 12, minDepthMm: 6, minAreaMm2: 8, minDimMm: 2.5 }

function unrotate(p: Vec3, axis: Axis, degrees: number): Vec3 {
  const out = rotateAbout(p, axis, -degrees); return [out[0] as number, out[1] as number, out[2] as number]
}

export function socketPoses(positions: ArrayLike<number>, triangles: number, faceAxis: Axis, runAxis: Axis, sign: -1 | 1, options: SweepOptions = {}): Pocket[] {
  const opt = { ...DEFAULTS, ...options }
  const candidates: Pocket[] = []
  for (const theta of opt.angles) {
    const turned = theta === 0 ? positions : rotateAbout(positions, runAxis, theta)
    const col = columns(turned, triangles, faceAxis)
    const arr = sign < 0 ? col.tmin : col.tmax
    const base = localBaseline(arr, col.nu, col.nv)
    const depth = new Float64Array(col.nu * col.nv), mask = new Uint8Array(col.nu * col.nv)
    let hit = 0
    for (let k = 0; k < depth.length; k += 1) {
      const a = arr[k] as number, b = base[k] as number
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue
      hit += 1; depth[k] = (a - b) * (sign < 0 ? 1 : -1); if (depth[k] > POCKET_MIN_DEPTH_MM) mask[k] = 1
    }
    if (hit < 50) continue
    const { labels, count } = label(mask, col.nu, col.nv)
    for (let c = 1; c <= count; c += 1) {
      const cells: number[] = []; for (let k = 0; k < labels.length; k += 1) if (labels[k] === c) cells.push(k)
      const area = cells.length * CELL_MM * CELL_MM
      if (area < opt.minAreaMm2) continue
      const is = cells.map((k) => Math.floor(k / col.nv)), js = cells.map((k) => k % col.nv)
      if (Math.min(...is) === 0 || Math.min(...js) === 0 || Math.max(...is) === col.nu - 1 || Math.max(...js) === col.nv - 1) continue
      const su = (Math.max(...is) - Math.min(...is) + 1) * CELL_MM, sv = (Math.max(...js) - Math.min(...js) + 1) * CELL_MM
      if (Math.max(su, sv) > opt.maxSizeMm || Math.min(su, sv) < opt.minDimMm) continue
      const d = cells.map((k) => depth[k] as number); const dMax = Math.max(...d)
      if (dMax < opt.minDepthMm) continue
      const p60 = [...d].sort((a, b) => a - b)[Math.floor(d.length * 0.6)] as number
      const ent = [0, 0, 0], bot = [0, 0, 0]; let nb = 0
      cells.forEach((k, n) => {
        const pt = [0, 0, 0]; pt[col.u] = col.ou + ((is[n] as number) + 0.5) * CELL_MM; pt[col.v] = col.ov + ((js[n] as number) + 0.5) * CELL_MM
        pt[faceAxis] = base[k] as number; const e = unrotate(pt as unknown as Vec3, runAxis, theta); ent[0] += e[0]; ent[1] += e[1]; ent[2] += e[2]
        if ((d[n] as number) >= p60) { pt[faceAxis] = arr[k] as number; const b = unrotate(pt as unknown as Vec3, runAxis, theta); bot[0] += b[0]; bot[1] += b[1]; bot[2] += b[2]; nb += 1 }
      })
      const E: Vec3 = [ent[0] / cells.length, ent[1] / cells.length, ent[2] / cells.length]
      const B: Vec3 = [bot[0] / nb, bot[1] / nb, bot[2] / nb]
      const len = Math.hypot(B[0] - E[0], B[1] - E[1], B[2] - E[2])
      const axis: Vec3 = [(B[0] - E[0]) / len, (B[1] - E[1]) / len, (B[2] - E[2]) / len]
      const normal = [0, 0, 0]; normal[faceAxis] = sign < 0 ? 1 : -1
      const dot = axis[0] * normal[0] + axis[1] * normal[1] + axis[2] * normal[2]
      candidates.push({
        face: `${sign < 0 ? '-' : '+'}${AX[faceAxis]}`, entrance: E, bottom: B, axis,
        angleFromNormal: (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI, depth: len,
        entranceSize: [su, sv], area, depthMax: dMax, theta, score: d.reduce((a, b) => a + b, 0) / d.length,
      } as Pocket & { score: number })
    }
  }
  candidates.sort((a, b) => (b as Pocket & { score: number }).score - (a as Pocket & { score: number }).score)
  const out: Pocket[] = []
  for (const c of candidates) {
    if (out.every((o) => Math.hypot(c.entrance[0] - o.entrance[0], c.entrance[1] - o.entrance[1], c.entrance[2] - o.entrance[2]) > 4)) {
      const { score: _score, ...pocket } = c as Pocket & { score: number }; out.push(pocket)
    }
  }
  return out
}
```

Fill in the two interfaces exactly as in the Interfaces block. Type `score` cleanly (an internal `Candidate extends Pocket { score }` type) rather than the casts sketched above.

- [ ] **Step 4: Implement `arcs.ts`**

```ts
// tools/mounts/arcs.ts
/**
 * Curved hosts are unrolled about their arc centre so the flat detector reads
 * them. Every arc host in the sample is authored with that centre at the mesh
 * origin — 49–58 % of mid-height vertices sit on one of the two nominal radii
 * from (0, 0), against 0 % for an algebraic circle fit, which is dragged into
 * the slab — so the fit *starts* at the origin and refines with Gauss–Newton
 * steps toward whichever nominal radius each point is nearer.
 */
import type { Vec3 } from './sockets'
export const ARC_FIT_MIN_ON_RADIUS = 0.4
export interface ArcFit { readonly centre: readonly [number, number]; readonly onRadius: number }

function midSlice(positions: ArrayLike<number>, triangles: number): [number, number][] {
  const zs: number[] = []; for (let o = 2; o < triangles * 9; o += 3) zs.push(positions[o] as number)
  zs.sort((a, b) => a - b); const zMid = zs[Math.floor(zs.length / 2)] as number
  const pts: [number, number][] = []
  for (let o = 0; o < triangles * 9; o += 3) if (Math.abs((positions[o + 2] as number) - zMid) < 4) pts.push([positions[o] as number, positions[o + 1] as number])
  const stride = Math.max(1, Math.floor(pts.length / 20000)); return pts.filter((_, i) => i % stride === 0)
}

export function fitArcCentre(positions: ArrayLike<number>, triangles: number, rInMm: number, rOutMm: number): ArcFit {
  const s = midSlice(positions, triangles); let cx = 0, cy = 0
  for (let iter = 0; iter < 8; iter += 1) {
    let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0, n = 0
    for (const [x, y] of s) {
      const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy); if (r < 1e-9) continue
      const target = Math.abs(r - rInMm) < Math.abs(r - rOutMm) ? rInMm : rOutMm
      const res = r - target; if (Math.abs(res) > 3) continue
      const jx = -dx / r, jy = -dy / r   // d(res)/d(c)
      a11 += jx * jx; a12 += jx * jy; a22 += jy * jy; b1 -= jx * res; b2 -= jy * res; n += 1
    }
    if (n < 50) break
    const det = a11 * a22 - a12 * a12; if (Math.abs(det) < 1e-12) break
    const sx = (a22 * b1 - a12 * b2) / det, sy = (a11 * b2 - a12 * b1) / det
    cx += sx; cy += sy; if (Math.hypot(sx, sy) < 1e-3) break
  }
  let on = 0
  for (const [x, y] of s) { const r = Math.hypot(x - cx, y - cy); if (Math.min(Math.abs(r - rInMm), Math.abs(r - rOutMm)) < 1) on += 1 }
  return { centre: [cx, cy], onRadius: s.length === 0 ? 0 : on / s.length }
}

/** (x, y, z) → (u = arc length at rMid, w = r − rMid, z). Each triangle's angles stay on one branch. */
export function unroll(positions: ArrayLike<number>, centre: readonly [number, number], rMid: number): Float64Array {
  const out = new Float64Array(positions.length)
  for (let o = 0; o < positions.length; o += 9) {
    let th0 = 0
    for (let k = 0; k < 3; k += 1) {
      const dx = (positions[o + k * 3] as number) - centre[0], dy = (positions[o + k * 3 + 1] as number) - centre[1]
      let th = Math.atan2(dy, dx); if (k === 0) th0 = th; else th = th0 + Math.atan2(Math.sin(th - th0), Math.cos(th - th0))
      out[o + k * 3] = rMid * th; out[o + k * 3 + 1] = Math.hypot(dx, dy) - rMid; out[o + k * 3 + 2] = positions[o + k * 3 + 2] as number
    }
  }
  return out
}

export function reroll(p: Vec3, centre: readonly [number, number], rMid: number): Vec3 {
  const th = p[0] / rMid, r = rMid + p[1]; return [centre[0] + r * Math.cos(th), centre[1] + r * Math.sin(th), p[2]]
}

export function rerollVector(p: Vec3, v: Vec3, centre: readonly [number, number], rMid: number): Vec3 {
  const th = p[0] / rMid; const t = [-Math.sin(th), Math.cos(th)], n = [Math.cos(th), Math.sin(th)]
  return [v[0] * t[0] + v[1] * n[0], v[0] * t[1] + v[1] * n[1], v[2]]
}
```

- [ ] **Step 5: Run, lint, commit**

Run: `npx vitest run tools/mounts && npx eslint tools/mounts && npx tsc -b --noEmit` → PASS.

```bash
git add tools/mounts/sockets.ts tools/mounts/arcs.ts tools/mounts/sockets.test.ts tools/mounts/arcs.test.ts
git commit -m "feat(mounts): tilt sweep for Dupont sockets and arc unrolling about the mesh origin"
```

---

### Task 3: Classification — from geometry to mounts and anchors

**Files:**
- Create: `tools/mounts/classify.ts`
- Test: `tools/mounts/classify.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces (these types are ALSO the shape Task 5 puts in Zod — keep the names identical):
  ```ts
  export type MountKind = 'opening' | 'socket' | 'pocket' | 'hole' | 'surface'
  export type Face = '-x' | '+x' | '-y' | '+y' | '-z' | '+z'
  export interface OpeningMount { readonly slot: string; readonly kind: 'opening'; readonly face: Face; readonly at: Vec3; readonly width: number; readonly sill: number; readonly head: number; readonly openTop: boolean; readonly leaves: 1 | 2 }
  export interface SocketMount  { readonly slot: string; readonly kind: 'socket' | 'pocket'; readonly face: Face; readonly at: Vec3; readonly axis: Vec3; readonly section: readonly [number, number]; readonly depth: number }
  export interface HoleMount    { readonly slot: string; readonly kind: 'hole'; readonly face: Face; readonly at: Vec3; readonly size: readonly [number, number] }
  export interface SurfaceMount { readonly slot: string; readonly kind: 'surface'; readonly face: Face; readonly at: Vec3 }
  export type Mount = OpeningMount | SocketMount | HoleMount | SurfaceMount
  export type UnresolvedReason = 'no-opening' | 'no-socket' | 'no-hole' | 'no-pocket' | 'arc-fit-refused' | 'runs-off-end' | 'modelled-in'
  export interface HostSlot { readonly name: string; readonly require: readonly string[] }
  export interface HostInput { readonly foot: Footprint; readonly slots: readonly HostSlot[] }   // Footprint from '../../src/catalog'
  export interface HostMeasurement {
    readonly bbox: { readonly min: Vec3; readonly max: Vec3 }
    readonly arc?: ArcFit
    readonly mounts: readonly Mount[]
    readonly unresolved: readonly { readonly slot: string; readonly reason: UnresolvedReason }[]
  }
  export type AnchorKind = 'peg' | 'leaf' | 'plate' | 'block'
  export interface InsertAnchor { readonly kind: AnchorKind; readonly at: Vec3; readonly axis: Vec3; readonly size: Vec3 }
  export interface InsertMeasurement { readonly bbox: { readonly min: Vec3; readonly max: Vec3 }; readonly anchor: InsertAnchor }
  export const SLOT_CLASSES: Readonly<Record<string, 'opening' | 'socket' | 'hole' | 'pocket' | 'surface' | 'grate'>>  // 'grate' resolves by host height
  export function analyseHost(input: HostInput, positions: Float32Array, triangles: number): HostMeasurement
  export function analyseInsert(positions: Float32Array, triangles: number): InsertMeasurement
  export function toBboxCoordinates(p: Vec3, bbox: HostMeasurement['bbox']): Vec3   // x,y from centre; z from bottom
  ```

- [ ] **Step 1: Failing tests**

```ts
// tools/mounts/classify.test.ts
import { describe, expect, it } from 'vitest'
import { parseStl } from '../../src/three/stl/parse'
import { analyseHost, analyseInsert, toBboxCoordinates } from './classify'
import { syntheticStl } from './synthetic'

const WALL = { min: [-25, 53.5, 0], max: [25, 66.5, 50] } as const     // authored off-centre in y, like the cut-stone door wall
const wallFoot = { shape: 'wall', length: 2 } as const

describe('analyseHost', () => {
  it('gives a door and its lintel the same open-topped opening, in bbox coordinates', () => {
    const stl = parseStl(syntheticStl([WALL], [{ min: [-12.5, 53, 10], max: [12.5, 67, 51] }]))
    const m = analyseHost({ foot: wallFoot, slots: [{ name: 'door', require: ['interface|door|rectangular', 'size|single'] }, { name: 'lintel', require: ['interface|lintel'] }] }, stl.positions, stl.triangles)
    const door = m.mounts.find((x) => x.slot === 'door'); const lintel = m.mounts.find((x) => x.slot === 'lintel')
    expect(door?.kind).toBe('opening'); expect(lintel?.kind).toBe('opening')
    if (door?.kind !== 'opening') throw new Error('door')
    expect(door.width).toBeCloseTo(25, 0); expect(door.sill).toBeCloseTo(10, 0); expect(door.openTop).toBe(true); expect(door.leaves).toBe(1)
    expect(door.at[0]).toBeCloseTo(0, 0); expect(door.at[1]).toBeCloseTo(0, 0)       // y is from the bbox centre, so the 60 mm offset is gone
    expect(m.unresolved).toEqual([])
  })
  it('marks a wide door as two leaves', () => {
    const stl = parseStl(syntheticStl([WALL], [{ min: [-24, 53, 10], max: [24, 67, 51] }]))
    const m = analyseHost({ foot: { shape: 'wall', length: 4 }, slots: [{ name: 'door', require: ['interface|door|arched', 'size|wide'] }] }, stl.positions, stl.triangles)
    expect(m.mounts[0]).toMatchObject({ kind: 'opening', leaves: 2 })
  })
  it('reports a door slot on a solid wall as modelled-in', () => {
    const stl = parseStl(syntheticStl([WALL]))
    const m = analyseHost({ foot: wallFoot, slots: [{ name: 'door', require: [] }] }, stl.positions, stl.triangles)
    expect(m.mounts).toEqual([]); expect(m.unresolved).toEqual([{ slot: 'door', reason: 'modelled-in' }])
  })
  it('finds a trapdoor hole in a floor', () => {
    const floor = { min: [0, 0, 0], max: [50, 50, 5] } as const
    const stl = parseStl(syntheticStl([floor], [{ min: [15, 16, -1], max: [35, 34, 6] }]))
    const m = analyseHost({ foot: { shape: 'rect', w: 2, d: 2 }, slots: [{ name: 'trapdoor', require: [] }] }, stl.positions, stl.triangles)
    expect(m.mounts[0]).toMatchObject({ kind: 'hole', face: '+z' })
    if (m.mounts[0]?.kind !== 'hole') throw new Error('hole')
    expect(m.mounts[0].size[0]).toBeCloseTo(20, 0); expect(m.mounts[0].at[2]).toBeCloseTo(5, 0)
  })
  it('gives a surface-class slot the top-face centre', () => {
    const floor = { min: [0, 0, 0], max: [50, 50, 5] } as const
    const stl = parseStl(syntheticStl([floor]))
    const m = analyseHost({ foot: { shape: 'rect', w: 2, d: 2 }, slots: [{ name: 'statue', require: [] }] }, stl.positions, stl.triangles)
    expect(m.mounts[0]).toEqual({ slot: 'statue', kind: 'surface', face: '+z', at: [0, 0, 5] })
  })
})

describe('analyseInsert', () => {
  it('classes a thin slab as a leaf anchored at its bottom centre', () => {
    const stl = parseStl(syntheticStl([{ min: [-14, -2, 5], max: [14, 2, 40] }]))
    const m = analyseInsert(stl.positions, stl.triangles)
    expect(m.anchor.kind).toBe('leaf'); expect(m.anchor.at).toEqual([0, 0, 0]); expect(Math.abs(m.anchor.axis[1])).toBe(1)
  })
  it('classes a tall thin prism as a peg with its axis along the long side', () => {
    const stl = parseStl(syntheticStl([{ min: [-3.5, -3.5, 0], max: [3.5, 3.5, 12] }]))
    const m = analyseInsert(stl.positions, stl.triangles)
    expect(m.anchor.kind).toBe('peg'); expect(m.anchor.axis).toEqual([0, 0, 1])
  })
})

describe('toBboxCoordinates', () => {
  it('measures x/y from the centre and z from the bottom', () => {
    expect(toBboxCoordinates([0, 60, 10], { min: [-25, 53.5, 0], max: [25, 66.5, 50] })).toEqual([0, 0, 10])
  })
})
```

- [ ] **Step 2: Verify failure** — `npx vitest run tools/mounts/classify.test.ts`.

- [ ] **Step 3: Implement `classify.ts`**

Rules, in order, per host:

1. bbox from positions. `size = max − min`. `thin` = the horizontal axis (0 or 1) with the smaller size; for `rect` footprints with `size[2] < 15` the host is a **floor**.
2. Arc footprints: `fitArcCentre(positions, triangles, rIn·25.4, rOut·25.4)`; if `onRadius < ARC_FIT_MIN_ON_RADIUS` every slot is `arc-fit-refused` — return. Else `work = unroll(...)`, `thin = 1` (the `w` axis), `run = 0`, and define `back(p)` = `reroll`, `backVec` = `rerollVector`; for non-arcs `back`/`backVec` are identity.
3. Openings: `throughOpenings(columns(work, triangles, thin))`. Convert each to a mesh-space point: `at = back([o.at[0] on axis run, mid-thickness on axis thin, o.at[1] on z])` where mid-thickness is `(bbox.min[thin]+bbox.max[thin])/2` for flat hosts and `0` (the mid radius) for arcs. `runsOffEnd` = the opening's bbox touches `left+1`/`right−1` of the silhouette — detect in `throughOpenings` by exposing `bboxSize` and `at`; simpler: an opening whose `at[0] ± width/2` is within 1 mm of the wall's u-extent.
4. Sockets: for each side face `(faceAxis ∈ {thin, run}, sign ∈ {−1, +1})` — arcs: only `faceAxis = 1` — `socketPoses(work, triangles, faceAxis, runAxis = other horizontal, sign)`; map `entrance`/`axis` back with `back`/`backVec`. Drop pockets whose entrance (in work coords) lies within 3 mm of an opening's box (`|u − at_u| ≤ bboxSize_u/2 + 3 && sill − 3 ≤ z ≤ head + 3`).
5. Holes (floors only): `throughOpenings(columns(work, triangles, 2))`, drop `openTop` ones and any touching the silhouette edge (`bboxSize` equals the whole face). `at` = `[centre_u, centre_v, bbox.max[2]]` mapped to the right axes, `size = [width, head − sill]`.
6. Per slot, by class (`SLOT_CLASSES`; `grate` → `opening` when `size[2] ≥ 15` else `hole`):
   - `opening`: every opening → `OpeningMount`, `leaves = require includes 'size|wide' || 'size|double' ? 2 : 1`, `face = sign of the thin axis toward −` (`'-y'` for thin=1) — openings are through, the face is informational. Unresolved: no openings and no through-column at all on the thin axis → `modelled-in`; openings exist but all run off the end → `runs-off-end`; else `no-opening`.
   - `socket`: pockets with `58 ≤ angleFromNormal ≤ 68 && 5 ≤ entranceSize[0] ≤ 6.5 && 2 ≤ entranceSize[1] ≤ 3.5 && depth ≥ 12` → `SocketMount { kind: 'socket', section: entranceSize }`. None → `no-socket`.
   - `pocket` (`treasure`): the deepest pocket at `theta === 0` with `8 ≤ max(entranceSize) ≤ 14` on faces ±thin → `kind: 'pocket'`. None → `no-pocket`.
   - `hole`: every hole. None → `no-hole`.
   - `surface`: `{ kind: 'surface', face: '+z', at: [cx, cy, bbox.max[2]] }`.
7. Convert every `at` with `toBboxCoordinates`; axes unchanged.

Inserts: bbox; `size`; `kind`:
- `leaf`: `min(size) ≤ 10 && the two others ≥ 10` → `at = [cx, cy, min z]` (bottom-centre), `axis` = unit vector on the thin axis (positive).
- `peg`: sort sizes; `s[0]/s[1]... ` two smaller within 1.5× of each other, longest `≥ 1.4 × middle` and `≤ 40` → axis = longest axis, positive; `at` = the end with the larger cross-section: compute the cross-section extent of vertices within 1 mm of each end; the wider end is the base; `at` = base end face centre.
- `plate`: for each bbox face, triangle area lying within 0.3 mm of the face plane / face area ≥ 0.5, and the opposite face's ≤ half that → `at` = that face centre, `axis` = the inward normal of that face (into the body).
- `block`: otherwise, `at` = bottom-centre, `axis = [0,0,1]`.
All insert `at` in bbox coordinates too.

Write the whole thing with the same care as the tests demand; keep `analyseHost` under a screen by extracting `findOpenings`, `findSockets`, `findHoles`, `matchSlot` helpers.

- [ ] **Step 4: Run, lint, commit**

```bash
git add tools/mounts/classify.ts tools/mounts/classify.test.ts
git commit -m "feat(mounts): classify openings, sockets, holes and surfaces per slot, and anchor inserts"
```

---

### Task 4: Targets, log, workers and the CLI

**Files:**
- Create: `tools/mounts/catalog.ts`, `tools/mounts/sidecar.ts`, `tools/mounts/worker.ts`, `tools/mounts/run.ts`, `tools/mounts/cli.ts`
- Modify: `package.json` (`"mounts": "tsx tools/mounts/cli.ts"`)
- Test: `tools/mounts/catalog.test.ts`, `tools/mounts/sidecar.test.ts`

**Interfaces:**
- Consumes: `fetchObject`, `mapLimit`, `MAX_CONCURRENCY`, `DEFAULT_CONCURRENCY`, `StlFetchError` from `../measure/fetch`; `parseStl` from `../../src/three/stl/parse`; `shardedPath`, `CatalogFile` from `../../src/catalog`; Task 3.
- Produces:
  ```ts
  // catalog.ts
  export type TargetKind = 'host' | 'insert'
  export interface MountTarget { readonly kind: TargetKind; readonly blob: BlobId; readonly bytes: number; readonly ids: readonly TileId[]; readonly foot: Footprint; readonly slots: readonly HostSlot[] }
  export function mountTargets(file: CatalogFile): { readonly targets: readonly MountTarget[]; readonly hosts: number; readonly inserts: number; readonly bytes: number }
  export function modelUrl(file: CatalogFile, blob: BlobId): string
  export const REPO_ROOT, CATALOG_PATH, DEFAULT_LOG_PATH (tools/mounts/.cache/mounts.jsonl), DEFAULT_INVENTORY_PATH (pipeline/mounts/inventory.json)
  // sidecar.ts
  export type LogEntry = { blob: string; kind: TargetKind; status: 'measured'; bytes: number; triangles: number; seconds: number; host?: HostMeasurement; insert?: InsertMeasurement } | { blob: string; kind: TargetKind; status: 'failed'; reason: string }
  export function appendEntry(logPath: string, entry: LogEntry): void
  export function readLog(logPath: string): Map<string, LogEntry>
  export function buildInventory(entries: Iterable<LogEntry>, stamp: { fixtures: string; measured: string }): MountInventory   // MountInventory type from pipeline/mounts.ts (Task 5) — import the TYPE only
  export function stratifiedSample(targets: readonly MountTarget[], n: number): MountTarget[]   // one per (slots, family dir, foot json) bucket first, then fill
  ```

- [ ] **Step 1: Failing tests for targets and the log**

```ts
// tools/mounts/catalog.test.ts
import { describe, expect, it } from 'vitest'
import { mountTargets } from './catalog'
import { testCatalog } from '../measure/fixtures/catalog'   // reuse measure's fixture loader; if it does not expose enough records, build a 3-record CatalogFile inline with one host (config with a non-base part), one base-only config, one insert

describe('mountTargets', () => {
  it('takes every file with a non-base slot as a host, and every insert, once per blob', () => {
    const { targets, hosts, inserts } = mountTargets(testCatalog())
    expect(new Set(targets.map((t) => t.blob)).size).toBe(targets.length)
    expect(hosts + inserts).toBe(targets.length)
    for (const t of targets.filter((t) => t.kind === 'host')) expect(t.slots.length).toBeGreaterThan(0)
  })
})
```

```ts
// tools/mounts/sidecar.test.ts  — appendEntry/readLog round trip in a tmp dir; a truncated last line is dropped; later line for the same blob wins.
```

- [ ] **Step 2: Implement `catalog.ts`, `sidecar.ts`**

Targets: group live records by `blob`; a blob is a host when any record's `config.parts` has a name ≠ `'base'` (slots = that record's non-base parts with `require` tags flattened from `tags.require[].tag`); an insert when `layer === 'insert'`. If a blob is both, it is a host (measure mounts) and also gets an anchor — store `kind: 'host'` and set a `alsoInsert: true` flag; `run.ts` measures both.

`buildInventory` shape — mirror `pipeline/mounts.ts`'s Zod (Task 5), so write the Zod first there or agree on it here:

```ts
{ note: string, version: 1, measured: ISO, catalog: { fixtures: string }, tool: 'openforge-workshop-mounts',
  hosts: Record<md5, { bbox, arc?, mounts: Mount[], unresolved }>, inserts: Record<md5, { bbox, anchor }>,
  counted: { hosts: number, inserts: number, failed: number, mounts: number } }
```

- [ ] **Step 3: `worker.ts` and `run.ts`**

`worker.ts`: `parentPort.on('message', ({ id, kind, bytes, foot, slots, alsoInsert }) => …)` — `parseStl(new Uint8Array(bytes))`, `analyseHost` and/or `analyseInsert`, post `{ id, host?, insert?, triangles }` or `{ id, error }`. Use `import { parentPort } from 'node:worker_threads'`.

`run.ts`: a pool of `os.availableParallelism()` workers created with `new Worker(new URL('./worker.ts', import.meta.url), { execArgv: ['--import', 'tsx'] })` (this is how a `tsx`-run parent spawns a TypeScript worker; verify with a one-line smoke test and fall back to `tsx`'s documented worker recipe if the flag differs on the pinned Node); `mapLimit` over targets with the fetch concurrency; each fetched object is dispatched to the next free worker; every result appended to the log before the next dispatch. Resume: skip blobs already in the log unless `--retry-failed` (failed only) or `--force`. Progress line per blob to stdout.

- [ ] **Step 4: `cli.ts`**

Copy `tools/measure/cli.ts`'s structure: `USAGE`, `parseArgs`, modes `run` (default) / `report` / `inventory`, flags `--sample N`, `--limit N`, `--concurrency N`, `--retry-failed`, `--force`, `--log`, `--inventory PATH`, `--catalog`, `--dry-run`. `--dry-run` prints the target table (hosts, inserts, bytes) and exits 0. `--inventory` builds from the log and writes `DEFAULT_INVENTORY_PATH` with `serialise` (2-space JSON, trailing newline) — refuses (exit 1) if the log holds failures unless `--allow-failed`. Add `"mounts": "tsx tools/mounts/cli.ts"` to `package.json`.

- [ ] **Step 5: Smoke test without the network**

`npm run mounts -- --dry-run` prints ≈ `hosts 995 … inserts 139 … 16.4 GB`. Then with **one** blob to prove the worker path: `npm run mounts -- --limit 1 --log /tmp/mounts-smoke.jsonl` (reads one ≈ 6 MB object). Confirm a `measured` line with mounts appears. Delete the smoke log.

- [ ] **Step 6: Lint, test, commit**

```bash
git add tools/mounts package.json
git commit -m "feat(mounts): npm run mounts — fetch, measure in worker threads, resumable log, inventory writer"
```

---

### Task 5: Inventory schema and the pipeline join

**Files:**
- Create: `pipeline/mounts.ts`, `pipeline/mounts/inventory.json` (empty shell), `pipeline/mounts.test.ts`
- Modify: `src/catalog/schema.ts` (Mount/InsertAnchor schemas, `mounts?`/`anchor?` on `CatalogRecord`, `SCHEMA_VERSION = 5`, docblock), `src/catalog/index.ts` (exports), `pipeline/build.ts` (`BuildOptions.mounts`, join), `scripts/import-catalog.ts`, `tools/stamp/run.ts`, `tools/stamp/lock.ts` (pass inventories), `pipeline/version.ts` docblock note.
- Create: `src/catalog/mounts.ts` (`mountsFor`, `faceVector`)

**Interfaces:**
- Produces:
  ```ts
  // src/catalog/schema.ts
  export const Face = z.enum(['-x','+x','-y','+y','-z','+z'])
  export const Vec3 = z.tuple([z.number(), z.number(), z.number()])
  export const Mount = z.discriminatedUnion('kind', [OpeningMount, SocketMount(kind 'socket'|'pocket' as two literals in one object via z.enum), HoleMount, SurfaceMount])
  export const InsertAnchor = z.object({ kind: z.enum(['peg','leaf','plate','block']), at: Vec3, axis: Vec3, size: Vec3 })
  // CatalogRecord: mounts: z.array(Mount).optional(), anchor: InsertAnchor.optional()
  export const SCHEMA_VERSION = 5
  // src/catalog/mounts.ts
  export function mountsFor(record: CatalogRecord, slot: string): readonly Mount[]
  export function faceVector(face: Face): [number, number, number]   // Z-up unit normal pointing OUT of the host
  // pipeline/mounts.ts
  export const MOUNT_INVENTORY_VERSION = 1
  export const MOUNT_INVENTORY_PATH = join(dirname(fileURLToPath(import.meta.url)), 'mounts', 'inventory.json')
  export const MountInventory = z.object({...})   // as in Task 4 Step 2
  export type MountInventory = z.infer<typeof MountInventory>
  export function readMountInventory(path?: string): MountInventory | undefined
  export function emptyMountInventory(): MountInventory
  export function serialiseMountInventory(inv: MountInventory): string
  // pipeline/build.ts
  BuildOptions.mounts: MountInventory   // REQUIRED, like thumbs
  ```

- [ ] **Step 1: Failing tests**

`pipeline/mounts.test.ts`: `readMountInventory` refuses a wrong version with a message naming `npm run mounts -- --inventory`; `emptyMountInventory()` parses; a build with an inventory holding one host blob emits `mounts` on every record with that blob and none elsewhere; `SCHEMA_VERSION` is 5; the emitted record with `mounts` parses through `CatalogRecord`.

Add to `src/catalog/schema.test.ts`: a record with a `socket` mount and an `anchor` parses; `mountsFor` returns only the slot's mounts.

- [ ] **Step 2: Implement**

Schema: put `Mount` and `InsertAnchor` beside `CompositionConfig` with a docblock quoting the spec's numbers (the 62–65° socket, the 25 mm rectangular opening, the two-leaf rule) and the coordinate contract. Bump `SCHEMA_VERSION` to 5 and extend its docblock's version history ("**5** — `mounts` and `anchor`, measured at build time by `tools/mounts/`; both optional, both keyed off the blob").

`pipeline/mounts.ts` — shaped like `thumbs.ts` (version check, failed-count refusal). The empty shell file:

```json
{ "note": "Where accessories attach, measured from the host meshes by `npm run mounts -- --inventory`. Empty until the first run.", "version": 1, "measured": "1970-01-01T00:00:00.000Z", "tool": "openforge-workshop-mounts", "catalog": { "fixtures": "" }, "hosts": {}, "inserts": {}, "counted": { "hosts": 0, "inserts": 0, "failed": 0, "mounts": 0 } }
```

`build.ts`: after `thumb:`, add `...(mounts === undefined ? {} : { mounts })` where `mounts = options.mounts.hosts[row.file_metadata.md5]?.mounts` and `...(anchor === undefined ? {} : { anchor })` from `inserts[...]?.anchor`. Print the `unresolved` entries of every host blob that is live as a lint line each: `mounts: <file> — slot <name> <reason>` (stderr, via the existing warnings path). Callers: `import-catalog.ts` and `stamp/run.ts` pass `readMountInventory() ?? emptyMountInventory()`; `lock.ts` passes `emptyMountInventory()` with a comment mirroring its `thumbs` one. `BuildStats` gains `withMounts` and `withAnchor` counts, printed by `import-catalog.ts`.

- [ ] **Step 3: Run the full pipeline tests, lint, then `npm run import:catalog` if `OPENFORGE_FIXTURES` is set (otherwise skip and note it) — the index must still be under budget. Commit.**

```bash
git add pipeline src/catalog scripts tools/stamp
git commit -m "feat(catalog): mounts and anchors on the record, joined from pipeline/mounts/inventory.json"
```

---

### Task 6: The store — a hold is a fill of a fill

**Files:**
- Modify: `src/store/schema.ts`, `src/store/workshopStore.ts`, `src/store/migrations.ts`, `src/store/index.ts`
- Test: `src/store/workshopStore.test.ts`, `src/store/migrations.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const HoldName = z.string().min(1).brand<'HoldName'>(); export type HoldName = z.infer<typeof HoldName>
  // SlotFill: { tile, pinned, holds?: Record<HoldName, SlotFill-without-holds> }  (use z.lazy-free: define HoldFill = z.object({tile, pinned}) and SlotFill = HoldFill.extend({ holds: z.record(HoldName, HoldFill).optional() }))
  export type HoldFill = z.infer<typeof HoldFill>
  export function fillHold(id: PlacementId, slot: SlotName, hold: HoldName, tile: TileId): FillOutcome   // pinned false, refuses a pinned hold
  export function pinHold(id, slot, hold, tile): FillOutcome
  export function clearHold(id, slot, hold): ClearOutcome         // leaves holds === {} when the last one goes
  export function unpinHold(id, slot, hold): UnpinOutcome
  export function fillHolds(id, slot, holds: Record<HoldName, HoldFill>): FillOutcome   // the solver's wholesale write; never overwrites a pinned hold (keeps it)
  export const STORE_VERSION = 9
  ```
- `writeFill` (existing): a new tile for a slot **drops** `holds` (a hold is a fill of that file). Same tile, same pinned → `unchanged` (holds kept).

- [ ] **Step 1: Failing tests** — `fillHold` on a missing slot returns `'unknown-placement'`-style refusal (add `'unknown-slot'` to `FillOutcome`); `pinHold` then `fillHold` keeps the pin; `clearHold` of the last hold leaves `holds: {}`; replacing the slot's tile via `fillSlot` drops holds; `fillHolds` keeps pinned holds and replaces the rest; `readPersistedState(v8blob, 8)` hydrates with fills intact and no `holds`; a v9 blob with holds round-trips; salvage drops a hold whose value is not `{tile, pinned}` and names it.

- [ ] **Step 2: Implement.** Migrations: `readPersistedState` accepts `storedVersion === 8 || 9` (8 is the identity rung); `salvageFill` reads `holds` through a `salvageHolds` that reuses `salvageFill`'s shape check one level down and refuses nesting. Update the `migrations.ts` notice: the discard licence has ended ("the app is served at its public URL"), version 9 is the first rung, and future changes need rungs. Update the migrations test that asserts every historical version is discarded so that 8 is the exception, with the reason.

- [ ] **Step 3: Test, lint, commit.**

```bash
git commit -am "feat(store): holds — accessory fills nested in a slot's fill, with the first migration rung (8 → 9)"
```

---

### Task 7: Share codec format 6

**Files:**
- Modify: `src/share/payload.ts`, `src/share/link.ts`
- Test: `src/share/payload.test.ts`, `src/share/link.test.ts`, `src/share/capacity.test.ts` (re-run only)

**Interfaces:**
- `WireHold { slot: number (index into the slot-name table); ordinal: number; pinned: boolean }`; `WireFill.holds: readonly WireHold[]`.
- `SHARE_FORMAT_VERSION = 6`. Layout after the existing pinned bitset: `uvar holdCount` per fill (flat, fill-major), then hold slot column, hold ordinal column, hold pinned bitset. `decodePayload` accepts **5 and 6**: for 5 every fill gets `holds: []`. `payloadFormatVersion` unchanged.

- [ ] **Step 1: Failing tests** — round trip of a fill with two holds; a fill with none; a format-5 byte string (construct by encoding with a test helper that writes version 5 layout, or keep a hex fixture of a small v5 payload captured before the change) decodes with empty holds; the empty-scene byte length assertion becomes the new exact number (compute it, state it in the test's comment as v5's 14 + the zero hold columns' bytes).
- [ ] **Step 2: Implement** — `collectInstances` interns hold names into the same `slots` table and drops a hold whose tile has no ordinal with a `dropped` line; `assembleFills` (link.ts) rebuilds `holds` as `Record<HoldName, HoldFill>`; `MAX_SHARE_FILLS` counts holds too.
- [ ] **Step 3: Run `npx vitest run src/share` (the byte-price tests take minutes; that is accepted), lint, commit.**

```bash
git commit -am "feat(share): format 6 carries holds; format 5 links still decode"
```

---

### Task 8: Resolver, bill and download walk holds

**Files:**
- Modify: `src/assembly/resolve.ts`, `src/assembly/bill.ts`, `src/assembly/index.ts`
- Test: `src/assembly/assembly.test.ts` (add cases), `src/builder/panels/BillPanel.tsx` (show `hold` in the slot list — minimal)

**Interfaces:**
- `AssemblyPart { slot; record; pinned; hold?: HoldName; quantity: number }` — `quantity` is 1 for recipe parts and `max(1, mountsFor(hostRecord, hold).length)` for hold parts.
- `BillSlotRef { placement; slot; tile; hold?: HoldName }`; `accumulate` adds `part.quantity` and pushes one ref.
- `ResolvedInstance.holds: ResolvedHold[]` where `ResolvedHold { slot: SlotName; hold: HoldName; optional: boolean; fill: HoldFill | undefined; record: CatalogRecord | undefined; mounts: number }`.
- `BillOfTiles.unplaced: UnplacedHold[]` — `{ placement, slot, hold, tile }` for holds whose host has no mount for that slot. `BillOfTiles.unfilled` also lists required accessory slots with no hold (`UnfilledSlot.hold?: HoldName`).
- Required-ness of an accessory slot: from the host's `config.parts[].optional !== true`.

- [ ] **Step 1: Failing tests** — a wall fill with a `torch` hold on a host with 4 socket mounts yields one line, `quantity 4`, `slots[0].hold === 'torch'`; a hold on a host with no mount is in `unplaced` with quantity 1; a required accessory slot with no hold is in `unfilled`; `complete` is false then.
- [ ] **Step 2: Implement** — `readFills` returns hold entries too; `resolveInstance` builds `holds`; `buildBillOfTiles` accumulates hold parts and collects `unplaced`. `BillPanel`: where a line's slot refs are formatted, append ` › ${hold}` when present.
- [ ] **Step 3: Test, lint, commit.**

```bash
git commit -am "feat(assembly): holds reach the bill and the download, one copy per measured mount"
```

---

### Task 9: Plan projection — `PlanPiece.accessories`

**Files:**
- Modify: `src/builder/canvas/scene.ts`, `src/builder/canvas/catalog.ts`, `src/builder/canvas/index.ts`
- Test: `src/builder/canvas/plan.test.ts`

**Interfaces:**
- ```ts
  export interface PlanAccessory {
    readonly slot: SlotName; readonly hold: HoldName; readonly fill: HoldFill
    readonly record: CatalogRecord; readonly host: PlanPiecePart; readonly mount: Mount; readonly index: number
  }
  export interface PlanUnplaced { readonly id: PlacementId; readonly slot: SlotName; readonly hold: HoldName; readonly tile: TileId; readonly reason: string }
  // PlanPiece.accessories: readonly PlanAccessory[]; PlanScene.unplaced: readonly PlanUnplaced[]
  // PlanCatalog.holds(instance, slot): readonly { hold: HoldName; fill: HoldFill; record: CatalogRecord | undefined }[]
  ```
- One `PlanAccessory` per (hold, mount). A hold whose insert record is missing from the catalog is an `unknown` omission (reuse the list); a hold whose host has no mount for the slot is `unplaced`.

- [ ] **Step 1: Failing test** — build a scene with one instance whose `wall` fill holds `torch`; the host record carries two socket mounts → `pieces[0].accessories.length === 2`, `index` 0 and 1, `host.slot === 'wall'`; remove the mounts → `unplaced.length === 1`.
- [ ] **Step 2: Implement** in `resolveInstance` (scene.ts) after parts are built; `catalog.ts` gains `holds()`. `roomBlobs` will read these in Task 10.
- [ ] **Step 3: Test, lint, commit.**

```bash
git commit -am "feat(plan): a piece carries its accessories, one per measured mount"
```

---

### Task 10: Rendering — one instance per mount

**Files:**
- Modify: `src/builder/three/place.ts`, `src/builder/three/instances.ts`, `src/builder/three/BuilderRoom.tsx` (surface `room.unplaced` count in the existing report line), `src/builder/three/index.ts`
- Test: `src/builder/three/place.test.ts`, `src/builder/three/instances.test.ts`

**Interfaces:**
- ```ts
  // place.ts
  export interface HostFrame { readonly geometry: PlanGeometry; readonly elevationMm: number }
  export interface InsertFrame { readonly bounds: MeshBounds; readonly anchor: InsertAnchor }
  /** World matrix of one accessory instance: host frame · mount · alignment · anchor⁻¹ · stand. */
  export function accessoryMatrix(host: HostFrame, mount: Mount, insert: InsertFrame, leaf: 0 | 1, target?: Matrix4): Matrix4
  export function zUpToYUp(v: Vec3): Vector3     // (x, y, z) → (x, z, −y)
  ```
- `buildRoom3D` walks `piece.accessories`: for each, `lod = geometries.get(accessory.record.blob)`; if absent → gap as today; else `addInstance(...)` with `accessoryMatrix` (skip `recordDisagreement` for inserts); for `opening` mounts with `leaves === 2` add two instances (`leaf` 0 and 1). `roomBlobs` includes accessory blobs. `Room3D.unplaced: number` = `scene.unplaced.length`.

- [ ] **Step 1: Failing tests (place.test.ts)** — with a host at the origin, rotation 0, elevation 0, and a `socket` mount `{ face: '-y', at: [0, -6.5, 28], axis: [0, 0.45, -0.89] }`, a `peg` insert (bounds 7×7×12, anchor at `[0,0,0]` axis `[0,0,1]`): the instance matrix maps the peg's base centre to world `(0, 28, 6.5)` (Y-up: y = z_mesh, z = −y_mesh) within 0.1 mm, and maps the peg tip direction to `−mountAxis` in Y-up (pointing out of the wall and up) within 1°. With the host rotated 90°, the point rotates accordingly. For an `opening` mount with `leaves: 2` and a `leaf` insert 28 wide, the two matrices place the leaf bottom-centres at `at.x ∓ width/4` and the second is turned 180° about Y.

- [ ] **Step 2: Implement `accessoryMatrix`**

```ts
export function zUpToYUp(v: Vec3): Vector3 { return new Vector3(v[0], v[2], -v[1]) }

export function accessoryMatrix(host: HostFrame, mount: Mount, insert: InsertFrame, leaf: 0 | 1, target = new Matrix4()): Matrix4 {
  // 1. The host frame: tileMatrix without its toOrigin·stand, plus the lift.
  const centre = boxCentre(host.geometry.box)
  const hostFrame = new Matrix4()
    .makeTranslation(centre.x * GRID_UNIT_MM, host.elevationMm, centre.z * GRID_UNIT_MM)
    .multiply(new Matrix4().makeRotationY((-host.geometry.angle * Math.PI) / 180))

  // 2. Where on the host, and which way the insert's anchor axis must point (Y-up, host-local).
  const out = zUpToYUp(faceVector(mount.face))           // out of the host
  let point = zUpToYUp(mount.at); let targetAxis: Vector3; let yawHalfTurn = false
  switch (mount.kind) {
    case 'socket': case 'pocket':
      targetAxis = zUpToYUp(mount.axis).negate()           // the anchor axis points away from the host
      break
    case 'opening': {
      const along = new Vector3().crossVectors(new Vector3(0, 1, 0), out)   // horizontal, in the face
      const isLintel = insert.anchor.kind !== 'leaf' || mount.leaves === 1 && mount.openTop && insert.anchor.size[2] < 12
      point = zUpToYUp([mount.at[0], mount.at[1], isLintel ? mount.head : mount.sill])   // bbox coords → then swapped
      if (mount.leaves === 2) point.add(along.clone().multiplyScalar((leaf === 0 ? -1 : 1) * mount.width / 4))
      targetAxis = out; yawHalfTurn = leaf === 1
      break
    }
    case 'hole': case 'surface':
      targetAxis = new Vector3(0, 1, 0); break
  }
  // 3. Align the anchor axis with the target, then roll about the target so the insert's own up stays up.
  const anchorAxis = zUpToYUp(insert.anchor.axis)
  const align = new Quaternion().setFromUnitVectors(anchorAxis, targetAxis)
  const upAfter = new Vector3(0, 1, 0).applyQuaternion(align)
  const worldUpInPlane = new Vector3(0, 1, 0).projectOnPlane(targetAxis)
  const upInPlane = upAfter.clone().projectOnPlane(targetAxis)
  if (worldUpInPlane.lengthSq() > 1e-6 && upInPlane.lengthSq() > 1e-6) {
    const angle = Math.atan2(new Vector3().crossVectors(upInPlane, worldUpInPlane).dot(targetAxis), upInPlane.dot(worldUpInPlane))
    align.premultiply(new Quaternion().setFromAxisAngle(targetAxis, angle))
  }
  if (yawHalfTurn) align.premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI))

  // 4. The insert's own normalisation (as tileMatrix does), then its anchor to the origin.
  const upright = uprightBounds(insert.bounds)
  const toOrigin = new Matrix4().makeTranslation(-(upright.min.x + upright.max.x) / 2, -upright.min.y, -(upright.min.z + upright.max.z) / 2)
  const stand = new Matrix4().makeRotationX(Z_UP_TO_Y_UP_RADIANS)
  const anchor = zUpToYUp(insert.anchor.at)
  const anchorToOrigin = new Matrix4().makeTranslation(-anchor.x, -anchor.y, -anchor.z)

  return target.copy(hostFrame)
    .multiply(new Matrix4().makeTranslation(point.x, point.y, point.z))
    .multiply(new Matrix4().makeRotationFromQuaternion(align))
    .multiply(anchorToOrigin).multiply(toOrigin).multiply(stand)
}
```

Note the lintel-vs-leaf decision above is a placeholder heuristic — replace it with the rule the spec states: the **slot name** decides (`lintel` → `head`, everything else in an opening → `sill`), so pass the slot name in (`accessoryMatrix(host, mount, insert, leaf)` already has `mount.slot`). Write it that way; delete the heuristic.

- [ ] **Step 3: `buildRoom3D`** — extend the loop; `roomBlobs` adds `piece.accessories.map(a => a.record.blob)`; `addInstance` takes a prebuilt matrix (refactor its signature to accept the matrix rather than geometry+elevation, and build the tile matrix at the two call sites). `BuilderRoom.tsx`: where the LOD gap count is reported, also report `room.unplaced` as "n accessories have no measured mount".

- [ ] **Step 4: Test, lint, commit.**

```bash
git commit -am "feat(3d): accessories are drawn at their measured mounts, one instance per socket, leaf or hole"
```

---

### Task 11: Default holds

**Files:**
- Create: `src/builder/three/holds.ts`, `src/builder/three/holds.test.ts`
- Modify: `src/builder/three/BuilderRoom.tsx` (mount `useHoldSolver`)

**Interfaces:**
- ```ts
  export function solveHolds(catalog: CatalogFile, parent: TileId, design: string | undefined): Record<HoldName, HoldFill>
  //   for every REQUIRED slot in slotStates(compositionIndexFor(catalog), parent, {}): first option that is not deadEnd,
  //   preferring option.aggregate.texture === design, then ascending option.address; tile = option.variant.id; pinned false.
  //   Optional slots are left out. Picks are made in declared order and fed back as the selection so `constrain` sees siblings.
  export function missingHolds(placements: Readonly<Record<string, TemplateInstance>>, catalog: CatalogFile, design: string | undefined): readonly { id: PlacementId; slot: SlotName; holds: Record<HoldName, HoldFill> }[]
  //   every fill with holds === undefined whose record declares ≥ 1 non-base slot
  export function useHoldSolver(catalog: CatalogFile | undefined): void   // useEffect: for each missing → fillHolds(...)
  ```
- Rationale in the docblock: `holds === undefined` means *never solved*; `holds === {}` means *solved, or cleared by the user* — which is why `clearHold` leaves `{}` and why the effect is idempotent.

- [ ] **Step 1: Failing tests** — with the real corpus fixture (`src/builder/three/fixture.ts` or the catalog fixture other tests in this folder use): `solveHolds` on a `dungeon_stone#wall,torch+mid.IA.openforge.stl` returns a `torch` hold naming a `part|torch` file; on a file with only optional slots returns `{}`; `missingHolds` skips fills that already have `holds`.
- [ ] **Step 2: Implement; mount the hook in `BuilderRoom` next to the LOD store.**
- [ ] **Step 3: Test, lint, commit.**

```bash
git commit -am "feat(builder): required accessory slots are filled by default, once, and re-solved when the host file changes"
```

---

### Task 12: The picker writes holds

**Files:**
- Modify: `src/builder/panels/slots/AccessorySection.tsx`, `src/builder/panels/slots/planSlots.ts` (holder carries the current `holds` and the mount count per slot), `src/screens/detail/slots/SlotFills.tsx` (accept an initial `selection` prop so the panel shows what is held)
- Test: `src/builder/panels/slots/slots.test.tsx`

- [ ] **Step 1: Failing test (jsdom)** — render `AccessorySection` with a placement whose `wall` fill holds a `torch`; the torch card is shown selected; picking another card calls `pinHold` (spy on the store action or read the store after the click); the "Previews only" sentence is gone; a holder whose slot has 4 mounts shows "× 4".
- [ ] **Step 2: Implement** — `PlanSlotHolder` gains `holds: Record<HoldName, HoldFill> | undefined` and `mounts: Record<string, number>`; `SlotFills` gets `selection?: SlotSelection` (controlled initial state) and the section passes the holder's holds; `onPick(slot, tile)` → `tile === undefined ? clearHold(...) : pinHold(...)`. Rewrite the docblock: the structural reason it kept nothing is gone.
- [ ] **Step 3: Test, lint, commit.**

```bash
git commit -am "feat(builder): the accessory picker keeps its pick, and says how many mounts it fills"
```

---

### Task 13: The measuring run, the corpus tests, the facts

**Files:**
- Modify: `pipeline/mounts/inventory.json` (the real measurement), `docs/verify-catalog-facts.py`, `README.md` (one line under *The catalog index*: `npm run mounts` and when to re-run it), `docs/superpowers/specs/2026-09-09-accessory-mounts-design.md` (Status → implemented)
- Create: `tools/mounts/corpus.test.ts`

This task is run by the coordinator, not a subagent, because it takes ~1 h of wall clock and network.

- [ ] **Step 1:** `npm run mounts -- --dry-run`; then `npm run mounts` (resumable; re-run the same command after any interruption; `--retry-failed` for transient failures). Expect ≈ 995 + 139 blobs, ≈ 16 GB.
- [ ] **Step 2:** `npm run mounts -- --report` and read the unresolved list; then `npm run mounts -- --inventory`.
- [ ] **Step 3: `tools/mounts/corpus.test.ts`** — skips when `counted.hosts === 0`; asserts: every host blob whose slots include `torch` has ≥ 1 `socket` mount; over all sockets `angle` ∈ [58, 68] where `angle = acos(axis · inward face normal)`; `|at[0]| ≤ 0.5` for straight `wall`-footprint torch hosts; the heights split into three bands by the host's `component|torch|{low,mid,high}` tag (band means ordered low < mid < high, each within ±3 mm of the sample means 23.5/16.9/10.3 below the top); `door` openings with `size|single` are 22–28 mm wide; `modelled-in` is reported for the known fixture error blob.
- [ ] **Step 4:** `npm run import:catalog` (needs `OPENFORGE_FIXTURES`; if unavailable, `npm run stamp` per the README) — budget check passes; note `withMounts` / `withAnchor` counts in the commit message.
- [ ] **Step 5:** `docs/verify-catalog-facts.py`: add the four counts (host records 1,005; host blobs 995; insert blobs 139; slot declarations by class) following the file's existing check pattern (read how the file declares and prints a check before adding; it prints a table and exits non-zero on a mismatch).
- [ ] **Step 6:** `mise run check`; commit.

```bash
git add pipeline/mounts/inventory.json tools/mounts/corpus.test.ts docs README.md
git commit -m "feat(mounts): the measured inventory — 995 hosts, 139 inserts — and the conventions it proves"
```

---

## Self-review

**Spec coverage.** §1 tool → Tasks 1–4, 13. §2 pipeline join → Task 5. §3 store, default holds, share → Tasks 6, 11, 7. §4 assembly/bill/download → Task 8. §5 plan + render → Tasks 9, 10. §6 editing → Task 12. Fixture lint → Task 5 (stderr) and Task 13 (report). `unplaced` in both bill and room → Tasks 8, 9, 10. Verification steps 1–5 of the spec → Task 13 and the manual checks before the PR.

**Type consistency.** `Mount`/`InsertAnchor`/`Vec3`/`Face` are defined once in `src/catalog/schema.ts` (Task 5) and the tool's `classify.ts` (Task 3) declares structurally identical interfaces — Task 5 must import the *types* from `../../src/catalog` into `classify.ts` and delete the local copies so they cannot drift. `HoldName`/`HoldFill` come from `@/store`. `PlanAccessory.host` is a `PlanPiecePart`; `accessoryMatrix` takes `{ geometry, elevationMm }` built from it exactly as `partGeometry` and `part.layout.elevationMm` are today.

**Placeholders.** The lintel heuristic in Task 10 Step 2 is called out and replaced by the slot-name rule in the same step. Task 4's worker spawn flag is to be verified against the pinned Node, with the fallback named.
