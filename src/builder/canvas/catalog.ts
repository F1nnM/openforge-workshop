/**
 * What the canvas needs from the catalog, and nothing more.
 *
 * The store holds identities; the records they name are looked up by the caller
 * (`src/store/index.ts` is explicit about that split). So the canvas takes a
 * small injected view of the catalog rather than a `CatalogFile`, for three
 * reasons:
 *
 *   - **A test can supply six records.** The real index is 5.6 MB and 88 ms to
 *     parse; a component test has no business fetching it.
 *   - **De-interning is memoised where it is paid for.** `resolveMaterial` wants
 *     tag *strings* and a record holds tag *ids*; the catalog screen already
 *     memoises that per record and the builder should share the same shape of
 *     answer rather than invent a second cache.
 *   - **No dependency on a screen.** Row 13 owns `src/screens/catalog/`, which
 *     is where the app's memoised index lives today, and the 40-template family
 *     table lives beside it in `src/screens/assemblies/templates.ts`; the builder
 *     canvas importing from a sibling screen would couple two PRs that have no
 *     business knowing about each other. The builder screen passes one of these
 *     in.
 *
 * ## Row A4a: this interface is where an **instance** becomes N records
 *
 * Row V4 wrote *"this interface is where a design becomes a record"*, because a
 * placement named one `DesignId` and a renderer needs one {@link CatalogRecord}.
 * Row **A1** replaced the placement with a {@link TemplateInstance}: a family,
 * one rotation, and a fill per named slot, each fill naming an **exact file**. So
 * the hop is no longer one-to-one and the interface is widened rather than
 * repointed:
 *
 *   - {@link PlanCatalog.record} takes a {@link TileId}. A fill names a file, so
 *     this is a map lookup and nothing more.
 *   - {@link PlanCatalog.parts} takes a whole instance and returns **one entry
 *     per filled slot**, each carrying the slot it came from, the fill that
 *     filled it, the record that file resolves to, and the {@link SlotLayout}
 *     that says where inside the template it sits.
 *
 * Keeping both hops *here* is what keeps the change cheap above: `buildPlanScene`
 * still takes `(placements, catalog, style, generated)`, and `PlanScene` still
 * has `pieces`, `generated`, `conflicts` and `bounds`. What moved is one level
 * down — a `PlanPiece` now has `parts`, and a part has the `record`.
 *
 * ## The lock hop is gone, and that is decision D1 rather than a simplification
 *
 * V4 resolved a design through `selectVariantForLock` here, so that *"the mesh in
 * the room and the line in the bill are the same file"*, and memoised this view
 * on the lock because of it. A1's `SlotFill` names a `TileId` **and carries
 * `pinned`**: the file is chosen at fill time, and re-solving an `auto` fill after
 * a lock change is a store write (contract **C-k**) rather than a read-time
 * guess. `src/store/schema.ts` states the consequence — *"a saved room is
 * deterministic: a re-import cannot silently change what it contains"* — and a
 * canvas that still resolved a variant per render would contradict it, showing
 * one file and pricing another the moment the two disagreed.
 *
 * So `planCatalogFromFile` no longer takes a `lock`, and no longer takes the
 * `aggregates` index it needed to find a design's variants. Both are deleted
 * rather than accepted and ignored, so a caller still passing one is a compile
 * error instead of a preference silently doing nothing. Rule 0 of
 * `src/assembly/resolve.ts` dies for the same reason and by the same decision.
 *
 * ## What is still true of the plan view
 *
 * `foot`, `kinds` and `name` are hoisted facets — A1 measures **zero** aggregates
 * holding two distinct values of any of them — so every variant of an item draws
 * the same outline, and the outlines V4 could not have moved this row cannot
 * either. What changed is *how many* outlines an instance has.
 */
import type { CatalogFile, CatalogRecord, TileId } from '@/catalog'
import { resolveTags } from '@/catalog'
import type { ContourStyle, MaterialId } from '@/materials'
import { resolveMaterial } from '@/materials'
import type { SlotFill, SlotName, TemplateId, TemplateInstance } from '@/store'
import { filledSlots } from '@/store'

import type { Footprint } from '@/catalog'
import type { SlotName as PartName } from '@/template/rules'
import { layoutFor } from '@/template/rules'
import type { PlacedTemplate } from '@/template/offsets'
import { placeTemplateSlots, slotDoubtSentence, slotElevationMm } from '@/template/offsets'

import type { SlotLayout } from './geometry'
import { ORIGIN_LAYOUT, footprintShape, rotatedExtent } from './geometry'

/**
 * Every **filled** slot of one instance whose file this build holds, by slot.
 *
 * **The seam widened, and row A10 named the reason before row C6 needed it.**
 * The rule used to receive one {@link CatalogRecord} — the fill of the slot
 * being laid out — and that is not enough information to place it. B2's
 * arithmetic insets a part from the template's *cell*, and the cell is the
 * resolved footprint of a **different** slot (`TemplateLayout.cell`, `floor` on
 * all three conventions): an `edge` inset is `-(cellD - partD) / 2` and a
 * `corner` inset is the same on both axes, so laying out a `wall` requires the
 * `floor` fill. Row A10 stated it as *"the seam must widen to the instance's
 * whole fill map"* and `fixture.ts#FIXTURE_CELL` is that limitation surfacing in
 * a fixture. This is the widening.
 *
 * Filled-and-resolved only: a slot whose fill names a file this index has
 * retired is {@link StrandedSlotPart} and is deliberately absent, because a
 * base that is not in this build is not there to stand on either. So a rule
 * reading this map sees exactly what the canvas can draw.
 */
export type SlotRecords = ReadonlyMap<SlotName, CatalogRecord>

/**
 * How one part of one template is laid out, given the whole instance's fills.
 *
 * **The seam row B2 lands in, and row C6 wired.** B2 owns `src/template/**` and
 * the `SlotRule` model; its offsets are computed at fill time *from the fills'
 * own footprints*, which is why the records are an argument and not just the
 * slot name — §1.4 measured the `base` slot admitting 25 distinct footprints and
 * `wall` 14, so `('base', anything)` has no single answer.
 *
 * A function rather than an import, for this module's third reason: the family
 * table is beside a screen, {@link templateSlotLayout} needs the part names off
 * it, and the canvas must reach neither. The builder screen composes them and
 * passes the result here, exactly as it already does for the catalog file
 * itself.
 */
export type SlotLayoutRule = (template: TemplateId, slot: SlotName, fills: SlotRecords) => SlotLayoutAnswer

/**
 * A rule's answer for one slot: where it sits, or why it sits nowhere.
 *
 * **A union rather than `SlotLayout | undefined`, for the reason
 * {@link StrandedSlotPart} is a union member and not an optional field.** Row
 * D8: the rule really does have slots it cannot place — a `diag` wall fill has
 * no straight run to lie along, and 104 of B2's 1,215 walked combinations are
 * that case — and the answer it used to give was `dx = dz = 0`, which stacked
 * every such part on the cell's own corner. An optional layout would have let a
 * caller keep drawing at the origin by accident; a refusal that carries its own
 * sentence makes the caller say what it does about it, and gives it the words.
 */
export type SlotLayoutAnswer = SlotLayout | SlotRefusal

/**
 * No position exists for this slot, and the sentence that says why.
 *
 * `refused` is `template/offsets.ts#slotDoubtSentence` of the doubt that caused
 * it — the same wording C3's slot editor mounts, so the plan surface and the
 * editor do not describe one fault two ways.
 */
export interface SlotRefusal {
  readonly refused: string
}

/** Whether a rule's answer is a position. Narrows {@link SlotLayoutAnswer}. */
export function isSlotLayout(answer: SlotLayoutAnswer): answer is SlotLayout {
  return !('refused' in answer)
}

/**
 * Every part at the instance origin — the answer for a template with no
 * convention.
 *
 * See {@link ORIGIN_LAYOUT} for what it is right about and what it is not. It is
 * still the default so that a test with eleven records, and the landing hero,
 * need no template knowledge at all — neither has any — and it is what
 * {@link templateSlotLayout} itself returns for the 51 generated families, which
 * is why this row is a **no-op** for them: C2 measured 0 of 51 with a part-name
 * set `rules.ts` has a convention for, and a one-slot family needs none, because
 * `slotOffset` answers `[0, 0]` for a `cell` anchor before it ever reads a cell.
 */
export function originSlotLayout(): SlotLayout {
  return ORIGIN_LAYOUT
}

/**
 * How high one base lifts whatever stands on it: **6 mm**, normalised.
 *
 * The only elevation quantity the three shipped conventions ever ask for. Every
 * `restsOn` in `rules.ts` is either `null` or `base` — `base` rests on the
 * ground, and the `floor`, `wall`, `column` and left/right-wall slots all rest
 * on the `base` — so `slotElevationMm` calls its height reader **exactly once
 * per lifted part, always for the `base` slot**, over all 128 parts of all 40
 * recipes. `plan.test.ts` asserts that over `SLOT_CONVENTIONS` rather than
 * restating it, so a fourth convention that rested a part on something else
 * fails there.
 *
 * ## Measured, and the measurement is committed
 *
 * `src/template/corpus.test.ts` — *"puts every measured base on z = 0 at about
 * 6 mm, which is what a floor is lifted by"* — joins the 1,963 `layer: 'base'`
 * records to `tools/measure/measurements.json` and finds **343 measured**, all
 * 343 authored on z = 0, **279 (81.3%) within 0.015 mm of 6.000 mm** and 295
 * (86.0%) below 6.1 mm; the remaining 48 are 12 each at 12.70, 25.40, 38.10 and
 * 50.80, which are stacked bases and risers rather than a slab. The same file
 * measures the other side of the same 6 mm independently: of 583 measured
 * `topper` records, **107 (18.4%) are authored already one base thickness up**,
 * at a median of exactly 6.0000 mm.
 *
 * ## Why it is one number and not a lookup
 *
 * Because there is nothing to look up. `catalog.json` carries **no height at
 * all** — a record holds `foot`, `kinds`, `layer` and 14 further fields and not
 * one of them is a `y` extent — and the sidecar that does is a 952 kB dev-tool
 * artefact covering **1,284 of 8,702 records (14.8%)** that nothing under
 * `src/**` reads. So for the other 85.2% there is no measurement to prefer, and
 * a rule that read the sidecar where it existed would place two congruent bases
 * at two different heights depending on whether row W1 happened to have fetched
 * them.
 *
 * It would also be the *wrong* number even where it exists: §2.2 and §9 measured
 * 18.4% of `openforge` toppers authored pre-lifted by exactly this 6 mm and
 * 77.5% not, so a lift taken off a mesh encodes that inconsistency into the
 * room. Row **A4b** deleted `three/bases.ts#baseElevationMm` — which read the
 * resting mesh's own upright height — precisely so that
 * {@link SlotLayout.elevationMm} would be the single elevation source, and
 * `place.ts` normalising each mesh to `-upright.min.y` before applying the lift
 * is what makes one normalised number sound. This is that number, and there is
 * no second.
 */
export const BASE_LIFT_MM = 6

/**
 * B2's conventions, composed with the canvas's own placement: **the rule the app
 * runs.**
 *
 * `parts` is the part-name list of one template, or `undefined` when this build
 * ships no such recipe. Injected rather than imported for the module note's
 * third reason — the 91-entry family table lives beside a screen
 * (`src/screens/assemblies/templates.ts`), `BuilderScreen.tsx` already holds a
 * lookup over it for the bill and for `reSolveScene`, and the canvas must not
 * reach a sibling screen. It is the *only* thing this rule needs that the canvas
 * cannot see.
 *
 * ## The three answers, and where each comes from
 *
 *   - **`dx`/`dz`** — `placeTemplateSlots` returns a **centre-to-centre** offset
 *     from the template's centre and {@link SlotLayout} wants the part's
 *     **minimum corner** measured from the cell's. The conversion is exact and is
 *     the one `offsets.test.ts` states and measures:
 *     `dx = offset.x - drawn.w / 2 + cell.w / 2`, where `drawn` is
 *     `rotatedExtent(extent, yaw + intrinsic angle)` so a `diag`'s own 45° is
 *     carried. **Never snapped** — §2.2: every offset is a multiple of 0.25, the
 *     `edge` inset takes the four values `-1.25`, `-0.75`, `-0.25`, `0` over the
 *     1,006 closing combinations, and three of the four are off the 0.5 lattice
 *     the *origin* snaps to. `snapTo(-0.75, 0.5)` is `-0.5`, and a quarter unit
 *     is the difference between a wall flush against a floor and a wall a quarter
 *     unit inside it.
 *   - **`rotation`** — `slotYaw`, i.e. `side * 90`, straight off the placement.
 *   - **`elevationMm`** — `slotElevationMm` walking `restsOn` to the ground, with
 *     {@link BASE_LIFT_MM} supplied for a resting slot that is **filled** and 0
 *     for one that is not. That second half is a real behaviour rather than a
 *     guard; see {@link liftOf}.
 *
 * Every layout also carries {@link SlotLayout.cell}, the same extent for
 * every part of the instance, which is what makes the template a rigid body
 * under rotation — row A10's invariant, and `three/instances.test.ts`'s *"keeps
 * its footprint area across quarter turns"* is the guard on it.
 *
 * ## What it does with a slot B2 refuses to place
 *
 * `placeTemplateSlots` is partial by design: a slot with no footprint, no
 * straight run along its face, or a cell slot that is not a rectangle earns a
 * `SlotDoubt` and **no coordinate**. This rule then answers {@link SlotRefusal}
 * carrying that doubt's own sentence, and `scene.ts` puts the part in
 * `PlanScene.undrawable` and draws nothing for it.
 *
 * **It used to answer `dx = dz = 0` instead, and that was the defect row D8
 * fixed.** The old answer stacked every refused part on the cell's own corner
 * *unrotated*, so a template with two refused parts drew them through each
 * other. It reached a user: the project owner placed
 * `S2W: Wall on Tile: Corner (Any, Single Piece)`, whose two 2-unit walls both
 * earned `over-run want 2 got 2.5`, and reported *"the individual things filling
 * the slots were overlapping and not in the right position"*. A part a user can
 * see is missing is honest; a pile is a picture of something nobody can build,
 * which is the *"plausible room nobody chose"* failure the plan names as this
 * model's new risk.
 *
 * The `over-run` half of that is fixed upstream — `placeTemplateSlots` now
 * *places* an over-running part at its anchored face and keeps the doubt as a
 * warning, because the runs missing the face by 0.5 does not mean the part has
 * nowhere to go. So the 4 `over-run` doubts over the 40 recipes are still
 * reported, still not repaired with a fabricated offset (*"the mitre is in no
 * tag and no measurement. Do not silently write 1.5."*), and now drawn where
 * they belong. The doubt reaches the user where it can be acted on —
 * `three/fills.ts` announces it on the click and C3's slot editor mounts
 * `slotDoubtSentence` — rather than by moving geometry.
 *
 * ## Cost
 *
 * `placeTemplateSlots` is a linear walk over at most five rules, and
 * {@link planCatalogFromFile} memoises this rule per `(instance fills, slot)`
 * for the life of the catalog view. So a room of forty instances evaluates it
 * once per distinct fill map per slot — five walks per configuration, ever — not
 * once per frame.
 */
export function templateSlotLayout(
  parts: (template: TemplateId) => readonly PartName[] | undefined,
): SlotLayoutRule {
  return (template, slot, fills) => {
    const names = parts(template)
    const layout = names === undefined ? undefined : layoutFor(names)
    // No recipe, or a recipe with no convention — B4's 51 one-slot families, and
    // `rules.ts` is explicit that a missing convention has no fallback. Every
    // part at the origin is what this build already draws for them, and it is
    // right: one slot is its own cell.
    if (layout === undefined) return ORIGIN_LAYOUT

    const elevationMm = slotElevationMm(layout, slot, (resting) => liftOf(fills.get(resting as SlotName)))
    const placed = placeTemplateSlots(layout, footprintsOf(fills))
    const cell = placed.cell
    const placement = placed.slots.find((one) => one.part === slot)
    const record = fills.get(slot)
    const shape = record === undefined ? undefined : footprintShape(record.foot)
    if (cell === undefined || placement === undefined || shape === undefined) {
      return { refused: refusalFor(placed, slot) }
    }

    // The one line row A10 wrote out and did not wire: a centre `o` in the
    // cell-centre frame is the minimum corner `o - E / 2 + cell / 2` in the
    // cell-corner frame, where `E` is the part's extent **as drawn**.
    const drawn = rotatedExtent(shape.extent, placement.yaw + shape.angle)
    return {
      dx: placement.offset[0] - drawn.w / 2 + cell.w / 2,
      dz: placement.offset[1] - drawn.d / 2 + cell.d / 2,
      rotation: placement.yaw,
      elevationMm,
      cell,
    }
  }
}

/**
 * How high the fill of one resting slot lifts what stands on it.
 *
 * {@link BASE_LIFT_MM} when that slot is filled, **0 when it is not** — which is
 * a real behaviour and not a guard, and it is the whole reason the reader takes
 * the fills rather than a constant: a `wall-on-tile` instance whose `base` slot
 * needs a choice has nothing under its floor, and drawing the floor 6 mm up
 * would be a picture of a base nobody chose.
 *
 * **It does not read the record**, and that is deliberate. The *recipe* says
 * what a resting slot holds: every non-null `restsOn` over all three conventions
 * names `base`, `rules.ts` derives that slot's anchor from *"every candidate is
 * `layer === 'base'`"* on 40 of 40 templates, and row **A9** measured
 * `layer === 'base'` exactly coextensive with `shape|base` at 1,963 records both
 * ways. So a record read here would be a second opinion able to disagree with
 * the convention, and it would be wrong in exactly one direction: a fill the
 * recipe put in a base slot that this reader declined to call a base would drop
 * the floor into it. `plan.test.ts` pins the `restsOn === 'base'` invariant, so a
 * fourth convention that rested a part on something else fails loudly instead of
 * silently collecting a base's thickness.
 */
function liftOf(record: CatalogRecord | undefined): number {
  return record === undefined ? 0 : BASE_LIFT_MM
}

/**
 * Why one slot got no position, in the words the slot editor already uses.
 *
 * The doubt naming this slot when there is one; otherwise the cell slot's, which
 * is the case where the *cell* failed and took every other slot with it — a
 * `floor` fill that is not a rectangle has no faces for anything to anchor to,
 * so blaming the wall would be wrong and saying nothing would be worse.
 *
 * The fallback sentence is unreachable through {@link templateSlotLayout}: it is
 * only called when `placeTemplateSlots` produced no placement for the slot, and
 * every such path pushes a doubt for either the slot or the cell. It is a real
 * sentence rather than a `throw` because a caller reading it would be looking at
 * a plan, not a stack trace.
 */
function refusalFor(placed: PlacedTemplate, slot: SlotName): string {
  const own = placed.doubts.find((doubt) => doubt.part === slot)
  const doubt = own ?? placed.doubts[0]
  if (doubt === undefined) return `The ${slot} part has no position in this recipe, so it is not drawn.`
  return slotDoubtSentence(doubt)
}

/** The fills as `placeTemplateSlots` wants them: one footprint per filled slot. */
function footprintsOf(fills: SlotRecords): ReadonlyMap<PartName, Footprint> {
  const feet = new Map<PartName, Footprint>()
  for (const [slot, record] of fills) feet.set(slot, record.foot)
  return feet
}

/** What every part carries, resolved or not: which slot, and what filled it. */
export interface PlanSlotPartBase {
  readonly slot: SlotName
  /** The fill as the store holds it — the file, and whether the user chose it. */
  readonly fill: SlotFill
}

/** A part whose file this build holds. */
export interface ResolvedSlotPart extends PlanSlotPartBase {
  readonly kind: 'resolved'
  readonly record: CatalogRecord
  /** Where inside the template it sits, and how high it stands. */
  readonly layout: SlotLayout
}

/**
 * A part whose file this build does not hold.
 *
 * Reachable from a *valid* persisted scene — a share link or a room saved last
 * month can name a file this index has retired — so it is a value rather than an
 * exception, and it is a **separate member of a union** rather than a
 * `record: CatalogRecord | undefined` field. That is hazard 2 of this epic in
 * miniature: an optional record type-checks at every downstream property access
 * and draws nothing, where a discriminated union makes the reader say what it
 * does about the miss. `scene.ts` puts these in `PlanScene.unknown`.
 */
export interface StrandedSlotPart extends PlanSlotPartBase {
  readonly kind: 'stranded'
}

/**
 * A part this build holds and the recipe has nowhere to put.
 *
 * The third member, added by row **D8**, and the reason it exists is that the
 * second-best answer was measurably terrible: the rule used to hand such a part
 * `dx = dz = 0` and every one of them drew stacked on the cell's own corner,
 * unrotated. `scene.ts` puts these in `PlanScene.undrawable` beside the `none`
 * footprints, which is the list that already means *"this fill is real and the
 * plan cannot show it"*.
 *
 * The `record` is carried because the omission names the file and the tile's own
 * name; the {@link SlotLayout} is not, because there is none — that is the whole
 * content of this case.
 */
export interface UnplaceableSlotPart extends PlanSlotPartBase {
  readonly kind: 'unplaceable'
  readonly record: CatalogRecord
  /** Why, from {@link SlotRefusal.refused}. Already a whole sentence. */
  readonly reason: string
}

/** One filled slot of an instance, de-referenced. */
export type PlanSlotPart = ResolvedSlotPart | StrandedSlotPart | UnplaceableSlotPart

/** The catalog, as the canvas sees it. */
export interface PlanCatalog {
  /**
   * The record for one **file**, or `undefined` when this build does not hold it.
   *
   * A {@link TileId} since row A4a, because a {@link SlotFill} names a file
   * (decision **D1**). No lock preference is applied — see the module note.
   */
  record(tile: TileId): CatalogRecord | undefined
  /** That record's tags as strings, for the material registry. */
  tags(record: CatalogRecord): readonly string[]
  /**
   * Every **filled** slot of one instance, in a deterministic order.
   *
   * One entry per key of `instance.fills`, resolved or stranded. Slots the
   * template declares and this instance has *not* filled are deliberately absent
   * and are not this interface's business: an unfilled slot is an ordinary state
   * of an instance (contract **C-g**, §3.2 *"places anyway"*), the party that can
   * enumerate them is the party holding the family table, and that party is
   * `src/builder/panels/slots/` — the surface whose whole job is *needs a
   * choice*. The canvas draws what is there.
   */
  parts(instance: TemplateInstance): readonly PlanSlotPart[]
}

/**
 * A {@link PlanCatalog} over a validated index, with every lookup memoised.
 *
 * Cheap to call repeatedly — it builds its map once — but not free, so the
 * builder screen should build it beside its own memoised index rather than inside
 * a component body.
 *
 * **It is no longer memoised on the lock, because it no longer reads one.** See
 * the module note: a fill names an exact file, so there is no variant to choose
 * and nothing about this view goes stale when the preference changes.
 *
 * `layout` is the {@link SlotLayoutRule}, defaulting to
 * {@link originSlotLayout} — {@link templateSlotLayout} is the one the app runs.
 * It is memoised per `(instance fills, slot)` rather than per call: the canvas
 * re-projects the whole scene on every store write, and a room of 40 instances at
 * 5 parts each would otherwise evaluate 200 rules per frame.
 *
 * **The key is the whole fill map since row C6**, and it has to be: the rule's
 * answer for the `wall` slot is a function of the `floor` fill, so a key of
 * `(template, slot, file)` would hand a 2 x 2 corner's wall the inset computed
 * for the 4 x 4 corner placed before it. Twenty placements of one configuration
 * are still one evaluation per slot, which is what the memo is for.
 */
export function planCatalogFromFile(file: CatalogFile, layout: SlotLayoutRule = originSlotLayout): PlanCatalog {
  const byId = new Map<string, CatalogRecord>(file.records.map((record) => [record.id, record]))
  const tags = new Map<string, readonly string[]>()
  const layouts = new Map<string, SlotLayoutAnswer>()

  const view: PlanCatalog = {
    record(tile) {
      return byId.get(tile)
    },
    tags(record) {
      let cached = tags.get(record.id)
      if (cached === undefined) {
        cached = resolveTags(file, record)
        tags.set(record.id, cached)
      }
      return cached
    },
    parts(instance) {
      // Sorted by slot name, and that is determinism and nothing more. The
      // template's *declared* order needs the family table, which this module
      // must not reach; and there is no paint order left for it to matter to —
      // row R4 deleted the 2D painter and a pick in 3D is a raycast, so the
      // nearest hit wins by geometry rather than by list position.
      const slots = filledSlots(instance.fills).sort((a, b) => a.localeCompare(b))
      // Resolved *before* the layout loop, because the rule is a function of the
      // whole map and not of one entry — see {@link SlotRecords}. A stranded fill
      // is absent from it rather than present as a hole, so a rule cannot mistake
      // a retired base for a base that is there.
      const records = new Map<SlotName, CatalogRecord>()
      for (const slot of slots) {
        const fill = instance.fills[slot]
        if (fill === undefined) continue
        const record = view.record(fill.tile)
        if (record !== undefined) records.set(slot, record)
      }
      // The instance's own half of the memo key, computed once for its five
      // slots. JSON-encoded rather than joined on a separator: two of the six
      // shipped part names contain a space and a `TileId` is a path with slashes,
      // dots and percent signs in it, so there is no punctuation character left
      // that is provably absent from all three. `slots` is already sorted, so two
      // instances of one configuration produce one string.
      const signature = JSON.stringify([instance.template, slots.map((slot) => [slot, records.get(slot)?.id])])

      const parts: PlanSlotPart[] = []
      for (const slot of slots) {
        const fill = instance.fills[slot]
        if (fill === undefined) continue
        const record = records.get(slot)
        if (record === undefined) {
          parts.push({ kind: 'stranded', slot, fill })
          continue
        }
        // `NUL`-joined onto the signature, which is JSON and so holds no raw
        // control byte of its own — written as the escape and never as the byte.
        const key = `${signature}\u0000${slot}`
        // A refusal is a real cached answer, so the miss test stays `undefined`:
        // `SlotLayoutAnswer` is never `undefined` and re-deriving a refusal every
        // frame would defeat the memo for exactly the templates that need it.
        let answer = layouts.get(key)
        if (answer === undefined) {
          answer = layout(instance.template, slot, records)
          layouts.set(key, answer)
        }
        if (!isSlotLayout(answer)) {
          parts.push({ kind: 'unplaceable', slot, fill, record, reason: answer.refused })
          continue
        }
        parts.push({ kind: 'resolved', slot, fill, record, layout: answer })
      }
      return parts
    },
  }
  return view
}

/**
 * How a piece is drawn: a fill, a contour, and the contour's style.
 *
 * **Both halves are used, and that is a WCAG obligation rather than a
 * preference.** `src/materials/palette.ts`: meeting 1.4.11's 3:1 against the
 * parchment well with fills alone would force every material below L* 50, which
 * destroys plaster, sandstone and ice. So silhouette is carried by `edge` and
 * identity by `tint`, and a canvas that filled without stroking would be
 * inaccessible by construction.
 */
export interface PlanStyle {
  readonly material: MaterialId
  readonly tint: string
  readonly edge: string
  readonly contour: ContourStyle
  /** The material's own label, e.g. "Dungeon stone" — for announcements. */
  readonly label: string
}

/**
 * A memoised `record → style` resolver.
 *
 * Keyed on the tile id rather than on the material, because the input to
 * `resolveMaterial` is the whole tag list and the resolution walks an ordered
 * six-stage fallback. 8,702 tiles collapse to 16 families, so the cache is
 * small; the point of it is that the canvas re-renders on every store write and
 * a room of 200 placements would otherwise run 200 resolutions per frame — and
 * since row A1 a placement is up to five parts, so the same room is up to 1,000.
 */
export function createStyleResolver(catalog: PlanCatalog): (record: CatalogRecord) => PlanStyle {
  const cache = new Map<string, PlanStyle>()
  return (record) => {
    let style = cache.get(record.id)
    if (style === undefined) {
      const family = resolveMaterial(catalog.tags(record), record.file).family
      style = {
        material: family.id,
        tint: family.tint,
        edge: family.edge,
        contour: family.contour,
        label: family.label,
      }
      cache.set(record.id, style)
    }
    return style
  }
}
