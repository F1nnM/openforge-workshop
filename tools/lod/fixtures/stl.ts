/**
 * Synthetic STL builders — the tests' meshes, and the trap in a bottle.
 *
 * The one property these have to reproduce is the one that breaks the standard
 * recipe: **an STL shares no vertices and carries a normal per facet.** So
 * {@link binaryStl} writes the triangle soup exactly as a binary STL does, with a
 * real per-facet normal in each 50-byte record, and {@link facetNormals} reads
 * those normals back out so a test can build the *wrong* document — position plus
 * facet normal — and watch the weld assertion fire.
 *
 * Real catalog geometry is in `wall-8180da93.stl`; see `PROVENANCE.md`. These
 * builders exist alongside it because the synthetic ones can be made *large* (an
 * 81,920-triangle sphere is 4 MB of STL generated in 60 ms) without checking four
 * megabytes into git, and because a sphere's simplification behaviour is
 * predictable in a way a sculpted wall's is not.
 */
import { BINARY_FACET_BYTES, BINARY_HEADER_BYTES } from '../../../src/three/stl/parse'

/**
 * A non-indexed triangle soup: 9 floats per triangle.
 *
 * Narrowed to `ArrayBuffer` rather than `ArrayBufferLike` because that is what
 * glTF Transform's `setArray` accepts — see `decimate.ts`'s `Positions`.
 */
export type Soup = Float32Array<ArrayBuffer>

/**
 * Write a soup as a binary STL, with a computed unit normal per facet.
 *
 * The header is 80 bytes of a recognisable label. Note that `detectStlFormat`
 * decides by arithmetic, not by sniffing `solid`, so the label's content is free.
 */
export function binaryStl(soup: Soup, label = 'openforge-workshop tools/lod test fixture'): Uint8Array {
  const triangles = Math.floor(soup.length / 9)
  const bytes = new Uint8Array(BINARY_HEADER_BYTES + triangles * BINARY_FACET_BYTES)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < Math.min(label.length, 79); i += 1) bytes[i] = label.charCodeAt(i) & 0x7f
  view.setUint32(80, triangles, true)

  for (let facet = 0; facet < triangles; facet += 1) {
    const base = facet * 9
    const [nx, ny, nz] = normalOf(soup, base)
    let offset = BINARY_HEADER_BYTES + facet * BINARY_FACET_BYTES
    view.setFloat32(offset, nx, true)
    view.setFloat32(offset + 4, ny, true)
    view.setFloat32(offset + 8, nz, true)
    offset += 12
    for (let corner = 0; corner < 9; corner += 1) {
      view.setFloat32(offset + corner * 4, soup[base + corner] ?? 0, true)
    }
  }
  return bytes
}

/** Write a soup as an ASCII STL — 11.6% of the corpus is this encoding. */
export function asciiStl(soup: Soup, name = 'fixture'): Uint8Array {
  const triangles = Math.floor(soup.length / 9)
  const lines: string[] = [`solid ${name}`]
  for (let facet = 0; facet < triangles; facet += 1) {
    const base = facet * 9
    const [nx, ny, nz] = normalOf(soup, base)
    lines.push(`  facet normal ${nx} ${ny} ${nz}`, '    outer loop')
    for (let corner = 0; corner < 3; corner += 1) {
      const at = base + corner * 3
      lines.push(`      vertex ${soup[at] ?? 0} ${soup[at + 1] ?? 0} ${soup[at + 2] ?? 0}`)
    }
    lines.push('    endloop', '  endfacet')
  }
  lines.push(`endsolid ${name}`, '')
  return new TextEncoder().encode(lines.join('\n'))
}

/**
 * The per-facet normals a binary STL stores, expanded to one per *vertex*.
 *
 * This is what a naive STL-to-glTF conversion would put in a `NORMAL` attribute,
 * and it is exactly what makes `weld()` merge nothing. `src/three/stl/parse.ts`
 * deliberately skips these bytes, so a test that wants them has to read them.
 */
export function facetNormals(stl: Uint8Array): Soup {
  const view = new DataView(stl.buffer, stl.byteOffset, stl.byteLength)
  const triangles = view.getUint32(80, true)
  const out = new Float32Array(triangles * 9)
  for (let facet = 0; facet < triangles; facet += 1) {
    const offset = BINARY_HEADER_BYTES + facet * BINARY_FACET_BYTES
    const nx = view.getFloat32(offset, true)
    const ny = view.getFloat32(offset + 4, true)
    const nz = view.getFloat32(offset + 8, true)
    for (let corner = 0; corner < 3; corner += 1) {
      out[facet * 9 + corner * 3] = nx
      out[facet * 9 + corner * 3 + 1] = ny
      out[facet * 9 + corner * 3 + 2] = nz
    }
  }
  return out
}

/**
 * A closed, axis-aligned box as 12 triangles.
 *
 * The smallest thing the weld assertion is allowed to run on: 36 unshared
 * corners weld to 8, or 0.22×.
 */
export function box(sx = 10, sy = 10, sz = 10): Soup {
  const [x, y, z] = [sx / 2, sy / 2, sz / 2]
  const corners: [number, number, number][] = [
    [-x, -y, -z],
    [x, -y, -z],
    [x, y, -z],
    [-x, y, -z],
    [-x, -y, z],
    [x, -y, z],
    [x, y, z],
    [-x, y, z],
  ]
  const faces: [number, number, number][] = [
    [0, 2, 1],
    [0, 3, 2],
    [4, 5, 6],
    [4, 6, 7],
    [0, 1, 5],
    [0, 5, 4],
    [1, 2, 6],
    [1, 6, 5],
    [2, 3, 7],
    [2, 7, 6],
    [3, 0, 4],
    [3, 4, 7],
  ]
  const soup = new Float32Array(faces.length * 9)
  faces.forEach((face, index) => {
    face.forEach((corner, position) => {
      const point = corners[corner] ?? [0, 0, 0]
      soup[index * 9 + position * 3] = point[0]
      soup[index * 9 + position * 3 + 1] = point[1]
      soup[index * 9 + position * 3 + 2] = point[2]
    })
  })
  return soup
}

/**
 * A subdivided icosahedron: `20 × 4^subdivisions` triangles, radius `radius`.
 *
 * Vertices are emitted per facet with **bitwise identical** coordinates at shared
 * corners, which is what a real STL writer produces and what `weld()` needs to
 * merge anything. Subdivision midpoints are computed from a canonical key so the
 * two triangles either side of an edge agree to the last bit.
 */
export function icosphere(subdivisions: number, radius = 25): Soup {
  const phi = (1 + Math.sqrt(5)) / 2
  let vertices: [number, number, number][] = [
    [-1, phi, 0],
    [1, phi, 0],
    [-1, -phi, 0],
    [1, -phi, 0],
    [0, -1, phi],
    [0, 1, phi],
    [0, -1, -phi],
    [0, 1, -phi],
    [phi, 0, -1],
    [phi, 0, 1],
    [-phi, 0, -1],
    [-phi, 0, 1],
  ]
  let faces: [number, number, number][] = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ]

  for (let pass = 0; pass < subdivisions; pass += 1) {
    const midpoints = new Map<string, number>()
    const next: [number, number, number][] = []
    const midpoint = (a: number, b: number): number => {
      const key = a < b ? `${String(a)}:${String(b)}` : `${String(b)}:${String(a)}`
      const found = midpoints.get(key)
      if (found !== undefined) return found
      const pa = vertices[a] ?? [0, 0, 0]
      const pb = vertices[b] ?? [0, 0, 0]
      vertices.push([(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2])
      const index = vertices.length - 1
      midpoints.set(key, index)
      return index
    }
    for (const [a, b, c] of faces) {
      const ab = midpoint(a, b)
      const bc = midpoint(b, c)
      const ca = midpoint(c, a)
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca])
    }
    faces = next
  }

  // Project onto the sphere in Float32 precision, so the value written for a
  // shared corner is identical whichever facet writes it.
  vertices = vertices.map(([x, y, z]) => {
    const length = Math.hypot(x, y, z) || 1
    const scale = radius / length
    return [Math.fround(x * scale), Math.fround(y * scale), Math.fround(z * scale)]
  })

  const soup = new Float32Array(faces.length * 9)
  faces.forEach((face, index) => {
    face.forEach((corner, position) => {
      const point = vertices[corner] ?? [0, 0, 0]
      soup[index * 9 + position * 3] = point[0]
      soup[index * 9 + position * 3 + 1] = point[1]
      soup[index * 9 + position * 3 + 2] = point[2]
    })
  })
  return soup
}

/**
 * `count` disconnected triangles, sharing no vertex with each other.
 *
 * The one legitimate case the weld assertion refuses, and it refuses it
 * correctly: a soup with no shared vertices has no edges to collapse either, so
 * it cannot be simplified and should not be shipped as if it had been.
 */
export function disconnectedSoup(count: number): Soup {
  const soup = new Float32Array(count * 9)
  for (let facet = 0; facet < count; facet += 1) {
    const shift = facet * 10
    soup.set([shift, 0, 0, shift + 1, 0, 0, shift, 1, 0], facet * 9)
  }
  return soup
}

function normalOf(soup: Soup, base: number): [number, number, number] {
  const ax = soup[base] ?? 0
  const ay = soup[base + 1] ?? 0
  const az = soup[base + 2] ?? 0
  const ux = (soup[base + 3] ?? 0) - ax
  const uy = (soup[base + 4] ?? 0) - ay
  const uz = (soup[base + 5] ?? 0) - az
  const vx = (soup[base + 6] ?? 0) - ax
  const vy = (soup[base + 7] ?? 0) - ay
  const vz = (soup[base + 8] ?? 0) - az
  const nx = uy * vz - uz * vy
  const ny = uz * vx - ux * vz
  const nz = ux * vy - uy * vx
  const length = Math.hypot(nx, ny, nz) || 1
  return [nx / length, ny / length, nz / length]
}
