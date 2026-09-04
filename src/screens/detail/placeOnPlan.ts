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
 *   - the tile drawer has one file and no recipe, so it asks
 *     {@link familyForRecord} first. B4's 51 generated families are one-slot
 *     each, keyed on `(role, form, build)`, so a file that is in one of those
 *     pools *is* a placeable instance of it.
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
import type { CatalogFile, CatalogRecord, Footprint, TileId } from '@/catalog'
import { resolveTags } from '@/catalog'
import type { RecipeTemplate } from '@/screens/assemblies'
import { GENERATED_FAMILIES } from '@/screens/assemblies'
import type { PlacementId, SlotFill, SlotName } from '@/store'
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

/** A one-slot family that admits a file, and the slot it admits it into. */
export interface RecordFamily {
  readonly template: RecipeTemplate
  readonly slot: string
}

/**
 * The generated family a single file can be placed as, or `undefined`.
 *
 * Exact tag equality, which is what `@/composition` does — `require` is an
 * intersection over the interned tag table and `deny` a subtraction — so this
 * asks the same question a candidate walk would and needs no postings index for
 * a population of one. All 51 of B4's families carry exactly **one** part, so
 * there is no sibling to satisfy and nothing to solve.
 *
 * **The most specific family wins**, counted in `require` refs, then the id for
 * determinism. That matters on the bases: a base for a wall run carries
 * `shape|base` *and* `role|wall`, so it is in the pool of both `shape-base` and
 * a `wall-…` family, and the three-ref `(role, form, build)` key is the one that
 * says what the piece is for. A tie between two families of the same width
 * cannot happen on the shipped table — the keys are disjoint by construction —
 * and the id tie-break is there so that a future table cannot make the answer
 * depend on array order.
 *
 * `undefined` is a real answer and the reason is measured: B5's 52 families
 * reach **99.0% of records**, the remainder being the 84 no square lattice can
 * place. A file this returns nothing for is one the builder genuinely cannot
 * hold, and the caller says so rather than inventing a family for it.
 */
export function familyForRecord(catalog: CatalogFile, record: CatalogRecord): RecordFamily | undefined {
  const tags = new Set(resolveTags(catalog, record))
  let best: RecordFamily | undefined
  let refs = -1

  for (const family of GENERATED_FAMILIES) {
    const part = family.parts[0]
    if (part === undefined || family.parts.length !== 1) continue
    const require = part.tags.require ?? []
    if (!require.every((ref) => tags.has(ref.tag))) continue
    if ((part.tags.deny ?? []).some((ref) => tags.has(ref.tag))) continue
    if (require.length > refs || (require.length === refs && best !== undefined && family.id < best.template.id)) {
      refs = require.length
      best = { template: family, slot: part.name }
    }
  }
  return best
}
