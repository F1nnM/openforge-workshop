/**
 * Synthetic meshes with dimensions known in advance.
 *
 * The tests in this tool assert against geometry whose answer is arithmetic, not
 * against a fetched file: an annular sector generated at `[50.8, 101.6] × 90°`
 * must come back as `[2, 4] × 90°`, and a stride that skips the facet carrying
 * the far corner must report exactly the distance that corner sat at. Real
 * archive files cannot do that — they tell you what the parser produced, not
 * what the shape is — and no test here touches the network.
 *
 * Follows `tools/thumbnails/fixtures/`'s pattern: generated, tiny, checked in as
 * code rather than as bytes.
 */
import { BINARY_FACET_BYTES, BINARY_HEADER_BYTES } from '../../../src/three/stl/parse'

/** One triangle, three corners, each `[x, y, z]` in millimetres. */
export type Triangle = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
]

/** Encode triangles as a binary STL. Header text is deliberately non-`solid`. */
export function binaryStl(triangles: readonly Triangle[], header = 'openforge-workshop test mesh'): Uint8Array {
  const bytes = new Uint8Array(BINARY_HEADER_BYTES + triangles.length * BINARY_FACET_BYTES)
  const view = new DataView(bytes.buffer)
  for (let index = 0; index < Math.min(header.length, 80); index += 1) {
    bytes[index] = header.charCodeAt(index) & 0x7f
  }
  view.setUint32(80, triangles.length, true)

  let at = BINARY_HEADER_BYTES
  for (const triangle of triangles) {
    // The stored normal is never trusted by the parser, so zero is honest.
    view.setFloat32(at, 0, true)
    view.setFloat32(at + 4, 0, true)
    view.setFloat32(at + 8, 0, true)
    at += 12
    for (const corner of triangle) {
      view.setFloat32(at, corner[0], true)
      view.setFloat32(at + 4, corner[1], true)
      view.setFloat32(at + 8, corner[2], true)
      at += 12
    }
    view.setUint16(at, 0, true)
    at += 2
  }
  return bytes
}

/** Encode triangles as an ASCII STL — the 11.6% of the corpus that cannot be strided. */
export function asciiStl(triangles: readonly Triangle[], name = 'test'): Uint8Array {
  const lines = [`solid ${name}`]
  for (const triangle of triangles) {
    lines.push('  facet normal 0 0 0', '    outer loop')
    for (const corner of triangle) {
      lines.push(`      vertex ${String(corner[0])} ${String(corner[1])} ${String(corner[2])}`)
    }
    lines.push('    endloop', '  endfacet')
  }
  lines.push(`endsolid ${name}`, '')
  return new TextEncoder().encode(lines.join('\n'))
}

/** Flat positions, as `parseStl` would produce them. Skips the encode round trip. */
export function positionsOf(triangles: readonly Triangle[]): Float32Array {
  const positions = new Float32Array(triangles.length * 9)
  let at = 0
  for (const triangle of triangles) {
    for (const corner of triangle) {
      positions[at] = corner[0]
      positions[at + 1] = corner[1]
      positions[at + 2] = corner[2]
      at += 3
    }
  }
  return positions
}

/** An axis-aligned box, 12 triangles, spanning `min` to `max`. */
export function boxMesh(
  min: readonly [number, number, number],
  max: readonly [number, number, number],
): Triangle[] {
  const [x0, y0, z0] = min
  const [x1, y1, z1] = max
  const corner = (i: number, j: number, k: number): readonly [number, number, number] => [
    i === 0 ? x0 : x1,
    j === 0 ? y0 : y1,
    k === 0 ? z0 : z1,
  ]
  const quad = (
    a: readonly [number, number, number],
    b: readonly [number, number, number],
    c: readonly [number, number, number],
    d: readonly [number, number, number],
  ): Triangle[] => [
    [a, b, c],
    [a, c, d],
  ]

  return [
    ...quad(corner(0, 0, 0), corner(1, 0, 0), corner(1, 1, 0), corner(0, 1, 0)),
    ...quad(corner(0, 0, 1), corner(1, 0, 1), corner(1, 1, 1), corner(0, 1, 1)),
    ...quad(corner(0, 0, 0), corner(1, 0, 0), corner(1, 0, 1), corner(0, 0, 1)),
    ...quad(corner(0, 1, 0), corner(1, 1, 0), corner(1, 1, 1), corner(0, 1, 1)),
    ...quad(corner(0, 0, 0), corner(0, 1, 0), corner(0, 1, 1), corner(0, 0, 1)),
    ...quad(corner(1, 0, 0), corner(1, 1, 0), corner(1, 1, 1), corner(1, 0, 1)),
  ]
}

export interface SectorSpec {
  /** Arc centre in the XY plane, mm. */
  centreMm?: readonly [number, number]
  innerRadiusMm: number
  outerRadiusMm: number
  startDeg?: number
  sweepDeg: number
  heightMm?: number
  /** Facets along each arc. 64 is roughly what the corpus's own tessellation uses. */
  segments?: number
  /** Rotate the sector plane so it lies in XZ instead of XY. */
  plane?: 'xy' | 'xz'
}

/**
 * An annular-sector prism: two arcs, two radial end caps, a top and a bottom.
 *
 * The whole point of the fixture is that `innerRadiusMm`, `outerRadiusMm` and
 * `sweepDeg` go in and the fitter has to get them back out without being told
 * the centre.
 */
export function annularSectorMesh(spec: SectorSpec): Triangle[] {
  const [cx, cy] = spec.centreMm ?? [0, 0]
  const start = ((spec.startDeg ?? 0) * Math.PI) / 180
  const sweep = (spec.sweepDeg * Math.PI) / 180
  const height = spec.heightMm ?? 12.7
  const segments = spec.segments ?? 64
  const rIn = spec.innerRadiusMm
  const rOut = spec.outerRadiusMm

  const point = (r: number, angle: number, z: number): readonly [number, number, number] => {
    const u = cx + r * Math.cos(angle)
    const v = cy + r * Math.sin(angle)
    return spec.plane === 'xz' ? [u, z, v] : [u, v, z]
  }

  const triangles: Triangle[] = []
  for (let step = 0; step < segments; step += 1) {
    const a0 = start + (sweep * step) / segments
    const a1 = start + (sweep * (step + 1)) / segments

    // Top and bottom faces.
    for (const z of [0, height]) {
      triangles.push([point(rIn, a0, z), point(rOut, a0, z), point(rOut, a1, z)])
      triangles.push([point(rIn, a0, z), point(rOut, a1, z), point(rIn, a1, z)])
    }
    // Outer and inner walls.
    for (const r of rIn === 0 ? [rOut] : [rIn, rOut]) {
      triangles.push([point(r, a0, 0), point(r, a1, 0), point(r, a1, height)])
      triangles.push([point(r, a0, 0), point(r, a1, height), point(r, a0, height)])
    }
  }
  // Radial end caps.
  for (const angle of [start, start + sweep]) {
    triangles.push([point(rIn, angle, 0), point(rOut, angle, 0), point(rOut, angle, height)])
    triangles.push([point(rIn, angle, 0), point(rOut, angle, height), point(rIn, angle, height)])
  }
  return triangles
}

/**
 * A straight wall run: a box of `lengthMm × thicknessMm × heightMm`, optionally
 * rotated about Z.
 *
 * This is what `openlock-tessellation.md` §7 says the `xG` codes actually are, so
 * it is the shape the sector fitter has to *refuse*.
 */
export function wallMesh(
  lengthMm: number,
  thicknessMm: number,
  heightMm: number,
  rotateDeg = 0,
): Triangle[] {
  const angle = (rotateDeg * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return boxMesh([0, 0, 0], [lengthMm, thicknessMm, heightMm]).map(
    (triangle) =>
      triangle.map((corner) => [
        corner[0] * cos - corner[1] * sin,
        corner[0] * sin + corner[1] * cos,
        corner[2],
      ]) as unknown as Triangle,
  )
}

/**
 * A mesh whose extreme vertex is in a chosen facet, so a stride that skips that
 * facet has a *known* error.
 *
 * `body` fills facets 0…`spikeAt - 1` and `spikeAt + 1`… with a unit box at the
 * origin; facet `spikeAt` reaches out to `spikeMm` on X. A stride of `k` sees
 * facet `spikeAt` only when `spikeAt % k === 0`, and the error when it does not
 * is exactly `spikeMm - 1`.
 */
export function spikeMesh(facets: number, spikeAt: number, spikeMm: number): Triangle[] {
  const unit: Triangle = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ]
  const triangles: Triangle[] = []
  for (let facet = 0; facet < facets; facet += 1) {
    triangles.push(
      facet === spikeAt
        ? [
            [spikeMm, 0, 0],
            [spikeMm, 1, 0],
            [spikeMm, 0, 1],
          ]
        : unit,
    )
  }
  return triangles
}
