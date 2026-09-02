/**
 * What a search document *is*, now that the catalog lists aggregates.
 *
 * ## The document is an aggregate, and the position is not its address
 *
 * Every index in this directory is positional: `facets.ts` keeps one bitset per
 * facet value and `textIndex.ts` keeps postings in CSR, and both address a
 * document by a small dense integer. Until row A2 that integer was the manifest
 * ordinal, which is dense by construction — 8,702 records numbered 0…8,701.
 *
 * An aggregate address is **not** dense. Row A1 defines it as the lowest
 * `ManifestOrdinal` in the group, so the 3,822 addresses are spread over
 * 0…8,701 and a bitset over them would allocate 272 words to hold 3,822 members:
 * 112,064 B of facet bitsets where the dense form needs 49,440 B, so **55.9% of
 * every bit is padding**. That is why A1 publishes {@link AggregateIndex.docOf}
 * and why nothing here ever indexes by `address`.
 *
 * The position is therefore the aggregate's index in `AggregateIndex.aggregates`
 * — which is ascending address, so "ascending document" still means "ascending
 * lowest ordinal" and `collectBits` still emits display order without a sort.
 *
 * ## Why a document carries its records and not just its aggregate
 *
 * `TileAggregate` hoists the seven facet fields that provably do not vary inside
 * a group (`pipeline/aggregate.ts` fails the build otherwise), and two of the
 * four facets read exactly those: `kinds` and `build`. The other two do not
 * exist on the aggregate at all —
 *
 *   - **`tex` is matched on tags**, not on `record.texture`, because 80 tiles
 *     carry two roots and `stucco` never wins the field (see `facets.ts`). The
 *     aggregate publishes no tag list; row A1 measured that emitting one would
 *     be payload spent on something the reader can recompute.
 *   - **`conn` genuinely varies**: 1,563 of 3,822 aggregates hold two distinct
 *     values of it, and that is the whole point of the merge.
 *
 * So a document is the aggregate *plus* the records behind it, and the facet and
 * text layers take the union over those records. The union is what makes an item
 * match `openlock` when only its openlock variant does — 42.0% of aggregates
 * carry two or more connection systems against 28.6% of files.
 */
import type { AggregateIndex, CatalogFile, CatalogRecord, TileAggregate } from '@/catalog'

/**
 * One searchable item: an aggregate, and every file that is a way of printing
 * it.
 *
 * `records` is never empty — `TileAggregate.variants` is a non-empty tuple and
 * every variant is a record of the same {@link CatalogFile} — but it is typed as
 * a plain array rather than a tuple because nothing in this directory reads
 * `records[0]`. What the indexes want is the union over all of them, and a
 * non-empty type would buy an invariant no consumer here needs.
 */
export interface SearchDoc {
  readonly aggregate: TileAggregate
  /** The group's files, ascending by ordinal. */
  readonly records: readonly CatalogRecord[]
}

/**
 * Group a catalog's records under their aggregates, in document order.
 *
 * Driven from `file.records` rather than from `aggregate.variants`, which is
 * what makes it total: `docOf` covers every design in the file by construction,
 * so there is no "variant with no record" case to invent a behaviour for. A
 * record whose design the index has never heard of is impossible when both come
 * from the same parse, and is skipped rather than thrown on when they do not —
 * an engine built over a mismatched pair should return fewer items, not fail to
 * construct.
 *
 * Records inside a document are sorted by ordinal so the result is a pure
 * function of the file, independent of the order `catalog.json` happens to list
 * them in.
 */
export function buildSearchDocs(file: CatalogFile, index: AggregateIndex): readonly SearchDoc[] {
  const grouped: CatalogRecord[][] = index.aggregates.map(() => [])

  for (const record of file.records) {
    const doc = index.docOf.get(record.design)
    if (doc === undefined) continue
    grouped[doc]?.push(record)
  }

  return index.aggregates.map((aggregate, doc) => ({
    aggregate,
    records: (grouped[doc] ?? []).sort((a, b) => a.ord - b.ord),
  }))
}
