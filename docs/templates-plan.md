# Templates — the `epic/v2` plan

The builder stops placing tiles and starts placing **templates**: a recipe with named slots, each
slot filled from the catalog, the whole thing placed and rotated as one unit. Templates are the
**only** placement unit. The library is deleted. The data layer underneath is rewritten rather than
adapted.

Nothing is deployed, so **no row owes a data migration or backwards compatibility**. Discarding
persisted state is explicitly permitted and is assumed throughout.

This document is the deliverable: §7 is the PR table, and it is what the series is run from.

**§10 is the correction record.** Twelve rows have now measured against this plan and a good deal of
it did not survive: **22 figures moved**. Every one is corrected in place below *and* listed in §10
against the row that measured it, because a figure whose only source is this document's own prose is
a figure nobody has checked — three of the 22 were found by nothing more than re-running this
document's own sentences against the corpus. §11 is what is still open and owned by nobody.

---

## 1. What the research found, and what it changed

Five research passes ran against the live corpus (`public/catalog/catalog.json`, 8,702 records,
3,822 aggregates, 915 tags) before this plan was fixed. Each finding is a number, not a preference;
where a pass refuted the brief it was given, the refutation is what shaped the plan.

Two caveats now attach to every figure below. **The research reports are gone** — the scratchpad
they lived in was wiped — so a number here that no row has since re-measured has nothing behind it
but this document; §10 says which ones were re-measured and by whom. And **the corpus moved**: row
B1 interns two derived axes, so the index is now **930 tags over 101,427 references** where the scan
alone is 915 over 84,023. A pre-B1 baseline is not comparable with a post-B1 one, which is exactly
how §2.3's byte table went wrong.

### 1.1 The templates already exist — as one family, not forty

The 20 `blueprints.s2w.*.yaml` fixtures upstream carry **40 blueprints over 128 parts**, already
read by `pipeline/templates.ts`, already validated part-by-part against this app's own `PartSlot`
schema, already rendered at `/assemblies`. `blueprints.s2w.corner.yaml` declares the slots
`column`, `right wall`, `left wall`, `floor`, `base` — the requested "floor plus two walls plus a
column in the corner", verbatim.

But all 40 are `S2W: Wall on Tile` — 32 wall variants and 8 corners, three or five parts each, and
**zero optional parts**. They reach **3,079 of 8,702 files (35.4%)** and **905 of 3,822 designs
(23.7%)**. That is not a cold floor: re-resolving all 128 parts under all **11,938** one-pick
sibling states grew the reachable union by **0 files**.

### 1.2 The choke point is one tag on 88 records

32 of the 128 parts require `shape|floor|wall`. **88 records in 8,702 carry it.** The corpus holds
2,162 floor records over 1,204 designs, so every wall recipe picks its floor from an 88-file pool.
The direct consequence: **the 40 cannot place a bare floor at all.**

### 1.3 The tags are not a reliable predicate — so slots predicate on a derived role

Hand-specifying template families and predicating their slots on raw tags was the plan's first
answer. It was wrong, and the reason is that the tags disagree with the corpus:

- `shape|wall` is carried by **4,354** records and **238 of them are not walls** — 176 floors, 54
  columns, 8 stairs. On a floor or a base it means "belongs to a wall run", not "is a wall". (This
  plan said 4,881, which is the count under the *prefix* reading `shape|wall*`; the exact tag is on
  4,354. Row B6 re-measured both — see §10.)
- **527 of 527** `shape|wall|low` records omit the parent `shape|wall`.
- **459 records carry no `shape|` tag at all**, and **100 roof records are named by no `shape|` root
  in the taxonomy.**
- `component|` names a *feature*, not a role: **357 of 3,833 disagree** (`#wall,drain`,
  `#wall,slope`).
- `size|width` carries two non-numeric values — `wot` (50 records) and `sw` (33) — which are
  **build markers**, not widths: all 50 `wot` sit under `wall_on_tile`, and all 83 have `build`
  absent.
- Two of the four internal-corner templates are themselves mis-tagged `shape|corner`. The fixtures
  are pinned and read-only, so §9.1 records how that is handled rather than fixed.

**A role can be inferred for every record, and it validates.** Two axes are needed, not one:

| `role` | records | designs |
| --- | ---: | ---: |
| wall | 5,381 | 1,831 |
| floor | 2,162 | 1,204 |
| riser | 319 | 219 |
| insert | 285 | 94 |
| column | 223 | 190 |
| stair | 206 | 169 |
| roof | 100 | 100 |
| decor | 26 | 15 |

`form` is the second axis, and half the roles a one-axis taxonomy would have invented belong to it:
straight 5,707 · curve 1,989 · corner 720 · diagonal 163 · hex 56 · internal_corner 39 · octagon 28.
`layer` (base / topper / integral / insert) is the third and already ships.

**`base` is a `layer` value and not a role**, and that matters more than it looks — see §2.5. All
eight role and all seven form counts above re-measured exactly against the emitted index, as did
every record having exactly one of each.

**8,702 of 8,702 records classify, 0 unknown** — 7,413 high confidence (85.2%), 1,246 medium, 43
low. The classifier is a tag ladder that labels 7,756 records directly; a learner trained on that
subset reproduces the label from path, component and filename alone on **7,397 of 7,471 non-insert
records (99.01%)** under 5-fold holdout. Two findings got it there: path **depth** is the signal
(depth 2 is the build system, and reading `separate_wall` as a role cost **368** errors — this plan
said 271, and B1 measured the higher figure, so the finding holds at five times the error rate), and
depths 4-7 are joinery, so stoplisting `openlock` and its siblings moved 96.89% to 99.01%.

Validated against two independent ground truths: **8,505 of 8,564 role-bearing candidate slots of
the 40 shipped templates agree (99.31%)**, with 124 of 128 parts role-pure; and against the
already-trusted `layer` field, column 112/112, floor 2,996/2,996, base 5,677/5,677. All 59
disagreements are **over-admissions the inference catches** — 41 are `column+low` files carrying a
spurious `shape|wall` that today's wall slots admit.

The residual is named rather than rounded away: 43 low-confidence records (40 bare thick-wall bases,
2 yawning-portal bases that look outright mis-tagged, 1 facade wall), 30 combined s2w
`grate+widened` cells that are genuinely wall **and** floor, and the 100 roof records.

### 1.4 A slot has no fixed footprint, so slot layout cannot be stored as numbers

Across the 128 parts the `base` slot admits **25 distinct footprints**, `wall` **14** (including
`column`, four diagonal runs, a triangle, and `{shape:'none'}`), `floor` 8. Only **28 of 128** parts
have candidates that all share one footprint.

A `SlotLayout` carrying `(dx, dz, dy, yaw)` is therefore **not implementable** — any stored offset
is wrong for most fills of the same slot. The model has to be a *rule* evaluated against the fill's
own footprint at fill time. §2.2 gives it.

Nothing in the tags names an edge, either. Only `connection|left` / `right` / `bottom` could, and
that is **8 tiles — 0.09%**. `connection|side` (2,080 tiles) names a connector *system*;
`shape|corner|left` / `right` (133 / 133) is chirality, not position.

Row B2 pushed that further and swept every tag string for a face word as a whole segment: **41 tags
on 576 tiles (6.62%)** outside the `connection|` root, and read by hand every one is chirality, a
component name (`component|edge_gutter`) or a part interface (`interface|stairs|top`). **Not one
names an edge of a cell.** The sweep was given as 115 tags; 67 of the extra 74 were `interface|*`
tags matched by the letters inside "inter**face**", which is what a substring sweep does and a
whole-segment one does not.

### 1.5 Default fills are a measured rule, not a preference

Over the 40 recipes, walking parts in declared order with no backtracking:

| rule | recipes completed |
| --- | ---: |
| take the first candidate | **24 of 40** |
| take the first candidate that does not empty a still-open sibling | **40 of 40** |

All 40 are solvable exhaustively, so those 16 failures belong to the naive rule alone. The
greying-aware walk emptied a part in **0 of 148** observations, so a one-click drop is monotone
rather than lucky. Without defaults the two `(Any, ...)` recipes would demand a choice among **308**
and **428** items before a single tile appeared.

Row A3 reproduced the 24 and the 40 independently and located the failures: **all sixteen are the
`base` slot of the modular wall templates**, which has 48 candidates in isolation and **0** once the
siblings are picked. Every one of the 128 parts has candidates in isolation, so there are **zero
dead ends** — the greedy rule fails on ordering, not on coverage, and that is the finding row C2
needs most.

### 1.6 "Filterable by design" means texture family — and both meanings are needed

The examples given (dungeon stone, cut stone, tudor, sewer, cave) are all `texture|` roots verbatim.
Measured: **37 level-1 roots, 36 reachable** as `record.texture`, mapped to **16 tint families**.
dungeon_stone holds 1,566 items; the top five roots hold **75.6%** of records; 12 families hold 1-2
items; 89 records carry no texture tag.

The filter is what makes the candidate grid tractable: **394 (part, family) buckets, median 8 items,
p90 36, max 160** — 55.8% fit the existing 8-card accessory grid and **98.7% fit one 48-card page**,
against 428 unfiltered.

So the **filter** is the texture family; what is **stored** in a slot fill is a file (§2.1). Both are
named and neither is folded into the other.

### 1.7 The rewrite deletes both guessing rules — but not about half the resolver

`src/assembly/resolve.ts` is 956 lines, and roughly **700** exist to *guess* what the user meant —
rule 0 (pick a variant from an aggregate) and rule 1 (auto-insert a base under every topper, ranked
on a five-criterion weighted ladder). A template declares its base as an explicit slot; the s2w
recipes already carry a `base` part and sibling parts already carry `fulfills: ['base']`. Both rules
die.

**The headline line count was impossible, and row A3 proved it rather than approximating it.** This
plan predicted ≈1,130 of 2,251 non-test lines removed directory-wide. Measured, non-test lines went
**up by 251**, and the reason is in the same brief that asked for the deletion: the ranking had to
*survive* as the default-fill function, and slot validation, a download-completeness gate and
per-slot provenance all had to be added. `resolve.ts`'s own code did fall **28%**. Both of the
outright deletions this plan named were wrong, and a deletion it did not name happened instead:

- **`src/assembly/footprint.ts` survives.** `footprintKey` has two live consumers outside
  `src/assembly`, both importing the module path directly: `pipeline/catalog.test.ts` runs it over
  all 8,702 emitted footprints, and `tools/hygiene/project.test.ts` uses it to prove
  `tsconfig.node.json` still reaches into `src/`. Deleting that import is a green typecheck that has
  silently lost a capability. `footprintsMatch` does go — zero consumers outside its own file, the
  barrel and its own test.
- **`src/assembly/sizeCode.ts` shrinks rather than dies.** `sizeCodeWidth` and
  `SIZE_CODE_WIDTH_UNITS` have no code consumers, but `sharedPrimitive` and `AMBIGUOUS_SIZE_CODES`
  serve the ranking that survives as the default-fill ranking.
- **`src/builder/three/bases.ts` is deleted** — 258 lines plus 562 lines of base-inference tests —
  which this plan did not predict at all. Two rows reached it independently once elevation arrives
  per part.

Dropping `AssemblyIndex.aggregates` is safe, confirming the plan, and takes `buildAggregateIndex`'s
measured **62 ms** out of the index build against the assembly index's own 12 ms. All ten source
files of `src/download/**` (2,839 lines) need **zero** edits — only its test needed a new fixture.

And **nothing in `src` imports `@/share`** — re-measured, still zero outside `src/share` itself — so
the codec was dead code when it was reshaped and it blocked nothing.

---

## 2. The model

### 2.1 A fill stores a file, tagged `auto` or `pinned`

Decision **D1**: a slot fill names an exact file.

```ts
type SlotName = string & { readonly brand: unique symbol }

interface SlotFill {
  readonly tile: TileId
  /**
   * `false` when the default solver chose it, `true` when the user did.
   * A lock change re-solves every `auto` fill and never touches a `pinned` one.
   */
  readonly pinned: boolean
}

interface TemplateInstance {
  readonly id: PlacementId
  readonly template: TemplateId
  readonly x: number
  readonly z: number
  readonly rotation: Rotation
  /** Slot name to its fill. An absent slot is unfilled and reads as *needs a choice*. */
  readonly fills: Readonly<Partial<Record<SlotName, SlotFill>>>
}
```

**Why the `pinned` bit is not optional.** A file-valued fill freezes the lock choice at fill time,
and the three lock systems disagree about which file to print for **1,419 of 3,822 items (37.1%)**.
Without the bit, switching lock style would leave a placed room unchanged — contradicting the
requirement v3 shipped, that the base a user sees follows their lock selection. With it, the lock
stays live for every slot the user has not deliberately overridden, and an explicit pick is honoured
exactly. One boolean per fill buys both.

Persisting the resolved file rather than deriving it at render time is the deterministic choice: a
re-import cannot silently change what a saved room contains, which is the whole concern of
`architecture-plan.md` §13.

**The mesh warm path is lock-free, and this plan said otherwise.** Row A2 measured it:
`planSceneMeshes` never consults the lock, because a fill names an exact file and there is nothing
left to resolve. A lock change reaches the warm path through `placements`, when the re-solve rewrites
the `auto` fills — the `lock` half of the subscription in §7's A2 row is a hedge against that two
step, not the mechanism. Two consequences A2 also measured, both kept: the conversion budget moves
from **per-fill to per-scene** (a 40-instance room's background candidates are **433.24 MB** against
**29.21 MB** for one 32 MB scene budget, 14.8x less, and a single instance still gets its whole set
in 36 of 40 templates), and the warm path diffs on the **file** set rather than the blob set,
because a blob set is not derivable without resolving the 5.6 MB index to answer a drag.

**Three gaps around the `pinned` bit belong to nobody.** They are named in §11 rather than here,
because they are open questions and not part of the model.

**The share wire gets more precise, not less.** `ShareManifest` already carries `tileOf(ordinal)`;
the `TileId` to ordinal direction is a **four-line addition** — one `Map` and one accessor — because
`ShareManifestSource` records already carry `{ id, ord, design }`. So `share/manifest.ts` stays a
*keep*.

This restores the pre-V4 addressing, and that is an improvement. V4 moved `ordinalOf` from a file to
a design on the argument that a `DesignId` is "13 characters flat against a `TileId`'s 39-183" — a
premise later refuted, because the codec writes an *ordinal* and never a string. Addressing the file
removes the design-address ambiguity: a design's address is the lowest ordinal among its files,
which is **unstable under retirement**, while a file's own ordinal is append-only for ever.

### 2.2 Slot layout is a rule with no numbers in it

```ts
type SlotAnchor = 'cell' | 'edge' | 'corner'

interface SlotRule {
  readonly part: SlotName
  readonly anchor: SlotAnchor
  readonly side: 0 | 1 | 2 | 3
  /** The part this one rests on, or null for the ground. */
  readonly restsOn: SlotName | null
}
```

Offsets are arithmetic at fill time against the fill's *own* footprint: `edge` gives
`(0, -(D - t) / 2)`, `corner` gives `(-(W - 0.5) / 2, -(D - 0.5) / 2)`. Measured, that rule closes
on **1,006 of 1,215 resolved combinations (82.8%)**, fails on **33 (2.7%)** and is undecidable on
**176 (14.5%)**.

**80 of 128 parts derive with no authoring** — every `base` and every `floor` part, anchored to the
cell at yaw 0, and their elevations are already implemented and measured (the base's own mesh height;
**279 of 343** measured bases sit within 0.015 mm of the 6 mm step — **81.3%**, where this plan said
291 of 343 and B2 measured the lower figure). The other 48 — 32 `wall`, 8 `column`, 8 left/right-wall
— need **three authored conventions**, one per part-name set, not 48 decisions. Keying on the
part-name set is right on **40 of 40**; keying on tags is wrong on 2 of 40 because of the
internal-corner fixture defect, which §9.1 records.

**Where the table lives, and what it costs.** It ships in the bundle beside `templates.ts`, so the
index gains **0 B** — asserted by rebuilding the corpus and comparing bytes, not quoted. The
counterfactual is the one figure this plan got wrong three ways at once: a `layouts` key carrying the
128-row expansion is **+222 B** against the shipped artefact at the payload epoch, **+808 B** against
a fresh build with an empty ordinal manifest, and the **+374 B** written here reproduces only against
the *pre-B1* `catalog.json`. Brotli is not additive over 5.9 MB, so "this field costs N bytes" is a
fact about one artefact at one epoch and never a rate. Every byte figure in this document should be
read with the construction beside it.

**Two arithmetic hazards, both measured.** Slot offsets land on multiples of **0.25**, off the
builder's 0.5 snap lattice — so the template *origin* snaps and slot offsets never do. And 18.4% of
measured `openforge` toppers are authored pre-lifted by exactly 6.0 mm while 77.5% are not, so
elevation stays normalised and is never trusted from the file.

### 2.3 Role and form are emitted as interned tags

The role and form axes are emitted as ordinary tags — `role|wall`, `form|corner` — into the existing
intern table. The encodings were priced against the **512,000 B** budget with `emit.ts`'s brotli-11,
against the pre-B1 baseline of 365,598 B:

| encoding | index delta against the pre-B1 baseline |
| --- | ---: |
| **`role|x` + `form|x` as interned tags** | +865 B |
| role only, as a tag | +773 B |
| integer codes | +868 B |
| dense code strings | +858 B |
| separate string fields | +2,416 B |
| per-role posting lists | +15,342 B — rejected |
| derived in the browser | +0 B index, 1,561 B of JS, 31.7 ms |

**Read that table as a ranking and not as a price.** Row B1 shipped the winning row and measured
**+1,165 B** against the artefact it actually replaced — and two other honest numbers for the same
change: **+468 B** with the field isolated and **+776 B** appended at the tail. The field has no
single honest price; the `PIPELINE_VERSION` digit alone moves the artefact **76 B**. The relative
ordering, which is what the decision rested on, is unaffected.

The tag encoding wins for a reason that is not the byte count: the axes take the **two most frequent
tag ids in the corpus** and therefore one-digit references, and `require: [{ tag: 'role|wall' }]`
needs **zero new code** in `src/composition/candidates.ts` — B1 confirmed the directory needed no
code change at all, because `require` is exact equality against the intern table. It is also
build-time checkable, which the browser-derived alternative is not.

This plan said `role|wall` takes tag id 0 as the corpus's most frequent tag. Measured on the emitted
index, **`form|straight` does**, at 5,707 references against `role|wall`'s 5,381; `role|wall` takes
id 1. Both are one-digit, so the encoding argument survives its own premise being wrong.

`role === 'insert'` is a perfect bijection with `layer === 'insert'` and adds nothing; it is emitted
for totality, and no slot should predicate on it.

### 2.4 Size is a slot parameter, not part of the family key

This is what makes the family count small. Keyed on `(role, size, build)` the corpus needs **285
families** — 111 to reach 90%, with 50 singletons. With size as a *parameter* of the slot predicate,
`(role, form, build)` needs **52**.

Size resolves through a chain — `foot` dimensions, then the tagged `size|width` / `size|depth` pair,
then `sizeCode` — for **8,384 of 8,702 records (96.3%)**. `foot` is derived *from* the tags (exact on
3,449 of 3,449 rect records), so it is **not** independent corroboration; its value is **56
corrections** (all `curved_interface`, wrong by exactly 1.000 u) and 726 honest refusals.

The 318 that do not resolve are enumerated, not rounded: 234 inserts (correct — an insert has no
grid size), 26 decor, **56 hex and 120-degree pieces carrying only `size|angle`**, and 2 `wot` walls.
Only **8 floors** have neither a tagged pair nor a footprint.

### 2.5 The families are generated, and there are 52 of them

Decision **D2**: templates are the only placement unit, and they are **generated from the
`(role, form, build)` key with size parametric** — not one per tile, and not hand-specified.

Coverage curve, measured:

| families | records | designs |
| ---: | ---: | ---: |
| 10 | 74.4% | 58.1% |
| **20** | **90.4%** | **86.0%** |
| 30 | 96.4% | 93.9% |
| 52 | 100% | **100%** |

Only 3 of the 52 hold three records or fewer. Coarser keys were measured too: `(role, build)` gives
20 families at 100%, `(role, form)` gives 26. Row B6 re-measured this whole subsection against the
emitted index: 52 keys, 20 and 26 for the coarser keys, 3 families of three records or fewer, and
seven of the eight coverage cells to the tenth of a point. The eighth moved — **the 52 families reach
100% of designs, not 99.9%** — because every record carries exactly one role and one form, so the
families partition the corpus and no design can be left out of it.

**Reach: 8,618 of 8,702 records (99.0%) and 3,797 of 3,822 designs (99.3%)**, against 3,079 (35.4%)
today. The 84 unreachable records over 25 designs are fully enumerated, and **56 of them are the hex
lattice** — a builder limitation, not a template gap. (Reach is not classification: all 8,702 records
carry exactly one role and one form, so the 52 families *partition* the corpus. The 84 are records a
family names and the builder's square lattice cannot place.)

#### The base family cannot come from this key — and needs no new axis

Row A9 proved the hole. **`base` is not one of `pipeline/role.ts`'s eight roles** — wall, floor,
riser, insert, column, stair, roof, decor — it is a value of `layer`, a different axis. The key
`(role, form, build)` does not carry `layer`, so **no family generated from it can be the base
family.** A9 ran B1's classifier over the 686 archive-resolvable base records: they spread across
eight `(role, form, build)` keys, every one `layer: 'base'` and not one of them a base — 271
`role|floor form|straight`, 161 `role|floor form|curve`, 128 `role|riser form|straight`, and so on.

The fix costs nothing, because an existing tag already says it. Measured over all 8,702 records, and
re-measured by row B6:

| | records |
| --- | ---: |
| `layer === 'base'` | 1,963 |
| `shape\|base` | 1,963 |
| both | 1,963 |
| `layer === 'base'` without `shape\|base` | **0** |
| `shape\|base` without `layer === 'base'` | **0** |

**Exactly coextensive, zero exceptions in either direction.** So a base slot predicates on
`require: [{ tag: 'shape|base' }]` — an existing tag, needing no fourth axis and nothing B1 did not
already emit. It is also *more* informative than a `layer|base` tag would have been, because a base
keeps the role of the thing it sits under: `role|wall` **1,117**, `role|floor` **661**, `role|riser`
**176**, `role|stair` **9**. So `(role, form)` plus `shape|base` distinguishes a base for a wall run
from one for a floor.

**Row B4 owes a one-slot bare-base family on that predicate**, over and above the 52. Until it lands,
`BuilderScreen`'s archived branch is a deliberate compile error rather than a base mislabelled as a
floor in the palette.

#### The `accept`-prefix workaround is not needed, and would be worse than nothing

This plan proposed switching `shape|wall` from `require` to a prefix form `accept`, to pick up the
527 `shape|wall|low` records that omit their parent. Under the role predicate it is not merely
unnecessary — it is a regression. Measured twice, by row B1 and again by row B6:

- **All 527 are in the `role|wall` pool already** (527 of 527), so the prefix reading admits nothing
  new that is wanted.
- The prefix reading admits **exactly the same 238 non-walls** — 176 floors, 54 columns, 8 stairs —
  that make `shape|wall` unreliable in the first place. Not a comparable set: the identical set,
  compared by record id. `shape|wall` alone reaches 4,354 records, the prefix reaches 4,881, and the
  238 are in both.

So the workaround buys 0 records and keeps 238 wrong ones. **The row that owed it is deleted from §7
rather than marked done**, which is the honest bookkeeping: there is no work to do.

This whole subsection supersedes the eight hand-specified families the plan first proposed (bare
floor, wall-on-tile, thick wall, s-system, wall-on-any-floor, curves, stairs, risers). They are
subsumed: role-predicated generation reaches 99.0% where they reached 93.8%.

---

## 3. The interaction

### 3.1 The palette lists 52 families, not 3,862 items

This is the largest single UX consequence of §2.5, and it inverts the cost the UX research
identified. Predicated on raw tags the palette would have grown from roughly 20 recognisable library
rows to **3,862** entries, turning recognition into recall. Generated from `(role, form, build)` with
size parametric it is **52 rows** — grouped by role, with form and build as facets and size as a
control on the placed instance. Recognition survives.

### 3.2 Placement is one click

Drop a template and it arrives filled, by the §1.5 rule: walk the parts in declared order and take
the first candidate that does not empty a still-open sibling, preferring (a) the room's design
family, (b) `selectVariant`'s preferred variant, (c) ascending item address. No candidate leaves the
slot empty, marked *needs a choice*, and **places anyway**.

Empty candidate sets get three different answers because they are three different situations:
**0 of 128** template parts are ever empty (minimum 5 candidates) so that path needs no UI; **9 of
1,244** accessory slots are empty and read as "an archive gap, not a step to take"; and **517 of
526** empty slots corpus-wide are the `base` slot, which is never shown, because the builder's base
comes from footprint congruence rather than from the texture-inheriting slot.

The precedent already ships: `resolvePlacement` auto-inserts a base on 1,878 of 3,822 items under
openlock, all `plain`, without asking, and discloses it through `notes.ts#base-option-chosen`.

### 3.3 The right-click slot editor

A popover on the placed instance: its slots listed, the selected slot's candidates as a sprite grid,
a texture-family filter at the top, dead ends greyed before they are picked (which `SlotFills`
already does). Choosing a fill marks it `pinned` and re-runs the greying walk over still-open
siblings; a pick that invalidates a sibling's existing fill is refused with the reason rather than
silently repaired.

Right-drag must keep orbiting the camera — the 5 px discriminator in `surface.ts` is what separates
the two gestures, and losing it costs a camera control.

### 3.4 What gets worse

Named honestly, because a plan that omits this is not a plan:

1. **`/library` is the only mount of `exportWorkshop` / `importWorkshop` — the app's sole backup
   path**, and `architecture-plan.md` §13 records that Safari evicts `localStorage` after 7 days.
   The backup surface must move *before* the route dies. A hard sequencing constraint, not a
   nicety.
2. `removeFromLibrary`'s only two call sites are inside the deleted screen.
3. The `missing`-designs report vanishes with the screen; stale entries become permanent and
   invisible.
4. `variantTokenLabel` is the only surface that says *which file* you download under your lock.
5. Placing a single tile gets harder: a recipe drops five placements where one was wanted.
6. Slot fills become room state, so `SHARE_FORMAT_VERSION` bumps and share fragments grow — **2.40x
   at 20 instances, falling to 1.65x at 400**, not the ~5x written here. Row A5 measured it and the
   ratio is not a constant: it is dominated by roughly **90 characters of fixed table cost**, which
   20 instances amortise badly and 400 amortise well. A5 also refuted its own first draft — the
   format does **not** beat a file-for-file v3 link, at 192 characters against 114.
7. Default fills introduce a new class of silent wrongness — a plausible room nobody chose.
8. **The 43 low-confidence and 30 dual-role records will be filed under one role and look wrong to
   anyone who knows the piece.** They are enumerated in T5's report; the builder should disclose the
   inferred role on the instance rather than hide it.

---

## 4. Decisions taken

| # | decision | taken |
| --- | --- | --- |
| D1 | A slot fill stores a design or a file | **File.** Deletes both guessing rules and drops `buildAggregateIndex`'s 62 ms. The lock stays live through the `pinned` bit (§2.1); `share/manifest.ts` needs four lines, not a rewrite. The line count the decision was argued on did not hold — §1.7 — but the decision does not rest on it: `resolve.ts`'s own code fell 28% and the directory grew, because the ranking survives as the default-fill function |
| D2 | Bare aggregates placeable beside templates | **No — templates are the only unit.** Not one template per tile (3,728, and wrong for 828 aggregates whose variants carry differing configs) but **52 generated families keyed on a derived `(role, form, build)`** with size parametric |
| D3 | Where the generated families are authored | **In this repo**, from a TS family table validated by the same `PartSlot` schema. The upstream fixtures stay pinned and read-only |
| D4 | Ship all eight families, or F1 + F5 first | **Full coverage, in three rows** — superseded in mechanism by §2.5: the rows are now "first 20 families (90.4%)", "to 30 (96.4%)", "to 52 (99.0% reach)" |

---

## 5. Blockers

| id | blocker | owns | note |
| --- | --- | --- | --- |
| X1 | `deploy.yml` never fetches the fixtures or runs `npm run stamp`, so its `Verify` fails and its `npm run build` would ship a site with **no catalog index** | `.github/workflows/deploy.yml` | Found by the first ever push to `main` (PR #100) — the deploy path had never run end to end. **Cleared in PR #101.** |
| X2 | The mesh-conversion trigger is **already wrong on `main`**: `PalettePanel`'s `arm()` never adds to the library, so unconverted placements are reachable today | row A2 | **Cleared in PR #107**, as a side effect of moving the trigger to the scene |
| B2 | R2 write credentials | external | Unchanged from v3 |
| B7 | `npm run lod -- --all` backfill | external | An optimisation, not a gate |

---

## 6. Order

```
  B1 ──> B2 ──> B3 ──> ( B4 ──> B5 ) ────────────────────┐
                    └──────────────────> A10             │
                                          ↑              │
  A0 ──> [ A1 A2 A3 A4a A4b A5 A9 A8 ] ───┴──> A6 ──> A7 ┼──> C1 ──> C2 ──> C3 ──> C4
         └────── one atomic PR ──────┘                   │
                                                         │
  X1 (independent) ──────────────────────────────────────┘
```

`store/schema.ts` is the epic's **one hard serialisation point**: A1 owns it, and A2, A3, A4a, A4b,
A5 and the C rows all import `TemplateInstance` from it. Nothing else in the series serialises.

**The A wave lands as one PR, and this plan was wrong to cut A1 as a standalone row.** Row A1 alone
leaves **47 type errors across 27 files owned by seven different rows**, and `npm run build` runs
`tsc -b` first, so the build is red too. The rule the epic-branch method already states, now paid
for: *additive* substrate lands inert; substrate that **renames or removes** does not. A1 renames
`Placement` to `TemplateInstance` and removes `library`, so every consumer moves with it or nothing
compiles.

Two second-order hazards A1 found while proving it, both of which cost real time and both of which
apply to any future renaming row:

- **A type import that no longer resolves becomes `any`**, so every property access downstream
  type-checks silently. `tsc` reported 27 files; the true count is higher, and the masked sites
  surface only when a row fixes its import.
- **19 of the 27 files pass at runtime**, because they build plain object literals that never reach
  the store's parse. A row can watch `vitest` go green over a shape that no longer exists.
  **Test-green is not evidence here.**

The B wave owns `pipeline/**` and generated data and shares no file with the A wave, so it runs from
day one in parallel. B1 emits tags and touches no schema type, so it does not wait on A1. A10 is the
one place the two waves meet: it needs B2's offset convention and the A wave's renderer.

---

## 7. The PR table

**Owns** counts files with real edits; deletions are noted separately and barely count.

| # | title | goal | owns | depends on | neutral? |
| --- | --- | --- | --- | --- | --- |
| **A0** | library readers out | delete the library screen and every reader of the `library` field, leaving `src/store` untouched | deletes `screens/library/{LibraryScreen,LibraryCard,index,library.test}` + `library.css` (1,487+489 lines); **relocates** `LibraryTransfer.tsx` and `grouping.ts`; edits `routes/{routeTree.tsx,index.ts,routes.test.ts}`, `ui/shell/{Header.tsx,shell.test.tsx}`, `screens/landing/{Landing.tsx,landing.test.tsx}`, `screens/catalog/{TileCard.tsx,index.ts,catalog.css,catalog.test.tsx}` (11 edits) | — | no |
| **A1** | the persisted shape | `TemplateInstance`, `SlotFill{tile,pinned}`, `TemplateId`, `SlotName`, `placeTemplate`/`fillSlot`/`pinFill`, `STORE_VERSION` 5→6; delete `library`, `libraryDesigns`, 4 actions, 3 selectors, 3 hooks, `salvageLibrary` | **10**, not the 8 first written here: `store/{schema,migrations,migrations.test,workshopStore,workshopStore.test,index,fixture,corpus.test,generated.test}.ts` and `catalog/schema.ts` | A0 | no — cannot land alone, see §6 |
| **A2** | the mesh trigger | `startLibraryWarming` → `startSceneWarming`, reconciling on `(placements, lock)` with a derived blob-set short-circuit; rename `mesh/library.ts` → `mesh/tiers.ts` | `mesh/{warm,warm.test,library,library.test,context,index,boundary.test}.ts`, `App.tsx` (8) | A1 | no — fixes X2 |
| **A3** | assembly | delete rule 0 **and** rule 1: fills name files and the base is a declared slot. Measured: `resolve.ts`'s own code **−28%**, the directory's non-test lines **+251** (§1.7) | `assembly/{resolve,assemblyIndex,bill,notes,index,assembly.test}.ts` + new `baseMatch.ts` (7); `footprint.ts` and `sizeCode.ts` **shrink, not delete** — both have live consumers | A1 | no |
| **A4a** | canvas: design → records | widen `PlanCatalog.record(design)` — *"where a design becomes a record"* — to return N records per piece | `builder/canvas/{catalog,usePlanTools,geometry,move,overlap,scene,ghost,vacancy,sector,fixture}.ts` + 5 tests (≤15) | A1 | no |
| **A4b** | three: multi-part instances | render an instance's parts from its fills; keep every content-addressed cache. **Deletes `bases.ts`** (258 lines + 562 of tests) — elevation arrives per part and the lift matrix becomes the single application point | `builder/three/{BuilderRoom,instances,edits,place,fixture,RoomSurface}` + 6 tests; deletes `bases.ts` and `bases.test.ts` | A1, A4a | no |
| **A5** | the share codec | encode a template id plus N file ordinals and the `pinned` bits; add `ordinalOfTile` to `manifest.ts`; `SHARE_FORMAT_VERSION` bump | `share/{payload,payload.test,scene,link,link.test,index,capacity.test,manifest}.ts` (8) | A1 only | yes — **zero `@/share` importers in `src`** |
| **A6** | JSON transfer | envelope is `STORE_VERSION` + `WorkshopState`, correct by construction once A1 settles | `store/transfer.ts` + its relocated UI (2) | A1, A0 | no |
| **A7** | elevation-aware overlap | a wall above a floor is not a collision; `partsOverlap` already takes a multi-part array, so SAT is unchanged — B2 verified that by running a real five-slot corner's rotated parts through the unmodified predicate. One level up it is **not** unchanged: `subjectsConflict` gates on `a.band !== b.band` before reaching the predicate and a corner's five fills measure two bands, and `isCornerJunction` exempts exactly the perpendicular wall pair that lives *inside* a corner template, so it reads the 8 mitres as legal | `builder/canvas/overlap.ts` + tests, and the resolution-layer callers A4a did not reach | A4a, B2 | no |
| **A8** | close the substrate | the last 59 type errors after A1's consumers: repoint the panels, gate the download on completeness before the pack module loads, join the bill's inventory on `PlacementId`. Four bill surfaces **deleted rather than repointed**, because each reported a fact nothing computes now | `builder/panels/**` (14), `screens/builder/{BuilderScreen,builder.test,builder.css}`, `generator/placement/{index,corpus.test,pack.test}`, `ui/lock-picker/**`, `ui/shell/shell.test` (23) | A1 and its consumers | no |
| **A9** | the generator arm | the generator's archived arm hands over a **fill**, not a placement: it resolves and declines to place rather than inventing a template id. The shortcut stays, so the 298 kB worker chunk and 10.5 MB WASM are still never fetched for the 682 of 709 keys the archive answers | `generator/placement/{placement,placement.test}.ts` (2) | A1 | no — **refutes §9's "does not touch the base generator"** |
| **A10** | the layout convention | one offset convention across the two arms. B2's `slotOffset` returns the offset of a slot **from the template's centre**; A4a's canvas composition orbits each part's *minimum* corner, and the two do not compose — a template's footprint area then changes under rotation (4.00 / 7.00 / **12.25** / 7.00 units² across the four quarter turns of the fixture corner, against an invariant 7.56 under the centre reading). `room.bounds` feeds `fitRoom`, so a half-turned room frames a box 3x too large | `builder/canvas/geometry.ts` and the `it.fails('keeps its footprint area across quarter turns')` alarm in `builder/three/instances.test.ts` | A4b, B2 | no — the alarm goes green, which is how it reports |
| **B1** | role and form inference | the tag ladder plus the path/component/filename learner; emit `role|x` and `form|x` as interned tags — **+1,165 B** brotli against the artefact it replaced (§2.3), not the +865 B first written here; the holdout and the two ground-truth validations as tests | `pipeline/{role.ts (new),tags,derive,normalise,emit,build,version,index}.ts` + tests, and `src/search/textIndex.ts` — see below | — | **yes** — nothing reads the tags yet |
| **B2** | the slot-anchor model | `SlotAnchor`/`SlotRule` (§2.2), the fill-time offset arithmetic, the three authored conventions keyed on the part-name set | new `src/template/**`, `pipeline/templates.ts` | B1 | yes |
| **B3** | size as a slot parameter | the `foot` → tagged-pair → `sizeCode` chain (96.3%), the 56 `curved_interface` corrections, and the 318 refusals enumerated | `src/template/**`, `pipeline/footprint.ts` | B2 | yes |
| **B4** | the first 20 families | generated from `(role, form, build)`; 90.4% of records, 86.0% of designs. **Plus the one-slot bare-base family on `require: [{ tag: 'shape|base' }]`**, which no `(role, form, build)` key can produce (§2.5) | `pipeline/families.ts` (new), `screens/assemblies/templates.ts` (generated) | B3 | yes |
| **B5** | families to 52 | 30 families cover 96.4% of records, 52 cover **100% of records and 100% of designs** — and *reach* **99.0% / 99.3%**, the gap being the 84 records no square lattice can place (§2.5) | `pipeline/families.ts` | B4 | yes |
| **C1** | the template palette | 52 family rows grouped by role, form and build as facets, size as a control — **plus B4's bare-base family**, which the 52 do not contain (§2.5) | `builder/panels/{palette,PalettePanel,fixture}` + 3 tests, `store/selection.ts` + test (≈12) | A1, B4 | no |
| **C2** | default fills | the greying-aware walk: 40/40 rather than 24/40; every fill it chooses is `auto` | `src/template/**` (fill solver), consumed by C1 and C3 | B2, C1 | no |
| **C3** | the right-click slot editor | slots listed, candidates as a sprite grid, texture-family filter, dead ends greyed, a pick marked `pinned`, a sibling-invalidating pick refused with its reason | `screens/detail/slots/{SlotFills,SlotFills.test,index}`, `screens/detail/{TileDrawer,detail.test}`, `builder/panels/slots/{SlotsPanel,slots.test}`, `screens/assemblies/{AssembliesScreen,index,AssembliesScreen.test}`, `screens/builder/{BuilderScreen,builder.test}` (≈12) | A1, C2 | no |
| **C4** | the bill and the handoff | `billView.ts#placementKey` stops being design-keyed; the bill counts parts rather than placements, and **the download thresholds are restated in parts** — they are stale by **2.58x** and A8 deliberately left them alone with the staleness documented (§9) | `builder/panels/{billView,BillPanel,useArchiveDownload}` + 3 tests | A3, A1, A8 | no |
| **X1** | the deploy workflow | fetch the pinned fixtures and stamp, so `Verify` can run and `build` ships an index | `.github/workflows/deploy.yml` | — | yes |

**One row was deleted rather than marked done.** The table used to carry a **B6** — "the
internal-corner fixture defect, and record that the `accept`-prefix workaround is no longer needed".
The second half is not work: measured, the workaround admits 0 wanted records and keeps the same 238
unwanted ones (§2.5), so there is nothing to record but the measurement, which §2.5 now carries. The
first half turned out to be a decision rather than a row — §9.1 argues it, and the guard it settles
on landed in `pipeline/templates.ts` with this correction pass. A row whose remaining content is
"write down that another row's work is unnecessary" is a row that should not exist.

**Kept untouched, and this is the point of the cut** — corrected, because the first version of this
list was wrong four ways and two of them were real code:

- **Still true, and re-measured:** all ten source files of `src/download/**` (2,839 lines, **zero
  edits** — only its test needed a new fixture), all of `src/{materials,three,tokens}`, and 18 of the
  26 files in `src/mesh/**`. `MESH_CACHE_VERSION` stays 1 and the 64 MB LRU is unaffected, because
  the cache is keyed on the blob md5 and only the *trigger* moves.
- **`src/search` cannot be in this list.** B1's axes broke `textIndex.ts` and no test caught it: it
  tokenises the whole intern table with no namespace filter, so `role` and `form` matched all 3,822
  items, `straight` went from 45 hits to 2,482, and — because prefix expansion only fires on tokens
  the corpus does *not* know — **`decor` fell from 133 hits to 15** and `stair` from 177 to 169, each
  having become an exact token and stopped expanding to `decoration` / `stairs`. Fixed with a
  two-entry namespace skip, after which search answers and the 449-token vocabulary are
  byte-identical to the pre-row index. Four files in the directory moved.
- **`src/generator` cannot either.** A1 left a design question in the generator's archived arm that
  A9 had to decide (`generator/placement/placement.ts`, +170 lines), and A8 followed it into three
  more files there.
- **`src/composition` and `src/catalog` survive as *code*, and that is the claim worth keeping.**
  `src/composition/candidates.ts` needed **no code change** to accept a `role|` predicate — `require`
  is exact equality against the intern table and the postings walk cannot tell a derived tag from a
  scanned one — but three files there and two in `src/catalog` took docblock and test-ceiling edits
  as the reference count moved from 84,023 to 101,427. "Untouched" and "needs no change" are
  different claims, and only the second one held.
- The same shape bit `src/screens/catalog/format.ts`, whose card chips are governed by a
  **denylist**: the axes became chips on nearly every card, emptying 1,044 tag rows to 78 and pushing
  53 cards to 485 that lose a chip to the one-line budget.

---

## 8. Contract dependencies

Pairs that share no file and must still agree. Each of these ships a broken feature with every PR
green, which is why they are written down rather than discovered.

| id | between | the contract |
| --- | --- | --- |
| C-a | A1 and A2 | a partially-filled instance reaching `warmPlacements` fails **silently**, inside a caught subscription |
| C-b | A1 and A5 | `ShareManifest` has no `TileId` to ordinal direction. Four lines, but in a **different unit** from the one that decided fills name files, and A5 decodes wrongly without it |
| C-c | A3 and A4b | two slots may name the same file, which breaks per-placement dedup; `bill.ts` groups on md5 and must count both |
| C-d | A2 and A4b | `BuilderRoom`'s blob set and the warm set are derived independently; disagreement renders as "not in the store" — a message the app already shows legitimately for B7. **Written here as an equality and refuted by A4b:** the room's set is a one-sided **subset** of the warming set, differing by exactly the undrawable fills, and that is the safe side because no blob can strand as "not in the store" |
| C-e | A0 and C3 | three `addToLibrary` call sites compile and do nothing in between. A0 stubs them, C3 rewires them |
| C-f | A1 and C1 | `resetWorkshop` must clear the G5 selection channel — an invariant stated only in a docblock neither owner touches |
| C-g | A1 and C2 | `placeTemplate` must accept **incomplete** fills, or §3.2's "place anyway" is unreachable |
| C-h | A3 and C4 | `ResolvedPlacement.tile` is one record per placement, read by 8 call sites. **Delete the field rather than repoint it**, so all 8 become compile errors instead of silently describing a fraction of the placement |
| C-i | B1 and B4 | the family key is `(role, form, build)`, so a family generated before the tags are emitted resolves to nothing — and an empty candidate set is indistinguishable from an archive gap |
| C-j | B4/B5 and C1 | nothing in `src` can widen a template; the palette's family grouping is empty until B4 lands |
| C-k | A1 and C3 | the `pinned` bit is written by the editor and read by the lock re-solve. If C3 writes every fill `pinned`, the lock toggle silently stops working and nothing fails |

---

## 9. What this plan does not do

- It does not touch the LOD pipeline, materials, or the download path. **It does touch the base
  generator and it does touch search** — this line said otherwise and was wrong on both counts. Row
  A9 rewrote the generator's archived arm to hand over a fill (`generator/placement/placement.ts`),
  A8 followed it into three more files there, and B1's axes forced a real fix in
  `src/search/textIndex.ts`. §7's untouched list carries the measurements.
- It does not add a y-axis to the *store*. Elevation stays derived (§2.2), because 18.4% of measured
  toppers are pre-lifted and 77.5% are not — a stored elevation would encode that inconsistency.
- It does not solve the 33 combinations (2.7%) where the anchor rule fails or the 176 (14.5%) where
  it is undecidable. The 8 corner failures are all `single_piece` — two `size|width|2` walls plus a
  0.5 column on a 2x2 cell, where the mitre is in no tag and no measurement. **Do not silently write
  1.5.** They surface as *needs a choice*. B2 backed the refusal with a further measurement:
  `shape|corner|left` is on 133 tiles and **0 measured**, `shape|corner|right` 133 and **0**,
  `shape|column|corner` 20 and **0** — nothing in the corpus can settle that angle. The 176 break
  down as **102** `diag`/`tri` combinations with no axis-aligned run (given here as 106), **38**
  internal-corner combinations with no anchored face, and the remainder `{shape:'none'}` fills with
  no footprint at all. Counting them as fits would inflate 82.8% by three points on nothing.
- It does not restate the download thresholds. `bill.ts`'s `DOWNLOAD_LARGE_BYTES` (512 MB) and
  `DOWNLOAD_HUGE_BYTES` (2 GB) are calibrated on "fifty placements at the 10.36 MB corpus median",
  and a template instance is multi-part, so the calibrating sentence in that docblock is now false:
  one instance at the median candidate per slot is **26,394,812 B over ~3 files**, twenty instances
  are **~528 MB over ~60 files** and already trip `large` at **1.03x**, and fifty reach
  **1,319,740,600 B — 2.58x `large`**, 66% of `huge`. A median fifty-*tile* room was 1.01x. Rows A3
  and A8 both declined to recalibrate and documented the staleness instead; **row C4 owes the
  restatement, in parts rather than placements**.
- It does not reach the **56 hex and 120-degree pieces**: they need a hex lattice in the builder,
  which is a placement-model change and not a template gap.
- It does not fix the source data. The 43 low-confidence records, the 30 dual-role s2w
  `grate+widened` cells, the 100 untagged roof records, the 2 mis-tagged yawning-portal bases and the
  83 junk `size|width` values are **filed with ids upstream, not fixed here.**

### 9.1 The internal-corner fixture defect: guarded, not repaired

**Two of the four internal-corner templates carry `shape|corner` where their siblings carry
`shape|internal_corner`**, and one of the two loses its `|low` qualifier with it. Measured over all
40, each of which carries exactly one `shape|` tag: `shape|wall` 32, **`shape|corner` 4**,
`shape|corner|low` 2, `shape|internal_corner` 1, `shape|internal_corner|low` 1 — four templates
tagged as corners where only two are corners. The sharpest form of it: **`S2W: Wall on Tile:
Internal Corner: Low (Modular)` carries a tag list identical, string for string, to `S2W: Wall on
Tile: Corner (Any, Modular)`** — five tags, same order — while having three parts against the
other's five. On tags alone those two templates are the same template.

`shape|corner` is not a coarser reading of `shape|internal_corner`; the two are **siblings** under
`shape|`, so this is a wrong answer and not a partial one. The fixtures do also drop a *qualifier*
twice — both `blueprints.s2w.wall.wall+low.yaml` entries carry plain `shape|wall` while requiring
`shape|wall|low` on their wall part — and that is a defensible family root, which is why the check
below is about the form and not about the qualifier.

The fixtures are pinned and read-only (`.github/fixtures.env`), so this repo cannot repair the
source. Of the three available responses — normalise on the way in, record the exception in prose,
or guard the import — **the guard is taken**, and it lives in `pipeline/templates.ts`.

**Why not a normalisation.** It was the tempting answer and it is the wrong one, for one structural
reason and two measured ones:

1. It would falsify the one property `pipeline/templates.ts` earns its trust from. `printFixture`
   re-emits every fixture byte for byte and `printTemplateModule`'s output is asserted byte-identical
   to the committed `src/screens/assemblies/templates.ts`, so the shipped module is *provably* the
   fixtures' content. Rewrite a tag and the module carries a string that appears in no fixture, with
   the normaliser as the only witness that the difference is exactly the correction.
2. **Nothing reads a template's `shape|` tag, and the one path that could is empty on exactly these
   four templates.** Measured. `AssembliesScreen` groups on `build|s2w|single_piece` /
   `build|s2w|modular`; `measure.ts` and `assemblies.test.ts` read tag *roots* only; every layout
   decision keys on the part-name set, which is right on 40 of 40 (§2.2). The one path that reaches
   candidate resolution is `assembly.ts`'s `resolveSlotTags(part.tags, template.tags, ...)`, where a
   template's own tags are the `parentTags` a `constrain` entry inherits — and **all four
   internal-corner templates carry 0 `constrain` entries**, the only 4 of the 40 that do (the other
   36 carry between 3 and 8). So the wrong tag is inherited by nothing. The correction has no
   beneficiary today; the guard's job is to notice the day it would.
3. It would erase two rows' evidence. `src/template/rules.test.ts` and `pipeline/templates.test.ts`
   both measure this defect off the fixtures in order to justify keying on the part-name set. A
   normalisation turns both green by vacuity.

**Why not prose alone.** Prose is what this document had, and it cost B2 the work of discovering the
defect for itself. A recorded exception that no build step reads is a comment.

**What the guard actually is, and why its predicate is the contradiction rather than the spelling.**
A hard-coded list of two `(file, name)` pairs cannot tell whether upstream fixed the data — it would
keep passing over corrected fixtures for ever, which is the "worse than useless" case. A bare
`count !== 2` cannot say which template moved. So the census is computed from a signal **inside each
fixture**: a template whose own parts require an `internal_corner` form while its own `shape|` tag
names a different one. Measured over the 40, the parts say `internal_corner` on **4 of 4** internal
corners and on **0 of the other 36** — every one of the four requires `shape|floor|internal_corner`
on its `floor` part, and the two modular ones additionally require `shape|base|internal_corner`.

`loadTemplateFixtures` runs the census, so `npm run import:catalog` fails **before** it regenerates
the module, and it fails in both directions:

- a third mis-tagged template raises the census and the error names it;
- **upstream fixing either template empties the census, and that fails too** — with its own message,
  saying this is upstream fixing the data and naming the workaround, the guard and the two tag-key
  measurements to delete. Good news that silently changes nothing is how a workaround outlives its
  cause.

`.github/fixtures.env` carries the same note as step 5 of its refresh procedure, since a SHA bump is
when this will fire.

---

## 10. The correction record

Every figure a row moved, against the row that measured it. This section absorbs what
`docs/templates-findings.md` carried; that file was written as a staging post *for this row*, said so
in its own opening line, and is deleted rather than left to disagree with the plan the first time
either is edited. A figure that lives in two documents has two chances to be wrong and one chance to
be checked.

Where a correction has a home in the body above, the body carries it and this is the index. Where it
has no natural home, it is stated here in full.

### 10.1 Figures that did not reproduce

| # | this plan said | measured | row | where |
| --- | --- | --- | --- | --- |
| 1 | `base` is reachable from the `(role, form, build)` key | **`base` is a `layer`, not one of the eight roles.** `shape\|base` is exactly coextensive with `layer === 'base'`: 1,963 records both ways, **0** exceptions in either direction | A9, re-measured B6 | §2.5 |
| 2 | non-test lines in `src/assembly` fall by ≈1,130 of 2,251 | they go **up by 251**; `resolve.ts`'s own code falls 28% | A3 | §1.7 |
| 3 | `assembly/{footprint,sizeCode}.ts` are deleted outright | `footprint.ts` **survives** (two live consumers outside the directory), `sizeCode.ts` **shrinks** | A3 | §1.7 |
| 4 | the interned tag table holds 931 entries | **930** — `role\|unknown` never fires | B1 | §1 |
| 5 | `role\|wall` takes tag id 0 as the most frequent tag | **`form\|straight`** does, 5,707 references against 5,381; `role\|wall` takes id 1. Both one-digit, so the encoding argument survives its premise | B1, re-measured B6 | §2.3 |
| 6 | the axes cost +865 B of index | **+1,165 B** shipped, **+468 B** field-isolated, **+776 B** tail-append. The field has no single honest price; the `PIPELINE_VERSION` digit alone moves the artefact 76 B | B1 | §2.3 |
| 7 | reading `separate_wall` as a role costs 271 errors | **368** — the finding holds at five times the error rate | B1 | §1.3 |
| 8 | `src/search` is kept untouched | it **cannot** be: `decor` fell from 133 hits to 15 | B1 | §7 |
| 9 | 291 of 343 measured bases sit at the 6 mm step | **279 of 343 (81.3%)** within 0.015 mm | B2 | §2.2 |
| 10 | the rule table costs +374 B of index | **+222 B** vs the shipped artefact, **+808 B** vs a fresh build; +374 B reproduces only against the pre-B1 index | B2 | §2.2 |
| 11 | the diagonal undecidables number 106 | **102** | B2 | §9 |
| 12 | a face-word sweep matches 115 tags | **41** on a whole-segment reading — 67 of the extra 74 are `interface\|*` tags matched by the letters inside "inter**face**" | B2 | §1.4 |
| 13 | share fragments grow ~5x | **2.40x** at 20 instances, **1.65x** at 400, the ratio dominated by ~90 characters of fixed table cost. And the format does *not* beat a file-for-file v3 link: 192 characters against 114 | A5 | §3.4 |
| 14 | five slot names contain a space | **two** distinct names, over 8 of 128 parts | A1 | — |
| 15 | contract C-d is an equality | a one-sided **subset**, differing by exactly the undrawable fills — and that is the safe side | A4b | §8 |
| 16 | A1 can land inert as a standalone row | **47 type errors across 27 files owned by seven rows**, and the build red too | A1 | §6 |
| 17 | three canvas files are pure | **two of the three were not** — and moving the ghost's duplicate check down to parts fixed a real defect: a ghost landing where a template's own `right wall` already places the same file was an invisible doubled bill line | A4a | — |
| 18 | the download thresholds hold | stale by **2.58x** at fifty instances; twenty already trip `large` | A3, A8 | §9 |
| 19 | `shape\|wall` is carried by 4,881 records | **4,354** carry the exact tag; 4,881 is the count under the *prefix* reading. Both admit the same 238 non-walls | B6 | §1.3 |
| 20 | the `accept`-prefix workaround picks up 527 records the role predicate misses | it picks up **0** — all 527 are in the `role\|wall` pool already — and admits **exactly the same 238 non-walls**, compared by record id | B1, re-measured B6 | §2.5 |
| 21 | `src/composition/**` and `src/catalog/**` are untouched | untouched as *code*, edited as docblocks and test ceilings as the reference count moved 84,023 → 101,427. "Untouched" and "needs no change" are different claims | B6 | §7 |
| 22 | the 52 families cover 99.9% of designs | **100%** — the families partition the corpus, so no design is outside them | B6 | §2.5 |

Row A4b also measured a defect invisible from any single-slot placement: interpreting a slot offset
as the part's **minimum corner** rather than its **centre** makes a template's footprint area change
under rotation — 4.00 / 7.00 / **12.25** / 7.00 units² across the four quarter turns of the fixture
corner, against an invariant 7.56 under the centre reading. It ships as a deliberately failing test.
**Row A10 owns the fix**; §7 carries it.

### 10.2 The 40 shipped templates, measured

Row A3's census, kept because several rows need it and none of it was in this plan. Row B6
re-measured the first two entries off the fixtures; the rest are cited to A3 and not re-run here:

- **`optional` is absent from all 128 template parts**, so every slot of every one of the 40 is
  required. The download gate — every declared non-optional slot resolved, or refuse — therefore
  applies to all of them. (Contrast the *tile-level* accessory slots, where `optional` is absent on
  1,050 of 3,695 and absence means required.)
- 6 slot names: `floor` 40, `base` 40, `wall` 32, `column` 8, `right wall` 4, `left wall` 4.
- 3-5 parts per template, median 3. **0 dead-end slots.** 14,241 (slot, candidate) pairs at a median
  of 67 candidates. **0 candidates are `layer === 'insert'`.** 3,610 (25.4%) carry no `build|` tag.
  60 have `foot.shape === 'none'`.
- The base gap is **377 = 86 / 31 / 260**, identical under openlock, dragonlock, magnetic and no
  preference, and **3,986 of 3,986** matched toppers take a `plain` base under openlock.

### 10.3 Operational notes

Not corrections, but things that cost rows time and will cost the next row time again:

- **`grep -P` does not match a literal NUL.** Row A3 hit the raw-control-byte hazard twice — a cache
  delimiter written as literal U+0000 and U+0001 — and `grep` missed it; a Python byte scan caught
  it. Scan with bytes, and construct delimiters with `String.fromCharCode` so no escape sequence
  remains in the file. `tools/hygiene/source.test.ts` fails the build on the byte.
- **`deploy.yml` had never run end to end** until the first push to `main`, and would have deployed a
  site with no catalog index at all. Fixed in row X1 (PR #101).
- **The `catalog.json` in a fresh worktree must be copied in.** It is gitignored and derived, and a
  stale copy silently invalidates every corpus figure a row measures. One wave of rows measured
  against a pre-B1 index (915 tags, no axes) before this was caught.

---

## 11. Still open, and owned by nobody

Three of these are row A1's findings about the `pinned` bit; the fourth is row A8's. None of the
four is a bug in anything that has landed — they are decisions this plan never took, and none of
them is named in §7 against a row.

1. **There is no unpin.** Once a slot is pinned it is permanently deaf to the lock. §3.3 never offers
   "reset this slot", so A1 did not invent the action — but a user who pins one wall can never hand
   it back to their lock preference. A one-action fix in a row that has already landed, which is
   exactly why it needs an owner named rather than assumed.
2. **A pinned fill can become unprintable under a new lock, and nothing warns.** `pinned: true` means
   "print this exact file"; that file may be an openlock variant while the build is now dragonlock.
   Detecting it needs a comparison the store cannot make. It belongs to A3 or C4 and is in neither
   of their §7 rows.
3. **The lock re-solve has never been measured at scene scale.** A lock toggle costs instances times
   slots solver calls — 250 instances at 5 slots is **1,250 candidate queries, synchronously, on one
   click**. Row C2 is the natural owner; nothing in its §7 row mentions it.
4. **One measured loss is unowned.** A8 deleted four bill surfaces rather than repointing them,
   because each reported a fact nothing computes now. One of the four was the `unknown-joinery`
   mark — the only surface for the **93 items (2.4%)** with no connector tag anywhere.
