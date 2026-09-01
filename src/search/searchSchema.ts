/**
 * OpenForge Workshop — the URL-facing facet state contract.
 *
 * This module owns **what a filtered view of the catalog is**, as a value that
 * survives a copy-pasted URL. It is inert: it defines schemas, defaults and a
 * codec, and nothing reads it yet.
 *
 * It is its own file rather than part of the catalog screen because **three
 * consumers need the same state and none of them owns it**:
 *
 *   1. the catalog screen (PR 13) authors it from the facet sidebar;
 *   2. the builder palette (PR 18) reads it — design-contract.md §2.4 puts a
 *      search box in the palette that queries the *whole catalog*, not the
 *      library, so the palette runs the same facets against the same index;
 *   3. the share-link codec (PR 10) serialises it alongside the placements.
 *
 * If the catalog screen owned it, the other two would each re-derive it and
 * they would diverge on the first facet that gains a second value.
 *
 * **The facet shapes are dictated by the data, not by what is convenient.**
 * Every one of them is a measured fact from architecture-plan.md §6 and
 * `src/catalog/schema.ts`:
 *
 * | facet      | shape                       | why it cannot be simpler                     |
 * | ---------- | --------------------------- | -------------------------------------------- |
 * | kind       | multi-select                | 19.6% of tiles land in 2+ buckets, 11.6% in none — a single value cannot express either |
 * | texture    | multi-select **prefixes**   | 37 roots, matched by prefix; not a 6-value enum |
 * | build      | single-select + unspecified | 2,978 tiles (34.2%) carry no `build\|` tag, so absence is a filter state |
 * | connection | multi-select                | 3,091 tiles (35.5%) carry 2–3 systems         |
 *
 * **Two hard rules, and both exist because URLs get hand-edited and links rot:**
 *
 *   - Every param has a safe default. A missing param, a wrong type, an unknown
 *     sentinel, a 10 KB string, a malformed percent-escape — every one of them
 *     degrades to the default. `validateCatalogSearch` cannot throw, because a
 *     throw here is a white screen on somebody's shared link.
 *   - The encoding is compact. TanStack's default `stringifySearch` JSON-encodes
 *     and then percent-encodes arrays, so four selected textures cost
 *     `tex=%5B%22dungeon_stone%22%2C%22cave%22%2C…%5D` — about 3.5× the bytes of
 *     the values themselves. At 37 texture roots that is a URL nobody can read
 *     or paste. `searchSchema.test.ts` measures both.
 *
 * **What this module deliberately does not do.** It does not match anything.
 * Prefix semantics, tokenisation and the bitset facet index are PR 7's
 * (`src/search/**` minus this file). This file is state and encoding only, so
 * that the three consumers above can agree on the state without agreeing on the
 * engine.
 */
import type { SearchSchemaInput } from '@tanstack/react-router'
import { z } from 'zod'

import { ManifestOrdinal } from '@/catalog/schema'

/* ------------------------------------------------------------------- limits */

/**
 * Longest free-text query kept. Longer input degrades to the empty query.
 *
 * The bound is a denial-of-service guard, not a UX one: the query reaches
 * MiniSearch, and a megabyte pasted into `?q=` should cost nothing.
 */
export const MAX_QUERY_LENGTH = 128

/**
 * Longest single facet value kept. Longer values are dropped from the list.
 *
 * The real vocabulary is nowhere near this: the longest texture root, build
 * system and connection system are all under 20 characters.
 */
export const MAX_FACET_VALUE_LENGTH = 64

/**
 * Most values kept in one multi-select facet.
 *
 * 37 texture roots is the largest real vocabulary (§9), so this is that plus
 * head-room. Selecting more than the vocabulary holds is not a state the UI can
 * produce; it is what a rotted or hand-built link looks like.
 */
export const MAX_FACET_VALUES = 64

/* -------------------------------------------------------------------- codec */

/**
 * Separator between values of one multi-select facet: `kinds=floor~wall`.
 *
 * `~` is unreserved in RFC 3986, so `encodeURIComponent` leaves it alone and no
 * browser re-encodes it — the character survives a round-trip through the
 * address bar looking like itself. A literal `~` inside a value is escaped to
 * `%7E` by {@link encodeSegment} before the join, so the split is unambiguous
 * even though tag values are not currently allowed to contain one.
 */
export const VALUE_SEPARATOR = '~'

/**
 * Percent-encode one value so it can sit between separators.
 *
 * `encodeURIComponent` leaves `~` alone, which is exactly why the separator has
 * to be re-escaped by hand afterwards. Doing it in this order is safe: by the
 * time the replace runs, every `%` in the string is already part of an escape
 * the encoder produced, so no double-escaping is possible.
 */
function encodeSegment(value: string): string {
  return encodeURIComponent(value).replaceAll(VALUE_SEPARATOR, '%7E')
}

/**
 * Decode one value, tolerating a malformed escape.
 *
 * `decodeURIComponent('100%')` throws. `?q=100%` is a plausible hand-edit and a
 * plausible truncated link, and neither may take the app down, so a segment that
 * will not decode is kept verbatim.
 */
function decodeSegment(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/**
 * Router-level `parseSearch`: query string → raw, still-untyped values.
 *
 * The contract is deliberately thin — **strings and arrays of strings, nothing
 * else.** No number or boolean coercion (TanStack's default `qss.decode` does
 * both, which quietly turns a texture root of `2` into the number 2). Typing is
 * `validateSearch`'s job, and keeping it in exactly one place is what makes the
 * garbage-tolerance guarantee checkable.
 *
 * Three behaviours worth naming:
 *
 *   - A value containing {@link VALUE_SEPARATOR} becomes an array; a value
 *     without one stays a string. The multi-select schemas accept both, so a
 *     one-value facet round-trips as `kinds=floor` rather than as a list of one.
 *   - Repeated keys (`?kinds=floor&kinds=wall`) merge into one array. That is
 *     not a shape this app emits, but it is the obvious hand-edit and the
 *     obvious output of every other query-string library.
 *   - The result is built through `Object.fromEntries`, which defines own
 *     properties instead of assigning them. `?__proto__=x` therefore lands as a
 *     harmless own key rather than reaching `Object.prototype`.
 */
export function parseCompactSearch(searchStr: string): Record<string, unknown> {
  const body = searchStr.startsWith('?') ? searchStr.slice(1) : searchStr
  const merged = new Map<string, string | string[]>()

  for (const pair of body.split('&')) {
    if (pair === '') continue
    const eq = pair.indexOf('=')
    const key = decodeSegment(eq === -1 ? pair : pair.slice(0, eq))
    if (key === '') continue

    const rawValue = eq === -1 ? '' : pair.slice(eq + 1)
    const segments = rawValue.split(VALUE_SEPARATOR).map(decodeSegment)
    const value: string | string[] = segments.length === 1 ? (segments[0] ?? '') : segments

    const existing = merged.get(key)
    if (existing === undefined) {
      merged.set(key, value)
    } else {
      merged.set(key, [...asArray(existing), ...asArray(value)])
    }
  }

  return Object.fromEntries(merged)
}

function asArray(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value]
}

/**
 * Router-level `stringifySearch`: validated values → query string.
 *
 * Keys are emitted in sorted order so that one state has exactly one URL. That
 * matters more than it looks: a share link, a browser cache key and a test
 * assertion all compare URLs as strings, and `?q=cave&kinds=wall` versus
 * `?kinds=wall&q=cave` would otherwise be two spellings of one view.
 *
 * `null`, `undefined`, the empty string and the empty array all drop out
 * entirely rather than encoding as `tile=null` or `q=`. A closed drawer is an
 * absent `tile`, not a `tile` whose value is the word null; and since an absent
 * param and an empty one both validate to the same default, emitting the empty
 * one costs characters to say nothing.
 */
export function stringifyCompactSearch(search: Record<string, unknown>): string {
  const parts: string[] = []

  for (const key of Object.keys(search).sort()) {
    const encoded = encodeSearchValue(search[key])
    if (encoded === undefined) continue
    parts.push(`${encodeSegment(key)}=${encoded}`)
  }

  return parts.length === 0 ? '' : `?${parts.join('&')}`
}

function encodeSearchValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (Array.isArray(value)) {
    // Numbers and booleans are encoded rather than filtered, so a future
    // `number[]` param does not silently lose its values on the way to the URL.
    const items: string[] = []
    for (const item of value) {
      const encoded = encodeSearchValue(item)
      if (encoded !== undefined) items.push(encoded)
    }
    return items.length === 0 ? undefined : items.join(VALUE_SEPARATOR)
  }
  if (typeof value === 'string') return value === '' ? undefined : encodeSegment(value)
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : undefined
  if (typeof value === 'boolean') return String(value)
  // No declared param is object-valued. Encoding rather than dropping keeps an
  // undeclared one from vanishing silently if a later PR adds it and forgets.
  try {
    return encodeSegment(JSON.stringify(value))
  } catch {
    return undefined
  }
}

/* ------------------------------------------------------------- build filter */

/**
 * `build` when no build system is selected — the default, and absent from URLs.
 */
export const BUILD_ANY = ''

/**
 * `build` when the user is filtering *for* the tiles that carry no `build|` tag.
 *
 * This is the whole reason the facet is not a plain string. 2,978 tiles (34.2%)
 * have no build system, and "show me those" is a question the sidebar must be
 * able to ask — architecture-plan.md §6 spells the widget out as "single-select
 * + unspecified". Modelling it as `undefined` would make the filter
 * indistinguishable from *no filter*, which is the other 65.8%.
 *
 * The leading `!` marks it as a sentinel rather than a build system. A literal
 * build system that started with `!` would collide, so {@link buildSystemFilter}
 * escapes one by doubling the `!`, and {@link readBuildFilter} undoes it. No
 * real value needs this today — the five observed are `separate wall`,
 * `wall on tile`, `s2w`, `thick wall`, `s-system` — but the collision would be
 * silent, and a silent collision here mislabels a third of the corpus.
 */
export const BUILD_UNSPECIFIED = '!none'

/**
 * The build facet, as a value a consumer can `switch` on exhaustively.
 *
 * The URL carries a flat string; this is what it means. Read it with
 * {@link readBuildFilter} rather than comparing the raw string, so the
 * sentinel-versus-system distinction cannot be forgotten at a call site.
 */
export type BuildFilter =
  | { readonly kind: 'any' }
  | { readonly kind: 'unspecified' }
  | { readonly kind: 'system'; readonly value: string }

/** Encode a concrete build system as a `build` param value. */
export function buildSystemFilter(system: string): string {
  return system.startsWith('!') ? `!${system}` : system
}

/** Decode a `build` param value. Never throws; unknown sentinels read as `any`. */
export function readBuildFilter(encoded: string): BuildFilter {
  if (encoded === BUILD_ANY) return { kind: 'any' }
  if (encoded === BUILD_UNSPECIFIED) return { kind: 'unspecified' }
  if (encoded.startsWith('!!')) return { kind: 'system', value: encoded.slice(1) }
  // A `!`-prefixed value that is not a sentinel we know is a rotted link, not a
  // build system: degrade to no filter rather than to a system that matches
  // nothing and looks like an empty catalog.
  if (encoded.startsWith('!')) return { kind: 'any' }
  return { kind: 'system', value: encoded }
}

/* ------------------------------------------------------------- normalisation */

/** Coerce raw wire input to a scalar string, recovering a split literal `~`. */
function toScalarString(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (Array.isArray(value)) {
    // `?q=a~b` splits at the codec layer. Re-joining recovers what was typed,
    // which beats discarding the query because it held a tilde.
    return value.filter((item): item is string => typeof item === 'string').join(VALUE_SEPARATOR)
  }
  return ''
}

function normaliseQuery(value: unknown): string {
  const text = toScalarString(value).trim()
  return text.length > MAX_QUERY_LENGTH ? '' : text
}

function normaliseBuild(value: unknown): string {
  const text = toScalarString(value).trim()
  if (text.length > MAX_FACET_VALUE_LENGTH) return BUILD_ANY
  if (text === BUILD_UNSPECIFIED || text.startsWith('!!')) return text
  if (text.startsWith('!')) return BUILD_ANY
  return text
}

/**
 * Coerce raw wire input to a canonical multi-select facet value.
 *
 * Sorted and deduplicated, so click order does not change the URL and two users
 * who picked the same four textures produce the same share link. Individual bad
 * entries are dropped rather than failing the whole facet: half a filter is
 * closer to what the link meant than no filter at all.
 */
function normaliseFacetValues(value: unknown): string[] {
  const raw: unknown[] = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
  const kept = new Set<string>()

  for (const item of raw) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (trimmed === '' || trimmed.length > MAX_FACET_VALUE_LENGTH) continue
    kept.add(trimmed)
    if (kept.size >= MAX_FACET_VALUES) break
  }

  return [...kept].sort()
}

/**
 * Coerce raw wire input to the manifest ordinal of the tile in the drawer.
 *
 * The drawer addresses a tile by {@link ManifestOrdinal}, not by `TileId`. Two
 * reasons, and the first is the practical one: a `TileId` is a `full_name` like
 * `tiles/cave/thick_wall/…/cave%aggregate+2#corner.IL+corner,90.openlock.stl` —
 * it contains `#`, `%` and `+`, so it is roughly 140 characters once escaped and
 * a single unescaped copy-paste truncates the URL at the `#`. The second is that
 * the ordinal is *already* the app's URL currency for a tile: share links encode
 * ordinals (§13) and the append-only invariant on `ManifestOrdinal` exists
 * precisely so a number in somebody's saved URL still means the same tile after
 * the next import. Using `TileId` here and ordinals there would be two
 * addressing schemes for one job.
 *
 * Only `/^\d{1,9}$/` is accepted, rather than `Number(raw)`: `Number('')` and
 * `Number(' ')` are both `0`, which is a valid ordinal, so a coercing parse
 * turns `?tile=` into "open the drawer on tile zero".
 */
function normaliseTile(value: unknown): ManifestOrdinal | null {
  const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : ''
  if (!/^\d{1,9}$/.test(raw)) return null
  const parsed = ManifestOrdinal.safeParse(Number(raw))
  return parsed.success ? parsed.data : null
}

/* ------------------------------------------------------------------ schemas */

const queryField = z
  .unknown()
  .transform(normaliseQuery)
  .catch(() => '')

const facetField = z
  .unknown()
  .transform(normaliseFacetValues)
  .catch(() => [])

const buildField = z
  .unknown()
  .transform(normaliseBuild)
  .catch(() => BUILD_ANY)

const tileField = z
  .unknown()
  .transform(normaliseTile)
  .catch(() => null)

/**
 * The facet state shared by the catalog sidebar and the builder palette.
 *
 * Short keys because they are URL keys and the URL is the product here; plural
 * where the facet is multi-valued, so the name itself says whether one more
 * click adds or replaces.
 */
export const facetSearchSchema = z.object({
  /** Free text. Tokenised and matched by PR 7; carried verbatim here. */
  q: queryField,
  /** Kind buckets, OR-ed. Mirrors `CatalogRecord.kinds`. */
  kinds: facetField,
  /** Texture roots, matched by prefix and OR-ed. Not `textures`: these are prefixes. */
  tex: facetField,
  /** One build system, {@link BUILD_UNSPECIFIED}, or {@link BUILD_ANY}. */
  build: buildField,
  /** Connection systems, OR-ed. Mirrors `CatalogRecord.conn`. */
  conn: facetField,
})

/** The facet state, after validation. Every field is always present. */
export type FacetSearch = z.infer<typeof facetSearchSchema>

/**
 * The catalog's search state: the facets, plus the tile whose drawer is open.
 *
 * The drawer is search state rather than a nested route. See
 * `src/routes/routeTree.tsx` for the reasoning; the part that lives here is the
 * consequence — a bad `tile` degrades to `null`, which is a closed drawer, where
 * a bad path param would need a not-found boundary to avoid a blank page.
 */
export const catalogSearchSchema = facetSearchSchema.extend({
  /** Manifest ordinal of the tile in the detail drawer; `null` is closed. */
  tile: tileField,
})

/** The catalog's search state, after validation. */
export type CatalogSearch = z.infer<typeof catalogSearchSchema>

/* ----------------------------------------------------------------- defaults */

/** A fresh, unfiltered facet state. A function, so no two callers share arrays. */
export function defaultFacetSearch(): FacetSearch {
  return { q: '', kinds: [], tex: [], build: BUILD_ANY, conn: [] }
}

/** A fresh, unfiltered catalog state with the drawer closed. */
export function defaultCatalogSearch(): CatalogSearch {
  return { ...defaultFacetSearch(), tile: null }
}

/** True when nothing is filtered — what the "✕ Clear filters" affordance keys off. */
export function isDefaultFacetSearch(search: FacetSearch): boolean {
  return (
    search.q === '' &&
    search.kinds.length === 0 &&
    search.tex.length === 0 &&
    search.conn.length === 0 &&
    search.build === BUILD_ANY
  )
}

/* --------------------------------------------------------------- validators */

/**
 * What a `<Link>` or `navigate()` may pass for a catalog search.
 *
 * Partial on purpose: `search={{ q: 'cave' }}` is the natural call, and the
 * validator fills the rest from the defaults.
 */
export type CatalogSearchInput = Partial<CatalogSearch>

/** What a `<Link>` or `navigate()` may pass for a builder search. */
export type FacetSearchInput = Partial<FacetSearch>

/**
 * TanStack `validateSearch` for `/catalog`.
 *
 * The declared input type is what makes navigation type-safe: intersecting with
 * `SearchSchemaInput` tells the router to type `<Link search={…}>` as
 * {@link CatalogSearchInput} rather than as the fully-populated output, so
 * partial navigations compile and a misspelled facet does not.
 *
 * At runtime the input is whatever {@link parseCompactSearch} produced from an
 * arbitrary URL, which is why the body validates rather than trusting the type,
 * and why it returns defaults instead of rethrowing: `matchRoutes` records a
 * thrown `SearchParamError` on the match and renders an error boundary, so a
 * throw here is a blank page for anyone opening a link that has rotted.
 */
export function validateCatalogSearch(input: CatalogSearchInput & SearchSchemaInput): CatalogSearch {
  const result = catalogSearchSchema.safeParse(input)
  return result.success ? result.data : defaultCatalogSearch()
}

/**
 * TanStack `validateSearch` for `/builder`.
 *
 * The builder carries the facets but not `tile`: design-contract.md §2.4 gives
 * the palette a search box over the whole catalog, while the detail drawer is
 * the catalog screen's overlay. A `tile` param on `/builder` would name a
 * selection the builder does not have.
 */
export function validateFacetSearch(input: FacetSearchInput & SearchSchemaInput): FacetSearch {
  const result = facetSearchSchema.safeParse(input)
  return result.success ? result.data : defaultFacetSearch()
}
