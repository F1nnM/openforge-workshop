/// <reference types="node" />
/**
 * The weld, and the trap it exists to avoid.
 *
 * The interesting assertions here are the two that would pass vacuously if
 * written carelessly, so both are pinned to numbers measured elsewhere:
 *
 *   - **0.1667 on real geometry.** Not "the ratio is below the limit" — G1
 *     measured 354 corners → 59 vertices on this exact file, so the test asserts
 *     59, exactly. A weld that merged nothing would give 354; one that merged
 *     too aggressively would give fewer.
 *   - **The trap fires.** {@link assertWeldDropped} is checked against the real
 *     numbers from the pipeline's table — 326 of 354 for a normals-included
 *     weld, 0.921× — so the guard is exercised with the actual failure it is
 *     for, not with a fabricated 1.0.
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { parseStl } from '@/three/stl/parse'

import { WALL_FIXTURE_TRIANGLES, WALL_FIXTURE_WELD, WALL_FIXTURE_PATH, binaryStl, facetNormals, grid } from './fixtures'
import { WELD_ASSERT_MIN_TRIANGLES, WELD_MAX_RATIO, WeldNoOpError, assertWeldDropped, weldPositions } from './weld'

function wallSoup(): Float32Array {
  const bytes = readFileSync(WALL_FIXTURE_PATH)
  return parseStl(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)).positions
}

describe('welding real catalog geometry', () => {
  it('reaches the vertex count G1 measured, exactly', () => {
    const soup = wallSoup()
    expect(soup.length / 9).toBe(WALL_FIXTURE_TRIANGLES)

    const welded = weldPositions(soup)
    expect(welded.report.before).toBe(WALL_FIXTURE_WELD.before)
    expect(welded.report.after).toBe(WALL_FIXTURE_WELD.after)
    expect(welded.report.ratio).toBeCloseTo(0.1667, 4)
    expect(welded.positions.length).toBe(WALL_FIXTURE_WELD.after * 3)
    expect(welded.indices.length).toBe(WALL_FIXTURE_TRIANGLES * 3)
  })

  it('keeps the geometry the same shape it was', () => {
    const soup = wallSoup()
    const welded = weldPositions(soup)

    // Every corner, dereferenced through the index, is bitwise the coordinate it
    // was in the soup. This is the assertion that a weld which merged the wrong
    // vertices would fail: the ratio alone cannot tell a correct weld from one
    // that collapsed two different corners.
    for (let corner = 0; corner < welded.indices.length; corner += 1) {
      const vertex = (welded.indices[corner] ?? 0) * 3
      for (let axis = 0; axis < 3; axis += 1) {
        expect(welded.positions[vertex + axis]).toBe(soup[corner * 3 + axis])
      }
    }
  })

  it('welds a 39,762-triangle lattice at the same ratio', () => {
    const welded = weldPositions(grid(141))
    expect(welded.triangles).toBe(39_762)
    // A cells×cells lattice has (cells+1)² unique corners against 6 cells²
    // unshared ones, so the ratio is ~1/6 for the same reason a closed surface
    // is: every interior vertex is shared by six triangles.
    expect(welded.report.after).toBe(142 * 142)
    expect(welded.report.ratio).toBeLessThan(0.17)
  })
})

describe('the trap', () => {
  it('throws on the ratio a normals-included weld actually produces', () => {
    // G1's measured numbers for this fixture, from `tools/lod/decimate.ts`'s
    // table: welding position and facet normal left 326 of 354 vertices.
    expect(() => assertWeldDropped(354, 326, WELD_MAX_RATIO, 118)).toThrow(WeldNoOpError)
    expect(() => assertWeldDropped(354, 326, WELD_MAX_RATIO, 118)).toThrow(/0\.9209×/)

    // And the loosest case in that table, the one closest to passing.
    expect(() => assertWeldDropped(621_888, 474_729, WELD_MAX_RATIO, 207_296)).toThrow(WeldNoOpError)

    // The real path, on the same mesh, is nowhere near the limit.
    expect(() => assertWeldDropped(354, 59, WELD_MAX_RATIO, 118)).not.toThrow()
  })

  it('is armed by the facet normals this corpus actually carries', () => {
    // Not an argument, a measurement: read the stored normals out of the real
    // fixture and count how many distinct (position, normal) corners there are.
    // That is what `weld()` would merge on if the normals reached it.
    const bytes = readFileSync(WALL_FIXTURE_PATH)
    const stl = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const soup = parseStl(stl).positions
    const normals = facetNormals(stl)

    const withNormals = new Set<string>()
    for (let corner = 0; corner < soup.length / 3; corner += 1) {
      withNormals.add(
        [0, 1, 2].map((axis) => soup[corner * 3 + axis]).join(',') +
          '|' +
          [0, 1, 2].map((axis) => normals[corner * 3 + axis]).join(','),
      )
    }

    // 354 corners, 59 distinct positions, and this many distinct
    // position-and-normal pairs — the number that decides whether the standard
    // recipe does anything at all.
    expect(withNormals.size).toBeGreaterThan(WALL_FIXTURE_WELD.after * WELD_MAX_RATIO * 3)
    expect(() => assertWeldDropped(354, withNormals.size, WELD_MAX_RATIO, 118)).toThrow(WeldNoOpError)
  })

  it('does not fire below the assertion floor, where the ratio means nothing', () => {
    // One triangle welds 3 → 3 by definition. Asserting on it would fail every
    // run for no reason, which is why the floor exists.
    expect(() => assertWeldDropped(3, 3, WELD_MAX_RATIO, 1)).not.toThrow()
    expect(WELD_ASSERT_MIN_TRIANGLES).toBe(12)
    // A box is the smallest closed thing worth asserting on: 36 → 8, 0.22×.
    const box = weldPositions(
      new Float32Array([
        // two triangles sharing an edge, six corners, four vertices
        0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0,
      ]),
    )
    expect(box.report.after).toBe(4)
  })
})

describe('the details that would be invisible', () => {
  it('treats -0 and +0 as one vertex', () => {
    // A mesh sitting on the origin plane — which most of this corpus does — is
    // where a bitwise weld would otherwise leave two vertices at the same point.
    const soup = new Float32Array([-0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -0, -0, 1, 0, 0, 0, 1, 0])
    const welded = weldPositions(soup)
    expect(welded.report.after).toBe(3)
    expect(Object.is(welded.positions[0], -0)).toBe(false)
  })

  it('hands back arrays that own their buffers, so a transfer moves what it should', () => {
    const welded = weldPositions(grid(20))
    expect(welded.positions.byteOffset).toBe(0)
    expect(welded.positions.byteLength).toBe(welded.positions.buffer.byteLength)
    expect(welded.indices.byteOffset).toBe(0)
    expect(welded.indices.byteLength).toBe(welded.indices.buffer.byteLength)
  })

  it('parses and welds an empty STL to nothing, without throwing', () => {
    const parsed = parseStl(binaryStl(new Float32Array(0)))
    expect(parsed.triangles).toBe(0)
    const welded = weldPositions(parsed.positions)
    expect(welded.triangles).toBe(0)
    expect(welded.report.ratio).toBe(1)
  })

  it('agrees with the pipeline about the threshold, read from its source', () => {
    // The constant is duplicated because `tools/` is outside the app's
    // TypeScript program. This is what stops the duplication from drifting.
    const decimate = readFileSync('tools/lod/decimate.ts', 'utf8')
    expect(decimate).toContain('export const WELD_MIN_DROP = 0.5')
    expect(WELD_MAX_RATIO).toBe(0.5)
    expect(decimate).toContain('export const WELD_ASSERT_MIN_TRIANGLES = 12')
    expect(WELD_ASSERT_MIN_TRIANGLES).toBe(12)
  })
})
