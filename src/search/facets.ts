/**
 * The facet index: one bitset per facet value, and **disjunctive** counts over it.
 *
 * ## Why disjunctive counts are the whole point
 *
 * The naive implementation counts every facet value against the *fully* filtered
 * result set. Select `dungeon_stone` and every other texture immediately reads
 * zero, because no item is both `dungeon_stone` and `cave`. The sidebar becomes a
 * dead end: the user's only legal next action is to undo what they just did.
 *
 * The fix is that **a facet's own counts are computed with that facet's filter
 * excluded**. With `dungeon_stone` selected, `cave` still reads 77 — "click here
 * and you get 77 items" — while the other three facets narrow normally. Every
 * faceted-search product does this; it is easy to leave out and it has no
 * symptom in a unit test that only ever selects one value, which is why
 * `engine.test.ts` and `corpus.test.ts` check the counts against a brute-force
 * oracle with two and three facets active at once.
 *
 * ## A member is an aggregate, and that changes what a count *means*
 *
 * Row A2 moved every index in this directory off records and onto row A1's
 * aggregates: **3,822 documents, not 8,702**. `documents.ts` explains the
 * addressing; what matters here is the semantics.
 *
 * A count was a number of files and is now a number of *items*, and an item
 * matches a facet value when **any** of its variants does. For three of the four
 * facets that is a distinction without a difference, because A1 measured that
 * `kinds`, `build` and the texture tags do not vary inside a group and
 * `pipeline/aggregate.ts` fails the build if they ever do. For `conn` it is the
 * whole point of aggregating: 1,563 aggregates hold two distinct values of it,
 * and the union takes "carries two or more systems" from **28.6% of files to
 * 42.0% of items**. An item whose openlock variant and whose openforge variant
 * are different files is in *both* buckets, though no single file is — so a
 * facet's counts are no longer a sum over its records, and the bucket totals
 * over-count the corpus by more than they used to.
 *
 * Which is also why the counts are built by *setting a bit per document* rather
 * than by tallying: {@link Collector} tests the bit before it counts, so two
 * variants agreeing on a value contribute one member, and two variants
 * disagreeing contribute one member to each of two values.
 *
 * ## The four facets, and why none of them is a plain enum
 *
 * Each shape below is a measured property of the corpus, not a preference. The
 * numbers are over the 3,822 aggregates and are re-derived from the emitted
 * index by `corpus.test.ts`.
 *
 * | facet   | semantics                                    | the fact that forces it |
 * | ------- | -------------------------------------------- | ----------------------- |
 * | `kinds` | multi-select OR, plus {@link KIND_OTHER}      | 13.7% of items are in 2+ buckets and 16.0% in none — neither is expressible as one value, and without an explicit "other" bucket 611 items are unreachable from the sidebar |
 * | `tex`   | multi-select OR of **namespace prefixes**     | 37 roots with 45 deeper paths beneath them; selecting `dungeon_stone` must also match `texture\|dungeon_stone\|eroded` |
 * | `build` | single-select, plus {@link BUILD_UNSPECIFIED} | 1,511 items (39.5%) carry no `build\|` tag, so absence is a value |
 * | `conn`  | multi-select OR                              | 1,605 items (42.0%) carry 2+ systems, against 2,493 files (28.6%) |
 *
 * ## Two facets are read off the aggregate, and two off its variants
 *
 * `kinds` and `build` come from {@link TileAggregate}, which hoists them — one
 * value per item, so `build` still *partitions* the corpus and its buckets still
 * sum to exactly 3,822. `tex` and `conn` are unioned over the group's records,
 * because the aggregate publishes neither a tag list nor a per-face connection
 * set (see `documents.ts` for why).
 *
 * The oracle in `oracle.ts` deliberately reads **all four** as "any variant
 * matches". The two implementations agreeing is therefore a live check that
 * hoisting is legitimate: if `build` ever varied inside a group, the fast path
 * would report the hoisted value and the oracle the union, and the comparison
 * would fail rather than quietly showing a filter that drops items.
 *
 * ## The texture facet is matched on tags, not on `record.texture`
 *
 * `CatalogRecord.texture` is a single root, taken from the *first* texture tag.
 * That is right for the material registry (one tile, one tint) and wrong for a
 * filter, and it is wrong in a measurable way: 80 tiles carry two roots, and
 * `stucco` is **always** alphabetically later than its co-tag, so it never wins
 * the field and a vocabulary read off `record.texture` has 36 entries where the
 * tag table has 37. Rather than assert 37 and get 36, this indexes every
 * `texture|…` tag the group's records carry — which gives all 37 roots a
 * non-zero count (`stucco` reaches 24 items), makes the two-root tiles findable
 * under both names, and gets prefix matching for free because the deeper paths
 * are just longer keys in the same map.
 *
 * Prefixes match on **segment boundaries**, so `stone` does not match
 * `stone_brick` and `cave` does not match `cavern`. Those are the facet-side
 * spelling of the substring trap that `text.ts` fixes for queries: a filter that
 * silently widens is worse than one that finds nothing, because the user can see
 * the second happen.
 */
import type { TileAggregate } from '@/catalog'

import { andInto, copyInto, createBitset, fullBitset, getBit, orInto, popcountAnd, setBit } from './bitset'
import type { SearchDoc } from './documents'
import { BUILD_UNSPECIFIED, readBuildFilter } from './searchSchema'
import type { FacetSearch } from './searchSchema'

/** The four facets, in sidebar order. Keys match {@link FacetSearch}'s. */
export const FACET_KEYS = ['kinds', 'tex', 'build', 'conn'] as const

/** One of the four facet fields. */
export type FacetKey = (typeof FACET_KEYS)[number]

/**
 * The `kinds` value meaning "in none of the kind buckets".
 *
 * 1,032 tiles (11.9%) have an empty `kinds` array — they are components,
 * scatter, inserts and oddments whose `shape|` roots are outside the importer's
 * seven-bucket vocabulary. Without a value for them the sidebar can express
 * "floors" and "walls" but never "the rest", and an eighth of the catalog is
 * reachable only by clearing the facet.
 *
 * `!other` follows the sentinel convention {@link BUILD_UNSPECIFIED} sets: a
 * leading `!` cannot collide with a bucket name, because the importer's buckets
 * come from tag segments and no tag segment starts with `!`.
 */
export const KIND_OTHER = '!other'

/** Segment separator inside a texture tag — `texture|towne|stucco`. */
const TEXTURE_SEGMENT = '|'

/** One facet value and its live count, as the sidebar renders it. */
export interface FacetBucket {
  /** The value to put in the URL. May be {@link KIND_OTHER} or {@link BUILD_UNSPECIFIED}. */
  readonly value: string
  /**
   * **Items** this value would yield, with this facet's own filter excluded.
   *
   * Aggregates, not files: an item counts once however many of its variants
   * carry the value, and counts under every value any of them carries.
   */
  readonly count: number
  /** Whether the current search selects it. */
  readonly selected: boolean
}

/** Live counts for every facet. */
export type FacetCounts = { readonly [K in FacetKey]: readonly FacetBucket[] }

/** Every value each facet offers, in a stable display order. */
export type FacetVocabulary = { readonly [K in FacetKey]: readonly string[] }

/** One facet's postings, plus the vocabulary it renders. */
interface FacetField {
  /**
   * Values shown in the sidebar, ordered by **corpus-wide** count descending and
   * then by value, so the order is a property of the catalog rather than of the
   * current query. Ordering by live count would make chips jump under the
   * cursor on every keystroke.
   */
  readonly vocabulary: readonly string[]
  /**
   * Every filterable value → the items carrying it.
   *
   * A superset of `vocabulary` for `tex`, where the 45 deeper namespace paths
   * are filterable but are not top-level chips.
   */
  readonly bits: ReadonlyMap<string, Uint32Array>
}

/** The facet index over one catalog, in document order. */
export interface FacetIndex {
  /** Documents indexed — 3,822 aggregates for the live corpus, not 8,702 files. */
  readonly size: number
  readonly fields: { readonly [K in FacetKey]: FacetField }
  readonly vocabulary: FacetVocabulary
}

/* ------------------------------------------------------------------- building */

/**
 * Build the facet index over the aggregate documents.
 *
 * `docs` must already be in **document order** — `buildSearchDocs` emits it,
 * ascending {@link TileAggregate.address} — and `tagTable` must be the intern
 * table the records' `tags` index into.
 *
 * `kinds` and `build` are taken from the aggregate and `tex` and `conn` from the
 * union over its records; the module docblock has the argument for the split.
 */
export function buildFacetIndex(docs: readonly SearchDoc[], tagTable: readonly string[]): FacetIndex {
  const size = docs.length
  const texturePaths = textureTagPaths(tagTable)

  const kinds = new Collector(size)
  const tex = new Collector(size)
  const build = new Collector(size)
  const conn = new Collector(size)

  for (let doc = 0; doc < size; doc++) {
    const entry = docs[doc]
    if (entry === undefined) continue
    const aggregate: TileAggregate = entry.aggregate

    if (aggregate.kinds.length === 0) kinds.add(KIND_OTHER, doc)
    else for (const kind of aggregate.kinds) kinds.add(kind, doc)

    build.add(aggregate.build ?? BUILD_UNSPECIFIED, doc)

    for (const record of entry.records) {
      for (const tag of record.tags) {
        for (const path of texturePaths[tag] ?? EMPTY) tex.add(path, doc)
      }
      for (const system of record.conn) conn.add(system, doc)
    }
  }

  const fields = {
    kinds: kinds.field(),
    tex: tex.field((value) => !value.includes(TEXTURE_SEGMENT)),
    build: build.field(),
    conn: conn.field(),
  } as const

  return {
    size,
    fields,
    vocabulary: {
      kinds: fields.kinds.vocabulary,
      tex: fields.tex.vocabulary,
      build: fields.build.vocabulary,
      conn: fields.conn.vocabulary,
    },
  }
}

const EMPTY: readonly string[] = []

/**
 * Every namespace prefix each tag contributes to the texture facet.
 *
 * `texture|towne|stucco` yields `towne` and `towne|stucco`, so one map lookup
 * answers a filter at either depth. Computed once over the 915-entry intern
 * table rather than per record: the corpus holds 84,023 tag references, so
 * re-splitting per reference would be 92× the work for the same answer.
 *
 * Non-texture tags map to `undefined`, which the caller reads as "contributes
 * nothing" — a sparse array indexed by `TagId` beats a `Map` here because the
 * lookup is on the hot build path and the keys are dense small integers.
 */
function textureTagPaths(tagTable: readonly string[]): readonly (readonly string[] | undefined)[] {
  const paths: (readonly string[] | undefined)[] = new Array<readonly string[] | undefined>(tagTable.length)

  for (let id = 0; id < tagTable.length; id++) {
    const tag = tagTable[id]
    if (tag === undefined || !tag.startsWith('texture|')) continue
    const segments = tag.split(TEXTURE_SEGMENT).slice(1)
    const prefixes: string[] = []
    for (let depth = 1; depth <= segments.length; depth++) {
      prefixes.push(segments.slice(0, depth).join(TEXTURE_SEGMENT))
    }
    paths[id] = prefixes
  }

  return paths
}

/** Accumulates one facet's postings, then freezes them into a {@link FacetField}. */
class Collector {
  private readonly size: number
  private readonly bits = new Map<string, Uint32Array>()
  private readonly counts = new Map<string, number>()

  constructor(size: number) {
    this.size = size
  }

  add(value: string, doc: number): void {
    let bits = this.bits.get(value)
    if (bits === undefined) {
      bits = createBitset(this.size)
      this.bits.set(value, bits)
    }
    // Two ways to reach the same value twice, and the second is new to A2: a
    // tile tagged `texture|cave` and `texture|cave|sandstone` reaches `cave`
    // twice, and now so does an item whose openlock topper and openlock
    // integral variant both name openlock. Counting the *member* rather than the
    // visit is what makes a bucket a number of items.
    if (getBit(bits, doc)) return
    setBit(bits, doc)
    this.counts.set(value, (this.counts.get(value) ?? 0) + 1)
  }

  /** `inVocabulary` defaults to "every value"; `tex` uses it to hide deeper paths. */
  field(inVocabulary: (value: string) => boolean = () => true): FacetField {
    const vocabulary = [...this.counts.entries()]
      .filter(([value]) => inVocabulary(value))
      .sort(([aValue, aCount], [bValue, bCount]) => bCount - aCount || (aValue < bValue ? -1 : 1))
      .map(([value]) => value)

    return { vocabulary, bits: this.bits }
  }
}

/* -------------------------------------------------------------------- filters */

/**
 * The bitset a facet's current selection restricts to, or `null` for "no filter".
 *
 * `null` rather than an all-ones bitset because the disjunctive pass needs to
 * know which filters are *active* — an all-ones mask is indistinguishable from
 * an inactive one once it has been AND-ed in, and the count for a facet with no
 * selection would then be computed against a different mask than the one the
 * user is about to change.
 *
 * A selected value with no bitset (a rotted link, a hand-typed texture) matches
 * nothing and is simply skipped. If *every* selected value is unknown the result
 * is an all-zero bitset — an honest empty result — rather than `null`, which
 * would silently drop the filter and show the whole catalog.
 */
export function facetFilter(index: FacetIndex, key: FacetKey, search: FacetSearch): Uint32Array | null {
  const field = index.fields[key]
  if (key === 'build') return buildFilter(field, index.size, search.build)

  const selected = search[key]
  if (selected.length === 0) return null

  const bits = createBitset(index.size)
  for (const value of selected) {
    const values = field.bits.get(value)
    if (values !== undefined) orInto(bits, values)
  }
  return bits
}

/**
 * The build facet, which is single-select and has a first-class "unspecified".
 *
 * Read through `readBuildFilter` rather than by comparing the raw string, so the
 * sentinel-versus-system distinction and the `!!`-escape both stay in the one
 * place PR 6 put them.
 */
function buildFilter(field: FacetField, size: number, encoded: string): Uint32Array | null {
  const filter = readBuildFilter(encoded)
  if (filter.kind === 'any') return null

  const value = filter.kind === 'unspecified' ? BUILD_UNSPECIFIED : filter.value
  const bits = field.bits.get(value)
  if (bits === undefined) return createBitset(size)
  const copy = createBitset(size)
  copyInto(copy, bits)
  return copy
}

/** Whether `search` selects `value` in facet `key`. */
export function isSelected(key: FacetKey, search: FacetSearch, value: string): boolean {
  if (key !== 'build') return search[key].includes(value)
  const filter = readBuildFilter(search.build)
  if (filter.kind === 'any') return false
  return filter.kind === 'unspecified' ? value === BUILD_UNSPECIFIED : filter.value === value
}

/* --------------------------------------------------------------------- counts */

/**
 * Disjunctive counts for all four facets.
 *
 * `masks` holds one entry per filter source that is active — the four facets
 * plus the text query, which is *not* a facet and therefore constrains all four
 * counts. Each facet's counts are taken against the AND of every active mask
 * except its own, which is the property described at the top of this module.
 *
 * A value the search selects but the corpus does not know is still emitted, with
 * a count of zero and `selected: true`. That is what lets the sidebar render —
 * and therefore let the user *remove* — a filter that arrived from a rotted
 * link. Dropping it would leave a filter narrowing the results with no visible
 * control attached to it.
 */
export function countFacets(
  index: FacetIndex,
  search: FacetSearch,
  filters: { readonly [K in FacetKey]: Uint32Array | null },
  text: Uint32Array | null,
): FacetCounts {
  const unfiltered = fullBitset(index.size)
  const scratch = createBitset(index.size)
  const counts: Partial<Record<FacetKey, FacetBucket[]>> = {}

  for (const key of FACET_KEYS) {
    maskExcluding(scratch, unfiltered, filters, text, key)
    const field = index.fields[key]
    counts[key] = valuesFor(key, search, field).map((value) => {
      const bits = field.bits.get(value)
      return {
        value,
        count: bits === undefined ? 0 : popcountAnd(scratch, bits),
        selected: isSelected(key, search, value),
      }
    })
  }

  return counts as FacetCounts
}

/** `scratch = AND of every active mask except facet `key`'s. */
function maskExcluding(
  scratch: Uint32Array,
  unfiltered: Uint32Array,
  filters: { readonly [K in FacetKey]: Uint32Array | null },
  text: Uint32Array | null,
  key: FacetKey,
): void {
  scratch.set(unfiltered)
  if (text !== null) andInto(scratch, text)
  for (const other of FACET_KEYS) {
    if (other === key) continue
    const bits = filters[other]
    if (bits !== null) andInto(scratch, bits)
  }
}

/**
 * The values one facet reports: its vocabulary, plus anything the search selects
 * that is not in it.
 *
 * The appended values are of two kinds and both need a bucket. A **deeper
 * texture path** (`cave|sandstone`) is filterable but is not a top-level chip, so
 * it is absent from the vocabulary and yet has real postings and a real count. A
 * value the corpus has never heard of arrived from a rotted or hand-edited link,
 * and gets a bucket with a count of zero — which is what lets the sidebar render,
 * and therefore let the user *remove*, a filter that is narrowing their results.
 * Dropping either would leave a filter with no visible control attached to it.
 */
function valuesFor(key: FacetKey, search: FacetSearch, field: FacetField): string[] {
  const known = new Set(field.vocabulary)
  const extra = selectedValues(key, search).filter((value) => !known.has(value))
  return extra.length === 0 ? [...field.vocabulary] : [...field.vocabulary, ...new Set(extra)]
}

function selectedValues(key: FacetKey, search: FacetSearch): readonly string[] {
  if (key !== 'build') return search[key]
  const filter = readBuildFilter(search.build)
  if (filter.kind === 'any') return []
  return [filter.kind === 'unspecified' ? BUILD_UNSPECIFIED : filter.value]
}
