/**
 * Footprint resolution — the single primitive the builder places a tile with.
 *
 * **This is a line-by-line port of `footprint_kind` in
 * `docs/verify-catalog-facts.py`, and it must stay one.** That script's output
 * is the authority for every footprint figure the architecture plan quotes
 * (RECT 3,449 / WALL 3,079 / ARC 1,199 / COLUMN 119 / DIAG 121 / TRI 9 /
 * NONE 726), and `catalog.test.ts` runs the script and compares its table
 * against what this module produces. Any "improvement" made here without making
 * it there first will fail that test.
 *
 * The script mirrors the **classification** only. Parameters — a diagonal's run,
 * an `xG` wall's length — come from `pipeline/tessellation.ts`, which is TypeScript
 * and which the script deliberately does not duplicate. The two agree on which
 * bucket a tile is in; the numbers inside the bucket have one home.
 *
 * ## What rows W4 and W5 changed, and what W1's measurements settled
 *
 * W3 left four cases and 91.5% coverage. W4 added three cases and corrected what
 * `arc` asserts, reaching **92.0%**; W5 made `arc` an annular sector and de-arced
 * the last 27 tiles whose radius is not an outline, landing at **91.7%** —
 * measured, and not the ~95% the plan predicted before it had any measurements.
 * The movement is eight groups and nothing else:
 *
 * | row | movement                          | tiles | why                                                     |
 * | --- | --------------------------------- | ----: | ------------------------------------------------------- |
 * | W4  | `none` → `column`                 |   119 | `size|column_shape`, four measured letters              |
 * | W4  | `wall` → `diag`                   |   121 | `shape|angled|right` with no depth — `P` `PA` `PB` `PC` |
 * | W4  | `rect` → `tri`                    |     9 | `shape|angled|right` with a depth — the `O`/`OA` pair   |
 * | W4  | `arc`  → `wall`                   |    84 | the `xG` interface walls, de-arced                      |
 * | W4  | `arc`  → `rect`                   |    24 | `inverted` plates whose box the mesh honours            |
 * | W4  | `arc`  → `none`                   |    57 | 36 `inverted` fragments, 21 `lintel` inserts            |
 * | W4  | `rect` → `none`                   |    20 | lettered `component|` parts of a curved design          |
 * | W5  | `arc`  → `none`                   |    27 | the `xG` interface *floors*, whose width is nowhere     |
 *
 * Coverage is not monotone across that list and was not meant to be: 104 tiles
 * *lose* a footprint, because W1 measured them and the footprint they had was
 * wrong. A wrong primitive placed confidently is worse than a refusal.
 *
 * ## What row D9 changed, and it moves no tile between cases
 *
 * One **parameter** correction, on 245 tiles: a corner wall tagged
 * `size|width|2` runs **1.5**, because that tag names the cell and the piece is
 * the cell face less the 0.5 corner column. Read from 157 meshes fetched whole
 * from R2 — the class had **0 measured records** when rows A10, B2 and D8 each
 * declined to guess it. See {@link cornerWallRun} for the table and
 * {@link isCornerAssembly} for the 36 records the correction must *not* touch.
 *
 * It is deliberately not in the movement table above: `footprintKind` is
 * untouched, every one of the 245 stays a `wall`, and so the RECT/WALL/ARC
 * tallies `docs/verify-catalog-facts.py` mirrors are unchanged. This module's
 * contract — *the script mirrors the classification, the numbers inside a bucket
 * have one home here* — is what makes a 245-tile correction possible without
 * touching the script.
 *
 * ### A radius is an outline only when nothing reassigns it
 *
 * The load-bearing change of both rows. `arc` asserts *the outline is an annular
 * sector*, and W1 refused a sector fit on **192** tiles that carry a radius —
 * every one of the 165 with no `size|angle` (`fit: 'rejected'`, 165/165) plus the
 * 27 `curved_interface` floors, which do carry a `size|angle|90` and are refused
 * all the same. So the fabricated 90° sweep an earlier version of this module
 * supplied was not the defect; the primitive was. The corpus says so in tags,
 * three different ways, and {@link radiusIsFeature} is those three ways:
 *
 *   - **111 `shape|option|curved_interface`** — a piece whose *end face* is curved
 *     to meet a curved tile, so the radius is the interface and the interface
 *     eats into the tagged cell. The radius is 2.5 on all 111. 84 are wall runs
 *     with a measured length in W2's table (`AxG` 1.991, `BAxG` 1.547, `QxG`
 *     **3.000** against a tagged `size|width|4`, wrong by a full unit and an exact
 *     76.20 mm multiple) and become a `wall`; 27 are floors with no derivable
 *     width and become `none`. Zero annular sectors among the 111. See
 *     {@link CURVED_INTERFACE_TAG}.
 *   - **60 `inverted`** — `shape|base|inverted` (40) or `shape|curved|inverted`
 *     (20). A square plate with a curved *cut*: the complement of a sector, so
 *     its outline is the square. The 24 with no segment letter measure their
 *     tagged pair — `plain#base+curved+inverted.3x3+2r` is 3.000 × 3.000 and
 *     `.5x5+4r` is 5.000 × 5.000, exactly, and the textured `dungeon_stone`
 *     risers land within 0.060 units of theirs. The other 36 carry
 *     `size|segment|a|b|c` and are handled by {@link isDesignFragment}: tagged
 *     7 × 7, measured 5 × 2, 1.685 × 1.685 and 2 × 5. **27 of these stay `rect`
 *     and W5 must not reshape them** — a complement is not an over-approximation,
 *     and `hasCurveMarker`'s docstring is where that exclusion is recorded.
 *   - **21 `part|lintel`** — the radius is the arch the lintel drops *into*, not
 *     the lintel. Measured 1.31 × 0.48–0.63 against a tagged 2r/3r/4r whose
 *     sector box would be 2–4 units. Every one is an `insert`, reached through a
 *     composition slot rather than placed on a grid, and its only `size|width`
 *     is the non-numeric build marker `sw` or `wot` — so it lands in `none` with
 *     no special case, which is the honest answer for a piece with no grid
 *     outline. The measured boxes are in the sidecar if a later row wants them.
 *
 * 111 + 60 + 21 = 192, exactly W1's refused set among the radius-carrying tiles.
 * After it, **every remaining `arc` tile carries a `size|angle` in (0, 90]**, so
 * `DEFAULT_ARC_SWEEP_DEG` has no reach left and is deleted rather than left as a
 * no-op.
 *
 * ### Every sector carries a band, and every band says where it came from
 *
 * W5's own change. A sector needs an inner and an outer radius and the tag gives
 * one number, so the missing piece is the **band** — which side of the interface
 * radius the material lies on and how wide it is. {@link arcBandOf} resolves it
 * three ways, in this order, over the 1,199 arc tiles:
 *
 * | route      | tiles | how                                                              |
 * | ---------- | ----: | ---------------------------------------------------------------- |
 * | modifier   | 1,090 | a `concave` / `convex` / `radial` (+ `s2w`) tag segment          |
 * | code       |    54 | W2's table, on `size|openlock` — `X` 18, `XA` 18, `F` 6, `V` 6, `VxE` 6 |
 * | default    |    55 | {@link DEFAULT_ARC_BAND}, for a curve that names no band          |
 *
 * and the resulting distribution is `concave` 585, `convex` 397, `radial` 195,
 * `s2w_radial` 10, `disc` 12. Note where `F` lands: W2's table gives it `disc`,
 * not `radial`, because `[0, 2]` at R = 2 *is* a quarter disc — the two bands
 * coincide exactly where the radial band degenerates. Reading the table rather
 * than restating a code-to-band map is what got that right.
 *
 * **The offsets are not here.** `arcBandFor` in `pipeline/tessellation.ts` owns
 * them, this module names the band, and `ARC_BAND_EVIDENCE` in
 * `src/catalog/schema.ts` records what W1 measured per band. Three files, one
 * number each, which is why a band cannot drift into an offset.
 *
 * `ArcBandBasis` comes out **measured on 737 tiles and fallback on 462**: the two
 * bands with no accepted W1 fit behind them are `convex` (attempted 43 times,
 * refused 43 times) and `s2w_radial` (never attempted, because all 10 of its
 * tiles carry a modifier and so were in none of W1's target sets), plus the 55
 * that took the default. The schema refuses a `'measured'` stamp on either of
 * those two bands outright, so the laundering is a parse error rather than a
 * plausible number.
 *
 * ### The letter: W3 was right to decline it, and W1 says why
 *
 * W3 flagged 26 `shingles#roof,corner+…` tiles as "known imprecision" and
 * declined to blacklist them, on the grounds that a single-letter last segment is
 * the corpus's ordinary variant marker across 25 tag families. That reasoning
 * holds. What W1 adds is that the **namespace** carrying the letter is the
 * discriminator, not the letter. Across the 402 curve-marked `rect` md5, error
 * against the tagged pair splits cleanly by where the letter lives:
 *
 * | letter's namespace   | md5 | min error | median | max   |
 * | -------------------- | --: | --------: | -----: | ----: |
 * | none                 | 372 |     0.000 |  0.003 | 2.507 |
 * | `component|<letter>` |  20 | **0.904** |  1.903 | 2.905 |
 * | `shape|curved|<letter>` | 9 |     0.436 |  0.436 | 0.436 |
 * | `shape|floor|<letter>`  | 2 |     0.026 |  0.026 | 0.026 |
 *
 * `component|` is the corpus's **part** namespace, and its *minimum* error
 * (0.904 u = 23 mm) is twice the *maximum* of any other row. Nine
 * `shape|curved|<letter>` tiles sit at 0.436 — identical to their unlettered
 * siblings in the same family (`rough_stone+ruined#curved+floor`, 0.437), so
 * there the letter carries no signal at all. That is W3's point, measured.
 *
 * So {@link isLetteredCurvePart} is `component|<letter>` **and** a curve marker:
 * exactly 20 tiles, all 20 measured, all 20 wrong. The conjunction is not
 * cosmetic — 155 `rect` tiles carry `component|<letter>` and the other 135 were
 * never in W1's work list, so vetoing them would be the unevidenced move W3
 * refused. If a later row measures them, this veto may widen; until then it
 * covers what is measured and nothing else.
 *
 * ### Codes resolve a footprint, and two of them are refused
 *
 * 161 of W3's 741 `none` tiles carry a `size|openlock` code (verified: 161, not
 * the 223 the row was written with — 62 `IL+corner` cells left for `rect` in W3).
 * They are two populations and only one of them can be placed:
 *
 *   - **133 columns**, every one carrying `size|column_shape|<letter>` with the
 *     letter equal to its `size|openlock` code, and no other size tag at all.
 *     `col+I`, `col+O`, `col+L` and `col+X` were measured at 12.70 mm square;
 *     **`col+T` was not** ({@link isMeasured} is `false` for it), so its 14 tiles
 *     are refused and stay in `none`.
 *   - **28 `U`**, which are not 4 × 4 floors. `U` is one of W2's four `ambiguous`
 *     codes and its second meaning is the `Y`/`YA`/`Z`/`ZA` octagon segments —
 *     `dungeon_stone#wall.Z`, `#window+arched.ZA`, `#door+arched+wide.Z`. All 28
 *     carry a `size|depth` and no width, none is measured, and the row's own
 *     evidence is a `plain#base+square.U` 4 × 4 base. Resolving them from the
 *     code would place a wall as a floor, so an `ambiguous` code resolves
 *     nothing.
 *
 * ## Two things in the port still look wrong and are not
 *
 *   - **`radius` is tested before width+depth.** A tile with all three is an arc,
 *     because on a curve the pair names the design family and the radius names
 *     this fragment (§2: median 96 mm divergence on curves).
 *   - **`wall`, `column` and `diag` carry no depth.** Depth is not in the data
 *     for any of them; it is the measured `WALL_THICKNESS_UNITS` constant, which
 *     is why the schema's cases have no field for a guess to be written into.
 */
import type { ArcBand, ArcBandBasis, Footprint } from '../src/catalog'
import {
  MAX_SECTOR_SWEEP_DEG,
  WALL_THICKNESS_UNITS,
  arcBandIsMeasured,
  arcInterfaceRadius,
} from '../src/catalog'

import { numericTagValue, tagValue } from './tags'
import {
  COLUMN_TOKEN_BY_LETTER,
  CURVE_TAG_SEGMENTS,
  TESSELLATION_BY_CODE,
  arcBandFor,
  isMeasured,
} from './tessellation'

/**
 * The tag whose value is a column's port letter, and the column gate.
 *
 * `size|openlock` cannot be the gate. Its letters collide with the `col+`
 * namespace on `I` `L` `O` `T` `X` (W2: *"a consumer must gate on `shape|column`
 * before any letter lookup"*), and `shape|column` is the wrong gate too — it sits
 * on **135** tiles, and the two it has that this does not are
 * `rough_stone#column+low.I` (a 1 × 1 cell) and `rough_stone#column+low.O` (a
 * 2 × 2 right triangle). Both are column-*shaped subjects* on a tile footprint,
 * and calling either a 0.5 × 0.5 pillar would shrink it by a factor of four.
 *
 * This tag is exact: **133 tiles, and its letter equals the tile's
 * `size|openlock` code on all 133** (`L` 50, `O` 34, `I` 24, `T` 14, `X` 11).
 * None of the 133 carries any other size tag — no width, no depth, no radius, no
 * angle — which is why they were all in `none`.
 */
export const COLUMN_SHAPE_TAG = 'size|column_shape'

/**
 * The tag that marks a 45° piece: **130 tiles, and exactly the two families W4
 * adds.**
 *
 * `shape|angled` alone is not it — 260 tiles carry that, including 79
 * `plain#base+angled` bases with no angle tag at all and 48 hex pieces at 60°.
 * `shape|angled|right` is the 45° right-angle marker, it sits on all 130 of the
 * `P`/`PA`/`PB`/`PC`/`O` tiles and on nothing else, all 130 carry
 * `size|angle|45`, and not one carries a radius.
 *
 * The split inside it is the presence of a `size|depth`, and it is total: all 121
 * `P`-family tiles have a width and no depth, and all 9 `O` tiles have both, with
 * width equal to depth (2 × 2 five times, 4 × 4 four times).
 */
export const DIAGONAL_TAG = 'shape|angled|right'

/** The corpus's part namespace — where a letter means "one piece of", not "variant". */
const COMPONENT_PREFIX = 'component|'

/** `part|lintel` — an insert whose `size|radius` is the arch it fits, not its outline. */
const LINTEL_TAG = 'part|lintel'

/** The `shape|corner` family root. 671 records carry it or one of its qualifiers. */
const CORNER_TAG = 'shape|corner'

/**
 * `shape|corner|wall` — the marker on a corner printed as **one L**, both legs
 * together, rather than as a single leg. See {@link isCornerAssembly}.
 */
const CORNER_ASSEMBLY_TAG = 'shape|corner|wall'

/** The mirror class, 133 tiles each. Its presence overrides {@link CORNER_ASSEMBLY_TAG}. */
const CORNER_CHIRALITY_TAGS = ['shape|corner|left', 'shape|corner|right'] as const

/**
 * The one cell size a corner *run* is tagged with, and so the only tagged run
 * {@link cornerWallRun} will correct. All 245 of them; see that docstring for
 * why 3 and 4 are refused rather than extrapolated.
 */
const CORNER_CELL_RUN_UNITS = 2

/**
 * Whether the tile's outline is curved — a **segment-exact** test against W2's
 * {@link CURVE_TAG_SEGMENTS}, which is `curved` / `radial` / `concave` /
 * `convex` and deliberately not `hex`.
 *
 * This is not a veto. It is the flag that says a `rect` footprint is an
 * axis-aligned over-approximation of an annular sector rather than the outline
 * itself: **407 of the 3,449 RECT tiles are curve-marked, and W5 reshaped none of
 * them.** The set is unchanged across the row and `catalog.test.ts` guards both
 * halves of it, because a reshape here would have to invent the radius and the
 * sweep these tiles do not carry: W1 fitted 402 of the 407 and accepted 96, so
 * 306 have no measured sector to be reshaped into and the tagged width/depth pair
 * is the only thing about them that is trusted. A trusted over-approximation is a
 * placement; a fabricated sector is not.
 *
 * **27 of the 407 are `inverted`**, where the box is the outline exactly rather
 * than an over-approximation of it — a square with a curved cut is the
 * *complement* of a sector, and `plain#base+curved+inverted.3x3+2r` measures
 * 3.000 × 3.000 against its tagged 3 × 3. Those 27 must never be reshaped even
 * once a later row has measured the other 380, which is why the verifier reports
 * them as their own row rather than as a footnote to the 407.
 *
 * Two false positives it drops relative to the substring scan it replaces. Only
 * the first exists in the corpus today; both are the same mistake.
 *
 *   - `shape|hex` / `shape|base|hex` — 56 tiles. A hex is a different geometry
 *     family with its own primitive, and calling it a curve places hex corners
 *     as bogus arcs.
 *   - a hypothetical `texture|hexagonal`, or any other segment that merely
 *     *contains* a marker. The near-miss the corpus already has is
 *     `shape|option|curved_interface`; it happens to be harmless because those
 *     111 tiles also carry `shape|curved`.
 */
export function hasCurveMarker(tags: readonly string[]): boolean {
  return tags.some((tag) => tag.split('|').some((segment) => CURVE_TAG_SEGMENTS.includes(segment)))
}

/**
 * Whether this file is one lettered piece of a larger design, so that its
 * `size|width` / `size|depth` pair names the design rather than the piece.
 *
 * 319 live tiles carry `size|segment|<letter>` and **all 319 are now `none`**.
 * W3 reached only 283 of them, because a radius won ahead of this test on the 36
 * `curved+inverted` fragments; W4 stopped reading those radii as outlines
 * ({@link radiusIsFeature}), so the fragment rule now applies to them too — and
 * W1's measurements say it should: `7x7+6r+a` is tagged 7 × 7 and measures 5 × 2.
 *
 * The letters are `a` `b` `c` and the composite `ac` `ax` `cx`.
 *
 * Deliberately narrow: `size|segment` is the corpus's *explicit* fragment
 * marker. It is not the same thing as a single-letter last segment, which 25 tag
 * families use as a plain variant suffix — see {@link isLetteredCurvePart} for
 * the one namespace where W1 found the letter does carry the fact.
 */
export function isDesignFragment(tags: readonly string[]): boolean {
  return tags.some((tag) => tag.startsWith('size|segment|'))
}

/**
 * Whether a single-letter `component|` tag marks this as one part of a curved
 * composite — the same fact `size|segment` states, spelled in the part namespace.
 *
 * **20 tiles**, all of them `shingles#roof,corner+{concave,convex},{a,b}`, all 20
 * measured by W1, all 20 wrong: tagged 1.5 × 1.5 through 3.5 × 3.5, measured
 * 0.596 × 2.185 through 0.596 × 5.041. They are the barge-boards of a hip-roof
 * corner — 0.6-unit strips whose length is the diagonal of the tagged square —
 * and the tagged pair describes the roof, not the board.
 *
 * The curve marker is a conjunct, not decoration; see the module docstring for
 * the error table that separates `component|<letter>` (min 0.904 u) from
 * `shape|curved|<letter>` (max 0.436 u, and identical to its unlettered
 * siblings). 135 further `rect` tiles carry `component|<letter>` without a curve
 * marker and **none of them has been measured**, so they keep their footprint.
 */
export function isLetteredCurvePart(tags: readonly string[]): boolean {
  if (!hasCurveMarker(tags)) return false
  return tags.some((tag) => {
    if (!tag.startsWith(COMPONENT_PREFIX)) return false
    const last = tag.split('|').at(-1) ?? ''
    return last.length === 1 && /^[a-z]$/i.test(last)
  })
}

/**
 * `shape|option|curved_interface` — the tag on a piece whose `size|radius` is the
 * curve it *mates with*, cut into one face, rather than its own outline.
 *
 * **111 tiles, and W1 refused a sector fit on every one.** W4 could only name the
 * three `xG` wall codes, because the other 27 were the `arc` bucket's to settle
 * and this is that row. The two populations end up in different cases and the
 * reason is the same fact in both directions — the interface eats into the tagged
 * cell, so the tagged pair over-states the outline:
 *
 *   - **84 walls** (`AxG` 28, `BAxG` 28, `QxG` 28). A run length is set by the
 *     tessellation, so W2's table has it measured: `AxG` 1.991, `BAxG` 1.547,
 *     `QxG` 3.000 — the last against a tagged `size|width|4`, wrong by a full
 *     unit. They become a `wall` of the measured run.
 *   - **27 floors** (`ExG` 4, `RxG` 8, `SxG` 8, `UxG` 4, `UxG2` 3, by filename
 *     token). Nothing supplies their width. Measured, `ExG` and `SxG` are 1.700
 *     against a tagged 2 and `RxG`/`UxG` are 2.487 against a tagged 4 — over-
 *     stated by 0.300 and 1.513 units, which on a tessellating floor is an
 *     overlap with the neighbour rather than a rounding error. Their codes are
 *     **not in `size|openlock`** (all 27 carry no code tag at all; the letters
 *     live only in the filename), so no table lookup can recover the width
 *     either. They become `none`.
 *
 * Four of the 27 do measure their tagged pair exactly — the three `UxG2` and one
 * of the four `UxG` — and no tag separates them from the 23 that do not, since
 * `UxG` and `UxG2` carry identical size tags. Refusing all 27 is the conservative
 * read of an unseparable set, not a claim about those four.
 */
export const CURVED_INTERFACE_TAG = 'shape|option|curved_interface'

/**
 * Whether a `size|radius` on this tile parameterises a **feature** rather than
 * the outline, so the tile is not an annular sector.
 *
 * The three cases and the 192 tiles they cover exactly are in the module
 * docstring. All three are read off tags the corpus already carries; none is a
 * per-file exception list. W4 spelled the first case as a tuple of three wall
 * codes and W5 replaced that with the tag itself, which is what the corpus
 * actually says and which covers the 27 floors the code tuple could not see —
 * see {@link CURVED_INTERFACE_TAG}.
 */
export function radiusIsFeature(tags: readonly string[]): boolean {
  if (tags.includes(CURVED_INTERFACE_TAG)) return true
  if (tags.includes(LINTEL_TAG)) return true
  return tags.some((tag) => tag.split('|').includes('inverted'))
}

/**
 * The band modifier this tile carries, or `undefined` when it names none.
 *
 * Order is the contract and only one pair of it can fire together: 6 of the 10
 * `s2w` floors also carry `concave`, and the separate-wall inset wins, because
 * W2's research measured `[R−1.5, R]` on exactly those rows (`6r11.25`
 * [4.505, 6.005], `6r22.5` [4.503, 6.003], `6r45` [4.502, 6.001]). Reading them
 * as `concave` would put the material on the wrong side of the radius and 1.5
 * units out.
 *
 * `disc` is deliberately absent: **no modifier spells it.** `V` and `VxE` carry
 * identical tags — `shape|base`, `shape|base|curved`, `shape|curved`,
 * `shape|floor` — and are a quarter disc and an annular band respectively, so the
 * only thing that tells them apart is the code letter. That is why
 * {@link arcBandFromCode} runs at all rather than the modifier scan standing
 * alone.
 */
function arcBandFromModifier(tags: readonly string[]): ArcBand | undefined {
  const segments = new Set(tags.flatMap((tag) => tag.split('|')))
  if (segments.has('s2w') && segments.has('radial')) return 's2w_radial'
  if (segments.has('concave')) return 'concave'
  if (segments.has('convex')) return 'convex'
  if (segments.has('radial')) return 'radial'
  return undefined
}

/**
 * The band W2's table records for this tile's `size|openlock` code, or
 * `undefined`.
 *
 * Read from `TESSELLATION_BY_CODE` rather than restated as a code→band map, so
 * the band has one home; `size.kind === 'arc'` is the gate, which is exactly W2's
 * `CURVE_CODES`. It fires on 54 of the 1,199 arc tiles — `X` 18 and `XA` 18
 * (`concave`), `F` 6 and `V` 6 (`disc`), `VxE` 6 (`radial`) — and every one of
 * the 54 is a mesh W1 measured. `F` being a `disc` rather than a `radial` is the
 * table's call and it is right: `[0, 2]` at R = 2 is where the two coincide.
 *
 * **`ambiguous` is deliberately not a gate here**, unlike in {@link wallRunLength}
 * and {@link diagonalRun}. `X` is flagged ambiguous because the letter is both
 * the radius-4 curved wall band and the four-way column, and that ambiguity is
 * already resolved by the time this runs: a column is caught by
 * {@link columnKind} on `size|column_shape`, whose 133 tiles carry no radius at
 * all, and this tile has a radius and a sweep. The row's *size* is the
 * discriminator — a column row is a `rect`, so `U`'s 4 × 4 floor reading returns
 * `undefined` from here rather than a band.
 *
 * `measured` is separate from the band, and carries the row's own confidence
 * through: `G` (`unmeasured`) and `GA` (`inferred`) both hold a `concave` band
 * that no mesh has confirmed. Zero live tiles carry either code today, so this
 * is a branch written for correctness rather than for coverage.
 */
function arcBandFromCode(tags: readonly string[]): { band: ArcBand; measured: boolean } | undefined {
  const code = tagValue(tags, 'size|openlock')
  if (code === undefined) return undefined
  const row = TESSELLATION_BY_CODE.get(code)
  if (row === undefined || row.size.kind !== 'arc') return undefined
  return { band: row.size.band, measured: isMeasured(row) }
}

/**
 * The band a curve with no modifier and no code falls back to.
 *
 * `radial` — the floor sector, `[R−2, R]`. What is left after the modifiers and
 * the codes is **55 tiles and they are all floor-family curves**: 5 uncoded
 * `plain#base+cf` curved-floor bases, 28 curved risers and 22 curved staircases.
 * The floor band is the one W1 confirms on them — the 5 bases measure [0.000,
 * 2.001] at a tagged R = 2 (5 of 5 accepted) and one riser measures [1.995,
 * 3.993] at a tagged R = 4, both exactly `[R−2, R]`. The other 49 are the same
 * families at other radii and sweeps, and W1's fitter refused them for the reason
 * it refuses most textured meshes: `few-arc-vertices`, surface relief hiding the
 * arc.
 *
 * It is stamped `'fallback'` regardless, because the tile named no band. That is
 * the distinction {@link ArcBandBasis} exists to keep: `radial`'s *rule* is
 * measured, this tile's *assignment* to it is a default, and a consumer must be
 * able to see the difference.
 */
export const DEFAULT_ARC_BAND: ArcBand = 'radial'

/** The band and its provenance, for a tile the classifier has already called an `arc`. */
export function arcBandOf(tags: readonly string[]): { band: ArcBand; basis: ArcBandBasis } {
  const modifier = arcBandFromModifier(tags)
  if (modifier !== undefined) {
    return { band: modifier, basis: arcBandIsMeasured(modifier) ? 'measured' : 'fallback' }
  }
  const coded = arcBandFromCode(tags)
  if (coded !== undefined) {
    const measured = coded.measured && arcBandIsMeasured(coded.band)
    return { band: coded.band, basis: measured ? 'measured' : 'fallback' }
  }
  return { band: DEFAULT_ARC_BAND, basis: 'fallback' }
}

/**
 * Whether a `size|angle` value is a sector sweep this build will place.
 *
 * `(0, 90]`. The upper bound is {@link MAX_SECTOR_SWEEP_DEG}, and it is the
 * domain of the box formula rather than a taste: `arcSectorExtent` is only
 * correct while the extreme point sits on a bounding radius. No live tile is
 * excluded by it — a radius co-occurs only with 11.25, 22.5, 45 and 90 — and the
 * angles that would be, 120 / 240 / 270 / 300, are hex-corner and `IL`-corner
 * markers on tiles that carry no radius.
 */
function isSectorSweep(angle: number | undefined): angle is number {
  return angle !== undefined && angle > 0 && angle <= MAX_SECTOR_SWEEP_DEG
}

/**
 * The measured run of a 45° wall, from W2's table, or `undefined`.
 *
 * The four `P` codes are tagged `size|width|2` without exception, and none of
 * them is 2 units long: `P` 3.536 (= 2.5 √2), `PA` 2.828 (= 2 √2), `PB` 2.835,
 * `PC` 3.334. The tag names the cell the piece cuts across; the table names the
 * piece. Read from `TESSELLATION_BY_CODE` rather than restated, so the number has
 * one home and W2's research note stays its provenance.
 *
 * Gated on W2's own `shape: 'diagonal_wall'`, which is exactly those four codes.
 * That gate — not "has a width" — is what `footprintKind` tests, so the classifier
 * cannot mint a `diag` it has no run for. `docs/verify-catalog-facts.py` mirrors
 * it as the literal code tuple, being unable to read this table.
 */
function diagonalRun(tags: readonly string[]): number | undefined {
  const code = tagValue(tags, 'size|openlock')
  if (code === undefined) return undefined
  const row = TESSELLATION_BY_CODE.get(code)
  if (row === undefined || row.shape !== 'diagonal_wall') return undefined
  if (!isMeasured(row) || row.ambiguous || row.size.kind !== 'rect') return undefined
  return row.size.widthUnits
}

/**
 * The leg of a right isosceles triangle, from the tags, or `undefined`.
 *
 * From the tags and **not** from the table, because `size|openlock|O` covers both
 * sizes and the table can only hold one: its row says 4 × 4 (the `OA` variant it
 * was measured on) while five of the nine tiles are 2 × 2. Requiring width to
 * equal depth is what makes "isosceles" a checked claim rather than an
 * assumption; a `shape|angled|right` tile with an unequal pair would fall through
 * to `rect`, and today none does.
 */
function triangleLeg(tags: readonly string[]): number | undefined {
  const width = numericTagValue(tags, 'size|width')
  const depth = numericTagValue(tags, 'size|depth')
  if (width === undefined || depth === undefined) return undefined
  return width === depth ? width : undefined
}

/**
 * The measured length of a straight wall run, from W2's table, or `undefined`.
 *
 * Applied to every measured `wall_run` row, not to the three `xG` codes alone,
 * and that is the point: on `A` (2), `AS` (2), `BA` (1.5), `D` (3), `IA` (1) and
 * `Q` (4) the table and the tag are two independent statements of the same
 * end-to-end dimension and they agree exactly, so the rule is a **no-op on 2,822
 * tiles** and a correction on 84. A run length is set by the tessellation and not
 * by surface relief, so where the two disagree the tag is what is wrong.
 */
function wallRunLength(tags: readonly string[]): number | undefined {
  const code = tagValue(tags, 'size|openlock')
  if (code === undefined) return undefined
  const row = TESSELLATION_BY_CODE.get(code)
  if (row === undefined || !isMeasured(row) || row.ambiguous) return undefined
  if (row.shape !== 'wall_run' || row.size.kind !== 'rect') return undefined
  return row.size.widthUnits
}

/**
 * Whether any `shape|corner` tag is on the tile — the family root or a qualifier.
 *
 * Segment-exact on the root so `shape|cornerstone`, were it ever minted, would
 * not match; the qualifiers are matched by prefix because the corpus writes
 * fourteen of them (`|left`, `|right`, `|both`, `|wall`, `|low`, `|convex`,
 * `|concave`, `|internal`, `|floor`, `|corbels`, the `full-low-minimal` ladder,
 * and the bare letters `a`–`i`).
 */
function isCornerPiece(tags: readonly string[]): boolean {
  return tags.some((tag) => tag === CORNER_TAG || tag.startsWith(`${CORNER_TAG}|`))
}

/**
 * Whether the tile is an **L-shaped whole-cell** corner rather than a corner
 * *run* — the class row D9 measured and which must keep its tagged dimension.
 *
 * `shape|corner|wall` **without chirality**, and both halves of that are
 * measured rather than reasoned. All 36 such records are `rough_stone` two-wall
 * corner assemblies — one print carrying both legs of the corner — and every one
 * of the 36 measures its tagged size in *both* plan axes, not a 0.5-deep run:
 *
 * | code / tagged | records | measured run | measured across |
 * | --- | ---: | --- | --- |
 * | `IA` / 1 | 3 | 1.020–1.055 | 1.003–1.027 |
 * | `A`  / 2 | 27 | 2.012–2.028 | 2.001–2.013 |
 * | `D`  / 3 | 3 | 3.011–3.026 | 3.010–3.014 |
 * | `Q`  / 4 | 3 | 4.012–4.028 | 4.007–4.012 |
 *
 * All 36 read in full from R2 — no sampling. So `shape|corner|wall` names a
 * piece that *is* its cell, and {@link cornerWallRun} must not shorten it.
 *
 * **Chirality wins where the two markers collide**, on exactly one record:
 * `towne+broken_stucco-a#corner+left+wall+low.2x…` carries `shape|corner|wall`
 * *and* `shape|corner|left`, and measures **1.500 × 0.502** — a single leg, not
 * an L. One record is a thin basis for a precedence rule, which is why it is the
 * *measured* one that decides and not the tag that reads more specific.
 *
 * Their `{shape:'wall', length: n}` footprint is still wrong — an L is not a
 * 0.5-deep run — but that is a **different** defect from this row's and
 * `Footprint` has no case for an L. Recording it here rather than approximating
 * it as a `rect` (which would claim a filled square) or `none` (which would
 * unplace 36 tiles): `footprintKind` is mirrored by
 * `docs/verify-catalog-facts.py` and moving these to another bucket is a
 * classification change, not a parameter one.
 */
function isCornerAssembly(tags: readonly string[]): boolean {
  if (!tags.includes(CORNER_ASSEMBLY_TAG)) return false
  return !CORNER_CHIRALITY_TAGS.some((tag) => tags.includes(tag))
}

/**
 * The run of a corner wall, whose tagged width names the **cell** and not the
 * piece — or `undefined` when the tag is already the run.
 *
 * ## The question three rows refused to guess, settled by reading the meshes
 *
 * Rows A10, B2 and D8 all met this and all declined to answer it, correctly:
 * `docs/templates-plan.md` §9 says *"do not silently write 1.5"* because nothing
 * in the corpus recorded the mitre. Row **D9 measured it** — 157 corner-wall
 * meshes read whole from R2, axis-aligned bounds over every facet — and the
 * corpus's silence turns out to have been hiding one number:
 *
 * | class | records | tagged | **measured run** | thickness |
 * | --- | ---: | ---: | --- | --- |
 * | chirality + code `A` | 224 | 2 | **1.500–1.513** (93 designs) | 0.500–0.658 |
 * | corner, no chirality, code `A` | 21 | 2 | **1.500–1.518** (all 21) | 0.499–0.508 |
 * | corner, no chirality, code `BA` | 6 | 1.5 | **1.500** (all 6) | 0.500 |
 * | *control* — straight `IA`/`BA`/`A`/`D`/`Q` | — | 1/1.5/2/3/4 | **1.000/1.500/2.000/3.000/4.000** | 0.500 |
 *
 * So on the 245 tagged `2` the run is **1.5**, which is exactly a 2-unit cell
 * face less the 0.5 corner column, and it is *identical* to a modular
 * `size|width|1.5` wall. The two corner recipes describe the same geometry and
 * differ only in how many prints it takes. §9's caution stands as written — the
 * number had to be measured — and its second clause is now false: the mitre is
 * in a measurement.
 *
 * ## Why the correction is gated on the tagged run being 2
 *
 * Because the **6 `BA` corner walls refute the general rule.** "A corner wall
 * loses the column's 0.5" would put them at 1.0 and they measure 1.500 exactly,
 * to three decimals, on all six. Their tag already names the run; the `A` tag
 * names the cell. One tag class, two readings — the same shape of ambiguity D8
 * found between the 224 and the 21 `grate+widened.2x2` records, and the same
 * resolution: separate the classes on a tag and measure both sides.
 *
 * `CORNER_CELL_RUN_UNITS` is 2 because 2 is the only cell size any corner *run*
 * in the corpus is tagged with. A 3- or 4-unit corner run would be
 * `3 - 0.5 = 2.5` if the same geometry held, and there is not one to measure —
 * every `D` and `Q` corner in the archive is an {@link isCornerAssembly} L — so
 * the correction refuses to extrapolate off the one cell size it has evidence
 * for.
 */
function cornerWallRun(tags: readonly string[], tagged: number): number | undefined {
  if (tagged !== CORNER_CELL_RUN_UNITS) return undefined
  if (!isCornerPiece(tags) || isCornerAssembly(tags)) return undefined
  return tagged - WALL_THICKNESS_UNITS
}

/**
 * Whether the tile is a column whose footprint may be placed.
 *
 * `'column'` for the four measured letters, `'none'` for `col+T` — which W2 marks
 * `unmeasured` because the only `col+T` STL in the bucket is an 84-byte binary
 * header declaring zero triangles. The other 13 `col+T` tiles are real meshes
 * (3–22 MB) that were simply never in a measurement work list, so the refusal is
 * "nobody measured this row", not "this file is empty". `undefined` when the tile
 * is not a column at all.
 */
function columnKind(tags: readonly string[]): 'column' | 'none' | undefined {
  const letter = tagValue(tags, COLUMN_SHAPE_TAG)
  if (letter === undefined) return undefined
  const row = COLUMN_TOKEN_BY_LETTER.get(letter)
  return row !== undefined && isMeasured(row) ? 'column' : 'none'
}

/** Which of the seven cases this tile falls into. Order of tests is the contract. */
export function footprintKind(tags: readonly string[]): Footprint['shape'] {
  const column = columnKind(tags)
  if (column !== undefined) return column

  if (tags.includes(DIAGONAL_TAG)) {
    if (triangleLeg(tags) !== undefined) return 'tri'
    if (diagonalRun(tags) !== undefined) return 'diag'
  }

  const width = numericTagValue(tags, 'size|width')
  const depth = numericTagValue(tags, 'size|depth')
  const radius = numericTagValue(tags, 'size|radius')

  // A sector needs a sweep, and W4 stopped inventing one. Zero live tiles reach
  // the `none` here — every arc that survives `radiusIsFeature` carries a
  // `size|angle` in (0, 90], and the verifier asserts that count is 0 — but the
  // branch is written rather than left to `resolveFootprint`, so this function
  // and the resolver cannot disagree about a tile's case for any input at all.
  if (radius !== undefined && !radiusIsFeature(tags)) {
    if (radius <= 0) return 'none'
    return isSectorSweep(numericTagValue(tags, 'size|angle')) ? 'arc' : 'none'
  }

  // A curved interface eats into the tagged cell, so the tagged pair over-states
  // the outline. A wall run's real length is in W2's table; a floor's is nowhere,
  // so it is refused rather than placed 0.300–1.513 units long. 84 walls and 27
  // floors, and this branch is why the 27 are not `rect`.
  if (tags.includes(CURVED_INTERFACE_TAG)) {
    return wallRunLength(tags) !== undefined ? 'wall' : 'none'
  }

  if (isDesignFragment(tags)) return 'none'
  if (isLetteredCurvePart(tags)) return 'none'
  if (width !== undefined && depth !== undefined) return 'rect'
  if (width !== undefined) return 'wall'
  return 'none'
}

/** The placement primitive, parameterised. */
export function resolveFootprint(tags: readonly string[]): Footprint {
  switch (footprintKind(tags)) {
    case 'column':
      return { shape: 'column' }
    case 'tri': {
      const leg = triangleLeg(tags)
      if (leg === undefined || leg <= 0) return { shape: 'none' }
      return { shape: 'tri', leg }
    }
    case 'diag': {
      const run = diagonalRun(tags)
      if (run === undefined || run <= 0) return { shape: 'none' }
      return { shape: 'diag', run }
    }
    case 'arc': {
      // The tagged radius is the *interface* radius, and the band turns it into
      // the pair a builder places. `arcBandFor` is W2's, so the offsets have one
      // home; the sweep is the tile's own tag, because a code fixes one sweep
      // (`X` 90, `XA` 45) while the corpus writes the whole ladder.
      const radius = numericTagValue(tags, 'size|radius')
      const sweep = numericTagValue(tags, 'size|angle')
      // Every remaining arc carries a sweep: the 192 that did not, or that meant
      // something else by their radius, are the ones W1 refused a sector fit on,
      // and radiusIsFeature has taken all of them out of this case.
      // `catalog.test.ts` asserts the count is 0.
      if (radius === undefined || radius <= 0 || !isSectorSweep(sweep)) return { shape: 'none' }
      const { band, basis } = arcBandOf(tags)
      const { innerRadiusUnits, outerRadiusUnits } = arcBandFor(band, radius)
      // A band wider than its own outer radius is not a sector. Unreachable on
      // the live corpus — the narrowest band is 0.5 and the smallest radius 2 —
      // but the schema refines on it, so refusing here keeps this function from
      // emitting a record that `CatalogFile.parse` would reject.
      if (outerRadiusUnits <= innerRadiusUnits) return { shape: 'none' }
      return {
        shape: 'arc',
        rIn: innerRadiusUnits,
        rOut: outerRadiusUnits,
        sweep,
        band,
        bandBasis: basis,
      }
    }
    case 'rect': {
      const w = numericTagValue(tags, 'size|width')
      const d = numericTagValue(tags, 'size|depth')
      if (w === undefined || d === undefined || w <= 0 || d <= 0) return { shape: 'none' }
      return { shape: 'rect', w, d }
    }
    case 'wall': {
      // The tessellation's run, else the tag's — then row D9's corner
      // correction, which is the one place the *table* also names the cell
      // rather than the piece: code `A` was measured on a straight
      // `plain#base.A.openlock+topless.stl`, and a corner `A` is 1.5.
      const tagged = wallRunLength(tags) ?? numericTagValue(tags, 'size|width')
      if (tagged === undefined || tagged <= 0) return { shape: 'none' }
      return { shape: 'wall', length: cornerWallRun(tags, tagged) ?? tagged }
    }
    default:
      return { shape: 'none' }
  }
}

/**
 * The synthesised size token, e.g. `4x4`, `2x`, `2r90`.
 *
 * §6: **the literal string `4x4` appears in zero tags**, so without this the
 * most natural query a user types matches nothing. The forms are the corpus's
 * own filename convention rather than an invention — `aztlan#floor.1x1…`,
 * `…#corner,door.2x…`, `plain#base+curved+inverted.3x3+2r…` — which is what
 * makes them the tokens a user who has seen the files will actually type.
 *
 * Three cases have no token of their own, for two different reasons:
 *
 *   - **`diag`** returns `undefined` so that `pipeline/naming.ts` falls back to
 *     the *tagged* token, `2x`. The corpus never writes 3.536 anywhere; it writes
 *     `size|width|2` plus the code letter, and the letter is what tells `P` from
 *     `PC`. A measured run is the right footprint and the wrong search token.
 *   - **`none`** has nothing to say.
 *
 * A `column` does get one — `0.5x0.5`, the measured pillar — and `naming.ts`
 * appends its `size|openlock` letter beside it, because `col+L` and `col+X` are
 * the same square with different ports and the letter is how a user tells them
 * apart.
 *
 * The schema deliberately keeps this off `CatalogRecord` because it is
 * derivable from `foot`; it reaches the search index through the display name.
 */
export function sizeToken(foot: Footprint): string | undefined {
  switch (foot.shape) {
    case 'rect':
      return `${formatUnit(foot.w)}x${formatUnit(foot.d)}`
    case 'wall':
      return `${formatUnit(foot.length)}x`
    case 'arc':
      // The *interface* radius, not either end of the band: `2r90` is what the
      // filenames write and so what a user types. `arcInterfaceRadius` recovers
      // it exactly — see its docstring for why the token is not the band pair.
      return `${formatUnit(arcInterfaceRadius(foot))}r${formatUnit(foot.sweep)}`
    case 'column':
      return `${formatUnit(WALL_THICKNESS_UNITS)}x${formatUnit(WALL_THICKNESS_UNITS)}`
    case 'tri':
      return `${formatUnit(foot.leg)}x${formatUnit(foot.leg)}`
    default:
      return undefined
  }
}

/** `1` not `1.0`, `1.5` not `1.50` — the form the filenames use. */
export function formatUnit(value: number): string {
  return String(Number(value.toFixed(4)))
}
