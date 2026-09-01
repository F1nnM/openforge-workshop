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
 * real 8,702-tile corpus when the fixtures are present), and because it is the
 * most readable statement of what the facets *mean*.
 *
 * Deliberately slow and deliberately literal: `O(records × values)` with string
 * comparisons throughout.
 */
import type { CatalogFile, CatalogRecord, TileId } from '@/catalog'

import { KIND_OTHER } from './facets'
import type { FacetKey } from './facets'
import { BUILD_UNSPECIFIED, readBuildFilter } from './searchSchema'
import type { FacetSearch } from './searchSchema'
import { stripExtension, tokenise, tokeniseQuery } from './text'
import { FIELD_WEIGHT } from './textIndex'

/** A record's searchable tokens, per field, as strings. */
interface Tokenised {
  /** Position in {@link Oracle.docs}, for the score memo. */
  readonly index: number
  readonly record: CatalogRecord
  /** Token → best field weight, exactly as the real index would store it. */
  readonly weights: Map<string, number>
  /** Every texture namespace prefix the record's tags carry. */
  readonly texture: Set<string>
}

/** Everything the oracle precomputes once per catalog. */
export interface Oracle {
  readonly docs: readonly Tokenised[]
  /** Every token anywhere in the corpus — the exact-versus-prefix decision. */
  readonly vocabulary: Set<string>
  /**
   * Query → per-document score memo.
   *
   * Not an optimisation of the semantics, only of the arithmetic: a disjunctive
   * pass asks about the same (document, query) pair once per facet value, which
   * over the real corpus is 62 × 8,702 recomputations of the same answer and
   * turns a two-second suite into a two-minute one.
   */
  readonly scores: Map<string, (number | null | undefined)[]>
}

/** Tokenise a whole catalog, the slow and obvious way. */
export function buildOracle(file: CatalogFile): Oracle {
  const docs: Tokenised[] = []
  const vocabulary = new Set<string>()

  for (const record of [...file.records].sort((a, b) => a.ord - b.ord)) {
    const weights = new Map<string, number>()
    const bump = (token: string, weight: number): void => {
      weights.set(token, Math.max(weights.get(token) ?? 0, weight))
      vocabulary.add(token)
    }

    const texture = new Set<string>()
    for (const id of record.tags) {
      const tag = file.tags[id] ?? ''
      for (const token of tokenise(tag)) bump(token, FIELD_WEIGHT.tag)
      if (!tag.startsWith('texture|')) continue
      const segments = tag.split('|').slice(1)
      for (let depth = 1; depth <= segments.length; depth++) texture.add(segments.slice(0, depth).join('|'))
    }
    for (const token of tokenise(stripExtension(record.file))) bump(token, FIELD_WEIGHT.file)
    for (const token of tokenise(record.name)) bump(token, FIELD_WEIGHT.name)

    docs.push({ index: docs.length, record, weights, texture })
  }

  return { docs, vocabulary, scores: new Map() }
}

/* ----------------------------------------------------------------- predicates */

/** Whether one facet's selection admits this record. Empty selection admits all. */
export function matchesFacet(doc: Tokenised, key: FacetKey, selected: readonly string[], build: string): boolean {
  switch (key) {
    case 'kinds': {
      if (selected.length === 0) return true
      if (doc.record.kinds.length === 0) return selected.includes(KIND_OTHER)
      return doc.record.kinds.some((kind) => selected.includes(kind))
    }
    case 'tex': {
      if (selected.length === 0) return true
      return selected.some((value) => doc.texture.has(value))
    }
    case 'conn': {
      if (selected.length === 0) return true
      return doc.record.conn.some((system) => selected.includes(system))
    }
    case 'build': {
      const filter = readBuildFilter(build)
      if (filter.kind === 'any') return true
      if (filter.kind === 'unspecified') return doc.record.build === undefined
      return doc.record.build === filter.value
    }
  }
}

/**
 * The text query's score, or `null` when the record does not match.
 *
 * The rule restated independently: every query token must match, a token the
 * corpus knows matches exactly, and a token it does not know matches any token
 * it prefixes. A token's contribution is the *best* field weight among the
 * document tokens it matched, and the score is the sum over query tokens.
 */
export function scoreText(oracle: Oracle, doc: Tokenised, query: string): number | null {
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

function computeScore(oracle: Oracle, doc: Tokenised, query: string): number | null {
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

function admits(oracle: Oracle, doc: Tokenised, search: FacetSearch, keys: readonly FacetKey[]): boolean {
  if (scoreText(oracle, doc, search.q) === null) return false
  return keys.every((key) => matchesFacet(doc, key, selectionFor(key, search), search.build))
}

/** Matching ids, ordered by score descending then manifest ordinal ascending. */
export function oracleIds(oracle: Oracle, search: FacetSearch): TileId[] {
  const all: FacetKey[] = ['kinds', 'tex', 'build', 'conn']
  const hits: { id: TileId; score: number; ord: number }[] = []

  for (const doc of oracle.docs) {
    if (!admits(oracle, doc, search, all)) continue
    hits.push({
      id: doc.record.id,
      score: scoreText(oracle, doc, search.q) ?? 0,
      ord: doc.record.ord,
    })
  }

  hits.sort((a, b) => b.score - a.score || a.ord - b.ord)
  return hits.map((hit) => hit.id)
}

/**
 * The **disjunctive** count for one facet value: every filter applied except
 * this facet's own, then the value required.
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
