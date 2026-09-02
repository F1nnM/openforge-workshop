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
 *      user should do about it. 377 openforge toppers in the live corpus have no
 *      base the archive can supply, in three distinct categories with three
 *      different remedies; a panel that folded them into "some warnings" would
 *      hand somebody a wall that cannot stand.
 *
 *   3. **The variant the lock preference chose.** Row A6's rule 0 resolves a
 *      placement to a *different file* of the same item before any base is
 *      considered — for 1,419 of 3,822 items (37.1%) the three lock systems do
 *      not agree on which — and that decision is invisible in a bill that only
 *      lists outcomes. Two things follow. The join below has to go through
 *      `bill.resolved` rather than matching `line.tileIds` against
 *      `placement.tileId`, because those two no longer name the same file and a
 *      substituted placement would otherwise be reported as an orphan. And
 *      {@link resolutionSummary} and {@link rowResolutionCopy} are what say out
 *      loud which file you are getting and why.
 *
 * Pure, DOM-free and store-free: it takes the bill and a snapshot of the
 * placements map, and returns data.
 */
import type {
  BillLine,
  BillNote,
  BillOfTiles,
  DownloadSize,
  NoteCode,
  PlacementVerdict,
  VariantResolution,
} from '@/assembly'
import type { BlobId } from '@/catalog'
import type { LockSystem, Placement, PlacementId } from '@/store'
import { countLabel } from '@/screens/catalog'

/* --------------------------------------------------------------- inventory */

/** One placed tile, with the key needed to take it off the grid again. */
export interface BillPlacement {
  readonly id: PlacementId
  readonly placement: Placement
  /**
   * How this placement resolved — which file, and how complete an assembly.
   *
   * `undefined` only for a placement the bill did not describe at all, which is
   * the orphan case: a retired tile id resolves to no parts and no resolution.
   */
  readonly resolution: VariantResolution | undefined
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
  /**
   * What the lock preference decided about the placements on this row, when that
   * is worth a sentence. `null` for the ordinary case — you placed a file, you
   * print that file, and it needs no base.
   *
   * Per row rather than only in the summary because the summary can count and
   * cannot point: `lock-unavailable` fires once for a whole scene, and a user
   * with eleven rows needs to know which one will not clip to its neighbours.
   */
  readonly resolution: RowResolution | null
}

/** The resolution facts a row aggregates over its placements. */
export interface RowResolution {
  /** The distinct verdicts on this row, in {@link VERDICT_ORDER} — worst first. */
  readonly verdicts: readonly PlacementVerdict[]
  /** Placements whose item resolved to a file other than the one placed. */
  readonly substituted: number
  /**
   * The files those substituted placements named, distinct and sorted.
   *
   * The *filename*, not the display name: A1 measures zero aggregates holding
   * two display names, so the name is identical on both sides of a substitution
   * and naming it would say nothing. The file is what actually changed.
   */
  readonly substitutedFrom: readonly string[]
  /**
   * Placements where two variants tied on every stated criterion and offered
   * **different print options**, so the pick came down to file size.
   *
   * Reachable, and measured: 1,599 records under openlock, 1,587 under
   * dragonlock, 2 under magnetic — 1,597 of the openlock ones are `base`
   * records, which a user places directly. A topless base and an unsupported one
   * are different products (§5.3), so a choice between them settled on `bytes`
   * is the one thing `VariantSelection.optionTie` exists to stop being silent.
   */
  readonly optionTie: number
  readonly lock: LockSystem | undefined
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
 * A placement's identity for the purpose of pairing the store's map with the
 * bill's array.
 *
 * `bill.resolved` carries the `Placement` objects but not the store's
 * `PlacementId`, which is the map key — so the two have to be paired on value.
 * All four fields, because a scene is a set of distinct cells: the canvas
 * refuses an overlap, so `tileId`+`x`+`z` is already unique and `rotation` is
 * free insurance. Reference identity would work today (`buildBillOfTiles` is
 * handed `Object.values(placements)` and carries each object through untouched)
 * and is exactly the kind of thing that stops being true when a caller maps
 * over the list.
 */
function placementKey(placement: Placement): string {
  return `${placement.tileId}|${String(placement.x)}|${String(placement.z)}|${String(placement.rotation)}`
}

/**
 * Join the bill to the store.
 *
 * **Through `bill.resolved`, not through `line.tileIds`.** Before row A6 those
 * were the same join: a placement named a file, the file was a part, and the
 * part's blob was the line's. Rule 0 broke it — a placement's `tileId` and the
 * file it resolves to are different records for 4,880 of the 8,702 catalog rows
 * — so matching `line.tileIds` against `placement.tileId` would find nothing for
 * every substituted placement and report it as an **orphan**: "this tile is not
 * in this catalog build", offered for removal, about a tile that is in the bill
 * and printing correctly.
 *
 * A placement is attached to the line for the part it *is* — the one part with
 * `role === 'placed'` — and never to the line for its base. That is the
 * behaviour from before this row, generalised: a base row stays unexpandable and
 * marked "added", because a Remove button on it would remove the topper.
 *
 * One pass over the placements, one over `bill.resolved`, one over the lines:
 * linear in the scene, and it touches the catalog not at all.
 */
export function billInventory(
  bill: BillOfTiles,
  placements: Readonly<Record<string, Placement>>,
): BillInventory {
  const queues = new Map<string, { id: PlacementId; placement: Placement }[]>()
  const all: { id: PlacementId; placement: Placement }[] = []
  for (const [id, placement] of Object.entries(placements)) {
    const entry = { id: id as PlacementId, placement }
    all.push(entry)
    const bucket = queues.get(placementKey(placement))
    if (bucket === undefined) queues.set(placementKey(placement), [entry])
    else bucket.push(entry)
  }

  const byBlob = new Map<BlobId, BillPlacement[]>()
  const claimed = new Set<PlacementId>()
  for (const resolved of bill.resolved) {
    // `shift` off a local queue, so two placements that really are identical in
    // all four fields pair with two resolutions rather than both taking the
    // first. A bill built from a list other than this map simply runs the queue
    // dry and the leftovers fall through to `orphans`, which is the honest
    // reading: the panel cannot describe them.
    const entry = queues.get(placementKey(resolved.placement))?.shift()
    if (entry === undefined) continue
    const placed = resolved.parts.find((part) => part.role === 'placed')
    if (placed === undefined) continue
    claimed.add(entry.id)
    const bucket = byBlob.get(placed.record.blob)
    const withResolution: BillPlacement = { ...entry, resolution: resolved.resolution }
    if (bucket === undefined) byBlob.set(placed.record.blob, [withResolution])
    else bucket.push(withResolution)
  }

  const rows = bill.lines.map((line) => {
    const mine = [...(byBlob.get(line.blob) ?? [])].sort(byPlanPosition)
    return {
      line,
      placements: mine,
      autoBaseOnly: line.baseQuantity === line.quantity,
      resolution: rowResolutionOf(line, mine),
    }
  })

  const orphans: BillPlacement[] = all
    .filter((entry) => !claimed.has(entry.id))
    .map((entry) => ({ ...entry, resolution: undefined }))

  return { rows: [...rows].sort(byCopiesThenName), orphans: orphans.sort(byPlanPosition) }
}

/**
 * The order the verdicts are reported in — **worst first**, so a row carrying
 * two of them leads with the one that costs the user something.
 *
 * `with-base` and `self-sufficient` are both fine outcomes and sit at the end;
 * everything above them is a compromise, a gap or an unknown. `no-base` leads
 * because a piece with nothing under it does not stand up.
 */
const VERDICT_ORDER: readonly PlacementVerdict[] = [
  'no-base',
  'mismatched',
  'wrong-system',
  'unknown-joinery',
  'insert',
  'with-base',
  'self-sufficient',
]

function rowResolutionOf(line: BillLine, placements: readonly BillPlacement[]): RowResolution | null {
  if (placements.length === 0) return null
  const verdicts = new Set<PlacementVerdict>()
  const from = new Set<string>()
  let substituted = 0
  let optionTie = 0
  let lock: LockSystem | undefined
  for (const entry of placements) {
    if (entry.resolution === undefined) continue
    verdicts.add(entry.resolution.verdict)
    lock = entry.resolution.lock
    if (entry.resolution.optionTie) optionTie += 1
    if (!entry.resolution.substituted) continue
    substituted += 1
    // The catalog path's last segment: the id is `family + '/' + filename`, and
    // the family is the part a 302px column has no room for.
    from.add(entry.resolution.placed.slice(entry.resolution.placed.lastIndexOf('/') + 1))
  }
  if (verdicts.size === 0) return null
  const ordered = VERDICT_ORDER.filter((verdict) => verdicts.has(verdict))
  // Nothing to say: you placed this file, you print this file, and it stands on
  // its own. Returning `null` rather than a row of reassurance is what keeps the
  // marks meaningful — every one of them is then a real decision.
  const quiet = ordered.length === 1 && ordered[0] === 'self-sufficient' && substituted === 0 && optionTie === 0
  if (quiet) return null
  // Nor for a plain topper-plus-base that resolved to the file that was placed:
  // the base row's own "added" mark already says it, and `line` is that topper.
  if (ordered.length === 1 && ordered[0] === 'with-base' && substituted === 0 && optionTie === 0 && line.baseQuantity === 0) {
    return null
  }
  return { verdicts: ordered, substituted, substitutedFrom: [...from].sort(), optionTie, lock }
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

/* --------------------------------------------------------------- resolution */

/** How the lock preference reads in a sentence. */
function lockLabel(lock: LockSystem | undefined): string {
  return lock ?? 'no lock preference'
}

export interface ResolutionSummary {
  readonly lock: LockSystem | undefined
  /** Placements the bill described. Never zero — the summary is `null` instead. */
  readonly placements: number
  /** Placements that print as one part: no base needed in this system. */
  readonly onePart: number
  /** Placements that print as a topper plus a base the archive supplies. */
  readonly withBase: number
  /** Placements whose item resolved to a file other than the one placed. */
  readonly substituted: number
  /** One line, count folded in. Never ends in a full stop. */
  readonly headline: string
  readonly detail: string
}

/**
 * What the lock preference did to this scene, once, above the rows.
 *
 * The counterpart to the per-row marks and the reason both exist: a user needs
 * to know that the preference is *doing* something before they can be expected
 * to care which rows it moved. Over the live corpus it moves the file for 1,419
 * of 3,822 items (37.1%), and under openlock it turns 1,808 of the 4,363
 * base-needing files into a single print — so for most scenes there is something
 * real to say here.
 *
 * `null` for an empty scene, and for a scene where the preference changed
 * nothing and nothing needs a base: the panel already has a warning surface, and
 * a permanent row of reassurance is how a warning surface stops being read.
 */
export function resolutionSummary(bill: BillOfTiles): ResolutionSummary | null {
  let placements = 0
  let onePart = 0
  let withBase = 0
  let substituted = 0
  let lock: LockSystem | undefined
  for (const resolved of bill.resolved) {
    const resolution = resolved.resolution
    if (resolution === undefined) continue
    placements += 1
    lock = resolution.lock
    if (resolution.substituted) substituted += 1
    if (resolution.verdict === 'self-sufficient') onePart += 1
    if (resolution.verdict === 'with-base' || resolution.verdict === 'mismatched') withBase += 1
  }
  if (placements === 0) return null
  if (substituted === 0 && withBase === 0) return null

  const parts: string[] = []
  if (onePart > 0) {
    parts.push(`${countLabel(onePart)} ${onePart === 1 ? 'prints' : 'print'} as one part`)
  }
  if (withBase > 0) {
    parts.push(`${countLabel(withBase)} ${withBase === 1 ? 'needs' : 'need'} a base under ${withBase === 1 ? 'it' : 'them'}`)
  }
  const rest = placements - onePart - withBase
  if (rest > 0) {
    parts.push(`${countLabel(rest)} ${rest === 1 ? 'is' : 'are'} flagged above`)
  }

  return {
    lock,
    placements,
    onePart,
    withBase,
    substituted,
    headline: `Resolved for ${lockLabel(lock)}`,
    detail:
      `${parts.join(', ')}. ` +
      (substituted === 0
        ? 'Every row below is the file you picked.'
        : `${countLabel(substituted)} of ${countLabel(placements)} ${
            placements === 1 ? 'placement prints' : 'placements print'
          } a different file of the same tile — the one that fits this system. Those rows are marked.`),
  }
}

export interface RowResolutionCopy {
  readonly tone: 'info' | 'warn'
  /** Two or three words for a chip. Lower case, like the `base · added` chip. */
  readonly chip: string
  /** The sentence beside it. Ends in a full stop. */
  readonly detail: string
}

/**
 * The mark on one row, or `null` when the row needs none.
 *
 * Switched on the worst verdict the row carries, because a row is one file and a
 * user reading it wants the one thing that could go wrong with it — not a list.
 * The substitution is folded into the same sentence rather than given a mark of
 * its own: "you are printing this file instead" and "and it needs no base" are
 * one fact about one row, and two chips on a 302px row is a wrapped line.
 *
 * `unknown-joinery` has no note code of its own in `notes.ts`, deliberately —
 * see this row's report — so this is the **only** place the 93 items with no
 * joinery tag anywhere are surfaced. `wrong-system` does have one
 * (`lock-unavailable`), and this adds what that note cannot: which row.
 */
export function rowResolutionCopy(row: BillRow): RowResolutionCopy | null {
  const resolution = row.resolution
  if (resolution === null) return null
  const worst = resolution.verdicts[0]
  if (worst === undefined) return null
  const lock = lockLabel(resolution.lock)
  const swapped =
    resolution.substituted === 0
      ? ''
      : ` Printed instead of ${resolution.substitutedFrom.join(', ')}, which ${
          resolution.substitutedFrom.length === 1 ? 'is' : 'are'
        } the same tile in another system.`
  // Appended to whatever the verdict says rather than given a mark of its own: a
  // tie is a fact about *how* this file was chosen, not a different outcome, and
  // a second chip on a 302px row wraps the line.
  const tie =
    resolution.optionTie === 0
      ? ''
      : ' Another print of this same file — topless, or reworked to need no supports — fits this system equally well;' +
        ' the smaller file was taken. They are different products, so check which one you want.'

  switch (worst) {
    case 'self-sufficient':
      return {
        tone: 'info',
        chip: `${lock} · one part`,
        detail: `This variant carries its own joinery, so nothing goes under it.${swapped}${tie}`,
      }
    case 'with-base':
      return {
        tone: 'info',
        chip: `${lock} · needs a base`,
        detail: `A base is in the bill for this row.${swapped}${tie}`,
      }
    case 'mismatched':
      return {
        tone: 'warn',
        chip: 'base · other system',
        detail: `The closest base by shape does not carry ${lock}; it will sit under this piece and not clip to its neighbours.${swapped}${tie}`,
      }
    case 'no-base':
      return {
        tone: 'warn',
        chip: 'no base',
        detail: `Nothing in the archive fits under this piece — see the warning above for which of the three reasons.${swapped}${tie}`,
      }
    case 'wrong-system':
      return {
        tone: 'warn',
        chip: `not ${lock}`,
        detail: `No version of this tile carries ${lock}. It will print and stand; it will not join the pieces either side of it.${swapped}${tie}`,
      }
    case 'unknown-joinery':
      return {
        tone: 'warn',
        chip: 'joinery untagged',
        detail:
          'The archive names no connector for this tile at all — on any version of it. That is missing data rather ' +
          'than an incompatibility, so it may well fit; nothing here can promise it.',
      }
    case 'insert':
      return {
        tone: 'info',
        chip: 'component',
        detail: 'This fits into a slot in another piece rather than onto the grid.',
      }
  }
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
 * The split is **86 / 31 / 260** over 4,363 toppers — the *archive's* gap, which
 * `matchBase` measures identically under every lock preference and under none.
 * Each sentence below is written to say which of the three a reader has hit and
 * whose problem it is:
 *
 *   - `no-matching-base` — **the library is missing a base it should have.** The
 *     one sentence that must never read as user error. `docs/corpus-base-gap.md`
 *     enumerates all 86 for whoever fixes the archive.
 *   - `no-congruent-base` — **no base can carry this shape.** Geometry: 17 are
 *     half a unit wide against a base range that starts at one unit, and the
 *     copy says so, because "a gap in the range" would send someone looking for
 *     a base that cannot exist.
 *   - `base-unmatchable` — **the tile publishes no key.** The base may well be
 *     in the archive; nothing joins it to this tile.
 *
 * **What a user meets is smaller than the archive's gap, and row A6 is why.**
 * Rule 0 resolves an item to a file before a base is considered, so a topper
 * whose item also publishes a one-part print in the chosen system is not a gap
 * for that user at all. Under openlock the same three codes fire **29 / 29 /
 * 247** — 305 warnings instead of 377 — and under magnetic they fire the full
 * 86 / 31 / 260, because the archive has no magnetic integrated variants to
 * substitute in. The copy below is written for the class of problem and is
 * correct at either count; the counts in each `detail` are the archive's,
 * because that is the population somebody upstream would go and fix.
 *
 * **Three figures below move with the footprint classifier, and each row that
 * moves them updates the copy here.** The 260 in `base-unmatchable` and the 726
 * in `no-footprint` are the same `foot.shape === 'none'` population: W3
 * reclassified 403 tiles out of it (444 → 235, 1,144 → 741), W4 moved 25 back in
 * (235 → 247, 741 → 699) after W1 measured them and their footprint turned out to
 * be wrong, and W5 moved the 27 `curved+interface` floors in on the same grounds
 * (247 → 260, 699 → 726) — 13 of the 27 are openforge toppers, which is the whole
 * of the `base-unmatchable` movement. **Row A6 corrected the two figures W5 left
 * behind in the copy** (`base-unmatchable` still said 247, `no-congruent-base`
 * still said 34 and 13 curved), and the `no-matching-base` figure row D4 flagged
 * for it: D4's re-key took that bucket from 129 tiles over nine size codes to
 * **86 over six** (`PC` 23, `L` 20, `PB` 20, `P` 12, `PA` 6, `O` 5), because the
 * 43 `II`/`IO`/`IX` toppers were never an archive gap — 119 congruent `rect:1x1`
 * bases were in the corpus the whole time.
 *
 * The 31 in `no-congruent-base` was 21 until W4 de-arced the 36 `xG` bases, which
 * had shared the `arc:2.5@90` congruence key with those 13 floors only because a
 * sweep was being fabricated for them, and W5 rewrote the set twice over: the 13
 * left for `base-unmatchable` (they publish no key at all now) and 10
 * `s2w_radial` toppers arrived, whose `[R−1.5, R]` band stopped matching a
 * `[R−2, R]` base once congruence keyed on the band rather than on the tagged
 * radius. Nothing else in this function depends on the footprint classifier.
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
          'in the library rather than anything you did — six size codes are affected, over 86 tiles ' +
          'corpus-wide. Printed as they stand they have nothing to lock to and will not stay upright, so pair ' +
          'each one with a base you already own, or swap it for a piece with an integral base.',
      }

    case 'no-congruent-base':
      return {
        ...base,
        headline: `${n} ${pieces} ${has} a shape no base is built to carry`,
        detail:
          'A base was looked for by shape and none is congruent — this is geometry, not an omission. 17 of the 31 ' +
          'corpus tiles in this state are half-unit strips, risers and stairs, and the narrowest base in the ' +
          'archive is a full unit wide; four are 2×6 slabs in a range that holds 2×4 and 2×8; and 10 are curved ' +
          'floors whose interface band no base actually shares. Nothing can sit under one, so print them ' +
          'standalone and expect no joint along that edge.',
      }

    case 'base-unmatchable':
      return {
        ...base,
        headline: `${n} ${pieces} ${give} nothing to match a base on`,
        detail:
          'Neither a size code nor a derivable footprint, so there is no key to search bases by — 260 corpus ' +
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
          'has no shape on the grid — 726 corpus tiles are in this state.',
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
