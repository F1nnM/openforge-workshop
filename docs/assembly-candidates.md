# Every assembly worth hand-authoring, enumerated and priced

> **Superseded. Both recommendations shipped as #136 and were withdrawn by #143.** The
> measurements below stand — every count is reproducible against the pinned index — but the
> **decision** they lead to is wrong, and the reason is a fact this document never measured: an
> `s2w` floor is the tile *minus* the strip its separately printed wall stands on, so it measures
> 0.5 less on each walled axis than its `size|width` / `size|depth` tags say
> (`…#floor+s2w+curved.2x2` is **1.5 × 1.5**, the `4x4` is **3.5 × 3.5**).
>
> Every floor slot of every one of the 40 requires `build|s2w` for that reason. §1's recommended
> edit lifts it, so the widened slot admits floors that fill the whole cell while the walls stand
> beside them — and §3's corridor needs a floor 0.5 short on two *opposed* faces, which the archive
> does not contain in any of its five `s2w` floor kinds. `src/template/rules.ts#SlotAnchor` and
> `#SLOT_CONVENTIONS` carry the measurement and the withdrawal;
> `docs/templates-plan.md` §7 carries the history.
>
> Read this document as *"what the floor axis looks like if the floor is a full tile"* — which is
> what §4's nesting finding is really about, and which is still true of a floor slot that does not
> stand walls beside its fill.

**Row D10 — measurement. Seventeen candidates enumerated across three tiers, and the recommendation
is one edit to one existing fixture.** The row authors nothing: no fixture, no fourth layout
convention, no regenerated template module.

Every figure is a command against the pinned `public/catalog/catalog.json` (8,702 records, 3,822
designs, 930 tags) through the app's own machinery — `src/composition`'s resolver,
`src/screens/assemblies/assembly.ts#resolvePart` and `#assemblyState`, `src/template/fill.ts`'s
`solveTemplateFills`, `src/template/measure.ts`'s two walks, `src/template/offsets.ts#placeTemplateSlots`
and `src/template/rules.ts#conventionFor`. The index was verified by
`public/catalog/stamp.json`'s stable identity before anything was measured —
`lock.content 09cca68bb8a958f5b5174f5d20888fa0988197be10848fd684390d1f993ae271`,
`corpus.digest 2027f1832cd11829227f5f213fb37fbb4700efd54b8d9cd0a864602f04111e25` — and not by
`catalog.json`'s sha256, which changes on every `npm run stamp` because `version.built` is a clock.

---

## 1. The decision

**Build one row. It is an edit, not an addition, and it costs the palette zero rows.**

| do this | rows | assemblies reach | palette reach |
| --- | ---: | --- | --- |
| nothing | 87 | 3,079 rec (35.4%) / 905 des (23.7%) | 8,417 rec (96.7%) / 3,728 des (97.5%) |
| **lift `shape\|floor\|wall + build\|s2w` off the floor slot of `S2W: Wall on Tile: Wall (Any, Modular)`** | **87** | **4,441 rec (51.0%) / 1,893 des (49.5%)** | 8,417 rec (96.7%) / 3,728 des (97.5%) |
| the same as a new fixture instead of an edit | 88 | 4,441 (51.0%) / 1,893 (49.5%) | unchanged |
| every Tier A candidate (10 rows) | 97 | 4,441 (51.0%) / 1,893 (49.5%) | unchanged |
| all 17 candidates in this document | 104 | 4,441 (51.0%) / 1,893 (49.5%) | unchanged |

Read the last three rows together. **Sixteen of the seventeen candidates add nothing.** One row takes
the assemblies section from a quarter of the archive's designs to half; the other sixteen are
cross-product filler, and the 128-row version of Tier A is filler 127 times over (§4).

**Optionally build one more: the corridor.** It needs a fourth layout convention, §8 of
`docs/assembly-generation.md` argued against one on grounds that do not survive measurement (§3), and
it closes cleanly. It is worth a row for what it *is* — the shape the archive has no assembly for —
and not for what it reaches, which is nothing. **Two prerequisites, both measured in §3.3.1:** its
base slot must admit `shape|base|hallway`, the 2x2 piece upstream authored for exactly this shape and
which the §3.3 predicate excludes; and its floor slot needs a minimum-**depth** predicate, because two
0.5-deep walls on opposite faces leave **270 floor records with zero walkable width** and the closure
check passes every one of them.

**Do not build the 3-wall dead end or the 4-wall closet.** Not because they are undecidable — they
are decidable, and they *fail* — but because `offsets.ts#cornerReservation` returns the wrong number
for a face flanked by two corners, and the closure verdict comes out **inverted**: `fails` on the
wall run that tiles the face, `closes` on the run that overlaps both columns (§3.4). That is a code
defect, not an archive gap, and repairing it is a behaviour change no measurement row should make.

**The three Tier C exclusions all hold** (§5) — but §9 of `docs/assembly-generation.md` has a wrong
table and the sentence that leans on it needs rewording.

---

## 2. The number that reframes the whole question

The palette holds 87 rows: **40 fixture assemblies + 47 generated one-slot families.** Resolved cold
through `src/composition`:

| | records | designs |
| --- | ---: | ---: |
| the 40 fixture assemblies | 3,079 (35.4%) | 905 (23.7%) |
| the 47 one-slot families | 8,417 (96.7%) | 3,728 (97.5%) |
| both together | **8,417 (96.7%)** | **3,728 (97.5%)** |

**The 40 assemblies reach zero records the 47 families do not already reach** — 0 of 3,079 outside,
measured both ways. The 285 records no family reaches are **all `layer: insert` with no `build|` tag**
(94 designs), and no assembly in any tier reaches an insert either.

So **every candidate in this document has a palette-level marginal gain of exactly 0 records and 0
designs**, and that is measured for all seventeen and not assumed for sixteen of them. This is §9 of
`docs/assembly-generation.md` — *"a missing assembly withholds convenience, not records"* — restated
as an arithmetic identity rather than a per-build survey.

What an assembly row buys is therefore **a curated pick, not coverage**, and the whole of this
document should be read as pricing convenience. The owner should not read any total here as archive
reach; the reach total is 96.7% and adding assemblies does not move it.

### The metric this document ranks on, and its bias

`reach` unions the *cold candidate pool of every slot*. It answers "what can this row show you", which
is the right question for a browse surface, and it has one bias worth naming: **a template with more
slots reaches more records whether or not it can be filled or laid out.** In §6's ranked table the
3-wall dead end sorts first on isolated reach and cannot complete a fill. Reach is not a buildability
metric and no row is recommended on reach alone.

---

## 3. §8's verdict: the generalisation does not hold, on all four candidates

§8 of `docs/assembly-generation.md` tested ten part-name sets, gave three a convention, and concluded:

> a `(wall, base)` convention has no `edge` slot with a cell to close against, so `verdictOf` would
> make every instance of it `undecidable` — … A fourth convention would be authored, unverifiable,
> and would earn nothing the one-slot family does not already earn.

The first clause is true of `(wall, base)`. **The generalisation to any fourth convention is false,
and it is false on every one of the four candidates the row was asked about.** Measured the way §8
measured — the convention written in a throwaway script, run through the real `solveTemplateFills`
and the real `placeTemplateSlots`:

| candidate part-name set | `conventionFor` | verdict | cell | area | walked closure |
| --- | --- | --- | --- | ---: | --- |
| `base, floor, left wall, right wall` — **corridor** | none | **`closes`** | 2x2 | **4.00** | 263 `closes` · 25 `fails` · 94 `undecidable` of 382 |
| `base, column, floor, wall` — **wall + post** | none | **`closes`** | 2x2 | **4.00** | **21 `closes` of 21** |
| 3-wall dead end (2 columns) | none | `fails` | 2x2 | 4.00 | 21 `fails` of 21 |
| 4-wall closet (4 columns) | none | `fails` | 2x2 | 4.00 | 21 `fails` of 21 |

Not one is `undecidable`. Two close on A10's **4.00 units²** invariant exactly, and two fail with a
named, numbered doubt. `undecidable` is the verdict `verdictOf` gives a layout with **no `edge` slot
at all**, and all four of these have between one and four.

### 3.1 Why the argument was structurally bound to fail

`verdictOf` ends:

```ts
return layout.slots.some((rule) => rule.anchor === 'edge') ? 'closes' : 'undecidable'
```

The `undecidable` fallback is reached only when *nothing* is edge-anchored. §8 generalised from the
one candidate set in its own table that has no floor — so no cell, so no edge — to sets that have
both. A corridor's floor cell gives it two opposite edge slots; sides 0 and 2 never meet, so there is
no mitre to get wrong and `cornerReservation` correctly returns **0 on all four faces**.

### 3.2 The project already ships an undecidable convention, and it is fine

The sharper point against §8's use of the word: `INTERNAL_CORNER` — `(base, column, floor)`, one of
the three shipped conventions — has no `edge` slot, so **all 38 of its walked combinations are
`undecidable`**, by design, and `rules.ts` says so in its own docblock. It is in the palette, it fills
40 of 40, and nobody minds. Re-measured here on this tree: the shipped internal corner and both
re-predicated variants of it come out `undecidable` with an **empty doubt list** and a 2x2 / 4.00
cell.

So `undecidable` is not a disqualification the project treats as one. It means *this shape has no
face to close against*, which for an internal corner is the truth about the shape.

### 3.3 The corridor, in full

`(base, floor, left wall, right wall)`, walls at sides 0 and 2, cell = `floor`, both walls
`restsOn: base`. Each wall slot takes the shipped `(Any, Modular)` wall predicate
(`build|separate wall + shape|wall`, denying `shape|curved` and `size|width|1.5`) plus D1's
`deny shape|base` and a `connection|side` constrain naming the other wall — which is why its cold
pool is 1,330 and not the shipped slot's 1,608. Floor is `shape|floor` denying `shape|base`; base is
`shape|base + shape|base|wall` with the shipped `build|s2w` requirement dropped, so 305/56 rather
than 48/8.

| | |
| --- | --- |
| cold pools (files/items) | `right wall` 1,330/387 · `left wall` 1,330/387 · `floor` 1,496/1,122 · `base` 305/56 |
| `solveTemplateFills` | **complete**, 0 unfilled |
| walk | **greying only** — the first-candidate walk does not complete it |
| `placeTemplateSlots` | **`closes`**, cell 2x2, area **4.00 units²**, doubts **none** |
| walked population | 382 combinations: **263 `closes` (68.8%)**, 25 `fails` (6.5%), 94 `undecidable` (24.6%) |
| walked `fails` | all 25 `right wall: over-run` |
| walked `undecidable` | 59 `base: unfilled` · 25 `right wall: no-run` · 10 `right wall: no-footprint` |
| walked cells | 2x2 ×200, 4x2 ×69, 1x1 ×59, 3x3 ×51, 4x4 ×3 |

Compare the shipped conventions on their own walked populations (`src/template/corpus.test.ts`):
`wall-on-tile` 980 `closes` / 25 `fails` / 138 `undecidable` of 1,143; `external-corner` 34/0/0;
`internal-corner` 0/0/38. **The corridor's 68.8% sits between `wall-on-tile`'s 85.7% and
`internal-corner`'s 0%**, and it is a member of the same population rather than an easy case.

Drawn through the canvas's own arithmetic — `footprintExtent`, then
`dx = offset.x − drawn.w/2 + cell.w/2` — on a 2x2 cell with two 2-unit walls:

| part | x | z |
| --- | --- | --- |
| `base` | [0, 2] | [0, 2] |
| `floor` | [0, 2] | [0, 2] |
| `right wall` (edge, side 0) | [0, 2] | [0, 0.5] |
| `left wall` (edge, side 2) | [0, 2] | [1.5, 2] |

**Zero overlapping pairs, zero parts outside the cell, union = cell, area 4.00.** A10's rigid body
holds.

**The one thing that decides it is authorship, exactly as §6 said.** The same corridor with the walls
predicated on bare `shape|wall` (no `build|separate wall`) fills with a `{shape:'wall', length:1.5}`
s2w piece and comes out **`fails`, `want=2 got=1.5` on both walls**. Requiring `build|separate wall`
is what makes it close, and no axis carries that fact.

### 3.3.1 The corridor's floor and base, measured after the fact

Two corrections to §3.3's predicates, and one gap in the closure check that only a corridor could
have exposed. Measured on this tree against `public/catalog/catalog.json`, prompted by the project
owner asking whether a fitting floor piece exists at all.

**The archive already ships a corridor piece, and it is a base.** `plain#base+hallway.2x2` — **12
records** over the connection variants, 2 designs (plain and electronics), tagged
`size|width|2 + size|depth|2`, plus the inferred `role|floor` and `form|straight`. That is the same
2x2 cell §3.3 closed on at area 4.00, reached independently: §3.3's cell came from the walk, this
comes from upstream authorship.

It is a distinct piece rather than a renamed square, and the triangle counts say so — from the
binary-STL `84 + 50n` identity, both at 2x2 openlock:

| 2x2 base | bytes | triangles |
| --- | ---: | ---: |
| `plain#base+hallway.2x2.openlock` | 102,084 | **2,040** |
| `plain#base+square.2x2.openlock` | 282,484 | 5,648 |

Under half the square base's geometry, which is what clips on **two opposite edges only** would cost
— the two ends a corridor segment chains along, leaving its two long sides to carry the walls. The
hallway figure is confirmed against the file itself: header `OpenSC…`, facet count field **2,040**,
and `84 + 50 x 2040 = 102,084`, the byte length exactly.

**A third row was here and has been withdrawn.** It read `plain#base+s2w+square+wall.2x2.openlock`
at 4,765 triangles, which is not a number: `(238,380 - 84) / 50 = 4765.92`, and floor division hid
the remainder. The file opens `solid ` — it is **ASCII STL**, so the identity does not apply to it at
all. **1,013 of the 8,702 records (11.6%) are not binary**, 999 of them `texture|plain`; see
`docs/tile-sizing.md`. The comparison above is unaffected, because both surviving rows are binary and
divide exactly.

**§3.3's base slot cannot reach it.** That slot requires `shape|base + shape|base|wall`, and
**0 of the 12 hallway bases carry `shape|base|wall`** — checked all twelve. So the corridor as
measured fills its base from the 305-record wall-base pool and structurally excludes the one piece
upstream built for the shape. The predicate wants `shape|base|hallway`, and this is the same class of
finding as §3.5's pinned base size: an authored fact no axis carries.

**§3.3's floor slot admits 270 records that leave nothing to walk on.** Two 0.5-deep walls on
opposite faces consume a full unit — and **of one specific axis**. The convention fixes both walls at
sides 0 and 2, which §3.3's drawn table shows are the two *z* faces, so the dimension that decides
whether a corridor has a floor is the floor's **depth**, not its smallest dimension. The two readings
disagree, and the first draft of this section used the wrong one:

| floor depth | records **by depth** | *(by min dimension)* | walkable across | |
| ---: | ---: | ---: | ---: | --- |
| 1 | **270** | *281* | **0.0** | the two walls meet; the tile is solid stone |
| 2 | 564 | *600* | 1.0 | 25.4 mm, one 25 mm mini base |
| 3 | 103 | *99* | 2.0 | two abreast |
| 4 | 252 | *209* | 3.0 | |
| 6 | 20 | *20* | 5.0 | |
| 8 | 15 | *15* | 7.0 | |

Depth is the right column. A `1 x 2` floor has a *min dimension* of 1 but a depth of 2, so it is a
short corridor segment one unit long and perfectly walkable; a `2 x 1` floor is the solid one. Over
the 1,496-record floor pool — 1,224 `rect`, 272 non-`rect` — **954 of the 1,224 rect floors (747
designs) are usable by depth**, against 943 / 736 under the wrong reading.

**And the 270 `closes`.** No overlapping pair, union = cell, area exact to the unit — §3.3's walked
cell histogram counts `1x1 ×59` among them. This is the gap:

> `placeTemplateSlots` proves that parts do not overlap and that they cover the cell. It cannot prove
> that anything is left to walk on.

A 1x1 corridor is geometrically flawless and functionally a wall. The shipped 40 never needed the
check — one 0.5 wall on a 1-unit floor still leaves 0.5 — and a corridor is the first layout in which
**two slots eat the same axis**. So a corridor needs a minimum-depth predicate on its floor, which is
a *third* kind of authorship beyond the two this document already records: §3.5's pinned size stops a
sibling being poisoned, while this one exists to preserve function.

Whether the default should be 2 or 3 units across is a design decision and not a measurement. 1 grid
unit is 25.4 mm against a 25 mm mini base, so a 2x2 corridor is one mini wide with 0.4 mm to spare;
two abreast needs min-dim 3, and that pool is 99 records against 600. Upstream calls the 2x2 piece a
hallway, which is the strongest argument for taking 2 as the default and letting the armed size
control widen it, rather than predicating the recipe on 3.

### 3.4 The two-corner faces: a code defect, and the verdict is inverted

The 3-wall dead end and the 4-wall closet fail for one reason, and it is not the archive.

`cornerReservation` sums the corner spans on a face **signed** — `+span` at the face's `−x` end,
`−span` at `+x`. On the external corner, where each face touches exactly one column, that is right and
D9 measured it right. **On a face flanked by two corners the two signs cancel to 0:**

| layout | face | columns touching it | `cornerReservation` |
| --- | ---: | --- | ---: |
| 3-wall dead end | 0 | right column *and* left column | **0** |
| 3-wall dead end | 1 | right column | 0.5 |
| 3-wall dead end | 3 | left column | −0.5 |
| 4-wall closet | 0, 1, 2, 3 | two each | **0, 0, 0, 0** |

The correct magnitude is 1.0. The consequence, measured on the dead end's back face — a 2-unit face
with 0.5 of column at each end, so 1.0 of run free:

| back-wall run | verdict | doubt | drawn | overlaps |
| ---: | --- | --- | --- | --- |
| **1.0** — the run that tiles | **`fails`** | `over-run want=2 got=1` | x ∈ [0.5, 1.5] | **none** |
| 1.5 — the archive's own pick | `fails` | `over-run want=2 got=1.5` | x ∈ [0.25, 1.75] | both columns |
| **2.0** | **`closes`** | none | x ∈ [0, 2] | **both columns** |

**The verdict is exactly backwards on both ends.** The 4-wall closet with 2-unit walls reports
`closes` with an empty doubt list and draws **12 overlapping pairs** inside a 2x2 cell; the dead end
reports `closes` and draws 2. This is precisely the failure D8 measured and D9 repaired for the
external corner — *"the `fails` recipe drew a flawless L and the `closes` recipe drew each wall a
quarter unit over the column"* — returning for any convention that puts two corners on one face.

The archive cannot route round it. `edgeRun` over the pools:

| pool | files | runs |
| --- | ---: | --- |
| `shape\|wall + size\|width\|1.5` (the corner-wall pool) | 490 | 1.5 ×470, 1.547 ×20 — **zero at 1.0** |
| `build\|separate wall + shape\|wall`, deny curved/1.5 | 1,608 | 2 ×583, 4 ×356, 3 ×262, **1 ×252**, `diag` 99, 0.5 ×33, `none` 22, `tri` 1 |
| any `shape\|wall`, deny 1.5 | 3,850 | 2 ×1,065, `arc` 855, 4 ×620, 3 ×460, **1 ×443**, 1.5 ×213, `diag` 99, `none` 43, 0.5 ×32, 1.991 ×20 |

The 1.0 runs exist — 252 of them in the pool a dead end would draw from. They are unusable here
because the closure check would call them `fails`. **So the blocker on the two multi-column shapes is
`offsets.ts`, and until that is decided they should not be authored.** A face flanked by two corners
is a decision about whether corner spans compose additively, and it is the same class of decision D8
declined to make without a measurement.

### 3.5 The wall + post closes, once it is authored the way the shipped corner is

`(base, column, floor, wall)` needed three attempts, and the two failures are the finding.

| attempt | wall predicate | base | fill | verdict |
| --- | --- | --- | --- | --- |
| B2 | shipped `(Any)` wall, deny `size\|width\|1.5` | `shape\|base\|wall`, `size\|` inherited | complete | **`fails`** `wall: over-run want=2 got=2.5` |
| B2b | `shape\|wall + size\|width\|1.5` | `shape\|base\|wall`, `size\|` inherited | **incomplete**, `wall` `closed-by-siblings` | `undecidable` |
| **B2d** | `shape\|wall + size\|width\|1.5` | **pinned `size\|width\|2 + size\|depth\|2`, no `size\|` constrain** | **complete** | **`closes`**, 2x2, 4.00, 0 doubts, **21 of 21 walked** |

B2's `fails` is D9's mitre read from the other side: a 2-unit run plus a 0.5 column does not tile a
2-unit face, and the run that does is 1.5. So the shape *needs* the corner-wall pool.

B2b's failure is the more interesting one and it took a probe to find. All **25 of 25** column
candidates leave the 1.5-wall slot non-empty (surviving-wall histogram 40→3, 137→5, 490→17 —
**identical to the shipped external corner's control**), so the column is not the problem. The wall
slot had 137 candidates after the column pick and **all 137 were skipped**: the base's
`constrain: [{tag: size|width}, {tag: size|depth}]` inherits the wall's `size|width|1.5`, and **there
is no 1.5-wide base in the archive**, so every wall pick empties the base.

**All four shipped corner recipes avoid this by pinning the base to `size|width|2 + size|depth|2` and
carrying no `size|` constrain at all.** That is not a style choice — it is the authored decision that
keeps a 1.5-wide wall from poisoning a base that cannot be 1.5 wide, and it is invisible until you try
to write a fifth recipe. It belongs in `docs/assembly-generation.md` §6's list of things a generator
cannot derive.

With that authorship B2d draws exactly D9's L, minus one wall: `wall` x ∈ [0.5, 2] z ∈ [0, 0.5],
`column` x ∈ [0, 0.5] z ∈ [0, 0.5] — abutting, disjoint, inside [0, 2]².

### 3.6 What a fourth convention actually costs

Not bytes. `pipeline/templates.ts#templateConvention` reads `conventionFor` at import time and
**throws**, naming the fixture and telling the author to *"author one in src/template/rules.ts"* — so
a Tier B fixture without a convention fails `npm run import:catalog` rather than reaching the browser.
The conventions ship in the bundle and the index gains **0 B**, which `pipeline/templates.test.ts`
asserts by rebuilding the corpus rather than quoting.

No new byte figure is offered here, deliberately. D4 measured +4/+8/+12/+40 entries at
+227/+3/+115/+176 B — **not monotone** — because brotli is not additive over a 5.9 MB payload. A byte
figure is a fact about one artefact at one epoch and never a rate.

The real cost of a Tier B row is **one `SlotConvention` in `src/template/rules.ts`, an entry in
`SLOT_CONVENTIONS`, and the assertions in `rules.test.ts` and `corpus.test.ts` that every other
convention carries** — plus, for the corridor, a statement that sides 0 and 2 are opposite, which is
the one thing that makes it not a corner.

---

## 4. Tier A: the floor axis has one useful point, and the base axis has one more

Tier A varies the **floor** and **base** predicate across the three existing part-name sets, so
layout is free. All ten rows below key on `wall-on-tile` through `conventionFor`.

The axis was derived from the pool, not from taste. The floor pool — `shape|floor` and not
`shape|base` — is **1,496 records / 1,122 designs**, by build: *(absent)* 965, `wall on tile` 354,
`s2w` 176, `separate wall` 1. Every tag on ≥2% of it was enumerated; the candidates below are the
ones that name a distinguishable kind of floor.

| # | floor predicate | base predicate | cold (files/items) | fill | walk | layout | cell / area | doubts | isolated | **marginal** |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | ---: | ---: |
| **A8** | `shape\|floor` | `shape\|base\|square` | 1,608/428 · 1,496/1,122 · 281/30 | complete | first | `closes` | 2x1 / 2.00 | none | **+1,362 / +988** | **+1,362 / +988** |
| A9 | `shape\|floor` | `shape\|base\|wall` | 1,608/428 · 1,496/1,122 · 305/56 | complete | greying | `closes` | 2x2 / 4.00 | none | +1,362 / +988 | **+0 / +0** |
| A1 | `shape\|floor` | `shape\|base\|wall + build\|s2w` | 1,608/428 · 1,496/1,122 · 48/8 | complete | greying | `closes` | 2x2 / 4.00 | none | +1,362 / +988 | **+0 / +0** |
| A4 | `shape\|floor + shape\|square` | `shape\|base\|square` | 1,608/428 · 690/465 · 281/30 | complete | first | `closes` | 2x1 / 2.00 | none | +689 / +464 | **+0 / +0** |
| A3 | `shape\|floor + shape\|square` | `shape\|base\|wall + build\|s2w` | 1,608/428 · 690/465 · 48/8 | complete | greying | `closes` | 2x2 / 4.00 | none | +689 / +464 | **+0 / +0** |
| A2 | `shape\|floor + build\|wall on tile` | `shape\|base\|wall + build\|s2w` | 1,608/428 · 354/314 · 48/8 | complete | first | `closes` | 2x2 / 4.00 | none | +354 / +314 | **+0 / +0** |
| A5 | `shape\|floor + shape\|curved` | `shape\|base\|wall + build\|s2w` | 1,608/428 · 249/179 · 48/8 | complete | greying | **`undecidable`** | — | `floor: no-cell`, `floor: no-footprint` | +249 / +179 | **+0 / +0** |
| A6 | `shape\|floor + shape\|floor\|concave` | `shape\|base\|wall + build\|s2w` | 1,608/428 · 91/67 · 48/8 | complete | first | `closes` | 2x2 / 4.00 | none | +91 / +67 | **+0 / +0** |
| A7 | `shape\|floor + shape\|floor\|diagonal` | `shape\|base\|wall + build\|s2w` | 1,608/428 · 31/31 · 48/8 | complete | first | `closes` | 2x2 / 4.00 | none | +31 / +31 | **+0 / +0** |
| A0 | `shape\|floor + shape\|floor\|wall + build\|s2w` *(the shipped 32)* | `shape\|base\|wall + build\|s2w` | 1,608/428 · 88/88 · 48/8 | complete | greying | `closes` | 2x2 / 4.00 | none | +0 / +0 | **+0 / +0** |

Two facts explain the whole marginal column, and both are structural rather than lucky.

**The floor axis is a nesting, not a partition.** Every one of the seven floor predicates is a
*refinement* of `shape|floor`. Measured: of A2, A3, A5, A6, A7 and A0's reach, **0 records lie outside
A1's**. So the moment `shape|floor` is on the palette every other floor predicate is a smaller pick
list over the same records — a usability decision, not a coverage one, and it should be argued as one.

**The base axis has exactly one extra point.** A8 and A9 reach 281 and 75 records respectively that A1
does not, and both differences are the same fact: the `build|s2w` requirement on the shipped base slot
excludes the `separate wall` and *(absent)* bases. Once A8's `shape|base|square` base is present, A9
and A1 add nothing.

**A5 is not filler — it is broken.** A curved floor predicate fills with a `{shape:'none'}` record, so
`cellExtentOf` refuses it (`no-cell`) and the template is `undecidable`. `shape|curved` on a floor slot
is not an assembly candidate at any row count.

### 4.1 The combinatorial trap, priced

The brief's warning is 16 components × 2 print modes × 4 floor predicates = **128 rows**. Measured, by
re-flooring all 32 shipped wall fixtures four ways, cumulatively, on top of the 40:

| step | palette rows | marginal | cumulative |
| --- | ---: | ---: | --- |
| the 40 fixtures | 40 | — | 3,079 rec (35.4%) / 905 des (23.7%) |
| +32 rows, floor `shape\|floor` | 72 | **+1,362 rec / +988 des** | 4,441 (51.0%) / 1,893 (49.5%) |
| +32 rows, floor `build\|wall on tile` | 104 | **+0 / +0** | 4,441 (51.0%) / 1,893 (49.5%) |
| +32 rows, floor `shape\|square` | 136 | **+0 / +0** | 4,441 (51.0%) / 1,893 (49.5%) |
| +32 rows, floor `shape\|floor\|wall + build\|s2w` | 168 | **+0 / +0** | 4,441 (51.0%) / 1,893 (49.5%) |

And within the first 32, the wall axis collapses too:

| | palette rows | reach |
| --- | ---: | --- |
| the 2 `(Any)`-wall rows re-floored | 42 | **4,441 rec (51.0%) / 1,893 des (49.5%)** |
| the **1** `(Any, Modular)` row re-floored | **41** | **4,441 rec (51.0%) / 1,893 des (49.5%)** |
| the other 30 re-floored, *given* the 2 `(Any)` rows | 72 | +0 rec / +0 des |

**One row.** D4's framing — that the `(Any)`-wall rows carry almost all the gain — tests true and
this row can put a number on it: over the shipped 40, the **4 `(Any)` rows reach 2,842 of 3,079
records (92.3%) and 834 of 905 designs (92.2%)**, and the other 36 rows are worth **+237 records /
+71 designs** between them.

### 4.2 The corner sets

Tier A on the other two part-name sets, re-predicating the floor of the shipped `(Any, Modular)`
external corner and the shipped modular internal corner:

| candidate | cold (files/items) | fill | layout | cell / area | doubts | isolated | marginal |
| --- | --- | --- | --- | --- | --- | ---: | ---: |
| ext. corner, floor drops `build\|s2w` | 25/21 · 490/125 · 490/125 · 28/28 · 24/4 | complete, first | `closes` | 2x2 / 4.00 | none | +1 / +1 | +0 / +0 |
| ext. corner, floor `shape\|floor\|corner` unpinned | 25/21 · 490/125 · 490/125 · 45/45 · 24/4 | complete, first | `closes` | 2x2 / 4.00 | none | +18 / +18 | +0 / +0 |
| **A12** ext. corner, floor any 2x2 floor | 25/21 · 490/125 · 490/125 · **462/373** · 24/4 | complete, first | `closes` | 2x2 / 4.00 | none | +388 / +299 | +0 / +0 |
| int. corner, floor drops `build\|s2w` | 37/25 · 18/18 · 8/1 | complete, first | `undecidable` | 2x2 / 4.00 | none | +0 / +0 | +0 / +0 |
| **A14** int. corner, floor any 2x2 floor | 37/25 · **462/373** · 8/1 | complete, first | `undecidable` | 2x2 / 4.00 | none | +388 / +299 | +0 / +0 |

The corner floor slot is the tightest in the palette — **27 files on the shipped recipe**, against 462
for any 2x2 floor. A12 and A14 are the biggest *isolated* gains outside the wall set and still
marginal-zero, because their 462-record floor pool is a subset of A8's 1,496.

`shape|floor|corner`'s 45 records and `shape|floor|internal_corner`'s 18 are the whole corner floor
vocabulary, and both are `s2w`-heavy exactly as §4 of `docs/assembly-generation.md` found.

---

## 5. Tier C: the three exclusions hold, and §9's table does not

### 5.1 §2's grid reproduces exactly, post-D9

Denying `shape|base` on the three non-base slots, as D1 requires:

| build | `role\|floor` | `role\|wall` | `role\|column` | `shape\|base` |
| --- | ---: | ---: | ---: | ---: |
| `separate wall` | **0** | 2,545 | 51 | 755 |
| *(absent)* | 971 | 287 | 148 | 821 |
| `wall on tile` | 354 | 507 | 2 | **0** |
| `s2w` | 176 | 342 | 20 | 95 |
| `thick wall` | **0** | 297 | 2 | 292 |
| `s-system` | **0** | 286 | **0** | **0** |

**Every cell is identical to D4's.** This is worth stating plainly against the brief's framing:
*"everything numeric in `docs/assembly-generation.md` predates row D9, so re-measure"* is right about
**closure verdicts** and wrong about the **corpus census**. D9 changed `footprint.ts#cornerWallRun` —
what a mesh measures — not what a record is tagged, so §1, §2, §3, §4 and §10's coverage figures are
unmoved. The 40 fixtures' reach re-derives to **3,079 records (35.4%) / 905 designs (23.7%)**, the
same figures the brief said to re-derive rather than quote.

### 5.2 §12.3 — `thick wall` and `s-system`: excluded, confirmed

| | records | designs | layers | `role\|floor` | `shape\|base` | `shape\|base\|wall` | `shape\|floor` | reached by the 40 |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| `thick wall` | 591 | 162 | base 292, topper 208, integral 91 | **0** | 292 | **0** | **0** | **0 / 591** |
| `s-system` | 286 | 168 | topper 276, integral 10 | **0** | **0** | **0** | **0** | **0 / 286** |

Neither has a floor. `thick wall` has 292 bases and **not one carries `shape|base|wall`**, the tag
every one of the 32 wall recipes' base slots requires. `s-system` has no base and no column at all.
Their honest shape remains `(wall, base)` — the one set in §8's table that really has no cell — and
that set really is `undecidable`, for exactly the reason §8 gave. **The exclusion holds; only its
generalisation to other sets does not.**

`s-system`'s 84 of 286 records declaring accessory slots and `thick wall`'s 165 of 591 are unchanged.

### 5.3 §12.4 — `wall on tile` needs no assembly: confirmed, with one qualification

863 records, 823 designs, **0 `layer: base`**, **0 `shape|base`**, 354 `role|floor` / `shape|floor`,
507 `role|wall`. **295 of 863 declare their own `base` part** — the figure §12.4 rests on — out of
3,036 records carrying a `config` and 3,695 declared parts corpus-wide (`base` 2,451, `torch` 356,
`door` 248, `lintel` 143, …). It has no base of its own to stand on and does not need one.

The qualification: **`wall on tile` is a good *floor* supplier for somebody else's assembly.** Its 354
`role|floor` records are the whole of candidate A2's floor pool, and A2 fills and closes. That is D4's
own H2 and it is fine — the wall slot is pinned to `build|separate wall`, so this is not §7's "two
whole tiles stacked". §12.4's claim is that `wall on tile` needs no assembly *of its own*, and that
stands.

### 5.4 §9's table is wrong on this tree, and the sentence that leans on it needs rewording

§9 reports every named build system reaching **100% of its records through its own one-slot
families**, at 10/10/8/4/2/17 families. Re-measured, attributing each family by the third segment of
its own `source`:

| build | own families (D4) | records | reached by its own | designs |
| --- | ---: | ---: | ---: | ---: |
| `separate wall` | **7** (10) | 3,351 | **2,596 (77.5%)** | 709 / 826 |
| `wall on tile` | 10 (10) | 863 | 863 (100.0%) | 823 / 823 |
| `s2w` | **7** (8) | 633 | **538 (85.0%)** | 315 / 332 |
| `thick wall` | 4 (4) | 591 | **299 (50.6%)** | 124 / 162 |
| `s-system` | 2 (2) | 286 | 286 (100.0%) | 168 / 168 |
| *(absent)* | 17 (17) | 2,978 | 2,693 (90.4%) | 1,417 / 1,511 |

Three of the six are not at 100%, and **the shortfall is exactly each build's `shape|base` count** —
755, 95 and 292, against §5.1's grid, to the record. Those bases are all reached, by the one
build-agnostic family (`shape-base`), which has no `build|` segment in its source and so is not
"its own".

Against **all 47** families the claim holds without qualification:

| build | records | reached | designs |
| --- | ---: | ---: | ---: |
| `separate wall` | 3,351 | **3,351 (100.0%)** | 826 / 826 (100.0%) |
| `wall on tile` | 863 | **863 (100.0%)** | 823 / 823 (100.0%) |
| `s2w` | 633 | **633 (100.0%)** | 332 / 332 (100.0%) |
| `thick wall` | 591 | **591 (100.0%)** | 162 / 162 (100.0%) |
| `s-system` | 286 | **286 (100.0%)** | 168 / 168 (100.0%) |
| *(absent)* | 2,978 | 2,693 (90.4%) | 1,417 / 1,511 (93.8%) |

**`GENERATED_FAMILIES` is 47 on this tree; D4 measured 51.** The set shrank between D4 and `epic/v2`
head, which is why the per-build row counts do not reproduce. §9's substantive claim survives
unchanged, and its sentence should read *"through the 47 one-slot families"* rather than *"through its
own"*. Nothing follows for the three exclusions: `thick wall`'s bases are still reached, still by a
one-slot family, and still not by an assembly.

**No Tier C candidate is created.** All three exclusions stand.

---

## 6. The ranked table, and the ranking

Ranking order: **isolated reach, descending; ties in authored order.** Marginal gain is measured
*given every candidate above it*, on top of the shipped 40.

| rank | candidate | tier | marginal rec / des | cumulative |
| ---: | --- | --- | ---: | --- |
| — | the 40 fixtures | — | — | 3,079 (35.4%) / 905 (23.7%) |
| 1 | 3-wall dead end | B | +1,362 / +988 | 4,441 (51.0%) / 1,893 (49.5%) |
| 2 | A8 wall · floor:any · base:square | A | +0 / +0 | 4,441 / 1,893 |
| 3–17 | A9, A1, B2 wall+post, **B1 corridor**, A4, A3, B2b, B4 closet, A2, A5, A6, A0, A7, A12, A14 | A/B | **+0 / +0 each** | 4,441 / 1,893 |
| — | **all 17 + the 40 = 57 assembly rows** | | | **4,441 (51.0%) / 1,893 (49.5%)** |

The dead end sorts first only through the reach bias named in §2 — its `back wall` slot's 1,330-file
pool is the largest single pool in the set, and the candidate **cannot complete a fill**. Read rank 1
as A8's: the two are interchangeable at +1,362 / +988 and A8 is the one that fills and closes.

**The ceiling for the whole exercise is 4,441 records / 1,893 designs, and one row reaches it.**

At palette level, with the 47 one-slot families in the baseline, **all seventeen marginals are +0
records and +0 designs** (§2).

---

## 7. Recommendation

1. **Lift `shape|floor|wall` and `build|s2w` off the floor slot of
   `S2W: Wall on Tile: Wall (Any, Modular)`.** One edit to one shipped fixture. Palette stays at 87
   rows; the assemblies section goes from 3,079 records / 905 designs to **4,441 / 1,893**. It fills
   `complete`, `closes` at 2x2 / 4.00, and earns zero doubts. Keep the `build|separate wall` and
   `deny shape|curved` refs on the wall slot — they are what make it close (§3.3).
   Consider pairing it with the `shape|base|square` base of A8, which is the only base predicate that
   adds anything.
2. **Do not author the other nine Tier A rows.** Each is a nested refinement of the floor or base
   predicate above and adds **0 records and 0 designs**. If any is wanted, argue it as a shorter pick
   list and say so — not as coverage. `shape|curved` on a floor slot is `undecidable` and should not be
   offered at all.
3. **Do not build the 128-row cross-product, or the 72-row, or the 42-row version.** Measured:
   4,441 / 1,893 at 41 rows, and 4,441 / 1,893 at 168.
4. **The corridor `(base, floor, left wall, right wall)` is the one Tier B row worth a fourth
   convention** — if the owner wants the shape for its own sake. It fills complete, `closes` at 2x2 /
   4.00 with no doubts, closes on **263 of 382** walked combinations, and draws with no overlap. §8's
   argument against a fourth convention does not apply to it and does not apply to the wall + post
   either. Its coverage gain is **zero**, and that should be said out loud rather than dressed up.
   **Author it with §3.3.1's two corrections, not with §3.3's predicates**: require
   `shape|base|hallway` on the base — `plain#base+hallway.2x2` is upstream's own corridor piece at
   2,040 triangles against the square base's 5,648, and none of its 12 records carries the
   `shape|base|wall` that §3.3 demands — and put a minimum **depth** on the floor, expressible today
   as `deny size|depth|0.5, size|depth|1, size|depth|1.5`, or 270 of the 1,224 rect floors build a
   solid block of wall that the closure check calls `closes`.
5. **`(base, column, floor, wall)` — the wall + post — is the second candidate, and it is cheap**:
   21 of 21 walked combinations `closes`, no new part names, the first-candidate walk completes it. It
   needs the shipped corner's own authorship — the corner-wall pool *and* a base pinned to 2x2 with no
   `size|` inheritance (§3.5).
6. **Do not author the 3-wall dead end or the 4-wall closet until `cornerReservation` has an answer for
   a face flanked by two corners.** The verdict is inverted today: `fails` on the run that tiles,
   `closes` on the run that overlaps. The pool exists (252 files at run 1.0); the check does not accept
   it.
7. **All three Tier C exclusions hold.** Reword §9 of `docs/assembly-generation.md` from *"its own
   one-slot families"* to *"the 47 one-slot families"*, and correct the family count from 51 to 47.
8. **Correct §8 of `docs/assembly-generation.md`.** Its `(wall, base)` finding is right and its
   generalisation is not: two of the four candidate fourth conventions close on A10's invariant, and
   the project already ships an `undecidable` convention (`internal-corner`, 38 of 38) that nobody
   minds.
9. **`placeTemplateSlots` cannot see an unwalkable layout, and nothing else can either.** It proves
   disjointness and coverage; a 1x1 corridor satisfies both and is 100% wall (§3.3.1). The shipped 40
   never needed the check because no two of their slots eat the same axis. Any future convention that
   puts two `edge` slots on opposite faces inherits this, so the check belongs with the convention
   rather than with the recipe.

---

## 8. What to distrust in this document

- **Every reach figure is a cold pool union**, so it says what a row can *show*, not what it can
  *build*. §2 names the bias and §6 shows it mis-ranking a candidate that cannot fill.
- **`solveTemplateFills` picks one filling.** A `closes` verdict on the solver's pick is one point;
  the walked closure over the whole first-part population (§3.3) is the honest number and it is
  lower — 68.8% for the corridor against a single `closes`.
- **The Tier B conventions are written in throwaway scripts**, so no test asserts them. A real one
  would need the `rules.test.ts` acyclicity and adjacency assertions and a `corpus.test.ts` walked
  tally, which is where the actual authoring cost sits.
- **`reach` counts records a slot *admits*, and a template with more slots admits more.** Comparing a
  4-slot corridor to a 3-slot wall recipe on reach flatters the corridor.
- **No byte figure is quoted**, on purpose (§3.6).
- **Nothing here was verified against a mesh.** The 4.00 units² is arithmetic over tagged footprints,
  as A10's is.

---

## Appendix — commands

Throwaway scripts under
`/tmp/claude-1000/-home-finn-Repos-openforge-catalog/8b7e3f5c-f20f-4971-ba81-67c0cbc85a50/scratchpad/`,
each run from the worktree root as:

```
export MISE_TRUSTED_CONFIG_PATHS=$PWD TSX_TSCONFIG_PATH=tsconfig.app.json
npx tsx <script>.ts
```

| script | what it measured |
| --- | --- |
| `d10-base.ts` | the shared harness — catalog, composition/assembly indices, `reach`, `designsOf` |
| `d10-harness.ts` | the per-candidate contract: cold pools, `solveTemplateFills`, both walks, `placeTemplateSlots`, and `walkOne`, `corpus.test.ts`'s first-part walk over one template |
| `d10-baseline.ts` | the 40 / 47 / 87 palette structure, the 3,079 / 905 baseline, the floor and base predicates the 40 actually use |
| `d10-contain.ts` | fixture reach ⊆ family reach, and the 285 records no family reaches |
| `d10-floors.ts` | the 1,496-record floor pool and every tag on ≥2% of it — the floor axis |
| `d10-any.ts` | the 40 templates' cold pools and the `(Any)` rows' 92.3% / 92.2% share |
| `d10-tierA.ts` | the ten Tier A candidates, the nesting against A1, the ranked marginal |
| `d10-tierA2.ts` | Tier A on the external- and internal-corner part-name sets |
| `d10-trap.ts` | isolated gain per candidate, and the 16 × 2 × 4 = 128-row trap priced cumulatively |
| `d10-tierB.ts` | the four Tier B candidates as briefed, with the walked closure of each |
| `d10-tierB2.ts` | Tier B with the shipped corner-wall predicate |
| `d10-tierB3.ts` | Tier B with the shipped corner's full authorship, plus the A10 rigid-body overlap check |
| `d10-diag.ts` | `cornerReservation` on two-corner faces, and the column × wall sibling-emptiness probe against the shipped external corner as control |
| `d10-diag2.ts` | why the 1.5-wall slot is `closed-by-siblings` — the base's inherited `size|width` |
| `d10-invert.ts` | the inverted verdict at runs 1.0 / 1.5 / 2.0 on a face flanked by two columns |
| `d10-runs.ts` | the wall + post drawn, and `edgeRun` distributions over the three wall pools |
| `d10-tierC.ts`, `d10-tierC2.ts` | §2's grid, §12.3 / §12.4's figures, §9's table by family `source`, and the `config` slot census |
| `d10-rank.ts` | the ranked marginal table, at assembly level and at palette level |
