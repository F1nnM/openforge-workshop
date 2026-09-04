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
 *      p95 32.87 MB, largest 108.9 MB. See {@link DOWNLOAD_LARGE_BYTES} for what
 *      row A3 measured about the two thresholds and why it did not move them.
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
 */
import type { BlobId, CatalogRecord, TileId } from '@/catalog'
import type { PlacementId, SlotName, TemplateInstance } from '@/store'

import type { AssemblyIndex } from './assemblyIndex'
import type { BillNote, Note } from './notes'
import { note, rollUpNotes } from './notes'
import type { AssemblyContext, AssemblyPart, ResolvedInstance } from './resolve'
import { resolveInstance } from './resolve'

/* ---------------------------------------------------------------- size limits */

/**
 * Where the download verdict changes, in bytes.
 *
 * Both numbers came from the corpus rather than from round-number instinct:
 *
 *   - **512 MB — `large`.** Fifty placements at the 10.36 MB median is 518 MB,
 *     so a median fifty-tile room trips this and a median twenty-tile room does
 *     not.
 *   - **2 GB — `huge`.** Fifty placements at the p95 of 32.87 MB is 1.64 GB, and
 *     §11 reserves the Cloudflare Worker fallback for "iOS Safari and multi-GB
 *     rooms".
 *
 * Both are **decimal**, not binary, and that is not sloppiness: every corpus
 * size figure the plan quotes is decimal (10.36 MB median, 108.0 GB total), and
 * a 512 MiB threshold would put the median fifty-tile room *under* the line the
 * median fifty-tile room is supposed to be the reason for.
 *
 * ## Row A3 invalidated the calibration and deliberately did not move it
 *
 * Both thresholds are calibrated on *"fifty placements at the corpus median
 * file"*, and **a placement is no longer one file**. Measured on the live corpus
 * over the 40 shipped templates, taking the median-sized candidate for each
 * declared slot:
 *
 * | | files | bytes |
 * | --- | ---: | ---: |
 * | one instance, median | 3 | 26,394,812 |
 * | one instance, min / max | 3 / 5 | 10,019,059 / 44,321,212 |
 * | **fifty instances, median** | **150** | **1,319,740,600** |
 *
 * So a median fifty-instance room is **2.58x the `large` threshold and 66% of
 * the `huge` one**, where a median fifty-*tile* room was 1.01x and 26%. The
 * sentence "fifty placements at the median trips `large` and twenty does not" is
 * now false: **twenty instances is 528 MB and trips it too**, and the number of
 * instances that fits under 2 GB is about 75 rather than 193.
 *
 * Restating the thresholds is **row C4's**, and it is flagged rather than done
 * here for a reason A3 can see and C4 owns: the figures above are before the md5
 * dedupe, and they take the *median* candidate rather than the one a solver
 * picks, so the honest recalibration needs the solver row C2 has not shipped
 * yet. Moving them on this row's numbers would be swapping a stale calibration
 * for a differently stale one, and burying the fact that a placement changed
 * size.
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
}

export interface BillOfTiles {
  /** One per distinct md5, ordered by catalog path. */
  lines: BillLine[]

  /** Template instances the bill was built from. */
  placements: number

  /**
   * Parts those instances resolved to — one per **resolved** fill.
   *
   * Greater than `placements` for every instance with more than one filled slot,
   * which is all of them in practice: the 40 shipped templates declare 3-5 parts
   * each, 128 over 40. It counts fills and not slots, so an instance with a hole
   * in it contributes less than its recipe asks for, and `unfilled` says where.
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

  /** Where the holes are. Empty iff {@link complete}. */
  unfilled: UnfilledSlot[]

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
  let parts = 0

  for (const instance of instances) {
    const result = resolveInstance(instance, index, context)
    resolved.push(result)
    notes.push(...result.notes)
    parts += result.parts.length
    unfilled.push(...holesIn(result))

    for (const part of result.parts) accumulate(groups, instance.id, part)
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
  return result.slots
    .filter((slot) => !slot.optional && slot.record === undefined)
    .map((slot) => ({ placement: result.instance.id, template, slot: slot.slot }))
}

function accumulate(groups: Map<BlobId, Group>, placement: PlacementId, part: AssemblyPart): void {
  const record = part.record
  const existing = groups.get(record.blob)
  const group =
    existing ??
    ({ blob: record.blob, records: new Map<TileId, CatalogRecord>(), slots: [], quantity: 0 } satisfies Group)
  if (existing === undefined) groups.set(record.blob, group)

  group.records.set(record.id, record)
  group.slots.push({ placement, slot: part.slot, tile: record.id })
  group.quantity += 1
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

/** Total, so a line's provenance list is a function of the scene and not of iteration order. */
function bySlotRef(a: BillSlotRef, b: BillSlotRef): number {
  if (a.placement !== b.placement) return ascending(a.placement, b.placement)
  if (a.slot !== b.slot) return ascending(a.slot, b.slot)
  return ascending(a.tile, b.tile)
}

function ascending(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
