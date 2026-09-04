# Findings from the `epic/v2` rows

Corrections and measurements the rows produced that `templates-plan.md` does not yet carry. Row
**B6** folds these into the plan; they are recorded here first because the research reports they
came from were lost when the scratchpad was wiped, and a figure that lives only in a transcript is
a figure nobody can check.

Each entry names the row that measured it.

---

## 1. `base` is not a role — and the fix needs no new axis (row A9)

`pipeline/role.ts` closes `ROLES` at eight values — wall, floor, riser, insert, column, stair, roof,
decor. **`base` is not one of them**; it is a value of `layer`, a different axis. Section 2.5's
family key is `(role, form, build)`, which does not carry `layer`, so **no family row B4 generates
from that key can be the base family.**

A9 proved it by running B1's classifier over the 686 archive-resolvable base records: they spread
across eight `(role, form, build)` keys, every one `layer: 'base'`, none of them a base — 271
`role|floor form|straight`, 161 `role|floor form|curve`, 128 `role|riser form|straight`, and so on.

The fix, measured over all 8,702 records:

| | records |
| --- | ---: |
| `layer === 'base'` | 1,963 |
| `shape\|base` | 1,963 |
| both | 1,963 |
| `layer === 'base'` without `shape\|base` | **0** |

**Exactly coextensive, zero exceptions in either direction.** A base slot predicates on
`require: [{ tag: 'shape|base' }]` — an existing tag — so no fourth axis is needed and nothing has
to be emitted that B1 did not already emit.

It is also more informative than a `layer|base` tag would have been, because a base keeps the role
of the thing it sits under: `role|wall` 1,117, `role|floor` 661, `role|riser` 176, `role|stair` 9.
So `(role, form)` plus `shape|base` distinguishes a base for a wall run from one for a floor.

**Consequence:** B4 owes a one-slot bare-base family on that predicate. Until it lands,
`BuilderScreen`'s archived branch is a deliberate compile error rather than a base mislabelled as a
floor in the palette.

## 2. The mesh plan is lock-free (row A2)

The plan says the warm path reconciles on `(placements, lock)`. Measured, **`planSceneMeshes` never
consults the lock**: a fill names an exact file, so there is nothing to resolve. A lock change
reaches the warm path through `placements`, when the re-solve rewrites the `auto` fills — not
through `lock`. The `lock` half of the subscription is a hedge for that two-step, not the mechanism.

Two more from the same row:

- **Keep all three conversion tiers, but move the budget from per-fill to per-scene.** 71.2% of
  fills still have a non-empty background set (median 1 variant, 5.33 MB), so a file-valued fill
  does not collapse the tier. But a per-fill budget is 62 budgets for one room: a 40-instance room's
  background candidates are **433.24 MB**, and one 32 MB scene budget prefetches **29.21 MB**
  (14.8x less) while a single instance still gets its whole set in 36 of 40 templates.
- **Diff on the file set, not the blob set.** A blob set is not derivable without the catalog, so
  diffing on it would resolve the 5.6 MB index to answer a drag.

## 3. Two files the plan says to delete cannot be deleted (row A3)

- **`src/assembly/footprint.ts` survives.** `footprintKey` has two live consumers outside
  `src/assembly`, both importing the module path directly and both calling it:
  `pipeline/catalog.test.ts` runs it over all 8,702 emitted footprints (row W7's cross-check), and
  `tools/hygiene/project.test.ts` uses it to prove `tsconfig.node.json`'s `include` and `paths`
  still reach into `src/` — deleting that import is a green typecheck that has silently lost the
  capability. `footprintsMatch` does go: zero consumers outside its own file, the barrel and its own
  test.
- **`src/assembly/sizeCode.ts` shrinks rather than dies.** `sizeCodeWidth` and
  `SIZE_CODE_WIDTH_UNITS` have zero code consumers — `src/search/textIndex.ts` names the constant
  only in a docblock — but `sharedPrimitive` and `AMBIGUOUS_SIZE_CODES` serve the base ranking that
  survives as the default-fill ranking.
- **Dropping `AssemblyIndex.aggregates` is safe**, confirming the plan. One reader outside
  `src/assembly` — `builder/panels/slots/planSlots.ts` — and it reads `placement.design`, which is a
  compile error under A1 regardless.

## 4. The download thresholds are now wrong by 2.58x (row A3) — for row C4

`bill.ts`'s `DOWNLOAD_LARGE_BYTES` (512 MB) and `DOWNLOAD_HUGE_BYTES` (2 GB) are calibrated on
"fifty placements at the 10.36 MB corpus median". A template instance is multi-part, so:

| | bytes | files | vs `large` |
| --- | ---: | ---: | ---: |
| one instance, median candidate per slot | 26,394,812 | ~3 | — |
| twenty instances | ~528 MB | ~60 | **1.03x — trips `large`** |
| fifty instances | ~1,319,740,600 | ~150 | **2.58x** (66% of `huge`) |

A median fifty-*tile* room was 1.01x `large`. So the calibrating sentence in the docblock is false
and twenty instances now trips a warning the copy calls large. **C4 restates the thresholds in
parts rather than placements**; A3 deliberately did not recalibrate.

## 5. Every shipped template slot is required (row A3)

`optional` is **absent from all 128 template parts**, so every slot of every one of the 40 shipped
templates is required. The download gate — every declared non-optional slot resolved, or refuse —
therefore applies to all of them. (Contrast the *tile-level* accessory slots, where `optional` is
absent on 1,050 of 3,695 and absence means required.)

Also measured over the 40: 6 slot names (`floor` 40, `base` 40, `wall` 32, `column` 8, `right wall`
4, `left wall` 4); 3-5 parts per template, median 3; **0 dead-end slots**; 14,241 (slot, candidate)
pairs at a median of 67 candidates; **0 candidates are `layer === 'insert'`**; 3,610 (25.4%) carry
no `build|` tag; 60 have `foot.shape === 'none'`. The base gap is **377 = 86/31/260**, identical
under openlock, dragonlock, magnetic and no preference, and **3,986 of 3,986** matched toppers take
a `plain` base under openlock.

## 6. Four of B1's own predicted figures did not reproduce (row B1)

Pinned as measured, not as predicted:

| | predicted | measured |
| --- | --- | --- |
| tag table | 931 | **930** — `role\|unknown` never fires |
| tag id 0 | `role\|wall` | **`form\|straight`** (5,707 refs against 5,381); both one-digit, so the encoding argument survives its premise |
| index delta | +865 B | **+1,165 B** shipped, **+468 B** field-isolated, **+776 B** tail-append — the field has no single honest price, and the `PIPELINE_VERSION` digit alone moves the artefact 76 B |
| depth ablation | 271 errors | **368** — the finding holds at five times the error rate |

## 7. `src/search` cannot be in the untouched list (row B1)

Section 7 lists `src/search` as kept untouched. Emitting the axes broke it, and no test caught it:
`textIndex.ts` tokenises the whole intern table with no namespace filter, so `role` and `form`
matched all 3,822 items, `straight` went 45 to 2,482, and — because prefix expansion only fires on
tokens the corpus does *not* know — **`decor` fell from 133 hits to 15** and `stair` from 177 to 169
as each became an exact token and stopped expanding to `decoration`/`stairs`. Fixed with a two-entry
namespace skip; search answers and the 449-token vocabulary are byte-identical to the pre-row index.

Same shape in `src/screens/catalog/format.ts`, whose card chips are governed by a **denylist**: the
axes became chips on nearly every card, emptying 1,044 tag rows to 78 and pushing 53 cards to 485
that lose a chip to the one-line budget.

## 8. The `accept`-prefix workaround is unnecessary (row B1)

Section 2.4 proposed switching `shape|wall` from `require` to the prefix form `accept` to pick up
the 527 `shape|wall|low` records that omit their parent. Under the role predicate it is moot: **all
527 are in the role pool already**, and the prefix reading would additionally admit the *same* 238
non-walls that make `shape|wall` unreliable in the first place. Row B6 removes the row.

## 9. A renaming substrate cannot land inert (row A1)

Row A1 alone leaves **47 type errors across 27 files owned by seven rows**, and `npm run build` runs
`tsc -b` first, so the build is red too. The plan cut A1 as a standalone row; that was wrong, and
the A wave lands as one atomic PR instead. The lesson is the one the epic-branch method already
states: *additive* substrate lands inert, substrate that renames or removes does not.

Two second-order hazards A1 found, both of which cost real time:

- **A type import that no longer resolves becomes `any`**, so every property access downstream
  type-checks silently. `tsc` reported 27 files; the true count is higher, and the masked sites
  surface only when a row fixes its import.
- **19 of the 27 files pass at runtime**, because they build plain object literals that never reach
  the store's parse. A row can see a green `vitest` over a shape that no longer exists. Test-green
  is not evidence here.

## 10. Three gaps around the `pinned` bit that no row owns (row A1)

1. **There is no unpin.** Once pinned, a slot is permanently deaf to the lock. Section 3.3 never
   offers "reset this slot", so A1 did not invent the action — but a user who pins one wall can
   never hand it back to their lock preference.
2. **A pinned fill can become unprintable under a new lock, and nothing warns.** `pinned: true`
   means "print this exact file"; that file may be an openlock variant while the build is now
   dragonlock. Detecting it needs a comparison the store cannot make. It belongs to A3 or C4 and is
   in neither brief.
3. **The re-solve has never been measured at scene scale.** A lock toggle costs instances times
   slots solver calls — 250 instances at 5 slots is 1,250 candidate queries, synchronously, on a
   click. Row C2 owns it.

## 11. Operational notes

- **`grep -P` does not match a literal NUL.** Row A3 hit the raw-control-byte hazard once (a cache
  delimiter written as literal U+0000 and U+0001 by the Write tool) and `grep` missed it; a Python
  byte scan caught it. Scan with bytes.
- **`deploy.yml` had never run end to end** until the first push to `main`, and would have deployed
  a site with no catalog index at all. Fixed in row X1.
- **The `catalog.json` in a fresh worktree must be copied in** — it is gitignored and derived, and a
  stale copy silently invalidates every corpus figure a row measures. One wave of rows measured
  against a pre-B1 index (915 tags, no axes) before this was caught.
