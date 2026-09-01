/**
 * The band policy and the fidelity measures, with no glTF and no wasm in sight.
 *
 * These are the numbers that decide what ships, so they are pinned against the
 * real triangle counts measured across the corpus rather than against round
 * numbers.
 */
import { describe, expect, it } from 'vitest'

import { box, icosphere } from './fixtures/stl'
import {
  KEEP_FRACTION,
  MAX_AREA_ERROR,
  MAX_BBOX_DELTA,
  MAX_TRIANGLES,
  MIN_TRIANGLES,
  fidelity,
  isPassThrough,
  meshMetrics,
  targetTriangles,
} from './mesh'

describe('targetTriangles', () => {
  it('lands the corpus meshes measured in mesh.ts where the table says', () => {
    // Source counts and the column each of them wants — see the docblock table.
    expect(targetTriangles(71_292)).toBe(MIN_TRIANGLES)
    expect(targetTriangles(207_296)).toBe(MIN_TRIANGLES)
    expect(targetTriangles(527_488)).toBe(5_275)
    expect(targetTriangles(2_178_242)).toBe(MAX_TRIANGLES)
  })

  it('passes anything at or below the ceiling through untouched', () => {
    expect(targetTriangles(118)).toBe(118)
    expect(targetTriangles(MAX_TRIANGLES)).toBe(MAX_TRIANGLES)
    expect(isPassThrough(MAX_TRIANGLES)).toBe(true)
    expect(isPassThrough(MAX_TRIANGLES + 1)).toBe(false)
  })

  it('never inflates a small mesh toward the floor', () => {
    for (const source of [1, 12, 118, 4_999, 19_999]) {
      expect(targetTriangles(source)).toBe(source)
    }
  })

  it('stays inside the band for everything the gate refuses', () => {
    // 24 MiB of binary STL is 503,314 facets; the corpus maximum is 2,178,242.
    for (const source of [503_314, 800_000, 1_500_000, 2_178_242]) {
      const target = targetTriangles(source)
      expect(target).toBeGreaterThanOrEqual(MIN_TRIANGLES)
      expect(target).toBeLessThanOrEqual(MAX_TRIANGLES)
    }
  })

  it('is monotone in source complexity', () => {
    let previous = 0
    for (let source = MAX_TRIANGLES + 1; source < 3_000_000; source += 9_973) {
      const target = targetTriangles(source)
      expect(target).toBeGreaterThanOrEqual(previous)
      previous = target
    }
  })

  it('reads the band it is given rather than the module default', () => {
    const band = { min: 50, max: 4_000 }
    expect(targetTriangles(5_120, band)).toBe(52)
    expect(isPassThrough(5_120, band)).toBe(false)
    expect(isPassThrough(4_000, band)).toBe(true)
    // The same mesh, against the default band, is a pass-through.
    expect(isPassThrough(5_120)).toBe(true)
    expect(targetTriangles(5_120)).toBe(5_120)
  })

  it('keeps 1%, which is what puts the heaviest mesh on the ceiling', () => {
    expect(KEEP_FRACTION).toBe(0.01)
    expect(Math.ceil(2_178_242 * KEEP_FRACTION)).toBeGreaterThan(MAX_TRIANGLES)
  })
})

describe('meshMetrics', () => {
  it('gets a box exactly right', () => {
    const metrics = meshMetrics(box(10, 20, 30), null)
    expect(metrics.triangles).toBe(12)
    expect(metrics.volume).toBeCloseTo(6_000, 3)
    expect(metrics.area).toBeCloseTo(2 * (10 * 20 + 10 * 30 + 20 * 30), 3)
    expect(metrics.extents).toEqual([10, 20, 30])
  })

  it('approaches the sphere it is a subdivision of', () => {
    const metrics = meshMetrics(icosphere(5, 25), null)
    expect(metrics.area / (4 * Math.PI * 25 ** 2)).toBeCloseTo(1, 2)
    expect(metrics.volume / ((4 / 3) * Math.PI * 25 ** 3)).toBeCloseTo(1, 2)
  })

  it('reads an indexed mesh the same as the soup it came from', () => {
    const soup = box()
    const positions = new Float32Array(8 * 3)
    // Rebuild the box as 8 shared vertices, keeping the same 12 faces.
    const unique = new Map<string, number>()
    const indices: number[] = []
    for (let corner = 0; corner < 36; corner += 1) {
      const at = corner * 3
      const key = `${String(soup[at])},${String(soup[at + 1])},${String(soup[at + 2])}`
      let index = unique.get(key)
      if (index === undefined) {
        index = unique.size
        unique.set(key, index)
        positions[index * 3] = soup[at] ?? 0
        positions[index * 3 + 1] = soup[at + 1] ?? 0
        positions[index * 3 + 2] = soup[at + 2] ?? 0
      }
      indices.push(index)
    }
    expect(unique.size).toBe(8)
    expect(meshMetrics(positions, indices)).toEqual(meshMetrics(soup, null))
  })

  it('reports zeroes for an empty mesh rather than infinities', () => {
    const metrics = meshMetrics(new Float32Array(0), null)
    expect(metrics).toEqual({ triangles: 0, area: 0, volume: 0, extents: [0, 0, 0] })
  })
})

describe('fidelity', () => {
  const source = meshMetrics(box(10, 10, 10), null)

  it('reports no error against itself', () => {
    const quality = fidelity(source, source)
    expect(quality.areaError).toBe(0)
    expect(quality.bboxDelta).toBe(0)
    expect(quality.acceptable).toBe(true)
  })

  it('refuses a mesh whose silhouette moved, even if its area barely did', () => {
    const shrunk = meshMetrics(box(10, 10, 10 - 2 * MAX_BBOX_DELTA), null)
    const quality = fidelity(source, shrunk)
    expect(quality.bboxDelta).toBeGreaterThan(MAX_BBOX_DELTA)
    expect(quality.acceptable).toBe(false)
  })

  it('refuses a mesh that lost more area than the bar allows', () => {
    const flattened = meshMetrics(box(10, 10, 10), null)
    const quality = fidelity(source, { ...flattened, area: source.area * (1 - MAX_AREA_ERROR * 2) })
    expect(quality.areaError).toBeGreaterThan(MAX_AREA_ERROR)
    expect(quality.acceptable).toBe(false)
  })

  it('treats a zero-area source as errorless rather than dividing by it', () => {
    const empty = meshMetrics(new Float32Array(0), null)
    const quality = fidelity(empty, empty)
    expect(Number.isFinite(quality.areaError)).toBe(true)
    expect(quality.areaError).toBe(0)
  })
})
