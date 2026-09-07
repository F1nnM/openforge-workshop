# Tile sizing — what the tags say, what the meshes are, and where they disagree

Everything this project has measured about how big a tile is. Written after a
**corner wall tagged two units measured one and a half**, which turned out to be a
whole class rather than a curiosity, and which invalidated a footprint every rule
downstream had trusted.

**The rule this document exists to enforce: a size tag is a claim, not a measurement.**
Four rows in a row were bitten by treating one as the other.

---

## 1. Units, and the instrument

**One grid unit is 25.4 mm** — an inch. Every figure below in "units" is millimetres over 25.4.

A mesh is measured by reading its binary STL whole and taking axis-aligned bounds over
every facet. Binary STL is exactly `84 + 50n` bytes, which is also the check that a file
*is* one. The objects live at `https://objects.openforge.tools/models/{md5[0:6]}/{md5}.stl`
and **egress is free**, so measuring is cheap in money and costs only wall-clock: a median
file is 10.36 MB, and 157 corner walls came to ~2.3 GB in a few minutes.

**The instrument is calibrated.** Straight walls carrying the openlock codes
`IA` / `BA` / `A` / `D` / `Q` are tagged 1 / 1.5 / 2 / 3 / 4 and measure
**1.000 / 1.500 / 2.000 / 3.000 / 4.000** exactly. So where a measurement disagrees with a
tag, the disagreement is real.

### What is already measured, and what is not

`tools/measure/measurements.json` holds **1,163 blobs**, covering **1,284 of 8,702 records
(14.8%)**. Row W1 produced it: 11.05 GB read in 33 minutes. **Nothing under `src/**` reads
it** — it is a dev-time sidecar, so no runtime path can depend on a measurement.

**The 245 corner walls were not in it**, which is why three rows in a row concluded the
question was unanswerable. It was answerable; the sidecar simply had a gap.

---

## 2. The corner wall: a tag that names the cell, not the piece

The finding that prompted this document.

| class | records | tagged width | **measured run** |
| --- | ---: | ---: | --- |
| chirality (`shape\|corner\|left`/`right`) + code `A` | 224 | 2 | **1.500 – 1.513** (93 designs) |
| corner, no chirality, code `A` | 21 | 2 | **1.500 – 1.518** |
| corner, no chirality, code `BA` | 6 | 1.5 | **1.500** |
| `grate+widened.2x2` (width **and** depth tagged) | 21 | 2 × 2 | **2.000 × 2.000** |
| `shape\|corner\|wall` L-pieces | 36 | 1 / 2 / 3 / 4 | tagged size in **both** axes |
| the L corner column | — | `size\|column_shape\|L` | **0.499 × 0.500** |
| a modular wall for comparison | 1.5 | **1.500** |

**So `size|width|2` on a corner wall names the cell the piece belongs to, and the run is
1.5.** One and a half plus the column's half is exactly two: the piece fits its face
precisely, and the "single piece" and "modular" corner recipes describe *the same geometry*,
differing only in how many prints it takes.

### Three traps in that table

- **The rule is gated on the tagged width being 2.** The six `BA` corner walls are tagged
  1.5 and measure 1.5. A general rule — *"a corner wall loses the column's span"* — would
  have written **1.0** for those and been measurably wrong.
- **The 21 `grate+widened.2x2` records are genuinely whole-cell.** They carry a *depth* tag
  as well, and the depth tag is what separates the two classes.
- **There are two different sets of 21.** Twenty-one corner walls with no chirality tag
  (which measure 1.5) and twenty-one widened grates (which measure 2 × 2). Conflating them
  was an error made once already.

### What the bad footprint cost

`foot` is **derived from the tags**, so these records carried `{shape: 'wall', length: 2}`
while the mesh is 1.5. Every rule downstream inherited it:

- **collision and the footprint plate were half a unit too wide** on 245 records;
- the layout's over-run doubt was a **phantom**, comparing a real 1.5 face-allowance
  against a fictional 2-unit wall;
- **eight corner recipes reported failure** and drew their parts stacked.

Corrected, the corpus closure moved **1,006 / 33 / 176 → 1,014 / 25 / 176** (82.8% → 83.5%),
the external corner went **26 closing / 8 failing → 34 / 0**, and all **40 of 40** shipped
recipes now raise no doubt. Both corner recipes tile a clean L — column `[0, 0.5]²`, right
wall `x ∈ [0.5, 2.0]`, left wall `z ∈ [0.5, 2.0]` — with no overlap and no gap, union
exactly the cell, **area 4.00 at every quarter turn**.

---

## 3. How a size is resolved

A record's grid size resolves through a chain, and **`foot` is not independent evidence** —
it is derived from the same tags (exact on 3,449 of 3,449 rect records). Its value is
corrections and refusals, not corroboration.

1. **the footprint's own extent**
2. **`size|column_shape`** — recovers the 14 `col+T` records whose placement primitive is
   unmeasured. Without this rung the chain reaches 8,370 rather than 8,384: **a refused
   primitive is not a refused size.**
3. **the tagged `size|width` / `size|depth` pair**

**`sizeCode` is dead as a resolution rung: it resolves 0 records.** Not one of the
unresolved records carries any `size|openlock` code. It is not a corrector either.

**Reach: 8,384 of 8,702 records (96.3%).** The 318 that do not resolve are enumerated, not
rounded: **234 inserts** (correct — an insert has no grid size), **26 decor**, **56 hex and
120-degree pieces carrying only `size|angle`**, and **2 `wot` walls**. **No floor is among
them**, under any of the four ways of asking what a floor is.

### The footprint's 84 corrections

All on the same `curved_interface`, in three equal groups:

| code | tagged | measured | error |
| --- | ---: | ---: | ---: |
| `AxG` | 2 | 1.991 | 0.009 |
| `BAxG` | 1.5 | 1.547 | 0.047 |
| `QxG` | 4 | 3.000 | **1.000** |

**Only 28 are wrong by a whole unit.** The other 56 snap back to their tagged value, and
reading them as corrections would give 56 walls a size no slot can ask for.

---

## 4. What sizes the corpus actually contains

**37 distinct rect dimension pairs.** By record count: 2×2 (885), 1×1 (500), 2×1 (395),
4×4 (313), 4×1 (274), 3×1 (219), 3×3 (211), 4×2 (183), 2×4 (97), 6×6 (57), then a long tail.

**Half-unit sizes exist and a predicate that admits only integers loses them:** 2×0.5 (14),
1×0.5 (3), 1.5×1.5 (2).

**`size|width` has 13 values and two of them are not widths.** `wot` (50 records) and `sw`
(33) are **build markers**: all 50 `wot` sit under `wall_on_tile`, and all 83 have no
`build` tag of their own. `size|depth` has 12 values, all numeric.

**Floors by size**, and how many the 40 shipped recipes reach:

| size | files | designs | reached |
| --- | ---: | ---: | ---: |
| 2×2 | 474 | 375 | 85 |
| 4×4 | 230 | 176 | 17 |
| 4×2 | 112 | 78 | 17 |
| 1×1 | 100 | 69 | 18 |
| 3×3 | 100 | 71 | 15 |
| 8×8 | 75 | 53 | 0 |
| 6×6 | 70 | 45 | 0 |
| *no size pair* | 97 | 44 | 0 |

### What a slot can name

- **7,590 records (87.2%) have a cell** a slot can predicate on; **6,661 (76.5%) have a run**.
- The 794 gap is **645 sub-90-degree sectors** (their bounding box is irrational), **121
  diagonals**, and **28 depth-only** records. The **554 sectors at exactly 90 degrees keep
  their cell**, 554 of 554 on the lattice.
- **48 distinct cells and 10 distinct runs.** 25 of the 48 carry a half unit. `2.5×2.5`
  (203) and `4.5×4.5` (87) exist *only* because the quarter sectors keep theirs.
- **16 of 295 cells cannot be spelled as tags**: 12 are 90-degree sectors (the cell comes
  from geometry and the tags are silent), 3 are 0.5 columns (**there is no
  `size|width|0.5`**), and 1 is the `QxG` 3×0.5. Of the 48, `0.5×0.5` and `4.5×4.5` are
  inexpressible and no rect record resolves to either.

---

## 5. The lattice, and its tolerance

**Slot offsets land on multiples of 0.25**, off the builder's 0.5 snap step. Four distinct
insets occur — `{-1.25, -0.75, -0.25, 0}` — and **three of the four are off the half-unit
step**. So **the instance origin snaps and a slot offset never does.**

**The snapping tolerance is bracketed from both sides**, with a gap factor of 1.8:

- the **largest** deviation that must snap: **0.047** (`BAxG`)
- the **smallest** that must not: **0.0858** (the 45-degree sector `1.5-2@45`)

Both bounds are asserted, so a tolerance chosen inside that gap is provably safe and one
outside it provably breaks a real record.

**Rotation:** only **10 of 128** shipped template parts admit a candidate with a
non-90-degree rotation step — the diagonal walls, 379 files. Everything else turns in
quarters.

**Elevation is normalised and never read from a file.** Of 343 measured bases, every one is
authored on z = 0 and **279 (81.3%) sit within 0.015 mm of 6.000 mm**; 295 are below 6.1 mm
and the remaining 48 sit twelve each at 12.70 / 25.40 / 38.10 / 50.80. Meanwhile **107 of
583 measured toppers (18.4%) are authored already one base thickness up**, at a median of
exactly 6.0000 mm, and 77.5% are not. A height read from a file is therefore **not
comparable across records**, which is why there is exactly one elevation source and it is a
constant.

---

## 6. Size as a slot parameter, not part of a family key

**This is the difference between 52 template families and several hundred.**

Keyed on `(role, size, build)` the corpus needs **285** families — 111 to reach 90% coverage,
with **50 singletons**. With size as a *parameter* of the slot predicate, `(role, form, build)`
needs **52**.

That 285 does not reproduce under any spelling of the key — `(role, cell, build)` gives
**217**, `(role, footprint, build)` **277**, `(role, sizeToken, build)` **249** — but every
reading is 4.2× to 5.3× the 52, so the *conclusion* is confirmed three times over and only
the arithmetic was wrong. **The 50 singletons do reproduce.**

### What the shipped control offers

**47 generated families, 304 size positions**, a median of 4 cells and a maximum of 31 — a
control, not a dropdown. **A control renders for 40 of the 47.**

**Seven families offer no size position**, and for two different reasons, which is worth
keeping straight:

- **five have no resolvable cell at all** — `wall|diagonal|separate wall` (121 records),
  `wall|hex|thick wall` (56), `decor|straight` (26), `wall|octagon|separate wall` (20),
  `floor|octagon` (8);
- **the rest have cells that exist geometrically and cannot be spelled as tags** —
  the 90-degree sectors and the half-unit columns from §4.

So *"five families have no size"* and *"seven offer no size position"* are both true and
answer different questions. A one-position table is not a control: a radio group of one
cannot be operated.

**Any-size has three constituencies**, not one: the families with an empty domain, the 876
non-insert records with no cell, and **136 records that resolve a cell the control names
while carrying no tag that says so** (134 arcs, 26 wall footprints).

### The predicate is exact, not compatible

Over 1,211 edge slots, the exact-run predicate and the geometry's own closure check agree
**1,211 of 1,211**, with no row where one accepts and the other doubts. **Exactness is not a
second condition — it is the closure's own condition moved one step earlier**, into the
candidate set. A "compatible" reading would admit exactly the short fills the closure
already refuses.

### Where a size ref is wrong

**Cell refs: 0 disagreements** across all 3,449 rect records.

**Run refs: 0 false positives** among records with a footprint (the 331 admitted are all
`foot: {shape: 'none'}`, which the closure refuses anyway), and **84 false negatives
(1.26%)** — the 56 `AxG`/`BAxG` plus the 28 `QxG` of §3.

**One deny clause is right for an edge slot and wrong for a one-slot family.** Keeping it
makes **241 records unreachable at every position of their own family**, including all 121
diagonals. Dropping it costs **12** labels — not the 28 first predicted, because 16 of the
28 `QxG` walls live in a family whose 3×0.5 cell is inexpressible, so no position exists for
their tag to land at.

---

## 7. Consequences of the corner correction

- **The run deny list lost its zero-false-positive property.** A `run: 2` ref would have
  admitted 245 records whose run is 1.5 — precisely the *"wall drawn through another wall"*
  the list exists to prevent. Corrected by adding `shape|corner`, at a recall cost of 595
  records (`RUN_UNREACHABLE` 84 → 679) that is affordable because the shipped recipes never
  reached those records through a run ref.
- **102 designs lost their exact size chip** — 3,206 → 3,104 exact, **86.0% → 83.3%**. Real
  and user-visible: the chip is a *tag* ref and **no tag says 1.5** for these records.
  Nothing became unreachable; the label is coarser.
- **`size|openlock` code `A` stopped being a functional determinant of width.** It now spans
  `wall:1.5` and `wall:2` and joins the ambiguous codes. **This ends a coincidence that kept
  a retired defect latent**: `A` has 86 bases, all `wall:2`, so a code-first base join would
  today hand 245 corner walls **a base half a unit too long**.
- The emitted index moved by **+493 brotli bytes** (+980 raw), and `PIPELINE_VERSION` moved
  with it — caught by the stamp's biconditional rather than by hand. Reverting only the
  footprint reproduces the previous digest byte for byte.

---

## 8. Open, and deliberately not fixed

- **The 36-record L-class.** `shape|corner|wall` with no chirality tag is a corner printed as
  a single L, measuring N × N. Its `{shape: 'wall', length: n}` footprint is wrong for a
  *different* reason than the 245 were, and **the `Footprint` type has no L case at all**.
  Either alternative is a classification change that would move the footprint tallies the
  external verifier mirrors.
- **The 1.5 has no tag.** Restoring the exact size chip for those 102 designs needs a derived
  `size|run|<r>` tag, priced at **+300 B** and declined — not for the bytes (145 KB of the
  index budget are free) but because it moves the tag table off 930, which is asserted in
  three suites and quoted in thirteen docblocks.
- **The corner walls are still not in the sidecar.** Adding them is ~15 lines of code, but the
  287 blobs are **3.72 GB** and would move the tool's headline from *1,163 meshes / 11.05 GB*
  to *1,450 / 14.77 GB* plus every asserted per-set count. Instead the finding is asserted
  **by identity** — all 245 are code `A`, tagged 2, resolving 1.5 — so a 246th cannot arrive
  unnoticed.
- **Two non-numeric widths.** `wot` (50) and `sw` (33) are tagging defects that belong
  upstream. They resolve no size and are excluded by every predicate, so nothing downstream
  is wrong — but a size-parameterised family would silently drop them if the exclusion were
  ever removed.

---

## 9. The lesson, stated once

**A size tag is a claim about a piece. Only a mesh is a measurement of one.**

The corpus is a creator's working index, not a specification: `size|width|2` means "two units
wide" on 3,449 rect records and "belongs in a two-unit cell" on 245 corner walls, and nothing
in the tag distinguishes those. `foot` cannot arbitrate, because it is derived from the tag it
would be adjudicating.

Three rows met this and correctly refused to guess, because the plan says *do not silently
write 1.5*. **That caution was right and should stay.** What was wrong was the assumption
behind it — that the meshes could not be consulted. They can, for free, in minutes. **When a
tag and a geometry disagree, measure the mesh.**
