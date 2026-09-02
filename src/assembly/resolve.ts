/**
 * Resolving one placement into the physical parts a person has to print.
 *
 * §2's headline fact drives this whole module: **the catalog is a parts list,
 * not an object list.** 4,363 tiles (50.1%) carry `connection|openforge`, which
 * means their joinery is not on them — it is on a separately printed base — and
 * 1,963 (22.6%) *are* those bases. So a placement resolves to an **assembly**,
 * and for half the corpus that assembly is two files, not one.
 *
 * The rule set, in full:
 *
 *   0. **Resolve the item to a file before anything else.** A placement names a
 *      file, but §7 places *designs*, and 1,705 designs hold more than one file.
 *      So the first thing resolution does is ask row A1's aggregate layer which
 *      variant of the placed item this build's lock preference actually wants —
 *      and for **1,419 of the 3,822 aggregates (37.1%)** the three lock systems
 *      do not agree on the answer. This is the step that makes rule 1 a
 *      *fallback*: under openlock, 1,808 of the 4,363 topper files (41.4%)
 *      resolve to a sibling that needs no base at all, so no base is inserted
 *      because none is needed. See {@link resolveVariant}.
 *   1. **The one hard rule.** Every `connection|openforge` piece gets a base
 *      line item, auto-inserted. It is enforced by *adding* a part.
 *   2. **Everything else informs.** No condition in this module rejects a
 *      placement. §7: "Compatibility informs; it never refuses a placement."
 *      Refusal would need trustworthy per-edge connector data, and the corpus
 *      has none — see `notes.ts`.
 *   3. **Join on the resolved primitive, never on a tag.** The base has to be
 *      the same shape as the thing standing on it, and only
 *      {@link footprintKey} says what shape that is. Two tags have been tried as
 *      keys and both are refuted in the corpus:
 *
 *        - **`build|`** — zero bases carry `build|wall on tile` while 863 tiles
 *          use that system, 857 of them toppers. A build join returns *no base*
 *          for every one of them, and the symptom is indistinguishable from
 *          missing data.
 *        - **`size|openlock`** — a width is not a footprint. Four codes span
 *          more than one primitive (`O` spans three), so a code join can put a
 *          0.5 × 0.5 pillar under a 4 × 4 triangle. See `sizeCode.ts`, which
 *          holds the measurements and the gate the one remaining code path runs
 *          through.
 *
 *      `assembly.test.ts` asserts both — the 857-against-0 split, and that every
 *      base handed to a topper with a primitive is congruent to it — so neither
 *      can come back as an optimisation.
 *
 * Resolution is a function of the placed tile and the lock preference only. `x`,
 * `z` and `rotation` do not change what you print, so they are carried through
 * untouched for the canvas and never read here — which is why the variant probe
 * {@link resolveVariant} takes a `TileId` and no placement at all.
 */
import type { CatalogRecord, TileId, VariantVerdict } from '@/catalog'
import { selectVariant } from '@/catalog'
import type { LockSystem, Placement } from '@/store'

import type { AssemblyIndex, PrintOption } from './assemblyIndex'
import { PRINT_OPTIONS } from './assemblyIndex'
import { footprintKey } from './footprint'
import type { Note } from './notes'
import { note } from './notes'
import { sharedPrimitive } from './sizeCode'

/* ------------------------------------------------------------------- options */

export interface AssemblyOptions {
  /**
   * The global lock preference (§2: you cannot physically mix systems in one
   * build), used to pick the base.
   *
   * **Optional, and absence means "no preference" rather than a default.** The
   * default lives in the store, and reading it here would give this module a
   * runtime dependency on the store — and, worse, would silently apply openlock
   * to a caller that had deliberately not chosen. With no preference, lock
   * agreement simply stops contributing to the ranking.
   *
   * Worth knowing before wiring this up: **every base in the corpus carries a
   * lock system** — 1,168 openlock, 1,141 magnetic, 570 dragonlock, none
   * without. So the preference always discriminates, and a base that disagrees
   * with it is a real defect in the build rather than a shrug.
   */
  lock?: LockSystem
}

/* --------------------------------------------------------------------- parts */

/** Why a part is in the list. */
export type PartRole =
  /** The tile the user put on the grid. */
  | 'placed'
  /** A base added by rule 1. The user never placed it and cannot remove it. */
  | 'base'

/**
 * How a base was matched, kept so the UI can show its work.
 *
 * Every field is a *fact about this match*, not a score. The score is an
 * implementation detail of {@link matchBase} and is deliberately not exposed:
 * a number with no unit invites a UI to render it.
 */
export interface BaseMatch {
  /**
   * Which key joined. `footprint` is the primary and the physical one;
   * `sizeCode` is the last resort for a topper with no primitive at all — 14
   * toppers, all coded `U`, and only where the code's bases agree on one
   * primitive. See {@link candidatesFor}.
   */
  key: 'sizeCode' | 'footprint'
  /** The key's value — the canonical footprint key, or the size code. */
  on: string
  /**
   * How many bases satisfied the key.
   *
   * 2–150 across the 43 congruence keys the toppers actually reach, against the
   * 3–132 the size code used to offer, and 7 for `U` — the one size code that
   * still finds a base at all. The pools are wider because congruence pools
   * *across* the code families: 383,252 candidate pairs over 3,986 matched
   * toppers where the code key gave 334,189 over 3,943.
   */
  candidates: number
  /**
   * Which of the three products the chosen base is. `plain` for 3,986 of 3,986
   * openforge toppers under openlock; the pre-D1 ranking, re-keyed, makes it
   * `topless` for 3,258 of them and says nothing.
   */
  option: PrintOption
  /**
   * The print options the candidate set offered at all, best first.
   *
   * Carried so the disclosure can distinguish the two reasons a non-`plain` base
   * was chosen — the corpus offers nothing better under this key, or something
   * better exists and does not carry the lock — which is the difference between a
   * gap in the archive and a compromise the user could undo by changing the lock
   * preference. The choice itself never consults it; {@link matchBase} does.
   */
  optionsOffered: PrintOption[]
  /**
   * The base publishes the same `size|openlock` code as the topper.
   *
   * The successor to `shapeAgrees`, which the join key made vacuous: under a
   * congruence key every candidate has the topper's shape, so the old field said
   * `true` for every footprint match and `false` for every code match and
   * carried no information the {@link key} did not. What is left to discriminate
   * inside a congruent set is *family*, and the code is it: a code-agreeing
   * congruent base exists for **1,870 of the 1,999 coded toppers**, and the
   * ranking hands one to every single one of them. The other 129 publish a code
   * no base in the archive carries at all.
   */
  codeAgrees: boolean
  /** The base shares a non-`base` kind bucket with the topper (`base+wall` under a wall). */
  kindAgrees: boolean
  /** Texture roots are equal. Reachable for 1,237 of 1,999 coded toppers (61.9%) — see {@link MATCH_WEIGHTS}. */
  textureAgrees: boolean
  /** The base offers the preferred lock system, or no preference was given. */
  lockAgrees: boolean
}

export interface AssemblyPart {
  role: PartRole
  record: CatalogRecord
  /** Present iff `role === 'base'`. */
  match?: BaseMatch
}

/* ------------------------------------------------------------------ verdicts */

/**
 * What resolving one placement in this build's lock system amounts to.
 *
 * `docs/tile-aggregation.md` §5.2's six verdicts, **complete for the first
 * time**. `selectVariant` in `src/catalog/aggregate.ts` answers the half that is
 * a property of the aggregate and stops there, on purpose: `with-base`,
 * `mismatched` and `no-base` all need {@link matchBase}, which needs the base
 * index, and `src/catalog` sits *below* this module in the graph. So A1 returns
 * `needs-base` and this module splits it three ways.
 *
 * Measured over all 3,822 aggregates, and the three columns are the whole
 * argument for aggregating:
 *
 * |                    | openlock | dragonlock | magnetic | no preference |
 * | ------------------ | -------: | ---------: | -------: | ------------: |
 * | `self-sufficient`  |    1,497 |        359 |      255 |         1,591 |
 * | `with-base`        |    1,878 |      2,759 |    2,753 |         1,878 |
 * | `mismatched`       |        0 |          2 |       12 |             0 |
 * | `no-base`          |      259 |        301 |      303 |           259 |
 * | `wrong-system`     |        1 |        214 |      312 |             0 |
 * | `unknown-joinery`  |       93 |         93 |       93 |             0 |
 * | `insert`           |       94 |         94 |       94 |            94 |
 *
 * `self-sufficient` + `with-base` is exactly row A7's **buildability** — 3,375 /
 * 3,118 / 3,008 designs, 88.3 / 81.6 / 78.7% — reproduced here by composition
 * rather than by a second implementation, and `assembly.test.ts` asserts the two
 * agree. That is why {@link matchBase} stays private: A7 asked for it or for a
 * `baseLocksFor` probe, and {@link resolveVariant} answers the question both were
 * for without handing out a base record anyone could build a second parts list
 * from.
 *
 * Note what the last two columns say. Without a preference nothing is in the
 * wrong system and nothing is unknown, because there is nothing to disagree
 * with — the 93 `joineryUntagged` aggregates become `self-sufficient`. A
 * preference is what makes those two verdicts possible at all.
 */
export type PlacementVerdict =
  /** One part. A variant needs no base and carries the requested system underneath. */
  | 'self-sufficient'
  /** Two parts: a topper, and a base that carries the requested system. */
  | 'with-base'
  /** Two parts, and the base is in another system — it will not clip to its neighbours. */
  | 'mismatched'
  /** A topper the archive holds no base for. See {@link missingBaseNote} for which of the three gaps. */
  | 'no-base'
  /** A self-sufficient variant exists, none in this system. Informs; never refuses. */
  | 'wrong-system'
  /** No joinery tag anywhere on any variant — unknown, not incompatible. */
  | 'unknown-joinery'
  /** Every variant is fitted into another piece rather than standing on the grid. */
  | 'insert'

/**
 * Which file a placement resolved to, and how good an answer that is.
 *
 * The reason this is a record and not just a `TileId`: §7 auto-inserts parts the
 * user never placed, and this row adds a second invisible decision on top —
 * *substituting the file itself*. A bill that showed the outcome and not the
 * choice would be two decisions deep with nothing said about either.
 */
export interface VariantResolution {
  readonly verdict: PlacementVerdict
  /** The file the placement names — `Placement.tileId`. */
  readonly placed: TileId
  /**
   * The file to print. Differs from {@link placed} whenever the lock preference
   * found a better variant of the same item.
   */
  readonly resolved: TileId
  /** `resolved !== placed`. The bill marks these rows; nothing else is a substitution. */
  readonly substituted: boolean
  /**
   * Files in the item. `1` means there was nothing to choose and the resolution
   * is the identity — 2,117 of 3,822 aggregates are singletons.
   */
  readonly variants: number
  /**
   * Two variants tied on every stated criterion and offer **different print
   * options**, so the pick came down to `bytes`.
   *
   * `VariantSelection.optionTie`, carried through unchanged. It is reached on 121
   * variant tuples covering 297 records, every one of them a `base` — so never
   * for a tile that sits *on* a base.
   */
  readonly optionTie: boolean
  /** The preference the resolution was made under. `undefined` is "no preference". */
  readonly lock: LockSystem | undefined
}

/** One placement, resolved. */
export interface ResolvedPlacement {
  /** Carried through unchanged; nothing here reads `x`, `z` or `rotation`. */
  placement: Placement
  /**
   * The placed tile, or `undefined` when the catalog does not hold that id.
   *
   * Reachable in normal operation: §2's ordinal rule 3 retires the id of a tile
   * that leaves the corpus, and a persisted scene or an old share link can
   * therefore name one. It is a `unknown-tile` note and an empty part list, not
   * a throw — one dead tile must not take a room down with it.
   */
  tile: CatalogRecord | undefined
  /** The parts to print, placed tile first. Empty only for an unknown tile. */
  parts: AssemblyPart[]
  notes: Note[]
  /**
   * Which variant of the placed item this build resolved to, and how complete an
   * assembly that is. `undefined` only for an unknown tile, alongside the empty
   * part list.
   *
   * **{@link tile} is the resolved record, not the placed one**, and that is
   * safe only because of A1's strongest measurement: over all 3,822 aggregates,
   * the number holding two distinct values of `name`, `kinds`, `texture`,
   * `build`, `foot`, `sizeCode` or `rotStep` is **zero**. So substituting the
   * record changes `blob`, `bytes`, `file`, `family`, `conn`, `layer`, `sprite`
   * and `config` — exactly the connection axis and its consequences — and cannot
   * change the tile's name, its shape on the grid or its size label. The canvas
   * therefore needs no notice of this at all; it draws from
   * `placement.tileId`'s own footprint and gets the same polygon either way.
   */
  resolution: VariantResolution | undefined
}

/* ------------------------------------------------------------------ matching */

/**
 * Ranking weights for base candidates — **powers of two, strictly decreasing**,
 * which is the point of the numbers rather than a coincidence.
 *
 * The sum is a lexicographic order written as arithmetic: no combination of lower
 * criteria can outvote a higher one, because `2 × 8 + 4 + 2 + 1 = 23 < 32`.
 * Cheap to compute and cheap to assert; `assembly.test.ts` checks the property
 * directly rather than trusting the comment.
 *
 * The order comes from what the data can actually deliver:
 *
 *   - **`lock` first** because the base *is* the joinery. A base that does not
 *     offer the chosen system does not lock to its neighbours, which is a
 *     build that falls apart rather than a build that looks wrong.
 *   - **`option` second**, and it is the one *graded* criterion: `plain` earns
 *     two steps, `unsupported` one, `topless` none, per {@link PRINT_OPTIONS}.
 *     Second because these are different products (§5.3) — a base with no top
 *     surface is not the piece the user asked for — and *below* lock because a
 *     topless base still clips to its neighbours while a plain one in the wrong
 *     system does not. Ranking it above the family and texture criteria is what
 *     makes the guarantee unconditional: within one candidate set a `topless`
 *     base can only win if **every** plainer candidate fails on the lock, and
 *     that case is disclosed by name.
 *   - **`code`** — the `size|openlock` family, and row D4's replacement for the
 *     `shape` criterion it displaced. Geometric fit is no longer a criterion at
 *     all: it is the *key*, so every candidate has it and scoring it would score
 *     a constant. What the key leaves open is which member of a congruent family
 *     to hand out — `wall:2` holds 101 bases across the codes `A` (86), `AS` (6)
 *     and nine uncoded — and the code is the sharpest signal available for that,
 *     ranked here for the same reason `shape` was: physical identity before
 *     cosmetics. `sizeCode.ts` is where its limits are measured.
 *
 *     It is neither decorative nor free, and both halves are measured. Under all
 *     four lock preferences it moves the chosen base for **434 toppers**, taking
 *     code-agreeing bases from 1,436 to 1,870 — and those 434 are exactly what
 *     makes this row's re-key hand out the *same base as before* for all 3,943
 *     toppers the code key had matched, gaining 43 and losing none. What it costs
 *     is 16 texture agreements (1,237 available, 1,221 taken), which is the
 *     ladder doing what it says: family above colour.
 *   - **`kind`** as the `base+wall`-under-a-wall signal. Weaker than the code
 *     because 566 toppers carry no kind bucket at all, so it is silent for them.
 *   - **`texture` last, and it can only ever be a tie-break.** Bases cover 15
 *     texture roots against the toppers' 23, and only 1,237 of 1,999 coded
 *     toppers (61.9%) can be given a texture-matched base *at all*. Weighting it
 *     higher would trade a base that locks for a base that matches the colour.
 *
 * Below the whole scale sits the index's `bytes`-ascending order, reached only
 * when two candidates score identically. It used to be the *only* thing
 * separating most candidates, which is how 79.1% of auto-inserted openlock bases
 * came to be topless: the topless print of a base is its smallest file.
 */
export const MATCH_WEIGHTS = Object.freeze({ lock: 32, option: 8, code: 4, kind: 2, texture: 1 })

/**
 * Steps of {@link MATCH_WEIGHTS}.option each print option earns.
 *
 * Derived from {@link PRINT_OPTIONS} rather than written out, so the preference
 * order has exactly one definition: reverse the rank, and the best option scores
 * highest. Two steps of 8 is the widest the criterion can be without reaching
 * `lock`, and `4 + 2 + 1 = 7 < 8` keeps one step above everything below it.
 */
const OPTION_STEPS: Readonly<Record<PrintOption, number>> = Object.freeze(
  Object.fromEntries(PRINT_OPTIONS.map((option, rank) => [option, PRINT_OPTIONS.length - 1 - rank])) as Record<
    PrintOption,
    number
  >,
)

/**
 * The lock systems, as a total map over the type.
 *
 * `Record<LockSystem, true>` rather than an array: the compiler rejects the
 * object if a member of the union is missing, so adding a fourth lock system
 * cannot leave this list stale. Membership is also O(1), which matters because
 * it is asked once per placement per connection tag.
 */
const LOCK_SYSTEMS: Readonly<Record<LockSystem, true>> = Object.freeze({
  openlock: true,
  dragonlock: true,
  magnetic: true,
})

function isLockSystem(value: string): boolean {
  return Object.hasOwn(LOCK_SYSTEMS, value)
}

/**
 * A base and the match that chose it.
 *
 * One object rather than two returns, so `resolvePlacement` can run the match
 * once in rule 0 and hand the result to rule 1 instead of matching twice.
 */
export interface MatchedBase {
  base: CatalogRecord
  match: BaseMatch
}

interface Candidates {
  key: 'sizeCode' | 'footprint'
  on: string
  records: readonly CatalogRecord[]
}

/**
 * The bases that could sit under this topper, and the key that found them.
 *
 * **The resolved primitive first, and where there is one it is the only key
 * tried.** A base is a physical object under another physical object: it has to
 * be the same shape, and `footprintKey` is the only thing in the record that
 * says what shape either of them is. Rule 3 of the module doc is what this
 * function is.
 *
 * The **no-fall-through** discipline is kept from the row before this one, and
 * inverted along with the priority: a topper whose primitive no base is
 * congruent to does *not* then try its size code. Falling back would answer a
 * different question — "which family?" instead of "which shape?" — and report it
 * as a success, hiding a gap §7 wants surfaced. It is also precisely how the 43
 * `II`/`IO`/`IX` toppers used to be reported as unsupportable while 119 congruent
 * `rect:1x1` bases sat in the archive: the *code* was missing, the *base* was
 * not, and a code-first join could not tell those apart.
 *
 * The size code survives here as a **last resort with a gate**: reached only by
 * a topper with no primitive at all (14 toppers, every one coded `U`), and only
 * when the bases carrying that code agree on one primitive. Without the gate this
 * one path would still be able to hand a `column` base to a `tri` topper the day
 * a base carries an ambiguous code — see {@link sharedPrimitive}, and
 * `sizeCode.ts` for which four codes are ambiguous and why none of them can do
 * it today.
 */
function candidatesFor(tile: CatalogRecord, index: AssemblyIndex): Candidates | undefined {
  const foot = footprintKey(tile.foot)
  if (foot !== undefined) {
    const records = index.basesByFootprint.get(foot)
    return records === undefined ? undefined : { key: 'footprint', on: foot, records }
  }
  if (tile.sizeCode === undefined) return undefined
  const records = index.basesBySizeCode.get(tile.sizeCode)
  if (records === undefined || sharedPrimitive(records) === undefined) return undefined
  return { key: 'sizeCode', on: tile.sizeCode, records }
}

function kindsAgree(tile: CatalogRecord, base: CatalogRecord): boolean {
  // `base` itself is on every base by definition, so it carries no information.
  return base.kinds.some((kind) => kind !== 'base' && tile.kinds.includes(kind))
}

/**
 * The base and the topper publish the same `size|openlock` code.
 *
 * Both sides have to *have* one: `undefined === undefined` is not a family, and
 * scoring it would reward every uncoded base under every uncoded topper equally,
 * which is the `foot.shape === 'none'` trap one namespace over.
 */
function codesAgree(tile: CatalogRecord, base: CatalogRecord): boolean {
  return tile.sizeCode !== undefined && base.sizeCode === tile.sizeCode
}

/**
 * The print option of a base in this index.
 *
 * `basePrintOption` is total over bases and every candidate is a base, so the
 * fallback is unreachable on an index built by `buildAssemblyIndex`. It is
 * `plain` rather than a throw because the failure it would report — a base absent
 * from its own index — is a build-time bug that must not take a room down, and
 * the note names the option either way.
 */
function optionOf(index: AssemblyIndex, base: CatalogRecord): PrintOption {
  return index.basePrintOption.get(base.id) ?? 'plain'
}

/**
 * Pick a base, or return `undefined` when the corpus holds none.
 *
 * The scan keeps the first candidate at the best score, and candidate arrays
 * arrive pre-sorted `bytes` then `id` — so an exact tie breaks on the cheaper
 * print and then on catalog path, and the choice is a pure function of the
 * corpus. Everything that is *about the topper* is in the score, not in that
 * order: see {@link MATCH_WEIGHTS}.
 *
 * ## Why this is exported, having been private through D1, D4 and D5
 *
 * Row A7 asked for it or for a `baseLocksFor` probe, and row A6 first answered
 * with {@link resolveVariant} instead — a narrower thing that hands out no base
 * record. That answer was wrong, for a reason A6 only found by breaking 22 tests:
 * **rule 0 means `resolvePlacement` is no longer a way to observe the base match
 * at all.** Under openlock 1,808 of the 4,363 topper files resolve to a sibling
 * that needs no base, so a caller who asks the resolver "what base does this
 * topper get?" is now told "none, because you would not print that file" — a
 * true answer to a different question.
 *
 * Every corpus guard D1, D4 and D5 left behind asks the base-match question:
 * that the topless auto-insert rate is zero, that every base handed to a topper
 * is congruent to it, that the gap splits 86 / 31 / 260. Those are statements
 * about *this function*, and without a name for it they became unwritable rather
 * than merely awkward. So the function gets the name.
 *
 * What stays private is the **score** — a number with no unit invites a UI to
 * render it — and rule 1. This returns a match, never a part: an auto-inserted
 * base still enters a bill through {@link resolvePlacement} and nowhere else, so
 * there remains exactly one implementation of "every openforge piece gets a
 * base".
 */
export function matchBase(tile: CatalogRecord, index: AssemblyIndex, lock: LockSystem | undefined): MatchedBase | undefined {
  const candidates = candidatesFor(tile, index)
  if (candidates === undefined || candidates.records.length === 0) return undefined

  let best: CatalogRecord | undefined
  let bestScore = -1
  const offered = new Set<PrintOption>()

  for (const base of candidates.records) {
    const option = optionOf(index, base)
    offered.add(option)
    let score = OPTION_STEPS[option] * MATCH_WEIGHTS.option
    if (lock === undefined || base.conn.includes(lock)) score += MATCH_WEIGHTS.lock
    if (codesAgree(tile, base)) score += MATCH_WEIGHTS.code
    if (kindsAgree(tile, base)) score += MATCH_WEIGHTS.kind
    if (base.texture !== undefined && base.texture === tile.texture) score += MATCH_WEIGHTS.texture
    if (score > bestScore) {
      bestScore = score
      best = base
    }
  }

  if (best === undefined) return undefined
  return {
    base: best,
    match: {
      key: candidates.key,
      on: candidates.on,
      candidates: candidates.records.length,
      option: optionOf(index, best),
      optionsOffered: PRINT_OPTIONS.filter((option) => offered.has(option)),
      codeAgrees: codesAgree(tile, best),
      kindAgrees: kindsAgree(tile, best),
      textureAgrees: best.texture !== undefined && best.texture === tile.texture,
      lockAgrees: lock === undefined || best.conn.includes(lock),
    },
  }
}

/* -------------------------------------------------------- variant resolution */

/** The whole of rule 0's output: the file, why, and the base it already found. */
interface Chosen {
  record: CatalogRecord
  resolution: VariantResolution
  /** Present iff the resolved variant is a topper *and* the archive has a base for it. */
  matched: MatchedBase | undefined
}

/**
 * Split A1's `needs-base` on the base match; pass the other four through.
 *
 * `lockAgrees` is `true` when no preference was given, so "no preference" yields
 * `with-base` rather than `mismatched` — nothing can disagree with a preference
 * that was never stated.
 */
function verdictOf(verdict: VariantVerdict, matched: MatchedBase | undefined): PlacementVerdict {
  if (verdict !== 'needs-base') return verdict
  if (matched === undefined) return 'no-base'
  return matched.match.lockAgrees ? 'with-base' : 'mismatched'
}

/**
 * Rule 0: which file of the placed item this lock preference wants.
 *
 * Two hops and one call. `CatalogRecord.design` is the aggregation key, so
 * `byDesign` reaches the item in one lookup — A4's ordinal→variant→design hop is
 * not needed here because a placement already names a record. Then
 * {@link selectVariant} ranks the item's files, and the verdict it cannot reach
 * without a base index is finished by {@link matchBase}.
 *
 * **`PRINT_OPTIONS` is passed, always.** `VariantPreference.options` is optional
 * and what omitting it costs is measured: the rank falls through to `bytes`
 * ascending, which is the tie-break D1 removed from base matching for cause —
 * the topless print of a base is its smallest file. There is exactly one right
 * value for this argument and it lives one module over, so it is supplied rather
 * than offered as a choice.
 *
 * **The item's topper variants are interchangeable for base matching, and that
 * is a theorem rather than a hope.** 760 aggregates hold two or more toppers, and
 * the base handed out is identical across all of them in every one — because
 * {@link matchBase} reads only `foot`, `sizeCode`, `kinds` and `texture` off the
 * topper, and A1 measures **zero** aggregates holding two distinct values of any
 * of the four. So this function does not walk the topper pool looking for one
 * with a base: there is nothing to find. `assembly.test.ts` asserts the zero, so
 * the day an aggregate does hold two footprints this simplification fails loudly
 * instead of quietly handing out the wrong base.
 */
function chooseVariant(placed: CatalogRecord, index: AssemblyIndex, lock: LockSystem | undefined): Chosen {
  const aggregate = index.aggregates.byDesign.get(placed.design)
  if (aggregate === undefined) return withoutAggregate(placed, index, lock)

  const selection = selectVariant(aggregate, { bottom: lock, options: PRINT_OPTIONS })
  // `byId` and the aggregate layer are built from the same record array, so the
  // fallback is unreachable on a matched pair — and it is the honest answer for
  // the mismatched pair `buildAssemblyIndex`'s optional argument makes possible:
  // keep the file the user placed rather than one from another catalog.
  const record = index.byId.get(selection.variant.id) ?? placed
  // A topper is exactly what `needs-base` selects, and nothing else selects one:
  // every other branch of `selectVariant` draws from a pool it has filtered
  // `needsBase` out of, or is reached only when that pool is empty.
  const matched = selection.verdict === 'needs-base' ? matchBase(record, index, lock) : undefined

  return {
    record,
    matched,
    resolution: {
      verdict: verdictOf(selection.verdict, matched),
      placed: placed.id,
      resolved: record.id,
      substituted: record.id !== placed.id,
      variants: aggregate.variants.length,
      optionTie: selection.optionTie,
      lock,
    },
  }
}

/**
 * The degraded path: this record's design is not in the aggregate layer.
 *
 * Reachable only by handing {@link buildAssemblyIndex} an aggregate index built
 * from a *different* catalog, which its optional second argument permits. The
 * response is to make no choice — the placed file is the resolved file — and to
 * claim only the verdicts a lone record can support.
 *
 * It deliberately does **not** guess `wrong-system` or `unknown-joinery`. Both
 * are questions about the *underside*, and `CatalogRecord.conn` is the flattened
 * connection list with the position segment thrown away: 1,283 toppers carry a
 * lock on the side and none underneath, so a `conn`-based answer here would
 * advertise joinery the mesh does not have. Only the aggregate layer holds the
 * positional split, and without it the honest report is "needs no base".
 */
function withoutAggregate(placed: CatalogRecord, index: AssemblyIndex, lock: LockSystem | undefined): Chosen {
  const matched = placed.layer === 'topper' ? matchBase(placed, index, lock) : undefined
  const verdict: PlacementVerdict =
    placed.layer === 'insert'
      ? 'insert'
      : placed.layer === 'topper'
        ? verdictOf('needs-base', matched)
        : 'self-sufficient'
  return {
    record: placed,
    matched,
    resolution: {
      verdict,
      placed: placed.id,
      resolved: placed.id,
      substituted: false,
      variants: 1,
      optionTie: false,
      lock,
    },
  }
}

/**
 * Which file this item resolves to under this preference — rule 0 on its own.
 *
 * The probe row A7 asked for, and deliberately **not** the exported `matchBase`
 * it offered as the alternative. A7 reads `BaseMatch.lockAgrees` through a
 * synthetic `Placement` to decide whether a design is buildable; this answers
 * that question directly, in one call per *item* rather than one per topper
 * variant, and with no placement to fabricate. What it does not do is hand out
 * the base record, which is what keeps rule 1 — "enforced by adding a part" —
 * with the one function that adds parts.
 *
 * `undefined` for an id this catalog does not hold, which is the same condition
 * that gives {@link resolvePlacement} an empty part list.
 */
export function resolveVariant(
  tileId: TileId,
  index: AssemblyIndex,
  options: AssemblyOptions = {},
): VariantResolution | undefined {
  const placed = index.byId.get(tileId)
  if (placed === undefined) return undefined
  return chooseVariant(placed, index, options.lock).resolution
}

/* ----------------------------------------------------------------- resolution */

/**
 * Resolve one placement into its parts and its notes.
 *
 * Total: every input produces a `ResolvedPlacement`. Nothing throws and nothing
 * is refused — the only way to get an empty part list is an id the catalog does
 * not hold.
 *
 * Every note below is asked about the **resolved** record, not the placed one,
 * and for `lock-unavailable` that is the point rather than an implementation
 * detail: placing the dragonlock file of an item in an openlock build used to
 * warn that the tile offers dragonlock and not openlock, while the openlock file
 * of the same item sat in the archive. Now the resolution hands over that file
 * and there is nothing to warn about.
 */
export function resolvePlacement(
  placement: Placement,
  index: AssemblyIndex,
  options: AssemblyOptions = {},
): ResolvedPlacement {
  const placed = index.byId.get(placement.tileId)
  const notes: Note[] = []

  if (placed === undefined) {
    const message = `${placement.tileId} is not in this catalog build; it may have been retired.`
    notes.push(note('unknown-tile', message, placement.tileId))
    return { placement, tile: undefined, parts: [], notes, resolution: undefined }
  }

  const chosen = chooseVariant(placed, index, options.lock)
  const tile = chosen.record
  const parts: AssemblyPart[] = [{ role: 'placed', record: tile }]

  if (tile.foot.shape === 'none') {
    const message = `${tile.name} has no derivable footprint and cannot be drawn in plan view.`
    notes.push(note('no-footprint', message, tile.id))
  }
  if (tile.layer === 'insert') {
    notes.push(
      note('insert-on-grid', `${tile.name} is a component fitted into another piece, not a grid tile.`, tile.id),
    )
  }
  if (tile.build === undefined) {
    const message = `${tile.name} names no build system, so its construction is unconstrained.`
    notes.push(note('build-unspecified', message, tile.id))
  }
  if (options.lock !== undefined && tile.conn.some(isLockSystem) && !tile.conn.includes(options.lock)) {
    notes.push(
      note(
        'lock-unavailable',
        `${tile.name} offers ${tile.conn.filter(isLockSystem).join(', ')}, not ${options.lock}.`,
        tile.id,
      ),
    )
  }

  if (tile.layer === 'topper') {
    appendBase(tile, index, options.lock, chosen.matched, parts, notes)
  }

  return { placement, tile, parts, notes, resolution: chosen.resolution }
}

/**
 * Rule 1, and the three ways the corpus can fail to satisfy it.
 *
 * The match arrives already made. Rule 0 has to run {@link matchBase} to tell
 * `with-base` from `no-base`, and matching a second time here would be the same
 * scan over the same pre-sorted candidate list for the same answer — worse, it
 * would be a *second* place the base is chosen, which is exactly the duplication
 * that makes a verdict and a bill able to disagree.
 */
function appendBase(
  tile: CatalogRecord,
  index: AssemblyIndex,
  lock: LockSystem | undefined,
  matched: MatchedBase | undefined,
  parts: AssemblyPart[],
  notes: Note[],
): void {
  if (matched === undefined) {
    notes.push(missingBaseNote(tile, index))
    return
  }

  const { base, match } = matched
  parts.push({ role: 'base', record: base, match })

  notes.push(note('base-auto-inserted', autoInsertedMessage(tile, base, match, lock), base.id))
  // The option gets a code of its own as well as a clause in the sentence above,
  // because it is the one criterion whose answer is a *different product* — see
  // `notes.ts#base-option-chosen`. Fires only when the answer is not the plain
  // base: 0 of 4,363 toppers under openlock, dragonlock or no preference, 3 under
  // magnetic.
  if (match.option !== 'plain') {
    const message = `${base.name} is the ${match.option} print of this base: ${optionClause(match, lock)}.`
    notes.push(note('base-option-chosen', message, base.id))
  }
  if (!match.lockAgrees && lock !== undefined) {
    const message = `${base.name} does not offer ${lock}; no ${lock} base carries ${keyLabel(match)}.`
    notes.push(note('base-lock-mismatch', message, base.id))
  }
  if (!match.textureAgrees) {
    const message =
      `${base.name} is ${base.texture ?? 'untextured'}, not ${tile.texture ?? 'untextured'}; ` +
      `bases cover 15 texture roots against the toppers' 23.`
    notes.push(note('base-texture-mismatch', message, base.id))
  }
}

/* ---------------------------------------------------------------- disclosure */

/** How each print option reads in a sentence. */
const OPTION_PROSE: Readonly<Record<PrintOption, string>> = Object.freeze({
  plain: 'a full base',
  unsupported: 'geometry reworked to print without supports',
  topless: 'no top surface',
})

/** `footprint rect:2x2`, `size code U` — the key, named the way a reader can check it. */
function keyLabel(match: BaseMatch): string {
  return `${match.key === 'sizeCode' ? 'size code' : 'footprint'} ${match.on}`
}

/**
 * The print-option clause, and — when the option is not `plain` — *why*.
 *
 * Two causes, and they are the two the user can act on differently. If a plainer
 * candidate was offered under this key, it lost on the lock and only on the lock,
 * because `option` is the second-heaviest criterion and nothing but `lock` sits
 * above it — so changing the lock preference would change the answer. If none was
 * offered, the archive holds no better print of this base and no preference will
 * conjure one.
 */
function optionClause(match: BaseMatch, lock: LockSystem | undefined): string {
  const prose = OPTION_PROSE[match.option]
  if (match.option === 'plain') return prose
  const plainerOffered = match.optionsOffered.some((offered) => OPTION_STEPS[offered] > OPTION_STEPS[match.option])
  const cause =
    plainerOffered && lock !== undefined
      ? `every plainer base carrying ${keyLabel(match)} lacks ${lock}`
      : `no plainer base carries ${keyLabel(match)}`
  // Parenthesised, not dashed: the clause sits inside a comma-separated list of
  // criteria, and a dash there reads as the end of the list.
  return `${prose} (${cause})`
}

/**
 * The auto-insert note's prose: which base, and why that one.
 *
 * §7 auto-inserts a part the user never placed and cannot remove, so the note is
 * the only place the decision is visible — and it used to read "matched on
 * sizeCode A", which names the *key* and not one thing about the base. The
 * criteria are listed in {@link MATCH_WEIGHTS} order, heaviest first, and only
 * the ones that agreed: a criterion that did not agree has a note of its own
 * (`base-lock-mismatch`, `base-texture-mismatch`) rather than a second voice
 * here. The print option is always stated, agreeing or not, because it is the
 * one criterion whose answer is a different product.
 */
function autoInsertedMessage(
  tile: CatalogRecord,
  base: CatalogRecord,
  match: BaseMatch,
  lock: LockSystem | undefined,
): string {
  const reasons: string[] = []
  if (lock !== undefined && match.lockAgrees) reasons.push(`offers ${lock}`)
  reasons.push(optionClause(match, lock))
  if (match.codeAgrees) reasons.push('same size code')
  if (match.kindAgrees) reasons.push('kind agrees')
  if (match.textureAgrees) reasons.push('texture agrees')

  const pool = match.candidates === 1 ? 'the only base' : `the best of ${String(match.candidates)} bases`
  return (
    `${tile.name} delegates its joinery to a base; ${base.name} was added — ` +
    `${pool} carrying ${keyLabel(match)}: ${reasons.join(', ')}.`
  )
}

/**
 * Which of the three gaps this topper fell into.
 *
 * Three codes rather than one, because the remedies differ: a `no-matching-base`
 * is a base the corpus should have and does not (86 toppers), a
 * `no-congruent-base` is a shape nothing supports (31 toppers), and a
 * `base-unmatchable` is a topper with no key at all (260 toppers) — a data
 * problem in the *topper*, not in the bases. Collapsing them would report 377
 * identical warnings and hide which of the three anyone can act on.
 *
 * **The classification is not the join, and row D4 is where the two came apart.**
 * The join asks "which shape?" and the report asks "what should someone go and
 * fix?", and for the 86 those are different questions with different answers:
 * every one of them publishes a code (`L`, `O`, `P`, `PA`, `PB`, `PC`) that **no
 * base in the archive carries**, and naming that code is what a report upstream
 * can act on — `docs/corpus-base-gap.md` is indexed by it. Saying "no base is
 * congruent to a 0.5 × 0.5 column" instead would be true, and would read as
 * geometry rather than as the omission it is.
 *
 * So `no-matching-base` is claimed only when the code really is absent from the
 * base range, which keeps the sentence honest in the case that does not exist
 * yet: a topper whose code *is* carried by bases, of a shape those bases are not
 * — the ambiguity `sizeCode.ts` measures. That one is a congruence gap, and it
 * says so.
 *
 * Exported for {@link matchBase}'s reason, which it shares exactly: rule 1 has
 * two halves — find a base, or say which of the three gaps stopped you — and
 * rule 0 means neither is observable through `resolvePlacement` any more. A
 * topper that resolves to a self-sufficient sibling is neither given a base nor
 * warned about, correctly, so a corpus-level claim about the gap has to ask the
 * classifier directly. It takes a tile and an index and reads nothing else: the
 * gap is a fact about the archive, and no lock preference moves it.
 */
export function missingBaseNote(tile: CatalogRecord, index: AssemblyIndex): Note {
  const codeUnanswered = tile.sizeCode !== undefined && !index.basesBySizeCode.has(tile.sizeCode)

  if (footprintKey(tile.foot) !== undefined) {
    if (codeUnanswered) {
      return note(
        'no-matching-base',
        `no base in the catalog carries size code ${tile.sizeCode ?? ''}, and none is congruent to ` +
          `${tile.name}'s footprint, so it has no base to sit on.`,
        tile.id,
      )
    }
    return note('no-congruent-base', `no base is congruent to ${tile.name}'s footprint.`, tile.id)
  }

  if (tile.sizeCode === undefined) {
    return note(
      'base-unmatchable',
      `${tile.name} carries neither a size code nor a footprint, so no base can be matched to it.`,
      tile.id,
    )
  }

  // No footprint, so the code was the only key — and it did not join. Either no
  // base carries it, or the bases that do disagree about what shape they are,
  // which `candidatesFor` refuses to guess at. Both are `no-matching-base`: the
  // archive holds no base this topper can be matched to.
  const message = codeUnanswered
    ? `no base in the catalog carries size code ${tile.sizeCode}, so ${tile.name} has no base to sit on.`
    : `the bases carrying size code ${tile.sizeCode} are not all the same shape, and ${tile.name} ` +
      `publishes no footprint to choose between them.`
  return note('no-matching-base', message, tile.id)
}
