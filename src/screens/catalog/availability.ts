/**
 * The availability chips — what an aggregate costs to print, and what it will
 * clip to.
 *
 * Row A3's whole content. A card used to show one file, so its connection chips
 * could just print `CatalogRecord.conn`. An item is now 2.28 files, and the
 * question a browsing user has stopped being "what tags does this file carry"
 * and become two build questions:
 *
 *   1. **How many parts do I print?** — {@link TileAggregate.needsBase}.
 *   2. **Will it join the build I have chosen?** — per lock system.
 *
 * Both are derived, never printed from a tag. That is the difference between
 * these chips and the ones they replace: `conn` throws the *position* segment
 * away, and A1 measured what that costs — 1,283 of the 4,363 toppers carry a
 * lock on their **side** and none on their underside, so a card reading `conn`
 * advertised dragonlock on 1,283 tiles that do not offer it where it matters.
 *
 * ## Magnetic is never a side connector, so side-ness is a *state* and not a chip
 *
 * The obvious layout is two rows of three chips — underside openlock /
 * dragonlock / magnetic, then side openlock / dragonlock / magnetic. Measured
 * over the emitted index, the bottom-right cell of that grid is **0 aggregates**:
 *
 * | system | underside (self-sufficient) | side, and not underside |
 * | ------ | --------------------------- | ----------------------- |
 * | openlock   | 1,497 (39.2%) | 293 (7.7%)  |
 * | dragonlock |   359 (9.4%)  | 468 (12.2%) |
 * | magnetic   |   255 (6.7%)  | **0**       |
 *
 * Magnets are glued into a pocket in the *base* of a piece; nothing in this
 * corpus mounts one on a side wall. So a symmetrical grid would ship a control
 * that can never light, which is worse than not shipping it: a permanently dark
 * cell reads as "this tile does not do magnetic sides" rather than as "no tile
 * does".
 *
 * What is here instead: **one chip per lock system, in two states.**
 * {@link LockReach} is `'underside'` (print one part and it locks into the grid)
 * or `'sides'` (the mesh joins its neighbours in this system but meets the table
 * on something else). Magnetic simply never reaches `'sides'` — the asymmetry is
 * a property of the state vocabulary, which `corpus.test.ts` asserts, rather
 * than a hole in the layout. `'underside'` wins when a system is on both faces,
 * which happens on 555 aggregates for openlock and, measured, **never** for
 * dragonlock or magnetic.
 *
 * ## The row is never empty, and that is exhaustive rather than lucky
 *
 * 2,027 aggregates (53.0%) offer no lock chip at all. 1,878 of them are
 * `needsBase: 'always'`, so the base chip carries them. The remaining **149**
 * need no base *and* name no lock, and they are exactly **93 insert-only + 56
 * joinery-untagged**, with **zero** left over — which is why {@link JoineryNote}
 * has those two values and no `'none'`. `availability.test.ts` asserts the
 * partition and `corpus.test.ts` asserts that all 3,822 aggregates produce at
 * least one chip.
 *
 * ## `filament` is deliberately not a chip
 *
 * `connection|side|filament` is the side system on 114 records — one per design,
 * so 114 aggregates — a printed-in-place filament hinge rather than a lock. It is
 * left off because {@link LockSystem} is the build's *choice* of lock and a
 * fourth chip there would invent a fourth option the builder cannot be set to.
 * Every one of the 114 is `needsBase: 'always'`, so the base chip carries them
 * and none loses its only chip to the omission — including the 26 that name no
 * lock system at all.
 *
 * ## Why the labels live here and the budget is a test
 *
 * A card is a fixed height — `TileGrid.tsx` explains why `VirtuosoGrid` requires
 * it — so the strip is a fixed **two-line** box, and a longer label is a
 * silently clipped chip rather than a visibly broken layout. Over the whole
 * corpus these labels produce only **17 distinct rows**, worst case 4 chips and
 * 60 characters. {@link CHIP_BUDGET} states the box's capacity and
 * `availability.test.ts` fails the build when a relabel exceeds it.
 */
import type { BaseRequirement, TileAggregate } from '@/catalog'
import type { LockSystem } from '@/store'
import { LockSystem as LockSystemSchema } from '@/store'

import { connLabel } from './format'

/* -------------------------------------------------------------- vocabulary */

/**
 * The lock systems, in chip order.
 *
 * `LockSystem.options` rather than a fourth hand-written copy of the three
 * words. A1's docblock is explicit that the aggregate layer holds no lock
 * vocabulary and that "a consumer that wants per-lock chips intersects
 * `selfSufficientConn` with its own list"; the list that belongs to a *card* is
 * the one the builder can be set to, because the chip answers "will this join
 * my build". That is `@/store`'s enum and nothing else.
 *
 * The order is also self-sufficiency descending — 1,497 / 359 / 255 — so the
 * commonest chip is leftmost and a column of cards reads down its left edge.
 */
export const LOCK_CHIP_ORDER: readonly LockSystem[] = Object.freeze([...LockSystemSchema.options])

/**
 * Which face of the mesh carries a system.
 *
 * Not a boolean pair, because the two are ranked rather than independent: a tile
 * that locks underneath *and* at the sides is offered as `'underside'`, since
 * that is the stronger claim and the one that decides whether the user prints
 * one part or two.
 */
export type LockReach = 'underside' | 'sides'

/** One lock system's chip. Absent from {@link Availability.locks} when neither face carries it. */
export interface LockChip {
  readonly lock: LockSystem
  readonly reach: LockReach
}

/**
 * The verdict for an item that needs no base and names no lock.
 *
 * Two values, and the corpus proves the pair is exhaustive: of the 149 such
 * aggregates, 93 are `insert-only` and 56 are `joineryUntagged`, summing exactly.
 *
 *   - `'insert'` — every variant is fitted into another piece (a door into a
 *     doorway, a window into a dormer), so it never meets the grid and has no
 *     lock to name. 94 aggregates; one of them also carries a lock chip.
 *   - `'untagged'` — no variant declares a system on its underside at all. 93
 *     aggregates, every one `integrated-only`. A1's docblock records why the
 *     honest verdict is *unknown* and not *incompatible*: 33 of the underlying
 *     records name a lock in the filename only, 18 of those a magnet size that
 *     exists nowhere in the tag vocabulary.
 */
export type JoineryNote = 'insert' | 'untagged'

/** Everything the strip renders, structured. {@link availabilityChips} flattens it. */
export interface Availability {
  /** Always present — every aggregate has exactly one answer. */
  readonly base: BaseRequirement
  /** The lock chips, in {@link LOCK_CHIP_ORDER}. 0 to 3 of them. */
  readonly locks: readonly LockChip[]
  /** A verdict where there is no lock to state. `undefined` on 3,635 aggregates. */
  readonly note: JoineryNote | undefined
}

/* -------------------------------------------------------------- derivation */

/**
 * One aggregate's availability.
 *
 * Pure, total and cheap — three array scans over lists of at most five strings.
 * Called once per rendered card rather than memoised: the grid mounts about
 * forty of them.
 *
 * At most **one** note, and `'insert'` wins where both predicates hold. They are
 * independent predicates — `insert-only` is about the variant class,
 * `joineryUntagged` about the bottom systems — so an aggregate satisfying both is
 * possible in principle. Measured, none does: every one of the 93 untagged
 * aggregates is `integrated-only`, which `corpus.test.ts` asserts, so the
 * precedence is currently unreachable rather than lossy. It is stated anyway
 * because `'insert'` is a claim about the whole item and `'untagged'` only about
 * what the tags failed to say, and the stronger claim is the one to show.
 */
export function availabilityOf(aggregate: TileAggregate): Availability {
  const locks: LockChip[] = []
  for (const lock of LOCK_CHIP_ORDER) {
    if (aggregate.selfSufficientConn.includes(lock)) locks.push({ lock, reach: 'underside' })
    else if (aggregate.sideConn.includes(lock)) locks.push({ lock, reach: 'sides' })
  }

  return {
    base: aggregate.needsBase,
    locks,
    note: aggregate.variantClass === 'insert-only' ? 'insert' : aggregate.joineryUntagged ? 'untagged' : undefined,
  }
}

/* ------------------------------------------------------------------ labels */

/**
 * The base-requirement chip, which is on every card.
 *
 * Phrased as what the user does, not as the tag: A1's `needsBase` is derived
 * from `layer`, and "integrated base" over-claims for two thirds of the cases —
 * for a wall or a column self-sufficiency means the OpenLOCK footer is part of
 * *this* mesh, and for a roof panel that it clips to whatever is under it.
 * "Needs a base" / "No base needed" is the one phrasing true of all of them.
 *
 * `'either'` is the merged pair the whole aggregation exists for — 931
 * aggregates that offer both a topper and a base-integrated print — so it says
 * the choice exists rather than picking a side. The variants table (row A5) is
 * where the choice is made.
 */
const BASE_LABELS: Readonly<Record<BaseRequirement, string>> = {
  always: 'Needs a base',
  never: 'No base needed',
  either: 'Base optional',
}

export function baseRequirementLabel(base: BaseRequirement): string {
  return BASE_LABELS[base]
}

/**
 * The sentence a screen reader gets for the base chip.
 *
 * The visible chip is three words on a 215px card; the accessible name carries
 * the claim in full, because "Base optional" out of context does not say
 * *optional between what*.
 */
const BASE_HINTS: Readonly<Record<BaseRequirement, string>> = {
  always: 'every way of printing this needs a separately printed base',
  never: 'prints as one part, with its own joinery',
  either: 'available both as one part and as a topper for a separate base',
}

export function baseRequirementHint(base: BaseRequirement): string {
  return BASE_HINTS[base]
}

/**
 * A lock chip's visible label.
 *
 * The system's own spelling comes from {@link connLabel}, which already holds
 * `OpenLOCK` / `DragonLock` / `Magnetic` as the people who made them write them.
 * The `'sides'` state appends a word rather than a glyph: the fill difference
 * between the two states is what a scanning eye reads, and a legend-less glyph
 * would make the distinction undiscoverable for the reader who needs it most.
 */
export function lockChipLabel({ lock, reach }: LockChip): string {
  const system = connLabel(lock)
  return reach === 'underside' ? system : `${system} sides`
}

/** The lock chip's accessible sentence. */
export function lockChipHint({ lock, reach }: LockChip): string {
  const system = connLabel(lock)
  return reach === 'underside'
    ? `locks into a ${system} build on its own underside`
    : `joins its neighbours with ${system}, but meets the table on something else`
}

const NOTE_LABELS: Readonly<Record<JoineryNote, string>> = {
  insert: 'Insert',
  untagged: 'Joinery untagged',
}

export function joineryNoteLabel(note: JoineryNote): string {
  return NOTE_LABELS[note]
}

const NOTE_HINTS: Readonly<Record<JoineryNote, string>> = {
  insert: 'fits into another piece rather than onto the grid, so it names no lock',
  untagged: 'no variant records what it connects with — unknown, not incompatible',
}

export function joineryNoteHint(note: JoineryNote): string {
  return NOTE_HINTS[note]
}

/* ------------------------------------------------------------------- chips */

/** What the strip renders, in order. */
export interface AvailabilityChip {
  /** Stable across renders and unique within a strip, for React's key. */
  readonly key: string
  /** Which device this is, for the stylesheet. */
  readonly kind: 'base' | 'lock' | 'note'
  /**
   * The chip's visual state.
   *
   * `'need'` and `'choice'` are the base chip's two shapes; `'underside'` and
   * `'sides'` are a lock's; `'note'` is a verdict. Carried as data rather than
   * as a class name so `catalog.css` holds every colour and the component holds
   * none.
   */
  readonly state: 'need' | 'choice' | 'have' | 'underside' | 'sides' | 'note'
  readonly label: string
  /** The clipped sentence appended to the chip's accessible name. */
  readonly hint: string
}

/**
 * The strip, flattened and ordered: the base requirement, the lock chips, the
 * verdict.
 *
 * Never empty — see the module docblock for why the three sources partition the
 * corpus — and never more than four chips.
 */
export function availabilityChips(availability: Availability): readonly AvailabilityChip[] {
  const chips: AvailabilityChip[] = [
    {
      key: `base:${availability.base}`,
      kind: 'base',
      state: availability.base === 'always' ? 'need' : availability.base === 'either' ? 'choice' : 'have',
      label: baseRequirementLabel(availability.base),
      hint: baseRequirementHint(availability.base),
    },
  ]

  for (const chip of availability.locks) {
    chips.push({
      key: `lock:${chip.lock}`,
      kind: 'lock',
      state: chip.reach,
      label: lockChipLabel(chip),
      hint: lockChipHint(chip),
    })
  }

  if (availability.note !== undefined) {
    chips.push({
      key: `note:${availability.note}`,
      kind: 'note',
      state: 'note',
      label: joineryNoteLabel(availability.note),
      hint: joineryNoteHint(availability.note),
    })
  }

  return chips
}

/**
 * What the fixed-height strip can hold, and the arithmetic behind it.
 *
 * The strip is two lines of `.of-avail` chips (`catalog.css`). At the contract's
 * narrowest card — `minmax(215px, 1fr)` less the card's 2 × 9px of padding — a
 * line is 197px, so the box holds **394px** of chip. One chip costs its label at
 * 9px IBM Plex Mono (0.6em advance, so 5.4px a character) plus 8px of horizontal
 * padding and border, and the chips are separated by 3px.
 *
 * The measured worst case over all 3,822 aggregates is **4 chips / 60
 * characters** — `No base needed · OpenLOCK sides · DragonLock sides · Joinery
 * untagged`, 15 aggregates — which costs 60 × 5.4 + 4 × 8 + 3 × 3 = **365px**,
 * inside the 394px box. The second-worst row is 47 characters and the 17th and
 * commonest is 12.
 *
 * These numbers are a *budget*, not a description: `availability.test.ts`
 * re-derives the worst case from the labels above and fails when a relabel
 * exceeds it, because the failure mode of overflowing is a chip clipped out of
 * sight rather than a layout that visibly breaks.
 */
export const CHIP_BUDGET = Object.freeze({
  /** Chips the strip may hold. */
  chips: 4,
  /** Characters across all of a strip's labels. */
  characters: 60,
  /** Rendered width the two-line box provides, in px, at the narrowest card. */
  widthPx: 394,
  /** Per-character advance at the chip's type size, in px. */
  characterPx: 5.4,
  /** Horizontal padding one chip adds, in px. */
  chipPaddingPx: 8,
  /** Gap between two chips, in px. */
  gapPx: 3,
})

/** The width one strip costs, under {@link CHIP_BUDGET}'s metrics. */
export function chipStripWidth(chips: readonly AvailabilityChip[]): number {
  if (chips.length === 0) return 0
  const characters = chips.reduce((total, chip) => total + chip.label.length, 0)
  return (
    characters * CHIP_BUDGET.characterPx +
    chips.length * CHIP_BUDGET.chipPaddingPx +
    (chips.length - 1) * CHIP_BUDGET.gapPx
  )
}
