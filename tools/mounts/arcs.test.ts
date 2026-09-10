import { describe, expect, it } from 'vitest'

import { ARC_FIT_MIN_ON_RADIUS, fitArcCentre, reroll, rerollVector, unroll } from './arcs'
import { columns, throughOpenings } from './geometry'

/** A 90° arc wall, r 50.8..63.5, centred at the origin, 44 tall, with a 24 mm gap at 45°, as 40 trapezoid-ish box segments. */
function arcWallPositions(): { positions: Float64Array; triangles: number } {
  const tris: number[] = []
  const R0 = 50.8,
    R1 = 63.5,
    N = 40
  for (let k = 0; k < N; k += 1) {
    const a0 = (Math.PI / 2) * (k / N),
      a1 = (Math.PI / 2) * ((k + 1) / N)
    const mid = (a0 + a1) / 2
    const gap = Math.abs(mid - Math.PI / 4) < 12 / 57.15 // ≈ 24 mm of arc at r_mid
    const zTop = 44
    const corners = (r: number, a: number, z: number) => [r * Math.cos(a), r * Math.sin(a), z]
    const quad = (p: number[], q: number[], r: number[], s: number[]) =>
      tris.push(...p, ...q, ...r, ...p, ...r, ...s)
    const zSill = gap ? 10 : 0
    if (gap) {
      // below the gap only, plus the sill top
      quad(corners(R0, a0, 0), corners(R1, a0, 0), corners(R1, a1, 0), corners(R0, a1, 0))
      quad(
        corners(R0, a0, zSill),
        corners(R1, a0, zSill),
        corners(R1, a1, zSill),
        corners(R0, a1, zSill),
      )
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

  it('scores a clean sector well clear of the acceptance floor', () => {
    // The floor is 0.35 and a whole sector scores about 0.5, so the 11 grate
    // walls the full run measured at 0.36–0.40 are between the two rather than
    // near this fixture: lowering it admits them and nothing at 0.16–0.30.
    const { positions, triangles } = arcWallPositions()
    const fit = fitArcCentre(positions, triangles, 50.8, 63.5)
    expect(fit.onRadius).toBeGreaterThan(ARC_FIT_MIN_ON_RADIUS)
    expect(ARC_FIT_MIN_ON_RADIUS).toBeLessThan(0.36)
    expect(ARC_FIT_MIN_ON_RADIUS).toBeGreaterThan(0.3)
  })
})

describe('unroll', () => {
  it('turns the doorway of an arc wall into an opening the flat detector reads', () => {
    const { positions, triangles } = arcWallPositions()
    const flat = unroll(positions, [0, 0], 57.15)
    const opening = throughOpenings(columns(flat, triangles, 1))[0]!
    expect(opening.width).toBeCloseTo(24, -1)
    expect(opening.sill).toBeCloseTo(10, 0)
    const back = reroll([opening.at[0], 0, opening.at[1]], [0, 0], 57.15)
    expect(Math.atan2(back[1], back[0])).toBeCloseTo(Math.PI / 4, 1)
  })

  it('re-rolls a radial vector to point along the radius', () => {
    const v = rerollVector([57.15 * (Math.PI / 4), 0, 20], [0, 1, 0], [0, 0], 57.15)
    expect(v[0]).toBeCloseTo(Math.SQRT1_2, 2)
    expect(v[1]).toBeCloseTo(Math.SQRT1_2, 2)
  })

  it('sends the two unrolled faces to the two radial directions', () => {
    // Which is the whole of `Mount.normal` on a sector: the unrolled `+y` is the
    // outer radius and points away from the centre, `-y` the inner one and points
    // at it. Both at the mount's own bearing, here 45°.
    const at: [number, number, number] = [57.15 * (Math.PI / 4), 0, 20]
    const outer = rerollVector(at, [0, 1, 0], [0, 0], 57.15)
    const inner = rerollVector(at, [0, -1, 0], [0, 0], 57.15)
    outer.forEach((c, i) => {
      expect(-(inner[i] as number)).toBeCloseTo(c, 12)
    })
    expect(Math.hypot(...inner)).toBeCloseTo(1, 6)
    expect(inner[0]).toBeCloseTo(-Math.SQRT1_2, 2)
    expect(inner[1]).toBeCloseTo(-Math.SQRT1_2, 2)
  })
})
