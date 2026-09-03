/**
 * The two things the 3D surface's tests need that no other fixture supplies: a
 * scene from a list of placements, and a `PlanTools` that is not a hook.
 *
 * `src/builder/canvas/fixture.ts` already provides the nine-record catalog and
 * every test in this directory uses it; this adds the surface's own two inputs.
 *
 * `usePlanTools` cannot be called outside a component, and mounting a component
 * only to obtain a tool object would make every test that wants to arm a tile a
 * React test. {@link planTools} is the same shape as a plain object, with the
 * mutators recording rather than acting — which is also how a test asserts that
 * `R` on an armed tile calls `rotate` with the *tile's own* step rather than 90.
 */
import type { PlanCatalog, PlanScene, PlanTools, SnapMode } from '@/builder/canvas'
import { SNAP_STEP, buildPlanScene, createStyleResolver } from '@/builder/canvas'
import { fixtureDesignOf } from '@/builder/canvas/fixture'
import type { CatalogRecord, TileId } from '@/catalog'
import type { Placement, PlacementId, WorkshopState } from '@/store'

/**
 * A fixture id as the branded `TileId` the catalog and the store want.
 *
 * `FIXTURE_IDS` holds plain string literals — it is a `const` object of paths,
 * not of branded values — so every test that arms a tile or looks a record up
 * would otherwise carry its own cast. One here, named, rather than nine.
 */
export function tileId(id: string): TileId {
  return id as TileId
}

/**
 * A fixture record by plain **tile** id.
 *
 * Hops through `fixtureDesignOf` because `PlanCatalog.record` takes a
 * `DesignId` since row V4. A test still names the tile it means: every record
 * in the canvas fixture is its own design, so the conversion is total and
 * injective and asking for `FIXTURE_IDS.floor1` returns that record.
 */
export function recordOf(catalog: PlanCatalog, id: string): CatalogRecord | undefined {
  return catalog.record(fixtureDesignOf(id))
}

/**
 * One placement, as the store holds it.
 *
 * Still keyed by **tile** id, deliberately: a test says which tile it is
 * putting down, and {@link placementsOf} resolves that to the design the store
 * has held since row V4. Renaming the field would have rewritten every call
 * site across five suites to buy nothing, the fixture's records being
 * one-to-one with its designs.
 */
export interface FixturePlacement {
  readonly tileId: string
  readonly x: number
  readonly z: number
  readonly rotation?: number
}

/** A placements map, keyed `p0`, `p1`, … */
export function placementsOf(placed: readonly FixturePlacement[]): WorkshopState['placements'] {
  return Object.fromEntries(
    placed.map((one, index) => [
      `p${String(index)}` as PlacementId,
      { design: fixtureDesignOf(one.tileId), x: one.x, z: one.z, rotation: one.rotation ?? 0 } satisfies Placement,
    ]),
  )
}

/**
 * A scene, built the way the app builds it.
 *
 * Through `buildPlanScene` and `createStyleResolver` rather than by hand, so a
 * fixture scene carries the real conflict sweep, the real paint order and the
 * real resolved styles. A hand-built scene would let a test pass against a
 * conflict set the app would never produce.
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

/** A `PlanTools` that records instead of setting state. */
export function planTools(
  overrides: Partial<Pick<PlanTools, 'tool' | 'snap' | 'rotation' | 'selectedDesign'>> = {},
): PlanTools & { readonly calls: ToolCalls } {
  const snap: SnapMode = overrides.snap ?? 'fine'
  const calls: ToolCalls = { rotate: [], tool: [], snap: [], selected: [], toggledSnap: 0 }
  return {
    tool: overrides.tool ?? 'place',
    snap,
    step: SNAP_STEP[snap],
    rotation: overrides.rotation ?? 0,
    selectedDesign: overrides.selectedDesign ?? null,
    setTool: (next) => calls.tool.push(next),
    toggleTool: () => calls.tool.push('toggle'),
    setSnap: (next) => calls.snap.push(next),
    toggleSnap: () => {
      calls.toggledSnap += 1
    },
    rotate: (step, direction = 1) => calls.rotate.push({ step, direction }),
    setRotation: () => undefined,
    setSelectedDesign: (id) => calls.selected.push(id),
    calls,
  }
}
