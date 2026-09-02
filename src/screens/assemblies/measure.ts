/**
 * The 40 templates against the live archive — every figure this row states.
 *
 * Row C1 set the pattern and the reason for it: a docblock full of measurements
 * goes stale silently, so the measurements are a function and the function runs
 * in CI. `corpus.test.ts` calls {@link measureTemplates} once over
 * `public/catalog/catalog.json` and asserts each field against the number quoted
 * in `assembly.ts` and `fixtures.ts`, so a fixture import that moved any of them
 * fails the suite instead of leaving prose behind.
 *
 * Nothing here is imported by the screen, so it is tree-shaken out of any bundle
 * — the same disposition as `src/composition/measure.ts`.
 *
 * **The comparison this file exists for** is {@link SiblingCensus}. Row C2
 * measured the same thing on tile parents and found **0 narrowings in 33,221
 * observations**; this row was scheduled on the assumption that narrowing exists.
 * Both are true, of different parents, and the only honest way to say so is to
 * compute the template half rather than argue about it.
 *
 * ## Why the census is built on `resolvePart` and not on `assemblyState`
 *
 * `assemblyState` is the screen's unit: every part, every card, and every card's
 * consequences for every still-open part, at a measured 4.1 ms median. A census
 * asks for candidate *counts* under tens of thousands of hypothetical choices, so
 * built on that unit it would be minutes of CI. It is built on `resolvePart`
 * instead — one resolution, one postings walk — and `assemblyState` is called
 * only where a card's dead-end verdict is genuinely the subject: the two walks,
 * and the timing.
 */
import type { TileId } from '@/catalog'
import type { CompositionIndex } from '@/composition'

import type { AssemblyChoice, RecipeIndex, RecipeTemplate, TemplatePart } from './assembly'
import { assemblyState, resolvePart } from './assembly'

/* --------------------------------------------------------------- the readings */

/** A distribution, reported rather than summarised — the max is the hazard. */
export interface Spread {
  readonly n: number
  readonly min: number
  readonly median: number
  readonly p90: number
  readonly max: number
  readonly total: number
}

/**
 * One pick's effect on one still-open part, classified exactly as C2 classified
 * it, so the two censuses are comparable rather than merely both present.
 */
export interface SiblingCensus {
  readonly observations: number
  readonly unchanged: number
  /** Non-empty before, empty after. C2's dead end. */
  readonly emptied: number
  /** Smaller and still non-empty. **0 of C2's 33,221; the majority here.** */
  readonly narrowed: number
  /** Larger after. C2 found 3, via `filterSpecificTags` keeping the general survivor. */
  readonly widened: number
}

/** How the still-open parts move at each step of a walk. */
export interface StepCensus extends SiblingCensus {
  /** 1-based: the pick that caused it. */
  readonly after: number
}

/** What a walk over all 40 templates achieved, and what it faced. */
export interface WalkReport {
  /** Templates completed in one pass, with no backtracking. */
  readonly completed: number
  /** Item grids the user was shown, over every step of every template. */
  readonly grids: Spread
  /** Grids larger than the page size — the ones needing a second page. */
  readonly overPage: number
  /** Cards offered, and how many were refused as dead ends. */
  readonly cardsOffered: number
  readonly cardsGreyed: number
  /** The walk's effect on the still-open parts, per step. */
  readonly steps: readonly StepCensus[]
}

export interface TemplateReport {
  readonly templates: number
  readonly sourceFiles: number
  readonly parts: number
  /** Parts sharing a name inside one template. Must be 0 for `(template, part)` to be a key. */
  readonly duplicatePartNames: number
  /** Distinct part names across the 40. */
  readonly partNames: readonly string[]
  /** `constrain` entries carrying a `siblings` list. 0 in the JSON corpus. */
  readonly siblingsEntries: number
  /** Part-level `fulfills` declarations. 0 in the JSON corpus. */
  readonly fulfillsEntries: number
  /** `fulfills` entries naming something other than `base`. */
  readonly fulfillsNotBase: number
  /** Distinct first segments of the templates' own tags, sorted. */
  readonly tagRoots: readonly string[]
  /** Distinct first segments of every `constrain` entry's tag, sorted. */
  readonly constrainRoots: readonly string[]
  /**
   * Roots the templates' own tags share with their `constrain` entries.
   *
   * **Empty is the whole mechanism.** A tile parent shares every one of them, so
   * a sibling repeats a tag the parent already pinned; a template shares none, so
   * the siblings supply the constrained namespace on their own.
   */
  readonly sharedRoots: readonly string[]

  /** Candidate **files** per part, before any pick. */
  readonly initialFiles: Spread
  /** Candidate **items** per part, before any pick — what a grid shows. */
  readonly initialItems: Spread
  /** Parts with no candidate at all before any pick. */
  readonly deadEndParts: number
  /** Parts naming a tag the index does not hold. */
  readonly unknownRefParts: number

  /** Every (representative card, still-open part) pair, unguided. C2's unit. */
  readonly siblings: SiblingCensus
  /** How much a narrowing narrows, as `from / to`. */
  readonly narrowingFactor: Spread

  /** First card at every step, dead ends ignored. */
  readonly blindWalk: WalkReport
  /** First card that closes no still-open part. C2's capability, applied as a rule. */
  readonly guidedWalk: WalkReport
  /** Templates for which a complete assignment exists at all, searched exhaustively. */
  readonly solvable: number

  /** Parts at least one of whose candidates declares its own parts. */
  readonly partsWithNestedCandidates: number
  /** Parts declaring a part-level `fulfills`. */
  readonly fulfillingParts: number
  /** Their candidate files. */
  readonly fulfillingCandidates: number
  /** Of those, the ones declaring nested parts of their own. */
  readonly fulfillingCandidatesNested: number
  /** Nested parts whose name a `fulfills` names — the declaration actually firing. */
  readonly coveredNestedParts: number
  /** Nested part names seen under a fulfilling part, sorted. */
  readonly nestedNames: readonly string[]

  /**
   * The *blueprint-level* half of `fulfills`, measured for reachability.
   *
   * C1 counted 21 records carrying a `config.fulfills` and could say no more than
   * that they *"can fill a slot at all"*. These four fields say which slot:
   * the names those 21 declarations use — `column`, `left wall`, `right wall` —
   * occur in **0** of the 3,703 JSON part declarations and only as template part
   * names, so the corpus's own inverse relation is unresolvable against the
   * corpus and resolvable only here.
   */
  readonly coveringRecords: number
  /** (part, fulfilling candidate) pairs across all 128 parts. */
  readonly coveringPairs: number
  /** Parts at least one of whose candidates can cover a sibling. */
  readonly coveringParts: readonly string[]
  /** Recipes on which covering is reachable at all. */
  readonly coveringTemplates: readonly string[]

  /** Parts whose grid exceeds one page **before** any narrowing. */
  readonly unnarrowedOverPage: number

  /**
   * Item cards whose candidate files disagree about closing a part.
   *
   * C2 measured **0 of 4,330** on tile parents and kept the tie-break anyway.
   * This counts rather than inherits that, because a card that looks available
   * and closes a part anyway is the one thing greying must not do.
   */
  readonly partialOptions: number
  /** Cards that would open a part currently empty. C2's three `rescues`, re-asked. */
  readonly cardsRescuing: number

  /** Milliseconds for one {@link assemblyState} over a whole template. */
  readonly resolveMs: Spread
}

/* ------------------------------------------------------------------ the maths */

function spread(values: readonly number[]): Spread {
  if (values.length === 0) return { n: 0, min: 0, median: 0, p90: 0, max: 0, total: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  const at = (fraction: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0
  return {
    n: values.length,
    min: sorted[0] ?? 0,
    median: at(0.5),
    p90: at(0.9),
    max: sorted[sorted.length - 1] ?? 0,
    total: values.reduce((sum, value) => sum + value, 0),
  }
}

function roots(tags: Iterable<string>): readonly string[] {
  return [...new Set([...tags].map((tag) => tag.split('|')[0] ?? tag))].sort()
}

function classify(before: number, after: number): keyof SiblingCensus {
  if (after === before) return 'unchanged'
  if (after === 0) return 'emptied'
  if (after < before) return 'narrowed'
  return 'widened'
}

function emptyCensus(): { -readonly [K in keyof SiblingCensus]: number } {
  return { observations: 0, unchanged: 0, emptied: 0, narrowed: 0, widened: 0 }
}

/**
 * One representative file per candidate item, in candidate order.
 *
 * The unit of the census is the **card**, because a card is what a user presses.
 * C2 counted item picks the same way, which is what makes the two comparable.
 */
function representatives(index: CompositionIndex, tiles: readonly TileId[]): readonly TileId[] {
  const out: TileId[] = []
  const seen = new Set<number>()
  for (const tile of tiles) {
    const variant = index.aggregates.byTile.get(tile)
    if (variant === undefined) continue
    const aggregate = index.aggregates.byDesign.get(variant.design)
    if (aggregate === undefined) continue
    const address = aggregate.address as unknown as number
    if (seen.has(address)) continue
    seen.add(address)
    out.push(tile)
  }
  return out
}

/** Still-open parts a pick would empty, by the light resolution. */
function emptiedBy(
  index: CompositionIndex,
  template: RecipeTemplate,
  part: TemplatePart,
  choice: AssemblyChoice,
  tile: TileId,
): number {
  const withPick: AssemblyChoice = { ...choice, [part.name]: tile }
  let closed = 0
  for (const other of template.parts) {
    if (other.name === part.name || choice[other.name] !== undefined) continue
    const before = resolvePart(index, template, other, choice).tiles.length
    if (before === 0) continue
    if (resolvePart(index, template, other, withPick).tiles.length === 0) closed += 1
  }
  return closed
}

/* -------------------------------------------------------------------- the walk */

/**
 * One pass over a template's parts in declared order.
 *
 * `guided` is the whole difference between the two reports: it refuses a card
 * that would empty a still-open part, which is C2's greying applied as a rule
 * rather than shown as a colour.
 */
function walk(
  recipes: RecipeIndex,
  template: RecipeTemplate,
  guided: boolean,
): {
  readonly completed: boolean
  readonly grids: readonly number[]
  readonly offered: number
  readonly greyed: number
  readonly effects: readonly { readonly after: number; readonly before: number; readonly to: number }[]
} {
  const index = recipes.composition
  let choice: AssemblyChoice = {}
  const grids: number[] = []
  const effects: { after: number; before: number; to: number }[] = []
  let offered = 0
  let greyed = 0

  for (let at = 0; at < template.parts.length; at += 1) {
    const state = assemblyState(recipes, template, choice)
    // A part a sibling's pick covers needs no card at all, so it is not a step.
    if (state.steps[at]?.coveredBy !== undefined) continue
    const step = state.steps[at]
    if (step === undefined) break
    grids.push(step.options.length)
    offered += step.options.length
    greyed += step.options.filter((option) => option.deadEnd).length

    const pick = step.options.find((option) => !guided || !option.deadEnd)
    if (pick === undefined) return { completed: false, grids, offered, greyed, effects }

    const before = new Map(
      state.steps
        .filter((other) => other.name !== step.name && other.chosen === undefined)
        .map((other) => [other.name, other.candidates] as const),
    )
    choice = { ...choice, [step.name]: pick.variant.id }
    for (const other of template.parts) {
      const was = before.get(other.name)
      if (was === undefined) continue
      effects.push({ after: at + 1, before: was, to: resolvePart(index, template, other, choice).tiles.length })
    }
  }

  return { completed: true, grids, offered, greyed, effects }
}

/** Does a complete assignment exist at all? Depth-first over item representatives. */
function solvable(index: CompositionIndex, template: RecipeTemplate): boolean {
  const search = (at: number, choice: AssemblyChoice): boolean => {
    const part = template.parts[at]
    if (part === undefined) return true
    const resolved = resolvePart(index, template, part, choice)
    for (const tile of representatives(index, resolved.tiles)) {
      if (search(at + 1, { ...choice, [part.name]: tile })) return true
    }
    return false
  }
  return search(0, {})
}

/* ---------------------------------------------------------------- the report */

export function measureTemplates(
  recipes: RecipeIndex,
  templates: readonly RecipeTemplate[],
  pageSize: number,
): TemplateReport {
  const index = recipes.composition
  const parts = templates.flatMap((template) => template.parts)

  let duplicatePartNames = 0
  for (const template of templates) {
    duplicatePartNames += template.parts.length - new Set(template.parts.map((part) => part.name)).size
  }

  const constrain = parts.flatMap((part) => part.tags.constrain ?? [])
  const templateRoots = roots(templates.flatMap((template) => template.tags))
  const constrainRoots = roots(
    constrain.map((entry) => entry.tag).filter((tag): tag is string => tag !== undefined),
  )

  const initialFiles: number[] = []
  const initialItems: number[] = []
  let deadEndParts = 0
  let unknownRefParts = 0
  let partsWithNestedCandidates = 0
  let fulfillingParts = 0
  let fulfillingCandidates = 0
  let fulfillingCandidatesNested = 0
  let coveredNestedParts = 0
  let partialOptions = 0
  let cardsRescuing = 0
  const nestedNames = new Set<string>()
  const coveringRecords = new Set<TileId>()
  const coveringParts = new Set<string>()
  const coveringTemplates = new Set<string>()
  let coveringPairs = 0
  let unnarrowedOverPage = 0
  const siblings = emptyCensus()
  const factors: number[] = []
  const resolveMs: number[] = []

  for (const template of templates) {
    const started = performance.now()
    const initial = assemblyState(recipes, template)
    resolveMs.push(performance.now() - started)

    const was = new Map(initial.steps.map((step) => [step.name, step.candidates] as const))

    for (const step of initial.steps) {
      initialFiles.push(step.candidates)
      initialItems.push(step.options.length)
      if (step.deadEnd) deadEndParts += 1
      if (step.unknownRefs.length > 0) unknownRefParts += 1

      const candidates = step.options.flatMap((option) => option.tiles)
      if (candidates.some((tile) => index.slotsOf(tile).length > 0)) partsWithNestedCandidates += 1
      if (step.options.length > pageSize) unnarrowedOverPage += 1

      for (const tile of candidates) {
        const covers = recipes
          .fulfilledBy(tile)
          .filter((name) => name !== step.name && template.parts.some((other) => other.name === name))
        if (covers.length === 0) continue
        coveringPairs += 1
        coveringRecords.add(tile)
        coveringParts.add(step.name)
        coveringTemplates.add(template.name)
      }

      const fulfilled = new Set(step.part.fulfills)
      if (fulfilled.size > 0) {
        fulfillingParts += 1
        for (const tile of candidates) {
          fulfillingCandidates += 1
          const nested = index.slotsOf(tile)
          if (nested.length > 0) fulfillingCandidatesNested += 1
          for (const slot of nested) {
            nestedNames.add(slot.name)
            if (fulfilled.has(slot.name)) coveredNestedParts += 1
          }
        }
      }

      for (const option of step.options) {
        if (option.rescues.length > 0) cardsRescuing += 1
        if (option.tiles.length < 2) continue
        const closing = option.tiles.filter(
          (tile) => emptiedBy(index, template, step.part, {}, tile) > 0,
        ).length
        if (closing > 0 && closing < option.tiles.length) partialOptions += 1
      }

      // The unguided census, per representative card.
      for (const tile of representatives(index, candidates)) {
        const choice: AssemblyChoice = { [step.name]: tile }
        for (const other of template.parts) {
          if (other.name === step.name) continue
          const before = was.get(other.name) ?? 0
          const after = resolvePart(index, template, other, choice).tiles.length
          const verdict = classify(before, after)
          siblings.observations += 1
          siblings[verdict] += 1
          if (verdict === 'narrowed') factors.push(before / after)
        }
      }
    }
  }

  const runs = (guided: boolean): WalkReport => {
    const walked = templates.map((template) => walk(recipes, template, guided))
    const grids = walked.flatMap((run) => run.grids)
    const byStep = new Map<number, { -readonly [K in keyof SiblingCensus]: number }>()
    for (const run of walked) {
      for (const { after, before, to } of run.effects) {
        const bucket = byStep.get(after) ?? emptyCensus()
        bucket.observations += 1
        bucket[classify(before, to)] += 1
        byStep.set(after, bucket)
      }
    }
    return {
      completed: walked.filter((run) => run.completed).length,
      grids: spread(grids),
      overPage: grids.filter((size) => size > pageSize).length,
      cardsOffered: walked.reduce((total, run) => total + run.offered, 0),
      cardsGreyed: walked.reduce((total, run) => total + run.greyed, 0),
      steps: [...byStep.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([after, census]) => ({ after, ...census })),
    }
  }

  return {
    templates: templates.length,
    sourceFiles: new Set(templates.map((template) => template.source)).size,
    parts: parts.length,
    duplicatePartNames,
    partNames: [...new Set(parts.map((part) => part.name))].sort(),
    siblingsEntries: constrain.filter((entry) => entry.siblings !== undefined).length,
    fulfillsEntries: parts.flatMap((part) => part.fulfills).length,
    fulfillsNotBase: parts.flatMap((part) => part.fulfills).filter((name) => name !== 'base').length,
    tagRoots: templateRoots,
    constrainRoots,
    sharedRoots: templateRoots.filter((root) => constrainRoots.includes(root)),

    initialFiles: spread(initialFiles),
    initialItems: spread(initialItems),
    deadEndParts,
    unknownRefParts,

    siblings,
    narrowingFactor: spread(factors),

    blindWalk: runs(false),
    guidedWalk: runs(true),
    solvable: templates.filter((template) => solvable(index, template)).length,

    partsWithNestedCandidates,
    fulfillingParts,
    fulfillingCandidates,
    fulfillingCandidatesNested,
    coveredNestedParts,
    nestedNames: [...nestedNames].sort(),

    coveringRecords: coveringRecords.size,
    coveringPairs,
    coveringParts: [...coveringParts].sort(),
    coveringTemplates: [...coveringTemplates].sort(),
    unnarrowedOverPage,

    partialOptions,
    cardsRescuing,

    resolveMs: spread(resolveMs),
  }
}

/**
 * The invariants this row's behaviour rests on.
 *
 * Not a restatement of every figure — `corpus.test.ts` asserts those one by one,
 * so a change names itself. These four are the properties that would make the
 * screen *wrong* rather than merely differently shaped, so they throw.
 */
export function assertTemplates(report: TemplateReport): void {
  if (report.templates !== 40) {
    throw new Error(`expected 40 recipe templates, measured ${String(report.templates)}`)
  }
  if (report.duplicatePartNames !== 0) {
    throw new Error(
      `a template repeats a part name ${String(report.duplicatePartNames)} times, so (template, part) is not a key`,
    )
  }
  if (report.siblings.narrowed === 0) {
    throw new Error(
      'no template pick narrows a sibling part, which is the capability this screen exists to show',
    )
  }
  if (report.guidedWalk.completed !== report.templates) {
    throw new Error(
      `greying-guided walk completed ${String(report.guidedWalk.completed)} of ${String(report.templates)} recipes`,
    )
  }
}
