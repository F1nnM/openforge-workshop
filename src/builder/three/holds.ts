/**
 * **Default holds** — the accessories a placed piece arrives holding.
 *
 * Row **A4b** made a fill a file and row **6** gave that file's own composition
 * slots somewhere to live: `SlotFill.holds`, a torch in a wall in a corner, one
 * level deep and no deeper. Nothing wrote them. Row **8** then made an empty
 * *required* accessory slot an incomplete bill and a refused download, which
 * turns *nothing writes them* into *nothing downloads*: 1,047 of the corpus's
 * 1,244 accessory declarations are required, so a wall with a torch socket
 * placed by a user who never opened the slot editor is a room that will not
 * pack. This module is the pass that fills them, and it fills them the way
 * `fills.ts` fills a template's own slots on placement — **by default, once, and
 * never over a choice the user made**.
 *
 * ## `undefined` is not `{}`, and the whole pass turns on it
 *
 * `schema.ts#SlotFill` states the tri-state and this is its consumer:
 *
 *   - **`holds === undefined` — never solved.** No pass has looked at this
 *     fill. Every fill written before row 6 is in this state, and so is every
 *     fill a placement writes today.
 *   - **`holds === {}` — solved, or emptied by the user.** Either this pass
 *     looked and the file's mounts admitted nothing, or `clearHold` took the last
 *     accessory out and deliberately left the empty map behind.
 *
 * So {@link missingHolds} asks only about `undefined`, and {@link fillHolds}
 * never writes `undefined` back. That is what makes {@link useHoldSolver}
 * idempotent without a ref, a flag or a generation counter: the write it makes
 * is the write that stops it being made again, and a user who emptied a socket
 * does not find a torch back in it on the next reload.
 *
 * ## Only the required slots, and never `base`
 *
 * A **required** slot with nothing in it is a hole in the print — that is row
 * 8's refusal — and an **optional** one is a decoration nobody asked for, so
 * filling it by default would put an idol in every aztlan treasure hollow in the
 * room. The pass therefore writes the required ones and marks the fill solved,
 * which is why an optional-only host comes back `{}` rather than being asked
 * about for ever.
 *
 * A slot the host has **built in** is skipped as well — `CatalogRecord.modelledIn`,
 * the measurement's verdict that the mesh already carries what the fixture asks
 * for. The three `floor,brazier+small.2x2` floors declare a `brazier` slot and
 * are 31.6–33.2 mm tall because the brazier is part of the print, so solving it
 * put a second brazier on the first and charged for it. `assembly/resolve.ts`
 * does not read such a slot as a hole either, so an unsolved one is a complete
 * piece rather than a refused download.
 *
 * `base` is not an accessory: it is A6's base *match*, `assembly/resolve.ts`
 * excludes it from `accessorySlots`, and a hold written for it would be read
 * back as `hold-off-slot` — a note about an accessory that does not fit a mount
 * the host declares. It never reaches this module at all, because
 * {@link pickerSlots} is `config.parts` without it; the exclusion is stated
 * again here so a reader does not have to follow the import to learn it.
 *
 * ## Why the walk is in declared order, and why the pick is fed back
 *
 * `constrain` reads **sibling selections**: a `door` chosen in one slot narrows
 * the `lintel` in the next. A pass that resolved every slot against the empty
 * selection would therefore pick a pair that cannot coexist and hand the bill
 * two files that do not fit each other. So each pick is written into the
 * selection before the next slot is resolved, and the order is the **fixture's**
 * — the same order `slotPicker.ts#siblingsOf` reads, for the same reason it
 * gives: C1's port builds its `require` list from insertion-ordered sets, so an
 * order derived from anything but the declaration would make the answer a
 * function of the walk rather than of the file.
 *
 * ## The ranking, in one sentence per clause
 *
 * The first option that is **not a dead end** (a dead end empties a sibling
 * *accessory* slot — no pick in this corpus does: the 416 that empty anything
 * empty the host's own `base` part, which is the room's slot and not a sibling,
 * and reading those as dead ends is what left every cut-stone door wall's
 * doorway and lintel notch empty — F2), **preferring the room design**
 * (`WorkshopState.design`, matched against the item's hoisted `texture` — the
 * same preference `fills.ts` passes the template solver as `FillContext.family`,
 * so a room set to `wood` gets a wood door rather than the tudor one that sorts
 * first), and otherwise **the lowest address**, which is `slotStates`' own order
 * and is stable across builds. Every hold is written `pinned: false`, because
 * the solver chose it and `pinned` means *the user did*.
 *
 * A required slot with **no live option** is left out rather than forced. 9 of
 * the 1,244 declarations have no candidate at all and a dead-end-only slot is
 * the same situation one step in; the bill already reports the gap, and writing
 * a hold that closes a sibling accessory slot to avoid an empty socket would
 * trade a reported hole for an unreported one.
 */
import { useEffect } from 'react'

import type { CatalogFile, CatalogRecord, TileId } from '@/catalog'
import { isModelledIn } from '@/catalog'
import type { CompositionIndex } from '@/composition'
import type { SlotOption, SlotSelection } from '@/screens/detail/slots'
import { compositionIndexFor, pickerSlots, slotStates } from '@/screens/detail/slots'
import type { HoldFill, PlacementId, SlotName, TemplateInstance } from '@/store'
import { HoldName, fillHolds, filledSlots, usePlacements, useRoomDesign, writeSilently } from '@/store'

/** The accessories one file's required mounts should arrive holding. */
export type SolvedHolds = Readonly<Record<HoldName, HoldFill>>

/** One fill that has never been solved, and the answer for it. */
export interface MissingHold {
  readonly id: PlacementId
  readonly slot: SlotName
  readonly holds: SolvedHolds
}

/**
 * Fit an accessory into every **required** composition slot one file declares.
 *
 * `{}` when it declares none, when they are all optional, and when nothing live
 * fits — three different facts with one shape, deliberately: to the store they
 * are the same answer, *this fill is solved*, and telling them apart is the
 * bill's job rather than the solver's.
 *
 * The index is `compositionIndexFor`'s `WeakMap` on the parsed file, so a second
 * call for a second fill of the same archive is a map lookup and shares the
 * 409,432-byte inverted index with the drawer, the variants table and the slots
 * panel. It is still **one lookup per call**, which is why {@link missingHolds}
 * resolves the index once and walks {@link solveFor} directly rather than
 * calling this in its loop.
 */
export function solveHolds(catalog: CatalogFile, parent: TileId, design: string | undefined): SolvedHolds {
  return solveFor(compositionIndexFor(catalog), recordsOf(catalog), parent, design)
}

/** {@link solveHolds} over an index the caller has already resolved. */
function solveFor(
  index: CompositionIndex,
  records: ReadonlyMap<string, CatalogRecord>,
  parent: TileId,
  design: string | undefined,
): SolvedHolds {
  const holds: Record<HoldName, HoldFill> = {}
  /* Mutated as the walk goes, so slot two is resolved against the file slot one
     chose — see the module note on `constrain`. */
  const selection: Record<string, TileId> = {}
  const host = records.get(parent)

  for (const slot of pickerSlots(index, parent)) {
    if (slot.optional === true) continue
    // The host was printed holding this one — a floor whose brazier is sculpted
    // on. Solving it would put a second brazier on the first and bill for it;
    // `assembly/resolve.ts` does not count it as a hole either, so leaving it
    // empty completes the fill rather than refusing the download.
    if (host !== undefined && isModelledIn(host, slot.name)) continue
    const pick = pickFor(index, parent, slot.name, selection, design)
    if (pick === undefined) continue
    selection[slot.name] = pick.variant.id
    holds[HoldName.parse(slot.name)] = { tile: pick.variant.id, pinned: false }
  }
  return holds
}

/**
 * Records by catalog id, built once per parsed file.
 *
 * `isModelledIn` takes a {@link CatalogRecord} and a `CompositionIndex` holds
 * none — it works in `TileId`s and tag postings — so this is the join, and it is
 * a `WeakMap` for `compositionIndexFor`'s reason: the map is 8,702 entries, this
 * pass runs on every store write, and keying on the parsed file pays for it once
 * and lets it be collected with the file. `builder/panels/slots/planSlots.ts`
 * keeps the same memo for the same join; the two are not shared because
 * `@/builder/three` must not import from a panel.
 */
const RECORDS = new WeakMap<CatalogFile, ReadonlyMap<string, CatalogRecord>>()

function recordsOf(file: CatalogFile): ReadonlyMap<string, CatalogRecord> {
  const cached = RECORDS.get(file)
  if (cached !== undefined) return cached
  const built = new Map(file.records.map((record) => [record.id as string, record]))
  RECORDS.set(file, built)
  return built
}

/**
 * The option one slot should take, resolved against what the walk has picked so
 * far.
 *
 * Re-resolving the whole parent per slot rather than once is what feeds the
 * siblings back, and it is affordable: a full resolution is **0.09 ms mean, 2.3
 * ms worst** over the real corpus and the archive's deepest file declares three
 * accessory slots.
 */
function pickFor(
  index: CompositionIndex,
  parent: TileId,
  name: string,
  selection: SlotSelection,
  design: string | undefined,
): SlotOption | undefined {
  const state = slotStates(index, parent, selection).find((one) => one.name === name)
  if (state === undefined) return undefined
  /* `slotStates` emits options in ascending address, so "the lowest address" is
     "the first survivor" and no second sort is needed. */
  const live = state.options.filter((option) => !option.deadEnd)
  const preferred = design === undefined ? undefined : live.find((option) => option.aggregate.texture === design)
  return preferred ?? live[0]
}

/**
 * Every placed fill that has **never been solved** and whose file has mounts to
 * solve, with the answer for each.
 *
 * *Declares* an accessory slot, not *requires* one: a host whose only slot is
 * optional is included and answers `{}`, which marks it solved and is the whole
 * reason it is never asked about again. A host that declares nothing but a
 * `base` — 2,031 files — is skipped instead, because there is nothing to record
 * and a `{}` for it would be a write per placement per reload.
 *
 * Pure: it reads the placements and answers, and {@link useHoldSolver} is the
 * only thing that writes.
 */
export function missingHolds(
  placements: Readonly<Record<string, TemplateInstance>>,
  catalog: CatalogFile,
  design: string | undefined,
): readonly MissingHold[] {
  const index = compositionIndexFor(catalog)
  const records = recordsOf(catalog)
  const out: MissingHold[] = []

  for (const [id, instance] of Object.entries(placements)) {
    for (const slot of filledSlots(instance.fills)) {
      const fill = instance.fills[slot]
      if (fill === undefined) continue
      if (fill.holds !== undefined) continue
      if (pickerSlots(index, fill.tile).length === 0) continue
      out.push({ id: id as PlacementId, slot, holds: solveFor(index, records, fill.tile, design) })
    }
  }
  return out
}

/**
 * Run the default-hold pass over the room, once per unsolved fill.
 *
 * Mounted beside the mesh store in `BuilderRoom`, which is where the room's
 * other derived-from-the-store work lives, and keyed on the placements and the
 * design: a placement adds fills to solve, and a design change is a different
 * answer for the fills placed after it — the ones already solved keep the
 * accessory they were given, exactly as {@link fillHolds} keeps a pinned one,
 * because re-solving a room under a preference change is `relock.ts`' gesture
 * and not this pass's.
 *
 * **The write is the termination condition.** Each `fillHolds` turns an
 * `undefined` into a map, the effect re-runs on the new placements, and
 * {@link missingHolds} then finds nothing — so the loop is one pass deep whether
 * it wrote one fill or forty, with no ref and no guard flag to get out of step
 * with the store.
 *
 * **Its writes are silent** — `@/store#writeSilently` — because they are the app
 * finishing a placement rather than a gesture of the user's, and an undo history
 * that recorded them could not step past them. That is the mechanism's whole
 * argument and it is written down there.
 *
 * `undefined` for the catalog is tolerated and does nothing. `BuilderRoom` takes
 * the file as a **required** prop, so the branch is not the app's state; it is
 * what lets the pass be mounted by anything holding an index it may not have
 * parsed yet, and it is asserted rather than assumed.
 */
export function useHoldSolver(catalog: CatalogFile | undefined): void {
  const placements = usePlacements()
  const design = useRoomDesign()

  useEffect(() => {
    if (catalog === undefined) return
    const missing = missingHolds(placements, catalog, design)
    if (missing.length === 0) return
    /* **Not an edit**, and `@/store#writeSilently` is where the argument lives:
       recorded as one, the write deadlocks undo rather than merely cluttering
       it — `Ctrl`+`Z` restores the unsolved fill, this effect re-solves it, and
       that change clears the redo branch and buries the placement underneath.
       The whole loop is wrapped rather than each call, because a room whose
       forty fills are solved on one hydrate is one non-gesture, not forty. */
    writeSilently(() => {
      for (const one of missing) {
        fillHolds(one.id, one.slot, one.holds)
      }
    })
  }, [placements, catalog, design])
}
