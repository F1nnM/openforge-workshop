/**
 * The OpenLOCK tessellation table — the 38 `size|openlock` codes as typed data.
 *
 * **The codes are footprint identifiers, not sizes.** A code names an *outline
 * plus a set of OpenLOCK port positions*, and nothing else: not height, not
 * texture, not wall-vs-floor, not joinery. Printable Scenery says it outright —
 * "any A-Tile will have the same footprint as any other A-tile" — and adds that
 * "the footprint tessellation of each piece must never change, and the location
 * of the OpenLOCK ports must never alter". So the letter is outline and the clip
 * is joinery, and the two axes really are orthogonal.
 *
 * The immediate consequence is that `I` is the **1 × 1 cell** and a second
 * letter is **junction topology, not inches**: `IL` is "the one-inch cell with
 * corner ports", not "interior L". `IA` is the one exception and belongs to the
 * wall ladder, not the cell family.
 *
 * Six families, each with its own size ladder rather than one global one:
 * straight wall runs (`IA` `BA` `A` `D` `Q` — length only), rect floors, the
 * 1 × 1 cells by port topology (`I` `IO` `II` `IL` `IT` `IX` — all the same
 * size), 45° diagonals, curves, and a **second, colliding namespace** for
 * columns (`col+I` `col+L` `col+O` `col+T` `col+X` — all 0.5 × 0.5, where the
 * letter is the port arrangement). `size|openlock|X` is simultaneously the
 * radius-4 curved wall band and the four-way column, so a consumer **must gate
 * on `shape|column` before any letter lookup**; {@link resolveTessellation}
 * takes that gate as an argument for exactly that reason.
 *
 * **This module is a transcription, and `docs/openlock-tessellation.json` is the
 * other one.** Both come from `docs/openlock-tessellation.md`, which labels the
 * provenance of every number it states. `tessellation.test.ts` compares the two
 * field by field, and that test is what stops them drifting — so a number does
 * not change here without changing the research note and the JSON with it.
 *
 * **The per-row confidence is load-bearing, not decoration.** 35 rows were
 * measured from STL geometry; `G` and `T` were not, and `GA` is an inference.
 * Two of those three still carry dimensions, because the research recovered them
 * from a citable rename (`G`) and from the column rule (`T`) — which is precisely
 * why the label has to survive into code. A number being present is not the same
 * as a number being trustworthy, and a consumer that places a footprint must be
 * able to refuse a row nobody measured. {@link isMeasured} is that check.
 *
 * Nothing imports this module yet. Wiring it into `footprint.ts` and into the
 * schema's footprint union belongs to later rows.
 */
import { GRID_UNIT_MM, WALL_THICKNESS_MM, WALL_THICKNESS_UNITS } from '../src/catalog'

/* ------------------------------------------------------------------ constants */

/**
 * The two measured constants this table rests on, and the unit itself.
 *
 * **1 catalog unit = 1 inch = 25.4 mm, exactly** ({@link GRID_UNIT_MM}), and a
 * **wall is 0.5 units (12.70 mm) thick** ({@link WALL_THICKNESS_UNITS} /
 * {@link WALL_THICKNESS_MM}). Both are re-exported rather than restated, so this
 * module cannot drift from the catalog contract that already owns them.
 *
 * The unit is confirmed three ways: Printable Scenery's own "2″ = 50.8mm /
 * 1″ = 25.4mm / half inch = 12.7mm", `openforge-tutorials`' 1-inch grid, and 84
 * measured STLs whose extents land on exact multiples of 25.4 mm — 12.70, 25.40,
 * 38.10, 50.80, 76.20, 101.60, 152.40, to the last digit the STL stores.
 *
 * The wall thickness is what the project's older "crude width lookup" was
 * missing: **a wall's footprint is `length × 0.5`, not a zero-width line.** It is
 * corroborated by "All walls are .5″ in width at their base" and by
 * `openlock_wall_positive()` in Devon's generator being `cube([12.7, 16, 5.6])`.
 */
export { GRID_UNIT_MM, WALL_THICKNESS_MM, WALL_THICKNESS_UNITS }

/* ---------------------------------------------------------------------- types */

/**
 * How far the research stands behind a row's geometry.
 *
 * - `measured` — an axis-aligned bounding box taken from an STL that carries
 *   this code. 35 of the 38 rows.
 * - `unmeasured` — nothing bearing this code was measurable. `G` has zero live
 *   tiles at all; `T`'s only sample in the bucket is an 84-byte binary STL
 *   header declaring zero triangles. Both rows still carry dimensions — from a
 *   citable rename and from the column rule respectively — and the label says
 *   only that nobody measured them.
 * - `inferred` — `GA`, the 45° counterpart of `G`, reached by argument alone.
 *
 * The tally is **35 measured / 2 unmeasured / 1 inferred**, and the test asserts
 * it rather than trusting this comment.
 */
export type TessellationConfidence = 'measured' | 'unmeasured' | 'inferred'

/**
 * Which footprint primitive a code resolves to.
 *
 * The research lands on six primitives — `rect`, `wall_run`, an annular sector,
 * `column`, `right_triangle` and `diagonal_wall`. The sector is split in two
 * here because the JSON splits it: `arc_sector` is the degenerate quarter-disc
 * case (`F`, `V`, inner radius 0) and `arc_band` is a true annulus. Both carry
 * an {@link ArcSize} and both place with the same primitive.
 *
 * `column` and `right_triangle` and `diagonal_wall` do not exist in the catalog
 * schema's footprint union yet; adding them is a later row's job.
 */
export type TessellationShape =
  | 'wall_run'
  | 'rect'
  | 'column'
  | 'right_triangle'
  | 'diagonal_wall'
  | 'arc_band'
  | 'arc_sector'

/**
 * A junction topology, named by the letter that encodes it.
 *
 * The plumbing-fitting convention, and the whole point of the taxonomy: `O` no
 * ports, `I` two opposite, `L` a corner (two adjacent), `T` three, `X` four.
 * The same convention governs both the `I`-cell family and the `col+` namespace
 * — confirmed independently for columns ("the letter describes the connection
 * angle", and the 2022 rename maps `L-column` → `Column Corner 2`).
 */
export type JunctionTopology = 'none' | 'opposite' | 'corner' | 'tee' | 'cross'

/** Ports per junction. See {@link JunctionTopology}. */
export const JUNCTION_PORT_COUNT: Readonly<Record<JunctionTopology, number>> = {
  none: 0,
  opposite: 2,
  corner: 2,
  tee: 3,
  cross: 4,
}

/** The letter that names each junction, in both namespaces. */
export const JUNCTION_LETTER: Readonly<Record<JunctionTopology, string>> = {
  none: 'O',
  opposite: 'I',
  corner: 'L',
  tee: 'T',
  cross: 'X',
}

/**
 * Where a code's OpenLOCK ports are — carried because it is the taxonomy's
 * actual subject, not because anything reads it yet.
 *
 * Three states, and the difference between them is a difference in sources:
 *
 * - `junction` — the code's letter *is* the port pattern, so the topology is
 *   known exactly. The `I`-cells (`IO` `II` `IL` `IT` `IX`) and the column
 *   letters (`L` `T`, plus the whole `col+` namespace).
 * - `pictorial` — the code is on the OpenLOCK 8.6 reference sheet, which fixes
 *   port *positions* but is **purely pictorial**: every shape is drawn in plan
 *   view with its port slots as dark recesses, labelled with its code and
 *   nothing else, and the sheet carries zero numbers. The positions are fixed
 *   and not transcribable, which is a real state and not the same as unknown.
 * - `unrecorded` — the code is not on the sheet at all (OpenForge adds codes
 *   Printable Scenery never published), and no source states its ports.
 *
 * Nothing here guesses a coordinate. When a row's ports are wanted numerically,
 * the answer is to measure the port recesses in the mesh.
 */
export type PortTopology =
  | {
      readonly kind: 'junction'
      readonly junction: JunctionTopology
      readonly portCount: number
    }
  | { readonly kind: 'pictorial' }
  | { readonly kind: 'unrecorded' }

/**
 * Which side of the interface radius a curve's material sits on.
 *
 * A curved tile's radius tag is the **interface radius** — where the piece meets
 * its neighbour — and the band is offset from it, so the naive reading (radius 4
 * ⇒ outer radius 4) is right for floors and wrong for walls. Printable Scenery
 * states why: "Curved wall: These are curved walls that are .5″ in width … Their
 * width x length dimensions are based on the curved floor tile they connect to."
 * A curved wall is named after the floor it clips to, not after its own extent.
 *
 * The five bands, each verified against measurements to ±0.002 units except
 * where noted, are in {@link ARC_BAND_RULES}. `concave` is the only one whose
 * material lies *outside* the tagged radius — see {@link arcBandSideOfRadius}.
 */
export type ArcBand = 'disc' | 'radial' | 's2w_radial' | 'convex' | 'concave'

/** One band rule: how to get an inner/outer radius pair out of a tagged radius. */
export interface ArcBandRule {
  /** The name the JSON's `primitives.arcConventions` uses. */
  readonly name: string
  /** The band as the research writes it, e.g. `[R, R+0.5]`. */
  readonly expression: string
  /** Radii below the tagged radius, or `null` for the disc, whose inner radius is 0. */
  readonly innerOffsetUnits: number | null
  /** Radii above the tagged radius. Only `concave` is non-zero. */
  readonly outerOffsetUnits: number
  readonly confidence: TessellationConfidence
}

/**
 * The band rules, keyed by modifier.
 *
 * `radial`, `convex` and `concave` are selected by the tile's own
 * `concave`/`convex`/`radial` tag; `s2w_radial` is the separate-wall floor,
 * inset by 0.5 to leave room for its own wall. `disc` is reachable by **code
 * lookup only** — no size modifier selects it, which is exactly why `V` and
 * `VxE` are indistinguishable from their tags and distinguishable only by their
 * code letter.
 *
 * Two facts fall straight out: the edge bands are 0.5 wide, the same 0.5 a
 * straight wall has (a curved wall is a straight wall bent), and the radial
 * floor band is exactly 2 units wide at every radius — which is why it
 * degenerates to a quarter disc at R = 2, where `R − 2 = 0`.
 */
export const ARC_BAND_RULES: Readonly<Record<ArcBand, ArcBandRule>> = {
  disc: {
    name: 'disc_sector',
    expression: '[0, R]',
    innerOffsetUnits: null,
    outerOffsetUnits: 0,
    confidence: 'measured',
  },
  radial: {
    name: 'radial_floor_sector',
    expression: '[R-2, R]',
    innerOffsetUnits: 2,
    outerOffsetUnits: 0,
    confidence: 'measured',
  },
  s2w_radial: {
    name: 's2w_radial_floor_sector',
    expression: '[R-1.5, R]',
    innerOffsetUnits: 1.5,
    outerOffsetUnits: 0,
    confidence: 'measured',
  },
  convex: {
    name: 'convex_wall_band',
    expression: '[R-0.5, R]',
    innerOffsetUnits: 0.5,
    outerOffsetUnits: 0,
    confidence: 'measured',
  },
  concave: {
    name: 'concave_wall_band',
    expression: '[R, R+0.5]',
    innerOffsetUnits: 0,
    outerOffsetUnits: 0.5,
    confidence: 'measured',
  },
}

/** Dimensions of anything with an axis-aligned rectangular outline, in catalog units. */
export interface RectSize {
  readonly kind: 'rect'
  readonly widthUnits: number
  readonly depthUnits: number
}

/**
 * Dimensions of a curve: an annular sector.
 *
 * Two radius pairs live here on purpose.
 *
 * - `interfaceRadiusUnits` + `band` are the **design intent**, and
 *   {@link arcBandFor} turns them into the exact pair a builder should place.
 * - `innerRadiusUnits` / `outerRadiusUnits` / `bandWidthUnits` are the
 *   **evidence**, verbatim from the measured bounding box. They agree with the
 *   rule to ±0.002 units for the plain untextured bases and drift up to 0.016
 *   for `XA`, whose sample is the only plain base that does not land clean.
 *
 * Place from the rule; cite the measurement.
 */
export interface ArcSize {
  readonly kind: 'arc'
  /** The `size|radius` value: where this piece meets its neighbour. */
  readonly interfaceRadiusUnits: number
  readonly band: ArcBand
  readonly innerRadiusUnits: number
  readonly outerRadiusUnits: number
  /** Sweep in degrees. The corpus only ever uses the bisection ladder 90 → 45 → 22.5 → 11.25. */
  readonly angleDeg: number
  readonly bandWidthUnits: number
}

/** Dimensions in catalog units. 1 unit = 1 inch = {@link GRID_UNIT_MM} mm. */
export type TessellationSize = RectSize | ArcSize

/** Where a row's dimensions came from. */
export type TessellationEvidence =
  | { readonly kind: 'measured_stl'; readonly source: string }
  | { readonly kind: 'derived'; readonly source: string }

/** One of the 38 `size|openlock` codes. */
export interface TessellationCode {
  /** The `size|openlock` tag value, verbatim. */
  readonly code: string
  readonly shape: TessellationShape
  /** Live tiles carrying this code in the catalog build the research measured. */
  readonly liveTiles: number
  /** Times the code appears as a filename size token. Lower than `liveTiles` where a design has parts. */
  readonly filenameTokenCount: number
  /** Whether the letter appears on the OpenLOCK 8.6 reference sheet — the *letter*, not necessarily this meaning: the sheet's `L` is a 3 × 1 wall and its `T` a 4 × 4 curved floor. */
  readonly onCheatSheet: boolean
  readonly confidence: TessellationConfidence
  /**
   * Whether `size|openlock|<code>` covers more than one distinct footprint.
   *
   * Four codes do: `I` (1 × 1 cell / `col+I`), `O` (2 × 2 triangle / 4 × 4 `OA`
   * / `col+O`), `U` (4 × 4 floor / the `Y` `YA` `Z` `ZA` octagon segments) and
   * `X` (radius-4 band / `col+X`). **`size|openlock` is not a key you can join
   * on** — key on the resolved primitive instead.
   */
  readonly ambiguous: boolean
  /** The scanner's `size|width`, or `null` where it emits none. */
  readonly nominalWidthUnits: number | null
  /** The scanner's `size|depth`, or `null` where it emits none. */
  readonly nominalDepthUnits: number | null
  readonly size: TessellationSize
  readonly ports: PortTopology
  readonly evidence: TessellationEvidence
}

/**
 * One `col+` filename token: the colliding namespace.
 *
 * All five are 0.5 × 0.5, one wall-thickness square. "All columns are based on
 * .5″ x .5″ pillars, so are categorized by the orientation of their ports
 * (Corner, Straight, End, T-junction, X-junction) plus height." That list names
 * five arrangements without binding them to letters; the letter → junction map
 * in {@link JunctionTopology} is what binds them, and it is why `O` reads as
 * "none" here rather than as "end".
 */
export interface ColumnToken {
  /** The filename token, e.g. `col+X`. */
  readonly token: string
  /** The `size|openlock` letter it collides with. */
  readonly letter: string
  /** Live tiles, or `null` where no section of the research splits them out (`col+O`). */
  readonly liveTiles: number | null
  readonly confidence: TessellationConfidence
  readonly size: RectSize
  readonly ports: PortTopology
  readonly evidence: TessellationEvidence
}

/* ------------------------------------------------------------ row constructors */

function rect(widthUnits: number, depthUnits: number): RectSize {
  return { kind: 'rect', widthUnits, depthUnits }
}

function arc(
  interfaceRadiusUnits: number,
  band: ArcBand,
  innerRadiusUnits: number,
  outerRadiusUnits: number,
  angleDeg: number,
  bandWidthUnits: number,
): ArcSize {
  return { kind: 'arc', interfaceRadiusUnits, band, innerRadiusUnits, outerRadiusUnits, angleDeg, bandWidthUnits }
}

function junction(topology: JunctionTopology): PortTopology {
  return { kind: 'junction', junction: topology, portCount: JUNCTION_PORT_COUNT[topology] }
}

function pictorial(): PortTopology {
  return { kind: 'pictorial' }
}

function unrecorded(): PortTopology {
  return { kind: 'unrecorded' }
}

function measuredStl(source: string): TessellationEvidence {
  return { kind: 'measured_stl', source }
}

function derived(source: string): TessellationEvidence {
  return { kind: 'derived', source }
}

/* ----------------------------------------------------------------- the columns */

/**
 * A column's footprint: **0.5 × 0.5 units**, exactly one wall-thickness square.
 *
 * Measured on `col+I`, `col+O`, `col+L` and `col+X` at 12.70 × 12.70 mm, and
 * stated independently by Printable Scenery. Derived from
 * {@link WALL_THICKNESS_UNITS} rather than written as `0.5` twice, because the
 * two being equal is the research's actual finding.
 */
export const COLUMN_FOOTPRINT_UNITS: RectSize = rect(WALL_THICKNESS_UNITS, WALL_THICKNESS_UNITS)

/** The prefix that puts a token in the column namespace. */
export const COLUMN_TOKEN_PREFIX = 'col+'

/**
 * The five `col+` tokens.
 *
 * Keyed by token, not by letter, because the letters collide with
 * {@link TESSELLATION_CODES} — `X` is both the radius-4 curved wall band (18
 * tiles) and the four-way column (11 tiles), and the catalog tag does not record
 * which. Disambiguation is on `shape|column`, never on the letter alone.
 */
export const COLUMN_TOKENS: readonly ColumnToken[] = [
  {
    token: 'col+I',
    letter: 'I',
    liveTiles: 24,
    confidence: 'measured',
    size: rect(0.5, 0.5),
    ports: junction('opposite'),
    evidence: measuredStl('col+I column, measured 0.500 x 0.500'),
  },
  {
    token: 'col+L',
    letter: 'L',
    liveTiles: 50,
    confidence: 'measured',
    size: rect(0.499, 0.5),
    ports: junction('corner'),
    evidence: measuredStl('dungeon_stone#column+corner+low.col+L.openforge,side.stl'),
  },
  {
    token: 'col+O',
    letter: 'O',
    liveTiles: null,
    confidence: 'measured',
    size: rect(0.5, 0.5),
    ports: junction('none'),
    evidence: measuredStl('col+O column, measured 0.500 x 0.500'),
  },
  {
    token: 'col+T',
    letter: 'T',
    liveTiles: 14,
    confidence: 'unmeasured',
    size: rect(0.5, 0.5),
    ports: junction('tee'),
    evidence: derived(
      'The column rule (Printable Scenery 2022: all columns are 0.5 x 0.5 inch pillars). The only ' +
        'col+T STL in the bucket is an 84-byte binary header declaring zero triangles.',
    ),
  },
  {
    token: 'col+X',
    letter: 'X',
    liveTiles: 11,
    confidence: 'measured',
    size: rect(0.5, 0.503),
    ports: junction('cross'),
    evidence: measuredStl('col+X column, measured 0.500 x 0.503'),
  },
]

/* ------------------------------------------------------------------- the table */

/**
 * The closed vocabulary: **38 codes**, every `size|openlock` value the scanner
 * can emit. 36 occur on live tiles; `G` and `GA` are defined and carry none.
 *
 * Ordered by code so a reader can find one. The distribution is brutally
 * top-heavy — the five wall-run codes (`A` `BA` `Q` `D` `IA`) are 2,822 tiles,
 * 70% of all coded tiles, so getting `length × 0.5` right is worth more than
 * everything else in this table combined.
 */
export const TESSELLATION_CODES: readonly TessellationCode[] = [
  {
    code: 'A',
    shape: 'wall_run',
    liveTiles: 1095,
    filenameTokenCount: 680,
    onCheatSheet: true,
    confidence: 'measured',
    ambiguous: false,
    nominalWidthUnits: 2,
    nominalDepthUnits: null,
    size: rect(2, 0.5),
    ports: pictorial(),
    evidence: measuredStl('plain#base.A.openlock+topless.stl'),
  },
  {
    code: 'A+S',
    shape: 'rect',
    liveTiles: 11,
    filenameTokenCount: 11,
    onCheatSheet: false,
    confidence: 'measured',
    ambiguous: false,
    nominalWidthUnits: 2,
    nominalDepthUnits: 1.5,
    size: rect(2, 1.753),
    ports: unrecorded(),
    evidence: measuredStl('foundation#base+wall,chimney.A+S.openlock+topless,magnetic+flex.stl'),
  },
  {
    code: 'AS',
    shape: 'wall_run',
    liveTiles: 35,
    filenameTokenCount: 35,
    onCheatSheet: true,
    confidence: 'measured',
    ambiguous: false,
    nominalWidthUnits: 2,
    nominalDepthUnits: null,
    size: rect(2, 0.5),
    ports: pictorial(),
    evidence: measuredStl('plain#base.AS.magnetic+flex.stl'),
  },
  {
    code: 'AxG',
    shape: 'wall_run',
    liveTiles: 28,
    filenameTokenCount: 28,
    onCheatSheet: false,
    confidence: 'measured',
    ambiguous: false,
    nominalWidthUnits: 2,
    nominalDepthUnits: null,
    size: rect(1.991, 0.5),
    ports: unrecorded(),
    evidence: measuredStl('plain#base+curved.AxG.openlock.stl'),
  },
  {
    code: 'BA',
    shape: 'wall_run',
    liveTiles: 519,
    filenameTokenCount: 471,
    onCheatSheet: true,
    confidence: 'measured',
    ambiguous: false,
    nominalWidthUnits: 1.5,
    nominalDepthUnits: null,
    size: rect(1.5, 0.5),
    ports: pictorial(),
    evidence: measuredStl('plain#base.BA.openlock+topless.stl'),
  },
  {
    code: 'BAxG',
    shape: 'wall_run',
    liveTiles: 28,
    filenameTokenCount: 28,
    onCheatSheet: false,
    confidence: 'measured',
    ambiguous: false,
    nominalWidthUnits: 1.5,
    nominalDepthUnits: null,
    size: rect(1.547, 0.5),
    ports: unrecorded(),
    evidence: measuredStl('plain#base+curved.BAxG.magnetic+flex.stl'),
  },
  {
    code: 'D',
    shape: 'wall_run',
    liveTiles: 364,
    filenameTokenCount: 334,
    onCheatSheet: true,
    confidence: 'measured',
    ambiguous: false,
    nominalWidthUnits: 3,
    nominalDepthUnits: null,
    size: rect(3, 0.5),
    ports: pictorial(),
    evidence: measuredStl('plain#base.D.openlock+topless.stl'),
  },
  {
    code: 'D+SA',
    shape: 'rect',
    liveTiles: 8,
    filenameTokenCount: 8,
    onCheatSheet: false,
    confidence: 'measured',
    ambiguous: false,
    nominalWidthUnits: 3,
    nominalDepthUnits: 1.5,
    size: rect(3, 1.892),
    ports: unrecorded(),
    evidence: measuredStl('goblin_fireplace#base.D+SA.openlock+topless,magnetic+flex.stl'),
  },
  {
    code: 'E',
    shape: 'rect',
    liveTiles: 12,
    filenameTokenCount: 12,
    onCheatSheet: true,
    confidence: 'measured',
    ambiguous: false,
    nominalWidthUnits: 2,
    nominalDepthUnits: 2,
    size: rect(2, 2),
    ports: pictorial(),
    evidence: measuredStl('plain#base+electronics+square.E.openlock+topless.stl'),
  },
  {
    code: 'EA',
    shape: 'rect',
    liveTiles: 7,
    filenameTokenCount: 7,
    onCheatSheet: true,
    confidence: 'measured',
    ambiguous: false,
    nominalWidthUnits: 3,
    nominalDepthUnits: 3,
    size: rect(3, 3),
    ports: pictorial(),
    evidence: measuredStl('plain#base+square.EA.openlock+topless.stl'),
  },
  {
    code: 'F',
    shape: 'arc_sector',
    liveTiles: 6,
    filenameTokenCount: 6,
    onCheatSheet: true,
    confidence: 'measured',
    ambiguous: false,
    nominalWidthUnits: null,
    nominalDepthUnits: null,
    size: arc(2, 'disc', 0, 2, 90, 2),
    ports: pictorial(),
    evidence: measuredStl('plain#base+curved.F.magnetic+flex.stl'),
  },
  {
    code: 'G',
    shape: 'arc_band',
    liveTiles: 0,
    filenameTokenCount: 0,
    onCheatSheet: true,
    confidence: 'unmeasured',
    ambiguous: false,
    nominalWidthUnits: null,
    nominalDepthUnits: null,
    size: arc(2, 'concave', 2, 2.5, 90, 0.5),
    ports: pictorial(),
    evidence: derived('openforge-tutorials sets/openlock.md rename to curved+concave,wall.2r90-degree, measured [2.000, 2.500] at 90.00 degrees. No tile carries the code G itself.'),
  },
  {
    code: 'GA',
    shape: 'arc_band',
    liveTiles: 0,
    filenameTokenCount: 0,
    onCheatSheet: false,
    confidence: 'inferred',
    ambiguous: false,
    nominalWidthUnits: null,
    nominalDepthUnits: null,
    size: arc(2, 'concave', 2, 2.5, 45, 0.5),
    ports: unrecorded(),
    evidence: derived('Inferred as the 45-degree counterpart of G by the same rename argument. Unmeasured.'),
  },
  {
    code: 'I',
    shape: 'rect',
    liveTiles: 108,
    filenameTokenCount: 72,
    onCheatSheet: true,
    confidence: 'measured',
    ambiguous: true,
    nominalWidthUnits: 1,
    nominalDepthUnits: 1,
    size: rect(1, 1),
    ports: pictorial(),
    evidence: measuredStl('plain#base+square.I.openlock+topless,magnetic+flex.stl'),
  },
  {
    code: 'IA',
    shape: 'wall_run',
    liveTiles: 363,
    filenameTokenCount: 330,
    onCheatSheet: true,
    confidence: 'measured',
    ambiguous: false,
    nominalWidthUnits: 1,
    nominalDepthUnits: null,
    size: rect(1, 0.5),
    ports: pictorial(),
    evidence: measuredStl('plain#base.IA.openlock+topless.stl'),
  },
  {
    code: 'II',
    shape: 'rect',
    liveTiles: 11,
    filenameTokenCount: 11,
    onCheatSheet: false,
    confidence: 'measured',
    ambiguous: false,
    nominalWidthUnits: 1,
    nominalDepthUnits: 1,
    size: rect(1.011, 1),
    ports: junction('opposite'),
    evidence: measuredStl('dungeon_stone%eroded#s_system,corner+low.II.openforge,side.stl'),
  },
  {
    code: 'IL',
    shape: 'rect',
    liveTiles: 86,
    filenameTokenCount: 26,
    onCheatSheet: false,
    confidence: 'measured',
    ambiguous: false,
    nominalWidthUnits: 1,
    nominalDepthUnits: 1,
    size: rect(1, 1),
    ports: junction('corner'),
    evidence: measuredStl('plain#base,thick_wall.IL+corner,270.openlock+topless.stl'),
  },
  {
    code: 'IO',
    shape: 'rect',
    liveTiles: 22,
    filenameTokenCount: 22,
    onCheatSheet: false,
    confidence: 'measured',
    ambiguous: false,
    nominalWidthUnits: 1,
    nominalDepthUnits: 1,
    size: rect(1.004, 1),
    ports: junction('none'),
    evidence: measuredStl('dungeon_stone%eroded#s_system,corner+low.IO.openforge,side.stl'),
  },
  {
    code: 'IT',
    shape: 'rect',
    liveTiles: 28,
    filenameTokenCount: 28,
    onCheatSheet: false,
    confidence: 'measured',
    ambiguous: false,
    nominalWidthUnits: 1,
    nominalDepthUnits: 1,
    size: rect(1, 1),
    ports: junction('tee'),
    evidence: measuredStl('legacy_sewers#base,thick_wall.IT.openlock+topless.stl'),
  },
  {
    code: 'IX',
    shape: 'rect',
    liveTiles: 18,
    filenameTokenCount: 18,
    onCheatSheet: false,
    confidence: 'measured',
    ambiguous: false,
    nominalWidthUnits: 1,
    nominalDepthUnits: 1,
    size: rect(1.015, 1.014),
    ports: junction('cross'),
    evidence: measuredStl('dungeon_stone%block#s_corner.IX.openforge,side.stl'),
  },
  {
    code: 'L',
    shape: 'column',
    liveTiles: 50,
    filenameTokenCount: 0,
    onCheatSheet: true,
    confidence: 'measured',
    ambiguous: false,
    nominalWidthUnits: null,
    nominalDepthUnits: null,
    size: rect(0.499, 0.5),
    ports: junction('corner'),
    evidence: measuredStl('dungeon_stone#column+corner+low.col+L.openforge,side.stl'),
  },
  {
    code: 'O',
    shape: 'right_triangle',
    liveTiles: 43,
    filenameTokenCount: 5,
    onCheatSheet: true,
    confidence: 'measured',
    ambiguous: true,
    nominalWidthUnits: 2,
    nominalDepthUnits: 2,
    size: rect(4, 4),
    ports: pictorial(),
    evidence: measuredStl('dungeon_stone%eroded#floor,angled.OA.openforge.stl (OA variant)'),
  },
  {
    code: 'P',
    shape: 'diagonal_wall',
    liveTiles: 24,
    filenameTokenCount: 24,
    onCheatSheet: true,
    confidence: 'measured',
    ambiguous: false,
    nominalWidthUnits: 2,
    nominalDepthUnits: null,
    size: rect(3.536, 0.711),
    ports: pictorial(),
    evidence: measuredStl('dungeon_stone#wall+low.P.openforge,side.stl'),
  },
  {
    code: 'PA',
    shape: 'diagonal_wall',
    liveTiles: 12,
    filenameTokenCount: 12,
    onCheatSheet: true,
    confidence: 'measured',
    ambiguous: false,
    nominalWidthUnits: 2,
    nominalDepthUnits: null,
    size: rect(2.828, 0.522),
    ports: pictorial(),
    evidence: measuredStl('dungeon_stone#wall+low.PA.openforge.stl'),
  },
  {
    code: 'PB',
    shape: 'diagonal_wall',
    liveTiles: 40,
    filenameTokenCount: 24,
    onCheatSheet: true,
    confidence: 'measured',
    ambiguous: false,
    nominalWidthUnits: 2,
    nominalDepthUnits: null,
    size: rect(2.835, 0.52),
    ports: pictorial(),
    evidence: measuredStl('dungeon_stone#wall+low.PB+mirror.openforge.stl'),
  },
  {
    code: 'PC',
    shape: 'diagonal_wall',
    liveTiles: 45,
    filenameTokenCount: 27,
    onCheatSheet: true,
    confidence: 'measured',
    ambiguous: false,
    nominalWidthUnits: 2,
    nominalDepthUnits: null,
    size: rect(3.334, 0.52),
    ports: pictorial(),
    evidence: measuredStl('dungeon_stone#wall+low.PC+mirror.openforge,side.stl'),
  },
  {
    code: 'Q',
    shape: 'wall_run',
    liveTiles: 481,
    filenameTokenCount: 429,
    onCheatSheet: true,
    confidence: 'measured',
    ambiguous: false,
    nominalWidthUnits: 4,
    nominalDepthUnits: null,
    size: rect(4, 0.5),
    ports: pictorial(),
    evidence: measuredStl('plain#base.Q.openlock+topless.stl'),
  },
  {
    code: 'QxG',
    shape: 'wall_run',
    liveTiles: 28,
    filenameTokenCount: 28,
    onCheatSheet: false,
    confidence: 'measured',
    ambiguous: false,
    nominalWidthUnits: 4,
    nominalDepthUnits: null,
    size: rect(3, 0.5),
    ports: unrecorded(),
    evidence: measuredStl('plain#base+curved.QxG.magnetic+flex.stl'),
  },
  {
    code: 'R',
    shape: 'rect',
    liveTiles: 7,
    filenameTokenCount: 7,
    onCheatSheet: true,
    confidence: 'measured',
    ambiguous: false,
    nominalWidthUnits: 4,
    nominalDepthUnits: 2,
    size: rect(4, 2),
    ports: pictorial(),
    evidence: measuredStl('plain#base+square.R.openlock+topless.stl'),
  },
  {
    code: 'S',
    shape: 'rect',
    liveTiles: 182,
    filenameTokenCount: 131,
    onCheatSheet: true,
    confidence: 'measured',
    ambiguous: false,
    nominalWidthUnits: 2,
    nominalDepthUnits: 1,
    size: rect(2, 1),
    ports: pictorial(),
    evidence: measuredStl('plain#base+square.S.openlock+topless.stl'),
  },
  {
    code: 'SA',
    shape: 'rect',
    liveTiles: 108,
    filenameTokenCount: 82,
    onCheatSheet: true,
    confidence: 'measured',
    ambiguous: false,
    nominalWidthUnits: 3,
    nominalDepthUnits: 1,
    size: rect(3, 1),
    ports: pictorial(),
    evidence: measuredStl('plain#base+square.SA.openlock+topless.stl'),
  },
  {
    code: 'SB',
    shape: 'rect',
    liveTiles: 153,
    filenameTokenCount: 113,
    onCheatSheet: true,
    confidence: 'measured',
    ambiguous: false,
    nominalWidthUnits: 4,
    nominalDepthUnits: 1,
    size: rect(4, 1),
    ports: pictorial(),
    evidence: measuredStl('plain#base+square.SB.openlock+topless.stl'),
  },
  {
    code: 'T',
    shape: 'column',
    liveTiles: 14,
    filenameTokenCount: 0,
    onCheatSheet: true,
    confidence: 'unmeasured',
    ambiguous: false,
    nominalWidthUnits: null,
    nominalDepthUnits: null,
    size: rect(0.5, 0.5),
    ports: junction('tee'),
    evidence: derived('The column rule: all columns are 0.5 x 0.5 units (Printable Scenery 2022 naming thread). Not measured - the only col+T STL in the bucket is an 84-byte header declaring zero triangles.'),
  },
  {
    code: 'U',
    shape: 'rect',
    liveTiles: 35,
    filenameTokenCount: 7,
    onCheatSheet: true,
    confidence: 'measured',
    ambiguous: true,
    nominalWidthUnits: 4,
    nominalDepthUnits: 4,
    size: rect(4, 4),
    ports: pictorial(),
    evidence: measuredStl('plain#base+square.U.openlock+topless.stl'),
  },
  {
    code: 'V',
    shape: 'arc_sector',
    liveTiles: 6,
    filenameTokenCount: 6,
    onCheatSheet: true,
    confidence: 'measured',
    ambiguous: false,
    nominalWidthUnits: null,
    nominalDepthUnits: null,
    size: arc(4, 'disc', 0, 4, 90, 4),
    ports: pictorial(),
    evidence: measuredStl('plain#base+curved.V.openlock.stl'),
  },
  {
    code: 'VxE',
    shape: 'arc_band',
    liveTiles: 6,
    filenameTokenCount: 6,
    onCheatSheet: false,
    confidence: 'measured',
    ambiguous: false,
    nominalWidthUnits: null,
    nominalDepthUnits: null,
    size: arc(4, 'radial', 2, 4, 90, 2),
    ports: unrecorded(),
    evidence: measuredStl('plain#base+curved.VxE.openlock.stl'),
  },
  {
    code: 'X',
    shape: 'arc_band',
    liveTiles: 29,
    filenameTokenCount: 18,
    onCheatSheet: true,
    confidence: 'measured',
    ambiguous: true,
    nominalWidthUnits: null,
    nominalDepthUnits: null,
    size: arc(4, 'concave', 4, 4.5, 90, 0.5),
    ports: pictorial(),
    evidence: measuredStl('plain#base+curved.X.openlock.stl'),
  },
  {
    code: 'XA',
    shape: 'arc_band',
    liveTiles: 18,
    filenameTokenCount: 18,
    onCheatSheet: true,
    confidence: 'measured',
    ambiguous: false,
    nominalWidthUnits: null,
    nominalDepthUnits: null,
    size: arc(4, 'concave', 3.984, 4.489, 45, 0.505),
    ports: pictorial(),
    evidence: measuredStl('plain#base+curved.XA.openlock.stl'),
  },]

/* ------------------------------------------------------------------- lookup */

/** The 38 codes by `size|openlock` value. The *tile* namespace only. */
export const TESSELLATION_BY_CODE: ReadonlyMap<string, TessellationCode> = new Map(
  TESSELLATION_CODES.map((entry) => [entry.code, entry]),
)

/** The five `col+` tokens by letter. The *column* namespace only. */
export const COLUMN_TOKEN_BY_LETTER: ReadonlyMap<string, ColumnToken> = new Map(
  COLUMN_TOKENS.map((entry) => [entry.letter, entry]),
)

/** Which of the two colliding namespaces a lookup landed in. */
export type TessellationLookup =
  | { readonly namespace: 'tile'; readonly entry: TessellationCode }
  | { readonly namespace: 'column'; readonly entry: ColumnToken }

/**
 * Resolve a size token, honouring the column gate.
 *
 * The letters `I` `L` `O` `T` `X` mean one thing as a tile code and another as a
 * column, and `size|openlock` does not say which. So the caller passes the gate:
 * `column: true` when the tile carries `shape|column`. A token that already
 * spells the namespace out (`col+X`) needs no gate.
 *
 * ```ts
 * resolveTessellation('X')                    // tile: the r4 90° concave band
 * resolveTessellation('X', { column: true })  // column: 0.5 × 0.5
 * resolveTessellation('col+X')                // column, gate or no gate
 * ```
 *
 * `undefined` for an unknown token, including a column gate on a letter that has
 * no column — the five column letters are the whole namespace, and inventing a
 * `col+Q` would be inventing a tile.
 */
export function resolveTessellation(
  token: string,
  options: { readonly column?: boolean } = {},
): TessellationLookup | undefined {
  const letter = token.startsWith(COLUMN_TOKEN_PREFIX) ? token.slice(COLUMN_TOKEN_PREFIX.length) : undefined
  if (letter !== undefined || options.column === true) {
    const entry = COLUMN_TOKEN_BY_LETTER.get(letter ?? token)
    return entry === undefined ? undefined : { namespace: 'column', entry }
  }
  const entry = TESSELLATION_BY_CODE.get(token)
  return entry === undefined ? undefined : { namespace: 'tile', entry }
}

/**
 * Whether a row's geometry was measured, and so whether a builder may place it.
 *
 * `false` for `G` and `T` (unmeasured) and for `GA` (inferred) — all three of
 * which nonetheless carry dimensions. That is the point: the numbers are the
 * research's best reconstruction, and a placement is a claim about the physical
 * world, so the two are allowed to disagree about whether to proceed.
 */
export function isMeasured(row: { readonly confidence: TessellationConfidence }): boolean {
  return row.confidence === 'measured'
}

/* --------------------------------------------------------------------- curves */

/**
 * The inner/outer radius pair a band rule produces for a tagged radius.
 *
 * Clamped at zero, because the radial floor band is 2 units wide at every radius
 * and so degenerates to a quarter disc at R = 2.
 */
export function arcBandFor(
  band: ArcBand,
  interfaceRadiusUnits: number,
): { readonly innerRadiusUnits: number; readonly outerRadiusUnits: number } {
  const rule = ARC_BAND_RULES[band]
  const inner = rule.innerOffsetUnits === null ? 0 : interfaceRadiusUnits - rule.innerOffsetUnits
  return {
    innerRadiusUnits: Math.max(0, inner),
    outerRadiusUnits: interfaceRadiusUnits + rule.outerOffsetUnits,
  }
}

/** Which side of the tagged radius a band's material lies on. Only `concave` is outside it. */
export function arcBandSideOfRadius(band: ArcBand): 'inside' | 'outside' {
  return ARC_BAND_RULES[band].outerOffsetUnits > 0 ? 'outside' : 'inside'
}

/**
 * The bounding box of an annular sector whose centre sits at a box corner.
 *
 * `bboxX = Rout − Rin·cos θ`, `bboxY = Rout·sin θ`, verified to ±0.002 units
 * against 8 independent plain-base samples. Valid for `θ ≤ 90°`, which is every
 * sweep the corpus uses; a wider sweep pushes the extreme point off the radii
 * and needs the quadrant crossings instead. At 90° it degenerates to
 * `Rout × Rout`, which is why the 90° cases had to be fitted by locating the
 * centre rather than by solving these two equations.
 */
export function arcSectorExtent(
  innerRadiusUnits: number,
  outerRadiusUnits: number,
  angleDeg: number,
): { readonly widthUnits: number; readonly depthUnits: number } {
  const theta = (angleDeg * Math.PI) / 180
  return {
    widthUnits: outerRadiusUnits - innerRadiusUnits * Math.cos(theta),
    depthUnits: outerRadiusUnits * Math.sin(theta),
  }
}

/** The axis-aligned extent of any row's outline, curves included. */
export function boundingBoxUnits(size: TessellationSize): {
  readonly widthUnits: number
  readonly depthUnits: number
} {
  return size.kind === 'rect'
    ? { widthUnits: size.widthUnits, depthUnits: size.depthUnits }
    : arcSectorExtent(size.innerRadiusUnits, size.outerRadiusUnits, size.angleDeg)
}

/** The codes whose footprint is an annular sector. */
export const CURVE_CODES: readonly string[] = TESSELLATION_CODES.filter(
  (entry) => entry.size.kind === 'arc',
).map((entry) => entry.code)

/**
 * Tag segments that genuinely mark curved geometry.
 *
 * A **segment**, not a substring: the current classifier scans the joined tag
 * string, so `shape|hex` matches `hex` and a hypothetical `texture|hexagonal`
 * would too. Segment-exact matching against this list is the fix.
 */
export const CURVE_TAG_SEGMENTS: readonly string[] = ['curved', 'radial', 'concave', 'convex']

/**
 * Tag segments the substring scan catches that are **not** curves.
 *
 * `hex` is a different geometry family with its own primitive, and treating it
 * as an arc places hex corners as bogus curves.
 */
export const NON_CURVE_TAG_SEGMENTS: readonly string[] = ['hex']

/**
 * The sweeps a curve actually takes: a bisection ladder, with the finer
 * subdivisions appearing only at the larger radii. Matches the generator's own
 * vocabulary — `2r90°`, `4r` at 90/45/22.5, `6r` at 90/45/22.5/11.25.
 */
export const CURVE_SWEEP_ANGLES_DEG: readonly number[] = [11.25, 22.5, 45, 90]

/**
 * Angles that are never a sweep.
 *
 * 60/120/240/300 are hex-corner angles and carry no radius. 270 is one of the
 * `IL` corner markers on a 1 × 1 cell. **90 is deliberately absent**: it is both
 * a real sweep and the other `IL` corner marker, so the discriminator is the
 * presence of `size|radius`, never the angle on its own. Treating any
 * `size|angle` as a sweep places 84 hex and corner tiles as arcs, wrongly.
 */
export const NON_SWEEP_ANGLES_DEG: readonly number[] = [60, 120, 240, 270, 300]
