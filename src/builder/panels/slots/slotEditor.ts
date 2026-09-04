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
 * stored — and a control that re-solved an instance at a new cell would, on the
 * slots the new cell empties, leave the **old fill in place**: `fillSlot` and
 * `pinFill` both write a tile and A1's surface has no delete
 * (`relock.ts`'s fourth gap, `InstanceReSolve.stale`). That is the one input C2
 * measured as able to empty a filled slot, so offering it before there is a
 * clear-fill action would ship exactly the stale answer the gap describes.
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
import type { AssemblyChoice, AssemblyOption, AssemblyStep, RecipeIndex, RecipeTemplate } from '@/screens/assemblies'
import { assemblyState, createRecipeIndex, resolvePart } from '@/screens/assemblies'
/* The leaf module and not `@/screens/detail`: that barrel exports `TileDrawer`,
   so importing the label through it would pull the catalog drawer, its 3D panel
   and its sprite rotator into the builder's chunk to format one string. */
import { textureSetLabel } from '@/screens/detail/labels'
import { compositionIndexFor } from '@/screens/detail/slots'
import type { PlacementId, SlotFill, SlotName, TemplateInstance } from '@/store'
import type { SlotDoubt, SlotVerdict } from '@/template'
import { cornerSpanOf, layoutFor, placeTemplateSlots, sizeSentence, slotSizePredicate } from '@/template'

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
  const state = assemblyState(recipes, template, choice)
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
 * rather than silently repaired."* The reason it cannot be a repair is that both
 * available repairs are wrong: re-solving the sibling would discard a file the
 * user may have pinned, and there is no store action that can **clear** it
 * (`relock.ts`'s fourth gap), so a slot whose new candidate set holds nothing
 * would keep the old answer and read as filled.
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
