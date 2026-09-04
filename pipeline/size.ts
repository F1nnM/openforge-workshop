/**
 * Size resolution — which grid cell a record occupies, and what it refuses.
 *
 * `pipeline/footprint.ts` answers *what primitive is this*. This module answers
 * the different question a template slot asks: **what cell of the lattice does
 * it fill, and how far does it run along a face of that cell.** The two are not
 * the same reading of the same numbers, and three of the seven primitives are
 * where they come apart — see {@link cellExtentUnits}.
 *
 * `src/template/size.ts` carries the *predicate* a generated slot uses and the
 * whole encoding decision. This file is the ground truth that predicate is
 * measured against, and it **emits nothing**.
 *
 * That is proved the way row B2 proved its own 0-byte property — by sha256 over
 * a rebuilt corpus and not by asserting a byte count — and the digest already
 * exists: `tools/stamp/derivation.lock.json` records the sha256 of the emitted
 * `{tags, records}` pair, `tools/stamp/lock.ts` checks it in **both** directions,
 * and `npm run stamp` reports `content 7bf89a1d617714ff` unchanged with
 * `PIPELINE_VERSION` still 2. Under `version.ts`'s biconditional that is the
 * whole statement: the digest did not move, so no derivation changed, so no
 * version had to. `size.test.ts` adds the vocabulary half — the table is still
 * 930 strings and carries no `size|cell|` or `size|run|` tag — and prices the
 * encoding this row declined.
 *
 * ## The chain, re-derived
 *
 * The plan's §2.4 gives it as *"`foot` dimensions, then the tagged
 * `size|width` / `size|depth` pair, then `sizeCode`"* covering **8,384 of 8,702
 * records (96.3%)**, and that figure reproduces **exactly** — but only with two
 * corrections to the chain itself, both measured:
 *
 * | rung | records | note |
 * | --- | ---: | --- |
 * | 1. the footprint's own extent | 7,976 | every primitive but `none` |
 * | 2. `size\|column_shape` | **14** | the `col+T` columns, whose footprint W2 refused |
 * | 3. the tagged `size\|width` / `size\|depth` pair | 394 | 366 pairs plus 28 depth-only |
 * | 4. ~~`sizeCode`~~ | **0** | **dead** — see below |
 * | | **8,384** | **96.3%**, and the 318 refusals are the plan's four groups exactly |
 *
 *   - **Rung 2 is not in the plan and 8,384 does not reach without it.** The 14
 *     `col+T` records carry `size|column_shape|T` and no other size tag, and
 *     `footprintKind` returns `none` for them because W2 marks `col+T`
 *     *unmeasured*. But their **size** is not in doubt — the letter is a port
 *     count, all five letters are the same 12.70 mm square, and W2 measured four
 *     of the five. A refused *placement primitive* is not a refused size.
 *   - **Rung 3 of the plan is dead: `sizeCode` resolves 0 records.** Not one of
 *     the 318 that survive the rungs above carries a `size|openlock` code *at
 *     all* — let alone one of the five with a published width — so the rung is a
 *     no-op in both of its jobs. It is not a corrector either:
 *     `src/assembly/sizeCode.ts` measured the five codes agreeing with the
 *     tagged width on **all 2,822** records carrying both. So it is not
 *     implemented here, and `size.test.ts` asserts the reach is 0 so that
 *     a corpus which gives it work fails loudly rather than silently losing it.
 *
 * The 318 refusals are the plan's list, reproduced to the record: **234 inserts**
 * (correct — an insert has no grid size), **26 decor**, **56 hex and 120-degree
 * pieces whose only `size|` tag is a `size|angle`**, and **2 `wot` walls**.
 *
 * **The plan's ninth figure does not reproduce.** *"Only 8 floors have neither a
 * tagged pair nor a footprint"* is **0 floors**, under all four readings of
 * "floor" the emitted index supports — `role|floor`, `kinds` including `floor`,
 * a `shape|floor` tag, or either of the first two. The 318 contain no floor of
 * any kind.
 *
 * ## `foot` is not corroboration, and its corrections are 28 rather than 56
 *
 * The plan is right that `foot` is derived from the tags — it equals the tagged
 * `size|width` / `size|depth` pair on **3,449 of 3,449** `rect` records, exactly
 * — and right that its value is therefore corrections and refusals. The numbers
 * are different from the ones it quotes.
 *
 * There are **84** records where a `wall` footprint's length disagrees with the
 * tagged `size|width`, not 56, and all 84 carry `shape|option|curved_interface`.
 * They are three codes in equal thirds, and only one third is a correction:
 *
 * | code | tagged | measured | delta | grid cell | correction? |
 * | --- | ---: | ---: | ---: | ---: | --- |
 * | `AxG` | 2 | 1.991 | 0.009 | 2 | **no** — snaps back to the tag |
 * | `BAxG` | 1.5 | 1.547 | 0.047 | 1.5 | **no** — snaps back to the tag |
 * | `QxG` | 4 | 3.000 | **1.000** | **3** | **yes**, and by a whole unit |
 *
 * So the plan's *"56 corrections, all wrong by exactly 1.000 u"* is two disjoint
 * facts crossed: **28** records are wrong by exactly 1.000 u, and the **56** that
 * are not are wrong by 0.009 and 0.047 — mesh relief against a clean tagged
 * number, on a piece whose cell is exactly what the tag says. Reading those 56
 * as corrections would give 56 walls a size no slot can ask for.
 * {@link import('../src/template/size').LATTICE_TOLERANCE_UNITS} is what keeps
 * them, and its bounds are measured in both directions.
 *
 * ## What a cell costs against what a dimension costs
 *
 * 96.3% of records resolve *a dimension*. Only **7,590 (87.2%)** resolve a
 * **cell a slot can name** — a pair of lattice values — and the 794-record gap
 * is not a data problem, it is three refusals this module makes deliberately:
 *
 * | refused | records | why |
 * | --- | ---: | --- |
 * | sectors under 90 degrees | **645** | the box is irrational and reachable on no snap |
 * | `diag` | **121** | the extent is along the piece's own 45 degree axes |
 * | a `size\|depth` with no width | **28** | half a cell is not a cell |
 *
 * The 554 sectors **at** 90 degrees keep their cell, because there the box
 * degenerates to `rOut x rOut` and lands on the lattice on **554 of 554**.
 * `src/builder/canvas/sector.ts` states the same fact from the other side:
 * *"two concentric sub-90 degree sectors share a centre only if their anchors
 * differ by rIn.cos θ, which is irrational for the corpus's 45, 22.5 and 11.25
 * degree sweeps and so is not reachable on the 0.5 snap."*
 *
 * The result is **48 distinct grid cells** and **10 distinct runs**, both fully
 * enumerated in `size.test.ts`, and the tail keeps its half units — the
 * plan's `2x0.5` (14), `1x0.5` (3) and `1.5x1.5` (2) are all there, alongside
 * the `2.5x2.5` (203) and `4.5x4.5` (87) cells that only the 90 degree sectors
 * have.
 */
import type { Footprint, Layer } from '../src/catalog'
import { WALL_THICKNESS_UNITS } from '../src/catalog'
import type { ResolvedSize } from '../src/template/size'
import { isOnLattice, snapToLattice } from '../src/template/size'

import { numericTagValue, tagValue } from './tags'
import { COLUMN_SHAPE_TAG } from './footprint'
import { arcSectorExtent } from './tessellation'

/** The extent, in grid units, before the lattice test. */
interface Extent {
  readonly w: number
  readonly d: number
}

/**
 * The axis-aligned box a primitive occupies **on the grid**, or `undefined`.
 *
 * Four of the seven cases are the same numbers `src/builder/canvas`'s
 * `footprintExtent` returns and one is deliberately not, which is why this is
 * written here rather than imported: `footprintExtent` is the *piece's own
 * frame*, and its own docblock says so — *"for a `diag` this is the extent of
 * the piece along its own axes, so the box it occupies on the grid is
 * `rotatedExtent(extent, rotation + shape.angle)` and not this."* A `diag`'s
 * grid box is that of a 45 degree-turned strip, and it is on the lattice for no
 * value in the corpus: the four measured runs are 2.828, 2.835, 3.334 and 3.536,
 * and 3.536 is within 0.036 of 3.5 — inside the lattice tolerance — so a
 * distance test alone would hand 24 diagonal walls a 3.5 x 0.5 cell built out of
 * a hypotenuse. The refusal is therefore structural, on the primitive, exactly
 * as `offsets.ts#edgeRun` refuses the same three cases.
 *
 * `pipeline` cannot import `@/builder/canvas` — it needs DOM lib, and
 * `tsconfig.node.json` has none — so `arcSectorExtent` comes from
 * `pipeline/tessellation.ts`, which is where the formula lives and which
 * `sector.ts` itself restates from.
 */
export function cellExtentUnits(foot: Footprint): Extent | undefined {
  switch (foot.shape) {
    case 'rect':
      return { w: foot.w, d: foot.d }
    case 'wall':
      return { w: foot.length, d: WALL_THICKNESS_UNITS }
    case 'column':
      return { w: WALL_THICKNESS_UNITS, d: WALL_THICKNESS_UNITS }
    case 'tri':
      return { w: foot.leg, d: foot.leg }
    case 'arc': {
      const { widthUnits, depthUnits } = arcSectorExtent(foot.rIn, foot.rOut, foot.sweep)
      return { w: widthUnits, d: depthUnits }
    }
    case 'diag':
    case 'none':
      return undefined
  }
}

/**
 * Whether this primitive presents a run along an axis-aligned face of its cell.
 *
 * The same three-yes / four-no split as `offsets.ts#edgeRun`, and
 * `size.test.ts` asserts the two agree on every case — including that the run
 * equals the cell's `w`, which is what lets one resolved size answer both a
 * `cell` and a `run` predicate.
 */
function hasEdgeRun(foot: Footprint): boolean {
  return foot.shape === 'rect' || foot.shape === 'wall' || foot.shape === 'column'
}

/**
 * One record's grid size, or `undefined` when the corpus does not say.
 *
 * The chain is the module docblock's table and the order is the contract. Reads
 * `tags` only for the two rungs the footprint cannot answer, so a record whose
 * primitive resolves never has its tags consulted about its size at all — which
 * is what makes the 28 `QxG` corrections stick rather than being overwritten by
 * the `size|width|4` sitting right beside them.
 */
export function resolveGridSize(foot: Footprint, tags: readonly string[]): ResolvedSize | undefined {
  const extent = cellExtentUnits(foot)
  if (extent !== undefined) return snap(extent, hasEdgeRun(foot))

  /* The 14 `col+T` records. A refused placement primitive is not a refused
     size: all five column letters are the same measured 12.70 mm square and the
     letter is a port count. See the module docblock's rung 2. */
  if (tagValue(tags, COLUMN_SHAPE_TAG) !== undefined) {
    return snap({ w: WALL_THICKNESS_UNITS, d: WALL_THICKNESS_UNITS }, true)
  }

  /* The tagged pair, and **both halves are required**. `numericTagValue`
     returns `undefined` for `size|width|wot` (50) and `size|width|sw` (33),
     which are build markers wearing a width tag — all 83 have no `build|` tag of
     their own and all 50 `wot` sit under `wall_on_tile` — so they cannot become
     a size here and `size.test.ts` asserts that all 83 refuse. */
  const width = numericTagValue(tags, 'size|width')
  const depth = numericTagValue(tags, 'size|depth')
  if (width === undefined || depth === undefined) return undefined
  /* No run: a record that reaches this rung has `foot: {shape:'none'}`, so it has
     no face to lie along and `placeTemplateSlots` refuses it as `no-footprint`
     one step later. A run here would be a claim the geometry cannot honour. */
  return snap({ w: width, d: depth }, false)
}

/** The lattice test and the snap, in one place so the two cannot disagree. */
function snap(extent: Extent, run: boolean): ResolvedSize | undefined {
  if (!isOnLattice(extent.w) || !isOnLattice(extent.d)) return undefined
  const w = snapToLattice(extent.w)
  return { w, d: snapToLattice(extent.d), run: run ? w : null }
}

/**
 * Why a record has no grid size. Reported, never emitted.
 *
 * Six values and they partition the 1,112 refusals exactly — `size.test.ts`
 * asserts both that every refusal gets one and that the six sum to 1,112.
 */
export type SizeRefusal =
  /** A sector under 90 degrees: the box is irrational. 645. */
  | 'sub-quarter-arc'
  /** A 45 degree run, whose extent is along its own axes. 121. */
  | 'diagonal'
  /** A `size|depth` with no `size|width`, or the reverse. 28. */
  | 'half-a-pair'
  /** An insert: reached through a composition slot, never placed on the grid. 234. */
  | 'insert'
  /** A hex or 120-degree piece: no square-lattice position at all. 56. */
  | 'off-lattice-family'
  /** Nothing in the corpus says. 28 — 26 decor and the 2 `wot` walls. */
  | 'unstated'

/**
 * Which refusal applies, for a record {@link resolveGridSize} returned
 * `undefined` for.
 *
 * Ordered most-specific first and the order is the contract: an insert can also
 * be a sub-90 degree sector (25 of the 234 are), and the *geometric* reason is
 * the one worth reporting because it is the one that would survive the insert
 * being placed directly.
 */
export function sizeRefusalOf(foot: Footprint, tags: readonly string[], layer: Layer): SizeRefusal {
  if (foot.shape === 'arc') return 'sub-quarter-arc'
  if (foot.shape === 'diag') return 'diagonal'
  const width = numericTagValue(tags, 'size|width')
  const depth = numericTagValue(tags, 'size|depth')
  if (width !== undefined || depth !== undefined) return 'half-a-pair'
  if (layer === 'insert') return 'insert'
  if (tags.some((tag) => tag.split('|').includes('hex'))) return 'off-lattice-family'
  return 'unstated'
}
