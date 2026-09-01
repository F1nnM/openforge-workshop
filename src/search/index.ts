/**
 * The search layer's public surface.
 *
 * Import from `@/search`, never from `@/search/engine` or `@/search/facets`, so
 * the bitset implementation can be replaced without touching a consumer. The
 * URL-state contract (`searchSchema.ts`, PR 6) is re-exported from here too:
 * a caller reading facet state and a caller querying with it are the same
 * caller, and making them import from two places would be a seam with nothing
 * on either side of it.
 */
export type { FacetSearch, FacetSearchInput, BuildFilter, CatalogSearch, CatalogSearchInput } from './searchSchema'
export {
  BUILD_ANY,
  BUILD_UNSPECIFIED,
  MAX_FACET_VALUES,
  MAX_FACET_VALUE_LENGTH,
  MAX_QUERY_LENGTH,
  buildSystemFilter,
  catalogSearchSchema,
  defaultCatalogSearch,
  defaultFacetSearch,
  facetSearchSchema,
  isDefaultFacetSearch,
  parseCompactSearch,
  readBuildFilter,
  stringifyCompactSearch,
  validateCatalogSearch,
  validateFacetSearch,
} from './searchSchema'

export type { SearchEngine, SearchResult } from './engine'
export { createSearchEngine } from './engine'

export type { FacetBucket, FacetCounts, FacetKey, FacetVocabulary } from './facets'
export { FACET_KEYS, KIND_OTHER } from './facets'

export { MAX_QUERY_TOKENS, tokenise, tokeniseQuery } from './text'
