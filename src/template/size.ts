/**
 * A slot's **size**, as a predicate over the tags the corpus already carries.
 *
 * ## Why this exists, and why it is not part of the family key
 *
 * Row **B4** generates one template family per `(role, form, build)` and there
 * are **52** of them — recomputed in `pipeline/size.test.ts`, and exactly the
 * plan's figure. Put size into the key instead and the count multiplies: keyed
 * on `(role, cell, build)` with the grid cell `pipeline/size.ts#resolveGridSize`
 * resolves, the corpus needs **217** families; keyed on the whole `Footprint`,
 * **277**, with **50 singletons** — the one plan figure of the three that does
 * reproduce; keyed on `pipeline/footprint.ts`'s own `sizeToken`, **249**. The
 * plan quotes 285 and `pipeline/size.test.ts` reproduces none of the three
 * spellings at that number — see its `does not reproduce` block — but every
 * spelling is between **4.2x and 5.3x** the 52, so the plan's *conclusion* is
 * confirmed by all of them and only its arithmetic is not.
 *
 * So size is a **parameter of one placed instance**, shared by all of its slots,
 * and this module is what turns that one parameter into a per-slot requirement.
 *
 * The parameter's *domain* is the set of cells a family's own records resolve
 * to, and it is short: **295 cells over all 52 families, median 4 per family,
 * maximum 31** — a control, not a 48-item dropdown. **Five families have an
 * empty domain** and B4 has to be able to generate a family with no size control
 * rather than one that matches nothing: `wall|diagonal|separate wall` (121
 * records, the extent is a hypotenuse), `wall|hex|thick wall` (56, no
 * square-lattice position), `decor|straight` (26), `wall|octagon|separate wall`
 * (20) and `floor|octagon` (8). 231 records, and `pipeline/size.test.ts` names
 * all five.
 *
 * ## The predicate is derived from B2's anchor, not authored per slot
 *
 * {@link SlotRule.anchor} already says whether a slot fills the template's cell,
 * runs along one of its faces, or sits in a corner. That is exactly the
 * information a size requirement needs, so there is nothing to author:
 *
 * | anchor | predicate | why |
 * | --- | --- | --- |
 * | `cell` | the fill's cell is **congruent** to the instance's | a 2x2 floor slot must not admit a 4x4 floor |
 * | `edge` | the fill's **run equals the face** it is anchored to, less any corner span | measured below: the same condition B2's closure already checks |
 * | `corner` | none | inexpressible over the corpus's vocabulary, and measured to cost nothing |
 *
 * ### `edge` is exact, and that is measured rather than chosen
 *
 * The brief this row was written from asks whether a slot's size should be
 * *exact* or *compatible-with-the-cell*. It is exact, and the evidence is that
 * **exactness is not a second condition at all** — it is the one
 * `offsets.ts#placeTemplateSlots` already applies. Over B2's 1,215 walked
 * combinations there are **1,211 edge slots**, and the exact run predicate and
 * the closure verdict agree on **1,211 of 1,211**:
 *
 * | run vs the face | B2's verdict | slots |
 * | --- | --- | ---: |
 * | exact | placed | **1,050** |
 * | not exact | `over-run` | 25 |
 * | no run at all | `no-run` | 104 |
 * | no run at all | `no-footprint` | 32 |
 *
 * **There is no `exact/<a doubt>` row and no `not exact/placed` row** — zero
 * disagreements in either direction, and `size.test.ts` asserts the whole table
 * rather than the total so a new disagreement cannot hide inside a sum.
 *
 * Row **D9** moved 16 slots from `not exact` to `exact` — the 8 external-corner
 * failures counted once per wall, whose runs a `size|width|2` tag made 2 units
 * long against a face their column leaves 1.5 of. The meshes measure 1.500, so
 * they were exact all along and the tag was not.
 *
 * A *compatible* reading — "the fill fits inside the face" — would admit the
 * **25** slots whose run is short of the face, which are exactly the 25
 * `wall-on-tile` combinations B2 reports as `fails`. Since D9 there is no inexact
 * slot that over-runs its face at all, so the looser predicate buys nothing but
 * candidates the layout then refuses, which is the *needs a choice* the plan's
 * §3.2 wants the auto-fill never to produce.
 *
 * The brief's supporting figure — *"a wall's run equal to the floor cell's width
 * on 980 of 1,143"* — is B2's per-convention **verdict** split and not a run
 * comparison: `wall-on-tile` is 980 `closes` / 25 `fails` / 138 `undecidable`.
 * The 163 non-closures are therefore **25 size mismatches and 138 fills with no
 * run to compare**, so exactness costs 25 combinations rather than 163.
 *
 * ## Zero bytes, and the alternative is priced
 *
 * Every ref below is a tag the corpus **already** carries, so the emitted index
 * is byte-identical and `src/composition/candidates.ts` needs no change — the
 * same property row B1 bought its axes for, without B1's 865 B.
 *
 * A derived `size|run|<r>` tag was measured and **declined**. With `emit.ts`'s
 * own brotli-11 path, appending it to every record that has a run costs:
 *
 * | derived tag | vs a rebuild of the shipped artefact | vs a fresh build at `PAYLOAD_EPOCH` |
 * | --- | ---: | ---: |
 * | `size\|run\|<r>` | **+300 B** | **+756 B** |
 * | `size\|cell\|<w>x<d>` | +1,266 B | +1,812 B |
 * | both | +1,792 B | +2,501 B |
 *
 * Two baselines because they disagree and the disagreement is row B1's own
 * lesson, kept for the same reason its file keeps three: brotli is not additive
 * over 5.9 MB, so a "this field costs N bytes" figure is a fact about one
 * artefact at one epoch and never a rate. `pipeline/size.test.ts` re-measures
 * the fresh-build column every run.
 *
 * The price is not what declines it — the budget has 145,232 B free. What
 * declines it is that the tag table moves **930 -> 940** strings (988 for both),
 * and 930 is a hard assertion in `pipeline/role.test.ts`,
 * `pipeline/catalog.test.ts` and `src/composition/corpus.test.ts`, a quoted
 * figure in thirteen more docblocks across `pipeline/**`, `src/search/**`,
 * `src/catalog/**`, `src/assembly/**` and `src/composition/**` — including this
 * directory's own `rules.ts` — and an input to `src/search/textIndex.ts`, where
 * row B6 records that B1's identical change already **dropped `decor` from 133
 * search hits to 15**. Ten strings for the last 10.2% of the run predicate is
 * not that trade, and {@link RUN_UNREACHABLE} is what it buys.
 *
 * **Row D9 raised the stake on this one from 1.26% to 10.2%**, and it is now the
 * clearest case for the derived tag in the repository. The 245 corner walls it
 * corrected are tagged `size|width|2` and measure 1.5, and no tag in the
 * vocabulary can say 1.5 about them — so the only way a run ref reaches them is
 * a `size|run|1.5` the pipeline derives from `foot`. Until then
 * {@link RUN_DENY_TAGS} keeps them out of a run ref that would have drawn them
 * a quarter unit through a column. The upgrade is priced and left on the table
 * for **B4/B5**, which own the family table those records would serve.
 *
 * ## This module imports only `./rules`
 *
 * Same boundary as B2's, same reason. `tsconfig.node.json` is a composite
 * project that rejects an import of a file outside its own list (TS6307), so
 * `pipeline/size.ts` can only reach a `src/` module named there —
 * `src/template/size.ts` is now, beside `src/template/rules.ts`, and the two
 * together import nothing else at all.
 *
 * The tag *spellings* therefore have one home rather than two, which matters
 * more here than the boundary does: `pipeline/build.ts` already fails the build
 * on a `require` ref that resolves to nothing, so a second copy of
 * `size|width|<n>` drifting out of step would be caught — but only after B4 had
 * generated a family that matches nothing.
 */
import type { SlotAnchor, SlotRule, SlotSide, TemplateLayout } from './rules'

/**
 * The grid the whole catalog is authored on, in grid units.
 *
 * **Every dimension in the corpus is a multiple of this**, which is what makes
 * {@link snapToLattice} a recovery rather than a rounding: the 48 distinct grid
 * cells and 10 distinct runs `pipeline/size.test.ts` enumerates are all multiples
 * of 0.5, and so are all 23 `size|width` / `size|depth` tag values.
 *
 * The same number as `src/builder/canvas`'s `SNAP_STEP.fine` and as
 * `@/catalog`'s `WALL_THICKNESS_UNITS`, and deliberately not imported from
 * either — this module's import list has to stay `./rules`, and B2's
 * `offsets.ts` records the same trade for the same reason.
 */
export const GRID_UNITS = 0.5

/**
 * How far off the lattice a measured dimension may be and still be recognised
 * as the lattice value it is, in grid units.
 *
 * **Bracketed by measurement on both sides, and the gap is a factor of 1.8.**
 * The two dimensions in the corpus that need snapping are the curved-interface
 * wall runs `pipeline/tessellation.ts` measures — `AxG` at 1.991 against a
 * tagged 2 (0.009 off) and `BAxG` at 1.547 against a tagged 1.5 (**0.047**
 * off, the largest) — and the nearest thing that must **not** snap is the 45
 * degree annular sector `1.5-2 @45`, whose 0.939 x 1.414 box sits **0.0858**
 * off. So 0.05 lies in an empty interval and both bounds are asserted rather
 * than assumed.
 *
 * A tolerance is needed at all because `foot` is the only independent evidence
 * this resolution has and it is a *mesh* measurement. Without one, `AxG`'s cell
 * would be 1.991 x 0.5 — a size no slot can ask for, on a wall that fills a
 * 2-unit face.
 */
export const LATTICE_TOLERANCE_UNITS = 0.05

/**
 * A grid cell, both dimensions on the lattice.
 *
 * `w` and `d` and not an `Extent`, deliberately: `@/builder/canvas`'s `Extent`
 * is the same shape and this module cannot import it, and a *cell* is
 * additionally guaranteed to be a multiple of {@link GRID_UNITS} — which an
 * extent is not, on 701 of the corpus's records.
 */
export interface GridSize {
  readonly w: number
  readonly d: number
}

/**
 * One record's resolved size: the cell it occupies and, when it has one, the run
 * it presents along an axis-aligned face.
 *
 * `run` is `null` on 929 of the 7,590 records that have a cell, and the three
 * reasons are structural rather than data gaps — a sector meets a face at a
 * tangent, a triangle's interesting edge is its hypotenuse, and a piece with no
 * placeable footprint has no face to lie along at all. It is otherwise always
 * equal to `w`, which `size.test.ts` asserts against `offsets.ts#edgeRun` over
 * every case of `Footprint`.
 */
export interface ResolvedSize extends GridSize {
  readonly run: number | null
}

/** What a slot requires of the size of whatever fills it. */
export type SizePredicate =
  /** The fill's cell is exactly `w` x `d`. */
  | { readonly kind: 'cell'; readonly w: number; readonly d: number }
  /** The fill runs exactly `run` units along the face it is anchored to. */
  | { readonly kind: 'run'; readonly run: number }
  /**
   * No size requirement.
   *
   * The honest answer for a `corner` anchor, and it costs nothing: the 133
   * corner-square pieces in the corpus carry `size|column_shape` in **five**
   * spellings (`L` 50, `O` 34, `I` 24, `T` 14, `X` 11) and no size tag at all,
   * and `require` is exact tag equality — so no single ref reaches them and a
   * five-ref `require` would be an intersection that reaches none. All 8 corner
   * slots of the shipped recipes already admit exactly **one** footprint
   * (B2: `column`, on 8 of 8), so there is nothing for a size predicate to
   * narrow.
   */
  | { readonly kind: 'none' }

/** The exact-match refs a predicate resolves to. Both lists may be empty. */
export interface SizeRefs {
  readonly require: readonly string[]
  readonly deny: readonly string[]
}

/**
 * The three tags that make a `size|width` ref mean the run it says.
 *
 * `require: ['size|width|2']` alone is wrong on **459** records and every one of
 * them carries one of these three:
 *
 *   - **`shape|angled|right`** — 130 records, and not one of them has a run
 *     along a cell face. The 121 `diag` are 45 degree wall runs, every one
 *     tagged `size|width|2`, whose measured length is the hypotenuse (`P` 3.536,
 *     `PA` 2.828, `PB` 2.835, `PC` 3.334); the 9 `tri` present a diagonal edge
 *     and are tagged 2 x 2 five times and 4 x 4 four times.
 *   - **`shape|option|curved_interface`** — 111 records whose end face is cut to
 *     meet a curve, so the tagged cell over-states the piece. 84 are walls whose
 *     runs are measured at 1.991 (`AxG`, tagged 2), 1.547 (`BAxG`, tagged 1.5)
 *     and **3.000** (`QxG`, tagged 4).
 *   - **`shape|corner`** and its qualifiers — row **D9**'s, and the reason it is
 *     here is the same sentence as the other two. 245 corner walls are tagged
 *     `size|width|2` and **measure 1.500** (157 meshes read whole from R2; see
 *     `pipeline/footprint.ts#cornerWallRun`), because on a corner the tag names
 *     the cell and the piece is the cell face less the 0.5 column. Without the
 *     deny, a `run: 2` edge slot's refs admit all 245 — a 1.5 wall offered for a
 *     2-unit face, which is the *"wall drawn through another wall"* this list
 *     exists to prevent.
 *
 * Denying all three leaves **zero** false positives among records with a
 * placeable footprint, which `pipeline/size.test.ts` asserts directly.
 *
 * ## What the third one costs, measured
 *
 * It is much the widest of the three: `shape|corner` is on 671 records and only
 * 245 of them are the lie, so **595 records** become unreachable by a run ref to
 * remove 245 false positives. {@link RUN_UNREACHABLE} carries the breakdown.
 *
 * It is taken anyway, for the reason this list exists — the two directions are
 * not symmetric. A false negative costs a candidate card; a false positive
 * *"is a wall drawn through another wall"*. And it is the conservative half of
 * an **unseparable** set: no tag distinguishes a corner wall whose `size|width`
 * names its run from one whose `size|width` names its cell. The 245 and the 6
 * `BA` corner walls carry the same `shape|` tags and differ only in their
 * `size|openlock` code, which is not a discriminator a width ref can key on
 * (`A` is 1,095 records, 823 of them straight walls whose tag is right). Only
 * `foot` knows, and a derived run tag is the fix an earlier row priced at
 * +300 B and declined.
 *
 * ## Where the cost is not paid, which is why 595 is affordable
 *
 * Nothing the app ships loses a candidate it was getting:
 *
 *   - **The family size controls drop this `deny` entirely.** See
 *     `pipeline/families.ts`'s module note: `deny` is a property of a slot
 *     rather than of a position, so keeping it would make a record unreachable
 *     at *every* position of its own family including `any size`. So all 303
 *     generated size positions are untouched by this entry.
 *   - **The 40 shipped recipes' corner walls were never admitted by a run ref
 *     anyway.** An external corner's edge predicate on a 2 x 2 cell is
 *     `{kind:'run', run: 1.5}` — the face less the column — so its `require` is
 *     `size|width|1.5` and a corner wall tagged `size|width|2` failed it before
 *     this entry existed. They are filled through `foot` by `sizeAdmits`, which
 *     is the path that now carries the measured 1.5.
 *
 * So this list governs a *generated* `edge` slot's refs, and that is where the
 * false positive it removes would have been drawn.
 */
export const RUN_DENY_TAGS: readonly string[] = [
  'shape|angled|right',
  'shape|option|curved_interface',
  'shape|corner',
]

/**
 * What the zero-byte run predicate cannot reach, enumerated rather than rounded.
 *
 * **679 of the 6,661 records with a run, 10.2%** — 84 before row D9 and 595 more
 * from the `shape|corner` deny it added. Two populations, and the second is much
 * the larger:
 *
 * ### The 84 `curved_interface` walls
 *
 * | records | tagged | resolved run | why the ref misses them |
 * | ---: | ---: | ---: | --- |
 * | 28 `AxG` | 2 | 2 | denied by `curved_interface`, and their grid run **is** 2 |
 * | 28 `BAxG` | 1.5 | 1.5 | the same, at 1.5 |
 * | 28 `QxG` | 4 | **3** | denied, and no `size|width|3` tag to find them by |
 *
 * The first 56 are the cost of a deny that cannot see inside itself: the tag is
 * right on them and the deny excludes them anyway. The last 28 are the one place
 * the corpus is wrong by a whole unit and only `foot` knows it, so a run-3 slot
 * cannot admit them without the derived tag this row priced at +300 B and
 * declined.
 *
 * ### The 595 `shape|corner` records — row D9
 *
 * | records | code | why the ref misses them |
 * | ---: | --- | --- |
 * | 245 | `A` | **the correction itself.** Tagged 2, measured 1.5, and no `size\|width\|1.5` tag to be found by |
 * | 178 | none | corner floors and plates, no `size\|openlock` at all |
 * | 130 | `IL` `IO` `IT` `IX` `II` | the internal-corner 1 x 1 cells, tag right |
 * | 27 | `A` | the `shape\|corner\|wall` L-pieces, tag right in both axes |
 * | 15 | `BA` `D` `IA` `Q` | corner walls whose tag *is* their run |
 *
 * Only the first 245 are records the deny was written for. The other 350 are
 * collateral, and they are the price of a flat tag list on an unseparable set —
 * see {@link RUN_DENY_TAGS} for why it is affordable: no shipped path was
 * reaching them through a run ref.
 *
 * A **further 133** records have a run of 0.5 and no `size|width` tag — the
 * columns — and are not counted here: `size|width` has no `0.5` value in the
 * corpus at all (its 11 numeric values run 1 to 8), and no cell face is half a
 * unit long, so a run-0.5 edge slot is not a thing a family can generate.
 */
export const RUN_UNREACHABLE = 679

/** The 0.5-lattice value `units` rounds to. */
export function snapToLattice(units: number): number {
  return Math.round(units / GRID_UNITS) * GRID_UNITS
}

/** How far `units` is from the lattice, in grid units. */
export function latticeDistance(units: number): number {
  return Math.abs(units - snapToLattice(units))
}

/** Whether `units` is a lattice value within {@link LATTICE_TOLERANCE_UNITS}. */
export function isOnLattice(units: number): boolean {
  return latticeDistance(units) <= LATTICE_TOLERANCE_UNITS
}

/**
 * A dimension as the corpus spells it in a tag value: `2`, `1.5`, `0.5`.
 *
 * The same construction `pipeline/footprint.ts#formatUnit` uses, restated for
 * this module's empty import list. `size.test.ts` asserts the two agree on every
 * value either produces.
 */
export function formatUnits(units: number): string {
  return String(Number(units.toFixed(4)))
}

/**
 * How much of the anchored face a `corner`-anchored sibling takes.
 *
 * The same quantity `offsets.ts#cornerSpan` computes from the resolved fills,
 * restated from the *rules* because a family generator has no fills yet: it has
 * to know what a slot will require before anybody has picked anything. One
 * {@link GRID_UNITS} per corner slot, which is what a column is, and B2's
 * `cornerSpan` reads the real fill instead — so the two agree on every corner
 * slot of the shipped recipes and `size.test.ts` asserts that they do, over all
 * 72 corner slots of B2's walk.
 */
export function cornerSpanOf(layout: TemplateLayout): number {
  return layout.slots.filter((rule) => rule.anchor === 'corner').length * GRID_UNITS
}

/** The face of `cell` that `side` anchors to, in grid units. */
export function faceSpan(cell: GridSize, side: SlotSide): number {
  return side % 2 === 0 ? cell.w : cell.d
}

/**
 * The size requirement one slot of a template carries, given the instance's
 * cell.
 *
 * The whole of "size is a slot parameter": a family stores **one** cell and
 * every slot's requirement is arithmetic over it and the slot's own anchor. A
 * stored per-slot size would be a second source that could disagree with the
 * first, which is the same argument `rules.ts` makes about a stored offset one
 * level down.
 */
export function slotSizePredicate(rule: SlotRule, cell: GridSize, cornerSpanUnits = 0): SizePredicate {
  switch (rule.anchor) {
    case 'cell':
      return { kind: 'cell', w: cell.w, d: cell.d }
    case 'edge':
      return { kind: 'run', run: faceSpan(cell, rule.side) - cornerSpanUnits }
    case 'corner':
      return { kind: 'none' }
  }
}

/** Every slot of a layout, with the size requirement the instance's cell gives it. */
export function layoutSizePredicates(
  layout: TemplateLayout,
  cell: GridSize,
): readonly { readonly part: string; readonly anchor: SlotAnchor; readonly size: SizePredicate }[] {
  const span = cornerSpanOf(layout)
  return layout.slots.map((rule) => ({
    part: rule.part,
    anchor: rule.anchor,
    size: slotSizePredicate(rule, cell, span),
  }))
}

/**
 * The refs a predicate resolves to, over tags the corpus already carries.
 *
 * A `cell` predicate is the tagged pair, and it is exact where it fires: `foot`
 * equals the tagged `size|width` / `size|depth` pair on **3,449 of 3,449**
 * `rect` records, with no exception in either direction. That is the whole
 * population a `cell` anchor can want — `offsets.ts#cellExtentOf` refuses a
 * non-`rect` cell, and B2 measured the `floor` slot's candidates `rect` on
 * 2,996 of 2,996 files.
 *
 * A `run` predicate is the width plus {@link RUN_DENY_TAGS}. See
 * {@link RUN_UNREACHABLE} for what that cannot reach and why the derived tag
 * that would was priced and declined.
 */
export function sizeRefs(predicate: SizePredicate): SizeRefs {
  switch (predicate.kind) {
    case 'cell':
      return {
        require: [`size|width|${formatUnits(predicate.w)}`, `size|depth|${formatUnits(predicate.d)}`],
        deny: [],
      }
    case 'run':
      return { require: [`size|width|${formatUnits(predicate.run)}`], deny: RUN_DENY_TAGS }
    case 'none':
      return { require: [], deny: [] }
  }
}

/**
 * Whether every ref a predicate needs is a tag the corpus carries.
 *
 * Takes the vocabulary as a predicate rather than holding one, so there is no
 * second copy of the tag table to go stale — `pipeline/build.ts` has the real
 * one and already fails the build on a `require` ref that resolves to nothing
 * (*"this slot can never match anything"*). This is the question a generator
 * asks **before** authoring a slot, so it can decline the size instead of
 * emitting a family that matches nothing.
 *
 * The vocabulary is narrower than the resolution in two places worth naming:
 * `size|width` has no `0.5` (so no run-0.5 slot is expressible) and no value
 * above 8, and `size|depth` has a `0.5` where `size|width` does not.
 */
export function sizeRefsResolve(predicate: SizePredicate, has: (tag: string) => boolean): boolean {
  const { require, deny } = sizeRefs(predicate)
  return [...require, ...deny].every((tag) => has(tag))
}

/**
 * Whether a resolved size satisfies a predicate — the ground truth the refs are
 * measured against.
 *
 * Exact equality on the lattice, so no epsilon: both sides are multiples of
 * {@link GRID_UNITS} by the time they get here, which is what
 * {@link snapToLattice} is for.
 */
export function sizeAdmits(predicate: SizePredicate, size: ResolvedSize | undefined): boolean {
  if (predicate.kind === 'none') return true
  if (size === undefined) return false
  if (predicate.kind === 'cell') return size.w === predicate.w && size.d === predicate.d
  return size.run !== null && size.run === predicate.run
}

/** A predicate as one phrase, for a surface that has to name what a slot wants. */
export function sizeSentence(predicate: SizePredicate): string {
  switch (predicate.kind) {
    case 'cell':
      return `${formatUnits(predicate.w)} wide by ${formatUnits(predicate.d)} deep`
    case 'run':
      return `${formatUnits(predicate.run)} units along the edge`
    case 'none':
      return 'any size'
  }
}
