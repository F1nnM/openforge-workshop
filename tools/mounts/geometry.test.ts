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
    const i = Math.floor((0 - col.ou) / CELL_MM),
      j = Math.floor((25 - col.ov) / CELL_MM)
    expect(col.hits[i * col.nv + j]).toBe(2)
    expect(col.tmin[i * col.nv + j]).toBeCloseTo(-6.5, 3)
    expect(col.tmax[i * col.nv + j]).toBeCloseTo(6.5, 3)
  })

  it('counts a face crossed once even where a column lands on its triangulation', () => {
    // On an unnudged lattice the sampled column would sit exactly on the
    // diagonal of the 50 × 50 face quad — x = 0.25, z = 25.25 solves z = x + 25
    // — and both halves of the quad would claim it, doubling every count along
    // that diagonal.
    const stl = parseStl(syntheticStl([WALL]))
    const col = columns(stl.positions, stl.triangles, 1)
    const counted = new Set(Array.from(col.hits).filter((n) => n > 0))
    expect([...counted]).toEqual([2])
  })

  it('loses no column when a face edge lands on the sample lattice', () => {
    // 50.25 mm tall, so on an unnudged lattice the top edge falls exactly on the
    // sample row 0.25 + 0.5 × 100. That edge's only other face is the top of the
    // box, which projects edge-on and is discarded, so a rule that hands a
    // boundary sample to one of the two triangles can hand it to nobody: the
    // whole z = 50.25 row read hits = 0, tmin = Infinity on solid material.
    const tall = { min: [-25, -6.5, 0], max: [25, 6.5, 50.25] } as const
    const stl = parseStl(syntheticStl([tall]))
    const col = columns(stl.positions, stl.triangles, 1)

    const wrong: string[] = []
    let inside = 0
    for (let i = 0; i < col.nu; i += 1) {
      for (let j = 0; j < col.nv; j += 1) {
        const x = col.ou + (i + 0.5) * CELL_MM,
          z = col.ov + (j + 0.5) * CELL_MM
        const within = x > -25 && x < 25 && z > 0 && z < 50.25
        if (within) inside += 1
        const want = within ? 2 : 0
        const got = col.hits[i * col.nv + j]
        if (got !== want) wrong.push(`(${x.toFixed(3)}, ${z.toFixed(3)}) hit ${String(got)}`)
      }
    }
    expect(wrong).toEqual([])
    // No sample sits on the silhouette either, so every cell is decided.
    expect(inside).toBe(100 * 101)
  })

  it('has no grid for a mesh with nothing measurable in it', () => {
    const none = columns(new Float32Array(0), 0, 1)
    expect([none.nu, none.nv]).toEqual([0, 0])
    expect(none.hits.length).toBe(0)
    // Axes still say which plane the caller asked for, so a consumer can index
    // an empty grid without special-casing it.
    expect([none.axis, none.u, none.v]).toEqual([1, 0, 2])

    const unmeasurable = columns(new Float32Array(9).fill(NaN), 1, 1)
    expect([unmeasurable.nu, unmeasurable.nv]).toEqual([0, 0])
  })
})

describe('throughOpenings', () => {
  it('finds an open-topped doorway with its width, sill and head', () => {
    const stl = parseStl(syntheticStl([WALL], [DOORWAY]))
    const [opening, ...rest] = throughOpenings(columns(stl.positions, stl.triangles, 1))
    expect(rest).toEqual([])
    expect(opening?.width).toBeCloseTo(25, 0)
    expect(opening?.sill).toBeCloseTo(10, 0)
    expect(opening?.head).toBeCloseTo(50, 0)
    expect(opening?.at[0]).toBeCloseTo(0, 0)
    expect(opening?.openTop).toBe(true)
  })

  it('finds an enclosed window and reports it closed at the top', () => {
    const stl = parseStl(syntheticStl([WALL], [{ min: [-8, -7, 20], max: [8, 7, 40] }]))
    const [opening] = throughOpenings(columns(stl.positions, stl.triangles, 1))
    expect(opening?.openTop).toBe(false)
    expect(opening?.width).toBeCloseTo(16, 0)
    expect(opening?.head).toBeCloseTo(40, 0)
  })

  it('finds nothing on a solid wall', () => {
    const stl = parseStl(syntheticStl([WALL]))
    expect(throughOpenings(columns(stl.positions, stl.triangles, 1))).toEqual([])
  })
})

describe('localBaseline', () => {
  it('follows a step in the surface instead of averaging across it', () => {
    const nu = 60,
      nv = 10
    const values = new Float64Array(nu * nv)
    for (let i = 0; i < nu; i += 1)
      for (let j = 0; j < nv; j += 1) values[i * nv + j] = i < 30 ? 0 : 5
    const base = localBaseline(values, nu, nv, 9)
    expect(base[10 * nv + 5]).toBe(0)
    expect(base[50 * nv + 5]).toBe(5)
    // Right beside the step, where half the window is already across it.
    expect(base[29 * nv + 5]).toBe(0)
  })

  it('skips cells the depth map never resolved, and keeps a pocket out of its own baseline', () => {
    const nu = 60,
      nv = 10
    const values = new Float64Array(nu * nv)
    for (let i = 0; i < nu; i += 1)
      for (let j = 0; j < nv; j += 1) values[i * nv + j] = i < 30 ? 0 : 5
    // A 3-cell pocket, narrower than half the 9-cell window, and one column the
    // cast never hit.
    for (let i = 14; i <= 16; i += 1)
      for (let j = 0; j < nv; j += 1) values[i * nv + j] = -4
    values[10 * nv + 5] = NaN
    values[11 * nv + 5] = Infinity

    const base = localBaseline(values, nu, nv, 9)
    expect(base[15 * nv + 5]).toBe(0)
    expect(base[10 * nv + 5]).toBe(0)
    expect(base[11 * nv + 5]).toBe(0)
  })

  it('has no baseline where the window holds nothing finite', () => {
    expect(localBaseline(Float64Array.of(NaN), 1, 1, 3)[0]).toBeNaN()
  })
})

describe('rotateAbout', () => {
  // Right-handed, so each quarter turn carries the cycle x → y → z → x.
  it('turns a point a quarter turn about x', () => {
    const out = rotateAbout([0, 1, 0], 0, 90)
    expect(out[1]).toBeCloseTo(0)
    expect(out[2]).toBeCloseTo(1)
  })

  it('turns a point a quarter turn about y', () => {
    const out = rotateAbout([0, 0, 1], 1, 90)
    expect(out[2]).toBeCloseTo(0)
    expect(out[0]).toBeCloseTo(1)
  })

  it('turns a point a quarter turn about z', () => {
    const out = rotateAbout([1, 0, 0], 2, 90)
    expect(out[0]).toBeCloseTo(0)
    expect(out[1]).toBeCloseTo(1)
  })
})

describe('label', () => {
  it('counts 4-connected components', () => {
    // 3×3, two blocks that touch only at a corner: (0,0) alone, and (1,1) with
    // (1,2). 4-connectivity keeps them apart; 8-connectivity would merge them.
    const mask = new Uint8Array([1, 0, 0, 0, 1, 1, 0, 0, 0])
    const { labels, count } = label(mask, 3, 3)
    expect(count).toBe(2)
    expect(labels[0 * 3 + 0]).not.toBe(labels[1 * 3 + 1])
    expect(labels[1 * 3 + 1]).toBe(labels[1 * 3 + 2])
  })
})
