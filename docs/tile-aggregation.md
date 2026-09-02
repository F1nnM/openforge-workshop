# Tile aggregation — collapsing base-integrated and base-less variants into one catalog item

**Status:** proposed. Written 2026-09-01 against `catalog.json` built from fixtures commit
`428289679a0c62ade992a51ef949f47cdc2b9aed` (8,702 live records, 915 interned tags).

**Every number below is re-derived from the emitted index**, not inherited. Where a claim is
an inference rather than a measurement it says so inline. Where a detection rule is imperfect
its precision and recall are given against an independent signal rather than asserted away.
The measurement script reproduces `src/assembly/assembly.test.ts`'s asserted corpus figures
exactly (1,999 coded toppers / 129 no-matching-base / 2,364 codeless / 1,899 footprint-fallback
hits / 21 no-congruent / 444 unmatchable), which is the check that the port of the resolver's
matching logic used throughout this document is faithful.

## The requirement

> Are we able to aggregate tiles with integrated bases and the corresponding tile without base
> all as one item? Then in the builder one can just choose a lock system for the current build,
> and we choose the correct file from the aggregated item, or add a base if there is no tile of
> that system […] So in the catalog/library we only list the aggregated item. Maybe with tags
> showing which types are available (topper only, OpenLOCK, etc.)

Short answer: **yes, and the pipeline already computes the key.** `CatalogRecord.design`
groups exactly the pairs asked for, and the collapse is lossless for every facet in the app
except connection. The two things that need building are a *positional* connection projection
(the shipped `conn` field cannot answer "which lock is on the bottom") and a variant table.
The two things that need care are the manifest ordinals and a "which base did you give me"
disclosure the current resolver does not make.

---

## 1. Can "integrated base" be detected?

### 1.1 The ground truth used

The tags and the filename are two independently authored descriptions of the same file. The
filename's last dot-segment is a connection token — `openforge`, `openlock,side`,
`dragonlock,magnetic+flex`, 104 distinct tokens over the corpus. **Ground truth for "this file
needs a separately printed base" is: the token names `openforge`.** That yields 4,367 positives
(50.2% of 8,702) and is derived from a field no candidate rule below reads.

### 1.2 Candidate rules, scored

| Rule | Flagged | TP | FP | FN | Precision | Recall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| **R1 — `layer === 'topper'`** (i.e. carries `connection\|openforge`) | 4,363 | 4,363 | 0 | 4 | **100.0%** | **99.9%** |
| R2 — any `connection\|openforge*` tag | 4,363 | 4,363 | 0 | 4 | 100.0% | 99.9% |
| R3 — `build\|wall on tile` | 863 | 857 | 6 | 3,510 | 99.3% | 19.6% |
| R4 — `shape\|base` **plus** another kind bucket | 1,277 | 0 | 1,277 | 4,367 | **0.0%** | **0.0%** |
| R5 — no lock system on the piece | 3,431 | 3,084 | 347 | 1,283 | 89.9% | 70.6% |
| R6 — declares a `base` composition slot | 2,451 | 2,451 | 0 | 1,916 | 100.0% | 56.1% |
| R7 — catalog path contains `/openforge/` | 1,926 | 1,923 | 3 | 2,444 | 99.8% | 44.0% |

**R1 is the rule.** Zero false positives, four false negatives, and here they are in full —
all four are corpus defects, a file naming openforge with no `connection|` tag at all:

```
tiles/catacombs/thick_wall/loculus/catacombs#wall,loculus.S.openforge+split,top,arch.stl
tiles/catacombs/thick_wall/loculus/catacombs#wall,loculus.S.openforge+split,top,flat.stl
tiles/dungeon_stone/wall_on_tile/wall+special/statue_and_secret_door/dungeon_stone#wall,secret_door+broken_section.2x.openforge.stl
tiles/dungeon_stone/wall_on_tile/wall+special/statue_and_secret_door/dungeon_stone#wall,secret_door+tamoachan_statue.2x.openforge.stl
```

**R4 deserves burying properly, because it is the plausible-looking rule that is completely
wrong.** "`shape|base` combined with another shape" reads like "a tile with its base built in",
and it catches 1,277 tiles — 906 also tagged `wall`, 176 `riser`, 116 `floor`, 79 `angled`.
Every one is a false positive. Inspection of the names shows why: 1,956 of the 1,963
`shape|base` records live under `tiles/bases/`, and `shape|base|wall` means *a base shaped to
receive a wall*, not a wall carrying a base:

```
tiles/bases/separate_wall/primary_walls/base#wall%aztlan/openlock/aztlan#base+wall.A.openlock.stl
tiles/bases/s2w/base#square+s2w+wall%plain/dragonlock,magnetic+flex/plain#base+s2w+square+wall.4x4.dragonlock,magnetic+flex.stl
```

Corroborating: **0 of 1,963 `shape|base` records carry `connection|openforge`**, and all 1,963
carry a lock system. A base is never a topper. R4 has the polarity exactly inverted.

**R3 is a build system, not a base state.** All 863 `build|wall on tile` records are checked:
857 are toppers, 6 are the mis-tagged integrals above, **0 carry a lock system**. `wall on
tile` is a wall fused to its *floor tile*, and that assembly still sits on a base. It is not
an integrated base, and its 19.6% recall is the recall of a subset.

**R6 is an interesting corroborator.** Every one of the 2,451 records declaring a `base`
composition slot is a topper — precision 100% — but only 56.1% of toppers declare one. So the
config confirms and never contradicts; it cannot be the primary signal.

### 1.3 The correction R1 needs: connection position

`CatalogRecord.conn` flattens the position segment away, and **for this question that
flattening is fatal**. Measured, splitting `connection|<system>` (own/bottom) from
`connection|side|<system>`:

| Layer | n | own-position lock | side-lock only | no lock at all |
| --- | ---: | ---: | ---: | ---: |
| `topper` | 4,363 | **0** | 1,283 | 3,080 |
| `integral` | 2,091 | 1,972 | 52 | 67 |
| `base` | 1,963 | 1,963 | 0 | 0 |
| `insert` | 285 | 0 | 1 | 284 |

**Not one of the 4,363 toppers carries a bottom lock.** The 1,283 that carry a lock carry it
on the side — `openforge,side+dragonlock` is openforge underneath (needs a base) and dragonlock
to the neighbour. Reading `record.conn` and concluding those 1,283 toppers "offer dragonlock"
would advertise a joinery they physically do not have at the bottom, which is the same class of
error §2 already documents for the `side` phantom system, one level deeper.

Bottom locks, by layer:

- `integral`: openlock 1,923 · dragonlock 31 · magnetic+openlock 8 · magnetic 6 ·
  dragonlock+magnetic 4 · **none 119**
- `base`: magnetic+openlock 658 · openlock 510 · dragonlock 312 · dragonlock+magnetic 258 ·
  magnetic 225 — never none, confirming `resolve.ts`'s note

**Two data gaps to carry forward.** (a) 119 integral records publish no bottom-lock tag; 33 of
them name one in the filename only (15 `side+dragonlock`, 18 `magnetic+imperial`/`+metric` —
and imperial-vs-metric magnet sizing exists nowhere in the tag vocabulary). (b) `connection|
bottom` (6 tags), `connection|left` (1) and `connection|right` (1) are positions absent from
`facets.ts`' `CONNECTION_POSITIONS`, so 8 records currently carry phantom systems named
`bottom`, `left` and `right`; the `conn` facet shows them as values with counts 6, 1 and 1.
Small, but the same bug class the plan already paid for once.

### 1.4 The rule, stated

```
needsBase(r)     := r.layer === 'topper'              // 100% precision, 99.9% recall
selfSufficient(r) := r.layer === 'integral'           // "integrated base"
isBase(r)        := r.layer === 'base'                // a base IS the product
isInsert(r)      := r.layer === 'insert'              // never on the grid
bottomLocks(r)   := locks from `connection|<sys>` tags with no position segment
sideLocks(r)     := locks from `connection|side|<sys>` tags
```

One honesty note on vocabulary. For a floor, `selfSufficient` really does mean "the base plate
is part of this mesh". For a wall or a column it means "the OpenLOCK/DragonLock/magnet footer
is part of this mesh". For a roof panel it means "clips to what is under it". These are one
thing mechanically — *you print this and nothing else* — and three things descriptively. The
UI should say **"needs a base" / "no base needed"**, which is what the data supports, rather
than "integrated base", which over-claims for two thirds of the cases.

---

## 2. The aggregation key

### 2.1 The existing key already works

`pipeline/design.ts` hashes the tag set with the whole `connection|` namespace removed:
**3,822 groups, 2.28 files each.** Since base-integrated and base-less variants of one design
differ *only* in connection, the key groups them by construction. Verified by listing real
groups:

```
design d80747dfd86cb — "Dungeon Stone Convex Curved Wall 2r90" (5 files)
  [topper  ] openforge             .../wall/openforge/dungeon_stone#curved+convex,wall.2r90°.openforge.stl
  [topper  ] openforge+side        .../wall/openforge/side/…openforge,side.stl
  [topper  ] openforge+dragonlock  .../wall/openforge/dragonlock,side/…openforge,side+dragonlock.stl
  [integral] openlock              .../wall/openlock/dungeon_stone#curved+convex,wall.2r90°.openlock.stl
  [integral] openlock+side         .../wall/openlock/side/…openlock,side.stl
```

### 2.2 Group-size distribution

| Files in group | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 12 | 13 | 16 | 18 | 20 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Aggregates | 2,117 | 736 | 246 | 149 | 271 | 64 | 88 | 57 | 56 | 15 | 9 | 8 | 4 | 1 | 1 |

55.4% are singletons; the largest holds 20 files.

### 2.3 Aggregate classes

| Class | Aggregates | Share |
| --- | ---: | ---: |
| topper-only — always needs a base | 2,137 | 55.9% |
| **both — the pair the owner asked to merge** | **931** | **24.4%** |
| base-only — a base *is* the product | 340 | 8.9% |
| integrated-only — never needs a base | 320 | 8.4% |
| insert-only — never on the grid | 94 | 2.5% |

`base` never shares a group with anything else: `shape|base` is in the key, so a base is always
its own design. That is the right answer — a base is a separately printed part with its own
purchase decision — and it means aggregation does *not* merge a base into the tile it supports.
Only 24.4% of aggregates are the two-sided merge; the other three quarters are single-sided and
the aggregate model still describes them, it just has one variant class to offer.

### 2.4 The key is lossless for every facet except connection

Aggregates holding two or more distinct values of each field:

| Field | Aggregates with 2+ values |
| --- | ---: |
| `texture`, `build`, `kinds`, `sizeCode`, `rotStep`, `foot`, `name` | **0 (0.0%)** |
| `sprite` | 1 (0.0%) |
| `config` | 828 (21.7%) |
| `layer` | 931 (24.4%) |
| bottom lock | 1,290 (33.8%) |
| `conn` (flattened) | 1,565 (40.9%) |
| `family` | 1,589 (41.6%) |
| `bytes` | 1,669 (43.7%) |
| `blob` | 1,680 (44.0%) |

This is the strongest result in the document. Every facet the sidebar renders — kinds, texture,
build — is constant inside an aggregate, and so is the synthesised display name and the
footprint the builder places. **Aggregation needs no new title logic, no facet re-derivation and
no footprint reconciliation.** What varies is exactly the connection axis plus the per-file
consequences of it (`layer`, `bytes`, `blob`, `family`, `config`).

### 2.5 Alternatives measured, and rejected

| Key | Groups | Files/group | Mixed topper+integral | Max group | Singletons |
| --- | ---: | ---: | ---: | ---: | ---: |
| **A — collapse `connection` (current)** | **3,822** | **2.28** | **931** | 20 | 2,117 |
| B — collapse `connection` + `build` | 3,804 | 2.29 | 931 | 20 | 2,099 |
| C — collapse `connection` + `size\|openlock` | 3,820 | 2.28 | 931 | 22 | 2,117 |
| D — B and C together | 3,802 | 2.29 | 931 | 22 | 2,099 |

**All four produce the same 931 merges**, so nothing looser buys a single extra pair. B's 18
extra merges are actively wrong: they join `build|separate wall` to `build|wall on tile`, e.g.

```
[topper  ] separate wall  tiles/rough_stone+ruined/separate_wall/primary_wall/wall/openforge/rough_stone+ruined#wall+low.IA.openforge.stl
[integral] separate wall  tiles/rough_stone+ruined/separate_wall/primary_wall/wall/openlock/rough_stone+ruined#wall+low.IA.openlock.stl
[topper  ] wall on tile   tiles/rough_stone+ruined/wall_on_tile/wall/wall/rough_stone+ruined#wall+low.1x.openforge.stl
```

The third is a different product — the wall fused to a floor tile — and the plan already
forbids joining on the build tag. **Keep key A unchanged.**

None of the four keys ever mixes two footprints, textures or kind sets in one group, and none
ever mixes a base with a non-base. That is a property of the corpus, not of the key, and it is
worth a regression test.

### 2.6 Where key A under-groups, honestly

**142 display names are shared by 354 aggregates (9.3%).** For comparison, 6,752 *files* share
a name with another file today, so aggregation cuts visible duplication by roughly 19× — the
worst single query result drops from 24 identical-looking cards (`Wood Lintel Square`) to 6.
The residue splits by which namespace distinguishes the groups:

| Distinguishing namespace | Groups | Verdict |
| --- | ---: | --- |
| `interface` | 43 | mixed — see below |
| `size` | 35 | legitimate distinction, name-synthesis gap |
| `build` | 18 | legitimate — `wall on tile` vs `separate wall` |
| `build` + `shape` | 16 | legitimate |
| `component` | 9 | legitimate (`wall\|ground` vs `wall\|upper`) |
| `texture` | 8 | legitimate (`stone_brick` vs `stucco` chimneys) |
| `shape` | 6 | legitimate (`corner\|full-low-full` vs `full-full-low`) |
| others (`interface`+`shape`, `shape`+`size`, …) | 7 | mixed |

**`interface|` is a second joinery namespace the key does not collapse, and it should not be
collapsed blindly.** The six `Cut Stone Secret Door Wall 2x A` aggregates are one design split
six ways by it:

```
d552610de5125  …A.top,magnetic_imperial.stl    interface|secret_door|top    interface|secret_door|magnetic|imperial
d092e4831a59e  …A.top,magnetic_metric.stl      interface|secret_door|top    interface|secret_door|magnetic|metric
d9721d644da59  …A.top.stl                      interface|secret_door|top    interface|secret_door|mechanical
d70a3a9cbf3b7  …A.bottom,openforge,…imperial   interface|secret_door|bottom interface|secret_door|magnetic|imperial
d5d9ec30f83c6  …A.bottom,openforge,…metric     interface|secret_door|bottom interface|secret_door|magnetic|metric
dbadc7f7cc93e  …A.bottom,openforge.stl         interface|secret_door|bottom interface|secret_door|mechanical
```

Those *are* connection variants wearing another namespace's clothes. But the same namespace
also carries pure size — `interface|dormer|window_insert|2x` through `|6x`, four different
dormer inserts — so collapsing `interface|` would merge four real products into one. **Leave
`interface|` alone in v1 and record it as the known limit:** roughly 47 duplicate-name groups
are aggregation misses caused by joinery filed outside `connection|`. Fixing it is a fixture
change (move secret-door joinery into `connection|`), not a key change.

### 2.7 Where key A over-groups — genuine bad merges

**182 aggregates (4.8%) hold two or more files that are identical on every connection axis
(needsBase, bottom lock, side lock, modifier) yet are distinct meshes** — 423 such groups,
969 files. These are cases where the card genuinely stands for several different objects:

```
"Plain Base 1x1"          0.22 MB  plain#base,thick_wall.1x1.magnetic+flex,openlock+topless.stl
                          0.03 MB  plain#base,thick_wall.1x1.openlock+topless,magnetic+flex.stl
"Aztlan Idol Treasure"    6.83 MB  treasure_bits#idol_1+13mm.stl
                          7.24 MB  treasure_bits#idol_2+13mm.stl
                          7.00 MB  treasure_bits#idol_3+13mm.stl
"Tudor Arched Door"     8 distinct meshes across tudor#door+narrow.stl / tudor#corner,door+narrow.stl
```

Note the first pair: the same two connection systems listed in reverse order in the filename,
identical tag sets, and a 7× byte difference. **These are pre-existing corpus problems that
aggregation makes visible rather than creates** — today they render as several
indistinguishable cards. For contrast, only 25 tie groups are the same blob under two catalog
paths, the harmless case. The escape hatch in §7 is what covers the 4.8%.

---

## 3. What a typical aggregate carries

Defining a **variant** as the tuple `(needsBase, bottomLocks, sideLocks)`:

| Distinct variants | Aggregates | Share |
| ---: | ---: | ---: |
| 1 | 2,237 | 58.5% |
| 2 | 787 | 20.6% |
| 3 | 147 | 3.8% |
| 4 | 127 | 3.3% |
| 5 | 524 | 13.7% |

1.18 files per variant. **566 aggregates (14.8%) hold a tie** — two or more files on the same
variant tuple — and what distinguishes tied files is the print modifier: `<none>` 1,047,
`flex` 381, `unsupported` 305, `flex+topless` 279, `flex+unsupported` 112, `topless` 102.

```
"Plain Angled Base 2x"   variant (self, openlock, —)
    0.03 MB  topless      plain#base+angled.2x+60°.openlock+topless.stl
    0.04 MB  unsupported  plain#base+angled.2x+60°.openlock+unsupported.stl
    0.10 MB  —            plain#base+angled.2x+60°.openlock.stl
```

So the variant axis is **three-dimensional, not one**: lock system, side connector, print
option. `topless` (no top surface) and `unsupported` (geometry reworked to print without
supports) are different *products*, not cheaper prints of one product, and §5 has to choose
between them deliberately.

### 3.1 Per-lock coverage — the number the builder's fallback hangs on

Three tiers, each strictly containing the previous:

| Lock | tier 1: integrated variant offers it | tier 2: + a matched base carries it | tier 3: + *some* base, wrong system | unreachable |
| --- | ---: | ---: | ---: | ---: |
| **openlock** | 1,497 (39.2%) | **3,375 (88.3%)** | 3,375 (88.3%) | 447 (11.7%) |
| **dragonlock** | 359 (9.4%) | **3,118 (81.6%)** | 3,118 (81.6%) | 704 (18.4%) |
| **magnetic** | 255 (6.7%) | **3,008 (78.7%)** | 3,020 (79.0%) | 814 (21.3%) |

> **This table has moved twice since it was written, and the movement is worth more than the
> numbers.** As researched it read 3,199 / 2,928 / 2,818 (83.7 / 76.6 / 73.7); row A1 measured
> 3,352 / 3,087 / 2,977; row A7 measures the figures above and confirmed them
> definition-independent — three separate readings of "buildable" return them exactly.
>
> **The fixtures never changed.** It is the same pinned commit throughout. *The pipeline*
> changed underneath: rows W3 and W4 gave 403 and then 249 more tiles a usable footprint, so
> more toppers resolve a congruent base, and every one of those gains lands in tier 2. Row W7
> now guards these figures in the verifier for exactly this reason.

- tier 1 = a self-sufficient variant — `integral` or `base` — carries that lock on its own
  bottom: print one part, done. (Bases are included because a base needs no base; that is why
  tier 1's 1,497 exceeds the 1,251 integral-bearing aggregates.)
- tier 2 = tier 1, or a topper variant whose matched base family contains a base carrying it.
- tier 3 = tier 2, or a topper that gets a base in *another* system — a defect the bill flags.

**Tier-2 spread is 9.6 percentage points.** Compare §2's per-design figure of 40.2 pp
(openlock 99.9% / dragonlock 74.7% / magnetic 59.7%), which this script reproduces exactly on
the same 3,822 groups. The two are different questions and both are correct:

- §2 asks *does this design mention that lock, or no lock at all* — and counts a lock-less
  design as reachable.
- Tier 2 asks *can the builder hand you a printable assembly in that system* — which requires
  an actual resolution, and which the auto-inserted base satisfies for a design that mentions
  no lock at all.

The direction of travel is the interesting part: **openlock falls (99.9% → 88.3%) because
tier 2 refuses to count designs it cannot actually resolve, and magnetic rises (59.7% → 78.7%)
because the base fallback supplies magnetic where the tile itself has none.** Aggregation plus
auto-base is what turns a 40-point penalty for choosing magnetic into a ten-point one. That is
the argument for building this. (Using bottom-position locks under §2's own definition gives
100.0 / 70.2 / 67.5, a 32.5 pp spread — so roughly a fifth of the narrowing is the positional
fix and the rest is the base fallback.)

**622 aggregates (16.3%) are unreachable under every lock system**: 435 topper-only, 94
insert-only (correctly excluded from the grid anyway), 93 integrated-only with no lock tag
(the data gap in §1.3). The topper-only 435 are dominated by `wall_on_tile` curved pieces with
`foot: none` and no size code — the 444 `base-unmatchable` records the resolver already names.

### 3.2 Which lock a base can be, for the aggregates that need one

Of the 3,068 aggregates with a topper variant (2,137 topper-only plus the 931 merged pairs):

| Lock systems available among the candidate bases | Aggregates |
| --- | ---: |
| all three (openlock + dragonlock + magnetic) | 2,561 |
| dragonlock + openlock | 12 |
| magnetic + openlock | 2 |
| **no base at all** | **493** |

Median candidate-base-set size 86, max 134. **2,561 of the 2,575 topper aggregates that get a base at all (99.5%), i.e. 83.5% of all
3,068, can get one in all three systems**, which is why the tag vocabulary in §4 must not be built out of
per-lock base availability — the chip would be true for nearly everything and mean nothing.

---

## 4. What the aggregate should show

### 4.1 What the chips must not be

The obvious vocabulary — one chip per lock system — was measured and is useless. "Available in
openlock" would sit on 2,575 aggregates (67.4%), dragonlock on 2,573 (67.3%), magnetic on
2,563 (67.1%). Three chips, nearly identical populations, because the base families are
system-complete. A chip that is true for two thirds of the catalog and whose siblings are true
for the same two thirds discriminates nothing.

### 4.2 What the user actually needs to know

The question a browsing user has is not "which locks exist somewhere in this family" — it is
**"what do I have to print, and does my chosen system get it without a base?"** Three facts
answer it, and each is genuinely discriminating:

| Chip | Aggregates | Share | Meaning |
| --- | ---: | ---: | --- |
| `no base needed · openlock` | 1,497 | 39.2% | one part, openlock underneath (includes base-only items) |
| `base required` | 2,137 | 55.9% | topper-only: always two parts |
| `either way` | 931 | 24.4% | both variants exist — the merged pair |
| `side · openlock` | 848 | 22.2% | joins neighbours with openlock |
| `side · dragonlock` | 468 | 12.2% | |
| `no base needed · dragonlock` | 359 | 9.4% | |
| `is a base` | 340 | 8.9% | this item *is* the base |
| `no base needed · magnetic` | 255 | 6.7% | |
| `is an insert` | 94 | 2.5% | fits into another piece, not the grid |
| `joinery untagged` | 93 | 2.4% | §1.3's data gap, surfaced not hidden |

Chips per aggregate under this vocabulary: 1 chip on 728, 2 on 134, 3 on 160, 4 on 1,696, 5 on
492, 6 on 271, 7 on 341. The mode of four is `base required` plus three side/other chips, which
is one row on a card.

### 4.3 How this differs from today's per-file `conn` chips

Today a card shows `record.conn`: a position-flattened list of raw systems. Three changes:

1. **Position is restored.** `openforge, dragonlock` becomes `base required` + `side ·
   dragonlock`, which is what the file physically is. Today's chip invites the reading "this
   tile does dragonlock", and for all 1,283 side-lock toppers that reading is wrong.
2. **The chip answers a build question, not a tag question.** `base required` is derived from
   the layer, not printed from a tag.
3. **`openforge` stops being a user-facing word.** It is the project's own connector and it
   means "incomplete on its own" — the opposite of what a flagship brand name suggests to a
   newcomer. §2 warns against fusing build and connection because it would make openforge
   unreachable; this proposal keeps it reachable as a filter and stops *displaying* it as a
   feature.

**Inference, not measurement:** that the three-chip vocabulary reads better than the current
one is a design judgement. What is measured is that the per-lock alternative does not
discriminate and that the flattened field misstates 1,283 records.

---

## 5. Resolution at download time

### 5.1 Types

```ts
/** One resolvable way to print an aggregate. */
export interface TileVariant {
  /** The concrete file. Still the primary key — see §6. */
  readonly id: TileId
  readonly ord: ManifestOrdinal
  readonly blob: BlobId
  readonly bytes: number
  /** `true` when a base must be auto-inserted alongside this file. */
  readonly needsBase: boolean
  /**
   * Lock systems on this file's OWN bottom face — never side locks.
   * Empty for every topper (measured: 0 of 4,363 toppers carry a bottom lock)
   * and for 119 integral records that publish none.
   */
  readonly bottomLocks: readonly LockSystem[]
  /** Lock systems on `connection|side|*`. Neighbour joinery, not table joinery. */
  readonly sideLocks: readonly LockSystem[]
  /**
   * Print options from the third connection segment: `topless`, `unsupported`,
   * `flex`, `filament`, `split`, `pegs`. These are different PRODUCTS, not
   * cheaper prints — 566 aggregates (14.8%) are distinguished only by these.
   */
  readonly options: readonly string[]
}

/** One catalog item. 3,822 of them over 8,702 files. */
export interface TileAggregate {
  /** `CatalogRecord.design` — the connection-collapsed tag hash. */
  readonly design: DesignId
  /**
   * Stable address for URLs and the library: the LOWEST manifest ordinal in the
   * group. Not a new ordinal space — see §6.2 for why, and for the one case
   * where it is not stable.
   */
  readonly ord: ManifestOrdinal
  /**
   * Facets, hoisted because they are provably constant across the group:
   * 0 of 3,822 aggregates hold two distinct values of any of these (§2.4).
   */
  readonly name: string
  readonly kinds: readonly string[]
  readonly texture: string | undefined
  readonly build: string | undefined
  readonly foot: Footprint
  readonly sizeCode: string | undefined
  readonly rotStep: number | undefined
  /** Every file in the group, ordered as §5.2 ranks them. */
  readonly variants: readonly TileVariant[]
  /** Precomputed per-lock verdicts, so the palette can grey out without resolving. */
  readonly reach: Readonly<Record<LockSystem, 'integrated' | 'with-base' | 'mismatched' | 'none'>>
  /** Byte range across variants — 42.2% of multi-file aggregates spread >1.25x (§7). */
  readonly bytesRange: readonly [min: number, max: number]
}
```

`reach` is derivable but should be precomputed at import: it needs the base index, and the
palette asks the question once per visible card per lock change.

### 5.2 The algorithm

```
resolveAggregate(agg, lock, options) -> Resolution

  // 1. Prefer one part over two. This is the whole point of the merge.
  integrated := agg.variants where !needsBase and lock in bottomLocks
  if integrated is non-empty:
      pick := rank(integrated)
      return { parts: [pick], verdict: 'integrated' }
      // reaches 1,497 aggregates on openlock, 359 dragonlock, 255 magnetic

  // 2. No integrated variant in this system: fall back to topper + base,
  //    which is exactly what resolvePlacement already does.
  toppers := agg.variants where needsBase
  if toppers is non-empty:
      pick := rank(toppers)                       // prefer sideLocks containing `lock`
      base := matchBase(pick, index, lock)        // src/assembly/resolve.ts, unchanged
      if base exists and lock in base.bottomLocks:
          return { parts: [pick, base], verdict: 'with-base',
                   notes: ['base-auto-inserted'] }
          // tier 2 minus tier 1: +1,702 openlock, +2,569 dragonlock, +2,563 magnetic
      if base exists:
          return { parts: [pick, base], verdict: 'mismatched',
                   notes: ['base-auto-inserted', 'base-lock-mismatch'] }
          // 0 aggregates on openlock, 2 on dragonlock, 12 on magnetic
      // FAILURE A — no base exists at all: 493 topper aggregates.
      //   Sub-classified by resolve.ts' three existing codes, which must be kept
      //   distinct because the remedies differ:
      //     no-matching-base   (129 files) a base the corpus should have
      //     no-congruent-base   (21 files) thin strips nothing supports
      //     base-unmatchable   (444 files) neither a code nor a footprint
      return { parts: [pick], verdict: 'no-base', notes: [thatCode] }

  // 3. An integrated variant exists but not in this lock system.
  //    Physically incompatible with the rest of the build.
  selfSufficient := agg.variants where !needsBase and bottomLocks is non-empty
  if selfSufficient is non-empty:
      pick := rank(selfSufficient)
      return { parts: [pick], verdict: 'wrong-system',
               notes: ['lock-unavailable'] }
      // FAILURE B. e.g. a dragonlock-only stair in an openlock build. It will
      // not clip to its neighbours; §7's rule is that this informs and never
      // refuses the placement.

  // 4. No joinery information anywhere.
  //    FAILURE C — 93 aggregates (2.4%), the §1.3 data gap: filename names a
  //    magnet spec, tags name nothing. Report as unknown, not as incompatible.
  return { parts: [rank(agg.variants)], verdict: 'unknown-joinery',
           notes: ['joinery-untagged'] }

  // FAILURE D — the aggregate is insert-only (94) or its foot is `none`.
  //   Caught before this function: an insert is never on the grid, and a
  //   `none` footprint is never in the palette (§2, 1,144 files).
  // FAILURE E — the design id is not in this catalog build. The placement
  //   stores a TileId, so this is resolvePlacement's existing `unknown-tile`
  //   note and is unchanged by aggregation.
```

### 5.3 `rank(variants)` — and the bug the current tie-break has

`rank` must not be "smallest file". `assemblyIndex.ts` sorts base candidates `bytes` ascending
then `id`, and `matchBase` keeps the first candidate at the best score, so **the smallest file
wins every tie**. Running the resolver as it stands over all 4,363 toppers:

| Lock preference | Bases matched | Chosen base carries `topless` | carries `unsupported` | lock honoured |
| --- | ---: | ---: | ---: | ---: |
| openlock | 3,769 | **2,983 (79.1%)** | 164 (4.4%) | 100.0% |
| dragonlock | 3,769 | 3 (0.1%) | 156 (4.1%) | 99.9% |
| magnetic | 3,769 | 1,622 (43.0%) | 27 (0.7%) | 99.6% |
| none | 3,769 | 2,630 (69.8%) | 320 (8.5%) | 100.0% |

**Under openlock, 79.1% of auto-inserted bases are `topless`** — a base with no top surface.
That is defensible (it saves filament under a solid tile) and it is *not being disclosed*; the
bill says "matched on sizeCode A" and never says "and it has no top". The tie-break is making
a product decision on the user's behalf. Two consequences:

1. `rank` should order on an explicit preference — plain > `unsupported` > `topless` unless the
   user asked otherwise — with bytes only as the final tie-break.
2. The bill must name the option: `base-option-chosen` alongside `base-auto-inserted`.

Two more measured facts about base selection, both worth surfacing: the chosen base changes
for **86.3% of toppers** between openlock and dragonlock (correct — lock is the heaviest
weight), and only **110 distinct bases of 1,963** are ever handed out under openlock (108
dragonlock, 107 magnetic). The base catalog is 18× larger than the set the resolver uses.

### 5.4 What the bill of tiles shows per case

| Verdict | Parts | Bill line count | Note codes |
| --- | ---: | ---: | --- |
| `integrated` | 1 | 1 | — |
| `with-base` | 2 | 2 | `base-auto-inserted` (+ `base-option-chosen`, `base-texture-mismatch`) |
| `mismatched` | 2 | 2 | + `base-lock-mismatch` |
| `no-base` | 1 | 1 | `no-matching-base` \| `no-congruent-base` \| `base-unmatchable` |
| `wrong-system` | 1 | 1 | `lock-unavailable` |
| `unknown-joinery` | 1 | 1 | `joinery-untagged` (new) |

`buildBillOfTiles` needs no structural change: it already dedupes on `blob`, already counts
parts separately from placements, and already rolls notes up per code. The only additions are
two note codes and a `variant` field on the line so the drawer can say which file it picked.

---

## 6. What breaks

### 6.1 Counts, facets and search

| Surface | Today | Aggregated | Note |
| --- | ---: | ---: | --- |
| Catalog items | 8,702 | 3,822 | −56.1% |
| Search documents | 8,702 | 3,822 | internal numbering, no URL exposure |
| Worst duplicate-name result | 24 cards | 6 cards | `Wood Lintel Square` → `Cut Stone Secret Door Wall 2x A` |
| Corpus size headline | 108.0 GB | 52.5–57.1 GB | smallest / largest variant per aggregate |

**Facet counts change, and non-uniformly.** Ratio of file count to aggregate count:

| Facet value | Files | Aggregates | Ratio |
| --- | ---: | ---: | ---: |
| kind `base` | 1,963 | 340 | 5.77 |
| conn `magnetic` | 1,159 | 255 | 4.55 |
| build `separate wall` | 3,351 | 826 | 4.06 |
| build `thick wall` | 591 | 162 | 3.65 |
| foot `arc` | 1,391 | 411 | 3.38 |
| kind `wall` | 4,881 | 1,690 | 2.89 |
| conn `openlock` | 3,965 | 1,790 | 2.22 |
| conn `openforge` | 4,363 | 3,068 | 1.42 |
| build `wall on tile` | 863 | 823 | 1.05 |
| conn `filament` | 114 | 114 | 1.00 |

**The sharpest problem is the connection facet, where one chip now has three defensible
numbers.** "magnetic" means:

- **1,159** — files carrying a magnetic tag (today's count)
- **255** — aggregates with a magnetic variant
- **2,818** — aggregates buildable in magnetic once the base fallback runs

All three are true. The third is the one the user is asking for, and it is the only one that is
not a straight count over a bitset — it needs the base index. **Recommendation:** keep the
connection facet as a count over aggregates (255) so the sidebar stays a bitset intersection,
and put the buildability number in the lock picker, which already exists and already states
reachable-design counts per §7. Do not put 2,818 in a sidebar chip; a facet whose count is not
the size of the result set it produces is the disjunctive-count bug in a new costume.

The `build` facet is unaffected in kind: it stays single-select with `BUILD_UNSPECIFIED`, and
`build` is constant per aggregate so the mapping is exact. `kinds` and `tex` likewise.

### 6.2 Ordinals and share links — the dangerous one

Ordinals today are **dense: 8,702 in use, 0…8,701.** The invariant in
`schema.ts#ManifestOrdinal` is append-only, and §13 names a silent reordering the worst
failure in the system.

**Aggregation must not mint aggregate ordinals into the shared manifest.** The reason is
structural, not stylistic. An aggregate is a *derived* grouping: its identity is a hash of a
tag set, and the tag set can change. If a fixture edit adds one tag to one file, that file
leaves its design and joins another — the aggregate's membership changes, and if a link
encoded an aggregate ordinal it would now decode to a group with different members. Worse, an
aggregate can *split* (a tag added to half its files) or *merge*, and neither is expressible in
an append-only array of ids. The manifest's whole enforcement mechanism is that the index *is*
the ordinal and rewriting is visible in review; a grouping that can split has no stable index
to be.

So the design is:

1. **`ManifestOrdinal` stays a per-file ordinal, unchanged.** `pipeline/ordinals.ts` and
   `manifest.json` are untouched. `version.manifest` is **not** bumped.
2. **`Placement.tileId` stays a `TileId`.** The store schema's own reasoning already says why —
   the file resolves from the placed tile plus the lock preference, so a saved scene stays
   correct when the preference changes. Aggregation makes the palette place an *aggregate*; the
   placement records **the variant the aggregate resolved to at placement time**, which is a
   real file with a real ordinal. **Every existing share link keeps decoding to the same room.**
   No migration, no version bump, no `store/migrations.ts` entry.
3. **`?tile=<ord>` drawer links keep working.** The URL carries a file ordinal; the drawer
   resolves ordinal → file → `record.design` → aggregate and opens the aggregate with that
   variant selected. Every link already in the wild lands on the right item, now with its
   siblings visible. This is strictly better than today, where such a link lands on one of up
   to 20 near-identical cards with no indication the others exist.
4. **`library: Record<TileId, true>` stays as it is**, grouped at render. A library holding 5
   openlock variants of one wall collapses to one card showing "5 variants", with no persisted
   state change and no migration.

The one thing that needs a decision: `TileAggregate.ord`, the aggregate's address for a
canonical URL. **The lowest manifest ordinal in the group** is the right choice, and its
stability properties must be stated precisely:

- **Stable under append** — new files get ordinals strictly above every issued one (rule 2), so
  a file joining an existing aggregate can never become its lowest.
- **Stable under a tag edit that does not move the lowest-ordinal file.**
- **NOT stable under retirement.** If the lowest-ordinal file leaves the corpus, the aggregate's
  address changes even though its ordinal set only shrank. **1,705 aggregates (44.6%) hold two
  or more files and are exposed to this.**
- **NOT stable under a design split**, where one aggregate becomes two and one of them keeps
  the old address.

That is acceptable *only because the aggregate ordinal never enters a share link* — it appears
in a canonical catalog URL, where a stale link degrading to "that item moved" is a normal web
outcome rather than a silently wrong room. **This distinction must be written into the type,**
because the two ordinal spaces would otherwise look interchangeable — which is exactly the
confusion `TagId`'s branding docblock already warns about. Brand it: `AggregateAddress`, not
`ManifestOrdinal`.

### 6.3 Everything else

- **`assemblyIndex` is unchanged.** It indexes bases by size code and footprint, and bases are
  never aggregated with anything.
- **`buildBillOfTiles` is unchanged** structurally (§5.4).
- **`family`** varies within 1,589 aggregates (41.6%) because the connection directory is part
  of the path. "Other variants of this tile" in the drawer currently keys on `family`; under
  aggregation it should key on the aggregate, which is a better answer, and `family` becomes
  the *outer* ring ("other sizes in this family").
- **`config`** varies within 828 aggregates (21.7%), because only 56.1% of toppers declare a
  base slot. The aggregate's composition slots must be the union with provenance, not a pick —
  a slot that exists on one variant and not another is a real difference.
- **Thumbnails and sprites.** 8,701 of 8,702 records have a sprite; one does not. The aggregate
  shows the selected variant's sprite, so the existing fallback still covers it. Sprite storage
  does not shrink — the drawer still shows per-variant previews.

---

## 7. Is this a good idea?

### 7.1 The case for

- The corpus is 8,702 files describing **3,822 designs**. A catalog that lists files lists the
  same wall up to 20 times, differing in a joinery detail the user has already decided globally.
  Today's worst query returns 24 cards with the same name.
- The lock-choice penalty drops from **40.2 pp to 10.0 pp** (§3.1). That is the difference
  between "picking magnetic hides two fifths of the catalog" and "picking magnetic costs you
  ten points against openlock".
- The key exists, is already computed, and is **lossless for every facet** (§2.4). This is a
  presentation-layer change over data the pipeline already emits.
- Ordinals and share links survive untouched (§6.2).

### 7.2 The case against — where aggregation misleads

**It hides that the variants are different prints, and the data cannot tell the user how
different.** Print time, filament volume, support requirement and whether the base is removable
are **not in the corpus at any resolution.** `bytes` measures mesh triangle count, which is a
download-size proxy and *not* a material proxy — a heavily textured thin wall outweighs a solid
plain base. Any card that renders one number for an aggregate is asserting something the data
does not contain.

What *is* measured, and it is not reassuring:

- Across 1,705 multi-file aggregates, max/min bytes ratio: median 1.13, **p90 3.47**, max
  39,401. **42.2% spread more than 1.25×; 19.1% more than 2×; 7.3% more than 5×.**
- Worst case: `Plain Wall Base 2x A` spans 0.01 MB (`openlock+topless`) to 0.99 MB
  (`dragonlock`) across 16 files — an 85× range behind one card.
- `Aztlan Wall Column T` holds a 0.00 MB file and a 3.31 MB file under one name.

**The topper-vs-integrated trade is not the trade people assume.** For the 931 merged pairs,
integrated-variant bytes over topper bytes: median **1.027**, p10 0.703, p90 1.517, min 0.172,
max 8.952. **27.4% of integrated variants are *smaller* than their topper.** Summing the
cheapest variant of each of the 873 resolvable pairs: 14.01 GB integrated-only against 13.45 GB
topper+base — the two-part route is *0.96×*, i.e. marginally smaller. So "print the integrated
one and save filament" is not supported; what the integrated route actually saves is **part
count** (1 per placement instead of 2), which is a real and different benefit — fewer prints,
fewer clips, fewer things to lose. The card should claim that and nothing more.

**It hides `topless`.** 79.1% of auto-inserted openlock bases have no top surface (§5.3). Under
aggregation the base is invisible *and* auto-chosen *and* topless, three layers of decision the
user never sees. This is the single strongest argument that aggregation must ship together with
better disclosure, not before it.

**4.8% of aggregates are genuinely several objects** (§2.7) — 182 aggregates, 969 files, where
nothing in the connection namespace distinguishes distinct meshes. For those the card is simply
wrong, and no amount of chip design fixes it.

**It costs the power user a real capability.** Someone printing `openlock+unsupported` because
their printer cannot bridge needs to reach that specific file. Today it is a card; after
aggregation it is behind a control.

### 7.3 The escape hatch

Three levels, cheapest first:

1. **A variants table in the detail drawer, always present, never collapsed for multi-variant
   items.** One row per file: filename, needs-base, bottom lock, side lock, print options,
   bytes, and a direct download. This is the entire fix for the power-user objection and for
   the 4.8%; it costs one component. It must not be an accordion that defaults shut — 44.6% of
   aggregates have something in it, and hiding it is how the 79.1%-topless problem got created.
2. **A byte *range*, never a single figure**, on any card with a >1.25× spread (42.2% of
   multi-file aggregates), with a tooltip stating that bytes are mesh complexity and not
   filament. Do not invent a print-time estimate; nothing in the corpus supports one.
3. **An "all files" toggle on the catalog**, restoring the 8,702-item view. Cheap because it is
   the existing index, and it is the answer to "I know the exact file I want". It also gives an
   honest migration path: ship aggregation as the default with the flat view one click away,
   and see whether anyone clicks.

### 7.4 Verdict

**Do it.** The key is already computed, the collapse is lossless for every facet, ordinals and
share links are untouched, and it turns a 40-point lock penalty into a 10-point one. But ship
it with the variants table in the same PR, and fix the `rank` tie-break first — aggregation
without disclosure would take a resolver that quietly hands out topless bases and remove the
last place a user could have noticed.

Two things should be fixed **before** aggregation, because aggregation depends on them:

1. **The positional connection projection.** `record.conn` cannot express "bottom lock", and
   0 of 4,363 toppers carry one. Building the aggregate on the flattened field would advertise
   a bottom joinery that 1,283 records do not have.
2. **`CONNECTION_POSITIONS`** must gain `bottom`, `left` and `right`, which today produce three
   phantom systems over 8 records.

And one thing should be fixed **in the fixtures**, not in the app: the secret-door and
magnet-spec joinery filed under `interface|` rather than `connection|` (§2.6), which is what
splits roughly 47 duplicate-name groups that ought to be single aggregates.

---

## Appendix — reproducing these figures

Measured against `dist/catalog/catalog.json` (equivalently `public/catalog/catalog.json`),
built by `npm run import:catalog` from fixtures commit `4282896`. The scripts live in the
scratchpad and are not checked in; the definitions each figure depends on are stated inline
above, in the style `docs/verify-catalog-facts.py` established, so that any of them can be
re-derived from the emitted index alone. The load-bearing definitions:

- **needs a base** = `layer === 'topper'` = carries `connection|openforge`.
- **bottom lock** = a lock system in segment 1 of a `connection|` tag whose segment 1 is not a
  position. **side lock** = segment 2 of `connection|side|…`.
- **aggregate** = `CatalogRecord.design`, i.e. the SHA-256 prefix of the sorted tag set with
  `connection|*` removed.
- **tier 2 reachable** = an integrated variant with that bottom lock, **or** a topper variant
  for which `matchBase` (size code first, footprint fallback, never both) returns a base whose
  bottom locks include it.
- **variant** = the tuple `(needsBase, bottomLocks, sideLocks)`; **tie** = two files sharing one.

Before this is implemented, the figures in §3.1 and §5.3 should be moved into
`verify-catalog-facts.py` or an `aggregate.test.ts` corpus suite, so they fail the build when
they drift. Every number in this document was reproducible on 2026-09-01 and none of them is
protected by a test yet.
