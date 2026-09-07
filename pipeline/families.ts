/**
 * The generated template families — one per `(role, form, build)`, with size as
 * a parameter of the placed instance.
 *
 * ## What this closes, and what it costs
 *
 * The 40 shipped recipes reach **3,079 of 8,702 records (35.4%)** and 905 of
 * 3,822 designs. Every one of them is `S2W: Wall on Tile`, so two thirds of the
 * archive has no placement unit at all under decision **D2** (*"templates are
 * the only placement unit"*). This module is the other two thirds.
 *
 * The key is B1's two derived axes plus the build system, and the corpus holds
 * **52** of them. The coverage curve reproduces the plan's §2.5 table exactly,
 * recomputed in `families.test.ts` rather than quoted:
 *
 * | families | records | designs |
 * | ---: | ---: | ---: |
 * | 10 | 74.4% | 58.1% |
 * | 20 | 90.4% | 86.0% |
 * | 30 | 96.4% | 93.9% |
 * | **52** | **100%** | **100%** |
 *
 * **All 52 ship, less the two `insert` keys and the four keys whose only records
 * are bases, plus one that is not on the list at all.** The four departures from
 * the plan's row split are each a measurement:
 *
 *   - **The cut is "every key the corpus has", not the plan's first 20.** A
 *     generated family costs no authoring — the set is a `GROUP BY` over the
 *     emitted tags — so a rank-20 cut withholds **493 records (5.7%)** over 26
 *     palette rows, in exchange for {@link FAMILY_TABLE_BYTES} bytes of bundle
 *     data. (The plan's own rank-20 cut withholds **835**: its ranking includes
 *     `insert|straight` at rank 9, this one does not, and its per-key counts
 *     include the bases {@link BARE_BASE_KEY} now denies. Both are asserted, so
 *     neither can be quoted as the other.) It also withholds them *invisibly*:
 *     contract **C-i** records that an empty candidate set is indistinguishable
 *     from an archive gap, and a missing family is worse — there is no slot to
 *     be empty. Row **B5** is *"families to 52"* and there is nothing left for
 *     it to extend; what it could own instead is in the row report.
 *   - **The two `insert` keys are not generated.** `role|insert` is a perfect
 *     bijection with `layer === 'insert'` and B1 says outright that no slot
 *     should predicate on it. Measured here rather than taken on trust: of the
 *     285 insert records, **262 already resolve through a tile's own accessory
 *     slots** — 3,695 live slots walked through `src/composition`'s resolver —
 *     so an insert family would duplicate working machinery for 262 and add 23.
 *     {@link SKIPPED_ROLES} is the whole of that decision.
 *   - **Four keys hold nothing but bases, and are not generated.** With the
 *     base denied they would admit **nothing**, and all 134 of their records are
 *     reached by the base family either way. {@link BASE_ONLY_KEYS} is the whole
 *     of that decision.
 *   - **There is one more family that no `(role, form, build)` key can name.**
 *     See {@link BARE_BASE_KEY}.
 *
 * So **47 families**, reaching **8,417 of 8,702 records (96.7%)** and 3,728 of
 * 3,822 designs (97.5%) by the key alone, and **8,679 (99.7%)** counting the 262
 * inserts the accessory slots already reach.
 *
 * The 47 populations are **disjoint**, and that is new with row D1: they sum to
 * 8,417, which is exactly the number of non-insert records, so every record the
 * palette can place is offered by exactly one family. The same sum was **10,380**
 * before the base deny — the 1,963 bases counted twice, once in the base family
 * and once under the role of the piece they sit under — which is the figure
 * `src/builder/panels/palette.corpus.test.ts` reads as *"the whole corpus once
 * per family, and the base family twice over"*.
 *
 * The 94 designs the families miss are exactly the insert-only designs
 * `src/builder/panels/families.ts` ships as `INSERT_DESIGNS`. **The *3,822 of
 * 3,822 designs* this file claimed before row D1 was never true of the
 * families** — it is `designsOf(52)`, which counts the two insert keys this
 * module does not generate — and neither is `docs/templates-plan.md` §10.1's
 * correction 22, *"the families partition the corpus, so no design is outside
 * them"*: they did not partition it (the bases were in two families) and 94
 * designs were outside it. Both halves are asserted here, and the partition half
 * is true for the first time as of this row.
 *
 * The plan's **99.0%** is not that number and not a rounding of it. It counts
 * 8,618 of 8,702, excluding 84 records over 25 designs — 56 `form|hex`, 26
 * `role|decor` and the 2 non-insert `wot` walls, which reproduces exactly — and
 * counting all 285 inserts as family-reachable. **The two figures exclude
 * different records.** All 84 of the plan's are reachable here: `form|hex` is
 * `wall|hex|thick wall`, `role|decor` is `decor|straight`, and the 2 `wot` walls
 * sit in `wall|straight|wall on tile`. So the plan's 84 were never a *template*
 * gap — they are builder limitations, which is what §2.5 itself says of the 56
 * hex and what B3 says of the other 28. `families.test.ts` computes both
 * figures side by side.
 *
 * ## `base` is not a role, and every other family has to deny it
 *
 * Row **A9** proved it and rows **A8** and **B2** both left a hole for it: `base`
 * is a value of `layer`, not one of B1's eight roles, so **no family keyed on
 * `(role, form, build)` can be the base family.** The key spreads the 1,963
 * bases across **17** of the 52 and none of those 17 is a base — a base keeps
 * the role of what it sits *under* (`role|wall` 1,117, `role|floor` 661,
 * `role|riser` 176, `role|stair` 9, recomputed here). **This file said *eight*
 * before row D1 and the corpus says 17**, over 10 distinct `(role, form)` pairs;
 * 17 is also, and not by coincidence, the number of families the missing deny
 * broke.
 *
 * {@link BARE_BASE_KEY} is the answer A9 asked for: one slot, predicating on
 * `require: [{ tag: 'shape|base' }]`, which is **exactly coextensive with
 * `layer === 'base'` — 1,963 records both ways, zero exceptions in either
 * direction**, reproduced in `families.test.ts`.
 *
 * ### The half row B4 missed: inheriting the role is also *admission* to it
 *
 * The finding above was recorded and then only half applied. B4 keyed the
 * families on `(role, form, build)` and gave no family a `shape|base` deny, so
 * every base flowed into the family of the piece it supports — and a slot that
 * *is* a wall offered the plate that goes underneath one. The project owner hit
 * it on a `Corner (S2W)` template and it was not one family:
 *
 * | over the keyed families | before D1 | after |
 * | --- | ---: | ---: |
 * | admitting at least one base | **17 of 50** | **0 of 46** |
 * | base admissions outside the base family | **1,963** | **0** |
 * | admitting *only* bases | **4** | — |
 *
 * The 1,963 is every base in the archive, and it is the same 1,963 as A9's
 * count: a base is admitted by exactly one keyed family, its own, so the wrong
 * admissions and the population are the same set counted twice. The worst four
 * rows offered nothing else — `Wall: Corner (Separate Wall)` was twelve cards
 * and every one a base.
 *
 * So **every family except the base family denies `shape|base`**, and the deny
 * is exact for the reason the `require` is: the tag and `layer === 'base'` are
 * the same 1,963 records with zero exceptions either way, re-measured here
 * rather than inherited from A9. It is the *same ref* on both sides of the
 * table — one family requires it, the other 46 deny it — which is why the fix
 * costs the tag table nothing and the index nothing.
 *
 * The split happens at the **bucket**, not at the slot: `records`, `designs`,
 * the size domain and the emission order are all counted off a family's bucket,
 * so a bucket that still held bases would describe a population the slot
 * denies. That is what makes the semantic round-trip in `families.test.ts` a
 * check on this row — it compares the slot's admissions against *"the key's
 * records that are not bases"*, in both directions, and both are 0.
 *
 * `src/generator/placement/placement.ts`'s archived arm and
 * `src/screens/builder/BuilderScreen.tsx`'s `placeGenerated` are its callers and
 * neither is this row's file to edit; the row report names the two-line change.
 *
 * ## One slot per family, and the alternative is a defect
 *
 * A generated family has **one** slot. Not a base plus a topper, and not B2's
 * three-part `wall-on-tile` convention with the parts re-predicated. Four
 * measurements, in descending weight:
 *
 *   1. **A base slot is what the greedy walk fails on.** A first-candidate walk
 *      completes 24 of the 40 shipped recipes and *all sixteen failures are the
 *      `base` slot of the modular wall templates* — 48 candidates before the
 *      siblings are picked and 0 after. A one-slot family has no sibling to
 *      empty, so it cannot fail a walk at any depth. `families.test.ts` runs
 *      both walks over all 87 templates: first-candidate completes **24 of 40
 *      recipes and 47 of 47 families**, 71 of 87 (81.6%) against 60.0% before —
 *      **by dilution**, because all 16 failures are still the same `base` slot
 *      and this row fixed none of them.
 *   2. **The builder already inserts bases, and not through a slot.** §3.2:
 *      *"517 of 526 empty slots corpus-wide are the `base` slot, which is never
 *      shown, because the builder's base comes from footprint congruence rather
 *      than from the texture-inheriting slot"*, and `resolvePlacement`
 *      auto-inserts one on 1,878 of 3,822 items. A generated base slot would be
 *      a second, disagreeing source for the same decision.
 *   3. **`build|separate wall` means the wall is separate from the tile** — 3,351
 *      records, the corpus's largest build system. A family that made a floor
 *      compulsory under a separate wall would be asserting the opposite of what
 *      the build system says.
 *   4. **§3.4's own complaint 5** is *"placing a single tile gets harder: a
 *      recipe drops five placements where one was wanted."* One-slot families
 *      are the answer to it, not another instance of it.
 *
 * The slot is **required**, and that is settled by construction rather than
 * chosen: `RecipeTemplate`'s `TemplatePart` is `Pick<PartSlot, 'name' | 'tags'>`
 * plus `fulfills`, so `optional` is not expressible in the emitted shape at all
 * — and every one of the 128 shipped parts is required too (`optional` absent on
 * all of them, and absent from the fixtures' whole 13-key vocabulary). It is
 * also the right answer: the download gate refuses a room with an unfilled
 * required slot, and a one-slot family with its slot unfilled is a placement of
 * nothing.
 *
 * ### A one-slot family needs no layout, and asking B2 for one would be wrong
 *
 * B2's three outputs are all constants here, which is checkable rather than
 * argued: `slotOffset` returns `[0, 0]` for a `cell` anchor **before it reads
 * the cell at all**, `slotYaw` is `side * 90` and the side is 0, and
 * `slotElevationMm` walks `restsOn` and there is nothing to walk. So the single
 * fill sits at the instance's own origin, unrotated, on the ground.
 *
 * Running one through `placeTemplateSlots` anyway would be actively worse:
 * `offsets.ts#cellExtentOf` refuses a non-`rect` cell, and **5,253 of 8,702
 * records are not `rect`** — 726 of them `{shape:'none'}`, which earns
 * `no-footprint` before the cell is consulted, and the other **4,527** a
 * `no-cell` doubt. That is a *"needs a choice"* on a template whose only offset
 * is `[0, 0]` either way. And `verdictOf` makes every layout with no `edge` slot
 * `undecidable`, which all 47 are. So the honest reading is that the closure
 * machinery has nothing to say about a one-slot family, not that a one-slot
 * family fails it. `families.test.ts` carries the arithmetic; the behavioural
 * half of it cannot live in `pipeline/` at all, because `offsets.ts` needs
 * `@/builder/canvas` and so DOM lib, and that boundary is in the row report
 * rather than worked around.
 *
 * `conventionFor(['wall'])` is therefore `undefined`, and deliberately not
 * fixed: `src/template/rules.ts` is row B2's and *"there is deliberately no
 * fallback entry"* in `SLOT_CONVENTIONS`. {@link familyLayout} is here for a
 * consumer that wants the value spelled once, and it is not emitted.
 *
 * ## Size is a slot parameter, and it costs zero new code
 *
 * Row **B3** made size a parameter of one placed instance rather than part of
 * the key — the same corpus needs 217 to 277 families with size in the key — and
 * left the spelling in `src/template/size.ts#sizeRefs`. This module consults it,
 * as B3 asks, and the *mechanism* it hands the refs to is the composition
 * grammar that already ships:
 *
 * ```
 * slot.tags.constrain = [{ tag: 'size|width' }, { tag: 'size|depth' }]
 * parentTags          = [...family.tags, ...position.tags]
 * ```
 *
 * `processConfigValues` collects every parent tag under each constrained prefix
 * and adds the survivors to `require`. So a size position is **a set of tags the
 * instance carries**, `src/composition/config.ts` needs no change, and with no
 * size chosen the constrain collects nothing and the family admits every size.
 * That last property is what makes {@link ANY_SIZE} the first position of every
 * family rather than a special case for the five B3 named.
 *
 * ### The domain is B3's resolved cells, and 16 of the 295 are inexpressible
 *
 * A family's domain is the set of cells `pipeline/size.ts#resolveGridSize`
 * resolves for its own records. B3's figure is **295 cells over the 52 keys,
 * median 4, maximum 31** and reproduces exactly; the generator's own domain is
 * smaller and differently shaped, because a family's records are its key's
 * records *less the bases* — **242 cells over the 46 keyed families, plus 31 for
 * the base family**. Per cell, the position is
 * the first of `{kind:'cell'}` then `{kind:'run'}` whose refs are tags the table
 * holds *and* which admits at least one of the family's records at that cell:
 *
 * | branch | positions | what it spells |
 * | --- | ---: | --- |
 * | `cell` | 209 | `size\|width\|w` + `size\|depth\|d` — exact on all 3,449 `rect` records |
 * | `run` | 48 | `size\|width\|w` alone, because the corpus does not tag a wall's depth |
 * | **neither** | **16** | the cell comes from *geometry* and the tags say nothing |
 *
 * 257 positions over the 47 families, plus {@link ANY_SIZE} on each, is the 304
 * the emitter reports. The 16 refusals are named rather than counted, because
 * they are three facts and not a residue: **12** are 90 degree annular sectors,
 * whose cell is `rOut x rOut` and whose only `size|` tags are a radius and an
 * angle; **3** are columns, whose cell is `0.5 x 0.5` and `size|width` has 11
 * numeric values, 1 through 8, with no `0.5`; and **1** is
 * `wall|curve|separate wall`'s `3x0.5`, where the records at that cell are the
 * `QxG` walls whose own tag says 4. Their records are not lost — they sit at
 * {@link ANY_SIZE}, which is why every family has it. The **16 is the same total
 * before and after the base deny, and the same three facts**, but not the same
 * sixteen cells: `floor|curve|separate wall`'s two sectors leave with the
 * dropped family, and `riser|curve`'s `2x2` and `4x4` arrive — those two cells
 * were spellable only because a **base** sat at each of them carrying the
 * `size|width` / `size|depth` pair its own arc records do not. That is the
 * refusal working as designed: a position is emitted only when it admits a
 * record of the family, and after the deny neither does.
 *
 * ### `sizeRefs`'s `deny` is right for an edge slot and wrong for this one
 *
 * `sizeRefs({kind:'run'})` returns `deny: RUN_DENY_TAGS`, and this module takes
 * its `require` and **drops its `deny`**. That is a departure from B3 and it is
 * measured in both directions:
 *
 *   - **Keeping it makes 241 records unreachable at every position of their own
 *     family** — 130 `shape|angled|right` and 111 `shape|option|curved_interface`
 *     — because `deny` is a property of the slot and not of the position, so it
 *     applies at {@link ANY_SIZE} too.
 *   - **Dropping it costs 12 labels, and this row's own draft predicted 28.**
 *     The 28 `QxG` walls are tagged `size|width|4` and measure 3.000, so the
 *     draft expected all 28 to appear at *4 wide*. Only **12** land at a wrong
 *     position and they are the 12 `QxG` **bases**; the other 16 are in
 *     `wall|curve|separate wall`, whose `3x0.5` cell is inexpressible, so that
 *     family has no *4 wide* position for their tag to put them at and they
 *     reach {@link ANY_SIZE} and nothing else. The other 56 of B3's 84
 *     unreachable runs — `AxG` at 1.991 and `BAxG` at 1.547 — land on the
 *     position their tag names, which is also the position their **cell**
 *     resolves to, so for them dropping the deny is a correction, not a cost.
 *
 * The premise of the deny is the one thing a one-slot family does not have.
 * B3 built it for an `edge` slot inside a template, where a run that over-states
 * itself *"would draw two walls through each other"*; there is no second wall
 * here, no anchored face and no closure — `edgeRun` is never called. So the
 * trade is 28 mislabels against 241 unreachable records, and 84 of those 241 are
 * the very walls the deny was written to keep honest.
 *
 * ### A `run` position is not an approximate cell — it is a run
 *
 * This row's draft treated a `run` position as a *coarse cell* and worried about
 * it: `size|width|2` says nothing about depth, and the grammar has no prefix
 * `deny` to narrow it with, so `floor|straight|-`'s *2 wide* names 32
 * wall-thickness floor strips and admits **365** records. The measurement
 * retired the worry. `resolveGridSize` gives a `rect` record a run equal to its
 * width, so all 365 of those records **are** 2 units wide, and over all 257
 * positions only **12** records are admitted at a position whose predicate they
 * do not satisfy — the 12 `QxG` bases above, and no others.
 *
 * What survives from the draft is one honest limitation: the 32 strips **cannot
 * be isolated**, because a `2 x 0.5` position for them is not expressible. They
 * are reached at *2 wide* alongside every 2-by-anything floor, and that is the
 * corpus's silence about a wall's depth rather than a defect in the control.
 *
 * The label is what keeps it truthful — a `run` position reads *"2 wide"* and a
 * `cell` position reads *"2 wide by 2 deep"*, so **no position claims a depth
 * its refs do not require** — and `families.test.ts` recovers the predicate from
 * the *label* rather than from the tags, so the two cannot drift apart without
 * failing.
 *
 * ## An absent build system needs a five-ref `deny`
 *
 * 16 of the 47 families have no build system, and **2,978 records (34.2%) carry
 * no `build|` tag** — §"Build system" of `src/catalog/schema.ts` calls the absence
 * *"a real state, not a gap"*. `require` cannot express absence, so those
 * families deny all five build tags by name. That is exact rather than
 * approximate, and three measurements say so: exactly **five** `build|` tags
 * occur in the table, **no record carries two** (8,702 of 8,702 carry 0 or 1),
 * and `CatalogRecord.build` equals its single tag's value on **8,702 of 8,702**.
 *
 * Without the deny those 16 families over-admit **2,945 records** — a
 * `floor|straight` family would offer every s2w, wall-on-tile and separate-wall
 * floor as well — and `families.test.ts` measures the figure by resolving the
 * same 16 slots with the deny emptied.
 *
 * `role` and `form` need no equivalent, because both axes are **total**: every
 * one of the 8,702 records carries exactly one `role|` tag and exactly one
 * `form|` tag, so a two-ref `require` is exact by construction.
 *
 * ## Where the table lives: the bundle, and 0 B of the index
 *
 * Priced the way rows B2 and B3 priced theirs, and with the same instrument.
 * **Every ref this module emits is a tag the corpus already carries** — `role|`,
 * `form|` and `build|` from B1, `size|width|` and `size|depth|` from the
 * fixtures, `shape|base` for the base family — so:
 *
 *   - the tag table stays **930** strings, which is the hard assertion in three
 *     suites and the quoted figure in thirteen docblocks that B3 declined its
 *     +300 B derived tag to protect;
 *   - `tools/stamp/derivation.lock.json`'s content digest does not move, and
 *     `npm run stamp` is the check in both directions;
 *   - `pipeline/build.ts` does not import this module and `pipeline/emit.ts`
 *     never sees it, so the 0 B is **structural** and not a byte count that
 *     happens to match. `families.test.ts` asserts the absence of the import the
 *     way `templates.test.ts` does for B2.
 *
 * The table ships in the bundle instead, in the lazily-mounted `/assemblies`
 * chunk row X9 landed, at {@link FAMILY_TABLE_BYTES} raw. The counterfactual is
 * priced against the same artefact at the same epoch — the construction B1, B2
 * and B3 all quote — and a `families` key carrying the 47 slots and their 304
 * size positions costs **+2,277 B brotli**, taking the index from 366,173 B to
 * 368,450 B.
 *
 * The budget would carry it, as it would have carried the 40's +1,260 B. The
 * reason it is declined is `pipeline/templates.ts`'s reason for the 40,
 * unchanged: the recipe list is the one part of that screen that renders before
 * the 5.6 MB index lands, and a family row has no sprite and nothing to draw but
 * its name. Moving the table into the index makes the first thing the palette
 * shows the last thing that arrives.
 *
 * ## A generated family is a `RecipeTemplate`, and its guard is semantic
 *
 * The 40 are read from YAML and `printFixture` re-emits them **byte-identically
 * for all 20 files**, which is the property `pipeline/templates.ts` earns its
 * trust from. A generated family has no fixture to round-trip against, so it
 * needs its own equivalent — and a *stronger* one is available precisely because
 * the input is the corpus rather than a file:
 *
 * **Every generated slot is resolved through `src/composition`'s own resolver
 * and postings index, and the record set it admits is compared to the record set
 * the key selects.** At {@link ANY_SIZE} the two agree **exactly, 47 of 47
 * families, 0 over-admissions and 0 under-admissions**, and *"the records its
 * key selects"* now means the records its key selects that are **not bases** —
 * which is what makes that guard the check on row D1's deny; at each of the 257
 * size positions the admitted set is compared to what `sizeAdmits` admits within
 * the family, and agrees to within 12 admissions and 128 misses — both itemised
 * there rather than summed away.
 *
 * A byte round-trip proves a reader lost nothing. This proves the *emitted refs
 * mean what the key means*, which is the failure mode a generator has and a
 * reader does not: a mis-spelled ref, a `deny` that excludes the family's own
 * records, a size position naming a tag the table does not hold, a family that
 * matches nothing.
 *
 * It is emitted as a `RecipeTemplate` and not a new kind for one reason that is
 * not convenience: `src/screens/assemblies/assembly.ts` belongs to row C3 and is
 * not this row's file, so a distinct kind would have to be declared somewhere
 * this row may write — and the only such place is the generated module, where a
 * hand-declared interface is exactly the thing "generated data" is supposed to
 * rule out. `RecipeTemplate` also already fits without a field to spare: `tags`
 * is *"the `parentTags` a `constrain` entry reads"*, which is what a size
 * position is joined against, and `source` carries provenance, which for a
 * generated family is its key.
 *
 * It is a **second export** rather than 47 more entries in `RECIPE_TEMPLATES`,
 * because that array's length is asserted to be 40 in six suites and quoted in
 * `AssembliesScreen` as *"N recipes from the archive's own blueprint
 * fixtures"* — which the generated families are not.
 */
import type { CatalogFile, CatalogRecord, PartSlot, TagRef, TileId } from '../src/catalog'
import type { SizePredicate } from '../src/template/size'
import type { SlotName, TemplateLayout } from '../src/template/rules'
import { formatUnits, sizeRefs, sizeRefsResolve } from '../src/template/size'

import { resolveGridSize } from './size'

/* ------------------------------------------------------------------- the key */

/**
 * Roles no family is generated for.
 *
 * One entry. `role|insert` is a perfect bijection with `layer === 'insert'` —
 * the same 285 records, because both are `has(tags, 'part|')` — and B1's own
 * file says *"no slot should require `role|insert`"*. The measurement that makes
 * skipping it right rather than merely obedient is downstream: **262 of the 285
 * are already reachable through a tile's own accessory slots**, resolved here
 * through `src/composition`, so an insert family would duplicate machinery that
 * ships and works for 262 records and add 23.
 *
 * The 23 it would add are not silently dropped: `families.test.ts` counts them
 * against the same resolver, and they are inserts whose host declares no slot
 * that admits them — an archive gap in the *fixtures*, which is where it has to
 * be fixed rather than papered over with a 52nd family.
 */
export const SKIPPED_ROLES: readonly string[] = ['insert']

/**
 * The tag every base carries: the key of the one family with no role, and the
 * ref every other family denies.
 *
 * `shape|base` and `layer === 'base'` are the same 1,963 records with **zero
 * exceptions in either direction**, which row A9 measured and
 * `families.test.ts` reproduces. So this is a `require` ref rather than a new
 * axis, and it costs the tag table nothing.
 *
 * Its second use is row D1's fix and is the same ref read the other way: a base
 * inherits the role of the piece it sits under, so `role|wall` selects 1,117
 * bases, and a family whose slot *is* a wall must say so. See the module note.
 */
export const BARE_BASE_KEY = 'shape|base'

/**
 * The four keys the generator drops, because every record under them is a base.
 *
 * | key | records | of which bases |
 * | --- | ---: | ---: |
 * | `floor|straight|separate wall` | 73 | 73 |
 * | `floor|curve|separate wall` | 41 | 41 |
 * | `wall|corner|separate wall` | 12 | 12 |
 * | `wall|internal_corner|s2w` | 8 | 8 |
 *
 * Derived, not consulted: {@link deriveFamilies} drops a key whose non-base
 * bucket is empty and never reads this list, which `families.test.ts` asserts by
 * recomputing the dropped set from the corpus. The list is here so the four are
 * *named* rather than counted.
 *
 * ## Why dropped rather than kept empty, which is the opposite of the rank-20 call
 *
 * The module note declines a rank-20 cut partly because contract **C-i** says an
 * empty candidate set is indistinguishable from an archive gap, and a missing
 * family is worse than an empty one — *"there is no slot to be empty"*. That
 * argument does not reach these four, and the difference is measurable rather
 * than a matter of degree:
 *
 *   1. **Nothing becomes unreachable.** A rank-20 cut withholds 493 records that
 *      no other family offers. These four withhold **0**: all 134 of their
 *      records are bases, and {@link BARE_BASE_KEY} admits every one of the
 *      1,963. The union is 8,417 records over 3,728 designs with the four and
 *      without them, asserted both ways in `families.test.ts`.
 *   2. **An empty family is not a palette row with nothing in it — it is a
 *      placement that can never be completed.** A family's one slot is required
 *      by construction (`TemplatePart` cannot express `optional`),
 *      `assembly/resolve.ts` reports the instance `slot-unfilled`, and
 *      `BillOfTiles.complete` is then false — which is where
 *      `useArchiveDownload` throws `IncompleteSceneError`. So
 *      the row is not merely uninformative: pressing it arms a piece that
 *      cannot be filled, cannot be downloaded, and blocks the download of the
 *      whole room it sits in.
 *   3. **Three suites already assert that no family matches nothing** — this
 *      module's own round-trip, `palette.corpus.test.ts`'s *"no family that
 *      matches nothing"*, and `src/template/corpus.test.ts` filling every
 *      family at every position of its control. Keeping the four would have
 *      meant retiring an invariant that predates this row, in exchange for four
 *      rows whose only honest label is *"nothing here"*.
 *   4. **B3's precedent points the same way.** Five families have an empty size
 *      *domain* and the answer there was to render **no control** rather than a
 *      control matching nothing; four families with an empty candidate domain
 *      get no row rather than a row matching nothing.
 *
 * What the drop does cost is a *name*: the archive really does hold 12
 * separate-wall corner bases, and after this row nothing in the palette is
 * called `Wall: Corner (Separate Wall)`. They are reached under `Base (Bare)`
 * instead, which is where a plate belongs — the key that named them held no wall
 * to put on top.
 *
 * Nor do they lose a size: **93 of the 134 land on a sized position of the base
 * family**, and the 41 that reach only `any size` are exactly
 * `floor|curve|separate wall`'s, whose own family had no size control either —
 * its whole domain was inexpressible, and it is one of the two entries this row
 * retires from the palette's list of eight.
 */
export const BASE_ONLY_KEYS: readonly string[] = [
  'floor|curve|separate wall',
  'floor|straight|separate wall',
  'wall|corner|separate wall',
  'wall|internal_corner|s2w',
]

/** The five build systems, as the tags a build-absent family denies by name. */
export const BUILD_TAGS: readonly string[] = [
  'build|s-system',
  'build|s2w',
  'build|separate wall',
  'build|thick wall',
  'build|wall on tile',
]

/**
 * Display names for the three axes.
 *
 * Authored, and the only authored payload of this module — 20 strings against a
 * family set that is entirely derived. A casing rule would have to know that
 * `s2w` is `S2W`, that `s-system` keeps its hyphen and that `wall on tile` keeps
 * its lower-case `on`, which is three exceptions over five values; a table is
 * the same information with nothing to get wrong.
 */
const LABELS: Readonly<Record<string, string>> = {
  /* B1's eight roles. `insert` keeps a label although {@link SKIPPED_ROLES}
     drops it, so a future generator that stops skipping it does not throw. */
  wall: 'Wall',
  floor: 'Floor',
  riser: 'Riser',
  column: 'Column',
  stair: 'Stair',
  roof: 'Roof',
  decor: 'Decor',
  insert: 'Insert',
  /* B1's seven forms. */
  straight: 'Straight',
  curve: 'Curve',
  corner: 'Corner',
  diagonal: 'Diagonal',
  hex: 'Hex',
  internal_corner: 'Internal Corner',
  octagon: 'Octagon',
  /* The five build systems. */
  's-system': 'S-System',
  s2w: 'S2W',
  'separate wall': 'Separate Wall',
  'thick wall': 'Thick Wall',
  'wall on tile': 'Wall on Tile',
}

/** A label for an axis value, or a throw naming the value the table is missing. */
function labelOf(value: string): string {
  const label = LABELS[value]
  if (label === undefined) {
    throw new Error(
      `no display label for the axis value ${value} — add one to LABELS in pipeline/families.ts`,
    )
  }
  return label
}

/* ---------------------------------------------------------------- the family */

/**
 * One position of a family's size control.
 *
 * `tags` are added to the instance's `parentTags`, where the slot's `constrain`
 * block collects them. Empty on {@link ANY_SIZE}, which every family has.
 */
export interface FamilySizePosition {
  /** *"2 wide by 2 deep"*, *"2 wide"*, *"any size"*. True of everything it admits. */
  readonly label: string
  /** Exact-match tags, from `sizeRefs`. One or two, or none. */
  readonly tags: readonly string[]
}

/**
 * The first position of every family: no size requirement at all.
 *
 * Not a fallback. It is what makes B3's five empty-domain families —
 * `wall|diagonal|separate wall` (121), `decor|straight` (26),
 * `wall|octagon|separate wall` (20), `wall|hex|thick wall` (8) and
 * `floor|octagon` (8), 183 records — *a family with no size control* rather than
 * a family that matches nothing. (B3's own count for the hex family was 56, and
 * 48 of those 56 were bases: it is one of the two families the base deny moves
 * most, from 56 records to 8.)
 *
 * It is also the only position two further populations can be reached at, both
 * measured in `families.test.ts`:
 *
 *   - **876 records with no resolved cell at all** — `pipeline/size.ts`'s 1,112
 *     refusals less the 236 that are inserts: 643 sub-90 degree sectors, 121
 *     diagonals, 56 hex, 28 half-pairs and 28 unstated.
 *   - **128 records whose cell the control names and whose tags do not say so**,
 *     102 of them 90 degree sectors and 26 `wall` footprints. Their cell
 *     resolves, the position exists, and the refs cannot reach them. It was 136
 *     records over 160 incidences before the base deny: a base could be missed
 *     twice, once in the base family and once under its role, and now it is
 *     missed only in the base family, so the incidences and the records are the
 *     same 128.
 */
export const ANY_SIZE: FamilySizePosition = { label: 'any size', tags: [] }

/** One generated family: a `RecipeTemplate` in waiting, plus its size domain. */
export interface GeneratedFamily {
  /** A slug of {@link key}. Distinct across the 47, and from all 40 fixture slugs. */
  readonly id: string
  /** *"Wall: Straight (Separate Wall)"*. Distinct across the 47. */
  readonly name: string
  /**
   * `role|form|build`, or {@link BARE_BASE_KEY}.
   *
   * The emitted `source`, because for a generated family the corpus key *is* the
   * provenance — the answer to *"where did this row come from"* that a fixture
   * answers with a file name.
   */
  readonly key: string
  /** The family's own tags: what a `constrain` entry inherits. */
  readonly tags: readonly string[]
  /** The one slot. Required, and required by construction — see the module note. */
  readonly slot: PartSlot
  /** {@link ANY_SIZE} first, then the expressible cells in ascending order. */
  readonly sizes: readonly FamilySizePosition[]
  /** Records the key selects. Reported and asserted; not emitted. */
  readonly records: number
  /** Designs those records belong to. Reported and asserted; not emitted. */
  readonly designs: number
  /** Cells the domain refused to spell. Reported; see the module note's table. */
  readonly inexpressibleCells: readonly string[]
}

/* --------------------------------------------------------------- the reading */

/** A record's tag list as strings, against the file's own table. */
function tagReader(file: CatalogFile): (record: CatalogRecord) => readonly string[] {
  const cache = new Map<TileId, readonly string[]>()
  return (record) => {
    const cached = cache.get(record.id)
    if (cached !== undefined) return cached
    const tags = record.tags.map((id) => file.tags[id] ?? '')
    cache.set(record.id, tags)
    return tags
  }
}

/** The single value of a total axis, or a throw — both axes are total on 8,702. */
function axisValue(tags: readonly string[], root: string): string {
  const prefix = `${root}|`
  const found = tags.filter((tag) => tag.startsWith(prefix))
  if (found.length !== 1) {
    throw new Error(`expected exactly one ${prefix} tag, found ${String(found.length)}: ${found.join(' ')}`)
  }
  return (found[0] ?? '').slice(prefix.length)
}

/**
 * `2x0.5`, the domain's own spelling of a cell — and only an identity.
 *
 * The *order* the positions come out in is numeric and comes from
 * {@link sizeControlFor}'s sort on `w` then `d`, not from this string: sorting
 * these lexically would put `1x1` after `0.5x0.5` correctly and `10x10` before
 * `2x2`, and `formatUnits` produces no leading zeros to fix that with.
 */
function cellKey(w: number, d: number): string {
  return `${formatUnits(w)}x${formatUnits(d)}`
}

/* -------------------------------------------------------------- the size domain */

/**
 * The position for one resolved cell, or `undefined` when the corpus cannot
 * spell it.
 *
 * `cell` before `run`, because `cell` is exact where it fires — `foot` equals the
 * tagged `size|width` / `size|depth` pair on **3,449 of 3,449** `rect` records —
 * and `run` is coarse by construction. A branch is taken only when its refs are
 * tags the table holds *and* it admits at least one of the family's own records
 * at that cell, which is what stops a `run` position being emitted for an arc
 * whose width is untagged.
 *
 * `sizeRefs`'s `deny` is deliberately not read. See the module note.
 */
function positionFor(
  w: number,
  d: number,
  atCell: readonly CatalogRecord[],
  tagsOf: (record: CatalogRecord) => readonly string[],
  has: (tag: string) => boolean,
): FamilySizePosition | undefined {
  const admits = (refs: readonly string[]): boolean =>
    atCell.some((record) => refs.every((ref) => tagsOf(record).includes(ref)))

  const cell: SizePredicate = { kind: 'cell', w, d }
  if (sizeRefsResolve(cell, has)) {
    const refs = sizeRefs(cell).require
    if (admits(refs)) {
      return { label: `${formatUnits(w)} wide by ${formatUnits(d)} deep`, tags: refs }
    }
  }

  const run: SizePredicate = { kind: 'run', run: w }
  /* `.require` only, and `sizeRefsResolve` would test the deny refs as well —
     which resolve, but are not emitted, so testing them would be testing a
     ref this module does not use. */
  const runRefs = sizeRefs(run).require
  if (runRefs.every((ref) => has(ref)) && admits(runRefs)) {
    return { label: `${formatUnits(w)} wide`, tags: runRefs }
  }

  return undefined
}

/**
 * A family's size control: {@link ANY_SIZE}, then one position per expressible
 * cell, ascending by width then depth.
 *
 * Deduplicated on the emitted tag list, because two cells can resolve to one
 * position: a `run` position drops the depth, so `2x0.5` and a hypothetical
 * `2x0.75` would both spell `size|width|2`. It happens on 0 of the 273 cells
 * today and the dedupe is asserted rather than assumed, so a corpus that creates
 * one does not put the same position in a control twice.
 */
function sizeControlFor(
  records: readonly CatalogRecord[],
  tagsOf: (record: CatalogRecord) => readonly string[],
  has: (tag: string) => boolean,
): { sizes: readonly FamilySizePosition[]; inexpressibleCells: readonly string[] } {
  const byCell = new Map<string, { w: number; d: number; records: CatalogRecord[] }>()
  for (const record of records) {
    const size = resolveGridSize(record.foot, tagsOf(record))
    if (size === undefined) continue
    const key = cellKey(size.w, size.d)
    const bucket = byCell.get(key) ?? { w: size.w, d: size.d, records: [] }
    bucket.records.push(record)
    byCell.set(key, bucket)
  }

  const ordered = [...byCell.entries()].sort(([, a], [, b]) => a.w - b.w || a.d - b.d)
  const sizes: FamilySizePosition[] = [ANY_SIZE]
  const seen = new Set<string>()
  const inexpressibleCells: string[] = []
  for (const [key, bucket] of ordered) {
    const position = positionFor(bucket.w, bucket.d, bucket.records, tagsOf, has)
    if (position === undefined) {
      inexpressibleCells.push(key)
      continue
    }
    const fingerprint = position.tags.join(' ')
    if (seen.has(fingerprint)) continue
    seen.add(fingerprint)
    sizes.push(position)
  }
  return { sizes, inexpressibleCells }
}

/* ---------------------------------------------------------------- generation */

const CONSTRAIN_SIZE: readonly { readonly tag: string }[] = [{ tag: 'size|width' }, { tag: 'size|depth' }]

/** The refs of one family's slot, in emission order. */
function slotFor(name: SlotName, require: readonly string[], deny: readonly string[]): PartSlot {
  const refs = (tags: readonly string[]): TagRef[] => tags.map((tag) => ({ tag }))
  return {
    name,
    tags: {
      require: refs(require),
      ...(deny.length > 0 ? { deny: refs(deny) } : {}),
      constrain: [...CONSTRAIN_SIZE],
    },
  }
}

/**
 * A slug of a family key.
 *
 * The same construction `pipeline/templates.ts#templateSlug` uses, and
 * deliberately over the **key** rather than the name: the key is distinct across
 * the 47 by definition, so the slug is too, and it cannot move when a display
 * label in {@link LABELS} is reworded. `families.test.ts` asserts the 47 are
 * distinct and that none collides with the 40 fixture slugs.
 *
 * A trailing `|-` for an absent build system disappears, because the trailing
 * separator is stripped: `floor|straight|-` becomes `floor-straight`.
 */
export function familySlug(key: string): string {
  return key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Every generated family, in descending record count then ascending key.
 *
 * A family's records are the records its key selects **less the bases**, and a
 * key whose whole population is bases is not generated at all — see
 * {@link BASE_ONLY_KEYS}. Both facts live here rather than at the slot, because
 * the count, the size domain and this ordering are all read off the bucket.
 *
 * Descending because that is the order the coverage curve is read in and the
 * order a palette grouped by role still wants within a group; the key
 * tie-breaks, so two families of equal size cannot swap between runs and move
 * the emitted bytes.
 *
 * The bare-base family is **last** rather than first, so the 46 keyed families
 * are a contiguous prefix and the curve can be computed off the head of the
 * array.
 */
export function deriveFamilies(file: CatalogFile): readonly GeneratedFamily[] {
  const tagsOf = tagReader(file)
  const table = new Set(file.tags)
  const has = (tag: string): boolean => table.has(tag)

  interface Bucket {
    readonly role: string
    readonly form: string
    readonly build: string | undefined
    readonly records: CatalogRecord[]
  }
  const buckets = new Map<string, Bucket>()
  for (const record of file.records) {
    const tags = tagsOf(record)
    const role = axisValue(tags, 'role')
    if (SKIPPED_ROLES.includes(role)) continue
    /* A base is not a member of the family it keys to — it is what that
       family's piece *sits on*. It keys there because it inherits the role, so
       the split has to happen here rather than in the sort: `records`, the size
       domain and the emission order are all counted off this bucket, and a
       bucket holding bases would make all three describe a population the slot
       denies. See the module note on `shape|base`. */
    if (tags.includes(BARE_BASE_KEY)) continue
    const form = axisValue(tags, 'form')
    const build = record.build
    const key = `${role}|${form}|${build ?? '-'}`
    const bucket = buckets.get(key) ?? { role, form, build, records: [] }
    bucket.records.push(record)
    buckets.set(key, bucket)
  }

  const keyed = [...buckets.entries()]
    .sort(([keyA, a], [keyB, b]) => b.records.length - a.records.length || (keyA < keyB ? -1 : 1))
    .map(([key, bucket]) => {
      const { sizes, inexpressibleCells } = sizeControlFor(bucket.records, tagsOf, has)
      const require = [`role|${bucket.role}`, `form|${bucket.form}`]
      if (bucket.build !== undefined) require.push(`build|${bucket.build}`)
      const name =
        `${labelOf(bucket.role)}: ${labelOf(bucket.form)}` +
        (bucket.build === undefined ? '' : ` (${labelOf(bucket.build)})`)
      return {
        id: familySlug(key),
        name,
        key,
        tags: require,
        /* Two denies, and neither is expressible as a `require`: `shape|base`
           is the base that goes *under* this family's piece, and the five
           build tags are the *absence* of a build system. Both exact — every
           base carries the tag and no record carries two build tags. */
        slot: slotFor(bucket.role, require, [
          BARE_BASE_KEY,
          ...(bucket.build === undefined ? BUILD_TAGS : []),
        ]),
        sizes,
        records: bucket.records.length,
        designs: new Set(bucket.records.map((record) => record.design)).size,
        inexpressibleCells,
      }
    })

  const bases = file.records.filter((record) => tagsOf(record).includes(BARE_BASE_KEY))
  const baseControl = sizeControlFor(bases, tagsOf, has)
  const bareBase: GeneratedFamily = {
    id: familySlug(BARE_BASE_KEY),
    name: 'Base (Bare)',
    key: BARE_BASE_KEY,
    tags: [BARE_BASE_KEY],
    slot: slotFor('base', [BARE_BASE_KEY], []),
    sizes: baseControl.sizes,
    records: bases.length,
    designs: new Set(bases.map((record) => record.design)).size,
    inexpressibleCells: baseControl.inexpressibleCells,
  }

  return [...keyed, bareBase]
}

/* ----------------------------------------------------------------- the layout */

/**
 * The layout of a one-slot family, spelled once.
 *
 * Every field is forced: the slot is the cell because there is no other slot,
 * the anchor is `cell` because `slotOffset` returns `[0, 0]` for it without
 * reading the cell at all, the side is 0 because `cell` ignores it, and
 * `restsOn` is the ground because there is nothing to rest on.
 *
 * **Not emitted, and not registered as a fourth `SlotConvention`.**
 * `src/template/rules.ts` is row B2's file and has *"deliberately no fallback
 * entry"*; `conventionFor(['wall'])` is `undefined` and this row leaves it that
 * way. It is here so that a consumer needing the value has one source for it
 * rather than authoring a fourth copy, and so `families.test.ts` can assert
 * that all 47 layouts really are this one rule.
 */
export function familyLayout(family: GeneratedFamily): TemplateLayout {
  return {
    cell: family.slot.name,
    slots: [{ part: family.slot.name, anchor: 'cell', side: 0, restsOn: null }],
  }
}

/* ------------------------------------------------------------------ the bytes */

/**
 * Raw bytes the two generated consts add to {@link
 * import('./templates').TEMPLATES_MODULE_PATH}.
 *
 * The whole price of shipping all 47 families rather than the plan's first 20,
 * and the number the cut is argued against in the module note. Measured by
 * emitting the module twice — with the families and with none —
 * so `families.test.ts` fails when this constant and the emitter disagree,
 * rather than when a reader notices.
 *
 * 24,561 B of it is the `GENERATED_FAMILIES` const and 20,138 B the
 * `GENERATED_FAMILY_SIZES` one. They sum to 44,699 rather than to the delta
 * because the familyless module still spells both declarations (211 B of empty
 * `[]` and `{}`) and its header line still states its counts, 7 B shorter. At
 * brotli-11 the whole delta is **1,877 B** of module source, the emitted table
 * being 47 near-identical blocks, which is the shape brotli is best at.
 *
 * ## What it costs the bundle, which row C1 now pays
 *
 * The A/B this docblock carried was measured before row C1 imported the table,
 * when rolldown still tree-shook both consts out of every chunk and the shipped
 * cost was 0 B. C1 wired the palette, so the table ships: it lands in the lazy
 * `placeOnPlan` chunk, which `src/builder/panels/families.ts` reaches through
 * `@/screens/assemblies/templates`.
 *
 * | lazy `placeOnPlan` chunk | raw | gzip |
 * | --- | ---: | ---: |
 * | before the base deny, 51 families / 350 positions | 99,968 B | 13,501 B |
 * | after, 47 families / 304 positions | **96,818 B** | **13,389 B** |
 *
 * So this row **returns 3,150 B raw / 112 B gzip** to the one chunk that carries
 * the table, and the entry chunk does not move — 509.73 kB in both builds, to
 * the byte. Both rows are one `npm run build` on this tree either side of the
 * regeneration, measured with `gzip -9` rather than read off the reporter, so
 * they are comparable with each other and not with the table this replaced.
 *
 * The **index** gains 0 B in every case, which is structural: nothing on
 * `build.ts`'s path imports this module. Proved by digest, not by a byte count —
 * the serialised index is sha256 `cf21ab85ac304a20…`, 5,907,324 B raw and
 * 366,173 B brotli, which is the same digest `templates.test.ts` recorded from a
 * tree with row B2 reverted, and `npm run stamp` reports
 * `content 7bf89a1d617714ff` unchanged with `PIPELINE_VERSION` still 2.
 */
export const FAMILY_TABLE_BYTES = 44_495
