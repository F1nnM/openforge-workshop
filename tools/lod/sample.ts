/**
 * Choosing which meshes to decimate, when decimating all of them is 108 GB.
 *
 * Egress from R2 is free, but the bucket is production infrastructure serving
 * real patrons, there is no cache rule on it yet (blocker B1) and a full pass is
 * **8,353 objects and 108.0 GB of origin reads**. So the default is a
 * deterministic stratified sample and `--all` is something a human triggers
 * knowingly. Deterministic matters twice: the same sample on two machines is
 * comparable, and an on-disk cache stays warm across runs.
 *
 * Four strata, in priority order, because each answers a different question:
 *
 *  1. **`gate`** — meshes over `STL_GATE_BYTES`. **978 tiles, 957 distinct md5s,
 *     11.24% of the live corpus**, re-derived from the index by `aboveGate`.
 *     These have *no 3D path at all* today: `stlGate` refuses them and the
 *     detail view falls back to the sprite sheet. They are the reason this row
 *     exists, they are where decimation is hardest, and they are the only stratum
 *     with a floor on its share of the sample — {@link GATE_SHARE}.
 *  2. **`decile`** — one mesh per size decile of the whole corpus, so the sample
 *     spans the range rather than clustering at the interesting end. This is what
 *     makes a corpus extrapolation from the sample defensible.
 *  3. **`smallest`** — the two smallest meshes. One of them is the 84-byte
 *     zero-facet file, which must be *reported* rather than crash the run, and
 *     the other is a 118-facet column, which must pass through undecimated. Both
 *     are edge cases that only appear if you deliberately sample for them.
 *  4. **`spread`** — fills whatever the earlier strata left, evenly across the
 *     size order. This is the stratum that keeps the report from being an account
 *     of the heavy tail alone: with `gate` taking a third and the deciles taking
 *     ten, filling with "the largest remaining" would put two thirds of a default
 *     sample in the top decile, and the mean LOD size it reported would be wrong
 *     for the corpus by a factor.
 *
 * The largest mesh in the corpus is picked regardless: `spread` includes both
 * endpoints, and the `gate` stratum's own spread ends on it.
 */
import type { MeshTarget } from './catalog'

/**
 * Default sample size.
 *
 * 36: a third above the gate (12), ten deciles, the two smallest, and the rest
 * spread across the size order — enough to measure every stratum, and small
 * enough to run in minutes against a production bucket.
 */
export const DEFAULT_SAMPLE_SIZE = 36

/** Minimum share of a sample drawn from above the gate. */
export const GATE_SHARE = 1 / 3

/** Deciles of the corpus size distribution. */
export const DECILES = 10

export type SampleReason = 'gate' | 'decile' | 'smallest' | 'spread' | 'all'

export interface SamplePick {
  target: MeshTarget
  reason: SampleReason
}

export interface SampleOptions {
  /** Total meshes to select. */
  limit?: number
  /** Share drawn from above the gate. Defaults to {@link GATE_SHARE}. */
  gateShare?: number
}

/**
 * The sample, in fetch order (display order, so a resumed partial run is a
 * prefix of the catalog rather than a scatter).
 *
 * @throws when the limit is not positive — an empty sample produces a report full
 * of zeroes that reads like a successful run.
 */
export function selectSample(targets: readonly MeshTarget[], options: SampleOptions = {}): SamplePick[] {
  const limit = options.limit ?? DEFAULT_SAMPLE_SIZE
  if (limit <= 0) throw new Error(`sample limit must be positive, got ${String(limit)}`)
  const gateShare = options.gateShare ?? GATE_SHARE

  const bySize = [...targets].sort((a, b) => a.bytes - b.bytes || (a.blob < b.blob ? -1 : 1))
  const picked = new Map<string, SamplePick>()

  const take = (target: MeshTarget | undefined, reason: SampleReason): void => {
    if (target === undefined || picked.size >= limit || picked.has(target.blob)) return
    picked.set(target.blob, { target, reason })
  }

  const gated = bySize.filter((target) => target.aboveGate)
  for (const target of spread(gated, Math.ceil(limit * gateShare))) take(target, 'gate')

  for (const target of spread(bySize, DECILES)) take(target, 'decile')

  for (const target of bySize.slice(0, 2)) take(target, 'smallest')

  for (const target of spread(bySize, limit)) take(target, 'spread')
  // A limit larger than the spread can fill: take whatever is left, largest first,
  // since size is what makes a mesh interesting to this tool.
  for (const target of [...bySize].reverse()) take(target, 'spread')

  return [...picked.values()].sort((a, b) => a.target.ord - b.target.ord)
}

/** Every mesh, in display order — the `--all` preset. */
export function selectAll(targets: readonly MeshTarget[]): SamplePick[] {
  return [...targets].sort((a, b) => a.ord - b.ord).map((target) => ({ target, reason: 'all' as const }))
}

/** Every mesh the gate refuses, in display order — the `--above-gate` preset. */
export function selectAboveGate(targets: readonly MeshTarget[]): SamplePick[] {
  return [...targets]
    .filter((target) => target.aboveGate)
    .sort((a, b) => a.ord - b.ord)
    .map((target) => ({ target, reason: 'gate' as const }))
}

/**
 * `count` items spread evenly across an ordered list, endpoints included.
 *
 * Evenly *by position*, not by value: the size distribution is heavily skewed
 * (median 10.4 MB against a 108.9 MB maximum) so value-spaced picks would put
 * eight of ten samples in the last decile.
 */
export function spread<T>(items: readonly T[], count: number): T[] {
  if (items.length === 0 || count <= 0) return []
  if (count >= items.length) return [...items]
  const out: T[] = []
  for (let i = 0; i < count; i += 1) {
    const index = count === 1 ? 0 : Math.round((i * (items.length - 1)) / (count - 1))
    const item = items[index]
    if (item !== undefined && !out.includes(item)) out.push(item)
  }
  return out
}

/** How many of each stratum a sample holds, for the run report. */
export function strataCounts(picks: readonly SamplePick[]): Record<SampleReason, number> {
  const counts: Record<SampleReason, number> = { gate: 0, decile: 0, smallest: 0, spread: 0, all: 0 }
  for (const pick of picks) counts[pick.reason] += 1
  return counts
}
