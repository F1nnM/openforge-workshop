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

import type { AssemblyIndex } from './assemblyIndex'
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
 * Ranking weights for base candidates — **strictly decreasing powers of two**,
 * which is the point of the numbers rather than a coincidence.
 *
 * `4 + 2 + 1 = 7 < 8`, so no combination of lower criteria can outvote a higher
 * one: the sum is a lexicographic order written as arithmetic, cheap to compute
 * and cheap to assert. `assembly.test.ts` checks the property directly rather
 * than trusting the comment.
 *
 * The order comes from what the data can actually deliver:
 *
 *   - **`lock` first** because the base *is* the joinery. A base that does not
 *     offer the chosen system does not lock to its neighbours, which is a
 *     build that falls apart rather than a build that looks wrong.
 *   - **`shape`** because a shape-agreeing base exists for 1,856 of the 1,999
 *     coded toppers (92.8%) — high enough to insist on when available.
 *   - **`kind`** as the `base+wall`-under-a-wall signal. Weaker than shape
 *     because 566 toppers carry no kind bucket at all, so it is silent for them.
 *   - **`texture` last, and it can only ever be a tie-break.** Bases cover 15
 *     texture roots against the toppers' 23, and only 1,221 of 1,999 coded
 *     toppers (61.1%) can be given a texture-matched base *at all*. Weighting it
 *     higher would trade a base that locks for a base that matches the colour.
 */
export const MATCH_WEIGHTS = Object.freeze({ lock: 8, shape: 4, kind: 2, texture: 1 })

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
 * Pick a base, or return `undefined` when the corpus holds none.
 *
 * Candidate arrays arrive pre-sorted by print cost (see `assemblyIndex.ts`), and
 * the scan keeps the first candidate at the best score — so ties break on the
 * smaller file and then on catalog path, and the choice is a pure function of
 * the corpus.
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

  for (const base of candidates.records) {
    let score = 0
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

  const added =
    `${tile.name} delegates its joinery to a base; ` +
    `${base.name} was added, matched on ${match.key} ${match.on}.`
  notes.push(note('base-auto-inserted', added, base.id))
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
