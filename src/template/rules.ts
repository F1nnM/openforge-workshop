/**
 * Where a template's slots sit — as a rule with no numbers in it.
 *
 * ## The numbers cannot be stored, and that is the whole finding
 *
 * The obvious model is `(dx, dz, dy, yaw)` per slot. It is **not
 * implementable**, and the reason is not that the tags are silent about edges
 * (they are, at 0.09% — see below). It is that **a slot has no fixed
 * footprint.** Resolved cold through the real `assemblyState` over all 128
 * parts of the 40 recipes, on the pinned corpus:
 *
 * | slot | parts | distinct footprints | layers admitted |
 * | --- | ---: | ---: | --- |
 * | `base` | 40 | **25** | `base` |
 * | `floor` | 40 | 8 | `topper` |
 * | `wall` | 32 | **14** | `base`, `integral`, `topper` |
 * | `column` | 8 | **1** | `integral`, `topper` |
 * | `right wall` | 4 | 4 | `base`, `integral`, `topper` |
 * | `left wall` | 4 | 4 | `base`, `integral`, `topper` |
 *
 * Only **28 of 128** parts have candidates that all share one footprint. The
 * `base` slot's 25 run `rect 1x1` through `rect 8x8` **and five `wall` runs**;
 * the `wall` slot's 14 include `{shape:'column'}`, four `diag` runs, a
 * `{shape:'tri',leg:2}` and — decisively — `{shape:'none'}`, the case
 * `geometry.ts#footprintShape` returns `undefined` for. **A slot fill can have
 * no placeable footprint at all**, so for that fill no offset exists at any
 * price. Any stored offset is therefore right for one fill of a slot and wrong
 * for the next. `src/template/corpus.test.ts` recomputes every figure above.
 *
 * So what a table can carry is **which face or corner of the template's own
 * cell a slot is anchored to**. The offset is arithmetic over the *resolved*
 * footprints, at fill time, in `offsets.ts`.
 *
 * ## Nothing in the corpus names an edge
 *
 * Of the 915 scanned tags over 84,023 scanned references (930 over 101,427 once
 * row B1's derived axes are interned), the only ones that could name a face of a
 * cell are `connection|left` (1 tile), `connection|right` (1) and
 * `connection|bottom` (6) — **8 tiles, 0.09%**. `connection|side` and its three
 * children (2,080 tiles) name a connector *system*, which
 * `src/catalog/schema.ts` already flags from the other direction.
 * `shape|corner|left` / `right` (133 / 133) are chirality — a mirror class, not
 * a position, and every `left`/`right` tag together reaches 427 tiles (4.91%).
 *
 * Sweeping every tag string for a face word as a whole segment matches **41 tags
 * on 576 tiles (6.62%)** outside the `connection|` root, and read by hand every
 * one is chirality (`shape|corner|left`), a component name
 * (`component|edge_gutter`) or a part interface (`interface|stairs|top`). **Not
 * one names an edge of a cell.**
 *
 * The existing code says the same thing independently:
 * `src/builder/three/place.ts` — *"nothing in the data links the STL's second
 * axis to the plan's depth direction … so the tile takes a canonical
 * orientation"*. Edge assignment is a **builder convention**, and
 * {@link SLOT_CONVENTIONS} is where this project writes its three down, all
 * three read off the 40 shipped fixtures.
 *
 * ## 80 of 128 parts need no authoring; the other 48 need three decisions
 *
 * | slot | parts | derivation | verdict |
 * | --- | ---: | --- | --- |
 * | `base` | 40 | every candidate is `layer === 'base'` → anchor `cell`, side 0, on the ground | **derived** |
 * | `floor` | 40 | every candidate is an `s2w` `topper` whose `kinds` include `floor` → anchor `residual`, side 0, resting on the base | **derived** |
 * | `wall` | 32 | nothing | **authored** (1 decision) |
 * | `column` | 8 | one footprint on 8 of 8, and `size|column_shape|L` types the junction as `corner` — which fixes the rotation up to the cell's 4-fold symmetry and not further | **authored** (1 decision) |
 * | `right wall` + `left wall` | 8 | chirality only | **authored** (1 decision) |
 *
 * The three authored decisions are keyed on the **part-name set**, which
 * classifies **40 of 40**. Keying on the template's own `shape|` tag is wrong on
 * **2 of 40**: the two `Modular` entries of `blueprints.s2w.internal_corner*`
 * carry `shape|corner` rather than `shape|internal_corner`, and an internal
 * corner has no wall parts at all, so a tag-keyed rule would hand two internal
 * corners an external corner's two-wall layout. That is an upstream fixture
 * defect and **row B6** records it; this module works around it by construction
 * and `rules.test.ts` asserts both halves of the comparison.
 *
 * `layer === 'base'` is the derivation above and not a role: **`base` is not one
 * of `pipeline/role.ts`'s eight roles**, it is a `layer` value, and a slot that
 * wants a base predicates on `shape|base` — measured by row A9 to be exactly
 * coextensive with `layer === 'base'`, 1,963 records both ways with no exception
 * in either direction. Which predicate a slot *selects* with is row B4's
 * business; this module only needs the two facts that make the `base` anchor
 * derivable, and both hold under either spelling.
 *
 * ## Why there are three rules and not a 135-row table
 *
 * A 128-row table is the same information with 125 more places to disagree with
 * itself. The rule ships in the **bundle** instead and the index carries none of
 * it, which is asserted rather than argued: `pipeline/templates.test.ts`
 * rebuilds the corpus from the fixtures and finds none of the model's vocabulary
 * in the emitted bytes.
 *
 * `pipeline/templates.ts` reads {@link conventionFor} at import time and throws
 * when a fixture's part-name set has no convention, so a twenty-first fixture
 * file fails `npm run import:catalog` naming the template rather than reaching
 * the browser with no layout.
 *
 * ## This module imports nothing
 *
 * Deliberately. `tsconfig.node.json` is a composite project that rejects an
 * import of a file outside its own list (TS6307), so `pipeline/templates.ts`
 * can only reach a `src/` module that is named in that list — and a named file
 * whose own import list is empty is the cheapest boundary there is. The
 * arithmetic, which needs `@/catalog` and `@/builder/canvas`, is in
 * `offsets.ts` and is not on the pipeline's side of that line.
 */

/**
 * The name of one slot of a template.
 *
 * A plain `string` alias, and that is a decision rather than laziness. Row A1
 * owns the persisted `SlotName`, which is *branded* — `string & { brand }` — and
 * this row must not import a persisted type. A brand of its own here would be a
 * second, incompatible brand: A1's `SlotName` would not be assignable to it and
 * every call site would need a cast. A branded string *is* assignable to
 * `string`, so this alias accepts A1's type unchanged and names the intent at
 * every signature.
 *
 * The six names the fixtures use are `base`, `floor`, `wall`, `column`,
 * `right wall` and `left wall`. Two of the six contain a space, which is why
 * {@link partNameKey} joins on `NUL`.
 */
export type SlotName = string

/**
 * Which face, corner or remainder of a template's own cell a slot is anchored
 * to.
 *
 *   - `cell` — the slot fills the template's footprint. The 40 `base` slots, and
 *     the only anchor that needs no authored side.
 *   - `edge` — the slot runs along one face, flush to it and centred across it.
 *     40 parts.
 *   - `corner` — the slot occupies the square where two faces meet. 8 parts, all
 *     of them `column`, all with exactly one footprint.
 *   - `residual` — the slot fills **what the `edge` slots leave**. The 40 `floor`
 *     slots. Like `cell` it needs no side, because it is defined against all four
 *     faces at once.
 *
 * Not a coordinate, for the reason in the module docblock: the offset is
 * arithmetic over the fill's own footprint and the offset is what varies.
 *
 * ## Why the floor is `residual` and not `cell`, and the meshes that settled it
 *
 * A `cell`-anchored floor was **wrong on every one of the 36 wall and corner
 * recipes**, and it was wrong in a way no test could see: 4 of the 128 parts have
 * even one candidate with a measured bounding box, so nothing ever held the
 * tagged footprint and the real mesh in memory at once.
 *
 * Every floor slot of every one of the 40 requires `build|s2w`, and **an `s2w`
 * floor is the tile minus the strip its separately printed wall stands on.**
 * Measured in `tools/measure/measurements.json`, the seven `s2w` floors the
 * archive has read:
 *
 * | file | tagged | mesh | mesh spans |
 * | --- | --- | --- | --- |
 * | `…#floor+s2w+curved.2x2` | 2 × 2 | **1.5 × 1.5** | [0, 1.5]² |
 * | `…#floor+s2w+curved.4x4` | 4 × 4 | **3.5 × 3.5** | [0, 3.5]² |
 * | `…#floor+s2w+curved+inverted.4x4` | 4 × 4 | **3.5 × 3.5** | [0.5, 4]² |
 *
 * Exactly 0.5 short per walled axis, and authored *in place* in the nominal cell.
 * The tag cannot say so — `size|width|2 + size|depth|2` is the **tile**, which is
 * the right answer for where the piece sits on the grid and the wrong one for
 * where the slab sits inside it — so a `cell` anchor gave the floor the whole
 * 2 × 2, and `place.ts` (*"the mesh is centred on the footprint box"*) then
 * centred the 1.5 slab in it: a quarter unit under each wall and a quarter unit
 * short of each open edge. That is the defect the project owner reported.
 *
 * **The residual needs no measurement of its own.** It is the cell, from the
 * floor's own tag, minus the depth each `edge` slot takes off the face it is
 * anchored to, from that wall's own footprint. On a 2 × 2 corner with two
 * half-unit walls that is 1.5 × 1.5 and on a 4 × 4 it is 3.5 × 3.5 — the measured
 * numbers above, reproduced rather than assumed. `corpus.test.ts` joins all seven
 * measured `s2w` floors to the sidecar and finds the residual reproduces **5 of
 * 7 to within 0.001 units**; the two that do not are the `…+curved+inverted.2x2`
 * pair, whose outer edge is a chord rather than a face, so their bounding box
 * corner is cut on the diagonal at 0.5/√2 = 0.354 and reads 1.646 against the
 * residual's 1.5. That is the curve's own sagitta and not a disagreement about
 * where the wall goes — and it is a quarter of what the `cell` anchor was wrong
 * by.
 *
 * It also makes the template a **tiling** for the first time. Under `cell` the
 * floor's box overlapped every wall and the union test passed only because the
 * floor covered the cell on its own; under `residual` the floor and the walls are
 * pairwise disjoint and sum to exactly the cell, which is a far stronger claim
 * and the one `offsets.test.ts` now makes.
 */
export type SlotAnchor = 'cell' | 'edge' | 'corner' | 'residual'

/**
 * Whether a fill is authored **short of the cell its tag names**, so its box is
 * the layout's `residual` rather than its own tagged extent.
 *
 * One population: the 95 `shape|base|s2w` bases. Measured from the live `/lod/`
 * meshes, an s2w base is 0.5 short on every axis a wall stands on —
 * `base+s2w+square+wall.2x2` measures 2.000 x 1.500, `+wall.4x2` 4.000 x 1.500
 * and `+corner.2x2` 1.500 x 1.500, every one of them authored in place from the
 * origin corner. That is the identical convention {@link SlotAnchor}'s docblock
 * records for the s2w *floor*, and the reason that floor is `residual`. The base
 * was left on `cell`, so `place.ts` centred a 1.5-deep slab in a 2-deep box and
 * left it a quarter unit under the wall on one edge and a quarter unit short of
 * the floor on the other. 18 of the 40 recipes, all of them `(Modular)`.
 *
 * **It is a property of the fill and not of the recipe, and that is load
 * bearing.** `Corner (Any, Modular)` and the drain's modular recipe both omit
 * `build|s2w` from their base slot, so each admits both kinds — 257 non-s2w
 * `shape|base|wall` records sit alongside the 48 s2w ones — and a static
 * per-recipe anchor is provably wrong for one fill of those two templates.
 *
 * **No internal-corner exception, and none is needed.** An internal corner has
 * no `edge` slot, so `offsets.ts#residualBox` returns exactly its cell and the
 * switch is a no-op. That agrees with the mesh rather than working around it:
 * `base+square+s2w+internal_corner.2x2` measures a full 2.000 x 2.000, unlike
 * its wall and corner siblings, because it has no wall strip to give up.
 *
 * Keyed on `shape|base|s2w` rather than on `layer === 'base'` plus `build|s2w`
 * because the two select the same 95 records and this needs only tags — which is
 * what lets `offsets.ts` stay free of `CatalogRecord`.
 *
 * The complementary population is measured too: of the 120 non-s2w rect bases
 * the dev-tool sidecar covers, **120** measure their tagged cell to within 0.011
 * units, so `cell` stays right for every one of them. The sidecar covers **0**
 * of the 95, which is why the figures above come from `/lod/`.
 */
export function isInsetFill(tags: readonly string[]): boolean {
  return tags.includes('shape|base|s2w')
}

/**
 * Which quarter-turn of the template's reference face a slot is anchored to.
 *
 * `0` is the reference face `-z` — the plan's "north", and the face
 * `place.ts` maps plan `z` straight onto. The sequence runs
 * `-z` → `+x` → `+z` → `-x`, matching `geometry.ts#place`'s rotation
 * (`[dx·cos − dz·sin, dx·sin + dz·cos]`, so `+90°` sends `(x, z)` to
 * `(−z, x)`), so `side * 90` composes with a placement's own rotation by
 * addition and nothing else.
 *
 * Ignored when the anchor is `cell` or `residual` — both are defined against the
 * whole cell rather than against one face — and 0 on every such rule so that one
 * formula covers all four anchors.
 */
export type SlotSide = 0 | 1 | 2 | 3

/** Where one slot of a template sits, in the template's own frame. */
export interface SlotRule {
  /** Matches a template part's `name`. Unique within a template — 0 duplicates over all 128. */
  readonly part: SlotName
  readonly anchor: SlotAnchor
  readonly side: SlotSide
  /**
   * The part this one rests on, or `null` for the ground.
   *
   * A **name and not a number**, because the height is measured per mesh at load
   * time. `src/builder/three/bases.ts#baseElevationMm` is the project's single
   * elevation source: it reads the resting part's own upright mesh height and
   * falls back to two plate thicknesses when the mesh has not landed. This field
   * says *whose* height applies and nothing about how much;
   * `offsets.ts#slotElevationMm` composes the chain and **takes the measurement
   * as an argument**, so there is no second source and no import into row A4b's
   * directory — which matters because A4b owns that file and row A2 reports it
   * may be deleted outright.
   *
   * A number here would be worse than absent. Measured over the 583 `openforge`
   * toppers in `tools/measure/measurements.json`: **107 (18.4%) are authored
   * pre-lifted by exactly one base thickness** (median 6.0000 mm) and **452
   * (77.5%) are not**. A stored elevation would freeze one of those two
   * populations into the rule.
   */
  readonly restsOn: SlotName | null
}

/** The layout of one recipe: one rule per part, plus which part defines the cell. */
export interface TemplateLayout {
  /**
   * The slot whose resolved footprint *is* the template's cell.
   *
   * `floor` on all three conventions, and measured rather than chosen. Over all
   * 40 templates the `floor` slot's candidates are **rect on 2,996 of 2,996
   * files**, in 8 distinct sizes; the `base` slot's 25 footprints include five
   * `wall` runs, so a base cannot be asked for a cell it may not have. That the
   * two agree in practice is separately measured: over the 1,213 walked
   * combinations that fill a base, the base is congruent to the floor cell on
   * **1,213 of 1,213**.
   */
  readonly cell: SlotName
  /**
   * In dependency order — the ground first, then whatever rests on it. Not the
   * fixture's declared order, which is the order C2's fill solver walks and is
   * a different question: the corner recipes declare `column` first, and a
   * column cannot be placed before the base it stands on is known.
   */
  readonly slots: readonly SlotRule[]
}

/**
 * One authored convention: a part-name set and the layout it implies.
 *
 * Three of them, and they cover the 40 shipped fixtures exactly. Each one is a
 * *decision with no measurement behind it* — the module docblock's second
 * section — so each carries the reasoning that constrains it below. The one
 * thing that is not a decision is where the floor goes: {@link SlotAnchor}'s
 * `residual` is derived, and the meshes in its docblock check it.
 */
export interface SlotConvention extends TemplateLayout {
  /** Stable, and safe in a test name or a disclosure string. */
  readonly id: 'wall-on-tile' | 'external-corner' | 'internal-corner'
  /** The part-name set this convention is keyed on, sorted. */
  readonly parts: readonly SlotName[]
}

/**
 * The key a convention is looked up by: the part-name **set**, sorted.
 *
 * Sorted rather than declared-order, because the set is what the classification
 * is about — the two corner recipes and the two internal-corner recipes each
 * declare `column` first, and a rule that keyed on the order would be one
 * fixture edit away from missing.
 *
 * Joined on `NUL`, for the reason `assemblyStepKey` gives: **two of the six
 * part names contain a space**, so every printable delimiter is ambiguous on
 * real data — `['left wall', 'right wall']` and `['left', 'wall right', 'wall']`
 * are one string apart under a space. Written as the escape `\u0000` and never
 * as the byte; `tools/hygiene/source.test.ts` fails the build on the byte.
 */
export function partNameKey(parts: readonly SlotName[]): string {
  return [...parts].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join('\u0000')
}

/**
 * **Authored convention 1 of 3 — the 32 wall recipes, 96 of 128 parts.**
 *
 * `wall`, `floor`, `base`. The base and the floor fill the cell; the wall runs
 * along the reference face.
 *
 * What fixes it: nothing in the corpus, and that is stated rather than hidden.
 * What *constrains* it:
 *
 *   - The wall is `edge`-anchored rather than `cell`-anchored because the
 *     closure arithmetic says so, on the corpus and not on a diagram. Over the
 *     1,143 walked wall combinations the run of the wall fill equals the width
 *     of the floor cell on **980**, which is the signature of a piece that spans
 *     exactly one face.
 *   - The wall rests on the `base`, not on the `floor`. Two independent
 *     supports: the single-piece recipes give the wall part
 *     `fulfills: [{part: base}]`, i.e. the wall *is* its own base; and among the
 *     107 measured toppers authored pre-lifted by exactly one base thickness,
 *     **59 are walls and 27 are floors** — both populations are drawn standing
 *     on a base, neither on the other.
 *   - Which of the four faces is `side: 0` is the free choice. It is the
 *     reference face because a template with one wall has no second wall to be
 *     relative to, and the placement's own rotation reaches the other three.
 */
export const WALL_ON_TILE: SlotConvention = {
  id: 'wall-on-tile',
  parts: ['base', 'floor', 'wall'],
  cell: 'floor',
  slots: [
    { part: 'base', anchor: 'cell', side: 0, restsOn: null },
    { part: 'floor', anchor: 'residual', side: 0, restsOn: 'base' },
    { part: 'wall', anchor: 'edge', side: 0, restsOn: 'base' },
  ],
}

/**
 * **Authored convention 2 of 3 — the 4 external corners, 20 of 128 parts.**
 *
 * `column`, `right wall`, `left wall`, `floor`, `base`. Two walls on two
 * adjacent faces and a column in the corner between them.
 *
 * What constrains it, and it is more than the first convention:
 *
 *   - The two walls must be on **adjacent** faces, not opposite ones, or the
 *     piece is not a corner. `side: 0` and `side: 3` are adjacent, and the
 *     corner they share is exactly the one `corner`, `side: 0` names — the
 *     `(-x, -z)` square. So the column's side is *implied* by the two walls'
 *     sides rather than authored separately, and `rules.test.ts` asserts the
 *     adjacency rather than restating the numbers.
 *   - Which of the two is *right* and which is *left* is chirality, and
 *     chirality is the one positional thing the corpus does carry —
 *     `shape|corner|right` and `shape|corner|left`, 133 tiles each. It carries
 *     the mirror class and not the mapping to a face, so the assignment of
 *     `right wall` to `side: 0` is the authored half and the fixtures'
 *     `right`/`left` requirement is what makes it consistent across all four
 *     recipes.
 *   - This convention is also where the rule **fails**, on 8 of 34 walked
 *     combinations, and it fails honestly: see `offsets.ts#SlotDoubt`.
 */
export const EXTERNAL_CORNER: SlotConvention = {
  id: 'external-corner',
  parts: ['base', 'column', 'floor', 'left wall', 'right wall'],
  cell: 'floor',
  slots: [
    { part: 'base', anchor: 'cell', side: 0, restsOn: null },
    { part: 'floor', anchor: 'residual', side: 0, restsOn: 'base' },
    { part: 'right wall', anchor: 'edge', side: 0, restsOn: 'base' },
    { part: 'left wall', anchor: 'edge', side: 3, restsOn: 'base' },
    { part: 'column', anchor: 'corner', side: 0, restsOn: 'base' },
  ],
}

/**
 * **Authored convention 3 of 3 — the 4 internal corners, 12 of 128 parts.**
 *
 * `column`, `floor`, `base`. **No wall parts at all**, which is the fact a
 * tag-keyed rule gets wrong on two of these four: two of them are tagged
 * `shape|corner`, so a tag key would give them {@link EXTERNAL_CORNER}'s
 * two-wall layout and then look for `right wall` and `left wall` fills that
 * cannot exist.
 *
 * The column sits at `side: 2`, the corner diagonally opposite
 * {@link EXTERNAL_CORNER}'s. That is the *definition* of re-entrant here: an
 * internal corner is the piece that closes the gap an external corner leaves,
 * so its column must be on the far diagonal or the two do not meet when placed
 * at the same rotation. The convention is therefore fixed *relative to*
 * convention 2 and free only jointly with it — one decision across the two, not
 * two.
 *
 * With no wall part there is no closure to check, so all **38** walked
 * combinations of these four recipes are `undecidable` rather than closing, and
 * `offsets.ts` reports them as such rather than passing them as fits.
 *
 * **Its floor is `residual` like the other two, and on this convention that is
 * provably the same thing as `cell`.** A residual is the cell minus what the
 * `edge` slots take, and this convention has no `edge` slot, so the subtraction
 * is empty: the floor gets the whole cell, which is the right answer for a piece
 * whose 18 candidates are all `rect 2x2` with the column's square cut out of the
 * middle of the run rather than off an edge. Written as one anchor across all
 * three rather than as an exception, because an exception would have to be
 * justified per convention and the identity does not: `rules.test.ts` asserts it
 * instead of restating it.
 */
export const INTERNAL_CORNER: SlotConvention = {
  id: 'internal-corner',
  parts: ['base', 'column', 'floor'],
  cell: 'floor',
  slots: [
    { part: 'base', anchor: 'cell', side: 0, restsOn: null },
    { part: 'floor', anchor: 'residual', side: 0, restsOn: 'base' },
    { part: 'column', anchor: 'corner', side: 2, restsOn: 'base' },
  ],
}

/**
 * The three, in the order they cover the 40 shipped fixtures — 96 parts, then 20,
 * then 12.
 *
 * **A fourth was here and has been withdrawn.** Row E3's `CORRIDOR` put two walls
 * on opposite faces, and it could only ever be filled by a floor that covers the
 * whole cell: a corridor's floor has to be 0.5 short on each of two *opposed*
 * faces, and the archive's entire `s2w` floor vocabulary is `wall` (one face, 88
 * records), `corner` (two adjacent, 41), `internal_corner` (18), `curved` (17)
 * and 12 bare — **not one of the five is inset on two opposed faces.** So the
 * convention was expressible only against the widened floor slot that
 * `pipeline/authored.ts` shipped alongside it, and that slot is the defect this
 * change removes. An s2w corridor is two `wall-on-tile` cells side by side, not
 * one recipe.
 *
 * There is deliberately no fallback entry. A part-name set with no convention is
 * a template this project cannot lay out, and the honest answer is
 * `undefined` — which `pipeline/templates.ts` turns into a build failure and a
 * consumer turns into *needs a choice*. A default would place something
 * plausible that nobody authored, which the plan's "what gets worse" section
 * names as the new class of silent wrongness this model must not add to.
 */
export const SLOT_CONVENTIONS: readonly SlotConvention[] = [
  WALL_ON_TILE,
  EXTERNAL_CORNER,
  INTERNAL_CORNER,
]

const BY_PARTS = new Map<string, SlotConvention>(
  SLOT_CONVENTIONS.map((convention) => [partNameKey(convention.parts), convention]),
)

/** The convention for a template's part names, or `undefined` when there is none. */
export function conventionFor(parts: readonly SlotName[]): SlotConvention | undefined {
  return BY_PARTS.get(partNameKey(parts))
}

/**
 * The layout for a template's part names, or `undefined`.
 *
 * The reading {@link conventionFor}'s callers actually want: a layout, with the
 * convention's identity dropped. Kept separate so a consumer that wants to
 * *disclose* which convention it used — the plan asks the builder to disclose
 * inferred data rather than hide it — can still get at the id.
 */
export function layoutFor(parts: readonly SlotName[]): TemplateLayout | undefined {
  return conventionFor(parts)
}

/**
 * The rule for one part of a layout, or `undefined` when the layout has no such
 * part.
 *
 * A linear scan over at most five rules, which is cheaper than the `Map` that
 * would have to be built to avoid it.
 */
export function ruleFor(layout: TemplateLayout, part: SlotName): SlotRule | undefined {
  return layout.slots.find((slot) => slot.part === part)
}
