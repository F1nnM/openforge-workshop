/**
 * The facet projections: connection systems, kind buckets, layer, texture,
 * build system, openlock size code and rotation step.
 *
 * Each is a projection of the tag list, and each has one trap that has already
 * cost someone a day. The traps are documented next to the code that avoids
 * them, because they are all *silent* — every one of them produces a plausible
 * value rather than an error.
 */
import type { Layer } from '../src/catalog'

import { hasTagPrefix, namespaceRoots, numericTagValue, tagValue } from './tags'

/* --------------------------------------------------------------- connections */

/**
 * The face a connection is mounted on.
 *
 * `bottom` is the tile's own underside — the joinery that meets the table, or the
 * base it sits on — and it is also the position of a tag that names no position
 * at all: `connection|openlock` is openlock underneath. The corpus spells that
 * explicitly on 6 tiles (`connection|bottom`, always beside the tag that names
 * the system), so the stated and the unstated spelling are folded into one key
 * rather than left as two for every caller to remember to union. The fold costs
 * nothing today — those 6 tags name no system — and it means a future
 * `connection|bottom|openlock` lands where consumers already look instead of in
 * a bucket nobody reads.
 */
export type ConnectionPosition = 'bottom' | 'side' | 'left' | 'right'

/**
 * Segments that name a **position** rather than a system.
 *
 * `connection|side|openlock` is openlock mounted on the side. Reading segment
 * one blindly invents a `side` system on the 2,079 tiles (23.9%) that carry one
 * and — far worse — hides openlock from every one of them. The first version of
 * the verify script had exactly this bug and it moved the lock-reachability
 * figures by up to 8 percentage points.
 *
 * `bottom` (6 tags), `left` (1) and `right` (1) are the same bug at a 260th of
 * the scale, and this list held only `side` until now: the other three minted
 * phantom systems named after faces on exactly 8 records, which the `conn` facet
 * then offered as filter values with counts 6, 1 and 1. With all four listed the
 * corpus yields **7** connection systems — dragonlock, dual, filament, magnetic,
 * openforge, openlock, pegs — where it used to yield 10.
 *
 * This is the vocabulary of the **leading** segment only. The 3 tags spelling it
 * the other way round (`connection|openlock` followed by `side`) are deliberately
 * *not* folded: `docs/verify-catalog-facts.py` defines a side lock as segment two
 * of `connection|side|…`, the plan's 23.9% is measured against that definition,
 * and all 3 of those tiles also carry a bare `connection|openlock` — so nothing
 * invents or loses a system, only the position is understated on 3 records.
 * Re-spelling those tags is a fixture question, not a projection question.
 */
export const CONNECTION_POSITIONS: readonly ConnectionPosition[] = Object.freeze([
  'side',
  'bottom',
  'left',
  'right',
])

const POSITION_SEGMENTS: ReadonlySet<string> = new Set<string>(CONNECTION_POSITIONS)

function isConnectionPosition(segment: string): segment is ConnectionPosition {
  return POSITION_SEGMENTS.has(segment)
}

/**
 * Connection systems keyed by the face they are mounted on.
 *
 * **Total** — every position is present, with an empty array where nothing is
 * mounted there — so a missing face reads as "nothing here" rather than arriving
 * as `undefined` at a call site that forgot to check. Arrays are sorted, so the
 * value is a pure function of the tag set.
 */
export type ConnectionsByPosition = Readonly<Record<ConnectionPosition, readonly string[]>>

/**
 * Split a tile's `connection|` tags into systems per face.
 *
 * This is what {@link connectionSystems} used to throw away. One measurement says
 * why it may not:
 *
 * | layer      |     n | bottom lock | side lock only | no lock at all |
 * | ---------- | ----: | ----------: | -------------: | -------------: |
 * | `topper`   | 4,363 |       **0** |          1,283 |          3,080 |
 * | `integral` | 2,091 |       1,972 |             52 |             67 |
 * | `base`     | 1,963 |       1,963 |              0 |              0 |
 * | `insert`   |   285 |           0 |              1 |            284 |
 *
 * **Not one of the 4,363 toppers carries a bottom lock**, by construction: a
 * topper's underside *is* `connection|openforge`, the declaration that its
 * joinery lives on a separately printed base. The 1,283 toppers that do name a
 * lock name it on the side — `openforge,side+dragonlock` is openforge underneath
 * and dragonlock to the neighbour. Read off the flattened list those 1,283 look
 * like tiles that "offer dragonlock", and a base matcher or an availability chip
 * built on that would advertise joinery the mesh physically does not have. That
 * is the `side`-phantom bug one level deeper, which is why position is now
 * carried rather than folded away.
 *
 * A bare position tag (`connection|side`, 2,080 tiles) names a face with no
 * system on it and so contributes nothing: the system is named by its sibling
 * tags. `left` and `right` are, today, always such tags — both their buckets are
 * empty corpus-wide — and they are still keys rather than a special case,
 * because the point of this row is that a position appearing where a system is
 * expected must be data rather than a silent invention.
 *
 * Positions are **not** emitted onto `CatalogRecord`: `record.tags` carries the
 * full interned tag list, so any consumer re-derives this in one call, and adding
 * a field is the schema row's to make when the aggregate substrate needs one.
 */
export function connectionsByPosition(tags: readonly string[]): ConnectionsByPosition {
  const found: Record<ConnectionPosition, Set<string>> = {
    bottom: new Set(),
    side: new Set(),
    left: new Set(),
    right: new Set(),
  }

  for (const tag of tags) {
    if (!tag.startsWith('connection|')) continue
    let parts = tag.split('|').slice(1)
    let position: ConnectionPosition = 'bottom'
    const head = parts[0]
    if (head !== undefined && isConnectionPosition(head)) {
      position = head
      parts = parts.slice(1)
    }
    const system = parts[0]
    if (system !== undefined) found[position].add(system)
  }

  return Object.freeze({
    bottom: [...found.bottom].sort(),
    side: [...found.side].sort(),
    left: [...found.left].sort(),
    right: [...found.right].sort(),
  })
}

/**
 * The joinery systems a tile offers, on any face.
 *
 * The union of {@link connectionsByPosition} — the same normalisation, projected
 * down to the question almost every consumer actually asks ("does this tile
 * offer openlock at all?"): the `conn` facet, `src/assembly/resolve.ts`'s
 * `conn.includes(lock)`, `src/ui/lock-picker/reach.ts`. Deriving it from the
 * positional map rather than parsing the tags a second time is what keeps the
 * two from drifting.
 *
 * A port of `connection_systems` in `docs/verify-catalog-facts.py`. Taking the
 * first segment *after* an optional leading position is also what folds the
 * variants §5 lists — `topless`, `unsupported`, `flex`, `filament`, `split` —
 * into their parent system, because none of them ever occupies that slot:
 * `connection|openlock|topless` is openlock, `connection|openforge|split` is
 * openforge. `connection|side|filament` is the one case where a name from that
 * list *is* the system, since filament is what side-mounts there and no parent
 * system is named — which is precisely why the rule is positional rather than a
 * blocklist of words.
 *
 * Sorted, so the array is a pure function of the tag set.
 */
export function connectionSystems(tags: readonly string[]): string[] {
  const byPosition = connectionsByPosition(tags)
  const systems = new Set<string>()
  for (const position of CONNECTION_POSITIONS) {
    for (const system of byPosition[position]) systems.add(system)
  }
  return [...systems].sort()
}

/** Lock systems, in the order §2 measures their reachability (99.9% / 74.7% / 59.7%). */
export const LOCK_SYSTEMS = ['openlock', 'dragonlock', 'magnetic'] as const

/**
 * Whether a connection system is one a user has to *choose* between.
 *
 * `openforge` is a connection system and not a lock: it is the declaration that
 * there is no joinery on this mesh at all. `dual`, `pegs` and `filament` are
 * likewise not choices the lock preference ranges over. Exported so a caller
 * asking "which locks are on the bottom face" writes
 * `connectionsByPosition(tags).bottom.filter(isLockSystem)` rather than
 * re-deriving the vocabulary.
 */
export function isLockSystem(system: string): boolean {
  return (LOCK_SYSTEMS as readonly string[]).includes(system)
}

/* --------------------------------------------------------------------- kinds */

/**
 * The kind-bucket vocabulary.
 *
 * `CatalogRecord.kinds` is deliberately `string[]` and not an enum because this
 * list is the importer's to fix; this is the list. It reproduces the plan's
 * conclusion on the live corpus: **19.5% of tiles land in two or more buckets
 * and 11.9% in none**, so kind is a multi-select facet over an array and an
 * empty array is a legitimate value, not missing data.
 *
 * `door` is absent on purpose. `shape|door` has **zero** occurrences corpus-wide
 * — a door is a `component|door` mounted on a wall — so a doors bucket built
 * from shape tags would yield nothing and look like a bug in the facet engine.
 */
const KIND_BUCKETS = new Set(['floor', 'wall', 'base', 'stairs', 'column', 'riser', 'angled'])

/** The buckets this tile belongs to, sorted. May legitimately be empty. */
export function kindBuckets(tags: readonly string[]): string[] {
  return namespaceRoots(tags, 'shape')
    .filter((root) => KIND_BUCKETS.has(root))
    .sort()
}

/* --------------------------------------------------------------------- layer */

/**
 * Where a tile sits in an assembly.
 *
 * The three positive signals are **disjoint on the live corpus** — verified:
 * zero tiles carry two of `part|`, `shape|base` and `connection|openforge` — so
 * the order below documents intent rather than resolving conflicts, and
 * `facets.test.ts` asserts the disjointness so a future overlap fails loudly
 * instead of silently taking the first branch.
 *
 *   - `insert` (285) — carries a `part|` tag: it *is* a door, grate, torch or
 *     lintel, reached through a composition slot rather than placed on the grid.
 *     `config.fulfills` is deliberately **not** used as the signal: all 21 tiles
 *     that carry it are full 2x2 grid pieces that happen to also satisfy a
 *     neighbour's slot, and calling them inserts would pull them out of the
 *     placement palette.
 *   - `base` (1,963) — `shape|base`; carries the joinery for what sits on it.
 *   - `topper` (4,363) — `connection|openforge`, which *means* "my joinery lives
 *     on a separately printed base". Half the corpus. This is why a placement is
 *     an assembly rather than a file.
 *   - `integral` (2,091) — everything else: carries its own joinery, or none.
 */
export function classifyLayer(tags: readonly string[]): Layer {
  if (hasTagPrefix(tags, 'part|')) return 'insert'
  if (hasTagPrefix(tags, 'shape|base')) return 'base'
  if (hasTagPrefix(tags, 'connection|openforge')) return 'topper'
  return 'integral'
}

/* ------------------------------------------------------------------- texture */

/**
 * The texture root — the first segment after `texture|`, from the first texture
 * tag. 38 distinct roots, which is the count the material registry (§9, PR 8) is
 * specified against.
 *
 * 80 tiles carry two roots (`aztlan%bamboo#door` is tagged both `texture|aztlan`
 * and `texture|bamboo`); taking the first tag picks the design family rather
 * than the accent material, which is the one the tint should follow.
 *
 * **Two drift cases are deliberately left alone**, and both are reported rather
 * than silently collapsed:
 *
 *   - `texture|towne|stone-stucco` (72) and `texture|towne|stucco-stone` (72) are
 *     the same material tagged with the words reversed. They never co-occur, and
 *     both have root `towne`, so at root level there is nothing to normalise.
 *     Rewriting the tag strings themselves would desynchronise them from the
 *     `require`/`deny` refs carried through in `config`.
 *   - `texture|foundation` (51) and `texture|foundations` (2) *are* distinct
 *     roots and almost certainly one material. Collapsing them would take the
 *     root count from 38 to 37 and quietly invalidate the figure PR 8 builds
 *     against, so it is a decision for that PR, not a side effect of this one.
 */
export function textureRoot(tags: readonly string[]): string | undefined {
  return tagValue(tags, 'texture')
}

/* --------------------------------------------------------------------- build */

/**
 * The build system. Absent on 2,978 tiles (34.2%), and **absence is a real
 * state** the facet must offer as "unspecified" rather than treat as a gap.
 * No live tile carries two `build|` tags.
 */
export function buildSystem(tags: readonly string[]): string | undefined {
  return tagValue(tags, 'build')
}

/* ---------------------------------------------------- size code and rotation */

/**
 * The `size|openlock` code (`A`, `BA`, `IA`, `D`, `Q`, `IL`, …): 36 distinct
 * codes on 4,030 tiles, no tile carrying two.
 *
 * Hoisted out of `tags` because §7 makes it the base↔topper matching key, and
 * the assembly resolver compares it across candidate pairs.
 */
export function openlockSizeCode(tags: readonly string[]): string | undefined {
  return tagValue(tags, 'size|openlock')
}

/**
 * Rotation step from `size|angle`, present on 1,548 tiles.
 *
 * **893 of them carry a value that is not a multiple of 90** — 45, 22.5, 11.25,
 * 60, 120, 240, 300 — and would never tile on the 90° default. Returning
 * `undefined` means "use `DEFAULT_ROTATION_STEP_DEG`".
 *
 * On an arc this same tag is also the sweep, because the corpus has only the one
 * angle tag; the two readings coincide by construction rather than by accident.
 */
export function rotationStep(tags: readonly string[]): number | undefined {
  const angle = numericTagValue(tags, 'size|angle')
  return angle !== undefined && angle > 0 ? angle : undefined
}
