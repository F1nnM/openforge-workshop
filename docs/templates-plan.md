# Templates — the `epic/v2` plan

The builder stops placing tiles and starts placing **templates**: a recipe with named slots, each
slot filled from the catalog, the whole thing placed and rotated as one unit. Templates are the
**only** placement unit. The library is deleted. The data layer underneath is rewritten rather than
adapted.

Nothing is deployed, so **no row owes a data migration or backwards compatibility**. Discarding
persisted state is explicitly permitted and is assumed throughout.

This document is the deliverable: §7 is the PR table, and it is what the series is run from.

---

## 1. What the research found, and what it changed

Five research passes ran against the live corpus (`public/catalog/catalog.json`, 8,702 records,
3,822 aggregates, 915 tags) before this plan was fixed. Their reports are the evidence for every
figure below. Each finding is a number, not a preference; where a pass refuted the brief it was
given, the refutation is what shaped the plan.

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

- `shape|wall` is carried by 4,881 records and **238 of them are not walls** — 176 floors, 54
  columns, 8 stairs. On a floor or a base it means "belongs to a wall run", not "is a wall".
- **527 of 527** `shape|wall|low` records omit the parent `shape|wall`.
- **459 records carry no `shape|` tag at all**, and **100 roof records are named by no `shape|` root
  in the taxonomy.**
- `component|` names a *feature*, not a role: **357 of 3,833 disagree** (`#wall,drain`,
  `#wall,slope`).
- `size|width` carries two non-numeric values — `wot` (50 records) and `sw` (33) — which are
  **build markers**, not widths: all 50 `wot` sit under `wall_on_tile`, and all 83 have `build`
  absent.
- Two of the four internal-corner templates are themselves mis-tagged `shape|corner`.

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

**8,702 of 8,702 records classify, 0 unknown** — 7,413 high confidence (85.2%), 1,246 medium, 43
low. The classifier is a tag ladder that labels 7,756 records directly; a learner trained on that
subset reproduces the label from path, component and filename alone on **7,397 of 7,471 non-insert
records (99.01%)** under 5-fold holdout. Two findings got it there: path **depth** is the signal
(depth 2 is the build system, and reading `separate_wall` as a role cost 271 errors), and depths 4-7
are joinery, so stoplisting `openlock` and its siblings moved 96.89% to 99.01%.

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

### 1.7 The rewrite deletes about half the resolver, and the share codec is dead code

`src/assembly/resolve.ts` is 956 lines, and roughly **700** exist to *guess* what the user meant —
rule 0 (pick a variant from an aggregate) and rule 1 (auto-insert a base under every topper, ranked
on a five-criterion weighted ladder). A template declares its base as an explicit slot; the s2w
recipes already carry a `base` part and sibling parts already carry `fulfills: ['base']`. Both rules
die.

Directory-wide that is **≈1,130 of 2,251 non-test lines** removed, plus `footprint.ts` (96) and
`sizeCode.ts` (122) deleted outright, plus `buildAggregateIndex`'s measured **62 ms** dropped from
the index build against the assembly index's own 12 ms. `src/download/**` — all ten files, 2,839
lines — needs **zero** edits; it never imports a placement.

And **nothing in `src` imports `@/share`**: the codec is dead code today, so it can be reshaped
freely and it blocks nothing.

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
re-import cannot silently change what a saved room contains, which is §13's whole concern.

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
cell at yaw 0, and their elevations are already implemented and measured (`bases.ts#baseElevationMm`
reads the base's own mesh height; 291 of 343 measured bases sit at 6.00-6.01 mm). The other 48 — 32
`wall`, 8 `column`, 8 left/right-wall — need **three authored conventions**, one per part-name set,
not 48 decisions. Keying on the part-name set is right on **40 of 40**; keying on tags is wrong on 2
of 40 because of the internal-corner fixture defect.

**Where the table lives, and what it costs.** Measured with `emit.ts`'s own brotli-11 path: the rule
table is **+374 B** in the index. It ships in the bundle beside `templates.ts` instead, so the index
gains **0 B**.

**Two arithmetic hazards, both measured.** Slot offsets land on multiples of **0.25**, off the
builder's 0.5 snap lattice — so the template *origin* snaps and slot offsets never do. And 18.4% of
measured `openforge` toppers are authored pre-lifted by exactly 6.0 mm while 77.5% are not, so
elevation stays normalised and is never trusted from the file.

### 2.3 Role and form are emitted as interned tags

The role and form axes are emitted as ordinary tags — `role|wall`, `form|corner` — into the existing
intern table. Priced against the **512,000 B** budget with `emit.ts`'s brotli-11:

| encoding | index delta | budget |
| --- | ---: | ---: |
| baseline | — | 365,598 B (71.41%) |
| **`role|x` + `form|x` as interned tags** | **+865 B** | **366,463 B (71.57%)** |
| role only, as a tag | +773 B | — |
| integer codes | +868 B | — |
| dense code strings | +858 B | — |
| separate string fields | +2,416 B | — |
| per-role posting lists | +15,342 B | rejected |
| derived in the browser | +0 B index, 1,561 B of JS, 31.7 ms | — |

The tag encoding wins for a reason that is not the byte count: **`role|wall` becomes the corpus's
most frequent tag**, taking tag id 0 and one-digit references, and `require: [{ tag: 'role|wall' }]`
needs **zero new code** in `src/composition/candidates.ts`. It is also build-time checkable, which
the browser-derived alternative is not.

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
| 52 | 100% | 99.9% |

Only 3 of the 52 hold three records or fewer. Coarser keys were measured too: `(role, build)` gives
20 families at 100%, `(role, form)` gives 26.

**Reach: 8,618 of 8,702 records (99.0%) and 3,797 of 3,822 designs (99.3%)**, against 3,079 (35.4%)
today. The 84 unreachable records over 25 designs are fully enumerated, and **56 of them are the hex
lattice** — a builder limitation, not a template gap.

This supersedes the eight hand-specified families the plan first proposed (bare floor, wall-on-tile,
thick wall, s-system, wall-on-any-floor, curves, stairs, risers). They are subsumed: role-predicated
generation reaches 99.0% where they reached 93.8%, and it does not require the `accept`-prefix
workaround at all — **all 527 `shape|wall|low` records are walls**, so the role predicate admits them
without touching the grammar.

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
   path**, and §13 records that Safari evicts `localStorage` after 7 days. The backup surface must
   move *before* the route dies. A hard sequencing constraint, not a nicety.
2. `removeFromLibrary`'s only two call sites are inside the deleted screen.
3. The `missing`-designs report vanishes with the screen; stale entries become permanent and
   invisible.
4. `variantTokenLabel` is the only surface that says *which file* you download under your lock.
5. Placing a single tile gets harder: a recipe drops five placements where one was wanted.
6. Slot fills become room state, so `SHARE_FORMAT_VERSION` bumps and share fragments grow ~5x.
7. Default fills introduce a new class of silent wrongness — a plausible room nobody chose.
8. **The 43 low-confidence and 30 dual-role records will be filed under one role and look wrong to
   anyone who knows the piece.** They are enumerated in T5's report; the builder should disclose the
   inferred role on the instance rather than hide it.

---

## 4. Decisions taken

| # | decision | taken |
| --- | --- | --- |
| D1 | A slot fill stores a design or a file | **File.** Deletes ~700 lines of `resolve.ts` rather than ~470 and drops `buildAggregateIndex`'s 62 ms. The lock stays live through the `pinned` bit (§2.1); `share/manifest.ts` needs four lines, not a rewrite |
| D2 | Bare aggregates placeable beside templates | **No — templates are the only unit.** Not one template per tile (3,728, and wrong for 828 aggregates whose variants carry differing configs) but **52 generated families keyed on a derived `(role, form, build)`** with size parametric |
| D3 | Where the generated families are authored | **In this repo**, from a TS family table validated by the same `PartSlot` schema. The upstream fixtures stay pinned and read-only |
| D4 | Ship all eight families, or F1 + F5 first | **Full coverage, in three rows** — superseded in mechanism by §2.5: the rows are now "first 20 families (90.4%)", "to 30 (96.4%)", "to 52 (99.0% reach)" |

---

## 5. Blockers

| id | blocker | owns | note |
| --- | --- | --- | --- |
| X1 | `deploy.yml` never fetches the fixtures or runs `npm run stamp`, so its `Verify` fails and its `npm run build` would ship a site with **no catalog index** | `.github/workflows/deploy.yml` | Found by the first ever push to `main` (PR #100). Not urgent — B2 blocks the deploy anyway — but the deploy path has never run end to end |
| X2 | The mesh-conversion trigger is **already wrong on `main`**: `PalettePanel`'s `arm()` never adds to the library, so unconverted placements are reachable today | row A2 | A2 fixes it as a side effect of moving the trigger to the scene |
| B2 | R2 write credentials | external | Unchanged from v3 |
| B7 | `npm run lod -- --all` backfill | external | An optimisation, not a gate |

---

## 6. Order

```
  B1 ──> B2 ──> B3 ──> ( B4 ──> B5 ) ──> B6 ───────────────────┐
                                                                │
  A0 ──> A1 ──> ( A2 | A3 | A4a | A5 ) ──> A4b ──> A6 ──> A7 ───┼──> C1 ──> C2 ──> C3 ──> C4
                                                                │
  X1 (independent) ────────────────────────────────────────────┘
```

`store/schema.ts` is the epic's **one hard serialisation point**: A1 owns it, and A2, A3, A4a, A4b,
A5 and the C rows all import `TemplateInstance` from it. Nothing else in the series serialises.

The B wave owns `pipeline/**` and generated data and shares no file with the A wave, so it runs from
day one in parallel. B1 emits tags and touches no schema type, so it does not wait on A1.

---

## 7. The PR table

**Owns** counts files with real edits; deletions are noted separately and barely count.

| # | title | goal | owns | depends on | neutral? |
| --- | --- | --- | --- | --- | --- |
| **A0** | library readers out | delete the library screen and every reader of the `library` field, leaving `src/store` untouched | deletes `screens/library/{LibraryScreen,LibraryCard,index,library.test}` + `library.css` (1,487+489 lines); **relocates** `LibraryTransfer.tsx` and `grouping.ts`; edits `routes/{routeTree.tsx,index.ts,routes.test.ts}`, `ui/shell/{Header.tsx,shell.test.tsx}`, `screens/landing/{Landing.tsx,landing.test.tsx}`, `screens/catalog/{TileCard.tsx,index.ts,catalog.css,catalog.test.tsx}` (11 edits) | — | no |
| **A1** | the persisted shape | `TemplateInstance`, `SlotFill{tile,pinned}`, `TemplateId`, `SlotName`, `placeTemplate`/`fillSlot`/`pinFill`, `STORE_VERSION` 5→6; delete `library`, `libraryDesigns`, 4 actions, 3 selectors, 3 hooks, `salvageLibrary` | `store/{schema,migrations,migrations.test,workshopStore,workshopStore.test,index,fixture,corpus.test}.ts` (8) | A0 | no |
| **A2** | the mesh trigger | `startLibraryWarming` → `startSceneWarming`, reconciling on `(placements, lock)` with a derived blob-set short-circuit; rename `mesh/library.ts` → `mesh/tiers.ts` | `mesh/{warm,warm.test,library,library.test,context,index,boundary.test}.ts`, `App.tsx` (8) | A1 | no — fixes X2 |
| **A3** | assembly | delete rule 0 **and** rule 1: fills name files and the base is a declared slot. ≈1,130 of 2,251 non-test lines out | `assembly/{resolve,assemblyIndex,bill,notes,index,assembly.test}.ts` (6); deletes `assembly/{footprint,sizeCode}.ts` (218) | A1 | no |
| **A4a** | canvas: design → records | widen `PlanCatalog.record(design)` — *"where a design becomes a record"* — to return N records per piece | `builder/canvas/{catalog,usePlanTools,geometry,move,overlap,scene,ghost,vacancy,sector,fixture}.ts` + 5 tests (≤15) | A1 | no |
| **A4b** | three: multi-part instances | render an instance's parts from its fills; keep every content-addressed cache | `builder/three/{bases,BuilderRoom,instances,edits,place,fixture}` + 5 tests (11) | A1, A4a | no |
| **A5** | the share codec | encode a template id plus N file ordinals and the `pinned` bits; add `ordinalOfTile` to `manifest.ts`; `SHARE_FORMAT_VERSION` bump | `share/{payload,payload.test,scene,link,link.test,index,capacity.test,manifest}.ts` (8) | A1 only | yes — **zero `@/share` importers in `src`** |
| **A6** | JSON transfer | envelope is `STORE_VERSION` + `WorkshopState`, correct by construction once A1 settles | `store/transfer.ts` + its relocated UI (2) | A1, A0 | no |
| **A7** | elevation-aware overlap | a wall above a floor is not a collision; `partsOverlap` already takes a multi-part array, so SAT is unchanged — the single-primitive assumption is in ~20 resolution-layer functions | `builder/canvas/overlap.ts` + tests, and the resolution-layer callers A4a did not reach | A4a | no |
| **B1** | role and form inference | the tag ladder plus the path/component/filename learner; emit `role|x` and `form|x` as interned tags, **+865 B** brotli; the holdout and the two ground-truth validations as tests | `pipeline/{role.ts (new),tags,derive,normalise,emit}.ts` + tests | — | **yes** — nothing reads the tags yet |
| **B2** | the slot-anchor model | `SlotAnchor`/`SlotRule` (§2.2), the fill-time offset arithmetic, the three authored conventions keyed on the part-name set | new `src/template/**`, `pipeline/templates.ts` | B1 | yes |
| **B3** | size as a slot parameter | the `foot` → tagged-pair → `sizeCode` chain (96.3%), the 56 `curved_interface` corrections, and the 318 refusals enumerated | `src/template/**`, `pipeline/footprint.ts` | B2 | yes |
| **B4** | the first 20 families | generated from `(role, form, build)`; 90.4% of records, 86.0% of designs | `pipeline/families.ts` (new), `screens/assemblies/templates.ts` (generated) | B3 | yes |
| **B5** | families to 52 | 30 reaches 96.4%, 52 reaches 100% of families and **99.0% of records / 99.3% of designs** | `pipeline/families.ts` | B4 | yes |
| **B6** | two corrections | the internal-corner fixture defect (2 of 4 templates carry `shape|corner`); and **record that the `accept`-prefix workaround is no longer needed**, because all 527 `shape|wall|low` records are walls under the role predicate | `pipeline/templates.ts`, `docs/templates-plan.md` | B1 | no |
| **C1** | the template palette | 52 family rows grouped by role, form and build as facets, size as a control | `builder/panels/{palette,PalettePanel,fixture}` + 3 tests, `store/selection.ts` + test (≈12) | A1, B4 | no |
| **C2** | default fills | the greying-aware walk: 40/40 rather than 24/40; every fill it chooses is `auto` | `src/template/**` (fill solver), consumed by C1 and C3 | B2, C1 | no |
| **C3** | the right-click slot editor | slots listed, candidates as a sprite grid, texture-family filter, dead ends greyed, a pick marked `pinned`, a sibling-invalidating pick refused with its reason | `screens/detail/slots/{SlotFills,SlotFills.test,index}`, `screens/detail/{TileDrawer,detail.test}`, `builder/panels/slots/{SlotsPanel,slots.test}`, `screens/assemblies/{AssembliesScreen,index,AssembliesScreen.test}`, `screens/builder/{BuilderScreen,builder.test}` (≈12) | A1, C2 | no |
| **C4** | the bill and the handoff | `billView.ts#placementKey` stops being design-keyed; the bill counts parts rather than placements, and the download thresholds are restated in parts | `builder/panels/{billView,BillPanel,useArchiveDownload}` + 3 tests | A3, A1 | no |
| **X1** | the deploy workflow | fetch the pinned fixtures and stamp, so `Verify` can run and `build` ships an index | `.github/workflows/deploy.yml` | — | yes |

**Kept untouched, and this is the point of the cut:** all of `src/download/**` (10 files, 2,839
lines, **zero edits**), all of `src/composition/**` (the slot solver already works, emits 0 bytes,
and needs no change to accept a `role|` predicate), all of
`src/{catalog,search,materials,three,tokens,generator}`, and 18 of the 26 files in `src/mesh/**` —
`MESH_CACHE_VERSION` stays 1 and the 64 MB LRU is unaffected, because the cache is keyed on the blob
md5 and only the *trigger* moves.

---

## 8. Contract dependencies

Pairs that share no file and must still agree. Each of these ships a broken feature with every PR
green, which is why they are written down rather than discovered.

| id | between | the contract |
| --- | --- | --- |
| C-a | A1 and A2 | a partially-filled instance reaching `warmPlacements` fails **silently**, inside a caught subscription |
| C-b | A1 and A5 | `ShareManifest` has no `TileId` to ordinal direction. Four lines, but in a **different unit** from the one that decided fills name files, and A5 decodes wrongly without it |
| C-c | A3 and A4b | two slots may name the same file, which breaks per-placement dedup; `bill.ts` groups on md5 and must count both |
| C-d | A2 and A4b | `BuilderRoom`'s blob set and the warm set are derived independently; disagreement renders as "not in the store" — a message the app already shows legitimately for B7 |
| C-e | A0 and C3 | three `addToLibrary` call sites compile and do nothing in between. A0 stubs them, C3 rewires them |
| C-f | A1 and C1 | `resetWorkshop` must clear the G5 selection channel — an invariant stated only in a docblock neither owner touches |
| C-g | A1 and C2 | `placeTemplate` must accept **incomplete** fills, or §3.2's "place anyway" is unreachable |
| C-h | A3 and C4 | `ResolvedPlacement.tile` is one record per placement, read by 8 call sites. **Delete the field rather than repoint it**, so all 8 become compile errors instead of silently describing a fraction of the placement |
| C-i | B1 and B4 | the family key is `(role, form, build)`, so a family generated before the tags are emitted resolves to nothing — and an empty candidate set is indistinguishable from an archive gap |
| C-j | B4/B5 and C1 | nothing in `src` can widen a template; the palette's family grouping is empty until B4 lands |
| C-k | A1 and C3 | the `pinned` bit is written by the editor and read by the lock re-solve. If C3 writes every fill `pinned`, the lock toggle silently stops working and nothing fails |

---

## 9. What this plan does not do

- It does not touch the base generator, the LOD pipeline, materials, search, or the download path.
- It does not add a y-axis to the *store*. Elevation stays derived (§2.2), because 18.4% of measured
  toppers are pre-lifted and 77.5% are not — a stored elevation would encode that inconsistency.
- It does not solve the 33 combinations (2.7%) where the anchor rule fails or the 176 (14.5%) where
  it is undecidable. The 8 corner failures are all `single_piece` — two `size|width|2` walls plus a
  0.5 column on a 2x2 cell, where the mitre is in no tag and no measurement. **Do not silently write
  1.5.** They surface as *needs a choice*.
- It does not reach the **56 hex and 120-degree pieces**: they need a hex lattice in the builder,
  which is a placement-model change and not a template gap.
- It does not fix the source data. The 43 low-confidence records, the 30 dual-role s2w
  `grate+widened` cells, the 100 untagged roof records, the 2 mis-tagged yawning-portal bases and the
  83 junk `size|width` values are **filed with ids in T5's report, not fixed here.** They belong
  upstream.
