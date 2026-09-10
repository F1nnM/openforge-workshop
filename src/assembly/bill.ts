/**
 * The bill of tiles — what a scene actually costs to print and to download.
 *
 * Three things this module gets right that a naive roll-up gets wrong, each of
 * them a measured corpus fact rather than a style preference:
 *
 *   1. **Dedupe by md5, not by tile id.** 171 md5 values are shared by 520
 *      catalog rows — the same physical STL filed under two paths, which is
 *      correct data modelling (a wall base belongs in both the "foundations" and
 *      the "separate wall" folder) and fatal to id-as-the-dedupe-key. Grouping
 *      by id would list one file twice and download it twice. The largest group
 *      holds nine rows.
 *
 *      And yet **both identities are needed at once**, which is why a line is
 *      not just a blob: the line is one file, and it still has to name the tiles
 *      that asked for it, or the user cannot tell which of their placements
 *      produced it. Row A3 sharpens that; see {@link BillLine.slots}.
 *
 *   2. **Size is a warning surface, not a footnote.** Corpus median is 10.36 MB,
 *      p95 32.89 MB, largest 108.9 MB; the median file the 40 shipped recipes
 *      admit is 11.26 MB. See {@link DOWNLOAD_LARGE_BYTES} for both thresholds
 *      restated in the one unit that governs them — the distinct file — and for
 *      why row A3's "stale by 2.58x" was an artefact of leaving the md5 dedupe
 *      out of the arithmetic.
 *
 *   3. **Filename collisions are surfaced, not resolved silently.** 89 filenames
 *      map to two or three genuinely different meshes — `tudor#door+narrow.stl`
 *      is three distinct md5s across five catalog paths. A zip that names
 *      entries by filename overwrites two of them and reports success.
 *
 * ## The md5 dedupe got *more* load-bearing, not less — contract C-c
 *
 * {@link accumulate} groups on `record.blob` and counts **every part
 * occurrence**, and under templates two slots of one instance can legitimately
 * resolve to the same file. That is a `quantity` of 2 on one line, and it is
 * correct: one download, two prints. Before A3 the only way to reach a quantity
 * above 1 was placing the same tile twice, or the auto-inserted base landing
 * under two toppers; now the commonest way is a recipe that asks for two of a
 * part.
 *
 * The note that used to fire on the near-miss of this is **gone**, and its
 * absence is deliberate rather than an oversight — see `notes.ts` on
 * `base-already-on-plan`. It keyed on `placement.x`/`z` and on
 * `tile?.layer === 'base'`, both of which are one record per placement, so under
 * a multi-slot instance a base fill in a non-primary slot would have been
 * invisible to it and the bill would have stopped warning while still compiling.
 * There is nothing left for it to warn about: the app inserts no base, so it
 * cannot ask for a second print of one.
 *
 * ## Accessories are counted per mount, and that is a fourth way to reach 2
 *
 * A fill may carry **holds** — the torch in the wall's socket — and a hold is
 * one file in as many places as the host has measured mounts for that slot: a
 * 1×1 full pillar carries a torch socket on each of its four faces. So a hold is
 * one {@link BillSlotRef} and a `quantity` of 4, which is the md5 dedupe's own
 * argument one level down (one download, four prints) and the reason
 * {@link accumulate} adds `AssemblyPart.quantity` rather than 1.
 *
 * Two lists come with it, and both exist so the bill and the plan agree about
 * what is in the room. {@link BillOfTiles.unfilled} gains the **required**
 * accessory slots nothing fills — 1,047 of the corpus's 1,244 declarations are
 * required, so those are holes in the print and they refuse the download exactly
 * as an empty template slot does. {@link BillOfTiles.unplaced} is the opposite
 * case: the file is chosen and billed, and no measurement says where it goes.
 */
import type { BlobId, CatalogRecord, TileId } from '@/catalog'
import type { HoldName, PlacementId, SlotName, TemplateInstance } from '@/store'

import type { AssemblyIndex } from './assemblyIndex'
import type { BillNote, Note } from './notes'
import { note, rollUpNotes } from './notes'
import type { AssemblyContext, AssemblyPart, ResolvedInstance } from './resolve'
import { resolveInstance } from './resolve'

/* ---------------------------------------------------------------- size limits */

/**
 * Where the download verdict changes, in bytes.
 *
 * **The unit is one distinct file, and that is row C4's correction.** Both
 * numbers were calibrated on *"fifty placements at the 10.36 MB corpus median"*,
 * a placement is now a template instance of three to five slots, and row A3
 * concluded from that arithmetic that the thresholds were stale by 2.58x. They
 * are not. {@link DownloadSize.bytes} is *"one copy per distinct md5, never per
 * part"* — {@link BillOfTiles.files}, not {@link BillOfTiles.parts} and not
 * {@link BillOfTiles.placements} — so the only unit either threshold can be
 * stated in is the distinct file, and neither of the other two determines it.
 *
 * Measured over the live corpus and the 40 shipped templates, taking every
 * distinct md5 any of the 128 declared slots admits:
 *
 * | | files | bytes |
 * | --- | ---: | ---: |
 * | distinct md5s the 128 slots admit | 2,990 | 37,047,210,327 |
 * | median one of them | 1 | 11,255,184 |
 * | p90 / p95 | 1 | 24,415,784 / 29,292,934 |
 * | **512 MB** | **45.5** | — |
 * | **2 GB** | **177.7** | — |
 *
 * So the file a builder user actually meets is **11.26 MB, 8.6% larger than the
 * 10.36 MB whole-corpus median** — not 2.58x anything. Restated in the unit that
 * governs them, the two thresholds are **about fifty distinct files** and **about
 * a hundred and eighty**, and both readings survived the change of what a
 * placement is.
 *
 * ## Why an instance count cannot appear here at all
 *
 * A3's model multiplies a median candidate per slot by the number of instances
 * and never dedupes, and the dedupe is the dominant term rather than a
 * correction. Two rooms built from the same 40 recipes, measured through
 * {@link buildBillOfTiles}:
 *
 * | instances | greedy-solver fills | every slot cycling its candidates |
 * | ---: | --- | --- |
 * | 20 | 23 files, 235,565,147 B, `ok` | 66 files, 546,609,140 B, `large` |
 * | 50 | 36 files, 366,230,378 B, `ok` | 139 files, 1,156,629,241 B, `large` |
 * | 100 | 36 files, 366,230,378 B, `ok` | 238 files, 2,173,063,288 B, `huge` |
 * | 200 | **36 files, 366,230,378 B, `ok`** | 367 files, 3,905,784,208 B, `huge` |
 *
 * The left column **saturates**: 40 recipes are the whole vocabulary and a
 * deterministic solver picks the same file for the same slot every time, so one
 * instance of each is 112 parts over 36 files and 366,230,378 B — 0.72x `large` —
 * and the two hundredth instance adds 0 bytes. **No scene of solver-filled
 * shipped recipes can trip `large` at all.** In the right column `large` first
 * fires at **19 instances / 63 files / 516,165,775 B** and `huge` at **90
 * instances / 220 files / 2,032,018,037 B**.
 *
 * So the instance count at which `large` fires is anywhere between **19 and
 * never**, which is why the docblock cannot name one. A3's own figure is exact
 * while parts and files coincide — 66 of each at twenty varied instances, where
 * its predicted 528 MB is 3.4% under the measured 546,609,140 B — and overstates
 * from there: at fifty it predicts
 * 1,319,740,600 B against a measured 1,156,629,241 varied (+14.1%) and
 * 366,230,378 solver-filled (**3.60x**).
 *
 * ## Neither number moves, and neither is a corpus fact
 *
 *   - **512 MB — `large`.** It is `download/save.ts#BLOB_FALLBACK_LIMIT_BYTES` to
 *     the byte, and that is a **refusal**: every browser with no
 *     `showSaveFilePicker` — iOS Safari always, plus Firefox and desktop Safari —
 *     buffers the whole archive to a `Blob`, and above this figure
 *     `useArchiveDownload` throws `ArchiveTooLargeToBufferError` before the first
 *     fetch. The warning is the forecast of that failure, so moving it either way
 *     would decouple the two: raise it and a room iOS Safari cannot save reads
 *     `ok`, lower it and the bill cries off a download that would have worked.
 *     That it also came out near "fifty placements at the median" is a
 *     coincidence the old docblock mistook for a derivation.
 *   - **2 GB — `huge`.** §11 reserves the Cloudflare Worker fallback for "iOS
 *     Safari and multi-GB rooms", and this is a transport judgement about one
 *     browser download finishing rather than a fact about tiles. In files it is
 *     ~178 median ones, and the measured crossing above is 220.
 *
 * Both are **decimal**, not binary. Every corpus size figure the plan quotes is
 * decimal (10.36 MB median, 108.0 GB total), `save.ts` spells its limit as
 * `512_000_000`, and a 512 MiB warning threshold would sit 7% above a
 * 512,000,000-byte refusal — the bill would read `ok` for an archive the browser
 * has already declined.
 *
 * `src/assembly/assembly.test.ts` recomputes every figure above against
 * `public/catalog/catalog.json` rather than restating it, so a corpus rebuild
 * that moved any of them fails the suite.
 */
export const DOWNLOAD_LARGE_BYTES = 512_000_000
export const DOWNLOAD_HUGE_BYTES = 2_000_000_000

export type DownloadVerdict = 'ok' | 'large' | 'huge'

export interface DownloadSize {
  /** Bytes to fetch: one copy per distinct md5, never per part. */
  bytes: number
  verdict: DownloadVerdict
  /** The threshold the verdict crossed, so the UI can say "over 512 MB" without a lookup table. */
  threshold: number
}

/**
 * The verdict for a byte total.
 *
 * Split out and exported because the builder's palette wants it for a
 * *prospective* total ("adding this would push you over") and recomputing a
 * whole bill to ask that would be absurd.
 */
export function downloadSize(bytes: number): DownloadSize {
  if (bytes >= DOWNLOAD_HUGE_BYTES) return { bytes, verdict: 'huge', threshold: DOWNLOAD_HUGE_BYTES }
  if (bytes >= DOWNLOAD_LARGE_BYTES) return { bytes, verdict: 'large', threshold: DOWNLOAD_LARGE_BYTES }
  return { bytes, verdict: 'ok', threshold: DOWNLOAD_LARGE_BYTES }
}

/* --------------------------------------------------------------------- lines */

/** One slot, in one instance, that asked for a line's file. */
export interface BillSlotRef {
  placement: PlacementId
  slot: SlotName
  /** The catalog id that slot named. Two slots may name different ids for one md5. */
  tile: TileId
  /**
   * The accessory slot of that slot's own file, when the asker is an accessory.
   *
   * Absent for a tile on the grid, so the pair `(slot, hold)` is the whole
   * address of an ask: *the torch in the wall of this piece*. One ref per ask
   * and not per copy — a four-socket pillar's torch is **one** ref carrying a
   * `quantity` of 4 on the line, because naming the same wall four times would
   * say four walls asked.
   */
  hold?: HoldName
}

/** One physical file to download, and every copy of it the scene asked for. */
export interface BillLine {
  /** The content address. **This is the line's identity.** */
  blob: BlobId

  /**
   * The catalog record this line is named and described by — the one whose `id`
   * sorts first among the tiles sharing this blob.
   *
   * Sorting rather than first-seen order, so the representative is a function of
   * the corpus and not of the order the user placed things in. Two runs over the
   * same scene therefore produce byte-identical bills, which is what makes a
   * snapshot test worth writing.
   */
  tile: CatalogRecord

  /** Every catalog id in this scene that resolved to this blob, sorted. Usually one. */
  tileIds: TileId[]

  /**
   * Every `(instance, slot)` that asked for this file, sorted.
   *
   * **The provenance {@link tileIds} cannot carry any more, and the reason is
   * arithmetic.** Two slots of one instance resolving to the same md5 give
   * `quantity: 2` with a single entry in `tileIds` — right about the count and
   * silent about who asked. `tileIds` is one id per *catalog path*, so it cannot
   * distinguish two askers of one path from one; this is one entry per ask.
   *
   * It matters because it leaves the app: `download/plan.ts` copies `tileIds`
   * into `ArchiveFileEntry.tileIds` and `download/attribution.ts` writes it to
   * `ATTRIBUTION.csv` as `catalogPaths`, so before A3 the csv could say a file
   * was printed twice and name one placement. Added as a separate field rather
   * than a widening of `tileIds`, because `src/download/**` is unchanged by this
   * row and those two type imports are its whole contract with this module.
   */
  slots: BillSlotRef[]

  /**
   * Copies to print.
   *
   * Counts every part occurrence, so two slots of one instance naming the same
   * file give 2. Contract **C-c**; see the module docblock.
   *
   * An accessory counts **once per measured mount** rather than once per hold —
   * a 1×1 full pillar carries a torch socket on each of its four faces, so one
   * `torch` hold in it is a quantity of 4 against a single entry in
   * {@link slots}. `AssemblyPart.quantity` is where that number is decided.
   */
  quantity: number

  /** Download cost — the file's size, once, whatever the quantity. */
  bytes: number

  /** `tile.file`. **Not unique**: 89 corpus filenames carry two or three meshes. */
  filename: string

  /** Another line in *this bill* publishes a different mesh under the same `filename`. */
  filenameCollides: boolean

  /**
   * A name unique within this bill: `filename` normally, the full catalog path
   * (`tile.id`) when it collides.
   *
   * The full path is the disambiguator that already exists in the data —
   * `id === family + '/' + filename` — and `CatalogFile` proves `id` unique at
   * parse time, so no further munging is needed and none is invented here.
   */
  entryName: string
}

/** A filename this bill publishes under more than one md5. */
export interface FilenameCollision {
  filename: string
  /** The distinct meshes, sorted. Two or three in every corpus case. */
  blobs: BlobId[]
  /** The disambiguated entry names, in the same order as `blobs`. */
  entryNames: string[]
}

/* ---------------------------------------------------------------------- bill */

/** A declared, non-optional slot this scene has not resolved to a file. */
export interface UnfilledSlot {
  placement: PlacementId
  /** The template id, so a caller can name the recipe without a second lookup. */
  template: string
  /**
   * The slot, or `undefined` when the whole template is unknown.
   *
   * An unknown template has no declared slots to name, and it is still an
   * instance that cannot be printed — so it is one entry here with no slot
   * rather than no entry at all, which is what keeps
   * {@link BillOfTiles.complete} from passing a scene whose recipes this build
   * has dropped.
   */
  slot: SlotName | undefined
  /**
   * The accessory slot of that slot's file, when the hole is one level down.
   *
   * Absent for an empty template slot, so the two are distinguishable without a
   * second lookup — *the wall is missing* and *the wall's torch is missing* are
   * different sentences and different repairs. Required accessory slots are the
   * majority: 1,047 of the 1,244 declarations in the corpus omit `optional`, and
   * absence means required.
   */
  hold?: HoldName
}

/**
 * A hold this bill counts and the plan cannot draw.
 *
 * The accessory is billed — one copy, {@link AssemblyPart.quantity}'s
 * `max(1, …)` — because the user chose the file and a pack without it is a pack
 * short. What is missing is not the file but the **measurement**: nothing has
 * read where a `torch` attaches to this host, so the room has nowhere to put it.
 *
 * It is listed rather than merely counted so the bill and the room agree about
 * what is drawn: `builder/canvas`'s `PlanScene.unplaced` is the same population
 * from the other side, and a bill that silently billed a file no surface renders
 * would leave a user counting torches in a zip that never appeared on the plan.
 */
export interface UnplacedHold {
  placement: PlacementId
  /** The template slot whose file holds it. */
  slot: SlotName
  hold: HoldName
  /** The accessory's own file. */
  tile: TileId
}

export interface BillOfTiles {
  /** One per distinct md5, ordered by catalog path. */
  lines: BillLine[]

  /** Template instances the bill was built from. */
  placements: number

  /**
   * Parts those instances resolved to — one per **copy to print**.
   *
   * Greater than `placements` for every instance with more than one filled slot,
   * which is all of them in practice: the 40 shipped templates declare 3-5 parts
   * each, 128 over 40. It counts fills and not slots, so an instance with a hole
   * in it contributes less than its recipe asks for, and `unfilled` says where.
   *
   * **A hold counts once per measured mount**, the same as {@link copies}: it is
   * the number the panel renders as *"N parts to print"*, and one torch in a
   * four-socket pillar is four things to print. Summing `AssemblyPart.quantity`
   * rather than counting the array is what keeps the two agreeing, which they
   * always did before a part could cost more than one print.
   */
  parts: number

  /** Distinct files to download — `lines.length`. */
  files: number

  /** Copies to print — the sum of `quantity`, which counts a reused file twice. */
  copies: number

  download: DownloadSize

  /** Per-code roll-up. `warn` before `info`; see `notes.ts`. */
  notes: BillNote[]

  /** Filenames this bill publishes under more than one md5. */
  collisions: FilenameCollision[]

  /**
   * Every declared non-optional slot in the scene resolved to a file.
   *
   * **The download gate.** Before A3 a missing file cost a whole placement and
   * emitted a visible `unknown-tile` note, so a bill was either right or
   * obviously wrong. Per-slot, a miss on one of five slots yields a *plausible*
   * bill and a zip one file short of a printable model — the same failure the
   * generated-mesh path already refuses rather than shipping (row S5).
   *
   * **Every slot of every shipped template is required**, so this gate applies
   * to all of them: `PartSlot.optional` is absent on 1,050 of the 3,695 live
   * tile slots and absence means required, and measured over the 40 templates it
   * is absent from all 128 parts. There is no template in the build for which an
   * empty slot is acceptable.
   *
   * A caller that offers a download must consult this; `useArchiveDownload.ts`
   * is the one that does, and `src/download/**` deliberately takes no part in
   * the decision because a plan is built from lines and cannot see the holes
   * between them.
   */
  complete: boolean

  /** Where the holes are — a template slot, or an accessory slot of one. Empty iff {@link complete}. */
  unfilled: UnfilledSlot[]

  /**
   * Holds with no measured mount on their host. See {@link UnplacedHold}.
   *
   * **Not a hole and not part of the gate**: the file is chosen and the download
   * carries it. It is here so a caller can say why the plan is drawing fewer
   * accessories than the bill lists.
   */
  unplaced: UnplacedHold[]

  /** Every instance, resolved — so the canvas and the panel share one pass. */
  resolved: ResolvedInstance[]
}

interface Group {
  blob: BlobId
  records: Map<TileId, CatalogRecord>
  slots: BillSlotRef[]
  quantity: number
}

/**
 * Roll a scene up into a bill.
 *
 * An empty scene returns an empty bill — zero lines, zero bytes, verdict `ok`,
 * no notes, and `complete: true` — rather than throwing or returning a null. The
 * builder renders the panel before anything is placed, so "nothing here yet" is
 * the *first* state this function is asked about, not an edge case. An empty
 * scene is complete because there is nothing in it that is missing; refusing the
 * download of an empty scene is `download/plan.ts`'s `EmptyArchiveError`, and it
 * already does.
 *
 * One pass over the instances, one over the groups: linear in the scene, and
 * independent of catalog size because {@link AssemblyIndex} and
 * {@link AssemblyContext.composition} have already paid that cost.
 */
export function buildBillOfTiles(
  instances: Iterable<TemplateInstance>,
  index: AssemblyIndex,
  context: AssemblyContext,
): BillOfTiles {
  const resolved: ResolvedInstance[] = []
  const groups = new Map<BlobId, Group>()
  const notes: Note[] = []
  const unfilled: UnfilledSlot[] = []
  const unplaced: UnplacedHold[] = []
  let parts = 0

  for (const instance of instances) {
    const result = resolveInstance(instance, index, context)
    resolved.push(result)
    notes.push(...result.notes)
    unfilled.push(...holesIn(result))
    unplaced.push(...undrawableIn(result))

    for (const part of result.parts) {
      parts += part.quantity
      accumulate(groups, instance.id, part)
    }
  }

  const lines = toLines(groups)
  notes.push(...mixedBuildNote(resolved))

  return {
    lines,
    placements: resolved.length,
    parts,
    files: lines.length,
    copies: lines.reduce((total, line) => total + line.quantity, 0),
    download: downloadSize(lines.reduce((total, line) => total + line.bytes, 0)),
    notes: rollUpNotes(notes),
    collisions: collisionsIn(lines),
    complete: unfilled.length === 0,
    unfilled,
    unplaced,
    resolved,
  }
}

/**
 * The declared non-optional slots one instance did not resolve.
 *
 * Read off {@link ResolvedInstance.slots} rather than recomputed, so the gate
 * and the `slot-unfilled` notes cannot disagree about what is missing — they are
 * the same condition read twice from the same array.
 */
function holesIn(result: ResolvedInstance): UnfilledSlot[] {
  const template = result.instance.template
  if (result.template === undefined) return [{ placement: result.instance.id, template, slot: undefined }]
  const placement = result.instance.id
  return [
    ...result.slots
      .filter((slot) => !slot.optional && slot.record === undefined)
      .map((slot) => ({ placement, template, slot: slot.slot })),
    // The same condition one level down, and `record === undefined` rather than
    // `fill === undefined` for the same reason it is written that way above: an
    // empty required accessory slot and one naming a file that has left the
    // archive are the same missing print, and `hold-unknown-tile` beside it says
    // which of the two happened.
    ...result.holds
      .filter((held) => !held.optional && held.record === undefined)
      .map((held) => ({ placement, template, slot: held.slot, hold: held.hold })),
  ]
}

/**
 * The holds one instance bills and no surface can draw.
 *
 * Read off {@link ResolvedInstance.holds} rather than recomputed, for
 * {@link holesIn}'s reason: the `hold-unplaced` and `hold-unanchored` notes and
 * this list are the same conditions read twice from the same array, so they
 * cannot disagree.
 *
 * **Either half of the pair unmeasured puts the hold here**, and one row when
 * both are: the list answers *"what is in the pack and not on the plan"*, which
 * is one fact about one accessory however many ways it came about.
 */
function undrawableIn(result: ResolvedInstance): UnplacedHold[] {
  const out: UnplacedHold[] = []
  for (const held of result.holds) {
    // A loop rather than `filter().map()`, and the reason is the same one
    // `Filled` is a union for: this condition narrows `record` to a
    // `CatalogRecord`, where a filtered array would need an assertion to read
    // its `id`.
    if (held.record === undefined) continue
    if (held.mounts > 0 && held.record.anchor !== undefined) continue
    out.push({ placement: result.instance.id, slot: held.slot, hold: held.hold, tile: held.record.id })
  }
  return out
}

function accumulate(groups: Map<BlobId, Group>, placement: PlacementId, part: AssemblyPart): void {
  const record = part.record
  const existing = groups.get(record.blob)
  const group =
    existing ??
    ({ blob: record.blob, records: new Map<TileId, CatalogRecord>(), slots: [], quantity: 0 } satisfies Group)
  if (existing === undefined) groups.set(record.blob, group)

  group.records.set(record.id, record)
  group.slots.push({
    placement,
    slot: part.slot,
    tile: record.id,
    ...(part.hold === undefined ? {} : { hold: part.hold }),
  })
  // **`part.quantity`, not `1`** — the one arithmetic change holds made to this
  // module. A template slot is one place on the grid and always contributes 1; a
  // hold contributes one copy per measured mount, so the torch of a four-socket
  // pillar is a single ask worth four prints of one download.
  group.quantity += part.quantity
}

/**
 * Turn the groups into lines, naming each one and flagging the collisions.
 *
 * Collision detection runs over the **bill**, not the corpus: a scene holding
 * one `tudor#door+narrow.stl` needs no prefix, and prefixing it anyway would
 * bury every entry under a five-level directory for a collision that is not in
 * the zip. When two lines do collide, *both* take the long name — leaving one on
 * the bare filename would be a trap for anyone reading the archive.
 */
function toLines(groups: Map<BlobId, Group>): BillLine[] {
  const sorted = [...groups.values()]
    .map((group) => {
      const records = [...group.records.values()].sort(byId)
      // Non-empty by construction: a group exists only because a record was added.
      const tile = records[0] as CatalogRecord
      return { group, records, tile }
    })
    .sort((a, b) => byId(a.tile, b.tile))

  const filenameCounts = new Map<string, number>()
  for (const { tile } of sorted) {
    filenameCounts.set(tile.file, (filenameCounts.get(tile.file) ?? 0) + 1)
  }

  return sorted.map(({ group, records, tile }) => {
    const collides = (filenameCounts.get(tile.file) ?? 0) > 1
    return {
      blob: group.blob,
      tile,
      tileIds: records.map((record) => record.id),
      slots: [...group.slots].sort(bySlotRef),
      quantity: group.quantity,
      bytes: tile.bytes,
      filename: tile.file,
      filenameCollides: collides,
      entryName: collides ? tile.id : tile.file,
    }
  })
}

function collisionsIn(lines: readonly BillLine[]): FilenameCollision[] {
  const byFilename = new Map<string, BillLine[]>()
  for (const line of lines) {
    if (!line.filenameCollides) continue
    const existing = byFilename.get(line.filename)
    if (existing === undefined) byFilename.set(line.filename, [line])
    else existing.push(line)
  }

  return [...byFilename.entries()]
    .map(([filename, group]) => ({
      filename,
      blobs: group.map((line) => line.blob),
      entryNames: group.map((line) => line.entryName),
    }))
    .sort((a, b) => ascending(a.filename, b.filename))
}

/**
 * The one bill-level note: this scene mixes construction systems.
 *
 * `separate wall` (3,351 tiles) and `wall on tile` (863) are different ways of
 * building the same room and do not interleave on the table. It is a warning
 * rather than a refusal for the same reason as everything else here — 2,978
 * tiles (34.2%) name no build system at all, so "mixed" is a judgement about the
 * tiles that *did* say, and those are never the whole scene.
 *
 * **It reads every part of every instance**, which is not where it used to look.
 * It read one `tile?.build` per placement, and a placement now holds up to five
 * files: a scene whose floors are `separate wall` and whose walls are `wall on
 * tile` would have shown one system per instance and no mix at all. That is the
 * silent form of this failure — the absence of a note is indistinguishable from
 * nothing being wrong — and it is the reason the loop is over `parts` and not
 * over `resolved`.
 */
function mixedBuildNote(resolved: readonly ResolvedInstance[]): Note[] {
  const systems = new Set<string>()
  for (const instance of resolved) {
    for (const part of instance.parts) {
      if (part.record.build !== undefined) systems.add(part.record.build)
    }
  }
  if (systems.size < 2) return []
  const listed = [...systems].sort().join(', ')
  return [note('mixed-build-systems', `this scene mixes ${listed}, which do not interleave on the table.`)]
}

function byId(a: CatalogRecord, b: CatalogRecord): number {
  return ascending(a.id, b.id)
}

/**
 * Total, so a line's provenance list is a function of the scene and not of
 * iteration order.
 *
 * The `hold` leg is what keeps it total now that one slot can ask twice: a wall
 * holding a `torch` and a `lintel` cut from the same file is two refs agreeing
 * on all three of the other keys.
 */
function bySlotRef(a: BillSlotRef, b: BillSlotRef): number {
  if (a.placement !== b.placement) return ascending(a.placement, b.placement)
  if (a.slot !== b.slot) return ascending(a.slot, b.slot)
  if (a.tile !== b.tile) return ascending(a.tile, b.tile)
  return ascending(a.hold ?? '', b.hold ?? '')
}

function ascending(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
