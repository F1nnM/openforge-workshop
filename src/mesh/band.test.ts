/// <reference types="node" />
/**
 * The band, checked against the pipeline that measured it.
 *
 * Four constants are duplicated from `tools/lod/mesh.ts` because `tools/` is
 * outside the app's TypeScript program. A duplicated constant with no guard is
 * a divergence waiting to happen, so this test reads the tool's source and
 * asserts each one — which makes a change on either side fail a run instead of
 * quietly producing browser-converted meshes at a different size from the ones
 * the `/lod/` backfill will eventually serve.
 *
 * Reading source text rather than importing is deliberate and is the only thing
 * available: the import is what TS6307 refuses.
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { LOD_MAX_TRIANGLES, LOD_MIN_TRIANGLES } from '@/builder/three'

import { KEEP_FRACTION, MAX_TRIANGLES, MIN_TRIANGLES, SIMPLIFY_ERROR, isPassThrough, targetTriangles } from './band'

const TOOL = readFileSync('tools/lod/mesh.ts', 'utf8')

describe('the band agrees with tools/lod/mesh.ts', () => {
  it('matches all four numbers, read from its source', () => {
    expect(TOOL).toContain('export const MIN_TRIANGLES = 5_000')
    expect(MIN_TRIANGLES).toBe(5_000)
    expect(TOOL).toContain('export const MAX_TRIANGLES = 20_000')
    expect(MAX_TRIANGLES).toBe(20_000)
    expect(TOOL).toContain('export const KEEP_FRACTION = 0.01')
    expect(KEEP_FRACTION).toBe(0.01)
    expect(TOOL).toContain('export const SIMPLIFY_ERROR = 0.05')
    expect(SIMPLIFY_ERROR).toBe(0.05)
  })

  it('matches the app-side copies in src/builder/three/lod.ts too', () => {
    // Three declarations of the same two numbers now exist: the tool's, the
    // `/lod/` contract module's, and this one. That is two duplications, both
    // forced by the program boundary, and this is where they meet.
    expect(LOD_MIN_TRIANGLES).toBe(MIN_TRIANGLES)
    expect(LOD_MAX_TRIANGLES).toBe(MAX_TRIANGLES)
  })
})

describe('targetTriangles', () => {
  it('passes a mesh already inside the band through untouched', () => {
    expect(isPassThrough(118)).toBe(true)
    expect(targetTriangles(118)).toBe(118)
    expect(targetTriangles(20_000)).toBe(20_000)
    expect(isPassThrough(20_001)).toBe(false)
  })

  it('lands the corpus median on the floor and its heaviest mesh on the ceiling', () => {
    // 215,314 triangles is the median distinct mesh, from the 84 + 50n identity
    // over the emitted index; 2,178,242 is the boss door, the heaviest.
    expect(targetTriangles(215_314)).toBe(MIN_TRIANGLES)
    expect(targetTriangles(2_178_242)).toBe(MAX_TRIANGLES)
    // And the crossover: 1% of source becomes the binding constraint between
    // the two, which is the whole reason the band is a band.
    expect(targetTriangles(1_000_000)).toBe(10_000)
  })
})
