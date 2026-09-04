/**
 * The `size|openlock` code: what it determines, and — row D4 — what it must not
 * be used to determine.
 *
 * §7 gives the table as A→2, BA→1.5, IA→1, D→3, Q→4 grid units. Re-derived over
 * the live corpus, the code is a **functional determinant of width with zero
 * exceptions**: every tile carrying one of those five codes *and* a measurable
 * `rect` or `wall` footprint agrees with the table exactly, across all 2,822
 * such tiles. `assembly.test.ts` re-runs that check against the emitted index so
 * a drifted tag fails the build rather than silently mismatching a base.
 *
 * **A width is not a footprint, and this is where the code stops.** Until row D4
 * the code was the *primary* base↔topper join key, on a coverage argument: 345
 * tiles carry a code and no measurable *width*, so a width join drops them and a
 * code join keeps them. The argument was sound about widths and wrong about
 * shapes, because W4 and W5 gave the schema seven primitives and the code does
 * not determine which one you have:
 *
 *   code  records  primitives it spans
 *   ----  -------  ---------------------------------------------------------
 *   `O`        43  `column` 34, `tri:2` 5, `tri:4` 4      — 38 integral, 5 topper
 *   `X`        29  `arc:4-4.5@90` 18, `column` 11         — 18 base, 11 integral
 *   `I`       108  `rect:1x1` 84, `column` 24
 *   `S`       182  `rect:1x2` 176, `wall:2` 6
 *
 * Four of the corpus's 36 codes, over 362 records. `O` is the loudest: a code
 * join can put a **0.5 × 0.5 pillar under a 4 × 4 triangle**, and nothing in the
 * old ranking could see the difference, because its `shape` criterion compared
 * the *discriminant* (`rect` vs `tri`) and not the dimensions.
 *
 * **The join is now on {@link footprintKey}** — the resolved primitive — and the
 * code keeps two narrower jobs:
 *
 *   1. **A tie-break inside a congruent candidate set** —
 *      `MATCH_WEIGHTS.code` in `baseMatch.ts`. Once every candidate is
 *      congruent, geometric fit is settled by the key and the code is the
 *      strongest remaining *identity* signal: the base belongs to the same
 *      published size family. It cannot outvote the lock or the print option.
 *   2. **The last-resort key for a topper with no primitive at all** — 14
 *      toppers, every one of them coded `U`, whose footprint W4 declined to
 *      guess. That path is the one place the old defect could still bite, so it
 *      is gated on {@link sharedPrimitive}: a code may only find a base when the
 *      bases carrying it agree about what shape they are.
 *
 * ## Row A3 deleted the third job, which was the width
 *
 * `SIZE_CODE_WIDTH_UNITS` and `sizeCodeWidth` are gone, and the plan was right
 * that nothing consumed them — but wrong that the file could go with them. The
 * only references were the barrel's re-export, this module, and
 * `assembly.test.ts`'s table check. `src/search/textIndex.ts` names the constant
 * in a **docblock**, explaining why its own size-token vocabulary omits `QxG`,
 * and reimplements nothing — so the search layer's size tokens were never this
 * function's caller. The `QxG` argument survives below because it is the reason
 * no width table should be reintroduced from the tag, not because anything reads
 * one.
 *
 * What keeps the *module*: {@link sharedPrimitive} and
 * {@link AMBIGUOUS_SIZE_CODES} are read by `baseMatch.ts#candidatesFor`, which
 * outlived rule 1 as the default-fill ranking. The corpus assertion that the
 * code determines a width **with zero exceptions over 2,822 tiles** is kept in
 * `assembly.test.ts` and now runs against the emitted records directly rather
 * than against a table this file publishes. A drifted tag still fails the build;
 * what no longer exists is a hard-coded five-entry table for it to drift
 * against.
 *
 * That gate is not decoration. All 26 codes on the base side pass it today — the
 * `I`, `S` and `X` bases are homogeneous, and no base carries `O` at all — which
 * is exactly why the defect was latent and never a wrong bill. The three
 * ambiguous codes bases *do* carry are ambiguous only across their `integral`
 * records, and every topper carrying one of them happens to sit on the single
 * primitive its bases have. That is a coincidence in the archive, not a rule
 * about codes, and it is one base away from ending.
 */
import type { CatalogRecord } from '@/catalog'

import { footprintKey } from './footprint'

/**
 * The codes measured to span more than one footprint primitive, and what they
 * span — the whole reason the join key moved off the code.
 *
 * Published as data rather than prose so `assembly.test.ts` can assert it
 * against the live corpus in both directions: every code listed here really is
 * ambiguous, and no code outside it is. A corpus rebuild that mints a fifth
 * ambiguous code fails that test, which is the point — the row before this one
 * left a comment saying "never both" and a comment cannot fail.
 */
export const AMBIGUOUS_SIZE_CODES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  I: Object.freeze(['column', 'rect:1x1']),
  O: Object.freeze(['column', 'tri:2', 'tri:4']),
  S: Object.freeze(['rect:1x2', 'wall:2']),
  X: Object.freeze(['arc:4-4.5@90', 'column']),
})

/**
 * The one primitive a set of records all resolve to, or `undefined` when they
 * disagree — or when any of them has no primitive to agree about.
 *
 * The `undefined`-on-disagreement return is the guard, not a convenience: it is
 * what makes a size-code match refuse rather than pick. Called on a candidate
 * *base* set, so "no primitive" means a shapeless base, which cannot be shown to
 * fit anything either.
 */
export function sharedPrimitive(records: readonly CatalogRecord[]): string | undefined {
  let shared: string | undefined
  for (const record of records) {
    const key = footprintKey(record.foot)
    if (key === undefined) return undefined
    if (shared === undefined) shared = key
    else if (shared !== key) return undefined
  }
  return shared
}
