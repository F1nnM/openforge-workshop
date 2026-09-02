/**
 * A recipe template, and what filling one part does to the others.
 *
 * ## The row's premise, and the measurement that looked like it killed it
 *
 * Row C3 is *"the 40 recipe templates as first-class objects, with progressive
 * narrowing."* Row C2 then measured, over **33,221 sibling-effect observations**
 * on tile parents: 31,218 unchanged, 2,000 emptied, **3 widened, and 0 narrowed
 * to a smaller non-empty set.** Accessory-to-accessory: 4,760 observations, **0
 * narrowings.** A sibling pick on a tile is inert or fatal, so C2 shipped
 * dead-end greying and no narrowing, and it was right to.
 *
 * **The narrowing is not absent from the corpus. It is absent from tiles.**
 * Re-measured here with the same method, over the 40 templates:
 *
 * | parent | observations | unchanged | emptied | **narrowed** | widened |
 * | --- | ---: | ---: | ---: | ---: | ---: |
 * | tiles (C2) | 33,221 | 31,218 | 2,000 | **0** | 3 |
 * | **templates (here)** | **11,938** | 2,108 | 1,185 | **8,645** | 0 |
 *
 * **72.4% of picks narrow**, at a median factor of **4.0×**, a p90 of 12.2× and a
 * maximum of 48×. `corpus.test.ts` computes every one of those figures against
 * the live archive, so none of them is quoted here on trust.
 *
 * ## Why the same semantics give opposite answers, and why neither is a defect
 *
 * The mechanism is arithmetic, not luck. `constrain` collects tags under a
 * prefix from the parent **and** from the siblings, then adds the survivors to
 * `require` — so a pick can only ever add tags, and adding tags can only shrink
 * or empty a candidate set. Whether it *does* depends entirely on what the parent
 * already contributed to that prefix:
 *
 *   - A **tile** parent carries its own `size|width|2` and `connection|side|…`.
 *     Its slots' `constrain` entries are rooted at exactly those, so the parent
 *     has already pinned them before any click. A sibling then either repeats the
 *     same tag — no change, 94.0% of C2's observations — or contradicts it, and
 *     two exact `require`s for one dimension intersect to nothing. Inert or
 *     fatal, with nothing in between, which is what C2 measured.
 *   - A **template** parent carries tags under exactly four roots — `object`,
 *     `build`, `shape` and `component`, measured over all 230 of them — and
 *     **not one `size|` or `connection|` tag.** Every one of its 110 `constrain`
 *     entries is rooted at `size|width`, `size|depth`, `connection|side` or
 *     `connection`. So the parent contributes *nothing* to the constrained
 *     namespace and the siblings contribute all of it. That is not a different
 *     rule; it is the same join with the parent's half empty.
 *
 * A recipe is generic on purpose — *"S2W: Wall on Tile: Wall: Torch (Modular)"*
 * says nothing about size or lock, because the point of it is that you choose
 * those. The template is the parent whose blanks the picks fill in, and it is
 * the only parent in this archive that has any.
 *
 * ## Greying is what makes the narrowing monotone
 *
 * The 1,185 emptied observations above are not a second dead end to design
 * around; they are the reason C2's capability is a prerequisite rather than an
 * alternative. Measured on the guided walk this module drives — declared order,
 * one pass, **no backtracking** — refusing every pick that empties a still-open
 * part gives:
 *
 *   - **after pick 1: 88 observations, 72 narrowed, 16 unchanged, 0 emptied, 0 widened**
 *   - **after pick 2: 48 observations, 18 narrowed, 30 unchanged, 0 emptied**
 *   - **after picks 3 and 4: 8 and 4 observations, and nothing moves at all**
 *
 * So with greying on the flow is **pure narrowing** — not one observation in 148
 * is emptied — and it is **front-loaded**: the first pick does 72 of the 90
 * narrowings and the third onward do none. A progress meter promising steady
 * narrowing would be lying, so this module reports the actual before-and-after
 * per part instead of a rate.
 *
 * And the completion figures are the argument for greying in one line: a walk
 * that takes the first candidate at each step **completes 24 of the 40**, while
 * the same walk skipping dead ends **completes all 40**, still without
 * backtracking. Every one of the 40 is solvable — searched exhaustively over
 * item representatives — so the 16 failures are the naive flow's, not the
 * archive's.
 *
 * ## What a step offers, and why it is not C2's grid
 *
 * C2's inline grid is capped by measurement, not policy: restricted to accessory
 * slots on tile parents, the largest candidate set in the archive is **8 items**.
 * Template parts are a different regime — **median 27 items, p90 88, maximum
 * 428** over the 128 parts, because a recipe deliberately constrains less than a
 * tile does. So this screen pages ({@link STEP_PAGE}) rather than reusing an
 * eight-card grid.
 *
 * **The narrowing is what keeps the paging rare, and this is the number to read
 * it by.** Resolved cold, with nothing chosen, **39 of the 128 parts exceed one
 * page** — 32 of them the same `floor` part at 88 items, which every wall recipe
 * shares. Walked in the fixture's declared order, so that each part is resolved
 * against what came before it, **only 4 of 128 do**: the first step of the two
 * `(Any, …)` recipes at 308 and 428 items, and the two wall parts of
 * `Corner (Any, Modular)` at 125 each. Narrowing takes the over-a-page steps
 * from 39 to 4, and that is the row's payoff stated in something a user feels.
 *
 * ## `fulfills` has two halves, and only one of them is about nested parts
 *
 * `docs/config-spec.md` in the catalog repository gives the grammar two forms
 * with different scopes, and this row needs both, for different reasons.
 *
 * **Part-level** — 20 of the 128 parts declare `fulfills: [{ part: base }]`, a
 * wall that brings its own base. The tempting reading is that it satisfies the
 * template's sibling `base` part. It does not: the spec is explicit —
 * *"**Scope**: Only affects child parts of the fulfilling part"*, *"**No sibling
 * impact**"* — and the live catalog frontend implements exactly that in one line,
 * filtering the *nested* blueprint's parts:
 *
 *   `parts.filter(part => !fulfills.some(f => f.part === part.name))`
 *
 * So {@link AssemblyStep.covered} is the chosen file's *own* slots that the
 * template part covers, and the sibling `base` part stays a choice. Two measured
 * consequences: over the 1,631 candidate files of those 20 parts, **1,403 declare
 * nested parts and 1,329 of those nested parts are named by the `fulfills`**, so
 * the declaration is load-bearing rather than decorative; and because **all 20
 * name `base`** and C2's picker never offers a `base` slot as a choice, the
 * filter is a **no-op against `SlotFills`** — C2's decision to read the base slot
 * without ever showing it already does what these 20 declarations ask for.
 *
 * **Blueprint-level** — `config.fulfills` on a *record*, which the spec scopes
 * the other way: *"**Scope**: Affects sibling parts when this blueprint is
 * selected as a part in a larger composition"*, for *"an integrated grate that
 * includes structural elements"*. {@link AssemblyStep.coveredBy} is that, and
 * three measurements decided that implementing it is reading the grammar rather
 * than inventing one:
 *
 *   1. **21 records carry a `config.fulfills`** — C1 counted the same 21 and
 *      could say no more than that they *"can fill a slot at all"*. The parts
 *      they name are `column`, `left wall` and `right wall`.
 *   2. **Those three names occur in 0 of the 3,703 JSON part declarations.** They
 *      exist as part names nowhere in the archive except in the four corner
 *      recipes here. So the corpus's own inverse relation is *unresolvable
 *      against the corpus* and resolvable only against the templates — which is
 *      the sharpest evidence in this row that the 40 are the missing half of the
 *      composition grammar rather than a nice-to-have screen.
 *   3. All 21 are reachable, from **one** recipe: `Corner (Any, Single Piece)`,
 *      on its `left wall` and `right wall` parts, 24 (part, record) pairs. The
 *      spec's worked example is verbatim one of them — a widened corner grate
 *      that stands in for the column and both wall segments, taking that recipe
 *      from five parts to three.
 *
 * The one place this departs from the spec's wording is the conflict rule. The
 * spec says *"automatic deselection"* of a choice a later pick makes redundant.
 * This reports it — {@link AssemblyStep.redundant} — because silently deleting
 * something the user chose is the one move a guided flow must not make.
 *
 * ## What does not occur here, said rather than assumed
 *
 * C2 found **3 picks that *un*-dead-end a sibling**, via `filterSpecificTags`
 * keeping the most general survivor. On templates there are **0**, and
 * {@link AssemblyOption.rescues} is carried anyway: the semantics permit it, and
 * a model that dropped the field would be asserting a monotonicity the archive
 * happens to have rather than the grammar guarantees. `corpus.test.ts` asserts
 * the 0 so that a fixture import which created one would surface it.
 *
 * ## The key a choice is held under, and why A1's `slotKey` is not needed
 *
 * C2 flagged this row as the one most likely to need A1's private `slotKey`,
 * because an aggregate-level slot choice collides on 12 aggregates. It is not
 * needed, and the reason is that **the parent here is a template, not an
 * aggregate and not a file**. A template has a stable slug and its part names are
 * unique within it — 0 duplicates over all 128 — so
 * {@link assemblyStepKey} is total without reaching for anything private.
 *
 * Where nesting is involved the parent is the **file** the user chose, which is
 * C1's rule, and `(file, slot name)` is C2's `slotChoiceKey` — also total, 0
 * duplicates over 8,702 records. There is no point in this row where an
 * aggregate is a parent, so there is no point where the 12 collisions arise.
 */
import type {
  AggregateAddress,
  CatalogFile,
  PartSlot,
  TileAggregate,
  TileId,
  TileVariant,
} from '@/catalog'
import { selectVariant } from '@/catalog'
import type { CompositionIndex, SiblingSelection, SlotTags } from '@/composition'
import { createCompositionIndex, resolveSlotTags } from '@/composition'

/* --------------------------------------------------------------- the template */

/**
 * One part of a recipe — a name, a constraint block, and what it covers.
 *
 * Deliberately **not** `PartSlot`. Two fields of the fixture's grammar have no
 * home in that schema and both live only in the templates: `constrain[].siblings`
 * (30 entries; 0 in the 8,721 JSON rows) and part-level `fulfills` (20; 0 in the
 * JSON). `fixtures.ts` carries the census and the report to the schema's owner.
 */
export interface TemplatePart {
  /** `wall`, `floor`, `base`, `column`, `left wall`, `right wall`. */
  readonly name: string
  /** C1's `SlotTags`, which models `siblings` where `PartSlot`'s `ConstrainRef` does not. */
  readonly tags: SlotTags
  /** Part names whose *nested* occurrence this part covers. 20 entries, all `base`. */
  readonly fulfills: readonly string[]
}

/** One of the 40 recipes. Data in `templates.ts`, read from the fixtures. */
export interface RecipeTemplate {
  /** A slug of {@link name}, unique across the 40. Safe in a URL and as a key. */
  readonly id: string
  /** `"S2W: Wall on Tile: Wall: Torch (Modular)"`. Unique across the 40. */
  readonly name: string
  /** The fixture file it came from. Provenance, and shown on the screen. */
  readonly source: string
  /**
   * The template's own tags — the `parentTags` a `constrain` entry reads.
   *
   * Four roots over all 230: `object`, `build`, `shape`, `component`. The absence
   * of `size|` and `connection|` is the whole reason this screen narrows; see the
   * module docblock.
   */
  readonly tags: readonly string[]
  readonly parts: readonly TemplatePart[]
}

/**
 * Cards shown per page of a step.
 *
 * Measured, like C2's `MAX_GRID_ITEMS`, rather than chosen: over the 128 parts
 * the item grid has a **median of 12 and a p90 of 36**, and only **2 of 128**
 * exceed this figure. So one page is the whole answer for 126 parts, and the two
 * that page are the `(Any, …)` recipes at 308 and 428 items.
 *
 * It is a page and not a virtualiser on the same arithmetic C2 used: a sprite
 * sheet is 2,560×1,024 and decodes to roughly **10.5 MB**, so 428 mounted cards
 * would be about **4.5 GB** of bitmap. Bounding the mounted count bounds that,
 * and it does so without a scroll-position estimate that jsdom cannot test.
 */
export const STEP_PAGE = 48

/** The identity a step's choice is held under: the template and the part name. */
export function assemblyStepKey(template: RecipeTemplate, part: string): string {
  /* `NUL`, for A1's and C2's reason: 5 slot names contain a space and so do 5
     tile ids, so every printable delimiter is ambiguous on real data. Written as
     an escape and never as the byte — `tools/hygiene/source.test.ts` fails the
     build on the byte. */
  return `${template.id}\u0000${part}`
}

/* ---------------------------------------------------------------- the index */

/**
 * The composition index, plus the one thing it does not expose.
 *
 * `CompositionIndex` gives a record's *parts* (`slotsOf`) and its tags, which is
 * everything C1's reading needs. It does not give a record's own
 * `config.fulfills` — the inverse relation, naming the parts this file can stand
 * in for — because nothing in C1 or C2 reads it. This row does, so it reads it
 * off the parsed file here rather than asking C1 to widen its surface.
 */
export interface RecipeIndex {
  readonly composition: CompositionIndex
  /**
   * Part names this file's own `config.fulfills` names. Empty for all but 21
   * records corpus-wide.
   */
  fulfilledBy(tile: TileId): readonly string[]
}

/**
 * Build the recipe index over a parsed catalog.
 *
 * `composition` is a parameter because C2's `compositionIndexFor` has very
 * likely already built one — a 339,756-byte inverted index and 10.7 ms of work —
 * and a second copy would buy nothing.
 */
export function createRecipeIndex(
  file: CatalogFile,
  composition: CompositionIndex = createCompositionIndex(file),
): RecipeIndex {
  const fulfils = new Map<TileId, readonly string[]>()
  for (const record of file.records) {
    const names = (record.config?.fulfills ?? []).map((entry) => entry.part)
    if (names.length > 0) fulfils.set(record.id, names)
  }
  return { composition, fulfilledBy: (tile) => fulfils.get(tile) ?? [] }
}

/* ------------------------------------------------------------------- the model */

/** What one pick would do to one still-open part. */
export interface StepNarrowing {
  readonly part: string
  /** Candidate **files** before the pick. */
  readonly from: number
  /** Candidate files after it. Always `< from` and `> 0`; see {@link AssemblyOption.empties}. */
  readonly to: number
}

/** One card in a step: a catalog item, and what picking it would do. */
export interface AssemblyOption {
  readonly address: AggregateAddress
  readonly aggregate: TileAggregate
  /**
   * The file this card contributes — A1's preferred variant when the part admits
   * it, otherwise the first candidate that is not itself a dead end.
   */
  readonly variant: TileVariant
  /** Every candidate file of this item for this part, in catalog-id order. */
  readonly tiles: readonly TileId[]
  /** Still-open parts this pick would empty. Non-empty is the dead end. */
  readonly empties: readonly string[]
  readonly deadEnd: boolean
  /** Still-open parts this pick would narrow without emptying, ascending part order. */
  readonly narrows: readonly StepNarrowing[]
  /**
   * Still-open parts this pick would **open** — empty before, non-empty after.
   *
   * C2 measured three of these on tile parents and explained the mechanism:
   * `filterSpecificTags` keeps the most general survivor, so a sibling can
   * broaden a `require`. Carried here for the same reason C2 carried it — a model
   * that only ever narrowed would be claiming a monotonicity the semantics do not
   * have — and `corpus.test.ts` reports how many occur on templates rather than
   * assuming C2's count transfers.
   */
  readonly rescues: readonly string[]
}

/** One part of a recipe, resolved against everything picked so far. */
export interface AssemblyStep {
  readonly part: TemplatePart
  readonly name: string
  /** {@link assemblyStepKey}. Stable across rebuilds — it names no ordinal. */
  readonly key: string
  /** The cards, ascending item address. Median 12 over the 128 parts, max 428. */
  readonly options: readonly AssemblyOption[]
  /** Candidate **files**, which is more than `options.length`. */
  readonly candidates: number
  /**
   * Candidate files with **no** sibling picked at all.
   *
   * The denominator of the narrowing this step has already had. `undefined` on a
   * step nothing has narrowed yet, so the UI can tell "88 fit" from "88 fit, down
   * from 88".
   */
  readonly narrowedFrom: number | undefined
  /** No candidate at all. 0 of the 128 parts, before any pick — see `corpus.test.ts`. */
  readonly deadEnd: boolean
  /** Refs naming a tag the index does not hold. Empty across the corpus today. */
  readonly unknownRefs: readonly string[]
  readonly chosen: TileId | undefined
  /** The chosen file as a variant of its item, for a name and a thumbnail. */
  readonly variant: TileVariant | undefined
  /**
   * The chosen file's **own** declared slots, minus the ones this part covers.
   *
   * One level, which is as deep as the archive goes (C1: *"the deepest live
   * nesting is one level"*). Empty until something is chosen.
   */
  readonly nested: readonly PartSlot[]
  /**
   * The chosen file's own slots this part's `fulfills` covers, so they are not
   * asked for again. All 20 declarations name `base`; see the module docblock for
   * why that makes the filter a no-op against C2's picker.
   */
  readonly covered: readonly string[]
  /**
   * The **sibling part** whose pick stands in for this one, so this part needs no
   * choice at all.
   *
   * The *blueprint-level* half of the `fulfills` grammar: a file whose own
   * `config.fulfills` names this part. See the module docblock — this is the
   * spec's worked example, it is reachable on exactly one of the 40 recipes, and
   * it is the only reading under which the corpus's 21 declarations mean
   * anything.
   */
  readonly coveredBy: string | undefined
  /**
   * A choice this part is holding that a sibling has since made unnecessary.
   *
   * True only when {@link coveredBy} is set *and* {@link chosen} is too. The
   * spec's wording here is *"automatic deselection"*; this reports it instead.
   * Silently deleting a choice the user made is the one thing a guided flow must
   * not do, so the step says the pick is redundant and offers to clear it.
   */
  readonly redundant: boolean
}

/** A recipe, its parts, and how far through it the user is. */
export interface AssemblyState {
  readonly template: RecipeTemplate
  /** One per part, in the fixture's declared order — which is the build order. */
  readonly steps: readonly AssemblyStep[]
  /** Parts that are answered — chosen, or covered by a sibling. */
  readonly filled: number
  readonly complete: boolean
  /** The name of the first part still needing a choice: where the guide points. */
  readonly next: string | undefined
  /**
   * The files this assembly would print, in step order.
   *
   * A part covered by a sibling contributes nothing even when it is still holding
   * a redundant choice, because the bill is what comes out of the printer and a
   * widened corner grate already includes the column it covers.
   */
  readonly tiles: readonly TileId[]
  /** Parts holding a choice a sibling has made unnecessary. See {@link AssemblyStep.redundant}. */
  readonly redundant: readonly string[]
}

/** What is currently in each part of one template, by part name. */
export type AssemblyChoice = Readonly<Record<string, TileId>>

/* -------------------------------------------------------------- the resolution */

/**
 * The sibling selections a resolution reads, **in the template's declared part
 * order**.
 *
 * The order is load-bearing for C1's reason: `processConfigValues` builds
 * `require` out of insertion-ordered `Set`s, so reading the order off the fixture
 * rather than off the click history makes a resolution a function of the choice
 * and not of how it was reached.
 */
function siblingsOf(
  index: CompositionIndex,
  template: RecipeTemplate,
  choice: AssemblyChoice,
  exclude: string,
): readonly SiblingSelection[] {
  const out: SiblingSelection[] = []
  for (const part of template.parts) {
    if (part.name === exclude) continue
    const tile = choice[part.name]
    if (tile === undefined) continue
    out.push({ partName: part.name, tags: index.tagsOf(tile) })
  }
  return out
}

/**
 * One part's candidates under a given choice — the whole resolution, and nothing
 * around it.
 *
 * Exported because {@link assemblyState} is the wrong unit for a census: it
 * resolves every part, every card and every card's consequences, at a measured
 * 4.1 ms median. A census that wants candidate *counts* over tens of thousands of
 * hypothetical choices needs the resolution alone, and `measure.ts` is the
 * caller that does.
 */
export function resolvePart(
  index: CompositionIndex,
  template: RecipeTemplate,
  part: TemplatePart,
  choice: AssemblyChoice,
): ReturnType<CompositionIndex['candidatesFor']> {
  return index.candidatesFor(
    resolveSlotTags(part.tags, template.tags, siblingsOf(index, template, choice, part.name)),
  )
}

/** One item's candidate files, grouped off the flat list, ascending address. */
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

/**
 * What one candidate file would do to the template's still-open parts.
 *
 * `open` is passed in rather than resolved here, and that is not tidiness: the
 * *before* count of a still-open part depends only on the choice, which is fixed
 * across every card in a step. Resolving it per card doubled the work of the
 * whole pass — on the largest recipe, 1,608 candidate files times two open parts
 * times two resolutions. Hoisting it halves that.
 */
function consequences(
  index: CompositionIndex,
  template: RecipeTemplate,
  part: TemplatePart,
  choice: AssemblyChoice,
  open: ReadonlyMap<string, number>,
  tile: TileId,
): {
  readonly empties: readonly string[]
  readonly narrows: readonly StepNarrowing[]
  readonly rescues: readonly string[]
} {
  const empties: string[] = []
  const narrows: StepNarrowing[] = []
  const rescues: string[] = []
  const withPick: AssemblyChoice = { ...choice, [part.name]: tile }

  for (const other of template.parts) {
    // Only the still-open parts, and never this one. A part already filled has a
    // settled set, and re-narrowing it would describe a choice the user has made
    // rather than one they still face. C2's rule.
    const before = open.get(other.name)
    if (before === undefined) continue
    const after = resolvePart(index, template, other, withPick).tiles.length
    if (before === 0 && after > 0) rescues.push(other.name)
    else if (before > 0 && after === 0) empties.push(other.name)
    else if (after < before) narrows.push({ part: other.name, from: before, to: after })
  }

  return { empties, narrows, rescues }
}

/**
 * The file a card contributes: A1's preferred variant when the part admits it,
 * and otherwise the first candidate that is not itself a dead end.
 *
 * The same three lines C2 wrote, for the same reason — an item whose variants
 * disagree should hand over the one that does not close a part. On tile parents
 * C2 measured **0 of 4,330** such cards and kept the tie-break as three
 * unexercised lines. Here **87 cards** have variants that disagree, so it is not
 * a defensive branch: without it, 87 cards would look available and close a part
 * anyway, which is the one thing greying must not do.
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
 * A whole recipe, resolved against the current choice.
 *
 * Recomputed on every pick, because that is the row: `constrain` reads sibling
 * selections, so a candidate set is correct only until the next click. The whole
 * pass — every part, every card, and every card's consequences for every still
 * open part — measures a **median of 11.3 ms, a p90 of 29.6 ms and a worst case
 * of 86.2 ms** over the 40 templates against the live archive, the worst being
 * `Wall (Any, Modular)` with 1,608 candidate files. `corpus.test.ts` re-measures
 * it. That figure is halved from where it started: see {@link consequences} for
 * the count that was being recomputed once per card and cannot vary.
 */
export function assemblyState(
  recipes: RecipeIndex,
  template: RecipeTemplate,
  choice: AssemblyChoice = {},
): AssemblyState {
  const index = recipes.composition

  /* Which parts a *sibling's* pick stands in for. Built before the steps because
     a part's own shape depends on it: a covered part is not a choice at all. */
  const coveredBy = new Map<string, string>()
  for (const part of template.parts) {
    const tile = choice[part.name]
    if (tile === undefined) continue
    for (const name of recipes.fulfilledBy(tile)) {
      // Self-naming is ignored: a part filled by a file that says it fulfils that
      // same part is already answered by the file being there.
      if (name === part.name || coveredBy.has(name)) continue
      if (template.parts.some((other) => other.name === name)) coveredBy.set(name, part.name)
    }
  }

  const steps = template.parts.map((part): AssemblyStep => {
    const covering = coveredBy.get(part.name)
    const chosen = choice[part.name]

    if (covering !== undefined) {
      /* No resolution at all. A covered part is not a narrower choice, it is not
         a choice: offering a grid for it would be asking the user to print a
         column the grate already has. */
      return {
        part,
        name: part.name,
        key: assemblyStepKey(template, part.name),
        options: [],
        candidates: 0,
        narrowedFrom: undefined,
        deadEnd: false,
        unknownRefs: [],
        chosen,
        variant: chosen === undefined ? undefined : index.aggregates.byTile.get(chosen),
        nested: [],
        covered: [],
        coveredBy: covering,
        redundant: chosen !== undefined,
      }
    }

    const resolved = resolvePart(index, template, part, choice)

    /* The unnarrowed count, for the disclosure. Only computed when something else
       is picked, so an untouched step pays nothing for it. */
    const anySibling = template.parts.some(
      (other) => other.name !== part.name && choice[other.name] !== undefined,
    )
    const narrowedFrom = anySibling
      ? resolvePart(index, template, part, {}).tiles.length
      : undefined

    /* The still-open parts and their current counts, resolved once for the whole
       step. See {@link consequences} for why this is not per card. */
    const open = new Map<string, number>()
    for (const other of template.parts) {
      if (other.name === part.name || choice[other.name] !== undefined) continue
      open.set(other.name, resolvePart(index, template, other, choice).tiles.length)
    }

    const options = groupByItem(index, resolved.tiles).map((group): AssemblyOption => {
      const perTile = group.tiles.map((tile) => ({
        tile,
        ...consequences(index, template, part, choice, open, tile),
      }))
      const live = perTile.filter((entry) => entry.empties.length === 0).map((entry) => entry.tile)
      const deadEnd = live.length === 0 && perTile.length > 0
      const union = (pick: (entry: (typeof perTile)[number]) => readonly string[]): readonly string[] =>
        [...new Set(perTile.flatMap(pick))].sort()

      /* The narrowing shown is the *contributed* file's, not a union: a union over
         variants that narrow differently would name a figure no single pick
         produces. The card contributes one file, so it reports that file's effect. */
      const contributed = contributedVariant(index, group.aggregate, group.tiles, live)
      const from = perTile.find((entry) => entry.tile === contributed.id) ?? perTile[0]

      return {
        address: group.aggregate.address,
        aggregate: group.aggregate,
        variant: contributed,
        tiles: group.tiles,
        empties: deadEnd ? union((entry) => entry.empties) : [],
        deadEnd,
        narrows: deadEnd ? [] : (from?.narrows ?? []),
        rescues: union((entry) => entry.rescues),
      }
    })

    const variant = chosen === undefined ? undefined : index.aggregates.byTile.get(chosen)
    const declared = chosen === undefined ? [] : index.slotsOf(chosen)
    const fulfilled = new Set(part.fulfills)

    return {
      part,
      name: part.name,
      key: assemblyStepKey(template, part.name),
      options,
      candidates: resolved.tiles.length,
      narrowedFrom,
      deadEnd: resolved.deadEnd,
      unknownRefs: resolved.unknownRefs,
      chosen,
      variant,
      nested: declared.filter((slot) => !fulfilled.has(slot.name)),
      covered: declared.filter((slot) => fulfilled.has(slot.name)).map((slot) => slot.name),
      coveredBy: undefined,
      redundant: false,
    }
  })

  const answered = steps.filter((step) => step.chosen !== undefined || step.coveredBy !== undefined)

  return {
    template,
    steps,
    filled: answered.length,
    complete: answered.length === template.parts.length,
    next: steps.find((step) => step.chosen === undefined && step.coveredBy === undefined)?.name,
    tiles: steps
      .filter((step) => step.coveredBy === undefined)
      .map((step) => step.chosen)
      .filter((tile): tile is TileId => tile !== undefined),
    redundant: steps.filter((step) => step.redundant).map((step) => step.name),
  }
}

/* ------------------------------------------------------------------- wording */

/** `narrows` as a sentence. Empty when a pick changes nothing, which happens. */
export function narrowingSentence(option: AssemblyOption): string {
  if (option.narrows.length === 0) return ''
  const clauses = option.narrows.map(
    ({ part, from, to }) => `${part} ${String(from)} to ${String(to)}`,
  )
  return `Narrows ${clauses.join(', ')}.`
}

/**
 * What a greyed card's reason says.
 *
 * A sentence and not a word, for C2's reason: the file exists, it fits this part,
 * and printing it is fine — what it does is close a *different* part. The `base`
 * wording is separate because a base is not a decoration, and every recipe here
 * has exactly one.
 */
export function deadEndSentence(option: AssemblyOption): string {
  const [first] = option.empties
  if (first === undefined) return ''
  if (option.empties.length === 1) {
    return first === 'base'
      ? 'Leaves no base this recipe can be printed on.'
      : `Leaves the ${first} part with nothing to fill it.`
  }
  return `Leaves ${option.empties.join(' and ')} with nothing to fill them.`
}

/** What a step with no candidate at all says, told apart from a dangling ref. */
export function emptyStepSentence(step: AssemblyStep): string {
  if (step.unknownRefs.length > 0) {
    return `This part asks for ${step.unknownRefs.join(', ')}, and this index holds no such tag.`
  }
  return step.narrowedFrom === undefined
    ? 'Nothing in the archive fits this part, so this recipe cannot be built from the catalog.'
    : 'Nothing fits this part any more. Change an earlier choice to reopen it.'
}

/**
 * The count line for a step, with the narrowing disclosed rather than implied.
 *
 * The `narrowedFrom` clause is what the row is for, and it is stated as a fact
 * about this step rather than as a promise about the flow — because the flow's
 * narrowing is front-loaded and the third pick onward narrows nothing at all.
 */
export function stepCountSentence(step: AssemblyStep): string {
  const items = `${String(step.options.length)} ${step.options.length === 1 ? 'item fits' : 'items fit'}`
  const files = `${String(step.candidates)} ${step.candidates === 1 ? 'file' : 'files'}`
  const base = `${items}, over ${files}.`
  if (step.narrowedFrom === undefined || step.narrowedFrom === step.candidates) return base
  return `${base} Narrowed from ${String(step.narrowedFrom)} by what you have already chosen.`
}
