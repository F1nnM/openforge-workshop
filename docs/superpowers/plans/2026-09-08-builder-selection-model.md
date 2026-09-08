# Builder Selection Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the builder's hover-then-act modal gesture model with a persistent selection, a floating action bar on the selected piece, undo/redo, and an overlap rule that refuses the conflicts it is sure about.

**Architecture:** Selection and arming are two mutually exclusive ephemeral states in `usePlanTools`. What a gesture *means* stays pure in `edits.ts` and a new `selection.ts`; `RoomSurface` reads verdicts and makes one store call. Undo is a capped ring of `placements` snapshots fed by a store subscription, so it covers every mutation without an inverse per verb. Overlap gains an exact/inexact verdict, and only `exact` refuses.

**Tech Stack:** React 19, TypeScript, zustand 5 (with `persist`), `@react-three/fiber` 9, `@react-three/drei` 10.7.8, `three` 0.185, `postprocessing`, vitest + @testing-library, zod 4.

**Spec:** `docs/superpowers/specs/2026-09-08-builder-interaction-model-design.md`

## Global Constraints

- **No mocks, no partial implementations.** Every method fully implemented (user's global CLAUDE.md).
- **No backwards compatibility.** Update every caller; never leave a compatibility shim. If a change leaves a no-op behind, delete the no-op.
- **jsdom has no WebGL.** No test may mount the 3D surface. Substance lives in pure modules and DOM-only components; only the `<Html>` anchoring wrapper goes untested.
- **Per-file hygiene after editing** any `.ts`/`.tsx`: `npm run lint -- --fix <file>`, `npm run typecheck`, `npx vitest run --changed` or the file's own suite.
- **Before the PR:** `npm test` (baseline 170 files / 3,941 tests green), `npm run lint`, `npm run typecheck`.
- **Function complexity:** describable without multiple "and"s; extract `_private` helpers rather than growing a function.
- **`public/catalog/catalog.json` is generated and gitignored.** It must exist or four suites fail at collection; copy it from the main checkout or run `npm run import:catalog`.
- **Prohibition is never retroactive.** A persisted room already holding overlaps must load, draw and download.
- Commit messages: describe the result, never the conversation; no self-advertisement.

---

### Task 1: Overlap gains an exact/inexact verdict

**Files:**
- Modify: `src/builder/canvas/overlap.ts`
- Test: `src/builder/canvas/overlap.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type ConflictKind = 'exact' | 'inexact'`
  - `interface Conflict { readonly kind: ConflictKind; readonly reason: ConflictReason | null }`
  - `type ConflictReason = 'curved' | 'unknown-level' | 'inferred-band'`
  - `interface BandVerdict { readonly band: PlanBand; readonly measured: boolean }`
  - `planBand(record): BandVerdict` — **changed return type**
  - `subjectsConflict(a, b): Conflict | null` — **changed return type**
  - `OverlapSubject` gains `readonly cover: PlanCover` and `readonly bandMeasured: boolean`

- [ ] **Step 1: Write the failing tests**

```ts
// in src/builder/canvas/overlap.test.ts
import { footprintShape } from './geometry'
import { levelAt, planBand, subjectsConflict, type OverlapSubject } from './overlap'

/** Two 1×1 area subjects on the same square, both exact, both levelled. */
function areaSubject(x: number, over: Partial<OverlapSubject> = {}): OverlapSubject {
  const shape = footprintShape({ shape: 'rect', w: 1, d: 1 })
  if (shape === undefined) throw new Error('fixture footprint did not resolve')
  return {
    band: 'area',
    bandMeasured: true,
    cover: shape.cover,
    level: levelAt(0),
    box: { x, z: 0, w: 1, d: 1 },
    parts: [
      [
        [x, 0],
        [x + 1, 0],
        [x + 1, 1],
        [x, 1],
      ],
    ],
    axisAligned: true,
    ...over,
  }
}

describe('a conflict says how much it is trusted', () => {
  it('is exact when the geometry, the levels and the bands are all sound', () => {
    expect(subjectsConflict(areaSubject(0), areaSubject(0))).toEqual({ kind: 'exact', reason: null })
  })

  it('is inexact when either part only contains its geometry', () => {
    const verdict = subjectsConflict(areaSubject(0), areaSubject(0, { cover: 'outward' }))
    expect(verdict).toEqual({ kind: 'inexact', reason: 'curved' })
  })

  it('is inexact when either level is unknown, because null reads as every level', () => {
    const verdict = subjectsConflict(areaSubject(0), areaSubject(0, { level: null }))
    expect(verdict).toEqual({ kind: 'inexact', reason: 'unknown-level' })
  })

  it('is inexact when either band came from the kinds heuristic', () => {
    const verdict = subjectsConflict(areaSubject(0), areaSubject(0, { bandMeasured: false }))
    expect(verdict).toEqual({ kind: 'inexact', reason: 'inferred-band' })
  })

  it('is null when the pieces do not overlap at all', () => {
    expect(subjectsConflict(areaSubject(0), areaSubject(4))).toBeNull()
  })
})

describe('a band carries where it came from', () => {
  it('is measured for a wall, whose thickness is in the footprint', () => {
    expect(planBand({ foot: { shape: 'wall', w: 2, d: 0.5 }, kinds: ['wall'] })).toEqual({
      band: 'edge',
      measured: true,
    })
  })

  it('is inferred for a piece whose band comes from its kinds', () => {
    expect(planBand({ foot: { shape: 'rect', w: 1, d: 1 }, kinds: ['wall'] })).toEqual({
      band: 'edge',
      measured: false,
    })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/builder/canvas/overlap.test.ts -t 'says how much it is trusted'`
Expected: FAIL — `subjectsConflict` returns a boolean, `planBand` returns a string, and `OverlapSubject` has no `cover`.

- [ ] **Step 3: Implement**

Replace `planBand` and `subjectsConflict`, and extend `OverlapSubject`:

```ts
/** Why a conflict is not fully trusted. `null` when it is. */
export type ConflictReason = 'curved' | 'unknown-level' | 'inferred-band'

/** Whether a conflict may be acted on as fact, or only reported. */
export type ConflictKind = 'exact' | 'inexact'

export interface Conflict {
  readonly kind: ConflictKind
  readonly reason: ConflictReason | null
}

export interface BandVerdict {
  readonly band: PlanBand
  /** True when the band came from the footprint's own thickness, not from `kinds`. */
  readonly measured: boolean
}

export function planBand(record: Pick<CatalogRecord, 'foot' | 'kinds'>): BandVerdict {
  if (isWallThickness(record.foot)) return { band: 'edge', measured: true }
  const wall = record.kinds.includes('wall')
  const fills = record.kinds.some((kind) => AREA_KINDS.includes(kind))
  return { band: wall && !fills ? 'edge' : 'area', measured: false }
}

/**
 * The three over-reports this module documents, in the order a reader meets
 * them in the docblock. First match wins, so the reason names the strongest
 * doubt rather than an arbitrary one.
 */
function conflictDoubt(a: OverlapSubject, b: OverlapSubject): ConflictReason | null {
  if (a.cover === 'outward' || b.cover === 'outward') return 'curved'
  if (a.level === null || b.level === null) return 'unknown-level'
  if (!a.bandMeasured || !b.bandMeasured) return 'inferred-band'
  return null
}

export function subjectsConflict(a: OverlapSubject, b: OverlapSubject): Conflict | null {
  if (a.band !== b.band) return null
  if (!levelsOverlap(a, b)) return null
  if (!boxesIntersect(a.box, b.box)) return null
  if (!partsOverlap(a.parts, b.parts)) return null
  if (isCornerJunction(a, b)) return null
  const reason = conflictDoubt(a, b)
  return { kind: reason === null ? 'exact' : 'inexact', reason }
}
```

Add to `OverlapSubject`:

```ts
  /**
   * Whether {@link parts} *are* the piece or merely contain it — `geometry.ts`'s
   * own accuracy flag, carried here because this is the consumer its docblock
   * names. `outward` is what makes a conflict inexact and therefore unrefusable.
   */
  readonly cover: PlanCover
  /** Whether {@link band} was measured from the footprint or inferred from tags. */
  readonly bandMeasured: boolean
```

Then fix every `planBand(...)` call site to read `.band` (and `.measured` where a subject is built). Find them with `grep -rn 'planBand' src/`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/builder/canvas/overlap.test.ts`
Expected: PASS. Existing `subjectsConflict` assertions that expected `true`/`false` must be updated to expect a verdict or `null` — that is the point of the change, not a regression.

- [ ] **Step 5: Update the docblock**

The "Flag, not prevent" section is now wrong. Replace it with a section stating that an **exact** conflict refuses and an **inexact** one flags, keeping all three original reasons as the justification for the split rather than deleting them.

- [ ] **Step 6: Hygiene and commit**

```bash
npm run lint -- --fix src/builder/canvas/overlap.ts src/builder/canvas/overlap.test.ts
npm run typecheck
npx vitest run src/builder/canvas/overlap.test.ts
git add src/builder/canvas/overlap.ts src/builder/canvas/overlap.test.ts
git commit -m "feat(canvas): say whether an overlap is exact enough to act on"
```

---

### Task 2: The scene reports conflict kinds

**Files:**
- Modify: `src/builder/canvas/scene.ts` (`PlanScene.conflicts`, `pieceSubjects`), `src/builder/canvas/overlap.ts` (`findConflicts`)
- Test: `src/builder/canvas/plan.test.ts`, `src/builder/canvas/overlap.test.ts`

**Interfaces:**
- Consumes: Task 1's `Conflict`, `ConflictKind`, `BandVerdict`, extended `OverlapSubject`.
- Produces: `PlanScene.conflicts: ReadonlyMap<PlacementId, ConflictKind>`; `findConflicts(candidates): ReadonlyMap<PlacementId, ConflictKind>`.

- [ ] **Step 1: Write the failing test**

```ts
// in src/builder/canvas/plan.test.ts
it('records the kind of each conflict, not merely that there is one', () => {
  const scene = buildPlanScene(/* two 1×1 floors on the same cell — reuse the file's existing fixture builder */)
  const kinds = [...scene.conflicts.values()]
  expect(kinds).toEqual(['exact', 'exact'])
})

it('keeps an exact and an inexact conflict apart in one room', () => {
  const scene = buildPlanScene(/* a stacked pair of floors, plus an arc overlapping a floor */)
  expect(scene.conflicts.get(exactId)).toBe('exact')
  expect(scene.conflicts.get(curvedId)).toBe('inexact')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/builder/canvas/plan.test.ts -t 'records the kind of each conflict'`
Expected: FAIL — `conflicts` is a `Set`, so `.values()` yields ids and `.get` is not a function.

- [ ] **Step 3: Implement**

`findConflicts` keeps its sweep and accumulates kinds. When one placement is in two conflicts, `exact` wins — a piece the builder is sure about must not be softened by a second doubtful pair:

```ts
export function findConflicts(
  candidates: readonly OverlapCandidate[],
): ReadonlyMap<PlacementId, ConflictKind> {
  const conflicts = new Map<PlacementId, ConflictKind>()
  const record = (id: PlacementId, kind: ConflictKind) => {
    if (kind === 'exact' || !conflicts.has(id)) conflicts.set(id, kind)
  }
  // ...existing sweep, unchanged, except the inner test:
  //   const verdict = subjectsConflict(candidate, other)
  //   if (verdict !== null && candidate.id !== other.id) {
  //     record(candidate.id, verdict.kind)
  //     record(other.id, verdict.kind)
  //   }
  return conflicts
}
```

`pieceSubjects` sets the two new fields from the part's own shape and band verdict. The shape is already resolved per part — read `cover` off it rather than re-deriving from `foot.shape`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/builder/canvas/plan.test.ts src/builder/canvas/overlap.test.ts`
Expected: PASS. Update every reader of `scene.conflicts` — `grep -rn 'conflicts' src/` — from `.has(id)` (still valid on a Map) to `.get(id)` where the kind matters.

- [ ] **Step 5: Hygiene and commit**

```bash
npm run lint -- --fix src/builder/canvas/scene.ts src/builder/canvas/overlap.ts
npm run typecheck
npx vitest run src/builder/canvas
git add src/builder/canvas
git commit -m "feat(canvas): carry each conflict's kind through the scene"
```

---

### Task 3: A move refuses an exact conflict

**Files:**
- Modify: `src/builder/canvas/move.ts`
- Test: `src/builder/canvas/move.test.ts`

**Interfaces:**
- Consumes: Task 1's `Conflict`; Task 2's conflict map.
- Produces: `MoveRefusalCode` gains `'overlap'`; `MovePreview.conflict: Conflict | null` replaces whatever note carried the overlap.

- [ ] **Step 1: Write the failing test**

```ts
// in src/builder/canvas/move.test.ts
it('refuses a drop that exactly overlaps a neighbour', () => {
  const preview = previewMove(dragOntoOccupiedCell, scene)
  expect(preview?.refusal?.code).toBe('overlap')
  expect(preview?.committable).toBe(false)
  expect(describeDrop(preview!)).toContain('Blocked by')
})

it('still commits a drop whose overlap is only inexact', () => {
  const preview = previewMove(dragOntoCurvedNeighbour, scene)
  expect(preview?.refusal).toBeNull()
  expect(preview?.committable).toBe(true)
  expect(describeDrop(preview!)).toContain('overlaps')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/builder/canvas/move.test.ts -t 'refuses a drop that exactly overlaps'`
Expected: FAIL — no `'overlap'` refusal code exists; an overlapping drop is committable today.

- [ ] **Step 3: Implement**

Add `'overlap'` to `MoveRefusalCode`, compute the conflict in `previewMove` against the scene's other subjects, and set `refusal` when the verdict is `exact`. `committable` already derives from `refusal === null`, so it needs no change. Keep the inexact path exactly as it is — it is today's note, reworded to say the drop happened.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/builder/canvas/move.test.ts`
Expected: PASS. The docblock section at `move.ts:80-87` asserts the opposite behaviour — rewrite it, do not leave it.

- [ ] **Step 5: Hygiene and commit**

```bash
npm run lint -- --fix src/builder/canvas/move.ts src/builder/canvas/move.test.ts
npm run typecheck
npx vitest run src/builder/canvas/move.test.ts
git add src/builder/canvas/move.ts src/builder/canvas/move.test.ts
git commit -m "feat(canvas): refuse a drop that exactly overlaps a neighbour"
```

---

### Task 4: A placement refuses an exact conflict

**Files:**
- Modify: `src/builder/three/edits.ts`
- Test: `src/builder/three/edits.test.ts`

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: `planPlacement` returns `{ kind: 'none', message }` naming the blocking piece when the projected placement exactly conflicts.

- [ ] **Step 1: Write the failing test**

```ts
// in src/builder/three/edits.test.ts
it('refuses a placement that exactly overlaps, and names what blocked it', () => {
  const edit = planPlacement(scene, cellHoldingAFloor, family, 0, fill)
  expect(edit.kind).toBe('none')
  expect(edit.message).toMatch(/Blocked by .+ at \(4, 7\)/)
})

it('places anyway when the overlap is only inexact, and says so', () => {
  const edit = planPlacement(scene, cellHoldingAnArc, family, 0, fill)
  expect(edit.kind).toBe('place')
  expect(edit.message).toContain('overlaps')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/builder/three/edits.test.ts -t 'refuses a placement that exactly overlaps'`
Expected: FAIL — `planPlacement` has no overlap branch; the docblock says it has "almost nothing left to refuse".

- [ ] **Step 3: Implement**

`planPlacement` now receives a projected piece (Task 14 threads the catalog; until then project from the solved fill it already takes) and tests it against `sceneSubjects(scene)`. On `exact`, return a `none` verdict whose message names the blocking piece via `pieceName` and its cell via `describeCell`. On `inexact`, keep the place verdict and append the existing overlap tail.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/builder/three/edits.test.ts`
Expected: PASS. The `edits.ts` docblock line *"an overlap still informs and commits"* is now false — rewrite it.

- [ ] **Step 5: Hygiene and commit**

```bash
npm run lint -- --fix src/builder/three/edits.ts src/builder/three/edits.test.ts
npm run typecheck
npx vitest run src/builder/three/edits.test.ts
git add src/builder/three/edits.ts src/builder/three/edits.test.ts
git commit -m "feat(builder): refuse a placement that exactly overlaps"
```

---

### Task 5: The undo ring

**Files:**
- Create: `src/builder/canvas/history.ts`, `src/builder/canvas/history.test.ts`

**Interfaces:**
- Consumes: `WorkshopState['placements']` (`Record<PlacementId, TemplateInstance>`).
- Produces:
  - `const HISTORY_DEPTH = 50`
  - `type Placements = WorkshopState['placements']`
  - `interface History { readonly past: readonly Placements[]; readonly future: readonly Placements[] }`
  - `const EMPTY_HISTORY: History`
  - `record(history: History, previous: Placements): History`
  - `undo(history: History, current: Placements): { readonly history: History; readonly placements: Placements } | null`
  - `redo(history: History, current: Placements): { readonly history: History; readonly placements: Placements } | null`
  - `describeChange(before: Placements, after: Placements): string`

- [ ] **Step 1: Write the failing test**

```ts
import { EMPTY_HISTORY, HISTORY_DEPTH, describeChange, record, redo, undo } from './history'

const at = (x: number) => ({ a: { id: 'a', template: 't', x, z: 0, rotation: 0, fills: {} } }) as never

describe('the ring', () => {
  it('hands back the previous placements, and offers the current ones as redo', () => {
    const history = record(EMPTY_HISTORY, at(0))
    const undone = undo(history, at(1))
    expect(undone?.placements).toEqual(at(0))
    expect(redo(undone!.history, at(0))?.placements).toEqual(at(1))
  })

  it('is null when there is nothing to undo', () => {
    expect(undo(EMPTY_HISTORY, at(0))).toBeNull()
  })

  it('drops the oldest entry past the depth', () => {
    let history = EMPTY_HISTORY
    for (let i = 0; i <= HISTORY_DEPTH; i += 1) history = record(history, at(i))
    expect(history.past).toHaveLength(HISTORY_DEPTH)
    expect(history.past[0]).toEqual(at(1))
  })

  it('discards the redo stack when a fresh edit is recorded', () => {
    const undone = undo(record(EMPTY_HISTORY, at(0)), at(1))
    expect(record(undone!.history, at(0)).future).toHaveLength(0)
  })
})

describe('describeChange', () => {
  it('names an addition', () => {
    expect(describeChange({}, at(0))).toBe('Placed 1 tile.')
  })
  it('names a removal', () => {
    expect(describeChange(at(0), {})).toBe('Removed 1 tile.')
  })
  it('names a change to a tile that stayed', () => {
    expect(describeChange(at(0), at(1))).toBe('Changed 1 tile.')
  })
  it('says nothing changed when nothing did', () => {
    expect(describeChange(at(0), at(0))).toBe('No change.')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/builder/canvas/history.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

A pure module: `record` pushes onto `past` (capped, oldest dropped) and clears `future`; `undo` pops `past` and pushes `current` onto `future`; `redo` mirrors it. `describeChange` compares key sets — added, removed, and for surviving keys an identity comparison of the instance — and returns one sentence. Counts are pluralised (`1 tile` / `N tiles`).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/builder/canvas/history.test.ts`
Expected: PASS.

- [ ] **Step 5: Hygiene and commit**

```bash
npm run lint -- --fix src/builder/canvas/history.ts src/builder/canvas/history.test.ts
npm run typecheck
git add src/builder/canvas/history.ts src/builder/canvas/history.test.ts
git commit -m "feat(builder): a capped undo ring over placement snapshots"
```

---

### Task 6: Wiring undo to the store

**Files:**
- Create: `src/builder/canvas/useHistory.ts`, `src/builder/canvas/useHistory.test.ts`
- Modify: `src/store/workshopStore.ts` (add `restorePlacements`)

**Interfaces:**
- Consumes: Task 5's ring.
- Produces:
  - `restorePlacements(placements: WorkshopState['placements']): void` in `workshopStore.ts`
  - `useHistory(): { canUndo, canRedo, undo: () => string | null, redo: () => string | null }` — the returned strings are the `describeChange` sentence for the status line, or `null` when the stack was empty.

- [ ] **Step 1: Write the failing test**

```ts
it('records a store mutation, and an applied undo does not record itself', () => {
  const { result } = renderHook(() => useHistory())
  act(() => { placeTemplate(/* … */) })
  expect(result.current.canUndo).toBe(true)

  act(() => { result.current.undo() })
  expect(usePlacements.getState?.() ?? useWorkshopStore.getState().placements).toEqual({})
  expect(result.current.canUndo).toBe(false)
  expect(result.current.canRedo).toBe(true)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/builder/canvas/useHistory.test.ts`
Expected: FAIL — module not found; `restorePlacements` not exported.

- [ ] **Step 3: Implement**

`restorePlacements` is a one-line `setState({ placements })`. `useHistory` subscribes with `useWorkshopStore.subscribe`, comparing `placements` identity; on a change it calls `record(history, previous)` unless an `applying` ref is set. `undo`/`redo` set that ref around their `restorePlacements` call and return the `describeChange` sentence.

Keep the ring in a `useRef`, not in state, and drive re-renders from a small `useState` counter — the ring's identity is not what components read; `canUndo`/`canRedo` are.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/builder/canvas/useHistory.test.ts`
Expected: PASS.

- [ ] **Step 5: Hygiene and commit**

```bash
npm run lint -- --fix src/builder/canvas/useHistory.ts src/builder/canvas/useHistory.test.ts src/store/workshopStore.ts
npm run typecheck
npx vitest run src/builder/canvas/useHistory.test.ts src/store
git add src/builder/canvas/useHistory.ts src/builder/canvas/useHistory.test.ts src/store/workshopStore.ts
git commit -m "feat(builder): undo and redo over every placement mutation"
```

---

### Task 7: What a press means

**Files:**
- Create: `src/builder/canvas/selection.ts`, `src/builder/canvas/selection.test.ts`

**Interfaces:**
- Consumes: `PlanScene`, `ScenePiece`, `pieceAt`, `navigationOrder` from `./scene`; `PlanPoint` from `./geometry`.
- Produces:
  - `type PressMeaning = { kind: 'select'; id: PlacementId } | { kind: 'deselect' } | { kind: 'place' } | { kind: 'camera' }`
  - `pressMeaning(scene, at, armed: boolean): PressMeaning`
  - `resolveSelection(scene, id: PlacementId | null): ScenePiece | null`
  - `stepSelection(scene, from: PlacementId | null, direction: 1 | -1): PlacementId | null`

- [ ] **Step 1: Write the failing test**

```ts
import { pressMeaning, resolveSelection, stepSelection } from './selection'

describe('what a press means', () => {
  it('places when something is armed, whatever is under the pointer', () => {
    expect(pressMeaning(scene, cellHoldingAPiece, true)).toEqual({ kind: 'place' })
    expect(pressMeaning(scene, bareGround, true)).toEqual({ kind: 'place' })
  })

  it('selects the piece under the pointer when nothing is armed', () => {
    expect(pressMeaning(scene, cellHoldingAPiece, false)).toEqual({ kind: 'select', id: pieceId })
  })

  it('deselects on bare ground when nothing is armed', () => {
    expect(pressMeaning(scene, bareGround, false)).toEqual({ kind: 'deselect' })
  })

  it('is a camera press when the point is off the plan entirely', () => {
    expect(pressMeaning(scene, null, false)).toEqual({ kind: 'camera' })
  })
})

describe('a selection is resolved against the scene, never trusted', () => {
  it('is null for an id the scene no longer holds', () => {
    expect(resolveSelection(scene, 'gone' as PlacementId)).toBeNull()
  })
})

describe('stepping', () => {
  it('walks navigation order and wraps', () => {
    const first = stepSelection(scene, null, 1)
    expect(first).toBe(navigationOrder(scene)[0]?.id)
    expect(stepSelection(scene, lastId, 1)).toBe(navigationOrder(scene)[0]?.id)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/builder/canvas/selection.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Four small functions, all pure. `pressMeaning` is a two-branch decision on `armed`, then `pieceAt`. `resolveSelection` looks the id up in `scene.pieces` and `scene.generated` and returns `null` when absent — this is what makes both selection invariants one rule. `stepSelection` indexes `navigationOrder` and wraps.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/builder/canvas/selection.test.ts`
Expected: PASS.

- [ ] **Step 5: Hygiene and commit**

```bash
npm run lint -- --fix src/builder/canvas/selection.ts src/builder/canvas/selection.test.ts
npm run typecheck
git add src/builder/canvas/selection.ts src/builder/canvas/selection.test.ts
git commit -m "feat(builder): resolve what a press on the plan means"
```

---

### Task 8: Retire the mode, add the selection

**Files:**
- Modify: `src/builder/canvas/usePlanTools.ts`, `src/builder/canvas/index.ts`, `src/builder/panels/PlanToolbar.tsx`, `src/builder/three/RoomSurface.tsx` (compile-level only), `src/builder/panels/PalettePanel.tsx`
- Test: `src/builder/canvas/planTools.test.ts` (or the existing suite covering the hook), `src/builder/panels/panels.test.tsx`

**Interfaces:**
- Consumes: Task 7's types.
- Produces: `PlanTools` loses `tool`, `setTool`, `toggleTool`; gains `readonly selected: PlacementId | null`, `select(id: PlacementId | null): void`, and `arm(template: TemplateId | null, size?: readonly string[]): void`. `PlanTool` and `PlanToolDefaults['tool']` are deleted.

- [ ] **Step 1: Write the failing test**

```ts
it('arming clears the selection, and selecting disarms', () => {
  const { result } = renderHook(() => usePlanTools())
  act(() => { result.current.select('p1' as PlacementId) })
  expect(result.current.selected).toBe('p1')

  act(() => { result.current.arm('family' as TemplateId) })
  expect(result.current.selected).toBeNull()
  expect(result.current.selectedTemplate).toBe('family')

  act(() => { result.current.select('p2' as PlacementId) })
  expect(result.current.selectedTemplate).toBeNull()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/builder/canvas -t 'arming clears the selection'`
Expected: FAIL — no `select`, no `arm`.

- [ ] **Step 3: Implement**

Hold both in one state object so the invariant is structural rather than two setters agreeing:

```ts
interface Armament {
  readonly template: TemplateId | null
  readonly size: readonly string[]
  readonly selected: PlacementId | null
}
```

`arm` writes `{ template, size, selected: null }`; `select` writes `{ template: null, size: [], selected: id }`. One state, one write, invariant unbreakable.

Delete `tool` / `setTool` / `toggleTool` / `PlanTool`. Update the barrel's type re-export. `PalettePanel` calls `arm` instead of `setSelectedTemplate` + `setArmedSize`, and stops forcing `place` mode. `PlanToolbar` loses its `ToggleItem` group. In `RoomSurface`, delete the `P`/`E`/`M` cases and every `tools.tool` read; the gesture rewrite is Task 9, so here do the minimum that compiles and keeps tests green.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/builder src/store`
Expected: PASS. Update the hook's docblock — its whole "modes of design-contract §2.4's toolbar toggle" section is now describing something deleted.

- [ ] **Step 5: Hygiene and commit**

```bash
npm run lint -- --fix src/builder/canvas/usePlanTools.ts src/builder/canvas/index.ts src/builder/panels/PlanToolbar.tsx src/builder/panels/PalettePanel.tsx src/builder/three/RoomSurface.tsx
npm run typecheck
npx vitest run src/builder
git add src/builder
git commit -m "feat(builder): a selection replaces the place, erase and move modes"
```

---

### Task 9: The gesture model on the surface

**Files:**
- Modify: `src/builder/three/RoomSurface.tsx`, `src/three/Stage.tsx` (MMB orbit)
- Test: `src/builder/three/gesture.test.tsx`, `src/builder/three/edits.test.ts`

**Interfaces:**
- Consumes: Tasks 7, 8.
- Produces: no new exports; `RoomSurface` behaviour.

- [ ] **Step 1: Write the failing test**

The surface cannot mount, so the tests go where the decisions are — extend `gesture.test.tsx`'s existing pure coverage with the gesture table from the spec, and assert the target guard directly:

```ts
it('ignores a press that did not land on the canvas', () => {
  // The host listener must not claim a press whose target is an overlay
  // portalled into the same parent — otherwise no button on the action bar
  // is ever clickable.
  expect(claimsPress({ target: overlayDiv, canvas })).toBe(false)
  expect(claimsPress({ target: canvas, canvas })).toBe(true)
})
```

Extract `claimsPress(event, canvas)` as a named export from `RoomSurface.tsx` (or better, from `selection.ts`) so it is testable at all.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/builder/three/gesture.test.tsx`
Expected: FAIL — `claimsPress` does not exist.

- [ ] **Step 3: Implement**

1. **Target guard**, first line of `onDown` at `RoomSurface.tsx:~830`: `if (!claimsPress(event, canvas)) return`.
2. **Press classification** via `pressMeaning`: claim the press (and `stopPropagation`) only for `select` and `place`; leave `deselect` and `camera` to `OrbitControls`. A `select` press also begins a move drag, so a drag from an unselected piece selects and moves in one gesture.
3. **Keyboard**: `Delete`/`R`/arrows/`Enter` act on `tools.selected` resolved through `resolveSelection`; `[`/`]` call `stepSelection`; `Esc` clears the selection or disarms. Delete the `sticky` ref — the selection is what it was standing in for.
4. **Right button**: delete the secondary-press bookkeeping, the `contextmenu` listener and its suppression. Pan is `OrbitControls`' business now.
5. **MMB orbit** in `Stage.tsx`: `<OrbitControls mouseButtons={{ LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.ROTATE, RIGHT: MOUSE.PAN }} />`.
6. **Rewrite the docblock.** Sections "The gesture model, and where it departs from the mockup", "Why the drag has to fight for the pointer", and "The right click, and why it is a `pointerup`" all describe a model that no longer exists. The capture-phase note stays — the mechanism is unchanged — but gains the target guard and why it is the bug class.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/builder/three`
Expected: PASS.

- [ ] **Step 5: Check the extraction was real**

Run: `wc -l src/builder/three/RoomSurface.tsx`
Expected: materially below 1,673. If it is not, the gesture logic did not actually move to `selection.ts` — say so rather than proceeding.

- [ ] **Step 6: Hygiene and commit**

```bash
npm run lint -- --fix src/builder/three/RoomSurface.tsx src/three/Stage.tsx
npm run typecheck
npx vitest run src/builder src/three
git add src/builder/three/RoomSurface.tsx src/three/Stage.tsx src/builder/three/gesture.test.tsx
git commit -m "feat(builder): select, then act, on the work surface"
```

---

### Task 10: The action bar's markup

**Files:**
- Create: `src/builder/three/PieceActionsBar.tsx`, `src/builder/three/pieceActions.test.tsx`, `src/builder/three/anchor.ts`, `src/builder/three/anchor.test.ts`

**Interfaces:**
- Produces:
  - `interface PieceActionsBarProps { readonly piece: ScenePiece; readonly slots: ReactNode; readonly onTurn: () => void; readonly onDelete: () => void }`
  - `PieceActionsBar(props): JSX.Element`
  - `clampAnchor(point: { x: number; y: number }, size: { width: number; height: number }, margin?: number): { x: number; y: number }`

- [ ] **Step 1: Write the failing tests**

```tsx
it('fires each verb and names its key', async () => {
  const onTurn = vi.fn()
  const onDelete = vi.fn()
  render(<PieceActionsBar piece={piece} slots={<div />} onTurn={onTurn} onDelete={onDelete} />)

  const turn = screen.getByRole('button', { name: /turn/i })
  expect(turn).toHaveAttribute('title', expect.stringContaining('R'))
  await userEvent.click(turn)
  expect(onTurn).toHaveBeenCalledOnce()

  await userEvent.click(screen.getByRole('button', { name: /remove/i }))
  expect(onDelete).toHaveBeenCalledOnce()
})

it('expands the slots on demand and keeps them closed until then', async () => {
  render(<PieceActionsBar piece={piece} slots={<p>slot editor</p>} onTurn={vi.fn()} onDelete={vi.fn()} />)
  expect(screen.queryByText('slot editor')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /slots/i }))
  expect(screen.getByText('slot editor')).toBeInTheDocument()
})

it('keeps its pointer events to itself', () => {
  const escaped = vi.fn()
  render(<div onPointerDown={escaped}><PieceActionsBar {...props} /></div>)
  fireEvent.pointerDown(screen.getByRole('button', { name: /turn/i }))
  expect(escaped).not.toHaveBeenCalled()
})
```

```ts
it('keeps the bar on screen at every edge', () => {
  const size = { width: 800, height: 600 }
  expect(clampAnchor({ x: -50, y: 300 }, size)).toEqual({ x: 8, y: 300 })
  expect(clampAnchor({ x: 900, y: 300 }, size)).toEqual({ x: 792, y: 300 })
  expect(clampAnchor({ x: 400, y: -20 }, size)).toEqual({ x: 400, y: 8 })
  expect(clampAnchor({ x: 400, y: 700 }, size)).toEqual({ x: 400, y: 592 })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/builder/three/pieceActions.test.tsx src/builder/three/anchor.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`PieceActionsBar` is plain DOM: a header row of three buttons, then the `slots` node behind a disclosure. It calls `stopPropagation` on `pointerdown` at its root, and uses `@base-ui/react` if the existing panels do (check `PalettePanel.tsx` for the house pattern). Button labels are accessible names; the key hint goes in `title`. `clampAnchor` is four `Math.min`/`Math.max` calls with a default margin of 8.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/builder/three/pieceActions.test.tsx src/builder/three/anchor.test.ts`
Expected: PASS.

- [ ] **Step 5: Hygiene and commit**

```bash
npm run lint -- --fix src/builder/three/PieceActionsBar.tsx src/builder/three/anchor.ts src/builder/three/pieceActions.test.tsx src/builder/three/anchor.test.ts
npm run typecheck
git add src/builder/three/PieceActionsBar.tsx src/builder/three/anchor.ts src/builder/three/pieceActions.test.tsx src/builder/three/anchor.test.ts
git commit -m "feat(builder): the selected piece's action bar"
```

---

### Task 11: Anchoring the bar in the scene

**Files:**
- Create: `src/builder/three/SelectionAnchor.tsx`
- Modify: `src/builder/three/RoomSurface.tsx`, `src/builder/panels/slots/SlotsPanel.tsx`

**Interfaces:**
- Consumes: Task 10's `PieceActionsBar` and `clampAnchor`; `SlotEditor` from `@/builder/panels/slots`.
- Produces: `SelectionAnchor({ piece, ...actions }): JSX.Element | null` — a drei `<Html>` wrapper. Untested by design; all its logic lives in `clampAnchor` and `PieceActionsBar`.

- [ ] **Step 1: Implement**

```tsx
import { Html } from '@react-three/drei'

<Html
  position={[centreX, tallestTopMm, centreZ]}
  center
  zIndexRange={[100, 0]}
  calculatePosition={(el, camera, size) => clampAnchor(projected(el, camera, size), size)}
>
  <PieceActionsBar piece={piece} slots={<SlotEditor … />} onTurn={…} onDelete={…} />
</Html>
```

No `occlude` — the bar must never hide behind geometry. No `distanceFactor` — constant pixel size.

Render it from `RoomSurface` when `resolveSelection(scene, tools.selected)` is non-null.

`SlotsPanel` loses its editing route: `editing`/`onEdit` and the overlay it opened go, since the bar hosts `SlotEditor` now. Keep the panel's per-piece listing if anything still reads it; if nothing does, delete the panel and its test rather than leaving a no-op.

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npx vitest run src/builder`
Expected: PASS. Then run the app and confirm the bar is clickable — this is the step that proves the Task 9 target guard:

```bash
npm run dev
```

Select a tile, click **Turn** on the bar, confirm the piece rotates.

- [ ] **Step 3: Hygiene and commit**

```bash
npm run lint -- --fix src/builder/three/SelectionAnchor.tsx src/builder/three/RoomSurface.tsx src/builder/panels/slots/SlotsPanel.tsx
npm run typecheck
npx vitest run src/builder
git add src/builder
git commit -m "feat(builder): anchor the action bar above the selected piece"
```

---

### Task 12: Two cues, two drawings

**Files:**
- Modify: `src/builder/three/markers.ts`, `src/builder/three/RoomSurface.tsx`
- Test: `src/builder/three/markers.test.ts`

**Interfaces:**
- Consumes: Task 7's `resolveSelection`.
- Produces: `selectionContour(parts): BufferGeometry` in `markers.ts`.

- [ ] **Step 1: Write the failing test**

```ts
it('traces the selection on the plan, from the same convex parts as the plate', () => {
  const geometry = selectionContour(planParts(shape, 0, 0, 0))
  expect(geometry.getAttribute('position').count).toBeGreaterThan(0)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/builder/three/markers.test.ts -t 'traces the selection on the plan'`
Expected: FAIL — `selectionContour` does not exist.

- [ ] **Step 3: Implement**

`selectionContour` builds a line loop from the parts, at `PLATE_HEIGHT_MM`, reusing the existing plate machinery. In `RoomSurface`, route the outline request: subjects are the **selection** when there is one, else the hover, with the colour switching to match — one request, one colour, pass untouched. Draw `selectionContour` under the selected piece so it stays visible while the pointer hovers elsewhere.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/builder/three/markers.test.ts`
Expected: PASS.

- [ ] **Step 5: Hygiene and commit**

```bash
npm run lint -- --fix src/builder/three/markers.ts src/builder/three/RoomSurface.tsx
npm run typecheck
npx vitest run src/builder/three
git add src/builder/three
git commit -m "feat(builder): mark the selection on the plan, and outline whichever cue is live"
```

---

### Task 13: Undo and redo in the toolbar

**Files:**
- Modify: `src/builder/panels/PlanToolbar.tsx`, `src/builder/three/RoomSurface.tsx`
- Test: `src/builder/panels/panels.test.tsx`

**Interfaces:**
- Consumes: Task 6's `useHistory`.

- [ ] **Step 1: Write the failing test**

```tsx
it('offers undo and redo, disabled until there is something to undo', () => {
  render(<PlanToolbar {...props} canUndo={false} canRedo={false} />)
  expect(screen.getByRole('button', { name: /undo/i })).toBeDisabled()
  expect(screen.getByRole('button', { name: /redo/i })).toBeDisabled()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/builder/panels/panels.test.tsx -t 'offers undo and redo'`
Expected: FAIL — no such buttons.

- [ ] **Step 3: Implement**

Two buttons on the toolbar. In `RoomSurface`'s key handler add `Ctrl`/`Cmd`+`Z`, `Ctrl`/`Cmd`+`Shift`+`Z` and `Ctrl`+`Y`, each announcing the returned `describeChange` sentence through the existing `say`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/builder/panels/panels.test.tsx`
Expected: PASS.

- [ ] **Step 5: Hygiene and commit**

```bash
npm run lint -- --fix src/builder/panels/PlanToolbar.tsx src/builder/three/RoomSurface.tsx
npm run typecheck
npx vitest run src/builder
git add src/builder
git commit -m "feat(builder): undo and redo from the toolbar and the keyboard"
```

---

### Task 14: The ghost tells the truth

**Files:**
- Modify: `src/builder/three/RoomSurface.tsx`, `src/builder/three/edits.ts`, `src/builder/three/Builder3DPanel.tsx`
- Test: `src/builder/three/edits.test.ts`

**Interfaces:**
- Consumes: Tasks 1-4, 7.
- Produces: `RoomSurface` takes a `catalog: PlanCatalog` prop; `templateGhost` returns a ghost carrying real parts and a `Conflict | null`.

- [ ] **Step 1: Write the failing test**

```ts
it('draws the armed template as its real parts, and says it is blocked', () => {
  const ghost = templateGhost(catalog, scene, cellHoldingAFloor, family, size, 0)
  expect(ghost.parts).toHaveLength(2)
  expect(ghost.conflict?.kind).toBe('exact')
})

it('gives a ghost real elevations, so its level is no longer unknown', () => {
  const ghost = templateGhost(catalog, scene, bareGround, family, size, 0)
  expect(ghost.parts.every((part) => part.layout.elevationMm >= 0)).toBe(true)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/builder/three/edits.test.ts -t 'draws the armed template as its real parts'`
Expected: FAIL — `templateGhost` takes no catalog and returns a cell marker.

- [ ] **Step 3: Implement**

Thread `PlanCatalog` from `BuilderScreen` through `Builder3DPanel` into `RoomSurface`. `templateGhost` solves the fill (memoised on `(family, size)`, as `fills.ts` already does), projects through `reanchorPiece`, and tests the projection against `sceneSubjects(scene)`. The ghost draws its real parts, hatched when blocked and lightly hatched when warned.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/builder/three`
Expected: PASS. Delete the docblock paragraph in `RoomSurface.tsx` describing the ghost as a cell marker and the blockers as open — they are closed by this task.

- [ ] **Step 5: Measure the hover cost**

Add a bench to the suite in the style of `fills.test.ts`'s existing `[fill]` log lines, reporting per-move cost with an armed family before and after. Record the numbers in the commit body; if a warm move exceeds 1 ms, stop and report rather than shipping it.

- [ ] **Step 6: Hygiene and commit**

```bash
npm run lint -- --fix src/builder/three
npm run typecheck
npx vitest run src/builder
git add src/builder
git commit -m "feat(builder): the ghost draws its real parts and says whether it lands clear"
```

---

### Task 15: Documentation catches up

**Files:**
- Modify: `docs/design-contract.md` (§2.4, §3), `README.md` (the "Room builder" bullet)

- [ ] **Step 1: Rewrite §2.4's centre-canvas paragraph**

It currently specifies a `Place` / `Erase` mode toggle. Replace with the toolbar as it ships: snap readout, rotate, undo, redo, clear.

- [ ] **Step 2: Rewrite §3's interaction inventory rows**

Replace the Place / Erase / Rotate / Orbit rows with the spec's two gesture tables, and add rows for Select, Deselect, Undo, Redo and the overlap refusal.

- [ ] **Step 3: Update the README bullet**

"place tiles on a grid, and the app resolves what physically connects to what" is still true; add that overlapping placements are refused where the geometry is exact.

- [ ] **Step 4: Verify and commit**

```bash
npm run verify:facts
git add docs/design-contract.md README.md
git commit -m "docs: describe the builder that ships"
```

---

## Final Verification

- [ ] `npm test` — expect 170+ files green, no failures
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] Manual pass in `npm run dev`: select, move, turn, delete, undo, redo; arm and place; try an overlapping placement and read the refusal; orbit with MMB while the room fills the viewport
- [ ] `wc -l src/builder/three/RoomSurface.tsx` — materially below 1,673
- [ ] Load a room saved before this branch and confirm it still draws and downloads
