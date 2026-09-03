/**
 * Slot candidate sets, **derived in the browser and shipped as 0 bytes**.
 *
 * ## Why nothing is precomputed
 *
 * `config.ts` establishes that `constrain` is a join over the parent's tags and
 * the siblings selected so far. The parent half is static; the sibling half is
 * runtime state, so a precomputed set is correct only until the first click.
 * That is the argument, and the measurements behind it are in `measure.ts`:
 * shipping the initial-state sets costs **283,368 B raw / 3,606 B brotli** and
 * buys a set the UI has to recompute anyway, and materialising every
 * sibling-selection state means **99,931 sets, 2,798,529 B raw**. Deriving them
 * instead costs one pass over data the artefact already carries.
 *
 * The corpus is what makes deriving cheap rather than merely correct: a slot's
 * candidate set has a **median of 14** members, so the work is bounded by the
 * shortest posting list rather than by the 8,702 records.
 *
 * Row A1 established the pattern and the arithmetic: it declined to emit the
 * aggregate grouping at 40,454 B brotli against an index already at 71.4% of its
 * 500 KB budget, and derived it in the browser for **1,896 B** of JavaScript.
 * This row emits **0 bytes** for the same reason with a stronger argument,
 * because here the precomputed answer would also be *wrong*. Measured the same
 * way — esbuild, bundled, minified, `@/catalog` external, brotli 11 — this file
 * and `config.ts` together are **3,831 B minified, 1,438 B brotli**, against the
 * 283,368 B of raw JSON the leanest per-slot encoding would have added.
 * `measure.ts` is not part of that: only the tests import it, so it is
 * tree-shaken out of any bundle C2 builds.
 *
 * ## The index
 *
 * One inverted index over the tag table, in CSR layout: `offsets` (one Int32 per
 * tag plus one) and `docs` (one Int32 per tag reference, **101,427** of them over
 * 8,702 records and 930 tags — 405,708 B and 3,724 B respectively, both exact
 * and both allocated once). Postings are in record order, and records are sorted by
 * `id`, so every posting list is ascending and every intersection is a
 * two-pointer walk. Slot candidate sets are small — median 14 under the ported
 * reading — so the whole cost of a resolution is the postings walk over the
 * *smallest* require list, which is what {@link CompositionIndex.candidatesFor}
 * orders for.
 *
 * A tag-string index rather than the bitsets `src/search/bitset.ts` uses. Two
 * reasons and neither is taste: `@/search`'s barrel does not export the bitset
 * primitives, so using them would mean reaching past a seam row A2 deliberately
 * drew; and a bitset over 8,702 records is 1,088 B per tag, so the 930-tag index
 * would be **1,011,840 B against this one's measured 409,432 B** — bitsets win on
 * wide facet queries and lose on 14-element intersections.
 */
import type {
  AggregateAddress,
  AggregateIndex,
  CatalogFile,
  CatalogRecord,
  PartSlot,
  TileId,
} from '@/catalog'
import { buildAggregateIndex } from '@/catalog'

import type { ResolvedSlot, SiblingSelection } from './config'
import { resolveSlotTags } from './config'

/* ------------------------------------------------------------------ postings */

/** The inverted index, exposed so `measure.ts` can report its exact size. */
export interface TagPostings {
  /** One entry per tag, plus a terminator. `offsets[i]…offsets[i+1]` is tag `i`'s list. */
  readonly offsets: Int32Array
  /** Record indices, ascending within each tag. One entry per tag reference. */
  readonly docs: Int32Array
  /** Tag string → its index in `file.tags`. */
  readonly idOf: ReadonlyMap<string, number>
  /** `offsets.byteLength + docs.byteLength`. The whole memory cost, measured not estimated. */
  readonly bytes: number
}

function buildPostings(file: CatalogFile): TagPostings {
  const tagCount = file.tags.length
  const offsets = new Int32Array(tagCount + 1)

  for (const record of file.records) {
    for (const tag of record.tags) {
      const slot = (tag as unknown as number) + 1
      offsets[slot] = (offsets[slot] ?? 0) + 1
    }
  }
  for (let i = 0; i < tagCount; i += 1) offsets[i + 1] = (offsets[i] ?? 0) + (offsets[i + 1] ?? 0)

  const docs = new Int32Array(offsets[tagCount] ?? 0)
  const cursor = Int32Array.from(offsets.subarray(0, tagCount))
  file.records.forEach((record, doc) => {
    for (const tag of record.tags) {
      const id = tag as unknown as number
      const at = cursor[id] ?? 0
      docs[at] = doc
      cursor[id] = at + 1
    }
  })

  const idOf = new Map<string, number>()
  file.tags.forEach((tag, id) => idOf.set(tag, id))

  return { offsets, docs, idOf, bytes: offsets.byteLength + docs.byteLength }
}

/* ---------------------------------------------------------------- resolution */

/** One slot's candidates, with the resolved constraint that produced them. */
export interface SlotCandidates {
  /** The resolved exact-match and positional constraint. See {@link ResolvedSlot}. */
  readonly resolved: ResolvedSlot
  /** Candidate files, in catalog-id order. The thing a recipe names and a download fetches. */
  readonly tiles: readonly TileId[]
  /**
   * The catalog items those files belong to, ascending address.
   *
   * Fewer than {@link tiles} and often far fewer: a slot's candidates are
   * usually several printable variants of a handful of designs. C2's sprite grid
   * is an item grid, and the tile is chosen from the item afterwards by
   * `selectVariant` — the same two-step row A3 uses for the catalog.
   */
  readonly items: readonly AggregateAddress[]
  /**
   * No candidate at all — the pick that leads nowhere, which is C2's dead-end
   * greying. **526 of the 3,695 live slots (14.2%)** are already here in their
   * initial state; `measure.ts` carries the breakdown and the reason.
   */
  readonly deadEnd: boolean
  /**
   * Refs that name a tag the table does not hold, so the intersection is empty
   * by construction rather than by narrowing.
   *
   * **Empty across the whole corpus today** — all 91 `require` and 7 `deny` refs
   * resolve — and the build check in `build.ts` is what keeps it that way. Kept
   * on the result rather than only in the build because "nothing matches" and
   * "you asked for a tag that does not exist" are different things to show a
   * user.
   */
  readonly unknownRefs: readonly string[]
}

export interface CompositionIndex {
  /** Live slots. 3,695. */
  readonly slots: number
  /** Tiles declaring at least one slot. 3,036 (34.9%). */
  readonly tilesWithSlots: number
  /** Every distinct ref any slot names, across `require`, `deny` and `constrain`. 99. */
  readonly refs: readonly string[]
  readonly postings: TagPostings
  readonly aggregates: AggregateIndex

  /** A tile's declared slots, in fixture order. Empty for the 5,666 tiles with no config. */
  slotsOf(tile: TileId): readonly PartSlot[]
  /** A record's tag list as strings. The `parentTags` a `constrain` entry reads. */
  tagsOf(tile: TileId): readonly string[]

  /**
   * Resolve one slot for one **variant** of the declaring item.
   *
   * The parent is a file and not an item on purpose: `config` is the one field
   * A1's collapse is not lossless on — it varies within 828 aggregates (21.7%) —
   * and the tags a `constrain` entry inherits are the *variant's*. Resolving
   * against an item would have to pick one variant's tags and would silently
   * answer for the wrong print.
   */
  resolve(slot: PartSlot, parent: TileId, siblings?: readonly SiblingSelection[]): SlotCandidates

  /** The postings intersection alone, for an already-resolved constraint. */
  candidatesFor(resolved: ResolvedSlot): SlotCandidates
}

/**
 * Build the composition index over a parsed catalog.
 *
 * Pure and deterministic, so a caller may memoise it on the version stamp — the
 * same contract `buildAggregateIndex` and `buildAssemblyIndex` offer. The
 * aggregate index is a parameter because A2 and A3 have already built one and
 * addresses must be A1's rather than recomputed; it is defaulted so a test does
 * not have to care.
 */
export function createCompositionIndex(
  file: CatalogFile,
  aggregates: AggregateIndex = buildAggregateIndex(file),
): CompositionIndex {
  const postings = buildPostings(file)
  const docOf = new Map<TileId, number>()
  file.records.forEach((record, doc) => docOf.set(record.id, doc))

  const refs = new Set<string>()
  let slots = 0
  let tilesWithSlots = 0
  for (const record of file.records) {
    const parts = record.config?.parts ?? []
    if (parts.length > 0) tilesWithSlots += 1
    slots += parts.length
    for (const part of parts) {
      for (const ref of part.tags.require ?? []) refs.add(ref.tag)
      for (const ref of part.tags.deny ?? []) refs.add(ref.tag)
      for (const ref of part.tags.constrain ?? []) refs.add('tag' in ref ? ref.tag : ref.filter)
    }
  }

  /** Prefix unions, memoised: `accept` is positional, and 4 refs are namespace roots. */
  const prefixCache = new Map<string, Int32Array>()

  function listFor(tag: string): Int32Array | undefined {
    const id = postings.idOf.get(tag)
    if (id === undefined) return undefined
    const from = postings.offsets[id] ?? 0
    const to = postings.offsets[id + 1] ?? from
    return postings.docs.subarray(from, to)
  }

  function prefixList(prefix: string): Int32Array {
    const cached = prefixCache.get(prefix)
    if (cached !== undefined) return cached
    const under = new Set<number>()
    file.tags.forEach((tag, id) => {
      if (tag === prefix || tag.startsWith(`${prefix}|`)) under.add(id)
    })
    const merged = new Set<number>()
    for (const id of under) {
      const from = postings.offsets[id] ?? 0
      const to = postings.offsets[id + 1] ?? from
      for (let at = from; at < to; at += 1) merged.add(postings.docs[at] ?? 0)
    }
    const list = Int32Array.from([...merged].sort((a, b) => a - b))
    prefixCache.set(prefix, list)
    return list
  }

  function candidatesFor(resolved: ResolvedSlot): SlotCandidates {
    const unknownRefs: string[] = []

    /* Exact require, smallest list first: the intersection can only shrink, so
       starting narrow is the difference between walking 14 entries and 8,702. */
    const required: Int32Array[] = []
    for (const tag of resolved.require) {
      const list = listFor(tag)
      if (list === undefined) {
        unknownRefs.push(tag)
        return empty(resolved, unknownRefs)
      }
      required.push(list)
    }
    for (const prefix of resolved.accept) required.push(prefixList(prefix))
    required.sort((a, b) => a.length - b.length)

    let hits: number[] =
      required.length === 0
        ? file.records.map((_record, doc) => doc)
        : [...(required[0] ?? new Int32Array(0))]
    for (let i = 1; i < required.length && hits.length > 0; i += 1) hits = intersect(hits, required[i] ?? new Int32Array(0))

    for (const tag of resolved.deny) {
      if (hits.length === 0) break
      const list = listFor(tag)
      // A deny naming a tag nothing carries excludes nothing. Not an error: it is
      // a constraint that happens to be satisfied by the whole corpus.
      if (list === undefined) {
        unknownRefs.push(tag)
        continue
      }
      hits = subtract(hits, list)
    }

    const tiles: TileId[] = []
    const addresses = new Set<number>()
    for (const doc of hits) {
      const record = file.records[doc]
      if (record === undefined) continue
      tiles.push(record.id)
      const aggregate = aggregates.byDesign.get(record.design)
      if (aggregate !== undefined) addresses.add(aggregate.address)
    }

    return {
      resolved,
      tiles,
      items: [...addresses].sort((a, b) => a - b) as unknown as readonly AggregateAddress[],
      deadEnd: tiles.length === 0,
      unknownRefs,
    }
  }

  function empty(resolved: ResolvedSlot, unknownRefs: readonly string[]): SlotCandidates {
    return { resolved, tiles: [], items: [], deadEnd: true, unknownRefs: [...unknownRefs] }
  }

  function recordOf(tile: TileId): CatalogRecord | undefined {
    const doc = docOf.get(tile)
    return doc === undefined ? undefined : file.records[doc]
  }

  function tagsOf(tile: TileId): readonly string[] {
    const record = recordOf(tile)
    if (record === undefined) return []
    return record.tags.map((tag) => file.tags[tag as unknown as number] ?? '')
  }

  return {
    slots,
    tilesWithSlots,
    refs: [...refs].sort(),
    postings,
    aggregates,
    slotsOf: (tile) => recordOf(tile)?.config?.parts ?? [],
    tagsOf,
    resolve(slot, parent, siblings = []) {
      return candidatesFor(resolveSlotTags(slot.tags, tagsOf(parent), siblings))
    },
    candidatesFor,
  }
}

/** Two ascending lists, intersected. */
function intersect(a: readonly number[], b: Int32Array): number[] {
  const out: number[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    const left = a[i] ?? 0
    const right = b[j] ?? 0
    if (left === right) {
      out.push(left)
      i += 1
      j += 1
    } else if (left < right) i += 1
    else j += 1
  }
  return out
}

/** An ascending list with everything in `b` removed. */
function subtract(a: readonly number[], b: Int32Array): number[] {
  const out: number[] = []
  let i = 0
  let j = 0
  while (i < a.length) {
    const left = a[i] ?? 0
    while (j < b.length && (b[j] ?? 0) < left) j += 1
    if (j < b.length && (b[j] ?? 0) === left) {
      i += 1
      continue
    }
    out.push(left)
    i += 1
  }
  return out
}
