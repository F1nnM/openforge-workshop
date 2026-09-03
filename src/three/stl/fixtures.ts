/**
 * Synthesised STL buffers.
 *
 * Both formats are written here rather than fetched, for two reasons: a test that
 * reaches R2 is a test that fails on a train, and — the substantive one — a
 * synthesised file is the only way to assert on *exact* vertex values and to
 * construct the cases the archive does not conveniently hold, like a facet normal
 * that disagrees with its winding or a header that lies about its facet count.
 *
 * The one real-archive shape that is reproduced exactly is
 * {@link EMPTY_BINARY_STL}: an 84-byte valid header declaring zero facets, which
 * is the smallest live file in the corpus and the one that used to make
 * `computeBoundingSphere` return NaN.
 *
 * Also used by the dev harness, which offers a synthetic cube alongside the real
 * archive tiles so the viewer can be looked at with the network unplugged.
 */
export type Vec3 = readonly [number, number, number]

export interface Facet {
  readonly corners: readonly [Vec3, Vec3, Vec3]
  /**
   * The normal to *write into the file*.
   *
   * Defaults to `[0, 0, 0]`, which is what a good many real exporters emit and a
   * reminder that the parser never reads this field. Set it to something wrong on
   * purpose to prove that recomputation happens.
   */
  readonly normal?: Vec3
}

export const BINARY_HEADER_BYTES = 84
export const BINARY_FACET_BYTES = 50

export interface BinaryStlOptions {
  /** The 80-byte header text. `'solid …'` is legal here and is the classic sniffing trap. */
  readonly header?: string
  /** Override the declared facet count, for the truncated-file case. */
  readonly declaredFacets?: number
}

/** Write the fixed-width binary layout. */
export function binaryStl(
  facets: readonly Facet[],
  options: BinaryStlOptions = {},
): Uint8Array<ArrayBuffer> {
  const declared = options.declaredFacets ?? facets.length
  const bytes = new Uint8Array(BINARY_HEADER_BYTES + facets.length * BINARY_FACET_BYTES)
  const view = new DataView(bytes.buffer)

  const header = options.header ?? 'openforge-workshop test fixture'
  for (let index = 0; index < Math.min(header.length, 80); index += 1) {
    bytes[index] = header.charCodeAt(index) & 0xff
  }
  view.setUint32(80, declared, true)

  facets.forEach((facet, index) => {
    let at = BINARY_HEADER_BYTES + index * BINARY_FACET_BYTES
    const normal = facet.normal ?? [0, 0, 0]
    for (const component of normal) {
      view.setFloat32(at, component, true)
      at += 4
    }
    for (const corner of facet.corners) {
      for (const component of corner) {
        view.setFloat32(at, component, true)
        at += 4
      }
    }
    view.setUint16(at, 0, true)
  })

  return bytes
}

/** Write the text layout, in the shape `stl-thumb`'s inputs actually take. */
export function asciiStl(facets: readonly Facet[], name = 'fixture'): Uint8Array<ArrayBuffer> {
  const lines: string[] = [`solid ${name}`]
  for (const facet of facets) {
    const [nx, ny, nz] = facet.normal ?? [0, 0, 0]
    lines.push(`  facet normal ${format(nx)} ${format(ny)} ${format(nz)}`)
    lines.push('    outer loop')
    for (const [x, y, z] of facet.corners) {
      lines.push(`      vertex ${format(x)} ${format(y)} ${format(z)}`)
    }
    lines.push('    endloop')
    lines.push('  endfacet')
  }
  lines.push(`endsolid ${name}`, '')
  return new TextEncoder().encode(lines.join('\n'))
}

function format(value: number): string {
  return value.toExponential(6)
}

/**
 * An axis-aligned box from the origin, outward-wound, 12 facets.
 *
 * Written by hand rather than generated so the winding is inspectable: a
 * generator that got it wrong would produce inward normals and the flat-shading
 * test would still pass.
 */
export function box(width: number, depth: number, height: number): Facet[] {
  const x = width
  const y = depth
  const z = height
  const quad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3): Facet[] => [
    { corners: [a, b, c] },
    { corners: [a, c, d] },
  ]

  return [
    // −Z, +Z
    ...quad([0, 0, 0], [0, y, 0], [x, y, 0], [x, 0, 0]),
    ...quad([0, 0, z], [x, 0, z], [x, y, z], [0, y, z]),
    // −Y, +Y
    ...quad([0, 0, 0], [x, 0, 0], [x, 0, z], [0, 0, z]),
    ...quad([0, y, 0], [0, y, z], [x, y, z], [x, y, 0]),
    // −X, +X
    ...quad([0, 0, 0], [0, 0, z], [0, y, z], [0, y, 0]),
    ...quad([x, 0, 0], [x, y, 0], [x, y, z], [x, 0, z]),
  ]
}

/**
 * A 1×1 tile-shaped box: 25.4 × 25.4 × 6 model units.
 *
 * The grid unit is §2's measured 25.4 mm, confirmed against the live archive
 * during this PR (the median tile measures 101.60 = 4 × 25.4 on its long axis).
 */
export const TILE_FACETS: readonly Facet[] = box(25.4, 25.4, 6)

/**
 * The corpus's smallest live file, reconstructed: a valid 80-byte header, a facet
 * count of zero, and nothing else. `84 + 0 × 50 === 84`, so it is well-formed.
 */
export const EMPTY_BINARY_STL: Uint8Array<ArrayBuffer> = binaryStl([], { declaredFacets: 0 })
