/**
 * The **lock re-solve**: every `auto` fill in the scene, solved again, and every
 * `pinned` one left alone.
 *
 * ## Why a lock change has to rewrite the scene at all
 *
 * A fill names an exact file (decision **D1**), so it freezes the lock choice at
 * fill time — and **the three lock systems disagree about which file to print
 * for 1,419 of 3,822 items (37.1%)**. Without a re-solve, switching lock style
 * would leave a placed room unchanged, which is contract **C-k**'s failure: the
 * toggle stops working and *nothing fails*. `SlotFill.pinned` is the bit that
 * makes the toggle possible and this file is what pulls it.
 *
 * Row A2 supplies the other half of the mechanism: **`planSceneMeshes` is
 * lock-free**, so a lock change reaches mesh conversion through the placements
 * this re-solve rewrites and through nothing else. A re-solve that does not
 * write the store converts no meshes and changes no pixels.
 *
 * ## What a lock change actually moves, measured
 *
 * Less than the plan implies, and the reason is structural: **the candidate set
 * is lock-free.** `@/composition` intersects tag postings, and the lock
 * preference is not one of the tags — it enters only twice, both *inside* an
 * already-resolved candidate set:
 *
 *   1. `selectVariantForLock` picks which **file of the item** to take;
 *   2. `rankBases` weights the lock above its four other criteria for a `base`.
 *
 * So a lock toggle cannot empty a slot, cannot complete one that was empty, and
 * cannot change which *item* fills a slot — it changes which variant of it, and
 * which base goes under it. `corpus.test.ts` measures how many of the 128
 * shipped slots move between the three systems rather than asserting that some
 * do.
 *
 * It also means **a size change is the dangerous re-solve, not a lock change**:
 * a cell that no candidate matches empties a slot that was filled, and this
 * driver leaves the stale fill where it is rather than taking it out. Row A11
 * shipped the action that can — `@/store#clearFill` — and no solver calls it, on
 * purpose; see the gaps at the bottom of this docblock.
 *
 * ## The scene-scale cost, and why it is not instances times slots
 *
 * The plan prices a toggle at *"250 instances times 5 slots = 1,250 candidate
 * queries, synchronously, on a click"* and asks whether that fits in a frame.
 * Measured over the live archive at that room size, a solve per instance is
 * **1,790 queries** — worse than the plan's figure, because the greying rule
 * probes siblings as well as resolving slots — and **53–65 ms** measured in
 * isolation.
 *
 * The answer is not batching, a worker, or an incremental re-solve. It is that
 * **the solve is a pure function of `(template, preference, pinned fills)`**,
 * and a room is built out of 40 recipes at most:
 *
 *   - every unpinned instance of one template in one room has the **same**
 *     answer, so the work is bounded by the number of *distinct* templates, not
 *     by the number of instances;
 *   - a pinned instance is keyed by its pins as well, because a pin is a fixed
 *     sibling that changes what the rest of the walk sees.
 *
 * {@link reSolveScene} memoises on exactly that key, and the same 250-instance
 * room becomes **40 solves, 288 queries and 8–9 ms** — inside a 16.7 ms frame.
 *
 * The **query counts are exact and asserted; the milliseconds are not.** The
 * same two shapes read 149.6 ms and 22.8 ms inside a whole-suite run, which is
 * a 2.6x scheduling spike and not a different function —
 * `screens/assemblies/corpus.test.ts` records paying for that lesson on its own
 * budget. So `corpus.test.ts` prints both readings, asserts the queries, and
 * keeps a deliberately loose bound on the time: tight enough that losing the
 * memo fails it, loose enough that a loaded machine does not.
 *
 * ## The solver is not the expensive half, and that is this row's other finding
 *
 * §11 asks whether the *re-solve* fits in a frame. It does. What does not is the
 * **write**: `workshopStore` is `persist`-wrapped over synchronous
 * `localStorage`, so every `fillSlot` serialises the whole scene, and 750 fills
 * over a 250-instance room measure **80.5 ms** against the memoised solver's
 * 0.8 ms on the same fixture — a hundredfold. `relock.test.ts` measures both
 * halves side by side.
 *
 * That is A1's surface and this row does not own it, so it is reported rather
 * than worked around. The three honest options, in the order they cost:
 *
 *   1. **One transaction.** A `fillSlots(id, fills)` action, or a scene-level
 *      one, writing every slot of the re-solve in a single `setState`. It is
 *      strictly one store action and it keeps the pinned guard exactly where it
 *      is; a driver cannot do it from outside, because `writeFill` is private
 *      and the guard is what must not be duplicated.
 *   2. **Debounce the persist.** `persist` can be given a throttled storage
 *      adapter, which trades a crash-window against the serialisation cost.
 *      `storage.ts` argues *against* asynchrony for the drag path and the
 *      argument transfers, so this is a real trade and not a free win.
 *   3. **Leave it.** 80 ms is a visible hitch on a lock toggle and not a broken
 *      app, and a toggle is a rare gesture where a drag is not.
 *
 * A `fillSlot` that changes nothing returns the identical state object, so the
 * unchanged case wakes no subscriber — but it still pays the `setState`, so the
 * cost above is the cost of a toggle that changes *nothing* as much as of one
 * that changes everything.
 *
 * ## Three gaps around the `pinned` bit — and row **A11** closed two of them
 *
 * The plan's §11 records three as owned by nobody and hands the third here.
 * This row's answers, with A11's where this row could only report:
 *
 *   1. **There is no unpin, and this solver needs one** — not to re-solve (it
 *      honours pins by design) but to *act* on the warning below. A pinned fill
 *      that has become unprintable could only be repaired by making another
 *      deliberate choice, which is not what the user wants to say: they want to
 *      hand the slot back to the lock preference.
 *
 *      **`@/store#unpinFill` is that action, and A11 shipped it.** It refined
 *      the shape this row guessed at: not one `writeFill(id, slot, …, false)`
 *      with the fill deleted, but **two named actions**, because dropping the
 *      bit and emptying the slot leave the room in states that differ in whether
 *      the pack can be built — `unpinFill` keeps a printable file and moves only
 *      the authority over it, `clearFill` leaves a hole and refuses the
 *      download. The store cannot do the re-solve that makes an unpin visible,
 *      needing the candidate sets and therefore the catalog and the template
 *      table `schema.ts` keeps out of its closure — so the repair is the
 *      caller's, and **`builder/panels/slots/slotEditor.ts#handSlotToLock`** is
 *      the caller that does it. It does it through {@link reSolveScene} over the
 *      one instance — this module's own driver, at the memo's best case — with
 *      the instance re-read out of the store after the unpin, so the pin that
 *      was just dropped is not handed back to the solver as a preset.
 *   2. **A pinned fill can become unprintable under a new lock, and now it
 *      warns.** {@link PinLockWarning} is that comparison, and it is made here
 *      because here is where both halves are in hand: the fill's own record, and
 *      the aggregate that says whether another variant of the same design
 *      carries the new lock. The reading is `resolve.ts#lock-unavailable`'s,
 *      verbatim — a record carrying *some* lock system but not this one — so the
 *      warning and the bill's note cannot disagree. A record with no lock system
 *      at all is lock-agnostic and not a mismatch.
 *   3. **The re-solve is measured at scene scale**, above.
 *
 * A fourth, found here: **there was no way to clear a fill.** `fillSlot` and
 * `pinFill` both write a tile and A1's surface had no delete, so a re-solve that
 * can no longer fill a slot left the previous answer in place with nothing able
 * to take it out.
 *
 * **`@/store#clearFill` is that action, and A11 shipped it too** — the second of
 * the pair described above, the one that leaves a hole and refuses the download.
 * **This driver still does not call it**, and that is now a decision rather than
 * a missing action: `clearFill`'s own docblock is where the argument lives, and
 * it names this function — a driver that silently deleted a user's fill on a
 * candidate-set change would be contract **C-k**'s failure with a delete key, so
 * clearing has exactly one caller and it is the user. What this function does
 * instead is unchanged and is the honest half: the stale answer stays, and
 * {@link InstanceReSolve.stale} and {@link UnfilledReport.stale} report it so
 * the surface that *does* have the user in front of it can offer the clear.
 * Still unreachable through the lock (the candidate set is lock-free, above) and
 * reachable through a size change.
 */
import type { CatalogRecord, TileId } from '@/catalog'
import type { AssemblyIndex, TemplateLookup } from '@/assembly'
import type { FillOutcome, LockSystem, PlacementId, SlotFill, SlotName, TemplateInstance } from '@/store'
import { LockSystem as LockSystemSchema, fillSlot } from '@/store'

import type { FillContext, SlotGap, TemplateFill } from './fill'
import { solveTemplateFills } from './fill'

/* -------------------------------------------------------------------- context */

/**
 * A {@link FillContext} plus the template table, which a scene needs and a
 * single template does not.
 *
 * Spelled so that `@/assembly`'s `AssemblyContext` is assignable to it — same
 * `templates`, same `composition`, same `lock` — because the caller that toggles
 * the lock is the caller that already holds one for the bill.
 */
export interface SceneFillContext extends FillContext {
  /** The template table this build ships. `undefined` for a retired recipe. */
  readonly templates: TemplateLookup
}

/**
 * The store write, as a parameter.
 *
 * Defaulted to `@/store`'s `fillSlot` and **not** to `pinFill`: the guard that
 * refuses a pinned slot lives in `fillSlot`, and the store's own docblock is
 * explicit that a solver which forgot to skip a pinned slot would discard every
 * deliberate choice in the room with nothing failing. Injectable so a test can
 * count outcomes without a store, and because a caller inside a batch may want
 * to collect writes rather than apply them.
 */
export type FillWriter = (id: PlacementId, slot: SlotName, tile: TileId) => FillOutcome

/* -------------------------------------------------------------------- reports */

/**
 * A pinned fill the new lock preference cannot print — §11's second gap.
 *
 * Reported, never repaired. `pinned: true` means *print this exact file*, so
 * silently swapping it is the one move a solver must not make; and with no
 * unpin action (§11's first gap) the only repair available to the user is
 * another deliberate pick, which {@link alternative} names for them.
 */
export interface PinLockWarning {
  readonly placement: PlacementId
  readonly template: string
  readonly slot: SlotName
  /** The pinned file, which carries a lock system and not this one. */
  readonly tile: TileId
  /** The lock systems it does offer, in the record's own order. Never empty. */
  readonly offers: readonly string[]
  /** The lock preference it cannot meet. */
  readonly wanted: LockSystem
  /**
   * Another variant of the **same design** that carries the wanted lock, or
   * `undefined` when the design has none.
   *
   * The difference between "your pin is the wrong print of the right piece" and
   * "this piece does not come in your lock at all", which is the difference
   * between a one-click repair and a choice of a different design.
   */
  readonly alternative: TileId | undefined
}

/**
 * One slot the re-solve could not fill, with which of the three reasons.
 *
 * This is the *cause* behind one row of C4's bill surface: a slot with no fill
 * reaches `billView.ts#slotFaults` as kind `empty`, which refuses the download.
 * That surface can say **which** slot and this one can say **why**, and the two
 * cannot disagree because both are read off the same absent fill.
 */
export interface UnfilledReport {
  readonly placement: PlacementId
  readonly template: string
  readonly slot: SlotName
  readonly gap: SlotGap
  /**
   * A fill that is still in the store for this slot, which the re-solve cannot
   * replace and **will not** remove.
   *
   * The fourth gap in the module docblock, where row A11's `clearFill` and the
   * reason no solver calls it are set out. `undefined` for the ordinary case of
   * a slot that was empty and stays empty.
   */
  readonly stale: TileId | undefined
}

/** One instance, re-solved. */
export interface InstanceReSolve {
  readonly placement: PlacementId
  readonly template: string
  /** `undefined` when this build ships no template by that id — nothing to solve. */
  readonly fill: TemplateFill | undefined
  /** Pinned slots this instance carried into the re-solve. */
  readonly pinned: readonly SlotName[]
  /** Slots whose stored fill the re-solve cannot rewrite and will not clear. */
  readonly stale: readonly SlotName[]
  /** `true` when this instance's answer came out of the memo rather than the solver. */
  readonly cached: boolean
}

/** A whole scene, re-solved. */
export interface SceneReSolve {
  readonly instances: number
  /** Declared slots walked, over every instance with a known template. */
  readonly slots: number
  /** Solver runs actually performed. **Bounded by distinct `(template, pins)`**, not by instances. */
  readonly solves: number
  /** Instances answered from the memo. `instances - solves - unknown templates`. */
  readonly cached: number
  /** Candidate queries the whole re-solve cost. The unit the plan prices a toggle in. */
  readonly queries: number
  /** Every write's outcome, tallied. `kept-pinned` is the count of honoured choices. */
  readonly outcomes: Readonly<Record<FillOutcome, number>>
  /** Instances naming a template this build does not ship. Nothing is written for them. */
  readonly unknownTemplates: readonly PlacementId[]
  readonly unfilled: readonly UnfilledReport[]
  readonly pinWarnings: readonly PinLockWarning[]
  readonly perInstance: readonly InstanceReSolve[]
}

/* ------------------------------------------------------------------ the driver */

const LOCK_SYSTEMS = new Set<string>(LockSystemSchema.options)

/**
 * The pinned fills of an instance, by slot name.
 *
 * `Object.entries` over `fills` rather than `filledSlots`, because both the tile
 * and the bit are wanted and the branded key is dropped in key position anyway
 * (row V3's finding, recorded on `SlotName`).
 */
function pinsOf(instance: TemplateInstance): readonly (readonly [SlotName, SlotFill])[] {
  return Object.entries(instance.fills)
    .filter((entry): entry is [SlotName, SlotFill] => entry[1] !== undefined && entry[1].pinned)
    // Sorted, because these go into the memo key: two instances pinned the same
    // way must produce the same key whatever order the map iterates in.
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
}

/**
 * The memo key: the template, and the pins that change what the walk sees.
 *
 * The **preference is not in it**, and that is safe rather than an omission: the
 * memo lives for exactly one {@link reSolveScene} call, and the lock, the family
 * and the cell are constant across one. A memo that outlived the call would need
 * all three in the key and would then be a cache with an invalidation problem,
 * which is a worse trade than 40 solves.
 *
 * `NUL`-joined, for the reason every key in this repo gives — two of the six
 * shipped slot names contain a space, so every printable delimiter is ambiguous
 * on real data. Written as the escape and never as the byte;
 * `tools/hygiene/source.test.ts` fails the build on the byte.
 */
function memoKey(template: string, pins: readonly (readonly [SlotName, SlotFill])[]): string {
  return [template, ...pins.map(([slot, fill]) => `${slot}=${fill.tile}`)].join('\u0000')
}

/**
 * Whether a record carries a lock system and not this one.
 *
 * `resolve.ts#lock-unavailable`'s reading, so the warning and the bill's note
 * cannot disagree: a record with no lock system at all is lock-agnostic —
 * `connection|openforge` delegates joinery to a separately printed base — and is
 * not a mismatch. The three systems come from the store's own enum rather than
 * from a third frozen table, so a fourth system cannot leave this stale.
 */
function locksAgainst(record: CatalogRecord, lock: LockSystem): boolean {
  return record.conn.some((tag) => LOCK_SYSTEMS.has(tag)) && !record.conn.includes(lock)
}

/**
 * Another variant of the same design that carries `lock`, in the aggregate's own
 * variant order.
 *
 * The lock is read off the **record**, not off `TileVariant`: a variant carries
 * `bottomConn` and `sideConn` — table joinery and neighbour joinery, which row
 * A1 split for cause — and `record.conn` is the flat list `resolve.ts` and
 * `rankBases` both test. Reading the variant's split lists here would ask a
 * narrower question than the one the warning is about and would disagree with
 * the bill on the tiles where the two lists differ.
 */
function alternativeFor(
  context: SceneFillContext,
  index: AssemblyIndex,
  record: CatalogRecord,
  lock: LockSystem,
): TileId | undefined {
  const aggregate = context.composition.aggregates.byDesign.get(record.design)
  for (const variant of aggregate?.variants ?? []) {
    if (variant.id === record.id) continue
    if (index.byId.get(variant.id)?.conn.includes(lock) === true) return variant.id
  }
  return undefined
}

/**
 * Re-solve every `auto` fill in a scene and write the results.
 *
 * The write happens for **every** slot of every instance, pinned ones included,
 * and that is deliberate: the refusal is what produces `'kept-pinned'`, so the
 * count of honoured choices is the store's own answer rather than this
 * function's opinion about what it decided to skip. A pinned slot still costs no
 * solver work — {@link solveTemplateFills} takes the pins as fixed input and
 * never queries them.
 *
 * Total over the scene. An instance naming a template this build does not ship
 * is reported and written to not at all, because there are no declared slots to
 * walk and rewriting its stored fills against a recipe nobody has would be
 * guessing.
 */
export function reSolveScene(
  instances: readonly TemplateInstance[],
  index: AssemblyIndex,
  context: SceneFillContext,
  write: FillWriter = fillSlot,
): SceneReSolve {
  const memo = new Map<string, TemplateFill>()
  const outcomes: Record<FillOutcome, number> = {
    filled: 0,
    unchanged: 0,
    'kept-pinned': 0,
    'unknown-placement': 0,
  }
  const unknownTemplates: PlacementId[] = []
  const unfilled: UnfilledReport[] = []
  const pinWarnings: PinLockWarning[] = []
  const perInstance: InstanceReSolve[] = []
  let slots = 0
  let solves = 0
  let cached = 0
  let queries = 0

  for (const instance of instances) {
    const template = context.templates(instance.template)
    if (template === undefined) {
      unknownTemplates.push(instance.id)
      perInstance.push({
        placement: instance.id,
        template: instance.template,
        fill: undefined,
        pinned: [],
        stale: [],
        cached: false,
      })
      continue
    }

    const pins = pinsOf(instance)
    const key = memoKey(instance.template, pins)
    const hit = memo.get(key)
    let fill = hit
    if (fill === undefined) {
      const preset: Record<string, TileId> = {}
      for (const [slot, pinned] of pins) preset[slot] = pinned.tile
      fill = solveTemplateFills(template, index, context, preset)
      memo.set(key, fill)
      solves += 1
      queries += fill.queries
    } else {
      cached += 1
    }

    slots += template.parts.length
    const stale: SlotName[] = []

    for (const decision of fill.decisions) {
      /* The one brand minted by assertion rather than by `SlotName.parse`. The
         name comes from the template table, which `pipeline/templates.ts`
         validated with the schema's own `PartSlot` — `min(1)`, which is every
         constraint the brand carries — so a parse here could only re-derive what
         the build already checked, and it could *throw*: this driver must not be
         able to take a room down over a part name the build accepted. The brand
         buys documentation at the argument position and nothing at the key
         position; `store/schema.ts#SlotName` records both halves. */
      const slot = decision.slot as SlotName
      const existing = instance.fills[slot]
      if (decision.tile === undefined) {
        if (existing !== undefined) stale.push(slot)
        unfilled.push({
          placement: instance.id,
          template: instance.template,
          slot,
          gap: decision.gap ?? 'closed-by-siblings',
          stale: existing?.tile,
        })
        continue
      }
      outcomes[write(instance.id, slot, decision.tile)] += 1
    }

    // The pin warnings read the *instance*'s pins rather than the solve's, so a
    // memo hit shared by two instances still reports each one's own pins — the
    // key makes them identical, and reading them here means that stays true if
    // the key ever widens.
    const lock = context.lock
    if (lock !== undefined) {
      for (const [slot, pinned] of pins) {
        const record = index.byId.get(pinned.tile)
        if (record === undefined || !locksAgainst(record, lock)) continue
        pinWarnings.push({
          placement: instance.id,
          template: instance.template,
          slot,
          tile: pinned.tile,
          offers: record.conn.filter((tag) => LOCK_SYSTEMS.has(tag)),
          wanted: lock,
          alternative: alternativeFor(context, index, record, lock),
        })
      }
    }

    perInstance.push({
      placement: instance.id,
      template: instance.template,
      fill,
      pinned: pins.map(([slot]) => slot),
      stale,
      cached: hit !== undefined,
    })
  }

  return {
    instances: instances.length,
    slots,
    solves,
    cached,
    queries,
    outcomes,
    unknownTemplates,
    unfilled,
    pinWarnings,
    perInstance,
  }
}
