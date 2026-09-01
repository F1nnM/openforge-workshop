/**
 * The bill of tiles, turned into something a 302px panel can render — and into
 * prose, which is the part that matters.
 *
 * `buildBillOfTiles` already does the arithmetic: md5 dedupe, the auto-inserted
 * bases, the byte total, the threshold verdict and one rolled-up note per code.
 * **None of that is re-derived here.** What this module adds is the two things
 * the panel needs and the assembly layer deliberately does not supply:
 *
 *   1. **A route from a file back to the placements that asked for it.** A bill
 *      line is keyed by content address and names the catalog ids behind it, but
 *      not the placements — `ResolvedPlacement` carries a `Placement`, and the
 *      store's `PlacementId` is the key, not a field. Row 17 was honest that the
 *      canvas is one tab stop with no move operation and a drawing that is not
 *      linearly readable, so the bill panel is where a placement has to become
 *      reachable and removable. That needs the id, and only the store has it.
 *
 *   2. **Prose per note code.** `BillNote.message` is written for one placement
 *      ("no base in the catalog carries size code Q, so … has no base to sit
 *      on"). A panel showing one entry per code with a count needs a sentence
 *      about the *class* of problem, and — for the three that matter — what the
 *      user should do about it. 385 openforge toppers in the live corpus have no
 *      base the archive can supply, in three distinct categories with three
 *      different remedies; a panel that folded them into "some warnings" would
 *      hand somebody a wall that cannot stand.
 *
 * Pure, DOM-free and store-free: it takes the bill and a snapshot of the
 * placements map, and returns data.
 */
import type { BillLine, BillNote, BillOfTiles, DownloadSize, NoteCode } from '@/assembly'
import type { Placement, PlacementId } from '@/store'
import { countLabel } from '@/screens/catalog'

/* --------------------------------------------------------------- inventory */

/** One placed tile, with the key needed to take it off the grid again. */
export interface BillPlacement {
  readonly id: PlacementId
  readonly placement: Placement
}

/** One file to print, the placements that asked for it, and how it got here. */
export interface BillRow {
  readonly line: BillLine
  /**
   * The placements this file was pulled in for, in plan reading order.
   *
   * Empty when the file is only ever an auto-inserted base — nobody placed it,
   * so there is nothing to remove. Ordered by depth then across rather than by
   * the order the user clicked: this is an inventory of a drawing, and the
   * question it answers is "which one is that", which is a spatial question.
   */
  readonly placements: readonly BillPlacement[]
  /**
   * Every copy of this file is a base the resolver added.
   *
   * The panel marks these, because a line item the user did not choose and
   * cannot remove is otherwise indistinguishable from one they placed — and the
   * base is often the larger print.
   */
  readonly autoBaseOnly: boolean
}

export interface BillInventory {
  /** By copies descending, then by name — design-contract.md §2.4's order. */
  readonly rows: readonly BillRow[]
  /**
   * Placements the bill could not describe at all.
   *
   * A placement whose tile is not in this catalog build resolves to no parts, so
   * it appears in no line and would be invisible in this panel while still
   * sitting in the scene. Surfaced separately and removable; the `unknown-tile`
   * note says why.
   */
  readonly orphans: readonly BillPlacement[]
}

/**
 * Join the bill to the store.
 *
 * One pass over the placements to index them by tile id, one over the lines. The
 * panel re-runs this whenever the scene changes, which is once per placement, so
 * it is linear in the scene and touches the catalog not at all.
 */
export function billInventory(
  bill: BillOfTiles,
  placements: Readonly<Record<string, Placement>>,
): BillInventory {
  const byTile = new Map<string, BillPlacement[]>()
  for (const [id, placement] of Object.entries(placements)) {
    const entry: BillPlacement = { id: id as PlacementId, placement }
    const bucket = byTile.get(placement.tileId)
    if (bucket === undefined) byTile.set(placement.tileId, [entry])
    else bucket.push(entry)
  }

  const claimed = new Set<string>()
  const rows = bill.lines.map((line) => {
    const mine: BillPlacement[] = []
    for (const tileId of line.tileIds) {
      for (const entry of byTile.get(tileId) ?? []) {
        mine.push(entry)
        claimed.add(entry.id)
      }
    }
    return {
      line,
      placements: mine.sort(byPlanPosition),
      autoBaseOnly: line.baseQuantity === line.quantity,
    }
  })

  const orphans: BillPlacement[] = []
  for (const bucket of byTile.values()) {
    for (const entry of bucket) {
      if (!claimed.has(entry.id)) orphans.push(entry)
    }
  }

  return { rows: [...rows].sort(byCopiesThenName), orphans: orphans.sort(byPlanPosition) }
}

function byPlanPosition(a: BillPlacement, b: BillPlacement): number {
  if (a.placement.z !== b.placement.z) return a.placement.z - b.placement.z
  if (a.placement.x !== b.placement.x) return a.placement.x - b.placement.x
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
 * is the whole reason `notes.ts` made the union closed.
 *
 * The corpus figures in the three missing-base cases are the resolver's own
 * (`src/assembly/resolve.ts#missingBaseNote`) and are quoted because they are
 * what tells a user whether they have hit a gap in the archive or a gap in the
 * tile's metadata — those have different remedies, which is why the resolver
 * emits three codes instead of one.
 *
 * The split is **129 / 21 / 235** over 4,363 toppers, measured identically under
 * every lock preference and under none, so each sentence below is written to say
 * which of the three a reader has hit and whose problem it is:
 *
 *   - `no-matching-base` — **the library is missing a base it should have.** The
 *     one sentence that must never read as user error. `docs/corpus-base-gap.md`
 *     enumerates all 129 for whoever fixes the archive.
 *   - `no-congruent-base` — **no base can carry this shape.** Geometry: 17 are
 *     half a unit wide against a base range that starts at one unit, and the
 *     copy says so, because "a gap in the range" would send someone looking for
 *     a base that cannot exist.
 *   - `base-unmatchable` — **the tile publishes no key.** The base may well be
 *     in the archive; nothing joins it to this tile.
 *
 * **Two figures below moved together, and W3 updated both:** the 235 here and
 * the 741 in `no-footprint` are the same `foot.shape === 'none'` population, and
 * row W3 reclassified 403 tiles out of it — 444 → 235 and 1,144 → 741. Nothing
 * else in this function depends on the footprint classifier.
 */
export function noteCopy(note: BillNote): NoteCopy {
  const n = countLabel(note.count)
  const pieces = note.count === 1 ? 'piece' : 'pieces'
  const has = note.count === 1 ? 'has' : 'have'
  const is = note.count === 1 ? 'is' : 'are'
  const give = note.count === 1 ? 'gives' : 'give'
  const base = { code: note.code, severity: note.severity }

  switch (note.code) {
    case 'unknown-tile':
      return {
        ...base,
        headline: `${n} placed ${note.count === 1 ? 'tile' : 'tiles'} ${is} not in this catalog build`,
        detail:
          'A tile that leaves the archive keeps its retired id, so a saved room or an old share link can name ' +
          'one. It cannot be drawn, priced or downloaded — take it off the grid.',
      }

    case 'no-matching-base':
      return {
        ...base,
        headline: `${n} ${pieces} ${has} no base in the archive`,
        detail:
          'These mount on a separate base and carry a size code no base in the catalog answers to. That is a gap ' +
          'in the library rather than anything you did — nine size codes are affected, over 129 tiles ' +
          'corpus-wide. Printed as they stand they have nothing to lock to and will not stay upright, so pair ' +
          'each one with a base you already own, or swap it for a piece with an integral base.',
      }

    case 'no-congruent-base':
      return {
        ...base,
        headline: `${n} ${pieces} ${has} a shape no base is built to carry`,
        detail:
          'A base was looked for by shape and none is congruent — this is geometry, not an omission. 17 of the 21 ' +
          'corpus tiles in this state are half-unit strips, risers and stairs, and the narrowest base in the ' +
          'archive is a full unit wide; the other four are 2×6 slabs in a range that holds 2×4 and 2×8. Nothing ' +
          'can sit under one, so print them standalone and expect no joint along that edge.',
      }

    case 'base-unmatchable':
      return {
        ...base,
        headline: `${n} ${pieces} ${give} nothing to match a base on`,
        detail:
          'Neither a size code nor a derivable footprint, so there is no key to search bases by — 235 corpus ' +
          'tiles are in this position, and it is the same missing shape that keeps them off the plan view. A ' +
          'base for these probably does exist; the tile does not say which. Expect to choose it yourself.',
      }

    case 'base-auto-inserted':
      return {
        ...base,
        headline: `${n} ${note.count === 1 ? 'base was' : 'bases were'} added for you`,
        detail:
          'Every OpenForge topper delegates its joinery to a base, so the base is a line item whether or not it ' +
          'was placed. The rows below mark which files those are.',
      }

    case 'base-option-chosen':
      return {
        ...base,
        headline: `${n} matched ${note.count === 1 ? 'base is a print variant' : 'bases are print variants'}, not the plain base`,
        detail:
          'A base is published in up to three prints of the same part, and one of them — topless — has no top ' +
          'surface at all. Two things can put a variant here and they are not the same: the archive holds no ' +
          'plainer print of this base, or it does and every one of them is missing your lock system. Only the ' +
          'lock outranks the print option, so in the second case changing the lock preference gets the full base ' +
          'back; in the first, nothing will.',
      }

    case 'base-lock-mismatch':
      return {
        ...base,
        headline: `${n} matched ${note.count === 1 ? 'base does' : 'bases do'} not offer your lock system`,
        detail:
          'The closest base by shape and size carries a different connector. It will still sit under the piece, ' +
          'but it will not clip to its neighbours — change the lock preference, or accept a loose joint here.',
      }

    case 'base-texture-mismatch':
      return {
        ...base,
        headline: `${n} matched ${note.count === 1 ? 'base has' : 'bases have'} a different texture`,
        detail:
          'Bases cover 15 texture roots against the toppers’ 23, so a matched base often comes from another ' +
          'set. It is hidden under the piece once built.',
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
        headline: `${n} ${pieces} cannot be drawn in plan view`,
        detail:
          'The tile is in the bill and will be downloaded. It has no footprint the plan view can derive, so it ' +
          'has no shape on the grid — 741 corpus tiles are in this state.',
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
          'True of 34.2% of the archive, so it is a fact rather than a fault. It means nothing checked whether ' +
          'these interleave with the rest of the scene.',
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
 * The thresholds and the arithmetic are `@/assembly`'s — 512 MB is fifty
 * placements at the corpus median, 2 GB is fifty at p95 — so this screen warns at
 * exactly the byte counts the library screen warns at. All this adds is the
 * sentence.
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
