/**
 * Arc fitting against sectors whose inner radius, outer radius and sweep are
 * known before the fit runs — and against shapes it has to refuse.
 *
 * Every band in `openlock-tessellation.md` §4 appears here as a fixture: the
 * radial `[R−2, R]`, the `convex` `[R−0.5, R]`, the `concave` `[R, R+0.5]`, the
 * `s2w` `[R−1.5, R]`, and the degenerate radial `[0, R]` quarter disc that is
 * 365 tiles at `2r90` alone. The fitter is told none of them. It is given
 * vertices and has to produce the numbers back.
 *
 * The refusals matter just as much. §7 measured the `xG` codes as straight
 * 0.5-thick walls while the catalog gives them `foot: {shape: "arc"}`, so a
 * fitter that quietly fitted a sector to a wall would confirm the bug instead of
 * finding it.
 */
import { describe, expect, it } from 'vitest'

import {
  ANNULUS_GAP_RATIO,
  BBOX_RESIDUAL_TOL_MM,
  coveringArc,
  fitAnnularSector,
  fitStrip,
  project,
  sectorBounds,
} from './arc'
import { annularSectorMesh, boxMesh, positionsOf, wallMesh } from './fixtures/mesh'

const MM = 25.4

function fit(mesh: readonly (readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]])[]): ReturnType<typeof fitAnnularSector> {
  return fitAnnularSector(positionsOf(mesh), mesh.length)
}

describe('fitAnnularSector — the four bands openlock-tessellation.md §4 names', () => {
  const bands = [
    { name: 'radial [R-2, R] at 4r45', inner: 2, outer: 4, sweep: 45 },
    { name: 'radial [0, R] quarter disc at 2r90', inner: 0, outer: 2, sweep: 90 },
    { name: 'convex [R-0.5, R] at 4r22.5', inner: 3.5, outer: 4, sweep: 22.5 },
    { name: 'concave [R, R+0.5] at 2r90', inner: 2, outer: 2.5, sweep: 90 },
    { name: 's2w radial [R-1.5, R] at 6r11.25', inner: 4.5, outer: 6, sweep: 11.25 },
  ] as const

  for (const band of bands) {
    it(`recovers ${band.name} without being told the centre`, () => {
      const result = fit(
        annularSectorMesh({
          innerRadiusMm: band.inner * MM,
          outerRadiusMm: band.outer * MM,
          sweepDeg: band.sweep,
          // Off the origin and off axis, so nothing can be recovered by assuming.
          centreMm: [317.5, -88.9],
          startDeg: 23.5,
        }),
      )
      expect(result.fit).toBe('sector')
      if (result.fit === 'rejected') return

      // Asserted against the interval the fit reports for itself, not against a
      // tolerance chosen here. That is the property W5 depends on: a band is
      // only usable if the error bar shipped beside it actually contains the
      // truth. `radiusToleranceMm` widens to over a millimetre for an 11.25°
      // band and closes to a hundredth for a 90° one, which is real — the fit is
      // degenerate along the bisector and short sweeps barely constrain it.
      expect(Math.abs(result.innerRadiusUnits - band.inner) * MM).toBeLessThanOrEqual(
        result.radiusToleranceMm,
      )
      expect(Math.abs(result.outerRadiusUnits - band.outer) * MM).toBeLessThanOrEqual(
        result.radiusToleranceMm,
      )
      // The band width itself is far better determined than either radius: the
      // degenerate direction moves both together.
      expect(result.bandUnits).toBeCloseTo(band.outer - band.inner, 3)
      expect(result.sweepDeg).toBeCloseTo(band.sweep, 1)
      expect(result.bboxResidualMm).toBeLessThan(BBOX_RESIDUAL_TOL_MM)
    })
  }
})

describe('fitAnnularSector — assumptions it does not make', () => {
  it('finds a centre far from the origin and reports how far', () => {
    const result = fit(
      annularSectorMesh({
        innerRadiusMm: 2 * MM,
        outerRadiusMm: 2.5 * MM,
        sweepDeg: 90,
        centreMm: [1000, -2000],
      }),
    )
    expect(result.fit).toBe('sector')
    expect(result.centreMm[0]).toBeCloseTo(1000, 2)
    expect(result.centreMm[1]).toBeCloseTo(-2000, 2)
    // Recorded so the sidecar can be audited rather than trusted.
    expect(result.centreOffsetMm).toBeCloseTo(Math.hypot(1000, 2000), 1)
  })

  it('finds the plane rather than assuming xy', () => {
    const result = fit(
      annularSectorMesh({ innerRadiusMm: 2 * MM, outerRadiusMm: 4 * MM, sweepDeg: 90, plane: 'xz' }),
    )
    expect(result.fit).toBe('sector')
    expect(result.plane).toBe('xz')
    if (result.fit === 'rejected') return
    expect(result.outerRadiusUnits).toBeCloseTo(4, 3)
  })

  it('handles a sweep above 90°, where the centre is not at a box corner', () => {
    const result = fit(
      annularSectorMesh({ innerRadiusMm: 1 * MM, outerRadiusMm: 2 * MM, sweepDeg: 240 }),
    )
    expect(result.fit).toBe('sector')
    if (result.fit === 'rejected') return
    expect(result.sweepDeg).toBeCloseTo(240, 2)
  })

  it('calls a closed annulus an annulus, not a 354° sector', () => {
    // Without the gap-ratio rule the covering arc is 360 − one tessellation step.
    const result = fit(
      annularSectorMesh({ innerRadiusMm: 1 * MM, outerRadiusMm: 2 * MM, sweepDeg: 360, segments: 64 }),
    )
    expect(result.fit).toBe('annulus')
    if (result.fit === 'rejected') return
    expect(result.sweepDeg).toBe(360)
    expect(ANNULUS_GAP_RATIO).toBeGreaterThan(1)
  })
})

describe('fitAnnularSector — refusal', () => {
  it('refuses a straight wall run and reports the strip it actually is', () => {
    // openlock-tessellation.md §7: the xG codes measure as straight 0.5-thick
    // walls. The catalog gives them foot.shape === 'arc'. A fitter that produced
    // a sector here would confirm the bug rather than find it.
    const result = fit(wallMesh(3 * MM, 0.5 * MM, 30))
    expect(result.fit).toBe('rejected')
    if (result.fit !== 'rejected') return
    expect(result.reason).toBe('box-mismatch')
    expect(result.bboxResidualMm).toBeGreaterThan(BBOX_RESIDUAL_TOL_MM)
    expect(result.strip?.lengthUnits).toBeCloseTo(3, 3)
    expect(result.strip?.widthUnits).toBeCloseTo(0.5, 3)
  })

  it('refuses a rotated wall run too, and reports its orientation', () => {
    const result = fit(wallMesh(2 * MM, 0.5 * MM, 30, 37))
    expect(result.fit).toBe('rejected')
    if (result.fit !== 'rejected') return
    expect(result.strip?.lengthUnits).toBeCloseTo(2, 3)
    expect(result.strip?.widthUnits).toBeCloseTo(0.5, 3)
    expect(result.strip?.angleDeg).toBeCloseTo(37, 2)
  })

  it('refuses a plain rectangle', () => {
    const result = fit(boxMesh([0, 0, 0], [4 * MM, 4 * MM, 12.7]))
    expect(result.fit).toBe('rejected')
  })

  it('refuses a mesh with no facets rather than fitting the origin', () => {
    const result = fitAnnularSector(new Float32Array(0), 0)
    expect(result.fit).toBe('rejected')
    if (result.fit !== 'rejected') return
    expect(result.reason).toBe('no-vertices')
  })

  it('reports the xy plane on a refusal, because the plane label means nothing then', () => {
    // Ranking rejections by residual picked whichever projection was squarest,
    // which reported a wall's *elevation* instead of its footprint.
    const result = fit(wallMesh(3 * MM, 0.5 * MM, 30))
    expect(result.plane).toBe('xy')
  })
})

describe('radiusToleranceMm — the error bar W5 has to read', () => {
  it('is tighter for a long sweep than for a short one', () => {
    // Not a modelled figure: the fit slides its own centre along the sector's
    // bisector and reports where the residual doubles.
    const wide = fit(
      annularSectorMesh({ innerRadiusMm: 2 * MM, outerRadiusMm: 2.5 * MM, sweepDeg: 90 }),
    )
    const narrow = fit(
      annularSectorMesh({ innerRadiusMm: 2 * MM, outerRadiusMm: 2.5 * MM, sweepDeg: 11.25 }),
    )
    expect(wide.radiusToleranceMm).toBeLessThan(narrow.radiusToleranceMm)
    expect(wide.radiusToleranceMm).toBeLessThan(0.1)
  })

  it('is reported on a refusal too, so a rejection is fully diagnosable', () => {
    const result = fit(wallMesh(3 * MM, 0.5 * MM, 30))
    expect(result.radiusToleranceMm).toBeGreaterThan(0)
  })
})

describe('coveringArc', () => {
  it('is the minimal arc containing every angle', () => {
    const angles = Float64Array.from([0, 0.1, 0.2, Math.PI / 2])
    const arc = coveringArc(angles)
    expect(arc.sweepRad).toBeCloseTo(Math.PI / 2, 6)
    expect(arc.startRad).toBeCloseTo(0, 6)
  })

  it('wraps across ±π rather than reporting a 350° sweep', () => {
    const angles = Float64Array.from([-3.0, -3.1, 3.0, 3.1])
    const arc = coveringArc(angles)
    expect(arc.sweepRad).toBeLessThan(0.6)
  })

  it('separates the opening gap from the largest hole inside the sweep', () => {
    const angles = Float64Array.from([0, 0.1, 0.9, 1.0])
    const arc = coveringArc(angles)
    expect(arc.sweepRad).toBeCloseTo(1.0, 6)
    // The 0.8 rad hole between 0.1 and 0.9 is inside the sweep, not its opening.
    expect(arc.largestInnerGapDeg).toBeCloseTo((0.8 * 180) / Math.PI, 4)
  })
})

describe('sectorBounds', () => {
  it('reproduces §4’s identity for a sweep of at most 90°', () => {
    // bboxX = Rout − Rin·cos θ, bboxY = Rout·sin θ, for a sector starting at 0.
    const rIn = 2
    const rOut = 4
    const theta = Math.PI / 4
    const box = sectorBounds(rIn, rOut, 0, theta)
    expect(box.maxU - box.minU).toBeCloseTo(rOut - rIn * Math.cos(theta), 10)
    expect(box.maxV - box.minV).toBeCloseTo(rOut * Math.sin(theta), 10)
  })

  it('picks up the cardinal extremes of a sweep that crosses one', () => {
    // A sector from 45° to 135° reaches its maximum V at 90°, not at either end.
    const box = sectorBounds(1, 2, Math.PI / 4, Math.PI / 2)
    expect(box.maxV).toBeCloseTo(2, 10)
  })

  it('is the whole circle for a full annulus', () => {
    const box = sectorBounds(1, 3, 0, 2 * Math.PI)
    expect(box.minU).toBeCloseTo(-3, 10)
    expect(box.maxU).toBeCloseTo(3, 10)
    expect(box.minV).toBeCloseTo(-3, 10)
    expect(box.maxV).toBeCloseTo(3, 10)
  })
})

describe('fitStrip', () => {
  it('is the minimum-area oriented box, exact for an axis-aligned wall', () => {
    const mesh = wallMesh(3 * MM, 0.5 * MM, 30)
    const strip = fitStrip(project(positionsOf(mesh), mesh.length, 'xy'))
    expect(strip?.lengthUnits).toBeCloseTo(3, 4)
    expect(strip?.widthUnits).toBeCloseTo(0.5, 4)
    expect(strip?.residualMm).toBeCloseTo(0, 4)
  })

  it('recovers the orientation of a rotated wall', () => {
    const mesh = wallMesh(2 * MM, 0.5 * MM, 30, 118)
    const strip = fitStrip(project(positionsOf(mesh), mesh.length, 'xy'))
    expect(strip?.lengthUnits).toBeCloseTo(2, 3)
    expect(strip?.widthUnits).toBeCloseTo(0.5, 3)
    // Reported in [0, 180); 118° is its own representative.
    expect(strip?.angleDeg).toBeCloseTo(118, 1)
  })

  it('returns undefined for fewer than three vertices', () => {
    expect(fitStrip(Float64Array.from([0, 0, 1, 1]))).toBeUndefined()
  })
})
