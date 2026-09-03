/// <reference types="node" />
/**
 * The conversion, end to end, on the real fixture and on a mesh big enough to
 * need simplifying.
 *
 * Both halves matter and they exercise different code: the 118-triangle wall is
 * a **pass-through** — it is already inside the band, so nothing is simplified
 * and the assertion is that nothing is *lost* — and the 39,762-triangle lattice
 * crosses the ceiling, so it goes through `MeshoptSimplifier` and the retry
 * loop and the compaction.
 *
 * The compaction is the assertion worth pointing at. `MeshoptSimplifier.simplify`
 * returns indices into the **original** vertex array, so a mesh simplified from
 * 20,164 vertices to 3,000 still carries 20,164 positions unless they are
 * compacted out — 242 kB of them, in a record whose whole point is to be 58 kB.
 * Nothing fails if that step is skipped; the cache just quietly holds the source
 * vertex buffer. So the vertex count is asserted against the *index range*, not
 * merely against the triangle count.
 */
import { readFileSync } from 'node:fs'

import { beforeAll, describe, expect, it } from 'vitest'

import { MAX_TRIANGLES, MIN_TRIANGLES } from './band'
import { EmptyMeshError, convertStl, ready, simplifierSupported } from './convert'
import { WALL_FIXTURE_TRIANGLES, WALL_FIXTURE_WELD, WALL_FIXTURE_PATH, binaryStl, grid } from './fixtures'

function wallStl(): Uint8Array {
  const bytes = readFileSync(WALL_FIXTURE_PATH)
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

beforeAll(async () => {
  await ready()
})

describe('the simplifier', () => {
  it('is available in this environment', () => {
    // If this fails, every assertion below is meaningless rather than failing on
    // its own terms — meshoptimizer's wasm is a plain `WebAssembly.Instance`
    // over an inlined base64 module, so it works in Node, in a worker and in a
    // browser alike, and the row depends on that.
    expect(simplifierSupported()).toBe(true)
  })
})

describe('a mesh already inside the band', () => {
  it('passes through with its geometry intact', async () => {
    const converted = await convertStl(wallStl())

    expect(converted.sourceTriangles).toBe(WALL_FIXTURE_TRIANGLES)
    expect(converted.passThrough).toBe(true)
    expect(converted.attempts).toBe(0)
    expect(converted.triangles).toBe(WALL_FIXTURE_TRIANGLES)
    expect(converted.vertices).toBe(WALL_FIXTURE_WELD.after)
    expect(converted.weld.ratio).toBeCloseTo(0.1667, 4)
    // Nothing was simplified, so nothing was lost. Exactly zero, not "small".
    expect(converted.areaError).toBe(0)
    expect(converted.extentError).toBe(0)
    expect(converted.format).toBe('binary')
    expect(converted.droppedTriangles).toBe(0)
  })

  it('keeps the mesh in millimetres, with no node transform to undo', async () => {
    const converted = await convertStl(wallStl())
    let min = Infinity
    let max = -Infinity
    for (const value of converted.positions) {
      if (value < min) min = value
      if (value > max) max = value
    }
    // The fixture is a 25.4 mm OpenForge wall. `loadLod.ts` has to bake a
    // 12.7× node scale out of the `/lod/` GLB to get here; this path arrives
    // already in millimetres, which is the difference the two loaders exist to
    // hide from their consumer.
    expect(max - min).toBeGreaterThan(10)
    expect(max - min).toBeLessThan(60)
  })
})

describe('a mesh over the ceiling', () => {
  it('lands inside the band and compacts the vertices it stopped using', async () => {
    const source = grid(141)
    const converted = await convertStl(binaryStl(source))

    expect(converted.sourceTriangles).toBe(39_762)
    expect(converted.passThrough).toBe(false)
    expect(converted.triangles).toBeLessThanOrEqual(MAX_TRIANGLES)
    expect(converted.triangles).toBeGreaterThan(0)
    // 1% of 39,762 is 398, which clamps up to the floor.
    expect(converted.target).toBe(MIN_TRIANGLES)

    // The compaction assertion. Every index must address a vertex that exists,
    // and the vertex array must be no larger than the highest index needs — a
    // skipped compaction leaves 20,164 vertices behind a 3,000-triangle index.
    let highest = 0
    for (const index of converted.indices) if (index > highest) highest = index
    expect(converted.vertices).toBe(highest + 1)
    expect(converted.positions.length).toBe(converted.vertices * 3)
    expect(converted.vertices).toBeLessThan(20_164)
  })

  it('produces a record small enough to be worth caching', async () => {
    const converted = await convertStl(binaryStl(grid(141)))
    const bytes = converted.positions.byteLength + converted.indices.byteLength
    // The source STL is 1.79 MB. Anything over ~200 kB here means the band or
    // the compaction is not doing its job.
    expect(bytes).toBeLessThan(200_000)
    expect(converted.sourceBytes).toBeGreaterThan(1_500_000)
  })

  it('keeps the silhouette, and reports how far it moved', async () => {
    const converted = await convertStl(binaryStl(grid(141)))
    // `tools/lod/mesh.ts` treats 5% of surface area and 0.5 mm of bounding box
    // as the lines above which a LOD stops looking like the tile. A displaced
    // heightfield is harder to decimate than a sculpted wall, so this is a
    // generous bound on a hard case rather than a tight one on an easy one.
    expect(converted.areaError).toBeLessThan(0.25)
    expect(converted.extentError).toBeLessThan(0.5)
  })

  it('records the split timing, so a slow phase is identifiable', async () => {
    const converted = await convertStl(binaryStl(grid(141)))
    expect(converted.timing.parseMs).toBeGreaterThan(0)
    expect(converted.timing.weldMs).toBeGreaterThan(0)
    expect(converted.timing.simplifyMs).toBeGreaterThan(0)
  })
})

describe('the refusals', () => {
  it('refuses a valid STL with no facets rather than caching an empty mesh', async () => {
    // The corpus's smallest file is 84 bytes: a valid binary header declaring
    // zero facets. `parse.ts` reads it cleanly and this row must not store it,
    // because an empty geometry in the cache is indistinguishable from a
    // successful conversion at every layer above.
    await expect(convertStl(binaryStl(new Float32Array(0)))).rejects.toThrow(EmptyMeshError)
  })

  it('refuses bytes that are not STL', async () => {
    await expect(convertStl(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(/matching neither/)
  })
})
