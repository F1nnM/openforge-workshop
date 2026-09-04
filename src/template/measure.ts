/**
 * The fill solver measured against the archive, including the policies it does
 * **not** use.
 *
 * ## Why the controls are re-implemented here rather than switched on in `fill.ts`
 *
 * This row exists because of one comparison — a greedy walk completes 24 of the
 * 40 shipped recipes and a greying-aware walk completes 40 — and a comparison is
 * only worth something if the loser is a real implementation of the loser. A
 * `greying: false` flag on {@link solveTemplateFills} would make the control a
 * *branch of the winner*, so a bug shared by both would cancel out and the
 * shipped solver would carry a knob whose only caller is a test.
 *
 * So {@link measureGreedy} and {@link measureGreying} are independent walks over
 * `@/composition` directly, in **catalog order** — the plain reading of "the
 * first candidate" — and {@link measureSolver} runs the real thing. Three
 * numbers, two of them from code that shares nothing with the subject.
 *
 * Every function here takes its index as a parameter and reads no files, so this
 * module runs in the browser as readily as in a test. Only the tests import it,
 * so it is tree-shaken out of every bundle: `src/composition/measure.ts`
 * establishes the pattern and the reason.
 */
import type { CatalogRecord, TileId } from '@/catalog'
import type { AssemblyIndex, AssemblyTemplate, PrintOption } from '@/assembly'
import { printOption, rankBases } from '@/assembly'
import type { CompositionIndex, SiblingSelection } from '@/composition'
import { resolveSlotTags } from '@/composition'
import type { LockSystem } from '@/store'

import type { FillContext } from './fill'
import { solveTemplateFills } from './fill'

/* ------------------------------------------------------------------- the walks */

/** What a policy did to one recipe it could not finish. */
export interface PolicyFailure {
  readonly template: string
  readonly slot: string
  /** Candidate files this slot had with nothing chosen. */
  readonly cold: number
  /** Candidate files it had when the walk reached it. `0` for every failure. */
  readonly atFailure: number
}

/** One policy's result over a set of templates. */
export interface PolicyResult {
  readonly policy: string
  readonly recipes: number
  readonly completed: number
  readonly failures: readonly PolicyFailure[]
  /** Candidate queries the whole run cost, resolutions and sibling probes together. */
  readonly queries: number
  /** Candidates refused because they would have emptied a still-open sibling. */
  readonly skipped: number
}

/** A resolution counter, so every walk here reports its cost in the same unit. */
interface Counter {
  queries: number
}

function candidatesOf(
  composition: CompositionIndex,
  counter: Counter,
  template: AssemblyTemplate,
  part: AssemblyTemplate['parts'][number],
  chosen: ReadonlyMap<string, TileId>,
): readonly TileId[] {
  const siblings: SiblingSelection[] = []
  for (const other of template.parts) {
    if (other.name === part.name) continue
    const tile = chosen.get(other.name)
    if (tile !== undefined) siblings.push({ partName: other.name, tags: composition.tagsOf(tile) })
  }
  counter.queries += 1
  return composition.candidatesFor(resolveSlotTags(part.tags, template.tags, siblings)).tiles
}

/**
 * **The control.** Walk the parts in declared order and take the first candidate
 * file, in catalog order, with no regard for what it does to a sibling.
 *
 * Measured at **24 of 40**, and the sixteen failures are all the same slot of
 * the same sixteen recipes — {@link PolicyResult.failures} carries which, so the
 * localisation is a value rather than a claim.
 */
export function measureGreedy(
  templates: readonly AssemblyTemplate[],
  composition: CompositionIndex,
): PolicyResult {
  const counter: Counter = { queries: 0 }
  const failures: PolicyFailure[] = []
  let completed = 0

  for (const template of templates) {
    const chosen = new Map<string, TileId>()
    let ok = true
    for (const part of template.parts) {
      const tiles = candidatesOf(composition, counter, template, part, chosen)
      const first = tiles[0]
      if (first === undefined) {
        ok = false
        failures.push({
          template: template.id,
          slot: part.name,
          cold: candidatesOf(composition, counter, template, part, new Map()).length,
          atFailure: 0,
        })
        break
      }
      chosen.set(part.name, first)
    }
    if (ok) completed += 1
  }

  return { policy: 'first candidate', recipes: templates.length, completed, failures, queries: counter.queries, skipped: 0 }
}

/**
 * **The rule.** The same walk, refusing any candidate that would leave a
 * still-open sibling with nothing.
 *
 * Independent of `fill.ts` in every respect including the sibling-dependency
 * filter: this probes **every** still-open sibling, where the shipped solver
 * probes only the ones whose `constrain` can read this part. So the two query
 * counts are a measurement of that filter, and the two completion counts are a
 * check that it changed nothing.
 */
export function measureGreying(
  templates: readonly AssemblyTemplate[],
  composition: CompositionIndex,
): PolicyResult {
  const counter: Counter = { queries: 0 }
  const failures: PolicyFailure[] = []
  let completed = 0
  let skipped = 0

  for (const template of templates) {
    const chosen = new Map<string, TileId>()
    let ok = true
    for (const part of template.parts) {
      const tiles = candidatesOf(composition, counter, template, part, chosen)
      let picked: TileId | undefined
      for (const tile of tiles) {
        chosen.set(part.name, tile)
        const empties = template.parts.some(
          (other) =>
            other.name !== part.name &&
            chosen.get(other.name) === undefined &&
            candidatesOf(composition, counter, template, other, chosen).length === 0,
        )
        chosen.delete(part.name)
        if (!empties) {
          picked = tile
          break
        }
        skipped += 1
      }
      if (picked === undefined) {
        ok = false
        failures.push({
          template: template.id,
          slot: part.name,
          cold: candidatesOf(composition, counter, template, part, new Map()).length,
          atFailure: tiles.length,
        })
        break
      }
      chosen.set(part.name, picked)
    }
    if (ok) completed += 1
  }

  return {
    policy: 'first candidate that empties no sibling',
    recipes: templates.length,
    completed,
    failures,
    queries: counter.queries,
    skipped,
  }
}

/** {@link solveTemplateFills} over the same set, reported in the same shape. */
export function measureSolver(
  templates: readonly AssemblyTemplate[],
  index: AssemblyIndex,
  context: FillContext,
): PolicyResult {
  const failures: PolicyFailure[] = []
  let completed = 0
  let queries = 0
  let skipped = 0

  for (const template of templates) {
    const fill = solveTemplateFills(template, index, context)
    queries += fill.queries
    for (const decision of fill.decisions) skipped += decision.skipped
    if (fill.complete) {
      completed += 1
      continue
    }
    for (const decision of fill.decisions) {
      if (decision.tile !== undefined) continue
      failures.push({
        template: template.id,
        slot: decision.slot,
        cold: 0,
        atFailure: decision.candidates,
      })
    }
  }

  return { policy: 'solveTemplateFills', recipes: templates.length, completed, failures, queries, skipped }
}

/**
 * Whether any recipe is unsolvable at all, searched with backtracking.
 *
 * The one thing the two walks above cannot tell apart: a policy that fails on a
 * recipe nothing can solve is not a bad policy. Over **item representatives**
 * rather than every file — the first candidate file of each item — because the
 * exhaustive product over files is not a search anybody would run and the
 * question is whether a solution exists, not how many.
 *
 * Reports the nodes visited alongside, which is the price of the alternative
 * policy: if backtracking ever completed a recipe the one-step rule does not,
 * this is what it would cost to adopt.
 */
export function measureBacktracking(
  templates: readonly AssemblyTemplate[],
  composition: CompositionIndex,
): { readonly completed: number; readonly nodes: number; readonly unsolvable: readonly string[] } {
  const counter: Counter = { queries: 0 }
  let completed = 0
  let nodes = 0
  const unsolvable: string[] = []

  for (const template of templates) {
    const chosen = new Map<string, TileId>()
    const search = (at: number): boolean => {
      const part = template.parts[at]
      if (part === undefined) return true
      const tiles = candidatesOf(composition, counter, template, part, chosen)
      const seen = new Set<number>()
      for (const tile of tiles) {
        const variant = composition.aggregates.byTile.get(tile)
        const aggregate = variant === undefined ? undefined : composition.aggregates.byDesign.get(variant.design)
        const address = aggregate === undefined ? -1 : (aggregate.address as unknown as number)
        if (seen.has(address)) continue
        seen.add(address)
        nodes += 1
        chosen.set(part.name, tile)
        if (search(at + 1)) return true
        chosen.delete(part.name)
      }
      return false
    }
    if (search(0)) completed += 1
    else unsolvable.push(template.id)
  }

  return { completed, nodes, unsolvable }
}

/* ------------------------------------------------------------- the base ladder */

/** What each of the two base policies picked for one base slot. */
export interface BasePick {
  readonly template: string
  readonly slot: string
  readonly candidates: number
  /** `rankBases`' answer — the shipped policy. */
  readonly ranked: TileId | undefined
  readonly rankedOption: PrintOption | undefined
  /** The first candidate in the caller's order — what a plain walk would take. */
  readonly ordered: TileId | undefined
  readonly orderedOption: PrintOption | undefined
  readonly lockAgrees: boolean
  readonly codeAgrees: boolean
}

/**
 * The base ladder against the order it breaks ties on, over every slot something
 * rests on.
 *
 * This is the measurement that says whether consuming `rankBases` was worth a
 * dependency: it reports the print option each policy lands on, and a `topless`
 * base is a base with no top surface. Row A3's figure for the whole archive is
 * 3,986 of 3,986 `plain` ranked against 3,258 of 3,986 `topless` on a
 * bytes-ascending tie-break; this is the same comparison restricted to the base
 * slots of the shipped recipes.
 */
export function measureBaseLadder(
  templates: readonly AssemblyTemplate[],
  index: AssemblyIndex,
  context: FillContext,
): readonly BasePick[] {
  const out: BasePick[] = []

  for (const template of templates) {
    const fill = solveTemplateFills(template, index, context)
    for (const decision of fill.decisions) {
      if (decision.base === undefined) continue
      const cell = fill.decisions.find((one) => one.slot === 'floor')?.record
      const reference = cell ?? decision.record
      if (reference === undefined) continue
      const pool = poolFor(template, decision.slot, index, context, fill.fills)
      const ranked = rankBases(reference, pool, index, context.lock)
      const ordered = pool[0]
      out.push({
        template: template.id,
        slot: decision.slot,
        candidates: pool.length,
        ranked: ranked?.base.id,
        rankedOption: ranked === undefined ? undefined : optionOf(index, ranked.base),
        ordered: ordered?.id,
        orderedOption: ordered === undefined ? undefined : optionOf(index, ordered),
        lockAgrees: ranked?.lockAgrees === true,
        codeAgrees: ranked?.codeAgrees === true,
      })
    }
  }

  return out
}

/**
 * A record's print option in this index — `baseMatch.ts#optionOf`'s reading.
 *
 * The index's own map first, and `printOption` over the connection tags for a
 * candidate that is not a base. Both halves are needed for the same reason the
 * ladder needs them: a `base` slot `require`s the tag `shape|base` rather than a
 * layer, so a candidate that is not in `basePrintOption` is reachable.
 */
function optionOf(index: AssemblyIndex, record: CatalogRecord): PrintOption {
  return index.basePrintOption.get(record.id) ?? printOption(record.conn)
}

/**
 * One slot's candidate records under a finished set of fills, in the solver's own
 * candidate order.
 *
 * Rebuilt here rather than carried on {@link SlotDecision} because a decision
 * reports the *choice* and not the pool it came from: 305 records on the drain's
 * base slot is not something to hang off every fill of every instance in a
 * 250-instance room.
 */
function poolFor(
  template: AssemblyTemplate,
  slot: string,
  index: AssemblyIndex,
  context: FillContext,
  fills: Readonly<Record<string, TileId>>,
): readonly CatalogRecord[] {
  const part = template.parts.find((one) => one.name === slot)
  if (part === undefined) return []
  const siblings: SiblingSelection[] = []
  for (const other of template.parts) {
    if (other.name === slot) continue
    const tile = fills[other.name]
    if (tile !== undefined) siblings.push({ partName: other.name, tags: context.composition.tagsOf(tile) })
  }
  const resolved = resolveSlotTags(part.tags, template.tags, siblings)
  return context.composition
    .candidatesFor(resolved)
    .tiles.map((tile) => index.byId.get(tile))
    .filter((record): record is CatalogRecord => record !== undefined)
}

/* --------------------------------------------------------------- the lock spread */

/** How much a lock preference moves the fills of one template. */
export interface LockSpread {
  readonly template: string
  /** Slots whose file differs between at least two of the three systems. */
  readonly moved: readonly string[]
  /** Slots whose **item** differs — expected to be empty; the candidate set is lock-free. */
  readonly movedItem: readonly string[]
}

/**
 * What a lock toggle actually changes, per template.
 *
 * The measurement behind `relock.ts`'s claim that the candidate set is lock-free:
 * if the lock could move which *item* fills a slot, {@link LockSpread.movedItem}
 * would be non-empty somewhere.
 */
export function measureLockSpread(
  templates: readonly AssemblyTemplate[],
  index: AssemblyIndex,
  context: FillContext,
  locks: readonly LockSystem[],
): readonly LockSpread[] {
  return templates.map((template) => {
    const byLock = locks.map((lock) => solveTemplateFills(template, index, { ...context, lock }))
    const moved: string[] = []
    const movedItem: string[] = []
    for (const part of template.parts) {
      const tiles = new Set(byLock.map((fill) => fill.fills[part.name]))
      if (tiles.size > 1) moved.push(part.name)
      const designs = new Set(
        byLock.map((fill) => {
          const tile = fill.fills[part.name]
          return tile === undefined ? undefined : index.byId.get(tile)?.design
        }),
      )
      if (designs.size > 1) movedItem.push(part.name)
    }
    return { template: template.id, moved, movedItem }
  })
}

/* -------------------------------------------------------------- the scene scale */

/** One shape of the scene-scale re-solve, timed. */
export interface SceneCost {
  readonly shape: 'per instance' | 'memoised'
  readonly instances: number
  readonly solves: number
  readonly queries: number
  readonly ms: number
}

/**
 * The cost of a lock toggle over a whole room, both ways.
 *
 * `per instance` is the shape the plan prices — one solve per instance, which is
 * what a driver without a memo does. `memoised` is what {@link reSolveScene}
 * does: one solve per distinct `(template, pins)`, which a room of 250 instances
 * built from 40 recipes bounds at 40.
 *
 * The store is deliberately not involved: this times the **solver**, because the
 * write is a `setState` per slot either way and `writeFill` returns the identical
 * state object when nothing moved.
 */
export function measureSceneCost(
  scene: readonly AssemblyTemplate[],
  index: AssemblyIndex,
  context: FillContext,
): readonly SceneCost[] {
  const perInstance = (): SceneCost => {
    const start = performance.now()
    let queries = 0
    for (const template of scene) queries += solveTemplateFills(template, index, context).queries
    return { shape: 'per instance', instances: scene.length, solves: scene.length, queries, ms: performance.now() - start }
  }

  const memoised = (): SceneCost => {
    const start = performance.now()
    const memo = new Map<string, number>()
    let queries = 0
    let solves = 0
    for (const template of scene) {
      if (memo.has(template.id)) continue
      const fill = solveTemplateFills(template, index, context)
      memo.set(template.id, fill.queries)
      queries += fill.queries
      solves += 1
    }
    return { shape: 'memoised', instances: scene.length, solves, queries, ms: performance.now() - start }
  }

  // Warmed once, because the first solve of a run pays for the postings walk's
  // cold caches and a figure that included it would be a fact about V8 rather
  // than about the room.
  const first = scene[0]
  if (first !== undefined) solveTemplateFills(first, index, context)

  return [perInstance(), memoised()]
}

/* ------------------------------------------------------- the walk's own claims */

/** The post-pick observations of one solved walk. */
export interface Monotonicity {
  /**
   * `(pick, still-open sibling)` pairs the walk produced — **148** over the 40
   * shipped recipes, which is the plan's own observation count.
   */
  readonly observations: number
  /** Observations where the pick took a sibling from some candidates to none. */
  readonly emptied: number
  /** Observations where it took a sibling from none to some — the grammar permits it. */
  readonly rescued: number
  /** Observations where the set got smaller and stayed non-empty. */
  readonly narrowed: number
}

/**
 * Whether the walk the solver actually took is **monotone**: does any pick it
 * made empty a part it had not filled yet?
 *
 * The plan's claim is *"0 parts emptied in 148 observations"*, and it is worth
 * checking rather than deriving from the policy, because the policy's guarantee
 * is about the parts it *probed*: {@link readsSibling} excludes the pairs it
 * believes inert, and `solveTemplateFills` short-circuits on the first emptied
 * sibling. This re-resolves **every** still-open sibling after **every** pick,
 * with no filter and no short-circuit, which is the claim stated as an
 * observation.
 */
export function measureMonotonicity(
  templates: readonly AssemblyTemplate[],
  index: AssemblyIndex,
  context: FillContext,
): Monotonicity {
  const counter: Counter = { queries: 0 }
  let observations = 0
  let emptied = 0
  let rescued = 0
  let narrowed = 0

  for (const template of templates) {
    const fill = solveTemplateFills(template, index, context)
    const chosen = new Map<string, TileId>()
    template.parts.forEach((part, at) => {
      const tile = fill.fills[part.name]
      const open = template.parts.slice(at + 1)
      const before = open.map((other) => candidatesOf(context.composition, counter, template, other, chosen).length)
      if (tile !== undefined) chosen.set(part.name, tile)
      open.forEach((other, i) => {
        observations += 1
        const was = before[i] ?? 0
        const now = candidatesOf(context.composition, counter, template, other, chosen).length
        if (was > 0 && now === 0) emptied += 1
        else if (was === 0 && now > 0) rescued += 1
        else if (now < was) narrowed += 1
      })
    })
  }

  return { observations, emptied, rescued, narrowed }
}

/** What the sibling-dependency filter drops, and whether dropping it was safe. */
export interface FilterSoundness {
  /** `(pick, still-open sibling)` pairs the walk reaches. 148 over the 40. */
  readonly pairs: number
  /** Pairs {@link readsSibling} keeps. 112. */
  readonly probed: number
  /** Pairs it drops as unreachable. 36. */
  readonly dropped: number
  /** Dropped pairs whose candidate count the pick did **not** move. Must equal `dropped`. */
  readonly inert: number
}

/**
 * The sibling-dependency filter, checked against the archive rather than against
 * the grammar.
 *
 * For every pair the filter drops, resolve the sibling with and without the
 * pick. A single moved count would mean the static read of `constrain` is wrong
 * and the solver is skipping a probe it needs — which is the one way this
 * optimisation could cost a completed recipe.
 */
export function measureFilterSoundness(
  templates: readonly AssemblyTemplate[],
  index: AssemblyIndex,
  context: FillContext,
): FilterSoundness {
  const counter: Counter = { queries: 0 }
  let pairs = 0
  let probed = 0
  let dropped = 0
  let inert = 0

  for (const template of templates) {
    const fill = solveTemplateFills(template, index, context)
    const chosen = new Map<string, TileId>()
    template.parts.forEach((part, at) => {
      const tile = fill.fills[part.name]
      for (const other of template.parts.slice(at + 1)) {
        pairs += 1
        if (readsSiblingOf(other, part.name)) {
          probed += 1
          continue
        }
        dropped += 1
        const before = candidatesOf(context.composition, counter, template, other, chosen).length
        const after = candidatesOf(
          context.composition,
          counter,
          template,
          other,
          tile === undefined ? chosen : new Map([...chosen, [part.name, tile]]),
        ).length
        if (before === after) inert += 1
      }
      if (tile !== undefined) chosen.set(part.name, tile)
    })
  }

  return { pairs, probed, dropped, inert }
}

/**
 * `fill.ts#readsSibling`, restated.
 *
 * The one duplication in this module, and it is deliberate for the same reason
 * the greedy walk is duplicated: a soundness check that imported the predicate
 * it is checking would agree with it by construction. Three lines of the
 * grammar, and `fill.test.ts` pins the behaviour of the original.
 */
function readsSiblingOf(slot: AssemblyTemplate['parts'][number], sibling: string): boolean {
  for (const entry of slot.tags.constrain ?? []) {
    if (!('tag' in entry) || entry.tag === undefined || entry.tag === '') continue
    const from = entry.siblings
    if (from === undefined || from.includes(sibling)) return true
  }
  return false
}
