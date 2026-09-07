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
 * **The scene is projected with the rule the builder draws with.** Since row C7
 * that is {@link SLOT_LAYOUT} and not `planCatalogFromFile`'s `originSlotLayout`
 * default — see that constant for why it is threaded even though C6 and C7 both
 * measured the vacancy answer *invariant* between the two rules.
 *
 * The probe's height is **0**, and that limitation outlived the wiring with a
 * different cause. `freeCellFor` takes a `heightMm` and fixes the probe's
 * underside at `elevationMm: 0`, so the probe is the ground level; and no
 * catalog record carries a height at all, which `overlap.ts` states as
 * *"`heightMm` is `0` on every catalog record"*. So the parts B2 lifts one base
 * thickness are invisible to it. That is **not** the conservative direction — a
 * lifted floor cannot decline a cell — and what keeps it sound is the
 * ground-level identity {@link largestFoot} measures. Even where that failed,
 * `buildPlanScene`'s own sweep hatches the result, so the error would surface as
 * a visible conflict rather than a silent overlap. Closing it needs a probe that
 * can be placed vertically, which is `freeCellFor`'s signature to widen and
 * `@/builder/canvas`'s to own.
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
  templateSlotLayout,
} from '@/builder/canvas'
/* The module and not `@/builder/panels`: that barrel is the bill panel, the
   download hook and the archive planner, and this chunk needs one array. */
import { PLACEABLE_TEMPLATES } from '@/builder/panels/families'
import type { CatalogFile, Footprint, TileId } from '@/catalog'
import type { PlacementId, SlotFill, SlotName, TemplateId } from '@/store'
import { SlotName as SlotNameSchema, TemplateId as TemplateIdSchema, placeTemplate, useWorkshopStore } from '@/store'

/** The 91 placeable families by id — one lookup for both of this module's uses. */
const RECIPES = new Map(PLACEABLE_TEMPLATES.map((one) => [one.id, one]))

/**
 * **Row B2's conventions, as this module's second composition site.**
 *
 * `BuilderScreen.tsx` composes the same rule from the same table, and until row
 * C7 this module composed nothing: `planCatalogFromFile` defaulted to
 * `originSlotLayout`, so the scene a drop was tested against put every part of
 * every placement at its instance's origin while the surface drew them where
 * B2's conventions say they stand. C6 named that and could not reach it.
 *
 * ## Threading it changes no answer, and that is measured rather than assumed
 *
 * The vacancy answer is **invariant** between the two rules. Over a sequential
 * walk placing all 91 families C1's palette offers — each solved at `any size`
 * through `three/fills.ts#createPlacementFiller`, each committed to the plan
 * before the next is searched for — the two rules chose **the same cell 91 times
 * out of 91**, spread over 75 distinct cells. Two arithmetic facts carry it, and
 * both are the reason rather than a coincidence:
 *
 *   - **A piece's union box is the same either way** — 0 mismatches over all 91
 *     families at all four quarter turns. Of those 364 projections **344 draw a
 *     piece**; the other 20 are 5 one-slot families whose solved fill is a
 *     footprint-less record, and they draw nothing under either rule.
 *     `templateSlotLayout` insets each part *within* the instance's declared
 *     `cell`, which is the `floor` fill's footprint on all three conventions, so
 *     the union cannot grow past the box the concentric parts already spanned.
 *   - **A wired instance's ground level still covers that whole box** — 344 of
 *     those 344, none of them with no ground-level part at all. That is what
 *     makes the elevation-0 probe of the module note sound: the `base` is the
 *     slot B2 rests on the ground, and it is the slot that carries the cell.
 *
 * **So the rule is threaded for the seam and not for the answer.** The two facts
 * above are properties of these 40 recipes and this solver's choices — a fourth
 * convention, or a base a user picks narrower than its floor through C3's slot
 * editor, would break the second one. With the rule threaded, that changes what
 * this module tests and what the surface draws *together*, and neither has to be
 * re-measured against the other. It also costs all but nothing:
 * `templateSlotLayout`, `@/template/rules` and `@/template/offsets` were already
 * in this chunk through the `@/builder/canvas` barrel, so `placeOnPlan-*.js`
 * goes **99.76 → 99.83 kB, 13.66 → 13.68 kB gzip** — 70 bytes, which is the
 * composition itself and not a new edge. The catalog route's chunk is
 * **byte-identical** (`catalog-DmjWqxvD.js`, 99.56 kB), which is what the
 * `await import()` below is for.
 *
 * The part-name list is the one thing `templateSlotLayout` needs that the canvas
 * cannot see — `catalog.ts` sets out at length why it must not reach the family
 * table beside a screen — and this module already holds that table for
 * {@link placeFileAsFamily}. Composed once at module scope rather than per call:
 * it closes over {@link RECIPES} alone, and `planCatalogFromFile` builds the
 * per-`(fills, slot)` memo that actually matters on each call anyway.
 */
const SLOT_LAYOUT = templateSlotLayout((id) => RECIPES.get(id)?.parts.map((part) => part.name))

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
  const planCatalog = planCatalogFromFile(catalog, SLOT_LAYOUT)
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
 * **B2's slot offsets *are* applied now — row C6 wired them and
 * {@link SLOT_LAYOUT} threads them here — and this is still the instance's
 * footprint.** It was written when `originSlotLayout` put every part at the
 * template's origin, where the union of concentric boxes is trivially the
 * largest of them. The wired rule insets each part inside the instance's
 * declared `cell`, which is the `floor` fill's own footprint on all three
 * conventions, so it can only ever shrink a part's reach inside a box the
 * concentric layout already spanned. Measured rather than argued: **0 union-box
 * mismatches** between the two rules over all 91 placeable families at all four
 * quarter turns.
 *
 * The same measurement covers the elevation-0 probe the module note relies on:
 * the union of an instance's **ground-level** parts equals its whole union box
 * on 344 of 344 (86 fillable families x 4 rotations), because the slot B2 rests
 * on the ground is the `base` and the base carries the cell.
 *
 * Falls back to a 1 x 1 cell when nothing has a placeable footprint (32 of 1,215
 * fills, `{ shape: 'none' }`), because a vacancy search still has to return
 * somewhere for a piece the plan cannot draw. It compares *areas* through
 * `footprintExtent` and returns the {@link Footprint} — not the extent — so
 * `freeCellFor` tests the real outline: on the one `diag` family among the 91,
 * `run: 2.828`, the bounding extent is 2.353 and the drawn quad is neither.
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
 * the download hook. Read through {@link RECIPES}, which is the same list keyed
 * by id — {@link SLOT_LAYOUT} needs a lookup over it per `(fills, slot)` and two
 * scans of one array would be two chances to disagree.
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
  const family = RECIPES.get(template)
  const part = family?.parts[0]
  if (family === undefined || part === undefined || family.parts.length !== 1) return undefined
  return {
    ...placeOnPlan(catalog, { template: family.id, fills: { [part.name]: tile } }),
    family: family.name,
  }
}
