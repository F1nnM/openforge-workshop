/**
 * The brute-force reference implementation the engine is checked against.
 *
 * This is **not** used by the app. It exists because the property that matters
 * most in `facets.ts` — a facet's counts computed with that facet's own filter
 * excluded — is invisible to any test that only ever selects one value in one
 * facet, and it stays invisible when the same author writes the fast path and
 * the expected numbers. So the semantics are written twice: once as bitsets, and
 * once here as the obvious nested loop over records, with no shared code between
 * them beyond the tokeniser and PR 6's `readBuildFilter`.
 *
 * It is kept in the source tree rather than inlined in a test file because two
 * suites compare against it (a synthetic corpus that runs everywhere, and the
 * real 8,702-file corpus when the fixtures are present), and because it is the
 * most readable statement of what the facets *mean*.
 *
 * ## Row A2: the oracle aggregates too, and does it its own way
 *
 * The engine indexes row A1's `AggregateIndex`. This file deliberately does
 * **not** import it. It groups `file.records` by `CatalogRecord.design` with a
 * `Map`, sorts the groups by their lowest ordinal, and reads every facet and
 * every token as the **union over the group's records**. Two independent
 * statements of the same thing, which is what makes the comparison worth
 * running:
 *
 *   - It re-derives the grouping, the document order and the preview pick, so a
 *     regression in `buildAggregateIndex` shows up as a search failure rather
 *     than as nothing.
 *   - It reads **all four** facets as "any variant matches", where the engine
 *     reads `kinds` and `build` off the hoisted aggregate fields. Those two
 *     agree exactly as long as A1's hoisting invariant holds — 0 of 3,822
 *     aggregates hold two distinct values of either — so the comparison is a
 *     live check on the invariant and not merely on the bitsets.
 *
 * Deliberately slow and deliberately literal: `O(items × values)` with string
 * comparisons throughout.
 */
import type { CatalogFile, CatalogRecord, DesignId, TileId } from '@/catalog'

import { KIND_OTHER } from './facets'
import type { FacetKey } from './facets'
import { BUILD_UNSPECIFIED, readBuildFilter } from './searchSchema'
import type { FacetSearch } from './searchSchema'
import { stripExtension, tokenise, tokeniseQuery } from './text'
import { DERIVED_TAG_NAMESPACES, FIELD_WEIGHT } from './textIndex'

/** One item: a design's records, with everything searchable unioned over them. */
interface Grouped {
  /** Position in {@link Oracle.docs}, for the score memo. */
  readonly index: number
  /** The group's files, ascending by ordinal. Never empty. */
  readonly records: readonly CatalogRecord[]
  /** The lowest ordinal in the group — what A1 calls the aggregate's address. */
  readonly address: number
  /** Token → best field weight over every variant, as the real index would store it. */
  readonly weights: Map<string, number>
  /** Every texture namespace prefix the group's tags carry. */
  readonly texture: Set<string>
}

/** Everything the oracle precomputes once per catalog. */
export interface Oracle {
  /** The items, ascending {@link Grouped.address}. */
  readonly docs: readonly Grouped[]
  /** Every token anywhere in the corpus — the exact-versus-prefix decision. */
  readonly vocabulary: Set<string>
  /**
   * Query → per-document score memo.
   *
   * Not an optimisation of the semantics, only of the arithmetic: a disjunctive
   * pass asks about the same (document, query) pair once per facet value, which
   * over the real corpus is 103 × 3,822 recomputations of the same answer and
   * turns a two-second suite into a two-minute one.
   */
  readonly scores: Map<string, (number | null | undefined)[]>
}

/**
 * Group and tokenise a whole catalog, the slow and obvious way.
 *
 * The group key is `CatalogRecord.design` — A1's key, restated rather than
 * imported. Groups are ordered by their lowest ordinal, which is the order the
 * engine's document indices run in, so "ascending document" means the same thing
 * on both sides of every comparison.
 */
export function buildOracle(file: CatalogFile): Oracle {
  const groups = new Map<DesignId, CatalogRecord[]>()
  for (const record of [...file.records].sort((a, b) => a.ord - b.ord)) {
    const existing = groups.get(record.design)
    if (existing === undefined) groups.set(record.design, [record])
    else existing.push(record)
  }

  const ordered = [...groups.values()].sort((a, b) => (a[0]?.ord ?? 0) - (b[0]?.ord ?? 0))
  const vocabulary = new Set<string>()
  const docs: Grouped[] = []

  for (const records of ordered) {
    const weights = new Map<string, number>()
    const bump = (token: string, weight: number): void => {
      weights.set(token, Math.max(weights.get(token) ?? 0, weight))
      vocabulary.add(token)
    }

    const texture = new Set<string>()
    for (const record of records) {
      for (const id of record.tags) {
        const tag = file.tags[id] ?? ''
        // The derived-namespace skip is **imported**, not restated, and that is
        // the one exception this file makes to writing the semantics twice. It
        // belongs with `tokenise` and `FIELD_WEIGHT` on the shared side of the
        // line: it says what counts as a search *term*, which is tokenisation,
        // rather than what a facet *means*, which is what the nested loop below
        // exists to state independently. Restated it would be a denylist in two
        // places, and the oracle would go on agreeing with the engine right up
        // until somebody added a third derived namespace to one of them.
        if (DERIVED_TAG_NAMESPACES.some((namespace) => tag.startsWith(namespace))) continue
        for (const token of tokenise(tag)) bump(token, FIELD_WEIGHT.tag)
        if (!tag.startsWith('texture|')) continue
        const segments = tag.split('|').slice(1)
        for (let depth = 1; depth <= segments.length; depth++) texture.add(segments.slice(0, depth).join('|'))
      }
      for (const token of tokenise(stripExtension(record.file))) bump(token, FIELD_WEIGHT.file)
      // Every variant's name, not the first one's. A1 measures that a group holds
      // exactly one display name, and unioning them here is what would make that
      // measurement's failure visible instead of invisible.
      for (const token of tokenise(record.name)) bump(token, FIELD_WEIGHT.name)
    }

    docs.push({ index: docs.length, records, address: records[0]?.ord ?? 0, weights, texture })
  }

  return { docs, vocabulary, scores: new Map() }
}

/* ----------------------------------------------------------------- predicates */

/**
 * Whether one facet's selection admits this item. Empty selection admits all.
 *
 * "Admits" is **any variant matches**, for every facet. See the module docblock
 * for why that is stated here even where the engine reads a hoisted field.
 */
export function matchesFacet(doc: Grouped, key: FacetKey, selected: readonly string[], build: string): boolean {
  switch (key) {
    case 'kinds': {
      if (selected.length === 0) return true
      return doc.records.some((record) =>
        record.kinds.length === 0
          ? selected.includes(KIND_OTHER)
          : record.kinds.some((kind) => selected.includes(kind)),
      )
    }
    case 'tex': {
      if (selected.length === 0) return true
      return selected.some((value) => doc.texture.has(value))
    }
    case 'conn': {
      if (selected.length === 0) return true
      return doc.records.some((record) => record.conn.some((system) => selected.includes(system)))
    }
    case 'build': {
      const filter = readBuildFilter(build)
      if (filter.kind === 'any') return true
      if (filter.kind === 'unspecified') return doc.records.some((record) => record.build === undefined)
      return doc.records.some((record) => record.build === filter.value)
    }
  }
}

/**
 * The text query's score, or `null` when the item does not match.
 *
 * The rule restated independently: every query token must match, a token the
 * corpus knows matches exactly, and a token it does not know matches any token
 * it prefixes. A token's contribution is the *best* field weight among the
 * item's tokens it matched — best across the whole group, so a name match on one
 * variant is a name match for the item — and the score is the sum over query
 * tokens.
 */
export function scoreText(oracle: Oracle, doc: Grouped, query: string): number | null {
  let memo = oracle.scores.get(query)
  if (memo === undefined) {
    // Holes, not a fill: `undefined` means "not computed", and `null` is a real
    // answer meaning "no match". A NaN sentinel would never compare equal to
    // itself and the memo would silently never hit.
    memo = new Array<number | null | undefined>(oracle.docs.length)
    oracle.scores.set(query, memo)
  }
  const cached = memo[doc.index]
  if (cached !== undefined) return cached

  const score = computeScore(oracle, doc, query)
  memo[doc.index] = score
  return score
}

function computeScore(oracle: Oracle, doc: Grouped, query: string): number | null {
  const tokens = tokeniseQuery(query)
  if (tokens.length === 0) return query === '' ? 0 : null

  let score = 0
  for (const token of tokens) {
    const exact = oracle.vocabulary.has(token)
    let best = 0
    for (const [candidate, weight] of doc.weights) {
      const hit = exact ? candidate === token : candidate.startsWith(token)
      if (hit && weight > best) best = weight
    }
    if (best === 0) return null
    score += best
  }
  return score
}

/* -------------------------------------------------------------------- queries */

const OTHER_FACETS: Record<FacetKey, readonly FacetKey[]> = {
  kinds: ['tex', 'build', 'conn'],
  tex: ['kinds', 'build', 'conn'],
  build: ['kinds', 'tex', 'conn'],
  conn: ['kinds', 'tex', 'build'],
}

function selectionFor(key: FacetKey, search: FacetSearch): readonly string[] {
  return key === 'build' ? [] : search[key]
}

function admits(oracle: Oracle, doc: Grouped, search: FacetSearch, keys: readonly FacetKey[]): boolean {
  if (scoreText(oracle, doc, search.q) === null) return false
  return keys.every((key) => matchesFacet(doc, key, selectionFor(key, search), search.build))
}

/** Matching items, ordered by score descending then address ascending. */
function oracleHits(oracle: Oracle, search: FacetSearch): Grouped[] {
  const all: FacetKey[] = ['kinds', 'tex', 'build', 'conn']
  const hits: { doc: Grouped; score: number }[] = []

  for (const doc of oracle.docs) {
    if (!admits(oracle, doc, search, all)) continue
    hits.push({ doc, score: scoreText(oracle, doc, search.q) ?? 0 })
  }

  hits.sort((a, b) => b.score - a.score || a.doc.address - b.doc.address)
  return hits.map((hit) => hit.doc)
}

/** Matching items by aggregate address, in display order. */
export function oracleAddresses(oracle: Oracle, search: FacetSearch): number[] {
  return oracleHits(oracle, search).map((doc) => doc.address)
}

/**
 * Matching items by **preview tile id**, in display order — what
 * `SearchResult.ids` holds.
 *
 * A1's rule re-derived rather than imported, in row V5's three ordered tiers: a
 * sprite-carrying **topper** first, then any sprite-carrying record, then the
 * lowest ordinal. `doc.records` is in ascending ordinal, so "first" means the
 * same thing here as it does in `pickPreview`.
 *
 * This restatement earned its keep. Before V5 the rule was *"the first record
 * carrying a sprite, else the first"* and this docblock argued that **a rule
 * with one witness is one a refactor can drop without any other test
 * noticing** — and then V5 changed the rule, and these two suites were the only
 * ones in 154 files that failed. The witness count is now 3,068 aggregates whose
 * preview must be a topper rather than one aggregate whose preview must have a
 * sprite, so the restatement is stronger than it was, not weaker.
 */
export function oracleIds(oracle: Oracle, search: FacetSearch): TileId[] {
  return oracleHits(oracle, search).map((doc) => {
    const preview =
      doc.records.find((record) => record.layer === 'topper' && record.sprite) ??
      doc.records.find((record) => record.sprite) ??
      doc.records[0]
    return preview?.id ?? ('' as TileId)
  })
}

/**
 * The **disjunctive** count for one facet value: every filter applied except
 * this facet's own, then the value required. Counted in items.
 */
export function oracleCount(oracle: Oracle, search: FacetSearch, key: FacetKey, value: string): number {
  const others = OTHER_FACETS[key]
  let count = 0

  for (const doc of oracle.docs) {
    if (!admits(oracle, doc, search, others)) continue
    const build = key === 'build' ? encodeBuildValue(value) : search.build
    if (!matchesFacet(doc, key, key === 'build' ? [] : [value], build)) continue
    count++
  }

  return count
}

/** A facet value read back as a `build` param — the inverse of `readBuildFilter`. */
function encodeBuildValue(value: string): string {
  return value === BUILD_UNSPECIFIED ? BUILD_UNSPECIFIED : value.startsWith('!') ? `!${value}` : value
}
