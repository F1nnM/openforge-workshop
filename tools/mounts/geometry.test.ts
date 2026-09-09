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
    // The column sampled above sits exactly on the diagonal of the 50 × 50 face
    // quad — x = 0.25, z = 25.25 solves z = x + 25 — so a coverage test with no
    // tie-break claims the point for both halves and doubles every count along
    // that diagonal.
    const stl = parseStl(syntheticStl([WALL]))
    const col = columns(stl.positions, stl.triangles, 1)
    const counted = new Set(Array.from(col.hits).filter((n) => n > 0))
    expect([...counted]).toEqual([2])
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
  })
})

describe('rotateAbout', () => {
  it('turns a point a quarter turn about x', () => {
    const out = rotateAbout([0, 1, 0], 0, 90)
    expect(out[1]).toBeCloseTo(0)
    expect(out[2]).toBeCloseTo(1)
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
