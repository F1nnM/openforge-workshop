# Instance Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the palette's component/height/size filters a property of a placed instance — kept on place, narrowing the slot editor, editable there, and surviving a share link.

**Architecture:** One new field on `TemplateInstance`, carried by the existing placement path. The slot editor filters by posing the instance's filters onto the template's tags, which is the mechanism the recipe fold already built — `assemblyState` reads `template.tags` as the `parentTags` a `constrain` block collects, so no per-slot table and no second resolver. Editing them re-solves one instance under a pin rule that keeps a hand-pick only while the new filters still admit it.

**Tech Stack:** TypeScript (strict, composite projects), Vitest, Zod, React 19. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-08-instance-filters-design.md`

**Status:** 3 of 7 tasks done. Full suite green at each commit — currently **172 files / 4,000 tests / 0 failures**.

## Global Constraints

- **`filters`, never `position`, on an instance.** The palette keeps `position` for the things you operate — `ControlPosition`, `PositionAxis`, `armedPosition`, `positionContextFor`, `FillContext.position`. On `TemplateInstance` that word sits beside `x` and `z` and reads as the cell.
- **No backwards compatibility.** `CLAUDE.md`: update every dependent. Saved rooms and existing share links are discarded, by the licence `migrations.ts` records and `package.json`'s `0.1.0` still grants.
- **The store must never throw on hydrate.** Every reader of persisted state is a total function; `migrations.ts` is the contract and `migrations.test.ts` is the proof.
- **Per-file checks after touching any `.ts`/`.tsx`:** `npm run lint -- --fix <file>`, `npm run typecheck`, `npx vitest run --changed`.
- **Before the PR:** `npm test`, `npm run lint`, `npm run typecheck`.

---

## What changed from the spec

Three things, all decided during implementation and all now reflected in the spec itself.

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

### Task 4: `reSolveInstance` — the pin rule

**Files:**
- Modify: `src/template/relock.ts` (new export beside `reSolveScene`)
- Test: `src/template/relock.test.ts`

**Interfaces:**
- Produces: `reSolveInstance(instance, filters, index, context): InstanceFilterReSolve`

```ts
interface InstanceFilterReSolve {
  readonly fills: TemplateInstance['fills']
  /** Pins dropped because the new filters do not admit them. Reported, never silent. */
  readonly replaced: readonly { readonly slot: SlotName; readonly was: TileId }[]
}
```

- [ ] **Step 1: Write the failing tests**

Three claims, and the second is the one that sets a precedent:

```ts
it('keeps a pinned fill the new filters still admit', () => { … })
it('drops a pinned fill the new filters do not admit, and reports it', () => { … })
it('re-solves every auto fill regardless', () => { … })
```

- [ ] **Step 2: Run them, confirm they fail**

Run: `npx vitest run src/template/relock.test.ts -t reSolveInstance`

- [ ] **Step 3: Implement**

Per slot, resolve candidates under the posed template with **no sibling selections** — the widest set the filters allow, which makes the compatibility test a function of the filters alone rather than of the order slots are walked. Surviving pins become `solveTemplateFills`' preset; dropped ones are returned.

The docblock must carry the contract **C-k** argument the spec sets out: this is the first solver-driven pin discard, `relock.ts` is explicit that clearing has exactly one caller and it is the user, and the reasoning does not extend here because it is one control on one instance with the piece on screen. What carries over is the reporting.

- [ ] **Step 4: Run, then `npm test`**
- [ ] **Step 5: Commit**

### Task 5: The chips above the slots

**Files:**
- Create: `src/builder/panels/AxisControl.tsx` (lifted out of `PalettePanel.tsx`)
- Modify: `src/builder/panels/PalettePanel.tsx`, `src/builder/panels/slots/SlotEditor.tsx`
- Test: `src/builder/panels/slots/slots.test.tsx`

- [ ] **Step 1: Failing test** — the axis groups render, and **above** the first slot group in DOM order
- [ ] **Step 2: Confirm it fails**
- [ ] **Step 3:** Lift `AxisControl` into its own module; mount it per non-empty axis in `SlotEditor.tsx`; changing one calls Task 4's driver and writes the instance
- [ ] **Step 4: Report the replaced pins** in the modal — a driver that returned them and a UI that swallowed them would be C-k's failure with an extra step
- [ ] **Step 5:** `npm test`, commit

Two spellings of one chip would drift, which is why the lift is the point rather than a side effect.

### Task 6: The share codec

**Files:**
- Modify: `src/share/payload.ts`, `src/share/link.ts`
- Test: `src/share/link.test.ts`, `src/share/capacity.test.ts`

- [ ] **Step 1: Failing test** — a scene with filters survives a round trip
- [ ] **Step 2: Confirm it fails**
- [ ] **Step 3:** A filter table plus a per-instance index column, through the existing `writeTable` — its fourth use beside the template, slot and recipe tables. One table entry per distinct filter **set**, joined, because they repeat across a room and a per-instance tag list would pay for the repetition ninety times.
- [ ] **Step 4:** `SHARE_FORMAT_VERSION` 4 → 5
- [ ] **Step 5: Re-measure the capacity prices**, never adjust them by arithmetic. `capacity.test.ts` recomputes from the codec either way.
- [ ] **Step 6:** `npm test`, commit

### Task 7: The two bases agree

**Files:** `src/template/corpus.test.ts`

- [ ] **Step 1:** Compare `positionContextFor`'s `cell` route against the `parentTags` route, per slot, per assembly, per size position
- [ ] **Step 2:** If they agree, the test pins it. **If they differ, report it — do not paper over it.** The placement path uses the cell route and the editor uses `parentTags`; a disagreement means the editor can offer a file the re-solve would not choose.
- [ ] **Step 3:** Commit

---

## Then

Both this feature and the recipe fold live on `worktree-assembly-fold-and-fixed-size`, open as **PR #157** against `main`. Push updates the preview at `pr-157-openforge-workshop-staging`.

The PR body describes the fold only and will need the filters section added before merge.

## Accepted breakage

- **Saved rooms are discarded** — `STORE_VERSION` 8, by the licence `package.json`'s `0.1.0` still grants.
- **Existing share links stop resolving** once Task 6 lands. `SHARE_FORMAT_VERSION` is checked *"first and hardest"*, so a stale link is refused with the version in the message rather than decoded into a wrong room.
