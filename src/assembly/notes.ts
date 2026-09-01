/**
 * The note vocabulary — the whole of what assembly resolution is allowed to say.
 *
 * §7's rule, stated exactly: **compatibility informs; it never refuses a
 * placement.** There is one hard rule (every `connection|openforge` piece gets a
 * base line item) and it is enforced by *adding* a part, never by rejecting one.
 * Everything else is a note.
 *
 * The reason enforcement stops there is not caution, it is data: refusing a
 * placement would need trustworthy per-edge connector data, and the corpus has
 * none — 2,978 tiles (34.2%) carry no `build|` tag at all, and the `connection|`
 * tags name systems and mount positions, not edges. A resolver that refused
 * placements on this data would refuse correct builds, which is worse than
 * permitting a wrong one, because the user can see a wrong one on the table.
 *
 * Two severities, and the split is by **who the note is for**:
 *
 *   - `warn` — something the user should look at before they print. Fires on a
 *     minority of placements by construction; if a warn ever fires on a third of
 *     the corpus it is mis-classified.
 *   - `info` — something true of the data that the UI may want to show but that
 *     nobody needs to act on. `build-unspecified` is the archetype: it is true of
 *     34.2% of tiles, so at `warn` it would be wallpaper and the real warnings
 *     would be read past.
 */
import type { TileId } from '@/catalog'

/**
 * Every note the resolver can emit.
 *
 * A closed union rather than free-form strings, so a UI can switch on it
 * exhaustively and a new note cannot be added without the compiler pointing at
 * every place that must decide what to do with it.
 */
export type NoteCode =
  /** The placement names an id that is not in this catalog build. */
  | 'unknown-tile'
  /**
   * The hard rule fired: a base was added that the user did not place.
   *
   * **This is the disclosure surface for the whole base choice**, which is why it
   * is `info` and still carries the longest message in the vocabulary. The user
   * did not place this part and cannot remove it, so the note names the base, the
   * key it was found on, how many candidates it beat, and which criteria it won
   * on — including whether it is the plain base or one of the 584 print variants
   * (`topless` has no top surface). Before that, it read "matched on sizeCode A"
   * and 79.1% of auto-inserted openlock bases were topless with nothing said.
   */
  | 'base-auto-inserted'
  /** An openforge topper with a size code, and **no base in the catalog carries that code**. */
  | 'no-matching-base'
  /** An openforge topper with neither a size code nor a footprint to match on. */
  | 'base-unmatchable'
  /** An openforge topper with a footprint, and no base is congruent to it. */
  | 'no-congruent-base'
  /** The chosen base does not offer the preferred lock system. */
  | 'base-lock-mismatch'
  /** The chosen base's texture differs from the topper's. Normal, not a fault. */
  | 'base-texture-mismatch'
  /** The placed tile carries lock systems, none of them the preferred one. */
  | 'lock-unavailable'
  /** `Footprint` is `none`: the tile is in the bill but cannot be drawn in plan view. */
  | 'no-footprint'
  /** A `part|` insert was placed on the grid rather than fitted into a slot. */
  | 'insert-on-grid'
  /** The tile carries no `build|` tag — true of 34.2% of the corpus. */
  | 'build-unspecified'
  /** The scene mixes construction systems that do not physically go together. */
  | 'mixed-build-systems'

/** Severity per {@link NoteCode}. Exported so a UI can filter without a switch. */
export const NOTE_SEVERITY: Readonly<Record<NoteCode, 'info' | 'warn'>> = Object.freeze({
  'unknown-tile': 'warn',
  'base-auto-inserted': 'info',
  'no-matching-base': 'warn',
  'base-unmatchable': 'warn',
  'no-congruent-base': 'warn',
  'base-lock-mismatch': 'warn',
  'base-texture-mismatch': 'info',
  'lock-unavailable': 'warn',
  'no-footprint': 'info',
  'insert-on-grid': 'info',
  'build-unspecified': 'info',
  'mixed-build-systems': 'warn',
})

/** One note against one placement. */
export interface Note {
  code: NoteCode
  severity: 'info' | 'warn'
  /** Prose for a human. Never parsed — switch on `code`. */
  message: string
  /** The tile the note is about: the placed tile, or the base that was matched for it. */
  tileId?: TileId
}

/** Build a note, taking its severity from {@link NOTE_SEVERITY} so the two cannot drift. */
export function note(code: NoteCode, message: string, tileId?: TileId): Note {
  return {
    code,
    severity: NOTE_SEVERITY[code],
    message,
    ...(tileId === undefined ? {} : { tileId }),
  }
}

/**
 * One note code, rolled up across a whole bill.
 *
 * The roll-up is not cosmetic. `build-unspecified` fires on a third of the
 * corpus, and a bill that listed it once per placement would be 50 lines of the
 * same sentence — so the bill carries one entry per code, with the count and the
 * distinct tiles behind it, and the UI decides how much of that to show.
 */
export interface BillNote {
  code: NoteCode
  severity: 'info' | 'warn'
  message: string
  /** How many placements this code fired for. */
  count: number
  /** The distinct tiles it fired for, sorted. */
  tileIds: TileId[]
}

/**
 * Collapse per-placement notes to one entry per code.
 *
 * Ordering is `warn` before `info`, then by descending count, then by code — a
 * total order, so two runs over the same scene produce the same bill and a
 * snapshot test is meaningful.
 */
export function rollUpNotes(notes: Iterable<Note>): BillNote[] {
  const byCode = new Map<NoteCode, { note: Note; count: number; tiles: Set<TileId> }>()

  for (const item of notes) {
    const existing = byCode.get(item.code)
    if (existing === undefined) {
      byCode.set(item.code, {
        note: item,
        count: 1,
        tiles: new Set(item.tileId === undefined ? [] : [item.tileId]),
      })
      continue
    }
    existing.count += 1
    if (item.tileId !== undefined) existing.tiles.add(item.tileId)
  }

  return [...byCode.values()]
    .map(({ note: first, count, tiles }) => ({
      code: first.code,
      severity: first.severity,
      message: first.message,
      count,
      tileIds: [...tiles].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    }))
    .sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'warn' ? -1 : 1
      if (a.count !== b.count) return b.count - a.count
      return a.code < b.code ? -1 : a.code > b.code ? 1 : 0
    })
}
