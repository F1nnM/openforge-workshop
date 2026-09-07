# Can a multi-slot assembly be generated for the other build systems?

**Row D4 — research. The answer is no, and the brief's framing of the question is wrong in a way
that matters more than the answer.**

Every figure below is from a command against the pinned `public/catalog/catalog.json`
(8,702 records, 3,822 designs, 930 tags) using the app's own machinery — `src/composition`'s
resolver and postings, `src/screens/assemblies/assembly.ts#resolvePart`, `src/template/fill.ts`'s
`solveTemplateFills`, `src/template/offsets.ts#placeTemplateSlots` and `src/template/rules.ts`'s
`conventionFor`. Nothing is quoted from another docblock without being recomputed here.

The harness reproduces the shipped measurements exactly, which is what makes the new figures
comparable to them: the 40 fixtures reach **3,079 of 8,702 records (35.4%)** and **905 of 3,822
designs (23.7%)**; `measureGreedy` completes **24 of 40** with all 16 failures on the `base` slot at
cold 48/305, `measureGreying` **40 of 40**, `solveTemplateFills` **40 of 40** at 288 queries and 23
candidates refused; `GENERATED_FAMILIES` completes **51 of 51** on the first candidate; and
`shape|base` is coextensive with `layer === 'base'` at **1,963 both ways, zero exceptions in either
direction**.

---

## 1. The brief's table is right about the tags and wrong about the archive

The census reproduces the brief's table to the record:

| `build\|` | files | designs |
| --- | ---: | ---: |
| `separate wall` | 3,351 | 826 |
| *(absent)* | 2,978 | 1,511 |
| `wall on tile` | 863 | 823 |
| `s2w` | 633 | 332 |
| `thick wall` | 591 | 162 |
| `s-system` | 286 | 168 |

What is wrong is the column that says *"has an assembly? no"*. **The 40 fixtures are not an s2w
assembly. They are a cross-build assembly whose largest supplier is `separate wall`.** Resolving all
128 parts cold through `src/composition`:

| build system of the *record* | reached by the 40 | of its own pool | designs |
| --- | ---: | ---: | ---: |
| `separate wall` | **2,286** | **68.2%** of 3,351 | 590 / 826 |
| `s2w` | 472 | 74.6% of 633 | 257 / 332 |
| *(absent)* | 321 | 10.8% of 2,978 | 58 / 1,511 |
| `wall on tile` | 0 | 0.0% | 0 / 823 |
| `thick wall` | 0 | 0.0% | 0 / 162 |
| `s-system` | 0 | 0.0% | 0 / 168 |

Per slot name, the union pool over all 40 templates, by the build system of the candidate:

| slot | files | breakdown |
| --- | ---: | --- |
| `wall` | 1,752 | `separate wall` 1,752 — **all of it** |
| `floor` | 133 | `s2w` 133 — all of it |
| `base` | 618 | `separate wall` 342, *(absent)* 208, `s2w` 68 |
| `right wall` / `left wall` | 680 each | `separate wall` 447, `s2w` 139, *(absent)* 94 |
| `column` | 50 | `s2w` 20, *(absent)* 19, `separate wall` 11 |

The fixtures say so in their own text: every one of the 32 wall templates requires
`build|separate wall` on its `wall` part and `build|s2w` on its `floor` part. **The `s2w` in the
name is the floor's build system — the tile — not the assembly's.** So `separate wall`, the corpus's
largest build system, already *is* the wall in "a floor plus two walls plus a column", for 2,286 of
its 3,351 records.

That reframes the question. A build system is a property of a *part*, not of an assembly, and
asking for "an assembly per build system" is asking for something the shipped forty do not
themselves have.

## 2. Four of the six build systems cannot supply a required slot at any price

The pools for the four slots the brief asks about, denying `shape|base` on the three non-base slots
as D1 requires (`shape|base` ↔ `layer === 'base'`, 1,963 both ways):

| build | `role\|floor` | `role\|wall` | `role\|column` | `shape\|base` |
| --- | ---: | ---: | ---: | ---: |
| `separate wall` | **0** | 2,545 | 51 | 755 |
| *(absent)* | 971 | 287 | 148 | 821 |
| `wall on tile` | 354 | 507 | 2 | **0** |
| `s2w` | 176 | 342 | 20 | 95 |
| `thick wall` | **0** | 297 | 2 | 292 |
| `s-system` | **0** | 286 | **0** | **0** |

(All 286 `s-system` records are `role|wall` and none is a base, so the base deny costs it nothing.
Its zeros are `floor`, `column` and `base`.)

**`separate wall` has no floor. `thick wall` has no floor. `s-system` has no floor, no column and no
base. `wall on tile` has no base.** These are not tag gaps. They are what the build systems *are*,
and the records say so plainly:

- a `thick wall` record is `layer: base`, `kinds: [base, wall]`, `shape|base shape|square shape|wall`,
  footprint `rect 2x2` — **a base with the wall integral to it**. 292 of its 591 records are
  `layer: base`. It does not stand on a floor; it *is* the floor's edge.
- a `wall on tile` record is `layer: topper`, footprint `rect 2x2`, `role|wall`, with a curved wall
  and an arched door — **a whole tile with a wall on it, printed as one piece**. It is already the
  assembly. 295 of its 863 declare their own `base` slot and 0 are `layer: base`.
- an `s-system` record has footprint `{shape: 'wall', length: 1}` and `component|adapter` — a wall
  strip for retrofitting. 84 of 286 declare accessory slots (`torch` 42, `door` 24, `top` 12,
  `lintel` 10, `grate` 6) and **0 of those slots are dead ends**.
- `separate wall` means the wall is separate from the tile: 3,351 records, 1,623 declaring 2,199 of
  their own slots (`base` 1,384, `torch` 219, `door` 207, `lintel` 124, …).

## 3. `role|wall` and "the wall part of an assembly" are the same object for four of six

The sharpest single measurement in this row. Share of each build system's `role|wall` records (bases
excluded) whose footprint is a whole `rect` tile rather than a wall run:

| build | `role\|wall` (not base) | `rect` footprint | share |
| --- | ---: | ---: | ---: |
| `separate wall` | 2,545 | 4 | **0.2%** |
| *(absent)* | 287 | 5 | 1.7% |
| `s2w` | 342 | 90 | 26.3% |
| `wall on tile` | 507 | 200 | 39.4% |
| `s-system` | 286 | 272 | **95.1%** |
| `thick wall` | 297 | 289 | **97.3%** |

Against that, the 40 fixtures' own `wall` slot pool is 1,752 files: `wall` 1,557 (88.9%), `diag` 121,
`column` 33, `none` 26, `rect` 14, `tri` 1. The `floor` slot pool is `rect` on **133 of 133**.

So a slot generated as `role|wall` is a *well-formed wall slot* for `separate wall` and a *tile
picker* for `thick wall` and `s-system`. B1's role axis answers "what does this piece do in a room";
for a thick-wall piece the answer is "it is the wall", and the piece is the whole tile. That is
exactly right for a one-slot family and exactly wrong for one slot of a floor-plus-wall assembly.

## 4. Every joinery tag the fixtures require is s2w-exclusive

Occurrences by build system:

| require ref | parts using it | `sep wall` | *(absent)* | `wot` | `s2w` | `thick` | `s-sys` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `shape\|floor\|wall` | 32 | 0 | 0 | 0 | **88** | 0 | 0 |
| `shape\|floor\|corner` | 4 | 0 | 0 | 4 | **41** | 0 | 0 |
| `shape\|floor\|internal_corner` | 4 | 0 | 0 | 0 | **18** | 0 | 0 |
| `shape\|corner\|right` | 2 | 0 | 0 | 0 | **133** | 0 | 0 |
| `shape\|corner\|left` | 2 | 0 | 0 | 0 | **133** | 0 | 0 |
| `shape\|column\|corner` | 4 | 0 | 0 | 0 | **20** | 0 | 0 |
| `shape\|base\|internal_corner` | 2 | 0 | 0 | 0 | **8** | 0 | 0 |
| `shape\|base\|corner` | 2 | 12 | 0 | 0 | 39 | 0 | 0 |
| `shape\|base\|wall` | 16 | 257 | 0 | 0 | 48 | 0 | 0 |
| `size\|column_shape\|L` | 8 | 11 | 19 | 0 | 20 | 0 | 0 |

Seven of the ten are 100% `s2w`; the other three are `s2w` plus `separate wall`. **`thick wall` and
`s-system` carry not one of them.** §1.2 of `docs/templates-plan.md` records that
`shape|floor|wall` is a choke point at 88 records; this row adds that it is an *exclusive* one.

The s2w recipes are expressible because the archive was tagged for them. The tags are the fixtures'
own vocabulary, not a general one, and there is nothing to substitute: no other build system has a
tag that says "this floor has a channel for a wall" or "this is the right-hand half of a corner".

## 5. B1's axes do not name the fixtures' own pools

Even given the vocabulary, a generator keyed on `(role, form, build)` cannot reproduce a single one
of the 40. Resolved cold, with the axis distribution of what each slot actually admits:

| template · slot | files | `role\|` | `form\|` |
| --- | ---: | --- | --- |
| modular ext. corner · `right wall` | 490 | `wall` 482, `stair` 8 | **`straight` 464**, `curve` 20, `corner` 6 |
| modular ext. corner · `column` | 25 | `column` 25 | **`straight` 25** |
| modular ext. corner · `base` | 24 | **`wall` 24** | `corner` 24 |
| single-piece corner · `base` | 26 | **`floor` 26** | `straight` 26 |
| modular wall · `wall` | 1,608 | `wall` 1,567, `column` 41 | `straight` 1,488, `diagonal` 100, `octagon` 16, `internal_corner` 4 |
| modular wall · `base` | 48 | **`wall` 48** | `straight` 48 |

Read the second row again: **a modular external corner's walls and column are `form|straight`.** A
corner is two straight 1.5-unit halves meeting at an L column — the fixture says so with
`size|width|1.5` and `size|column_shape|L` and never with `form|corner`. A generator that keys the
corner's wall slots on `form|corner` looks in the wrong pool; a generator that drops `form|corner`
has no way to know to look for 1.5. And the `base` slot's pool is `role|wall` on 48 of 48 and 24 of
24 — A9's finding, that a base keeps the role of what it sits *under* — so the base slot is not
keyable on a role at all.

The wall recipe fails the axis the other way: one recipe's `wall` pool spans four `form|` values, so
a form-keyed generator splits one authored template into four.

## 6. What a slot's constraints are: `constrain` is derivable, `require` and `deny` are authorship

Over the 128 parts: **408 require refs (37 distinct), 181 deny refs (9 distinct), 226 constrain
entries, 20 `fulfills`.**

### `constrain` — derivable, and one rule covers 28 of the 30 sibling lists

The 226 entries are six shapes only:

| count | entry |
| ---: | --- |
| 96 | `{tag: size\|width}` |
| 64 | `{tag: size\|depth}` |
| 18 | `{tag: connection, siblings: […]}` |
| 12 | `{tag: connection\|side, siblings: […]}` |
| 18 | `{filter: connection\|side}` |
| 18 | `{filter: connection\|openforge}` |

The two filters occur 18 times each and always together with the 18 `{tag: connection}` entries —
one rule, not 36 decisions. The size pair is what `pipeline/families.ts` already emits verbatim.
And the sibling lists reduce to one rule: **"every sibling that is not `floor` and not `base`"**
reproduces **28 of the 30**. The two misses are the two modular external corners' `base` slots,
which exclude the `column` — and the exclusion is behaviourally inert: resolved under the solver's
own fill, the base slot admits **24 candidates with the authored list and 24 with the column
added**.

The constrain block is not decoration. Resolved cold it changes nothing at all — all six slot totals
are identical with and without it, because a template's own tags carry no `size|` or `connection|`
tag to inherit. Resolved under the solver's own fill it narrows **14,241 candidates to 3,538, a
4.0× narrowing, changing 107 of 128 slots.** But it is derivable, and this row found no case where
it is not.

### `deny` — not derivable, and it is the whole safety of the thing

Dropping the deny block, per slot name, summed over the parts:

| slot | parts | files with deny | without | bases wrongly admitted |
| --- | ---: | ---: | ---: | ---: |
| `base` | 40 | 5,677 | 7,693 | **2,016** |
| `wall` | 32 | 4,061 | 7,254 | **351** |
| `column` | 8 | 112 | 182 | 0 |
| `floor` | 40 | 2,996 | 2,996 | 0 |
| `right wall` / `left wall` | 4 each | 698 / 697 | unchanged | 0 |

Marginal contribution of each deny ref, summed over the parts carrying it:

| deny ref | parts | files it excludes | of which `layer: base` | designs |
| --- | ---: | ---: | ---: | ---: |
| `shape\|curved` | 32 | 2,248 | 232 | 213 |
| `size\|width\|1.5` | 32 | 885 | 107 | 110 |
| `build\|s2w` | 23 | 860 | 832 | 17 |
| `shape\|option\|notch` | 40 | 368 | 368 | 2 |
| `shape\|column\|low` | 8 | 34 | 0 | 9 |
| `component\|secret_door` | 2 | 24 | 0 | 12 |
| `shape\|wall` | 24 | **0** | 0 | 0 |
| `shape\|base\|corner` | 16 | **0** | 0 | 0 |
| `shape\|base\|wall` | 4 | **0** | 0 | 0 |

Every live one is a *negative fact about the archive that no axis carries*. `deny shape|curved` on
all 32 wall slots excludes 2,248 files — a person knowing a curved wall cannot sit on a straight
floor. `deny size|width|1.5` on all 32 wall slots excludes 885 — a person knowing the 1.5-wide walls
are corner halves and belong to a different recipe. `deny shape|option|notch` on all 40 base slots
excludes 368, every one of them a base. None of the three is inferable from `role`, `form`, `build`,
`shape` or `connection`; each is a fact about how the pieces physically go together.

Also worth recording: **44 of the 181 deny refs (24.3%) exclude nothing**, which is the signature of
hand-authoring — a person writing defensively, not a rule.

**So the answer to the row's central question is: it is authorship.** The derivable half of a slot's
constraint is the half `pipeline/families.ts` already derives. The half that decides whether an
assembly is a real piece of terrain is the `require` joinery refs and the `deny` block, and both are
knowledge that exists only in the fixtures.

## 7. The generator, built and run: 8 of 48 fill, 7 of 48 lay out

Not argued — built. Slots generated from B1's axes alone, with the base deny D1 asks for, the size
constrain `families.ts` emits, the sibling rule §6 derived, and the build-absent case denying all
five `build|` tags by name as `families.ts` does. Run through the real `solveTemplateFills` and the
real `placeTemplateSlots`.

**V2 — `(wall, floor, base)` over all 7 forms × 6 build systems, 42 assemblies:**

| | |
| --- | --- |
| `solveTemplateFills` complete | **7 / 42 (16.7%)** |
| empty slots at cold | **52 / 126 (41.3%)** |
| layout verdict | 7 `closes`, 0 `fails`, 35 `undecidable` |
| first-candidate walk | 7 / 42 |
| greying walk | 7 / 42 |

The greying rule buys **nothing** here, and that is the diagnostic: C2's 16 failures were a *policy*
failure (48 candidates before the siblings, 0 after), so the greying rule fixed them. These 35 are
`no-candidate` at `cold = 0`. There is nothing in the archive to fill them with at any policy.

Only 7 of the 42 have a fillable floor slot: `wall on tile` at 4 forms, `s2w` at 2 and *(absent)* at
1. Every `separate wall`, `thick wall` and `s-system` row is broken in the floor slot.

**V3 — `(column, right wall, left wall, floor, base)` over 6 build systems:** 1 of 6 complete,
**0 `closes`**, 1 `fails`. The one that fills is `s2w`, and it fails the layout with
`right wall: over-run want=2 got=2.5` and the same on the left — two full-length 2-unit walls and a
0.5 column cannot share two 2-unit edges. **The derived corner does not close even where the pool
exists.**

**V4 — the same, with the fixture's authored `size|width|1.5` added:** **0 of 6 complete**, 16 of 30
slots empty. Because `role|wall + form|corner + size|width|1.5` is 6 records where the fixture's
`shape|wall + size|width|1.5` is 490 (§5). Adding the one authored number that makes the fixture
close makes the derived version strictly worse, which is as clean a demonstration as this row found
that the authored refs are not a decoration on a derivable core.

### The completions are wrong too

The seven that fill are not seven usable assemblies. Reading the solver's actual picks:

- `wall on tile` / straight: the `wall` slot fills with a `wall on tile` `rect 1x1` and the `floor`
  slot with another `wall on tile` `rect 1x1`. The layout `closes` at 1x1. **It is two whole tiles
  stacked on one base** — a picture of something nobody can print.
- `thick wall` / corner: both wall slots fill with `thick wall` `rect 1x1` pieces, which are
  bases-with-integral-walls.
- `separate wall` / corner: the `base` slot fills with
  `{shape: 'arc', rIn: 2, rOut: 2.5, sweep: 45}` — a 45° arc under a square corner.

`placeTemplateSlots` catches the geometric half of this (`over-run`, `no-run`) and cannot catch the
semantic half, because a 1x1 tile under a 1x1 tile closes perfectly. That is the plan's own
"plausible room nobody chose" failure mode, and a generator manufactures it at scale.

## 8. The layout conventions would cover the three good shapes and nothing else

Verified through `conventionFor`, which keys on the sorted part-name set:

| part-name set | convention |
| --- | --- |
| `base, floor, wall` | `wall-on-tile` |
| `base, column, floor, left wall, right wall` | `external-corner` |
| `base, column, floor` | `internal-corner` |
| `base, wall` | **none — needs a fourth** |
| `floor, wall` | **none** |
| `base, floor` | **none** |
| `wall` | **none** |
| `base, column, left wall, right wall` | **none** |
| `base, floor, left wall, right wall` | **none** |
| `base, column, floor, wall` | **none** |

So B2's constraint is satisfied for free by any proposal that reuses the six existing part names in
one of the three existing sets — and it bites exactly where the archive pushes. **The honest shape
for `thick wall` and `s-system` is `(wall, base)` with no floor**, and that is the set with no
convention. A fourth convention would have to hold A10's rigid-body invariant; over the shipped 40
the closure gives 34 `closes`, 2 `fails` and 4 `undecidable` at cell 2x2, area **4.00 units²**, and
a `(wall, base)` convention has no `edge` slot with a cell to close against, so `verdictOf` would
make every instance of it `undecidable` — the same non-answer `families.ts` records for the 51
one-slot families. A fourth convention would be authored, unverifiable, and would earn nothing the
one-slot family does not already earn.

## 9. Nothing is being withheld invisibly, which removes the urgency

B4's finding was that a *missing family* withholds records invisibly — no slot to be empty. The same
question for a missing assembly has a measurable answer, and it is reassuring. Resolving each build
system's own one-slot families through `src/composition`:

| build | its own families | its records | reached by them | designs |
| --- | ---: | ---: | ---: | ---: |
| `separate wall` | 10 | 3,351 | **3,351 (100.0%)** | 826 / 826 |
| `wall on tile` | 10 | 863 | **863 (100.0%)** | 823 / 823 |
| `s2w` | 8 | 633 | **633 (100.0%)** | 332 / 332 |
| `thick wall` | 4 | 591 | **591 (100.0%)** | 162 / 162 |
| `s-system` | 2 | 286 | **286 (100.0%)** | 168 / 168 |
| *(absent)* | 17 | 2,978 | 2,693 (90.4%) | 1,417 / 1,511 |

**Every record of every build system the brief names is already reachable, at 100%, through a
one-slot family.** For `thick wall` and `s-system` the one-slot family is not a fallback — it is the
*correct* unit, because the record is the whole piece (§2, §3). For `wall on tile` the record is
already floor-plus-wall in one print, and its remaining need is a base, which 295 of 863 declare as
their own slot and which `resolvePlacement` auto-inserts on 1,878 of 3,822 items. For
`separate wall` the assembly already exists — it is the wall slot of the 32 wall recipes, reaching
68.2% of it.

So a missing assembly withholds *convenience*, not records. That is a materially weaker claim than
the one that justified generating 51 families, and it is why the recommendation below is small.

## 10. The alternative: hand-author a few, and the first one is worth more than the generator

Four candidates, hand-authored, each one the shipped `S2W: Wall on Tile: Wall` recipe with the
`build|s2w` ref lifted off the **floor** slot and the floor re-predicated. All four use the existing
`(wall, floor, base)` part-name set, so all four get `wall-on-tile` for free.

| candidate | cold pools (files/items) | `solveTemplateFills` | layout | cell | doubts |
| --- | --- | --- | --- | --- | --- |
| H1 `separate wall` on any tagged floor | 1,330/387 · 1,496/1,122 · 305/56 | **complete** | **closes** | 2x2 (4.00) | none |
| H2 `separate wall` on a `wall on tile` floor | 1,330/387 · 354/314 · 305/56 | **complete** | **closes** | 2x2 (4.00) | none |
| H3 `separate wall` on a plain square floor | 1,330/387 · 690/465 · 305/56 | **complete** | **closes** | 2x2 (4.00) | none |
| H4 as H3, with a square base | 1,330/387 · 690/465 · 281/30 | **complete** | **closes** | 2x1 (2.00) | none |

**4 of 4 complete, 4 of 4 `closes`, 0 doubts.** The first-candidate walk completes only 2 of the 4
and the greying walk completes 4 of 4 — the same policy dependence C2 measured on the shipped 40, so
these are honest members of the same population rather than easy cases.

H1 alone moves the assembly reach:

| | records | designs |
| --- | ---: | ---: |
| the 40 fixtures | 3,079 (35.4%) | 905 (23.7%) |
| the 40 + H1 | **4,441 (51.0%)** | **1,893 (49.5%)** |
| H1's own gain | +1,362 | +988 |

by build: *(absent)* 965, `wall on tile` 354, `s2w` 43. **One hand-authored assembly, one edited
ref, and the assemblies section reaches half the archive's designs instead of a quarter** — against
a generator that produced 48 rows of which 8 filled, 7 laid out, and at least 3 of the 7 are
physically impossible.

### What it costs

- **Tag table: 0 strings.** All 23 refs the proposals need are already among the 930
  (`role|`, `form|`, `build|`, `shape|base*`, `shape|wall`, `shape|floor`, `shape|square`,
  `shape|curved`, `shape|option|notch`, `size|width|1.5`, `size|column_shape|L`, `connection|side`,
  `connection|openforge`). Checked: 23 of 23 present, 0 absent. `unknownRefs` is empty on every slot
  of every candidate run in this row.
- **Index: 0 B, structurally.** Nothing on `pipeline/build.ts`'s path need import an assembly table,
  which is the same argument `pipeline/templates.ts` makes for the 40 and `pipeline/families.ts` for
  the 51. Priced anyway, as an `assemblies` key on the shipped artefact (5,907,360 B raw,
  **366,748 B** brotli-11): +4 entries → **+227 B**, +8 → **+3 B**, +12 → **+115 B**, +40 →
  **+176 B**. The figures are **not monotone in the number of entries**, which reproduces B1's own
  lesson — brotli is not additive over 5.9 MB and a "this field costs N bytes" figure is a fact
  about one artefact at one epoch, never a rate. Treat the ceiling as ~250 B and do not quote a
  per-entry cost.
- **Authoring: one YAML entry each, of the shape already in the repository.** A shipped fixture entry
  serialises to 946 B of JSON.
- **The guard is B4's, unchanged.** Resolve every authored slot through `src/composition`'s postings
  and compare the admitted set to what the author meant; run the set through `measureGreedy`,
  `measureGreying`, `measureSolver` and `placeTemplateSlots`, and require `complete` and a
  non-`fails` verdict. That is what §10's table is, and it is the whole test.

## 11. The palette consequence

The owner has approved a palette with assemblies in their own section. The two options put very
different things in it:

- **Generated**: 48 rows for the naive `(shape × form × build)` cross-product, of which **8 fill and
  7 lay out**. Forty broken rows in a section of forty-eight — and B4's contract **C-i** says an
  empty candidate set is indistinguishable from an archive gap, so the user cannot tell "the archive
  has no thick-wall floor" from "the catalogue is broken". Worse, the 7 that do lay out include
  assemblies that stack two whole tiles, and those arrive looking correct.
- **Hand-authored**: 40 + 4 to 12 rows, **every one fillable and every one laying out**, and the
  assemblies section reaches half the archive's designs instead of a quarter.

The one-slot families keep their own section and keep reaching 100% of every named build system's
records (§9), so nothing needs a broken row to be visible.

## 12. Recommendation

1. **Do not build a generator.** The measurement is §6, §7 and §5: the derivable half of a slot's
   constraint is already derived by `pipeline/families.ts`; the half that makes an assembly a real
   piece of terrain is 408 `require` refs whose joinery vocabulary is s2w-exclusive and 181 `deny`
   refs that are negative facts about the archive. A generator built on B1's axes completes 8 of 48
   and lays out 7, and some of the 7 are impossible.
2. **Hand-author between 4 and 12 assemblies as YAML fixtures beside the existing 20**, all reusing
   the `(wall, floor, base)` and `(column, right wall, left wall, floor, base)` part-name sets so
   B2's conventions apply unchanged. Start with H1 — one ref lifted off one slot of a shipped
   recipe, +1,362 records and +988 designs. Validate with §10's guard. This is a small row, not an
   epic.
3. **Do not author an assembly for `thick wall` or `s-system`.** They have no floor and (for
   `s-system`) no column and no base; their honest shape is `(wall, base)`, which has no layout
   convention, would need an authored fourth, and would be `undecidable` under it — earning nothing
   over the one-slot family that already reaches 100% of both.
4. **Record `wall on tile` as needing no assembly.** The record is already floor-plus-wall in one
   print; its base comes from its own declared slot on 295 of 863 and from `resolvePlacement`
   otherwise.
5. **Fix the brief's own framing wherever it is quoted.** "Build system X has no assembly" should
   read "no assembly is *tagged* `build|X`". `separate wall` has one, and it is 68.2% covered by it.

## Appendix — commands

Throwaway scripts under
`/tmp/claude-1000/-home-finn-Repos-openforge-catalog/8b7e3f5c-f20f-4971-ba81-67c0cbc85a50/scratchpad/`,
each run as:

```
export MISE_TRUSTED_CONFIG_PATHS=$PWD TSX_TSCONFIG_PATH=tsconfig.app.json
npx tsx <script>.ts
```

| script | what it measured |
| --- | --- |
| `census.ts` | the build census, the tag roots, the `shape\|`/`role\|`/`form\|` vocabularies |
| `reach.ts` | per-part cold pools of all 128 parts and the build breakdown of the 3,079 |
| `pools.ts`, `grid.ts` | the four slot pools per build system, the joinery-tag cross-tabs |
| `slots.ts` | records' own declared slots per build system, and sample records |
| `anat.ts`, `tot.ts` | the 37/9/6 constraint anatomy over the 128 parts |
| `ablate.ts` | marginal contribution of every deny ref and of each block |
| `constrain.ts`, `sibrule.ts` | the constrain narrowing under real fills, and the sibling rule |
| `shapecheck.ts`, `formmix.ts` | footprint mixes and the axis distribution of the fixtures' pools |
| `gen.ts`, `full.ts`, `closure.ts` | V1–V4 generated assemblies through solver and layout |
| `hand.ts`, `gain.ts` | the four hand-authored candidates and H1's coverage gain |
| `final.ts`, `baseline.ts`, `conv.ts` | the D1 guard, family coverage, ref/table check, byte price, convention coverage |
