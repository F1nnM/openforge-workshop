/**
 * What goes in a slot, and which of those choices lead nowhere.
 *
 * Row C1 built the resolution machinery and emitted **0 bytes** for it, on the
 * grounds that `constrain` reads sibling selections and sibling selections are
 * runtime state. This module is the consumer that makes that argument pay: it is
 * the thing that holds a selection, re-resolves every *other* slot against it,
 * and can therefore say **before a click** that the click leads to a
 * configuration nothing can finish.
 *
 * ## The measured surface this picker covers
 *
 * Row A5 established that the `base` slot is not an accessory, and re-measuring
 * it here agrees: of the 2,112 aggregate slots, **1,560 are named `base`**, and
 * what is left is **552 accessory slots over 445 aggregates** across **28
 * distinct names** — `torch` 156, `door` 89, `lintel` 51, `top` 37, `grate` 34,
 * `archway` 29, `portcullis` 28, then a tail down to one. On the file side the
 * same slots are **1,244 accessory declarations over 8,702 records**, and their
 * candidate sets are the reason an inline grid is the right control at all:
 *
 * | accessory slot's candidate set | median | mean | max |
 * | --- | ---: | ---: | ---: |
 * | candidate **files** | 12 | — | **30** |
 * | candidate **items**, which is what the grid shows | **1** | 1.8 | **8** |
 *
 * **Every one of the 1,244 is under 50 candidates — all of them, not 62%** — and
 * as an item grid the largest in the corpus is eight cards. That bound is what
 * answers the sprite-sheet memory question rather than a policy: see
 * {@link MAX_GRID_ITEMS}.
 *
 * ## Dead-end greying, and why the `base` slot is not read at all
 *
 * A pick is a dead end when it empties a **sibling accessory slot** that
 * currently has candidates. Measured over the **535 files that declare two or
 * more slots**:
 *
 *   - **416 of 4,330 item picks (9.6%) empty a sibling.**
 *   - **0 of them are partial** — for every one of the 4,330, either every
 *     candidate file of the item empties a sibling or none does. So an item card
 *     is honestly a single greyed thing, and {@link SlotOption.deadEnd} does not
 *     have to hedge.
 *   - **Every single one empties the `base` slot. Zero empty an accessory
 *     sibling.**
 *
 * That last line used to decide the shape of this module: the base slot was
 * resolved, never rendered, and its emptying *was* the dead-end signal. It was
 * wrong, and the Cut Stone rectangular door wall is where it showed. **`base` is
 * not a sibling of an accessory slot.** The base under a placed piece is the
 * *room's* own slot — A6's base match, chosen by footprint congruence against
 * the template — and a door leaf dropped into the wall's doorway cannot change
 * it. Measured on `cut-stone#wall,door+rectangular.A.openforge.stl`: its `base`
 * part carries `constrain: [shape, size|width, texture]` and has 6 candidates
 * untouched, and **the door's `texture|metal` / `texture|wood` alone takes it to
 * 0** — so all five door items and the single lintel item greyed, the whole
 * family's doors read *"Leaves no base this piece can be printed on"*, and
 * `builder/three/holds.ts` filled neither slot by default. (The Towne curved
 * door wall was never greyed for the opposite reason: no curved base exists at
 * all, so its base slot is *already* empty and {@link consequences} reports only
 * a change.)
 *
 * So {@link consequences} and {@link siblingsOf} both skip {@link BASE_SLOT} —
 * `pickerSlots` already did — and nothing in this module resolves it. On this
 * corpus that leaves **no greyed card anywhere**, because all 416 were the base;
 * the machinery stays because it is a fact about `constrain` rather than about
 * today's fixtures, and `slots.test.ts` measures both halves against the corpus.
 *
 * The two routes to the base gap are different measurements and are not
 * reconciled here. `docs/corpus-base-gap.md` counts **385 of 4,363 openforge
 * toppers with no base line item**, keyed on size codes through A6's lock. This
 * one counted **517 base slots already empty before any interaction** plus
 * **416 item picks that empty one**, keyed on inherited tags through C1's port.
 * Neither is the other, neither is a thing this picker shows any more, and the
 * plan row's "385 of 1,608 wall picks" was the first of those numbers used as if
 * it were the second.
 *
 * ## A sibling pick can also *un*-dead-end a slot
 *
 * Three picks in the corpus do, and the mechanism is worth stating because it
 * looks like a bug and is not. `processConfigValues` keeps the **most general**
 * survivor of a prefix, so a parent contributing `shape|wall|low` and a sibling
 * contributing `shape|wall` resolve to a `require` of `shape|wall` — *broader*
 * than the parent alone. On
 * `dungeon_stone#secret_door+low.A.bottom,openforge,magnetic+imperial.stl` the
 * base slot has **0** candidates untouched and **7** once the `top` slot is
 * filled. {@link SlotOption.rescues} carries it between two *accessory* slots,
 * because a picker that only ever greyed would be describing a monotone
 * narrowing the semantics do not have — and it is silent about the base for the
 * reason above: all three of the corpus's rescues are the room's slot rather
 * than a sibling of the pick.
 *
 * ## The key a choice is held under
 *
 * `AggregateSlot` has no stable key and both C1 and A5 have now said so. This
 * row does not need one, and the measurement is why: **within a single file's
 * `config.parts`, slot names are unique — 0 duplicates over all 8,702 records**,
 * so `(parent file, slot name)` is a total, content-derived identity that
 * survives a rebuild. {@link slotChoiceKey} is that pair.
 *
 * It works because C1's rule is followed exactly — **the parent is a file, not an
 * item**. At the aggregate level the same key collides on **12 aggregates**
 * (`top` twice on 11 of them, `fracture slope` three times on one), and adding
 * `PartSlot.id` does not help: it collides on the same 12, because `id` is a
 * pairing marker (6 slots, 3 files: the left and right halves of one grate) and
 * not an identifier. So an aggregate-level slot choice would still need A1's
 * private `slotKey`; a file-level one does not.
 */
import type {
  AggregateAddress,
  AggregateIndex,
  CatalogFile,
  PartSlot,
  TileAggregate,
  TileId,
  TileVariant,
} from '@/catalog'
import { buildAggregateIndex, selectVariant } from '@/catalog'
import type { CompositionIndex, SiblingSelection } from '@/composition'
import { createCompositionIndex } from '@/composition'

/**
 * The slot name that is a base match and not an accessory.
 *
 * 1,560 of 2,112 aggregate slots and 2,451 of 3,695 file slots. Never offered as
 * a grid, never resolved, and never read as a sibling — the room chooses the
 * base and an accessory cannot move it. See the module docblock.
 */
export const BASE_SLOT = 'base'

/**
 * The largest item grid the corpus can produce, measured over all 1,244
 * accessory slot declarations.
 *
 * Not a cap and not a policy: eight is the widest set that exists. It is here as
 * a named number because the thumbnail hazard is stated in units of cards — a
 * sprite sheet is 2,560×1,024 and decodes to about **10.5 MB** of bitmap, so the
 * worst accessory grid in the archive is bounded at **~84 MB** and the median at
 * one card. A grid of fifty, which is what the plan row budgeted for, does not
 * occur. `slots.test.ts` asserts the eight against the real corpus, so a fixture
 * import that made it fifty would fail rather than quietly allocate 525 MB.
 */
export const MAX_GRID_ITEMS = 8

/* ------------------------------------------------------------- the selection */

/**
 * What is currently in each slot of **one parent file**, by slot name.
 *
 * Keyed by name and not by array position, because names are unique within a
 * record (measured: 0 duplicates over 8,702) and positions are not stable across
 * builds. Undefined for a slot means "nothing chosen yet", which is a different
 * state from an optional slot deliberately left empty only in the UI's wording —
 * the resolver treats both as "no sibling selection", because a slot nothing
 * fills contributes no tags either way.
 */
export type SlotSelection = Readonly<Record<string, TileId>>

/**
 * The identity a slot choice is held under: the parent **file** and the slot's
 * declared name.
 *
 * Content-derived, so it survives a rebuild — unlike `SlotRow.at`, which is an
 * array position A5 is careful never to persist.
 *
 * The separator is `NUL`, for the reason A1's `slotKey` and C1's `measure.ts`
 * both use it: **5 live tile ids contain a space** and 5 of the 29 slot names do
 * (`grate (left)`, `fracture slope`, …), so every printable delimiter is
 * ambiguous on real data. It is written as an escape and never as a literal
 * byte — `tools/hygiene/source.test.ts` fails the build on the byte, and this
 * file arrived carrying one. The separator is written as an
 * escape and never as a literal byte, per `tools/hygiene/source.test.ts`.
 */
export function slotChoiceKey(parent: TileId, name: string): string {
  return `${parent}\u0000${name}`
}

/* ----------------------------------------------------------------- the model */

/** One card in a slot's grid: a catalog item, and what picking it would close. */
export interface SlotOption {
  /** A1's item address — the grid is an item grid, per C1. */
  readonly address: AggregateAddress
  readonly aggregate: TileAggregate
  /**
   * The file this option would contribute.
   *
   * A1's `selectVariant` over the item, **constrained to the slot's own
   * candidates**. Measured over all 18,719 slot-item pairs in the corpus,
   * `selectVariant`'s pick is already inside the candidate set **18,719 times
   * out of 18,719** — so the constraint never fires today and is kept because a
   * slot's candidates are a subset of an item's variants in general, and
   * contributing a file the slot cannot hold would be silently wrong.
   */
  readonly variant: TileVariant
  /** Every candidate file of this item for this slot, in catalog-id order. */
  readonly tiles: readonly TileId[]
  /**
   * Sibling **accessory** slots this pick would empty, by name — never `base`.
   *
   * Non-empty is the dead end. **Empty for every pick in this corpus**: all 416
   * of the 4,330 item picks that empty a sibling empty the base slot, which is
   * not a sibling — see the module docblock.
   */
  readonly empties: readonly string[]
  /** `empties.length > 0`. Never partial across an item's variants — 0 of 4,330. */
  readonly deadEnd: boolean
  /**
   * Sibling **accessory** slots this pick would open, currently empty and
   * non-empty after.
   *
   * Three picks corpus-wide, all of them a `shape|wall|low` parent whose `top`
   * slot contributes the more general `shape|wall` — and all three open the
   * *base*, so like {@link SlotOption.empties} this is empty everywhere on
   * today's corpus. The mechanism is symmetric with the greying and is kept for
   * the same reason. See the module docblock.
   */
  readonly rescues: readonly string[]
}

/** One accessory slot, resolved against everything picked so far. */
export interface SlotState {
  readonly slot: PartSlot
  /** The declared name — `torch`, `lintel`, `portcullis`. Unique within the file. */
  readonly name: string
  /** {@link slotChoiceKey} for this slot on this parent. Stable across builds. */
  readonly key: string
  /** `true` when the fixture marks it optional. 59 of the 552 accessory slots. */
  readonly optional: boolean
  /**
   * Other slots sharing this slot's `PartSlot.id`, which must resolve together.
   *
   * Six slots on three files corpus-wide — the left and right halves of one
   * widened corner grate. Surfaced rather than enforced: the fixture pairs them
   * and says nothing about how, and inventing a rule would be inventing a
   * semantic. The picker states the pairing so a user filling one knows the other
   * belongs to it.
   */
  readonly pairedWith: readonly string[]
  /** The grid, ascending address. At most {@link MAX_GRID_ITEMS} in this corpus. */
  readonly options: readonly SlotOption[]
  /** Candidate **files**, which is more than `options.length`. Median 12, max 30. */
  readonly candidates: number
  /** No candidate at all, before anything is picked in it. 9 of 1,244 accessory slots. */
  readonly deadEnd: boolean
  /**
   * Refs naming a tag the index does not hold, so the set is empty by
   * construction rather than by narrowing.
   *
   * **Empty across the whole live corpus** — all 91 `require` and 7 `deny` refs
   * resolve — and kept because "nothing matches" and "you asked for a tag that
   * does not exist" are different sentences to put in front of a user. A fixture
   * import that renamed a tag is exactly what would surface here.
   */
  readonly unknownRefs: readonly string[]
  /** What is in it now, if anything. */
  readonly chosen: TileId | undefined
}

/* ------------------------------------------------------------------- the index */

/**
 * The composition index for a file, built once per file and shared.
 *
 * A `WeakMap` rather than a `useMemo`, because the drawer, the variants table and
 * the builder's slots panel are three mounts over one catalog and
 * `createCompositionIndex` measures **10.7 ms cold / 5.3 ms warm** with a
 * 409,432-byte inverted index behind it. Memoising per component would pay that
 * per mount; keying on the parsed file object pays it once and lets the whole
 * thing be collected when the file is.
 *
 * The aggregate index is a parameter for A1's reason: A2 and A3 have already
 * built one and addresses must be A1's rather than recomputed. When it is
 * omitted the composition index derives its own, which is 86.8 ms of work a
 * caller holding a `SearchEngine` should not pay.
 *
 * **The fallback is evaluated on a miss and not on a call**, which is the whole
 * of the memo rather than a refinement of it. As a default *argument* —
 * `aggregates = buildAggregateIndex(file)` — it ran before the `WeakMap` was
 * consulted, so every cache hit still rebuilt the aggregate index over 8,702
 * records (**38–48 ms**) and threw it away. Nothing was wrong with the answer,
 * which is why it survived: the cost was invisible to every test and paid once
 * per call by callers written to call freely — `builder/three/holds.ts` resolves
 * one index per placed fill on every gesture. The `??` is the fix and the shape
 * is the guard: a default argument cannot be lazy, so the parameter is
 * explicitly optional and the fallback lives on the miss path.
 */
const INDEXES = new WeakMap<CatalogFile, CompositionIndex>()

export function compositionIndexFor(file: CatalogFile, aggregates?: AggregateIndex): CompositionIndex {
  const cached = INDEXES.get(file)
  if (cached !== undefined) return cached
  const built = createCompositionIndex(file, aggregates ?? buildAggregateIndex(file))
  INDEXES.set(file, built)
  return built
}

/* -------------------------------------------------------------- the resolution */

/**
 * The sibling selections a resolution reads, **in the parent's declared slot
 * order**.
 *
 * The order is load-bearing and it is why this is not `Object.entries`. C1's port
 * builds its `require` list from insertion-ordered `Set`s, so two users who
 * picked the same two accessories in a different order would otherwise get
 * `require` lists in a different order — the same set, but not the same array,
 * and six of the port's 69 tests assert on that array. Reading the order off the
 * fixture instead makes a resolution a function of the selection and not of the
 * click history.
 */
function siblingsOf(
  index: CompositionIndex,
  parent: TileId,
  selection: SlotSelection,
  exclude: string,
): readonly SiblingSelection[] {
  const out: SiblingSelection[] = []
  /* `pickerSlots` and not `slotsOf`: the base is not a sibling in either
     direction — it is the room's own slot, so it neither reads an accessory's
     tags nor contributes its own. See the module docblock. */
  for (const slot of pickerSlots(index, parent)) {
    if (slot.name === exclude) continue
    const tile = selection[slot.name]
    if (tile === undefined) continue
    out.push({ partName: slot.name, tags: index.tagsOf(tile) })
  }
  return out
}

/**
 * The accessory slots of a parent **file**, in fixture order.
 *
 * The file and not the item, per C1: `config` is the one field A1's collapse is
 * not lossless on — it varies within 828 aggregates — and the tags a `constrain`
 * entry inherits are this variant's. Resolving against an aggregate would answer
 * for a print the user is not looking at.
 */
export function pickerSlots(index: CompositionIndex, parent: TileId): readonly PartSlot[] {
  return index.slotsOf(parent).filter((slot) => slot.name !== BASE_SLOT)
}

/**
 * One item's candidate files for a slot, grouped off the flat candidate list.
 *
 * Ascending address, and each item's files in the order `candidatesFor` produced
 * them, which is catalog-id order.
 */
function groupByItem(
  index: CompositionIndex,
  tiles: readonly TileId[],
): readonly { readonly aggregate: TileAggregate; readonly tiles: readonly TileId[] }[] {
  const groups = new Map<number, { aggregate: TileAggregate; tiles: TileId[] }>()
  for (const tile of tiles) {
    const variant = index.aggregates.byTile.get(tile)
    if (variant === undefined) continue
    const aggregate = index.aggregates.byDesign.get(variant.design)
    if (aggregate === undefined) continue
    const at = aggregate.address as unknown as number
    const group = groups.get(at) ?? { aggregate, tiles: [] }
    group.tiles.push(tile)
    groups.set(at, group)
  }
  return [...groups.values()].sort(
    (a, b) => (a.aggregate.address as unknown as number) - (b.aggregate.address as unknown as number),
  )
}

/** What one candidate file would do to the parent's other slots. */
function consequences(
  index: CompositionIndex,
  parent: TileId,
  slot: PartSlot,
  selection: SlotSelection,
  tile: TileId,
): { readonly empties: readonly string[]; readonly rescues: readonly string[] } {
  const empties: string[] = []
  const rescues: string[] = []
  const withPick: SlotSelection = { ...selection, [slot.name]: tile }

  /* The accessory slots only. The host's own `base` part is not one of them and
     is not a sibling of one: it is the template's slot in the room, matched on
     footprint, and no accessory pick can empty it. Walking it here is what
     greyed every door on the cut-stone door wall — see the module docblock. */
  for (const other of pickerSlots(index, parent)) {
    if (other.name === slot.name) continue
    // Already filled: its candidate set is settled and re-narrowing it would be
    // describing a choice the user has made rather than one they face.
    if (selection[other.name] !== undefined) continue
    const before = index.resolve(other, parent, siblingsOf(index, parent, selection, other.name))
    const after = index.resolve(other, parent, siblingsOf(index, parent, withPick, other.name))
    if (before.deadEnd && !after.deadEnd) rescues.push(other.name)
    else if (!before.deadEnd && after.deadEnd) empties.push(other.name)
  }

  return { empties, rescues }
}

/**
 * The file an option contributes: A1's preferred variant when it is a candidate,
 * and otherwise the first candidate that is not itself a dead end.
 *
 * The dead-end preference is the reason this is not simply `tiles[0]`. An item
 * whose variants disagree — some empty a sibling, some do not — should hand the
 * user the one that does not, because the alternative is a card that looks
 * available and closes a slot anyway. **It never fires on this corpus** (0 of
 * 4,330 item picks are partial), which is exactly why it is three lines rather
 * than a feature.
 */
function contributedVariant(
  index: CompositionIndex,
  aggregate: TileAggregate,
  tiles: readonly TileId[],
  live: readonly TileId[],
): TileVariant {
  const pool = live.length > 0 ? live : tiles
  const preferred = selectVariant(aggregate, {}).variant
  if (pool.includes(preferred.id)) return preferred
  const first = pool[0]
  const variant = first === undefined ? undefined : index.aggregates.byTile.get(first)
  return variant ?? preferred
}

/**
 * Every accessory slot of a parent file, resolved against the current selection,
 * with each candidate item's consequences computed.
 *
 * The whole cost of an open, measured over all 3,036 files that declare a
 * config: **0.09 ms mean, 2.3 ms worst** — the worst being 20 resolutions over a
 * two-slot `dungeon_stone` curved wall with a torch. That figure is the argument
 * for doing this in the browser at all rather than a preference: each of those
 * 20 resolutions is a *different* tag query, so the same picker over an API is 20
 * round trips per open and 36,916 to precompute the corpus — which is why the
 * server-backed catalog shows a slot's candidates and cannot show which of them
 * lead nowhere.
 */
export function slotStates(
  index: CompositionIndex,
  parent: TileId,
  selection: SlotSelection = {},
): readonly SlotState[] {
  const declared = index.slotsOf(parent)

  return pickerSlots(index, parent).map((slot) => {
    const resolved = index.resolve(slot, parent, siblingsOf(index, parent, selection, slot.name))
    const options = groupByItem(index, resolved.tiles).map(({ aggregate, tiles }) => {
      const perTile = tiles.map((tile) => ({
        tile,
        ...consequences(index, parent, slot, selection, tile),
      }))
      const live = perTile.filter((entry) => entry.empties.length === 0).map((entry) => entry.tile)
      const deadEnd = live.length === 0 && perTile.length > 0
      const union = (pick: (entry: (typeof perTile)[number]) => readonly string[]): readonly string[] => [
        ...new Set(perTile.flatMap(pick)),
      ].sort()

      return {
        address: aggregate.address,
        aggregate,
        variant: contributedVariant(index, aggregate, tiles, live),
        tiles,
        empties: deadEnd ? union((entry) => entry.empties) : [],
        deadEnd,
        rescues: union((entry) => entry.rescues),
      }
    })

    return {
      slot,
      name: slot.name,
      key: slotChoiceKey(parent, slot.name),
      optional: slot.optional === true,
      pairedWith:
        slot.id === undefined
          ? []
          : declared.filter((other) => other.id === slot.id && other.name !== slot.name).map((other) => other.name),
      options,
      candidates: resolved.tiles.length,
      deadEnd: resolved.deadEnd,
      unknownRefs: resolved.unknownRefs,
      chosen: selection[slot.name],
    }
  })
}

/* ------------------------------------------------------------------ the wording */

/**
 * What a greyed card's reason says.
 *
 * A sentence rather than a word, because the fact is not "unavailable" — the
 * file exists, it fits this slot, and printing it is fine. What it does is close
 * a *different* accessory slot of the same piece. A card that only dimmed would
 * be telling the user the archive is missing something it is not.
 *
 * **There is no base branch.** It said *"Leaves no base this piece can be
 * printed on"* and it was the only sentence this function ever produced on the
 * live corpus, over a slot the room fills by footprint congruence rather than
 * from this grid — see the module docblock. `empties` cannot name `base` now, so
 * the branch was unreachable rather than merely unused.
 */
export function deadEndReason(option: SlotOption): string {
  const [first] = option.empties
  if (first === undefined) return ''
  if (option.empties.length === 1) return `Leaves the ${first} slot with nothing to fill it.`
  return `Leaves ${option.empties.join(' and ')} with nothing to fill them.`
}

/** What a slot with no candidate at all says, told apart from a dangling ref. */
export function emptySlotReason(state: SlotState): string {
  if (state.unknownRefs.length > 0) {
    return `This slot asks for ${state.unknownRefs.join(', ')}, and this index holds no such tag.`
  }
  return state.optional
    ? 'Nothing in the archive fits this slot, and it is optional — leave it empty.'
    : 'Nothing in the archive fits this slot, so this piece cannot be completed from the catalog.'
}
