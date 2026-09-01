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
 *   1. **The one hard rule.** Every `connection|openforge` piece gets a base
 *      line item, auto-inserted. It is enforced by *adding* a part.
 *   2. **Everything else informs.** No condition in this module rejects a
 *      placement. §7: "Compatibility informs; it never refuses a placement."
 *      Refusal would need trustworthy per-edge connector data, and the corpus
 *      has none — see `notes.ts`.
 *   3. **Never join a base to a topper on the `build|` tag.** Zero bases carry
 *      `build|wall on tile` while 863 tiles use that system, 857 of them
 *      toppers. A build join therefore returns *no base* for every one of them,
 *      and the symptom — a missing base — is indistinguishable from missing
 *      data. `assembly.test.ts` asserts the 857-against-0 split so nobody
 *      reintroduces it as an optimisation.
 *
 * Resolution is a function of the placed tile and the lock preference only. `x`,
 * `z` and `rotation` do not change what you print, so they are carried through
 * untouched for the canvas and never read here.
 */
import type { CatalogRecord } from '@/catalog'
import type { LockSystem, Placement } from '@/store'

import type { AssemblyIndex, PrintOption } from './assemblyIndex'
import { PRINT_OPTIONS } from './assemblyIndex'
import { footprintKey } from './footprint'
import type { Note } from './notes'
import { note } from './notes'

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
  /** Which key joined. `sizeCode` is the primary; `footprint` is the fallback. */
  key: 'sizeCode' | 'footprint'
  /** The key's value — the size code, or the canonical footprint key. */
  on: string
  /** How many bases satisfied the key. Ranges 3–132 for size codes. */
  candidates: number
  /**
   * Which of the three products the chosen base is. `plain` for 3,769 of 3,769
   * openforge toppers under openlock; the old ranking made it `topless` for
   * 2,983 of them and said nothing.
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
  /** The base's footprint shape equals the topper's. Available for 92.8% of coded toppers. */
  shapeAgrees: boolean
  /** The base shares a non-`base` kind bucket with the topper (`base+wall` under a wall). */
  kindAgrees: boolean
  /** Texture roots are equal. Only reachable for 61.1% of coded toppers — see {@link MATCH_WEIGHTS}. */
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
 *     system does not. Ranking it above the shape and texture criteria is what
 *     makes the guarantee unconditional: within one candidate set (one size code,
 *     or one congruent footprint) a `topless` base can only win if **every**
 *     plainer candidate fails on the lock, and that case is disclosed by name.
 *   - **`shape`** because a shape-agreeing base exists for 1,856 of the 1,999
 *     coded toppers (92.8%) — high enough to insist on when available.
 *   - **`kind`** as the `base+wall`-under-a-wall signal. Weaker than shape
 *     because 566 toppers carry no kind bucket at all, so it is silent for them.
 *   - **`texture` last, and it can only ever be a tie-break.** Bases cover 15
 *     texture roots against the toppers' 23, and only 1,221 of 1,999 coded
 *     toppers (61.1%) can be given a texture-matched base *at all*. Weighting it
 *     higher would trade a base that locks for a base that matches the colour.
 *
 * Below the whole scale sits the index's `bytes`-ascending order, reached only
 * when two candidates score identically. It used to be the *only* thing
 * separating most candidates, which is how 79.1% of auto-inserted openlock bases
 * came to be topless: the topless print of a base is its smallest file.
 */
export const MATCH_WEIGHTS = Object.freeze({ lock: 32, option: 8, shape: 4, kind: 2, texture: 1 })

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

interface Candidates {
  key: 'sizeCode' | 'footprint'
  on: string
  records: readonly CatalogRecord[]
}

/**
 * The bases that could sit under this topper, and the key that found them.
 *
 * Size code first, footprint second, and **never both** — a topper with a code
 * whose code has no base does *not* fall through to a footprint match. That is
 * deliberate: the code is a functional determinant of width (see `sizeCode.ts`)
 * and a topper that publishes one is telling us which base family it belongs
 * to. Falling back would answer a different question and report it as a success,
 * hiding the 129-topper gap that §7 wants surfaced.
 */
function candidatesFor(tile: CatalogRecord, index: AssemblyIndex): Candidates | undefined {
  if (tile.sizeCode !== undefined) {
    const records = index.basesBySizeCode.get(tile.sizeCode)
    return records === undefined ? undefined : { key: 'sizeCode', on: tile.sizeCode, records }
  }
  const foot = footprintKey(tile.foot)
  if (foot === undefined) return undefined
  const records = index.basesByFootprint.get(foot)
  return records === undefined ? undefined : { key: 'footprint', on: foot, records }
}

function kindsAgree(tile: CatalogRecord, base: CatalogRecord): boolean {
  // `base` itself is on every base by definition, so it carries no information.
  return base.kinds.some((kind) => kind !== 'base' && tile.kinds.includes(kind))
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
 */
function matchBase(
  tile: CatalogRecord,
  index: AssemblyIndex,
  lock: LockSystem | undefined,
): { base: CatalogRecord; match: BaseMatch } | undefined {
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
    if (base.foot.shape === tile.foot.shape) score += MATCH_WEIGHTS.shape
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
      shapeAgrees: best.foot.shape === tile.foot.shape,
      kindAgrees: kindsAgree(tile, best),
      textureAgrees: best.texture !== undefined && best.texture === tile.texture,
      lockAgrees: lock === undefined || best.conn.includes(lock),
    },
  }
}

/* ----------------------------------------------------------------- resolution */

/**
 * Resolve one placement into its parts and its notes.
 *
 * Total: every input produces a `ResolvedPlacement`. Nothing throws and nothing
 * is refused — the only way to get an empty part list is an id the catalog does
 * not hold.
 */
export function resolvePlacement(
  placement: Placement,
  index: AssemblyIndex,
  options: AssemblyOptions = {},
): ResolvedPlacement {
  const tile = index.byId.get(placement.tileId)
  const notes: Note[] = []

  if (tile === undefined) {
    const message = `${placement.tileId} is not in this catalog build; it may have been retired.`
    notes.push(note('unknown-tile', message, placement.tileId))
    return { placement, tile: undefined, parts: [], notes }
  }

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
    appendBase(tile, index, options.lock, parts, notes)
  }

  return { placement, tile, parts, notes }
}

/** Rule 1, and the three ways the corpus can fail to satisfy it. */
function appendBase(
  tile: CatalogRecord,
  index: AssemblyIndex,
  lock: LockSystem | undefined,
  parts: AssemblyPart[],
  notes: Note[],
): void {
  const matched = matchBase(tile, index, lock)

  if (matched === undefined) {
    notes.push(missingBaseNote(tile))
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
    const message = `${base.name} does not offer ${lock}; no ${lock} base carries ${match.on}.`
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

/** `size code A`, `footprint rect:2x2` — the same words `missingBaseNote` uses. */
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
  if (match.shapeAgrees) reasons.push('footprint agrees')
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
 * is a base the corpus should have and does not (129 toppers), a
 * `no-congruent-base` is a shape nothing supports (21 toppers, all thin strips),
 * and a `base-unmatchable` is a topper with neither key to match on (444
 * toppers) — a data problem in the *topper*, not in the bases. Collapsing them
 * would report 594 identical warnings and hide which of the three anyone can
 * act on.
 */
function missingBaseNote(tile: CatalogRecord): Note {
  if (tile.sizeCode !== undefined) {
    return note(
      'no-matching-base',
      `no base in the catalog carries size code ${tile.sizeCode}, so ${tile.name} has no base to sit on.`,
      tile.id,
    )
  }
  if (footprintKey(tile.foot) !== undefined) {
    return note('no-congruent-base', `no base is congruent to ${tile.name}'s footprint.`, tile.id)
  }
  return note(
    'base-unmatchable',
    `${tile.name} carries neither a size code nor a footprint, so no base can be matched to it.`,
    tile.id,
  )
}
