/**
 * How much of the catalog each lock system can actually be **built** in.
 *
 * `reach.ts` answers a different question and both are correct. The split is the
 * whole content of this module, so it is worth stating once, precisely:
 *
 *   - **Reachability** (`reach.ts`) — *does this design mention that lock, or
 *     mention no lock at all*. A property of the archive's tags. Deliberately
 *     position-blind, and it counts a design that delegates its joinery to a
 *     separate base as reachable under every system, because it is.
 *   - **Buildability** (here) — *can the app hand you a complete, printable
 *     assembly in that system*. That needs a resolution: either a variant that
 *     needs no base and carries the lock on its own underside, or a topper for
 *     which a base carrying the lock actually exists in the archive.
 *
 * The second is the one a user experiences, and the two do not agree — not in
 * magnitude and not in direction. Measured on the emitted index at fixtures
 * `4282896`, pipeline stamp 1:
 *
 * | | openlock | dragonlock | magnetic |
 * | --- | ---: | ---: | ---: |
 * | reachable designs | 3,817 (99.9%) | 2,854 (74.7%) | 2,282 (59.7%) |
 * | **buildable designs** | **3,375 (88.3%)** | **3,118 (81.6%)** | **3,008 (78.7%)** |
 * | of those, need no base | 1,497 (39.2%) | 359 (9.4%) | 255 (6.7%) |
 *
 * **openlock falls and magnetic rises**, and neither is a rounding artefact.
 * openlock falls because buildability refuses to count a design it cannot
 * resolve — 447 designs have no openlock path even though their tags do not
 * exclude one. magnetic rises by 19 points because the auto-inserted base
 * *supplies* magnetic joinery to designs whose own tiles carry none: 2,753 of
 * its 3,008 are earned that way. The consequence is the one the whole
 * aggregation row was for: **the spread between best and worst collapses from
 * 40.2 percentage points to 9.6**, so "I already own DragonLock terrain" stops
 * being a decision that costs a quarter of the archive.
 *
 * ## Nothing here is a constant either
 *
 * Same rule as `reach.ts`, and the same reason. Every figure above is a
 * measurement of a build artefact; the table is a record of what it said when
 * this was written, and `build.test.ts` re-derives it against the emitted index
 * so a drift fails rather than ships. **The figures moved while this row was
 * being written** — the research quoted 83.7 / 76.6 / 73.7 and A1's own re-derive
 * quoted 87.7 / 80.8 / 77.9, both against earlier footprint classifiers. That is
 * exactly the failure mode a hard-coded percentage has and a derived one does
 * not.
 *
 * ## Why the definition is the resolver's and not a re-implementation
 *
 * The probe below calls **`matchBase`** and reads `BaseMatch.lockAgrees`.
 * Copying the match here would give the picker its own opinion of which base a
 * topper gets, and a picker that disagreed with the bill of tiles about whether
 * a design is printable would be worse than one with no figures at all.
 *
 * **It used to call `resolvePlacement` through a synthetic `Placement`, and that
 * was answering a different question.** This docblock said `matchBase` was
 * private and closed with *"an exported `matchBase`, or a `baseLocksFor(tile,
 * index)` probe, would remove both the abuse and most of the work; that belongs
 * to whoever owns `src/assembly/resolve.ts` next."* Row A6 had already exported
 * it, and row V4 — which does own that file — is what forced the switch: a
 * `Placement` names a *design* now, so a per-variant probe cannot be expressed
 * as one at all.
 *
 * **The switch moves no figure, and that was worth measuring rather than
 * assuming — the expectation going in was that it would.** `resolvePlacement`
 * runs rule 0 first, so handing it a topper returns whichever variant the
 * preference prefers; where that is a self-sufficient sibling there is *no base
 * part*, so the old probe answered `false` where the archive holds a perfectly
 * good base. That is `resolvePlacement`'s own documented hazard — *"a true
 * answer to a different question"* — and it looked like a live understatement of
 * buildability.
 *
 * It is not, and the reason is the `!self` guard below. Measured over all 3,822
 * aggregates × 3 systems: the two probes disagree **0 times**, and rule 0
 * substitutes away from a topper for **931 aggregates under openlock, 6 under
 * dragonlock and 0 under magnetic** — every one of them to a self-sufficient
 * variant that *carries the requested system*, which is exactly the condition
 * `selfSufficientConn.includes(system)` catches one line earlier. So the
 * hazard is real and unreachable through this call site, and it was
 * unreachable before this row as well.
 *
 * `matchBase` is still the right call: it asks the question this function's name
 * states, in one lookup instead of a whole resolution, and it is the only way to
 * ask a **per-variant** question at all now that a `Placement` names a design.
 * `build.test.ts` re-derives every figure in the table above, so "no figure
 * moved" is a measurement and not a claim.
 *
 * ## What it costs to run
 *
 * Measured on the emitted index (8,702 records, 3,822 aggregates): the aggregate
 * index 62 ms, the assembly index 12 ms, the probe 110 ms — about 185 ms of
 * one-off synchronous work, against `deriveLockReach`'s single pass. That is why
 * it is memoised once per session by `useLockBuild.ts` and why the probe stops at
 * the first topper that resolves rather than scoring all of them.
 */
import type { AssemblyIndex } from '@/assembly'
import { buildAssemblyIndex, matchBase } from '@/assembly'
import type { AggregateIndex, CatalogFile, TileAggregate } from '@/catalog'
import { buildAggregateIndex } from '@/catalog'
import type { LockSystem } from '@/store'

import type { LockReach, LockReachEntry } from './reach'
import { ALL_LOCK_SYSTEMS, deriveLockReach } from './reach'

/** What one lock system can build, in designs. */
export interface LockBuildEntry {
  readonly system: LockSystem
  /**
   * Designs the app can resolve into a complete printable assembly in this
   * system — tier 2 of `docs/tile-aggregation.md` §3.1.
   */
  readonly buildable: number
  /** `buildable / totalDesigns`, in `[0, 1]`. */
  readonly share: number
  /** `totalDesigns - buildable`. The designs this choice costs you. */
  readonly unbuildable: number
  /**
   * Of the buildable ones, those that need **no** separate base: one variant
   * carries this lock on its own underside, so you print one part.
   *
   * The sharpest difference between the three systems, and it runs the *other*
   * way from buildability: openlock 1,497 against magnetic's 255. Magnetic is
   * nearly as buildable and almost never a single print.
   */
  readonly onePart: number
  /** `buildable - onePart` — a topper plus a base the archive can supply. */
  readonly withBase: number
  /**
   * Designs with a variant that mounts this system on its **side** — joinery to
   * the neighbouring tile rather than to the table.
   *
   * **Zero for magnetic**, over every aggregate in the corpus, which is why this
   * is a number on the row and not a chip in a symmetrical trio: one of the three
   * chips would be permanently dead. In this archive magnets join a tile to its
   * base and never a tile to its neighbour.
   */
  readonly sideJoinery: number
  /** The same system's archive reading, so a consumer holds both without a second lookup. */
  readonly reach: LockReachEntry
}

/**
 * Why a design cannot be built in **any** system — a partition, and asserted to
 * be one.
 *
 * It bounds the whole comparison: no lock preference reaches these, so the
 * picker's three shortfalls are not three different failures but one shared floor
 * plus a small per-system difference. Ordered by what a reader can act on:
 * nothing, nothing, and "file it against the archive".
 */
export interface UnbuildableDesigns {
  /** Designs no system can complete. */
  readonly total: number
  /** Every variant is an insert — fitted into another piece, never on the grid. */
  readonly inserts: number
  /** No joinery tag anywhere. Unknown, not incompatible — `TileAggregate.joineryUntagged`. */
  readonly untagged: number
  /** A topper the archive has no base for. The part that is a corpus gap somebody could close. */
  readonly noBase: number
}

/** The whole comparison — both questions, one object, one null state. */
export interface LockBuild {
  /** The archive-level reading, unchanged. `reach.ts` owns its definition. */
  readonly reach: LockReach
  /** Distinct designs. The denominator of every share here and in {@link reach}. */
  readonly totalDesigns: number
  /** One entry per system, **most buildable first**. */
  readonly entries: readonly LockBuildEntry[]
  /** Best buildable share minus worst, in percentage points. */
  readonly spreadPoints: number
  /** Designs buildable under every one of the three. */
  readonly buildableUnderAll: number
  readonly unbuildable: UnbuildableDesigns
}

/**
 * Does a base carrying `system` exist for any topper of this aggregate?
 *
 * Stops at the first one that resolves. `lockAgrees` is the resolver's own
 * verdict and is what separates tier 2 from tier 3: a topper handed a base in
 * *another* system is a defect the bill flags, not a design you can build.
 *
 * The `undefined` skip is unreachable on the two indexes `deriveLockBuild`
 * builds from one file — both are derived from the same record array — and is
 * the honest answer for the mismatched pair its optional arguments allow: a
 * variant this assembly index has never seen supplies no base.
 */
function baseSupplies(aggregate: TileAggregate, assembly: AssemblyIndex, system: LockSystem): boolean {
  for (const variant of aggregate.variants) {
    if (!variant.needsBase) continue
    const record = assembly.byId.get(variant.id)
    if (record === undefined) continue
    if (matchBase(record, assembly, system)?.match.lockAgrees === true) return true
  }
  return false
}

/** Why this aggregate is beyond every system. Exactly one answer per design. */
function unbuildableReason(aggregate: TileAggregate): keyof Omit<UnbuildableDesigns, 'total'> {
  if (aggregate.variantClass === 'insert-only') return 'inserts'
  if (aggregate.joineryUntagged) return 'untagged'
  return 'noBase'
}

/**
 * Measure what each lock system can build over a catalog.
 *
 * The two indexes are parameters with defaults rather than built unconditionally,
 * so a caller that already holds them — the builder builds an assembly index for
 * its bill — pays for the probe and not for the indexes again.
 *
 * An **empty catalog** returns zero designs and zero shares rather than dividing
 * by zero, which is what a component test renders before its stubbed fetch
 * resolves.
 */
export function deriveLockBuild(
  file: CatalogFile,
  aggregates: AggregateIndex = buildAggregateIndex(file),
  assembly: AssemblyIndex = buildAssemblyIndex(file),
): LockBuild {
  const reach = deriveLockReach(file.records)
  const totalDesigns = aggregates.aggregates.length

  const buildable = new Map<LockSystem, number>()
  const onePart = new Map<LockSystem, number>()
  const sideJoinery = new Map<LockSystem, number>()
  for (const system of ALL_LOCK_SYSTEMS) {
    buildable.set(system, 0)
    onePart.set(system, 0)
    sideJoinery.set(system, 0)
  }

  let buildableUnderAll = 0
  const beyond = { total: 0, inserts: 0, untagged: 0, noBase: 0 }

  for (const aggregate of aggregates.aggregates) {
    let systemsThatBuild = 0
    for (const system of ALL_LOCK_SYSTEMS) {
      if (aggregate.sideConn.includes(system)) sideJoinery.set(system, (sideJoinery.get(system) ?? 0) + 1)

      // Tier 1: a variant that needs no base and carries this lock underneath.
      // `selfSufficientConn` is unfiltered by design — `@/catalog` does not know
      // what a lock system is — so the intersection happens here.
      const self = aggregate.selfSufficientConn.includes(system)
      if (self) onePart.set(system, (onePart.get(system) ?? 0) + 1)
      if (!self && !baseSupplies(aggregate, assembly, system)) continue

      buildable.set(system, (buildable.get(system) ?? 0) + 1)
      systemsThatBuild += 1
    }

    if (systemsThatBuild === ALL_LOCK_SYSTEMS.length) buildableUnderAll += 1
    if (systemsThatBuild === 0) {
      beyond.total += 1
      beyond[unbuildableReason(aggregate)] += 1
    }
  }

  const entries: LockBuildEntry[] = ALL_LOCK_SYSTEMS.map((system) => {
    const count = buildable.get(system) ?? 0
    const one = onePart.get(system) ?? 0
    // Total over the union, so an entry exists for every system even on an empty
    // catalog; `reach.ts` guarantees that and this leans on it rather than
    // fabricating a fallback.
    const reachEntry = reach.entries.find((entry) => entry.system === system)
    return {
      system,
      buildable: count,
      share: totalDesigns === 0 ? 0 : count / totalDesigns,
      unbuildable: totalDesigns - count,
      onePart: one,
      withBase: count - one,
      sideJoinery: sideJoinery.get(system) ?? 0,
      reach: reachEntry ?? { system, designs: 0, hidden: 0, share: 0, bases: 0 },
    }
  }).sort((a, b) => b.buildable - a.buildable || a.system.localeCompare(b.system))

  const shares = entries.map((entry) => entry.share)
  const spread = shares.length === 0 ? 0 : Math.max(...shares) - Math.min(...shares)

  return {
    reach,
    totalDesigns,
    entries: Object.freeze(entries),
    spreadPoints: spread * 100,
    buildableUnderAll,
    unbuildable: Object.freeze(beyond),
  }
}

/** Look one system up in a derived comparison. */
export function buildOf(build: LockBuild, system: LockSystem): LockBuildEntry | undefined {
  return build.entries.find((entry) => entry.system === system)
}
