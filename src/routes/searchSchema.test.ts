/**
 * Tests for the URL-facing facet contract, `src/search/searchSchema.ts`.
 *
 * The file lives here rather than beside its subject because PR 7 owns
 * `src/search/**` apart from `searchSchema.ts` itself, and a test file dropped
 * into that directory would land in another agent's tree.
 *
 * Three things are being proved, and they are the three things that break URLs
 * in practice:
 *
 *   1. **Round-trip.** Every facet survives state → URL → state unchanged.
 *   2. **Garbage tolerance.** Nothing a hand-edited, truncated, rotted or
 *      hostile URL can contain makes the validator throw or return a value
 *      outside its type. A throw would be a white screen on someone's link.
 *   3. **Length.** A realistically filtered state, and the worst state the UI
 *      can produce, both stay far inside the 2,000-character budget.
 */
import { defaultStringifySearch } from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'

import {
  BUILD_ANY,
  BUILD_UNSPECIFIED,
  MAX_FACET_VALUES,
  MAX_FACET_VALUE_LENGTH,
  MAX_QUERY_LENGTH,
  buildSystemFilter,
  defaultCatalogSearch,
  isDefaultFacetSearch,
  parseCompactSearch,
  readBuildFilter,
  stringifyCompactSearch,
  validateCatalogSearch,
  validateFacetSearch,
} from '@/search/searchSchema'
import type { CatalogSearch } from '@/search/searchSchema'
import { ManifestOrdinal } from '@/catalog/schema'

/** `validateSearch`'s declared input is the *link* shape; the wire is untyped. */
function validateWire(raw: Record<string, unknown>): CatalogSearch {
  return validateCatalogSearch(raw as Parameters<typeof validateCatalogSearch>[0])
}

/** state → query string → state, exactly as the router does it. */
function roundTrip(state: CatalogSearch): CatalogSearch {
  return validateWire(parseCompactSearch(stringifyCompactSearch(state)))
}

const ordinal = (n: number) => ManifestOrdinal.parse(n)

/**
 * The 38 texture roots §9 says the material registry must cover.
 *
 * The real vocabulary is the importer's (PR 4) and the registry's (PR 8); this
 * list reproduces the ones named in `docs/texture-materials.draft.ts` and fills
 * the rest with names of the same shape and length. It exists to size a URL,
 * not to define a vocabulary, so being length-representative is what matters.
 *
 * **38 is the registry's number, and it is deliberately not the facet's.** Row
 * D3 collapsed `texture|foundations`, so 37 roots occur on a tag and 36 reach
 * `record.texture` while `TEXTURE_ROOT_MATERIAL` still maps 38 (it keeps the
 * retired spelling as a fallback). Row X5 checked all three against this file
 * and left it at 38: the worst case a URL budget has to survive is the widest
 * vocabulary anyone might select, so the registry's count is the conservative
 * one to size against. `src/catalog/schema.ts#texture` names all three.
 */
const TEXTURE_ROOTS = [
  'aztlan',
  'brick',
  'broken_stucco',
  'cave',
  'cut_stone',
  'dungeon_stone',
  'eroded',
  'flagstone',
  'ice',
  'metal',
  'necro',
  'plaster',
  'rough_stone',
  'ruined_stucco',
  'sandstone',
  'sewer',
  'stucco',
  'torch_plate',
  'towne',
  'tudor',
  'water',
  'wood',
  'cobblestone',
  'crystal',
  'dirt',
  'grass',
  'gravel',
  'lava',
  'marble',
  'mosaic',
  'obsidian',
  'planks',
  'rubble',
  'shingle',
  'slate',
  'thatch',
  'tile_floor',
  'volcanic',
]

describe('search param round-trip', () => {
  it('carries free text through a URL, spaces and punctuation included', () => {
    const state: CatalogSearch = { ...defaultCatalogSearch(), q: 'arrow slit 45° +corner' }
    expect(roundTrip(state)).toEqual(state)
  })

  it('carries a multi-select kinds facet', () => {
    const state: CatalogSearch = { ...defaultCatalogSearch(), kinds: ['floor', 'stairs', 'wall'] }
    expect(stringifyCompactSearch(state)).toBe('?kinds=floor~stairs~wall')
    expect(roundTrip(state)).toEqual(state)
  })

  it('carries a single-value facet without turning it into a list of one', () => {
    const state: CatalogSearch = { ...defaultCatalogSearch(), kinds: ['floor'] }
    expect(stringifyCompactSearch(state)).toBe('?kinds=floor')
    expect(roundTrip(state)).toEqual(state)
  })

  it('carries texture prefixes, which are roots and not a six-value enum', () => {
    const state: CatalogSearch = { ...defaultCatalogSearch(), tex: ['cut_stone', 'dungeon_stone', 'towne'] }
    expect(stringifyCompactSearch(state)).toBe('?tex=cut_stone~dungeon_stone~towne')
    expect(roundTrip(state)).toEqual(state)
  })

  it('carries a multi-select connection facet', () => {
    const state: CatalogSearch = { ...defaultCatalogSearch(), conn: ['dragonlock', 'magnetic', 'openlock'] }
    expect(roundTrip(state)).toEqual(state)
  })

  it('carries a build system, spaces and all', () => {
    const state: CatalogSearch = { ...defaultCatalogSearch(), build: buildSystemFilter('separate wall') }
    expect(stringifyCompactSearch(state)).toBe('?build=separate%20wall')
    expect(roundTrip(state)).toEqual(state)
    expect(readBuildFilter(roundTrip(state).build)).toEqual({ kind: 'system', value: 'separate wall' })
  })

  it('carries "unspecified" as a build state distinct from "no filter"', () => {
    // 2,978 tiles (34.2%) carry no `build|` tag. Filtering *for* them and not
    // filtering at all are different questions and must be different URLs.
    const unspecified: CatalogSearch = { ...defaultCatalogSearch(), build: BUILD_UNSPECIFIED }
    const any: CatalogSearch = { ...defaultCatalogSearch(), build: BUILD_ANY }

    expect(stringifyCompactSearch(unspecified)).toBe('?build=!none')
    expect(stringifyCompactSearch(any)).toBe('')
    expect(roundTrip(unspecified)).toEqual(unspecified)
    expect(readBuildFilter(unspecified.build)).toEqual({ kind: 'unspecified' })
    expect(readBuildFilter(any.build)).toEqual({ kind: 'any' })
  })

  it('keeps a build system that collides with the sentinel prefix distinguishable', () => {
    const state: CatalogSearch = { ...defaultCatalogSearch(), build: buildSystemFilter('!none') }
    expect(readBuildFilter(state.build)).toEqual({ kind: 'system', value: '!none' })
    expect(readBuildFilter(roundTrip(state).build)).toEqual({ kind: 'system', value: '!none' })
    expect(state.build).not.toBe(BUILD_UNSPECIFIED)
  })

  it('carries the selected tile as a manifest ordinal', () => {
    const state: CatalogSearch = { ...defaultCatalogSearch(), tile: ordinal(4821) }
    expect(stringifyCompactSearch(state)).toBe('?tile=4821')
    expect(roundTrip(state)).toEqual(state)
  })

  it('carries every facet at once', () => {
    const state: CatalogSearch = {
      q: 'arrow slit',
      kinds: ['floor', 'stairs', 'wall'],
      tex: ['cave', 'cut_stone', 'dungeon_stone', 'towne'],
      build: buildSystemFilter('separate wall'),
      conn: ['dragonlock', 'magnetic', 'openlock'],
      tile: ordinal(4821),
    }
    expect(roundTrip(state)).toEqual(state)
  })

  it('canonicalises: keys sorted, values sorted and deduplicated', () => {
    // One view has one URL, or two people who picked the same filters in a
    // different order produce two share links for the same room.
    const clickedInOneOrder = validateWire({ tex: ['towne', 'cave'], kinds: 'wall', q: 'stair' })
    const clickedInAnother = validateWire({ q: 'stair', kinds: ['wall', 'wall'], tex: ['cave', 'towne', 'cave'] })

    expect(stringifyCompactSearch(clickedInOneOrder)).toBe(stringifyCompactSearch(clickedInAnother))
    expect(stringifyCompactSearch(clickedInOneOrder)).toBe('?kinds=wall&q=stair&tex=cave~towne')
  })

  it('survives a literal separator inside a value', () => {
    const state: CatalogSearch = { ...defaultCatalogSearch(), q: 'wall~corner' }
    expect(stringifyCompactSearch(state)).toBe('?q=wall%7Ecorner')
    expect(roundTrip(state)).toEqual(state)
  })

  it('is idempotent under the router’s parse-then-stringify normalisation', () => {
    // The router normalises every incoming URL with
    // `stringifySearch(parseSearch(url.search))`; a codec that is not a fixed
    // point there rewrites the address bar on every load.
    const url = '?build=separate%20wall&kinds=floor~wall&q=arrow%20slit&tex=cave&tile=4821'
    expect(stringifyCompactSearch(parseCompactSearch(url))).toBe(url)
  })
})

describe('garbage input degrades to defaults', () => {
  const defaults = defaultCatalogSearch()

  it('accepts a completely empty URL', () => {
    expect(validateWire(parseCompactSearch(''))).toEqual(defaults)
    expect(validateWire(parseCompactSearch('?'))).toEqual(defaults)
  })

  it.each([
    ['a number where a string belongs', { q: 42 }],
    ['a boolean', { q: true }],
    ['an object', { q: { evil: true } }],
    ['a nested array', { kinds: [['floor'], ['wall']] }],
    ['null', { kinds: null }],
    ['an array of objects', { tex: [{}, []] }],
    ['a function-shaped string in build', { build: '()=>1' }],
    ['everything at once', { q: [], kinds: 1, tex: false, build: {}, conn: null, tile: [] }],
  ])('does not throw on %s', (_label, raw) => {
    expect(() => validateWire(raw)).not.toThrow()
    const parsed = validateWire(raw)
    expect(Array.isArray(parsed.kinds)).toBe(true)
    expect(Array.isArray(parsed.tex)).toBe(true)
    expect(Array.isArray(parsed.conn)).toBe(true)
    expect(typeof parsed.q).toBe('string')
    expect(typeof parsed.build).toBe('string')
    expect(parsed.tile === null || typeof parsed.tile === 'number').toBe(true)
  })

  it('degrades an unknown build sentinel to "no filter"', () => {
    // A `!`-prefixed value we do not know is a rotted link. Treating it as a
    // build system would render an empty catalog that looks like a data bug.
    expect(validateWire({ build: '!bogus' }).build).toBe(BUILD_ANY)
    expect(validateWire({ build: '!' }).build).toBe(BUILD_ANY)
    expect(readBuildFilter('!whatever')).toEqual({ kind: 'any' })
  })

  it('drops an absurdly long query', () => {
    const long = 'a'.repeat(MAX_QUERY_LENGTH + 1)
    expect(validateWire({ q: long }).q).toBe('')
    expect(validateWire({ q: 'a'.repeat(MAX_QUERY_LENGTH) }).q).toHaveLength(MAX_QUERY_LENGTH)
  })

  it('drops absurdly long facet values but keeps the good ones', () => {
    const long = 'x'.repeat(MAX_FACET_VALUE_LENGTH + 1)
    expect(validateWire({ tex: ['cave', long, 'towne'] }).tex).toEqual(['cave', 'towne'])
  })

  it('caps the number of values in one facet', () => {
    const many = Array.from({ length: 5_000 }, (_, i) => `kind-${String(i)}`)
    expect(validateWire({ kinds: many }).kinds).toHaveLength(MAX_FACET_VALUES)
  })

  it('drops a nonsense tile ordinal to a closed drawer', () => {
    for (const bad of ['abc', '-1', '1e5', 'NaN', 'Infinity', '4.5', '', ' ', '0x10', '99999999999999']) {
      expect(validateWire({ tile: bad }).tile).toBeNull()
    }
    // `?tile=` must not coerce to ordinal 0 the way `Number('')` would.
    expect(validateWire(parseCompactSearch('?tile=')).tile).toBeNull()
    expect(validateWire({ tile: '0' }).tile).toBe(0)
  })

  it('treats injection-looking strings as text, and escapes them in the URL', () => {
    const hostile = [
      '<script>alert(1)</script>',
      "'; DROP TABLE tiles;--",
      'javascript:alert(1)',
      '../../../etc/passwd',
      '%00%0d%0aSet-Cookie:x=1',
      '&amp;kinds=wall',
    ]
    for (const value of hostile) {
      const state = validateWire({ q: value })
      // A query is text. It is not the schema's job to censor it, but it must
      // never break out of its own parameter.
      const url = stringifyCompactSearch(state)
      expect(url).not.toContain('<')
      expect(url.split('&')).toHaveLength(1)
      expect(roundTrip(state)).toEqual(state)
    }
  })

  it('does not let a search param reach Object.prototype', () => {
    const parsed = parseCompactSearch('?__proto__=polluted&constructor=polluted')
    expect(Object.getPrototypeOf({})).toBe(Object.prototype)
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
    expect(parsed['__proto__']).toBe('polluted')
    expect(validateWire(parsed)).toEqual(defaults)
  })

  it('survives a malformed percent escape', () => {
    // `?q=100%` is an ordinary hand-edit and an ordinary truncated link.
    expect(() => parseCompactSearch('?q=100%')).not.toThrow()
    expect(validateWire(parseCompactSearch('?q=100%')).q).toBe('100%')
    expect(validateWire(parseCompactSearch('?q=%zz%')).q).toBe('%zz%')
    expect(validateWire(parseCompactSearch('?%=%&&=&x')).q).toBe('')
  })

  it('drops unknown params rather than carrying them forward', () => {
    expect(validateWire(parseCompactSearch('?nonsense=1&kinds=wall'))).toEqual({ ...defaults, kinds: ['wall'] })
  })

  it('merges a repeated key instead of losing one of them', () => {
    expect(validateWire(parseCompactSearch('?kinds=floor&kinds=wall')).kinds).toEqual(['floor', 'wall'])
  })

  it('recovers a scalar that the codec split on a hand-typed separator', () => {
    expect(validateWire(parseCompactSearch('?q=cave~wall')).q).toBe('cave~wall')
  })

  it('validates the builder facets by the same rules, minus the drawer', () => {
    const facets = validateFacetSearch(
      parseCompactSearch('?q=cave&kinds=wall&tile=4821') as Parameters<typeof validateFacetSearch>[0],
    )
    expect(facets).toEqual({ q: 'cave', kinds: ['wall'], tex: [], build: BUILD_ANY, conn: [] })
    expect(facets).not.toHaveProperty('tile')
  })

  it('reports an untouched state as default', () => {
    expect(isDefaultFacetSearch(defaults)).toBe(true)
    expect(isDefaultFacetSearch({ ...defaults, kinds: ['wall'] })).toBe(false)
    expect(isDefaultFacetSearch({ ...defaults, build: BUILD_UNSPECIFIED })).toBe(false)
  })
})

describe('URL length', () => {
  const REALISTIC: CatalogSearch = {
    q: 'arrow slit',
    kinds: ['floor', 'stairs', 'wall'],
    tex: ['cave', 'cut_stone', 'dungeon_stone', 'towne'],
    build: buildSystemFilter('separate wall'),
    conn: ['dragonlock', 'magnetic', 'openlock'],
    tile: ordinal(4821),
  }

  /** Everything the sidebar can select at once — the worst case the UI produces. */
  const WORST_CASE: CatalogSearch = {
    q: 'a'.repeat(MAX_QUERY_LENGTH),
    kinds: ['angled', 'base', 'column', 'floor', 'riser', 'stairs', 'wall'],
    tex: [...TEXTURE_ROOTS],
    build: buildSystemFilter('separate wall'),
    conn: ['dragonlock', 'magnetic', 'openforge', 'openlock', 'topless', 'unsupported'],
    tile: ordinal(999_999),
  }

  const url = (state: CatalogSearch) => `/catalog${stringifyCompactSearch(state)}`

  it('keeps a realistically filtered catalog view well under 2,000 characters', () => {
    const href = url(REALISTIC)
    expect(href.length).toBeLessThan(300)
    expect(href.length).toBeLessThan(2_000)
  })

  it('keeps every facet selected at once under 2,000 characters', () => {
    // 38 texture roots is the whole vocabulary §9 has to cover; if selecting all
    // of them blows the budget, the encoding is wrong for this corpus.
    expect(url(WORST_CASE).length).toBeLessThan(2_000)
  })

  it('is substantially shorter than the default JSON encoding it replaces', () => {
    // This is the entire reason for a custom codec. TanStack's default
    // JSON-stringifies arrays and then percent-encodes the brackets and quotes,
    // so every value in a list costs `%22…%22%2C` — nine characters of
    // punctuation — before it costs any of its own.
    //
    // Measured today: 144 against 232 for the realistic state (38% shorter) and
    // 584 against 1,002 with every facet selected (42% shorter). The bounds
    // below have head-room; they exist to make a regression loud, not to pin the
    // exact figures.
    const compact = stringifyCompactSearch(REALISTIC).length
    const asJson = defaultStringifySearch(REALISTIC).length
    expect(compact).toBeLessThan(asJson * 0.7)

    const compactWorst = stringifyCompactSearch(WORST_CASE).length
    const jsonWorst = defaultStringifySearch(WORST_CASE).length
    expect(compactWorst).toBeLessThan(jsonWorst * 0.65)
    expect(compactWorst).toBeLessThan(700)
    // The naive encoding is what would make 38 texture roots unusable, and it is
    // the punctuation rather than the value count that does it.
    expect(jsonWorst).toBeGreaterThan(1_000)
  })

  it('spends nothing on defaults', () => {
    expect(stringifyCompactSearch(defaultCatalogSearch())).toBe('')
  })
})
