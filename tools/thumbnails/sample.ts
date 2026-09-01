/**
 * Choosing which sheets to fetch, when fetching all of them is not the polite
 * default.
 *
 * Egress from R2 is free, but the bucket is production infrastructure serving
 * real patrons and a full pass is 8,702 objects and roughly 4.5 GB. So the
 * default is a **deterministic stratified sample** and the totals are
 * extrapolated from it, with `--all` left as something a human triggers
 * knowingly. Deterministic matters twice over: the same sample on two machines
 * is comparable, and the on-disk cache stays warm across runs instead of
 * pulling a fresh random set every time.
 *
 * Three strata, in priority order, because each answers a different question:
 *
 *   1. **`screenful`** — the first *n* sheets in display order (manifest ordinal
 *      order, which is what the catalog grid renders first). PR 13 measured this
 *      exact set: 42.06 MB over the wire for 60 cards, 7.1 MB for the 12 that
 *      fit one 1440×900 viewport, and +358 MB of decoded image memory for those
 *      12. Sampling it means the post-fix figure for the same cards is measured
 *      rather than modelled. It is also the worst case: the aztlan floors that
 *      lead the ordinal order are the heaviest sheets in the corpus.
 *   2. **`texture`** — the lowest-ordinal sheet of each of the 37 texture roots.
 *      A thumbnail's byte size is driven by how much of the frame is opaque and
 *      how busy the surface is, and that is a property of the texture family, so
 *      this is the stratum that makes the corpus extrapolation defensible.
 *   3. **`heaviest`** — the largest STL bytes remaining. Mesh size is a proxy for
 *      render complexity, and a complex render is the case where a fixed 256 px
 *      q80 budget could plausibly blow out.
 */
import type { SheetTarget } from './catalog'

/** Default sample size. Wide enough to cover all 37 texture roots plus a screenful. */
export const DEFAULT_SAMPLE_SIZE = 56

/**
 * Cards in one 1440×900 viewport of the catalog grid, measured in PR 13.
 * The `screenful` stratum is exactly these, so the after figure is comparable.
 */
export const SCREENFUL_CARDS = 12

/** Cards PR 13 measured over the wire in display order: 42.06 MB of sheets. */
export const MEASURED_CARD_RUN = 60

export type SampleReason = 'screenful' | 'texture' | 'heaviest' | 'all'

export interface SamplePick {
  target: SheetTarget
  reason: SampleReason
}

export interface SampleOptions {
  /** Total sheets to select. */
  limit?: number
  /** Size of the `screenful` stratum. Defaults to {@link SCREENFUL_CARDS}. */
  cards?: number
}

/**
 * The sample, in fetch order.
 *
 * @throws when the limit is not positive — an empty sample would produce a
 * report full of zeroes that reads like a successful run.
 */
export function selectSample(
  targets: readonly SheetTarget[],
  options: SampleOptions = {},
): SamplePick[] {
  const limit = options.limit ?? DEFAULT_SAMPLE_SIZE
  const cards = options.cards ?? SCREENFUL_CARDS
  if (limit <= 0) throw new Error(`sample limit must be positive, got ${String(limit)}`)

  const byOrd = [...targets].sort((a, b) => a.ord - b.ord)
  const picked = new Map<string, SamplePick>()

  const take = (target: SheetTarget, reason: SampleReason): void => {
    if (picked.size >= limit || picked.has(target.blob)) return
    picked.set(target.blob, { target, reason })
  }

  for (const target of byOrd.slice(0, cards)) take(target, 'screenful')

  const seenTexture = new Set<string>()
  for (const target of byOrd) {
    const texture = target.texture ?? '(none)'
    if (seenTexture.has(texture)) continue
    seenTexture.add(texture)
    take(target, 'texture')
  }

  for (const target of [...byOrd].sort((a, b) => b.bytes - a.bytes || a.ord - b.ord)) {
    take(target, 'heaviest')
  }

  return [...picked.values()]
}

/** The first `cards` sheets in display order — the `--screenful` preset. */
export function selectScreenful(targets: readonly SheetTarget[], cards: number): SamplePick[] {
  return [...targets]
    .sort((a, b) => a.ord - b.ord)
    .slice(0, cards)
    .map((target) => ({ target, reason: 'screenful' as const }))
}

/** Every sheet, in display order — the `--all` preset. */
export function selectAll(targets: readonly SheetTarget[]): SamplePick[] {
  return [...targets].sort((a, b) => a.ord - b.ord).map((target) => ({ target, reason: 'all' as const }))
}

/** How many of each stratum a sample holds, for the run report. */
export function strataCounts(picks: readonly SamplePick[]): Record<SampleReason, number> {
  const counts: Record<SampleReason, number> = { screenful: 0, texture: 0, heaviest: 0, all: 0 }
  for (const pick of picks) counts[pick.reason] += 1
  return counts
}
