/**
 * Putting a chosen thing on the plan — the destination row A0 left the drawer
 * and the guided-assembly screen without.
 *
 * Two surfaces lost their action to the library's deletion and both wanted the
 * same verb. §2.5's *"+ Add to library"* meant *these are the tiles I am going
 * to print*, and under the templates plan that is a **placed instance**: a
 * recipe with named slots, filled, on a cell. So this module is the one
 * implementation of that, and both callers pass what they have:
 *
 *   - the guided-assembly screen has a recipe and a file per part — a finished
 *     walk *is* an instance, so {@link placeOnPlan} is all it needs;
 *   - the tile drawer has one file and a family id, and asks
 *     {@link placeFileAsFamily} to put the file in that family's one slot.
 *
 * **Which family a lone file belongs to is not asked here.** It was, and the
 * rule was wrong: a `familyForRecord` that preferred the most specific family by
 * `require` count mis-filed **1,963 of 1,963 `shape|base` records** — a base
 * carries the role of the piece above it, so the three-ref `(role, form, build)`
 * key always beat the one-ref `shape|base` and every base would have been placed
 * as a wall. `builder/panels/familyKey.ts#armForTags` asks `shape|base` first
 * and is the single answer both drawer actions read; the two agreed on the other
 * 6,739 records and refused the same 285 inserts, so the whole disagreement was
 * the defect. What is left here is the one question the tags cannot answer — the
 * **name** of that family's single slot — and that is a table lookup.
 *
 * ## Why the cell comes from the plan's own collision predicate
 *
 * `freeCellFor` walks the scene with `subjectsConflict` — the same predicate
 * `buildPlanScene` then hatches conflicts with — so a cell it returns is never
 * one the drawing immediately marks in conflict. Re-deriving vacancy from the
 * placement coordinates alone would be a second, weaker copy of that: footprints
 * in this corpus run to 8 units across, so "no other placement is at this
 * coordinate" is not the same claim as "nothing overlaps here".
 *
 * The height is **0** and that is a real limitation rather than a default worth
 * hiding: `freeCellFor` tests a vertical interval, and a wall placed at height 0
 * competes for cells with a floor where the room's own sweep would let them
 * share one. It is the conservative direction — it can decline a cell that would
 * have worked, never accept one that would not — and closing it needs the
 * instance's parts resolved through B2's elevation rule, which is `@/builder/three`'s.
 *
 * ## The whole closure is behind a dynamic import for one of the two callers
 *
 * `@/builder/canvas` is the plan projection — geometry, sectors, overlap, the
 * scene — and the catalog route has no other reason to carry it. So the drawer
 * reaches this module with `await import('./placeOnPlan')` on the press, the
 * pattern `useArchiveDownload` already uses for row S5's pack, and the catalog
 * chunk is unchanged. The assemblies screen imports it directly, because it
 * already holds the family table this module reads.
 */
import {
  buildPlanScene,
  createStyleResolver,
  describeCell,
  footprintExtent,
  freeCellFor,
  planCatalogFromFile,
} from '@/builder/canvas'
/* The module and not `@/builder/panels`: that barrel is the bill panel, the
   download hook and the archive planner, and this chunk needs one array. */
import { PLACEABLE_TEMPLATES } from '@/builder/panels/families'
import type { CatalogFile, Footprint, TileId } from '@/catalog'
import type { PlacementId, SlotFill, SlotName, TemplateId } from '@/store'
import { SlotName as SlotNameSchema, TemplateId as TemplateIdSchema, placeTemplate, useWorkshopStore } from '@/store'

/** What to place: a family, and the file to pin into each of its slots. */
export interface PlanRequest {
  readonly template: string
  /** Part name to file. Every entry is written `pinned: true` — see {@link placeOnPlan}. */
  readonly fills: Readonly<Record<string, TileId>>
}

/** Where an instance landed. */
export interface PlanPlaced {
  readonly id: PlacementId
  readonly x: number
  readonly z: number
  /** `describeCell`'s wording, so every surface names a cell the same way. */
  readonly where: string
}

/**
 * Place a filled instance at a cell nothing else is using, and say where.
 *
 * Every fill is written **`pinned: true`**, and that is the honest reading in
 * both call sites: the user chose these files by hand, one card at a time, so a
 * lock change must not re-solve them (§2.1, contract **C-k**). The solver's
 * `auto` fills are C1's placement path, not this one.
 *
 * The store is read here rather than passed, because the caller that has the
 * choice does not have the room: the drawer is on `/catalog` and the assemblies
 * screen has no scene at all. `useWorkshopStore.getState()` is the same map
 * `usePlacements` subscribes to, read once, at the moment of the press.
 */
export function placeOnPlan(catalog: CatalogFile, request: PlanRequest): PlanPlaced {
  const state = useWorkshopStore.getState()
  const planCatalog = planCatalogFromFile(catalog)
  const scene = buildPlanScene(
    state.placements,
    planCatalog,
    createStyleResolver(planCatalog),
    state.generated,
  )

  const [x, z] = freeCellFor(scene, largestFoot(catalog, request.fills))

  const fills: Record<SlotName, SlotFill> = {}
  for (const [part, tile] of Object.entries(request.fills)) {
    fills[SlotNameSchema.parse(part)] = { tile, pinned: true }
  }

  /* The cell is returned rather than read back out of the store, and that is
     the whole reason this returns an object: both callers show *where* the piece
     landed, and both are on screens with no plan on them. Re-reading the
     instance to find a coordinate this function chose would be a round trip
     through `localStorage` for a number already in hand. */
  const id = placeTemplate({
    template: TemplateIdSchema.parse(request.template),
    x,
    z,
    // Unrotated: the instance is placed, and turning it is one press of `R` on
    // the drawing. Neither call site has an axis to align to — the drawer has no
    // scene and a finished recipe has no neighbours yet.
    rotation: 0,
    fills,
  })
  return { id, x, z, where: describeCell(x, z) }
}

/**
 * The biggest footprint among the fills, which is the instance's own.
 *
 * B2's slot offsets are not applied by the canvas yet — `originSlotLayout` puts
 * every part at the template's origin — so an instance covers exactly the union
 * of its parts at one point, and the union of concentric boxes is the largest of
 * them. Falls back to a 1 x 1 cell when nothing has a placeable footprint (32 of
 * 1,215 fills, `{ shape: 'none' }`), because a vacancy search still has to
 * return somewhere for a piece the plan cannot draw.
 */
function largestFoot(catalog: CatalogFile, fills: Readonly<Record<string, TileId>>): Footprint {
  const byId = new Map(catalog.records.map((record) => [record.id, record]))
  let best: Footprint = { shape: 'rect', w: 1, d: 1 }
  let area = 0
  for (const tile of Object.values(fills)) {
    const foot = byId.get(tile)?.foot
    if (foot === undefined) continue
    const extent = footprintExtent(foot)
    if (extent === undefined) continue
    const size = extent.w * extent.d
    if (size > area) {
      area = size
      best = foot
    }
  }
  return best
}

/* --------------------------------------------------------- one file's family */

/**
 * Put one file on the plan as its family's single slot.
 *
 * `template` comes from `familyKey.ts#armForTags`, which **constructs** the id
 * from the record's own axes and never reads the table — that is what keeps the
 * generated families out of the entry chunk (+5.95 kB gzip for every visitor,
 * A/B measured by that module). All this adds is the slot's *name*, which no tag
 * carries: `role|floor` says the family is `floor-straight`, and only the table
 * says its one part is called `floor`.
 *
 * Reading the table is free at this end because the drawer reaches this module
 * through `await import()`, so it lands in the pressed chunk rather than the
 * downloaded one — the catalog route's chunk is byte-identical with the button
 * present.
 *
 * `PLACEABLE_TEMPLATES` and not the two generated arrays, so there is one list:
 * row C1 exports it as *"the list `BuilderScreen`'s recipe table must be built
 * from"* and asserts its 91 members, and a second concatenation here is the
 * copy that would go stale when B5 takes the families to 52. Imported from the
 * module rather than from `@/builder/panels`, whose barrel is the bill panel and
 * the download hook.
 *
 * `undefined` for an id this build ships no family for, and for one whose family
 * declares anything other than a single part — a multi-slot recipe is not a
 * thing one file can be placed as, and the caller with the fills for all of them
 * calls {@link placeOnPlan} directly.
 */
export function placeFileAsFamily(
  catalog: CatalogFile,
  template: TemplateId,
  tile: TileId,
): (PlanPlaced & { readonly family: string }) | undefined {
  const family = PLACEABLE_TEMPLATES.find((one) => one.id === (template as string))
  const part = family?.parts[0]
  if (family === undefined || part === undefined || family.parts.length !== 1) return undefined
  return {
    ...placeOnPlan(catalog, { template: family.id, fills: { [part.name]: tile } }),
    family: family.name,
  }
}
