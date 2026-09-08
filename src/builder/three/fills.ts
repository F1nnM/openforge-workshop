/**
 * The click's fill: C2's solver, the palette's armed control position, and B2's
 * geometry, composed once per placement.
 *
 * ## The defect this file closes
 *
 * `edits.ts` placed every template with `fills: {}` — contract **C-g**, and
 * honest while nothing could turn a family into files. Row **C2** built
 * `solveTemplateFills` (40 of 40 recipes, 51 of 51 families) and wired it to
 * nothing; row **C3** wired it to the *lock change* only, through
 * `relock.ts#reSolveScene`. So placing a template put an instance in the store
 * with **no fills**, row A2 proved `planSceneMeshes` reconciles on the
 * placements alone, and the consequence was the one the three A4b surfaces
 * described: **a placement drew nothing.** This module is what the click calls
 * instead.
 *
 * ## Three things it composes and none it re-implements
 *
 *   - **`solveTemplateFills`** decides *what*. Its acceptance condition is
 *     C2's — every slot it filled, and the gaps it reports for the ones it could
 *     not — and nothing here re-orders, re-ranks or second-guesses it.
 *   - **The armed control position** is `PlanTools.armedPosition`, the palette's
 *     component, height and size choices as their own tags, and it reaches the
 *     solver as {@link FillContext.position} or as {@link FillContext.cell}.
 *     Which one is not a preference: see {@link positionContextFor}.
 *   - **`placeTemplateSlots`** decides whether the chosen fills *close*, and it
 *     is called here for one reason — so a **one-click** placement discloses the
 *     same {@link SlotDoubt} C3's editor already mounts. C2 measured its own
 *     fills through this composition: they close on **34 of 40** recipes, are
 *     `undecidable` on the 4 internal corners with no wall to close, and
 *     **`fail` on the 2 external-corner `single_piece` recipes** with 4
 *     `over-run` doubts, whose mitre is in no tag and no measured mesh. No
 *     ordering fixes those, so the honest answer is to place and say so.
 *
 * ## The memo, and why it is keyed the way it is
 *
 * One solve is cheap and a room is many of them. Measured on this path over the
 * live archive: the 91 placeable families cost **1 to 19 candidate queries each**
 * (339 in total, 7.2 per multi-slot recipe) and **42.3 ms** for all 91 cold, worst
 * **3.3 ms**; the same 91 through the memo cost **0.1 ms**. `SOLVE_QUERIES = 288`
 * is *not* the price of a solve — `fill.ts` documents it as the whole 40-recipe
 * walk, and this path measures exactly 288 across those same 40.
 *
 * `relock.ts` memoises a *scene* re-solve on `(template, pins)` for the length of
 * one call and argues that anything longer needs the preference in the key; a
 * filler is created per `(lock, family, index)` — `BuilderRoom` builds it in a
 * `useMemo` on exactly those — so the preference *is* in the key, by
 * construction, and the map can outlive a call. What is left to key on is the
 * template and the armed position, which is what a user places twenty of.
 *
 * Every fill it produces is `pinned: false`. That is not a shorthand: the store
 * is explicit that `pinned` means *the user chose this file*, a lock change
 * re-solves every `auto` fill and never touches a pinned one, and a solver that
 * wrote `true` would freeze twenty choices nobody made.
 */
import type { AssemblyIndex, AssemblyTemplate } from '@/assembly'
import type { Footprint } from '@/catalog'
import type {
  FillContext,
  GridSize,
  SceneFillContext,
  SlotDoubt,
  SlotGap,
  TemplateFill,
} from '@/template'
import { layoutFor, placeTemplateSlots, slotDoubtSentence, solveTemplateFills } from '@/template'
import type { SlotFill, SlotName, TemplateId, TemplateInstance } from '@/store'

/** One slot the solver could not fill, and which of C2's three situations it is. */
export interface FillGap {
  readonly slot: SlotName
  readonly gap: SlotGap
}

/**
 * What a click knows about the instance it is about to place.
 *
 * Store-shaped `fills` plus everything a sentence has to be able to say about
 * them. It is deliberately *not* a `TemplateFill`: the store wants
 * `Record<SlotName, SlotFill>` and the surface wants counts, so the conversion
 * happens once here rather than at two call sites.
 */
export interface PlacementFill {
  /** What `placeTemplate` receives. One entry per **filled** slot (C-g). */
  readonly fills: TemplateInstance['fills']
  /** Slots the template declares. `0` when this build has no such recipe. */
  readonly slots: number
  /** Slots the solver filled. */
  readonly filled: number
  /** Slots left empty, in declared order — §3.2's *needs a choice*. */
  readonly needsChoice: readonly FillGap[]
  /**
   * B2's verdict on the chosen fills, empty when the template places cleanly.
   *
   * Carried rather than collapsed to a boolean because {@link SlotDoubt} names
   * the part and, on an `over-run`, both numbers — and `slotDoubtSentence` is
   * the wording, so the surface says what the editor says.
   */
  readonly doubts: readonly SlotDoubt[]
  /**
   * `false` when the template lookup has no recipe for this id.
   *
   * A real state and not a defensive branch: C1 measured that against the
   * 40-recipe table all 51 of B4's generated families report `unknown-template`
   * and 0 parts, which is why `BuilderScreen` builds its lookup from
   * `PLACEABLE_TEMPLATES`. An instance still places — the bill reports it and
   * the download refuses it — and the message says which of the two happened.
   */
  readonly known: boolean
  /** Candidate queries this solve cost. `0` on a memo hit. */
  readonly queries: number
}

/**
 * Solve one armed family at one armed control position.
 *
 * Total: an unknown template answers `known: false` with no fills rather than
 * throwing, because a click must not be able to take the surface down.
 */
export type PlacementFiller = (template: TemplateId, position?: readonly string[]) => PlacementFill

/** Everything a filler needs: C2's context, plus the assembly index it walks. */
export interface PlacementFillInput {
  readonly index: AssemblyIndex
  readonly context: SceneFillContext
}

/**
 * The three authorities a surface needs, as one prop.
 *
 * Flat rather than a nested {@link PlacementFillInput}, and the reason is a
 * React one: a component that memoises its filler has to key on things a caller
 * can hold stable, and three memoised leaves are three stable references where a
 * nested `context` object built in the JSX is a new one on every render — which
 * would rebuild the filler, and throw away the memo table that makes twenty
 * placements one solve. The lock is **not** here: it is a preference, read from
 * the store by whoever builds the filler.
 */
export interface FillAuthorities {
  readonly index: AssemblyIndex
  readonly templates: SceneFillContext['templates']
  readonly composition: SceneFillContext['composition']
}

/**
 * The armed control position, as the solver's own two fields.
 *
 * **`cell` for a layout-bearing recipe, `position` for everything a cell cannot
 * say**, and C2 is emphatic about why one ref list cannot serve both: a
 * family-wide list requires *every* slot to carry the same `size|` tags, which is
 * right for a one-slot family and wrong for a 2x2 recipe that wants a 2x2
 * **floor** and a 2-unit **run** of wall. `cell` goes through B3's per-slot
 * anchor derivation instead — congruence for a `cell` anchor, the anchored
 * face's run for an `edge`, nothing for a `corner` — which is the only reading
 * that narrows a five-slot recipe correctly.
 *
 * **Both branches are now live, and the recipe fold is what made them so.** C1
 * measured that `GENERATED_FAMILY_SIZES` had *"no entry for any of the 40
 * recipes"*, so every size a user could arm belonged to a one-slot family and
 * the `cell` branch was reachable only in `fills.test.ts`. The fold gives the
 * assemblies a size domain of their own — and a layout — so the `cell` branch is
 * the one they take, which is the good outcome: their walls get a run and their
 * floors a congruence rather than one list imposed on both.
 *
 * A position with only one axis — *"2 wide"* — cannot become a cell, so the
 * whole position rides as `parentTags`. That is the honest reading rather than a
 * fallback: a cell needs both spans, and inventing the second would place a size
 * nobody chose.
 *
 * The component and height axes never become a cell and are never a require of
 * every slot. They ride as `parentTags` in every case; see
 * `template/fill.ts#FillContext.position`.
 */
export function positionContextFor(
  template: AssemblyTemplate,
  position: readonly string[],
): Pick<FillContext, 'position' | 'cell'> {
  if (position.length === 0) return {}
  /* The size axis and everything else, because the two take different routes
     and the fold is what made that a real split rather than a distinction with
     one case. A `size|width|2` + `size|depth|2` pair over a template with a
     layout becomes a **cell**, which B3's derivation spreads per slot — a 2x2
     floor and a 2-unit *run* of wall, which no single ref list can say. A
     component or a height cannot become a cell and must not try: it rides as
     `parentTags` and each slot's `constrain` block decides whether it applies,
     which is how a `component|door|arched` narrows the wall and leaves the floor
     and the base alone. */
  const size = position.filter((tag) => tag.startsWith('size|'))
  const axes = position.filter((tag) => !tag.startsWith('size|'))
  const layout = layoutFor(template.parts.map((part) => part.name))
  const cell = layout === undefined ? undefined : cellOf(size)
  /* With no cell the whole position rides as parentTags — which is the one-slot
     family's path, and the width-only position's: a cell needs both spans and
     inventing the second would place a size nobody chose. */
  const parent = cell === undefined ? position : axes
  return {
    ...(cell === undefined ? {} : { cell }),
    ...(parent.length === 0 ? {} : { position: parent }),
  }
}

/** `['size|width|2', 'size|depth|2']` as a {@link GridSize}, or nothing. */
function cellOf(size: readonly string[]): GridSize | undefined {
  const w = axisValue(size, 'width')
  const d = axisValue(size, 'depth')
  return w === undefined || d === undefined ? undefined : { w, d }
}

function axisValue(size: readonly string[], axis: 'width' | 'depth'): number | undefined {
  const prefix = `size|${axis}|`
  for (const tag of size) {
    if (!tag.startsWith(prefix)) continue
    const value = Number(tag.slice(prefix.length))
    if (Number.isFinite(value)) return value
  }
  return undefined
}

/**
 * The memo key: the family and the armed control position.
 *
 * `NUL`-joined for this repo's usual reason — two of the six shipped slot names
 * contain a space, so every printable delimiter is ambiguous on real data — and
 * the tags are **sorted**, because two positions spelling the same choice in
 * either order are the same solve. Written as the escape and never as the byte;
 * `tools/hygiene/source.test.ts` fails the build on the byte.
 */
function memoKey(template: TemplateId, position: readonly string[]): string {
  return [template, ...[...position].sort()].join('\u0000')
}

/**
 * A memoised filler over one catalog, one lock preference and one design family.
 *
 * The three authorities are the ones `BuilderScreen` already holds for the bill
 * and for `reSolveScene`, passed in rather than derived: `buildAssemblyIndex` is
 * 8,702 records and `compositionIndexFor` is a 409,432-byte inverted index whose
 * `WeakMap` makes the drawer, the palette's counter, the slots panel, the bill
 * and this one filler five readers of a single build.
 */
export function createPlacementFiller({ index, context }: PlacementFillInput): PlacementFiller {
  const memo = new Map<string, PlacementFill>()

  return (id, position = []) => {
    const key = memoKey(id, position)
    const hit = memo.get(key)
    if (hit !== undefined) return { ...hit, queries: 0 }

    const template = context.templates(id)
    if (template === undefined) {
      const missing: PlacementFill = {
        fills: {},
        slots: 0,
        filled: 0,
        needsChoice: [],
        doubts: [],
        known: false,
        queries: 0,
      }
      memo.set(key, missing)
      return missing
    }

    const solved = solveTemplateFills(template, index, {
      ...context,
      ...positionContextFor(template, position),
    })
    const placed = placementOf(template, solved)
    memo.set(key, placed)
    return placed
  }
}

/** One solve, as the store's shape plus what a sentence needs. */
function placementOf(template: AssemblyTemplate, solved: TemplateFill): PlacementFill {
  const fills: Record<string, SlotFill> = {}
  const feet = new Map<string, Footprint>()
  for (const decision of solved.decisions) {
    if (decision.tile === undefined) continue
    /* The one brand minted by assertion rather than by `SlotName.parse`, for
       `relock.ts`'s reason: the name comes from the template table, which
       `pipeline/templates.ts` validated with the schema's own `PartSlot`, so a
       parse here could only re-derive what the build already checked — and it
       could *throw*, which a click must not be able to do. */
    fills[decision.slot] = { tile: decision.tile, pinned: false }
    if (decision.record !== undefined) feet.set(decision.slot, decision.record.foot)
  }

  const layout = layoutFor(template.parts.map((part) => part.name))

  return {
    fills,
    slots: template.parts.length,
    filled: Object.keys(fills).length,
    needsChoice: solved.decisions
      .filter((decision) => decision.tile === undefined)
      .map((decision) => ({
        slot: decision.slot as SlotName,
        // A decision with no tile always carries a gap; `closed-by-siblings` is
        // the reading `relock.ts` gives the same field for the same reason.
        gap: decision.gap ?? 'closed-by-siblings',
      })),
    /* No layout, no doubts, and that is not a gap in the disclosure: B2's three
       outputs are all constants for one slot at the origin, so B4's 51
       one-slot families decline a convention deliberately and there is nothing
       for `placeTemplateSlots` to be undecided about.

       No `insetParts` either, and that is deliberate rather than forgotten: the
       inset anchor moves a slot's `offset` and `residual`, and this call reads
       **only** `doubts`. A `cell` slot becoming `residual` raises and silences no
       doubt — the `unfilled`, `no-footprint`, `no-run` and `over-run` branches
       all run before the anchor is resolved, and `no-walk` reads the insets the
       *declared* `edge` rules give. So passing a set here could only cost the
       caller a tag decoder it has no other use for. */
    doubts: layout === undefined ? [] : placeTemplateSlots(layout, feet).doubts,
    known: true,
    queries: solved.queries,
  }
}

/**
 * What a placement's fills say, as the sentence the surface announces.
 *
 * Here rather than in `edits.ts` because every clause of it is a fact about the
 * *fill*, and because §3.4's seventh cost is the thing it exists to avoid: an
 * auto-filled room nobody chose, presented as though the user had chosen it. So
 * the count of parts chosen **for** the user leads, the slots that need a choice
 * are named, and a doubt is quoted in `slotDoubtSentence`'s own words — the same
 * words C3's editor mounts, so the surface and the editor cannot disagree about
 * a mitre that does not close.
 */
export function describePlacementFill(fill: PlacementFill): string {
  if (!fill.known) {
    return (
      'this build has no recipe for that family, so it is placed with no parts. ' +
      'The bill names it and the download refuses it.'
    )
  }
  const reason = reasonOf(fill.needsChoice)
  const chosen =
    fill.filled === 0
      ? `no part could be chosen for its ${String(fill.slots)} ${fill.slots === 1 ? 'slot' : 'slots'}`
      : `${String(fill.filled)} of ${String(fill.slots)} ${fill.slots === 1 ? 'part' : 'parts'} chosen for you`
  /* With **nothing** filled, naming the slots would name all of them and say
     less than the reason does — so the reason stands alone as its own sentence.
     With some filled, the slots are the actionable half and the reason qualifies
     them. */
  const empty =
    fill.needsChoice.length === 0
      ? ''
      : fill.filled === 0
        ? sentence(reason)
        : ` The ${namesOf(fill.needsChoice)} ${
            fill.needsChoice.length === 1 ? 'part needs' : 'parts need'
          } a choice${reason === '' ? '' : `: ${reason}`}.`
  /* `unfilled` is skipped, and it is the only code that is: it is B2 saying the
     slot has no fill, which {@link PlacementFill.needsChoice} has already named
     with a *reason* attached — so quoting it too would say the same thing twice
     and lose the reason on the second telling. The field itself stays faithful
     to `placeTemplateSlots`; the filtering is a property of the sentence. */
  const first = fill.doubts.find((one) => one.code !== 'unfilled')
  const doubt = first === undefined ? '' : ` ${slotDoubtSentence(first)}`
  return `${chosen}.${empty}${doubt}`
}

/** A clause as its own sentence, appended to one that has already ended. */
function sentence(clause: string): string {
  return clause === '' ? '' : ` ${clause.slice(0, 1).toUpperCase()}${clause.slice(1)}.`
}

function namesOf(gaps: readonly FillGap[]): string {
  const names = gaps.map((one) => one.slot)
  if (names.length <= 2) return names.join(' and ')
  return `${names.slice(0, -1).join(', ')} and ${String(names.at(-1))}`
}

/**
 * Why a slot is empty, when every empty slot agrees about it.
 *
 * The three readings are C2's and they are three different things to do next:
 * `no-candidate` includes the requested size — *nothing in the archive is this
 * size*, and **no sibling change can reopen it** — where `closed-by-siblings` is
 * exactly the one a different pick can fix. Silent when the gaps disagree,
 * because one sentence cannot honestly carry two answers.
 */
function reasonOf(gaps: readonly FillGap[]): string {
  const first = gaps[0]?.gap
  if (first === undefined || gaps.some((one) => one.gap !== first)) return ''
  switch (first) {
    case 'no-candidate':
      return 'nothing in the archive is this size'
    case 'closed-by-siblings':
      return 'the parts around it took every candidate'
    case 'unknown-ref':
      return 'this build has no tag for what it asks for'
  }
}
