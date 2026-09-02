/**
 * Build-time verification of the aggregate layer.
 *
 * `src/catalog/aggregate.ts` derives one catalog item per design and ships
 * nothing — the whole grouping is recomputed in the browser, because the leanest
 * emittable form of it measures 40,454 B brotli against an index already at
 * 71.4% of its 500 KB budget. This module is the other half of that trade: if the
 * grouping is not in the artefact, then the *properties* six downstream rows read
 * it for have to be checked where the artefact is made.
 *
 * Three jobs, in order of how loudly they fail:
 *
 *   1. **The hoisting invariant.** Rows A2 and A3 read `name`, `kinds`,
 *      `texture`, `build`, `foot`, `sizeCode` and `rotStep` off the aggregate as
 *      if they were properties of the item, and they are — measured, **0 of 3,822
 *      aggregates hold two distinct values of any of the seven**. That is a
 *      property of the corpus, not of the key, so it is exactly the kind of thing
 *      that breaks quietly on a fixture change. {@link assertAggregation} turns it
 *      into a build failure naming the design and the field.
 *   2. **The address invariant.** Every aggregate address must be an ordinal
 *      **already issued to a member of its own group** — a reference, never a
 *      newly minted number. This is what makes "an aggregate never enters the
 *      manifest" checkable rather than merely intended.
 *   3. **Detection.** `layer === 'topper'` is scored against the filename's
 *      connection token, an independently authored description of the same file
 *      that no part of the rule reads. Measured **100.0% precision, 99.9%
 *      recall**. Reported every build and asserted with slack, because the ground
 *      truth is a filename convention rather than a contract.
 *
 * Plus one cross-check that is cheap and closes a real seam: `src/catalog`
 * cannot import this directory (`pipeline/` is build-time only and outside the
 * app's tsconfig), so it carries its own port of
 * `connectionsByPosition`. Every record's `bottomConn` and `sideConn` are
 * compared against the original here, on every build, the way
 * `tessellation.test.ts` cross-checks `arcBandSideOfRadius` — so the copy cannot
 * drift in silence.
 */
import type { AggregateStats, TileAggregate } from '../src/catalog/aggregate'
import { buildAggregateIndex } from '../src/catalog/aggregate'
import type { CatalogFile, CatalogRecord } from '../src/catalog/schema'

import { connectionsByPosition } from './facets'

/* ----------------------------------------------------------------- detection */

/**
 * How well `layer === 'topper'` predicts "this file needs a separately printed
 * base", against the filename.
 *
 * The two are independent descriptions of one file: the tags are authored in the
 * fixture rows and the filename is authored in Dropbox, and the detection rule
 * reads only the first. So this is a genuine score and not a restatement.
 */
export interface DetectionScore {
  /** Files whose filename token names `openforge`. 4,367. */
  readonly truthPositives: number
  /** Files the rule flags — `layer === 'topper'`. 4,363. */
  readonly flagged: number
  readonly truePositives: number
  /** Flagged and the filename disagrees. **0**, and the assertion holds it there. */
  readonly falsePositives: number
  /** The filename says openforge and the rule does not flag it. 4. */
  readonly falseNegatives: number
  readonly precision: number
  readonly recall: number
  /**
   * The false negatives, by catalog id — all of them, not a sample.
   *
   * Four files, and each is the same corpus defect: a name that says `openforge`
   * on a row carrying **no `connection|` tag at all**. Two `catacombs` loculus
   * walls and two `dungeon_stone` secret-door walls. Listed rather than counted
   * because "four unexplained misses" and "four files we have read" are different
   * claims, and only the second one licenses shipping the rule.
   */
  readonly missed: readonly string[]
  /** Flagged files the filename disagrees with, by catalog id. Empty. */
  readonly overreached: readonly string[]
}

/**
 * The connection token a filename ends on — `openforge`, `openlock,side`,
 * `dragonlock,magnetic+flex`.
 *
 * The last dot-segment of the basename with `.stl` removed. Split on `,` and `+`
 * because a token names several systems at once, and matched by *element* rather
 * than by substring: a substring test would count `openforge+split` and
 * `not_openforge` alike, and the whole value of this ground truth is that it is
 * derived differently from the rule it scores.
 */
function filenameNamesOpenforge(file: string): boolean {
  const stem = file.replace(/\.stl$/i, '')
  const segments = stem.split('.')
  const token = segments[segments.length - 1]
  if (token === undefined) return false
  return token.split(/[,+]/).includes('openforge')
}

function scoreDetection(records: readonly CatalogRecord[]): DetectionScore {
  let truthPositives = 0
  let truePositives = 0
  const missed: string[] = []
  const overreached: string[] = []

  for (const record of records) {
    const truth = filenameNamesOpenforge(record.file)
    const flagged = record.layer === 'topper'
    if (truth) truthPositives += 1
    if (truth && flagged) truePositives += 1
    else if (truth) missed.push(record.id)
    else if (flagged) overreached.push(record.id)
  }

  const flagged = truePositives + overreached.length
  return {
    truthPositives,
    flagged,
    truePositives,
    falsePositives: overreached.length,
    falseNegatives: missed.length,
    precision: flagged === 0 ? 1 : truePositives / flagged,
    recall: truthPositives === 0 ? 1 : truePositives / truthPositives,
    missed: missed.sort(),
    overreached: overreached.sort(),
  }
}

/* ---------------------------------------------------------------- the report */

/** One violated invariant, named precisely enough to act on. */
export interface AggregateViolation {
  readonly kind: 'hoisted-field-varies' | 'address-not-a-member-ordinal' | 'duplicate-address' | 'position-drift'
  readonly design: string
  readonly detail: string
}

export interface AggregationReport {
  readonly stats: AggregateStats
  readonly detection: DetectionScore
  /** Print options by name, over every record. `pegs` and `filament` are absent by design. */
  readonly options: Readonly<Record<string, number>>
  /**
   * Aggregates whose files are identical on every connection axis yet are
   * distinct meshes — the honest limit of the key.
   *
   * The card genuinely stands for several objects here: `Aztlan Idol Treasure`
   * covers three different idols, `Tudor Arched Door` eight different meshes.
   * These are **pre-existing corpus problems aggregation makes visible rather
   * than creates** — today they render as several indistinguishable cards — and
   * row A5's variants table is what covers them. Reported, never asserted away.
   */
  readonly ambiguous: number
  readonly violations: readonly AggregateViolation[]
}

/**
 * Aggregate every record, measure it, and check the invariants.
 *
 * Pure. Called by `buildCatalog` after the parse, so what it measures is what
 * was validated and what will be written — not a draft that merely passed a
 * check on the way past.
 */
export function measureAggregation(file: CatalogFile): AggregationReport {
  const index = buildAggregateIndex(file)
  const violations: AggregateViolation[] = []

  const hoisted = ['name', 'kinds', 'texture', 'build', 'foot', 'sizeCode', 'rotStep'] as const
  for (const field of hoisted) {
    const count = index.stats.varies[field] ?? 0
    if (count > 0) {
      violations.push({
        kind: 'hoisted-field-varies',
        design: '(corpus)',
        detail: `${String(count)} aggregates hold two distinct values of \`${field}\`, which A2 and A3 hoist onto the card`,
      })
    }
  }

  const seen = new Set<number>()
  for (const aggregate of index.aggregates) {
    const address = aggregate.address as unknown as number
    if (seen.has(address)) {
      violations.push({ kind: 'duplicate-address', design: aggregate.design, detail: `address ${String(address)}` })
    }
    seen.add(address)
    const held = aggregate.variants.some((variant) => (variant.ord as unknown as number) === address)
    if (!held) {
      violations.push({
        kind: 'address-not-a-member-ordinal',
        design: aggregate.design,
        detail: `address ${String(address)} is not the ordinal of any of this aggregate's ${String(aggregate.variants.length)} files`,
      })
    }
  }

  /* The positional cross-check, and the option tally, in one pass. */
  const options: Record<string, number> = {}
  const byId = new Map<string, CatalogRecord>()
  for (const record of file.records) byId.set(record.id, record)

  for (const aggregate of index.aggregates) {
    for (const variant of aggregate.variants) {
      for (const option of variant.options) options[option] = (options[option] ?? 0) + 1
      const record = byId.get(variant.id)
      if (record === undefined) continue
      const tags = record.tags.map((tag) => file.tags[tag as unknown as number] ?? '')
      const reference = connectionsByPosition(tags)
      const drift: string[] = []
      if (reference.bottom.join(' ') !== variant.bottomConn.join(' ')) {
        drift.push(`bottom [${reference.bottom.join(' ')}] vs [${variant.bottomConn.join(' ')}]`)
      }
      if (reference.side.join(' ') !== variant.sideConn.join(' ')) {
        drift.push(`side [${reference.side.join(' ')}] vs [${variant.sideConn.join(' ')}]`)
      }
      // `aggregate.ts` keeps only two faces because `left` and `right` hold one
      // bare position tag each and no system corpus-wide. If a system ever lands
      // there this fires, rather than the system being silently dropped.
      if (reference.left.length > 0 || reference.right.length > 0) {
        drift.push(`left [${reference.left.join(' ')}] right [${reference.right.join(' ')}] have no home in the aggregate`)
      }
      if (drift.length > 0) {
        violations.push({ kind: 'position-drift', design: aggregate.design, detail: `${variant.id}: ${drift.join('; ')}` })
      }
    }
  }

  return {
    stats: index.stats,
    detection: scoreDetection(file.records),
    options,
    ambiguous: countAmbiguous(index.aggregates),
    violations,
  }
}

/**
 * Aggregates holding two or more files that agree on **every** connection axis —
 * needs-a-base, bottom systems, side systems and print options — and are still
 * different meshes.
 *
 * Nothing in the connection namespace distinguishes them, so no variant control
 * can either. Measured with the blob compared too, so the harmless case — the
 * same physical STL filed under two catalog paths, 171 md5s over 520 rows — is
 * excluded and only the genuinely several-objects case is counted.
 */
function countAmbiguous(aggregates: readonly TileAggregate[]): number {
  let count = 0
  for (const aggregate of aggregates) {
    const seen = new Map<string, Set<string>>()
    for (const variant of aggregate.variants) {
      const axis = [
        String(variant.needsBase),
        variant.bottomConn.join('+'),
        variant.sideConn.join('+'),
        variant.options.join('+'),
      ].join('|')
      const blobs = seen.get(axis)
      if (blobs === undefined) seen.set(axis, new Set([variant.blob]))
      else blobs.add(variant.blob)
    }
    if ([...seen.values()].some((blobs) => blobs.size > 1)) count += 1
  }
  return count
}

/* -------------------------------------------------------------- the assertion */

/**
 * Recall the detection rule must keep. Precision must be exact.
 *
 * Asymmetric on purpose. A **false positive** — telling a user "no base needed"
 * for a file that needs one — is a wrong bill of tiles, and it is measured at
 * zero, so nothing but zero is acceptable. **Recall** is measured at 99.9% and
 * the four misses are corpus defects rather than rule failures; a fixture edit
 * that renames a file could legitimately move that figure a little, and a build
 * that fails on someone tidying a filename would teach people to stop tidying
 * filenames. 99% is roughly 43 files of slack against today's 4.
 */
export const MIN_DETECTION_RECALL = 0.99

/**
 * @throws when an invariant the aggregate's six readers depend on is broken, or
 *   when detection has drifted past {@link MIN_DETECTION_RECALL}.
 *
 * The message carries the measurement, because the figure that moved is the
 * whole content of the failure — "aggregation broke" sends someone to read this
 * file, and "1 aggregate holds two distinct values of `name`" sends them to the
 * fixture.
 */
export function assertAggregation(report: AggregationReport): void {
  if (report.violations.length > 0) {
    const lines = report.violations.slice(0, 10).map((violation) => `  ${violation.kind} ${violation.design}: ${violation.detail}`)
    const more =
      report.violations.length > lines.length ? `\n  … and ${String(report.violations.length - lines.length)} more` : ''
    throw new Error(`the aggregate layer's invariants are broken:\n${lines.join('\n')}${more}`)
  }
  if (report.detection.falsePositives > 0) {
    throw new Error(
      `\`layer === 'topper'\` flagged ${String(report.detection.falsePositives)} files whose filename does not name ` +
        `openforge (measured: 0). A false positive tells a user no base is needed for a file that needs one. ` +
        `First: ${report.detection.overreached.slice(0, 3).join(', ')}`,
    )
  }
  if (report.detection.recall < MIN_DETECTION_RECALL) {
    throw new Error(
      `base detection recall is ${(report.detection.recall * 100).toFixed(2)}%, under the ` +
        `${String(MIN_DETECTION_RECALL * 100)}% floor: ${String(report.detection.falseNegatives)} files name openforge ` +
        `in the filename and carry no \`connection|openforge\` tag. First: ${report.detection.missed.slice(0, 3).join(', ')}`,
    )
  }
}
