/**
 * Meshes for this directory's tests — one real, one large.
 *
 * ## Why both, and why not `tools/lod/fixtures/`
 *
 * That directory already holds the right things: `wall-8180da93.stl` is 118
 * facets of real catalog geometry with its provenance recorded, and `stl.ts`
 * builds icospheres large enough to simplify. Its **TypeScript** cannot be
 * imported from here — `tools/` is outside the app's program and a composite
 * project rejects it (TS6307, the wall rows C1, W7, X4 and X10 each hit) — but
 * its *bytes* can be read by path, and {@link WALL_FIXTURE_PATH} does exactly
 * that. So the real mesh is shared, not copied.
 *
 * What is not shared is the large one, and it needs a different property from
 * the icosphere anyway. This row's whole question is what happens above the
 * 20,000-triangle band ceiling, so the fixture has to cross it — 40,000
 * triangles at the smallest useful size — and it has to weld the way real
 * printable geometry welds, at ~1/6, or it would not exercise the simplifier at
 * all. {@link grid} is 24 lines and does both. Checking a 2 MB STL into git to
 * avoid them would be the worse trade.
 *
 * Nothing here imports `node:` anything, so this file is a plain module and the
 * one test that needs the real bytes reads them itself.
 */

/** Path of `tools/lod/fixtures/wall-8180da93.stl`, relative to the repo root. */
export const WALL_FIXTURE_PATH = 'tools/lod/fixtures/wall-8180da93.stl'

/** Its facet count, and the weld G1 measured on it: 354 corners → 59 vertices. */
export const WALL_FIXTURE_TRIANGLES = 118
export const WALL_FIXTURE_WELD = { before: 354, after: 59 } as const

/**
 * Facet normals as a naive STL-to-glTF conversion would emit them, one per
 * *vertex*, read back out of the 50-byte records.
 *
 * This is the trap in a bottle: `src/three/stl/parse.ts` skips these 12 bytes
 * per facet on purpose, so a test that wants to show what including them costs
 * has to read them itself.
 */
export function facetNormals(stl: Uint8Array): Float32Array {
  const view = new DataView(stl.buffer, stl.byteOffset, stl.byteLength)
  const facets = view.getUint32(80, true)
  const normals = new Float32Array(facets * 9)
  for (let facet = 0; facet < facets; facet += 1) {
    const at = 84 + facet * 50
    const nx = view.getFloat32(at, true)
    const ny = view.getFloat32(at + 4, true)
    const nz = view.getFloat32(at + 8, true)
    for (let corner = 0; corner < 3; corner += 1) {
      normals[facet * 9 + corner * 3] = nx
      normals[facet * 9 + corner * 3 + 1] = ny
      normals[facet * 9 + corner * 3 + 2] = nz
    }
  }
  return normals
}

/**
 * A closed heightfield: `2 × cells²` triangles over a shared vertex lattice.
 *
 * Corners at shared positions are **bitwise identical**, which is what a real
 * STL writer produces and what a bitwise weld needs to merge anything: the
 * coordinates come from integer arithmetic on the cell index, never from an
 * accumulated sum. A slight sinusoidal displacement gives the simplifier real
 * edges to collapse — a flat plane simplifies to two triangles and would prove
 * nothing about the band.
 *
 * `cells = 141` is 39,762 triangles, which is the smallest lattice over the
 * 20,000-triangle ceiling.
 */
export function grid(cells: number, size = 100): Float32Array {
  const step = size / cells
  const height = (i: number, j: number): number =>
    Math.sin((i / cells) * Math.PI * 3) * Math.cos((j / cells) * Math.PI * 3) * (size / 12)

  const soup = new Float32Array(cells * cells * 2 * 9)
  let at = 0
  const put = (i: number, j: number) => {
    soup[at] = i * step - size / 2
    soup[at + 1] = j * step - size / 2
    soup[at + 2] = height(i, j)
    at += 3
  }
  for (let i = 0; i < cells; i += 1) {
    for (let j = 0; j < cells; j += 1) {
      put(i, j)
      put(i + 1, j)
      put(i + 1, j + 1)
      put(i, j)
      put(i + 1, j + 1)
      put(i, j + 1)
    }
  }
  return soup
}

/** Write a soup as a binary STL, with a computed unit normal per facet. */
export function binaryStl(soup: Float32Array, label = 'openforge-workshop src/mesh fixture'): Uint8Array {
  const facets = Math.floor(soup.length / 9)
  const bytes = new Uint8Array(84 + facets * 50)
  const view = new DataView(bytes.buffer)
  for (let index = 0; index < Math.min(label.length, 79); index += 1) {
    bytes[index] = label.charCodeAt(index) & 0x7f
  }
  view.setUint32(80, facets, true)

  for (let facet = 0; facet < facets; facet += 1) {
    const base = facet * 9
    const ax = soup[base] ?? 0
    const ay = soup[base + 1] ?? 0
    const az = soup[base + 2] ?? 0
    const bx = soup[base + 3] ?? 0
    const by = soup[base + 4] ?? 0
    const bz = soup[base + 5] ?? 0
    const cx = soup[base + 6] ?? 0
    const cy = soup[base + 7] ?? 0
    const cz = soup[base + 8] ?? 0
    const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay)
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az)
    const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    const length = Math.hypot(nx, ny, nz) || 1

    const at = 84 + facet * 50
    view.setFloat32(at, nx / length, true)
    view.setFloat32(at + 4, ny / length, true)
    view.setFloat32(at + 8, nz / length, true)
    for (let corner = 0; corner < 9; corner += 1) {
      view.setFloat32(at + 12 + corner * 4, soup[base + corner] ?? 0, true)
    }
  }
  return bytes
}
