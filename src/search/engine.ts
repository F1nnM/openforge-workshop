/**
 * The search engine: a `CatalogSearch` in, matching items and live facet counts out.
 *
 * ## The interface is the deliverable
 *
 * `search(FacetSearch) → SearchResult` and nothing else. The URL state goes in
 * verbatim — the same value the router validated, the same value a share link
 * carries — and what comes back is items plus facet buckets. No callers learn
 * that there is a bitset behind it, which is what lets the whole implementation
 * be replaced (by MiniSearch, by a WASM index, by a server) without touching the
 * catalog screen or the builder palette, the two consumers PR 6 identified.
 *
 * `FacetSearch` rather than `CatalogSearch`: `tile` names which drawer is open,
 * which is not a filter. A `CatalogSearch` satisfies the parameter structurally,
 * so the catalog screen passes its search object straight through.
 *
 * ## A result is an aggregate — 3,822 items over 8,702 files
 *
 * Row A2's whole content. The engine derives row A1's aggregate layer, indexes
 * *that*, and returns {@link TileAggregate}s. The consequences the rest of this
 * directory documents in detail:
 *
 *   - `facets.ts` counts items, and an item matches a facet value when any of
 *     its variants does — which takes "carries two or more connection systems"
 *     from 28.6% of files to 42.0% of items.
 *   - `textIndex.ts` indexes the union of a group's tokens, losing none of the
 *     449 and dropping 55.0% of the postings.
 *   - `documents.ts` explains why the bitset position is the *dense* document
 *     index and never the aggregate address.
 *
 * ## Documents are numbered by ascending aggregate address
 *
 * Internally an item is a document index, and `AggregateIndex.aggregates` is
 * ordered by ascending {@link TileAggregate.address} — which is the group's
 * lowest `CatalogRecord.ord`. Two things fall out of that, both of which the
 * tests depend on:
 *
 *   - **The unfiltered result needs no sort.** Ascending bitset iteration *is*
 *     the display order, so an empty query walks 120 words and emits 3,822
 *     items.
 *   - **Ordering is deterministic across imports.** Ordinals are append-only by
 *     construction (`src/catalog/schema.ts#ManifestOrdinal`), so a share link and
 *     a test assertion both see the same order after a re-import that added
 *     tiles in the middle of the alphabet. An aggregate's *address* is not itself
 *     append-only — a group can split, which is why A1 brands it — but it is
 *     always one of its own members' ordinals, so the order it induces is as
 *     stable as the group.
 *
 * ## Ranking
 *
 * With a query: score descending, then document ascending. The score comes from
 * `textIndex.ts` and weights a name match above a tag match — without that,
 * `wall` returns floors first, because `build|separate wall` sits on 826 items
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
import type { AggregateIndex, CatalogFile, CatalogRecord, TileAggregate, TileId } from '@/catalog'
import { buildAggregateIndex } from '@/catalog'

import { andInto, collectBits, fullBitset, getBit } from './bitset'
import type { SearchDoc } from './documents'
import { buildSearchDocs } from './documents'
import type { FacetCounts, FacetIndex, FacetKey, FacetVocabulary } from './facets'
import { FACET_KEYS, buildFacetIndex, countFacets, facetFilter } from './facets'
import type { FacetSearch } from './searchSchema'
import type { TextIndex } from './textIndex'
import { TextSearcher, buildTextIndex } from './textIndex'

/** What one query returns. */
export interface SearchResult {
  /**
   * Matching items, in display order. The whole set, uncapped: 3,822 aggregates
   * is a few tens of KB of pointers and the grid is virtualised, so paging here
   * would only move the problem into the caller.
   */
  readonly items: readonly TileAggregate[]
  /**
   * One tile id per item, in the same order — {@link TileAggregate.preview},
   * the variant a card should show.
   *
   * The seam row A3 consumes. A grid renders a *file*: it needs a sprite sheet,
   * a byte count and a material, and `preview` is A1's answer to which variant
   * supplies them — since row V5, a sprite-carrying **topper** first, then any
   * sprite-carrying variant, then the head. Every id here resolves through
   * {@link SearchEngine.record}.
   *
   * That rule is *not* `selectVariant`'s, which prefers one part over two and so
   * names a different file on 1,598 of 3,822 aggregates. These ids are what to
   * *show*, never what to print or download.
   *
   * It is **not** an addressing scheme. A drawer link is row A4's, and A4 types
   * `?tile=` as a `ManifestOrdinal` resolved through `AggregateIndex.byOrdinal`
   * — a preview id is a rendering choice that may change with the corpus, and
   * nothing should persist it.
   */
  readonly ids: readonly TileId[]
  /** `items.length`, named so a caller can show a count without holding the array. */
  readonly total: number
  /** Live counts for all four facets, each computed with its own filter excluded. */
  readonly facets: FacetCounts
}

/** The narrow surface the catalog screen and the builder palette consume. */
export interface SearchEngine {
  /** Documents indexed — 3,822 items for the live corpus. */
  readonly size: number
  /** Files behind those items — 8,702 for the live corpus. */
  readonly files: number
  /**
   * The aggregate layer this engine indexes.
   *
   * Exposed rather than rebuilt by each consumer: `buildAggregateIndex` is a
   * pure function of the file and costs one pass over 8,702 records plus 101,427
   * tag references, and rows A3 to A7 all need the same lookups (`byDesign`,
   * `byOrdinal`, `byTile`, `stats`). One instance per session, reached through
   * whoever already holds the engine.
   */
  readonly aggregates: AggregateIndex
  /** Every value each facet offers, in a query-independent display order. */
  readonly vocabulary: FacetVocabulary
  /** Run one query. Never throws: a garbage query is an empty result. */
  search(search: FacetSearch): SearchResult
  /**
   * The record behind an id, for rendering a result row.
   *
   * Still every one of the 8,702 files, not only the 3,822 previews: a builder
   * placement, a library entry and a drawer all name a concrete file, and an
   * engine that could only resolve the ids it just returned would push a second
   * record map into every one of those callers.
   */
  record(id: TileId): CatalogRecord | undefined
}

/**
 * Build an engine over an emitted, already-validated `catalog.json`.
 *
 * Takes the parsed {@link CatalogFile} rather than a URL or a string: fetching
 * and validating the payload is the loader's job (PR 13), and keeping I/O out of
 * here is what makes the whole engine testable in a node environment.
 *
 * The aggregate layer is derived here rather than accepted as a parameter, so an
 * engine cannot be built over an index derived from a *different* file — which
 * would silently drop every item whose design the index had not heard of.
 */
export function createSearchEngine(file: CatalogFile): SearchEngine {
  return new BitsetSearchEngine(file)
}

class BitsetSearchEngine implements SearchEngine {
  readonly size: number
  readonly files: number
  readonly aggregates: AggregateIndex
  readonly vocabulary: FacetVocabulary

  /** The documents, ascending aggregate address — see the module docblock. */
  private readonly docs: readonly SearchDoc[]
  private readonly byId: ReadonlyMap<string, CatalogRecord>
  private readonly facets: FacetIndex
  private readonly text: TextSearcher
  /** All-ones mask, so an unfiltered query allocates nothing to start from. */
  private readonly unfiltered: Uint32Array
  private readonly scratch: Uint32Array

  constructor(file: CatalogFile) {
    this.aggregates = buildAggregateIndex(file)
    this.docs = buildSearchDocs(file, this.aggregates)
    this.size = this.docs.length
    this.files = file.records.length
    this.byId = new Map(file.records.map((record) => [record.id as string, record]))
    this.facets = buildFacetIndex(this.docs, file.tags)
    this.vocabulary = this.facets.vocabulary
    const index: TextIndex = buildTextIndex(this.docs, file.tags)
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
    const items = this.rank(text, filters)
    return { items, ids: items.map((item) => item.preview), total: items.length, facets }
  }

  /** Matching documents in display order, mapped to their aggregates. */
  private rank(
    text: { readonly docs: readonly number[]; readonly score: Int32Array } | null,
    filters: Record<FacetKey, Uint32Array | null>,
  ): readonly TileAggregate[] {
    const mask = this.scratch
    mask.set(this.unfiltered)
    for (const key of FACET_KEYS) {
      const bits = filters[key]
      if (bits !== null) andInto(mask, bits)
    }

    if (text === null) {
      // No query: ascending document order already is the display order.
      const docs = collectBits(mask, [])
      return docs.flatMap((doc) => this.aggregates.aggregates[doc] ?? [])
    }

    const kept: number[] = []
    for (const doc of text.docs) {
      if (getBit(mask, doc)) kept.push(doc)
    }
    return byScoreThenDocument(kept, text.score).flatMap((doc) => this.aggregates.aggregates[doc] ?? [])
  }
}

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
