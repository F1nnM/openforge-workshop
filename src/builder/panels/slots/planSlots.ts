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
 * sibling — 416 of 4,330 item picks corpus-wide, every one of them emptying the
 * `base` slot. {@link PlanSlotInventory.unfillable} counts the first; the
 * greying is the picker's and is shared rather than reimplemented, from
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
 * Row **C3** is what joins the two surfaces, and it owns whatever a pick here
 * writes.
 */
import type { CatalogFile, TileId } from '@/catalog'
import type { RecipeTemplate } from '@/screens/assemblies'
import type { SlotState } from '@/screens/detail/slots'
import { compositionIndexFor, slotStates } from '@/screens/detail/slots'
import type { PlacementId, SlotName, TemplateId, TemplateInstance } from '@/store'
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
  /** Its accessory slots, resolved with nothing picked. Never empty. */
  readonly slots: readonly SlotState[]
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
  const holders: PlanSlotHolder[] = []
  const orphans: string[] = []
  const names = new Map<string, number>()
  let slots = 0
  let required = 0
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
      if (aggregate === undefined) {
        // A fill this build has retired. One orphan entry per instance however
        // many of its fills are stranded: the panel's sentence is about a
        // placement it cannot describe, and saying it twice for one piece would
        // over-count the scene.
        stranded = true
        continue
      }
      const states = slotStates(index, fill.tile)
      if (states.length === 0) continue

      holders.push({
        id: `${id}|${slot}`,
        placement: id as PlacementId,
        instance,
        slot,
        parent: fill.tile,
        name: aggregate.name,
        slots: states,
      })
      for (const state of states) {
        slots += 1
        if (!state.optional) required += 1
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
    unfillable,
    byName: [...names.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    orphans,
  }
}

/* ------------------------------------------------------- the template's slots */

/**
 * One placed instance, summarised — the row the slot editor opens from.
 *
 * Deliberately **cheap**: a template lookup, a walk of the declared parts and a
 * map lookup per fill. No candidate resolution at all, because the panel renders
 * one of these per placement on every store write and
 * `slotEditor.ts#slotEditorModel` measures 4.1 ms median per instance. The
 * expensive model is built for the **open** instance only.
 */
export interface PlanPiece {
  /** The placement's key, which is also the React key: one row per instance. */
  readonly placement: PlacementId
  readonly instance: TemplateInstance
  /**
   * The recipe, or `undefined` when this build ships none by that id.
   *
   * The same three-state reading `resolveInstance` takes: a persisted scene can
   * name a retired family, and the honest answer is to say so rather than to
   * render an empty slot list.
   */
  readonly template: RecipeTemplate | undefined
  /** The family's own name, or the id when the build ships no such family. */
  readonly name: string
  /** Declared slots. 0 for an unknown template. */
  readonly slots: number
  /** Declared slots holding a fill this catalog still has a record for. */
  readonly filled: number
  /** Of those, the ones the user chose — `SlotFill.pinned`. */
  readonly pinned: number
  /** Declared slots with no fill, in declared order — §3.2's *needs a choice*. */
  readonly needsChoice: readonly SlotName[]
}

/**
 * Every placed instance, in plan reading order.
 *
 * The same depth-then-across order {@link planSlots} and `billInventory` use, so
 * a row here, a row in the bill and a piece on the drawing refer to the drawing
 * the same way.
 *
 * `templates` is a lookup rather than a table for `resolveInstance`'s reason: a
 * caller may back it with the screen's array, a map or a lazily loaded chunk,
 * and `undefined` is the honest answer for a retired family.
 */
export function planPieces(
  file: CatalogFile,
  placements: Readonly<Record<string, TemplateInstance>>,
  templates: (id: TemplateId) => RecipeTemplate | undefined,
): readonly PlanPiece[] {
  const byId = new Map(file.records.map((record) => [record.id, record]))
  const ordered = Object.entries(placements).sort(
    ([a, one], [b, two]) => one.z - two.z || one.x - two.x || a.localeCompare(b),
  )

  return ordered.map(([id, instance]) => {
    const template = templates(instance.template)
    const parts = template?.parts ?? []
    const needsChoice: SlotName[] = []
    let filled = 0
    let pinned = 0
    for (const part of parts) {
      const fill = instance.fills[part.name as SlotName]
      if (fill === undefined || !byId.has(fill.tile)) {
        needsChoice.push(part.name as SlotName)
        continue
      }
      filled += 1
      if (fill.pinned) pinned += 1
    }
    return {
      placement: id as PlacementId,
      instance,
      template,
      name: template?.name ?? instance.template,
      slots: parts.length,
      filled,
      pinned,
      needsChoice,
    }
  })
}
