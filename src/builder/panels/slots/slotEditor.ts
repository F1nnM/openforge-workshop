/**
 * The slot editor's model — §3.3, headless.
 *
 * The row's subject in the owner's own words: *"The menu to customize the slots
 * of a template should come up with a right click. It should be filterable by
 * design, and then allow me to choose from all potential matches based on the
 * slot to fill and size and design."* This module answers the second and third
 * clauses; `SlotEditor.tsx` is the control and `SlotsPanel.tsx` owns the
 * gesture.
 *
 * ## Nothing here is a second copy of the walk
 *
 * A placed instance is a template plus a fill per slot, and the guided-assembly
 * screen already resolves exactly that shape: {@link assemblyState} takes a
 * `RecipeTemplate` and an {@link AssemblyChoice} — part name to `TileId` — and
 * returns one step per declared part with its candidate **items**, its dead ends
 * greyed before they are pressed, what each card would narrow, and what each
 * card would open. `TemplateInstance.fills` *is* an `AssemblyChoice` with the
 * `pinned` bit stripped, so this module maps the store's shape onto that walk
 * and adds the four things the walk has no opinion about:
 *
 *   1. the **design filter** — §1.6's texture family, which is what makes the
 *      grid tractable (394 (part, family) buckets, median 8 items, p90 36
 *      against 428 unfiltered);
 *   2. the **refusal** — a pick that would invalidate a *sibling's existing
 *      fill*, which {@link AssemblyOption.empties} cannot report because it
 *      speaks about still-**open** parts;
 *   3. the two facts about the candidate pool that belong beside a choice rather
 *      than in a bill — {@link EditorSlot.joineryless} and
 *      {@link EditorSlot.baseGaps};
 *   4. the **size** the slot is asking of its fills, and the geometry the fills
 *      already in it do or do not close.
 *
 * ## The design filter is a filter, and the family preference is not
 *
 * Two different things wear the word "family" in this epic and they must not be
 * folded: row C2's {@link import('@/template').FillContext.family} is a
 * *preference* that reorders candidates and never removes one, because a
 * one-click placement has to fill the slot with something. This is a **filter**,
 * chosen by hand, and removing cards is the whole point of it. What gets stored
 * is neither: a fill names a `TileId` (decision D1).
 *
 * The buckets come off {@link TileAggregate.texture} — the item, not the file —
 * because row A1 measured `texture` variance within an aggregate at 0, so a
 * per-file bucket would ask 8,702 questions for 3,822 answers. **89 records
 * carry no texture tag**, so `undefined` is a real bucket and is labelled rather
 * than dropped.
 *
 * ## Why a size *control* is not here, and that refutes the plan's §3.1
 *
 * §3.1 ends *"and size as a control on the placed instance"*. There is nowhere
 * for such a control to write: {@link TemplateInstance} is `id`, `template`,
 * `x`, `z`, `rotation` and `fills`, and A1's schema states the omission as
 * deliberate (*"No footprint, size or colour"*). So a size choice can only exist
 * as the sizes of the files that happen to be in the slots — derived, never
 * stored — and **that argument is untouched by row A11**.
 *
 * The *second* reason this note used to give is now spent, and it is recorded
 * rather than deleted because it is the argument that produced the action: a
 * control that re-solved an instance at a new cell would, on the slots the new
 * cell empties, have left the **old fill in place**, because `fillSlot` and
 * `pinFill` both write a tile and A1's surface had no delete (`relock.ts`'s
 * fourth gap, `InstanceReSolve.stale`). `@/store`'s `clearFill` closes that, so
 * a size control would no longer ship a stale answer — it would still have
 * nowhere to write the size, which is the reason that decides it.
 *
 * What is offered instead is the honest half: {@link EditorSlot.size} names what
 * the slot wants of a fill — B3's predicate over the instance's own resolved
 * cell — and the candidate pool already satisfies it, because the size refs are
 * in the slot's `require`. So "matches based on the slot to fill and size" is
 * answered by the pool and *said out loud*, and the piece of it that cannot be
 * honest yet is left undone rather than half-done.
 */
import type { AssemblyIndex, BaseGap } from '@/assembly'
import { baseGap } from '@/assembly'
import type { CatalogFile, CatalogRecord, TileId } from '@/catalog'
import type { AssemblyChoice, AssemblyOption, AssemblyStep, RecipeIndex, RecipeTemplate } from '@/assembly'
import { assemblyState, createRecipeIndex, resolvePart } from '@/assembly'
/* The leaf module and not `@/screens/detail`: that barrel exports `TileDrawer`,
   so importing the label through it would pull the catalog drawer, its 3D panel
   and its sprite rotator into the builder's chunk to format one string. */
import { textureSetLabel } from '@/screens/detail/labels'
import { compositionIndexFor } from '@/screens/detail/slots'
import type { PositionAxis } from '@/builder/canvas'
import type { LockSystem, PlacementId, SlotFill, SlotName, TemplateInstance } from '@/store'
import { setPlacementFilters, unpinFill, useWorkshopStore } from '@/store'
import type { DroppedPin, InstanceFilterReSolve, SceneReSolve, SlotDoubt, SlotVerdict } from '@/template'
import {
  cornerSpanOf,
  layoutFor,
  placeTemplateSlots,
  reSolveInstance,
  reSolveScene,
  sizeSentence,
  slotSizePredicate,
} from '@/template'

import type { SizePosition } from '../families'
import { familyById, positionIn } from '../families'

/* ------------------------------------------------------------------ the filter */

/** One design a slot's candidates come in — §1.6's texture family. */
export interface DesignBucket {
  /** `TileAggregate.texture`: `dungeon_stone`, `towne`, … or `undefined` for the 89. */
  readonly family: string | undefined
  /** {@link textureSetLabel}'s wording, so the editor and the drawer agree. */
  readonly label: string
  /** Candidate **items** in this family for this slot. */
  readonly items: number
}

/**
 * The design buckets of one slot's cards, most populous first then by label.
 *
 * Counted over the cards rather than over the candidate files, because the grid
 * is an item grid and a filter has to say how many cards it will leave.
 */
export function designBuckets(options: readonly AssemblyOption[]): readonly DesignBucket[] {
  const counts = new Map<string, { family: string | undefined; items: number }>()
  for (const option of options) {
    const family = option.aggregate.texture
    // `''` is not a reachable texture, so it is safe as the key for "no tag" —
    // and keying on `String(undefined)` would collide with a literal
    // `"undefined"` texture, which a fixture can carry even if the archive
    // cannot.
    const key = family ?? ''
    const held = counts.get(key) ?? { family, items: 0 }
    held.items += 1
    counts.set(key, held)
  }
  return [...counts.values()]
    .map((entry) => ({ ...entry, label: textureSetLabel({ texture: entry.family }) }))
    .sort((a, b) => b.items - a.items || a.label.localeCompare(b.label))
}

/** The cards of one slot in one design, or all of them when no design is chosen. */
export function filterByDesign(
  options: readonly AssemblyOption[],
  family: string | undefined | null,
): readonly AssemblyOption[] {
  // `null` is "no filter" and `undefined` is "the items with no texture tag",
  // which is why this parameter is not simply optional.
  if (family === null) return options
  return options.filter((option) => option.aggregate.texture === family)
}

/* -------------------------------------------------------------------- the pool */

/**
 * Candidate items whose every file names no lock system at all.
 *
 * §8's `unknown-joinery`, and row **C4** measured why it does not belong in the
 * bill: 351 of 8,702 records carry no `connection|` tag, but through the recipes
 * that is **15 of 14,241 (slot, candidate) pairs — 0.11%**, so a bill warning
 * would be loud and almost never true. A joinery-less *candidate* is a fact
 * about the pool a slot offers, which is a fact about a choice, so it is
 * reported here and beside {@link baseGaps}.
 *
 * Read over the item's whole candidate list rather than off its preferred
 * variant: an item one of whose prints carries joinery is not a joinery-less
 * choice, it is a choice with a print to prefer.
 */
function joinerylessItems(options: readonly AssemblyOption[], index: AssemblyIndex): number {
  return options.filter((option) =>
    option.tiles.every((tile) => (index.byId.get(tile)?.conn.length ?? 0) === 0),
  ).length
}

/**
 * Candidate items the archive holds no base for — `baseMatch.ts`'s three gaps,
 * counted.
 *
 * 377 records corpus-wide over the three codes (86 / 31 / 260). It belongs in
 * the editor for the same reason the joinery count does: it is a property of the
 * pool, it cannot be repaired by anything the user does in this popover, and
 * `resolveInstance` no longer emits a note for it — row A3 deleted the
 * auto-insert those notes described, so the three codes left `NoteCode` and
 * nothing in the app has read them since.
 *
 * The preferred variant is enough here where it is not enough for joinery,
 * because a base match is decided by size code and footprint and A1 measured
 * both invariant within an aggregate.
 */
function baseGapItems(options: readonly AssemblyOption[], index: AssemblyIndex): number {
  return options.filter((option) => {
    const record = index.byId.get(option.variant.id)
    return record !== undefined && baseGap(record, index) !== undefined
  }).length
}

/* ------------------------------------------------------------------- the model */

/** One declared slot of a placed instance, ready to edit. */
export interface EditorSlot {
  readonly name: SlotName
  /** The candidate walk for this part under the instance's other fills. */
  readonly step: AssemblyStep
  /** The fill as persisted, or `undefined` for §3.2's *needs a choice*. */
  readonly fill: SlotFill | undefined
  /**
   * The **item**'s display name for the fill, or `undefined` when the slot is
   * empty or the index has retired the file.
   *
   * Off the aggregate rather than off the file, because `name` is a hoisted
   * facet A1 measured at 0 variance within an item — so the fill's file and
   * every sibling print of it answer the same way, and a slot row that named the
   * file would print a path where the grid prints a name.
   */
  readonly fillName: string | undefined
  readonly designs: readonly DesignBucket[]
  /** See {@link joinerylessItems}. */
  readonly joineryless: number
  /** See {@link baseGapItems}. */
  readonly baseGaps: number
  /** The gap the fill itself falls into, when it is in one. */
  readonly fillGap: BaseGap | undefined
  /**
   * What the slot wants of a fill's size, as one phrase, or `undefined` when
   * this template has no authored layout to measure a cell against.
   *
   * B3's predicate over the cell the instance's **own fills** resolve to, which
   * is the only cell there is — see the module note on why there is no stored
   * one.
   */
  readonly size: string | undefined
}

/** A placed instance, as the editor sees it. */
export interface SlotEditorModel {
  readonly placement: PlacementId
  readonly instance: TemplateInstance
  readonly template: RecipeTemplate
  /** One per declared part, in the recipe's declared order. */
  readonly slots: readonly EditorSlot[]
  /** Declared, non-optional and unfilled — §3.2's *needs a choice*. */
  readonly needsChoice: readonly SlotName[]
  /**
   * What the layout rule could not place or could not fit, from B2's
   * `placeTemplateSlots`.
   *
   * The 8 single-piece corner mitres arrive here as `over-run` with
   * `want: 2, got: 2.5`, and that is the whole disclosure the plan permits:
   * *"the mitre is in no tag and no measurement. Do not silently write 1.5."*
   * `slotDoubtSentence` is the wording and this row is the panel its docblock
   * says mounts it.
   */
  readonly doubts: readonly SlotDoubt[]
  readonly verdict: SlotVerdict | undefined
}

/** The instance's fills as the walk's choice — the `pinned` bit stripped. */
export function choiceOf(instance: TemplateInstance): AssemblyChoice {
  const out: Record<string, TileId> = {}
  for (const [slot, fill] of Object.entries(instance.fills)) {
    if (fill !== undefined) out[slot] = fill.tile
  }
  return out
}

/**
 * The size predicate of every slot, and the geometry doubts of the fills already
 * in place.
 *
 * The cell both are measured against is `placeTemplateSlots`' own — the resolved
 * footprint of whichever fill the layout names as the cell slot (`floor` on all
 * three of B2's conventions) — and it is deliberately not returned: there is no
 * *stored* cell to compare it against, so a caller holding one could only
 * restate what the slot phrases already say.
 *
 * `undefined` layout for a part-name set none of B2's three conventions names —
 * which is every one of B4's single-slot generated families — and then there is
 * no cell, no size phrase and no doubt to report. That is an absence of a rule
 * rather than a failure of one, so it is `undefined` and not an empty verdict.
 */
function layoutOf(
  template: RecipeTemplate,
  instance: TemplateInstance,
  index: AssemblyIndex,
): {
  readonly doubts: readonly SlotDoubt[]
  readonly verdict: SlotVerdict | undefined
  readonly sides: ReadonlyMap<string, ReturnType<typeof slotSizePredicate>>
} {
  const names = template.parts.map((part) => part.name as SlotName)
  const layout = layoutFor(names)
  if (layout === undefined) {
    return { doubts: [], verdict: undefined, sides: new Map() }
  }

  const feet = new Map<SlotName, CatalogRecord['foot']>()
  for (const [slot, fill] of Object.entries(instance.fills)) {
    const record = fill === undefined ? undefined : index.byId.get(fill.tile)
    if (record !== undefined) feet.set(slot as SlotName, record.foot)
  }
  /* No `insetParts`, deliberately. What this reads off the placement is `cell`
     and the doubts, and it derives its size predicates from `layout.slots` — the
     *declared* rules — rather than from the placed ones. The inset anchor changes
     an `offset` and a `residual` and neither is read here, so the empty default
     is the whole answer. Whether an inset base should also narrow its own size
     predicate is B3's question and not this row's. */
  const placed = placeTemplateSlots(layout, feet)
  const span = cornerSpanOf(layout)
  const sides = new Map<string, ReturnType<typeof slotSizePredicate>>()
  if (placed.cell !== undefined) {
    for (const rule of layout.slots) sides.set(rule.part, slotSizePredicate(rule, placed.cell, span))
  }
  return { doubts: placed.doubts, verdict: placed.verdict, sides }
}

/**
 * One placed instance, resolved into an editable slot list.
 *
 * Measured cost is {@link assemblyState}'s — 4.1 ms median, 86.2 ms worst over
 * the 40 recipes — plus one base-gap classification and one joinery scan per
 * card. That is why it is computed for the **open** instance only and never for
 * the panel's list: a 250-instance room would otherwise resolve 250 walks on
 * every store write.
 */
export function slotEditorModel(
  catalog: CatalogFile,
  index: AssemblyIndex,
  instance: TemplateInstance,
  template: RecipeTemplate,
  recipes: RecipeIndex = createRecipeIndex(catalog, compositionIndexFor(catalog)),
): SlotEditorModel {
  const choice = choiceOf(instance)
  /* **The instance's control filters, posed onto the template's own tags.**
     `assemblyState` reads `template.tags` as the `parentTags` a `constrain` block
     collects, so adding the position here is the whole of filtering this editor —
     no per-slot table and no second resolver. An instance placed as an arched
     door offers 54 walls in its wall slot rather than 1,451.
     `[]` poses nothing, which is *any* on every axis. */
  const posed =
    instance.filters.length === 0
      ? template
      : { ...template, tags: [...template.tags, ...instance.filters] }
  const state = assemblyState(recipes, posed, choice)
  const geometry = layoutOf(template, instance, index)

  const slots = state.steps.map((step): EditorSlot => {
    const name = step.name as SlotName
    const fill = instance.fills[name]
    const record = fill === undefined ? undefined : index.byId.get(fill.tile)
    const predicate = geometry.sides.get(step.name)
    return {
      name,
      step,
      fill,
      fillName: record === undefined ? undefined : recipes.composition.aggregates.byDesign.get(record.design)?.name,
      designs: designBuckets(step.options),
      joineryless: joinerylessItems(step.options, index),
      baseGaps: baseGapItems(step.options, index),
      fillGap: record === undefined ? undefined : baseGap(record, index),
      size: predicate === undefined ? undefined : sizeSentence(predicate),
    }
  })

  return {
    placement: instance.id,
    instance,
    template,
    slots,
    /* Every declared slot is required and there is no `optional` to read. The
       type says so: `TemplatePart` is `Pick<PartSlot, 'name' | 'tags'>` plus
       `fulfills`, so the emitter carries no `optional` at all — and the corpus
       agrees, `optional` being absent from all 128 parts of the 40 recipes. A
       slot a sibling `fulfills` is the one exemption, and it is `coveredBy`
       rather than optional. */
    needsChoice: slots
      .filter((slot) => slot.fill === undefined && slot.step.coveredBy === undefined)
      .map((slot) => slot.name),
    doubts: geometry.doubts,
    verdict: geometry.verdict,
  }
}

/* ----------------------------------------------------------------- the refusal */

/** A sibling whose existing fill a pick would put outside its own slot. */
export interface Invalidation {
  readonly part: SlotName
  readonly tile: TileId
  /** The item's display name, so the refusal can name the piece and not the path. */
  readonly name: string
}

/**
 * Sibling fills a pick would invalidate — §3.3's refusal, and it is a refusal
 * rather than a repair.
 *
 * *"A pick that invalidates a sibling's existing fill is refused with the reason
 * rather than silently repaired."* Both available repairs are still wrong, and
 * since row A11 that is a **policy** rather than a missing capability: re-solving
 * the sibling would discard a file the user may have pinned, and `clearFill` —
 * which did not exist when this was written (`relock.ts`'s fourth gap) — would
 * silently throw that same file away. Emptying a slot on the user's behalf to
 * make an unrelated press succeed is the destruction §3.3 refuses; emptying it
 * because the user said so is {@link handSlotToLock}'s neighbour on the same
 * dialog. So the refusal names the slot, and the user now has a button that acts
 * on it.
 *
 * {@link AssemblyOption.empties} is the same question asked of still-**open**
 * parts and is already on every card; this is the filled ones. C2 measured the
 * grammar that makes it real — a lock toggle moving **74 of 128 slots**, and 416
 * of 4,330 accessory item picks emptying a sibling — so it is reachable rather
 * than theoretical.
 *
 * One postings intersection per filled sibling, so at most four on the widest
 * shipped recipe. Empty for a pick that changes nothing, which is the common
 * case.
 */
export function invalidatedBy(
  recipes: RecipeIndex,
  template: RecipeTemplate,
  instance: TemplateInstance,
  slot: SlotName,
  tile: TileId,
): readonly Invalidation[] {
  const next: AssemblyChoice = { ...choiceOf(instance), [slot]: tile }
  const out: Invalidation[] = []

  for (const part of template.parts) {
    if (part.name === slot) continue
    const held = instance.fills[part.name as SlotName]
    if (held === undefined) continue
    const pool = resolvePart(recipes.composition, template, part, next)
    if (pool.tiles.includes(held.tile)) continue
    const variant = recipes.composition.aggregates.byTile.get(held.tile)
    const aggregate =
      variant === undefined ? undefined : recipes.composition.aggregates.byDesign.get(variant.design)
    out.push({
      part: part.name as SlotName,
      tile: held.tile,
      // The file's own id when the index has retired the item behind it: an
      // orphaned fill is still a fill this pick would invalidate, and refusing
      // with a blank name would be worse than refusing with a path.
      name: aggregate?.name ?? held.tile,
    })
  }
  return out
}

/** The refusal as one sentence, or `undefined` when there is nothing to refuse. */
export function refusalSentence(
  slot: SlotName,
  name: string,
  invalidated: readonly Invalidation[],
): string | undefined {
  if (invalidated.length === 0) return undefined
  const named = invalidated.map((one) => `${one.name} in the ${one.part} slot`).join(' and ')
  return (
    `${name} cannot go in the ${slot} slot: it would leave ${named} outside what that slot admits. ` +
    'Change that slot first — nothing here will rewrite a choice you have already made.'
  )
}

/* --------------------------------------------------------------- the filters */

/** One control axis of the instance's own row, as the editor mounts it. */
export interface EditorAxis {
  readonly axis: PositionAxis
  /** `Component`, `Height`, `Size` — `AxisControl`'s group and chip prefix. */
  readonly label: string
  readonly entries: readonly SizePosition[]
}

/**
 * The instance's row's three axes, in `usePlanTools#armedPosition`'s own order.
 *
 * Read off `families.ts` and not off the template, because the domain of an axis
 * is a *derived table* — `ASSEMBLY_CONTROLS` for an assembly, and
 * `GENERATED_FAMILY_SIZES` reduced by `sizesFor` for a single-tile family — and
 * the palette reads the same two. A second derivation here is how the palette and
 * the editor would come to offer different chips for the same piece.
 *
 * Empty for a template this build does not ship a row for, which is the same
 * answer as *no axis has anything to choose*: {@link AxisControl} renders nothing
 * for an axis under two positions, so both cases are one code path.
 *
 * The order matters and is the hook's: `component`, `height`, `size`. It is what
 * makes {@link filtersWith} produce the same tag order the palette arms, so an
 * instance re-filtered in the editor and one placed from the palette at the same
 * position hold the *identical* list — which is what lets the share codec key on
 * the set (row F1) and what keeps `three/fills.ts`' memo from holding two entries
 * for one position.
 */
export function editorAxes(template: RecipeTemplate): readonly EditorAxis[] {
  const family = familyById(template.id)
  if (family === undefined) return []
  return [
    { axis: 'component', label: 'Component', entries: family.controls?.component ?? [] },
    { axis: 'height', label: 'Height', entries: family.controls?.height ?? [] },
    { axis: 'size', label: 'Size', entries: family.sizes },
  ]
}

/**
 * The filter list one axis change produces: that axis at `tags`, every other
 * axis where it already was.
 *
 * Rebuilt from the axes rather than patched, and that is what keeps it sound.
 * Removing "the old tags of this axis" from the stored list means knowing which
 * of them belonged to this axis, and a filter list is flat — so a patch would
 * either leave a stale `size|depth|2` behind when moving from a cell position to
 * a run one, or strip a tag another axis also happens to carry. Reading each
 * axis's *current position* through `positionIn` asks the domain instead, which
 * is the same question {@link AxisControl} asks to decide which chip is pressed;
 * the two cannot disagree about what is armed.
 *
 * An axis the row does not have contributes nothing, and an axis sitting on its
 * `any` position contributes nothing — which is the same thing, correctly.
 */
export function filtersWith(
  axes: readonly EditorAxis[],
  filters: readonly string[],
  changed: PositionAxis,
  tags: readonly string[],
): readonly string[] {
  return axes.flatMap((axis) => (axis.axis === changed ? tags : positionIn(axis.entries, filters)))
}

/**
 * Re-filter one placed instance: re-solve it, then write the filters and the
 * fills together.
 *
 * The editor's half of `relock.ts#reSolveInstance`, and the division is that
 * function's own — it decides and reports, this writes. The write is
 * `@/store#setPlacementFilters`, one transaction, because a filter change can
 * move every slot at once and can replace a pin, which is the one thing
 * {@link import('@/store').fillSlot} refuses by design.
 *
 * Returns what the re-solve dropped so the dialog can say so, which is the whole
 * reason this is not fire-and-forget. A driver that reported a discarded choice
 * to a caller that swallowed it would be contract **C-k**'s failure with one
 * more step in it.
 *
 * `lock` and `design` are passed rather than read, for the reason
 * {@link handSlotToLock} gives at length: this module is pure functions over an
 * instance, and a re-solve that ignored the room's own preferences would refill
 * every unpinned slot in a different design from the one the room is in.
 */
export function reFilterInstance(
  index: AssemblyIndex,
  recipes: RecipeIndex,
  template: RecipeTemplate,
  instance: TemplateInstance,
  filters: readonly string[],
  lock: LockSystem,
  design: string | undefined,
): InstanceFilterReSolve {
  const result = reSolveInstance(instance, filters, index, {
    // The one recipe this dialog was opened on — `handSlotToLock`'s lookup and
    // its reason.
    templates: (id) => (id === instance.template ? template : undefined),
    composition: recipes.composition,
    lock,
    ...(design === undefined ? {} : { family: design }),
  })
  setPlacementFilters(instance.id, filters, result.fills)
  return result
}

/**
 * The dropped pins as one sentence, or `undefined` when nothing was dropped.
 *
 * Names the **item** and the slot, the way {@link refusalSentence} does, because
 * a `TileId` is a path and the thing the user chose was a piece. It says what
 * replaced the choice rather than only that something did: the new fill is
 * already on screen in the slot list, so a sentence that only announced a loss
 * would send the user looking for a change they can see.
 */
export function replacedSentence(
  recipes: RecipeIndex,
  replaced: readonly DroppedPin[],
): string | undefined {
  if (replaced.length === 0) return undefined
  const named = replaced
    .map((one) => {
      const variant = recipes.composition.aggregates.byTile.get(one.was)
      const aggregate =
        variant === undefined ? undefined : recipes.composition.aggregates.byDesign.get(variant.design)
      // The file's own id when the index has retired the item behind it — the
      // same fallback `invalidatedBy` takes, and for the same reason.
      return `${aggregate?.name ?? one.was} in the ${one.slot} slot`
    })
    .join(' and ')
  return (
    `${replaced.length === 1 ? 'One choice you had made is' : `${String(replaced.length)} choices you had made are`} ` +
    `no longer available at this filter: ${named}. The slot has been solved again.`
  )
}

/* -------------------------------------------------- handing a slot back */

/**
 * Unpin one slot and immediately re-solve the instance it is on.
 *
 * ## Why the re-solve is immediate, rather than left to the next lock change
 *
 * `unpinFill` moves the *authority* over a slot and never the file, so on its
 * own the press leaves the drawing, the bill and the pack byte-for-byte
 * identical. C2's `reSolveScene` is the only thing that repairs that, and row
 * C3 wired it to a lock **change** in `BuilderScreen` — which means an unpin
 * with no re-solve of its own would sit unrepaired until the user toggled the
 * lock for an unrelated reason.
 *
 * That is not merely a delayed repair, it is a **regression**, and the
 * measurement is C2's own surface: `PinLockWarning` is emitted from
 * `relock.ts#pinsOf`, which walks the *pinned* fills only. So an unpin removes
 * the slot from the pin set, the warning that named the mismatch stops firing —
 * and the mismatched file is still in the slot and still in the pack. The
 * `off-slot` fault does not cover it either: the lock is not one of the tags a
 * slot predicates on (`relock.ts`: *"the candidate set is lock-free"*), so a
 * lock-wrong fill is perfectly admissible and `billView.ts#slotFaults` says
 * nothing about it. A gesture whose only visible effect is to silence the
 * warning about the thing it did not fix is worse than no gesture.
 *
 * ## Why it is `reSolveScene` over one instance and not a second walk
 *
 * The slot's new answer is a function of the preference, the template and the
 * instance's **remaining** pins, which is exactly `solveTemplateFills`' input —
 * and `reSolveScene` is the driver that assembles it, honours the pins that are
 * left through `fillSlot`'s refusal, and reports what it did. One instance is
 * one solve: C2 measures 40 solves and 8–9 ms for a 250-instance room, so a
 * single-instance call is the memo's best case and not a scene-scale cost.
 *
 * It re-solves the instance rather than the one slot, and that is the driver's
 * granularity rather than a choice made here — a template's slots narrow each
 * other, so the answer for the unpinned slot is only correct alongside its
 * siblings'. The siblings that are pinned come back `'kept-pinned'` and the ones
 * that are not are re-solved against the current preference, which is a repair
 * of a room filled under an older lock rather than a surprise.
 *
 * ## The instance is read back out of the store
 *
 * `instance` is the render's copy, from **before** the unpin, so its `fills`
 * still carry `pinned: true` for this slot — and `reSolveScene` reads its pins
 * off the instance it is handed. Passing the stale copy would put the file that
 * was just unpinned back in as a fixed preset, the solver would return it
 * unchanged, and the whole call would be a no-op that looked like a repair.
 * `useWorkshopStore.getState()` is the truth after a synchronous `setState`, and
 * this is the one place that needs it.
 *
 * `undefined` when there was nothing to unpin — an already-auto slot, an empty
 * one, or a placement that has left the grid under the open dialog — because
 * re-solving an instance the user did not touch is a write nobody asked for, and
 * `unpinFill`'s three-state return is what makes that distinguishable.
 */
export function handSlotToLock(
  index: AssemblyIndex,
  recipes: RecipeIndex,
  template: RecipeTemplate,
  instance: TemplateInstance,
  slot: SlotName,
  lock: LockSystem,
  /*
    The room's design, or `undefined` for no preference.

    Passed rather than read, for the reason the rest of this module gives: it is
    a pure function over an instance, and a hook here would make it one only by
    accident. Without it a slot handed back to the lock re-solves in catalog
    order while every other path — the placement click, a lock change, a design
    change — carries the room's design, so the one gesture whose whole point is
    "let the room decide again" would have been the one gesture that ignored the
    room.
  */
  design: string | undefined,
): SceneReSolve | undefined {
  if (unpinFill(instance.id, slot) !== 'unpinned') return undefined
  const now = useWorkshopStore.getState().placements[instance.id]
  if (now === undefined) return undefined
  return reSolveScene([now], index, {
    // The one recipe the editor was opened on. A caller holding the whole table
    // would pass it, but this dialog is opened *on* an instance and `SlotsPanel`
    // has already resolved its family — so the honest lookup is the one that
    // answers for that id and for nothing else, rather than a second copy of the
    // table reaching into a screen from `src/builder/**`.
    templates: (id) => (id === now.template ? template : undefined),
    composition: recipes.composition,
    lock,
    ...(design === undefined ? {} : { family: design }),
  })
}
