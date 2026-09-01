/**
 * Footprint congruence — the fallback base↔topper key, for the toppers the size
 * code cannot reach.
 *
 * 2,364 of the 4,363 `connection|openforge` toppers (54.2%) carry **no**
 * `size|openlock` code, so a code-only join leaves the hard rule of §7 — every
 * openforge piece gets a base line item — unenforceable for more than half the
 * toppers in the corpus. Matching those on the footprint itself recovers
 * 1,899 of them (80.3%). Of the 465 that remain, 444 have no derivable
 * footprint either — no code, no shape, nothing to match on — and 21 are real
 * shape gaps: three thin strips (`0.5x2` ×14, `0.5x1` ×3, `2x6` ×4) for which
 * the corpus genuinely holds no base. Both are reported, and reported *apart*,
 * because one is a tile with nothing to match on and the other is a base the
 * corpus is missing.
 *
 * The key is **canonical, not literal**, and only in one respect: a `rect`'s two
 * extents are sorted, so a `0.5x2` topper matches a `2x0.5` base. That is a
 * rotation on a grid the builder can already rotate on, not a fudge — §7's
 * rotation step exists precisely because tiles turn.
 *
 * Nothing else is normalised. `arc` keys on radius *and* sweep because §2
 * records that the size tags diverge from the mesh on curves (median error
 * 96 mm) — so radius alone would match a 90° elbow to a 270° sweep. `none`
 * collapses to a single key, which is correct rather than convenient: the 1,144
 * tiles with no derivable footprint are not congruent to each other, so the
 * `none` key is treated as **no key at all** by {@link footprintKey}'s callers
 * and never used to match.
 */
import type { Footprint } from '@/catalog'

/**
 * A key two footprints share iff they are congruent, or `undefined` when the
 * footprint carries no shape to be congruent about.
 *
 * `undefined` for `shape: 'none'` is the load-bearing return. Returning the
 * string `'none'` instead would make every one of the 510 openforge toppers with
 * no footprint match every one of the 208 shapeless bases — 106,080 false pairs,
 * each of which would look like a resolved assembly.
 */
export function footprintKey(foot: Footprint): string | undefined {
  switch (foot.shape) {
    case 'rect': {
      const short = Math.min(foot.w, foot.d)
      const long = Math.max(foot.w, foot.d)
      return `rect:${String(short)}x${String(long)}`
    }
    case 'wall':
      return `wall:${String(foot.length)}`
    case 'arc':
      return `arc:${String(foot.radius)}@${String(foot.angle)}`
    case 'none':
      return undefined
  }
}

/** Whether two footprints are congruent under {@link footprintKey}. */
export function footprintsMatch(a: Footprint, b: Footprint): boolean {
  const key = footprintKey(a)
  return key !== undefined && key === footprintKey(b)
}
