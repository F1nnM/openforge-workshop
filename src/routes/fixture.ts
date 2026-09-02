/**
 * A hand-built catalog for the addressing tests.
 *
 * Parsed through `CatalogFile.parse` rather than cast, so a draft that could not
 * exist in a real index fails here instead of quietly exercising the resolver on
 * an impossible record. Same reasoning as `src/catalog/aggregate.test.ts`'s
 * fixture, and deliberately not an import of it: that file is A1's and its drafts
 * are shaped for the grouping rules, while what these tests need is control over
 * **which ordinals are group minima**, because that is the whole subject of row
 * A4.
 *
 * Nothing in production imports this. It lives beside the tests rather than in
 * `src/screens/catalog/fixture.ts` (row A3's) so the two rows cannot break each
 * other's tests by tuning a shared corpus.
 */
import type { CatalogFile, Footprint } from '@/catalog'
import { CatalogFile as CatalogFileSchema, MEASURED_SPRITE_SHEET, SCHEMA_VERSION } from '@/catalog'

export interface Draft {
  readonly id: string
  readonly ord: number
  readonly design: string
  readonly layer: 'base' | 'topper' | 'integral' | 'insert'
  readonly tags?: readonly string[]
  readonly name?: string
}

const MD5 = '0123456789abcdef0123456789abcde'
const FOOT: Footprint = { shape: 'wall', length: 2 }

/** A parsed `CatalogFile` over the drafts, in the order given. */
export function catalogOf(drafts: readonly Draft[]): CatalogFile {
  const table: string[] = []
  const intern = (tag: string): number => {
    const at = table.indexOf(tag)
    if (at !== -1) return at
    table.push(tag)
    return table.length - 1
  }

  const records = drafts.map((draft, i) => ({
    id: draft.id,
    ord: draft.ord,
    blob: `${MD5}${String(i % 10)}`,
    file: draft.id.slice(draft.id.lastIndexOf('/') + 1),
    bytes: 1_000 + i,
    sprite: true,
    family: draft.id.slice(0, draft.id.lastIndexOf('/')),
    design: draft.design,
    name: draft.name ?? 'Test Tile',
    kinds: ['wall'],
    conn: [],
    layer: draft.layer,
    tags: (draft.tags ?? ['connection|openlock']).map(intern),
    foot: FOOT,
  }))

  return CatalogFileSchema.parse({
    version: {
      schema: SCHEMA_VERSION,
      pipeline: 1,
      fixtures: 'test',
      manifest: 1,
      built: '2026-01-01T00:00:00.000Z',
    },
    assets: {
      models: 'https://example.test/models',
      sprites: 'https://example.test/sprites',
      thumbs: 'https://example.test/thumbs',
      lod: 'https://example.test/lod',
    },
    sprite: MEASURED_SPRITE_SHEET,
    tags: table,
    records,
  })
}

/**
 * Two files of one design, plus a singleton — the smallest corpus that separates
 * the two number spaces.
 *
 * Ordinal **4** is a group minimum and therefore also an address. Ordinal **9**
 * is in the same group and is *not* an address. Ordinal **12** is a singleton, so
 * for it the two spaces coincide. A resolver that confuses the spaces gets 9
 * wrong and 4 and 12 right, which is exactly the failure mode that would survive
 * a corpus of singletons.
 */
export const OVERLAP: readonly Draft[] = [
  {
    id: 'tiles/x/openforge/wall.openforge.stl',
    ord: 4,
    design: 'd1',
    layer: 'topper',
    tags: ['connection|openforge'],
    name: 'Cave Wall 2x1',
  },
  {
    id: 'tiles/x/openlock/wall.openlock.stl',
    ord: 9,
    design: 'd1',
    layer: 'integral',
    tags: ['connection|openlock'],
    name: 'Cave Wall 2x1',
  },
  {
    id: 'tiles/y/openlock/corner.openlock.stl',
    ord: 12,
    design: 'd2',
    layer: 'integral',
    tags: ['connection|openlock'],
    name: 'Cave Corner',
  },
]

/**
 * `OVERLAP` after the design key behind ordinal 9 changed — one item becoming
 * two, the case A1 branded the address for.
 *
 * The files are byte-identical to `OVERLAP`'s; only the grouping moved, which is
 * the point: nothing about a *file* changes when an aggregate splits.
 */
export const SPLIT: readonly Draft[] = OVERLAP.map((draft) =>
  draft.ord === 9 ? { ...draft, design: 'd1b' } : draft,
)
