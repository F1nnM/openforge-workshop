/**
 * Geometry construction: the normals, the normalisation, and the empty file.
 */
import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'

import { VIEW_RADIUS, buildModelGeometry, disposeGeometry, gridUnits } from './geometry'
import { parseStl } from './stl/parse'
import { EMPTY_BINARY_STL, TILE_FACETS, asciiStl, binaryStl, box } from './stl/fixtures'

function geometryOf(bytes: Uint8Array) {
  return buildModelGeometry(parseStl(bytes))
}

describe('buildModelGeometry', () => {
  it('builds a non-indexed geometry with three vertices per triangle', () => {
    const model = geometryOf(binaryStl(TILE_FACETS))

    expect(model.triangles).toBe(12)
    expect(model.geometry.index).toBe(null)
    expect(model.geometry.getAttribute('position').count).toBe(36)
  })

  it('recomputes normals from the winding, ignoring the file’s', () => {
    // The fixture writes a facet normal of +Z on a facet whose winding faces −Z.
    // Trusting the file would give +Z; recomputation gives −Z.
    const facets = [
      {
        corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0]] as const,
        normal: [0, 0, 1] as const,
      },
    ]
    const model = buildModelGeometry(parseStl(binaryStl(facets)))
    const normals = model.geometry.getAttribute('normal')

    expect(normals.count).toBe(3)
    expect(normals.getZ(0)).toBeCloseTo(-1, 5)
  })

  it('gives each triangle one flat normal — the same on all three corners', () => {
    const model = geometryOf(binaryStl(TILE_FACETS))
    const normals = model.geometry.getAttribute('normal')

    for (let facet = 0; facet < 12; facet += 1) {
      const first = new Vector3().fromBufferAttribute(normals, facet * 3)
      for (let corner = 1; corner < 3; corner += 1) {
        const other = new Vector3().fromBufferAttribute(normals, facet * 3 + corner)
        expect(other.distanceTo(first)).toBeCloseTo(0, 6)
      }
      expect(first.length()).toBeCloseTo(1, 5)
    }
  })

  it('centres the mesh on the origin and scales it to the view radius', () => {
    const model = geometryOf(binaryStl(box(25.4, 25.4, 6)))
    const sphere = model.geometry.boundingSphere

    expect(sphere).not.toBe(null)
    expect(sphere?.radius).toBeCloseTo(VIEW_RADIUS, 5)
    expect(sphere?.center.length()).toBeCloseTo(0, 5)
  })

  it('reports the pre-scale extents in the file’s own units', () => {
    const model = geometryOf(binaryStl(box(101.6, 12.7, 4.5)))

    expect(model.extents[0]).toBeCloseTo(101.6, 3)
    expect(model.extents[1]).toBeCloseTo(12.7, 3)
    expect(model.extents[2]).toBeCloseTo(4.5, 3)
    expect(model.scale).toBeLessThan(1)
    expect(model.radius).toBeGreaterThan(50)
  })

  it('normalises a huge and a tiny mesh to the same radius, which is what AO needs', () => {
    const tiny = geometryOf(binaryStl(box(1, 1, 1)))
    const huge = geometryOf(binaryStl(box(300, 300, 300)))

    expect(tiny.geometry.boundingSphere?.radius).toBeCloseTo(
      huge.geometry.boundingSphere?.radius ?? 0,
      5,
    )
  })

  it('reaches the same geometry from the ASCII encoding', () => {
    const facets = box(25.4, 25.4, 6)
    const fromBinary = geometryOf(binaryStl(facets))
    const fromAscii = geometryOf(asciiStl(facets))

    expect(fromAscii.triangles).toBe(fromBinary.triangles)
    expect(fromAscii.geometry.boundingSphere?.radius).toBeCloseTo(
      fromBinary.geometry.boundingSphere?.radius ?? 0,
      4,
    )
  })
})

describe('the 84-byte zero-triangle file', () => {
  it('produces an empty geometry with a real bounding sphere, not a NaN one', () => {
    const model = buildModelGeometry(parseStl(EMPTY_BINARY_STL))

    expect(model.empty).toBe(true)
    expect(model.triangles).toBe(0)
    expect(model.geometry.boundingSphere?.radius).toBe(0)
    expect(Number.isNaN(model.geometry.boundingSphere?.center.x ?? NaN)).toBe(false)
  })

  it('does not divide by the zero radius', () => {
    const model = buildModelGeometry(parseStl(EMPTY_BINARY_STL))
    expect(model.scale).toBe(1)
    expect(model.extents).toEqual([0, 0, 0])
  })

  it('survives what three.js would otherwise do to it', () => {
    // The failure this guards: an unset bounding box on an empty geometry leaves
    // ±Infinity, `getCenter()` yields NaN, and a NaN bounding sphere disables
    // culling and raycasting with no warning anywhere.
    const model = buildModelGeometry(parseStl(EMPTY_BINARY_STL))
    model.geometry.computeBoundingSphere()
    expect(Number.isFinite(model.geometry.boundingSphere?.radius ?? NaN)).toBe(true)
  })
})

describe('a degenerate single-point mesh', () => {
  it('has no scale that helps, and does not produce Infinity', () => {
    const model = buildModelGeometry(
      parseStl(binaryStl([{ corners: [[2, 2, 2], [2, 2, 2], [2, 2, 2]] as const }])),
    )
    expect(model.scale).toBe(1)
    expect(Number.isFinite(model.geometry.boundingSphere?.radius ?? NaN)).toBe(true)
  })
})

describe('gridUnits', () => {
  it('converts the archive’s millimetres to §2’s 25.4 mm grid', () => {
    expect(gridUnits(25.4)).toBeCloseTo(1, 6)
    expect(gridUnits(101.6)).toBeCloseTo(4, 6)
    // The wall thickness the median tile measured: half a unit.
    expect(gridUnits(12.7)).toBeCloseTo(0.5, 6)
  })
})

describe('disposeGeometry', () => {
  it('disposes what it was given, and tolerates nothing', () => {
    const model = geometryOf(binaryStl(TILE_FACETS))
    let disposed = 0
    model.geometry.addEventListener('dispose', () => {
      disposed += 1
    })

    disposeGeometry(model.geometry)
    disposeGeometry(null)
    disposeGeometry(undefined)

    expect(disposed).toBe(1)
  })
})
