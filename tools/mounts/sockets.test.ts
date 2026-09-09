import { describe, expect, it } from 'vitest'

import { parseStl } from '../../src/three/stl/parse'
import { socketPoses } from './sockets'
import { syntheticStl } from './synthetic'

type Point = readonly [number, number, number]

const WALL = { min: [-25, -6.5, 0], max: [25, 6.5, 45] } as const

const TILT = (63 * Math.PI) / 180
const HALF_WIDTH = 2.75,
  HALF_THICK = 1.5,
  BORE_LENGTH = 19,
  MOUTH_Z = 28

/**
 * A 5.5 × 3 mm slot bored into the −y face at z = 28, descending 19 mm into the
 * wall at 63° from the normal, as its own triangle soup.
 *
 * Not built with `syntheticStl`: that builder subtracts cuts from solids but not
 * from each other, so a staircase of stepped cuts approximating this bore is a
 * void partitioned by every step's own faces. Measured — every one of those
 * partitions projects into the same column band as the mouth at the matching
 * sweep angle, so the depth map, which keeps the *first* hit, read 1.15 mm of a
 * 19 mm slot at every angle in the sweep. A single prism has no interior faces.
 */
function slottedWall(): { positions: Float64Array; triangles: number } {
  const tris: number[] = []
  const quad = (a: Point, b: Point, c: Point, d: Point) =>
    tris.push(...a, ...b, ...c, ...a, ...c, ...d)
  const [x0, y0, z0] = WALL.min,
    [x1, y1, z1] = WALL.max

  // The bore's own frame: `axis` runs into the wall, `across` spans its thickness.
  const axis: Point = [0, Math.cos(TILT), -Math.sin(TILT)]
  const across: Point = [0, Math.sin(TILT), Math.cos(TILT)]
  /** A mouth corner: offset across the bore, then slid along it back onto the face. */
  const mouth = (u: number, w: number): Point => [
    u,
    y0,
    MOUTH_Z + w * across[2] + ((-w * across[1]) / axis[1]) * axis[2],
  ]
  const far = (u: number, w: number): Point => {
    const [x, y, z] = mouth(u, w)
    return [x, y + BORE_LENGTH * axis[1], z + BORE_LENGTH * axis[2]]
  }
  for (const w of [-HALF_THICK, HALF_THICK])
    quad(mouth(-HALF_WIDTH, w), mouth(HALF_WIDTH, w), far(HALF_WIDTH, w), far(-HALF_WIDTH, w))
  for (const u of [-HALF_WIDTH, HALF_WIDTH])
    quad(mouth(u, -HALF_THICK), mouth(u, HALF_THICK), far(u, HALF_THICK), far(u, -HALF_THICK))
  quad(
    far(-HALF_WIDTH, -HALF_THICK),
    far(HALF_WIDTH, -HALF_THICK),
    far(HALF_WIDTH, HALF_THICK),
    far(-HALF_WIDTH, HALF_THICK),
  )

  // The wall's other five faces, then the −y face as the four rectangles around
  // the mouth — which is where the bore's oblique cut lands on it, exactly.
  quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1])
  for (const x of [x0, x1]) quad([x, y0, z0], [x, y1, z0], [x, y1, z1], [x, y0, z1])
  for (const z of [z0, z1]) quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z])
  const zLo = mouth(0, -HALF_THICK)[2],
    zHi = mouth(0, HALF_THICK)[2]
  const front = (a: number, b: number, c: number, d: number) =>
    quad([a, y0, b], [c, y0, b], [c, y0, d], [a, y0, d])
  front(x0, z0, x1, zLo)
  front(x0, zHi, x1, z1)
  front(x0, zLo, -HALF_WIDTH, zHi)
  front(HALF_WIDTH, zLo, x1, zHi)

  return { positions: Float64Array.from(tris), triangles: tris.length / 9 }
}

describe('socketPoses', () => {
  it('finds a tilted slot on the -y face with its entrance, axis and angle', () => {
    const wall = slottedWall()
    const found = socketPoses(wall.positions, wall.triangles, 1, 0, -1)
    expect(found).toHaveLength(1)
    const p = found[0]!
    expect(p.face).toBe('-y')
    expect(p.entrance[0]).toBeCloseTo(0, 0)
    expect(Math.abs(p.entrance[1] + 6.5)).toBeLessThan(1.5)
    expect(Math.abs(p.entrance[2] - MOUTH_Z)).toBeLessThan(3)
    expect(p.angleFromNormal).toBeGreaterThan(55)
    expect(p.angleFromNormal).toBeLessThan(72)
    expect(p.axis[2]).toBeLessThan(0) // descends
    expect(p.entranceSize[0]).toBeCloseTo(5.5, 0)
  })

  it('finds nothing on the +y face of the same wall', () => {
    const wall = slottedWall()
    expect(socketPoses(wall.positions, wall.triangles, 1, 0, +1)).toEqual([])
  })

  it('returns both sockets of a wall with two', () => {
    const cuts = [-20, 20].map(
      (x) => ({ min: [x - 2.75, -6.6, 20], max: [x + 2.75, 3, 23] }) as const,
    )
    const stl = parseStl(syntheticStl([WALL], cuts))
    const found = socketPoses(stl.positions, stl.triangles, 1, 0, -1)
    expect(found.map((p) => Math.round(p.entrance[0])).sort((a, b) => a - b)).toEqual([-20, 20])
  })
})
