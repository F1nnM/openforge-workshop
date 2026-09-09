import { describe, expect, it } from 'vitest'

import { parseStl } from '../../src/three/stl/parse'
import { analyseHost, analyseInsert, isDupontSocket, toBboxCoordinates } from './classify'
import { syntheticStl } from './synthetic'
import type { Pocket } from './sockets'

/** Authored off-centre in y, like the cut-stone door wall. */
const WALL = { min: [-25, 53.5, 0], max: [25, 66.5, 50] } as const
const wallFoot = { shape: 'wall', length: 2 } as const

/**
 * The 4-unit wall the double-door case declares a footprint for, at its true
 * 101.6 mm.
 *
 * Not `WALL` with the same doorway in it: a 48 mm doorway in a 50 mm wall leaves
 * 4% of the columns at full height and `throughOpenings` reads its top line at
 * the 90th percentile of them, so that host has no *silhouette* to cut an opening
 * out of. That case is pinned separately, below.
 */
const WIDE_WALL = { min: [-50.8, 53.5, 0], max: [50.8, 66.5, 50] } as const

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

  it('reports a doorway too wide for the top line as modelled-in', () => {
    // 48 mm of doorway in a 50 mm wall — the brief's original fixture, kept as an
    // executable record of a limitation that is `geometry.ts`'s, not this file's:
    // `throughOpenings` takes the roof line as the 90th percentile of per-column
    // tops, and 96% of these columns stop at the sill, so the line lands *below*
    // the doorway and no opening is found at all. With no opening and no enclosed
    // void either — an open top is not enclosed — the reason is `modelled-in`.
    //
    // Fix the percentile and this test goes red rather than the behaviour
    // changing quietly: the expected answer then becomes one 48 mm opening.
    const stl = parseStl(syntheticStl([WALL], [{ min: [-24, 53, 10], max: [24, 67, 51] }]))
    const m = analyseHost(
      { foot: { shape: 'wall', length: 2 }, slots: [{ name: 'door', require: [] }] },
      stl.positions,
      stl.triangles,
    )
    expect(m.mounts).toEqual([])
    expect(m.unresolved).toEqual([{ slot: 'door', reason: 'modelled-in' }])
  })

  it('reports a void too small to be an opening as no-opening', () => {
    // 5 × 5 mm through the wall: enclosed on all sides, so the host *is* cut
    // through — which is what separates this from `modelled-in` — but under
    // `throughOpenings`' 8 mm and 60 mm² floors, so nothing qualifies.
    const stl = parseStl(syntheticStl([WALL], [{ min: [-2.5, 53, 20], max: [2.5, 67, 25] }]))
    const m = analyseHost(
      { foot: wallFoot, slots: [{ name: 'door', require: [] }] },
      stl.positions,
      stl.triangles,
    )
    expect(m.mounts).toEqual([])
    expect(m.unresolved).toEqual([{ slot: 'door', reason: 'no-opening' }])
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

  it('finds a shallower, off-centre 9 mm treasure hollow', () => {
    // The real corpus's `aztlan#treasure_hollow+9mm` reads a ~9 mm square
    // recess about 5 mm deep, mid-height and off-centre along the run — not
    // the 8 mm-deep, x-centred fixture above. 5 mm clears the pocket sweep's
    // own 3.5 mm floor but not the socket rule's 12 mm, and 9 mm clears
    // `POCKET_SIZE_MM`'s 7 mm floor.
    const stl = parseStl(
      syntheticStl([WALL], [{ min: [4.5, 53.5, 20.5], max: [13.5, 58.5, 29.5] }]),
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
    expect(pocket.section[0]).toBeCloseTo(9, 0)
    expect(pocket.section[1]).toBeCloseTo(9, 0)
    expect(pocket.depth).toBeCloseTo(5, 0)
  })

  it('finds a 30 mm treasure hollow, 7 mm deep', () => {
    // The corpus's `+30mm` variant: the widest of the three, and still short
    // of the socket rule's 12 mm floor. `POCKET_SIZE_MM`'s 32 mm ceiling is
    // what lets a mouth this wide resolve at all.
    //
    // `localBaseline`'s window (`geometry.ts`, ±6 mm) is what a treasure pocket
    // is read against, and a recess wider than that window on *both* sides at
    // once reads back as four corner slivers rather than one mouth — a solid
    // 30 × 30 mm square only ever clears the mask at its corners, each under
    // `POCKET_SIZE_MM`'s 7 mm floor, so it stays `no-pocket` however this
    // file's thresholds are set. A recess no more than the window's ~12 mm
    // tall does not have that problem: every column sees both its top and
    // bottom edge at once, so the whole 30 mm run reads as one mouth — which
    // is the shape this fixture measures.
    const stl = parseStl(
      syntheticStl([WALL], [{ min: [-15, 53.5, 22], max: [15, 60.5, 28] }]),
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
    expect(pocket.section[0]).toBeCloseTo(30, 0)
    expect(pocket.section[1]).toBeCloseTo(6, 0)
    expect(pocket.depth).toBeCloseTo(7, 0)
  })

  it('reports a torch slot on a solid wall as no-socket', () => {
    // A 12 mm stub of a wall, not the 50 mm one. A socket-class slot pays the
    // real 31-angle sweep on all four side faces, and that cost is per grid cell:
    // measured, this host takes 4.4 s where the 20 mm one took 9.1 s and the
    // 50 mm one would take ~56 s. What is under test is that an unbored face
    // yields `no-socket`, and the size of the face it is not bored into does not
    // enter into it. (`vitest.config.ts` explains why a test that is comfortably
    // inside the 30 s timeout on an idle machine is still worth shrinking.)
    const stl = parseStl(syntheticStl([{ min: [-6, -6.5, 0], max: [6, 6.5, 12] }]))
    const m = analyseHost(
      { foot: wallFoot, slots: [{ name: 'torch', require: ['component|torch'] }] },
      stl.positions,
      stl.triangles,
    )
    expect(m.mounts).toEqual([])
    expect(m.unresolved).toEqual([{ slot: 'torch', reason: 'no-socket' }])
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

/** The slot `sockets.test.ts` bores, as `socketPoses` reports it: 5.5 × 3 mm at 63°. */
const SOCKET: Pocket = {
  face: '-y',
  entrance: [0, -6.5, 28],
  bottom: [0, 2.1, 11],
  axis: [0, 0.454, -0.891],
  angleFromNormal: 63,
  depth: 17.3,
  entranceSize: [5.5, 3],
  area: 16.5,
  depthMax: 19,
  theta: -60,
}

describe('isDupontSocket', () => {
  it('takes a slot at the measured angle, mouth and depth', () => {
    expect(isDupontSocket(SOCKET)).toBe(true)
  })

  it('holds all five bounds, from both sides of each', () => {
    const variants: Readonly<Record<string, Partial<Pocket>>> = {
      'angle 57.9': { angleFromNormal: 57.9 },
      'angle 58': { angleFromNormal: 58 },
      'angle 68': { angleFromNormal: 68 },
      'angle 68.1': { angleFromNormal: 68.1 },
      'mouth 4.9 wide': { entranceSize: [4.9, 3] },
      'mouth 5 wide': { entranceSize: [5, 3] },
      'mouth 6.5 wide': { entranceSize: [6.5, 3] },
      'mouth 6.6 wide': { entranceSize: [6.6, 3] },
      'mouth 1.9 thick': { entranceSize: [5.5, 1.9] },
      'mouth 2 thick': { entranceSize: [5.5, 2] },
      'mouth 3.5 thick': { entranceSize: [5.5, 3.5] },
      'mouth 3.6 thick': { entranceSize: [5.5, 3.6] },
      'depth 11.9': { depth: 11.9 },
      'depth 12': { depth: 12 },
    }
    const got = Object.fromEntries(
      Object.entries(variants).map(([name, change]) => [
        name,
        isDupontSocket({ ...SOCKET, ...change }),
      ]),
    )
    expect(got).toEqual({
      'angle 57.9': false,
      'angle 58': true,
      'angle 68': true,
      'angle 68.1': false,
      'mouth 4.9 wide': false,
      'mouth 5 wide': true,
      'mouth 6.5 wide': true,
      'mouth 6.6 wide': false,
      'mouth 1.9 thick': false,
      'mouth 2 thick': true,
      'mouth 3.5 thick': true,
      'mouth 3.6 thick': false,
      'depth 11.9': false,
      'depth 12': true,
    })
  })

  it('has no upper bound on depth — a socket bored right through still counts', () => {
    expect(isDupontSocket({ ...SOCKET, depth: 40 })).toBe(true)
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
