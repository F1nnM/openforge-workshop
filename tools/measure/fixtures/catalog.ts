/**
 * A minimal, valid `CatalogFile` whose records can be given the footprints and
 * tags the four target sets are defined by.
 *
 * Built through `CatalogFile.parse`, so a test cannot exercise this tool against
 * an index the real schema would have rejected — which is why `catalog.ts` parses
 * rather than casts. `tools/thumbnails/fixtures/catalog.ts` does the same for the
 * thumbnail tool; this one exists separately because that builder fixes every
 * record's footprint to `1×1 rect`, and a footprint is precisely the axis these
 * tests vary.
 */
import type { CatalogFile, Footprint } from '../../../src/catalog'
import { CatalogFile as CatalogFileSchema, MEASURED_SPRITE_SHEET } from '../../../src/catalog'

export interface TestRecord {
  id: string
  ord: number
  blob: string
  bytes?: number
  foot?: Footprint
  /** Full tag strings; interned automatically. */
  tags?: readonly string[]
  sizeCode?: string
}

/** A 32-hex md5 built from a short seed, so tests can name blobs readably. */
export function blobOf(seed: string): string {
  return seed.padEnd(32, '0').slice(0, 32).toLowerCase().replace(/[^0-9a-f]/g, '0')
}

export function testCatalog(records: readonly TestRecord[]): CatalogFile {
  const vocabulary: string[] = []
  const intern = (tag: string): number => {
    const at = vocabulary.indexOf(tag)
    if (at !== -1) return at
    vocabulary.push(tag)
    return vocabulary.length - 1
  }
  // `tags` must be non-empty for every record, and the intern table must hold
  // every id, so a default tag is added first.
  intern('texture|test')

  const rows = records.map((record) => ({
    id: record.id,
    ord: record.ord,
    blob: record.blob,
    file: record.id.slice(record.id.lastIndexOf('/') + 1),
    bytes: record.bytes ?? 1_000_000,
    sprite: true,
    family: record.id.slice(0, record.id.lastIndexOf('/')),
    design: 'design-1',
    name: 'Test Tile',
    kinds: ['floor'],
    conn: ['openlock'],
    layer: 'topper',
    tags: (record.tags ?? ['texture|test']).map(intern),
    foot: record.foot ?? { shape: 'none' },
    ...(record.sizeCode === undefined ? {} : { sizeCode: record.sizeCode }),
  }))

  return CatalogFileSchema.parse({
    version: {
      schema: 1,
      pipeline: 1,
      fixtures: 'test',
      manifest: 1,
      built: '2026-01-01T00:00:00.000Z',
    },
    assets: {
      models: 'https://objects.example.test/models',
      sprites: 'https://objects.example.test/sprites',
      thumbs: 'https://objects.example.test/thumbs',
      lod: 'https://objects.example.test/lod',
    },
    sprite: MEASURED_SPRITE_SHEET,
    tags: vocabulary,
    records: rows,
  })
}
