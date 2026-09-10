/**
 * The bill of tiles, turned into something a 302px panel can render — and into
 * prose, which is the part that matters.
 *
 * `buildBillOfTiles` already does the arithmetic: the md5 dedupe, the byte
 * total, the threshold verdict and one rolled-up note per code. **None of that
 * is re-derived here.** What this module adds is the two things the panel needs
 * and the assembly layer deliberately does not supply:
 *
 *   1. **A route from a file back to the instances that asked for it.** A bill
 *      line is keyed by content address and names the catalog ids behind it, but
 *      not the instances — and row 17 was honest that the canvas is one tab stop
 *      with no move operation and a drawing that is not linearly readable, so the
 *      bill panel is where a placement has to become reachable and removable.
 *      Since row A1 the join needs nothing but the id: `ResolvedInstance.instance`
 *      carries the `PlacementId` that is also the store map's key, so
 *      {@link billInventory} is a lookup rather than a match on value.
 *
 *   2. **Prose per note code.** `BillNote.message` is written for one slot of
 *      one instance. A panel showing one entry per code with a count needs a
 *      sentence about the *class* of problem, and — for the ones that matter —
 *      what the user should do about it.
 *
 * ## What row A3 deleted from this module, and what row C4 put in its place
 *
 * Three surfaces went rather than being repointed, because the facts they
 * reported are no longer computed anywhere. **One replacement covers the first
 * and third of them, and it is {@link slotFaults}.**
 *
 *   - **`resolutionSummary` and `rowResolutionCopy`.** Both read
 *     `ResolvedPlacement.resolution`, a `VariantResolution` carrying a verdict,
 *     a variant count and an option tie. Rule 0 produced it: a placement named a
 *     *design* and the resolver chose the file. A fill names an exact **file**
 *     (decision D1), so nothing chooses at resolution time and there is no
 *     verdict to disclose — the user or row C2's solver put the file there.
 *     What arrived instead is the opposite question: not *which file did the app
 *     pick*, but **is the file the scene names wrong**, which rule 0
 *     structurally could not ask. {@link slotFaults} is that surface, over
 *     `ResolvedSlotFill.admissible` and the `fill-off-slot` note.
 *   - **`BillRow.autoBaseOnly` and the `base · added` marks.** They read
 *     `BillLine.baseQuantity`, which counted the copies rule 1 inserted. Nothing
 *     inserts a base: a template declares one as an ordinary slot, so every copy
 *     in the bill is a copy the scene asked for and a mark saying otherwise would
 *     be false for the whole corpus. **Nothing replaces it** — a quantity above
 *     one is now legitimate (contract C-c) and needs no mark. What it *does* need
 *     is provenance, and {@link BillLine.slots} is where that lives; see
 *     {@link slotsAsking}.
 *   - **Copy for eight note codes.** `no-matching-base`, `no-congruent-base`,
 *     `base-unmatchable`, `base-auto-inserted`, `base-already-on-plan`,
 *     `base-option-chosen`, `base-lock-mismatch` and `base-texture-mismatch` left
 *     `NoteCode` with rule 1. See {@link noteCopy} on where the archive's base
 *     gap went instead.
 *
 * ## Two facts A3 named as losses, and what row C4 decided about each
 *
 *   - **`unknown-joinery` does not come back, and the measurement is the
 *     reason.** It was the only surface for the items with no `connection|` tag
 *     anywhere — 351 of the 8,702 live records. Reached through the recipes it is
 *     almost nothing: of the **14,241 (slot, candidate) pairs** the 128 shipped
 *     template slots admit, **15 name such a record**, over **15 of the 2,990
 *     distinct md5s** admitted (0.11% of the pairs, 0.50% of the files). A fourth
 *     `warn` competing with `slot-unfilled` and `fill-off-slot` for a population
 *     that size is the wallpaper trade `notes.ts` refuses in the other direction
 *     for `build-unspecified`, and worse: it would be loud and almost never true.
 *     A joinery-less *candidate* is a fact about the pool a slot offers, so it
 *     belongs where the pool is — row **C3**'s slot editor — beside `baseGap`,
 *     and not in a bill written after the fills are chosen.
 *   - **`assembly/baseMatch.ts#baseGap` stays.** It is not computing into
 *     nothing: it is a pure classification of the *archive* with no bill caller
 *     by design, `@/assembly` exports it for the fill-time surfaces that do want
 *     it, and `src/generator/placement/corpus.test.ts` and
 *     `assembly/assembly.test.ts` both assert its 86 / 31 / 260 split against the
 *     live corpus. Deleting it would delete the answer C2 and C3 need before
 *     either has asked for it.
 *
 * Pure, DOM-free and store-free: it takes the bill and a snapshot of the
 * placements map, and returns data.
 */
import type {
  BillLine,
  BillNote,
  BillOfTiles,
  BillSlotRef,
  DownloadSize,
  NoteCode,
  ResolvedInstance,
  ResolvedSlotFill,
} from '@/assembly'
import type { BlobId, CatalogRecord, TileId } from '@/catalog'
import type { HoldName, PlacementId, SlotName, TemplateInstance } from '@/store'
import { countLabel } from '@/screens/catalog'

/* --------------------------------------------------------------- inventory */

/** One placed template instance, with the key needed to take it off the grid again. */
export interface BillPlacement {
  readonly id: PlacementId
  /**
   * The instance as the store holds it.
   *
   * A {@link TemplateInstance} since row A1: the whole recipe, its angle and its
   * fill per slot. It carries its own `id` as well, and the two agree by
   * construction — `placeTemplate` mints both from one value and
   * `store/migrations.ts` rewrites the field from the key — so the pair is not a
   * hazard this module has to close.
   */
  readonly instance: TemplateInstance
}

/** One file to print, and the instances that asked for it. */
export interface BillRow {
  readonly line: BillLine
  /**
   * The instances this file was pulled in for, in plan reading order.
   *
   * **One entry per instance, not per ask.** An instance whose recipe fills two
   * slots from the same file appears once here and contributes 2 to
   * `line.quantity`; `BillLine.slots` is the per-ask provenance and it is the
   * assembly layer's, not this module's. Ordered by depth then across rather
   * than by the order the user clicked: this is an inventory of a drawing, and
   * the question it answers is "which one is that", which is a spatial question.
   *
   * Empty is reachable and no longer means "a base nobody placed": a line whose
   * only askers are instances the store map does not hold — a bill built from
   * some other list — has no row to expand. Nothing in the app produces one.
   */
  readonly placements: readonly BillPlacement[]
}

export interface BillInventory {
  /** By copies descending, then by name — design-contract.md §2.4's order. */
  readonly rows: readonly BillRow[]
  /**
   * Instances the bill could not describe at all.
   *
   * An instance resolves to **no parts** two ways since row A3: this build ships
   * no template by that id, or every slot it declares is empty or filled with a
   * file this catalog has retired. Either way it appears in no line and would be
   * invisible in this panel while still sitting in the scene. Surfaced
   * separately and removable; the `unknown-template` and `unknown-tile` notes say
   * which of the two happened.
   *
   * An instance with *some* resolved parts is **not** an orphan — it is a row
   * with a hole in it, which `BillOfTiles.unfilled` reports and
   * `BillOfTiles.complete` refuses the download over.
   */
  readonly orphans: readonly BillPlacement[]
}

/**
 * Join the bill to the store.
 *
 * **On the `PlacementId`, and that is the whole of it.** Before row A1 a
 * placement had no id in it — the store's map key was the identity and
 * `bill.resolved` carried only the value — so the two had to be paired on a
 * four-field key with a queue behind it for the collisions, and the join then
 * had to pick the one part with `role === 'placed'` because rule 1 had added
 * another. All three of those are gone: an instance carries its id, a
 * `ResolvedInstance` carries the instance, and every part in the bill is a part
 * the scene asked for.
 *
 * An instance is attached to the line of **every** part it resolved to, which is
 * the substantive change and not a widening: a five-slot corner is five files,
 * and a panel that attached it to one of them would leave the other four
 * unexpandable and unremovable. Deduped per line, so an instance filling two
 * slots from one file is listed once.
 *
 * One pass over the placements, one over `bill.resolved`, one over the lines:
 * linear in the scene, and it touches the catalog not at all.
 */
export function billInventory(
  bill: BillOfTiles,
  placements: Readonly<Record<string, TemplateInstance>>,
): BillInventory {
  const held = new Map<PlacementId, BillPlacement>()
  for (const [id, instance] of Object.entries(placements)) {
    held.set(id as PlacementId, { id: id as PlacementId, instance })
  }

  const byBlob = new Map<BlobId, BillPlacement[]>()
  const claimed = new Set<PlacementId>()
  for (const resolved of bill.resolved) {
    const entry = held.get(resolved.instance.id)
    // A bill built from a list other than this map simply finds nothing, and the
    // leftovers fall through to `orphans` — the honest reading: the panel cannot
    // describe them.
    if (entry === undefined) continue
    if (resolved.parts.length === 0) continue
    claimed.add(entry.id)
    for (const blob of new Set(resolved.parts.map((part) => part.record.blob))) {
      const bucket = byBlob.get(blob)
      if (bucket === undefined) byBlob.set(blob, [entry])
      else bucket.push(entry)
    }
  }

  const rows = bill.lines.map((line) => ({
    line,
    placements: [...(byBlob.get(line.blob) ?? [])].sort(byPlanPosition),
  }))

  const orphans = [...held.values()].filter((entry) => !claimed.has(entry.id))

  return { rows: [...rows].sort(byCopiesThenName), orphans: orphans.sort(byPlanPosition) }
}

function byPlanPosition(a: BillPlacement, b: BillPlacement): number {
  if (a.instance.z !== b.instance.z) return a.instance.z - b.instance.z
  if (a.instance.x !== b.instance.x) return a.instance.x - b.instance.x
  return a.id < b.id ? -1 : 1
}

function byCopiesThenName(a: BillRow, b: BillRow): number {
  if (a.line.quantity !== b.line.quantity) return b.line.quantity - a.line.quantity
  if (a.line.tile.name !== b.line.tile.name) return a.line.tile.name < b.line.tile.name ? -1 : 1
  // The blob is the line's identity and is unique per line, so the order is
  // total and two runs over one scene produce the same panel.
  return a.line.blob < b.line.blob ? -1 : 1
}

/**
 * Which slots of one instance asked for one line's file.
 *
 * **The first consumer of {@link BillLine.slots}, and the field was added for
 * exactly this.** A line's `quantity` counts every part occurrence, so two slots
 * of one instance resolving to the same md5 give a quantity of 2 with a single
 * entry in `tileIds` — arithmetically right and silent about who asked. Row A3
 * added the per-ask provenance and nothing rendered it, so a `×2` on a row with
 * one placement under it was a number a user could not account for.
 *
 * Sorted already by `bill.ts#bySlotRef`, so this filters and does not reorder.
 *
 * **The refs themselves rather than their slot names**, since a ref may name an
 * accessory: `{ slot: 'wall', hold: 'torch' }` is *the torch in the wall*, and a
 * list of slot names would have said `wall` for both the wall and the torch in
 * it. Formatting the pair is the panel's, beside the rest of the row's copy.
 */
export function slotsAsking(line: BillLine, placement: PlacementId): readonly BillSlotRef[] {
  return line.slots.filter((ref) => ref.placement === placement)
}

/* -------------------------------------------------------------- slot faults */

/**
 * What is wrong with one slot of one instance.
 *
 * Four kinds rather than a boolean, because the four are four different things
 * to do about it and a user who is told only *"this slot is wrong"* has to open
 * the recipe to find out which:
 *
 *   - `off-slot` — the slot holds a file it does not admit. The fill is real, the
 *     catalog holds it, and `@/composition` says the slot's `require`, its `deny`
 *     or the `constrain` join against the siblings rules it out. **This is the
 *     state the pre-A3 resolver was structurally unable to express** — rule 0
 *     chose the file, so there was nothing to disagree with — and it is the
 *     reason this surface exists.
 *   - `retired` — the slot names a file that has left the archive. There is
 *     nothing to print and nothing to check.
 *   - `empty` — the slot has no entry at all.
 *   - `hole` — the slot is filled and the **file in it** leaves a required
 *     accessory slot with nothing printable in it: empty, or naming an accessory
 *     this build no longer holds. One level below the other four — the piece on
 *     the plan is complete and the print is not — and the only kind the slot
 *     editor cannot repair, because a recipe's dialog does not reach a file's own
 *     slots. `SlotFault.tile` tells the two apart.
 *   - `no-recipe` — the whole template is not in this build, so it has no
 *     declared slots to fault. One entry per instance, with no slot. Emitted so
 *     this function is total over the scene, and dropped by the panel: an
 *     instance that resolved to no parts is `BillInventory.orphans`' to render,
 *     and two blocks for one piece would offer two Remove buttons for it.
 *
 * `retired`, `empty`, `hole` and `no-recipe` all refuse the download
 * ({@link BillOfTiles.complete}); `off-slot` does not, and that split is §7's:
 * an unprintable pack is refused, a wrong build is disclosed. A user is told
 * which of the two they have.
 */
export type SlotFaultKind = 'off-slot' | 'retired' | 'empty' | 'hole' | 'no-recipe'

/** Where a fault is: a recipe's slot, and for a `hole` the accessory slot inside it. */
export interface FaultSubject {
  readonly slot: SlotName
  /** The `config.parts` name of the accessory slot. Present for `hole` alone. */
  readonly hold: HoldName | undefined
}

/** One faulty slot, with everything needed to name it and reach it. */
export interface SlotFault {
  readonly placement: PlacementId
  /** The instance, for its cell, its angle and the Remove action. */
  readonly instance: TemplateInstance
  /** The template id — the only identity a `no-recipe` instance is guaranteed to have. */
  readonly template: string
  /**
   * Which slot the fault is in, and — for a `hole` — which accessory slot of the
   * file filling it. `undefined` for `no-recipe` alone, which has no slots.
   *
   * **One field rather than two**, so a hold cannot be present without the slot
   * that carries it: the pair *is* the name of the fault (`wall › torch` is *the
   * torch socket in the wall*, where the slot alone would say `wall` for both),
   * and two independent optional fields would let a caller compose
   * `undefined › torch`.
   */
  readonly where: FaultSubject | undefined
  readonly kind: SlotFaultKind
  /** The file the slot names, present for `off-slot` and `retired`. */
  readonly tile: TileId | undefined
  /** The record behind it, present only for `off-slot` — a retired id resolves to nothing. */
  readonly record: CatalogRecord | undefined
  /** Whether the user pinned this fill or the default solver put it there. */
  readonly pinned: boolean
  /** Whether this fault refuses the download. `false` for `off-slot` alone. */
  readonly blocksDownload: boolean
}

/**
 * Every slot in the scene that is empty, retired, or holding a file it does not
 * admit.
 *
 * **This is the surface row A3 left and row A8 could not build.** Three things
 * were deleted from this module rather than repointed, and all three read facts
 * about a *choice the app made*: `resolutionSummary` and `rowResolutionCopy` read
 * a `VariantResolution`, and `BillRow.autoBaseOnly` read `BillLine.baseQuantity`.
 * Nothing chooses and nothing is inserted, so there is no decision left to
 * disclose — but an explicitly-filled instance can now be *wrong*, and until this
 * function the only trace of that was a rolled-up `fill-off-slot` note saying
 * **how many** slots were wrong and nothing about which.
 *
 * It reads {@link ResolvedSlotFill.admissible} — the third state is the point:
 * `undefined` means "nothing to check" (empty, or a retired id) and `false` means
 * "checked and wrong", and a boolean would have reported the first as the second.
 * `bill.notes` is the roll-up of the same conditions and stays the summary; this
 * is the list behind it, and the two cannot disagree because both are read off
 * `ResolvedInstance.slots` — and, for the `hole` kind, off `ResolvedInstance.holds`
 * one level down.
 *
 * Ordered by plan reading order and then by the template's own declared slot
 * order, so the list reads down the drawing rather than in whatever order the
 * store's map iterates. Nothing here touches the catalog or the store: an
 * instance is carried on `bill.resolved`, and a `no-recipe` instance is the one
 * case with no slots to walk.
 */
export function slotFaults(bill: BillOfTiles): readonly SlotFault[] {
  return [...bill.resolved]
    .sort(byInstancePosition)
    .flatMap((resolved) => faultsIn(resolved))
}

function faultsIn(resolved: ResolvedInstance): SlotFault[] {
  const { instance } = resolved
  const shared = { placement: instance.id, instance, template: instance.template }
  if (resolved.template === undefined) {
    return [
      {
        ...shared,
        where: undefined,
        kind: 'no-recipe',
        tile: undefined,
        record: undefined,
        pinned: false,
        blocksDownload: true,
      },
    ]
  }

  // In the template's declared order, which `ResolvedInstance.slots` already is,
  // and each slot followed by the holes in the file that fills it — so the list
  // reads down the piece rather than listing every recipe slot and then coming
  // back for the accessories.
  return resolved.slots.flatMap((slot) => {
    const kind = kindOf(slot)
    const own: SlotFault[] =
      kind === undefined
        ? []
        : [
            {
              ...shared,
              where: { slot: slot.slot, hold: undefined },
              kind,
              tile: slot.fill?.tile,
              record: slot.record,
              pinned: slot.fill?.pinned ?? false,
              blocksDownload: kind !== 'off-slot',
            },
          ]
    return [...own, ...holeFaults(resolved, slot.slot, shared)]
  })
}

/**
 * The **required accessory slots of one filled slot's file with nothing
 * printable in them** — the hole one level down.
 *
 * `resolveInstance` already refuses the download over these
 * (`ResolvedInstance.complete`), and `useArchiveDownload` already names them, so
 * before this the panel was the one surface that showed a scene with every slot
 * filled beside a refusal with nothing behind it. A doorway with no door is the
 * ordinary case rather than a contrived one: 1,047 of the archive's 1,244
 * accessory declarations omit `optional` and absence means required.
 *
 * **The condition is `record === undefined`, not `fill === undefined`**, because
 * that is exactly the condition `resolveInstance` refuses the download on. The
 * two ways to reach it are one empty socket and one accessory this build has
 * dropped, they are two different repairs, and {@link SlotFault.tile} carries
 * which — the same split {@link kindOf} makes between `empty` and `retired` one
 * level up.
 */
function holeFaults(
  resolved: ResolvedInstance,
  slot: SlotName,
  shared: { placement: PlacementId; instance: TemplateInstance; template: string },
): SlotFault[] {
  return resolved.holds
    .filter((held) => held.slot === slot && !held.optional && held.record === undefined)
    .map((held) => ({
      ...shared,
      where: { slot, hold: held.hold },
      kind: 'hole' as const,
      tile: held.fill?.tile,
      record: undefined,
      pinned: held.fill?.pinned ?? false,
      blocksDownload: true,
    }))
}

/**
 * The fault in one resolved slot, or `undefined` when there is none.
 *
 * An **optional** slot with nothing in it is not a fault — it is a decoration
 * declined — which is the one place this differs from
 * {@link BillOfTiles.unfilled}. No shipped template exercises it (`optional` is
 * absent from all 128 parts of the 40, and absence means required), so the branch
 * exists to keep this surface honest if one ever ships rather than because
 * anything reaches it today.
 */
function kindOf(slot: ResolvedSlotFill): SlotFaultKind | undefined {
  if (slot.record === undefined) {
    if (slot.fill !== undefined) return 'retired'
    return slot.optional ? undefined : 'empty'
  }
  return slot.admissible === false ? 'off-slot' : undefined
}

/** What one fault says, in the panel's own words. */
export interface SlotFaultCopy {
  /** The slot, named as a user reads it: `wall-on-tile corner · base`. */
  readonly subject: string
  /** One sentence: what is wrong. Ends in a full stop. */
  readonly reason: string
}

/**
 * A fault as prose.
 *
 * Separate from {@link slotFaults} for the reason {@link noteCopy} is separate
 * from `notes.ts`: the classification is data a test can assert on, and the
 * sentence is copy that gets rewritten without a semantic change. The `off-slot`
 * sentence names the pinned/solved distinction because it is the only actionable
 * part — a pinned fill is one the user chose and can re-choose, and a solved one
 * that has gone inadmissible means the constraint moved under it.
 */
export function slotFaultCopy(fault: SlotFault): SlotFaultCopy {
  // `template · slot › hold`, the spelling the download's refusal uses for the
  // same pair, so a user meets one name for one fault on both surfaces.
  const where =
    fault.where === undefined
      ? undefined
      : fault.where.hold === undefined
        ? fault.where.slot
        : `${fault.where.slot} › ${fault.where.hold}`
  const subject = where === undefined ? fault.template : `${fault.template} · ${where}`
  switch (fault.kind) {
    case 'off-slot':
      return {
        subject,
        reason:
          `${fault.record?.name ?? 'This file'} is not one of the files this slot admits, so it will print and ` +
          (fault.pinned
            ? 'will not fit. You pinned it; pick another file for the slot.'
            : 'will not fit. Nothing pinned it, so the recipe or the pieces beside it have moved since it was filled.'),
      }
    case 'retired':
      return {
        subject,
        reason: 'The file this slot names has left the archive, so there is nothing to print for it.',
      }
    case 'empty':
      return { subject, reason: 'Nothing is in this slot, and every slot of every recipe in this build is required.' }
    case 'hole':
      return {
        subject,
        reason:
          fault.tile === undefined
            ? 'The file in this slot opens an accessory slot it does not mark optional, and nothing is in it. ' +
              'Fill it under Accessory slots, below the parts list.'
            : 'The accessory in this required slot names a file this build no longer holds — pick another ' +
              'under Accessory slots, below the parts list.',
      }
    case 'no-recipe':
      return { subject, reason: 'This build ships no recipe by that name, so the piece has no slots to fill.' }
  }
}

function byInstancePosition(a: ResolvedInstance, b: ResolvedInstance): number {
  if (a.instance.z !== b.instance.z) return a.instance.z - b.instance.z
  if (a.instance.x !== b.instance.x) return a.instance.x - b.instance.x
  return a.instance.id < b.instance.id ? -1 : 1
}

/* -------------------------------------------------------------------- notes */

export interface NoteCopy {
  readonly code: NoteCode
  readonly severity: 'info' | 'warn'
  /** One line, with the count folded in. Never ends in a full stop. */
  readonly headline: string
  /** What it means and what to do about it. */
  readonly detail: string
}

/**
 * Prose for one rolled-up note.
 *
 * Exhaustive over {@link NoteCode} with no `default`, so adding a note to the
 * resolver is a compile error here rather than a silent blank in the panel. That
 * is the whole reason `notes.ts` made the union closed — and it is what caught
 * the eight codes row A3 deleted, which this function had copy for and could
 * never again be handed.
 *
 * **Nine codes, and the three that arrived are the three the pre-A3 resolver was
 * structurally unable to express**: a fill can now name a template this build
 * does not ship, leave a required slot empty, or sit in a slot that does not
 * admit it. The first two are what stop a download — `BillOfTiles.complete` —
 * and the copy below says so, because §7's rule is that a note informs and a
 * *zip* is the one thing that gets refused.
 *
 * The corpus figures quoted below are each measured in the module that owns the
 * fact, and are quoted here rather than restated as folklore:
 *
 *   - `slot-unfilled` — `PartSlot.optional` is absent on 1,050 of the 3,695 live
 *     tile slots and **absence means required**; over the 40 shipped templates it
 *     is absent from all 128 parts, so there is no template in the build for
 *     which an empty slot is acceptable (`assembly/resolve.ts#AssemblySlot`).
 *   - `fill-off-slot` — `config` is the one field A1's aggregate collapse is not
 *     lossless on: it varies within 828 aggregates (21.7%), which is how a
 *     *pinned* fill drifts out of the set its slot admits.
 *   - `build-unspecified` — 3,610 of the 14,241 `(slot, candidate)` pairs the 128
 *     shipped template slots admit, 25.35%. Quoted as the share of what the
 *     templates admit rather than of the whole archive (34.2%), because that is
 *     the population a user of this panel meets.
 *   - `no-footprint` — 726 corpus files, the same `foot.shape === 'none'`
 *     population rows W3, W4 and W5 moved tiles in and out of.
 *
 * **The archive's base gap is no longer here.** `no-matching-base` (86),
 * `no-congruent-base` (31) and `base-unmatchable` (260) had three paragraphs
 * apiece, written to say which of the three a reader had hit and whose problem it
 * was, and `assembly/baseMatch.ts#baseGap` still classifies all three. What went
 * is the *route* to this function: nothing inserts a base, so no bill emits the
 * codes, and the copy was unreachable rather than merely unused. A surface that
 * wants to warn a user that the piece they are about to fill a `base` slot with
 * does not exist has to ask `baseGap` at fill time — row **C2**'s solver and row
 * **C3**'s editor are where that question now lives, and neither is a bill note.
 */
export function noteCopy(note: BillNote): NoteCopy {
  const n = countLabel(note.count)
  // **`file`, not `piece` — row C4.** Four of these nine codes are counted per
  // *fill*, and the panel's heading counts placed *pieces*: an instance is up to
  // five files, so one noun for both made "3 pieces name no build system" read as
  // three things on the grid when it is three of one piece's five parts.
  const files = note.count === 1 ? 'file' : 'files'
  const has = note.count === 1 ? 'has' : 'have'
  const is = note.count === 1 ? 'is' : 'are'
  const base = { code: note.code, severity: note.severity }

  switch (note.code) {
    case 'unknown-tile':
      return {
        ...base,
        headline: `${n} filled ${note.count === 1 ? 'slot names a file' : 'slots name files'} not in this catalog build`,
        detail:
          'A file that leaves the archive keeps its retired id, so a saved room or an old share link can name ' +
          'one. It costs the slot and not the piece: the rest of the recipe still prints, and the empty slot is ' +
          'reported beside this. Pick another file for it, or take the piece off the grid.',
      }

    case 'unknown-template':
      return {
        ...base,
        headline: `${n} placed ${note.count === 1 ? 'piece names a recipe' : 'pieces name recipes'} this build does not ship`,
        detail:
          'A template family that leaves the build keeps its id, so a saved room or an old share link can name ' +
          'one. There are no slots to fill and nothing to print — take it off the grid and place the recipe you ' +
          'want in its place.',
      }

    case 'slot-unfilled':
      return {
        ...base,
        headline: `${n} ${note.count === 1 ? 'slot is' : 'slots are'} still empty`,
        detail:
          'Every slot of every recipe in this build is required — none of the 128 parts is marked optional — so ' +
          'an empty one is a hole in the print rather than a decoration declined. The piece stays on the grid ' +
          'and the download is refused until each one is filled: a zip one file short of a printable model ' +
          'still opens, and nobody would find out until the print failed.',
      }

    case 'fill-off-slot':
      return {
        ...base,
        headline: `${n} filled ${note.count === 1 ? 'slot holds a file it does not admit' : 'slots hold files they do not admit'}`,
        detail:
          'The file fails what the slot asks for — its own tags, or the join against the recipe and the pieces ' +
          'beside it. It will print and it will not fit. Each one is listed below by recipe, slot and cell. The ' +
          'solver cannot reach this state; a fill you pinned yourself can, once a lock change or a re-import has ' +
          'moved it out of the set, and so can a share link decoded against another build.',
      }

    case 'lock-unavailable':
      return {
        ...base,
        headline: `${n} ${files} ${has} no version in your lock system`,
        detail:
          'The tile names connectors, none of them the one you chose. It will print and it will stand; it will ' +
          'not join to the pieces either side of it.',
      }

    case 'no-footprint':
      return {
        ...base,
        headline: `${n} ${files} cannot be drawn on the plan`,
        detail:
          'The tile is in the bill and will be downloaded. The archive states no footprint for it, so it has no ' +
          'shape on the grid — 726 corpus tiles are in this state.',
      }

    case 'insert-on-grid':
      return {
        ...base,
        headline: `${n} ${files} ${is} ${note.count === 1 ? 'a component, not a tile' : 'components, not tiles'}`,
        detail:
          'A door or a window fits into a slot in another piece rather than onto the grid. Placing it standalone ' +
          'is fine for the bill of tiles and meaningless as a floor plan.',
      }

    case 'build-unspecified':
      return {
        ...base,
        headline: `${n} ${files} name no build system`,
        detail:
          'True of a quarter of everything the recipes in this build admit — 3,610 of 14,241 candidate files — ' +
          'so it is a fact rather than a fault. It means nothing checked whether these interleave with the rest ' +
          'of the scene.',
      }

    case 'hold-unknown-tile':
      return {
        ...base,
        headline: `${n} ${note.count === 1 ? 'accessory names a file' : 'accessories name files'} not in this catalog build`,
        detail:
          'A torch, a door or a grate fitted into one of your tiles names a file that has left the archive, so ' +
          'there is nothing to print for it. It costs the accessory and not the piece: the tile holding it still ' +
          'prints and still fits. Pick another for the slot, or take it out.',
      }

    case 'hold-off-slot':
      return {
        ...base,
        headline: `${n} ${note.count === 1 ? 'accessory sits in a slot its tile does not have' : 'accessories sit in slots their tiles do not have'}`,
        detail:
          'The tile declares no such accessory slot, so the file will print and there is nowhere on the piece it ' +
          'goes. Nothing in the app can put one there — a share link decoded against another build can, and so ' +
          'can a saved room whose tile has changed since.',
      }

    case 'hold-unplaced':
      return {
        ...base,
        headline: `${n} ${files} ${is} in the pack and not on the plan`,
        detail:
          'Nothing has measured where this accessory attaches to the tile holding it, so the plan cannot draw it. ' +
          'It is still downloaded once: the file you chose is in the pack, and where it goes is a gap in the ' +
          'measurement rather than in your room.',
      }

    case 'hold-unanchored':
      return {
        ...base,
        headline: `${n} ${files} ${is} in the pack and not on the plan`,
        detail:
          'Nothing has measured how this accessory plugs in — where its own peg, leaf or plate meets the tile — ' +
          'so the plan cannot draw it. It is still downloaded once: the file you chose is in the pack, and the ' +
          'gap is in the measurement rather than in your room.',
      }

    case 'mixed-build-systems':
      return {
        ...base,
        headline: 'This scene mixes construction systems',
        detail:
          'Separate-wall and wall-on-tile are two ways of building the same room and they do not interleave on ' +
          'the table. Pick one for a given wall run.',
      }
  }
}

/**
 * Whether the pack is refused over this note, which is what decides how loudly
 * the panel says it.
 *
 * **Two codes, and reading the gate rather than the copy is what found the
 * second one.** `BillOfTiles.complete` is `unfilled.length === 0`, and
 * `bill.ts#holesIn` fills that array from two conditions: a declared slot the
 * instance did not resolve, which `resolve.ts` reports as `slot-unfilled`, and
 * an instance whose **recipe is not in the build at all** — that arm returns
 * early with `unknown-template` alone and never reaches the per-slot walk, so
 * there is no `slot-unfilled` beside it. Both refuse the zip.
 *
 * `BillPanel` happens to filter `unknown-template` out before rendering, because
 * `OrphanBlock` is its better surface, so today the second code changes nothing
 * on screen. It is here anyway: this function answers *"is the download refused
 * over this"*, that is a fact about `bill.ts` and not about one panel's filter,
 * and a predicate that is only correct because of a caller's unrelated choice
 * fails the moment the caller changes its mind.
 *
 * The panel opened with every warning's `detail` in full until the sidebar was
 * cut back, and that was right about the note it was written for and wrong as a
 * rule for nine of them. `fill-off-slot`, `lock-unavailable` and
 * `mixed-build-systems` are each true, each advisory, and each two to four lines
 * — and three of those above a note that refuses the download is how the refusal
 * stops being legible. So an advisory note gives its headline and keeps its
 * reason one press away; these two do not.
 */
export function noteBlocksDownload(code: NoteCode): boolean {
  return code === 'slot-unfilled' || code === 'unknown-template'
}

/* ------------------------------------------------------------------ verdict */

export interface VerdictCopy {
  readonly verdict: 'large' | 'huge'
  readonly headline: string
  readonly detail: string
}

/**
 * What the size total means, or `null` when it means nothing yet.
 *
 * The thresholds and the arithmetic are `@/assembly`'s, and **row C4 restated
 * them in the unit that governs them rather than moving them.** A3 read its own
 * figure — one median-filled instance over about three files — as making 512 MB
 * stale by 2.58x, and that was an artefact of leaving the md5 dedupe out: the
 * threshold is on **distinct files**, and a room of 200 solver-filled instances
 * of the 40 shipped recipes is the same 36 files and the same 366,230,378 B as a
 * room of 50. `bill.ts#DOWNLOAD_LARGE_BYTES` carries the measurements.
 *
 * What that changed here is the **`large` sentence**, and it is a change of
 * subject rather than of tone. It said *"expect a long transfer"* and quoted the
 * whole-corpus median, which is the wrong fact twice over: the median file a
 * recipe admits is 11.26 MB rather than 10.36 MB, and for the browsers that have
 * no streaming save 512 MB is not a slow download but a **refused** one — the
 * same byte figure as `download/save.ts#BLOB_FALLBACK_LIMIT_BYTES`, checked by
 * `useArchiveDownload` before the first fetch. So the sentence now says which
 * browsers stop and which merely take a while, which is the only part a user can
 * act on.
 */
export function verdictCopy(size: DownloadSize): VerdictCopy | null {
  if (size.verdict === 'ok') return null
  const over = `Over ${thresholdLabel(size.threshold)} to download`
  return size.verdict === 'huge'
    ? {
        verdict: 'huge',
        headline: over,
        detail:
          'That is past what one browser download reliably finishes. Build the room in sections and take each ' +
          'one separately, or use the URL list and a download manager.',
      }
    : {
        verdict: 'large',
        headline: over,
        detail:
          'Chrome and Edge stream this straight to disk and only the transfer is long. Firefox and Safari — and ' +
          'every browser on iOS — have to hold the whole archive in memory instead, and past this point they ' +
          'refuse it outright rather than slowing down; nothing is fetched when that happens, and the URL list ' +
          'is offered in its place. This is about fifty distinct files: the median file these recipes use is ' +
          '11.3 MB, and each one is fetched once whatever its print count.',
      }
}

/** `512000000` → `512 MB`; `2000000000` → `2 GB`. Decimal, like every other size here. */
export function thresholdLabel(bytes: number): string {
  return bytes >= 1_000_000_000
    ? `${String(Number((bytes / 1_000_000_000).toFixed(1)))} GB`
    : `${String(Math.round(bytes / 1_000_000))} MB`
}
