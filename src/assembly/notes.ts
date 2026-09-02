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
  /*
   * The three ways the hard rule can go unsatisfied. **385 of 4,363 openforge
   * toppers (8.8%)** reach one of them, and the split is measured — 129 / 21 /
   * 235 — identically under openlock, dragonlock, magnetic and no preference at
   * all, which is what says the gap is a property of the corpus and not of the
   * ranking that chooses among candidates. It was 594 (129 / 21 / 444) before row
   * W3 gave 403 tiles a footprint, and the whole of that gain landed in the third
   * bucket: the archive gap and the geometry gap are the parts a footprint
   * classifier cannot close.
   *
   * Three codes rather than one because the remedies are three different things,
   * and none of them is "you did something wrong":
   *
   *   - `no-matching-base` — the archive is missing a base it should have.
   *   - `no-congruent-base` — no base can carry this shape. Geometry, not a gap.
   *   - `base-unmatchable` — the *topper* publishes no key to search bases by.
   *
   * `src/builder/panels/billView.ts#noteCopy` is where each becomes a sentence,
   * and `docs/corpus-base-gap.md` enumerates the 129 and the 21 by name.
   */
  /**
   * An openforge topper with a size code, and **no base in the catalog carries
   * that code** — 129 toppers over nine codes (`PC` 23, `L` 20, `PB` 20, `IO` 16,
   * `IX` 16, `P` 12, `II` 11, `PA` 6, `O` 5). The base ought to exist.
   */
  | 'no-matching-base'
  /**
   * An openforge topper with neither a size code nor a footprint to match on —
   * 235 toppers, every one of them `foot.shape === 'none'`, and 227 of them
   * `build|wall on tile`. Row W3 took this from 444 by reclassifying 403 corpus
   * tiles out of `none`; what is left is a footprint question, not a base one.
   */
  | 'base-unmatchable'
  /**
   * An openforge topper with a footprint, and no base is congruent to it — 21
   * toppers: 17 half-unit strips (`rect:0.5x2` ×14, `rect:0.5x1` ×3) against a
   * base range whose narrowest extent is a full unit, and 4 `rect:2x6` slabs in a
   * range that holds `2x4` and `2x8` but not `2x6`.
   */
  | 'no-congruent-base'
  /**
   * The base handed out is a **print variant**, not the plain base.
   *
   * `docs/tile-aggregation.md` §5.3 item 2: *"The bill must name the option:
   * `base-option-chosen` alongside `base-auto-inserted`."* Separate from
   * `base-auto-inserted` because the option is not a detail of the match, it is
   * *which product you print* — `topless` has no top surface at all — and a code
   * of its own is what lets a UI filter, count and colour it without parsing a
   * sentence.
   *
   * `warn`, and the frequency is why that is not wallpaper: over all 4,363
   * toppers this fires **0 times under openlock, dragonlock and no preference,
   * and 3 times under magnetic** — the three toppers whose only magnetic base is
   * topless. Before D1 re-ranked on suitability the same measurement over
   * openlock was 2,983 (79.1%), disclosed nowhere. The note is the reason a
   * regression there would be loud instead of silent.
   */
  | 'base-option-chosen'
  /**
   * A base was auto-inserted for a topper that **already has a base under it**
   * on the plan — so the bill asks the user to print two.
   *
   * Row S5 flagged this for hand-placed catalog bases and row X9 found it
   * structurally true for generated ones as well. Row X10 reproduced both and
   * measured what it actually costs, which is narrower than either reported:
   * the *download* is unchanged, because `buildBillOfTiles` folds by md5 and
   * both copies are the same file — 13,124,868 B with the base placed and
   * 13,124,868 B without it. What doubles is the **print count**: one line at
   * quantity 2, `baseCopies` 1. So the harm is a wasted print and a wrong parts
   * list, not a wasted download.
   *
   * **This note discloses it; it deliberately does not suppress the insert.**
   * Suppressing would mean accepting whatever base is underneath, and the
   * candidate pool that would be accepted is measured: the median topper
   * carrying a size code has **79** same-code bases to choose from (max 132, over
   * 1,999 toppers), and **584 of the 1,963 bases (29.7%) are a print variant
   * rather than the base itself** — 378 topless, 206 unsupported. A topless base
   * has no top surface; it is a different product. Row D1 exists because a
   * ranking that fell through to file size handed one out for 79.1% of openlock
   * toppers silently, and a suppression rule with no congruence check reopens
   * that door from the other side. Telling the user beats guessing for them.
   *
   * The condition is **a shared anchor**, not an overlap test, and that is a
   * layering fact rather than laziness: overlap lives in
   * `src/builder/canvas/overlap.ts`, which imports `@/assembly`, so the geometry
   * cannot come back the other way without a cycle. A shared `(x, z)` needs no
   * geometry, and it is how these actually stack — the base for a separate-wall
   * topper is itself `wall`-shaped, so base and topper are anchored together. It
   * will not see a base whose anchor is offset from the topper's; the honest fix
   * for that is `AssemblyOptions` taking the answer from the builder, which owns
   * the geometry, and that is a row across both modules.
   *
   * `warn`, and the frequency says that is not wallpaper: it needs the user to
   * have placed a base *and* a topper on the same cell, which no fixture and no
   * default scene does. **2,250 of 4,363 topper files (51.6%)** still receive an
   * auto-inserted base after A6's rule 0 substitutes a self-sufficient sibling
   * where one exists, and **1,835 of the 1,963 bases (93.5%)** are placeable from
   * the palette, so the population that can reach this is large — it is the
   * coincidence that is rare.
   */
  | 'base-already-on-plan'
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
  'base-option-chosen': 'warn',
  'base-already-on-plan': 'warn',
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
