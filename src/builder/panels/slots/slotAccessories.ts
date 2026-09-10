/**
 * What the file in one filled slot holds: its accessory slots, what is in them,
 * and what each one costs.
 *
 * A composition slot is not a placement. `buildBillOfTiles` walks
 * `Object.values(placements)` and a torch in a wall's `torch` slot was never
 * placed on the grid, so nothing in the bill counts one and nothing in it can.
 * This module is that one question, resolved for **one (instance, slot) pair** —
 * a pure function of the index and the fill, with no store writes, no assembly
 * and no routing.
 *
 * ## It was an inventory over the whole plan, and the plan is not the unit any
 * more
 *
 * It answered *which accessory slots has this drawing left open* for a section
 * in the bill column: one pass over the placements, one holder per filled file,
 * a summary counting slots, holes and archive gaps. **Accessories are chosen in
 * the slot editor now** (finding F7: *"move the accessory choosing out of the
 * sidebar and into the tile/slots editing popup"*), and that surface already has
 * an instance and a slot in hand — the row the user pressed — so the plan-wide
 * pass had nobody left to ask it. What the editor needs is exactly what one
 * holder row carried, so the derivation survives per fill and the walk over the
 * placements is gone with the section that read it.
 *
 * ## The four facts a surface needs about a fill's accessories
 *
 * All four are read off the same values the assembly resolver reads, which is
 * what makes this panel's answer and the bill's one answer rather than two:
 *
 *   - {@link FillAccessories.slots} — the picker's own resolution, *against what
 *     the fill already holds*, so a filled slot shows its pick and a sibling's
 *     candidates are narrowed by the accessory that is really there.
 *   - {@link FillAccessories.mounts} — how many copies the bill charges for.
 *   - {@link FillAccessories.modelledIn} — the slots the host mesh was printed
 *     holding, which are satisfied rather than open.
 *   - {@link FillAccessories.gaps} — the required slots holding nothing this
 *     build can print, on `billView.ts#holeFaults`' condition exactly.
 *
 * ## What the corpus says a surface will actually run into
 *
 * Measured over all 8,702 files:
 *
 *   - **1,005 (11.5%) carry at least one accessory slot.** 2,031 carry only a
 *     `base` slot, which is A6's base match and not an accessory, and 5,666
 *     carry no config at all. So the common fill answers `undefined` here.
 *   - Accessory slots per file: **1 on 767 files, 2 on 237, 3 on one**. Nothing
 *     in the archive opens a fourth, which is why no surface over this needs
 *     virtualisation or a "show more".
 *   - **1,047 of the 1,244 accessory declarations are required** — `optional` is
 *     absent, and absence means required — so an unfilled accessory slot is
 *     usually a *hole in the print* rather than a decoration declined.
 *   - **9 of the 1,244 have no candidate whatsoever** in their initial state (5
 *     `fracture slope`, 4 `top`). That is an archive gap and not a task; the
 *     greying is the picker's and is shared rather than reimplemented, from
 *     `@/screens/detail/slots`.
 *
 * A resolution costs **0.09 ms mean, 2.3 ms worst** over the real corpus, so the
 * editor pays it per fill on every store write to the instance it is open on.
 */
import type { CatalogFile, CatalogRecord, TileId } from '@/catalog'
import { isModelledIn, mountsFor } from '@/catalog'
import type { SlotState } from '@/screens/detail/slots'
import { compositionIndexFor, slotStates } from '@/screens/detail/slots'
import type { HoldFill, HoldName, SlotFill } from '@/store'

/** The accessory slots of the file in one filled slot, resolved against its holds. */
export interface FillAccessories {
  /**
   * The file whose accessory slots these are.
   *
   * The fill's own `tile`, with no resolution step at all: a `SlotFill` names a
   * file, so the file being printed is the file in the scene. The picker
   * resolves against this — `config` is a property of a file, which is the whole
   * reason `CompositionIndex.resolve` takes a `TileId` parent.
   */
  readonly parent: TileId
  /** Its accessory slots, resolved against what the fill already holds. Never empty. */
  readonly slots: readonly SlotState[]
  /**
   * The same map as the picker's selection: accessory slot name to the file in
   * it.
   *
   * Derived here rather than by the caller, because {@link slots} was resolved
   * against this one — two spellings of it would be two chances for the grid to
   * show something the resolution did not see. `SlotFills` memoises on the
   * object it is handed, so a caller that memoises this whole value hands the
   * picker a stable one.
   */
  readonly selection: Readonly<Record<string, TileId>>
  /**
   * Measured mounts on this file, by accessory slot name.
   *
   * `mountsFor(record, slot).length` — the *places* an accessory attaches, which
   * is what `resolveInstance` bills a hold for on every mount but one: a `wide`
   * doorway is one opening authored for two leaves, so a bill sums
   * `catalog/mounts.ts#copiesOf` over these rather than counting them. A surface
   * says *how many mounts*, which is what the drawing shows.
   *
   * `0` is the ordinary reading rather than an error: `CatalogRecord.mounts` is
   * absent both for an unmeasured host and for one with no accessory slot.
   */
  readonly mounts: Readonly<Record<string, number>>
  /**
   * Slots of this file whose accessory is **already part of its mesh** —
   * `CatalogRecord.modelledIn`, measured.
   *
   * Still listed in {@link slots}, because the resolution reads them as
   * siblings; a surface says *built into this piece* and offers no grid. Not a
   * hole either: `assembly/resolve.ts` does not read one as a hole, and a panel
   * that did would report an incomplete print the bill is happy with.
   */
  readonly modelledIn: readonly string[]
  /**
   * The accessory slots that are a hole in the print: **required, and holding
   * nothing this build can print**.
   *
   * The condition is the resolver's rather than a second reading of it —
   * `resolveInstance` refuses the download for a required hold whose `record` is
   * missing, which is an empty slot *or* one naming a retired file, and
   * `billView.ts#holeFaults` faults exactly that. A surface that counted a
   * retired hold as filled would say *nothing outstanding* over a scene the bill
   * panel is refusing.
   */
  readonly gaps: readonly string[]
}

/**
 * The accessory slots of one fill, or `undefined` when there are none to show.
 *
 * `undefined` covers both misses and they are one answer to a caller: the fill
 * names a file this build has retired — the index holds no record, so what it
 * could hold is unknowable — or the file declares no accessory slot at all,
 * which is 88.5% of the archive.
 */
export function fillAccessories(file: CatalogFile, fill: SlotFill): FillAccessories | undefined {
  const records = recordsOf(file)
  const record = records.get(fill.tile)
  if (record === undefined) return undefined

  const selection = holdSelection(fill.holds)
  // Resolved against what is already in it, so a slot the piece has filled shows
  // its pick rather than an empty grid.
  const slots = slotStates(compositionIndexFor(file), fill.tile, selection)
  if (slots.length === 0) return undefined

  const modelledIn = slots.filter((slot) => isModelledIn(record, slot.name)).map((slot) => slot.name)

  return {
    parent: fill.tile,
    slots,
    selection,
    mounts: Object.fromEntries(slots.map((slot) => [slot.name, mountsFor(record, slot.name).length])),
    modelledIn,
    gaps: slots
      .filter((slot) => {
        // A slot the host was printed holding is not an open question: nothing
        // fills it, nothing is missing from the print, and the bill agrees.
        if (slot.optional || isModelledIn(record, slot.name)) return false
        // `chosen` rather than `holds`, because the states above were resolved
        // against the holds and this cannot give a second answer.
        return slot.chosen === undefined || !records.has(slot.chosen)
      })
      .map((slot) => slot.name),
  }
}

/* ------------------------------------------------------------- the lookups */

/**
 * A fill's holds as the picker's selection: slot name to the file in it.
 *
 * One shape, one derivation — see {@link FillAccessories.selection}.
 */
function holdSelection(
  holds: Readonly<Record<HoldName, HoldFill>> | undefined,
): Readonly<Record<string, TileId>> {
  return Object.fromEntries(Object.entries(holds ?? {}).map(([hold, held]) => [hold, held.tile]))
}

/**
 * Records by catalog id, built once per file.
 *
 * `mountsFor` takes a {@link CatalogRecord} and `CompositionIndex` holds none —
 * it works in `TileId`s and tag postings — so this is the join. A `WeakMap` for
 * `compositionIndexFor`'s reason: the map is 8,702 entries, this runs on every
 * store write to the open instance, and keying on the parsed file pays for it
 * once and lets it be collected with the file.
 */
const RECORDS = new WeakMap<CatalogFile, ReadonlyMap<string, CatalogRecord>>()

function recordsOf(file: CatalogFile): ReadonlyMap<string, CatalogRecord> {
  const cached = RECORDS.get(file)
  if (cached !== undefined) return cached
  const built = new Map(file.records.map((record) => [record.id as string, record]))
  RECORDS.set(file, built)
  return built
}
