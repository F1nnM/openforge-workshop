/**
 * The distribution, not the mean.
 *
 * A UX decision needs a median and a p95: the median says what the interaction
 * usually feels like, the p95 says how often it feels broken. A mean over a
 * handful of samples with one slow outlier says neither.
 *
 * Two honesty rules are enforced here rather than left to the reader.
 *
 * 1. **p95 is nearest-rank, and it is labelled when it is degenerate.** With `n`
 *    samples, nearest-rank p95 is just `max` for any `n < 20`. Printing "p95"
 *    over 5 runs and letting a reader assume it means something is how a
 *    benchmark misleads without lying, so `Distribution.p95IsMax` records it and
 *    the report prints it.
 *
 * 2. **Cold and warm are separated, always.** The first run of a process pays for
 *    module compilation and page faults the rest do not; for the WASM engine that
 *    is most of a small render. Averaging them produces a figure that describes
 *    no real interaction.
 */

/** The smallest sample where nearest-rank p95 is not simply the maximum. */
export const P95_MIN_SAMPLES = 20

export interface Distribution {
  readonly count: number
  readonly min: number
  readonly median: number
  readonly p95: number
  readonly max: number
  readonly mean: number
  /** True when `count` is too small for p95 to be anything but `max`. */
  readonly p95IsMax: boolean
}

/** Nearest-rank quantile of a sorted sample. */
function nearestRank(sorted: readonly number[], quantile: number): number {
  const rank = Math.ceil(quantile * sorted.length)
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1))
  return sorted[index] as number
}

/** `undefined` for an empty sample rather than a zero that reads as a measurement. */
export function distribution(values: readonly number[]): Distribution | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const total = sorted.reduce((sum, value) => sum + value, 0)
  return {
    count: sorted.length,
    min: sorted[0] as number,
    median: nearestRank(sorted, 0.5),
    p95: nearestRank(sorted, 0.95),
    max: sorted[sorted.length - 1] as number,
    mean: total / sorted.length,
    p95IsMax: sorted.length < P95_MIN_SAMPLES,
  }
}

export interface Timings {
  /** The first run: process start, module compile, cold page cache. */
  readonly cold: number
  /** Every run after the first, in order. */
  readonly warm: readonly number[]
}

export interface Split {
  readonly cold: number
  readonly warm: Distribution | undefined
}

/**
 * Cold as its own number, warm as a distribution.
 *
 * Cold is deliberately *not* a distribution: there is one cold run per
 * configuration per invocation, and repeating the harness to build a cold sample
 * would measure the OS page cache rather than the engine.
 */
export function split(timings: Timings): Split {
  return { cold: timings.cold, warm: distribution(timings.warm) }
}

/**
 * How much of a run is fixed cost.
 *
 * `floor` comes from rendering a near-empty model on the same engine, so it
 * carries process start, WASM module compilation and the parse of the vendored
 * include chain. `geometry` is what is left, and it is the part a browser worker
 * holding a compiled module would actually pay per parameter change.
 *
 * Clamped at zero: a geometry run faster than the floor is noise, not a negative
 * cost, and reporting `-4 ms` would invite exactly the wrong reading.
 */
export function decompose(total: number, floor: number): { floor: number; geometry: number; floorShare: number } {
  const geometry = Math.max(0, total - floor)
  return { floor, geometry, floorShare: total > 0 ? Math.min(1, floor / total) : 0 }
}

/**
 * Ratio between two engines on the same configuration.
 *
 * The one number the report must not fudge: a native figure presented as though
 * it were the browser's is the specific dishonesty this row was warned about.
 */
export function ratio(slower: number, faster: number): number | undefined {
  if (faster <= 0) return undefined
  return slower / faster
}

/** Milliseconds, at a precision that does not imply more than was measured. */
export function ms(value: number): string {
  if (value < 10) return `${value.toFixed(1)} ms`
  if (value < 1000) return `${value.toFixed(0)} ms`
  return `${(value / 1000).toFixed(2)} s`
}
