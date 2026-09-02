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
 * Nothing else is normalised. `arc` keys on the **band pair and the sweep**, not
 * on the tagged radius, and row W5 is why: the tagged radius is the *interface*
 * radius, and two curves that share it are not the same piece. A `concave` wall
 * band at R = 4 occupies [4, 4.5] and a `convex` one occupies [3.5, 4]; under the
 * pre-W5 key both were `arc:4@90`, and **nine of the ten arc base keys mixed at
 * least two bands** — `arc:4.0@90.0` mixed five, including a quarter disc with a
 * 0.5-unit wall band. Measured over the corpus, the pre-W5 key offered the 542
 * arc toppers **29,011** candidate bases across 10 keys and the sector key offers
 * **11,246** across 20, so 17,765 of those candidate pairs were pieces curving
 * the wrong way.
 *
 * **Ten toppers lose their last arc base, and that is the correct outcome.** They
 * are exactly the ten `s2w_radial` tiles — `dungeon_stone%block#floor+s2w+curved+
 * radial…` — whose band is `[R−1.5, R]`, the radial floor inset by 0.5 to leave
 * room for its own separately printed wall. They used to match a plain `[R−2, R]`
 * radial base, which is 0.5 units too deep at the inside edge: exactly the room
 * the wall was inset for. The corpus holds no `s2w` curved base at all, and a
 * missing base reported as missing is what row D5 exists to surface.
 *
 * The band *name* is deliberately not in the key: congruence is about shape, and
 * a `radial` [0, 2] sector and a `disc` [0, 2] sector are the same sector.
 *
 * `none` collapses to a single key, which is correct rather than convenient: the
 * 726 tiles with no derivable footprint are not congruent to each other, so the
 * `none` key is treated as **no key at all** by {@link footprintKey}'s callers
 * and never used to match.
 *
 * Row W4's three cases all key, and two of them had to. Its 121 `diag` tiles
 * were `wall:2` before it and its 9 `tri` tiles were `rect:2x2` / `rect:4x4`, so
 * leaving them off this switch would have silently withdrawn a congruence key
 * from 130 toppers — a regression wearing the shape of a schema addition.
 * `column` is the one genuinely new key: **every column in the corpus is the same
 * 0.5 × 0.5 square**, so the key carries no dimension and all 119 are congruent
 * to each other, which is the physical fact. A `diag` keys on its measured run,
 * because `P` (3.536) and `PA` (2.828) are not interchangeable pieces even though
 * both are tagged `size|width|2` — the tag is exactly what this key must not use.
 */
import type { Footprint } from '@/catalog'

/**
 * A key two footprints share iff they are congruent, or `undefined` when the
 * footprint carries no shape to be congruent about.
 *
 * `undefined` for `shape: 'none'` is the load-bearing return. Returning the
 * string `'none'` instead would make every one of the 269 openforge toppers with
 * no footprint match every one of the 104 shapeless bases — 27,976 false pairs,
 * each of which would look like a resolved assembly. (510 × 208 = 106,080 before
 * row W3 gave 403 tiles a footprint; the trap it describes is unchanged.)
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
      return `arc:${String(foot.rIn)}-${String(foot.rOut)}@${String(foot.sweep)}`
    case 'diag':
      return `diag:${String(foot.run)}`
    case 'tri':
      return `tri:${String(foot.leg)}`
    case 'column':
      return 'column'
    case 'none':
      return undefined
  }
}

/** Whether two footprints are congruent under {@link footprintKey}. */
export function footprintsMatch(a: Footprint, b: Footprint): boolean {
  const key = footprintKey(a)
  return key !== undefined && key === footprintKey(b)
}
