/**
 * The parser, both formats, and the four files that break naive parsers.
 */
import { describe, expect, it } from 'vitest'

import {
  BINARY_HEADER_BYTES,
  StlParseError,
  detectStlFormat,
  parseStl,
} from './parse'
import { EMPTY_BINARY_STL, TILE_FACETS, asciiStl, binaryStl, box } from './fixtures'

describe('detectStlFormat', () => {
  it('reads a binary file from the facet-count arithmetic', () => {
    expect(detectStlFormat(binaryStl(box(2, 2, 2)))).toBe('binary')
  })

  it('still reads it as binary when the header text starts with "solid"', () => {
    // The trap: a `startsWith('solid')` sniff calls this ASCII and then parses
    // 84 bytes of float noise as text, producing an empty mesh with no error.
    const bytes = binaryStl(box(1, 1, 1), { header: 'solid produced by some exporter' })
    expect(detectStlFormat(bytes)).toBe('binary')
    expect(parseStl(bytes).format).toBe('binary')
  })

  it('reads a text file from its delimited `solid` header', () => {
    expect(detectStlFormat(asciiStl(box(1, 1, 1)))).toBe('ascii')
  })

  it('refuses bytes that are neither', () => {
    expect(detectStlFormat(new TextEncoder().encode('solidarity is not a mesh'))).toBe(null)
  })
})

describe('the 84-byte zero-triangle file', () => {
  it('is exactly 84 bytes and is recognised as binary', () => {
    expect(EMPTY_BINARY_STL.byteLength).toBe(BINARY_HEADER_BYTES)
    expect(detectStlFormat(EMPTY_BINARY_STL)).toBe('binary')
  })

  it('parses without throwing, to zero triangles', () => {
    const parsed = parseStl(EMPTY_BINARY_STL)
    expect(parsed.triangles).toBe(0)
    expect(parsed.positions).toHaveLength(0)
    expect(parsed.dropped).toBe(0)
    expect(parsed.sourceBytes).toBe(84)
  })
})

describe('binary', () => {
  it('reads every vertex exactly, skipping the stored normal', () => {
    const facets = [
      { corners: [[1, 2, 3], [4, 5, 6], [7, 8, 9]] as const, normal: [9, 9, 9] as const },
    ]
    const parsed = parseStl(binaryStl(facets))

    expect(parsed.triangles).toBe(1)
    expect([...parsed.positions]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('reads a 12-facet box to 36 vertices', () => {
    const parsed = parseStl(binaryStl(TILE_FACETS))
    expect(parsed.triangles).toBe(12)
    expect(parsed.positions).toHaveLength(12 * 9)
  })

  it('owns its buffer, so the worker can transfer it', () => {
    const parsed = parseStl(binaryStl(TILE_FACETS))
    expect(parsed.positions.byteOffset).toBe(0)
    expect(parsed.positions.buffer.byteLength).toBe(parsed.positions.byteLength)
  })

  it('names a truncated file as truncated rather than unrecognised', () => {
    const bytes = binaryStl(box(1, 1, 1), { declaredFacets: 999 })
    expect(() => parseStl(bytes)).toThrow(StlParseError)
    try {
      parseStl(bytes)
    } catch (error) {
      expect((error as StlParseError).kind).toBe('truncated')
      expect((error as StlParseError).message).toContain('999 facets')
    }
  })
})

describe('ascii', () => {
  it('parses to the same geometry as the binary encoding of the same box', () => {
    const facets = box(25.4, 25.4, 6)
    const fromAscii = parseStl(asciiStl(facets))
    const fromBinary = parseStl(binaryStl(facets))

    expect(fromAscii.format).toBe('ascii')
    expect(fromAscii.triangles).toBe(fromBinary.triangles)
    expect(fromAscii.positions).toHaveLength(fromBinary.positions.length)
    for (let index = 0; index < fromBinary.positions.length; index += 1) {
      expect(fromAscii.positions[index]).toBeCloseTo(fromBinary.positions[index] ?? NaN, 4)
    }
  })

  it('does not take the word "vertex" in a solid name for a corner', () => {
    // `solid vertex_test` contains `vertex`; an indexOf-driven parser that does
    // not check delimiters gains a phantom corner and shifts every triangle.
    const facets = box(2, 2, 2)
    const parsed = parseStl(asciiStl(facets, 'vertex_test'))
    expect(parsed.triangles).toBe(facets.length)
  })

  it('drops a trailing partial facet rather than misassembling the mesh', () => {
    const text = new TextDecoder().decode(asciiStl(box(1, 1, 1)))
    const truncated = `${text.slice(0, text.indexOf('endsolid'))}  facet normal 0 0 0\n    outer loop\n      vertex 1 1 1\n`
    const parsed = parseStl(new TextEncoder().encode(truncated))
    expect(parsed.triangles).toBe(12)
  })

  it('grows past a low capacity guess', () => {
    // 400 facets in a compact encoding, so the initial length/250 estimate is
    // short and the doubling path runs.
    const many = Array.from({ length: 400 }, (_, index) => ({
      corners: [[index, 0, 0], [index, 1, 0], [index, 0, 1]] as const,
    }))
    expect(parseStl(asciiStl(many)).triangles).toBe(400)
  })
})

describe('non-finite coordinates', () => {
  it('drops the whole triangle and reports the count', () => {
    const facets = [
      { corners: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] as const },
      { corners: [[0, 0, 0], [Number.NaN, 0, 0], [0, 1, 0]] as const },
      { corners: [[0, 0, 1], [1, 0, 1], [0, 1, 1]] as const },
    ]
    const parsed = parseStl(binaryStl(facets))

    expect(parsed.triangles).toBe(2)
    expect(parsed.dropped).toBe(1)
    expect([...parsed.positions].every(Number.isFinite)).toBe(true)
  })

  it('drops an infinity too', () => {
    const parsed = parseStl(
      binaryStl([{ corners: [[0, 0, 0], [Number.POSITIVE_INFINITY, 0, 0], [0, 1, 0]] as const }]),
    )
    expect(parsed.triangles).toBe(0)
    expect(parsed.dropped).toBe(1)
  })
})
