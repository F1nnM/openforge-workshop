/// <reference types="node" />
/**
 * What the corpus says about STL *format*, which is not what the byte identity
 * says.
 *
 * `84 + 50n === byteLength` is how `src/three/stl/parse.ts#detectStlFormat`
 * decides a file is binary, and it is the right check — sniffing for a `solid`
 * header mistakes a binary header reading "solidworks" for text. But the
 * identity is a property of *binary* STL, not of this archive, and several
 * documents and one withdrawn measurement have treated the two as the same
 * thing.
 *
 * The failure is quiet in a specific way worth naming: dividing a non-binary
 * file's length by 50 yields a plausible-looking number, and integer division
 * hides the remainder that would have exposed it. So this suite pins the split
 * itself. A run fails if the archive's binary fraction moves, which is the
 * signal that a byte-derived triangle count somewhere has silently changed
 * meaning.
 *
 * Nothing here parses a mesh. These are claims about `catalog.json`'s `bytes`
 * column, checkable offline, and `src/three/stl/parse.test.ts` owns the parser.
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { CatalogFile } from '@/catalog'
import type { CatalogRecord } from '@/catalog'

const CATALOG = 'public/catalog/catalog.json'

/** The binary-STL layout: an 80-byte header, a `uint32` facet count, then 50 bytes a facet. */
const HEADER_BYTES = 84
const FACET_BYTES = 50

let cached: readonly CatalogRecord[] | undefined
function records(): readonly CatalogRecord[] {
  cached ??= CatalogFile.parse(JSON.parse(readFileSync(CATALOG, 'utf8'))).records
  return cached
}

/** Whether a byte length *could* be a binary STL — the same arithmetic `detectStlFormat` runs. */
function fitsBinaryLayout(bytes: number): boolean {
  return bytes >= HEADER_BYTES && (bytes - HEADER_BYTES) % FACET_BYTES === 0
}

describe('STL format across the corpus', () => {
  it('is binary on 88.4% of records and something else on the rest', () => {
    const all = records()
    const binary = all.filter((record) => fitsBinaryLayout(record.bytes))
    const other = all.filter((record) => !fitsBinaryLayout(record.bytes))

    expect(all).toHaveLength(8702)
    expect(binary).toHaveLength(7689)
    expect(other).toHaveLength(1013)
    expect(binary.length / all.length).toBeCloseTo(0.8836, 4)
  })

  it('concentrates the non-binary files in the generated bases', () => {
    // 999 of the 1,013 are `texture|plain`, which is what `bases.py` emits. The
    // spot-check behind this: `plain#base+s2w+square+wall.2x2.openlock.stl`
    // opens `solid ` when read from R2, so it is ASCII, and
    // `(238380 - 84) / 50 = 4765.92` — the non-integer a floor division hid.
    const other = records().filter((record) => !fitsBinaryLayout(record.bytes))
    const plain = other.filter((record) => record.texture === 'plain')

    expect(plain).toHaveLength(999)
    expect(new Set(other.map((record) => record.blob)).size).toBe(847)
    expect(new Set(other.map((record) => record.design)).size).toBe(193)
  })

  it('leaves a byte-derived triangle count exact where it applies', () => {
    // The two figures `docs/assembly-candidates.md` §3.3.1 rests on. Both divide
    // exactly; the third row it used to carry did not, and is withdrawn there.
    const byFile = new Map(records().map((record) => [record.file, record.bytes]))
    const hallway = byFile.get('plain#base+hallway.2x2.openlock.stl')
    const square = byFile.get('plain#base+square.2x2.openlock.stl')

    expect(hallway).toBe(102084)
    expect(square).toBe(282484)
    expect((Number(hallway) - HEADER_BYTES) / FACET_BYTES).toBe(2040)
    expect((Number(square) - HEADER_BYTES) / FACET_BYTES).toBe(5648)
  })

  it('carries exactly one record whose mesh has no geometry', () => {
    // `aztlan#column.col+T.side+dragonlock.stl`: 84 bytes, header
    // `Exported from Blender-4.0.1`, facet count field 0. It satisfies
    // `84 + 50 x 0`, so `detectStlFormat` calls it binary and `parseStl` returns
    // 0 triangles without an error — correct STL handling of an empty file, and
    // a piece that downloads, parses and draws nothing.
    //
    // Upstream's to fix. This asserts it stays a known singleton rather than
    // becoming a class nobody noticed forming.
    //
    // Note it is one of the 7,689 counted binary above, not one of the 1,013:
    // the first draft of this suite excluded it and every population came out
    // one record and one design short.
    const empty = records().filter((record) => record.bytes === HEADER_BYTES)

    expect(empty).toHaveLength(1)
    expect(empty[0]?.file).toBe('aztlan#column.col+T.side+dragonlock.stl')
    expect(empty[0]?.blob).toBe('4892426c4728448564f2e13b048eea45')
  })
})
