/**
 * `Uint32Array` bitsets — the whole reason faceting can run in the browser.
 *
 * architecture-plan.md §6 specifies "a `Uint32Array` bitset index with correct
 * disjunctive counts", and this is the layer that makes the second half cheap.
 * A disjunctive count has to re-evaluate every value of a facet with *that*
 * facet's own filter lifted (see `facets.ts`), which is 62 set intersections per
 * keystroke over the 8,702-tile corpus. As `Set`
 * intersections that is 62 walks over up to 8,702 boxed integers; as bitsets it
 * is 62 walks over 272 machine words, and the popcount never materialises the
 * members at all.
 *
 * Everything here is deliberately allocation-free at query time: the engine owns
 * a small pool of scratch bitsets and these functions write into them. That is
 * also why the mutating operations are `…Into` rather than returning a new
 * bitset — a faceted search runs on every keystroke, and 62 fresh
 * `Uint32Array`s per keystroke is garbage the collector does not need.
 *
 * Every function assumes its arguments were sized for the same population, and
 * that the unused tail bits of the last word are zero. {@link maskTail} is what
 * maintains the second invariant; break it and {@link popcount} over-counts
 * silently, which is the failure mode this module exists to avoid.
 */

/** Bits per word. `Uint32Array` rather than `BigInt64Array`: `>>> 5` beats `BigInt`. */
export const WORD_BITS = 32

/** Words needed to hold `size` bits. */
export function wordCount(size: number): number {
  return (size + WORD_BITS - 1) >>> 5
}

/** An all-zero bitset over `size` members. */
export function createBitset(size: number): Uint32Array {
  return new Uint32Array(wordCount(size))
}

/**
 * An all-ones bitset over `size` members — "no filter applied".
 *
 * The tail is masked, so `popcount(fullBitset(n)) === n` for every `n`, not just
 * multiples of 32. An unmasked tail is the classic bitset bug: the population
 * reads correctly until the corpus size stops being a multiple of the word size,
 * and 8,702 is not (8,702 = 271×32 + 30, so two phantom members).
 */
export function fullBitset(size: number): Uint32Array {
  const bits = createBitset(size)
  bits.fill(0xff_ff_ff_ff)
  maskTail(bits, size)
  return bits
}

/** Zero the bits above `size` in the final word. See {@link fullBitset}. */
export function maskTail(bits: Uint32Array, size: number): void {
  const tail = size & (WORD_BITS - 1)
  if (tail === 0 || bits.length === 0) return
  const last = bits.length - 1
  bits[last] = (bits[last] ?? 0) & ((1 << tail) - 1)
}

/** Set member `index`. */
export function setBit(bits: Uint32Array, index: number): void {
  const word = index >>> 5
  bits[word] = (bits[word] ?? 0) | (1 << (index & 31))
}

/** Whether member `index` is set. */
export function getBit(bits: Uint32Array, index: number): boolean {
  return ((bits[index >>> 5] ?? 0) & (1 << (index & 31))) !== 0
}

/** `dst &= src`. */
export function andInto(dst: Uint32Array, src: Uint32Array): void {
  for (let i = 0; i < dst.length; i++) dst[i] = (dst[i] ?? 0) & (src[i] ?? 0)
}

/** `dst |= src`. */
export function orInto(dst: Uint32Array, src: Uint32Array): void {
  for (let i = 0; i < dst.length; i++) dst[i] = (dst[i] ?? 0) | (src[i] ?? 0)
}

/** `dst = src`. */
export function copyInto(dst: Uint32Array, src: Uint32Array): void {
  dst.set(src)
}

/** Members set, via SWAR popcount. */
export function popcount(bits: Uint32Array): number {
  let total = 0
  for (let i = 0; i < bits.length; i++) total += popcountWord(bits[i] ?? 0)
  return total
}

/**
 * `popcount(a & b)` without materialising the intersection.
 *
 * This is the hot loop of the whole engine: one call per facet value per query,
 * so 62 calls per keystroke on the real vocabulary. Fusing the `&` into the
 * count is what keeps a disjunctive facet pass allocation-free.
 */
export function popcountAnd(a: Uint32Array, b: Uint32Array): number {
  let total = 0
  for (let i = 0; i < a.length; i++) total += popcountWord((a[i] ?? 0) & (b[i] ?? 0))
  return total
}

/**
 * Hamming weight of one word.
 *
 * `Math.imul` rather than `*` for the final multiply: the intermediate exceeds
 * 2^31, so plain `*` promotes to a double and the `>>> 24` then reads the wrong
 * bits for words with many set bits.
 */
function popcountWord(x: number): number {
  let v = x - ((x >>> 1) & 0x55_55_55_55)
  v = (v & 0x33_33_33_33) + ((v >>> 2) & 0x33_33_33_33)
  v = (v + (v >>> 4)) & 0x0f_0f_0f_0f
  return Math.imul(v, 0x01_01_01_01) >>> 24
}

/**
 * Members set, in **ascending order**, appended to `out`.
 *
 * Ascending order is load-bearing rather than incidental: the engine numbers
 * documents in manifest-ordinal order, so "ascending member index" *is* the
 * app's canonical result order, and the unfiltered query needs no sort at all.
 *
 * `w & -w` isolates the lowest set bit and `Math.clz32` turns it into its index,
 * so the loop runs once per set bit rather than 32 times per word — the
 * difference between 8,702 iterations and 278,528 on an unfiltered query.
 */
export function collectBits(bits: Uint32Array, out: number[]): number[] {
  for (let i = 0; i < bits.length; i++) {
    let word = bits[i] ?? 0
    const base = i << 5
    while (word !== 0) {
      const lowest = word & -word
      out.push(base + (31 - Math.clz32(lowest)))
      word ^= lowest
    }
  }
  return out
}
