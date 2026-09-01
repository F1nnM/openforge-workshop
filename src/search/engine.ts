/**
 * The search engine: a `CatalogSearch` in, matching ids and live facet counts out.
 *
 * ## The interface is the deliverable
 *
 * `search(FacetSearch) → SearchResult` and nothing else. The URL state goes in
 * verbatim — the same value the router validated, the same value a share link
 * carries — and what comes back is ids plus facet buckets. No callers learn that
 * there is a bitset behind it, which is what lets the whole implementation be
 * replaced (by MiniSearch, by a WASM index, by a server) without touching the
 * catalog screen or the builder palette, the two consumers PR 6 identified.
 *
 * `FacetSearch` rather than `CatalogSearch`: `tile` names which drawer is open,
 * which is not a filter. A `CatalogSearch` satisfies the parameter structurally,
 * so the catalog screen passes its search object straight through.
 *
 * ## Documents are numbered by manifest ordinal
 *
 * Internally a tile is a document index, and documents are ordered by
 * `CatalogRecord.ord` ascending rather than by position in `catalog.json`. Two
 * things fall out of that, both of which the tests depend on:
 *
 *   - **The unfiltered result needs no sort.** Ascending bitset iteration *is*
 *     the display order, so an empty query walks 272 words and emits 8,702 ids.
 *   - **Ordering is deterministic across imports.** Ordinals are append-only by
 *     construction (`src/catalog/schema.ts#ManifestOrdinal`), so a share link and
 *     a test assertion both see the same order after a re-import that added
 *     tiles in the middle of the alphabet.
 *
 * ## Ranking
 *
 * With a query: score descending, then document ascending. The score comes from
 * `textIndex.ts` and weights a name match above a tag match — without that,
 * `wall` returns floors first, because `build|separate wall` sits on 3,351 tiles
 * regardless of shape.
 *
 * The sort is a **counting sort** over the score, not `Array.prototype.sort`.
 * Scores are small integers (four per query token), so it is O(n) rather than
 * O(n log n), and — the part that matters more — it is stable by construction:
 * documents are placed in ascending order within each score bucket, so identical
 * input yields a byte-identical result order. A comparison sort would need an
 * explicit tiebreak to promise the same thing, and V8's sort stability is a
 * property of the engine rather than of this code.
 */
import type { CatalogFile, CatalogRecord, TileId } from '@/catalog'

import { andInto, collectBits, fullBitset, getBit } from './bitset'
import type { FacetCounts, FacetIndex, FacetKey, FacetVocabulary } from './facets'
import { FACET_KEYS, buildFacetIndex, countFacets, facetFilter } from './facets'
import type { FacetSearch } from './searchSchema'
import type { TextIndex } from './textIndex'
import { TextSearcher, buildTextIndex } from './textIndex'

/** What one query returns. */
export interface SearchResult {
  /**
   * Matching tiles, in display order. The whole set, uncapped: 8,702 ids is
   * 70 KB of pointers and the grid is virtualised, so paging here would only
   * move the problem into the caller.
   */
  readonly ids: readonly TileId[]
  /** `ids.length`, named so a caller can show a count without holding the array. */
  readonly total: number
  /** Live counts for all four facets, each computed with its own filter excluded. */
  readonly facets: FacetCounts
}

/** The narrow surface the catalog screen and the builder palette consume. */
export interface SearchEngine {
  /** Documents indexed — 8,702 for the live corpus. */
  readonly size: number
  /** Every value each facet offers, in a query-independent display order. */
  readonly vocabulary: FacetVocabulary
  /** Run one query. Never throws: a garbage query is an empty result. */
  search(search: FacetSearch): SearchResult
  /** The record behind an id, for rendering a result row. */
  record(id: TileId): CatalogRecord | undefined
}

/**
 * Build an engine over an emitted, already-validated `catalog.json`.
 *
 * Takes the parsed {@link CatalogFile} rather than a URL or a string: fetching
 * and validating the payload is the loader's job (PR 13), and keeping I/O out of
 * here is what makes the whole engine testable in a node environment.
 */
export function createSearchEngine(file: CatalogFile): SearchEngine {
  return new BitsetSearchEngine(file)
}

class BitsetSearchEngine implements SearchEngine {
  readonly size: number
  readonly vocabulary: FacetVocabulary

  /** Tile ids in document order — see the module docblock. */
  private readonly ids: readonly TileId[]
  private readonly byId: ReadonlyMap<string, CatalogRecord>
  private readonly facets: FacetIndex
  private readonly text: TextSearcher
  /** All-ones mask, so an unfiltered query allocates nothing to start from. */
  private readonly unfiltered: Uint32Array
  private readonly scratch: Uint32Array

  constructor(file: CatalogFile) {
    const records = [...file.records].sort((a, b) => a.ord - b.ord)
    this.size = records.length
    this.ids = records.map((record) => record.id)
    this.byId = new Map(records.map((record) => [record.id as string, record]))
    this.facets = buildFacetIndex(records, file.tags)
    this.vocabulary = this.facets.vocabulary
    const index: TextIndex = buildTextIndex(records, file.tags)
    this.text = new TextSearcher(index)
    this.unfiltered = fullBitset(this.size)
    this.scratch = fullBitset(this.size)
  }

  record(id: TileId): CatalogRecord | undefined {
    return this.byId.get(id)
  }

  search(search: FacetSearch): SearchResult {
    const text = this.text.match(search.q)
    const filters = {} as Record<FacetKey, Uint32Array | null>
    for (const key of FACET_KEYS) filters[key] = facetFilter(this.facets, key, search)

    const facets = countFacets(this.facets, search, filters, text?.bits ?? null)
    const ids = this.rank(text, filters)
    return { ids, total: ids.length, facets }
  }

  /** Matching documents in display order, mapped to ids. */
  private rank(
    text: { readonly docs: readonly number[]; readonly score: Int32Array } | null,
    filters: Record<FacetKey, Uint32Array | null>,
  ): readonly TileId[] {
    const mask = this.scratch
    mask.set(this.unfiltered)
    for (const key of FACET_KEYS) {
      const bits = filters[key]
      if (bits !== null) andInto(mask, bits)
    }

    if (text === null) {
      // No query: ascending document order already is the display order.
      const docs = collectBits(mask, [])
      return docs.map((doc) => this.ids[doc] ?? UNKNOWN_ID)
    }

    const kept: number[] = []
    for (const doc of text.docs) {
      if (getBit(mask, doc)) kept.push(doc)
    }
    return byScoreThenDocument(kept, text.score).map((doc) => this.ids[doc] ?? UNKNOWN_ID)
  }
}

/** Unreachable: `ids` is built from the same records the bitsets are. */
const UNKNOWN_ID = '' as TileId

/**
 * Counting sort by score descending, document ascending within a score.
 *
 * `docs` must already be ascending, which {@link collectBits} guarantees. The
 * placement pass then walks it in order, so equal scores keep that order and the
 * whole ordering is a pure function of the input.
 */
function byScoreThenDocument(docs: readonly number[], score: Int32Array): number[] {
  if (docs.length < 2) return [...docs]

  let max = 0
  for (const doc of docs) {
    const value = score[doc] ?? 0
    if (value > max) max = value
  }

  const counts = new Int32Array(max + 2)
  for (const doc of docs) counts[(score[doc] ?? 0) + 1] = (counts[(score[doc] ?? 0) + 1] ?? 0) + 1

  // Offsets accumulate from the top score down, so bucket `max` starts at 0.
  const offset = new Int32Array(max + 2)
  let running = 0
  for (let value = max; value >= 0; value--) {
    offset[value] = running
    running += counts[value + 1] ?? 0
  }

  const out = new Array<number>(docs.length)
  for (const doc of docs) {
    const value = score[doc] ?? 0
    const at = offset[value] ?? 0
    out[at] = doc
    offset[value] = at + 1
  }
  return out
}
