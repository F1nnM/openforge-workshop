/**
 * Which accessory slots a drawing has left open.
 *
 * The bill of tiles answers *what do I print for the pieces I placed*. It cannot
 * answer *what do those pieces hold*, because a composition slot is not a
 * placement: `buildBillOfTiles` walks `Object.values(placements)` and a torch in
 * a wall's `torch` slot was never placed on the grid. So this module is the
 * plan-side view of row C2's resolution, and it is a **pure function of the
 * placements and the index** — no store writes, no assembly, no routing.
 *
 * ## What the corpus says a plan will actually run into
 *
 * Measured over all 8,702 files:
 *
 *   - **1,005 (11.5%) carry at least one accessory slot.** 2,031 carry only a
 *     `base` slot, which is A6's base match and not an accessory, and 5,666
 *     carry no config at all.
 *   - Accessory slots per file: **1 on 767 files, 2 on 237, 3 on one**. Nothing
 *     in the archive opens a fourth, which is why this panel needs no
 *     virtualisation and no "show more".
 *   - **1,047 of the 1,244 accessory declarations are required** — `optional` is
 *     absent, and absence means required. Only 197 are optional. So an unfilled
 *     accessory slot is usually a *hole in the print*, not a decoration
 *     declined, and {@link PlanSlotInventory.required} is the number this panel
 *     leads with.
 *
 * ## Dead ends reach the plan, and 9 slots cannot be filled at all
 *
 * The same two failures the drawer's picker shows arrive here per fill:
 * **9 of the 1,244 accessory declarations have no candidate whatsoever** in
 * their initial state (5 `fracture slope`, 4 `top`), and a pick can empty a
 * sibling *accessory* slot — which nothing in this corpus does: all 416 of the
 * 4,330 item picks that empty anything empty the host's own `base` part, and the
 * base is the room's slot rather than a sibling of an accessory (F2).
 * {@link PlanSlotInventory.unfillable} counts the first; the greying is the
 * picker's and is shared rather than reimplemented, from
 * `@/screens/detail/slots`.
 *
 * ## A holder is a **filled template slot**, not a placement, since row A8
 *
 * A placement used to be one design, so *"which file's slots do we show"* was a
 * question — answered by `selectVariantForLock`, because `config` is one of the
 * fields that differ between an item's variants. A template instance holds up to
 * five slots and each one names an **exact file** (decision **D1**), so the
 * question is gone twice over: there is no variant to pick, and there is no one
 * file per placement to pick it for. This walks the fills.
 *
 * That makes the lock preference irrelevant here and the parameter is deleted
 * rather than ignored. It also means one instance can contribute several
 * holders — a wall-on-tile corner with a torch bracket in the wall and a grate in
 * the floor is two — which is why {@link PlanSlotHolder.id} is no longer the
 * store's key on its own.
 *
 * **A template's own slots are not these.** `resolveInstance` walks the recipe's
 * declared parts and reports the empty ones as `slot-unfilled`; this walks the
 * *composition* slots the already-chosen files declare, one level further in.
 *
 * ## It now reports what is *in* them, and what each one costs
 *
 * A holder used to be the open question alone. Since the store grew
 * `SlotFill.holds` it carries the answer too — {@link PlanSlotHolder.holds} is
 * the accessory in each slot, and {@link PlanSlotHolder.mounts} is how many
 * copies of it the bill charges for. Both are read off the same two values the
 * assembly resolver reads (`SlotFill.holds` and `mountsFor`), which is what makes
 * the panel's count and the bill's `×4` one number rather than two.
 */
import type { CatalogFile, CatalogRecord, TileId } from '@/catalog'
import { isModelledIn, mountsFor } from '@/catalog'
import type { SlotState } from '@/screens/detail/slots'
import { compositionIndexFor, slotStates } from '@/screens/detail/slots'
import type { HoldFill, HoldName, PlacementId, SlotName, TemplateInstance } from '@/store'
import { filledSlots } from '@/store'

/** One filled template slot whose file opens at least one accessory slot. */
export interface PlanSlotHolder {
  /**
   * A key unique within the inventory: the placement's key in
   * `WorkshopState.placements`, then the slot name.
   *
   * Not the placement key alone, because one instance can hold several files
   * that each declare an accessory slot — see the module note. Composed here
   * rather than left to the renderer so that the order and the key come from one
   * pass.
   */
  readonly id: string
  /** The placement's own key, for a caller that wants to address the instance. */
  readonly placement: PlacementId
  readonly instance: TemplateInstance
  /** Which slot of the recipe this file fills. */
  readonly slot: SlotName
  /**
   * The file whose accessory slots these are.
   *
   * The fill's own `tile`, with no resolution step at all: a {@link SlotFill}
   * names a file, so the file being printed is the file in the scene. The picker
   * resolves against this — `config` is a property of a file, which is the whole
   * reason `CompositionIndex.resolve` takes a `TileId` parent.
   */
  readonly parent: TileId
  /**
   * The item's display name.
   *
   * Two hops — file to variant to aggregate — because `name` is a hoisted facet
   * of the *item* and a fill names a file. Either hop can miss for a retired id,
   * and both misses are the same orphan.
   */
  readonly name: string
  /** Its accessory slots, resolved against what the fill already holds. Never empty. */
  readonly slots: readonly SlotState[]
  /**
   * What the fill holds now — `SlotFill.holds`, straight through.
   *
   * `undefined` is *nobody has looked yet* and `{}` is *solved, and nothing is in
   * it*; the two are different states of one fill and the schema keeps them
   * apart, so this passes both on rather than folding them. The panel reads it
   * for one thing: the picker's displayed selection is what the piece holds, so
   * the grid and the room cannot disagree.
   */
  readonly holds: Readonly<Record<HoldName, HoldFill>> | undefined
  /**
   * Measured mounts on this file, by accessory slot name.
   *
   * `mountsFor(record, slot).length` — the *places* an accessory attaches, which
   * is the `quantity` `resolveInstance` bills for a hold on every mount but one:
   * a `wide` doorway is one opening authored for two leaves, so a bill sums
   * `catalog/mounts.ts#copiesOf` over these rather than counting them. The row
   * says *how many mounts*, which is what it is named for and what the drawing
   * shows.
   * `0` is the ordinary reading rather than an error: `CatalogRecord.mounts` is
   * absent both for an unmeasured host and for one with no accessory slot, and
   * the archive carries no measurement until `npm run mounts` has walked it.
   */
  readonly mounts: Readonly<Record<string, number>>
  /**
   * Slots of this file whose accessory is **already part of its mesh** —
   * `CatalogRecord.modelledIn`, measured.
   *
   * Still listed in {@link PlanSlotHolder.slots}, because a slot that offers
   * nothing and says nothing is a grid the user cannot account for; the row says
   * *built into this piece* instead. Not counted as a hole either:
   * `assembly/resolve.ts` does not read one as a hole, and a panel that did
   * would report an incomplete print the bill is happy with.
   */
  readonly modelledIn: readonly string[]
}

/** What a drawing's compositions add up to. */
export interface PlanSlotInventory {
  /** Placed pieces that open an accessory slot, in plan reading order. */
  readonly holders: readonly PlanSlotHolder[]
  /** Accessory slots the plan opens, across every holder. */
  readonly slots: number
  /**
   * Of those, the ones the fixture does **not** mark optional.
   *
   * The headline: 1,047 of the corpus's 1,244 accessory declarations are
   * required, so this is usually the same as {@link slots} and it is the number
   * that means "this print is incomplete".
   */
  readonly required: number
  /**
   * Of the required ones, the ones **holding nothing this build can print** —
   * the plan-side count of `billView.ts`'s `hole` fault, on the same condition:
   * the slot is empty, or the accessory in it has left the archive.
   *
   * The number the summary leads with, because it is the only one that changes
   * as the user works: `required` is a property of the archive and cannot be
   * worked down, and a panel that quoted it after every slot was filled would
   * report a finished piece as an outstanding task.
   */
  readonly holes: number
  /**
   * Slots holding an accessory **this build still has a record for**, required or
   * not. Equal to {@link slots} when the plan is finished.
   */
  readonly filled: number
  /**
   * Slots no file in the archive can fill, before anything is picked.
   *
   * 9 corpus-wide. Counted separately from `required` because it is an archive
   * gap and not a task: nothing the user can do in this panel will close one.
   */
  readonly unfillable: number
  /** Slot names the plan opens, with how many of each. Descending count, then name. */
  readonly byName: readonly { readonly name: string; readonly count: number }[]
  /**
   * Placement keys holding a fill the index no longer has a record for — the
   * bill's orphan case, one entry per instance however many of its fills are
   * stranded.
   */
  readonly orphans: readonly string[]
}

/**
 * The plan's open accessory slots.
 *
 * One pass over the instances, one over each instance's fills, and one
 * composition resolution per filled file that declares a slot. The resolution is
 * the expensive-sounding half and is not: a full slot resolution measures
 * **0.09 ms mean, 2.3 ms worst** over the real corpus, and only 11.5% of files
 * reach it at all.
 *
 * Ordered by depth then across, and within one instance by slot name — the same
 * plan reading order `billInventory` uses, so a row in this panel and a row in
 * the bill refer to the drawing the same way, plus a total tie-break so two runs
 * over one scene produce the same list.
 *
 * **No lock parameter, and that is not an omission.** It took one, to pick which
 * variant of a placed design to read `config` off. A fill names the file, so
 * there is nothing to pick and a preference could only be ignored. See the module
 * note.
 */
export function planSlots(
  file: CatalogFile,
  placements: Readonly<Record<string, TemplateInstance>>,
): PlanSlotInventory {
  const index = compositionIndexFor(file)
  const records = recordsOf(file)
  const holders: PlanSlotHolder[] = []
  const orphans: string[] = []
  const names = new Map<string, number>()
  let slots = 0
  let required = 0
  let holes = 0
  let filled = 0
  let unfillable = 0

  const ordered = Object.entries(placements).sort(
    ([, a], [, b]) => a.z - b.z || a.x - b.x,
  )

  for (const [id, instance] of ordered) {
    let stranded = false
    for (const slot of filledSlots(instance.fills).sort((a, b) => a.localeCompare(b))) {
      const fill = instance.fills[slot]
      if (fill === undefined) continue
      const variant = index.aggregates.byTile.get(fill.tile)
      const aggregate = variant === undefined ? undefined : index.aggregates.byDesign.get(variant.design)
      const record = records.get(fill.tile)
      if (aggregate === undefined || record === undefined) {
        // A fill this build has retired — the aggregate index and the record
        // list are built from the same file, so a miss in either is one fill the
        // index no longer holds. One orphan entry per instance however
        // many of its fills are stranded: the panel's sentence is about a
        // placement it cannot describe, and saying it twice for one piece would
        // over-count the scene.
        stranded = true
        continue
      }
      // Resolved against what is already in it, so a slot the piece has filled
      // shows its pick rather than an empty grid — and so a sibling's candidates
      // are narrowed by the accessory that is actually there.
      const states = slotStates(index, fill.tile, holdSelection(fill.holds))
      if (states.length === 0) continue

      holders.push({
        id: `${id}|${slot}`,
        placement: id as PlacementId,
        instance,
        slot,
        parent: fill.tile,
        name: aggregate.name,
        slots: states,
        holds: fill.holds,
        mounts: Object.fromEntries(
          states.map((state) => [state.name, mountsFor(record, state.name).length]),
        ),
        modelledIn: states.filter((state) => isModelledIn(record, state.name)).map((state) => state.name),
      })
      for (const state of states) {
        slots += 1
        // A slot the host has built in is not an open question: nothing fills
        // it, nothing is missing from the print, and the bill agrees.
        if (isModelledIn(record, state.name)) continue
        if (!state.optional) required += 1
        // **A hold this build cannot resolve is not a filled slot**, and the
        // condition is the resolver's rather than a second reading of it:
        // `resolveInstance` refuses the download for a required hold whose
        // `record` is missing — empty *or* naming a retired file — and
        // `billView.ts#holeFaults` faults exactly that. Counting a retired hold
        // as filled here is how this panel came to say *all filled* over a scene
        // the bill panel was refusing. The picker agrees: a retired id matches no
        // card, so such a slot renders with nothing chosen.
        //
        // `chosen` rather than `holds` because the states above were resolved
        // against the holds, so this cannot give a second answer.
        const holding = state.chosen === undefined ? undefined : records.get(state.chosen)
        if (holding === undefined && !state.optional) holes += 1
        if (holding !== undefined) filled += 1
        if (state.deadEnd) unfillable += 1
        names.set(state.name, (names.get(state.name) ?? 0) + 1)
      }
    }
    if (stranded) orphans.push(id)
  }

  return {
    holders,
    slots,
    required,
    holes,
    filled,
    unfillable,
    byName: [...names.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    orphans,
  }
}

/* ------------------------------------------------------------- the lookups */

/**
 * Records by catalog id, built once per file.
 *
 * `mountsFor` takes a {@link CatalogRecord} and `CompositionIndex` holds none —
 * it works in `TileId`s and tag postings — so this is the join. A `WeakMap` for
 * `compositionIndexFor`'s reason: the map is 8,702 entries, `planSlots` runs on
 * every store write, and keying on the parsed file pays for it once and lets it
 * be collected with the file.
 */
const RECORDS = new WeakMap<CatalogFile, ReadonlyMap<string, CatalogRecord>>()

function recordsOf(file: CatalogFile): ReadonlyMap<string, CatalogRecord> {
  const cached = RECORDS.get(file)
  if (cached !== undefined) return cached
  const built = new Map(file.records.map((record) => [record.id as string, record]))
  RECORDS.set(file, built)
  return built
}

/**
 * A fill's holds as the picker's selection: slot name to the file in it.
 *
 * Exported because both readers of {@link PlanSlotHolder.holds} need exactly this
 * shape — this module resolves each slot against it, and `AccessorySection.tsx`
 * hands it to the picker as the selection to display. Two copies would be two
 * chances for the grid to show something the resolution did not see.
 */
export function holdSelection(
  holds: Readonly<Record<HoldName, HoldFill>> | undefined,
): Readonly<Record<string, TileId>> {
  return Object.fromEntries(Object.entries(holds ?? {}).map(([hold, held]) => [hold, held.tile]))
}
