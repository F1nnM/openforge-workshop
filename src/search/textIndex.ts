/**
 * The text layer: a token → postings inverted index with field weighting.
 *
 * ## Why this is hand-rolled rather than MiniSearch
 *
 * architecture-plan.md §6 sketched "MiniSearch with prefix and fuzzy matching".
 * MiniSearch is a good library and it is not needed here, for three reasons that
 * are specific to this corpus rather than general:
 *
 *   1. **The facet layer already owns a bitset.** Disjunctive counts need the
 *      text result as a `Uint32Array` mask to AND against 103 facet bitsets. A
 *      library returning scored objects would be converted to a bitset on every
 *      keystroke, so the bitset is the native currency either way.
 *   2. **Fuzzy matching is a liability on this vocabulary, not a feature.** The
 *      tokens are `openlock`, `dragonlock`, `s2w`, `2x2`, `4x4`, `2r90`. Edit
 *      distance 1 makes `2x2` and `2x1` the same query, and `4x4` and `4x6`
 *      near-neighbours. Every one of those pairs is a *different tile size*, and
 *      a size search that silently returns the wrong size is worse than one that
 *      returns nothing.
 *   3. **Prefix matching is nine lines** over a sorted token array, and the
 *      corpus has 449 distinct tokens.
 *
 * It also keeps a search dependency out of the bundle entirely.
 *
 * ## A document is an aggregate: the union of its variants' tokens
 *
 * Row A2 indexes row A1's 3,822 items rather than 8,702 files, and a document's
 * tokens are the **union over its variants** — every file's name, every file's
 * filename, every file's tags. That is the only reading that keeps the merge
 * honest: an item whose dragonlock variant is `…dragonlock.stl` and whose
 * openlock variant is `…openlock+topless.stl` must be findable by typing either
 * word, because both are ways of printing the one thing the card offers.
 *
 * Measured over the live corpus, the union is **lossless and much cheaper**:
 *
 *   - **449 distinct tokens, before and after.** Not one token in the corpus is
 *     reachable at file level and unreachable at item level, which is the
 *     property that makes this a re-indexing rather than a narrowing.
 *   - **157,573 postings become 70,930** — a 55.0% drop, from 788 KB of CSR
 *     posting arrays to 355 KB.
 *
 * The saving is duplication, not information. `name` is one of A1's seven
 * hoisted fields, so an aggregate has exactly one display name and it is
 * tokenised **once per item instead of once per file**: 3,822 tokenisations
 * against 8,702, because 1,677 display names were shared by 6,749 files. What
 * survives the collapse is the genuine ambiguity — **131 names shared by 323
 * aggregates**, worst case 6 — and those stay separate documents with separate
 * addresses. Aggregation is not deduplication by name, and row A5's variants
 * table is what covers the remainder.
 *
 * ## Field weighting, and the query it exists for
 *
 * Three fields, weighted `name` 4 > `file` 2 > `tag` 1. The query that forces
 * this is the single most likely one a user types: **`wall`**. `wall` appears in
 * `build|separate wall` and `build|wall on tile`, which sit on 4,214 tiles
 * including floors — so an unweighted scorer ranks floors and walls
 * interchangeably and the first screen of a search for walls is floors. Taking
 * the *maximum* field weight per token (not the sum) is what makes the ordering
 * mean "matched in the name" rather than "mentioned a lot".
 *
 * The maximum is taken across the whole union, so a token that is a *name* token
 * on one variant and only a filename token on another scores as a name match for
 * the item. Anything else would let the weakest way of printing a thing decide
 * how findable the thing is.
 *
 * ## Prefix expansion only when the token is unknown
 *
 * A query token that exists in the index is matched exactly; only an unknown
 * token expands as a prefix. This is not a shortcut — it is what preserves the
 * word-boundary guarantee while still typing ahead. `cave` is a real token, so
 * it stays exact and does **not** reach the 29 `cavern` items; `cav` is not, so
 * it expands and reaches both. Expanding unconditionally would reintroduce a
 * milder version of the substring trap §6 warns about, on the same word.
 *
 * ## Sizes reach the index through the display name
 *
 * The literal `4x4` appears in **zero tags**. The importer synthesises it into
 * `CatalogRecord.name` (`pipeline/footprint.ts#sizeToken`), which is why `name`
 * is indexed and why nothing here re-derives a size: for the 726 tiles whose
 * footprint is `none`, and the 121 whose `diag` run is a measurement the corpus
 * never writes down, the name carries the *tagged* size instead, and that
 * fallback is the importer's to own.
 *
 * **Row D4 left A2 the question of a size token from the `size|openlock` code,
 * and the answer is no.** `SIZE_CODE_WIDTH_UNITS` omits `QxG` because the tag
 * says `size|width|4` and W1 measured 3.000, and D4 called adding it "A2's
 * search surface". Measured before deciding: all **28 `QxG` records already
 * carry `3x` as a name token**, from the `wall:3` footprint `sizeToken` resolves
 * — and `qxg` itself besides, because `naming.ts` appends the code whenever the
 * footprint gives fewer than two dimensions. A synthetic `3x` would be a no-op
 * on every one of them. The same holds for the four codes with a published
 * width: `A`, `IA`, `D` and `Q` are at 100% coverage of a `2x…`/`1x…`/`3x…`/`4x…`
 * name token already (1,095, 363, 364 and 481 records). The single gap is `BA`
 * at 1.5 units, 0 of 519 — and a `1.5x` token could not be *queried* if it
 * existed, because `text.ts` splits on the `.` and `1.5` tokenises to `1` and
 * `5`. So the code contributes no token here, and what would be gained by
 * pretending otherwise is one no-op and one unreachable string.
 *
 * What the corpus does leave is a real defect this row is not the owner of: the
 * `size|width|4` tag puts the token `4` on those 28 records, so a query for `4`
 * reaches tiles that measure 3.000. Suppressing a tag's own token here would be
 * the search layer overruling the tag table on a fact the tag table is wrong
 * about; the fix belongs where the tag is normalised. Reported to W7.
 */
import { collectBits, createBitset, setBit } from './bitset'
import type { SearchDoc } from './documents'
import { stripExtension, tokenise, tokeniseQuery } from './text'

/** Per-field score contribution. See the module docblock for why `name` wins. */
export const FIELD_WEIGHT = { name: 4, file: 2, tag: 1 } as const

/** Frozen postings, in compressed-sparse-row layout. */
export interface TextIndex {
  /** Documents indexed — 3,822 aggregates for the live corpus. */
  readonly size: number
  /** Token id → token. */
  readonly tokenText: readonly string[]
  /** Token → token id, for the exact-match path. */
  readonly tokenIds: ReadonlyMap<string, number>
  /** Token ids ordered by token, for prefix expansion by binary search. */
  readonly sorted: Int32Array
  /** CSR offsets: token `t`'s postings are `[start[t], start[t + 1])`. */
  readonly start: Int32Array
  /** Document of each posting, **ascending within a token**. */
  readonly postingDoc: Int32Array
  /** Best field weight of that (token, document) pair. */
  readonly postingWeight: Uint8Array
}

/**
 * One query's text matches.
 *
 * `score` is indexed by document and is **owned by the searcher**: it is scratch
 * that the next call overwrites. Callers read it before searching again, which
 * the engine does synchronously. Returning a copy would allocate 15 KB per
 * keystroke to defend against a caller that does not exist.
 */
export interface TextMatch {
  /** Matching documents, ascending. */
  readonly docs: readonly number[]
  /** Score per document, valid only for members of {@link docs}. */
  readonly score: Int32Array
  /** The same set as a mask, for the facet pass. */
  readonly bits: Uint32Array
}

/* ------------------------------------------------------------------- building */

/**
 * Build the inverted index over `docs` (aggregates, in document order).
 *
 * Four passes, arranged so that the only string work happens once and everything
 * after it is integer work on typed arrays. That arrangement is the difference
 * between a 25 ms build and an 85 ms one, measured: the naive version appended
 * every (document, token, weight) triple to growable `number[]`s, which is
 * roughly 900,000 `push` calls, and `push` dominated the whole build.
 *
 *   1. Tokenise the 930-entry **tag intern table**, once. The corpus holds
 *      101,427 tag references, so tokenising per reference would be 109× the
 *      work for the same tokens. 15 of those entries are the derived `role|` and
 *      `form|` axes and are skipped outright — see {@link DERIVED_TAG_NAMESPACES}.
 *   2. Tokenise each item's `name` **once** and each of its variants' `file`,
 *      interning as it goes. After this the token vocabulary is closed, which is
 *      what lets pass 4 use flat scratch indexed by token id instead of a `Map`.
 *   3. Sum the exact number of (document, token) visits, so the pair buffers are
 *      allocated once at their upper bound rather than grown.
 *   4. Deduplicate per document keeping the **maximum** field weight, then
 *      counting-sort into CSR. Documents are visited in ascending order, so each
 *      token's postings come out ascending by document — which is what lets the
 *      query path merge without sorting.
 *
 * Passes 2 and 4 are where the union over variants happens: both walk every
 * record of a document while `doc` stays fixed, so the per-document dedup that
 * already collapsed a repeated tag now also collapses a token two variants
 * share.
 */
/**
 * Tag namespaces the pipeline **derives** rather than reads off a scan, and
 * which therefore contribute no free-text tokens. See the comment at their use
 * for the three measured regressions that motivates.
 */
export const DERIVED_TAG_NAMESPACES: readonly string[] = ['role|', 'form|']

export function buildTextIndex(docs: readonly SearchDoc[], tagTable: readonly string[]): TextIndex {
  const size = docs.length
  const tokenIds = new Map<string, number>()
  const tokenText: string[] = []

  const intern = (token: string): number => {
    const existing = tokenIds.get(token)
    if (existing !== undefined) return existing
    const id = tokenText.length
    tokenText.push(token)
    tokenIds.set(token, id)
    return id
  }

  // The tag vocabulary in CSR too, rather than 930 separate `Int32Array`s. The
  // pass-4 loop reads it 101,427 times, and a `for…of` over a typed array
  // allocates an iterator per visit; a flat buffer with offsets is read with a
  // plain index and measurably halves the build.
  //
  // **The two derived namespaces contribute no tokens, and that is a decision
  // this row had to make rather than inherit.** Row B1 emits `role|<x>` and
  // `form|<x>` as ordinary interned tags so that a template slot can predicate
  // on them with the grammar `src/composition/` already has. They are a derived
  // predicate over the corpus, not words anybody wrote about a tile, and
  // tokenising them breaks free text in three measured ways:
  //
  //   - **`role` and `form` would match every item** — all 3,822 of them, since
  //     every record carries one of each — and so would every prefix of either.
  //   - **`decor` goes from 133 hits to 15.** This is the module docblock's own
  //     prefix rule firing in the direction it did not anticipate: `expand`
  //     prefix-matches only tokens the corpus does *not* know, so `decor` today
  //     expands to `decoration`. Interning `role|decor` makes `decor` an exact
  //     token, expansion stops, and the 118 items reachable only through
  //     `decoration` become unreachable. `stair` loses 8 the same way (it stops
  //     expanding to `stairs`), and `straight` goes from 45 to 2,482.
  //   - The vocabulary would go **449 → 454**, which is the figure this file's
  //     docblock quotes twice as unchanged between file-level and item-level
  //     indexing.
  //
  // The skip is here rather than in the pipeline because the *index* must carry
  // them — that is what makes the axes build-time checkable and slot-predicable
  // — and it is this file that decides what is a search term.
  const tagToken: number[] = []
  const tagStart = new Int32Array(tagTable.length + 1)
  for (let id = 0; id < tagTable.length; id++) {
    tagStart[id] = tagToken.length
    const tag = tagTable[id] ?? ''
    if (DERIVED_TAG_NAMESPACES.some((namespace) => tag.startsWith(namespace))) continue
    for (const token of new Set(tokenise(tag).map(intern))) tagToken.push(token)
  }
  tagStart[tagTable.length] = tagToken.length

  // Pass 2: the two string fields, flattened. `docStart[doc]` … `docStart[doc+1]`
  // indexes both arrays. ~95,000 entries, versus the ~305,000 the tag fields
  // contribute — which is why only these are collected and the tag references
  // are re-walked in pass 4 rather than materialised here.
  //
  // One name per document and one filename per *variant*: the name is hoisted
  // (A1 measures 0 aggregates holding two) so tokenising it per variant would be
  // the same tokens 8,702 times instead of 3,822, while the filenames genuinely
  // differ — that is where the lock system and the print option are written.
  const fieldToken: number[] = []
  const fieldWeight: number[] = []
  const docStart = new Int32Array(size + 1)

  for (let doc = 0; doc < size; doc++) {
    docStart[doc] = fieldToken.length
    const entry = docs[doc]
    if (entry === undefined) continue
    for (const record of entry.records) {
      for (const token of tokenise(stripExtension(record.file))) {
        fieldToken.push(intern(token))
        fieldWeight.push(FIELD_WEIGHT.file)
      }
    }
    for (const token of tokenise(entry.aggregate.name)) {
      fieldToken.push(intern(token))
      fieldWeight.push(FIELD_WEIGHT.name)
    }
  }
  docStart[size] = fieldToken.length

  let capacity = fieldToken.length
  for (const entry of docs) {
    for (const record of entry.records) {
      for (const tag of record.tags) capacity += (tagStart[tag + 1] ?? 0) - (tagStart[tag] ?? 0)
    }
  }

  const tokenCount = tokenText.length
  const mark = new Int32Array(tokenCount).fill(-1)
  const best = new Uint8Array(tokenCount)
  const touched: number[] = []

  const pairDoc = new Int32Array(capacity)
  const pairToken = new Int32Array(capacity)
  const pairWeight = new Uint8Array(capacity)
  const perToken = new Int32Array(tokenCount)
  let pairs = 0

  for (let doc = 0; doc < size; doc++) {
    const entry = docs[doc]
    if (entry === undefined) continue

    // Every variant's tags, under one document. All three field weights are
    // fixed constants and `tag` is the lowest, so the order of the two loops
    // below cannot change a weight: a token already marked keeps whatever it has
    // and the field pass only ever raises it.
    for (const record of entry.records) {
      const tags = record.tags
      for (let t = 0; t < tags.length; t++) {
        const tag = tags[t] ?? 0
        const tagTo = tagStart[tag + 1] ?? 0
        for (let i = tagStart[tag] ?? 0; i < tagTo; i++) {
          const token = tagToken[i] ?? 0
          if (mark[token] === doc) continue
          mark[token] = doc
          best[token] = FIELD_WEIGHT.tag
          touched.push(token)
        }
      }
    }

    const from = docStart[doc] ?? 0
    const to = docStart[doc + 1] ?? 0
    for (let i = from; i < to; i++) {
      const token = fieldToken[i] ?? 0
      const weight = fieldWeight[i] ?? 0
      if (mark[token] !== doc) {
        mark[token] = doc
        best[token] = weight
        touched.push(token)
      } else if (weight > (best[token] ?? 0)) {
        best[token] = weight
      }
    }

    for (let i = 0; i < touched.length; i++) {
      const token = touched[i] ?? 0
      pairDoc[pairs] = doc
      pairToken[pairs] = token
      pairWeight[pairs] = best[token] ?? 0
      pairs++
      perToken[token] = (perToken[token] ?? 0) + 1
    }
    touched.length = 0
  }

  const start = new Int32Array(tokenCount + 1)
  let running = 0
  for (let token = 0; token < tokenCount; token++) {
    start[token] = running
    running += perToken[token] ?? 0
  }
  start[tokenCount] = running

  const cursor = start.slice(0, tokenCount)
  const postingDoc = new Int32Array(pairs)
  const postingWeight = new Uint8Array(pairs)
  for (let i = 0; i < pairs; i++) {
    const token = pairToken[i] ?? 0
    const at = cursor[token] ?? 0
    postingDoc[at] = pairDoc[i] ?? 0
    postingWeight[at] = pairWeight[i] ?? 0
    cursor[token] = at + 1
  }

  const sorted = Int32Array.from(tokenText.keys()).sort((a, b) => {
    const left = tokenText[a] ?? ''
    const right = tokenText[b] ?? ''
    return left < right ? -1 : left > right ? 1 : 0
  })

  return { size, tokenText, tokenIds, sorted, start, postingDoc, postingWeight }
}

/* ---------------------------------------------------------------- the searcher */

/**
 * Runs queries against a {@link TextIndex}, reusing its scratch between calls.
 *
 * Query semantics: **all tokens must match** (AND). That is the only reading
 * under which multi-word queries mean anything on this corpus — "cave wall"
 * should be the intersection, and OR would return every wall in the catalog with
 * the cave ones merely ranked higher, which reads as a broken filter.
 */
export class TextSearcher {
  private readonly index: TextIndex
  /** How many query tokens each document has matched so far. */
  private readonly matchCount: Int32Array
  private readonly matchScore: Int32Array
  /** Documents whose {@link matchCount}/{@link matchScore} need clearing. */
  private dirty: number[] = []
  /** Per-query-token best weight, stamped rather than cleared. */
  private readonly tokenBest: Uint8Array
  private readonly tokenMark: Int32Array
  private stamp = 0

  constructor(index: TextIndex) {
    this.index = index
    this.matchCount = new Int32Array(index.size)
    this.matchScore = new Int32Array(index.size)
    this.tokenBest = new Uint8Array(index.size)
    this.tokenMark = new Int32Array(index.size).fill(-1)
  }

  /**
   * Match `query`.
   *
   * Three outcomes, and the middle one is the one worth naming:
   *
   *   - `''` → `null`, meaning **no text filter**: show the whole catalog.
   *   - a query that yields no tokens at all (`'###'`, `'|||'`) → an empty
   *     match. Tokenising it away and treating it as `''` would answer "###"
   *     with all 8,702 tiles, which reads as a broken search box; "no results"
   *     is what the user asked about and expects.
   *   - otherwise the intersection of its tokens.
   */
  match(query: string): TextMatch | null {
    const tokens = tokeniseQuery(query)
    if (tokens.length === 0) {
      return query === '' ? null : { docs: [], score: this.matchScore, bits: createBitset(this.index.size) }
    }

    for (const doc of this.dirty) {
      this.matchCount[doc] = 0
      this.matchScore[doc] = 0
    }
    this.dirty = []

    const bits = createBitset(this.index.size)
    const docs: number[] = []

    for (let round = 0; round < tokens.length; round++) {
      const token = tokens[round]
      if (token === undefined) continue
      const expansion = this.expand(token)
      // AND semantics: a token nothing in the corpus contains ends the query.
      // Returning early matters for more than speed — it is what makes a garbage
      // query an empty result rather than a partial one.
      if (expansion.length === 0) return { docs, score: this.matchScore, bits }
      this.accumulate(expansion, round)
    }

    for (const doc of this.dirty) {
      if (this.matchCount[doc] === tokens.length) setBit(bits, doc)
    }
    collectBits(bits, docs)
    return { docs, score: this.matchScore, bits }
  }

  /**
   * Fold one query token's postings in.
   *
   * Two stages, because prefix expansion can reach the same document through
   * several index tokens and the *token's* contribution is the best of them, not
   * their sum: `sto` expanding to `stone` and `stone_brick`… would otherwise
   * score a tile twice for typing one word. The stamp array avoids clearing
   * `tokenBest` between rounds.
   */
  private accumulate(expansion: readonly number[], round: number): void {
    const { start, postingDoc, postingWeight } = this.index
    if (this.stamp > 0x3f_ff_ff_ff) {
      this.tokenMark.fill(-1)
      this.stamp = 0
    }
    const stamp = ++this.stamp
    const seen: number[] = []

    for (const token of expansion) {
      const from = start[token] ?? 0
      const to = start[token + 1] ?? 0
      for (let p = from; p < to; p++) {
        const doc = postingDoc[p] ?? 0
        const weight = postingWeight[p] ?? 0
        if (this.tokenMark[doc] !== stamp) {
          this.tokenMark[doc] = stamp
          this.tokenBest[doc] = weight
          seen.push(doc)
        } else if (weight > (this.tokenBest[doc] ?? 0)) {
          this.tokenBest[doc] = weight
        }
      }
    }

    for (const doc of seen) {
      // Only documents that matched every previous token advance, which is what
      // makes the query an intersection. Documents first seen after round 0 are
      // never written to, so `dirty` stays exactly the set needing a reset.
      if (this.matchCount[doc] !== round) continue
      this.matchCount[doc] = round + 1
      this.matchScore[doc] = (this.matchScore[doc] ?? 0) + (this.tokenBest[doc] ?? 0)
      if (round === 0) this.dirty.push(doc)
    }
  }

  /**
   * Token ids one query token matches: exact if the corpus knows it, else every
   * token it prefixes. See the module docblock for why that is not unconditional.
   */
  private expand(token: string): readonly number[] {
    const exact = this.index.tokenIds.get(token)
    if (exact !== undefined) return [exact]

    const { sorted, tokenText } = this.index
    const out: number[] = []
    for (let i = lowerBound(sorted, tokenText, token); i < sorted.length; i++) {
      const id = sorted[i] ?? 0
      if (!(tokenText[id] ?? '').startsWith(token)) break
      out.push(id)
    }
    return out
  }
}

/** First position in `sorted` whose token is not less than `token`. */
function lowerBound(sorted: Int32Array, tokenText: readonly string[], token: string): number {
  let low = 0
  let high = sorted.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if ((tokenText[sorted[mid] ?? 0] ?? '') < token) low = mid + 1
    else high = mid
  }
  return low
}
