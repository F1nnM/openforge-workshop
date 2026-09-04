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
 * ## What row A3 deleted from this module, and what row A8 could not replace
 *
 * Three surfaces are gone rather than repointed, because the facts they reported
 * are no longer computed anywhere:
 *
 *   - **`resolutionSummary` and `rowResolutionCopy`.** Both read
 *     `ResolvedPlacement.resolution`, a `VariantResolution` carrying a verdict,
 *     a variant count and an option tie. Rule 0 produced it: a placement named a
 *     *design* and the resolver chose the file. A fill names an exact **file**
 *     (decision D1), so nothing chooses at resolution time and there is no
 *     verdict to disclose — the user or row C2's solver put the file there. The
 *     seven `PlacementVerdict`s and their copy went with the type, including the
 *     `unknown-joinery` mark that was the only surface for the 93 items with no
 *     joinery tag anywhere. **Row C4 owns what the bill discloses about a fill**,
 *     and `ResolvedSlotFill.admissible` plus the `fill-off-slot` note are the
 *     facts it has to work from.
 *   - **`BillRow.autoBaseOnly` and the `base · added` marks.** They read
 *     `BillLine.baseQuantity`, which counted the copies rule 1 inserted. Nothing
 *     inserts a base: a template declares one as an ordinary slot, so every copy
 *     in the bill is a copy the scene asked for and a mark saying otherwise would
 *     be false for the whole corpus.
 *   - **Copy for eight note codes.** `no-matching-base`, `no-congruent-base`,
 *     `base-unmatchable`, `base-auto-inserted`, `base-already-on-plan`,
 *     `base-option-chosen`, `base-lock-mismatch` and `base-texture-mismatch` left
 *     `NoteCode` with rule 1. The archive's base gap is still a fact —
 *     `assembly/baseMatch.ts#baseGap` measures it at 86 / 31 / 260 over 4,363
 *     toppers — but **no bill can emit one**, so the copy had no reachable caller
 *     and `noteCopy` would have gone on rendering three paragraphs the panel can
 *     never be handed. `unknown-template`, `slot-unfilled` and `fill-off-slot`
 *     arrived in their place and are written below.
 *
 * Pure, DOM-free and store-free: it takes the bill and a snapshot of the
 * placements map, and returns data.
 */
import type { BillLine, BillNote, BillOfTiles, DownloadSize, NoteCode } from '@/assembly'
import type { BlobId } from '@/catalog'
import type { PlacementId, TemplateInstance } from '@/store'
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
  const pieces = note.count === 1 ? 'piece' : 'pieces'
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
          'beside it. It will print and it will not fit. The solver cannot reach this state; a fill you pinned ' +
          'yourself can, once a lock change or a re-import has moved it out of the set, and so can a share link ' +
          'decoded against another build.',
      }

    case 'lock-unavailable':
      return {
        ...base,
        headline: `${n} ${pieces} ${has} no version in your lock system`,
        detail:
          'The tile names connectors, none of them the one you chose. It will print and it will stand; it will ' +
          'not join to the pieces either side of it.',
      }

    case 'no-footprint':
      return {
        ...base,
        headline: `${n} ${pieces} cannot be drawn on the plan`,
        detail:
          'The tile is in the bill and will be downloaded. The archive states no footprint for it, so it has no ' +
          'shape on the grid — 726 corpus tiles are in this state.',
      }

    case 'insert-on-grid':
      return {
        ...base,
        headline: `${n} ${pieces} ${is} ${note.count === 1 ? 'a component, not a tile' : 'components, not tiles'}`,
        detail:
          'A door or a window fits into a slot in another piece rather than onto the grid. Placing it standalone ' +
          'is fine for the bill of tiles and meaningless as a floor plan.',
      }

    case 'build-unspecified':
      return {
        ...base,
        headline: `${n} ${pieces} name no build system`,
        detail:
          'True of a quarter of everything the recipes in this build admit — 3,610 of 14,241 candidate files — ' +
          'so it is a fact rather than a fault. It means nothing checked whether these interleave with the rest ' +
          'of the scene.',
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

/* ------------------------------------------------------------------ verdict */

export interface VerdictCopy {
  readonly verdict: 'large' | 'huge'
  readonly headline: string
  readonly detail: string
}

/**
 * What the size total means, or `null` when it means nothing yet.
 *
 * The thresholds and the arithmetic are `@/assembly`'s. **The two constants no
 * longer mean what they were chosen to mean, and row A3 left them alone
 * deliberately**: 512 MB was fifty *placements* at the corpus median and 2 GB was
 * fifty at p95, and a placement is now a template instance of three to five
 * files. Measured, one median-filled instance is 26,394,812 B over about three
 * files — so twenty instances already trip `large` at 528 MB where twenty tiles
 * did not, and fifty are about 1.32 GB. Recalibrating needs the solver row C2 has
 * not shipped, because the figure above takes the *median* candidate rather than
 * the one a solver picks and is before the md5 dedupe; row **C4** restates the
 * thresholds in parts rather than in placements. All this function adds is the
 * sentence, and the sentence is true at either calibration.
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
          'Expect a long transfer: the median model in this archive is 10.4 MB on its own, and every distinct ' +
          'file is fetched once whatever its quantity.',
      }
}

/** `512000000` → `512 MB`; `2000000000` → `2 GB`. Decimal, like every other size here. */
export function thresholdLabel(bytes: number): string {
  return bytes >= 1_000_000_000
    ? `${String(Number((bytes / 1_000_000_000).toFixed(1)))} GB`
    : `${String(Math.round(bytes / 1_000_000))} MB`
}
