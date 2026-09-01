/**
 * The real-mesh fixture, and the figures it pins.
 *
 * Kept apart from `mkfixture.ts` so a test can import the path and the constants
 * without pulling in a script that hits the network. See `PROVENANCE.md`.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** md5 of the fixture mesh, which is also its content address in the bucket. */
export const FIXTURE_BLOB = '8180da93549154744c37f8370a82738f'

export const FIXTURE_PATH = join(HERE, 'wall-8180da93.stl')

/** Bytes of the source object. */
export const FIXTURE_BYTES = 5_984

/** Facets the binary header declares. */
export const FIXTURE_TRIANGLES = 118

/**
 * Vertex counts either side of `weld()` on this mesh, positions only.
 *
 * 354 → 59, i.e. 0.1667×. The same ratio, to within 0.0003, as every other mesh
 * measured across the corpus — see `decimate.ts`.
 */
export const FIXTURE_WELD = { before: 354, after: 59 } as const

/** The fixture's bytes. */
export function fixtureStl(): Buffer {
  return readFileSync(FIXTURE_PATH)
}

/* ------------------------------------------------------ the degenerate object */

/**
 * The corpus's smallest file: **84 bytes of valid binary STL declaring zero
 * facets**, exported by Blender 4.0.1 and served under
 * `models/489242/4892426c4728448564f2e13b048eea45.stl`.
 *
 * It is reconstructed rather than checked in because its 84 bytes are entirely
 * described by one header string and a zero — and `wall.test.ts` proves the
 * reconstruction is byte-exact by hashing it back to {@link EMPTY_BLOB}. It has
 * to be in the tests because it is the one file that must be *reported* rather
 * than crashed on or shipped: `src/three/gate.ts` already refuses 3D for it, and
 * an empty GLB filed under its key would be worse than no object.
 */
export const EMPTY_BLOB = '4892426c4728448564f2e13b048eea45'

/** The 80-byte header Blender wrote, before the zero facet count. */
export const EMPTY_HEADER = 'Exported from Blender-4.0.1'

/** Byte-exact reconstruction of that object. */
export function emptyStl(): Uint8Array {
  const bytes = new Uint8Array(84)
  new TextEncoder().encodeInto(EMPTY_HEADER, bytes.subarray(0, 80))
  // Offset 80 is the uint32 facet count, and it is already zero.
  return bytes
}
