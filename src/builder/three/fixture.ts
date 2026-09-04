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
 */
import type { PlanCatalog, PlanScene, PlanTools, SnapMode } from '@/builder/canvas'
import { SNAP_STEP, buildPlanScene, createStyleResolver } from '@/builder/canvas'
import { FIXTURE_SLOTS, fixtureFills, fixtureInstance } from '@/builder/canvas/fixture'
import type { CatalogRecord, TileId } from '@/catalog'
import type { TemplateId, TemplateInstance, WorkshopState } from '@/store'

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
  overrides: Partial<Pick<PlanTools, 'tool' | 'snap' | 'rotation'>> & {
    readonly selectedTemplate?: string | null | undefined
  } = {},
): PlanTools & { readonly calls: ToolCalls } {
  const snap: SnapMode = overrides.snap ?? 'fine'
  const calls: ToolCalls = { rotate: [], tool: [], snap: [], selected: [], toggledSnap: 0 }
  const selected = overrides.selectedTemplate ?? null
  return {
    tool: overrides.tool ?? 'place',
    snap,
    step: SNAP_STEP[snap],
    rotation: overrides.rotation ?? 0,
    selectedTemplate: selected === null ? null : (selected as TemplateId),
    setTool: (next) => calls.tool.push(next),
    toggleTool: () => calls.tool.push('toggle'),
    setSnap: (next) => calls.snap.push(next),
    toggleSnap: () => {
      calls.toggledSnap += 1
    },
    rotate: (step, direction = 1) => calls.rotate.push({ step, direction }),
    setRotation: () => undefined,
    setSelectedTemplate: (id) => calls.selected.push(id),
    calls,
  }
}
