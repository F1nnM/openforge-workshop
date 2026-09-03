/**
 * STL → `Float32Array`. No three.js, no DOM, no fetch — so it runs in a worker,
 * in Node and in a test with equal ease.
 *
 * ## Both formats, because 11.6% of the corpus is the slow one
 *
 * 870 of the 8,702 live files are **ASCII** STL. That is not a curiosity: ASCII
 * carries roughly 20× fewer triangles per byte and costs a text decode plus a
 * float parse per coordinate. Measured with this parser against real archive
 * files:
 *
 * | file | encoding | facets | parse |
 * | --- | --- | --- | --- |
 * | `plain#riser+high+square.4x4.dragonlock.stl`, 9.01 MB | ASCII | 52,404 | **38.3 ms** |
 * | `cut-stone+ruined#…4x1.openforge.stl`, 10.36 MB | binary | 207,296 | **9.3 ms** |
 *
 * Per triangle that is **0.73 µs against 0.045 µs — 16× slower** for the text
 * encoding, and the byte sizes are the same order. Both are comfortably under a
 * frame in isolation; both would still be a dropped frame on the main thread on
 * top of React's own work, and the largest file in the corpus takes 91 ms. Hence
 * the worker, and hence a parser with no renderer import that can live in one.
 *
 * ## Detection is by arithmetic, not by sniffing `solid`
 *
 * A binary STL is fixed-width: `84 + facets × 50` bytes, exactly. So the
 * `uint32` at offset 80 either predicts the file length or it does not, and that
 * test is decisive where the conventional `startsWith('solid')` sniff is not —
 * plenty of binary writers put "solid" in the 80-byte header, and three.js's own
 * loader carries a comment about exactly that trap. The `solid` check is only
 * the fallback, for files the arithmetic rejects.
 *
 * This also settles the corpus's smallest file, which is **84 bytes**: a valid
 * binary header declaring **zero** facets. `84 + 0 × 50 === 84`, so it parses
 * cleanly to an empty geometry, and the *caller* decides what an empty mesh
 * looks like on screen (`geometry.ts` gives it a real bounding sphere so nothing
 * downstream divides by a NaN radius). It is not an error and must not throw.
 *
 * ## Non-finite coordinates are compacted out, not shipped
 *
 * One `NaN` in a position attribute makes `computeBoundingSphere` produce a NaN
 * radius, which silently disables frustum culling and raycasting rather than
 * failing — the exact class of bug that costs an afternoon. A validation pass
 * over the filled array is a few milliseconds against a corpus of at most
 * 503,314 facets (the gate), so it always runs; the compaction it guards only
 * allocates when something was actually wrong, and the count is reported so a
 * bad file is diagnosable instead of merely wonky.
 */

/** Which encoding a buffer turned out to be. */
export type StlFormat = 'binary' | 'ascii'

/** Why a buffer could not be read as STL. Distinct kinds because the UI differs. */
export type StlParseErrorKind = 'unrecognised' | 'truncated'

export class StlParseError extends Error {
  override readonly name = 'StlParseError'
  readonly kind: StlParseErrorKind

  constructor(kind: StlParseErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}

export interface ParsedStl {
  /**
   * Non-indexed vertex positions: 9 floats per triangle, in file order.
   *
   * Non-indexed on purpose — see `geometry.ts`. Flat shading falls out of it for
   * free, which is the correct look for sculpted stone.
   */
  readonly positions: Float32Array<ArrayBuffer>
  readonly triangles: number
  readonly format: StlFormat
  /** Byte length of the source buffer, kept for the readout. */
  readonly sourceBytes: number
  /** Triangles dropped for holding a non-finite coordinate. Normally 0. */
  readonly dropped: number
}

/** A binary STL's fixed preamble: 80-byte header + `uint32` facet count. */
export const BINARY_HEADER_BYTES = 84

/** Bytes per binary facet: normal (12) + three vertices (36) + attribute (2). */
export const BINARY_FACET_BYTES = 50

/* ------------------------------------------------------------------ detection */

/**
 * `'binary'` when the facet count predicts the exact file length, `'ascii'` when
 * the file opens with `solid`, `null` when it is neither.
 */
export function detectStlFormat(bytes: Uint8Array): StlFormat | null {
  if (bytes.byteLength >= BINARY_HEADER_BYTES) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const facets = view.getUint32(80, true)
    if (BINARY_HEADER_BYTES + facets * BINARY_FACET_BYTES === bytes.byteLength) return 'binary'
  }

  // `solid` with a following delimiter, so a binary header that happens to read
  // "solidworks" is not mistaken for text.
  const head = String.fromCharCode(...bytes.subarray(0, 6))
  if (/^solid(\s|$)/.test(head)) return 'ascii'

  return null
}

/* --------------------------------------------------------------------- entry */

/** Parse either format. Throws {@link StlParseError} only when the bytes are not STL. */
export function parseStl(bytes: Uint8Array): ParsedStl {
  const format = detectStlFormat(bytes)

  if (format === 'binary') return parseBinaryStl(bytes)
  if (format === 'ascii') return parseAsciiStl(bytes)

  // A binary STL truncated mid-facet lands here, and it is worth naming: the
  // facet count is plausible but the body is short, which is what a cut-off
  // download looks like.
  if (bytes.byteLength >= BINARY_HEADER_BYTES) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const facets = view.getUint32(80, true)
    const expected = BINARY_HEADER_BYTES + facets * BINARY_FACET_BYTES
    if (facets > 0 && bytes.byteLength < expected) {
      throw new StlParseError(
        'truncated',
        `the header declares ${String(facets)} facets, which needs ${String(expected)} bytes; ` +
          `${String(bytes.byteLength)} arrived`,
      )
    }
  }

  throw new StlParseError(
    'unrecognised',
    `${String(bytes.byteLength)} bytes matching neither the binary layout nor an ASCII \`solid\` header`,
  )
}

/* -------------------------------------------------------------------- binary */

/** Read the fixed-width layout. Assumes {@link detectStlFormat} said `'binary'`. */
export function parseBinaryStl(bytes: Uint8Array): ParsedStl {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const triangles = view.getUint32(80, true)
  const positions = new Float32Array(triangles * 9)

  let write = 0
  for (let facet = 0; facet < triangles; facet += 1) {
    // + 12 skips the stored facet normal, which is not trusted — see geometry.ts.
    let read = BINARY_HEADER_BYTES + facet * BINARY_FACET_BYTES + 12
    for (let corner = 0; corner < 3; corner += 1) {
      positions[write] = view.getFloat32(read, true)
      positions[write + 1] = view.getFloat32(read + 4, true)
      positions[write + 2] = view.getFloat32(read + 8, true)
      write += 3
      read += 12
    }
  }

  return finish(positions, triangles, 'binary', bytes.byteLength)
}

/* --------------------------------------------------------------------- ascii */

/**
 * Read the text layout.
 *
 * Scanned rather than regexed. A `matchAll` over `/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g`
 * allocates a match object and four strings per vertex — 4.5 million objects for
 * a mesh at the gate — and the scan below allocates three short strings per
 * vertex instead, which the generational collector handles without a pause.
 *
 * Vertices are found by delimited token, so a `solid vertex_test` name line
 * cannot contribute a phantom corner. Triangle grouping is *not* re-derived from
 * `facet`/`endloop`: every three vertices in file order are one triangle, which
 * is true of every conforming writer and degrades to "the last incomplete facet
 * is dropped" rather than to a misassembled mesh.
 */
export function parseAsciiStl(bytes: Uint8Array): ParsedStl {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)

  // ~250 bytes per facet in practice; the array grows if the guess is low, so
  // this only decides how often that happens.
  let capacity = Math.max(48, Math.ceil((text.length / 250) * 9))
  let positions = new Float32Array(capacity)
  let write = 0

  let cursor = 0
  for (;;) {
    const found = text.indexOf('vertex', cursor)
    if (found === -1) break
    cursor = found + 6

    const before = found === 0 ? ' ' : text.charAt(found - 1)
    const after = text.charAt(cursor)
    if (!isSpace(before) || !isSpace(after)) continue

    if (write + 3 > capacity) {
      capacity = Math.max(capacity * 2, write + 3)
      const grown = new Float32Array(capacity)
      grown.set(positions.subarray(0, write))
      positions = grown
    }

    for (let axis = 0; axis < 3; axis += 1) {
      const start = skipSpace(text, cursor)
      const end = tokenEnd(text, start)
      if (end === start) {
        throw new StlParseError('truncated', 'a `vertex` line ran out before three coordinates')
      }
      positions[write + axis] = Number(text.slice(start, end))
      cursor = end
    }
    write += 3
  }

  // Whole triangles only. A trailing partial facet is a truncated file, and
  // three vertices short of a triangle cannot be drawn.
  const triangles = Math.floor(write / 9)
  return finish(positions.subarray(0, triangles * 9), triangles, 'ascii', bytes.byteLength)
}

function isSpace(char: string): boolean {
  return char === ' ' || char === '\n' || char === '\r' || char === '\t'
}

function skipSpace(text: string, from: number): number {
  let index = from
  while (index < text.length && isSpace(text.charAt(index))) index += 1
  return index
}

function tokenEnd(text: string, from: number): number {
  let index = from
  while (index < text.length && !isSpace(text.charAt(index))) index += 1
  return index
}

/* ------------------------------------------------------- finite-value guard */

/**
 * Validate, and compact only if something was wrong.
 *
 * The scan is one pass and allocation-free. The rebuild it guards is the rare
 * path; when it runs it drops whole triangles, never single corners, because
 * two thirds of a triangle is not a smaller mesh, it is a corrupt one.
 */
function finish(
  positions: Float32Array<ArrayBuffer>,
  triangles: number,
  format: StlFormat,
  sourceBytes: number,
): ParsedStl {
  let bad = 0
  for (let facet = 0; facet < triangles; facet += 1) {
    const base = facet * 9
    for (let index = base; index < base + 9; index += 1) {
      if (!Number.isFinite(positions[index])) {
        bad += 1
        break
      }
    }
  }

  if (bad === 0) {
    // `subarray` shares its buffer, and the buffer is what gets transferred out
    // of the worker; a shared one would transfer more than it should. Only the
    // ASCII path can hand over a view, so only it pays for the copy.
    const owned =
      positions.byteOffset === 0 && positions.byteLength === positions.buffer.byteLength
        ? positions
        : new Float32Array(positions)
    return { positions: owned, triangles, format, sourceBytes, dropped: 0 }
  }

  const kept = triangles - bad
  const compacted = new Float32Array(kept * 9)
  let write = 0
  for (let facet = 0; facet < triangles; facet += 1) {
    const base = facet * 9
    let finite = true
    for (let index = base; index < base + 9; index += 1) {
      if (!Number.isFinite(positions[index])) {
        finite = false
        break
      }
    }
    if (!finite) continue
    compacted.set(positions.subarray(base, base + 9), write)
    write += 9
  }

  return { positions: compacted, triangles: kept, format, sourceBytes, dropped: bad }
}
