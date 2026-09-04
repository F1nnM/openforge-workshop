/**
 * Ranking base candidates — the half of rule 1 that survived row A3.
 *
 * ## What died, and what this file is
 *
 * Rule 1 was *"every `connection|openforge` piece gets a base line item,
 * auto-inserted"*, and it had two halves: **find the pool** and **choose from
 * it**. A template declares its base as an ordinary slot (§1.7 — and all 40 of
 * the shipped templates declare one, measured), so the app no longer inserts a
 * part the user never asked for. The insert, its four disclosure notes, and the
 * three `PlacementVerdict` values that reported on it are gone.
 *
 * **The choosing is not gone, because something still has to make it.** A
 * template dropped on the grid with an empty slot is a recipe with a hole in it
 * (§3.2 "places anyway"), so C2's solver default-fills every slot it can — and
 * for a `base` slot the right default is exactly the ladder below. Deleting it
 * would not delete a decision, it would delete a *good* decision and leave a bad
 * one in its place: the measurement that forced this ladder into existence is
 * that a `bytes`-ascending tie-break made **79.1% of auto-inserted openlock
 * bases topless** — a base with no top surface, which is a different product —
 * and that with `option` ranked above it, **3,986 of 3,986 matched openforge
 * toppers get a plain base under openlock**. `assembly.test.ts` re-derives both
 * against the live corpus.
 *
 * ## Two entry points, and which one is for whom
 *
 *   - {@link rankBases} takes a candidate list. **This is the surface for row
 *     C2's fill solver**: `@/composition` decides what may fill a `base` slot —
 *     `require`, `deny`, and the `constrain` join over the template's and the
 *     siblings' tags — and this ranks what comes back. The two answer different
 *     questions and neither substitutes for the other: composition says
 *     *admissible*, this says *best*.
 *   - {@link matchBase} derives the candidate list from the index itself, by
 *     congruence, and is **unchanged in signature and behaviour**. Its
 *     production consumer is `src/ui/lock-picker/build.ts#baseSupplies`, which
 *     asks whether the archive holds a base carrying a given lock for a given
 *     *variant* — a question about the corpus, not about anybody's scene, and
 *     one the picker already asked this way before A3. That file needs no edit.
 *
 * ## Join on the resolved primitive, never on a tag
 *
 * Kept verbatim from the resolver, because the two refutations are corpus facts
 * and not decisions A3 is entitled to revisit:
 *
 *   - **`build|`** — zero bases carry `build|wall on tile` while 863 tiles use
 *     that system, 857 of them toppers. A build join returns *no base* for every
 *     one of them, and the symptom is indistinguishable from missing data.
 *   - **`size|openlock`** — a width is not a footprint. Four codes span more
 *     than one primitive (`O` spans three), so a code join can put a 0.5 × 0.5
 *     pillar under a 4 × 4 triangle. See `sizeCode.ts`.
 *
 * `assembly.test.ts` asserts both — the 857-against-0 split, and that every base
 * this module hands a topper is congruent to it — so neither can come back as an
 * optimisation.
 */
import type { CatalogRecord } from '@/catalog'
import type { LockSystem } from '@/store'

import type { AssemblyIndex, PrintOption } from './assemblyIndex'
import { PRINT_OPTIONS } from './assemblyIndex'
import { footprintKey } from './footprint'
import { sharedPrimitive } from './sizeCode'

/* ------------------------------------------------------------------- weights */

/**
 * Ranking weights for base candidates — **powers of two, strictly decreasing**,
 * which is the point of the numbers rather than a coincidence.
 *
 * The sum is a lexicographic order written as arithmetic: no combination of
 * lower criteria can outvote a higher one, because `2 × 8 + 4 + 2 + 1 = 23 < 32`.
 * Cheap to compute and cheap to assert; `assembly.test.ts` checks the property
 * directly rather than trusting the comment.
 *
 * The order comes from what the data can actually deliver:
 *
 *   - **`lock` first** because the base *is* the joinery. A base that does not
 *     offer the chosen system does not lock to its neighbours, which is a build
 *     that falls apart rather than a build that looks wrong.
 *   - **`option` second**, and it is the one *graded* criterion: `plain` earns
 *     two steps, `unsupported` one, `topless` none, per {@link PRINT_OPTIONS}.
 *     Second because these are different products (§5.3) — a base with no top
 *     surface is not the piece the user asked for — and *below* lock because a
 *     topless base still clips to its neighbours while a plain one in the wrong
 *     system does not. Ranking it above the family and texture criteria is what
 *     makes the guarantee unconditional: within one candidate set a `topless`
 *     base can only win if **every** plainer candidate fails on the lock.
 *   - **`code`** — the `size|openlock` family, and row D4's replacement for the
 *     `shape` criterion it displaced. Under a congruence key every candidate has
 *     the topper's shape, so scoring geometry would score a constant. What the
 *     key leaves open is which member of a congruent family to hand out —
 *     `wall:2` holds 101 bases across the codes `A` (86), `AS` (6) and nine
 *     uncoded — and the code is the sharpest signal available for that. Under
 *     all four lock preferences it moves the chosen base for **434 toppers**,
 *     taking code-agreeing bases from 1,436 to 1,870, and costs 16 texture
 *     agreements (1,237 available, 1,221 taken): family above colour.
 *   - **`kind`** as the `base+wall`-under-a-wall signal. Weaker than the code
 *     because 566 toppers carry no kind bucket at all, so it is silent for them.
 *   - **`texture` last, and it can only ever be a tie-break.** Bases cover 15
 *     texture roots against the toppers' 23, and only 1,237 of 1,999 coded
 *     toppers (61.9%) can be given a texture-matched base *at all*. Weighting it
 *     higher would trade a base that locks for a base that matches the colour.
 *
 * Below the whole scale sits the candidate order the caller supplied — `bytes`
 * ascending then `id` for a {@link matchBase} pool, which the index sorts once —
 * reached only when two candidates score identically. It used to be the *only*
 * thing separating most candidates, which is how 79.1% of auto-inserted openlock
 * bases came to be topless: the topless print of a base is its smallest file.
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

/* ------------------------------------------------------------------ the facts */

/**
 * How a base was chosen, kept so a UI can show its work.
 *
 * Every field is a *fact about this choice*, not a score. The score is an
 * implementation detail of {@link rankBases} and is deliberately not exposed: a
 * number with no unit invites a UI to render it.
 */
export interface BaseRanking {
  /** The base this ranking chose. */
  base: CatalogRecord
  /** How many candidates it beat. */
  candidates: number
  /**
   * Which of the three products the chosen base is. `plain` for 3,986 of 3,986
   * matched openforge toppers under openlock; a `bytes`-ascending tie-break over
   * the same key makes it `topless` for 3,258 of them and says nothing.
   */
  option: PrintOption
  /**
   * The print options the candidate set offered at all, best first.
   *
   * Carried so a disclosure can distinguish the two reasons a non-`plain` base
   * was chosen — the corpus offers nothing better in this set, or something
   * better exists and does not carry the lock — which is the difference between
   * a gap in the archive and a compromise the user could undo by changing the
   * lock preference. The choice itself never consults it.
   */
  optionsOffered: PrintOption[]
  /**
   * The base publishes the same `size|openlock` code as the topper.
   *
   * A code-agreeing congruent base exists for **1,870 of the 1,999 coded
   * toppers**, and the ladder hands one to every single one of them. The other
   * 129 publish a code no base in the archive carries at all.
   */
  codeAgrees: boolean
  /** The base shares a non-`base` kind bucket with the topper (`base+wall` under a wall). */
  kindAgrees: boolean
  /** Texture roots are equal. Reachable for 1,237 of 1,999 coded toppers (61.9%). */
  textureAgrees: boolean
  /** The base offers the preferred lock system, or no preference was given. */
  lockAgrees: boolean
}

/**
 * A {@link BaseRanking} over a candidate set this module derived itself, so it
 * can also say **which key found the pool**.
 *
 * The two extra fields are absent from `BaseRanking` and present here for a
 * reason that is structural rather than tidy: a candidate set handed in by
 * `@/composition` was found by a slot's `require`/`deny`/`constrain`, which is
 * not a key and has no value to name. A ranking that reported
 * `footprint rect:2x2` about a set assembled from tags would be a true-looking
 * sentence about a join that never happened.
 */
export interface BaseMatch extends BaseRanking {
  /**
   * Which key joined. `footprint` is the primary and the physical one;
   * `sizeCode` is the last resort for a topper with no primitive at all — 14
   * toppers, all coded `U`, and only where the code's bases agree on one
   * primitive. See {@link candidatesFor}.
   */
  key: 'sizeCode' | 'footprint'
  /** The key's value — the canonical footprint key, or the size code. */
  on: string
}

/**
 * A base and the match that chose it.
 *
 * Kept as a wrapper rather than folded into {@link BaseMatch} — which now
 * carries `base` itself — because `src/ui/lock-picker/build.ts` reads
 * `matchBase(record, index, system)?.match.lockAgrees`, and that call site is
 * the one place in the app whose behaviour A3 has no business changing: it
 * measures buildability against the archive, a question templates do not touch.
 */
export interface MatchedBase {
  base: CatalogRecord
  match: BaseMatch
}

/* ------------------------------------------------------------- the candidates */

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
 * says what shape either of them is.
 *
 * The **no-fall-through** discipline: a topper whose primitive no base is
 * congruent to does *not* then try its size code. Falling back would answer a
 * different question — "which family?" instead of "which shape?" — and report it
 * as a success, hiding a gap §7 wants surfaced. It is also precisely how the 43
 * `II`/`IO`/`IX` toppers used to be reported as unsupportable while 119
 * congruent `rect:1x1` bases sat in the archive: the *code* was missing, the
 * *base* was not, and a code-first join could not tell those apart.
 *
 * The size code survives here as a **last resort with a gate**: reached only by
 * a topper with no primitive at all (14 toppers, every one coded `U`), and only
 * when the bases carrying that code agree on one primitive. Without the gate
 * this one path would still be able to hand a `column` base to a `tri` topper
 * the day a base carries an ambiguous code — see {@link sharedPrimitive}.
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
 * The print option of a record in this index.
 *
 * `basePrintOption` is total over bases, so the fallback is reached only by a
 * candidate that is not a base — which {@link rankBases} permits, because a slot
 * solver may hand over whatever its slot admits and the 40 templates' `base`
 * slots `require` the tag `shape|base` rather than a layer. `plain` rather than a
 * throw because the ranking must not take a room down, and because a non-base
 * candidate genuinely has no print option to report.
 */
function optionOf(index: AssemblyIndex, base: CatalogRecord): PrintOption {
  return index.basePrintOption.get(base.id) ?? 'plain'
}

/* ---------------------------------------------------------------- the ranking */

/**
 * Rank an explicit candidate set against the piece that will stand on it.
 *
 * **The candidate order is the tie-break and the caller owns it.** The scan
 * keeps the first candidate at the best score, so an exact tie resolves to
 * whatever the caller put first. {@link matchBase} passes the index's own
 * `bytes`-then-`id` order, which makes its answer a pure function of the corpus;
 * `@/composition` returns candidates in catalog-id order, which makes a solver's
 * answer a pure function of the corpus too. Neither is a *suitability* order —
 * everything that is about the topper is in the score, per {@link MATCH_WEIGHTS}.
 *
 * `undefined` for an empty set, which is the honest answer and not an error: a
 * slot with no candidate is `@/composition`'s `deadEnd`, and **0 of the 128
 * shipped template parts are one** in their initial state.
 *
 * `reference` is the piece the base is being chosen *for*, and it is a parameter
 * rather than a field of the candidate set because three of the five criteria
 * read it. A solver filling a template's `base` slot passes whatever the
 * template stands on — which sibling that is is the solver's decision, not this
 * function's, and row C2 owns it.
 */
export function rankBases(
  reference: CatalogRecord,
  candidates: readonly CatalogRecord[],
  index: AssemblyIndex,
  lock: LockSystem | undefined,
): BaseRanking | undefined {
  if (candidates.length === 0) return undefined

  let best: CatalogRecord | undefined
  let bestScore = -1
  const offered = new Set<PrintOption>()

  for (const base of candidates) {
    const option = optionOf(index, base)
    offered.add(option)
    let score = OPTION_STEPS[option] * MATCH_WEIGHTS.option
    if (lock === undefined || base.conn.includes(lock)) score += MATCH_WEIGHTS.lock
    if (codesAgree(reference, base)) score += MATCH_WEIGHTS.code
    if (kindsAgree(reference, base)) score += MATCH_WEIGHTS.kind
    if (base.texture !== undefined && base.texture === reference.texture) score += MATCH_WEIGHTS.texture
    if (score > bestScore) {
      bestScore = score
      best = base
    }
  }

  if (best === undefined) return undefined
  return {
    base: best,
    candidates: candidates.length,
    option: optionOf(index, best),
    optionsOffered: PRINT_OPTIONS.filter((option) => offered.has(option)),
    codeAgrees: codesAgree(reference, best),
    kindAgrees: kindsAgree(reference, best),
    textureAgrees: best.texture !== undefined && best.texture === reference.texture,
    lockAgrees: lock === undefined || best.conn.includes(lock),
  }
}

/**
 * Pick a congruent base for this topper, or return `undefined` when the corpus
 * holds none.
 *
 * {@link candidatesFor} then {@link rankBases}, and the signature is what it was
 * before row A3 — deliberately, because `src/ui/lock-picker/build.ts` is a live
 * consumer whose whole point is that it shares the resolver's definition of "can
 * this be built". Its docblock says so: *"a picker that disagreed with the bill
 * of tiles about whether a design is printable would be worse than one with no
 * figures at all."* A3 removed the bill's auto-insert; it did not remove the
 * archive's bases, and the picker's three percentages are unmoved.
 *
 * What stays private is the **score**, and what is gone is rule 1: this returns
 * a match, never a part. No caller in the app adds a base to a bill any more — a
 * base is a slot, and a slot is filled or it is reported as unfilled.
 */
export function matchBase(
  tile: CatalogRecord,
  index: AssemblyIndex,
  lock: LockSystem | undefined,
): MatchedBase | undefined {
  const candidates = candidatesFor(tile, index)
  if (candidates === undefined) return undefined
  const ranking = rankBases(tile, candidates.records, index, lock)
  if (ranking === undefined) return undefined
  return { base: ranking.base, match: { ...ranking, key: candidates.key, on: candidates.on } }
}

/* ------------------------------------------------------------- the gap report */

/** Which of the three ways the archive can hold no base for a topper. */
export type BaseGap =
  /**
   * An openforge topper with a size code, and **no base in the catalog carries
   * that code** — 86 toppers over six codes. The base ought to exist;
   * `docs/corpus-base-gap.md` is indexed by the code.
   */
  | 'no-matching-base'
  /**
   * An openforge topper with a footprint, and no base congruent to it — 31
   * toppers: half-unit strips against a base range whose narrowest extent is a
   * full unit, `rect:2x6` slabs in a range that holds `2x4` and `2x8`, and row
   * W5's `s2w_radial` band the archive has no base for. Geometry, not an
   * omission.
   */
  | 'no-congruent-base'
  /**
   * An openforge topper with neither a size code nor a footprint to match on —
   * 260 toppers, every one of them `foot.shape === 'none'`. A data problem in
   * the *topper*, not in the bases.
   */
  | 'base-unmatchable'

/**
 * Which of the three gaps this topper falls into, or `undefined` when it does
 * not: a fact about the archive, and no lock preference moves it.
 *
 * Three answers rather than one because the remedies differ, and collapsing them
 * would report 377 identical warnings while hiding which of the three anyone can
 * act on. Measured on the live corpus: **86 / 31 / 260, identically under
 * openlock, dragonlock, magnetic and no preference at all.**
 *
 * **The classification is not the join, and row D4 is where the two came apart.**
 * The join asks "which shape?" and this asks "what should someone go and fix?",
 * and for the 86 those are different questions with different answers: every one
 * of them publishes a code that **no base in the archive carries**, and naming
 * that code is what a report upstream can act on. Saying "no base is congruent
 * to a 0.5 × 0.5 column" instead would be true, and would read as geometry
 * rather than as the omission it is. So `no-matching-base` is claimed only when
 * the code really is absent from the base range, which keeps the answer honest
 * in the case that does not exist yet: a topper whose code *is* carried by bases,
 * of a shape those bases are not.
 *
 * ## Why this returns a code and no longer a `Note`
 *
 * It was `missingBaseNote`, and it built a {@link import('./notes').Note}
 * because rule 1 put one in a bill. Row A3 deleted the insert, so **no bill can
 * carry these three codes any more** — and a `NoteCode` union holding three
 * members nothing emits is the exact failure this series keeps meeting:
 * `billView.ts` would go on rendering copy for a note it can never receive, and
 * the compiler would say nothing.
 *
 * So the three left `NoteCode` and this returns the classification directly.
 * Both surviving consumers — `src/generator/placement/corpus.test.ts`, which
 * asserts the 86 / 31 / 260 split against the live corpus, and
 * `src/builder/panels/billView.ts` — asked a corpus question and read
 * `note.code` off the answer, so each is one property access from working and a
 * compile error until it is made.
 */
export function baseGap(tile: CatalogRecord, index: AssemblyIndex): BaseGap | undefined {
  // Lock-independent by construction: a candidate pool is empty or it is not,
  // and which member wins cannot decide whether one exists. Asked with no
  // preference so the answer cannot be read as being about one.
  if (matchBase(tile, index, undefined) !== undefined) return undefined

  const codeUnanswered = tile.sizeCode !== undefined && !index.basesBySizeCode.has(tile.sizeCode)
  if (footprintKey(tile.foot) !== undefined) {
    return codeUnanswered ? 'no-matching-base' : 'no-congruent-base'
  }
  if (tile.sizeCode === undefined) return 'base-unmatchable'
  // No footprint, so the code was the only key — and it did not join. Either no
  // base carries it, or the bases that do disagree about what shape they are,
  // which `candidatesFor` refuses to guess at. Both are `no-matching-base`: the
  // archive holds no base this topper can be matched to.
  return 'no-matching-base'
}
