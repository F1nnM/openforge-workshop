/**
 * The fixtures are what they claim to be.
 *
 * Both assertions here are provenance checks rather than behaviour: a fixture
 * that has drifted from the bucket would make every number in `decimate.ts`'s
 * docblock quietly wrong, and the reconstructed 84-byte object is only useful if
 * it is byte-identical to the real one.
 */
import { describe, expect, it } from 'vitest'

import { md5Hex } from '../fetch'

import { EMPTY_BLOB, FIXTURE_BLOB, FIXTURE_BYTES, FIXTURE_TRIANGLES, emptyStl, fixtureStl } from './wall'
import { parseStl } from '../../../src/three/stl/parse'

describe('wall-8180da93.stl', () => {
  it('is the bucket object, byte for byte', () => {
    const bytes = fixtureStl()
    expect(bytes.byteLength).toBe(FIXTURE_BYTES)
    expect(md5Hex(bytes)).toBe(FIXTURE_BLOB)
  })

  it('holds the facets PROVENANCE.md claims', () => {
    const parsed = parseStl(fixtureStl())
    expect(parsed.format).toBe('binary')
    expect(parsed.triangles).toBe(FIXTURE_TRIANGLES)
    expect(parsed.dropped).toBe(0)
  })
})

describe('the 84-byte zero-facet object', () => {
  it('reconstructs byte-exactly, so no binary needs checking in', () => {
    const bytes = emptyStl()
    expect(bytes.byteLength).toBe(84)
    expect(md5Hex(bytes)).toBe(EMPTY_BLOB)
  })

  it('parses cleanly to an empty mesh rather than throwing', () => {
    const parsed = parseStl(emptyStl())
    expect(parsed.format).toBe('binary')
    expect(parsed.triangles).toBe(0)
  })
})
