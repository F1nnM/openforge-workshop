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
 *      And yet **both identities are needed at once**, which is why a line is not
 *      just a blob: the line is one file, and it still has to name the tiles that
 *      asked for it, or the user cannot tell which of their placements produced it.
 *
 *   2. **Size is a warning surface, not a footnote.** Corpus median is 10.36 MB,
 *      p95 32.87 MB, largest 108.9 MB. Fifty placements at the median is 518 MB
 *      *before* the auto-inserted bases, and half the corpus needs one. So the
 *      bill returns a byte total and a verdict, and the UI can warn before
 *      someone starts a download that will not finish.
 *
 *   3. **Filename collisions are surfaced, not resolved silently.** 89 filenames
 *      map to two or three genuinely different meshes — `tudor#door+narrow.stl`
 *      is three distinct md5s across five catalog paths. A zip that names entries
 *      by filename overwrites two of them and reports success.
 */
import type { BlobId, CatalogRecord, TileId } from '@/catalog'
import type { Placement } from '@/store'

import type { AssemblyIndex } from './assemblyIndex'
import type { BillNote, Note } from './notes'
import { note, rollUpNotes } from './notes'
import type { AssemblyOptions, PartRole, ResolvedPlacement } from './resolve'
import { resolvePlacement } from './resolve'

/* ---------------------------------------------------------------- size limits */

/**
 * Where the download verdict changes, in bytes.
 *
 * Both numbers come from the corpus rather than from round-number instinct:
 *
 *   - **512 MB — `large`.** Fifty placements at the 10.36 MB median is 518 MB,
 *     so a median fifty-tile room trips this and a median twenty-tile room does
 *     not. That is the right place for "this will take a while": it fires for the
 *     rooms that are genuinely big and stays quiet for the ones that are not.
 *   - **2 GB — `huge`.** Fifty placements at the p95 of 32.87 MB is 1.64 GB, and
 *     §11 reserves the Cloudflare Worker fallback for "iOS Safari and multi-GB
 *     rooms". Above this the honest answer is the degradation path §11 names — a
 *     URL list, or the Worker — not a progress bar.
 *
 * Both are **decimal**, not binary, and that is not sloppiness: every corpus size
 * figure the plan quotes is decimal (10.36 MB median, 108.0 GB total), and a
 * 512 MiB threshold would put the median fifty-tile room *under* the line the
 * median fifty-tile room is supposed to be the reason for.
 */
export const DOWNLOAD_LARGE_BYTES = 512_000_000
export const DOWNLOAD_HUGE_BYTES = 2_000_000_000

export type DownloadVerdict = 'ok' | 'large' | 'huge'

export interface DownloadSize {
  /** Bytes to fetch: one copy per distinct md5, never per placement. */
  bytes: number
  verdict: DownloadVerdict
  /** The threshold the verdict crossed, so the UI can say "over 512 MB" without a lookup table. */
  threshold: number
}

/**
 * The verdict for a byte total.
 *
 * Split out and exported because the builder's palette wants it for a *prospective*
 * total ("adding this tile would push you over") and recomputing a whole bill to
 * ask that would be absurd.
 */
export function downloadSize(bytes: number): DownloadSize {
  if (bytes >= DOWNLOAD_HUGE_BYTES) return { bytes, verdict: 'huge', threshold: DOWNLOAD_HUGE_BYTES }
  if (bytes >= DOWNLOAD_LARGE_BYTES) return { bytes, verdict: 'large', threshold: DOWNLOAD_LARGE_BYTES }
  return { bytes, verdict: 'ok', threshold: DOWNLOAD_LARGE_BYTES }
}

/* --------------------------------------------------------------------- lines */

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
   * snapshot test in PR 18 worth writing.
   */
  tile: CatalogRecord

  /** Every catalog id in this scene that resolved to this blob, sorted. Usually one. */
  tileIds: TileId[]

  /** Copies to print. */
  quantity: number

  /** How many of those copies are auto-inserted bases rather than placed tiles. */
  baseQuantity: number

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
   * PR 11 may reshape this; `filenameCollides` is what it needs to know.
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

export interface BillOfTiles {
  /** One per distinct md5, ordered by catalog path. */
  lines: BillLine[]

  /** Placements the bill was built from. */
  placements: number

  /**
   * Parts those placements resolved to.
   *
   * Greater than `placements` whenever a `connection|openforge` topper is in the
   * scene, which is the whole point of §2's "parts list" reading.
   */
  parts: number

  /** Distinct files to download — `lines.length`. */
  files: number

  /** Copies to print — the sum of `quantity`, which counts a reused file twice. */
  copies: number

  /** How many of `copies` are auto-inserted bases. */
  baseCopies: number

  download: DownloadSize

  /** Per-code roll-up. `warn` before `info`; see `notes.ts`. */
  notes: BillNote[]

  /** Filenames this bill publishes under more than one md5. */
  collisions: FilenameCollision[]

  /** Every placement, resolved — so the canvas and the panel share one pass. */
  resolved: ResolvedPlacement[]
}

interface Group {
  blob: BlobId
  records: Map<TileId, CatalogRecord>
  quantity: number
  baseQuantity: number
}

/**
 * Roll a scene up into a bill.
 *
 * An empty scene returns an empty bill — zero lines, zero bytes, verdict `ok`,
 * no notes — rather than throwing or returning a null. The builder renders the
 * panel before anything is placed, so "nothing here yet" is the *first* state
 * this function is asked about, not an edge case.
 *
 * One pass over the placements, one over the groups: linear in the scene, and
 * independent of catalog size because {@link AssemblyIndex} already paid that
 * cost.
 */
export function buildBillOfTiles(
  placements: Iterable<Placement>,
  index: AssemblyIndex,
  options: AssemblyOptions = {},
): BillOfTiles {
  const resolved: ResolvedPlacement[] = []
  const groups = new Map<BlobId, Group>()
  const notes: Note[] = []
  let parts = 0

  for (const placement of placements) {
    const result = resolvePlacement(placement, index, options)
    resolved.push(result)
    notes.push(...result.notes)
    parts += result.parts.length

    for (const part of result.parts) {
      accumulate(groups, part.record, part.role)
    }
  }

  const lines = toLines(groups)
  notes.push(...mixedBuildNote(resolved))
  notes.push(...doubleBaseNotes(resolved, options.generatedBases ?? []))

  return {
    lines,
    placements: resolved.length,
    parts,
    files: lines.length,
    copies: lines.reduce((total, line) => total + line.quantity, 0),
    baseCopies: lines.reduce((total, line) => total + line.baseQuantity, 0),
    download: downloadSize(lines.reduce((total, line) => total + line.bytes, 0)),
    notes: rollUpNotes(notes),
    collisions: collisionsIn(lines),
    resolved,
  }
}

function accumulate(groups: Map<BlobId, Group>, record: CatalogRecord, role: PartRole): void {
  const existing = groups.get(record.blob)
  const group =
    existing ??
    ({ blob: record.blob, records: new Map<TileId, CatalogRecord>(), quantity: 0, baseQuantity: 0 } satisfies Group)
  if (existing === undefined) groups.set(record.blob, group)

  group.records.set(record.id, record)
  group.quantity += 1
  if (role === 'base') group.baseQuantity += 1
}

/**
 * Turn the groups into lines, naming each one and flagging the collisions.
 *
 * Collision detection runs over the **bill**, not the corpus: a scene holding
 * one `tudor#door+narrow.stl` needs no prefix, and prefixing it anyway would bury
 * every entry under a five-level directory for a collision that is not in the
 * zip. When two lines do collide, *both* take the long name — leaving one on the
 * bare filename would be a trap for anyone reading the archive.
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
      quantity: group.quantity,
      baseQuantity: group.baseQuantity,
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
    .sort((a, b) => (a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0))
}

/**
 * The one bill-level note: this scene mixes construction systems.
 *
 * `separate wall` (3,351 tiles) and `wall on tile` (863) are different ways of
 * building the same room and do not interleave on the table. It is a warning
 * rather than a refusal for the same reason as everything else here — 2,978
 * tiles (34.2%) name no build system at all, so "mixed" is a judgement about the
 * tiles that *did* say, and those are never the whole scene.
 */
function mixedBuildNote(resolved: readonly ResolvedPlacement[]): Note[] {
  const systems = new Set<string>()
  for (const { tile } of resolved) {
    if (tile?.build !== undefined) systems.add(tile.build)
  }
  if (systems.size < 2) return []
  const listed = [...systems].sort().join(', ')
  return [note('mixed-build-systems', `this scene mixes ${listed}, which do not interleave on the table.`)]
}

/**
 * A cell key for the double-base check: the anchor, exactly.
 *
 * Exact equality on the two numbers, not a tolerance, and that is deliberate.
 * §7 snaps the builder to 0.5 units and the coordinate schema folds `-0` to
 * `+0`, so two pieces the user put on the same cell hold *identical* numbers —
 * `move.ts` writes the snapped value, it does not accumulate a drag delta. A
 * tolerance would therefore buy nothing and would start reporting neighbours: at
 * half a unit of slack a base would claim the cell beside it.
 */
function anchorKey(x: number, z: number): string {
  return `${String(x)}|${String(z)}`
}

/**
 * The one note this module raises about the scene rather than about a placement:
 * a topper got a base added while a base was already sitting on its cell.
 *
 * Both populations are checked against the same set of anchors, so a hand-placed
 * catalog base and a generated one produce the same note — which is the point,
 * because the second is the case row X9 found and there is no reason for the user
 * to meet two different messages for one mistake.
 *
 * The base's *own* anchor is what is compared, and a base that is itself a topper
 * cannot contribute: only `layer === 'base'` on the **resolved** record counts,
 * because rule 0 decides which file gets printed and `layer` is one of the
 * fields that differs between an item's variants. Bases the *rule* inserted are
 * not in this set either — they have no anchor, being line items rather than
 * pieces — so the note cannot fire on two toppers sharing a cell.
 *
 * **Row V4 firmed this up rather than disturbing it.** `resolved.tile` was
 * already the resolved record, so not a line of code changed; what changed is
 * that `layer === 'base'` is now effectively a property of the placed *item*
 * rather than of a file that might have been substituted from a non-base
 * sibling. `shape|base` is part of the design key, so a base is always its own
 * design and **0 of the 3,822 items hold a base variant beside a non-base one**
 * (`aggregate.ts#AggregateClass`, re-measured by `palette.corpus.test.ts`) — so
 * a hand-placed base can no longer resolve into something that is not a base, or
 * the reverse.
 */
function doubleBaseNotes(
  resolved: readonly ResolvedPlacement[],
  generatedBases: readonly { readonly x: number; readonly z: number }[],
): Note[] {
  const occupied = new Set<string>()
  for (const { placement, tile } of resolved) {
    if (tile?.layer === 'base') occupied.add(anchorKey(placement.x, placement.z))
  }
  for (const base of generatedBases) occupied.add(anchorKey(base.x, base.z))
  if (occupied.size === 0) return []

  const notes: Note[] = []
  for (const { placement, tile, parts } of resolved) {
    if (tile === undefined) continue
    if (!occupied.has(anchorKey(placement.x, placement.z))) continue
    const inserted = parts.find((part) => part.role === 'base')
    if (inserted === undefined) continue
    notes.push(
      note(
        'base-already-on-plan',
        `${inserted.record.name} was added for ${tile.name}, and a base is already on that cell — ` +
          'the bill asks for two prints of a base you have placed once.',
        tile.id,
      ),
    )
  }
  return notes
}

function byId(a: CatalogRecord, b: CatalogRecord): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}
