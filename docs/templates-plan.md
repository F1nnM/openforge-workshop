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
`(r / 2, -(D - t) / 2)` where `r` is the signed span a `corner` sibling takes out of that face,
`corner` gives `(-(W - 0.5) / 2, -(D - 0.5) / 2)`. Measured, that rule closes on **1,014 of 1,215
resolved combinations (83.5%)**, fails on **25 (2.1%)** and is undecidable on **176 (14.5%)**.

The `r / 2` is row **D9**'s and it is 0 on all 40 `wall-on-tile` edges, so it moves nothing there.
On the 68 corner edges it abuts the wall against its column instead of centring it across the whole
face — which is the choice row D8 identified as unresolvable *"until somebody can measure a
mitre"*, and §9 is where that measurement is. The split was **1,006 / 33 / 176** before it.

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
128-row expansion is **+281 B** against the shipped artefact at the payload epoch, **-71 B** against
a fresh build with an empty ordinal manifest, and the **+374 B** written here reproduces only against
the *pre-B1* `catalog.json`. (It was +222 and +808 before row D9's corner correction moved both
artefacts; the second one changed **sign**.) Brotli is not additive over 5.9 MB, so "this field costs N bytes" is a
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

## 7.1 What actually shipped, as a ledger

§7 above is the **plan**, kept as written so the cut can be judged against the outcome. This is the
outcome: every PR merged into `epic/v2`, in order, with the row it carried. Row ids are taken from
the PR bodies, not inferred.

Two things the plan did not anticipate, and both are visible here:

1. **The A wave landed as one PR, not eight.** Row A1 proved the plan's own cut wrong — A1 alone
   leaves **47 type errors across 27 files owned by seven different rows**, and `npm run build` runs
   `tsc -b` first, so the build is red too. *Additive* substrate lands inert; substrate that renames
   or removes cannot. #107 is 96 files and eight rows for that reason. §7's decision to cut A1 alone
   is the one clear error in the table.
2. **A whole defect-response wave (D) and an authoring wave (E) exist that §7 has no rows for**,
   because both were commissioned from browser reports and questions after the C wave landed. They
   are a third of the series.

| PR | row(s) | what it did |
| ---: | --- | --- |
| #101 | X1 | fetch the pinned fixtures and stamp before the deploy verifies |
| #102 | — | this plan |
| #103 | **A0** | delete the library screen and every reader of the `library` field |
| #104 | **B1** | infer a `role` and a `form` for every record, as interned tags |
| #105 | A9, B4, B6, C4 | record the row findings the lost research reports carried |
| #106 | **B2** | a template's slot geometry, as a rule with no numbers in it |
| #107 | **A1, A2, A3, A4a, A4b, A5, A9, A8** | the substrate, atomically — store to renderer, 96 files |
| #108 | **A7** | elevation-aware collision, and a rigid footprint under rotation |
| #109 | A9, A10, B6 | make the plan true, and guard the fixture defect it works around (§9.1) |
| #110 | **B3** | resolve a record's grid size, and derive a slot's size predicate |
| #111 | **C4** | the bill counts files, and a fill can be wrong |
| #112 | **B4** (absorbing **B5**) | generate the template families, one slot each |
| #113 | **C2** | default fills in one click, and the lock re-solve behind the pinned bit |
| #114 | C1, C2 | apply a family's size as refs, because a one-slot family has no anchor |
| #115 | B3, B4, C2 | reconcile the 5-versus-8 empty size domain (§10) |
| #116 | **C1** | the palette places templates |
| #117 | **C3** | customise a template's slots from a right click |
| #118 | **A11** | clear a fill, and hand a slot back to the lock |
| #119 | **C5** | a placed template arrives filled, at the size the palette armed |
| #120 | C5 | take a floor of repeats for the median too, and cap the scene re-solve |
| #121 | C5 | put a floor under the per-test timeout |
| #122 | **C6** | wire the real slot layout, so a template's parts stand where they belong |
| #123 | **C7** | give the second composition site the real layout rule |
| #124 | **C8** | right-click the piece to customise its slots |

### The D wave — four browser reports, and what they turned out to be

The project owner placed a `Corner (Wall on Tile)` and reported four things. None of the four was the
defect it looked like from the outside, and two of them were this plan's errors rather than code's.

| PR | row | what it did |
| ---: | --- | --- |
| #125 | **D4** | *research*: assemblies cannot be generated per build system, and need not be |
| #126 | **D3** | the piece under the pointer glows, and the caret asks for a frame |
| #127 | **D2** | assemblies first, then single tiles |
| #128 | **D1** | a wall slot no longer offers the base that goes under a wall |
| #129 | **D6** | a room-wide design, with manual deviations always allowed |
| #130 | **D8** | an over-running part places and turns, instead of piling on the corner |
| #131 | **D7** | the hover cue traces the tile's silhouette, and the stage keeps its passes |
| #132 | **D9** | a corner wall runs 1.5, and the tag that says 2 names its cell |
| #134 | **D10** | seventeen assembly candidates measured, and sixteen add nothing |

- **"Bases offered in a wall slot"** was real and **17× wider than the case found**: 17 of 50
  families admitted bases, **1,963 admissions — every base in the archive** — and four families
  admitted nothing else. D1 took it to zero and bought a property the families never had: the 47
  populations are now **disjoint and sum to the non-insert corpus**. The old sum was 10,380 because
  every base was counted twice.
- **"The corner shows one slot only"** was not a defect at all. The palette carried **91 rows of two
  kinds with nothing telling them apart** — 51 one-slot generated families and 40 multi-slot
  upstream recipes — and the five-slot corner the owner described *already existed and worked*. D2
  split the sections. Its own first fix then reintroduced the complaint: an assembly carries no
  `form|` tag, so pressing the `Corner` chip **hid all 40 assemblies and emptied the section holding
  the answer**. It caught that itself and scoped the facet to single tiles.
- **"The glow is a 1px border floating on top"** was true, and D7 replaced D3's approach with a real
  silhouette — finding on the way that **N8AO had been misconfigured in every `npm run dev` frame
  since the stack was written**, because `useStageComposer` returned a composer from a `useMemo`
  while writing passes into refs, so StrictMode's double-invoke left the refs on a discarded chain.
- **"The parts overlap"** was the deepest. It resolved to §2 of `docs/tile-sizing.md`: a corner wall
  tagged `size|width|2` **runs 1.5**, the tag names the cell rather than the piece, and the footprint
  had been derived from the tag — so **collision and the footprint plate were half a unit too wide
  for the life of the project**, and the over-run doubt was a phantom. D9 settled it by measuring 157
  meshes off R2.

### The E wave — the documents, and the two authored assemblies

| PR | row | what it did |
| ---: | --- | --- |
| #133 | **E1** | `docs/tile-sizing.md` — everything measured about how big a tile is |
| #135 | **E2** | the corridor's floor and base, and a layout the closure check cannot judge |
| #136 | **E3** | a wall assembly that takes any floor, and a corridor |
| #137 | **E4** | the byte identity is a property of binary STL, not of this corpus |
| #143 | **E5** | the floor fills what the walls leave, and E3 is withdrawn |

**Row D5 was specified and never dispatched.** D4 recommended hand-authoring four assemblies; D10's
enumeration then measured that **sixteen of seventeen candidates add nothing** — the floor axis is a
nesting rather than a partition, so the narrower predicates are strict subsets of the widest. E3
shipped the one that pays (**905 → 1,893 designs**) and the corridor, which pays in shape rather than
reach: **+12 records / +2 designs**, the `shape|base|hallway` pieces that no other recipe can reach.

E3 also answered a question D10 could not have: D10 called the widened wall *"an edit, not an
addition"*, and **that edit is impossible** — the fixtures are pinned and read-only, and
`pipeline/templates.ts` earns its trust from their byte-identical round-trip. `pipeline/authored.ts`
names, per slot, the fixture template and part each authored slot derives from and the exact refs
added and removed, so a fixture refresh cannot leave an authored predicate silently stale.

### The corridor added a check nothing else needed

`placeTemplateSlots` proves parts do not overlap and that they cover the cell. **It cannot prove
anything is left to walk on.** Two opposed `edge` slots can eat a cell's whole extent while
disjointness and coverage both hold, so a 1x1 corridor is geometrically flawless and functionally a
wall. No shipped template could have exposed it — the corridor is the first layout in which two slots
consume the same axis. E3 added a sixth doubt code, `no-walk`, and **0 of the 40 fixtures' 1,215
combinations could reach it** — see E5 below, where the same check reaches one.

### E5 withdrew both of E3's assemblies, and the reason is the floor slot

**E3 was wrong, and the report that found it was a screenshot.** The project owner placed an s2w
corner and the floor sat centred in the cell with a quarter-unit gap at each open edge and a
quarter unit of itself under each wall.

The cause was one anchor. `rules.ts` gave the `floor` slot `cell` — *"the slot fills the template's
footprint"* — and every floor slot of every one of the 40 requires `build|s2w`, where **an s2w floor
is the tile minus the strip its separately printed wall stands on.**
`tools/measure/measurements.json` reads `…#floor+s2w+curved.2x2` at **1.5 × 1.5** in a tagged 2 × 2
and the `4x4` at **3.5 × 3.5** in a tagged 4 × 4 — 0.5 short per walled axis. The tag cannot say so:
`size|width|2 + size|depth|2` names the **tile**, which is right for where the piece sits on the grid
and wrong for where the slab sits inside it. So `place.ts` centred a 1.5 slab in a 2.0 box, and
nothing caught it because **4 of the 128 parts have even one candidate with a measured bounding
box** — no test ever held the tag and the mesh at once.

The fix is a fourth anchor, `residual`: the cell less the depth each `edge` slot takes off its own
face, from that wall's own footprint. It invents no number and reproduces both measured floors. It
also makes a template a **tiling** for the first time — under `cell` the floor's box overlapped every
wall and the union test passed only because the floor covered the cell alone.

**Both of E3's assemblies rested on the defect and neither survives it.** The widened wall *was* the
floor-slot widening, so with `build|s2w` restored it is the shipped `(Any, Modular)` recipe plus two
`deny shape|base` repairs — two near-identical palette rows, which is the complaint D2 fixed. And the
corridor cannot take an s2w floor at all: it needs one 0.5 short on two **opposed** faces, and the
archive's whole s2w floor vocabulary is `wall` (one face, 88 records), `corner` (two adjacent, 41),
`internal_corner` (18), `curved` (17) and 12 bare. An s2w corridor is two `wall-on-tile` cells side
by side, not one recipe. So `pipeline/authored.ts`, the `CORRIDOR` convention and the
`AUTHORED_MARKER` are gone, the assemblies section is back to **3,079 records / 905 designs**, and
`RECIPE_TEMPLATES` is the fixtures' content with nothing appended — which makes the byte-identity
guard a claim about the whole array instead of about the half above a marker.

`no-walk` survives the corridor, generalised and **reachable**: it now compares the residual on both
axes rather than pairing opposed edges, and **1 of the 1,215 combinations reaches it** — a 1 × 1 cell
whose `wall` slot resolves to `rough_stone#column+low.I.openforge.stl`, a `rect 1x1` rather than a
half-unit run, which eats the cell's whole depth. Its run tiles the face exactly, so `over-run` never
saw it, and with one edge slot the paired check never looked at the axis. It came out `closes` with
no doubts for the life of E3.

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
- It does not solve the **25 combinations (2.1%)** where the anchor rule fails or the 176 (14.5%)
  where it is undecidable. The 25 are one population — a 0.5 column filling a wall slot on a 2-unit
  face — and they surface as *needs a choice*. The 176 break down as **102** `diag`/`tri`
  combinations with no axis-aligned run (given here as 106), **38** internal-corner combinations
  with no anchored face, and the remainder `{shape:'none'}` fills with no footprint at all. Counting
  them as fits would inflate 83.5% by three points on nothing.

  **The 8 corner failures are gone, and row D9 is why.** This line used to read *"the 8 corner
  failures are all `single_piece` — two `size|width|2` walls plus a 0.5 column on a 2x2 cell, where
  the mitre is in no tag and no measurement. **Do not silently write 1.5.**"* The caution was right
  and it stands: **1.5 must be measured, never assumed.** Its second clause is now false. The mitre
  *is* in a measurement — row D9 fetched the meshes from Cloudflare R2 and read their bounding boxes
  over every facet:

  | class | records | tagged | **measured run** | thickness |
  | --- | ---: | ---: | --- | --- |
  | chirality + `size\|openlock\|A` | 224 | 2 | **1.500–1.513** (93 designs sampled) | 0.500–0.658 |
  | corner, no chirality, code `A` | 21 | 2 | **1.500–1.518** (all 21) | 0.499–0.508 |
  | corner, no chirality, code `BA` | 6 | 1.5 | **1.500** (all 6) | 0.500 |
  | `shape\|corner\|wall` L-pieces | 36 | 1 / 2 / 3 / 4 | **their tagged size in both axes** (all 36) | — |
  | *control* — straight `IA`/`BA`/`A`/`D`/`Q` walls | — | 1 / 1.5 / 2 / 3 / 4 | **1.000 / 1.500 / 2.000 / 3.000 / 4.000** | 0.500 |
  | the `col+L` column | — | — | **0.499 × 0.500** | — |

  157 meshes read whole, ~2.3 GB over free egress, zero exceptions. So on a corner wall
  `size|width|2` names **the cell**, and the run is the cell face less the 0.5 column: exactly 1.5,
  and identical to a modular `size|width|1.5` wall. `1.5 + 0.5 = 2` closes both faces, the two
  corner recipes turn out to describe *the same geometry* and differ only in how many prints the
  corner takes, and the closure split moved **1,006 / 33 / 176 → 1,014 / 25 / 176**.

  B2's supporting measurement — `shape|corner|left` on 133 tiles and **0 measured**,
  `shape|corner|right` 133 and **0**, `shape|column|corner` 20 and **0** — was accurate about the
  *sidecar*: `tools/measure/measurements.json` covers 1,163 blobs and none of the 245 is among
  them. That is why three rows (A10, B2, D8) were right to refuse the number. What it could not
  say is that the meshes were unreachable; they were one `fetch` away.

  Two things the measurement did **not** license, both recorded rather than assumed:
  - The 6 `BA` corner walls measure 1.500 against a **tagged 1.5**, so "a corner wall loses the
    column's 0.5" is false as a general rule and `footprint.ts#cornerWallRun` is gated on the
    tagged run being 2.
  - The 36 `shape|corner|wall` L-pieces measure their tagged size in *both* plan axes — they are
    whole-cell corner assemblies, one print carrying both legs — so they keep their dimension. Their
    `{shape:'wall', length:n}` footprint is still wrong (an L is not a 0.5-deep run) and that is a
    **separate, still-open defect**: `Footprint` has no case for an L, and moving them to `rect`
    would claim a filled square while `none` would unplace 36 tiles.
  - The 21 `grate+widened.2x2` records, which D8 flagged as the other reading of `size|width|2`,
    measure **2.000 × 2.000** and are genuinely whole-cell. They keep their `rect` footprint, and
    the depth tag is what separates them from the runs.
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

### The 2.58x is an artefact, and the unit is the *file* (row C4)

**A3's table above models a room in which no two instances share a file.** `DownloadSize.bytes` is
one copy per distinct md5 — `BillOfTiles.files`, not `parts` and not `placements` — and the dedupe
is the dominant term rather than a correction. Two rooms over the same 40 recipes, measured through
the real `buildBillOfTiles` (`assembly.test.ts`, "shows that an instance count does not determine
the download at all"):

| instances | greedy-solver fills | every slot cycling its candidates |
| ---: | --- | --- |
| 20 | 23 files, 235,565,147 B, `ok` | 66 files, 546,609,140 B, `large` |
| 50 | 36 files, 366,230,378 B, `ok` | 139 files, 1,156,629,241 B, `large` |
| 100 | 36 files, 366,230,378 B, `ok` | 238 files, 2,173,063,288 B, `huge` |
| 200 | **36 files, 366,230,378 B, `ok`** | 367 files, 3,905,784,208 B, `huge` |

The left column **saturates** — 40 recipes are the whole vocabulary and a deterministic solver picks
the same file for the same slot every time, so one instance of each is 112 parts over 36 files and
366,230,378 B (0.72x `large`) and the two hundredth instance adds 0 bytes. **No scene of
solver-filled shipped recipes can trip `large` at all.** So the instance count at which `large`
fires is anywhere between **19** (right column: 63 files, 516,165,775 B) and **never**, and no
docblock can name one. A3's model is exact while parts and files coincide (66 of each at twenty
varied instances, its 528 MB 3.4% under the measured 546,609,140 B) and overstates from there: at
fifty it predicts 1,319,740,600 B against 1,156,629,241 varied (+14.1%) and 366,230,378 solver-filled
(**3.60x**).

Restated in files, over the **2,990 distinct md5s** the 128 shipped slots admit (37,047,210,327 B
total, median **11,255,184**, p90 24,415,784, p95 29,292,934):

| | files |
| --- | ---: |
| 512 MB at the median admitted file | **45.5** |
| 2 GB at the median admitted file | **177.7** |
| 512 MB at p95 | 17.5 |

So the file a builder user actually meets is **11.26 MB — 8.6% larger than the 10.36 MB
whole-corpus median**, not 2.58x anything. **Neither constant moved**, and 512 MB is not a corpus
fact at all: it is `download/save.ts#BLOB_FALLBACK_LIMIT_BYTES` to the byte, the point above which a
browser with no `showSaveFilePicker` (iOS Safari always, plus Firefox and desktop Safari) *refuses*
the archive and `useArchiveDownload` throws before the first fetch. The `large` verdict is the
forecast of that refusal, so raising it would give an `ok` reading to a room iOS Safari cannot save.
What C4 changed is the `large` **sentence**, which said "expect a long transfer" and quoted the
wrong median.

**One stale docblock is left standing on purpose:** `src/download/save.ts` still derives its own
512 MB from "fifty placements at the 10.36 MB corpus median". `src/download/**` is ten source files
with zero edits across this row and its whole contract with `src/assembly` is two type imports;
whoever next owns that directory should restate that sentence.

### What the bill says about a fill, and two facts that do not come back (row C4)

Row A8 deleted three bill surfaces rather than repointing them — `resolutionSummary` /
`rowResolutionCopy`, `BillRow.autoBaseOnly` and the `base · added` marks, and copy for eight note
codes — because all three read facts about **a choice the app made**. Nothing chooses and nothing is
inserted, so none of them has a replacement in kind. What replaced them is the inverse question,
which rule 0 structurally could not ask: **the scene names the files, so a fill can be wrong.**

- **`billView.ts#slotFaults` + `BillPanel.tsx#SlotFaultBlock`** are that surface. Four kinds over
  `ResolvedSlotFill.admissible` and the `fill-off-slot` note — `off-slot`, `retired`, `empty`,
  `no-recipe` — each naming the recipe, the slot and the grid cell, with a Remove action. Before it,
  `fill-off-slot` reached the user only as a rolled-up note saying *how many* slots were wrong and
  nothing about which. Two tones, split on `SlotFault.blocksDownload`, which is §7's line where the
  user meets it: an empty or retired slot refuses the download, an inadmissible fill prints and does
  not fit.
- **`BillLine.slots` had zero consumers until this row.** A3 added it as the per-ask provenance
  because `tileIds` is one id per catalog path and cannot tell two askers of one path from one.
  `billView.ts#slotsAsking` is its first reader: a `×2` row now names the two slots that asked.
  **`ATTRIBUTION.csv` still does not use it** — `download/plan.ts:319` copies `line.tileIds` into
  `ArchiveFileEntry.tileIds` and `download/attribution.ts:101` writes it as `catalogPaths`, exactly
  the pre-A3 provenance. Not fixed here: `src/download/**` is ten source files with zero edits and
  its whole contract with `src/assembly` is two type imports. It is a provenance gap in the archive,
  not an arithmetic error — the counts are right.
- **`unknown-joinery` does not come back, measured.** It was the only surface for the records with no
  `connection|` tag anywhere: **351 of the 8,702**. Reached through the recipes it is almost nothing
  — of the **14,241 (slot, candidate) pairs** the 128 shipped slots admit, **15** name such a record,
  over **15 of the 2,990 distinct md5s** admitted (0.11% of pairs, 0.50% of files). A fourth `warn`
  beside `slot-unfilled` and `fill-off-slot` for a population that size would be loud and almost
  never true. A joinery-less *candidate* is a fact about the pool a slot offers, so it belongs where
  the pool is — row **C3**'s editor, beside `baseGap` — not in a bill written after the fills are
  chosen.
- **`baseMatch.ts#baseGap` stays, and "computing into nothing" is the wrong description.** It is a
  pure classification of the *archive* with no bill caller by design; `@/assembly` exports it for the
  fill-time surfaces C2 and C3 will build, and `generator/placement/corpus.test.ts` plus
  `assembly/assembly.test.ts` both assert its 86 / 31 / 260 split against the live archive. Deleting
  it would delete the answer those rows need before either has asked. It also lives in `baseMatch.ts`,
  which is not in C4's file ownership at all.
- **`BillPanel`'s heading was stale by a noun and the panel had two nouns for two things.** It read
  `{n} tiles placed` for a count of template *instances*, understating the print by a factor of three
  and reading as a count of files. It is `{n} pieces placed` now, over an **unconditional** subline
  giving parts and files — it used to render only when `parts > placements`, which hid the part count
  for every one-part scene and for every scene whose instances have holes in them, which is when a
  reader most needs both. In the same pass the four `noteCopy` codes that count *fills* moved off
  "piece" onto "file", so the two nouns no longer overlap.
### The 5-versus-8 empty size domain, reconciled (rows B3, B4, C2)

Row B3 measured **5** families with an empty size domain; row B4's shipped table has **8**, and row
C2 flagged the disagreement rather than resolving it. Measured over the shipped
`GENERATED_FAMILY_SIZES` — 51 families, 350 options, **43 with real positions and 8 whose only
option is *any size*** — the two rows were answering different questions and both are right.

B3's five are the families where **no record resolves a cell at all**: `wall|diagonal|separate wall`
(121 records), `wall|hex|thick wall` (56), `decor|straight` (26), `wall|octagon|separate wall` (20),
`floor|octagon` (8).

B4's eight are those five plus **three whose cells exist geometrically and cannot be spelled as
tags** — `stair|curve`, `floor|curve|separate wall` and `column|corner|s2w`. Those are exactly
B4's own enumeration of the 16 inexpressible cells arriving at family granularity: the 90-degree
sectors take their cell from geometry while the tags are silent, and a half-unit column has no
`size|width|0.5` to name.

So the honest statement is: **5 families have no size, and 8 offer no size *position*.** A size
control is rendered for 43 of 51. Neither figure needs correcting; what needed saying is which
question each answers.

---

## 11. Still open, and owned by nobody

**Three of the six once listed here had already shipped, and this section did not say so for several
rows.** That is the exact failure the section exists to prevent, so it is recorded rather than
quietly edited: a list of unowned work is only useful if closing an item updates it, and
`src/template/relock.ts` named two of the closures in its own docblock while this document went on
calling them open.

### Closed

1. ~~**There is no unpin.**~~ **Closed by row A11 in #118.** `@/store#unpinFill` hands a slot back to
   the lock while keeping a printable file; `@/store#clearFill` leaves a hole and refuses the
   download — two actions for two intents, and `relock.ts:111` says so.
   `builder/panels/slots/slotEditor.ts#handSlotToLock` is the caller that makes an unpin visible by
   re-solving.
2. ~~**A pinned fill can become unprintable under a new lock, and nothing warns.**~~ **Closed.**
   `src/template/relock.test.ts` carries *"warns that a pinned fill cannot print under the new
   lock"*, and its docblock names this gap as the reason it exists.
3. ~~**The lock re-solve has never been measured at scene scale.**~~ **Closed, and the surprise was
   that the solver is not the expensive half.** 250 instances over 750 slots costs **66.6 ms per
   instance / 1,790 queries**, and **10.4 ms / 288 queries** memoised — it prints in every full test
   run. Row C5's follow-ups (#120, #121) put a floor under the measurement so it cannot silently
   become a different benchmark.

### Genuinely open

4. **One measured loss is unowned.** Row A8 deleted four bill surfaces rather than repointing them,
   because each reported a fact nothing computes now. One of the four was the `unknown-joinery`
   mark — the only surface for the **93 items (2.4%)** with no connector tag anywhere. The verdict is
   still computed, in `src/catalog/aggregate.ts`, and `billView.ts`'s own docblock records that it
   *"does not come back"*. So this is a rendering gap over a live value, not a lost computation.
5. **The 36 `shape|corner|wall` L-pieces have no footprint primitive.** Row D9 measured all 36 — one
   print carrying both legs of a corner, measuring its tagged size in *both* plan axes (`IA` 1 x 1,
   `A` 2 x 2, `D` 3 x 3, `Q` 4 x 4, all within 0.055 u) — and left their `{shape:'wall', length:n}`
   footprint alone, because an L is not a 0.5-deep run and `Footprint` has no case that is. Its cases
   are `arc`, `column`, `diag`, `none`, `rect`, `tri`, `wall`. `rect` would claim a filled square and
   collide against the whole cell; `none` would unplace 36 tiles. Either is a **classification**
   change, so it also moves the RECT/WALL/ARC tallies `docs/verify-catalog-facts.py` mirrors and
   `pipeline/catalog.test.ts` asserts — which is why D9, whose correction was a parameter and touched
   no tally, did not take it.
6. **102 designs lost their exact size chip, and the fix is a priced tag.** The cost of D9's
   correction, measured in `src/builder/panels/palette.corpus.test.ts`: a size position is a *tag*
   ref, and a corner wall's only `size|width` tag says 2 while its measured run is 1.5. So those
   designs arm their family at *any size* rather than at a size — 3,206 → **3,104 of 3,728** exact
   hits, 86.0% → 83.3%. Nothing is unreachable and the geometry drawn is the corrected 1.5; what is
   lost is the chip. The fix is the derived `size|run|<r>` tag `src/template/size.ts` prices at
   **+300 B** and declines for a tag-table reason, and D9 raised its stake from 84 records to 679
   (`RUN_UNREACHABLE`). It is B4's table, and it is in neither of its §7 rows.
7. **`cornerReservation` is wrong for a face flanked by two corners, and the verdict inverts.** Row
   D10 measured it: corner spans are summed **signed**, so two corners at opposite ends of one face
   cancel to 0 where the correct magnitude is 1.0. On a 3-wall dead end's back face the run that
   *tiles* (1.0) reports **`fails`**, while the run that overlaps both columns (2.0) reports
   **`closes` with an empty doubt list**; a 4-wall closet reports `closes` and draws **12 overlapping
   pairs**. **Nothing reachable today is affected** — no shipped convention has two corner-anchored
   slots (`wall-on-tile` has none; both corner conventions have exactly one) — so it blocks only the
   two multi-column shapes, which is why row E3 was told not to touch it. The pool exists: 252 files
   at run 1.0. It is the same class of decision D8 declined to make without a measurement.
8. **One record's mesh has no geometry, and it is upstream's to fix.**
   `aztlan#column.col+T.side+dragonlock.stl` is 84 bytes — a valid binary STL whose facet count field
   is **0**. It downloads, parses and draws nothing, and refusing a valid empty STL in the parser
   would be the wrong fix. `src/mesh/corpus.test.ts` pins it as a singleton so a second cannot appear
   unnoticed (#137).
9. **The palette's docblocks still say 87 rows, and one screen sentence is now untrue of two rows.**
   Row E3 added two assemblies without owning `src/builder/panels/**`, so ~15 present-tense "87"
   claims there are now 89, and `src/screens/assemblies/AssembliesScreen.tsx:139` renders *"42
   recipes from the archive's own blueprint fixtures"* — true of 40 of them. Nothing asserts that
   sentence, so nothing fails. `src/screens/assemblies/measure.ts#assertTemplates` also hard-codes
   `!== 40` as a runtime invariant, which E3 avoided rather than changed.
