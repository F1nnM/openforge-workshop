/**
 * What the ported reading of `constrain` actually does to this corpus — and what
 * the readings it displaces were measured to cost.
 *
 * §5 of the architecture plan put the question as a payload question: *"under one
 * reading the median slot has thousands of candidates, under another twelve, and
 * precomputed candidate sets range from 29 KB to 9.4 MB accordingly."* Both
 * readings are implemented here and both are measured, so the choice is a
 * comparison rather than an assertion:
 *
 * | reading | sets | median | mean | max | empty |
 * | --- | ---: | ---: | ---: | ---: | ---: |
 * | **wide** — `constrain` contributes nothing until a sibling is picked | 3,695 | 1,868 | 1,277.0 | 1,963 | 9 |
 * | **ported** — `constrain` joins the parent's tags too, because `parent` defaults to `true` | 3,695 | 14 | 32.2 | 485 | 526 |
 *
 * The plan's "thousands versus twelve" is those two columns, and the ported
 * reading is the second: nothing in the grammar makes parent inheritance
 * conditional on an interaction, so **a slot is already narrowed before the user
 * touches anything**. 2,843 of the 3,695 slots (76.9%) then have under 50
 * candidates, which is the regime C2's inline sprite grid was designed for.
 *
 * ## What the alternatives cost, measured
 *
 * Every figure below is `JSON.stringify` of the sets with ordinals delta-encoded,
 * brotli quality 11, over the live 8,702-record index:
 *
 * | what would be shipped | sets | raw | brotli |
 * | --- | ---: | ---: | ---: |
 * | wide reading, deduplicated to the 110 distinct slots | 110 | 13,037 B | 513 B |
 * | ported reading, per tile-slot, ordinals | 3,695 | 283,368 B | 3,606 B |
 * | ported reading, per tile-slot, ids as strings | 3,695 | 15,107,263 B | 37,542 B |
 * | every sibling-selection state, ordinals | 99,931 | 2,798,529 B | 5,767 B |
 * | **this row: derive in the browser** | — | **0 B** | **0 B** |
 *
 * Two of those numbers correct the plan rather than confirm it, and both matter:
 *
 *   - **Brotli eats these sets alive.** The plan feared 9.4 MB; the fat encoding
 *     is indeed **15,107,263 B raw**, but it is **37,542 B** compressed, and the
 *     index this row built measures 365,603 B against a 512,000 B budget (P3's
 *     `thumb` flag took it up 200 B), so there are 146,397 B free and the
 *     fattest encoding on the table would fit
 *     three times over. **Payload was never the binding constraint here.** Saying
 *     otherwise would have been a number chosen because it argued for the answer.
 *   - **Correctness is.** Every shipped row above except the first bakes in "no
 *     sibling selected". A slot's set is only that until the first pick, and 535
 *     tiles have two or more slots, so the artefact would carry 283 KB of raw
 *     JSON that the client must recompute anyway. The first row — the wide
 *     reading, 513 B — is cheap and stale in a different way: it is not the set
 *     the user is owed, since it ignores the parent the slot is attached to.
 *
 * So: **0 bytes emitted**, one 339,756 B inverted index built at run time
 * (`candidates.ts`), and the record shape untouched — `SCHEMA_VERSION` stays 3
 * and `PIPELINE_VERSION` stays 1, for the reason `pipeline/version.ts` records.
 *
 * ## The two corpus facts a consumer has to know
 *
 *   - **9 live slots can never be filled by anything,** before `constrain` is
 *     considered at all: their `require`/`deny` conjunction matches nothing.
 *     One of them requires and denies `shape|wall` in the same breath. These are
 *     fixture defects, they are enumerated by {@link CompositionReport.unsatisfiable}
 *     rather than counted, and no single ref among the 99 is dangling — the
 *     emptiness is combinatorial.
 *   - **526 of 3,695 slots (14.2%) are dead ends in their initial state,** and
 *     517 of those are `base` slots emptied by an inherited *texture*: a
 *     `texture|towne` wall inherits `texture|towne` into its base slot and the
 *     corpus has no towne base. This is the composition-side view of the same
 *     archive gap `docs/corpus-base-gap.md` measures from the assembly side —
 *     385 toppers with no base line item — reached by a completely different
 *     route, and the two do not have to agree because one keys on textures and
 *     the other on size codes.
 */
import type { CatalogFile, PartSlot, TileId } from '@/catalog'

import { createCompositionIndex } from './candidates'

/** One slot whose own `require`/`deny` matches nothing, named rather than counted. */
export interface UnsatisfiableSlot {
  readonly tile: TileId
  readonly slot: string
  readonly require: readonly string[]
  readonly deny: readonly string[]
}

/** The distribution of a reading's candidate-set sizes. */
export interface CandidateSpread {
  readonly sets: number
  readonly median: number
  readonly mean: number
  readonly max: number
  /** Sets with no candidate at all. */
  readonly empty: number
  /** Sets small enough for C2's inline grid. */
  readonly underFifty: number
}

export interface CompositionReport {
  /** Live slots. 3,695. */
  readonly slots: number
  /** Tiles declaring one. 3,036. */
  readonly tilesWithSlots: number
  /** Slots that are identical declarations, keyed by meaning. 110. */
  readonly distinctSlots: number
  /** Every distinct ref across `require`, `deny` and `constrain`. 99. */
  readonly refs: number
  /**
   * `constrain` refs that are **namespace roots and not tags** — `shape`,
   * `size|depth`, `size|width`, `texture`.
   *
   * The decisive evidence for the ported reading, and it is worth stating as an
   * assertion rather than an observation: **all 91 `require` refs exist as exact
   * tags and none of the 4 `constrain` tag refs does.** A grammar where both were
   * prefix matches, or both exact, could not produce that split. `require` is
   * exact and `constrain` is a prefix, which is what the catalog's backend SQL
   * does and what this port does.
   */
  readonly constrainRoots: readonly string[]
  /** `constrain` refs carrying `siblings` or `parent`. **0** corpus-wide. */
  readonly withSourceControl: number
  /** The reading that defers `constrain` entirely. */
  readonly wide: CandidateSpread
  /** The ported reading: parent inheritance applied, no sibling selected yet. */
  readonly ported: CandidateSpread
  /** Slots no tile can fill, ignoring `constrain`. 9. */
  readonly unsatisfiable: readonly UnsatisfiableSlot[]
  /** Inherited tags that empty a slot on their own, by tag. */
  readonly deadEndBlame: Readonly<Record<string, number>>
  /** The run-time cost of the inverted index, exact. 339,756 B — 336,092 + 3,664. */
  readonly postingsBytes: number
}

/**
 * Canonical text for a slot declaration, so identical declarations collapse.
 *
 * The same construction `src/catalog/aggregate.ts#slotKey` uses, and for the same
 * reason: two tiles can write one slot's refs in a different order and a key that
 * called those different slots would inflate every count here. Sorted refs are
 * what make the key a function of the slot's meaning. The separator is written as
 * an escape, never as a literal byte.
 */
function slotKey(slot: PartSlot): string {
  const refs = (entries: readonly { tag?: string; filter?: string }[] | undefined): string =>
    entries === undefined
      ? ''
      : entries
          .map((entry) => `${entry.tag ?? ''}/${entry.filter ?? ''}`)
          .sort()
          .join(',')
  return [
    slot.name,
    slot.id ?? '',
    String(slot.optional ?? false),
    refs(slot.tags.require),
    refs(slot.tags.deny),
    refs(slot.tags.constrain),
  ].join('\u0000')
}

function spread(sizes: readonly number[]): CandidateSpread {
  const sorted = [...sizes].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const median =
    sorted.length === 0
      ? 0
      : sorted.length % 2 === 1
        ? (sorted[middle] ?? 0)
        : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
  const total = sorted.reduce((sum, size) => sum + size, 0)
  return {
    sets: sorted.length,
    median,
    mean: sorted.length === 0 ? 0 : Math.round((total / sorted.length) * 10) / 10,
    max: sorted[sorted.length - 1] ?? 0,
    empty: sorted.filter((size) => size === 0).length,
    underFifty: sorted.filter((size) => size < 50).length,
  }
}

/**
 * Measure both readings over a parsed catalog. Pure; one index build and two
 * passes over the 3,695 slots.
 */
export function measureComposition(file: CatalogFile): CompositionReport {
  const index = createCompositionIndex(file)

  const distinct = new Set<string>()
  const wideSizes: number[] = []
  const portedSizes: number[] = []
  const unsatisfiable: UnsatisfiableSlot[] = []
  const deadEndBlame: Record<string, number> = {}
  const roots = new Set<string>()
  let withSourceControl = 0

  for (const record of file.records) {
    for (const slot of record.config?.parts ?? []) {
      distinct.add(slotKey(slot))

      for (const ref of slot.tags.constrain ?? []) {
        if ('tag' in ref) {
          if (!index.postings.idOf.has(ref.tag)) roots.add(ref.tag)
          const entry = ref as { siblings?: unknown; parent?: unknown }
          if (entry.siblings !== undefined || entry.parent !== undefined) withSourceControl += 1
        }
      }

      /* The wide reading: require and deny only, `constrain` deferred. */
      const wide = index.candidatesFor({
        require: (slot.tags.require ?? []).map((ref) => ref.tag),
        deny: (slot.tags.deny ?? []).map((ref) => ref.tag),
        accept: [],
      })
      wideSizes.push(wide.tiles.length)
      if (wide.deadEnd) {
        unsatisfiable.push({
          tile: record.id,
          slot: slot.name,
          require: wide.resolved.require,
          deny: wide.resolved.deny,
        })
      }

      /* The ported reading, in its initial state: parent inheritance, no siblings. */
      const ported = index.resolve(slot, record.id)
      portedSizes.push(ported.tiles.length)
      if (ported.deadEnd && !wide.deadEnd) {
        const own = new Set(wide.resolved.require)
        for (const tag of ported.resolved.require) {
          if (own.has(tag)) continue
          const alone = index.candidatesFor({ require: [...own, tag], deny: ported.resolved.deny, accept: [] })
          if (alone.deadEnd) deadEndBlame[tag] = (deadEndBlame[tag] ?? 0) + 1
        }
      }
    }
  }

  return {
    slots: index.slots,
    tilesWithSlots: index.tilesWithSlots,
    distinctSlots: distinct.size,
    refs: index.refs.length,
    constrainRoots: [...roots].sort(),
    withSourceControl,
    wide: spread(wideSizes),
    ported: spread(portedSizes),
    unsatisfiable,
    deadEndBlame,
    postingsBytes: index.postings.bytes,
  }
}

/* -------------------------------------------------------------- the assertion */

/**
 * Live slots nothing can fill. Measured 9, all fixture defects, all enumerated.
 *
 * A ceiling rather than an equality, with roughly a third of slack, for the
 * reason `pipeline/aggregate.ts` gives for its recall floor: these are properties
 * of an externally maintained fixture set, and a build that failed because
 * somebody added one more malformed slot would teach people to stop looking at
 * the report. A *jump* is what matters.
 */
export const MAX_UNSATISFIABLE_SLOTS = 12

/**
 * The dead-end ceiling, as a fraction of live slots. Measured 0.142.
 *
 * This one is a genuine product ceiling and not just drift detection. Past
 * roughly a fifth, "pick an accessory" stops being a picker and becomes a maze,
 * and C2's dead-end greying would be greying more than it offers.
 */
export const MAX_DEAD_END_RATE = 0.2

/**
 * The floor on how much narrower the ported reading is than the wide one.
 *
 * The counterpart of `pipeline/aggregate.ts`'s "a drop to 0 would mean the union
 * machinery had quietly stopped doing anything". If parent inheritance ever
 * stops firing — a `startsWith` turned into an equality, a default flipped — the
 * two readings converge, every count in this file's docblock becomes wrong at
 * once, and *nothing else fails*: the slots would still resolve, just to 1,868
 * candidates instead of 14. Measured ratio 133.4.
 */
export const MIN_NARROWING_RATIO = 10

/**
 * @throws when the corpus has moved past what the ported reading was measured
 *   against, or when the port has stopped narrowing.
 *
 * The message carries the measurement, because the figure that moved is the
 * whole content of the failure.
 */
export function assertComposition(report: CompositionReport): void {
  if (report.unsatisfiable.length > MAX_UNSATISFIABLE_SLOTS) {
    const first = report.unsatisfiable
      .slice(0, 3)
      .map((slot) => `${slot.tile} slot "${slot.slot}" require [${slot.require.join(' ')}] deny [${slot.deny.join(' ')}]`)
    throw new Error(
      `${String(report.unsatisfiable.length)} live slots can be filled by no tile at all, over a ceiling of ` +
        `${String(MAX_UNSATISFIABLE_SLOTS)} (measured 9, every one a fixture defect). ` +
        `A slot's \`require\` conjunction matches nothing, so the user is offered a step they cannot take. ` +
        `First: ${first.join('; ')}`,
    )
  }

  const rate = report.slots === 0 ? 0 : report.ported.empty / report.slots
  if (rate > MAX_DEAD_END_RATE) {
    throw new Error(
      `${(rate * 100).toFixed(1)}% of slots (${String(report.ported.empty)} of ${String(report.slots)}) have no ` +
        `candidate in their initial state, over the ${String(MAX_DEAD_END_RATE * 100)}% ceiling (measured 14.2%). ` +
        `Past this, a slot picker is greying out more than it offers.`,
    )
  }

  const ratio = report.ported.median === 0 ? Number.POSITIVE_INFINITY : report.wide.median / report.ported.median
  if (ratio < MIN_NARROWING_RATIO) {
    throw new Error(
      `the ported \`constrain\` reading narrows the median slot only ${ratio.toFixed(1)}× (${String(report.wide.median)} ` +
        `candidates to ${String(report.ported.median)}), under the ${String(MIN_NARROWING_RATIO)}× floor and against a ` +
        `measured 133.4×. Parent inheritance has stopped firing: \`constrain\` entries name tag *prefixes* and ` +
        `\`parent\` defaults to true, so a slot must be narrowed by its own tile's tags before any interaction.`,
    )
  }

  if (report.constrainRoots.length === 0) {
    throw new Error(
      'no `constrain` ref is a namespace root any more. All 4 of them were — `shape`, `size|depth`, `size|width`, ' +
        '`texture` — while all 91 `require` refs are exact tags, and that split is the corpus evidence that ' +
        '`constrain` is a prefix join and `require` is exact equality. If the roots are gone, either the fixtures ' +
        'changed shape or `pipeline/normalise.ts` has started rewriting config refs.',
    )
  }
}
