/**
 * MD5, because the catalog's content addresses are MD5 and the browser will not
 * compute one.
 *
 * `crypto.subtle.digest` supports SHA-1 and the SHA-2 family and deliberately
 * does not support MD5 — it is not in the WebCrypto algorithm registry, and it
 * is not coming. Every blob address in the index is an MD5, `/models/{md5[:6]}/`
 * is the bucket layout, and W1's verification path hashes content and compares
 * it to the index's `blob`. So a generated mesh cannot be placed on the same
 * footing as a fetched one without one of these.
 *
 * **This is not a security primitive and nothing here treats it as one.** MD5 is
 * collision-broken; an attacker who can choose both inputs can produce two
 * meshes with one digest. That is irrelevant to what it is used for — naming
 * bytes we just produced, and comparing them to a name the catalog already
 * chose. `verify.ts` says so in the terms that matter. Engine *integrity* uses
 * SHA-256, and that is a separate check for a separate claim.
 *
 * A dependency was not an option: `package.json` belongs to row W0, which has
 * merged, and 60 lines of arithmetic is a smaller thing to own than a
 * cross-row edit. Correctness is pinned by test vectors from RFC 1321 plus the
 * digest of a real generated STL, cross-checked against `md5sum`.
 */

/** Per-round left-rotation amounts, RFC 1321 §3.4. */
const SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15,
  21,
] as const

/** `K[i] = floor(abs(sin(i + 1)) * 2^32)`, computed once rather than tabulated. */
const K = new Uint32Array(64)
for (let index = 0; index < 64; index += 1) {
  K[index] = Math.floor(Math.abs(Math.sin(index + 1)) * 0x1_0000_0000)
}

const HEX = '0123456789abcdef'

/**
 * The MD5 of some bytes, as 32 lowercase hex characters.
 *
 * Streams over the input in 64-byte blocks with one 64-byte scratch buffer, so
 * hashing a 25 MB mesh allocates nothing proportional to the mesh. That matters:
 * this runs in the worker immediately after a render, while the module's linear
 * memory is still holding the geometry.
 */
export function md5(bytes: Uint8Array): string {
  let a0 = 0x67452301
  let b0 = 0xefcdab89
  let c0 = 0x98badcfe
  let d0 = 0x10325476

  const block = new Uint8Array(64)
  const words = new Uint32Array(16)
  const view = new DataView(block.buffer)

  const total = bytes.length
  const whole = total - (total % 64)

  for (let offset = 0; offset < whole; offset += 64) {
    block.set(bytes.subarray(offset, offset + 64))
    for (let word = 0; word < 16; word += 1) words[word] = view.getUint32(word * 4, true)
    ;[a0, b0, c0, d0] = compress(a0, b0, c0, d0, words)
  }

  // The tail: the remaining bytes, the 0x80 terminator, zero padding, and the
  // 64-bit little-endian bit length. Two blocks when the remainder leaves no
  // room for the length, one otherwise.
  const remainder = total - whole
  block.fill(0)
  block.set(bytes.subarray(whole, total))
  block[remainder] = 0x80

  if (remainder >= 56) {
    for (let word = 0; word < 16; word += 1) words[word] = view.getUint32(word * 4, true)
    ;[a0, b0, c0, d0] = compress(a0, b0, c0, d0, words)
    block.fill(0)
  }

  // `total * 8` exceeds 2^53 only past a petabyte, so a float multiply is exact
  // here; the high word is still written, because a truncated length field is a
  // wrong digest rather than a failure.
  const bits = total * 8
  view.setUint32(56, bits >>> 0, true)
  view.setUint32(60, Math.floor(bits / 0x1_0000_0000) >>> 0, true)
  for (let word = 0; word < 16; word += 1) words[word] = view.getUint32(word * 4, true)
  ;[a0, b0, c0, d0] = compress(a0, b0, c0, d0, words)

  return hex(a0) + hex(b0) + hex(c0) + hex(d0)
}

/** One 64-byte block, four rounds of sixteen operations. */
function compress(a0: number, b0: number, c0: number, d0: number, words: Uint32Array): [number, number, number, number] {
  let a = a0
  let b = b0
  let c = c0
  let d = d0

  for (let step = 0; step < 64; step += 1) {
    let mixed: number
    let index: number
    if (step < 16) {
      mixed = (b & c) | (~b & d)
      index = step
    } else if (step < 32) {
      mixed = (d & b) | (~d & c)
      index = (5 * step + 1) % 16
    } else if (step < 48) {
      mixed = b ^ c ^ d
      index = (3 * step + 5) % 16
    } else {
      mixed = c ^ (b | ~d)
      index = (7 * step) % 16
    }

    const shift = SHIFTS[step] ?? 0
    const sum = (a + mixed + (K[step] ?? 0) + (words[index] ?? 0)) >>> 0
    a = d
    d = c
    c = b
    b = (b + ((sum << shift) | (sum >>> (32 - shift)))) >>> 0
  }

  return [(a0 + a) >>> 0, (b0 + b) >>> 0, (c0 + c) >>> 0, (d0 + d) >>> 0]
}

/** A digest word, little-endian, as eight hex characters. */
function hex(word: number): string {
  let out = ''
  for (let byte = 0; byte < 4; byte += 1) {
    const value = (word >>> (byte * 8)) & 0xff
    out += (HEX[value >>> 4] ?? '') + (HEX[value & 0x0f] ?? '')
  }
  return out
}
