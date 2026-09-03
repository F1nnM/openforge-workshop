/**
 * How much of the catalog each lock system can actually reach.
 *
 * This module exists because the first draft of the plan put the cost of the
 * lock choice at **0.1 percentage points** and was wrong by two orders of
 * magnitude. The spread in *reachability* is 40.2 points. A picker that presented
 * three options without those numbers would be presenting a 40-point decision as
 * a matter of taste.
 *
 * ## This is one of the two questions, and no longer the headline
 *
 * Reachability is a property of the archive's tags. What a user experiences is
 * **buildability** — whether the app can resolve a complete printable assembly,
 * which a topper plus an auto-inserted base satisfies in systems the tile itself
 * never mentions. `build.ts` measures that, calls this module for the archive
 * reading and hangs it on `LockBuild.reach`; the picker draws buildability and
 * prints reachability beside it. Nothing here changed for that, and nothing here
 * should: the definitions below are the ones `docs/verify-catalog-facts.py`
 * implements, and their whole value is being the same definitions.
 *
 * ## Nothing here is a constant
 *
 * Every figure is derived from the index passed in. The plan quotes
 * openlock 99.9% / dragonlock 74.7% / magnetic 59.7% over 3,822 designs, and the
 * emitted index reproduces all three exactly — but they are *measurements of the
 * corpus*, not properties of the code, and they will move the next time the
 * fixtures are rescanned. A hard-coded 74.7% that has quietly become 71% is
 * worse than no number at all, because a reader has no way to tell. So the
 * component takes a {@link LockReach} and the screen derives one; the only place
 * the plan's figures appear is in prose, as a record of what they were when this
 * was written.
 *
 * `docs/verify-catalog-facts.py` is the reference implementation, and CI runs
 * it. The definitions below are the same ones, restated because they are the
 * whole content of the numbers:
 *
 *   - A **design** is a tile collapsed across its connection variants —
 *     `CatalogRecord.design`, assigned by the importer. 2.28 files per design.
 *   - A design is **reachable** under a lock system if any of its files offers
 *     that system, **or if none of its files offers any lock system at all**.
 *     The second half is what stops the numbers being nonsense: half the corpus
 *     delegates joinery to a separately printed base, and those tiles are
 *     printable whatever the user has chosen.
 *
 * ## Reading a connection tag
 *
 * `conn` arrives normalised by the importer, so an entry is a bare system name.
 * It is still parsed segment-wise here, and that is not belt and braces: the raw
 * tag `connection|side|openlock` puts a *position* in the second segment, and
 * taking segment one blindly invents a phantom `side` system while hiding
 * openlock from the 2,079 tiles that mount it on the side. That bug was in the
 * first version of the verify script and moved these figures by up to 8 points.
 * Matching on *any* segment is immune to it, so this module keeps working on a
 * hand-written `side|openlock` entry and on whatever the importer's vocabulary
 * grows into.
 *
 * `bottom`, `left` and `right` used to leak through as phantom systems on 8
 * records; `pipeline/facets.ts` folds all four positions now, so the vocabulary
 * reaching here is 7 systems and none of them is a face. **Reachability is a
 * whole-tile question and stays position-blind on purpose** — a design is
 * reachable if it offers the lock *anywhere*. The question that does need the
 * face is base matching ("is this lock on the underside, where the base meets
 * it?"), and that one reads `connectionsByPosition` rather than `conn`.
 */
import type { LockSystem } from '@/store'

/**
 * The lock systems, as a total map over the union.
 *
 * `Record<LockSystem, true>` rather than an array, for the reason
 * `src/assembly/resolve.ts` gives for the same table: the compiler rejects the
 * object if a member of the union is missing, so a fourth lock system cannot
 * leave this list silently stale.
 */
const LOCK_SYSTEMS: Readonly<Record<LockSystem, true>> = Object.freeze({
  openlock: true,
  dragonlock: true,
  magnetic: true,
})

/** Every lock system, in no meaningful order — ordering is {@link deriveLockReach}'s job. */
export const ALL_LOCK_SYSTEMS: readonly LockSystem[] = Object.freeze(Object.keys(LOCK_SYSTEMS) as LockSystem[])

function asLockSystem(value: string): LockSystem | undefined {
  return Object.hasOwn(LOCK_SYSTEMS, value) ? (value as LockSystem) : undefined
}

/**
 * The three fields of a catalog record this module reads.
 *
 * Structural rather than `CatalogRecord`, so a test can derive the figures from
 * a handful of literals instead of from schema-complete records. A real
 * `CatalogRecord` satisfies it — `design` is a branded string, `layer` an enum.
 */
export interface LockReachRecord {
  readonly design: string
  readonly conn: readonly string[]
  readonly layer: string
}

/** What one lock system costs, in designs. */
export interface LockReachEntry {
  readonly system: LockSystem
  /** Designs reachable under this system. */
  readonly designs: number
  /** Designs it puts out of reach — `totalDesigns - designs`. The cost. */
  readonly hidden: number
  /** `designs / totalDesigns`, in `[0, 1]`. */
  readonly share: number
  /** Bases in the catalog that offer this system. Every base offers one. */
  readonly bases: number
}

/** The whole comparison, derived from one index. */
export interface LockReach {
  /** Distinct designs in this catalog. Currently 3,822. */
  readonly totalDesigns: number
  /** Records with `layer === 'base'`. Currently 1,963. */
  readonly totalBases: number
  /**
   * Bases offering **no** lock system. Currently **zero**, and that zero is why
   * the preference always discriminates: every base commits to a system, so
   * there is no neutral base to fall back on. It is derived rather than asserted
   * because a future import could add one.
   */
  readonly basesWithoutLock: number
  /** One entry per system, **best reach first**. */
  readonly entries: readonly LockReachEntry[]
  /** Best share minus worst, in percentage points. Currently 40.2. */
  readonly spreadPoints: number
}

/** Every lock system named by any segment of any of a record's `conn` entries. */
function locksOf(conn: readonly string[]): Set<LockSystem> {
  const found = new Set<LockSystem>()
  for (const entry of conn) {
    for (const segment of entry.split('|')) {
      const system = asLockSystem(segment)
      if (system !== undefined) found.add(system)
    }
  }
  return found
}

/**
 * Measure the cost of each lock system over a catalog.
 *
 * One pass over the records, so it is cheap enough to run on the real index
 * (8,702 records) without ceremony — but it is a pure function of a build
 * artefact, so `useLockBuild` memoises the pair anyway.
 *
 * An **empty catalog** returns zero designs and zero shares rather than dividing
 * by zero. That is not a hypothetical: it is what a component test renders
 * before its stubbed fetch resolves.
 */
export function deriveLockReach(records: readonly LockReachRecord[]): LockReach {
  const designLocks = new Map<string, Set<LockSystem>>()
  const baseCounts = new Map<LockSystem, number>()
  let totalBases = 0
  let basesWithoutLock = 0

  for (const record of records) {
    const locks = locksOf(record.conn)

    let forDesign = designLocks.get(record.design)
    if (forDesign === undefined) {
      forDesign = new Set<LockSystem>()
      designLocks.set(record.design, forDesign)
    }
    for (const system of locks) forDesign.add(system)

    if (record.layer !== 'base') continue
    totalBases += 1
    if (locks.size === 0) basesWithoutLock += 1
    for (const system of locks) baseCounts.set(system, (baseCounts.get(system) ?? 0) + 1)
  }

  const totalDesigns = designLocks.size
  const entries = ALL_LOCK_SYSTEMS.map((system) => {
    let designs = 0
    for (const locks of designLocks.values()) {
      // "Offers this lock, or carries none at all" — the second clause is the
      // 4.0% of tiles with no connection tag plus the 50.1% that delegate to a
      // base, and dropping it would understate every system by roughly half.
      if (locks.size === 0 || locks.has(system)) designs += 1
    }
    return {
      system,
      designs,
      hidden: totalDesigns - designs,
      share: totalDesigns === 0 ? 0 : designs / totalDesigns,
      bases: baseCounts.get(system) ?? 0,
    }
  }).sort((a, b) => b.designs - a.designs || a.system.localeCompare(b.system))

  const shares = entries.map((entry) => entry.share)
  const spread = shares.length === 0 ? 0 : Math.max(...shares) - Math.min(...shares)

  return {
    totalDesigns,
    totalBases,
    basesWithoutLock,
    entries: Object.freeze(entries),
    spreadPoints: spread * 100,
  }
}

/** Look one system up in a derived comparison. */
export function reachOf(reach: LockReach, system: LockSystem): LockReachEntry | undefined {
  return reach.entries.find((entry) => entry.system === system)
}

/* ---------------------------------------------------------------- formatting */

/**
 * English-only app, so an explicit locale rather than the visitor's.
 *
 * Duplicated from `@/screens/catalog`'s `countLabel` on purpose. Importing it
 * would make `src/ui/` depend on `src/screens/`, which inverts the layering —
 * every screen imports the primitives, and a primitive that imported a screen
 * would pull `react-virtuoso` and the catalog's stylesheet into the builder
 * toolbar. Three lines of `Intl` is the cheaper of the two prices.
 */
const NUMBER = new Intl.NumberFormat('en-US')

/** `3817` → `3,817`. */
export function countLabel(value: number): string {
  return NUMBER.format(value)
}

/**
 * `0.998691` → `99.9%`.
 *
 * One decimal, **rounded**, because `verify-catalog-facts.py` rounds and the
 * plan's table quotes what it prints. Two implementations of one figure that
 * disagree in the last digit are worse than either — a reader comparing the
 * screen against the document has no way to tell a formatting difference from a
 * stale number.
 *
 * With one exception, which is why this is not a one-liner: **a share below 1 is
 * never printed as `100.0%`**. Rounding would say that at 99.95% and up, and on
 * a screen whose entire purpose is to be honest about cost, "100%" while designs
 * are out of reach is the one lie that would matter. It does not arise today
 * (openlock sits at 99.87%) and it is guarded anyway, because the corpus moves
 * and nothing else would catch it.
 */
export function shareLabel(share: number): string {
  const rounded = (share * 100).toFixed(1)
  if (share < 1 && rounded === '100.0') return '99.9%'
  return `${rounded}%`
}

/** `40.1622` → `40.2 pp`. Rounded, matching `shareLabel` and the plan's table. */
export function pointsLabel(points: number): string {
  return `${points.toFixed(1)} pp`
}

/** Display name for a lock system. The catalog tags are lower-case; these are not. */
const LOCK_LABELS: Readonly<Record<LockSystem, string>> = Object.freeze({
  openlock: 'OpenLOCK',
  dragonlock: 'DragonLock',
  magnetic: 'Magnetic',
})

/** `'openlock'` → `'OpenLOCK'`. */
export function lockLabel(system: LockSystem): string {
  return LOCK_LABELS[system]
}

/**
 * One line on what a system is, for a reader who has not printed OpenForge
 * before and cannot otherwise tell three proper nouns apart.
 *
 * Deliberately about the *physical* thing, because that is the only fact that
 * decides the answer: the user already owns terrain, or they do not.
 */
const LOCK_NOTES: Readonly<Record<LockSystem, string>> = Object.freeze({
  openlock: 'The OpenForge/OpenLOCK clip. Printed dogbone clips join tile to tile.',
  dragonlock: 'Fat Dragon Games’ DragonLock. Interlocking edges, no separate clips.',
  magnetic: 'Recessed magnets in the tile edges. No clips, but you buy magnets.',
})

/** @see LOCK_NOTES */
export function lockNote(system: LockSystem): string {
  return LOCK_NOTES[system]
}
