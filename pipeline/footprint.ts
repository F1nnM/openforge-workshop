/**
 * Footprint resolution — the single primitive the builder places a tile with.
 *
 * **This is a line-by-line port of `footprint_kind` in
 * `docs/verify-catalog-facts.py`, and it must stay one.** That script's output
 * is the authority for every footprint figure the architecture plan quotes
 * (RECT 3,449 / WALL 3,079 / ARC 1,226 / COLUMN 119 / DIAG 121 / TRI 9 /
 * NONE 699), and `catalog.test.ts` runs the script and compares its table
 * against what this module produces. Any "improvement" made here without making
 * it there first will fail that test.
 *
 * The script mirrors the **classification** only. Parameters — a diagonal's run,
 * an `xG` wall's length — come from `pipeline/tessellation.ts`, which is TypeScript
 * and which the script deliberately does not duplicate. The two agree on which
 * bucket a tile is in; the numbers inside the bucket have one home.
 *
 * ## What row W4 changed, and what W1's measurements settled
 *
 * W3 left four cases and 91.5% coverage. W4 adds three cases, corrects what
 * `arc` asserts, and lands at **92.0%** — measured, and not the ~95% the plan
 * predicted before it had any measurements. The movement is seven groups and
 * nothing else:
 *
 * | movement                                | tiles | why                                                     |
 * | --------------------------------------- | ----: | ------------------------------------------------------- |
 * | `none` → `column`                       |   119 | `size|column_shape`, four measured letters              |
 * | `wall` → `diag`                         |   121 | `shape|angled|right` with no depth — `P` `PA` `PB` `PC` |
 * | `rect` → `tri`                          |     9 | `shape|angled|right` with a depth — the `O`/`OA` pair   |
 * | `arc`  → `wall`                         |    84 | the `xG` interface walls, de-arced                      |
 * | `arc`  → `rect`                         |    24 | `inverted` plates whose box the mesh honours            |
 * | `arc`  → `none`                         |    57 | 36 `inverted` fragments, 21 `lintel` inserts            |
 * | `rect` → `none`                         |    20 | lettered `component|` parts of a curved design          |
 *
 * Coverage is not monotone across that list and was not meant to be: 77 tiles
 * *lose* a footprint, because W1 measured them and the footprint they had was
 * wrong. A wrong primitive placed confidently is worse than a refusal.
 *
 * ### A radius is an outline only when nothing reassigns it
 *
 * The load-bearing change. `arc` asserts *the outline is an annular sector*, and
 * W1 fitted a sector to all **165** arc tiles that carry no `size|angle` and
 * **refused every one of them** (`fit: 'rejected'`, 165/165). So the fabricated
 * 90° sweep the previous version of this module supplied was not the defect; the
 * primitive was. The corpus says so in tags, three different ways, and
 * {@link radiusIsFeature} is those three ways:
 *
 *   - **84 `AxG` / `BAxG` / `QxG`** — `shape|option|curved_interface`. A straight
 *     wall run whose *end face* is curved to meet a curved tile. The radius is
 *     the interface, 2.5 on all 84, and the outline is the run. Measured:
 *     `AxG` 1.991 × 0.500, `BAxG` 1.547 × 0.500, `QxG` **3.000** × 0.500 — the
 *     last against a tagged `size|width|4`, wrong by a full unit and an exact
 *     76.20 mm multiple. Zero annular sectors among the 84.
 *   - **60 `inverted`** — `shape|base|inverted` (40) or `shape|curved|inverted`
 *     (20). A square plate with a curved *cut*: the complement of a sector, so
 *     its outline is the square. The 24 with no segment letter measure their
 *     tagged pair — `plain#base+curved+inverted.3x3+2r` is 3.000 × 3.000 and
 *     `.5x5+4r` is 5.000 × 5.000, exactly, and the textured `dungeon_stone`
 *     risers land within 0.060 units of theirs. The other 36 carry
 *     `size|segment|a|b|c` and are handled by {@link isDesignFragment}: tagged
 *     7 × 7, measured 5 × 2, 1.685 × 1.685 and 2 × 5.
 *   - **21 `part|lintel`** — the radius is the arch the lintel drops *into*, not
 *     the lintel. Measured 1.31 × 0.48–0.63 against a tagged 2r/3r/4r whose
 *     sector box would be 2–4 units. Every one is an `insert`, reached through a
 *     composition slot rather than placed on a grid, and its only `size|width`
 *     is the non-numeric build marker `sw` or `wot` — so it lands in `none` with
 *     no special case, which is the honest answer for a piece with no grid
 *     outline. The measured boxes are in the sidecar if a later row wants them.
 *
 * 84 + 60 + 21 = 165, exactly W1's set. After it, **every remaining `arc` tile
 * carries a `size|angle`**, so `DEFAULT_ARC_SWEEP_DEG` has no reach left and is
 * deleted rather than left as a no-op.
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
import type { Footprint } from '../src/catalog'
import { WALL_THICKNESS_UNITS } from '../src/catalog'

import { numericTagValue, tagValue } from './tags'
import {
  COLUMN_TOKEN_BY_LETTER,
  CURVE_TAG_SEGMENTS,
  TESSELLATION_BY_CODE,
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

/**
 * Whether the tile's outline is curved — a **segment-exact** test against W2's
 * {@link CURVE_TAG_SEGMENTS}, which is `curved` / `radial` / `concave` /
 * `convex` and deliberately not `hex`.
 *
 * This is not a veto. It is the flag that says a `rect` footprint is an
 * axis-aligned over-approximation of an annular sector rather than the outline
 * itself: 407 of the 3,449 RECT tiles are curve-marked, and W5, which reshapes
 * `arc` into a sector, is the row that consumes it. **27 of the 407 are
 * `inverted`**, where the box is the outline exactly rather than an
 * over-approximation of it — W5 must not reshape those.
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
 * The three codes whose radius is a curved *interface* on a straight wall run.
 *
 * Named here rather than detected from `shape|option|curved_interface`, which is
 * on **111** tiles: the other 27 are the `ExG`/`RxG`/`SxG`/`UxG`/`UxG2` floors,
 * which carry a `size|angle|90` and belong to W5's 292-tile band question. Their
 * boxes are measured too and their sector fits are also refused — tagged 2 × 1
 * measuring 1.700 × 1.000, tagged 4 × 4 measuring 2.487 × 4.000 — but their
 * width is not tag-derivable and the `arc` bucket is W5's to reshape.
 */
export const XG_INTERFACE_CODES: readonly string[] = ['AxG', 'BAxG', 'QxG']

/**
 * Whether a `size|radius` on this tile parameterises a **feature** rather than
 * the outline, so the tile is not an annular sector.
 *
 * The three cases, and the 165 tiles they cover exactly, are in the module
 * docstring. All three are read off tags the corpus already carries; none is a
 * per-file exception list.
 */
export function radiusIsFeature(tags: readonly string[]): boolean {
  const code = tagValue(tags, 'size|openlock')
  if (code !== undefined && XG_INTERFACE_CODES.includes(code)) return true
  if (tags.includes(LINTEL_TAG)) return true
  return tags.some((tag) => tag.split('|').includes('inverted'))
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
  // `size|angle`, and the verifier asserts that count is 0 — but the branch is
  // written rather than left to `resolveFootprint`, so this function and the
  // resolver cannot disagree about a tile's case for any input at all.
  if (radius !== undefined && !radiusIsFeature(tags)) {
    return numericTagValue(tags, 'size|angle') !== undefined ? 'arc' : 'none'
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
      const radius = numericTagValue(tags, 'size|radius')
      const angle = numericTagValue(tags, 'size|angle')
      // Every remaining arc carries a sweep: the 165 that did not were the 165
      // W1 refused a sector fit on, and radiusIsFeature has taken all of them
      // out of this case. `catalog.test.ts` asserts the count is 0.
      if (radius === undefined || radius <= 0 || angle === undefined) return { shape: 'none' }
      return { shape: 'arc', radius, angle }
    }
    case 'rect': {
      const w = numericTagValue(tags, 'size|width')
      const d = numericTagValue(tags, 'size|depth')
      if (w === undefined || d === undefined || w <= 0 || d <= 0) return { shape: 'none' }
      return { shape: 'rect', w, d }
    }
    case 'wall': {
      const length = wallRunLength(tags) ?? numericTagValue(tags, 'size|width')
      if (length === undefined || length <= 0) return { shape: 'none' }
      return { shape: 'wall', length }
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
      return `${formatUnit(foot.radius)}r${formatUnit(foot.angle)}`
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
