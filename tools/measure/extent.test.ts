/**
 * The bounding box, and the stride estimator against meshes whose answer is
 * arithmetic.
 *
 * The stride tests are the ones that matter: they are the evidence that
 * `architecture-plan.md` §14's "sub-0.03 mm" claim needed measuring rather than
 * quoting. A synthetic mesh with a single facet reaching out to a known distance
 * gives an error that is exactly predictable — which is the only way to know the
 * estimator itself is right before pointing it at 1,163 real meshes.
 */
import { describe, expect, it } from 'vitest'

import { MM_PER_UNIT, boundingBox, extentOf, round, roundVec, strideError } from './extent'
import { annularSectorMesh, boxMesh, positionsOf, spikeMesh } from './fixtures/mesh'
import { parseStl } from '../../src/three/stl/parse'
import { binaryStl } from './fixtures/mesh'

describe('boundingBox', () => {
  it('is the exact box of a known box mesh, in mm and in catalog units', () => {
    const mesh = boxMesh([0, 0, 0], [101.6, 50.8, 12.7])
    const box = boundingBox(positionsOf(mesh), mesh.length, 1)
    expect(box).toBeDefined()
    expect(roundVec(box!.minMm)).toEqual([0, 0, 0])
    expect(roundVec(box!.maxMm)).toEqual([101.6, 50.8, 12.7])
    expect(roundVec(box!.sizeUnits)).toEqual([4, 2, 0.5])
    expect(box!.facets).toBe(mesh.length)
  })

  it('is not confused by a negative origin', () => {
    const mesh = boxMesh([-50.8, -12.7, -3], [50.8, 12.7, 3])
    const box = boundingBox(positionsOf(mesh), mesh.length, 1)
    expect(roundVec(box!.sizeUnits)).toEqual([4, 1, round(6 / MM_PER_UNIT)])
  })

  it('returns undefined for a facet-less mesh rather than a box at the origin', () => {
    // The corpus's smallest file is an 84-byte binary header declaring zero
    // facets. It is valid STL, it has no extent, and "not measurable" is not
    // the same claim as "zero size".
    const parsed = parseStl(binaryStl([]))
    expect(parsed.triangles).toBe(0)
    expect(extentOf(parsed)).toBeUndefined()
  })

  it('rejects a non-integer or non-positive stride', () => {
    const mesh = boxMesh([0, 0, 0], [1, 1, 1])
    const positions = positionsOf(mesh)
    expect(() => boundingBox(positions, mesh.length, 0)).toThrow(RangeError)
    expect(() => boundingBox(positions, mesh.length, 1.5)).toThrow(RangeError)
  })
})

describe('strideError', () => {
  it('reports exactly the distance of the extreme it skipped', () => {
    // 100 facets of a unit triangle, except facet 37 which reaches to x = 500.
    // A stride of 2, 4 or 8 never lands on 37; a stride of 37 does.
    const mesh = spikeMesh(100, 37, 500)
    const positions = positionsOf(mesh)

    for (const stride of [2, 4, 8]) {
      const error = strideError(positions, mesh.length, stride)
      expect(error?.maxFaceErrorMm).toBeCloseTo(499, 5)
      expect(error?.sizeErrorMm[0]).toBeCloseTo(499, 5)
    }

    const hit = strideError(positions, mesh.length, 37)
    expect(hit?.maxFaceErrorMm).toBe(0)
  })

  it('is zero for a stride of 1, by construction', () => {
    const mesh = spikeMesh(64, 5, 300)
    const error = strideError(positionsOf(mesh), mesh.length, 1)
    expect(error?.maxFaceErrorMm).toBe(0)
    expect(error?.facets).toBe(64)
  })

  it('never reports a box larger than the exact one — a subsample can only shrink it', () => {
    // A tessellated sector puts its extremes on the arcs, so a stride loses
    // outer radius before it loses anything else. Whatever it loses, the error
    // is a shrinkage: this is what makes the calibration table a *bound*.
    const mesh = annularSectorMesh({ innerRadiusMm: 50.8, outerRadiusMm: 101.6, sweepDeg: 90 })
    const positions = positionsOf(mesh)
    const exact = boundingBox(positions, mesh.length, 1)

    for (const stride of [2, 3, 7, 16]) {
      const sampled = boundingBox(positions, mesh.length, stride)
      expect(sampled).toBeDefined()
      for (let axis = 0; axis < 3; axis += 1) {
        expect(sampled!.minMm[axis]).toBeGreaterThanOrEqual(exact!.minMm[axis]! - 1e-9)
        expect(sampled!.maxMm[axis]).toBeLessThanOrEqual(exact!.maxMm[axis]! + 1e-9)
      }
      expect(strideError(positions, mesh.length, stride)?.maxFaceErrorMm).toBeGreaterThanOrEqual(0)
    }
  })

  it('counts the facets it actually sampled', () => {
    const mesh = spikeMesh(100, 1, 2)
    expect(strideError(positionsOf(mesh), mesh.length, 10)?.facets).toBe(10)
    expect(strideError(positionsOf(mesh), mesh.length, 3)?.facets).toBe(34)
  })
})

describe('units', () => {
  it('is 25.4 mm per catalog unit, from the schema and not a local copy', () => {
    expect(MM_PER_UNIT).toBe(25.4)
  })
})
