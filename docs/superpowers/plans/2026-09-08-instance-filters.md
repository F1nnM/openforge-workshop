# Instance Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the palette's component/height/size filters a property of a placed instance — kept on place, narrowing the slot editor, editable there, and surviving a share link.

**Architecture:** One new field on `TemplateInstance`, carried by the existing placement path. The slot editor filters by posing the instance's filters onto the template's tags, which is the mechanism the recipe fold already built — `assemblyState` reads `template.tags` as the `parentTags` a `constrain` block collects, so no per-slot table and no second resolver. Editing them re-solves one instance under a pin rule that keeps a hand-pick only while the new filters still admit it.

**Tech Stack:** TypeScript (strict, composite projects), Vitest, Zod, React 19. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-08-instance-filters-design.md`

**Status:** **done** — 7 of 7 tasks. Full suite green at each commit — currently **172 files / 4,019 tests / 0 failures**.

## Global Constraints

- **`filters`, never `position`, on an instance.** The palette keeps `position` for the things you operate — `ControlPosition`, `PositionAxis`, `armedPosition`, `positionContextFor`, `FillContext.position`. On `TemplateInstance` that word sits beside `x` and `z` and reads as the cell.
- **No backwards compatibility.** `CLAUDE.md`: update every dependent. Saved rooms and existing share links are discarded, by the licence `migrations.ts` records and `package.json`'s `0.1.0` still grants.
- **The store must never throw on hydrate.** Every reader of persisted state is a total function; `migrations.ts` is the contract and `migrations.test.ts` is the proof.
- **Per-file checks after touching any `.ts`/`.tsx`:** `npm run lint -- --fix <file>`, `npm run typecheck`, `npx vitest run --changed`.
- **Before the PR:** `npm test`, `npm run lint`, `npm run typecheck`.

---

## What changed from the spec

Six things, all decided during implementation and all now reflected in the spec itself.

### 1. The field is `filters`, not `position` — a correction, not a refinement

The spec was written with `position`, taken from the codebase's own vocabulary for a control's setting. It shipped that way across four commits and then the project owner read the field, asked *"What is this position field? I thought we were talking about assembly types"*, and was right to: it sits directly beside `x` and `z`.

Renamed in `cf0f367`. Only the instance field and its carriers moved — the place edit, `planPlacement`'s parameter, `slotEditorModel`'s read. Everything the palette calls a position still is one.

### 2. `NewTemplateInstance` marks the field optional

Not in the spec; decided mid-task. Adding a required field broke **47 call sites**, nearly all fixtures building instance literals. Rather than have forty places write `filters: []` to mean nothing:

```ts
export type NewTemplateInstance = Omit<TemplateInstance, 'id' | 'filters'> &
  Partial<Pick<TemplateInstance, 'filters'>>
```

That is the schema's own `.default([])` expressed in the type, and it cut the churn to 16 sites that genuinely construct the stored shape. Every other field stays required, because none has a defensible default. It is the one departure from that type's *"`Omit` so a field added to `TemplateInstance` arrives here without an edit"*, and the docblock now says so.

### 3. The salvager reduces malformed filters *whole*

Not in the spec. `salvageFills` works per entry — one unreadable fill costs that slot and not the other four — and `salvageFilters` deliberately does not: a malformed filter list is reported and reduced to `[]` rather than picked apart. A fill is one slot's answer and its neighbours are independent; the filters are **one choice across axes**, and half of `['component|door|arched', 'size|width|2']` is not a narrower version of it, it is a different filter nobody chose.

### 4. `reSolveInstance` reports its query cost

Not in the spec, which gave the driver `{ fills, replaced }`. It returns
`queries` as well, because the pin-compatibility probes happen **outside**
`solveTemplateFills` and its counter — so a surface pricing a filter change off
the solve's own number would undercount it by one query per deliberate choice in
the instance. Every other report in `relock.ts` is priced in the same unit.

### 5. `AxisControl`'s lift fixed a defect the two controls had grown

Not in the spec, and not anticipated: lifting the chips forced one `aria-pressed`
rule, and neither of the two the palette had was right. `SizeControl` tested
equal length, which stopped pressing *any* size chip the moment a component was
armed beside it — `PlanTools.armedPosition` joins all three axes, so the joined
list is longer than any one position in it. `AxisControl` tested subset, which
presses two chips of a generated family's size axis at once, because `2 wide`'s
tags are a subset of `2 wide by 2 deep`'s.

`families.ts#positionIn` — the most specific position of the axis — is right on
both, and is `positionOf`'s own rule generalised past the size axis. The chips'
accessible names gained a `Size: ` prefix as a side effect, which is what six
palette assertions had to be re-read for.

### 6. A store action had to exist: `setPlacementFilters`

The spec said the editor "writes the instance" without saying through what, and
nothing in `@/store` could. A filter change moves the candidate set, so it can
rewrite every slot at once and may replace a pin — which `fillSlot` refuses by
design. So it is one transaction taking a whole `fills` map: `relock.ts`'s own
first option, for the case that needs it. Taking the map rather than a tile is
also what keeps the C-k exception narrow — a caller cannot reach a pin through it
one slot at a time.

---

### Task 1: The field — DONE (`7d3649f`)

**Files:** `src/store/schema.ts`, `src/store/migrations.ts`, `src/store/workshopStore.ts`, and the 16 fixtures that build a full `TemplateInstance`.

- [x] Failing test: a placed instance keeps the filters it was placed at
- [x] `TemplateInstance.filters: z.array(z.string().min(1)).readonly().default([])`
- [x] Docblock: why this is **not** a hoisted facet — *any component* and *arched door, which happens to be what is filled* produce identical fills, so the distinction exists only if stored
- [x] `STORE_VERSION` 7 → 8, history table entry, and the additive-bump argument
- [x] `salvageFilters`, absent → `[]`, malformed → `[]` and reported
- [x] Version 7 historical blob, so the gate is provably the only thing discarding it
- [x] Commit

### Task 2: On place — DONE (`cb8e4bd`)

**Files:** `src/builder/three/edits.ts`, `src/builder/three/RoomSurface.tsx`

- [x] Failing test: the armed filters reach the place edit
- [x] `planPlacement` takes them and the `place` edit carries them, defaulted to `[]`
- [x] `RoomSurface` hands them to `placeTemplate` beside the fills
- [x] Commit

### Task 3: The editor narrows — DONE (`45f0b89`)

**Files:** `src/builder/panels/slots/slotEditor.ts`, `src/builder/panels/slots/slots.test.tsx`

- [x] Failing test: a one-slot recipe that constrains `texture`, narrowed by an instance carrying `texture|towne`
- [x] `slotEditorModel` poses `instance.filters` onto `template.tags` before `assemblyState`
- [x] Commit

The test uses its own recipe rather than the file's `EDITOR_TEMPLATE`, whose `top` slot declares no `constrain` at all — the right shape for what *that* tests and exactly the shape a filter cannot narrow. A filter is offered to every slot and collected only by the ones that asked.

---

### Task 4: `reSolveInstance` — the pin rule — DONE (`14fb847`)

**Files:** `src/template/relock.ts`, `src/template/relock.test.ts`, `src/template/index.ts`

- [x] Four tests, not three: the fourth is the one the design turns on
- [x] `reSolveInstance(instance, filters, index, context): InstanceFilterReSolve`
- [x] Pin compatibility resolved with **no sibling selections** — the widest set the filters allow
- [x] Docblock carries the contract **C-k** argument: the first solver-driven pin discard, and why the reasoning does not extend to a filter change
- [x] Fills keyed by a slot the recipe does not declare are carried through untouched
- [x] Commit

The spec asked for three tests and there are four. `tests a pin against the
filters alone, not against its siblings` is the one the design turns on: with a
sibling selection in the compatibility probe, a `curved` floor the user never
touched would close a `flat` wall they *did* choose, and the report would then
name the filter change as the reason for a discard the filters did not cause.
The fixture's `interface` constrain inherits from every sibling, so that is
observable rather than argued.

### Task 5: The chips above the slots — DONE (`c5a2550`)

**Files:** `src/builder/panels/AxisControl.tsx` (new), `PalettePanel.tsx`,
`families.ts`, `slots/slotEditor.ts`, `slots/SlotEditor.tsx`, `slots/slots.css`,
`src/store/workshopStore.ts`, and four test files

- [x] `AxisControl` lifted into its own module, holding no `PositionAxis`, no `TemplateFamily` and no store write — the palette binds a family and an axis, the editor binds an instance and a re-solve
- [x] `sizeChipLabel` moved with it, so the abbreviation has one spelling
- [x] `families.ts#positionIn` / `isChosenPosition` — one pressed rule, replacing two that were each wrong on one axis
- [x] Mounted per axis in `SlotEditor.tsx` **above** the slot list, asserted as DOM order
- [x] `editorAxes` / `filtersWith` / `reFilterInstance` / `replacedSentence` in `slotEditor.ts`, headless
- [x] `@/store#setPlacementFilters` — one transaction over the filters and the whole fills map
- [x] The replaced pins reported in the dialog, naming the piece and the slot
- [x] `AxisControl.tsx` imports the stylesheet that defines its classes, so it does not look styled only when the palette happens to be mounted
- [x] Commit

The lift was the point rather than a side effect, and it earned that twice: see
*What changed from the spec* 5 and 6.

### Task 6: The share codec — DONE (`adbf8f7`)

**Files:** `src/share/payload.ts`, `src/share/link.ts`, and the three share test files

- [x] Round-trip test over a scene where two instances hold the same file and differ only in their filters
- [x] A filter table after the slot table plus a per-instance column after the template one — `writeTable`'s fourth use
- [x] One entry per distinct filter **set**, `NUL`-joined, written as the escape (`tools/hygiene/source.test.ts` fails the build on the byte)
- [x] `SHARE_FORMAT_VERSION` 4 -> 5, with the argument for why a v4 link cannot be read as v5 by defaulting the field
- [x] An unreadable entry widens its instances to *any* and keeps the piece, reported once against the table entry
- [x] Capacity **re-measured**: room 7,358 -> 6,956, scattered 88 -> 81, interning win 3.1x -> 4.1x
- [x] Commit

### Task 7: The two size routes — DONE (`1b89339`)

**Files:** `src/template/corpus.test.ts`

- [x] All 188 `(assembly, size, component)` pairs, both routes, per slot
- [x] Plus the editor's own `assemblyState` pool contains what the click places
- [x] **They differ on four triples, and the test reports them**

The finding: on the `cell` route the two **external-corner single-piece**
assemblies' `right wall` and `left wall` come back empty, where the `parentTags`
route fills them. `size.ts#slotSizePredicate` gives an `edge` slot the face
minus the mitre, so a 2x2 external corner asks for `size|width|1.5` — the honest
geometry, and a tag **no corner wall carries**: row D9 measured them at 1.5 while
the corpus tags them `size|width|2`. The routes disagree exactly where the corpus
disagrees with itself, and B6's precedent applies — recorded, not normalised.

No surface can reach it: those assemblies' whole size domain is the single
`2 wide by 2 deep` their slots already `require`, and `families.ts#sizesFor`
drops a one-position axis as an inoperable control. The test splits reachable
from unreachable and **asserts that reachability claim**, so a row that starts
offering one-position axes fails here naming these four.

---

## Then

Both this feature and the recipe fold live on `worktree-assembly-fold-and-fixed-size`, open as **PR #157** against `main`. Push updates the preview at `pr-157-openforge-workshop-staging`.

The PR body has the filters section.

## Accepted breakage

- **Saved rooms are discarded** — `STORE_VERSION` 8, by the licence `package.json`'s `0.1.0` still grants.
- **Existing share links stop resolving.** `SHARE_FORMAT_VERSION` is 5 and is checked *"first and hardest"*, so a stale link is refused with the version in the message rather than decoded into a wrong room.
