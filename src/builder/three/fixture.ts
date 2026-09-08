/**
 * The two things the 3D surface's tests need that no other fixture supplies: a
 * scene from a list of placements, and a `PlanTools` that is not a hook.
 *
 * `src/builder/canvas/fixture.ts` already provides the nine-record catalog, the
 * two template families, the five slot names and the slot-layout rule with real
 * offsets in it; every test in this directory uses it. This adds the surface's
 * own two inputs on top.
 *
 * `usePlanTools` cannot be called outside a component, and mounting a component
 * only to obtain a tool object would make every test that arms a template a
 * React test. {@link planTools} is the same shape as a plain object, with the
 * mutators recording rather than acting — which is also how a test asserts that
 * `R` on an armed template calls `rotate` with a step it did not invent.
 *
 * ## Row A4b: a fixture placement is an instance with a fill per slot
 *
 * Row **A1** replaced the placement with a {@link TemplateInstance}, so
 * `{ tileId, x, z }` no longer describes anything the store can hold: a file is
 * what fills a *slot*, and the thing on the grid is a family with a fill map.
 * {@link FixturePlacement} therefore takes `fills` — slot/file pairs — and keeps
 * a single-`tile` shorthand for the many tests whose subject is one outline and
 * for which a five-part instance would be noise. The shorthand fills the `floor`
 * slot, which is the one slot **40 of the 40 shipped templates carry**.
 *
 * `fixtureDesignOf` is gone with the field it bridged to. A test names the file
 * it means and {@link recordOf} looks it up directly, because since A1
 * `PlanCatalog.record` takes a `TileId` (decision **D1**).
 *
 * ## Row C5: a third input, because placing now solves a fill
 *
 * `RoomSurface` and `BuilderRoom` take the three authorities C2's solver walks,
 * and they are **required** props precisely so a caller cannot forget them — so
 * every test that mounts either needs one. {@link fixtureAuthorities} builds a
 * real one over the eleven-record catalog: a real `buildAssemblyIndex`, a real
 * `createCompositionIndex` and a two-slot template, so a fixture click exercises
 * the same solve the app does rather than a stub that always answers the same
 * thing. Eleven records is 0.1 ms of index build, which is why a real one is
 * affordable where the archive's 8,702 would not be.
 */
import type { AssemblyTemplate } from '@/assembly'
import { buildAssemblyIndex } from '@/assembly'
import type { PlanCatalog, PlanScene, PlanTools, PositionAxis, SnapMode } from '@/builder/canvas'
import { SNAP_STEP, buildPlanScene, createStyleResolver } from '@/builder/canvas'
import {
  FIXTURE_SLOTS,
  FIXTURE_TEMPLATE,
  fixtureCatalogFile,
  fixtureFills,
  fixtureInstance,
} from '@/builder/canvas/fixture'
import type { CatalogFile, CatalogRecord, TileId } from '@/catalog'
import { buildAggregateIndex } from '@/catalog'
import { createCompositionIndex } from '@/composition'
import type { TemplateId, TemplateInstance, WorkshopState } from '@/store'

import type { FillAuthorities, PlacementFiller } from './fills'
import { createPlacementFiller } from './fills'

/**
 * A fixture id as the branded `TileId` the catalog and the store want.
 *
 * `FIXTURE_IDS` holds plain string literals — it is a `const` object of paths,
 * not of branded values — so every test that fills a slot or looks a record up
 * would otherwise carry its own cast. One here, named, rather than nine.
 */
export function tileId(id: string): TileId {
  return id as TileId
}

/**
 * A fixture record by plain **file** id.
 *
 * One map lookup since row A1: a `SlotFill` names an exact file, so there is no
 * aggregate hop left to make and `PlanCatalog.record` takes the file id itself.
 */
export function recordOf(catalog: PlanCatalog, id: string): CatalogRecord | undefined {
  return catalog.record(tileId(id))
}

/**
 * One template instance, as the store holds it — or its one-file shorthand.
 *
 * Exactly one of `tile` and `fills` says what is in it. `tile` is the shorthand:
 * one file in the `floor` slot, for a test whose subject is a single outline.
 * `fills` is the real shape — slot name and file id per pair — and is what a test
 * about *N parts per placement* uses. Neither is an instance with no filled slots
 * at all, which is `PlanScene.unfilled` and is reached by passing `{ x, z }`.
 *
 * Every field is `?: T | undefined` rather than `?: T`, because this project sets
 * `exactOptionalPropertyTypes`; `src/builder/canvas/fixture.ts` sets out why at
 * length.
 */
export interface FixturePlacement {
  /** Shorthand: this file in the `floor` slot. Mutually exclusive with `fills`. */
  readonly tile?: string | undefined
  /** `[slot, file]` pairs. The real shape of an instance's fill map. */
  readonly fills?: readonly (readonly [string, string])[] | undefined
  readonly x: number
  readonly z: number
  readonly rotation?: number | undefined
  /** Defaults to `FIXTURE_TEMPLATE`. */
  readonly template?: string | undefined
}

/** The `[slot, file]` pairs one fixture placement means. */
function fillsOf(one: FixturePlacement): readonly (readonly [string, string])[] {
  if (one.fills !== undefined) return one.fills
  return one.tile === undefined ? [] : [[FIXTURE_SLOTS.floor, one.tile]]
}

/** A placements map, keyed `p0`, `p1`, … */
export function placementsOf(placed: readonly FixturePlacement[]): WorkshopState['placements'] {
  const map: Record<string, TemplateInstance> = {}
  placed.forEach((one, index) => {
    const id = `p${String(index)}`
    map[id] = fixtureInstance(id, fixtureFills(fillsOf(one)), {
      x: one.x,
      z: one.z,
      rotation: one.rotation,
      template: one.template,
    })
  })
  return map
}

/**
 * A scene, built the way the app builds it.
 *
 * Through `buildPlanScene` and `createStyleResolver` rather than by hand, so a
 * fixture scene carries the real conflict sweep, the real per-part geometry and
 * the real resolved styles. A hand-built scene would let a test pass against a
 * conflict set the app would never produce.
 *
 * The slot layout is the **catalog's** and not this function's —
 * `planCatalogFromFile` takes the `SlotLayoutRule` — so a test that wants the
 * offsets and elevations of `fixtureSlotLayout` builds its catalog with it, and
 * one that wants every part at the instance origin passes nothing.
 */
export function sceneOf(catalog: PlanCatalog, placed: readonly FixturePlacement[]): PlanScene {
  return buildPlanScene(placementsOf(placed), catalog, createStyleResolver(catalog))
}

/** What {@link planTools} recorded. */
export interface ToolCalls {
  readonly rotate: { step: number; direction: 1 | -1 }[]
  readonly tool: string[]
  readonly snap: SnapMode[]
  readonly selected: (string | null)[]
  /** Row C5: the size positions the palette armed. */
  readonly armedPosition: { readonly axis: PositionAxis; readonly tags: readonly string[] }[]
  toggledSnap: number
}

/**
 * A `PlanTools` that records instead of setting state.
 *
 * `selectedTemplate` takes a plain string and brands it here, for `tileId`'s
 * reason: a `TemplateId` is an opaque brand over a string and a test naming
 * `FIXTURE_TEMPLATE` should not have to say so twice.
 */
export function planTools(
  overrides: Partial<Pick<PlanTools, 'tool' | 'snap' | 'rotation' | 'armedPosition'>> & {
    readonly selectedTemplate?: string | null | undefined
  } = {},
): PlanTools & { readonly calls: ToolCalls } {
  const snap: SnapMode = overrides.snap ?? 'fine'
  const calls: ToolCalls = { rotate: [], tool: [], snap: [], selected: [], armedPosition: [], toggledSnap: 0 }
  const selected = overrides.selectedTemplate ?? null
  return {
    tool: overrides.tool ?? 'place',
    snap,
    step: SNAP_STEP[snap],
    rotation: overrides.rotation ?? 0,
    selectedTemplate: selected === null ? null : (selected as TemplateId),
    /* Row C5's other half of *what is armed*, and since the recipe fold every
       axis of it at once. A plain field, defaulting to the palette's `any size`
       position — which is `[]` and a real position rather than an absence, so a
       test that says nothing about it still exercises the path a user who never
       touched a control takes. */
    armedPosition: overrides.armedPosition ?? [],
    setTool: (next) => calls.tool.push(next),
    toggleTool: () => calls.tool.push('toggle'),
    setSnap: (next) => calls.snap.push(next),
    toggleSnap: () => {
      calls.toggledSnap += 1
    },
    rotate: (step, direction = 1) => calls.rotate.push({ step, direction }),
    setRotation: () => undefined,
    setSelectedTemplate: (id) => calls.selected.push(id),
    setArmedPosition: (axis, tags) => calls.armedPosition.push({ axis, tags }),
    calls,
  }
}

/* -------------------------------------------------------------- the fill solve */

/**
 * A two-slot template for {@link FIXTURE_TEMPLATE}, over the fixture's own tags.
 *
 * `floor` and `right wall`, in that order, because those are the two `shape|`
 * tags the
 * eleven records carry more than one of — so the walk has something to order and
 * something to skip. **No `base`**, deliberately: the fixture has no
 * `shape|base` record, and a slot that could never fill would make every fixture
 * placement report a gap that says nothing about the test.
 *
 * The second name **contains a space**, which is the property the canvas fixture
 * exists to keep in play — 8 of the corpus's 128 parts carry one — and it is
 * what a memo key joined on a printable delimiter would get wrong.
 *
 * `{ floor, right wall }` is also not a part-name set `rules.ts` has a
 * convention for,
 * so `layoutFor` answers `undefined` and a fixture fill carries no B2 doubts.
 * That is the right default here: the doubts are C2's own measurement and
 * `fills.test.ts` exercises them against a template that *has* a layout.
 */
export const FIXTURE_FILL_TEMPLATE: AssemblyTemplate = {
  id: FIXTURE_TEMPLATE,
  tags: ['object|tile'],
  parts: [
    { name: FIXTURE_SLOTS.floor, tags: { require: [{ tag: 'shape|floor' }] } },
    { name: FIXTURE_SLOTS.rightWall, tags: { require: [{ tag: 'shape|wall' }] } },
  ],
}

/**
 * The three authorities a surface needs, over the eleven-record catalog.
 *
 * Real indexes and a real lookup rather than stubs — see the module note. Only
 * {@link FIXTURE_TEMPLATE} resolves, so a test can also exercise the
 * `unknown-template` arm by arming `OTHER_FIXTURE_TEMPLATE`, which is a state
 * C1 measured over the real table (all 51 generated families report it against
 * the 40-recipe one) rather than an invented failure.
 */
export function fixtureAuthorities(file: CatalogFile = fixtureCatalogFile()): FillAuthorities {
  const composition = createCompositionIndex(file, buildAggregateIndex(file))
  return {
    index: buildAssemblyIndex(file),
    templates: (id) => (id === FIXTURE_TEMPLATE ? FIXTURE_FILL_TEMPLATE : undefined),
    composition,
  }
}

/** {@link fixtureAuthorities} as the filler `RoomSurface` takes. */
export function fixtureFiller(file?: CatalogFile): PlacementFiller {
  const authorities = file === undefined ? fixtureAuthorities() : fixtureAuthorities(file)
  return createPlacementFiller({
    index: authorities.index,
    context: { templates: authorities.templates, composition: authorities.composition },
  })
}
