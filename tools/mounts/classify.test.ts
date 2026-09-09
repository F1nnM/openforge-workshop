import { describe, expect, it } from 'vitest'

import { parseStl } from '../../src/three/stl/parse'
import { analyseHost, analyseInsert, toBboxCoordinates } from './classify'
import { syntheticStl } from './synthetic'

/** Authored off-centre in y, like the cut-stone door wall. */
const WALL = { min: [-25, 53.5, 0], max: [25, 66.5, 50] } as const
const wallFoot = { shape: 'wall', length: 2 } as const

/**
 * The 4-unit wall the double-door case declares a footprint for.
 *
 * Spelled at its true 101.6 mm rather than reusing `WALL`, because a 48 mm
 * doorway in a 50 mm wall leaves 4% of the columns at full height and
 * `throughOpenings` reads its top line at the 90th percentile of them — so that
 * host has no *silhouette* to cut an opening out of, which is a different
 * measurement from the one this test is about.
 */
const WIDE_WALL = { min: [-50, 53.5, 0], max: [50, 66.5, 50] } as const

const FLOOR = { min: [0, 0, 0], max: [50, 50, 5] } as const

const arcFoot = {
  shape: 'arc',
  rIn: 2,
  rOut: 2.5,
  sweep: 90,
  band: 'concave',
  bandBasis: 'measured',
} as const

/**
 * A 90° arc wall, r 50.8..63.5 about the origin, 44 tall, with a 24 mm gap at
 * 45°, as 40 box segments — the same fixture `arcs.test.ts` fits and unrolls,
 * because the answers this file asserts are the ones written into it.
 */
function arcWall(): { readonly positions: Float32Array; readonly triangles: number } {
  const tris: number[] = []
  const R0 = 50.8,
    R1 = 63.5,
    N = 40
  const at = (r: number, a: number, z: number) => [r * Math.cos(a), r * Math.sin(a), z]
  const quad = (p: number[], q: number[], r: number[], s: number[]) =>
    tris.push(...p, ...q, ...r, ...p, ...r, ...s)
  for (let k = 0; k < N; k += 1) {
    const a0 = (Math.PI / 2) * (k / N),
      a1 = (Math.PI / 2) * ((k + 1) / N)
    const gap = Math.abs((a0 + a1) / 2 - Math.PI / 4) < 12 / 57.15 // ≈ 24 mm of arc at r_mid
    const top = gap ? 10 : 44 // the gap's segments are a 10 mm sill and nothing above it
    quad(at(R0, a0, 0), at(R1, a0, 0), at(R1, a1, 0), at(R0, a1, 0))
    quad(at(R0, a0, top), at(R1, a0, top), at(R1, a1, top), at(R0, a1, top))
    quad(at(R0, a0, 0), at(R0, a1, 0), at(R0, a1, top), at(R0, a0, top))
    quad(at(R1, a0, 0), at(R1, a1, 0), at(R1, a1, top), at(R1, a0, top))
    if (gap) continue
    quad(at(R0, a0, 0), at(R1, a0, 0), at(R1, a0, top), at(R0, a0, top))
    quad(at(R0, a1, 0), at(R1, a1, 0), at(R1, a1, top), at(R0, a1, top))
  }
  return { positions: Float32Array.from(tris), triangles: tris.length / 9 }
}

describe('analyseHost', () => {
  it('gives a door and its lintel the same open-topped opening, in bbox coordinates', () => {
    const stl = parseStl(syntheticStl([WALL], [{ min: [-12.5, 53, 10], max: [12.5, 67, 51] }]))
    const m = analyseHost(
      {
        foot: wallFoot,
        slots: [
          { name: 'door', require: ['interface|door|rectangular', 'size|single'] },
          { name: 'lintel', require: ['interface|lintel'] },
        ],
      },
      stl.positions,
      stl.triangles,
    )
    const door = m.mounts.find((x) => x.slot === 'door')
    const lintel = m.mounts.find((x) => x.slot === 'lintel')
    expect(door?.kind).toBe('opening')
    expect(lintel?.kind).toBe('opening')
    if (door?.kind !== 'opening') throw new Error('door')
    expect(door.width).toBeCloseTo(25, 0)
    expect(door.sill).toBeCloseTo(10, 0)
    expect(door.openTop).toBe(true)
    expect(door.leaves).toBe(1)
    expect(door.face).toBe('-y')
    expect(door.at[0]).toBeCloseTo(0, 0)
    expect(door.at[1]).toBeCloseTo(0, 0) // y is from the bbox centre, so the 60 mm offset is gone
    expect(m.unresolved).toEqual([])
  })

  it('marks a wide door as two leaves', () => {
    const stl = parseStl(syntheticStl([WIDE_WALL], [{ min: [-24, 53, 10], max: [24, 67, 51] }]))
    const m = analyseHost(
      {
        foot: { shape: 'wall', length: 4 },
        slots: [{ name: 'door', require: ['interface|door|arched', 'size|wide'] }],
      },
      stl.positions,
      stl.triangles,
    )
    expect(m.mounts[0]).toMatchObject({ kind: 'opening', leaves: 2 })
    expect(m.unresolved).toEqual([])
  })

  it('reports a door slot on a solid wall as modelled-in', () => {
    const stl = parseStl(syntheticStl([WALL]))
    const m = analyseHost(
      { foot: wallFoot, slots: [{ name: 'door', require: [] }] },
      stl.positions,
      stl.triangles,
    )
    expect(m.mounts).toEqual([])
    expect(m.unresolved).toEqual([{ slot: 'door', reason: 'modelled-in' }])
  })

  it('refuses a doorway that runs off the end of the wall', () => {
    // Flush with the wall's −x end, so the void reaches the outermost column the
    // silhouette leaves maskable: a door hung here has nothing to hinge against.
    const stl = parseStl(syntheticStl([WALL], [{ min: [-25, 53, 10], max: [-10, 67, 51] }]))
    const m = analyseHost(
      { foot: wallFoot, slots: [{ name: 'door', require: [] }] },
      stl.positions,
      stl.triangles,
    )
    expect(m.mounts).toEqual([])
    expect(m.unresolved).toEqual([{ slot: 'door', reason: 'runs-off-end' }])
  })

  it('finds a trapdoor hole in a floor', () => {
    // Flush in z, which is still a through-hole — the slab's own top and bottom
    // faces have the rectangle subtracted — and leaves the bounding box the
    // floor's, where an overshoot would push it to z −1..6 and move every
    // bbox-relative answer with it.
    const stl = parseStl(syntheticStl([FLOOR], [{ min: [15, 16, 0], max: [35, 34, 5] }]))
    const m = analyseHost(
      { foot: { shape: 'rect', w: 2, d: 2 }, slots: [{ name: 'trapdoor', require: [] }] },
      stl.positions,
      stl.triangles,
    )
    expect(m.mounts[0]).toMatchObject({ kind: 'hole', face: '+z' })
    if (m.mounts[0]?.kind !== 'hole') throw new Error('hole')
    expect(m.mounts[0].size[0]).toBeCloseTo(20, 0)
    expect(m.mounts[0].size[1]).toBeCloseTo(18, 0)
    expect(m.mounts[0].at[2]).toBeCloseTo(5, 0)
  })

  it('reports a trapdoor slot on a solid floor as no-hole', () => {
    const stl = parseStl(syntheticStl([FLOOR]))
    const m = analyseHost(
      { foot: { shape: 'rect', w: 2, d: 2 }, slots: [{ name: 'trapdoor', require: [] }] },
      stl.positions,
      stl.triangles,
    )
    expect(m.mounts).toEqual([])
    expect(m.unresolved).toEqual([{ slot: 'trapdoor', reason: 'no-hole' }])
  })

  it('gives a surface-class slot the top-face centre', () => {
    const stl = parseStl(syntheticStl([FLOOR]))
    const m = analyseHost(
      { foot: { shape: 'rect', w: 2, d: 2 }, slots: [{ name: 'statue', require: [] }] },
      stl.positions,
      stl.triangles,
    )
    expect(m.mounts[0]).toEqual({ slot: 'statue', kind: 'surface', face: '+z', at: [0, 0, 5] })
  })

  it('finds a treasure pocket square to the thin face', () => {
    // 8.5 × 8.5 mm, 8 mm deep, flush with the −y face so the mesh stays
    // watertight. Only the θ = 0 frame of the two thin faces is swept for a
    // pocket-class slot, so this costs one depth map per face, not 31.
    const stl = parseStl(
      syntheticStl([WALL], [{ min: [-4.25, 53.5, 20.75], max: [4.25, 61.5, 29.25] }]),
    )
    const m = analyseHost(
      { foot: wallFoot, slots: [{ name: 'treasure', require: [] }] },
      stl.positions,
      stl.triangles,
    )
    expect(m.unresolved).toEqual([])
    expect(m.mounts).toHaveLength(1)
    const pocket = m.mounts[0]
    if (pocket?.kind !== 'pocket') throw new Error('pocket')
    expect(pocket.face).toBe('-y')
    expect(pocket.section[0]).toBeCloseTo(8.5, 1)
    expect(pocket.depth).toBeCloseTo(8, 0)
    expect(pocket.axis[1]).toBeCloseTo(1, 3)
    expect(pocket.at[0]).toBeCloseTo(0, 0)
    expect(pocket.at[1]).toBeCloseTo(-6.5, 1) // the −y face, 6.5 mm from the bbox centre
    expect(pocket.at[2]).toBeCloseTo(25, 0)
  })

  it('reads the doorway of an arc host through the unrolled frame', () => {
    const wall = arcWall()
    const m = analyseHost(
      { foot: arcFoot, slots: [{ name: 'door', require: [] }] },
      wall.positions,
      wall.triangles,
    )
    expect(m.arc?.onRadius).toBeGreaterThan(0.4)
    expect(m.unresolved).toEqual([])
    const door = m.mounts[0]
    if (door?.kind !== 'opening') throw new Error('door')
    expect(door.width).toBeCloseTo(24, -1)
    expect(door.sill).toBeCloseTo(10, 0)
    // Re-rolled: the gap is at 45°, so the mount sits on the mid radius at that
    // bearing from the fitted centre. Left unrolled it would read 44.9 mm along
    // x — an arc length — and no bearing at all.
    const cx = (m.bbox.min[0] + m.bbox.max[0]) / 2,
      cy = (m.bbox.min[1] + m.bbox.max[1]) / 2
    expect(Math.atan2(door.at[1] + cy, door.at[0] + cx)).toBeCloseTo(Math.PI / 4, 1)
    expect(Math.hypot(door.at[0] + cx, door.at[1] + cy)).toBeCloseTo(57.15, 0)
  })

  it('refuses every slot of an arc host whose radii do not fit the mesh', () => {
    const stl = parseStl(syntheticStl([WALL]))
    const m = analyseHost(
      {
        foot: arcFoot,
        slots: [
          { name: 'door', require: [] },
          { name: 'torch', require: [] },
        ],
      },
      stl.positions,
      stl.triangles,
    )
    expect(m.mounts).toEqual([])
    expect(m.unresolved).toEqual([
      { slot: 'door', reason: 'arc-fit-refused' },
      { slot: 'torch', reason: 'arc-fit-refused' },
    ])
  })

  it('resolves a grate by the host it sits in', () => {
    const wall = parseStl(syntheticStl([WALL], [{ min: [-8, 53, 20], max: [8, 67, 40] }]))
    const inWall = analyseHost(
      { foot: wallFoot, slots: [{ name: 'grate', require: [] }] },
      wall.positions,
      wall.triangles,
    )
    expect(inWall.mounts[0]?.kind).toBe('opening')

    const floor = parseStl(syntheticStl([FLOOR], [{ min: [15, 16, 0], max: [35, 34, 5] }]))
    const inFloor = analyseHost(
      { foot: { shape: 'rect', w: 2, d: 2 }, slots: [{ name: 'grate', require: [] }] },
      floor.positions,
      floor.triangles,
    )
    expect(inFloor.mounts[0]?.kind).toBe('hole')
  })
})

describe('analyseInsert', () => {
  it('classes a thin slab as a leaf anchored at its bottom centre', () => {
    const stl = parseStl(syntheticStl([{ min: [-14, -2, 5], max: [14, 2, 40] }]))
    const m = analyseInsert(stl.positions, stl.triangles)
    expect(m.anchor.kind).toBe('leaf')
    expect(m.anchor.at).toEqual([0, 0, 0])
    expect(Math.abs(m.anchor.axis[1])).toBe(1)
    expect(m.anchor.size).toEqual([28, 4, 35])
  })

  it('classes a tall thin prism as a peg with its axis along the long side', () => {
    const stl = parseStl(syntheticStl([{ min: [-3.5, -3.5, 0], max: [3.5, 3.5, 12] }]))
    const m = analyseInsert(stl.positions, stl.triangles)
    expect(m.anchor.kind).toBe('peg')
    expect(m.anchor.axis).toEqual([0, 0, 1])
    expect(m.anchor.at).toEqual([0, 0, 0])
  })

  it('classes a cup with one flat face as a plate anchored on it', () => {
    const stl = parseStl(
      syntheticStl([{ min: [0, 0, 0], max: [20, 20, 20] }], [{ min: [2, 2, 10], max: [18, 18, 21] }]),
    )
    const m = analyseInsert(stl.positions, stl.triangles)
    expect(m.anchor.kind).toBe('plate')
    expect(m.anchor.axis).toEqual([0, 0, 1]) // into the body, off the face it lies on
    expect(m.anchor.at).toEqual([0, 0, 0])
  })

  it('classes a cube as a block', () => {
    const stl = parseStl(syntheticStl([{ min: [0, 0, 0], max: [20, 20, 20] }]))
    const m = analyseInsert(stl.positions, stl.triangles)
    expect(m.anchor.kind).toBe('block')
    expect(m.anchor.axis).toEqual([0, 0, 1])
    expect(m.anchor.at).toEqual([0, 0, 0])
  })
})

describe('toBboxCoordinates', () => {
  it('measures x/y from the centre and z from the bottom', () => {
    expect(toBboxCoordinates([0, 60, 10], { min: [-25, 53.5, 0], max: [25, 66.5, 50] })).toEqual([
      0, 0, 10,
    ])
  })
})
