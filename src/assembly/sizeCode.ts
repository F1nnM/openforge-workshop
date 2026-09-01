/**
 * The `size|openlock` code, and why it — not `size|width` — is the base↔topper
 * matching key.
 *
 * §7 gives the table as A→2, BA→1.5, IA→1, D→3, Q→4 grid units. Re-derived over
 * the live corpus, the code is a **functional determinant of width with zero
 * exceptions**: every tile carrying one of those five codes *and* a measurable
 * `rect` or `wall` footprint agrees with the table exactly, across all 2,822
 * such tiles. `sizeCode.test.ts` re-runs that check against the emitted index so
 * a drifted tag fails the build rather than silently mismatching a base.
 *
 * The reason to match on the code rather than on the width it determines is
 * **coverage, not convenience**: 361 tiles carry a size code and no measurable
 * footprint at all (`arc` and `none`, where the size tags are design-family
 * labels rather than measurements — see `Footprint`). A width join drops those
 * 361 on the floor; a code join keeps them.
 */

/**
 * The five codes §7 fixes, in grid units.
 *
 * Deliberately **not** exhaustive over the 36 codes in the corpus. The other 31
 * (`S`, `SB`, `SA`, `I`, `IL`, `X`, `AxG`, `A+S`, …) have no published width and
 * are not guessed at here: matching compares codes for *equality*, which needs
 * no width, so an unknown code costs nothing. This table exists for the search
 * layer's size tokens and for the corpus assertion above — never as a
 * precondition of a match.
 */
export const SIZE_CODE_WIDTH_UNITS: Readonly<Record<string, number>> = Object.freeze({
  A: 2,
  BA: 1.5,
  IA: 1,
  D: 3,
  Q: 4,
})

/** The width a size code determines, or `undefined` for the 31 codes with no published width. */
export function sizeCodeWidth(code: string): number | undefined {
  return SIZE_CODE_WIDTH_UNITS[code]
}
