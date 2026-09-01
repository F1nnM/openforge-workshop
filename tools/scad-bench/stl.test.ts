/**
 * Reading the output, against fixtures built here rather than rendered.
 *
 * The zero-triangle case is the one that matters: a configuration the geometry
 * refuses exits 0, writes a well-formed 84-byte STL, and does it faster than
 * anything real. Timed naively it becomes the headline.
 */
import { describe, expect, it } from 'vitest'

import { STL_FACET_BYTES, STL_HEADER_BYTES, echoedErrors, readStl, trianglesFromBytes, unknownVariables } from './stl'

/** A binary STL with `triangles` facets of zeroed geometry. */
function binaryStl(triangles: number): Uint8Array {
  const bytes = STL_HEADER_BYTES + 4 + triangles * STL_FACET_BYTES
  const data = new Uint8Array(bytes)
  new DataView(data.buffer).setUint32(STL_HEADER_BYTES, triangles, true)
  return data
}

describe('readStl', () => {
  it('reads the triangle count from bytes 80–83', () => {
    const parsed = readStl(binaryStl(6488))
    expect(parsed.ok && parsed.summary.triangles).toBe(6488)
  })

  it('reports the byte count alongside it', () => {
    const parsed = readStl(binaryStl(12))
    expect(parsed.ok && parsed.summary.bytes).toBe(684)
  })

  it('refuses zero triangles even though the file is well-formed', () => {
    const parsed = readStl(binaryStl(0))
    expect(parsed.ok).toBe(false)
    expect(!parsed.ok && parsed.reason).toMatch(/Exit code 0 does not mean it rendered/)
  })

  it('refuses ASCII STL, so a lost --export-format=binstl is an error not a slowdown', () => {
    const ascii = new TextEncoder().encode('solid OpenSCAD_Model\n  facet normal 0 0 0\n')
    const parsed = readStl(ascii)
    expect(parsed.ok).toBe(false)
    expect(!parsed.ok && parsed.reason).toMatch(/ASCII STL/)
  })

  it('refuses a truncated file rather than reporting its header count', () => {
    const parsed = readStl(binaryStl(100).subarray(0, 500))
    expect(parsed.ok).toBe(false)
    expect(!parsed.ok && parsed.reason).toMatch(/truncated/)
  })

  it('refuses something too short to be a header at all', () => {
    expect(readStl(new Uint8Array(10)).ok).toBe(false)
  })

  it('reads a view into a larger buffer correctly', () => {
    const backing = new Uint8Array(4096)
    const stl = binaryStl(7)
    backing.set(stl, 1000)
    const parsed = readStl(backing.subarray(1000, 1000 + stl.length))
    expect(parsed.ok && parsed.summary.triangles).toBe(7)
  })
})

describe("the plan's byte formula", () => {
  it('agrees with the header count on a real-shaped file', () => {
    // 6,488 triangles measured for bases-square 4x4 openlock+flex.
    expect(trianglesFromBytes(324_484)).toBe(6488)
  })

  it('is the same quantity the header carries, for every size', () => {
    for (const triangles of [1, 12, 3140, 6488, 86_144]) {
      const data = binaryStl(triangles)
      expect(trianglesFromBytes(data.length)).toBe(triangles)
    }
  })
})

describe('the echo error channel', () => {
  it('finds the ERROR the .scad files echo, since there is no assert() in the set', () => {
    const stderr = 'ECHO: "ERROR: dragonlock is only compatible with inch basis"\nGeometries in cache: 1\n'
    expect(echoedErrors(stderr)).toEqual(['ECHO: "ERROR: dragonlock is only compatible with inch basis"'])
  })

  it('finds a bare ERROR: line too', () => {
    expect(echoedErrors('ERROR: something broke\n')).toHaveLength(1)
  })

  it('is quiet on a clean render', () => {
    expect(echoedErrors('Total rendering time: 0:00:00.061\nECHO: "flex_magnetic"\n')).toEqual([])
  })
})

describe('unknown-variable warnings', () => {
  const stderr = [
    'WARNING: Ignoring unknown variable "DUAL" in file connectors.scad, line 25',
    'WARNING: Ignoring unknown variable "DUAL" in file connectors.scad, line 137',
    'WARNING: Ignoring unknown variable "OTHER" in file x.scad, line 1',
  ].join('\n')

  it('counts occurrences per name', () => {
    expect(unknownVariables(stderr)).toEqual([
      { name: 'DUAL', occurrences: 2 },
      { name: 'OTHER', occurrences: 1 },
    ])
  })

  it('sorts by occurrences so the loudest is first', () => {
    expect(unknownVariables(stderr)[0]?.name).toBe('DUAL')
  })

  it('is empty when there are none', () => {
    expect(unknownVariables('all good\n')).toEqual([])
  })
})
