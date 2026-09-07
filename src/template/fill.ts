/**
 * The **default-fill solver**: a template's parts, filled in one click.
 *
 * ## The measurement this file exists because of
 *
 * Placing a template must be one decision, not five. Resolved cold over the 40
 * shipped recipes the two `(Any, …)` parts offer **308** and **428** items, so a
 * recipe that asked before it drew anything would ask a user to pick out of a
 * 428-card grid to get one wall on the grid. So the parts are walked and filled,
 * and the whole substance of this row is that **the obvious walk does not
 * work**:
 *
 * | policy | recipes completed |
 * | --- | ---: |
 * | first candidate in declared order | **24 of 40** |
 * | first candidate that does not empty a still-open sibling | **40 of 40** |
 *
 * Re-measured here rather than quoted from the plan — `measure.ts` runs both
 * policies over the live archive and `corpus.test.ts` asserts the pair. The
 * failures are not spread: **all sixteen are the `base` slot of the sixteen
 * modular wall recipes**, each of which has **48 candidate files with nothing
 * chosen and 0 once its siblings are picked greedily** (305 for the drain).
 * Every one of the 128 parts has candidates in isolation — minimum 5, **zero
 * dead ends** — so the greedy rule fails on *ordering*, not on coverage.
 *
 * The mechanism is `src/composition/config.ts`'s `constrain`, working exactly as
 * intended: a sibling's selection contributes its own tags to the parts that
 * inherit under the same prefix, and adding a `require` tag can only shrink a
 * candidate set. The modular `base` part inherits `connection|side` from the
 * wall and the floor, so a wall picked without regard for the base leaves the
 * base with nothing that carries both sides' connectors.
 *
 * ## The policy, and why the one-step check is enough
 *
 * {@link solveTemplateFills} walks the parts in **declared order** and takes the
 * first candidate that does not empty a still-open sibling, preferring
 *
 *   1. the room's design family — {@link FillContext.family}, a `texture` root;
 *   2. `selectVariant`'s preferred variant, through `@/assembly`'s
 *      {@link selectVariantForLock} so the lock preference and `PRINT_OPTIONS`
 *      are both applied and neither is spelled twice;
 *   3. ascending item address.
 *
 * That is a **one-step** lookahead: it guarantees every still-open part has at
 * least one candidate after the pick, not that the remainder is jointly
 * satisfiable. It is not backtracking and it is not a solver in the CSP sense,
 * and the reason it is enough is measured rather than assumed — 40 of 40, with
 * **0 of 148 post-pick observations emptying a part**, so the walk is monotone
 * on this corpus. `measure.ts` also runs a backtracking walk over the same 40
 * for the comparison: it completes the same 40 and visits more nodes, so the
 * extra machinery buys nothing here. If a future fixture defeats the one-step
 * rule the comparison is already in place to say so.
 *
 * ## The `base` slot is ranked, not ordered
 *
 * Every recipe declares `base` last, so by the time the walk reaches it there is
 * nothing still open to empty and the greying rule has nothing to say. What
 * decides it is `@/assembly`'s {@link rankBases} — row A3's five-criterion
 * ladder, kept alive as this row's ranking surface — over the candidate set
 * `@/composition` produced, with the piece the base stands under as the
 * reference. That is not polish: the ladder puts the **print option** above a
 * bytes-ascending tie-break, and it is the difference between a `plain` base and
 * a `topless` one, which is a base with no top surface. `corpus.test.ts`
 * measures what each policy picks for the 40 base slots.
 *
 * Which sibling is the reference is this module's decision, and `rankBases`
 * says so explicitly. It is the fill of the layout's {@link TemplateLayout.cell}
 * — the floor — because row B2 measured the base congruent to the floor cell on
 * **1,213 of 1,213** walked combinations, and falls back to the first filled
 * part that {@link SlotRule.restsOn} this slot.
 *
 * ## Three ways a slot ends up with nothing, told apart
 *
 * A slot with no fill still places — contract **C-g**, and §3.2 is explicit:
 * leave it empty, mark it *needs a choice*, place anyway. But "no candidate" is
 * three different situations and a surface that showed one message for all three
 * would be wrong twice. {@link SlotGap} names them: an archive gap
 * (`no-candidate`, **0 of 128** template parts), a set the siblings closed
 * (`closed-by-siblings`, which is the 16 failures above and what this policy
 * exists to avoid), and a constraint naming a tag the index does not hold
 * (`unknown-ref` — empty across the corpus today, and reachable the moment a
 * caller asks for a size the corpus has no tag for: `size|width` has no `3`).
 *
 * ## Size is layered on, and it arrives two ways
 *
 * The instance's size is a **parameter**, not part of the family key (B3: 52
 * families keyed without it, 217 to 277 with it), so it is narrowed onto the
 * slots at fill time and never stored. Two fields, because the two kinds of
 * template answer differently:
 *
 *   - {@link FillContext.cell} — a grid cell, spread over the slots by
 *     `size.ts#slotSizePredicate` and `sizeRefs`, B3's derivation from B2's
 *     anchor. This is the path for a template with a **layout**: a 2x2 recipe
 *     wants a 2x2 floor and a 2-unit *run* of wall, which one ref list cannot
 *     say.
 *   - {@link FillContext.size} — exact `size|` refs applied to every slot. This
 *     is row **B4**'s own control, and it is here because B4 landed mid-row and
 *     **all 51 of its generated families have exactly one part and no layout**,
 *     deliberately and with four measurements behind it — so **0 of 51 have a
 *     convention** and `cell` would have been inert on every palette row C1 is
 *     building. Measured over B4's shipped domain: **350 of 350 size options
 *     fill, and 51 of 51 families fill with no size asked for at all.**
 *
 * There is no second spelling of `size|width|<n>` in this file either way — B3
 * asks to be consulted before a ref is authored, and B4's table is the same
 * vocabulary because both read tags the corpus already carries.
 *
 * **A slot with no size requirement is not a slot with no candidates.** A
 * `corner` anchor resolves to `{ kind: 'none' }` and contributes no refs, and 8
 * of B4's 51 families offer nothing but *any size* — an empty domain, which B3
 * predicted for 5 of them. Every one of those paths is a `corpus.test.ts`
 * assertion rather than a comment.
 *
 * ## What this file does not do
 *
 * **It does not write.** Every fill it chooses is `auto` by construction — it
 * returns tiles and the caller writes them with `@/store`'s `fillSlot`, which is
 * where the pinned guard lives. `relock.ts` is the driver that does the writing,
 * and the lock re-solve is the other half of this row.
 *
 * **It does not place.** A fill is *what*, and row B2's `offsets.ts` is *where*
 * — arithmetic over the chosen fills' own footprints, because a slot has no
 * fixed footprint to store one for. A consumer calls `placeTemplateSlots` over
 * these fills, and `corpus.test.ts` runs that composition over all 40 recipes:
 * the default fill **closes on 34 of 40**, is `undecidable` on the 4 internal
 * corners that have no wall to close, and `fails` on the 2 external-corner
 * `single_piece` recipes whose mitre is in no tag. No ordering fixes those two,
 * so a one-click placement can arrive carrying a `SlotDoubt` and the disclosure
 * is C1's and C3's.
 *
 * **It does not call `baseGap`.** Row A3 and row C4 both kept it exported for
 * this row, and there is no site for it. `baseGap` classifies the archive's base
 * gap over the **footprint / `sizeCode`** join `matchBase` uses; a template's
 * `base` slot is a **tag** intersection, and **0 of the 128 template parts is
 * ever empty**, so the only empty base slot this solver can produce is one a
 * pinned sibling closed. Answering that with a sentence about footprint
 * congruence would be `baseMatch.ts`'s own warning made real — *"a true-looking
 * sentence about a join that never happened"*. It stays exported and uncalled,
 * and this paragraph is why.
 */
import type { CatalogRecord, TileId } from '@/catalog'
import type { AssemblyIndex, AssemblySlot, AssemblyTemplate, BaseRanking } from '@/assembly'
import { rankBases, selectVariantForLock } from '@/assembly'
import type { CompositionIndex, SiblingSelection, SlotCandidates } from '@/composition'
import { resolveSlotTags } from '@/composition'
import type { LockSystem } from '@/store'

import type { SlotName, TemplateLayout } from './rules'
import { layoutFor } from './rules'
import type { GridSize } from './size'
import { cornerSpanOf, sizeRefs, slotSizePredicate } from './size'

/* -------------------------------------------------------------------- context */

/**
 * Everything the solver needs beside the template itself.
 *
 * `composition` and `lock` are spelled exactly as `@/assembly`'s
 * `AssemblyContext` spells them, so an **`AssemblyContext` is assignable to
 * this** and a caller that already built one for the bill passes it straight in.
 * The two extra members are the two preferences a bill has no opinion about.
 */
export interface FillContext {
  /**
   * `@/composition`'s inverted index over the same catalog as the assembly
   * index.
   *
   * A parameter and never built here, for the reason every other consumer of it
   * gives: it is a 409,432-byte index and about 11 ms of work, and
   * `createCompositionIndex` is pure, so the caller memoises one and passes it.
   */
  readonly composition: CompositionIndex
  /**
   * The global lock preference, or absent for "no preference".
   *
   * Read in two places and nowhere else: `selectVariantForLock` uses it to pick
   * the file within an item, and {@link rankBases} scores it above every other
   * criterion for a `base` slot. Absent means neither applies — not `openlock`.
   * The default lives in the store and reading it here would apply a preference
   * a caller had deliberately declined to state.
   */
  readonly lock?: LockSystem | undefined
  /**
   * The room's design family — a `texture` root as `CatalogRecord.texture`
   * carries it (`dungeon_stone`, `cut-stone`, `towne`, …).
   *
   * A **preference and never a filter**: it reorders the candidates and the
   * greying rule still decides, so a family that would close a sibling loses to
   * one that does not, and a part whose candidates hold none of the family still
   * fills. §1.6's measurement is what makes this the right axis — the examples
   * the plan lists are `texture|` roots verbatim, 37 of them, 36 reachable as
   * `record.texture`.
   *
   * Compared at the **item** level, off `TileAggregate.texture`: row A1's
   * collapse is lossless on texture, so every variant of an item answers the
   * same way and a per-file comparison would ask 3,822 more questions for the
   * same answer.
   *
   * ## Who sets it, and what it moves — row D6
   *
   * Nothing set it for three rows, and the defect that produced is one corner
   * built out of **four** stone types: an `aztlan` column, two `cut-stone`
   * walls, an `aztlan` floor and a `plain` base, all `complete: true`. It is now
   * `@/store`'s `WorkshopState.design`, written by `@/ui/design-picker` and
   * threaded by every solve site — the click's filler, `relock.ts`' scene
   * re-solve, and the re-solve a design change fires.
   *
   * **What it actually reaches, measured over the live archive rather than
   * assumed** (`@/ui/design-picker/corpus.test.ts` recomputes all of it):
   *
   * | family | slots honoured of 128 | recipes completed |
   * | --- | ---: | ---: |
   * | `dungeon_stone` | **89** | 40 of 40 |
   * | `cut-stone` | **89** | 40 of 40 |
   * | `towne` | 66 | 40 of 40 |
   * | `aztlan` | 49 | 40 of 40 |
   * | 22 of the 36 roots | **0** | 40 of 40 |
   *
   * Two things follow, and both are the reason the fallback contract above is
   * worded the way it is. **The 88 non-base slots are honoured 88 of 88** by
   * either of the top two families, so a room genuinely does come out in one
   * design. And **the `base` slot honours a design on 1 of 40** — not a bug and
   * not this preference failing: **38 of the 40 base slots have only `plain`
   * candidates**, so there is nothing in the family to prefer and
   * {@link rankBases}' five-criterion ladder decides, which is row A3's
   * deliberate behaviour. Setting a design never empties a slot and never costs
   * a completion: 40 of 40 under every one of the 36 roots.
   */
  readonly family?: string | undefined
  /**
   * The instance's grid cell, for a template B2 has a **layout** for.
   *
   * Resolved per slot through B3's anchor derivation — congruence for a `cell`
   * anchor, the anchored face's run for an `edge`, nothing for a `corner` — so
   * one cell narrows a five-slot recipe correctly, which a single ref list
   * cannot: a 2x2 recipe wants a 2x2 floor and a 2-unit *run* of wall, and those
   * are different refs.
   *
   * The 40 shipped recipes pin their own sizes in `require` already
   * (`size|width|2`), so passing the cell they imply changes nothing and passing
   * a different one empties the slot rather than silently placing the wrong
   * size. Absent means "whatever the recipe says".
   */
  readonly cell?: GridSize | undefined
  /**
   * Exact `size|` refs to require of **every** slot — row B4's own size control.
   *
   * ## Why this exists beside `cell`, and what it corrects
   *
   * `cell` alone was this row's reading of the plan: B4 would generate the
   * families, B2's layout would spread one cell over their slots, and §2.4's
   * *"size is a slot parameter"* would be satisfied by the anchor derivation.
   * **That reading was wrong about the families, and B4 is right.** Its 51
   * generated families have **exactly one part** each — 19 `wall`, 17 `floor`, 6
   * `column`, 3 `stair`, 2 `riser`, 2 `roof`, 1 `decor`, 1 `base` — for four
   * measured reasons it sets out under *"One slot per family, and the
   * alternative is a defect"*, the first of which is this row's own finding: a
   * one-slot family has no sibling to empty, so it cannot fail a walk at any
   * depth. It also declines a layout deliberately, because B2's three outputs
   * are all constants for one slot at the origin.
   *
   * So **0 of 51 have a part-name set `rules.ts` has a convention for**, no
   * anchor exists, and `cell` narrows *nothing* on any palette row C1 is
   * building. The size control would have been inert exactly where it is the
   * whole interaction.
   *
   * B4 ships the domain instead, as `GENERATED_FAMILY_SIZES`: per family, a list
   * of `{ label, tags }` whose tags are exactly `size|width|<n>` and
   * `size|depth|<n>` — **350 options over the 51 families**, and the same
   * spelling `size.ts#sizeRefs` produces, because both read the tags the corpus
   * already carries. So this field takes that list and appends it, and the two
   * paths cannot drift into two vocabularies.
   *
   * **Family-wide is correct only because the family has one slot.** Applying
   * one ref list to every slot of a *multi*-slot recipe would require the wall
   * and the floor to carry the same size tags, which is the mistake `cell`
   * exists to avoid — B3 measured that an `edge` slot wants a run and a `cell`
   * slot a congruence. Both may be given; the refs are unioned, and a caller
   * that gives both for a multi-slot template gets the intersection it asked
   * for.
   */
  readonly size?: readonly string[] | undefined
}

/* --------------------------------------------------------------- the decision */

/**
 * Why a slot has no fill. Three situations, because they are three situations.
 *
 *   - `no-candidate` — the slot's own constraint matches nothing in this
 *     archive, before any sibling is picked. **0 of the 128 shipped template
 *     parts**, minimum 5 candidates, so this needs no UI for templates at all;
 *     it is the accessory-slot case (9 of 1,244) and it reads as an archive gap
 *     rather than a step to take. The **requested size counts as the slot's own
 *     constraint** here — the cold re-resolution behind this classification
 *     carries it — so a size nothing in the archive matches reads as *nothing
 *     is this size* rather than as *change an earlier choice*, which is the
 *     honest reading: no sibling could reopen it.
 *   - `closed-by-siblings` — the slot had candidates and the picks around it
 *     took them all. This is the greedy walk's 16 failures, and the policy
 *     exists to make it unreachable for an unpinned instance; it stays reachable
 *     through a **pinned** fill, which the re-solve must honour even when it
 *     closes a sibling.
 *   - `unknown-ref` — a `require` names a tag the index does not hold, so the
 *     intersection is empty by construction rather than by narrowing. Empty
 *     across the corpus today; reachable by a {@link FillContext.cell} whose
 *     face span has no `size|width` value, of which `3` is one.
 */
export type SlotGap = 'no-candidate' | 'closed-by-siblings' | 'unknown-ref'

/**
 * Which preference settled a fill — a fact about the choice, for a surface that
 * has to disclose an auto-fill rather than hide it (§3.4's seventh cost: *"a
 * plausible room nobody chose"*).
 *
 * `base-ranking` is deliberately not one of the other three: the base slot is
 * decided by a five-criterion ladder whose reasoning is in
 * {@link SlotDecision.base}, and reporting it as "ascending address" because the
 * address broke a tie would be a true-looking sentence about the wrong
 * criterion.
 */
export type FillReason = 'family' | 'preferred' | 'address' | 'base-ranking' | 'pinned'

/** One slot of one instance, solved. Present for every declared slot, filled or not. */
export interface SlotDecision {
  readonly slot: SlotName
  /** The file chosen, or `undefined` — see {@link gap}. */
  readonly tile: TileId | undefined
  /** The record behind {@link tile}. `undefined` whenever the tile is. */
  readonly record: CatalogRecord | undefined
  /** See {@link AssemblySlot.optional}: the resolved reading, never `undefined`. */
  readonly optional: boolean
  /** Candidate **files** at the moment this slot was solved — after the siblings before it. */
  readonly candidates: number
  /** Candidate **items**. Fewer, and usually far fewer: a candidate set is variants of designs. */
  readonly items: number
  /**
   * Candidates passed over because they would have emptied a still-open
   * sibling.
   *
   * The greying rule's work, counted rather than described. **23 over the whole
   * 40-recipe walk**, and every one of them is on a `wall` part of a modular
   * recipe whose `base` would otherwise have been closed.
   */
  readonly skipped: number
  readonly reason: FillReason | undefined
  readonly gap: SlotGap | undefined
  /** Refs naming a tag the index does not hold. Non-empty only with `gap: 'unknown-ref'`. */
  readonly unknownRefs: readonly string[]
  /** Whether the chosen item is in {@link FillContext.family}. `false` when no family was asked for. */
  readonly familyHonoured: boolean
  /**
   * How the base ladder chose, present only on a base slot it decided.
   *
   * `BaseRanking` carries the five facts and deliberately not the score, so a
   * disclosure can say *"plain, code and texture agree, offers your lock"* and
   * cannot render a number with no unit.
   */
  readonly base: BaseRanking | undefined
  /** Candidate queries this slot cost. The unit the scene-scale timing is counted in. */
  readonly queries: number
}

/** One template instance's fills, and how each one was reached. */
export interface TemplateFill {
  /** What to write. One entry per **filled** slot, so it is an incomplete map by design (C-g). */
  readonly fills: Readonly<Record<SlotName, TileId>>
  /** Every declared slot in declared order, filled or not. */
  readonly decisions: readonly SlotDecision[]
  /** Every non-optional slot filled. The per-instance half of the download gate. */
  readonly complete: boolean
  /** Slots left empty, in declared order — §3.2's *needs a choice*. */
  readonly needsChoice: readonly SlotName[]
  /** Candidate queries the whole walk cost. */
  readonly queries: number
}

/* ------------------------------------------------------------ sibling reading */

/**
 * Whether a pick of `sibling` can move `slot`'s candidate set at all.
 *
 * A static read of the grammar, and the whole reason the walk is affordable. A
 * slot is narrowed by a sibling only through a `constrain` entry that both names
 * a `tag` prefix and inherits from that sibling — `siblings` absent means every
 * sibling, a list means those, and `[]` means none, which is
 * `config.ts#inheritedTags`' three states read from the other end. A part with
 * no such entry cannot be emptied by anything, so the walk never resolves it to
 * find out.
 *
 * Measured over the 40 shipped recipes: the walk would otherwise probe **148**
 * `(part, still-open sibling)` pairs — which is exactly the plan's count of
 * post-pick observations — and this filter removes **36 of them (24.3%)**,
 * leaving 112. It is not more because the recipes genuinely are interlocked:
 * **110 of the 128 parts carry a `constrain`** and 30 of those name a
 * `siblings` list.
 *
 * It is a *sound* filter and not a heuristic — a part with no `constrain` entry
 * reading this sibling resolves to the same tag list whatever the sibling holds
 * — and `measure.ts#measureFilterSoundness` checks that against the archive
 * rather than against the reading: every one of the 36 dropped pairs is
 * resolved with and without the pick, and the candidate count is unchanged on
 * **36 of 36**. An optimisation that changed an answer would be a policy change
 * wearing a performance argument.
 */
function readsSibling(slot: AssemblySlot, sibling: string): boolean {
  for (const entry of slot.tags.constrain ?? []) {
    if (!('tag' in entry) || entry.tag === undefined || entry.tag === '') continue
    const from = entry.siblings
    if (from === undefined || from.includes(sibling)) return true
  }
  return false
}

/**
 * The candidate queries the whole 40-recipe walk costs.
 *
 * 128 slot resolutions, the sibling probes the greying rule needs, and the
 * handful of before-counts {@link Exposed.before} resolves lazily. Quoted here
 * because it is the numerator of `relock.ts`'s scene-scale arithmetic — a
 * 250-instance room re-solves at this figure and not at 250 times it — and
 * `corpus.test.ts` recomputes it.
 */
export const SOLVE_QUERIES = 288

/* --------------------------------------------------------------- the ordering */

/** One item's candidate files for one slot, with the ordering keys already read. */
interface Group {
  readonly address: number
  readonly familyMatch: boolean
  readonly tiles: readonly TileId[]
  readonly preferred: TileId | undefined
}

/**
 * The candidate files in preference order: family, then preferred variant, then
 * ascending address.
 *
 * Two levels, because a candidate set is *variants of designs* and the two
 * levels answer different questions — §3.2's (a) and (c) are about which
 * **item**, and (b) is about which **file** of it. Flattened to files at the
 * end because the greying rule is about a file: two variants of one item carry
 * different `connection|side` tags and therefore close different siblings, which
 * is not a hypothetical — the guided flow measured 87 cards whose variants
 * disagree.
 */
function orderedCandidates(
  candidates: SlotCandidates,
  context: FillContext,
  index: AssemblyIndex,
): readonly TileId[] {
  const aggregates = context.composition.aggregates
  const groups = new Map<number, Group>()

  for (const tile of candidates.tiles) {
    const variant = aggregates.byTile.get(tile)
    if (variant === undefined) continue
    const aggregate = aggregates.byDesign.get(variant.design)
    if (aggregate === undefined) continue
    const address = aggregate.address as unknown as number
    const existing = groups.get(address)
    if (existing !== undefined) {
      groups.set(address, { ...existing, tiles: [...existing.tiles, tile] })
      continue
    }
    groups.set(address, {
      address,
      familyMatch: context.family !== undefined && aggregate.texture === context.family,
      tiles: [tile],
      // `selectVariantForLock` is the one right spelling of this question —
      // `PRINT_OPTIONS` supplied, `bottom` set to the lock — and it is a
      // property of the *item*, so it is asked once per group rather than once
      // per file.
      preferred: selectVariantForLock(aggregate, context.lock).variant.id,
    })
  }

  const ordered = [...groups.values()].sort((a, b) => {
    if (a.familyMatch !== b.familyMatch) return a.familyMatch ? -1 : 1
    return a.address - b.address
  })

  const out: TileId[] = []
  for (const group of ordered) {
    const preferred = group.preferred
    if (preferred !== undefined && group.tiles.includes(preferred)) out.push(preferred)
    for (const tile of group.tiles) if (tile !== preferred) out.push(tile)
  }
  // A candidate this catalog's assembly index cannot resolve to a record is not
  // a fill: `rankBases` would have nothing to score and the bill would have
  // nothing to print. It can only happen with two indexes over two catalogs,
  // which `AssemblyContext` already names as the surviving hazard.
  return out.filter((tile) => index.byId.has(tile))
}

/** Whether a chosen item is in the asked-for family. `false` when none was asked for. */
function honoursFamily(context: FillContext, index: AssemblyIndex, tile: TileId): boolean {
  if (context.family === undefined) return false
  return index.byId.get(tile)?.texture === context.family
}

/* ------------------------------------------------------------------ the walk */

/** The state one slot's resolution reads: the template, the fills so far, the counters. */
interface Walk {
  readonly template: AssemblyTemplate
  readonly context: FillContext
  readonly index: AssemblyIndex
  readonly layout: TemplateLayout | undefined
  readonly chosen: Map<string, TileId>
  queries: number
}

/**
 * The sibling selections a resolution reads, **in the template's declared part
 * order**.
 *
 * The order is load-bearing and not cosmetic: `processConfigValues` builds
 * `require` out of insertion-ordered `Set`s, so reading the order off the
 * template rather than off the walk's history makes a resolution a function of
 * the fills and not of how they were reached.
 *
 * `exclude` is optional because the greying probe wants **every** chosen fill,
 * the part being resolved included — it is resolving a *sibling*, not the part.
 */
function siblingsOf(walk: Walk, exclude?: string): readonly SiblingSelection[] {
  const out: SiblingSelection[] = []
  for (const part of walk.template.parts) {
    if (part.name === exclude) continue
    const tile = walk.chosen.get(part.name)
    if (tile === undefined) continue
    out.push({ partName: part.name, tags: walk.context.composition.tagsOf(tile) })
  }
  return out
}

/**
 * One slot's candidates under the fills chosen so far, with the size parameter
 * layered on.
 *
 * The one place a candidate query happens, so the counter is total by
 * construction rather than by discipline.
 */
function candidatesOf(walk: Walk, slot: AssemblySlot, override?: readonly SiblingSelection[]): SlotCandidates {
  const resolved = resolveSlotTags(slot.tags, walk.template.tags, override ?? siblingsOf(walk, slot.name))
  const size = sizeRefsFor(walk, slot.name)
  walk.queries += 1
  if (size === undefined) return walk.context.composition.candidatesFor(resolved)
  return walk.context.composition.candidatesFor({
    require: [...resolved.require, ...size.require],
    deny: [...resolved.deny, ...size.deny],
    accept: resolved.accept,
  })
}

/**
 * The size refs one slot carries, or `undefined` when size is not a parameter of
 * this fill.
 *
 * Two sources, unioned: {@link FillContext.size}, which is B4's own per-family
 * list and applies to every slot, and {@link FillContext.cell}, which is B3's
 * per-slot derivation from B2's anchor.
 *
 * `undefined` means *do not narrow*, and it has four distinct causes that all
 * mean the same thing: neither field was given; the part-name set has no layout
 * to read an anchor from (**all 51 of B4's generated families**, which is why
 * the `size` field exists); the anchor is a `corner`, for which B3 measured the
 * honest predicate to be `{ kind: 'none' }`; or the family's size domain is
 * empty and B4's option carries no tags — **8 of its 51 families** have nothing
 * but *any size*. The last two are the ones worth naming: a slot with no size
 * control must not become a slot with no candidates.
 */
function sizeRefsFor(walk: Walk, part: string): { readonly require: readonly string[]; readonly deny: readonly string[] } | undefined {
  const require = [...(walk.context.size ?? [])]
  const deny: string[] = []

  const cell = walk.context.cell
  const layout = walk.layout
  const rule = layout?.slots.find((one) => one.part === part)
  if (cell !== undefined && layout !== undefined && rule !== undefined) {
    const refs = sizeRefs(slotSizePredicate(rule, cell, cornerSpanOf(layout)))
    for (const tag of refs.require) if (!require.includes(tag)) require.push(tag)
    for (const tag of refs.deny) if (!deny.includes(tag)) deny.push(tag)
  }

  return require.length === 0 && deny.length === 0 ? undefined : { require, deny }
}

/** One still-open sibling a pick could move. */
interface Exposed {
  readonly slot: AssemblySlot
  /**
   * Candidate files **before** the pick — `undefined` until something asks.
   *
   * Resolved **lazily and at most once per slot**, which is a measured decision
   * rather than a shape. The count is only needed to tell *this pick emptied it*
   * from *it was already empty* (see {@link emptiesSibling}), so it is only
   * needed when a probe comes back at 0, which is rare. Resolving it eagerly for
   * every exposed sibling of every slot costs the 40-recipe walk **382 queries
   * against 288** for an answer that is identical on all 40 — and those 94
   * queries are 33% of a lock toggle's whole cost.
   *
   * Mutable, and scoped to one slot's pick loop, because `walk.chosen` does not
   * change inside it — the moment a part is filled the loop is over. A cache
   * that outlived that would be answering with a count from a different state.
   */
  before: number | undefined
}

/** Still-open parts a pick of `part` could move. */
function exposedSiblings(walk: Walk, part: string): readonly Exposed[] {
  const out: Exposed[] = []
  for (const other of walk.template.parts) {
    if (other.name === part || walk.chosen.has(other.name) || !readsSibling(other, part)) continue
    out.push({ slot: other, before: undefined })
  }
  return out
}

/**
 * Whether filling `part` with `tile` would take a still-open sibling from some
 * candidates to none.
 *
 * The **whole** greying rule, and it is one step deep on purpose — see the
 * module docblock. Short-circuits on the first emptied sibling, because the
 * candidate is refused either way and the count of *which* siblings it would
 * have closed is a question for the editor's disclosure rather than for the
 * solver's walk.
 *
 * ## The before-count is load-bearing, and finding that out was a bug
 *
 * The plan's rule reads *"does not empty a still-open sibling"*, and the literal
 * implementation — refuse any candidate after which a still-open sibling has 0
 * candidates — is **wrong on an instance that already has a closed slot**. A
 * sibling at 0 stays at 0 whatever this part is filled with, so every candidate
 * of every remaining part is refused and one closed slot empties the rest of the
 * template. `fill.test.ts` reaches it the only way an unpinned solve cannot: a
 * *pinned* fill the greying walk would itself have refused.
 *
 * So the condition is `before > 0 && after === 0`, which is the guided flow's
 * three-way reading (`emptied` / `narrowed` / `rescued`) with the two states a
 * solver has to act on kept apart. The `before === 0 && after > 0` corner is
 * real in the grammar — `filterSpecificTags` keeps the most general survivor, so
 * a pick can *widen* a sibling — and it is deliberately not exploited here: it
 * was measured at 3 observations on tile parents and **0 on templates**, and a
 * solver that reordered its walk to hunt for a rescue would be optimising for
 * something the archive does not contain.
 */
function emptiesSibling(walk: Walk, part: string, tile: TileId, exposed: readonly Exposed[]): boolean {
  if (exposed.length === 0) return false
  const tags = walk.context.composition.tagsOf(tile)
  const base = siblingsOf(walk)
  for (const other of exposed) {
    const withPick = [...base.filter((entry) => entry.partName !== other.slot.name), { partName: part, tags }]
    if (candidatesOf(walk, other.slot, withPick).tiles.length > 0) continue
    other.before ??= candidatesOf(walk, other.slot).tiles.length
    if (other.before > 0) return true
  }
  return false
}

/* --------------------------------------------------------------- the base slot */

/**
 * The slots something else rests on — the ones the base ladder decides.
 *
 * Read off row B2's layout rather than from the name `base`, because the layout
 * is where the resting relation is authored and a name test would be a second,
 * weaker copy of it. It resolves to exactly `base` on all three shipped
 * conventions, which `corpus.test.ts` asserts.
 */
function isRestedOn(layout: TemplateLayout | undefined, part: string): boolean {
  return layout !== undefined && layout.slots.some((rule) => rule.restsOn === part)
}

/**
 * The piece the base is being chosen *for*.
 *
 * The layout's `cell` fill first — B2 measured the base congruent to the floor
 * cell on 1,213 of 1,213 walked combinations — then the first filled part in
 * declared order that rests on this slot. `undefined` when nothing that rests on
 * it is filled yet, which no shipped recipe reaches: all three declared orders
 * put `base` last.
 */
function referenceFor(walk: Walk, part: string): CatalogRecord | undefined {
  const layout = walk.layout
  if (layout === undefined) return undefined
  const cellTile = walk.chosen.get(layout.cell)
  const fromCell = cellTile === undefined ? undefined : walk.index.byId.get(cellTile)
  if (fromCell !== undefined) return fromCell
  for (const slot of walk.template.parts) {
    const rule = layout.slots.find((one) => one.part === slot.name)
    if (rule?.restsOn !== part) continue
    const tile = walk.chosen.get(slot.name)
    const record = tile === undefined ? undefined : walk.index.byId.get(tile)
    if (record !== undefined) return record
  }
  return undefined
}

/** What a pick produced: the tile, why, how many candidates it passed over. */
interface Pick {
  readonly tile: TileId | undefined
  readonly reason: FillReason | undefined
  readonly skipped: number
  readonly base: BaseRanking | undefined
}

/**
 * The base ladder, applied until it lands on a candidate the greying rule
 * accepts.
 *
 * `rankBases` returns the single best candidate and no ordering, so a rejected
 * winner is removed and the ladder is asked again. That is `O(n²)` in the worst
 * case over a pool whose median is 26 files, and it is never reached on the
 * shipped recipes at all: `base` is declared last on all three conventions, so
 * there is nothing still open for a base to close and the first ranking stands.
 * The loop is here because a caller may reorder a template's parts and because a
 * silent first-answer would be the wrong kind of cheap.
 *
 * The candidate order handed to `rankBases` is {@link orderedCandidates}', which
 * makes the room's family the tie-break under the ladder's own five criteria —
 * the ladder documents the caller as owning exactly that.
 */
function pickRankedBase(
  walk: Walk,
  slot: AssemblySlot,
  pool: readonly TileId[],
  exposed: readonly Exposed[],
): Pick {
  const reference = referenceFor(walk, slot.name)
  if (reference === undefined) return pickInOrder(walk, slot.name, pool, exposed)

  let remaining = pool
  let skipped = 0
  while (remaining.length > 0) {
    const records = remaining
      .map((tile) => walk.index.byId.get(tile))
      .filter((record): record is CatalogRecord => record !== undefined)
    const ranking = rankBases(reference, records, walk.index, walk.context.lock)
    if (ranking === undefined) break
    const tile = ranking.base.id
    if (!emptiesSibling(walk, slot.name, tile, exposed)) {
      return { tile, reason: 'base-ranking', skipped, base: ranking }
    }
    remaining = remaining.filter((one) => one !== tile)
    skipped += 1
  }
  return { tile: undefined, reason: undefined, skipped, base: undefined }
}

/** The greying walk over an ordered pool: the first candidate that closes nothing. */
function pickInOrder(
  walk: Walk,
  part: string,
  pool: readonly TileId[],
  exposed: readonly Exposed[],
): Pick {
  let skipped = 0
  for (const tile of pool) {
    if (emptiesSibling(walk, part, tile, exposed)) {
      skipped += 1
      continue
    }
    const family = honoursFamily(walk.context, walk.index, tile)
    const preferred = isPreferredVariant(walk, tile)
    return {
      tile,
      reason: family ? 'family' : preferred ? 'preferred' : 'address',
      skipped,
      base: undefined,
    }
  }
  return { tile: undefined, reason: undefined, skipped, base: undefined }
}

/** Whether a file is its own item's preferred variant under the lock preference. */
function isPreferredVariant(walk: Walk, tile: TileId): boolean {
  const aggregates = walk.context.composition.aggregates
  const variant = aggregates.byTile.get(tile)
  if (variant === undefined) return false
  const aggregate = aggregates.byDesign.get(variant.design)
  if (aggregate === undefined) return false
  return selectVariantForLock(aggregate, walk.context.lock).variant.id === tile
}

/* ------------------------------------------------------------------- the solve */

/**
 * Fill a template's parts in one pass.
 *
 * `preset` is the fills the walk must **not** re-solve — the user's pinned
 * choices, which a lock change honours (§2.1) and which act as fixed siblings
 * for everything else. They are reported as decisions with
 * `reason: 'pinned'` so a caller can count what it honoured without a second
 * pass over the instance, and they are not queried at all: a pinned slot costs
 * this solver nothing.
 *
 * Total. Nothing throws, an unknown part-name set simply has no layout (so no
 * base ranking and no size predicate), and every slot with no fill is reported
 * with its {@link SlotGap} rather than dropped.
 */
export function solveTemplateFills(
  template: AssemblyTemplate,
  index: AssemblyIndex,
  context: FillContext,
  preset: Readonly<Record<string, TileId>> = {},
): TemplateFill {
  const walk: Walk = {
    template,
    context,
    index,
    layout: layoutFor(template.parts.map((part) => part.name)),
    chosen: new Map(Object.entries(preset).filter(([, tile]) => tile !== undefined)),
    queries: 0,
  }

  const decisions: SlotDecision[] = []

  for (const slot of template.parts) {
    const pinned = preset[slot.name]
    if (pinned !== undefined) {
      decisions.push({
        slot: slot.name,
        tile: pinned,
        record: index.byId.get(pinned),
        optional: slot.optional === true,
        candidates: 0,
        items: 0,
        skipped: 0,
        reason: 'pinned',
        gap: undefined,
        unknownRefs: [],
        familyHonoured: honoursFamily(context, index, pinned),
        base: undefined,
        queries: 0,
      })
      continue
    }

    const before = walk.queries
    const candidates = candidatesOf(walk, slot)
    const pool = orderedCandidates(candidates, context, index)
    const exposed = exposedSiblings(walk, slot.name)
    const pick =
      isRestedOn(walk.layout, slot.name) && pool.length > 0
        ? pickRankedBase(walk, slot, pool, exposed)
        : pickInOrder(walk, slot.name, pool, exposed)

    if (pick.tile !== undefined) walk.chosen.set(slot.name, pick.tile)

    decisions.push({
      slot: slot.name,
      tile: pick.tile,
      record: pick.tile === undefined ? undefined : index.byId.get(pick.tile),
      optional: slot.optional === true,
      candidates: candidates.tiles.length,
      items: candidates.items.length,
      skipped: pick.skipped,
      reason: pick.reason,
      gap: pick.tile === undefined ? gapOf(walk, slot, candidates) : undefined,
      unknownRefs: candidates.unknownRefs,
      familyHonoured: pick.tile !== undefined && honoursFamily(context, index, pick.tile),
      base: pick.base,
      queries: walk.queries - before,
    })
  }

  const fills: Record<string, TileId> = {}
  for (const decision of decisions) if (decision.tile !== undefined) fills[decision.slot] = decision.tile

  return {
    fills,
    decisions,
    complete: decisions.every((decision) => decision.tile !== undefined || decision.optional),
    needsChoice: decisions.filter((one) => one.tile === undefined).map((one) => one.slot),
    queries: walk.queries,
  }
}

/**
 * Which of the three ways this slot ended up with nothing.
 *
 * `unknown-ref` first, because a dangling ref makes the intersection empty
 * *before* any narrowing and reporting it as narrowing would send a user to
 * change a sibling that cannot help. Then the cold set: a slot that had nothing
 * to begin with is an archive gap, and a slot that had something is one the
 * picks around it closed. The cold resolution is the one query this function
 * costs and it is only ever paid on a slot that failed.
 */
function gapOf(walk: Walk, slot: AssemblySlot, candidates: SlotCandidates): SlotGap {
  if (candidates.unknownRefs.length > 0) return 'unknown-ref'
  return candidatesOf(walk, slot, []).tiles.length === 0 ? 'no-candidate' : 'closed-by-siblings'
}
